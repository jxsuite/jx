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
  entryLocale,
  entryUrl,
  invalidateCollectionPages,
  onCollectionPagesRead,
  pageFactsOf,
  pageForLocale,
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
    ).toEqual({ contentType: "posts", field: null, layout: "./layouts/a.json", param: "slug" });
  });

  test("a format page states both in its frontmatter", () => {
    expect(
      pageFactsOf(
        { tagName: "div" },
        { $layout: false, $paths: { contentType: "notes", param: "id" } },
      ),
    ).toEqual({ contentType: "notes", field: null, layout: false, param: "id" });
  });

  test("a page of its own, an enumerated $paths and an empty contentType state no collection", () => {
    expect(pageFactsOf({ tagName: "div" }, null)).toEqual({
      contentType: null,
      field: null,
      layout: undefined,
      param: null,
    });
    expect(pageFactsOf({ $paths: [{ slug: "a" }] }, null).contentType).toBeNull();
    expect(pageFactsOf({ $paths: { contentType: "", param: "" } }, null)).toEqual({
      contentType: null,
      field: null,
      layout: undefined,
      param: null,
    });
  });
});

describe("pageFactsOf over an enumerated $paths", () => {
  const entry = (contentType: string, ref: string) => ({
    $prototype: "ContentEntry",
    contentType,
    id: { $ref: ref },
  });

  test("a taxonomy page is the page of the collection its route parameter reads an entry of", () => {
    const page = {
      $layout: "./layouts/index.json",
      $paths: { param: "slug", values: ["chad-beiler", "kris-bucher"] },
      state: {
        author: entry("author", "#/$params/slug"),
        recent: { $prototype: "ContentCollection", contentType: "post" },
      },
    };
    expect(pageFactsOf(page, null)).toEqual({
      contentType: "author",
      field: null,
      layout: "./layouts/index.json",
      param: "slug",
    });
    // A Markdown page states both in its frontmatter.
    expect(
      pageFactsOf(
        { tagName: "div" },
        {
          $paths: { param: "id", values: ["a"] },
          state: { note: entry("notes", "#/$params/id") },
        },
      ).contentType,
    ).toBe("notes");
  });

  test("values with no entry read by the parameter, or no parameter, state no collection", () => {
    const none = { contentType: null, field: null, layout: undefined, param: null };
    expect(pageFactsOf({ $paths: { param: "slug", values: ["a"] } }, null)).toEqual(none);
    expect(
      pageFactsOf(
        {
          $paths: { param: "slug", values: ["a"] },
          state: {
            fixed: entry("author", "#/$params/other"),
            nameless: entry("", "#/$params/slug"),
            odd: ["not", "an", "entry"],
            plain: "text",
          },
        },
        null,
      ),
    ).toEqual(none);
    expect(
      pageFactsOf(
        { $paths: { values: ["a"] }, state: { a: entry("author", "#/$params/slug") } },
        null,
      ),
    ).toEqual(none);
  });
});

describe("readPageFacts", () => {
  test("parses a JSON page and a format page", async () => {
    const json = await readPageFacts("pages/blog/[slug].json");
    expect(json.contentType).toBe("posts");
    expect(await readPageFacts("pages/n/[id].md")).toEqual({
      contentType: "notes",
      field: null,
      layout: false,
      param: "id",
    });
  });

  test("a file that cannot be read or parsed states nothing", async () => {
    expect(await readPageFacts("pages/missing.json")).toEqual({
      contentType: null,
      field: null,
      layout: undefined,
      param: null,
    });
    installMockPlatform({}, { "pages/x.md": "broken" });
    const broken = await readPageFacts("pages/x.md");
    expect(broken.contentType).toBeNull();
  });
});

describe("the index", () => {
  test("maps each collection to its template pages, with their URL patterns", async () => {
    const index = await collectionPages();
    expect(index.get("posts")).toEqual([
      {
        field: null,
        layout: "./layouts/post.json",
        locale: null,
        param: "slug",
        path: "pages/blog/[slug].json",
        pattern: "/blog/:slug",
      },
    ]);
    expect(index.get("notes")?.map((page) => page.path)).toEqual([
      "pages/n/[id].md",
      "pages/n/[x].json",
    ]);
    const notes = await collectionPage("notes");
    expect(notes?.path).toBe("pages/n/[id].md");
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

describe("one template page per language", () => {
  const I18N = {
    defaults: { layout: "./layouts/base.json" },
    i18n: {
      defaultLocale: "en",
      locales: ["en", "fr-CA", "ar"],
      routing: "prefix-except-default" as const,
    },
  };
  const LOCALIZED_TREE = {
    pages: [
      dir("ar", "pages/ar"),
      dir("exhibitions", "pages/exhibitions"),
      dir("fr-ca", "pages/fr-ca"),
    ],
    "pages/ar": [dir("exhibitions", "pages/ar/exhibitions")],
    "pages/ar/exhibitions": [file("[slug].json", "pages/ar/exhibitions/[slug].json")],
    "pages/exhibitions": [file("[slug].json", "pages/exhibitions/[slug].json")],
    "pages/fr-ca": [dir("expositions", "pages/fr-ca/expositions")],
    "pages/fr-ca/expositions": [file("[slug].json", "pages/fr-ca/expositions/[slug].json")],
  } satisfies Record<string, DirEntry[]>;
  const PATHS = { contentType: "exhibitions", param: "slug" };
  const page = (layout: string) =>
    JSON.stringify({ $layout: layout, $paths: PATHS, tagName: "article" });

  beforeEach(() => {
    installMockPlatform(
      {
        listDirectory: (path: string) => {
          const entries = Object.entries(LOCALIZED_TREE).find(([dirPath]) => dirPath === path)?.[1];
          return entries ? Promise.resolve(entries) : Promise.reject(new Error(path));
        },
      },
      {
        "pages/ar/exhibitions/[slug].json": page("./layouts/ar.json"),
        // The default language's page names no layout: the project default applies.
        "pages/exhibitions/[slug].json": JSON.stringify({ $paths: PATHS, tagName: "article" }),
        "pages/fr-ca/expositions/[slug].json": page("./layouts/fr-ca.json"),
      },
    );
    resetStudioState({ projectConfig: I18N });
    resetCollectionPages();
  });

  test("the page in the language asked about, else the default language's", async () => {
    const arabic = await collectionPage("exhibitions", "ar");
    expect(arabic?.layout).toBe("./layouts/ar.json");
    const french = await collectionPage("exhibitions", "fr-ca");
    expect(french?.pattern).toBe("/fr-ca/expositions/:slug");
    // Path order puts the Arabic page first; the default language still answers for "any".
    const any = await collectionPage("exhibitions");
    expect(any?.pattern).toBe("/exhibitions/:slug");
    const undeclared = await collectionPage("exhibitions", "de");
    expect(undeclared?.pattern).toBe("/exhibitions/:slug");
    expect(peekCollectionPage("exhibitions", "en")?.locale).toBe("en");
  });

  test("an entry's language is read from its path", () => {
    expect(entryLocale("content/exhibitions/ar/clay.md")).toBe("ar");
    expect(entryLocale("content/exhibitions/fr-CA/clay.md")).toBe("fr-CA");
    expect(entryLocale("content/posts/hello.md")).toBeNull();
    expect(entryLocale(null)).toBeNull();
  });

  test("with no page in the default language, an unlocalized page, then the first", () => {
    const at = (path: string, locale: string | null) => ({
      field: null,
      layout: undefined,
      locale,
      param: "slug",
      path,
      pattern: path,
    });
    expect(pageForLocale(undefined, "ar")).toBeNull();
    expect(pageForLocale([], null)).toBeNull();
    expect(pageForLocale([at("a", "ar"), at("b", null)], "fr-CA")?.path).toBe("b");
    expect(pageForLocale([at("a", "ar"), at("b", "fr-CA")], null)?.path).toBe("a");
  });
});

describe("entryUrl", () => {
  const page = {
    field: null,
    layout: undefined,
    param: "slug",
    path: "pages/blog/[slug].json",
    pattern: "/blog/:slug",
    locale: null,
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

  test("a page that names a field fills its parameter from the entry's field, as the build does", () => {
    const products = { ...page, field: "sku", param: "sku", pattern: "/products/:sku" };
    const path = "content/products/Kubota Trackloader SVL75-3 Heat & AC.md";
    expect(entryUrl(products, path, { sku: "kubota-SVL75" })).toBe("/products/kubota-SVL75");
    expect(entryUrl(products, path, { sku: 75 })).toBe("/products/75");
    // A missing field falls back to the id, as `Content.resolvePaths` does.
    expect(entryUrl(products, "content/products/mower.md", {})).toBe("/products/mower");
  });

  test("a JSON entry's own id names it; a Markdown entry's frontmatter id does not", () => {
    expect(entryUrl(page, "content/posts/a.json", { id: "first" })).toBe("/blog/first");
    expect(entryUrl(page, "content/posts/a.md", { id: "first" })).toBe("/blog/a");
  });
});

describe("pageFactsOf field", () => {
  test("names the field a $paths fills its parameter from, and not the default id", () => {
    const paths = { contentType: "product", field: "sku", param: "sku" };
    expect(pageFactsOf({ $paths: paths }, null).field).toBe("sku");
    expect(pageFactsOf({ $paths: { ...paths, field: "id" } }, null).field).toBeNull();
  });
});

describe("entryLayoutPath", () => {
  const page = {
    field: null,
    layout: "./layouts/post.json",
    param: "slug",
    path: "p",
    pattern: "/:slug",
    locale: null,
  };

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
