/**
 * Streaming-client.js — Provider-agnostic streaming LLM client abstraction
 *
 * Defines the StreamingClient interface, the StreamEvent union every implementation yields, and
 * concrete implementations for OpenAI and Anthropic. Designed upfront so switching providers is a
 * new implementation, not a refactor.
 *
 * The union and its eight members are exported because they are the contract a third-party Studio
 * backend implements for the `ai/chat` route, not an internal detail — see the docs page below.
 *
 * @module @jxsuite/ai/streaming-client
 * @license MIT
 * @docs extending/embedding/backend-protocol
 */

import type { AiProviderFamily, ProblemDetails } from "@jxsuite/protocol";
import { problemDetails } from "@jxsuite/protocol/problems";
import { AI_SESSION_HEADER, upstreamCacheHints } from "./cache-hints.ts";
import {
  fetchFailureFrame,
  normalizeOpenAIStream,
  streamFailureFrame,
} from "./gateway/normalize.ts";
import { problemTypeForStatus } from "./gateway/problem.ts";
import type { OpenAICompatQuirks } from "./gateway/types.ts";
import { toOpenAIMessages, toOpenAITools } from "./messages/openai.ts";
import type { ProviderFamily, SystemBlock, ToolSpec, WireMessage } from "./messages/types.ts";
import { chatCompletionsBody } from "./providers/body.ts";

/* Re-exported so `./streaming-client`, the subpath a backend already imports, carries the cache
   hints too: a Worker backend hashing the session header needs nothing else from this package. */
export {
  AI_SESSION_HEADER,
  affinityKey,
  isAiSessionId,
  upstreamCacheHints,
} from "./cache-hints.ts";
export type { UpstreamCacheHints } from "./cache-hints.ts";
export type { AiProviderFamily } from "@jxsuite/protocol";

/**
 * The request header naming the provider family a caller's key belongs to (specs/ai.md §2.6). Sent
 * only for a family other than the OpenAI-compatible default, and only to a backend whose models
 * route lists that family in `providers`: one that predates the header forwards every key to an
 * OpenAI-compatible endpoint.
 */
export const AI_PROVIDER_HEADER = "X-Api-Provider";

export type StreamEvent =
  | StreamDeltaEvent
  | StreamReasoningEvent
  | StreamToolCallStartEvent
  | StreamToolCallDeltaEvent
  | StreamToolCallEndEvent
  | StreamUsageEvent
  | StreamDoneEvent
  | StreamErrorEvent;

export interface StreamDeltaEvent {
  type: "delta";
  content: string;
  /** Which of the reply's blocks this text belongs to, when the provider numbers them. */
  block?: number;
}

/**
 * A chain-of-thought fragment from a thinking model — OpenAI-compatible providers stream it as
 * `reasoning_content` (DeepSeek, Volcengine) or `reasoning` (OpenRouter) beside `content`.
 *
 * It is a SEPARATE event rather than a `delta` because it is not part of the answer and must not be
 * rendered as one — but it is part of the turn, and DeepSeek's thinking mode requires every prior
 * turn's reasoning back on any request carrying `tools`. A client that drops these frames replays a
 * history the provider rejects with 400 `The reasoning_content in the thinking mode must be passed
 * back to the API`, so a backend implementing this route MUST forward them.
 */
export interface StreamReasoningEvent {
  type: "reasoning";
  content: string;
  /** Which of the reply's blocks this thinking belongs to, when the provider numbers them. */
  block?: number;
}

export interface StreamToolCallStartEvent {
  type: "tool_call_start";
  id: string;
  name: string;
  /** Which of the reply's blocks this call is, when the provider numbers them. */
  block?: number;
}

export interface StreamToolCallDeltaEvent {
  type: "tool_call_delta";
  id: string;
  args: string;
}

export interface StreamToolCallEndEvent {
  type: "tool_call_end";
  id: string;
  /** An opaque signature the provider attached to the call, replayed unchanged with it. */
  signature?: string;
}

/**
 * What the provider counted for the request that produced this stream, when it reported a count.
 *
 * Emitted at most once, immediately BEFORE `done`, because a reader stops at `done`. It is optional
 * and additive: a backend with no figure sends none, and a reader that predates it ignores it. It
 * exists because every budget the client keeps was an estimate of four characters per token, and
 * the provider's own count, which the client was asking for all along (`include_usage`), was
 * discarded before it arrived.
 */
export interface StreamUsageEvent {
  type: "usage";
  /** Tokens the provider read: system prompt, tool schemas and the whole history. */
  inputTokens: number;
  /** Tokens the provider generated, reasoning included. */
  outputTokens: number;
  /** The part of `inputTokens` served from a prompt cache, when the provider says. */
  cachedInputTokens?: number;
  /** The part of `outputTokens` spent on chain-of-thought, when the provider says. */
  reasoningTokens?: number;
}

export interface StreamDoneEvent {
  type: "done";
  stopReason: string;
  /**
   * Present, and true, when the provider's body ended having sent no terminal marker: the reply was
   * cut off rather than finished (specs/ai.md §2). `stopReason` is still `"stop"`, so a reader that
   * predates this member ends the round exactly as it did.
   */
  truncated?: true;
}

/**
 * A failure that arrived mid-stream.
 *
 * **This is the one place RFC 9457 could not simply replace what was here**, and the reason is
 * structural: a problem document is a _response body_, and by the time this frame is written the
 * response has already begun with a 200. Nothing can change the status any more. So the adoption is
 * that the frame CARRIES a problem rather than being replaced by one — `problem` is the machine
 * half (a `type` a client can key on), `message` stays the human half every existing reader already
 * shows, and `code` remains for the providers that send one.
 */
export interface StreamErrorEvent {
  type: "error";
  message: string;
  code?: string;
  /** RFC 9457 problem document describing the failure, when the producer knows its type. */
  problem?: ProblemDetails;
}

// ─── Wire version 2 (specs/ai.md §2.7) ──────────────────────────────────────

/**
 * The first frame of a version 2 stream: which wire the backend is answering on, and what it is
 * forwarding to. Sent only to a version 2 request.
 */
export interface StreamStartEvent {
  type: "stream_start";
  wire: 2;
  family: ProviderFamily;
  model: string;
  /** The provider's id for the request, when it gave one. */
  requestId?: string;
  /** How many thinking blocks the provider dropped from the request rather than read. */
  droppedThinking?: number;
}

/** The signature a provider attached to a thinking block, owed back with the block unchanged. */
export interface StreamReasoningSignatureEvent {
  type: "reasoning_signature";
  block: number;
  signature: string;
}

/** A thinking block the provider sent only as an opaque payload. */
export interface StreamReasoningRedactedEvent {
  type: "reasoning_redacted";
  block: number;
  data: string;
}

/** Every frame of a version 2 stream: the eight version 1 frames, and the three it adds. */
export type WireEvent =
  | StreamEvent
  | StreamStartEvent
  | StreamReasoningSignatureEvent
  | StreamReasoningRedactedEvent;

/** The version 1 chat body. Frozen: a backend accepts it forever. */
export interface ChatRequestV1 {
  messages: object[];
  tools: object[];
  systemPrompt: string;
  model?: string;
}

/**
 * The version 2 chat body: the conversation in no provider's words (specs/ai.md §2.3), so a backend
 * can project it onto whichever family it forwards to.
 */
export interface ChatRequestV2 {
  wire: 2;
  model?: string;
  /** The system prompt's parts, joined in order with nothing between. */
  system: SystemBlock[];
  /** Every tool call beside its reply already: a backend never repairs a conversation. */
  messages: WireMessage[];
  /** The tools on offer, in the order the client lists them. */
  tools: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
  toolChoice?: "auto" | "none" | "required" | { name: string };
  reasoning?: { effort?: "low" | "medium" | "high" };
  /** For a backend's own audit and rate limiting. Never forwarded to a provider. */
  metadata?: { sessionId?: string; turnId?: string; round?: number };
}

/**
 * The request and response header naming the chat wire version in use (specs/ai.md §2.7). A client
 * sends it beside a version 2 body, and a backend answers with the version it served.
 */
export const WIRE_HEADER = "X-Jx-AI-Wire";

/**
 * The wire a client speaks to a backend: version 2 only when the backend's models probe advertised
 * it, and version 1 otherwise, which every backend accepts.
 *
 * @param {{ wire?: readonly number[] } | null} probe - The models route's answer, or null when
 *   there is none
 * @returns {1 | 2}
 */
export function negotiateWire(probe: { readonly wire?: readonly number[] } | null): 1 | 2 {
  return probe?.wire?.includes(2) === true ? 2 : 1;
}

/**
 * A streaming LLM client. Implementations handle provider-specific SSE formats and emit normalized
 * StreamEvents.
 */
export interface StreamingClient {
  streamChat: (
    messages: object[],
    tools: object[],
    systemPrompt: string,
    signal: AbortSignal,
  ) => AsyncGenerator<StreamEvent>;
  /**
   * One round on wire version 2: the neutral conversation in, version 2 frames out. Present only on
   * a client built for that wire, and a caller that finds it prefers it.
   */
  streamTurn?: (
    request: Omit<ChatRequestV2, "wire" | "model">,
    signal: AbortSignal,
  ) => AsyncGenerator<WireEvent>;
}

/** A tool-call fragment inside an OpenAI streaming `delta`. */
export interface OpenAIToolCallDelta {
  /** The call's slot. Optional on the wire: some servers send none, and its place is its position. */
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * A single OpenAI chat-completions streaming chunk (the JSON after `data: `). Exported as a type
 * only, for the gateway's normalizer, which reads the same chunks.
 */
export interface OpenAIStreamChunk {
  choices?: {
    index?: number;
    delta?: {
      content?: string;
      /** Thinking models' chain-of-thought: DeepSeek/Volcengine spell it this way… */
      reasoning_content?: string;
      /** …and OpenRouter this way. Both carry the same thing. */
      reasoning?: string;
      tool_calls?: OpenAIToolCallDelta[];
    };
    finish_reason?: string | null;
  }[];
  /** The count `stream_options.include_usage` asks for — normally a final chunk with no choices. */
  usage?: OpenAIUsage | null;
}

/** OpenAI's usage object, as chat-completions streams it. */
export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
}

export type { OpenAICompatQuirks } from "./gateway/types.ts";

/**
 * Normalize OpenAI's usage object into a {@link StreamUsageEvent}, or null when it carries no count.
 * The two detail figures are included only when the provider sent them: absent means "not said",
 * which is not the same as zero.
 */
export function usageEventFromOpenAI(usage?: OpenAIUsage | null): StreamUsageEvent | null {
  if (!usage || !isCount(usage.prompt_tokens)) {
    return null;
  }
  const event: StreamUsageEvent = {
    type: "usage",
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens ?? 0,
  };
  const cached = usage.prompt_tokens_details?.cached_tokens;
  if (isCount(cached)) {
    event.cachedInputTokens = cached;
  }
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  if (isCount(reasoning)) {
    event.reasoningTokens = reasoning;
  }
  return event;
}

/**
 * True when a figure the provider sent is a number. A chunk is upstream JSON, so a figure its
 * interface calls a number is checked before it is reported.
 *
 * @param {unknown} value - A usage figure, as the provider sent it
 * @returns {boolean}
 */
function isCount(value: unknown): value is number {
  return typeof value === "number";
}

/**
 * True when a member of a parsed body or chunk is a string, empty or not.
 *
 * @param {unknown} value - A member, as sent
 * @returns {boolean}
 */
function isText(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * True when a member of a parsed error body is a non-empty string, the only `code` worth reading.
 *
 * @param {unknown} value - A `code` member, as sent
 * @returns {boolean}
 */
function isSentence(value: unknown): value is string {
  return isText(value) && value !== "";
}

/**
 * True when a parsed value is a JSON object (or array) whose members may be probed with `in`; false
 * for `null` and every primitive.
 *
 * @param {unknown} value - A parsed body, or one of its members
 * @returns {boolean}
 */
function isMemberBag(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * True when a parsed `errors` member is an array.
 *
 * @param {unknown} value - The parsed body's `errors` member
 * @returns {boolean}
 */
function isEntryList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Extract a human-readable message from an error body, falling back to the raw body (or `fallback`
 * when the body is empty).
 *
 * The body is the proxy's flat `{ error: "..." }`, OpenAI's `{ error: { message } }`, or the
 * array-shaped envelope Cloudflare's own REST API uses for a BYOK base URL pointed directly at it:
 * `{ success: false, errors: [{ code, message }] }`, with no top-level `error` key at all. That
 * last one is reachable only when `baseUrl` bypasses the Studio proxy, which normalizes the shape
 * before it ever reaches a client.
 */
function extractErrorMessage(rawBody: string, fallback: string): string {
  if (!rawBody) {
    return fallback;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    /* Not JSON — use the raw body. */
    return rawBody;
  }
  // JSON `null`, a primitive or an array carries neither member, so it is the raw body.
  if (isMemberBag(parsed)) {
    if ("error" in parsed) {
      const { error } = parsed;
      if (isText(error)) {
        return error;
      }
      if (isMemberBag(error) && "message" in error && Boolean(error.message)) {
        return String(error.message);
      }
    }
    if ("errors" in parsed && isEntryList(parsed.errors)) {
      const [first] = parsed.errors;
      if (isMemberBag(first) && "message" in first && Boolean(first.message)) {
        return String(first.message);
      }
    }
  }
  return rawBody;
}

/**
 * The proxy's machine code in an error body (`cf_reconnect_required` and friends), or "" when the
 * body carries none.
 *
 * A backend that knows WHY it refused says so in `code`, beside its human `error`, and a client can
 * only act on the reason it is given: the whole point of the code is that the Reconnect affordance
 * appears without the user reading a sentence and deciding what it meant.
 */
function extractMachineCode(rawBody: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    /* Not JSON — there is no code. */
    return "";
  }
  return isMemberBag(parsed) && "code" in parsed && isSentence(parsed.code) ? parsed.code : "";
}

/**
 * The problem an error body describes: the body itself when it is already a problem document (it
 * names a `type`), otherwise one built from the status and the sentence the body carried.
 *
 * @param {string} rawBody - The error response's body, as read
 * @param {number} status - The response's status
 * @param {string} message - The sentence extracted from the body
 * @returns {ProblemDetails}
 */
function problemOf(rawBody: string, status: number, message: string): ProblemDetails {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (isMemberBag(parsed) && "type" in parsed && isSentence(parsed.type)) {
      /* SAFETY: a JSON object naming a string `type` is a problem document by RFC 9457 §3.1; every
         other member is optional there, and a reader checks the ones it uses. */
      return parsed as ProblemDetails;
    }
  } catch {
    /* Not JSON: the status and the sentence are all there is. */
  }
  return problemDetails(problemTypeForStatus(status), message);
}

// ─── Type definitions ────────────────────────────────────────────────────────

/**
 * All possible stream event types.
 *
 * @readonly
 * @enum {string}
 */
export const STREAM_EVENT_TYPES = {
  DELTA: "delta",
  REASONING: "reasoning",
  TOOL_CALL_START: "tool_call_start",
  TOOL_CALL_DELTA: "tool_call_delta",
  TOOL_CALL_END: "tool_call_end",
  USAGE: "usage",
  DONE: "done",
  ERROR: "error",
} as const;

/** Every frame type of a version 2 stream: the version 1 types and the three it adds. */
export const WIRE_EVENT_TYPES = {
  ...STREAM_EVENT_TYPES,
  STREAM_START: "stream_start",
  REASONING_SIGNATURE: "reasoning_signature",
  REASONING_REDACTED: "reasoning_redacted",
} as const;

// ─── StreamingClient interface (documented typedef) ─────────────────────────

/**
 * A streaming LLM client. Implementations handle provider-specific SSE formats and emit normalized
 * StreamEvents.
 *
 * @interface StreamingClient
 */

/**
 * @function StreamingClient#streamChat
 * @param {object[]} messages - Conversation messages in OpenAI format
 * @param {object[]} tools - Tool definitions in OpenAI function-calling format
 * @param {string} systemPrompt - System prompt text
 * @param {AbortSignal} signal - AbortSignal for cancellation
 * @returns {AsyncGenerator<StreamEvent>} Async generator of stream events
 */

// ─── OpenAI implementation ───────────────────────────────────────────────────

/**
 * Creates an OpenAI-compatible streaming client that fetches from a given base URL with the
 * provided API key and normalizes the response with the gateway's own normalizer
 * (`normalizeOpenAIStream`), so its events are the frames a backend's chat route would have sent
 * for the same body: an error carries the provider's sentence, its status as `code` and a
 * `problem`, and a body that ends with no terminal marker finishes `truncated`.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl - OpenAI-compatible API base URL (e.g. "https://api.openai.com/v1")
 * @param {string} opts.apiKey - API key
 * @param {string} [opts.model] - Default model if not specified per-request
 * @param {number} [opts.temperature] - Sampling temperature, forwarded only when defined. Omit for
 *   reasoning models (GPT-5.x, o-series) that reject a custom temperature; set 0 for
 *   near-deterministic eval runs.
 * @param {string} [opts.sessionAffinity] - A stable key for the conversation, forwarded as the
 *   prompt-cache hint the provider understands (`prompt_cache_key` to OpenAI, `x-session-affinity`
 *   to Workers AI) and to no other host. See `upstreamCacheHints`.
 * @returns {StreamingClient}
 */
export interface OpenAIStreamingClientOptions {
  baseUrl: string;
  apiKey: string;
  model?: string;
  temperature?: number | undefined;
  sessionAffinity?: string | undefined;
  /** How this provider departs from the chat-completions wire, when the caller knows it does. */
  quirks?: OpenAICompatQuirks | undefined;
}

export function createOpenAIStreamingClient({
  baseUrl,
  apiKey,
  model = "gpt-4o",
  temperature,
  sessionAffinity,
  quirks,
}: OpenAIStreamingClientOptions): StreamingClient {
  // Fixed for the client's life, so it is classified once rather than per request.
  const hints = upstreamCacheHints(baseUrl, sessionAffinity);

  /**
   * @param {object[]} messages
   * @param {object[]} tools
   * @param {string} systemPrompt
   * @param {AbortSignal} signal
   * @yields {StreamEvent} Normalized stream events.
   * @returns {AsyncGenerator<StreamEvent>}
   */
  async function* streamChat(
    messages: object[],
    tools: object[],
    systemPrompt: string,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const url = `${baseUrl}/chat/completions`;
    /* Built by the one module every OpenAI-compatible caller in this package shares, so this client
       and the provider adapter cannot send different bodies (`providers/body.ts`). A custom
       temperature is forwarded only when given: reasoning models (GPT-5.x, o-series) reject one. */
    const body = chatCompletionsBody({
      hints: hints.body,
      messages,
      model,
      systemPrompt,
      temperature,
      tools,
    });

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...hints.headers,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      yield fetchFailureFrame(error);
      return;
    }

    /* The gateway's normalizer, so a provider reached directly and one reached through a backend
       yield the same frames for the same body (specs/ai.md §2.4). */
    yield* normalizeOpenAIStream(response, quirks ? { quirks } : {});
  }

  return { streamChat };
}

// ─── Anthropic implementation (stub for v1) ──────────────────────────────────

/**
 * The credentials a provider endpoint is opened with: its base URL and the API key it takes, two
 * fields that belong together. Studio keys its model listing on the same pair.
 */
export interface AiCredentials {
  baseUrl: string;
  apiKey: string;
}

/** The Anthropic client's options: the provider credentials and nothing more, for now. */
export type { AiCredentials as AnthropicStreamingClientOptions };

/**
 * Creates an Anthropic-compatible streaming client. Stub for v1 — throws on use. Full
 * implementation in v2 handles Anthropic's content_block delta model.
 *
 * @param {AiCredentials} _opts
 * @returns {StreamingClient}
 */
export function createAnthropicStreamingClient(_opts: AiCredentials): StreamingClient {
  /**
   * @yields {StreamEvent} Normalized stream events.
   * @returns {AsyncGenerator<StreamEvent>}
   */
  async function* streamChat(): AsyncGenerator<StreamEvent> {
    yield {
      type: "error",
      message: "Anthropic provider is not yet implemented (planned for v2). Use OpenAI.",
      code: "NOT_IMPLEMENTED",
    };
  }

  return { streamChat };
}

// ─── Proxy implementation ────────────────────────────────────────────────────

/**
 * Creates a streaming client that POSTs to a same-origin (or platform-resolved) proxy endpoint
 * which already speaks the normalized StreamEvent SSE format (e.g. `/__studio/ai/chat`, see
 * `@jxsuite/server/ai-api`). No API key handling here — the proxy owns provider credentials.
 *
 * @param {object} opts
 * @param {string | (() => string | Promise<string>)} opts.chatUrl - URL to POST `{ messages, tools,
 *   systemPrompt, model }` to, or a function that answers it. A function is called once, inside the
 *   first stream, so a caller can hand over its turn's signal before it waits on anything: a Stop
 *   during a lookup over IPC then takes effect once it answers, and the stream ends cancelled with
 *   nothing sent. The outcome is kept for the client's later streams. A rejection propagates out of
 *   the stream, unless the signal was aborted by then, which ends it cancelled.
 * @param {string} [opts.model] - Default model if not specified per-request
 * @param {string} [opts.apiKey] - Optional client-supplied key, sent as the `X-Api-Key` header
 * @param {string} [opts.baseUrl] - Optional provider base URL, sent as `X-Api-Base-URL`
 * @param {AiProviderFamily} [opts.provider] - The family the key belongs to, sent as
 *   `X-Api-Provider` when it is not the OpenAI-compatible default (see {@link AI_PROVIDER_HEADER})
 * @param {1 | 2} [opts.wire] - The wire version the backend's probe advertised (`negotiateWire`).
 *   With 2 the client also offers `streamTurn`, which sends the neutral conversation and falls back
 *   to version 1, once and for the client's life, if the backend refuses it.
 * @param {string} [opts.sessionId] - The conversation's id, sent as the `X-Jx-Ai-Session` header so
 *   the backend can derive a prompt-cache affinity key from it. The raw id goes to the backend
 *   only; a provider sees a hash of it, scoped to that backend (`affinityKey`).
 * @returns {StreamingClient}
 */
export interface ProxyStreamingClientOptions {
  chatUrl: string | (() => string | Promise<string>);
  model?: string;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  provider?: AiProviderFamily | undefined;
  sessionId?: string | undefined;
  /**
   * The wire version to speak: `negotiateWire` of the backend's models probe. Version 2 adds
   * `streamTurn` to the client; version 1, the default, is the client every backend accepts.
   */
  wire?: 1 | 2 | undefined;
}

/**
 * The headers a proxy request carries: always the content type, plus `X-Api-Key`, `X-Api-Base-URL`,
 * `X-Api-Provider` and the session header `AI_SESSION_HEADER` names, each only when the client was
 * given its value. The optional names go through the index signature, as a `fetch` init's record
 * takes them.
 */
interface ProxyRequestHeaders extends Record<string, string> {
  "Content-Type": string;
}

/**
 * True when a proxy's `chatUrl` is a lookup to call rather than the URL itself.
 *
 * @param {ProxyStreamingClientOptions["chatUrl"]} chatUrl
 * @returns {boolean}
 */
function isUrlLookup(
  chatUrl: ProxyStreamingClientOptions["chatUrl"],
): chatUrl is () => string | Promise<string> {
  return typeof chatUrl === "function";
}

export function createProxyStreamingClient({
  chatUrl,
  model = "gpt-4o",
  apiKey,
  baseUrl,
  provider,
  sessionId,
  wire = 1,
}: ProxyStreamingClientOptions): StreamingClient {
  /** The URL, once the first stream has asked for it. */
  let resolvedUrl: Promise<string> | null = null;
  /* Set once a backend has refused version 2: every later round of this client speaks version 1
     without asking again (specs/ai.md §2.7). */
  let downgraded = false;

  /**
   * The headers every request of this client carries.
   *
   * @returns {ProxyRequestHeaders}
   */
  function requestHeaders(): ProxyRequestHeaders {
    const headers: ProxyRequestHeaders = { "Content-Type": "application/json" };
    // Client-supplied key (e.g. from Studio settings) — the proxy also falls back to OPENAI_API_KEY.
    if (apiKey) {
      headers["X-Api-Key"] = apiKey;
    }
    // Optional endpoint override (local LLM, OpenRouter, Azure, an Anthropic-compatible proxy, …).
    if (baseUrl) {
      headers["X-Api-Base-URL"] = baseUrl;
    }
    /* The default family says nothing, so a request to an OpenAI-compatible provider is the one a
       backend that predates the header has always read. */
    if (provider && provider !== "openai-compat") {
      headers[AI_PROVIDER_HEADER] = provider;
    }
    /* The conversation, so consecutive rounds can be routed to a warm prompt cache. Same-origin on
       every platform, so the extra header costs no preflight; a backend that ignores it loses only
       the cache hit. */
    if (sessionId) {
      headers[AI_SESSION_HEADER] = sessionId;
    }
    return headers;
  }

  /**
   * One request to the chat route and the frames it answers with, relayed as sent.
   *
   * @param {string} payload - The serialized chat body
   * @param {ProxyRequestHeaders} headers - The request's headers
   * @param {AbortSignal} signal - The turn's signal
   * @yields {WireEvent} The route's frames, in wire order
   */
  async function* exchange(
    payload: string,
    headers: ProxyRequestHeaders,
    signal: AbortSignal,
  ): AsyncGenerator<WireEvent> {
    resolvedUrl ??= Promise.resolve(isUrlLookup(chatUrl) ? chatUrl() : chatUrl);
    let url: string;
    try {
      url = await resolvedUrl;
    } catch (error) {
      // A lookup that failed after the turn was stopped is part of the stop, not an error.
      if (signal.aborted) {
        yield { type: "done", stopReason: "cancelled" };
        return;
      }
      throw error;
    }
    // Stopped while the URL was being resolved: nothing has been sent, and nothing will be.
    if (signal.aborted) {
      yield { type: "done", stopReason: "cancelled" };
      return;
    }

    let response;
    try {
      response = await fetch(url, { method: "POST", headers, body: payload, signal });
    } catch (error) {
      yield fetchFailureFrame(error);
      return;
    }

    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {
        /* Ignore */
      }
      // Extract a clean message from the JSON error body — see extractErrorMessage.
      const cleanMessage = extractErrorMessage(errorBody, response.statusText);
      /* The body's machine code beats the status. `code` was `String(response.status)`
         unconditionally, so a proxy answering 401 `{ code: "cf_reconnect_required" }` reached the
         client as `"401"` — indistinguishable from a bad BYOK key, and the one reading that would
         have put a Reconnect button on screen was thrown away at the only place it arrived. */
      const machineCode = extractMachineCode(errorBody);
      yield {
        type: "error",
        message: cleanMessage,
        code: machineCode || String(response.status),
        problem: problemOf(errorBody, response.status, cleanMessage),
      };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield {
        type: "error",
        message: "No response body",
        problem: problemDetails("upstreamFailure", "No response body"),
      };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) {
            continue;
          }

          const dataStr = trimmed.slice(6);
          let event: WireEvent;
          try {
            /* SAFETY: the proxy is the chat route, whose every `data:` line is one frame
               (`encodeSse` frames exactly that). The event is relayed as sent and only `type` is
               read; a line of JSON `null` is relayed, then throws at that read into the catch
               below. */
            event = JSON.parse(dataStr) as WireEvent;
          } catch {
            continue; // Skip unparseable chunks
          }

          yield event;

          if (event.type === "done" || event.type === "error") {
            return;
          }
        }
      }
    } catch (error) {
      void reader.cancel();
      yield streamFailureFrame(error);
    }
  }

  /**
   * One round on wire version 1.
   *
   * @param {object[]} messages
   * @param {object[]} tools
   * @param {string} systemPrompt
   * @param {AbortSignal} signal
   * @yields {StreamEvent} Normalized stream events.
   * @returns {AsyncGenerator<StreamEvent>}
   */
  async function* streamChat(
    messages: object[],
    tools: object[],
    systemPrompt: string,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const payload = JSON.stringify({ messages, tools, systemPrompt, model });
    for await (const event of exchange(payload, requestHeaders(), signal)) {
      // A version 1 request is answered with version 1 frames only; anything else is not relayed.
      if (isV1Event(event)) {
        yield event;
      }
    }
  }

  if (wire !== 2) {
    return { streamChat };
  }

  /**
   * One round on wire version 2, falling back to version 1 once, for good, when the backend answers
   * that it does not accept version 2: the probe said it did, so this is a backend that changed
   * underneath the client (a rollback, a second instance), and the turn must not fail for it.
   *
   * @param {Omit<ChatRequestV2, "wire" | "model">} request
   * @param {AbortSignal} signal
   * @yields {WireEvent} The route's frames, in wire order
   * @returns {AsyncGenerator<WireEvent>}
   */
  async function* streamTurn(
    request: Omit<ChatRequestV2, "wire" | "model">,
    signal: AbortSignal,
  ): AsyncGenerator<WireEvent> {
    if (!downgraded) {
      const body: ChatRequestV2 = { wire: 2, model, ...request };
      const headers = requestHeaders();
      headers[WIRE_HEADER] = "2";
      let refused = false;
      for await (const event of exchange(JSON.stringify(body), headers, signal)) {
        if (event.type === "error" && event.problem?.type === WIRE_UNSUPPORTED_TYPE) {
          refused = true;
          break;
        }
        yield event;
      }
      if (!refused) {
        return;
      }
      downgraded = true;
    }
    yield* streamChat(
      toOpenAIMessages(request.messages),
      toOpenAITools(request.tools),
      request.system.map((block) => block.text).join(""),
      signal,
    );
  }

  return { streamChat, streamTurn };
}

/** The problem type a backend answers a wire version it does not accept with. */
const WIRE_UNSUPPORTED_TYPE = problemDetails("wireUnsupported").type;

/** The frame types a version 1 stream carries. */
const V1_EVENT_TYPES: ReadonlySet<string> = new Set(Object.values(STREAM_EVENT_TYPES));

/**
 * True when a frame is one of the eight a version 1 stream carries.
 *
 * @param {WireEvent} event - A frame, as the backend sent it
 * @returns {boolean}
 */
function isV1Event(event: WireEvent): event is StreamEvent {
  return V1_EVENT_TYPES.has(event.type);
}
