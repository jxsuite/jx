/**
 * The steps `invokeTool` takes before a tool body runs (specs/ai.md §3.11): an interaction tool is
 * asked and then settled, never executed, and any other tool is approved, denied or put to the
 * author first.
 */
import { describe, expect, test } from "bun:test";
import {
  createToolContext,
  createToolDefinition,
  createToolRegistry,
  DECLINED_SENTENCE,
  invokeTool,
  proceedAlways,
} from "../src/tools.ts";
import type { ApprovalPolicy, InteractionResponse, ToolResult } from "../src/tools.ts";

const ANSWER: InteractionResponse = { answer: "yes", kind: "question", skipped: false };

/** `ask` (an interaction tool) and `act` (an ordinary one), with every body that ran. */
function tools(settle: (response: InteractionResponse) => ToolResult = () => ({ success: true })) {
  const ran: string[] = [];
  const registry = createToolRegistry();
  registry.register(
    createToolDefinition({
      name: "ask",
      description: "ask",
      parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      interaction: (args) =>
        args.q === ""
          ? { refusal: "Ask something." }
          : { context: "", kind: "question", options: [], question: String(args.q) },
      settle: (_args, response) => settle(response),
      execute() {
        ran.push("ask");
        return { success: true };
      },
    }),
  );
  registry.register(
    createToolDefinition({
      name: "act",
      title: "Act on it",
      description: "act",
      parameters: { type: "object", properties: {} },
      execute() {
        ran.push("act");
        return { success: true, summary: "Acted." };
      },
    }),
  );
  return { ran, registry };
}

const call = (name: string, argumentsText = "{}") => ({ argumentsText, callId: "c1", name });

describe("an interaction tool", () => {
  test("is asked first and settled with the answer, and its body never runs", async () => {
    const { ran, registry } = tools((response) => ({ data: response, success: true }));
    expect(await invokeTool(registry, call("ask", '{"q":"Which?"}'), createToolContext())).toEqual({
      request: { context: "", kind: "question", options: [], question: "Which?" },
      status: "needs_input",
    });
    const settled = await invokeTool(registry, call("ask", '{"q":"Which?"}'), createToolContext(), {
      response: ANSWER,
    });
    expect(settled).toEqual({
      executed: false,
      result: { data: ANSWER, success: true },
      status: "done",
    });
    expect(ran).toEqual([]);
  });

  test("its refusal and failed validation are results, with nobody asked", async () => {
    const { registry } = tools();
    const cases: [args: string, error: string][] = [
      ['{"q":""}', "Ask something."],
      ["{}", 'Validation failed: Missing required argument: "q"'],
    ];
    for (const [args, error] of cases) {
      expect(await invokeTool(registry, call("ask", args), createToolContext())).toEqual({
        executed: false,
        result: { error, success: false },
        status: "done",
      });
    }
  });

  test("a settle that throws is answered as the tool's execution error", async () => {
    const { registry } = tools(() => {
      throw new Error("bad answer");
    });
    const outcome = await invokeTool(registry, call("ask", '{"q":"Which?"}'), createToolContext(), {
      response: ANSWER,
    });
    expect(outcome).toMatchObject({
      result: { error: 'Tool "ask" execution error: bad answer', success: false },
    });
  });
});

describe("the approval policy", () => {
  const confirm: ApprovalPolicy = () => ({
    kind: "confirm",
    reason: "destructive",
    summary: "It deletes the page.",
  });

  test("proceeds by default", async () => {
    const { ran, registry } = tools();
    expect(proceedAlways(registry.getDefinition("act")!, {})).toEqual({ kind: "proceed" });
    expect(await invokeTool(registry, call("act"), createToolContext())).toMatchObject({
      executed: true,
      result: { summary: "Acted." },
    });
    expect(ran).toEqual(["act"]);
  });

  test("a denied call is answered with the policy's sentence and never runs", async () => {
    const { ran, registry } = tools();
    const outcome = await invokeTool(registry, call("act"), createToolContext(), {
      approval: () => ({ kind: "deny", message: "Not here." }),
    });
    expect(outcome).toEqual({
      executed: false,
      result: { error: "Not here.", success: false },
      status: "done",
    });
    expect(ran).toEqual([]);
  });

  test("a call to confirm is put to the author, then runs only if they approve", async () => {
    const { ran, registry } = tools();
    expect(
      await invokeTool(registry, call("act"), createToolContext(), { approval: confirm }),
    ).toEqual({
      request: {
        kind: "approval",
        reason: "destructive",
        summary: "It deletes the page.",
        title: "Act on it",
        tool: "act",
      },
      status: "needs_input",
    });
    for (const response of [{ approved: false, kind: "approval" } as const, ANSWER]) {
      expect(
        await invokeTool(registry, call("act"), createToolContext(), {
          approval: confirm,
          response,
        }),
      ).toEqual({
        executed: false,
        result: { error: DECLINED_SENTENCE, success: false },
        status: "done",
      });
    }
    expect(ran).toEqual([]);
    await invokeTool(registry, call("act"), createToolContext(), {
      approval: confirm,
      response: { approved: true, kind: "approval" },
    });
    expect(ran).toEqual(["act"]);
  });

  /* Whether a write replaces a file is something a host has to look up, so a policy may answer
     later (specs/ai.md §3.11). The call waits for it, and nothing runs meanwhile. */
  test("a policy that answers later is waited for, on the first invoke and the second", async () => {
    const { ran, registry } = tools();
    const asked: string[] = [];
    const later: ApprovalPolicy = (definition) => {
      asked.push(definition.name);
      return Promise.resolve({ kind: "confirm", reason: "not-undoable", summary: "Replace it?" });
    };
    const first = await invokeTool(registry, call("act"), createToolContext(), { approval: later });
    expect(first).toMatchObject({
      request: { kind: "approval", reason: "not-undoable", summary: "Replace it?" },
      status: "needs_input",
    });
    expect(ran).toEqual([]);
    const second = await invokeTool(registry, call("act"), createToolContext(), {
      approval: later,
      response: { approved: true, kind: "approval" },
    });
    expect(second).toMatchObject({ executed: true, status: "done" });
    expect(ran).toEqual(["act"]);
    expect(asked).toEqual(["act", "act"]);

    const denied = await invokeTool(registry, call("act"), createToolContext(), {
      approval: () => Promise.resolve({ kind: "deny", message: "Not from here." }),
    });
    expect(denied).toMatchObject({ executed: false, result: { error: "Not from here." } });
    expect(ran).toEqual(["act"]);
  });

  test("a tool with no title is named by its name", async () => {
    const registry = createToolRegistry();
    registry.register(
      createToolDefinition({
        name: "bare",
        description: "bare",
        parameters: { type: "object", properties: {} },
        execute: () => ({ success: true }),
      }),
    );
    expect(
      await invokeTool(registry, call("bare"), createToolContext(), { approval: confirm }),
    ).toMatchObject({
      request: { title: "bare", tool: "bare" },
    });
  });

  test("an unknown tool is answered by the registry, with no policy asked", async () => {
    const { registry } = tools();
    expect(
      await invokeTool(registry, call("nope"), createToolContext(), {
        approval: () => {
          throw new Error("asked");
        },
      }),
    ).toMatchObject({ result: { error: 'Unknown tool: "nope"' } });
  });
});
