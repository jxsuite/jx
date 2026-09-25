/**
 * Tests for the gateway's SSE framing (`encodeSse`, `SSE_HEADERS`).
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import { encodeSse, SSE_HEADERS } from "../src/gateway/sse.ts";
import type { StreamEvent } from "../src/streaming-client.ts";

async function* fromArray(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const event of events) {
    yield event;
  }
}

const text = (stream: ReadableStream<Uint8Array>): Promise<string> => new Response(stream).text();

describe("encodeSse", () => {
  it.each<[string, StreamEvent[], string]>([
    ["no frames is an empty body", [], ""],
    [
      "one frame is one data line and a blank line",
      [{ type: "done", stopReason: "stop" }],
      'data: {"type":"done","stopReason":"stop"}\n\n',
    ],
    [
      "frames keep their order and their member order",
      [
        { type: "delta", content: "Hi" },
        { code: "429", message: "slow", type: "error" },
        { type: "done", stopReason: "stop" },
      ],
      [
        'data: {"type":"delta","content":"Hi"}\n\n',
        'data: {"code":"429","message":"slow","type":"error"}\n\n',
        'data: {"type":"done","stopReason":"stop"}\n\n',
      ].join(""),
    ],
    [
      "a newline inside a frame is escaped, so a frame is always one line",
      [{ type: "delta", content: "a\nb" }],
      'data: {"type":"delta","content":"a\\nb"}\n\n',
    ],
    [
      "non-ASCII text is sent as UTF-8",
      [{ type: "delta", content: "héllo ✓" }],
      'data: {"type":"delta","content":"héllo ✓"}\n\n',
    ],
  ])("%s", async (_label, events, wire) => {
    const stream = encodeSse(fromArray(events));
    expect(await text(stream)).toBe(wire);
  });

  it("starts iterating when the stream is built, before anything reads it", async () => {
    const started: string[] = [];
    async function* events(): AsyncGenerator<StreamEvent> {
      started.push("started");
      yield { type: "done", stopReason: "stop" };
    }
    const stream = encodeSse(events());
    expect(started).toEqual(["started"]);
    expect(await text(stream)).toBe('data: {"type":"done","stopReason":"stop"}\n\n');
  });

  it("errors the stream when the frames throw", async () => {
    async function* events(): AsyncGenerator<StreamEvent> {
      yield { type: "delta", content: "a" };
      throw new Error("frames failed");
    }
    const reader = encodeSse(events()).getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('data: {"type":"delta","content":"a"}\n\n');
    const failure = await reader.read().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("frames failed");
  });
});

describe("SSE_HEADERS", () => {
  it("names an uncached event stream", () => {
    expect(SSE_HEADERS).toEqual({
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
  });
});
