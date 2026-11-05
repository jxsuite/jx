/**
 * How Studio's side of a turn meets the engine's bounds (specs/ai.md §3.8): the closing round's
 * note on a request projected from the chat store, what a failed closing round leaves in the
 * transcript, and the reads a round runs at once.
 *
 * Apart from `ai-loop.test.ts` because that file is mirrored test for test by the recorded traces,
 * and nothing here describes a call sequence worth pinning.
 */
import "./with-dom.ts";
import { describe, expect, test } from "bun:test";
import { createChatState, createToolRegistry } from "@jxsuite/ai";
import { DEFAULT_TURN_POLICY } from "@jxsuite/ai/harness";
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";
import { createToolDefinition } from "@jxsuite/ai/tools";
import type { JsonObject } from "@jxsuite/schema/types";
import { registerAiTools } from "../src/services/ai-tools";
import { runAgentLoop } from "../src/services/tool-executor";
import { createTab, disposeTab } from "../src/tabs/tab";

/** A client that answers each request with the next script, and counts them. */
function fakeClient(rounds: StreamEvent[][]): StreamingClient & { calls: () => number } {
  let call = 0;
  return {
    calls: () => call,
    async *streamChat() {
      const events = rounds[call] ?? [{ type: "done", stopReason: "stop" }];
      call += 1;
      yield* events;
    },
  };
}

function toolCallRound(id: string, name: string, args: JsonObject): StreamEvent[] {
  return [
    { type: "tool_call_start", id, name },
    { type: "tool_call_delta", id, args: JSON.stringify(args) },
    { type: "tool_call_end", id },
    { type: "done", stopReason: "tool_calls" },
  ];
}

describe("ai agent loop — a turn that stops working still answers (ai.md §3.8)", () => {
  /** A registry with one read that never writes. */
  function readsOnly() {
    const toolRegistry = createToolRegistry();
    toolRegistry.register(
      createToolDefinition({
        name: "peek",
        description: "peek",
        parameters: { type: "object", properties: {} },
        annotations: {
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
          readOnlyHint: true,
        },
        execute: () => ({ success: true, summary: "Peeked." }),
      }),
    );
    return toolRegistry;
  }

  test("the note reaches the closing request and stays out of the transcript", async () => {
    const chatState = createChatState({ model: "test" });
    const sent: { role?: unknown; content?: unknown }[][] = [];
    const rounds = [
      toolCallRound("r0", "peek", { n: 0 }),
      [
        { type: "delta", content: "Here is what I found." },
        { type: "done", stopReason: "stop" },
      ] satisfies StreamEvent[],
    ];
    const streamingClient: StreamingClient = {
      async *streamChat(messages) {
        sent.push(messages.map((message) => ({ ...message })));
        yield* rounds[sent.length - 1] ?? [];
      },
    };

    chatState.sendMessage("what is here?");
    await runAgentLoop({
      chatState,
      policy: { maxWorkRounds: 1 },
      streamingClient,
      systemPrompt: "",
      toolRegistry: readsOnly(),
    });

    expect(sent[0]!.at(-1)).toMatchObject({ role: "user", content: "what is here?" });
    expect(sent[1]!.at(-1)).toMatchObject({
      role: "user",
      content: DEFAULT_TURN_POLICY.closingText("budget"),
    });
    expect(chatState.status).toBe("idle");
    expect(chatState.error).toBeNull();
    const shown = chatState.messages.map((message) => message.content);
    expect(shown).not.toContain(DEFAULT_TURN_POLICY.closingText("budget"));
    expect(chatState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Here is what I found.",
    });
  });

  test("a closing round that stopped midway leaves no partial message behind the cap", async () => {
    const tab = createTab({ document: { tagName: "div" }, id: "closing" });
    const chatState = createChatState({ model: "test" });
    const toolRegistry = createToolRegistry();
    registerAiTools(toolRegistry, { getTab: () => tab, validate: async () => [] });
    const client = fakeClient([
      toolCallRound("w0", "set_property", { path: [], key: "id", value: "v0" }),
      [
        { type: "delta", content: "Half a sent" },
        { type: "error", message: "upstream 500" },
      ],
    ]);

    chatState.sendMessage("edit");
    await runAgentLoop({
      chatState,
      policy: { maxWorkRounds: 1 },
      streamingClient: client,
      systemPrompt: "",
      toolRegistry,
    });

    expect(chatState.status).toBe("idle");
    const shown = chatState.messages.map((message) => message.content);
    expect(shown.join("\n")).not.toContain("Half a sent");
    expect(chatState.messages.at(-1)!.content).toContain("Changes applied so far");
    disposeTab(tab);
  });

  test("a model repeating itself is stopped long before the budget", async () => {
    const chatState = createChatState({ model: "test" });
    const client = fakeClient(
      Array.from({ length: 30 }, () => toolCallRound("same", "peek", { n: 1 })),
    );

    chatState.sendMessage("look");
    await runAgentLoop({
      chatState,
      streamingClient: client,
      systemPrompt: "",
      toolRegistry: readsOnly(),
    });

    // Three identical rounds, and the closing round.
    expect(client.calls()).toBe(4);
    expect(chatState.error).toContain("kept returning the same results");
  });

  test("Studio runs a round's neighbouring reads at once", async () => {
    const chatState = createChatState({ model: "test" });
    const toolRegistry = createToolRegistry();
    const overlap = { most: 0, running: 0 };
    const execute = async () => {
      overlap.running += 1;
      overlap.most = Math.max(overlap.most, overlap.running);
      await Promise.resolve();
      overlap.running -= 1;
      return { success: true };
    };
    for (const name of ["peek_a", "peek_b"]) {
      toolRegistry.register(
        createToolDefinition({
          name,
          description: name,
          parameters: { type: "object", properties: {} },
          annotations: {
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
            readOnlyHint: true,
          },
          execute,
        }),
      );
    }
    const client = fakeClient([
      [...toolCallRound("a", "peek_a", {}).slice(0, -1), ...toolCallRound("b", "peek_b", {})],
      [{ type: "done", stopReason: "stop" }],
    ]);

    chatState.sendMessage("look");
    await runAgentLoop({ chatState, streamingClient: client, systemPrompt: "", toolRegistry });

    expect(overlap.most).toBe(2);
  });
});
