/**
 * The Library's five layouts, as geometry and projections rather than as markup.
 *
 * All five draw the SAME rows — one scan, one filter — so switching layout is a repaint, never a
 * re-read. What differs is the geometry, and the geometry is data ({@link LAYOUT_METRICS}) rather
 * than five hand-rolled scroll containers: the pane hands each layout a window computed from the
 * metric, so virtualization is a property of the Library rather than of whichever layout someone
 * remembered to virtualize.
 *
 * **Two of them are grouped, and grouped lists are bounded differently.** Table, Cards and Media
 * are flat and uniform, so they window. Calendar and Board are grouped, and a window over a grouped
 * list either breaks the groups or needs variable-height measurement; both draw text only (no live
 * preview, so an item costs one `<li>`), and each caps what it draws and SAYS what it left out. A
 * layout that silently truncated would be the same class of lie as "No files found".
 *
 * The markup itself is `surfaces/library-pane.json`. What is left here is what a document cannot
 * express: how tall a row is, how many fit across, how many a group may draw, and what a file's
 * fields say once they are text.
 */

import { isImage } from "../files/media-upload";
import { previewFileSrc } from "../files/media-paths";
import { localeLabel } from "@jxsuite/schema/locale";
import { groupByCategory, groupByDate } from "./library-model";
import type { LibraryFile, LibraryLayout } from "./library-model";
import type { GridColumn, GridCellValue } from "../grid/grid-source";
import type { LibraryGroup, LibraryRow } from "../surfaces/library-pane";

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
 * These are nominal sizes that must match the Library surface's own style block. They are
 * approximate on purpose: the window's job is to keep the rendered count proportional to the
 * viewport, and being one row out costs one row of overscan, not correctness.
 */
export const LAYOUT_METRICS: Readonly<Record<LibraryLayout, LayoutMetric>> = {
  board: { itemWidth: 0, rowHeight: 0, windowed: false },
  calendar: { itemWidth: 0, rowHeight: 0, windowed: false },
  cards: { itemWidth: 200, rowHeight: 194, windowed: true },
  media: { itemWidth: 132, rowHeight: 132, windowed: true },
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

/** An ISO timestamp as `YYYY-MM-DD`, or "" when there is none. Never invents "just now". */
export function formatModified(modified: string | undefined): string {
  if (!modified) {
    return "";
  }
  const parsed = new Date(modified);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

/** The text one table cell shows for a file. */
export function cellText(file: LibraryFile, field: string): string {
  switch (field) {
    case "category": {
      return file.category;
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
      return file.path;
    }
    case "size": {
      return formatSize(file.size);
    }
    case "type": {
      return file.type;
    }
    default: {
      return "";
    }
  }
}

/** Row-shaped access for a caller holding grid cells rather than the typed record. */
export function cellTextOf(value: GridCellValue): string {
  return value === null || value === undefined ? "" : String(value);
}

// ─── Rows ────────────────────────────────────────────────────────────────────

/** The four categories whose files are documents the runtime can render a preview of. */
const PREVIEWABLE = new Set(["Components", "Content", "Layouts", "Pages"]);

/**
 * One file, as the surface reads it.
 *
 * `live` is whether this layout may draw a real document render at all: Cards may, Media never
 * does. Getting that from the caller rather than from the file is what keeps a tile cheap — a
 * thumbnail of an asset is an `<img>`, and a live runtime render inside one is the whole cost the
 * Media layout exists to avoid.
 *
 * @param file The scanned file.
 * @param columns The Table's columns, from the grid source. Empty for a layout with no cells.
 * @param live Whether a previewable document may claim the `doc` island.
 */
export function libraryRow(
  file: LibraryFile,
  columns: readonly GridColumn[],
  live: boolean,
): LibraryRow {
  const image = isImage(file.ext);
  return {
    art: image ? "image" : live && PREVIEWABLE.has(file.category) ? "doc" : "glyph",
    cells: columns.map((column) => ({ field: column.field, text: cellText(file, column.field) })),
    meta: file.type,
    name: file.name,
    path: file.path,
    src: image ? previewFileSrc(file.path) : "",
  };
}

/** The text-only row both grouped layouts draw: a name, and the path it opens. */
function nameRow(file: LibraryFile): LibraryRow {
  return { art: "glyph", cells: [], meta: file.type, name: file.name, path: file.path, src: "" };
}

// ─── Calendar ────────────────────────────────────────────────────────────────

/**
 * Calendar: one section per day, newest first, plus an explicit account of what it did not place.
 *
 * A file's day comes from a `YYYY-MM-DD` filename prefix or the filesystem's mtime — never from
 * "now". Files with neither are listed under "No date" rather than parked on today, because a
 * calendar that invents dates is worse than one that admits it cannot place a file.
 *
 * @returns The day sections, and the sentence naming the older days it did not draw.
 */
export function calendarView(files: readonly LibraryFile[]): {
  groups: LibraryGroup[];
  truncated: string;
} {
  const { days, undated } = groupByDate(files);
  const shown = days.slice(0, CALENDAR_DAY_LIMIT);
  const hiddenDays = days.length - shown.length;
  const groups: LibraryGroup[] = shown.map((day) => ({
    count: "",
    files: day.files.map((file) => nameRow(file)),
    id: day.date,
    note: "",
    noteState: "hidden",
    title: day.date,
    undated: "false",
  }));
  if (undated.length > 0) {
    groups.push({
      count: "",
      files: undated.slice(0, BOARD_COLUMN_LIMIT).map((file) => nameRow(file)),
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

/** Board: one column per category present, each capped and each stating its own total. */
export function boardView(files: readonly LibraryFile[]): LibraryGroup[] {
  return groupByCategory(files).map((group) => {
    const hidden = group.files.length - BOARD_COLUMN_LIMIT;
    return {
      count: String(group.files.length),
      files: group.files.slice(0, BOARD_COLUMN_LIMIT).map((file) => nameRow(file)),
      id: group.group,
      note: hidden > 0 ? `${hidden} more — switch to Table to see them.` : "",
      noteState: hidden > 0 ? "shown" : "hidden",
      title: group.group,
      undated: "false",
    };
  });
}
