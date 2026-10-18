/**
 * The entries of a file-backed collection: the records of the one file its `source` names.
 *
 * A collection whose `source` is a file (`content.pricing.source: "./content/pricing/prices.csv"`)
 * has one entry per record, exactly as the parser's loader reads it: a CSV row under the header, or
 * an object of a JSON array. The Content workspace lists those records, so a fifteen-row price list
 * reads "Pricing 15" with a row per record rather than "Pricing 1" and the file's name
 * (`specs/studio.md` §22.5). The records are written in the file's own grid, which opening any of
 * them opens.
 *
 * Pure over the file's text: the scan (`browse/library-source.ts`) reads the file and hands it
 * here.
 *
 * @docs studio/projects/browse
 */

import { isNonNullObject } from "@jxsuite/schema/guards";
import { parseCsv } from "../grid/csv-codec";
import { fieldText, titleFieldOf } from "./entry-summaries";
import type { ContentTypeSchema, JsonValue } from "@jxsuite/schema/types";

/** One record of a file-backed collection. */
export interface FileRecord {
  /** Its position among the file's records, from 0. */
  index: number;
  /**
   * Its position among the file's data rows, from 0, blank rows counted: the row its file's grid
   * shows it in, which a blank row above it makes differ from {@link index}.
   */
  row: number;
  /** What it is called: its title field, else its first text, else its row number. */
  title: string;
  /** Every field it holds, as list text, keyed by field name. */
  fields: Readonly<Record<string, string>>;
}

/** The title of one record, as the Content home names it. */
function recordTitle(
  schema: ContentTypeSchema | null | undefined,
  fields: Readonly<Record<string, string>>,
  index: number,
  fallback: string,
): string {
  const field = titleFieldOf(schema, fields);
  const named = field === null ? "" : (fields[field] ?? "");
  const first = Object.values(fields).find((value) => value.trim() !== "");
  return (named || first || fallback || `Row ${index + 1}`).trim();
}

/** One record's fields, and the data row it was read from. */
interface RecordFields {
  fields: Record<string, string>;
  row: number;
  /** The file is this one record, so it is called what the file is called when it says nothing. */
  single?: boolean;
}

/** The records of a CSV text: one per data row under the header, blank rows skipped. */
function csvFields(text: string): RecordFields[] {
  const { headers, rows } = parseCsv(text);
  return rows.flatMap((cells, row) =>
    cells.some((cell) => cell.trim() !== "")
      ? [{ fields: Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""])), row }]
      : [],
  );
}

/**
 * The records of a JSON text: one per object of an array, or ONE for a file that is a single object
 * (`docs/nav.json`), which the loader reads as one entry named by the file. Null for text that is
 * not JSON, which is then listed as the file it is.
 */
function jsonFields(text: string): RecordFields[] | null {
  let parsed: JsonValue;
  try {
    // SAFETY: JSON.parse only ever yields JSON values; its `any` return type says nothing more.
    parsed = JSON.parse(text) as JsonValue;
  } catch {
    return null;
  }
  const fieldsOf = (item: JsonValue): Record<string, string> =>
    isNonNullObject(item) && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).map(([key, value]) => [key, fieldText(value)]))
      : {};
  if (!Array.isArray(parsed)) {
    return [{ fields: fieldsOf(parsed), row: 0, single: true }];
  }
  return parsed.map((item, row) => ({ fields: fieldsOf(item), row }));
}

/**
 * The records a collection file holds, or null when its kind is not one the Content workspace reads
 * records from (it is then listed as the file it is).
 *
 * @param path The file's project-relative path; its extension says how to read it.
 * @param text The file's text.
 * @param schema The collection's schema, which names the title field.
 */
export function fileRecords(
  path: string,
  text: string,
  schema?: ContentTypeSchema | null,
): FileRecord[] | null {
  const lower = path.toLowerCase();
  const rows = lower.endsWith(".csv")
    ? csvFields(text)
    : lower.endsWith(".json")
      ? jsonFields(text)
      : null;
  if (rows === null) {
    return null;
  }
  const stem = (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
  return rows.map(({ fields, row, single }, index) => ({
    fields,
    index,
    row,
    title: recordTitle(schema, fields, index, single ? stem : ""),
  }));
}

/** The key a record's row is listed under: its file and its place in it, `prices.csv#3`. */
export function recordKey(path: string, index: number): string {
  return `${path}#${index + 1}`;
}
