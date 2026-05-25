/**
 * Conversational contract-creation endpoint.
 *
 * The frontend (ContractChat.tsx) streams chat turns from this route and
 * intercepts the `updateContractDraft` tool calls to incrementally populate
 * a WorkContractDraft. The model fills one or two fields per turn — never
 * blasts all five at once — and asks the next question.
 *
 * Real path: Kimi (Moonshot CN) via OpenAI-compatible provider + streamText.
 * Tool calling requires moonshot-v1-32k or larger — 8k does NOT support it.
 * Stub path: deterministic UIMessage stream so reviewers without a
 * KIMI_API_KEY can still exercise the flow.
 */
import { NextRequest } from "next/server";
import {
  type UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
  tool,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import {
  EMPTY_WORK_CONTRACT_DRAFT,
  WORK_CONTRACT_FIELDS,
  WORK_CONTRACT_FIELD_MAX,
  type WorkContractDraft,
  type WorkContractField,
} from "~~/types/contract";
import {
  CONTRACT_FIELD_ORDER,
  FIELD_QUESTION,
  FIELD_STUB_VALUE,
  isDraftComplete,
  nextEmptyField,
} from "~~/utils/contractChat";

export const runtime = "nodejs";
export const maxDuration = 30;

// Kimi is OpenAI-compatible. Existing /api/ai/split uses the same KIMI_API_KEY
// against api.moonshot.cn — keep them in lockstep. Override via env if needed.
const KIMI_BASE_URL = process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1";
// kimi-k2.6 is the current flagship (262K context, native tool calling). If the
// account's endpoint doesn't have it yet, override with KIMI_CHAT_MODEL — e.g.
// moonshot-v1-32k for the v1 series, or kimi-k2-0905-preview for an earlier K2.
const KIMI_CHAT_MODEL = process.env.KIMI_CHAT_MODEL || "kimi-k2.6";

const draftSchema = z.object({
  result: z.string(),
  authority: z.string(),
  proof: z.string(),
  acceptance: z.string(),
  failure: z.string(),
});

type ChatBody = {
  messages: UIMessage[];
  draft?: WorkContractDraft;
};

function sanitizeDraft(input: unknown): WorkContractDraft {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ...EMPTY_WORK_CONTRACT_DRAFT };
  return parsed.data;
}

function systemPrompt(draft: WorkContractDraft): string {
  const fieldStatus = WORK_CONTRACT_FIELDS.map(f => {
    const v = draft[f].trim();
    if (!v) return `- ${f}: (empty)`;
    return `- ${f}: ${v.length > 80 ? v.slice(0, 80) + "…" : v}`;
  }).join("\n");

  const next = nextEmptyField(draft);
  const nextHint = next
    ? `The next field to ask about is "${next}". Ask the user a focused question that will give you what you need for that field.`
    : `All five fields are populated. Briefly congratulate the user, note that they can edit any field directly in the preview, and remind them to click "Use this contract" when satisfied.`;

  return [
    "You help a user define a verifiable work contract for an AI agent.",
    "The contract has exactly five fields, in this order: result, authority, proof, acceptance, failure.",
    "",
    "Definitions:",
    "- result: what gets delivered",
    "- authority: what the agent may / may not do",
    "- proof: evidence the agent must produce",
    "- acceptance: pass criteria",
    "- failure: revision and reject rules",
    "",
    "RULES (strict):",
    "- Respond in the user's language. Default to English; switch to Chinese only if the user writes in Chinese.",
    "- Each turn, ask ONE question, about ONE field. Never bulk-ask multiple fields.",
    "- When the user provides info, call the `updateContractDraft` tool to set one or two fields based on what they said, then ask about the next empty field.",
    "- Keep replies short (1-3 sentences). Don't lecture.",
    "- Don't repeat the user back verbatim. Acknowledge briefly, then move on.",
    "- Quote field values as you'd write them into the contract: clear, specific, third-person.",
    "- If the user types something off-topic, gently steer back.",
    "- If the user edits a field directly (you'll see it populated in the current draft below), don't re-ask that field — move to the next empty one.",
    "- Stop calling the tool once all five fields are non-empty.",
    "",
    "Current draft:",
    fieldStatus,
    "",
    nextHint,
  ].join("\n");
}

export async function POST(req: NextRequest) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const draft = sanitizeDraft(body.draft);
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    return stubResponse(messages, draft);
  }

  const kimi = createOpenAICompatible({
    name: "kimi",
    apiKey,
    baseURL: KIMI_BASE_URL,
  });
  const model = kimi.chatModel(KIMI_CHAT_MODEL);

  const updateContractDraftTool = tool({
    description:
      "Set one field of the work contract draft to a clear, specific value. Call once per field. Don't call for fields that are already populated unless the user explicitly asked to change them.",
    inputSchema: z.object({
      field: z.enum(WORK_CONTRACT_FIELDS),
      value: z
        .string()
        .min(1)
        .max(WORK_CONTRACT_FIELD_MAX)
        .describe("The value to write into the field, as it should appear in the contract."),
    }),
    execute: async ({ field, value }) => {
      // The client intercepts the tool call to update its draft; the execute
      // result is just an ack so the model can continue the loop.
      return { ok: true as const, field, value };
    },
  });

  try {
    const result = streamText({
      model,
      system: systemPrompt(draft),
      messages: await convertToModelMessages(messages),
      tools: { updateContractDraft: updateContractDraftTool },
      stopWhen: stepCountIs(4),
    });
    return result.toUIMessageStreamResponse();
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "stream error" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Stub path — no AI key configured. Emits a deterministic UI message stream
 * that mimics the real flow: one canned reply per turn, one tool call writing
 * the next empty field. Reviewers can drive the whole component without an AI.
 */
function stubResponse(messages: UIMessage[], draft: WorkContractDraft): Response {
  const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
  const lastUserText = lastUserMessage
    ? lastUserMessage.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map(p => p.text)
        .join(" ")
        .trim()
    : "";

  const next = nextEmptyField(draft);
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: generateId() });
      writer.write({ type: "start-step" });

      const text = (s: string) => {
        const id = generateId();
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: s });
        writer.write({ type: "text-end", id });
      };

      const callTool = (field: WorkContractField, value: string) => {
        const toolCallId = generateId();
        writer.write({
          type: "tool-input-available",
          toolCallId,
          toolName: "updateContractDraft",
          input: { field, value },
        });
        writer.write({
          type: "tool-output-available",
          toolCallId,
          output: { ok: true, field, value },
        });
      };

      if (isDraftComplete(draft)) {
        text(
          'Looks like every field is filled in. Edit anything that doesn\'t feel right in the preview on the right, then click "Use this contract" to drop it into the form.',
        );
      } else if (!lastUserText && messages.length === 0) {
        // Opening turn (shouldn't normally hit this — the component seeds a greeting,
        // but be safe).
        text(`Hi — let's pin down the work contract. ${FIELD_QUESTION.result}`);
      } else if (next) {
        // Use whatever the user just said as flavoring; write a canned value
        // (the user can always edit it in the right pane).
        const reply = lastUserText
          ? `Got it — capturing that as **${next}**.`
          : `Filling in a draft **${next}** for you.`;
        callTool(next, FIELD_STUB_VALUE[next]);

        // Find what's next AFTER this one
        const remaining = CONTRACT_FIELD_ORDER.find(f => f !== next && !draft[f].trim());
        const followup = remaining
          ? ` ${FIELD_QUESTION[remaining]}`
          : ` That's the last field — review the preview and click \"Use this contract\" when ready.`;

        text(`${reply}${followup}\n\n(Stub mode: no AI key configured. Canned values — edit anything in the preview.)`);
      }

      writer.write({ type: "finish-step" });
      writer.write({ type: "finish" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
