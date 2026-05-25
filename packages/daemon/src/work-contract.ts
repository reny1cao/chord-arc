/**
 * Off-chain WorkContract fetcher + verifier — wave-2 daemon side.
 *
 * Mirror of the shape in `packages/nextjs/types/contract.ts`. Reimplemented
 * here on purpose: the daemon is its own workspace and cannot import from
 * `@chord/nextjs`. Keep the canonical key order in lockstep with the nextjs
 * file — `schema, result, authority, proof, acceptance, failure, createdAt` —
 * or sha256 verification will fail.
 *
 * Spec: docs/CONTRACT-SCHEMA.md
 */
import { createHash } from "node:crypto";

export const WORK_CONTRACT_SCHEMA = "chord.contract.v1" as const;

export interface WorkContract {
  schema: typeof WORK_CONTRACT_SCHEMA;
  result: string;
  authority: string;
  proof: string;
  acceptance: string;
  failure: string;
  createdAt: number;
}

const HASH_RE = /^[0-9a-f]{64}$/;
const URI_RE = /^chord:\/\/([0-9a-f]{64})$/;

/** Parse a `chord://<hash>` URI. Returns the hex hash or null on malformed input. */
export function parseContractURI(uri: string): { hash: string } | null {
  const match = URI_RE.exec(uri);
  if (!match) return null;
  return { hash: match[1] };
}

/**
 * Deterministic JSON for hashing. Keys are emitted in the spec-declared order
 * so the same logical contract always produces the same bytes, hence the same
 * sha256. MUST stay in sync with `types/contract.ts:canonicalize` in nextjs.
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

export function hashContract(contract: WorkContract): string {
  return createHash("sha256").update(canonicalize(contract), "utf8").digest("hex");
}

/** Minimal shape check before we hash — rejects payloads that obviously aren't a v1 contract. */
function isWorkContractShape(value: unknown): value is WorkContract {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.schema === WORK_CONTRACT_SCHEMA &&
    typeof v.result === "string" &&
    typeof v.authority === "string" &&
    typeof v.proof === "string" &&
    typeof v.acceptance === "string" &&
    typeof v.failure === "string" &&
    typeof v.createdAt === "number"
  );
}

export interface FetchContractOpts {
  /** `chord://<hash>` URI from `Project.contractURI`. */
  uri: string;
  /** Base URL of the Next.js server hosting `/api/contracts/[hash]`. No trailing slash required. */
  baseUrl: string;
  /** Override fetch — useful for unit/smoke tests. Defaults to global `fetch` (Node 20+). */
  fetchImpl?: typeof fetch;
}

export interface FetchContractResult {
  contract: WorkContract;
  hash: string;
  /** Number of bytes in the canonical JSON. */
  bytes: number;
}

/**
 * Fetch a stored WorkContract by URI and verify its content hash.
 *
 * Security: we MUST hash `canonicalize(parsedJson)` — NOT the raw HTTP response
 * bytes. The route serializes via `NextResponse.json`, which may differ from
 * the canonical form once any middleware (compression, key reordering, etc.)
 * is added. Verifying the canonical re-serialization is the only thing that
 * guarantees the hash actually matches what the writer signed off on.
 *
 * Throws on:
 *   - malformed URI
 *   - HTTP non-2xx
 *   - response that's not JSON or doesn't match the WorkContract shape
 *   - sha256 mismatch (someone served a different payload at that hash)
 */
export async function fetchAndVerifyContract(opts: FetchContractOpts): Promise<FetchContractResult> {
  const parsed = parseContractURI(opts.uri);
  if (!parsed) throw new Error(`invalid contract URI: ${opts.uri}`);
  if (!HASH_RE.test(parsed.hash)) throw new Error(`invalid hash in URI: ${parsed.hash}`);

  const url = `${opts.baseUrl.replace(/\/+$/, "")}/api/contracts/${parsed.hash}`;
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`contract fetch ${url} failed: HTTP ${res.status} ${res.statusText}`);
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`contract fetch ${url}: response is not valid JSON (${msg})`);
  }
  if (!isWorkContractShape(payload)) {
    throw new Error(`contract fetch ${url}: payload does not match WorkContract shape`);
  }
  const canonical = canonicalize(payload);
  const computed = createHash("sha256").update(canonical, "utf8").digest("hex");
  if (computed !== parsed.hash) {
    throw new Error(
      `contract fetch ${url}: sha256 mismatch — expected ${parsed.hash}, got ${computed}`,
    );
  }
  return {
    contract: payload,
    hash: computed,
    bytes: Buffer.byteLength(canonical, "utf8"),
  };
}
