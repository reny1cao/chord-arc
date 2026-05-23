/**
 * agents.json capability registry loader (PROTOCOL §3.1).
 *
 * Wiring contract:
 *   const registry = await loadAgentsRegistry(config.agentsJsonUrl);
 *   const eligible = filterEligible(registry, { amount, inFlight });
 *
 * Sources supported:
 *   - `https://…` / `http://…`           → global fetch
 *   - `file:///abs/path` / `/abs/path`   → fs.readFile
 *   - any other string                   → resolved relative to the daemon
 *                                           package root (i.e. `agents.json`)
 *
 * Validation is hand-rolled (no zod dep) per PROTOCOL §3.2. Required fields:
 * address, name, description, tags (string[]), minPayoutUsdc (number). All
 * other fields are normalized into typed defaults so the router code can stop
 * worrying about undefined.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, isAddress, type Address } from "viem";

export type AgentRuntime =
  | "claude-code"
  | "codex"
  | "gemini"
  | "cursor"
  | "opencode"
  | "human"
  | "other";

export interface RegistryAgent {
  address: Address;
  name: string;
  description: string;
  tags: string[];
  minPayoutUsdc: number;
  maxConcurrent: number;
  agentRuntime: AgentRuntime | "unknown";
  online: boolean;
  endpoint: string | null;
  verifiedBy: string[] | null;
}

export interface AgentsRegistry {
  version: string;
  sourceUrl: string;
  agents: RegistryAgent[];
  fetchedAt: number;
}

const KNOWN_RUNTIMES = new Set<AgentRuntime>([
  "claude-code",
  "codex",
  "gemini",
  "cursor",
  "opencode",
  "human",
  "other",
]);

// PROTOCOL §3.2 — `tags` is "lowercase free-form tokens". Coerce here so a
// router that lowercases a milestone description still matches.
function normalizeTag(t: unknown): string | null {
  if (typeof t !== "string") return null;
  const trimmed = t.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateAgent(raw: unknown, index: number): RegistryAgent {
  if (!isRecord(raw)) throw new Error(`agents[${index}] must be an object`);

  const addr = raw.address;
  // strict:false skips EIP-55 checksum enforcement — registries SHOULD ship
  // checksummed addresses but the demo registry uses easy-to-read placeholders
  // like `0xAAaA…` whose case won't match a real checksum. We `getAddress()`
  // below to normalize, so downstream comparisons stay consistent.
  if (typeof addr !== "string" || !isAddress(addr, { strict: false })) {
    throw new Error(`agents[${index}].address must be a 20-byte hex address`);
  }
  const name = raw.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error(`agents[${index}].name is required`);
  }
  const description = raw.description;
  if (typeof description !== "string") {
    throw new Error(`agents[${index}].description must be a string`);
  }
  const tagsArr = raw.tags;
  if (!Array.isArray(tagsArr)) {
    throw new Error(`agents[${index}].tags must be an array of strings`);
  }
  const tags = tagsArr.map(normalizeTag).filter((t): t is string => t !== null);

  const minPayoutUsdc = raw.minPayoutUsdc;
  if (typeof minPayoutUsdc !== "number" || !Number.isFinite(minPayoutUsdc) || minPayoutUsdc < 0) {
    throw new Error(`agents[${index}].minPayoutUsdc must be a non-negative number`);
  }

  const maxConcurrentRaw = raw.maxConcurrent;
  const maxConcurrent =
    typeof maxConcurrentRaw === "number" && Number.isFinite(maxConcurrentRaw) && maxConcurrentRaw > 0
      ? Math.floor(maxConcurrentRaw)
      : 1;

  const runtimeRaw = raw.agentRuntime;
  const agentRuntime: AgentRuntime | "unknown" =
    typeof runtimeRaw === "string" && KNOWN_RUNTIMES.has(runtimeRaw as AgentRuntime)
      ? (runtimeRaw as AgentRuntime)
      : "unknown";

  const online = raw.online === undefined ? true : Boolean(raw.online);
  const endpoint = typeof raw.endpoint === "string" && raw.endpoint.length > 0 ? raw.endpoint : null;

  const verifiedBy = Array.isArray(raw.verifiedBy)
    ? raw.verifiedBy.filter((v): v is string => typeof v === "string")
    : null;

  return {
    address: getAddress(addr),
    name: name.trim(),
    description: description.trim(),
    tags,
    minPayoutUsdc,
    maxConcurrent,
    agentRuntime,
    online,
    endpoint,
    verifiedBy,
  };
}

function validateRegistry(raw: unknown, sourceUrl: string): AgentsRegistry {
  if (!isRecord(raw)) throw new Error("agents.json root must be an object");
  const version = typeof raw.version === "string" ? raw.version : "0.1";
  const agentsRaw = raw.agents;
  if (!Array.isArray(agentsRaw)) throw new Error("agents.json `agents` must be an array");

  const agents = agentsRaw.map((a, i) => validateAgent(a, i));

  // Detect duplicate addresses — a registry shouldn't list the same SCA twice.
  const seen = new Set<string>();
  for (const a of agents) {
    const key = a.address.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate agent address in registry: ${a.address}`);
    seen.add(key);
  }

  return { version, sourceUrl, agents, fetchedAt: Date.now() };
}

/**
 * Resolve `source` into a (kind, location) pair so the loader can route it.
 *
 * Falls back to package-relative paths so the demo registry shipped at
 * `packages/daemon/agents.json` works without any URL.
 */
function resolveSource(source: string): { kind: "http" | "file"; location: string } {
  if (/^https?:\/\//i.test(source)) return { kind: "http", location: source };
  if (source.startsWith("file://")) {
    return { kind: "file", location: fileURLToPath(source) };
  }
  if (path.isAbsolute(source)) return { kind: "file", location: source };

  // Resolve relative to the daemon package root (this file's parent's parent).
  // import.meta.url is .../packages/daemon/src/agents-registry.ts so
  // ../<source> lands in packages/daemon/<source>.
  const here = fileURLToPath(import.meta.url);
  const pkgRoot = path.resolve(path.dirname(here), "..");
  return { kind: "file", location: path.resolve(pkgRoot, source) };
}

/**
 * Fetch + validate the registry. Throws on network failure, malformed JSON, or
 * any schema violation — callers should let it crash at boot so a bad registry
 * never silently routes assignments to a hallucinated address.
 */
export async function loadAgentsRegistry(source: string): Promise<AgentsRegistry> {
  const { kind, location } = resolveSource(source);

  let text: string;
  if (kind === "http") {
    const res = await fetch(location, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`agents.json fetch failed: ${res.status} ${res.statusText} (${location})`);
    }
    text = await res.text();
  } else {
    text = await fs.readFile(location, "utf8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`agents.json parse error from ${location}: ${(err as Error).message}`);
  }

  return validateRegistry(parsed, location);
}

export interface FilterEligibleOpts {
  /** Milestone amount in **USDC base units (6 decimals)**, i.e. the raw uint256. */
  milestoneAmount: bigint;
  /** Lowercase-address → in-flight count map (open assignments per agent). */
  inFlightByAddress?: Map<string, number>;
}

/**
 * Apply PROTOCOL §3.4 filtering rules: online + minPayout + concurrency.
 *
 * Returned list preserves registry order so the LLM sees a stable ordering
 * (Kimi's responses are more reproducible when the candidate list is stable).
 */
export function filterEligible(
  registry: AgentsRegistry,
  opts: FilterEligibleOpts,
): RegistryAgent[] {
  const inFlight = opts.inFlightByAddress ?? new Map<string, number>();
  // Convert raw uint256 (6-decimal) USDC to whole-USDC units to match the
  // registry's `minPayoutUsdc` semantic (PROTOCOL §3.2). 1 USDC == 1_000_000.
  // Round DOWN so a 1.5 USDC milestone counts as 1 USDC of capacity — agents
  // who require a minimum should not accept fractional payouts beneath it.
  const milestoneUsdcWhole = Number(opts.milestoneAmount / 1_000_000n);

  return registry.agents.filter(agent => {
    if (!agent.online) return false;
    if (agent.minPayoutUsdc > milestoneUsdcWhole) return false;
    const current = inFlight.get(agent.address.toLowerCase()) ?? 0;
    if (current >= agent.maxConcurrent) return false;
    return true;
  });
}
