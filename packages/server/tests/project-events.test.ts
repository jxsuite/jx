// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
/**
 * The dev server's project state service (`specs/project-state.md` §3.2, §5, §10.2): the
 * Server-Sent Events binding over a stand-in host, so every turn of it is observable, and then the
 * real dev server, whose stream a client reconnects to with `Last-Event-ID` and receives exactly
 * the events it missed.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeSseMessage,
  deletePrecondition,
  formatEventId,
  parseSseBlock,
  PROJECT_CLIENT_PARAM,
  PROJECT_EVENTS_PATH,
  PROJECT_ROOT_PARAM,
  encodeRenameOperation,
  writeIdentityHeaders,
  writePreconditionHeaders,
} from "@jxsuite/protocol/project-state-frames";
import { contentHash } from "@jxsuite/protocol/project-state";
import type {
  ContentHash,
  ProjectEvent,
  RenameOperation,
  RenameOperationResult,
} from "@jxsuite/protocol/project-state";
import { buildProjectExtensionRegistry } from "@jxsuite/compiler/format-host";
import { createProjectEventsService, isConditionalFileRequest } from "../src/project-events.ts";
import type { ProjectStateHost, ProjectStateHostOptions } from "../src/project-state/host.ts";
import { createDevServer } from "../src/server.ts";
import { fakeHost } from "./_fake-project-host.ts";
import type { FakeHost } from "./_fake-project-host.ts";

const changed = (rev: number, path = "pages/a.json"): ProjectEvent => ({
  docId: "d1",
  hash: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  origin: "external",
  path,
  rev,
  type: "fileChanged",
});

/** A service over stand-in hosts, each recorded as it is created. */
function service(overrides: Parameters<typeof createProjectEventsService>[0] = {}) {
  const hosts: FakeHost[] = [];
  const created: ProjectStateHostOptions[] = [];
  const svc = createProjectEventsService({
    createHost: (options) => {
      created.push(options);
      const host = fakeHost(options.root);
      hosts.push(host);
      return Promise.resolve(host);
    },
    ...overrides,
  });
  return { created, hosts, svc };
}

/** Read an event stream one message at a time. */
function sseReader(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    /** The next block's raw text, or `null` once the stream closed. */
    async block(): Promise<string | null> {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          return block;
        }
        const { done, value } = await reader.read();
        if (done) {
          return null;
        }
        buffer += decoder.decode(value);
      }
    },
    /** The next message of the exchange, skipping comments; `null` once the stream closed. */
    async next() {
      for (;;) {
        const block = await this.block();
        if (block === null) {
          return null;
        }
        const { data, event, id } = parseSseBlock(block);
        if (event !== "message") {
          return { id, message: decodeSseMessage(event, data)! };
        }
      }
    },
    cancel: () => reader.cancel(),
  };
}

/** Wait until `check` holds, polling; fail after `ms`. */
async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("timed out");
    }
    await Bun.sleep(2);
  }
}

/** The status a response settles with. */
const statusOf = (pending: Promise<Response>): Promise<number> => pending.then((res) => res.status);

const ROOT = "/project";
const url = (search = "") => new URL(`http://localhost${PROJECT_EVENTS_PATH}${search}`);
const events = (headers: Record<string, string> = {}) => new Request(url().href, { headers });

// ─── The stream ───────────────────────────────────────────────────────────────

describe("the project stream (§3.2)", () => {
  test("answers the subscribe first, then streams batched events whose id names the last", async () => {
    const { hosts, svc } = service();
    await svc.activate(ROOT);
    const res = await svc.handleEvents(events(), url(`?${PROJECT_CLIENT_PARAM}=tab-1`));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const host = hosts[0]!;
    expect(host.sinks.at(-1)!.request).toEqual({ clientId: "tab-1" });
    const stream = sseReader(res);
    const first = await stream.next();
    expect(first?.id).toBe(formatEventId("e1", 0));
    expect(first?.message.kind).toBe("subscribe");
    host.emit([changed(1)]);
    host.emit([changed(2)]);
    const batch = await stream.next();
    expect(batch?.id).toBe(formatEventId("e1", 2));
    expect(batch?.message).toEqual({
      epoch: "e1",
      events: [changed(1), changed(2)],
      kind: "events",
    });
    // The host ends the subscription: the stream closes, and the client subscribes again.
    host.end();
    expect(await stream.next()).toBeNull();
  });

  test("reads Last-Event-ID as the cursor, and an empty client id names none", async () => {
    const { hosts, svc } = service();
    await svc.activate(ROOT);
    const res = await svc.handleEvents(
      events({ "Last-Event-ID": formatEventId("e1", 7) }),
      url(`?${PROJECT_CLIENT_PARAM}=`),
    );
    expect(hosts[0]!.sinks.at(-1)!.request).toEqual({ epoch: "e1", sinceRev: 7 });
    await sseReader(res).cancel();
  });

  test("events and the end in one turn are sent, then the stream closes", async () => {
    const { hosts, svc } = service();
    await svc.activate(ROOT);
    const stream = sseReader(await svc.handleEvents(events(), url()));
    await stream.next();
    hosts[0]!.emit([changed(1)]);
    hosts[0]!.end();
    const sent = await stream.next();
    expect(sent?.message).toEqual({
      epoch: "e1",
      events: [changed(1)],
      kind: "events",
    });
    expect(await stream.next()).toBeNull();
  });

  test("a reader that falls behind the high-water mark is ended, not fed", async () => {
    const { hosts, svc } = service({ streamHighWater: 1 });
    await svc.activate(ROOT);
    const stream = sseReader(await svc.handleEvents(events(), url()));
    // Nothing is read: the answer alone fills the queue past one byte.
    hosts[0]!.emit([changed(1)]);
    await until(() => !hosts[0]!.sinks.at(-1)!.open);
    const answered = await stream.next();
    expect(answered?.message.kind).toBe("subscribe");
    expect(await stream.next()).toBeNull();
  });

  test("a reader that goes away closes its subscription; later events go nowhere", async () => {
    const { hosts, svc } = service();
    await svc.activate(ROOT);
    const stream = sseReader(await svc.handleEvents(events(), url()));
    await stream.next();
    // Events already scheduled when the reader leaves are dropped with it.
    hosts[0]!.emit([changed(1)]);
    await stream.cancel();
    const theirs = hosts[0]!.sinks.at(-1)!;
    expect(theirs.open).toBe(false);
    // The batch scheduled before it left runs against a finished stream and sends nothing.
    expect(() => {
      hosts[0]!.emit([changed(2)]);
      hosts[0]!.end();
    }).not.toThrow();
    await Promise.resolve();
    expect(theirs.open).toBe(false);
    // Only the service's own follower subscribed again after the end.
    expect(hosts[0]!.sinks.filter((entry) => entry.open)).toHaveLength(1);
  });

  test("a stream naming another project than the one served is refused", async () => {
    const { hosts, svc } = service();
    await svc.activate(ROOT);
    const refused = await svc.handleEvents(events(), url("?root=/other"));
    expect(refused.status).toBe(409);
    expect(hosts).toEqual([]);
    const named = await svc.handleEvents(events(), url(`?root=${ROOT}`));
    expect(named.status).toBe(200);
    await sseReader(named).cancel();
    // Named relative to the server's root, as the activation names it.
    const relative = await svc.handleEvents(events(), url("?root=project"), (raw) => `/${raw}`);
    expect(relative.status).toBe(200);
    await sseReader(relative).cancel();
  });

  test("an idle stream carries heartbeat comments", async () => {
    const { svc } = service({ heartbeatMs: 5 });
    await svc.activate(ROOT);
    const stream = sseReader(await svc.handleEvents(events(), url()));
    await stream.block();
    expect(await stream.block()).toBe(": heartbeat");
    await stream.cancel();
  });

  test("a host that cannot start answers 500, and the next request tries again", async () => {
    let attempts = 0;
    const svc = createProjectEventsService({
      createHost: (options) => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("no watcher"))
          : Promise.resolve(fakeHost(options.root));
      },
    });
    await svc.activate(ROOT);
    const refused = await svc.handleEvents(events(), url());
    expect(refused.status).toBe(500);
    expect(await refused.text()).toContain("no watcher");
    const res = await svc.handleEvents(events(), url());
    expect(res.status).toBe(200);
    await sseReader(res).cancel();
    expect(attempts).toBe(2);
  });

  test("no project active, or a stopped service, starts nothing", async () => {
    const { svc } = service();
    const subscribe = () => statusOf(svc.handleEvents(events(), url()));
    expect(svc.root).toBeNull();
    expect(await subscribe()).toBe(500);
    await svc.activate(ROOT);
    await svc.close();
    await svc.close();
    expect(await subscribe()).toBe(500);
    await expect(svc.start()).rejects.toThrow("stopping");
  });

  test("the host gets the collection loader's lists when the registry is known", async () => {
    const asked: string[] = [];
    const { created, svc } = service({
      registryFor: (root) => {
        asked.push(root);
        return buildProjectExtensionRegistry(tmpdir());
      },
    });
    await svc.activate(ROOT);
    await svc.start();
    const collections = created[0]!.collections!;
    expect(await collections({ config: { name: "p" }, files: [], root: ROOT })).toEqual({});
    expect(
      await collections({
        config: { content: { blog: { source: "./blog" } }, name: "p" },
        files: ["blog/a.md"],
        root: ROOT,
      }),
    ).toEqual({ blog: ["blog/a.md"] });
    expect(asked).toEqual([ROOT]);
    created[0]!.onError!(new Error("a watch error"));
  });
});

// ─── Activation and followers ─────────────────────────────────────────────────

describe("activation (§10.2)", () => {
  test("activating the same project changes nothing; another ends every stream", async () => {
    const { hosts, svc } = service();
    const seen: string[] = [];
    const retired: string[] = [];
    svc.follow({
      events: (root, batch) => {
        seen.push(`${root}:${batch.map((event) => event.rev).join(",")}`);
      },
      retired: (root) => {
        retired.push(root);
      },
    });
    await svc.activate(ROOT);
    const stream = sseReader(await svc.handleEvents(events(), url()));
    await stream.next();
    await svc.activate(`${ROOT}/`);
    expect(hosts[0]!.closed).toBe(false);
    hosts[0]!.emit([changed(1)]);
    expect(seen).toEqual([`${ROOT}:1`]);
    await stream.next();

    await svc.activate("/other");
    expect(hosts[0]!.closed).toBe(true);
    expect(retired).toEqual([ROOT]);
    expect(await stream.next()).toBeNull();
    expect(svc.host).toBeNull();
    // The next request starts a host over the new root.
    const next = await svc.start();
    expect(next.root).toBe("/other");
  });

  test("a start still in flight when another project is activated is closed", async () => {
    let release!: (host: FakeHost) => void;
    const pending = fakeHost(ROOT);
    const svc = createProjectEventsService({
      createHost: () =>
        new Promise<ProjectStateHost>((resolve) => {
          release = resolve;
        }),
    });
    await svc.activate(ROOT);
    const starting = svc.start();
    const switching = svc.activate("/other");
    release(pending);
    await switching;
    await expect(starting).rejects.toThrow("no longer active");
    expect(pending.closed).toBe(true);
    expect(svc.host).toBeNull();
  });

  test("followers keep following across the host ending a subscription, and can stop", async () => {
    const { hosts, svc } = service();
    const seen: number[] = [];
    const stop = svc.follow({
      events: (_root, batch) => {
        seen.push(...batch.map((event) => event.rev));
      },
    });
    await svc.activate(ROOT);
    await svc.start();
    // A watcher recovery ends every subscription; the follower subscribes again.
    hosts[0]!.end();
    hosts[0]!.emit([changed(1)]);
    stop();
    hosts[0]!.emit([changed(2)]);
    expect(seen).toEqual([1]);
    await svc.close();
  });

  test("a resubscribe answered by a snapshot reaches the followers; the first answer does not", async () => {
    const { hosts, svc } = service();
    const resynced: string[] = [];
    svc.follow({
      events: () => {},
      resynced: (root, snapshot) => {
        resynced.push(`${root}:${snapshot.files.length}`);
      },
    });
    await svc.activate(ROOT);
    await svc.start();
    expect(resynced).toEqual([]);
    hosts[0]!.end();
    expect(resynced).toEqual([`${ROOT}:0`]);
    // An answer from the log is the events between, which the follower is sent as they come.
    hosts[0]!.subscribe = (request, sink) => {
      hosts[0]!.sinks.push({ open: true, request, sink });
      return { close: () => {}, response: { epoch: "e1", events: [], kind: "events", rev: 0 } };
    };
    hosts[0]!.end();
    expect(resynced).toHaveLength(1);
    await svc.close();
  });

  test("a retiring follower saves through the host before it closes; a failure is reported", async () => {
    const { hosts, svc } = service();
    const order: string[] = [];
    svc.follow({
      events: () => {},
      retiring: (running) => {
        order.push(`retiring ${running.root} closed=${String(hosts[0]!.closed)}`);
        return Promise.reject(new Error("disk full"));
      },
    });
    const errors: string[] = [];
    const original = console.error;
    console.error = (message: string) => errors.push(message);
    try {
      await svc.activate(ROOT);
      await svc.start();
      await svc.activate("/other");
    } finally {
      console.error = original;
    }
    expect(order).toEqual([`retiring ${ROOT} closed=false`]);
    expect(hosts[0]!.closed).toBe(true);
    expect(errors[0]).toContain("disk full");
  });
});

// ─── The live preview overlay (§11.3) ─────────────────────────────────────────

describe("the live preview overlay (§11.3)", () => {
  /** A service whose overlay publishes into a log of `root path=contents` lines. */
  function overlaid(graceMs = 1000) {
    const log: string[] = [];
    const made = service({
      overlayGraceMs: graceMs,
      publish: (root, path, contents) => log.push(`${root} ${path}=${contents}`),
      unpublish: (root, path) => log.push(`${root} ${path}=`),
    });
    return { ...made, log };
  }

  const renamed = (rev: number, from: string, to: string): ProjectEvent => ({
    docId: "d1",
    from,
    isDir: false,
    origin: "external",
    rev,
    to,
    type: "fileRenamed",
  });

  test("follows its document across a rename, and is dropped with it", async () => {
    const { hosts, log, svc } = overlaid();
    await svc.activate(ROOT);
    await svc.start();
    hosts[0]!.docs.set("pages/a.json", "d1");
    svc.setOverlay({ contents: "A", path: "pages/a.json" });
    hosts[0]!.emit([renamed(1, "pages/a.json", "pages/b.json")]);
    hosts[0]!.emit([
      {
        docId: "d1",
        isDir: false,
        origin: "external",
        path: "pages/b.json",
        rev: 2,
        type: "fileRemoved",
      },
    ]);
    expect(log).toEqual([
      `${ROOT} pages/a.json=A`,
      `${ROOT} pages/a.json=`,
      `${ROOT} pages/b.json=A`,
      `${ROOT} pages/b.json=`,
    ]);
    await svc.close();
  });

  test("one client clearing its overlay shows another's, and clearing all clears its own", async () => {
    const { log, svc } = overlaid();
    await svc.activate(ROOT);
    svc.setOverlay({ clientId: "tab-1", contents: "one", path: "pages/a.json" });
    svc.setOverlay({ clientId: "tab-2", contents: "two", path: "pages/a.json" });
    svc.clearOverlay({ clientId: "tab-2", path: "pages/a.json" });
    svc.clearOverlay({ clientId: "tab-2", path: "pages/none.json" });
    svc.setOverlay({ contents: "shared", path: "pages/b.json" });
    svc.clearOverlay({});
    expect(log).toEqual([
      `${ROOT} pages/a.json=one`,
      `${ROOT} pages/a.json=two`,
      `${ROOT} pages/a.json=one`,
      `${ROOT} pages/b.json=shared`,
      `${ROOT} pages/b.json=`,
    ]);
    await svc.close();
    expect(log.at(-1)).toBe(`${ROOT} pages/a.json=`);
  });

  test("a client's overlays outlive its last stream by the grace, and no longer", async () => {
    const { log, svc } = overlaid(20);
    await svc.activate(ROOT);
    const stream = sseReader(
      await svc.handleEvents(events(), url(`?${PROJECT_CLIENT_PARAM}=tab-1`)),
    );
    await stream.next();
    svc.setOverlay({ clientId: "tab-1", contents: "mine", path: "pages/a.json" });
    await stream.cancel();
    expect(log).toEqual([`${ROOT} pages/a.json=mine`]);
    await until(() => log.length === 2);
    expect(log[1]).toBe(`${ROOT} pages/a.json=`);
    await svc.close();
  });

  test("activating another project unpublishes the overlays of the one before", async () => {
    const { log, svc } = overlaid();
    svc.setOverlay({ contents: "before", path: "pages/a.json" });
    await svc.activate(ROOT);
    svc.setOverlay({ contents: "A", path: "pages/a.json" });
    await svc.activate("/other");
    svc.setOverlay({ contents: "O", path: "pages/a.json" });
    expect(log).toEqual([
      `${ROOT} pages/a.json=A`,
      `${ROOT} pages/a.json=`,
      "/other pages/a.json=O",
    ]);
    await svc.close();
  });

  test("a resubscribe answered by a snapshot drops the overlays of documents it no longer holds", async () => {
    const { hosts, log, svc } = overlaid();
    await svc.activate(ROOT);
    await svc.start();
    svc.setOverlay({ contents: "A", path: "pages/a.json" });
    svc.setOverlay({ contents: "B", path: "pages/b.json" });
    hosts[0]!.snapshot = () => ({
      components: [],
      files: [{ docId: "d2", indexed: true, isDir: false, kind: "page", path: "pages/b.json" }],
      formats: "",
      readiness: "ready",
    });
    hosts[0]!.end();
    expect(log.slice(2)).toEqual([`${ROOT} pages/a.json=`]);
    await svc.close();
  });

  test("without an embedder to publish to, an overlay is kept and shown to no one", async () => {
    const { svc } = service();
    await svc.activate(ROOT);
    expect(() => {
      svc.setOverlay({ contents: "A", path: "pages/a.json" });
      svc.clearOverlay({ path: "pages/a.json" });
    }).not.toThrow();
    await svc.close();
  });
});

// ─── Writes and deletes (§5) ──────────────────────────────────────────────────

const H = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" as const;

function put(headers: Record<string, string>, body = "{}\n"): Request {
  return new Request("http://localhost/__studio/file", { body, headers, method: "PUT" });
}

function del(headers: Record<string, string>, body?: string): Request {
  return new Request("http://localhost/__studio/file", {
    ...(body !== undefined && { body }),
    headers,
    method: "DELETE",
  });
}

describe("conditional writes and deletes (§5)", () => {
  test("a request names its base or its issuer to be conditional", () => {
    expect(isConditionalFileRequest(put({}))).toBe(false);
    expect(isConditionalFileRequest(put({ "If-Match": `"${H}"` }))).toBe(true);
    expect(isConditionalFileRequest(put({ "If-None-Match": "*" }))).toBe(true);
    const named = del(writeIdentityHeaders({ writeId: "w" }));
    expect(isConditionalFileRequest(named)).toBe(true);
  });

  test("a write with its base reaches the host and answers its hash as the ETag", async () => {
    const { hosts, svc } = service();
    await svc.activate(ROOT);
    const res = await svc.handleWrite(
      put({
        ...writePreconditionHeaders(H),
        ...writeIdentityHeaders({ bufferRev: 2, writeId: "w1" }),
      }),
      `${ROOT}/pages/a.json`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('"sha256-new"');
    expect(await res.json()).toEqual({
      hash: "sha256-new",
      ok: true,
      path: "pages/a.json",
      rev: 3,
    });
    const [write] = hosts[0]!.writes;
    expect(write).toMatchObject({ baseHash: H, bufferRev: 2, path: "pages/a.json", writeId: "w1" });
    // The route hands the host the body's bytes, never a decoded string.
    expect(write!.contents).toEqual(new TextEncoder().encode("{}\n"));
  });

  test("a stale base is a 412 naming what is on disk", async () => {
    const { hosts, svc } = service();
    await svc.activate(ROOT);
    await svc.start();
    const conflict = { diskHash: H, docId: "d1", path: "pages/a.json" };
    hosts[0]!.writeAnswer = { conflict, ok: false };
    hosts[0]!.deleteAnswer = { conflict, ok: false };
    const headers = {
      ...writePreconditionHeaders(null),
      ...writeIdentityHeaders({ writeId: "w" }),
    };
    const refused = await svc.handleWrite(put(headers), `${ROOT}/pages/a.json`);
    expect(refused.status).toBe(412);
    expect(await refused.json()).toMatchObject({ ...conflict, status: 412 });
    const deleted = await svc.handleDelete(
      del({
        ...deletePrecondition({ hash: H }).headers,
        ...writeIdentityHeaders({ writeId: "w" }),
      }),
      `${ROOT}/pages/a.json`,
    );
    expect(deleted.status).toBe(412);
  });

  test("a request without a readable base or issuer, or outside the project, is a 400", async () => {
    const { hosts, svc } = service();
    const at = `${ROOT}/pages/a.json`;
    const identity = writeIdentityHeaders({ writeId: "w" });
    const based = writePreconditionHeaders(H);
    const writing = (headers: Record<string, string>, to = at) =>
      statusOf(svc.handleWrite(put(headers), to));
    const deleting = (headers: Record<string, string>, to = at) =>
      statusOf(svc.handleDelete(del(headers), to));
    expect(await writing(identity)).toBe(400);
    await svc.activate(ROOT);
    expect(await writing({ ...identity, "If-Match": "*" })).toBe(400);
    expect(await writing(based)).toBe(400);
    expect(await writing({ ...identity, ...based }, "/elsewhere/a.json")).toBe(400);
    expect(await writing({ ...identity, ...based }, ROOT)).toBe(400);
    expect(await deleting(identity)).toBe(400);
    expect(await deleting(based)).toBe(400);
    expect(await deleting(identity, "/elsewhere/a.json")).toBe(400);
    expect(hosts).toEqual([]);
  });

  test("a directory delete carries its files in the body", async () => {
    const { hosts, svc } = service();
    await svc.activate(ROOT);
    const base = deletePrecondition({ files: { "a.json": H } });
    const res = await svc.handleDelete(
      del({ ...base.headers, ...writeIdentityHeaders({ writeId: "w2" }) }, base.body),
      `${ROOT}/pages`,
    );
    expect(await res.json()).toEqual({ ok: true, path: "pages", rev: 4 });
    expect(hosts[0]!.deletes).toEqual([
      { base: { files: { "a.json": H } }, path: "pages", writeId: "w2" },
    ]);
  });
});

// ─── The rename cascade (§9) ──────────────────────────────────────────────────

describe("a rename as one operation (§9)", () => {
  const post = (body: string): Request =>
    new Request("http://localhost/__studio/project/rename", { body, method: "POST" });
  const op: RenameOperation = {
    dirtyReferrers: [],
    from: "media/a.png",
    opId: "op",
    policy: "rewrite-buffer",
    to: "media/b.png",
  };
  const applied: RenameOperationResult = {
    buffers: [],
    errors: [],
    files: ["media/b.png"],
    from: "media/a.png",
    isDir: false,
    ok: true,
    opId: "op",
    references: { files: [], filesChanged: 0, refsUpdated: 0 },
    rev: 9,
    to: "media/b.png",
  };

  /** A rename request that names no project, as a client that predates the parameter sends. */
  const RENAME_URL = new URL("http://x/__studio/project/rename");

  test("reaches the host, answers its result, and tells who follows a move", async () => {
    const { hosts, svc } = service();
    await svc.activate(ROOT);
    await svc.start();
    const seen: RenameOperation[] = [];
    hosts[0]!.rename = (operation) => {
      seen.push(operation);
      return Promise.resolve(applied);
    };
    const moved: string[] = [];
    const body = JSON.stringify(encodeRenameOperation(op));
    const named = new URL(`http://x/__studio/project/rename?${PROJECT_ROOT_PARAM}=${ROOT}`);
    const res = await svc.handleRename(post(body), named, undefined, (path) => moved.push(path));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(applied);
    expect(seen).toEqual([op]);
    expect(moved).toEqual(["media/a.png"]);
    const refused: RenameOperationResult = {
      message: "no",
      ok: false,
      opId: "op",
      paths: [],
      reason: "failed",
    };
    hosts[0]!.rename = () => Promise.resolve(refused);
    const again = await svc.handleRename(post(JSON.stringify(op)), RENAME_URL, undefined, (path) =>
      moved.push(path),
    );
    expect(await again.json()).toEqual(refused);
    expect(moved).toEqual(["media/a.png"]);
  });

  test("a malformed operation or a bad path is a 400, and a host failure a 500", async () => {
    const { hosts, svc } = service();
    await svc.activate(ROOT);
    const statusOfRename = async (body: string): Promise<number> => {
      const res = await svc.handleRename(post(body), RENAME_URL);
      return res.status;
    };
    const good = JSON.stringify(op);
    const badPolicy = JSON.stringify({ ...op, policy: "x" });
    expect(await statusOfRename("{")).toBe(400);
    expect(await statusOfRename(badPolicy)).toBe(400);
    await svc.start();
    hosts[0]!.rename = () => Promise.reject(new TypeError("Not a project-relative path"));
    expect(await statusOfRename(good)).toBe(400);
    hosts[0]!.rename = () => Promise.reject(new Error("disk on fire"));
    expect(await statusOfRename(good)).toBe(500);
  });

  test("a rename naming another project than the one served is refused, untouched", async () => {
    const { hosts, svc } = service();
    await svc.activate(ROOT);
    await svc.start();
    const seen: RenameOperation[] = [];
    hosts[0]!.rename = (operation) => {
      seen.push(operation);
      return Promise.resolve(applied);
    };
    const other = new URL(`http://x/__studio/project/rename?${PROJECT_ROOT_PARAM}=/other`);
    const res = await svc.handleRename(post(JSON.stringify(op)), other);
    expect(res.status).toBe(409);
    expect(seen).toEqual([]);
  });
});

// ─── The usage query (§12) ────────────────────────────────────────────────────

describe("the usage query reads the graph (§12)", () => {
  test("only the running host of the project asked about, once it is indexed and settled", async () => {
    const { hosts, svc } = service({ settleLimitMs: 5 });
    await svc.activate(ROOT);
    expect(await svc.references(ROOT)).toBeNull();
    await svc.start();
    expect(await svc.references("/other")).toBeNull();
    expect(await svc.references(ROOT)).toEqual({ documents: [], extensions: [], mounts: [] });
    hosts[0]!.graph = false;
    expect(await svc.references(ROOT)).toBeNull();
    hosts[0]!.graph = true;
    hosts[0]!.settles = false;
    expect(await svc.references(ROOT)).toBeNull();
  });
});

// ─── The dev server ───────────────────────────────────────────────────────────

describe("the dev server's stream", () => {
  const dirs: string[] = [];
  const project = (name: string): string => {
    const dir = mkdtempSync(join(tmpdir(), `jx-project-events-${name}-`));
    dirs.push(dir);
    mkdirSync(join(dir, "pages"));
    writeFileSync(join(dir, "project.json"), JSON.stringify({ name }));
    writeFileSync(join(dir, "pages/index.json"), '{ "tagName": "main" }\n');
    return dir;
  };
  afterAll(() => {
    for (const dir of dirs) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** Follow the stream until a frame's id reaches `rev`. */
  async function untilRev(stream: ReturnType<typeof sseReader>, epoch: string, rev: number) {
    const seen: ProjectEvent[] = [];
    while ((seen.at(-1)?.rev ?? 0) < rev) {
      const next = await stream.next();
      if (next === null) {
        throw new Error("the stream closed");
      }
      if (next.message.kind === "events" && next.message.epoch === epoch) {
        seen.push(...next.message.events);
      }
    }
    return seen;
  }

  test("a reconnect with Last-Event-ID receives exactly the events it missed", async () => {
    const root = project("replay");
    const server = await createDevServer({ port: 0, root, watch: false });
    const base = `http://127.0.0.1:${server.port}`;
    const write = async (contents: string, writeId: string, baseHash: ContentHash | null) => {
      const res = await fetch(`${base}/__studio/file?path=pages/index.json`, {
        body: contents,
        headers: {
          ...writePreconditionHeaders(baseHash),
          ...writeIdentityHeaders({ writeId }),
        },
        method: "PUT",
      });
      expect(res.status).toBe(200);
      /* SAFETY: a 200 from the conditional write route is the JSON `handleWrite` builds from the
         host's `{ ok: true, rev, hash }`. */
      return (await res.json()) as { rev: number; hash: ContentHash };
    };
    try {
      const first = sseReader(await fetch(`${base}${PROJECT_EVENTS_PATH}`));
      const answer = await first.next();
      if (answer?.message.kind !== "subscribe") {
        throw new Error("no answer");
      }
      const { epoch } = answer.message.response;
      const hash = await contentHash('{ "tagName": "main" }\n');
      const one = await write('{ "tagName": "main", "id": 1 }\n', "w1", hash);
      const seen = await untilRev(first, epoch, one.rev);
      const applied = seen.at(-1)!.rev;
      // The client goes away, two more writes land, and it comes back with its last id.
      await first.cancel();
      const two = await write('{ "tagName": "main", "id": 2 }\n', "w2", one.hash);
      const three = await write('{ "tagName": "main", "id": 3 }\n', "w3", two.hash);
      const again = sseReader(
        await fetch(`${base}${PROJECT_EVENTS_PATH}`, {
          headers: { "Last-Event-ID": formatEventId(epoch, applied) },
        }),
      );
      const resumed = await again.next();
      if (resumed?.message.kind !== "subscribe" || resumed.message.response.kind !== "events") {
        throw new Error("no replay");
      }
      const missed = resumed.message.response.events;
      // Every revision after the cursor, in order and with no gap, through the last write's.
      expect(missed.map((event) => event.rev - applied)).toEqual(missed.map((_, at) => at + 1));
      expect(missed.at(-1)!.rev).toBeGreaterThanOrEqual(three.rev);
      const writers = missed.flatMap((event) =>
        event.type === "fileChanged" && event.origin !== "external" ? [event.origin.writeId] : [],
      );
      expect(writers).toEqual(["w2", "w3"]);
      // An id from another epoch is a snapshot.
      const other = sseReader(
        await fetch(`${base}${PROJECT_EVENTS_PATH}`, {
          headers: { "Last-Event-ID": formatEventId("gone", 1) },
        }),
      );
      const fresh = await other.next();
      expect(fresh?.message.kind === "subscribe" && fresh.message.response.kind).toBe("snapshot");
      await other.cancel();
      await again.cancel();
      // A stale base is refused over HTTP with the conflict.
      const stale = await fetch(`${base}/__studio/file?path=pages/index.json`, {
        body: "{}",
        headers: { ...writePreconditionHeaders(hash), ...writeIdentityHeaders({ writeId: "w4" }) },
        method: "PUT",
      });
      expect(stale.status).toBe(412);
      expect(await stale.json()).toMatchObject({ diskHash: three.hash, path: "pages/index.json" });
    } finally {
      await server.stop(true);
    }
  }, 30_000);

  test("activating another project ends the stream; the next one is a new epoch", async () => {
    const root = project("first");
    const other = project("second");
    const server = await createDevServer({ allowedRoots: [other], port: 0, root, watch: false });
    const base = `http://127.0.0.1:${server.port}`;
    const activate = (dir: string | null) =>
      fetch(`${base}/__studio/activate`, {
        body: JSON.stringify({ root: dir }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    try {
      const naming = `${base}${PROJECT_EVENTS_PATH}?root=${encodeURIComponent(root)}`;
      const stream = sseReader(await fetch(naming));
      const answer = await stream.next();
      expect(await statusOf(activate(other))).toBe(200);
      // A tab still naming the first project is refused rather than served the second's state.
      expect(await statusOf(fetch(naming))).toBe(409);
      while ((await stream.next()) !== null) {
        // Events the first host sent before it ended.
      }
      const next = sseReader(await fetch(`${base}${PROJECT_EVENTS_PATH}`));
      const fresh = await next.next();
      if (answer?.message.kind !== "subscribe" || fresh?.message.kind !== "subscribe") {
        throw new Error("no answer");
      }
      expect(fresh.message.response.epoch).not.toBe(answer.message.response.epoch);
      expect(await statusOf(activate(null))).toBe(200);
      expect(
        await next.next().then(async function drain(message): Promise<null> {
          return message === null ? null : drain(await next.next());
        }),
      ).toBeNull();
    } finally {
      await server.stop(true);
    }
  }, 30_000);

  /** A dev server over a stand-in host, so the socket's side of the stream is what is observed. */
  async function overSocket(options: { streamHighWater?: number } = {}) {
    const hosts: FakeHost[] = [];
    const server = await createDevServer({
      port: 0,
      projectState: {
        createHost: (made) => {
          const host = fakeHost(made.root);
          hosts.push(host);
          return Promise.resolve(host);
        },
        ...options,
      },
      root: project("socket"),
      watch: false,
    });
    return { base: `http://127.0.0.1:${server.port}`, hosts, server };
  }

  test("a client that aborts its request closes its subscription", async () => {
    const { base, hosts, server } = await overSocket();
    try {
      const abort = new AbortController();
      const res = await fetch(`${base}${PROJECT_EVENTS_PATH}`, { signal: abort.signal });
      const stream = sseReader(res);
      await stream.next();
      const theirs = hosts[0]!.sinks.at(-1)!;
      expect(theirs.open).toBe(true);
      abort.abort();
      await until(() => !theirs.open);
    } finally {
      await server.stop(true);
    }
  }, 30_000);

  test("a reader that stops reading is ended once it falls past the high-water mark", async () => {
    const { base, hosts, server } = await overSocket({ streamHighWater: 1024 });
    try {
      const res = await fetch(`${base}${PROJECT_EVENTS_PATH}`);
      const stream = sseReader(res);
      await stream.next();
      const theirs = hosts[0]!.sinks.at(-1)!;
      // The client reads nothing more, so the socket's buffers fill and the stream's queue grows.
      const long = `pages/${"x".repeat(64 * 1024)}.json`;
      for (let rev = 1; theirs.open && rev < 10_000; rev++) {
        hosts[0]!.emit([changed(rev, long)]);
        await Bun.sleep(0);
      }
      expect(theirs.open).toBe(false);
      await stream.cancel();
    } finally {
      await server.stop(true);
    }
  }, 30_000);
});
