/**
 * Tests for src/content/page-summaries.ts — what the Content workspace's Pages table says about
 * each page beyond its file: its template, the collection it expands over, and its draft flag.
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";

/* A Markdown page's facts come through the format pipeline; the double is the parse it would do. */
void mock.module("../src/files/file-ops.js", () => ({
  parseSourceForPath: (_path: string, source: string) => {
    if (source === "broken") {
      return Promise.reject(new Error("no format"));
    }
    return Promise.resolve({
      document: { children: [], tagName: "div" },
      frontmatter: { $layout: false, draft: true },
    });
  },
}));

const {
  PAGE_READ_LIMIT,
  invalidatePageSummaries,
  onPageSummariesRead,
  pageSummaryOf,
  peekPageSummaries,
} = await import("../src/content/page-summaries");

const FILES = {
  "pages/blog/[slug].json": JSON.stringify({
    $layout: "./layouts/post.json",
    $paths: { contentType: "posts", param: "slug" },
    tagName: "div",
  }),
  "pages/broken.md": "broken",
  "pages/index.json": '{"tagName":"div"}',
  "pages/list.json": "[1, 2]",
  "pages/notes.md": "---\ndraft: true\n---\n",
};

/** Let the reads the peek started land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

beforeEach(() => {
  installMockPlatform({}, FILES);
  resetStudioState({ projectConfig: null });
  invalidatePageSummaries();
});

describe("pageSummaryOf", () => {
  test("reads the layout, the collection and the draft flag off a page", () => {
    expect(
      pageSummaryOf(
        "pages/blog/[slug].json",
        { $layout: "./layouts/post.json", $paths: { contentType: "posts" }, tagName: "div" },
        null,
      ),
    ).toEqual({
      contentType: "posts",
      draft: false,
      layout: "./layouts/post.json",
      path: "pages/blog/[slug].json",
    });
    expect(pageSummaryOf("pages/a.md", null, { $layout: false, draft: true })).toEqual({
      contentType: null,
      draft: true,
      layout: false,
      path: "pages/a.md",
    });
    // Only the literal `true` is a draft.
    expect(pageSummaryOf("pages/b.json", { draft: "yes", tagName: "div" }, null).draft).toBe(false);
  });
});

describe("peekPageSummaries", () => {
  test("answers null while reading, then the summaries, and tells its listeners", async () => {
    let told = 0;
    const stop = onPageSummariesRead(() => {
      told += 1;
    });
    const paths = [...Object.keys(FILES), "pages/gone.json"];
    const first = peekPageSummaries(paths);
    // A second ask while the read is in flight starts no second read.
    const second = peekPageSummaries(paths);
    expect([first, second]).toEqual([null, null]);
    await settle();
    const read = peekPageSummaries(paths)!;
    expect(told).toBe(1);
    expect(read.get("pages/blog/[slug].json")).toMatchObject({
      contentType: "posts",
      layout: "./layouts/post.json",
    });
    expect(read.get("pages/notes.md")).toMatchObject({ draft: true, layout: false });
    // A page that cannot be read or parsed, or is not an object, states nothing.
    const nothing = (path: string) => ({
      contentType: null,
      draft: false,
      layout: undefined,
      path,
    });
    const silent = ["pages/broken.md", "pages/list.json", "pages/gone.json"];
    expect(silent.map((path) => read.get(path))).toEqual(silent.map((path) => nothing(path)));
    stop();
  });

  test("a changed list re-reads, and an invalidation drops a read still in flight", async () => {
    let told = 0;
    const stop = onPageSummariesRead(() => {
      told += 1;
    });
    expect(peekPageSummaries(["pages/index.json"])).toBeNull();
    invalidatePageSummaries();
    await settle();
    // The read that started before the invalidation does not land.
    expect(told).toBe(0);
    expect(peekPageSummaries(["pages/index.json"])).toBeNull();
    await settle();
    expect(
      peekPageSummaries(["pages/index.json"])?.get("pages/index.json")?.layout,
    ).toBeUndefined();
    expect(peekPageSummaries(["pages/index.json", "pages/list.json"])).toBeNull();
    stop();
  });

  test("reads at most the limit; the rest are listed by route alone", async () => {
    const paths = Array.from({ length: PAGE_READ_LIMIT + 2 }, (_, i) => `pages/p${i}.json`);
    const platform = installMockPlatform({}, {});
    peekPageSummaries(paths);
    await settle();
    const reads = platform.state.calls.filter(([name]) => name === "readFile");
    expect(reads).toHaveLength(PAGE_READ_LIMIT);
    expect(peekPageSummaries(paths)?.size).toBe(PAGE_READ_LIMIT);
  });

  test("with no platform there is nothing to read, and every page states nothing", () => {
    const saved = globalThis.__jxPlatform;
    globalThis.__jxPlatform = undefined;
    try {
      expect(peekPageSummaries(["pages/a.json"])?.get("pages/a.json")).toEqual({
        contentType: null,
        draft: false,
        layout: undefined,
        path: "pages/a.json",
      });
    } finally {
      globalThis.__jxPlatform = saved;
    }
  });
});
