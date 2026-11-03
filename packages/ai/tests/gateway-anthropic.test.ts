/**
 * Tests for the gateway's Anthropic Messages API path (specs/ai.md §2.6): the projection of a
 * version 1 body (`toAnthropicRequest`), the stream normalizer (`normalizeAnthropicStream`), the
 * model listing (`listAnthropicModels`), and the chat route's `anthropic` branch.
 *
 * Every stream below is a recorded event sequence in the Messages API's own shape, fed whole, one
 * line at a time and one byte at a time, and must yield the same frames each way.
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import { problemDetails } from "@jxsuite/protocol";
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_BASE_URL,
  ANTHROPIC_MAX_TOKENS,
  anthropicHeaders,
  isFirstPartyAnthropic,
  listAnthropicModels,
  normalizeAnthropicStream,
  toAnthropicRequest,
} from "../src/gateway/anthropic.ts";
import type { AnthropicProjectionInput } from "../src/gateway/anthropic.ts";
import { createChatHandler } from "../src/gateway/chat.ts";
import type { Upstream } from "../src/gateway/types.ts";
import type { JsonObject, JsonValue } from "../src/core-types.ts";
import type { StreamEvent } from "../src/streaming-client.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** One SSE event: a JSON payload, or a line's text sent as written. */
type SseEvent = JsonObject | string;

/** Whether an event is text to send as written rather than JSON to serialize. */
function isVerbatim(event: SseEvent): event is string {
  return typeof event === "string";
}

/** A Messages API SSE body: an `event:` line naming each payload's type, then its `data:` line. */
function sse(...events: SseEvent[]): string {
  return events
    .map((event) =>
      isVerbatim(event)
        ? `${event}\n\n`
        : `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
}

/** Every way the same body is split into reads: whole, one line at a time, one byte at a time. */
const CHUNKINGS = {
  bytes: (bytes) => Array.from(bytes, (_, index) => bytes.subarray(index, index + 1)),
  lines: (bytes) => {
    const chunks: Uint8Array[] = [];
    let start = 0;
    for (const [index, byte] of bytes.entries()) {
      if (byte === 0x0a) {
        chunks.push(bytes.subarray(start, index + 1));
        start = index + 1;
      }
    }
    if (start < bytes.length) {
      chunks.push(bytes.subarray(start));
    }
    return chunks;
  },
  whole: (bytes) => (bytes.length > 0 ? [bytes] : []),
} satisfies Record<string, (bytes: Uint8Array) => Uint8Array[]>;

/** A 200 upstream, and how many times its body has been cancelled so far. */
interface CountedUpstream {
  response: Response;
  cancels: () => number;
}

/** A 200 upstream whose body arrives in `chunks`, counting how often it is cancelled. */
function upstream(chunks: Uint8Array[]): CountedUpstream {
  let next = 0;
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancels += 1;
    },
    pull(controller) {
      const chunk = chunks[next];
      next += 1;
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
  });
  return { cancels: () => cancels, response: new Response(body, { status: 200 }) };
}

async function collect(frames: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const frame of frames) {
    out.push(frame);
  }
  return out;
}

/** Normalize `body` under every chunking and assert each yields `expected`. */
async function expectFrames(body: string, expected: StreamEvent[]): Promise<void> {
  const bytes = new TextEncoder().encode(body);
  for (const split of Object.values(CHUNKINGS)) {
    const { response } = upstream(split(bytes));
    expect(await collect(normalizeAnthropicStream(response))).toEqual(expected);
  }
}

const MESSAGE_START = {
  message: {
    content: [],
    id: "msg_1",
    model: "claude-opus-5-5",
    role: "assistant",
    type: "message",
    usage: { cache_creation_input_tokens: 5, cache_read_input_tokens: 90, input_tokens: 10 },
  },
  type: "message_start",
};

const stop = (reason: string, output = 12): JsonObject => ({
  delta: { stop_reason: reason },
  type: "message_delta",
  usage: { output_tokens: output },
});

const MESSAGE_STOP = { type: "message_stop" };

/** The usage frame MESSAGE_START and `stop(…, output)` report. */
const usage = (output = 12): StreamEvent => ({
  cachedInputTokens: 90,
  inputTokens: 105,
  outputTokens: output,
  type: "usage",
});

/** A version 1 body with defaults. */
function v1Body(overrides: Partial<AnthropicProjectionInput>): AnthropicProjectionInput {
  return { messages: [], model: "claude-opus-5-5", systemPrompt: "", tools: [], ...overrides };
}

const FIRST_PARTY = { firstParty: true };
const COMPATIBLE = { firstParty: false };

// ─── Projection ──────────────────────────────────────────────────────────────

describe("toAnthropicRequest", () => {
  it("streams with the required max_tokens, and caches and streams tool input first-party", () => {
    const request = toAnthropicRequest(
      v1Body({
        messages: [{ content: "Make a page", role: "user" }],
        systemPrompt: "You edit Jx documents.",
        tools: [
          {
            function: {
              description: "Add a child",
              name: "add_child",
              parameters: { properties: { tag: { type: "string" } }, type: "object" },
            },
            type: "function",
          },
        ],
      }),
      FIRST_PARTY,
    );
    expect(request).toEqual({
      cache_control: { type: "ephemeral" },
      max_tokens: ANTHROPIC_MAX_TOKENS,
      messages: [{ content: [{ text: "Make a page", type: "text" }], role: "user" }],
      model: "claude-opus-5-5",
      stream: true,
      system: [{ text: "You edit Jx documents.", type: "text" }],
      tools: [
        {
          description: "Add a child",
          eager_input_streaming: true,
          input_schema: { properties: { tag: { type: "string" } }, type: "object" },
          name: "add_child",
        },
      ],
    });
  });

  it("sends an Anthropic-compatible endpoint neither cache_control nor eager streaming", () => {
    const request = toAnthropicRequest(
      v1Body({
        messages: [{ content: "Hi", role: "user" }],
        tools: [{ function: { name: "noop" }, type: "function" }],
      }),
      COMPATIBLE,
    );
    expect(request.cache_control).toBeUndefined();
    expect(request.tools).toEqual([
      { input_schema: { properties: {}, type: "object" }, name: "noop" },
    ]);
    expect(request.system).toBeUndefined();
  });

  it("projects a tool round: text then tool_use in order, and one user message of results", () => {
    const request = toAnthropicRequest(
      v1Body({
        messages: [
          { content: "Add two things", role: "user" },
          {
            content: "Adding them.",
            reasoning_content: "Two calls, then done.",
            role: "assistant",
            tool_calls: [
              { function: { arguments: '{"tag":"h1"}', name: "add_child" }, id: "toolu_a" },
              { function: { arguments: '{"tag":"p"', name: "add_child" }, id: "toolu_b" },
            ],
          },
          { content: '{"success":true}', role: "tool", tool_call_id: "toolu_a" },
          { content: '{"success":false,"error":"bad"}', role: "tool", tool_call_id: "toolu_b" },
          { content: "Thanks", role: "user" },
        ],
      }),
      COMPATIBLE,
    );
    expect(request.messages).toEqual([
      { content: [{ text: "Add two things", type: "text" }], role: "user" },
      {
        content: [
          { text: "Adding them.", type: "text" },
          { id: "toolu_a", input: { tag: "h1" }, name: "add_child", type: "tool_use" },
          // Arguments that do not parse go as `{}`: the call already carries an error result.
          { id: "toolu_b", input: {}, name: "add_child", type: "tool_use" },
        ],
        role: "assistant",
      },
      {
        content: [
          { content: '{"success":true}', tool_use_id: "toolu_a", type: "tool_result" },
          {
            content: '{"success":false,"error":"bad"}',
            is_error: true,
            tool_use_id: "toolu_b",
            type: "tool_result",
          },
        ],
        role: "user",
      },
      { content: [{ text: "Thanks", type: "text" }], role: "user" },
    ]);
  });

  it("rewrites ids the API refuses, the same way on the call and its reply", () => {
    const request = toAnthropicRequest(
      v1Body({
        messages: [
          { content: "Go", role: "user" },
          {
            content: null,
            role: "assistant",
            tool_calls: [
              { function: { arguments: "{}", name: "a" }, id: "call:1" },
              { function: { arguments: "{}", name: "b" }, id: "call.1" },
              { function: { arguments: "[1]", name: "c" }, id: "toolu_call_1" },
            ],
          },
          { content: "ok", role: "tool", tool_call_id: "call:1" },
          { content: "ok", role: "tool", tool_call_id: "call.1" },
          { content: "ok", role: "tool", tool_call_id: "toolu_call_1" },
        ],
      }),
      COMPATIBLE,
    );
    const [, assistant, results] = request.messages;
    expect(assistant?.content.map((block) => ("id" in block ? block.id : ""))).toEqual([
      "toolu_call_1",
      "toolu_call_1_2",
      "toolu_call_1_3",
    ]);
    expect(
      results?.content.map((block) => ("tool_use_id" in block ? block.tool_use_id : "")),
    ).toEqual(["toolu_call_1", "toolu_call_1_2", "toolu_call_1_3"]);
    // An argument that parses to something other than an object is sent as `{}`.
    expect(assistant?.content[2]).toEqual({
      id: "toolu_call_1_3",
      input: {},
      name: "c",
      type: "tool_use",
    });
  });

  it("starts at a user message, drops a trailing assistant turn, and folds system messages", () => {
    const request = toAnthropicRequest(
      v1Body({
        messages: [
          {
            content: "",
            role: "assistant",
            tool_calls: [{ function: { arguments: "{}", name: "x" }, id: "t1" }],
          },
          { content: "orphan", role: "tool", tool_call_id: "t1" },
          { content: "Remember the brand.", role: "system" },
          {
            content: [
              { text: "Hello ", type: "text" },
              { type: "image_url" },
              { text: "there", type: "text" },
            ],
            role: "user",
          },
          { content: "Partial", role: "assistant" },
        ],
        systemPrompt: "Base.",
      }),
      COMPATIBLE,
    );
    expect(request.system).toEqual([{ text: "Base.\n\nRemember the brand.", type: "text" }]);
    expect(request.messages).toEqual([
      { content: [{ text: "Hello there", type: "text" }], role: "user" },
    ]);
  });

  it("skips what the API would refuse and what a body may carry that is not a message", () => {
    const request = toAnthropicRequest(
      v1Body({
        messages: [
          null,
          "text",
          { content: "", role: "user" },
          { content: 42, role: "user" },
          { content: "Real", role: "user" },
          { content: "", role: "assistant" },
          { content: null, role: "assistant", tool_calls: "nope" },
          {
            content: null,
            role: "assistant",
            tool_calls: [null, { id: "t" }, { function: { name: "n" } }, { function: {}, id: "u" }],
          },
          { content: "no id", role: "tool" },
          { content: "", role: "system" },
          { content: "unknown", role: "developer" },
        ],
        systemPrompt: 7,
        tools: [
          null,
          { type: "function" },
          { function: { name: "" } },
          { function: { description: "", name: "kept" } },
        ],
      }),
      COMPATIBLE,
    );
    expect(request.messages).toEqual([{ content: [{ text: "Real", type: "text" }], role: "user" }]);
    expect(request.system).toBeUndefined();
    expect(request.tools).toEqual([
      { input_schema: { properties: {}, type: "object" }, name: "kept" },
    ]);
  });

  it("sends no tools when the body has none, or none that is a function", () => {
    expect(toAnthropicRequest(v1Body({ tools: "all" }), COMPATIBLE).tools).toBeUndefined();
    expect(toAnthropicRequest(v1Body({ tools: [{}] }), COMPATIBLE).tools).toBeUndefined();
  });

  it("sends an empty history when no message can open one", () => {
    const request = toAnthropicRequest(
      v1Body({ messages: [{ content: "orphan", role: "tool", tool_call_id: "t" }] }),
      COMPATIBLE,
    );
    expect(request.messages).toEqual([]);
  });
});

describe("isFirstPartyAnthropic and anthropicHeaders", () => {
  it.each<[string, boolean]>([
    [ANTHROPIC_BASE_URL, true],
    ["https://API.anthropic.com/", true],
    ["https://anthropic.example", false],
    ["not a url", false],
  ])("%s is first-party: %p", (url, expected) => {
    expect(isFirstPartyAnthropic(url)).toBe(expected);
  });

  it("sends the key as x-api-key with the pinned version", () => {
    expect(anthropicHeaders("sk-ant")).toEqual({
      "Content-Type": "application/json",
      "anthropic-version": ANTHROPIC_API_VERSION,
      "x-api-key": "sk-ant",
    });
  });
});

// ─── Normalization ───────────────────────────────────────────────────────────

describe("normalizeAnthropicStream", () => {
  it("text, then usage and done: stop at message_stop", async () => {
    await expectFrames(
      sse(
        MESSAGE_START,
        { content_block: { text: "", type: "text" }, index: 0, type: "content_block_start" },
        { type: "ping" },
        { delta: { text: "Hel", type: "text_delta" }, index: 0, type: "content_block_delta" },
        { delta: { text: "lo", type: "text_delta" }, index: 0, type: "content_block_delta" },
        { index: 0, type: "content_block_stop" },
        stop("end_turn"),
        MESSAGE_STOP,
      ),
      [
        { content: "Hel", type: "delta" },
        { content: "lo", type: "delta" },
        usage(),
        { stopReason: "stop", type: "done" },
      ],
    );
  });

  it("interleaved thinking, signatures, redacted thinking and a tool call", async () => {
    await expectFrames(
      sse(
        MESSAGE_START,
        {
          content_block: { signature: "", thinking: "", type: "thinking" },
          index: 0,
          type: "content_block_start",
        },
        { delta: { thinking: "", type: "thinking_delta" }, index: 0, type: "content_block_delta" },
        {
          delta: { thinking: "Plan.", type: "thinking_delta" },
          index: 0,
          type: "content_block_delta",
        },
        {
          delta: { signature: "sig", type: "signature_delta" },
          index: 0,
          type: "content_block_delta",
        },
        { index: 0, type: "content_block_stop" },
        {
          content_block: { data: "x", type: "redacted_thinking" },
          index: 1,
          type: "content_block_start",
        },
        { index: 1, type: "content_block_stop" },
        { content_block: { text: "Sure. ", type: "text" }, index: 2, type: "content_block_start" },
        { index: 2, type: "content_block_stop" },
        {
          content_block: { id: "toolu_1", input: {}, name: "add_child", type: "tool_use" },
          index: 3,
          type: "content_block_start",
        },
        {
          delta: { partial_json: "", type: "input_json_delta" },
          index: 3,
          type: "content_block_delta",
        },
        {
          delta: { partial_json: '{"tag":', type: "input_json_delta" },
          index: 3,
          type: "content_block_delta",
        },
        {
          delta: { partial_json: '"h1"}', type: "input_json_delta" },
          index: 3,
          type: "content_block_delta",
        },
        { index: 3, type: "content_block_stop" },
        stop("tool_use", 40),
        MESSAGE_STOP,
      ),
      [
        { content: "Plan.", type: "reasoning" },
        { content: "Sure. ", type: "delta" },
        { id: "toolu_1", name: "add_child", type: "tool_call_start" },
        { args: '{"tag":', id: "toolu_1", type: "tool_call_delta" },
        { args: '"h1"}', id: "toolu_1", type: "tool_call_delta" },
        { id: "toolu_1", type: "tool_call_end" },
        usage(40),
        { stopReason: "tool_calls", type: "done" },
      ],
    );
  });

  it.each<[string, string]>([
    ["stop_sequence", "stop"],
    ["max_tokens", "length"],
    ["model_context_window_exceeded", "length"],
    ["pause_turn", "pause_turn"],
    ["refusal", "refusal"],
  ])("stop_reason %s is %s", async (reason, mapped) => {
    await expectFrames(sse(MESSAGE_START, stop(reason), MESSAGE_STOP), [
      usage(),
      { stopReason: mapped, type: "done" },
    ]);
  });

  it("a body that ends without message_stop closes open calls, then usage and done", async () => {
    await expectFrames(
      sse(
        MESSAGE_START,
        {
          content_block: { id: "toolu_9", type: "tool_use" },
          index: 0,
          type: "content_block_start",
        },
        {
          delta: { partial_json: "{}", type: "input_json_delta" },
          index: 0,
          type: "content_block_delta",
        },
      ),
      [
        { id: "toolu_9", name: "", type: "tool_call_start" },
        { args: "{}", id: "toolu_9", type: "tool_call_delta" },
        { id: "toolu_9", type: "tool_call_end" },
        { cachedInputTokens: 90, inputTokens: 105, outputTokens: 0, type: "usage" },
        { stopReason: "stop", type: "done" },
      ],
    );
  });

  it("reports no usage frame without an input count, and reads data: with no space", async () => {
    await expectFrames(
      sse(
        'data:{"type":"message_start","message":{}}',
        { delta: { text: "x", type: "text_delta" }, index: 0, type: "content_block_delta" },
        { type: "message_delta", usage: { input_tokens: "n" } },
        "data: not json",
        "data: null",
        "event: ping",
        MESSAGE_STOP,
      ),
      [
        { content: "x", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    );
  });

  it("counts input without cache figures, and keeps the latest cumulative count", async () => {
    await expectFrames(
      sse(
        { message: { usage: { input_tokens: 7, output_tokens: 1 } }, type: "message_start" },
        { type: "message_delta", usage: { cache_read_input_tokens: null, output_tokens: 3 } },
        { delta: {}, type: "message_delta", usage: { input_tokens: 8, output_tokens: 4 } },
        MESSAGE_STOP,
      ),
      [
        { inputTokens: 8, outputTokens: 4, type: "usage" },
        { stopReason: "stop", type: "done" },
      ],
    );
  });

  it("ignores deltas and stops for blocks it never opened, and malformed members", async () => {
    await expectFrames(
      sse(
        { content_block: "x", index: 0, type: "content_block_start" },
        { content_block: { type: "tool_use" }, index: 0, type: "content_block_start" },
        { content_block: { text: 5, type: "text" }, index: 0, type: "content_block_start" },
        { delta: "x", index: 0, type: "content_block_delta" },
        {
          delta: { partial_json: "{}", type: "input_json_delta" },
          index: 4,
          type: "content_block_delta",
        },
        { delta: { text: "", type: "text_delta" }, index: 0, type: "content_block_delta" },
        { delta: { type: "citations_delta" }, index: 0, type: "content_block_delta" },
        { index: 4, type: "content_block_stop" },
        { type: "content_block_stop" },
        { delta: { stop_reason: null }, type: "message_delta" },
        MESSAGE_STOP,
      ),
      [{ stopReason: "stop", type: "done" }],
    );
  });

  it("an error event is an error frame carrying the API's error type, and ends the stream", async () => {
    const message = "Overloaded";
    const bytes = new TextEncoder().encode(
      sse(
        MESSAGE_START,
        { error: { message, type: "overloaded_error" }, type: "error" },
        { delta: { text: "never", type: "text_delta" }, index: 0, type: "content_block_delta" },
      ),
    );
    // A body that stays open, so the cancel reaches it: a closed one would swallow it.
    let cancels = 0;
    let sent = false;
    const open = new ReadableStream<Uint8Array>({
      cancel() {
        cancels += 1;
      },
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(bytes);
        }
      },
    });
    const frames = await collect(normalizeAnthropicStream(new Response(open, { status: 200 })));
    expect(frames).toEqual([
      {
        code: "overloaded_error",
        message,
        problem: problemDetails("upstreamFailure", message),
        type: "error",
      },
    ]);
    expect(cancels).toBe(1);
  });

  it("an error event with nothing in it still says something", async () => {
    await expectFrames(sse({ type: "error" }), [
      {
        message: "Upstream error",
        problem: problemDetails("upstreamFailure", "Upstream error"),
        type: "error",
      },
    ]);
  });

  it("a non-2xx response is one error frame with the API's sentence and status", async () => {
    const response = Response.json(
      { error: { message: "invalid x-api-key", type: "authentication_error" }, type: "error" },
      { status: 401 },
    );
    expect(await collect(normalizeAnthropicStream(response))).toEqual([
      {
        code: "401",
        message: "invalid x-api-key",
        problem: problemDetails("unauthorized", "invalid x-api-key"),
        type: "error",
      },
    ]);
  });

  it("a 200 with no body is an upstreamFailure", async () => {
    const frames = await collect(normalizeAnthropicStream(new Response(null, { status: 200 })));
    expect(frames).toEqual([
      {
        message: "No response body from upstream",
        problem: problemDetails("upstreamFailure", "No response body from upstream"),
        type: "error",
      },
    ]);
  });

  it("a read that fails is a stream error; an aborted one is done: cancelled", async () => {
    for (const [error, expected] of [
      [
        new Error("connection reset"),
        {
          message: "Stream error: connection reset",
          problem: problemDetails("upstreamFailure", "Stream error: connection reset"),
          type: "error",
        },
      ],
      [
        Object.assign(new Error("aborted"), { name: "AbortError" }),
        { stopReason: "cancelled", type: "done" },
      ],
    ] as const) {
      let cancelled = 0;
      const reader = {
        cancel: () => {
          cancelled += 1;
          return Promise.resolve();
        },
        read: (): Promise<ReadableStreamReadResult<Uint8Array>> => Promise.reject(error),
      };
      /* SAFETY: the normalizer reads only `ok` and `body.getReader()` of a 200 response, and only
         `read()` and `cancel()` of that reader. */
      const response = { body: { getReader: () => reader }, ok: true, status: 200 } as Response;
      expect(await collect(normalizeAnthropicStream(response))).toEqual([expected]);
      expect(cancelled).toBe(1);
    }
  });

  it("a consumer that stops reading cancels the upstream; one that finished does not", async () => {
    const text = sse(MESSAGE_START, {
      delta: { text: "Hi", type: "text_delta" },
      index: 0,
      type: "content_block_delta",
    });
    const encoder = new TextEncoder();
    let cancels = 0;
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancels += 1;
      },
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(encoder.encode(text));
        }
      },
    });
    const frames = normalizeAnthropicStream(new Response(body, { status: 200 }));
    expect(await frames.next()).toEqual({ done: false, value: { content: "Hi", type: "delta" } });
    await frames.return(null);
    expect(cancels).toBe(1);

    const finished = upstream([encoder.encode(sse(MESSAGE_STOP))]);
    await collect(normalizeAnthropicStream(finished.response));
    expect(finished.cancels()).toBe(0);
  });
});

// ─── Model listing ───────────────────────────────────────────────────────────

/** A fetch double answering each call with the next response, recording the URLs and headers. */
function listingFetch(...answers: (Response | Error)[]) {
  const calls: { url: string; headers: HeadersInit | undefined }[] = [];
  const impl = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ headers: init?.headers, url: String(input) });
      const answer = answers.shift();
      if (answer instanceof Error) {
        return Promise.reject(answer);
      }
      return Promise.resolve(answer ?? new Response("{}"));
    },
    { preconnect: fetch.preconnect },
  );
  return { calls, impl };
}

const UPSTREAM_KEY = { apiKey: "sk-ant", baseUrl: "https://anthropic.example" };

describe("listAnthropicModels", () => {
  it("follows has_more, and names each model by its display name and context window", async () => {
    const { calls, impl } = listingFetch(
      Response.json({
        data: [
          { display_name: "Claude Opus 5.5", id: "claude-opus-5-5", max_input_tokens: 1_000_000 },
          { id: "claude-haiku-4-5", max_input_tokens: 0 },
          { id: "" },
          null,
        ],
        has_more: true,
        last_id: "claude-haiku-4-5",
      }),
      Response.json({ data: [{ display_name: "", id: "claude-x" }], has_more: false }),
    );
    expect(await listAnthropicModels(UPSTREAM_KEY, impl)).toEqual({
      models: [
        { contextWindow: 1_000_000, id: "claude-opus-5-5", name: "Claude Opus 5.5" },
        { id: "claude-haiku-4-5", name: "claude-haiku-4-5" },
        { id: "claude-x", name: "claude-x" },
      ],
      ok: true,
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://anthropic.example/v1/models?limit=1000",
      "https://anthropic.example/v1/models?limit=1000&after_id=claude-haiku-4-5",
    ]);
    expect(calls[0]?.headers).toEqual({ ...anthropicHeaders("sk-ant") });
  });

  it("stops at a page with no last_id, and at the page limit", async () => {
    const endless = Array.from({ length: 12 }, (_, page) =>
      Response.json({
        data: [{ id: `m${String(page)}` }],
        has_more: true,
        last_id: `m${String(page)}`,
      }),
    );
    const { calls, impl } = listingFetch(...endless);
    const listing = await listAnthropicModels(UPSTREAM_KEY, impl);
    expect(calls).toHaveLength(10);
    expect(listing.ok && listing.models).toHaveLength(10);

    const unpaged = listingFetch(Response.json({ data: "none", has_more: true }));
    expect(await listAnthropicModels(UPSTREAM_KEY, unpaged.impl)).toEqual({ models: [], ok: true });
    const empty = listingFetch(Response.json(null));
    expect(await listAnthropicModels(UPSTREAM_KEY, empty.impl)).toEqual({ models: [], ok: true });
  });

  it("reports a refused page with its status and sentence", async () => {
    const { impl } = listingFetch(
      Response.json({ error: { message: "invalid x-api-key" }, type: "error" }, { status: 401 }),
    );
    expect(await listAnthropicModels(UPSTREAM_KEY, impl)).toEqual({
      message: "invalid x-api-key",
      ok: false,
      upstreamError: 401,
    });
  });

  it("reports a body it cannot read as the status's failure", async () => {
    const failing = new Response("x", { status: 500 });
    Object.defineProperty(failing, "text", { value: () => Promise.reject(new Error("gone")) });
    expect(await listAnthropicModels(UPSTREAM_KEY, listingFetch(failing).impl)).toEqual({
      message: "",
      ok: false,
      upstreamError: 500,
    });
    const garbled = listingFetch(new Response("not json"));
    const listing = await listAnthropicModels(UPSTREAM_KEY, garbled.impl);
    expect(listing.ok).toBe(false);
    expect(!listing.ok && listing.upstreamError).toBe(200);
  });

  it("reports a request that never got a response as a network failure", async () => {
    const unreachable = listingFetch(new Error("ENOTFOUND"));
    expect(await listAnthropicModels(UPSTREAM_KEY, unreachable.impl)).toEqual({
      message: "ENOTFOUND",
      ok: false,
      upstreamError: "network",
    });
    // oxlint-disable-next-line prefer-promise-reject-errors -- the non-Error branch is under test
    const odd = Object.assign(() => Promise.reject("refused"), { preconnect: fetch.preconnect });
    expect(await listAnthropicModels(UPSTREAM_KEY, odd)).toEqual({
      message: "refused",
      ok: false,
      upstreamError: "network",
    });
  });

  it("uses the global fetch when none is given", async () => {
    const original = globalThis.fetch;
    const { calls, impl } = listingFetch(Response.json({ data: [] }));
    globalThis.fetch = impl;
    try {
      expect(await listAnthropicModels(UPSTREAM_KEY)).toEqual({ models: [], ok: true });
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toHaveLength(1);
  });
});

// ─── The chat route's anthropic branch ───────────────────────────────────────

const ANTHROPIC: Upstream = {
  apiKey: "sk-ant",
  baseUrl: ANTHROPIC_BASE_URL,
  defaultModel: "claude-opus-5-5",
  family: "anthropic",
  managed: false,
  sessionAffinity: "a".repeat(32),
};

describe("createChatHandler: an anthropic upstream", () => {
  it("posts the projected body to /v1/messages and streams the normalized frames", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const stream = sse(
      MESSAGE_START,
      { delta: { text: "Hi", type: "text_delta" }, index: 0, type: "content_block_delta" },
      stop("end_turn"),
      MESSAGE_STOP,
    );
    const handler = createChatHandler<{ readonly signal: AbortSignal }>({
      fetch: Object.assign(
        (input: string | URL | Request, init?: RequestInit) => {
          calls.push({ init, url: String(input) });
          return Promise.resolve(new Response(stream));
        },
        { preconnect: fetch.preconnect },
      ),
      resolveUpstream: () => ANTHROPIC,
    });
    const chatBody: JsonValue = {
      messages: [{ content: "Hello", role: "user" }],
      systemPrompt: "Be brief.",
      tools: [],
    };
    const response = await handler(
      new Request("http://gateway.test/ai/chat", {
        body: JSON.stringify(chatBody),
        method: "POST",
      }),
      { signal: new AbortController().signal },
    );
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const text = await response.text();
    /* SAFETY: every `data:` line the route writes is one StreamEvent (`encodeSse`). */
    const frames = text
      .split("\n\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line.slice("data: ".length)) as StreamEvent);
    expect(frames).toEqual([
      { content: "Hi", type: "delta" },
      usage(),
      { stopReason: "stop", type: "done" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${ANTHROPIC_BASE_URL}/v1/messages`);
    expect(calls[0]?.init?.headers).toEqual({ ...anthropicHeaders("sk-ant") });
    /* SAFETY: the gateway's only upstream body is JSON.stringify of its request object. */
    const sent = JSON.parse(String(calls[0]?.init?.body)) as JsonObject;
    // The upstream's default model, and no affinity hint: Anthropic's cache needs none.
    expect(sent).toEqual({
      cache_control: { type: "ephemeral" },
      max_tokens: ANTHROPIC_MAX_TOKENS,
      messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      model: "claude-opus-5-5",
      stream: true,
      system: [{ text: "Be brief.", type: "text" }],
    });
  });

  it("an upstream that cannot be reached is the network-error frame", async () => {
    const handler = createChatHandler<{ readonly signal: AbortSignal }>({
      fetch: Object.assign(() => Promise.reject(new Error("ECONNREFUSED")), {
        preconnect: fetch.preconnect,
      }),
      resolveUpstream: () => ({ ...ANTHROPIC, baseUrl: "https://anthropic.example" }),
    });
    const response = await handler(
      new Request("http://gateway.test/ai/chat", {
        body: JSON.stringify({ messages: [], model: "claude-sonnet-5-5" }),
        method: "POST",
      }),
      { signal: new AbortController().signal },
    );
    expect(await response.text()).toContain("Network error: ECONNREFUSED");
  });
});
