/**
 * Buffer.ts — each open tab's unsaved buffer, held against the bytes it was read from
 * (`project-state.md` §6.1).
 *
 * A tab carries a `BufferState` (`tab.doc.buffer`): `bufferRev` moves on every edit and `savedRev`
 * names the revision that matches `baseHash`, the hash of the bytes Studio last read or wrote,
 * while `diskHash` is what the host last reported at the path. Its status (`clean`, `dirty`,
 * `conflicted`) is derived by the protocol's `bufferStatus`, never stored, and `tab.doc.dirty` is
 * that derivation's first half (`tabs/tab.ts`).
 *
 * This module keeps the parts of the state a tab cannot hold by itself:
 *
 * - **Which tabs know their base.** A tab whose bytes Studio never hashed (a document created in
 *   memory, a format file opened by a path this module never saw) has no base to compare, so it is
 *   never reported conflicted: it is `dirty` or `clean` by its revisions alone, and a save takes
 *   the host's hash at the path as its base.
 * - **The newest read's hash, still being computed.** A read notes its bytes at once and hashes them
 *   asynchronously; a save awaits that hash before it names a base ({@link bufferBase}).
 * - **The host revision the base was taken at**, so an event older than a save's own reply does not
 *   put an earlier hash back ({@link noteDiskHash}).
 *
 * **A co-edited tab reads the room's state instead** (§6.1): the room holds the document's one
 * buffer, so while a session is attached the tab is `conflicted` exactly when the room's last save
 * was refused (`collabState(tab).conflicted`, set from the provider's `doc-conflict`), and `dirty`
 * or `clean` as the room reports.
 *
 * Reads and Studio's own writes fill the content store with the bytes they hashed
 * (`project-state.md` §11.1), keyed by the document at the path and that hash.
 *
 * @license MIT
 * @docs extending/embedding/platform-adapter
 */

import { bufferStatus, contentHash } from "@jxsuite/protocol/project-state";
import type { BufferStatus, ContentHash } from "@jxsuite/protocol/project-state";
import { toRaw } from "../reactivity";
import { collabState } from "../collab/collab-state";
import { getPlatform, hasPlatform } from "../platform";
import { clearProblems, notify } from "../services/notify";
import type { Tab } from "../tabs/tab";
import { contentStore } from "./store";

/** Tabs whose `baseHash` is the hash of bytes Studio read or wrote. */
const known = new WeakSet<Tab>();
/** The newest read's hashing, per tab, and the sequence number that names it. */
const reads = new WeakMap<Tab, { seq: number; done: Promise<void> }>();
/**
 * The host revision each tab's `diskHash` was last taken at, and the {@link revisionEra} it was
 * taken in. A revision is comparable only with one from the same host epoch (§3.1), and a host that
 * restarts numbers its events from 1 again.
 */
const diskRevs = new WeakMap<Tab, { era: number; rev: number }>();
/** Moved by every snapshot the subscription applies: revisions taken before it are not comparable. */
let revisionEra = 0;

/** The revision `tab`'s disk hash was taken at in the current era, `-1` when none was. */
function diskRevOf(key: Tab): number {
  const taken = diskRevs.get(key);
  return taken?.era === revisionEra ? taken.rev : -1;
}

/**
 * Forget every tab's disk revision: the subscription applied a snapshot, which a new epoch (a host
 * restart) or a gap answers, and the revisions that follow it are not comparable with those
 * before.
 */
export function forgetDiskRevisions(): void {
  revisionEra += 1;
}

/**
 * Whether this window's platform has a project state client (`studio.md` §3.4). Without one no tab
 * has a base to hold: nothing is hashed, and nothing is put in the content store.
 */
function tracksBuffers(): boolean {
  return hasPlatform() && getPlatform().subscribeProjectState !== undefined;
}

/** The key every map here uses: the raw tab, whichever proxy reached it. */
const keyOf = (tab: Tab): Tab => toRaw(tab);

/** The last path segment, for a sentence. */
const nameOf = (path: string): string => path.split("/").pop() ?? path;

/** The deduplication key of a path's conflict problem. */
export function conflictProblemKey(path: string): string {
  return `buffer.conflict:${path}`;
}

/** Take a path's conflict problem down: the tab it was about is no longer conflicted. */
function clearConflictProblem(path: string | null | undefined): void {
  if (path) {
    const key = conflictProblemKey(path);
    clearProblems((record) => record.key === key);
  }
}

/** Say that a tab's unsaved edits now stand against bytes it was not read from. */
function reportConflict(path: string): void {
  notify.warn(`${nameOf(path)} changed on disk while it had unsaved edits.`, {
    detail:
      "Save it to choose whether to keep your edits, take the copy on disk, or compare the copy on disk with the last commit.",
    key: conflictProblemKey(path),
    path,
    source: "Save",
    tier: "problem",
  });
}

/**
 * Note that `tab` now holds `contents`, just read from disk: its base becomes their hash once it is
 * computed, and the content store holds them at `path` under that hash. A later read or save
 * supersedes a read whose hash is still being computed. Resolves once the base is noted, and never
 * rejects: bytes that cannot be hashed (no `crypto.subtle` outside a secure context) leave the tab
 * without a known base, which is how a tab Studio never hashed behaves. A platform with no project
 * state client notes nothing.
 */
export function noteBufferRead(
  tab: Tab,
  contents: string,
  path: string | null = null,
): Promise<void> {
  if (!tracksBuffers()) {
    return Promise.resolve();
  }
  const key = keyOf(tab);
  const seq = (reads.get(key)?.seq ?? 0) + 1;
  const done = contentHash(contents).then(
    (hash) => {
      if (reads.get(key)?.seq !== seq) {
        return;
      }
      tab.doc.buffer.baseHash = hash;
      tab.doc.buffer.diskHash = hash;
      known.add(key);
      if (path) {
        contentStore.put(path, hash, contents);
        clearConflictProblem(path);
      }
    },
    () => {
      // Unhashable: the tab keeps no base of its own, and a save takes the host's.
      if (reads.get(key)?.seq === seq) {
        known.delete(key);
      }
    },
  );
  reads.set(key, { done, seq });
  return done;
}

/**
 * Note a save that reached disk: `hash` is what the host now holds, `bufferRev` the buffer revision
 * the saved bytes were serialized from, and `rev` the host revision the reply named. An edit made
 * while the write was in flight keeps the tab dirty against the new base.
 */
export function noteBufferSaved(
  tab: Tab,
  path: string,
  saved: { hash: ContentHash; bufferRev: number; rev: number; contents: string },
): void {
  const key = keyOf(tab);
  // A read still being hashed names older bytes than these.
  reads.set(key, { done: Promise.resolve(), seq: (reads.get(key)?.seq ?? 0) + 1 });
  const { buffer } = tab.doc;
  buffer.baseHash = saved.hash;
  buffer.diskHash = saved.hash;
  if (saved.bufferRev === buffer.bufferRev) {
    // Through `dirty`, whose readers are told only when it flips (`tabs/tab.ts`).
    tab.doc.dirty = false;
  } else {
    // An edit made while the write was in flight: still dirty, now against the saved bytes.
    buffer.savedRev = saved.bufferRev;
  }
  known.add(key);
  diskRevs.set(key, { era: revisionEra, rev: Math.max(saved.rev, diskRevOf(key)) });
  contentStore.put(path, saved.hash, saved.contents);
  clearConflictProblem(path);
}

/**
 * Note that a write or delete of `tab`'s file was refused: `diskHash` is what is there now. The
 * buffer is conflicted from here until the author chooses (§6.1).
 */
export function noteBufferRefused(tab: Tab, diskHash: ContentHash | null): void {
  known.add(keyOf(tab));
  tab.doc.buffer.diskHash = diskHash;
}

/**
 * The base a save of `tab` names: the hash of the bytes it was read from or last saved as, once a
 * read in flight has been hashed. A tab whose bytes Studio never hashed takes the host's hash at
 * the path, and `null`, asserting the file does not exist, where the host has none.
 */
export async function bufferBase(tab: Tab, path: string): Promise<ContentHash | null> {
  const key = keyOf(tab);
  await reads.get(key)?.done;
  if (known.has(key)) {
    return tab.doc.buffer.baseHash;
  }
  return contentStore.hashAt(path) ?? null;
}

/**
 * The tab's buffer status (§6.1). A co-edited tab answers with its room's: `conflicted` while the
 * room's last save stands refused. A tab with no known base is never conflicted.
 */
export function tabBufferStatus(tab: Tab): BufferStatus {
  const room = collabState(tab);
  if (room.active) {
    if (room.conflicted) {
      return "conflicted";
    }
    return tab.doc.dirty ? "dirty" : "clean";
  }
  if (!known.has(keyOf(tab))) {
    return tab.doc.dirty ? "dirty" : "clean";
  }
  return bufferStatus(tab.doc.buffer);
}

/**
 * The host reported `hash` at `path` (`null`: nothing is there now) at revision `rev`, or with no
 * revision for a snapshot's state. Every open tab of the path takes it as its `diskHash`, unless
 * its base was taken at a later revision; an edited tab whose base it no longer matches becomes
 * conflicted, and the author is told once. `own` marks Studio's own write, which never conflicts
 * with the tab that made it.
 *
 * @returns Whether some open tab already holds those bytes, so there is nothing to re-read.
 */
export function noteDiskHash(
  tabs: Iterable<Tab>,
  path: string,
  hash: ContentHash | null,
  options: { rev?: number; own?: boolean } = {},
): boolean {
  let holds = false;
  for (const tab of tabs) {
    if (tab.documentPath !== path || collabState(tab).active) {
      continue;
    }
    const key = keyOf(tab);
    if (options.rev !== undefined) {
      if (options.rev <= diskRevOf(key)) {
        holds = true;
        continue;
      }
      diskRevs.set(key, { era: revisionEra, rev: options.rev });
    }
    const before = tabBufferStatus(tab);
    tab.doc.buffer.diskHash = hash;
    if (!known.has(key)) {
      continue;
    }
    if (tab.doc.buffer.baseHash === hash) {
      holds = true;
    }
    const after = tabBufferStatus(tab);
    if (before !== "conflicted" && !options.own && after === "conflicted") {
      reportConflict(path);
    } else if (before === "conflicted" && after !== "conflicted") {
      // The disk went back to the tab's base: there is no conflict left to report.
      clearConflictProblem(path);
    }
  }
  return holds;
}

/**
 * Note that `tab` closed: a conflict it was reported for goes with it, since there are no unsaved
 * edits left to stand against the disk.
 */
export function noteBufferClosed(tab: Tab): void {
  clearConflictProblem(tab.documentPath);
}

/**
 * Record a co-edited tab's room conflict: the room's save was refused, or its file changed under
 * its unsaved edits (`doc-conflict`, with `diskHash` naming what is there now), or it saved and the
 * conflict no longer stands. The author is told once, and the notice is taken down with it.
 */
export function noteRoomConflict(
  tab: Tab,
  conflicted: boolean,
  diskHash: ContentHash | null = null,
): void {
  const room = collabState(tab);
  if (conflicted) {
    // The newest refusal names what is on disk now, whether or not the room was conflicted already.
    room.conflictDiskHash = diskHash;
  }
  if (room.conflicted === conflicted) {
    return;
  }
  room.conflicted = conflicted;
  const path = tab.documentPath;
  if (!path) {
    return;
  }
  if (!conflicted) {
    clearConflictProblem(path);
    return;
  }
  notify.warn(`${nameOf(path)} changed on disk while the shared session had unsaved edits.`, {
    detail:
      "The session's edits are still unsaved. Save it to choose whether to keep the session's edits, take the copy on disk, or compare the copy on disk with the session's version.",
    key: conflictProblemKey(path),
    path,
    source: "Collaboration",
    tier: "problem",
  });
}
