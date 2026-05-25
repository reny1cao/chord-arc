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

### Agentic Sophistication — 30% (target: 28/30 after D2.5)
- [x] Architecture: daemon scans PATH for any coding-agent CLI (Claude Code / Codex / Gemini / Cursor / OpenCode / Qwen / Kimi)
- [x] On-chain trigger: `MilestoneAssigned` event spawns the agent — not a button click
- [x] D2.5 — **Reference PM Agent** that uses Kimi to autonomously route each milestone to the best registered worker. Recursive payment in USDC.
- [ ] Autonomy proof: at least one full loop (PM assigns → worker accepts → spawns → submits → client approves → paid) shown end-to-end in the demo
- [ ] Three workers in parallel on different milestones in the same project (visual differentiator — multiple daemon terminals tiled in demo)

### Traction — 30% (target: 22/30 after D2.5)
- [x] D2.5 — `/leaderboard` page indexes live arcscan data, public discoverable
- [x] D2.5 — `/try` page with burner-wallet faucet flow: anyone can post a 1-USDC test milestone without bringing their own wallet
- [ ] At least 5 real testnet milestones funded by ≥3 distinct addresses before recording
- [ ] arcscan project page link in README + submission
- [ ] Live counter on the home page using leaderboard data: "Chord ↻ N milestones · M USDC settled · K agents earning"
- [ ] DM ≥3 friends with the `/try` URL today

### Circle Tools — 20% (target: 18/20)
- [x] USDC as escrow asset on Arc Testnet
- [x] Arc Testnet (chain 5042002) as deployment target, ChordEscrow live at `0x331994d88f069538532a8de0dc08e938eb9af6b5`
- [x] Circle Programmable Wallets — Dev-Controlled SCAs via Wallets API, one per daemon (incl. PM agent)
- [x] USDC is gas on Arc — no separate native token; daemon never has to manage two assets
- [ ] Demo names every Circle product used out loud (judges are listening for this)

### Innovation — 20% (target: 20/20 after D2.5)
- [x] Concept that hasn't been shipped: CLI coding agents as paid on-chain workers
- [x] D2.5 — **Chord Protocol v0.1** published at `docs/PROTOCOL.md` — Chord is a *protocol*, not just an app. Anyone can write a worker in any language.
- [x] D2.5 — Recursive agent coordination: PM Agent gets paid in USDC for routing work to other agents
- [x] Daemon architecture borrowed from Open Design but applied to a brand-new vertical (work-for-pay, not design generation)
- [ ] Demo opens with the protocol framing — "this is an open standard, the daemon is just one reference impl"

### Score projection
- Ceiling without D2.5 stretches: ~67/100
- Ceiling with PM Agent + Leaderboard + Faucet + Protocol spec: **~85/100**

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
