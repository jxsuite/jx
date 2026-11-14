/**
 * Tests for a persisted conversation (specs/ai.md §3.13): reading a stored transcript back as the
 * current shape, the window that is saved, the title, the write queue, and the in-memory store.
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import type { JsonValue } from "../src/core-types.ts";
import {
  DEFAULT_SESSION_TITLE,
  migrateTranscript,
  persistWindow,
  sessionTitle,
} from "../src/messages/index.ts";
import type { LiveMessage } from "../src/messages/index.ts";
import { createMemorySessionStore, createWriteQueue, SESSION_LIMITS } from "../src/sessions.ts";

/** Ids and times a migration fills in, counted so a test can see how many it needed. */
function fillers() {
  let ids = 0;
  let clock = 1000;
  return {
    minted: () => ids,
    newId: () => `new_${String((ids += 1))}`,
    now: () => (clock += 1),
  };
}

const user = (content: string, id = `u_${content}`, timestamp = 1): LiveMessage => ({
  content,
  id,
  role: "user",
  timestamp,
});

describe("migrateTranscript", () => {
  it.each<[string, JsonValue]>([
    ["null", null],
    ["an object", { messages: [] }],
    ["a string", "[]"],
    ["a number", 3],
  ])("answers null for %s, which is not a conversation", (_label, raw) => {
    expect(migrateTranscript(raw, fillers())).toBeNull();
  });

  it("reads the legacy shape: no ids, no timestamps", () => {
    const fill = fillers();
    const migrated = migrateTranscript(
      [
        { content: "Hello", role: "user" },
        { content: "Hi.", role: "assistant" },
      ],
      fill,
    );
    expect(migrated).toEqual([
      { content: "Hello", id: "new_1", role: "user", timestamp: 1001 },
      { content: "Hi.", id: "new_2", role: "assistant", timestamp: 1002 },
    ]);
    expect(fill.minted()).toBe(2);
  });

  it("reads the v1 shape with every member it carries", () => {
    const stored: JsonValue = [
      { content: "Do it", id: "u1", role: "user", timestamp: 5 },
      {
        content: "",
        id: "a1",
        reasoningContent: "Thinking.",
        role: "assistant",
        timestamp: 6,
        toolCalls: [
          { arguments: "{}", id: "c1", name: "probe", result: { success: true, summary: "ok" } },
          { arguments: "{}", id: "c2", name: "probe", result: null },
          { arguments: "{}", id: "c3", name: "probe" },
          {
            arguments: "{}",
            id: "c4",
            name: "probe",
            result: { data: { rows: 2 }, error: "No.", success: false },
          },
        ],
      },
      { content: '{"success":true}', id: "t1", role: "tool", timestamp: 7, toolCallId: "c1" },
      { content: "A note", id: "s1", role: "system", timestamp: 8 },
    ];
    const fill = fillers();
    expect(migrateTranscript(stored, fill)).toEqual([
      { content: "Do it", id: "u1", role: "user", timestamp: 5 },
      {
        content: "",
        id: "a1",
        reasoningContent: "Thinking.",
        role: "assistant",
        timestamp: 6,
        toolCalls: [
          { arguments: "{}", id: "c1", name: "probe", result: { success: true, summary: "ok" } },
          { arguments: "{}", id: "c2", name: "probe", result: null },
          { arguments: "{}", id: "c3", name: "probe" },
          {
            arguments: "{}",
            id: "c4",
            name: "probe",
            result: { data: { rows: 2 }, error: "No.", success: false },
          },
        ],
      },
      { content: '{"success":true}', id: "t1", role: "tool", timestamp: 7, toolCallId: "c1" },
      { content: "A note", id: "s1", role: "system", timestamp: 8 },
    ]);
    expect(fill.minted()).toBe(0);
  });

  it("carries the current shape's blocks and meta as stored", () => {
    const stored: JsonValue = [
      {
        blocks: [{ signature: "sig", text: "t", type: "reasoning" }],
        content: "",
        id: "a1",
        meta: { family: "anthropic", kind: "compaction" },
        role: "assistant",
        timestamp: 1,
      },
    ];
    expect(migrateTranscript(stored, fillers())).toEqual([
      {
        blocks: [{ signature: "sig", text: "t", type: "reasoning" }],
        content: "",
        id: "a1",
        meta: { family: "anthropic", kind: "compaction" },
        role: "assistant",
        timestamp: 1,
      },
    ]);
  });

  it("drops a block it cannot read, and keeps the ones it can", () => {
    const stored: JsonValue = [
      {
        blocks: [{ text: "kept", type: "text" }, { type: "image" }, "junk", { type: "text" }],
        content: "kept",
        id: "a1",
        role: "assistant",
        timestamp: 1,
      },
    ];
    expect(migrateTranscript(stored, fillers())![0]!.blocks).toEqual([
      { text: "kept", type: "text" },
    ]);
  });

  it("names a synthetic message's kind from its id, and keeps a kind already recorded", () => {
    const stored: JsonValue = [
      { content: "…", id: "ctx_summary_1", role: "user", timestamp: 1 },
      { content: "{}", id: "sealed_c1_0", role: "tool", timestamp: 1, toolCallId: "c1" },
      { content: "x", id: "restored_9", role: "user", timestamp: 1 },
      { content: "x", id: "seeded_9", role: "user", timestamp: 1 },
      { content: "x", id: "seeded_10", meta: { kind: "context" }, role: "user", timestamp: 1 },
      { content: "x", id: "msg_1", role: "user", timestamp: 1 },
    ];
    const kinds = migrateTranscript(stored, fillers())!.map((message) => message.meta?.kind);
    expect(kinds).toEqual(["ctx_summary", "sealed", "restored", "seeded", "context", undefined]);
  });

  it("marks a reply cut off mid-call, and leaves an answered or well-formed call alone", () => {
    const call = (id: string, args: string): JsonValue => ({ arguments: args, id, name: "probe" });
    const stored: JsonValue = [
      { content: "", id: "cut", role: "assistant", timestamp: 1, toolCalls: [call("c1", '{"a":')] },
      { content: "next", id: "u2", role: "user", timestamp: 2 },
      {
        content: "",
        id: "answered",
        role: "assistant",
        timestamp: 3,
        toolCalls: [call("c2", '{"a":'), call("c3", "{}")],
      },
      { content: "{}", id: "t2", role: "tool", timestamp: 4, toolCallId: "c2" },
      { content: "{}", id: "t3", role: "tool", timestamp: 4 },
      { content: "", id: "open", role: "assistant", timestamp: 5, toolCalls: [call("c4", "{}")] },
      {
        content: "",
        id: "known",
        meta: { incomplete: "truncated" },
        role: "assistant",
        timestamp: 6,
        toolCalls: [call("c5", "{")],
      },
    ];
    const migrated = migrateTranscript(stored, fillers())!;
    const incomplete = Object.fromEntries(
      migrated.map((message) => [message.id, message.meta?.incomplete]),
    );
    expect(incomplete).toEqual({
      answered: undefined,
      cut: "error",
      known: "truncated",
      open: undefined,
      t2: undefined,
      t3: undefined,
      u2: undefined,
    });
  });

  it("drops what is not a message, and reads a malformed member as its empty value", () => {
    const stored: JsonValue = [
      "text",
      null,
      [],
      { content: "no role" },
      { content: "x", role: "narrator" },
      {
        blocks: "none",
        content: 7,
        id: "",
        meta: "none",
        reasoningContent: 1,
        role: "assistant",
        timestamp: "now",
        toolCallId: 4,
        toolCalls: [
          "junk",
          { arguments: 1, id: 2, name: 3, result: { success: "yes" } },
          { arguments: "{}", id: "c", name: "n", result: "done" },
        ],
      },
    ];
    expect(migrateTranscript(stored, fillers())).toEqual([
      {
        content: "",
        id: "new_1",
        // Its first call's arguments are not JSON and nothing answered it: a reply cut off.
        meta: { incomplete: "error" },
        role: "assistant",
        timestamp: 1001,
        toolCalls: [
          { arguments: "", id: "", name: "" },
          { arguments: "{}", id: "c", name: "n" },
        ],
      },
    ]);
  });

  it("is idempotent: migrating what it returned changes nothing and mints nothing", () => {
    const stored: JsonValue = [
      { content: "Hello", role: "user" },
      { content: "", role: "assistant", toolCalls: [{ arguments: "{", id: "c", name: "n" }] },
      { content: "x", id: "ctx_summary_2", role: "user", timestamp: 3 },
    ];
    const once = migrateTranscript(stored, fillers())!;
    const fill = fillers();
    // What a store hands back on a read: the transcript's own JSON.
    // SAFETY: JSON.parse without a reviver yields nothing but a JSON value.
    // oxlint-disable-next-line unicorn/prefer-structured-clone -- the JSON form is what is stored
    const readBack = JSON.parse(JSON.stringify(once)) as JsonValue;
    const twice = migrateTranscript(readBack, fill);
    expect(twice).toEqual(once);
    expect(fill.minted()).toBe(0);
  });
});

describe("persistWindow", () => {
  const conversation = (roles: readonly LiveMessage["role"][]): LiveMessage[] =>
    roles.map((role, index) => ({
      content: `m${String(index)}`,
      id: `m${String(index)}`,
      role,
      timestamp: index,
    }));
  const contents = (messages: readonly LiveMessage[]) => messages.map((message) => message.content);

  it("keeps a conversation that fits, whatever it starts with", () => {
    const short = conversation(["assistant", "user"]);
    expect(persistWindow(short, 5)).toEqual(short);
    expect(persistWindow(short, 2)).toEqual(short);
  });

  it("keeps the last messages, moved on to the first a person wrote", () => {
    const long = conversation(["user", "assistant", "tool", "assistant", "user", "assistant"]);
    // The last four begin on a tool result; the window begins at the person's message instead.
    expect(contents(persistWindow(long, 4))).toEqual(["m4", "m5"]);
    // A window that already begins at one is kept as it is.
    expect(contents(persistWindow(long, 2))).toEqual(["m4", "m5"]);
  });

  it("keeps a window holding no message from a person whole", () => {
    const long = conversation(["user", "assistant", "tool", "assistant"]);
    expect(contents(persistWindow(long, 2))).toEqual(["m2", "m3"]);
  });

  it("keeps nothing for a window of none", () => {
    expect(persistWindow(conversation(["user"]), 0)).toEqual([]);
    expect(persistWindow(conversation(["user"]), -3)).toEqual([]);
  });
});

describe("sessionTitle", () => {
  it("is the first non-empty line, with runs of whitespace collapsed", () => {
    expect(sessionTitle("\n\n  Make   the\theading red \nsecond line")).toBe(
      "Make the heading red",
    );
  });

  it("is cut to the limit with an ellipsis", () => {
    const title = sessionTitle("x".repeat(80));
    expect(title).toHaveLength(60);
    expect(title.endsWith("…")).toBe(true);
    expect(sessionTitle("abcdefgh", 5)).toBe("abcd…");
    expect(sessionTitle("abcde", 5)).toBe("abcde");
  });

  it("is the default for text with no line to take", () => {
    expect(sessionTitle("")).toBe(DEFAULT_SESSION_TITLE);
    expect(sessionTitle(" \n\t\n")).toBe("New chat");
  });
});

describe("createWriteQueue", () => {
  it("starts a task at once when nothing is waiting, and is idle again after a synchronous one", async () => {
    const queue = createWriteQueue();
    const order: string[] = [];
    const first = queue.run(() => order.push("first"));
    const second = queue.run(() => order.push("second"));
    // Both ran before either promise was awaited.
    expect(order).toEqual(["first", "second"]);
    expect(await first).toBe(1);
    expect(await second).toBe(2);
  });

  it("runs a task only after the asynchronous ones queued before it have settled", async () => {
    const queue = createWriteQueue();
    const order: string[] = [];
    const gate = Promise.withResolvers<string>();
    const slow = queue.run(async () => {
      order.push("slow started");
      await gate.promise;
      order.push("slow finished");
      return "slow";
    });
    const after = queue.run(() => {
      order.push("after");
      return "after";
    });
    const last = queue.run(() => order.push("last"));
    expect(order).toEqual(["slow started"]);
    gate.resolve("open");
    expect(await Promise.all([slow, after, last])).toEqual(["slow", "after", 4]);
    expect(order).toEqual(["slow started", "slow finished", "after", "last"]);
    // Settled, the queue starts the next task at once again.
    void queue.run(() => order.push("idle again"));
    expect(order.at(-1)).toBe("idle again");
  });

  it("a task that fails rejects its own promise and does not hold up the next", async () => {
    const queue = createWriteQueue();
    const thrown = queue.run(() => {
      throw new Error("sync failure");
    });
    expect(thrown).rejects.toThrow("sync failure");
    const rejected = queue.run(() => Promise.reject(new Error("async failure")));
    const next = queue.run(() => "ran");
    expect(rejected).rejects.toThrow("async failure");
    expect(await next).toBe("ran");
  });
});

describe("createMemorySessionStore", () => {
  /** A store with a clock and ids a test can read. */
  function store() {
    let clock = 0;
    let ids = 0;
    return createMemorySessionStore({
      newId: () => `s${String((ids += 1))}`,
      now: () => (clock += 10),
    });
  }

  it("is not durable, and starts empty", async () => {
    const sessions = createMemorySessionStore();
    expect(sessions.durable).toBe(false);
    expect(await sessions.list("/p")).toEqual([]);
    expect(await sessions.getActive("/p")).toBeNull();
    expect(await sessions.load("/p", "none")).toBeNull();
    // Its own ids are distinct, with nothing supplied.
    const a = await sessions.create("/p", "a");
    const b = await sessions.create("/p", "b");
    expect(a.id).not.toBe(b.id);
  });

  it("creates a titled, active conversation, and saves and loads its window", async () => {
    const sessions = store();
    const meta = await sessions.create("/p", "  First ask\nmore");
    expect(meta).toEqual({
      createdAt: 10,
      id: "s1",
      messageCount: 0,
      title: "First ask",
      updatedAt: 10,
    });
    expect(await sessions.getActive("/p")).toBe("s1");
    expect(await sessions.load("/p", "s1")).toEqual([]);

    const messages = [user("First ask"), { ...user("reply", "a1", 2), role: "assistant" as const }];
    const saved = await sessions.save("/p", "s1", messages);
    expect(saved).toEqual({
      meta: { createdAt: 10, id: "s1", messageCount: 2, title: "First ask", updatedAt: 20 },
      ok: true,
    });
    const loaded = await sessions.load("/p", "s1");
    expect(loaded).toEqual(messages);
    // What is loaded is a copy: changing it changes nothing stored.
    loaded![0]!.content = "changed";
    expect((await sessions.load("/p", "s1"))![0]!.content).toBe("First ask");
  });

  it("titles a conversation created with nothing from the first thing a person says in it", async () => {
    const sessions = store();
    const meta = await sessions.create("/p", "");
    expect(meta.title).toBe(DEFAULT_SESSION_TITLE);
    const titleNow = async () => {
      const [listed] = await sessions.list("/p");
      return listed!.title;
    };
    await sessions.save("/p", meta.id, [{ ...user("x", "a0"), role: "assistant" }]);
    expect(await titleNow()).toBe(DEFAULT_SESSION_TITLE);
    await sessions.save("/p", meta.id, [user("Now a question")]);
    expect(await titleNow()).toBe("Now a question");
    // A title it already has is kept.
    await sessions.save("/p", meta.id, [user("Something else")]);
    expect(await titleNow()).toBe("Now a question");
  });

  it("saves only the window, and nothing for a conversation it does not list", async () => {
    const sessions = store();
    const meta = await sessions.create("/p", "long");
    const many = Array.from({ length: SESSION_LIMITS.messages + 5 }, (_, index) =>
      user(`m${String(index)}`),
    );
    const saved = await sessions.save("/p", meta.id, many);
    expect(saved).toMatchObject({ meta: { messageCount: SESSION_LIMITS.messages }, ok: true });
    expect((await sessions.load("/p", meta.id))![0]!.content).toBe("m5");

    expect(await sessions.save("/p", "ghost", many)).toEqual({
      message: "This conversation is no longer in the store, so it was not saved.",
      ok: false,
      reason: "not_in_index",
    });
    expect(await sessions.load("/p", "ghost")).toBeNull();
  });

  it("lists most recently updated first, and evicts the oldest past the limit", async () => {
    const sessions = store();
    const first = await sessions.create("/p", "first");
    for (let index = 1; index < SESSION_LIMITS.sessions; index += 1) {
      await sessions.create("/p", `chat ${String(index)}`);
    }
    // Saving the first makes it the most recent, so the second is now the oldest.
    await sessions.save("/p", first.id, [user("first")]);
    const [newest] = await sessions.list("/p");
    expect(newest!.id).toBe(first.id);
    await sessions.create("/p", "one more");
    const listed = await sessions.list("/p");
    expect(listed).toHaveLength(SESSION_LIMITS.sessions);
    expect(listed.map((meta) => meta.id)).not.toContain("s2");
    expect(await sessions.load("/p", "s2")).toBeNull();
    expect(listed.map((meta) => meta.id)).toContain(first.id);
  });

  it("removes a conversation, clearing the active one only when it was that one", async () => {
    const sessions = store();
    const a = await sessions.create("/p", "a");
    const b = await sessions.create("/p", "b");
    await sessions.remove("/p", a.id);
    expect(await sessions.getActive("/p")).toBe(b.id);
    await sessions.remove("/p", b.id);
    expect(await sessions.getActive("/p")).toBeNull();
    expect(await sessions.list("/p")).toEqual([]);
    await sessions.setActive("/p", "anything");
    expect(await sessions.getActive("/p")).toBe("anything");
  });

  it("moves a conversation between roots, and repeating the move changes nothing", async () => {
    const sessions = store();
    const meta = await sessions.create("", "bootstrap");
    await sessions.save("", meta.id, [user("bootstrap")]);
    await sessions.move("", "/p", meta.id);
    expect(await sessions.list("")).toEqual([]);
    expect(await sessions.getActive("")).toBeNull();
    expect(await sessions.getActive("/p")).toBe(meta.id);
    expect(await sessions.load("/p", meta.id)).toEqual([user("bootstrap")]);

    await sessions.move("", "/p", meta.id);
    await sessions.move("/p", "/p", meta.id);
    await sessions.move("/p", "/q", "ghost");
    expect(await sessions.list("/p")).toHaveLength(1);
    expect(await sessions.list("/q")).toEqual([]);
  });

  it("a move leaves the source's other active conversation alone", async () => {
    const sessions = store();
    const moved = await sessions.create("", "moved");
    const kept = await sessions.create("", "kept");
    const resident = await sessions.create("/p", "already here");
    await sessions.move("", "/p", moved.id);
    expect(await sessions.getActive("")).toBe(kept.id);
    // The target keeps what it had, and the moved conversation becomes its active one.
    const listed = await sessions.list("/p");
    expect(listed.map((meta) => meta.id).toSorted()).toEqual([moved.id, resident.id].toSorted());
    expect(await sessions.getActive("/p")).toBe(moved.id);
  });
});
