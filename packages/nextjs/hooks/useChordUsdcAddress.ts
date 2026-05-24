import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { getStaticUsdcAddress, isArcNetwork, isLocalhostNetwork } from "~~/utils/chordNetwork";

const CHORD_ESCROW_USDC_ABI = [
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

type UseChordUsdcAddressArgs = {
  chainId?: number;
  escrowAddress?: Address;
};

export const useChordUsdcAddress = ({ chainId, escrowAddress }: UseChordUsdcAddressArgs = {}) => {
  const { targetNetwork } = useTargetNetwork();
  const effectiveChainId = chainId ?? targetNetwork.id;
  const staticUsdcAddress = useMemo(() => getStaticUsdcAddress(effectiveChainId), [effectiveChainId]);
  const shouldReadEscrowUsdc = !staticUsdcAddress && isLocalhostNetwork(effectiveChainId) && Boolean(escrowAddress);

  const {
    data: escrowUsdcAddress,
    isLoading,
    error,
  } = useReadContract({
    chainId: effectiveChainId,
    address: escrowAddress,
    abi: CHORD_ESCROW_USDC_ABI,
    functionName: "usdc",
    query: { enabled: shouldReadEscrowUsdc },
  });

  return {
    usdcAddress: staticUsdcAddress ?? escrowUsdcAddress,
    isLoading: shouldReadEscrowUsdc ? isLoading : false,
    error,
    source: staticUsdcAddress
      ? isArcNetwork(effectiveChainId)
        ? "arc"
        : "mock-usdc"
      : escrowUsdcAddress
        ? "escrow-usdc"
        : undefined,
  };
};
