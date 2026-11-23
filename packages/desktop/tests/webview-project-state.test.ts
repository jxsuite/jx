// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
/**
 * The desktop adapter's project state client (`specs/project-state.md` §3.2, §5): a subscribe's
 * later frames reach its listener, the end of a subscription is reported, and a refused write or
 * delete answers its conflict from the `412` problem the reply carries.
 */

import { afterAll, describe, expect, test } from "bun:test";
import {
  createSubscriptionCursor,
  encodeDesktopEnded,
  encodeDesktopEvents,
  preconditionFailedProblem,
} from "@jxsuite/protocol/project-state-frames";
import type {
  ContentHash,
  ProjectEvent,
  SubscribeResponse,
  WriteConflict,
} from "@jxsuite/protocol/project-state";
import type { ProjectEventsParams } from "@jxsuite/protocol/project-state-frames";
import { decodeRequest } from "./_rpc-frame";

const HASH: ContentHash = `sha256-${"A".repeat(43)}=`;
const CONFLICT: WriteConflict = { diskHash: HASH, docId: "d1", path: "pages/a.json" };

const changed: ProjectEvent = {
  docId: "d1",
  hash: HASH,
  origin: "external",
  path: "pages/a.json",
  rev: 2,
  type: "fileChanged",
};

const SNAPSHOT: SubscribeResponse = {
  epoch: "e1",
  kind: "snapshot",
  rev: 1,
  snapshot: { components: [], files: [], formats: "", readiness: "ready" },
};

const received: { method: string; params?: unknown }[] = [];

const server = Bun.serve({
  fetch(req, srv) {
    if (srv.upgrade(req)) {
      return;
    }
    return new Response("Not Found", { status: 404 });
  },
  port: 0,
  websocket: {
    message(ws, raw) {
      const msg = decodeRequest(raw);
      received.push({ method: msg.method, params: msg.params });
      const path = msg.params?.path;
      if (msg.method === "getProjectRoot") {
        // A push with nobody subscribed yet: the client drops it.
        ws.send(encodeDesktopEvents("e1", [changed]));
        ws.send(JSON.stringify({ id: msg.id, result: { root: "/p" } }));
        return;
      }
      if (msg.method === "findReferences") {
        // The socket drops mid-request, as an idle timeout or a suspended window drops it.
        ws.close();
        return;
      }
      if (msg.method === "projectSubscribe" && msg.params?.clientId === "cursor") {
        // The first subscribe holds nothing; a later one names where it left off.
        if (!("epoch" in msg.params)) {
          ws.send(JSON.stringify({ id: msg.id, result: { ...SNAPSHOT, epoch: "e3" } }));
          ws.send(encodeDesktopEvents("e3", [changed]));
        } else {
          ws.send(
            JSON.stringify({
              id: msg.id,
              result: { epoch: "e3", events: [], kind: "events", rev: 2 },
            }),
          );
        }
        return;
      }
      if (msg.method === "projectSubscribe" && msg.params?.clientId === "stays") {
        ws.send(JSON.stringify({ id: msg.id, result: { ...SNAPSHOT, epoch: "e2" } }));
        return;
      }
      if (msg.method === "projectSubscribe") {
        ws.send(JSON.stringify({ id: msg.id, result: SNAPSHOT }));
        ws.send(encodeDesktopEvents("e1", [changed]));
        ws.send(JSON.stringify({ method: "projectEvents", params: { epoch: "e1", events: [1] } }));
        ws.send(encodeDesktopEnded("e1"));
        return;
      }
      if (msg.method === "projectRename") {
        ws.send(
          JSON.stringify({
            id: msg.id,
            result: { message: "no", ok: false, opId: "op", paths: [], reason: "failed" },
          }),
        );
        return;
      }
      if (msg.method === "projectWrite" || msg.method === "projectDelete") {
        if (path === "pages/a.json") {
          const problem = preconditionFailedProblem(CONFLICT);
          ws.send(JSON.stringify({ error: problem.detail, id: msg.id, problem }));
        } else if (path === "pages/odd.json") {
          ws.send(JSON.stringify({ error: "odd", id: msg.id, problem: { type: "about:blank" } }));
        } else if (path === "pages/broken.json") {
          ws.send(JSON.stringify({ error: "disk full", id: msg.id }));
        } else {
          ws.send(JSON.stringify({ id: msg.id, result: { hash: HASH, rev: 5 } }));
        }
        return;
      }
      ws.send(JSON.stringify({ id: msg.id, result: null }));
    },
  },
});

const TEST_HOST = `localhost:${server.port}`;

Object.defineProperty(globalThis, "location", {
  configurable: true,
  value: { host: TEST_HOST, href: `http://${TEST_HOST}/`, search: "" },
  writable: true,
});

const wsStr = globalThis.WebSocket.toString();
if (wsStr.includes("WebSocketImplementation") || wsStr.includes("DOMException")) {
  // @ts-expect-error -- deleting a required global; Bun re-exposes its built-in WebSocket
  delete globalThis.WebSocket;
}

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { addEventListener: () => {} },
  writable: true,
});

const { BackendRefusalError, createDesktopPlatform } = await import("../src/webview/platform");
const platform = createDesktopPlatform();

afterAll(() => {
  void server.stop();
});

/** Wait for `check` to hold, failing the test when it never does. */
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the condition");
    }
    await Bun.sleep(5);
  }
}

describe("projectState", () => {
  test("a frame that arrives before any subscription is dropped", async () => {
    expect(await platform.getProjectRoot()).toEqual({ root: "/p" });
  });

  test("a subscribe's events and its end reach the listener; a malformed frame does not", async () => {
    const frames: ProjectEventsParams[] = [];
    const ended: string[] = [];
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const response = await platform.projectState.subscribe(
        { clientId: "w" },
        {
          ended: (epoch) => {
            ended.push(epoch);
          },
          events: (params) => {
            frames.push(params);
          },
        },
      );
      expect(response).toEqual(SNAPSHOT);
      await until(() => ended.length > 0);
      expect(frames).toEqual([{ epoch: "e1", events: [changed] }]);
      expect(ended).toEqual(["e1"]);
      expect(errors.length).toBe(1);
      expect(received.at(-1)).toEqual({ method: "projectSubscribe", params: { clientId: "w" } });
      // A listener without an `ended` hook ignores the end; the `StudioPlatform` member is the same
      // Subscribe.
      await platform.subscribeProjectState({}, { events: () => {} });
      await until(() => errors.length > 1);
      expect(errors.length).toBe(2);
    } finally {
      console.error = original;
    }
  });

  test("a write sends its base and contents on the wire, and answers the accepted revision", async () => {
    const result = await platform.projectState.write({
      baseHash: null,
      bufferRev: 3,
      contents: new Uint8Array([0, 1]),
      path: "pages/new.json",
      writeId: "w1",
    });
    expect(result).toEqual({ hash: HASH, ok: true, rev: 5 });
    expect(received.at(-1)).toEqual({
      method: "projectWrite",
      params: {
        baseHash: null,
        bufferRev: 3,
        contents: { data: "AAE=", encoding: "base64" },
        path: "pages/new.json",
        writeId: "w1",
      },
    });
    // The `StudioPlatform` member Studio saves through is the same write.
    await platform.writeProjectState({
      baseHash: HASH,
      contents: "{}",
      path: "pages/text.json",
      writeId: "w2",
    });
    expect(received.at(-1)?.params).toEqual({
      baseHash: HASH,
      contents: "{}",
      path: "pages/text.json",
      writeId: "w2",
    });
  });

  test("a rename sends the operation on the wire and answers the host's result", async () => {
    const result = await platform.renameProjectState({
      dirtyReferrers: [],
      from: "media/a.png",
      opId: "op",
      policy: "rewrite-buffer",
      rewrites: [{ baseHash: HASH, contents: new Uint8Array([0, 1]), path: "c.md" }],
      to: "media/b.png",
    });
    expect(result).toEqual({ message: "no", ok: false, opId: "op", paths: [], reason: "failed" });
    expect(received.at(-1)).toEqual({
      method: "projectRename",
      params: {
        dirtyReferrers: [],
        from: "media/a.png",
        opId: "op",
        policy: "rewrite-buffer",
        rewrites: [
          { baseHash: HASH, contents: { data: "AAE=", encoding: "base64" }, path: "c.md" },
        ],
        to: "media/b.png",
      },
    });
  });

  test("a refused write or delete answers its conflict; any other failure still rejects", async () => {
    expect(
      await platform.projectState.write({
        baseHash: HASH,
        contents: "{}",
        path: "pages/a.json",
        writeId: "w3",
      }),
    ).toEqual({ conflict: CONFLICT, ok: false });
    expect(
      await platform.projectState.delete({
        base: { hash: HASH },
        path: "pages/a.json",
        writeId: "d1",
      }),
    ).toEqual({ conflict: CONFLICT, ok: false });
    // So is the delete Studio removes files through.
    expect(
      await platform.deleteProjectState({
        base: { hash: HASH },
        path: "pages/b.json",
        writeId: "d2",
      }),
    ).toEqual({ ok: true, rev: 5 });
    const odd = await platform.projectState
      .write({ baseHash: HASH, contents: "{}", path: "pages/odd.json", writeId: "w4" })
      .catch((error: Error) => error);
    expect(odd).toBeInstanceOf(BackendRefusalError);
    await expect(
      platform.projectState.delete({
        base: { hash: HASH },
        path: "pages/broken.json",
        writeId: "d3",
      }),
    ).rejects.toThrow("disk full");
  });

  test("a reconnect ends the subscription the old socket carried, once the new one is open", async () => {
    const ended: string[] = [];
    await platform.projectState.subscribe(
      { clientId: "stays" },
      {
        ended: (epoch) => {
          ended.push(epoch);
        },
        events: () => {},
      },
    );
    await expect(platform.findReferences({ path: "a.json" })).rejects.toThrow();
    await until(() => ended.length > 0);
    expect(ended).toEqual(["e2"]);
    // Nothing is open now, so a second reconnect reports nothing.
    await expect(platform.findReferences({ path: "a.json" })).rejects.toThrow();
    await Bun.sleep(1200);
    expect(ended).toEqual(["e2"]);
    expect(await platform.getProjectRoot()).toEqual({ root: "/p" });
  });

  /* `project-state.md` §3.3: the socket that comes back carries no resync reason. The subscription
     it took with it is ended, and the client's next subscribe names its cursor; nothing is
     re-listed. */
  test("a reconnect is a subscribe with { epoch, sinceRev }, and lists nothing", async () => {
    const cursor = createSubscriptionCursor("cursor");
    let ended = 0;
    const listener = {
      ended: () => {
        ended += 1;
      },
      events: (params: ProjectEventsParams) => {
        cursor.frame(params);
      },
    };
    cursor.answer(await platform.subscribeProjectState(cursor.request(), listener));
    await Bun.sleep(20);
    const before = received.length;
    await expect(platform.findReferences({ path: "a.json" })).rejects.toThrow();
    await until(() => ended > 0);
    cursor.answer(await platform.subscribeProjectState(cursor.request(), listener));
    const sent = received.slice(before);
    expect(sent.filter((frame) => frame.method === "projectSubscribe")).toEqual([
      { method: "projectSubscribe", params: { clientId: "cursor", epoch: "e3", sinceRev: 2 } },
    ]);
    expect(sent.some((frame) => frame.method === "listDirectory")).toBe(false);
  });
});
