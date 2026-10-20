/**
 * The Media workspace's model: which files a filter keeps, in what order, and where an arrow key
 * moves the selection.
 *
 * Pure over its inputs, so the rules the library is judged by can be tested without a DOM and
 * without a project: the filter list (studio.md §22.6), what **Unused** may claim, the three sorts,
 * the search, the counts each filter shows, and the grid's keyboard walk.
 *
 * **Unused is the one filter that is not a property of the file.** Kind is read off the name; being
 * unused is a question about every other document in the project, asked through the usage index one
 * file at a time (`files/media-usage.ts`). So its answer is `null` until every file's question has
 * settled, and a file whose question FAILED is never counted as unused: "nobody uses this" and "we
 * could not find out" are different facts, and a filter that offered the second as the first would
 * be inviting a delete nobody can stand behind.
 *
 * @docs studio/projects/media
 */

import type { MediaFileKind } from "../files/media-upload";

/** One file as the library lists it. */
export interface LibraryMediaFile {
  /** The project-relative path on disk: the file's identity everywhere in the library. */
  file: string;
  name: string;
  kind: MediaFileKind;
  /** Bytes, from the listing; `null` when the host did not say. */
  bytes: number | null;
  /** ISO modified time, from the listing; `null` when the host did not say. */
  modified: string | null;
}

/** A filter in the left column. The five kinds, every file, and the one usage question. */
export type MediaFilterKey = "all" | MediaFileKind | "unused";

/** The filters, in the order the column lists them (studio.md §22.6). */
export const MEDIA_FILTERS: readonly { key: MediaFilterKey; label: string }[] = [
  { key: "all", label: "All media" },
  { key: "image", label: "Images" },
  { key: "video", label: "Video" },
  { key: "audio", label: "Audio" },
  { key: "document", label: "Documents" },
  { key: "font", label: "Fonts" },
  { key: "unused", label: "Unused" },
];

/** The filter keys, for a command's `enum`. */
export const MEDIA_FILTER_KEYS: readonly MediaFilterKey[] = MEDIA_FILTERS.map((f) => f.key);

/** Whether a value names a filter. A command argument and a stored value are untrusted input. */
export function isMediaFilterKey(value: unknown): value is MediaFilterKey {
  return MEDIA_FILTER_KEYS.some((key) => key === value);
}

/** The heading a filter's grid carries. */
export function mediaFilterLabel(key: MediaFilterKey): string {
  return MEDIA_FILTERS.find((f) => f.key === key)?.label ?? "All media";
}

/** A sort, by the word its menu reads. */
export type MediaSortKey = "newest" | "name" | "size";

export const MEDIA_SORTS: readonly { key: MediaSortKey; label: string }[] = [
  { key: "newest", label: "Newest" },
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
];

export const MEDIA_SORT_KEYS: readonly MediaSortKey[] = MEDIA_SORTS.map((s) => s.key);

/** Whether a value names a sort. */
export function isMediaSortKey(value: unknown): value is MediaSortKey {
  return MEDIA_SORT_KEYS.some((key) => key === value);
}

/** Whether a file passes a filter. `unused` is `null` until the usage sweep has settled. */
export function passesFilter(
  file: LibraryMediaFile,
  filter: MediaFilterKey,
  unused: ReadonlySet<string> | null,
): boolean {
  switch (filter) {
    case "all": {
      return true;
    }
    case "unused": {
      return unused !== null && unused.has(file.file);
    }
    default: {
      return file.kind === filter;
    }
  }
}

/**
 * Whether a file matches a search: its NAME, case-insensitively, as the field's "Search by name…"
 * says. Not its path: every path starts `public/` or `content/`, so a one-letter search for "b" or
 * "c" kept the whole library and looked broken.
 */
export function matchesQuery(file: LibraryMediaFile, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || file.name.toLowerCase().includes(needle);
}

/**
 * The files a filter and a search keep, in a sort's order.
 *
 * Every sort ends in the path, so two files the sort cannot tell apart (two unmeasured sizes, two
 * files modified in the same second) keep one order across repaints rather than swapping.
 */
export function visibleMedia(
  files: readonly LibraryMediaFile[],
  options: {
    filter: MediaFilterKey;
    query: string;
    sort: MediaSortKey;
    unused: ReadonlySet<string> | null;
  },
): LibraryMediaFile[] {
  const kept = files.filter(
    (file) =>
      passesFilter(file, options.filter, options.unused) && matchesQuery(file, options.query),
  );
  return kept.toSorted((a, b) => compareBy(options.sort, a, b) || a.file.localeCompare(b.file));
}

function compareBy(sort: MediaSortKey, a: LibraryMediaFile, b: LibraryMediaFile): number {
  switch (sort) {
    case "name": {
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    }
    case "size": {
      // Largest first, because the question a size sort answers is "what is heavy"; unknown last.
      return (b.bytes ?? -1) - (a.bytes ?? -1);
    }
    default: {
      // Newest first; a file with no modified time sorts after every file that has one.
      return (b.modified ?? "").localeCompare(a.modified ?? "");
    }
  }
}

/**
 * How many files each filter would show, before the search narrows them.
 *
 * `unused` is `null` until the sweep has settled, and the column draws no number for it: a count is
 * a claim, and "0 unused" before anyone has looked would be one nobody can stand behind.
 */
export function filterCounts(
  files: readonly LibraryMediaFile[],
  unused: ReadonlySet<string> | null,
): Record<MediaFilterKey, number | null> {
  const counts: Record<MediaFilterKey, number | null> = {
    all: files.length,
    audio: 0,
    document: 0,
    font: 0,
    image: 0,
    unused: unused === null ? null : files.filter((file) => unused.has(file.file)).length,
    video: 0,
  };
  for (const file of files) {
    counts[file.kind] = (counts[file.kind] ?? 0) + 1;
  }
  return counts;
}

/** The minimum tile width and the gap the grid is laid out with (`surfaces/media-library.json`). */
export const TILE_MIN_WIDTH = 132;
export const TILE_GAP = 12;

/**
 * How many columns `repeat(auto-fill, minmax(TILE_MIN_WIDTH, 1fr))` makes in a box `width` wide.
 * The same arithmetic CSS does, so ArrowDown lands on the tile drawn under the current one.
 */
export function gridColumns(width: number): number {
  return Math.max(1, Math.floor((width + TILE_GAP) / (TILE_MIN_WIDTH + TILE_GAP)));
}

/**
 * Where a key moves the selection in a grid of `count` tiles laid out `columns` wide, or `null` for
 * a key the grid does not handle (Tab, a letter), which is then left to the platform.
 *
 * The grid pattern of WAI-ARIA's practices: arrows move one cell, Home and End go to the ends of
 * the row, and Ctrl+Home and Ctrl+End to the ends of the grid. Arrows stop at the edges rather than
 * wrapping, because a wrap from the last column of one row to the first of the next is a move the
 * eye does not follow.
 */
export function gridStep(
  index: number,
  key: string,
  columns: number,
  count: number,
  ctrl = false,
): number | null {
  if (count === 0) {
    return null;
  }
  const at = Math.min(Math.max(index, 0), count - 1);
  const rowStart = at - (at % columns);
  let next: number;
  switch (key) {
    case "ArrowRight": {
      next = at + 1;
      break;
    }
    case "ArrowLeft": {
      next = at - 1;
      break;
    }
    case "ArrowDown": {
      next = at + columns;
      break;
    }
    case "ArrowUp": {
      next = at - columns;
      break;
    }
    case "Home": {
      next = ctrl ? 0 : rowStart;
      break;
    }
    case "End": {
      next = ctrl ? count - 1 : Math.min(rowStart + columns - 1, count - 1);
      break;
    }
    default: {
      return null;
    }
  }
  return next < 0 || next >= count ? at : next;
}
