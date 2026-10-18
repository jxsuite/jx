/**
 * Tests for src/content/entry-summaries.ts — what the Collections panel says about each entry while
 * one is being written: title, status, thumbnail (studio.md §22.5).
 */
import { flush, installMockPlatform, resetStudioState } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";

/* A Markdown entry's fields are its frontmatter, through the format pipeline: the double is the
   parse it would do, keyed by the text so each fixture says what it holds. */
void mock.module("../src/files/file-ops.js", () => ({
  parseSourceForPath: (_path: string, source: string) => {
    if (source === "unparseable") {
      return Promise.reject(new Error("no format"));
    }
    return Promise.resolve({ document: { tagName: "div" }, frontmatter: JSON.parse(source) });
  },
}));

const {
  SUMMARY_READ_LIMIT,
  dateFieldOf,
  declaredDateField,
  entryThumb,
  entryDay,
  fieldText,
  titleFieldOf,
  entryStem,
  imageFieldPath,
  invalidateEntrySummaries,
  onEntrySummariesRead,
  noteEntrySaved,
  noteSavedEntry,
  peekEntrySummaries,
  summarize,
} = await import("../src/content/entry-summaries");

const POSTS = {
  format: "markdown",
  schema: { properties: { draft: { type: "boolean" }, title: { type: "string" } } },
  source: "./content/posts",
};

/** A collection with no `title`: what a menu item is called is its `name`. */
const MENU = {
  format: "markdown",
  schema: {
    properties: {
      course: { type: "string" },
      image: { format: "image", type: "string" },
      name: { type: "string" },
      order: { type: "number" },
    },
  },
  source: "./content/menu",
};

let reads: string[] = [];

beforeEach(() => {
  reads = [];
  invalidateEntrySummaries();
  installMockPlatform({
    readFile: (path: string) => {
      reads.push(path);
      const files = {
        "content/posts/a.md": JSON.stringify({ cover: "./images/a.jpg", title: "Hello world" }),
        "content/posts/b.md": JSON.stringify({ draft: true, title: "  " }),
        "content/posts/c.json": JSON.stringify({ title: "From JSON" }),
        "content/posts/d.json": "[1, 2]",
        "content/posts/e.md": "unparseable",
      };
      const text = Object.entries(files).find(([name]) => name === path)?.[1];
      return text === undefined ? Promise.reject(new Error(path)) : Promise.resolve(text);
    },
  });
  resetStudioState({ projectConfig: { content: { menu: MENU, notes: {}, posts: POSTS } } });
});

describe("the small derivations", () => {
  test("an entry's stem is its file name without the extension", () => {
    expect(entryStem("content/posts/spring-planting.md")).toBe("spring-planting");
    expect(entryStem("README")).toBe("README");
  });

  test("an image field resolves the way the entry's own page resolves it", () => {
    expect(imageFieldPath("content/posts/a.md", "/media/hero.jpg")).toBe("public/media/hero.jpg");
    expect(imageFieldPath("content/posts/a.md", "./images/a.jpg")).toBe(
      "content/posts/images/a.jpg",
    );
    expect(imageFieldPath("content/posts/a.md", "../shared/b.png")).toBe("content/shared/b.png");
    expect(imageFieldPath("a.md", "c.png")).toBe("c.png");
  });
});

describe("what an entry is called, and what its fields say", () => {
  test("the title field is `title`, else a conventional name the schema or the entry has", () => {
    expect(titleFieldOf({ properties: { name: {}, title: {} } })).toBe("title");
    expect(titleFieldOf({ properties: { course: {}, name: {} } })).toBe("name");
    expect(titleFieldOf(null, { label: "Hi" })).toBe("label");
    // A CSV header's `Title` is the title, and the key is answered as the record spells it.
    expect(titleFieldOf({ properties: { Title: {}, sku: {} } })).toBe("Title");
    expect(titleFieldOf(null, { Name: "Ex", sku: "x" })).toBe("Name");
    expect(titleFieldOf(null, { label: 3 })).toBeNull();
    expect(titleFieldOf({})).toBeNull();
  });

  test("a field's text is its scalar, a list of scalars joined, a date as its day", () => {
    expect(fieldText("Desserts")).toBe("Desserts");
    expect(fieldText(2)).toBe("2");
    expect(fieldText(false)).toBe("false");
    expect(fieldText(["a", 1, { x: 1 }])).toBe("a, 1");
    expect(fieldText(new Date("2026-03-04T00:00:00Z"))).toBe("2026-03-04");
    expect(fieldText({ x: 1 })).toBe("");
    expect(fieldText(null)).toBe("");
  });

  test("a menu item is titled by its name and carries its declared fields", () => {
    const summary = summarize("content/menu/tiramisu.md", "menu", {
      course: "Desserts",
      extra: "not declared",
      name: "Espresso Tiramisu",
      order: 2,
    });
    expect(summary.title).toBe("Espresso Tiramisu");
    expect(summary.fields).toEqual({ course: "Desserts", name: "Espresso Tiramisu", order: "2" });
  });
});

describe("summarize", () => {
  test("titles an entry by its title, and by its file when the title is blank", () => {
    const titles = [
      summarize("content/posts/a.md", "posts", { title: "Hello" }).title,
      summarize("content/posts/b.md", "posts", { title: " " }).title,
    ];
    expect(titles).toEqual(["Hello", "b"]);
  });

  test("a collection with a draft workflow says Draft or Published; one without says nothing", () => {
    expect(summarize("content/posts/a.md", "posts", { draft: true }).status).toBe("Draft");
    expect(summarize("content/posts/a.md", "posts", {}).status).toBe("Published");
    expect(summarize("content/notes/a.md", "notes", {}).status).toBe("");
  });

  test("the thumbnail is the first image field, and never a URL or a non-image", () => {
    expect(summarize("content/posts/a.md", "posts", { cover: "./img/a.png" }).thumb).toContain(
      "content/posts/img/a.png",
    );
    expect(
      summarize("content/posts/a.md", "posts", {
        link: "https://example.com/a.png",
        pdf: "./a.pdf",
      }).thumb,
    ).toBe("");
  });
});

describe("an entry's picture", () => {
  const schema = {
    properties: {
      cover: { format: "image", type: "string" },
      featuredImage: {
        properties: { alt: { type: "string" }, src: { type: "string" } },
        type: "object",
      },
      gallery: { items: { format: "image", type: "string" }, type: "array" },
      logo: { type: "string" },
    },
  };

  test("is the field its schema declares a picture, before any other image path", () => {
    expect(
      entryThumb("content/posts/a.md", { cover: "./c.jpg", logo: "./l.png" }, schema),
    ).toContain("content/posts/c.jpg");
    // An image object is pictured by its `src`; a remote picture is shown as it is.
    expect(
      entryThumb("content/posts/a.md", { featuredImage: { src: "https://cdn.x/f.jpg" } }, schema),
    ).toBe("https://cdn.x/f.jpg");
    // A gallery by its first picture, whether a list or a CSV cell of comma-separated URLs.
    expect(entryThumb("c.csv", { gallery: ["https://x/1.jpg", "https://x/2.jpg"] }, schema)).toBe(
      "https://x/1.jpg",
    );
    expect(entryThumb("c.csv", { gallery: "https://x/1.jpg, https://x/2.jpg" }, schema)).toBe(
      "https://x/1.jpg",
    );
  });

  test("falls back to the first image path, and is none when nothing holds a picture", () => {
    expect(entryThumb("content/posts/a.md", { logo: "./l.png" }, schema)).toContain(
      "content/posts/l.png",
    );
    expect(entryThumb("content/posts/a.md", { cover: " ", gallery: [] }, schema)).toBe("");
    expect(entryThumb("content/posts/a.md", { featuredImage: { alt: "x" } }, schema)).toBe("");
    expect(entryThumb("content/posts/a.md", { cover: 3 }, null)).toBe("");
  });
});

describe("an entry's date", () => {
  test("a schema declares its date field by format, else by a conventional name", () => {
    expect(declaredDateField({ properties: { date: { type: "string" } } })).toBe("date");
    expect(declaredDateField({ properties: { at: { format: "date-time" } } })).toBe("at");
    expect(declaredDateField({ properties: { title: { type: "string" } } })).toBeNull();
    expect(declaredDateField(null)).toBeNull();
  });

  test("is the schema's date field, else a conventionally named one, else none", () => {
    const schema = { properties: { title: { type: "string" }, when: { format: "date" } } };
    expect(dateFieldOf(schema, { when: "2026-01-02" })).toBe("when");
    expect(dateFieldOf({ properties: { at: { format: "date-time" } } }, {})).toBe("at");
    expect(dateFieldOf(null, { pubDate: "x" })).toBe("pubDate");
    expect(dateFieldOf({}, { title: "x" })).toBeNull();
  });

  test("is a calendar day as written, never shifted by a time zone", () => {
    expect(entryDay("2026-03-04T23:30:00-08:00")).toBe("2026-03-04");
    expect(entryDay(" 2026-03-04 ")).toBe("2026-03-04");
    expect(entryDay("March 4, 2026 12:00 UTC")).toBe("2026-03-04");
    // A day with no time of day is the day it names, in every time zone.
    expect(entryDay("6/3/2026")).toBe("2026-06-03");
    expect(entryDay("March 4, 2026")).toBe("2026-03-04");
    expect(entryDay(new Date("2026-03-04T12:00:00Z"))).toBe("2026-03-04");
    expect(entryDay(new Date("nope"))).toBe("");
    expect(entryDay("not a date")).toBe("");
    expect(entryDay("")).toBe("");
    expect(entryDay(42)).toBe("");
  });

  test("a summary carries it", () => {
    expect(summarize("content/posts/a.md", "posts", { date: "2026-05-06" }).date).toBe(
      "2026-05-06",
    );
    expect(summarize("content/posts/a.md", "posts", {}).date).toBe("");
  });
});

describe("peekEntrySummaries", () => {
  const PATHS = [
    "content/posts/a.md",
    "content/posts/b.md",
    "content/posts/c.json",
    "content/posts/d.json",
    "content/posts/e.md",
    "content/posts/gone.md",
  ];

  test("answers null while reading, tells its listeners, then answers from the cache", async () => {
    const heard: number[] = [];
    const stop = onEntrySummariesRead(() => heard.push(1));
    // A second ask while the first read is in flight starts no second read.
    const asked = [peekEntrySummaries("posts", PATHS), peekEntrySummaries("posts", PATHS)];
    expect(asked).toEqual([null, null]);
    await flush(4);
    expect(heard).toEqual([1]);
    const entries = peekEntrySummaries("posts", PATHS)!;
    expect(entries.map((entry) => [entry.title, entry.status])).toEqual([
      ["Hello world", "Published"],
      ["b", "Draft"],
      ["From JSON", "Published"],
      ["d", "Published"],
      ["e", "Published"],
      ["gone", "Published"],
    ]);
    expect(entries[0]!.thumb).not.toBe("");
    expect(reads).toHaveLength(PATHS.length);
    stop();
  });

  /* Renaming an entry and pressing Save left the old title in the Collections panel and the Table:
     nothing told the list, and a re-read could be answered from the five-second HTTP cache. A
     save restates the entry from the fields it wrote. */
  test("a saved entry is restated from its saved fields, without reading the file back", async () => {
    peekEntrySummaries("posts", PATHS);
    await flush(4);
    const heard: number[] = [];
    const stop = onEntrySummariesRead(() => heard.push(1));
    const before = reads.length;
    expect(noteSavedEntry("content/posts/a.md", { draft: true, title: "Renamed" })).toBe(true);
    expect(heard).toEqual([1]);
    expect(reads.length).toBe(before);
    const entries = peekEntrySummaries("posts", PATHS)!;
    expect([entries[0]!.title, entries[0]!.status]).toEqual(["Renamed", "Draft"]);
    expect(entries).toHaveLength(PATHS.length);
    stop();
  });

  test("a save restates nothing it has no list for: a page, another file, an unread collection", () => {
    const saved = (path: string | null) => noteSavedEntry(path, {});
    expect([saved(null), saved("pages/index.md"), saved("layouts/base.json")]).toEqual([
      false,
      false,
      false,
    ]);
    // The collection's list was never read, so there is no list to keep current.
    expect(saved("content/posts/a.md")).toBe(false);
    expect(noteEntrySaved("content/posts/zz.md", "posts", {})).toBe(false);
  });

  test("a changed list re-reads, and an invalidation forgets", async () => {
    peekEntrySummaries("posts", PATHS);
    await flush(4);
    expect(peekEntrySummaries("posts", PATHS.slice(0, 2))).toBeNull();
    await flush(4);
    expect(peekEntrySummaries("posts", PATHS.slice(0, 2))).toHaveLength(2);
    invalidateEntrySummaries();
    expect(peekEntrySummaries("posts", PATHS.slice(0, 2))).toBeNull();
  });

  test("a read that started before an invalidation does not land after it", async () => {
    peekEntrySummaries("posts", PATHS);
    invalidateEntrySummaries();
    await flush(4);
    expect(peekEntrySummaries("posts", PATHS)).toBeNull();
  });

  test("a stale read landing never forgets the read that replaced it", async () => {
    const gates: (() => void)[] = [];
    let gate: Promise<void> = Promise.resolve();
    const hold = () => {
      gate = new Promise<void>((resolve) => {
        gates.push(resolve);
      });
    };
    installMockPlatform({
      readFile: async (path: string) => {
        reads.push(path);
        await gate;
        return JSON.stringify({ title: path });
      },
    });
    hold();
    peekEntrySummaries("posts", PATHS);
    await flush(4);
    hold();
    invalidateEntrySummaries();
    peekEntrySummaries("posts", PATHS);
    await flush(4);
    expect(reads).toHaveLength(PATHS.length * 2);
    // The first read lands: it must not drop the second one's in-flight record.
    gates[0]!();
    await flush(4);
    expect(peekEntrySummaries("posts", PATHS)).toBeNull();
    await flush(4);
    expect(reads).toHaveLength(PATHS.length * 2);
    gates[1]!();
    await flush(4);
    expect(peekEntrySummaries("posts", PATHS)).toHaveLength(PATHS.length);
  });

  test("past the read limit the rest are listed by file name, unread", async () => {
    const many = Array.from(
      { length: SUMMARY_READ_LIMIT + 2 },
      (_v, i) => `content/posts/x${i}.md`,
    );
    peekEntrySummaries("posts", many);
    await flush(8);
    const entries = peekEntrySummaries("posts", many)!;
    expect(entries).toHaveLength(SUMMARY_READ_LIMIT + 2);
    expect(entries.at(-1)).toEqual({
      date: "",
      path: `content/posts/x${SUMMARY_READ_LIMIT + 1}.md`,
      status: "",
      thumb: "",
      title: `x${SUMMARY_READ_LIMIT + 1}`,
    });
    expect(reads).toHaveLength(SUMMARY_READ_LIMIT);
  });

  test("with no platform the entries are listed by file name", () => {
    globalThis.__jxPlatform = undefined;
    expect(peekEntrySummaries("posts", ["content/posts/a.md"])).toEqual([
      { date: "", path: "content/posts/a.md", status: "", thumb: "", title: "a" },
    ]);
  });
});
