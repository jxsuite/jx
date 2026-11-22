/**
 * Transport-agnostic collab host: the server half of the wire envelope, shared by the Bun dev
 * server and the Cloudflare platform DO. The embedder supplies sockets ({@link RoomSocket}),
 * identity per connection, and source loading; the host owns rooms (one Y.Doc per room key,
 * server-seeded `source` per the schema contract), the y-protocols sync handshake, project-level
 * awareness relay, read-only enforcement, and the docEpoch/doc-reset lifecycle.
 *
 * A room is addressed by path on the wire and keyed by {@link CollabHostOptions.keyOf} here: the
 * path itself by default, or the document an embedder that follows documents across renames names
 * (`project-state.md` §11.3). Each subscriber is answered under the path it opened the room by, so
 * a peer that opened a document before it moved keeps talking to the same room at its old path
 * while a peer opening the new path joins it.
 */

import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import { isString } from "@jxsuite/schema/guards";
import { decodeFrame, encodeFrame } from "./envelope.ts";
import type { CollabFrame, ControlMessage } from "./envelope.ts";
import type { CollabConflict, CollabIdentity } from "./provider.ts";
import { sourceText } from "./schema.ts";

export interface RoomSocket {
  send: (data: Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
}

export interface CollabHostOptions {
  /**
   * Current file text for seeding a room's source, or null when unavailable. `key` is the room's
   * key ({@link keyOf}), which is `path` unless the embedder keys rooms otherwise.
   */
  loadSource: (path: string, key: string) => Promise<string | null>;
  /** Refuse a path with an error code (e.g. "binary-file"), or null to allow. */
  rejectPath?: (path: string) => string | null;
  /**
   * The room a path names. Defaults to the path. Called once per `open`, after `rejectPath`; the
   * callbacks below and the host's methods take the key it returns.
   */
  keyOf?: (path: string) => string;
  /** A room's source text changed (debounce and persist in the embedder). */
  onSourceChange?: (key: string) => void;
  /**
   * A client asked to persist this room now; resolve when durable or refused. `baseHash`, when the
   * client named one, is the base the save replaces in place of the room's own (`flush`).
   */
  onFlush?: (key: string, options?: { baseHash?: string | null }) => Promise<void> | void;
  /**
   * A client with write access asked to discard the room's unsaved edits (`revert`). The embedder
   * drops whatever it holds for the room and calls {@link CollabHost.resetDoc}; without this
   * callback the host resets the room itself.
   */
  onRevert?: (key: string) => Promise<void> | void;
  /** The last subscriber left a room (schedule teardown in the embedder). */
  onEmpty?: (key: string) => void;
}

interface Room {
  doc: Y.Doc;
  epoch: number;
  /** Each subscriber and the paths it opened the room by (more than one after a move). */
  subscribers: Map<InternalConnection, Set<string>>;
  ready: Promise<void>;
  /** The source text as of the last persist (seed or markPersisted) — the room-dirty baseline. */
  baseline: string;
  /** True while the live source differs from `baseline`; mirrored to peers via `doc-dirty`. */
  dirty: boolean;
}

export interface HostConnection {
  handleMessage: (data: Uint8Array) => void;
  close: () => void;
}

/** The host's own view of a connection: the embedder only ever sees the {@link HostConnection}. */
interface InternalConnection extends HostConnection {
  socket: RoomSocket;
  identity: CollabIdentity;
  /** Each path this connection opened, and the key of the room it opened. */
  subscribed: Map<string, string>;
  /** Awareness clientIDs this socket controls (removed on close). */
  controlledIds: Set<number>;
  warnedReadOnly: boolean;
  closed: boolean;
}

export interface CollabHost {
  connect: (socket: RoomSocket, identity: CollabIdentity) => HostConnection;
  /**
   * Out-of-band content replacement: bump the room's epoch, drop its Y history, and tell every
   * subscriber to re-open. The invariant "Y history never dies without an epoch bump" lives here.
   */
  resetDoc: (key: string) => void;
  /** The room's current source text, or null when no room is live. */
  sourceOf: (key: string) => string | null;
  /** Live subscriber count (0 when the room is absent). */
  subscriberCount: (key: string) => number;
  /** Destroy an empty room (embedder teardown after its grace period). */
  destroyRoomIfEmpty: (key: string) => void;
  /**
   * The embedder folded the room's source to durable storage: reset the dirty baseline to the
   * current source and broadcast `doc-dirty{false}` to every subscriber. Called from `onFlush`
   * after a successful write.
   */
  markPersisted: (key: string) => void;
  /**
   * The embedder refused to save the room because the file is no longer what the room was loaded
   * from (`project-state.md` §5): tell every subscriber with `doc-conflict`. The room stays dirty.
   */
  conflict: (key: string, conflict: CollabConflict) => void;
  destroy: () => void;
}

export function createCollabHost(options: CollabHostOptions): CollabHost {
  const keyOf = options.keyOf ?? ((path: string) => path);
  const rooms = new Map<string, Room>();
  /** Epochs survive room teardown so re-opened docs never reuse a dead history's epoch. */
  const epochs = new Map<string, number>();
  /**
   * The highest epoch each path has been answered under. A path's room can change key (a document
   * the embedder had not indexed yet, a file replaced by another), and the new room starts at no
   * lower epoch than the path has seen, so a path's epoch never goes back (collab.md §3).
   */
  const pathEpochs = new Map<string, number>();
  /** Record that `path` was answered under `epoch`. */
  const notePathEpoch = (path: string, epoch: number): void => {
    if (epoch > (pathEpochs.get(path) ?? 0)) {
      pathEpochs.set(path, epoch);
    }
  };
  /** The epoch a path's room key stands at, never below what the path has seen. */
  const epochFor = (key: string, path: string): number =>
    Math.max(epochs.get(key) ?? 0, pathEpochs.get(path) ?? 0);
  const connections = new Set<InternalConnection>();
  const awarenessDoc = new Y.Doc();
  const awareness = new Awareness(awarenessDoc);
  // The host's own (empty) local state must not leak into rosters.
  awareness.setLocalState(null);

  const send = (conn: InternalConnection, frame: CollabFrame) => {
    try {
      conn.socket.send(encodeFrame(frame));
    } catch {
      // A dying socket cleans up through its close handler.
    }
  };

  const sendControl = (conn: InternalConnection, message: ControlMessage) => {
    send(conn, { message, type: "control" });
  };

  /**
   * Send every subscriber the frame `frameFor` builds for each path it opened the room by, encoding
   * each path's frame once.
   */
  const broadcastToRoom = (
    room: Room,
    frameFor: (path: string) => CollabFrame,
    except?: InternalConnection,
  ) => {
    const encoded = new Map<string, Uint8Array>();
    for (const [target, paths] of room.subscribers) {
      if (target === except || target.closed) {
        continue;
      }
      for (const path of paths) {
        let data = encoded.get(path);
        if (data === undefined) {
          data = encodeFrame(frameFor(path));
          encoded.set(path, data);
        }
        try {
          target.socket.send(data);
        } catch {
          // Skip dying sockets.
        }
      }
    }
  };

  const ensureRoom = (key: string, path: string): Room => {
    const existing = rooms.get(key);
    if (existing) {
      return existing;
    }
    const doc = new Y.Doc();
    const epoch = epochFor(key, path);
    epochs.set(key, epoch);
    const room: Room = {
      baseline: "",
      dirty: false,
      doc,
      epoch,
      ready: Promise.resolve(),
      subscribers: new Map(),
    };
    room.ready = (async () => {
      const source = await options.loadSource(path, key);
      if (source === null) {
        throw new Error("content-not-loaded");
      }
      // The seeded text IS the on-disk state — the initial clean baseline.
      room.baseline = source;
      doc.transact(() => {
        sourceText(doc).insert(0, source);
      }, "seed");
    })();
    /* A room doc is written only here: the "seed" transaction above, and the sync-protocol reads in
       `handleDocSync`, which tag the update with the connection it came from. */
    doc.on("update", (update: Uint8Array, origin: InternalConnection | string) => {
      const current = rooms.get(key);
      if (!current || current.doc !== doc) {
        return;
      }
      const body = encoding.createEncoder();
      syncProtocol.writeUpdate(body, update);
      const sync = encoding.toUint8Array(body);
      broadcastToRoom(
        current,
        (at) => ({ body: sync, epoch: current.epoch, path: at, type: "doc-sync" }),
        // The sender already has the update, so it is the one subscriber the relay skips.
        isString(origin) ? undefined : origin,
      );
      options.onSourceChange?.(key);
      // Room-level dirty: broadcast on transition so every peer's Save affordance stays in sync.
      const nowDirty = sourceText(current.doc).toString() !== current.baseline;
      if (nowDirty !== current.dirty) {
        current.dirty = nowDirty;
        broadcastToRoom(current, (at) => ({
          message: { dirty: nowDirty, path: at, type: "doc-dirty" },
          type: "control",
        }));
      }
    });
    rooms.set(key, room);
    return room;
  };

  const handleOpen = async (conn: InternalConnection, path: string) => {
    const rejection = options.rejectPath?.(path) ?? null;
    if (rejection) {
      sendControl(conn, { code: rejection, message: `Refused: ${rejection}`, path, type: "error" });
      return;
    }
    const key = keyOf(path);
    const room = ensureRoom(key, path);
    try {
      await room.ready;
    } catch {
      if (rooms.get(key) === room) {
        rooms.delete(key);
      }
      sendControl(conn, {
        code: "content-not-loaded",
        message: "The file is not available for co-editing yet",
        path,
        type: "error",
      });
      return;
    }
    if (conn.closed || rooms.get(key) !== room) {
      return;
    }
    const paths = room.subscribers.get(conn) ?? new Set<string>();
    paths.add(path);
    room.subscribers.set(conn, paths);
    conn.subscribed.set(path, key);
    notePathEpoch(path, room.epoch);
    sendControl(conn, { epoch: room.epoch, path, type: "opened" });
    // The joiner learns the room's current unsaved state (it may join a room others have dirtied).
    sendControl(conn, { dirty: room.dirty, path, type: "doc-dirty" });
    // Server-initiated step1: learn the client's state (it replies step2 + its own step1).
    const body = encoding.createEncoder();
    syncProtocol.writeSyncStep1(body, room.doc);
    send(conn, { body: encoding.toUint8Array(body), epoch: room.epoch, path, type: "doc-sync" });
  };

  const handleDocSync = (
    conn: InternalConnection,
    path: string,
    epoch: number,
    body: Uint8Array,
  ) => {
    const key = conn.subscribed.get(path);
    const room = key === undefined ? undefined : rooms.get(key);
    if (!room || epoch !== room.epoch) {
      sendControl(conn, {
        epoch: epochFor(key ?? keyOf(path), path),
        path,
        type: "doc-reset",
      });
      return;
    }
    const decoder = decoding.createDecoder(body);
    const messageType = decoding.readVarUint(decoder);
    const readOnly = conn.identity.permission === "read";
    if (readOnly && messageType !== syncProtocol.messageYjsSyncStep1) {
      if (!conn.warnedReadOnly) {
        conn.warnedReadOnly = true;
        sendControl(conn, {
          code: "read-only",
          message: "Write access required",
          path,
          type: "error",
        });
      }
      return;
    }
    const reply = encoding.createEncoder();
    switch (messageType) {
      case syncProtocol.messageYjsSyncStep1: {
        syncProtocol.readSyncStep1(decoder, reply, room.doc);
        break;
      }
      case syncProtocol.messageYjsSyncStep2: {
        syncProtocol.readSyncStep2(decoder, room.doc, conn);
        break;
      }
      case syncProtocol.messageYjsUpdate: {
        syncProtocol.readUpdate(decoder, room.doc, conn);
        break;
      }
      default: {
        return;
      }
    }
    if (encoding.length(reply) > 0) {
      send(conn, { body: encoding.toUint8Array(reply), epoch: room.epoch, path, type: "doc-sync" });
    }
  };

  const handleAwareness = (conn: InternalConnection, body: Uint8Array) => {
    // Track which clientIDs this socket controls so its states drop on close.
    try {
      const decoder = decoding.createDecoder(body);
      const count = decoding.readVarUint(decoder);
      for (let i = 0; i < count; i++) {
        conn.controlledIds.add(decoding.readVarUint(decoder));
        decoding.readVarUint(decoder);
        decoding.readVarString(decoder);
      }
    } catch {
      return;
    }
    applyAwarenessUpdate(awareness, body, conn);
    const data = encodeFrame({ body, type: "awareness" });
    for (const other of connections) {
      if (other !== conn && !other.closed) {
        try {
          other.socket.send(data);
        } catch {
          // Skip dying sockets.
        }
      }
    }
  };

  const unsubscribe = (conn: InternalConnection, path: string) => {
    const key = conn.subscribed.get(path);
    conn.subscribed.delete(path);
    const room = key === undefined ? undefined : rooms.get(key);
    const paths = room?.subscribers.get(conn);
    if (room && paths) {
      paths.delete(path);
      if (paths.size === 0) {
        room.subscribers.delete(conn);
      }
      if (room.subscribers.size === 0) {
        options.onEmpty?.(key!);
      }
    }
  };

  const host: CollabHost = {
    connect(socket, identity) {
      const conn: InternalConnection = {
        close: () => {
          if (conn.closed) {
            return;
          }
          conn.closed = true;
          // Detached copy: unsubscribe mutates the set mid-walk.
          const paths = [...conn.subscribed.keys()];
          for (const path of paths) {
            unsubscribe(conn, path);
          }
          connections.delete(conn);
          // Only ids the awareness actually adopted can be removed/encoded (a client may have
          // Announced ids whose updates were stale and never applied).
          const known = [...conn.controlledIds].filter((id) => awareness.meta.has(id));
          if (known.length > 0) {
            removeAwarenessStates(awareness, known, "disconnect");
            const removal = encodeAwarenessUpdate(awareness, known);
            const data = encodeFrame({ body: removal, type: "awareness" });
            for (const other of connections) {
              if (!other.closed) {
                try {
                  other.socket.send(data);
                } catch {
                  // Skip dying sockets.
                }
              }
            }
          }
        },
        closed: false,
        controlledIds: new Set(),
        handleMessage: (data) => {
          let frame: CollabFrame;
          try {
            frame = decodeFrame(data);
          } catch {
            sendControl(conn, {
              code: "unknown-frame",
              message: "Malformed frame",
              type: "error",
            });
            return;
          }
          switch (frame.type) {
            case "control": {
              const { message } = frame;
              if (message.type === "open") {
                void handleOpen(conn, message.path);
              } else if (message.type === "flush") {
                // A path this connection has not opened names no room of its: nothing to save.
                const key = conn.subscribed.get(message.path);
                const { baseHash } = message;
                void (async () => {
                  if (key !== undefined) {
                    await (baseHash === undefined
                      ? options.onFlush?.(key)
                      : options.onFlush?.(key, { baseHash }));
                  }
                  sendControl(conn, { path: message.path, type: "flush-ack" });
                })();
              } else if (message.type === "revert") {
                const key = conn.subscribed.get(message.path);
                // Discarding everyone's edits is a write: a read-only peer reverts nothing.
                const allowed = key !== undefined && conn.identity.permission !== "read";
                void (async () => {
                  if (allowed) {
                    await (options.onRevert ? options.onRevert(key) : host.resetDoc(key));
                  }
                  sendControl(conn, { path: message.path, type: "revert-ack" });
                })();
              }
              return;
            }
            case "doc-sync": {
              handleDocSync(conn, frame.path, frame.epoch, frame.body);
              return;
            }
            case "doc-close": {
              unsubscribe(conn, frame.path);
              return;
            }
            default: {
              // The only remaining variant is the awareness frame.
              handleAwareness(conn, frame.body);
            }
          }
        },
        identity,
        socket,
        subscribed: new Map(),
        warnedReadOnly: false,
      };
      connections.add(conn);
      const hello: Extract<ControlMessage, { type: "hello" }> = {
        color: identity.color,
        login: identity.login,
        permission: identity.permission,
        type: "hello",
      };
      if (identity.name !== undefined) {
        hello.name = identity.name;
      }
      if (identity.avatarUrl !== undefined) {
        hello.avatarUrl = identity.avatarUrl;
      }
      sendControl(conn, hello);
      // Late joiners receive the current presence roster immediately.
      const states = awareness.getStates();
      if (states.size > 0) {
        send(conn, {
          body: encodeAwarenessUpdate(awareness, [...states.keys()]),
          type: "awareness",
        });
      }
      return conn;
    },

    destroy() {
      // Detached copy: close() removes connections mid-walk.
      const live = [...connections];
      for (const conn of live) {
        conn.close();
      }
      for (const room of rooms.values()) {
        room.doc.destroy();
      }
      rooms.clear();
      awareness.destroy();
      awarenessDoc.destroy();
    },

    conflict(key, conflict) {
      const room = rooms.get(key);
      if (room) {
        broadcastToRoom(room, (at) => ({
          message: { ...conflict, path: at, type: "doc-conflict" },
          type: "control",
        }));
      }
    },

    destroyRoomIfEmpty(key) {
      const room = rooms.get(key);
      if (room && room.subscribers.size === 0) {
        room.doc.destroy();
        rooms.delete(key);
      }
    },

    markPersisted(key) {
      const room = rooms.get(key);
      if (!room) {
        return;
      }
      room.baseline = sourceText(room.doc).toString();
      if (room.dirty) {
        room.dirty = false;
        broadcastToRoom(room, (at) => ({
          message: { dirty: false, path: at, type: "doc-dirty" },
          type: "control",
        }));
      }
    },

    resetDoc(key) {
      const nextEpoch = (epochs.get(key) ?? 0) + 1;
      epochs.set(key, nextEpoch);
      const room = rooms.get(key);
      if (!room) {
        return;
      }
      broadcastToRoom(room, (at) => ({
        message: { epoch: nextEpoch, path: at, type: "doc-reset" },
        type: "control",
      }));
      for (const [subscriber, paths] of room.subscribers) {
        for (const path of paths) {
          subscriber.subscribed.delete(path);
          notePathEpoch(path, nextEpoch);
        }
      }
      room.doc.destroy();
      rooms.delete(key);
    },

    sourceOf(key) {
      const room = rooms.get(key);
      return room ? sourceText(room.doc).toString() : null;
    },

    subscriberCount(key) {
      return rooms.get(key)?.subscribers.size ?? 0;
    },
  };
  return host;
}
