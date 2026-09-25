/**
 * The v1 assistant-session corpus: what today's loader makes of every persisted shape (J1.2).
 *
 * Each file under `fixtures/ai-sessions/` is a localStorage snapshot (`storage`, keyed exactly as
 * `services/ai-session-store.ts` keys it) plus the project root it is read under. The test seeds
 * the snapshot, constructs a real `createDocumentAssistant()` (whose `restoreChat` is the loader),
 * and holds what it observes to the fixture's `expected` golden:
 *
 * - `assistantSessionId` / `storeActiveId`: the session the live chat is bound to, and the one the
 *   index names (they differ when the active payload is missing, empty or corrupt);
 * - `sessions`: the index as `listSessions` returns it;
 * - `restored`: the chat-state messages the restore pushed, tool-call records and all;
 * - `wire`: `toMessagesArray()` of the restored transcript, i.e. what the next send would carry;
 * - `repair` (and `repairedWire` when it changed anything): what the send path's
 *   `pruneOrphanToolMessages` does to the restored transcript before that send;
 * - `storage`: the snapshot after the load, or `"unchanged"` when the load wrote nothing.
 *
 * `saved-by-current-build.json` is different in one way: its `storage` is ALSO a golden, written by
 * driving a real conversation through the current build (tools, `ask_user`, Stop mid-round, the
 * seal on the next send). That test additionally proves the round trip: a fresh assistant over the
 * saved storage holds the same transcript the live one persisted.
 *
 * Nondeterminism is normalized, never tolerated: the clock is frozen, and session ids
 * (`s_<time>_<rand>`), chat-state ids (`msg_<time>_<n>`) and restore-synthesized ids
 * (`restored_<time>_<rand>`) become `s_T_<k>` / `msg_T_<k>` / `restored_T_<k>` by order of first
 * appearance.
 *
 * Regenerate (from packages/studio): `JX_UPDATE_GOLDENS=1 bun test --isolate
 * tests/ai-session-corpus.test.ts`, then review the diff. Only `expected` (and the round-trip
 * fixture's `storage`) is rewritten.
 */
import { clearSeededSettings, installMockPlatform, resetWorkspaceWithTab } from "./harness";
import { createChatState, createToolRegistry } from "@jxsuite/ai";
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";
import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── A scripted provider (the only thing not real) ───────────────────────────

let nextRounds: StreamEvent[][] = [];
/** Every request the assistant sent, as the wire it carried. */
let sentRequests: unknown[][] = [];
/** The frozen clock, advanced by one step per request and per turn. */
let clock = 0;

function tick() {
  clock += STEP_MS;
  setSystemTime(new Date(clock));
}

function fakeClient(rounds: StreamEvent[][]): StreamingClient {
  let call = 0;
  return {
    async *streamChat(messages: unknown) {
      sentRequests.push(plain(messages) as unknown[]);
      const events = rounds[call] ?? [{ stopReason: "stop", type: "done" }];
      call += 1;
      tick();
      for (const event of events) {
        yield event;
      }
    },
  } as unknown as StreamingClient;
}

void mock.module("@jxsuite/ai", () => ({
  createChatState,
  createProxyStreamingClient: () => fakeClient(nextRounds),
  createToolRegistry,
}));

const { createDocumentAssistant } = await import("../src/services/document-assistant");
const { pruneOrphanToolMessages } = await import("../src/services/context-manager");
const { answerAsk, isAwaitingAnswer, resetAsk } = await import("../src/services/ai-ask");
const { getActiveSessionId } = await import("../src/services/ai-session-store");
const { backfillToolResults } = await import("../src/services/tool-outcomes");
const { projectChip } = await import("../src/panels/ai-chat/chat-view");
const { setProjectAdopter } = await import("../src/services/project-adoption");
const { setWorkspaceProject } = await import("../src/workspace/workspace");
const { resetProjectConfigDocument } = await import("../src/tabs/project-config");

// ─── Constants ───────────────────────────────────────────────────────────────

const DIR = join(import.meta.dir, "fixtures", "ai-sessions");
const ROUND_TRIP = "saved-by-current-build.json";
const ROUND_TRIP_ROOT = "/proj/round-trip";
/** The @jxsuite/ai corpus's sealed transcript, re-derived here from the real repair. */
const AI_SEALED = join(
  import.meta.dir,
  "..",
  "..",
  "ai",
  "tests",
  "fixtures",
  "v1",
  "transcripts",
  "sealed-orphan.json",
);
const UPDATE = process.env.JX_UPDATE_GOLDENS === "1";
const REGENERATE = "JX_UPDATE_GOLDENS=1 bun test --isolate tests/ai-session-corpus.test.ts";
/** 2026-01-01T00:00:00Z. */
const BASE_TIME = Date.UTC(2026, 0, 1);
const STEP_MS = 1000;
const STORE_PREFIX = "jx-ai-chat";

type JsonObject = Record<string, unknown>;

interface SessionFixture {
  name: string;
  description: string;
  /** `workspace.projectRoot` while loading; "" is the unscoped store (no project open). */
  root: string;
  /** Key to value. `{ "$raw": text }` seeds text verbatim (a corrupt entry); anything else is JSON. */
  storage: JsonObject;
  expected?: JsonObject;
}

interface LoadedFixture {
  file: string;
  path: string;
}

// ─── Golden plumbing ─────────────────────────────────────────────────────────

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON-only copy: reactive proxies unwrapped, `undefined` members dropped as storage drops them. */
function plain(value: unknown): unknown {
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- JSON normalization is the point
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function show(value: unknown): string {
  const text = value === undefined ? "undefined" : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/** The first path at which `actual` departs from `expected`, or null when they are equal. */
function firstDifference(expected: unknown, actual: unknown, path = "$"): string | null {
  if (Object.is(expected, actual)) {
    return null;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let i = 0; i < length; i++) {
      if (i >= expected.length) {
        return `${path}[${i}]: not in the golden, got ${show(actual[i])}`;
      }
      if (i >= actual.length) {
        return `${path}[${i}]: missing, the golden has ${show(expected[i])}`;
      }
      const found = firstDifference(expected[i], actual[i], `${path}[${i}]`);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (isObject(expected) && isObject(actual)) {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      if (!(key in actual)) {
        return `${path}.${key}: missing, the golden has ${show(expected[key])}`;
      }
      if (!(key in expected)) {
        return `${path}.${key}: not in the golden, got ${show(actual[key])}`;
      }
      const found = firstDifference(expected[key], actual[key], `${path}.${key}`);
      if (found) {
        return found;
      }
    }
    return null;
  }
  return `${path}: the golden has ${show(expected)}, got ${show(actual)}`;
}

function assertGolden(file: string, field: string, expected: unknown, actual: unknown) {
  const difference = firstDifference(expected, actual, `$.${field}`);
  if (difference) {
    throw new Error(
      `${file}: "${field}" no longer matches its golden.\n` +
        `  first difference at ${difference}\n` +
        `  If the change is intended, run \`${REGENERATE}\` from packages/studio and review the diff.`,
    );
  }
}

const WIDTH = 100;

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

/**
 * The one-line form of a value, or null when it must break. Mirrors how oxfmt lays JSON out, so a
 * regenerated golden is already formatted: an array of two or more multi-key objects always
 * breaks.
 */
function inlineForm(value: unknown): string | null {
  if (isPrimitive(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const multiKey = (v: unknown) =>
      (Array.isArray(v) && v.length > 1) || (isObject(v) && Object.keys(v).length > 1);
    if (value.length > 1 && value.every((v) => multiKey(v))) {
      return null;
    }
    const parts = value.map((v) => inlineForm(v));
    return parts.every((p) => p !== null) ? `[${parts.join(", ")}]` : null;
  }
  const entries = Object.entries(value as JsonObject);
  if (entries.length === 0) {
    return "{}";
  }
  const parts = entries.map(([k, v]) => {
    const inner = inlineForm(v);
    return inner === null ? null : `${JSON.stringify(k)}: ${inner}`;
  });
  return parts.every((p) => p !== null) ? `{ ${parts.join(", ")} }` : null;
}

function layout(value: unknown, level: number, prefix: number, suffix: number): string {
  const inline = inlineForm(value);
  if (inline !== null && level * 2 + prefix + inline.length + suffix <= WIDTH) {
    return inline;
  }
  if (isPrimitive(value)) {
    return JSON.stringify(value);
  }
  const pad = "  ".repeat(level + 1);
  const close = "  ".repeat(level);
  if (Array.isArray(value)) {
    const items = value.map((v, i) => pad + layout(v, level + 1, 0, i < value.length - 1 ? 1 : 0));
    return `[\n${items.join(",\n")}\n${close}]`;
  }
  const entries = Object.entries(value as JsonObject);
  const items = entries.map(([k, v], i) => {
    const key = `${JSON.stringify(k)}: `;
    return pad + key + layout(v, level + 1, key.length, i < entries.length - 1 ? 1 : 0);
  });
  return `{\n${items.join(",\n")}\n${close}}`;
}

function readFixture(fixture: LoadedFixture): SessionFixture {
  return JSON.parse(readFileSync(fixture.path, "utf8")) as SessionFixture;
}

/** Rewrite a fixture, only when its content actually changed. */
function writeFixture(fixture: LoadedFixture, data: SessionFixture) {
  if (firstDifference(readFixture(fixture), data) === null) {
    return;
  }
  writeFileSync(fixture.path, `${layout(data, 0, 0, 0)}\n`);
}

// ─── Normalization ───────────────────────────────────────────────────────────

const ID_PATTERNS: [RegExp, string][] = [
  [/^s_\d+_[0-9a-z]+$/, "s_T_"],
  [/^msg_\d+_\d+$/, "msg_T_"],
  [/^restored_\d+_[0-9a-z]+$/, "restored_T_"],
];

/**
 * Rewrite every generated id to a stable placeholder, numbered by order of first appearance. A
 * string is checked whole and by its last `:` segment, because a payload key ends with its session
 * id, and a key is normalized wherever it appears (object key or snapshot tuple).
 */
function normalize(value: unknown): unknown {
  const seen = new Map<string, Map<string, string>>();
  const id = (text: string) => {
    for (const [pattern, prefix] of ID_PATTERNS) {
      if (pattern.test(text)) {
        const map = seen.get(prefix) ?? new Map<string, string>();
        seen.set(prefix, map);
        if (!map.has(text)) {
          map.set(text, `${prefix}${map.size + 1}`);
        }
        return map.get(text)!;
      }
    }
    return text;
  };
  const key = (text: string) =>
    text.replace(/(^|:)([^:]+)$/, (_all, sep: string, last: string) => `${sep}${id(last)}`);
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") {
      return key(v);
    }
    if (Array.isArray(v)) {
      return v.map((item) => visit(item));
    }
    if (isObject(v)) {
      return Object.fromEntries(Object.entries(v).map(([k, item]) => [key(k), visit(item)]));
    }
    return v;
  };
  return visit(value);
}

// ─── Storage ─────────────────────────────────────────────────────────────────

function isRaw(value: unknown): value is { $raw: string } {
  return isObject(value) && typeof value.$raw === "string" && Object.keys(value).length === 1;
}

function seed(storage: JsonObject) {
  for (const [key, value] of Object.entries(storage)) {
    localStorage.setItem(key, isRaw(value) ? value.$raw : JSON.stringify(value));
  }
}

/** The session store's keys, in insertion order, each value parsed (or kept raw when corrupt). */
function snapshot(): [string, unknown][] {
  const entries: [string, unknown][] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(STORE_PREFIX)) {
      continue;
    }
    const text = localStorage.getItem(key) ?? "";
    try {
      entries.push([key, JSON.parse(text) as unknown]);
    } catch {
      entries.push([key, { $raw: text }]);
    }
  }
  return entries;
}

const sortedObject = (entries: [string, unknown][]) =>
  Object.fromEntries(entries.toSorted(([a], [b]) => a.localeCompare(b)));

// ─── The loader, observed ────────────────────────────────────────────────────

/** Seed a snapshot, let today's loader read it, and report everything it did. */
function observeRestore(data: SessionFixture): JsonObject {
  localStorage.clear();
  seed(data.storage);
  setWorkspaceProject(data.root || null);
  const assistant = createDocumentAssistant();
  const { chatState } = assistant;

  const observed: JsonObject = {
    assistantSessionId: assistant.activeSessionId(),
    storeActiveId: getActiveSessionId(data.root),
    sessions: plain(assistant.listSessions()),
    restored: plain(chatState.messages),
    wire: plain(chatState.toMessagesArray()),
  };
  const after = snapshot();
  const repair = pruneOrphanToolMessages(chatState);
  observed.repair = { dropped: repair.dropped, sealed: repair.sealed };
  if (repair.dropped + repair.sealed > 0) {
    observed.repairedWire = plain(chatState.toMessagesArray());
  }
  observed.storage = after;

  const normalized = normalize(observed) as JsonObject;
  const afterStorage = sortedObject(normalized.storage as [string, unknown][]);
  const seededEntries = Object.entries(data.storage);
  const seeded = normalize(sortedObject(seededEntries));
  const unchanged = firstDifference(seeded, afterStorage);
  normalized.storage = unchanged === null ? "unchanged" : afterStorage;
  return normalized;
}

// ─── The round trip ──────────────────────────────────────────────────────────

/** One tool call's events, as a provider streams them. */
function callEvents(id: string, name: string, args: object): StreamEvent[] {
  return [
    { id, name, type: "tool_call_start" },
    { args: JSON.stringify(args), id, type: "tool_call_delta" },
    { id, type: "tool_call_end" },
  ];
}

async function untilAsking() {
  for (let i = 0; i < 500 && !isAwaitingAnswer(); i++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  expect(isAwaitingAnswer()).toBe(true);
}

/**
 * Four turns through the real assistant: a tool that edits the document (with reasoning and a usage
 * count), an `ask_user` the author answers, a round Stop interrupts while `ask_user` waits (so the
 * round's second call never runs), and a send that repairs that unanswered call before it goes
 * out.
 */
async function driveConversation() {
  resetWorkspaceWithTab({ children: [{ tagName: "p", textContent: "Hello" }], tagName: "div" });
  setWorkspaceProject(ROUND_TRIP_ROOT);
  const assistant = createDocumentAssistant();

  tick();
  nextRounds = [
    [
      { content: "The page has no heading yet.", type: "reasoning" },
      { content: "I'll add a heading.", type: "delta" },
      ...callEvents("call_head", "add_child", {
        index: 0,
        node: { tagName: "h1", textContent: "Welcome" },
        parentPath: [],
      }),
      { inputTokens: 1800, outputTokens: 60, type: "usage" },
      { stopReason: "tool_calls", type: "done" },
    ],
    [
      { content: "Added a Welcome heading.", type: "delta" },
      { inputTokens: 1900, outputTokens: 12, type: "usage" },
      { stopReason: "stop", type: "done" },
    ],
  ];
  await assistant.sendMessage("Add a heading to the page");

  tick();
  nextRounds = [
    [
      ...callEvents("call_layout", "ask_user", {
        options: ["One column", "Two columns"],
        question: "Which layout should the page use?",
      }),
      { stopReason: "tool_calls", type: "done" },
    ],
    [
      { content: "Two columns it is.", type: "delta" },
      { stopReason: "stop", type: "done" },
    ],
  ];
  const answering = assistant.sendMessage("Ask me which layout to use");
  await untilAsking();
  answerAsk("Two columns");
  await answering;

  tick();
  nextRounds = [
    [
      ...callEvents("call_footer", "ask_user", { question: "Dark or light footer?" }),
      ...callEvents("call_link", "add_child", {
        node: { tagName: "a", textContent: "Contact" },
        parentPath: [],
      }),
      { stopReason: "tool_calls", type: "done" },
    ],
  ];
  const stopping = assistant.sendMessage("Style the footer, then add a contact link");
  await untilAsking();
  assistant.stop();
  await stopping;

  tick();
  nextRounds = [
    [
      { content: "Picking up where we left off.", type: "delta" },
      { stopReason: "stop", type: "done" },
    ],
  ];
  await assistant.sendMessage("Carry on");
  return assistant;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  installMockPlatform();
  resetWorkspaceWithTab();
  resetProjectConfigDocument();
  setWorkspaceProject(null);
  setProjectAdopter(async () => {});
  localStorage.clear();
  clearSeededSettings();
  nextRounds = [];
  sentRequests = [];
  clock = BASE_TIME;
  setSystemTime(new Date(clock));
});

afterEach(() => {
  resetAsk();
  localStorage.clear();
  clearSeededSettings();
  setWorkspaceProject(null);
  setSystemTime();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

const corpus: LoadedFixture[] = readdirSync(DIR)
  .filter((file) => file.endsWith(".json"))
  .toSorted()
  .map((file) => ({ file, path: join(DIR, file) }));

describe("a payload the current build saves", () => {
  test("is the frozen snapshot, and a fresh assistant restores the transcript it persisted", async () => {
    const fixture = corpus.find((f) => f.file === ROUND_TRIP)!;
    expect(fixture).toBeDefined();
    const live = await driveConversation();
    const saved = sortedObject(normalize(snapshot()) as [string, unknown][]);

    const data = readFixture(fixture);
    if (UPDATE) {
      data.storage = saved;
      writeFixture(fixture, data);
    }
    assertGolden(ROUND_TRIP, "storage", data.storage, saved);

    // The send path sealed the call Stop left unanswered, directly after the message requesting it.
    const lastRequest = sentRequests.at(-1) as { role: string; tool_call_id?: string }[];
    const requester = lastRequest.findIndex((e) => JSON.stringify(e).includes('"call_link"'));
    expect(lastRequest[requester + 1]).toMatchObject({ role: "tool", tool_call_id: "call_link" });

    /* What the live chat persisted is what a reload restores, with two differences allowed:
       persistChat's filter (it skips an assistant turn with neither text nor tool calls), and each
       tool call's outcome, which a restore backfills from the tool message that answered it
       (services/tool-outcomes.ts). The live loop attached the same outcome as each call finished,
       so a stored result the backfill replaces is the one it would have written. */
    const persisted = live.chatState.messages.filter(
      (m) => m.role !== "assistant" || m.content || (m.toolCalls?.length ?? 0) > 0,
    );
    const revived = createDocumentAssistant();
    expect(revived.activeSessionId()).toBe(live.activeSessionId());
    const expectedRestore = plain(backfillToolResults(persisted));
    expect(firstDifference(expectedRestore, plain(revived.chatState.messages))).toBeNull();
    const revivedCalls = revived.chatState.messages.flatMap((m) => m.toolCalls ?? []);
    expect(revivedCalls.every((tc) => tc.result)).toBe(true);
    const liveWire = plain(live.chatState.toMessagesArray());
    const revivedWire = plain(revived.chatState.toMessagesArray());
    expect(firstDifference(liveWire, revivedWire)).toBeNull();
    // The provider's count is not persisted; a restored chat budgets from the estimate again.
    expect(live.chatState.usage).not.toBeNull();
    expect(revived.chatState.usage).toBeNull();
  });
});

describe("a reload while a question is open", () => {
  /* A turn suspended on the author may wait as long as they like, and the conversation is
     otherwise saved only when a turn starts and ends. The question is saved as it is put, so a
     reload in the meantime finds it and restores it inert, rather than losing the unfinished turn
     (specs/ai.md §3.4). */
  test("restores the question, and the round before it, with the question inert", async () => {
    resetWorkspaceWithTab({ children: [{ tagName: "p", textContent: "Hello" }], tagName: "div" });
    setWorkspaceProject(ROUND_TRIP_ROOT);
    const assistant = createDocumentAssistant();
    tick();
    nextRounds = [
      [
        ...callEvents("call_rule", "add_child", {
          index: 1,
          node: { tagName: "hr" },
          parentPath: [],
        }),
        { stopReason: "tool_calls", type: "done" },
      ],
      [
        ...callEvents("call_open", "ask_user", { question: "Dark or light footer?" }),
        { stopReason: "tool_calls", type: "done" },
      ],
    ];
    const sending = assistant.sendMessage("Style the footer");
    await untilAsking();

    // The page goes away with the question open: its promise is gone, its transcript is not.
    const revived = createDocumentAssistant();
    const calls = revived.chatState.messages.flatMap((m) => m.toolCalls ?? []);
    expect(calls.map((c) => c.name)).toEqual(["add_child", "ask_user"]);
    const [done, open] = calls;
    expect(projectChip(done!).outcome).toBe("ok");
    expect(open!.result).toBeNull();
    expect(projectChip(open!).askState).toBe("unanswered");

    resetAsk();
    await sending;
  });
});

describe("today's loader reads each persisted shape exactly as frozen", () => {
  for (const fixture of corpus) {
    test(fixture.file, () => {
      const data = readFixture(fixture);
      expect(`${data.name}.json`).toBe(fixture.file);
      expect(data.description.trim().length).toBeGreaterThan(0);
      const observed = observeRestore(data);
      if (UPDATE) {
        data.expected = observed;
        writeFixture(fixture, data);
      }
      assertGolden(fixture.file, "expected", data.expected, observed);
    });
  }
});

describe("the @jxsuite/ai transcript corpus agrees with Studio's repair", () => {
  test("sealed-orphan.json is what pruneOrphanToolMessages writes for its unanswered call", () => {
    const transcript = JSON.parse(readFileSync(AI_SEALED, "utf8")) as { messages: JsonObject[] };
    const chat = createChatState();
    for (const msg of structuredClone(transcript.messages)) {
      if (!String(msg.id).startsWith("sealed_")) {
        chat.messages.push(msg as unknown as (typeof chat.messages)[number]);
      }
    }
    expect(pruneOrphanToolMessages(chat)).toEqual({ dropped: 0, sealed: 1 });
    expect(firstDifference(transcript.messages, plain(chat.messages))).toBeNull();
  });
});
