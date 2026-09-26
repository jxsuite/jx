/**
 * Agent-trace.test.ts — the agent loop's observable behaviour, frozen as golden traces before the
 * harness refactor.
 *
 * Every scenario the three agent-loop suites exercise is replayed here through the REAL
 * `runAgentLoop` (and, for the document-assistant scenarios, the real `sendMessage` path), with the
 * instruments from `harness/trace-recorder.ts` in front of the chat store, the streaming client and
 * the ai-writes ledger. What they saw is compared against
 * `fixtures/agent-traces/<suite>--<slug>.json`:
 *
 * - `loopt` mirrors `ai-loop.test.ts`, test for test (the corpus check below fails when they drift).
 * - `recon` mirrors `ai-loop-reconnect.test.ts`.
 * - `dat` mirrors the send-path tests of `document-assistant.test.ts`; the two that never send are
 *   listed in {@link DAT_NOT_SEND_PATH} rather than silently left out.
 *
 * Setups are copied from those suites rather than shared with them, so a later edit to either side
 * cannot quietly change what the other pins. Each scenario keeps the original's headline assertions
 * as witnesses — a golden recorded from a mis-mirrored setup would otherwise freeze the wrong
 * behaviour without a word.
 *
 * The traces freeze CURRENT behaviour, defects included. A red trace means the loop's behaviour
 * moved: if that was the intent, re-record with `JX_UPDATE_GOLDENS=1 bun test --isolate
 * tests/agent-trace.test.ts` and review the golden diff as the behaviour change it is.
 */
import {
  clearSeededSettings,
  flush,
  installMockPlatform,
  resetStudioState,
  resetWorkspaceWithTab,
  seedSettings,
} from "./harness";
import type { MockPlatformState } from "./harness";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createChatState as liveCreateChatState } from "@jxsuite/ai/chat-state";
import { createToolDefinition, createToolRegistry } from "@jxsuite/ai/tools";
import type { ToolRegistry } from "@jxsuite/ai/tools";
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { Tab } from "../src/tabs/tab";
import type { StudioPlatform } from "../src/types";
import {
  buildTrace,
  createChatCallLog,
  createClientCallLog,
  installAiWritesSpy,
  jsonSafe,
  matchGolden,
  messageShape,
  recordChatState,
  spyStreamingClient,
} from "./harness/trace-recorder";
import type { ChatCallLog, ClientCallLog, Json } from "./harness/trace-recorder";

// ─── Instruments, installed before anything under test is imported ──────────

const writesSpy = await installAiWritesSpy();

interface Recording {
  chatLog: ChatCallLog;
  clientLog: ClientCallLog;
}

/** The scenario being recorded. The `@jxsuite/ai` double below writes into it. */
let recording: Recording | null = null;

/* The document-assistant suite's knobs, exactly as it declares them. */
let nextRounds: StreamEvent[][] = [];
let createErrorMessage: string | null = null;
let lastClientOpts: Record<string, unknown> | null = null;

/**
 * A scripted streaming client: `rounds[n]` is what the nth `streamChat` call yields, and any call
 * past the script ends the turn. The union of the three suites' fakes; what they captured on the
 * side is what {@link spyStreamingClient} now records.
 */
function scripted(rounds: StreamEvent[][]): StreamingClient & { calls: () => number } {
  let call = 0;
  return {
    calls: () => call,
    async *streamChat() {
      const events = rounds[call] ?? [{ stopReason: "stop", type: "done" }];
      call += 1;
      for (const event of events) {
        yield event;
      }
    },
  };
}

/**
 * The real proxy client's contract in front of a scripted one: a lazy URL is resolved once, inside
 * the first stream, and a stream stopped by then sends nothing. The resolved URL is what the
 * recorded options show, as it was when the send path resolved it before building the client.
 */
function lazyUrl(inner: StreamingClient, chatUrl: unknown): StreamingClient {
  let url: Promise<unknown> | null = null;
  return {
    async *streamChat(messages, tools, systemPrompt, signal) {
      url ??= Promise.resolve(
        typeof chatUrl === "function" ? (chatUrl as () => unknown)() : chatUrl,
      );
      const resolved = await url;
      if (lastClientOpts) {
        lastClientOpts = { ...lastClientOpts, chatUrl: resolved };
      }
      if (signal?.aborted) {
        yield { stopReason: "cancelled", type: "done" };
        return;
      }
      yield* inner.streamChat(messages, tools, systemPrompt, signal);
    },
  };
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

/* Captured by VALUE, before the barrel is mocked: Bun patches a mocked module's exports in place,
   and the barrel's `createChatState` is a re-export, so the patch rebinds the subpath module's
   export too. Read live after that, `createChatState` would be the recording double itself. */
const createChatState: typeof liveCreateChatState = liveCreateChatState;

/* The barrel, with its two factories recorded: `createChatState` stays real behind the proxy, and
   `createProxyStreamingClient` is the document-assistant suite's scripted client behind the spy. */
const realAi = await import("@jxsuite/ai");
void mock.module("@jxsuite/ai", () => ({
  ...realAi,
  createChatState: (opts?: { model?: string }) =>
    recordChatState(createChatState(opts), recording?.chatLog ?? createChatCallLog()),
  createProxyStreamingClient: (opts: Record<string, unknown>) => {
    lastClientOpts = opts;
    if (createErrorMessage) {
      throw new Error(createErrorMessage);
    }
    return spyStreamingClient(
      lazyUrl(scripted(nextRounds), opts.chatUrl),
      recording?.clientLog ?? createClientCallLog(),
    );
  },
}));

const { EMPTY_TURN_TEXT, runAgentLoop } = await import("../src/services/tool-executor");
const { registerAiTools } = await import("../src/services/ai-tools");
const { answerAsk, pendingAsk, registerAskTool, resetAsk } = await import("../src/services/ai-ask");
const { createTab, disposeTab } = await import("../src/tabs/tab");
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
const { projectChip } = await import("../src/panels/ai-chat/chat-view");
const { refreshFormats } = await import("../src/format/format-host");
const { ensureProxyProbe, isProxyConfigured, proxyStateCode, resetModelCache } =
  await import("../src/services/ai-models");

// ─── Scenarios and their traces ──────────────────────────────────────────────

type Chat = ReturnType<typeof createChatState>;
type Assistant = ReturnType<typeof createDocumentAssistant>;
type Suite = "dat" | "loopt" | "recon";

/** What a scenario hands back: the chat whose transcript is final, and what else it touched. */
interface Observed {
  chat: Chat;
  finalDocument?: unknown;
  historyIndex?: unknown;
  extra?: Record<string, unknown>;
}

interface Scenario {
  suite: Suite;
  /** The mirrored test's name, verbatim. */
  name: string;
  run: (rec: Recording) => Promise<Observed>;
}

const FIXTURES = resolve(import.meta.dir, "fixtures/agent-traces");

/** Stamp a table of scenarios with the suite it mirrors. */
function inSuite(suite: Suite, scenarios: Omit<Scenario, "suite">[]): Scenario[] {
  return scenarios.map((scenario) => Object.assign(scenario, { suite }));
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 90)
    .replace(/-+$/, "");
}

function goldenFile(scenario: Scenario): string {
  return `${scenario.suite}--${slug(scenario.name)}.json`;
}

async function traceOf(scenario: Scenario): Promise<Json> {
  writesSpy.reset();
  const rec: Recording = { chatLog: createChatCallLog(), clientLog: createClientCallLog() };
  recording = rec;
  try {
    const seen = await scenario.run(rec);
    return buildTrace({
      aiWrites: writesSpy.events,
      chatCalls: rec.chatLog.calls,
      clientCalls: rec.clientLog.calls,
      finalDocument: seen.finalDocument ?? null,
      finalMessages: seen.chat.messages.map((message) => messageShape(message)),
      finalState: {
        contextWarning: seen.chat.contextWarning,
        error: seen.chat.error,
        model: seen.chat.model,
        status: seen.chat.status,
        tokenCount: seen.chat.tokenCount,
        usage: seen.chat.usage,
      },
      historyIndex: seen.historyIndex ?? null,
      ...(seen.extra ? { extra: seen.extra } : {}),
    });
  } finally {
    recording = null;
  }
}

function registerScenarios(scenarios: Scenario[]): void {
  for (const scenario of scenarios) {
    test(scenario.name, async () => {
      matchGolden(resolve(FIXTURES, goldenFile(scenario)), await traceOf(scenario));
    });
  }
}

// ─── loopt: ai-loop.test.ts ──────────────────────────────────────────────────

function makeTab(doc?: Record<string, unknown>): Tab {
  const document = doc ?? { children: [{ tagName: "p", textContent: "Hello" }], tagName: "div" };
  return createTab({ document, id: "test" });
}

/** The suite's `harness()`: a recorded chat store and a registry of the hand document tools. */
function loopHarness(rec: Recording, tab: Tab, validate?: (doc: unknown) => Promise<string[]>) {
  const chatState = recordChatState(createChatState({ model: "test" }), rec.chatLog);
  const toolRegistry = createToolRegistry();
  registerAiTools(toolRegistry, { getTab: () => tab, ...(validate ? { validate } : {}) });
  return { chatState, toolRegistry: toolRegistry as ToolRegistry };
}

/** `runAgentLoop` with the client behind the spy. */
function loop(
  rec: Recording,
  opts: {
    chatState: Chat;
    client: StreamingClient;
    toolRegistry: ToolRegistry;
    systemPrompt?: string;
    signal?: AbortSignal;
    getTab?: () => Tab | null;
  },
): Promise<void> {
  return runAgentLoop({
    chatState: opts.chatState,
    streamingClient: spyStreamingClient(opts.client, rec.clientLog),
    systemPrompt: opts.systemPrompt ?? "",
    toolRegistry: opts.toolRegistry,
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.getTab ? { getTab: opts.getTab } : {}),
  });
}

/** Snapshot a tab, dispose it, and hand back the observation. */
function settleTab(chat: Chat, tab: Tab, extra?: Record<string, unknown>): Observed {
  const observed: Observed = {
    chat,
    finalDocument: jsonSafe(tab.doc.document),
    historyIndex: tab.history.index,
    ...(extra ? { extra } : {}),
  };
  disposeTab(tab);
  return observed;
}

const ADD_SPAN = {
  index: 1,
  node: { tagName: "span", textContent: "added" },
  parentPath: [],
};

function childrenOf(tab: Tab): (JxMutableNode | string)[] {
  return tab.doc.document.children as (JxMutableNode | string)[];
}

/**
 * One `edit` tool that records a write the way a document tool does, and can stop the turn from
 * inside its call. The setup of `ai-loop.test.ts`'s `editHarness`.
 */
function editHarness(rec: Recording, opts: { ok?: boolean; stopDuring?: boolean } = {}) {
  const controller = new AbortController();
  const chatState = recordChatState(createChatState({ model: "test" }), rec.chatLog);
  const toolRegistry = createToolRegistry();
  toolRegistry.register(
    createToolDefinition({
      description: "records one write",
      async execute(_args, ctx) {
        const ok = opts.ok ?? true;
        ctx.ledger.record({ disk: false, ok, path: "/pages/index.json", tool: "Edit" });
        if (opts.stopDuring) {
          controller.abort();
        }
        return ok ? { success: true, summary: "Edited." } : { error: "No.", success: false };
      },
      name: "edit",
      parameters: { properties: {}, type: "object" },
    }),
  );
  const run = (client: StreamingClient) =>
    loop(rec, {
      chatState,
      client,
      signal: controller.signal,
      toolRegistry: toolRegistry as ToolRegistry,
    });
  return { chatState, run };
}

/** `ask_user` plus the hand tools, and an author who answers every question as it appears. */
function askHarness(rec: Recording, reply: (n: number) => string = () => "yes") {
  const chatState = recordChatState(createChatState({ model: "test" }), rec.chatLog);
  const toolRegistry = createToolRegistry();
  registerAskTool(toolRegistry);
  const tab = makeTab();
  registerAiTools(toolRegistry, { getTab: () => tab, validate: async () => [] });
  let answered = 0;
  const tick = setInterval(() => {
    if (pendingAsk()) {
      answered += 1;
      answerAsk(reply(answered));
    }
  }, 0);
  return {
    answered: () => answered,
    chatState,
    /** Snapshot, then tear down exactly as the suite's `stop()` does. */
    finish: (): Observed => {
      clearInterval(tick);
      const observed = settleTab(chatState, tab, { answered });
      resetAsk();
      return observed;
    },
    toolRegistry: toolRegistry as ToolRegistry,
  };
}

const LOOPT = inSuite("loopt", [
  {
    name: "executes a tool call and mutates the live document",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const client = scripted([
        toolCallRound("c1", "add_child", ADD_SPAN),
        [{ stopReason: "stop", type: "done" }],
      ]);
      chatState.sendMessage("add a span");
      await loop(rec, { chatState, client, toolRegistry });
      expect(childrenOf(tab)).toHaveLength(2);
      expect(tab.history.index).toBe(1);
      expect(chatState.status).toBe("idle");
      return settleTab(chatState, tab);
    },
  },
  {
    name: "runs streamed tool calls even when the backend reports a plain stop",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const round = toolCallRound("c1", "add_child", ADD_SPAN);
      round[round.length - 1] = { stopReason: "stop", type: "done" };
      const client = scripted([round, [{ stopReason: "stop", type: "done" }]]);
      chatState.sendMessage("add a span");
      await loop(rec, { chatState, client, toolRegistry });
      expect(childrenOf(tab)).toHaveLength(2);
      expect(client.calls()).toBe(2);
      return settleTab(chatState, tab);
    },
  },
  {
    name: "a round the author stopped runs nothing it streamed",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const controller = new AbortController();
      const round = toolCallRound("c1", "set_text", { path: ["children", 0], value: "AFTER STOP" });
      const client = scripted([[...round.slice(0, -1), { stopReason: "cancelled", type: "done" }]]);
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
      await loop(rec, { chatState, client, signal: controller.signal, toolRegistry });
      expect(childrenOf(tab)[0]).toEqual({ tagName: "p", textContent: "Hello" });
      expect(client.calls()).toBe(1);
      return settleTab(chatState, tab);
    },
  },
  {
    name: "a round that ends cancelled runs nothing, even before the signal reads aborted",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const round = toolCallRound("c1", "set_text", { path: ["children", 0], value: "CANCELLED" });
      const client = scripted([[...round.slice(0, -1), { stopReason: "cancelled", type: "done" }]]);
      chatState.sendMessage("change the text");
      await loop(rec, {
        chatState,
        client,
        signal: new AbortController().signal,
        toolRegistry,
      });
      expect(childrenOf(tab)[0]).toEqual({ tagName: "p", textContent: "Hello" });
      expect(client.calls()).toBe(1);
      return settleTab(chatState, tab);
    },
  },
  {
    name: "a Stop that lands between two calls stops the second",
    async run(rec) {
      const tab = makeTab();
      const controller = new AbortController();
      const chatState = recordChatState(createChatState({ model: "test" }), rec.chatLog);
      const toolRegistry = createToolRegistry();
      registerAiTools(toolRegistry, { getTab: () => tab, validate: async () => [] });
      const ran: string[] = [];
      toolRegistry.register(
        createToolDefinition({
          description: "stops the turn while it runs",
          async execute() {
            ran.push("first");
            controller.abort();
            return { success: true };
          },
          name: "first",
          parameters: { properties: {}, type: "object" },
        }),
      );
      toolRegistry.register(
        createToolDefinition({
          description: "must not run after the Stop",
          async execute() {
            ran.push("second");
            return { success: true };
          },
          name: "second",
          parameters: { properties: {}, type: "object" },
        }),
      );
      const client = scripted([
        [
          { id: "a", name: "first", type: "tool_call_start" },
          { id: "a", type: "tool_call_end" },
          { id: "b", name: "second", type: "tool_call_start" },
          { id: "b", type: "tool_call_end" },
          { stopReason: "tool_calls", type: "done" },
        ],
      ]);
      chatState.sendMessage("do both");
      await loop(rec, {
        chatState,
        client,
        signal: controller.signal,
        toolRegistry: toolRegistry as ToolRegistry,
      });
      expect(ran).toEqual(["first"]);
      expect(client.calls()).toBe(1);
      return settleTab(chatState, tab, { ran });
    },
  },
  {
    name: "records the provider's usage count on the chat state",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const client = scripted([
        [
          { content: "Done.", type: "delta" },
          { inputTokens: 640, outputTokens: 12, type: "usage" },
          { stopReason: "stop", type: "done" },
        ],
      ]);
      chatState.sendMessage("hello");
      await loop(rec, { chatState, client, systemPrompt: "p".repeat(400), toolRegistry });
      expect(chatState.usage?.contextTokens).toBe(652);
      expect(chatState.usage?.systemTokens).toBe(100);
      expect(chatState.tokenCount).toBe(652);
      return settleTab(chatState, tab);
    },
  },
  {
    name: "sends no empty assistant turn, and replays the reasoning it was given",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const client = scripted([
        [
          { content: "They want a span. ", type: "reasoning" },
          { content: "add_child does it.", type: "reasoning" },
          ...toolCallRound("c1", "add_child", ADD_SPAN),
        ],
        [{ stopReason: "stop", type: "done" }],
      ]);
      chatState.sendMessage("add a span");
      await loop(rec, { chatState, client, toolRegistry });
      const sent = rec.clientLog.calls.map((call) =>
        (call.messages as { role: string }[]).map((m) => m.role),
      );
      expect(sent).toEqual([["user"], ["user", "assistant", "tool"]]);
      return settleTab(chatState, tab);
    },
  },
  {
    name: "feeds schema errors back so the model can self-correct",
    async run(rec) {
      const tab = makeTab();
      const validate = async (doc: unknown) =>
        (doc as JxMutableNode).tagName === "header"
          ? ["(root): invalid custom element tagName"]
          : [];
      const { chatState, toolRegistry } = loopHarness(rec, tab, validate);
      const client = scripted([
        toolCallRound("c1", "set_property", { key: "tagName", path: [], value: "header" }),
        toolCallRound("c2", "set_property", { key: "tagName", path: [], value: "site-header" }),
        [{ stopReason: "stop", type: "done" }],
      ]);
      chatState.sendMessage("rename root to header");
      await loop(rec, { chatState, client, toolRegistry });
      expect(tab.doc.document.tagName).toBe("site-header");
      const toolMsgs = chatState.messages.filter((m) => m.role === "tool");
      expect(toolMsgs[0]!.content).toContain("invalid custom element tagName");
      expect(toolMsgs[1]!.content).toContain('"success":true');
      return settleTab(chatState, tab);
    },
  },
  {
    name: "a run that hit the round cap AFTER applying changes is not an error (ai.md §3.2)",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const client = scripted(
        Array.from({ length: 10 }, (_, i) =>
          toolCallRound(`c${i}`, "set_property", { key: "id", path: [], value: `v${i}` }),
        ),
      );
      chatState.sendMessage("loop forever");
      await loop(rec, { chatState, client, toolRegistry });
      expect(client.calls()).toBe(5);
      expect(chatState.error).toBeNull();
      expect(chatState.messages.at(-1)!.content).toContain("Changes applied so far");
      return settleTab(chatState, tab);
    },
  },
  {
    name: "surfaces an upstream stream error and stops",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const client = scripted([[{ message: "upstream 500", type: "error" }]]);
      chatState.sendMessage("hi");
      await loop(rec, { chatState, client, toolRegistry });
      expect(chatState.status).toBe("error");
      expect(client.calls()).toBe(1);
      return settleTab(chatState, tab);
    },
  },
  {
    name: "summarizes accumulated tool errors (and ignores unknown events) at the round cap",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const client = scripted(
        Array.from({ length: 6 }, () => [
          { type: "noop" } as unknown as StreamEvent,
          { id: "c", name: "set_text", type: "tool_call_start" },
          {
            args: JSON.stringify({ path: ["children", 9], value: "x" }),
            id: "c",
            type: "tool_call_delta",
          },
          { id: "c", type: "tool_call_end" },
          { stopReason: "tool_calls", type: "done" },
        ]),
      );
      chatState.sendMessage("delete everything repeatedly");
      await loop(rec, { chatState, client, toolRegistry });
      expect(chatState.status).toBe("error");
      expect(chatState.error).toContain("No node exists at path");
      return settleTab(chatState, tab);
    },
  },
  {
    name: "reports a tool call whose arguments are malformed JSON",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const client = scripted([
        [
          { id: "c1", name: "set_property", type: "tool_call_start" },
          { args: "{not json", id: "c1", type: "tool_call_delta" },
          { id: "c1", type: "tool_call_end" },
          { stopReason: "tool_calls", type: "done" },
        ],
        [{ stopReason: "stop", type: "done" }],
      ]);
      chatState.sendMessage("break it");
      await loop(rec, { chatState, client, toolRegistry });
      const toolMsg = chatState.messages.find((m) => m.role === "tool");
      expect(toolMsg!.content).toContain("Failed to parse arguments");
      return settleTab(chatState, tab);
    },
  },
  {
    name: "a turn that moves to a second document gives BOTH documents a history entry",
    async run(rec) {
      const first = createTab({ document: { children: [], tagName: "div" }, id: "first" });
      const second = createTab({ document: { children: [], tagName: "section" }, id: "second" });
      let current: Tab = first;
      const chatState = recordChatState(createChatState({ model: "test" }), rec.chatLog);
      const toolRegistry = createToolRegistry();
      registerAiTools(toolRegistry, { getTab: () => current, validate: async () => [] });
      const beforeSecond = second.history.snapshots.length;
      const client = scripted([
        toolCallRound("a", "set_property", { key: "id", path: [], value: "one" }),
        toolCallRound("b", "set_property", { key: "id", path: [], value: "two" }),
      ]);
      const originalStream = client.streamChat.bind(client);
      let round = 0;
      client.streamChat = async function* streamChat(...args: Parameters<typeof originalStream>) {
        round += 1;
        if (round === 2) {
          current = second; // Between rounds the user (or a tool) moves to the other document
        }
        yield* originalStream(...args);
      };
      chatState.sendMessage("edit both");
      await loop(rec, {
        chatState,
        client,
        getTab: () => current,
        toolRegistry: toolRegistry as ToolRegistry,
      });
      expect((second.doc.document as Record<string, unknown>).id).toBe("two");
      expect(second.history.snapshots.length).toBeGreaterThan(beforeSecond);
      const observed: Observed = {
        chat: chatState,
        extra: {
          snapshots: {
            first: first.history.snapshots.length,
            second: second.history.snapshots.length,
            secondBefore: beforeSecond,
          },
        },
        finalDocument: {
          first: jsonSafe(first.doc.document),
          second: jsonSafe(second.doc.document),
        },
        historyIndex: { first: first.history.index, second: second.history.index },
      };
      disposeTab(first);
      disposeTab(second);
      return observed;
    },
  },
  {
    name: "a round that only asked does not spend the work budget",
    async run(rec) {
      const h = askHarness(rec);
      const client = scripted([
        toolCallRound("a1", "ask_user", { question: "Which?" }),
        toolCallRound("a2", "ask_user", { question: "And then?" }),
        toolCallRound("a3", "ask_user", { question: "Sure?" }),
        ...Array.from({ length: 10 }, (_, i) => toolCallRound(`w${i}`, "read_document", {})),
      ]);
      h.chatState.sendMessage("ask me things");
      await loop(rec, { chatState: h.chatState, client, toolRegistry: h.toolRegistry });
      expect(h.answered()).toBe(3);
      expect(client.calls()).toBe(8);
      return h.finish();
    },
  },
  {
    name: "a round that asked AND worked spends the budget",
    async run(rec) {
      const h = askHarness(rec);
      const client = scripted(
        Array.from({ length: 10 }, (_, i) => [
          { id: `a${i}`, name: "ask_user", type: "tool_call_start" },
          { args: JSON.stringify({ question: "Which?" }), id: `a${i}`, type: "tool_call_delta" },
          { id: `a${i}`, type: "tool_call_end" },
          { id: `w${i}`, name: "read_document", type: "tool_call_start" },
          { args: "{}", id: `w${i}`, type: "tool_call_delta" },
          { id: `w${i}`, type: "tool_call_end" },
          { stopReason: "tool_calls", type: "done" },
        ]) as StreamEvent[][],
      );
      h.chatState.sendMessage("ask and work");
      await loop(rec, { chatState: h.chatState, client, toolRegistry: h.toolRegistry });
      expect(client.calls()).toBe(5);
      return h.finish();
    },
  },
  {
    name: "a model that only ever asks still terminates",
    async run(rec) {
      const h = askHarness(rec);
      const client = scripted(
        Array.from({ length: 40 }, (_, i) => toolCallRound(`a${i}`, "ask_user", { question: "?" })),
      );
      h.chatState.sendMessage("ask forever");
      await loop(rec, { chatState: h.chatState, client, toolRegistry: h.toolRegistry });
      expect(client.calls()).toBe(25);
      return h.finish();
    },
  },
  {
    name: "stopping the turn settles the question instead of hanging the loop",
    async run(rec) {
      const chatState = recordChatState(createChatState({ model: "test" }), rec.chatLog);
      const toolRegistry = createToolRegistry();
      registerAskTool(toolRegistry);
      const controller = new AbortController();
      const client = scripted([toolCallRound("a1", "ask_user", { question: "Which?" })]);
      chatState.sendMessage("ask me");
      const running = loop(rec, {
        chatState,
        client,
        signal: controller.signal,
        toolRegistry: toolRegistry as ToolRegistry,
      });
      // Let the round reach the tool, then stop the turn the way `assistant.stop` does.
      await new Promise((r) => {
        setTimeout(r, 0);
      });
      const pendingBeforeStop = jsonSafe(pendingAsk());
      expect(pendingBeforeStop).not.toBeNull();
      controller.abort();
      await running;
      const pendingAfterStop = jsonSafe(pendingAsk());
      expect(pendingAfterStop).toBeNull();
      resetAsk();
      return { chat: chatState, extra: { pendingAfterStop, pendingBeforeStop } };
    },
  },
  {
    name: "a live chip shows the result the loop recorded, and an answered question its answer",
    async run(rec) {
      const chatState = recordChatState(createChatState({ model: "test" }), rec.chatLog);
      const toolRegistry = createToolRegistry();
      registerAskTool(toolRegistry);
      const client = scripted([
        toolCallRound("q1", "ask_user", { options: ["Home", "Blog"], question: "Which pages?" }),
        [{ stopReason: "stop", type: "done" }],
      ]);
      chatState.sendMessage("ask me");
      const running = loop(rec, {
        chatState,
        client,
        toolRegistry: toolRegistry as ToolRegistry,
      });
      await new Promise((r) => {
        setTimeout(r, 0);
      });
      answerAsk("Blog");
      await running;
      const record = chatState.messages.find((m) => m.toolCalls?.length)!.toolCalls![0]!;
      const chip = projectChip(record, { pendingId: pendingAsk()?.id ?? null });
      expect(chip.askState).toBe("answered");
      expect(chip.answer).toBe("Blog");
      resetAsk();
      return { chat: chatState, extra: { answer: chip.answer, askState: chip.askState } };
    },
  },
  {
    name: "a Stop during the last call opens no further round",
    async run(rec) {
      const h = editHarness(rec, { stopDuring: true });
      const client = scripted([
        toolCallRound("c1", "edit", {}),
        [{ stopReason: "stop", type: "done" }],
      ]);
      h.chatState.sendMessage("edit it");
      await h.run(client);
      expect(client.calls()).toBe(1);
      expect(h.chatState.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
      return { chat: h.chatState };
    },
  },
  {
    name: "a stream error removes its round's partial message, calls and all",
    async run(rec) {
      const h = editHarness(rec);
      const client = scripted([
        [
          { content: "Let me ", type: "delta" },
          { id: "c1", name: "edit", type: "tool_call_start" },
          { args: '{"half', id: "c1", type: "tool_call_delta" },
          { message: "upstream 500", type: "error" },
        ],
      ]);
      h.chatState.sendMessage("edit it");
      await h.run(client);
      expect(h.chatState.status).toBe("error");
      expect(h.chatState.messages.map((m) => m.role)).toEqual(["user"]);
      return { chat: h.chatState };
    },
  },
  {
    name: "a stream error after a round of work keeps that round and removes only its own partial",
    async run(rec) {
      const h = editHarness(rec);
      const client = scripted([
        toolCallRound("c1", "edit", {}),
        [
          { content: "Now the", type: "delta" },
          { message: "upstream 500", type: "error" },
        ],
      ]);
      h.chatState.sendMessage("edit it");
      await h.run(client);
      expect(h.chatState.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
      return { chat: h.chatState };
    },
  },
  {
    name: "a turn whose model sends back nothing ends on an error row saying so",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const client = scripted([[{ stopReason: "stop", type: "done" }]]);
      chatState.sendMessage("hello?");
      await loop(rec, { chatState, client, toolRegistry });
      expect(chatState.status).toBe("error");
      expect(chatState.error).toBe(EMPTY_TURN_TEXT);
      return settleTab(chatState, tab);
    },
  },
  {
    name: "an empty final round after work is a complete turn, not an error",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const client = scripted([
        toolCallRound("c1", "add_child", ADD_SPAN),
        [{ stopReason: "stop", type: "done" }],
      ]);
      chatState.sendMessage("add a span");
      await loop(rec, { chatState, client, toolRegistry });
      expect(chatState.status).toBe("idle");
      return settleTab(chatState, tab);
    },
  },
  {
    name: "a stopped turn that drew nothing is not an error",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      const client = scripted([[{ stopReason: "cancelled", type: "done" }]]);
      chatState.sendMessage("never mind");
      await loop(rec, { chatState, client, toolRegistry });
      expect(chatState.status).toBe("idle");
      expect(chatState.error).toBeNull();
      return settleTab(chatState, tab);
    },
  },
  {
    name: "a turn that only read and ran out of rounds applied nothing, and says so as an error",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      /* A read that reports in a sentence, as list_files, search_files and ask_user do: it
         succeeds with a summary and writes nothing. */
      toolRegistry.register(
        createToolDefinition({
          description: "reads, and says what it read",
          async execute() {
            return { success: true, summary: "Looked at the page." };
          },
          name: "peek",
          parameters: { properties: {}, type: "object" },
        }),
      );
      const client = scripted(
        Array.from({ length: 6 }, (_, i) => toolCallRound(`r${i}`, "peek", {})),
      );
      chatState.sendMessage("look at everything");
      await loop(rec, { chatState, client, toolRegistry });
      expect(client.calls()).toBe(5);
      expect(chatState.status).toBe("error");
      expect(chatState.error).not.toContain("Changes applied so far");
      return settleTab(chatState, tab);
    },
  },
  {
    name: "the round cap lists the calls that wrote, not the ones that read",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      /* A read that reports in a sentence, as list_files, search_files and ask_user do: it
         succeeds with a summary and writes nothing. */
      toolRegistry.register(
        createToolDefinition({
          description: "reads, and says what it read",
          async execute() {
            return { success: true, summary: "Looked at the page." };
          },
          name: "peek",
          parameters: { properties: {}, type: "object" },
        }),
      );
      const round = (i: number): StreamEvent[] => [
        { id: `r${i}`, name: "peek", type: "tool_call_start" },
        { id: `r${i}`, type: "tool_call_end" },
        { id: `w${i}`, name: "set_property", type: "tool_call_start" },
        {
          args: JSON.stringify({ key: "id", path: [], value: `v${i}` }),
          id: `w${i}`,
          type: "tool_call_delta",
        },
        { id: `w${i}`, type: "tool_call_end" },
        { stopReason: "tool_calls", type: "done" },
      ];
      const client = scripted(Array.from({ length: 6 }, (_, i) => round(i)));
      chatState.sendMessage("read then write, repeatedly");
      await loop(rec, { chatState, client, toolRegistry });
      expect(chatState.status).toBe("idle");
      expect(chatState.messages.at(-1)!.content).toContain("Changes applied so far");
      return settleTab(chatState, tab);
    },
  },
  {
    name: "a capped turn that created a project lists the project as applied",
    async run(rec) {
      const tab = makeTab();
      const { chatState, toolRegistry } = loopHarness(rec, tab, async () => []);
      toolRegistry.register(
        createToolDefinition({
          description: "creates a project the way create_project does",
          async execute(_args, ctx) {
            ctx.ledger.record({ disk: true, ok: true, path: "/abs/site", tool: "create_project" });
            return { success: true, summary: "Created project at /abs/site and opened it." };
          },
          name: "bootstrap",
          parameters: { properties: {}, type: "object" },
        }),
      );
      toolRegistry.register(
        createToolDefinition({
          description: "reads, and says what it read",
          async execute() {
            return { success: true, summary: "Looked at the page." };
          },
          name: "peek",
          parameters: { properties: {}, type: "object" },
        }),
      );
      const client = scripted([
        toolCallRound("b", "bootstrap", {}),
        ...Array.from({ length: 5 }, (_, i) => toolCallRound(`r${i}`, "peek", {})),
      ]);
      chatState.sendMessage("make me a site");
      await loop(rec, { chatState, client, toolRegistry });
      expect(chatState.status).toBe("idle");
      return settleTab(chatState, tab);
    },
  },
]);

// ─── dat: document-assistant.test.ts, the send path ──────────────────────────

/** The platform the latest `installMockPlatform` registered, for the trace's platform calls. */
let platformState: MockPlatformState;

function installPlatform(
  overrides: Partial<StudioPlatform> = {},
  seedFiles: Record<string, string> = {},
): MockPlatformState {
  platformState = installMockPlatform(overrides, seedFiles).state;
  return platformState;
}

/** Which editor the registry fixture reports the focused pane as showing. */
let editorKind: "canvas" | "config" = "canvas";

/** The suite's registry fixture, verbatim: two selection verbs and an inline `selection.delete`. */
function installRegistryFixture(): void {
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

function sessionsIn(root: string): Json {
  return jsonSafe(
    listSessions(root).map((meta) => ({
      id: meta.id,
      persisted: (loadSession(root, meta.id) ?? []).map((m) => `${m.id} ${m.role}`),
      title: meta.title,
    })),
  );
}

/**
 * The document-assistant's world after a send: the active tab, every session store it could have
 * written (unscoped, and the project's once one is open), the client options it built, and what it
 * asked the platform to do. Persisted messages are listed by id and role; their content is
 * `finalMessages`.
 */
function datObserve(a: Assistant, extra: Record<string, unknown> = {}): Observed {
  const tab = activeTab.value;
  const root = workspace.projectRoot || "";
  return {
    chat: a.chatState,
    extra: {
      /* The scenario's own observations first: placeholders are numbered by first appearance, so
         a checkpoint naming "the first session" makes it `session#1`. */
      ...extra,
      activeSession: a.activeSessionId(),
      clientOptions: lastClientOpts,
      platformCalls: platformState.calls.map(([name, first]) =>
        typeof first === "string"
          ? `${String(name)}(${JSON.stringify(first)})`
          : `${String(name)}()`,
      ),
      projectRoot: workspace.projectRoot ?? null,
      sessions: {
        "(unscoped)": sessionsIn(""),
        ...(root ? { [root]: sessionsIn(root) } : {}),
      },
      writtenFiles: platformState.calls
        .filter(([name]) => name === "writeFile")
        .map(([, path, content]) => ({ content, path })),
    },
    finalDocument: tab ? jsonSafe(tab.doc.document) : null,
    historyIndex: tab ? tab.history.index : null,
  };
}

/** The persisted messages of the unscoped active session (the suite's `persistedMessages`). */
function persistedMessages() {
  const activeId = getActiveSessionId("");
  return activeId ? loadSession("", activeId) : null;
}

/** The tools and prompt of the latest client call. */
function lastCall(rec: Recording): { tools: string[]; prompt: string } {
  return {
    prompt: rec.clientLog.prompts.at(-1) ?? "",
    tools: rec.clientLog.calls.at(-1)?.tools ?? [],
  };
}

const DAT = inSuite("dat", [
  {
    name: "streams a text reply and persists the conversation",
    async run() {
      seedSettings({
        "jx.ai.baseUrl": "http://localhost:11434/v1",
        "jx.ai.openaiKey": "sk-secret",
      });
      nextRounds = [
        [
          { content: "Hello there", type: "delta" },
          { stopReason: "stop", type: "done" },
        ],
      ];
      const a = createDocumentAssistant();
      await a.sendMessage("hi");
      expect(a.chatState.status).toBe("idle");
      expect(lastClientOpts?.apiKey).toBe("sk-secret");
      expect(persistedMessages()?.some((m) => m.role === "assistant")).toBe(true);
      expect(listSessions("")[0]!.title).toBe("hi");
      return datObserve(a);
    },
  },
  {
    name: "executes a tool call that mutates the document as a single undo step",
    async run() {
      nextRounds = [
        toolCallRound("c1", "add_child", ADD_SPAN),
        [{ stopReason: "stop", type: "done" }],
      ];
      const a = createDocumentAssistant();
      const tab = resetWorkspaceWithTab({
        children: [{ tagName: "p", textContent: "Hello" }],
        tagName: "div",
      });
      await a.sendMessage("add a span");
      expect(childrenOf(tab)).toHaveLength(2);
      expect(tab.history.index).toBe(1);
      return datObserve(a);
    },
  },
  {
    name: "create_page writes the file through the platform saveFile wiring",
    async run() {
      const state = installPlatform();
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
      expect(state.calls.filter(([name]) => name === "writeFile")).toHaveLength(1);
      expect(a.listSessions()[0]!.title).toBe("make an about page");
      return datObserve(a);
    },
  },
  {
    name: "ignores empty input and re-entrant sends while streaming",
    async run() {
      const a = createDocumentAssistant();
      await a.sendMessage("   ");
      expect(a.chatState.messages).toHaveLength(0);
      a.chatState.status = "streaming";
      await a.sendMessage("blocked");
      expect(a.chatState.messages).toHaveLength(0);
      expect(listSessions("")).toHaveLength(0);
      return datObserve(a);
    },
  },
  {
    name: "surfaces a streaming-client construction failure as an error",
    async run() {
      createErrorMessage = "network down";
      const a = createDocumentAssistant();
      await a.sendMessage("hi");
      expect(a.chatState.status).toBe("error");
      expect(a.chatState.error).toContain("network down");
      return datObserve(a);
    },
  },
  {
    name: "stop() and newChat() detach from the session without deleting it",
    async run() {
      nextRounds = [
        [
          { content: "x", type: "delta" },
          { stopReason: "stop", type: "done" },
        ],
      ];
      const a = createDocumentAssistant();
      await a.sendMessage("hi");
      const sessionId = a.activeSessionId();
      a.stop();
      a.newChat();
      expect(a.chatState.messages).toHaveLength(0);
      expect(a.activeSessionId()).toBeNull();
      expect(listSessions("").some((s) => s.id === sessionId)).toBe(true);
      return datObserve(a, { sessionBeforeNewChat: sessionId });
    },
  },
  {
    name: "openSession swaps the live chat; deleteSession of the open one clears it",
    async run() {
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
      const checkpoints: Record<string, unknown> = {};
      await a.sendMessage("first chat");
      const firstId = a.activeSessionId()!;
      a.newChat();
      await a.sendMessage("second chat");
      const secondId = a.activeSessionId()!;
      checkpoints.afterSends = { first: firstId, second: secondId };
      a.openSession(firstId);
      checkpoints.afterOpenFirst = a.activeSessionId();
      checkpoints.openFirstMessages = a.chatState.messages.map((m) => m.content);
      a.openSession("nope");
      checkpoints.afterOpenUnknown = a.activeSessionId();
      a.deleteSession(firstId);
      checkpoints.afterDeleteOpen = a.activeSessionId();
      a.openSession(secondId);
      a.deleteSession("already-gone");
      checkpoints.afterDeleteUnknown = a.activeSessionId();
      expect(secondId).not.toBe(firstId);
      expect(listSessions("").map((s) => s.id)).toEqual([secondId]);
      expect(a.activeSessionId()).toBe(secondId);
      return datObserve(a, { checkpoints });
    },
  },
  {
    name: "a send while a turn's tools run is refused, and the turn reads active until it ends",
    async run(rec) {
      nextRounds = [
        toolCallRound("q1", "ask_user", { question: "Keep it?" }),
        [{ stopReason: "stop", type: "done" }],
      ];
      const a = createDocumentAssistant();
      const first = a.sendMessage("first");
      for (let tick = 0; tick < 50 && !pendingAsk(); tick++) {
        await flush(1);
      }
      const activeWhileWaiting = a.isTurnActive();
      expect(activeWhileWaiting).toBe(true);
      const streams = rec.clientLog.calls.length;
      await a.sendMessage("second");
      expect(rec.clientLog.calls).toHaveLength(streams);
      expect(a.chatState.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
        "first",
      ]);
      answerAsk("yes");
      await first;
      expect(a.isTurnActive()).toBe(false);
      return datObserve(a, { activeWhileWaiting });
    },
  },
  {
    name: "after New Chat stops a waiting turn, the next send is accepted once it has ended",
    async run() {
      nextRounds = [
        toolCallRound("q1", "ask_user", { question: "Keep it?" }),
        [{ stopReason: "stop", type: "done" }],
      ];
      const a = createDocumentAssistant();
      const first = a.sendMessage("first");
      for (let tick = 0; tick < 50 && !pendingAsk(); tick++) {
        await flush(1);
      }
      a.newChat();
      // Stopped, but not yet unwound: the window still holds the turn.
      expect(a.isTurnActive()).toBe(true);
      await a.whenTurnEnds();
      expect(a.isTurnActive()).toBe(false);
      nextRounds = [
        [
          { content: "Importing.", type: "delta" },
          { stopReason: "stop", type: "done" },
        ],
      ];
      await a.sendMessage("import");
      await first;
      expect(a.chatState.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([
        "import",
      ]);
      return datObserve(a);
    },
  },
  {
    name: "a chat opened while a turn waits gets none of that turn's reply or changes",
    async run() {
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
      nextRounds = [
        toolCallRound("c1", "add_child", { index: 1, node: { tagName: "span" }, parentPath: [] }),
        toolCallRound("q1", "ask_user", { question: "Keep it?" }),
      ];
      const running = a.sendMessage("second chat");
      for (let tick = 0; tick < 50 && !pendingAsk(); tick++) {
        await flush(1);
      }
      expect(pendingAsk()).not.toBeNull();
      /* Past the millisecond the question's own save landed in. The recorded session list is most
         recently updated first, and two saves in one millisecond would tie on it. */
      await new Promise((settle) => {
        setTimeout(settle, 5);
      });
      a.openSession(firstId);
      await running;
      expect(a.chatState.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(a.chatState.messages.map((m) => writesForTurn(m.id))).toEqual([[], []]);
      expect((tab.doc.document.children as unknown[]).length).toBe(2);
      return datObserve(a);
    },
  },
  {
    name: "sends with no document and no project, advertising only bootstrap tools",
    async run(rec) {
      closeAllTabs();
      nextRounds = [
        [
          { content: "Let's start a project", type: "delta" },
          { stopReason: "stop", type: "done" },
        ],
      ];
      const a = createDocumentAssistant();
      await a.sendMessage("I want a portfolio site");
      const { prompt, tools } = lastCall(rec);
      expect(tools).toContain("create_project");
      expect(tools).not.toContain("set_property");
      expect(prompt).toContain("No project is open yet");
      return datObserve(a);
    },
  },
  {
    name: "with a project and a document, file and document tools are advertised together",
    async run(rec) {
      setWorkspaceProject("/proj");
      nextRounds = [[{ stopReason: "stop", type: "done" }]];
      const a = createDocumentAssistant();
      await a.sendMessage("hi");
      const { tools } = lastCall(rec);
      expect(tools).toContain("set_property");
      expect(tools).toContain("write_file");
      expect(tools).not.toContain("create_project");
      return datObserve(a);
    },
  },
  {
    name: "the prompt lists a tool iff its schema was sent, in each of the four states",
    async run(rec) {
      /* One scenario, not four: the suite runs the states in ONE test, so each later state's
         assistant restores the conversation the earlier ones left in the unscoped store. Splitting
         them would record four conversations the suite never has. */
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
      let a: Assistant | null = null;
      const seen: Record<string, unknown>[] = [];
      for (const [label, arrange, expected] of states) {
        resetWorkspaceWithTab();
        editorKind = "canvas";
        setWorkspaceProject(null);
        arrange();
        nextRounds = [[{ stopReason: "stop", type: "done" }]];
        a = createDocumentAssistant();
        await a.sendMessage("hi");
        const { prompt, tools } = lastCall(rec);
        const row = {
          deleteNodePrompted: prompt.includes("- delete_node(paths)"),
          deleteNodeSent: tools.includes("delete_node"),
          label,
          readDocumentSent: tools.includes("read_document"),
          setPropertyPrompted: prompt.includes("- set_property("),
          setPropertySent: tools.includes("set_property"),
        };
        expect(row).toEqual({
          deleteNodePrompted: expected.deleteNode,
          deleteNodeSent: expected.deleteNode,
          label,
          readDocumentSent: label !== "no document",
          setPropertyPrompted: expected.tree,
          setPropertySent: expected.tree,
        });
        seen.push(row);
      }
      return datObserve(a!, { states: seen });
    },
  },
  {
    name: "a delete_node round runs selection.delete through the registry as one undo step",
    async run() {
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
      expect(tab.history.index).toBe(1);
      // Filed under the request, the turn's last drawn message (specs/ai.md §3.2).
      const request = a.chatState.messages.find((m) => m.toolCalls?.length);
      const ledger = writesForTurn(request!.id);
      expect(ledger).toEqual([
        { disk: false, ok: true, path: "/project/index.json", tool: "Delete" },
      ]);
      return datObserve(a, { selection: jsonSafe(tab.session.selection) });
    },
  },
  {
    name: "a delete_node aimed at Project Settings is refused by the person's own gate",
    async run() {
      const tab = resetWorkspaceWithTab({ children: [{ tagName: "p" }], tagName: "div" });
      editorKind = "config";
      nextRounds = [
        toolCallRound("d1", "delete_node", { paths: [["children", 0]] }),
        [{ stopReason: "stop", type: "done" }],
      ];
      const a = createDocumentAssistant();
      await a.sendMessage("delete it");
      expect((tab.doc.document.children as unknown[]).length).toBe(1);
      const request = a.chatState.messages.find((m) => m.toolCalls?.length);
      expect(writesForTurn(request!.id)).toEqual([]);
      return datObserve(a, { dirty: tab.doc.dirty });
    },
  },
  {
    name: "create_project adopts the scaffold and re-keys the pre-project session",
    async run(rec) {
      closeAllTabs();
      setProjectAdopter(async (root: string) => {
        setWorkspaceProject(root, { name: "Fresh" });
      });
      nextRounds = [
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
      expect(getActiveSessionId(root)).toBe(a.activeSessionId());
      expect(rec.clientLog.calls[1]!.tools).toContain("list_files");
      return datObserve(a);
    },
  },
  {
    name: "a new assistant restores the last-active session's messages on construction",
    async run() {
      nextRounds = [
        [
          { content: "Earlier reply", type: "delta" },
          { stopReason: "stop", type: "done" },
        ],
      ];
      const first = createDocumentAssistant();
      await first.sendMessage("earlier question");
      const id = first.activeSessionId();
      const revived = createDocumentAssistant();
      expect(revived.activeSessionId()).toBe(id);
      expect(revived.chatState.messages.map((m) => m.content)).toEqual([
        "earlier question",
        "Earlier reply",
      ]);
      // The revived assistant is the one under test; the first one's transcript is in the calls.
      return datObserve(revived, { firstSession: id });
    },
  },
  {
    name: "import_site adopts the imported project and re-keys the pre-project session",
    async run() {
      installPlatform({
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
      expect(getActiveSessionId("/abs/imported-site")).toBe(a.activeSessionId());
      return datObserve(a);
    },
  },
  {
    name: "New Chat during a turn leaves the discarded conversation unpersisted",
    async run() {
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
      const sending = a.sendMessage("start something");
      a.newChat();
      await sending;
      expect(a.activeSessionId()).toBeNull();
      expect(a.chatState.messages).toHaveLength(0);
      expect(tab.doc.document.children).toHaveLength(1);
      return datObserve(a);
    },
  },
  {
    name: "a Stop while the chat URL is resolved streams nothing and changes nothing",
    async run() {
      let answer: (url: string) => void = () => {};
      installPlatform({
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
      expect(a.chatState.messages.map((m) => m.role)).toEqual(["user"]);
      return datObserve(a);
    },
  },
  {
    name: "create_project re-anchors the agent's undo batch onto the adopted tab",
    async run() {
      setWorkspaceProject(null);
      resetWorkspaceWithTab();
      setProjectAdopter(async (root: string) => {
        setWorkspaceProject(root, { name: "Fresh" });
      });
      nextRounds = [
        toolCallRound("c1", "create_project", {
          location: "/home/dev/Sites",
          name: "Batched Site",
        }),
        [
          { content: "Project ready", type: "delta" },
          { stopReason: "stop", type: "done" },
        ],
      ];
      const a = createDocumentAssistant();
      await a.sendMessage("bootstrap with a document open");
      expect(workspace.projectRoot).toBeTruthy();
      expect(a.chatState.status).toBe("idle");
      return datObserve(a);
    },
  },
  {
    name: "a project.json write syncs workspace + project config, and the inventory feeds the prompt",
    async run(rec) {
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
      const workspaceName = (workspace.projectConfig as { name?: string } | null)?.name;
      const storeName = (store.projectState?.projectConfig as { name?: string } | null)?.name;
      expect(workspaceName).toBe("New Name");
      expect(storeName).toBe("New Name");
      const filesSection = rec.clientLog.prompts[0]!.split("## Project Files")[1]!;
      expect(filesSection.split("\n\n---\n\n")[0]!.trim()).toBe("pages/index.json");
      return datObserve(a, { projectConfigName: { store: storeName, workspace: workspaceName } });
    },
  },
  {
    name: "a settings edit after the assistant's project.json write extends it, never reverts it",
    async run() {
      const state = installPlatform(
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
      (store.projectState!.projectConfig as { description?: string }).description = "from Settings";
      const commit = await commitProjectConfig();
      expect(commit.ok).toBe(true);
      expect(JSON.parse(state.files.get("project.json")!)).toEqual({
        description: "from Settings",
        name: "New Name",
      });
      return datObserve(a, { commit, projectJson: state.files.get("project.json") });
    },
  },
  {
    name: "a settings edit after the assistant's project.json write keeps the layout the assistant wrote",
    async run() {
      const before = { name: "Old Name", style: { "--a": "1" } };
      const state = installPlatform({}, { "project.json": JSON.stringify(before, null, 2) });
      setWorkspaceProject("/proj", before);
      resetStudioState({ dirs: new Map(), projectConfig: structuredClone(before) });
      const seeded = await commitProjectConfig();
      expect(seeded.ok).toBe(true);
      const written = '{\n  "name": "New Name",\n\n  "style": { "--a": "1", "--b": "2" }\n}\n';
      nextRounds = [
        toolCallRound("c1", "write_file", { content: written, path: "project.json" }),
        [{ stopReason: "stop", type: "done" }],
      ];
      const a = createDocumentAssistant();
      await a.sendMessage("rename the project and add a variable");
      expect(state.files.get("project.json")).toBe(written);
      (store.projectState!.projectConfig as { description?: string }).description = "from Settings";
      const commit = await commitProjectConfig();
      expect(commit.ok).toBe(true);
      expect(state.files.get("project.json")).toBe(
        written.replace('"2" }', '"2" },\n  "description": "from Settings"'),
      );
      return datObserve(a, { commit, projectJson: state.files.get("project.json"), seeded });
    },
  },
  {
    name: "write_file over the open clean tab reloads the document from disk",
    async run() {
      setWorkspaceProject("/proj");
      installPlatform();
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
      expect(tab.doc.document.tagName).toBe("section");
      expect(tab.doc.dirty).toBe(false);
      return datObserve(a, { dirty: tab.doc.dirty });
    },
  },
]);

// ─── recon: ai-loop-reconnect.test.ts ────────────────────────────────────────

let fetchImpl: () => Promise<Response> = async () => Response.json({ models: [] }, { status: 200 });
const fetchCalls: string[] = [];

/** A client whose single round is one error frame. */
function erroringClient(event: StreamEvent): StreamingClient {
  return {
    async *streamChat() {
      yield event;
    },
  };
}

/** The suite's `runWith`, recorded, with the probe's reading on both sides of the turn. */
async function reconRun(rec: Recording, event: StreamEvent): Promise<Observed> {
  const before = { configured: isProxyConfigured(), fetchCalls: [...fetchCalls] };
  const chatState = recordChatState(createChatState({ model: "@cf/meta/llama-4" }), rec.chatLog);
  chatState.sendMessage("make the heading bigger");
  await loop(rec, {
    chatState,
    client: erroringClient(event),
    toolRegistry: createToolRegistry() as ToolRegistry,
  });
  await flush();
  return {
    chat: chatState,
    extra: {
      after: {
        code: proxyStateCode() ?? null,
        configured: isProxyConfigured(),
        fetchCalls: [...fetchCalls],
      },
      before,
    },
  };
}

const RECON = inSuite("recon", [
  {
    name: "a cf_reconnect_required stream error re-probes, so the gates flip to Reconnect",
    async run(rec) {
      expect(isProxyConfigured()).toBe(true);
      fetchImpl = async () =>
        Response.json(
          { code: "cf_reconnect_required", configured: false, managed: true, models: [] },
          { status: 200 },
        );
      const seen = await reconRun(rec, {
        code: "cf_reconnect_required",
        message: "Reconnect Cloudflare to keep using the assistant.",
        type: "error",
      });
      expect(fetchCalls).toHaveLength(2);
      expect(isProxyConfigured()).toBe(false);
      expect(proxyStateCode()).toBe("cf_reconnect_required");
      expect(seen.chat.status).toBe("error");
      return seen;
    },
  },
  {
    name: "an ordinary failure leaves the reading alone",
    async run(rec) {
      const seen = await reconRun(rec, { code: "500", message: "upstream 500", type: "error" });
      expect(fetchCalls).toHaveLength(1);
      expect(isProxyConfigured()).toBe(true);
      return seen;
    },
  },
  {
    name: "an error frame carrying no code at all leaves the reading alone",
    async run(rec) {
      const seen = await reconRun(rec, { message: "Network error: offline", type: "error" });
      expect(fetchCalls).toHaveLength(1);
      expect(seen.chat.error).toBe("Network error: offline");
      return seen;
    },
  },
]);

// ─── The suites, in an order that keeps each one's world its own ─────────────

/* The loopt suite first: it needs no platform and no registry, as in its own file. dat resets the workspace
   before every test. recon last, because its probe settles module state (`ai-models`) that dat's
   `preferredModel()` would otherwise read. */

describe("loopt — ai-loop.test.ts", () => {
  registerScenarios(LOOPT);
});

describe("dat — document-assistant.test.ts, send path", () => {
  beforeEach(() => {
    installPlatform();
    resetWorkspaceWithTab();
    resetProjectConfigDocument();
    setWorkspaceProject(null);
    setProjectAdopter(async () => {});
    localStorage.clear();
    clearSeededSettings();
    nextRounds = [];
    createErrorMessage = null;
    lastClientOpts = null;
    editorKind = "canvas";
    installRegistryFixture();
    /* `format-host` caches the extension catalog for the module's life. Without a reset, a
       scenario that loads it leaves it loaded for the next, whose golden then records a catalog it
       never fetched and fails when run alone. */
    refreshFormats();
  });

  afterEach(() => {
    localStorage.clear();
    clearSeededSettings();
    setActiveRegistry(null);
  });

  registerScenarios(DAT);
});

describe("recon — ai-loop-reconnect.test.ts", () => {
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    installPlatform();
    (globalThis as Record<string, unknown>).fetch = (url: string) => {
      fetchCalls.push(url);
      return fetchImpl();
    };
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    resetModelCache();
  });

  beforeEach(async () => {
    localStorage.clear();
    clearSeededSettings();
    resetModelCache();
    fetchCalls.length = 0;
    // A managed backend that reported itself working, the way boot found it.
    fetchImpl = async () =>
      Response.json({ configured: true, managed: true, models: [] }, { status: 200 });
    ensureProxyProbe();
    await flush();
  });

  registerScenarios(RECON);
});

// ─── The corpus is not vacuous ───────────────────────────────────────────────

/** Every `ai-loop.test.ts` test this file mirrors. A scenario dropped from `LOOPT` fails below. */
const LOOPT_MIRRORED = [
  "executes a tool call and mutates the live document",
  "runs streamed tool calls even when the backend reports a plain stop",
  "a round the author stopped runs nothing it streamed",
  "a round that ends cancelled runs nothing, even before the signal reads aborted",
  "a Stop that lands between two calls stops the second",
  "records the provider's usage count on the chat state",
  "sends no empty assistant turn, and replays the reasoning it was given",
  "feeds schema errors back so the model can self-correct",
  "a run that hit the round cap AFTER applying changes is not an error (ai.md §3.2)",
  "surfaces an upstream stream error and stops",
  "summarizes accumulated tool errors (and ignores unknown events) at the round cap",
  "reports a tool call whose arguments are malformed JSON",
  "a turn that moves to a second document gives BOTH documents a history entry",
  "a round that only asked does not spend the work budget",
  "a round that asked AND worked spends the budget",
  "a model that only ever asks still terminates",
  "stopping the turn settles the question instead of hanging the loop",
  "a live chip shows the result the loop recorded, and an answered question its answer",
  "a Stop during the last call opens no further round",
  "a stream error removes its round's partial message, calls and all",
  "a stream error after a round of work keeps that round and removes only its own partial",
  "a turn whose model sends back nothing ends on an error row saying so",
  "an empty final round after work is a complete turn, not an error",
  "a stopped turn that drew nothing is not an error",
  "a turn that only read and ran out of rounds applied nothing, and says so as an error",
  "the round cap lists the calls that wrote, not the ones that read",
  "a capped turn that created a project lists the project as applied",
];

/** Every `ai-loop-reconnect.test.ts` test this file mirrors. */
const RECON_MIRRORED = [
  "a cf_reconnect_required stream error re-probes, so the gates flip to Reconnect",
  "an ordinary failure leaves the reading alone",
  "an error frame carrying no code at all leaves the reading alone",
];

/** The `document-assistant.test.ts` tests that never send, so have no loop to trace. */
const DAT_NOT_SEND_PATH = [
  "restores the last-active session on creation",
  "ignores corrupt or empty persisted history",
];

/** The test names a suite file declares, in order. */
function testNames(file: string): string[] {
  const source = readFileSync(resolve(import.meta.dir, file), "utf8");
  return [...source.matchAll(/\btest\(\s*"((?:[^"\\]|\\.)*)"/g)].map(
    (match) => JSON.parse(`"${match[1]}"`) as string,
  );
}

describe("the agent-trace corpus", () => {
  test("mirrors every loop test, and every mirrored test has a golden", () => {
    const all = [...LOOPT, ...DAT, ...RECON];
    const missingGoldens = all
      .map((scenario) => goldenFile(scenario))
      .filter((file) => !existsSync(resolve(FIXTURES, file)));
    expect(missingGoldens).toEqual([]);

    // Each mirrored name has its scenario, so its golden (checked above) — one per LOOPT test.
    for (const [mirrored, scenarios] of [
      [LOOPT_MIRRORED, LOOPT],
      [RECON_MIRRORED, RECON],
    ] as const) {
      const names = new Set(scenarios.map((scenario) => scenario.name));
      expect(mirrored.filter((name) => !names.has(name))).toEqual([]);
    }
    expect(LOOPT.map((scenario) => scenario.name)).toEqual(LOOPT_MIRRORED);

    // And the lists are the suites, not a memory of them: a test added to, renamed in or dropped
    // From a mirrored file fails here until this file mirrors it (or says why it does not).
    expect(testNames("ai-loop.test.ts")).toEqual(LOOPT_MIRRORED);
    expect(testNames("ai-loop-reconnect.test.ts")).toEqual(RECON_MIRRORED);
    expect(testNames("document-assistant.test.ts").toSorted()).toEqual(
      [...DAT.map((scenario) => scenario.name), ...DAT_NOT_SEND_PATH].toSorted(),
    );

    // No two scenarios share a golden, and no golden outlives its scenario.
    const files = all.map((scenario) => goldenFile(scenario));
    expect(new Set(files).size).toBe(files.length);
    const onDisk = readdirSync(FIXTURES).filter((file) => file.endsWith(".json"));
    expect(onDisk.toSorted()).toEqual(files.toSorted());
  });
});
