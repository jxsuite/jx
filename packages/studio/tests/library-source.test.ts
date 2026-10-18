/**
 * Tests for src/browse/library-source.ts and the Library's entry in the grid tab-id space.
 *
 * Two contracts: the Library is a GridSource like any other, and it REFUSES edits rather than
 * pretending a cell can rename a file.
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  LIBRARY_READ_ONLY,
  expandFileRecords,
  createLibrarySource,
  libraryColumns,
  libraryRow,
} from "../src/browse/library-source";
import { gridTabLabel, parseGridTabId } from "../src/grid/grid-source";
import type { DirEntry } from "../src/types";

function tree() {
  return {
    pages: [
      {
        modified: "2024-02-03T00:00:00.000Z",
        name: "a.json",
        path: "pages/a.json",
        size: 10,
        type: "file",
      },
      { name: "b.json", path: "pages/b.json", type: "file" },
    ],
    public: [{ name: "logo.png", path: "public/logo.png", type: "file" }],
  } satisfies Record<string, DirEntry[]>;
}

let listed: string[];

function install(overrides: Record<string, DirEntry[]> = tree()) {
  listed = [];
  installMockPlatform({
    listDirectory: (path: string) => {
      listed.push(path);
      const entries = overrides[path];
      return entries ? Promise.resolve(entries) : Promise.reject(new Error(`ENOENT: ${path}`));
    },
  });
}

beforeEach(() => {
  install();
  resetStudioState({ projectConfig: null, projectDirs: ["pages", "public"] });
});

describe("the id", () => {
  test("is the Content home's tab id, and no grid id names a Library any more", () => {
    expect(createLibrarySource().id).toBe("workspace://content");
    expect(parseGridTabId("grid://library")).toBeNull();
    expect(gridTabLabel("grid://library")).toBeNull();
  });

  test("a collection named 'library' is still a collection", () => {
    expect(parseGridTabId("grid://collection/library")).toEqual({
      kind: "collection",
      name: "library",
    });
  });
});

describe("columns and rows", () => {
  test("every column is read-only, and a page's URL is its key", () => {
    const columns = libraryColumns();
    expect(columns.every((c) => !c.editable)).toBe(true);
    expect(columns.filter((c) => c.pk).map((c) => c.field)).toEqual(["url"]);
  });

  /* The Content-Pages board: a page is listed by what it is called and where it is published, not
     by a file name two of them share (`index.json`), and never by its path. */
  test("Pages read Title, URL, Template and Edited, with Status and Language only when they apply", () => {
    expect(libraryColumns().map((c) => [c.field, c.title])).toEqual([
      ["title", "Title"],
      ["url", "URL"],
      ["template", "Template"],
      ["modified", "Edited"],
    ]);
    expect(
      libraryColumns(undefined, { date: false, locale: true, status: true }).map((c) => c.field),
    ).toEqual(["title", "url", "template", "status", "locale", "modified"]);
  });

  test("a row carries nulls where the platform reported nothing, never invented values", () => {
    const row = libraryRow({
      collection: "pages",
      ext: ".json",
      media: false,
      name: "b.json",
      path: "pages/b.json",
      type: ".json",
    });
    expect(row.key).toBe("pages/b.json");
    expect(row.cells.url).toBe("/b");
    expect(row.cells.modified).toBeNull();
    expect(row.cells.locale).toBeNull();
  });

  /*
   * A GridColumn lives in three places no type connects: `libraryColumns`, this cell bag, and
   * `library-layouts.ts`'s `cellText`. The pane draws from the third and the GridSource contract
   * needs the second, so a column declared in one alone is a header over nothing — with no type
   * error and, without this pair of assertions, no failing test either.
   */
  test("every declared column has a cell in the row the GridSource hands back", () => {
    const row = libraryRow({
      collection: "pages",
      ext: ".json",
      media: false,
      locale: "fr",
      name: "b.json",
      path: "pages/fr/b.json",
      type: ".json",
    });
    expect(Object.keys(row.cells).toSorted()).toEqual(
      libraryColumns(undefined, { date: false, locale: true, status: true })
        .map((c) => c.field)
        .toSorted(),
    );
    expect(row.cells.locale).toBe("fr");
  });
});

describe("createLibrarySource", () => {
  test("scans lazily — nothing is read until rows() is asked for", async () => {
    const source = createLibrarySource();
    expect(listed).toEqual([]);
    expect(source.scanned()).toBe(false);
    const result = await source.rows();
    expect(result.total).toBe(3);
    expect(source.scanned()).toBe(true);
  });

  test("coalesces concurrent first reads into ONE walk of the project", async () => {
    const source = createLibrarySource();
    await Promise.all([source.rows(), source.rows(), source.rows()]);
    expect(listed).toEqual(["pages", "public"]);
  });

  test("serves the cached scan on a second read", async () => {
    const source = createLibrarySource();
    await source.rows();
    await source.rows();
    expect(listed).toEqual(["pages", "public"]);
  });

  test("refresh discards the scan and reads again", async () => {
    const source = createLibrarySource();
    await source.rows();
    await source.refresh!();
    expect(listed).toEqual(["pages", "public", "pages", "public"]);
  });

  /* A window restored into Content asks for rows before the project's directories have loaded, and
     the walk of none is an answer of none. That answer is stale the moment the list arrives. */
  test("a scan of a directory list the project has since outgrown is stale", async () => {
    resetStudioState({ projectConfig: null, projectDirs: [] });
    const source = createLibrarySource();
    expect(source.stale()).toBe(false);
    await source.rows();
    expect([source.files().length, source.stale()]).toEqual([0, false]);
    resetStudioState({ projectConfig: null, projectDirs: ["pages", "public"] });
    expect(source.stale()).toBe(true);
    await source.refresh!();
    expect([source.files().length, source.stale()]).toEqual([3, false]);
  });

  test("walks a declared collection outside the project's list, and its absence is no failure", async () => {
    install({ ...tree(), "../../docs": [{ name: "a.md", path: "../../docs/a.md", type: "file" }] });
    resetStudioState({
      projectConfig: {
        content: { docs: { source: "../../docs" }, posts: { source: "./content/posts" } },
      },
      projectDirs: ["pages"],
    });
    const source = createLibrarySource();
    await source.rows();
    expect(listed).toEqual(["pages", "../../docs", "content/posts"]);
    expect(source.files().map((f) => [f.path, f.collection])).toContainEqual([
      "../../docs/a.md",
      "docs",
    ]);
    expect(source.failures()).toEqual([]);
  });

  test("exposes the failures the scan collected, so an incomplete list can say so", async () => {
    const source = createLibrarySource(() => ["pages", "gone"]);
    await source.rows();
    expect(source.failures().map((f) => f.dir)).toEqual(["gone"]);
    expect(source.files().length).toBe(2);
  });

  test("files() is empty — not undefined — before the first scan", () => {
    const source = createLibrarySource();
    expect(source.files()).toEqual([]);
    expect(source.failures()).toEqual([]);
  });

  test("reads the project's own directories when none are injected", async () => {
    const source = createLibrarySource();
    await source.rows();
    expect(listed).toEqual(["pages", "public"]);
  });

  test("declares itself read-only and refuses every kind of edit, naming where to go", async () => {
    const source = createLibrarySource();
    expect(source.capabilities).toEqual({
      delete: false,
      insert: false,
      remotePaging: false,
      remoteSort: false,
    });
    const result = await source.commit({
      cells: [{ baseline: "a", field: "name", rowKey: "pages/a.json", value: "b" }],
      deletes: [{ rowKey: "pages/b.json" }],
      inserts: [{ cells: {}, tempKey: "t1" }],
    });
    expect(result.cells[0]).toEqual({
      error: LIBRARY_READ_ONLY,
      field: "name",
      ok: false,
      rowKey: "pages/a.json",
    });
    expect(result.deletes[0]!.ok).toBe(false);
    expect(result.inserts[0]!.ok).toBe(false);
    // The refusal points the author at where those edits DO live.
    expect(LIBRARY_READ_ONLY).toBe(
      "The Content workspace lists files; it does not edit them in the list. Rename, duplicate or " +
        "delete from the file's context menu, or open the file to edit it.",
    );
  });

  test("columns() answers the table's own column set", async () => {
    const source = createLibrarySource();
    const columns = await source.columns();
    expect(columns.map((c) => c.field)).toEqual(["title", "url", "template", "modified"]);
    // A collection leads with what an entry says about itself, and keeps its file (the Path) after.
    expect(libraryColumns("posts").map((c) => c.field)).toEqual([
      "title",
      "locale",
      "modified",
      "path",
    ]);
    expect(
      libraryColumns("posts", {
        date: true,
        fields: [{ name: "course", title: "Course" }],
        status: true,
      }).map((c) => c.field),
    ).toEqual(["title", "status", "date", "field:course", "locale", "modified", "path"]);
    expect(source.label).toBe("Content");
  });

  test("with no project open it scans nothing and reports nothing", async () => {
    resetStudioState({ projectConfig: null });
    const source = createLibrarySource();
    const result = await source.rows();
    expect(result).toEqual({ rows: [], total: 0 });
  });
});

describe("a file-backed collection", () => {
  const CSV = "Title,sku\nTilt Trailer,tilt\nMini Trencher,trencher\n";

  function installPricing(files: Record<string, string>) {
    installMockPlatform(
      {
        listDirectory: (path: string) =>
          path === "content"
            ? Promise.resolve([{ name: "pricing", path: "content/pricing", type: "directory" }])
            : path === "content/pricing"
              ? Promise.resolve([
                  { name: "prices.csv", path: "content/pricing/prices.csv", type: "file" },
                ])
              : Promise.reject(new Error(`ENOENT: ${path}`)),
      },
      files,
    );
    resetStudioState({
      projectConfig: {
        content: { pricing: { format: "Csv", source: "./content/pricing/prices.csv" } },
      },
      projectDirs: ["content"],
    });
  }

  test("is listed as its records, each keyed by its place in the file it opens", async () => {
    installPricing({ "content/pricing/prices.csv": CSV });
    const source = createLibrarySource();
    await source.rows();
    const records = source.files().filter((file) => file.collection === "pricing");
    expect(records.map((file) => [file.path, file.name, file.record?.source])).toEqual([
      ["content/pricing/prices.csv#1", "Tilt Trailer", "content/pricing/prices.csv"],
      ["content/pricing/prices.csv#2", "Mini Trencher", "content/pricing/prices.csv"],
    ]);
    expect(records[1]?.record?.fields).toEqual({ Title: "Mini Trencher", sku: "trencher" });
  });

  test("a file that cannot be read stays listed as the file it is", async () => {
    installPricing({});
    const source = createLibrarySource();
    await source.rows();
    expect(source.files().map((file) => file.path)).toEqual(["content/pricing/prices.csv"]);
  });

  test("a collection file whose kind holds no records is the file it is", async () => {
    const file = {
      collection: "notes",
      ext: ".yaml",
      media: false,
      name: "notes.yaml",
      path: "content/notes.yaml",
      type: ".yaml",
    };
    resetStudioState({
      projectConfig: { content: { notes: { source: "./content/notes.yaml" } } },
    });
    expect(await expandFileRecords([file], () => Promise.resolve("- a"))).toEqual([file]);
  });
});
