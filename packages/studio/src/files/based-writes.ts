/**
 * Based-writes.ts — saves and deletes that name the bytes they replace (`project-state.md` §5,
 * §6.1).
 *
 * Once a platform's host has answered Studio's project state subscription, every save of a tab goes
 * through the platform's `writeProjectState` with the tab's base hash, and every delete through
 * `deleteProjectState` with the hash the host last reported (`studio.md` §3.4). A host that finds
 * other bytes at the path refuses and writes nothing (`412 Precondition Failed` over HTTP), and the
 * refusal comes back as a conflict rather than an error.
 *
 * **A refused save asks before anything is written.** The tab becomes conflicted and the author
 * chooses: Keep Mine writes the buffer again against what is on disk now, Take Disk Copy discards
 * the buffer and reads the file, and Compare (also what closing the question does) writes nothing
 * and opens a comparison of the copy on disk with the author's unsaved version (`studio.md` §21). A
 * tab that is already conflicted, because another writer changed its file under unsaved edits, asks
 * the same question before its save writes anything.
 *
 * **A co-edited tab asks the same question about its room** (§6.1): the room holds the document's
 * one buffer, and the dev server reports the file changing under its unsaved edits, or refusing its
 * save, as `doc-conflict`. Keep Mine saves the room against what is on disk now, Take Disk Copy
 * reverts the room for every participant, and Compare shows the room's bytes beside the disk's
 * ({@link saveCoEdited}).
 *
 * **Every other write names a base too** (§5: a client that subscribes sends one with every write
 * and delete). Studio writes files from many places that hold no buffer of their own: a new file, a
 * settings commit, a media upload, a grid's rows. {@link plainWriteRoute} takes each of those
 * `writeFile`, `uploadFile` and `deleteFile` calls (`platform.ts`'s `routePlainWrites`) and makes
 * it against the store's account of the path: the hash the host last reported, or that of Studio's
 * own write still on its way. A refusal of one of those rejects with {@link StaleWriteError}, and
 * the caller's error says so. A path the host does not index (one outside its scope) has no
 * account, so it is written against whatever the refusal says is there, as before.
 *
 * **A refused delete deletes nothing** and says why: the file changed after the author last saw it,
 * and the next delete names what is there now.
 *
 * Without a served subscription the callers write and delete exactly as they did
 * ({@link writesWithBase}), and on a platform with no project state client the route hands every
 * call straight to the adapter.
 *
 * @license MIT
 * @docs extending/embedding/platform-adapter
 */

import { contentHash } from "@jxsuite/protocol/project-state";
import { isString } from "@jxsuite/schema/guards";
import type { ContentHash, DeleteBase, WriteConflict } from "@jxsuite/protocol/project-state";
import { getPlatform } from "../platform";
import type { PlainWriteRoute } from "../platform";
import type { StudioPlatform } from "../types";
import type { Tab } from "../tabs/tab";
import { shell } from "../shell";
import { contentStore } from "../project-state/store";
import { projectStateServed, whenProjectStateSettled } from "../project-state/subscription";
import {
  bufferBase,
  noteBufferRefused,
  noteBufferSaved,
  tabBufferStatus,
} from "../project-state/buffer";
import { showConfirmDialog } from "../ui/layers";
import { activateTab } from "../workspace/workspace";
import { base64ToBytes } from "../utils/base64";
import { DISK_COMPARISON_STATUS } from "../panels/git-diff-open";
import { collabState } from "../collab/collab-state";
import { revertRoom, roomSource, saveRoom, savesThroughRoom } from "../collab/collab-session";
import { noteLocalWrite } from "./fs-events";

/** The last path segment, for a sentence. */
const nameOf = (path: string): string => path.split("/").pop() ?? path;

/**
 * How long a write waits for the host's first answer to the subscription before it is made as it
 * was without one: long enough for any host that answers, short enough that one that never does
 * cannot hold a save forever.
 */
export const SETTLE_TIMEOUT_MS = 5000;

/** A write or delete the host refused because the path holds other bytes than Studio last saw. */
export class StaleWriteError extends Error {
  readonly conflict: WriteConflict;

  constructor(message: string, conflict: WriteConflict) {
    super(message);
    this.name = "StaleWriteError";
    this.conflict = conflict;
  }
}

/** A write id unique to this window's writes (`project-state.md` §5). */
function newWriteId(): string {
  return `studio-${crypto.randomUUID()}`;
}

/** Whether saves go through `writeProjectState` with a base: the host has answered a subscribe. */
export function writesWithBase(
  platform: Pick<StudioPlatform, "writeProjectState"> = getPlatform(),
): boolean {
  return platform.writeProjectState !== undefined && projectStateServed();
}

/**
 * Whether `member` goes through the contract, once the subscription has said whether its host
 * serves it. A platform without the member never waits.
 */
async function servedFor(
  platform: Pick<StudioPlatform, "writeProjectState" | "deleteProjectState">,
  member: "writeProjectState" | "deleteProjectState",
): Promise<boolean> {
  if (platform[member] === undefined) {
    return false;
  }
  await whenProjectStateSettled(SETTLE_TIMEOUT_MS);
  return projectStateServed();
}

/**
 * Save `tab`'s serialized bytes to `path` against its base (§6.1). Resolves whether they reached
 * disk; a conflict the author resolves by taking the disk copy or comparing resolves `false`.
 * Callers check {@link writesWithBase} first.
 */
export async function saveWithBase(tab: Tab, path: string, output: string): Promise<boolean> {
  if (tabBufferStatus(tab) === "conflicted") {
    return resolveConflict(tab, path, output);
  }
  return writeAgainst(tab, path, output, await bufferBase(tab, path));
}

/** One write of `output` naming `baseHash`; a refusal asks the author. */
async function writeAgainst(
  tab: Tab,
  path: string,
  output: string,
  baseHash: ContentHash | null,
): Promise<boolean> {
  /* SAFETY: every caller is behind `writesWithBase`, which requires the member. */
  const write = getPlatform().writeProjectState!;
  const { bufferRev } = tab.doc.buffer;
  const writeId = newWriteId();
  // The echo carries this id; the bytes' hash also keys the caches filled before it arrives.
  contentStore.noteWriteId(writeId);
  noteLocalWrite(path, output);
  const result = await write({ baseHash, bufferRev, contents: output, path, writeId });
  if (result.ok) {
    noteBufferSaved(tab, path, { bufferRev, contents: output, hash: result.hash, rev: result.rev });
    return true;
  }
  // Nothing was written, so no echo of these bytes is coming.
  void contentStore.forgetOwnWrite(path, output);
  noteBufferRefused(tab, result.conflict.diskHash);
  return resolveConflict(tab, path, output);
}

/** What each of the conflict question's answers does for one buffer (§6.1). */
interface ConflictChoices {
  /** Keep Mine: write the buffer against what is on disk now; whether it reached disk. */
  keep: () => Promise<boolean>;
  /** Take Disk Copy: discard the buffer for the file. */
  take: () => Promise<void>;
  /** The bytes a save would write, for Compare. */
  output: () => Promise<string>;
}

/** Ask the author how a conflicted buffer is resolved, and do what they chose (§6.1). */
async function askConflict(tab: Tab, path: string, choices: ConflictChoices): Promise<boolean> {
  const name = nameOf(path);
  const answer = await showConfirmDialog(
    `${name} Changed on Disk`,
    `${name} was changed on disk after you started editing it. Keep your version to replace the copy on disk, take the disk copy to discard your edits, or compare the two first. Comparing saves nothing.`,
    { cancelLabel: "Compare", confirmLabel: "Keep Mine", secondaryLabel: "Take Disk Copy" },
  );
  if (answer === true) {
    return choices.keep();
  }
  if (answer === "secondary") {
    await choices.take();
    return false;
  }
  await compareWithDisk(tab, path, await choices.output());
  return false;
}

/** The conflict question for a tab's own buffer, whose bytes are `output`. */
function resolveConflict(tab: Tab, path: string, output: string): Promise<boolean> {
  return askConflict(tab, path, {
    keep: () => writeAgainst(tab, path, output, tab.doc.buffer.diskHash),
    output: () => Promise.resolve(output),
    take: async () => {
      // Lazily: `files.ts` reaches this module through `file-ops.ts`, and a static edge closes a cycle.
      const { reloadFileInTab } = await import("./files");
      await reloadFileInTab(path);
    },
  });
}

/**
 * Save the room a co-edited tab joins (§6.1): `true` once the room is on disk, `false` when the
 * author resolved a conflict by taking the disk copy or comparing, and `null` when the tab has no
 * room this client can save, so the caller saves it as a file. A room that is conflicted, because
 * its file changed under its unsaved edits or its last save was refused, asks before anything is
 * written, and so does a save the host refuses.
 */
export async function saveCoEdited(tab: Tab, path: string): Promise<boolean | null> {
  if (!savesThroughRoom(tab)) {
    return null;
  }
  if (tabBufferStatus(tab) !== "conflicted" && (await saveRoom(tab)) !== "refused") {
    return true;
  }
  return resolveRoomConflict(tab, path);
}

/** The conflict question for a co-edited tab, whose buffer is its room's. */
function resolveRoomConflict(tab: Tab, path: string): Promise<boolean> {
  return askConflict(tab, path, {
    keep: async () => {
      const saved = await saveRoom(tab, { baseHash: collabState(tab).conflictDiskHash });
      // Refused again: the file changed once more since the author was asked.
      return saved === "refused" ? resolveRoomConflict(tab, path) : saved !== null;
    },
    output: async () => (await roomSource(tab)) ?? "",
    take: async () => {
      await revertRoom(tab);
    },
  });
}

/**
 * Show the copy on disk beside the author's unsaved version: the tab's comparison (`studio.md`
 * §21), with the file as it is on disk now for its original and the bytes a save would write for
 * its current. The buffer is untouched, and saving again asks the same question. A file that is
 * gone from disk compares with nothing.
 */
async function compareWithDisk(tab: Tab, path: string, output: string): Promise<void> {
  let onDisk = "";
  try {
    onDisk = await getPlatform().readFile(path);
  } catch {
    // Removed on disk: the comparison's original is empty, as a new file's is.
  }
  shell.git.diffState = {
    currentContent: output,
    filePath: path,
    fileStatus: DISK_COMPARISON_STATUS,
    originalContent: onDisk,
  };
  tab.session.ui.canvasMode = "git-diff";
  activateTab(tab.id);
}

/**
 * The hash a write Studio holds no buffer for names as its base: Studio's newest write at the path
 * still on its way, other than `own` (the note this write's caller made of its own bytes), or the
 * hash the host last reported. `undefined` when the store has no account of the path: the host has
 * reported nothing there, or not hashed what it reported.
 */
function accountOf(path: string, own: ContentHash | undefined): ContentHash | undefined {
  return contentStore.pendingWriteAt(path, own) ?? contentStore.hashAt(path);
}

/** The hash of `contents`, or `undefined` where nothing can hash (an insecure context). */
async function hashOrNothing(contents: string | Uint8Array): Promise<ContentHash | undefined> {
  try {
    return await contentHash(contents);
  } catch {
    return undefined;
  }
}

/** Why a write or delete of `path` was not made, as the caller's error carries it. */
function refusal(path: string, verb: "written" | "deleted", conflict: WriteConflict) {
  return new StaleWriteError(
    `${nameOf(path)} changed on disk after Studio last read it, so it was not ${verb}. Look at it again, then try again.`,
    conflict,
  );
}

/**
 * Write `contents` to `path` against the store's account of it (§5). With no account the write
 * asserts the file does not exist, and a refusal that says it does is answered by writing against
 * what is there, as the write did before: Studio cannot have read bytes the host never reported.
 * Any other refusal rejects.
 */
async function writeOnAccount(
  platform: Pick<StudioPlatform, "writeProjectState">,
  path: string,
  contents: string | Uint8Array,
): Promise<{ hash: ContentHash }> {
  /* SAFETY: `servedFor` checked the member. */
  const write = platform.writeProjectState!;
  const own = await hashOrNothing(contents);
  // The account includes every event and every note begun before this write.
  await contentStore.settled();
  const account = accountOf(path, own);
  let baseHash = account ?? null;
  const writeId = newWriteId();
  contentStore.noteWriteId(writeId);
  noteLocalWrite(path, contents);
  for (let attempt = 0; ; attempt += 1) {
    const result = await write({ baseHash, contents, path, writeId });
    if (result.ok) {
      return { hash: result.hash };
    }
    const { conflict } = result;
    if (attempt === 0 && account === undefined && conflict.diskHash !== null) {
      baseHash = conflict.diskHash;
      continue;
    }
    await contentStore.forgetOwnWrite(path, contents);
    throw refusal(path, "written", conflict);
  }
}

/**
 * Delete `path` naming `base` (§5). Nothing indexed and nothing there: as a plain delete of a
 * missing path, a no-op. A base `known` from the store's account is final; one made without an
 * account is answered, when a file is there, by deleting against that file's hash, as the delete
 * did before. Any other refusal rejects, deleting nothing.
 */
async function deleteOnAccount(
  platform: Pick<StudioPlatform, "deleteProjectState">,
  path: string,
  base: DeleteBase,
  known: boolean,
): Promise<void> {
  /* SAFETY: every caller checked the member. */
  const remove = platform.deleteProjectState!;
  const writeId = newWriteId();
  contentStore.noteWriteId(writeId);
  let named = base;
  for (let attempt = 0; ; attempt += 1) {
    const result = await remove({ base: named, path, writeId });
    if (result.ok) {
      return;
    }
    const { conflict } = result;
    if (conflict.docId === null && conflict.diskHash === null) {
      return;
    }
    if (attempt === 0 && !known && conflict.diskHash !== null) {
      named = { hash: conflict.diskHash };
      continue;
    }
    throw refusal(path, "deleted", conflict);
  }
}

/** Bytes an upload names, as the contract takes them; a string is base64, as the RPC hosts read it. */
async function uploadBytes(data: string | File | Blob | ArrayBuffer): Promise<Uint8Array> {
  if (isString(data)) {
    return base64ToBytes(data);
  }
  return new Uint8Array(data instanceof ArrayBuffer ? data : await data.arrayBuffer());
}

/**
 * The route every `writeFile`, `uploadFile` and `deleteFile` Studio makes through `getPlatform()`
 * takes (`platform.ts`'s `routePlainWrites`): through the contract with the store's account as the
 * base once the host serves it (§5), and straight to the adapter otherwise. A plain delete names
 * only what a last-writer-wins delete removes: a file's hash, or a directory with nothing beneath
 * it.
 */
export const plainWriteRoute: PlainWriteRoute = {
  // A platform without the contract's member is handed the call at once, exactly as before.
  deleteFile(raw, path) {
    if (raw.deleteProjectState === undefined) {
      return raw.deleteFile(path);
    }
    return (async () => {
      if (!(await servedFor(raw, "deleteProjectState"))) {
        await raw.deleteFile(path);
        return;
      }
      await contentStore.settled();
      const doc = contentStore.docAt(path);
      if (doc?.isDir === false && doc.hash !== undefined) {
        await deleteOnAccount(raw, path, { hash: doc.hash }, true);
        return;
      }
      // A directory with nothing beneath it, or a path the store has no account of.
      await deleteOnAccount(raw, path, { files: {} }, doc?.isDir === true);
    })();
  },
  uploadFile(raw, path, data) {
    if (raw.writeProjectState === undefined) {
      return raw.uploadFile(path, data);
    }
    return (async () => {
      if (!(await servedFor(raw, "writeProjectState"))) {
        return raw.uploadFile(path, data);
      }
      const bytes = await uploadBytes(data);
      await writeOnAccount(raw, path, bytes);
      return { path, size: bytes.byteLength };
    })();
  },
  writeFile(raw, path, content) {
    if (raw.writeProjectState === undefined) {
      return raw.writeFile(path, content);
    }
    return (async () => {
      if (!(await servedFor(raw, "writeProjectState"))) {
        await raw.writeFile(path, content);
        return;
      }
      await writeOnAccount(raw, path, content);
    })();
  },
};

/**
 * The hash of the bytes at `path` as the platform reads them now, `null` when they cannot be read.
 * Raw bytes where the platform has them, since a binary file read as text is not its bytes.
 */
async function hashOnDisk(
  platform: Pick<StudioPlatform, "readFile" | "readFileBytes">,
  path: string,
): Promise<ContentHash | null> {
  try {
    const bytes =
      platform.readFileBytes === undefined
        ? await platform.readFile(path)
        : new Uint8Array(await platform.readFileBytes(path));
    return await contentHash(bytes);
  } catch {
    return null;
  }
}

/** How many unhashed files a delete reads at once to name them. */
const DELETE_BASE_READS = 8;

/**
 * What a delete of `path` names as its base, from the host's account; `null` when it has none.
 *
 * A host may list a file before it has hashed it (the cloud's, which hashes a committed file only
 * when it first reads it, §3.1). Such a file is read here and named by the hash of what is there,
 * so a directory holding one still names every file beneath it rather than falling back to a base
 * that names none. `null` when one of them cannot be read.
 */
async function deleteBase(
  platform: Pick<StudioPlatform, "readFile" | "readFileBytes">,
  path: string,
): Promise<DeleteBase | null> {
  const doc = contentStore.docAt(path);
  if (!doc) {
    return null;
  }
  if (!doc.isDir) {
    const hash = doc.hash ?? (await hashOnDisk(platform, path));
    return hash === null ? null : { hash };
  }
  const files: Record<string, ContentHash> = {};
  const unhashed: string[] = [];
  const prefix = `${path}/`;
  for (const entry of contentStore.documents()) {
    if (!entry.isDir && entry.path.startsWith(prefix)) {
      if (entry.hash === undefined) {
        unhashed.push(entry.path);
      } else {
        files[entry.path.slice(prefix.length)] = entry.hash;
      }
    }
  }
  const read = new Map<string, ContentHash | null>();
  const queue = [...unhashed];
  const reader = async (): Promise<void> => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const hash = await hashOnDisk(platform, next);
      read.set(next, hash);
      if (hash === null) {
        // One unreadable file decides the answer: read nothing more.
        queue.length = 0;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DELETE_BASE_READS, queue.length) }, reader));
  for (const [below, hash] of read) {
    if (hash === null) {
      return null;
    }
    files[below.slice(prefix.length)] = hash;
  }
  return { files };
}

/**
 * Delete `path` and everything beneath it, naming what is there as the host last reported it (§5),
 * or as read now for a file the host listed without a hash, or as {@link plainWriteRoute} deletes it
 * when the host has not answered a subscription or a file beneath it cannot be read. Rejects,
 * deleting nothing, when the path changed since: the caller's error says so.
 */
export async function deletePath(path: string): Promise<void> {
  const platform = getPlatform();
  if (!(await servedFor(platform, "deleteProjectState"))) {
    await platform.deleteFile(path);
    return;
  }
  // The host's latest account, including any event that arrived while the author confirmed.
  await contentStore.settled();
  const base = await deleteBase(platform, path);
  if (base === null) {
    await platform.deleteFile(path);
    return;
  }
  await deleteOnAccount(platform, path, base, true);
}
