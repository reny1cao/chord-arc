# Final user actions — what only you can do

The codebase is feature-complete and locally tested. The only remaining work needs credentials that can't be provisioned from this terminal. This doc is your runbook to the finish line.

## What's already done

| | |
|---|---|
| Contracts | `ChordEscrow.sol` written + 56 passing tests |
| Daemon | Full lifecycle wired, local-key signing mode for credential-free testing, end-to-end smoke test against local Hardhat |
| Frontend | Two-step USDC approve+create flow, Chord branding, production build verified |
| CI | GitHub Actions runs compile + tests + types + smoke + build on every PR |
| Docs | `docs/DEMO.md`, `docs/SUBMISSION.md`, `docs/SEED.md`, `docs/CIRCLE_QUICKSTART.md`, `docs/VERCEL.md` |

## Your remaining work, in order

### 1 — Verify everything still passes locally (5 min)

```bash
yarn install
yarn hardhat:test            # → 56 passing
yarn daemon:check-types      # → exit 0
yarn next:check-types        # → exit 0
yarn next:build              # → builds clean
yarn workspace @chord/daemon smoke   # → full local lifecycle, no credentials
```

If anything red: open an issue, fix or DM me before continuing.

### 2 — Get Arc Testnet RPC (5 min)

→ https://dashboard.alchemy.com/apps  ·  Create app → "Arc Testnet" → copy URL  
Or → https://drpc.org  ·  Free tier, same flow.

```bash
# packages/hardhat/.env
ARC_TESTNET_RPC_URL=https://arc-testnet.g.alchemy.com/v2/YOUR_KEY

# packages/daemon/.env  (same key, same line)
ARC_TESTNET_RPC_URL=https://arc-testnet.g.alchemy.com/v2/YOUR_KEY
```

### 3 — Provision a deployer wallet on Arc Testnet (5 min)

```bash
yarn account:generate          # writes encrypted PK to packages/hardhat/.env
yarn account                   # shows the public address
```

Drip 10 USDC for gas: → https://faucet.circle.com  ·  Pick **Arc Testnet** · paste address.

### 4 — Deploy ChordEscrow to Arc Testnet (1 min)

```bash
yarn deploy --network arcTestnet
```

This also regenerates `packages/nextjs/contracts/deployedContracts.ts` with the real address. Copy the deployed address and put it in `packages/daemon/.env`:

```bash
CHORD_ESCROW_ADDRESS=0x...   # printed by deploy
```

Verify on arcscan: https://testnet.arcscan.app/address/&lt;address&gt;

### 5 — Provision Circle Wallets (15 min, one-time)

Follow `docs/CIRCLE_QUICKSTART.md` step-by-step. End state:

```bash
# packages/daemon/.env
CIRCLE_API_KEY=TEST_API_KEY:...
CIRCLE_ENTITY_SECRET=<64-char hex>
```

### 6 — Create your SCAs (5 min)

You need **one SCA per agent persona**, plus optionally one PM agent SCA if you want autonomous routing in the demo.

```bash
# Worker SCAs
yarn workspace @chord/daemon bootstrap-sca --name claude-react
yarn workspace @chord/daemon bootstrap-sca --name codex-content
yarn workspace @chord/daemon bootstrap-sca --name gemini-design

# Optional but recommended: a PM routing agent
yarn workspace @chord/daemon bootstrap-sca --name chord-pm
```

Each bootstrap prints a paste-ready env block. Save the worker wallet IDs (you'll start one daemon per worker); save the PM wallet ID separately. Drip 10 USDC from the Circle faucet to every printed `ARC_SCA_ADDRESS`.

Then update `packages/daemon/agents.json` — replace the placeholder `0xAA…` / `0xBB…` / `0xCC…` addresses with the real SCA addresses of your worker daemons. Commit + push so the leaderboard and PM agent can fetch it from `raw.githubusercontent.com`.

### 7 — First end-to-end run on Arc (10 min)

Five terminals (one per worker daemon, one for PM, one for frontend):

```bash
# T1 — worker daemon 1
CIRCLE_WALLET_ID=<claude-react-wallet-id> CHORD_DAEMON_NAME=claude-react yarn daemon

# T2 — worker daemon 2
CIRCLE_WALLET_ID=<codex-content-wallet-id> CHORD_DAEMON_NAME=codex-content yarn daemon

# T3 — worker daemon 3
CIRCLE_WALLET_ID=<gemini-design-wallet-id> CHORD_DAEMON_NAME=gemini-design yarn daemon

# T4 — PM agent (autonomous router)
CIRCLE_WALLET_ID=<chord-pm-wallet-id> CHORD_DAEMON_NAME=chord-pm KIMI_API_KEY=<key> \
  yarn workspace @chord/daemon pm

# T5 — frontend
yarn start
```

Open http://localhost:3000 → connect wallet → post a 3-milestone project, set PM to your `chord-pm` SCA address, leave assignees blank → fund + create. PM agent will see `ProjectCreated`, route each milestone to the best worker via Kimi, and assign on chain. Worker daemons see their `MilestoneAssigned`, accept, spawn their CLI, submit. Approve each milestone in the UI. USDC flows to every wallet — workers, PM, all in one go.

If you have Claude Code on `PATH`, the daemons will use it automatically. Otherwise they fall back to whichever CLI is discoverable. For the demo, install Claude Code or symlink `packages/daemon/scripts/fake-agent.sh` to a name on PATH like `chordfake`.

### 8 — Seed traction (30 min)

```bash
CHORD_ESCROW_ADDRESS=0x... ARC_SCA_ADDRESSES=0xa,0xb,0xc \
  yarn workspace @chord/hardhat hardhat run scripts/seed-demo.ts --network arcTestnet
```

Then DM friends per `docs/SEED.md` — goal is 8 milestones across 3 distinct clients before recording.

### 9 — Deploy to Vercel (5 min)

```bash
# From repo root
cd packages/nextjs
vercel link              # follow prompts
vercel env add NEXT_PUBLIC_ALCHEMY_API_KEY production
vercel env add NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID production
vercel env add KIMI_API_KEY production
vercel --prod
```

Full walkthrough: `docs/VERCEL.md`.

### 10 — Record the Loom (45 min)

Follow the storyboard in `docs/DEMO.md`. Two takes. Keep under 2:45. Upload, copy URL.

### 11 — Submit (10 min)

Form: → https://luma  ·  passphrase `SITEx1313`

Fill in:
- Project name: **Chord**
- One-line: *"Autonomous AI agents pick up on-chain milestones and get paid in USDC on Circle Arc."*
- GitHub: https://github.com/reny1cao/chord-arc
- Live URL: your Vercel domain
- Demo: your Loom URL
- arcscan: https://testnet.arcscan.app/address/&lt;ChordEscrow address&gt;
- Traction: current numbers from arcscan ("N milestones, M USDC settled, K SCAs paid")

Total wall-clock for steps 2 → 11, if no surprises: **~2.5 hours**.
