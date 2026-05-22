import { config } from "./config.js";
import { discoverAgentCli } from "./agent-discovery.js";

/**
 * Chord daemon entrypoint.
 *
 * Lifecycle (D1 target):
 *   1. boot — load config, discover agent CLI, open SQLite, start HTTP/SSE server
 *   2. resolve wallet — fetch this daemon's SCA address from Circle Wallets API
 *   3. watch chain — viem `watchContractEvent` on ChordEscrow for MilestoneAssigned where assignee = our SCA
 *   4. on assignment — POST to Circle to sign+broadcast acceptMilestone(projectId, milestoneIndex)
 *   5. spawn agent — child_process.spawn(detectedCli, [...], { cwd: .chord/milestones/<pid>-<idx>/ })
 *   6. stream stdout — parse per-CLI JSON, persist to SQLite, emit SSE deltas
 *   7. on completion — hash deliverable, optionally pin to IPFS, sign submitMilestone(projectId, milestoneIndex, uri)
 *   8. await approval — payout arrives in this SCA's USDC balance
 *
 * D0 (today): just boots and reports config + discovered CLI. No chain ops yet.
 */
async function main() {
  console.log(`[chord] daemon=${config.daemonName} arcChainId=${config.arcChainId}`);
  console.log(`[chord] USDC=${config.arcUsdcAddress}`);
  console.log(`[chord] explorer=${config.arcExplorer}`);

  const cli = await discoverAgentCli({
    candidates: config.agentCandidates,
    override: config.agentOverride,
  });
  if (!cli) {
    console.warn(
      `[chord] no agent CLI found on PATH. Install one of: ${config.agentCandidates.join(", ")} ` +
        `or set CHORD_AGENT_CLI to an absolute path.`,
    );
  } else {
    console.log(`[chord] agent CLI: ${cli.name} → ${cli.path}`);
  }

  if (!config.chordEscrowAddress) {
    console.log(
      "[chord] CHORD_ESCROW_ADDRESS not set — deploy ChordEscrow first " +
        "(`cd packages/hardhat && yarn deploy --network arcTestnet`) and export it.",
    );
  }
  if (!config.circle.walletId) {
    console.log(
      "[chord] CIRCLE_WALLET_ID not set — create one with the bootstrap script " +
        "(coming in D1) before this daemon can sign on-chain.",
    );
  }

  console.log("[chord] D0 boot complete. Chain watching + agent spawn land in D1.");
}

main().catch(err => {
  console.error("[chord] fatal:", err);
  process.exit(1);
});
