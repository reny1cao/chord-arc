"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { type ChatTransport, DefaultChatTransport, type UIMessage } from "ai";
import { ChatBubbleLeftRightIcon, CheckCircleIcon, PaperAirplaneIcon, SparklesIcon } from "@heroicons/react/24/outline";
import {
  EMPTY_WORK_CONTRACT_DRAFT,
  WORK_CONTRACT_FIELD_MAX,
  type WorkContractDraft,
  type WorkContractField,
} from "~~/types/contract";
import { CONTRACT_FIELD_ORDER, FIELD_HINT, FIELD_LABEL, FIELD_QUESTION, isDraftComplete } from "~~/utils/contractChat";

interface ContractChatProps {
  initialDraft?: WorkContractDraft;
  onDraftChange: (draft: WorkContractDraft) => void;
  onReady: (draft: WorkContractDraft) => void;
}

interface UpdateDraftToolInput {
  field: WorkContractField;
  value: string;
}

function isFieldKey(value: unknown): value is WorkContractField {
  return typeof value === "string" && (CONTRACT_FIELD_ORDER as readonly string[]).includes(value);
}

function isUpdateDraftInput(value: unknown): value is UpdateDraftToolInput {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isFieldKey(v.field) && typeof v.value === "string";
}

const fieldLabel = "text-xs font-medium uppercase tracking-wide opacity-60";

/**
 * Conversational replacement for the cold 5-textarea contract form.
 *
 * The chat walks the user through Result -> Authority -> Proof -> Acceptance ->
 * Failure, populating the WorkContractDraft incrementally via tool calls. The
 * user can also edit any field directly in the right pane; the assistant
 * notices and moves on to the next empty field.
 *
 * Persistence is the parent's problem — this component only emits via
 * onDraftChange and onReady.
 */
export const ContractChat = ({ initialDraft, onDraftChange, onReady }: ContractChatProps) => {
  const [draft, setDraft] = useState<WorkContractDraft>(initialDraft ?? EMPTY_WORK_CONTRACT_DRAFT);
  const [input, setInput] = useState("");

  // Latest draft kept in a ref so the transport's prepareSendMessagesRequest
  // closure always sees current values without forcing a new transport.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Transport is built once via useState's lazy initializer. The
  // prepareSendMessagesRequest closure only runs at send time (not render),
  // so reading draftRef.current there is safe — the lint rule can't see that.
  /* eslint-disable react-hooks/refs */
  const [transport] = useState<ChatTransport<UIMessage>>(
    () =>
      new DefaultChatTransport({
        api: "/api/contract-chat",
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: { messages, draft: draftRef.current, ...body },
        }),
      }),
  );
  /* eslint-enable react-hooks/refs */

  const initialMessages = useMemo<UIMessage[]>(() => {
    const opening =
      initialDraft && isDraftComplete(initialDraft)
        ? `Looks like you've already got a contract drafted — feel free to tweak anything in the preview, or chat with me if you want to refine it.`
        : `Hi! Let's pin down what you want the agent to do. ${FIELD_QUESTION.result}`;
    return [
      {
        id: "assistant-greeting",
        role: "assistant",
        parts: [{ type: "text", text: opening }],
      },
    ];
  }, [initialDraft]);

  const { messages, sendMessage, status, error, stop } = useChat({
    transport,
    messages: initialMessages,
  });

  // Track tool-call IDs we've already applied so re-renders don't re-apply.
  const appliedToolCallsRef = useRef<Set<string>>(new Set());

  // Intercept assistant tool calls (`updateContractDraft`) and mutate the draft.
  useEffect(() => {
    if (messages.length === 0) return;
    const updates: UpdateDraftToolInput[] = [];

    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const part of msg.parts) {
        const type = (part as { type?: string }).type;
        if (type !== "tool-updateContractDraft") continue;
        const tp = part as {
          type: string;
          state?: string;
          toolCallId?: string;
          input?: unknown;
        };
        if (!tp.toolCallId) continue;
        if (appliedToolCallsRef.current.has(tp.toolCallId)) continue;
        // Apply as soon as input is available (don't wait for execute result).
        if (tp.state !== "input-available" && tp.state !== "output-available") continue;
        if (!isUpdateDraftInput(tp.input)) continue;
        updates.push(tp.input);
        appliedToolCallsRef.current.add(tp.toolCallId);
      }
    }

    if (updates.length === 0) return;
    setDraft(prev => {
      let next = prev;
      for (const u of updates) {
        if (next[u.field] === u.value) continue;
        next = { ...next, [u.field]: u.value };
      }
      return next;
    });
  }, [messages]);

  // Notify parent on every draft change (incl. AI-driven and user-driven edits).
  useEffect(() => {
    onDraftChange(draft);
  }, [draft, onDraftChange]);

  const handleFieldEdit = useCallback((field: WorkContractField, value: string) => {
    setDraft(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || status === "streaming" || status === "submitted") return;
      sendMessage({ text: trimmed });
      setInput("");
    },
    [input, sendMessage, status],
  );

  const complete = isDraftComplete(draft);
  const filledCount = CONTRACT_FIELD_ORDER.filter(f => draft[f].trim()).length;
  const isBusy = status === "streaming" || status === "submitted";

  return (
    <div className="rounded-2xl border border-base-300 bg-base-100 shadow-sm">
      <div className="flex items-center gap-3 border-b border-base-300 px-6 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
          <ChatBubbleLeftRightIcon className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold leading-tight">Define the work contract</h3>
          <p className="text-xs opacity-60">
            Chat with the assistant or edit any field directly. We&apos;ll fill in the five contract fields together.
          </p>
        </div>
        <div className="hidden text-xs opacity-70 md:block">
          {filledCount} / {CONTRACT_FIELD_ORDER.length} fields
        </div>
      </div>

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Left pane — chat */}
        <div className="flex min-h-[28rem] flex-col border-base-300 lg:border-r">
          <ChatThread messages={messages} isBusy={isBusy} error={error?.message} />
          <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-base-300 px-4 py-3">
            <textarea
              className="textarea textarea-bordered w-full min-h-[2.75rem] max-h-40 resize-y leading-relaxed"
              placeholder={complete ? "Anything to tweak?" : "Type your answer…"}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              rows={1}
              disabled={isBusy}
            />
            {isBusy ? (
              <button type="button" className="btn btn-ghost" onClick={() => stop()}>
                Stop
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
                <PaperAirplaneIcon className="h-4 w-4" />
                Send
              </button>
            )}
          </form>
        </div>

        {/* Right pane — live draft preview */}
        <div className="flex min-h-[28rem] flex-col bg-base-200/40">
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <div className="flex items-center gap-2 px-1">
              <SparklesIcon className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wide opacity-70">Contract preview</span>
            </div>
            {CONTRACT_FIELD_ORDER.map(field => {
              const value = draft[field];
              const filled = value.trim().length > 0;
              return (
                <div
                  key={field}
                  className={`rounded-xl border bg-base-100 p-3 transition-colors ${
                    filled ? "border-base-300" : "border-dashed border-base-300/70"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <label htmlFor={`field-${field}`} className={fieldLabel}>
                      {FIELD_LABEL[field]}
                    </label>
                    <span className="text-[10px] opacity-50">
                      {filled ? <span className="text-success">{value.length} chars</span> : "empty"}
                    </span>
                  </div>
                  <p className="mb-2 text-[11px] italic opacity-50">{FIELD_HINT[field]}</p>
                  <textarea
                    id={`field-${field}`}
                    className="textarea textarea-bordered textarea-sm w-full min-h-[3.5rem] resize-y text-sm leading-relaxed"
                    placeholder={`Tell the assistant about the ${FIELD_LABEL[field].toLowerCase()}, or type it here.`}
                    value={value}
                    maxLength={WORK_CONTRACT_FIELD_MAX}
                    onChange={e => handleFieldEdit(field, e.target.value)}
                  />
                </div>
              );
            })}
          </div>
          <div className="border-t border-base-300 px-4 py-3">
            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={!complete}
              onClick={() => onReady(draft)}
            >
              <CheckCircleIcon className="h-5 w-5" />
              {complete ? "Use this contract" : `Fill ${CONTRACT_FIELD_ORDER.length - filledCount} more to continue`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ChatThreadProps {
  messages: UIMessage[];
  isBusy: boolean;
  error?: string;
}

const ChatThread = ({ messages, isBusy, error }: ChatThreadProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isBusy]);

  return (
    <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {messages.map(msg => {
        const text = msg.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map(p => p.text)
          .join("");
        // Show a quiet badge for every tool call so the user can see what the
        // assistant just wrote into the draft.
        const toolUpdates: UpdateDraftToolInput[] = [];
        for (const part of msg.parts) {
          const t = (part as { type?: string }).type;
          if (t !== "tool-updateContractDraft") continue;
          const input = (part as { input?: unknown }).input;
          if (isUpdateDraftInput(input)) toolUpdates.push(input);
        }

        if (!text && toolUpdates.length === 0) return null;

        const isUser = msg.role === "user";
        return (
          <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] space-y-2 rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                isUser ? "bg-primary text-primary-content" : "border border-base-300 bg-base-100"
              }`}
            >
              {text && <div className="whitespace-pre-wrap">{renderMarkdownish(text)}</div>}
              {toolUpdates.map((u, i) => (
                <div key={i} className="rounded-md bg-base-200/70 px-2 py-1 text-[11px] text-base-content/80">
                  <span className="font-semibold">Filled {FIELD_LABEL[u.field]}:</span>{" "}
                  <span className="opacity-80">{u.value.length > 100 ? u.value.slice(0, 100) + "…" : u.value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {isBusy && (
        <div className="flex justify-start">
          <div className="rounded-2xl border border-base-300 bg-base-100 px-4 py-2 text-sm opacity-70">
            <span className="loading loading-dots loading-sm" /> thinking…
          </div>
        </div>
      )}
      {error && (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

/**
 * Tiny markdown helper: bold (**text**) and italic (_text_) only. Enough to
 * render the assistant's reply text without pulling in a markdown library.
 */
function renderMarkdownish(input: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = input;
  let key = 0;
  const pattern = /(\*\*[^*]+\*\*|_[^_]+_)/;
  while (remaining.length) {
    const m = pattern.exec(remaining);
    if (!m) {
      parts.push(remaining);
      break;
    }
    if (m.index > 0) parts.push(remaining.slice(0, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    remaining = remaining.slice(m.index + token.length);
  }
  return parts;
}
