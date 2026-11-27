/**
 * The user-level JSON store primitive — one owner per file, one way to write one.
 *
 * Three stores live side by side in the app's config directory (`settings.json`,
 * `credentials.json`, `recent-projects.json`) and each had grown its own read/write pair. They
 * disagreed on the things that matter:
 *
 * - **Atomicity.** `settings-store.ts` and `recent-store.ts` called `writeFile` straight at the
 *   destination, which truncates first. An interrupted write — or one interleaved with another
 *   process's (a second Studio, a dev server writing the same store) — leaves torn JSON. Every
 *   reader here tolerates that by returning empty, so corruption presented to the user as
 *   _everything lost_ rather than as an error.
 * - **Permissions.** `writeFile`'s `mode` applies only when it CREATES the file.
 *   `credential-store.ts` knew this and chmod'd afterwards; the other two did not, so a store that
 *   arrived world-readable stayed that way — and `migrateLegacyStore`'s `copyFile` carries the
 *   legacy file's mode across, which is exactly how one arrives.
 * - **Concurrency.** `writeCredential` is a read-modify-write with an `await` in the middle and no
 *   lock, so two of them racing lose one edit.
 *
 * So: write to a sibling temp file, `chmod` the fresh inode, `rename` into place (atomic within a
 * directory), and serialize everything touching one path behind a per-path promise chain.
 *
 * Two layers keep writers apart. A promise chain orders this process's own writers (first in, first
 * out, never contending with themselves), and an exclusive lockfile `<store>.lock` beside the store
 * excludes every other process (a development checkout running beside an installed application,
 * against one configuration directory) for the length of the read and the write. The atomic rename
 * still keeps a reader from seeing a torn file.
 *
 * A lock whose holder's process is gone, or which is older than any write takes, is broken rather
 * than waited on; a writer that still cannot take the lock within the wait bound rejects with
 * {@link StoreLockTimeoutError} and never writes unlocked. Breaking and releasing share one
 * compare-and-remove (rename aside, compare, link back if it was someone else's). What remains is a
 * third writer creating the lock inside that restore window, which needs a dead or stalled holder
 * and two contenders within microseconds, and a holder that stalls past the stale bound and then
 * finishes its write.
 *
 * @docs studio/desktop
 */

import { chmod, link, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";
import { isProcessAlive } from "../process-liveness";
import type { RecentProjectEntry } from "../shared/rpc-schema";

/**
 * What a store file holds, written whole as JSON: a string map (settings, credentials) or the
 * recent-projects list.
 */
export type StoreDocument = Record<string, string> | readonly RecentProjectEntry[];

/** Distinguishes concurrent temp files from this process, as the pid distinguishes processes. */
let writeSeq = 0;

/** One promise chain per path, so two writers to one file never interleave. */
const chains = new Map<string, Promise<unknown>>();

/** How long a lock may stand before it is broken, and how long a waiter waits before giving up. */
export interface LockTiming {
  staleMs: number;
  waitMs: number;
}

const LOCK_TIMING: LockTiming = { staleMs: 10_000, waitMs: 15_000 };

/** A write could not take the store's lockfile within the wait bound, so it did not happen. */
export class StoreLockTimeoutError extends Error {
  readonly file: string;
  readonly holder: number | null;

  constructor(file: string, holder: number | null) {
    super(
      `${basename(file)} is held by another Jx Studio window${
        holder === null ? "" : ` (pid ${holder})`
      }; the change was not saved.`,
    );
    this.name = "StoreLockTimeoutError";
    this.file = file;
    this.holder = holder;
  }
}

interface Holder {
  raw: string;
  pid: number | null;
  ageMs: number;
}

/** Read a lockfile's content and age; `null` when it cannot be read. */
async function readHolder(lock: string): Promise<Holder | null> {
  try {
    const [raw, info] = await Promise.all([readFile(lock, "utf8"), stat(lock)]);
    const parsed = Math.trunc(Number(raw.split(" ")[0]));
    return {
      ageMs: Date.now() - info.mtimeMs,
      pid: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null,
      raw,
    };
  } catch {
    return null;
  }
}

/**
 * Remove `lock` only when it still holds `expected`: rename it aside (the one atomic take a
 * filesystem offers), compare, and link it back when it is someone else's. Never throws.
 *
 * @returns `true` when the path is free afterwards.
 */
async function removeLockIfHeldBy(lock: string, expected: string): Promise<boolean> {
  writeSeq += 1;
  const aside = `${lock}.${process.pid}.${writeSeq}.stale`;
  try {
    await rename(lock, aside);
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
  let mine = false;
  try {
    mine = (await readFile(aside, "utf8")) === expected;
  } catch {
    // Unreadable: treat as someone else's and restore it.
  }
  if (!mine) {
    try {
      await link(aside, lock);
    } catch {
      // EEXIST: a third writer took the lock inside the restore window (see the header).
    }
  }
  try {
    await rm(aside, { force: true });
  } catch {
    // A leftover aside name is harmless.
  }
  return mine;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Run `work` holding the exclusive lockfile `<file>.lock`, across processes.
 *
 * @throws {StoreLockTimeoutError} When the lock stays held past `timing.waitMs`.
 */
export async function withFileLock<T>(
  file: string,
  work: () => Promise<T>,
  timing: LockTiming = LOCK_TIMING,
): Promise<T> {
  await mkdir(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const token = `${process.pid} ${crypto.randomUUID()}`;
  const deadline = Date.now() + timing.waitMs;
  for (;;) {
    try {
      await writeFile(lock, token, { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }
    const holder = await readHolder(lock);
    const abandoned =
      holder !== null &&
      (holder.ageMs > timing.staleMs || (holder.pid !== null && !isProcessAlive(holder.pid)));
    if (abandoned && (await removeLockIfHeldBy(lock, holder.raw))) {
      continue;
    }
    if (Date.now() >= deadline) {
      throw new StoreLockTimeoutError(file, holder?.pid ?? null);
    }
    await sleep(5 + Math.random() * 20);
  }
  try {
    return await work();
  } finally {
    await removeLockIfHeldBy(lock, token);
  }
}

/**
 * Run `work` with exclusive access to `file`: first in this process's chain, then across processes
 * by lockfile.
 *
 * Failures do not poison the chain: the link is always resolved by the time the next one starts, so
 * one rejected write cannot strand every write behind it.
 */
function withStoreLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  const locked = () => withFileLock(file, work);
  const previous = chains.get(file) ?? Promise.resolve();
  const next = previous.then(locked, locked);
  chains.set(
    file,
    next.catch(() => {}),
  );
  return next;
}

/**
 * Read a `Record<string, string>` store, tolerating a missing or corrupt file.
 *
 * Non-string values are dropped rather than coerced, so the result always satisfies the contract
 * its callers publish.
 */
export async function readStringStore(file: string): Promise<Record<string, string>> {
  try {
    // SAFETY: JSON.parse with no reviver yields only JSON values; the shape is checked below.
    const parsed = JSON.parse(await readFile(file, "utf8")) as JsonValue;
    if (!isJsonObject(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isString(value)) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Read any JSON store, tolerating a missing or corrupt file.
 *
 * @param file Absolute path.
 * @param fallback Returned when the file is absent, unreadable, or fails `accept`.
 * @param accept Narrows the parsed value; anything it rejects yields `fallback`.
 */
export async function readJsonStore<T>(
  file: string,
  fallback: T,
  accept: (value: unknown) => value is T,
): Promise<T> {
  try {
    // SAFETY: JSON.parse with no reviver yields only JSON values, and `accept` decides the shape.
    const parsed = JSON.parse(await readFile(file, "utf8")) as JsonValue;
    return accept(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Write `value` to `file` atomically and owner-only.
 *
 * Not exported for direct use by a store that also reads — see {@link updateStore}, which holds the
 * lock across both halves.
 */
async function writeAtomically(file: string, value: StoreDocument): Promise<void> {
  writeSeq += 1;
  const temp = `${file}.${process.pid}.${writeSeq}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") {
    await chmod(temp, 0o600);
  }
  await rename(temp, file);
}

/** Replace a store's contents wholesale, atomically. */
export function writeStore(file: string, value: StoreDocument): Promise<void> {
  return withStoreLock(file, () => writeAtomically(file, value));
}

/**
 * Read a store, transform it, and write the result back — with the lock held across BOTH halves.
 *
 * This is what makes a per-key edit safe. The read-modify-write it replaces released between the
 * read and the write, so two concurrent edits each read the same base and the second overwrote the
 * first's key.
 *
 * @returns Whatever `mutate` produced, i.e. the store as it now stands on disk.
 */
export function updateStore<T extends StoreDocument>(
  file: string,
  read: (file: string) => Promise<T>,
  mutate: (current: T) => T,
): Promise<T> {
  return withStoreLock(file, async () => {
    const next = mutate(await read(file));
    await writeAtomically(file, next);
    return next;
  });
}
