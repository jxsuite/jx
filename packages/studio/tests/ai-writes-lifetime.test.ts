/**
 * How long the record of what each assistant turn changed lasts (specs/ai.md §3.2).
 *
 * The transcript draws a turn's changes under the turn's message, and Restore undoes the active
 * tab. So the record lasts as long as both are true: New Chat drops it with the messages, and
 * leaving a project drops it with the files it names. Adopting a project from none keeps it,
 * because a bootstrap conversation follows the project it made. The loop is doubled so a send
 * finishes without a model.
 */
import { clearSeededSettings, installMockPlatform, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AiWrite } from "@jxsuite/ai/tools";

void mock.module("../src/services/tool-executor", () => ({
  runAgentLoop: async (opts: { chatState: { finishStream: (stopReason: string) => void } }) => {
    opts.chatState.finishStream("stop");
  },
}));

const { createDocumentAssistant } = await import("../src/services/document-assistant");
const { fileTurn, resetAiWrites, writesForTurn } = await import("../src/services/ai-writes");
const { setWorkspaceProject, workspace } = await import("../src/workspace/workspace");

const WRITE: AiWrite = { disk: false, ok: true, path: "pages/index.json", tool: "set_style" };

beforeEach(() => {
  installMockPlatform();
  resetWorkspaceWithTab();
  localStorage.clear();
  resetAiWrites();
});

afterEach(() => {
  setWorkspaceProject(null);
  resetAiWrites();
  localStorage.clear();
  clearSeededSettings();
});

describe("New Chat", () => {
  test("drops what the chat's turns changed", async () => {
    const a = createDocumentAssistant();
    await a.sendMessage("restyle the hero");
    fileTurn("m1", [WRITE]);

    a.newChat();

    expect(writesForTurn("m1")).toEqual([]);
  });

  test("opening another chat from history keeps it", async () => {
    const a = createDocumentAssistant();
    await a.sendMessage("first chat");
    const firstId = a.activeSessionId()!;
    a.newChat();
    await a.sendMessage("second chat");
    fileTurn("m2", [WRITE]);

    a.openSession(firstId);

    expect(writesForTurn("m2")).toEqual([WRITE]);
  });
});

describe("the project this window holds", () => {
  test("leaving it for another drops what the turns changed", () => {
    setWorkspaceProject("/sites/a");
    fileTurn("m1", [WRITE]);

    setWorkspaceProject("/sites/b");

    expect(writesForTurn("m1")).toEqual([]);
    expect(workspace.projectRoot).toBe("/sites/b");
  });

  test("closing it drops what the turns changed", () => {
    setWorkspaceProject("/sites/a");
    fileTurn("m1", [WRITE]);

    setWorkspaceProject(null);

    expect(writesForTurn("m1")).toEqual([]);
  });

  test("adopting one from none keeps the bootstrap conversation's record", () => {
    setWorkspaceProject(null);
    fileTurn("m1", [{ disk: true, ok: true, path: "project.json", tool: "create_project" }]);

    setWorkspaceProject("/sites/new", { name: "new" });

    expect(writesForTurn("m1")).toHaveLength(1);
  });

  test("re-recording the same root with a new configuration keeps it", () => {
    setWorkspaceProject("/sites/a");
    fileTurn("m1", [WRITE]);

    setWorkspaceProject("/sites/a", { name: "renamed" });

    expect(writesForTurn("m1")).toEqual([WRITE]);
    expect(workspace.projectConfig).toEqual({ name: "renamed" });
  });
});
