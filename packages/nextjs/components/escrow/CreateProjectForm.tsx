"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AIMilestoneSplitter } from "./AIMilestoneSplitter";
import { formatUnits, isAddress, parseUnits } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth/useDeployedContractInfo";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth/useScaffoldWriteContract";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { ARC_USDC_ADDRESS, arcTestnet } from "~~/scaffold.config";
import { ERC20_ABI, USDC_DECIMALS } from "~~/utils/erc20";
import type { MilestoneSuggestion } from "~~/utils/mockAI";
import { notification } from "~~/utils/scaffold-eth";

interface MilestoneInput {
  description: string;
  amount: string;
  assignee: string; // Optional initial assignee
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ARCSCAN_TX = "https://testnet.arcscan.app/tx";

/** Safe parse — returns 0n on bad input so we never crash on partially-typed amounts. */
const safeParseUsdc = (raw: string): bigint => {
  try {
    if (!raw) return 0n;
    return parseUnits(raw, USDC_DECIMALS);
  } catch {
    return 0n;
  }
};

export const CreateProjectForm = () => {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const isArc = targetNetwork.id === arcTestnet.id;

  const [step, setStep] = useState(1);
  const [milestones, setMilestones] = useState<MilestoneInput[]>([]);
  const [pmAddress, setPmAddress] = useState("");
  const [pmFeeBps, setPmFeeBps] = useState("500"); // 5% default
  const [showAssignees, setShowAssignees] = useState(false);
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | null>(null);
  const [createTxHash, setCreateTxHash] = useState<`0x${string}` | null>(null);

  // Resolve the deployed ChordEscrow address from the SE-2 registry.
  const { data: escrowContract } = useDeployedContractInfo({ contractName: "ChordEscrow" });
  const escrowAddress = escrowContract?.address as `0x${string}` | undefined;
  const isEscrowDeployed = !!escrowAddress && escrowAddress !== ZERO_ADDRESS;

  // Total amount in USDC base units (6 decimals).
  const totalUsdc = useMemo(
    () => milestones.reduce<bigint>((sum, m) => sum + safeParseUsdc(m.amount), 0n),
    [milestones],
  );
  const totalUsdcDisplay = useMemo(() => formatUnits(totalUsdc, USDC_DECIMALS), [totalUsdc]);

  // Read current USDC allowance for the escrow.
  const {
    data: allowance,
    refetch: refetchAllowance,
    isLoading: isLoadingAllowance,
  } = useReadContract({
    address: ARC_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: connectedAddress && escrowAddress ? [connectedAddress, escrowAddress] : undefined,
    query: { enabled: Boolean(connectedAddress && escrowAddress) },
  });

  // Wagmi writers — one for the ERC-20 approve, one (via SE-2) for createProject.
  const { writeContractAsync: writeApprove, isPending: isApproving } = useWriteContract();
  const { writeContractAsync: writeEscrow, isMining: isCreating } = useScaffoldWriteContract({
    contractName: "ChordEscrow",
  });

  // Wait for the approval receipt before refetching allowance — wagmi's
  // writeContractAsync resolves on submission, not inclusion, so without this
  // the UI would sit on the stale allowance for up to one polling interval.
  const { data: approveReceipt, isLoading: isApproveMining } = useWaitForTransactionReceipt({
    hash: approveTxHash ?? undefined,
    query: { enabled: Boolean(approveTxHash) },
  });

  useEffect(() => {
    if (approveReceipt?.status === "success") {
      refetchAllowance();
    }
  }, [approveReceipt, refetchAllowance]);

  const allowanceSufficient = (allowance ?? 0n) >= totalUsdc && totalUsdc > 0n;
  const approvePending = isApproving || isApproveMining;

  const pmFeePercent = parseInt(pmFeeBps) / 100;

  const handleSuggestionsGenerated = (suggestions: MilestoneSuggestion[]) => {
    setMilestones(
      suggestions.map(s => ({
        description: s.acceptance
          ? `${s.description}\n\nAcceptance:\n- ${s.acceptance.replace(/ \/ /g, "\n- ")}`
          : s.description,
        amount: s.amount,
        assignee: "",
      })),
    );
    setStep(2);
  };

  const handleAddMilestone = () => {
    setMilestones([...milestones, { description: "", amount: "10", assignee: "" }]);
  };

  const handleRemoveMilestone = (index: number) => {
    setMilestones(milestones.filter((_, i) => i !== index));
  };

  const handleMilestoneChange = (index: number, field: keyof MilestoneInput, value: string) => {
    const updated = [...milestones];
    updated[index] = { ...updated[index], [field]: value };
    setMilestones(updated);
  };

  const isValidForm = () => {
    if (pmAddress && !isAddress(pmAddress)) return false;
    if (milestones.length === 0) return false;
    if (milestones.some(m => !m.description.trim() || safeParseUsdc(m.amount) <= 0n)) return false;
    if (milestones.some(m => m.assignee && !isAddress(m.assignee))) return false;
    return true;
  };

  const txLink = (hash: `0x${string}`) => (isArc ? `${ARCSCAN_TX}/${hash}` : undefined);

  const handleApprove = async () => {
    if (!escrowAddress) {
      notification.error("Escrow contract not deployed on this network yet");
      return;
    }
    if (totalUsdc <= 0n) {
      notification.error("Total amount must be greater than zero");
      return;
    }
    try {
      const hash = await writeApprove({
        address: ARC_USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [escrowAddress, totalUsdc],
      });
      setApproveTxHash(hash);
      const link = txLink(hash);
      notification.success(
        link ? (
          <span>
            Approval sent —{" "}
            <a href={link} target="_blank" rel="noreferrer" className="link">
              view on Arcscan
            </a>
          </span>
        ) : (
          "Approval sent"
        ),
      );
      // The useEffect above refetches allowance once the receipt lands.
    } catch (error) {
      console.error("Error approving USDC:", error);
      notification.error("Failed to approve USDC");
    }
  };

  const handleCreate = async () => {
    if (!isValidForm()) {
      notification.error("Please fill in all required fields correctly");
      return;
    }
    if (!isEscrowDeployed) {
      notification.error("Escrow contract not deployed on this network yet");
      return;
    }
    if (!allowanceSufficient) {
      notification.error("USDC allowance is insufficient — approve first");
      return;
    }

    try {
      const descriptions = milestones.map(m => m.description);
      const amounts = milestones.map(m => safeParseUsdc(m.amount));
      const pm = (pmAddress || ZERO_ADDRESS) as `0x${string}`;
      const fee = pmAddress ? parseInt(pmFeeBps) : 0;
      const hasAnyAssignee = milestones.some(m => m.assignee);
      const initialAssignees = (
        hasAnyAssignee ? milestones.map(m => (m.assignee || ZERO_ADDRESS) as `0x${string}`) : []
      ) as `0x${string}`[];

      const hash = await writeEscrow({
        functionName: "createProject",
        args: [pm, BigInt(fee), descriptions, amounts, initialAssignees],
      });
      if (hash) {
        setCreateTxHash(hash);
      }

      const link = hash ? txLink(hash) : undefined;
      notification.success(
        link ? (
          <span>
            Project created —{" "}
            <a href={link} target="_blank" rel="noreferrer" className="link">
              view on Arcscan
            </a>
          </span>
        ) : (
          "Project created successfully!"
        ),
      );
      router.push("/projects");
    } catch (error) {
      console.error("Error creating project:", error);
      notification.error("Failed to create project");
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      {/* Progress Steps */}
      <ul className="steps steps-horizontal w-full mb-8">
        <li className={`step ${step >= 1 ? "step-primary" : ""}`}>Describe Project</li>
        <li className={`step ${step >= 2 ? "step-primary" : ""}`}>Edit Milestones</li>
        <li className={`step ${step >= 3 ? "step-primary" : ""}`}>Approve & Create</li>
      </ul>

      {/* Step 1: AI Splitter */}
      {step === 1 && (
        <div className="space-y-6">
          <AIMilestoneSplitter onAccept={handleSuggestionsGenerated} />

          <div className="divider">OR</div>

          <div className="text-center">
            <button
              className="btn btn-outline"
              onClick={() => {
                setMilestones([{ description: "", amount: "10", assignee: "" }]);
                setStep(2);
              }}
            >
              Create Manually
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Edit Milestones */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <div className="flex justify-between items-center">
                <h3 className="card-title">Milestones</h3>
                <label className="flex cursor-pointer items-center gap-2">
                  <span className="text-sm">Assign workers now</span>
                  <input
                    type="checkbox"
                    className="toggle toggle-sm toggle-primary"
                    checked={showAssignees}
                    onChange={e => setShowAssignees(e.target.checked)}
                  />
                </label>
              </div>

              <div className="space-y-4">
                {milestones.map((milestone, index) => (
                  <div key={index} className="flex gap-4 items-start">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300 text-sm font-bold">
                      {index + 1}
                    </div>
                    <div className="flex-1 space-y-2">
                      <textarea
                        className="textarea textarea-bordered w-full min-h-[3rem]"
                        rows={milestone.description.includes("\n") ? 5 : 2}
                        placeholder="Milestone description"
                        value={milestone.description}
                        onChange={e => handleMilestoneChange(index, "description", e.target.value)}
                      />
                      <div className="flex gap-2">
                        <div className="join flex-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            className="input input-bordered join-item w-full"
                            placeholder="10"
                            value={milestone.amount}
                            onChange={e => handleMilestoneChange(index, "amount", e.target.value)}
                          />
                          <span className="join-item flex items-center bg-base-200 px-3 text-sm opacity-70">USDC</span>
                        </div>
                        <button
                          className="btn btn-ghost btn-square text-error"
                          onClick={() => handleRemoveMilestone(index)}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            className="h-5 w-5"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                            />
                          </svg>
                        </button>
                      </div>
                      {showAssignees && (
                        <input
                          type="text"
                          className={`input input-bordered input-sm w-full ${
                            milestone.assignee && !isAddress(milestone.assignee) ? "input-error" : ""
                          }`}
                          placeholder="Worker address (optional) 0x..."
                          value={milestone.assignee}
                          onChange={e => handleMilestoneChange(index, "assignee", e.target.value)}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button className="btn btn-outline btn-sm mt-4" onClick={handleAddMilestone}>
                + Add Milestone
              </button>

              <div className="divider" />

              <div className="flex justify-between items-center">
                <span className="font-semibold">Total Amount:</span>
                <span className="text-xl font-bold">{totalUsdcDisplay} USDC</span>
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setStep(3)}
              disabled={milestones.length === 0 || milestones.some(m => !m.description.trim())}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Configure & Create */}
      {step === 3 && (
        <div className="space-y-6">
          {!isEscrowDeployed && (
            <div className="alert alert-warning">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                className="stroke-current shrink-0 w-6 h-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
              <span>
                ChordEscrow is not deployed on <strong>{targetNetwork.name}</strong> yet. Ask the integrator to run{" "}
                <code className="text-xs">yarn deploy</code> against Arc Testnet.
              </span>
            </div>
          )}

          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h3 className="card-title">Project Configuration</h3>

              <div className="alert alert-info">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  className="stroke-current shrink-0 w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div>
                  <p className="text-sm">Workers can be assigned to each milestone after creation.</p>
                  <p className="text-xs opacity-70">
                    You can assign different workers — humans or AI agents — to different milestones.
                  </p>
                </div>
              </div>

              <div className="divider">Optional: Project Manager</div>

              <div className="space-y-2">
                <label htmlFor="pm-address" className="text-sm font-medium">
                  PM Address
                </label>
                <input
                  id="pm-address"
                  type="text"
                  className={`input input-bordered w-full ${pmAddress && !isAddress(pmAddress) ? "input-error" : ""}`}
                  placeholder="0x... (leave empty for no PM)"
                  value={pmAddress}
                  onChange={e => setPmAddress(e.target.value)}
                />
                <p className="text-xs opacity-70">PM can assign workers and earns commission</p>
              </div>

              {pmAddress && isAddress(pmAddress) && (
                <div className="space-y-2">
                  <label htmlFor="pm-fee" className="text-sm font-medium">
                    PM Fee (%)
                  </label>
                  <input
                    id="pm-fee"
                    type="range"
                    min="100"
                    max="2000"
                    step="100"
                    className="range range-primary"
                    value={pmFeeBps}
                    onChange={e => setPmFeeBps(e.target.value)}
                  />
                  <div className="flex justify-between text-xs px-2">
                    <span>1%</span>
                    <span className="font-bold">{pmFeePercent}%</span>
                    <span>20%</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card bg-base-200">
            <div className="card-body">
              <h3 className="card-title">Summary</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm opacity-70">Milestones</p>
                  <p className="font-bold">{milestones.length}</p>
                </div>
                <div>
                  <p className="text-sm opacity-70">Total Value</p>
                  <p className="font-bold">{totalUsdcDisplay} USDC</p>
                </div>
                <div>
                  <p className="text-sm opacity-70">Pre-assigned</p>
                  <p className="font-bold">{milestones.filter(m => m.assignee && isAddress(m.assignee)).length}</p>
                </div>
                {pmAddress && isAddress(pmAddress) && (
                  <div>
                    <p className="text-sm opacity-70">PM Fee</p>
                    <p className="font-bold">{pmFeePercent}%</p>
                  </div>
                )}
                <div>
                  <p className="text-sm opacity-70">Current USDC allowance</p>
                  <p className="font-bold">
                    {isLoadingAllowance ? "—" : `${formatUnits(allowance ?? 0n, USDC_DECIMALS)} USDC`}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Two-step USDC flow */}
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h3 className="card-title">Fund the escrow</h3>
              <p className="text-sm opacity-70">
                Funding takes two on-chain steps: first approve the escrow to pull{" "}
                <span className="font-semibold">{totalUsdcDisplay} USDC</span> from your wallet, then create the
                project. Both transactions pay gas in USDC on Arc.
              </p>

              <ol className="list-decimal list-inside space-y-3 mt-2">
                <li>
                  <span className={`font-medium ${allowanceSufficient ? "text-success line-through" : ""}`}>
                    Approve USDC ({totalUsdcDisplay})
                  </span>
                  {approveTxHash && isArc && (
                    <a
                      href={`${ARCSCAN_TX}/${approveTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="link text-xs ml-2"
                    >
                      tx ↗
                    </a>
                  )}
                </li>
                <li>
                  <span className={`font-medium ${createTxHash ? "text-success line-through" : ""}`}>
                    Create project on-chain
                  </span>
                  {createTxHash && isArc && (
                    <a
                      href={`${ARCSCAN_TX}/${createTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="link text-xs ml-2"
                    >
                      tx ↗
                    </a>
                  )}
                </li>
              </ol>
            </div>
          </div>

          <div className="flex justify-between gap-2">
            <button className="btn btn-ghost" onClick={() => setStep(2)}>
              Back
            </button>
            {allowanceSufficient ? (
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!isValidForm() || !isEscrowDeployed || isCreating}
              >
                {isCreating ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Creating…
                  </>
                ) : (
                  `Create project (${totalUsdcDisplay} USDC)`
                )}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={handleApprove}
                disabled={!isValidForm() || !isEscrowDeployed || approvePending || !connectedAddress}
              >
                {approvePending ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    {isApproveMining ? "Waiting for confirmation…" : "Approving…"}
                  </>
                ) : (
                  `Approve ${totalUsdcDisplay} USDC`
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
