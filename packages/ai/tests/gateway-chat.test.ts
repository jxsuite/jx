/**
 * Tests for the gateway's chat route (`createChatHandler`) and the `./gateway` barrel.
 *
 * The handler's contract is an ORDER: admit, resolveUpstream, read the body (400 on invalid JSON,
 * 413 past `maxBodyBytes`), the messages array, `maxMessages`, onAccepted, then the stream. The
 * first step that refuses answers the request, so each test below also asserts which later steps
 * never ran: the body unread, the upstream never contacted.
 *
 * @module @jxsuite/ai/tests
 */

import { afterEach, describe, expect, it } from "bun:test";
import { PROBLEM_MEDIA_TYPE, problemDetails } from "@jxsuite/protocol";
import * as gateway from "../src/gateway/index.ts";
import { createChatHandler } from "../src/gateway/chat.ts";
import type {
  ChatAdmission,
  ChatGatewayOptions,
  GatewayRefusal,
  Upstream,
} from "../src/gateway/types.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface Context {
  readonly signal: AbortSignal;
}

const UPSTREAM: Upstream = {
  apiKey: "sk-test",
  baseUrl: "https://llm.example/v1",
  defaultModel: "default-model",
  family: "openai-compat",
  managed: false,
};

const OK_BODY = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';

interface UpstreamCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

/** A fetch double that records each call and answers with `respond`. */
function fakeFetch(
  respond: () => Promise<Response> = () => Promise.resolve(new Response(OK_BODY)),
) {
  const calls: UpstreamCall[] = [];
  const impl = ((url: string, init: RequestInit) => {
    calls.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, init, url });
    return respond();
  }) as unknown as typeof fetch;
  return { calls, impl };
}

/** A chat request whose body is `body` (a string is sent as written). */
function chatRequest(body: unknown): Request {
  return new Request("http://gateway.test/ai/chat", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

/**
 * A chat request whose body is a stream that records every pull in `trace` and every cancel in
 * `cancelled`, so a test can see whether (and how far) the body was read.
 */
function tracedRequest(chunks: string[], trace: string[]) {
  const cancelled: unknown[] = [];
  const encoder = new TextEncoder();
  let next = 0;
  // A zero high-water mark, so a pull means somebody read rather than the stream filling its queue.
  const body = new ReadableStream<Uint8Array>(
    {
      cancel(reason) {
        cancelled.push(reason);
      },
      pull(controller) {
        trace.push("read");
        const chunk = chunks[next];
        next += 1;
        if (chunk === undefined) {
          controller.close();
        } else {
          controller.enqueue(encoder.encode(chunk));
        }
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request("http://gateway.test/ai/chat", {
    body,
    duplex: "half",
    method: "POST",
  } as RequestInit);
  return { cancelled, request };
}

const context = (): Context => ({ signal: new AbortController().signal });

/** Read a handler's response to the end, so the upstream exchange behind it has finished. */
async function drain(pending: Promise<Response>): Promise<string> {
  const response = await pending;
  return response.text();
}

/** The frames of an SSE body, parsed. */
async function framesOf(response: Response): Promise<unknown[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((block) => block !== "")
    .map((block) => JSON.parse(block.slice("data: ".length)) as unknown);
}

async function expectProblem(
  response: Response,
  status: number,
  body: Record<string, unknown>,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Type")).toBe(PROBLEM_MEDIA_TYPE);
  expect(await response.text()).toBe(JSON.stringify(body));
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ─── The order ───────────────────────────────────────────────────────────────

describe("createChatHandler: the order of the checks", () => {
  it("admits, resolves, reads, accepts and only then contacts the upstream", async () => {
    const trace: string[] = [];
    const upstreamFetch = (() => {
      trace.push("fetch");
      return Promise.resolve(new Response(OK_BODY));
    }) as unknown as typeof fetch;
    const handler = createChatHandler<Context>({
      admit: () => {
        trace.push("admit");
        return null;
      },
      fetch: upstreamFetch,
      maxBodyBytes: 1000,
      maxMessages: 10,
      onAccepted: () => {
        trace.push("onAccepted");
      },
      resolveUpstream: () => {
        trace.push("resolveUpstream");
        return UPSTREAM;
      },
    });
    const { request } = tracedRequest([JSON.stringify({ messages: [] })], trace);
    const response = await handler(request, context());
    await response.text();
    expect(trace.filter((step, index) => step !== trace[index - 1])).toEqual([
      "admit",
      "resolveUpstream",
      "read",
      "onAccepted",
      "fetch",
    ]);
  });

  it("an admit refusal answers before anything else runs", async () => {
    const trace: string[] = [];
    const { calls, impl } = fakeFetch();
    const refused: GatewayRefusal = {
      code: "rate_limited",
      problem: problemDetails("invalidRequest", "Slow down"),
      status: 429,
    };
    const handler = createChatHandler<Context>({
      admit: () => Promise.resolve(refused),
      fetch: impl,
      onAccepted: () => {
        trace.push("onAccepted");
      },
      resolveUpstream: () => {
        trace.push("resolveUpstream");
        return UPSTREAM;
      },
    });
    const { request } = tracedRequest([JSON.stringify({ messages: [] })], trace);
    const response = await handler(request, context());
    await expectProblem(response, 429, {
      ...problemDetails("invalidRequest", "Slow down"),
      code: "rate_limited",
    });
    expect(trace).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("a resolveUpstream refusal answers before the body is read", async () => {
    const trace: string[] = [];
    const { calls, impl } = fakeFetch();
    const handler = createChatHandler<Context>({
      fetch: impl,
      resolveUpstream: () =>
        Promise.resolve({
          problem: problemDetails("forbidden", "Base URL host is not permitted."),
          status: 403,
        }),
    });
    const { request } = tracedRequest([JSON.stringify({ messages: [] })], trace);
    const response = await handler(request, context());
    await expectProblem(
      response,
      403,
      problemDetails("forbidden", "Base URL host is not permitted."),
    );
    expect(trace).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("an async resolveUpstream and an async admit that lets the request through both work", async () => {
    const { calls, impl } = fakeFetch();
    const handler = createChatHandler<Context>({
      admit: () => Promise.resolve(null),
      fetch: impl,
      resolveUpstream: () => Promise.resolve(UPSTREAM),
    });
    const response = await handler(chatRequest({ messages: [] }), context());
    expect(response.status).toBe(200);
    await response.text();
    expect(calls).toHaveLength(1);
  });
});

// ─── The body ────────────────────────────────────────────────────────────────

describe("createChatHandler: the body", () => {
  const invalidJson = problemDetails("invalidRequest", "Invalid JSON body");

  it.each<[string, string]>([
    ["text that is not JSON", "not valid json {{{"],
    ["an empty body", ""],
  ])("%s is a 400 problem, and the upstream is never contacted", async (_label, body) => {
    const { calls, impl } = fakeFetch();
    const handler = createChatHandler<Context>({ fetch: impl, resolveUpstream: () => UPSTREAM });
    const response = await handler(chatRequest(body), context());
    await expectProblem(response, 400, invalidJson);
    expect(calls).toEqual([]);
  });

  /* Bun's `req.json()`, which the server read the body with before the extraction, keeps a leading
     byte-order mark, so JSON.parse refused the body. The gateway keeps that answer. */
  it("a body that starts with a byte-order mark is a 400 problem", async () => {
    const { calls, impl } = fakeFetch();
    const handler = createChatHandler<Context>({ fetch: impl, resolveUpstream: () => UPSTREAM });
    const response = await handler(
      chatRequest(`\uFEFF${JSON.stringify({ messages: [] })}`),
      context(),
    );
    await expectProblem(response, 400, invalidJson);
    expect(calls).toEqual([]);
  });

  it("a body that fails while it is read is a 400 problem too", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    const request = new Request("http://gateway.test/ai/chat", {
      body,
      duplex: "half",
      method: "POST",
    } as RequestInit);
    const handler = createChatHandler<Context>({ resolveUpstream: () => UPSTREAM });
    await expectProblem(await handler(request, context()), 400, invalidJson);
  });

  it.each<[string, unknown]>([
    ["a string", "not-an-array"],
    ["null", null],
    ["an object", { 0: "a" }],
  ])("messages as %s is a 400 problem", async (_label, messages) => {
    const { calls, impl } = fakeFetch();
    const handler = createChatHandler<Context>({ fetch: impl, resolveUpstream: () => UPSTREAM });
    const response = await handler(chatRequest({ messages }), context());
    await expectProblem(
      response,
      400,
      problemDetails("invalidRequest", "messages must be an array"),
    );
    expect(calls).toEqual([]);
  });

  /* The server's behaviour, carried verbatim: the destructuring defaults apply to an absent member,
     and a body of JSON null has no members to destructure. */
  it("a body of JSON null rejects, as the server's proxy always did", async () => {
    const handler = createChatHandler<Context>({ resolveUpstream: () => UPSTREAM });
    const outcome = await handler(chatRequest("null"), context()).then(
      () => "resolved",
      (error: unknown) => (error as Error).name,
    );
    expect(outcome).toBe("TypeError");
  });
});

// ─── The limits ──────────────────────────────────────────────────────────────

describe("createChatHandler: the limits", () => {
  it("a body past maxBodyBytes is a 413, and reading stops there", async () => {
    const trace: string[] = [];
    const { calls, impl } = fakeFetch();
    const handler = createChatHandler<Context>({
      fetch: impl,
      maxBodyBytes: 10,
      resolveUpstream: () => UPSTREAM,
    });
    const { cancelled, request } = tracedRequest(["0123456789", "x", "never read"], trace);
    const response = await handler(request, context());
    await expectProblem(
      response,
      413,
      problemDetails(
        "payloadTooLarge",
        "The request body is larger than this gateway accepts (10 bytes).",
      ),
    );
    expect(trace).toEqual(["read", "read"]);
    expect(cancelled).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it("a body of exactly maxBodyBytes is accepted, and its size is reported as read", async () => {
    const body = JSON.stringify({ messages: [{ content: "hé", role: "user" }] });
    const bytes = new TextEncoder().encode(body).byteLength;
    const admissions: ChatAdmission[] = [];
    const { impl } = fakeFetch();
    const handler = createChatHandler<Context>({
      fetch: impl,
      maxBodyBytes: bytes,
      onAccepted: (admission) => {
        admissions.push(admission);
      },
      resolveUpstream: () => UPSTREAM,
    });
    const response = await handler(chatRequest(body), context());
    expect(response.status).toBe(200);
    await response.text();
    expect(admissions.map((admission) => admission.bytes)).toEqual([bytes]);
  });

  it("more messages than maxMessages is a 413; exactly that many is accepted", async () => {
    const { calls, impl } = fakeFetch();
    const handler = createChatHandler<Context>({
      fetch: impl,
      maxMessages: 2,
      resolveUpstream: () => UPSTREAM,
    });
    const message = { content: "hi", role: "user" };
    const over = await handler(chatRequest({ messages: [message, message, message] }), context());
    await expectProblem(
      over,
      413,
      problemDetails(
        "payloadTooLarge",
        "The request carries 3 messages; this gateway accepts at most 2.",
      ),
    );
    expect(calls).toEqual([]);
    const at = await handler(chatRequest({ messages: [message, message] }), context());
    expect(at.status).toBe(200);
    await at.text();
    expect(calls).toHaveLength(1);
  });
});

// ─── onAccepted ──────────────────────────────────────────────────────────────

describe("createChatHandler: onAccepted", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["the body's model", { messages: [{}, {}], model: "gpt-x" }, "gpt-x"],
    ["the upstream's default when the body names none", { messages: [{}, {}] }, "default-model"],
    ["a model that is not a string, as text", { messages: [{}, {}], model: 7 }, "7"],
  ])("reports %s, the message count and wire 1", async (_label, body, model) => {
    const seen: [ChatAdmission, Upstream, Context][] = [];
    const ctx = context();
    const text = JSON.stringify(body);
    const { impl } = fakeFetch();
    const handler = createChatHandler<Context>({
      fetch: impl,
      onAccepted: (admission, upstream, given) => {
        seen.push([admission, upstream, given]);
      },
      resolveUpstream: () => UPSTREAM,
    });
    await drain(handler(chatRequest(text), ctx));
    expect(seen).toEqual([
      [
        { bytes: new TextEncoder().encode(text).byteLength, messageCount: 2, model, wire: 1 },
        UPSTREAM,
        ctx,
      ],
    ]);
    expect(seen[0]?.[2]).toBe(ctx);
  });
});

// ─── The upstream request ────────────────────────────────────────────────────

describe("createChatHandler: the upstream request", () => {
  it("forwards the v1 body as an OpenAI-compatible streaming request", async () => {
    const ctx = context();
    const { calls, impl } = fakeFetch();
    const handler = createChatHandler<Context>({ fetch: impl, resolveUpstream: () => UPSTREAM });
    const tools = [{ function: { name: "x" }, type: "function" }];
    const messages = [{ content: "Hi", role: "user" }];
    const response = await handler(
      chatRequest({ messages, model: "gpt-4o", systemPrompt: "Be brief.", tools }),
      ctx,
    );
    await response.text();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("https://llm.example/v1/chat/completions");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers).toEqual({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
    });
    expect(call?.init.signal).toBe(ctx.signal);
    expect(String(call?.init.body)).toBe(
      JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "system", content: "Be brief." }, ...messages],
        stream: true,
        stream_options: { include_usage: true },
        tools,
        tool_choice: "auto",
        parallel_tool_calls: true,
      }),
    );
  });

  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    [
      "an empty body gets every default",
      {},
      {
        model: "default-model",
        messages: [{ role: "system", content: "" }],
        stream: true,
        stream_options: { include_usage: true },
      },
    ],
    [
      "an empty tools list offers no tools",
      { messages: [], tools: [] },
      {
        model: "default-model",
        messages: [{ role: "system", content: "" }],
        stream: true,
        stream_options: { include_usage: true },
      },
    ],
    [
      "a null member is forwarded as sent, not defaulted",
      { messages: [], model: null, systemPrompt: null, tools: null },
      {
        model: null,
        messages: [{ role: "system", content: null }],
        stream: true,
        stream_options: { include_usage: true },
      },
    ],
  ])("%s", async (_label, body, forwarded) => {
    const { calls, impl } = fakeFetch();
    const handler = createChatHandler<Context>({ fetch: impl, resolveUpstream: () => UPSTREAM });
    await drain(handler(chatRequest(body), context()));
    expect(String(calls[0]?.init.body)).toBe(JSON.stringify(forwarded));
  });

  it("uses the global fetch, looked up per request, when no fetch is given", async () => {
    const handler = createChatHandler<Context>({ resolveUpstream: () => UPSTREAM });
    const first = fakeFetch();
    globalThis.fetch = first.impl;
    await drain(handler(chatRequest({ messages: [] }), context()));
    const second = fakeFetch();
    globalThis.fetch = second.impl;
    await drain(handler(chatRequest({ messages: [] }), context()));
    expect([first.calls.length, second.calls.length]).toEqual([1, 1]);
  });
});

// ─── The stream ──────────────────────────────────────────────────────────────

describe("createChatHandler: the stream", () => {
  it("is a 200 event stream of the normalized upstream frames", async () => {
    const { impl } = fakeFetch();
    const handler = createChatHandler<Context>({ fetch: impl, resolveUpstream: () => UPSTREAM });
    const response = await handler(chatRequest({ messages: [] }), context());
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers.entries())).toEqual({
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    });
    expect(await framesOf(response)).toEqual([
      { content: "Hi", type: "delta" },
      { stopReason: "stop", type: "done" },
    ]);
  });

  it("an upstream refusal is an error frame inside the 200, keeping the upstream's status", async () => {
    const { impl } = fakeFetch(() =>
      Promise.resolve(Response.json({ error: { message: "rate limited" } }, { status: 429 })),
    );
    const handler = createChatHandler<Context>({ fetch: impl, resolveUpstream: () => UPSTREAM });
    const response = await handler(chatRequest({ messages: [] }), context());
    expect(response.status).toBe(200);
    expect(await framesOf(response)).toEqual([
      {
        code: "429",
        message: "rate limited",
        problem: problemDetails("invalidRequest", "rate limited"),
        type: "error",
      },
    ]);
  });

  it.each<[string, unknown, unknown[]]>([
    [
      "a network failure is an error frame",
      new Error("boom"),
      [
        {
          message: "Network error: boom",
          problem: problemDetails("upstreamFailure", "Network error: boom"),
          type: "error",
        },
      ],
    ],
    [
      "an aborted request is done: cancelled",
      Object.assign(new Error("aborted"), { name: "AbortError" }),
      [{ stopReason: "cancelled", type: "done" }],
    ],
  ])("when the upstream never answers, %s", async (_label, error, frames) => {
    const { impl } = fakeFetch(() => Promise.reject(error));
    const handler = createChatHandler<Context>({ fetch: impl, resolveUpstream: () => UPSTREAM });
    const response = await handler(chatRequest({ messages: [] }), context());
    expect(response.status).toBe(200);
    expect(await framesOf(response)).toEqual(frames);
  });
});

describe("createChatHandler: a client that stops reading", () => {
  /* The client cancels the chat body after one frame. The upstream must be cancelled with it rather
     than left streaming into a body nobody reads, including on a host where the disconnect does not
     also abort the request's signal. */
  it("cancels the upstream body", async () => {
    const encoder = new TextEncoder();
    const frame = (content: string) =>
      encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    const second = Promise.withResolvers<null>();
    const cancelled = Promise.withResolvers<null>();
    let pulls = 0;
    const upstreamBody = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled.resolve(null);
      },
      async pull(controller) {
        pulls += 1;
        if (pulls > 1) {
          await second.promise;
        }
        controller.enqueue(frame(pulls === 1 ? "a" : "b"));
      },
    });
    const { impl } = fakeFetch(() => Promise.resolve(new Response(upstreamBody)));
    const handler = createChatHandler<Context>({ fetch: impl, resolveUpstream: () => UPSTREAM });
    const response = await handler(chatRequest({ messages: [] }), context());
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe(
      `data: ${JSON.stringify({ type: "delta", content: "a" })}\n\n`,
    );
    await reader.cancel();
    // The next frame finds the body cancelled, which ends the normalizer and cancels the upstream.
    second.resolve(null);
    await cancelled.promise;
    expect(pulls).toBeGreaterThanOrEqual(2);
  });
});

// ─── The barrel ──────────────────────────────────────────────────────────────

describe("@jxsuite/ai/gateway", () => {
  it("exports the gateway's runtime surface and nothing else", () => {
    expect(Object.keys(gateway).toSorted()).toEqual([
      "createChatHandler",
      "encodeSse",
      "extractUpstreamErrorMessage",
      "modelsResponse",
      "normalizeOpenAIStream",
      "problemResponse",
    ]);
  });

  it("types a host's options without a cast", () => {
    const options: ChatGatewayOptions<Context> = { resolveUpstream: () => UPSTREAM };
    expect(typeof gateway.createChatHandler(options)).toBe("function");
  });
});
