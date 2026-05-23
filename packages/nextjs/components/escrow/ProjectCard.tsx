"use client";

import { useRouter } from "next/navigation";
import { Address } from "@scaffold-ui/components";
import { formatUnits } from "viem";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { ProjectRole, getRoleLabel } from "~~/hooks/useProjectRole";
import { USDC_DECIMALS } from "~~/utils/erc20";

interface ProjectCardProps {
  projectId: number;
  client: string;
  pm?: string;
  totalAmount: bigint;
  totalPaid: bigint;
  milestoneCount: number;
  completedMilestones: number;
  assignedMilestones?: number;
  active: boolean;
  role: ProjectRole;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const roleStyle: Record<ProjectRole, string> = {
  client: "text-primary bg-primary/10",
  assignee: "text-base-content bg-base-200 border border-base-300",
  pm: "text-warning bg-warning/10",
  none: "text-base-content/55 bg-base-200",
};

export const ProjectCard = ({
  projectId,
  client,
  pm,
  totalAmount,
  totalPaid,
  milestoneCount,
  completedMilestones,
  assignedMilestones = 0,
  active,
  role,
}: ProjectCardProps) => {
  const router = useRouter();
  const progressPercent = milestoneCount > 0 ? (completedMilestones / milestoneCount) * 100 : 0;
  const remainingAmount = totalAmount - totalPaid;
  const unassignedCount = milestoneCount - assignedMilestones - completedMilestones;
  const totalDisplay = formatUnits(totalAmount, USDC_DECIMALS);
  const remainingDisplay = formatUnits(remainingAmount, USDC_DECIMALS);

  return (
    <article
      onClick={() => router.push(`/projects/${projectId}`)}
      className="group relative cursor-pointer rounded-2xl border border-base-300 bg-base-100 p-6 transition-all hover:border-base-content/15 hover:shadow-lift hover:-translate-y-0.5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-base-content/45">#{projectId.toString().padStart(3, "0")}</span>
          <h2 className="font-semibold tracking-tight">Project</h2>
        </div>
        <div className="flex gap-1.5">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${roleStyle[role]}`}
          >
            {getRoleLabel(role)}
          </span>
          {!active && (
            <span className="inline-flex items-center rounded-full bg-error/10 text-error px-2 py-0.5 text-[11px] font-semibold">
              Closed
            </span>
          )}
        </div>
      </div>

      {/* Parties */}
      <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
        <div onClick={e => e.stopPropagation()} className="address-mono">
          <dt className="text-base-content/45 uppercase tracking-[0.12em] text-[10px] font-semibold mb-1">Client</dt>
          <dd>
            <Address address={client} size="xs" />
          </dd>
        </div>
        {pm && pm !== ZERO_ADDRESS && (
          <div onClick={e => e.stopPropagation()} className="address-mono">
            <dt className="text-base-content/45 uppercase tracking-[0.12em] text-[10px] font-semibold mb-1">PM</dt>
            <dd>
              <Address address={pm} size="xs" />
            </dd>
          </div>
        )}
      </dl>

      {/* Progress */}
      <div className="mt-5 space-y-2">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-base-content/55 uppercase tracking-[0.12em] text-[10px] font-semibold">
            Progress
          </span>
          <span className="font-mono tabular-nums text-base-content/70">
            {completedMilestones}/{milestoneCount}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-300">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {unassignedCount > 0 && (
          <p className="text-[11px] text-warning">
            {unassignedCount} unassigned milestone{unassignedCount > 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Money */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-base-200/60 border border-base-300 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-base-content/45 font-semibold">Total</p>
          <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
            {totalDisplay} <span className="text-base-content/45 font-normal">USDC</span>
          </p>
        </div>
        <div className="rounded-lg bg-base-200/60 border border-base-300 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-base-content/45 font-semibold">Remaining</p>
          <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
            {remainingDisplay} <span className="text-base-content/45 font-normal">USDC</span>
          </p>
        </div>
      </div>

      {/* Open affordance */}
      <div className="mt-5 flex items-center justify-end text-xs font-medium text-base-content/55 group-hover:text-primary transition-colors">
        Open
        <ArrowRightIcon className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </article>
  );
};
