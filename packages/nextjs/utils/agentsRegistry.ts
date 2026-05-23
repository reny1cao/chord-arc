/**
 * Off-chain `agents.json` registry helpers.
 *
 * The registry shape is defined in `docs/PROTOCOL.md` §3. v0.1 publishes a
 * single canonical registry to the repo. We fetch it from the raw GitHub URL
 * so the frontend works on Vercel without requiring the daemon to be online.
 *
 * Every consumer MUST handle the fetch-failure case (404 on first publish,
 * network blip, malformed JSON) by treating the registry as empty.
 */
import type { Address as AddressType } from "viem";
import { isAddress } from "viem";

export const AGENTS_REGISTRY_URL =
  "https://raw.githubusercontent.com/reny1cao/chord-arc/main/packages/daemon/agents.json";

export interface AgentRegistryEntry {
  address: AddressType;
  name: string;
  description: string;
  tags: string[];
  minPayoutUsdc: number;
  maxConcurrent?: number;
  agentRuntime?: string;
  online?: boolean;
  endpoint?: string;
  verifiedBy?: string[] | null;
}

export interface AgentRegistry {
  version: string;
  agents: AgentRegistryEntry[];
}

const EMPTY_REGISTRY: AgentRegistry = { version: "0.1", agents: [] };

/**
 * Fetch the canonical agents.json. Never throws — returns an empty registry
 * on any failure so the page renders something sensible.
 */
export async function fetchAgentsRegistry(signal?: AbortSignal): Promise<AgentRegistry> {
  try {
    const res = await fetch(AGENTS_REGISTRY_URL, {
      // GitHub's raw endpoint serves with reasonable cache headers; we add a
      // soft cache hint to avoid hammering it on every poll.
      cache: "no-store",
      signal,
    });
    if (!res.ok) return EMPTY_REGISTRY;
    const json = (await res.json()) as Partial<AgentRegistry>;
    if (!json || !Array.isArray(json.agents)) return EMPTY_REGISTRY;
    const agents = json.agents.filter(
      (a): a is AgentRegistryEntry =>
        !!a && typeof a.address === "string" && isAddress(a.address) && typeof a.name === "string",
    );
    return { version: json.version ?? "0.1", agents };
  } catch {
    return EMPTY_REGISTRY;
  }
}

/**
 * Build a lowercase-address → entry map for O(1) joins against on-chain
 * events. We lowercase to avoid mixed-case checksum mismatches.
 */
export function indexByAddress(registry: AgentRegistry): Map<string, AgentRegistryEntry> {
  const map = new Map<string, AgentRegistryEntry>();
  for (const agent of registry.agents) {
    map.set(agent.address.toLowerCase(), agent);
  }
  return map;
}
