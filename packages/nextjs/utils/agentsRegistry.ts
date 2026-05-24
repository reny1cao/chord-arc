/**
 * Off-chain `agents.json` registry helpers.
 *
 * The registry shape is defined in `docs/PROTOCOL.md` §3. v0.1 publishes a
 * single canonical registry to the repo by default. The frontend can also read
 * an explicit registry URL for local onboarding previews.
 *
 * Every consumer MUST handle the fetch-failure case (404 on first publish,
 * network blip, malformed JSON) by treating the registry as empty.
 */
import type { Address as AddressType } from "viem";
import { isAddress } from "viem";

export const RAW_AGENTS_REGISTRY_URL =
  "https://raw.githubusercontent.com/reny1cao/chord-arc/main/packages/daemon/agents.json";

export const DEFAULT_AGENTS_REGISTRY_URL = "/api/agents";

export const AGENTS_REGISTRY_URL = process.env.NEXT_PUBLIC_CHORD_AGENTS_REGISTRY_URL || DEFAULT_AGENTS_REGISTRY_URL;

export interface AgentWorkProduct {
  name: string;
  result: string;
  proof: string;
  acceptance: string;
  authority: string;
  minPayoutUsdc: number;
  tags: string[];
}

export interface AgentRegistryEntry {
  address: AddressType;
  name: string;
  description: string;
  tags: string[];
  minPayoutUsdc: number;
  maxConcurrent?: number;
  agentRuntime?: string;
  online?: boolean;
  endpoint?: string | null;
  verifiedBy?: string[] | null;
  serviceLevel?: string;
  capabilities?: string[];
  dataSources?: string[];
  heartbeat?: string;
  heartbeatAt?: string;
  lastHeartbeatAt?: string;
  workProducts?: AgentWorkProduct[];
}

export interface AgentRegistry {
  version: string;
  agents: AgentRegistryEntry[];
}

const EMPTY_REGISTRY: AgentRegistry = { version: "0.1", agents: [] };

async function requestRegistry(registryUrl: string, signal?: AbortSignal): Promise<AgentRegistry | null> {
  const res = await fetch(registryUrl, {
    // GitHub's raw endpoint serves with reasonable cache headers; local API
    // should stay fresh while onboarding agents during development.
    cache: "no-store",
    signal,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Partial<AgentRegistry>;
  if (!json || !Array.isArray(json.agents)) return null;
  const agents = json.agents.filter(
    (a): a is AgentRegistryEntry =>
      !!a && typeof a.address === "string" && isAddress(a.address, { strict: false }) && typeof a.name === "string",
  );
  return { version: json.version ?? "0.1", agents };
}

/**
 * Fetch an agents.json registry. Never throws — returns an empty registry on
 * any failure so the page renders something sensible.
 */
export async function fetchAgentsRegistry(signal?: AbortSignal): Promise<AgentRegistry>;
export async function fetchAgentsRegistry(url?: string, signal?: AbortSignal): Promise<AgentRegistry>;
export async function fetchAgentsRegistry(
  urlOrSignal?: string | AbortSignal,
  signal?: AbortSignal,
): Promise<AgentRegistry> {
  const registryUrl = typeof urlOrSignal === "string" ? urlOrSignal : AGENTS_REGISTRY_URL;
  const requestSignal = typeof urlOrSignal === "string" ? signal : urlOrSignal;

  try {
    const registry = await requestRegistry(registryUrl, requestSignal);
    if (registry) return registry;
    if (!process.env.NEXT_PUBLIC_CHORD_AGENTS_REGISTRY_URL && registryUrl === DEFAULT_AGENTS_REGISTRY_URL) {
      return (await requestRegistry(RAW_AGENTS_REGISTRY_URL, requestSignal)) ?? EMPTY_REGISTRY;
    }
    return EMPTY_REGISTRY;
  } catch {
    if (!process.env.NEXT_PUBLIC_CHORD_AGENTS_REGISTRY_URL && registryUrl === DEFAULT_AGENTS_REGISTRY_URL) {
      try {
        return (await requestRegistry(RAW_AGENTS_REGISTRY_URL, requestSignal)) ?? EMPTY_REGISTRY;
      } catch {
        return EMPTY_REGISTRY;
      }
    }
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
