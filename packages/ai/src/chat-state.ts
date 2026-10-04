/**
 * Chat-state.js — Provider-agnostic reactive chat state management
 *
 * Manages the lifecycle of a chat conversation: messages, streaming status, tool calls, and errors.
 * Built on @vue/reactivity for fine-grained updates. No Studio or Jx dependencies — reusable in any
 * chat UI context.
 *
 * @module @jxsuite/ai/chat-state
 * @license MIT
 */

import { reactive } from "@vue/reactivity";

import { nextMessageId } from "./message-id.ts";
import { toChatMessages } from "./messages/convert.ts";
import { toOpenAIMessages } from "./messages/openai.ts";
import type { LiveMessage, LiveToolCall, OpenAIMessage, Role } from "./messages/types.ts";
import type { StreamUsageEvent } from "./streaming-client.ts";
import type { ToolResult } from "./tools.ts";

export type ChatState = "idle" | "streaming" | "error";

export type MessageRole = Role;

/** A transcript message: the v1 shape `@jxsuite/ai/messages` reads (specs/ai.md §2.3). */
export type Message = LiveMessage;

/** A tool call on a transcript message, carrying the outcome its chip renders. */
export type ToolCallRecord = LiveToolCall;

/**
 * The provider's own count for the last request, and where in the transcript it was taken.
 *
 * `messageCount` and `lastMessageId` are what make the figure reusable: every message up to and
 * including `lastMessageId` was part of a request the provider counted, so a later budget needs to
 * estimate only what was added since, rather than re-estimating the whole history at four
 * characters per token. A transcript whose message at that position is no longer `lastMessageId`
 * has been trimmed, rewound, repaired or replaced, and the figure no longer describes it — length
 * alone cannot say so, because a retry re-grows the transcript to the same length.
 */
export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  messageCount: number;
  /** The id of the last message the count covers (`messages[messageCount - 1]`). */
  lastMessageId: string;
  /**
   * What the counted request leaves in the context for the NEXT request: input plus output, minus
   * reasoning the provider generated but never streamed. That reasoning (OpenAI's o-series on chat
   * completions) is billed as output yet is not replayed, so it occupies nothing on the next send.
   */
  contextTokens: number;
  /** The estimate of the system prompt the counted request carried, when the caller supplied it. */
  systemTokens?: number;
}

export interface ChatStore {
  messages: Message[];
  status: ChatState;
  streamingContent: string;
  pendingToolCalls: ToolCallRecord[];
  error: string | null;
  model: string;
  tokenCount: number;
  contextWarning: boolean;
  /** The last reported count, or null when none has been reported since the transcript changed. */
  usage: ChatUsage | null;
}

// ─── Types ───────────────────────────────────────────────────────────────────

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** A fresh message id, from the counter the harness shares. */
const uid = nextMessageId;

/** A token count a budget can use: a finite, non-negative number. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a reactive chat state store.
 *
 * @param {object} [opts]
 * @param {string} [opts.model] - Default model name
 * @returns {ChatStore & {
 *   sendMessage: (text: string) => void;
 *   beginAssistantTurn: () => void;
 *   appendDelta: (content: string) => void;
 *   appendReasoning: (content: string) => void;
 *   appendToolCallStart: (id: string, name: string) => void;
 *   appendToolCallDelta: (id: string, args: string) => void;
 *   appendToolCallEnd: (id: string) => void;
 *   appendToolResult: (id: string, result: ToolResult) => void;
 *   pushToolResultMessage: (toolCallId: string, content: string) => void;
 *   finishStream: (stopReason: string) => void;
 *   setError: (message: string) => void;
 *   cancelStream: () => void;
 *   clearChat: () => void;
 *   retryLast: () => void;
 *   setModel: (model: string) => void;
 *   setTokenCount: (count: number) => void;
 *   recordUsage: (usage: StreamUsageEvent, opts?: { systemTokens?: number }) => void;
 *   clearUsage: () => void;
 *   setContextWarning: (warning: boolean) => void;
 *   toMessagesArray: () => OpenAIMessage[];
 * }}
 */
export function createChatState(opts: { model?: string } = {}) {
  const model = opts.model || "gpt-4o";

  const store = reactive<ChatStore>({
    messages: [],
    status: "idle",
    streamingContent: "",
    pendingToolCalls: [],
    error: null,
    model,
    tokenCount: 0,
    contextWarning: false,
    usage: null,
  });

  let _streamingMessage: Message | null = null;

  /**
   * Add a user message and prepare for streaming response.
   *
   * @param {string} text
   */
  function sendMessage(text: string) {
    if (store.status === "streaming") {
      return;
    }

    const userMsg = {
      id: uid(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    } as Message;
    store.messages.push(userMsg);

    beginAssistantTurn();
  }

  /**
   * Prepare for a new streaming assistant response without adding a user message. Used by the agent
   * loop to start the next round after appending tool result messages.
   */
  function beginAssistantTurn() {
    if (store.status === "streaming") {
      return;
    }

    store.error = null;
    store.streamingContent = "";
    store.pendingToolCalls = [];

    // Set status BEFORE pushing the placeholder so reactive effects see "streaming" when the
    // Push triggers them — otherwise the effect renders the empty placeholder as a finalized msg.
    store.status = "streaming";

    // Create placeholder assistant message for streaming content
    _streamingMessage = {
      id: uid(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    } as Message;
    store.messages.push(_streamingMessage);
    /*
     * Re-read through the reactive proxy so appendDelta / appendToolCallStart mutations notify
     * effects (e.g. watchAssistant in ai-panel.ts). _streamingMessage now holds the proxied
     * version, not the raw object pushed above.
     */
    _streamingMessage = store.messages.at(-1) ?? null;
  }

  /**
   * Append a `tool` role message carrying a tool call's result, ready to be sent back to the LLM on
   * the next round.
   *
   * @param {string} toolCallId
   * @param {string} content
   */
  function pushToolResultMessage(toolCallId: string, content: string) {
    store.messages.push({
      id: uid(),
      role: "tool",
      toolCallId,
      content,
      timestamp: Date.now(),
    } as Message);
  }

  /**
   * Append a text delta to the streaming assistant message.
   *
   * @param {string} content
   */
  function appendDelta(content: string) {
    if (store.status !== "streaming" || !_streamingMessage) {
      return;
    }
    store.streamingContent += content;
    _streamingMessage.content = store.streamingContent;
  }

  /**
   * Append a reasoning delta to the streaming assistant message.
   *
   * Held on the message rather than in `streamingContent`: it is not part of the answer, but it IS
   * part of the turn the provider will be shown again on the next round.
   *
   * @param {string} content
   */
  function appendReasoning(content: string) {
    if (store.status !== "streaming" || !_streamingMessage) {
      return;
    }
    _streamingMessage.reasoningContent = (_streamingMessage.reasoningContent ?? "") + content;
  }

  /**
   * Start tracking a tool call within the stream.
   *
   * @param {string} id
   * @param {string} name
   */
  function appendToolCallStart(id: string, name: string) {
    if (store.status !== "streaming") {
      return;
    }
    const tc = {
      id,
      name,
      arguments: "",
      result: null,
    } as ToolCallRecord;
    store.pendingToolCalls.push(tc);

    if (_streamingMessage) {
      if (!_streamingMessage.toolCalls) {
        _streamingMessage.toolCalls = [];
      }
      _streamingMessage.toolCalls.push(tc);
    }
  }

  /**
   * Append a partial argument fragment to a pending tool call.
   *
   * @param {string} id
   * @param {string} args
   */
  function appendToolCallDelta(id: string, args: string) {
    const tc = store.pendingToolCalls.find((t) => t.id === id);
    if (tc) {
      tc.arguments += args;
    }
  }

  /**
   * Mark a tool call as complete (all arguments received).
   *
   * @param {string} _id
   */
  function appendToolCallEnd(_id: string) {
    // Tool call is complete — arguments are fully accumulated.
    // The caller should parse the arguments JSON and execute the tool.
    // Tool results are attached via appendToolResult().
  }

  /**
   * Attach a result to the tool call it answers, on the assistant message that made the call.
   *
   * The record is looked for on that message rather than on the stream: a loop runs its tools after
   * the round's stream has finished, when there is no streaming message and no pending call left,
   * and looking only there attached every result to nothing, so a live chip never showed how its
   * call ended. The request is the assistant message directly before the tool replies at the end of
   * the transcript, the one position the wire allows a reply in; a provider may reuse call ids
   * across rounds, so an earlier request carrying the same id is never the one being answered.
   *
   * @param {string} id
   * @param {ToolResult} result
   */
  function appendToolResult(id: string, result: ToolResult) {
    let index = store.messages.length - 1;
    while (index >= 0 && store.messages[index]!.role === "tool") {
      index -= 1;
    }
    const request = store.messages[index];
    const record =
      request?.role === "assistant" ? request.toolCalls?.find((t) => t.id === id) : null;
    if (record) {
      record.result = result;
    }
  }

  /**
   * Finalize the streaming response.
   *
   * @param {string} _stopReason
   */
  function finishStream(_stopReason: string) {
    store.status = "idle";
    store.streamingContent = "";
    store.pendingToolCalls = [];
    _streamingMessage = null;
  }

  /**
   * Set the chat state to error with a message.
   *
   * @param {string} message
   */
  function setError(message: string) {
    store.status = "error";
    store.error = message;
    store.streamingContent = "";
    store.pendingToolCalls = [];
    // Remove the partial streaming message — it may contain incomplete tool_calls
    // That would poison the conversation history on the next send.
    if (_streamingMessage) {
      const idx = store.messages.lastIndexOf(_streamingMessage);
      if (idx !== -1) {
        store.messages.splice(idx, 1);
      }
    }
    _streamingMessage = null;
  }

  /** Cancel the current stream. Resets streaming state. */
  function cancelStream() {
    // Always remove the partial streaming message — it may contain
    // Incomplete tool_calls that would poison the conversation history on retry.
    if (_streamingMessage) {
      const idx = store.messages.lastIndexOf(_streamingMessage);
      if (idx !== -1) {
        store.messages.splice(idx, 1);
      }
    }
    store.status = "idle";
    store.streamingContent = "";
    store.pendingToolCalls = [];
    _streamingMessage = null;
    store.error = null;
  }

  /** Clear the entire chat history. */
  function clearChat() {
    store.messages.length = 0;
    store.status = "idle";
    store.streamingContent = "";
    store.pendingToolCalls = [];
    store.error = null;
    store.contextWarning = false;
    store.usage = null;
    _streamingMessage = null;
  }

  /** Retry the last user message (remove last assistant + user, then the caller re-sends). */
  function retryLast() {
    // Remove the last assistant message
    while (store.messages.length > 0 && store.messages.at(-1)!.role !== "user") {
      store.messages.pop();
    }
    // Remove the last user message (caller will re-send)
    if (store.messages.length > 0 && store.messages.at(-1)!.role === "user") {
      store.messages.pop();
    }
    store.status = "idle";
    store.error = null;
  }

  /**
   * Set the model name.
   *
   * @param {string} m
   */
  function setModel(m: string) {
    store.model = m;
  }

  /**
   * Set the approximate token count for context management.
   *
   * @param {number} count
   */
  function setTokenCount(count: number) {
    store.tokenCount = count;
  }

  /**
   * Record the provider's count for the request that just finished. The count covers everything the
   * request carried plus what it generated, which is the context's size at this point — less any
   * reasoning the provider billed but never streamed, since the next request cannot replay what it
   * never received. It replaces the estimate in `tokenCount` rather than adding to it.
   *
   * @param {StreamUsageEvent} usage
   * @param {{ systemTokens?: number }} [extra] - The estimate of the system prompt this request
   *   carried, so a later budget can add what the prompt has grown by since.
   */
  function recordUsage(usage: StreamUsageEvent, extra: { systemTokens?: number } = {}) {
    /* A backend's frame, trusted no further than its shape: a count that is not a finite,
       non-negative number would turn every later budget into NaN, and a NaN budget trims history
       it has no reason to. Such a frame is ignored, and the estimate stands. */
    if (!isCount(usage.inputTokens) || !isCount(usage.outputTokens)) {
      return;
    }
    const { type: _type, ...counts } = usage;
    const counted = _streamingMessage ?? store.messages.at(-1);
    /* Replayed means SENT, so the projection that builds the request is asked: it drops an
       assistant turn carrying neither text nor tool calls, reasoning and all, so a turn that only
       thought is not replayed either. */
    const [sent] = counted ? toOpenAIMessages(toChatMessages([counted])) : [];
    const replayed = sent?.role === "assistant" && Boolean(sent.reasoning_content);
    const unreplayed = replayed || !isCount(usage.reasoningTokens) ? 0 : usage.reasoningTokens;
    const contextTokens = Math.max(0, usage.inputTokens + usage.outputTokens - unreplayed);
    store.usage = {
      ...counts,
      contextTokens,
      lastMessageId: store.messages.at(-1)?.id ?? "",
      messageCount: store.messages.length,
      ...(extra.systemTokens === undefined ? {} : { systemTokens: extra.systemTokens }),
    };
    store.tokenCount = contextTokens;
  }

  /** Forget the last count — the transcript it described has changed underneath it. */
  function clearUsage() {
    store.usage = null;
  }

  /**
   * Set the context overflow warning flag.
   *
   * @param {boolean} warning
   */
  function setContextWarning(warning: boolean) {
    store.contextWarning = warning;
  }

  /**
   * The conversation as the OpenAI chat-completions `messages` array the next request carries:
   * `toOpenAIMessages(toChatMessages(messages))` from `@jxsuite/ai/messages`, which says what the
   * wire leaves out and why (specs/ai.md §2.2). The system prompt travels separately.
   *
   * @returns {OpenAIMessage[]}
   */
  function toMessagesArray(): OpenAIMessage[] {
    return toOpenAIMessages(toChatMessages(store.messages));
  }

  return Object.assign(store, {
    sendMessage,
    beginAssistantTurn,
    appendDelta,
    appendReasoning,
    appendToolCallStart,
    appendToolCallDelta,
    appendToolCallEnd,
    appendToolResult,
    pushToolResultMessage,
    finishStream,
    setError,
    cancelStream,
    clearChat,
    retryLast,
    setModel,
    setTokenCount,
    recordUsage,
    clearUsage,
    setContextWarning,
    toMessagesArray,
  });
}
