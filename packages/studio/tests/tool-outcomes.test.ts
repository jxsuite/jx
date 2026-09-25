/**
 * A persisted tool call's outcome lives in the tool message that answered it: a save strips the
 * record's `result`, a restore backfills it (src/services/tool-outcomes.ts). The chip is what a
 * reader sees, so the projection is asserted too.
 */
import "./with-dom.ts";
import { describe, expect, test } from "bun:test";
import type { ToolCallRecord } from "@jxsuite/ai/chat-state";
import type { ToolResult } from "@jxsuite/ai/tools";
import type { PersistedMessage } from "../src/services/ai-session-store";
import { UNANSWERED_TOOL_RESULT } from "../src/services/context-manager";
import { backfillToolResults, stripToolResults } from "../src/services/tool-outcomes";
import { projectChip } from "../src/panels/ai-chat/chat-view";

/** The outcome of an ordinary call nothing answered: after a restore, it never completed. */
const NEVER_COMPLETED = JSON.parse(UNANSWERED_TOOL_RESULT) as ToolResult;

const ok = (summary: string) => JSON.stringify({ success: true, summary });
const failed = (error: string) => JSON.stringify({ success: false, error });

function call(id: string, name = "add_child", extra: Record<string, unknown> = {}) {
  return { arguments: "{}", id, name, ...extra };
}

const recordsOf = (messages: PersistedMessage[]) =>
  messages.flatMap((m) => (m.toolCalls ?? []) as ToolCallRecord[]);

describe("stripToolResults", () => {
  test("drops every record's result and copies rather than mutating", () => {
    const record = call("c1", "add_child", { result: { success: true } });
    const messages: PersistedMessage[] = [
      { content: "go", role: "user" },
      { content: "", role: "assistant", toolCalls: [record] },
      { content: ok("done"), role: "tool", toolCallId: "c1" },
    ];
    const stripped = stripToolResults(messages);
    expect(recordsOf(stripped)).toEqual([{ arguments: "{}", id: "c1", name: "add_child" }]);
    // The live record the panel renders is untouched.
    expect(record).toHaveProperty("result");
    expect(stripped[0]).toBe(messages[0]!);
    expect(stripped[2]).toBe(messages[2]!);
  });

  test("leaves a record that is not an object alone", () => {
    const messages = [
      { content: "", role: "assistant", toolCalls: [null, "x"] },
    ] as PersistedMessage[];
    expect(stripToolResults(messages)[0]!.toolCalls).toEqual([null, "x"]);
  });
});

describe("backfillToolResults", () => {
  test("each call takes the result of the tool message that answered it", () => {
    const restored = backfillToolResults([
      { content: "go", role: "user" },
      { content: "", role: "assistant", toolCalls: [call("c1"), call("c2")] },
      { content: ok("Inserted."), role: "tool", toolCallId: "c1" },
      { content: failed("No node at [9]."), role: "tool", toolCallId: "c2" },
    ]);
    expect(recordsOf(restored).map((r) => r.result)).toEqual([
      { success: true, summary: "Inserted." },
      { error: "No node at [9].", success: false },
    ]);
  });

  /* A provider that numbers its calls afresh each round reuses `call_0`. Pairing by id across the
     transcript would give round one the reply to round two. */
  test("pairs per request, so an id reused in a later round keeps its own reply", () => {
    const restored = backfillToolResults([
      { content: "", role: "assistant", toolCalls: [call("call_0")] },
      { content: ok("first"), role: "tool", toolCallId: "call_0" },
      { content: "", role: "assistant", toolCalls: [call("call_0")] },
      { content: ok("second"), role: "tool", toolCallId: "call_0" },
    ]);
    expect(recordsOf(restored).map((r) => r.result?.summary)).toEqual(["first", "second"]);
  });

  test("looks only at the tool replies directly after the request", () => {
    const restored = backfillToolResults([
      { content: "", role: "assistant", toolCalls: [call("c1")] },
      { content: "an interleaved user message", role: "user" },
      { content: ok("too late"), role: "tool", toolCallId: "c1" },
    ]);
    expect(recordsOf(restored)[0]!.result).toEqual(NEVER_COMPLETED);
  });

  test("a reply that is not a tool result is no outcome; the first reply to an id wins", () => {
    const restored = backfillToolResults([
      { content: "", role: "assistant", toolCalls: [call("c1"), call("c2"), call("c3")] },
      { content: "not json", role: "tool", toolCallId: "c1" },
      { content: JSON.stringify({ ok: true }), role: "tool", toolCallId: "c2" },
      { content: ok("kept"), role: "tool", toolCallId: "c3" },
      { content: ok("ignored"), role: "tool", toolCallId: "c3" },
      { content: ok("no id"), role: "tool" },
    ]);
    const nonString = backfillToolResults([
      { content: "", role: "assistant", toolCalls: [call("c4")] },
      { content: 42 as unknown as string, role: "tool", toolCallId: "c4" },
    ]);
    expect(recordsOf(nonString)[0]!.result).toEqual(NEVER_COMPLETED);
    expect(recordsOf(restored).map((r) => r.result)).toEqual([
      NEVER_COMPLETED,
      NEVER_COMPLETED,
      { success: true, summary: "kept" },
    ]);
  });

  test("a result stored by an older build survives only where no reply answers it", () => {
    const stored = { success: true, summary: "stored" };
    const restored = backfillToolResults([
      { content: "", role: "assistant", toolCalls: [call("c1", "add_child", { result: stored })] },
      { content: "", role: "assistant", toolCalls: [call("c2", "add_child", { result: stored })] },
      { content: ok("reply"), role: "tool", toolCallId: "c2" },
    ]);
    expect(recordsOf(restored).map((r) => r.result?.summary)).toEqual(["stored", "reply"]);
  });

  /* The send path seals an open request with a synthesized failure. For an ordinary call that is
     the outcome (it never completed); for a question it is the absence of an answer. */
  test("a sealed question stays unanswered, and a sealed ordinary call shows it never completed", () => {
    const restored = backfillToolResults([
      {
        content: "",
        role: "assistant",
        toolCalls: [call("q1", "ask_user", { arguments: '{"question":"Keep it?"}' }), call("c1")],
      },
      { content: UNANSWERED_TOOL_RESULT, role: "tool", toolCallId: "q1" },
      { content: UNANSWERED_TOOL_RESULT, role: "tool", toolCallId: "c1" },
    ]);
    const [question, ordinary] = recordsOf(restored);
    expect(question!.result).toBeNull();
    expect(ordinary!.result).toEqual(JSON.parse(UNANSWERED_TOOL_RESULT));
  });

  /* After a restore nothing is in flight. An ordinary call no reply answers is one a Stop ended
     before its tools ran; it never completed, which is what the next send's seal will say. A
     question in the same position is simply unanswered. */
  test("a call nothing answered never completed, and a question nothing answered stays open", () => {
    const restored = backfillToolResults([
      {
        content: "",
        role: "assistant",
        toolCalls: [call("c1"), call("q1", "ask_user", { arguments: '{"question":"Why?"}' })],
      },
    ]);
    const [ordinary, question] = recordsOf(restored);
    expect(ordinary!.result).toEqual(NEVER_COMPLETED);
    expect(projectChip(ordinary!).outcome).toBe("failed");
    expect(question!.result).toBeNull();
    expect(projectChip(question!).askState).toBe("unanswered");
  });

  test("an answered question keeps its answer even beside a seal of another call", () => {
    const answer = JSON.stringify({ data: { answer: "Yes", skipped: false }, success: true });
    const restored = backfillToolResults([
      {
        content: "",
        role: "assistant",
        toolCalls: [call("q1", "ask_user"), call("q2", "ask_user")],
      },
      { content: answer, role: "tool", toolCallId: "q1" },
      { content: UNANSWERED_TOOL_RESULT, role: "tool", toolCallId: "q2" },
    ]);
    expect(recordsOf(restored).map((r) => r.result?.success ?? null)).toEqual([true, null]);
  });

  test("messages that are not requests pass through as they are", () => {
    const user = { content: "hi", role: "user" };
    const bare = { content: "text", role: "assistant" };
    const oddRecord = { content: "", role: "assistant", toolCalls: [null, { name: "x" }] };
    const restored = backfillToolResults([user, bare, oddRecord] as PersistedMessage[]);
    expect(restored[0]).toBe(user);
    expect(restored[1]).toBe(bare);
    expect(restored[2]!.toolCalls).toEqual([null, { name: "x", result: NEVER_COMPLETED }]);
  });
});

describe("a restored chip shows how its call ended", () => {
  const restored = recordsOf(
    backfillToolResults([
      {
        content: "",
        role: "assistant",
        toolCalls: [
          call("c_ok"),
          call("c_failed"),
          call("q_answered", "ask_user", { arguments: '{"question":"Layout?"}' }),
          call("q_open", "ask_user", { arguments: '{"question":"Footer?"}' }),
        ],
      },
      { content: ok("Inserted node."), role: "tool", toolCallId: "c_ok" },
      { content: failed("No node exists."), role: "tool", toolCallId: "c_failed" },
      {
        content: JSON.stringify({
          data: { answer: "Two columns", skipped: false },
          success: true,
          summary: 'The user answered: "Two columns"',
        }),
        role: "tool",
        toolCallId: "q_answered",
      },
      { content: UNANSWERED_TOOL_RESULT, role: "tool", toolCallId: "q_open" },
    ]),
  );
  const [done, broken, answered, open] = restored.map((record) => projectChip(record));

  test("a finished call is ok or failed, never pending", () => {
    expect(done!.outcome).toBe("ok");
    expect(broken!.outcome).toBe("failed");
  });

  test("an answered question shows its answer", () => {
    expect(answered!.askState).toBe("answered");
    expect(answered!.answer).toBe("Two columns");
  });

  test("a question nothing answered renders inert", () => {
    expect(open!.askState).toBe("unanswered");
  });
});
