import type { Address, Hash } from "viem";
import { hardhat } from "viem/chains";
import { ARC_USDC_ADDRESS, arcTestnet } from "~~/scaffold.config";
import { contracts } from "~~/utils/scaffold-eth/contract";

type ContractAddressMap = Record<string, { address: Address }>;

export const LOCALHOST_CHAIN_ID = hardhat.id;

export const isArcNetwork = (chainId?: number) => chainId === arcTestnet.id;
export const isLocalhostNetwork = (chainId?: number) => chainId === LOCALHOST_CHAIN_ID;

export const getStaticUsdcAddress = (chainId?: number): Address | undefined => {
  if (isArcNetwork(chainId)) {
    return ARC_USDC_ADDRESS;
  }

  if (isLocalhostNetwork(chainId)) {
    const localContracts = contracts?.[LOCALHOST_CHAIN_ID] as ContractAddressMap | undefined;
    return localContracts?.MockUSDC?.address;
  }

  return undefined;
};

export const getTransactionUrl = (chainId: number | undefined, hash: Hash) => {
  if (!isArcNetwork(chainId)) {
    return undefined;
  }

  const explorerBase = arcTestnet.blockExplorers?.default?.url ?? "https://testnet.arcscan.app";
  return `${explorerBase}/tx/${hash}`;
};
