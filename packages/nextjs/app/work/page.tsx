"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { ApprovalActions } from "~~/components/escrow/ApprovalActions";
import { StatusBadge } from "~~/components/escrow/StatusBadge";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";
import { useWorkContract } from "~~/hooks/useWorkContract";
import { USDC_DECIMALS } from "~~/utils/erc20";
import {
  type WorkItem,
  ZERO_ADDRESS,
  buildWorkItems,
  isActiveWorkStatus,
  isAwaitingReviewStatus,
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
  /** Wave-2: off-chain WorkContract pointer (`chord://<hash>`); "" for legacy projects. */
  contractURI: string;
}

interface MilestonesData {
  descriptions: string[];
  amounts: bigint[];
  assignees: string[];
  statuses: number[];
  submittedAts: bigint[];
  submissionNotes: string[];
}

type WorkFilter = "open" | "assigned" | "submitted";

const FILTERS: { id: WorkFilter; label: string; helper: string }[] = [
  {
    id: "open",
    label: "Open work",
    helper: "Funded work units that still need a client or PM to assign a worker.",
  },
  {
    id: "assigned",
    label: "Assigned to me",
    helper: "Work assigned to the connected worker wallet. Accept, start, and submit proof here.",
  },
  {
    id: "submitted",
    label: "Submitted by me",
    helper: "Submitted proof packages waiting for client review and payout.",
  },
];

const WorkPage: NextPage = () => {
  const { address } = useAccount();
  const [activeFilter, setActiveFilter] = useState<WorkFilter>("open");

  const { data: projectCount, isLoading: isLoadingCount } = useScaffoldReadContract({
    contractName: "ChordEscrow",
    functionName: "projectCount",
  });

  const projectIds = useMemo(() => {
    if (!projectCount) return [];
    return Array.from({ length: Number(projectCount) }, (_, i) => i);
  }, [projectCount]);

  const activeHelper = FILTERS.find(filter => filter.id === activeFilter)?.helper;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
        <div>
          <span className="text-[11px] uppercase tracking-[0.18em] font-semibold text-primary">Worker view</span>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Work</h1>
          <p className="text-sm text-base-content/65 mt-2 max-w-xl">
            Discover funded contracts, track assignments, submit proof packages, and get paid in USDC.
          </p>
        </div>
        <Link href="/agents" className="btn bg-base-100 border border-base-300 hover:border-base-content/25">
          Register agent
        </Link>
      </div>

      <div className="tabs tabs-boxed mb-3 inline-flex">
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
      {activeHelper && <p className="mb-8 text-sm text-base-content/60">{activeHelper}</p>}

      {activeFilter !== "open" && !address ? (
        <div className="rounded-2xl border border-base-300 bg-base-100 px-6 py-8">
          <h2 className="font-semibold tracking-tight">Connect a worker wallet</h2>
          <p className="mt-2 text-sm text-base-content/65">
            Assigned and submitted work are scoped to the connected assignee address.
          </p>
        </div>
      ) : isLoadingCount ? (
        <div className="grid gap-4">
          {[0, 1, 2].map(i => (
            <WorkCardSkeleton key={i} />
          ))}
        </div>
      ) : projectIds.length === 0 ? (
        <div className="rounded-2xl border border-base-300 bg-base-100 px-6 py-16 text-center">
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-base-content/45">Empty</div>
          <h3 className="mt-3 text-xl font-semibold tracking-tight">No work on-chain yet</h3>
          <p className="mt-2 text-sm text-base-content/65 max-w-sm mx-auto">
            Open work appears here after a client funds a contract.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {projectIds.map(id => (
            <WorkProjectItem key={id} projectId={id} filter={activeFilter} viewerAddress={address} />
          ))}
        </div>
      )}
    </div>
  );
};

const WorkProjectItem = ({
  projectId,
  filter,
  viewerAddress,
}: {
  projectId: number;
  filter: WorkFilter;
  viewerAddress?: string;
}) => {
  const {
    data: projectData,
    isLoading: isLoadingProject,
    refetch: refetchProject,
  } = useScaffoldReadContract({
    contractName: "ChordEscrow",
    functionName: "getProject",
    args: [BigInt(projectId)],
  });

  const {
    data: milestonesData,
    isLoading: isLoadingMilestones,
    refetch: refetchMilestones,
  } = useScaffoldReadContract({
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
        contractURI: (projectData[8] as string | undefined) ?? "",
      };
    }
    const fallback = projectData as unknown as ProjectData;
    return { ...fallback, contractURI: fallback.contractURI ?? "" };
  }, [projectData]);

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

  // Wave-2: pull the off-chain contract for this project, if any. We MUST
  // call the hook unconditionally (Rules of Hooks) — pass undefined when the
  // on-chain pointer isn't available yet so it no-ops.
  const { contract: workContract } = useWorkContract(project?.contractURI);

  if (isLoadingProject || isLoadingMilestones) return <WorkCardSkeleton />;
  if (!project?.client || !milestones) return null;

  const viewer = viewerAddress?.toLowerCase();
  const workItems = buildWorkItems({
    projectId,
    client: project.client,
    pm: project.pm,
    descriptions: milestones.descriptions,
    amounts: milestones.amounts,
    assignees: milestones.assignees,
    statuses: milestones.statuses,
    submissionNotes: milestones.submissionNotes,
    contract: workContract,
  });

  const matched = workItems.filter(item => {
    const isMine = viewer && item.assignee.toLowerCase() === viewer;
    if (!project.active) return false;
    if (filter === "open") return isUnassignedWork(item);
    if (filter === "assigned") return Boolean(isMine && isActiveWorkStatus(item.status));
    return Boolean(isMine && isAwaitingReviewStatus(item.status));
  });

  if (matched.length === 0) return null;

  const handleRefresh = () => {
    refetchProject();
    refetchMilestones();
  };

  return (
    <>
      {matched.map(item => (
        <WorkCard
          key={`${item.projectId}-${item.milestoneIndex}`}
          item={item}
          viewerAddress={viewerAddress}
          onSuccess={handleRefresh}
        />
      ))}
    </>
  );
};

const WorkCard = ({
  item,
  viewerAddress,
  onSuccess,
}: {
  item: WorkItem;
  viewerAddress?: string;
  onSuccess: () => void;
}) => {
  const isAssignedToViewer = Boolean(viewerAddress && item.assignee.toLowerCase() === viewerAddress.toLowerCase());
  const isOpen = isUnassignedWork(item);
  const payoutDisplay = formatUnits(item.payout, USDC_DECIMALS);

  const copyWorkerAddress = async () => {
    if (!viewerAddress) return;
    await navigator.clipboard.writeText(viewerAddress);
  };

  return (
    <article className="rounded-xl border border-base-300 bg-base-100 p-5 transition-colors hover:border-base-content/25">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-base-content/45">
              #{item.projectId.toString().padStart(3, "0")} · unit {item.milestoneIndex + 1}
            </span>
            <StatusBadge status={item.status} />
          </div>
          {/* Wave-2: heading = per-milestone deliverable when present, falling back
              to the project-level Result. The R/A/P/A/F blocks below come from the
              same source (contract OR legacy regex parse), so they're project-level
              for contract-driven projects and per-milestone for legacy ones. */}
          <h2 className="mt-3 text-xl font-semibold tracking-tight">
            {item.deliverable || item.result || `Milestone ${item.milestoneIndex + 1}`}
          </h2>
          {item.deliverable && item.result && item.deliverable !== item.result && (
            <p className="mt-1.5 text-xs text-base-content/55">{item.result}</p>
          )}
          <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <InfoBlock label="Acceptance" value={item.acceptance || "Client reviews the submitted proof package."} />
            <InfoBlock label="Proof package" value={item.proof || item.submissionNote || "Not declared yet."} />
            {item.authority && <InfoBlock label="Authority" value={item.authority} />}
            {item.failure && <InfoBlock label="Failure / revision" value={item.failure} />}
          </div>
        </div>

        <div className="shrink-0 rounded-lg border border-base-300 bg-base-200 p-4 lg:w-64">
          <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45">Payout</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
            {payoutDisplay} <span className="text-sm text-base-content/45">USDC</span>
          </p>
          <div className="mt-4 space-y-3 text-xs">
            <Party label="Client" address={item.client} />
            {item.pm !== ZERO_ADDRESS && <Party label="PM" address={item.pm} />}
            {item.assignee !== ZERO_ADDRESS && <Party label="Worker" address={item.assignee} />}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-base-300 pt-4">
        <Link href={`/projects/${item.projectId}`} className="btn btn-sm bg-base-200 border border-base-300">
          View contract
        </Link>
        {isOpen && (
          <>
            <span className="text-xs text-base-content/55">
              Discovery-only: ask the client or PM to assign your worker address.
            </span>
            {viewerAddress && (
              <button className="btn btn-outline btn-sm" onClick={copyWorkerAddress}>
                Copy my worker address
              </button>
            )}
          </>
        )}
        {isAssignedToViewer && (
          <ApprovalActions
            projectId={item.projectId}
            milestoneIndex={item.milestoneIndex}
            status={item.status}
            assignee={item.assignee}
            role="assignee"
            onSuccess={onSuccess}
          />
        )}
      </div>
    </article>
  );
};

const InfoBlock = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45">{label}</p>
    <p className="mt-1 leading-relaxed text-base-content/70">{value}</p>
  </div>
);

const Party = ({ label, address }: { label: string; address: string }) => (
  <div>
    <p className="mb-1 text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45">{label}</p>
    <div className="address-mono">
      <Address address={address} size="xs" />
    </div>
  </div>
);

const WorkCardSkeleton = () => (
  <div className="rounded-xl border border-base-300 bg-base-100 p-5 animate-pulse">
    <div className="h-4 w-32 rounded bg-base-200" />
    <div className="mt-4 h-6 w-2/3 rounded bg-base-200" />
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      <div className="h-16 rounded bg-base-200" />
      <div className="h-16 rounded bg-base-200" />
    </div>
  </div>
);

export default WorkPage;
