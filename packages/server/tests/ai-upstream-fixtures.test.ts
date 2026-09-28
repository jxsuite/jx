/**
 * The proxy's SSE normalizer, frozen against recorded upstream bodies (the v1 freeze taken before
 * the harness refactor).
 *
 * Every `fixtures/ai-upstream/<name>.sse` is an upstream response as an OpenAI-compatible provider
 * sends it. Each is fed through `handleAiApi` (POST /__studio/ai/chat) with `globalThis.fetch`
 * stubbed, and the response the proxy writes is compared with `<name>.server.json`. The same
 * fixtures drive `createOpenAIStreamingClient` in `packages/ai/tests/upstream-divergence.test.ts`,
 * which also pins where the two normalizers disagree.
 *
 * This freezes CURRENT behaviour, defects included. A golden that changes is a behaviour change,
 * and belongs in a slice whose spec fragment names it.
 *
 * Fixture format. A file is either a bare SSE body, served as `200 OK` with `text/event-stream`, or
 * a raw HTTP/1.1 response: a status line, header lines, a blank line, then the body verbatim. One
 * header is a harness directive rather than something a provider sends: `X-Fixture-Error: <name>:
 * <message>` makes the read AFTER the last body byte reject with that error, which is how a
 * connection reset or an abort arrives mid-stream.
 *
 * Every fixture runs three times: the body in one chunk, one chunk per line, and one chunk per byte
 * (which splits multi-byte characters). The frames must not depend on where the chunks fall, and
 * only then is the result compared with the golden.
 *
 * Re-record: `JX_UPDATE_GOLDENS=1 bun test --isolate tests/ai-upstream-fixtures.test.ts` from
 * `packages/server`, then the same for `tests/upstream-divergence.test.ts` from `packages/ai` (that
 * suite reads these goldens). Nothing in the output is nondeterministic (no ids, clocks or paths),
 * so no normalization is applied, and a second recording is byte-identical.
 *
 * @module @jxsuite/server/tests
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { handleAiApi } from "../src/ai-api.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "ai-upstream");
const UPDATE = process.env.JX_UPDATE_GOLDENS === "1";
const RERECORD = "JX_UPDATE_GOLDENS=1 bun test --isolate tests/ai-upstream-fixtures.test.ts";

const NAMES = readdirSync(FIXTURES)
  .filter((file) => file.endsWith(".sse"))
  .map((file) => file.slice(0, -".sse".length))
  .toSorted();

// ─── Fixture loading (mirrored in packages/ai/tests/upstream-divergence.test.ts) ─────────────────

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

/** Where the body's chunk boundaries fall. The frames must not depend on it. */
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
 * The upstream Response a fixture describes, its body delivered in `chunks`.
 *
 * A fault is injected by a reader that rejects once the body is exhausted and whose `cancel`
 * resolves, rather than by erroring the stream itself. Both normalizers answer a failed read with
 * `void reader.cancel()`, and on a genuinely errored stream that is a rejected promise nobody
 * handles, which Bun's runner reports as a failure of whatever test is running. The device is the
 * one `ai-api.test.ts` uses for the same reason.
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

// ─── Golden comparison (mirrored in packages/ai/tests/upstream-divergence.test.ts) ───────────────

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
 * null when they are identical. Member order counts: the proxy's frames are wire bytes.
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

// ─── The proxy ───────────────────────────────────────────────────────────────

interface ServerResult {
  status: number;
  headers: Record<string, string>;
  frames: unknown[];
}

/**
 * Split the proxy's response body into frames, insisting on the exact wire form it writes, one
 * `data: <JSON.stringify(frame)>\n\n` per frame. That makes comparing frames (in member order)
 * equivalent to comparing bytes.
 */
function framesOf(wire: string): unknown[] {
  if (wire === "") {
    return [];
  }
  if (!wire.endsWith("\n\n")) {
    throw new Error(`The proxy's body does not end on a frame boundary: ${JSON.stringify(wire)}`);
  }
  return wire
    .slice(0, -2)
    .split("\n\n")
    .map((block) => {
      const json = block.slice("data: ".length);
      if (!block.startsWith("data: ") || block.includes("\n")) {
        throw new Error(`Not a single data line: ${JSON.stringify(block)}`);
      }
      const frame: unknown = JSON.parse(json);
      if (JSON.stringify(frame) !== json) {
        throw new Error(`A frame is not in JSON.stringify form: ${json}`);
      }
      return frame;
    });
}

const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

beforeEach(() => {
  // The request carries its own key; an ambient base URL or key must not steer it.
  for (const key of ["OPENAI_API_KEY", "OPENAI_BASE_URL"]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

async function runProxy(fixture: UpstreamFixture, chunking: string): Promise<ServerResult> {
  const split = CHUNKINGS[chunking];
  if (!split) {
    throw new Error(`Unknown chunking ${chunking}`);
  }
  const calls: string[] = [];
  globalThis.fetch = ((url: string) => {
    calls.push(String(url));
    return Promise.resolve(upstreamResponse(fixture, split(fixture.body)));
  }) as unknown as typeof fetch;

  const request = new Request("http://localhost/__studio/ai/chat", {
    body: JSON.stringify({
      messages: [{ content: "Hi", role: "user" }],
      model: "gpt-4o",
      systemPrompt: "",
    }),
    headers: { "Content-Type": "application/json", "X-Api-Key": "sk-fixture" },
    method: "POST",
  });
  const response = await handleAiApi(request, new URL("http://localhost/__studio/ai/chat"));
  if (!response) {
    throw new Error("handleAiApi did not claim POST /__studio/ai/chat");
  }
  const wire = await response.text();
  expect(calls).toEqual(["https://api.openai.com/v1/chat/completions"]);
  return {
    frames: framesOf(wire),
    headers: Object.fromEntries(
      [...response.headers.entries()].toSorted(([a], [b]) => a.localeCompare(b)),
    ),
    status: response.status,
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("upstream SSE fixtures through handleAiApi", () => {
  it("has fixtures, and every server golden has one", () => {
    expect(NAMES.length).toBeGreaterThan(0);
    const orphans = readdirSync(FIXTURES)
      .filter((file) => file.endsWith(".server.json"))
      .filter((file) => !NAMES.includes(file.slice(0, -".server.json".length)));
    expect(orphans).toEqual([]);
  });

  /*
   * `.gitattributes` says `* text=auto eol=lf`, which rewrites CRLF to LF when a file is committed,
   * unless the fixtures are exempted there. A fixture that lost its bytes would still pass, while
   * testing a different input, so the bytes that matter are asserted rather than trusted.
   */
  it("keeps the line endings the fixtures are about", () => {
    const lost: string[] = [];
    const crlf = readFixture("crlf-line-endings");
    if (!crlf.includes("\r\n") || crlf.replaceAll("\r\n", "").includes("\n")) {
      lost.push("crlf-line-endings.sse is no longer CRLF throughout");
    }
    for (const name of ["closes-mid-stream", "final-chunk-no-newline", "final-done-no-newline"]) {
      if (readFixture(name).endsWith("\n")) {
        lost.push(`${name}.sse gained a trailing newline`);
      }
    }
    expect(
      lost.length === 0
        ? null
        : `${lost.join("; ")}. Exempt the fixtures in .gitattributes (packages/server/tests/fixtures/ai-upstream/*.sse -text) and restore their bytes.`,
    ).toBeNull();
  });

  for (const name of NAMES) {
    it(name, async () => {
      const fixture = parseFixture(readFixture(name));
      const whole = await runProxy(fixture, "whole");
      for (const chunking of ["lines", "bytes"]) {
        const result = await runProxy(fixture, chunking);
        const difference = firstDifference(result, whole);
        expect(
          difference === null
            ? null
            : `chunking "${chunking}" departs from "whole" at ${difference}`,
        ).toBeNull();
      }
      checkGolden(join(FIXTURES, `${name}.server.json`), whole);
    });
  }
});
