/**
 * Tests for src/services/ai-session-store.ts — the project-scoped multi-session chat store:
 * index/payload round-trips, title derivation, ordering, caps/eviction, migration from the legacy
 * single-conversation key, and the defensive corrupt/quota paths.
 */
import "./harness";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  createSession,
  deleteSession,
  deriveTitle,
  getActiveSessionId,
  listSessions,
  loadSession,
  localSessionStore,
  MAX_PERSIST_MESSAGES,
  MAX_SESSIONS,
  saveSession,
  setActiveSession,
} from "../src/services/ai-session-store";
import type { LiveMessage } from "@jxsuite/ai/messages";

const ROOT = "/proj/demo";
const INDEX_KEY = `jx-ai-chat-sessions:${ROOT}`;
const LEGACY_KEY = `jx-ai-chat-history:${ROOT}`;

/** A message as the live chat holds one. `STAMP` is the timestamp of one that names none. */
const STAMP = Date.parse("2026-07-06T11:00:00Z");
function msg(role: LiveMessage["role"], content: string, timestamp = STAMP): LiveMessage {
  return { id: `m_${role}_${content.length}`, role, content, timestamp };
}

/**
 * Run `body` against a store that reads and removes as the real one does, and refuses the writes
 * `refuses` names with the error a full store throws.
 */
function withFullStorage(refuses: (key: string) => boolean, body: () => void) {
  const real = globalThis.localStorage;
  const fake = {
    getItem: (key: string) => real.getItem(key),
    removeItem: (key: string) => {
      real.removeItem(key);
    },
    setItem(key: string, value: string) {
      if (refuses(key)) {
        throw new DOMException("full", "QuotaExceededError");
      }
      real.setItem(key, value);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: fake,
    writable: true,
  });
  try {
    body();
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: real,
      writable: true,
    });
  }
}

beforeEach(() => {
  localStorage.clear();
  setSystemTime(new Date("2026-07-06T12:00:00Z"));
});

afterEach(() => {
  setSystemTime();
});

describe("deriveTitle", () => {
  test("uses the first non-empty line, whitespace-collapsed", () => {
    expect(deriveTitle("\n\n  Fix   the\theader \nsecond line")).toBe("Fix the header");
  });

  test("caps long titles with an ellipsis", () => {
    const title = deriveTitle("x".repeat(80));
    expect(title.length).toBe(60);
    expect(title.endsWith("…")).toBe(true);
  });

  test("falls back for empty/blank text", () => {
    expect(deriveTitle("")).toBe("New chat");
    expect(deriveTitle("  \n \n")).toBe("New chat");
  });
});

describe("session CRUD", () => {
  test("createSession adds an active session with derived title", () => {
    const meta = createSession(ROOT, "Build me a landing page");
    expect(meta.title).toBe("Build me a landing page");
    expect(getActiveSessionId(ROOT)).toBe(meta.id);
    expect(listSessions(ROOT)).toHaveLength(1);
    expect(listSessions(ROOT)[0]!.id).toBe(meta.id);
  });

  test("saveSession/loadSession round-trip and meta refresh", () => {
    const meta = createSession(ROOT);
    setSystemTime(new Date("2026-07-06T12:05:00Z"));
    const messages = [msg("user", "hello"), msg("assistant", "hi there")];
    const saved = saveSession(ROOT, meta.id, messages);

    expect(loadSession(ROOT, meta.id)).toEqual(messages);
    // The save says how it went, with the entry it refreshed.
    expect(saved).toEqual({ meta: listSessions(ROOT)[0]!, ok: true });
    const [listed] = listSessions(ROOT);
    expect(listed!.messageCount).toBe(2);
    expect(listed!.updatedAt).toBeGreaterThan(meta.createdAt);
    // Default title upgraded from the first user message on save.
    expect(listed!.title).toBe("hello");
  });

  test("saveSession keeps a non-default title", () => {
    const meta = createSession(ROOT, "Original ask");
    saveSession(ROOT, meta.id, [msg("user", "something else entirely")]);
    expect(listSessions(ROOT)[0]!.title).toBe("Original ask");
  });

  test("saveSession trims to MAX_PERSIST_MESSAGES", () => {
    const meta = createSession(ROOT);
    const many = Array.from({ length: MAX_PERSIST_MESSAGES + 10 }, (_, i) => msg("user", `m${i}`));
    saveSession(ROOT, meta.id, many);
    const loaded = loadSession(ROOT, meta.id)!;
    expect(loaded).toHaveLength(MAX_PERSIST_MESSAGES);
    expect(loaded[0]!.content).toBe("m10");
  });

  /* The window is the last fifty messages, and it begins at one a person wrote (specs/ai.md
     §3.13): a conversation that opened on a reply or a tool result is one no provider accepts. */
  test("the saved window starts at a message a person wrote", () => {
    const meta = createSession(ROOT);
    const many: LiveMessage[] = Array.from({ length: MAX_PERSIST_MESSAGES + 3 }, (_, i) =>
      msg(i % 4 === 0 ? "user" : "assistant", `m${i}`),
    );
    const saved = saveSession(ROOT, meta.id, many);
    const loaded = loadSession(ROOT, meta.id)!;
    // The last fifty begin at m3, a reply; the window moves on to m4, the next message of a person's.
    expect(loaded[0]).toMatchObject({ content: "m4", role: "user" });
    expect(loaded).toHaveLength(MAX_PERSIST_MESSAGES - 1);
    expect(saved).toMatchObject({ meta: { messageCount: MAX_PERSIST_MESSAGES - 1 }, ok: true });
  });

  /* A save for a conversation that is not listed writes nothing: it was deleted, and a payload
     that came back after the delete would have nothing to list it under. */
  test("saveSession with an unknown id writes nothing, and says so", () => {
    const result = saveSession(ROOT, "ghost", [msg("user", "boo")]);
    expect(result).toEqual({
      message: "This conversation is no longer in the list of chats, so it was not saved.",
      ok: false,
      reason: "not_in_index",
    });
    expect(loadSession(ROOT, "ghost")).toBeNull();
    expect(listSessions(ROOT)).toHaveLength(0);
  });

  test("loadSession returns null for missing or corrupt payloads", () => {
    expect(loadSession(ROOT, "nope")).toBeNull();
    localStorage.setItem(`jx-ai-chat-session:${ROOT}:bad`, "{not json");
    expect(loadSession(ROOT, "bad")).toBeNull();
    localStorage.setItem(`jx-ai-chat-session:${ROOT}:obj`, '{"a":1}');
    expect(loadSession(ROOT, "obj")).toBeNull();
  });

  test("listSessions orders by updatedAt descending", () => {
    const a = createSession(ROOT, "a");
    setSystemTime(new Date("2026-07-06T12:01:00Z"));
    const b = createSession(ROOT, "b");
    setSystemTime(new Date("2026-07-06T12:02:00Z"));
    saveSession(ROOT, a.id, [msg("user", "a again")]);
    expect(listSessions(ROOT).map((s) => s.id)).toEqual([a.id, b.id]);
  });

  test("deleteSession removes payload + entry and clears activeId when active", () => {
    const a = createSession(ROOT, "a");
    saveSession(ROOT, a.id, [msg("user", "hi")]);
    deleteSession(ROOT, a.id);
    expect(listSessions(ROOT)).toHaveLength(0);
    expect(loadSession(ROOT, a.id)).toBeNull();
    expect(getActiveSessionId(ROOT)).toBeNull();
  });

  test("deleteSession keeps activeId when deleting another session", () => {
    const a = createSession(ROOT, "a");
    setSystemTime(new Date("2026-07-06T12:01:00Z"));
    const b = createSession(ROOT, "b");
    deleteSession(ROOT, a.id);
    expect(getActiveSessionId(ROOT)).toBe(b.id);
  });

  test("setActiveSession round-trips including null", () => {
    const a = createSession(ROOT, "a");
    setActiveSession(ROOT, null);
    expect(getActiveSessionId(ROOT)).toBeNull();
    setActiveSession(ROOT, a.id);
    expect(getActiveSessionId(ROOT)).toBe(a.id);
  });

  test("evicts the oldest session beyond MAX_SESSIONS", () => {
    const first = createSession(ROOT, "first");
    saveSession(ROOT, first.id, [msg("user", "first")]);
    for (let i = 1; i < MAX_SESSIONS; i++) {
      setSystemTime(new Date(Date.parse("2026-07-06T12:00:00Z") + i * 60_000));
      createSession(ROOT, `chat ${i}`);
    }
    expect(listSessions(ROOT)).toHaveLength(MAX_SESSIONS);

    setSystemTime(new Date("2026-07-06T13:00:00Z"));
    createSession(ROOT, "one too many");
    const sessions = listSessions(ROOT);
    expect(sessions).toHaveLength(MAX_SESSIONS);
    expect(sessions.some((s) => s.id === first.id)).toBe(false);
    expect(loadSession(ROOT, first.id)).toBeNull();
  });
});

describe("legacy migration", () => {
  test("migrates the single-conversation key into the first session", () => {
    const legacy = [msg("user", "old question", 1000), msg("assistant", "old answer", 2000)];
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));

    const sessions = listSessions(ROOT);
    expect(sessions).toHaveLength(1);
    const [meta] = sessions;
    expect(meta!.title).toBe("old question");
    expect(meta!.createdAt).toBe(1000);
    expect(meta!.updatedAt).toBe(2000);
    expect(meta!.messageCount).toBe(2);
    expect(getActiveSessionId(ROOT)).toBe(meta!.id);
    expect(loadSession(ROOT, meta!.id)).toEqual(legacy);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  test("ignores an empty or corrupt legacy store (and still removes it)", () => {
    localStorage.setItem(LEGACY_KEY, "[]");
    expect(listSessions(ROOT)).toHaveLength(0);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

    localStorage.setItem(LEGACY_KEY, "{corrupt");
    expect(listSessions(ROOT)).toHaveLength(0);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  test("does not migrate once an index exists", () => {
    createSession(ROOT, "current");
    localStorage.setItem(LEGACY_KEY, JSON.stringify([msg("user", "stale", 1)]));
    expect(listSessions(ROOT)).toHaveLength(1);
    expect(listSessions(ROOT)[0]!.title).toBe("current");
    // Legacy key is left alone until an index-miss read; harmless either way.
  });

  test("legacy messages without timestamps fall back to now", () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([{ content: "untimed", id: "m", role: "user" }]),
    );
    const [meta] = listSessions(ROOT);
    expect(meta!.createdAt).toBe(Date.now());
    expect(meta!.updatedAt).toBe(Date.now());
    // The message is stamped with the same instant, so every restored message has a timestamp.
    expect(loadSession(ROOT, meta!.id)).toEqual([
      { content: "untimed", id: "m", role: "user", timestamp: Date.now() },
    ]);
  });

  /* The legacy key is the only copy until the session it becomes has been written. A store too
     full to take that copy keeps the original, so the next read migrates it instead of losing it. */
  test("keeps the legacy store when the migrated session cannot be written", () => {
    const legacy = [msg("user", "old question", 1000), msg("assistant", "old answer", 2000)];
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    withFullStorage(
      () => true,
      () => {
        expect(listSessions(ROOT)).toHaveLength(0);
      },
    );
    expect(JSON.parse(localStorage.getItem(LEGACY_KEY)!)).toEqual(legacy);
    // No half-written session is left behind, and with room again the migration completes.
    expect(Object.keys(localStorage)).toEqual([LEGACY_KEY]);
    expect(listSessions(ROOT)).toHaveLength(1);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});

describe("reading a stored conversation", () => {
  /* Every read is migrated (specs/ai.md §3.13), so an old payload loads as the current shape. */
  test("a message stored without an id is given one once, and keeps it", () => {
    const meta = createSession(ROOT, "ids");
    const key = `jx-ai-chat-session:${ROOT}:${meta.id}`;
    localStorage.setItem(
      key,
      JSON.stringify([
        { content: "no id", role: "user", timestamp: 5 },
        { content: "has one", id: "kept", role: "assistant", timestamp: 6 },
      ]),
    );
    const first = loadSession(ROOT, meta.id)!;
    expect(first[0]!.id).toMatch(/^restored_/);
    expect(first[0]!.meta).toEqual({ kind: "restored" });
    expect(first[1]).toEqual({ content: "has one", id: "kept", role: "assistant", timestamp: 6 });
    // The id was written back, so a second read finds the same one rather than minting another.
    expect(loadSession(ROOT, meta.id)).toEqual(first);
  });

  test("a payload with nothing to add is not written back", () => {
    const meta = createSession(ROOT, "stable");
    saveSession(ROOT, meta.id, [msg("user", "hello")]);
    const key = `jx-ai-chat-session:${ROOT}:${meta.id}`;
    const before = localStorage.getItem(key);
    loadSession(ROOT, meta.id);
    expect(localStorage.getItem(key)).toBe(before);
  });

  test("entries that are not messages are dropped, and a payload that is not a list is absent", () => {
    const meta = createSession(ROOT, "junk");
    const key = `jx-ai-chat-session:${ROOT}:${meta.id}`;
    localStorage.setItem(
      key,
      JSON.stringify(["text", null, { role: "narrator" }, msg("user", "kept")]),
    );
    expect(loadSession(ROOT, meta.id)).toEqual([msg("user", "kept")]);
    localStorage.setItem(key, JSON.stringify({ messages: [] }));
    expect(loadSession(ROOT, meta.id)).toBeNull();
  });
});

describe("a save that cannot be written", () => {
  test("a full store is reported as quota, and the entry is left as it was", () => {
    const meta = createSession(ROOT, "full");
    withFullStorage(
      () => true,
      () => {
        expect(saveSession(ROOT, meta.id, [msg("user", "hi")])).toEqual({
          message:
            "This browser's storage is full, so the conversation was not saved. Delete older chats to make room.",
          ok: false,
          reason: "quota",
        });
      },
    );
    expect(listSessions(ROOT)[0]!.messageCount).toBe(0);
  });

  test("a payload that was written but an index that was not is still a failed save", () => {
    const meta = createSession(ROOT, "half");
    withFullStorage(
      (key) => key === INDEX_KEY,
      () => {
        expect(saveSession(ROOT, meta.id, [msg("user", "hi")])).toMatchObject({
          ok: false,
          reason: "quota",
        });
      },
    );
  });

  test("a host with no storage is reported as unavailable", () => {
    const real = globalThis.localStorage;
    Reflect.deleteProperty(globalThis, "localStorage");
    try {
      expect(saveSession(ROOT, "any", [msg("user", "hi")])).toMatchObject({
        ok: false,
        reason: "unavailable",
      });
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: real,
        writable: true,
      });
    }
  });
});

describe("localSessionStore", () => {
  /* The same store behind the asynchronous contract (specs/ai.md §3.13). Its operations are
     synchronous underneath, so each write has landed by the time its call returns. */
  test("serves the SessionStore contract over the same keys", async () => {
    expect(localSessionStore.durable).toBe(true);
    const created = localSessionStore.create(ROOT, "First ask");
    // Not awaited yet, and already written.
    expect(listSessions(ROOT)).toHaveLength(1);
    const meta = await created;
    expect(await localSessionStore.getActive(ROOT)).toBe(meta.id);

    const saved = await localSessionStore.save(ROOT, meta.id, [msg("user", "First ask")]);
    expect(saved).toMatchObject({ meta: { id: meta.id, messageCount: 1 }, ok: true });
    expect(await localSessionStore.load(ROOT, meta.id)).toEqual([msg("user", "First ask")]);
    expect(await localSessionStore.list(ROOT)).toEqual(listSessions(ROOT));

    await localSessionStore.setActive(ROOT, null);
    expect(getActiveSessionId(ROOT)).toBeNull();

    await localSessionStore.move(ROOT, "/proj/other", meta.id);
    expect(listSessions(ROOT)).toHaveLength(0);
    expect(getActiveSessionId("/proj/other")).toBe(meta.id);

    await localSessionStore.remove("/proj/other", meta.id);
    expect(await localSessionStore.load("/proj/other", meta.id)).toBeNull();
  });

  test("a save asked for before a delete does not bring the conversation back", async () => {
    const meta = await localSessionStore.create(ROOT, "going");
    const saving = localSessionStore.save(ROOT, meta.id, [msg("user", "going")]);
    const removing = localSessionStore.remove(ROOT, meta.id);
    const late = localSessionStore.save(ROOT, meta.id, [msg("user", "going")]);
    await Promise.all([saving, removing]);
    expect(await late).toMatchObject({ ok: false, reason: "not_in_index" });
    expect(loadSession(ROOT, meta.id)).toBeNull();
    expect(Object.keys(localStorage).some((key) => key.includes(meta.id))).toBe(false);
  });
});

describe("defensive paths", () => {
  test("corrupt index JSON is treated as absent", () => {
    localStorage.setItem(INDEX_KEY, "{corrupt");
    expect(listSessions(ROOT)).toHaveLength(0);
    const meta = createSession(ROOT, "fresh start");
    expect(listSessions(ROOT)[0]!.id).toBe(meta.id);
  });

  test("index without a sessions array is treated as absent", () => {
    localStorage.setItem(INDEX_KEY, '{"version":1}');
    expect(listSessions(ROOT)).toHaveLength(0);
  });

  test("no-root fallback uses unscoped keys", () => {
    const meta = createSession("", "rootless");
    saveSession("", meta.id, [msg("user", "hi")]);
    expect(localStorage.getItem("jx-ai-chat-sessions")).toBeTruthy();
    expect(localStorage.getItem(`jx-ai-chat-session:${meta.id}`)).toBeTruthy();
    expect(loadSession("", meta.id)).toHaveLength(1);
  });

  test("throwing storage is swallowed", () => {
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem() {
          throw new Error("quota");
        },
        setItem() {
          throw new Error("quota");
        },
        removeItem() {
          throw new Error("quota");
        },
        clear() {
          throw new Error("quota");
        },
      },
      writable: true,
    });
    try {
      expect(listSessions(ROOT)).toHaveLength(0);
      const meta = createSession(ROOT, "quota");
      saveSession(ROOT, meta.id, [msg("user", "hi")]);
      deleteSession(ROOT, meta.id);
      expect(loadSession(ROOT, meta.id)).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: real,
        writable: true,
      });
    }
  });
});

describe("moveSession — bootstrap re-keying", () => {
  test("moves a session from the unscoped store to a project root and activates it", async () => {
    const { moveSession } = await import("../src/services/ai-session-store");
    const meta = createSession("", "build me a site");
    saveSession("", meta.id, [msg("user", "build me a site"), msg("assistant", "on it")]);

    moveSession("", ROOT, meta.id);

    // Gone from the source store…
    expect(listSessions("").some((s) => s.id === meta.id)).toBe(false);
    expect(loadSession("", meta.id)).toBeNull();
    // …present, loadable, and active at the target root with its meta intact.
    const moved = listSessions(ROOT).find((s) => s.id === meta.id);
    expect(moved?.title).toBe("build me a site");
    expect(getActiveSessionId(ROOT)).toBe(meta.id);
    expect(loadSession(ROOT, meta.id)?.map((m) => m.content)).toEqual(["build me a site", "on it"]);
    // SaveSession keeps working against the new root (the whole point of the move).
    saveSession(ROOT, meta.id, [msg("user", "build me a site"), msg("assistant", "done")]);
    expect(listSessions(ROOT).find((s) => s.id === meta.id)?.messageCount).toBe(2);
  });

  test("is a no-op for unknown sessions, same roots, and repeated moves", async () => {
    const { moveSession } = await import("../src/services/ai-session-store");
    expect(() => moveSession("", ROOT, "ghost")).not.toThrow();
    expect(listSessions(ROOT)).toHaveLength(0);

    const meta = createSession(ROOT, "hello");
    saveSession(ROOT, meta.id, [msg("user", "hello")]);
    moveSession(ROOT, ROOT, meta.id);
    expect(listSessions(ROOT)).toHaveLength(1);

    moveSession("", ROOT, meta.id); // Source doesn't hold it → no-op, target untouched.
    expect(listSessions(ROOT)).toHaveLength(1);
    expect(loadSession(ROOT, meta.id)).not.toBeNull();
  });
});
