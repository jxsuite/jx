/**
 * The v1 transcript corpus: every conversation shape `toMessagesArray` serializes, frozen (J1.2).
 *
 * Each file under `fixtures/v1/transcripts/` is one transcript and claims the shapes it exhibits by
 * name. Two kinds exist:
 *
 * - **Scripted** fixtures carry a `script`: the chat-state API calls that produce the transcript, in
 *   the order Studio's agent loop makes them. The test replays the script through a fresh
 *   `createChatState` and holds the resulting `messages` (and `usage`, when the script records one)
 *   to the golden, so the in-memory shape is frozen as well as the wire.
 * - **Authored** fixtures carry `messages` only, for shapes chat-state cannot produce on its own: a
 *   transcript Studio repaired (`pruneOrphanToolMessages`), or one restored from storage with
 *   fields the current build never writes.
 *
 * Either way the messages are then pushed into ANOTHER fresh chat state, exactly as Studio's
 * session restore does, and `toMessagesArray()` is held to `wire`. The last test asserts that the
 * corpus names every shape in {@link REQUIRED_SHAPES}, and that each claim is actually exhibited.
 *
 * Nothing here is nondeterministic: the clock is frozen per script step, and chat-state's
 * `msg_<time>_<n>` ids (whose counter is module-global) are rewritten to `msg_T_<k>` by order of
 * first appearance.
 *
 * Regenerate (from packages/ai): `JX_UPDATE_GOLDENS=1 bun test --isolate
 * tests/v1-transcripts.test.ts`, then review the diff. Only `messages` of a scripted fixture,
 * `usage` and `wire` are rewritten; `script`, `shapes`, `description` and an authored fixture's
 * `messages` are inputs.
 */

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createChatState } from "../src/chat-state.ts";

const DIR = join(import.meta.dir, "fixtures", "v1", "transcripts");
const UPDATE = process.env.JX_UPDATE_GOLDENS === "1";
const REGENERATE = "JX_UPDATE_GOLDENS=1 bun test --isolate tests/v1-transcripts.test.ts";

/** 2026-01-01T00:00:00Z. Script step `i` runs at `BASE_TIME + (i + 1) * STEP_MS`. */
const BASE_TIME = Date.UTC(2026, 0, 1);
const STEP_MS = 1000;

/** The text `pruneOrphanToolMessages` (Studio, services/context-manager.ts) seals a call with. */
const UNANSWERED_TOOL_RESULT = JSON.stringify({
  success: false,
  error:
    "This tool call was never completed — the session was reloaded or the history was trimmed.",
});

/** The chat-state methods a script may call. Anything else is a typo, and fails loudly. */
const SCRIPT_METHODS = new Set([
  "sendMessage",
  "beginAssistantTurn",
  "appendDelta",
  "appendReasoning",
  "appendToolCallStart",
  "appendToolCallDelta",
  "appendToolCallEnd",
  "appendToolResult",
  "pushToolResultMessage",
  "finishStream",
  "setError",
  "cancelStream",
  "retryLast",
  "recordUsage",
  "clearUsage",
]);

type JsonObject = Record<string, unknown>;
type ScriptStep = [string, ...unknown[]];

interface TranscriptFixture {
  name: string;
  description: string;
  shapes: string[];
  script?: ScriptStep[];
  messages?: JsonObject[];
  usage?: JsonObject;
  wire?: JsonObject[];
}

interface LoadedFixture {
  file: string;
  path: string;
  data: TranscriptFixture;
}

// ─── Golden plumbing ─────────────────────────────────────────────────────────

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON value's text, clipped so a failure message stays one screen. */
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

/** Throw a readable failure naming the first differing path; a match returns quietly. */
function assertGolden(fixture: LoadedFixture, field: string, actual: unknown) {
  const expected = (fixture.data as unknown as Record<string, unknown>)[field];
  const difference = firstDifference(expected, actual, `$.${field}`);
  if (difference) {
    throw new Error(
      `${fixture.file}: "${field}" no longer matches its golden.\n` +
        `  first difference at ${difference}\n` +
        `  If the change is intended, run \`${REGENERATE}\` from packages/ai and review the diff.`,
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

/** Rewrite the fixture file, only when its content actually changed. */
function writeFixture(fixture: LoadedFixture) {
  const onDisk = JSON.parse(readFileSync(fixture.path, "utf8")) as unknown;
  if (firstDifference(onDisk, fixture.data) === null) {
    return;
  }
  writeFileSync(fixture.path, `${layout(fixture.data, 0, 0, 0)}\n`);
}

// ─── Normalization ───────────────────────────────────────────────────────────

/** A JSON-only copy: reactive proxies unwrapped, `undefined` members dropped as the wire drops them. */
function plain(value: unknown): unknown {
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- JSON normalization is the point
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/** Rewrite every `msg_<time>_<n>` id to `msg_T_<k>`, numbered by order of first appearance. */
function normalizeIds(value: unknown): unknown {
  const seen = new Map<string, string>();
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (!/^msg_\d+_\d+$/.test(v)) {
        return v;
      }
      if (!seen.has(v)) {
        seen.set(v, `msg_T_${seen.size + 1}`);
      }
      return seen.get(v)!;
    }
    if (Array.isArray(v)) {
      return v.map((item) => visit(item));
    }
    if (isObject(v)) {
      return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, visit(item)]));
    }
    return v;
  };
  return visit(value);
}

// ─── Chat-state drivers ──────────────────────────────────────────────────────

type ChatStateApi = ReturnType<typeof createChatState>;

/** Replay a script through a fresh chat state, one frozen clock tick per step. */
function replay(fixture: LoadedFixture): ChatStateApi {
  const chat = createChatState({ model: "gpt-4o" });
  const api = chat as unknown as Record<string, unknown>;
  for (const [i, [method, ...args]] of (fixture.data.script ?? []).entries()) {
    const fn = api[method];
    if (!SCRIPT_METHODS.has(method) || typeof fn !== "function") {
      throw new Error(`${fixture.file}: script step ${i} calls unknown method "${method}"`);
    }
    setSystemTime(new Date(BASE_TIME + (i + 1) * STEP_MS));
    (fn as (...a: unknown[]) => void)(...args);
  }
  return chat;
}

/** Load a transcript the way Studio restores one: messages pushed straight into a fresh state. */
function load(fixture: LoadedFixture): ChatStateApi {
  const chat = createChatState({ model: "gpt-4o" });
  for (const msg of structuredClone(fixture.data.messages ?? [])) {
    chat.messages.push(msg as unknown as ChatStateApi["messages"][number]);
  }
  if (fixture.data.usage) {
    chat.usage = structuredClone(fixture.data.usage) as unknown as ChatStateApi["usage"];
  }
  return chat;
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

interface WireEntry {
  role?: string;
  content?: string | null;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
}
interface MessageEntry {
  id?: string;
  role?: string;
  content?: string;
  reasoningContent?: string;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; arguments: string; result?: unknown }[];
}

const wireOf = (fx: TranscriptFixture) => (fx.wire ?? []) as WireEntry[];
const messagesOf = (fx: TranscriptFixture) => (fx.messages ?? []) as MessageEntry[];
const calls = (fx: TranscriptFixture) => messagesOf(fx).flatMap((m) => m.toolCalls ?? []);
const stepIndex = (fx: TranscriptFixture, method: string, arg?: unknown) =>
  (fx.script ?? []).findIndex(([m, a]) => m === method && (arg === undefined || a === arg));
const parses = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * Every shape the corpus must exhibit, with the check that a claim is real. A fixture that claims a
 * shape its content does not show fails, so a label cannot outlive the transcript it described.
 */
/** The chat-state methods a scripted fixture calls, in order. */
function scriptCalls(fx: TranscriptFixture): string[] {
  return (fx.script ?? []).map(([method]) => method);
}

const REQUIRED_SHAPES: Record<string, (fx: TranscriptFixture) => boolean> = {
  /**
   * A stream error recorded in the order the loop made the calls before J1.4 (finishStream, then
   * setError): the partial assistant turn is NOT removed, so it reaches the wire. The loop now
   * calls setError alone, which removes it, but sessions saved by earlier builds carry this shape.
   */
  "stream-error-partial-kept": (fx) =>
    scriptCalls(fx).join(",").includes("finishStream,setError") &&
    wireOf(fx).some((e) => e.role === "assistant"),
  /** Stop while streaming: cancelStream removes the partial reply, so no assistant turn is sent. */
  "cancelled-mid-stream": (fx) =>
    scriptCalls(fx).includes("cancelStream") && !wireOf(fx).some((e) => e.role === "assistant"),
  /** Retry: retryLast drops the last exchange, so the first attempt reaches neither side. */
  "retried-turn": (fx) =>
    scriptCalls(fx).includes("retryLast") &&
    wireOf(fx).filter((e) => e.role === "user").length === 1,
  /** User and assistant text only: every wire entry is exactly `{ role, content }`. */
  "plain-exchange": (fx) =>
    wireOf(fx).some((e) => e.role === "user") &&
    wireOf(fx).some((e) => e.role === "assistant") &&
    wireOf(fx).every((e) => Object.keys(e).toSorted().join(",") === "content,role"),
  /** An assistant turn with neither text nor tool calls, which the wire leaves out. */
  "placeholder-dropped": (fx) =>
    messagesOf(fx).some(
      (m) => m.role === "assistant" && !m.content && (m.toolCalls?.length ?? 0) === 0,
    ),
  "reasoning-replayed": (fx) => wireOf(fx).some((e) => typeof e.reasoning_content === "string"),
  /** A turn that only thought: dropped, reasoning and all. */
  "reasoning-only-dropped": (fx) =>
    messagesOf(fx).some(
      (m) =>
        m.role === "assistant" &&
        Boolean(m.reasoningContent) &&
        !m.content &&
        (m.toolCalls?.length ?? 0) === 0,
    ),
  "single-tool-call": (fx) => wireOf(fx).some((e) => e.tool_calls?.length === 1),
  "parallel-tool-calls": (fx) => wireOf(fx).some((e) => (e.tool_calls?.length ?? 0) > 1),
  "tool-result-message": (fx) =>
    wireOf(fx).some((e) => e.role === "tool" && typeof e.tool_call_id === "string"),
  /**
   * A record with no result: a call a Stop left unrun. Until J1.4 Studio's loop left EVERY record
   * like this (its `appendToolResult` looked for the record after `finishStream` had let go of it),
   * so sessions saved by earlier builds carry it on calls that did run.
   */
  "tool-record-result-null": (fx) => calls(fx).some((c) => c.result === null),
  /** A record that does carry its result, which never reaches the wire. */
  "tool-record-result-set": (fx) =>
    calls(fx).some((c) => isObject(c.result)) && !JSON.stringify(fx.wire).includes('"result"'),
  "content-null-with-tool-calls": (fx) =>
    wireOf(fx).some((e) => e.content === null && (e.tool_calls?.length ?? 0) > 0),
  "text-and-tool-calls": (fx) =>
    wireOf(fx).some(
      (e) =>
        typeof e.content === "string" && e.content.length > 0 && (e.tool_calls?.length ?? 0) > 0,
    ),
  /** `ask_user` requested, answered by a tool reply, and the turn carried on after it. */
  "ask-user-round": (fx) => {
    const wire = wireOf(fx);
    const at = wire.findIndex((e) => e.tool_calls?.some((c) => c.function.name === "ask_user"));
    if (at === -1) {
      return false;
    }
    const { id } = wire[at]!.tool_calls!.find((c) => c.function.name === "ask_user")!;
    const reply = wire.findIndex((e, i) => i > at && e.tool_call_id === id);
    return reply !== -1 && wire.slice(reply + 1).some((e) => e.role === "assistant");
  },
  /** A reply `pruneOrphanToolMessages` synthesized for a call that was never answered. */
  "sealed-orphan": (fx) =>
    messagesOf(fx).some(
      (m) =>
        m.role === "tool" &&
        Boolean(m.id?.startsWith("sealed_")) &&
        m.content === UNANSWERED_TOOL_RESULT,
    ),
  "usage-recorded": (fx) => isObject(fx.usage) && stepIndex(fx, "recordUsage") !== -1,
  /** A text answer the provider cut off: the finish reason is recorded nowhere in the transcript. */
  "length-cutoff-text": (fx) => {
    const at = stepIndex(fx, "finishStream", "length");
    return at > 0 && fx.script![at - 1]![0] === "appendDelta" && calls(fx).length === 0;
  },
  /** A tool call cut off mid-arguments: the arguments do not parse, and the reply says so. */
  "length-cutoff-tool-call": (fx) =>
    stepIndex(fx, "finishStream", "length") !== -1 &&
    calls(fx).some((c) => !parses(c.arguments)) &&
    messagesOf(fx).some(
      (m) => m.role === "tool" && Boolean(m.content?.includes("Failed to parse arguments")),
    ),
  /** The agent loop's round-cap message: an assistant turn begun without a user message. */
  "round-cap-tail": (fx) => {
    const at = stepIndex(fx, "finishStream", "length");
    return (
      at > 1 &&
      fx.script![at - 2]![0] === "beginAssistantTurn" &&
      String(fx.script![at - 1]![1]).startsWith("I ran out of tool-call rounds")
    );
  },
  /** Any role other than assistant and tool passes through as `{ role, content }`. */
  "system-role": (fx) => wireOf(fx).some((e) => e.role === "system"),
  /** A message field the wire does not know about is not sent. */
  "foreign-fields-ignored": (fx) => {
    const known = new Set([
      "id",
      "role",
      "content",
      "reasoningContent",
      "toolCalls",
      "toolCallId",
      "timestamp",
    ]);
    return messagesOf(fx).some((m) => Object.keys(m).some((k) => !known.has(k)));
  },
};

// ─── The corpus ──────────────────────────────────────────────────────────────

function loadCorpus(): LoadedFixture[] {
  return readdirSync(DIR)
    .filter((file) => file.endsWith(".json"))
    .toSorted()
    .map((file) => {
      const path = join(DIR, file);
      return { file, path, data: JSON.parse(readFileSync(path, "utf8")) as TranscriptFixture };
    });
}

const corpus = loadCorpus();

afterEach(() => {
  setSystemTime();
});

describe("v1 transcript corpus", () => {
  for (const fixture of corpus) {
    describe(fixture.file, () => {
      if (fixture.data.script) {
        test("the script records the frozen messages through chat-state's own API", () => {
          const chat = replay(fixture);
          const recorded = normalizeIds(
            plain({ messages: chat.messages, usage: chat.usage ?? undefined }),
          ) as { messages: JsonObject[]; usage?: JsonObject };
          // The replayed state serializes exactly as the reloaded one must.
          const wire = plain(chat.toMessagesArray());
          if (UPDATE) {
            fixture.data.messages = recorded.messages;
            if (recorded.usage) {
              fixture.data.usage = recorded.usage;
            } else {
              delete fixture.data.usage;
            }
            writeFixture(fixture);
          }
          assertGolden(fixture, "messages", recorded.messages);
          assertGolden(fixture, "usage", recorded.usage);
          const reloaded = load(fixture).toMessagesArray();
          expect(firstDifference(wire, plain(reloaded))).toBeNull();
        });
      }

      test("toMessagesArray of the reloaded messages is the frozen wire", () => {
        expect(Array.isArray(fixture.data.messages)).toBe(true);
        const chat = load(fixture);
        const wire = plain(chat.toMessagesArray());
        if (UPDATE) {
          fixture.data.wire = wire as JsonObject[];
          writeFixture(fixture);
        }
        assertGolden(fixture, "wire", wire);
        // Serializing is read-only: the transcript is untouched by building the wire.
        expect(firstDifference(fixture.data.messages, plain(chat.messages))).toBeNull();
      });
    });
  }

  test("names every required shape, and every claim is exhibited by its fixture", () => {
    const claimed = new Map<string, string[]>();
    const problems: string[] = [];
    for (const { file, data } of corpus) {
      if (file !== `${data.name}.json`) {
        problems.push(`${file}: "name" is "${data.name}", expected "${file.slice(0, -5)}"`);
      }
      if (!data.description?.trim()) {
        problems.push(`${file}: no description`);
      }
      if (!Array.isArray(data.shapes) || data.shapes.length === 0) {
        problems.push(`${file}: claims no shapes`);
      }
      for (const shape of data.shapes ?? []) {
        const check = REQUIRED_SHAPES[shape];
        if (!check) {
          problems.push(`${file}: claims "${shape}", which is not a required shape`);
          continue;
        }
        if (!check(data)) {
          problems.push(`${file}: claims "${shape}" but does not exhibit it`);
        }
        claimed.set(shape, [...(claimed.get(shape) ?? []), file]);
      }
    }
    for (const shape of Object.keys(REQUIRED_SHAPES)) {
      if (!claimed.has(shape)) {
        problems.push(`no fixture claims "${shape}"`);
      }
    }
    expect(problems).toEqual([]);
  });
});
