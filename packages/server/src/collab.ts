/**
 * Collab.ts — the dev server's realtime co-editing endpoint (`/__studio/collab`): the reference
 * implementation of the Jx collab wire contract, built on `@jxsuite/collab/room`.
 *
 * A room is addressed by server-root-relative path on the wire. Inside the active project, where
 * the dev server runs a project state host (`project-state.md` §10.2, §11.3), it is keyed by the
 * document's `DocId`: it follows the document across a rename the host observes, is closed when the
 * document is removed, and saves through the host's conditional write with the hash it loaded or
 * last saved as the base, so a save over a file that changed under it is refused and the refusal
 * reaches every participant (`doc-conflict`). Outside it, a room is keyed by its path and saves
 * unconditionally, as before. A room's Y.Text source seeds from the file on disk. Persistence is
 * EXPLICIT: the shared source is written back to disk only on an explicit flush (Cmd+S / Save) and,
 * as a last-ditch safety, on graceful server shutdown. Unsaved collaborative edits therefore live
 * only in the room's in-memory Y.Doc until saved — non-collab consumers (preview, live reload,
 * plain editors) intentionally keep working off the last-saved file until then. The host owns the
 * room-level dirty signal broadcast to every peer; the embedder just tells it a persist landed via
 * `markPersisted`. Genuinely external file changes (not our own write-back echo) bump the doc's
 * epoch and reset subscribers, per the contract. No persistence beyond the files themselves: this
 * is deliberately a reference implementation.
 */

import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { contentHash } from "@jxsuite/protocol/project-state";
import type { ContentHash, ProjectEvent, ProjectSnapshot } from "@jxsuite/protocol/project-state";
import { colorForKey } from "@jxsuite/collab/awareness-types";
import { createCollabHost } from "@jxsuite/collab/room";
import { isString } from "@jxsuite/schema/guards";
import {
  COLLAB_SUBPROTOCOL,
  offeredSubprotocols,
  selectSubprotocol,
} from "@jxsuite/collab/negotiate";
import { assertAccessible } from "./studio-api";
import type { ServeServer, ServeSocket, ServeWebSocketHandler } from "./serve.ts";
import type { HostConnection } from "@jxsuite/collab/room";
import { problem } from "./problem.ts";
import type { ProjectEventsService } from "./project-events.ts";
import type { ProjectStateHost } from "./project-state/host.ts";

const EMPTY_ROOM_GRACE_MS = 30_000;

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "ico",
  "bmp",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "mp4",
  "webm",
  "wav",
  "ogg",
  "pdf",
  "zip",
  "gz",
]);

function isBinaryPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && BINARY_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

export interface CollabSocketData {
  connection: HostConnection | null;
}

export interface CollabRegistry {
  /**
   * Handle a request to /__studio/collab: WebSocket upgrades become collab connections; a plain GET
   * answers the capability probe. Returns undefined when the upgrade was accepted (the server sends
   * the 101 itself).
   */
  handleRequest: (
    req: Request,
    server: Pick<ServeServer<CollabSocketData>, "upgrade">,
  ) => Response | undefined;
  /** The websocket handlers backing the upgraded connections (`serve.ts`). */
  websocket: ServeWebSocketHandler<CollabSocketData>;
  /** Watcher hook: a file changed on disk (absolute path). Echoes of our write-back are ignored. */
  handleExternalChange: (absPath: string) => void;
  /** Flush pending write-backs and tear everything down. */
  stop: () => Promise<void>;
}

/** A room inside the project the host serves: where its document is, and the bytes it holds. */
interface HostedRoom {
  /** The document's absolute path now; a rename the host observes moves it. */
  abs: string;
  /** The project root of the host the room saves through. */
  root: string;
  /** The hash of the file the room loaded or last saved, the base of its next save (§5). */
  base: ContentHash | null;
}

export function createCollabRegistry(opts: {
  absRoot: string;
  activeProjectRoot: () => string | null;
  /** The project state service; without it every room is keyed by path and saves unconditionally. */
  projectEvents?: ProjectEventsService;
}): CollabRegistry {
  const { absRoot, projectEvents } = opts;
  let connectionCounter = 0;
  let stopped = false;
  /** Rooms keyed by document, by key. */
  const hosted = new Map<string, HostedRoom>();
  /** Rooms keyed by their path (outside the project the host serves) that have loaded. */
  const plain = new Set<string>();
  /** Each room's save in flight, so two saves of one room run one after the other. */
  const persisting = new Map<string, Promise<void>>();
  /** The key of the document at each absolute path. */
  const keyAt = new Map<string, string>();
  /** The write ids of saves in flight, whose events are the room's own. */
  const ownWrites = new Set<string>();

  const destroyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Paths with unsaved edits (source changed since the last persist) — the shutdown worklist. */
  const pendingPersist = new Set<string>();
  /** Content we last wrote (or are about to write) per path — the watcher-echo signature. */
  const lastWritten = new Map<string, string>();

  const absPathFor = (relPath: string): string => {
    const abs = resolve(absRoot, relPath);
    assertAccessible(abs, absRoot, opts.activeProjectRoot());
    return abs;
  };

  const relPathFor = (absPath: string): string => {
    const rel = absPath.startsWith(absRoot)
      ? absPath.slice(absRoot.length).replace(/^\/+/, "")
      : absPath;
    return rel.replaceAll("\\", "/");
  };

  /** The project a path is inside, when the service serves it; `null` for any other path. */
  const coverage = (abs: string): string | null => {
    const root = projectEvents?.root ?? null;
    if (root === null) {
      return null;
    }
    const inside = relative(root, abs);
    return inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)
      ? null
      : root;
  };

  /**
   * The room a path names (`project-state.md` §11.3): the document's, inside the active project, so
   * every path that names it shares one room; the path itself anywhere else. Registers nothing: a
   * room is recorded when it loads ({@link load}), so a path that is only asked about, or a room
   * that never loads, leaves nothing behind. The one thing it records is where a live room's
   * document is now, when the host has indexed a move the room has not been told of yet.
   */
  const keyOf = (path: string): string => {
    const abs = resolve(absRoot, path);
    const known = keyAt.get(abs);
    if (known !== undefined) {
      return known;
    }
    const root = coverage(abs);
    if (root === null) {
      return path;
    }
    const running = projectEvents?.host ?? null;
    const docId =
      running !== null && running.root === root
        ? running.docIdAt(relative(root, abs).replaceAll("\\", "/"))
        : null;
    if (docId === null) {
      return `path:${abs}`;
    }
    const key = `doc:${docId}`;
    const room = hosted.get(key);
    if (room !== undefined) {
      // The host moved the document before its event reached the room: it saves at the new path.
      room.abs = abs;
      keyAt.set(abs, key);
    }
    return key;
  };

  /** Forget a hosted room's document, by every path that named it: its next open finds anew. */
  const forget = (key: string): void => {
    hosted.delete(key);
    for (const [at, named] of keyAt) {
      if (named === key) {
        keyAt.delete(at);
      }
    }
  };

  /**
   * Record the room `key` names as it loads, before its first read so a second open of the path
   * names the same room. Returns the call that undoes it, for a room that does not load.
   */
  const record = (path: string, key: string): (() => void) => {
    if (key === path) {
      plain.add(key);
      return () => {
        plain.delete(key);
      };
    }
    const abs = resolve(absRoot, path);
    keyAt.set(abs, key);
    if (!hosted.has(key)) {
      hosted.set(key, { abs, base: null, root: coverage(abs) ?? absRoot });
    }
    return () => {
      forget(key);
    };
  };

  /**
   * Save a hosted room through the host, with its base (§5); a stale base reaches the room. The
   * active project's host by default, or `through`, the host of a project being retired.
   */
  const persistHosted = async (
    key: string,
    room: HostedRoom,
    source: string,
    through?: ProjectStateHost,
  ): Promise<void> => {
    const hash = await contentHash(source);
    if (hash === room.base) {
      pendingPersist.delete(key);
      host.markPersisted(key);
      return;
    }
    if (through === undefined && projectEvents?.root !== room.root) {
      return;
    }
    const writeId = `collab-${randomUUID()}`;
    ownWrites.add(writeId);
    try {
      const running = through ?? (await projectEvents!.start());
      const result = await running.write({
        baseHash: room.base,
        contents: source,
        path: relative(room.root, room.abs).replaceAll("\\", "/"),
        writeId,
      });
      if (result.ok) {
        room.base = result.hash;
        pendingPersist.delete(key);
        host.markPersisted(key);
        return;
      }
      ownWrites.delete(writeId);
      host.conflict(key, { diskHash: result.conflict.diskHash, docId: result.conflict.docId });
    } catch {
      // The write failed (or the host could not start): the next explicit save retries.
      ownWrites.delete(writeId);
    }
  };

  /** Save a room keyed by its path, unconditionally: last writer wins, as before (§11.3). */
  const persistPlain = async (path: string, source: string): Promise<void> => {
    if (lastWritten.get(path) === source) {
      pendingPersist.delete(path);
      return;
    }
    // Optimistic: closes the watcher-echo race (our own write must not read back as external).
    lastWritten.set(path, source);
    try {
      await writeFile(absPathFor(path), source, "utf8");
      pendingPersist.delete(path);
      // Tell the host the room is durable now: it resets the dirty baseline and broadcasts clean.
      host.markPersisted(path);
    } catch {
      // Write failed — clear the optimistic signature so the next explicit save retries.
      lastWritten.delete(path);
    }
  };

  /**
   * Run `save` after the room's save in flight, if any. A save reads the room's base when it runs,
   * so two saves pressed together never both name the base the first one replaces.
   */
  const serialize = (key: string, save: () => Promise<void>): Promise<void> => {
    const next = (persisting.get(key) ?? Promise.resolve()).then(save);
    persisting.set(key, next);
    void next.finally(() => {
      if (persisting.get(key) === next) {
        persisting.delete(key);
      }
    });
    return next;
  };

  /** Save the room `key` names now, through `through` when given (see {@link persistHosted}). */
  const persist = (key: string, through?: ProjectStateHost): Promise<void> =>
    serialize(key, async () => {
      const source = host.sourceOf(key);
      if (source === null) {
        return;
      }
      const room = hosted.get(key);
      await (room === undefined
        ? persistPlain(key, source)
        : persistHosted(key, room, source, through));
    });

  /** Decodes a file as `readFile(path, "utf8")` does, keeping a byte order mark in the text. */
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

  const host = createCollabHost({
    keyOf,
    loadSource: async (path, key) => {
      const undo = record(path, key);
      try {
        const bytes = await readFile(absPathFor(path));
        const room = hosted.get(key);
        if (room !== undefined) {
          room.base = await contentHash(bytes);
          // The room saves through the host, so it starts now rather than on the first save.
          projectEvents?.start().catch(() => {});
        }
        return decoder.decode(bytes);
      } catch {
        undo();
        return null;
      }
    },
    onEmpty: (path) => {
      const existing = destroyTimers.get(path);
      if (existing) {
        clearTimeout(existing);
      }
      // Warnings-only model: an empty room is NOT auto-persisted (the last collaborator was warned
      // Before leaving). Its unsaved edits are dropped when the room is torn down after the grace.
      destroyTimers.set(
        path,
        setTimeout(() => {
          destroyTimers.delete(path);
          pendingPersist.delete(path);
          host.destroyRoomIfEmpty(path);
          if (host.sourceOf(path) === null) {
            forget(path);
            plain.delete(path);
          }
        }, EMPTY_ROOM_GRACE_MS),
      );
    },
    onFlush: (path) => persist(path),
    onSourceChange: (path) => {
      // No write-back: edits reach disk only on explicit flush (or graceful shutdown). The host
      // Owns the dirty broadcast; we just note the path for the shutdown worklist.
      pendingPersist.add(path);
    },
    rejectPath: (path) => {
      if (isBinaryPath(path)) {
        return "binary-file";
      }
      try {
        absPathFor(path);
        return null;
      } catch {
        return "content-not-loaded";
      }
    },
  });

  /** Every hosted room under `abs`, the path itself included. */
  const under = (abs: string): [string, string][] =>
    [...keyAt].filter(([at]) => at === abs || at.startsWith(`${abs}${sep}`));

  /**
   * Follow the host's index (§11.3): a rename moves a room, a removal closes it, and a change that
   * is not the room's own save reseeds it, unless it left the bytes the room already holds.
   */
  const apply = async (root: string, event: ProjectEvent): Promise<void> => {
    if (event.type === "fileRenamed") {
      const from = resolve(root, event.from);
      const to = resolve(root, event.to);
      for (const [at, key] of under(from)) {
        const moved = `${to}${at.slice(from.length)}`;
        const displaced = keyAt.get(moved);
        if (displaced !== undefined && displaced !== key) {
          host.resetDoc(displaced);
          forget(displaced);
        }
        keyAt.delete(at);
        keyAt.set(moved, key);
        const room = hosted.get(key);
        if (room !== undefined && room.abs === at) {
          room.abs = moved;
        }
      }
      return;
    }
    if (event.type === "fileRemoved") {
      for (const [, key] of under(resolve(root, event.path))) {
        pendingPersist.delete(key);
        host.resetDoc(key);
        forget(key);
      }
      return;
    }
    if (event.type !== "fileChanged") {
      return;
    }
    if (event.origin !== "external" && ownWrites.delete(event.origin.writeId)) {
      return;
    }
    const key = keyAt.get(resolve(root, event.path));
    const room = key === undefined ? undefined : hosted.get(key);
    if (key === undefined || room === undefined || event.hash === room.base) {
      return;
    }
    const source = host.sourceOf(key);
    if (source !== null && (await contentHash(source)) === event.hash) {
      room.base = event.hash;
      pendingPersist.delete(key);
      host.markPersisted(key);
      return;
    }
    host.resetDoc(key);
  };

  /**
   * The host of `root` began a new epoch and answered with `snapshot` (§4.8): whatever changed
   * between reaches each room as the event it would have been, a removal or a change.
   */
  const resync = async (root: string, snapshot: ProjectSnapshot): Promise<void> => {
    const files = new Map(snapshot.files.map((file) => [file.path, file]));
    // Every hosted room is the served project's: an activation forgets the rooms of the one before.
    for (const [key, room] of hosted) {
      const path = relative(root, room.abs).replaceAll("\\", "/");
      const file = files.get(path);
      if (file === undefined) {
        pendingPersist.delete(key);
        host.resetDoc(key);
        forget(key);
      } else if (file.hash !== undefined) {
        await apply(root, {
          docId: file.docId,
          hash: file.hash,
          origin: "external",
          path,
          rev: 0,
          type: "fileChanged",
        });
      }
    }
  };

  let applying: Promise<void> = Promise.resolve();
  /** Run `step` after every earlier one; one that fails is reported, and the next still runs. */
  const queue = (step: () => Promise<void>): void => {
    applying = applying.then(step).catch((error: Error) => {
      console.error(`[collab] following the project state: ${error.message}`);
    });
  };
  const unfollow = projectEvents?.follow({
    events: (root, events) => {
      queue(async () => {
        for (const event of events) {
          await apply(root, event);
        }
      });
    },
    resynced: (root, snapshot) => {
      queue(() => resync(root, snapshot));
    },
    /* The last moment the project's host takes writes: every room with unsaved edits is saved
       through it, with its base, before the activation closes them. */
    retiring: async (running) => {
      const saves: Promise<void>[] = [];
      for (const [key, room] of hosted) {
        if (room.root === running.root && pendingPersist.has(key)) {
          saves.push(persist(key, running));
        }
      }
      await Promise.all(saves);
    },
    /* Another project: its rooms re-open under the next one, which may not cover them. A room
       keyed by its path that the next one covers closes too, so one file never has two rooms; its
       unsaved edits are saved first, as they would have been. */
    retired: (root) => {
      for (const [key, room] of hosted) {
        if (room.root === root) {
          pendingPersist.delete(key);
          host.resetDoc(key);
          forget(key);
        }
      }
      for (const key of plain) {
        if (coverage(resolve(absRoot, key)) === null) {
          continue;
        }
        const source = host.sourceOf(key);
        const dirty = pendingPersist.delete(key);
        host.resetDoc(key);
        plain.delete(key);
        if (dirty && source !== null) {
          void serialize(key, () => persistPlain(key, source));
        }
      }
    },
  });

  return {
    handleExternalChange(absPath) {
      const path = relPathFor(absPath);
      if (host.subscriberCount(path) === 0 && host.sourceOf(path) === null) {
        return;
      }
      void (async () => {
        let content: string | null = null;
        try {
          content = await readFile(absPathFor(path), "utf8");
        } catch {
          content = null;
        }
        // Our own write-back (or a no-op save) is not an external change.
        if (
          content !== null &&
          (content === lastWritten.get(path) || content === host.sourceOf(path))
        ) {
          return;
        }
        host.resetDoc(path);
      })();
    },

    handleRequest(req, server) {
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        /*
         * RFC 6455 §4.2.2: echo one of the tokens the client offered, or none if it offered none.
         * An offer we cannot satisfy is refused outright rather than upgraded — two peers whose
         * envelopes disagree about merge granularity must not share a room, and a 400 here is a
         * better outcome than the divergent-history merge that would follow.
         */
        const answer = selectSubprotocol(
          offeredSubprotocols(req.headers.get("sec-websocket-protocol")),
        );
        if (answer.reject !== null) {
          return problem("invalidRequest", answer.reject);
        }
        const upgraded =
          answer.echo === null
            ? server.upgrade(req, { data: { connection: null } })
            : server.upgrade(req, {
                data: { connection: null },
                headers: { "Sec-WebSocket-Protocol": answer.echo },
              });
        return upgraded ? undefined : problem("invalidRequest", "Upgrade failed");
      }
      /*
       * The capability probe, which is also the negotiation input: a client learns here what this
       * server speaks, because offering a subprotocol the server cannot echo would fail the
       * handshake (RFC 6455 §4.1) rather than degrade. `version` stays for older clients.
       */
      return Response.json({ collab: true, protocols: [COLLAB_SUBPROTOCOL], version: 1 });
    },

    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      unfollow?.();
      for (const timer of destroyTimers.values()) {
        clearTimeout(timer);
      }
      // Last-ditch safety on graceful shutdown: flush every path with unsaved edits.
      const flushes: Promise<void>[] = [...persisting.values()];
      for (const path of pendingPersist) {
        flushes.push(persist(path));
      }
      pendingPersist.clear();
      destroyTimers.clear();
      await Promise.all(flushes);
      host.destroy();
    },

    websocket: {
      close(ws: ServeSocket<CollabSocketData>) {
        ws.data.connection?.close();
        ws.data.connection = null;
      },
      message(ws: ServeSocket<CollabSocketData>, message: string | Buffer) {
        if (isString(message)) {
          return;
        }
        ws.data.connection?.handleMessage(new Uint8Array(message));
      },
      open(ws: ServeSocket<CollabSocketData>) {
        connectionCounter += 1;
        const login = `local-${connectionCounter}`;
        ws.data.connection = host.connect(
          {
            close: () => ws.close(),
            send: (data) => {
              ws.send(data);
            },
          },
          { color: colorForKey(login), login, permission: "write" },
        );
      },
    },
  };
}
