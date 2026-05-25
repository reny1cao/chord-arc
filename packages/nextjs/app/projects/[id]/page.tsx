"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatUnits } from "viem";
import { hardhat } from "viem/chains";
import { MilestoneStatus, StatusBadge } from "~~/components/escrow/StatusBadge";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { getRoleLabel, useProjectRole } from "~~/hooks/useProjectRole";
import { useWorkContract } from "~~/hooks/useWorkContract";
import { USDC_DECIMALS } from "~~/utils/erc20";
import { type WorkContract } from "~~/types/contract";
import { type WorkContractSections, parseWorkContractSections } from "~~/utils/workContracts";

// Dynamic import for heavy component (418 lines) - only loads when needed
const ApprovalActions = dynamic(
  () => import("~~/components/escrow/ApprovalActions").then(mod => ({ default: mod.ApprovalActions })),
  {
    loading: () => <div className="h-10" />,
    ssr: false,
  },
);

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

interface ProjectStats {
  totalMilestones: bigint;
  completedMilestones: bigint;
  paidMilestones: bigint;
  remainingAmount: bigint;
  assignedMilestones: bigint;
  acceptedMilestones: bigint;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const ProjectDetailPage: NextPage = () => {
  const params = useParams();
  const router = useRouter();
  const projectId = Number(params.id);
  const { targetNetwork } = useTargetNetwork();

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

  const {
    data: statsData,
    isLoading: isLoadingStats,
    refetch: refetchStats,
  } = useScaffoldReadContract({
    contractName: "ChordEscrow",
    functionName: "getProjectStats",
    args: [BigInt(projectId)],
  });

  // Parse project data - handle array return type
  // ChordEscrow.getProject (wave-1+) returns:
  // (client, pm, pmFeeBps, totalAmount, totalPaid, totalPmFees, active, milestoneCount, contractURI)
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

  // Parse milestones data - handle array return type
  // getAllMilestones returns: (descriptions, amounts, assignees, statuses, submittedAts, submissionNotes)
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

  // Parse stats data - handle array return type
  // getProjectStats returns: (totalMilestones, completedMilestones, paidMilestones, remainingAmount, assignedMilestones, acceptedMilestones)
  const stats = useMemo((): ProjectStats | undefined => {
    if (!statsData) return undefined;
    if (Array.isArray(statsData)) {
      return {
        totalMilestones: statsData[0] as bigint,
        completedMilestones: statsData[1] as bigint,
        paidMilestones: statsData[2] as bigint,
        remainingAmount: statsData[3] as bigint,
        assignedMilestones: statsData[4] as bigint,
        acceptedMilestones: statsData[5] as bigint,
      };
    }
    return statsData as unknown as ProjectStats;
  }, [statsData]);

  // Check if project data is valid
  const isProjectValid = project?.client;
  const isDataReady = isProjectValid && milestones?.descriptions && stats;

  // Wave-2: pull the off-chain WorkContract (R/A/P/A/F) referenced by the
  // project's contractURI. Empty URI == legacy project; the hook returns
  // {contract: undefined, isLoading: false} and we render the per-milestone
  // fallback below.
  const {
    contract: workContract,
    isLoading: isLoadingContract,
    error: contractError,
  } = useWorkContract(project?.contractURI);

  // Legacy-only: when there's no contract URI we used to parse R/A/P/A/F out
  // of milestone descriptions. We preserve that for older deployments — but
  // only pull it from the first non-empty milestone (project-level scope).
  const legacySections = useMemo(() => {
    if (workContract || !milestones?.descriptions?.length) return undefined;
    for (const desc of milestones.descriptions) {
      const parsed = parseWorkContractSections(desc);
      if (parsed.authority || parsed.proof || parsed.acceptance || parsed.failure) {
        return parsed;
      }
    }
    return undefined;
  }, [workContract, milestones?.descriptions]);

  const role = useProjectRole(
    isProjectValid
      ? {
          client: project.client,
          pm: project.pm,
          assignees: milestones?.assignees,
        }
      : undefined,
  );

  const assignees = milestones?.assignees;

  // Get unique assignees (workers) from milestones
  const uniqueAssignees = useMemo(() => {
    if (!assignees) return [];
    const unique = [...new Set(assignees)].filter(addr => addr && addr !== ZERO_ADDRESS);
    return unique;
  }, [assignees]);

  const handleRefresh = () => {
    refetchProject();
    refetchMilestones();
    refetchStats();
  };

  // Loading state — render the page chrome instantly + skeleton slots.
  // This keeps the navigation transition smooth instead of a full-page swap.
  if (isLoadingProject || isLoadingMilestones || isLoadingStats) {
    return <ProjectDetailSkeleton projectId={projectId} onBack={() => router.push("/projects")} />;
  }

  // Data not ready
  if (!isDataReady) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-base-content/45">Not found</div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">Project unavailable</h2>
        <p className="mt-2 text-sm text-base-content/65 max-w-sm mx-auto">
          We couldn&apos;t load this project. It may not exist on the current network.
        </p>
        <button className="btn btn-primary mt-6" onClick={() => router.push("/projects")}>
          Back to projects
        </button>
      </div>
    );
  }

  const pmFeePercent = Number(project.pmFeeBps) / 100;
  const progressPercent =
    Number(stats.totalMilestones) > 0 ? (Number(stats.completedMilestones) / Number(stats.totalMilestones)) * 100 : 0;

  const roleStyle: Record<string, string> = {
    client: "text-primary bg-primary/10 border-primary/20",
    assignee: "text-base-content bg-base-100 border-base-content/20",
    pm: "text-warning bg-warning/10 border-warning/20",
    none: "text-base-content/55 bg-base-200 border-base-300",
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
        <div>
          <button
            className="inline-flex items-center gap-1 text-xs text-base-content/55 hover:text-base-content"
            onClick={() => router.push("/projects")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="h-3.5 w-3.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to projects
          </button>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="font-mono text-sm text-base-content/45">#{projectId.toString().padStart(3, "0")}</span>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Project</h1>
          </div>
        </div>
        <div className="flex gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
              roleStyle[role] ?? roleStyle.none
            }`}
          >
            {getRoleLabel(role)}
          </span>
          {!project.active && (
            <span className="inline-flex items-center rounded-full bg-error/10 text-error border border-error/25 px-3 py-1 text-xs font-semibold">
              Closed
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Progress Card */}
          <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
            <h2 className="text-base font-semibold tracking-tight">Progress</h2>
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-base-content/55">
                  <span className="font-mono text-base-content">
                    {Number(stats.completedMilestones)}/{Number(stats.totalMilestones)}
                  </span>{" "}
                  milestones completed
                </span>
                <span className="font-mono font-semibold tabular-nums">{progressPercent.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-300">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="mt-6 border-t border-base-300 pt-5 grid grid-cols-2 sm:grid-cols-4 gap-px bg-base-300 rounded-lg overflow-hidden border border-base-300">
              <ProgressStat label="Total" value={formatUnits(project.totalAmount, USDC_DECIMALS)} />
              <ProgressStat label="Paid" value={formatUnits(project.totalPaid, USDC_DECIMALS)} />
              <ProgressStat label="Remaining" value={formatUnits(stats.remainingAmount, USDC_DECIMALS)} />
              {project.pm !== ZERO_ADDRESS ? (
                <ProgressStat label="PM fees" value={formatUnits(project.totalPmFees, USDC_DECIMALS)} />
              ) : (
                <ProgressStat label="PM fees" value="—" muted />
              )}
            </div>
          </div>

          {/* Contract terms — rendered once at the project level (wave-2 R/A/P/A/F).
              When the project carries a contractURI, the off-chain WorkContract is
              the canonical source. When it doesn't (legacy), we fall back to the
              first milestone description that contains the section markers. */}
          <ContractTermsCard
            contract={workContract}
            isLoading={isLoadingContract}
            error={contractError}
            legacy={legacySections}
            hasContractURI={Boolean(project.contractURI)}
          />

          {/* Milestones */}
          <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
            <h2 className="text-base font-semibold tracking-tight">Milestones</h2>
            <div className="mt-5 space-y-3">
              {milestones.descriptions.map((description, index) => {
                const status = Number(milestones.statuses[index]);
                const amount = milestones.amounts[index];
                const assignee = milestones.assignees[index];
                const submissionNote = milestones.submissionNotes[index];
                const isUnassigned = !assignee || assignee === ZERO_ADDRESS;
                // Wave-2: when a contract is loaded, the on-chain description IS the
                // per-deliverable summary. Otherwise we strip the R/A/P/A/F sections
                // and surface just the headline for the milestone heading.
                const heading = workContract
                  ? description.trim() || `Milestone ${index + 1}`
                  : parseWorkContractSections(description).result || description.trim() || `Milestone ${index + 1}`;

                const isPaid = status === MilestoneStatus.Paid;
                return (
                  <div
                    key={index}
                    className="relative rounded-xl border border-base-300 bg-base-100 p-5 overflow-hidden"
                  >
                    {isPaid && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-success/60" />}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-base-200 border border-base-300 text-xs font-mono font-semibold text-base-content/55">
                          {isPaid ? (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={2.5}
                              stroke="currentColor"
                              className="h-3.5 w-3.5 text-success"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          ) : (
                            <span>{index + 1}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold tracking-tight leading-snug">{heading}</h3>
                          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                            <p className="font-mono text-sm tabular-nums text-base-content/80">
                              {formatUnits(amount, USDC_DECIMALS)}{" "}
                              <span className="text-base-content/45 font-normal">USDC</span>
                            </p>
                            {project.pm !== ZERO_ADDRESS && (
                              <p className="text-xs text-base-content/50">
                                PM fee {formatUnits((amount * project.pmFeeBps) / 10000n, USDC_DECIMALS)} (
                                {pmFeePercent}%)
                              </p>
                            )}
                          </div>
                          {!isUnassigned && (
                            <div className="mt-3 flex items-center gap-2 address-mono text-xs text-base-content/55">
                              <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/40">
                                Worker
                              </span>
                              <Address
                                address={assignee}
                                chain={targetNetwork}
                                size="xs"
                                blockExplorerAddressLink={
                                  targetNetwork.id === hardhat.id ? `/blockexplorer/address/${assignee}` : undefined
                                }
                              />
                            </div>
                          )}
                          {isUnassigned && status === MilestoneStatus.Created && (
                            <p className="mt-2 text-xs text-base-content/50">
                              Unassigned — waiting for the client or PM to assign a verified worker.
                            </p>
                          )}
                        </div>
                      </div>
                      <StatusBadge status={status} />
                    </div>

                    {submissionNote && status >= MilestoneStatus.Submitted && (
                      <div className="mt-4 ml-10 rounded-lg bg-base-200/60 border border-base-300 px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45 mb-1">
                          Deliverable
                        </p>
                        <p className="font-mono text-[12px] leading-relaxed text-base-content/80 break-all max-h-24 overflow-y-auto">
                          {submissionNote}
                        </p>
                      </div>
                    )}

                    <div className="mt-4 ml-11">
                      <ApprovalActions
                        projectId={projectId}
                        milestoneIndex={index}
                        status={status}
                        assignee={assignee}
                        role={role}
                        onSuccess={handleRefresh}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Participants */}
          <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
            <h2 className="text-base font-semibold tracking-tight">Participants</h2>
            <div className="mt-5 space-y-5">
              <ParticipantRow
                label="Client"
                address={project.client}
                chain={targetNetwork}
                explorerOverride={
                  targetNetwork.id === hardhat.id ? `/blockexplorer/address/${project.client}` : undefined
                }
              />

              {project.pm !== ZERO_ADDRESS && (
                <ParticipantRow
                  label={`Project manager · ${pmFeePercent}% fee`}
                  address={project.pm}
                  chain={targetNetwork}
                  explorerOverride={
                    targetNetwork.id === hardhat.id ? `/blockexplorer/address/${project.pm}` : undefined
                  }
                />
              )}

              {uniqueAssignees.length > 0 ? (
                <div>
                  <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45 mb-2">
                    Worker{uniqueAssignees.length > 1 ? "s" : ""} ({uniqueAssignees.length})
                  </p>
                  <div className="space-y-2 address-mono">
                    {uniqueAssignees.map((assignee, idx) => (
                      <Address
                        key={idx}
                        address={assignee}
                        chain={targetNetwork}
                        blockExplorerAddressLink={
                          targetNetwork.id === hardhat.id ? `/blockexplorer/address/${assignee}` : undefined
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45 mb-2">
                    Workers
                  </p>
                  <p className="text-sm text-base-content/55">No workers assigned yet.</p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
            <h2 className="text-base font-semibold tracking-tight">Quick stats</h2>
            <dl className="mt-5 divide-y divide-base-300 -mx-6">
              <QuickStat label="Status" value={project.active ? "Active" : "Inactive"} />
              <QuickStat label="Milestones" value={Number(stats.totalMilestones).toString()} mono />
              <QuickStat label="Assigned" value={Number(stats.assignedMilestones).toString()} mono />
              <QuickStat label="Accepted" value={Number(stats.acceptedMilestones).toString()} mono />
              <QuickStat label="Paid out" value={formatUnits(project.totalPaid, USDC_DECIMALS)} suffix="USDC" mono />
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ───────────────────── Subcomponents ───────────────────── */

const RAPAF_LABELS: Array<{ key: keyof WorkContract; label: string; hint: string }> = [
  { key: "result", label: "Result", hint: "What gets delivered" },
  { key: "authority", label: "Authority", hint: "What the worker may / may not do" },
  { key: "proof", label: "Proof", hint: "Evidence required at submission" },
  { key: "acceptance", label: "Acceptance", hint: "Pass criteria" },
  { key: "failure", label: "Failure", hint: "Revision / reject rules" },
];

const ContractTermsCard = ({
  contract,
  isLoading,
  error,
  legacy,
  hasContractURI,
}: {
  contract: WorkContract | undefined;
  isLoading: boolean;
  error: string | undefined;
  legacy: WorkContractSections | undefined;
  hasContractURI: boolean;
}) => {
  if (hasContractURI && isLoading) {
    return (
      <div className="rounded-2xl border border-base-300 bg-base-100 p-6 animate-pulse">
        <SkelLine width="6rem" height="0.875rem" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="space-y-2">
              <SkelLine width="4rem" height="0.625rem" />
              <SkelLine width="100%" />
              <SkelLine width="80%" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (hasContractURI && error) {
    return (
      <div className="rounded-2xl border border-warning/40 bg-warning/5 p-6">
        <h2 className="text-base font-semibold tracking-tight">Contract terms</h2>
        <p className="mt-2 text-sm text-warning">
          Could not load the off-chain contract for this project ({error}). The on-chain URI is
          present but the JSON could not be fetched or verified.
        </p>
      </div>
    );
  }

  const source: Pick<WorkContract, "result" | "authority" | "proof" | "acceptance" | "failure"> | undefined = contract
    ? contract
    : legacy
      ? {
          result: legacy.result,
          authority: legacy.authority,
          proof: legacy.proof,
          acceptance: legacy.acceptance,
          failure: legacy.failure,
        }
      : undefined;

  if (!source) {
    // No URI and no legacy sections — nothing meaningful to render. Keep the
    // detail page clean by not surfacing an empty card.
    return null;
  }

  return (
    <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold tracking-tight">Contract terms</h2>
        <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45">
          {contract ? "Off-chain" : "Legacy"}
        </span>
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {RAPAF_LABELS.map(({ key, label, hint }) => {
          const value = (source[key as keyof typeof source] as string | undefined)?.trim();
          if (!value) return null;
          return (
            <div key={key}>
              <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45">{label}</p>
              <p className="text-[10px] text-base-content/40 mt-0.5">{hint}</p>
              <p className="mt-2 text-sm leading-relaxed text-base-content/80 whitespace-pre-wrap break-words">
                {value}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ProgressStat = ({ label, value, muted }: { label: string; value: string; muted?: boolean }) => (
  <div className="bg-base-100 px-4 py-3">
    <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45">{label}</p>
    <p
      className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
        muted ? "text-base-content/45" : "text-base-content"
      }`}
    >
      {value}
    </p>
  </div>
);

const ParticipantRow = ({
  label,
  address,
  chain,
  explorerOverride,
}: {
  label: string;
  address: string;
  chain: ReturnType<typeof useTargetNetwork>["targetNetwork"];
  explorerOverride?: string;
}) => (
  <div>
    <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-base-content/45 mb-2">{label}</p>
    <div className="address-mono">
      <Address address={address} chain={chain} blockExplorerAddressLink={explorerOverride} />
    </div>
  </div>
);

const QuickStat = ({
  label,
  value,
  suffix,
  mono,
}: {
  label: string;
  value: string;
  suffix?: string;
  mono?: boolean;
}) => (
  <div className="px-6 py-3 flex items-baseline justify-between">
    <span className="text-xs text-base-content/55">{label}</span>
    <span className={`text-sm font-semibold tabular-nums ${mono ? "font-mono" : ""}`}>
      {value}
      {suffix && <span className="ml-1 text-base-content/45 font-normal">{suffix}</span>}
    </span>
  </div>
);

const ProjectDetailSkeleton = ({ projectId, onBack }: { projectId: number; onBack: () => void }) => (
  <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-rise">
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
      <div>
        <button
          className="inline-flex items-center gap-1 text-xs text-base-content/55 hover:text-base-content"
          onClick={onBack}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="h-3.5 w-3.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to projects
        </button>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-mono text-sm text-base-content/45">#{projectId.toString().padStart(3, "0")}</span>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Project</h1>
        </div>
      </div>
      <SkelChip />
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
          <SkelLine width="6rem" height="0.875rem" />
          <SkelLine className="mt-5" width="100%" height="0.375rem" />
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-px bg-base-300 rounded-lg overflow-hidden">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="bg-base-100 px-4 py-3 space-y-2">
                <SkelLine width="3rem" height="0.625rem" />
                <SkelLine width="4rem" height="1.125rem" />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-base-300 bg-base-100 p-6">
          <SkelLine width="6rem" height="0.875rem" />
          <div className="mt-5 space-y-3">
            {[0, 1].map(i => (
              <div key={i} className="rounded-xl border border-base-300 bg-base-100 p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-7 w-7 rounded-full bg-base-200 animate-pulse" />
                  <SkelLine width="60%" />
                </div>
                <SkelLine width="30%" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="rounded-2xl border border-base-300 bg-base-100 p-6 space-y-4">
          <SkelLine width="6rem" height="0.875rem" />
          <SkelLine width="80%" />
          <SkelLine width="70%" />
        </div>
        <div className="rounded-2xl border border-base-300 bg-base-100 p-6 space-y-3">
          <SkelLine width="6rem" height="0.875rem" />
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex justify-between">
              <SkelLine width="40%" height="0.75rem" />
              <SkelLine width="20%" height="0.75rem" />
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const SkelLine = ({
  width = "100%",
  height = "0.75rem",
  className = "",
}: {
  width?: string;
  height?: string;
  className?: string;
}) => <div className={`rounded-md bg-base-200 animate-pulse ${className}`} style={{ width, height }} />;

const SkelChip = () => <div className="h-6 w-20 rounded-full bg-base-200 animate-pulse" />;

export default ProjectDetailPage;
