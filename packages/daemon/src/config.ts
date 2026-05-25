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

  // Local signing override (Hardhat / Anvil smoke tests). When set, the daemon
  // bypasses Circle entirely and signs with a viem `LocalAccount`. See
  // `src/local-signer.ts` for the matching surface.
  localPrivateKey: process.env.CHORD_LOCAL_PRIVATE_KEY || "",

  // Daemon identity — friendly label for logs and the operator dashboard
  daemonName: process.env.CHORD_DAEMON_NAME || "chord-daemon-0",
  dataDir: process.env.CHORD_DATA_DIR || ".chord",

  // Wave-2: base URL of the Next.js server that hosts the content-addressed
  // WorkContract store (`/api/contracts/[hash]`). The daemon fetches the rich
  // R/A/P/A/F from here whenever a project's on-chain `contractURI` is set.
  // Defaults to localhost so the smoke test + local dev both work out of the
  // box; override in production to point at the deployed Next.js host.
  contractsBaseUrl: process.env.CHORD_CONTRACTS_BASE_URL || "http://localhost:3000",

  // Optional dashboard (SSE preview of agent runs, à la Open Design)
  httpPort: Number(process.env.CHORD_HTTP_PORT || 7717),

  // Agent runtime — the daemon scans PATH for these CLIs (Open Design-inspired).
  // Order = preference: first available is used unless CHORD_AGENT_CLI overrides.
  agentCandidates: [
    "claude",
    "codex",
    "gemini",
    "cursor-agent",
    "opencode",
    "qwen",
    "kimi",
    "prediction-market-pyagent",
    "chord-pyagent",
  ] as const,
  agentOverride: process.env.CHORD_AGENT_CLI || "",

  // ---- PM agent (--pm mode) ----
  // Location of the agents.json capability registry the PM router consults.
  // Accepts: https?:// URL, file:// URL, absolute path, or a path relative to
  // this package's root (e.g. "agents.json"). See `agents-registry.ts`.
  agentsJsonUrl:
    process.env.CHORD_AGENTS_JSON ||
    "https://raw.githubusercontent.com/reny1cao/chord-arc/main/packages/daemon/agents.json",

  // Default PM fee in basis points. Informational only — the actual fee for
  // any project is whatever the client set at createProject time. Surfaced so
  // PM operators can advertise their rate alongside their agents.json entry.
  pmFeeBps: Number(process.env.CHORD_PM_FEE_BPS || 500),

  // Kimi (Moonshot) routing brain. Same env vars the nextjs splitter uses.
  kimi: {
    apiKey: process.env.KIMI_API_KEY || "",
    baseUrl: process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1",
    model: process.env.KIMI_MODEL || "moonshot-v1-8k",
  },
};

export function assertReadyForChain(): void {
  required("CHORD_ESCROW_ADDRESS");
}

export function assertReadyForSigning(): void {
  required("CIRCLE_API_KEY");
  required("CIRCLE_ENTITY_SECRET");
  required("CIRCLE_WALLET_ID");
}
