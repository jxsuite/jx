/**
 * The turn engine (specs/ai.md §3.8), driven by scripted rounds with no network and no host.
 *
 * Studio's recorded agent traces hold the engine to the old loop call for call; these tests hold
 * the contract a host other than Studio relies on: the event grammar, the outcome kinds, the
 * anchor, the work budget, Stop, the lock, and that every event survives a JSON round trip.
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TURN_POLICY,
  LaneBusyError,
  createTurnLock,
  fromStreamingClient,
  joinSystem,
  runTurn,
} from "../src/harness/index.ts";
import type { HarnessEvent, ModelFn, ModelRequest, TurnInput } from "../src/harness/index.ts";
import { createLedger, createToolDefinition, createToolRegistry } from "../src/tools.ts";
import type { ToolContext, ToolRegistry, ToolResult } from "../src/tools.ts";
import { SEAL_RELOADED } from "../src/messages/index.ts";
import type { ChatMessage } from "../src/messages/index.ts";
import type { StreamEvent, StreamingClient } from "../src/streaming-client.ts";

const USER: ChatMessage = {
  id: "u1",
  role: "user",
  blocks: [{ type: "text", text: "Do it." }],
  timestamp: 1,
};

/** A model that answers each round with the next scripted list of frames, and records requests. */
function scripted(rounds: StreamEvent[][]) {
  const requests: ModelRequest[] = [];
  const signals: AbortSignal[] = [];
  const model: ModelFn = async function* model(request, signal) {
    requests.push(request);
    signals.push(signal);
    yield* rounds[requests.length - 1] ?? [{ type: "done", stopReason: "stop" }];
  };
  return { model, requests, signals };
}

function textRound(text: string): StreamEvent[] {
  return [
    { type: "delta", content: text },
    { type: "done", stopReason: "stop" },
  ];
}

function callRound(...calls: [id: string, name: string, args?: string][]): StreamEvent[] {
  return [
    ...calls.flatMap(([id, name, args = "{}"]): StreamEvent[] => [
      { type: "tool_call_start", id, name },
      { type: "tool_call_delta", id, args },
      { type: "tool_call_end", id },
    ]),
    { type: "done", stopReason: "tool_calls" },
  ];
}

interface ToolOptions {
  interactive?: boolean;
  writes?: boolean;
  result?: ToolResult;
  run?: (args: object, ctx: ToolContext) => void | Promise<void>;
}

function registry(tools: Record<string, ToolOptions>): ToolRegistry {
  const reg = createToolRegistry();
  for (const [name, options] of Object.entries(tools)) {
    reg.register(
      createToolDefinition({
        name,
        description: name,
        parameters: { type: "object", properties: {} },
        ...(options.interactive ? { interactive: true } : {}),
        async execute(args, ctx) {
          await options.run?.(args, ctx);
          if (options.writes) {
            ctx.ledger.record({ disk: false, ok: true, path: `/${name}.json`, tool: name });
          }
          return options.result ?? { success: true, summary: `${name} done.` };
        },
      }),
    );
  }
  return reg;
}

/** Run a turn to its end, collecting every event `onEvent` heard. */
async function run(input: Partial<TurnInput> & Pick<TurnInput, "model">) {
  const events: HarnessEvent[] = [];
  const turn = runTurn({
    history: [USER],
    system: [{ text: "You build pages." }],
    tools: registry({}),
    ...input,
    onEvent: (event) => {
      events.push(event);
      input.onEvent?.(event);
    },
  });
  const outcome = await turn.outcome;
  return { events, outcome, turn };
}

const types = (events: HarnessEvent[]) => events.map((e) => e.type);

describe("the event grammar", () => {
  test("a text answer: turn_start, a round, turn_end, with seq strictly increasing", async () => {
    const { model } = scripted([textRound("Hello.")]);
    const { events, outcome } = await run({ model, turnId: "t1" });
    expect(types(events)).toEqual(["turn_start", "round_start", "text", "round_end", "turn_end"]);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(events.every((e) => e.v === 1 && e.turnId === "t1")).toBe(true);
    expect(outcome.kind).toBe("complete");
    expect(outcome.appended).toHaveLength(1);
    expect(outcome.anchorMessageId).toBe(outcome.appended[0]!.id);
    expect(events.at(-1)).toMatchObject({ type: "turn_end", outcome });
  });

  test("round one answers into the host's placeholder, later rounds mint their own ids", async () => {
    const { model } = scripted([callRound(["c1", "probe"]), textRound("Done.")]);
    let n = 0;
    const { events, outcome } = await run({
      model,
      tools: registry({ probe: {} }),
      firstMessageId: "placeholder",
      newId: () => `id${(n += 1)}`,
      now: () => 42,
    });
    const starts = events.filter((e) => e.type === "round_start");
    expect(starts.map((e) => e.messageId)).toEqual(["placeholder", "id3"]);
    expect(outcome.turnId).toBe("id1");
    expect(outcome.appended.map((m) => [m.id, m.role, m.timestamp])).toEqual([
      ["placeholder", "assistant", 42],
      ["id2", "tool", 42],
      ["id3", "assistant", 42],
    ]);
  });

  test("calls report tool_start, their writes, then tool_result, in stream order", async () => {
    const { model } = scripted([callRound(["a", "edit"], ["b", "look"]), textRound("ok")]);
    const { events, outcome } = await run({
      model,
      tools: registry({ edit: { writes: true }, look: {} }),
    });
    const toolEvents = events
      .filter((e) => ["tool_start", "write", "tool_result"].includes(e.type))
      .map((e) => `${e.type}:${"callId" in e ? e.callId : ""}`);
    expect(toolEvents).toEqual([
      "tool_start:a",
      "write:a",
      "tool_result:a",
      "tool_start:b",
      "tool_result:b",
    ]);
    // Every executed call has exactly one result, and its reply is a `tool` message.
    const results = events.filter((e) => e.type === "tool_result");
    expect(results.map((e) => e.callId)).toEqual(["a", "b"]);
    const replies = outcome.appended.filter((m) => m.role === "tool");
    expect(replies.map((m) => m.blocks[0])).toEqual([
      {
        type: "tool_result",
        callId: "a",
        isError: false,
        content: JSON.stringify({ success: true, summary: "edit done." }),
      },
      {
        type: "tool_result",
        callId: "b",
        isError: false,
        content: JSON.stringify({ success: true, summary: "look done." }),
      },
    ]);
    expect(outcome.writes).toEqual([{ disk: false, ok: true, path: "/edit.json", tool: "edit" }]);
  });

  test("onEvent is called synchronously, before the engine's next step", async () => {
    const order: string[] = [];
    const { model } = scripted([callRound(["a", "probe"]), textRound("ok")]);
    await run({
      model,
      tools: registry({
        probe: {
          run: () => {
            order.push("execute");
          },
        },
      }),
      onEvent: (event) => order.push(event.type),
    });
    expect(order.indexOf("tool_start")).toBeLessThan(order.indexOf("execute"));
    expect(order.indexOf("execute")).toBeLessThan(order.indexOf("tool_result"));
  });

  test("every event survives a JSON round trip", async () => {
    const { model } = scripted([
      [
        { type: "reasoning", content: "Think." },
        ...callRound(["a", "edit"]).slice(0, -1),
        { type: "usage", inputTokens: 10, outputTokens: 2 },
        { type: "done", stopReason: "tool_calls" },
      ],
      textRound("ok"),
    ]);
    const { events } = await run({
      model,
      tools: registry({
        edit: {
          writes: true,
          run: (_args, ctx) => ctx.progress({ phase: "crawl" }),
          result: { success: true, summary: "s", data: { at: undefined, n: 1 } },
        },
      }),
    });
    for (const event of events) {
      // oxlint-disable-next-line unicorn/prefer-structured-clone -- the JSON round trip is the point
      expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    }
    expect(types(events)).toContain("tool_progress");
  });

  test("a late reader iterates the whole turn, from turn_start to turn_end", async () => {
    const { model } = scripted([textRound("Hi.")]);
    const turn = runTurn({ history: [USER], system: [], model, tools: registry({}) });
    await turn.outcome;
    const seen: string[] = [];
    for await (const event of turn) {
      seen.push(event.type);
    }
    expect(seen).toEqual(["turn_start", "round_start", "text", "round_end", "turn_end"]);
  });

  test("two readers each see the whole turn", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model: ModelFn = async function* model() {
      await gate;
      yield* textRound("Hi.");
    };
    const turn = runTurn({ history: [USER], system: [], model, tools: registry({}) });
    const read = async () => {
      const seen: string[] = [];
      for await (const event of turn) {
        seen.push(event.type);
      }
      return seen;
    };
    const readers = [read(), read()];
    await Promise.resolve();
    release();
    const expected = ["turn_start", "round_start", "text", "round_end", "turn_end"];
    expect(await Promise.all(readers)).toEqual([expected, expected]);
  });

  test("nothing is heard after turn_end, not even a late call's progress", async () => {
    let late: ((p: string) => void) | undefined;
    const { model } = scripted([callRound(["a", "probe"]), textRound("ok")]);
    const { events } = await run({
      model,
      tools: registry({
        probe: {
          run: (_args, ctx) => {
            late = (p) => ctx.progress(p);
          },
        },
      }),
    });
    late?.("after the end");
    expect(events.at(-1)?.type).toBe("turn_end");
    expect(events.filter((e) => e.type === "tool_progress")).toEqual([]);
  });

  test("an early reader waits for events as they arrive", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model: ModelFn = async function* model() {
      await gate;
      yield* textRound("Hi.");
    };
    const turn = runTurn({ history: [USER], system: [], model, tools: registry({}) });
    const reading = (async () => {
      const seen: string[] = [];
      for await (const event of turn) {
        seen.push(event.type);
      }
      return seen;
    })();
    await Promise.resolve();
    release();
    expect(await reading).toEqual(["turn_start", "round_start", "text", "round_end", "turn_end"]);
  });
});

describe("the history is repaired at turn start", () => {
  const call = (id: string, callId: string): ChatMessage => ({
    id,
    role: "assistant",
    blocks: [{ type: "tool_call", id: callId, name: "probe", argumentsText: "{}" }],
    timestamp: 7,
  });
  const reply = (id: string, callId: string): ChatMessage => ({
    id,
    role: "tool",
    blocks: [{ type: "tool_result", callId, isError: false, content: '{"success":true}' }],
    timestamp: 8,
  });

  test("an unanswered call is sealed before the first request, and the turn says so", async () => {
    const { model, requests } = scripted([textRound("Carrying on.")]);
    const history = [USER, call("a0", "c0"), reply("r_orphan", "gone"), USER];
    const { events } = await run({ model, history });
    expect(types(events).slice(0, 3)).toEqual(["turn_start", "transcript_repaired", "round_start"]);
    expect(events[1]).toMatchObject({
      seq: 1,
      sealed: ["c0"],
      dropped: ["r_orphan"],
      moved: [],
    });
    expect(requests[0]!.messages.map((m) => m.id)).toEqual(["u1", "a0", "sealed_c0_0", "u1"]);
    expect(requests[0]!.messages[2]).toMatchObject({
      role: "tool",
      blocks: [
        {
          type: "tool_result",
          callId: "c0",
          isError: true,
          content: JSON.stringify({ success: false, error: SEAL_RELOADED }),
        },
      ],
      timestamp: 7,
    });
  });

  test("a well-formed history is sent as it is, and no repair is heard", async () => {
    const { model, requests } = scripted([textRound("Done.")]);
    const history = [USER, call("a0", "c0"), reply("r0", "c0"), USER];
    const { events } = await run({ model, history });
    expect(types(events)).not.toContain("transcript_repaired");
    expect(requests[0]!.messages).toEqual(history);
    for (const [index, message] of requests[0]!.messages.entries()) {
      expect(message).toBe(history[index]!);
    }
  });
});

describe("the model, once per round", () => {
  test("each round asks once, with the conversation so far and the tools listed that round", async () => {
    const { model, requests } = scripted([callRound(["a", "probe"]), textRound("Done.")]);
    await run({ model, tools: registry({ probe: {} }), system: [{ text: "A" }, { text: "B" }] });
    expect(requests).toHaveLength(2);
    expect(requests[0]!.messages).toEqual([USER]);
    expect(requests[1]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(requests[1]!.tools.map((t) => t.name)).toEqual(["probe"]);
    expect(requests[0]!.system).toEqual([{ text: "A" }, { text: "B" }]);
  });

  test("fromStreamingClient reads streamChat on every round and projects the request", async () => {
    const seen: { messages: object[]; tools: object[]; system: string }[] = [];
    const client: StreamingClient = {
      async *streamChat() {
        yield { type: "done", stopReason: "stop" };
      },
    };
    let round = 0;
    client.streamChat = async function* streamChat(messages, tools, system) {
      seen.push({ messages, tools, system });
      round += 1;
      yield* round === 1 ? callRound(["a", "probe"]) : textRound("Done.");
    };
    await run({
      model: fromStreamingClient(client),
      tools: registry({ probe: {} }),
      system: [{ text: "Sys" }, { text: "tem" }],
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.system).toBe("System");
    expect(seen[0]!.messages).toEqual([{ role: "user", content: "Do it." }]);
    expect(seen[1]!.messages).toEqual([
      { role: "user", content: "Do it." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "a", type: "function", function: { name: "probe", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "a", content: '{"success":true,"summary":"probe done."}' },
    ]);
    expect(JSON.stringify(seen[0]!.tools)).toBe(
      JSON.stringify(registry({ probe: {} }).listForLLM()),
    );
    expect(joinSystem([])).toBe("");
  });

  test("usage carries the frame as streamed and the prompt's estimate; the outcome sums it", async () => {
    const usage = (inputTokens: number): StreamEvent => ({
      type: "usage",
      inputTokens,
      outputTokens: 1,
      reasoningTokens: 2,
    });
    const { model } = scripted([
      [
        ...callRound(["a", "probe"]).slice(0, -1),
        usage(10),
        { type: "done", stopReason: "tool_calls" },
      ],
      [{ type: "delta", content: "ok" }, usage(30), { type: "done", stopReason: "stop" }],
    ]);
    const { events, outcome } = await run({
      model,
      tools: registry({ probe: {} }),
      system: [{ text: "12345678" }],
    });
    const frame = events.find((e) => e.type === "usage");
    expect(frame).toMatchObject({ frame: usage(10), systemTokens: 2 });
    expect(outcome.usage.last).toEqual({ inputTokens: 30, outputTokens: 1, reasoningTokens: 2 });
    expect(outcome.usage.total).toEqual({ inputTokens: 40, outputTokens: 2, reasoningTokens: 4 });
  });

  test("a frame the engine does not know is ignored", async () => {
    const unknown = { type: "stream_start", wire: 2 } as unknown as StreamEvent;
    const { model } = scripted([[unknown, ...textRound("Hi.")]]);
    const { events, outcome } = await run({ model });
    expect(types(events)).toEqual(["turn_start", "round_start", "text", "round_end", "turn_end"]);
    expect(outcome.kind).toBe("complete");
  });

  test("a stream with no done frame is truncated, and its message says so", async () => {
    const { model } = scripted([[{ type: "delta", content: "cut" }]]);
    const { events, outcome } = await run({ model });
    expect(events.find((e) => e.type === "round_end")).toMatchObject({
      truncated: true,
      stopReason: "stop",
    });
    expect(outcome.appended[0]!.meta).toEqual({ incomplete: "truncated" });
    expect(outcome.kind).toBe("complete");
  });

  test("a model that throws rejects the outcome and the reader, and releases the lock", async () => {
    const lock = createTurnLock();
    const model: ModelFn = async function* model() {
      yield { type: "delta", content: "x" };
      throw new Error("chat URL lookup failed");
    };
    const turn = runTurn({ history: [USER], system: [], model, tools: registry({}), lock });
    const rejected = await turn.outcome.then(
      () => null,
      (error: unknown) => error,
    );
    expect((rejected as Error).message).toBe("chat URL lookup failed");
    expect(lock.active).toBeNull();
    const drained = await (async () => {
      for await (const _event of turn) {
        // Drain.
      }
    })().then(
      () => null,
      (error: unknown) => error,
    );
    expect((drained as Error).message).toBe("chat URL lookup failed");
  });
});

describe("how a turn ends", () => {
  test("an error frame: the hook hears it, the round is dropped, the turn ends in error", async () => {
    const heard: unknown[] = [];
    const { model } = scripted([
      [
        { type: "delta", content: "partial" },
        { type: "error", message: "Upstream 401", code: "cf_reconnect_required" },
      ],
    ]);
    const { events, outcome } = await run({
      model,
      hooks: { onStreamError: (error) => heard.push(error) },
    });
    expect(heard).toEqual([{ message: "Upstream 401", code: "cf_reconnect_required" }]);
    const end = events.find((e) => e.type === "round_end");
    expect(end).toMatchObject({ dropped: true, error: { message: "Upstream 401" } });
    expect(outcome).toMatchObject({
      kind: "error",
      error: { message: "Upstream 401", code: "cf_reconnect_required" },
      removedMessageId: end?.messageId,
      appended: [],
    });
  });

  test("an error frame with no message is not an error, whatever its code", async () => {
    const { model } = scripted([
      [
        { type: "delta", content: "ok" },
        { type: "error", message: "", code: "cf_upstream_error" },
      ],
    ]);
    const { outcome } = await run({ model });
    expect(outcome.kind).toBe("complete");
  });

  test("a turn that drew nothing ends empty, its round dropped", async () => {
    const { model } = scripted([
      [
        { type: "reasoning", content: "hmm" },
        { type: "done", stopReason: "stop" },
      ],
    ]);
    const { events, outcome } = await run({ model });
    expect(events.find((e) => e.type === "round_end")).toMatchObject({ dropped: true });
    expect(outcome).toMatchObject({
      kind: "empty",
      error: { message: DEFAULT_TURN_POLICY.emptyText },
      anchorMessageId: null,
    });
  });

  test("a silent last round is not empty when the turn drew something earlier", async () => {
    const { model } = scripted([callRound(["a", "probe"]), [{ type: "done", stopReason: "stop" }]]);
    const { outcome } = await run({ model, tools: registry({ probe: {} }) });
    expect(outcome.kind).toBe("complete");
    expect(outcome.anchorMessageId).toBe(outcome.appended[0]!.id);
  });

  test("a drawn message already in the history after the user's counts as drawn", async () => {
    const drawn: ChatMessage = {
      id: "a0",
      role: "assistant",
      blocks: [{ type: "text", text: "Earlier." }],
      timestamp: 1,
    };
    const silent = () => scripted([[{ type: "done", stopReason: "stop" }]]).model;
    const afterUser = await run({ model: silent(), history: [USER, drawn] });
    expect(afterUser.outcome.kind).toBe("complete");
    // With no user message at all, any drawn assistant message counts.
    const noUser = await run({ model: silent(), history: [drawn] });
    expect(noUser.outcome.kind).toBe("complete");
    const beforeUser = await run({ model: silent(), history: [drawn, USER] });
    expect(beforeUser.outcome.kind).toBe("empty");
  });

  test("a round stopped mid-stream is never empty, even when the provider reports stop", async () => {
    const host = new AbortController();
    const model: ModelFn = async function* model() {
      host.abort();
      yield { type: "done", stopReason: "stop" };
    };
    const { outcome } = await run({ model, signal: host.signal });
    expect(outcome.kind).toBe("cancelled");
  });

  test("a stopped round is never empty: the author ended it", async () => {
    const { model } = scripted([[{ type: "done", stopReason: "cancelled" }]]);
    const { outcome } = await run({ model });
    expect(outcome.kind).toBe("cancelled");
  });
});

describe("the work budget", () => {
  test("running out after applying something ends on the cap message, as the assistant", async () => {
    const rounds = Array.from({ length: 5 }, (_, i) => callRound([`c${i}`, "edit"]));
    const { model } = scripted(rounds);
    const { outcome } = await run({ model, tools: registry({ edit: { writes: true } }) });
    expect(outcome.kind).toBe("cap_partial");
    expect(outcome.workRounds).toBe(5);
    expect(outcome.cap?.text).toBe(
      DEFAULT_TURN_POLICY.capText({
        maxWorkRounds: 5,
        applied: Array.from({ length: 5 }, () => "edit done."),
        errors: [],
      }),
    );
    const cap = outcome.appended.at(-1)!;
    expect(cap).toMatchObject({
      id: outcome.cap?.messageId,
      role: "assistant",
      meta: { origin: "harness", kind: "round_cap" },
    });
    expect(outcome.anchorMessageId).toBe(cap.id);
  });

  test("applied means it wrote: a read with a summary applies nothing", async () => {
    const rounds = Array.from({ length: 5 }, (_, i) => callRound([`c${i}`, "look"]));
    const { model } = scripted(rounds);
    const { outcome } = await run({ model, tools: registry({ look: {} }) });
    expect(outcome.kind).toBe("cap_failed");
    expect(outcome.error?.message).toContain("I ran out of tool-call rounds (5)");
  });

  test("the cap lists each error once", () => {
    const text = DEFAULT_TURN_POLICY.capText({
      maxWorkRounds: 2,
      applied: [],
      errors: ["bad", "bad", "worse"],
    });
    expect(text).toBe(
      "I ran out of tool-call rounds (2) before finishing.\n\nErrors encountered:\n- bad\n- worse" +
        "\n\nYou can continue by sending another message, or try a more specific request.",
    );
  });

  test("a round whose calls were all interactive spends no work budget", async () => {
    const rounds = [
      ...Array.from({ length: 3 }, (_, i) => callRound([`q${i}`, "ask"])),
      textRound("Answered."),
    ];
    const { model } = scripted(rounds);
    const { outcome, events } = await run({
      model,
      tools: registry({ ask: { interactive: true } }),
      policy: { maxWorkRounds: 1 },
    });
    expect(outcome.kind).toBe("complete");
    expect(outcome.workRounds).toBe(0);
    expect(events.find((e) => e.type === "tool_start")).toMatchObject({ interactive: true });
  });

  test("the total ceiling ends a turn of questions that never stops", async () => {
    const rounds = Array.from({ length: 4 }, (_, i) => callRound([`q${i}`, "ask"]));
    const { model, requests } = scripted(rounds);
    const { outcome } = await run({
      model,
      tools: registry({ ask: { interactive: true } }),
      policy: { maxRounds: 3 },
    });
    expect(requests).toHaveLength(3);
    expect(outcome.kind).toBe("cap_failed");
  });

  test("a call id streamed twice is shown twice and runs once, as its last start", async () => {
    const ran: string[] = [];
    const { model } = scripted([
      [
        { type: "tool_call_start", id: "a", name: "first" },
        { type: "tool_call_delta", id: "a", args: "{}" },
        { type: "tool_call_start", id: "a", name: "second" },
        { type: "done", stopReason: "tool_calls" },
      ],
      textRound("ok"),
    ]);
    const tools = registry({
      first: {
        run: () => {
          ran.push("first");
        },
      },
      second: {
        run: () => {
          ran.push("second");
        },
      },
    });
    const { outcome } = await run({ model, tools });
    expect(ran).toEqual(["second"]);
    expect(outcome.appended[0]!.blocks).toEqual([
      { type: "tool_call", id: "a", name: "first", argumentsText: "{}" },
      { type: "tool_call", id: "a", name: "second", argumentsText: "" },
    ]);
  });

  test("a failed call's error is reported, and arguments that do not parse never execute", async () => {
    const ran: string[] = [];
    const { model } = scripted([callRound(["a", "edit", "{nope"]), textRound("ok")]);
    const { events } = await run({
      model,
      tools: registry({
        edit: {
          run: () => {
            ran.push("edit");
          },
        },
      }),
    });
    const result = events.find((e) => e.type === "tool_result");
    expect(result).toMatchObject({ result: { success: false } });
    expect(ran).toEqual([]);
  });
});

describe("Stop", () => {
  test("the turn's signal is armed before runTurn returns, and follows the host's", () => {
    const host = new AbortController();
    const { model } = scripted([textRound("x")]);
    const turn = runTurn({
      history: [USER],
      system: [],
      model,
      tools: registry({}),
      signal: host.signal,
    });
    expect(turn.signal.aborted).toBe(false);
    host.abort("stop pressed");
    expect(turn.signal.aborted).toBe(true);
    expect(turn.signal.reason).toBe("stop pressed");
  });

  test("an already-aborted host signal arrives aborted, with its reason", async () => {
    const host = new AbortController();
    host.abort("early");
    const { model, signals } = scripted([[{ type: "done", stopReason: "cancelled" }]]);
    const { outcome } = await run({ model, signal: host.signal });
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[0]!.reason).toBe("early");
    expect(outcome.kind).toBe("cancelled");
  });

  test("a Stop during a call stops the calls after it, and opens no further round", async () => {
    const host = new AbortController();
    const ran: string[] = [];
    const { model, requests } = scripted([callRound(["a", "first"], ["b", "second"])]);
    const { outcome, events } = await run({
      model,
      signal: host.signal,
      tools: registry({
        first: {
          run: (_args, ctx) => {
            ran.push("first");
            host.abort();
            expect(ctx.signal.aborted).toBe(true);
          },
        },
        second: {
          run: () => {
            ran.push("second");
          },
        },
      }),
    });
    expect(ran).toEqual(["first"]);
    expect(requests).toHaveLength(1);
    expect(outcome.kind).toBe("cancelled");
    // The call that was running still reports its result.
    expect(events.filter((e) => e.type === "tool_result").map((e) => e.callId)).toEqual(["a"]);
  });

  test("a Stop during the round's last call opens no further round", async () => {
    const turnRef: { cancel?: () => void } = {};
    const { model, requests } = scripted([callRound(["a", "only"]), textRound("never")]);
    const turn = runTurn({
      history: [USER],
      system: [],
      model,
      tools: registry({ only: { run: () => turnRef.cancel?.() } }),
    });
    turnRef.cancel = () => turn.cancel("superseded");
    const outcome = await turn.outcome;
    expect(requests).toHaveLength(1);
    expect(outcome.kind).toBe("cancelled");
    expect(turn.signal.reason).toBe("superseded");
  });

  test("a cancelled round runs none of the calls it streamed", async () => {
    const ran: string[] = [];
    const { model } = scripted([
      [...callRound(["a", "edit"]).slice(0, -1), { type: "done", stopReason: "cancelled" }],
    ]);
    const tools = registry({
      edit: {
        run: () => {
          ran.push("a");
        },
      },
    });
    const { outcome } = await run({ model, tools });
    expect(ran).toEqual([]);
    expect(outcome.kind).toBe("cancelled");
  });

  test("a call's signal is unlinked once it settles", async () => {
    const host = new AbortController();
    const signals: AbortSignal[] = [];
    const { model } = scripted([callRound(["a", "probe"]), textRound("ok")]);
    await run({
      model,
      signal: host.signal,
      tools: registry({
        probe: {
          run: (_args, ctx) => {
            signals.push(ctx.signal);
          },
        },
      }),
    });
    host.abort();
    expect(signals[0]!.aborted).toBe(false);
  });
});

describe("the call's context", () => {
  test("carries the call id, the turn's ledger, the session and an actor naming the model", async () => {
    const seen: ToolContext[] = [];
    const ledger = createLedger();
    const { model } = scripted([callRound(["a", "probe"]), textRound("ok")]);
    await run({
      model,
      turnId: "turn:2",
      ledger,
      modelInfo: { family: "openai-compat", model: "gpt-x" },
      sessionId: "s9",
      tools: registry({
        probe: {
          writes: true,
          run: (_args, ctx) => {
            seen.push(ctx);
          },
        },
      }),
    });
    expect(seen[0]!.callId).toBe("a");
    expect(seen[0]!.ledger).toBe(ledger);
    expect(ledger.writes).toHaveLength(1);
    expect(seen[0]!.actor).toEqual({
      id: "assistant:s9:turn:2",
      kind: "assistant",
      model: "gpt-x",
      sessionId: "s9",
      turnId: "turn:2",
    });
  });

  test("names the session facts' own id when none is given, and `local` when they have none", async () => {
    const actors: string[] = [];
    const probe = registry({
      probe: {
        run: (_args, ctx) => {
          actors.push(ctx.actor.id);
        },
      },
    });
    const { createSessionFacts } = await import("../src/tools.ts");
    await run({
      model: scripted([callRound(["a", "probe"]), textRound("ok")]).model,
      turnId: "t",
      session: createSessionFacts("s1"),
      tools: probe,
    });
    await run({
      model: scripted([callRound(["a", "probe"]), textRound("ok")]).model,
      turnId: "t",
      tools: probe,
    });
    expect(actors).toEqual(["assistant:s1:t", "assistant:local:t"]);
  });
});

describe("the lock", () => {
  test("a turn on a held lock throws LaneBusyError synchronously", () => {
    const lock = createTurnLock();
    const release = lock.acquire("other")!;
    const { model } = scripted([textRound("x")]);
    expect(() =>
      runTurn({ history: [USER], system: [], model, tools: registry({}), lock }),
    ).toThrow(LaneBusyError);
    release();
    expect(lock.active).toBeNull();
  });

  test("a turn holds the lock until its end, and releases it before turn_end is heard", async () => {
    const lock = createTurnLock();
    const { model } = scripted([textRound("x")]);
    let atEnd: string | null = "unset";
    const turn = runTurn({
      history: [USER],
      system: [],
      model,
      tools: registry({}),
      lock,
      turnId: "t1",
      onEvent: (event) => {
        if (event.type === "turn_end") {
          atEnd = lock.active;
        }
      },
    });
    expect(lock.active).toBe("t1");
    await turn.outcome;
    expect(atEnd).toBeNull();
  });

  test("a late release cannot free a newer turn's hold", () => {
    const lock = createTurnLock();
    const first = lock.acquire("a")!;
    first();
    const second = lock.acquire("b")!;
    first();
    expect(lock.active).toBe("b");
    expect(lock.acquire("c")).toBeNull();
    second();
    expect(lock.active).toBeNull();
  });

  test("LaneBusyError names the turn holding the lane", () => {
    expect(new LaneBusyError("t1").message).toBe("A turn is already running (t1).");
    expect(new LaneBusyError("t1").name).toBe("LaneBusyError");
  });
});

describe("the default policy", () => {
  test("estimates four characters to a token", () => {
    expect(DEFAULT_TURN_POLICY.estimateTokens("123456789")).toBe(3);
  });
});
