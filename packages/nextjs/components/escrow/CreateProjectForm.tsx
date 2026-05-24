"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AIMilestoneSplitter } from "./AIMilestoneSplitter";
import { formatUnits, isAddress, parseUnits } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth/useDeployedContractInfo";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth/useScaffoldWriteContract";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useChordUsdcAddress } from "~~/hooks/useChordUsdcAddress";
import { getTransactionUrl, isArcNetwork } from "~~/utils/chordNetwork";
import { ERC20_ABI, USDC_DECIMALS } from "~~/utils/erc20";
import type { MilestoneSuggestion } from "~~/utils/mockAI";
import { notification } from "~~/utils/scaffold-eth";

interface MilestoneInput {
  description: string;
  amount: string;
  assignee: string; // Optional initial assignee
}

interface WorkContractDraft {
  result: string;
  authority: string;
  proof: string;
  acceptance: string;
  failure: string;
  amount: string;
}

interface WorkContractTemplate {
  name: string;
  description: string;
  draft: WorkContractDraft;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const EMPTY_CONTRACT_DRAFT: WorkContractDraft = {
  result: "",
  authority: "",
  proof: "",
  acceptance: "",
  failure: "",
  amount: "10",
};

const CONTRACT_TEMPLATES: WorkContractTemplate[] = [
  {
    name: "Market research brief",
    description: "A sourced brief that a user can review manually before payout.",
    draft: {
      result:
        "Research one narrowly-scoped market and deliver a concise evidence brief with the strongest signals, counter-signals, and a final recommendation.",
      authority:
        "May read public web pages, public prediction-market data, and user-provided context. Must not trade, contact third parties, spend money, or use private accounts.",
      proof:
        "Include source links, quoted evidence snippets, reasoning notes, uncertainty flags, and a final proof package summary.",
      acceptance:
        "At least five relevant sources are cited; claims are traceable to sources; uncertainty is explicit; the recommendation follows from the evidence.",
      failure:
        "Fabricated sources, missing evidence, or unsupported recommendations should be rejected or sent back for revision.",
      amount: "10",
    },
  },
  {
    name: "B2B leads",
    description: "A classic paid work unit with clear rows, sources, and acceptance rules.",
    draft: {
      result:
        "Deliver 30 B2B sales leads matching the supplied ICP. Each lead must include company, website, contact, role, source link, and fit rationale.",
      authority:
        "May read public web pages and user-provided ICP docs. Must not email prospects, buy paid data, scrape gated sources, or invent contact details.",
      proof:
        "Submit a CSV or spreadsheet plus source links, match reasons, rejected sample notes, and a short execution log.",
      acceptance:
        "At least 30 rows are delivered; at least 24 match the ICP; every row has a reachable source; obvious duplicates or fabricated contacts fail.",
      failure:
        "15-23 valid leads require revision. Fewer than 15 valid leads, fabricated data, or missing sources can be rejected.",
      amount: "50",
    },
  },
  {
    name: "Competitor monitor",
    description: "A repeatable research deliverable with low external-action risk.",
    draft: {
      result:
        "Produce a competitor update for three named companies, covering product changes, pricing shifts, hiring signals, and notable customer/news events.",
      authority:
        "May read public websites, docs, changelogs, job posts, social posts, and news. Must not log into accounts or contact anyone.",
      proof: "Provide source links for every claim, a change log grouped by competitor, and a short impact assessment.",
      acceptance:
        "Every company has at least three concrete observations; each observation has a source; impact notes are specific and non-generic.",
      failure: "Missing sources, stale findings, or generic summaries without concrete changes should be revised.",
      amount: "15",
    },
  },
];

const buildContractDescription = (draft: WorkContractDraft) =>
  [
    ["Result", draft.result],
    ["Authority", draft.authority],
    ["Proof", draft.proof],
    ["Acceptance", draft.acceptance],
    ["Failure", draft.failure],
  ]
    .map(([label, value]) => `${label}:\n${value.trim()}`)
    .join("\n\n");

/** Safe parse — returns 0n on bad input so we never crash on partially-typed amounts. */
const safeParseUsdc = (raw: string): bigint => {
  try {
    if (!raw) return 0n;
    return parseUnits(raw, USDC_DECIMALS);
  } catch {
    return 0n;
  }
};

const shortAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

export const CreateProjectForm = () => {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const isArc = isArcNetwork(targetNetwork.id);

  const [step, setStep] = useState(1);
  const [contractDraft, setContractDraft] = useState<WorkContractDraft>(EMPTY_CONTRACT_DRAFT);
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
  const { usdcAddress, isLoading: isLoadingUsdcAddress } = useChordUsdcAddress({
    chainId: targetNetwork.id,
    escrowAddress,
  });

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
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: connectedAddress && escrowAddress ? [connectedAddress, escrowAddress] : undefined,
    query: { enabled: Boolean(connectedAddress && escrowAddress && usdcAddress) },
  });

  const { data: usdcBalance, isLoading: isLoadingBalance } = useReadContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(connectedAddress && usdcAddress) },
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
  const balanceSufficient = (usdcBalance ?? 0n) >= totalUsdc && totalUsdc > 0n;
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

  const handleContractDraftChange = (field: keyof WorkContractDraft, value: string) => {
    setContractDraft(prev => ({ ...prev, [field]: value }));
  };

  const handleUseContractDraft = () => {
    if (!contractDraft.result.trim() || !contractDraft.proof.trim() || !contractDraft.acceptance.trim()) {
      notification.error("Define the result, proof, and acceptance criteria before funding");
      return;
    }
    if (safeParseUsdc(contractDraft.amount) <= 0n) {
      notification.error("Payout must be greater than zero");
      return;
    }
    setMilestones([
      {
        description: buildContractDescription(contractDraft),
        amount: contractDraft.amount,
        assignee: "",
      },
    ]);
    setShowAssignees(false);
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

  const txLink = (hash: `0x${string}`) => getTransactionUrl(targetNetwork.id, hash);

  const handleApprove = async () => {
    if (!escrowAddress) {
      notification.error("Escrow contract not deployed on this network yet");
      return;
    }
    if (!usdcAddress) {
      notification.error("USDC token not resolved for this network yet");
      return;
    }
    if (totalUsdc <= 0n) {
      notification.error("Total amount must be greater than zero");
      return;
    }
    if (!balanceSufficient) {
      notification.error(`Wallet needs at least ${totalUsdcDisplay} USDC before this contract can be funded`);
      return;
    }
    try {
      const hash = await writeApprove({
        address: usdcAddress,
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
    if (!balanceSufficient) {
      notification.error(`Wallet needs at least ${totalUsdcDisplay} USDC before this contract can be funded`);
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
            Contract created —{" "}
            <a href={link} target="_blank" rel="noreferrer" className="link">
              view on Arcscan
            </a>
          </span>
        ) : (
          "Contract created successfully!"
        ),
      );
      router.push("/projects");
    } catch (error) {
      console.error("Error creating project:", error);
      notification.error("Failed to create project");
    }
  };

  const usdcReady = Boolean(usdcAddress) && !isLoadingUsdcAddress;
  const approveTxUrl = approveTxHash ? txLink(approveTxHash) : undefined;
  const createTxUrl = createTxHash ? txLink(createTxHash) : undefined;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Progress Steps */}
      <ul className="steps steps-horizontal w-full mb-8">
        <li className={`step ${step >= 1 ? "step-primary" : ""}`}>Define Contract</li>
        <li className={`step ${step >= 2 ? "step-primary" : ""}`}>Review Work Unit</li>
        <li className={`step ${step >= 3 ? "step-primary" : ""}`}>Fund Escrow</li>
      </ul>

      {/* Step 1: Contract Builder */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="rounded-lg border border-base-300 bg-base-100 p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-primary">
                  Delegated Work Contract
                </p>
                <h3 className="mt-2 text-xl font-semibold tracking-tight">Define the thing you are buying</h3>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-base-content/65">
                  Start with a verifiable work unit: result, authority, proof, acceptance, and payout. Agents come after
                  the contract is clear.
                </p>
              </div>
              <div className="rounded-lg border border-base-300 bg-base-200 px-3 py-2 text-xs text-base-content/65">
                Promise + Proof + Payout
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {CONTRACT_TEMPLATES.map(template => (
                <button
                  key={template.name}
                  type="button"
                  className="rounded-lg border border-base-300 bg-base-100 p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
                  onClick={() => setContractDraft(template.draft)}
                >
                  <span className="text-sm font-semibold">{template.name}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-base-content/55">
                    {template.description}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-6 space-y-4">
              <ContractTextArea
                id="contract-result"
                label="Result"
                helper="What exact deliverable should the agent produce?"
                value={contractDraft.result}
                onChange={value => handleContractDraftChange("result", value)}
                placeholder="e.g., Deliver a sourced research brief on three BTC prediction markets."
              />
              <ContractTextArea
                id="contract-authority"
                label="Authority"
                helper="What can the agent read or do, and what is off limits?"
                value={contractDraft.authority}
                onChange={value => handleContractDraftChange("authority", value)}
                placeholder="e.g., May read public data and Psephos context. Must not trade, spend money, or contact anyone."
              />
              <ContractTextArea
                id="contract-proof"
                label="Proof"
                helper="What evidence must be attached so the work can be trusted?"
                value={contractDraft.proof}
                onChange={value => handleContractDraftChange("proof", value)}
                placeholder="e.g., Include source links, market IDs, reasoning notes, and uncertainty flags."
              />
              <ContractTextArea
                id="contract-acceptance"
                label="Acceptance"
                helper="How will the client decide whether to release USDC?"
                value={contractDraft.acceptance}
                onChange={value => handleContractDraftChange("acceptance", value)}
                placeholder="e.g., At least five traceable sources; no unsupported claims; final recommendation follows from evidence."
              />
              <ContractTextArea
                id="contract-failure"
                label="Failure / revision"
                helper="What should happen if the proof is weak or the result misses the mark?"
                value={contractDraft.failure}
                onChange={value => handleContractDraftChange("failure", value)}
                placeholder="e.g., Missing sources or fabricated facts should be rejected or sent back for one revision."
              />

              <div className="flex flex-col gap-3 border-t border-base-300 pt-5 sm:flex-row sm:items-end sm:justify-between">
                <div className="w-full max-w-xs">
                  <label htmlFor="contract-amount" className="text-xs font-medium uppercase tracking-wide opacity-60">
                    Payout
                  </label>
                  <div className="join mt-2 w-full">
                    <input
                      id="contract-amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="input input-bordered join-item w-full"
                      value={contractDraft.amount}
                      onChange={e => handleContractDraftChange("amount", e.target.value)}
                    />
                    <span className="join-item flex items-center bg-base-200 px-3 text-sm opacity-70">USDC</span>
                  </div>
                </div>
                <button className="btn btn-primary" onClick={handleUseContractDraft}>
                  Use this contract
                </button>
              </div>
            </div>
          </div>

          <details className="rounded-lg border border-base-300 bg-base-100">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
              Optional: split a rough project with AI
            </summary>
            <div className="border-t border-base-300 p-5">
              <AIMilestoneSplitter onAccept={handleSuggestionsGenerated} />
            </div>
          </details>

          <div className="text-center">
            <button
              className="btn btn-outline"
              onClick={() => {
                setMilestones([{ description: "", amount: "10", assignee: "" }]);
                setStep(2);
              }}
            >
              Start from a blank milestone
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Edit Milestones */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="rounded-lg border border-base-300 bg-base-100 p-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold tracking-tight">Work units</h3>
                <p className="mt-1 text-sm text-base-content/60">
                  Keep the first contract narrow enough for a human to verify before payout.
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <span className="text-sm">Pre-assign worker</span>
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
                      placeholder="Work contract terms"
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
                        placeholder="Verified worker address (optional) 0x..."
                        value={milestone.assignee}
                        onChange={e => handleMilestoneChange(index, "assignee", e.target.value)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button className="btn btn-outline btn-sm mt-4" onClick={handleAddMilestone}>
              + Add Work Unit
            </button>

            <div className="divider" />

            <div className="flex justify-between items-center">
              <span className="font-semibold">Total Amount:</span>
              <span className="text-xl font-bold">{totalUsdcDisplay} USDC</span>
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
                <code className="text-xs">yarn deploy --network {isArc ? "arcTestnet" : "localhost"}</code>.
              </span>
            </div>
          )}

          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h3 className="card-title">Routing & review</h3>

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
                  <p className="text-sm">Fund the contract first, then route it to a verified worker or PM.</p>
                  <p className="text-xs opacity-70">
                    For the MVP, avoid auto-assignment unless you know the worker daemon is actually running.
                  </p>
                </div>
              </div>

              <div className="divider">Optional: Project Manager / Router</div>

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
                <p className="text-xs opacity-70">
                  A PM can assign workers, review proof, and earn commission when the work settles.
                </p>
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
                  <p className="text-sm opacity-70">Work units</p>
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
                    {isLoadingUsdcAddress || isLoadingAllowance
                      ? "—"
                      : `${formatUnits(allowance ?? 0n, USDC_DECIMALS)} USDC`}
                  </p>
                </div>
                <div>
                  <p className="text-sm opacity-70">Wallet USDC balance</p>
                  <p
                    className={`font-bold ${
                      !isLoadingUsdcAddress && !isLoadingBalance && !balanceSufficient ? "text-warning" : ""
                    }`}
                  >
                    {isLoadingUsdcAddress || isLoadingBalance
                      ? "—"
                      : `${formatUnits(usdcBalance ?? 0n, USDC_DECIMALS)} USDC`}
                  </p>
                </div>
                <div>
                  <p className="text-sm opacity-70">USDC contract</p>
                  <p className="font-mono text-xs font-bold">
                    {isLoadingUsdcAddress ? "Resolving..." : usdcAddress ? shortAddress(usdcAddress) : "Not found"}
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
                Funding takes two on-chain steps: approve the escrow to pull{" "}
                <span className="font-semibold">{totalUsdcDisplay} USDC</span>, then create the contract. Both
                transactions pay gas in USDC on Arc; localhost uses MockUSDC for deterministic E2E.
              </p>

              {connectedAddress &&
                !isLoadingUsdcAddress &&
                !isLoadingBalance &&
                !balanceSufficient &&
                totalUsdc > 0n && (
                  <div className="alert alert-warning mt-3 text-sm">
                    <span>This wallet needs at least {totalUsdcDisplay} USDC before the contract can be funded.</span>
                  </div>
                )}

              <ol className="list-decimal list-inside space-y-3 mt-2">
                <li>
                  <span className={`font-medium ${allowanceSufficient ? "text-success line-through" : ""}`}>
                    Approve USDC ({totalUsdcDisplay})
                  </span>
                  {approveTxUrl && (
                    <a href={approveTxUrl} target="_blank" rel="noreferrer" className="link text-xs ml-2">
                      tx ↗
                    </a>
                  )}
                </li>
                <li>
                  <span className={`font-medium ${createTxHash ? "text-success line-through" : ""}`}>
                    Create work contract on-chain
                  </span>
                  {createTxUrl && (
                    <a href={createTxUrl} target="_blank" rel="noreferrer" className="link text-xs ml-2">
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
                disabled={!isValidForm() || !isEscrowDeployed || !usdcReady || isCreating}
              >
                {isCreating ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Creating…
                  </>
                ) : (
                  `Create contract (${totalUsdcDisplay} USDC)`
                )}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={handleApprove}
                disabled={
                  !isValidForm() ||
                  !isEscrowDeployed ||
                  !usdcReady ||
                  approvePending ||
                  !connectedAddress ||
                  !balanceSufficient
                }
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

const ContractTextArea = ({
  id,
  label,
  helper,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  helper: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) => (
  <div className="space-y-2">
    <div>
      <label htmlFor={id} className="text-xs font-medium uppercase tracking-wide opacity-60">
        {label}
      </label>
      <p className="mt-1 text-xs text-base-content/55">{helper}</p>
    </div>
    <textarea
      id={id}
      className="textarea textarea-bordered min-h-[5rem] w-full resize-y leading-relaxed"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  </div>
);
