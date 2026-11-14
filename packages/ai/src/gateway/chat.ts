/**
 * The chat route: a request from a Jx client in, an SSE stream of normalized frames out.
 *
 * @module @jxsuite/ai/gateway
 */

import { upstreamCacheHints } from "../cache-hints.ts";
import { problemDetails } from "@jxsuite/protocol/problems";
import type { JsonValue } from "../core-types.ts";
import { WIRE_HEADER } from "../streaming-client.ts";
import type { ChatRequestV2, StreamStartEvent, WireEvent } from "../streaming-client.ts";
import {
  anthropicCapabilities,
  anthropicExchange,
  toAnthropicMessagesRequest,
} from "../providers/anthropic.ts";
import type { ProviderRequest } from "../providers/types.ts";
import {
  ANTHROPIC_MAX_TOKENS,
  anthropicHeaders,
  isFirstPartyAnthropic,
  normalizeAnthropicStream,
  toAnthropicRequest,
} from "./anthropic.ts";
import { WIRE_VERSIONS } from "./models.ts";
import { fetchFailureFrame, normalizeOpenAIStream } from "./normalize.ts";
import type { NormalizeOptions } from "./normalize.ts";
import { problemResponse, refusal } from "./problem.ts";
import { encodeSse, SSE_HEADERS } from "./sse.ts";
import type { ChatGatewayOptions, GatewayRefusal, Upstream } from "./types.ts";
import { checkChatRequestV2, projectV2Request } from "./wire.ts";
import type { ProjectedRequest } from "./wire.ts";

/**
 * The upstream a host forwards to when it configures none: OpenAI's own chat-completions API.
 *
 * The gateway never applies it itself (which upstream a request may reach is host policy, supplied
 * through `resolveUpstream`). It lives here so every host that falls back to OpenAI, the dev server
 * and the assistant's eval runner among them, names the same URL.
 */
export const DEFAULT_UPSTREAM_BASE_URL = "https://api.openai.com/v1";

/** The refusal's detail for a body that is not JSON. */
const INVALID_JSON = "Invalid JSON body";

/** The version 1 chat body, as a client sends it. Every member is optional on the wire. */
interface ChatRequestBody {
  messages?: unknown;
  tools?: unknown;
  systemPrompt?: unknown;
  model?: unknown;
  /** Absent on a version 1 body. Anything but 1 or an accepted version is refused. */
  wire?: unknown;
}

/** The chat-completions body forwarded upstream. */
interface UpstreamBody {
  model: unknown;
  messages: unknown[];
  stream: boolean;
  stream_options: { include_usage: boolean };
  tools?: unknown;
  tool_choice?: string | object;
  parallel_tool_calls?: boolean;
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: string;
  prompt_cache_key?: string;
}

/**
 * Whether `resolveUpstream` answered with a refusal rather than an upstream.
 *
 * @param {Upstream | GatewayRefusal} value - What `resolveUpstream` returned
 * @returns {boolean}
 */
function isRefusal(value: Upstream | GatewayRefusal): value is GatewayRefusal {
  return "problem" in value;
}

/**
 * Read the request body to the end, or until it passes `limit` bytes, in which case the rest is
 * never read and the result is null. Measured on the bytes that actually arrive, because a
 * `Content-Length` is only a claim.
 *
 * @param {Request} request - The client's request
 * @param {number | undefined} limit - The most bytes accepted, or undefined for no limit
 * @returns {Promise<Uint8Array | null>}
 */
async function readBody(request: Request, limit: number | undefined): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = request.body?.getReader();
  if (reader) {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      length += chunk.value.byteLength;
      if (limit !== undefined && length > limit) {
        void reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * The frames of one upstream exchange: the request, then its response normalized by the family's
 * normalizer, or the one frame that says why there is no response.
 *
 * @param {typeof fetch} upstreamFetch - The fetch to call the upstream with
 * @param {string} url - The upstream's chat URL
 * @param {RequestInit} init - The upstream request
 * @param {(response: Response) => AsyncGenerator<WireEvent>} normalize - The family's normalizer
 * @param {StreamStartEvent} [start] - The frame a version 2 stream opens with
 * @yields {StreamEvent} The route's frames, in wire order
 */
async function* exchange(
  upstreamFetch: typeof fetch,
  url: string,
  init: RequestInit,
  normalize: (response: Response) => AsyncGenerator<WireEvent>,
  start?: StreamStartEvent,
): AsyncGenerator<WireEvent> {
  // A version 2 stream opens by saying which wire it is and where the request went (§2.7).
  if (start) {
    yield start;
  }
  let response: Response;
  try {
    response = await upstreamFetch(url, init);
  } catch (error) {
    yield fetchFailureFrame(error);
    return;
  }
  yield* normalize(response);
}

/**
 * Build the chat route's handler around a host's policy.
 *
 * Each request goes through the same steps in the same order, and the first one that refuses
 * answers it as `application/problem+json` without contacting the upstream:
 *
 * 1. `admit`, before the body is read.
 * 2. `resolveUpstream`: where the request goes, or why it goes nowhere.
 * 3. The body is read, stopping at `maxBodyBytes` (413), and parsed as JSON (400 when it is not).
 * 4. The wire version: a body naming `wire: 2` is checked as one (400 when it is not one), and a
 *    version this gateway does not accept is a 400 `wire-unsupported` listing the ones it does.
 *    `messages` must be an array (400); its absence reads as an empty one.
 * 5. `maxMessages` (413).
 * 6. `onAccepted`.
 * 7. The stream: a `200 text/event-stream` whose frames are the upstream's response normalized by
 *    `normalizeOpenAIStream` (or `normalizeAnthropicStream` for the `anthropic` family), or the one
 *    frame saying why the upstream could not be reached.
 *
 * The version 1 body is forwarded as the OpenAI-compatible request it describes: the system prompt
 * as a leading `system` message, `stream_options.include_usage` so the provider's own token count
 * arrives, and `tool_choice: "auto"` with parallel calls whenever tools are offered. When the host
 * resolved a `sessionAffinity`, it rides along as the prompt-cache hint the upstream's host
 * understands, and not at all to any other host (`upstreamCacheHints`). The upstream request
 * carries `context.signal`, so aborting it ends the stream with `done: cancelled`.
 *
 * A version 2 body is the same conversation in no provider's words (specs/ai.md §2.7). It is read
 * as the version 1 body it describes and forwarded exactly as that one would be, so one transcript
 * reaches the upstream as the same bytes on either wire; its stream opens with a `stream_start`
 * frame, and every answer names the wire it was served on in `X-Jx-AI-Wire`.
 *
 * An upstream of the `anthropic` family receives the same body projected onto the Messages API
 * instead (`toAnthropicRequest`, specs/ai.md §2.6), at `<baseUrl>/v1/messages`, with the key as
 * `x-api-key`. It gets no session-affinity hint: Anthropic's prompt cache needs none.
 *
 * @param {ChatGatewayOptions<C>} options - The host's policy
 * @returns {(request: Request, context: C) => Promise<Response>}
 */
export function createChatHandler<C extends { readonly signal: AbortSignal }>(
  options: ChatGatewayOptions<C>,
): (request: Request, context: C) => Promise<Response> {
  return async (request, context) => {
    const admitted = await options.admit?.(request, context);
    if (admitted) {
      return problemResponse(admitted);
    }

    const upstream = await options.resolveUpstream(request, context);
    if (isRefusal(upstream)) {
      return problemResponse(upstream);
    }

    // A body that cannot be read is answered as one that cannot be parsed, as it always was.
    let bytes: Uint8Array | null;
    try {
      bytes = await readBody(request, options.maxBodyBytes);
    } catch {
      return problemResponse(refusal("invalidRequest", INVALID_JSON));
    }
    if (bytes === null) {
      return problemResponse(
        refusal(
          "payloadTooLarge",
          `The request body is larger than this gateway accepts (${String(options.maxBodyBytes)} bytes).`,
        ),
      );
    }
    let body: ChatRequestBody;
    try {
      /* `ignoreBOM` keeps a leading U+FEFF in the text, so a body that starts with one is invalid
         JSON, as it was when the server read it with Bun's `req.json()`. The default decoder would
         strip it and accept the body; this extraction changes no byte a client receives. */
      const text = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes);
      /* SAFETY: every member of ChatRequestBody is optional and `unknown`, so the type claims only
         that the parsed value can be destructured; each member is checked (messages, tools) or
         forwarded as `unknown` (model, systemPrompt) below, and a JSON `null` throws at the
         destructuring, as the route always has. */
      body = JSON.parse(text) as ChatRequestBody;
    } catch {
      return problemResponse(refusal("invalidRequest", INVALID_JSON));
    }

    /* A body naming a wire version other than 1 is version 2 or it is refused: with the versions
       this gateway accepts, so the client can speak one of them instead (§2.7). A body of JSON
       `null` throws here, as it always has. */
    const accepted = options.wire ?? WIRE_VERSIONS;
    let wire: 1 | 2 = 1;
    let extras: ProjectedRequest["extras"] = {};
    let neutralCount: number | undefined;
    /** The version 2 request itself, for the family that is projected from it directly. */
    let neutral: ChatRequestV2 | undefined;
    let source: ChatRequestBody = body;
    if (body.wire !== undefined && body.wire !== 1) {
      if (body.wire !== 2 || !accepted.includes(2)) {
        const problem = problemDetails(
          "wireUnsupported",
          `This backend accepts chat wire version ${accepted.join(" or ")}.`,
          { supported: [...accepted] },
        );
        return problemResponse({ problem, status: problem.status });
      }
      /* SAFETY: `body` came from JSON.parse, so it is a JSON value; the check reads it as one. */
      const failing = checkChatRequestV2(body as JsonValue);
      if (failing !== null) {
        return problemResponse(
          refusal("invalidRequest", `Not a version 2 chat request: ${failing || "/"} is invalid.`),
        );
      }
      /* SAFETY: `checkChatRequestV2` accepted the body, which is what makes it a ChatRequestV2. */
      const v2 = body as ChatRequestV2;
      const projected = projectV2Request(v2);
      neutral = v2;
      wire = 2;
      ({ extras } = projected);
      // The limit counts the conversation's own messages, not the wire's: one reply is one message.
      neutralCount = v2.messages.length;
      source = {
        messages: projected.messages,
        systemPrompt: projected.systemPrompt,
        tools: projected.tools,
        ...(projected.model === undefined ? null : { model: projected.model }),
      };
    }

    /* Defaults apply to an ABSENT member only, so a `null` one is forwarded as sent (and a `null`
       `messages` is refused below). */
    const { messages = [], tools = [], systemPrompt = "", model = upstream.defaultModel } = source;

    if (!Array.isArray(messages)) {
      return problemResponse(refusal("invalidRequest", "messages must be an array"));
    }
    const messageCount = neutralCount ?? messages.length;
    if (options.maxMessages !== undefined && messageCount > options.maxMessages) {
      return problemResponse(
        refusal(
          "payloadTooLarge",
          `The request carries ${String(messageCount)} messages; this gateway accepts at most ${String(options.maxMessages)}.`,
        ),
      );
    }

    options.onAccepted?.(
      {
        bytes: bytes.byteLength,
        messageCount,
        model: String(model),
        wire,
      },
      upstream,
      context,
    );

    // Looked up per request, not captured at construction: a host or a test may swap it.
    const upstreamFetch = options.fetch ?? fetch;
    // The answer names the wire it was served on; a version 2 stream also opens by saying so.
    const headers = { ...SSE_HEADERS, [WIRE_HEADER]: String(wire) };
    const start: StreamStartEvent | undefined =
      wire === 2
        ? { family: upstream.family, model: String(model), type: "stream_start", wire: 2 }
        : undefined;

    /* A version 2 request reaches Claude from the neutral conversation itself (specs/ai.md §2.6):
       its signed thinking is replayed where its binding still holds, which the version 1 body
       below cannot carry at all. */
    if (upstream.family === "anthropic" && neutral) {
      const round: ProviderRequest = {
        messages: neutral.messages,
        model: String(model),
        system: neutral.system,
        tools: neutral.tools,
        ...(neutral.maxTokens === undefined ? null : { maxTokens: neutral.maxTokens }),
        ...(neutral.temperature === undefined ? null : { temperature: neutral.temperature }),
      };
      const messagesBody = (withoutThinking: boolean) =>
        toAnthropicMessagesRequest(round, {
          defaultMaxTokens: ANTHROPIC_MAX_TOKENS,
          firstParty: isFirstPartyAnthropic(upstream.baseUrl),
          midConversationSystem: anthropicCapabilities(round.model).midConversationSystem,
          withoutThinking,
        });
      const native = async function* native(): AsyncGenerator<WireEvent> {
        yield { family: "anthropic", model: round.model, type: "stream_start", wire: 2 };
        yield* anthropicExchange(
          messagesBody(false),
          {
            apiKey: upstream.apiKey,
            baseUrl: upstream.baseUrl,
            fetch: upstreamFetch,
            signal: context.signal,
            wire: 2,
          },
          () => messagesBody(true),
        );
      };
      return new Response(encodeSse(native()), { headers });
    }

    if (upstream.family === "anthropic") {
      const messagesRequest = toAnthropicRequest(
        { messages, model: String(model), systemPrompt, tools },
        { firstParty: isFirstPartyAnthropic(upstream.baseUrl) },
      );
      const frames = exchange(
        upstreamFetch,
        `${upstream.baseUrl}/v1/messages`,
        {
          body: JSON.stringify(messagesRequest),
          headers: { ...anthropicHeaders(upstream.apiKey) },
          method: "POST",
          signal: context.signal,
        },
        normalizeAnthropicStream,
        start,
      );
      return new Response(encodeSse(frames), { headers });
    }

    // SAFETY: Array.isArray above proved `messages` is an array; its entries are forwarded unread.
    const upstreamBody: UpstreamBody = {
      model,
      messages: [{ role: "system", content: systemPrompt }, ...(messages as unknown[])],
      stream: true,
      stream_options: { include_usage: true },
    };
    /* The wire has always forwarded `tools` as sent, so a non-array with a length passes through.
       SAFETY: only `length` is read, off a truthy value, and that read is total: a value with no
       numeric `length` yields `undefined` (or its own member), which `> 0` compares as it always has. */
    if (tools && (tools as { length: number }).length > 0) {
      upstreamBody.tools = tools;
      upstreamBody.tool_choice = extras.tool_choice ?? "auto";
      upstreamBody.parallel_tool_calls = true;
    }
    // What version 1 has no word for; absent on a version 1 request, so its body is unchanged.
    const { tool_choice: _choice, ...sampling } = extras;
    Object.assign(upstreamBody, sampling);
    const errorCode = (status: number): string | undefined =>
      options.upstreamErrorCode?.(status, upstream);
    const hints = upstreamCacheHints(upstream.baseUrl, upstream.sessionAffinity);
    Object.assign(upstreamBody, hints.body);

    const normalizeOptions: NormalizeOptions = upstream.quirks
      ? { errorCode, quirks: upstream.quirks }
      : { errorCode };

    const frames = exchange(
      upstreamFetch,
      `${upstream.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${upstream.apiKey}`,
          ...hints.headers,
        },
        body: JSON.stringify(upstreamBody),
        signal: context.signal,
      },
      (response) => normalizeOpenAIStream(response, normalizeOptions),
      start,
    );
    return new Response(encodeSse(frames), { headers });
  };
}
