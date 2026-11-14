import "./with-dom.ts";
import { describe, expect, test } from "bun:test";
import { createChatState, createToolRegistry } from "@jxsuite/ai";
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";
import { createTab, disposeTab } from "../src/tabs/tab";
import { registerAiTools } from "../src/services/ai-tools";
import { runAgentLoop } from "../src/services/tool-executor";

function makeTab() {
  const document = { tagName: "div", children: [{ tagName: "p", textContent: "Hello" }] };
  return createTab({ document, id: "test" });
}

describe("ai agent loop on wire version 2", () => {
  /* A client built for wire version 2 takes the conversation in no provider's words (specs/ai.md
     §2.7): the same transcript the version 1 request is projected from, sent as it is. */
  test("a client that offers streamTurn is sent the neutral conversation instead", async () => {
    const tab = makeTab();
    const chatState = createChatState();
    const toolRegistry = createToolRegistry();
    registerAiTools(toolRegistry, { getTab: () => tab, validate: async () => [] });
    const turns: Parameters<NonNullable<StreamingClient["streamTurn"]>>[0][] = [];
    const rounds = [
      [
        { type: "tool_call_start", id: "c1", name: "add_child" },
        {
          type: "tool_call_delta",
          id: "c1",
          args: JSON.stringify({
            parentPath: [],
            index: 1,
            node: { tagName: "span", textContent: "added" },
          }),
        },
        { type: "tool_call_end", id: "c1" },
        { type: "done", stopReason: "tool_calls" },
      ] satisfies StreamEvent[],
      [{ type: "done", stopReason: "stop" } satisfies StreamEvent],
    ];
    let v1Calls = 0;
    const client: StreamingClient = {
      async *streamChat() {
        v1Calls += 1;
        yield { type: "done", stopReason: "stop" };
      },
      async *streamTurn(request) {
        turns.push(request);
        yield { family: "openai-compat", model: "m", type: "stream_start", wire: 2 };
        yield* rounds[turns.length - 1]!;
      },
    };

    chatState.sendMessage("add a span");
    await runAgentLoop({ chatState, streamingClient: client, toolRegistry, systemPrompt: "Sys" });

    expect(v1Calls).toBe(0);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.system).toEqual([{ text: "Sys" }]);
    // Round one carries the person's message alone: the turn's own empty placeholder is not sent.
    expect(turns[0]!.messages).toEqual([
      { role: "user", blocks: [{ type: "text", text: "add a span" }] },
    ]);
    expect(turns[1]!.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
    expect(turns[0]!.tools.map((tool) => tool.name)).toContain("add_child");
    expect(tab.doc.document.children).toHaveLength(2);
    expect(chatState.status).toBe("idle");
    disposeTab(tab);
  });
});
