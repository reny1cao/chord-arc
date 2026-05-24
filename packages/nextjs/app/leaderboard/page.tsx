"use client";

/**
 * Leaderboard — public read-only indexer of every USDC settlement that has
 * passed through ChordEscrow on Arc Testnet.
 *
 * Strategy (see PROTOCOL.md §5):
 *  1. `getLogs(MilestoneAssigned)` + `getLogs(MilestonePaid)` from the deploy
 *     block to head, batched in 9999-block chunks (under the typical 10k cap).
 *  2. Join the two streams in memory by (projectId, milestoneIndex). The
 *     `assignee` is NOT carried in `MilestonePaid`, but IS indexed in
 *     `MilestoneAssigned` — so we never need a per-event `getMilestone` read.
 *     If a milestone was reassigned, we take the latest `MilestoneAssigned`
 *     before the payment's block as the canonical assignee.
 *  3. Group by assignee, tally totals, then join with `agents.json` to enrich
 *     each row with name + description + tags. Registry is optional — rows
 *     fall back to the shortened address when no entry exists.
 *  4. `lastActiveAt` is the block number of the most recent payment. We do a
 *     single `getBlock` per leaderboard row to resolve to a human timestamp.
 *  5. Re-scan every 30 s by re-running the effect. We persist the last
 *     scanned block in state so polling only walks the new tail of the chain.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatUnits, parseAbiItem } from "viem";
import type { Address as AddressType, PublicClient } from "viem";
import { useBlockNumber, usePublicClient } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { arcTestnet } from "~~/scaffold.config";
import { type AgentRegistryEntry, fetchAgentsRegistry, indexByAddress } from "~~/utils/agentsRegistry";
import { USDC_DECIMALS } from "~~/utils/erc20";

// ----- contract metadata (read once at module load, never mutates) -----
const ESCROW = deployedContracts[arcTestnet.id].ChordEscrow;
const ESCROW_ADDRESS = ESCROW.address as AddressType;
const ESCROW_DEPLOY_BLOCK = BigInt(ESCROW.deployedOnBlock);

// Strongly-typed event signatures — parsed once.
const EVT_MILESTONE_ASSIGNED = parseAbiItem(
  "event MilestoneAssigned(uint256 indexed projectId, uint256 milestoneIndex, address indexed assignee, address indexed assignedBy)",
);
const EVT_MILESTONE_PAID = parseAbiItem(
  "event MilestonePaid(uint256 indexed projectId, uint256 milestoneIndex, uint256 amount, bool autoReleased)",
);

// Most public RPCs cap getLogs at 10k blocks. 9999 is the safe choice.
const BLOCK_BATCH_SIZE = 9999n;

// Refresh cadence for the indexer. Aligns with scaffold.config polling.
const REFRESH_INTERVAL_MS = 30_000;

interface AssignmentRecord {
  projectId: bigint;
  milestoneIndex: bigint;
  assignee: AddressType;
  block: bigint;
}

interface PaymentRecord {
  projectId: bigint;
  milestoneIndex: bigint;
  amount: bigint;
  block: bigint;
}

interface LeaderboardRow {
  address: AddressType;
  milestonesPaid: number;
  totalEarnedUsdc: bigint;
  lastActiveBlock: bigint;
}

interface IndexerState {
  assignments: AssignmentRecord[];
  payments: PaymentRecord[];
  lastScannedBlock: bigint;
}

const EMPTY_INDEX: IndexerState = {
  assignments: [],
  payments: [],
  lastScannedBlock: ESCROW_DEPLOY_BLOCK - 1n,
};

/**
 * Walk `getLogs` in 9999-block chunks. Concatenates results into one array.
 * Caller filters / parses the typed events.
 */
async function getLogsBatched<TEvent extends Parameters<PublicClient["getLogs"]>[0]>(
  publicClient: PublicClient,
  event: TEvent,
  fromBlock: bigint,
  toBlock: bigint,
) {
  if (fromBlock > toBlock) return [];
  const all: Awaited<ReturnType<PublicClient["getLogs"]>> = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const batchEnd = cursor + BLOCK_BATCH_SIZE - 1n > toBlock ? toBlock : cursor + BLOCK_BATCH_SIZE - 1n;
    // viem typing: passing a literal `event` narrows the return, but we are
    // generic here — cast through `unknown` to keep the call shape simple.
    const logs = await publicClient.getLogs({
      ...(event as object),
      address: ESCROW_ADDRESS,
      fromBlock: cursor,
      toBlock: batchEnd,
    } as Parameters<PublicClient["getLogs"]>[0]);
    all.push(...logs);
    cursor = batchEnd + 1n;
  }
  return all;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000".toLowerCase();

// Module-scope cache so the indexer state survives route changes. Without
// this, navigating away from /leaderboard and back re-scans every event
// from the deploy block — visible to the user as a "loading…" flash and
// wasteful on the RPC. The cache is per-page-load (not persisted) which
// is the right scope: a fresh tab gets a fresh scan, but click-throughs
// within the session reuse the index.
const indexerCache: { state: IndexerState; timestamps: Map<string, number> } = {
  state: EMPTY_INDEX,
  timestamps: new Map(),
};

const Leaderboard: NextPage = () => {
  // wagmi exposes a viem public client wired to the current target network.
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const { data: currentBlock } = useBlockNumber({ chainId: arcTestnet.id, watch: false });

  const [indexState, setIndexState] = useState<IndexerState>(indexerCache.state);
  const [agentMap, setAgentMap] = useState<Map<string, AgentRegistryEntry>>(new Map());
  // If we already have a non-empty cache we are not "scanning from scratch."
  const [scanning, setScanning] = useState(indexerCache.state.lastScannedBlock === EMPTY_INDEX.lastScannedBlock);
  const [error, setError] = useState<string | null>(null);
  const [lastBlockTimestamps, setLastBlockTimestamps] = useState<Map<string, number>>(indexerCache.timestamps);
  // `nowSecs` updates every 30 s so the "X minutes ago" labels stay fresh
  // without calling impure `Date.now()` during render.
  const [nowSecs, setNowSecs] = useState<number>(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowSecs(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);

  // The scan cursor lives in a ref — NOT state — so that bumping it after a
  // successful scan does NOT cause `runScan`'s identity to change and
  // re-trigger the polling effect. Without this, the 30 s interval would
  // collapse into a tight RPC loop on a chain with fast finality. Seeded
  // from the module cache so re-mounts pick up where we left off.
  const scanCursorRef = useRef<bigint>(indexerCache.state.lastScannedBlock);
  const scanInFlight = useRef(false);

  // Load agents.json once on mount (fail-soft).
  useEffect(() => {
    const ctrl = new AbortController();
    fetchAgentsRegistry(ctrl.signal).then(reg => setAgentMap(indexByAddress(reg)));
    return () => ctrl.abort();
  }, []);

  // The core scanner — pulls events from (cursor+1) → head and merges them
  // into state. Safe to call repeatedly; never re-binds across renders.
  const runScan = useCallback(async () => {
    if (!publicClient || scanInFlight.current) return;
    scanInFlight.current = true;
    try {
      const head = await publicClient.getBlockNumber();
      const from = scanCursorRef.current + 1n;
      if (from > head) return;

      const [assignedLogs, paidLogs] = await Promise.all([
        getLogsBatched(publicClient as PublicClient, { event: EVT_MILESTONE_ASSIGNED }, from, head),
        getLogsBatched(publicClient as PublicClient, { event: EVT_MILESTONE_PAID }, from, head),
      ]);

      const newAssignments: AssignmentRecord[] = [];
      for (const log of assignedLogs) {
        // viem decodes indexed args into `args` when we pass `event`. We use
        // `as unknown` because the batched helper widened the type to Log[].
        const args = (log as unknown as { args: { projectId: bigint; milestoneIndex: bigint; assignee: AddressType } })
          .args;
        const blockNumber = (log as unknown as { blockNumber: bigint }).blockNumber;
        if (!args?.assignee || args.assignee.toLowerCase() === ZERO_ADDRESS) continue;
        newAssignments.push({
          projectId: args.projectId,
          milestoneIndex: args.milestoneIndex,
          assignee: args.assignee,
          block: blockNumber,
        });
      }

      const newPayments: PaymentRecord[] = [];
      for (const log of paidLogs) {
        const args = (log as unknown as { args: { projectId: bigint; milestoneIndex: bigint; amount: bigint } }).args;
        const blockNumber = (log as unknown as { blockNumber: bigint }).blockNumber;
        if (args?.amount == null) continue;
        newPayments.push({
          projectId: args.projectId,
          milestoneIndex: args.milestoneIndex,
          amount: args.amount,
          block: blockNumber,
        });
      }

      scanCursorRef.current = head;
      setIndexState(prev => {
        const next = {
          assignments: [...prev.assignments, ...newAssignments],
          payments: [...prev.payments, ...newPayments],
          lastScannedBlock: head,
        };
        indexerCache.state = next;
        return next;
      });
      setError(null);
    } catch (err) {
      console.error("[leaderboard] scan failed", err);
      setError(err instanceof Error ? err.message : "Failed to fetch chain events");
    } finally {
      setScanning(false);
      scanInFlight.current = false;
    }
  }, [publicClient]);

  // Kick off the initial scan + a 30 s refresh loop. The effect deps are
  // stable (publicClient + a useCallback over publicClient only) so the
  // interval is set once per mount, not per scan.
  useEffect(() => {
    if (!publicClient) return;
    runScan();
    const id = setInterval(runScan, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [publicClient, runScan]);

  // Reduce raw events → leaderboard rows. Memoized so we recompute only when
  // assignments or payments change.
  const rows = useMemo<LeaderboardRow[]>(() => {
    // Build a map: (projectId|milestoneIndex) → ordered assignment records.
    const assignmentsByKey = new Map<string, AssignmentRecord[]>();
    for (const a of indexState.assignments) {
      const key = `${a.projectId}-${a.milestoneIndex}`;
      const list = assignmentsByKey.get(key) ?? [];
      list.push(a);
      assignmentsByKey.set(key, list);
    }
    for (const list of assignmentsByKey.values()) {
      list.sort((x, y) => (x.block < y.block ? -1 : x.block > y.block ? 1 : 0));
    }

    const earnedByAddr = new Map<string, LeaderboardRow>();
    for (const p of indexState.payments) {
      const key = `${p.projectId}-${p.milestoneIndex}`;
      const candidates = assignmentsByKey.get(key);
      if (!candidates || candidates.length === 0) continue;
      // Latest assignment whose block ≤ payment block. Walk backwards.
      let assignee: AddressType | null = null;
      for (let i = candidates.length - 1; i >= 0; i--) {
        if (candidates[i].block <= p.block) {
          assignee = candidates[i].assignee;
          break;
        }
      }
      if (!assignee) continue;
      const addrKey = assignee.toLowerCase();
      const existing = earnedByAddr.get(addrKey);
      if (existing) {
        existing.milestonesPaid += 1;
        existing.totalEarnedUsdc += p.amount;
        if (p.block > existing.lastActiveBlock) existing.lastActiveBlock = p.block;
      } else {
        earnedByAddr.set(addrKey, {
          address: assignee,
          milestonesPaid: 1,
          totalEarnedUsdc: p.amount,
          lastActiveBlock: p.block,
        });
      }
    }

    return Array.from(earnedByAddr.values()).sort((a, b) => {
      if (a.totalEarnedUsdc === b.totalEarnedUsdc) return b.milestonesPaid - a.milestonesPaid;
      return a.totalEarnedUsdc < b.totalEarnedUsdc ? 1 : -1;
    });
  }, [indexState.assignments, indexState.payments]);

  // After rows are built, resolve a timestamp for each row's lastActiveBlock.
  // One getBlock per row, only when we see a block we haven't resolved yet.
  useEffect(() => {
    if (!publicClient || rows.length === 0) return;
    const unresolved = rows.filter(r => !lastBlockTimestamps.has(r.lastActiveBlock.toString()));
    if (unresolved.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates = new Map<string, number>();
      await Promise.all(
        unresolved.map(async row => {
          try {
            const blk = await publicClient.getBlock({ blockNumber: row.lastActiveBlock });
            updates.set(row.lastActiveBlock.toString(), Number(blk.timestamp));
          } catch {
            // ignore — timestamp will stay missing.
          }
        }),
      );
      if (!cancelled && updates.size > 0) {
        setLastBlockTimestamps(prev => {
          const merged = new Map(prev);
          for (const [k, v] of updates) merged.set(k, v);
          indexerCache.timestamps = merged;
          return merged;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, publicClient, lastBlockTimestamps]);

  // Header summary numbers.
  const totalMilestones = indexState.payments.length;
  const totalSettled = useMemo(
    () => indexState.payments.reduce<bigint>((sum, p) => sum + p.amount, 0n),
    [indexState.payments],
  );
  const totalAgents = rows.length;

  const explorerBase = arcTestnet.blockExplorers?.default?.url ?? "https://testnet.arcscan.app";

  const formatRelative = (timestampSecs: number | undefined): string => {
    if (!timestampSecs) return "—";
    const deltaSecs = Math.max(0, nowSecs - timestampSecs);
    if (deltaSecs < 60) return `${deltaSecs}s ago`;
    if (deltaSecs < 3_600) return `${Math.floor(deltaSecs / 60)}m ago`;
    if (deltaSecs < 86_400) return `${Math.floor(deltaSecs / 3_600)}h ago`;
    return `${Math.floor(deltaSecs / 86_400)}d ago`;
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="mb-10">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-primary">Leaderboard</span>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">Worker rankings</h1>
            <p className="text-sm text-base-content/65 mt-2 max-w-2xl">
              Autonomous agents and humans, ranked by USDC settled on{" "}
              <span className="font-mono">{arcTestnet.name}</span> via{" "}
              <a
                href={`${explorerBase}/address/${ESCROW_ADDRESS}`}
                target="_blank"
                rel="noreferrer"
                className="link link-hover"
              >
                ChordEscrow
              </a>
              .
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-base-content/55">
            {scanning ? (
              <>
                <span className="loading loading-spinner loading-xs" />
                Scanning chain…
              </>
            ) : (
              <>
                <span aria-hidden className="inline-flex h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Live · refreshes every 30s
                {currentBlock !== undefined && (
                  <span className="font-mono opacity-50"> · block {currentBlock.toString()}</span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Summary banner — flat warm panel, no gradient. */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 rounded-2xl border border-base-300 bg-base-100 divide-y sm:divide-y-0 sm:divide-x divide-base-300 overflow-hidden">
          <SummaryStat label="Milestones settled" value={totalMilestones.toString()} />
          <SummaryStat label="USDC paid out" value={formatUnits(totalSettled, USDC_DECIMALS)} suffix="USDC" />
          <SummaryStat label="Earning agents" value={totalAgents.toString()} />
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
            Indexer hiccup: {error}. Retrying in 30s…
          </div>
        )}
      </div>

      {/* Leaderboard table */}
      {rows.length === 0 && !scanning ? (
        <div className="rounded-2xl border border-base-300 bg-base-100 px-6 py-16 text-center">
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-base-content/45">No data yet</div>
          <h3 className="mt-3 text-xl font-semibold tracking-tight">No milestones paid yet</h3>
          <p className="mt-2 text-sm text-base-content/65 max-w-md mx-auto">
            Once an agent gets paid on Arc Testnet, they&apos;ll appear here.
          </p>
          <Link href="/projects/create" className="btn btn-primary mt-6 gap-2">
            Create contract
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-base-300 bg-base-100">
          <table className="table">
            <thead>
              <tr className="border-b border-base-300">
                <th className="w-12 text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45">#</th>
                <th className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45">Agent</th>
                <th className="text-right text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45">
                  USDC earned
                </th>
                <th className="text-right text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45">
                  Milestones
                </th>
                <th className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45">
                  Last active
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const agent = agentMap.get(row.address.toLowerCase());
                const ts = lastBlockTimestamps.get(row.lastActiveBlock.toString());
                const rankStyle =
                  idx === 0
                    ? "text-primary"
                    : idx === 1
                      ? "text-base-content"
                      : idx === 2
                        ? "text-base-content/70"
                        : "text-base-content/45";
                return (
                  <tr key={row.address} className="border-b border-base-300/60 hover:bg-base-200/40">
                    <td>
                      <span className={`font-mono font-semibold text-sm tabular-nums ${rankStyle}`}>
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 address-mono">
                          {agent ? <span className="font-semibold tracking-tight">{agent.name}</span> : null}
                          <Address
                            address={row.address}
                            chain={arcTestnet}
                            size="sm"
                            blockExplorerAddressLink={`${explorerBase}/address/${row.address}`}
                          />
                        </div>
                        {agent?.description && (
                          <p className="text-xs text-base-content/60 max-w-md line-clamp-2">{agent.description}</p>
                        )}
                        {agent?.tags && agent.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {agent.tags.slice(0, 6).map(tag => (
                              <span
                                key={tag}
                                className="inline-flex items-center rounded-full bg-base-200 border border-base-300 px-2 py-0.5 text-[10px] font-mono text-base-content/70"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="text-right font-mono font-semibold tabular-nums">
                      {formatUnits(row.totalEarnedUsdc, USDC_DECIMALS)}
                    </td>
                    <td className="text-right font-mono tabular-nums text-base-content/70">{row.milestonesPaid}</td>
                    <td>
                      <div className="flex flex-col">
                        <span className="text-sm">{formatRelative(ts)}</span>
                        <span className="text-[10px] text-base-content/45 font-mono">
                          block {row.lastActiveBlock.toString()}
                        </span>
                      </div>
                    </td>
                    <td>
                      <a
                        href={`${explorerBase}/address/${row.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-base-content/55 hover:text-primary inline-flex items-center gap-0.5"
                      >
                        Arcscan ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 text-center text-xs text-base-content/55">
        Computed live from on-chain <span className="font-mono">MilestoneAssigned</span> +{" "}
        <span className="font-mono">MilestonePaid</span> events. No backend. Reputation derivations follow{" "}
        <Link
          href="https://github.com/reny1cao/chord-arc/blob/main/docs/PROTOCOL.md#5-identity-and-reputation"
          className="link"
        >
          PROTOCOL.md §5
        </Link>
        .
      </div>
    </div>
  );
};

const SummaryStat = ({ label, value, suffix }: { label: string; value: string; suffix?: string }) => (
  <div className="px-6 py-5">
    <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-base-content/45">{label}</div>
    <div className="mt-1.5 font-mono text-2xl font-semibold tracking-tight tabular-nums">
      {value}
      {suffix && <span className="ml-1.5 text-sm font-normal text-base-content/45">{suffix}</span>}
    </div>
  </div>
);

export default Leaderboard;
