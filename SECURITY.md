# Security notes

This is a hackathon prototype. The architecture is intentionally simple and these are the threat-model caveats that would need hardening before any production deployment.

## Smart contract

- `ChordEscrow.sol` uses OpenZeppelin `SafeERC20` + `ReentrancyGuard`. The state machine and event surface are covered by 56 tests in `packages/hardhat/test/ChordEscrow.ts`.
- `MIN_MILESTONE_AMOUNT = 1 USDC` and `MAX_PM_FEE_BPS = 2000` (20%) are hard guardrails.
- `emergencyReclaim` is gated behind a 28-day timeout and refuses to touch Submitted or Approved milestones.
- **Not audited.** Don't deploy to mainnet without one.

## Daemon — argv injection on the agent CLI

The daemon passes the milestone `description` field (set by whoever creates the project) into the spawned coding-agent CLI as an argv. The agent runner uses `child_process.spawn` (not `exec`) which avoids shell interpolation, but the CLI's own argument parser may still interpret tokens like `--dangerously-skip-permissions` if it accepts them. Mitigation:

- Spawn always with `stdio: ['ignore', 'pipe', 'pipe']` — no stdin pipe for the brief
- Pass the brief as a single positional argument after `-p` where possible
- The 20-min `timeoutMs` kills runaway spawns
- For real production: a per-CLI argument whitelist + treat the brief as opaque text written to a file the agent reads

## Daemon — agent deliverable trust

The agent writes arbitrary files into the milestone's working directory. The deliverable hash + URI go on-chain unverified by the client until they review. For the demo, this is by design (worker submits, client reviews, client approves). For production:

- Sandbox the agent's working dir (e.g. Docker with read-only mounts, no network)
- Don't follow symlinks when hashing
- Sign the deliverable hash with the SCA's key so the on-chain hash is verifiably from this worker

## Daemon — credentials

- `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET` together can move USDC out of every SCA the operator owns.
- `CHORD_LOCAL_PRIVATE_KEY` exposes whatever USDC is in that address.
- All three are in `.gitignore`'d `.env` files, never logged, never sent over the SSE bus.
- Don't paste them into Vercel — only the `NEXT_PUBLIC_*` vars belong there. Circle creds stay on the daemon machine.

## Frontend

- `deployedContracts.ts` is regenerated on every deploy. The contract ABI is the source of truth.
- The two-step approve flow asks for the exact total — no unbounded approve unless the user explicitly chooses it. (Current code uses exact-amount approve; an "infinite approve" mode is intentionally not offered.)
- WalletConnect / RainbowKit handle wallet auth; we never touch user keys.

## Responsible disclosure

If you find an issue, open an issue on https://github.com/reny1cao/chord-arc/issues or DM the maintainer. We'll respond fast during the hackathon window.
