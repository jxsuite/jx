/**
 * How a conversation that has outgrown its model is made to fit, per provider family (specs/ai.md
 * §2.2, §3.8): an OpenAI-compatible provider keeps the tail, and Claude is sent a summary of the
 * earlier conversation that the model itself is asked for, between turns.
 *
 * The proxy client is doubled with one that records every request and answers from a script.
 */
import {
  clearSeededSettings,
  installMockPlatform,
  resetWorkspaceWithTab,
  seedSettings,
} from "./harness";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createChatState, createToolRegistry } from "@jxsuite/ai";
import { COMPACTION_REQUEST } from "@jxsuite/ai/harness";
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";

/** Every request the doubled client was sent: the last message's content. */
const asked: string[] = [];
/** What it answers each request with, in order; a text reply past the end. */
let script: StreamEvent[][] = [];

void mock.module("@jxsuite/ai", () => ({
  createChatState,
  createProxyStreamingClient: (): StreamingClient => ({
    async *streamChat(messages) {
      /* SAFETY: the loop's requests are OpenAI messages, each with a string `content` here. */
      const last = messages.at(-1) as { content: string };
      asked.push(last.content);
      yield* (
        script.shift() ?? [
          { content: "Done.", type: "delta" },
          { stopReason: "stop", type: "done" },
        ]
      );
    },
  }),
  createToolRegistry,
}));

const { createDocumentAssistant } = await import("../src/services/document-assistant");

const reply = (content: string): StreamEvent[] => [
  { content, type: "delta" },
  { stopReason: "stop", type: "done" },
];

/**
 * A reply of about 50,000 tokens. One fits `gpt-4o`'s budget (80% of 128,000 tokens) beside the
 * system prompt; two do not, so the third send is the one that finds the conversation too long.
 */
const LONG = "x".repeat(200_000);

beforeEach(() => {
  installMockPlatform();
  resetWorkspaceWithTab();
  localStorage.clear();
  asked.length = 0;
  script = [];
});

afterEach(() => {
  localStorage.clear();
  clearSeededSettings();
});

/** Two turns whose replies fill the window, so the third send finds the conversation too long. */
async function longConversation() {
  const a = createDocumentAssistant();
  script = [reply(LONG), reply(LONG)];
  await a.sendMessage("first");
  await a.sendMessage("second");
  asked.length = 0;
  return a;
}

test("Claude is asked for a summary of the earlier conversation, then sent the turn", async () => {
  seedSettings({ "jx.ai.model": "gpt-4o", "jx.ai.provider": "anthropic" });
  const a = await longConversation();
  script = [reply("The author asked two things and got two long answers."), reply("Third answer.")];
  await a.sendMessage("third");

  // One request for the summary, with nothing dropped yet, then the turn's own.
  expect(asked).toEqual([COMPACTION_REQUEST, "third"]);
  expect(a.chatState.messages.map((message) => message.role)).toEqual([
    "user",
    "user",
    "assistant",
  ]);
  expect(a.chatState.messages[0]).toMatchObject({
    content:
      "[Summary of the earlier conversation. 4 messages were condensed, by the assistant, to stay within the model's context:\n\nThe author asked two things and got two long answers.]",
    meta: { kind: "compaction" },
  });
  expect(a.chatState.messages[1]!.content).toBe("third");
  expect(a.chatState.messages[2]!.content).toBe("Third answer.");
  expect(a.chatState.contextWarning).toBe(true);
});

test("with no summary to use, the tail is kept instead and the turn still runs", async () => {
  seedSettings({ "jx.ai.model": "gpt-4o", "jx.ai.provider": "anthropic" });
  const a = await longConversation();
  script = [[{ message: "Overloaded.", type: "error" }], reply("Third answer.")];
  await a.sendMessage("third");

  expect(asked).toEqual([COMPACTION_REQUEST, "third"]);
  expect(a.chatState.messages.at(-1)!.content).toBe("Third answer.");
  expect(a.chatState.status).toBe("idle");
});

test("a Stop while the summary is being written leaves the conversation as it was", async () => {
  seedSettings({ "jx.ai.model": "gpt-4o", "jx.ai.provider": "anthropic" });
  const a = await longConversation();
  const before = a.chatState.messages.length;
  script = [[{ stopReason: "cancelled", type: "done" }]];
  const turn = a.sendMessage("third");
  a.stop();
  await turn;
  // Nothing was summarized away, and nothing was trimmed either: the author stopped the turn.
  expect(a.chatState.messages.filter((message) => message.content === LONG)).toHaveLength(2);
  expect(a.chatState.messages.length).toBeGreaterThanOrEqual(before);
});

test("an OpenAI-compatible provider keeps the tail, and is asked for no summary", async () => {
  seedSettings({ "jx.ai.model": "gpt-4o" });
  const a = await longConversation();
  script = [reply("Third answer.")];
  await a.sendMessage("third");
  expect(asked).not.toContain(COMPACTION_REQUEST);
  expect(asked.at(-1)).toBe("third");
});

test("Claude in a conversation that still fits is asked for nothing extra", async () => {
  seedSettings({ "jx.ai.model": "gpt-4o", "jx.ai.provider": "anthropic" });
  const a = createDocumentAssistant();
  await a.sendMessage("hello");
  expect(asked).toEqual(["hello"]);
});
