import type { Address as AddressType } from "viem";
import type { WorkContract } from "~~/types/contract";

export interface WorkContractSections {
  result: string;
  authority: string;
  proof: string;
  acceptance: string;
  failure: string;
  raw: string;
}

export interface WorkItem {
  projectId: number;
  milestoneIndex: number;
  status: number;
  result: string;
  authority: string;
  proof: string;
  acceptance: string;
  failure: string;
  /**
   * Wave-2: per-milestone deliverable summary. When the project carries an
   * off-chain WorkContract, this is the milestone description verbatim (short
   * one-liner). When no contract is supplied, this is the first non-blank line
   * of the legacy flat description — useful when callers want the milestone
   * label without re-running the section-splitter.
   */
  deliverable: string;
  payout: bigint;
  client: AddressType;
  pm: AddressType;
  assignee: AddressType;
  submissionNote: string;
}

const SECTION_LABELS = ["Result", "Authority", "Proof", "Acceptance", "Failure"] as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const WORK_STATUS = {
  Created: 0,
  Assigned: 1,
  Accepted: 2,
  InProgress: 3,
  Submitted: 4,
  Approved: 5,
  Paid: 6,
} as const;

const emptySections = (raw: string): WorkContractSections => ({
  result: raw.trim(),
  authority: "",
  proof: "",
  acceptance: "",
  failure: "",
  raw,
});

export function parseWorkContractSections(description: string): WorkContractSections {
  const raw = description.trim();
  if (!raw) return emptySections("");

  const pattern = new RegExp(`^(${SECTION_LABELS.join("|")}):\\s*$`, "gim");
  const matches = Array.from(raw.matchAll(pattern));
  if (matches.length === 0) return emptySections(raw);

  const values = new Map<string, string>();
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const next = matches[index + 1];
    const label = match[1]?.toLowerCase();
    if (!label) continue;
    const start = (match.index ?? 0) + match[0].length;
    const end = next?.index ?? raw.length;
    values.set(label, raw.slice(start, end).trim());
  }

  return {
    result: values.get("result") || raw,
    authority: values.get("authority") || "",
    proof: values.get("proof") || "",
    acceptance: values.get("acceptance") || "",
    failure: values.get("failure") || "",
    raw,
  };
}

function firstLine(text: string, max = 200): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const line = trimmed.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function buildWorkItems({
  projectId,
  client,
  pm,
  descriptions,
  amounts,
  assignees,
  statuses,
  submissionNotes,
  contract,
}: {
  projectId: number;
  client: string;
  pm: string;
  descriptions: readonly string[];
  amounts: readonly bigint[];
  assignees: readonly string[];
  statuses: readonly number[];
  submissionNotes: readonly string[];
  /**
   * Wave-2: project-level off-chain WorkContract. When provided, every
   * WorkItem gets R/A/P/A/F stamped from the contract — the milestone
   * `description` is treated as the per-deliverable summary. When omitted,
   * `parseWorkContractSections` runs against each description (legacy path).
   */
  contract?: WorkContract;
}): WorkItem[] {
  return descriptions.map((description, milestoneIndex) => {
    if (contract) {
      const deliverable = description.trim();
      return {
        projectId,
        milestoneIndex,
        status: Number(statuses[milestoneIndex] ?? WORK_STATUS.Created),
        result: contract.result,
        authority: contract.authority,
        proof: contract.proof,
        acceptance: contract.acceptance,
        failure: contract.failure,
        deliverable,
        payout: amounts[milestoneIndex] ?? 0n,
        client: client as AddressType,
        pm: pm as AddressType,
        assignee: (assignees[milestoneIndex] || ZERO_ADDRESS) as AddressType,
        submissionNote: submissionNotes[milestoneIndex] || "",
      };
    }

    const sections = parseWorkContractSections(description);
    return {
      projectId,
      milestoneIndex,
      status: Number(statuses[milestoneIndex] ?? WORK_STATUS.Created),
      result: sections.result,
      authority: sections.authority,
      proof: sections.proof,
      acceptance: sections.acceptance,
      failure: sections.failure,
      // Legacy path: use the first line of the raw description as a sensible
      // milestone label. The full parsed sections still live on result/etc.
      deliverable: firstLine(sections.raw),
      payout: amounts[milestoneIndex] ?? 0n,
      client: client as AddressType,
      pm: pm as AddressType,
      assignee: (assignees[milestoneIndex] || ZERO_ADDRESS) as AddressType,
      submissionNote: submissionNotes[milestoneIndex] || "",
    };
  });
}

export function isUnassignedWork(item: Pick<WorkItem, "status" | "assignee">): boolean {
  return item.status === WORK_STATUS.Created && item.assignee.toLowerCase() === ZERO_ADDRESS;
}

export function isActiveWorkStatus(status: number): boolean {
  return status === WORK_STATUS.Assigned || status === WORK_STATUS.Accepted || status === WORK_STATUS.InProgress;
}

export function isAwaitingReviewStatus(status: number): boolean {
  return status === WORK_STATUS.Submitted;
}

export function isSettledStatus(status: number): boolean {
  return status === WORK_STATUS.Paid || status === WORK_STATUS.Approved;
}
