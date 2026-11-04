import { describe, expect, test } from "bun:test";
import { discoverPages, expandDynamicRoutes, readPageDocument } from "../src/site/pages-discovery";
import { buildProjectExtensionRegistry } from "../src/site/format-host";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { JxDocument } from "@jxsuite/schema/types";

const FIXTURES = join(import.meta.dir, "_fixtures_pages");

// Registry with the parser extension enabled — .md pages require a format-providing extension
const extRegistry = await buildProjectExtensionRegistry(FIXTURES, {
  extensions: ["@jxsuite/parser"],
});
const mdRegistry = extRegistry.formats;

function setup() {
  rmSync(FIXTURES, { force: true, recursive: true });
  mkdirSync(FIXTURES, { recursive: true });
}

function cleanup() {
  rmSync(FIXTURES, { force: true, recursive: true });
}

// ─── discoverPages ──────────────────────────────────────────────────────────

describe("discoverPages", () => {
  test("discovers index.json as root route", async () => {
    setup();
    writeFileSync(join(FIXTURES, "index.json"), JSON.stringify({ tagName: "div" }));
    const routes = await discoverPages(FIXTURES);
    expect(routes.length).toBe(1);
    expect(routes[0]!.urlPattern).toBe("/");
    expect(routes[0]!.isDynamic).toBe(false);
    cleanup();
  });

  test("discovers nested page routes", async () => {
    setup();
    mkdirSync(join(FIXTURES, "about"), { recursive: true });
    writeFileSync(join(FIXTURES, "about", "index.json"), JSON.stringify({ tagName: "div" }));
    const routes = await discoverPages(FIXTURES);
    const aboutRoute = routes.find((r) => r.urlPattern === "/about");
    expect(aboutRoute).toBeDefined();
    cleanup();
  });

  test("discovers dynamic [param] routes", async () => {
    setup();
    mkdirSync(join(FIXTURES, "blog", "[slug]"), { recursive: true });
    writeFileSync(
      join(FIXTURES, "blog", "[slug]", "index.json"),
      JSON.stringify({ tagName: "div" }),
    );
    const routes = await discoverPages(FIXTURES);
    const blogRoute = routes.find((r) => r.urlPattern.includes(":slug"));
    expect(blogRoute).toBeDefined();
    expect(blogRoute?.isDynamic).toBe(true);
    expect(blogRoute?.params).toContain("slug");
    cleanup();
  });

  test("discovers catch-all [...param] routes", async () => {
    setup();
    mkdirSync(join(FIXTURES, "docs", "[...path]"), { recursive: true });
    writeFileSync(
      join(FIXTURES, "docs", "[...path]", "index.json"),
      JSON.stringify({ tagName: "div" }),
    );
    const routes = await discoverPages(FIXTURES);
    const docsRoute = routes.find((r) => r.isCatchAll);
    expect(docsRoute).toBeDefined();
    expect(docsRoute?.urlPattern).toContain("*");
    expect(docsRoute?.params).toContain("path");
    cleanup();
  });

  test("extracts $layout from JSON page", async () => {
    setup();
    writeFileSync(
      join(FIXTURES, "index.json"),
      JSON.stringify({ $layout: "blog", tagName: "div" }),
    );
    const routes = await discoverPages(FIXTURES);
    expect(routes[0]!.$layout).toBe("blog");
    cleanup();
  });

  test("extracts $layout from markdown frontmatter", async () => {
    setup();
    writeFileSync(join(FIXTURES, "post.md"), "---\n$layout: article\ntitle: Hello\n---\n# Hello");
    const routes = await discoverPages(FIXTURES, mdRegistry);
    const mdRoute = routes.find((r) => r.sourcePath.endsWith(".md"));
    expect(mdRoute).toBeDefined();
    expect(mdRoute?.$layout).toBe("article");
    cleanup();
  });

  test("$layout is null when not specified", async () => {
    setup();
    writeFileSync(join(FIXTURES, "index.json"), JSON.stringify({ tagName: "div" }));
    const routes = await discoverPages(FIXTURES);
    expect(routes[0]!.$layout).toBeNull();
    cleanup();
  });

  test("discovers .md files as pages", async () => {
    setup();
    writeFileSync(join(FIXTURES, "about.md"), "---\ntitle: About\n---\n# About");
    const routes = await discoverPages(FIXTURES, mdRegistry);
    const mdRoute = routes.find((r) => r.urlPattern === "/about");
    expect(mdRoute).toBeDefined();
    expect(mdRoute?.sourcePath).toContain(".md");
    cleanup();
  });
});

// ─── readPageDocument ───────────────────────────────────────────────────────

describe("readPageDocument", () => {
  test("throws naming the extension and the extensions-based fix when no registry handles it", async () => {
    setup();
    writeFileSync(join(FIXTURES, "page.csv"), "a,b\n1,2\n");
    let caught: unknown;
    try {
      await readPageDocument(join(FIXTURES, "page.csv"));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toContain('No format class registered for ".csv"');
    expect(message).toContain('project.json "extensions"');
    cleanup();
  });
});

// ─── expandDynamicRoutes ────────────────────────────────────────────────────

describe("expandDynamicRoutes", () => {
  test("passes static routes through unchanged", async () => {
    const routes = [
      {
        $layout: null,
        isCatchAll: false,
        isDynamic: false,
        params: [],
        relativePath: "",
        sourcePath: "/x",
        urlPattern: "/",
      },
    ];
    const result = await expandDynamicRoutes(routes, FIXTURES);
    expect(result).toEqual(routes);
  });

  test("expands dynamic route with legacy array $paths", async () => {
    setup();
    const pagePath = join(FIXTURES, "page.json");
    writeFileSync(
      pagePath,
      JSON.stringify({
        $paths: [{ slug: "hello" }, { slug: "world" }],
        tagName: "div",
      }),
    );
    const routes = [
      {
        $layout: null,
        isCatchAll: false,
        isDynamic: true,
        params: ["slug"],
        relativePath: "",
        sourcePath: pagePath,
        urlPattern: "/blog/:slug",
      },
    ];
    const result = await expandDynamicRoutes(routes, FIXTURES);
    expect(result.length).toBe(2);
    expect(result[0]!.urlPattern).toBe("/blog/hello");
    expect(result[1]!.urlPattern).toBe("/blog/world");
    expect(result[0]!.isDynamic).toBe(false);
    cleanup();
  });

  test("expands dynamic route with explicit values $paths", async () => {
    setup();
    const pagePath = join(FIXTURES, "lang.json");
    writeFileSync(
      pagePath,
      JSON.stringify({
        $paths: { param: "lang", values: ["en", "fr", "de"] },
        tagName: "div",
      }),
    );
    const routes = [
      {
        $layout: null,
        isCatchAll: false,
        isDynamic: true,
        params: ["lang"],
        relativePath: "",
        sourcePath: pagePath,
        urlPattern: "/:lang",
      },
    ];
    const result = await expandDynamicRoutes(routes, FIXTURES);
    expect(result.length).toBe(3);
    expect(result[0]!.urlPattern).toBe("/en");
    expect(result[1]!.urlPattern).toBe("/fr");
    expect(result[2]!.urlPattern).toBe("/de");
    cleanup();
  });

  test("expands dynamic route with content type $paths", async () => {
    setup();
    const pagePath = join(FIXTURES, "post.json");
    writeFileSync(
      pagePath,
      JSON.stringify({
        $paths: { contentType: "blog", field: "slug", param: "slug" },
        tagName: "div",
      }),
    );
    const sections = {
      content: new Map([
        [
          "blog",
          [
            { body: null, data: { slug: "hello-world", title: "Hello" }, id: "1" },
            { body: null, data: { slug: "second-post", title: "Second" }, id: "2" },
          ],
        ],
      ]),
    };
    const routes = [
      {
        $layout: null,
        isCatchAll: false,
        isDynamic: true,
        params: ["slug"],
        relativePath: "",
        sourcePath: pagePath,
        urlPattern: "/blog/:slug",
      },
    ];
    const result = await expandDynamicRoutes(routes, FIXTURES, sections, extRegistry);
    expect(result.length).toBe(2);
    expect(result[0]!.urlPattern).toBe("/blog/hello-world");
    expect(result[1]!.urlPattern).toBe("/blog/second-post");
    cleanup();
  });

  test("expands dynamic route with $ref to data file", async () => {
    setup();
    writeFileSync(
      join(FIXTURES, "products.json"),
      JSON.stringify([
        { name: "Widget", sku: "ABC123" },
        { name: "Gadget", sku: "DEF456" },
      ]),
    );
    const pagePath = join(FIXTURES, "product.json");
    writeFileSync(
      pagePath,
      JSON.stringify({
        $paths: { $ref: "./products.json", field: "sku", param: "id" },
        tagName: "div",
      }),
    );
    const routes = [
      {
        $layout: null,
        isCatchAll: false,
        isDynamic: true,
        params: ["id"],
        relativePath: "",
        sourcePath: pagePath,
        urlPattern: "/products/:id",
      },
    ];
    const result = await expandDynamicRoutes(routes, FIXTURES);
    expect(result.length).toBe(2);
    expect(result[0]!.urlPattern).toBe("/products/ABC123");
    expect(result[1]!.urlPattern).toBe("/products/DEF456");
    cleanup();
  });

  test("a null row in a $ref data file fails the expansion", async () => {
    setup();
    writeFileSync(join(FIXTURES, "rows.json"), JSON.stringify([{ sku: "ABC123" }, null]));
    const pagePath = join(FIXTURES, "row.json");
    writeFileSync(
      pagePath,
      JSON.stringify({
        $paths: { $ref: "./rows.json", field: "sku", param: "id" },
        tagName: "div",
      }),
    );
    const routes = [
      {
        $layout: null,
        isCatchAll: false,
        isDynamic: true,
        params: ["id"],
        relativePath: "",
        sourcePath: pagePath,
        urlPattern: "/rows/:id",
      },
    ];
    let failure: Error | undefined;
    try {
      await expandDynamicRoutes(routes, FIXTURES);
    } catch (error) {
      failure = error instanceof Error ? error : undefined;
    }
    expect(failure).toEqual(new TypeError('$paths.$ref "./rows.json" contains a null entry'));
    expect(failure).toBeInstanceOf(TypeError);
    cleanup();
  });

  test("handles missing content type gracefully", async () => {
    setup();
    const pagePath = join(FIXTURES, "missing.json");
    writeFileSync(
      pagePath,
      JSON.stringify({
        $paths: { contentType: "nonexistent", param: "id" },
        tagName: "div",
      }),
    );
    const routes = [
      {
        $layout: null,
        isCatchAll: false,
        isDynamic: true,
        params: ["id"],
        relativePath: "",
        sourcePath: pagePath,
        urlPattern: "/x/:id",
      },
    ];
    const result = await expandDynamicRoutes(routes, FIXTURES);
    expect(result.length).toBe(0);
    cleanup();
  });

  test("handles missing $ref data file gracefully", async () => {
    setup();
    const pagePath = join(FIXTURES, "ref-missing.json");
    writeFileSync(
      pagePath,
      JSON.stringify({
        $paths: { $ref: "./no-such-file.json", param: "id" },
        tagName: "div",
      }),
    );
    const routes = [
      {
        $layout: null,
        isCatchAll: false,
        isDynamic: true,
        params: ["id"],
        relativePath: "",
        sourcePath: pagePath,
        urlPattern: "/x/:id",
      },
    ];
    const result = await expandDynamicRoutes(routes, FIXTURES);
    expect(result.length).toBe(0);
    cleanup();
  });

  test("handles non-array $ref data gracefully", async () => {
    setup();
    writeFileSync(join(FIXTURES, "obj-data.json"), JSON.stringify({ not: "an array" }));
    const pagePath = join(FIXTURES, "obj-ref.json");
    writeFileSync(
      pagePath,
      JSON.stringify({
        $paths: { $ref: "./obj-data.json", param: "id" },
        tagName: "div",
      }),
    );
    const routes = [
      {
        $layout: null,
        isCatchAll: false,
        isDynamic: true,
        params: ["id"],
        relativePath: "",
        sourcePath: pagePath,
        urlPattern: "/x/:id",
      },
    ];
    const result = await expandDynamicRoutes(routes, FIXTURES);
    expect(result.length).toBe(0);
    cleanup();
  });

  test("skips dynamic route without $paths", async () => {
    setup();
    const pagePath = join(FIXTURES, "no-paths.json");
    writeFileSync(pagePath, JSON.stringify({ tagName: "div" }));
    const routes = [
      {
        $layout: null,
        isCatchAll: false,
        isDynamic: true,
        params: ["id"],
        relativePath: "",
        sourcePath: pagePath,
        urlPattern: "/x/:id",
      },
    ];
    const result = await expandDynamicRoutes(routes, FIXTURES);
    expect(result.length).toBe(0);
    cleanup();
  });

  test("handles unrecognized $paths shape", async () => {
    setup();
    const pagePath = join(FIXTURES, "weird-paths.json");
    writeFileSync(
      pagePath,
      JSON.stringify({
        $paths: { something: "weird" },
        tagName: "div",
      }),
    );
    const routes = [
      {
        $layout: null,
        isCatchAll: false,
        isDynamic: true,
        params: ["id"],
        relativePath: "",
        sourcePath: pagePath,
        urlPattern: "/x/:id",
      },
    ];
    const result = await expandDynamicRoutes(routes, FIXTURES);
    expect(result.length).toBe(0);
    cleanup();
  });

  test("passes through dynamic route with unreadable file", async () => {
    const routes = [
      {
        $layout: null,
        isCatchAll: false,
        isDynamic: true,
        params: ["id"],
        relativePath: "",
        sourcePath: "/nonexistent/page.json",
        urlPattern: "/x/:id",
      },
    ];
    const result = await expandDynamicRoutes(routes, FIXTURES);
    expect(result.length).toBe(1);
    expect(result[0]!.urlPattern).toBe("/x/:id");
  });
});

process.on("exit", () => {
  try {
    cleanup();
  } catch {}
});

// ─── paginate $paths (site-architecture.md §4.3) ──────────────────────────

describe("paginate $paths", () => {
  /** A dynamic route over a page written with `doc`, at `urlPattern` with `params`. */
  function pagedRoute(doc: JxDocument, urlPattern: string, params: string[]) {
    const sourcePath = join(FIXTURES, `paged-${params.join("-")}.json`);
    writeFileSync(sourcePath, JSON.stringify(doc));
    return {
      $layout: null,
      isCatchAll: urlPattern.endsWith("*"),
      isDynamic: true,
      params,
      relativePath: "",
      sourcePath,
      urlPattern,
    };
  }

  const five = ["a", "b", "c", "d", "e"];

  test("pages a literal array into numbered routes, page 1 at a catch-all's root", async () => {
    setup();
    const route = pagedRoute(
      { $paths: { pageSize: 2, paginate: { $ref: "#/state/posts" } }, state: { posts: five } },
      "/blog/*",
      ["page"],
    );
    const result = await expandDynamicRoutes([route], FIXTURES);
    expect(result.map((r) => r.urlPattern)).toEqual(["/blog", "/blog/2", "/blog/3"]);
    expect(result.map((r) => r._pathParams)).toEqual([{ page: "1" }, { page: "2" }, { page: "3" }]);
    expect(result.map((r) => r.pagedState?.items)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(result[0]!.pagedState?.key).toBe("posts");
    expect(result[2]!.pagination?.next).toBeNull();
    expect(result[0]!.isDynamic).toBe(false);
    expect(result[0]!.sourceMtime).toBeUndefined();
    cleanup();
  });

  test("a named parameter numbers the first page", async () => {
    setup();
    const route = pagedRoute(
      { $paths: { pageSize: 5, paginate: { $ref: "#/state/posts" } }, state: { posts: five } },
      "/blog/page/:n",
      ["n"],
    );
    const result = await expandDynamicRoutes([route], FIXTURES);
    expect(result.map((r) => r.urlPattern)).toEqual(["/blog/page/1"]);
    cleanup();
  });

  test("an empty list still yields its first page", async () => {
    setup();
    const route = pagedRoute(
      { $paths: { pageSize: 5, paginate: { $ref: "#/state/posts" } }, state: { posts: [] } },
      "/blog/*",
      ["page"],
    );
    const result = await expandDynamicRoutes([route], FIXTURES);
    expect(result.map((r) => r.urlPattern)).toEqual(["/blog"]);
    expect(result[0]!.pagination?.pageCount).toBe(1);
    cleanup();
  });

  test("pages a list once per value of its each source", async () => {
    setup();
    const route = pagedRoute(
      {
        $paths: {
          each: { param: "tag", values: ["a$b", "news"] },
          pageSize: 3,
          paginate: { $ref: "#/state/posts" },
        },
        state: { posts: five },
      },
      "/tags/:tag/*",
      ["tag", "page"],
    );
    const result = await expandDynamicRoutes([route], FIXTURES);
    expect(result.map((r) => r.urlPattern)).toEqual([
      "/tags/a$b",
      "/tags/a$b/2",
      "/tags/news",
      "/tags/news/2",
    ]);
    expect(result[3]!._pathParams).toEqual({ page: "2", tag: "news" });
    expect(result[2]!.pagination?.next).toBe("/tags/news/2");
    cleanup();
  });

  test("a ContentCollection entry is paged with its own filter and sort, per each value", async () => {
    setup();
    const route = pagedRoute(
      {
        $paths: {
          each: { contentType: "tags", field: "id", param: "tag" },
          pageSize: 1,
          paginate: { $ref: "#/state/posts" },
        },
        state: {
          posts: {
            $prototype: "ContentCollection",
            contentType: "blog",
            filter: [
              { field: "draft", op: "!=", value: true },
              { field: "terms.tag.slug", op: "contains", value: { $ref: "#/$params/tag" } },
            ],
            sort: [{ field: "order", order: "desc" }],
            timing: "compiler",
          },
        },
      },
      "/tags/:tag/*",
      ["tag", "page"],
    );
    const tagged = (id: string, order: number, tags: string[], draft = false) => ({
      _meta: { mtime: "2000-01-01T00:00:00Z" },
      body: null,
      data: { draft, order, terms: { tag: tags.map((slug) => ({ slug })) } },
      id,
    });
    const sections = {
      content: new Map([
        [
          "blog",
          [
            tagged("one", 1, ["x"]),
            tagged("two", 2, ["x", "y"]),
            tagged("three", 3, ["x"], true),
            tagged("four", 4, ["y"]),
          ],
        ],
        [
          "tags",
          [
            { body: null, data: {}, id: "x" },
            { body: null, data: {}, id: "y" },
          ],
        ],
      ]),
    };
    const result = await expandDynamicRoutes([route], FIXTURES, sections, extRegistry, {
      imports: { Local: "./classes/local.class.json", Remote: "@scope/remote.class.json" },
    });
    expect(result.map((r) => r.urlPattern)).toEqual([
      "/tags/x",
      "/tags/x/2",
      "/tags/y",
      "/tags/y/2",
    ]);
    const ids = result.map((r) =>
      r.pagedState?.items.map((item) => (isJsonObject(item) ? item.id : undefined)),
    );
    expect(ids).toEqual([["two"], ["one"], ["four"], ["two"]]);
    cleanup();
  });

  test("a newer item dates the route, and items without timestamps leave it to its template", async () => {
    setup();
    const route = pagedRoute(
      {
        $paths: { pageSize: 2, paginate: { $ref: "#/state/posts" } },
        state: {
          posts: [
            { _meta: { mtime: "2999-01-01T00:00:00.000Z" }, id: "future" },
            { _meta: { mtime: "1999-01-01T00:00:00.000Z" }, id: "past" },
            { _meta: { mtime: "not a date" }, id: "odd" },
            { id: "bare" },
          ],
        },
      },
      "/blog/*",
      ["page"],
    );
    const result = await expandDynamicRoutes([route], FIXTURES);
    expect(result.map((r) => r.sourceMtime)).toEqual([
      "2999-01-01T00:00:00.000Z",
      "2999-01-01T00:00:00.000Z",
    ]);
    const plain = pagedRoute(
      {
        $paths: { pageSize: 2, paginate: { $ref: "#/state/posts" } },
        state: { posts: [{ _meta: { mtime: "1999-01-01T00:00:00.000Z" } }, { id: "bare" }] },
      },
      "/old/*",
      ["p"],
    );
    const [plainPage] = await expandDynamicRoutes([plain], FIXTURES);
    expect(plainPage!.sourceMtime).toBeUndefined();
    cleanup();
  });

  test("each misconfiguration is a collected error and generates no pages", async () => {
    setup();
    const staticRoute = {
      $layout: null,
      isCatchAll: false,
      isDynamic: false,
      params: [],
      relativePath: "",
      sourcePath: "/x",
      urlPattern: "/",
    };
    const paging = { pageSize: 2, paginate: { $ref: "#/state/posts" } };
    const routes = [
      staticRoute,
      pagedRoute({ $paths: paging, state: { posts: five } }, "/two/:a/:b", ["a", "b"]),
      pagedRoute({ $paths: paging, state: {} }, "/missing/*", ["missing"]),
      pagedRoute({ $paths: paging, state: { posts: { count: 3 } } }, "/object/*", ["object"]),
      pagedRoute(
        {
          $paths: paging,
          state: { posts: { $prototype: "Nowhere", timing: "compiler" } },
        },
        "/unresolved/*",
        ["unresolved"],
      ),
      pagedRoute({ $paths: { ...paging, pageSize: 0 } }, "/size/*", ["size"]),
    ];
    const errors: string[] = [];
    const result = await expandDynamicRoutes(routes, FIXTURES, {}, undefined, undefined, null, {
      errors,
    });
    expect(result).toEqual([staticRoute]);
    expect(errors).toEqual([
      "Dynamic route /two/:a/:b: a paged route takes exactly one parameter besides those its each source fills; this one has 2",
      'Dynamic route /missing/*: $paths.paginate names state entry "posts", which this page does not declare',
      'Dynamic route /object/*: state entry "posts" did not resolve to an array at build time',
      'Dynamic route /unresolved/*: state entry "posts" did not resolve to an array at build time',
      "Dynamic route /size/*: $paths.pageSize must be a positive integer",
    ]);
    cleanup();
  });

  test("without an errors sink a misconfigured source throws", async () => {
    setup();
    const route = pagedRoute(
      { $paths: { pageSize: 0, paginate: { $ref: "#/state/posts" } } },
      "/blog/*",
      ["page"],
    );
    // oxlint-disable-next-line typescript/await-thenable -- Bun types `.rejects.toThrow` as void, but it resolves a Promise at runtime; the await is required.
    await expect(expandDynamicRoutes([route], FIXTURES)).rejects.toThrow(
      "Dynamic route /blog/*: $paths.pageSize must be a positive integer",
    );
    cleanup();
  });

  test("each may fill a catch-all while the page number fills a named parameter", async () => {
    setup();
    const route = pagedRoute(
      {
        $paths: {
          each: [{ section: "guides/setup" }],
          pageSize: 4,
          paginate: { $ref: "#/state/posts" },
        },
        state: { posts: five },
      },
      "/docs/*/page/:n",
      ["section", "n"],
    );
    const result = await expandDynamicRoutes([route], FIXTURES);
    expect(result.map((r) => r.urlPattern)).toEqual([
      "/docs/guides/setup/page/1",
      "/docs/guides/setup/page/2",
    ]);
    cleanup();
  });

  test("a list whose each value climbs out of the output is skipped", async () => {
    setup();
    const route = pagedRoute(
      {
        $paths: {
          each: { param: "tag", values: ["..", "ok"] },
          pageSize: 5,
          paginate: { $ref: "#/state/posts" },
        },
        state: { posts: five },
      },
      "/tags/:tag/*",
      ["tag", "page"],
    );
    const result = await expandDynamicRoutes([route], FIXTURES);
    expect(result.map((r) => r.urlPattern)).toEqual(["/tags/ok"]);
    cleanup();
  });
});
