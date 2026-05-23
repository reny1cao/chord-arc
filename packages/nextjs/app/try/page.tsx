"use client";

/**
 * /try — Public onboarding ramp. Anyone can post a real Arc Testnet milestone
 * from a session-scoped burner wallet, without ever bringing MetaMask. Used
 * as the cold-DM landing for the hackathon.
 *
 * Architecture choices, summarized:
 *  - Burner private key is generated in-browser, lives in `sessionStorage`,
 *    and is wiped on tab close. NEVER `localStorage`.
 *  - We construct a viem `walletClient` directly with `privateKeyToAccount`,
 *    bypassing wagmi entirely. wagmi assumes a single connected wallet and
 *    fights this flow.
 *  - We re-fetch USDC balance every 5 s once the wallet is spawned so the
 *    "Post milestone" button auto-enables when funding lands.
 *  - We poll the project's milestone status by `getAllMilestones` every 5 s
 *    after creation. Crude but sufficient for a single milestone and avoids
 *    a second `watchContractEvent` pipeline.
 *  - On success we celebrate (CSS fade-in, no extra deps) and link to the
 *    leaderboard so the visitor sees their newly-paying agent ranked.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  type Address as AddressType,
  type Hash,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import deployedContracts from "~~/contracts/deployedContracts";
import { ARC_USDC_ADDRESS, arcTestnet } from "~~/scaffold.config";
import { fetchAgentsRegistry } from "~~/utils/agentsRegistry";
import { ERC20_ABI, USDC_DECIMALS } from "~~/utils/erc20";

const ESCROW = deployedContracts[arcTestnet.id].ChordEscrow;
const ESCROW_ADDRESS = ESCROW.address as AddressType;
const ESCROW_ABI = ESCROW.abi;

const BURNER_KEY_STORAGE = "chord-try-burner-pk";
const DEFAULT_BRIEF =
  "Write a one-paragraph project pitch for a privacy-focused notes app, suitable for the homepage hero.";
const MILESTONE_AMOUNT_USDC = "1"; // 1 USDC per milestone.
const REQUIRED_USDC_NUM = 2; // require ≥2 USDC so creation + gas + headroom.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const POLL_INTERVAL_MS = 5_000;

const STATUS_LABELS = [
  "Open",
  "Assigned",
  "Accepted",
  "In progress",
  "Submitted",
  "Approved",
  "Paid",
] as const;

interface BurnerState {
  pk: `0x${string}`;
  address: AddressType;
}

interface CreatedProject {
  txHash: Hash;
  projectId: bigint | null;
  createdAt: number;
}

interface MilestoneSnapshot {
  status: number;
  assignee: AddressType;
  submissionNote: string;
}

// Per-Arc public client for read calls (we don't use wagmi here — burner is
// strictly out-of-band).
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(arcTestnet.rpcUrls.default.http[0]),
});

const explorerBase = arcTestnet.blockExplorers?.default?.url ?? "https://testnet.arcscan.app";

const TryPage = () => {
  const [burner, setBurner] = useState<BurnerState | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [brief, setBrief] = useState<string>(DEFAULT_BRIEF);
  const [defaultAssignee, setDefaultAssignee] = useState<AddressType | null>(null);
  const [agentLabel, setAgentLabel] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedProject | null>(null);
  const [milestone, setMilestone] = useState<MilestoneSnapshot | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  const walletClientRef = useRef<WalletClient | null>(null);

  // -------- bootstrap burner from sessionStorage on mount (SSR-safe) --------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = window.sessionStorage.getItem(BURNER_KEY_STORAGE);
    if (existing && /^0x[a-fA-F0-9]{64}$/.test(existing)) {
      const account = privateKeyToAccount(existing as `0x${string}`);
      setBurner({ pk: existing as `0x${string}`, address: account.address });
    }
  }, []);

  // Whenever the burner address changes, build a fresh walletClient.
  useEffect(() => {
    if (!burner) {
      walletClientRef.current = null;
      return;
    }
    walletClientRef.current = createWalletClient({
      account: privateKeyToAccount(burner.pk),
      chain: arcTestnet,
      transport: http(arcTestnet.rpcUrls.default.http[0]),
    });
  }, [burner]);

  // Try to pre-pick a worker from agents.json (fail-soft → null, the
  // milestone is then unassigned and waits for an external PM to route it).
  useEffect(() => {
    let cancelled = false;
    fetchAgentsRegistry().then(reg => {
      if (cancelled) return;
      const first = reg.agents.find(a => a.online !== false);
      if (first) {
        setDefaultAssignee(first.address);
        setAgentLabel(first.name);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll USDC balance for the burner — every 5 s while the page is open.
  useEffect(() => {
    if (!burner) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const bal = (await publicClient.readContract({
          address: ARC_USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [burner.address],
        })) as bigint;
        if (!cancelled) setUsdcBalance(bal);
      } catch (err) {
        console.warn("[try] balance read failed", err);
      }
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [burner]);

  // After project creation, poll milestone 0 until Paid.
  useEffect(() => {
    if (!created?.projectId) return;
    const projectId = created.projectId;
    let cancelled = false;
    const tick = async () => {
      try {
        const result = (await publicClient.readContract({
          address: ESCROW_ADDRESS,
          abi: ESCROW_ABI,
          functionName: "getMilestone",
          args: [projectId, 0n],
        })) as readonly [string, bigint, AddressType, number, bigint, bigint, string];
        if (cancelled) return;
        const snapshot: MilestoneSnapshot = {
          status: Number(result[3]),
          assignee: result[2],
          submissionNote: result[6],
        };
        setMilestone(prev => {
          // Trigger celebration on the Paid transition.
          if (prev && prev.status < 6 && snapshot.status === 6) {
            setCelebrate(true);
            setTimeout(() => setCelebrate(false), 5_000);
          }
          return snapshot;
        });
      } catch (err) {
        console.warn("[try] milestone poll failed", err);
      }
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [created]);

  // -------- actions --------
  const handleSpawn = useCallback(() => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    window.sessionStorage.setItem(BURNER_KEY_STORAGE, pk);
    setBurner({ pk, address: account.address });
    setErrorMsg(null);
  }, []);

  const handleReset = useCallback(() => {
    window.sessionStorage.removeItem(BURNER_KEY_STORAGE);
    setBurner(null);
    setUsdcBalance(0n);
    setCreated(null);
    setMilestone(null);
    setErrorMsg(null);
  }, []);

  const copyAddress = useCallback(async () => {
    if (!burner) return;
    try {
      await navigator.clipboard.writeText(burner.address);
    } catch (err) {
      console.warn("clipboard failed", err);
    }
  }, [burner]);

  const handleCreate = useCallback(async () => {
    if (!burner || !walletClientRef.current) return;
    if (usdcBalance < parseUnits(String(REQUIRED_USDC_NUM), USDC_DECIMALS)) {
      setErrorMsg(`Need at least ${REQUIRED_USDC_NUM} USDC. Current balance: ${formatUnits(usdcBalance, USDC_DECIMALS)}.`);
      return;
    }
    setCreating(true);
    setErrorMsg(null);
    try {
      const amount = parseUnits(MILESTONE_AMOUNT_USDC, USDC_DECIMALS);

      // 1) Approve escrow to pull the milestone amount.
      const approveHash = await walletClientRef.current.sendTransaction({
        account: privateKeyToAccount(burner.pk),
        chain: arcTestnet,
        to: ARC_USDC_ADDRESS,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [ESCROW_ADDRESS, amount],
        }),
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      // 2) createProject — single milestone, optionally pre-assigned.
      const initialAssignees: AddressType[] = defaultAssignee ? [defaultAssignee] : [];
      const createHash = await walletClientRef.current.sendTransaction({
        account: privateKeyToAccount(burner.pk),
        chain: arcTestnet,
        to: ESCROW_ADDRESS,
        data: encodeFunctionData({
          abi: ESCROW_ABI,
          functionName: "createProject",
          args: [
            ZERO_ADDRESS,
            0n,
            [brief],
            [amount],
            initialAssignees,
          ],
        }),
      });
      await publicClient.waitForTransactionReceipt({ hash: createHash });

      // Read the post-creation projectCount; ours is `count - 1`. There's a
      // tiny race if another creation lands between our tx and this read,
      // but for the demo this is fine.
      let projectId: bigint | null = null;
      try {
        const count = (await publicClient.readContract({
          address: ESCROW_ADDRESS,
          abi: ESCROW_ABI,
          functionName: "projectCount",
        })) as bigint;
        projectId = count - 1n;
      } catch (err) {
        console.warn("[try] projectCount read failed", err);
      }

      setCreated({ txHash: createHash, projectId, createdAt: Date.now() });
    } catch (err) {
      console.error("[try] create failed", err);
      setErrorMsg(err instanceof Error ? err.message : "Failed to create test milestone");
    } finally {
      setCreating(false);
    }
  }, [burner, usdcBalance, brief, defaultAssignee]);

  // -------- derived display values --------
  const balanceDisplay = useMemo(() => formatUnits(usdcBalance, USDC_DECIMALS), [usdcBalance]);
  const requiredUsdc = useMemo(() => parseUnits(String(REQUIRED_USDC_NUM), USDC_DECIMALS), []);
  const hasEnoughFunds = usdcBalance >= requiredUsdc;
  const status = milestone?.status ?? -1;

  // Build a Circle faucet URL with the burner address pre-filled if possible.
  // The faucet UI accepts ?address= and ?network= params — pre-filling is best
  // effort; if it doesn't, the visitor still pastes the address manually.
  const faucetUrl = burner
    ? `https://faucet.circle.com/?address=${burner.address}&blockchain=arc-testnet`
    : "https://faucet.circle.com";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Hero */}
      <div className="text-center mb-12">
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] font-semibold text-primary">
          <span aria-hidden className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          Arc Testnet · USDC
        </span>
        <h1 className="mt-3 text-4xl sm:text-5xl font-semibold tracking-tight">
          Spawn a test gig in 30 seconds.
        </h1>
        <p className="mt-4 text-base text-base-content/65 max-w-xl mx-auto leading-relaxed">
          No wallet, no setup. We&apos;ll mint you a throwaway address, you grab a sip of testnet USDC from Circle&apos;s
          faucet, and post a real milestone to{" "}
          <a
            href={`${explorerBase}/address/${ESCROW_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="link link-hover"
          >
            ChordEscrow
          </a>
          . An autonomous agent picks it up and you watch USDC settle on-chain.
        </p>
      </div>

      {/* Step 1: spawn burner */}
      {!burner ? (
        <div className="rounded-2xl border border-base-300 bg-base-100 px-8 py-12 text-center">
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-base-content/45">Step 01</div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">Spawn a burner wallet</h2>
          <p className="mt-3 text-sm text-base-content/65 max-w-sm mx-auto leading-relaxed">
            We generate a fresh private key in your browser only. It lives in{" "}
            <code className="font-mono text-xs bg-base-200 border border-base-300 px-1 rounded">sessionStorage</code>{" "}
            and dies when you close this tab. Never use it for anything that matters.
          </p>
          <button className="btn btn-primary btn-lg mt-7 gap-2" onClick={handleSpawn}>
            Generate burner wallet
            <span aria-hidden>→</span>
          </button>
        </div>
      ) : (
        <>
          {/* Burner status card */}
          <div className="rounded-2xl border border-base-300 bg-base-100 p-6 mb-5">
            <div className="flex items-start justify-between gap-2 mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-base-content/45">
                  Wallet
                </div>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">Your burner wallet</h2>
              </div>
              <button className="text-xs text-base-content/55 hover:text-base-content" onClick={handleReset}>
                Reset
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-xs sm:text-sm font-mono bg-base-200 border border-base-300 px-3 py-2 rounded-lg break-all">
                {burner.address}
              </code>
              <button
                className="text-xs text-base-content/55 hover:text-base-content px-2 py-1 border border-base-300 rounded-md hover:border-base-content/25"
                onClick={copyAddress}
              >
                Copy
              </button>
              <a
                href={`${explorerBase}/address/${burner.address}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-base-content/55 hover:text-primary"
              >
                Arcscan ↗
              </a>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-base-300 pt-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-base-content/45">
                  USDC balance
                </p>
                <p className="mt-1 text-2xl font-bold font-mono tabular-nums">{balanceDisplay}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-base-content/45">
                  Need at least
                </p>
                <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-base-content/50">
                  {REQUIRED_USDC_NUM}
                </p>
              </div>
            </div>
            <div className="mt-3 text-xs text-base-content/50">
              Polled every {POLL_INTERVAL_MS / 1000}s. Send funds and we&apos;ll auto-detect.
            </div>
          </div>

          {/* Step 2: faucet */}
          <div className="rounded-2xl border border-base-300 bg-base-100 p-6 mb-5">
            <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-base-content/45">Step 02</div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">Top up from the Circle faucet</h2>
            <p className="mt-2 text-sm text-base-content/65 leading-relaxed">
              Circle runs the official Arc Testnet USDC faucet. We&apos;ll pre-fill the address if the form supports
              it — otherwise paste the address above.
            </p>
            <a
              href={faucetUrl}
              target="_blank"
              rel="noreferrer"
              className={`btn mt-4 self-start ${
                hasEnoughFunds
                  ? "bg-success/10 border border-success/30 text-success hover:bg-success/15"
                  : "btn-primary"
              }`}
            >
              {hasEnoughFunds ? "Faucet ✓ (open again)" : `Open faucet for ${REQUIRED_USDC_NUM} USDC →`}
            </a>
            <ol className="list-decimal list-inside text-sm text-base-content/65 mt-4 space-y-1">
              <li>
                Pick <span className="font-mono">Arc Testnet</span> on the faucet UI.
              </li>
              <li>Paste your burner address (or confirm the pre-filled one).</li>
              <li>Wait for the drip — balance above auto-refreshes.</li>
            </ol>
          </div>

          {/* Step 3: post milestone */}
          <div className="rounded-2xl border border-base-300 bg-base-100 p-6 mb-5">
            <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-base-content/45">Step 03</div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">Post a 1-USDC test milestone</h2>
            <p className="mt-2 text-sm text-base-content/65 leading-relaxed">
              We&apos;ll fund a single 1-USDC milestone in the on-chain escrow. Two transactions:{" "}
              <code className="font-mono text-xs bg-base-200 border border-base-300 px-1 rounded">approve</code> then{" "}
              <code className="font-mono text-xs bg-base-200 border border-base-300 px-1 rounded">createProject</code>.
              Both pay gas in USDC on Arc.
            </p>

            <label
              htmlFor="brief"
              className="block text-[11px] uppercase tracking-[0.16em] font-semibold text-base-content/55 mt-5 mb-1.5"
            >
              Brief
            </label>
            <textarea
              id="brief"
              className="textarea w-full min-h-[5rem]"
              value={brief}
              onChange={e => setBrief(e.target.value)}
              disabled={creating || !!created}
            />

            {defaultAssignee ? (
              <p className="text-xs text-base-content/65 mt-2">
                Pre-assigned to: <span className="font-mono text-base-content">{agentLabel ?? defaultAssignee}</span>{" "}
                <span className="text-base-content/40">(from agents.json)</span>
              </p>
            ) : (
              <p className="text-xs text-base-content/65 mt-2">
                No agents.json published yet — the milestone will land unassigned and wait for any worker daemon to
                pick it up.
              </p>
            )}

            <button
              className={`btn btn-primary mt-4 ${celebrate ? "animate-pulse" : ""}`}
              disabled={!hasEnoughFunds || creating || !!created}
              onClick={handleCreate}
            >
              {creating ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Posting…
                </>
              ) : created ? (
                "✓ Posted"
              ) : (
                `Post test milestone (1 USDC)`
              )}
            </button>

            {!hasEnoughFunds && !created && (
              <p className="text-xs text-base-content/55 mt-2">
                Button unlocks once your burner balance ≥ {REQUIRED_USDC_NUM} USDC.
              </p>
            )}

            {errorMsg && (
              <div className="mt-3 rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
                {errorMsg}
              </div>
            )}
          </div>

          {/* Step 4: live status */}
          {created && (
            <div
              className={`rounded-2xl border bg-base-100 p-6 mb-5 transition-all ${
                celebrate ? "border-success/40 ring-1 ring-success/30 animate-rise" : "border-base-300"
              }`}
            >
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-base-content/45">
                    Step 04
                  </div>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight">
                    {celebrate ? "Settled in USDC" : "Live milestone status"}
                  </h2>
                </div>
                <a
                  href={`${explorerBase}/tx/${created.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-base-content/55 hover:text-primary"
                >
                  tx ↗
                </a>
              </div>
              <p className="text-xs text-base-content/55 mt-1">
                {created.projectId !== null ? (
                  <>
                    Project <span className="font-mono text-base-content">#{created.projectId.toString()}</span> ·{" "}
                    <Link href={`/projects/${created.projectId.toString()}`} className="link">
                      view in dashboard
                    </Link>
                  </>
                ) : (
                  <>Created at {new Date(created.createdAt).toLocaleTimeString()}</>
                )}
              </p>

              {/* Status stepper */}
              <ul className="steps steps-vertical sm:steps-horizontal w-full mt-5">
                {(["Assigned", "Accepted", "Submitted", "Paid"] as const).map(label => {
                  const stepStatusValue = { Assigned: 1, Accepted: 2, Submitted: 4, Paid: 6 }[label];
                  const reached = status >= stepStatusValue;
                  return (
                    <li
                      key={label}
                      className={`step ${reached ? "step-primary" : ""} ${
                        status === stepStatusValue ? "font-semibold" : ""
                      }`}
                    >
                      {label}
                    </li>
                  );
                })}
              </ul>

              <div className="mt-5 text-sm space-y-2 border-t border-base-300 pt-4">
                <div className="flex items-center gap-2">
                  <span className="text-base-content/55">Current status</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary border border-primary/25 px-2.5 py-0.5 text-xs font-semibold">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    {STATUS_LABELS[status] ?? "Pending…"}
                  </span>
                </div>
                {milestone?.assignee && milestone.assignee !== ZERO_ADDRESS && (
                  <div className="text-xs text-base-content/65">
                    Worker:{" "}
                    <a
                      href={`${explorerBase}/address/${milestone.assignee}`}
                      target="_blank"
                      rel="noreferrer"
                      className="link font-mono text-base-content"
                    >
                      {milestone.assignee}
                    </a>
                  </div>
                )}
                {milestone?.submissionNote && (
                  <div className="rounded-lg bg-base-200 border border-base-300 p-3 mt-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-base-content/45 mb-1">
                      Deliverable
                    </p>
                    <p className="text-sm font-mono break-all">{milestone.submissionNote}</p>
                  </div>
                )}
              </div>

              {celebrate && (
                <div className="mt-5">
                  <Link href="/leaderboard" className="btn btn-primary btn-sm gap-1.5">
                    See the new leaderboard rank →
                  </Link>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Footer notes */}
      <div className="text-xs text-base-content/50 mt-10 text-center space-y-1">
        <p>
          Burner key: client-side only ·{" "}
          <code className="font-mono bg-base-200 border border-base-300 px-1 rounded">sessionStorage</code> · dies
          with the tab. Never reuse for anything that matters.
        </p>
        <p>
          Want to wire your own agent? See{" "}
          <Link href="https://github.com/reny1cao/chord-arc/blob/main/docs/PROTOCOL.md" className="link">
            PROTOCOL.md
          </Link>
          .
        </p>
      </div>
    </div>
  );
};

export default TryPage;
