/**
 * The dev server's project state service (`specs/project-state.md` §10.2): the host of the active
 * project (`createProjectStateHost`, the module the desktop session runs, §10.1), served as §3.2's
 * Server-Sent Events binding at `GET /__studio/project/events`, the conditional writes and deletes
 * of §5 on `PUT` and `DELETE /__studio/file`, and the rename cascade of §9 on `POST
 * /__studio/project/rename`.
 *
 * The host starts on the first request that needs it (a subscription, a conditional write, a
 * collaboration room), so a Studio that never subscribes pays for none of it. Activating another
 * project closes the host, which ends every subscription; the next request starts a host over the
 * new root, in a new epoch. A stream that names its project (`?root=`) is refused while another is
 * served, because no frame says which project it describes. The live preview overlay is keyed by
 * document and client beside the host (§11.3): a rename moves it, a removal drops it, and a
 * client's overlays outlive its last stream by the grace period. The reload stream of `server.md`
 * §3.1 is untouched: it keeps its `fs` frames and its single-reload answer to a reconnect.
 *
 * @docs extending/embedding/dev-server
 */

import { isAbsolute, relative, resolve } from "node:path";
import {
  decodeRenameOperation,
  encodeSseEvents,
  encodeSseSubscribe,
  entityTag,
  parseDeletePrecondition,
  parseLastEventId,
  parseWriteIdentity,
  parseWritePrecondition,
  PROJECT_CLIENT_PARAM,
  PROJECT_ROOT_PARAM,
} from "@jxsuite/protocol/project-state-frames";
import type {
  ProjectEvent,
  ProjectSnapshot,
  RenameOperation,
  WriteConflict,
} from "@jxsuite/protocol/project-state";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import { toError } from "@jxsuite/schema/parse";
import type { JsonValue } from "@jxsuite/schema/types";
import { collectionLoaderResolver } from "./project-state/collections.ts";
import { createProjectStateHost } from "./project-state/host.ts";
import { createOverlayRegistry } from "./project-state/overlays.ts";
import type { OverlayOwner, OverlayRegistry } from "./project-state/overlays.ts";
import type { ProjectStateHost, ProjectStateHostOptions } from "./project-state/host.ts";
import type { GraphReferences } from "./refactor/index.ts";
import { settledReferences } from "./project-state/settle.ts";
import { problem } from "./problem.ts";
import { HEARTBEAT_MS } from "./sse.ts";

/**
 * How many bytes a stream may hold unread before its subscription is ended rather than fed (§3.2):
 * the client subscribes again and catches up from the log or a snapshot, which is bounded, where an
 * event stream to a reader that has stalled is not.
 */
export const PROJECT_STREAM_HIGH_WATER = 4 * 1024 * 1024;

/** Who follows the active project's host beside the streams: the collaboration rooms (§11.3). */
export interface ProjectEventsFollower {
  /** Events the host of `root` emitted, in revision order. */
  events: (root: string, events: ProjectEvent[]) => void;
  /**
   * The host of `root` is about to stop serving it (another project activated, or the service
   * closing): the last moment anything can still go through it. The host closes once this settles.
   */
  retiring?: (running: ProjectStateHost) => Promise<void>;
  /** The host of `root` stopped serving it: another project was activated, or the service closed. */
  retired?: (root: string) => void;
  /**
   * The host of `root` answered a resubscribe with a snapshot (§3.1): a watcher recovery or a
   * restart began a new epoch, so the events between are not coming and `snapshot` is the index
   * now.
   */
  resynced?: (root: string, snapshot: ProjectSnapshot) => void;
}

export interface ProjectEventsOptions {
  /** The project's extension registry, which the collection loader reads (§8.1). */
  registryFor?: (root: string) => Promise<ExtensionRegistry>;
  /** Creates the host; `createProjectStateHost` by default. */
  createHost?: (options: ProjectStateHostOptions) => Promise<ProjectStateHost>;
  /**
   * The unread bytes past which a stream's subscription is ended;
   * {@link PROJECT_STREAM_HIGH_WATER}.
   */
  streamHighWater?: number;
  /** How often a stream sends a heartbeat comment, in ms; fifteen seconds by default. */
  heartbeatMs?: number;
  /** How long the usage query waits for the host to settle, in ms; two seconds by default. */
  settleLimitMs?: number;
  /** Show unsaved bytes to the live preview's readers of `path` in `root` (§11.3). */
  publish?: (root: string, path: string, contents: string) => void;
  /** Show the live preview's readers of `path` in `root` the file again. */
  unpublish?: (root: string, path: string) => void;
  /** How long a departed client's overlays are kept, in ms (§11.3). */
  overlayGraceMs?: number;
}

/** The overlay a client sets or clears (§11.3): `path` is relative to the project served. */
export interface OverlayParams {
  path?: string;
  contents?: string;
  clientId?: string;
}

/**
 * The owner every overlay set without a `clientId` shares (§11.3). A request over HTTP is not tied
 * to a stream, so it cannot be owned by one: any tab may clear what another set without naming
 * itself, which is how the overlay behaved before it had owners.
 */
const UNNAMED: OverlayOwner = { anonymous: "unnamed" };

/** The owner of an overlay request or a stream: the client it names, else {@link UNNAMED}. */
const ownerOf = (clientId: string | undefined): OverlayOwner => (clientId ? { clientId } : UNNAMED);

/** Where a request's path lands: in the active project, or a response refusing it. */
export interface ProjectFileTarget {
  /** The path relative to the project the host serves. */
  path: string;
}

export type ProjectEventsService = ReturnType<typeof createProjectEventsService>;

const encoder = new TextEncoder();

/** The headers that put a file request on the conditional path (§5). */
const CONDITIONAL_HEADERS = ["If-Match", "If-None-Match", "Jx-Write-Id"] as const;

/**
 * Whether a `PUT` or `DELETE /__studio/file` names a base or an issuer, and so is the conditional
 * write or delete of §5. One that names neither is the Studio Backend Protocol's unconditional
 * form, last-writer-wins, which the dev server keeps for clients that have not subscribed.
 */
export function isConditionalFileRequest(req: Request): boolean {
  return CONDITIONAL_HEADERS.some((name) => req.headers.has(name));
}

/** Why a request's issuer was refused: no `Jx-Write-Id`, or a `Jx-Buffer-Rev` that is no revision. */
const MISSING_IDENTITY =
  "The request names no Jx-Write-Id, or a Jx-Buffer-Rev that is not a non-negative integer.";

/** The answer to a refused write or delete: `412` naming what is at the path now (§5). */
function preconditionFailed(conflict: WriteConflict): Response {
  return problem("preconditionFailed", `${conflict.path} is not what the request's base names.`, {
    diskHash: conflict.diskHash,
    docId: conflict.docId,
    path: conflict.path,
  });
}

/**
 * The project state service of a dev server. `activate` names the project it serves; nothing runs
 * until a request needs the host.
 */
export function createProjectEventsService(options: ProjectEventsOptions = {}) {
  const createHost = options.createHost ?? createProjectStateHost;
  const highWater = options.streamHighWater ?? PROJECT_STREAM_HIGH_WATER;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const { registryFor, settleLimitMs } = options;
  let root: string | null = null;
  let starting: Promise<ProjectStateHost> | null = null;
  let host: ProjectStateHost | null = null;
  let closed = false;
  const followers = new Set<ProjectEventsFollower>();
  /** The overlays of the project served, `null` before the first activation (§11.3). */
  let overlays: OverlayRegistry | null = null;

  /** An overlay registry for `serving`, which publishes through the embedder. */
  const overlaysFor = (serving: string): OverlayRegistry =>
    createOverlayRegistry({
      publish: (path, contents) => options.publish?.(serving, path, contents),
      unpublish: (path) => options.unpublish?.(serving, path),
      ...(options.overlayGraceMs !== undefined && { graceMs: options.overlayGraceMs }),
    });

  /**
   * Drop the overlays of every document `snapshot` no longer holds: the host restarted or its
   * watcher recovered, and the removals between were never emitted (§4.8).
   */
  const resyncOverlays = (snapshot: ProjectSnapshot, rev: number): void => {
    const present = new Set(snapshot.files.map((file) => file.path));
    const gone: ProjectEvent[] = (overlays?.published() ?? [])
      .filter((doc) => !present.has(doc.path))
      .map((doc) => ({
        docId: doc.docId,
        isDir: false,
        origin: "external",
        path: doc.path,
        rev,
        type: "fileRemoved",
      }));
    overlays?.apply(gone);
  };

  /**
   * Fan the running host's events out to every follower, across its restarts. A resubscribe is
   * answered from the log when it can be; a snapshot means the events between are lost, which the
   * followers are told (§3.1).
   */
  const follow = (running: ProjectStateHost, again = false): void => {
    const { response } = running.subscribe(
      { epoch: running.epoch, sinceRev: running.rev },
      {
        end: () => {
          if (host === running) {
            follow(running, true);
          }
        },
        events: (events) => {
          overlays?.apply(events);
          for (const follower of followers) {
            follower.events(running.root, events);
          }
        },
      },
    );
    if (again && response.kind === "snapshot") {
      resyncOverlays(response.snapshot, response.rev);
      for (const follower of followers) {
        follower.resynced?.(running.root, response.snapshot);
      }
    }
  };

  /** The host of the active project, started on first use; a start that fails is tried again. */
  const start = (): Promise<ProjectStateHost> => {
    if (closed) {
      return Promise.reject(new Error("The dev server is stopping."));
    }
    if (root === null) {
      return Promise.reject(new Error("No project is active."));
    }
    if (starting === null) {
      const serving = root;
      const attempt = createHost({
        ...(registryFor !== undefined && {
          collections: collectionLoaderResolver(() => registryFor(serving)),
        }),
        onError: (error) => {
          console.error(`[server] project state of ${serving}: ${error.message}`);
        },
        root: serving,
      }).then(async (created) => {
        if (root !== serving || closed) {
          await created.close();
          throw new Error("The project is no longer active.");
        }
        host = created;
        follow(created);
        return created;
      });
      starting = attempt;
      attempt.catch(() => {
        if (starting === attempt) {
          starting = null;
        }
      });
    }
    return starting;
  };

  /**
   * Stop the host of `retiring`, which ends every subscription, and tell the followers. The caller
   * has already moved `root` on (or set `closed`), so a start still in flight closes what it made.
   */
  const retire = async (retiring: string | null): Promise<void> => {
    const pending = starting;
    starting = null;
    host = null;
    const running = await pending?.catch(() => null);
    if (running) {
      for (const follower of followers) {
        await follower.retiring?.(running).catch((error: Error) => {
          console.error(`[server] retiring ${running.root}: ${error.message}`);
        });
      }
    }
    await running?.close();
    if (retiring !== null) {
      for (const follower of followers) {
        follower.retired?.(retiring);
      }
    }
  };

  /**
   * Where `abs` lands in the project the service serves, or the response refusing it: a path that
   * is not inside that project is not the host's to write.
   */
  const target = (abs: string): ProjectFileTarget | Response => {
    if (root === null) {
      return problem("invalidRequest", "No project is active.");
    }
    const path = relative(root, abs).replaceAll("\\", "/");
    if (path === "" || path === ".." || path.startsWith("../") || isAbsolute(path)) {
      return problem("invalidRequest", "path is outside the active project");
    }
    return { path };
  };

  /** Run `body` against the running host, answering a host that cannot start with a `500`. */
  const withHost = async (body: (running: ProjectStateHost) => Promise<Response>) => {
    let running: ProjectStateHost;
    try {
      running = await start();
    } catch (error) {
      return problem("internalError", error instanceof Error ? error.message : String(error));
    }
    return body(running);
  };

  /**
   * `GET /__studio/project/events`: answer the subscribe `Last-Event-ID` names (§3.1, §3.2) as the
   * first frame, then stream every later event, batched per turn. The stream closes when the host
   * ends the subscription (a restart, a watcher recovery, another project activated) or when the
   * reader falls more than the high-water mark behind; the client then subscribes again.
   */
  function handleEvents(
    req: Request,
    url: URL,
    rootOf: (named: string) => string = resolve,
  ): Promise<Response> {
    const named = url.searchParams.get(PROJECT_ROOT_PARAM);
    if (named && rootOf(named) !== root) {
      return Promise.resolve(
        problem("conflict", `${named} is not the project this server serves now.`),
      );
    }
    return withHost((running) => {
      const request = parseLastEventId(req.headers.get("Last-Event-ID"));
      const clientId = url.searchParams.get(PROJECT_CLIENT_PARAM);
      if (clientId) {
        request.clientId = clientId;
      }
      let pending: ProjectEvent[] = [];
      let scheduled = false;
      let ended = false;
      let finished = false;
      let controller!: ReadableStreamDefaultController<Uint8Array>;

      const owner = ownerOf(clientId ?? undefined);
      const finish = (): void => {
        if (!finished) {
          finished = true;
          clearInterval(heartbeat);
          subscription.close();
          if (clientId) {
            owning?.closed(owner);
          }
        }
      };
      const send = (text: string): void => {
        controller.enqueue(encoder.encode(text));
      };
      const flush = (): void => {
        scheduled = false;
        if (finished) {
          return;
        }
        if (pending.length > 0) {
          const batch = pending;
          pending = [];
          if ((controller.desiredSize ?? 0) < 0) {
            // The reader has fallen behind: it catches up by subscribing again (§3.2).
            ended = true;
          } else {
            send(encodeSseEvents(epoch, batch));
          }
        }
        if (ended) {
          finish();
          controller.close();
        }
      };
      const schedule = (): void => {
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(flush);
        }
      };

      const stream = new ReadableStream<Uint8Array>(
        {
          cancel: finish,
          start(streamController) {
            controller = streamController;
          },
        },
        new ByteLengthQueuingStrategy({ highWaterMark: highWater }),
      );
      const subscription = running.subscribe(request, {
        end: () => {
          ended = true;
          schedule();
        },
        events: (events) => {
          pending.push(...events);
          schedule();
        },
      });
      const { epoch } = subscription.response;
      // The overlays of a client that names itself are kept while one of its streams is open.
      const owning = overlays;
      if (clientId) {
        owning?.opened(owner);
      }
      send(encodeSseSubscribe(subscription.response));
      const heartbeat = setInterval(() => {
        if (!finished) {
          send(": heartbeat\n\n");
        }
      }, heartbeatMs);
      return Promise.resolve(
        new Response(stream, {
          headers: {
            "Cache-Control": "no-store",
            Connection: "keep-alive",
            "Content-Type": "text/event-stream",
          },
        }),
      );
    });
  }

  /**
   * A conditional write (§5): the body is the file's bytes, the base travels as `If-Match` (or
   * `If-None-Match: *` for a create) and the issuer as `Jx-Write-Id`. A stale base is a `412`.
   */
  function handleWrite(req: Request, abs: string): Promise<Response> {
    const at = target(abs);
    if (at instanceof Response) {
      return Promise.resolve(at);
    }
    const precondition = parseWritePrecondition(req.headers);
    if (!precondition.ok) {
      return Promise.resolve(
        problem("invalidRequest", `The write's base is ${precondition.reason}.`),
      );
    }
    const identity = parseWriteIdentity(req.headers);
    if (identity === null) {
      return Promise.resolve(problem("invalidRequest", MISSING_IDENTITY));
    }
    return withHost(async (running) => {
      const contents = new Uint8Array(await req.arrayBuffer());
      const result = await running.write({
        baseHash: precondition.baseHash,
        contents,
        path: at.path,
        ...identity,
      });
      if (!result.ok) {
        return preconditionFailed(result.conflict);
      }
      return Response.json(
        { hash: result.hash, ok: true, path: at.path, rev: result.rev },
        { headers: { ETag: entityTag(result.hash) } },
      );
    });
  }

  /**
   * A conditional delete (§5): a file's base travels as `If-Match`, a directory's `{ files }` as
   * the JSON body, and the issuer as `Jx-Write-Id`. A stale base is a `412`.
   */
  async function handleDelete(req: Request, abs: string): Promise<Response> {
    const at = target(abs);
    if (at instanceof Response) {
      return at;
    }
    const precondition = parseDeletePrecondition(req.headers, await req.text());
    if (!precondition.ok) {
      return problem("invalidRequest", `The delete's base is ${precondition.reason}.`);
    }
    const identity = parseWriteIdentity(req.headers);
    if (identity === null) {
      return problem("invalidRequest", MISSING_IDENTITY);
    }
    return withHost(async (running) => {
      const result = await running.delete({
        base: precondition.base,
        path: at.path,
        writeId: identity.writeId,
      });
      if (!result.ok) {
        return preconditionFailed(result.conflict);
      }
      return Response.json({ ok: true, path: at.path, rev: result.rev });
    });
  }

  /**
   * A rename as one operation (§9): the body is a `RenameOperation` with project-relative paths,
   * each rewrite's contents as `WireContents`, and the answer is the host's
   * `RenameOperationResult`, a refusal included, as `200`. A malformed operation, or a path that is
   * not project-relative or leaves the project, is a `400`. The paths carry no project, so the
   * request names one (`?root=`, as the client activated it), and one naming a project other than
   * the one served is a `409 conflict`, as a stream is. `moved` is told the old path of an applied
   * rename, as the unconditional route tells the collaboration rooms.
   */
  async function handleRename(
    req: Request,
    url: URL,
    rootOf: (named: string) => string = resolve,
    moved?: (path: string) => void,
  ): Promise<Response> {
    const named = url.searchParams.get(PROJECT_ROOT_PARAM);
    if (named && rootOf(named) !== root) {
      return problem("conflict", `${named} is not the project this server serves now.`);
    }
    let operation: RenameOperation;
    try {
      // SAFETY: JSON.parse without a reviver yields a JSON value, which the decoder checks.
      operation = decodeRenameOperation(JSON.parse(await req.text()) as JsonValue);
    } catch (error) {
      return problem("invalidRequest", toError(error).message);
    }
    return withHost(async (running) => {
      try {
        const result = await running.rename(operation);
        if (result.ok) {
          moved?.(operation.from);
        }
        return Response.json(result);
      } catch (error) {
        const failure = toError(error);
        return problem(
          failure instanceof TypeError ? "invalidRequest" : "internalError",
          failure.message,
        );
      }
    });
  }

  return {
    /** The project the service serves, `null` before the first activation. */
    get root(): string | null {
      return root;
    },
    /** The running host, if one has started. */
    get host(): ProjectStateHost | null {
      return host;
    },
    start,
    handleEvents,
    handleWrite,
    handleDelete,
    handleRename,
    /**
     * Serve `next` from now on. Activating the project already served changes nothing; activating
     * another closes the host, ending every subscription, and the next request starts a host over
     * `next` in a new epoch (§10.2).
     */
    async activate(next: string): Promise<void> {
      const resolved = resolve(next);
      const previous = root;
      if (resolved === previous) {
        return;
      }
      root = resolved;
      // The previous project's overlays are unpublished with it, as a desktop re-root does (§11.3).
      overlays?.clearAll();
      overlays?.close();
      overlays = overlaysFor(resolved);
      await retire(previous);
    },
    /** Publish a client's unsaved bytes for the document at `params.path` (§11.3). */
    setOverlay(params: OverlayParams & { path: string; contents: string }): void {
      const docId =
        overlays?.published().find((doc) => doc.path === params.path)?.docId ??
        host?.docIdAt(params.path) ??
        `path:${params.path}`;
      overlays?.set(ownerOf(params.clientId), docId, params.path, params.contents);
    },
    /** Drop a client's overlay of the document at `params.path`, or every overlay it set. */
    clearOverlay(params: OverlayParams): void {
      const owner = ownerOf(params.clientId);
      if (params.path === undefined) {
        overlays?.clear(owner);
        return;
      }
      const at = overlays?.published().find((doc) => doc.path === params.path);
      if (at !== undefined) {
        overlays?.clear(owner, at.docId);
      }
    },
    /** Follow the host's events beside the streams; the returned call stops following. */
    follow(follower: ProjectEventsFollower): () => void {
      followers.add(follower);
      return () => {
        followers.delete(follower);
      };
    },
    /**
     * What the graph knows for the usage query over `scanRoot` (§12): `null` when the host serves
     * another project or none is running, below `indexed`, while its watcher is degraded, or when
     * it has not settled within a bound, so a change the watcher has not delivered yet is never
     * missed and the caller walks the tree.
     */
    async references(scanRoot: string): Promise<GraphReferences | null> {
      const running = host;
      return running === null || running.root !== resolve(scanRoot)
        ? null
        : settledReferences(running, settleLimitMs);
    },
    /** Stop: the host closed, every subscription ended, every follower told. */
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      overlays?.clearAll();
      try {
        await retire(root);
      } finally {
        // After the host, whose ending streams would otherwise arm graces on a closed registry.
        overlays?.close();
      }
    },
  };
}
