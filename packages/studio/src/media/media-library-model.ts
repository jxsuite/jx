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
 * **Missing alt text and the tag filters are questions about the file's own record**, its alt text
 * and tags as the file carries them (`files/media-record.ts`). Reading one is a read of the file,
 * so they too are answered by a sweep, and until it has read every file that can hold a record
 * their counts are blank. A file whose format cannot hold a record, or whose record could not be
 * read, is never counted as missing alt text: the filter lists what the reader can fix here.
 *
 * @docs studio/projects/media
 */

import type { MediaFileKind } from "../files/media-upload";
import type { FocalPoint, MediaRecord } from "@jxsuite/site/xmp-packet";

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

/**
 * A filter in the left column: every file, the five kinds, the two questions (Missing alt text,
 * Unused), and one filter per tag, keyed `tag:<tag>`.
 */
export type MediaFilterKey = "all" | MediaFileKind | "missing-alt" | "unused" | `tag:${string}`;

/** The fixed filters' keys: every key but a tag's. */
export type FixedFilterKey = Exclude<MediaFilterKey, `tag:${string}`>;

/** The prefix a tag filter's key carries. */
const TAG_PREFIX = "tag:";

/** The filter key for one tag. */
export function tagFilterKey(tag: string): MediaFilterKey {
  return `${TAG_PREFIX}${tag}`;
}

/** The tag a filter key names, or `null` for every other filter. */
export function tagOfFilter(key: string): string | null {
  return key.startsWith(TAG_PREFIX) && key.length > TAG_PREFIX.length
    ? key.slice(TAG_PREFIX.length)
    : null;
}

/** What the filters that are not a property of the file's name have answered so far. */
export interface FilterAnswers {
  /** The files nobody references, once the usage sweep has settled; `null` before. */
  unused: ReadonlySet<string> | null;
  /**
   * Each file's record, by path, for every file read so far whose format holds one and whose read
   * succeeded. A file missing here is unread, unreadable, or of a format with no record.
   */
  records: ReadonlyMap<string, MediaRecord>;
  /** Whether every file that can hold a record has been read. */
  recordsSettled: boolean;
}

/** Answers before anything has been asked. */
export const NO_ANSWERS: FilterAnswers = {
  records: new Map(),
  recordsSettled: false,
  unused: null,
};

/** The filters, in the order the column lists them (studio.md §22.6). */
export const MEDIA_FILTERS: readonly { key: FixedFilterKey; label: string }[] = [
  { key: "all", label: "All media" },
  { key: "image", label: "Images" },
  { key: "video", label: "Video" },
  { key: "audio", label: "Audio" },
  { key: "document", label: "Documents" },
  { key: "font", label: "Fonts" },
  { key: "missing-alt", label: "Missing alt text" },
  { key: "unused", label: "Unused" },
];

/** The filter keys, for a command's `enum`. */
export const MEDIA_FILTER_KEYS: readonly FixedFilterKey[] = MEDIA_FILTERS.map((f) => f.key);

/** Whether a value names a filter. A command argument and a stored value are untrusted input. */
export function isMediaFilterKey(value: unknown): value is MediaFilterKey {
  return (
    MEDIA_FILTER_KEYS.some((key) => key === value) ||
    (typeof value === "string" && tagOfFilter(value) !== null)
  );
}

/** The heading a filter's grid carries: a tag filter's is the tag. */
export function mediaFilterLabel(key: MediaFilterKey): string {
  return tagOfFilter(key) ?? MEDIA_FILTERS.find((f) => f.key === key)?.label ?? "All media";
}

/** Whether a filter is answered by the record sweep: Missing alt text, and every tag. */
export function isRecordFilter(key: MediaFilterKey): boolean {
  return key === "missing-alt" || tagOfFilter(key) !== null;
}

/** Whether a record carries `tag`, compared without case, as a reader types it. */
function hasTag(record: MediaRecord | undefined, tag: string): boolean {
  const wanted = tag.toLowerCase();
  return record?.tags.some((each) => each.toLowerCase() === wanted) ?? false;
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

/** Whether a file passes a filter, on what has been answered so far. */
export function passesFilter(
  file: LibraryMediaFile,
  filter: MediaFilterKey,
  answers: FilterAnswers,
): boolean {
  const tag = tagOfFilter(filter);
  if (tag !== null) {
    return hasTag(answers.records.get(file.file), tag);
  }
  switch (filter) {
    case "all": {
      return true;
    }
    case "unused": {
      return answers.unused !== null && answers.unused.has(file.file);
    }
    case "missing-alt": {
      return answers.records.get(file.file)?.alt === "";
    }
    default: {
      return file.kind === filter;
    }
  }
}

/**
 * Whether a file matches a search, case-insensitively: its NAME, its alt text or one of its tags,
 * as the field's "Search by name, alt text or tag" says. Not its path: every path starts `public/`
 * or `content/`, so a one-letter search for "b" or "c" kept the whole library and looked broken.
 */
export function matchesQuery(
  file: Pick<LibraryMediaFile, "name">,
  query: string,
  record?: MediaRecord,
): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === "" ||
    file.name.toLowerCase().includes(needle) ||
    (record !== undefined &&
      (record.alt.toLowerCase().includes(needle) ||
        record.tags.some((tag) => tag.toLowerCase().includes(needle))))
  );
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
    answers: FilterAnswers;
  },
): LibraryMediaFile[] {
  const { answers } = options;
  const kept = files.filter(
    (file) =>
      passesFilter(file, options.filter, answers) &&
      matchesQuery(file, options.query, answers.records.get(file.file)),
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
 * How many files each fixed filter would show, before the search narrows them.
 *
 * Unused is `null` until its sweep has settled, and Missing alt text until the record sweep has,
 * and the column draws no number for either: a count is a claim, and "0 unused" before anyone has
 * looked would be one nobody can stand behind.
 */
export function filterCounts(
  files: readonly LibraryMediaFile[],
  answers: FilterAnswers,
): Record<FixedFilterKey, number | null> {
  const { unused } = answers;
  const counts: Record<FixedFilterKey, number | null> = {
    all: files.length,
    audio: 0,
    document: 0,
    font: 0,
    image: 0,
    "missing-alt": answers.recordsSettled
      ? files.filter((file) => passesFilter(file, "missing-alt", answers)).length
      : null,
    unused: unused === null ? null : files.filter((file) => unused.has(file.file)).length,
    video: 0,
  };
  for (const file of files) {
    counts[file.kind] = (counts[file.kind] ?? 0) + 1;
  }
  return counts;
}

/**
 * Every tag the files carry, with how many files carry it, in name order. Tags differing only in
 * case are one tag, spelled as the first file read spells it.
 */
export function tagCounts(
  files: readonly LibraryMediaFile[],
  answers: FilterAnswers,
): { tag: string; count: number }[] {
  const byKey = new Map<string, { tag: string; count: number }>();
  for (const file of files) {
    for (const tag of answers.records.get(file.file)?.tags ?? []) {
      const key = tag.toLowerCase();
      const known = byKey.get(key);
      if (known === undefined) {
        byKey.set(key, { count: 1, tag });
      } else {
        known.count += 1;
      }
    }
  }
  return [...byKey.values()].toSorted((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { numeric: true, sensitivity: "base" }),
  );
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

// ─── Focal point ─────────────────────────────────────────────────────────────

/** A fraction of the picture as the percentage the fields show: "37.5", at most one decimal. */
export function focusPercent(fraction: number): string {
  return String(Math.round(fraction * 1000) / 10);
}

/** The focal point a press on the picture names, or `null` for a picture with no size yet. */
export function focusAt(x: number, width: number, y: number, height: number): FocalPoint | null {
  if (!(width > 0 && height > 0)) {
    return null;
  }
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  return { x: clamp(x / width), y: clamp(y / height) };
}

/**
 * The focal point with one coordinate set from a typed percentage, the other kept (or the centre
 * when the picture had none). `null` when the text is not a number; out of range is clamped.
 */
export function focusWithAxis(
  focus: FocalPoint | null,
  axis: "x" | "y",
  text: string,
): FocalPoint | null {
  const trimmed = text.trim();
  const value = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(value)) {
    return null;
  }
  const fraction = Math.min(1, Math.max(0, value / 100));
  const base = focus ?? { x: 0.5, y: 0.5 };
  return axis === "x" ? { x: fraction, y: base.y } : { x: base.x, y: fraction };
}
