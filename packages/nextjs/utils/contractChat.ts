/**
 * Helpers for the ContractChat component and its API route.
 *
 * Shared between client and server, so no React / Next imports here.
 */
import {
  EMPTY_WORK_CONTRACT_DRAFT,
  WORK_CONTRACT_FIELDS,
  type WorkContractDraft,
  type WorkContractField,
} from "~~/types/contract";

/** Order in which the assistant must collect fields (Result first, Failure last). */
export const CONTRACT_FIELD_ORDER: readonly WorkContractField[] = WORK_CONTRACT_FIELDS;

/** Returns the next field that is still empty, or null if all populated. */
export function nextEmptyField(draft: WorkContractDraft): WorkContractField | null {
  for (const field of CONTRACT_FIELD_ORDER) {
    if (!draft[field].trim()) return field;
  }
  return null;
}

/** All five fields populated and non-empty after trim. */
export function isDraftComplete(draft: WorkContractDraft): boolean {
  return nextEmptyField(draft) === null;
}

/** Friendly labels for the right-pane preview and assistant prompts. */
export const FIELD_LABEL: Record<WorkContractField, string> = {
  result: "Result",
  authority: "Authority",
  proof: "Proof",
  acceptance: "Acceptance",
  failure: "Failure",
};

/** One-line hint shown under each label in the preview. */
export const FIELD_HINT: Record<WorkContractField, string> = {
  result: "What gets delivered",
  authority: "What the agent may or may not do",
  proof: "Evidence required to claim done",
  acceptance: "Pass criteria",
  failure: "Revision and reject rules",
};

/** Short prompt the assistant uses when asking about each field. */
export const FIELD_QUESTION: Record<WorkContractField, string> = {
  result: "What's the agent supposed to deliver? Describe the end product in one or two sentences.",
  authority:
    "What is the agent allowed to do — and what's off-limits? (e.g. can it spend money, call APIs, modify files outside scope)",
  proof:
    "What evidence should the agent produce so we can verify the work was done? (e.g. screenshots, logs, a URL, a PR link)",
  acceptance: "What's the bar for accepting the work? List concrete pass criteria.",
  failure:
    "If the work falls short, how should it be handled? (e.g. one round of revisions, partial pay, reject and reassign)",
};

/** Canned text the stub fallback writes into each field when the user replies. */
export const FIELD_STUB_VALUE: Record<WorkContractField, string> = {
  result:
    "A working deliverable that matches the described scope, packaged and ready for the client to use without further engineering.",
  authority:
    "Agent operates within the listed scope only; may not access systems, spend funds, or take destructive actions outside the agreed deliverable.",
  proof:
    "A concise handoff: link to the artifact (repo / URL / file), a short demo or screenshots, and notes on anything skipped.",
  acceptance:
    "Deliverable opens and runs as described / matches the described scope / no critical bugs in the documented happy path.",
  failure:
    "One round of free revisions for issues within the original scope; out-of-scope changes are negotiated as a new milestone.",
};

export { EMPTY_WORK_CONTRACT_DRAFT };
