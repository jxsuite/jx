/**
 * The chat route: a request from a Jx client in, an SSE stream of normalized frames out.
 *
 * @module @jxsuite/ai/gateway
 */

import type { StreamEvent } from "../streaming-client.ts";
import { fetchFailureFrame, normalizeOpenAIStream } from "./normalize.ts";
import { problemResponse, refusal } from "./problem.ts";
import { encodeSse, SSE_HEADERS } from "./sse.ts";
import type { ChatGatewayOptions, GatewayRefusal, Upstream } from "./types.ts";

/** The refusal's detail for a body that is not JSON. */
const INVALID_JSON = "Invalid JSON body";

/** The version 1 chat body, as a client sends it. Every member is optional on the wire. */
interface ChatRequestBody {
  messages?: unknown;
  tools?: unknown;
  systemPrompt?: unknown;
  model?: unknown;
}

/** The chat-completions body forwarded upstream. */
interface UpstreamBody {
  model: unknown;
  messages: unknown[];
  stream: boolean;
  stream_options: { include_usage: boolean };
  tools?: unknown;
  tool_choice?: string;
  parallel_tool_calls?: boolean;
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
 * The frames of one upstream exchange: the request, then its normalized response, or the one frame
 * that says why there is no response.
 *
 * @param {typeof fetch} upstreamFetch - The fetch to call the upstream with
 * @param {string} url - The upstream's chat-completions URL
 * @param {RequestInit} init - The upstream request
 * @yields {StreamEvent} The route's frames, in wire order
 */
async function* exchange(
  upstreamFetch: typeof fetch,
  url: string,
  init: RequestInit,
): AsyncGenerator<StreamEvent> {
  let response: Response;
  try {
    response = await upstreamFetch(url, init);
  } catch (error) {
    yield fetchFailureFrame(error);
    return;
  }
  yield* normalizeOpenAIStream(response);
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
 * 4. `messages` must be an array (400); its absence reads as an empty one.
 * 5. `maxMessages` (413).
 * 6. `onAccepted`.
 * 7. The stream: a `200 text/event-stream` whose frames are the upstream's response normalized by
 *    `normalizeOpenAIStream`, or the one frame saying why the upstream could not be reached.
 *
 * The version 1 body is forwarded as the OpenAI-compatible request it describes: the system prompt
 * as a leading `system` message, `stream_options.include_usage` so the provider's own token count
 * arrives, and `tool_choice: "auto"` with parallel calls whenever tools are offered. The upstream
 * request carries `context.signal`, so aborting it ends the stream with `done: cancelled`.
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
      body = JSON.parse(text) as ChatRequestBody;
    } catch {
      return problemResponse(refusal("invalidRequest", INVALID_JSON));
    }

    /* Defaults apply to an ABSENT member only, so a `null` one is forwarded as sent (and a `null`
       `messages` is refused below). A body of JSON `null` throws here, as it always has. */
    const { messages = [], tools = [], systemPrompt = "", model = upstream.defaultModel } = body;

    if (!Array.isArray(messages)) {
      return problemResponse(refusal("invalidRequest", "messages must be an array"));
    }
    if (options.maxMessages !== undefined && messages.length > options.maxMessages) {
      return problemResponse(
        refusal(
          "payloadTooLarge",
          `The request carries ${String(messages.length)} messages; this gateway accepts at most ${String(options.maxMessages)}.`,
        ),
      );
    }

    options.onAccepted?.(
      {
        bytes: bytes.byteLength,
        messageCount: messages.length,
        model: String(model),
        wire: 1,
      },
      upstream,
      context,
    );

    const upstreamBody: UpstreamBody = {
      model,
      messages: [{ role: "system", content: systemPrompt }, ...(messages as unknown[])],
      stream: true,
      stream_options: { include_usage: true },
    };
    // The wire has always forwarded `tools` as sent, so a non-array with a length passes through.
    if (tools && (tools as { length: number }).length > 0) {
      upstreamBody.tools = tools;
      upstreamBody.tool_choice = "auto";
      upstreamBody.parallel_tool_calls = true;
    }

    // Looked up per request, not captured at construction: a host or a test may swap it.
    const upstreamFetch = options.fetch ?? fetch;
    const frames = exchange(upstreamFetch, `${upstream.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${upstream.apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
      signal: context.signal,
    });
    return new Response(encodeSse(frames), { headers: SSE_HEADERS });
  };
}
