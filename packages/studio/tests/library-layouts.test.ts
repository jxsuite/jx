/**
 * Tests for src/browse/library-layouts.ts — the geometry and the projections behind four views.
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
  boardFieldOf,
  boardView,
  calendarView,
  cellText,
  cellTextOf,
  columnsAt,
  entryFactsFrom,
  formatModified,
  formatSize,
  libraryRow,
} from "../src/browse/library-layouts";
import { LIBRARY_LAYOUTS } from "../src/browse/library-model";
import {
  entryFieldColumns,
  entryFieldOfKey,
  fieldTitle,
  libraryColumns,
} from "../src/browse/library-source";
import type { LibraryFile } from "../src/browse/library-model";
import type { EntryFacts } from "../src/browse/library-layouts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function page(index: number): LibraryFile {
  return {
    collection: "pages",
    ext: ".json",
    media: false,
    modified: "2024-06-07T00:00:00.000Z",
    name: `page-${index}.json`,
    path: `pages/page-${index}.json`,
    size: 1024,
    type: ".json",
  };
}

const IMAGE: LibraryFile = {
  collection: null,
  ext: ".png",
  media: true,
  name: "logo.png",
  path: "public/logo.png",
  type: ".png",
};

const SCRIPT: LibraryFile = {
  collection: null,
  ext: ".sh",
  media: false,
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
    expect(windowed.toSorted()).toEqual(["cards", "table"]);
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
    /* Every field of this one is filled, so a declared column that fell through to the default
       case would read as "" here, the same as an unknown field. */
    const filled: LibraryFile = { ...file, locale: "fr" };
    for (const column of libraryColumns()) {
      expect(cellText(filled, column.field), column.field).not.toBe("");
    }
    expect(cellText(file, "name")).toBe("page-1.json");
    expect(cellText(file, "url")).toBe("/page-1");
    expect(cellText(IMAGE, "url")).toBe("");
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
    // Cards may; Table draws text, and a live runtime render inside a row is a cost it never pays.
    expect(libraryRow(page(1), [], true).art).toBe("doc");
    expect(libraryRow(page(1), [], false).art).toBe("glyph");
  });

  test("a file in no collection gets a glyph rather than an empty box", () => {
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
  test("one column per folder, in path order, each printing its own total", () => {
    const groups = boardView([page(1), page(2), { ...page(3), path: "pages/blog/page-3.json" }]);
    expect(groups.map((group) => group.title)).toEqual(["pages", "pages/blog"]);
    expect(groups[0]!.count).toBe("2");
    expect(groups[1]!.count).toBe("1");
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

// ─── Entries ─────────────────────────────────────────────────────────────────

/** A post in a flat collection, as the tutorial's `content/posts/*.md` are. */
function post(slug: string): LibraryFile {
  return {
    collection: "posts",
    ext: ".md",
    media: false,
    modified: "2024-06-07T00:00:00.000Z",
    name: `${slug}.md`,
    path: `content/posts/${slug}.md`,
    type: ".md",
  };
}

const factsOf = entryFactsFrom(
  new Map<string, EntryFacts>([
    ["content/posts/a.md", { date: "2026-01-02", status: "Published", title: "Hello world" }],
    ["content/posts/b.md", { date: "", status: "Draft", title: "Winter prep" }],
    ["content/posts/c.md", { date: "2026-01-02", status: "Published", title: "Grid mode rocks" }],
  ]),
);

describe("entries say what they are", () => {
  test("a row is named by the entry's title, and its cells carry its status and date", () => {
    const columns = libraryColumns("posts", { date: true, status: true });
    const row = libraryRow(post("a"), columns, false, factsOf(post("a")));
    expect(row.name).toBe("Hello world");
    expect(row.cells.map((cell) => cell.text).slice(0, 3)).toEqual([
      "Hello world",
      "Published",
      "2026-01-02",
    ]);
    expect(row.cells.at(-1)?.text).toBe("content/posts/a.md");
  });

  test("an entry not read yet is titled by its file, with no status or date", () => {
    expect(cellText(post("x"), "title")).toBe("x.md");
    expect(cellText(post("x"), "status")).toBe("");
    expect(cellText(post("x"), "date")).toBe("");
  });

  test("Board groups a flat collection by status, the work in progress first", () => {
    const groups = boardView([post("a"), post("b"), post("c")], factsOf);
    expect(groups.map((group) => [group.title, group.count])).toEqual([
      ["Draft", "1"],
      ["Published", "2"],
    ]);
    expect(groups[1]!.files.map((file) => file.name)).toEqual(["Hello world", "Grid mode rocks"]);
  });

  test("Board orders an unknown status after the known ones, and names a missing one", () => {
    const odd = entryFactsFrom(
      new Map<string, EntryFacts>([
        ["content/posts/a.md", { date: "", status: "Archived", title: "A" }],
        ["content/posts/b.md", { date: "", status: "Draft", title: "B" }],
        ["content/posts/c.md", { date: "", status: "", title: "C" }],
        ["content/posts/d.md", { date: "", status: "Draft", title: "D" }],
      ]),
    );
    const groups = boardView([post("a"), post("b"), post("c"), post("d")], odd);
    expect(groups.map((group) => group.title)).toEqual(["Draft", "Archived", "No status"]);
  });

  test("Board with no statuses falls back to folders", () => {
    const groups = boardView([post("a"), post("b")], entryFactsFrom(new Map()));
    expect(groups.map((g) => g.title)).toEqual(["content/posts"]);
  });

  test("Calendar dates an entry by its own date field, and the file only when it has none", () => {
    const { groups } = calendarView([post("a"), post("b"), post("c")], factsOf);
    expect(groups.map((group) => [group.title, group.files.map((file) => file.name)])).toEqual([
      ["2026-01-02", ["Hello world", "Grid mode rocks"]],
      ["2024-06-07", ["Winter prep"]],
    ]);
  });
});

describe("a collection's own fields", () => {
  const MENU_FIELDS = [
    { name: "course", title: "Course" },
    { name: "price", title: "Price" },
  ];
  function dish(slug: string): LibraryFile {
    return { ...post(slug), name: `${slug}.md`, path: `content/menu/${slug}.md` };
  }
  const menuFacts = entryFactsFrom(
    new Map<string, EntryFacts>([
      [
        "content/menu/a.md",
        { date: "", fields: { course: "Mains", price: "$9" }, status: "", title: "A" },
      ],
      [
        "content/menu/b.md",
        { date: "", fields: { course: "Desserts", price: "$9" }, status: "", title: "B" },
      ],
      ["content/menu/c.md", { date: "", fields: { course: "Mains" }, status: "", title: "C" }],
      ["content/menu/d.md", { date: "", fields: {}, status: "", title: "D" }],
    ]),
  );
  const dishes = ["a", "b", "c", "d"].map((slug) => dish(slug));

  test("the Table draws every listable schema field, titled, except the ones named elsewhere", () => {
    const columns = entryFieldColumns(
      {
        properties: {
          body: { format: "markdown", type: "string" },
          course: { type: "string" },
          date: { format: "date", type: "string" },
          draft: { type: "boolean" },
          image: { format: "image", type: "string" },
          meta: { type: "object" },
          name: { type: "string" },
          pairings: { items: { type: "object" }, type: "array" },
          publishedAt: { type: "string" },
          tags: { items: { type: "string" }, type: "array" },
        },
      },
      new Set(["name", "date"]),
    );
    expect(columns).toEqual([
      { name: "course", title: "Course" },
      { name: "publishedAt", title: "Published at" },
      { name: "tags", title: "Tags" },
    ]);
    expect(entryFieldColumns(null, new Set())).toEqual([]);
    expect(fieldTitle("main_course")).toBe("Main course");
  });

  test("a field column's cell is the entry's own value, and blank until it is read", () => {
    const columns = libraryColumns("menu", { date: false, fields: MENU_FIELDS, status: false });
    expect(columns.map((column) => column.title)).toEqual([
      "Title",
      "Course",
      "Price",
      "Locale",
      "Modified",
      "Path",
    ]);
    const row = libraryRow(dish("a"), columns, false, menuFacts(dish("a")));
    expect(row.cells.map((cell) => cell.text).slice(0, 3)).toEqual(["A", "Mains", "$9"]);
    expect(cellText(dish("a"), "field:course")).toBe("");
    expect(cellText(dish("a"), "unknown")).toBe("");
    expect(entryFieldOfKey("path")).toBeNull();
  });

  test("Board groups by the first field whose values repeat, with the unset ones last", () => {
    const facts = dishes.map((file) => menuFacts(file));
    const field = boardFieldOf(MENU_FIELDS, new Map(), facts);
    expect(field).toEqual({ name: "course", order: [], title: "Course" });
    const groups = boardView(dishes, menuFacts, field);
    expect(groups.map((group) => [group.title, group.count])).toEqual([
      ["Desserts", "1"],
      ["Mains", "2"],
      ["No course", "1"],
    ]);
  });

  test("a declared enum is the field to group by, and its order is the columns' order", () => {
    const enums = new Map([["price", ["$9", "$5"]]]);
    const field = boardFieldOf(MENU_FIELDS, enums, []);
    expect(field).toEqual({ name: "price", order: ["$9", "$5"], title: "Price" });
    const groups = boardView(dishes, menuFacts, field);
    expect(groups.map((group) => group.title)).toEqual(["$9", "No price"]);
  });

  test("no field groups entries whose values are all different, so the Board keeps folders", () => {
    const unique = entryFactsFrom(
      new Map<string, EntryFacts>([
        ["content/menu/a.md", { date: "", fields: { course: "x" }, status: "", title: "A" }],
        ["content/menu/b.md", { date: "", fields: { course: "y" }, status: "", title: "B" }],
      ]),
    );
    const two = [dish("a"), dish("b")];
    expect(
      boardFieldOf(
        MENU_FIELDS,
        new Map(),
        two.map((file) => unique(file)),
      ),
    ).toBeNull();
    expect(boardView(two, unique, null).map((group) => group.title)).toEqual(["content/menu"]);
  });
});
