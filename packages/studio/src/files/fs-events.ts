/// <reference lib="dom" />
/**
 * Fs-events.ts — reconcile backend filesystem events into the cached sidebar tree.
 *
 * `applyFsEvents` is a pure, in-place reducer over `projectState.dirs`/`expanded` (unit-testable
 * without a DOM). `startFsSync` is the only impure part: it feature-detects the platform's
 * `subscribeFileEvents`, debounces bursts, drops the echoes of the user's own local mutations, and
 * triggers a single re-render through the existing left-panel render path (no imperative DOM).
 *
 * It also answers the transport's `onResync`, which is the platform admitting that its event stream
 * has a gap (a reconnect, or the stream's first open after listings were made) or never carried the
 * change (a commit). Events are deltas; a gap in deltas cannot be patched by more deltas, so a
 * resync re-reads what this window has cached.
 */

import { getPlatform } from "../platform";
import { reloadIgnoreCache, touchesGitignore } from "./gitignore";
import { invalidateUsages } from "../services/references";
import { forgetAllVersions, forgetVersions, notedListing } from "./asset-versions";
import { isCollabPath } from "../collab/collab-state";
import { projectState } from "../store";
import { workspace } from "../workspace/workspace";
import type { DirEntry, FsEvent, FsResyncReason, StudioPlatform } from "../types";

const RECENT_MS = 1500;
/**
 * How wide each resync reason's pass is: a coalesced burst runs the widest one it saw. A reconnect
 * re-derives everything; an open forgets the content versions and re-lists; a commit re-lists.
 */
const RESYNC_RANK: Record<FsResyncReason, number> = { commit: 0, open: 1, reconnect: 2 };
/**
 * How long a resync request waits for company. A flapping network reconnects several times in a
 * second, and a commit notice can arrive on the heels of a reconnect; each resync re-lists every
 * loaded directory, so a burst is coalesced into one pass.
 */
const RESYNC_DEBOUNCE_MS = 250;
/** Listings in flight at once during a resync — a deep expanded tree is many round trips. */
const RELIST_CONCURRENCY = 8;
const recentLocal = new Map<string, number>();

const norm = (p: string) => p.replaceAll("\\", "/");

/**
 * Mark paths the user just mutated locally so the watcher's echo of them is ignored briefly.
 *
 * Their content versions are forgotten too, each path as a file AND as a directory (a rename or a
 * delete may name either): the bytes are about to change, and a version that outlived them would
 * let an immutable cache serve the old ones.
 */
export function markLocalMutation(...paths: string[]): void {
  forgetVersions(paths, paths);
  const expiry = Date.now() + RECENT_MS;
  for (const p of paths) {
    if (p) {
      recentLocal.set(norm(p), expiry);
    }
  }
}

/** True while a path is within the recent-local-mutation window (self-cleans on expiry). */
export function isRecentLocal(path: string): boolean {
  const key = norm(path);
  const expiry = recentLocal.get(key);
  if (expiry === undefined) {
    return false;
  }
  if (Date.now() > expiry) {
    recentLocal.delete(key);
    return false;
  }
  return true;
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

/** Whether a cached listing still holds exactly the entries a snapshot of it took. */
function sameEntries(current: DirEntry[] | undefined, snapshot: DirEntry[]): boolean {
  return (
    current !== undefined &&
    current.length === snapshot.length &&
    current.every((entry, index) => entry === snapshot[index])
  );
}

/** Reads of one directory a resync makes before it lets newer changes have the last word. */
const RELIST_ATTEMPTS = 2;

/**
 * Re-list every directory `dirs` has cached and replace its entries in place.
 *
 * Only directories already in the cache are read: the tree's lazy loading is the authority on what
 * is worth fetching, and a resync that grew the cache would turn one reconnect into a crawl of the
 * project. A directory whose listing FAILS is dropped rather than kept — after a gap in the event
 * stream, "this directory vanished" is the likeliest reason, and a stale listing of a directory
 * that no longer exists is the very thing a resync exists to remove. Expanding it again re-reads
 * it.
 *
 * Live events keep landing while the listings are in flight, and Studio's own create / rename /
 * delete re-load their parent, so a listing can come back OLDER than the cache it would replace:
 * nothing orders an HTTP response against a message on the event socket. Each directory is
 * therefore snapshotted before its read and the listing applied only if the cache still matches the
 * snapshot. A directory that moved is read again — that read starts after the change, so it
 * includes it — and if it moves again under the second read the cache keeps what the newer changes
 * made of it. Identity alone could not tell: `applyFsEvents` edits a listing in place. For the same
 * reason a directory that left the cache mid-read (an `unlinkDir`) stays gone: the event is newer
 * than the read.
 */
export async function relistLoadedDirs(
  dirs: Map<string, DirEntry[]>,
  listDirectory: StudioPlatform["listDirectory"],
): Promise<void> {
  const keys = [...dirs.keys()];
  let next = 0;
  const relist = async (dir: string) => {
    for (let attempt = 0; attempt < RELIST_ATTEMPTS; attempt += 1) {
      const before = dirs.get(dir);
      if (!before) {
        return;
      }
      const snapshot = [...before];
      let entries: DirEntry[] | null;
      try {
        entries = await listDirectory(dir);
      } catch {
        entries = null;
      }
      if (!dirs.has(dir)) {
        return;
      }
      if (!sameEntries(dirs.get(dir), snapshot)) {
        continue;
      }
      if (entries) {
        dirs.set(dir, entries);
      } else {
        dirs.delete(dir);
      }
      return;
    }
  };
  const worker = async () => {
    while (next < keys.length) {
      const dir = keys[next]!;
      next += 1;
      await relist(dir);
    }
  };
  await Promise.all(Array.from({ length: Math.min(RELIST_CONCURRENCY, keys.length) }, worker));
}

/**
 * Modes only a tab whose `document` is a placeholder offers: the media viewer, a CSV grid, the
 * Library. Spelled out as strings, not imported, because each constant's module drags its whole
 * editor in behind it.
 */
const STUB_DOCUMENT_MODES = new Set(["media", "grid", "manage"]);

/**
 * Whether a tab's `document` is a placeholder rather than its parsed file. Such a tab reads its
 * file through its own channel, if at all, so a re-read through `readFile` has nothing to refresh —
 * and is worse than waste: the cloud session's `/file` route refuses a binary file (415), and the
 * failed reload would raise "could not reload" for a file that never changed. A git comparison stub
 * is recognised by offering `git-diff` and NOTHING else, since every document tab offers it too.
 */
function holdsPlaceholder(modes: string[]): boolean {
  return (
    modes.some((mode) => STUB_DOCUMENT_MODES.has(mode)) ||
    (modes.length > 0 && modes.every((mode) => mode === "git-diff"))
  );
}

/**
 * The open tabs a reconnect may refresh from disk: clean ones holding a parsed document, and none
 * that are co-edited.
 *
 * A dirty tab holds the author's unsaved work, which a reload would discard. A co-edited one never
 * reloads from disk at all — its shared document is ahead of whatever the provider wrote back (the
 * same rule `reloadCleanTab` applies to a single event). A stub tab has no parsed document to
 * refresh ({@link holdsPlaceholder}).
 */
export function cleanOpenTabPaths(): string[] {
  const paths = new Set<string>();
  for (const tab of workspace.tabs.values()) {
    const path = tab.documentPath;
    if (
      path &&
      !tab.doc.dirty &&
      !isCollabPath(path) &&
      !holdsPlaceholder(tab.capabilities.modes)
    ) {
      paths.add(path);
    }
  }
  return [...paths];
}

export interface FsSyncContext {
  renderLeftPanel: () => void;
  /** Optional hook for an external content change to an open file (e.g. reload a clean tab). */
  onContentChange?: (path: string) => void;
  /**
   * Drop every cache keyed on "what files the project contains".
   *
   * Passed in rather than imported, for the reason `renderLeftPanel` is: the caches live in panels,
   * and this module is imported BY the file layer those panels sit on top of — reaching up would be
   * a cycle. The bootstrap owns the list because the bootstrap is where the panels are already in
   * scope.
   */
  invalidateDerivedCaches?: () => void;
  /**
   * After a reconnect, the clean, non-collab open tabs whose files may have changed while the
   * stream was down. The handler re-reads them; it should leave a tab whose content did not change
   * alone, since a reconnect usually changed nothing and a reload churns undo and repaints.
   */
  onResyncContent?: (paths: string[]) => void;
}

/**
 * Subscribe the sidebar to backend filesystem events. Returns an unsubscribe function; a no-op when
 * the platform has no watcher (desktop without one, or tests). Bursts are debounced into one
 * render.
 */
export function startFsSync(ctx: FsSyncContext): () => void {
  const platform = getPlatform();
  if (!platform.subscribeFileEvents) {
    return () => {};
  }
  let pending: FsEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resyncReason: FsResyncReason | null = null;
  let resyncTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const state = projectState;
    const batch = pending.filter((e) => !isRecentLocal(e.path));
    pending = [];
    if (!state || batch.length === 0) {
      return;
    }
    const changedDirs = applyFsEvents(state.dirs, state.expanded, batch);
    if (ctx.onContentChange) {
      for (const ev of batch) {
        if (ev.type === "change") {
          ctx.onContentChange(ev.path);
        }
      }
    }
    if (changedDirs.size > 0) {
      ctx.renderLeftPanel();
    }
  };

  /*
   * A reconnect lost an unknown set of events, so it re-derives everything the events would have
   * kept current: the caches keyed on which files exist (dropped, exactly as one event drops them),
   * the `.gitignore` rules, every cached listing, and the open documents. A commit lost nothing —
   * the DO simply sends no per-file events for one — so it re-reads the listings alone. An open is
   * the stream going live after the first listings were already made; it re-reads them too, since
   * a change broadcast before the socket joined reached nobody. (Each gap's content versions were
   * already forgotten when it was reported — see `requestResync`.)
   */
  const resync = async () => {
    resyncTimer = null;
    const reason = resyncReason;
    resyncReason = null;
    const state = projectState;
    if (!state || !reason) {
      return;
    }
    /* Noted, so a commit — which makes dirty files clean — hands their versions back, and a gap's
       re-list vouches again for the tree's share of what it forgot. */
    const relist = relistLoadedDirs(state.dirs, (dir) =>
      notedListing(() => platform.listDirectory(dir)),
    );
    if (reason === "reconnect") {
      invalidateUsages();
      ctx.invalidateDerivedCaches?.();
      await Promise.all([relist, reloadIgnoreCache()]);
    } else {
      await relist;
    }
    // The project changed under the listings: they belong to a tree nobody is drawing any more.
    if (projectState !== state) {
      return;
    }
    if (reason === "reconnect") {
      ctx.onResyncContent?.(cleanOpenTabPaths());
    }
    ctx.renderLeftPanel();
  };

  const requestResync = (reason: FsResyncReason) => {
    /* A gap in the stream — a reconnect, or the first open — forgets EVERY content version, at once
       rather than after the debounce: the events that would have forgotten single paths are gone,
       and many versions were learned outside the tree (the Library walk, the media picker, media
       metadata), where no re-list of the loaded directories reaches. A version Studio can no longer
       vouch for may be answered from an immutable cache with the old bytes, so it cannot wait. The
       floor this raises also discards any listing still in flight across the gap. The re-list
       below, and every later listing, vouch afresh. A commit loses no events, so it keeps them. */
    if (reason !== "commit") {
      forgetAllVersions();
    }
    // A wider pass includes a narrower one's, so the widest reason wins a coalesced burst.
    if (!resyncReason || RESYNC_RANK[reason] > RESYNC_RANK[resyncReason]) {
      resyncReason = reason;
    }
    if (resyncTimer) {
      clearTimeout(resyncTimer);
    }
    resyncTimer = setTimeout(() => {
      void resync();
    }, RESYNC_DEBOUNCE_MS);
  };

  const unsubscribe = platform.subscribeFileEvents(
    (events) => {
      // Before the echo filter, deliberately. `isRecentLocal` drops the events Studio caused, which
      // Is right for the tree (it already repainted) and wrong for a DERIVED cache — Studio's own
      // Write changes what the project contains exactly as much as anyone else's does.
      //
      // Every cache keyed on "what files exist" is dropped here, in one place, because they answer
      // One event. Each one had an invalidator and no caller, and each stale answer is visible: the
      // Link-target picker offering a route whose page was deleted, the layout picker attributing a
      // Removed layout's `$head` to the open page, a `$paths` enumeration listing entries that are
      // Gone.
      invalidateUsages();
      ctx.invalidateDerivedCaches?.();
      // Content versions are derived state of the same kind, and Studio's own writes change bytes:
      // A version kept past its echo would let an immutable cache answer with the old file.
      forgetEventVersions(events);
      /* A `.gitignore` governs the whole tree beneath it, so it is handled HERE rather than in the
         batch below: the echo filter drops the events Studio caused, and an author who just edited
         their own `.gitignore` in Studio is precisely the one waiting to see the tree change. It also
         never reaches `applyFsEvents` — a dotfile is in no listing, so no directory reads as changed
         and no repaint would follow. Hence the explicit one, once the rules are back. */
      if (touchesGitignore(events.map((event) => event.path))) {
        void reloadIgnoreCache().then(() => ctx.renderLeftPanel());
      }
      pending.push(...events);
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(flush, 50);
    },
    { onResync: requestResync },
  );
  return () => {
    if (resyncTimer) {
      clearTimeout(resyncTimer);
      resyncTimer = null;
    }
    unsubscribe();
  };
}
