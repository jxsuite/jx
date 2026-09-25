/**
 * Tests for src/services/document-assistant.ts — the Stack B document AI session.
 *
 * Drives createDocumentAssistant().sendMessage() end-to-end with a scripted streaming client. The
 * AI barrel's createProxyStreamingClient is mocked while createChatState/createToolRegistry stay
 * real, so the full wiring — system prompt, context trim, tool registry, agent loop, persistence —
 * runs without a network. The tool path mutates the live document as one undo step.
 */
import {
  clearSeededSettings,
  flush,
  installMockPlatform,
  resetStudioState,
  resetWorkspaceWithTab,
  seedSettings,
} from "./harness";
import { createChatState, createToolRegistry } from "@jxsuite/ai";
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";
import type { JxMutableNode } from "@jxsuite/schema/types";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let nextRounds: StreamEvent[][] = [];
let createErrorMessage: string | null = null;
let lastClientOpts: Record<string, unknown> | null = null;
let capturedTools: string[][] = [];
let capturedSystemPrompts: string[] = [];

function fakeClient(rounds: StreamEvent[][], chatUrl?: unknown): StreamingClient {
  let call = 0;
  let url: Promise<unknown> | null = null;
  return {
    async *streamChat(
      _messages: unknown,
      tools?: unknown,
      systemPrompt?: unknown,
      signal?: AbortSignal,
    ) {
      /* The real proxy client's contract: a lazy URL is resolved once, inside the first stream,
         and a stream stopped by then sends nothing. The resolved URL is what the options record. */
      url ??= Promise.resolve(
        typeof chatUrl === "function" ? (chatUrl as () => unknown)() : chatUrl,
      );
      const resolved = await url;
      if (lastClientOpts) {
        lastClientOpts = { ...lastClientOpts, chatUrl: resolved };
      }
      if (signal?.aborted) {
        yield { stopReason: "cancelled", type: "done" } as StreamEvent;
        return;
      }
      capturedTools.push(
        ((tools as { function: { name: string } }[]) ?? []).map((t) => t.function.name),
      );
      capturedSystemPrompts.push(String(systemPrompt ?? ""));
      const events = rounds[call] ?? [{ stopReason: "stop", type: "done" }];
      call += 1;
      for (const e of events) {
        yield e;
      }
    },
  } as unknown as StreamingClient;
}

/** One tool call followed by a tool_calls stop. */
function toolCallRound(id: string, name: string, args: object): StreamEvent[] {
  return [
    { id, name, type: "tool_call_start" },
    { args: JSON.stringify(args), id, type: "tool_call_delta" },
    { id, type: "tool_call_end" },
    { stopReason: "tool_calls", type: "done" },
  ];
}

void mock.module("@jxsuite/ai", () => ({
  createChatState,
  createProxyStreamingClient: (opts: Record<string, unknown>) => {
    lastClientOpts = opts;
    if (createErrorMessage) {
      throw new Error(createErrorMessage);
    }
    return fakeClient(nextRounds, opts.chatUrl);
  },
  createToolRegistry,
}));

const LEGACY_PERSIST_KEY = "jx-ai-chat-history";
const { createDocumentAssistant } = await import("../src/services/document-assistant");
const { getActiveSessionId, listSessions, loadSession } =
  await import("../src/services/ai-session-store");
const { setProjectAdopter } = await import("../src/services/project-adoption");
const { activeTab, closeAllTabs, setWorkspaceProject, workspace } =
  await import("../src/workspace/workspace");
const { commitProjectConfig, resetProjectConfigDocument } =
  await import("../src/tabs/project-config");
const store = await import("../src/store");
const { createCommandRegistry } = await import("../src/commands/registry");
const { hasSelection, makeContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { selectionCommands } = await import("../src/canvas/canvas-render");
const { isSpliceablePath } = await import("../src/tabs/selection");
const { mutateRemoveNodes, transactDoc } = await import("../src/tabs/transact");
const { writesForTurn } = await import("../src/services/ai-writes");
const { answerAsk, pendingAsk } = await import("../src/services/ai-ask");

/** Which editor the registry fixture reports the focused pane as showing. */
let editorKind: "canvas" | "config" = "canvas";

/**
 * A registry over the LIVE workspace, so the assistant's bridge (`services/ai-command-tools.ts`)
 * has records to project: the two selection verbs from `canvas-render.ts` and an inline
 * `selection.delete` whose implementation is the app's own batch removal. The context reads the
 * same state the tools do — the active tab, its selection, the project root — and `editorKind` is
 * the one knob a test turns to put Project Settings in front of the assistant.
 */
function installRegistryFixture() {
  const registry = createCommandRegistry({
    getContext: () => {
      const tab = activeTab.value;
      const paths = tab?.session.selection ?? [];
      return makeContext({
        document: { open: Boolean(tab) },
        editor: { kind: editorKind },
        project: { open: Boolean(workspace.projectRoot) },
        selection: {
          count: paths.length,
          isRoot: paths.some((path) => path.length === 0),
          paths,
        },
      });
    },
  });
  registry.registerAll(selectionCommands());
  registry.register({
    aiTool: {
      description: "Delete elements from the document as one undoable step.",
      name: "delete_node",
      report: ({ before }) => `Deleted ${before.selection.paths.length} element(s).`,
    },
    category: "Selection",
    destructive: true,
    enablement: (ctx) =>
      !ctx.selection.isRoot && ctx.selection.paths.every((path) => isSpliceablePath(path)),
    id: "selection.delete",
    level: "selection",
    requires: "an element selected on the canvas that has a sibling position",
    run: () => {
      const tab = activeTab.value!;
      transactDoc(tab, (t) => mutateRemoveNodes(t, tab.session.selection));
    },
    title: "Delete",
    undo: "document",
    when: hasSelection,
  });
  setActiveRegistry(registry);
}

/** The messages persisted for the assistant's active session (tests run with no project root). */
function persistedMessages() {
  const activeId = getActiveSessionId("");
  return activeId ? loadSession("", activeId) : null;
}

beforeEach(() => {
  installMockPlatform();
  resetWorkspaceWithTab();
  resetProjectConfigDocument();
  setWorkspaceProject(null);
  setProjectAdopter(async () => {});
  localStorage.clear();
  clearSeededSettings();
  nextRounds = [];
  createErrorMessage = null;
  lastClientOpts = null;
  capturedTools = [];
  capturedSystemPrompts = [];
  editorKind = "canvas";
  installRegistryFixture();
});

afterEach(() => {
  localStorage.clear();
  clearSeededSettings();
  // `active-registry.ts` documents this as the unmount contract.
  setActiveRegistry(null);
});

describe("document-assistant", () => {
  test("streams a text reply and persists the conversation", async () => {
    seedSettings({ "jx.ai.openaiKey": "sk-secret", "jx.ai.baseUrl": "http://localhost:11434/v1" });
    nextRounds = [
      [
        { content: "Hello there", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    ];

    const a = createDocumentAssistant();
    await a.sendMessage("hi");

    expect(a.chatState.status).toBe("idle");
    expect(
      a.chatState.messages.some((m) => m.role === "assistant" && m.content.includes("Hello")),
    ).toBe(true);
    // The streaming client received the stored credentials.
    expect(lastClientOpts?.apiKey).toBe("sk-secret");
    expect(lastClientOpts?.baseUrl).toBe("http://localhost:11434/v1");
    // A session was lazily created on first send, and the completed reply was
    // Persisted after the stream settled (not just the pre-stream user message).
    const persisted = persistedMessages();
    expect(persisted?.some((m) => m.role === "user" && m.content === "hi")).toBe(true);
    expect(persisted?.some((m) => m.role === "assistant" && m.content.includes("Hello"))).toBe(
      true,
    );
    expect(listSessions("")[0]!.title).toBe("hi");
  });

  test("executes a tool call that mutates the document as a single undo step", async () => {
    nextRounds = [
      toolCallRound("c1", "add_child", {
        index: 1,
        node: { tagName: "span", textContent: "added" },
        parentPath: [],
      }),
      [{ stopReason: "stop", type: "done" }],
    ];

    const a = createDocumentAssistant();
    const tab = resetWorkspaceWithTab({
      children: [{ tagName: "p", textContent: "Hello" }],
      tagName: "div",
    });
    await a.sendMessage("add a span");

    const children = tab.doc.document.children as (JxMutableNode | string)[];
    expect(children).toHaveLength(2);
    expect((children[1] as JxMutableNode).tagName).toBe("span");
    expect(tab.history.index).toBe(1); // One undoable transaction (batched)
    expect(a.chatState.status).toBe("idle");
  });

  test("create_page writes the file through the platform saveFile wiring", async () => {
    const { state } = installMockPlatform();
    // Create_page sits in the "project" tool tier — it needs an open project to be executable.
    setWorkspaceProject("/proj");
    nextRounds = [
      toolCallRound("c1", "create_page", {
        content: { children: [{ tagName: "p", textContent: "About us" }], tagName: "div" },
        path: "pages/about.json",
      }),
      [{ stopReason: "stop", type: "done" }],
    ];

    const a = createDocumentAssistant();
    await a.sendMessage("make an about page");

    const writes = state.calls.filter(([name]) => name === "writeFile");
    expect(writes).toHaveLength(1);
    expect(writes[0]![1]).toBe("pages/about.json");
    expect(String(writes[0]![2])).toContain("About us");
    expect(a.chatState.status).toBe("idle");
    // ListSessions surfaces the lazily created session, newest first.
    const sessions = a.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.title).toBe("make an about page");
    expect(sessions[0]!.id).toBe(a.activeSessionId()!);
  });

  test("ignores empty input and re-entrant sends while streaming", async () => {
    const a = createDocumentAssistant();
    await a.sendMessage("   ");
    expect(a.chatState.messages).toHaveLength(0);
    // Rejected sends never create a session.
    expect(listSessions("")).toHaveLength(0);

    a.chatState.status = "streaming";
    await a.sendMessage("blocked");
    expect(a.chatState.messages).toHaveLength(0);
    expect(listSessions("")).toHaveLength(0);
  });

  test("surfaces a streaming-client construction failure as an error", async () => {
    createErrorMessage = "network down";
    const a = createDocumentAssistant();
    await a.sendMessage("hi");
    expect(a.chatState.status).toBe("error");
    expect(a.chatState.error).toContain("network down");
  });

  test("stop() and newChat() detach from the session without deleting it", async () => {
    nextRounds = [
      [
        { content: "x", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    ];
    const a = createDocumentAssistant();
    await a.sendMessage("hi");
    expect(a.chatState.messages.length).toBeGreaterThan(0);
    const sessionId = a.activeSessionId();
    expect(sessionId).toBeTruthy();

    a.stop(); // No active controller → just cancels stream state
    a.newChat();
    expect(a.chatState.messages).toHaveLength(0);
    expect(a.activeSessionId()).toBeNull();
    expect(getActiveSessionId("")).toBeNull();
    // The previous conversation stays in the session list.
    expect(listSessions("").some((s) => s.id === sessionId)).toBe(true);
    expect(loadSession("", sessionId!)?.some((m) => m.content === "hi")).toBe(true);
  });

  test("openSession swaps the live chat; deleteSession of the open one clears it", async () => {
    nextRounds = [
      [
        { content: "first reply", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
      [
        { content: "second reply", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    ];
    const a = createDocumentAssistant();
    await a.sendMessage("first chat");
    const firstId = a.activeSessionId()!;
    a.newChat();
    await a.sendMessage("second chat");
    const secondId = a.activeSessionId()!;
    expect(secondId).not.toBe(firstId);

    a.openSession(firstId);
    expect(a.activeSessionId()).toBe(firstId);
    expect(getActiveSessionId("")).toBe(firstId);
    expect(a.chatState.messages.some((m) => m.content === "first chat")).toBe(true);
    expect(a.chatState.messages.some((m) => m.content === "second chat")).toBe(false);

    // Opening an unknown session is a no-op.
    a.openSession("nope");
    expect(a.activeSessionId()).toBe(firstId);

    a.deleteSession(firstId);
    expect(a.chatState.messages).toHaveLength(0);
    expect(a.activeSessionId()).toBeNull();
    expect(listSessions("").map((s) => s.id)).toEqual([secondId]);

    // Deleting a non-open session leaves the live chat alone.
    a.openSession(secondId);
    a.deleteSession("already-gone");
    expect(a.activeSessionId()).toBe(secondId);
  });

  /* One turn per window. The chat's status belongs to the token stream and reads idle while a
     round's tools run (here, a question waiting on the author), so guarding on it let a second
     send start a second turn beside the first (D2). */
  test("a send while a turn's tools run is refused, and the turn reads active until it ends", async () => {
    nextRounds = [
      toolCallRound("q1", "ask_user", { question: "Keep it?" }),
      [{ stopReason: "stop", type: "done" }],
    ];
    const a = createDocumentAssistant();
    expect(a.isTurnActive()).toBe(false);
    const first = a.sendMessage("first");
    for (let tick = 0; tick < 50 && !pendingAsk(); tick++) {
      await flush(1);
    }
    expect(a.chatState.status).toBe("idle");
    expect(a.isTurnActive()).toBe(true);

    const streams = capturedTools.length;
    await a.sendMessage("second");
    expect(capturedTools).toHaveLength(streams);
    expect(a.chatState.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
      "first",
    ]);

    // Answering is not a send: the turn carries on with the reply and then ends.
    answerAsk("yes");
    await first;
    expect(a.isTurnActive()).toBe(false);
    expect(capturedTools).toHaveLength(streams + 1);
  });

  /* Chat History stays open to the author while a turn waits on them, and opening a chat stops the
     turn and replaces the transcript under it. Nothing more of that turn may land in the chat now
     on screen: not the stopped call's reply, and not its changes, which would otherwise be drawn
     as "Changed 1 file" under a reply that changed nothing. */
  test("a chat opened while a turn waits gets none of that turn's reply or changes", async () => {
    const tab = resetWorkspaceWithTab({
      children: [{ tagName: "p", textContent: "one" }],
      tagName: "div",
    });
    nextRounds = [
      [
        { content: "first reply", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    ];
    const a = createDocumentAssistant();
    await a.sendMessage("first chat");
    const firstId = a.activeSessionId()!;
    a.newChat();
    // An edit, then a question the author leaves open while they look through Chat History.
    nextRounds = [
      toolCallRound("c1", "add_child", { index: 1, node: { tagName: "span" }, parentPath: [] }),
      toolCallRound("q1", "ask_user", { question: "Keep it?" }),
    ];
    const running = a.sendMessage("second chat");
    for (let tick = 0; tick < 50 && !pendingAsk(); tick++) {
      await flush(1);
    }
    expect(pendingAsk()).not.toBeNull();

    a.openSession(firstId);
    await running;

    expect(a.chatState.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(a.chatState.messages.map((m) => writesForTurn(m.id))).toEqual([[], []]);
    expect(loadSession("", firstId)!.map((m) => m.role)).toEqual(["user", "assistant"]);
    // The edit itself landed, and stays in the document's history like any other.
    expect((tab.doc.document.children as unknown[]).length).toBe(2);
  });

  test("restores the last-active session on creation", () => {
    globalThis.localStorage.setItem(
      LEGACY_PERSIST_KEY,
      JSON.stringify([
        { content: "earlier", id: "m1", role: "user", timestamp: 1 },
        { content: "reply", role: "assistant", timestamp: 2 }, // Missing id → synthesized
      ]),
    );
    // The legacy single-conversation store migrates into the first session…
    const a = createDocumentAssistant();
    expect(a.chatState.messages).toHaveLength(2);
    expect(a.chatState.messages[0]!.content).toBe("earlier");
    expect(a.chatState.messages[1]!.id).toBeTruthy();
    expect(a.activeSessionId()).toBe(getActiveSessionId(""));

    // …and a second assistant restores that same active session.
    const b = createDocumentAssistant();
    expect(b.chatState.messages).toHaveLength(2);
  });

  test("ignores corrupt or empty persisted history", () => {
    globalThis.localStorage.setItem(LEGACY_PERSIST_KEY, "{not json");
    expect(createDocumentAssistant().chatState.messages).toHaveLength(0);

    globalThis.localStorage.setItem(LEGACY_PERSIST_KEY, "[]");
    expect(createDocumentAssistant().chatState.messages).toHaveLength(0);
  });
});

describe("document-assistant — state-gated tools & bootstrap", () => {
  test("sends with no document and no project, advertising only bootstrap tools", async () => {
    closeAllTabs();
    nextRounds = [
      [
        { content: "Let's start a project", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    ];
    const a = createDocumentAssistant();
    await a.sendMessage("I want a portfolio site");

    expect(a.chatState.status).toBe("idle");
    expect(capturedTools[0]).toContain("create_project");
    expect(capturedTools[0]).toContain("list_starters");
    expect(capturedTools[0]).not.toContain("list_files");
    expect(capturedTools[0]).not.toContain("set_property");
    expect(capturedSystemPrompts[0]).toContain("No project is open yet");
  });

  test("with a project and a document, file and document tools are advertised together", async () => {
    setWorkspaceProject("/proj");
    nextRounds = [[{ stopReason: "stop", type: "done" }]];
    const a = createDocumentAssistant();
    await a.sendMessage("hi");

    expect(capturedTools[0]).toContain("set_property");
    expect(capturedTools[0]).toContain("write_file");
    expect(capturedTools[0]).not.toContain("create_project");
  });

  /*
   * The prompt advertises exactly what the gate will honour, for BOTH kinds of tool. The hand
   * tree writers are gated on `treeEditable`, which `buildPrompt` never passed — so with Project
   * Settings focused the prompt listed `set_property` while the gate refused it, and the model
   * spent a round learning that. The command projections are one function for the prompt line and
   * the schema (`advertisedCommandTools`), so `delete_node(paths)` is in the text iff its schema
   * was sent.
   */
  test("the prompt lists a tool iff its schema was sent, in each of the four states", async () => {
    const states: [string, () => void, { tree: boolean; deleteNode: boolean }][] = [
      ["no document", () => closeAllTabs(), { deleteNode: false, tree: false }],
      ["a canvas document", () => {}, { deleteNode: true, tree: true }],
      [
        "Project Settings focused",
        () => {
          editorKind = "config";
        },
        { deleteNode: false, tree: false },
      ],
      [
        "a canvas document, project open",
        () => setWorkspaceProject("/proj"),
        { deleteNode: true, tree: true },
      ],
    ];
    for (const [label, arrange, expected] of states) {
      resetWorkspaceWithTab();
      editorKind = "canvas";
      setWorkspaceProject(null);
      arrange();
      capturedTools = [];
      capturedSystemPrompts = [];
      nextRounds = [[{ stopReason: "stop", type: "done" }]];
      const a = createDocumentAssistant();
      await a.sendMessage("hi");
      const sent = capturedTools[0]!;
      const prompt = capturedSystemPrompts[0]!;
      expect([
        label,
        sent.includes("delete_node"),
        prompt.includes("- delete_node(paths)"),
      ]).toEqual([label, expected.deleteNode, expected.deleteNode]);
      expect([label, sent.includes("set_property"), prompt.includes("- set_property(")]).toEqual([
        label,
        expected.tree,
        expected.tree,
      ]);
      // A read is not affected by the tree gate: it follows the document alone.
      expect([label, sent.includes("read_document")]).toEqual([label, label !== "no document"]);
    }
  });

  test("a delete_node round runs selection.delete through the registry as one undo step", async () => {
    /* Mirrors the `add_child` case above, for the other kind of tool: the call reaches
       `registry.run("selection.setPaths")` then `registry.run("selection.delete")`, the batch
       removal is one transaction inside the turn's one batch, the ledger records the document, and
       the report — the record's own sentence — is what the model reads. */
    const tab = resetWorkspaceWithTab({
      children: [
        { tagName: "p", textContent: "one" },
        { tagName: "p", textContent: "two" },
      ],
      tagName: "div",
    });
    nextRounds = [
      toolCallRound("d1", "delete_node", {
        paths: [
          ["children", 1],
          ["children", 0],
        ],
      }),
      [{ stopReason: "stop", type: "done" }],
    ];

    const a = createDocumentAssistant();
    await a.sendMessage("clear the page");

    expect(tab.doc.document.children).toEqual([]);
    expect(tab.history.index).toBe(1); // One undoable transaction (batched)
    expect(tab.session.selection).toEqual([]);
    // What the model read back: the `role: "tool"` message carries the whole result.
    const reply = a.chatState.messages.find((m) => m.role === "tool");
    expect(JSON.parse(reply!.content)).toEqual({
      success: true,
      summary: "Deleted 2 element(s).",
    });
    /* Filed under the request, the turn's last drawn message: the final round said nothing, so the
       message the turn ends on is an empty one the transcript never draws. */
    const request = a.chatState.messages.find((m) => m.toolCalls?.length);
    expect(a.chatState.messages.at(-1)!.content).toBe("");
    expect(writesForTurn(a.chatState.messages.at(-1)!.id)).toEqual([]);
    expect(writesForTurn(request!.id)).toEqual([
      { disk: false, ok: true, path: "/project/index.json", tool: "Delete" },
    ]);
  });

  test("a delete_node aimed at Project Settings is refused by the person's own gate", async () => {
    /* `selection.setPaths` runs — project.json is drawn as a tree and `document.open` holds — and
       then `selection.delete`'s `when` (`hasSelection` requires the canvas) refuses with its
       sentence. Nothing is written, and the model reads the refusal a palette would print. */
    const tab = resetWorkspaceWithTab({ children: [{ tagName: "p" }], tagName: "div" });
    editorKind = "config";
    nextRounds = [
      toolCallRound("d1", "delete_node", { paths: [["children", 0]] }),
      [{ stopReason: "stop", type: "done" }],
    ];

    const a = createDocumentAssistant();
    await a.sendMessage("delete it");

    expect((tab.doc.document.children as unknown[]).length).toBe(1);
    expect(tab.doc.dirty).toBe(false);
    const reply = a.chatState.messages.find((m) => m.role === "tool");
    expect(JSON.parse(reply!.content)).toEqual({
      error:
        'Command "selection.delete" is not available right now — it requires an element ' +
        "selected on the canvas that has a sibling position.",
      success: false,
    });
    const request = a.chatState.messages.find((m) => m.toolCalls?.length);
    expect(writesForTurn(request!.id)).toEqual([]);
  });

  test("create_project adopts the scaffold and re-keys the pre-project session", async () => {
    closeAllTabs();
    // The registered adopter stands in for openRecentProject: it "opens" the project.
    setProjectAdopter(async (root: string) => {
      setWorkspaceProject(root, { name: "Fresh" });
    });
    nextRounds = [
      // The model must name a destination — create_project refuses without one.
      toolCallRound("c1", "create_project", { location: "/home/dev/Sites", name: "Fresh Site" }),
      [
        { content: "Project ready", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    ];

    const a = createDocumentAssistant();
    await a.sendMessage("bootstrap a site");

    const root = workspace.projectRoot!;
    expect(root).toBeTruthy();
    // The live session moved from the unscoped store to the adopted root and stayed active.
    expect(listSessions("").some((s) => s.id === a.activeSessionId())).toBe(false);
    const moved = listSessions(root).find((s) => s.id === a.activeSessionId());
    expect(moved?.title).toBe("bootstrap a site");
    expect(getActiveSessionId(root)).toBe(a.activeSessionId());
    // Post-adoption persistence lands in the re-keyed store.
    expect(
      loadSession(root, a.activeSessionId()!)?.some((m) => m.content === "Project ready"),
    ).toBe(true);
    // The second round re-advertised the unlocked tiers (mid-loop re-listing).
    expect(capturedTools[1]).toContain("list_files");
    expect(capturedTools[1]).not.toContain("create_project");
  });

  test("a new assistant restores the last-active session's messages on construction", async () => {
    /* The panel constructs the assistant on load, so this is what makes a reload continue the
       conversation rather than open an empty one. `openSession` shares the restore path, but only
       this one runs it before the reader has done anything. */
    nextRounds = [
      [
        { content: "Earlier reply", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    ];
    const first = createDocumentAssistant();
    await first.sendMessage("earlier question");
    const id = first.activeSessionId();
    expect(id).toBeTruthy();

    // A fresh assistant over the same store — what a reload builds.
    const revived = createDocumentAssistant();

    expect(revived.activeSessionId()).toBe(id);
    expect(revived.chatState.messages.map((m) => m.content)).toEqual([
      "earlier question",
      "Earlier reply",
    ]);
    // Every restored message carries an id, so the transcript can key its rows.
    expect(revived.chatState.messages.every((m) => Boolean(m.id))).toBe(true);
  });

  test("import_site adopts the imported project and re-keys the pre-project session", async () => {
    /* The import bootstraps a project exactly as `create_project` does, so the conversation that
       asked for it has to follow it out of the unscoped store — otherwise the transcript of the
       run is orphaned in `""` the moment the project it describes opens. */
    /* A document stays OPEN, so the agent loop is holding an undo batch when adoption replaces
       every tab in the workspace. That is what makes the tool's `getTab` seam load-bearing: the
       batch has to be re-opened on whatever tab adoption left active, not on the disposed one. */
    installMockPlatform({
      importSite: (async () => ({
        result: { pages: 2, warnings: [] },
        root: "/abs/imported-site",
      })) as never,
    });
    setProjectAdopter(async (root: string) => {
      setWorkspaceProject(root, { name: "Imported" });
    });
    nextRounds = [
      toolCallRound("i1", "import_site", {
        directory: "/home/dev/Sites/imported-site",
        url: "https://example.com",
      }),
      [
        { content: "Import complete", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    ];

    const a = createDocumentAssistant();
    await a.sendMessage("clone example.com");

    expect(workspace.projectRoot).toBe("/abs/imported-site");
    // The live session left the unscoped store and is active under the imported root.
    expect(listSessions("").some((s) => s.id === a.activeSessionId())).toBe(false);
    const moved = listSessions("/abs/imported-site").find((s) => s.id === a.activeSessionId());
    expect(moved?.title).toBe("clone example.com");
    expect(getActiveSessionId("/abs/imported-site")).toBe(a.activeSessionId());
  });

  test("New Chat during a turn leaves the discarded conversation unpersisted", async () => {
    /* `sendMessage` persists again in its `finally`, and New Chat clears the session id out from
       under it. Writing there would resurrect the conversation the reader just discarded — under
       whichever session id happened to be next. */
    const tab = resetWorkspaceWithTab({
      children: [{ tagName: "p", textContent: "one" }],
      tagName: "div",
    });
    nextRounds = [
      [
        { content: "half a th", type: "delta" },
        ...toolCallRound("c1", "add_child", {
          index: 1,
          node: { tagName: "span" },
          parentPath: [],
        }),
      ],
      [{ stopReason: "stop", type: "done" }],
    ];

    const a = createDocumentAssistant();
    // Clear the session id mid-flight, the way the New Chat button does.
    const sending = a.sendMessage("start something");
    a.newChat();
    await sending;

    expect(a.activeSessionId()).toBeNull();
    expect(getActiveSessionId("")).toBeNull();
    // Nothing was written back under a session the reader had already dismissed.
    expect(listSessions("").every((s) => loadSession("", s.id)?.length !== 0)).toBe(true);
    expect(a.chatState.messages).toHaveLength(0);
    /* And the discarded turn did nothing. New Chat stops the turn, and the stop is armed before the
       send's first wait, so the call it would have streamed never ran into the chat that replaced
       it, and nothing was requested at all. */
    expect(tab.doc.document.children).toHaveLength(1);
    expect(capturedTools).toEqual([]);
  });

  /* On desktop the chat URL is an IPC round trip, and the chat already reads as streaming while it
     is answered, so Stop is on screen and clickable. A Stop in that window used to find no
     controller: the turn went on to stream and run its tools, and its calls ran with no record in
     the transcript, because the Stop had already cleared the reply they would have been drawn in. */
  test("a Stop while the chat URL is resolved streams nothing and changes nothing", async () => {
    let answer: (url: string) => void = () => {};
    installMockPlatform({
      aiChatUrl: () =>
        new Promise<string>((settle) => {
          answer = settle;
        }),
    });
    const tab = resetWorkspaceWithTab({
      children: [{ tagName: "p", textContent: "one" }],
      tagName: "div",
    });
    nextRounds = [
      toolCallRound("c1", "set_text", { path: ["children", 0], value: "AFTER STOP" }),
      [{ stopReason: "stop", type: "done" }],
    ];

    const a = createDocumentAssistant();
    const sending = a.sendMessage("change it");
    await flush(1);
    expect(a.chatState.status).toBe("streaming");
    a.stop();
    answer("/__mock/ai/chat");
    await sending;

    expect(tab.doc.document.children).toEqual([{ tagName: "p", textContent: "one" }]);
    expect(capturedTools).toEqual([]);
    // No orphan: the stopped reply is gone, and no call or reply was left behind.
    expect(a.chatState.messages.map((m) => m.role)).toEqual(["user"]);
    expect(a.chatState.status).toBe("idle");
    expect(a.chatState.error).toBeNull();
  });
  test("create_project re-anchors the agent's undo batch onto the adopted tab", async () => {
    /* Adoption closes every tab and opens the new project's, so the batch `runAgentLoop` opened on
       the PRE-adoption tab is holding a disposed one by the time the tool returns. Re-reading the
       active tab afterwards is what keeps the rest of the turn's edits undoable — and it only runs
       when a batch was actually open, which needs a document open when the turn started. */
    setWorkspaceProject(null);
    resetWorkspaceWithTab();
    setProjectAdopter(async (root: string) => {
      setWorkspaceProject(root, { name: "Fresh" });
    });
    nextRounds = [
      toolCallRound("c1", "create_project", { location: "/home/dev/Sites", name: "Batched Site" }),
      [
        { content: "Project ready", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    ];

    const a = createDocumentAssistant();
    await a.sendMessage("bootstrap with a document open");

    expect(workspace.projectRoot).toBeTruthy();
    expect(a.chatState.status).toBe("idle");
    // The turn reported the adoption rather than an error about a stale tab.
    expect(
      a.chatState.messages.some(
        (m) => m.role === "assistant" && m.content.includes("Project ready"),
      ),
    ).toBe(true);
  });
});

describe("document-assistant — cross-file wiring", () => {
  test("a project.json write syncs workspace + project config, and the inventory feeds the prompt", async () => {
    setWorkspaceProject("/proj", { name: "Old Name" });
    resetStudioState({
      dirs: new Map([
        [
          ".",
          [
            { name: "index.json", path: "pages/index.json", type: "file" },
            { name: "pages", path: "pages", type: "directory" },
          ],
        ],
      ]),
    });
    nextRounds = [
      toolCallRound("c1", "write_file", {
        content: JSON.stringify({ name: "New Name" }),
        path: "project.json",
      }),
      [{ stopReason: "stop", type: "done" }],
    ];

    const a = createDocumentAssistant();
    await a.sendMessage("rename the project");

    expect((workspace.projectConfig as { name?: string } | null)?.name).toBe("New Name");
    expect((store.projectState?.projectConfig as { name?: string } | null)?.name).toBe("New Name");
    // The file inventory section rode along in the system prompt, files only (no directories).
    const filesSection = capturedSystemPrompts[0]!.split("## Project Files")[1]!;
    expect(filesSection.split("\n\n---\n\n")[0]!.trim()).toBe("pages/index.json");
  });

  /*
   * The assistant's `project.json` write and the settings form used to end up holding two different
   * configuration objects: the write assigned a fresh one to `projectState.projectConfig` while the
   * configuration DOCUMENT kept the previous configuration, and the next settings commit serialised
   * that stale document back over the file. It survived only because an open tab happened to be
   * re-read from disk afterwards. The write now goes INTO the document, so there is nothing beside
   * it to lose to.
   */
  test("a settings edit after the assistant's project.json write extends it, never reverts it", async () => {
    const { state } = installMockPlatform(
      {},
      { "project.json": JSON.stringify({ name: "Old Name" }, null, 2) },
    );
    setWorkspaceProject("/proj", { name: "Old Name" });
    resetStudioState({ dirs: new Map(), projectConfig: { name: "Old Name" } });
    nextRounds = [
      toolCallRound("c1", "write_file", {
        content: JSON.stringify({ name: "New Name" }),
        path: "project.json",
      }),
      [{ stopReason: "stop", type: "done" }],
    ];

    const a = createDocumentAssistant();
    await a.sendMessage("rename the project");

    // The settings form's shape: mutate the live configuration in place, then commit.
    (store.projectState!.projectConfig as { description?: string }).description = "from Settings";
    const result = await commitProjectConfig();

    expect(result.ok).toBe(true);
    expect(JSON.parse(state.files.get("project.json")!)).toEqual({
      description: "from Settings",
      name: "New Name",
    });
  });

  /*
   * The record the settings commit lays the file out with is the record of the file as the
   * assistant left it — not the one the chokepoint read before the write (issue 331). The file
   * starts on disk with every object expanded, the assistant rewrites it with `style` on one line
   * and a blank line after the name, and the settings edit that follows must change one line of
   * THAT file rather than re-expanding it.
   */
  test("a settings edit after the assistant's project.json write keeps the layout the assistant wrote", async () => {
    const before = { name: "Old Name", style: { "--a": "1" } };
    const { state } = installMockPlatform({}, { "project.json": JSON.stringify(before, null, 2) });
    setWorkspaceProject("/proj", before);
    resetStudioState({ dirs: new Map(), projectConfig: structuredClone(before) });
    // A no-op commit first, so the chokepoint has read the file — and its expanded record — BEFORE
    // The assistant rewrites it. Without this the seed would read the assistant's bytes anyway.
    const seeded = await commitProjectConfig();
    expect(seeded.ok).toBe(true);
    expect(state.calls.filter(([name]) => name === "writeFile")).toHaveLength(0);

    const written = '{\n  "name": "New Name",\n\n  "style": { "--a": "1", "--b": "2" }\n}\n';
    nextRounds = [
      toolCallRound("c1", "write_file", { content: written, path: "project.json" }),
      [{ stopReason: "stop", type: "done" }],
    ];
    const a = createDocumentAssistant();
    await a.sendMessage("rename the project and add a variable");
    expect(state.files.get("project.json")).toBe(written);

    (store.projectState!.projectConfig as { description?: string }).description = "from Settings";
    const result = await commitProjectConfig();

    expect(result.ok).toBe(true);
    // One added line on the assistant's file; the inline object and the blank line survive.
    expect(state.files.get("project.json")).toBe(
      written.replace('"2" }', '"2" },\n  "description": "from Settings"'),
    );
  });

  test("write_file over the open clean tab reloads the document from disk", async () => {
    setWorkspaceProject("/proj");
    installMockPlatform();
    const tab = resetWorkspaceWithTab(undefined, { documentPath: "pages/index.json" });
    nextRounds = [
      toolCallRound("c1", "write_file", {
        content: JSON.stringify({ children: [], tagName: "section" }),
        path: "pages/index.json",
      }),
      [{ stopReason: "stop", type: "done" }],
    ];

    const a = createDocumentAssistant();
    await a.sendMessage("rewrite the home page");

    // The write landed AND the open tab reconciled to the on-disk content.
    expect(tab.doc.document.tagName).toBe("section");
    expect(tab.doc.dirty).toBe(false);
    expect(a.chatState.status).toBe("idle");
  });
});
