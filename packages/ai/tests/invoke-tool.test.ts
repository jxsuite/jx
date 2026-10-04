/** `invokeTool`, the one way a model's call reaches a registry, and the shared message-id counter. */
import { describe, expect, test } from "bun:test";
import {
  createToolContext,
  createToolDefinition,
  createToolRegistry,
  invokeTool,
  normalizeToolResult,
} from "../src/tools.ts";
import type { ToolRegistry } from "../src/tools.ts";
import { nextMessageId } from "../src/message-id.ts";

function echoRegistry(): { registry: ToolRegistry; seen: object[] } {
  const seen: object[] = [];
  const registry = createToolRegistry();
  registry.register(
    createToolDefinition({
      name: "echo",
      description: "echo",
      parameters: { type: "object", properties: {} },
      execute(args) {
        seen.push(args);
        return { success: true, summary: "echoed", data: { at: new Date(0), skip: undefined } };
      },
    }),
  );
  return { registry, seen };
}

const call = (argumentsText: string, name = "echo") => ({ callId: "c1", name, argumentsText });

describe("invokeTool", () => {
  test("parses the arguments, executes with the context, and normalizes the result", async () => {
    const { registry, seen } = echoRegistry();
    const ctx = createToolContext({ callId: "c1" });
    const outcome = await invokeTool(registry, call('{"a":1}'), ctx);
    expect(seen).toEqual([{ a: 1 }]);
    expect(outcome).toEqual({
      status: "done",
      executed: true,
      result: { success: true, summary: "echoed", data: { at: "1970-01-01T00:00:00.000Z" } },
    });
  });

  test("empty arguments are no arguments", async () => {
    const { registry, seen } = echoRegistry();
    await invokeTool(registry, call(""), createToolContext());
    expect(seen).toEqual([{}]);
  });

  test.each([
    ["{nope", /^Failed to parse arguments: /],
    ["null", /^Failed to parse arguments: arguments must be a JSON object, got null$/],
    ["[1]", /^Failed to parse arguments: arguments must be a JSON object, got array$/],
    ["7", /^Failed to parse arguments: arguments must be a JSON object, got number$/],
  ])("arguments %p never reach the registry", async (text, error) => {
    const { registry, seen } = echoRegistry();
    const outcome = await invokeTool(registry, call(text), createToolContext());
    expect(outcome.executed).toBe(false);
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error).toMatch(error);
    expect(seen).toEqual([]);
  });

  test("the registry keeps its own texts, and one that throws is answered, not thrown", async () => {
    const { registry } = echoRegistry();
    const unknown = await invokeTool(registry, call("{}", "nope"), createToolContext());
    expect(unknown.result.error).toBe('Unknown tool: "nope"');

    const throwing: ToolRegistry = {
      ...registry,
      execute: () => Promise.reject(new Error("registry broke")),
    };
    const outcome = await invokeTool(throwing, call("{}"), createToolContext());
    expect(outcome).toEqual({
      status: "done",
      executed: true,
      result: { success: false, error: "Failed to parse arguments: registry broke" },
    });
  });

  test("a result JSON cannot carry is answered as one, never thrown", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const data of [circular, { big: 1n }]) {
      const registry = createToolRegistry();
      registry.register(
        createToolDefinition({
          name: "odd",
          description: "odd",
          parameters: { type: "object", properties: {} },
          execute: () => ({ success: true, data }),
        }),
      );
      const outcome = await invokeTool(registry, call("{}", "odd"), createToolContext());
      expect(outcome.executed).toBe(true);
      expect(outcome.result.success).toBe(false);
      expect(outcome.result.error).toStartWith(
        'Tool "odd" returned a result that cannot be serialized: ',
      );
    }
  });

  test("normalizeToolResult keeps the serialized bytes", () => {
    const result = { success: true, data: { n: 1, gone: undefined }, summary: "s" };
    expect(JSON.stringify(normalizeToolResult(result))).toBe(JSON.stringify(result));
  });
});

describe("nextMessageId", () => {
  test("mints ids in chat-state's scheme from a counter that only increases", () => {
    const a = nextMessageId();
    const b = nextMessageId();
    expect(a).toMatch(/^msg_\d+_\d+$/);
    expect(Number(b.split("_")[2])).toBeGreaterThan(Number(a.split("_")[2]));
  });
});
