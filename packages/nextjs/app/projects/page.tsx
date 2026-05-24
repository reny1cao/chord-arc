"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { ProjectCard } from "~~/components/escrow/ProjectCard";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";
import type { ProjectRole } from "~~/hooks/useProjectRole";
import {
  buildWorkItems,
  isActiveWorkStatus,
  isAwaitingReviewStatus,
  isSettledStatus,
  isUnassignedWork,
} from "~~/utils/workContracts";

interface ProjectData {
  client: string;
  pm: string;
  pmFeeBps: bigint;
  totalAmount: bigint;
  totalPaid: bigint;
  totalPmFees: bigint;
  active: boolean;
  milestoneCount: bigint;
}

interface ProjectStats {
  totalMilestones: bigint;
  completedMilestones: bigint;
  paidMilestones: bigint;
  remainingAmount: bigint;
  assignedMilestones: bigint;
  acceptedMilestones: bigint;
}

interface AddressRoleData {
  isClient: boolean;
  isPM: boolean;
  assignedMilestones: bigint[];
}

interface MilestonesData {
  descriptions: string[];
  amounts: bigint[];
  assignees: string[];
  statuses: number[];
  submittedAts: bigint[];
  submissionNotes: string[];
}

type ContractFilter = "all" | "needs-routing" | "in-progress" | "awaiting-review" | "settled";

const FILTERS: { id: ContractFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs-routing", label: "Needs routing" },
  { id: "in-progress", label: "In progress" },
  { id: "awaiting-review", label: "Awaiting review" },
  { id: "settled", label: "Settled" },
];

const ProjectDashboard: NextPage = () => {
  const { address } = useAccount();
  const [activeFilter, setActiveFilter] = useState<ContractFilter>("all");

  const { data: projectCount, isLoading: isLoadingCount } = useScaffoldReadContract({
    contractName: "ChordEscrow",
    functionName: "projectCount",
  });

  const projectIds = useMemo(() => {
    if (!projectCount) return [];
    return Array.from({ length: Number(projectCount) }, (_, i) => i);
  }, [projectCount]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
        <div>
          <span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-primary">Client view</span>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Contracts</h1>
          <p className="text-sm text-base-content/65 mt-2 max-w-xl">
            Manage the work contracts you funded or route as PM: assign workers, review proof, and release USDC.
          </p>
        </div>
        <Link href="/projects/create" className="btn btn-primary gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="h-4 w-4"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Create contract
        </Link>
      </div>

      <div className="tabs tabs-boxed mb-8 inline-flex">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            className={`tab ${activeFilter === id ? "tab-active" : ""}`}
            onClick={() => setActiveFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoadingCount ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <ProjectRowSkeleton key={i} />
          ))}
        </div>
      ) : !address ? (
        <div className="rounded-2xl border border-base-300 bg-base-100 px-6 py-8 flex items-start gap-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke="currentColor"
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </span>
          <div>
            <h3 className="font-semibold tracking-tight">Connect a wallet</h3>
            <p className="text-sm text-base-content/65 mt-1">
              Connect on Arc Testnet to view the contracts you funded or manage as a PM.
            </p>
          </div>
        </div>
      ) : projectIds.length === 0 ? (
        <div className="rounded-2xl border border-base-300 bg-base-100 px-6 py-16 text-center">
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-base-content/45">Empty</div>
          <h3 className="mt-3 text-xl font-semibold tracking-tight">No contracts yet</h3>
          <p className="mt-2 text-sm text-base-content/65 max-w-sm mx-auto">
            Create the first verifiable work contract and fund escrow in USDC.
          </p>
          <Link href="/projects/create" className="btn btn-primary mt-6 gap-2">
            Create contract
          </Link>
        </div>
      ) : (
        <div className="projects-list space-y-3">
          {projectIds.map(id => (
            <ProjectItem key={id} projectId={id} filter={activeFilter} viewerAddress={address} />
          ))}
        </div>
      )}
    </div>
  );
};

const ProjectRowSkeleton = () => (
  <div className="rounded-xl border border-base-300 bg-base-100 px-5 py-4 sm:px-6 sm:py-5 animate-pulse">
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-center">
      <div className="lg:col-span-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-3 w-10 rounded-md bg-base-200" />
          <div className="h-4 w-20 rounded-md bg-base-200" />
        </div>
        <div className="h-5 w-14 rounded-full bg-base-200" />
      </div>
      <div className="lg:col-span-3 space-y-2">
        <div className="h-2.5 w-10 rounded-md bg-base-200" />
        <div className="h-3 w-28 rounded-md bg-base-200" />
      </div>
      <div className="lg:col-span-3 space-y-2">
        <div className="h-2.5 w-12 rounded-md bg-base-200" />
        <div className="h-1.5 w-full rounded-full bg-base-200" />
      </div>
      <div className="lg:col-span-3 flex items-center justify-end gap-5">
        <div className="space-y-1.5">
          <div className="h-3.5 w-16 rounded-md bg-base-200" />
          <div className="h-2.5 w-20 rounded-md bg-base-200" />
        </div>
        <div className="h-4 w-4 rounded-md bg-base-200" />
      </div>
    </div>
  </div>
);

const ProjectItem = ({
  projectId,
  filter,
  viewerAddress,
}: {
  projectId: number;
  filter: ContractFilter;
  viewerAddress: string;
}) => {
  const { data: projectData, isLoading: isLoadingProject } = useScaffoldReadContract({
    contractName: "ChordEscrow",
    functionName: "getProject",
    args: [BigInt(projectId)],
  });

  const { data: addressRoleData, isLoading: isLoadingRole } = useScaffoldReadContract({
    contractName: "ChordEscrow",
    functionName: "getAddressRole",
    args: [BigInt(projectId), viewerAddress],
  });

  const { data: projectStats, isLoading: isLoadingStats } = useScaffoldReadContract({
    contractName: "ChordEscrow",
    functionName: "getProjectStats",
    args: [BigInt(projectId)],
  });

  const { data: milestonesData, isLoading: isLoadingMilestones } = useScaffoldReadContract({
    contractName: "ChordEscrow",
    functionName: "getAllMilestones",
    args: [BigInt(projectId)],
  });

  const project = useMemo((): ProjectData | undefined => {
    if (!projectData) return undefined;
    if (Array.isArray(projectData)) {
      return {
        client: projectData[0] as string,
        pm: projectData[1] as string,
        pmFeeBps: projectData[2] as bigint,
        totalAmount: projectData[3] as bigint,
        totalPaid: projectData[4] as bigint,
        totalPmFees: projectData[5] as bigint,
        active: projectData[6] as boolean,
        milestoneCount: projectData[7] as bigint,
      };
    }
    return projectData as unknown as ProjectData;
  }, [projectData]);

  const addressRole = useMemo((): AddressRoleData | undefined => {
    if (!addressRoleData) return undefined;
    if (Array.isArray(addressRoleData)) {
      return {
        isClient: addressRoleData[0] as boolean,
        isPM: addressRoleData[1] as boolean,
        assignedMilestones: addressRoleData[2] as bigint[],
      };
    }
    return addressRoleData as unknown as AddressRoleData;
  }, [addressRoleData]);

  const stats = useMemo((): ProjectStats | undefined => {
    if (!projectStats) return undefined;
    if (Array.isArray(projectStats)) {
      return {
        totalMilestones: projectStats[0] as bigint,
        completedMilestones: projectStats[1] as bigint,
        paidMilestones: projectStats[2] as bigint,
        remainingAmount: projectStats[3] as bigint,
        assignedMilestones: projectStats[4] as bigint,
        acceptedMilestones: projectStats[5] as bigint,
      };
    }
    return projectStats as unknown as ProjectStats;
  }, [projectStats]);

  const milestones = useMemo((): MilestonesData | undefined => {
    if (!milestonesData) return undefined;
    if (Array.isArray(milestonesData)) {
      return {
        descriptions: milestonesData[0] as string[],
        amounts: milestonesData[1] as bigint[],
        assignees: milestonesData[2] as string[],
        statuses: milestonesData[3] as number[],
        submittedAts: milestonesData[4] as bigint[],
        submissionNotes: milestonesData[5] as string[],
      };
    }
    return milestonesData as unknown as MilestonesData;
  }, [milestonesData]);

  if (isLoadingProject || isLoadingStats || isLoadingRole || isLoadingMilestones) {
    return <ProjectRowSkeleton />;
  }

  if (!project?.client || !stats || !addressRole || !milestones) {
    return null;
  }

  const role: ProjectRole = addressRole.isClient ? "client" : addressRole.isPM ? "pm" : "none";
  if (role === "none") return null;

  const workItems = buildWorkItems({
    projectId,
    client: project.client,
    pm: project.pm,
    descriptions: milestones.descriptions,
    amounts: milestones.amounts,
    assignees: milestones.assignees,
    statuses: milestones.statuses,
    submissionNotes: milestones.submissionNotes,
  });

  const matchesFilter =
    filter === "all" ||
    (filter === "needs-routing" && project.active && workItems.some(isUnassignedWork)) ||
    (filter === "in-progress" && project.active && workItems.some(item => isActiveWorkStatus(item.status))) ||
    (filter === "awaiting-review" && project.active && workItems.some(item => isAwaitingReviewStatus(item.status))) ||
    (filter === "settled" && workItems.length > 0 && workItems.every(item => isSettledStatus(item.status)));

  if (!matchesFilter) return null;

  const routedMilestoneCount = workItems.filter(
    item => !isUnassignedWork(item) && !isSettledStatus(item.status),
  ).length;

  return (
    <ProjectCard
      projectId={projectId}
      client={project.client}
      pm={project.pm}
      totalAmount={project.totalAmount}
      totalPaid={project.totalPaid}
      milestoneCount={Number(stats.totalMilestones)}
      completedMilestones={Number(stats.completedMilestones)}
      assignedMilestones={routedMilestoneCount}
      active={project.active}
      role={role}
    />
  );
};

export default ProjectDashboard;
