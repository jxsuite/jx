/**
 * Store.ts — the one content store a project's caches derive from (`project-state.md` §11.1).
 *
 * The backend's project state (`project-state.md` §2, §3) names every document by a `DocId` that
 * survives a rename, and its bytes by a content hash. This store mirrors that model on the client:
 * the documents the host's snapshot and events describe, keyed by id with the path as a relabelable
 * attribute, and the contents Studio has in hand keyed by `(docId, hash)`, so a rename moves no
 * bytes and a change drops exactly the bytes it replaced.
 *
 * **One store per window, reset on project switch.** It is a module-level singleton for the reason
 * the content-version map is (`files/asset-versions.ts`): every surface reads the open project, so
 * none needs a parameter to find it. `files/open-sequence.ts` resets it while leaving a project,
 * beside the panels' own caches.
 *
 * **Own writes are recognised by their bytes** (`project-state.md` §2.4). Studio notes the hash of
 * every write it makes before making it ({@link ContentStore.noteOwnWrite}), and an event at that
 * path whose hash matches is the write's echo, whatever its `origin` says: a write that went
 * through the platform's plain `writeFile` reaches the host only through its watcher, which reports
 * it as `"external"`. A write that names its id through the contract is recognised by the id
 * ({@link ContentStore.noteWriteId}). Either replaces the 1.5 second window of `studio.md` §9.2 for
 * a platform whose host answers a subscription.
 *
 * The store holds state and answers questions; it subscribes to nothing. `subscription.ts` feeds
 * it, so no cache ever reads file events on its own (§11.1).
 *
 * @license MIT
 * @docs extending/embedding/platform-adapter
 */

import { contentHash, ECHO_LEDGER_DEPTH, isOwnOrigin } from "@jxsuite/protocol/project-state";
import type {
  ContentHash,
  DocId,
  DocKind,
  GitSummary,
  ProjectEvent,
  ProjectSnapshot,
  ReadinessState,
} from "@jxsuite/protocol/project-state";

/** One document the host indexes, as the store holds it. */
export interface StoredDocument {
  readonly docId: DocId;
  /** Where the document is now; a rename relabels it and changes nothing else. */
  path: string;
  kind: DocKind;
  isDir: boolean;
  /** The hash of the bytes on disk; absent for a directory and for a file the host has not hashed. */
  hash?: ContentHash;
  /** Whether the host has extracted the document's references (`project-state.md` §8.2). */
  indexed: boolean;
}

/** Bytes as Studio holds them: text for a document, bytes for anything else. */
export type StoredContents = string | Uint8Array;

/** What one applied snapshot or event invalidated, for the caches that derive from the store. */
export interface StoreChange {
  /**
   * Documents whose bytes changed or that left the project: every derivation keyed by one of these
   * documents' previous hashes is stale.
   */
  docIds: DocId[];
  /** The paths those documents had before the change and have after it, once each. */
  paths: string[];
  /** Whether the change replaced the whole state (a snapshot) rather than patching it. */
  snapshot: boolean;
}

/** Bytes a write may name: what `writeFile` and `uploadFile` take. */
export type OwnWriteContents = string | Uint8Array | ArrayBuffer | Blob;

/** The store of one project's documents and their contents. */
export interface ContentStore {
  /** The document at `path` now, if the host indexes one. */
  docAt: (path: string) => StoredDocument | undefined;
  /** A document by its id. */
  document: (docId: DocId) => StoredDocument | undefined;
  /** Every document, in no particular order. */
  documents: () => StoredDocument[];
  /** The hash of the bytes at `path` now, if the host has hashed them. */
  hashAt: (path: string) => ContentHash | undefined;
  /**
   * The hash of the newest write Studio noted at `path` whose echo has not arrived: the bytes the
   * path is about to hold, before the host says so. A derivation keyed by the hash at a path reads
   * it beside {@link hashAt}, so a cache filled between Studio's write and its echo is keyed by the
   * new bytes rather than the old ones. `except` skips the notes of one write's own bytes, for a
   * write asking what it replaces.
   */
  pendingWriteAt: (path: string, except?: ContentHash) => ContentHash | undefined;
  /** The contents held for one `(docId, hash)`, if any. */
  contents: (docId: DocId, hash: ContentHash) => StoredContents | undefined;
  /** The contents of the bytes at `path` now, if the store holds them. */
  contentsAt: (path: string) => StoredContents | undefined;
  /**
   * Hold `contents` as the bytes of the document at `path` with `hash`. Bytes for a path the host
   * has not indexed yet (a file Studio just created) wait for the event that names it, and are
   * dropped if that event names other bytes.
   */
  put: (path: string, hash: ContentHash, contents: StoredContents) => void;
  /** The discoverable component tags, as the last snapshot or `componentsChanged` gave them. */
  readonly components: readonly string[];
  /** The format-set token, `null` before the first snapshot. */
  readonly formats: string | null;
  /** The host's readiness, `null` before the first snapshot. */
  readonly readiness: ReadinessState | null;
  /** The git summary, `null` when there is none. */
  readonly git: GitSummary | null;
  /** Replace the whole state with `snapshot` (`project-state.md` §3.1): nothing it omits survives. */
  applySnapshot: (snapshot: ProjectSnapshot) => StoreChange;
  /** Apply one event (`project-state.md` §4). */
  applyEvent: (event: ProjectEvent) => StoreChange;
  /**
   * Note a write Studio is about to make, by the hash of the bytes it writes, so that its echo is
   * recognised ({@link isOwnEvent}). Resolves once the hash is noted; an event that arrives before
   * then is attributed after it ({@link settled}). Never rejects: a blob that cannot be read is
   * simply not noted.
   */
  noteOwnWrite: (path: string, contents: OwnWriteContents) => Promise<void>;
  /**
   * Drop the note {@link noteOwnWrite} made for `contents` at `path`: the write was refused, so no
   * echo of those bytes is coming, and a later change to them is somebody else's.
   */
  forgetOwnWrite: (path: string, contents: OwnWriteContents) => Promise<void>;
  /** Note the id of a write Studio issues through the contract (`project-state.md` §5). */
  noteWriteId: (writeId: string) => void;
  /** Resolves once every {@link noteOwnWrite} begun so far has noted its hash. */
  settled: () => Promise<void>;
  /**
   * Whether `event` is the echo of Studio's own write: its origin names a write id Studio issued,
   * or it reports at a path bytes Studio noted for it. Either way the event consumes the note of
   * its bytes and every older one for the path, since a watcher may coalesce several writes into
   * one report of the last: a write attributed by its id leaves no note behind to take a later
   * return to the same bytes for Studio's own (`project-state.md` §2.4).
   *
   * Unlike the host's ledger (`createEchoLedger`), a report of other bytes clears nothing: the
   * client notes a write before the events already queued ahead of it are applied, so an older
   * change at the path is no evidence against the write. A note whose echo never comes (another
   * writer's bytes won) stays until a removal or the depth bound drops it, and the worst it can do
   * is take a later return to those same bytes for Studio's own, which they are: the tab holds them
   * already. Call it once per event, before {@link applyEvent}.
   */
  isOwnEvent: (event: ProjectEvent) => boolean;
  /** Listen for every change the store applies; returns the unsubscribe. */
  onChange: (listener: (change: StoreChange) => void) => () => void;
  /** Forget everything: the documents, the contents, the noted writes and the project fields. */
  reset: () => void;
}

/** The bytes of a write, as {@link contentHash} takes them. */
async function hashable(contents: OwnWriteContents): Promise<Uint8Array | string> {
  if (contents instanceof Blob) {
    return new Uint8Array(await contents.arrayBuffer());
  }
  if (contents instanceof ArrayBuffer) {
    return new Uint8Array(contents);
  }
  return contents;
}

/** Whether `path` is `dir` or lies under it. */
function within(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/** A new, empty {@link ContentStore}. */
export function createContentStore(): ContentStore {
  const docs = new Map<DocId, StoredDocument>();
  const byPath = new Map<string, DocId>();
  /** Contents by document, then by hash. */
  const held = new Map<DocId, Map<ContentHash, StoredContents>>();
  /** Contents written to a path the host has not indexed yet, by path, then by hash. */
  const unbound = new Map<string, Map<ContentHash, StoredContents>>();
  /** Hashes of Studio's own writes whose echo has not arrived, by path, oldest first. */
  const notes = new Map<string, ContentHash[]>();
  const writeIds = new Set<string>();
  const noting = new Set<Promise<void>>();
  const listeners = new Set<(change: StoreChange) => void>();
  let components: readonly string[] = [];
  let formats: string | null = null;
  let readiness: ReadinessState | null = null;
  let git: GitSummary | null = null;

  /** Hold contents under a document: only the bytes it has now are ever kept. */
  const keep = (docId: DocId, hash: ContentHash, contents: StoredContents) => {
    held.set(docId, new Map([[hash, contents]]));
  };

  /** Move contents written before the host indexed `path` onto its document, if they match. */
  const bind = (doc: StoredDocument) => {
    const waiting = unbound.get(doc.path);
    // Bytes the host has not hashed yet cannot be matched; they wait for its next event.
    if (!waiting || doc.hash === undefined) {
      return;
    }
    unbound.delete(doc.path);
    const contents = waiting.get(doc.hash);
    if (contents !== undefined) {
      keep(doc.docId, doc.hash, contents);
    }
  };

  /** Record a document at its path, displacing whatever was indexed there. */
  const index = (doc: StoredDocument, change: Set<DocId>, paths: Set<string>) => {
    const displaced = byPath.get(doc.path);
    if (displaced !== undefined && displaced !== doc.docId) {
      docs.delete(displaced);
      held.delete(displaced);
      change.add(displaced);
    }
    const previous = docs.get(doc.docId);
    if (previous && previous.path !== doc.path && byPath.get(previous.path) === doc.docId) {
      byPath.delete(previous.path);
      paths.add(previous.path);
    }
    docs.set(doc.docId, doc);
    byPath.set(doc.path, doc.docId);
    paths.add(doc.path);
    bind(doc);
  };

  /** A new hash for a document: the bytes it held are no longer on disk. */
  const rehash = (doc: StoredDocument, hash: ContentHash, change: Set<DocId>) => {
    if (doc.hash === hash) {
      return;
    }
    doc.hash = hash;
    // Only a document's current bytes are held, so these are gone; new ones wait in `unbound`.
    held.delete(doc.docId);
    change.add(doc.docId);
    bind(doc);
  };

  /** Remove the document at `path`, and every one under it when it is a directory. */
  const remove = (path: string, isDir: boolean, change: Set<DocId>, paths: Set<string>) => {
    for (const doc of docs.values()) {
      if (doc.path === path || (isDir && within(doc.path, path))) {
        docs.delete(doc.docId);
        held.delete(doc.docId);
        if (byPath.get(doc.path) === doc.docId) {
          byPath.delete(doc.path);
        }
        change.add(doc.docId);
        paths.add(doc.path);
      }
    }
    unbound.delete(path);
  };

  /** Relabel the document at `from`, and every one under it when it is a directory. */
  const relabel = (from: string, to: string, paths: Set<string>) => {
    for (const doc of docs.values()) {
      if (within(doc.path, from)) {
        const next = to + doc.path.slice(from.length);
        if (byPath.get(doc.path) === doc.docId) {
          byPath.delete(doc.path);
        }
        paths.add(doc.path);
        doc.path = next;
        byPath.set(next, doc.docId);
        paths.add(next);
      }
    }
  };

  /** The document an event names, created when the store has not seen it. */
  const ensure = (docId: DocId, path: string, change: Set<DocId>, paths: Set<string>) => {
    const known = docs.get(docId);
    if (known) {
      if (known.path !== path) {
        index({ ...known, path }, change, paths);
        return docs.get(docId)!;
      }
      return known;
    }
    const doc: StoredDocument = { docId, indexed: false, isDir: false, kind: "other", path };
    index(doc, change, paths);
    return doc;
  };

  const announce = (change: StoreChange): StoreChange => {
    for (const listener of listeners) {
      listener(change);
    }
    return change;
  };

  const store: ContentStore = {
    docAt(path) {
      const docId = byPath.get(path);
      return docId === undefined ? undefined : docs.get(docId);
    },
    document(docId) {
      return docs.get(docId);
    },
    documents() {
      return [...docs.values()];
    },
    hashAt(path) {
      return store.docAt(path)?.hash;
    },
    pendingWriteAt(path, except) {
      return notes.get(path)?.findLast((hash) => hash !== except);
    },
    contents(docId, hash) {
      return held.get(docId)?.get(hash);
    },
    contentsAt(path) {
      const doc = store.docAt(path);
      return doc?.hash === undefined ? undefined : held.get(doc.docId)?.get(doc.hash);
    },
    put(path, hash, contents) {
      const doc = store.docAt(path);
      if (doc && (doc.hash === undefined || doc.hash === hash)) {
        keep(doc.docId, hash, contents);
        return;
      }
      // Bytes the host has not reported yet: they wait for the event that names them.
      unbound.set(path, new Map([[hash, contents]]));
    },
    get components() {
      return components;
    },
    get formats() {
      return formats;
    },
    get readiness() {
      return readiness;
    },
    get git() {
      return git;
    },
    applySnapshot(snapshot) {
      const change = new Set<DocId>();
      const paths = new Set<string>();
      const kept = new Map<DocId, ContentHash | undefined>();
      for (const file of snapshot.files) {
        kept.set(file.docId, file.hash);
      }
      // Everything the snapshot does not name, by id and by hash, is gone (§3.1, §11.1).
      for (const doc of docs.values()) {
        if (!kept.has(doc.docId) || kept.get(doc.docId) !== doc.hash) {
          change.add(doc.docId);
          paths.add(doc.path);
        }
      }
      for (const docId of held.keys()) {
        const hash = kept.get(docId);
        if (hash === undefined || !held.get(docId)!.has(hash)) {
          held.delete(docId);
        }
      }
      docs.clear();
      byPath.clear();
      for (const file of snapshot.files) {
        const doc: StoredDocument = {
          docId: file.docId,
          indexed: file.indexed,
          isDir: file.isDir,
          kind: file.kind,
          path: file.path,
        };
        if (file.hash !== undefined) {
          doc.hash = file.hash;
        }
        docs.set(doc.docId, doc);
        byPath.set(doc.path, doc.docId);
        if (change.has(doc.docId)) {
          paths.add(doc.path);
        }
        bind(doc);
      }
      ({ components, formats, readiness } = snapshot);
      git = snapshot.git ?? null;
      return announce({ docIds: [...change], paths: [...paths], snapshot: true });
    },
    applyEvent(event) {
      const change = new Set<DocId>();
      const paths = new Set<string>();
      switch (event.type) {
        case "fileAdded": {
          const doc: StoredDocument = {
            docId: event.docId,
            indexed: false,
            isDir: event.isDir,
            kind: docs.get(event.docId)?.kind ?? "other",
            path: event.path,
          };
          if (event.hash !== undefined) {
            doc.hash = event.hash;
          }
          index(doc, change, paths);
          change.add(doc.docId);
          break;
        }
        case "fileChanged": {
          const doc = ensure(event.docId, event.path, change, paths);
          paths.add(doc.path);
          rehash(doc, event.hash, change);
          break;
        }
        case "fileRemoved": {
          remove(event.path, event.isDir, change, paths);
          break;
        }
        case "fileRenamed": {
          relabel(event.from, event.to, paths);
          unbound.delete(event.from);
          break;
        }
        case "docChanged": {
          const doc = ensure(event.docId, event.path, change, paths);
          paths.add(doc.path);
          doc.kind = event.kind;
          doc.indexed = event.indexed;
          rehash(doc, event.hash, change);
          break;
        }
        case "projectConfigChanged": {
          const doc = store.docAt(event.path);
          if (doc) {
            paths.add(doc.path);
            rehash(doc, event.hash, change);
          }
          break;
        }
        case "componentsChanged": {
          ({ tags: components } = event);
          break;
        }
        case "formatsChanged": {
          ({ formats } = event);
          break;
        }
        case "gitChanged": {
          git = event.status;
          break;
        }
        case "readiness": {
          readiness = event.state;
          break;
        }
        default: {
          // Graph, conflict, operation and watcher events describe no document's bytes.
          break;
        }
      }
      return announce({ docIds: [...change], paths: [...paths], snapshot: false });
    },
    noteOwnWrite(path, contents) {
      const noted = (async () => {
        const bytes = await hashable(contents);
        const hash = await contentHash(bytes);
        // Writing the bytes already on disk changes nothing, so the host reports nothing to match.
        if (store.hashAt(path) !== hash) {
          const list = notes.get(path) ?? [];
          list.push(hash);
          notes.set(path, list.slice(-ECHO_LEDGER_DEPTH));
        }
        store.put(path, hash, bytes);
      })().catch(() => {
        // Bytes that cannot be read cannot be noted: their echo reads as another writer's change.
      });
      noting.add(noted);
      void noted.then(() => {
        noting.delete(noted);
      });
      return noted;
    },
    async forgetOwnWrite(path, contents) {
      // After the note it is undoing, which may still be hashing.
      await store.settled();
      let hash: ContentHash;
      try {
        hash = await contentHash(await hashable(contents));
      } catch {
        // Bytes that cannot be read were never noted.
        return;
      }
      const list = notes.get(path);
      const at = list?.lastIndexOf(hash) ?? -1;
      if (!list || at === -1) {
        return;
      }
      list.splice(at, 1);
      if (list.length === 0) {
        notes.delete(path);
      }
    },
    noteWriteId(writeId) {
      writeIds.add(writeId);
    },
    async settled() {
      await Promise.allSettled(noting);
    },
    isOwnEvent(event) {
      const byId = isOwnOrigin(event.origin, writeIds);
      if (event.type === "fileRemoved") {
        notes.delete(event.path);
        return byId;
      }
      if ((event.type !== "fileAdded" && event.type !== "fileChanged") || !event.hash) {
        return byId;
      }
      const list = notes.get(event.path);
      const at = list?.lastIndexOf(event.hash) ?? -1;
      if (!list || at === -1) {
        return byId;
      }
      list.splice(0, at + 1);
      if (list.length === 0) {
        notes.delete(event.path);
      }
      return true;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      docs.clear();
      byPath.clear();
      held.clear();
      unbound.clear();
      notes.clear();
      writeIds.clear();
      components = [];
      formats = null;
      readiness = null;
      git = null;
    },
  };
  return store;
}

/** The open project's store. */
export const contentStore: ContentStore = createContentStore();

/** Forget the project being left (`files/open-sequence.ts`). */
export function resetContentStore(): void {
  contentStore.reset();
}
