/**
 * Tests for src/content/collection-pages.ts — which page each collection's entries are published
 * at, read from the pages and never stored (studio.md §22.5).
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { DirEntry } from "../src/types";

/* A Markdown page's facts come through the format pipeline; the double is the parse it would do. */
void mock.module("../src/files/file-ops.js", () => ({
  parseSourceForPath: (_path: string, source: string) => {
    if (source === "broken") {
      return Promise.reject(new Error("no format"));
    }
    return Promise.resolve({
      document: { children: [], tagName: "div" },
      frontmatter: { $layout: false, $paths: { contentType: "notes", param: "id" } },
    });
  },
}));

const {
  collectionPage,
  collectionPages,
  entryLayoutPath,
  entryUrl,
  invalidateCollectionPages,
  onCollectionPagesRead,
  pageFactsOf,
  peekCollectionPage,
  readPageFacts,
  resetCollectionPages,
} = await import("../src/content/collection-pages");

function dir(name: string, path: string): DirEntry {
  return { name, path, type: "directory" };
}
function file(name: string, path: string): DirEntry {
  return { name, path, type: "file" };
}

const TREE = {
  pages: [
    file("index.json", "pages/index.json"),
    dir("_archive", "pages/_archive"),
    dir("blog", "pages/blog"),
    dir("n", "pages/n"),
  ],
  // Private to `pages/`: it publishes nothing, so it is never a collection's page, even though `_`
  // Sorts before every lowercase directory and would otherwise win the path-order tie.
  "pages/_archive": [file("[slug].json", "pages/_archive/[slug].json")],
  "pages/blog": [file("[slug].json", "pages/blog/[slug].json")],
  "pages/n": [file("[id].md", "pages/n/[id].md"), file("[x].json", "pages/n/[x].json")],
} satisfies Record<string, DirEntry[]>;

const FILES = {
  "pages/_archive/[slug].json": JSON.stringify({
    $layout: "./layouts/old.json",
    $paths: { contentType: "posts", param: "slug" },
    tagName: "article",
  }),
  "pages/blog/[slug].json": JSON.stringify({
    $layout: "./layouts/post.json",
    $paths: { contentType: "posts", param: "slug" },
    tagName: "article",
  }),
  "pages/n/[id].md": "---\n---\n",
  // A second page over the same collection: the first in path order is the one that answers.
  "pages/n/[x].json": JSON.stringify({ $paths: { contentType: "notes" }, tagName: "div" }),
};

let lists = 0;

beforeEach(() => {
  lists = 0;
  installMockPlatform(
    {
      listDirectory: (path: string) => {
        lists += 1;
        const entries = Object.entries(TREE).find(([dirPath]) => dirPath === path)?.[1];
        return entries ? Promise.resolve(entries) : Promise.reject(new Error(path));
      },
    },
    FILES,
  );
  resetStudioState({ projectConfig: { defaults: { layout: "./layouts/base.json" } } });
  resetCollectionPages();
});

describe("pageFactsOf", () => {
  test("reads the collection and parameter from $paths, and the layout from $layout", () => {
    expect(
      pageFactsOf(
        { $layout: "./layouts/a.json", $paths: { contentType: "posts", param: "slug" } },
        null,
      ),
    ).toEqual({ contentType: "posts", layout: "./layouts/a.json", param: "slug" });
  });

  test("a format page states both in its frontmatter", () => {
    expect(
      pageFactsOf(
        { tagName: "div" },
        { $layout: false, $paths: { contentType: "notes", param: "id" } },
      ),
    ).toEqual({ contentType: "notes", layout: false, param: "id" });
  });

  test("a page of its own, an enumerated $paths and an empty contentType state no collection", () => {
    expect(pageFactsOf({ tagName: "div" }, null)).toEqual({
      contentType: null,
      layout: undefined,
      param: null,
    });
    expect(pageFactsOf({ $paths: [{ slug: "a" }] }, null).contentType).toBeNull();
    expect(pageFactsOf({ $paths: { contentType: "", param: "" } }, null)).toEqual({
      contentType: null,
      layout: undefined,
      param: null,
    });
  });
});

describe("readPageFacts", () => {
  test("parses a JSON page and a format page", async () => {
    const json = await readPageFacts("pages/blog/[slug].json");
    expect(json.contentType).toBe("posts");
    expect(await readPageFacts("pages/n/[id].md")).toEqual({
      contentType: "notes",
      layout: false,
      param: "id",
    });
  });

  test("a file that cannot be read or parsed states nothing", async () => {
    expect(await readPageFacts("pages/missing.json")).toEqual({
      contentType: null,
      layout: undefined,
      param: null,
    });
    installMockPlatform({}, { "pages/x.md": "broken" });
    const broken = await readPageFacts("pages/x.md");
    expect(broken.contentType).toBeNull();
  });
});

describe("the index", () => {
  test("maps each collection to its first template page, with its URL pattern", async () => {
    const index = await collectionPages();
    expect(index.get("posts")).toEqual({
      layout: "./layouts/post.json",
      param: "slug",
      path: "pages/blog/[slug].json",
      pattern: "/blog/:slug",
    });
    expect(index.get("notes")?.path).toBe("pages/n/[id].md");
    expect(await collectionPage("gone")).toBeNull();
  });

  test("is read once until it is invalidated", async () => {
    await collectionPages();
    const after = lists;
    await collectionPages();
    expect(lists).toBe(after);
    invalidateCollectionPages();
    await collectionPages();
    expect(lists).toBeGreaterThan(after);
  });

  test("peeking starts the read, answers undefined until it lands, and tells its listeners", async () => {
    const heard: string[] = [];
    const stop = onCollectionPagesRead(() => heard.push("read"));
    expect(peekCollectionPage("posts")).toBeUndefined();
    await collectionPages();
    expect(heard).toEqual(["read"]);
    expect(peekCollectionPage("posts")?.pattern).toBe("/blog/:slug");
    expect(peekCollectionPage("gone")).toBeNull();
    stop();
    invalidateCollectionPages();
    await collectionPages();
    expect(heard).toEqual(["read"]);
  });

  test("a read that started before an invalidation does not land after it", async () => {
    const stale = collectionPages();
    invalidateCollectionPages();
    await stale;
    expect(peekCollectionPage("posts")).toBeUndefined();
  });

  test("with no project there is nothing to read", async () => {
    resetStudioState();
    // `resetStudioState` keeps a project record; a window with none is the null binding.
    const { setProjectState } = await import("../src/store");
    setProjectState(null);
    const index = await collectionPages();
    expect(index.size).toBe(0);
  });
});

describe("entryUrl", () => {
  const page = {
    layout: undefined,
    param: "slug",
    path: "pages/blog/[slug].json",
    pattern: "/blog/:slug",
  };

  test("fills the page's parameter with the entry's id", () => {
    expect(entryUrl(page, "content/posts/spring-planting.md")).toBe("/blog/spring-planting");
  });

  test("a page that names no parameter fills its first one", () => {
    expect(entryUrl({ ...page, param: null }, "content/posts/hello.md")).toBe("/blog/hello");
  });

  test("a collection with no page has no URL", () => {
    expect(entryUrl(null, "content/posts/hello.md")).toBeNull();
  });
});

describe("entryLayoutPath", () => {
  const page = { layout: "./layouts/post.json", param: "slug", path: "p", pattern: "/:slug" };

  test("the entry's own layout first, then its page's, then the project's default", () => {
    expect(entryLayoutPath("./layouts/own.json", page)).toBe("./layouts/own.json");
    expect(entryLayoutPath(undefined, page)).toBe("./layouts/post.json");
    expect(entryLayoutPath(undefined, { ...page, layout: undefined })).toBe("./layouts/base.json");
    expect(entryLayoutPath(undefined, null)).toBe("./layouts/base.json");
  });

  test("false, from the entry or its page, means no layout at all", () => {
    expect(entryLayoutPath(false, page)).toBeNull();
    expect(entryLayoutPath(undefined, { ...page, layout: false })).toBeNull();
  });

  test("with no default either there is none", () => {
    resetStudioState({ projectConfig: {} });
    expect(entryLayoutPath(undefined, null)).toBeNull();
  });
});
