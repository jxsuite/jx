/**
 * How long a conversation's session facts last in the document assistant (specs/ai.md §3.7).
 *
 * The facts replaced the import tool's module flag, so they must last exactly as long as it did:
 * every turn of a chat sees the same facts, New Chat starts with none, and opening another chat
 * from Chat History keeps them. The loop is doubled here so each send's facts can be captured.
 */
import { clearSeededSettings, installMockPlatform, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { SessionFacts } from "@jxsuite/ai/tools";

const sessions: SessionFacts[] = [];
void mock.module("../src/services/tool-executor", () => ({
  runAgentLoop: async (opts: {
    session: SessionFacts;
    chatState: { finishStream: (stopReason: string) => void };
  }) => {
    sessions.push(opts.session);
    // The turn ends, as a real one would, so the next send is accepted.
    opts.chatState.finishStream("stop");
  },
}));

const { createDocumentAssistant } = await import("../src/services/document-assistant");

beforeEach(() => {
  installMockPlatform();
  resetWorkspaceWithTab();
  localStorage.clear();
  sessions.length = 0;
});

afterEach(() => {
  localStorage.clear();
  clearSeededSettings();
});

test("every turn of a chat sees the same facts, named for its session", async () => {
  const a = createDocumentAssistant();
  await a.sendMessage("first");
  sessions[0]!.set("import.done", true);
  await a.sendMessage("second");

  expect(sessions[1]).toBe(sessions[0]!);
  expect(sessions[1]!.get("import.done")).toBe(true);
  expect(sessions[0]!.sessionId).toBe(a.activeSessionId());
});

test("New Chat starts with no facts", async () => {
  const a = createDocumentAssistant();
  await a.sendMessage("first");
  sessions[0]!.set("import.done", true);
  a.newChat();
  await a.sendMessage("another");

  expect(sessions[1]!.get("import.done")).toBeUndefined();
});

/* The one-import guard this replaced was a module flag that only New Chat reset, so a chat opened
   from Chat History inherited it. The facts keep that behaviour; they are not saved with a chat. */
test("opening another chat keeps the facts, as the one-import guard always did", async () => {
  const a = createDocumentAssistant();
  await a.sendMessage("first chat");
  const firstId = a.activeSessionId()!;
  a.newChat();
  await a.sendMessage("second chat");
  sessions[1]!.set("import.done", true);

  a.openSession(firstId);
  await a.sendMessage("back in the first");

  expect(sessions[2]!.sessionId).toBe(firstId);
  expect(sessions[2]!.get("import.done")).toBe(true);
});
