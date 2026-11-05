/**
 * Context-manager.js — Token budget management for the AI assistant
 *
 * Estimates token usage and trims conversation history before each send to keep the context window
 * within safe limits (specs/ai.md §2 and §2.1).
 *
 * Strategy (MVP): keep the system prompt + the most recent messages, dropping the oldest messages
 * when the estimated total exceeds the configured token budget. Dropped messages are replaced with
 * a single summary note so the model knows history was truncated.
 *
 * @license MIT
 */

import type { createChatState } from "@jxsuite/ai/chat-state";
import { CHARS_PER_TOKEN } from "@jxsuite/ai/harness";
import {
  SEAL_RELOADED,
  repairToolPairs,
  toChatMessages,
  toLiveMessages,
} from "@jxsuite/ai/messages";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import { modelContextWindow } from "./ai-models";

/** How many tool messages {@link pruneOrphanToolMessages} dropped, moved and sealed. */
export interface OrphanToolRepair {
  dropped: number;
  moved: number;
  sealed: number;
}

/** Shape of a single entry returned by `chatState.toMessagesArray()`. */
interface MessageArrayEntry {
  role: string;
  content?: string | null;
  tool_calls?: {
    function?: { name?: string; arguments?: string };
  }[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Approximate context windows (in tokens) per model id, longest-prefix matched. Used to derive a
 * model-aware budget instead of a flat cap (specs/ai.md §2.1). Conservative fallback for unknown
 * models.
 */
const MODEL_CONTEXT_WINDOWS: [string, number][] = [
  ["gpt-4o", 128_000],
  ["gpt-4.1", 1_000_000],
  ["gpt-4-turbo", 128_000],
  ["gpt-4", 8192],
  ["gpt-3.5", 16_385],
  ["o1", 200_000],
  ["o3", 200_000],
  ["claude", 200_000],
];

/** Fallback window for models not in the table above. */
const DEFAULT_CONTEXT_WINDOW = 32_000;

/** Fraction of the window we'll actually fill before trimming. */
const BUDGET_FRACTION = 0.8;

/** Fraction of the window at which we surface a "context getting large" warning. */
const WARN_FRACTION = 0.5;

/**
 * Resolve the context window (tokens) for a model id: what the backend reported, else a
 * longest-prefix match on the table above, else the conservative default.
 *
 * The backend's number goes first because the table can only ever know the names it was written
 * with. Every `@cf/*` model missed it and was budgeted at {@link DEFAULT_CONTEXT_WINDOW}, so a
 * managed 128k model started dropping the oldest turns at about 25.6k — a fifth of what it could
 * hold, on the one backend that actually publishes the figure.
 *
 * @param {string | undefined} model
 * @returns {number}
 */
function contextWindowFor(model: string | undefined): number {
  if (!model) {
    return DEFAULT_CONTEXT_WINDOW;
  }
  const reported = modelContextWindow(model);
  if (reported !== undefined && reported > 0) {
    return reported;
  }
  const id = model.toLowerCase();
  let best = 0;
  let window = DEFAULT_CONTEXT_WINDOW;
  for (const [prefix, size] of MODEL_CONTEXT_WINDOWS) {
    if (id.startsWith(prefix) && prefix.length > best) {
      best = prefix.length;
      window = size;
    }
  }
  return window;
}

/** Messages to keep at the tail (most recent), regardless of budget. */
const KEEP_RECENT = 20;

/**
 * Minimum number of user or tool messages we must preserve beyond the recent window so the model
 * retains conversation grounding.
 */
const MIN_USER_TURNS = 3;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Estimate token count from a string or array of messages.
 *
 * @param {string | object[]} input
 * @returns {number}
 */
function estimateTokens(input: string | MessageArrayEntry[]): number {
  if (isString(input)) {
    return Math.ceil(input.length / CHARS_PER_TOKEN);
  }
  let total = 0;
  for (const msg of input) {
    total += estimateTokens(msg.content || "");
    // Tool calls carry extra tokens for the function name + arguments.
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total +=
          estimateTokens(tc.function?.name || "") +
          estimateTokens(tc.function?.arguments || "") +
          4; // Framing overhead
      }
    }
    // Each message has ~4 tokens of framing overhead (role, etc.)
    total += 4;
  }
  return total;
}

/** The wire-shaped entry {@link estimateTokens} reads, for one transcript message. */
function wireEntry(msg: ReturnType<typeof createChatState>["messages"][number]): MessageArrayEntry {
  const entry: MessageArrayEntry = { content: msg.content, role: msg.role };
  if (msg.toolCalls) {
    entry.tool_calls = msg.toolCalls.map((tc) => ({
      function: { arguments: tc.arguments, name: tc.name },
    }));
  }
  return entry;
}

/**
 * The context's size in tokens, as close to the provider's own count as the transcript allows.
 *
 * When the provider reported a count (`chatState.usage`) for a transcript this one still extends
 * (the message at the count's boundary is the one it was taken at), that count covers everything up
 * to it exactly, tool schemas included, so only the messages added since are estimated, plus
 * whatever the system prompt has grown by. Without one, or once the transcript has been trimmed,
 * rewound or repaired beneath it, the whole history is estimated at four characters per token,
 * which is what every budget used before the count was forwarded.
 */
function contextTokens(
  chatState: ReturnType<typeof createChatState>,
  systemTokens: number,
): number {
  return (
    countedTokens(chatState, systemTokens) ??
    systemTokens + estimateTokens(chatState.toMessagesArray())
  );
}

/** The provider's count carried forward to this transcript, when there is one it still covers. */
function countedTokens(
  chatState: ReturnType<typeof createChatState>,
  systemTokens: number,
): number | null {
  const { usage, messages } = chatState;
  const boundary = usage ? messages[usage.messageCount - 1] : undefined;
  if (usage && boundary && boundary.id === usage.lastMessageId) {
    /* Only what will be SENT: `toMessagesArray` drops an assistant turn carrying neither text nor
       tool calls — the placeholder `sendMessage` pushes is always one — so it is not counted. */
    const since = messages
      .slice(usage.messageCount)
      .filter((msg) => msg.role !== "assistant" || msg.content || (msg.toolCalls?.length ?? 0) > 0)
      .map((msg) => wireEntry(msg));
    /* The system prompt is rebuilt on every send from live state (the document outline, the file
       inventory), so the one the count covered is not the one about to go out. What it has grown
       or shrunk by is added, estimated the same way on both sides. */
    const promptDrift = usage.systemTokens === undefined ? 0 : systemTokens - usage.systemTokens;
    const reused = Math.max(0, usage.contextTokens + promptDrift) + estimateTokens(since);
    // A count this module cannot trust is no count at all.
    if (Number.isFinite(reused)) {
      return reused;
    }
  }
  return null;
}

/**
 * The estimate of a system prompt, in the same units {@link trimContext} budgets in — what the loop
 * records beside a provider's count so the next budget can measure the prompt's drift.
 *
 * @param {string} systemPrompt
 * @returns {number}
 */
export function estimatePromptTokens(systemPrompt: string): number {
  return estimateTokens(systemPrompt);
}

// ─── Trim ───────────────────────────────────────────────────────────────────

/**
 * Trim chat history so the total estimated token count stays within the budget. Returns trimming
 * metadata, or null if no trimming was needed.
 *
 * Side effect: drops messages from chatState.messages (in-place via splice) and may insert a
 * summary note.
 *
 * @param {ReturnType<typeof import("@jxsuite/ai/chat-state").createChatState>} chatState
 * @param {string} systemPrompt
 * @returns {{ estimatedTokens: number; droppedCount: number } | null}
 */
export function trimContext(
  chatState: ReturnType<typeof createChatState>,
  systemPrompt: string,
): { estimatedTokens: number; droppedCount: number } | null {
  const window = contextWindowFor(chatState.model);
  const maxTokens = Math.floor(window * BUDGET_FRACTION);
  const warnTokens = Math.floor(window * WARN_FRACTION);

  const systemTokens = estimateTokens(systemPrompt);
  const allMessages = chatState.messages;
  const total = contextTokens(chatState, systemTokens);

  if (total <= maxTokens) {
    chatState.setTokenCount(total);
    // Warn once the conversation crosses half the window, even before we trim.
    chatState.setContextWarning(total >= warnTokens);
    return { estimatedTokens: total, droppedCount: 0 };
  }

  // Must trim. How many messages to drop?
  // Keep the most recent KEEP_RECENT messages.
  // But also ensure we keep at least MIN_USER_TURNS worth of user/tool context.
  let keepFrom = Math.max(0, allMessages.length - KEEP_RECENT);

  // Walk backward from keepFrom to find MIN_USER_TURNS user/tool messages to preserve.
  let preservedTurns = 0;
  for (let i = allMessages.length - 1; i >= keepFrom; i--) {
    const { role } = allMessages[i]!;
    if (role === "user" || role === "tool") {
      preservedTurns += 1;
    }
  }

  // If we don't have enough turns in the recent window, extend backward.
  if (preservedTurns < MIN_USER_TURNS) {
    for (let i = keepFrom - 1; i >= 0 && preservedTurns < MIN_USER_TURNS; i--) {
      keepFrom = i;
      const { role } = allMessages[i]!;
      if (role === "user" || role === "tool") {
        preservedTurns += 1;
      }
    }
  }

  // Never drop the system message (which is at index 0 if role === "system").
  // For the Jx assistant, there is no system message in the messages array —
  // The system prompt is passed separately. So keepFrom is safe.

  if (keepFrom <= 0) {
    // Can't trim further without losing everything. Warn but don't truncate.
    chatState.setTokenCount(total);
    chatState.setContextWarning(true);
    return { estimatedTokens: total, droppedCount: 0 };
  }

  const droppedCount = keepFrom;
  allMessages.splice(0, keepFrom);
  // The provider counted a transcript that no longer exists; the estimate is all there is now.
  chatState.clearUsage();

  // Insert a summary note so the model knows context was trimmed.
  allMessages.unshift({
    id: `ctx_summary_${Date.now()}`,
    role: "user",
    content: `[Earlier conversation truncated. ${droppedCount} messages dropped to stay within token budget. The most recent ${allMessages.length - 1} messages are preserved.]`,
    timestamp: Date.now(),
  });

  const newTotal = systemTokens + estimateTokens(chatState.toMessagesArray());
  chatState.setTokenCount(newTotal);
  chatState.setContextWarning(true);

  return { estimatedTokens: newTotal, droppedCount };
}

// ─── Shed ───────────────────────────────────────────────────────────────────

/** What {@link shedToolResults} sheds down to, as a fraction of the window. */
const SHED_TARGET_FRACTION = 0.6;

/** A result smaller than this is mostly its stub already, and is often an answer worth keeping. */
const SHED_MIN_CHARS = 1024;

/** What a shed result tells the model. */
const SHED_NOTE =
  "This result was removed to save space. Call the tool again if you still need it.";

/** A tool's reply as an object, or an empty one when it is not a result this module can read. */
function parsedReply(content: string): JsonObject {
  try {
    /* SAFETY: JSON.parse without a reviver turns text into nothing but JSON values. */
    const parsed = JSON.parse(content) as JsonValue;
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * What is left of a tool's reply once its output is shed: how it ended and what it said it did, so
 * the model and a restored chip keep the outcome and lose only the bulk.
 */
function shedReply(content: string): string {
  const { success = true, summary, error } = parsedReply(content);
  return JSON.stringify({ success, summary, error, shed: SHED_NOTE });
}

/**
 * Keep a turn inside the model's window between its rounds (specs/ai.md §3.8).
 *
 * {@link trimContext} runs when a message is sent, so nothing else bounds what one turn's own tool
 * results add, and a turn with room to work could fill the window and have its request refused.
 * Past the same budget the trim uses, this replaces the oldest large tool results with a stub until
 * the context is back under {@link SHED_TARGET_FRACTION}. The results of the latest round are never
 * touched, because the model has not read them yet, and the pairs are never broken, because only a
 * reply's content changes.
 *
 * It changes the transcript rather than one request, so a shed result stays shed: the next send
 * measures what it will really send, and the provider's prompt cache breaks once for a whole batch
 * rather than on every round after the budget is reached.
 *
 * @param {ReturnType<typeof createChatState>} chatState
 * @param {string} systemPrompt
 * @returns {number} How many results it shed.
 */
export function shedToolResults(
  chatState: ReturnType<typeof createChatState>,
  systemPrompt: string,
): number {
  const window = contextWindowFor(chatState.model);
  const systemTokens = estimateTokens(systemPrompt);
  const { messages } = chatState;
  let total =
    countedTokens(chatState, systemTokens) ??
    systemTokens + estimateTokens(messages.map((message) => wireEntry(message)));
  if (total <= Math.floor(window * BUDGET_FRACTION)) {
    return 0;
  }
  const target = Math.floor(window * SHED_TARGET_FRACTION);
  /* The latest round is the trailing run of replies, with the placeholder of the round about to
     stream after it when there is one. */
  let latest = messages.length;
  while (
    latest > 0 &&
    messages[latest - 1]!.role === "assistant" &&
    !messages[latest - 1]!.toolCalls
  ) {
    latest -= 1;
  }
  while (latest > 0 && messages[latest - 1]!.role === "tool") {
    latest -= 1;
  }
  let shed = 0;
  for (let i = 0; i < latest && total > target; i++) {
    const message = messages[i]!;
    if (message.role === "tool" && message.content.length >= SHED_MIN_CHARS) {
      const before = estimateTokens(message.content);
      message.content = shedReply(message.content);
      total -= before - estimateTokens(message.content);
      shed += 1;
    }
  }
  if (shed > 0) {
    // The provider counted the longer transcript; the estimate is all there is until it next counts.
    chatState.clearUsage();
    chatState.setTokenCount(total);
    chatState.setContextWarning(true);
  }
  return shed;
}

// ─── Orphaned tool calls ────────────────────────────────────────────────────

/**
 * What a seal says for a call that was not cut off, so a reader and the model see the same reason.
 * Exported so a restore can name the outcome of an ordinary call nothing answered
 * (services/tool-outcomes.ts); `isSealContent` tells any seal from a reply.
 */
export const UNANSWERED_TOOL_RESULT = JSON.stringify({ success: false, error: SEAL_RELOADED });

/**
 * Repair tool-call pairing in place, and report how many messages it touched.
 *
 * `toMessagesArray()` serializes the array verbatim: an assistant message with `tool_calls` becomes
 * a `tool_calls` request, and a `tool` message becomes a reply carrying `tool_call_id`. Providers
 * require each reply directly after the request that made the call, and **four ordinary things
 * break that**:
 *
 * 1. `saveSession` persists `msgs.slice(-MAX_PERSIST_MESSAGES)` and `restoreChat` pushes the result
 *    back, so a session longer than the cap can be restored starting mid-pair.
 * 2. {@link trimContext} splices from the front for the token budget, with no more regard for pairs.
 * 3. A turn that stopped while a tool was still running — which `ask_user` makes routine, because its
 *    tool is _designed_ to be outstanding — leaves a request with no reply.
 * 4. A transcript written before one window ran one turn can hold a reply after a later message.
 *
 * Each of those produced a 400 on the NEXT send, from a conversation the user could see was fine.
 * So the repair belongs on the send path, after trimming, rather than at any one of the sites. It
 * is `repairToolPairs` (`@jxsuite/ai/messages`, specs/ai.md §3.4), the same repair the turn engine
 * runs at turn start, applied to the chat store: pairing is per request rather than by call id
 * across the transcript, because a provider may reuse `call_0` every round; a reply away from its
 * request is moved back beside it; a request with no reply is sealed with a synthesized failure
 * (keeping the assistant's text, which dropping the message would lose) that says whether the call
 * was cut off mid-arguments; and a reply with no request is dropped.
 *
 * The store is rebuilt with one `splice`, and only when something changed. Every message the repair
 * kept is the store's own object, which the streaming turn and the panel hold by identity, and the
 * array itself is never reassigned.
 *
 * @param {ReturnType<typeof createChatState>} chatState
 * @returns {{ dropped: number; moved: number; sealed: number }}
 */
export function pruneOrphanToolMessages(
  chatState: ReturnType<typeof createChatState>,
): OrphanToolRepair {
  const live = chatState.messages;
  const neutral = toChatMessages(live);
  const { messages, sealed, dropped, moved } = repairToolPairs(neutral);
  if (sealed.length + dropped.length + moved.length === 0) {
    return { dropped: 0, moved: 0, sealed: 0 };
  }
  const liveOf = new Map(neutral.map((message, index) => [message, live[index]!]));
  const next = messages.map((message) => liveOf.get(message) ?? toLiveMessages([message])[0]!);
  live.splice(0, live.length, ...next);
  return { dropped: dropped.length, moved: moved.length, sealed: sealed.length };
}
