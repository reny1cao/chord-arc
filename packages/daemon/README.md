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

## Status: D0 scaffold

Boots and reports config + the first CLI it finds on PATH. Chain ops and agent spawn land in D1.

```bash
yarn workspace @chord/daemon dev
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
```
