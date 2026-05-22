# Chord — 3-minute Loom outline

The Agora hackathon submission requires a ≤3 minute demo video. This is the storyboard.

Recording target: **2:45 max** (judges fatigue at 3:00). Shoot at 1440p. Use the Loom built-in webcam bubble at top-right.

## Cold open (0:00 – 0:15)
- **Shot**: terminal with `claude` (or `codex`) banner on the left, browser with arcscan on the right
- **VO**: "This is Chord. A Claude Code daemon is listening on Circle Arc. In the next two minutes, it's going to accept a milestone, write code, and get paid in USDC — with no human involvement."
- **Cue**: blank canvas, both windows visible, ready to act

## Beat 1 — Brief → milestones (0:15 – 0:45)
- **Shot**: Chord web UI (Vercel deploy URL)
- **Action**: client types a brief into the AI Milestone Splitter — *"Build a Next.js landing page for a privacy-focused note app, 3 milestones, $30 budget"*
- **Cue**: streaming JSONL fills the milestone list — *Design hero · Write feature grid · Add CTA + footer*, with USDC amounts summing to 30
- **VO**: "The brief becomes three milestones with acceptance criteria and USDC amounts. Kimi is doing the splitting."

## Beat 2 — Fund + assign (0:45 – 1:15)
- **Shot**: same UI, "Create project" flow
- **Action**: connect wallet → click *Approve USDC* (one tx) → click *Create project* (second tx) → assign each milestone to a different SCA address
- **Cue**: confirmation modal shows the three SCAs by friendly name ("claude-daemon-react", "claude-daemon-design", "codex-daemon-content")
- **VO**: "Two-tx funding flow — first approve, then create. The escrow holds 30 USDC. Each milestone routes to a different agent's smart contract account."

## Beat 3 — Agent picks it up (1:15 – 2:00) — THE MONEY SHOT
- **Shot**: split screen. Left = daemon terminal, right = arcscan
- **Action**: 
  - `[chord] MilestoneAssigned matched our SCA 0xabc…`
  - `[chord] acceptMilestone tx → 0xfe9…` *(arcscan flashes the green check)*
  - `[chord] spawning: claude -p "Design hero..."` *(Claude Code's output starts streaming)*
  - Claude writes `out/hero.tsx` and exits
  - `[chord] deliverable sha256: 7c4a…  submitting`
  - `[chord] submitMilestone tx → 0x4b2…`
- **VO**: "The daemon saw the event. It signed acceptance through Circle's Wallets API. Then it spawned Claude Code locally, which wrote real React code. The deliverable hash went on-chain. Total elapsed: sub-second to settle each tx — that's Arc."

## Beat 4 — Client approves, USDC arrives (2:00 – 2:30)
- **Shot**: web UI showing the submitted milestone with the deliverable preview
- **Action**: client clicks *Approve milestone* → tx → arcscan flashes
- **Cue**: SCA's USDC balance on arcscan ticks up by the milestone amount
- **VO**: "Approve. Done. USDC lands in the agent's wallet on Arc. No bridge. No fiat. No invoice. From posted brief to paid worker, end to end, on chain."

## Outro (2:30 – 2:45)
- **Shot**: GitHub README header, repo URL visible
- **VO**: "Chord. Open source. Built for the Agora hackathon. Try the daemon with whatever coding agent you've got installed."
- **Cue**: `github.com/reny1cao/chord-arc`

## Pre-recording checklist
- [ ] At least 5 testnet milestones live on Arc with non-trivial volume (see `docs/SEED.md`)
- [ ] Daemon has been smoke-tested end-to-end on Arc Testnet at least twice
- [ ] arcscan loads fast (cache it 30s before recording)
- [ ] Tabs ordered: brief UI, daemon terminal, arcscan, GitHub
- [ ] Mic gain set; webcam framed; lighting checked
- [ ] Two full takes scheduled — first as a dry run, second is the keeper
- [ ] If anything looks slow on testnet: pre-record the slow segments and cross-cut

## What the judges will scan for
- **Agentic Sophistication (30%)** — Beat 3 carries this. The agent is REAL Claude Code, spawned by an on-chain event, signing real txs. Linger on the terminal.
- **Traction (30%)** — call out the arcscan volume page at the start ("we already have 14 paid milestones in the last 48 hours…")
- **Circle Tools (20%)** — name them: "USDC on Arc, Dev-Controlled SCAs, Wallets API, native gas in USDC"
- **Innovation (20%)** — the one-liner at the cold open does the work: "no human involvement"
