/// <reference lib="dom" />
/**
 * Ai-session-store.js — project-scoped multi-session chat history in localStorage.
 *
 * Pure storage CRUD for the assistant's conversations: a small index of session metadata plus one
 * payload key per session, so per-send writes touch a single conversation. No reactivity and no
 * chat-state knowledge — document-assistant owns the live session; this module only loads/saves
 * plain message arrays.
 *
 * Cross-window note: multiple studio windows share these keys; index writes are last-write-wins,
 * which is accepted for chat history.
 *
 * **Two surfaces, one store** (specs/ai.md §3.13). The functions below are synchronous, because
 * localStorage is, and the assistant restores a conversation with them at construction.
 * {@link localSessionStore} is the same store behind `@jxsuite/ai/sessions`'s asynchronous
 * `SessionStore`, with its operations serialized: it is what the assistant writes through, and the
 * seam a slower store (IndexedDB, a desktop application's files) replaces without the assistant
 * changing.
 *
 * - A save **reports** how it went (`SaveResult`) instead of swallowing a full or missing store.
 * - Every read goes through `migrateTranscript`, so the three generations of payload in people's
 *   browsers all load as the current shape, and what is saved is `persistWindow`'s window.
 * - A payload stays a bare array that an older build can load: `blocks` and `meta` are additive.
 *
 * @license MIT
 * @docs studio/ai/chat
 */

import { createWriteQueue, SESSION_LIMITS } from "@jxsuite/ai/sessions";
import type { SaveResult, SessionMeta, SessionStore } from "@jxsuite/ai/sessions";
import {
  DEFAULT_SESSION_TITLE,
  migrateTranscript,
  persistWindow,
  sessionTitle,
} from "@jxsuite/ai/messages";
import type { JsonObject, JsonValue, LiveMessage } from "@jxsuite/ai/messages";
import { isString } from "@jxsuite/schema/guards";

export type { SaveResult, SessionMeta } from "@jxsuite/ai/sessions";

const INDEX_KEY_PREFIX = "jx-ai-chat-sessions";
const PAYLOAD_KEY_PREFIX = "jx-ai-chat-session";
const LEGACY_KEY_PREFIX = "jx-ai-chat-history";

/** Most sessions kept per project — oldest by updatedAt evicted beyond this. */
export const MAX_SESSIONS = SESSION_LIMITS.sessions;
/** Most messages persisted per session (matches the pre-session store's cap). */
export const MAX_PERSIST_MESSAGES = SESSION_LIMITS.messages;

const DEFAULT_TITLE = DEFAULT_SESSION_TITLE;

interface SessionIndex {
  version: 1;
  activeId: string | null;
  /** Sorted by updatedAt descending. */
  sessions: SessionMeta[];
}

/** The persisted message shape — structurally the chat-state Message JSON. */
export interface PersistedMessage {
  id?: string;
  role: string;
  content: string;
  /**
   * A thinking model's chain-of-thought for the turn. Persisted because the provider requires it
   * back: a restored DeepSeek conversation whose reasoning was dropped on the way to storage is one
   * the next send cannot replay (see `@jxsuite/ai`'s `toMessagesArray`).
   */
  reasoningContent?: string;
  toolCalls?: unknown[];
  toolCallId?: string;
  timestamp?: number;
}

// ─── Keys ───────────────────────────────────────────────────────────────────

/** Project-scoped index key; falls back to a shared key when no project is open. */
function indexKey(root: string) {
  return root ? `${INDEX_KEY_PREFIX}:${root}` : INDEX_KEY_PREFIX;
}

function payloadKey(root: string, id: string) {
  return root ? `${PAYLOAD_KEY_PREFIX}:${root}:${id}` : `${PAYLOAD_KEY_PREFIX}:${id}`;
}

function legacyKey(root: string) {
  return root ? `${LEGACY_KEY_PREFIX}:${root}` : LEGACY_KEY_PREFIX;
}

// ─── Storage helpers (defensive: quota/unavailable/corrupt → absent) ────────

/** `localStorage`, or `undefined` on a host that has none (a worker, a test run without a DOM). */
function storage(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/**
 * A key's parsed value, or null when there is none, it is not JSON, or there is no store. A reader
 * checks what it gets: a value can be corrupt, or written by a build that is not this one.
 */
function readJson(key: string): JsonValue | null {
  try {
    const raw = storage()?.getItem(key);
    /* SAFETY: JSON.parse without a reviver yields nothing but a JSON value. */
    return raw ? (JSON.parse(raw) as JsonValue) : null;
  } catch {
    return null;
  }
}

/** How a write went: written, refused because the store is full, or no store to write to. */
type WriteOutcome = "ok" | "quota" | "unavailable";

function writeJson(key: string, value: SessionIndex | readonly PersistedMessage[]): WriteOutcome {
  const store = storage();
  if (!store) {
    return "unavailable";
  }
  try {
    store.setItem(key, JSON.stringify(value));
    return "ok";
  } catch {
    // A store that throws on a write is full (`QuotaExceededError`), or refusing every write.
    return "quota";
  }
}

function removeKey(key: string) {
  try {
    storage()?.removeItem(key);
  } catch {
    /* Ignore */
  }
}

/** True when a stored value is an object whose members may be read. */
function isRecord(value: JsonValue | null | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A fresh message id for a payload entry stored without one. */
function restoredId(): string {
  return `restored_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** What `migrateTranscript` is given to fill what an old payload lacks. */
const MIGRATION = { newId: restoredId, now: () => Date.now() };

// ─── Index ──────────────────────────────────────────────────────────────────

function emptyIndex(): SessionIndex {
  return { version: 1, activeId: null, sessions: [] };
}

/**
 * Read the session index for a project, migrating the pre-session single-conversation store
 * (`jx-ai-chat-history:<root>`) into the first session on first access.
 */
function readIndex(root: string): SessionIndex {
  const stored = readJson(indexKey(root));
  if (isSessionIndex(stored)) {
    const index: SessionIndex = stored;
    return { ...emptyIndex(), ...index };
  }
  return migrateLegacy(root) ?? emptyIndex();
}

/**
 * True when a stored value is a session index: an object holding a `sessions` list. An index is
 * written only by `writeIndex`; each entry's members are display text and the numbers the list
 * sorts by, and a value with no such list (corrupt, or foreign) is treated as absent.
 */
function isSessionIndex(value: JsonValue | null): value is JsonObject & SessionIndex {
  return isRecord(value) && Array.isArray(value.sessions);
}

function writeIndex(root: string, index: SessionIndex): WriteOutcome {
  index.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return writeJson(indexKey(root), index);
}

/**
 * Convert a legacy single-conversation store into a one-session index, if present.
 *
 * The legacy key is removed only once the session it became has been written, payload and index
 * both: a store too full to take the migrated copy keeps the original, and the migration runs again
 * on the next read rather than losing the conversation. A key holding nothing to migrate is removed
 * at once.
 */
function migrateLegacy(root: string): SessionIndex | null {
  const msgs = migrateTranscript(readJson(legacyKey(root)), MIGRATION);
  if (!msgs || msgs.length === 0) {
    removeKey(legacyKey(root));
    return null;
  }
  const timestamps = msgs.map((m) => m.timestamp);
  const firstUser = msgs.find((m) => m.role === "user");
  const window = persistWindow(msgs, MAX_PERSIST_MESSAGES);
  const meta: SessionMeta = {
    id: newSessionId(),
    title: deriveTitle(firstUser?.content ?? ""),
    createdAt: Math.min(...timestamps),
    updatedAt: Math.max(...timestamps),
    messageCount: window.length,
  };
  const index: SessionIndex = { version: 1, activeId: meta.id, sessions: [meta] };
  if (writeJson(payloadKey(root, meta.id), window) !== "ok" || writeIndex(root, index) !== "ok") {
    removeKey(payloadKey(root, meta.id));
    return null;
  }
  removeKey(legacyKey(root));
  return index;
}

// ─── Public API ─────────────────────────────────────────────────────────────

function newSessionId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Derive a session title from its first user message: first non-empty line, whitespace-collapsed,
 * capped at 60 characters. It is `sessionTitle` from `@jxsuite/ai/messages`, which every store
 * titles a conversation with.
 *
 * @param {string} text
 * @returns {string}
 */
export function deriveTitle(text: string): string {
  return sessionTitle(text, SESSION_LIMITS.titleChars);
}

/** List a project's sessions, most recently updated first. */
export function listSessions(root: string): SessionMeta[] {
  return readIndex(root).sessions;
}

/** The session restored on startup, or null for a fresh unsaved chat. */
export function getActiveSessionId(root: string): string | null {
  return readIndex(root).activeId;
}

/** Point the index at the session to restore next startup (null = fresh chat). */
export function setActiveSession(root: string, id: string | null) {
  const index = readIndex(root);
  index.activeId = id;
  writeIndex(root, index);
}

/**
 * Create a new session (as the active one), evicting the oldest sessions beyond
 * {@link MAX_SESSIONS}. The title derives from the first user message when given.
 */
export function createSession(root: string, firstUserText?: string): SessionMeta {
  const index = readIndex(root);
  const now = Date.now();
  const meta: SessionMeta = {
    id: newSessionId(),
    title: deriveTitle(firstUserText ?? ""),
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
  index.sessions.unshift(meta);
  while (index.sessions.length > MAX_SESSIONS) {
    let oldest = 0;
    for (let i = 1; i < index.sessions.length; i++) {
      if (index.sessions[i]!.updatedAt < index.sessions[oldest]!.updatedAt) {
        oldest = i;
      }
    }
    const [evicted] = index.sessions.splice(oldest, 1);
    removeKey(payloadKey(root, evicted!.id));
  }
  index.activeId = meta.id;
  writeIndex(root, index);
  return meta;
}

/**
 * Load a session's messages in the current shape, or null when it doesn't exist / is corrupt.
 *
 * Every read is migrated (specs/ai.md §3.13). A message stored without an id is given one, and the
 * payload is written back so the id it was given is the id it keeps.
 */
export function loadSession(root: string, id: string): LiveMessage[] | null {
  const raw = readJson(payloadKey(root, id));
  const msgs = migrateTranscript(raw, MIGRATION);
  if (!msgs) {
    return null;
  }
  const minted = Array.isArray(raw) && raw.some((entry) => isRecord(entry) && !isString(entry.id));
  if (minted) {
    writeJson(payloadKey(root, id), msgs);
  }
  return msgs;
}

/** What a save that could not be written tells the author. */
const SAVE_FAILED = {
  not_in_index: "This conversation is no longer in the list of chats, so it was not saved.",
  quota:
    "This browser's storage is full, so the conversation was not saved. Delete older chats to make room.",
  unavailable: "This browser has no storage available, so the conversation is not being saved.",
} as const;

/**
 * Persist a session's messages and refresh its index entry (updatedAt, messageCount, and the title
 * while still the default), and say how it went.
 *
 * What is written is the conversation's window: its last {@link MAX_PERSIST_MESSAGES} messages,
 * starting at one a person wrote. A session that is not in the index is **not written**: it was
 * deleted (or never created), and a save that landed after the delete would bring its payload back
 * with nothing to list it under.
 */
export function saveSession(
  root: string,
  id: string,
  messages: readonly PersistedMessage[],
): SaveResult {
  const refused = (reason: keyof typeof SAVE_FAILED): SaveResult => ({
    message: SAVE_FAILED[reason],
    ok: false,
    reason,
  });
  if (!storage()) {
    return refused("unavailable");
  }
  const index = readIndex(root);
  const meta = index.sessions.find((s) => s.id === id);
  if (!meta) {
    return refused("not_in_index");
  }
  /* SAFETY: a caller's messages are the live chat's (document-assistant's `persistChat`), each a
     LiveMessage but for the tool-call results it strips; the window only reads `role`. */
  const window = persistWindow(messages as readonly LiveMessage[], MAX_PERSIST_MESSAGES);
  const wrote = writeJson(payloadKey(root, id), window);
  if (wrote !== "ok") {
    return refused(wrote);
  }
  meta.updatedAt = Date.now();
  meta.messageCount = window.length;
  if (meta.title === DEFAULT_TITLE) {
    const firstUser = window.find((m) => m.role === "user");
    if (firstUser) {
      meta.title = deriveTitle(firstUser.content);
    }
  }
  const indexed = writeIndex(root, index);
  return indexed === "ok" ? { meta: { ...meta }, ok: true } : refused(indexed);
}

/** Delete a session's payload and index entry; clears activeId when it was active. */
export function deleteSession(root: string, id: string) {
  removeKey(payloadKey(root, id));
  const index = readIndex(root);
  index.sessions = index.sessions.filter((s) => s.id !== id);
  if (index.activeId === id) {
    index.activeId = null;
  }
  writeIndex(root, index);
}

/**
 * Move a session between roots — the bootstrap handoff: a chat started with no project (unscoped
 * root "") re-keys to the created project's root so `saveSession` keeps persisting it (it
 * early-returns when the target index has no meta for the id). The moved session becomes the target
 * root's active session. No-op when the session doesn't exist at `fromRoot`; delete-first ordering
 * keeps a re-run idempotent.
 */
export function moveSession(fromRoot: string, toRoot: string, id: string) {
  if (fromRoot === toRoot) {
    return;
  }
  const msgs = loadSession(fromRoot, id);
  const fromIndex = readIndex(fromRoot);
  const meta = fromIndex.sessions.find((s) => s.id === id);
  if (!msgs || !meta) {
    return;
  }

  deleteSession(fromRoot, id);

  writeJson(payloadKey(toRoot, id), msgs);
  const toIndex = readIndex(toRoot);
  toIndex.sessions = toIndex.sessions.filter((s) => s.id !== id);
  toIndex.sessions.unshift({ ...meta });
  toIndex.activeId = id;
  writeIndex(toRoot, toIndex);
}

// ─── The asynchronous store ─────────────────────────────────────────────────

/** The one queue this window's session writes go through, in the order they were asked for. */
const queue = createWriteQueue();

/**
 * This store behind the `SessionStore` contract of `@jxsuite/ai/sessions` (specs/ai.md §3.13).
 *
 * Every operation runs through one queue, so a save cannot land after the delete that followed it.
 * The queue starts an operation at once when nothing is waiting, and every operation here is
 * synchronous, so a caller that does not await still sees its write the moment the call returns.
 */
export const localSessionStore: SessionStore = {
  durable: true,
  create: (root, firstText) => queue.run(() => createSession(root, firstText)),
  getActive: (root) => queue.run(() => getActiveSessionId(root)),
  list: (root) => queue.run(() => listSessions(root)),
  load: (root, id) => queue.run(() => loadSession(root, id)),
  move: (fromRoot, toRoot, id) =>
    queue.run(() => {
      moveSession(fromRoot, toRoot, id);
    }),
  remove: (root, id) =>
    queue.run(() => {
      deleteSession(root, id);
    }),
  save: (root, id, messages) => queue.run(() => saveSession(root, id, messages)),
  setActive: (root, id) =>
    queue.run(() => {
      setActiveSession(root, id);
    }),
};
