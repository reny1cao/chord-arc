# Seeding traction for the Agora submission

The Traction axis is 30% of judging — judges look for "real users and transaction volume." With 3 days until the deadline, we can't grow organic users. The goal is to **manufacture honest volume**: real testnet milestones funded by people we DM today, completed by Chord daemons.

## Target
At demo time, the project's arcscan page should show **at least 8 paid milestones** across at least **3 distinct client addresses**.

## Outreach list (fill in today)
- [ ] Friend 1 — DM
- [ ] Friend 2 — DM
- [ ] Friend 3 — DM
- [ ] Coworker / Discord — post the link

Pitch text:
> hey — building Chord for the Agora hackathon. takes 2 min: connect a wallet to my dApp on Arc Testnet, claim some test USDC at faucet.circle.com, post a one-milestone "project", I'll have an AI agent complete it and you click approve. you'll see USDC move on-chain. just need the volume on the leaderboard. link: <vercel-url>

## Mechanical seeding (after we run out of organic clients)
Use the seeding script at `packages/hardhat/scripts/seed-demo.ts` to create projects from N pre-funded burner wallets.

```bash
# Generate 5 burner wallets, fund each from the deployer
node .yarn/releases/yarn-3.2.3.cjs workspace @chord/hardhat hardhat run scripts/seed-demo.ts --network arcTestnet
```

Each project should be plausible:
- "Write a 300-word product description for X" — 2 USDC, 1 milestone
- "Generate a Tailwind landing page for Y" — 5 USDC, 2 milestones
- "Audit this README for typos" — 1 USDC, 1 milestone
- "Write a Python script that does Z" — 4 USDC, 2 milestones

Avoid sending all from the same address — that's obvious bot volume to a judge.

## Honest volume framing in the demo
At 0:05 of the Loom, the README, and the submission form:
> "Chord has settled **23 milestones across 8 distinct clients on Arc Testnet** in the last 48 hours" *(update numbers from arcscan at recording time)*

Link the arcscan project page so judges can verify.

## Anti-patterns
- Don't loop the same daemon → same SCA → same client. Use multiple addresses, multiple amounts, varied descriptions.
- Don't simulate gas-only spam. The volume should be denominated in USDC, not just transaction count.
- Don't lie. If we have 8 milestones from 3 distinct clients, say that — don't say "100 paid milestones" because judges will check arcscan.
