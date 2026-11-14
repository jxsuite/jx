/**
 * The Anthropic Messages API behind the chat route: a version 1 body projected onto `POST
 * /v1/messages`, and its event stream normalized into the route's frames.
 *
 * A client of the chat route speaks the OpenAI-compatible version 1 wire whichever provider answers
 * it (specs/ai.md §2.6). When a host resolves an upstream of the `anthropic` family, the gateway
 * does the translation here, so a Studio connected to Claude sends exactly the body it sends to any
 * other provider, and reads exactly the frames it reads from any other.
 *
 * **Reasoning is not replayed on this path.** A Claude thinking block carries a signature bound to
 * the system prompt, the tools and every message before it, and the version 1 wire carries the
 * reasoning's text without the signature. Studio also rebuilds its system prompt every turn, so a
 * replayed block would fail that binding even if the signature travelled. The API accepts a history
 * with every thinking block removed (it is the documented recovery from a binding mismatch), so
 * this projection sends none: each round is answered without the reasoning of the rounds before it,
 * and never with a 400. Replaying signed blocks needs the version 2 wire.
 *
 * @module @jxsuite/ai/gateway
 * @docs extending/embedding/backend-protocol
 */

import { problemDetails } from "@jxsuite/protocol/problems";
import type { AiModelInfo } from "@jxsuite/protocol/types";
import type { JsonObject } from "../core-types.ts";
import type { StreamEvent, StreamUsageEvent, WireEvent } from "../streaming-client.ts";
import type { JSONSchema } from "../tools.ts";
import { noBodyFrame, streamFailureFrame, upstreamErrorFrame } from "./normalize.ts";
import { extractUpstreamErrorMessage } from "./upstream-error.ts";

/**
 * The Anthropic API's own origin, which a host falls back to when it configures none.
 *
 * Written without `/v1`, as Anthropic's tooling writes `ANTHROPIC_BASE_URL`: the gateway appends
 * `/v1/messages` and `/v1/models`, so an Anthropic-compatible endpoint is configured the way its
 * own documentation says.
 */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

/** The `anthropic-version` every request is sent with. */
export const ANTHROPIC_API_VERSION = "2026-10-21";

/**
 * The `max_tokens` every request carries. The Messages API requires one, and the version 1 body has
 * no member for it. 32,000 fits every current model's output cap, with room for adaptive thinking
 * ahead of the reply.
 */
export const ANTHROPIC_MAX_TOKENS = 32_000;

/** The most pages of `/v1/models` one listing reads. */
const MAX_MODEL_PAGES = 10;

/** A tool-use id the Messages API accepts. */
export const ANTHROPIC_TOOL_ID = /^[a-zA-Z0-9_-]+$/;

// ─── The version 1 body, as a client sends it ───────────────────────────────

/** One part of an OpenAI content array. Only text parts have a counterpart on this path. */
interface V1ContentPart {
  type?: string;
  text?: string;
}

/** A message's `content`: a string, a content array, or `null` on an assistant turn of calls. */
type V1Content = string | V1ContentPart[] | null | undefined;

/** A call on an assistant message. */
interface V1ToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * A version 1 message: the OpenAI-compatible message `toOpenAIMessages` builds (specs/ai.md §2.3).
 * Every member is optional on the wire and each is checked before use.
 */
interface V1Message {
  role?: string;
  content?: V1Content;
  tool_call_id?: string;
  tool_calls?: V1ToolCall[];
}

/** An OpenAI function tool, as `listForLLM()` declares one. */
interface V1Tool {
  function?: { name?: string; description?: string; parameters?: JSONSchema };
}

// ─── The Messages API request ───────────────────────────────────────────────

/** A text content block. */
interface TextBlock {
  type: "text";
  text: string;
}

/** A call the model made, replayed. */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: JsonObject;
}

/** A call's outcome, which rides on a user message. */
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** One message of a Messages API request. */
interface AnthropicMessage {
  role: "user" | "assistant";
  content: (TextBlock | ToolUseBlock | ToolResultBlock)[];
}

/** A tool, as the Messages API declares one. */
interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: JSONSchema;
  eager_input_streaming?: boolean;
}

/** The Messages API request the gateway sends. */
export interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  stream: true;
  messages: AnthropicMessage[];
  system?: TextBlock[];
  tools?: AnthropicTool[];
  cache_control?: { type: "ephemeral" };
}

/** The version 1 body members the projection reads. Each is checked before use. */
export interface AnthropicProjectionInput {
  readonly model: string;
  readonly systemPrompt: unknown;
  readonly messages: readonly unknown[];
  readonly tools: unknown;
}

/** How the projection is shaped for the upstream it goes to. */
export interface AnthropicProjectionOptions {
  /**
   * True when the upstream is Anthropic's own API. Only there does the request carry automatic
   * prompt caching and eager tool-input streaming: an Anthropic-compatible endpoint elsewhere may
   * refuse a member it does not know, as `upstreamCacheHints` reasons for the OpenAI wire.
   */
  readonly firstParty: boolean;
}

/** The headers every Anthropic request carries. */
export interface AnthropicHeaders {
  "Content-Type": "application/json";
  "anthropic-version": string;
  "x-api-key": string;
}

// ─── The Messages API stream ────────────────────────────────────────────────

/** A `usage` object. Every figure is cumulative for the message. */
interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** One event of the stream: the JSON after `data:`. Members are read only after a check. */
interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  message?: { usage?: AnthropicUsage };
  content_block?: { type?: string; id?: string; name?: string; text?: string; data?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    signature?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
  usage?: AnthropicUsage;
  error?: { type?: string; message?: string };
}

/** One page of `GET /v1/models`. */
interface AnthropicModelsPage {
  data?: { id?: string; display_name?: string; max_input_tokens?: number | null }[];
  has_more?: boolean;
  last_id?: string | null;
}

// ─── Guards ──────────────────────────────────────────────────────────────────

/**
 * True when a member is a string, empty or not. The body is the client's JSON and the stream the
 * API's, so a member an interface calls a string is checked before it is read.
 *
 * @param {T} value - A member, as sent
 * @returns {boolean}
 */
function isText<T>(value: T): value is T & string {
  return typeof value === "string";
}

/**
 * True when a member is a number.
 *
 * @param {T} value - A member, as sent
 * @returns {boolean}
 */
function isCount<T>(value: T): value is T & number {
  return typeof value === "number";
}

/**
 * True when a parsed value is a JSON object, and not `null`, an array or a primitive.
 *
 * @param {unknown} value - A parsed value
 * @returns {boolean}
 */
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when a member is an object whose members may be read. The body is the client's JSON, so an
 * entry its interface names may still be `null` or a primitive.
 *
 * @param {T} value - An entry, as sent
 * @returns {boolean}
 */
function isEntry<T>(value: T): value is T & object {
  return typeof value === "object" && value !== null;
}

// ─── Projection ──────────────────────────────────────────────────────────────

/**
 * A message's text: a string as sent, or the text parts of an OpenAI content array joined. Parts
 * that are not text have no Messages API counterpart on this path and are not sent.
 *
 * @param {V1Content} content - A version 1 message's `content`
 * @returns {string}
 */
function textOf(content: V1Content): string {
  if (isText(content)) {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  let text = "";
  for (const part of content) {
    if (isEntry(part) && part.type === "text" && isText(part.text)) {
      text += part.text;
    }
  }
  return text;
}

/**
 * A call's arguments as the `input` object the Messages API requires. Arguments that do not parse
 * to an object are sent as `{}`: the call already has an error result saying they did not parse,
 * and the text itself is not the API's to repair.
 *
 * @param {string | undefined} argumentsText - The call's arguments, as streamed
 * @returns {JsonObject}
 */
function inputOf(argumentsText: string | undefined): JsonObject {
  if (!isText(argumentsText)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Whether a tool reply reports a failure: a Jx result whose `success` is false. The neutral model
 * reads `isError` the same way (specs/ai.md §2.3).
 *
 * @param {string} content - The reply's content
 * @returns {boolean}
 */
function reportsFailure(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    return isObject(parsed) && parsed.success === false;
  } catch {
    return false;
  }
}

/**
 * Tool-use ids the Messages API accepts, kept stable across a request. An id that already matches
 * `^[a-zA-Z0-9_-]+$` is kept; any other (a provider's id from before the conversation moved to
 * Claude, say) has every other character replaced, and is suffixed when that collides, so a call
 * and its reply are always rewritten to the same id.
 *
 * @returns {(id: string) => string}
 */
function createToolIds(): (id: string) => string {
  const assigned = new Map<string, string>();
  const used = new Set<string>();
  return (id) => {
    const known = assigned.get(id);
    if (known !== undefined) {
      return known;
    }
    const base = ANTHROPIC_TOOL_ID.test(id) ? id : `toolu_${id.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}`;
    let next = base;
    for (let suffix = 2; used.has(next); suffix += 1) {
      next = `${base}_${String(suffix)}`;
    }
    assigned.set(id, next);
    used.add(next);
    return next;
  };
}

/**
 * The tools as the Messages API declares them: each OpenAI function's name, description and
 * parameters. A tool without a name is not sent; one without parameters takes an empty object
 * schema, which is the only `input_schema` the API accepts for it.
 *
 * @param {readonly V1Tool[]} tools - The body's `tools`, already known to be an array
 * @param {boolean} firstParty - Whether eager tool-input streaming may be asked for
 * @returns {AnthropicTool[]}
 */
function toolsOf(tools: readonly V1Tool[], firstParty: boolean): AnthropicTool[] {
  const out: AnthropicTool[] = [];
  for (const tool of tools) {
    const fn = isEntry(tool) && isEntry(tool.function) ? tool.function : null;
    if (!fn || !isText(fn.name) || !fn.name) {
      continue;
    }
    const entry: AnthropicTool = {
      input_schema: isObject(fn.parameters) ? fn.parameters : { properties: {}, type: "object" },
      name: fn.name,
    };
    if (isText(fn.description) && fn.description) {
      entry.description = fn.description;
    }
    /* The arguments stream as they are generated rather than arriving in one burst once a whole
       parameter is written, which is what a tool taking a page body needs. The invoker already
       answers arguments that do not parse with an error result, which is the check eager
       streaming hands to the client. */
    if (firstParty) {
      entry.eager_input_streaming = true;
    }
    out.push(entry);
  }
  return out;
}

/**
 * An assistant message's blocks: its text, then a `tool_use` block per call, in order. Its
 * reasoning is not sent (see the module comment).
 *
 * @param {V1Message} message - The assistant message
 * @param {(id: string) => string} toolId - The request's id map
 * @returns {(TextBlock | ToolUseBlock)[]}
 */
function assistantBlocks(
  message: V1Message,
  toolId: (id: string) => string,
): (TextBlock | ToolUseBlock)[] {
  const content: (TextBlock | ToolUseBlock)[] = [];
  const text = textOf(message.content);
  if (text) {
    content.push({ text, type: "text" });
  }
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of calls) {
    const fn = isEntry(call) && isEntry(call.function) ? call.function : null;
    if (!fn || !isText(call.id) || !isText(fn.name)) {
      continue;
    }
    content.push({
      id: toolId(call.id),
      input: inputOf(fn.arguments),
      name: fn.name,
      type: "tool_use",
    });
  }
  return content;
}

/**
 * Whether a message may open the history: a user message that is not a tool reply.
 *
 * @param {AnthropicMessage} message
 * @returns {boolean}
 */
function opensConversation(message: AnthropicMessage): boolean {
  return message.role === "user" && message.content.every((block) => block.type === "text");
}

/**
 * Project a version 1 chat body onto a Messages API request.
 *
 * - The system prompt is the top-level `system`, and so is any `system` message in the history,
 *   appended in order: a mid-conversation system message is not accepted by every model.
 * - An assistant message is its text, then a `tool_use` block per call, in order. Its reasoning is
 *   not sent (see the module comment). A message left with neither is not sent.
 * - A run of `tool` messages is one user message of `tool_result` blocks, `is_error` set when the
 *   result reports `success: false`.
 * - A user message is its text; an empty one is not sent, because the API refuses an empty text
 *   block.
 * - The history starts at a user message that is not a tool reply, so a leading assistant turn and
 *   the replies to its calls are dropped together, and a trailing assistant turn is never sent: the
 *   current models refuse an assistant prefill.
 * - Tool-use ids outside `^[a-zA-Z0-9_-]+$` are rewritten, the same way on the call and its reply.
 *
 * @param {AnthropicProjectionInput} body - The version 1 body
 * @param {AnthropicProjectionOptions} options - Where the request goes
 * @returns {AnthropicRequestBody}
 */
export function toAnthropicRequest(
  body: AnthropicProjectionInput,
  options: AnthropicProjectionOptions,
): AnthropicRequestBody {
  const toolId = createToolIds();
  const system: string[] = [];
  if (isText(body.systemPrompt) && body.systemPrompt) {
    system.push(body.systemPrompt);
  }
  const messages: AnthropicMessage[] = [];
  let results: ToolResultBlock[] | null = null;

  for (const entry of body.messages) {
    if (!isEntry(entry)) {
      continue;
    }
    /* SAFETY: the entry is the client's JSON object, and the interface only names the members a
       version 1 message may carry; each is checked (`isText`, `Array.isArray`, `isEntry`) before
       it shapes a block, so a member of the wrong type is read as absent. */
    const message = entry as V1Message;
    if (message.role === "tool") {
      if (!isText(message.tool_call_id)) {
        continue;
      }
      const content = textOf(message.content);
      const block: ToolResultBlock = {
        content,
        tool_use_id: toolId(message.tool_call_id),
        type: "tool_result",
      };
      if (reportsFailure(content)) {
        block.is_error = true;
      }
      if (results === null) {
        results = [];
        messages.push({ content: results, role: "user" });
      }
      results.push(block);
      continue;
    }
    results = null;
    const text = textOf(message.content);
    if (message.role === "system") {
      if (text) {
        system.push(text);
      }
    } else if (message.role === "assistant") {
      const content = assistantBlocks(message, toolId);
      if (content.length > 0) {
        messages.push({ content, role: "assistant" });
      }
    } else if (message.role === "user" && text) {
      messages.push({ content: [{ text, type: "text" }], role: "user" });
    }
  }

  const start = messages.findIndex((message) => opensConversation(message));
  messages.splice(0, start === -1 ? messages.length : start);
  if (messages.at(-1)?.role === "assistant") {
    messages.pop();
  }

  const request: AnthropicRequestBody = {
    max_tokens: ANTHROPIC_MAX_TOKENS,
    messages,
    model: body.model,
    stream: true,
  };
  if (system.length > 0) {
    request.system = [{ text: system.join("\n\n"), type: "text" }];
  }
  if (Array.isArray(body.tools)) {
    /* SAFETY: an array of the client's tool entries; `toolsOf` checks each entry and member it
       reads, so an entry that is not a function tool is skipped. */
    const tools = toolsOf(body.tools as readonly V1Tool[], options.firstParty);
    if (tools.length > 0) {
      request.tools = tools;
    }
  }
  /* One breakpoint on the last cacheable block: every round of a turn resends the same tools,
     system prompt and history, so the next round reads all of it from the cache. */
  if (options.firstParty) {
    request.cache_control = { type: "ephemeral" };
  }
  return request;
}

/**
 * Whether a base URL is Anthropic's own API, which alone receives the members an
 * Anthropic-compatible endpoint might refuse.
 *
 * @param {string} baseUrl - The upstream's base URL
 * @returns {boolean}
 */
export function isFirstPartyAnthropic(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.anthropic.com";
  } catch {
    return false;
  }
}

/**
 * The headers every Anthropic request carries.
 *
 * @param {string} apiKey - The caller's key, sent as `x-api-key`
 * @returns {AnthropicHeaders}
 */
export function anthropicHeaders(apiKey: string): AnthropicHeaders {
  return {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_API_VERSION,
    "x-api-key": apiKey,
  };
}

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * The stop reasons the stream reports, from a Messages API `stop_reason`: `end_turn` and
 * `stop_sequence` are `stop`, `max_tokens` and `model_context_window_exceeded` are `length`,
 * `tool_use` is `tool_calls`, and any other (`pause_turn`, `refusal`) is passed through as sent.
 *
 * @param {string} reason - The message's `stop_reason`
 * @returns {string}
 */
function stopReasonOf(reason: string): string {
  switch (reason) {
    case "end_turn":
    case "stop_sequence": {
      return "stop";
    }
    case "max_tokens":
    case "model_context_window_exceeded": {
      return "length";
    }
    case "tool_use": {
      return "tool_calls";
    }
    default: {
      return reason;
    }
  }
}

/** The counts a stream reports, gathered from `message_start` and every `message_delta`. */
interface UsageCounts {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
}

/**
 * Fold a usage object into the counts. Every figure the API reports is cumulative, so a later one
 * replaces an earlier one, and a figure that is absent leaves the earlier one standing.
 *
 * @param {UsageCounts} counts - The counts so far
 * @param {AnthropicUsage | undefined} usage - A `usage` member, as sent
 */
function foldUsage(counts: UsageCounts, usage: AnthropicUsage | undefined): void {
  if (!isEntry(usage)) {
    return;
  }
  if (isCount(usage.input_tokens)) {
    counts.input = usage.input_tokens;
  }
  if (isCount(usage.cache_read_input_tokens)) {
    counts.cacheRead = usage.cache_read_input_tokens;
  }
  if (isCount(usage.cache_creation_input_tokens)) {
    counts.cacheWrite = usage.cache_creation_input_tokens;
  }
  if (isCount(usage.output_tokens)) {
    counts.output = usage.output_tokens;
  }
}

/**
 * The `usage` frame for the counts, or null when the stream reported no input count. `inputTokens`
 * is everything the model read, cached or not, because that is the context's size.
 *
 * @param {UsageCounts} counts
 * @returns {StreamUsageEvent | null}
 */
function usageFrame(counts: UsageCounts): StreamUsageEvent | null {
  if (counts.input === undefined) {
    return null;
  }
  const frame: StreamUsageEvent = {
    inputTokens: counts.input + (counts.cacheRead ?? 0) + (counts.cacheWrite ?? 0),
    outputTokens: counts.output ?? 0,
    type: "usage",
  };
  if (counts.cacheRead !== undefined) {
    frame.cachedInputTokens = counts.cacheRead;
  }
  if (counts.cacheWrite !== undefined) {
    frame.cacheWriteInputTokens = counts.cacheWrite;
  }
  return frame;
}

/** The machine code an error frame carries when the conversation outgrew the model's window. */
export const CONTEXT_OVERFLOW_CODE = "context_overflow";

/**
 * Name a failure for what it is when the API's sentence says the prompt is too long: the
 * `context-overflow` problem and its code, which a client acts on by shortening the conversation.
 * The Messages API reports it as an `invalid_request_error` like any other, so its sentence is the
 * only witness, and this is the one place the gateway reads a provider's wording.
 *
 * @param {StreamEvent} frame - An error frame, as built from the API's answer
 * @returns {StreamEvent}
 */
function namingOverflow(frame: StreamEvent): StreamEvent {
  if (frame.type !== "error" || !/prompt is too long/i.test(frame.message)) {
    return frame;
  }
  return {
    ...frame,
    code: CONTEXT_OVERFLOW_CODE,
    problem: problemDetails("contextOverflow", frame.message),
  };
}

/**
 * The `error` frame for an `error` event in the stream: the API's sentence, its error type as
 * `code`, and an `upstreamFailure` problem, since the response began with a 200.
 *
 * @param {AnthropicStreamEvent["error"]} error - The event's `error` member
 * @returns {StreamEvent}
 */
function errorEventFrame(error: AnthropicStreamEvent["error"]): StreamEvent {
  const message =
    isEntry(error) && isText(error.message) && error.message ? error.message : "Upstream error";
  const frame: StreamEvent = {
    message,
    problem: problemDetails("upstreamFailure", message),
    type: "error",
  };
  if (isEntry(error) && isText(error.type) && error.type) {
    frame.code = error.type;
  }
  return namingOverflow(frame);
}

/** How a Messages API stream is read. */
export interface AnthropicNormalizeOptions {
  /**
   * The wire the frames are for. Version 2 adds what a signed conversation needs (specs/ai.md
   * §2.7): each frame's `block`, a `reasoning_signature` per signed thinking block and a
   * `reasoning_redacted` per redacted one. Version 1, the default, carries none of them.
   */
  readonly wire?: 1 | 2;
}

/**
 * Normalize a Messages API streaming response into the chat route's frames.
 *
 * - A non-2xx response is one `error` frame, read as the OpenAI-compatible normalizer reads one.
 * - `text_delta` is `delta`, and a non-empty `thinking_delta` is `reasoning`. On version 1,
 *   signatures and redacted thinking are not forwarded (that wire cannot replay them).
 * - A `tool_use` block is `tool_call_start`, a `tool_call_delta` per non-empty `input_json_delta`,
 *   and `tool_call_end` at its `content_block_stop`.
 * - An `error` event is an `error` frame carrying an `upstreamFailure` problem, with the API's error
 *   type as `code`, and it ends the stream.
 * - The last frames are the open calls' ends, the `usage` count when there is one, and `done` with
 *   the mapped stop reason, at `message_stop` or wherever the body ends. A body that ends having
 *   sent neither `message_stop` nor a stop reason was cut off, and its `done` carries `truncated`.
 * - A failure whose sentence says the prompt is too long is the `context-overflow` problem.
 * - On wire version 2, each `delta`, `reasoning` and `tool_call_start` names its content `block`, a
 *   signed thinking block ends with `reasoning_signature`, and a redacted one is
 *   `reasoning_redacted`.
 * - An aborted read is `done: cancelled`; a consumer that stops reading cancels the upstream body.
 *
 * @param {Response} response - The upstream's response to `POST /v1/messages`
 * @param {AnthropicNormalizeOptions} [options] - The wire the frames are for
 * @yields {WireEvent} The route's frames, in wire order
 */
export async function* normalizeAnthropicStream(
  response: Response,
  options: AnthropicNormalizeOptions = {},
): AsyncGenerator<WireEvent> {
  const v2 = options.wire === 2;
  if (!response.ok) {
    yield namingOverflow(await upstreamErrorFrame(response));
    return;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    yield noBodyFrame();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  /** The open tool-use blocks' ids, by content-block index. */
  const calls = new Map<number, string>();
  /** The signatures of the open thinking blocks, by content-block index (wire version 2). */
  const signatures = new Map<number, string>();
  const counts: UsageCounts = {};
  let stopReason: string | null = null;
  let stopped = false;

  /**
   * The stream's last frames: the open calls, then the count BEFORE `done`, because a reader stops
   * at `done`.
   *
   * @yields {StreamEvent} The closing frames, in order
   */
  function* finish(): Generator<StreamEvent> {
    for (const id of calls.values()) {
      yield { id, type: "tool_call_end" };
    }
    calls.clear();
    const usage = usageFrame(counts);
    if (usage) {
      yield usage;
    }
    // Cut off: neither `message_stop` nor a stop reason arrived (specs/ai.md §2).
    yield stopped || stopReason !== null
      ? { stopReason: stopReason ?? "stop", type: "done" }
      : { stopReason: "stop", truncated: true, type: "done" };
  }

  /**
   * The frames for one event of the stream. `message_stop` and `error` are the loop's to act on.
   *
   * @param {AnthropicStreamEvent} event - The parsed `data:` payload
   * @yields {WireEvent} Its frames
   */
  function* framesOf(event: AnthropicStreamEvent): Generator<WireEvent> {
    const index = isCount(event.index) ? event.index : -1;
    const block = isEntry(event.content_block) ? event.content_block : null;
    const delta = isEntry(event.delta) ? event.delta : null;
    if (event.type === "message_start") {
      foldUsage(counts, isEntry(event.message) ? event.message.usage : undefined);
    } else if (event.type === "content_block_start" && block) {
      if (block.type === "tool_use" && isText(block.id)) {
        calls.set(index, block.id);
        const name = isText(block.name) ? block.name : "";
        yield v2
          ? { block: index, id: block.id, name, type: "tool_call_start" }
          : { id: block.id, name, type: "tool_call_start" };
      } else if (block.type === "text" && isText(block.text) && block.text) {
        yield v2
          ? { block: index, content: block.text, type: "delta" }
          : { content: block.text, type: "delta" };
      } else if (v2 && block.type === "redacted_thinking" && isText(block.data)) {
        yield { block: index, data: block.data, type: "reasoning_redacted" };
      }
    } else if (event.type === "content_block_delta" && delta) {
      const id = calls.get(index);
      if (delta.type === "text_delta" && isText(delta.text) && delta.text) {
        yield v2
          ? { block: index, content: delta.text, type: "delta" }
          : { content: delta.text, type: "delta" };
      } else if (delta.type === "thinking_delta" && isText(delta.thinking) && delta.thinking) {
        yield v2
          ? { block: index, content: delta.thinking, type: "reasoning" }
          : { content: delta.thinking, type: "reasoning" };
      } else if (delta.type === "signature_delta" && isText(delta.signature)) {
        // The signature may arrive in parts; it is owed back whole, so it is sent once, at the end.
        signatures.set(index, (signatures.get(index) ?? "") + delta.signature);
      } else if (
        delta.type === "input_json_delta" &&
        id !== undefined &&
        isText(delta.partial_json) &&
        delta.partial_json
      ) {
        yield { args: delta.partial_json, id, type: "tool_call_delta" };
      }
    } else if (event.type === "content_block_stop") {
      const id = calls.get(index);
      if (id !== undefined) {
        calls.delete(index);
        yield { id, type: "tool_call_end" };
      }
      const signature = signatures.get(index);
      if (v2 && signature) {
        signatures.delete(index);
        yield { block: index, signature, type: "reasoning_signature" };
      }
    } else if (event.type === "message_delta") {
      if (delta && isText(delta.stop_reason)) {
        stopReason = stopReasonOf(delta.stop_reason);
      }
      foldUsage(counts, event.usage);
    }
    // `ping`, and any event a later API version adds, carry nothing for the route.
  }

  /* See `normalizeOpenAIStream`: `finally` cancels the upstream when the consumer stops reading. */
  let settled = false;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        let event: AnthropicStreamEvent | null;
        try {
          /* SAFETY: the interface is the API's event shape, and it is only read: every member
             passes `isEntry`, `isText` or `isCount` before it shapes a frame, and a payload that is
             not an object is skipped below. */
          event = JSON.parse(trimmed.slice(5)) as AnthropicStreamEvent | null;
        } catch {
          continue;
        }
        if (!isEntry(event)) {
          continue;
        }
        if (event.type === "message_stop") {
          stopped = true;
          yield* finish();
          settled = true;
          return;
        }
        if (event.type === "error") {
          yield errorEventFrame(event.error);
          settled = true;
          void reader.cancel();
          return;
        }
        yield* framesOf(event);
      }
    }
    // The body ended without `message_stop`.
    yield* finish();
    settled = true;
  } catch (error) {
    settled = true;
    void reader.cancel();
    yield streamFailureFrame(error);
  } finally {
    if (!settled) {
      void reader.cancel();
    }
  }
}

// ─── Model listing ───────────────────────────────────────────────────────────

/** What a listing of an Anthropic endpoint's models found. */
export type AnthropicModelListing =
  | { readonly ok: true; readonly models: AiModelInfo[] }
  | { readonly ok: false; readonly upstreamError: number | "network"; readonly message: string };

/**
 * A failure's message, for an `Error` or anything else a fetch rejected with.
 *
 * @param {unknown} cause - What was thrown
 * @returns {string}
 */
function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The models on one page, each as its `id`, its `display_name` as the name, and `max_input_tokens`
 * as its context window when the API reports a positive one.
 *
 * @param {AnthropicModelsPage} page - The parsed page
 * @returns {AiModelInfo[]}
 */
function modelsOn(page: AnthropicModelsPage): AiModelInfo[] {
  const models: AiModelInfo[] = [];
  for (const entry of Array.isArray(page.data) ? page.data : []) {
    if (!isEntry(entry) || !isText(entry.id) || !entry.id) {
      continue;
    }
    const name = isText(entry.display_name) && entry.display_name ? entry.display_name : entry.id;
    const model: AiModelInfo = { id: entry.id, name };
    if (isCount(entry.max_input_tokens) && entry.max_input_tokens > 0) {
      model.contextWindow = entry.max_input_tokens;
    }
    models.push(model);
  }
  return models;
}

/**
 * List an Anthropic endpoint's models through `GET /v1/models`, following its pages.
 *
 * A failed page is the listing's failure: the upstream's status and the sentence in its body, or
 * `"network"` and the reason the request never got a response.
 *
 * @param {{ baseUrl: string; apiKey: string }} upstream - Where to list, and with whose key
 * @param {typeof fetch} [upstreamFetch] - The fetch to call it with; the global one when absent
 * @returns {Promise<AnthropicModelListing>}
 */
export async function listAnthropicModels(
  upstream: { readonly baseUrl: string; readonly apiKey: string },
  upstreamFetch: typeof fetch = fetch,
): Promise<AnthropicModelListing> {
  const models: AiModelInfo[] = [];
  let after = "";
  for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
    const url = new URL(`${upstream.baseUrl}/v1/models`);
    url.searchParams.set("limit", "1000");
    if (after) {
      url.searchParams.set("after_id", after);
    }
    let response: Response;
    try {
      response = await upstreamFetch(url.href, {
        headers: { ...anthropicHeaders(upstream.apiKey) },
      });
    } catch (error) {
      return { message: reasonOf(error), ok: false, upstreamError: "network" };
    }
    if (!response.ok) {
      let body = "";
      try {
        body = await response.text();
      } catch {
        /* The status alone is the answer. */
      }
      const message = extractUpstreamErrorMessage(body, response.statusText);
      return { message, ok: false, upstreamError: response.status };
    }
    let parsed: AnthropicModelsPage | null;
    try {
      /* SAFETY: the interface is the API's page shape; `modelsOn` checks every entry and member
         it reads, and a body that is not an object ends the listing below. */
      parsed = (await response.json()) as AnthropicModelsPage | null;
    } catch (error) {
      return { message: reasonOf(error), ok: false, upstreamError: response.status };
    }
    if (!isEntry(parsed)) {
      break;
    }
    models.push(...modelsOn(parsed));
    if (parsed.has_more !== true || !isText(parsed.last_id) || !parsed.last_id) {
      break;
    }
    after = parsed.last_id;
  }
  return { models, ok: true };
}
