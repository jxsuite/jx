/**
 * Tests for the gateway's OpenAI-compatible stream normalizer (`normalizeOpenAIStream`) and the
 * frame for an upstream that never answered (`fetchFailureFrame`).
 *
 * The normalizer was moved here from `@jxsuite/server` verbatim, and the server's recorded fixtures
 * (`packages/server/tests/ai-upstream-fixtures.test.ts`) prove that end to end. This suite pins the
 * same behaviour at the unit, case by case, so the file carries its own coverage: every body below
 * is fed whole, one line at a time and one byte at a time, and must yield the same frames each
 * way.
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import { problemDetails } from "@jxsuite/protocol";
import { fetchFailureFrame, normalizeOpenAIStream } from "../src/gateway/normalize.ts";
import type { StreamEvent } from "../src/streaming-client.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** An SSE body of `data:` lines, one per chunk (a string is sent as written). */
function sse(...chunks: (object | string)[]): string {
  return chunks
    .map((chunk) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`)
    .join("");
}

/** A chat-completions chunk carrying one choice. */
const choice = (delta: object, finish?: string | null): object => ({
  choices: [{ delta, finish_reason: finish ?? null, index: 0 }],
});

const CHUNKINGS: Record<string, (bytes: Uint8Array) => Uint8Array[]> = {
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
};

/** A 200 upstream whose body arrives in `chunks`. */
function upstream(chunks: Uint8Array[]): Response {
  let next = 0;
  const body = new ReadableStream<Uint8Array>({
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
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

async function collect(frames: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const frame of frames) {
    out.push(frame);
  }
  return out;
}

/** The frames, as the wire bytes the proxy writes, so member order counts. */
const wire = (frames: StreamEvent[]): string[] => frames.map((frame) => JSON.stringify(frame));

/**
 * A 200 upstream whose reader yields `first`, then rejects with `error`. A plain object stands in
 * for the Response, as in the server's own suite: a real one would surface the rejection early.
 */
function failingUpstream(first: string, error: unknown): { response: Response; cancels: number[] } {
  const cancels: number[] = [];
  let reads = 0;
  const reader = {
    cancel: () => {
      cancels.push(reads);
      return Promise.resolve();
    },
    read: () => {
      reads += 1;
      if (reads === 1) {
        return Promise.resolve({ done: false, value: new TextEncoder().encode(first) });
      }
      return Promise.reject(error);
    },
  };
  const response = { body: { getReader: () => reader }, ok: true, status: 200 };
  return { cancels, response: response as unknown as Response };
}

// ─── A 200 stream ────────────────────────────────────────────────────────────

const DONE_STOP: StreamEvent = { type: "done", stopReason: "stop" };

const STREAMS: readonly (readonly [label: string, body: string, frames: StreamEvent[]])[] = [
  [
    "text deltas and a stop finish",
    sse(choice({ content: "Hello" }), choice({ content: " world" }), choice({}, "stop"), "[DONE]"),
    [{ type: "delta", content: "Hello" }, { type: "delta", content: " world" }, DONE_STOP],
  ],
  ["an empty body is a bare done", "", [DONE_STOP]],
  [
    "a body that ends without [DONE] still finishes",
    sse(choice({ content: "a" })),
    [{ type: "delta", content: "a" }, DONE_STOP],
  ],
  [
    "reasoning under either name, and an empty one is not a frame",
    sse(
      choice({ reasoning_content: "Weighing it" }),
      choice({ reasoning: "and again" }),
      choice({ content: "Hi", reasoning_content: "" }),
      choice({ reasoning: "" }),
    ),
    [
      { type: "reasoning", content: "Weighing it" },
      { type: "reasoning", content: "and again" },
      { type: "delta", content: "Hi" },
      DONE_STOP,
    ],
  ],
  [
    "a tool call across fragments, closed by its finish",
    sse(
      choice({
        tool_calls: [{ function: { arguments: '{"a"', name: "set" }, id: "c1", index: 0 }],
      }),
      choice({ tool_calls: [{ function: { arguments: ":1}" }, index: 0 }] }),
      choice({}, "tool_calls"),
    ),
    [
      { type: "tool_call_start", id: "c1", name: "set" },
      { type: "tool_call_delta", id: "c1", args: '{"a"' },
      { type: "tool_call_delta", id: "c1", args: ":1}" },
      { type: "tool_call_end", id: "c1" },
      { type: "done", stopReason: "tool_calls" },
    ],
  ],
  [
    "a call opened with no name or arguments, a fragment for no open call, and an empty fragment",
    sse(
      choice({ tool_calls: [{ id: "c2", index: 0 }] }),
      choice({ tool_calls: [{ function: { arguments: "{}" }, index: 7 }] }),
      choice({ tool_calls: [{ function: {}, index: 0 }] }),
    ),
    [
      { type: "tool_call_start", id: "c2", name: "" },
      { type: "tool_call_end", id: "c2" },
      DONE_STOP,
    ],
  ],
  [
    "parallel calls close in the order they opened",
    sse(
      choice({
        tool_calls: [
          { function: { name: "a" }, id: "c1", index: 0 },
          { function: { name: "b" }, id: "c2", index: 1 },
        ],
      }),
      "[DONE]",
    ),
    [
      { type: "tool_call_start", id: "c1", name: "a" },
      { type: "tool_call_start", id: "c2", name: "b" },
      { type: "tool_call_end", id: "c1" },
      { type: "tool_call_end", id: "c2" },
      DONE_STOP,
    ],
  ],
  [
    "an id repeated on a later chunk starts the call again",
    sse(
      choice({ tool_calls: [{ function: { name: "t" }, id: "c1", index: 0 }] }),
      choice({ tool_calls: [{ function: { arguments: "{}" }, id: "c1", index: 0 }] }),
    ),
    [
      { type: "tool_call_start", id: "c1", name: "t" },
      { type: "tool_call_start", id: "c1", name: "" },
      { type: "tool_call_delta", id: "c1", args: "{}" },
      { type: "tool_call_end", id: "c1" },
      DONE_STOP,
    ],
  ],
  [
    "the count after the finish is sent, immediately before done",
    sse(
      choice({ content: "Hi" }),
      choice({}, "tool_calls"),
      {
        choices: [],
        usage: {
          completion_tokens: 7,
          completion_tokens_details: { reasoning_tokens: 3 },
          prompt_tokens: 812,
          prompt_tokens_details: { cached_tokens: 512 },
        },
      },
      "[DONE]",
    ),
    [
      { type: "delta", content: "Hi" },
      {
        type: "usage",
        inputTokens: 812,
        outputTokens: 7,
        cachedInputTokens: 512,
        reasoningTokens: 3,
      },
      { type: "done", stopReason: "tool_calls" },
    ],
  ],
  [
    "a count beside the finish, with no output figure",
    sse({
      choices: [{ delta: { content: "a" }, finish_reason: "length" }],
      usage: { prompt_tokens: 4 },
    }),
    [
      { type: "delta", content: "a" },
      { type: "usage", inputTokens: 4, outputTokens: 0 },
      { type: "done", stopReason: "length" },
    ],
  ],
  [
    "a null usage, a count with no input figure and null details send no count",
    sse(
      { choices: [{ finish_reason: "stop" }], usage: null },
      { choices: [], usage: { completion_tokens: 2 } },
    ),
    [DONE_STOP],
  ],
  [
    "null details are 'not said', not zero",
    sse({
      choices: [],
      usage: {
        completion_tokens: 1,
        completion_tokens_details: null,
        prompt_tokens: 2,
        prompt_tokens_details: null,
      },
    }),
    [{ type: "usage", inputTokens: 2, outputTokens: 1 }, DONE_STOP],
  ],
  [
    "a later count replaces an earlier one",
    sse(
      { choices: [], usage: { completion_tokens: 1, prompt_tokens: 1 } },
      { choices: [], usage: { completion_tokens: 9, prompt_tokens: 9 } },
    ),
    [{ type: "usage", inputTokens: 9, outputTokens: 9 }, DONE_STOP],
  ],
  [
    "a finish the stream does not report keeps it reading",
    sse(choice({}, "content_filter"), choice({ content: "more" })),
    [{ type: "delta", content: "more" }, DONE_STOP],
  ],
  [
    "lines that are not data, and data that is not JSON, are skipped",
    [
      ": a comment",
      "event: message",
      "data:{no space}",
      "data: {not json",
      "",
      `data: ${JSON.stringify(choice({ content: "kept" }))}`,
      "",
    ].join("\n"),
    [{ type: "delta", content: "kept" }, DONE_STOP],
  ],
  [
    "a chunk with no choices is skipped",
    sse({ id: "x" }, { choices: [] }, choice({ content: "a" })),
    [{ type: "delta", content: "a" }, DONE_STOP],
  ],
  [
    "anything after [DONE] is ignored",
    sse(choice({ content: "a" }), "[DONE]", choice({ content: "ignored" })),
    [{ type: "delta", content: "a" }, DONE_STOP],
  ],
  [
    "CRLF line endings",
    `data: ${JSON.stringify(choice({ content: "a" }))}\r\n\r\ndata: [DONE]\r\n\r\n`,
    [{ type: "delta", content: "a" }, DONE_STOP],
  ],
  [
    "a last line with no newline is never read (the server's behaviour, kept verbatim)",
    `data: ${JSON.stringify(choice({ content: "a" }))}\n\ndata: ${JSON.stringify(choice({ content: "lost" }))}`,
    [{ type: "delta", content: "a" }, DONE_STOP],
  ],
  [
    "multi-byte text split anywhere decodes whole",
    sse(choice({ content: "héllo ✓ 🙂" })),
    [{ type: "delta", content: "héllo ✓ 🙂" }, DONE_STOP],
  ],
];

describe("normalizeOpenAIStream: a 200 stream", () => {
  for (const [label, body, frames] of STREAMS) {
    it(label, async () => {
      const bytes = new TextEncoder().encode(body);
      for (const [name, split] of Object.entries(CHUNKINGS)) {
        const response = upstream(split(bytes));
        const actual = await collect(normalizeOpenAIStream(response));
        expect({ chunking: name, frames: wire(actual) }).toEqual({
          chunking: name,
          frames: wire(frames),
        });
      }
    });
  }
});

// ─── A failed stream ─────────────────────────────────────────────────────────

describe("normalizeOpenAIStream: an upstream that refuses", () => {
  it.each<[string, Response, string]>([
    [
      "OpenAI's error object",
      Response.json({ error: { message: "Incorrect API key" } }, { status: 401 }),
      "Incorrect API key",
    ],
    [
      "Cloudflare's errors array",
      Response.json({ errors: [{ message: "No route for that URI" }] }, { status: 404 }),
      "No route for that URI",
    ],
    [
      "an empty body, which says the status text",
      new Response("", { status: 502, statusText: "Bad Gateway" }),
      "Bad Gateway",
    ],
  ])("%s is one error frame keeping the upstream's status", async (_label, response, message) => {
    const frames = await collect(normalizeOpenAIStream(response));
    const { status } = response;
    const kind = status === 401 ? "unauthorized" : status === 404 ? "notFound" : "upstreamFailure";
    expect(wire(frames)).toEqual(
      wire([
        { code: String(status), message, problem: problemDetails(kind, message), type: "error" },
      ]),
    );
  });

  it("a body that cannot be read says the status text", async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.reject(new Error("gone")),
    } as unknown as Response;
    const frames = await collect(normalizeOpenAIStream(response));
    expect(frames).toEqual([
      {
        code: "500",
        message: "Internal Server Error",
        problem: problemDetails("internalError", "Internal Server Error"),
        type: "error",
      },
    ]);
  });

  it("a 200 with no body is an error frame", async () => {
    const frames = await collect(normalizeOpenAIStream(new Response(null, { status: 200 })));
    expect(wire(frames)).toEqual(
      wire([
        {
          message: "No response body from upstream",
          problem: problemDetails("upstreamFailure", "No response body from upstream"),
          type: "error",
        },
      ]),
    );
  });
});

describe("normalizeOpenAIStream: a read that fails mid-stream", () => {
  const first = sse(choice({ content: "Hi" }));

  it("an abort ends the stream cancelled, and the reader is cancelled", async () => {
    const abort = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    const { cancels, response } = failingUpstream(first, abort);
    const frames = await collect(normalizeOpenAIStream(response));
    expect(frames).toEqual([
      { type: "delta", content: "Hi" },
      { type: "done", stopReason: "cancelled" },
    ]);
    expect(cancels).toEqual([2]);
  });

  it("any other failure is an error frame with an upstreamFailure problem", async () => {
    const { cancels, response } = failingUpstream(first, new Error("connection reset"));
    const frames = await collect(normalizeOpenAIStream(response));
    const message = "Stream error: connection reset";
    expect(wire(frames)).toEqual(
      wire([
        { type: "delta", content: "Hi" },
        { message, problem: problemDetails("upstreamFailure", message), type: "error" },
      ]),
    );
    expect(cancels).toEqual([2]);
  });

  it("a chunk the normalizer cannot read is a stream error too", async () => {
    const bytes = new TextEncoder().encode(sse(choice({ content: "a" }), "null"));
    const response = upstream([bytes]);
    const frames = await collect(normalizeOpenAIStream(response));
    expect(frames[0]).toEqual({ type: "delta", content: "a" });
    expect(frames).toHaveLength(2);
    const error = frames[1] as { message: string; problem: { type: string }; type: string };
    expect(error.type).toBe("error");
    // The engine's own sentence; the server's golden (null-chunk) pins its exact text.
    expect(error.message).toStartWith("Stream error: ");
    expect(error.problem.type).toBe(problemDetails("upstreamFailure").type);
  });
});

/* A consumer that stops reading (a client that cancelled the chat body) ends the generator through
   `return()`. When the server wrote each frame itself, that exit was the next write throwing inside
   the read loop, whose catch cancelled the upstream; the upstream must not outlive its reader now
   either. */
describe("normalizeOpenAIStream: a consumer that stops reading", () => {
  /** A 200 upstream that sends `chunks` and then either ends or waits, counting its cancels. */
  function countedUpstream(
    chunks: string[],
    end: boolean,
  ): { response: Response; cancels: () => number } {
    const encoder = new TextEncoder();
    let cancels = 0;
    let next = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancels += 1;
      },
      pull(controller) {
        const chunk = chunks[next];
        next += 1;
        if (chunk !== undefined) {
          controller.enqueue(encoder.encode(chunk));
        } else if (end) {
          controller.close();
        }
      },
    });
    return { cancels: () => cancels, response: new Response(body, { status: 200 }) };
  }

  it("cancels the upstream body", async () => {
    const { cancels, response } = countedUpstream([sse(choice({ content: "Hi" }))], false);
    const frames = normalizeOpenAIStream(response);
    expect(await frames.next()).toEqual({ done: false, value: { type: "delta", content: "Hi" } });
    await frames.return(null);
    expect(cancels()).toBe(1);
  });

  /* `[DONE]` ends the stream while the upstream body is still open, which is the case a cancel would
     reach; a body that ended is closed, and cancelling it would be a no-op either way. */
  it.each<[string, string[], boolean]>([
    ["at [DONE]", [sse(choice({ content: "Hi" }), "[DONE]")], false],
    ["when the body ends", [sse(choice({ content: "Hi" }))], true],
  ])("a stream that ended on its own %s is not cancelled", async (_label, chunks, end) => {
    const { cancels, response } = countedUpstream(chunks, end);
    expect(await collect(normalizeOpenAIStream(response))).toEqual([
      { type: "delta", content: "Hi" },
      DONE_STOP,
    ]);
    expect(cancels()).toBe(0);
  });
});

// ─── No response at all ──────────────────────────────────────────────────────

describe("fetchFailureFrame", () => {
  it("an aborted request is done: cancelled", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(fetchFailureFrame(abort)).toEqual({ type: "done", stopReason: "cancelled" });
  });

  it("any other failure is a network error carrying an upstreamFailure problem", () => {
    const message = "Network error: getaddrinfo ENOTFOUND";
    const frame = fetchFailureFrame(new Error("getaddrinfo ENOTFOUND"));
    expect(wire([frame])).toEqual(
      wire([{ message, problem: problemDetails("upstreamFailure", message), type: "error" }]),
    );
  });
});
