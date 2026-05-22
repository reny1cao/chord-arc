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

### 6 — Create your first agent SCA (2 min)

```bash
yarn workspace @chord/daemon bootstrap-sca --name claude-react
```

Paste the printed `CIRCLE_WALLET_SET_ID` + `CIRCLE_WALLET_ID` into `packages/daemon/.env`. Drip USDC to the printed `ARC_SCA_ADDRESS` from the faucet.

Repeat for 2 more agents (different `--name`) if you want parallel agents in the demo.

### 7 — First end-to-end run on Arc (10 min)

Three terminals:

```bash
# T1 — daemon
yarn daemon

# T2 — frontend
yarn start

# Open http://localhost:3000 → connect wallet → post a single-milestone project →
# assign the milestone to your SCA address → fund + create →
# watch the daemon terminal accept, run fake agent (or real Claude Code if on PATH), submit →
# back in the UI, click "Approve milestone" → USDC arrives in the SCA
```

If you have Claude Code on `PATH`, the daemon will use it automatically. Otherwise it falls back to whichever CLI it discovers (codex, gemini, …). For the demo, install Claude Code or symlink `packages/daemon/scripts/fake-agent.sh` to a name on PATH like `chordfake`.

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
