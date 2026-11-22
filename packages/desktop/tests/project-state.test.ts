// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
/**
 * The window's project state service (`specs/project-state.md` §3.2, §5, §10.1, §11.3) over a
 * stand-in host, so every turn of the desktop binding is observable: the reply goes before any
 * event, events go out batched to the subscribing socket alone, an ended subscription is announced,
 * a stale base is a `412` problem, and the overlay follows the document.
 */

import { describe, expect, test } from "bun:test";
import { decodeDesktopEnded, decodeDesktopPush } from "@jxsuite/protocol/project-state-frames";
import type {
  ContentHash,
  DeleteRequest,
  DeleteResult,
  ProjectEvent,
  SubscribeRequest,
  SubscribeResponse,
  WriteRequest,
  WriteConflict,
  WriteResult,
} from "@jxsuite/protocol/project-state";
import { RpcProblemError } from "@jxsuite/server/project-server";
import type { RpcConnection } from "@jxsuite/server/project-server";
import type {
  ProjectStateHost,
  ProjectStateHostOptions,
  ProjectStateSink,
} from "@jxsuite/server/project-state/host";
import { createProjectStateService } from "../src/backend/project-state.ts";
import type { ProjectWriteParams } from "../src/backend/project-state.ts";

// ─── A stand-in host ──────────────────────────────────────────────────────────

interface FakeHost extends ProjectStateHost {
  sinks: { request: SubscribeRequest; sink: ProjectStateSink; open: boolean }[];
  emit: (events: ProjectEvent[]) => void;
  end: () => void;
  closed: boolean;
  writes: WriteRequest[];
  deletes: DeleteRequest[];
  writeAnswer: WriteResult;
  deleteAnswer: DeleteResult;
  options: ProjectStateHostOptions | null;
}

const CONFLICT: WriteConflict = { diskHash: "sha256-disk", docId: "d1", path: "pages/a.json" };

function fakeHost(): FakeHost {
  let rev = 0;
  const host: FakeHost = {
    close: () => {
      host.closed = true;
      host.end();
      return Promise.resolve();
    },
    closed: false,
    createDirectory: () => Promise.resolve({ rev }),
    delete: (request) => {
      host.deletes.push(request);
      return Promise.resolve(host.deleteAnswer);
    },
    deleteAnswer: { ok: true, rev: 4 },
    deletes: [],
    docIdAt: (path) => (path === "pages/a.json" ? "d1" : null),
    emit: (events) => {
      rev = events.at(-1)?.rev ?? rev;
      for (const entry of host.sinks) {
        if (entry.open) {
          entry.sink.events(events);
        }
      }
    },
    end: () => {
      const ending = host.sinks.filter((entry) => entry.open);
      for (const entry of ending) {
        entry.open = false;
      }
      for (const entry of ending) {
        entry.sink.end?.();
      }
    },
    epoch: "e1",
    idle: () => Promise.resolve(),
    install: () => Promise.resolve(),
    options: null,
    readiness: "ready",
    references: () => ({ documents: [], extensions: [], mounts: [] }),
    release: () => Promise.resolve(),
    rename: () => Promise.reject(new Error("no")),
    restart: () => Promise.resolve(),
    get rev() {
      return rev;
    },
    root: "/project",
    sinks: [],
    snapshot: () => ({ components: [], files: [], formats: "", readiness: "ready" }),
    subscribe: (request, sink) => {
      const entry = { open: !host.closed, request, sink };
      host.sinks.push(entry);
      const response: SubscribeResponse = {
        epoch: "e1",
        kind: "snapshot",
        rev,
        snapshot: host.snapshot(),
      };
      return {
        close: () => {
          entry.open = false;
        },
        response,
      };
    },
    write: (request) => {
      host.writes.push(request);
      return Promise.resolve(host.writeAnswer);
    },
    writeAnswer: { hash: "sha256-new", ok: true, rev: 3 },
    writes: [],
  };
  return host;
}

/** A socket stand-in: what was sent, and the listeners the service registered. */
function fakeConnection(id = 1) {
  const sent: string[] = [];
  const replied: (() => void)[] = [];
  const closers: (() => void)[] = [];
  let open = true;
  const state = { buffered: 0 };
  const connection: RpcConnection = {
    afterReply: (listener) => {
      replied.push(listener);
    },
    buffered: () => state.buffered,
    id,
    onClose: (listener) => {
      closers.push(listener);
    },
    send: (frame) => {
      if (open) {
        sent.push(frame);
      }
      return open;
    },
  };
  return {
    close: () => {
      open = false;
      for (const listener of closers) {
        listener();
      }
    },
    connection,
    reply: () => {
      for (const listener of replied.splice(0)) {
        listener();
      }
    },
    sent,
    state,
  };
}

/** A well-formed content hash (§2.1): 32 bytes of zeros. */
const HASH: ContentHash = `sha256-${"A".repeat(43)}=`;

const changed = (rev: number, path = "pages/a.json"): ProjectEvent => ({
  docId: "d1",
  hash: HASH,
  origin: "external",
  path,
  rev,
  type: "fileChanged",
});

/** A service over a fresh stand-in host, and what the overlay published. */
function service(graceMs?: number, socketHighWater?: number, settleLimitMs?: number) {
  const host = fakeHost();
  const shown = new Map<string, string>();
  const svc = createProjectStateService({
    createHost: (options) => {
      host.options = options;
      return Promise.resolve(host);
    },
    ...(graceMs !== undefined && { overlayGraceMs: graceMs }),
    ...(socketHighWater !== undefined && { socketHighWater }),
    ...(settleLimitMs !== undefined && { settleLimitMs }),
    publish: (path, contents) => {
      shown.set(path, contents);
    },
    root: "/project",
    unpublish: (path) => {
      shown.delete(path);
    },
  });
  return { host, shown, svc };
}

const tick = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

// ─── The binding ──────────────────────────────────────────────────────────────

describe("projectSubscribe", () => {
  test("the reply goes first, then each turn's events as one frame, to that socket alone", async () => {
    const { host, svc } = service();
    const socket = fakeConnection();
    const other = fakeConnection(2);
    const response = await svc.subscribe({ clientId: "w" }, socket.connection);
    expect(response.kind).toBe("snapshot");
    host.emit([changed(1)]);
    await tick();
    expect(socket.sent).toEqual([]);
    socket.reply();
    expect(socket.sent.map((frame) => decodeDesktopPush(frame))).toEqual([
      { epoch: "e1", events: [changed(1)] },
    ]);
    host.emit([changed(2)]);
    host.emit([changed(3)]);
    await tick();
    expect(decodeDesktopPush(socket.sent[1]!)).toEqual({
      epoch: "e1",
      events: [changed(2), changed(3)],
    });
    expect(other.sent).toEqual([]);
    expect(host.options?.root).toBe("/project");
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      host.options?.onError?.(new Error("watch limit"));
    } finally {
      console.error = original;
    }
    expect(logged).toEqual([["[desktop] project state of /project: watch limit"]]);
  });

  test("an ended subscription is announced after the reply, and nothing follows it", async () => {
    const { host, svc } = service();
    const socket = fakeConnection();
    await svc.subscribe({}, socket.connection);
    host.end();
    await tick();
    expect(socket.sent).toEqual([]);
    socket.reply();
    expect(socket.sent.map((frame) => decodeDesktopEnded(frame))).toEqual([{ epoch: "e1" }]);
    host.emit([changed(1)]);
    await tick();
    expect(socket.sent.length).toBe(1);
    const live = fakeConnection();
    await svc.subscribe({}, live.connection);
    live.reply();
    host.end();
    await tick();
    expect(live.sent.map((frame) => decodeDesktopEnded(frame))).toEqual([{ epoch: "e1" }]);
  });

  test("a socket that closes takes its subscription with it", async () => {
    const { host, svc } = service();
    const socket = fakeConnection();
    await svc.subscribe({}, socket.connection);
    socket.reply();
    expect(svc.isSubscribed(socket.connection)).toBe(true);
    socket.close();
    expect(svc.isSubscribed(socket.connection)).toBe(false);
    host.emit([changed(1)]);
    await tick();
    expect(socket.sent).toEqual([]);
  });

  test("a second subscribe on a socket replaces the first, which sends nothing more", async () => {
    const { host, svc } = service();
    const socket = fakeConnection();
    await svc.subscribe({}, socket.connection);
    socket.reply();
    await svc.subscribe({ epoch: "e1", sinceRev: 0 }, socket.connection);
    // Held for the second reply, and not sent by the first subscription at all.
    host.emit([changed(1)]);
    await tick();
    expect(socket.sent).toEqual([]);
    socket.reply();
    host.emit([changed(2)]);
    await tick();
    // Once per event, not once per subscription the socket ever made.
    expect(socket.sent.map((frame) => decodeDesktopPush(frame))).toEqual([
      { epoch: "e1", events: [changed(1)] },
      { epoch: "e1", events: [changed(2)] },
    ]);
    // The host holds the service's own subscription and the socket's latest, nothing else.
    expect(host.sinks.filter((entry) => entry.open)).toHaveLength(2);
    host.end();
    await tick();
    expect(socket.sent.filter((frame) => decodeDesktopEnded(frame) !== null)).toHaveLength(1);
  });

  test("a socket that falls behind has its subscription ended rather than fed", async () => {
    const { host, svc } = service(undefined, 100);
    const socket = fakeConnection();
    await svc.subscribe({}, socket.connection);
    socket.reply();
    socket.state.buffered = 101;
    host.emit([changed(1)]);
    await tick();
    expect(socket.sent.map((frame) => decodeDesktopEnded(frame))).toEqual([{ epoch: "e1" }]);
    expect(svc.isSubscribed(socket.connection)).toBe(false);
    host.emit([changed(2)]);
    await tick();
    expect(socket.sent).toHaveLength(1);
  });

  test("refuses a malformed request, and one with no socket to stream to", async () => {
    const { svc } = service();
    const socket = fakeConnection();
    await expect(svc.subscribe({ sinceRev: "x" }, socket.connection)).rejects.toThrow(TypeError);
    await expect(svc.subscribe({})).rejects.toThrow("needs the socket");
    const answered = await svc.subscribe(null, socket.connection);
    expect(answered.epoch).toBe("e1");
  });

  test("the host starts once, and the overlay follows it from the first subscription", async () => {
    const { host, svc } = service();
    expect(svc.host).toBeNull();
    expect(await svc.references()).toBeNull();
    const [first, second] = await Promise.all([svc.start(), svc.start()]);
    expect(first).toBe(second);
    expect(svc.host).toBe(host);
    expect(await svc.references()).toEqual({ documents: [], extensions: [], mounts: [] });
    // The service's own subscription, which keeps the overlay on the index, re-subscribes on end.
    expect(host.sinks.length).toBe(1);
    host.end();
    expect(host.sinks.length).toBe(2);
    expect(host.sinks[1]?.open).toBe(true);
  });
});

describe("the host's start", () => {
  test("a start that failed is tried again by the next request", async () => {
    const host = fakeHost();
    let attempts = 0;
    const svc = createProjectStateService({
      createHost: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error("EMFILE")) : Promise.resolve(host);
      },
      publish: () => {},
      root: "/project",
      unpublish: () => {},
    });
    const failed = svc.start();
    await expect(failed).rejects.toThrow("EMFILE");
    const retried = await svc.start();
    expect(retried).toBe(host);
    expect(attempts).toBe(2);
    await svc.close();
  });
});

describe("the usage query's graph", () => {
  test("is offered once the host has settled, and not when it is unindexed or never settles", async () => {
    const { host, svc } = service(undefined, undefined, 10);
    await svc.start();
    let indexed = false;
    host.references = () => (indexed ? { documents: [], extensions: [], mounts: [] } : null);
    expect(await svc.references()).toBeNull();
    indexed = true;
    let settled: () => void = () => {};
    host.idle = () =>
      new Promise((resolve) => {
        settled = resolve;
      });
    const asked = svc.references();
    settled();
    expect(await asked).toEqual({ documents: [], extensions: [], mounts: [] });
    // A host that never goes quiet within the bound: the caller walks the tree.
    host.idle = () => new Promise(() => {});
    expect(await svc.references()).toBeNull();
  });
});

describe("conditional writes and deletes", () => {
  test("pass through with their base, and a stale base is a 412 problem", async () => {
    const { host, svc } = service();
    expect(
      await svc.write({ baseHash: null, contents: "{}", path: "pages/a.json", writeId: "w1" }),
    ).toEqual({ hash: "sha256-new", rev: 3 });
    expect(host.writes[0]).toEqual({
      baseHash: null,
      contents: "{}",
      path: "pages/a.json",
      writeId: "w1",
    });
    await svc.write({
      baseHash: "sha256-old",
      bufferRev: 2,
      contents: { data: "AAE=", encoding: "base64" },
      path: "media/a.png",
      writeId: "w2",
    });
    expect(host.writes[1]?.contents).toEqual(new Uint8Array([0, 1]));
    expect(host.writes[1]?.bufferRev).toBe(2);
    expect(host.writes[1]?.writeId).toBe("w2");
    host.writeAnswer = { conflict: CONFLICT, ok: false };
    const refused = await svc
      .write({ baseHash: "sha256-old", contents: "{}", path: "pages/a.json", writeId: "w3" })
      .catch((error: Error) => error);
    expect(refused).toBeInstanceOf(RpcProblemError);
    expect(refused instanceof RpcProblemError && refused.problem).toMatchObject({
      diskHash: "sha256-disk",
      docId: "d1",
      path: "pages/a.json",
      status: 412,
    });

    expect(
      await svc.delete({ base: { hash: "sha256-x" }, path: "pages/a.json", writeId: "d0" }),
    ).toEqual({ rev: 4 });
    expect(host.deletes[0]?.writeId).toBe("d0");
    host.deleteAnswer = { conflict: CONFLICT, ok: false };
    await expect(
      svc.delete({ base: { hash: "sha256-x" }, path: "pages/a.json", writeId: "d" }),
    ).rejects.toBeInstanceOf(RpcProblemError);
  });

  test("a write or delete that names no writeId is refused before the host is asked", async () => {
    const { host, svc } = service();
    const unnamed: Omit<ProjectWriteParams, "writeId"> = {
      baseHash: null,
      contents: "{}",
      path: "pages/a.json",
    };
    const unnamedDelete: Omit<DeleteRequest, "writeId"> = {
      base: { hash: "sha256-x" },
      path: "pages/a.json",
    };
    // SAFETY: the shape a client that leaves `writeId` out puts on the wire.
    await expect(svc.write(unnamed as ProjectWriteParams)).rejects.toThrow("needs a writeId");
    await expect(svc.write({ ...unnamed, writeId: "" })).rejects.toThrow(TypeError);
    // SAFETY: as above.
    await expect(svc.delete(unnamedDelete as DeleteRequest)).rejects.toThrow("needs a writeId");
    expect([host.writes, host.deletes]).toEqual([[], []]);
  });
});

describe("the overlay (§11.3)", () => {
  test("is keyed by the document, so a rename republishes it and a removal drops it", async () => {
    const { host, shown, svc } = service();
    await svc.start();
    svc.setOverlay({ clientId: "w", contents: "unsaved", path: "pages/a.json" });
    expect(shown.get("pages/a.json")).toBe("unsaved");
    host.emit([
      {
        docId: "d1",
        from: "pages/a.json",
        isDir: false,
        origin: "external",
        rev: 1,
        to: "pages/b.json",
        type: "fileRenamed",
      },
    ]);
    expect([...shown]).toEqual([["pages/b.json", "unsaved"]]);
    // Cleared by its new path, which is where the overlay is published now.
    svc.clearOverlay({ clientId: "w", path: "pages/b.json" });
    expect(shown.size).toBe(0);
    svc.setOverlay({ clientId: "w", contents: "again", path: "pages/a.json" });
    host.emit([
      {
        docId: "d1",
        isDir: false,
        origin: "external",
        path: "pages/a.json",
        rev: 2,
        type: "fileRemoved",
      },
    ]);
    expect(shown.size).toBe(0);
  });

  test("a client's overlay outlives its socket, an anonymous subscription's ends with it", async () => {
    const { shown, svc } = service(10);
    const named = fakeConnection(1);
    await svc.subscribe({ clientId: "w" }, named.connection);
    svc.setOverlay({ clientId: "w", contents: "kept", path: "pages/a.json" }, named.connection);
    const anonymous = fakeConnection(2);
    await svc.subscribe({}, anonymous.connection);
    svc.setOverlay({ contents: "socket's", path: "pages/b.json" }, anonymous.connection);
    // A socket that never subscribed shares one owner with every other such socket.
    svc.setOverlay({ contents: "legacy", path: "pages/c.json" }, fakeConnection(3).connection);
    svc.clearOverlay({ path: "pages/c.json" }, fakeConnection(4).connection);
    expect(shown.has("pages/c.json")).toBe(false);
    anonymous.close();
    expect(shown.has("pages/b.json")).toBe(false);
    named.close();
    expect(shown.get("pages/a.json")).toBe("kept");
    await Bun.sleep(30);
    expect(shown.has("pages/a.json")).toBe(false);
  });

  test("a socket that subscribes owns what it set before, and what it owns ends with it", async () => {
    const { shown, svc } = service();
    const late = fakeConnection(5);
    const other = fakeConnection(6);
    svc.setOverlay({ contents: "early", path: "pages/a.json" }, late.connection);
    svc.setOverlay({ contents: "other's", path: "pages/b.json" }, other.connection);
    svc.setOverlay({ contents: "no socket", path: "pages/c.json" });
    svc.setOverlay({ contents: "cleared", path: "pages/d.json" }, late.connection);
    svc.clearOverlay({ path: "pages/d.json" }, late.connection);
    await svc.subscribe({ clientId: "named" }, late.connection);
    late.reply();
    // Its clear reaches what it set before it subscribed.
    svc.clearOverlay({ path: "pages/a.json" }, late.connection);
    expect([...shown.keys()]).toEqual(["pages/b.json", "pages/c.json"]);
    svc.setOverlay({ contents: "again", path: "pages/a.json" }, late.connection);
    // The named subscription ends with the host, but the socket keeps what it set without a name.
    svc.clearOverlay({}, other.connection);
    expect([...shown.keys()]).toEqual(["pages/a.json"]);
    late.close();
    expect(shown.size).toBe(0);
  });

  test("a client clears only what it set, and without a path everything it set", () => {
    const { shown, svc } = service();
    svc.setOverlay({ clientId: "a", contents: "a", path: "pages/a.json" });
    svc.setOverlay({ clientId: "b", contents: "b", path: "pages/x.json" });
    svc.clearOverlay({ clientId: "a" });
    expect([...shown.keys()]).toEqual(["pages/x.json"]);
  });
});

describe("closing", () => {
  test("unpublishes every overlay, closes the host, ends every subscription, and starts nothing", async () => {
    const { host, shown, svc } = service();
    const socket = fakeConnection();
    await svc.subscribe({}, socket.connection);
    socket.reply();
    svc.setOverlay({ clientId: "w", contents: "x", path: "pages/a.json" });
    await svc.close();
    await svc.close();
    await tick();
    expect(host.closed).toBe(true);
    expect(shown.size).toBe(0);
    expect(socket.sent.map((frame) => decodeDesktopEnded(frame))).toEqual([{ epoch: "e1" }]);
    await expect(svc.start()).rejects.toThrow("closed");
  });

  test("a host that finishes starting after the close is closed, not kept", async () => {
    const host = fakeHost();
    let finish: (value: ProjectStateHost) => void = () => {};
    const svc = createProjectStateService({
      createHost: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      publish: () => {},
      root: "/project",
      unpublish: () => {},
    });
    const started = svc.start().catch((error: Error) => error);
    const closing = svc.close();
    finish(host);
    await closing;
    expect(await started).toBeInstanceOf(Error);
    expect(host.closed).toBe(true);
    expect(svc.host).toBeNull();
  });

  test("a close with no host started has nothing to stop", async () => {
    const { svc } = service();
    await svc.close();
    expect(svc.host).toBeNull();
  });
});
