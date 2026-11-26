/**
 * Host-level edge cases driven through raw {@link RoomSocket} frames (no client): malformed frames,
 * doc-sync against unknown rooms or stale epochs, unknown y-protocols message types, malformed
 * awareness payloads, and opens abandoned while their room is still seeding.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as encoding from "lib0/encoding";
import { createCollabHost } from "../src/ws-room.ts";
import type { CollabHost, CollabHostOptions, RoomSocket } from "../src/ws-room.ts";
import { decodeFrame, encodeFrame } from "../src/envelope.ts";
import type { CollabFrame, ControlMessage } from "../src/envelope.ts";
import type { CollabIdentity } from "../src/provider.ts";

const IDENTITY: CollabIdentity = { color: "#4f9cf9", login: "octocat", permission: "write" };

/** A server-side socket that decodes every outbound frame into an inspectable log. */
function recordingSocket() {
  const frames: CollabFrame[] = [];
  const socket: RoomSocket = {
    close: () => {},
    send: (data) => {
      frames.push(decodeFrame(data));
    },
  };
  return { frames, socket };
}

function controls(frames: CollabFrame[]): ControlMessage[] {
  return frames.flatMap((frame) => (frame.type === "control" ? [frame.message] : []));
}

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

const cleanups: (() => void)[] = [];

function makeHost(
  loadSource: (path: string) => Promise<string | null>,
  rest: Omit<CollabHostOptions, "loadSource"> = {},
): CollabHost {
  const host = createCollabHost({ ...rest, loadSource });
  cleanups.push(() => host.destroy());
  return host;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

describe("malformed input", () => {
  test("an undecodable frame answers with an unknown-frame error", () => {
    const host = makeHost(() => Promise.resolve("x"));
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, IDENTITY);
    conn.handleMessage(new Uint8Array([9]));
    expect(controls(frames).at(-1)).toEqual({
      code: "unknown-frame",
      message: "Malformed frame",
      type: "error",
    });
  });

  test("a malformed awareness payload is dropped without relaying", () => {
    const host = makeHost(() => Promise.resolve("x"));
    const sender = recordingSocket();
    const receiver = recordingSocket();
    const conn = host.connect(sender.socket, IDENTITY);
    host.connect(receiver.socket, { color: "#fff", login: "peer", permission: "write" });
    const before = receiver.frames.length;
    // Announces one clientID, then truncates before its clock — the tracking decode throws.
    conn.handleMessage(encodeFrame({ body: new Uint8Array([1]), type: "awareness" }));
    expect(receiver.frames.length).toBe(before);
  });
});

describe("doc-sync guards", () => {
  test("doc-sync for a never-opened path answers doc-reset at the known epoch", () => {
    const host = makeHost(() => Promise.resolve("x"));
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, IDENTITY);
    conn.handleMessage(
      encodeFrame({ body: new Uint8Array([0]), epoch: 0, path: "a.json", type: "doc-sync" }),
    );
    expect(controls(frames).at(-1)).toEqual({ epoch: 0, path: "a.json", type: "doc-reset" });
  });

  test("doc-sync at a stale epoch answers doc-reset", async () => {
    const host = makeHost(() => Promise.resolve("x"));
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, IDENTITY);
    conn.handleMessage(encodeFrame({ message: { path: "a.json", type: "open" }, type: "control" }));
    await settle();
    expect(controls(frames).some((message) => message.type === "opened")).toBe(true);
    conn.handleMessage(
      encodeFrame({ body: new Uint8Array([0]), epoch: 7, path: "a.json", type: "doc-sync" }),
    );
    expect(controls(frames).at(-1)).toEqual({ epoch: 0, path: "a.json", type: "doc-reset" });
  });

  test("resetDoc on a never-opened path still bumps the epoch", () => {
    const host = makeHost(() => Promise.resolve("x"));
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, IDENTITY);
    // No room exists yet for this path — resetDoc must still advance the epoch (a reset can
    // Arrive ahead of the first open) rather than touching a room that isn't there.
    host.resetDoc("never.json");
    conn.handleMessage(
      encodeFrame({ body: new Uint8Array([0]), epoch: 0, path: "never.json", type: "doc-sync" }),
    );
    expect(controls(frames).at(-1)).toEqual({ epoch: 1, path: "never.json", type: "doc-reset" });
  });

  test("an unknown y-protocols message type inside doc-sync is dropped", async () => {
    const host = makeHost(() => Promise.resolve("x"));
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, IDENTITY);
    conn.handleMessage(encodeFrame({ message: { path: "a.json", type: "open" }, type: "control" }));
    await settle();
    const body = encoding.createEncoder();
    encoding.writeVarUint(body, 42);
    const before = frames.length;
    conn.handleMessage(
      encodeFrame({
        body: encoding.toUint8Array(body),
        epoch: 0,
        path: "a.json",
        type: "doc-sync",
      }),
    );
    // No reply and no error: the frame is silently ignored.
    expect(frames.length).toBe(before);
  });
});

describe("opens abandoned mid-seed", () => {
  test("a connection that closes while its room seeds never subscribes", async () => {
    let release: (value: string | null) => void = () => {};
    const gate = new Promise<string | null>((resolve) => {
      release = resolve;
    });
    const host = makeHost(() => gate);
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, IDENTITY);
    conn.handleMessage(encodeFrame({ message: { path: "a.json", type: "open" }, type: "control" }));
    conn.close();
    release("seeded");
    await settle();
    expect(controls(frames).some((message) => message.type === "opened")).toBe(false);
    expect(host.subscriberCount("a.json")).toBe(0);
    // The room itself finished seeding — only the subscription was abandoned.
    expect(host.sourceOf("a.json")).toBe("seeded");
  });

  test("a room reset while its open is still seeding abandons the stale open", async () => {
    let release: (value: string | null) => void = () => {};
    const gate = new Promise<string | null>((resolve) => {
      release = resolve;
    });
    const host = makeHost(() => gate);
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, IDENTITY);
    conn.handleMessage(encodeFrame({ message: { path: "a.json", type: "open" }, type: "control" }));
    // Out-of-band replacement lands before the seed resolves: the room this open created is gone.
    host.resetDoc("a.json");
    release("late");
    await settle();
    expect(controls(frames).some((message) => message.type === "opened")).toBe(false);
    expect(host.subscriberCount("a.json")).toBe(0);
    expect(host.sourceOf("a.json")).toBeNull();
  });
});

describe("rooms keyed by document (keyOf)", () => {
  /** Open `path` on `conn` and wait for the room to answer. */
  async function open(conn: ReturnType<CollabHost["connect"]>, path: string): Promise<void> {
    conn.handleMessage(encodeFrame({ message: { path, type: "open" }, type: "control" }));
    await settle();
  }

  test("two paths naming one document share its room, each peer answered by its own path", async () => {
    const loads: [string, string][] = [];
    const flushed: string[] = [];
    const host = createCollabHost({
      keyOf: (path) => (path.endsWith(".md") ? "doc:1" : path),
      loadSource: (path, key) => {
        loads.push([path, key]);
        return Promise.resolve("seed");
      },
      onFlush: (key) => {
        flushed.push(key);
      },
    });
    cleanups.push(() => host.destroy());
    const old = recordingSocket();
    const moved = recordingSocket();
    const both = recordingSocket();
    const a = host.connect(old.socket, IDENTITY);
    const b = host.connect(moved.socket, IDENTITY);
    const c = host.connect(both.socket, IDENTITY);
    await open(a, "old.md");
    await open(b, "new.md");
    await open(c, "old.md");
    await open(c, "new.md");
    expect(loads).toEqual([["old.md", "doc:1"]]);
    expect(host.subscriberCount("doc:1")).toBe(3);
    expect(host.sourceOf("doc:1")).toBe("seed");

    host.conflict("doc:1", { diskHash: null, docId: "1" });
    const conflicts = (frames: CollabFrame[]) =>
      controls(frames).filter((message) => message.type === "doc-conflict");
    expect(conflicts(old.frames)).toEqual([
      { diskHash: null, docId: "1", path: "old.md", type: "doc-conflict" },
    ]);
    expect(conflicts(moved.frames)).toEqual([
      { diskHash: null, docId: "1", path: "new.md", type: "doc-conflict" },
    ]);
    expect(conflicts(both.frames).map((message) => message.path)).toEqual(["old.md", "new.md"]);

    // A flush names the room by whichever path the peer holds; one it never opened saves nothing,
    // And is refused (the acknowledgement carries the reason).
    b.handleMessage(encodeFrame({ message: { path: "new.md", type: "flush" }, type: "control" }));
    b.handleMessage(encodeFrame({ message: { path: "old.md", type: "flush" }, type: "control" }));
    await settle();
    expect(flushed).toEqual(["doc:1"]);
    expect(
      controls(moved.frames)
        .filter((message) => message.type === "flush-ack")
        .map((message) => message.path)
        .toSorted(),
    ).toEqual(["new.md", "old.md"]);

    // Closing one of a peer's two paths keeps it in the room; a reset reaches every path.
    c.handleMessage(encodeFrame({ path: "old.md", type: "doc-close" }));
    expect(host.subscriberCount("doc:1")).toBe(3);
    host.resetDoc("doc:1");
    expect(controls(both.frames).at(-1)).toEqual({ epoch: 1, path: "new.md", type: "doc-reset" });
    expect(host.sourceOf("doc:1")).toBeNull();
    host.conflict("doc:1", { diskHash: null, docId: null });
  });

  test("a path whose room changes key never goes back to a lower epoch", async () => {
    let key = "doc:1";
    const host = createCollabHost({
      keyOf: () => key,
      loadSource: () => Promise.resolve("seed"),
    });
    cleanups.push(() => host.destroy());
    const peer = recordingSocket();
    const conn = host.connect(peer.socket, IDENTITY);
    await open(conn, "a.md");
    host.resetDoc("doc:1");
    host.resetDoc("doc:1");
    key = "path:/a.md";
    // A frame for the path after the reset is refused at the path's epoch, not the new key's.
    conn.handleMessage(
      encodeFrame({ body: new Uint8Array([0]), epoch: 0, path: "a.md", type: "doc-sync" }),
    );
    expect(controls(peer.frames).at(-1)).toEqual({ epoch: 1, path: "a.md", type: "doc-reset" });
    await open(conn, "a.md");
    const opened = controls(peer.frames).filter((message) => message.type === "opened");
    expect(opened.map((message) => message.epoch)).toEqual([0, 1]);
  });
});

describe("revert (project-state.md §6.1)", () => {
  test("goes through the embedder's onRevert, for a path the connection opened", async () => {
    const reverted: string[] = [];
    const host = createCollabHost({
      keyOf: () => "doc:1",
      loadSource: () => Promise.resolve("# A\n"),
      onRevert: (key) => {
        reverted.push(key);
      },
    });
    cleanups.push(() => host.destroy());
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, IDENTITY);
    conn.handleMessage(encodeFrame({ message: { path: "a.md", type: "open" }, type: "control" }));
    await settle();
    conn.handleMessage(encodeFrame({ message: { path: "a.md", type: "revert" }, type: "control" }));
    // A path it never opened names no room of its: acknowledged, nothing reverted.
    conn.handleMessage(encodeFrame({ message: { path: "b.md", type: "revert" }, type: "control" }));
    await settle();
    expect(reverted).toEqual(["doc:1"]);
    expect(
      controls(frames)
        .filter((message) => message.type === "revert-ack")
        .map((message) => message.path)
        .toSorted(),
    ).toEqual(["a.md", "b.md"]);
    // The embedder decides: this one kept the room.
    expect(host.sourceOf("doc:1")).toBe("# A\n");
  });
});

describe("flush answers", () => {
  const OPEN_FIRST = "The document is not open for co-editing, so nothing was saved.";

  const flushOf = (path: string) =>
    encodeFrame({ message: { path, type: "flush" }, type: "control" });
  const acks = (frames: CollabFrame[]) =>
    controls(frames).flatMap((message) => (message.type === "flush-ack" ? [message] : []));

  const lastDirty = (frames: CollabFrame[]) =>
    controls(frames).findLast((message) => message.type === "doc-dirty");

  async function openOn(conn: ReturnType<CollabHost["connect"]>, path: string): Promise<void> {
    conn.handleMessage(encodeFrame({ message: { path, type: "open" }, type: "control" }));
    await settle();
  }

  test("a flush whose embedder rejects is answered with the reason", async () => {
    const host = makeHost(() => Promise.resolve("x"), {
      onFlush: () => Promise.reject(new Error("Could not write a.md: disk full")),
    });
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, IDENTITY);
    await openOn(conn, "a.md");
    conn.handleMessage(flushOf("a.md"));
    await settle();
    expect(acks(frames)).toEqual([
      { error: "Could not write a.md: disk full", path: "a.md", type: "flush-ack" },
    ]);
  });

  test("a rejection that is not an Error is answered with its text", async () => {
    // oxlint-disable-next-line prefer-promise-reject-errors
    const host = makeHost(() => Promise.resolve("x"), { onFlush: () => Promise.reject("nope") });
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, IDENTITY);
    await openOn(conn, "a.md");
    conn.handleMessage(flushOf("a.md"));
    await settle();
    expect(acks(frames)).toEqual([{ error: "nope", path: "a.md", type: "flush-ack" }]);
  });

  test("a read-only connection's flush is refused and never reaches the embedder", async () => {
    const flushed: string[] = [];
    const host = makeHost(() => Promise.resolve("x"), {
      onFlush: (key) => {
        flushed.push(key);
      },
    });
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, { ...IDENTITY, permission: "read" });
    await openOn(conn, "a.md");
    conn.handleMessage(flushOf("a.md"));
    await settle();
    expect(flushed).toEqual([]);
    expect(acks(frames)).toEqual([
      { error: "Write access required", path: "a.md", type: "flush-ack" },
    ]);
  });

  test("a flush for a path the connection has not opened is refused and never reaches the embedder", async () => {
    const flushed: string[] = [];
    const host = makeHost(() => Promise.resolve("x"), {
      onFlush: (key) => {
        flushed.push(key);
      },
    });
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, IDENTITY);
    conn.handleMessage(flushOf("a.md"));
    await settle();
    await openOn(conn, "a.md");
    host.resetDoc("a.md");
    conn.handleMessage(flushOf("a.md"));
    await settle();
    expect(flushed).toEqual([]);
    expect(acks(frames)).toEqual([
      { error: OPEN_FIRST, path: "a.md", type: "flush-ack" },
      { error: OPEN_FIRST, path: "a.md", type: "flush-ack" },
    ]);
  });

  test("a path's flushes reach the embedder one at a time and are answered in order", async () => {
    const started: number[] = [];
    const releases: (() => void)[] = [];
    const host = makeHost(() => Promise.resolve("x"), {
      onFlush: () =>
        new Promise<void>((resolve) => {
          started.push(started.length + 1);
          releases.push(resolve);
        }),
    });
    const first = recordingSocket();
    const second = recordingSocket();
    const a = host.connect(first.socket, IDENTITY);
    const b = host.connect(second.socket, IDENTITY);
    await openOn(a, "a.md");
    await openOn(b, "a.md");
    a.handleMessage(flushOf("a.md"));
    b.handleMessage(flushOf("a.md"));
    await settle();
    // The second flush waits for the first to settle.
    expect(started).toEqual([1]);
    releases[0]!();
    await settle();
    expect(started).toEqual([1, 2]);
    expect(acks(first.frames)).toHaveLength(1);
    expect(acks(second.frames)).toHaveLength(0);
    releases[1]!();
    await settle();
    expect(acks(second.frames)).toEqual([{ path: "a.md", type: "flush-ack" }]);
  });

  test("markPersisted takes the text written, so an edit made meanwhile stays unsaved", async () => {
    const host = makeHost(() => Promise.resolve("seed"));
    const { frames, socket } = recordingSocket();
    const conn = host.connect(socket, IDENTITY);
    await openOn(conn, "a.md");
    // Written text differs from the room's own: the room is unsaved against it.
    host.markPersisted("a.md", "written elsewhere");
    expect(lastDirty(frames)).toEqual({
      dirty: true,
      path: "a.md",
      type: "doc-dirty",
    });
    host.markPersisted("a.md", "seed");
    expect(lastDirty(frames)).toEqual({
      dirty: false,
      path: "a.md",
      type: "doc-dirty",
    });
  });
});
