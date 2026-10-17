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
  entryDay,
  entryStem,
  imageFieldPath,
  invalidateEntrySummaries,
  onEntrySummariesRead,
  peekEntrySummaries,
  summarize,
} = await import("../src/content/entry-summaries");

const POSTS = {
  format: "markdown",
  schema: { properties: { draft: { type: "boolean" }, title: { type: "string" } } },
  source: "./content/posts",
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
  resetStudioState({ projectConfig: { content: { notes: {}, posts: POSTS } } });
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

describe("an entry's date", () => {
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
