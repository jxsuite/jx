/**
 * The Content home's four views, as geometry and projections rather than as markup.
 *
 * All four draw the SAME rows — one scan, one collection, one filter — so switching view is a
 * repaint, never a re-read. What differs is the geometry, and the geometry is data
 * ({@link LAYOUT_METRICS}) rather than five hand-rolled scroll containers: the pane hands each
 * layout a window computed from the metric, so virtualization is a property of the Content home
 * rather than of whichever layout someone remembered to virtualize.
 *
 * **Two of them are grouped, and grouped lists are bounded differently.** Table and Cards are flat
 * and uniform, so they window. Calendar and Board are grouped, and a window over a grouped list
 * either breaks the groups or needs variable-height measurement; both draw text only (no live
 * preview, so an item costs one `<li>`), and each caps what it draws and SAYS what it left out. A
 * layout that silently truncated would be the same class of lie as "No files found".
 *
 * The markup itself is `surfaces/library-pane.json`. What is left here is what a document cannot
 * express: how tall a row is, how many fit across, how many a group may draw, and what a file's
 * fields say once they are text.
 */

import { isImage } from "../files/media-upload";
import { previewFileSrc } from "../files/media-paths";
import { localDay } from "../utils/local-day";
import { localeLabel } from "@jxsuite/schema/locale";
import { fileToRoute } from "@jxsuite/site/routes";
import { PAGES_COLLECTION } from "../content/content-collections";
import { groupByDate, groupByFolder, libraryDate } from "./library-model";
import { entryFieldOfKey } from "./library-source";
import type { EntryFieldColumn } from "./library-source";
import type { EntryFieldTexts } from "../content/entry-summaries";
import type { LibraryFile, LibraryLayout } from "./library-model";
import type { GridColumn, GridCellValue } from "../grid/grid-source";
import type { LibraryGroup, LibraryRow } from "../surfaces/library-pane";

/** What a collection entry says about itself, once read: its title, status and date. */
export interface EntryFacts {
  title: string;
  /** "Draft", "Published", or "" for a collection with no draft workflow. */
  status: string;
  /** `YYYY-MM-DD`, or "". */
  date: string;
  /** The schema's fields as list text, keyed by field name, when the entry has been read. */
  fields?: EntryFieldTexts | undefined;
  /** A page's template, by name ("Base", "None"), once the page has been read. */
  template?: string | undefined;
  /**
   * The entry's picture, as a preview URL: the field its schema declares an image (a post's
   * `cover`), from `content/entry-summaries.ts`'s `entryThumb`. "" or absent for none.
   */
  thumb?: string | undefined;
}

/** The field a Board groups a collection by when it has no draft workflow, and its heading. */
export interface BoardField {
  name: string;
  title: string;
  /** The schema's `enum`, when it declares one: the order the columns stand in. */
  order: readonly string[];
  /** The field holds a list: an entry stands in the column of each of its values. */
  list?: boolean | undefined;
}

/**
 * The values one field's list text holds: each item of a list field (its text joins them with
 * commas, as a CSV cell does), or the one value of any other field. Blank values are none.
 */
export function fieldValues(text: string | undefined, list: boolean | undefined): string[] {
  if (text === undefined || text.trim() === "") {
    return [];
  }
  if (!list) {
    return [text];
  }
  return text
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

/** A Board with more columns than this is a list of singletons, not a grouping. */
const BOARD_FIELD_MAX_GROUPS = 12;

/**
 * The field a Board groups by when the entries have no status: the first listed field the schema
 * gives an `enum`, else the first whose values actually repeat. A menu grouped by its `course` is a
 * board; a menu grouped by its one folder is one column, which says nothing. `null` when no field
 * groups the entries (every value unique, or every value the same), so the Board falls back to
 * folders.
 *
 * @param fields The listed fields, in order ({@link entryFieldColumns}).
 * @param enums Each field's declared `enum`, where it has one.
 * @param facts What each entry says, as read so far.
 */
export function boardFieldOf(
  fields: readonly EntryFieldColumn[],
  enums: ReadonlyMap<string, readonly string[]>,
  facts: readonly (EntryFacts | undefined)[],
): BoardField | null {
  const declared = fields.find((field) => enums.has(field.name));
  if (declared) {
    return { ...declared, order: enums.get(declared.name)! };
  }
  for (const field of fields) {
    if (field.measure) {
      continue;
    }
    // A list field's every item is a value: `Patios, Stone` is two, not one string.
    const values = facts.flatMap((entry) => fieldValues(entry?.fields?.[field.name], field.list));
    const distinct = new Set(values).size;
    if (distinct >= 2 && distinct < values.length && distinct <= BOARD_FIELD_MAX_GROUPS) {
      return { ...field, order: [] };
    }
  }
  return null;
}

/** A file's entry facts, or `undefined` for a file that is no entry or has not been read yet. */
export type EntryFactsOf = (file: LibraryFile) => EntryFacts | undefined;

/** Facts by path. Empty for Pages, and for a collection whose entries are still being read. */
export function entryFactsFrom(facts: ReadonlyMap<string, EntryFacts>): EntryFactsOf {
  return (file) => facts.get(file.path);
}

/** No file has facts. */
const NO_FACTS: EntryFactsOf = entryFactsFrom(new Map());

/** The geometry a layout scrolls at. `itemWidth` of 0 means one item per row. */
export interface LayoutMetric {
  /** Height of one row of items, in CSS pixels — the unit the window counts in. */
  rowHeight: number;
  /** Nominal item width; 0 for a full-width row. */
  itemWidth: number;
  /** Whether the layout windows at all. Grouped layouts cap instead. */
  windowed: boolean;
}

/**
 * Per-layout geometry.
 *
 * These are nominal sizes that must match the Content home surface's own style block. They are
 * approximate on purpose: the window's job is to keep the rendered count proportional to the
 * viewport, and being one row out costs one row of overscan, not correctness.
 */
export const LAYOUT_METRICS: Readonly<Record<LibraryLayout, LayoutMetric>> = {
  board: { itemWidth: 0, rowHeight: 0, windowed: false },
  calendar: { itemWidth: 0, rowHeight: 0, windowed: false },
  cards: { itemWidth: 200, rowHeight: 194, windowed: true },
  table: { itemWidth: 0, rowHeight: 32, windowed: true },
};

/** Days the Calendar draws before it stops and states the remainder. */
export const CALENDAR_DAY_LIMIT = 60;

/** Items a Board column draws before it stops and states the remainder. */
export const BOARD_COLUMN_LIMIT = 25;

/** Items per row at a given container width, for the layouts that flow. */
export function columnsAt(layout: LibraryLayout, width: number): number {
  const metric = LAYOUT_METRICS[layout];
  if (metric.itemWidth <= 0 || width <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(width / metric.itemWidth));
}

// ─── Cell text ───────────────────────────────────────────────────────────────

/** Bytes as a short human string. `null` when the platform did not report a size. */
export function formatSize(size: number | undefined): string {
  if (size === undefined || !Number.isFinite(size)) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * An ISO timestamp as the local `YYYY-MM-DD` it fell on, or "" when there is none. Never invents
 * "just now".
 */
export function formatModified(modified: string | undefined): string {
  return modified ? localDay(new Date(modified)) : "";
}

/** The text one table cell shows for a file, and for an entry what it says about itself. */
export function cellText(file: LibraryFile, field: string, entry?: EntryFacts): string {
  switch (field) {
    case "date": {
      return entry?.date ?? "";
    }
    case "status": {
      return entry?.status ?? "";
    }
    case "template": {
      return entry?.template ?? "";
    }
    case "title": {
      // Until the entry is read, the file name: the title is never blank while it loads.
      return entry?.title ?? file.name;
    }
    case "locale": {
      // The autonym, not the tag: the column exists so a reader can find their own language in it,
      // And `français` is what that reader scans for. The tag is still the filter's value.
      return file.locale ? localeLabel(file.locale) : "";
    }
    case "modified": {
      return formatModified(file.modified);
    }
    case "name": {
      return file.name;
    }
    case "path": {
      // A record is stored in its collection's file; its key (`prices.csv#3`) is no path.
      return file.record?.source ?? file.path;
    }
    case "size": {
      return formatSize(file.size);
    }
    case "type": {
      return file.type;
    }
    case "url": {
      // Only a page has a URL of its own; an entry's is its collection page's, read elsewhere.
      return file.collection === PAGES_COLLECTION ? fileToRoute(file.path).urlPattern : "";
    }
    default: {
      const own = entryFieldOfKey(field);
      return own === null ? "" : (entry?.fields?.[own] ?? "");
    }
  }
}

/** Row-shaped access for a caller holding grid cells rather than the typed record. */
export function cellTextOf(value: GridCellValue | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

// ─── Rows ────────────────────────────────────────────────────────────────────

/**
 * One file, as the surface reads it.
 *
 * `live` is whether this layout may draw a real document render at all: Cards may, Table never
 * does. Getting that from the caller rather than from the file is what keeps a row cheap. An image
 * is drawn as itself; every other file in a collection is a document the runtime can render.
 *
 * @param file The scanned file.
 * @param columns The Table's columns, from the grid source. Empty for a layout with no cells.
 * @param live Whether a previewable document may claim the `doc` island.
 * @param entry What the file says about itself, when it is a collection entry that has been read.
 */
export function libraryRow(
  file: LibraryFile,
  columns: readonly GridColumn[],
  live: boolean,
  entry?: EntryFacts,
): LibraryRow {
  const image = isImage(file.ext);
  // An entry is shown by its own picture (its `cover`), not by a render of its body text.
  const thumb = entry?.thumb ?? "";
  return {
    // A record is a row of a file, not a document the runtime can render.
    art:
      image || thumb !== ""
        ? "image"
        : live && file.collection !== null && !file.record
          ? "doc"
          : "glyph",
    cells: columns.map((column) => ({
      field: column.field,
      text: cellText(file, column.field, entry),
    })),
    meta: file.type,
    name: entry?.title ?? file.name,
    path: file.path,
    src: image ? previewFileSrc(file.path) : thumb,
  };
}

/** The text-only row both grouped layouts draw: a name (an entry's title), and the path it opens. */
function nameRow(file: LibraryFile, entry?: EntryFacts): LibraryRow {
  return {
    art: "glyph",
    cells: [],
    meta: file.type,
    name: entry?.title ?? file.name,
    path: file.path,
    src: "",
  };
}

// ─── Calendar ────────────────────────────────────────────────────────────────

/** The calendar layout: its day sections, and the sentence naming the older days it left out. */
export interface CalendarView {
  groups: LibraryGroup[];
  truncated: string;
}

/**
 * Calendar: one section per day, newest first, plus an explicit account of what it did not place.
 *
 * A file's day is an entry's own date field when it has one, else a `YYYY-MM-DD` filename prefix or
 * the filesystem's mtime — never "now". Files with none are listed under "No date" rather than
 * parked on today, because a calendar that invents dates is worse than one that admits it cannot
 * place a file.
 *
 * @param factsOf What each entry says about itself; its `date` wins over the file's.
 * @returns The day sections, and the sentence naming the older days it did not draw.
 */
export function calendarView(
  files: readonly LibraryFile[],
  factsOf: EntryFactsOf = NO_FACTS,
): CalendarView {
  const { days, undated } = groupByDate(files, (file) => {
    const own = factsOf(file)?.date;
    return own || libraryDate(file);
  });
  const shown = days.slice(0, CALENDAR_DAY_LIMIT);
  const hiddenDays = days.length - shown.length;
  const groups: LibraryGroup[] = shown.map((day) => ({
    count: "",
    files: day.files.map((file) => nameRow(file, factsOf(file))),
    id: day.date,
    note: "",
    noteState: "hidden",
    title: day.date,
    undated: "false",
  }));
  if (undated.length > 0) {
    groups.push({
      count: "",
      files: undated.slice(0, BOARD_COLUMN_LIMIT).map((file) => nameRow(file, factsOf(file))),
      /* Not a date, and it must never collide with one: the section's identity is what keeps its
         node across a repaint, and a day is always `YYYY-MM-DD`, so a leading underscore pair cannot be one. */
      id: "__undated",
      note: `${undated.length} file${undated.length === 1 ? "" : "s"} with no dated name and no modification time.`,
      noteState: "shown",
      title: "No date",
      undated: "true",
    });
  }
  return {
    groups,
    truncated:
      hiddenDays > 0
        ? `${hiddenDays} older ${hiddenDays === 1 ? "day is" : "days are"} not shown — filter, or switch to Table.`
        : "",
  };
}

// ─── Board ───────────────────────────────────────────────────────────────────

/** The order a status Board's columns stand in: the work in progress first. */
const STATUS_ORDER = ["Draft", "Published"];

/** Group entries by their status, in {@link STATUS_ORDER}, then any other status by name. */
function groupByStatus(
  files: readonly LibraryFile[],
  factsOf: EntryFactsOf,
): { group: string; files: LibraryFile[] }[] {
  const byStatus = new Map<string, LibraryFile[]>();
  for (const file of files) {
    const status = factsOf(file)?.status || "No status";
    const bucket = byStatus.get(status);
    if (bucket) {
      bucket.push(file);
    } else {
      byStatus.set(status, [file]);
    }
  }
  const rank = (status: string) => {
    const at = STATUS_ORDER.indexOf(status);
    return at === -1 ? STATUS_ORDER.length : at;
  };
  return [...byStatus.entries()]
    .map(([group, grouped]) => ({ files: grouped, group }))
    .toSorted((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group));
}

/** Group entries by one field's value, in the schema's `enum` order, then any other value by name. */
function groupByField(
  files: readonly LibraryFile[],
  factsOf: EntryFactsOf,
  field: BoardField,
): { group: string; files: LibraryFile[] }[] {
  const none = `No ${field.title.toLowerCase()}`;
  const byValue = new Map<string, LibraryFile[]>();
  for (const file of files) {
    const values = fieldValues(factsOf(file)?.fields?.[field.name], field.list);
    // An entry tagged twice stands in both columns: each is the set of entries with that tag.
    for (const value of values.length === 0 ? [none] : new Set(values)) {
      const bucket = byValue.get(value);
      if (bucket) {
        bucket.push(file);
      } else {
        byValue.set(value, [file]);
      }
    }
  }
  const rank = (value: string) => {
    if (value === none) {
      return Number.MAX_SAFE_INTEGER;
    }
    const at = field.order.indexOf(value);
    return at === -1 ? field.order.length : at;
  };
  return [...byValue.entries()]
    .map(([group, grouped]) => ({ files: grouped, group }))
    .toSorted((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group));
}

/**
 * Board: one column per status when the collection's entries have one (Draft, Published), else one
 * per value of the field the collection is grouped by ({@link boardFieldOf}: a menu's `course`),
 * else one per folder present; each capped and each stating its own total. A flat collection
 * grouped by folder is one column, which says nothing, so a field is preferred to it.
 *
 * @param factsOf What each entry says about itself.
 * @param field The field to group by when the entries have no status.
 */
export function boardView(
  files: readonly LibraryFile[],
  factsOf: EntryFactsOf = NO_FACTS,
  field: BoardField | null = null,
): LibraryGroup[] {
  const byStatus = files.some((file) => (factsOf(file)?.status ?? "") !== "");
  const groups = byStatus
    ? groupByStatus(files, factsOf)
    : field
      ? groupByField(files, factsOf, field)
      : groupByFolder(files);
  return groups.map((group) => {
    const hidden = group.files.length - BOARD_COLUMN_LIMIT;
    return {
      count: String(group.files.length),
      files: group.files.slice(0, BOARD_COLUMN_LIMIT).map((file) => nameRow(file, factsOf(file))),
      id: group.group,
      note: hidden > 0 ? `${hidden} more — switch to Table to see them.` : "",
      noteState: hidden > 0 ? "shown" : "hidden",
      title: group.group,
      undated: "false",
    };
  });
}
