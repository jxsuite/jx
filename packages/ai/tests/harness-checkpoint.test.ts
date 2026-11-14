/**
 * Tests for a suspended turn and its resume (specs/ai.md §3.12): the checkpoint, the two ways a
 * turn suspends, and the equivalence that makes resuming safe, which is that a turn suspended and
 * resumed at every call leaves the document an uninterrupted turn leaves.
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, test } from "bun:test";
import type { JxMutableNode } from "@jxsuite/schema/types";
import {
  DEFAULT_TURN_POLICY,
  checkResume,
  policyDigest,
  runTurn,
  turnDigests,
} from "../src/harness/index.ts";
import type {
  HarnessEvent,
  InteractionStrategy,
  TurnCheckpoint,
  TurnInput,
  TurnOutcome,
  TurnPolicy,
} from "../src/harness/index.ts";
import { docToolEntries } from "../src/jx-tools/index.ts";
import { canonicalJson, digest } from "../src/messages/index.ts";
import type { ChatMessage } from "../src/messages/index.ts";
import type { WireEvent } from "../src/streaming-client.ts";
import { createMemoryHarnessHost, scriptedModel } from "../src/testing/index.ts";
import { createToolDefinition, createToolRegistry } from "../src/tools.ts";
import type { ApprovalPolicy, InteractionResponse, ToolRegistry } from "../src/tools.ts";

const USER: ChatMessage = {
  blocks: [{ text: "Add three items.", type: "text" }],
  id: "u1",
  role: "user",
  timestamp: 1,
};

const START: JxMutableNode = { children: [], tagName: "ul" };

/** One round that adds an `li` per label, then stops for the calls to run. */
function addItems(labels: readonly string[]): WireEvent[] {
  return [
    ...labels.flatMap((label, index): WireEvent[] => {
      const id = `call_${label}`;
      const args = JSON.stringify({
        index,
        node: { tagName: "li", textContent: label },
        parentPath: [],
      });
      return [
        { id, name: "add_child", type: "tool_call_start" },
        { args, id, type: "tool_call_delta" },
        { id, type: "tool_call_end" },
      ];
    }),
    { stopReason: "tool_calls", type: "done" },
  ];
}

const DONE_TEXT: WireEvent[] = [
  { content: "Added.", type: "delta" },
  { stopReason: "stop", type: "done" },
];

/** Every write to the tree needs the author's approval; reading does not. */
const confirmWrites: ApprovalPolicy = (definition) =>
  definition.name === "add_child"
    ? { kind: "confirm", reason: "not-undoable", summary: "Add a child" }
    : { kind: "proceed" };

const APPROVE: InteractionResponse = { approved: true, kind: "approval" };

/** The policy most of these turns run under: every tree write is confirmed first. */
const CONFIRMING: Partial<TurnPolicy> = { approval: confirmWrites };

/** A turn's fixed parts over a fresh in-memory document. */
function setup(policy: Partial<TurnPolicy> = CONFIRMING) {
  const host = createMemoryHarnessHost(START);
  const tools: ToolRegistry = createToolRegistry();
  for (const entry of docToolEntries(host.documents, { reporter: host.reporter })) {
    tools.register(entry);
  }
  let clock = 100;
  let ids = 0;
  const base = {
    history: [USER],
    modelInfo: { family: "openai-compat", model: "m" },
    newId: () => `id_${String((ids += 1))}`,
    now: () => (clock += 1),
    policy,
    system: [{ text: "You build lists." }],
    tools,
    turnId: "turn_1",
  } satisfies Partial<TurnInput>;
  return { base, host };
}

/** Run a turn to its end, collecting its events. */
async function run(input: TurnInput): Promise<{ events: HarnessEvent[]; outcome: TurnOutcome }> {
  const events: HarnessEvent[] = [];
  const turn = runTurn({ ...input, onEvent: (event) => events.push(event) });
  return { events, outcome: await turn.outcome };
}

const INLINE: InteractionStrategy = { mode: "inline", resolve: () => Promise.resolve(APPROVE) };
const SUSPEND: InteractionStrategy = { mode: "suspend" };

describe("a turn that suspends on a call that needs a person", () => {
  test("ends suspended with a checkpoint, having run nothing of the call it waits on", async () => {
    const { base, host } = setup();
    const model = scriptedModel([addItems(["a", "b"]), DONE_TEXT]);
    const { events, outcome } = await run({ ...base, interactions: SUSPEND, model });

    expect(outcome.kind).toBe("suspended");
    expect(host.document()).toEqual(START);
    expect(outcome.writes).toEqual([]);
    const checkpoint = outcome.checkpoint!;
    expect(checkpoint).toMatchObject({
      applied: [],
      awaiting: {
        callId: "call_a",
        request: { kind: "approval", summary: "Add a child", tool: "add_child" },
      },
      errors: [],
      model: { family: "openai-compat", model: "m" },
      pending: { next: 0 },
      reason: "permission",
      round: 1,
      sessionId: null,
      turnId: "turn_1",
      v: 1,
      workRounds: 0,
      writes: [],
    });
    expect(checkpoint.pending!.calls.map((call) => call.callId)).toEqual(["call_a", "call_b"]);
    // The round's own message is in the checkpoint, so the transcript and the resume agree on it.
    expect(checkpoint.appended.map((message) => message.role)).toEqual(["assistant"]);
    expect(checkpoint.pending!.messageId).toBe(checkpoint.appended[0]!.id);
    // The checkpoint is reported before the turn ends, so a host can store it first.
    expect(events.map((event) => event.type).slice(-3)).toEqual([
      "interaction_request",
      "checkpoint",
      "turn_end",
    ]);
    expect(events.find((event) => event.type === "checkpoint")).toMatchObject({ checkpoint });
  });

  test("a checkpoint is plain JSON", async () => {
    const { base } = setup();
    const model = scriptedModel([addItems(["a"]), DONE_TEXT]);
    const { outcome } = await run({ ...base, interactions: SUSPEND, model });
    const text = JSON.stringify(outcome.checkpoint);
    // SAFETY: parsing the checkpoint's own JSON yields its JSON form, which the toEqual then proves.
    const copy = JSON.parse(text) as TurnCheckpoint;
    expect(copy).toEqual(outcome.checkpoint!);
    // Nothing in it is lost to JSON, so a store that keeps the text keeps the checkpoint.
    expect(JSON.stringify(copy)).toBe(text);
  });

  test("suspended and resumed at every call, it leaves the document an inline turn leaves", async () => {
    const labels = ["a", "b", "c"];
    const inline = setup();
    const uninterrupted = await run({
      ...inline.base,
      interactions: INLINE,
      model: scriptedModel([addItems(labels), DONE_TEXT]),
    });
    expect(uninterrupted.outcome.kind).toBe("complete");

    const suspended = setup();
    const model = scriptedModel([addItems(labels), DONE_TEXT]);
    let { outcome } = await run({ ...suspended.base, interactions: SUSPEND, model });
    const stops: number[] = [];
    while (outcome.kind === "suspended") {
      const checkpoint = outcome.checkpoint!;
      stops.push(checkpoint.pending!.next);
      suspended.host.checkpoints.set(checkpoint.turnId, checkpoint);
      ({ outcome } = await run({
        ...suspended.base,
        interactions: SUSPEND,
        model,
        resume: { checkpoint: suspended.host.checkpoints.get("turn_1")!, response: APPROVE },
      }));
    }

    // One stop per call, each one call further on, and no call run twice.
    expect(stops).toEqual([0, 1, 2]);
    expect(outcome.kind).toBe("complete");
    expect(suspended.host.document()).toEqual(inline.host.document());
    expect(suspended.host.document().children).toHaveLength(3);
    expect(outcome.writes).toHaveLength(uninterrupted.outcome.writes.length);
    expect(outcome.appended.map((message) => message.role)).toEqual(
      uninterrupted.outcome.appended.map((message) => message.role),
    );
    // The model was asked twice in all: the resumes re-asked for nothing.
    expect(model.requests).toHaveLength(2);
    expect(outcome.workRounds).toBe(1);
  });

  test("a resume says it is one, and settles the call with the answer it was given", async () => {
    const { base, host } = setup();
    const model = scriptedModel([addItems(["a"]), DONE_TEXT]);
    const first = await run({ ...base, interactions: SUSPEND, model });
    const { events, outcome } = await run({
      ...base,
      interactions: SUSPEND,
      model,
      resume: { checkpoint: first.outcome.checkpoint!, response: APPROVE },
    });
    expect(events[0]).toMatchObject({ resumed: true, type: "turn_start" });
    expect(events.slice(1, 4).map((event) => event.type)).toEqual([
      "tool_start",
      "interaction_settled",
      "write",
    ]);
    expect(outcome.kind).toBe("complete");
    expect(outcome.turnId).toBe("turn_1");
    expect(outcome.anchorMessageId).toBe(outcome.appended.at(-1)!.id);
    expect(host.document().children).toEqual([{ tagName: "li", textContent: "a" }]);
  });

  test("a declined approval is the call's result, and the turn goes on", async () => {
    const { base, host } = setup();
    const model = scriptedModel([addItems(["a"]), DONE_TEXT]);
    const first = await run({ ...base, interactions: SUSPEND, model });
    const { outcome } = await run({
      ...base,
      interactions: SUSPEND,
      model,
      resume: {
        checkpoint: first.outcome.checkpoint!,
        response: { approved: false, kind: "approval" },
      },
    });
    expect(outcome.kind).toBe("complete");
    expect(host.document()).toEqual(START);
  });

  test("a resume with no answer yet asks again, by the strategy it is given", async () => {
    const { base, host } = setup();
    const model = scriptedModel([addItems(["a"]), DONE_TEXT]);
    const first = await run({ ...base, interactions: SUSPEND, model });
    const checkpoint = first.outcome.checkpoint!;

    const again = await run({
      ...base,
      interactions: SUSPEND,
      model,
      resume: { checkpoint, response: null },
    });
    expect(again.outcome.kind).toBe("suspended");
    expect(again.outcome.checkpoint!.awaiting).toEqual(checkpoint.awaiting);
    expect(host.document()).toEqual(START);

    const asked: string[] = [];
    const inline = await run({
      ...base,
      interactions: {
        mode: "inline",
        resolve: (_request, at) => {
          asked.push(at.callId);
          return Promise.resolve(APPROVE);
        },
      },
      model,
      resume: { checkpoint, response: null },
    });
    expect(asked).toEqual(["call_a"]);
    expect(inline.outcome.kind).toBe("complete");
  });

  test("a question suspends as an interaction", async () => {
    const tools = createToolRegistry();
    tools.register(
      createToolDefinition({
        description: "Ask the author",
        execute: () => ({ success: true }),
        interaction: () => ({ context: "", kind: "question", options: [], question: "Which?" }),
        interactive: true,
        name: "ask",
        parameters: { properties: {}, type: "object" },
        settle: (_args, response) => ({
          data: response.kind === "question" ? response.answer : null,
          success: true,
        }),
      }),
    );
    const model = scriptedModel([
      [
        { id: "q1", name: "ask", type: "tool_call_start" },
        { args: "{}", id: "q1", type: "tool_call_delta" },
        { stopReason: "tool_calls", type: "done" },
      ],
      DONE_TEXT,
    ]);
    const input: TurnInput = {
      history: [USER],
      interactions: SUSPEND,
      model,
      system: [{ text: "S" }],
      tools,
    };
    const first = await run(input);
    expect(first.outcome.checkpoint).toMatchObject({ reason: "interaction" });
    const resumed = await run({
      ...input,
      resume: {
        checkpoint: first.outcome.checkpoint!,
        response: { answer: "The first", kind: "question", skipped: false },
      },
    });
    expect(resumed.outcome.kind).toBe("complete");
    // A round whose only call was a question spent no work budget, suspended or not.
    expect(resumed.outcome.workRounds).toBe(0);
    const reply = resumed.outcome.appended.find((message) => message.role === "tool");
    expect(reply!.blocks[0]).toMatchObject({ callId: "q1", type: "tool_result" });
    expect(JSON.stringify(reply!.blocks[0])).toContain("The first");
  });
});

describe("a resume is held to the turn it continues", () => {
  async function suspendedOnce() {
    const fixture = setup();
    const model = scriptedModel([addItems(["a"]), DONE_TEXT]);
    const { outcome } = await run({ ...fixture.base, interactions: SUSPEND, model });
    return { ...fixture, checkpoint: outcome.checkpoint!, model };
  }

  test.each<[string, (base: ReturnType<typeof setup>["base"]) => Partial<TurnInput>, string]>([
    [
      "the system prompt",
      () => ({ system: [{ text: "You build tables." }] }),
      "the system prompt changed since it was suspended",
    ],
    [
      "the policy",
      (base) => ({ policy: { ...base.policy, maxWorkRounds: 2 } }),
      "the turn policy changed since it was suspended",
    ],
    [
      "the tools",
      () => ({ tools: createToolRegistry() }),
      "the tools on offer changed since it was suspended",
    ],
    [
      "the model",
      () => ({ modelInfo: { family: "openai-compat", model: "another" } }),
      "the model changed since it was suspended",
    ],
  ])("a changed %s refuses it, before anything runs", async (_label, change, reason) => {
    const { base, checkpoint, host, model } = await suspendedOnce();
    const input: TurnInput = {
      ...base,
      interactions: SUSPEND,
      model,
      resume: { checkpoint, response: APPROVE },
      ...change(base),
    };
    expect(checkResume(checkpoint, input)).toEqual({ ok: false, reason });
    const { events, outcome } = await run(input);
    expect(outcome.kind).toBe("error");
    expect(outcome.error).toEqual({
      code: "resume_refused",
      message: `This turn cannot be resumed: ${reason}.`,
    });
    expect(events.map((event) => event.type)).toEqual(["turn_start", "turn_end"]);
    expect(model.requests).toHaveLength(1);
    expect(host.document()).toEqual(START);
  });

  test("the same turn input is accepted, with or without naming the model", async () => {
    const { base, checkpoint, model } = await suspendedOnce();
    const input: TurnInput = { ...base, interactions: SUSPEND, model };
    expect(checkResume(checkpoint, input)).toEqual({ ok: true });
    const { modelInfo: _unnamed, ...unnamed } = input;
    expect(checkResume(checkpoint, unnamed)).toEqual({ ok: true });
    expect(turnDigests(input)).toEqual({
      catalogDigest: checkpoint.catalogDigest,
      policyDigest: checkpoint.policyDigest,
      systemDigest: checkpoint.systemDigest,
    });
  });

  test("a resume whose signal is already aborted runs nothing", async () => {
    const { base, checkpoint, host, model } = await suspendedOnce();
    const controller = new AbortController();
    controller.abort();
    const { outcome } = await run({
      ...base,
      interactions: SUSPEND,
      model,
      resume: { checkpoint, response: APPROVE },
      signal: controller.signal,
    });
    expect(outcome.kind).toBe("cancelled");
    expect(host.document()).toEqual(START);
  });

  test("a Stop during the resumed round's last call opens no further round", async () => {
    const { base, checkpoint, host, model } = await suspendedOnce();
    const controller = new AbortController();
    const { outcome } = await run({
      ...base,
      hooks: { afterTool: () => controller.abort() },
      interactions: SUSPEND,
      model,
      resume: { checkpoint, response: APPROVE },
      signal: controller.signal,
    });
    expect(outcome.kind).toBe("cancelled");
    expect(host.document().children).toHaveLength(1);
    expect(model.requests).toHaveLength(1);
  });
});

describe("a turn that suspends on a provider error", () => {
  const failing = (code: string): WireEvent[] => [
    { content: "Half a rep", type: "delta" },
    { code, message: "Not now.", type: "error" },
  ];

  test.each<[string, TurnCheckpoint["reason"]]>([
    ["cf_reconnect_required", "credentials"],
    ["rate_limited", "rate_limit"],
    ["429", "rate_limit"],
  ])("code %s suspends between rounds, as %s", async (code, reason) => {
    const { base } = setup({ suspendOn: [code] });
    const model = scriptedModel([failing(code), DONE_TEXT]);
    const { events, outcome } = await run({ ...base, model });
    expect(outcome.kind).toBe("suspended");
    expect(outcome.error).toEqual({ code, message: "Not now." });
    expect(outcome.removedMessageId).toBeDefined();
    expect(outcome.checkpoint).toMatchObject({
      appended: [],
      awaiting: null,
      pending: null,
      reason,
      round: 0,
    });
    expect(events.map((event) => event.type).slice(-3)).toEqual([
      "round_end",
      "checkpoint",
      "turn_end",
    ]);

    // Resumed once the provider will answer: the model is asked again, from the same history.
    const resumed = await run({
      ...base,
      model,
      resume: { checkpoint: outcome.checkpoint!, response: null },
    });
    expect(resumed.outcome.kind).toBe("complete");
    expect(resumed.outcome.rounds).toBe(1);
    expect(model.requests[1]!.messages).toEqual(model.requests[0]!.messages);
    expect(resumed.outcome.appended.map((message) => message.role)).toEqual(["assistant"]);
  });

  test("a code the host did not name fails the turn, as it always has", async () => {
    const { base } = setup({ suspendOn: ["rate_limited"] });
    const { outcome } = await run({ ...base, model: scriptedModel([failing("500")]) });
    expect(outcome.kind).toBe("error");
    expect(outcome.checkpoint).toBeUndefined();
  });

  test("an error with no code fails the turn", async () => {
    const { base } = setup({ suspendOn: ["rate_limited"] });
    const model = scriptedModel([[{ message: "Broken.", type: "error" }]]);
    const { outcome } = await run({ ...base, model });
    expect(outcome.kind).toBe("error");
  });
});

describe("policyDigest", () => {
  test("is the same for the same policy, and differs with any number, switch or wording", () => {
    const base = policyDigest(DEFAULT_TURN_POLICY);
    expect(policyDigest({ ...DEFAULT_TURN_POLICY })).toBe(base);
    // The approval policy is the host's decision on resume, not part of the turn's identity.
    expect(policyDigest({ ...DEFAULT_TURN_POLICY, approval: confirmWrites })).toBe(base);
    const variants = [
      { maxRounds: 61 },
      { maxWorkRounds: 31 },
      { maxIdenticalRounds: 4 },
      { parallelReadOnly: true },
      { suspendOn: ["rate_limited"] },
      { emptyText: "Nothing." },
      { closingText: () => "Wrap up." },
    ].map((change) => policyDigest({ ...DEFAULT_TURN_POLICY, ...change }));
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });
});

describe("digest", () => {
  test("canonical JSON sorts keys at every depth and drops what JSON drops", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[{"y":2,"z":1}]},"b":1}',
    );
    expect(canonicalJson("text")).toBe('"text"');
    expect(canonicalJson(null)).toBe("null");
    // A value JSON cannot say at all is said as null, so it still has an identity.
    expect(canonicalJson(() => "a function")).toBe("null");
  });

  test("is one short identity per value, whatever order its members were written in", () => {
    expect(digest({ a: 1, b: [1, 2] })).toBe(digest({ b: [1, 2], a: 1 }));
    expect(digest({ a: 1 })).not.toBe(digest({ a: 2 }));
    expect(digest([1, 2])).not.toBe(digest([2, 1]));
    // FNV-1a 64 of the two bytes `""`: the scheme is pinned to a value anyone can check.
    expect(digest("")).toBe("f1:07cc7607b4949e25");
  });
});
