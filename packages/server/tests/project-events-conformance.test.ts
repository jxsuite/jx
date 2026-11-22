/**
 * The project state conformance suite (`specs/project-state.md` §10.4) against the dev server
 * (§10.2), through its HTTP binding: every subscription is a `GET /__studio/project/events` read as
 * an event stream, its cursor sent as `Last-Event-ID`, and every write and delete is a `PUT` or
 * `DELETE /__studio/file` naming its base in `If-Match` and its issuer in `Jx-Write-Id`, answered
 * `412` when the base is stale (§3.2, §5). The server is `createDevServer` under Bun, the runtime
 * `jx dev` runs, over real temporary directories, the real chokidar watcher and a real git
 * repository, with the dependency graph (§8) on.
 *
 * What has no HTTP binding is driven on the host the server runs: creating a directory (the dev
 * server's protocol creates directories implicitly), the hold release, an install, and making the
 * watcher fail. A restart is the server's own: it stops, and a new one serves the same files.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runProjectStateConformance } from "@jxsuite/protocol/project-state-conformance";
import type {
  FixtureFiles,
  ProjectStateDriver,
  ProjectStateHost,
  ProjectStateHostOptions,
  ProjectStateSubscription,
} from "@jxsuite/protocol/project-state-conformance";
import {
  conflictFromProblem,
  decodeSseMessage,
  deletePrecondition,
  formatEventId,
  parseSseBlock,
  PROJECT_CLIENT_PARAM,
  PROJECT_EVENTS_PATH,
  writeBody,
  writeIdentityHeaders,
  writePreconditionHeaders,
} from "@jxsuite/protocol/project-state-frames";
import type {
  ContentHash,
  DeleteResult,
  ProjectEvent,
  SubscribeRequest,
  SubscribeResponse,
  WriteConflict,
  WriteResult,
} from "@jxsuite/protocol/project-state";
import type { JsonValue } from "@jxsuite/schema/types";
import { chokidarProjectWatcher, createProjectStateHost } from "../src/project-state/host.ts";
import type { ProjectStateHost as Host, ProjectWatcherFactory } from "../src/project-state/host.ts";
import { nodeGitRunner } from "../src/project-state/git-monitor.ts";
import { createDevServer } from "../src/server.ts";
import {
  commitFixture,
  fixtureInstaller,
  GIT_FIXTURE_CONFIG,
  writeFixture,
} from "./_project-state-fixture.ts";

/** How long `settle` waits for a stream to carry what the host has emitted, in ms. */
const DELIVERY_LIMIT_MS = 10_000;

/** One subscription as the client reads it off the stream. */
interface StreamSubscription extends ProjectStateSubscription {
  /** The epoch of the answer, and the last revision the stream has carried. */
  readonly epoch: string;
  readonly lastRev: number;
  /** Whether the client closed it. */
  readonly closed: boolean;
}

/**
 * Subscribe over the stream: the first message is the answer, every later one is appended to the
 * subscription's events, and the stream closing is the host ending the subscription.
 */
async function subscribeOver(base: string, request: SubscribeRequest): Promise<StreamSubscription> {
  const cursor =
    request.epoch !== undefined && request.sinceRev !== undefined
      ? { "Last-Event-ID": formatEventId(request.epoch, request.sinceRev) }
      : {};
  const query =
    request.clientId === undefined
      ? ""
      : `?${PROJECT_CLIENT_PARAM}=${encodeURIComponent(request.clientId)}`;
  const res = await fetch(`${base}${PROJECT_EVENTS_PATH}${query}`, { headers: cursor });
  if (!res.ok || res.body === null) {
    throw new Error(`the project stream answered ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events: ProjectEvent[] = [];
  const state = { closed: false, ended: false, lastRev: 0 };
  let buffer = "";

  const answer = new Promise<SubscribeResponse>((resolveAnswer, rejectAnswer) => {
    void (async () => {
      let answered = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
            const { data, event } = parseSseBlock(buffer.slice(0, end));
            buffer = buffer.slice(end + 2);
            const message = decodeSseMessage(event, data);
            if (message?.kind === "subscribe") {
              answered = true;
              state.lastRev = message.response.rev;
              resolveAnswer(message.response);
            } else if (message !== null) {
              events.push(...message.events);
              state.lastRev = message.events.at(-1)!.rev;
            }
          }
        }
      } catch {
        // The client cancelled the stream.
      }
      if (!state.closed) {
        state.ended = true;
      }
      if (!answered) {
        rejectAnswer(new Error("the stream closed before it answered"));
      }
    })();
  });
  const response = await answer;
  return {
    close: () => {
      state.closed = true;
      void reader.cancel();
    },
    get closed() {
      return state.closed;
    },
    get ended() {
      return state.ended;
    },
    epoch: response.epoch,
    events,
    get lastRev() {
      return state.lastRev;
    },
    response,
  };
}

/** What a refused write or delete answers, or the failure. */
async function refusal(res: Response): Promise<{ ok: false; conflict: WriteConflict }> {
  /* SAFETY: every failure of the conditional routes is a problem document (`problem.ts`), which
     parses as JSON. */
  const body = (await res.json()) as JsonValue;
  const conflict = res.status === 412 ? conflictFromProblem(body) : null;
  if (conflict === null) {
    throw new Error(`the server refused the request: ${JSON.stringify(body)}`);
  }
  return { conflict, ok: false };
}

async function createServerHost(
  files: FixtureFiles,
  options: ProjectStateHostOptions,
): Promise<ProjectStateHost> {
  const base = await mkdtemp(join(tmpdir(), "jx-project-events-"));
  const root = join(base, "project");
  const scratch = join(base, "scratch");
  await mkdir(scratch, { recursive: true });
  await writeFixture(root, files);
  await commitFixture(root);
  const git = nodeGitRunner(root);
  let degrade: ((error: Error) => void) | null = null;
  const watcher: ProjectWatcherFactory = (watched, sink, watchOptions) => {
    degrade = sink.error;
    return chokidarProjectWatcher(watched, sink, watchOptions);
  };
  /** The host the running server started, once it has. */
  let host: Host | null = null;
  const streams = new Set<StreamSubscription>();

  const serve = (hold: boolean) =>
    createDevServer({
      port: 0,
      projectState: {
        createHost: async (hostOptions) => {
          host = await createProjectStateHost({
            ...hostOptions,
            hold,
            installer: fixtureInstaller,
            logCapacity: options.logCapacity ?? 1024,
            onError: () => {},
            watcher,
          });
          return host;
        },
      },
      root,
      watch: false,
    });
  let server = await serve(options.hold === true);
  const origin = () => `http://127.0.0.1:${server.port}`;
  const at = (path: string): string => join(root, path);
  const fileUrl = (path: string) => `${origin()}/__studio/file?path=${encodeURIComponent(path)}`;

  /** The host, started by a subscription the driver closes at once if none has started it. */
  const running = async (): Promise<Host> => {
    if (host === null) {
      const starting = await subscribeOver(origin(), {});
      starting.close();
    }
    return host!;
  };

  /** Run `act` on the running host. */
  const onHost = async <T>(act: (current: Host) => Promise<T>): Promise<T> => act(await running());

  /** Every open stream has carried what the host emitted, or has ended. */
  const delivered = async (): Promise<void> => {
    const current = await running();
    const deadline = Date.now() + DELIVERY_LIMIT_MS;
    const behind = () =>
      [...streams].some(
        (stream) =>
          !stream.closed &&
          !stream.ended &&
          (stream.epoch !== current.epoch || stream.lastRev < current.rev),
      );
    while (behind() && Date.now() < deadline) {
      await Bun.sleep(5);
    }
  };

  return {
    close: async () => {
      for (const stream of streams) {
        stream.close();
      }
      await server.stop(true);
      await rm(base, { force: true, recursive: true });
    },
    commit: async (message) => {
      await git(["add", "-A"]);
      await git([...GIT_FIXTURE_CONFIG, "commit", "-q", "-m", message]);
    },
    createDirectory: (path, writeId) => onHost((current) => current.createDirectory(path, writeId)),
    delete: async (request): Promise<DeleteResult> => {
      const precondition = deletePrecondition(request.base);
      const res = await fetch(fileUrl(request.path), {
        ...(precondition.body !== undefined && { body: precondition.body }),
        headers: { ...precondition.headers, ...writeIdentityHeaders(request) },
        method: "DELETE",
      });
      if (!res.ok) {
        return refusal(res);
      }
      // SAFETY: a 200 from the conditional delete is `{ ok, path, rev }` (`project-events.ts`).
      const done = (await res.json()) as { rev: number };
      return { ok: true, rev: done.rev };
    },
    external: {
      atomicSave: async (path, contents, timing) => {
        if (timing === "inside") {
          const temp = join(scratch, `save-${Date.now()}`);
          await writeFile(temp, contents);
          await rename(temp, at(path));
          return;
        }
        await rm(at(path));
        await onHost((current) => current.idle());
        await writeFile(at(path), contents);
      },
      remove: (path) => rm(at(path), { force: true, recursive: true }),
      rename: async (from, to) => {
        await mkdir(dirname(at(to)), { recursive: true });
        await rename(at(from), at(to));
      },
      symlink: async (path, target) => {
        const resolved = resolve(root, target);
        if (!resolved.startsWith(`${root}/`)) {
          await writeFile(resolved, "{}\n");
        }
        await symlink(resolved, at(path));
      },
      write: async (path, contents) => {
        await mkdir(dirname(at(path)), { recursive: true });
        await writeFile(at(path), contents);
      },
    },
    install: () => onHost((current) => current.install()),
    read: async (path) => {
      try {
        return new Uint8Array(await readFile(at(path)));
      } catch {
        return null;
      }
    },
    release: () => onHost((current) => current.release()),
    restart: async () => {
      await server.stop(true);
      host = null;
      server = await serve(false);
      await running();
    },
    settle: async () => {
      await onHost((current) => current.idle());
      await delivered();
    },
    subscribe: async (request) => {
      const stream = await subscribeOver(origin(), request);
      streams.add(stream);
      return stream;
    },
    watcher: {
      degrade: (reason) => {
        degrade?.(new Error(reason));
        return Promise.resolve();
      },
      recover: () => onHost((current) => current.restart()),
    },
    write: async (request): Promise<WriteResult> => {
      const res = await fetch(fileUrl(request.path), {
        body: writeBody(request.contents),
        headers: {
          ...writePreconditionHeaders(request.baseHash),
          ...writeIdentityHeaders(request),
        },
        method: "PUT",
      });
      if (!res.ok) {
        return refusal(res);
      }
      // SAFETY: a 200 from the conditional write is `{ ok, path, rev, hash }` (`project-events.ts`).
      const done = (await res.json()) as { rev: number; hash: ContentHash };
      expect(res.headers.get("etag")).toBe(`"${done.hash}"`);
      return { hash: done.hash, ok: true, rev: done.rev };
    },
  };
}

const driver: ProjectStateDriver = {
  create: createServerHost,
  graph: { complete: true },
  name: "the dev server over its HTTP binding",
};

runProjectStateConformance(driver, {
  describe,
  expect,
  test: (name, body) => {
    test(name, body, 30_000);
  },
});
