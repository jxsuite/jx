/**
 * Paged routes through the whole build (site-architecture.md §4.3): each page is written with its
 * slice and its pager, the list is resolved once for all its pages, the pages are in the sitemap,
 * and a misconfigured page fails the build without taking the rest of the site with it.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import { buildSite } from "../src/site/site-build";

const TMP = resolve(import.meta.dir, "__test-site-pagination__");

function write(path: string, content: string) {
  const file = resolve(TMP, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function writeJson(path: string, value: JsonValue) {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

const read = (path: string) => readFileSync(resolve(TMP, "dist", path), "utf8");

/** A paged page listing `key`'s titles, with a link to the next page when there is one. */
function listing(paths: JsonObject, state: JsonObject, key: string): JsonObject {
  return {
    $paths: paths,
    children: [
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: `#/state/${key}` },
            map: { tagName: "li", textContent: "${$map.item.data.title}" },
          },
        ],
        tagName: "ul",
      },
      {
        attributes: { href: "${state.$page.pagination.next ?? ''}" },
        tagName: "a",
        textContent: "${state.$page.pagination.number} of ${state.$page.pagination.pageCount}",
      },
    ],
    state,
    tagName: "main",
  };
}

let errors: string[] = [];

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });
  writeJson("project.json", {
    build: { outDir: "./dist" },
    content: {
      posts: {
        format: "Markdown",
        schema: {
          properties: {
            date: { format: "date-time", type: "string" },
            tags: { items: { type: "string" }, type: "array" },
            title: { type: "string" },
          },
          type: "object",
        },
        source: "./content/posts/",
      },
    },
    defaults: { layout: false },
    extensions: ["@jxsuite/parser"],
    imports: { Counter: "./classes/counter.class.json" },
    name: "Paging",
    url: "https://paging.test",
  });
  for (let n = 1; n <= 5; n++) {
    const tags = n % 2 === 0 ? "[even]" : "[odd]";
    write(
      `content/posts/post-${n}.md`,
      `---\ntitle: Post ${n}\ndate: "2026-0${n}-01T00:00:00Z"\ntags: ${tags}\n---\nBody ${n}\n`,
    );
    // The newest entry is dated after every template, so it dates every page of its list.
    const when = n === 5 ? new Date("2030-01-01T00:00:00Z") : new Date("2001-01-01T00:00:00Z");
    utimesSync(resolve(TMP, `content/posts/post-${n}.md`), when, when);
  }
  writeJson("classes/counter.class.json", {
    $implementation: "./counter.js",
    $prototype: "Class",
    title: "Counter",
  });
  write(
    "classes/counter.js",
    'import { appendFileSync } from "node:fs";\n' +
      "export class Counter {\n  constructor(config) { this.config = config; }\n" +
      '  resolve() {\n    appendFileSync(new URL("../resolves.log", import.meta.url), "x");\n' +
      "    return [1, 2, 3, 4, 5].map((n) => ({ data: { title: `Item ${n}` } }));\n  }\n}\n",
  );
  const posts: JsonObject = {
    $prototype: "ContentCollection",
    contentType: "posts",
    sort: [{ field: "date", order: "desc" }],
    timing: "compiler",
  };
  writeJson("pages/index.json", { tagName: "main", textContent: "Home" });
  writeJson(
    "pages/blog/[...page].json",
    listing({ pageSize: 2, paginate: { $ref: "#/state/posts" } }, { posts }, "posts"),
  );
  writeJson(
    "pages/tags/[tag]/[...page].json",
    listing(
      {
        each: { param: "tag", values: ["even", "odd"] },
        pageSize: 2,
        paginate: { $ref: "#/state/tagged" },
      },
      {
        tagged: {
          ...posts,
          filter: [{ field: "tags", op: "contains", value: { $ref: "#/$params/tag" } }],
        },
      },
      "tagged",
    ),
  );
  writeJson(
    "pages/count/[...page].json",
    listing(
      { pageSize: 2, paginate: { $ref: "#/state/items" } },
      { items: { $prototype: "Counter", timing: "compiler" } },
      "items",
    ),
  );
  writeJson(
    "pages/broken/[...page].json",
    listing({ pageSize: 0, paginate: { $ref: "#/state/posts" } }, { posts }, "posts"),
  );
  ({ errors } = await buildSite(TMP, { verbose: false }));
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("a paged route", () => {
  it("builds each page with its slice", () => {
    const first = read("blog/index.html");
    expect(first).toContain("<li>Post 5</li>");
    expect(first).toContain("<li>Post 4</li>");
    expect(first).not.toContain("Post 3");
    expect(first).toContain('href="/blog/2"');
    expect(first).toContain("1 of 3");
    const last = read("blog/3/index.html");
    expect(last).toContain("<li>Post 1</li>");
    expect(last).not.toContain("Post 2");
    expect(last).toContain("3 of 3");
  });

  it("ships no script for a page whose list the build wrote out", () => {
    // `$paths.paginate` points at the paged entry, and is route metadata, not a read of it.
    for (const page of ["blog/index.html", "blog/3/index.html", "tags/odd/2/index.html"]) {
      expect(read(page)).not.toContain("<script");
    }
  });

  it("pages a list once per value of its each source", () => {
    const even = read("tags/even/index.html");
    expect(even).toContain("<li>Post 4</li>");
    expect(even).toContain("<li>Post 2</li>");
    expect(read("tags/odd/index.html")).toContain('href="/tags/odd/2"');
    expect(read("tags/odd/2/index.html")).toContain("<li>Post 1</li>");
    expect(existsSync(resolve(TMP, "dist/tags/even/2/index.html"))).toBe(false);
  });

  it("resolves the paged entry once for all its pages", () => {
    expect(read("count/3/index.html")).toContain("<li>Item 5</li>");
    expect(readFileSync(resolve(TMP, "resolves.log"), "utf8")).toBe("x");
  });

  it("lists every page in the sitemap, dated by the newest entry", () => {
    const sitemap = read("sitemap.xml");
    for (const url of ["/blog", "/blog/2", "/blog/3", "/tags/odd/2"]) {
      expect(sitemap).toContain(`<loc>https://paging.test${url}`);
    }
    const blogEntry = sitemap.slice(sitemap.indexOf("https://paging.test/blog/2"));
    expect(blogEntry.slice(0, blogEntry.indexOf("</url>"))).toContain("<lastmod>2030-01-01");
  });

  it("fails the build when misconfigured, and the rest of the site still builds", () => {
    expect(errors).toEqual(["Dynamic route /broken/*: $paths.pageSize must be a positive integer"]);
    expect(existsSync(resolve(TMP, "dist/broken"))).toBe(false);
    expect(existsSync(resolve(TMP, "dist/index.html"))).toBe(true);
  });
});
