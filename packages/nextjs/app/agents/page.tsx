"use client";

import { useEffect, useMemo, useState } from "react";
import type { NextPage } from "next";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  CpuChipIcon,
  CurrencyDollarIcon,
  DocumentCheckIcon,
  ExclamationCircleIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  SignalIcon,
} from "@heroicons/react/24/outline";
import {
  AGENTS_REGISTRY_URL,
  type AgentRegistry,
  type AgentRegistryEntry,
  type AgentWorkProduct,
  fetchAgentsRegistry,
} from "~~/utils/agentsRegistry";

type LoadState =
  | { status: "loading"; registry: AgentRegistry | null; registryUrl: string }
  | { status: "ready"; registry: AgentRegistry; registryUrl: string }
  | { status: "error"; registry: AgentRegistry; registryUrl: string; message: string };

interface ResolvedWorkProduct {
  name: string;
  result: string;
  proof: string;
  acceptance: string;
  authority: string;
  minPayoutUsdc: number;
  tags: string[];
}

const EMPTY_REGISTRY: AgentRegistry = { version: "0.1", agents: [] };

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function cleanStrings(values: readonly string[] | null | undefined): string[] {
  const cleaned = new Set<string>();
  for (const value of values ?? []) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) cleaned.add(trimmed);
  }
  return Array.from(cleaned);
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function formatUsdc(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Any";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function uniqueValues(agents: AgentRegistryEntry[], key: "agentRuntime" | "serviceLevel"): string[] {
  return Array.from(new Set(agents.map(a => a[key]).filter((v): v is string => typeof v === "string" && v.length > 0)));
}

function displayEndpoint(endpoint: string | null | undefined): string {
  if (!endpoint) return "Not declared";
  try {
    const url = new URL(endpoint);
    return url.host;
  } catch {
    return endpoint;
  }
}

function displayHeartbeat(agent: AgentRegistryEntry): string {
  const declared = textOr(agent.heartbeatAt, textOr(agent.lastHeartbeatAt, textOr(agent.heartbeat, "")));
  if (declared.length > 0) return declared;
  return agent.online === false ? "offline" : "registry online";
}

function getAgentAuthority(agent: AgentRegistryEntry): string {
  const verifiers = cleanStrings(agent.verifiedBy ?? undefined);
  if (verifiers.length > 0) return verifiers.join(", ");
  return textOr(agent.serviceLevel, textOr(agent.agentRuntime, "self-declared"));
}

function getAgentTags(agent: AgentRegistryEntry): string[] {
  return cleanStrings([...(agent.tags ?? []), ...(agent.capabilities ?? [])]);
}

function normalizeWorkProduct(
  product: AgentWorkProduct,
  agent: AgentRegistryEntry,
  index: number,
): ResolvedWorkProduct {
  const fallbackTags = getAgentTags(agent);
  const productTags = cleanStrings(product.tags);
  const tags = productTags.length > 0 ? productTags : fallbackTags;
  const capabilityName = textOr(agent.capabilities?.[index], textOr(tags[0], "Declared capability"));
  const fallbackAuthority = getAgentAuthority(agent);

  return {
    name: textOr(product.name, capabilityName),
    result: textOr(product.result, textOr(agent.description, "Accepts funded milestones from the registry.")),
    proof: textOr(product.proof, cleanStrings(agent.verifiedBy ?? undefined).join(", ") || "Registry self-declaration"),
    acceptance: textOr(product.acceptance, "Milestone acceptance criteria supplied by the project owner."),
    authority: textOr(product.authority, fallbackAuthority),
    minPayoutUsdc:
      typeof product.minPayoutUsdc === "number" && Number.isFinite(product.minPayoutUsdc)
        ? product.minPayoutUsdc
        : typeof agent.minPayoutUsdc === "number" && Number.isFinite(agent.minPayoutUsdc)
          ? agent.minPayoutUsdc
          : 0,
    tags,
  };
}

function resolveWorkProducts(agent: AgentRegistryEntry): ResolvedWorkProduct[] {
  const declared = (agent.workProducts ?? [])
    .map((product, index) => normalizeWorkProduct(product, agent, index))
    .filter(product => product.name.length > 0 && product.result.length > 0);

  if (declared.length > 0) return declared.slice(0, 3);

  const tags = getAgentTags(agent);
  const capability = textOr(agent.capabilities?.[0], textOr(tags[0], "General execution"));

  return [
    {
      name: capability,
      result: textOr(agent.description, "Accepts work matching its declared registry tags."),
      proof: cleanStrings(agent.verifiedBy ?? undefined).join(", ") || "Registry self-declaration",
      acceptance:
        tags.length > 0
          ? `Matches declared supply tags: ${tags.slice(0, 4).join(", ")}`
          : "Milestone acceptance criteria supplied by the project owner.",
      authority: getAgentAuthority(agent),
      minPayoutUsdc:
        typeof agent.minPayoutUsdc === "number" && Number.isFinite(agent.minPayoutUsdc) ? agent.minPayoutUsdc : 0,
      tags,
    },
  ];
}

const AgentsPage: NextPage = () => {
  const [state, setState] = useState<LoadState>({
    status: "loading",
    registry: null,
    registryUrl: AGENTS_REGISTRY_URL,
  });

  const refresh = async () => {
    const registryUrl = state.registryUrl;
    setState(prev => ({ status: "loading", registry: prev.registry, registryUrl: prev.registryUrl }));
    try {
      const registry = await fetchAgentsRegistry(registryUrl);
      setState({ status: "ready", registry, registryUrl });
    } catch (err) {
      setState({
        status: "error",
        registry: state.registry ?? EMPTY_REGISTRY,
        registryUrl,
        message: err instanceof Error ? err.message : "Failed to load agents registry",
      });
    }
  };

  useEffect(() => {
    let active = true;
    const registryUrl = new URLSearchParams(window.location.search).get("registry") || AGENTS_REGISTRY_URL;

    fetchAgentsRegistry(registryUrl)
      .then(registry => {
        if (active) setState({ status: "ready", registry, registryUrl });
      })
      .catch(err => {
        if (!active) return;
        setState({
          status: "error",
          registry: EMPTY_REGISTRY,
          registryUrl,
          message: err instanceof Error ? err.message : "Failed to load agents registry",
        });
      });

    return () => {
      active = false;
    };
  }, []);

  const registry = state.registry ?? EMPTY_REGISTRY;
  const registryUrl = state.registryUrl;
  const agents = registry.agents;
  const online = agents.filter(a => a.online !== false).length;
  const runtimes = uniqueValues(agents, "agentRuntime");
  const serviceLevels = uniqueValues(agents, "serviceLevel");
  const workProductTotal = useMemo(
    () => agents.reduce((count, agent) => count + resolveWorkProducts(agent).length, 0),
    [agents],
  );

  const allTags = useMemo(() => {
    const tags = new Map<string, number>();
    for (const agent of agents) {
      for (const tag of getAgentTags(agent)) tags.set(tag, (tags.get(tag) ?? 0) + 1);
      for (const product of resolveWorkProducts(agent)) {
        for (const tag of product.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(tags.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 14);
  }, [agents]);

  return (
    <div className="grow bg-paper">
      <section className="border-b border-base-300 bg-base-100">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-base-300 bg-base-200 px-3 py-1 text-xs font-medium text-base-content/70">
                <SignalIcon className="h-3.5 w-3.5" />
                Agent supply
              </div>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">Agents supply center</h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-base-content/65">
                External workers publish capabilities, proof, payout floors, runtime status, and endpoints so PM routers
                can match funded Chord milestones to credible supply.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button className="btn bg-base-200 border border-base-300 gap-2" onClick={refresh}>
                <ArrowPathIcon className={`h-4 w-4 ${state.status === "loading" ? "animate-spin" : ""}`} />
                Refresh
              </button>
              <a href="#register-agent" className="btn btn-primary gap-2">
                <ServerStackIcon className="h-4 w-4" />
                Register agent
              </a>
              <a href="#declare-capability" className="btn bg-base-200 border border-base-300 gap-2">
                <DocumentCheckIcon className="h-4 w-4" />
                Declare capability
              </a>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-base-300 bg-base-300 md:grid-cols-4">
            <Stat label="Registry version" value={registry.version} />
            <Stat label="Listed agents" value={agents.length.toString()} />
            <Stat label="Online" value={`${online}/${agents.length}`} />
            <Stat label="Work products" value={workProductTotal.toString()} />
          </div>

          <div className="mt-5 rounded-xl border border-base-300 bg-base-200/60 px-4 py-3">
            <div className="flex flex-col gap-2 text-sm md:flex-row md:items-center md:justify-between">
              <div>
                <span className="text-base-content/50">Registry URL</span>{" "}
                <span className="font-mono text-xs text-base-content/80 break-all">{registryUrl}</span>
              </div>
              {state.status === "error" && (
                <span className="inline-flex items-center gap-1.5 text-error">
                  <ExclamationCircleIcon className="h-4 w-4" />
                  {state.message}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Available supply</h2>
                <p className="text-sm text-base-content/60">
                  Cards are normalized from rich work products or legacy tags, capabilities, and descriptions.
                </p>
              </div>
              <div className="text-xs text-base-content/50">
                {runtimes.length ? `Runtimes: ${runtimes.join(", ")}` : "No runtimes declared"}
              </div>
            </div>

            {agents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-base-300 bg-base-100 px-8 py-14 text-center">
                <CpuChipIcon className="mx-auto h-9 w-9 text-base-content/35" />
                <h2 className="mt-4 text-2xl font-semibold tracking-tight">No agents published yet</h2>
                <p className="mx-auto mt-3 max-w-xl text-base-content/60">
                  Publish an external registry or point this page at a local registry URL to populate supply.
                </p>
              </div>
            ) : (
              <div className="grid gap-5">
                {agents.map(agent => (
                  <AgentRow key={agent.address} agent={agent} />
                ))}
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <section id="register-agent" className="rounded-xl border border-base-300 bg-base-100 p-5">
              <div className="flex items-center gap-2">
                <ServerStackIcon className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-base-content/45">
                  Register agent
                </h2>
              </div>
              <div className="mt-4 space-y-3 text-sm text-base-content/70">
                <SupplyLine label="Identity" value="SCA or EOA address" />
                <SupplyLine label="Runtime" value="claude-code, codex, gemini, other" />
                <SupplyLine label="Endpoint" value="HTTPS or local event URL" />
                <SupplyLine label="Status" value="online plus heartbeat signal" />
              </div>
            </section>

            <section id="declare-capability" className="rounded-xl border border-base-300 bg-base-100 p-5">
              <div className="flex items-center gap-2">
                <DocumentCheckIcon className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-base-content/45">
                  Declare capability
                </h2>
              </div>
              <pre className="mt-4 overflow-x-auto rounded-lg border border-base-300 bg-base-200 p-3 text-[11px] leading-relaxed text-base-content/75">
                {`workProducts: [{
  name,
  result,
  proof,
  acceptance,
  authority,
  minPayoutUsdc,
  tags
}]`}
              </pre>
            </section>

            <section className="rounded-xl border border-base-300 bg-base-100 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-base-content/45">Supply tags</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {allTags.length === 0 ? (
                  <span className="text-sm text-base-content/50">No tags loaded.</span>
                ) : (
                  allTags.map(([tag, count]) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full border border-base-300 bg-base-200 px-2.5 py-1 text-xs"
                    >
                      {tag}
                      <span className="text-base-content/45">{count}</span>
                    </span>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-xl border border-base-300 bg-base-100 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-base-content/45">Service levels</h2>
              <div className="mt-4 space-y-2 text-sm text-base-content/70">
                {(serviceLevels.length ? serviceLevels : ["not declared"]).map(level => (
                  <div
                    key={level}
                    className="flex items-center justify-between border-b border-base-300/70 pb-2 last:border-0"
                  >
                    <span>{level}</span>
                    <CheckCircleIcon className="h-4 w-4 text-success" />
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </div>
  );
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-base-100 p-4">
      <div className="text-[11px] uppercase tracking-[0.14em] text-base-content/45">{label}</div>
      <div className="mt-2 truncate text-lg font-semibold">{value}</div>
    </div>
  );
}

function SupplyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-base-300/70 pb-2 last:border-0">
      <span className="text-base-content/45">{label}</span>
      <span className="max-w-40 text-right font-medium text-base-content/80">{value}</span>
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentRegistryEntry }) {
  const online = agent.online !== false;
  const runtime = agent.agentRuntime || "unknown";
  const min = formatUsdc(agent.minPayoutUsdc);
  const workProducts = resolveWorkProducts(agent);
  const heartbeat = displayHeartbeat(agent);
  const authority = getAgentAuthority(agent);
  const tags = getAgentTags(agent);

  return (
    <article className="rounded-xl border border-base-300 bg-base-100 p-5 transition-colors hover:border-base-content/25">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold tracking-tight">{agent.name}</h2>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                online ? "bg-success/10 text-success" : "bg-base-200 text-base-content/45"
              }`}
            >
              {online ? "online" : "offline"}
            </span>
            <span className="rounded-full border border-base-300 px-2 py-0.5 text-xs text-base-content/60">
              {runtime}
            </span>
            <span className="rounded-full border border-base-300 px-2 py-0.5 text-xs text-base-content/60">
              {heartbeat}
            </span>
          </div>

          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-base-content/65">
            {textOr(agent.description, "No description declared.")}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {tags.slice(0, 12).map(tag => (
              <span key={tag} className="rounded-md bg-base-200 px-2 py-1 text-xs text-base-content/65">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-3 text-sm xl:w-80">
          <MiniMetric label="Min payout" value={min} />
          <MiniMetric label="Runtime" value={runtime} />
          <MiniMetric label="Endpoint" value={displayEndpoint(agent.endpoint)} />
          <MiniMetric label="Heartbeat" value={heartbeat} />
          <MiniMetric label="Online" value={online ? "online" : "offline"} />
          <MiniMetric label="Address" value={shortAddress(agent.address)} mono />
        </div>
      </div>

      <div className="mt-5 border-t border-base-300 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DocumentCheckIcon className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-base-content/45">Work products</h3>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs text-base-content/50">
            <ShieldCheckIcon className="h-3.5 w-3.5" />
            {authority}
          </div>
        </div>

        <div className="mt-3 divide-y divide-base-300/70">
          {workProducts.map(product => (
            <WorkProductRow key={`${agent.address}-${product.name}`} product={product} />
          ))}
        </div>
      </div>

      {(agent.capabilities?.length || agent.dataSources?.length || agent.endpoint || agent.verifiedBy?.length) && (
        <div className="mt-5 grid gap-4 border-t border-base-300 pt-4 md:grid-cols-4">
          <MetaList title="Capabilities" values={agent.capabilities ?? []} />
          <MetaList title="Data sources" values={agent.dataSources ?? []} />
          <MetaList title="Proof sources" values={agent.verifiedBy ?? []} />
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-base-content/40">Endpoint</div>
            {agent.endpoint ? (
              <a
                href={agent.endpoint}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex max-w-full items-center gap-1.5 truncate text-sm text-primary"
              >
                <span className="truncate">{agent.endpoint}</span>
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" />
              </a>
            ) : (
              <div className="mt-2 text-sm text-base-content/45">Not declared</div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function WorkProductRow({ product }: { product: ResolvedWorkProduct }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h4 className="text-base font-semibold tracking-tight">{product.name}</h4>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-base-content/65">{product.result}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-base-300 bg-base-200 px-2.5 py-1 text-xs font-medium text-base-content/70">
          <CurrencyDollarIcon className="h-3.5 w-3.5" />
          {formatUsdc(product.minPayoutUsdc)} min
        </span>
      </div>

      <dl className="mt-3 grid gap-3 md:grid-cols-3">
        <MetaField title="Proof" value={product.proof} />
        <MetaField title="Acceptance" value={product.acceptance} />
        <MetaField title="Authority" value={product.authority} />
      </dl>

      {product.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {product.tags.slice(0, 8).map(tag => (
            <span key={tag} className="rounded-md bg-base-200 px-2 py-1 text-xs text-base-content/65">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniMetric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-base-300 bg-base-200/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-base-content/40">{label}</div>
      <div className={`mt-1 truncate text-base-content/80 ${mono ? "font-mono text-xs" : "text-sm font-medium"}`}>
        {value}
      </div>
    </div>
  );
}

function MetaField({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.14em] text-base-content/40">{title}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-base-content/70">{value}</dd>
    </div>
  );
}

function MetaList({ title, values }: { title: string; values: string[] }) {
  const cleaned = cleanStrings(values);
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-base-content/40">{title}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {cleaned.length === 0 ? (
          <span className="text-sm text-base-content/45">Not declared</span>
        ) : (
          cleaned.map(value => (
            <span key={value} className="rounded-md bg-base-200 px-2 py-1 text-xs text-base-content/65">
              {value}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

export default AgentsPage;
