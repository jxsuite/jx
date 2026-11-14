/**
 * The OpenAI-compatible stream normalizer: an upstream chat-completions response in, the chat
 * route's frames out.
 *
 * This is `@jxsuite/server`'s normalizer, moved here verbatim (specs/ai.md §2.4), so that every
 * backend serving the chat route can run the same one. Its frames are frozen by the server's
 * upstream fixtures (`packages/server/tests/fixtures/ai-upstream/*.server.json`); a change to what
 * this file yields is a behaviour change and belongs in a change whose spec fragment names it.
 *
 * @module @jxsuite/ai/gateway
 */

import { problemDetails } from "@jxsuite/protocol/problems";
import type { JsonObject, JsonValue } from "../core-types.ts";
import type {
  OpenAIStreamChunk,
  OpenAIUsage,
  StreamEvent,
  StreamUsageEvent,
} from "../streaming-client.ts";
import { problemTypeForStatus } from "./problem.ts";
import type { OpenAICompatQuirks } from "./types.ts";
import { extractUpstreamErrorMessage } from "./upstream-error.ts";

/** What a caller may tell the normalizer about the upstream it is reading. */
export interface NormalizeOptions {
  /** How this upstream departs from the chat-completions wire. */
  readonly quirks?: OpenAICompatQuirks;
  /**
   * The `code` an upstream's non-2xx status is reported under, when the host knows a better one
   * than the status itself (a brokered credential that lapsed, say). Undefined keeps the status.
   */
  readonly errorCode?: (status: number) => string | undefined;
}

/** The usage path every OpenAI-compatible provider that reports a cache hit uses, absent a quirk. */
const DEFAULT_CACHED_TOKENS_PATHS: readonly string[] = ["prompt_tokens_details.cached_tokens"];

/**
 * Normalize an upstream usage object into a `usage` frame, or null when it carries no count. The
 * detail figures are included only when the provider sent them: absent is "not said", not zero.
 *
 * @param {OpenAIStreamChunk["usage"]} usage - The chunk's `usage` member
 * @returns {StreamUsageEvent | null}
 */
function usageFrame(
  usage: OpenAIStreamChunk["usage"],
  cachedTokensPaths: readonly string[],
): StreamUsageEvent | null {
  if (!usage || !isCount(usage.prompt_tokens)) {
    return null;
  }
  const frame: StreamUsageEvent = {
    type: "usage",
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens ?? 0,
  };
  const cached = cachedCount(usage, cachedTokensPaths);
  if (cached !== undefined) {
    frame.cachedInputTokens = cached;
  }
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  if (isCount(reasoning)) {
    frame.reasoningTokens = reasoning;
  }
  return frame;
}

/**
 * The cached-input count a usage object carries: the number at the first of `paths` that holds one,
 * or undefined when none does.
 *
 * @param {OpenAIUsage} usage - The usage object, as the provider sent it
 * @param {readonly string[]} paths - Dotted member paths, tried in order
 * @returns {number | undefined}
 */
function cachedCount(usage: OpenAIUsage, paths: readonly string[]): number | undefined {
  for (const path of paths) {
    /* SAFETY: the usage object is parsed JSON, so it is a JSON object whatever members a provider
       put in it; the walk below checks each step before it reads the next. */
    let value: JsonValue | undefined = usage as JsonObject;
    for (const key of path.split(".")) {
      value = isJsonObject(value) ? value[key] : undefined;
    }
    if (isJsonNumber(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * True when a parsed member is a number.
 *
 * @param {JsonValue | undefined} value - A member of the usage object
 * @returns {boolean}
 */
function isJsonNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

/**
 * True when a parsed member is a JSON object whose members may be read by name.
 *
 * @param {JsonValue | undefined} value - A member of the usage object
 * @returns {boolean}
 */
function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when a usage figure the provider sent is a number. The chunk is upstream JSON, so a figure
 * its interface calls a number is checked before it is reported.
 *
 * @param {unknown} value - A `usage` member, as the provider sent it
 * @returns {boolean}
 */
function isCount(value: unknown): value is number {
  return typeof value === "number";
}

/**
 * True when a chain-of-thought member the provider sent is a string.
 *
 * @param {unknown} value - `reasoning_content` or `reasoning`, as the provider sent it
 * @returns {boolean}
 */
function isText(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * The stop reasons the stream reports; any other `finish_reason` keeps it reading.
 *
 * @param {string | null | undefined} reason - The chunk's `finish_reason`
 * @returns {string | null}
 */
function stopReasonOf(reason: string | null | undefined): string | null {
  if (reason === "tool_calls" || reason === "length" || reason === "stop") {
    return reason;
  }
  return null;
}

/**
 * The frame for an upstream request that never got a response: `done: cancelled` when it was
 * aborted, otherwise an `error` frame carrying an `upstreamFailure` problem.
 *
 * The frame carries a problem rather than being one: the response began with a 200 long before this
 * failed, so nothing can change the status now. `message` stays for the readers that already show
 * it (server.md §4.3).
 *
 * @param {unknown} cause - What `fetch` rejected with
 * @returns {StreamEvent}
 */
export function fetchFailureFrame(cause: unknown): StreamEvent {
  return failureFrame("Network error", cause);
}

/**
 * The frame for a stream whose read failed part-way: `done: cancelled` when it was aborted,
 * otherwise an `error` frame carrying an `upstreamFailure` problem. Every normalizer ends a failed
 * read with it.
 *
 * @param {unknown} cause - What the read rejected with
 * @returns {StreamEvent}
 */
export function streamFailureFrame(cause: unknown): StreamEvent {
  return failureFrame("Stream error", cause);
}

/**
 * The one frame for an upstream that answered non-2xx: the sentence inside its body as `message`,
 * its own status as `code`, and a problem naming the kind of failure. Every normalizer answers a
 * refused request with it, so a client reads one shape whichever provider refused.
 *
 * @param {Response} response - The upstream's non-2xx response
 * @param {(status: number) => string | undefined} [errorCode] - The host's own code for a status,
 *   when it has one; the status itself otherwise
 * @returns {Promise<StreamEvent>}
 */
export async function upstreamErrorFrame(
  response: Response,
  errorCode?: (status: number) => string | undefined,
): Promise<StreamEvent> {
  let errorBody = "";
  try {
    errorBody = await response.text();
  } catch {
    /* Ignore */
  }
  const cleanMessage = extractUpstreamErrorMessage(errorBody, response.statusText);
  return {
    code: errorCode?.(response.status) ?? String(response.status),
    message: cleanMessage,
    // The upstream's own status is preserved in `code`; the problem names the KIND.
    problem: problemDetails(problemTypeForStatus(response.status), cleanMessage),
    type: "error",
  };
}

/**
 * The frame for a 2xx upstream response with no body to read.
 *
 * @returns {StreamEvent}
 */
export function noBodyFrame(): StreamEvent {
  return {
    message: "No response body from upstream",
    problem: problemDetails("upstreamFailure", "No response body from upstream"),
    type: "error",
  };
}

/**
 * The frame for an exchange that failed: `done: cancelled` for an abort, otherwise an `error` frame
 * whose `message` is `prefix` and the failure's own message.
 *
 * @param {"Network error" | "Stream error"} prefix - Which half of the exchange failed
 * @param {unknown} cause - What the request or the read rejected with
 * @returns {StreamEvent}
 */
function failureFrame(prefix: "Network error" | "Stream error", cause: unknown): StreamEvent {
  /* SAFETY: `fetch` and a body reader reject with an Error (a TypeError, or the abort's
     AbortError DOMException), and the reads below throw only TypeErrors. Only `name` and `message`
     are read, so a custom non-null abort reason that is not an Error reads both as undefined, as
     it always has. */
  const failure = cause as Error;
  if (failure.name === "AbortError") {
    return { type: "done", stopReason: "cancelled" };
  }
  const message = `${prefix}: ${failure.message}`;
  return { message, problem: problemDetails("upstreamFailure", message), type: "error" };
}

/**
 * Normalize an OpenAI-compatible chat-completions response into the chat route's frames.
 *
 * - A non-2xx response is one `error` frame: the sentence inside the provider's body as `message`,
 *   the upstream's own status as `code`, and a problem naming the kind of failure.
 * - Text is `delta`; chain-of-thought (`reasoning_content`, or `reasoning` at OpenRouter) is
 *   `reasoning`, forwarded rather than dropped, because DeepSeek's thinking mode requires every
 *   prior turn's reasoning back on any request carrying `tools`.
 * - A tool call is `tool_call_start`, then `tool_call_delta` per fragment, then `tool_call_end`.
 * - The finish reason is REMEMBERED, not acted on: with `include_usage` the count arrives in a chunk
 *   of its own after the finish, so the stream ends at `[DONE]` or when the body closes. The last
 *   frames are the open calls' ends, the `usage` count when there is one, then `done`.
 * - An aborted read is `done: cancelled`; any other failed read is an `error` frame.
 * - A body that closes having sent neither `[DONE]` nor a finish reason was cut off: its `done`
 *   carries `truncated: true`, with `stopReason` still `"stop"` for a reader that predates the
 *   member.
 * - A call's fragments are joined by `index`, or by position in the chunk when the provider sends no
 *   index, and an id repeated on a later fragment continues the call rather than restarting it.
 * - A consumer that stops reading early cancels the upstream body.
 *
 * @param {Response} response - The upstream's response to the chat-completions request
 * @param {NormalizeOptions} [options] - The upstream's quirks, and the host's code for a status
 * @yields {StreamEvent} The route's frames, in wire order
 */
export async function* normalizeOpenAIStream(
  response: Response,
  options: NormalizeOptions = {},
): AsyncGenerator<StreamEvent> {
  if (!response.ok) {
    yield await upstreamErrorFrame(response, options.errorCode);
    return;
  }
  const quirks = options.quirks ?? {};
  const cachedTokensPaths = quirks.cachedTokensPaths ?? DEFAULT_CACHED_TOKENS_PATHS;
  const restartOnRepeatedId = quirks.newCallOn === "id";
  const keyByIndexOnly = quirks.callKey === "index";

  const reader = response.body?.getReader();
  if (!reader) {
    yield noBodyFrame();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const pendingToolCalls = new Map<
    number | undefined,
    { id: string; name: string; args: string }
  >();
  let stopReason: string | null = null;
  let usage: StreamUsageEvent | null = null;
  /* Whether the upstream said it was finished: `[DONE]`, or a finish reason this stream reports. A
     body that closes having said neither was cut off, and the last frame says so. */
  let terminated = false;

  /**
   * Close every open call.
   *
   * @yields {StreamEvent} A `tool_call_end` per open call
   */
  function* closePendingToolCalls(): Generator<StreamEvent> {
    for (const [, tc] of pendingToolCalls) {
      yield { type: "tool_call_end", id: tc.id };
    }
    pendingToolCalls.clear();
  }

  /**
   * The stream's last frames: open calls, the count when there is one, then `done`. The count comes
   * BEFORE `done`, because a reader stops at `done`.
   *
   * @yields {StreamEvent} The closing frames, in order
   */
  function* finish(): Generator<StreamEvent> {
    yield* closePendingToolCalls();
    if (usage) {
      yield usage;
    }
    // Cut off: `stopReason` stays "stop", so a reader that predates `truncated` ends the round as it did.
    yield terminated
      ? { type: "done", stopReason: stopReason ?? "stop" }
      : { type: "done", stopReason: "stop", truncated: true };
  }

  /* Whether the loop ended on its own terms. A consumer that stops reading ends a generator through
     `return()`, which runs `finally` and nothing else; when the server wrote each frame itself, that
     exit was the next write throwing inside this `try`, so the `catch` cancelled the upstream body.
     `finally` keeps that: the upstream must not outlive the reader it streams to. */
  let settled = false;
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
        if (dataStr === "[DONE]") {
          terminated = true;
          yield* finish();
          settled = true;
          return;
        }

        let parsed: OpenAIStreamChunk;
        try {
          /* SAFETY: the interface is the provider's wire shape, and this loop only reads it: each
             member passes optional chaining, a truthiness test or a predicate before it shapes a
             frame, and a chunk too malformed to read (JSON `null`, a non-iterable `tool_calls`)
             throws into the catch below, which reports it as a stream error. */
          parsed = JSON.parse(dataStr) as OpenAIStreamChunk;
        } catch {
          continue;
        }

        // Usually a final chunk with no choices, but a provider may put it beside the finish.
        usage = usageFrame(parsed.usage, cachedTokensPaths) ?? usage;

        const choice = parsed.choices?.[0];
        if (!choice) {
          continue;
        }

        const { delta } = choice;

        // Text content
        if (delta?.content) {
          yield { type: "delta", content: delta.content };
        }

        /* Chain-of-thought, under either of the two names providers give it. Forwarded rather than
           dropped: DeepSeek's thinking mode requires every prior turn's reasoning back on any
           request carrying `tools`, so a proxy that swallows these frames makes the NEXT round a
           400 the client cannot repair. */
        const reasoning = quirks.reasoningField
          ? delta?.[quirks.reasoningField]
          : (delta?.reasoning_content ?? delta?.reasoning);
        if (isText(reasoning) && reasoning) {
          yield { type: "reasoning", content: reasoning };
        }

        // Tool calls
        if (delta?.tool_calls) {
          let position = 0;
          for (const tc of delta.tool_calls) {
            /* A provider that sends no `index` (some local servers) means the call's place in this
               chunk's array; keyed on the missing index alone, every such call would share one key
               and each would overwrite the last. */
            const key = keyByIndexOnly || isCount(tc.index) ? tc.index : position;
            position += 1;
            const existing = pendingToolCalls.get(key);
            /* An id is a NEW call only when it differs from the one open at this key: several
               providers repeat the id on every fragment, and restarting on each one cut the
               arguments into as many calls. */
            if (tc.id && (restartOnRepeatedId || existing?.id !== tc.id)) {
              // First appearance
              const entry = {
                id: tc.id,
                name: tc.function?.name || "",
                args: tc.function?.arguments || "",
              };
              pendingToolCalls.set(key, entry);

              yield { type: "tool_call_start", id: tc.id, name: entry.name };

              if (entry.args) {
                yield { type: "tool_call_delta", id: tc.id, args: entry.args };
              }
            } else if (existing && tc.function?.arguments) {
              // Subsequent fragment
              existing.args += tc.function.arguments;
              yield { type: "tool_call_delta", id: existing.id, args: tc.function.arguments };
            }
          }
        }

        // Finish reason: close the calls now, report the reason at the end of the stream.
        const finished = stopReasonOf(choice.finish_reason);
        if (finished) {
          yield* closePendingToolCalls();
          stopReason = finished;
          terminated = true;
        }
      }
    }

    // Stream ended without `[DONE]`
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
