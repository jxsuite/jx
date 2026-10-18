/**
 * The Content home's scan, as a {@link GridSource}.
 *
 * The scan is one more source over the same contract the CSV, collection, pages and connector grids
 * already use: columns come from {@link libraryColumns}, rows are the scan, and every view (Table,
 * Cards, Calendar, Board) draws the SAME rows through a different arrangement. A view switch never
 * re-reads the project, and neither does showing another collection: the scan covers the project
 * once, and each collection is a filter over it.
 *
 * It is a **read-only** source, and says so rather than pretending. Renaming, duplicating and
 * deleting a file are real operations with real consequences (a rename rewrites references; a
 * delete needs the reference count in its confirmation), and they belong to the commands that
 * already do that work correctly. A grid cell that silently renamed a file on blur would bypass
 * both. {@link LibrarySource.commit} therefore refuses, naming the surface that can.
 */

import { getPlatform } from "../platform";
import { projectState } from "../store";
import { workspaceHomeTabId } from "../workspace/workspace-ids";
import { PAGES_COLLECTION } from "../content/content-collections";
import { fileToRoute } from "@jxsuite/site/routes";
import { libraryScanDirs, scanLibrary } from "./library-model";
import { DRAFT_FIELD } from "../content/draft-state";
import { isString } from "@jxsuite/schema/guards";
import { collectionForFile } from "../content/collection-match";
import { fileRecords, recordKey } from "../content/file-records";
import type { ContentTypeSchema } from "@jxsuite/schema/types";
import type { FileRecord } from "../content/file-records";
import type { LibraryFile, LibraryScan, ScanFailure } from "./library-model";
import type {
  CommitResult,
  GridColumn,
  GridEditBatch,
  GridRow,
  GridRowsResult,
  GridSource,
} from "../grid/grid-source";

/** Why a cell edit is refused — printed by the grid, so the author is told where to go instead. */
export const LIBRARY_READ_ONLY =
  "The Content workspace lists files; it does not edit them in the list. Rename, duplicate or " +
  "delete from the file's context menu, or open the file to edit it.";

/** Which of an entry's own facts a collection's entries carry, so the Table draws a column for each. */
export interface EntryColumnFacts {
  /** Some entry says Draft or Published: the collection has a draft workflow. */
  status: boolean;
  /** Some entry is dated by a field of its own. */
  date: boolean;
  /** The files are in more than one language (the Pages table draws a Language column). */
  locale?: boolean;
  /** The collection's own fields, each drawn as a column after Title, Status and Date. */
  fields?: readonly EntryFieldColumn[];
}

/** One schema field the Table draws as a column of its own. */
export interface EntryFieldColumn {
  /** The field's name in the entry. */
  name: string;
  /** The column heading. */
  title: string;
}

/** The grid field a schema field's column is keyed by, kept apart from the file facts' names. */
export function entryFieldKey(name: string): string {
  return `field:${name}`;
}

/** The schema field a column key names, or null for a column that is no schema field. */
export function entryFieldOfKey(key: string): string | null {
  return key.startsWith("field:") ? key.slice("field:".length) : null;
}

/** At most this many schema fields become columns; the rest are one Edit in grid away. */
export const ENTRY_FIELD_COLUMN_LIMIT = 6;

/** Formats a list cell cannot show as text: an image is the Cards view's, a body is the editor's. */
const UNLISTED_FORMATS = new Set(["image", "markdown", "html", "richtext"]);

/** "publishedAt" → "Published at", "course" → "Course". */
export function fieldTitle(name: string): string {
  const words = name
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The schema fields a collection's Table draws, in declaration order: every scalar field except the
 * ones the Table already names some other way (the title, the date, the draft flag) and the ones
 * whose value is not text to read in a row (an image, a body, an object).
 *
 * @param schema The collection's schema.
 * @param skip Field names drawn already: the title field and the date field.
 */
export function entryFieldColumns(
  schema: ContentTypeSchema | null | undefined,
  skip: ReadonlySet<string>,
): EntryFieldColumn[] {
  return Object.entries(schema?.properties ?? {})
    .filter(([name, field]) => {
      if (skip.has(name) || name === DRAFT_FIELD) {
        return false;
      }
      if (
        field.type === "object" ||
        (isString(field.format) && UNLISTED_FORMATS.has(field.format))
      ) {
        return false;
      }
      return field.type !== "array" || field.items?.type === "string";
    })
    .slice(0, ENTRY_FIELD_COLUMN_LIMIT)
    .map(([name]) => ({ name, title: fieldTitle(name) }));
}

/**
 * The Pages table's columns (the Content-Pages board): **Title** (the name the route gives the
 * page, as the Site panel names it), **URL**, **Template**, **Status** when some page is marked a
 * draft, **Language** when the pages are in more than one, and **Edited**. No file name and no
 * path: two pages are both `index.json`, and the URL already says where each one is.
 */
function pageColumns(facts?: EntryColumnFacts): GridColumn[] {
  const columns: GridColumn[] = [
    { editable: false, field: "title", kind: "string", title: "Title", widthHint: 240 },
    // The URL is what tells two pages apart: no two routed files publish the same one.
    { editable: false, field: "url", kind: "string", pk: true, title: "URL", widthHint: 200 },
    { editable: false, field: "template", kind: "string", title: "Template", widthHint: 140 },
  ];
  if (facts?.status) {
    columns.push({
      editable: false,
      field: "status",
      kind: "string",
      title: "Status",
      widthHint: 100,
    });
  }
  if (facts?.locale) {
    columns.push({
      editable: false,
      field: "locale",
      kind: "string",
      title: "Language",
      widthHint: 110,
    });
  }
  columns.push({
    editable: false,
    field: "modified",
    kind: "date",
    title: "Edited",
    widthHint: 120,
  });
  return columns;
}

/**
 * The Table view's columns for a collection. `path` is the row key and is never editable.
 *
 * Pages are listed by what an author calls them and where they are published ({@link pageColumns}).
 * A declared collection leads with what an entry is called and where it stands (its **Title**, then
 * its **Status** and **Date** when its entries have them), with the file it is stored in after: a
 * post is "Hello world, Draft", not `hello-world.md`.
 */
export function libraryColumns(
  collection: string = PAGES_COLLECTION,
  facts?: EntryColumnFacts,
): GridColumn[] {
  const fileFacts: GridColumn[] = [
    { editable: false, field: "locale", kind: "string", title: "Locale", widthHint: 90 },
    { editable: false, field: "modified", kind: "date", title: "Modified", widthHint: 160 },
    { editable: false, field: "path", kind: "readonly", title: "Path", widthHint: 320 },
  ];
  if (collection === PAGES_COLLECTION) {
    return pageColumns(facts);
  }
  const entry: GridColumn[] = [
    { editable: false, field: "title", kind: "string", title: "Title", widthHint: 260 },
  ];
  if (facts?.status) {
    entry.push({
      editable: false,
      field: "status",
      kind: "string",
      title: "Status",
      widthHint: 100,
    });
  }
  if (facts?.date) {
    entry.push({ editable: false, field: "date", kind: "date", title: "Date", widthHint: 120 });
  }
  for (const field of facts?.fields ?? []) {
    entry.push({
      editable: false,
      field: entryFieldKey(field.name),
      kind: "string",
      title: field.title,
      widthHint: 140,
    });
  }
  // The Path names the file, so a File column beside it would say the same thing twice.
  return [...entry, ...fileFacts];
}

/** One scanned file as a grid row. */
export function libraryRow(file: LibraryFile): GridRow {
  return {
    cells: {
      // Null, not "": the platform reported no locale directory for this file, and a grid cell
      // Distinguishes "no value" from "the empty string" everywhere else in this contract.
      locale: file.locale ?? null,
      modified: file.modified ?? null,
      // The scan reads no file, so a status, a template and a title are the Content home's to add.
      status: null,
      template: null,
      title: file.name,
      // A page's own URL; an entry's is its collection page's, which the scan does not read.
      url: file.collection === PAGES_COLLECTION ? fileToRoute(file.path).urlPattern : null,
    },
    key: file.path,
  };
}

/**
 * A file-backed collection's file, replaced by its records (`content/file-records.ts`): a CSV of
 * fifteen prices is fifteen entries of its collection, which is what the counts and the Content
 * home list. The file is read once per scan. One that cannot be read, or whose kind holds no
 * records Studio reads, stays listed as the file it is.
 */
export async function expandFileRecords(
  files: readonly LibraryFile[],
  readFile: (path: string) => Promise<string>,
): Promise<LibraryFile[]> {
  const expanded = await Promise.all(
    files.map(async (file): Promise<LibraryFile[]> => {
      const match = file.collection === null ? null : collectionForFile(file.path);
      if (!match?.fileBacked) {
        return [file];
      }
      let text: string;
      try {
        text = await readFile(file.path);
      } catch {
        return [file];
      }
      const records = fileRecords(file.path, text, match.def.schema);
      if (records === null) {
        return [file];
      }
      return records.map((record) => recordRow(file, record));
    }),
  );
  return expanded.flat();
}

/** One record of `file`, listed as a row of its own. */
function recordRow(file: LibraryFile, record: FileRecord): LibraryFile {
  return {
    ...file,
    name: record.title,
    path: recordKey(file.path, record.index),
    record: { fields: record.fields, source: file.path },
  };
}

/** {@link expandFileRecords} over a whole scan, reading through the platform. */
async function withRecords(scan: LibraryScan): Promise<LibraryScan> {
  const platform = getPlatform();
  const files = await expandFileRecords(scan.files, (path) => platform.readFile(path));
  return { ...scan, files };
}

/**
 * The scan's source, plus the two questions a grid source cannot ask but the Content home must
 * answer: what the scan could not read, and the files behind the rows (the non-table layouts want
 * the typed record, not a cell bag).
 */
export interface LibrarySource extends GridSource {
  /** The scanned files, in path order. Empty before the first {@link GridSource.rows} call. */
  files: () => readonly LibraryFile[];
  /** Directories the last scan could not read. NON-EMPTY MEANS THE LISTING IS INCOMPLETE. */
  failures: () => readonly ScanFailure[];
  /** Whether a scan has completed at least once — "not loaded yet" is not "empty". */
  scanned: () => boolean;
  /**
   * Whether the completed scan walked a different directory list than the project has now.
   *
   * The list is read when the project's directories load and grows when a collection is declared,
   * and either can happen after a scan already finished: a window restored straight into Content
   * asks for its rows before the project's directories have loaded, and the walk of none is an
   * answer of none. A stale scan is not an empty project, so its owner discards it.
   */
  stale: () => boolean;
}

/**
 * Build the scan's source. The scan is lazy: nothing is read until the first `rows()`.
 *
 * @param {() => readonly string[]} [dirs] Project directories to scan, injectable for tests and for
 *   the perf measurement; defaults to the open project's own list.
 */
export function createLibrarySource(dirs?: () => readonly string[]): LibrarySource {
  let scan: LibraryScan | null = null;
  let inFlight: Promise<LibraryScan> | null = null;
  /** The directory list the cached scan walked, joined: the key {@link LibrarySource.stale} tests. */
  let scannedKey: string | null = null;

  const projectDirs =
    dirs ??
    (() => libraryScanDirs(projectState?.projectDirs ?? [], projectState?.projectConfig ?? null));

  async function ensureScan(): Promise<LibraryScan> {
    if (scan) {
      return scan;
    }
    // Coalesce: five layouts and a command can all ask at once on the first paint, and the answer
    // Is one walk of the project, not six.
    const walked = projectDirs();
    /* A collection source the project's own list does not hold may not exist yet (a collection
       declared before its first entry): its absence is an empty collection, never a failure. */
    const conventional = new Set(dirs ? walked : (projectState?.projectDirs ?? []));
    const optional = new Set(walked.filter((dir) => !conventional.has(dir)));
    inFlight ??= scanLibrary(walked, getPlatform(), optional)
      .then(withRecords)
      .then((result) => {
        scan = result;
        scannedKey = walked.join("\n");
        inFlight = null;
        return result;
      });
    return inFlight;
  }

  return {
    capabilities: { delete: false, insert: false, remotePaging: false, remoteSort: false },
    columns: () => Promise.resolve(libraryColumns()),
    commit(batch: GridEditBatch): Promise<CommitResult> {
      return Promise.resolve({
        cells: batch.cells.map((cell) => ({
          error: LIBRARY_READ_ONLY,
          field: cell.field,
          ok: false,
          rowKey: cell.rowKey,
        })),
        deletes: batch.deletes.map((row) => ({
          error: LIBRARY_READ_ONLY,
          ok: false,
          rowKey: row.rowKey,
        })),
        inserts: batch.inserts.map((row) => ({
          error: LIBRARY_READ_ONLY,
          ok: false,
          tempKey: row.tempKey,
        })),
      });
    },
    failures: () => scan?.failures ?? [],
    files: () => scan?.files ?? [],
    id: workspaceHomeTabId("content"),
    label: "Content",
    async refresh() {
      scan = null;
      inFlight = null;
      await ensureScan();
    },
    async rows(): Promise<GridRowsResult> {
      const result = await ensureScan();
      return { rows: result.files.map((file) => libraryRow(file)), total: result.files.length };
    },
    scanned: () => scan !== null,
    stale: () => scan !== null && scannedKey !== projectDirs().join("\n"),
  };
}
