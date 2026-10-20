/**
 * One record of a file-backed collection, edited as an entry: a form over one CSV row.
 *
 * A collection whose `source` names one file (`./content/projects.csv`) has one entry per record
 * (`content/file-records.ts`). The file's own grid edits all of them at once; this is the form-only
 * entry editor (`content/entry-editor.ts`, `specs/studio.md` §22.5) over ONE of them, so opening a
 * project from the Content workspace opens that project's fields, typed by the collection's schema,
 * rather than a table the reader has to find the row in.
 *
 * **It is an editor of the file's grid tab, not a second document.** The record's fields are read
 * from, and written into, the grid controller's edit buffer (`grid/edit-buffer.ts`), the same
 * buffer the grid's cells write. So ⌘S saves the file through the grid's one commit path (with its
 * staleness check and its untouched-cell rule), ⌘Z undoes a field edit exactly as it undoes a cell,
 * the tab's dirty dot is the buffer's, and switching the tab's editor to Grid shows the edit as a
 * pending cell.
 *
 * Which record the form shows is per tab, here, keyed by the tab's id. An opener names the record
 * by its place among the file's data rows, because that is all a scan knows and the rows may not
 * have loaded yet; the place resolves to the row's key the moment they have, reactively, so the
 * form draws the record as soon as it exists. Previous / Next then name rows by key, which a save
 * that re-reads the file does not move.
 *
 * @docs studio/projects/content-types
 */

import { onScopeDispose, reactive } from "../reactivity";
import { activateTab, workspace } from "../workspace/workspace";
import { getGridController } from "../grid/grid-controller";
import { isBoolean, isNonNullObject, isNumber, isString } from "@jxsuite/schema/guards";
import { entryDay } from "./entry-summaries";
import type { GridCellValue } from "../grid/grid-source";
import type { EntryFields } from "./entry-fields";
import type { JsonValue } from "../types";
import type { Tab } from "../tabs/tab";

/** A value that already starts with a calendar day, which a date input reads as it is. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/**
 * The `canvasMode` the entry form draws under. Defined here, with the record it may be over, and
 * re-exported by `entry-editor.ts`, which imports this module.
 */
export const ENTRY_MODE = "entry";

/** A tab's record: by its row key, or (until the rows load) by its place among the data rows. */
type ShownRecord = { key: string } | { row: number };

/** Tab id → the record its entry form shows. */
const shown = reactive(new Map<string, ShownRecord>());

/** The key of the record a tab's entry form shows, or null when it shows none (yet). Tracks. */
export function recordOf(tab: Tab): string | null {
  const record = shown.get(tab.id);
  if (record === undefined) {
    return null;
  }
  if ("key" in record) {
    return record.key;
  }
  return getGridController(tab)?.state.rows[record.row]?.key ?? null;
}

/** Whether the tab's entry form is over a record of its file, chosen or still loading. Tracks. */
export function hasRecord(tab: Tab): boolean {
  return shown.has(tab.id);
}

/** Show the record keyed `rowKey` in this tab's entry form. */
export function showRecord(tab: Tab, rowKey: string): void {
  shown.set(tab.id, { key: rowKey });
}

/** Forget the tab's record (its tab closed, or the record is gone). */
export function forgetRecord(tab: Tab): void {
  shown.delete(tab.id);
}

/** Whether this tab's entry form is over a record of its grid rather than over its own document. */
export function isRecordTab(tab: Tab): boolean {
  return hasRecord(tab) && getGridController(tab) !== null;
}

/**
 * The record's fields as the form reads them: every column's current value, pending edits included,
 * typed as the grid types it (a number column's cell is a number, a list column's a list of
 * strings). A cell with nothing in it is absent, as an empty frontmatter key would be.
 */
export function recordFields(tab: Tab): EntryFields {
  const controller = getGridController(tab);
  const rowKey = recordOf(tab);
  if (!controller || rowKey === null) {
    return {};
  }
  const fields: EntryFields = {};
  for (const column of controller.state.columns) {
    const value = controller.buffer.effectiveValue(rowKey, column.field);
    if (value === null || value === "") {
      continue;
    }
    if (column.kind === "date" && isString(value) && !ISO_DAY.test(value)) {
      /* A CSV spells a date the way its spreadsheet did (`6/3/2026`), which a date input cannot
         show. The form is shown the day it means; the cell keeps its spelling until it is edited. */
      fields[column.field] = entryDay(value) || value;
      continue;
    }
    fields[column.field] = isNonNullObject(value) && !Array.isArray(value) ? value.$ref : value;
  }
  return fields;
}

/** A form value as the cell it is written into. */
function cellValue(value: JsonValue | undefined): GridCellValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (isString(item) ? item : JSON.stringify(item)));
  }
  if (isString(value) || isNumber(value) || isBoolean(value)) {
    return value;
  }
  // A cell holds text: an object a field produced is written as its JSON.
  return JSON.stringify(value);
}

/**
 * Write a form patch into the record's row as one undo step. A field with no column is ignored: the
 * file has nowhere to keep it, and adding a column is the grid's decision, not a form's.
 */
export function commitRecordFields(tab: Tab, patch: Record<string, JsonValue | undefined>): void {
  const controller = getGridController(tab);
  const rowKey = recordOf(tab);
  if (!controller || rowKey === null) {
    return;
  }
  const columns = new Set(controller.state.columns.map((column) => column.field));
  controller.buffer.group(() => {
    for (const [field, value] of Object.entries(patch)) {
      if (columns.has(field)) {
        controller.buffer.setCell(rowKey, field, cellValue(value));
      }
    }
  });
}

/** Where the shown record sits among the file's rows, for the form's Previous / Next. */
export interface RecordPlace {
  /** Its place among the rows, from 0; -1 when the record is not (or no longer) among them. */
  index: number;
  total: number;
  previous: string | null;
  next: string | null;
}

/** The shown record's place among the grid's rows, in file order. Tracks the rows. */
export function recordPlace(tab: Tab): RecordPlace {
  const controller = getGridController(tab);
  const rowKey = recordOf(tab);
  const rows = controller?.state.rows ?? [];
  const index = rowKey === null ? -1 : rows.findIndex((row) => row.key === rowKey);
  return {
    index,
    next: index === -1 ? null : (rows[index + 1]?.key ?? null),
    previous: index <= 0 ? null : (rows[index - 1]?.key ?? null),
    total: rows.length,
  };
}

/**
 * Open one record of a file-backed collection in its entry form.
 *
 * Opens (or reveals) the file's grid tab, names the record at `row` (its place among the file's
 * data rows, as `content/file-records.ts` numbers it) and puts the tab in the entry editor. The
 * form draws the record once the grid's rows have loaded ({@link recordOf}).
 *
 * @returns The tab, or null when the file could not be opened at all.
 */
export async function openRecordEntry(path: string, row: number): Promise<Tab | null> {
  /* Dynamic for the reason `entry-open.ts` gives: `files/files.ts` reaches the platform, the format
     registry and the packages layer. */
  const { openFileInTab } = await import("../files/files");
  await openFileInTab(path);
  const tab = workspace.tabs.get(path) ?? null;
  if (!tab || !getGridController(tab)) {
    return tab;
  }
  if (!shown.has(tab.id)) {
    // The choice lives as long as the tab: a file reopened later starts on no record.
    tab.scope.run(() => {
      onScopeDispose(() => forgetRecord(tab));
    });
  }
  shown.set(tab.id, { row });
  if (!tab.capabilities.modes.includes(ENTRY_MODE)) {
    tab.capabilities.modes.unshift(ENTRY_MODE);
  }
  tab.session.ui.canvasMode = ENTRY_MODE;
  tab.session.ui.preview = false;
  activateTab(tab.id);
  return tab;
}
