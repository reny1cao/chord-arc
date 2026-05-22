/**
 * Minimal ABI fragment for ChordEscrow — only the bits the daemon touches.
 *
 * Wiring contract: imported by `chain.ts` (event watching + view reads).
 * Kept zero-dep on purpose so we don't pull typechain into the daemon.
 *
 * Faithful to packages/hardhat/contracts/ChordEscrow.sol — if the contract
 * signature changes, this file must be hand-updated. The `as const` is what
 * lets viem infer event/arg types end-to-end.
 */
export const chordEscrowAbi = [
  // ---- events ----
  {
    type: "event",
    name: "MilestoneAssigned",
    inputs: [
      { name: "projectId", type: "uint256", indexed: true },
      { name: "milestoneIndex", type: "uint256", indexed: false },
      { name: "assignee", type: "address", indexed: true },
      { name: "assignedBy", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "MilestoneAccepted",
    inputs: [
      { name: "projectId", type: "uint256", indexed: true },
      { name: "milestoneIndex", type: "uint256", indexed: false },
      { name: "assignee", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "MilestoneSubmitted",
    inputs: [
      { name: "projectId", type: "uint256", indexed: true },
      { name: "milestoneIndex", type: "uint256", indexed: false },
      { name: "note", type: "string", indexed: false },
    ],
    anonymous: false,
  },

  // ---- functions the daemon signs ----
  {
    type: "function",
    name: "acceptMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submitMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "note", type: "string" },
    ],
    outputs: [],
  },

  // ---- view the daemon reads to fetch the brief ----
  // Mirrors ChordEscrow.getMilestone exactly — 7 fields. Don't trim, viem will
  // misdecode if the shape doesn't match.
  {
    type: "function",
    name: "getMilestone",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
    ],
    outputs: [
      { name: "description", type: "string" },
      { name: "amount", type: "uint256" },
      { name: "assignee", type: "address" },
      { name: "status", type: "uint8" }, // MilestoneStatus enum → uint8
      { name: "createdAt", type: "uint256" },
      { name: "submittedAt", type: "uint256" },
      { name: "submissionNote", type: "string" },
    ],
  },
] as const;

/**
 * MilestoneStatus enum mirrored from Solidity. Same order as the contract.
 */
export const MilestoneStatus = {
  Created: 0,
  Assigned: 1,
  Accepted: 2,
  InProgress: 3,
  Submitted: 4,
  Approved: 5,
  Paid: 6,
} as const;

export type MilestoneStatusValue = (typeof MilestoneStatus)[keyof typeof MilestoneStatus];
