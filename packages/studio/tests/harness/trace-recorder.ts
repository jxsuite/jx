/**
 * Trace-recorder.ts — what one agent turn DID, recorded as data a golden file can pin (J1.2).
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
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";
import type { JsonObject as SchemaJsonObject, JsonValue } from "@jxsuite/schema/types";
/* Type-only, so it is erased: see the import rule above. */
import type * as AiWritesExports from "../../src/services/ai-writes";

/** Plain JSON, the only thing a golden holds (the schema package's own recursive definition). */
export type Json = JsonValue;

/** A JSON object. */
export type JsonObject = SchemaJsonObject;

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const AI_WRITES = resolve(import.meta.dir, "../../src/services/ai-writes.ts");

// ─── Snapshots ────────────────────────────────────────────────────────────────

/**
 * A JSON-safe deep copy, taken NOW. Reactive proxies are read through (their own `ownKeys`),
 * `undefined` and functions are dropped the way `JSON.stringify` drops them, Maps and Sets become
 * objects and arrays, and a cycle is marked rather than followed.
 */
export function jsonSafe(value: unknown): Json {
  const stack = new Set<object>();
  const walk = (input: unknown): Json | undefined => {
    if (input === null) {
      return null;
    }
    switch (typeof input) {
      case "string":
      case "boolean": {
        return input;
      }
      case "number": {
        return Number.isFinite(input) ? input : String(input);
      }
      case "bigint": {
        return `${input}n`;
      }
      case "undefined":
      case "function":
      case "symbol": {
        return undefined;
      }
      default: {
        break;
      }
    }
    const obj = input as object;
    if (stack.has(obj)) {
      return "<cycle>";
    }
    stack.add(obj);
    try {
      if (Array.isArray(obj)) {
        return obj.map((item) => walk(item) ?? null);
      }
      if (obj instanceof Map) {
        return walk(Object.fromEntries(obj)) ?? null;
      }
      if (obj instanceof Set) {
        return walk([...obj]) ?? null;
      }
      if (obj instanceof Error) {
        return { error: obj.message };
      }
      if (typeof AbortSignal !== "undefined" && obj instanceof AbortSignal) {
        return { aborted: obj.aborted };
      }
      const out: JsonObject = {};
      for (const [key, item] of Object.entries(obj)) {
        const json = walk(item);
        if (json !== undefined) {
          out[key] = json;
        }
      }
      return out;
    } finally {
      stack.delete(obj);
    }
  };
  return walk(value) ?? null;
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
  args: Json[];
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
  const wrappers = new Map<string, { real: unknown; wrapper: unknown }>();
  const proxy = new Proxy(chatState, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      if (typeof key !== "string" || typeof value !== "function") {
        return value;
      }
      const cached = wrappers.get(key);
      if (cached?.real === value) {
        return cached.wrapper;
      }
      const real = value as (...args: unknown[]) => unknown;
      const wrapper = (...args: unknown[]) => {
        log.calls.push({ args: args.map((arg) => jsonSafe(arg)), chat, method: key });
        return real.apply(target, args);
      };
      wrappers.set(key, { real: value, wrapper });
      return wrapper;
    },
    set(target, key, value) {
      if (typeof key === "string") {
        log.calls.push({ args: [jsonSafe(value)], chat, method: `set ${key}` });
      }
      return Reflect.set(target, key, value);
    },
  });
  chatLogs.set(proxy, log);
  return proxy;
}

/** The log a recorded store writes to, or undefined for a store that was never recorded. */
export function chatCallsOf(chatState: object): ChatCall[] | undefined {
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
  messages: Json[];
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
    log.prompts.push(String(systemPrompt ?? ""));
    log.calls.push({
      client: index,
      messages: (jsonSafe(messages) as Json[] | null) ?? [],
      signal: signal ? (signal.aborted ? "aborted" : "live") : "none",
      systemPrompt: digestPrompt(String(systemPrompt ?? "")),
      tools: ((tools ?? []) as { function?: { name?: string } }[]).map(
        (tool) => tool.function?.name ?? "<unnamed>",
      ),
    });
    yield* client.streamChat(messages, tools, systemPrompt, signal);
  }
  return new Proxy(client, {
    get(target, key) {
      return key === "streamChat" ? streamChat : Reflect.get(target, key);
    },
  });
}

// ─── 3. The ai-writes ledger ──────────────────────────────────────────────────

export type AiWritesEvent =
  | { op: "beginTurn"; id: string }
  | { op: "recordWrite"; write: Json }
  | { op: "endTurn"; id: string; filed: Json[] }
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
  const real = (await import(AI_WRITES)) as AiWritesModule;
  const {
    MAX_TURNS,
    beginTurn,
    endTurn,
    recordWrite,
    resetAiWrites,
    summarizeWrites,
    writesForTurn,
  } = real;
  const events: AiWritesEvent[] = [];
  void mock.module(AI_WRITES, () => ({
    MAX_TURNS,
    beginTurn: (id: string) => {
      events.push({ id, op: "beginTurn" });
      beginTurn(id);
    },
    endTurn: (id: string) => {
      const filed = endTurn(id);
      events.push({ filed: filed.map((write) => jsonSafe(write)), id, op: "endTurn" });
      return filed;
    },
    recordWrite: (write: Parameters<AiWritesModule["recordWrite"]>[0]) => {
      events.push({ op: "recordWrite", write: jsonSafe(write) });
      recordWrite(write);
    },
    resetAiWrites: () => {
      events.push({ op: "resetAiWrites" });
      resetAiWrites();
    },
    summarizeWrites,
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
  finalMessages: unknown;
  finalState: unknown;
  finalDocument: unknown;
  historyIndex: unknown;
  extra?: Record<string, unknown>;
}

const MSG_ID = /\bmsg_(\d+)_(\d+)\b/g;
const VOLATILE_IDS: [RegExp, string][] = [
  [/\bs_\d{10,}_[a-z0-9]+\b/g, "session"],
  [/\brestored_\d+_[a-z0-9]+\b/g, "restored"],
  [/\bctx_summary_\d+\b/g, "ctx_summary"],
];
const TIMESTAMP_KEYS = new Set(["createdAt", "timestamp", "updatedAt"]);

function eachString(value: Json, visit: (text: string) => void): void {
  if (typeof value === "string") {
    visit(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      eachString(item, visit);
    }
  } else if (value && typeof value === "object") {
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
function placeholderTable(raw: Json): Map<string, string> {
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

function normalizeWith(value: Json, table: Map<string, string>, key?: string): Json {
  if (typeof value === "number" && key !== undefined && TIMESTAMP_KEYS.has(key)) {
    return "<ts>";
  }
  if (typeof value === "string") {
    let out = normalizePaths(value);
    if (table.size > 0) {
      out = out.replaceAll(MSG_ID, (id) => table.get(id) ?? id);
      for (const [pattern] of VOLATILE_IDS) {
        out = out.replaceAll(pattern, (id) => table.get(id) ?? id);
      }
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeWith(item, table));
  }
  if (value && typeof value === "object") {
    const out: JsonObject = {};
    for (const [k, item] of Object.entries(value)) {
      out[k] = normalizeWith(item, table, k);
    }
    return out;
  }
  return value;
}

/** Replace every volatile value in a JSON tree with its stable placeholder. */
export function normalizeVolatile(raw: Json): Json {
  return normalizeWith(raw, placeholderTable(raw));
}

function sameJson(a: Json | undefined, b: Json | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function callLine(prefix: string, method: string, args: Json[]): string {
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
function compressClientCalls(calls: Json[]): Json[] {
  const multi = new Set(calls.map((call) => (call as { client: number }).client)).size > 1;
  return calls.map((value, i) => {
    const call = value as unknown as ClientCall & { messages: Json[] };
    const prev = i > 0 ? (calls[i - 1] as unknown as ClientCall) : undefined;
    let carried = 0;
    if (prev && prev.messages.length <= call.messages.length) {
      const head = call.messages.slice(0, prev.messages.length);
      carried = sameJson(head, prev.messages) ? prev.messages.length : 0;
    }
    return {
      round: i + 1,
      ...(multi ? { client: call.client } : {}),
      signal: call.signal,
      messages: { added: call.messages.slice(carried), carried },
      systemPrompt:
        prev && sameJson(prev.systemPrompt as unknown as Json, call.systemPrompt as unknown as Json)
          ? "= previous"
          : (call.systemPrompt as unknown as Json),
      tools: prev && sameJson(prev.tools, call.tools) ? "= previous" : call.tools,
    };
  });
}

/** The ledger as the events that fed it, plus each filed turn grouped by the file it touched. */
function buildLedger(events: Json[]): Json {
  const lines: string[] = [];
  const turns: Json[] = [];
  for (const value of events) {
    const event = value as unknown as AiWritesEvent;
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
          const files = new Map<string, Json[]>();
          for (const write of event.filed as JsonObject[]) {
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
export function buildTrace(parts: TraceParts): Json {
  const raw = jsonSafe({
    aiWrites: parts.aiWrites,
    chatCalls: parts.chatCalls,
    clientCalls: parts.clientCalls,
    extra: parts.extra ?? null,
    finalDocument: parts.finalDocument ?? null,
    finalMessages: parts.finalMessages ?? null,
    finalState: parts.finalState ?? null,
    historyIndex: parts.historyIndex ?? null,
  }) as JsonObject;
  const n = normalizeVolatile(raw) as JsonObject;
  const chatCalls = n.chatCalls as unknown as ChatCall[];
  const multiChat = new Set(chatCalls.map((call) => call.chat)).size > 1;
  const trace: JsonObject = {
    chatCalls: chatCalls.map((call) =>
      callLine(multiChat ? `[chat ${call.chat}] ` : "", call.method, call.args),
    ),
    clientCalls: compressClientCalls(n.clientCalls as Json[]),
    ledger: buildLedger(n.aiWrites as Json[]),
    finalMessages: n.finalMessages ?? null,
    finalState: n.finalState ?? null,
    finalDocument: n.finalDocument ?? null,
    historyIndex: n.historyIndex ?? null,
  };
  if (parts.extra) {
    trace.extra = n.extra ?? null;
  }
  return trace;
}

/**
 * A chat message as the golden records it: its normalised id, role and content, the reasoning and
 * tool calls it carries, and nothing that is a clock.
 */
export function messageShape(message: unknown): Json {
  const m = message as {
    id?: string;
    role?: string;
    content?: string;
    reasoningContent?: string;
    toolCallId?: string;
    toolCalls?: { id: string; name: string; arguments: string; result?: unknown }[];
  };
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
  expected: Json | undefined;
  actual: Json | undefined;
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/** The first place two JSON trees disagree, depth-first in document order, or null. */
export function firstDifference(
  expected: Json | undefined,
  actual: Json | undefined,
  path = "$",
): Difference | null {
  if (expected === actual) {
    return null;
  }
  const bothObjects =
    expected !== null &&
    actual !== null &&
    typeof expected === "object" &&
    typeof actual === "object" &&
    Array.isArray(expected) === Array.isArray(actual);
  if (!bothObjects) {
    return { actual, expected, path };
  }
  if (Array.isArray(expected)) {
    const other = actual as Json[];
    for (let i = 0; i < Math.max(expected.length, other.length); i++) {
      const diff = firstDifference(expected[i], other[i], `${path}[${i}]`);
      if (diff) {
        return diff;
      }
    }
    return null;
  }
  const e = expected as JsonObject;
  const a = actual as JsonObject;
  const keys = [...Object.keys(e), ...Object.keys(a).filter((key) => !(key in e))];
  for (const key of keys) {
    const diff = firstDifference(e[key], a[key], childPath(path, key));
    if (diff) {
      return diff;
    }
  }
  return null;
}

function show(value: Json | undefined): string {
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
export function matchGolden(file: string, actual: Json): void {
  const shown = relative(REPO_ROOT, file);
  const expected = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Json) : undefined;
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
