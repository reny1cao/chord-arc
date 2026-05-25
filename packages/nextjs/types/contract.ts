/**
 * Work Contract types — single source of truth for the off-chain JSON
 * persisted at /api/contracts and referenced on-chain via Project.contractURI.
 *
 * Spec: docs/CONTRACT-SCHEMA.md
 */

export const WORK_CONTRACT_SCHEMA = "chord.contract.v1" as const;

export const WORK_CONTRACT_FIELD_MAX = 2000;
export const MILESTONE_DESCRIPTION_MAX = 500;
export const MILESTONE_DESCRIPTION_RECOMMENDED = 200;
export const CONTRACT_URI_MAX = 256;

/**
 * Persisted, content-addressed contract. Stored as canonical JSON; hash is
 * sha256 over the canonical bytes. Field order MUST match the interface for
 * canonicalization to be stable.
 */
export interface WorkContract {
  schema: typeof WORK_CONTRACT_SCHEMA;
  result: string;
  authority: string;
  proof: string;
  acceptance: string;
  failure: string;
  createdAt: number;
}

/**
 * In-progress form state. Strings only; no schema tag, no timestamp.
 * Convert to WorkContract via toWorkContract() before persisting.
 */
export interface WorkContractDraft {
  result: string;
  authority: string;
  proof: string;
  acceptance: string;
  failure: string;
}

export const EMPTY_WORK_CONTRACT_DRAFT: WorkContractDraft = {
  result: "",
  authority: "",
  proof: "",
  acceptance: "",
  failure: "",
};

export const WORK_CONTRACT_FIELDS = [
  "result",
  "authority",
  "proof",
  "acceptance",
  "failure",
] as const satisfies readonly (keyof WorkContractDraft)[];

export type WorkContractField = (typeof WORK_CONTRACT_FIELDS)[number];

export interface ContractStorageResponse {
  uri: `chord://${string}`;
  hash: string;
  bytes: number;
}

export interface ValidationIssue {
  field: WorkContractField | "schema";
  message: string;
}

export function toWorkContract(draft: WorkContractDraft, now = Date.now()): WorkContract {
  return {
    schema: WORK_CONTRACT_SCHEMA,
    result: draft.result.trim(),
    authority: draft.authority.trim(),
    proof: draft.proof.trim(),
    acceptance: draft.acceptance.trim(),
    failure: draft.failure.trim(),
    createdAt: now,
  };
}

export function validateWorkContract(contract: WorkContract): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (contract.schema !== WORK_CONTRACT_SCHEMA) {
    issues.push({ field: "schema", message: `schema must be "${WORK_CONTRACT_SCHEMA}"` });
  }
  for (const field of WORK_CONTRACT_FIELDS) {
    const value = contract[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      issues.push({ field, message: `${field} is required` });
    } else if (value.length > WORK_CONTRACT_FIELD_MAX) {
      issues.push({
        field,
        message: `${field} exceeds ${WORK_CONTRACT_FIELD_MAX} chars (${value.length})`,
      });
    }
  }
  return issues;
}

/**
 * Deterministic JSON for hashing. Keys are emitted in interface order so the
 * same logical contract always produces the same bytes -> same sha256.
 */
export function canonicalize(contract: WorkContract): string {
  return JSON.stringify({
    schema: contract.schema,
    result: contract.result,
    authority: contract.authority,
    proof: contract.proof,
    acceptance: contract.acceptance,
    failure: contract.failure,
    createdAt: contract.createdAt,
  });
}

const CONTRACT_URI_REGEX = /^chord:\/\/([0-9a-f]{64})$/;

export function buildContractURI(hash: string): `chord://${string}` {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("hash must be 64 lowercase hex chars");
  return `chord://${hash}`;
}

export function parseContractURI(uri: string): { hash: string } | null {
  const match = CONTRACT_URI_REGEX.exec(uri);
  if (!match) return null;
  return { hash: match[1] };
}

export function isContractURI(value: string): value is `chord://${string}` {
  return CONTRACT_URI_REGEX.test(value);
}
