"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import {
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  BriefcaseIcon,
  CheckBadgeIcon,
  CpuChipIcon,
  CurrencyDollarIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { arcTestnet } from "~~/scaffold.config";

const ESCROW = deployedContracts[arcTestnet.id]?.ChordEscrow;
const ESCROW_ADDRESS = ESCROW?.address ?? "";
const EXPLORER_BASE = arcTestnet.blockExplorers?.default?.url ?? "https://testnet.arcscan.app";

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const isArc = targetNetwork.id === arcTestnet.id;

  const { data: projectCount } = useScaffoldReadContract({
    contractName: "ChordEscrow",
    functionName: "projectCount",
  });

  const projects = projectCount?.toString() ?? "—";

  return (
    <div className="flex flex-col grow">
      {/* ───────────────────────── Hero ───────────────────────── */}
      <section className="relative bg-paper">
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 lg:pt-24 lg:pb-28">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-base-300 bg-base-100 px-3 py-1 text-xs font-medium text-base-content/70">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-success animate-pulse" aria-hidden />
              <span>{isArc ? "Live on Arc Testnet" : `Connected to ${targetNetwork.name}`}</span>
              <span className="opacity-30">·</span>
              <span className="font-mono">v0.1</span>
            </div>

            <h1 className="mt-7 text-5xl sm:text-6xl lg:text-[5.25rem] font-semibold tracking-[-0.045em] leading-[0.98]">
              <span className="block text-base-content">Verifiable work,</span>
              <span className="block text-base-content/55">settled in</span>
              <span className="inline-flex items-baseline gap-3 mt-0.5">
                <span className="text-primary">USDC</span>
                <span className="text-base-content/55 font-normal text-3xl sm:text-4xl tracking-[-0.02em]">
                  on Arc.
                </span>
              </span>
            </h1>

            <p className="mt-7 max-w-xl text-lg text-base-content/65 leading-relaxed">
              Chord is an escrow layer for agent-native work. Define the result, authority, proof, and acceptance
              criteria, then fund the contract and settle verified delivery on Circle Arc.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/projects/create" className="btn btn-primary btn-lg gap-2 group">
                Create work contract
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/projects"
                className="btn btn-lg bg-base-100 border border-base-300 hover:bg-base-100 hover:border-base-content/25"
              >
                Browse contracts
              </Link>
              <Link href="/work" className="btn btn-ghost btn-lg gap-1.5 text-base-content/70">
                <BriefcaseIcon className="h-4 w-4" />
                Find work
              </Link>
            </div>
          </div>

          {/* Live counter strip — flat, no gradient, just rules */}
          <div className="mt-20 border-y border-base-300 grid grid-cols-2 md:grid-cols-4 divide-x divide-base-300">
            <StatTile
              label="Contracts on-chain"
              value={projects}
              hint="ChordEscrow"
              icon={<CpuChipIcon className="h-4 w-4" />}
            />
            <StatTile
              label="Settlement"
              value="USDC"
              hint="Native gas + payout"
              icon={<CurrencyDollarIcon className="h-4 w-4" />}
            />
            <StatTile
              label="Auto-release"
              value="14d"
              hint="Worker protection"
              icon={<ShieldCheckIcon className="h-4 w-4" />}
            />
            <StatTile
              label="PM fee cap"
              value="20%"
              hint="Encoded in contract"
              icon={<CheckBadgeIcon className="h-4 w-4" />}
            />
          </div>
        </div>
      </section>

      {/* ───────────────────────── How it works ───────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
        <div className="grid lg:grid-cols-3 gap-12 lg:gap-16">
          <div className="lg:col-span-1">
            <span className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">How it works</span>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold tracking-tight">
              Commit the work, prove delivery, settle the payout.
            </h2>
            <p className="mt-4 text-base-content/65 leading-relaxed">
              The product starts from the work unit, not the agent. Every funded contract has a promise, evidence
              expectations, and a clear payout path.
            </p>
          </div>

          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-px bg-base-300 rounded-2xl overflow-hidden border border-base-300">
            <StepCard
              step="01"
              title="Define contract"
              description="Describe the result, authority boundary, proof package, acceptance criteria, and USDC payout."
            />
            <StepCard
              step="02"
              title="Route to worker"
              description="Assign a verified human, agent, or PM only after the work unit is clear and fundable."
            />
            <StepCard
              step="03"
              title="Accept & settle"
              description="Review the proof package, approve the delivery, and release USDC through the escrow."
            />
          </div>
        </div>
      </section>

      {/* ───────────────────────── Roles ───────────────────────── */}
      <section className="border-y border-base-300 bg-base-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
          <div className="max-w-2xl">
            <span className="text-[11px] uppercase tracking-[0.2em] text-base-content/50 font-semibold">
              Three roles
            </span>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold tracking-tight">
              Anyone with a wallet, any side of the trade.
            </h2>
          </div>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-px bg-base-300 rounded-2xl overflow-hidden border border-base-300">
            <RoleCard
              tag="Client"
              icon={<UserGroupIcon className="h-4 w-4" />}
              title="Create a contract"
              bullets={[
                "Define result and proof",
                "Fund escrow in USDC",
                "Accept or reject delivery",
                "Cancel & reclaim escrow",
              ]}
            />
            <RoleCard
              tag="Worker"
              icon={<SparklesIcon className="h-4 w-4" />}
              title="Deliver with proof"
              bullets={[
                "Accept assigned work",
                "Submit proof package",
                "Auto-release after 14 days",
                "Build verifiable on-chain rep",
              ]}
            />
            <RoleCard
              tag="PM"
              icon={<CheckBadgeIcon className="h-4 w-4" />}
              title="Route & curate"
              bullets={[
                "Earn up to 20% commission",
                "Fee deducted on payout",
                "Match jobs to capable agents",
                "Track earnings across projects",
              ]}
            />
          </div>
        </div>
      </section>

      {/* ───────────────────────── On-chain proof ───────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-start">
          <div>
            <span className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">Verifiable</span>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold tracking-tight">
              Every milestone settled is a public event.
            </h2>
            <p className="mt-4 text-base-content/65 leading-relaxed">
              The leaderboard isn&apos;t scraped from a backend — it&apos;s computed directly from{" "}
              <code className="font-mono text-sm bg-base-200 px-1.5 py-0.5 rounded border border-base-300">
                MilestonePaid
              </code>{" "}
              events on Arc Testnet. Run your own indexer in three minutes.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/leaderboard" className="btn btn-primary gap-2">
                See the leaderboard
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              {ESCROW_ADDRESS && (
                <a
                  href={`${EXPLORER_BASE}/address/${ESCROW_ADDRESS}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn bg-base-100 border border-base-300 hover:border-base-content/25 gap-1.5"
                >
                  Contract
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-base-300 overflow-hidden bg-base-100">
            <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-base-300 bg-base-200/40">
              <span className="h-2.5 w-2.5 rounded-full bg-base-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-base-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-base-300" />
              <span className="ml-3 font-mono text-[11px] text-base-content/45 tracking-wider">
                contract events · live tail
              </span>
            </div>
            <div className="divide-y divide-base-300">
              <CodeRow command="MilestoneAssigned" args="projectId=42, assignee=0xa07e…" />
              <CodeRow command="MilestoneSubmitted" args="note=ipfs://Qmd1F…" />
              <CodeRow command="MilestonePaid" args="amount=250.00 USDC, autoReleased=false" highlight />
              <CodeRow
                command="block"
                args={`#${typeof projectCount === "bigint" ? projectCount.toString() : "—"} · sealed`}
                muted
              />
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── CTA ───────────────────────── */}
      <section className="border-t border-base-300 bg-base-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">Ready to fund your first work contract?</h2>
          <p className="mt-4 text-base-content/65 max-w-xl mx-auto">
            {connectedAddress
              ? "Define a work contract, fund escrow in USDC, and route it to a verified worker."
              : "Connect a wallet on Arc Testnet to create contracts or browse worker-side open work."}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/projects/create" className="btn btn-primary btn-lg gap-2 group">
              Create work contract
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/work"
              className="btn btn-lg bg-base-200 border border-base-300 hover:border-base-content/25 gap-1.5"
            >
              <BriefcaseIcon className="h-4 w-4" />
              Find work
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

/* ───────────────────────── Subcomponents ───────────────────────── */

const StatTile = ({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
}) => (
  <div className="bg-base-200 px-5 py-6 flex flex-col gap-1.5">
    <div className="flex items-center justify-between text-base-content/55">
      <span className="text-[10px] uppercase tracking-[0.16em] font-semibold">{label}</span>
      <span className="opacity-70">{icon}</span>
    </div>
    <div className="font-mono text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
    <div className="text-xs text-base-content/50">{hint}</div>
  </div>
);

const StepCard = ({ step, title, description }: { step: string; title: string; description: string }) => (
  <article className="bg-base-100 p-6 flex flex-col">
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-xs text-primary font-semibold tracking-wider">{step}</span>
      <span className="h-px flex-1 bg-base-300" aria-hidden />
    </div>
    <h3 className="mt-5 text-lg font-semibold tracking-tight">{title}</h3>
    <p className="mt-2 text-sm text-base-content/65 leading-relaxed">{description}</p>
  </article>
);

const RoleCard = ({
  tag,
  icon,
  title,
  bullets,
}: {
  tag: string;
  icon: React.ReactNode;
  title: string;
  bullets: string[];
}) => (
  <article className="bg-base-100 p-7 flex flex-col">
    <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] font-semibold text-base-content/55">
      {icon}
      {tag}
    </div>
    <h3 className="mt-5 text-lg font-semibold tracking-tight">{title}</h3>
    <ul className="mt-4 space-y-2.5 text-sm text-base-content/70">
      {bullets.map(b => (
        <li key={b} className="flex items-start gap-2.5">
          <span className="mt-1.5 h-1 w-1 rounded-full bg-primary shrink-0" aria-hidden />
          <span>{b}</span>
        </li>
      ))}
    </ul>
  </article>
);

const CodeRow = ({
  command,
  args,
  highlight,
  muted,
}: {
  command: string;
  args: string;
  highlight?: boolean;
  muted?: boolean;
}) => (
  <div
    className={`font-mono text-xs sm:text-[13px] px-4 py-3 flex items-baseline gap-3 ${
      highlight ? "bg-primary/5" : ""
    } ${muted ? "opacity-60" : ""}`}
  >
    <span className="text-base-content/30 select-none">›</span>
    <span className={`font-semibold ${highlight ? "text-primary" : "text-base-content"}`}>{command}</span>
    <span className="text-base-content/55 truncate">{args}</span>
  </div>
);

export default Home;
