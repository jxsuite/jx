/// <reference lib="dom" />
/**
 * Media upload core — the single path every upload surface goes through.
 *
 * Four surfaces feed it: the image field's Upload button (ui/media-picker), a file dropped on the
 * canvas (editor/file-drop-action), a file dropped on the Files tree (files/files), and the Media
 * workspace's drop zone and Upload button (media/media-library, and Add new › Media). They differ
 * only in how the destination directory is chosen; naming, collision handling, the platform call,
 * and cache invalidation are shared here.
 *
 * Destination (specs/site-architecture.md §9.1/§9.4, studio.md §9.3): a document inside a content
 * collection keeps its media co-located in `content/<collection>/images/` — the entry references it
 * file-relatively and the collection loader rewrites it to the asset mount. Everything else goes to
 * {@link DEFAULT_MEDIA_DIR}, `public/media/`, which is served from the site root as `/media/`.
 *
 * {@link replaceAsset} is the one door that writes over an existing file, and it is asked for by
 * name: the Media workspace's **Replace** (studio.md §9.3).
 *
 * @docs studio/projects/media
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { getPlatform, hasPlatform } from "../platform";
import { notify } from "../services/notify";
import { invalidateUsages } from "../services/references";
import { activeTab } from "../workspace/workspace";
import { forgetVersions, notedListing } from "./asset-versions";
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MEDIA_EXTENSIONS,
  VIDEO_EXTENSIONS,
  extensionOf,
} from "./media-types";

// ─── File classification ─────────────────────────────────────────────────────

/* The classification lives in `media-types.ts`, which imports nothing; it is re-exported here so
   every existing caller of the upload core keeps one import. */
export { IMAGE_EXTENSIONS, MEDIA_EXTENSIONS, extensionOf, isImage } from "./media-types";

/** A byte count as a person reads it, for a refusal that names the limit. */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : Number(value.toFixed(1))} ${units[unit]}`;
}

/** What Studio itself offers, before any backend narrows it. */
const DEFAULT_ACCEPT = [
  "image/*",
  "video/*",
  "audio/*",
  ".pdf",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
].join(",");

/**
 * The `accept` attribute for every upload file input.
 *
 * A backend may NARROW it by declaring `assetCapabilities.accept`; nothing widens it, because the
 * picker offering a type Studio cannot place in a document helps no one. Read as a function, not a
 * constant, because the platform is registered after this module is imported.
 *
 * @returns {string} An `<input accept>` value
 */
export function uploadAccept(): string {
  const declared = hasPlatform() ? getPlatform().assetCapabilities?.accept : undefined;
  return declared ?? DEFAULT_ACCEPT;
}

/** What kind of element an uploaded asset wants to become. */
export type AssetKind = "image" | "video" | "audio" | "file";

/** One successfully uploaded file. */
export interface UploadedAsset {
  /** Project-relative path written, e.g. `public/hero.jpg`. */
  path: string;
  /** The filename actually used (may carry a collision suffix). */
  name: string;
  /** The reference to write into a document `src`/prop, e.g. `/hero.jpg`. */
  ref: string;
  kind: AssetKind;
}

/** Whether a filename is project media. */
export function isMediaFile(name: string): boolean {
  return MEDIA_EXTENSIONS.has(extensionOf(name));
}

/**
 * Classify a file by MIME type, falling back to its extension. A drop from the OS usually carries a
 * `type`, but it is empty for unrecognized extensions and for some Linux file managers.
 */
export function mediaKind(file: { name: string; type?: string }): AssetKind {
  const mime = file.type ?? "";
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (mime.startsWith("video/")) {
    return "video";
  }
  if (mime.startsWith("audio/")) {
    return "audio";
  }
  const ext = extensionOf(file.name);
  if (IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return "video";
  }
  if (AUDIO_EXTENSIONS.has(ext)) {
    return "audio";
  }
  return "file";
}

/** The font extensions, which a browser shows as a specimen rather than as a file. */
export const FONT_EXTENSIONS: ReadonlySet<string> = new Set([".woff", ".woff2", ".ttf", ".otf"]);

/**
 * What a media file IS, as the Media workspace's filters name it: one of five kinds.
 *
 * Distinct from {@link AssetKind}, which answers "what element does this become" and so has no word
 * for a font or a PDF (both become an `<a href>`). Decided by extension alone, because a file
 * already on disk carries no MIME type: a font first, then the three a browser has an element for,
 * and everything else (a PDF) is a document.
 */
export type MediaFileKind = "image" | "video" | "audio" | "font" | "document";

/** The {@link MediaFileKind} of a file, by its name. */
export function mediaFileKind(name: string): MediaFileKind {
  if (FONT_EXTENSIONS.has(extensionOf(name))) {
    return "font";
  }
  const kind = mediaKind({ name });
  return kind === "file" ? "document" : kind;
}

// ─── Destination resolution ──────────────────────────────────────────────────

/** Matches a path inside a content collection: `content/<collection>/…`. */
const CONTENT_ENTRY = /^content\/([^/]+)\//;

/**
 * Where media with no context lands: `public/media/`, referenced from the site root as `/media/…`.
 *
 * A default and not a rule (site-architecture.md §9.4): a file under any other `public/` path is
 * published and listed exactly the same. Its one definition, so the Media workspace, Add new ›
 * Media and the Library's All view cannot disagree about it.
 */
export const DEFAULT_MEDIA_DIR = "public/media";

/**
 * The directory an upload lands in when the caller doesn't name one. A document inside a content
 * collection gets `content/<collection>/images`; everything else gets {@link DEFAULT_MEDIA_DIR}.
 */
export function uploadDirFor(documentPath: string | null): string {
  const match = documentPath ? CONTENT_ENTRY.exec(documentPath.replaceAll("\\", "/")) : null;
  return match ? `content/${match[1]}/images` : DEFAULT_MEDIA_DIR;
}

/**
 * Whether `dir` is a folder {@link uploadDirFor} answers: `public/media`, or a collection's
 * `content/<collection>/images`. An upload creates these on its own, so they are the folders a
 * media delete takes away again once it has emptied them (`media/media-library.ts`).
 */
export function isUploadDestination(dir: string): boolean {
  const normalized = dir.replaceAll("\\", "/");
  return normalized === DEFAULT_MEDIA_DIR || /^content\/[^/]+\/images$/.test(normalized);
}

/**
 * The reference to write into a document for a file at `destPath`.
 *
 * `public/` is served from the site root, so its contents get a root-relative `/name`. A content
 * asset is referenced relative to the entry that owns it (`./images/name`) so the collection loader
 * rewrites it to the asset mount. Anything else is project-root relative (`./dir/name`), which is
 * how the compiler resolves a non-`/` path.
 */
export function assetRef(destPath: string): string {
  const path = destPath.replaceAll("\\", "/");
  if (path.startsWith("public/")) {
    return path.slice("public".length);
  }
  const content = /^content\/[^/]+\/(.+)$/.exec(path);
  if (content) {
    return `./${content[1]}`;
  }
  return `./${path}`;
}

/**
 * A filename that doesn't collide with `taken`, suffixing `-1`, `-2`, … before the extension. Never
 * overwrites existing media (the previous behaviour clobbered silently).
 */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) {
    return name;
  }
  const ext = extensionOf(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  for (let i = 1; ; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/** Join a directory and a filename, treating `.` (project root) as no prefix. */
export function joinDir(dir: string, name: string): string {
  const normalized = dir.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized === "." || normalized === "" ? name : `${normalized}/${name}`;
}

// ─── Cache invalidation (injected) ───────────────────────────────────────────

/**
 * Called after a batch of uploads with the directory they landed in. Injected from studio.ts so
 * this module doesn't import the media-picker / Manage / file-tree caches it needs to invalidate
 * (they all import from here) — the same injection pattern as the canvas host's drop handlers.
 */
let mediaChangedHandler: ((dir: string) => void | Promise<void>) | null = null;

/** Register the post-upload cache invalidator (see {@link mediaChangedHandler}). */
export function setMediaChangedHandler(fn: ((dir: string) => void | Promise<void>) | null): void {
  mediaChangedHandler = fn;
}

/**
 * Say that the media in `dir` changed by some door other than {@link uploadAssets} — a replace, or
 * the Media workspace's delete — so every cache keyed on the listing is dropped the same way.
 */
export async function announceMediaChanged(dir: string): Promise<void> {
  await mediaChangedHandler?.(dir);
}

/** The directory part of a project path, `.` for a file at the root. */
function parentDir(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  return slash > 0 ? normalized.slice(0, slash) : ".";
}

// ─── Upload ──────────────────────────────────────────────────────────────────

/**
 * What a media surface may upload: any file the media listing shows (`media`), or only pictures
 * (`image`, a picker for a field that holds one).
 *
 * A file input's `accept` narrows only the chooser; a drop carries whatever the OS hands over, and
 * `image/*` admits types (`.heic`, `.bmp`) no listing names. A surface that selects what it just
 * uploaded must not upload a file it will then fail to show.
 */
export type UploadOnly = "media" | "image";

/** The files `only` admits; the rest are named in one warning rather than written unseen. */
function keepListable(files: File[], only: UploadOnly): File[] {
  const admits = (file: File): boolean =>
    only === "image" ? IMAGE_EXTENSIONS.has(extensionOf(file.name)) : isMediaFile(file.name);
  const kept: File[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (admits(file)) {
      kept.push(file);
    } else {
      skipped.push(file.name);
    }
  }
  if (skipped.length > 0) {
    notify.warn(
      skipped.length === 1 ? `Skipped ${skipped[0]}` : `Skipped ${skipped.length} files`,
      {
        detail:
          only === "image"
            ? `Only images can be used here: ${skipped.join(", ")}.`
            : `Studio lists images, video, audio, PDFs and fonts as media, so ${skipped.join(", ")} would not appear in it.`,
        source: "Media",
      },
    );
  }
  return kept;
}

/**
 * Upload files into the project and report what landed.
 *
 * `opts.dir` names the destination explicitly (the file tree's target folder, the Manage view's
 * active category); without it the destination follows the active document via {@link uploadDirFor}.
 * Names are made collision-free against a single listing of the destination. A file that fails to
 * upload is reported and skipped — the rest of the batch still lands.
 */
export async function uploadAssets(
  files: Iterable<File>,
  opts: { dir?: string; only?: UploadOnly } = {},
): Promise<UploadedAsset[]> {
  const list = opts.only === undefined ? [...files] : keepListable([...files], opts.only);
  if (list.length === 0) {
    return [];
  }
  const platform = getPlatform();
  const dir = opts.dir ?? uploadDirFor(activeTab.value?.documentPath ?? null);

  let taken: Set<string>;
  try {
    // The upload directory is a media directory, so its listing vouches for versions as well.
    const existing = await notedListing(() => platform.listDirectory(dir));
    taken = new Set(existing.map((entry) => entry.name));
  } catch {
    taken = new Set(); // Directory doesn't exist yet — the backend mkdir -p's on write.
  }

  /* A DECLARED limit, or none. Studio must not invent one: a limit it made up is a file the user
     cannot upload for no reason anyone can name. A declared one is different — refusing here saves
     the round trip and lets the refusal say the number. */
  const maxBytes = hasPlatform() ? getPlatform().assetCapabilities?.maxUploadBytes : undefined;

  const uploaded: UploadedAsset[] = [];
  for (const file of list) {
    if (maxBytes !== undefined && file.size > maxBytes) {
      notify.error(`${file.name} is too large.`, {
        detail: `This backend accepts at most ${formatBytes(maxBytes)}; that file is ${formatBytes(file.size)}.`,
        source: "Media",
      });
      continue;
    }
    const name = uniqueName(file.name, taken);
    taken.add(name);
    const requested = joinDir(dir, name);
    try {
      /* The path the backend REPORTS, not the one asked for. A store that de-duplicates by content
         hash, appends a collision suffix, or normalizes a name writes somewhere else, and the
         reference that goes into the document has to name what is really there. */
      const { path } = await platform.uploadFile(requested, file);
      // New bytes at `path`: whatever version a listing held for it no longer names them.
      forgetVersions([path]);
      uploaded.push({ kind: mediaKind(file), name, path, ref: assetRef(path) });
    } catch (error) {
      notify.error(`Could not upload ${file.name}.`, {
        detail: errorMessage(error),
        path: requested,
        source: "Media",
      });
    }
  }

  if (uploaded.length > 0) {
    notify.success(
      uploaded.length === 1
        ? `Uploaded ${uploaded[0]!.name} to ${dir}/`
        : `Uploaded ${uploaded.length} files to ${dir}/`,
    );
    await mediaChangedHandler?.(dir);
  }
  return uploaded;
}

/** Extensions that name one format, so either may stand in for the other. */
const SAME_FORMAT: readonly ReadonlySet<string>[] = [
  new Set([".jpg", ".jpeg"]),
  new Set([".tif", ".tiff"]),
];

/** Every extension that names the same format as `ext` (itself included). */
function formatSiblings(ext: string): ReadonlySet<string> {
  return SAME_FORMAT.find((group) => group.has(ext)) ?? new Set([ext]);
}

/**
 * The `accept` for a Replace of the file at `path`: its own format, and only that.
 *
 * The path is what every document names, and the server answers it with the type its EXTENSION
 * implies, so bytes of another format under it are a broken picture on every page that uses it.
 */
export function replaceAccept(path: string): string {
  return [...formatSiblings(extensionOf(path))].join(",");
}

/** Whether `file` may replace the file at `path`: the same format, by extension. */
export function canReplaceWith(path: string, file: { name: string }): boolean {
  return formatSiblings(extensionOf(path)).has(extensionOf(file.name));
}

/**
 * Write `file`'s bytes over the existing media file at `path` — the Media workspace's **Replace**.
 *
 * The only overwrite in this module, and asked for by name (studio.md §9.3): every reference to
 * `path` keeps resolving and now shows the new bytes. Nothing about the path tells a cache that the
 * file changed, so this forgets the path's content version (§3.4) and announces the change, which
 * drops the media listing, its metadata and the usage answers derived from it.
 *
 * A backend that reports a DIFFERENT path did not replace anything: it wrote a second file beside
 * the first, and the references still name the old bytes. That is said rather than called success.
 *
 * @returns Whether the bytes now at `path` are the new ones.
 */
export async function replaceAsset(path: string, file: File): Promise<boolean> {
  const name = path.split("/").pop() ?? path;
  /* An `accept` narrows only the chooser (and a backend's own picker may ignore it), so the format is
     checked here too: same path, other format, is every reference broken at once. */
  if (!canReplaceWith(path, file)) {
    notify.error(`${file.name} cannot replace ${name}.`, {
      detail: `${name} is ${extensionOf(path) || "a file with no extension"} and ${file.name} is ${extensionOf(file.name) || "a file with no extension"}. Every page that uses ${name} would get bytes its address does not describe; choose a file of the same type, or upload it as a new file.`,
      path,
      source: "Media",
    });
    return false;
  }
  const maxBytes = hasPlatform() ? getPlatform().assetCapabilities?.maxUploadBytes : undefined;
  if (maxBytes !== undefined && file.size > maxBytes) {
    notify.error(`${file.name} is too large.`, {
      detail: `This backend accepts at most ${formatBytes(maxBytes)}; that file is ${formatBytes(file.size)}.`,
      source: "Media",
    });
    return false;
  }
  let written: string;
  try {
    ({ path: written } = await getPlatform().uploadFile(path, file));
  } catch (error) {
    notify.error(`Could not replace ${name}.`, {
      detail: errorMessage(error),
      path,
      source: "Media",
    });
    return false;
  }
  forgetVersions([path, written]);
  // The answers were about the old bytes' place in the project; the place is the same, but a stale
  // "Used on" is a list the reader acts on, so it is asked again rather than trusted.
  invalidateUsages();
  await announceMediaChanged(parentDir(path));
  if (written !== path) {
    notify.warn(`${name} was not replaced.`, {
      detail: `The backend stored the new file as ${written}, so every reference still shows the old one.`,
      path,
      source: "Media",
      // A Problem rather than a toast: two files now exist, and the reader has a decision to make.
      tier: "problem",
    });
    return false;
  }
  notify.success(`Replaced ${name}`);
  return true;
}
