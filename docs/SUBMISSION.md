# Agora Agents Hackathon — submission checklist

Deadline: **2026-05-25**. Today: 2026-05-22. Asynchronous review, multiple submissions allowed.

## Required assets

| Asset | Where | Status |
|---|---|---|
| Public GitHub repo | https://github.com/reny1cao/chord-arc | ✅ live |
| README with pitch + run instructions | `README.md` | ✅ first cut shipped |
| 3-min Loom / YouTube / Vimeo demo | TBD | ⏳ outline in `docs/DEMO.md` |
| Live product link | Vercel deployment | ⏳ D2 |
| arcscan link showing deployed contract + tx history | TBD | ⏳ after D1 deploy |
| Devfolio / hackathon submission form | https://luma — passphrase `SITEx1313` | ⏳ |

## Judging — track readiness per axis

### Agentic Sophistication — 30% (target: 27/30)
- [x] Architecture: daemon scans PATH for any coding-agent CLI (Claude Code / Codex / Gemini / Cursor / OpenCode / Qwen / Kimi)
- [x] On-chain trigger: `MilestoneAssigned` event spawns the agent — not a button click
- [ ] Autonomy proof: at least one full loop (assign → accept → spawn → submit → approve → paid) shown end-to-end in the demo
- [ ] Three agents working in parallel on different milestones in the same project (visual differentiator)
- [ ] Optional: a PM daemon that auto-assigns milestones to whichever agent is least busy

### Traction — 30% (target: 18/30, our biggest gap)
- [ ] At least 5 real testnet milestones funded + completed by demo time. Plan: DM 3 friends today, run a "post your gig get paid 0.5 USDC" promo.
- [ ] arcscan project page link in README + submission (visible on-chain volume)
- [ ] A 1-line tracker in README: "23 milestones · 47 USDC settled · 8 SCAs paid"
- [ ] (Stretch) Discord channel or X thread with at least 1 outside user reporting they tried it

### Circle Tools — 20% (target: 18/20)
- [x] USDC as escrow asset on Arc Testnet
- [x] Arc Testnet (chain 5042002) as deployment target
- [x] Circle Programmable Wallets — Dev-Controlled SCAs via Wallets API, one per daemon
- [ ] (Stretch) CCTP v2 withdraw button — "send your USDC to Base" (advisor says cut from MVP; only add if D2 is green by Wednesday 5pm)
- [x] USDC is gas on Arc — no separate native token; daemon never has to manage two assets

### Innovation — 20% (target: 18/20)
- [x] Concept that hasn't been shipped: CLI coding agents as paid on-chain workers
- [x] Daemon architecture borrowed from Open Design but applied to a brand-new vertical (work-for-pay, not design generation)
- [ ] Demo must lead with the "no human in the loop" frame — judges have backgrounds at Solana / Coinbase / Circle / Protocol Labs and need a one-line hook

## Sponsor tracks (RFBs) — none literal-match
Agora's 6 problem areas are: perpetuals trading, prediction markets, prediction-market verticals, adaptive portfolio, cross-platform arbitrage, social trading. Chord fits none of these directly. **We pitch as novel category — "agent-to-agent payment rails for work."**

## Risk list (sorted by likelihood × impact)
1. **Traction shortfall** — high likelihood, big impact. Mitigation: today, DM 3 people who'll seed real milestones; the seeding script lives at `docs/SEED.md`.
2. **Arc Testnet RPC instability** — medium. Mitigation: have an Alchemy key AND a dRPC key, fall back per env. Pre-cache demo screenshots in case live demo fails on recording day.
3. **Circle Wallets sandbox approval lag** — medium. Mitigation: onboard tonight (D0 evening task), not Monday.
4. **Demo Vercel cold-start hits the 3-min mark** — low. Mitigation: warm the deployment 5 minutes before recording.
5. **Judges discount the project because it doesn't match an RFB** — medium. Mitigation: lead the README + the Loom with "novel category" framing.

## Day-by-day plan
- **D0 (tonight)** — ✅ contract, scaffold, repo, README. Provision Circle Wallets credentials. Get Arc RPC key.
- **D1 (Saturday)** — deploy to Arc Testnet, wire daemon end-to-end, frontend approve flow, FIRST PAID MILESTONE on testnet.
- **D2 (Sunday)** — seed traction (≥5 milestones), record demo, deploy to Vercel, polish README, submit form.
- **D2 PM** — backup recording, double-check submission, submit to Agora portal.
- **Monday** — if anything bounces, fix and re-submit (multiple submissions allowed).
