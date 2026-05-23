/**
 * Chord PM Agent — the reference routing daemon (PROTOCOL §6).
 *
 * Lifecycle:
 *   1. Boot: load config, signer, agents.json registry, SSE dashboard.
 *   2. Watch: subscribe to `ProjectCreated` where `pm == mySCA`.
 *   3. For each project: iterate milestones 0..milestoneCount-1, skipping any
 *      that came in with an `initialAssignee != 0x0` or have already moved
 *      past `Created`.
 *   4. For each unrouted milestone: ask Kimi which eligible agent fits,
 *      validate the pick is in the candidate list, sign `assignMilestone`.
 *   5. Stream a `routing-decision` SSE event per attempt (with rationale)
 *      so the dashboard can show "Kimi → agent X because Y".
 *
 * Wiring contract:
 *   await runPmAgent({ signer, escrow, state, sse }); // returns an `unwatch`
 *
 * Cross-mode reuse: the worker daemon's `idempotencyKey`, `buildSigner` and
 * SSE/state plumbing live in `index.ts` and are passed in — this module owns
 * only the PM-specific behavior.
 */
import { getAddress, type Address, type Hex } from "viem";
import { readMilestone, watchProjectCreated, type ProjectCreatedEvent } from "./chain.js";
import { config } from "./config.js";
import { MilestoneStatus } from "./chord-escrow-abi.js";
import { loadAgentsRegistry, filterEligible, type AgentsRegistry } from "./agents-registry.js";
import { pickAgent } from "./router.js";
import type { SignAndSendOpts, SignAndSendResult } from "./circle.js";
import { milestoneKey, type MilestoneKey, type StateHandle } from "./state.js";

/** Signer surface — narrow copy of `Signer` in index.ts to avoid a cyclic import. */
export interface PmSigner {
  mode: "circle" | "local";
  address: Address;
  signAndSend: (opts: SignAndSendOpts) => Promise<SignAndSendResult>;
  waitForTxHash: (txId: string) => Promise<Hex>;
}

export interface PmEmit {
  (event: string, data: unknown): void;
}

export interface RunPmAgentOpts {
  signer: PmSigner;
  escrow: Address;
  state: StateHandle;
  emit: PmEmit;
  /** Pluggable so tests can swap (defaults to env-driven `config.agentsJsonUrl`). */
  agentsJsonUrl?: string;
  /** Idem-key factory — passed in so the PM uses the same deterministic UUID
   *  shape the worker uses. Avoids dup code paths and keeps tests aligned. */
  idempotencyKey: (parts: string[]) => string;
}

/**
 * Build the in-flight count map from persisted state. The PM persists every
 * routing attempt under the same `milestoneKey` shape the worker uses, with a
 * dedicated `pm-routing` phase namespace stored in `error` (we don't extend
 * the RunPhase enum because that lives in shared state.ts which we don't
 * touch). On restart, anything still in `routing-pending` counts against
 * concurrency caps so we don't double-assign.
 */
function computeInFlight(state: StateHandle): Map<string, number> {
  const map = new Map<string, number>();
  for (const run of state.listRuns()) {
    // assignee is always set; for PM-mode rows it's the pick address.
    if (!run.assignee) continue;
    if (run.phase === "done" || run.phase === "failed") continue;
    const key = run.assignee.toLowerCase();
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

async function routeOneMilestone(args: {
  state: StateHandle;
  emit: PmEmit;
  signer: PmSigner;
  escrow: Address;
  registry: AgentsRegistry;
  projectId: bigint;
  milestoneIndex: bigint;
  idempotencyKey: (parts: string[]) => string;
}): Promise<void> {
  const { state, emit, signer, escrow, registry, projectId, milestoneIndex } = args;
  const key: MilestoneKey = milestoneKey(projectId, milestoneIndex);

  // Read the milestone — we need description + amount + current assignee/status
  // to know whether it still needs routing.
  const milestone = await readMilestone({ escrowAddress: escrow, projectId, milestoneIndex });

  // PROTOCOL §3.4: only route milestones that are still in `Created` state and
  // unassigned. `initialAssignees[]` at createProject can pre-fill these.
  // Case-insensitive compare: viem returns addresses checksummed, but defending
  // against future ABI tweaks is cheap.
  if (milestone.assignee.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
    emit("routing-skipped", {
      key,
      reason: "already-assigned",
      assignee: milestone.assignee,
    });
    return;
  }
  if (milestone.status !== MilestoneStatus.Created) {
    emit("routing-skipped", {
      key,
      reason: "not-in-created-state",
      status: milestone.status,
    });
    return;
  }

  const inFlight = computeInFlight(state);
  const eligible = filterEligible(registry, {
    milestoneAmount: milestone.amount,
    inFlightByAddress: inFlight,
  });

  emit("routing-considering", {
    key,
    description: milestone.description,
    amount: milestone.amount.toString(),
    candidateCount: eligible.length,
    candidates: eligible.map(a => ({ address: a.address, name: a.name })),
  });

  const result = await pickAgent({
    milestoneDescription: milestone.description,
    milestoneAmount: milestone.amount,
    eligibleAgents: eligible,
  });

  if (!result.ok) {
    emit("routing-decision", {
      key,
      ok: false,
      reason: result.diagnostics.reason,
      detail: result.diagnostics.detail,
      rationale: result.diagnostics.rationale,
    });
    console.warn(
      `[chord:pm] could not route ${key}: ${result.diagnostics.reason}` +
        (result.diagnostics.detail ? ` — ${result.diagnostics.detail}` : ""),
    );
    return;
  }

  const { pick, rationale, agent, latencyMs } = result.decision;

  // Persist *before* the on-chain call so a crash mid-tx doesn't lose the
  // intent. Same key, separate from any worker-side row (worker rows are
  // keyed identically but written by a different daemon, so collisions only
  // happen if the same SCA is both PM and worker — unusual but allowed).
  state.upsertRun(key, {
    projectId: projectId.toString(),
    milestoneIndex: milestoneIndex.toString(),
    assignee: pick,
    phase: "assigned", // PM-side: "assigned" means "the PM has decided + signed".
  });

  emit("routing-decision", {
    key,
    ok: true,
    pick,
    pickName: agent.name,
    rationale,
    latencyMs,
    candidateCount: eligible.length,
  });

  try {
    const assignTx = await signer.signAndSend({
      walletId: config.circle.walletId,
      contractAddress: escrow,
      abiSignature: "assignMilestone(uint256,uint256,address)",
      abiParameters: [projectId.toString(), milestoneIndex.toString(), pick],
      // Hash the pick into the idem key so a rerun with a different routing
      // decision actually produces a fresh Circle transaction — otherwise
      // Circle's dedup would return the original txId, never sending the new
      // pick. See `chord-escrow-gotchas` for related dedup quirks.
      idempotencyKey: args.idempotencyKey([
        "assign",
        signer.mode,
        signer.address,
        projectId.toString(),
        milestoneIndex.toString(),
        pick,
      ]),
      refId: `chord:pm:${key}:assign`,
    });
    emit("routing-tx-submitted", { key, pick, txId: assignTx.txId });

    const txHash = await signer.waitForTxHash(assignTx.txId);
    state.patchRun(key, { acceptTxHash: txHash, phase: "done" });
    emit("routing-tx-confirmed", { key, pick, txHash });
    console.log(`[chord:pm] assigned ${key} → ${pick} (${agent.name}) — tx ${txHash}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.patchRun(key, { phase: "failed", error: msg });
    emit("routing-tx-failed", { key, pick, error: msg });
    console.error(`[chord:pm] assign failed for ${key}: ${msg}`);
  }
}

async function handleProjectCreated(args: {
  state: StateHandle;
  emit: PmEmit;
  signer: PmSigner;
  escrow: Address;
  registry: AgentsRegistry;
  event: ProjectCreatedEvent;
  idempotencyKey: (parts: string[]) => string;
}): Promise<void> {
  const { event, emit } = args;
  emit("project-detected", {
    projectId: event.projectId.toString(),
    client: event.client,
    pmFeeBps: event.pmFeeBps.toString(),
    totalAmount: event.totalAmount.toString(),
    milestoneCount: event.milestoneCount.toString(),
    blockNumber: event.blockNumber.toString(),
    txHash: event.transactionHash,
  });

  // Route each milestone sequentially — keeps in-flight counts honest as we
  // potentially assign multiple milestones to the same agent (maxConcurrent
  // gates the second one). For a busy PM this would become a queue with
  // worker pool, but at testnet event volume sequential is fine.
  for (let i = 0n; i < event.milestoneCount; i++) {
    try {
      await routeOneMilestone({
        ...args,
        projectId: event.projectId,
        milestoneIndex: i,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit("routing-error", {
        projectId: event.projectId.toString(),
        milestoneIndex: i.toString(),
        error: msg,
      });
      console.error(`[chord:pm] routing error project=${event.projectId} idx=${i}: ${msg}`);
    }
  }
}

/**
 * Boot the PM agent. Returns an unwatch fn — the caller (index.ts) is
 * responsible for wiring it into shutdown.
 */
export async function runPmAgent(opts: RunPmAgentOpts): Promise<() => void> {
  const agentsUrl = opts.agentsJsonUrl ?? config.agentsJsonUrl;
  console.log(`[chord:pm] loading agents.json from ${agentsUrl}`);
  const registry = await loadAgentsRegistry(agentsUrl);
  console.log(
    `[chord:pm] registry v${registry.version}: ${registry.agents.length} agent(s) ` +
      `(${registry.agents.map(a => a.name).join(", ")})`,
  );
  opts.emit("pm-ready", {
    pm: opts.signer.address,
    escrow: opts.escrow,
    registry: {
      sourceUrl: registry.sourceUrl,
      version: registry.version,
      agentCount: registry.agents.length,
      agents: registry.agents.map(a => ({ address: a.address, name: a.name })),
    },
    pmFeeBps: config.pmFeeBps,
  });

  const myPm = getAddress(opts.signer.address);

  const unwatch = watchProjectCreated({
    escrowAddress: opts.escrow,
    myPM: myPm,
    onMatch: event => {
      console.log(
        `[chord:pm] ProjectCreated project=${event.projectId} client=${event.client} ` +
          `milestones=${event.milestoneCount}`,
      );
      void handleProjectCreated({
        state: opts.state,
        emit: opts.emit,
        signer: opts.signer,
        escrow: opts.escrow,
        registry,
        event,
        idempotencyKey: opts.idempotencyKey,
      });
    },
    onError: err => {
      console.error("[chord:pm] watch error:", err);
      opts.emit("watch-error", { error: err.message });
    },
  });

  console.log(`[chord:pm] watching ProjectCreated where pm == ${myPm}. Ctrl-C to stop.`);
  return unwatch;
}
