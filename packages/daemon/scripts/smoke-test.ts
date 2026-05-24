/**
 * End-to-end smoke test for the Chord daemon — full lifecycle against a local
 * Hardhat node, no Circle credentials required.
 *
 * Run with: `node .yarn/releases/yarn-3.2.3.cjs workspace @chord/daemon smoke`
 *
 * Steps:
 *   1. Start `hardhat node` in the background, wait until chainId responds.
 *   2. Deploy ChordEscrow + MockUSDC via `hardhat deploy --network localhost --reset`.
 *   3. Mint USDC to the "client" account, approve the escrow, create a project
 *      with one 5-USDC milestone pre-assigned to the "worker" account.
 *   4. Spawn the daemon with CHORD_LOCAL_PRIVATE_KEY=<worker pk> and an agent
 *      CLI. Defaults to fake-agent.sh; set CHORD_SMOKE_AGENT_CLI to exercise a
 *      real local agent binary.
 *   5. Watch on-chain for MilestoneAccepted (worker auto-accepts) and
 *      MilestoneSubmitted (worker submits hash of the fake deliverable).
 *   6. As the client, call approveMilestone and wait for MilestonePaid.
 *   7. Assert the worker's USDC balance increased by the milestone amount
 *      (no PM, so worker gets the full 5 USDC).
 *   8. Tear down — kill daemon and hardhat node, exit 0 on success.
 *
 * Timeouts:
 *   - hardhat node readiness: 30 s
 *   - MilestoneAccepted:      45 s
 *   - MilestoneSubmitted:     90 s (fake agent is fast; the budget is for
 *                                   accept → spawn → hash → submit roundtrip)
 *   - MilestonePaid:          15 s
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  http,
  parseUnits,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { chordEscrowAbi } from "../src/chord-escrow-abi.js";

// ─── repo paths ───────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DAEMON_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(DAEMON_DIR, "..", "..");
const HARDHAT_DIR = path.join(REPO_ROOT, "packages", "hardhat");
const YARN_BIN = path.join(REPO_ROOT, ".yarn", "releases", "yarn-3.2.3.cjs");
const FAKE_AGENT = path.join(DAEMON_DIR, "scripts", "fake-agent.sh");
const SMOKE_AGENT_CLI = process.env.CHORD_SMOKE_AGENT_CLI || FAKE_AGENT;
const DAEMON_ENTRY = path.join(DAEMON_DIR, "src", "index.ts");
const TSX_BIN = path.join(DAEMON_DIR, "node_modules", ".bin", "tsx");

// ─── chain setup ──────────────────────────────────────────────────────────────
const RPC_URL = "http://127.0.0.1:8545";
const HARDHAT_CHAIN_ID = 31337;
const HARDHAT_CHAIN = defineChain({
  id: HARDHAT_CHAIN_ID,
  name: "Hardhat",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
});

// Deterministic Hardhat default signers.
//   [0] deployer / hardhat-deploy default → used here as the "client"
//   [1] worker → the daemon's signing key
const CLIENT_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const WORKER_PK =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const DEFAULT_SMOKE_DESCRIPTION =
  "Smoke test milestone — write a result file into ./out/ proving the worker ran end-to-end.";
const REAL_AGENT_SMOKE_DESCRIPTION = [
  "Result:",
  "Research crypto prediction markets and deliver an evidence pack.",
  "",
  "Authority:",
  "Research only. Read public data only. Do not trade, spend money, or contact third parties.",
  "",
  "Proof:",
  "Write files into ./out/ with source notes, market observations, and uncertainty flags.",
  "",
  "Acceptance:",
  "Includes one ranked market observation and a traceable execution summary.",
  "",
  "Failure:",
  "No output, fabricated sources, or unsupported recommendations fail review.",
].join("\n");

// Minimal MockUSDC ABI — only what the smoke test touches.
const mockUsdcAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Extension to the daemon's read ABI — the smoke test also writes (createProject,
// approveMilestone) and watches MilestonePaid, none of which the daemon ever signs.
const escrowExtraAbi = [
  {
    type: "function",
    name: "createProject",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pm", type: "address" },
      { name: "pmFeeBps", type: "uint256" },
      { name: "descriptions", type: "string[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "initialAssignees", type: "address[]" },
    ],
    outputs: [{ name: "projectId", type: "uint256" }],
  },
  {
    type: "function",
    name: "approveMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "MilestonePaid",
    inputs: [
      { name: "projectId", type: "uint256", indexed: true },
      { name: "milestoneIndex", type: "uint256", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "autoReleased", type: "bool", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ProjectCreated",
    inputs: [
      { name: "projectId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "pm", type: "address", indexed: false },
      { name: "pmFeeBps", type: "uint256", indexed: false },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "milestoneCount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

const allEscrowAbi = [...chordEscrowAbi, ...escrowExtraAbi] as const;

// ─── tiny logging helpers ────────────────────────────────────────────────────
const t0 = Date.now();
const elapsed = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (msg: string): void => {
  // eslint-disable-next-line no-console
  console.log(`[smoke ${elapsed().padStart(6)}] ${msg}`);
};
const fail = (msg: string): never => {
  // eslint-disable-next-line no-console
  console.error(`[smoke ${elapsed().padStart(6)}] ✗ ${msg}`);
  throw new Error(msg);
};

// ─── child-process helpers ───────────────────────────────────────────────────
function spawnDetached(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; tag: string },
): ChildProcess {
  // detached: true puts the child in its own process group so we can SIGKILL
  // the whole tree (yarn → hardhat node, or yarn → tsx → daemon) on cleanup.
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout?.on("data", (b: Buffer) =>
    process.stdout.write(`[${opts.tag}] ${b}`),
  );
  child.stderr?.on("data", (b: Buffer) =>
    process.stderr.write(`[${opts.tag}] ${b}`),
  );
  return child;
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    // Negative PID = process group (because we spawned with detached: true).
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already dead */
    }
  }
}

function runOnce(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    tag: string;
    timeoutMs?: number;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (b: Buffer) =>
      process.stdout.write(`[${opts.tag}] ${b}`),
    );
    child.stderr?.on("data", (b: Buffer) =>
      process.stderr.write(`[${opts.tag}] ${b}`),
    );
    const killer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`${opts.tag} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;
    child.on("error", (err) => {
      if (killer) clearTimeout(killer);
      reject(err);
    });
    child.on("close", (code) => {
      if (killer) clearTimeout(killer);
      if (code === 0) resolve();
      else reject(new Error(`${opts.tag} exited with code ${code}`));
    });
  });
}

// ─── workflow steps ──────────────────────────────────────────────────────────
async function waitForChain(
  client: PublicClient,
  deadlineMs: number,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const id = await client.getChainId();
      if (id === HARDHAT_CHAIN_ID) return;
      lastErr = new Error(`unexpected chainId ${id}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(500);
  }
  fail(
    `hardhat node never responded with chainId ${HARDHAT_CHAIN_ID}: ${describeErr(lastErr)}`,
  );
}

function readDeployedAddress(name: string): Address {
  const file = path.join(
    HARDHAT_DIR,
    "deployments",
    "localhost",
    `${name}.json`,
  );
  if (!existsSync(file)) fail(`deployment file missing: ${file}`);
  const json = JSON.parse(readFileSync(file, "utf8")) as { address?: string };
  if (!json.address) fail(`deployment file has no address: ${file}`);
  return getAddress(json.address);
}

async function watchForEvent(
  publicClient: PublicClient,
  opts: {
    address: Address;
    eventName: "MilestoneAccepted" | "MilestoneSubmitted" | "MilestonePaid";
    fromBlock: bigint;
    timeoutMs: number;
    matcher?: (decoded: Record<string, unknown>) => boolean;
  },
): Promise<{ args: Record<string, unknown>; log: Log }> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    const logs = await publicClient.getLogs({
      address: opts.address,
      fromBlock: opts.fromBlock,
      toBlock: "latest",
    });
    for (const lg of logs) {
      try {
        const decoded = decodeEventLog({
          abi: allEscrowAbi,
          data: lg.data,
          topics: lg.topics,
        });
        if (decoded.eventName !== opts.eventName) continue;
        const args = decoded.args as unknown as Record<string, unknown>;
        if (opts.matcher && !opts.matcher(args)) continue;
        return { args, log: lg };
      } catch {
        // not one of our events; skip.
      }
    }
    await sleep(500);
  }
  fail(`timed out (${opts.timeoutMs}ms) waiting for ${opts.eventName}`);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));
const describeErr = (err: unknown): string =>
  err instanceof Error ? err.message : err == null ? "unknown" : String(err);

async function portInUse(port: number): Promise<boolean> {
  // Cheap probe — try a connect. If it succeeds, port is occupied.
  const net = await import("node:net");
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    const done = (val: boolean): void => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(val);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, "127.0.0.1");
  });
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "chord-smoke-"));
  log(`tmp data dir: ${dataDir}`);

  const cleanupTasks: Array<() => void | Promise<void>> = [];
  const cleanup = async (): Promise<void> => {
    for (const task of cleanupTasks.reverse()) {
      try {
        await task();
      } catch {
        /* swallow during teardown */
      }
    }
  };

  process.on("SIGINT", () => {
    void cleanup().finally(() => process.exit(130));
  });

  try {
    // ── 0. fail-fast if port 8545 is already in use ──────────────────────────
    if (await portInUse(8545)) {
      fail(
        "port 8545 is already in use — kill the running process before running the smoke test (e.g. `lsof -ti tcp:8545 | xargs kill`)",
      );
    }

    // ── 1. start hardhat node ────────────────────────────────────────────────
    log("starting hardhat node...");
    const node = spawnDetached(
      "node",
      [YARN_BIN, "workspace", "@chord/hardhat", "chain"],
      { cwd: REPO_ROOT, tag: "hardhat" },
    );
    cleanupTasks.push(() => killTree(node));

    const publicClient = createPublicClient({
      chain: HARDHAT_CHAIN,
      transport: http(RPC_URL),
    }) as PublicClient;
    await waitForChain(publicClient, 30_000);
    log("✓ hardhat node ready");

    // ── 2. deploy escrow + mock USDC ─────────────────────────────────────────
    log("deploying ChordEscrow + MockUSDC...");
    await runOnce(
      "node",
      [
        YARN_BIN,
        "workspace",
        "@chord/hardhat",
        "deploy",
        "--network",
        "localhost",
        "--reset",
      ],
      { cwd: REPO_ROOT, tag: "deploy", timeoutMs: 90_000 },
    );

    const escrowAddr = readDeployedAddress("ChordEscrow");
    const usdcAddr = readDeployedAddress("MockUSDC");
    log(`✓ ChordEscrow @ ${escrowAddr}`);
    log(`✓ MockUSDC    @ ${usdcAddr}`);

    // ── 3. fund client + create project ──────────────────────────────────────
    const clientAcct: PrivateKeyAccount = privateKeyToAccount(CLIENT_PK);
    const workerAcct: PrivateKeyAccount = privateKeyToAccount(WORKER_PK);
    log(`client: ${clientAcct.address}`);
    log(`worker: ${workerAcct.address}`);

    const clientWallet: WalletClient = createWalletClient({
      account: clientAcct,
      chain: HARDHAT_CHAIN,
      transport: http(RPC_URL),
    });

    const M1 = parseUnits("5", 6); // 5 USDC milestone

    log("minting 100 USDC to client...");
    const mintHash = await clientWallet.writeContract({
      account: clientAcct,
      chain: HARDHAT_CHAIN,
      address: usdcAddr,
      abi: mockUsdcAbi,
      functionName: "mint",
      args: [clientAcct.address, parseUnits("100", 6)],
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });

    log("approving escrow for milestone amount...");
    const approveHash = await clientWallet.writeContract({
      account: clientAcct,
      chain: HARDHAT_CHAIN,
      address: usdcAddr,
      abi: mockUsdcAbi,
      functionName: "approve",
      args: [escrowAddr, M1],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    const createBlockBefore = await publicClient.getBlockNumber();

    const milestoneDescription =
      process.env.CHORD_SMOKE_MILESTONE_DESCRIPTION ||
      (SMOKE_AGENT_CLI === FAKE_AGENT
        ? DEFAULT_SMOKE_DESCRIPTION
        : REAL_AGENT_SMOKE_DESCRIPTION);

    log("creating project (1 milestone, pre-assigned to worker)...");
    const createHash = await clientWallet.writeContract({
      account: clientAcct,
      chain: HARDHAT_CHAIN,
      address: escrowAddr,
      abi: allEscrowAbi,
      functionName: "createProject",
      args: [
        "0x0000000000000000000000000000000000000000" as Address, // no PM
        0n,
        [milestoneDescription],
        [M1],
        [workerAcct.address],
      ],
    });
    const createReceipt = await publicClient.waitForTransactionReceipt({
      hash: createHash,
    });

    // Parse ProjectCreated to grab the projectId (usually 0 since this is a fresh chain).
    let projectId: bigint | null = null;
    for (const lg of createReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: allEscrowAbi,
          data: lg.data,
          topics: lg.topics,
        });
        if (decoded.eventName === "ProjectCreated") {
          projectId = (decoded.args as { projectId: bigint }).projectId;
          break;
        }
      } catch {
        /* skip non-matching */
      }
    }
    if (projectId === null)
      fail("could not find ProjectCreated in createProject receipt");
    log(`✓ project created (id=${projectId.toString()})`);

    // ── 4. spawn the daemon ──────────────────────────────────────────────────
    log(
      `spawning daemon in LOCAL signing mode with agent CLI: ${SMOKE_AGENT_CLI}`,
    );
    const daemonHttpPort = 7717 + Math.floor(Math.random() * 100); // dodge "address in use" if 7717 is busy
    const daemon = spawnDetached(TSX_BIN, [DAEMON_ENTRY], {
      cwd: DAEMON_DIR,
      env: {
        CHORD_LOCAL_PRIVATE_KEY: WORKER_PK,
        CHORD_AGENT_CLI: SMOKE_AGENT_CLI,
        CHORD_ESCROW_ADDRESS: escrowAddr,
        CHORD_DATA_DIR: dataDir,
        CHORD_HTTP_PORT: String(daemonHttpPort),
        ARC_TESTNET_RPC_URL: RPC_URL,
        // Wipe parent's CHORD_DAEMON_NAME etc so the smoke test is reproducible.
        CHORD_DAEMON_NAME: "smoke-worker",
      },
      tag: "daemon",
    });
    cleanupTasks.push(() => killTree(daemon));
    daemon.on("exit", (code) => {
      if (code !== null && code !== 0) {
        log(`⚠ daemon exited prematurely with code ${code}`);
      }
    });

    // ── 5. wait for MilestoneAccepted ────────────────────────────────────────
    log("watching for MilestoneAccepted...");
    const acceptedEvent = await watchForEvent(publicClient, {
      address: escrowAddr,
      eventName: "MilestoneAccepted",
      fromBlock: createBlockBefore,
      timeoutMs: 45_000,
      matcher: (a) => a.projectId === projectId && a.milestoneIndex === 0n,
    });
    log(
      `✓ MilestoneAccepted @ block ${acceptedEvent.log.blockNumber} (tx ${acceptedEvent.log.transactionHash})`,
    );

    // ── 6. wait for MilestoneSubmitted ───────────────────────────────────────
    log("watching for MilestoneSubmitted (agent runs + daemon submits)...");
    const submittedEvent = await watchForEvent(publicClient, {
      address: escrowAddr,
      eventName: "MilestoneSubmitted",
      fromBlock: createBlockBefore,
      timeoutMs: 90_000,
      matcher: (a) => a.projectId === projectId && a.milestoneIndex === 0n,
    });
    const submissionNote = submittedEvent.args.note as string;
    log(
      `✓ MilestoneSubmitted note="${submissionNote.slice(0, 80)}${submissionNote.length > 80 ? "..." : ""}"`,
    );

    // Sanity: the note must contain the sha256 fragment the daemon embeds.
    if (!submissionNote.includes("#sha256=")) {
      fail(`submission note missing #sha256= fragment: ${submissionNote}`);
    }

    // ── 7. client approves → worker gets paid ────────────────────────────────
    log("client calls approveMilestone...");
    const workerBalanceBefore = (await publicClient.readContract({
      address: usdcAddr,
      abi: mockUsdcAbi,
      functionName: "balanceOf",
      args: [workerAcct.address],
    })) as bigint;

    const approveMilestoneHash = await clientWallet.writeContract({
      account: clientAcct,
      chain: HARDHAT_CHAIN,
      address: escrowAddr,
      abi: allEscrowAbi,
      functionName: "approveMilestone",
      args: [projectId, 0n],
    });
    await publicClient.waitForTransactionReceipt({
      hash: approveMilestoneHash,
    });

    const paidEvent = await watchForEvent(publicClient, {
      address: escrowAddr,
      eventName: "MilestonePaid",
      fromBlock: createBlockBefore,
      timeoutMs: 15_000,
      matcher: (a) => a.projectId === projectId && a.milestoneIndex === 0n,
    });
    log(
      `✓ MilestonePaid amount=${(paidEvent.args.amount as bigint).toString()} autoReleased=${paidEvent.args.autoReleased}`,
    );

    // ── 8. assert balance ────────────────────────────────────────────────────
    const workerBalanceAfter = (await publicClient.readContract({
      address: usdcAddr,
      abi: mockUsdcAbi,
      functionName: "balanceOf",
      args: [workerAcct.address],
    })) as bigint;
    const delta = workerBalanceAfter - workerBalanceBefore;
    if (delta !== M1) {
      fail(`worker balance delta ${delta} != expected ${M1}`);
    }
    log(
      `✓ worker balance increased by ${delta} (${(Number(delta) / 1e6).toFixed(2)} USDC)`,
    );

    log(`✓✓✓ smoke test passed in ${elapsed()}`);
  } finally {
    log("cleaning up...");
    await cleanup();
    // Best-effort: wipe the tmp dir.
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`\n[smoke ${elapsed()}] FATAL:`, err);
    process.exit(1);
  });
