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
