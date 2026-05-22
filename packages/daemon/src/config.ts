import "dotenv/config";

const required = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
};

export const config = {
  // Arc Testnet
  arcRpcUrl: process.env.ARC_TESTNET_RPC_URL || "https://arc-testnet.g.alchemy.com/v2",
  arcChainId: 5042002,
  arcUsdcAddress: "0x3600000000000000000000000000000000000000" as const,
  arcExplorer: "https://testnet.arcscan.app",

  // Deployed ChordEscrow address — populated after `yarn deploy --network arcTestnet`
  chordEscrowAddress: process.env.CHORD_ESCROW_ADDRESS || "",

  // This daemon's Circle Dev-Controlled SCA wallet
  circle: {
    apiKey: process.env.CIRCLE_API_KEY || "",
    entitySecret: process.env.CIRCLE_ENTITY_SECRET || "",
    walletId: process.env.CIRCLE_WALLET_ID || "",
    walletSetId: process.env.CIRCLE_WALLET_SET_ID || "",
    blockchain: "ARC-TESTNET" as const,
  },

  // Daemon identity — friendly label for logs and the operator dashboard
  daemonName: process.env.CHORD_DAEMON_NAME || "chord-daemon-0",
  dataDir: process.env.CHORD_DATA_DIR || ".chord",

  // Optional dashboard (SSE preview of agent runs, à la Open Design)
  httpPort: Number(process.env.CHORD_HTTP_PORT || 7717),

  // Agent runtime — the daemon scans PATH for these CLIs (Open Design-inspired).
  // Order = preference: first available is used unless CHORD_AGENT_CLI overrides.
  agentCandidates: ["claude", "codex", "gemini", "cursor-agent", "opencode", "qwen", "kimi"] as const,
  agentOverride: process.env.CHORD_AGENT_CLI || "",
};

export function assertReadyForChain(): void {
  required("CHORD_ESCROW_ADDRESS");
}

export function assertReadyForSigning(): void {
  required("CIRCLE_API_KEY");
  required("CIRCLE_ENTITY_SECRET");
  required("CIRCLE_WALLET_ID");
}
