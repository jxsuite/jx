/**
 * The Library's data model — what a project contains, and how a scan can fail.
 *
 * Two facts the Manage view it replaces could not state:
 *
 * 1. **A scan has failures.** `collectFiles` swallowed every `listDirectory` rejection in an empty
 *    catch block, so a project directory the platform could not read simply contributed nothing. A
 *    500 from the dev server and an empty `content/` produced the identical file list and the
 *    identical sentence — "No files found" — which is the lie §16 exists to end.
 *    {@link scanLibrary} returns {@link LibraryScan.failures} beside the files; the pane raises
 *    them as Problems with a Retry and refuses to call an incomplete listing empty.
 * 2. **A file is in one collection or in none.** The Library this model served filtered by FOLDER
 *    (Pages, Layouts, Components, Content, Media) and matched content with a third matcher of its
 *    own, which disagreed with the collection grid about the same entry. Every file now carries the
 *    key of the collection the Content workspace lists it under ({@link LibraryFile.collection}),
 *    from `content/content-collections.ts`, whose one matcher is `content/collection-match.ts`
 *    (studio.md §9.1.2).
 *
 * Everything here is pure over its inputs (the scan takes the platform as an argument) so the
 * 300-page acceptance case can be measured without a DOM.
 */

import { MEDIA_EXTENSIONS, extensionOf } from "../files/media-upload";
import { collectionKeyOfPath } from "../content/content-collections";
import { projectState } from "../store";
import { notedListing } from "../files/asset-versions";
import { errorMessage } from "@jxsuite/schema/parse";
import { resolveI18n, servedLocaleOfPath } from "@jxsuite/schema/locale";
import type { ResolvedI18n } from "@jxsuite/schema/locale";
import type { DirEntry, StudioPlatform } from "../types";

// ─── Files ───────────────────────────────────────────────────────────────────

/** One scanned file, whichever layout is drawing it. */
export interface LibraryFile {
  name: string;
  path: string;
  /** The extension, or `"file"` for a name without one. */
  type: string;
  /**
   * The key of the collection the file is in (`pages`, or a collection's name), or `null` for a
   * file in none: a template, a component, a media file, anything else.
   */
  collection: string | null;
  /** Whether the file is media by its extension — never an entry, whatever folder it is in. */
  media: boolean;
  ext: string;
  /** Bytes, when the platform reported them. */
  size?: number | undefined;
  /** ISO timestamp, when the platform reported one. Drives the Calendar layout. */
  modified?: string | undefined;
  /**
   * The locale this file is **served as**, from `@jxsuite/schema/locale`'s `servedLocaleOfPath` —
   * the canonical tag, never the spelling on disk.
   *
   * The path answers it wherever there is a locale directory. Where there is not, `routing` does:
   * under `prefix-except-default` an unprefixed page IS the default locale's copy, and a facet that
   * could filter to French and Arabic but never to English cannot answer the question it is most
   * often asked. That reading stops at `pages/` — an unlocalized collection expands under every
   * locale's route, so calling its entries the default language would be a claim about content that
   * is in none.
   */
  locale?: string | undefined;
}

/** A directory the scan could not read. Its presence means the listing is INCOMPLETE, not empty. */
export interface ScanFailure {
  dir: string;
  error: string;
}

/** The result of one pass over the project's directories. */
export interface LibraryScan {
  files: LibraryFile[];
  failures: ScanFailure[];
}

// ─── The scan ────────────────────────────────────────────────────────────────

/** Directory names never worth walking — a `node_modules` scan is minutes, not milliseconds. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".jx", "dist", "build", ".cache"]);

/**
 * Walk one directory tree, collecting files and recording — never swallowing — what it could not
 * read. A failure at depth is reported against the directory that failed, not the root, so the
 * Problem names the path the author can act on.
 */
async function walk(
  dir: string,
  platform: Pick<StudioPlatform, "listDirectory">,
  out: LibraryFile[],
  failures: ScanFailure[],
  i18n: ResolvedI18n | null,
): Promise<void> {
  let entries: DirEntry[];
  try {
    // Noted: the Library walks every media directory, so it is where most versions are learned.
    entries = await notedListing(() => platform.listDirectory(dir));
  } catch (error) {
    failures.push({ dir, error: errorMessage(error) });
    return;
  }
  const subdirectories: string[] = [];
  for (const entry of entries) {
    if (entry.type === "directory") {
      if (!SKIP_DIRS.has(entry.name)) {
        subdirectories.push(entry.path);
      }
      continue;
    }
    const ext = extensionOf(entry.name);
    out.push({
      collection: collectionKeyOfPath(entry.path),
      ext,
      locale: servedLocaleOfPath(entry.path, i18n) ?? undefined,
      media: MEDIA_EXTENSIONS.has(ext),
      modified: entry.modified,
      name: entry.name,
      path: entry.path,
      size: entry.size,
      type: ext || "file",
    });
  }
  // Siblings in parallel, depth serialized per branch: the platform counts every call as in-flight,
  // So `probe.idle()` already knows the scan is running without the Library declaring a source.
  await Promise.all(subdirectories.map((sub) => walk(sub, platform, out, failures, i18n)));
}

/**
 * Scan the project's declared directories.
 *
 * Never rejects: a scan that half-worked is a real, useful answer that the caller must be able to
 * render honestly, and an exception would throw the good half away with the bad.
 */
export async function scanLibrary(
  dirs: readonly string[],
  platform: Pick<StudioPlatform, "listDirectory">,
): Promise<LibraryScan> {
  const files: LibraryFile[] = [];
  const failures: ScanFailure[] = [];
  // Resolved ONCE for the whole walk. `resolveI18n` canonicalizes every declared tag through
  // `Intl.Locale`, and a project with 300 pages would otherwise pay for that per file.
  const { i18n } = resolveI18n(projectState?.projectConfig ?? {});
  await Promise.all(dirs.map((dir) => walk(dir, platform, files, failures, i18n)));
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { failures, files };
}

// ─── Filtering ───────────────────────────────────────────────────────────────

export interface LibraryFilter {
  /** The collection key to keep: `pages`, or a declared collection's name. */
  collection: string;
  query: string;
  /** A canonical tag, or "" for every language. Never a label — the labels are not unique. */
  locale?: string;
}

/** Collection, then text over name and path, then language. */
export function filterLibrary(
  files: readonly LibraryFile[],
  filter: LibraryFilter,
): readonly LibraryFile[] {
  let result = files.filter((f) => f.collection === filter.collection);
  const query = filter.query.trim().toLowerCase();
  if (query) {
    result = result.filter(
      (f) => f.name.toLowerCase().includes(query) || f.path.toLowerCase().includes(query),
    );
  }
  const locale = filter.locale?.trim();
  if (locale) {
    result = result.filter((f) => f.locale === locale);
  }
  return result;
}

// ─── Layouts ─────────────────────────────────────────────────────────────────

/** The Content home's four views (studio.md §22.5), in the order its view switch draws them. */
export const LIBRARY_LAYOUTS = ["table", "cards", "calendar", "board"] as const;

export type LibraryLayout = (typeof LIBRARY_LAYOUTS)[number];

export const LIBRARY_LAYOUT_LABELS: Readonly<Record<LibraryLayout, string>> = {
  board: "Board",
  calendar: "Calendar",
  cards: "Cards",
  table: "Table",
};

/** Whether a string names a layout — the guard behind `content.setLayout`'s argument. */
export function isLibraryLayout(value: string): value is LibraryLayout {
  return LIBRARY_LAYOUTS.some((layout) => layout === value);
}

/** Layouts that draw a live preview per item. Table, Calendar and Board draw text. */
export const PREVIEW_LAYOUTS: ReadonlySet<LibraryLayout> = new Set<LibraryLayout>(["cards"]);

// ─── Derived axes (Calendar and Board) ───────────────────────────────────────

/** `YYYY-MM-DD` at the head of a filename — the dated-post convention, used when there is no mtime. */
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

/**
 * The day a file belongs to, as `YYYY-MM-DD`, or null when nothing states one.
 *
 * The filename prefix wins over the filesystem's mtime: a dated post's date is authored content,
 * and mtime is a fact about the last save. A file with neither is not placed on the calendar at all
 * rather than being parked on today — the Calendar says how many it could not date.
 */
export function libraryDate(file: LibraryFile): string | null {
  const prefix = DATE_PREFIX.exec(file.name);
  if (prefix) {
    return prefix[1]!;
  }
  if (file.modified) {
    const parsed = new Date(file.modified);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return null;
}

/**
 * The locales this project DECLARES, canonical and in declaration order — the value space of the
 * Content home's language facet and of `content.setLocale`'s `enum`.
 *
 * Read at call time rather than cached: `projectState` is a plain binding replaced wholesale on a
 * project switch, so a cached list would describe the project before last.
 */
export function projectLocales(): readonly string[] {
  return resolveI18n(projectState?.projectConfig ?? {}).i18n?.locales ?? [];
}

/**
 * The locales actually PRESENT among these files, in the project's declaration order.
 *
 * Ordered by the project and not by the scan: a facet whose options reshuffle when a file is added
 * is a facet nobody can build muscle memory for. Declaration order also puts the default locale
 * first, because {@link resolveI18n} guarantees it is `locales[0]`.
 *
 * Only declared tags can appear — `localeOfPath` matches nothing else — so filtering the
 * declaration through the presence set loses no file.
 */
export function libraryLocales(files: readonly LibraryFile[]): string[] {
  const present = new Set<string>();
  for (const file of files) {
    if (file.locale) {
      present.add(file.locale);
    }
  }
  return projectLocales().filter((tag) => present.has(tag));
}

/** One Calendar day: the files whose derived date is `date`. */
export interface LibraryDay {
  date: string;
  files: LibraryFile[];
}

/** Calendar buckets, newest day first, plus the files no date could be derived for. */
export interface LibraryDateGroups {
  days: LibraryDay[];
  undated: LibraryFile[];
}

/** Calendar buckets, newest day first, plus the files no date could be derived for. */
export function groupByDate(
  files: readonly LibraryFile[],
  dateOf: (file: LibraryFile) => string | null = libraryDate,
): LibraryDateGroups {
  const byDay = new Map<string, LibraryFile[]>();
  const undated: LibraryFile[] = [];
  for (const file of files) {
    const date = dateOf(file);
    if (date === null) {
      undated.push(file);
      continue;
    }
    const bucket = byDay.get(date);
    if (bucket) {
      bucket.push(file);
    } else {
      byDay.set(date, [file]);
    }
  }
  const days = [...byDay.entries()]
    .map(([date, dayFiles]): LibraryDay => ({ date, files: dayFiles }))
    .toSorted((a, b) => b.date.localeCompare(a.date));
  return { days, undated };
}

/** The folder a file is in, project-relative: `pages/blog/a.md` → `pages/blog`. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "." : path.slice(0, slash);
}

/**
 * Board columns: one per folder the files are in, in path order.
 *
 * A collection is browsed one at a time, so a column per collection would be one column; the
 * folders inside it (`pages/` and `pages/blog/`, a dated archive's years) are the grouping a
 * collection already has on disk, and the one a Board can state without reading any file.
 */
export function groupByFolder(
  files: readonly LibraryFile[],
): { group: string; files: LibraryFile[] }[] {
  const byGroup = new Map<string, LibraryFile[]>();
  for (const file of files) {
    const folder = folderOf(file.path);
    const bucket = byGroup.get(folder);
    if (bucket) {
      bucket.push(file);
    } else {
      byGroup.set(folder, [file]);
    }
  }
  return [...byGroup.entries()]
    .map(([group, groupFiles]) => ({ files: groupFiles, group }))
    .toSorted((a, b) => a.group.localeCompare(b.group));
}
