/**
 * Integration: the real dev server's /__studio/collab endpoint driven by the real collab wire
 * client over actual WebSockets — probe, two-client convergence, explicit-save persistence,
 * room-level dirty, and (registry-level) external-change resets.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { connect as netConnect } from "node:net";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createDevServer } from "../src/server.ts";
import { createCollabRegistry } from "../src/collab.ts";
import type { CollabRegistry, CollabSocketData } from "../src/collab.ts";
import { serve } from "#serve";
import { serve as serveNode } from "../src/serve.node.ts";
import type { ServerWebSocket } from "bun";
import type { HostConnection } from "@jxsuite/collab/room";
import { createWsCollabConnection } from "@jxsuite/collab/client";
import { COLLAB_SUBPROTOCOL, negotiateCollab } from "@jxsuite/collab/negotiate";
import type { WsCollabConnection } from "@jxsuite/collab/client";
import { sourceText, updateSourceText } from "@jxsuite/collab";
import { PROJECT_EVENTS_PATH } from "@jxsuite/protocol/project-state-frames";

const FIXTURES = resolve(import.meta.dir, "_collab_fixtures");
const PAGE = "pages/index.md";

let server: Awaited<ReturnType<typeof createDevServer>>;
const connections: WsCollabConnection[] = [];

function connect(): WsCollabConnection {
  const connection = createWsCollabConnection({
    openTimeoutMs: 5000,
    reconnectDelayMs: 50,
    url: `ws://localhost:${server.port}/__studio/collab`,
  });
  connections.push(connection);
  return connection;
}

/**
 * Send a raw HTTP/1.1 WebSocket upgrade to the dev server and resolve the response head. A raw
 * request makes the extension offer explicit and exposes the answer header by header.
 */
function rawUpgrade(port: number, headers: Record<string, string>): Promise<string> {
  return new Promise((resolveHead, reject) => {
    const socket = netConnect(port, "127.0.0.1");
    let head = "";
    socket.setEncoding("utf8");
    socket.on("error", reject);
    socket.on("connect", () => {
      const lines = [
        "GET /__studio/collab HTTP/1.1",
        `Host: localhost:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        "",
        "",
      ];
      socket.write(lines.join("\r\n"));
    });
    socket.on("data", (chunk: string) => {
      head += chunk;
      const end = head.indexOf("\r\n\r\n");
      if (end !== -1) {
        socket.destroy();
        resolveHead(head.slice(0, end));
      }
    });
  });
}

/** Resolve when the socket completes its handshake; reject if it fails. */
function whenOpen(ws: WebSocket): Promise<void> {
  return new Promise<void>((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", () => {
      resolveOpen();
    });
    ws.addEventListener("error", () => {
      rejectOpen(new Error("handshake failed"));
    });
  });
}

async function until(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) {
      throw new Error("condition not met in time");
    }
    await new Promise((resolveSleep) => {
      setTimeout(resolveSleep, 20);
    });
  }
}

/**
 * A loopback socket for driving the registry's Bun websocket handlers directly: every frame the
 * registry sends is handed to `onFrame`, and `data` is the per-socket state the handlers own.
 */
function loopbackSocket(onFrame: (frame: Uint8Array) => void) {
  const data: CollabSocketData = { connection: null };
  const socket = {
    close: () => {},
    data,
    send: (frame: Uint8Array) => {
      onFrame(frame);
    },
  };
  /* SAFETY: the registry's open/message/close handlers (collab.ts) touch only `data`, `send` and
     `close` on the socket, and this loopback provides all three; the rest of ServerWebSocket
     (pub/sub, cork, remoteAddress, …) is never reached on these paths. */
  return { data, ws: socket as ServerWebSocket<CollabSocketData> };
}

/** Run the registry's `open` handler for `ws` and return the host connection it attached. */
function openHost(
  registry: CollabRegistry,
  socket: ReturnType<typeof loopbackSocket>,
): HostConnection {
  void registry.websocket.open?.(socket.ws);
  const { connection } = socket.data;
  if (connection === null) {
    throw new Error("the registry's open handler attached no host connection");
  }
  return connection;
}

beforeAll(async () => {
  rmSync(FIXTURES, { force: true, recursive: true });
  mkdirSync(join(FIXTURES, "pages"), { recursive: true });
  writeFileSync(join(FIXTURES, "project.json"), JSON.stringify({ name: "collab-demo" }));
  writeFileSync(join(FIXTURES, PAGE), "# Hello\n");
  server = await createDevServer({
    builds: [],
    port: 0,
    root: FIXTURES,
    studio: true,
    watch: false,
  });
});

afterAll(() => {
  for (const connection of connections) {
    connection.destroy();
  }
  void server.stop(true);
  rmSync(FIXTURES, { force: true, recursive: true });
});

/** The message a promise rejects with, or "" when it does not reject. */
async function rejectionOf(pending: Promise<unknown>): Promise<string> {
  try {
    await pending;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("/__studio/collab", () => {
  test("plain GET answers the capability probe, advertising the subprotocol", async () => {
    const res = await fetch(`http://localhost:${server.port}/__studio/collab`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({
      collab: true,
      protocols: [COLLAB_SUBPROTOCOL],
      version: 1,
    });
  });

  test("the probe body is exactly what negotiateCollab reads", async () => {
    const res = await fetch(`http://localhost:${server.port}/__studio/collab`);
    const probe = await res.json();
    expect(negotiateCollab(probe)).toEqual({ offer: [COLLAB_SUBPROTOCOL], refused: null });
  });

  test("an upgrade offering permessage-deflate opens without the extension", async () => {
    const head = await rawUpgrade(server.port!, {
      "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits",
      "Sec-WebSocket-Protocol": COLLAB_SUBPROTOCOL,
    });
    expect(head.startsWith("HTTP/1.1 101")).toBe(true);
    expect(head).toMatch(/^sec-websocket-protocol: jx\.collab\.v1\r?$/im);
    expect(head).not.toMatch(/^sec-websocket-extensions:/im);
  });

  test("an upgrade offering the subprotocol is echoed, and the socket opens", async () => {
    const ws = new WebSocket(`ws://localhost:${server.port}/__studio/collab`, [COLLAB_SUBPROTOCOL]);
    await whenOpen(ws);
    // A client only reaches `open` if the echo was one of the tokens it offered (RFC 6455 §4.1).
    expect(ws.protocol).toBe(COLLAB_SUBPROTOCOL);
    ws.close();
  });

  test("an upgrade offering nothing still connects, and echoes nothing", async () => {
    const ws = new WebSocket(`ws://localhost:${server.port}/__studio/collab`);
    await whenOpen(ws);
    expect(ws.protocol).toBe("");
    ws.close();
  });

  test("an upgrade offering only an envelope the server cannot speak is refused", async () => {
    /*
     * Refusing the handshake is the point: a peer whose frames we would mis-parse must not join a
     * room. The refusal is a 400 with a problem body, not a 101 with no echo.
     */
    const res = await fetch(`http://localhost:${server.port}/__studio/collab`, {
      headers: {
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Protocol": "jx.collab.v9",
        "Sec-WebSocket-Version": "13",
        Upgrade: "websocket",
      },
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await res.text()).toContain(COLLAB_SUBPROTOCOL);
  });

  test("a handle syncs the file's content and a local identity", async () => {
    const handle = await connect().openDoc(PAGE);
    expect(handle).not.toBeNull();
    await handle!.whenSynced;
    expect(sourceText(handle!.doc).toString()).toBe("# Hello\n");
    expect(handle!.identity()?.login).toStartWith("local-");
    expect(handle!.identity()?.permission).toBe("write");
    handle!.destroy();
  });

  test("a missing file resolves null", async () => {
    expect(await connect().openDoc("pages/absent.md")).toBeNull();
  });

  test("two clients converge and flush persists to disk", async () => {
    const a = await connect().openDoc(PAGE);
    const b = await connect().openDoc(PAGE);
    await a!.whenSynced;
    await b!.whenSynced;

    updateSourceText(a!.doc, "# Hello\n\nEdited together\n", "test");
    await until(() => sourceText(b!.doc).toString().includes("Edited together"));

    updateSourceText(b!.doc, "# Hello\n\nEdited together, twice\n", "test");
    await until(() => sourceText(a!.doc).toString().includes("twice"));

    await a!.flush();
    expect(readFileSync(join(FIXTURES, PAGE), "utf8")).toBe("# Hello\n\nEdited together, twice\n");
    a!.destroy();
    b!.destroy();
  });

  test("edits do NOT auto-persist; the room goes dirty and an explicit flush writes + clears it", async () => {
    const handle = await connect().openDoc(PAGE);
    await handle!.whenSynced;
    const dirtyStates: boolean[] = [];
    handle!.onDirty((d) => dirtyStates.push(d));
    const before = readFileSync(join(FIXTURES, PAGE), "utf8");
    const marker = `explicit-${Date.now()}`;
    updateSourceText(handle!.doc, `# Hello\n\n${marker}\n`, "test");
    // The room reports dirty over the wire, but nothing reaches disk without an explicit flush.
    await until(() => dirtyStates.at(-1) === true);
    await new Promise((resolveSleep) => {
      setTimeout(resolveSleep, 200);
    });
    expect(readFileSync(join(FIXTURES, PAGE), "utf8")).toBe(before);
    // The explicit flush persists it and clears the room-level dirty for every peer.
    await handle!.flush();
    expect(readFileSync(join(FIXTURES, PAGE), "utf8")).toContain(marker);
    await until(() => dirtyStates.at(-1) === false);
    handle!.destroy();
  });

  test("a redundant flush with no new edits is a no-op", async () => {
    const handle = await connect().openDoc(PAGE);
    await handle!.whenSynced;
    await handle!.flush();
    const before = readFileSync(join(FIXTURES, PAGE), "utf8");
    // Nothing changed since the last flush: the persist path short-circuits, no rewrite.
    await handle!.flush();
    expect(readFileSync(join(FIXTURES, PAGE), "utf8")).toBe(before);
    handle!.destroy();
  });

  test("a binary path is refused by the capability", async () => {
    expect(await connect().openDoc("assets/logo.png")).toBeNull();
  });

  test("a path escaping the server root is refused by the capability", async () => {
    expect(await connect().openDoc("../escape.md")).toBeNull();
  });
});

describe("watcher-driven resets", () => {
  test("an external disk write reaches subscribers as a doc-reset via the file watcher", async () => {
    const dir = resolve(import.meta.dir, "_collab_watch_fixtures");
    rmSync(dir, { force: true, recursive: true });
    mkdirSync(join(dir, "pages"), { recursive: true });
    writeFileSync(join(dir, "pages/live.md"), "# Watched\n");
    const watched = await createDevServer({
      builds: [],
      port: 0,
      root: dir,
      studio: true,
      watch: true,
    });
    const connection = createWsCollabConnection({
      openTimeoutMs: 5000,
      url: `ws://localhost:${watched.port}/__studio/collab`,
    });
    try {
      const handle = await connection.openDoc("pages/live.md");
      expect(handle).not.toBeNull();
      await handle!.whenSynced;
      let resets = 0;
      handle!.onReset(() => {
        resets += 1;
      });
      // Give chokidar a beat to finish its initial scan before the external write.
      await new Promise((resolveSleep) => {
        setTimeout(resolveSleep, 300);
      });
      writeFileSync(join(dir, "pages/live.md"), "# Rewritten outside the room\n");
      await until(() => resets === 1, 10_000);
    } finally {
      connection.destroy();
      void watched.stop(true);
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

/**
 * A rename moves a file out from under a live room. Inside the project the dev server's host
 * serves, the room is keyed by the document (`project-state.md` §11.3), so it follows the move: a
 * peer opening the new path joins it, unsaved edits and all, and a save lands at the new path. Its
 * save names the bytes it loaded as its base, so nothing it writes can recreate the file at the old
 * path.
 */
describe("renames reach the collaboration registry", () => {
  test("a renamed document keeps its room, and no later save writes the old path back", async () => {
    const dir = resolve(import.meta.dir, "_collab_rename_fixtures");
    rmSync(dir, { force: true, recursive: true });
    mkdirSync(join(dir, "pages"), { recursive: true });
    writeFileSync(join(dir, "project.json"), JSON.stringify({ name: "rename-demo" }));
    writeFileSync(join(dir, "pages/movable.md"), "# Before\n");
    const renamed = await createDevServer({
      builds: [],
      port: 0,
      root: dir,
      studio: true,
      watch: false,
    });
    const base = `http://localhost:${renamed.port}`;
    const connection = createWsCollabConnection({
      openTimeoutMs: 5000,
      url: `ws://localhost:${renamed.port}/__studio/collab`,
    });
    const peer = createWsCollabConnection({
      openTimeoutMs: 5000,
      url: `ws://localhost:${renamed.port}/__studio/collab`,
    });
    // The project stream says when the host has seen the move.
    const stream = await fetch(`${base}${PROJECT_EVENTS_PATH}`);
    const reader = stream.body!.getReader();
    let seen = "";
    const decoder = new TextDecoder();
    const untilSeen = async (text: string): Promise<void> => {
      while (!seen.includes(text)) {
        const { done, value } = await reader.read();
        if (done) {
          throw new Error("the project stream closed");
        }
        seen += decoder.decode(value);
      }
    };
    try {
      await untilSeen('"state":"ready"');
      const handle = await connection.openDoc("pages/movable.md");
      expect(handle).not.toBeNull();
      await handle!.whenSynced;
      let resets = 0;
      handle!.onReset(() => {
        resets += 1;
      });
      updateSourceText(handle!.doc, "# Before\n\nunsaved\n", "test");

      const res = await fetch(`${base}/__studio/file/rename`, {
        body: JSON.stringify({ from: "pages/movable.md", to: "pages/moved.md" }),
        method: "POST",
      });
      expect(res.ok).toBe(true);
      await untilSeen('"type":"fileRenamed"');

      const moved = await peer.openDoc("pages/moved.md");
      expect(moved).not.toBeNull();
      await moved!.whenSynced;
      expect(sourceText(moved!.doc).toString()).toBe("# Before\n\nunsaved\n");
      await moved!.flush();
      expect(readFileSync(join(dir, "pages/moved.md"), "utf8")).toBe("# Before\n\nunsaved\n");
      expect(resets).toBe(0);

      // The old path's tab saves into the moved document: nothing writes the old path back.
      await handle!.flush();
      expect(existsSync(join(dir, "pages/moved.md"))).toBe(true);
      expect(existsSync(join(dir, "pages/movable.md"))).toBe(false);
    } finally {
      await reader.cancel().catch(() => {});
      connection.destroy();
      peer.destroy();
      void renamed.stop(true);
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe("stopping the registry", () => {
  test("stop() drops unsaved edits and writes nothing, and a second stop() is a no-op", async () => {
    const dir = resolve(import.meta.dir, "_collab_stop_fixtures");
    rmSync(dir, { force: true, recursive: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "doc.md"), "start\n");
    const registry = createCollabRegistry({ absRoot: dir, activeProjectRoot: () => null });
    // Over the Node implementation, the one the packaged desktop backend runs (serve.node.ts).
    const srv = await serveNode<CollabSocketData>({
      fetch: (req, srvHandle) => registry.handleRequest(req, srvHandle) ?? new Response("ok"),
      port: 0,
      websocket: registry.websocket,
    });
    const connection = createWsCollabConnection({
      openTimeoutMs: 5000,
      url: `ws://localhost:${srv.port}`,
    });
    try {
      const handle = await connection.openDoc("doc.md");
      await handle!.whenSynced;
      updateSourceText(handle!.doc, "start\n\nunsaved edit\n", "test");
      // Wait for the edit to reach the server room (the dirty broadcast confirms it landed).
      await new Promise<void>((res) => {
        const off = handle!.onDirty((d) => {
          if (d) {
            off();
            res();
          }
        });
      });
      await registry.stop();
      // Only a flush reaches the disk: stopping the registry wrote nothing.
      expect(readFileSync(join(dir, "doc.md"), "utf8")).toBe("start\n");
      // A second stop() is idempotent.
      await registry.stop();
      expect(readFileSync(join(dir, "doc.md"), "utf8")).toBe("start\n");
    } finally {
      connection.destroy();
      void srv.stop(true);
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe("persist failures", () => {
  test("a flush whose write fails is answered with the reason, the room stays unsaved, and the next flush writes", async () => {
    const dir = resolve(import.meta.dir, "_collab_persist_fail_fixtures");
    rmSync(dir, { force: true, recursive: true });
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "doc.md");
    writeFileSync(file, "start\n");
    const registry = createCollabRegistry({ absRoot: dir, activeProjectRoot: () => null });
    const srv = await serve<CollabSocketData>({
      fetch: (req, srvHandle) => registry.handleRequest(req, srvHandle) ?? new Response("ok"),
      port: 0,
      websocket: registry.websocket,
    });
    const connection = createWsCollabConnection({
      openTimeoutMs: 5000,
      url: `ws://localhost:${srv.port}`,
    });
    try {
      const handle = await connection.openDoc("doc.md");
      await handle!.whenSynced;
      let dirty = false;
      handle!.onDirty((now) => {
        dirty = now;
      });
      updateSourceText(handle!.doc, "start\n\nlands later\n", "test");
      await until(() => dirty);
      // Turn the target path into a directory: the write fails (EISDIR) and the flush says so.
      rmSync(file);
      mkdirSync(file);
      expect(await rejectionOf(handle!.flush())).toContain("Could not write doc.md");
      expect(dirty).toBe(true);
      expect(statSync(file).isDirectory()).toBe(true);
      // The failure cleared the optimistic signature, so the next flush writes.
      rmSync(file, { force: true, recursive: true });
      await handle!.flush();
      expect(readFileSync(file, "utf8")).toBe("start\n\nlands later\n");
      await until(() => !dirty);
    } finally {
      connection.destroy();
      void srv.stop(true);
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe("registry external changes", () => {
  test("a genuinely external write resets the room; write-back echoes do not", async () => {
    const dir = resolve(import.meta.dir, "_collab_registry_fixtures");
    rmSync(dir, { force: true, recursive: true });
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "doc.md");
    writeFileSync(file, "original");
    const registry = createCollabRegistry({ absRoot: dir, activeProjectRoot: () => null });
    const { decodeFrame, encodeFrame } = await import("@jxsuite/collab/envelope");

    // Wire a loopback client through the registry's Bun-shaped handlers, capturing sent frames.
    const received: string[] = [];
    const fakeWs = loopbackSocket((data) => {
      try {
        const frame = decodeFrame(new Uint8Array(data));
        received.push(frame.type === "control" ? `control:${frame.message.type}` : frame.type);
      } catch {
        received.push("malformed");
      }
    });
    const hostConnection = openHost(registry, fakeWs);
    expect(hostConnection).toBeTruthy();

    hostConnection.handleMessage(
      encodeFrame({ message: { path: "doc.md", type: "open" }, type: "control" }),
    );
    await until(() => received.includes("control:opened"));

    // A save whose bytes match the live source is our own write-back echo: no reset.
    registry.handleExternalChange(file);
    await new Promise((resolveSleep) => {
      setTimeout(resolveSleep, 150);
    });
    expect(received).not.toContain("control:doc-reset");

    // Different bytes on disk are a genuine external change: subscribers get a doc-reset.
    writeFileSync(file, "changed externally");
    registry.handleExternalChange(file);
    await until(() => received.includes("control:doc-reset"));

    hostConnection.close();
    await registry.stop();
    rmSync(dir, { force: true, recursive: true });
  });

  test("a change outside the served root is dropped without opening a room", async () => {
    const dir = resolve(import.meta.dir, "_collab_outside_fixtures");
    rmSync(dir, { force: true, recursive: true });
    mkdirSync(dir, { recursive: true });
    const registry = createCollabRegistry({ absRoot: dir, activeProjectRoot: () => null });

    // The path is not under absRoot, so it is keyed by its own (slash-normalized) text, no room
    // Holds it, and the notification returns before any read.
    expect(() => registry.handleExternalChange("/elsewhere/not-served/doc.md")).not.toThrow();
    await new Promise((resolveSleep) => {
      setTimeout(resolveSleep, 50);
    });

    await registry.stop();
    rmSync(dir, { force: true, recursive: true });
  });

  test("a deleted file resets the room; unknown paths and text frames are ignored", async () => {
    const dir = resolve(import.meta.dir, "_collab_delete_fixtures");
    rmSync(dir, { force: true, recursive: true });
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "doc.md");
    writeFileSync(file, "will vanish");
    const registry = createCollabRegistry({ absRoot: dir, activeProjectRoot: () => null });
    const { decodeFrame, encodeFrame } = await import("@jxsuite/collab/envelope");

    const received: string[] = [];
    const fakeWs = loopbackSocket((data) => {
      try {
        const frame = decodeFrame(new Uint8Array(data));
        received.push(frame.type === "control" ? `control:${frame.message.type}` : frame.type);
      } catch {
        received.push("malformed");
      }
    });
    // A text frame is ignored outright — even before any connection state exists.
    void registry.websocket.message?.(fakeWs.ws, "not a binary frame");
    const hostConnection = openHost(registry, fakeWs);
    hostConnection.handleMessage(
      encodeFrame({ message: { path: "doc.md", type: "open" }, type: "control" }),
    );
    await until(() => received.includes("control:opened"));

    // A change notification for a path no room has ever loaded is dropped.
    registry.handleExternalChange(join(dir, "ghost.md"));
    await new Promise((resolveSleep) => {
      setTimeout(resolveSleep, 100);
    });
    expect(received).not.toContain("control:doc-reset");

    // Deleting the file behind an open room is a genuine external change: the read fails and the
    // Room resets its subscribers.
    rmSync(file);
    registry.handleExternalChange(file);
    await until(() => received.includes("control:doc-reset"));

    // Leaving the room schedules the empty-room grace timer; stop() clears it.
    hostConnection.close();
    await new Promise((resolveSleep) => {
      setTimeout(resolveSleep, 50);
    });
    await registry.stop();
    rmSync(dir, { force: true, recursive: true });
  });

  test("an empty room is torn down after the grace period elapses", async () => {
    const dir = resolve(import.meta.dir, "_collab_grace_fixtures");
    rmSync(dir, { force: true, recursive: true });
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "doc.md");
    writeFileSync(file, "grace");
    const registry = createCollabRegistry({ absRoot: dir, activeProjectRoot: () => null });
    const { decodeFrame, encodeFrame } = await import("@jxsuite/collab/envelope");

    const received: string[] = [];
    const fakeWs = loopbackSocket((data) => {
      try {
        const frame = decodeFrame(new Uint8Array(data));
        received.push(frame.type === "control" ? `control:${frame.message.type}` : frame.type);
      } catch {
        received.push("malformed");
      }
    });
    const hostConnection = openHost(registry, fakeWs);
    hostConnection.handleMessage(
      encodeFrame({ message: { path: "doc.md", type: "open" }, type: "control" }),
    );
    await until(() => received.includes("control:opened"));

    // Capture the 30 s empty-room grace timer instead of waiting it out.
    const realSetTimeout = globalThis.setTimeout;
    let graceCb: (() => void) | null = null;
    /* SAFETY: the stub forwards every call it does not capture to the real timer with the same
       callback, delay and extra arguments, so callers see setTimeout's own behaviour; the only
       difference is the 30 s grace timer, whose callback is the registry's zero-argument destroy
       closure. `__promisify__` is never read while the stub is installed (restored in finally). */
    globalThis.setTimeout = ((cb: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === 30_000) {
        graceCb = cb;
        return realSetTimeout(() => {}, 0);
      }
      return realSetTimeout(cb, ms, ...rest);
    }) as typeof setTimeout;
    try {
      void registry.websocket.close?.(fakeWs.ws, 1000, "bye");
      await until(() => graceCb !== null);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }

    // The grace period elapses: the room is destroyed and later change events are dropped.
    graceCb!();
    const frames = received.length;
    registry.handleExternalChange(file);
    await new Promise((resolveSleep) => {
      setTimeout(resolveSleep, 100);
    });
    expect(received.length).toBe(frames);

    // Re-open and leave again, but this time let the (real) grace timer stay pending so that
    // Stop() has a live destroy timer to clear.
    let scheduled = false;
    /* SAFETY: every call is forwarded to the real timer with the same callback, delay and extra
       arguments, so the stub only observes; `__promisify__` is never read while it is installed. */
    globalThis.setTimeout = ((cb: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === 30_000) {
        scheduled = true;
      }
      return realSetTimeout(cb, ms, ...rest);
    }) as typeof setTimeout;
    try {
      const fakeWs2 = loopbackSocket((data) => {
        try {
          const frame = decodeFrame(new Uint8Array(data));
          const label = frame.type === "control" ? frame.message.type : frame.type;
          received.push(`re:${label}`);
        } catch {
          received.push("re:malformed");
        }
      });
      const secondConnection = openHost(registry, fakeWs2);
      secondConnection.handleMessage(
        encodeFrame({ message: { path: "doc.md", type: "open" }, type: "control" }),
      );
      await until(() => received.includes("re:opened"));
      void registry.websocket.close?.(fakeWs2.ws, 1000, "bye");
      await until(() => scheduled);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    await registry.stop();
    rmSync(dir, { force: true, recursive: true });
  });
});
