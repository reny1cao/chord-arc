"use client";

// Milestone status enum values (matching ChordEscrow contract)
export enum MilestoneStatus {
  Created = 0,
  Assigned = 1,
  Accepted = 2,
  InProgress = 3,
  Submitted = 4,
  Approved = 5,
  Paid = 6,
}

interface StatusBadgeProps {
  status: MilestoneStatus | number;
  size?: "sm" | "md" | "lg";
}

interface BadgeConfig {
  label: string;
  className: string;
  showDot?: boolean;
  dotClass?: string;
}

const statusConfig: Record<MilestoneStatus, BadgeConfig> = {
  [MilestoneStatus.Created]: {
    label: "Open",
    className: "text-base-content/70 bg-base-200 border border-base-300",
    showDot: true,
    dotClass: "bg-base-content/40",
  },
  [MilestoneStatus.Assigned]: {
    label: "Assigned",
    className: "text-info bg-info/10 border border-info/20",
    showDot: true,
    dotClass: "bg-info",
  },
  [MilestoneStatus.Accepted]: {
    label: "Accepted",
    className: "text-info bg-info/15 border border-info/25",
    showDot: true,
    dotClass: "bg-info",
  },
  [MilestoneStatus.InProgress]: {
    label: "In progress",
    className: "text-warning bg-warning/10 border border-warning/20",
    showDot: true,
    dotClass: "bg-warning animate-pulse",
  },
  [MilestoneStatus.Submitted]: {
    label: "Submitted",
    className: "text-accent bg-accent/10 border border-accent/25",
    showDot: true,
    dotClass: "bg-accent animate-pulse",
  },
  [MilestoneStatus.Approved]: {
    label: "Approved",
    className: "text-success bg-success/10 border border-success/25",
    showDot: true,
    dotClass: "bg-success",
  },
  [MilestoneStatus.Paid]: {
    label: "Paid",
    className: "text-success bg-success/15 border border-success/30",
    showDot: true,
    dotClass: "bg-success",
  },
};

const sizeClass = {
  sm: "text-[10px] px-1.5 py-0.5 gap-1",
  md: "text-xs px-2.5 py-0.5 gap-1.5",
  lg: "text-sm px-3 py-1 gap-1.5",
};

export const StatusBadge = ({ status, size = "md" }: StatusBadgeProps) => {
  const config = statusConfig[status as MilestoneStatus] || statusConfig[MilestoneStatus.Created];

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold tracking-tight whitespace-nowrap ${config.className} ${sizeClass[size]}`}
    >
      {config.showDot && (
        <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
      )}
      {config.label}
    </span>
  );
};

export const getStatusLabel = (status: MilestoneStatus | number): string => {
  return statusConfig[status as MilestoneStatus]?.label || "Unknown";
};
