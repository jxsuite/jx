/**
 * What the assistant asks the author before it runs (specs/ai.md §3.11): a disk write that replaces
 * a file, and an extension being enabled.
 *
 * Three layers, each with its own cases: the policy that decides, the store that takes the author's
 * answer, and the document assistant running a real turn through both. The proxy client is doubled
 * with a scripted one, so a turn is the calls the script makes.
 */
import { clearSeededSettings, installMockPlatform, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createChatState, createToolRegistry } from "@jxsuite/ai";
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";
import { createSessionFacts, createToolDefinition } from "@jxsuite/ai/tools";
import type { ApprovalReason, InteractionRequest, ToolArguments } from "@jxsuite/ai/tools";
import type { JsonObject } from "@jxsuite/schema/types";

let nextRounds: StreamEvent[][] = [];
void mock.module("@jxsuite/ai", () => ({
  createChatState,
  createProxyStreamingClient: (): StreamingClient => {
    let call = 0;
    const rounds = nextRounds;
    return {
      async *streamChat() {
        yield* rounds[call] ?? [{ stopReason: "stop", type: "done" }];
        call += 1;
      },
    };
  },
  createToolRegistry,
}));

const { createDocumentAssistant } = await import("../src/services/document-assistant");
const { studioApprovalPolicy, trustFact } = await import("../src/services/harness/approval-policy");
const { APPROVAL_CHOICES, createInteractionStore } =
  await import("../src/services/harness/interaction-store");
const { projectChip } = await import("../src/panels/ai-chat/chat-view");
const { setWorkspaceProject } = await import("../src/workspace/workspace");

/** One tool call followed by a tool_calls stop. */
function toolCallRound(id: string, name: string, args: JsonObject): StreamEvent[] {
  return [
    { id, name, type: "tool_call_start" },
    { args: JSON.stringify(args), id, type: "tool_call_delta" },
    { id, type: "tool_call_end" },
    { stopReason: "tool_calls", type: "done" },
  ];
}

/** A tool definition with the given name: all a policy reads of one. */
const tool = (name: string) =>
  createToolDefinition({
    description: name,
    execute: () => ({ success: true }),
    name,
    parameters: { properties: {}, type: "object" },
  });

describe("studioApprovalPolicy", () => {
  const existing = new Set(["pages/about.json"]);
  function policy(session = createSessionFacts()) {
    const probes: string[] = [];
    const decide = studioApprovalPolicy({
      fileExists: (path) => {
        probes.push(path);
        return Promise.resolve(existing.has(path));
      },
      session: () => session,
    });
    return {
      decide: (name: string, args: ToolArguments) => decide(tool(name), args),
      probes,
      session,
    };
  }

  test.each(["write_file", "create_component", "create_page"])(
    "%s over a file that exists is confirmed, as a write undo cannot take back",
    async (name) => {
      const { decide } = policy();
      expect(await decide(name, { content: "{}", path: "./pages/about.json" })).toEqual({
        kind: "confirm",
        reason: "not-undoable",
        summary: 'Replace "pages/about.json"?',
      });
    },
  );

  test("a write that creates a file proceeds: nothing is lost", async () => {
    const { decide, probes } = policy();
    expect(await decide("write_file", { content: "{}", path: "pages/new.json" })).toEqual({
      kind: "proceed",
    });
    expect(probes).toEqual(["pages/new.json"]);
  });

  test("a path the tool will refuse is left for the tool to refuse, unprobed", async () => {
    const { decide, probes } = policy();
    expect(await decide("write_file", { content: "{}", path: "../outside.json" })).toEqual({
      kind: "proceed",
    });
    expect(await decide("write_file", { content: "{}" })).toEqual({ kind: "proceed" });
    expect(probes).toEqual([]);
  });

  test("enabling an extension is confirmed, naming the package when the call does", async () => {
    const { decide } = policy();
    expect(await decide("enable_extension", { package: "@jxsuite/search" })).toEqual({
      kind: "confirm",
      reason: "open-world",
      summary: "Install and enable @jxsuite/search?",
    });
    expect(await decide("enable_extension", {})).toMatchObject({
      summary: "Install and enable an extension?",
    });
  });

  test("everything else proceeds, with undo as its backstop", async () => {
    const { decide, probes } = policy();
    for (const name of ["set_text", "add_child", "delete_node", "read_file", "list_files"]) {
      expect(await decide(name, { path: "pages/about.json" })).toEqual({ kind: "proceed" });
    }
    expect(probes).toEqual([]);
  });

  test("a tool the author allowed for this chat is not asked about again, and only that tool", async () => {
    const { decide, probes, session } = policy();
    session.set(trustFact("write_file"), true);
    const overwrite = { content: "{}", path: "pages/about.json" };
    expect(await decide("write_file", overwrite)).toEqual({ kind: "proceed" });
    expect(probes).toEqual([]);
    expect(await decide("create_page", overwrite)).toMatchObject({ kind: "confirm" });
    // The facts are read on every call, so a new chat's facts start with no standing approval.
    const fresh = policy();
    expect(await fresh.decide("write_file", overwrite)).toMatchObject({ kind: "confirm" });
  });
});

describe("the interaction store answers an approval", () => {
  const REQUEST: InteractionRequest = {
    kind: "approval",
    reason: "not-undoable",
    summary: 'Replace "pages/about.json"?',
    title: "Write a file",
    tool: "write_file",
  };

  /** A store with `REQUEST` pending, and where its turn's answer lands. */
  function pendingApproval() {
    const trusted: string[] = [];
    const store = createInteractionStore({ onTrust: (name) => trusted.push(name) });
    if (store.strategy.mode !== "inline") {
      throw new Error("Studio's strategy waits within the turn");
    }
    const controller = new AbortController();
    const answer = store.strategy.resolve(REQUEST, { callId: "c1", signal: controller.signal });
    return { answer, controller, store, trusted };
  }

  test.each<[string, boolean]>([
    [APPROVAL_CHOICES.allow, true],
    ["  yes ", true],
    ["OK", true],
    ["approve", true],
    [APPROVAL_CHOICES.decline, false],
    ["no", false],
    ["what would it change?", false],
    ["", false],
  ])("%p is read as approved: %p", async (said, approved) => {
    const { answer, store, trusted } = pendingApproval();
    expect(store.pending).toEqual({ callId: "c1", request: REQUEST });
    expect(store.answer(said)).toBe(true);
    expect(await answer).toEqual({ approved, kind: "approval" });
    expect(trusted).toEqual([]);
    expect(store.pending).toBeNull();
  });

  test("allowing for the chat approves, and tells the host which tool first", async () => {
    const { answer, store, trusted } = pendingApproval();
    store.answer(APPROVAL_CHOICES.always);
    expect(trusted).toEqual(["write_file"]);
    expect(await answer).toEqual({ approved: true, kind: "approval" });
  });

  test("an approval cannot be left to the assistant: skipping it declines", async () => {
    const { answer, store } = pendingApproval();
    expect(store.skip()).toBe(true);
    expect(await answer).toEqual({ approved: false, kind: "approval" });
  });

  test("a stopped turn declines for the author", async () => {
    const { answer, controller } = pendingApproval();
    controller.abort();
    expect(await answer).toEqual({ approved: false, kind: "approval" });
  });
});

describe("the call's chip asks for the author's leave", () => {
  const call = { arguments: '{"path":"pages/about.json"}', id: "c1", name: "write_file" };
  const request: InteractionRequest = {
    kind: "approval",
    reason: "not-undoable",
    summary: 'Replace "pages/about.json"?',
    title: "Write a file",
    tool: "write_file",
  };

  test("a call waiting on approval is drawn as the card that asks, with its three answers", () => {
    const chip = projectChip(call, { approval: { callId: "c1", request }, pendingId: "c1" });
    expect(chip).toMatchObject({
      askState: "approval",
      context: "This is saved straight to disk, and cannot be undone from Studio's history.",
      hasContext: true,
      kind: "ask",
      options: [
        { key: "Allow", label: "Allow" },
        { key: "Allow for this chat", label: "Allow for this chat" },
        { key: "Decline", label: "Decline" },
      ],
      outcome: "pending",
      question: 'Replace "pages/about.json"?',
    });
  });

  test.each<[ApprovalReason, string]>([
    ["destructive", "This removes or replaces something"],
    ["open-world", "This installs a package from the registry"],
  ])("says why a %s call is asked about", (reason, sentence) => {
    const asked: InteractionRequest = { ...request, reason };
    const chip = projectChip(call, { approval: { callId: "c1", request: asked }, pendingId: "c1" });
    expect(chip.context).toContain(sentence);
  });

  test("every other chip stays a chip: another call, a question pending, nothing pending", () => {
    const question: InteractionRequest = {
      context: "",
      kind: "question",
      options: [],
      question: "?",
    };
    const cases = [
      { approval: { callId: "other", request }, pendingId: "other" },
      { approval: { callId: "c1", request: question }, pendingId: "c1" },
      { approval: null, pendingId: null },
      {},
    ];
    for (const handlers of cases) {
      expect(projectChip(call, handlers)).toMatchObject({ askState: "none", kind: "chip" });
    }
  });
});

describe("a turn that would replace a file", () => {
  const OVERWRITE = { content: "# Changed", path: "notes/readme.md" };

  beforeEach(() => {
    setWorkspaceProject("/proj");
    resetWorkspaceWithTab();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    clearSeededSettings();
    nextRounds = [];
  });

  /** Let the turn run until it is waiting on the author, or has ended. */
  async function untilWaiting(a: ReturnType<typeof createDocumentAssistant>) {
    for (let tick = 0; tick < 200 && !a.interactions.pending && a.isTurnActive(); tick += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
    }
  }

  test("waits on the author, having written nothing, and writes once they allow it", async () => {
    const platform = installMockPlatform({}, { "notes/readme.md": "# Original" });
    nextRounds = [toolCallRound("c1", "write_file", OVERWRITE), []];
    const a = createDocumentAssistant();
    const turn = a.sendMessage("rewrite the readme");
    await untilWaiting(a);

    expect(a.interactions.pending).toMatchObject({
      callId: "c1",
      request: { kind: "approval", summary: 'Replace "notes/readme.md"?', tool: "write_file" },
    });
    expect(platform.state.files.get("notes/readme.md")).toBe("# Original");

    a.interactions.answer(APPROVAL_CHOICES.allow);
    await turn;
    expect(platform.state.files.get("notes/readme.md")).toBe("# Changed");
    expect(a.interactions.pending).toBeNull();
  });

  test("a declined write changes nothing, and the model is told the author declined", async () => {
    const platform = installMockPlatform({}, { "notes/readme.md": "# Original" });
    nextRounds = [toolCallRound("c1", "write_file", OVERWRITE), []];
    const a = createDocumentAssistant();
    const turn = a.sendMessage("rewrite the readme");
    await untilWaiting(a);
    a.interactions.answer(APPROVAL_CHOICES.decline);
    await turn;

    expect(platform.state.files.get("notes/readme.md")).toBe("# Original");
    const reply = a.chatState.messages.find((message) => message.role === "tool");
    expect(reply!.content).toBe('{"success":false,"error":"The author declined this call."}');
  });

  test("allowed for the chat, the next overwrite is not asked about, until a new chat", async () => {
    const platform = installMockPlatform({}, { "notes/readme.md": "# Original" });
    nextRounds = [toolCallRound("c1", "write_file", OVERWRITE), []];
    const a = createDocumentAssistant();
    const first = a.sendMessage("rewrite the readme");
    await untilWaiting(a);
    a.interactions.answer(APPROVAL_CHOICES.always);
    await first;

    nextRounds = [toolCallRound("c2", "write_file", { ...OVERWRITE, content: "# Again" }), []];
    await a.sendMessage("and again");
    expect(platform.state.files.get("notes/readme.md")).toBe("# Again");

    a.newChat();
    nextRounds = [toolCallRound("c3", "write_file", { ...OVERWRITE, content: "# Third" }), []];
    const third = a.sendMessage("once more");
    await untilWaiting(a);
    expect(a.interactions.pending).toMatchObject({ callId: "c3" });
    a.stop();
    await third;
    expect(platform.state.files.get("notes/readme.md")).toBe("# Again");
  });

  test("a write that creates a file is not asked about", async () => {
    const platform = installMockPlatform();
    nextRounds = [
      toolCallRound("c1", "write_file", { content: "# New", path: "notes/new.md" }),
      [],
    ];
    const a = createDocumentAssistant();
    await a.sendMessage("add a note");
    expect(platform.state.files.get("notes/new.md")).toBe("# New");
  });
});
