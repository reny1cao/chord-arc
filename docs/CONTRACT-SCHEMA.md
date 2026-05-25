# Work Contract Schema (v0.2)

Source of truth for the rewritten contract-creation flow. All subagents in the refactor build against this spec.

## Why

`ChordEscrow.sol` caps each milestone's `description` at **500 bytes**. The legacy `buildContractDescription` joined Result/Authority/Proof/Acceptance/Failure into a single flat string and shoved it into one milestone description; all three built-in templates produce 655-738 bytes and revert on-chain. We split the model:

- **Off-chain**: a rich `WorkContract` JSON (R/A/P/A/F + metadata), content-addressed by `sha256`, served from `/api/contracts/[hash]`.
- **On-chain**: project-level `string contractURI` field + per-milestone short deliverable in `descriptions[i]`.

## Off-chain JSON schema

```ts
interface WorkContract {
  schema: "chord.contract.v1";       // version tag, always this string
  result: string;                    // what gets delivered (1-2000 chars)
  authority: string;                 // what the agent may/may-not do (1-2000)
  proof: string;                     // evidence required (1-2000)
  acceptance: string;                // pass criteria (1-2000)
  failure: string;                   // revision/reject rules (1-2000)
  createdAt: number;                 // unix ms, client-stamped
  // No id/hash field inside the JSON itself — hash is derived from the JSON bytes.
}
```

**Canonicalization for hashing**: `JSON.stringify(contract)` with keys in the declared order above. Same input bytes => same `sha256`. Hash is `sha256(utf8Bytes(canonicalJson))` as lowercase hex (no `0x` prefix in the URI).

## URI format

```
chord://<sha256-hex>
```

64 hex chars after the scheme. Total = `chord://` (8) + 64 = **72 bytes**. Always fits.

Stored in `Project.contractURI` (new on-chain field). Never embedded in milestone descriptions. Empty string means "no off-chain contract" (legacy path).

## On-chain change (ChordEscrow.sol)

```solidity
struct Project {
    address client;
    address pm;
    uint256 pmFeeBps;
    uint256 totalAmount;
    uint256 totalPaid;
    uint256 totalPmFees;
    bool active;
    string contractURI;          // NEW — empty string allowed
    Milestone[] milestones;
}

function createProject(
    string memory contractURI,   // NEW — first param; "" allowed for legacy
    address pm,
    uint256 pmFeeBps,
    string[] memory descriptions,
    uint256[] memory amounts,
    address[] memory initialAssignees
) external returns (uint256);

event ProjectCreated(
    uint256 indexed projectId,
    address indexed client,
    address pm,
    uint256 pmFeeBps,
    uint256 totalAmount,
    uint256 milestoneCount,
    string contractURI           // NEW
);
```

Validation: `require(bytes(contractURI).length <= 256, "URI too long")`. URIs are 72 bytes today; 256 leaves headroom for future schemes.

Milestone description rules unchanged (≤ 500 bytes). When `contractURI` is set, descriptions should be short deliverable summaries — recommend `<= 200 chars`.

## Storage API

`POST /api/contracts`
- Body: `WorkContract` JSON
- Validates schema + field lengths server-side
- Computes `sha256` over canonical bytes
- Writes to `<storage-dir>/<hash>.json` if not exists (idempotent)
- Returns: `{ uri: "chord://<hash>", hash: "<hash>", bytes: <n> }`
- Errors: 400 on schema fail, 413 if any field > 2000 chars

`GET /api/contracts/[hash]`
- 64-hex-char `[hash]`
- Returns the stored JSON with `Content-Type: application/json` and `Cache-Control: public, max-age=31536000, immutable` (content-addressed, never changes)
- 404 if not found

`<storage-dir>` defaults to `<repo-root>/.chord-contracts/` (gitignored). Override with `CHORD_CONTRACTS_DIR` env var.

## TypeScript types

Live in `packages/nextjs/types/contract.ts` — written in Wave 0, imported by all subagents.

## Consumer migration (`utils/workContracts.ts`)

- `buildWorkItems` gains optional `contract?: WorkContract` parameter
- If present, R/A/P/A/F come from the contract, milestone `description` is treated as the per-deliverable summary
- If absent, falls back to legacy `parseWorkContractSections` regex (existing projects)

## Daemon contract

Daemon (per `packages/daemon`):
1. On `MilestoneAssigned`, fetch `project.contractURI` (new field via updated ABI)
2. If non-empty: parse `chord://<hash>`, GET from configured Next.js base URL, validate `sha256(canonicalJson) === hash`
3. Write `BRIEF.md` with R/A/P/A/F sections from the contract + per-milestone deliverable
4. If empty: legacy flat-description path

Daemon needs `CHORD_CONTRACTS_BASE_URL` env (defaults to `http://localhost:3000`).

## Length budget summary

| Slot | Limit | Typical | Where enforced |
|---|---|---|---|
| `contractURI` (on-chain) | 256 bytes | 72 bytes | Solidity + API |
| `description[i]` (on-chain) | 500 bytes | ≤ 200 chars | Solidity + form |
| `WorkContract` field (off-chain) | 2000 chars each | 100-500 chars | API |

No path exceeds 500 bytes on-chain. Templates fit.
