import { CLOUD_PROJECT, CLOUD_SESSION_BASE } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import {
  encodeCloudEnded,
  encodeCloudEvents,
  encodeCloudSubscribeAnswer,
  preconditionFailedProblem,
} from "@jxsuite/protocol/project-state-frames";
import { contentHash } from "@jxsuite/protocol/project-state";
import type {
  ProjectEvent,
  RenameOperationResult,
  SubscribeResponse,
} from "@jxsuite/protocol/project-state";
import { createCloudPlatform } from "../src/platforms/cloud";
import { startProjectStateSubscription } from "../src/project-state/subscription";
import { createContentStore } from "../src/project-state/store";

/*
 * The Cloud adapter's project state members (`project-state.md` §3.2, §10.3): the subscribe
 * exchange on a socket of their own, and the conditional writes, deletes and renames on the
 * session's `/project-state/*` routes. The binding's own rules are `@jxsuite/protocol`'s tests;
 * these pin what the adapter hands it: the session's base, its socket, and its requests.
 */

const HASH = await contentHash("a");

/** The message a promise rejects with, failing the case when it fulfils. */
async function failureOf(pending: Promise<object | null>): Promise<string> {
  return pending.then(
    () => "fulfilled",
    (error: Error) => error.message,
  );
}

const realFetch = globalThis.fetch;
const realWs = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");

interface Recorded {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response): Recorded[] {
  const calls: Recorded[] = [];
  globalThis.fetch = Object.assign(
    async (resource: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init, url: String(resource) });
      return handler(String(resource), init);
    },
    { preconnect: realFetch.preconnect },
  );
  return calls;
}

type Listener = (event: { data?: unknown }) => void;
const sockets: MockSocket[] = [];

/** The slice of a WebSocket the adapter drives. */
class MockSocket {
  url: string;
  sent: string[] = [];
  closed = false;
  listeners = new Map<string, Listener[]>();
  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event: { data?: unknown } = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.closed = true;
  }
}

function installSockets() {
  sockets.length = 0;
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: MockSocket,
    writable: true,
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realWs) {
    Object.defineProperty(globalThis, "WebSocket", realWs);
  }
});

const tick = () =>
  new Promise((resume) => {
    setTimeout(resume, 0);
  });

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !done(); i += 1) {
    await tick();
  }
}

const CLOUD_SNAPSHOT: SubscribeResponse = {
  epoch: "e1",
  kind: "snapshot",
  rev: 1,
  snapshot: { components: [], files: [], formats: "", readiness: "ready" },
};

const changed: ProjectEvent = {
  docId: "d1",
  hash: HASH,
  origin: "external",
  path: "a.json",
  rev: 2,
  type: "fileChanged",
};

describe("the Cloud adapter's project state", () => {
  test("the hub has no session, so no project state members", () => {
    const hub = createCloudPlatform(null);
    expect(hub.subscribeProjectState).toBeUndefined();
    expect(hub.writeProjectState).toBeUndefined();
    expect(hub.deleteProjectState).toBeUndefined();
    expect(hub.renameProjectState).toBeUndefined();
  });

  test("a subscribe asks the capability, then runs the exchange on the session's socket", async () => {
    installSockets();
    const calls = stubFetch(() => Response.json({ version: 1 }));
    const platform = createCloudPlatform({ ...CLOUD_PROJECT });
    const frames: unknown[] = [];
    const ended: string[] = [];
    const answer = platform.subscribeProjectState!(
      { clientId: "w" },
      { ended: (epoch) => ended.push(epoch), events: (params) => frames.push(params) },
    );
    await until(() => sockets.length > 0);
    expect(calls[0]!.url).toBe(`${CLOUD_SESSION_BASE}/project-state`);
    const [socket] = sockets;
    expect(socket!.url).toContain(`${CLOUD_SESSION_BASE}/events`);
    socket!.emit("open");
    expect(JSON.parse(socket!.sent[0]!)).toEqual({ clientId: "w", kind: "subscribe" });
    // A binary frame is no part of the exchange.
    socket!.emit("message", { data: new ArrayBuffer(1) });
    socket!.emit("message", { data: encodeCloudSubscribeAnswer(CLOUD_SNAPSHOT) });
    expect(await answer).toEqual(CLOUD_SNAPSHOT);
    socket!.emit("message", { data: encodeCloudEvents("e1", [changed]) });
    await tick();
    expect(frames).toEqual([{ epoch: "e1", events: [changed] }]);
    socket!.emit("message", { data: encodeCloudEnded("e1") });
    await tick();
    expect(ended).toEqual(["e1"]);
    expect(socket!.closed).toBe(true);
  });

  /* `project-state.md` §3.3: a dropped socket is repaired by subscribing again with the cursor, on a
     socket of its own, and by nothing else: no listing, no resync reason. */
  test("a reconnect is a subscribe with { epoch, sinceRev }, and lists nothing", async () => {
    installSockets();
    const calls = stubFetch(() => Response.json({ version: 1 }));
    const platform = createCloudPlatform({ ...CLOUD_PROJECT });
    const sub = startProjectStateSubscription({
      clientId: "w",
      retryDelay: () => 0,
      store: createContentStore(),
      subscribe: platform.subscribeProjectState!,
    });
    await until(() => sockets.length > 0);
    sockets[0]!.emit("open");
    sockets[0]!.emit("message", { data: encodeCloudSubscribeAnswer(CLOUD_SNAPSHOT) });
    sockets[0]!.emit("message", { data: encodeCloudEvents("e1", [changed]) });
    await until(() => sub.live);
    // The socket drops: a deploy, a sleeping laptop.
    sockets[0]!.emit("close");
    await until(() => sockets.length > 1);
    sockets[1]!.emit("open");
    expect(JSON.parse(sockets[1]!.sent[0]!)).toEqual({
      clientId: "w",
      epoch: "e1",
      kind: "subscribe",
      sinceRev: 2,
    });
    // The capability was asked once; nothing else went over HTTP.
    expect(calls.map((call) => call.url)).toEqual([`${CLOUD_SESSION_BASE}/project-state`]);
    sub.stop();
  });

  test("a session that predates the binding rejects the subscribe and opens no socket", async () => {
    installSockets();
    stubFetch(() => new Response("Not found", { status: 404 }));
    const platform = createCloudPlatform({ ...CLOUD_PROJECT });
    expect(await failureOf(platform.subscribeProjectState!({}, { events: () => {} }))).toContain(
      "does not serve",
    );
    expect(sockets).toEqual([]);
  });

  test("a write and a delete name their base on the session's routes", async () => {
    const other = await contentHash("b");
    const calls = stubFetch((_url, init) =>
      init?.method === "PUT"
        ? Response.json({ hash: other, ok: true, path: "pages/a.json", rev: 4 })
        : Response.json({ ok: true, path: "pages/a.json", rev: 5 }),
    );
    const platform = createCloudPlatform({ ...CLOUD_PROJECT });
    expect(
      await platform.writeProjectState!({
        baseHash: HASH,
        contents: "b",
        path: "pages/a.json",
        writeId: "w1",
      }),
    ).toEqual({ hash: other, ok: true, rev: 4 });
    expect(
      await platform.deleteProjectState!({
        base: { hash: other },
        path: "pages/a.json",
        writeId: "d",
      }),
    ).toEqual({ ok: true, rev: 5 });
    expect(calls.map((call) => [call.init?.method, call.url])).toEqual([
      ["PUT", `${CLOUD_SESSION_BASE}/project-state/file?path=pages%2Fa.json`],
      ["DELETE", `${CLOUD_SESSION_BASE}/project-state/file?path=pages%2Fa.json`],
    ]);
    expect(calls[0]!.init?.headers).toEqual({ "If-Match": `"${HASH}"`, "Jx-Write-Id": "w1" });
    expect(calls[0]!.init?.credentials).toBe("include");
  });

  test("a stale base answers its conflict", async () => {
    const conflict = { diskHash: HASH, docId: "d1", path: "a.json" };
    stubFetch(() => Response.json(preconditionFailedProblem(conflict), { status: 412 }));
    const platform = createCloudPlatform({ ...CLOUD_PROJECT });
    expect(
      await platform.writeProjectState!({
        baseHash: null,
        contents: "x",
        path: "a.json",
        writeId: "w",
      }),
    ).toEqual({ conflict, ok: false });
  });

  test("a rename is one operation on the session's rename route", async () => {
    const result: RenameOperationResult = {
      buffers: [],
      errors: [],
      files: ["b.json"],
      from: "a.json",
      isDir: false,
      ok: true,
      opId: "op",
      references: { files: [], filesChanged: 0, refsUpdated: 0 },
      rev: 3,
      to: "b.json",
    };
    const calls = stubFetch(() => Response.json(result));
    const platform = createCloudPlatform({ ...CLOUD_PROJECT });
    const operation = {
      dirtyReferrers: [],
      from: "a.json",
      opId: "op",
      policy: "rewrite-buffer" as const,
      rewrites: [{ baseHash: HASH, contents: "x", path: "c.md" }],
      to: "b.json",
    };
    expect(await platform.renameProjectState!(operation)).toEqual(result);
    expect(calls[0]!.url).toBe(`${CLOUD_SESSION_BASE}/project-state/rename`);
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(operation);
  });
});
