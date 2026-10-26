/**
 * Trace-recorder.ts — what one agent turn DID, recorded as data a golden file can pin.
 *
 * Three instruments, each a forwarding layer over the real object rather than a double of it, so a
 * trace describes the code that ships and not a model of it:
 *
 * 1. {@link recordChatState} — a Proxy over a `createChatState()` store that logs every METHOD call
 *    (and every top-level property write) in order, then forwards it untouched.
 * 2. {@link spyStreamingClient} — wraps any `StreamingClient` and records, per `streamChat` call, the
 *    wire messages it was handed, the tool names advertised in order, and a digest of the system
 *    prompt (length, short hash, headings: a changed hash says THAT it moved, the headings say
 *    where).
 * 3. {@link installAiWritesSpy} — re-registers `src/services/ai-writes.ts` through `mock.module()` as
 *    wrappers around its own real functions, so the ledger keeps working and every `beginTurn` /
 *    `recordWrite` / `endTurn` is also written down.
 *
 * Nothing here normalises at record time except the snapshot itself ({@link jsonSafe}): ids are
 * numbered by {@link buildTrace} over the WHOLE trace at once, because a message id's placeholder
 * is its creation order within the trace, and that is only knowable once the trace is complete.
 *
 * Import rule: this file must not import anything under `src/` at module level. The test that uses
 * it has to install the ai-writes spy BEFORE the agent loop is first imported, and a static import
 * here would be hoisted ahead of that.
 */

import { mock } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import {
  isBigInt,
  isBoolean,
  isFunction,
  isJsonObject,
  isNonNullObject,
  isNumber,
  isString,
} from "@jxsuite/schema/guards";
import type { ChatStore, ChatUsage } from "@jxsuite/ai/chat-state";
import type { LiveMessage, OpenAIMessage } from "@jxsuite/ai/messages";
import type {
  ProxyStreamingClientOptions,
  StreamEvent,
  StreamingClient,
} from "@jxsuite/ai/streaming-client";
import type { AiWrite, ToolResult } from "@jxsuite/ai/tools";
import type { JsonObject, JsonPrimitive, JsonValue, JxMutableNode } from "@jxsuite/schema/types";
/* Type-only, so they are erased: see the import rule above. */
import type { PendingAskView } from "./ask";
import type * as AiWritesExports from "../../src/services/ai-writes";
import type { ProjectConfigCommit } from "../../src/tabs/project-config";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const AI_WRITES = resolve(import.meta.dir, "../../src/services/ai-writes.ts");

// ─── Snapshots ────────────────────────────────────────────────────────────────

/**
 * What a trace snapshots, named by owner. JSON-shaped data and the literals the recorder builds
 * around it are spelled structurally; the records the recorder and its scenarios capture are named
 * by the module that owns them. The ledger, the store and the scenarios also hand over values the
 * static types cannot describe (a proxied store's method arguments, a reactive document read
 * through its proxy), and {@link jsonSafe} classifies every value at run time regardless.
 */
export type TraceSubject =
  | JsonPrimitive
  | undefined
  | readonly TraceSubject[]
  | TraceRecord
  | OpenAIMessage
  | AiWrite
  | ToolResult
  | ChatUsage
  | ChatCall
  | ClientCall
  | JxMutableNode
  | PendingAskView
  | ProxyStreamingClientOptions
  | ProjectConfigCommit;

/** An object literal of trace subjects, keyed by name. */
export interface TraceRecord {
  [key: string]: TraceSubject;
}

/** An object the serializer is inside: the value it came from, and what it was handed instead. */
interface OpenObject {
  source: object;
  standIn: readonly TraceSubject[] | TraceRecord;
}

/**
 * A JSON-safe deep copy, taken NOW. Reactive proxies are read through (their own `ownKeys`),
 * `undefined` and functions are dropped the way `JSON.stringify` drops them, Maps and Sets become
 * objects and arrays, and a cycle is marked rather than followed.
 *
 * The platform serializer does the walking. Its replacer sees one property at a time with its
 * holder as `this`, reads the property itself, and hands back a JSON value or a plain stand-in for
 * the serializer to descend into: what a `toJSON` method returns is never used, a boxed primitive
 * is copied like any other object, and the serializer never reaches a cycle to throw on. The text
 * is then parsed back and decoded through {@link isJsonValue}.
 */
export function jsonSafe(value: TraceSubject): JsonValue {
  /* The objects being written, outermost first. A property arrives with the stand-in that holds
     it as `this`, so everything opened after that stand-in is a finished sibling subtree. */
  const open: OpenObject[] = [];
  // Wrapped in an array so a top-level undefined is written as null, as it is inside any array.
  const text = JSON.stringify([value], function snapshot(key) {
    while (open.length > 0 && open.at(-1)?.standIn !== this) {
      open.pop();
    }
    /* Read the property itself, not the replacer's second argument: by then the serializer has
       already swapped in whatever the value's `toJSON` returned. */
    const source: unknown = this[key];
    if (source === null || isString(source) || isBoolean(source)) {
      return source;
    }
    if (isNumber(source)) {
      return Number.isFinite(source) ? source : String(source);
    }
    if (isBigInt(source)) {
      return `${source}n`;
    }
    // What is left is undefined, a function, a symbol, or an object; JSON keeps only the object.
    if (!isNonNullObject(source)) {
      return;
    }
    if (open.some((entry) => entry.source === source)) {
      return "<cycle>";
    }
    let standIn: OpenObject["standIn"];
    if (Array.isArray(source)) {
      standIn = [...source];
    } else if (source instanceof Map) {
      standIn = Object.fromEntries(source);
    } else if (source instanceof Set) {
      standIn = [...source];
    } else if (source instanceof Error) {
      standIn = { error: source.message };
    } else if (typeof AbortSignal !== "undefined" && source instanceof AbortSignal) {
      standIn = { aborted: source.aborted };
    } else {
      // Assigned name by name, as the hand-written walk this replaced built its copy.
      const copy: TraceRecord = {};
      for (const [name, item] of Object.entries(source)) {
        copy[name] = item;
      }
      standIn = copy;
    }
    open.push({ source, standIn });
    return standIn;
  });
  const parsed: unknown = JSON.parse(text);
  if (!isJsonValue(parsed) || !Array.isArray(parsed)) {
    throw new Error("A snapshot is written as a one-item JSON array");
  }
  return parsed[0] ?? null;
}

/**
 * True for what `JSON.parse` can produce: null, booleans, finite numbers, strings, and nests of
 * them.
 */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || isString(value) || isBoolean(value)) {
    return true;
  }
  if (isNumber(value)) {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  return isJsonObject(value) && Object.values(value).every((item) => isJsonValue(item));
}

/** Machine-specific absolute paths, replaced by stable placeholders. Longest first. */
export function normalizePaths(text: string): string {
  let out = text;
  for (const [path, placeholder] of [
    [REPO_ROOT, "<repo>"],
    [tmpdir(), "<tmp>"],
    [homedir(), "<home>"],
  ] as const) {
    if (path.length > 1) {
      out = out.split(path).join(placeholder);
    }
  }
  return out;
}

// ─── 1. The chat store ────────────────────────────────────────────────────────

/** One call on a recorded chat store: which store (1-based, per log), what, and with what. */
export interface ChatCall {
  chat: number;
  /** The method name, or `set <prop>` for a top-level property write. */
  method: string;
  args: JsonValue[];
}

/** Where recorded stores write. Several stores may share one log; each gets its own number. */
export interface ChatCallLog {
  calls: ChatCall[];
  chats: number;
}

export function createChatCallLog(): ChatCallLog {
  return { calls: [], chats: 0 };
}

const chatLogs = new WeakMap<object, ChatCallLog>();

/**
 * Wrap a chat store so every method call on it is logged, in order, then forwarded to the real
 * store with the real store as `this`.
 *
 * Only calls made THROUGH the proxy are seen, which is the point: `sendMessage` calling
 * `beginAssistantTurn` inside the store is the store's business, while the loop calling it is the
 * loop's behaviour. Property reads are not logged; property writes are (`set status`), because a
 * direct write is the only other way a caller can change the store.
 *
 * @param chatState - The store `createChatState()` returned
 * @param log - Shared log; a fresh one when omitted (read it back with {@link chatCallsOf})
 */
export function recordChatState<T extends object>(
  chatState: T,
  log: ChatCallLog = createChatCallLog(),
): T {
  log.chats += 1;
  const chat = log.chats;
  type Method = (...args: never[]) => void;
  const wrappers = new Map<string, { real: Method; wrapper: Method }>();
  const proxy = new Proxy(chatState, {
    get(target, key) {
      /* SAFETY: `key` is the property this very read asked the proxy for, so indexing `target` by
         it is the same [[Get]] (receiver `target`) Reflect.get would perform; a key `target` lacks
         reads undefined either way, which the type of `value` admits. */
      const value: unknown = target[key as keyof T];
      if (!isString(key) || !isFunction(value)) {
        return value;
      }
      const cached = wrappers.get(key);
      if (cached?.real === value) {
        return cached.wrapper;
      }
      // The wrapper takes what the real method takes, and hands back whatever it returned.
      const wrapper = (...args: never[]) => {
        log.calls.push({ args: args.map((arg) => jsonSafe(arg)), chat, method: key });
        return value.apply(target, args);
      };
      wrappers.set(key, { real: value, wrapper });
      return wrapper;
    },
    set(target, key, value) {
      if (isString(key)) {
        log.calls.push({ args: [jsonSafe(value)], chat, method: `set ${key}` });
      }
      return Reflect.set(target, key, value);
    },
  });
  chatLogs.set(proxy, log);
  return proxy;
}

/** The log a recorded store writes to, or undefined for a store that was never recorded. */
export function chatCallsOf(chatState: ChatStore): ChatCall[] | undefined {
  return chatLogs.get(chatState)?.calls;
}

// ─── 2. The streaming client ──────────────────────────────────────────────────

/** What a system prompt looked like, without committing the prompt itself. */
export interface PromptDigest {
  length: number;
  /** The first 12 hex characters of the SHA-256 of the path-normalised prompt. */
  hash: string;
  /** Every Markdown heading line, in order — where to look when the hash moves. */
  headings: string[];
}

export function digestPrompt(prompt: string): PromptDigest {
  const text = normalizePaths(prompt);
  return {
    hash: createHash("sha256").update(text).digest("hex").slice(0, 12),
    headings: text.split("\n").filter((line) => /^#{1,4} /.test(line)),
    length: text.length,
  };
}

/** One `streamChat` call as the client saw it. */
export interface ClientCall {
  /** Which spied client (1-based, per log) took the call. */
  client: number;
  messages: JsonValue[];
  tools: string[];
  systemPrompt: PromptDigest;
  /** The abort signal's state when the call began. */
  signal: "none" | "live" | "aborted";
}

export interface ClientCallLog {
  calls: ClientCall[];
  clients: number;
  /**
   * The raw system prompt of each call, index-aligned with `calls`. Kept for a test's own
   * assertions ("the prompt says X"); never part of a trace, which carries only the digest.
   */
  prompts: string[];
}

export function createClientCallLog(): ClientCallLog {
  return { calls: [], clients: 0, prompts: [] };
}

/*
 * What a `streamChat` call actually received. The client's declared signature promises all four
 * arguments, but scenarios do call it without them — the "only ever asks" golden records a call
 * with no signal — so these readers take the argument as it may really arrive.
 */

/** The system prompt as text; a missing one is the empty prompt. */
function receivedPrompt(systemPrompt: string | null | undefined): string {
  return String(systemPrompt ?? "");
}

/** The abort signal's state when the call began. */
function receivedSignal(signal: AbortSignal | null | undefined): ClientCall["signal"] {
  if (signal === null || signal === undefined) {
    return "none";
  }
  return signal.aborted ? "aborted" : "live";
}

/** The advertised tool names, in order, read off OpenAI function-calling definitions. */
function receivedToolNames(tools: readonly object[] | null | undefined): string[] {
  return (tools ?? []).map((tool) => {
    const fn = "function" in tool ? tool.function : undefined;
    const name = isNonNullObject(fn) && "name" in fn ? fn.name : undefined;
    return isString(name) ? name : "<unnamed>";
  });
}

/**
 * True for one message on the OpenAI chat-completions wire, which every round is projected onto
 * (`toOpenAIMessages`, `ChatStore.toMessagesArray`) before `streamChat` is handed it.
 */
function isOpenAIMessage(value: unknown): value is OpenAIMessage {
  if (!isNonNullObject(value) || !("role" in value) || !("content" in value)) {
    return false;
  }
  switch (value.role) {
    case "user":
    case "system": {
      return isString(value.content);
    }
    case "assistant": {
      return value.content === null || isString(value.content);
    }
    case "tool": {
      return isString(value.content) && "tool_call_id" in value && isString(value.tool_call_id);
    }
    default: {
      return false;
    }
  }
}

/**
 * Wrap a streaming client so each `streamChat` call is recorded before it is forwarded.
 *
 * `streamChat` is read off the wrapped client at CALL time, so a scenario that re-assigns it (to
 * abort mid-stream, or to switch tabs between rounds) keeps working whether it did so before or
 * after wrapping. Every other property passes straight through.
 */
export function spyStreamingClient<C extends StreamingClient>(
  client: C,
  log: ClientCallLog = createClientCallLog(),
): C {
  log.clients += 1;
  const index = log.clients;
  async function* streamChat(
    messages: object[],
    tools: object[],
    systemPrompt: string,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    log.prompts.push(receivedPrompt(systemPrompt));
    if (!messages.every((message) => isOpenAIMessage(message))) {
      throw new Error("streamChat is handed each round projected onto the OpenAI chat wire");
    }
    const snapshot = jsonSafe(messages);
    log.calls.push({
      client: index,
      messages: Array.isArray(snapshot) ? snapshot : [],
      signal: receivedSignal(signal),
      systemPrompt: digestPrompt(receivedPrompt(systemPrompt)),
      tools: receivedToolNames(tools),
    });
    yield* client.streamChat(messages, tools, systemPrompt, signal);
  }
  return new Proxy(client, {
    get(target, key) {
      /* SAFETY: `key` is the property this read asked the proxy for, so indexing `target` by it is
         the same [[Get]] Reflect.get would perform, and the trap's result is untyped either way. */
      return key === "streamChat" ? streamChat : target[key as keyof C];
    },
  });
}

// ─── 3. The ai-writes ledger ──────────────────────────────────────────────────

export type AiWritesEvent =
  | { op: "beginTurn"; id: string }
  | { op: "recordWrite"; write: JsonValue }
  | { op: "endTurn"; id: string; filed: JsonValue[] }
  | { op: "resetAiWrites" };

export interface AiWritesSpy {
  /** Every ledger call since the last {@link AiWritesSpy.reset}, in order. */
  events: AiWritesEvent[];
  /** Forget the events AND the real ledger (the module's own `resetAiWrites` seam). */
  reset: () => void;
}

type AiWritesModule = typeof AiWritesExports;

let installed: AiWritesSpy | null = null;

/**
 * Put a recording layer in front of `src/services/ai-writes.ts`.
 *
 * The real module is imported first and its functions captured by VALUE, then the module is
 * re-registered as wrappers that log and delegate to those captures — so the ledger the panel and
 * the tests read (`writesForTurn`) is the real one, fed by the real functions. Must run before any
 * module that imports ai-writes (the loop, the tools) is first loaded. Idempotent.
 */
export async function installAiWritesSpy(): Promise<AiWritesSpy> {
  if (installed) {
    return installed;
  }
  /* SAFETY: AI_WRITES is the absolute path of src/services/ai-writes.ts, the very module
     AiWritesModule is the `typeof` of, so the namespace this import resolves to has its exports. */
  const real = (await import(AI_WRITES)) as AiWritesModule;
  const {
    MAX_TURNS,
    fileTurn,
    openTurnLedger,
    resetAiWrites,
    summarizeWrites,
    turnAnchor,
    writesForTurn,
  } = real;
  const events: AiWritesEvent[] = [];
  /* The event vocabulary predates the per-turn ledger, and is kept: a turn's ledger opening is
     `beginTurn`, each write `recordWrite`, and its filing `endTurn`, so a trace records the same
     lifecycle whichever API carries it. */
  void mock.module(AI_WRITES, () => ({
    MAX_TURNS,
    fileTurn: (anchor: string, writes: Parameters<AiWritesModule["fileTurn"]>[1]) => {
      const filed = fileTurn(anchor, writes);
      events.push({ filed: filed.map((write) => jsonSafe(write)), id: anchor, op: "endTurn" });
      return filed;
    },
    openTurnLedger: (turnId: string) => {
      events.push({ id: turnId, op: "beginTurn" });
      const ledger = openTurnLedger(turnId);
      return {
        record: (write: Parameters<typeof ledger.record>[0]) => {
          events.push({ op: "recordWrite", write: jsonSafe(write) });
          ledger.record(write);
        },
        turnId: ledger.turnId,
        get writes() {
          return ledger.writes;
        },
      };
    },
    resetAiWrites: () => {
      events.push({ op: "resetAiWrites" });
      resetAiWrites();
    },
    summarizeWrites,
    turnAnchor,
    writesForTurn,
  }));
  installed = {
    events,
    reset: () => {
      events.length = 0;
      resetAiWrites();
    },
  };
  return installed;
}

// ─── Assembling a trace ───────────────────────────────────────────────────────

/** Everything one scenario produced, before normalisation. */
export interface TraceParts {
  chatCalls: ChatCall[];
  clientCalls: ClientCall[];
  aiWrites: AiWritesEvent[];
  finalMessages: TraceSubject;
  finalState: TraceSubject;
  finalDocument: TraceSubject;
  historyIndex: TraceSubject;
  extra?: Record<string, JsonValue | undefined>;
}

const MSG_ID = /\bmsg_(\d+)_(\d+)\b/g;
const VOLATILE_IDS: [RegExp, string][] = [
  [/\bs_\d{10,}_[a-z0-9]+\b/g, "session"],
  [/\brestored_\d+_[a-z0-9]+\b/g, "restored"],
  [/\bctx_summary_\d+\b/g, "ctx_summary"],
];
const TIMESTAMP_KEYS = new Set(["createdAt", "timestamp", "updatedAt"]);

function eachString(value: JsonValue, visit: (text: string) => void): void {
  if (isString(value)) {
    visit(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      eachString(item, visit);
    }
  } else if (isJsonObject(value)) {
    for (const item of Object.values(value)) {
      eachString(item, visit);
    }
  }
}

/**
 * Build the placeholder table for one trace. Message ids are numbered by CREATION order (the
 * counter chat-state stamps into them), so `msg#1` is always the first message the trace minted
 * whatever ran before it in the process; other volatile ids by first appearance.
 */
function placeholderTable(raw: JsonValue): Map<string, string> {
  const messages = new Map<string, number>();
  const others: [string, string][] = [];
  const seen = new Set<string>();
  eachString(raw, (text) => {
    for (const match of text.matchAll(MSG_ID)) {
      messages.set(match[0], Number(match[2]));
    }
    for (const [pattern, label] of VOLATILE_IDS) {
      for (const match of text.matchAll(pattern)) {
        if (!seen.has(match[0])) {
          seen.add(match[0]);
          others.push([match[0], label]);
        }
      }
    }
  });
  const table = new Map<string, string>();
  const byCreation = [...messages.entries()].toSorted((a, b) => a[1] - b[1]);
  for (const [i, [id]] of byCreation.entries()) {
    table.set(id, `msg#${i + 1}`);
  }
  const counters = new Map<string, number>();
  for (const [id, label] of others) {
    const n = (counters.get(label) ?? 0) + 1;
    counters.set(label, n);
    table.set(id, `${label}#${n}`);
  }
  return table;
}

/** One string with its machine paths and volatile ids replaced by their placeholders. */
function normalizeText(text: string, table: Map<string, string>): string {
  let out = normalizePaths(text);
  if (table.size > 0) {
    out = out.replaceAll(MSG_ID, (id) => table.get(id) ?? id);
    for (const [pattern] of VOLATILE_IDS) {
      out = out.replaceAll(pattern, (id) => table.get(id) ?? id);
    }
  }
  return out;
}

function normalizeWith(value: JsonValue, table: Map<string, string>, key?: string): JsonValue {
  if (isNumber(value) && key !== undefined && TIMESTAMP_KEYS.has(key)) {
    return "<ts>";
  }
  if (isString(value)) {
    return normalizeText(value, table);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeWith(item, table));
  }
  if (isJsonObject(value)) {
    const out: JsonObject = {};
    for (const [k, item] of Object.entries(value)) {
      out[k] = normalizeWith(item, table, k);
    }
    return out;
  }
  return value;
}

/** Replace every volatile value in a JSON tree with its stable placeholder. */
export function normalizeVolatile(raw: JsonValue): JsonValue {
  return normalizeWith(raw, placeholderTable(raw));
}

/*
 * The typed parts of a trace, normalised exactly as `normalizeWith` would normalise their JSON
 * snapshots inside the whole trace: every string through `normalizeText`, every JSON payload
 * through `normalizeWith` under the key it sits at (none for an array item). A number is only ever
 * rewritten under a timestamp key, and none of these typed fields is one. The literal `op` and
 * `signal` values hold no path and no id, so they pass through as they are.
 */

function normalizeChatCall(call: ChatCall, table: Map<string, string>): ChatCall {
  return {
    args: call.args.map((arg) => normalizeWith(arg, table)),
    chat: call.chat,
    method: normalizeText(call.method, table),
  };
}

function normalizeClientCall(call: ClientCall, table: Map<string, string>): ClientCall {
  return {
    client: call.client,
    messages: call.messages.map((message) => normalizeWith(message, table)),
    signal: call.signal,
    systemPrompt: {
      hash: normalizeText(call.systemPrompt.hash, table),
      headings: call.systemPrompt.headings.map((heading) => normalizeText(heading, table)),
      length: call.systemPrompt.length,
    },
    tools: call.tools.map((tool) => normalizeText(tool, table)),
  };
}

function normalizeAiWritesEvent(event: AiWritesEvent, table: Map<string, string>): AiWritesEvent {
  switch (event.op) {
    case "beginTurn": {
      return { id: normalizeText(event.id, table), op: event.op };
    }
    case "recordWrite": {
      return { op: event.op, write: normalizeWith(event.write, table, "write") };
    }
    case "endTurn": {
      return {
        filed: event.filed.map((write) => normalizeWith(write, table)),
        id: normalizeText(event.id, table),
        op: event.op,
      };
    }
    default: {
      return event;
    }
  }
}

/** A prompt digest as the JSON a trace carries, in the key order `digestPrompt` builds it. */
function digestJson(digest: PromptDigest): JsonObject {
  return { hash: digest.hash, headings: digest.headings, length: digest.length };
}

function sameJson(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function callLine(prefix: string, method: string, args: JsonValue[]): string {
  if (method.startsWith("set ")) {
    return `${prefix}${method} = ${JSON.stringify(args[0] ?? null)}`;
  }
  return `${prefix}${method}(${args.map((arg) => JSON.stringify(arg)).join(", ")})`;
}

/**
 * The client calls with the repetition taken out, losslessly: each call's messages are written as
 * `carried` (how many of the previous call's messages it opens with, unchanged) plus `added`, and a
 * tool list or prompt identical to the previous call's is written `"= previous"`.
 */
function compressClientCalls(calls: ClientCall[]): JsonValue[] {
  const multi = new Set(calls.map((call) => call.client)).size > 1;
  return calls.map((call, i) => {
    const prev = i > 0 ? calls[i - 1] : undefined;
    let carried = 0;
    if (prev && prev.messages.length <= call.messages.length) {
      const head = call.messages.slice(0, prev.messages.length);
      carried = sameJson(head, prev.messages) ? prev.messages.length : 0;
    }
    // Built key by key so the golden's key order stays round, client, signal, messages, ...
    const round: JsonObject = { round: i + 1 };
    if (multi) {
      round.client = call.client;
    }
    round.signal = call.signal;
    round.messages = { added: call.messages.slice(carried), carried };
    const digest = digestJson(call.systemPrompt);
    round.systemPrompt =
      prev && sameJson(digestJson(prev.systemPrompt), digest) ? "= previous" : digest;
    round.tools = prev && sameJson(prev.tools, call.tools) ? "= previous" : call.tools;
    return round;
  });
}

/** The ledger as the events that fed it, plus each filed turn grouped by the file it touched. */
function buildLedger(events: AiWritesEvent[]): JsonValue {
  const lines: string[] = [];
  const turns: JsonValue[] = [];
  for (const event of events) {
    switch (event.op) {
      case "beginTurn": {
        lines.push(`beginTurn(${JSON.stringify(event.id)})`);
        break;
      }
      case "recordWrite": {
        lines.push(`recordWrite(${JSON.stringify(event.write)})`);
        break;
      }
      case "endTurn": {
        lines.push(`endTurn(${JSON.stringify(event.id)}) filed ${event.filed.length}`);
        if (event.filed.length > 0) {
          const files = new Map<string, JsonValue[]>();
          for (const write of event.filed) {
            if (!isJsonObject(write)) {
              throw new Error(
                "A filed write snapshots an AiWrite record, which is always an object",
              );
            }
            const { path, ...rest } = write;
            const file = String(path);
            files.set(file, [...(files.get(file) ?? []), rest]);
          }
          turns.push({
            files: [...files.entries()].map(([file, writes]) => ({ file, writes })),
            turn: event.id,
          });
        }
        break;
      }
      default: {
        lines.push(`${event.op}()`);
      }
    }
  }
  return { events: lines, turns };
}

/**
 * Assemble one scenario's trace: snapshot, number the volatile ids across the whole thing, then
 * render the call logs as one line per call so a golden diff reads as a list of calls.
 */
export function buildTrace(parts: TraceParts): JsonValue {
  const raw = jsonSafe({
    aiWrites: parts.aiWrites,
    chatCalls: parts.chatCalls,
    clientCalls: parts.clientCalls,
    extra: parts.extra ?? null,
    finalDocument: parts.finalDocument ?? null,
    finalMessages: parts.finalMessages ?? null,
    finalState: parts.finalState ?? null,
    historyIndex: parts.historyIndex ?? null,
  });
  if (!isJsonObject(raw)) {
    throw new Error("A snapshot of an object literal is always a JSON object");
  }
  // The table is built over the WHOLE snapshot, so an id's placeholder is its order in the trace.
  const table = placeholderTable(raw);
  /** One snapshot field, normalised under its own key; a field the snapshot dropped is null. */
  const field = (key: string): JsonValue => {
    const value = raw[key];
    return value === undefined ? null : normalizeWith(value, table, key);
  };
  const chatCalls = parts.chatCalls.map((call) => normalizeChatCall(call, table));
  const multiChat = new Set(chatCalls.map((call) => call.chat)).size > 1;
  const trace: JsonObject = {
    chatCalls: chatCalls.map((call) =>
      callLine(multiChat ? `[chat ${call.chat}] ` : "", call.method, call.args),
    ),
    clientCalls: compressClientCalls(
      parts.clientCalls.map((call) => normalizeClientCall(call, table)),
    ),
    ledger: buildLedger(parts.aiWrites.map((event) => normalizeAiWritesEvent(event, table))),
    finalMessages: field("finalMessages"),
    finalState: field("finalState"),
    finalDocument: field("finalDocument"),
    historyIndex: field("historyIndex"),
  };
  if (parts.extra) {
    trace.extra = field("extra");
  }
  return trace;
}

/**
 * A chat message as the golden records it: its normalised id, role and content, the reasoning and
 * tool calls it carries, and nothing that is a clock.
 */
export function messageRecord(m: LiveMessage): JsonValue {
  return jsonSafe({
    id: m.id,
    role: m.role,
    content: m.content,
    reasoningContent: m.reasoningContent,
    toolCallId: m.toolCallId,
    toolCalls: m.toolCalls?.map((call) => ({
      arguments: call.arguments,
      id: call.id,
      name: call.name,
      result: call.result ?? null,
    })),
  });
}

// ─── Goldens ──────────────────────────────────────────────────────────────────

/** Set `JX_UPDATE_GOLDENS=1` to (re)write goldens instead of comparing against them. */
export const UPDATING_GOLDENS = process.env.JX_UPDATE_GOLDENS === "1";

export interface Difference {
  path: string;
  expected: JsonValue | undefined;
  actual: JsonValue | undefined;
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/** The first place two JSON trees disagree, depth-first in document order, or null. */
export function firstDifference(
  expected: JsonValue | undefined,
  actual: JsonValue | undefined,
  path = "$",
): Difference | null {
  if (expected === actual) {
    return null;
  }
  // Two arrays, or two objects, are compared member by member; any other pair simply differs.
  if (Array.isArray(expected) && Array.isArray(actual)) {
    for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
      const diff = firstDifference(expected[i], actual[i], `${path}[${i}]`);
      if (diff) {
        return diff;
      }
    }
    return null;
  }
  if (isJsonObject(expected) && isJsonObject(actual)) {
    const keys = [
      ...Object.keys(expected),
      ...Object.keys(actual).filter((key) => !(key in expected)),
    ];
    for (const key of keys) {
      const diff = firstDifference(expected[key], actual[key], childPath(path, key));
      if (diff) {
        return diff;
      }
    }
    return null;
  }
  return { actual, expected, path };
}

function show(value: JsonValue | undefined): string {
  if (value === undefined) {
    return "<missing>";
  }
  const text = JSON.stringify(value);
  return text.length > 600 ? `${text.slice(0, 600)}… (${text.length} chars)` : text;
}

/**
 * Compare a trace against its golden, or write the golden when {@link UPDATING_GOLDENS}. An
 * unchanged golden is never rewritten, so a regeneration run touches only what moved and keeps any
 * formatting `oxfmt` gave the rest.
 *
 * @throws {Error} Naming the first differing path, both values, and how to re-record
 */
export function matchGolden(file: string, actual: JsonValue): void {
  const shown = relative(REPO_ROOT, file);
  /* SAFETY: JSON.parse without a reviver can only produce null, booleans, finite numbers, strings,
     arrays and plain objects of those — exactly JsonValue. */
  const expected = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as JsonValue)
    : undefined;
  if (UPDATING_GOLDENS) {
    if (expected === undefined || firstDifference(expected, actual)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
    }
    return;
  }
  if (expected === undefined) {
    throw new Error(`No golden at ${shown}. Record it with JX_UPDATE_GOLDENS=1.`);
  }
  const diff = firstDifference(expected, actual);
  if (diff) {
    throw new Error(
      [
        `Agent trace differs from ${shown}`,
        `  at       ${diff.path}`,
        `  expected ${show(diff.expected)}`,
        `  actual   ${show(diff.actual)}`,
        "If the change is intended, re-record with JX_UPDATE_GOLDENS=1 and review the diff.",
      ].join("\n"),
    );
  }
}
