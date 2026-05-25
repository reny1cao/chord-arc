"use client";

/**
 * CreateProjectForm — chat-first contract creation flow.
 *
 * Wave 2 rewrite: splits the legacy flat-description path into an off-chain
 * WorkContract (persisted via /api/contracts) + short on-chain deliverable
 * summaries. The R/A/P/A/F sections never go on chain — only the resulting
 * contractURI does.
 *
 * Step 1: chat-first contract definition via <ContractChat />.
 * Step 2: milestones + collapsed routing config (PM address + fee).
 * Step 3: fund + create (POST contract -> approve -> createProject).
 *
 * Drafts (contract, milestones, pm) autosave to localStorage and restore on
 * mount with a banner. Cleared after a successful on-chain create.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AIMilestoneSplitter } from "./AIMilestoneSplitter";
import { ContractChat } from "./ContractChat";
import { formatUnits, isAddress, parseUnits } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth/useDeployedContractInfo";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth/useScaffoldWriteContract";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useChordUsdcAddress } from "~~/hooks/useChordUsdcAddress";
import {
  type ContractStorageResponse,
  EMPTY_WORK_CONTRACT_DRAFT,
  MILESTONE_DESCRIPTION_MAX,
  MILESTONE_DESCRIPTION_RECOMMENDED,
  type WorkContractDraft,
  canonicalize,
  toWorkContract,
} from "~~/types/contract";
import { getTransactionUrl, isArcNetwork } from "~~/utils/chordNetwork";
import { isDraftComplete } from "~~/utils/contractChat";
import { ERC20_ABI, USDC_DECIMALS } from "~~/utils/erc20";
import type { MilestoneSuggestion } from "~~/utils/mockAI";
import { notification } from "~~/utils/scaffold-eth";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const DRAFT_STORAGE_KEY = "chord:create-project-draft:v1";
const MIN_MILESTONE_AMOUNT_USDC = "1";
const MIN_MILESTONE_AMOUNT = parseUnits(MIN_MILESTONE_AMOUNT_USDC, USDC_DECIMALS);

interface MilestoneInput {
  description: string;
  amount: string;
  assignee: string;
}

interface ContractTemplate {
  name: string;
  blurb: string;
  draft: WorkContractDraft;
  milestone: MilestoneInput;
}

/**
 * Templates seed both the chat-driven WorkContractDraft and a single short
 * milestone. The long R/A/P/A/F text is the same as the legacy form so
 * existing copy carries over; the milestone description is now a tight
 * deliverable summary (<= 100 chars) per the new schema.
 */
const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    name: "Market research brief",
    blurb: "A sourced brief that a user can review manually before payout.",
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
    },
    milestone: {
      description: "Sourced evidence brief on the selected market",
      amount: "10",
      assignee: "",
    },
  },
  {
    name: "B2B leads",
    blurb: "A classic paid work unit with clear rows, sources, and acceptance rules.",
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
    },
    milestone: {
      description: "30 qualified B2B leads (CSV + sources)",
      amount: "50",
      assignee: "",
    },
  },
  {
    name: "Competitor monitor",
    blurb: "A repeatable research deliverable with low external-action risk.",
    draft: {
      result:
        "Produce a competitor update for three named companies, covering product changes, pricing shifts, hiring signals, and notable customer/news events.",
      authority:
        "May read public websites, docs, changelogs, job posts, social posts, and news. Must not log into accounts or contact anyone.",
      proof:
        "Provide source links for every claim, a change log grouped by competitor, and a short impact assessment.",
      acceptance:
        "Every company has at least three concrete observations; each observation has a source; impact notes are specific and non-generic.",
      failure: "Missing sources, stale findings, or generic summaries without concrete changes should be revised.",
    },
    milestone: {
      description: "Quarterly competitor update for 3 named companies",
      amount: "15",
      assignee: "",
    },
  },
];

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

const draftsAreEqual = (a: WorkContractDraft, b: WorkContractDraft): boolean =>
  a.result === b.result &&
  a.authority === b.authority &&
  a.proof === b.proof &&
  a.acceptance === b.acceptance &&
  a.failure === b.failure;

interface PersistedDraft {
  contractDraft: WorkContractDraft;
  milestones: MilestoneInput[];
  pmAddress: string;
  pmFeeBps: string;
  step: number;
}

const isPersistedDraft = (value: unknown): value is PersistedDraft => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!v.contractDraft || typeof v.contractDraft !== "object") return false;
  const cd = v.contractDraft as Record<string, unknown>;
  for (const key of ["result", "authority", "proof", "acceptance", "failure"]) {
    if (typeof cd[key] !== "string") return false;
  }
  if (!Array.isArray(v.milestones)) return false;
  if (typeof v.pmAddress !== "string") return false;
  if (typeof v.pmFeeBps !== "string") return false;
  return true;
};

const isMeaningfulDraft = (persisted: PersistedDraft): boolean => {
  if (!draftsAreEqual(persisted.contractDraft, EMPTY_WORK_CONTRACT_DRAFT)) return true;
  if (persisted.milestones.length > 0) return true;
  if (persisted.pmAddress.trim()) return true;
  return false;
};

interface CachedContractURI {
  uri: `chord://${string}`;
  hash: string;
  /** Canonicalized JSON of the WorkContract used to derive the URI. */
  key: string;
}

export const CreateProjectForm = () => {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const isArc = isArcNetwork(targetNetwork.id);

  const [step, setStep] = useState(1);
  const [contractDraft, setContractDraft] = useState<WorkContractDraft>(EMPTY_WORK_CONTRACT_DRAFT);
  const [milestones, setMilestones] = useState<MilestoneInput[]>([]);
  const [pmAddress, setPmAddress] = useState("");
  const [pmFeeBps, setPmFeeBps] = useState("500"); // 5% default
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | null>(null);
  const [createTxHash, setCreateTxHash] = useState<`0x${string}` | null>(null);
  const [cachedURI, setCachedURI] = useState<CachedContractURI | null>(null);
  const [isPersisting, setIsPersisting] = useState(false);
  const [routingExpanded, setRoutingExpanded] = useState(false);
  const [splitterExpanded, setSplitterExpanded] = useState(false);

  // Restore-from-draft banner state.
  const [restoreCandidate, setRestoreCandidate] = useState<PersistedDraft | null>(null);
  const [hasRestoredCheck, setHasRestoredCheck] = useState(false);

  // Bump to force-remount ContractChat when a template is selected, so its
  // internal useChat picks up the new initialDraft + greeting.
  const [chatResetKey, setChatResetKey] = useState(0);

  // Resolve the deployed ChordEscrow address from the SE-2 registry.
  const { data: escrowContract } = useDeployedContractInfo({ contractName: "ChordEscrow" });
  const escrowAddress = escrowContract?.address as `0x${string}` | undefined;
  const isEscrowDeployed = !!escrowAddress && escrowAddress !== ZERO_ADDRESS;
  const { usdcAddress, isLoading: isLoadingUsdcAddress } = useChordUsdcAddress({
    chainId: targetNetwork.id,
    escrowAddress,
  });

  const totalUsdc = useMemo(
    () => milestones.reduce<bigint>((sum, m) => sum + safeParseUsdc(m.amount), 0n),
    [milestones],
  );
  const totalUsdcDisplay = useMemo(() => formatUnits(totalUsdc, USDC_DECIMALS), [totalUsdc]);

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

  const { writeContractAsync: writeApprove, isPending: isApproving } = useWriteContract();
  const { writeContractAsync: writeEscrow, isMining: isCreating } = useScaffoldWriteContract({
    contractName: "ChordEscrow",
  });

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

  const pmFeePercent = parseInt(pmFeeBps || "0") / 100;
  const draftComplete = isDraftComplete(contractDraft);

  // -------- Autosave: load on mount --------
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) {
        setHasRestoredCheck(true);
        return;
      }
      const parsed = JSON.parse(raw);
      if (isPersistedDraft(parsed) && isMeaningfulDraft(parsed)) {
        setRestoreCandidate(parsed);
      }
    } catch (err) {
      console.warn("[create] failed to read autosave", err);
    } finally {
      setHasRestoredCheck(true);
    }
  }, []);

  // -------- Autosave: persist on every change (after restore check) --------
  useEffect(() => {
    if (!hasRestoredCheck) return;
    if (typeof window === "undefined") return;
    const snapshot: PersistedDraft = { contractDraft, milestones, pmAddress, pmFeeBps, step };
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (err) {
      // Quota errors are rare for this size; logging only.
      console.warn("[create] failed to write autosave", err);
    }
  }, [contractDraft, milestones, pmAddress, pmFeeBps, step, hasRestoredCheck]);

  const clearAutosave = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (err) {
      console.warn("[create] failed to clear autosave", err);
    }
  }, []);

  const handleRestore = useCallback(() => {
    if (!restoreCandidate) return;
    setContractDraft(restoreCandidate.contractDraft);
    setMilestones(restoreCandidate.milestones);
    setPmAddress(restoreCandidate.pmAddress);
    setPmFeeBps(restoreCandidate.pmFeeBps);
    setStep(restoreCandidate.step || 1);
    setChatResetKey(k => k + 1);
    setRestoreCandidate(null);
  }, [restoreCandidate]);

  const handleDiscardRestore = useCallback(() => {
    setRestoreCandidate(null);
    clearAutosave();
  }, [clearAutosave]);

  // -------- ContractChat plumbing --------
  // ContractChat owns its own draft state internally. We mirror it back here
  // via onDraftChange so persistence and step-2 gating see the latest values.
  const handleChatDraftChange = useCallback((next: WorkContractDraft) => {
    setContractDraft(prev => (draftsAreEqual(prev, next) ? prev : next));
  }, []);

  const handleChatReady = useCallback((next: WorkContractDraft) => {
    setContractDraft(next);
    setStep(2);
  }, []);

  const handlePickTemplate = useCallback((template: ContractTemplate) => {
    setContractDraft(template.draft);
    setMilestones(prev => (prev.length === 0 ? [template.milestone] : prev));
    setChatResetKey(k => k + 1);
    notification.info(`Loaded "${template.name}" — review and refine in chat`);
  }, []);

  const handleSuggestionsGenerated = useCallback((suggestions: MilestoneSuggestion[]) => {
    // The AI splitter still emits R/A/P/A/F-flavored acceptance text. With the
    // new schema that text belongs in the off-chain contract, NOT in the
    // per-milestone description (which has a 200-char recommended cap). For
    // simplicity we drop the acceptance footer here — users tighten the
    // description and refine R/A/P/A/F in chat.
    setMilestones(
      suggestions.map(s => ({
        description: s.description.slice(0, MILESTONE_DESCRIPTION_RECOMMENDED),
        amount: s.amount,
        assignee: "",
      })),
    );
    setSplitterExpanded(false);
    setStep(2);
  }, []);

  // -------- Milestone editing --------
  const handleAddMilestone = () => {
    setMilestones(prev => [...prev, { description: "", amount: "10", assignee: "" }]);
  };

  const handleRemoveMilestone = (index: number) => {
    setMilestones(prev => prev.filter((_, i) => i !== index));
  };

  const handleMilestoneChange = (index: number, field: keyof MilestoneInput, value: string) => {
    setMilestones(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const isMilestonesValid = useMemo(() => {
    if (milestones.length === 0) return false;
    return milestones.every(
      m =>
        m.description.trim().length > 0 &&
        m.description.length <= MILESTONE_DESCRIPTION_MAX &&
        safeParseUsdc(m.amount) >= MIN_MILESTONE_AMOUNT &&
        (!m.assignee || isAddress(m.assignee)),
    );
  }, [milestones]);

  const isPmValid = !pmAddress || isAddress(pmAddress);
  const isValidForm = () => draftComplete && isMilestonesValid && isPmValid;

  const txLink = (hash: `0x${string}`) => getTransactionUrl(targetNetwork.id, hash);

  // -------- POST contract -> cache -> approve -> create --------

  /**
   * Persist the current WorkContractDraft to /api/contracts, caching the
   * resulting URI by canonicalized JSON. Re-POST only when the draft has
   * actually changed since the last cached result.
   */
  const persistContract = useCallback(async (): Promise<CachedContractURI | null> => {
    if (!draftComplete) {
      notification.error("Finish the work contract (all 5 fields) before funding");
      return null;
    }
    const contract = toWorkContract(contractDraft);
    const key = canonicalize(contract);
    if (cachedURI && cachedURI.key === key) return cachedURI;

    setIsPersisting(true);
    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contract),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg =
          (body && Array.isArray(body.issues) && body.issues[0]?.message) ||
          (body && body.error) ||
          `Failed to persist contract (HTTP ${res.status})`;
        notification.error(msg);
        return null;
      }
      const data = (await res.json()) as ContractStorageResponse;
      const cached: CachedContractURI = { uri: data.uri, hash: data.hash, key };
      setCachedURI(cached);
      return cached;
    } catch (err) {
      console.error("[create] persistContract failed", err);
      notification.error("Network error while persisting contract — please retry");
      return null;
    } finally {
      setIsPersisting(false);
    }
  }, [cachedURI, contractDraft, draftComplete]);

  // Invalidate the cached URI whenever the contract draft itself changes.
  // (We only re-POST inside persistContract, but stale URI must be cleared so
  // the "Create" button visually re-prompts a persist on next click.)
  useEffect(() => {
    if (!cachedURI) return;
    const key = canonicalize(toWorkContract(contractDraft));
    if (key !== cachedURI.key) setCachedURI(null);
    // Intentionally omit cachedURI from deps — we only react to draft changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractDraft]);

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

    // POST the WorkContract (cached after first success).
    const persisted = await persistContract();
    if (!persisted) return;

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
        args: [persisted.uri, pm, BigInt(fee), descriptions, amounts, initialAssignees],
      });
      if (hash) setCreateTxHash(hash);

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
      clearAutosave();
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
      {restoreCandidate && (
        <RestoreBanner onRestore={handleRestore} onDiscard={handleDiscardRestore} />
      )}

      <ul className="steps steps-horizontal w-full mb-8">
        <li className={`step ${step >= 1 ? "step-primary" : ""}`}>Define contract</li>
        <li className={`step ${step >= 2 ? "step-primary" : ""}`}>Milestones &amp; routing</li>
        <li className={`step ${step >= 3 ? "step-primary" : ""}`}>Fund &amp; create</li>
      </ul>

      {/* Step 1: Chat-first contract definition */}
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
                  Chat with the assistant to pin down the result, authority, proof, acceptance, and failure rules.
                  Edit any field directly in the preview. We&apos;ll add milestones and funding next.
                </p>
              </div>
              <div className="rounded-lg border border-base-300 bg-base-200 px-3 py-2 text-xs text-base-content/65">
                Promise + Proof + Payout
              </div>
            </div>

            <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-base-content/75">
              <span className="font-semibold text-primary">Heads up:</span>{" "}
              you&apos;ll sign 2 transactions —
              approve USDC, then create the contract. Both pay gas in USDC on Arc.
            </div>

            <div className="mt-5">
              <p className="text-[11px] uppercase tracking-wide font-semibold text-base-content/55 mb-2">
                Start from a template (optional)
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {CONTRACT_TEMPLATES.map(template => (
                  <button
                    key={template.name}
                    type="button"
                    className="rounded-lg border border-base-300 bg-base-100 p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
                    onClick={() => handlePickTemplate(template)}
                  >
                    <span className="text-sm font-semibold">{template.name}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-base-content/55">{template.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ContractChat
            key={chatResetKey}
            initialDraft={contractDraft}
            onDraftChange={handleChatDraftChange}
            onReady={handleChatReady}
          />

          <details
            className="rounded-lg border border-base-300 bg-base-100"
            open={splitterExpanded}
            onToggle={e => setSplitterExpanded((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
              Need multiple milestones? Split a rough project with AI
            </summary>
            <div className="border-t border-base-300 p-5">
              <AIMilestoneSplitter onAccept={handleSuggestionsGenerated} />
            </div>
          </details>
        </div>
      )}

      {/* Step 2: Milestones + collapsed routing */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="rounded-lg border border-base-300 bg-base-100 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold tracking-tight">Milestones</h3>
                <p className="mt-1 text-sm text-base-content/60">
                  Each milestone is a short deliverable summary (≤ {MILESTONE_DESCRIPTION_RECOMMENDED} chars). The
                  full work contract lives off-chain.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {milestones.map((milestone, index) => {
                const descLen = milestone.description.length;
                const descOver = descLen > MILESTONE_DESCRIPTION_RECOMMENDED;
                const descHardOver = descLen > MILESTONE_DESCRIPTION_MAX;
                const parsedAmount = safeParseUsdc(milestone.amount);
                const amountUnderMinimum = milestone.amount.trim() !== "" && parsedAmount < MIN_MILESTONE_AMOUNT;
                return (
                  <div key={index} className="flex gap-4 items-start">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300 text-sm font-bold">
                      {index + 1}
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="space-y-1">
                        <textarea
                          className={`textarea textarea-bordered w-full min-h-[3rem] leading-relaxed ${
                            descHardOver ? "textarea-error" : ""
                          }`}
                          rows={2}
                          placeholder="Short deliverable summary (e.g., 30 qualified B2B leads + sources)"
                          value={milestone.description}
                          maxLength={MILESTONE_DESCRIPTION_MAX}
                          onChange={e => handleMilestoneChange(index, "description", e.target.value)}
                        />
                        <div className="flex justify-between text-[11px]">
                          <span className="opacity-50">
                            Keep it tight — the full work contract is captured separately.
                          </span>
                          <span
                            className={
                              descHardOver
                                ? "text-error font-semibold"
                                : descOver
                                  ? "text-warning"
                                  : "opacity-60"
                            }
                          >
                            {descLen} / {MILESTONE_DESCRIPTION_RECOMMENDED}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className="join flex-1">
                          <input
                            type="number"
                            step="0.01"
                            min={MIN_MILESTONE_AMOUNT_USDC}
                            className="input input-bordered join-item w-full"
                            placeholder="10"
                            value={milestone.amount}
                            onChange={e => handleMilestoneChange(index, "amount", e.target.value)}
                          />
                          <span className="join-item flex items-center bg-base-200 px-3 text-sm opacity-70">USDC</span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-square text-error"
                          onClick={() => handleRemoveMilestone(index)}
                          aria-label="Remove milestone"
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
                      {amountUnderMinimum && (
                        <p className="text-[11px] font-medium text-error">
                          Minimum escrow per milestone is {MIN_MILESTONE_AMOUNT_USDC} USDC.
                        </p>
                      )}
                      <div className="space-y-1">
                        <div className="flex items-baseline justify-between">
                          <label
                            className="text-[11px] uppercase tracking-wide font-semibold text-base-content/55"
                            htmlFor={`assignee-${index}`}
                          >
                            Pre-assign worker (optional)
                          </label>
                          <Link
                            href="/agents"
                            target="_blank"
                            rel="noreferrer"
                            className="link link-hover text-[11px] opacity-70"
                          >
                            Browse agents ↗
                          </Link>
                        </div>
                        <input
                          id={`assignee-${index}`}
                          type="text"
                          className={`input input-bordered input-sm w-full ${
                            milestone.assignee && !isAddress(milestone.assignee) ? "input-error" : ""
                          }`}
                          placeholder="0x... (leave empty to assign later)"
                          value={milestone.assignee}
                          onChange={e => handleMilestoneChange(index, "assignee", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              {milestones.length === 0 && (
                <p className="text-sm text-base-content/55 italic">
                  No milestones yet — add one below to get started.
                </p>
              )}
            </div>

            <button type="button" className="btn btn-outline btn-sm mt-4" onClick={handleAddMilestone}>
              + Add milestone
            </button>

            <div className="divider" />

            <div className="flex items-center justify-between">
              <span className="font-semibold">Total amount</span>
              <span className="text-xl font-bold">{totalUsdcDisplay} USDC</span>
            </div>
          </div>

          {/* Routing (optional) — moved out of fund step. */}
          <details
            className="rounded-lg border border-base-300 bg-base-100"
            open={routingExpanded}
            onToggle={e => setRoutingExpanded((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
              Routing (optional) — add a PM / router
            </summary>
            <div className="space-y-4 border-t border-base-300 p-5">
              <p className="text-xs text-base-content/65">
                A PM can assign workers, review proof, and earn commission when the work settles. Leave both fields
                empty to act as PM yourself.
              </p>
              <div className="space-y-2">
                <label htmlFor="pm-address" className="text-sm font-medium">
                  PM address
                </label>
                <input
                  id="pm-address"
                  type="text"
                  className={`input input-bordered w-full ${
                    pmAddress && !isAddress(pmAddress) ? "input-error" : ""
                  }`}
                  placeholder="0x... (leave empty for no PM)"
                  value={pmAddress}
                  onChange={e => setPmAddress(e.target.value)}
                />
              </div>
              {pmAddress && isAddress(pmAddress) && (
                <div className="space-y-2">
                  <label htmlFor="pm-fee" className="text-sm font-medium">
                    PM fee
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
          </details>

          <div className="flex justify-between">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep(3)}
              disabled={!isMilestonesValid || !isPmValid}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Fund + create */}
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

          <div className="card bg-base-200">
            <div className="card-body">
              <h3 className="card-title">Summary</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm opacity-70">Milestones</p>
                  <p className="font-bold">{milestones.length}</p>
                </div>
                <div>
                  <p className="text-sm opacity-70">Total value</p>
                  <p className="font-bold">{totalUsdcDisplay} USDC</p>
                </div>
                <div>
                  <p className="text-sm opacity-70">Pre-assigned</p>
                  <p className="font-bold">{milestones.filter(m => m.assignee && isAddress(m.assignee)).length}</p>
                </div>
                {pmAddress && isAddress(pmAddress) && (
                  <div>
                    <p className="text-sm opacity-70">PM fee</p>
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
                {cachedURI && (
                  <div>
                    <p className="text-sm opacity-70">Contract URI</p>
                    <p className="font-mono text-xs font-bold break-all">{cachedURI.uri}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h3 className="card-title">Fund the escrow</h3>
              <p className="text-sm opacity-70">
                Funding takes two on-chain steps: <span className="font-semibold">approve</span> the escrow to pull{" "}
                <span className="font-semibold">{totalUsdcDisplay} USDC</span>, then{" "}
                <span className="font-semibold">create</span> the contract. The work contract JSON is persisted
                off-chain first and referenced on-chain by a short URI. Both transactions pay gas in USDC on Arc;
                localhost uses MockUSDC for deterministic E2E.
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
            <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>
              Back
            </button>
            {allowanceSufficient ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={
                  !isValidForm() || !isEscrowDeployed || !usdcReady || isCreating || isPersisting
                }
              >
                {isCreating || isPersisting ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    {isPersisting ? "Persisting contract…" : "Creating…"}
                  </>
                ) : (
                  `Create contract (${totalUsdcDisplay} USDC)`
                )}
              </button>
            ) : (
              <button
                type="button"
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

const RestoreBanner = ({ onRestore, onDiscard }: { onRestore: () => void; onDiscard: () => void }) => (
  <div className="mb-6 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
    <div className="text-sm">
      <span className="font-semibold">Previous draft found.</span>{" "}
      <span className="opacity-75">Pick up where you left off?</span>
    </div>
    <div className="flex gap-2">
      <button type="button" className="btn btn-sm btn-ghost" onClick={onDiscard}>
        Discard
      </button>
      <button type="button" className="btn btn-sm btn-primary" onClick={onRestore}>
        Restore previous draft
      </button>
    </div>
  </div>
);
