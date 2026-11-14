/**
 * Anthropic.ts — the Anthropic Messages API as a provider adapter (specs/ai.md §2.6).
 *
 * The version 1 wire reaches Claude through a projection that sends no thinking at all
 * (`gateway/anthropic.ts`), because that wire cannot carry a signature. This adapter is the other
 * half: it takes the neutral conversation, where a thinking block keeps its signature and the
 * binding it was produced under, and replays signed thinking **exactly where its binding still
 * holds**.
 *
 * - **The replay rule.** A signed block is bound to the request that produced it: the system prompt,
 *   the tools, and everything before it. A block whose recorded binding is not the one the request
 *   now gives its message is stale. A provider accepts a history with a leading run of thinking
 *   removed, so the projection keeps the **trailing run** of assistant turns whose signed blocks
 *   all still bind, and strips the thinking of every turn before it. Thinking another family
 *   produced, or that carries no signature, is never sent.
 * - **One retry, with nothing replayed.** Where the API still refuses a block as bound to a different
 *   conversation, the request is sent once more with every thinking block removed, which is always
 *   accepted. Where binding controls are available the request says what to do with a mismatch
 *   instead, and nothing is retried.
 *
 * @module @jxsuite/ai/providers
 * @license MIT
 */

import type { JsonObject } from "../core-types.ts";
import {
  ANTHROPIC_BASE_URL,
  ANTHROPIC_MAX_TOKENS,
  ANTHROPIC_TOOL_ID,
  anthropicHeaders,
  isFirstPartyAnthropic,
  normalizeAnthropicStream,
} from "../gateway/anthropic.ts";
import type { ToolUseBlock } from "../gateway/anthropic.ts";
import { fetchFailureFrame } from "../gateway/normalize.ts";
import { bindingOf } from "../messages/binding.ts";
import type { Block, ReasoningBlock, WireMessage } from "../messages/types.ts";
import type { WireEvent } from "../streaming-client.ts";
import type { JSONSchema } from "../tools.ts";
import type { Provider, ProviderCapabilities, ProviderRequest } from "./types.ts";

/** The beta that lets a request say what the API does with a thinking block that does not bind. */
export const BINDING_CONTROLS_BETA = "thinking-binding-controls-2026-08-01";

/** The most `cache_control` breakpoints one request may carry. */
const MAX_CACHE_BREAKPOINTS = 4;

/** The mark that ends a cacheable prefix. */
interface CacheControl {
  cache_control?: { type: "ephemeral" };
}

/** A text content block. */
interface TextPart extends CacheControl {
  type: "text";
  text: string;
}

/** A thinking block, replayed with the signature it was sent with. */
interface ThinkingPart {
  type: "thinking";
  thinking: string;
  signature: string;
}

/** A thinking block the API sent only as an opaque payload, replayed as sent. */
interface RedactedThinkingPart {
  type: "redacted_thinking";
  data: string;
}

/** A call's outcome, which rides on a user message. */
interface ToolResultPart extends CacheControl {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

type ContentPart = TextPart | ThinkingPart | RedactedThinkingPart | ToolUseBlock | ToolResultPart;

/** One message of a Messages API request. `system` is a mid-conversation system message. */
interface MessagesApiMessage {
  role: "user" | "assistant" | "system";
  content: ContentPart[];
}

/** A tool, as the Messages API declares one. */
interface MessagesApiTool extends CacheControl {
  name: string;
  description: string;
  input_schema: Readonly<JSONSchema>;
  eager_input_streaming?: boolean;
}

/** The Messages API request this adapter sends. */
export interface MessagesApiRequest {
  model: string;
  max_tokens: number;
  stream: true;
  messages: MessagesApiMessage[];
  system?: TextPart[];
  tools?: MessagesApiTool[];
  temperature?: number;
  thinking?: JsonObject;
}

/** How a request is shaped for the upstream it goes to. */
export interface MessagesProjectionOptions {
  /** The `max_tokens` of a request that names none. The Messages API requires one. */
  readonly defaultMaxTokens: number;
  /**
   * Whether the upstream is Anthropic's own API: only there does the request carry cache
   * breakpoints and eager tool-input streaming, which an Anthropic-compatible endpoint may refuse.
   */
  readonly firstParty?: boolean;
  /** Whether the model accepts a `system` message after the conversation has begun. */
  readonly midConversationSystem?: boolean;
  /** Passed through as the request's `thinking`, with any binding control added to it. */
  readonly thinking?: JsonObject;
  /** What the API is told to do with a thinking block that does not bind, where it can be told. */
  readonly bindingControls?: { readonly prefixMismatch: "drop_block" | "error" };
  /** Send no thinking at all: the recovery from a binding the API refused. */
  readonly withoutThinking?: boolean;
}

/**
 * A tool-use id the Messages API accepts, for the call with `id` first made in the message at
 * `messageIndex`. An id that already matches `^[a-zA-Z0-9_-]+$` is kept; any other has every other
 * character replaced and its message's index appended, so two calls whose ids differ only in a
 * rejected character cannot collide across messages, and the mapping is the same on every request.
 *
 * @param {string} id - The call's id, as the conversation holds it
 * @param {number} messageIndex - The index of the assistant message that made the call
 * @returns {string}
 */
export function anthropicToolId(id: string, messageIndex: number): string {
  return ANTHROPIC_TOOL_ID.test(id)
    ? id
    : `toolu_${id.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}_${String(messageIndex)}`;
}

/**
 * What the family asks of a request for `model`. Every Claude model fixes the system prompt and the
 * tool list for a conversation's thinking to stay bound, requires a token ceiling, and takes four
 * cache breakpoints; a mid-conversation system message is accepted by the Opus, Fable and Mythos
 * lines and not by the others.
 *
 * @param {string} model - The model id
 * @returns {ProviderCapabilities}
 */
export function anthropicCapabilities(model: string): ProviderCapabilities {
  return {
    family: "anthropic",
    maxCacheBreakpoints: MAX_CACHE_BREAKPOINTS,
    midConversationSystem: /opus-(?:5|4-8)|fable-5|mythos-5/.test(model),
    promptLayout: "append",
    requiresMaxTokens: true,
    toolListing: "stable",
  };
}

/**
 * A call's arguments as the `input` object the Messages API requires. Arguments that do not parse
 * to an object are sent as `{}`: the call already has an error result saying so.
 *
 * @param {string} argumentsText - The call's arguments, as streamed
 * @returns {JsonObject}
 */
function inputOf(argumentsText: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * True when a parsed value is a JSON object.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a block is thinking Claude signed or redacted: the only kind that is ever replayed.
 *
 * @param {Block} block
 * @returns {boolean}
 */
function isClaudeThinking(block: Block): block is ReasoningBlock {
  return (
    block.type === "reasoning" &&
    block.provenance?.family === "anthropic" &&
    (block.signature !== undefined || block.redacted !== undefined)
  );
}

/**
 * The index of the first message of the trailing run whose signed thinking still binds: every
 * assistant message from there on either carries none, or carries only blocks whose recorded
 * binding is the one the request gives that message now. The thinking of every message before it is
 * stale, and is not sent.
 *
 * @param {ProviderRequest} request
 * @returns {number}
 */
function replayFrom(request: ProviderRequest): number {
  let start = request.messages.length;
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index]!;
    const bound = message.role === "assistant" ? message.blocks.filter(isClaudeThinking) : [];
    if (bound.length === 0) {
      continue;
    }
    const binding = bindingOf(request, request.messages, index);
    if (!bound.every((block) => block.provenance?.binding === binding)) {
      break;
    }
    start = index;
  }
  return start;
}

/**
 * An assistant message's parts, in the order its blocks were produced: thinking (when it replays),
 * text, and a `tool_use` per call.
 *
 * @param {WireMessage} message - The assistant message
 * @param {number} index - Its place in the conversation
 * @param {boolean} replay - Whether its signed thinking is sent
 * @returns {ContentPart[]}
 */
function assistantParts(message: WireMessage, index: number, replay: boolean): ContentPart[] {
  const parts: ContentPart[] = [];
  for (const block of message.blocks) {
    if (block.type === "text" && block.text) {
      parts.push({ text: block.text, type: "text" });
    } else if (block.type === "tool_call") {
      parts.push({
        id: anthropicToolId(block.id, index),
        input: inputOf(block.argumentsText),
        name: block.name,
        type: "tool_use",
      });
    } else if (replay && isClaudeThinking(block)) {
      if (block.redacted !== undefined) {
        parts.push({ data: block.redacted, type: "redacted_thinking" });
      } else if (block.signature !== undefined) {
        parts.push({ signature: block.signature, thinking: block.text, type: "thinking" });
      }
    }
  }
  return parts;
}

/**
 * A message's text: its text blocks, joined.
 *
 * @param {WireMessage} message
 * @returns {string}
 */
function textOf(message: WireMessage): string {
  return message.blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
}

/**
 * Project a round's request onto the Messages API (specs/ai.md §2.6).
 *
 * - An assistant message is its blocks in order; its signed thinking is sent only in the trailing run
 *   whose bindings still hold (the replay rule above).
 * - A run of `tool` messages is one user message of `tool_result` blocks, first in that message.
 * - A `system` message before the conversation begins joins the top-level `system`. One in the middle
 *   of it is a `system` message where the model accepts one, and otherwise a text block on the user
 *   message that follows, after any tool results.
 * - The history starts at a user message that is not a tool reply, and a trailing assistant message
 *   is never sent: the current models refuse a prefill.
 * - On Anthropic's own API, cache breakpoints mark the last system block flagged `cache`, the last
 *   tool, and the last user message, four at most. Tools are sent in the order given.
 *
 * @param {ProviderRequest} request
 * @param {MessagesProjectionOptions} options
 * @returns {MessagesApiRequest}
 */
export function toAnthropicMessagesRequest(
  request: ProviderRequest,
  options: MessagesProjectionOptions,
): MessagesApiRequest {
  const firstParty = options.firstParty === true;
  const replayStart = options.withoutThinking ? request.messages.length : replayFrom(request);
  /* The id each call is sent under, so its reply names the same one. A reply is looked up by the
     conversation's own id, which the request that made it rewrote. */
  const toolIds = new Map<string, string>();

  const system: TextPart[] = request.system
    .filter((block) => block.text !== "")
    .map((block) => ({ text: block.text, type: "text" }));
  const messages: MessagesApiMessage[] = [];
  /** A system message's text, waiting for the user message it will ride on. */
  let pendingContext: string[] = [];
  let results: MessagesApiMessage | null = null;

  for (const [index, message] of request.messages.entries()) {
    if (message.role === "tool") {
      for (const block of message.blocks) {
        if (block.type !== "tool_result") {
          continue;
        }
        const part: ToolResultPart = {
          content: block.content,
          tool_use_id: toolIds.get(block.callId) ?? anthropicToolId(block.callId, index),
          type: "tool_result",
        };
        if (block.isError) {
          part.is_error = true;
        }
        if (results === null) {
          results = { content: [], role: "user" };
          messages.push(results);
        }
        results.content.push(part);
      }
      continue;
    }
    const text = textOf(message);
    if (message.role === "system") {
      if (!text) {
        continue;
      }
      if (messages.length === 0) {
        system.push({ text, type: "text" });
      } else if (options.midConversationSystem) {
        results = null;
        messages.push({ content: [{ text, type: "text" }], role: "system" });
      } else {
        pendingContext.push(text);
      }
      continue;
    }
    if (message.role === "assistant") {
      results = null;
      for (const block of message.blocks) {
        if (block.type === "tool_call") {
          toolIds.set(block.id, anthropicToolId(block.id, index));
        }
      }
      const content = assistantParts(message, index, index >= replayStart);
      if (content.length > 0) {
        messages.push({ content, role: "assistant" });
      }
      continue;
    }
    // A user message: the tool results it follows come first, then any context, then its text.
    const parts: ContentPart[] = [
      ...pendingContext.map((context): TextPart => ({ text: context, type: "text" })),
      ...(text ? [{ text, type: "text" } satisfies TextPart] : []),
    ];
    pendingContext = [];
    if (parts.length === 0) {
      continue;
    }
    /* One user turn, whatever it is made of: the tool results it follows, or the user message
       before it (a summary of an earlier conversation, then the person's new message). The API
       reads consecutive user messages as one turn, and this sends them as one. */
    const previous = results ?? messages.at(-1);
    if (previous?.role === "user") {
      previous.content.push(...parts);
    } else {
      messages.push({ content: parts, role: "user" });
    }
    results = null;
  }
  // Context with no later user message to ride on is carried by the last tool-result message.
  if (pendingContext.length > 0 && results) {
    results.content.push(
      ...pendingContext.map((context): TextPart => ({ text: context, type: "text" })),
    );
  }

  /* The history starts where a person speaks. Everything before that is dropped, and so are the
     tool results riding on that first message: the calls they answer went with it. */
  const start = messages.findIndex(
    (message) => message.role === "user" && message.content.some((part) => part.type === "text"),
  );
  messages.splice(0, start === -1 ? messages.length : start);
  const [first] = messages;
  if (first) {
    first.content = first.content.filter((part) => part.type !== "tool_result");
  }
  if (messages.at(-1)?.role === "assistant") {
    messages.pop();
  }

  const body: MessagesApiRequest = {
    max_tokens: request.maxTokens ?? options.defaultMaxTokens,
    messages,
    model: request.model,
    stream: true,
  };
  if (system.length > 0) {
    body.system = system;
  }
  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool): MessagesApiTool => {
      const entry: MessagesApiTool = {
        description: tool.description,
        input_schema: tool.inputSchema,
        name: tool.name,
      };
      if (firstParty) {
        entry.eager_input_streaming = true;
      }
      return entry;
    });
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (options.thinking || options.bindingControls) {
    body.thinking = { ...options.thinking };
    if (options.bindingControls) {
      body.thinking.block_binding = {
        prefix_mismatch_behavior: options.bindingControls.prefixMismatch,
      };
    }
  }
  if (firstParty) {
    markCacheBreakpoints(body, request);
  }
  return body;
}

/**
 * Mark where a request's cacheable prefixes end: the last system block the caller flagged, the last
 * tool, and the last user message, in that order and four at most. Everything up to a mark is read
 * from the cache on the next request that repeats it.
 *
 * @param {MessagesApiRequest} body - The request, marked in place
 * @param {ProviderRequest} request - The request it was projected from
 */
function markCacheBreakpoints(body: MessagesApiRequest, request: ProviderRequest): void {
  const mark = { type: "ephemeral" } as const;
  let left = MAX_CACHE_BREAKPOINTS;
  // The flagged system blocks are the first of `body.system`, in order, less any that were empty.
  const flagged = request.system
    .filter((block) => block.text !== "")
    .findLastIndex((block) => block.cache === true);
  const stable = flagged === -1 ? undefined : body.system?.[flagged];
  if (stable) {
    stable.cache_control = mark;
    left -= 1;
  }
  const lastTool = body.tools?.at(-1);
  if (lastTool) {
    lastTool.cache_control = mark;
    left -= 1;
  }
  const lastUser = body.messages.findLast((message) => message.role === "user")?.content.at(-1);
  if (left > 0 && lastUser && (lastUser.type === "text" || lastUser.type === "tool_result")) {
    lastUser.cache_control = mark;
  }
}

/** How the Messages API is reached. */
export interface AnthropicExchange {
  readonly apiKey: string;
  /** The API's origin, without `/v1/messages`. */
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly signal: AbortSignal;
  /** The wire the frames are for; version 2 carries signatures. */
  readonly wire: 1 | 2;
  /** Sent as `anthropic-beta`, when the request uses one. */
  readonly beta?: string;
}

/** Whether a request's messages carry any thinking. */
function carriesThinking(body: MessagesApiRequest): boolean {
  return body.messages.some((message) =>
    message.content.some((part) => part.type === "thinking" || part.type === "redacted_thinking"),
  );
}

/**
 * One exchange with the Messages API: the request, and its stream as the route's frames.
 *
 * A request that replays thinking and is refused as bound to a different conversation is sent once
 * more as `fallback` builds it, with no thinking, which is the recovery the API documents. Nothing
 * else is retried.
 *
 * @param {MessagesApiRequest} body - The request to send
 * @param {AnthropicExchange} via - How the API is reached
 * @param {() => MessagesApiRequest} fallback - The same request with every thinking block removed
 * @yields {WireEvent} The route's frames, in wire order
 */
export async function* anthropicExchange(
  body: MessagesApiRequest,
  via: AnthropicExchange,
  fallback: () => MessagesApiRequest,
): AsyncGenerator<WireEvent> {
  const send = (request: MessagesApiRequest): Promise<Response> =>
    via.fetch(`${via.baseUrl}/v1/messages`, {
      body: JSON.stringify(request),
      headers: via.beta
        ? { ...anthropicHeaders(via.apiKey), "anthropic-beta": via.beta }
        : { ...anthropicHeaders(via.apiKey) },
      method: "POST",
      signal: via.signal,
    });
  let response: Response;
  try {
    response = await send(body);
    if (response.status === 400 && carriesThinking(body)) {
      const refusal = await response.clone().text();
      if (/bound to a different conversation/i.test(refusal)) {
        response = await send(fallback());
      }
    }
  } catch (error) {
    yield fetchFailureFrame(error);
    return;
  }
  yield* normalizeAnthropicStream(response, { wire: via.wire });
}

/** How the Anthropic provider is reached and shaped. */
export interface AnthropicProviderOptions {
  readonly apiKey: string;
  /** The API's origin. Anthropic's own when absent. */
  readonly baseUrl?: string;
  /** The `max_tokens` of a request that names none. 32,000 when absent. */
  readonly defaultMaxTokens?: number;
  /** Passed through as the request's `thinking`, for example `{ type: "adaptive" }`. */
  readonly thinking?: JsonObject;
  /**
   * Sent only where the platform offers binding controls: the request then says what the API does
   * with a thinking block that does not bind, and nothing is retried.
   */
  readonly bindingControls?: { readonly prefixMismatch: "drop_block" | "error" };
  /** The fetch the API is called with. The global `fetch`, looked up per call, when absent. */
  readonly fetch?: typeof fetch;
}

/**
 * A provider adapter for the Anthropic Messages API, and any endpoint that speaks it.
 *
 * @param {AnthropicProviderOptions} options
 * @returns {Provider}
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): Provider {
  const baseUrl = options.baseUrl ?? ANTHROPIC_BASE_URL;
  const firstParty = isFirstPartyAnthropic(baseUrl);

  /**
   * @param {ProviderRequest} request
   * @param {AbortSignal} signal
   * @yields {WireEvent} `stream_start`, then the normalized frames
   */
  async function* stream(request: ProviderRequest, signal: AbortSignal): AsyncGenerator<WireEvent> {
    yield { family: "anthropic", model: request.model, type: "stream_start", wire: 2 };
    const projecting = (withoutThinking: boolean): MessagesProjectionOptions => {
      const projection: MessagesProjectionOptions = {
        defaultMaxTokens: options.defaultMaxTokens ?? ANTHROPIC_MAX_TOKENS,
        firstParty,
        midConversationSystem: anthropicCapabilities(request.model).midConversationSystem,
        withoutThinking,
      };
      return {
        ...projection,
        ...(options.thinking ? { thinking: options.thinking } : null),
        ...(options.bindingControls ? { bindingControls: options.bindingControls } : null),
      };
    };
    const via: AnthropicExchange = {
      apiKey: options.apiKey,
      baseUrl,
      fetch: options.fetch ?? fetch,
      signal,
      wire: 2,
    };
    yield* anthropicExchange(
      toAnthropicMessagesRequest(request, projecting(false)),
      options.bindingControls ? { ...via, beta: BINDING_CONTROLS_BETA } : via,
      () => toAnthropicMessagesRequest(request, projecting(true)),
    );
  }

  return { capabilities: anthropicCapabilities, family: "anthropic", stream };
}
