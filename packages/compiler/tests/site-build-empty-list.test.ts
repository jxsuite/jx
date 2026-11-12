/**
 * Site-build-empty-list.test.ts — what the build does with a mapped Array whose `items` is empty.
 *
 * Two answers, decided by where the list's data comes from (compiler.md §8.1, spec.md §10.5):
 *
 * - A source the build itself resolved (a class-resolved entry such as a content collection, a paged
 *   slice, the `$site`/`$page` context, a `$map/` pointer in a row the build expanded, a literal)
 *   is finished. An empty one renders nothing and ships nothing for the list.
 * - Client state that merely STARTS empty is the client's to fill, so the repeater keeps its binding.
 *   Collapsing that one is the defect `site-build-component-loading.test.ts` pins.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSite } from "../src/site/site-build";
import type { JsonValue } from "@jxsuite/schema/types";

const TMP = resolve(import.meta.dir, "__test-empty-list__");

/** @param {string} path @param {string} text */
function write(path: string, text: string) {
  const full = resolve(TMP, path);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, text, "utf8");
}

/** @param {string} path @param {JsonValue} obj */
function writeJSON(path: string, obj: JsonValue) {
  write(path, JSON.stringify(obj, null, 2));
}

/** @param {string} page @returns {string} The built page's HTML */
function html(page: string): string {
  return readFileSync(resolve(TMP, "dist", page, "index.html"), "utf8");
}

/**
 * @param {string} page
 * @returns {string} The page's `<main>`, the part the document authored, without the emitter's
 *   indentation between tags
 */
function main(page: string): string {
  return (/<main[\s\S]*<\/main>/.exec(html(page))?.[0] ?? "").replaceAll(/>\s+</g, "><");
}

/** A list among siblings, so a collapse that took a neighbour with it would show. */
const SIBLINGS = (items: JsonValue): JsonValue => [
  { tagName: "h1", textContent: "Rows" },
  { $prototype: "Array", items, map: { tagName: "li", textContent: "${$map.item.name}" } },
  { tagName: "p", textContent: "end" },
];

const ROWS_REF = { $ref: "#/state/rows" };

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });
  writeJSON("project.json", {
    build: { outDir: "./dist" },
    defaults: { layout: false },
    imports: { Rows: "./classes/rows.class.json" },
    name: "Empty Lists",
    // Reaches a page as `$site.links`: injected context, read-only (site-architecture.md §10.4).
    state: { links: [] },
  });
  writeJSON("classes/rows.class.json", {
    $implementation: "./rows.js",
    $prototype: "Class",
    title: "Rows",
  });
  // Resolves to the `rows` it was configured with, and to an empty list when given none.
  write(
    "classes/rows.js",
    "export class Rows {\n  constructor(config) { this.config = config; }\n" +
      "  resolve() { return this.config.rows ?? []; }\n}\n",
  );
  writeJSON("pages/index.json", { tagName: "main", textContent: "Home" });

  // ── Build-resolved sources ──
  writeJSON("pages/compiler-timed.json", {
    children: SIBLINGS(ROWS_REF),
    state: { rows: { $prototype: "Rows", timing: "compiler" } },
    tagName: "main",
  });
  writeJSON("pages/untimed-class.json", {
    children: { $prototype: "Array", items: ROWS_REF, map: { tagName: "li" } },
    state: { rows: { $prototype: "Rows" } },
    tagName: "main",
  });
  writeJSON("pages/literal.json", { children: SIBLINGS([]), tagName: "main" });
  writeJSON("pages/nested.json", {
    children: [
      {
        $prototype: "Array",
        items: { $ref: "#/state/groups" },
        map: {
          children: [
            { tagName: "h2", textContent: "${$map.item.name}" },
            {
              $prototype: "Array",
              items: { $ref: "$map/item/tags" },
              map: { tagName: "li", textContent: "${$map.item}" },
            },
          ],
          tagName: "section",
        },
      },
    ],
    state: {
      groups: {
        $prototype: "Rows",
        rows: [
          { name: "bare", tags: [] },
          { name: "tagged", tags: ["x"] },
        ],
        timing: "compiler",
      },
    },
    tagName: "main",
  });
  writeJSON("pages/paged/[...page].json", {
    $paths: { pageSize: 2, paginate: ROWS_REF },
    children: SIBLINGS(ROWS_REF),
    state: { rows: { $prototype: "Rows", timing: "compiler" } },
    tagName: "main",
  });
  writeJSON("pages/context.json", {
    children: SIBLINGS({ $ref: "#/state/$site/links" }),
    tagName: "main",
  });
  writeJSON("pages/populated.json", {
    children: SIBLINGS(ROWS_REF),
    state: { rows: { $prototype: "Rows", rows: [{ name: "one" }, { name: "two" }] } },
    tagName: "main",
  });

  // ── Runtime sources ──
  writeJSON("pages/client-default.json", {
    children: SIBLINGS(ROWS_REF),
    state: { rows: { default: [] } },
    tagName: "main",
  });
  writeJSON("pages/client-bare.json", {
    children: SIBLINGS(ROWS_REF),
    state: { rows: [] },
    tagName: "main",
  });
  writeJSON("pages/written.json", {
    children: [
      { onclick: { $ref: "#/state/add" }, tagName: "button", textContent: "Add" },
      { $prototype: "Array", items: ROWS_REF, map: { tagName: "li", textContent: "row" } },
    ],
    state: {
      add: { $prototype: "Function", body: "state.rows.push({ name: 'new' });" },
      rows: { $prototype: "Rows" },
    },
    tagName: "main",
  });
  writeJSON("pages/request.json", {
    children: SIBLINGS(ROWS_REF),
    state: { rows: { $prototype: "Request", url: "/rows.json" } },
    tagName: "main",
  });

  await buildSite(TMP, { verbose: false });
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("buildSite — an empty list the build resolved renders nothing and stays static", () => {
  for (const page of ["compiler-timed", "literal", "context"]) {
    it(`${page}: no rows, no binding, no script, siblings intact`, () => {
      expect(main(page)).toBe("<main><h1>Rows</h1><p>end</p></main>");
      expect(html(page)).not.toContain("<script");
    });
  }

  it("the empty slice of a paged route collapses too, and its page is static", () => {
    // `$paths.paginate` is a `#/state/rows` pointer. Route discovery consumed it, so it is not a
    // Read that keeps the slice in the page's state.
    expect(main("paged")).toBe("<main><h1>Rows</h1><p>end</p></main>");
    const built = html("paged");
    expect(built).not.toContain(":render=");
    expect(built).not.toContain("<script");
  });

  it("an entry with no timing that its class resolved, in the whole-children form", () => {
    expect(main("untimed-class")).toBe("<main></main>");
    expect(html("untimed-class")).not.toContain("<script");
  });

  it("a nested list over a row the build expanded: the empty row has no list, the other its items", () => {
    expect(main("nested")).toBe(
      "<main><section><h2>bare</h2></section><section><h2>tagged</h2><li>x</li></section></main>",
    );
    expect(html("nested")).not.toContain("<script");
  });

  it("a non-empty list still prerenders its rows", () => {
    expect(main("populated")).toBe("<main><h1>Rows</h1><li>one</li><li>two</li><p>end</p></main>");
    expect(html("populated")).not.toContain("<script");
  });
});

describe("buildSite — an empty list over runtime state keeps its client binding", () => {
  for (const page of ["client-default", "client-bare", "request"]) {
    it(`${page}: the repeater is left for the client`, () => {
      const built = html(page);
      expect(built).toContain(":render=");
      expect(built).toContain("<script");
    });
  }

  it("a build-resolved entry a handler writes is the client's to grow", () => {
    const built = html("written");
    expect(built).toContain(":render=");
    expect(built).toContain("<script");
  });
});
