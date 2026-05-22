# Vercel deploy — Chord frontend

The Next.js app lives in `packages/nextjs/` of this yarn-workspace monorepo. Vercel needs the **Root Directory** pointed at that subfolder; everything else auto-detects.

## First-time link

Run from `packages/nextjs/` (not the repo root) so Vercel picks up the right manifest:

```bash
cd packages/nextjs
yarn vercel:login           # one-time: opens browser for OAuth
yarn vercel                 # runs `vercel` and prompts for project link
```

When prompted by `vercel link`:

- **Set up and deploy?** Yes
- **Which scope?** Your personal account or team
- **Link to existing project?** No (first time)
- **Project name?** `chord-arc` (or whatever you prefer)
- **In which directory is your code located?** `./` — you are already inside `packages/nextjs/`
- **Want to modify these settings?** No — Next.js framework auto-detects, install/build commands come from `packages/nextjs/vercel.json` (`yarn install`) and `package.json` (`next build`).

This creates `.vercel/project.json` inside `packages/nextjs/` — gitignored.

## Required environment variables

Add these in the Vercel dashboard *or* via CLI. CLI form:

```bash
cd packages/nextjs
vercel env add NEXT_PUBLIC_ALCHEMY_API_KEY          # used by wagmi for Arc Testnet RPC
vercel env add NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID # used by RainbowKit for WalletConnect
vercel env add KIMI_API_KEY                          # server-side, used by /api/ai/split
```

For each one Vercel asks which environments to apply to — pick **Production, Preview, Development** (space-bar to select all three).

`NEXT_PUBLIC_ALCHEMY_API_KEY` and `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` both have working public defaults baked into `scaffold.config.ts`, so the app still functions if they are missing — but you should override them with your own keys for production rate limits.

`KIMI_API_KEY` is only required if you want the AI Milestone Splitter to call Moonshot. Without it, `/api/ai/split` returns a 400 and the UI shows a manual-entry fallback.

## Deploy

```bash
cd packages/nextjs
yarn vercel              # preview deployment, strict (fails on type errors)
yarn vercel --prod       # production
```

Or from the repo root the wrapper scripts work too:

```bash
yarn vercel              # = yarn workspace @chord/nextjs vercel
yarn vercel:yolo         # adds NEXT_PUBLIC_IGNORE_BUILD_ERROR=true — hackathon escape hatch
```

## Notes

- The `deployedContracts.ts` file ships with a zero-address stub. The build succeeds against it. To wire a real address, run `yarn deploy --network arcTestnet` after deploying the escrow; that regenerates the file and the next Vercel build will pick up the change.
- Framework preset: **Next.js** (Vercel auto-detects from `package.json`).
- Node: 20.x or newer (set by `engines.node` in the root `package.json`).
