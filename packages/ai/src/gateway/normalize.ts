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
import type { OpenAIStreamChunk, StreamEvent, StreamUsageEvent } from "../streaming-client.ts";
import { problemTypeForStatus } from "./problem.ts";
import { extractUpstreamErrorMessage } from "./upstream-error.ts";

/**
 * Normalize an upstream usage object into a `usage` frame, or null when it carries no count. The
 * detail figures are included only when the provider sent them: absent is "not said", not zero.
 *
 * @param {OpenAIStreamChunk["usage"]} usage - The chunk's `usage` member
 * @returns {StreamUsageEvent | null}
 */
function usageFrame(usage: OpenAIStreamChunk["usage"]): StreamUsageEvent | null {
  if (!usage || !isCount(usage.prompt_tokens)) {
    return null;
  }
  const frame: StreamUsageEvent = {
    type: "usage",
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens ?? 0,
  };
  const cached = usage.prompt_tokens_details?.cached_tokens;
  if (isCount(cached)) {
    frame.cachedInputTokens = cached;
  }
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  if (isCount(reasoning)) {
    frame.reasoningTokens = reasoning;
  }
  return frame;
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
 * - A consumer that stops reading early cancels the upstream body.
 *
 * @param {Response} response - The upstream's response to the chat-completions request
 * @yields {StreamEvent} The route's frames, in wire order
 */
export async function* normalizeOpenAIStream(response: Response): AsyncGenerator<StreamEvent> {
  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      /* Ignore */
    }
    const cleanMessage = extractUpstreamErrorMessage(errorBody, response.statusText);
    yield {
      code: String(response.status),
      message: cleanMessage,
      // The upstream's own status is preserved in `code`; the problem names the KIND.
      problem: problemDetails(problemTypeForStatus(response.status), cleanMessage),
      type: "error",
    };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield {
      message: "No response body from upstream",
      problem: problemDetails("upstreamFailure", "No response body from upstream"),
      type: "error",
    };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();
  let stopReason: string | null = null;
  let usage: StreamUsageEvent | null = null;

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
    yield { type: "done", stopReason: stopReason ?? "stop" };
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
        usage = usageFrame(parsed.usage) ?? usage;

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
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (isText(reasoning) && reasoning) {
          yield { type: "reasoning", content: reasoning };
        }

        // Tool calls
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
              // First appearance
              const entry = {
                id: tc.id,
                name: tc.function?.name || "",
                args: tc.function?.arguments || "",
              };
              pendingToolCalls.set(tc.index, entry);

              yield { type: "tool_call_start", id: tc.id, name: entry.name };

              if (entry.args) {
                yield { type: "tool_call_delta", id: tc.id, args: entry.args };
              }
            } else if (tc.function?.arguments) {
              // Subsequent fragment
              const existing = pendingToolCalls.get(tc.index);
              if (existing) {
                existing.args += tc.function.arguments;
                yield { type: "tool_call_delta", id: existing.id, args: tc.function.arguments };
              }
            }
          }
        }

        // Finish reason: close the calls now, report the reason at the end of the stream.
        const finished = stopReasonOf(choice.finish_reason);
        if (finished) {
          yield* closePendingToolCalls();
          stopReason = finished;
        }
      }
    }

    // Stream ended without `[DONE]`
    yield* finish();
    settled = true;
  } catch (error) {
    settled = true;
    void reader.cancel();
    yield failureFrame("Stream error", error);
  } finally {
    if (!settled) {
      void reader.cancel();
    }
  }
}
