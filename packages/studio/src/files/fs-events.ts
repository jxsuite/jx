/// <reference lib="dom" />
/**
 * Fs-events.ts — keep the cached sidebar tree and the derived caches current with the backend.
 *
 * `applyFsEvents` is a pure, in-place reducer over `projectState.dirs`/`expanded` (unit-testable
 * without a DOM). `startFsSync` is the only impure part: it runs the host's project state
 * subscription (`project-state/subscription.ts`, `project-state.md` §3) and feature-detects the
 * platform's `subscribeFileEvents`, debouncing its bursts into one re-render through the existing
 * left-panel render path (no imperative DOM).
 *
 * **The subscription is the one account of change** (`project-state.md` §3.3, §11.1). A reconnect
 * is a subscribe with `{ epoch, sinceRev }`, answered with exactly the events missed or a snapshot,
 * so nothing here re-reads a listing to repair a gap. Studio's own writes are recognised by the
 * hash of the bytes it noted before writing them, never by when their echo arrives. The content
 * changes an open tab reloads on come from the subscription's `docChanged` events, each attributed
 * by write id or hash and held against the tab's buffer (`project-state/buffer.ts`, §6.1);
 * `project-state/derive.ts` says which caches each store event makes stale, and the content
 * versions are the store's hashes (`deriveVersionsFrom`). The tree folds the store's file events
 * and every snapshot's account of the file set, so a file added while the stream was down appears
 * when it comes back.
 *
 * The watcher's `subscribeFileEvents` batches still reach the tree, for what lies outside the
 * host's index scope (`node_modules`, `dist`), and git status, which moves with a second edit to a
 * modified file although the host's summary does not. Both folds are idempotent, so a change both
 * report lands once.
 *
 * **A platform whose host does not serve the subscription** (no `subscribeProjectState`, or a host
 * that has refused every subscribe so far) gets no live account of other writers' changes: open
 * tabs and the canvas's definitions are not re-read when a file changes on disk, since nothing can
 * tell Studio's own write from another's, and listings vouch for no content version, since nothing
 * says when the stream had a gap. The tree and the caches keyed on the file set still follow the
 * watcher's batches when the platform has them. Reopening the project, or a file, reads it again.
 */

import { getPlatform } from "../platform";
import { reloadIgnoreCache, touchesGitignore } from "./gitignore";
import { invalidateUsages } from "../services/references";
import {
  derivedVersionsChanged,
  deriveVersionsFrom,
  forgetAllVersions,
  forgetVersions,
  vouchForListings,
} from "./asset-versions";
import { projectState } from "../store";
import { contentStore } from "../project-state/store";
import type { OwnWriteContents, StoredPath } from "../project-state/store";
import { createStoreDerivations } from "../project-state/derive";
import { forgetDiskRevisions, noteDiskHash } from "../project-state/buffer";
import { reportForeignChange } from "../project-state/foreign";
import type { ContentHash, ProjectEvent, ReadinessState } from "@jxsuite/protocol/project-state";
import {
  projectStateLive,
  projectStateTracksWrites,
  startProjectStateSync,
  stopProjectStateSync,
} from "../project-state/subscription";
import { workspace } from "../workspace/workspace";
import type { DirEntry, FsEvent } from "../types";

const norm = (p: string) => p.replaceAll("\\", "/");

/**
 * Forget the content versions of paths Studio is about to mutate, each path as a file AND as a
 * directory (a rename or a delete may name either): the bytes are about to change, and a version
 * that outlived them would let an immutable cache serve the old ones.
 */
export function markLocalMutation(...paths: string[]): void {
  forgetVersions(paths, paths);
}

/**
 * Note the bytes Studio is about to write at `path`, so that the host's report of them is
 * recognised as Studio's own (`project-state.md` §2.4). Only while a project state subscription
 * runs: without one there is no event to attribute, and nothing is hashed.
 */
export function noteLocalWrite(path: string, contents: OwnWriteContents): void {
  if (projectStateTracksWrites()) {
    void contentStore.noteOwnWrite(norm(path), contents);
  }
}

/** {@link markLocalMutation} and {@link noteLocalWrite} for a write whose bytes Studio has in hand. */
export function markLocalWrite(path: string, contents: OwnWriteContents): void {
  markLocalMutation(path);
  noteLocalWrite(path, contents);
}

function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "." : path.slice(0, i);
}

function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/**
 * Apply backend FS events to the cached directory tree in place, returning the set of directories
 * whose contents changed. Idempotent — re-adding an existing entry or removing an absent one is a
 * no-op, which absorbs watcher echoes. `change` events touch no tree state (name/type are stable).
 */
export function applyFsEvents(
  dirs: Map<string, DirEntry[]>,
  expanded: Set<string>,
  events: FsEvent[],
): Set<string> {
  const changedDirs = new Set<string>();
  for (const ev of events) {
    const parent = parentDir(ev.path);
    if (ev.type === "add" || ev.type === "addDir") {
      const entries = dirs.get(parent);
      if (entries && !entries.some((e) => e.path === ev.path)) {
        entries.push({
          name: baseName(ev.path),
          path: ev.path,
          type: ev.isDir ? "directory" : "file",
        });
        changedDirs.add(parent);
      }
      if (ev.type === "addDir" && !dirs.has(ev.path)) {
        dirs.set(ev.path, []);
      }
    } else if (ev.type === "unlink" || ev.type === "unlinkDir") {
      const entries = dirs.get(parent);
      if (entries) {
        const idx = entries.findIndex((e) => e.path === ev.path);
        if (idx !== -1) {
          entries.splice(idx, 1);
          changedDirs.add(parent);
        }
      }
      if (ev.type === "unlinkDir") {
        dirs.delete(ev.path);
        const nestedDirs: string[] = [];
        for (const key of dirs.keys()) {
          if (key.startsWith(`${ev.path}/`)) {
            nestedDirs.push(key);
          }
        }
        for (const key of nestedDirs) {
          dirs.delete(key);
        }
        const staleExpanded: string[] = [];
        for (const key of expanded) {
          if (key === ev.path || key.startsWith(`${ev.path}/`)) {
            staleExpanded.push(key);
          }
        }
        for (const key of staleExpanded) {
          expanded.delete(key);
        }
      }
    }
  }
  return changedDirs;
}

/**
 * Forget the content versions every event in a batch could have invalidated: the file an `add`,
 * `change` or `unlink` names, and everything under a removed directory.
 */
export function forgetEventVersions(events: readonly FsEvent[]): void {
  const paths: string[] = [];
  const dirs: string[] = [];
  for (const event of events) {
    if (event.type === "unlinkDir") {
      dirs.push(event.path);
    } else if (event.type !== "addDir") {
      paths.push(event.path);
    }
  }
  if (paths.length > 0 || dirs.length > 0) {
    forgetVersions(paths, dirs);
  }
}

/**
 * Whether the tree ever lists `path`. No listing carries a dotfile (`.gitignore`, `.env`), and the
 * host's index does, so the store's account of one is not the tree's.
 */
function listable(path: string): boolean {
  return path !== "" && !path.split("/").some((segment) => segment.startsWith("."));
}

/**
 * The tree's share of store events, as file events: an addition, a removal, and a rename as a
 * removal of the old path and an addition of the new one. An added directory is added as an entry
 * of its parent and never as an empty listing of its own (`addDir`), since the store's account of a
 * directory says nothing about whether its listing was read.
 */
export function storeTreeEvents(events: readonly ProjectEvent[]): FsEvent[] {
  const out: FsEvent[] = [];
  const added = (path: string, isDir: boolean) => {
    if (listable(path)) {
      out.push({ isDir, path, type: "add" });
    }
  };
  const removed = (path: string, isDir: boolean) => {
    if (listable(path)) {
      out.push({ isDir, path, type: isDir ? "unlinkDir" : "unlink" });
    }
  };
  for (const event of events) {
    if (event.type === "fileAdded") {
      added(event.path, event.isDir);
    } else if (event.type === "fileRemoved") {
      removed(event.path, event.isDir);
    } else if (event.type === "fileRenamed") {
      removed(event.from, event.isDir);
      added(event.to, event.isDir);
    }
  }
  return out;
}

/** A snapshot's account of the file set ({@link StoredPath}), as {@link storeTreeEvents} reads it. */
export function snapshotTreeEvents(
  added: readonly StoredPath[],
  removed: readonly StoredPath[],
): FsEvent[] {
  const out: FsEvent[] = [];
  for (const { isDir, path } of removed) {
    if (listable(path)) {
      out.push({ isDir, path, type: isDir ? "unlinkDir" : "unlink" });
    }
  }
  for (const { isDir, path } of added) {
    if (listable(path)) {
      out.push({ isDir, path, type: "add" });
    }
  }
  return out;
}

export interface FsSyncContext {
  renderLeftPanel: () => void;
  /** An open file another writer changed (reload a clean tab). Only while the subscription is live. */
  onContentChange?: (path: string) => void;
  /**
   * Drop every cache keyed on "what files the project contains".
   *
   * Passed in rather than imported, for the reason `renderLeftPanel` is: the caches live in panels,
   * and this module is imported BY the file layer those panels sit on top of — reaching up would be
   * a cycle. The bootstrap owns the list because the bootstrap is where the panels are already in
   * scope.
   *
   * Handed the project-relative paths the change touched, so a cache that only one directory can
   * change (the media listing, the component registry) can ignore the rest. `undefined` means any
   * path may have changed.
   *
   * `structural` says whether the change added, removed or renamed anything, as opposed to only
   * rewriting files that already existed: a cache of the file SET can ignore a change that only
   * rewrote files, which is every save.
   */
  invalidateDerivedCaches?: (paths?: readonly string[], structural?: boolean) => void;
  /**
   * The working tree moved: re-read git status. Called for every watcher batch, Studio's own echoes
   * included (a write Studio made changes the status as much as anyone else's), and for the host's
   * `gitChanged`. The callee debounces; this module only reports. Injected for the reason
   * `renderLeftPanel` is: the git flow sits far above the file layer.
   */
  noteRepositoryChange?: () => void;
  /** Another writer changed a document's bytes: the live component lane re-reads it. */
  onDocumentChange?: (path: string) => void;
  /**
   * The host reported documents whose rendering depends on a changed one, and the custom-element
   * tags whose definitions changed (`dependentsInvalidated`, `project-state.md` §4.3). `applied`
   * says whether a path's current bytes already reached the canvas (Studio wrote them, or
   * `onDocumentChange` was told of them).
   */
  onDependentsInvalidated?: (
    paths: readonly string[],
    tags: readonly string[],
    applied: (path: string) => boolean,
  ) => void;
  /** The set of discoverable components changed (`componentsChanged`): re-read the registry. */
  onComponentsChanged?: () => void;
  /** The project's format set changed (`formatsChanged`): rebuild the format registry. */
  onFormatsChanged?: () => void;
  /** The host's readiness moved (`project-state.md` §7): re-derive what waited on it. */
  onReadiness?: (state: ReadinessState) => void;
}

/**
 * Subscribe the sidebar and the derived caches to the backend. Returns an unsubscribe function.
 * Bursts of watcher events are debounced into one render.
 *
 * The left panel repaints when a batch changed a cached listing, when it added, removed or renamed
 * anything (a panel drawn from a derived index, such as the Site panel's pages and templates, has
 * no listing of its own to change), and when the derived caches were dropped, echoes included,
 * since a dropped cache is only re-read by the next paint.
 */
export function startFsSync(ctx: FsSyncContext): () => void {
  const platform = getPlatform();
  /* What each store change means for the derived caches: the invalidators the watcher's batches
     call when no subscription is served, each on the store event that makes it stale. */
  const derivations = createStoreDerivations(contentStore, {
    componentsChanged: ctx.onComponentsChanged,
    dependentsInvalidated: ctx.onDependentsInvalidated,
    documentChanged: ctx.onDocumentChange,
    forgetVersions,
    formatsChanged: ctx.onFormatsChanged,
    gitChanged: ctx.noteRepositoryChange,
    invalidateDerivedCaches: ctx.invalidateDerivedCaches,
    invalidateUsages,
    readinessChanged: ctx.onReadiness,
    releaseVersions: derivedVersionsChanged,
    repaint: ctx.renderLeftPanel,
  });
  // Every path the store reports again moves its derived content version.
  const stopVersions = contentStore.onChange((change) => {
    derivedVersionsChanged(change.paths);
  });

  /** Fold file events into the cached tree; whether a listing changed. */
  const foldTree = (events: readonly FsEvent[]): boolean => {
    const state = projectState;
    if (!state || events.length === 0) {
      return false;
    }
    return applyFsEvents(state.dirs, state.expanded, [...events]).size > 0;
  };
  /** A `.gitignore` among `paths` governs the tree beneath it: read the rules again, then repaint. */
  const followGitignore = (paths: readonly string[]) => {
    if (touchesGitignore(paths)) {
      void reloadIgnoreCache().then(() => ctx.renderLeftPanel());
    }
  };

  /* The host's own account of the project, when it serves one. Its `docChanged` events reach the
     open tabs (a client re-reads on `docChanged`, never on a bare file event, `project-state.md`
     §4.3), attributed by write id or hash, so Studio's own save reloads nothing however late its
     echo arrives and a foreign write a moment after a save is not mistaken for it. A snapshot that
     replaced earlier state reports every file it changed. */
  /** The hash each path's last own file event carried, until its `docChanged` arrives. */
  const ownHashes = new Map<string, string>();
  /**
   * The hash of the bytes each path held when Studio last accounted for them: a `docChanged`, or
   * the store's hash after a snapshot. A `docChanged` that names the same bytes again (the host
   * filling in what it learned, after a restart or a configuration change, `project-state.md` §4.3)
   * is no change to report. Kept through a snapshot that names the file without a hash, so the
   * `docChanged` that later names it is compared with the bytes it held before.
   */
  const knownHashes = new Map<string, ContentHash>();
  /** Paths another writer's file event touched since their last `docChanged`. */
  const touched = new Set<string>();
  /** Forget what is known of `path`, and of everything under it when it is a directory. */
  const forgetKnown = (path: string, isDir: boolean) => {
    knownHashes.delete(path);
    touched.delete(path);
    if (isDir) {
      for (const key of knownHashes.keys()) {
        if (key.startsWith(`${path}/`)) {
          knownHashes.delete(key);
        }
      }
    }
  };
  /** Follow a rename: what is known of `from` (and beneath it) is known of `to`. */
  const relabelKnown = (from: string, to: string) => {
    const relabelled: [string, ContentHash][] = [];
    for (const [key, hash] of knownHashes) {
      if (key === from || key.startsWith(`${from}/`)) {
        knownHashes.delete(key);
        relabelled.push([to + key.slice(from.length), hash]);
      }
    }
    for (const [key, hash] of relabelled) {
      knownHashes.set(key, hash);
    }
  };
  /**
   * Whether bytes `hash` at `path` are news: they differ from the bytes known there, or nothing was
   * known and another writer's file event says the path moved.
   */
  const moved = (path: string, hash: string | undefined): boolean => {
    const known = knownHashes.get(path);
    return known === undefined ? hash === undefined || touched.has(path) : known !== hash;
  };
  /** Whether the subscription has been live, so its next loss is a gap. */
  let wasLive = false;
  /**
   * The subscription came back after a loss and its answer has not been folded yet. The watcher's
   * batches missed while it was down may have moved git status without moving its summary (a second
   * edit to a file already modified), so an answer that replays or replaces anything has git status
   * read again (the callee debounces).
   */
  let resumed = false;
  const subscription = startProjectStateSync(platform, {
    onEvents: (applied) => {
      for (const { event, own } of applied) {
        if (event.type === "fileAdded" || event.type === "fileChanged") {
          if (own && event.hash) {
            ownHashes.set(event.path, event.hash);
          } else if (!own) {
            touched.add(event.path);
          }
        } else if (event.type === "fileRenamed") {
          relabelKnown(event.from, event.to);
        } else if (event.type === "docChanged") {
          /* A `docChanged` carries its file event's origin, and a write Studio made through plain
             `writeFile` reaches the host as `"external"`: the hash its file event matched is what
             marks the `docChanged` after it as Studio's own too. */
          const mine = own || ownHashes.get(event.path) === event.hash;
          ownHashes.delete(event.path);
          /* Each open tab of the path takes the new disk hash (`project-state.md` §6.1): one that
             already holds those bytes re-reads nothing, a clean one is re-read on another writer's
             change, and an edited one becomes conflicted. */
          const holds = noteDiskHash(workspace.tabs.values(), event.path, event.hash, {
            own: mine,
            rev: event.rev,
          });
          if (!mine && !holds) {
            ctx.onContentChange?.(event.path);
          }
          /* Another writer's change is news only when the bytes moved: a `docChanged` for bytes
             already accounted for is the host filling in what it learned (§4.3). */
          if (!mine && moved(event.path, event.hash)) {
            reportForeignChange(event.path);
          }
          knownHashes.set(event.path, event.hash);
          touched.delete(event.path);
        } else if (event.type === "fileRemoved") {
          forgetKnown(event.path, event.isDir);
          if (!event.isDir) {
            noteDiskHash(workspace.tabs.values(), event.path, null, { own, rev: event.rev });
            if (!own) {
              reportForeignChange(event.path);
            }
          }
        }
      }
      const events = applied.map(({ event }) => event);
      if (resumed) {
        resumed = false;
        if (events.some((event) => "path" in event || event.type === "fileRenamed")) {
          ctx.noteRepositoryChange?.();
        }
      }
      const treeChanged = foldTree(storeTreeEvents(events));
      followGitignore(events.flatMap((event) => ("path" in event ? [event.path] : [])));
      derivations.events(applied);
      if (treeChanged) {
        ctx.renderLeftPanel();
      }
    },
    onLive: (live) => {
      // The store's hashes are versions only while the store follows the host.
      deriveVersionsFrom(live ? contentStore : null);
      if (live) {
        vouchForListings(true);
        resumed = wasLive;
        wasLive = true;
      } else if (wasLive) {
        /* The subscription dropped, and until it answers nothing says what changed: a version a
           listing vouched for may be answered from an immutable cache with bytes that are gone. */
        forgetAllVersions();
      }
    },
    onSnapshot: (paths) => {
      for (const path of paths) {
        const doc = contentStore.docAt(path);
        /* A directory has no bytes, and a file the host lists without a hash (a host below
           `indexed` after a restart, `project-state.md` §3.1) has bytes nobody has named yet: its
           `docChanged` names them, and holding the tab against "no bytes" would read as a removal. */
        if (doc?.isDir === true || (doc && doc.hash === undefined)) {
          continue;
        }
        const holds = noteDiskHash(workspace.tabs.values(), path, doc?.hash ?? null);
        if (doc && !holds) {
          ctx.onContentChange?.(path);
        }
        if (doc === undefined || moved(path, doc.hash)) {
          reportForeignChange(path);
        }
      }
    },
    onSnapshotApplied: (change) => {
      // A snapshot answers a new epoch or a gap: the revisions after it start a new count.
      forgetDiskRevisions();
      /* The snapshot is now the account of every path's bytes: a path it does not hold is
         forgotten, and one it names without a hash keeps the bytes known before. */
      for (const path of knownHashes.keys()) {
        if (contentStore.docAt(path) === undefined) {
          knownHashes.delete(path);
        }
      }
      touched.clear();
      for (const doc of contentStore.documents()) {
        if (!doc.isDir && doc.hash !== undefined) {
          knownHashes.set(doc.path, doc.hash);
        }
      }
      const treeChanged = foldTree(snapshotTreeEvents(change.added, change.removed));
      followGitignore([
        ...change.paths,
        ...change.added.map((entry) => entry.path),
        ...change.removed.map((entry) => entry.path),
      ]);
      derivations.snapshot(change);
      // A snapshot after a loss that replaced anything: git status is read again ({@link resumed}).
      if (
        resumed &&
        (change.paths.length > 0 || change.added.length > 0 || change.removed.length > 0)
      ) {
        ctx.noteRepositoryChange?.();
      }
      resumed = false;
      if (treeChanged) {
        ctx.renderLeftPanel();
      }
    },
  });
  /* No served subscription, no version a listing offers: nothing would say when it went stale. The
     first answer turns them back on (`onLive`). */
  const noteServed = () => {
    vouchForListings(subscription !== null && !subscription.unavailable);
  };
  let stopped = false;
  noteServed();
  void subscription?.settled().then(() => {
    if (!stopped) {
      noteServed();
    }
  });
  const stopSubscription = () => {
    stopped = true;
    stopProjectStateSync(subscription);
    stopVersions();
    vouchForListings(true);
  };
  if (!platform.subscribeFileEvents) {
    return stopSubscription;
  }
  let pending: FsEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The derived caches were dropped since the last flush, so the next one repaints. */
  let derivedDropped = false;

  const flush = () => {
    timer = null;
    const batch = pending;
    pending = [];
    const repaintDerived = derivedDropped;
    derivedDropped = false;
    if (!projectState) {
      return;
    }
    const changed = foldTree(batch);
    const structural = batch.some((ev) => ev.type !== "change");
    if (repaintDerived || structural || changed) {
      ctx.renderLeftPanel();
    }
  };

  const unsubscribe = platform.subscribeFileEvents((events) => {
    /* An empty batch is a platform saying the repository moved with no file event (a commit made
       elsewhere on a shared session): git status is all it can have changed. */
    if (events.length === 0) {
      ctx.noteRepositoryChange?.();
      return;
    }
    /* Without a served subscription, the watcher's batch is the only account of the file set: every
       cache keyed on "what files exist" is dropped here, in one place, because they answer one
       event, and Studio's own write changes what the project contains exactly as much as anyone
       else's. The content versions go with them (none is vouched for, but a version learned another
       way must not outlive a change). While the subscription is served none of it happens here:
       the store's events drop each cache on the change that makes it stale
       (`project-state/derive.ts`), replayed after a gap, and this batch is the tree's. Gated on
       the subscription being live, not merely served: before its first answer and while it is
       down after one, nothing else drops these caches, and the replay or snapshot that brings it
       back drops them again, which is harmless. */
    if (!projectStateLive()) {
      invalidateUsages();
      if (ctx.invalidateDerivedCaches) {
        ctx.invalidateDerivedCaches(
          events.map((event) => event.path),
          events.some((event) => event.type !== "change"),
        );
        derivedDropped = true;
      }
      forgetEventVersions(events);
    }
    /* Git status is derived from the tree too, and a self-write moves it like any other, since the
       host's `gitChanged` moves only with the summary, and a second edit to a file already modified
       leaves the summary alone while changing its comparison. */
    ctx.noteRepositoryChange?.();
    /* A `.gitignore` governs the whole tree beneath it. It never reaches a listing (a dotfile is in
       none), so no directory reads as changed and no repaint would follow: the rules are read
       again here, with an explicit repaint once they are back. */
    followGitignore(events.map((event) => event.path));
    pending.push(...events);
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(flush, 50);
  });
  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    stopSubscription();
    unsubscribe();
  };
}
