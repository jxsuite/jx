/**
 * The OpenAI-compatible stream normalizer: an upstream chat-completions response in, the chat
 * route's frames out.
 *
 * This is `@jxsuite/server`'s normalizer, moved here verbatim (harness slice J1.17), so that every
 * backend serving the chat route can run the same one. Its frames are frozen by the server's
 * upstream fixtures (`packages/server/tests/fixtures/ai-upstream/*.server.json`); a change to what
 * this file yields is a behaviour change and belongs in a slice whose spec fragment names it.
 *
 * @module @jxsuite/ai/gateway
 */

import { problemDetails } from "@jxsuite/protocol/problems";
import type { StreamEvent, StreamUsageEvent } from "../streaming-client.ts";
import { problemTypeForStatus } from "./problem.ts";
import { extractUpstreamErrorMessage } from "./upstream-error.ts";

/** A tool-call fragment inside an OpenAI streaming `delta`. */
interface ToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/** A single OpenAI chat-completions streaming chunk (the JSON after `data: `). */
interface OpenAIStreamChunk {
  choices?: {
    index?: number;
    delta?: {
      content?: string;
      /** Thinking models' chain-of-thought: DeepSeek and Volcengine spell it this way... */
      reasoning_content?: string;
      /** ...and OpenRouter this way. Both carry the same thing. */
      reasoning?: string;
      tool_calls?: ToolCallDelta[];
    };
    finish_reason?: string | null;
  }[];
  /** The count `stream_options.include_usage` asks for, normally a final chunk with no choices. */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
    completion_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
}

/**
 * Normalize an upstream usage object into a `usage` frame, or null when it carries no count. The
 * detail figures are included only when the provider sent them: absent is "not said", not zero.
 *
 * @param {OpenAIStreamChunk["usage"]} usage - The chunk's `usage` member
 * @returns {StreamUsageEvent | null}
 */
function usageFrame(usage: OpenAIStreamChunk["usage"]): StreamUsageEvent | null {
  if (!usage || typeof usage.prompt_tokens !== "number") {
    return null;
  }
  const frame: StreamUsageEvent = {
    type: "usage",
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens ?? 0,
  };
  const cached = usage.prompt_tokens_details?.cached_tokens;
  if (typeof cached === "number") {
    frame.cachedInputTokens = cached;
  }
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  if (typeof reasoning === "number") {
    frame.reasoningTokens = reasoning;
  }
  return frame;
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
 * @param {unknown} error - What `fetch` rejected with
 * @returns {StreamEvent}
 */
export function fetchFailureFrame(error: unknown): StreamEvent {
  if ((error as Error).name === "AbortError") {
    return { type: "done", stopReason: "cancelled" };
  }
  const message = `Network error: ${(error as Error).message}`;
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
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
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
        if (typeof reasoning === "string" && reasoning) {
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
    if ((error as Error).name === "AbortError") {
      yield { type: "done", stopReason: "cancelled" };
      return;
    }
    const message = `Stream error: ${(error as Error).message}`;
    yield { message, problem: problemDetails("upstreamFailure", message), type: "error" };
  } finally {
    if (!settled) {
      void reader.cancel();
    }
  }
}
