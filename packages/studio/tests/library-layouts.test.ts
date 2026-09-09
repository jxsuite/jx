/**
 * Tests for src/browse/library-layouts.ts — the geometry and the projections behind five layouts.
 *
 * The markup moved to `surfaces/library-pane.json` and the assertions moved with it: what is left
 * here is what a document cannot express. Two properties matter beyond "it projects": the grouped
 * layouts CAP what they draw and SAY what they left out (a silently truncated list is the same lie
 * as "No files found"), and the geometry table is the single place the window's row height comes
 * from.
 */
import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import {
  BOARD_COLUMN_LIMIT,
  CALENDAR_DAY_LIMIT,
  LAYOUT_METRICS,
  boardView,
  calendarView,
  cellText,
  cellTextOf,
  columnsAt,
  formatModified,
  formatSize,
  libraryRow,
} from "../src/browse/library-layouts";
import { LIBRARY_LAYOUTS } from "../src/browse/library-model";
import { libraryColumns } from "../src/browse/library-source";
import type { LibraryFile } from "../src/browse/library-model";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function page(index: number): LibraryFile {
  return {
    category: "Pages",
    ext: ".json",
    modified: "2024-06-07T00:00:00.000Z",
    name: `page-${index}.json`,
    path: `pages/page-${index}.json`,
    size: 1024,
    type: ".json",
  };
}

const IMAGE: LibraryFile = {
  category: "Media",
  ext: ".png",
  name: "logo.png",
  path: "public/logo.png",
  type: ".png",
};

const SCRIPT: LibraryFile = {
  category: "Other",
  ext: ".sh",
  name: "deploy.sh",
  path: "bin/deploy.sh",
  type: ".sh",
};

// ─── Geometry ────────────────────────────────────────────────────────────────

describe("geometry", () => {
  test("every layout declares a metric, and only the flat ones window", () => {
    for (const layout of LIBRARY_LAYOUTS) {
      expect(LAYOUT_METRICS[layout]).toBeDefined();
    }
    const windowed = LIBRARY_LAYOUTS.filter((l) => LAYOUT_METRICS[l].windowed);
    expect(windowed.toSorted()).toEqual(["cards", "media", "table"]);
  });

  test("columnsAt divides the width by the item width, and never returns zero", () => {
    expect(columnsAt("cards", 1000)).toBe(5);
    expect(columnsAt("cards", 10)).toBe(1);
    expect(columnsAt("table", 1000)).toBe(1);
    expect(columnsAt("cards", 0)).toBe(1);
  });
});

// ─── Cell text ───────────────────────────────────────────────────────────────

describe("cell text", () => {
  test("sizes scale, and an unreported size is blank rather than 0 B", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(20_480)).toBe("20 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
    const noSize: number | undefined = undefined;
    expect(formatSize(noSize)).toBe("");
    expect(formatSize(Number.NaN)).toBe("");
  });

  test("a modification time is a date, and a bad one is blank rather than Invalid Date", () => {
    expect(formatModified("2024-06-07T13:00:00.000Z")).toBe("2024-06-07");
    expect(formatModified("nonsense")).toBe("");
    const noDate: string | undefined = undefined;
    expect(formatModified(noDate)).toBe("");
  });

  test("every declared column has cell text, and an unknown field is empty", () => {
    const file = page(1);
    for (const column of libraryColumns()) {
      expect(typeof cellText(file, column.field)).toBe("string");
    }
    expect(cellText(file, "name")).toBe("page-1.json");
    expect(cellText(file, "category")).toBe("Pages");
    expect(cellText(file, "type")).toBe(".json");
    expect(cellText(file, "path")).toBe("pages/page-1.json");
    expect(cellText(file, "invented")).toBe("");
  });

  /*
   * The assertion above passes for a column `cellText` has no `case` for: `default:` returns "",
   * which is still a string. A file with every field populated must therefore produce text for
   * every column `libraryColumns()` declares — that is the shape that catches a header over blanks.
   */
  test("a fully-populated file has NON-EMPTY text in every declared column", () => {
    const file: LibraryFile = { ...page(1), locale: "fr", path: "pages/fr/page-1.json" };
    for (const column of libraryColumns()) {
      expect([column.field, cellText(file, column.field)]).not.toEqual([column.field, ""]);
    }
  });

  test("the locale column shows the language's own name, and nothing where there is none", () => {
    expect(cellText({ ...page(1), locale: "fr" }, "locale")).toBe("français");
    expect(cellText({ ...page(1), locale: "fr-CA" }, "locale")).toBe("français canadien");
    expect(cellText(page(1), "locale")).toBe("");
  });

  test("a raw grid cell prints as text, and null prints as nothing", () => {
    expect(cellTextOf(null)).toBe("");
    expect(cellTextOf(42)).toBe("42");
    expect(cellTextOf("x")).toBe("x");
  });
});

// ─── Rows ────────────────────────────────────────────────────────────────────

describe("a row", () => {
  test("an image is the image itself, whether or not the layout draws live previews", () => {
    for (const live of [true, false]) {
      const row = libraryRow(IMAGE, [], live);
      expect(row.art).toBe("image");
      expect(row.src).not.toBe("");
    }
  });

  test("a previewable document claims the island only where the layout draws one", () => {
    // Cards may; a Media tile is a thumbnail of an asset, and a live runtime render inside one is
    // The whole cost that layout exists to avoid.
    expect(libraryRow(page(1), [], true).art).toBe("doc");
    expect(libraryRow(page(1), [], false).art).toBe("glyph");
  });

  test("a file nothing can preview gets a glyph rather than an empty box", () => {
    expect(libraryRow(SCRIPT, [], true).art).toBe("glyph");
    expect(libraryRow(SCRIPT, [], true).src).toBe("");
  });

  test("its cells are the SOURCE's columns, in order, not a second hand-written list", () => {
    const columns = libraryColumns();
    const row = libraryRow({ ...page(1), locale: "fr" }, columns, true);
    expect(row.cells.map((cell) => cell.field)).toEqual(columns.map((c) => c.field));
    expect(row.cells.find((cell) => cell.field === "name")?.text).toBe("page-1.json");
    expect(row.cells.find((cell) => cell.field === "locale")?.text).toBe("français");
  });

  test("a layout with no cells asks for none, so a card costs no table text", () => {
    expect(libraryRow(page(1), [], true).cells).toEqual([]);
  });
});

// ─── Calendar ────────────────────────────────────────────────────────────────

describe("Calendar", () => {
  function dated(date: string, index: number): LibraryFile {
    return { ...page(index), name: `${date}-post-${index}.md` };
  }

  test("groups by day, newest first", () => {
    const { groups } = calendarView([dated("2024-01-01", 1), dated("2024-05-05", 2)]);
    expect(groups.map((g) => g.title)).toEqual(["2024-05-05", "2024-01-01"]);
    expect(groups[0]!.files.map((f) => f.name)).toEqual(["2024-05-05-post-2.md"]);
  });

  test("caps the days it draws and STATES how many it did not", () => {
    const files = Array.from({ length: CALENDAR_DAY_LIMIT + 5 }, (_v, i) =>
      dated(
        `20${String(10 + Math.floor(i / 12)).padStart(2, "0")}-01-${String((i % 12) + 1).padStart(2, "0")}`,
        i,
      ),
    );
    const { groups, truncated } = calendarView(files);
    expect(groups.filter((g) => g.undated === "false")).toHaveLength(CALENDAR_DAY_LIMIT);
    expect(truncated).toContain("5 older");
  });

  test("undated files are set apart and counted, never parked on today", () => {
    const { groups } = calendarView([dated("2024-01-01", 1), { ...SCRIPT }]);
    const section = groups.at(-1)!;
    expect(section.title).toBe("No date");
    expect(section.undated).toBe("true");
    expect(section.noteState).toBe("shown");
    expect(section.note).toContain("1 file");
  });

  test("the undated section's id can never collide with a day's", () => {
    // The id is what keeps a section's node across a repaint, and `groupByDate` can produce a day
    // Called anything of the form YYYY-MM-DD, and never a pair of underscores.
    const { groups } = calendarView([{ ...SCRIPT }]);
    expect(groups.map((g) => g.id)).toEqual(["__undated"]);
  });

  test("with no undated file there is no undated section and nothing truncated", () => {
    const { groups, truncated } = calendarView([dated("2024-01-01", 1)]);
    expect(groups.every((g) => g.undated === "false")).toBe(true);
    expect(truncated).toBe("");
  });
});

// ─── Board ───────────────────────────────────────────────────────────────────

describe("Board", () => {
  test("one column per category, each printing its own total", () => {
    const groups = boardView([page(1), page(2), IMAGE]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.title).toBe("Pages");
    expect(groups[0]!.count).toBe("2");
  });

  test("caps a column and states the remainder rather than truncating in silence", () => {
    const groups = boardView(Array.from({ length: BOARD_COLUMN_LIMIT + 3 }, (_v, i) => page(i)));
    expect(groups[0]!.files).toHaveLength(BOARD_COLUMN_LIMIT);
    // The count is the honest TOTAL, not what the column drew.
    expect(groups[0]!.count).toBe(String(BOARD_COLUMN_LIMIT + 3));
    expect(groups[0]!.noteState).toBe("shown");
    expect(groups[0]!.note).toContain("3 more");
  });

  test("a column that fits says nothing about what it left out", () => {
    const groups = boardView([page(1)]);
    expect(groups[0]!.noteState).toBe("hidden");
    expect(groups[0]!.note).toBe("");
  });

  test("a grouped item is text only — no live render, however many files it groups", () => {
    const groups = boardView([page(1), IMAGE]);
    for (const group of groups) {
      for (const file of group.files) {
        expect(file.art).toBe("glyph");
        expect(file.cells).toEqual([]);
      }
    }
  });
});
