/**
 * The gateway conformance kit: one list of cases every backend serving the assistant's chat and
 * models routes runs against itself (specs/ai.md §2.4).
 *
 * `@jxsuite/server` runs it, and so does any other backend; a case that passes on one and fails on
 * another is a difference a client would have met in production. Each case drives the routes
 * through the three functions a host hands it and throws an `Error` naming what it expected.
 *
 * @module @jxsuite/ai/testing
 */

import type { StreamEvent, WireEvent } from "../streaming-client.ts";
import { fakeUpstream } from "./fake-upstream.ts";
import type { UpstreamFetch } from "./fake-upstream.ts";

/** A backend's two routes, and the seam its upstream calls go through. */
export interface ConformanceGateway {
  /** The chat route's handler. */
  chat: (request: Request) => Promise<Response>;
  /** The models route's handler. */
  models: (request: Request) => Promise<Response>;
  /** Make every upstream call the routes issue from now on go through `upstream`. */
  installUpstream: (upstream: UpstreamFetch) => void;
}

/** One conformance case. */
export interface ConformanceCase {
  /** A stable name for the case, for a test title. */
  readonly id: string;
  /** Run the case. Rejects with an `Error` naming the expectation the gateway missed. */
  run: (gateway: ConformanceGateway) => Promise<void>;
}

/** What a host tells the kit about the gateway under test. */
export interface ConformanceOptions {
  /**
   * The wire versions the gateway declares. `[1]` when absent; with 2 in the list, the version 2
   * cases run too.
   */
  readonly wire?: readonly number[];
  /** Headers every request carries, such as the credentials the host's policy requires. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Require that a condition holds, failing the running case when it does not.
 *
 * @param {boolean} condition - What must be true
 * @param {string} expectation - What the gateway was expected to do
 * @param {Actual} actual - What it did instead, printed as JSON
 */
function expect<Actual>(condition: boolean, expectation: string, actual: Actual): void {
  if (!condition) {
    throw new Error(`gateway conformance: expected ${expectation}; got ${JSON.stringify(actual)}`);
  }
}

/**
 * True when a member of a parsed answer is a string.
 *
 * @param {unknown} value - A member, as the gateway sent it
 * @returns {boolean}
 */
function isText(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * True when a member of a parsed answer is an array.
 *
 * @param {unknown} value - A member, as the gateway sent it
 * @returns {boolean}
 */
function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * The frames of an event-stream response, in order.
 *
 * @param {Response} response - The chat route's answer
 * @returns {Promise<StreamEvent[]>}
 */
async function framesOf(response: Response): Promise<StreamEvent[]> {
  expect(response.status === 200, "a 200 once the stream has begun", response.status);
  const type = response.headers.get("Content-Type") ?? "";
  expect(type.startsWith("text/event-stream"), "a text/event-stream response", type);
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map(
      (line): StreamEvent =>
        /* SAFETY: the chat route's every `data:` line is one frame (specs/ai.md §2); the cases
           below read only `type` and the members that type declares. */
        JSON.parse(line.slice("data: ".length)) as StreamEvent,
    );
}

/**
 * An upstream body of chat-completions chunks, each as one `data:` line.
 *
 * @param {readonly (object | "[DONE]")[]} chunks - The chunks, in order
 * @returns {string}
 */
function sse(chunks: readonly (object | "[DONE]")[]): string {
  return chunks
    .map((chunk) => `data: ${chunk === "[DONE]" ? chunk : JSON.stringify(chunk)}\n\n`)
    .join("");
}

/**
 * The conformance cases for a gateway speaking the declared wire versions.
 *
 * @param {ConformanceOptions} [options] - What the host declares about the gateway under test
 * @returns {ConformanceCase[]}
 */
export function gatewayConformanceCases(options: ConformanceOptions = {}): ConformanceCase[] {
  const wire = options.wire ?? [1];
  const headers = { "Content-Type": "application/json", ...options.headers };

  const chatRequest = (body: string): Request =>
    new Request("http://gateway.test/ai/chat", { body, headers, method: "POST" });
  const v1Body = JSON.stringify({
    messages: [{ content: "hello", role: "user" }],
    systemPrompt: "You are helpful.",
    tools: [],
  });

  return [
    {
      id: "a text reply streams as delta frames and ends with done",
      async run(gateway) {
        gateway.installUpstream(
          fakeUpstream([
            {
              sse: sse([
                { choices: [{ delta: { content: "Hel" } }] },
                { choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] },
                "[DONE]",
              ]),
              status: 200,
            },
          ]),
        );
        const frames = await framesOf(await gateway.chat(chatRequest(v1Body)));
        const text = frames.map((frame) => (frame.type === "delta" ? frame.content : "")).join("");
        expect(text === "Hello", 'the text "Hello" across delta frames', frames);
        const last = frames.at(-1);
        expect(
          last?.type === "done" && last.stopReason === "stop" && last.truncated === undefined,
          "a final done frame with stopReason stop and no truncated member",
          last,
        );
      },
    },
    {
      id: "a tool call streams as start, delta and end, and the usage count precedes done",
      async run(gateway) {
        gateway.installUpstream(
          fakeUpstream([
            {
              sse: sse([
                {
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          { function: { arguments: '{"a":', name: "probe" }, id: "c1", index: 0 },
                        ],
                      },
                    },
                  ],
                },
                {
                  choices: [
                    { delta: { tool_calls: [{ function: { arguments: "1}" }, index: 0 }] } },
                  ],
                },
                { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
                { choices: [], usage: { completion_tokens: 3, prompt_tokens: 7 } },
                "[DONE]",
              ]),
              status: 200,
            },
          ]),
        );
        const frames = await framesOf(await gateway.chat(chatRequest(v1Body)));
        const types = frames.map((frame) => frame.type).join(" ");
        expect(
          types === "tool_call_start tool_call_delta tool_call_delta tool_call_end usage done",
          "start, two deltas, end, usage, done, in that order",
          types,
        );
        const args = frames
          .map((frame) => (frame.type === "tool_call_delta" ? frame.args : ""))
          .join("");
        expect(args === '{"a":1}', "the call's arguments joined across its deltas", args);
        const last = frames.at(-1);
        expect(
          last?.type === "done" && last.stopReason === "tool_calls",
          "done with stopReason tool_calls",
          last,
        );
      },
    },
    {
      id: "a body that ends with no terminal marker finishes truncated",
      async run(gateway) {
        gateway.installUpstream(
          fakeUpstream([{ sse: sse([{ choices: [{ delta: { content: "cut" } }] }]), status: 200 }]),
        );
        const frames = await framesOf(await gateway.chat(chatRequest(v1Body)));
        const last = frames.at(-1);
        expect(
          last?.type === "done" && last.stopReason === "stop" && last.truncated === true,
          "done with stopReason stop and truncated true",
          last,
        );
      },
    },
    {
      id: "an upstream refusal is one error frame carrying a code and a problem",
      async run(gateway) {
        gateway.installUpstream(
          fakeUpstream([
            { body: JSON.stringify({ error: { message: "Incorrect API key" } }), status: 401 },
          ]),
        );
        const frames = await framesOf(await gateway.chat(chatRequest(v1Body)));
        expect(frames.length === 1, "exactly one frame", frames);
        const [frame] = frames;
        expect(
          frame?.type === "error" &&
            frame.message === "Incorrect API key" &&
            isText(frame.code) &&
            isText(frame.problem?.type),
          "an error frame with the upstream's sentence, a code and a problem naming a type",
          frame,
        );
      },
    },
    {
      id: "an upstream that cannot be reached is an error frame carrying a problem",
      async run(gateway) {
        gateway.installUpstream(fakeUpstream([]));
        const frames = await framesOf(await gateway.chat(chatRequest(v1Body)));
        const [frame] = frames;
        expect(
          frames.length === 1 && frame?.type === "error" && isText(frame.problem?.type),
          "one error frame with a problem naming a type",
          frames,
        );
      },
    },
    {
      id: "a body that is not JSON is refused as a problem document before any upstream call",
      async run(gateway) {
        const upstream = fakeUpstream([]);
        gateway.installUpstream(upstream);
        const response = await gateway.chat(chatRequest("{"));
        await expectProblem(response, 400);
        expect(upstream.calls.length === 0, "no upstream call", upstream.calls.length);
      },
    },
    {
      id: "messages that are not an array are refused as a problem document",
      async run(gateway) {
        gateway.installUpstream(fakeUpstream([]));
        const response = await gateway.chat(chatRequest(JSON.stringify({ messages: "hello" })));
        await expectProblem(response, 400);
      },
    },
    {
      id: "a wire version the gateway does not accept is refused, listing the ones it does",
      async run(gateway) {
        const upstream = fakeUpstream([]);
        gateway.installUpstream(upstream);
        const response = await gateway.chat(
          chatRequest(JSON.stringify({ messages: [], wire: 99 })),
        );
        await expectProblem(response, 400);
        expect(upstream.calls.length === 0, "no upstream call", upstream.calls.length);
      },
    },
    ...(wire.includes(2) ? v2Cases(chatRequest) : []),
    {
      id: "the models route answers 200 and advertises its wire versions",
      async run(gateway) {
        gateway.installUpstream(
          fakeUpstream([{ body: JSON.stringify({ data: [{ id: "m-1" }] }), status: 200 }]),
        );
        const response = await gateway.models(
          new Request("http://gateway.test/ai/models", { headers }),
        );
        expect(response.status === 200, "a 200, whatever the credential state", response.status);
        /* SAFETY: the route answers JSON; each member read below is checked before it is used. */
        const body = (await response.json()) as { models?: unknown; wire?: unknown };
        expect(isList(body.models), "a models array", body);
        const advertised = isList(body.wire) ? body.wire : [];
        expect(
          wire.every((version) => advertised.includes(version)),
          `wire to list ${JSON.stringify(wire)}`,
          advertised,
        );
      },
    },
  ];
}

/**
 * The cases only a gateway that accepts wire version 2 is held to (specs/ai.md §2.7).
 *
 * @param {(body: string) => Request} chatRequest - Builds a chat request with the host's headers
 * @returns {ConformanceCase[]}
 */
function v2Cases(chatRequest: (body: string) => Request): ConformanceCase[] {
  const v2Body = JSON.stringify({
    messages: [{ blocks: [{ text: "hello", type: "text" }], role: "user" }],
    system: [{ text: "You are helpful." }],
    tools: [],
    wire: 2,
  });
  return [
    {
      id: "a version 2 request is answered on version 2, opening with stream_start",
      async run(gateway) {
        gateway.installUpstream(
          fakeUpstream([
            {
              sse: sse([
                { choices: [{ delta: { content: "Hi" }, finish_reason: "stop" }] },
                "[DONE]",
              ]),
              status: 200,
            },
          ]),
        );
        const response = await gateway.chat(chatRequest(v2Body));
        const served = response.headers.get("X-Jx-AI-Wire");
        expect(served === "2", "the X-Jx-AI-Wire response header to say 2", served ?? "absent");
        /* SAFETY: a version 2 stream's first frame is `stream_start`, which is not one of the
           version 1 frames `framesOf` is typed for; only its `type` and `wire` are read. */
        const frames = (await framesOf(response)) as WireEvent[];
        const [first] = frames;
        expect(
          first?.type === "stream_start" && String(first.wire) === "2",
          "a first frame of stream_start on wire 2",
          first,
        );
        expect(frames.at(-1)?.type === "done", "a final done frame", frames.at(-1));
      },
    },
    {
      id: "a body that names wire 2 and is not a version 2 request is refused as a problem document",
      async run(gateway) {
        const upstream = fakeUpstream([]);
        gateway.installUpstream(upstream);
        const response = await gateway.chat(chatRequest(JSON.stringify({ wire: 2 })));
        await expectProblem(response, 400);
        expect(upstream.calls.length === 0, "no upstream call", upstream.calls.length);
      },
    },
  ];
}

/**
 * Require that a response is an RFC 9457 problem at `status`, carrying both the member a problem
 * reader keys on (`type`) and the one an older reader shows (`error`).
 *
 * @param {Response} response - The route's refusal
 * @param {number} status - The status it must carry
 * @returns {Promise<void>}
 */
async function expectProblem(response: Response, status: number): Promise<void> {
  expect(response.status === status, `status ${String(status)}`, response.status);
  const type = response.headers.get("Content-Type") ?? "";
  expect(type.startsWith("application/problem+json"), "application/problem+json", type);
  /* SAFETY: a problem document is a JSON object; both members are checked before use. */
  const body = (await response.json()) as { type?: unknown; error?: unknown };
  expect(isText(body.type) && isText(body.error), "a problem with a type and an error alias", body);
}
