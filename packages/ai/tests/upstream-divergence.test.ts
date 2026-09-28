/**
 * The direct client's SSE normalizer, frozen against the proxy's upstream fixtures (the v1 freeze
 * taken before the harness refactor), and the list of places where the two normalizers disagree.
 *
 * There are two OpenAI-compatible normalizers today: the proxy's (`packages/server/src/ai-api.ts`,
 * behind POST /__studio/ai/chat) and `createOpenAIStreamingClient` here. This suite feeds the SAME
 * upstream bodies, `packages/server/tests/fixtures/ai-upstream/<name>.sse`, through the client and
 * compares its events with `<name>.client.json` beside them. It then reads the proxy's committed
 * `<name>.server.json` and asserts that the fixtures where the two differ, and the members that
 * differ, are exactly `EXPECTED_DIVERGENCE` below. A later slice converges them, and that table is
 * what it empties.
 *
 * The fixture format, the chunking check and the golden rules are those of
 * `packages/server/tests/ai-upstream-fixtures.test.ts`, which owns the fixtures. The loading and
 * comparison helpers are mirrored from it rather than shared: each suite runs from its own
 * workspace, and `packages/ai` cannot import `packages/server` (the dependency runs the other
 * way).
 *
 * Re-record: first the server goldens (`JX_UPDATE_GOLDENS=1 bun test --isolate
 * tests/ai-upstream-fixtures.test.ts` from `packages/server`), then `JX_UPDATE_GOLDENS=1 bun test
 * --isolate tests/upstream-divergence.test.ts` from `packages/ai`. The divergence table is never
 * re-recorded: it is written by hand, because a change to it is a decision.
 *
 * @module @jxsuite/ai/tests
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createOpenAIStreamingClient } from "../src/streaming-client.ts";
import type { StreamEvent } from "../src/streaming-client.ts";

const FIXTURES = join(import.meta.dir, "..", "..", "server", "tests", "fixtures", "ai-upstream");
const UPDATE = process.env.JX_UPDATE_GOLDENS === "1";
const RERECORD = "JX_UPDATE_GOLDENS=1 bun test --isolate tests/upstream-divergence.test.ts";

const NAMES = readdirSync(FIXTURES)
  .filter((file) => file.endsWith(".sse"))
  .map((file) => file.slice(0, -".sse".length))
  .toSorted();

/*
 * Where the proxy and the client turn the SAME upstream body into different frames, keyed by fixture,
 * with every member path that differs (member order ignored). A fixture absent from this table
 * produces identical frames on both sides.
 *
 * Across this corpus, today's divergence is two differences, both on error frames. One
 * normaliser (specs/ai.md §2.4) removes both, by moving the client onto the proxy's frames: the clean message,
 * `code` and `problem`. The table is complete for what a fixture can express, which is an upstream
 * RESPONSE. It cannot express a request that never gets one — `fetch` rejecting before any body —
 * and the two sides differ there too (the proxy attaches a `problem` to its network-error frame);
 * `packages/server/tests/ai-api.test.ts` and `tests/streaming-client.test.ts` pin those.
 *
 *   1. An upstream HTTP error. The proxy forwards the message it extracted from the provider's body
 *      (or the status text, for an empty one) and attaches an RFC 9457 `problem`. The client
 *      prefixes `API error <status>: ` to the same message and attaches no `problem`. Both carry
 *      `code: "<status>"`.
 *   2. A failure while reading the stream: a chunk the normalizer throws on, or a connection reset.
 *      The `Stream error: …` message is the same on both sides; only the proxy attaches `problem`.
 *
 * An abort mid-stream is NOT a divergence: both sides end with `done: cancelled`.
 */
const EXPECTED_DIVERGENCE: Record<string, string[]> = {
  // 1. Upstream HTTP errors: the message format, and the proxy's `problem`.
  "http-401-error-object": ["$[0].message", "$[0].problem"],
  "http-403-cloudflare-errors": ["$[0].message", "$[0].problem"],
  "http-429-error-string": ["$[0].message", "$[0].problem"],
  "http-500-plain-text": ["$[0].message", "$[0].problem"],
  "http-502-empty-body": ["$[0].message", "$[0].problem"],
  // 2. Mid-stream failures: only the proxy's `problem`.
  "null-chunk": ["$[1].problem"],
  "reset-mid-stream": ["$[3].problem"],
};

// ─── Fixture loading (mirrored from packages/server/tests/ai-upstream-fixtures.test.ts) ──────────

interface Fault {
  name: string;
  message: string;
}

interface UpstreamFixture {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Uint8Array;
  fault: Fault | null;
}

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.sse`), "utf8");
}

function parseFixture(raw: string): UpstreamFixture {
  const encoder = new TextEncoder();
  if (!raw.startsWith("HTTP/1.1 ")) {
    return {
      body: encoder.encode(raw),
      fault: null,
      headers: [["Content-Type", "text/event-stream"]],
      status: 200,
      statusText: "OK",
    };
  }
  const split = raw.indexOf("\n\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? "" : raw.slice(split + 2);
  const [statusLine = "", ...headerLines] = head.split("\n");
  const status = /^HTTP\/1\.1 (\d{3}) (.*)$/.exec(statusLine);
  if (!status) {
    throw new Error(`Not an HTTP/1.1 status line: ${JSON.stringify(statusLine)}`);
  }
  const headers: [string, string][] = [];
  let fault: Fault | null = null;
  for (const line of headerLines) {
    const colon = line.indexOf(": ");
    const name = line.slice(0, colon);
    const value = line.slice(colon + 2);
    if (name.toLowerCase() === "x-fixture-error") {
      const error = /^(\w+): (.*)$/.exec(value);
      if (!error) {
        throw new Error(`X-Fixture-Error must read "<name>: <message>", got ${value}`);
      }
      fault = { message: error[2] ?? "", name: error[1] ?? "" };
    } else {
      headers.push([name, value]);
    }
  }
  return {
    body: encoder.encode(body),
    fault,
    headers,
    status: Number(status[1]),
    statusText: status[2] ?? "",
  };
}

/** Where the body's chunk boundaries fall. The events must not depend on it. */
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

/**
 * The upstream Response a fixture describes, its body delivered in `chunks`. A fault is injected by
 * a reader that rejects once the body is exhausted and whose `cancel` resolves: the client answers
 * a failed read with `void reader.cancel()`, which on a genuinely errored stream is an unhandled
 * rejection that fails whatever test is running.
 */
function upstreamResponse(fixture: UpstreamFixture, chunks: Uint8Array[]): Response {
  let next = 0;
  const stream = new ReadableStream<Uint8Array>({
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
  const response = new Response(stream, {
    headers: fixture.headers,
    status: fixture.status,
    statusText: fixture.statusText,
  });
  const { fault } = fixture;
  if (fault) {
    const inner = stream.getReader();
    const reader = {
      cancel: (reason?: unknown) => inner.cancel(reason),
      read: async () => {
        const result = await inner.read();
        if (result.done) {
          throw Object.assign(new Error(fault.message), { name: fault.name });
        }
        return result;
      },
      releaseLock: () => inner.releaseLock(),
    };
    Object.defineProperty(response, "body", { value: { getReader: () => reader } });
  }
  return response;
}

// ─── Golden comparison (mirrored from packages/server/tests/ai-upstream-fixtures.test.ts) ────────

function member(path: string, key: string | number): string {
  if (typeof key === "number") {
    return `${path}[${key}]`;
  }
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function show(value: unknown): string {
  return value === undefined ? "(absent)" : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The first place `actual` departs from `expected`, as `<JSON path>: expected …, received …`, or
 * null when they are identical. Member order counts.
 */
function firstDifference(actual: unknown, expected: unknown, path = "$"): string | null {
  if (Object.is(actual, expected)) {
    return null;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    const length = Math.max(actual.length, expected.length);
    for (let index = 0; index < length; index += 1) {
      const difference = firstDifference(actual[index], expected[index], member(path, index));
      if (difference !== null) {
        return difference;
      }
    }
    return null;
  }
  if (isRecord(actual) && isRecord(expected)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
    for (const key of keys) {
      const difference = firstDifference(actual[key], expected[key], member(path, key));
      if (difference !== null) {
        return difference;
      }
    }
    const order = Object.keys(actual).join(", ");
    const expectedOrder = Object.keys(expected).join(", ");
    return order === expectedOrder
      ? null
      : `${path}: member order differs: expected [${expectedOrder}], received [${order}]`;
  }
  return `${path}: expected ${show(expected)}, received ${show(actual)}`;
}

/** Compare with `<file>`, or (with JX_UPDATE_GOLDENS=1) rewrite it. */
function checkGolden(file: string, actual: unknown): void {
  const text = `${JSON.stringify(actual, null, 2)}\n`;
  if (UPDATE) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
      writeFileSync(file, text);
    }
    return;
  }
  if (!existsSync(file)) {
    throw new Error(`${basename(file)} is missing. Record it with: ${RERECORD}`);
  }
  const difference = firstDifference(actual, JSON.parse(readFileSync(file, "utf8")));
  expect(
    difference === null
      ? null
      : `${basename(file)} differs from the golden at ${difference}\nIf the change is intended, re-record: ${RERECORD}`,
  ).toBeNull();
}

/** Every leaf path where two frame lists disagree, member order ignored, in a stable order. */
function differingPaths(server: unknown, client: unknown, path = "$"): string[] {
  if (Object.is(server, client)) {
    return [];
  }
  if (Array.isArray(server) && Array.isArray(client)) {
    return Array.from({ length: Math.max(server.length, client.length) }, (_, index) =>
      differingPaths(server[index], client[index], member(path, index)),
    ).flat();
  }
  if (isRecord(server) && isRecord(client)) {
    return [...new Set([...Object.keys(server), ...Object.keys(client)])]
      .toSorted()
      .flatMap((key) => differingPaths(server[key], client[key], member(path, key)));
  }
  return [path];
}

// ─── The client ──────────────────────────────────────────────────────────────

interface ClientResult {
  frames: StreamEvent[];
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function runClient(fixture: UpstreamFixture, chunking: string): Promise<ClientResult> {
  const split = CHUNKINGS[chunking];
  if (!split) {
    throw new Error(`Unknown chunking ${chunking}`);
  }
  const calls: string[] = [];
  globalThis.fetch = ((url: string) => {
    calls.push(String(url));
    return Promise.resolve(upstreamResponse(fixture, split(fixture.body)));
  }) as unknown as typeof fetch;

  const client = createOpenAIStreamingClient({
    apiKey: "sk-fixture",
    baseUrl: "https://api.openai.com/v1",
  });
  const frames: StreamEvent[] = [];
  const events = client.streamChat(
    [{ content: "Hi", role: "user" }],
    [],
    "",
    new AbortController().signal,
  );
  for await (const event of events) {
    frames.push(event);
  }
  expect(calls).toEqual(["https://api.openai.com/v1/chat/completions"]);
  return { frames };
}

/** The proxy's frames for a fixture, from its committed golden. */
function serverFrames(name: string): unknown {
  const file = join(FIXTURES, `${name}.server.json`);
  if (!existsSync(file)) {
    throw new Error(
      `${basename(file)} is missing: record the server goldens first, from packages/server`,
    );
  }
  const golden: unknown = JSON.parse(readFileSync(file, "utf8"));
  return isRecord(golden) ? golden.frames : undefined;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("upstream SSE fixtures through createOpenAIStreamingClient", () => {
  it("reads the server's fixtures, and every client golden has one", () => {
    expect(NAMES.length).toBeGreaterThan(0);
    const orphans = readdirSync(FIXTURES)
      .filter((file) => file.endsWith(".client.json"))
      .filter((file) => !NAMES.includes(file.slice(0, -".client.json".length)));
    expect(orphans).toEqual([]);
  });

  for (const name of NAMES) {
    it(name, async () => {
      const fixture = parseFixture(readFixture(name));
      const whole = await runClient(fixture, "whole");
      for (const chunking of ["lines", "bytes"]) {
        const result = await runClient(fixture, chunking);
        const difference = firstDifference(result, whole);
        expect(
          difference === null
            ? null
            : `chunking "${chunking}" departs from "whole" at ${difference}`,
        ).toBeNull();
      }
      checkGolden(join(FIXTURES, `${name}.client.json`), whole);
    });
  }
});

describe("proxy and client divergence", () => {
  it("differs on exactly the documented fixtures and members", async () => {
    const divergence: Record<string, string[]> = {};
    for (const name of NAMES) {
      const { frames } = await runClient(parseFixture(readFixture(name)), "whole");
      const paths = differingPaths(serverFrames(name), frames);
      if (paths.length > 0) {
        divergence[name] = paths;
      }
    }
    expect(divergence).toEqual(EXPECTED_DIVERGENCE);
  });
});
