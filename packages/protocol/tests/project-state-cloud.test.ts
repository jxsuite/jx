/**
 * The cloud binding's two halves turn by turn (`specs/project-state.md` §3.2, §5, §9): the host's
 * answers to each route, its refusals included, and the client's reading of the capability route,
 * the socket and the replies. The whole contract through the binding is
 * `project-state-cloud-binding.test.ts`.
 */

import { describe, expect, spyOn, test } from "bun:test";
import {
  answerCloudProjectRequest,
  CLOUD_PROJECT_FILE_PATH,
  CLOUD_PROJECT_RENAME_PATH,
  CLOUD_PROJECT_STATE_PATH,
  CLOUD_PROJECT_STATE_VERSION,
  createCloudProjectStateClient,
  parseCloudProjectStateInfo,
  isProjectRelativePath,
} from "../src/project-state-cloud";
import type {
  CloudProjectStateService,
  CloudProjectStateTransport,
  CloudSocketHandlers,
} from "../src/project-state-cloud";
import {
  encodeCloudEnded,
  encodeCloudEvents,
  encodeCloudSubscribeAnswer,
  encodeRenameOperation,
  preconditionFailedProblem,
} from "../src/project-state-frames";
import type { ProjectEventsParams } from "../src/project-state-frames";
import { contentHash } from "../src/project-state";
import type {
  ProjectEvent,
  RenameOperationResult,
  SubscribeResponse,
  WriteRequest,
} from "../src/project-state";
import { tick } from "./cloud-session";

const HASH = await contentHash("a");

/** The message a promise rejects with, failing the case when it fulfils. */
async function failureOf(pending: Promise<object | null>): Promise<string> {
  return pending.then(
    () => "fulfilled",
    (error: Error) => error.message,
  );
}

const OTHER = await contentHash("b");

const APPLIED: RenameOperationResult = {
  buffers: [],
  errors: [],
  files: ["b.json"],
  from: "a.json",
  isDir: false,
  ok: true,
  opId: "op",
  references: { files: [], filesChanged: 0, refsUpdated: 0 },
  rev: 4,
  to: "b.json",
};

/** A service that records what it was asked and answers as told. */
function service(overrides: Partial<CloudProjectStateService> = {}) {
  const calls: unknown[] = [];
  const base: CloudProjectStateService = {
    delete: async (request) => {
      calls.push(request);
      return { ok: true, rev: 3 };
    },
    rename: async (operation) => {
      calls.push(operation);
      return APPLIED;
    },
    write: async (request) => {
      calls.push(request);
      return { hash: await contentHash(request.contents), ok: true, rev: 2 };
    },
    ...overrides,
  };
  return { calls, service: base };
}

const at = (route: string, init: RequestInit = {}) =>
  new Request(`https://session.test${route}`, init);

const answer = async (
  route: string,
  init: RequestInit,
  over: Partial<CloudProjectStateService> = {},
) => {
  const { calls, service: svc } = service(over);
  const res = await answerCloudProjectRequest(
    at(route, init),
    new URL(at(route).url).pathname,
    svc,
  );
  return { calls, res: res!, body: res === null ? null : await res.json() };
};

describe("the host's half", () => {
  test("the capability route answers the binding's version", async () => {
    const served = await answer(CLOUD_PROJECT_STATE_PATH, {});
    expect(served.body).toEqual({ version: CLOUD_PROJECT_STATE_VERSION });
    const posted = await answer(CLOUD_PROJECT_STATE_PATH, { method: "POST" });
    expect(posted.res.status).toBe(405);
    expect(posted.res.headers.get("Allow")).toBe("GET");
  });

  test("a route the binding does not name is left to the host", async () => {
    const { service: svc } = service();
    expect(await answerCloudProjectRequest(at("/file?path=a"), "/file", svc)).toBeNull();
  });

  test("a write names its base and issuer, and answers its revision, hash and ETag", async () => {
    const { body, calls, res } = await answer(`${CLOUD_PROJECT_FILE_PATH}?path=pages/a.json`, {
      body: "b",
      headers: { "If-Match": `"${HASH}"`, "Jx-Buffer-Rev": "7", "Jx-Write-Id": "w1" },
      method: "PUT",
    });
    expect(body).toEqual({ hash: OTHER, ok: true, path: "pages/a.json", rev: 2 });
    expect(res.headers.get("ETag")).toBe(`"${OTHER}"`);
    // SAFETY: the write route calls the service's `write` once, with its request.
    const [request] = calls as WriteRequest[];
    expect({
      ...request,
      // SAFETY: the route hands the service the body's bytes.
      contents: new TextDecoder().decode(request!.contents as Uint8Array),
    }).toEqual({
      baseHash: HASH,
      bufferRev: 7,
      contents: "b",
      path: "pages/a.json",
      writeId: "w1",
    });
  });

  test("a write with no base, a malformed base or no issuer is refused before the service", async () => {
    const route = `${CLOUD_PROJECT_FILE_PATH}?path=a.json`;
    for (const headers of [
      { "Jx-Write-Id": "w" },
      { "If-Match": "*", "Jx-Write-Id": "w" },
      { "If-None-Match": "*" },
    ]) {
      const { calls, res } = await answer(route, { body: "x", headers, method: "PUT" });
      expect(res.status).toBe(400);
      expect(calls).toEqual([]);
    }
  });

  test("a stale base is a 412 naming what is on disk", async () => {
    const conflict = { diskHash: OTHER, docId: "d1", path: "a.json" };
    const { body, res } = await answer(
      `${CLOUD_PROJECT_FILE_PATH}?path=a.json`,
      { body: "x", headers: { "If-None-Match": "*", "Jx-Write-Id": "w" }, method: "PUT" },
      { write: async () => ({ conflict, ok: false }) },
    );
    expect(res.status).toBe(412);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(body).toEqual(preconditionFailedProblem(conflict));
  });

  test("a delete names a file's hash or a directory's files, and a stale one is a 412", async () => {
    const file = await answer(`${CLOUD_PROJECT_FILE_PATH}?path=a.json`, {
      headers: { "If-Match": `"${HASH}"`, "Jx-Write-Id": "d" },
      method: "DELETE",
    });
    expect(file.body).toEqual({ ok: true, path: "a.json", rev: 3 });
    expect(file.calls).toEqual([{ base: { hash: HASH }, path: "a.json", writeId: "d" }]);
    const dir = await answer(`${CLOUD_PROJECT_FILE_PATH}?path=pages`, {
      body: JSON.stringify({ files: { "a.json": HASH } }),
      headers: { "Jx-Write-Id": "d" },
      method: "DELETE",
    });
    expect(dir.calls).toEqual([
      { base: { files: { "a.json": HASH } }, path: "pages", writeId: "d" },
    ]);
    const stale = await answer(
      `${CLOUD_PROJECT_FILE_PATH}?path=a.json`,
      { headers: { "If-Match": `"${HASH}"`, "Jx-Write-Id": "d" }, method: "DELETE" },
      {
        delete: async () => ({
          conflict: { diskHash: null, docId: null, path: "a.json" },
          ok: false,
        }),
      },
    );
    expect(stale.res.status).toBe(412);
    const missing = await answer(`${CLOUD_PROJECT_FILE_PATH}?path=a.json`, {
      headers: { "Jx-Write-Id": "d" },
      method: "DELETE",
    });
    expect(missing.res.status).toBe(400);
    const anonymous = await answer(`${CLOUD_PROJECT_FILE_PATH}?path=a.json`, {
      headers: { "If-Match": `"${HASH}"` },
      method: "DELETE",
    });
    expect(anonymous.res.status).toBe(400);
  });

  test("the file route refuses a path that is not project-relative, and other methods", async () => {
    for (const path of ["", "/a.json", "../a.json", "a/./b", "a//b", String.raw`a\b`]) {
      const { calls, res } = await answer(
        `${CLOUD_PROJECT_FILE_PATH}?path=${encodeURIComponent(path)}`,
        { body: "x", headers: { "If-None-Match": "*", "Jx-Write-Id": "w" }, method: "PUT" },
      );
      expect(res.status).toBe(400);
      expect(calls).toEqual([]);
    }
    const posted = await answer(`${CLOUD_PROJECT_FILE_PATH}?path=a.json`, { method: "POST" });
    expect(posted.res.status).toBe(405);
    expect(posted.res.headers.get("Allow")).toBe("PUT, DELETE");
  });

  test("a rename answers the service's result, a refusal included", async () => {
    const operation = {
      dirtyReferrers: [],
      from: "a.json",
      opId: "op",
      policy: "refuse" as const,
      rewrites: [{ baseHash: HASH, contents: "x", path: "b.md" }],
      to: "b.json",
    };
    const { body, calls } = await answer(CLOUD_PROJECT_RENAME_PATH, {
      body: JSON.stringify(encodeRenameOperation(operation)),
      method: "POST",
    });
    expect(body).toEqual(APPLIED);
    expect(calls).toEqual([operation]);
    const malformed = await answer(CLOUD_PROJECT_RENAME_PATH, { body: "{}", method: "POST" });
    expect(malformed.res.status).toBe(400);
    const notJson = await answer(CLOUD_PROJECT_RENAME_PATH, { body: "{", method: "POST" });
    expect(notJson.res.status).toBe(400);
    const outside = await answer(CLOUD_PROJECT_RENAME_PATH, {
      body: JSON.stringify({ ...encodeRenameOperation(operation), to: "../b.json" }),
      method: "POST",
    });
    expect(outside.res.status).toBe(400);
    expect(outside.calls).toEqual([]);
    const got = await answer(CLOUD_PROJECT_RENAME_PATH, { method: "GET" });
    expect(got.res.status).toBe(405);
  });

  test("the guards", () => {
    expect(isProjectRelativePath("pages/a.json")).toBe(true);
    expect(isProjectRelativePath("a\0b")).toBe(false);
    expect(parseCloudProjectStateInfo({ extra: true, version: 1 })).toEqual({ version: 1 });
    expect(parseCloudProjectStateInfo({ version: 2 })).toBeNull();
    expect(parseCloudProjectStateInfo([])).toBeNull();
    expect(parseCloudProjectStateInfo(null)).toBeNull();
  });
});

// ─── The client's half ─────────────────────────────────────────────────────────────────────────

const SNAPSHOT: SubscribeResponse = {
  epoch: "e1",
  kind: "snapshot",
  rev: 2,
  snapshot: { components: [], files: [], formats: "", readiness: "ready" },
};

const changed = (rev: number): ProjectEvent => ({
  docId: "d1",
  hash: HASH,
  origin: "external",
  path: "a.json",
  rev,
  type: "fileChanged",
});

/** A scripted session: each socket's handlers, what it was sent, and canned HTTP answers. */
function scripted(routes: Record<string, () => Response | Promise<Response>> = {}) {
  const sockets: { handlers: CloudSocketHandlers; sent: string[]; closed: boolean }[] = [];
  const requests: { route: string; init: RequestInit }[] = [];
  const transport: CloudProjectStateTransport = {
    connect(handlers) {
      const sent: string[] = [];
      const socket = { closed: false, handlers, sent };
      sockets.push(socket);
      return {
        close() {
          socket.closed = true;
        },
        send(text) {
          socket.sent.push(text);
        },
      };
    },
    async fetch(route, init) {
      requests.push({ init, route });
      const [path] = route.split("?");
      const make = routes[path!];
      if (make === undefined) {
        return Response.json({ version: 1 });
      }
      return make();
    },
  };
  return { requests, sockets, transport };
}

const listener = () => {
  const frames: ProjectEventsParams[] = [];
  const ended: string[] = [];
  return {
    ended,
    frames,
    listen: {
      ended: (epoch: string) => ended.push(epoch),
      events: (params: ProjectEventsParams) => frames.push(params),
    },
  };
};

describe("the client's half", () => {
  test("a subscribe sends the request on open and answers the host's first message", async () => {
    const { sockets, transport } = scripted();
    const client = createCloudProjectStateClient(transport);
    const heard = listener();
    const pending = client.subscribe({ clientId: "w", epoch: "e0", sinceRev: 1 }, heard.listen);
    await tick();
    const [socket] = sockets;
    socket!.handlers.open();
    expect(JSON.parse(socket!.sent[0]!)).toEqual({
      clientId: "w",
      epoch: "e0",
      kind: "subscribe",
      sinceRev: 1,
    });
    // Traffic that is not the exchange, and a frame before the answer, are not part of it.
    socket!.handlers.message(JSON.stringify({ events: [], kind: "fs" }));
    socket!.handlers.message(encodeCloudEvents("e1", [changed(3)]));
    socket!.handlers.message(encodeCloudSubscribeAnswer(SNAPSHOT));
    socket!.handlers.message(encodeCloudSubscribeAnswer({ ...SNAPSHOT, rev: 9 }));
    socket!.handlers.message(encodeCloudEvents("e1", [changed(3)]));
    expect(await pending).toEqual(SNAPSHOT);
    expect(heard.frames).toEqual([]);
    await tick();
    expect(heard.frames).toEqual([{ epoch: "e1", events: [changed(3)] }]);
    socket!.handlers.message(encodeCloudEnded("e1"));
    await tick();
    expect(heard.ended).toEqual(["e1"]);
    expect(socket!.closed).toBe(true);
    // Nothing more is heard once it ended.
    socket!.handlers.message(encodeCloudEvents("e1", [changed(4)]));
    socket!.handlers.close();
    await tick();
    expect(heard.frames.length).toBe(1);
    expect(heard.ended).toEqual(["e1"]);
  });

  test("a socket that closes after the answer ends the subscription", async () => {
    const { sockets, transport } = scripted();
    const client = createCloudProjectStateClient(transport);
    const heard = listener();
    const pending = client.subscribe({}, heard.listen);
    await tick();
    sockets[0]!.handlers.message(encodeCloudSubscribeAnswer(SNAPSHOT));
    await pending;
    sockets[0]!.handlers.close();
    await tick();
    expect(heard.ended).toEqual(["e1"]);
  });

  test("a socket that closes before the answer rejects the subscribe", async () => {
    const { sockets, transport } = scripted();
    const pending = createCloudProjectStateClient(transport).subscribe({}, listener().listen);
    await tick();
    sockets[0]!.handlers.close();
    expect(await failureOf(pending)).toContain("closed before");
  });

  test("a malformed frame ends the exchange: before the answer it rejects, after it it ends", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const { sockets, transport } = scripted();
    const client = createCloudProjectStateClient(transport);
    const first = client.subscribe({}, listener().listen);
    await tick();
    sockets[0]!.handlers.message(JSON.stringify({ kind: "project-subscribe", response: {} }));
    expect(await failureOf(first)).toContain("closed before");
    expect(sockets[0]!.closed).toBe(true);
    const heard = listener();
    const second = client.subscribe({}, heard.listen);
    await tick();
    sockets[1]!.handlers.message(encodeCloudSubscribeAnswer(SNAPSHOT));
    await second;
    sockets[1]!.handlers.message(JSON.stringify({ kind: "project-ended" }));
    await tick();
    expect(heard.ended).toEqual(["e1"]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  test("a later subscribe replaces the earlier one, which reports nothing more", async () => {
    const { sockets, transport } = scripted();
    const client = createCloudProjectStateClient(transport);
    const before = listener();
    const first = client.subscribe({}, before.listen);
    await tick();
    sockets[0]!.handlers.message(encodeCloudSubscribeAnswer(SNAPSHOT));
    await first;
    const second = client.subscribe({}, listener().listen);
    expect(sockets[0]!.closed).toBe(true);
    sockets[0]!.handlers.message(encodeCloudEvents("e1", [changed(3)]));
    sockets[0]!.handlers.close();
    await tick();
    expect(before.frames).toEqual([]);
    expect(before.ended).toEqual([]);
    sockets[1]!.handlers.message(encodeCloudSubscribeAnswer(SNAPSHOT));
    await second;
    client.close();
    expect(sockets[1]!.closed).toBe(true);
    client.close();
  });

  test("a subscribe replaced while the capability is asked rejects without a socket", async () => {
    const { sockets, transport } = scripted();
    const client = createCloudProjectStateClient(transport);
    const first = client.subscribe({}, listener().listen);
    const second = client.subscribe({}, listener().listen);
    expect(await failureOf(first)).toContain("replaced");
    await tick();
    expect(sockets.length).toBe(1);
    sockets[0]!.handlers.message(encodeCloudSubscribeAnswer(SNAPSHOT));
    expect(await second).toEqual(SNAPSHOT);
  });

  test("a session that does not serve the contract refuses every subscribe, asked once", async () => {
    const { requests, sockets, transport } = scripted({
      [CLOUD_PROJECT_STATE_PATH]: () => new Response("Not found", { status: 404 }),
    });
    const client = createCloudProjectStateClient(transport);
    for (const attempt of [1, 2]) {
      const refused = await client.subscribe({}, listener().listen).then(
        () => null,
        (error: Error) => error.message,
      );
      expect(refused, `attempt ${attempt}`).toContain("does not serve");
    }
    expect(await client.info()).toBeNull();
    expect(requests.length).toBe(1);
    expect(sockets).toEqual([]);
  });

  test("an answer that is not the capability is no capability", async () => {
    const { transport } = scripted({
      [CLOUD_PROJECT_STATE_PATH]: () => Response.json({ version: 99 }),
    });
    expect(await createCloudProjectStateClient(transport).info()).toBeNull();
    const html = scripted({
      [CLOUD_PROJECT_STATE_PATH]: () => new Response("<!doctype html>"),
    });
    expect(await createCloudProjectStateClient(html.transport).info()).toBeNull();
  });

  test("a capability request that fails is asked again", async () => {
    let failing = true;
    const { requests, transport } = scripted({
      [CLOUD_PROJECT_STATE_PATH]: () => {
        if (failing) {
          throw new TypeError("offline");
        }
        return Response.json({ version: 1 });
      },
    });
    const client = createCloudProjectStateClient(transport);
    expect(await failureOf(client.info())).toContain("offline");
    failing = false;
    expect(await client.info()).toEqual({ version: 1 });
    expect(requests.length).toBe(2);
  });

  test("a capability request the session fails to answer is asked again", async () => {
    let status = 503;
    const { requests, transport } = scripted({
      [CLOUD_PROJECT_STATE_PATH]: () =>
        status === 200 ? Response.json({ version: 1 }) : new Response("busy", { status }),
    });
    const client = createCloudProjectStateClient(transport);
    expect(await failureOf(client.info())).toContain("503");
    status = 401;
    expect(await failureOf(client.info())).toContain("401");
    status = 200;
    expect(await client.info()).toEqual({ version: 1 });
    expect(requests.length).toBe(3);
  });

  test("a session without the route says it does not serve the contract, with 405 too", async () => {
    const { transport } = scripted({
      [CLOUD_PROJECT_STATE_PATH]: () => new Response("no", { status: 405 }),
    });
    expect(await createCloudProjectStateClient(transport).info()).toBeNull();
  });

  test("a write sends its bytes, base and issuer, and reads the revision and hash", async () => {
    const { requests, transport } = scripted({
      [CLOUD_PROJECT_FILE_PATH]: () =>
        Response.json({ hash: OTHER, ok: true, path: "a b", rev: 5 }),
    });
    const client = createCloudProjectStateClient(transport);
    const result = await client.write({
      baseHash: null,
      bufferRev: 2,
      contents: "b",
      path: "a b",
      writeId: "w",
    });
    expect(result).toEqual({ hash: OTHER, ok: true, rev: 5 });
    const [request] = requests;
    expect(request!.route).toBe(`${CLOUD_PROJECT_FILE_PATH}?path=a%20b`);
    expect(request!.init.method).toBe("PUT");
    expect(request!.init.headers).toEqual({
      "If-None-Match": "*",
      "Jx-Buffer-Rev": "2",
      "Jx-Write-Id": "w",
    });
  });

  test("a refused write answers its conflict; any other failure throws", async () => {
    const conflict = { diskHash: OTHER, docId: "d", path: "a" };
    const refused = scripted({
      [CLOUD_PROJECT_FILE_PATH]: () =>
        Response.json(preconditionFailedProblem(conflict), { status: 412 }),
    });
    const write: WriteRequest = { baseHash: HASH, contents: "x", path: "a", writeId: "w" };
    expect(await createCloudProjectStateClient(refused.transport).write(write)).toEqual({
      conflict,
      ok: false,
    });
    const failed = scripted({
      [CLOUD_PROJECT_FILE_PATH]: () =>
        Response.json({ error: "Write access required" }, { status: 403 }),
    });
    expect(await failureOf(createCloudProjectStateClient(failed.transport).write(write))).toContain(
      "Write access required",
    );
    const garbled = scripted({
      [CLOUD_PROJECT_FILE_PATH]: () => new Response("", { status: 412 }),
    });
    expect(
      await failureOf(createCloudProjectStateClient(garbled.transport).write(write)),
    ).toContain("Failed to write a");
    const noRev = scripted({ [CLOUD_PROJECT_FILE_PATH]: () => Response.json({ ok: true }) });
    expect(await failureOf(createCloudProjectStateClient(noRev.transport).write(write))).toContain(
      "without a revision",
    );
    const noHash = scripted({ [CLOUD_PROJECT_FILE_PATH]: () => Response.json({ rev: 2 }) });
    expect(await failureOf(createCloudProjectStateClient(noHash.transport).write(write))).toContain(
      "without a hash",
    );
  });

  test("a delete sends a file's base as a header and a directory's as its body", async () => {
    const { requests, transport } = scripted({
      [CLOUD_PROJECT_FILE_PATH]: () => Response.json({ ok: true, path: "a", rev: 6 }),
    });
    const client = createCloudProjectStateClient(transport);
    expect(await client.delete({ base: { hash: HASH }, path: "a", writeId: "d" })).toEqual({
      ok: true,
      rev: 6,
    });
    await client.delete({ base: { files: { x: HASH } }, path: "dir", writeId: "d" });
    expect(requests[0]!.init.headers).toEqual({ "If-Match": `"${HASH}"`, "Jx-Write-Id": "d" });
    expect(requests[0]!.init.body).toBeUndefined();
    expect(requests[1]!.init.body).toBe(JSON.stringify({ files: { x: HASH } }));
    const conflict = { diskHash: null, docId: null, path: "a" };
    const refused = scripted({
      [CLOUD_PROJECT_FILE_PATH]: () =>
        Response.json(preconditionFailedProblem(conflict), { status: 412 }),
    });
    expect(
      await createCloudProjectStateClient(refused.transport).delete({
        base: { hash: HASH },
        path: "a",
        writeId: "d",
      }),
    ).toEqual({ conflict, ok: false });
  });

  test("a rename posts the operation and answers the result; a failure throws", async () => {
    const { requests, transport } = scripted({
      [CLOUD_PROJECT_RENAME_PATH]: () => Response.json(APPLIED),
    });
    const operation = {
      dirtyReferrers: [],
      from: "a.json",
      opId: "op",
      policy: "rewrite-buffer" as const,
      to: "b.json",
    };
    expect(await createCloudProjectStateClient(transport).rename(operation)).toEqual(APPLIED);
    expect(JSON.parse(String(requests[0]!.init.body))).toEqual(operation);
    const missing = scripted({
      [CLOUD_PROJECT_RENAME_PATH]: () => new Response("Not found", { status: 404 }),
    });
    expect(
      await failureOf(createCloudProjectStateClient(missing.transport).rename(operation)),
    ).toContain("Failed to rename a.json → b.json");
    const answerless = scripted({ [CLOUD_PROJECT_RENAME_PATH]: () => Response.json({}) });
    expect(
      await failureOf(createCloudProjectStateClient(answerless.transport).rename(operation)),
    ).toContain("Failed to rename");
  });
});
