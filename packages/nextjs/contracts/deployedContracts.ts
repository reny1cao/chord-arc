/**
 * Placeholder deployedContracts.ts stub.
 *
 * Stream B (frontend) writes this so that next:check-types succeeds before
 * the integrator runs the Hardhat deploy step. The deploy script regenerates
 * this file with the real on-chain address. Until then, the address is set to
 * the zero address; useDeployedContractInfo will report NOT_FOUND on-chain
 * which the UI handles via a deploy banner.
 */
import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

const deployedContracts = {
  5042002: {
    ChordEscrow: {
      address: "0x0000000000000000000000000000000000000000",
      deployedOnBlock: 0,
      abi: [
            {
                  "inputs": [
                        {
                              "internalType": "address",
                              "name": "usdcToken",
                              "type": "address"
                        }
                  ],
                  "stateMutability": "nonpayable",
                  "type": "constructor"
            },
            {
                  "inputs": [
                        {
                              "internalType": "address",
                              "name": "target",
                              "type": "address"
                        }
                  ],
                  "name": "AddressEmptyCode",
                  "type": "error"
            },
            {
                  "inputs": [
                        {
                              "internalType": "address",
                              "name": "account",
                              "type": "address"
                        }
                  ],
                  "name": "AddressInsufficientBalance",
                  "type": "error"
            },
            {
                  "inputs": [],
                  "name": "FailedInnerCall",
                  "type": "error"
            },
            {
                  "inputs": [],
                  "name": "ReentrancyGuardReentrantCall",
                  "type": "error"
            },
            {
                  "inputs": [
                        {
                              "internalType": "address",
                              "name": "token",
                              "type": "address"
                        }
                  ],
                  "name": "SafeERC20FailedOperation",
                  "type": "error"
            },
            {
                  "anonymous": false,
                  "inputs": [
                        {
                              "indexed": true,
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        },
                        {
                              "indexed": true,
                              "internalType": "address",
                              "name": "assignee",
                              "type": "address"
                        }
                  ],
                  "name": "MilestoneAccepted",
                  "type": "event"
            },
            {
                  "anonymous": false,
                  "inputs": [
                        {
                              "indexed": true,
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "assigneeAmount",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "pmFee",
                              "type": "uint256"
                        }
                  ],
                  "name": "MilestoneApproved",
                  "type": "event"
            },
            {
                  "anonymous": false,
                  "inputs": [
                        {
                              "indexed": true,
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        },
                        {
                              "indexed": true,
                              "internalType": "address",
                              "name": "assignee",
                              "type": "address"
                        },
                        {
                              "indexed": true,
                              "internalType": "address",
                              "name": "assignedBy",
                              "type": "address"
                        }
                  ],
                  "name": "MilestoneAssigned",
                  "type": "event"
            },
            {
                  "anonymous": false,
                  "inputs": [
                        {
                              "indexed": true,
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        },
                        {
                              "indexed": true,
                              "internalType": "address",
                              "name": "assignee",
                              "type": "address"
                        },
                        {
                              "indexed": false,
                              "internalType": "string",
                              "name": "reason",
                              "type": "string"
                        }
                  ],
                  "name": "MilestoneDeclined",
                  "type": "event"
            },
            {
                  "anonymous": false,
                  "inputs": [
                        {
                              "indexed": true,
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "amount",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "bool",
                              "name": "autoReleased",
                              "type": "bool"
                        }
                  ],
                  "name": "MilestonePaid",
                  "type": "event"
            },
            {
                  "anonymous": false,
                  "inputs": [
                        {
                              "indexed": true,
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "string",
                              "name": "reason",
                              "type": "string"
                        }
                  ],
                  "name": "MilestoneRejected",
                  "type": "event"
            },
            {
                  "anonymous": false,
                  "inputs": [
                        {
                              "indexed": true,
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        }
                  ],
                  "name": "MilestoneStarted",
                  "type": "event"
            },
            {
                  "anonymous": false,
                  "inputs": [
                        {
                              "indexed": true,
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "string",
                              "name": "note",
                              "type": "string"
                        }
                  ],
                  "name": "MilestoneSubmitted",
                  "type": "event"
            },
            {
                  "anonymous": false,
                  "inputs": [
                        {
                              "indexed": true,
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        },
                        {
                              "indexed": true,
                              "internalType": "address",
                              "name": "previousAssignee",
                              "type": "address"
                        }
                  ],
                  "name": "MilestoneUnassigned",
                  "type": "event"
            },
            {
                  "anonymous": false,
                  "inputs": [
                        {
                              "indexed": true,
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "refundAmount",
                              "type": "uint256"
                        }
                  ],
                  "name": "ProjectCancelled",
                  "type": "event"
            },
            {
                  "anonymous": false,
                  "inputs": [
                        {
                              "indexed": true,
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "indexed": true,
                              "internalType": "address",
                              "name": "client",
                              "type": "address"
                        },
                        {
                              "indexed": false,
                              "internalType": "address",
                              "name": "pm",
                              "type": "address"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "pmFeeBps",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "totalAmount",
                              "type": "uint256"
                        },
                        {
                              "indexed": false,
                              "internalType": "uint256",
                              "name": "milestoneCount",
                              "type": "uint256"
                        }
                  ],
                  "name": "ProjectCreated",
                  "type": "event"
            },
            {
                  "inputs": [],
                  "name": "ASSIGNMENT_TIMEOUT",
                  "outputs": [
                        {
                              "internalType": "uint256",
                              "name": "",
                              "type": "uint256"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [],
                  "name": "BPS_DENOMINATOR",
                  "outputs": [
                        {
                              "internalType": "uint256",
                              "name": "",
                              "type": "uint256"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [],
                  "name": "MAX_PM_FEE_BPS",
                  "outputs": [
                        {
                              "internalType": "uint256",
                              "name": "",
                              "type": "uint256"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [],
                  "name": "MIN_MILESTONE_AMOUNT",
                  "outputs": [
                        {
                              "internalType": "uint256",
                              "name": "",
                              "type": "uint256"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [],
                  "name": "TIMEOUT_PERIOD",
                  "outputs": [
                        {
                              "internalType": "uint256",
                              "name": "",
                              "type": "uint256"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        }
                  ],
                  "name": "acceptMilestone",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        }
                  ],
                  "name": "approveMilestone",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        },
                        {
                              "internalType": "address",
                              "name": "assignee",
                              "type": "address"
                        }
                  ],
                  "name": "assignMilestone",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        }
                  ],
                  "name": "cancelProject",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "address",
                              "name": "pm",
                              "type": "address"
                        },
                        {
                              "internalType": "uint256",
                              "name": "pmFeeBps",
                              "type": "uint256"
                        },
                        {
                              "internalType": "string[]",
                              "name": "descriptions",
                              "type": "string[]"
                        },
                        {
                              "internalType": "uint256[]",
                              "name": "amounts",
                              "type": "uint256[]"
                        },
                        {
                              "internalType": "address[]",
                              "name": "initialAssignees",
                              "type": "address[]"
                        }
                  ],
                  "name": "createProject",
                  "outputs": [
                        {
                              "internalType": "uint256",
                              "name": "",
                              "type": "uint256"
                        }
                  ],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        },
                        {
                              "internalType": "string",
                              "name": "reason",
                              "type": "string"
                        }
                  ],
                  "name": "declineMilestone",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        }
                  ],
                  "name": "emergencyReclaim",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        }
                  ],
                  "name": "expireAssignment",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "address",
                              "name": "addr",
                              "type": "address"
                        }
                  ],
                  "name": "getAddressRole",
                  "outputs": [
                        {
                              "internalType": "bool",
                              "name": "isClient",
                              "type": "bool"
                        },
                        {
                              "internalType": "bool",
                              "name": "isPM",
                              "type": "bool"
                        },
                        {
                              "internalType": "uint256[]",
                              "name": "assignedMilestones",
                              "type": "uint256[]"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        }
                  ],
                  "name": "getAllMilestones",
                  "outputs": [
                        {
                              "internalType": "string[]",
                              "name": "descriptions",
                              "type": "string[]"
                        },
                        {
                              "internalType": "uint256[]",
                              "name": "amounts",
                              "type": "uint256[]"
                        },
                        {
                              "internalType": "address[]",
                              "name": "assignees",
                              "type": "address[]"
                        },
                        {
                              "internalType": "enum ChordEscrow.MilestoneStatus[]",
                              "name": "statuses",
                              "type": "uint8[]"
                        },
                        {
                              "internalType": "uint256[]",
                              "name": "submittedAts",
                              "type": "uint256[]"
                        },
                        {
                              "internalType": "string[]",
                              "name": "submissionNotes",
                              "type": "string[]"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        }
                  ],
                  "name": "getMilestone",
                  "outputs": [
                        {
                              "internalType": "string",
                              "name": "description",
                              "type": "string"
                        },
                        {
                              "internalType": "uint256",
                              "name": "amount",
                              "type": "uint256"
                        },
                        {
                              "internalType": "address",
                              "name": "assignee",
                              "type": "address"
                        },
                        {
                              "internalType": "enum ChordEscrow.MilestoneStatus",
                              "name": "status",
                              "type": "uint8"
                        },
                        {
                              "internalType": "uint256",
                              "name": "createdAt",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "submittedAt",
                              "type": "uint256"
                        },
                        {
                              "internalType": "string",
                              "name": "submissionNote",
                              "type": "string"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        }
                  ],
                  "name": "getMilestoneTimestamps",
                  "outputs": [
                        {
                              "internalType": "uint256",
                              "name": "createdAt",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "assignedAt",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "acceptedAt",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "submittedAt",
                              "type": "uint256"
                        },
                        {
                              "internalType": "bool",
                              "name": "canAutoRelease",
                              "type": "bool"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        }
                  ],
                  "name": "getProject",
                  "outputs": [
                        {
                              "internalType": "address",
                              "name": "client",
                              "type": "address"
                        },
                        {
                              "internalType": "address",
                              "name": "pm",
                              "type": "address"
                        },
                        {
                              "internalType": "uint256",
                              "name": "pmFeeBps",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "totalAmount",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "totalPaid",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "totalPmFees",
                              "type": "uint256"
                        },
                        {
                              "internalType": "bool",
                              "name": "active",
                              "type": "bool"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneCount",
                              "type": "uint256"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        }
                  ],
                  "name": "getProjectStats",
                  "outputs": [
                        {
                              "internalType": "uint256",
                              "name": "totalMilestones",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "completedMilestones",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "paidMilestones",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "remainingAmount",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "assignedMilestones",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "acceptedMilestones",
                              "type": "uint256"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [],
                  "name": "projectCount",
                  "outputs": [
                        {
                              "internalType": "uint256",
                              "name": "",
                              "type": "uint256"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "",
                              "type": "uint256"
                        }
                  ],
                  "name": "projects",
                  "outputs": [
                        {
                              "internalType": "address",
                              "name": "client",
                              "type": "address"
                        },
                        {
                              "internalType": "address",
                              "name": "pm",
                              "type": "address"
                        },
                        {
                              "internalType": "uint256",
                              "name": "pmFeeBps",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "totalAmount",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "totalPaid",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "totalPmFees",
                              "type": "uint256"
                        },
                        {
                              "internalType": "bool",
                              "name": "active",
                              "type": "bool"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        },
                        {
                              "internalType": "string",
                              "name": "reason",
                              "type": "string"
                        }
                  ],
                  "name": "rejectMilestone",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        }
                  ],
                  "name": "releaseMilestone",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        }
                  ],
                  "name": "startMilestone",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        },
                        {
                              "internalType": "string",
                              "name": "note",
                              "type": "string"
                        }
                  ],
                  "name": "submitMilestone",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [
                        {
                              "internalType": "uint256",
                              "name": "projectId",
                              "type": "uint256"
                        },
                        {
                              "internalType": "uint256",
                              "name": "milestoneIndex",
                              "type": "uint256"
                        }
                  ],
                  "name": "unassignMilestone",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
            },
            {
                  "inputs": [],
                  "name": "usdc",
                  "outputs": [
                        {
                              "internalType": "contract IERC20",
                              "name": "",
                              "type": "address"
                        }
                  ],
                  "stateMutability": "view",
                  "type": "function"
            }
      ] as const,
    },
  },
} as const;

export default deployedContracts satisfies GenericContractsDeclaration;
