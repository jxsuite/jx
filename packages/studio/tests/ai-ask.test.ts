/**
 * Src/services/ai-ask.ts — the assistant's pause. `ask_user` declares the question it asks and what
 * the answer means, and the invoker settles it with the person's response without ever running a
 * body that waits (specs/ai.md §3.11). These cover the question it puts, the two results that are
 * easy to get backwards (a skip succeeds, a stop fails), and the call through the invoker.
 */
import { describe, expect, test } from "bun:test";
import { createToolRegistry } from "@jxsuite/ai";
import { createToolContext, invokeTool } from "@jxsuite/ai/tools";
import type { InteractionResponse, ToolArguments, ToolDefinition } from "@jxsuite/ai/tools";
import { registerAskTool } from "../src/services/ai-ask";

function registry() {
  const reg = createToolRegistry();
  registerAskTool(reg);
  return reg;
}

function askTool(): ToolDefinition {
  return registry().getDefinition("ask_user")!;
}

/** The question `ask_user` puts for `args`, or its refusal. */
function questionFor(args: ToolArguments) {
  return askTool().interaction!(args);
}

function settled(response: InteractionResponse) {
  return askTool().settle!({ question: "Which?" }, response);
}

describe("ai-ask — the question", () => {
  test("is advertised with a question, options and context", () => {
    const def = askTool();
    expect(def.name).toBe("ask_user");
    expect(def.interactive).toBe(true);
    expect(Object.keys(def.parameters.properties ?? {}).toSorted()).toEqual([
      "context",
      "options",
      "question",
    ]);
    expect(def.parameters.required).toEqual(["question"]);
  });

  test("is put as asked, trimmed", () => {
    expect(
      questionFor({ context: " Two drafts ", options: ["A", "B"], question: " Which? " }),
    ).toEqual({ context: "Two drafts", kind: "question", options: ["A", "B"], question: "Which?" });
  });

  test("options are cleaned and capped at six", () => {
    // The registry's validator only checks that it IS an array — what is inside is this tool's job.
    const request = questionFor({
      options: ["a", "", "  ", "b", "c", "d", "e", "f", "g", 7],
      question: "Which?",
    });
    expect(request).toMatchObject({ options: ["a", "b", "c", "d", "e", "f"] });
  });

  test("a wholly mistyped call still puts a question rather than throwing", () => {
    /* The registry's `validate()` refuses these shapes first, but it is a "lightweight structural
       check, not a JSON Schema validator", and a caller may register this tool into a registry of
       their own, so the tool cannot assume its arguments were checked. */
    expect(questionFor({ context: 42, options: "not an array", question: "Which?" })).toEqual({
      context: "",
      kind: "question",
      options: [],
      question: "Which?",
    });
  });

  test("refuses a blank question rather than showing an empty card", () => {
    expect(questionFor({ question: "   " })).toEqual({
      refusal: 'Pass "question" — the question to put to the user.',
    });
  });
});

describe("ai-ask — the answer", () => {
  test("an answer comes back as a success carrying the user's words", () => {
    const result = settled({ answer: "Neither — do C instead", kind: "question", skipped: false });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ answer: "Neither — do C instead", skipped: false });
    expect(result.summary).toContain("Neither — do C instead");
  });

  test("a skip is a SUCCESS — 'you decide' is a real answer", () => {
    /* Reporting it as an error would have the model apologise for having asked a fair question,
       and would end the turn on the error path, which deletes the streaming message. */
    const result = settled({ answer: null, kind: "question", skipped: true });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ answer: null, skipped: true });
    expect(result.summary).toContain("best judgment");
  });

  test("a stopped turn is a failure", () => {
    const result = settled({ answer: null, kind: "question", skipped: false });
    expect(result.success).toBe(false);
    expect(result.error).toContain("stopped");
  });
});

describe("ai-ask — through the invoker", () => {
  const call = (argumentsText: string) => ({ argumentsText, callId: "call_1", name: "ask_user" });

  test("needs the person before anything runs, then settles with their answer", async () => {
    const reg = registry();
    const first = await invokeTool(reg, call('{"question":"Which?"}'), createToolContext());
    expect(first).toEqual({
      request: { context: "", kind: "question", options: [], question: "Which?" },
      status: "needs_input",
    });
    const second = await invokeTool(reg, call('{"question":"Which?"}'), createToolContext(), {
      response: { answer: "This one", kind: "question", skipped: false },
    });
    expect(second).toEqual({
      executed: false,
      result: {
        data: { answer: "This one", skipped: false },
        success: true,
        summary: 'The user answered: "This one"',
      },
      status: "done",
    });
  });

  test("a call missing its question is refused before anyone is asked", async () => {
    const outcome = await invokeTool(registry(), call("{}"), createToolContext());
    expect(outcome).toEqual({
      executed: false,
      result: { error: 'Validation failed: Missing required argument: "question"', success: false },
      status: "done",
    });
  });

  test("executed directly, as a registry with no person would, it says nobody can answer", async () => {
    expect(await registry().execute("ask_user", { question: "Which?" })).toEqual({
      error: "ask_user needs a person, and none is available here.",
      success: false,
    });
  });
});
