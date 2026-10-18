/**
 * The ids of a file-backed collection's records, as the content loader gives them.
 *
 * A collection whose `source` names one file (`./content/projects.csv`) has one entry per record,
 * and the build names each one: a CSV row by the collection's `idField`, else its `id`, `sku`,
 * `slug` or `Slug` cell, else its row number from 0 (`coerceCSVRows` in `@jxsuite/parser`); an
 * object of a JSON array by its `id`, else `<file stem>-<n>` (`loadJSONEntries`). The Site panel
 * counts these and a reference picker offers them, so both must agree with the build.
 *
 * A leaf over the file's text: `grid/sources/content-source.ts` reads the file and hands it here.
 * `content/file-records.ts` names the same records for the Content home, but it reaches the entry
 * summaries, which reach the content source, so this module imports only the CSV codec.
 *
 * @docs studio/projects/browse
 */

import { isNonNullObject, isNumber, isString } from "@jxsuite/schema/guards";
import { parseCsv } from "../grid/csv-codec";
import type { JsonValue } from "@jxsuite/schema/types";

/**
 * The ids the CSV loader gives each data row; blank rows are skipped, as the Content home skips
 * them.
 */
function csvIds(text: string, idField: string | undefined): string[] {
  const { headers, rows } = parseCsv(text);
  const candidates = [idField, "id", "sku", "slug", "Slug"].flatMap((name) => {
    const at = name === undefined ? -1 : headers.indexOf(name);
    return at === -1 ? [] : [at];
  });
  return rows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row, index) => {
      const at = candidates.find((candidate) => (row[candidate] ?? "") !== "");
      return at === undefined ? String(index) : row[at]!;
    });
}

/**
 * The ids the JSON loader gives: each object of an array, `<stem>-<n>` where it names none; a file
 * that is ONE object (`docs/nav.json`) is one entry, its own `id` else the file's stem
 * (`loadJSONEntries`). `[]` for text that is not JSON.
 */
function jsonIds(text: string, stem: string): string[] {
  let parsed: JsonValue;
  try {
    // SAFETY: JSON.parse only ever yields JSON values; its `any` return type says nothing more.
    parsed = JSON.parse(text) as JsonValue;
  } catch {
    return [];
  }
  const idOf = (item: JsonValue, fallback: string): string => {
    const id = isNonNullObject(item) && !Array.isArray(item) ? item.id : undefined;
    return isString(id) || isNumber(id) ? String(id) : fallback;
  };
  if (!Array.isArray(parsed)) {
    return [idOf(parsed, stem)];
  }
  return parsed.map((item, index) => idOf(item, `${stem}-${index}`));
}

/**
 * The record ids a collection file holds.
 *
 * @param path The file's project-relative path; its extension says how to read it.
 * @param text The file's text.
 * @param idField The collection's declared `idField`, if any.
 * @returns The ids in file order, or `[]` for a file kind that holds no records Studio reads.
 */
export function fileRecordIds(path: string, text: string, idField?: string): string[] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".csv")) {
    return csvIds(text, idField);
  }
  if (lower.endsWith(".json")) {
    const stem = (path.split("/").pop() ?? path).replace(/\.json$/i, "");
    return jsonIds(text, stem);
  }
  return [];
}
