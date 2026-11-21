/**
 * The live preview overlay as the project state host owns it (`specs/project-state.md` §11.3): the
 * unsaved bytes each client publishes for a document, keyed by the document's {@link DocId} and the
 * client that set them rather than by a path or a connection.
 *
 * A rename or a move keeps the overlay and republishes it at the new path; a removal drops it,
 * matched by its path as well as its id, so an overlay keyed before the host knew the document or
 * by an id from an earlier epoch (a restart mints new ones) is dropped with its file too. A
 * client's overlays outlive its socket: the host drops them once no subscription naming that
 * `clientId` has been open for the grace period (`overlayGraceMs`, 30 seconds by default), so a
 * reconnect, a suspended window or a host restart never unpublishes an author's preview, and a
 * closed window never leaves its bytes published for longer than that. A client that named no
 * `clientId` has its overlays dropped when its subscription ends.
 *
 * The registry performs no I/O: it tells `publish` and `unpublish` what a reader should see at a
 * path, and the host hands it the file events it emits (`apply`). Two clients may overlay one
 * document; the one that set it last is what a reader sees, and clearing it shows the other's.
 *
 * @module
 */

import type { DocId, ProjectEvent } from "@jxsuite/protocol/project-state";

/** The default grace before a departed client's overlays are dropped, in ms (§11.3). */
export const OVERLAY_GRACE_MS = 30_000;

export interface OverlayRegistryOptions {
  /** Show `contents` to readers of `path` in place of the file. */
  publish: (path: string, contents: string) => void;
  /** Show readers the file at `path` again. */
  unpublish: (path: string) => void;
  /** How long a client's overlays outlive its last subscription, in ms. */
  graceMs?: number;
}

/** Who set an overlay: a client by its `clientId`, or a subscription that named none. */
export type OverlayOwner = { clientId: string } | { anonymous: string };

export interface OverlayRegistry {
  /** Publish `owner`'s unsaved bytes for the document `docId`, which is at `path` now. */
  set: (owner: OverlayOwner, docId: DocId, path: string, contents: string) => void;
  /** Drop `owner`'s overlay of `docId`, or every overlay it set. */
  clear: (owner: OverlayOwner, docId?: DocId) => void;
  /** Drop every overlay, whoever set it. */
  clearAll: () => void;
  /** A subscription for `owner` opened: its overlays are kept for as long as one is open. */
  opened: (owner: OverlayOwner) => void;
  /** A subscription for `owner` ended; the last one starts its grace (none for an anonymous one). */
  closed: (owner: OverlayOwner) => void;
  /** Follow the host's file events: a rename moves an overlay, a removal drops it. */
  apply: (events: readonly ProjectEvent[]) => void;
  /**
   * Hand `from`'s layer of each document in `docIds` to `to`, keeping what readers see: a socket
   * that subscribes takes over what it set before it did (§11.3).
   */
  adopt: (from: OverlayOwner, to: OverlayOwner, docIds: Iterable<DocId>) => void;
  /** The documents overlaid now, with the path each is published at. */
  published: () => { docId: DocId; path: string }[];
  /** Cancel every pending grace, and arm none after; the overlays stay as they are. */
  close: () => void;
}

interface Overlaid {
  path: string;
  /** Each owner's bytes, the most recently set last. */
  layers: Map<string, string>;
}

const keyOf = (owner: OverlayOwner): string =>
  "clientId" in owner ? `client:${owner.clientId}` : `anonymous:${owner.anonymous}`;

/** Whether `path` is `dir` or beneath it. */
const within = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);

/** Create an empty overlay registry. */
export function createOverlayRegistry(options: OverlayRegistryOptions): OverlayRegistry {
  const graceMs = options.graceMs ?? OVERLAY_GRACE_MS;
  const docs = new Map<DocId, Overlaid>();
  const open = new Map<string, number>();
  const graces = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;

  /** Show readers of `doc` the newest layer, or the file when there is none. */
  const show = (docId: DocId, doc: Overlaid): void => {
    const newest = [...doc.layers.values()].at(-1);
    if (newest === undefined) {
      docs.delete(docId);
      options.unpublish(doc.path);
    } else {
      options.publish(doc.path, newest);
    }
  };

  const dropOwner = (key: string): void => {
    for (const [docId, doc] of docs) {
      if (doc.layers.delete(key)) {
        show(docId, doc);
      }
    }
  };

  const cancelGrace = (key: string): void => {
    const timer = graces.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      graces.delete(key);
    }
  };

  const move = (from: string, to: string): void => {
    for (const doc of docs.values()) {
      if (within(doc.path, from)) {
        const moved = `${to}${doc.path.slice(from.length)}`;
        options.unpublish(doc.path);
        doc.path = moved;
        options.publish(moved, [...doc.layers.values()].at(-1)!);
      }
    }
  };

  const drop = (docId: DocId, path: string, isDir: boolean): void => {
    for (const [id, doc] of docs) {
      if (id === docId || (isDir ? within(doc.path, path) : doc.path === path)) {
        docs.delete(id);
        options.unpublish(doc.path);
      }
    }
  };

  return {
    adopt(from, to, docIds) {
      const fromKey = keyOf(from);
      const toKey = keyOf(to);
      for (const docId of docIds) {
        const doc = docs.get(docId);
        if (doc === undefined || !doc.layers.has(fromKey)) {
          continue;
        }
        const keys = [...doc.layers.keys()];
        if (keys.indexOf(toKey) > keys.indexOf(fromKey)) {
          // `to` set the document since: its own layer is the newer one.
          doc.layers.delete(fromKey);
        } else {
          // Rebuilt in order, so the layer keeps its place and what readers see does not move.
          doc.layers = new Map(
            [...doc.layers].flatMap(([key, value]): [string, string][] =>
              key === toKey ? [] : [[key === fromKey ? toKey : key, value]],
            ),
          );
        }
      }
    },
    apply(events) {
      for (const event of events) {
        if (event.type === "fileRenamed") {
          move(event.from, event.to);
        } else if (event.type === "fileRemoved") {
          drop(event.docId, event.path, event.isDir);
        }
      }
    },
    clear(owner, docId) {
      const key = keyOf(owner);
      if (docId === undefined) {
        dropOwner(key);
        return;
      }
      const doc = docs.get(docId);
      if (doc?.layers.delete(key) === true) {
        show(docId, doc);
      }
    },
    clearAll() {
      for (const doc of docs.values()) {
        options.unpublish(doc.path);
      }
      docs.clear();
    },
    close() {
      stopped = true;
      for (const timer of graces.values()) {
        clearTimeout(timer);
      }
      graces.clear();
    },
    closed(owner) {
      const key = keyOf(owner);
      const count = (open.get(key) ?? 1) - 1;
      if (count > 0) {
        open.set(key, count);
        return;
      }
      open.delete(key);
      if (!("clientId" in owner)) {
        dropOwner(key);
        return;
      }
      cancelGrace(key);
      if (stopped) {
        return;
      }
      const timer = setTimeout(() => {
        graces.delete(key);
        dropOwner(key);
      }, graceMs);
      // A pending grace must not keep the process alive on its own.
      timer.unref();
      graces.set(key, timer);
    },
    opened(owner) {
      const key = keyOf(owner);
      cancelGrace(key);
      open.set(key, (open.get(key) ?? 0) + 1);
    },
    published: () => [...docs].map(([docId, doc]) => ({ docId, path: doc.path })),
    set(owner, docId, path, contents) {
      const key = keyOf(owner);
      let doc = docs.get(docId);
      if (doc === undefined) {
        doc = { layers: new Map(), path };
        docs.set(docId, doc);
      } else if (doc.path !== path) {
        options.unpublish(doc.path);
        doc.path = path;
      }
      doc.layers.delete(key);
      doc.layers.set(key, contents);
      options.publish(path, contents);
    },
  };
}
