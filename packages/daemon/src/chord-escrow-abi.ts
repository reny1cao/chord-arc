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
  // PM agents subscribe to this so they can route each new project's milestones.
  // NOTE: `pm` is NOT indexed on-chain — the watcher in `chain.ts` must filter
  // client-side. Don't add `indexed: true` here; viem topic encoding would then
  // diverge from the on-chain event and the filter would match nothing.
  {
    type: "event",
    name: "ProjectCreated",
    inputs: [
      { name: "projectId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "pm", type: "address", indexed: false },
      { name: "pmFeeBps", type: "uint256", indexed: false },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "milestoneCount", type: "uint256", indexed: false },
      // Wave-2: off-chain WorkContract pointer. Empty string == legacy project
      // with R/A/P/A/F (if any) flattened into the milestone descriptions.
      { name: "contractURI", type: "string", indexed: false },
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

  // ---- function the PM agent signs ----
  {
    type: "function",
    name: "assignMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
      { name: "assignee", type: "address" },
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

  // ---- view the daemon reads to pick up the project's off-chain contract pointer ----
  // Mirrors ChordEscrow.getProject exactly — 9 fields, with the wave-1 `contractURI`
  // appended at the tail. Order must match the contract or viem will misdecode.
  {
    type: "function",
    name: "getProject",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [
      { name: "client", type: "address" },
      { name: "pm", type: "address" },
      { name: "pmFeeBps", type: "uint256" },
      { name: "totalAmount", type: "uint256" },
      { name: "totalPaid", type: "uint256" },
      { name: "totalPmFees", type: "uint256" },
      { name: "active", type: "bool" },
      { name: "milestoneCount", type: "uint256" },
      { name: "contractURI", type: "string" },
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
