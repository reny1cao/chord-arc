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
  none: "text-base-content/55 bg-base-200 border border-base-300",
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
  const hasPm = pm && pm !== ZERO_ADDRESS;

  return (
    <article
      onClick={() => router.push(`/projects/${projectId}`)}
      className="group relative cursor-pointer rounded-xl border border-base-300 bg-base-100 px-5 py-4 sm:px-6 sm:py-5 hover:border-base-content/20 hover:bg-base-100/80 transition-colors"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 lg:items-center">
        {/* Title + role */}
        <div className="lg:col-span-3 flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs text-base-content/45 tabular-nums">
              #{projectId.toString().padStart(3, "0")}
            </span>
            <h3 className="font-semibold tracking-tight">Project</h3>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
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
        <div className="lg:col-span-3 min-w-0 space-y-2" onClick={e => e.stopPropagation()}>
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45 mb-1">
              Client
            </p>
            <div className="address-mono">
              <Address address={client} size="xs" />
            </div>
          </div>
          {hasPm && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45 mb-1">
                Project manager
              </p>
              <div className="address-mono">
                <Address address={pm} size="xs" />
              </div>
            </div>
          )}
        </div>

        {/* Progress */}
        <div className="lg:col-span-3">
          <div className="flex items-baseline justify-between text-xs mb-1.5">
            <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45">
              Progress
            </span>
            <span className="font-mono text-base-content/75 tabular-nums">
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
            <p className="text-[10px] text-warning mt-1.5">
              {unassignedCount} unassigned milestone{unassignedCount > 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* Money + open */}
        <div className="lg:col-span-3 flex items-center justify-between lg:justify-end gap-5">
          <div className="text-left lg:text-right">
            <div className="font-mono text-sm font-semibold tabular-nums">
              {totalDisplay}
              <span className="ml-1 text-base-content/45 font-normal">USDC</span>
            </div>
            <div className="font-mono text-[11px] text-base-content/55 tabular-nums">
              {remainingDisplay} remaining
            </div>
          </div>
          <ArrowRightIcon className="h-4 w-4 text-base-content/40 group-hover:text-primary group-hover:translate-x-0.5 transition" />
        </div>
      </div>
    </article>
  );
};
