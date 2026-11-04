/**
 * The page arithmetic a paged route is built with (site-architecture.md §4.3): which `$paths` pages
 * a list, how many pages it fills, each page's slice, and the pager's URLs.
 */
import { describe, expect, test } from "bun:test";
import { pageCount, pageSlice, pageUrl, pagedSource, pagination } from "../src/pagination.ts";

describe("pagedSource", () => {
  test("is null for every other shape", () => {
    expect(pagedSource({ param: "lang", values: ["en"] })).toBeNull();
    expect(pagedSource({ $ref: "./data.json" })).toBeNull();
    expect(pagedSource([{ slug: "a" }])).toBeNull();
    expect(pagedSource({ contentType: "blog" })).toBeNull();
    expect(pagedSource(null)).toBeNull();
    expect(pagedSource("posts")).toBeNull();
  });

  test("reads the key and page size, unescaping the pointer", () => {
    expect(pagedSource({ pageSize: 10, paginate: { $ref: "#/state/posts" } })).toEqual({
      key: "posts",
      pageSize: 10,
    });
    expect(pagedSource({ pageSize: 1, paginate: { $ref: "#/state/a~1b~0c" } })?.key).toBe("a/b~c");
  });

  test("keeps the each source of a second parameter", () => {
    const each = { param: "tag", values: ["a", "b"] };
    expect(pagedSource({ each, pageSize: 2, paginate: { $ref: "#/state/posts" } })).toEqual({
      each,
      key: "posts",
      pageSize: 2,
    });
    const legacy = [{ tag: "a" }];
    expect(pagedSource({ each: legacy, pageSize: 2, paginate: { $ref: "#/state/p" } })?.each).toBe(
      legacy,
    );
  });

  test("names the fault", () => {
    const pointer = '$paths.paginate must be { "$ref": "#/state/<key>" }';
    expect(() => pagedSource({ pageSize: 2, paginate: { $ref: "./posts.json" } })).toThrow(pointer);
    expect(() => pagedSource({ pageSize: 2, paginate: { $ref: "#/state/a/b" } })).toThrow(pointer);
    expect(() => pagedSource({ pageSize: 2, paginate: "#/state/posts" })).toThrow(pointer);
    for (const pageSize of [0, 2.5, "10", undefined]) {
      expect(() => pagedSource({ pageSize, paginate: { $ref: "#/state/posts" } })).toThrow(
        "$paths.pageSize must be a positive integer",
      );
    }
    expect(() =>
      pagedSource({ each: "tags", pageSize: 2, paginate: { $ref: "#/state/posts" } }),
    ).toThrow("$paths.each must be a $paths source");
    expect(() =>
      pagedSource({
        each: { pageSize: 1, paginate: { $ref: "#/state/tags" } },
        pageSize: 2,
        paginate: { $ref: "#/state/posts" },
      }),
    ).toThrow("$paths.each cannot itself be paged");
  });
});

describe("pageCount", () => {
  test("is at least one", () => {
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(10, 10)).toBe(1);
    expect(pageCount(11, 10)).toBe(2);
  });
});

describe("pageSlice", () => {
  test("returns the page's items and nothing past the end", () => {
    const items = [1, 2, 3, 4, 5];
    expect(pageSlice(items, 1, 2)).toEqual([1, 2]);
    expect(pageSlice(items, 3, 2)).toEqual([5]);
    expect(pageSlice(items, 4, 2)).toEqual([]);
  });
});

describe("pageUrl", () => {
  test("puts a catch-all's first page at the list's own URL", () => {
    expect(pageUrl("/blog/*", 1)).toBe("/blog");
    expect(pageUrl("/blog/*", 2)).toBe("/blog/2");
    expect(pageUrl("/*", 1)).toBe("/");
    expect(pageUrl("/*", 2)).toBe("/2");
    expect(pageUrl("/fr/blog/*", 1)).toBe("/fr/blog");
  });

  test("numbers every page of a named parameter", () => {
    expect(pageUrl("/blog/:page", 1)).toBe("/blog/1");
    expect(pageUrl("/blog/page/:n", 3)).toBe("/blog/page/3");
  });
});

describe("pagination", () => {
  test("links neighbours and marks the current page", () => {
    const second = pagination("/blog/*", 2, 2, 5);
    expect(second).toMatchObject({
      first: "/blog",
      itemCount: 5,
      last: "/blog/3",
      next: "/blog/3",
      number: 2,
      pageCount: 3,
      pageSize: 2,
      prev: "/blog",
    });
    expect(second.pages).toEqual([
      { current: false, number: 1, url: "/blog" },
      { current: true, number: 2, url: "/blog/2" },
      { current: false, number: 3, url: "/blog/3" },
    ]);
    expect(pagination("/blog/*", 1, 2, 5).prev).toBeNull();
    expect(pagination("/blog/*", 3, 2, 5).next).toBeNull();
  });

  test("a single page has no neighbours", () => {
    const only = pagination("/blog/*", 1, 10, 0);
    expect(only.prev).toBeNull();
    expect(only.next).toBeNull();
    expect(only.pages).toEqual([{ current: true, number: 1, url: "/blog" }]);
  });
});
