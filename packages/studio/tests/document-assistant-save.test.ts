/**
 * What the document assistant does when a conversation cannot be saved (specs/ai.md §3.13).
 *
 * A save that fails is reported by the store rather than swallowed, and the assistant tells the
 * author once, without interrupting the turn, and takes the notice back when saving works again. A
 * conversation that was deleted is simply not written: that is what deleting it meant. The loop is
 * doubled here so a send is one save.
 */
import { clearSeededSettings, installMockPlatform, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

void mock.module("../src/services/tool-executor", () => ({
  runAgentLoop: async (opts: { chatState: { finishStream: (stopReason: string) => void } }) => {
    opts.chatState.finishStream("stop");
  },
}));

const { createDocumentAssistant } = await import("../src/services/document-assistant");
const { listSessions, loadSession } = await import("../src/services/ai-session-store");
const { problems, resetNotifications, toasts } = await import("../src/services/notify");

const real = globalThis.localStorage;
let full = false;

/** A store that reads as the real one does and refuses every write while `full` is set. */
const storage = {
  getItem: (key: string) => real.getItem(key),
  removeItem: (key: string) => {
    real.removeItem(key);
  },
  setItem(key: string, value: string) {
    if (full) {
      throw new DOMException("full", "QuotaExceededError");
    }
    real.setItem(key, value);
  },
};

beforeEach(() => {
  installMockPlatform();
  resetWorkspaceWithTab();
  real.clear();
  resetNotifications();
  full = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: real,
    writable: true,
  });
  real.clear();
  clearSeededSettings();
});

const notices = () => [...toasts, ...problems].map((record) => record.message);

test("a full store is said once, and the notice goes when saving works again", async () => {
  const a = createDocumentAssistant();
  await a.sendMessage("first");
  expect(notices()).toEqual([]);

  full = true;
  await a.sendMessage("second");
  await a.sendMessage("third");
  expect(notices()).toEqual([
    "This browser's storage is full, so the conversation was not saved. Delete older chats to make room.",
  ]);
  // The turn itself was not interrupted: both messages are in the live conversation.
  expect(a.chatState.messages.filter((message) => message.role === "user")).toHaveLength(3);

  full = false;
  await a.sendMessage("fourth");
  expect(notices()).toEqual([]);
  const saved = loadSession("", a.activeSessionId()!)!;
  expect(saved.filter((message) => message.role === "user")).toHaveLength(4);
});

test("a deleted conversation is not written back, and nothing is said about it", async () => {
  const a = createDocumentAssistant();
  await a.sendMessage("first");
  const id = a.activeSessionId()!;
  const other = createDocumentAssistant();
  // Another window deletes it; this one still holds it open and sends again.
  other.deleteSession(id);
  await a.sendMessage("second");
  expect(listSessions("")).toEqual([]);
  expect(loadSession("", id)).toBeNull();
  expect(notices()).toEqual([]);
});
