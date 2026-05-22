/**
 * Arc Testnet chain client + ChordEscrow event watching / view reads.
 *
 * Wiring contract:
 *   const unsubscribe = watchMilestoneAssigned({
 *     escrowAddress, mySCA,
 *     onMatch: ({ projectId, milestoneIndex }) => handleAssignment(...)
 *   });
 *   const m = await readMilestone({ escrowAddress, projectId, milestoneIndex });
 *
 * The viem chain is defined inline because Arc Testnet is not in viem/chains.
 * `nativeCurrency` reflects the 18-decimal native gas view per
 * [[arc-testnet-facts]]; the 6-decimal USDC ERC-20 view is a separate path
 * handled by the contracts, not the RPC client.
 */
import { createPublicClient, defineChain, getAddress, http, type Address, type Hex } from "viem";
import { chordEscrowAbi, type MilestoneStatusValue } from "./chord-escrow-abi.js";
import { config } from "./config.js";

export const arcTestnet = defineChain({
  id: config.arcChainId, // 5042002
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: {
    // Arc uses USDC as native gas, with 18-decimal native accounting (see
    // arc-testnet-facts.md). This matters for viem's gas math, not for
    // ERC-20 balance reads — those still use the 6-decimal interface.
    name: "USD Coin",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [config.arcRpcUrl] },
    public: { http: [config.arcRpcUrl] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: config.arcExplorer },
  },
  testnet: true,
});

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(config.arcRpcUrl),
});

export interface MilestoneAssignedEvent {
  projectId: bigint;
  milestoneIndex: bigint;
  assignee: Address;
  assignedBy: Address;
  blockNumber: bigint;
  transactionHash: Hex;
}

export interface WatchMilestoneAssignedOpts {
  escrowAddress: Address;
  mySCA: Address;
  onMatch: (event: MilestoneAssignedEvent) => void;
  onError?: (err: Error) => void;
}

/**
 * Subscribe to MilestoneAssigned where `assignee == mySCA`.
 * Returns an unsubscribe function. The filter is applied server-side via
 * `watchContractEvent.args` (indexed `assignee` field).
 */
export function watchMilestoneAssigned(opts: WatchMilestoneAssignedOpts): () => void {
  const filterAssignee = getAddress(opts.mySCA);
  const unwatch = publicClient.watchContractEvent({
    address: getAddress(opts.escrowAddress),
    abi: chordEscrowAbi,
    eventName: "MilestoneAssigned",
    args: { assignee: filterAssignee },
    onLogs: logs => {
      for (const log of logs) {
        // viem decodes named args from the ABI when available.
        const args = log.args as {
          projectId?: bigint;
          milestoneIndex?: bigint;
          assignee?: Address;
          assignedBy?: Address;
        };
        if (
          args.projectId === undefined ||
          args.milestoneIndex === undefined ||
          args.assignee === undefined ||
          args.assignedBy === undefined
        ) {
          continue;
        }
        // Defense-in-depth — the server filter already restricts assignee,
        // but reorgs / topic encoding bugs have been known to slip through.
        if (getAddress(args.assignee) !== filterAssignee) continue;
        opts.onMatch({
          projectId: args.projectId,
          milestoneIndex: args.milestoneIndex,
          assignee: args.assignee,
          assignedBy: args.assignedBy,
          blockNumber: log.blockNumber ?? 0n,
          transactionHash: log.transactionHash ?? ("0x" as Hex),
        });
      }
    },
    onError: err => {
      if (opts.onError) opts.onError(err);
      else console.warn("[chord:chain] watch error:", err);
    },
  });
  return unwatch;
}

export interface ReadMilestoneResult {
  description: string;
  amount: bigint;
  assignee: Address;
  status: MilestoneStatusValue;
  createdAt: bigint;
  submittedAt: bigint;
  submissionNote: string;
}

export async function readMilestone(opts: {
  escrowAddress: Address;
  projectId: bigint;
  milestoneIndex: bigint;
}): Promise<ReadMilestoneResult> {
  const raw = (await publicClient.readContract({
    address: getAddress(opts.escrowAddress),
    abi: chordEscrowAbi,
    functionName: "getMilestone",
    args: [opts.projectId, opts.milestoneIndex],
  })) as readonly [string, bigint, Address, number, bigint, bigint, string];

  return {
    description: raw[0],
    amount: raw[1],
    assignee: raw[2],
    status: raw[3] as MilestoneStatusValue,
    createdAt: raw[4],
    submittedAt: raw[5],
    submissionNote: raw[6],
  };
}
