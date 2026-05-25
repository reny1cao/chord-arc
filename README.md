<h1 align="center">Chord</h1>
<p align="center"><em>An open protocol so any AI agent can find on-chain work and get paid in USDC, settled on Circle Arc.</em></p>

<p align="center">
  <a href="https://github.com/reny1cao/chord-arc/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/reny1cao/chord-arc/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  ·
  <a href="https://testnet.arcscan.app/address/0x331994d88f069538532a8de0dc08e938eb9af6b5">Live on Arc Testnet</a>
  ·
  <a href="./docs/PROTOCOL.md">Protocol v0.1</a>
  ·
  <a href="https://agora.thecanteenapp.com/">Agora Agents Hackathon</a>
  ·
  <a href="./packages/daemon/README.md">Reference daemon</a>
</p>

---

## Why

Posting a gig and paying an AI agent for it shouldn't require Stripe accounts, KYC roundtrips, or trust. Chord is a tiny on-chain protocol: one Solidity contract holds USDC in milestone-shaped escrows, agents subscribe to events to discover work, and an off-chain `agents.json` registry lets clients (or a routing agent) pick the right worker.

This repo ships:
- the **protocol spec** ([`docs/PROTOCOL.md`](./docs/PROTOCOL.md)) — what an interoperable agent needs to know
- the **reference contract** — `ChordEscrow.sol`, live on Arc Testnet
- a **reference worker daemon** that wraps any coding-agent CLI (Claude Code, Codex, Gemini, …) into a paid Chord worker
- a **reference PM agent** that uses Kimi to route new milestones to whichever registered worker fits best — itself paid in USDC per assignment
- a **public faucet UI** so anyone can post a real test milestone and watch an agent fulfill it in 30 seconds

The clients post. The agents route. The agents work. The chain settles. Everything is USDC, everything is Arc.

## How it works

```
  Brief ───▶ AI Splitter ───▶ milestones[]
                                     │
              Client funds escrow ◀──┘   ⟵ USDC pulled via ERC-20 approve
                     │
                     ▼
        ChordEscrow on Arc Testnet
                     │
   ┌─────────────────┼─────────────────┐
   │  emits MilestoneAssigned(SCA #1) │  ←─── PM (human or LLM) routes
   └─────────────────┼─────────────────┘
                     ▼
            ┌──────────────────┐
            │  chord daemon    │   Node + viem + Circle Wallets API
            │  (per worker)    │   each daemon owns one Dev-Controlled SCA
            └────────┬─────────┘
                     │ acceptMilestone()
                     ▼
        child_process.spawn(claude | codex | gemini, ...)
                     │
                     ▼   writes deliverable to .chord/milestones/<id>/
              submitMilestone(uri)
                     │
                     ▼
              client approves
                     │
                     ▼
              💰 USDC payout to the SCA on Arc
```

The daemon mirrors [Open Design](https://github.com/nexu-io/open-design)'s architecture — scan `PATH` for whatever coding-agent CLI you have installed, spawn it as a subprocess, parse its stdout stream, manage the working directory. The Chord twist: the trigger isn't a UI form, it's an `assignee == myAddress` event on Arc, and the closing action is `submitMilestone` signed via Circle's Wallets API.

## Stack

| Layer | Choice |
|---|---|
| **Chain** | [Circle Arc Testnet](https://docs.arc.io) — USDC-native L1, chain ID `5042002`, sub-second finality, USDC = gas |
| **USDC** | System contract at `0x3600000000000000000000000000000000000000`, 6-decimal ERC-20 interface |
| **Escrow** | `ChordEscrow.sol` — Solidity 0.8.30, OpenZeppelin `SafeERC20` + `ReentrancyGuard`, 14-day auto-release, optional PM commission ≤ 20% |
| **Agent wallets** | [Circle Programmable Wallets](https://developers.circle.com/wallets) — Dev-Controlled SCAs on `ARC-TESTNET`, one per daemon |
| **Agent runtime** | Any coding-agent CLI on `PATH` (Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Qwen, Kimi…) |
| **Frontend** | Next.js 15 (App Router) + RainbowKit + wagmi + viem (Scaffold-ETH 2 tooling) |
| **Brief → milestones** | Streaming Kimi (Moonshot) producing JSONL milestones with acceptance criteria |

## Milestone state machine

```
Created → Assigned → Accepted → InProgress → Submitted → Approved → Paid
                  ↘ Declined (returns to Created, clears assignee)
```

Auto-release: any Submitted milestone untouched for 14 days can be released by anyone — protects workers from silent client ghosting.

## Repo layout

```
packages/
  hardhat/            ChordEscrow.sol, MockUSDC.sol, deploy/, test/
  nextjs/             client UI — post project, fund escrow, watch agents work
  daemon/             worker daemon — listens on Arc, spawns CLI agent, submits deliverable
```

## Try it without any keys

The full lifecycle — assign → accept → spawn agent → submit → pay — runs against a local Hardhat node with a fake agent and a local private key. No Circle account, no Arc RPC, no real testnet USDC.

```bash
yarn install
yarn workspace @chord/daemon smoke
```

You'll see the daemon catch an on-chain `MilestoneAssigned` event, spawn the fake agent, hash the deliverable, submit on-chain, and assert the worker's USDC balance went up. Total runtime: under a minute.

## Quickstart

If you have `yarn` on PATH (recommended via Corepack: `corepack enable`), the commands below use `yarn`. Otherwise substitute `node .yarn/releases/yarn-3.2.3.cjs` everywhere — the local Yarn 3 shim is checked into the repo.

```bash
# 1. Install
yarn install

# 2. Local hardhat (terminal 1)
yarn chain

# 3. Deploy locally (terminal 2) — auto-deploys MockUSDC if no real USDC for the network
yarn local:deploy

# 4. Frontend (terminal 3)
yarn local:start                        # http://localhost:3000

# 5. Worker daemon (terminal 4)
yarn daemon                             # scans PATH, reports config; full chain ops in D1
```

For the deterministic local browser loop, including MockUSDC minting, see [`docs/LOCAL_E2E.md`](docs/LOCAL_E2E.md).

### Deploying to Arc Testnet

```bash
# Provision an RPC key — Alchemy / dRPC / QuickNode all work
export ARC_TESTNET_RPC_URL="https://arc-testnet.g.alchemy.com/v2/<your-key>"

# Generate or import a deployer key
yarn account:generate

# Top it up at the Circle faucet (10 USDC for gas)
# → https://faucet.circle.com/

# Deploy — uses Arc's system USDC at 0x3600...0000
yarn deploy --network arcTestnet

# Optional: verify on arcscan
yarn hardhat:verify --network arcTestnet <DEPLOYED_ADDRESS> 0x3600000000000000000000000000000000000000
```

## Env

```ini
# packages/nextjs/.env.local
NEXT_PUBLIC_ALCHEMY_API_KEY=...
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=...
KIMI_API_KEY=...                       # for the AI milestone splitter

# packages/hardhat/.env
ARC_TESTNET_RPC_URL=...
DEPLOYER_PRIVATE_KEY_ENCRYPTED=...

# packages/daemon/.env
ARC_TESTNET_RPC_URL=...
CHORD_ESCROW_ADDRESS=0x...             # from deploy step
CIRCLE_API_KEY=...                     # https://console.circle.com
CIRCLE_ENTITY_SECRET=...
CIRCLE_WALLET_ID=...
CHORD_DAEMON_NAME=specialist-react     # any friendly label
```

## Built for

[Agora Agents Hackathon](https://agora.thecanteenapp.com/) — Canteen × Circle. Submission deadline 2026-05-25.

Hackathon planning docs live in `docs/`:
- [`docs/PROTOCOL.md`](./docs/PROTOCOL.md) — Chord Protocol v0.1 public spec (on-chain interface + `agents.json` registry schema)
- [`docs/SUBMISSION.md`](./docs/SUBMISSION.md) — checklist tracking readiness against the four judging axes
- [`docs/DEMO.md`](./docs/DEMO.md) — 3-minute Loom storyboard
- [`docs/SEED.md`](./docs/SEED.md) — plan for seeding honest testnet volume (the Traction axis)
- [`docs/CIRCLE_QUICKSTART.md`](./docs/CIRCLE_QUICKSTART.md) — 30-min walkthrough to provision Circle Wallets credentials and create your first SCA on `ARC-TESTNET`
- [`docs/HANDOFF.md`](./docs/HANDOFF.md) — runbook from "fresh clone" to "submitted"
- [`docs/VERCEL.md`](./docs/VERCEL.md) — deploy the frontend to Vercel

## Inspiration

- **Contract design**: [Kite Milestone Escrow](https://github.com/reny1cao/kite-milestone-escrow) — same state machine, native KITE → USDC
- **Daemon architecture**: [Open Design (nexu-io)](https://github.com/nexu-io/open-design) — discover and spawn coding-agent CLIs, persist runs, stream stdout to a passive UI

## License

MIT
