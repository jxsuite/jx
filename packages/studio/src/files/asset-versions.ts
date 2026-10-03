/**
 * Asset versions — which project files the backend vouches for, and by what opaque version.
 *
 * A listing entry may carry `version` (protocol `DirEntry.version`): an opaque token for the file's
 * bytes, equal tokens meaning identical bytes, ABSENT whenever the backend cannot vouch (an
 * uncommitted, dirty or just-uploaded file). The cloud session sets it to the row's git blob sha.
 * Studio appends it to a project-file URL as `?v=<version>` (`withVersion` in
 * `canvas/asset-resolve.ts`), and a host that recognizes the version may answer that URL with an
 * immutable cache lifetime — which is what lets a page full of images repaint from the browser
 * cache instead of revalidating every one (specs/studio.md §3.4).
 *
 * That cache is only safe while the version is TRUE. A stale version names bytes the file no longer
 * has, and an immutable response for it is never re-asked. So this map is built defensively:
 *
 * - **Listings feed it** ({@link beginListing} / {@link noteListing}). Every file entry of a listing
 *   either sets its version or, when the entry has none, deletes it — a listing that says nothing
 *   about a version is the backend withdrawing it.
 * - **Change forgets** ({@link forgetVersions}). The file-event subscription forgets every path an
 *   event names, before the echo filter (Studio's own writes change bytes too), and
 *   `markLocalMutation` forgets the paths Studio is about to write.
 * - **A listing never outlives a forget.** Nothing orders an HTTP response against the event socket,
 *   so a listing requested BEFORE a write can be answered AFTER the forget for it, carrying the old
 *   version. Each listing records the sequence number current when it began, every forget bumps the
 *   sequence and stamps the paths (and directory prefixes) it dirtied, and {@link noteListing}
 *   ignores any path dirtied after its listing began. The next listing, begun after the forget,
 *   decides.
 *
 * The canvas iframe receives {@link assetVersionsSnapshot} as one `assetVersions` message whenever
 * {@link assetVersionsEpoch} moves, rather than a copy on every render. The snapshot holds MEDIA
 * paths only — a `.json` or `.md` file is never loaded by URL from the canvas, and leaving them out
 * keeps that message as small as the media set.
 *
 * Pure module state — it imports nothing but path normalization and the reactivity re-export — so
 * the canvas host can import it without dragging in the file layer.
 *
 * @docs extending/embedding/platform-adapter
 */

import { normalizeProjectPath } from "@jxsuite/schema/asset-paths";
import { shallowRef } from "../reactivity";
import type { DirEntry } from "../types";

/**
 * Extensions whose versions the canvas snapshot carries: images (svg included), fonts, video and
 * audio — what a rendered document loads by URL. Documents and data (`.json`, `.md`, `.csv`) are
 * deliberately absent.
 */
const MEDIA_EXTENSIONS = new Set([
  // Images
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
  // Fonts
  ".eot",
  ".otf",
  ".ttf",
  ".woff",
  ".woff2",
  // Video
  ".m4v",
  ".mov",
  ".mp4",
  ".ogv",
  ".webm",
  // Audio
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
]);

/** Whether a project path is media the canvas loads by URL. */
export function isVersionedMediaPath(path: string): boolean {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash + 1 && MEDIA_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/** Every version a listing has vouched for, keyed by normalized project path. */
const versions = new Map<string, string>();
/** Monotonic; bumped by every forget, read by every listing as it begins. */
let seq = 0;
/** Listings begun before this sequence number belong to a previous project and are ignored. */
let floor = 0;
/** The sequence number at which each path was last forgotten. */
const dirtiedPaths = new Map<string, number>();
/** The sequence number at which each directory prefix (`dir/`) was last forgotten. */
const dirtiedPrefixes = new Map<string, number>();
/** The memoized canvas snapshot, or null once a media version changed under it. */
let snapshot: Readonly<Record<string, string>> | null = null;
/**
 * The one snapshot of a map with no media in it. Shared, so emptying an already-empty map keeps the
 * snapshot's identity and the canvas host — which compares identities — posts nothing: a host that
 * never versions anything (desktop, `jx dev`) never pays a message for it.
 */
const EMPTY_SNAPSHOT: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Bumped whenever the MEDIA versions change — the canvas host watches it to know when to repost
 * {@link assetVersionsSnapshot}. A change to a non-media version does not move it: nothing the
 * canvas holds would differ.
 */
export const assetVersionsEpoch = shallowRef(0);

function mediaChanged(): void {
  snapshot = null;
  assetVersionsEpoch.value += 1;
}

/**
 * Begin a listing, returning the sequence number to pass to {@link noteListing} with its answer.
 * Call it BEFORE the request goes out.
 */
export function beginListing(): number {
  return seq;
}

/** Whether `path` was forgotten after sequence number `since`. */
function dirtiedSince(path: string, since: number): boolean {
  const own = dirtiedPaths.get(path);
  if (own !== undefined && own > since) {
    return true;
  }
  for (const [prefix, at] of dirtiedPrefixes) {
    if (at > since && path.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Record what one listing said about its files' versions.
 *
 * A file entry WITH a version sets it; one without deletes any version held, since the backend no
 * longer vouches for those bytes. Directories are ignored. A path forgotten after `since` (the
 * value {@link beginListing} returned when this listing began) is skipped entirely: the listing may
 * predate the change that forgot it.
 */
export function noteListing(entries: readonly DirEntry[], since: number): void {
  if (since < floor) {
    return;
  }
  let changed = false;
  for (const entry of entries) {
    if (entry.type !== "file") {
      continue;
    }
    const path = normalizeProjectPath(entry.path);
    if (path === "" || dirtiedSince(path, since)) {
      continue;
    }
    const version =
      typeof entry.version === "string" && entry.version !== "" ? entry.version : null;
    const held = versions.get(path);
    if (version === null) {
      if (held === undefined) {
        continue;
      }
      versions.delete(path);
    } else if (held === version) {
      continue;
    } else {
      versions.set(path, version);
    }
    if (isVersionedMediaPath(path)) {
      changed = true;
    }
  }
  if (changed) {
    mediaChanged();
  }
}

/**
 * List through `read` with the listing's versions noted — {@link beginListing} before the request,
 * {@link noteListing} with its answer. Resolves (or rejects) with exactly what `read` did.
 */
export async function notedListing<T extends readonly DirEntry[]>(
  read: () => Promise<T>,
): Promise<T> {
  const since = beginListing();
  const entries = await read();
  noteListing(entries, since);
  return entries;
}

/**
 * Forget the versions of `paths`, and of every file under each of `prefixDirs`, and make sure no
 * listing that began before this call can restore them.
 */
export function forgetVersions(paths: readonly string[], prefixDirs: readonly string[] = []): void {
  seq += 1;
  let changed = false;
  for (const raw of paths) {
    const path = normalizeProjectPath(raw);
    if (path === "") {
      continue;
    }
    dirtiedPaths.set(path, seq);
    if (versions.delete(path) && isVersionedMediaPath(path)) {
      changed = true;
    }
  }
  for (const raw of prefixDirs) {
    const dir = normalizeProjectPath(raw);
    if (dir === "") {
      continue;
    }
    const prefix = `${dir}/`;
    dirtiedPrefixes.set(prefix, seq);
    for (const path of versions.keys()) {
      if (path.startsWith(prefix)) {
        versions.delete(path);
        if (isVersionedMediaPath(path)) {
          changed = true;
        }
      }
    }
  }
  if (changed) {
    mediaChanged();
  }
}

/** The version a listing vouched for `path`, or undefined when none is held. */
export function versionOf(path: string): string | undefined {
  return versions.get(normalizeProjectPath(path));
}

/**
 * Every media path's version as a plain record, for the canvas iframe. Memoized: the same object is
 * returned until a media version changes, so identity is a cheap "did anything move" test.
 */
export function assetVersionsSnapshot(): Readonly<Record<string, string>> {
  if (snapshot) {
    return snapshot;
  }
  const out: Record<string, string> = {};
  let any = false;
  for (const [path, version] of versions) {
    if (isVersionedMediaPath(path)) {
      out[path] = version;
      any = true;
    }
  }
  snapshot = any ? Object.freeze(out) : EMPTY_SNAPSHOT;
  return snapshot;
}

/**
 * Forget EVERY version, and ignore every listing begun before this call when it lands.
 *
 * For a gap in the event stream: a reconnect, or the stream's first open after listings were
 * already noted (§9.2). The events that would have forgotten individual paths are gone, and the
 * versions at risk are not only the file tree's — the Library walk, the media picker and media
 * metadata note directories the tree never loaded, and a re-list of the tree cannot reach them. A
 * version Studio can no longer vouch for has to go, because an immutable response for it is never
 * re-asked. Listings begun after this call vouch afresh.
 *
 * Raising the floor, rather than stamping paths, is what covers a listing that was in flight across
 * the gap: it has no forget recorded against it, and would otherwise put the old version back.
 */
export function forgetAllVersions(): void {
  const hadMedia = assetVersionsSnapshot() !== EMPTY_SNAPSHOT;
  versions.clear();
  // Every record is older than the new floor, and every listing it could have guarded is below it.
  dirtiedPaths.clear();
  dirtiedPrefixes.clear();
  seq += 1;
  floor = seq;
  if (hadMedia) {
    mediaChanged();
  }
}

/**
 * Drop every version and dirt record — a project switch, and between tests. A listing begun before
 * the reset is ignored when it lands: it lists the project that was closed.
 */
export function resetAssetVersions(): void {
  forgetAllVersions();
}
