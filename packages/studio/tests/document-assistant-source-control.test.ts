/**
 * The assistant and source control (studio.md §22.8).
 *
 * A tool call can write the working tree by doors the editor's save path never sees, so the Publish
 * workspace used to show an assistant's change only after a manual refresh. Every call now ends in
 * a source-control re-read. The loop and source control are doubled so a call is one observable
 * event.
 */
import { clearSeededSettings, installMockPlatform, resetWorkspaceWithTab } from "./harness";
import type { ToolRegistry } from "@jxsuite/ai/tools";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

const noted: (string | null)[] = [];
type Registry = Pick<ToolRegistry, "execute">;
let registry: Registry | null = null;

const realSourceControl = await import("../src/publish/source-control");
void mock.module("../src/publish/source-control", () => ({
  ...realSourceControl,
  noteFileSaved: async (path: string | null) => {
    noted.push(path);
  },
}));
void mock.module("../src/services/tool-executor", () => ({
  runAgentLoop: async (opts: {
    chatState: { finishStream: (stopReason: string) => void };
    toolRegistry: Registry;
  }) => {
    registry = opts.toolRegistry;
    opts.chatState.finishStream("stop");
  },
}));

const { createDocumentAssistant } = await import("../src/services/document-assistant");

beforeEach(() => {
  installMockPlatform();
  resetWorkspaceWithTab();
  noted.length = 0;
  registry = null;
});

afterEach(() => {
  clearSeededSettings();
});

test("every tool call ends in a source-control refresh, even one that fails", async () => {
  await createDocumentAssistant().sendMessage("hello");
  expect(registry).not.toBeNull();

  await registry!.execute("write_file", { path: "pages/a.json", content: "{}" });
  expect(noted).toEqual([null]);

  // An unknown tool answers with an error result or throws; either way the tree may have moved.
  await Promise.resolve(registry!.execute("no_such_tool", {})).catch(() => null);
  expect(noted).toEqual([null, null]);
});
