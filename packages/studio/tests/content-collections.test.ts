/**
 * Tests for src/content/content-collections.ts — the collections the Content workspace lists, and
 * the one answer to "which collection is this file in" (studio.md §9.1.2, §22.5).
 */
import "./with-dom.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { resetStudioState } from "./harness";
import {
  PAGES_COLLECTION,
  collectionKeyOfPath,
  contentCacheDrops,
  contentCollection,
  contentCollectionKeys,
  contentCollections,
  capitalise,
  humanName,
  itemNoun,
  templateDisplayName,
  writesEntryOnCanvas,
} from "../src/content/content-collections";

beforeEach(() => {
  resetStudioState({
    projectConfig: {
      content: {
        posts: { format: "markdown", source: "./content/posts" },
        products: { format: "csv", source: "./content/catalog.csv" },
        stories: { format: "json", source: "./content/stories/" },
      },
    },
  });
});

describe("the collections", () => {
  test("Pages leads, then every declared collection in declaration order", () => {
    expect(contentCollectionKeys()).toEqual([PAGES_COLLECTION, "posts", "products", "stories"]);
    expect(contentCollections()[0]).toEqual({
      fileBacked: false,
      item: "page",
      key: "pages",
      kind: "pages",
      title: "Pages",
    });
  });

  test("a collection is titled by its name and its item is that name in the singular", () => {
    expect(contentCollection("stories")).toEqual({
      fileBacked: false,
      item: "story",
      key: "stories",
      kind: "collection",
      title: "Stories",
    });
  });

  test("a source naming one file is a file-backed collection", () => {
    expect(contentCollection("products")?.fileBacked).toBe(true);
  });

  test("an undeclared key names no collection", () => {
    expect(contentCollection("gone")).toBeNull();
  });

  test("with no project there is only Pages", () => {
    resetStudioState({ projectConfig: null });
    expect(contentCollectionKeys()).toEqual(["pages"]);
  });
});

describe("itemNoun", () => {
  test.each([
    ["posts", "post"],
    ["stories", "story"],
    ["news", "news"],
    ["News", "News"],
    ["series", "series"],
    ["species", "species"],
    ["status", "status"],
    ["analysis", "analysis"],
    ["classes", "class"],
    ["boxes", "box"],
    ["matches", "match"],
    ["recipes", "recipe"],
    ["glass", "glass"],
    ["data", "data"],
    ["team", "team"],
    // A compound name is said in words, its last word singular.
    ["post_tags", "post tag"],
    ["service-type", "service type"],
    ["docsNav", "docs nav"],
    // A collection named for the whole holds items of it.
    ["menu", "menu item"],
    ["Gallery", "Gallery item"],
    ["drinks_menu", "drinks menu item"],
  ])("%s → %s", (plural, singular) => {
    expect(itemNoun(plural)).toBe(singular);
  });
});

describe("collection names in words", () => {
  test("a storage name is said in lower-case words, and a collection is titled with it", () => {
    expect(humanName("project_tag")).toBe("project tag");
    expect(humanName("service-type")).toBe("service type");
    expect(humanName("docsNav")).toBe("docs nav");
    expect(humanName("  a__b  ")).toBe("a b");
    resetStudioState({
      projectConfig: {
        content: { project_tag: { source: "./content/t" }, menu: { source: "./m" } },
      },
    });
    expect(contentCollections().map((each) => [each.title, each.item])).toEqual([
      ["Pages", "page"],
      ["Project tag", "project tag"],
      ["Menu", "menu item"],
    ]);
  });
});

describe("display names", () => {
  test("capitalise raises the first letter only", () => {
    expect(capitalise("posts")).toBe("Posts");
    expect(capitalise("")).toBe("");
  });

  test("a template is named by its file, with separators as spaces", () => {
    expect(templateDisplayName("./layouts/post.json")).toBe("Post");
    expect(templateDisplayName("./layouts/blog-post.json")).toBe("Blog Post");
    expect(templateDisplayName(String.raw`layouts\shop\long_form.md`)).toBe("Long Form");
  });
});

describe("collectionKeyOfPath", () => {
  test("a routed page is in Pages, and a page directory's private part is in none", () => {
    expect(collectionKeyOfPath("pages/index.json")).toBe("pages");
    expect(collectionKeyOfPath("./pages/blog/[slug].json")).toBe("pages");
    expect(collectionKeyOfPath("pages/_partials/card.json")).toBeNull();
  });

  test("an entry is in the collection collection-match names", () => {
    expect(collectionKeyOfPath("content/posts/hello.md")).toBe("posts");
    expect(collectionKeyOfPath(String.raw`content\stories\a.json`)).toBe("stories");
    expect(collectionKeyOfPath("content/catalog.csv")).toBe("products");
  });

  test("media, templates, components and nothing at all are in no collection", () => {
    expect(collectionKeyOfPath("content/posts/cover.png")).toBeNull();
    expect(collectionKeyOfPath("layouts/base.json")).toBeNull();
    expect(collectionKeyOfPath("components/card.json")).toBeNull();
    expect(collectionKeyOfPath(null)).toBeNull();
    expect(collectionKeyOfPath("")).toBeNull();
  });
});

describe("writesEntryOnCanvas", () => {
  test("an entry with a body is written on the canvas", () => {
    expect(writesEntryOnCanvas("content/posts/hello.md")).toBe(true);
  });

  test("a JSON entry, a file-backed catalogue and a file in no collection are not", () => {
    expect(writesEntryOnCanvas("content/stories/a.json")).toBe(false);
    expect(writesEntryOnCanvas("content/catalog.csv")).toBe(false);
    expect(writesEntryOnCanvas("pages/about.md")).toBe(false);
    expect(writesEntryOnCanvas(null)).toBe(false);
  });
});

describe("contentCacheDrops", () => {
  test("a gap or a batch that changed the file set drops all three", () => {
    const all = { entries: true, pages: true, scan: true };
    expect(contentCacheDrops(undefined, false)).toEqual(all);
    expect(contentCacheDrops(["README.md"], true)).toEqual(all);
  });

  test("a save never drops the scan, and drops the rest only by path", () => {
    expect(contentCacheDrops(["layouts/base.json"], false)).toEqual({
      entries: false,
      pages: false,
      scan: false,
    });
    expect(contentCacheDrops(["./pages/blog/[slug].json"], false)).toEqual({
      entries: false,
      pages: true,
      scan: false,
    });
    expect(contentCacheDrops(["content/posts/hello.md"], false)).toEqual({
      entries: true,
      pages: false,
      scan: false,
    });
  });
});
