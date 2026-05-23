# @chord/daemon

A worker daemon that turns any coding-agent CLI on your `PATH` into an autonomous Arc-paid contractor.

## Lifecycle

1. **Boot** — config, agent CLI discovery, SQLite open, HTTP/SSE server
2. **Wallet** — resolve this daemon's Circle Dev-Controlled SCA address
3. **Watch** — viem subscribes to `MilestoneAssigned` events where `assignee = our SCA`
4. **Accept** — sign + broadcast `acceptMilestone(projectId, milestoneIndex)` via Circle Wallets API
5. **Spawn** — `child_process.spawn(detectedCli, [...], { cwd: .chord/milestones/<pid>-<idx>/ })`
6. **Stream** — parse per-CLI JSON output, persist to SQLite, emit SSE deltas to dashboard
7. **Submit** — hash the deliverable, (optionally) pin to IPFS, sign `submitMilestone`
8. **Get paid** — payout arrives in the SCA's USDC balance after client `approveMilestone`

## Inspired by

[Open Design](https://github.com/nexu-io/open-design) — same daemon-spawns-CLI pattern, swapped output target (design artifact → milestone deliverable) and added on-chain payment rails.

## Status: D1 runtime modules in place

Modules wired (integrator stitches them in `index.ts`):

| Module | Public API | Purpose |
|---|---|---|
| `chord-escrow-abi.ts` | `chordEscrowAbi`, `MilestoneStatus` | Hardcoded minimal ABI (event + 3 fns) for viem inference. No typechain dep. |
| `chain.ts` | `publicClient`, `arcTestnet`, `watchMilestoneAssigned`, `readMilestone` | viem client + event subscription filtered server-side on `assignee == mySCA`. |
| `circle.ts` | `createCircleClient`, `getWalletAddress`, `signAndSendContractCall`, `waitForTxHash` | Thin wrap of `@circle-fin/developer-controlled-wallets`. The create call returns Circle's internal `txId`, NOT an on-chain hash — `waitForTxHash` polls for it. |
| `agent-runner.ts` | `runAgentForMilestone` | Spawns the agent CLI in `<dataDir>/milestones/<pid>-<idx>/`, writes `BRIEF.md`, streams stdout/stderr to `onLog` + `run.log`, hashes `out/` (or cwd if `out/` is empty). |
| `sse-server.ts` | `startServer({ snapshot })`, returns `{ emit, stop, port, clientCount }` | Express on `config.httpPort`, serves `/`, `/events` (SSE), `/status` (JSON). |
| `state.ts` | `loadState(dataDir)` → `StateHandle` (`get`, `setSca`, `upsertRun`, `patchRun`, `listRuns`, `flush`) | In-memory + debounced JSON persistence. No SQLite (better-sqlite3 fails to build on Node 26). |
| `bootstrap-sca.ts` | standalone script | Creates Circle WalletSet + SCA on Arc Testnet. Deterministic idempotency keys so reruns don't dupe. |

### Run

```bash
yarn workspace @chord/daemon dev               # daemon
yarn workspace @chord/daemon bootstrap-sca --name specialist-react   # create SCA
```

## Env

```
ARC_TESTNET_RPC_URL=...                # Alchemy / dRPC / QuickNode key
CHORD_ESCROW_ADDRESS=0x...             # populated after yarn deploy --network arcTestnet
CIRCLE_API_KEY=...                     # https://developers.circle.com
CIRCLE_ENTITY_SECRET=...               # 32-byte hex, registered with Circle
CIRCLE_WALLET_ID=...                   # this daemon's SCA wallet ID
CIRCLE_WALLET_SET_ID=...               # the wallet set the wallet belongs to
CHORD_DAEMON_NAME=specialist-react     # friendly label
CHORD_AGENT_CLI=                       # optional absolute path; otherwise auto-discovered
CHORD_HTTP_PORT=7717                   # dashboard SSE port
CHORD_LOCAL_PRIVATE_KEY=               # OPTIONAL — when set, bypasses Circle and signs locally
                                       # with a viem LocalAccount. Used by the smoke test.
```

## Signing modes

The daemon picks its signer once at boot:

- **Circle (default)** — Dev-Controlled SCA via `@circle-fin/developer-controlled-wallets`. Requires `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_ID`. This is the production path.
- **Local** — set `CHORD_LOCAL_PRIVATE_KEY=<32-byte hex>` (with or without `0x`). The daemon resolves the chain id from the RPC and signs with a viem `LocalAccount`. Use this for Hardhat / Anvil smoke tests with no Circle account.

Both modes expose the same downstream call sites; the only branch lives in `buildSigner()` inside `src/index.ts`.

## Local smoke test

Proves the full lifecycle without any Circle credentials. Spins up Hardhat, deploys ChordEscrow + MockUSDC, creates a milestone assigned to a worker key, spawns the daemon against a fake agent CLI, and watches every on-chain event from `MilestoneAccepted` through `MilestonePaid` before asserting the worker's USDC balance.

```bash
# from the repo root
yarn workspace @chord/daemon smoke
```

Expected runtime: 8–15 s on a warm Hardhat (mostly the wait for `MilestoneAccepted` + `MilestoneSubmitted`). Single-line status updates plus `✓✓✓ smoke test passed` on success; non-zero exit on failure.

Prerequisites:

- Port `8545` must be free (the test fails fast with a helpful error if not).
- `packages/hardhat/artifacts/` must exist — run `yarn compile` once if you've just cloned the repo.

The test uses Hardhat's deterministic default accounts:

- `account[0]` = client (creates project, approves milestone)
- `account[1]` = worker (the daemon's `CHORD_LOCAL_PRIVATE_KEY`)

`scripts/fake-agent.sh` stands in for `claude` / `codex` / etc. — it accepts both `-p <text>` and a positional file path so it works regardless of which agent-runner code path fires for it.

## PM Agent (`--pm`)

This daemon doubles as the reference **PM (routing) agent** described in [PROTOCOL.md §6](../../docs/PROTOCOL.md#6-routing-agents). A PM watches `ProjectCreated` events where it is named as the project's PM, then calls `assignMilestone` once per milestone — picking a worker by asking Kimi to match the milestone description against the agents.json capability registry.

The PM is itself paid in USDC: it earns its project's `pmFeeBps` (default `500` = 5%) out of every approved milestone. Routing is the recursive primitive — **agents paying agents to coordinate other agents, all settled on-chain**.

### Run

```bash
# requires the same signer env as the worker (Circle or CHORD_LOCAL_PRIVATE_KEY)
yarn workspace @chord/daemon pm
# under the hood: tsx src/index.ts --pm
```

Top-level argv dispatch keeps the two modes cleanly separated — PM mode never runs the agent-CLI discovery step (a routing agent doesn't spawn coding CLIs).

### Extra env

```
CHORD_AGENTS_JSON=<url|path>           # default: https://raw.githubusercontent.com/reny1cao/chord-arc/main/packages/daemon/agents.json
CHORD_PM_FEE_BPS=500                   # informational only; actual fee set per-project at createProject
KIMI_API_KEY=...                       # Moonshot key — same env the nextjs splitter uses
KIMI_BASE_URL=https://api.moonshot.cn/v1
KIMI_MODEL=moonshot-v1-8k
```

`CHORD_AGENTS_JSON` resolves in three modes:
- `https://…` / `http://…` → global `fetch`
- `file:///abs/path` or `/abs/path` → `fs.readFile`
- anything else → resolved relative to the daemon package root (so `agents.json` works out of the box)

### Routing pipeline

For each milestone in a new `ProjectCreated`:

1. **Read** the milestone; skip if `assignee != 0x0` (it came in via `initialAssignees[]`) or status is past `Created`.
2. **Filter** the registry: `online == true` AND `milestoneAmount >= minPayoutUsdc` AND `inFlightForAgent < maxConcurrent`. In-flight is counted from local state — restarts don't double-assign.
3. **Ask Kimi**: send the candidate list + milestone description with strict-JSON instructions. The description is wrapped in `--- MILESTONE DESCRIPTION (untrusted) ---` delimiters per [PROTOCOL §8](../../docs/PROTOCOL.md#8-security-considerations) to defend against prompt injection.
4. **Validate**: the address Kimi returns MUST checksum-match a candidate. Hallucinated addresses are rejected outright — there is no fallback that picks a "close" agent. Failure surfaces as a `routing-decision { ok: false, reason }` SSE event and a warning log; the milestone stays unrouted.
5. **Sign** `assignMilestone(projectId, milestoneIndex, pick)`. The Circle idempotency key hashes the pick so a different routing decision on retry actually produces a fresh tx.

### SSE events emitted in PM mode

| Event | When |
|---|---|
| `pm-ready` | Boot — payload includes the loaded registry and PM address |
| `project-detected` | A `ProjectCreated` for this PM lands on-chain |
| `routing-skipped` | Milestone already assigned or past `Created` |
| `routing-considering` | About to ask Kimi — payload includes the candidate slate |
| `routing-decision` | Kimi answered — payload includes `pick`, `rationale`, `latencyMs` (or the failure reason) |
| `routing-tx-submitted` | `assignMilestone` was signed and queued |
| `routing-tx-confirmed` | `assignMilestone` mined on Arc |
| `routing-tx-failed` | Signer/chain error during the assignMilestone path |

The reference frontend can subscribe to `/events` and surface "Kimi assigned milestone X to agent Y because Z" in real time.

### agents.json — the reference registry

Shipped at [`packages/daemon/agents.json`](./agents.json) (also published at the canonical raw URL above). v0.1 schema is documented in [PROTOCOL.md §3](../../docs/PROTOCOL.md#3-off-chain-interface--agentsjson-capability-registry). The reference file ships with three placeholder workers (`0xAA…` / `0xBB…` / `0xCC…`) — replace with real SCAs after running `yarn bootstrap-sca --name <label>` for each.
