import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createChatState } from "@jxsuite/ai";
import type { Message } from "@jxsuite/ai/chat-state";

/**
 * The catalogue's reported windows, doubled.
 *
 * `ai-models` reaches the platform layer and the settings kernel, and none of that is what these
 * tests are about — what matters here is only WHICH of the three sources the budget comes from.
 * Doubled rather than seeded through a real fetch so this file stays DOM-free.
 */
let reportedWindows: Record<string, number> = {};
void mock.module("../src/services/ai-models", () => ({
  modelContextWindow: (id: string) => reportedWindows[id],
}));

const { pruneOrphanToolMessages, trimContext } = await import("../src/services/context-manager");

beforeEach(() => {
  reportedWindows = {};
});

function longContent(tokens: number) {
  return "x".repeat(tokens * 4);
}

function pushMessages(
  chatState: ReturnType<typeof createChatState>,
  messages: Omit<Message, "id" | "timestamp">[],
) {
  for (const m of messages) {
    chatState.messages.push({
      id: `msg_${chatState.messages.length}`,
      timestamp: Date.now(),
      ...m,
    });
  }
}

describe("context-manager — trimContext", () => {
  test("no trimming when within budget", () => {
    const cs = createChatState({ model: "gpt-4" });
    pushMessages(cs, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);

    const result = trimContext(cs, "System prompt");
    expect(result).not.toBeNull();
    expect(result!.droppedCount).toBe(0);
    expect(result!.estimatedTokens).toBeGreaterThan(0);
    expect(cs.messages.length).toBe(2);
  });

  test("trims oldest messages when over budget", () => {
    const cs = createChatState({ model: "gpt-4" });
    const msgCount = 40;
    const msgs: Omit<Message, "id" | "timestamp">[] = [];
    for (let i = 0; i < msgCount; i++) {
      msgs.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: longContent(200),
      });
    }
    pushMessages(cs, msgs);

    const beforeCount = cs.messages.length;
    const result = trimContext(cs, longContent(500));

    expect(result).not.toBeNull();
    expect(result!.droppedCount).toBeGreaterThan(0);
    expect(cs.messages.length).toBeLessThan(beforeCount);
    expect(cs.messages[0]!.content).toContain("truncated");
  });

  test("preserves the most recent messages after trim", () => {
    const cs = createChatState({ model: "gpt-4" });
    const msgs: Omit<Message, "id" | "timestamp">[] = [];
    for (let i = 0; i < 40; i++) {
      msgs.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg-${i} ${longContent(200)}`,
      });
    }
    pushMessages(cs, msgs);

    trimContext(cs, longContent(500));

    const lastMsg = cs.messages.at(-1);
    expect(lastMsg!.content).toContain("msg-39");
  });

  test("trim does not orphan tool_calls (assistant with tool_calls kept iff tool result kept)", () => {
    const cs = createChatState({ model: "gpt-4" });
    const msgs: Omit<Message, "id" | "timestamp">[] = [];
    for (let i = 0; i < 30; i++) {
      msgs.push(
        { role: "user", content: longContent(200) },
        { role: "assistant", content: longContent(200) },
      );
    }
    msgs.push(
      { role: "user", content: longContent(200) },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc_1", name: "read_document", arguments: "{}" }],
      },
      { role: "tool", content: '{"success":true}', toolCallId: "tc_1" },
      { role: "user", content: "recent question" },
      { role: "assistant", content: "recent answer" },
    );
    pushMessages(cs, msgs);

    trimContext(cs, longContent(500));

    const remaining = cs.messages.filter(
      (m) => m.role !== "user" || !m.content.includes("truncated"),
    );
    const assistantWithTools = remaining.filter((m) => m.toolCalls && m.toolCalls.length > 0);
    for (const atc of assistantWithTools) {
      for (const tc of atc.toolCalls!) {
        const hasResponse = remaining.some((m) => m.role === "tool" && m.toolCallId === tc.id);
        expect(hasResponse).toBe(true);
      }
    }
  });

  test("sets contextWarning when trimming occurs", () => {
    const cs = createChatState({ model: "gpt-4" });
    const msgs: Omit<Message, "id" | "timestamp">[] = [];
    for (let i = 0; i < 40; i++) {
      msgs.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: longContent(200),
      });
    }
    pushMessages(cs, msgs);

    trimContext(cs, longContent(500));
    expect(cs.contextWarning).toBe(true);
  });

  test("model-aware budget uses correct window size", () => {
    const csSmall = createChatState({ model: "gpt-4" });
    const csLarge = createChatState({ model: "gpt-4o" });

    // The gpt-4 budget: 8192 × 0.8 = 6553 tokens. Fill well past that.
    const msgs: Omit<Message, "id" | "timestamp">[] = [];
    for (let i = 0; i < 30; i++) {
      msgs.push({ role: i % 2 === 0 ? "user" : "assistant", content: longContent(300) });
    }
    pushMessages(csSmall, msgs);
    pushMessages(csLarge, structuredClone(msgs));

    const r1 = trimContext(csSmall, longContent(500));
    const r2 = trimContext(csLarge, longContent(500));

    // The gpt-4 window is 8192, gpt-4o is 128k — same content should trigger trim on gpt-4 but not gpt-4o
    expect(r1!.droppedCount).toBeGreaterThan(0);
    expect(r2!.droppedCount).toBe(0);
  });

  test("extends the keep window backward to preserve a minimum of user/tool turns", () => {
    const cs = createChatState({ model: "gpt-4" });
    const msgs: Omit<Message, "id" | "timestamp">[] = [];
    // 5 leading user turns, then 20 assistant-only messages — the recent window (KEEP_RECENT=20)
    // Has zero user/tool turns, forcing the backward extension to reach the early user turns.
    for (let i = 0; i < 5; i++) {
      msgs.push({ role: "user", content: longContent(400) });
    }
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: "assistant", content: longContent(400) });
    }
    pushMessages(cs, msgs);

    const result = trimContext(cs, longContent(500));
    expect(result!.droppedCount).toBeGreaterThan(0);
    // At least MIN_USER_TURNS (3) user turns are preserved beyond the recent window.
    const preservedUsers = cs.messages.filter((m) => m.role === "user").length;
    expect(preservedUsers).toBeGreaterThanOrEqual(3);
  });

  test("cannot trim below the minimum turns: warns without dropping", () => {
    const cs = createChatState({ model: "gpt-4" });
    // Only two enormous user messages — over budget, but fewer than MIN_USER_TURNS exist, so the
    // Backward extension reaches index 0 and trimming bails out (keepFrom <= 0).
    pushMessages(cs, [
      { role: "user", content: longContent(5000) },
      { role: "user", content: longContent(5000) },
    ]);

    const result = trimContext(cs, longContent(500));
    expect(result!.droppedCount).toBe(0);
    expect(cs.contextWarning).toBe(true);
    expect(cs.messages.length).toBe(2); // Nothing dropped
  });
});

describe("context-manager — the provider's own count", () => {
  /* Every budget was an estimate at four characters per token. A reported count covers the
     transcript it was taken over exactly, so only what was added since needs estimating. */
  test("a reported count is used, plus an estimate of only the messages added since", () => {
    const cs = createChatState({ model: "gpt-4o" });
    pushMessages(cs, [
      { role: "user", content: "x".repeat(40) },
      { role: "assistant", content: "y".repeat(40) },
    ]);
    cs.recordUsage({ type: "usage", inputTokens: 900, outputTokens: 100 });
    pushMessages(cs, [{ role: "user", content: longContent(10) }]);

    const result = trimContext(cs, longContent(5000));
    // 1000 reported + (10 content + 4 framing) for the one new message; the prompt is inside 900.
    expect(result!.estimatedTokens).toBe(1014);
    expect(cs.tokenCount).toBe(1014);
  });

  test("a tool call added since the count is estimated with its name and arguments", () => {
    const cs = createChatState({ model: "gpt-4o" });
    pushMessages(cs, [{ role: "user", content: "go" }]);
    cs.recordUsage({ type: "usage", inputTokens: 500, outputTokens: 0 });
    pushMessages(cs, [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "x".repeat(8), arguments: "y".repeat(40) }],
      },
    ]);

    const result = trimContext(cs, "");
    // 500 reported + (0 content + 2 name + 10 args + 4 call framing) + 4 message framing.
    expect(result!.estimatedTokens).toBe(520);
  });

  test("what the system prompt has grown by since the count is added", () => {
    const cs = createChatState({ model: "gpt-4o" });
    pushMessages(cs, [{ role: "user", content: "go" }]);
    cs.recordUsage({ type: "usage", inputTokens: 700, outputTokens: 0 }, { systemTokens: 100 });

    // The prompt is rebuilt on every send; this one is 300 tokens, 200 more than the counted one.
    const result = trimContext(cs, longContent(300));
    expect(result!.estimatedTokens).toBe(900);
  });

  test("a prompt that shrank is subtracted, never below zero", () => {
    const cs = createChatState({ model: "gpt-4o" });
    pushMessages(cs, [{ role: "user", content: "go" }]);
    cs.recordUsage({ type: "usage", inputTokens: 50, outputTokens: 0 }, { systemTokens: 400 });

    const result = trimContext(cs, "");
    expect(result!.estimatedTokens).toBe(0);
  });

  /* Length alone cannot tell: Retry rewinds the transcript and the re-send grows it back to the
     same length, over different messages. */
  test("a retry that re-grows the transcript to the same length does not reuse the count", () => {
    const cs = createChatState({ model: "gpt-4o" });
    cs.sendMessage(longContent(10));
    cs.recordUsage({ type: "usage", inputTokens: 90_000, outputTokens: 1 });
    cs.finishStream("stop");
    cs.retryLast();
    cs.sendMessage(longContent(10));

    const result = trimContext(cs, longContent(2));
    // The estimate: 2 prompt + (10 + 4) for the user message; the empty placeholder is not sent.
    expect(result!.estimatedTokens).toBe(16);
  });

  test("the placeholder sendMessage pushes is not counted, since it is never sent", () => {
    const cs = createChatState({ model: "gpt-4o" });
    pushMessages(cs, [{ role: "user", content: "go" }]);
    cs.recordUsage({ type: "usage", inputTokens: 300, outputTokens: 0 });
    cs.sendMessage(longContent(10)); // A user message plus the empty assistant placeholder

    const result = trimContext(cs, "");
    expect(result!.estimatedTokens).toBe(300 + 10 + 4);
  });

  test("a count that is not finite falls back to the estimate", () => {
    const cs = createChatState({ model: "gpt-4o" });
    pushMessages(cs, [{ role: "user", content: longContent(10) }]);
    cs.recordUsage({ type: "usage", inputTokens: 5, outputTokens: 0 });
    cs.usage!.contextTokens = Number.NaN; // What a frame from before the guard could leave

    const result = trimContext(cs, "");
    expect(result!.estimatedTokens).toBe(10 + 4);
    expect(result!.droppedCount).toBe(0);
  });

  test("a transcript shorter than the count falls back to the estimate", () => {
    const cs = createChatState({ model: "gpt-4o" });
    pushMessages(cs, [
      { role: "user", content: longContent(10) },
      { role: "assistant", content: longContent(10) },
    ]);
    cs.recordUsage({ type: "usage", inputTokens: 50_000, outputTokens: 1 });
    cs.messages.pop(); // Rewound beneath the count, as retry does

    const result = trimContext(cs, longContent(2));
    expect(result!.estimatedTokens).toBe(2 + 10 + 4);
  });

  test("trimming forgets the count, because it described the dropped transcript", () => {
    const cs = createChatState({ model: "gpt-4" });
    const msgs: Omit<Message, "id" | "timestamp">[] = [];
    for (let i = 0; i < 40; i++) {
      msgs.push({ role: i % 2 === 0 ? "user" : "assistant", content: longContent(200) });
    }
    pushMessages(cs, msgs);
    cs.recordUsage({ type: "usage", inputTokens: 8000, outputTokens: 50 });

    const result = trimContext(cs, "");
    expect(result!.droppedCount).toBeGreaterThan(0);
    expect(cs.usage).toBeNull();
  });
});

describe("context-manager — the model's context window", () => {
  /** Fill a state with `count` messages of `tokens` each, so a budget can be crossed on purpose. */
  function stateWith(model: string, count: number, tokens: number) {
    const cs = createChatState({ model });
    const msgs: Omit<Message, "id" | "timestamp">[] = [];
    for (let i = 0; i < count; i++) {
      msgs.push({ role: i % 2 === 0 ? "user" : "assistant", content: longContent(tokens) });
    }
    pushMessages(cs, msgs);
    return cs;
  }

  test("a server-reported window beats the prefix table", () => {
    /* The table can only know the names it was written with, and it is also free to be WRONG about
       one it does know — the backend serving the model is the better authority either way. */
    const unreported = stateWith("gpt-4", 30, 300); // Table says 8192 → budget 6553.
    expect(trimContext(unreported, longContent(500))!.droppedCount).toBeGreaterThan(0);

    reportedWindows["gpt-4"] = 1_000_000;
    const reported = stateWith("gpt-4", 30, 300);
    expect(trimContext(reported, longContent(500))!.droppedCount).toBe(0);
  });

  test("an unreported model falls back to the prefix table", () => {
    // The backend answered about a different model entirely, and about this one said nothing.
    reportedWindows["@cf/meta/llama-4"] = 128_000;

    const small = stateWith("gpt-4", 30, 300);
    expect(trimContext(small, longContent(500))!.droppedCount).toBeGreaterThan(0);

    const large = stateWith("gpt-4o", 30, 300); // Table says 128k.
    expect(trimContext(large, longContent(500))!.droppedCount).toBe(0);
  });

  test("a model in neither the report nor the table gets the conservative default", () => {
    /* This is the case that was silently costing the most: every `@cf/*` id missed the table, so a
       128k managed model was budgeted at 32k and started dropping turns at about 25.6k. */
    const defaulted = stateWith("@cf/meta/llama-4", 30, 1000); // ~30k tokens vs a 25.6k budget.
    expect(trimContext(defaulted, longContent(500))!.droppedCount).toBeGreaterThan(0);

    reportedWindows["@cf/meta/llama-4"] = 128_000;
    const declared = stateWith("@cf/meta/llama-4", 30, 1000);
    expect(trimContext(declared, longContent(500))!.droppedCount).toBe(0);
  });

  test("a nonsensical reported window is ignored rather than obeyed", () => {
    // A zero would make every budget zero and trim the whole conversation on the first send.
    reportedWindows["gpt-4o"] = 0;
    const cs = stateWith("gpt-4o", 30, 300);
    expect(trimContext(cs, longContent(500))!.droppedCount).toBe(0);
  });
});

describe("context-manager — pruneOrphanToolMessages", () => {
  /** An assistant turn that requested one tool call, and the reply that answers it. */
  function pair(callId: string): Omit<Message, "id" | "timestamp">[] {
    return [
      {
        role: "assistant",
        content: "Working on it",
        toolCalls: [{ id: callId, name: "read_file", arguments: "{}" }],
      },
      { role: "tool", content: '{"success":true}', toolCallId: callId },
    ];
  }

  test("a well-formed history is left exactly as it is", () => {
    const cs = createChatState({ model: "gpt-4" });
    pushMessages(cs, [{ role: "user", content: "Read it" }, ...pair("call_1")]);

    expect(pruneOrphanToolMessages(cs)).toEqual({ dropped: 0, sealed: 0 });
    expect(cs.messages.length).toBe(3);
  });

  test("a request with no reply is sealed with a failure, keeping the assistant's text", () => {
    const cs = createChatState({ model: "gpt-4" });
    pushMessages(cs, [
      { role: "user", content: "Ask me" },
      {
        role: "assistant",
        content: "Which pages matter?",
        toolCalls: [{ id: "call_ask", name: "ask_user", arguments: "{}" }],
      },
    ]);

    expect(pruneOrphanToolMessages(cs)).toEqual({ dropped: 0, sealed: 1 });
    expect(cs.messages.length).toBe(3);
    // Sealed IMMEDIATELY after its request — the only position toMessagesArray emits as a pair.
    expect(cs.messages[2]!.role).toBe("tool");
    expect(cs.messages[2]!.toolCallId).toBe("call_ask");
    expect(cs.messages[1]!.content).toBe("Which pages matter?");
    expect(JSON.parse(cs.messages[2]!.content)).toMatchObject({ success: false });
  });

  test("a reply with no request is dropped", () => {
    const cs = createChatState({ model: "gpt-4" });
    // What front-truncation leaves behind: the tail of a pair whose head was sliced off.
    pushMessages(cs, [
      { role: "tool", content: '{"success":true}', toolCallId: "call_gone" },
      { role: "user", content: "Carry on" },
    ]);

    expect(pruneOrphanToolMessages(cs)).toEqual({ dropped: 1, sealed: 0 });
    expect(cs.messages.length).toBe(1);
    expect(cs.messages[0]!.role).toBe("user");
  });

  test("a reply carrying no tool_call_id at all is dropped", () => {
    const cs = createChatState({ model: "gpt-4" });
    pushMessages(cs, [{ role: "tool", content: "{}" }]);

    expect(pruneOrphanToolMessages(cs)).toEqual({ dropped: 1, sealed: 0 });
    expect(cs.messages.length).toBe(0);
  });

  test("seals every unanswered call of a multi-call turn, in order", () => {
    const cs = createChatState({ model: "gpt-4" });
    pushMessages(cs, [
      {
        role: "assistant",
        content: "Two at once",
        toolCalls: [
          { id: "call_a", name: "read_file", arguments: "{}" },
          { id: "call_b", name: "read_file", arguments: "{}" },
        ],
      },
      { role: "tool", content: '{"success":true}', toolCallId: "call_b" },
    ]);

    expect(pruneOrphanToolMessages(cs)).toEqual({ dropped: 0, sealed: 1 });
    expect(cs.messages.map((m) => m.toolCallId)).toEqual([undefined, "call_a", "call_b"]);
  });

  test("repairs both shapes at once and leaves toMessagesArray well-formed", () => {
    const cs = createChatState({ model: "gpt-4" });
    pushMessages(cs, [
      { role: "tool", content: '{"success":true}', toolCallId: "call_sliced" },
      ...pair("call_ok"),
      {
        role: "assistant",
        content: "Still waiting",
        toolCalls: [{ id: "call_open", name: "ask_user", arguments: "{}" }],
      },
    ]);

    expect(pruneOrphanToolMessages(cs)).toEqual({ dropped: 1, sealed: 1 });

    // The property that matters: every tool reply follows the assistant request that declared it.
    const wire = cs.toMessagesArray() as {
      role: string;
      tool_calls?: { id: string }[];
      tool_call_id?: string;
    }[];
    const open = new Set<string>();
    for (const msg of wire) {
      if (msg.tool_calls) {
        for (const call of msg.tool_calls) {
          open.add(call.id);
        }
      } else if (msg.role === "tool") {
        expect(open.has(msg.tool_call_id!)).toBe(true);
        open.delete(msg.tool_call_id!);
      }
    }
    expect(open.size).toBe(0);
  });
});
