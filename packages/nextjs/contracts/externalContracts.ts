import { hardhat } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";
import type { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

/**
 * @example
 * const externalContracts = {
 *   1: {
 *     DAI: {
 *       address: "0x...",
 *       abi: [...],
 *     },
 *   },
 * } as const;
 */
const externalContracts = {
  [hardhat.id]: {
    ChordEscrow: {
      // Deterministic Hardhat deploy address after MockUSDC deploys first.
      address: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
      abi: deployedContracts[5042002].ChordEscrow.abi,
    },
  },
} as const;

export default externalContracts satisfies GenericContractsDeclaration;
