/**
 * Persist.ts — a saved conversation, read back and trimmed for saving (specs/ai.md §3.13).
 *
 * A saved conversation is a bare array of v1 messages, and three generations of it exist in
 * people's browsers: the single-conversation store's array, the sessions store's, and the current
 * one, which adds optional `blocks` and `meta`. `migrateTranscript` reads all three as the current
 * shape, on every load, and running it over its own output changes nothing. It never throws on what
 * it reads: storage can hold anything.
 *
 * @module @jxsuite/ai/messages
 * @license MIT
 */

import type { JsonObject, JsonValue, ToolResult } from "../core-types.ts";
import { isBlock } from "./blocks.ts";
import type { LiveMessage, LiveToolCall, MessageKind, MessageMeta, Role } from "./types.ts";

/** The roles a stored message may carry. */
const ROLES: ReadonlySet<string> = new Set(["user", "assistant", "tool", "system"]);

/** The id prefixes Studio gave its synthetic messages before a message had a `meta.kind`. */
const KIND_BY_PREFIX: readonly (readonly [prefix: string, kind: MessageKind])[] = [
  ["ctx_summary_", "ctx_summary"],
  ["sealed_", "sealed"],
  ["restored_", "restored"],
  ["seeded_", "seeded"],
];

/** The title a conversation has until its first message gives it one. */
export const DEFAULT_SESSION_TITLE = "New chat";

/** What a caller supplies to fill what an old payload lacks. */
export interface MigrateOptions {
  /** Mints the id of a message stored without one. Called once per such message. */
  readonly newId: () => string;
  /** Stamps a message stored without a timestamp. */
  readonly now: () => number;
}

/**
 * True when a stored value is a JSON object.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when a stored value is a string.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/**
 * True when a stored value is a number.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

/**
 * True when a stored role is one a message may carry.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isRole(value: JsonValue | undefined): value is Role {
  return isString(value) && ROLES.has(value);
}

/**
 * True when a stored `meta` member is one to carry. Every member of a `MessageMeta` is optional, is
 * written only by this module and the turn engine, and is never sent to a provider, so any object
 * is one; a reader checks the member it uses.
 *
 * @param {unknown} value - A stored message's `meta`
 * @returns {boolean}
 */
function isMeta(value: unknown): value is MessageMeta {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a tool call's arguments are JSON. A call cut off mid-arguments is not.
 *
 * @param {string} argumentsText
 * @returns {boolean}
 */
function parses(argumentsText: string): boolean {
  try {
    JSON.parse(argumentsText);
    return true;
  } catch {
    return false;
  }
}

/**
 * A stored tool-call record as the current shape, or null when it is not a record. A record's
 * `result` is carried as stored: which outcome a restored chip shows is the host's rule.
 *
 * @param {JsonValue} stored
 * @returns {LiveToolCall | null}
 */
function migrateCall(stored: JsonValue): LiveToolCall | null {
  if (!isObject(stored)) {
    return null;
  }
  const call: LiveToolCall = {
    id: isString(stored.id) ? stored.id : "",
    name: isString(stored.name) ? stored.name : "",
    arguments: isString(stored.arguments) ? stored.arguments : "",
  };
  const { result } = stored;
  if (result === null) {
    call.result = null;
  } else if (isObject(result) && (result.success === true || result.success === false)) {
    const outcome: ToolResult = { success: result.success };
    if (isString(result.error)) {
      outcome.error = result.error;
    }
    if (isString(result.summary)) {
      outcome.summary = result.summary;
    }
    if (result.data !== undefined) {
      outcome.data = result.data;
    }
    call.result = outcome;
  }
  return call;
}

/**
 * Read a stored conversation as the current shape (specs/ai.md §3.13), or null when the value is
 * not a conversation at all (anything but an array).
 *
 * - An entry that is not a message (not an object, or with no known role) is dropped.
 * - A message stored without an id is given one, **once**: the caller saves what this returns, so the
 *   next read finds the id.
 * - A synthetic message is named by `meta.kind` rather than by its id's prefix (`ctx_summary_`,
 *   `sealed_`, `restored_`, `seeded_`); a kind already recorded is kept.
 * - An assistant message holding a call whose arguments do not parse, with no reply after it, is
 *   marked `meta.incomplete: "error"`: the reply was cut off mid-call.
 * - `blocks` and `meta` are carried as stored.
 *
 * It is idempotent, so it runs on every read and never needs a version marker.
 *
 * @param {JsonValue} raw - The stored value, as parsed
 * @param {MigrateOptions} options
 * @returns {LiveMessage[] | null}
 */
export function migrateTranscript(raw: JsonValue, options: MigrateOptions): LiveMessage[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const messages: LiveMessage[] = [];
  for (const stored of raw) {
    if (!isObject(stored) || !isRole(stored.role)) {
      continue;
    }
    const id = isString(stored.id) && stored.id !== "" ? stored.id : options.newId();
    const message: LiveMessage = {
      id,
      role: stored.role,
      content: isString(stored.content) ? stored.content : "",
      timestamp: isNumber(stored.timestamp) ? stored.timestamp : options.now(),
    };
    if (isString(stored.reasoningContent)) {
      message.reasoningContent = stored.reasoningContent;
    }
    if (Array.isArray(stored.toolCalls)) {
      message.toolCalls = stored.toolCalls.flatMap((call) => migrateCall(call) ?? []);
    }
    if (isString(stored.toolCallId)) {
      message.toolCallId = stored.toolCallId;
    }
    if (Array.isArray(stored.blocks)) {
      // A block this build cannot read is dropped: the v1 members beside it still say the message.
      message.blocks = stored.blocks.filter((block) => isBlock(block));
    }
    const meta: MessageMeta = isMeta(stored.meta) ? stored.meta : {};
    const kind = meta.kind ?? KIND_BY_PREFIX.find(([prefix]) => id.startsWith(prefix))?.[1];
    const named: MessageMeta = kind === undefined ? meta : { ...meta, kind };
    if (Object.keys(named).length > 0) {
      message.meta = named;
    }
    messages.push(message);
  }

  /* A call whose arguments do not parse, on a request nothing answered: the reply was cut off. The
     replies to a request are the `tool` messages directly after it, the one place the wire allows
     them. */
  for (const [index, message] of messages.entries()) {
    if (message.role !== "assistant" || !message.toolCalls || message.meta?.incomplete) {
      continue;
    }
    const answered = new Set<string>();
    for (const reply of messages.slice(index + 1)) {
      if (reply.role !== "tool") {
        break;
      }
      answered.add(reply.toolCallId ?? "");
    }
    if (message.toolCalls.some((call) => !answered.has(call.id) && !parses(call.arguments))) {
      message.meta = { ...message.meta, incomplete: "error" };
    }
  }
  return messages;
}

/**
 * The part of a conversation that is saved: its last `max` messages, starting at the first of them
 * that a person wrote. A window that began on a reply or a tool result would be a conversation no
 * provider accepts, and one whose first message answers something the reader cannot see. A window
 * holding no message from a person is kept whole, since there is nowhere better to begin.
 *
 * @param {readonly LiveMessage[]} messages
 * @param {number} max - The most messages kept
 * @returns {LiveMessage[]}
 */
export function persistWindow(messages: readonly LiveMessage[], max: number): LiveMessage[] {
  // `slice(-0)` is the whole array, so a window of none is said outright.
  const window = max > 0 ? messages.slice(-max) : [];
  if (window.length === messages.length) {
    return window;
  }
  const start = window.findIndex((message) => message.role === "user");
  return start > 0 ? window.slice(start) : window;
}

/**
 * A conversation's title, from the first thing a person wrote in it: its first non-empty line, with
 * runs of whitespace collapsed, cut to `maxChars` with an ellipsis. Text with no such line is the
 * default title.
 *
 * @param {string} firstUserText
 * @param {number} [maxChars] - The longest title, ellipsis included
 * @returns {string}
 */
export function sessionTitle(firstUserText: string, maxChars = 60): string {
  const line =
    firstUserText
      .split("\n")
      .map((candidate) => candidate.replaceAll(/\s+/g, " ").trim())
      .find((candidate) => candidate.length > 0) ?? "";
  if (!line) {
    return DEFAULT_SESSION_TITLE;
  }
  return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
}
