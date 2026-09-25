import "./with-dom.ts";
import { describe, expect, test } from "bun:test";
import { createChatState, createToolRegistry } from "@jxsuite/ai";
import { createToolDefinition } from "@jxsuite/ai/tools";
import type { ToolRegistry } from "@jxsuite/ai/tools";
import type { Message } from "@jxsuite/ai/chat-state";
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";
import type { JxMutableNode } from "@jxsuite/schema/types";
import { createTab, disposeTab } from "../src/tabs/tab";
import type { Tab } from "../src/tabs/tab";
import { registerAiTools } from "../src/services/ai-tools";
import { runAgentLoop } from "../src/services/tool-executor";
import { answerAsk, pendingAsk, registerAskTool, resetAsk } from "../src/services/ai-ask";
import { recordWrite, resetAiWrites, writesForTurn } from "../src/services/ai-writes";
import { projectChip } from "../src/panels/ai-chat/chat-view";

/**
 * A scripted streaming client: each entry in `rounds` is the sequence of StreamEvents to yield on
 * the corresponding streamChat() call. Lets us drive runAgentLoop without a real LLM.
 *
 * @param {object[][]} rounds
 */
function fakeClient(
  rounds: StreamEvent[][],
): StreamingClient & { calls: () => number; sent: () => object[][] } {
  let call = 0;
  const sent: object[][] = [];
  return {
    calls: () => call,
    sent: () => sent,
    async *streamChat(messages: object[]) {
      sent.push(messages);
      const events = rounds[call] ?? [{ type: "done", stopReason: "stop" }];
      call += 1;
      for (const e of events) {
        yield e;
      }
    },
  };
}

/** Emit the event sequence for one tool call followed by a tool_calls stop. */
function toolCallRound(id: string, name: string, args: object): StreamEvent[] {
  return [
    { type: "tool_call_start", id, name },
    { type: "tool_call_delta", id, args: JSON.stringify(args) },
    { type: "tool_call_end", id },
    { type: "done", stopReason: "tool_calls" },
  ];
}

function makeTab(doc?: Record<string, unknown>) {
  const document = doc ?? { tagName: "div", children: [{ tagName: "p", textContent: "Hello" }] };
  return createTab({ document, id: "test" });
}

function harness(tab: Tab, validate?: (doc: unknown) => Promise<string[]>) {
  const chatState = createChatState({ model: "test" });
  const toolRegistry = createToolRegistry();
  registerAiTools(toolRegistry, { getTab: () => tab, ...(validate ? { validate } : {}) });
  return { chatState, toolRegistry: toolRegistry as ToolRegistry };
}

describe("ai agent loop — integration", () => {
  test("executes a tool call and mutates the live document", async () => {
    const tab = makeTab();
    const { chatState, toolRegistry } = harness(tab, async () => []);
    const client = fakeClient([
      toolCallRound("c1", "add_child", {
        parentPath: [],
        index: 1,
        node: { tagName: "span", textContent: "added" },
      }),
      [{ type: "done", stopReason: "stop" }],
    ]);

    chatState.sendMessage("add a span");
    await runAgentLoop({ chatState, streamingClient: client, toolRegistry, systemPrompt: "" });

    const children = tab.doc.document.children as (JxMutableNode | string)[];
    expect(children).toHaveLength(2);
    expect((children[1] as JxMutableNode).tagName).toBe("span");
    expect(tab.history.index).toBe(1); // One undoable transaction
    expect(chatState.status).toBe("idle");
    disposeTab(tab);
  });

  /* Workers AI (and other OpenAI-compatible backends) can report `finish_reason: "stop"` on a turn
     that streamed tool calls. The calls are what decide whether tools run. */
  test("runs streamed tool calls even when the backend reports a plain stop", async () => {
    const tab = makeTab();
    const { chatState, toolRegistry } = harness(tab, async () => []);
    const round = toolCallRound("c1", "add_child", {
      parentPath: [],
      index: 1,
      node: { tagName: "span", textContent: "added" },
    });
    round[round.length - 1] = { type: "done", stopReason: "stop" };
    const client = fakeClient([round, [{ type: "done", stopReason: "stop" }]]);

    chatState.sendMessage("add a span");
    await runAgentLoop({ chatState, streamingClient: client, toolRegistry, systemPrompt: "" });

    const children = tab.doc.document.children as (JxMutableNode | string)[];
    expect(children).toHaveLength(2);
    expect(client.calls()).toBe(2); // The result went back to the model
    expect(chatState.status).toBe("idle");
    disposeTab(tab);
  });

  /* Stop is the one control that must not be outrun. Letting streamed calls run whatever the stop
     reason regressed this: a call whose arguments were complete when the author pressed Stop was
     applied anyway, and the loop streamed another round on the aborted signal. */
  test("a round the author stopped runs nothing it streamed", async () => {
    const tab = makeTab();
    const { chatState, toolRegistry } = harness(tab, async () => []);
    const controller = new AbortController();
    const round = toolCallRound("c1", "set_text", { path: ["children", 0], value: "AFTER STOP" });
    const client = fakeClient([[...round.slice(0, -1), { type: "done", stopReason: "cancelled" }]]);
    const inner = client.streamChat.bind(client);
    client.streamChat = async function* streamChat(...args: Parameters<typeof inner>) {
      for await (const event of inner(...args)) {
        if (event.type === "done") {
          controller.abort(); // The author pressed Stop as the calls finished streaming
        }
        yield event;
      }
    };

    chatState.sendMessage("change the text");
    await runAgentLoop({
      chatState,
      streamingClient: client,
      toolRegistry,
      systemPrompt: "",
      signal: controller.signal,
    });

    const children = tab.doc.document.children as JxMutableNode[];
    expect(children[0]).toEqual({ tagName: "p", textContent: "Hello" });
    expect(client.calls()).toBe(1);
    expect(chatState.messages.some((m) => m.role === "tool")).toBe(false);
    disposeTab(tab);
  });

  /* The finish reason alone, with a signal that is still live: `cancelled` is what every client
     reports for a Stop, and it must suppress the calls without the abort check's help. */
  test("a round that ends cancelled runs nothing, even before the signal reads aborted", async () => {
    const tab = makeTab();
    const { chatState, toolRegistry } = harness(tab, async () => []);
    const round = toolCallRound("c1", "set_text", { path: ["children", 0], value: "CANCELLED" });
    const client = fakeClient([[...round.slice(0, -1), { type: "done", stopReason: "cancelled" }]]);

    chatState.sendMessage("change the text");
    await runAgentLoop({
      chatState,
      streamingClient: client,
      toolRegistry,
      systemPrompt: "",
      signal: new AbortController().signal,
    });

    expect((tab.doc.document.children as JxMutableNode[])[0]).toEqual({
      tagName: "p",
      textContent: "Hello",
    });
    expect(client.calls()).toBe(1);
    expect(chatState.messages.some((m) => m.role === "tool")).toBe(false);
    disposeTab(tab);
  });

  test("a Stop that lands between two calls stops the second", async () => {
    const tab = makeTab();
    const controller = new AbortController();
    const chatState = createChatState({ model: "test" });
    const toolRegistry = createToolRegistry();
    registerAiTools(toolRegistry, { getTab: () => tab, validate: async () => [] });
    const ran: string[] = [];
    toolRegistry.register(
      createToolDefinition({
        name: "first",
        description: "stops the turn while it runs",
        parameters: { type: "object", properties: {} },
        async execute() {
          ran.push("first");
          controller.abort();
          return { success: true };
        },
      }),
    );
    toolRegistry.register(
      createToolDefinition({
        name: "second",
        description: "must not run after the Stop",
        parameters: { type: "object", properties: {} },
        async execute() {
          ran.push("second");
          return { success: true };
        },
      }),
    );
    const client = fakeClient([
      [
        { type: "tool_call_start", id: "a", name: "first" },
        { type: "tool_call_end", id: "a" },
        { type: "tool_call_start", id: "b", name: "second" },
        { type: "tool_call_end", id: "b" },
        { type: "done", stopReason: "tool_calls" },
      ],
    ]);

    chatState.sendMessage("do both");
    await runAgentLoop({
      chatState,
      streamingClient: client,
      toolRegistry: toolRegistry as ToolRegistry,
      systemPrompt: "",
      signal: controller.signal,
    });

    expect(ran).toEqual(["first"]);
    expect(client.calls()).toBe(1);
    disposeTab(tab);
  });

  test("records the provider's usage count on the chat state", async () => {
    const tab = makeTab();
    const { chatState, toolRegistry } = harness(tab, async () => []);
    const client = fakeClient([
      [
        { type: "delta", content: "Done." },
        { type: "usage", inputTokens: 640, outputTokens: 12 },
        { type: "done", stopReason: "stop" },
      ],
    ]);

    chatState.sendMessage("hello");
    await runAgentLoop({
      chatState,
      streamingClient: client,
      toolRegistry,
      systemPrompt: "p".repeat(400),
    });

    expect(chatState.usage).toEqual({
      contextTokens: 652,
      inputTokens: 640,
      lastMessageId: chatState.messages[1]!.id,
      messageCount: 2,
      outputTokens: 12,
      systemTokens: 100, // The prompt it covered, recorded so the next send can measure drift
    });
    expect(chatState.tokenCount).toBe(652);
    disposeTab(tab);
  });

  test("sends no empty assistant turn, and replays the reasoning it was given", async () => {
    /* Both halves are one provider's contract: DeepSeek's thinking mode 400s on an assistant turn
       with no reasoning_content, and the request used to carry two of them — the placeholder for
       the answer being generated, then the tool-call turn stripped of its reasoning. */
    const tab = makeTab();
    const { chatState, toolRegistry } = harness(tab, async () => []);
    const client = fakeClient([
      [
        { type: "reasoning", content: "They want a span. " },
        { type: "reasoning", content: "add_child does it." },
        ...toolCallRound("c1", "add_child", {
          parentPath: [],
          index: 1,
          node: { tagName: "span", textContent: "added" },
        }),
      ],
      [{ type: "done", stopReason: "stop" }],
    ]);

    chatState.sendMessage("add a span");
    await runAgentLoop({ chatState, streamingClient: client, toolRegistry, systemPrompt: "" });

    const firstRound = client.sent()[0] as { role: string }[];
    expect(firstRound.map((m) => m.role)).toEqual(["user"]);

    const secondRound = client.sent()[1] as { role: string; reasoning_content?: string }[];
    expect(secondRound.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(secondRound[1]!.reasoning_content).toBe("They want a span. add_child does it.");
    disposeTab(tab);
  });

  test("feeds schema errors back so the model can self-correct", async () => {
    const tab = makeTab();
    // Inject a validator that flags the document while the root tagName is "header" (no hyphen),
    // And is happy once it becomes "site-header" — simulating the schema eval signal.
    const validate = async (doc: unknown) =>
      (doc as JxMutableNode).tagName === "header" ? ["(root): invalid custom element tagName"] : [];
    const { chatState, toolRegistry } = harness(tab, validate);

    const client = fakeClient([
      // Round 1: introduce the bad tagName.
      toolCallRound("c1", "set_property", { path: [], key: "tagName", value: "header" }),
      // Round 2: the model reacts to the error and fixes it.
      toolCallRound("c2", "set_property", { path: [], key: "tagName", value: "site-header" }),
      // Round 3: done.
      [{ type: "done", stopReason: "stop" }],
    ]);

    chatState.sendMessage("rename root to header");
    await runAgentLoop({ chatState, streamingClient: client, toolRegistry, systemPrompt: "" });

    expect(tab.doc.document.tagName).toBe("site-header");
    // The first tool result must have surfaced the schema error to the model.
    const toolMsgs = chatState.messages.filter((m) => m.role === "tool");
    expect(toolMsgs[0]!.content).toContain("schema errors");
    expect(toolMsgs[0]!.content).toContain("invalid custom element tagName");
    // The corrected round reported success (no schema errors).
    expect(toolMsgs[1]!.content).toContain('"success":true');
    expect(chatState.status).toBe("idle");
    disposeTab(tab);
  });

  test("a run that hit the round cap AFTER applying changes is not an error (§7.4)", async () => {
    /* Partial success is not failure. `setError` paints the turn red and — in chat-state.ts —
       deletes the streaming message, so a run that made five edits and then hit the cap reported
       as an error that had also erased its own account of the five edits. */
    const tab = makeTab();
    const { chatState, toolRegistry } = harness(tab, async () => []);
    // Every round emits another tool call — the model never stops, but every call SUCCEEDS.
    const client = fakeClient(
      Array.from({ length: 10 }, (_, i) =>
        toolCallRound(`c${i}`, "set_property", { path: [], key: "id", value: `v${i}` }),
      ),
    );

    chatState.sendMessage("loop forever");
    await runAgentLoop({ chatState, streamingClient: client, toolRegistry, systemPrompt: "" });

    expect(client.calls()).toBe(5); // MAX_ROUNDS
    expect(chatState.status).toBe("idle");
    expect(chatState.error).toBeNull();
    const tail = chatState.messages.at(-1)!;
    expect(tail.role).toBe("assistant");
    expect(tail.content).toContain("ran out of tool-call rounds");
    expect(tail.content).toContain("Changes applied so far");
    // And the edits it is telling you about are really there.
    expect((tab.doc.document as Record<string, unknown>).id).toBe("v4");
    disposeTab(tab);
  });

  test("surfaces an upstream stream error and stops", async () => {
    const tab = makeTab();
    const { chatState, toolRegistry } = harness(tab, async () => []);
    const client = fakeClient([[{ type: "error", message: "upstream 500" }]]);

    chatState.sendMessage("hi");
    await runAgentLoop({ chatState, streamingClient: client, toolRegistry, systemPrompt: "" });

    expect(chatState.status).toBe("error");
    expect(chatState.error).toBe("upstream 500");
    expect(client.calls()).toBe(1); // Bailed after the first round
    disposeTab(tab);
  });

  test("summarizes accumulated tool errors (and ignores unknown events) at the round cap", async () => {
    const tab = makeTab();
    const { chatState, toolRegistry } = harness(tab, async () => []);
    // Every round emits an unrecognized event (default switch case) followed by a tool call that
    // Always fails (a text write to a path no node holds), so errors accumulate until the round cap
    // Is hit. `set_text` rather than the retired `remove_node`: deletion is `delete_node` now, a
    // Command projection this hand-only registry does not carry.
    const client = fakeClient(
      Array.from({ length: 6 }, () => [
        { type: "noop" } as unknown as StreamEvent, // Unknown event → default case
        { type: "tool_call_start", id: "c", name: "set_text" },
        {
          type: "tool_call_delta",
          id: "c",
          args: JSON.stringify({ path: ["children", 9], value: "x" }),
        },
        { type: "tool_call_end", id: "c" },
        { type: "done", stopReason: "tool_calls" },
      ]),
    );

    chatState.sendMessage("delete everything repeatedly");
    await runAgentLoop({ chatState, streamingClient: client, toolRegistry, systemPrompt: "" });

    expect(chatState.status).toBe("error");
    expect(chatState.error).toContain("ran out of tool-call rounds");
    expect(chatState.error).toContain("Errors encountered");
    expect(chatState.error).toContain("No node exists at path");
    disposeTab(tab);
  });

  test("reports a tool call whose arguments are malformed JSON", async () => {
    const tab = makeTab();
    const { chatState, toolRegistry } = harness(tab, async () => []);
    // Hand-craft a tool call whose accumulated arguments are not valid JSON.
    const client = fakeClient([
      [
        { type: "tool_call_start", id: "c1", name: "set_property" },
        { type: "tool_call_delta", id: "c1", args: "{not json" },
        { type: "tool_call_end", id: "c1" },
        { type: "done", stopReason: "tool_calls" },
      ],
      [{ type: "done", stopReason: "stop" }],
    ]);

    chatState.sendMessage("break it");
    await runAgentLoop({ chatState, streamingClient: client, toolRegistry, systemPrompt: "" });

    const toolMsg = chatState.messages.find((m) => m.role === "tool");
    expect(toolMsg!.content).toContain("Failed to parse arguments");
    expect(chatState.status).toBe("idle");
    disposeTab(tab);
  });
});

// ─── §7.4: the batch follows the tab it edits ────────────────────────────────

describe("cross-tab batching", () => {
  test("a turn that moves to a second document gives BOTH documents a history entry", async () => {
    /* `beginBatch(getTab())` ran once, against whichever tab was active when the loop started,
       and `endBatch()` pushed ITS snapshot. A turn whose tools then edited a second document
       closed the batch against the FIRST tab, so the second document got neither a history
       snapshot nor a collab publish — its edits were simply not undoable. */
    const first = createTab({ document: { children: [], tagName: "div" }, id: "first" });
    const second = createTab({ document: { children: [], tagName: "section" }, id: "second" });
    let current: Tab = first;

    const chatState = createChatState({ model: "test" });
    const toolRegistry = createToolRegistry();
    registerAiTools(toolRegistry, { getTab: () => current, validate: async () => [] });

    const beforeSecond = second.history.snapshots.length;
    const client = fakeClient([
      toolCallRound("a", "set_property", { key: "id", path: [], value: "one" }),
      toolCallRound("b", "set_property", { key: "id", path: [], value: "two" }),
    ]);
    // Between rounds the user (or a tool) moves to the other document.
    const originalStream = client.streamChat.bind(client);
    let round = 0;
    (client as { streamChat: unknown }).streamChat = async function* streamChat(
      ...args: unknown[]
    ) {
      round += 1;
      if (round === 2) {
        current = second;
      }
      yield* (originalStream as (...a: unknown[]) => AsyncGenerator<StreamEvent>)(...args);
    };

    chatState.sendMessage("edit both");
    await runAgentLoop({
      chatState,
      getTab: () => current,
      streamingClient: client as StreamingClient,
      systemPrompt: "",
      toolRegistry: toolRegistry as ToolRegistry,
    });

    expect((second.doc.document as Record<string, unknown>).id).toBe("two");
    expect(second.history.snapshots.length).toBeGreaterThan(beforeSecond);
    disposeTab(first);
    disposeTab(second);
  });
});

describe("ai agent loop — the interactive round budget", () => {
  /**
   * A registry holding just `ask_user`, plus a hook that answers each question as it appears.
   *
   * @param {(n: number) => string} reply - The nth answer, so a test can vary them.
   */
  function askHarness(reply: (n: number) => string = () => "yes") {
    const chatState = createChatState({ model: "test" });
    const toolRegistry = createToolRegistry();
    registerAskTool(toolRegistry);
    // `read_document` is the "work" tool below: a real, registered call that really succeeds, so
    // The budget is measured against work rather than against a tool that was never there.
    const tab = makeTab();
    registerAiTools(toolRegistry, { getTab: () => tab, validate: async () => [] });

    let answered = 0;
    // Settle each question on the microtask after it registers, standing in for a fast reader.
    const tick = setInterval(() => {
      if (pendingAsk()) {
        answered += 1;
        answerAsk(reply(answered));
      }
    }, 0);
    return {
      answered: () => answered,
      chatState,
      stop: () => {
        clearInterval(tick);
        disposeTab(tab);
        resetAsk();
      },
      toolRegistry,
    };
  }

  test("a round that only asked does not spend the work budget", async () => {
    /* MAX_ROUNDS bounds AUTONOMOUS work. A round that ends by blocking on a person cannot advance
       without them, which is the property the cap was ever a proxy for — so a conversation that
       asks three questions must still have its five rounds of work left. */
    const h = askHarness();
    const client = fakeClient([
      toolCallRound("a1", "ask_user", { question: "Which?" }),
      toolCallRound("a2", "ask_user", { question: "And then?" }),
      toolCallRound("a3", "ask_user", { question: "Sure?" }),
      ...Array.from({ length: 10 }, (_, i) => toolCallRound(`w${i}`, "read_document", {})),
    ]);

    h.chatState.sendMessage("ask me things");
    await runAgentLoop({
      chatState: h.chatState,
      streamingClient: client,
      systemPrompt: "",
      toolRegistry: h.toolRegistry as ToolRegistry,
    });
    h.stop();

    expect(h.answered()).toBe(3);
    // Three interactive rounds plus five that did work.
    expect(client.calls()).toBe(8);
  });

  test("a round that asked AND worked spends the budget", async () => {
    // The exemption is for rounds that only wait; a round that also edited is ordinary work.
    const h = askHarness();
    const client = fakeClient(
      Array.from({ length: 10 }, (_, i) => [
        { type: "tool_call_start", id: `a${i}`, name: "ask_user" },
        { type: "tool_call_delta", id: `a${i}`, args: JSON.stringify({ question: "Which?" }) },
        { type: "tool_call_end", id: `a${i}` },
        { type: "tool_call_start", id: `w${i}`, name: "read_document" },
        { type: "tool_call_delta", id: `w${i}`, args: "{}" },
        { type: "tool_call_end", id: `w${i}` },
        { type: "done", stopReason: "tool_calls" },
      ]) as StreamEvent[][],
    );

    h.chatState.sendMessage("ask and work");
    await runAgentLoop({
      chatState: h.chatState,
      streamingClient: client,
      systemPrompt: "",
      toolRegistry: h.toolRegistry as ToolRegistry,
    });
    h.stop();

    expect(client.calls()).toBe(5);
  });

  test("a model that only ever asks still terminates", async () => {
    // The human is the real backstop, but the loop must be provably terminating without them.
    const h = askHarness();
    const client = fakeClient(
      Array.from({ length: 40 }, (_, i) => toolCallRound(`a${i}`, "ask_user", { question: "?" })),
    );

    h.chatState.sendMessage("ask forever");
    await runAgentLoop({
      chatState: h.chatState,
      streamingClient: client,
      systemPrompt: "",
      toolRegistry: h.toolRegistry as ToolRegistry,
    });
    h.stop();

    expect(client.calls()).toBe(25); // MAX_TOTAL_ROUNDS
  });

  test("stopping the turn settles the question instead of hanging the loop", async () => {
    /* The loop AWAITS toolRegistry.execute, and `ask_user`'s promise is resolved by a human. If
       Stop did not reach it, the turn would wait forever on a reader who has left. */
    const chatState = createChatState({ model: "test" });
    const toolRegistry = createToolRegistry();
    registerAskTool(toolRegistry);
    const controller = new AbortController();
    const client = fakeClient([toolCallRound("a1", "ask_user", { question: "Which?" })]);

    chatState.sendMessage("ask me");
    const running = runAgentLoop({
      chatState,
      signal: controller.signal,
      streamingClient: client,
      systemPrompt: "",
      toolRegistry: toolRegistry as ToolRegistry,
    });

    // Let the round reach the tool, then stop the turn the way `assistant.stop` does.
    await new Promise((r) => {
      setTimeout(r, 0);
    });
    expect(pendingAsk()).not.toBeNull();
    controller.abort();

    await running;
    expect(pendingAsk()).toBeNull();
    resetAsk();
  });
});

// ─── J1.4: the turn is honest about how it ended ─────────────────────────────

describe("ai agent loop — how a turn ended", () => {
  /**
   * A registry with one `edit` tool that records a write the way a document tool does, and can stop
   * the turn from inside its call (standing in for the author pressing Stop while it runs).
   */
  function editHarness(opts: { ok?: boolean; stopDuring?: boolean } = {}) {
    const controller = new AbortController();
    const chatState = createChatState({ model: "test" });
    const toolRegistry = createToolRegistry();
    toolRegistry.register(
      createToolDefinition({
        name: "edit",
        description: "records one write",
        parameters: { type: "object", properties: {} },
        async execute() {
          const ok = opts.ok ?? true;
          recordWrite({ disk: false, ok, path: "/pages/index.json", tool: "Edit" });
          if (opts.stopDuring) {
            controller.abort();
          }
          return ok ? { success: true, summary: "Edited." } : { success: false, error: "No." };
        },
      }),
    );
    const run = (client: StreamingClient) =>
      runAgentLoop({
        chatState,
        signal: controller.signal,
        streamingClient: client,
        systemPrompt: "",
        toolRegistry: toolRegistry as ToolRegistry,
      });
    return { chatState, run };
  }

  const request = (messages: readonly Message[]) =>
    messages.findLast((m) => (m.toolCalls?.length ?? 0) > 0);

  test("a live chip shows the result the loop recorded, and an answered question its answer", async () => {
    const chatState = createChatState({ model: "test" });
    const toolRegistry = createToolRegistry();
    registerAskTool(toolRegistry);
    const client = fakeClient([
      toolCallRound("q1", "ask_user", { question: "Which pages?", options: ["Home", "Blog"] }),
      [{ type: "done", stopReason: "stop" }],
    ]);
    chatState.sendMessage("ask me");
    const running = runAgentLoop({
      chatState,
      streamingClient: client,
      systemPrompt: "",
      toolRegistry: toolRegistry as ToolRegistry,
    });
    await new Promise((r) => {
      setTimeout(r, 0);
    });
    answerAsk("Blog");
    await running;

    const record = chatState.messages.find((m) => m.toolCalls?.length)!.toolCalls![0]!;
    expect(record.result?.success).toBe(true);
    // The loop's record and the chip it draws, joined: the card shows the answer, not an open question.
    const chip = projectChip(record, { pendingId: pendingAsk()?.id ?? null });
    expect(chip.askState).toBe("answered");
    expect(chip.answer).toBe("Blog");
    resetAsk();
  });

  test("a Stop during the last call opens no further round", async () => {
    const h = editHarness({ stopDuring: true });
    const client = fakeClient([
      toolCallRound("c1", "edit", {}),
      [{ type: "done", stopReason: "stop" }],
    ]);
    h.chatState.sendMessage("edit it");
    await h.run(client);

    expect(client.calls()).toBe(1);
    expect(h.chatState.status).toBe("idle");
    // The call's reply is the last thing the turn wrote: no placeholder after it.
    expect(h.chatState.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(h.chatState.messages[1]!.toolCalls![0]!.result).toEqual({
      success: true,
      summary: "Edited.",
    });
  });

  test("a stream error removes its round's partial message, calls and all", async () => {
    const h = editHarness();
    const client = fakeClient([
      [
        { type: "delta", content: "Let me " },
        { type: "tool_call_start", id: "c1", name: "edit" },
        { type: "tool_call_delta", id: "c1", args: '{"half' },
        { type: "error", message: "upstream 500" },
      ],
    ]);
    h.chatState.sendMessage("edit it");
    await h.run(client);

    expect(h.chatState.status).toBe("error");
    expect(h.chatState.error).toBe("upstream 500");
    expect(h.chatState.messages.map((m) => m.role)).toEqual(["user"]);
    expect(h.chatState.pendingToolCalls).toEqual([]);
    // Nothing of the failed round reaches the next send.
    expect(h.chatState.toMessagesArray()).toEqual([{ role: "user", content: "edit it" }]);
  });

  test("a stream error after a round of work keeps that round and removes only its own partial", async () => {
    const h = editHarness();
    const client = fakeClient([
      toolCallRound("c1", "edit", {}),
      [
        { type: "delta", content: "Now the" },
        { type: "error", message: "upstream 500" },
      ],
    ]);
    h.chatState.sendMessage("edit it");
    await h.run(client);

    expect(h.chatState.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(h.chatState.messages[1]!.toolCalls![0]!.result?.success).toBe(true);
  });

  /* The changed-files summary and Restore render under the message the turn's writes are filed
     under, and only a DRAWN assistant message renders them (chat-view's projectRows). */
  test.each<[string, { ok?: boolean; stopDuring?: boolean }, StreamEvent[][], string]>([
    [
      "a reply that says something",
      {},
      [
        toolCallRound("c1", "edit", {}),
        [
          { type: "delta", content: "Done." },
          { type: "done", stopReason: "stop" },
        ],
      ],
      "reply",
    ],
    [
      "a final round that says nothing",
      {},
      [toolCallRound("c1", "edit", {}), [{ type: "done", stopReason: "stop" }]],
      "request",
    ],
    [
      "a Stop during the last call",
      { stopDuring: true },
      [toolCallRound("c1", "edit", {})],
      "request",
    ],
    [
      "a stream error in the next round",
      {},
      [
        toolCallRound("c1", "edit", {}),
        [
          { type: "delta", content: "Now" },
          { type: "error", message: "boom" },
        ],
      ],
      "request",
    ],
    [
      "the round cap after changes were applied",
      {},
      Array.from({ length: 6 }, (_, i) => toolCallRound(`c${i}`, "edit", {})),
      "reply",
    ],
    [
      "the round cap with nothing applied",
      { ok: false },
      Array.from({ length: 6 }, (_, i) => toolCallRound(`c${i}`, "edit", {})),
      "request",
    ],
  ])("the changes are filed under a drawn message: %s", async (_label, opts, rounds, anchor) => {
    resetAiWrites();
    const h = editHarness(opts);
    h.chatState.sendMessage("edit it");
    await h.run(fakeClient(rounds));

    const expected =
      anchor === "reply" ? h.chatState.messages.at(-1)! : request(h.chatState.messages)!;
    if (anchor === "reply") {
      expect(expected.role).toBe("assistant");
      expect(expected.content).not.toBe("");
    }
    expect(writesForTurn(expected.id).length).toBeGreaterThan(0);
    resetAiWrites();
  });

  test.each<[string, string]>([
    ["null", "null"],
    ["[1]", "array"],
    ["3", "number"],
    ['"x"', "string"],
    ["true", "boolean"],
  ])("arguments that parse to %s are refused with their type", async (args, type) => {
    const tab = makeTab();
    const { chatState, toolRegistry } = harness(tab, async () => []);
    const client = fakeClient([
      [
        { type: "tool_call_start", id: "c1", name: "set_property" },
        { type: "tool_call_delta", id: "c1", args },
        { type: "tool_call_end", id: "c1" },
        { type: "done", stopReason: "tool_calls" },
      ],
      [{ type: "done", stopReason: "stop" }],
    ]);
    chatState.sendMessage("break it");
    await runAgentLoop({ chatState, streamingClient: client, toolRegistry, systemPrompt: "" });

    const reply = chatState.messages.find((m) => m.role === "tool")!;
    expect(JSON.parse(reply.content)).toEqual({
      error: `Failed to parse arguments: arguments must be a JSON object, got ${type}`,
      success: false,
    });
    disposeTab(tab);
  });
});
