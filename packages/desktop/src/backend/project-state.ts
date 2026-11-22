/**
 * The window's project state service (`specs/project-state.md` §10.1): the host the session runs
 * for its project, served over the window's RPC socket as `project-state.md` §3.2's desktop
 * binding, and the live preview overlay keyed by document and client (§11.3).
 *
 * The host (`createProjectStateHost`, `@jxsuite/server/project-state/host`) starts on the first
 * request that needs it, a subscription or a conditional write, so a window whose Studio never
 * subscribes pays for none of it. It keeps its own watcher beside the session's: the session's
 * still feeds `onFileEvents` and `onFileResync`, which Studio reads until every host serves the
 * subscription (§3.3).
 *
 * @docs studio/desktop
 */

import {
  decodeWireContents,
  encodeDesktopEnded,
  encodeDesktopEvents,
  isSubscribeRequest,
  preconditionFailedProblem,
} from "@jxsuite/protocol/project-state-frames";
import type {
  ContentHash,
  DeleteRequest,
  DocId,
  ProjectEvent,
  SubscribeResponse,
  WireContents,
} from "@jxsuite/protocol/project-state";
import { createProjectStateHost } from "@jxsuite/server/project-state/host";
import type {
  CollectionResolver,
  ProjectStateHost,
  ProjectStateHostOptions,
} from "@jxsuite/server/project-state/host";
import { createOverlayRegistry } from "@jxsuite/server/project-state/overlays";
import { settledReferences } from "@jxsuite/server/project-state/settle";
import type { OverlayOwner } from "@jxsuite/server/project-state/overlays";
import { RpcProblemError } from "@jxsuite/server/project-server";
import type { RpcConnection } from "@jxsuite/server/project-server";
import type { GraphReferences } from "@jxsuite/server/refactor";
import { isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";

// ─── The service ───────────────────────────────────────────────────────────────────────────────

/** A conditional write as the desktop socket carries it (§3.2, §5): a `WriteRequest` on the wire. */
export interface ProjectWriteParams {
  path: string;
  contents: WireContents;
  baseHash: ContentHash | null;
  writeId: string;
  bufferRev?: number;
}

/**
 * How many bytes a socket may hold unread before its subscription is ended rather than fed (§3.2):
 * the client subscribes again and catches up from the log or a snapshot, which is bounded, where an
 * event stream to a reader that has stalled is not.
 */
export const PROJECT_SOCKET_HIGH_WATER = 4 * 1024 * 1024;

export interface ProjectStateServiceOptions {
  root: string;
  /** Each content type's entry files; the host's default when omitted. */
  collections?: CollectionResolver;
  /** Show unsaved bytes to the live preview's readers of a path (§11.3). */
  publish: (path: string, contents: string) => void;
  /** Show the live preview's readers the file at a path again. */
  unpublish: (path: string) => void;
  /** How long a departed client's overlays are kept, in ms (§11.3). */
  overlayGraceMs?: number;
  /** The unread bytes past which a subscription is ended; {@link PROJECT_SOCKET_HIGH_WATER}. */
  socketHighWater?: number;
  /** How long the usage query waits for the host to settle, in ms; two seconds by default. */
  settleLimitMs?: number;
  /** Creates the host; `createProjectStateHost` by default. */
  createHost?: (options: ProjectStateHostOptions) => Promise<ProjectStateHost>;
}

export type ProjectStateService = ReturnType<typeof createProjectStateService>;

/** The owner every client that names no `clientId` and never subscribed shares (§11.3). */
const UNSUBSCRIBED: OverlayOwner = { anonymous: "unsubscribed" };

/** The owner of what a socket that subscribed sets without a `clientId`. */
const socketOwner = (id: number): OverlayOwner => ({ anonymous: `socket-${id}` });

/** Refuse a request that names no `writeId`: its events' origin could not be recognised (§2.4). */
function requireWriteId(writeId: string | undefined, method: string): string {
  if (!isString(writeId) || writeId === "") {
    throw new TypeError(`${method} needs a writeId, which its events' origin echoes.`);
  }
  return writeId;
}

/**
 * The project state service for one project root. Close it when the window re-roots or closes: that
 * closes the host, which ends every subscription, so each client subscribes again.
 */
export function createProjectStateService(options: ProjectStateServiceOptions) {
  const { root } = options;
  const createHost = options.createHost ?? createProjectStateHost;
  const highWater = options.socketHighWater ?? PROJECT_SOCKET_HIGH_WATER;
  const { settleLimitMs } = options;
  let starting: Promise<ProjectStateHost> | null = null;
  let host: ProjectStateHost | null = null;
  let closed = false;
  /**
   * Each socket's open subscription, as the call that ends it without a word: a socket holds one,
   * and a second `projectSubscribe` on it (the cursor repairing a gap, §3.2) replaces the first.
   */
  const subscriptions = new Map<number, () => void>();
  /** Every socket that has subscribed and is still open: what it sets is its own (§11.3). */
  const subscribers = new Set<number>();
  /** The socket that last set each document's shared, never-subscribed layer. */
  const sharedSetBy = new Map<DocId, number>();

  /**
   * Who owns an overlay set on `connection` (§11.3): the client its `clientId` names; else the
   * socket, once it has subscribed, so its overlays end with its subscriptions and with it; else
   * every client that never subscribed, as one owner, which is how the overlay behaved before it
   * had owners (any window of the project could clear what another set).
   */
  const ownerOf = (
    clientId: string | undefined,
    connection: RpcConnection | undefined,
  ): OverlayOwner => {
    if (clientId !== undefined) {
      return { clientId };
    }
    return connection !== undefined && subscribers.has(connection.id)
      ? socketOwner(connection.id)
      : UNSUBSCRIBED;
  };

  const overlays = createOverlayRegistry({
    publish: options.publish,
    unpublish: options.unpublish,
    ...(options.overlayGraceMs !== undefined && { graceMs: options.overlayGraceMs }),
  });

  /**
   * A socket's first subscription: what it set before it subscribed becomes its own, so it can
   * still clear it, and everything it owns is dropped when it closes.
   */
  const enrol = (connection: RpcConnection): void => {
    if (subscribers.has(connection.id)) {
      return;
    }
    subscribers.add(connection.id);
    const owner = socketOwner(connection.id);
    const adopted = [...sharedSetBy].flatMap(([doc, id]) => (id === connection.id ? [doc] : []));
    for (const doc of adopted) {
      sharedSetBy.delete(doc);
    }
    overlays.adopt(UNSUBSCRIBED, owner, adopted);
    connection.onClose(() => {
      subscribers.delete(connection.id);
      overlays.clear(owner);
    });
  };

  /** Keep the overlays following the index: renames move them, removals drop them (§11.3). */
  const follow = (running: ProjectStateHost): void => {
    running.subscribe(
      { epoch: running.epoch, sinceRev: running.rev },
      {
        end: () => {
          if (!closed) {
            follow(running);
          }
        },
        events: (events) => {
          overlays.apply(events);
        },
      },
    );
  };

  /** The running host, started on first use; a start that fails is tried again on the next. */
  const start = (): Promise<ProjectStateHost> => {
    if (closed) {
      return Promise.reject(new Error("The project was closed."));
    }
    if (starting === null) {
      const attempt = createHost({
        ...(options.collections !== undefined && { collections: options.collections }),
        onError: (error) => {
          console.error(`[desktop] project state of ${root}: ${error.message}`);
        },
        root,
      }).then(async (created) => {
        if (closed) {
          await created.close();
          throw new Error("The project was closed.");
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
   * The document at `path` an overlay is keyed by: the one published there, the index's, or the
   * path.
   */
  const docFor = (path: string): string =>
    overlays.published().find((doc) => doc.path === path)?.docId ??
    host?.docIdAt(path) ??
    `path:${path}`;

  /**
   * Answer a `projectSubscribe` (§3.1) and stream every later event to the subscribing socket as
   * `projectEvents` frames, batched per turn, after the reply. When the host ends the subscription,
   * or the socket falls more than `socketHighWater` bytes behind, the socket is told with
   * `projectEnded`, and the client subscribes again. A socket's earlier subscription ends,
   * silently, when it subscribes again.
   */
  async function subscribe(
    params: JsonValue | undefined,
    connection?: RpcConnection,
  ): Promise<SubscribeResponse> {
    const request = params ?? {};
    if (!isSubscribeRequest(request)) {
      throw new TypeError("projectSubscribe takes a SubscribeRequest.");
    }
    if (connection === undefined) {
      throw new Error("projectSubscribe needs the socket it streams to.");
    }
    const running = await start();
    enrol(connection);
    const owner = ownerOf(request.clientId, connection);
    let replied = false;
    let ended = false;
    let finished = false;
    let pending: ProjectEvent[] = [];
    let flushing = false;

    const finish = (): void => {
      if (!finished) {
        finished = true;
        subscription.close();
        if (subscriptions.get(connection.id) === replace) {
          subscriptions.delete(connection.id);
        }
        overlays.closed(owner);
      }
    };
    /**
     * Ended by the socket's next subscription, which the client is already waiting on: what it held
     * is dropped, and with its host subscription closed it is sent nothing more.
     */
    const replace = (): void => {
      pending = [];
      finish();
    };
    /** Send what is pending, once the reply has gone (`schedule` and `afterReply` both wait). */
    const flush = (): void => {
      flushing = false;
      if (pending.length > 0) {
        const batch = pending;
        pending = [];
        if (!ended && connection.buffered() > highWater) {
          // The reader has fallen behind: it catches up by subscribing again (§3.2).
          ended = true;
          finish();
        } else {
          connection.send(encodeDesktopEvents(epoch, batch));
        }
      }
      if (ended) {
        connection.send(encodeDesktopEnded(epoch));
      }
    };
    const schedule = (): void => {
      if (replied && !flushing) {
        flushing = true;
        queueMicrotask(flush);
      }
    };

    const subscription = running.subscribe(request, {
      end: () => {
        ended = true;
        finish();
        schedule();
      },
      events: (events) => {
        pending.push(...events);
        schedule();
      },
    });
    const { epoch } = subscription.response;
    // Opened before the earlier one is closed, so an owner both share keeps its overlays.
    overlays.opened(owner);
    subscriptions.get(connection.id)?.();
    subscriptions.set(connection.id, replace);
    connection.onClose(finish);
    connection.afterReply(() => {
      replied = true;
      flush();
    });
    return subscription.response;
  }

  /** A conditional write through the host; a stale base is a `412` problem (§5). */
  async function write(params: ProjectWriteParams): Promise<{ rev: number; hash: ContentHash }> {
    const writeId = requireWriteId(params.writeId, "projectWrite");
    const running = await start();
    const result = await running.write({
      baseHash: params.baseHash,
      contents: decodeWireContents(params.contents),
      path: params.path,
      writeId,
      ...(params.bufferRev !== undefined && { bufferRev: params.bufferRev }),
    });
    if (!result.ok) {
      throw new RpcProblemError(preconditionFailedProblem(result.conflict));
    }
    return { hash: result.hash, rev: result.rev };
  }

  /** A conditional delete through the host; a stale base is a `412` problem (§5). */
  async function remove(params: DeleteRequest): Promise<{ rev: number }> {
    const writeId = requireWriteId(params.writeId, "projectDelete");
    const running = await start();
    const result = await running.delete({ base: params.base, path: params.path, writeId });
    if (!result.ok) {
      throw new RpcProblemError(preconditionFailedProblem(result.conflict));
    }
    return { rev: result.rev };
  }

  return {
    root,
    /** The running host, if one has started. */
    get host(): ProjectStateHost | null {
      return host;
    },
    start,
    subscribe,
    write,
    delete: remove,
    /** Whether `connection` has a subscription open now. */
    isSubscribed(connection: RpcConnection): boolean {
      return subscriptions.has(connection.id);
    },
    /**
     * What the graph knows for the usage query (§12): `null` with no host running, below `indexed`,
     * while its watcher is degraded, or when it has not settled within a bound, so a change the
     * watcher has not delivered yet is never missed and the caller walks the tree.
     */
    references(): Promise<GraphReferences | null> {
      const running = host;
      return running === null ? Promise.resolve(null) : settledReferences(running, settleLimitMs);
    },
    /** Publish a client's unsaved bytes for the document at `path` (§11.3). */
    setOverlay(
      params: { path: string; contents: string; clientId?: string },
      connection?: RpcConnection,
    ): void {
      const owner = ownerOf(params.clientId, connection);
      const docId = docFor(params.path);
      overlays.set(owner, docId, params.path, params.contents);
      if (owner === UNSUBSCRIBED) {
        if (connection === undefined) {
          sharedSetBy.delete(docId);
        } else {
          sharedSetBy.set(docId, connection.id);
        }
      }
    },
    /** Drop a client's overlay of the document at `path`, or every overlay it set. */
    clearOverlay(params: { path?: string; clientId?: string }, connection?: RpcConnection): void {
      const owner = ownerOf(params.clientId, connection);
      if (params.path === undefined) {
        overlays.clear(owner);
        if (owner === UNSUBSCRIBED) {
          sharedSetBy.clear();
        }
        return;
      }
      const docId = docFor(params.path);
      overlays.clear(owner, docId);
      if (owner === UNSUBSCRIBED) {
        sharedSetBy.delete(docId);
      }
    },
    /** Stop: every overlay unpublished, the host closed, every subscription ended. */
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      overlays.clearAll();
      try {
        const running = await starting?.catch(() => null);
        await running?.close();
      } finally {
        // After the host, whose ending subscriptions would otherwise arm graces on a closed registry.
        overlays.close();
      }
    },
  };
}
