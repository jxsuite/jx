/**
 * Studio's side of the turn engine (specs/ai.md §3.8): the reducer that applies a turn's events to
 * the chat store, the hooks Studio runs between steps, and the proof that the engine's own
 * conversation and the chat store's agree on what each round sends.
 *
 * The recorded agent traces already hold the reducer to the old loop's calls, scenario by scenario.
 * These pin each mapping on its own, so a failure names the event rather than a trace.
 */
import "./with-dom.ts";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { createChatState } from "@jxsuite/ai/chat-state";
import { runTurn } from "@jxsuite/ai/harness";
import type { HarnessEvent, ModelFn, TurnOutcome } from "@jxsuite/ai/harness";
import { toChatMessages, toOpenAIMessages } from "@jxsuite/ai/messages";
import type { StreamEvent } from "@jxsuite/ai/streaming-client";
import { createToolDefinition, createToolRegistry } from "@jxsuite/ai/tools";

/** The model-reading calls the hooks made, in order: what a lapsed grant must and must not trigger. */
const probes: string[] = [];
const resetModelCache = mock(() => {
  probes.push("resetModelCache");
});
const ensureProxyProbe = mock(() => {
  probes.push("ensureProxyProbe");
});
void mock.module("../src/services/ai-models", () => ({ ensureProxyProbe, resetModelCache }));

const { applyHarnessEvent } = await import("../src/services/harness/chat-reducer");
const { studioTurnHooks } = await import("../src/services/harness/turn-hooks");
const { importRun, beginImportRun, resetImportRuns } = await import("../src/services/import-run");

afterEach(() => {
  resetImportRuns();
  resetModelCache.mockClear();
  ensureProxyProbe.mockClear();
  probes.length = 0;
});

const base = { v: 1 as const, seq: 0, turnId: "t" };

/**
 * A chat store whose method calls are logged by name and arguments.
 *
 * Every method the store has is replaced by a logging forwarder. The methods are closures over the
 * store (none reads `this`), so a forwarder calls the original directly, and a method that calls
 * another internally does so through its closure, unlogged, exactly as a reader of the store sees.
 */
function loggedChat() {
  const chat = createChatState({ model: "m" });
  const calls: [string, ...unknown[]][] = [];
  const log =
    <A extends unknown[], R>(name: string, method: (...args: A) => R) =>
    (...args: A): R => {
      calls.push([name, ...args]);
      return method(...args);
    };
  Object.assign(chat, {
    appendDelta: log("appendDelta", chat.appendDelta),
    appendReasoning: log("appendReasoning", chat.appendReasoning),
    appendToolCallDelta: log("appendToolCallDelta", chat.appendToolCallDelta),
    appendToolCallEnd: log("appendToolCallEnd", chat.appendToolCallEnd),
    appendToolCallStart: log("appendToolCallStart", chat.appendToolCallStart),
    appendToolResult: log("appendToolResult", chat.appendToolResult),
    beginAssistantTurn: log("beginAssistantTurn", chat.beginAssistantTurn),
    cancelStream: log("cancelStream", chat.cancelStream),
    clearChat: log("clearChat", chat.clearChat),
    clearUsage: log("clearUsage", chat.clearUsage),
    finishStream: log("finishStream", chat.finishStream),
    pushToolResultMessage: log("pushToolResultMessage", chat.pushToolResultMessage),
    recordUsage: log("recordUsage", chat.recordUsage),
    retryLast: log("retryLast", chat.retryLast),
    sendMessage: log("sendMessage", chat.sendMessage),
    setContextWarning: log("setContextWarning", chat.setContextWarning),
    setError: log("setError", chat.setError),
    setModel: log("setModel", chat.setModel),
    setTokenCount: log("setTokenCount", chat.setTokenCount),
    toMessagesArray: log("toMessagesArray", chat.toMessagesArray),
  } satisfies Partial<typeof chat>);
  return { chat, calls };
}

function outcome(kind: TurnOutcome["kind"], extra: Partial<TurnOutcome> = {}): TurnOutcome {
  return {
    kind,
    turnId: "t",
    anchorMessageId: null,
    rounds: 1,
    workRounds: 0,
    writes: [],
    usage: { last: null, total: null },
    appended: [],
    ...extra,
  };
}

describe("applyHarnessEvent", () => {
  test.each<[string, HarnessEvent, [string, ...unknown[]][]]>([
    [
      "round one answers into the placeholder",
      { ...base, type: "round_start", round: 1, workRounds: 0, messageId: "m1" },
      [],
    ],
    [
      "a later round opens a message",
      { ...base, type: "round_start", round: 2, workRounds: 1, messageId: "m2" },
      [["beginAssistantTurn"]],
    ],
    ["text", { ...base, type: "text", messageId: "m", text: "Hi" }, [["appendDelta", "Hi"]]],
    [
      "reasoning",
      { ...base, type: "reasoning", messageId: "m", text: "Hm" },
      [["appendReasoning", "Hm"]],
    ],
    [
      "a call starts",
      { ...base, type: "tool_call_start", messageId: "m", callId: "c", name: "n" },
      [["appendToolCallStart", "c", "n"]],
    ],
    [
      "a call's arguments",
      { ...base, type: "tool_call_delta", messageId: "m", callId: "c", args: "{}" },
      [["appendToolCallDelta", "c", "{}"]],
    ],
    [
      "a call ends",
      { ...base, type: "tool_call_end", messageId: "m", callId: "c" },
      [["appendToolCallEnd", "c"]],
    ],
    [
      "usage, as streamed",
      {
        ...base,
        type: "usage",
        messageId: "m",
        frame: { inputTokens: 1, outputTokens: 2, type: "usage" },
        systemTokens: 9,
      },
      [["recordUsage", { inputTokens: 1, outputTokens: 2, type: "usage" }, { systemTokens: 9 }]],
    ],
    [
      "a round that ends",
      {
        ...base,
        type: "round_end",
        messageId: "m",
        stopReason: "stop",
        truncated: false,
        dropped: false,
      },
      [["finishStream", "stop"]],
    ],
    [
      "a round that was dropped",
      {
        ...base,
        type: "round_end",
        messageId: "m",
        stopReason: "stop",
        truncated: false,
        dropped: true,
      },
      [],
    ],
    [
      "a result",
      {
        ...base,
        type: "tool_result",
        callId: "c",
        messageId: "m",
        toolMessageId: "r",
        result: { success: true, summary: "s" },
      },
      [
        ["appendToolResult", "c", { success: true, summary: "s" }],
        ["pushToolResultMessage", "c", '{"success":true,"summary":"s"}'],
      ],
    ],
    [
      "the cap after something applied",
      {
        ...base,
        type: "turn_end",
        outcome: outcome("cap_partial", { cap: { messageId: "k", text: "Capped." } }),
      },
      [["beginAssistantTurn"], ["appendDelta", "Capped."], ["finishStream", "length"]],
    ],
    [
      "the cap with nothing applied",
      { ...base, type: "turn_end", outcome: outcome("cap_failed", { error: { message: "Out." } }) },
      [["setError", "Out."]],
    ],
    [
      "an empty turn",
      { ...base, type: "turn_end", outcome: outcome("empty", { error: { message: "Empty." } }) },
      [["setError", "Empty."]],
    ],
    [
      "an error",
      { ...base, type: "turn_end", outcome: outcome("error", { error: { message: "401" } }) },
      [["setError", "401"]],
    ],
    ["a completed turn", { ...base, type: "turn_end", outcome: outcome("complete") }, []],
    ["a cancelled turn", { ...base, type: "turn_end", outcome: outcome("cancelled") }, []],
    ["turn_start", { ...base, type: "turn_start" }, []],
    ["tool_start", { ...base, type: "tool_start", callId: "c", name: "n", interactive: false }, []],
    [
      "a write",
      {
        ...base,
        type: "write",
        callId: "c",
        write: { disk: false, ok: true, path: "p", tool: "n" },
      },
      [],
    ],
  ])("%s", (_label, event, expected) => {
    const { chat, calls } = loggedChat();
    chat.sendMessage("go");
    calls.length = 0;
    applyHarnessEvent(chat, event);
    expect(calls).toEqual(expected);
  });

  test("progress reaches the import run its call keys", () => {
    const { chat } = loggedChat();
    beginImportRun("imp", { directory: "/sites/x", url: "https://example.com" });
    applyHarnessEvent(chat, {
      ...base,
      type: "tool_progress",
      callId: "imp",
      progress: { message: "Crawling…", phase: "crawl" },
    });
    expect(importRun("imp")?.message).toBe("Crawling…");
  });
});

describe("studioTurnHooks", () => {
  test("after a call, the batch follows the document the tools moved to", () => {
    const effects: string[] = [];
    const hooks = studioTurnHooks({
      onSuperseded: () => effects.push("onSuperseded"),
      reanchor: () => effects.push("reanchor"),
      superseded: () => false,
    });
    hooks.afterTool?.({ callId: "c", name: "n", result: { success: true } });
    expect(effects).toEqual(["reanchor"]);
  });

  test("after a call into a replaced conversation, the turn stops and nothing is re-anchored", () => {
    const effects: string[] = [];
    const hooks = studioTurnHooks({
      onSuperseded: () => effects.push("onSuperseded"),
      reanchor: () => effects.push("reanchor"),
      superseded: () => true,
    });
    hooks.afterTool?.({ callId: "c", name: "n", result: { success: true } });
    expect(effects).toEqual(["onSuperseded"]);
  });

  test("a lapsed hosted grant re-probes; any other stream error does not", () => {
    const hooks = studioTurnHooks({
      onSuperseded: mock(() => {}),
      reanchor: mock(() => {}),
      superseded: () => false,
    });
    hooks.onStreamError?.({ message: "Upstream 500", code: "cf_upstream_error" });
    hooks.onStreamError?.({ message: "No code" });
    expect(probes).toEqual([]);
    hooks.onStreamError?.({ message: "Reconnect", code: "cf_reconnect_required" });
    expect(probes).toEqual(["resetModelCache", "ensureProxyProbe"]);
  });
});

/* Studio projects each round's request from its chat store, the transcript of record. The engine
   keeps the same conversation in the neutral form, and a host without a chat store sends that one.
   They must say the same thing to the provider, round by round. */
describe("the engine's conversation and the chat store's", () => {
  test("project to the same request on every round", async () => {
    const registry = createToolRegistry();
    registry.register(
      createToolDefinition({
        name: "edit",
        description: "edit",
        parameters: { type: "object", properties: {} },
        execute: (_args, ctx) => {
          ctx.ledger.record({ disk: false, ok: true, path: "/p.json", tool: "edit" });
          return { success: true, summary: "Edited." };
        },
      }),
    );
    const rounds: StreamEvent[][] = [
      [
        { type: "reasoning", content: "Plan." },
        { type: "delta", content: "Editing." },
        { type: "tool_call_start", id: "a", name: "edit" },
        { type: "tool_call_delta", id: "a", args: '{"x":1}' },
        { type: "tool_call_end", id: "a" },
        { type: "tool_call_start", id: "b", name: "missing" },
        { type: "tool_call_end", id: "b" },
        { type: "done", stopReason: "tool_calls" },
      ],
      [
        { type: "tool_call_start", id: "c", name: "edit" },
        { type: "tool_call_delta", id: "c", args: "{nope" },
        { type: "done", stopReason: "stop" },
      ],
      [
        { type: "delta", content: "All done." },
        { type: "done", stopReason: "stop" },
      ],
    ];

    const chat = createChatState({ model: "m" });
    chat.sendMessage("first");
    chat.finishStream("stop");
    chat.messages.at(-1)!.content = "An earlier answer.";
    chat.sendMessage("second");

    const compared: number[] = [];
    let round = 0;
    const model: ModelFn = async function* model(request) {
      expect(toOpenAIMessages(request.messages)).toEqual(chat.toMessagesArray());
      compared.push(request.messages.length);
      round += 1;
      yield* rounds[round - 1]!;
    };
    const turn = runTurn({
      history: toChatMessages(chat.messages.slice(0, -1)),
      system: [{ text: "S" }],
      model,
      tools: registry,
      firstMessageId: chat.messages.at(-1)!.id,
      onEvent: (event) => {
        applyHarnessEvent(chat, event);
      },
    });
    const end = await turn.outcome;

    expect(compared).toHaveLength(3);
    expect(end.kind).toBe("complete");
    // And after the turn, the two still agree.
    const history = toChatMessages(chat.messages.slice(0, 3));
    expect(toOpenAIMessages([...history, ...end.appended])).toEqual(chat.toMessagesArray());
  });
});
