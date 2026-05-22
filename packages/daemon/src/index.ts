import { createHash } from "node:crypto";
import type { Address, Hex } from "viem";

import { discoverAgentCli } from "./agent-discovery.js";
import { runAgentForMilestone } from "./agent-runner.js";
import { readMilestone, watchMilestoneAssigned } from "./chain.js";
import {
  createCircleClient,
  getWalletAddress as getCircleAddress,
  signAndSendContractCall as circleSignAndSend,
  waitForTxHash as circleWaitForTxHash,
  type SignAndSendOpts,
  type SignAndSendResult,
} from "./circle.js";
import {
  createLocalClient,
  getWalletAddress as getLocalAddress,
  signAndSendContractCall as localSignAndSend,
  waitForTxHash as localWaitForTxHash,
} from "./local-signer.js";
import { assertReadyForChain, assertReadyForSigning, config } from "./config.js";
import { startServer } from "./sse-server.js";
import { loadState, milestoneKey, type StateHandle } from "./state.js";

/**
 * Daemon entrypoint — stitches the Stream-C runtime modules into the full lifecycle:
 * watch → accept → spawn agent → submit. Each phase persists to `state.json` and
 * emits an SSE event so the dashboard at http://localhost:CHORD_HTTP_PORT can follow
 * along live.
 *
 * Signer modes (resolved once at boot, then identical downstream):
 *   - Local: CHORD_LOCAL_PRIVATE_KEY set → viem `LocalAccount`. For Hardhat /
 *     anvil smoke tests; no Circle creds required.
 *   - Circle: default. Dev-Controlled SCA via @circle-fin/developer-controlled-wallets.
 */

/**
 * Minimal signer surface that the lifecycle code talks to. Both the Circle path
 * and the local-key path implement this via closure binding in `main()`.
 */
interface Signer {
  mode: "circle" | "local";
  address: Address;
  /** walletId only matters for Circle; local mode ignores it. */
  signAndSend: (opts: SignAndSendOpts) => Promise<SignAndSendResult>;
  waitForTxHash: (txId: string) => Promise<Hex>;
}

/**
 * Deterministic UUID-shaped idempotency key. Reruns of the same milestone phase
 * produce the same key, so Circle dedupes instead of double-charging gas.
 */
function idempotencyKey(parts: string[]): string {
  const h = createHash("sha256").update(parts.join("::")).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    h.slice(12, 16),
    h.slice(16, 20),
    h.slice(20, 32),
  ].join("-");
}

async function handleAssignment(args: {
  state: StateHandle;
  emit: (event: string, data: unknown) => void;
  signer: Signer;
  sca: Address;
  escrow: Address;
  agentCli: { name: string; path: string };
  projectId: bigint;
  milestoneIndex: bigint;
}) {
  const { state, emit, signer, sca, escrow, agentCli, projectId, milestoneIndex } = args;
  const key = milestoneKey(projectId, milestoneIndex);
  state.upsertRun(key, {
    projectId: projectId.toString(),
    milestoneIndex: milestoneIndex.toString(),
    assignee: sca,
    phase: "accepting",
  });
  emit("milestone-assigned", { key, projectId: projectId.toString(), milestoneIndex: milestoneIndex.toString() });

  try {
    // accept on-chain
    const acceptTx = await signer.signAndSend({
      walletId: config.circle.walletId,
      contractAddress: escrow,
      abiSignature: "acceptMilestone(uint256,uint256)",
      abiParameters: [projectId.toString(), milestoneIndex.toString()],
      idempotencyKey: idempotencyKey(["accept", signer.mode, signer.address, projectId.toString(), milestoneIndex.toString()]),
      refId: `chord:${key}:accept`,
    });
    state.patchRun(key, { acceptTxId: acceptTx.txId });
    emit("accept-submitted", { key, txId: acceptTx.txId });

    const acceptHash = await signer.waitForTxHash(acceptTx.txId);
    state.patchRun(key, { acceptTxHash: acceptHash });
    emit("accept-confirmed", { key, txHash: acceptHash });

    // fetch brief + spawn agent
    const milestone = await readMilestone({ escrowAddress: escrow, projectId, milestoneIndex });
    state.patchRun(key, { phase: "running" });
    emit("agent-starting", {
      key,
      description: milestone.description,
      amount: milestone.amount.toString(),
    });

    const result = await runAgentForMilestone({
      agentCli,
      projectId,
      milestoneIndex,
      description: milestone.description,
      onLog: line => emit("agent-log", { key, line }),
    });
    state.patchRun(key, {
      phase: "submitting",
      deliverableUri: result.deliverableUri,
      deliverableHash: result.deliverableHash,
      logPath: result.logPath,
    });
    emit("agent-done", {
      key,
      deliverableUri: result.deliverableUri,
      deliverableHash: result.deliverableHash,
      fileCount: result.fileCount,
    });

    // submit on-chain — embed hash in the URI fragment so a verifier can re-hash and check
    const submissionNote = `${result.deliverableUri}#sha256=${result.deliverableHash}`;
    const submitTx = await signer.signAndSend({
      walletId: config.circle.walletId,
      contractAddress: escrow,
      abiSignature: "submitMilestone(uint256,uint256,string)",
      abiParameters: [projectId.toString(), milestoneIndex.toString(), submissionNote],
      idempotencyKey: idempotencyKey([
        "submit",
        signer.mode,
        signer.address,
        projectId.toString(),
        milestoneIndex.toString(),
        result.deliverableHash,
      ]),
      refId: `chord:${key}:submit`,
    });
    state.patchRun(key, { submitTxId: submitTx.txId });
    emit("submit-submitted", { key, txId: submitTx.txId });

    const submitHash = await signer.waitForTxHash(submitTx.txId);
    state.patchRun(key, { submitTxHash: submitHash, phase: "done" });
    emit("milestone-submitted", { key, txHash: submitHash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.patchRun(key, { phase: "failed", error: msg });
    emit("milestone-failed", { key, error: msg });
    console.error(`[chord] milestone ${key} failed: ${msg}`);
  }
}

/**
 * Resolve which signer to use based on env. CHORD_LOCAL_PRIVATE_KEY trumps
 * Circle creds — useful for the smoke test and for any reviewer who wants to
 * exercise the daemon without provisioning a Circle account.
 */
async function buildSigner(): Promise<Signer> {
  if (config.localPrivateKey) {
    console.log("[chord] signer mode: LOCAL (CHORD_LOCAL_PRIVATE_KEY set)");
    const local = await createLocalClient();
    const address = await getLocalAddress(local);
    console.log(`[chord] local signer: ${address} (chainId ${local.chainId}, rpc ${local.rpcUrl})`);
    return {
      mode: "local",
      address,
      signAndSend: opts => localSignAndSend(local, opts),
      waitForTxHash: txId => localWaitForTxHash(local, txId),
    };
  }

  console.log("[chord] signer mode: CIRCLE (Dev-Controlled SCA)");
  assertReadyForSigning();
  const circle = createCircleClient();
  const address = await getCircleAddress(circle, config.circle.walletId);
  console.log(`[chord] SCA: ${address}  (wallet ${config.circle.walletId})`);
  return {
    mode: "circle",
    address,
    signAndSend: opts => circleSignAndSend(circle, opts),
    waitForTxHash: txId => circleWaitForTxHash(circle, txId),
  };
}

async function main(): Promise<void> {
  console.log(`[chord] daemon=${config.daemonName} arcChainId=${config.arcChainId}`);

  const cli = await discoverAgentCli({
    candidates: config.agentCandidates,
    override: config.agentOverride,
  });
  if (!cli) {
    console.error(
      `[chord] no agent CLI found on PATH. Install one of: ${config.agentCandidates.join(", ")} ` +
        `or set CHORD_AGENT_CLI to an absolute path.`,
    );
    process.exit(1);
  }
  console.log(`[chord] agent CLI: ${cli.name} → ${cli.path}`);

  assertReadyForChain();
  const escrow = config.chordEscrowAddress as Address;

  const state = await loadState(config.dataDir);

  // SSE dashboard
  const sse = startServer({ snapshot: () => state.get() });
  console.log(`[chord] dashboard: http://localhost:${sse.port}`);

  // resolve signer + on-chain identity
  const signer = await buildSigner();
  const sca = signer.address;
  state.setSca(sca);
  sse.emit("ready", { sca, escrow, cli: cli.name, signerMode: signer.mode });

  // watch for assignments
  const unwatch = watchMilestoneAssigned({
    escrowAddress: escrow,
    mySCA: sca,
    onMatch: ({ projectId, milestoneIndex }) => {
      console.log(`[chord] assigned project=${projectId} idx=${milestoneIndex}`);
      void handleAssignment({
        state,
        emit: sse.emit,
        signer,
        sca,
        escrow,
        agentCli: cli,
        projectId,
        milestoneIndex,
      });
    },
    onError: err => {
      console.error("[chord] watch error:", err);
      sse.emit("watch-error", { error: err.message });
    },
  });

  // graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[chord] ${signal} → shutting down...`);
    unwatch();
    await sse.stop();
    await state.flush();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[chord] watching MilestoneAssigned. Ctrl-C to stop.");
}

main().catch(err => {
  console.error("[chord] fatal:", err);
  process.exit(1);
});
