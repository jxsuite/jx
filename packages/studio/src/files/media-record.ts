/**
 * A media file's own record (its alt text and tags), read from and written into the file.
 *
 * The record lives in the file's XMP packet (`@jxsuite/site/xmp-packet`,
 * `@jxsuite/site/xmp-containers`), so this module is a cache in front of the file, never a store of
 * its own: it reads a file's bytes once, answers from memory until the file changes, and writes by
 * rewriting the file's bytes at the same path (studio.md §22.6).
 *
 * **A cached answer is tied to the bytes it was read from.** Each entry keeps a stamp of the file
 * as the listing last described it: the content version a host vouches for (`asset-versions.ts`),
 * else its modified time and size (`media-meta.ts`). An entry whose file now has a different stamp
 * is read again; an entry Studio just wrote has no stamp yet and adopts the first one the next
 * listing reports, so a save does not cost a second read of the file it wrote.
 *
 * Four states, each a different sentence on screen:
 *
 * - `unsupported`: the format has no place for the fields (`xmpFormatOf`), or the host cannot read a
 *   file's bytes. Nothing is drawn as editable, and the Missing alt text filter does not count it.
 * - `pending`: not read yet.
 * - `ready`: the record.
 * - `failed`: the file could not be read, or its packet does not parse. It is never written over.
 *
 * @docs studio/projects/media
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { getPlatform, hasPlatform } from "../platform";
import { normalizeProjectPath } from "./media-paths";
import { peekMediaMeta } from "./media-meta";
import { forgetVersions, noteLocalWrite, versionOf } from "./asset-versions";
import { markLocalMutation } from "./fs-events";
import {
  cleanTags,
  readMediaRecord,
  sameMediaRecord,
  writeMediaRecord,
} from "@jxsuite/site/xmp-packet";
import { embedXmp, extractXmp, xmpFormatOf } from "@jxsuite/site/xmp-containers";
import type { FocalPoint, MediaRecord } from "@jxsuite/site/xmp-packet";
import type { XmpFormat } from "@jxsuite/site/xmp-containers";

export type { FocalPoint, MediaRecord } from "@jxsuite/site/xmp-packet";
export { sameMediaRecord } from "@jxsuite/site/xmp-packet";

export type MediaRecordState =
  | { status: "unsupported" }
  | { status: "pending" }
  | { status: "ready"; record: MediaRecord }
  | { status: "failed"; error: string };

interface Entry {
  state: MediaRecordState;
  /** The file's stamp when it was read; `null` right after Studio wrote it. */
  stamp: string | null;
}

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<MediaRecordState>>();
const listeners = new Set<() => void>();
/** Bumped by {@link resetMediaRecords}, so a read that began before a reset cannot land after. */
let epoch = 0;

const UNSUPPORTED: MediaRecordState = { status: "unsupported" };
const PENDING: MediaRecordState = { status: "pending" };

/** The host's byte reader, without which no record can be read or written. */
function byteReader(): ((path: string) => Promise<ArrayBuffer>) | undefined {
  return hasPlatform() ? getPlatform().readFileBytes : undefined;
}

/** Whether the host can read a file's bytes, without which no record can be read or written. */
export function mediaRecordsSupported(): boolean {
  return byteReader() !== undefined;
}

/** Whether a file can hold a record at all, on this host. */
export function canHoldMediaRecord(path: string): boolean {
  return holderOf(path) !== null;
}

/** The listing's description of the file's bytes, or `null` when it has none yet. */
function stampOf(path: string): string | null {
  const version = versionOf(path);
  if (version !== undefined) {
    return `v:${version}`;
  }
  const meta = peekMediaMeta(path);
  return meta === null || (meta.modified === null && meta.bytes === null)
    ? null
    : `m:${meta.modified ?? ""}|${meta.bytes ?? ""}`;
}

/** The entry for `key` while it still describes the file's bytes, else `undefined`. */
function freshEntry(key: string): Entry | undefined {
  const entry = entries.get(key);
  if (entry === undefined) {
    return undefined;
  }
  const now = stampOf(key);
  if (entry.stamp === null) {
    entry.stamp = now;
    return entry;
  }
  return now === null || now === entry.stamp ? entry : undefined;
}

/** Hear when any record changes: a read landing, a save, a reset. */
export function onMediaRecordsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function announce(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** What is known about a file's record right now, WITHOUT starting a read. */
export function peekMediaRecord(path: string): MediaRecordState {
  if (!canHoldMediaRecord(path)) {
    return UNSUPPORTED;
  }
  return freshEntry(normalizeProjectPath(path))?.state ?? PENDING;
}

/** What a file needs to hold a record: a format with a place for one, and a way to read it. */
interface Holder {
  format: XmpFormat;
  read: (path: string) => Promise<ArrayBuffer>;
}

function holderOf(path: string): Holder | null {
  const format = xmpFormatOf(path);
  const read = byteReader();
  return format === null || read === undefined ? null : { format, read };
}

/** Read the record from bytes already in hand. */
function recordFrom(format: XmpFormat, bytes: Uint8Array): MediaRecord {
  return readMediaRecord(extractXmp(bytes, format));
}

/** Read a file's record, or join the read in flight. Never rejects. */
export function loadMediaRecord(path: string): Promise<MediaRecordState> {
  const holder = holderOf(path);
  if (holder === null) {
    return Promise.resolve(UNSUPPORTED);
  }
  const key = normalizeProjectPath(path);
  const fresh = freshEntry(key);
  if (fresh !== undefined) {
    return Promise.resolve(fresh.state);
  }
  const running = inFlight.get(key);
  if (running !== undefined) {
    return running;
  }
  const started = epoch;
  const stamp = stampOf(key);
  const pending = (async (): Promise<MediaRecordState> => {
    let state: MediaRecordState;
    try {
      const bytes = new Uint8Array(await holder.read(key));
      state = { record: recordFrom(holder.format, bytes), status: "ready" };
    } catch (error) {
      state = { error: errorMessage(error), status: "failed" };
    }
    inFlight.delete(key);
    if (started === epoch) {
      entries.set(key, { stamp, state });
      announce();
    }
    return state;
  })();
  inFlight.set(key, pending);
  return pending;
}

/**
 * `bytes` with their record set to `record`, everything else in their metadata kept. Throws when
 * the format has no place for it or the existing metadata cannot be read.
 */
export function withMediaRecord(
  path: string,
  bytes: Uint8Array,
  record: MediaRecord,
): Uint8Array<ArrayBuffer> {
  const format = xmpFormatOf(path);
  if (format === null) {
    throw new Error("This format cannot hold alt text or tags.");
  }
  return embedXmp(bytes, format, writeMediaRecord(extractXmp(bytes, format), record));
}

/**
 * Write `record` into the file at `path`. Reads the file's bytes again first, so a change another
 * program made since the last read is kept rather than overwritten from a stale copy.
 *
 * The bytes at the path changed, so the caller announces it (`announceMediaChanged` with the path
 * as overwritten) once this succeeds: that module depends on this one, not the other way round.
 *
 * @returns `null` on success, else the reason, which the caller reports.
 */
export async function saveMediaRecord(path: string, record: MediaRecord): Promise<string | null> {
  const holder = holderOf(path);
  if (holder === null) {
    return "This file's format cannot hold alt text or tags.";
  }
  const key = normalizeProjectPath(path);
  const next: MediaRecord = {
    alt: record.alt.trim(),
    focus: record.focus,
    tags: cleanTags(record.tags),
  };
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const current = new Uint8Array(await holder.read(key));
    if (sameMediaRecord(recordFrom(holder.format, current), next)) {
      entries.set(key, { stamp: stampOf(key), state: { record: next, status: "ready" } });
      announce();
      return null;
    }
    bytes = withMediaRecord(key, current, next);
  } catch (error) {
    return errorMessage(error);
  }
  /* Studio's own write, marked before it happens (§3.4), exactly as a Replace is: the watcher's echo
     is absorbed, and the path's content version is forgotten while the bytes are still the old. */
  markLocalMutation(key);
  try {
    const { path: written } = await getPlatform().uploadFile(key, bytes.buffer);
    forgetVersions([key, written]);
    if (written !== key) {
      return `The backend stored the file as ${written} instead of rewriting it.`;
    }
  } catch (error) {
    return errorMessage(error);
  }
  noteLocalWrite(key);
  entries.set(key, { stamp: null, state: { record: next, status: "ready" } });
  announce();
  return null;
}

/** `next` with `old`'s fields filling the ones it lacks, or `next` itself when none need filling. */
function mergeInto(
  format: XmpFormat,
  next: Uint8Array<ArrayBuffer>,
  old: MediaRecord,
): Uint8Array<ArrayBuffer> {
  if (old.alt === "" && old.tags.length === 0 && old.focus === null) {
    return next;
  }
  try {
    const own = recordFrom(format, next);
    const merged: MediaRecord = {
      alt: own.alt === "" ? old.alt : own.alt,
      focus: own.focus ?? old.focus,
      tags: own.tags.length === 0 ? old.tags : own.tags,
    };
    return sameMediaRecord(own, merged)
      ? next
      : embedXmp(next, format, writeMediaRecord(extractXmp(next, format), merged));
  } catch {
    // New bytes whose metadata cannot be read are written as they are: they are what was chosen.
    return next;
  }
}

/**
 * The record an overwrite should keep: the new bytes' own fields where they have them, the old
 * file's where they do not. A Replace or an Image editor save writes new bytes over a file whose
 * alt text and tags describe the same picture; dropping them because a canvas re-encode carries no
 * metadata would empty the file's description by accident.
 *
 * This form reads the old record through the cache (one read of the file at most). A caller that
 * already holds the bytes being replaced uses {@link carryRecordBetween} and reads nothing.
 *
 * @returns The bytes to write: `next` itself when nothing needs carrying or the format cannot.
 */
export async function carryMediaRecord(
  path: string,
  next: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const holder = holderOf(path);
  if (holder === null) {
    return next;
  }
  const old = await loadMediaRecord(path);
  return old.status === "ready" ? mergeInto(holder.format, next, old.record) : next;
}

/**
 * {@link carryMediaRecord} from bytes in hand: `previous` is what the file held, `next` what will
 * replace it. Pure, so the Image editor can keep the bytes it writes as its next source.
 *
 * `moveFocus` says where the old focal point lands in the new picture, for an edit that moved the
 * pixels (a crop, a turn, a mirror): `null` drops it, because it was cropped away.
 */
export function carryRecordBetween(
  path: string,
  previous: Uint8Array,
  next: Uint8Array<ArrayBuffer>,
  moveFocus: (focus: FocalPoint) => FocalPoint | null = (focus) => focus,
): Uint8Array<ArrayBuffer> {
  const format = xmpFormatOf(path);
  if (format === null) {
    return next;
  }
  let old: MediaRecord;
  try {
    old = recordFrom(format, previous);
  } catch {
    return next;
  }
  return mergeInto(format, next, {
    ...old,
    focus: old.focus === null ? null : moveFocus(old.focus),
  });
}

/** Forget one file's record: it was deleted, or its bytes replaced. */
export function forgetMediaRecord(path: string): void {
  if (entries.delete(normalizeProjectPath(path))) {
    announce();
  }
}

/** Forget every record: the project closed. */
export function resetMediaRecords(): void {
  entries.clear();
  inFlight.clear();
  epoch += 1;
  announce();
}
