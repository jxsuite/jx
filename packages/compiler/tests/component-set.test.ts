/**
 * Component-set.test.ts — which components a site build compiles (site-architecture.md §10.3).
 *
 * The set is two rules: every file directly in `components/`, and every component a page, a layout
 * or project.json names by `{ "$ref" }`, followed through each component's own `$elements`. A
 * `$ref` is relative to the file that wrote it, which is the thing the merged page forgets.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FormatRegistry } from "@jxsuite/schema/format-registry";
import type { JsonValue, ProjectConfig } from "@jxsuite/schema/types";
import { collectSiteComponents } from "../src/site/component-set";

const TMP = resolve(import.meta.dir, "__test-component-set__");
let seq = 0;

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

/** Write a project from a path → JSON map, plus files written as raw text. */
function project(files: Record<string, JsonValue>, raw: Record<string, string> = {}): string {
  seq += 1;
  const root = resolve(TMP, `p${seq}`);
  for (const [path, value] of Object.entries(files)) {
    const full = resolve(root, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, JSON.stringify(value), "utf8");
  }
  for (const [path, text] of Object.entries(raw)) {
    const full = resolve(root, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, text, "utf8");
  }
  mkdirSync(root, { recursive: true });
  return root;
}

async function collect(root: string, pages: string[] = [], projectConfig: ProjectConfig = {}) {
  const { components, errors } = await collectSiteComponents({
    formatRegistry: new FormatRegistry([]),
    pageSources: pages.map((p) => resolve(root, p)),
    projectConfig,
    projectRoot: root,
  });
  return { errors, tags: components.map((c) => c.tagName), components };
}

const comp = (tagName: string, $elements?: JsonValue): JsonValue =>
  $elements === undefined ? { tagName } : { $elements, tagName };

describe("collectSiteComponents", () => {
  it("lists every component directly in components/, sorted by name, and nothing below it", async () => {
    const root = project({
      "components/b-two.json": comp("b-two"),
      "components/a-one.json": comp("a-one"),
      "components/nested/c-three.json": comp("c-three"),
      "components/notes.txt": "not a component",
    });
    const { tags, errors, components } = await collect(root);
    expect(tags).toEqual(["a-one", "b-two"]);
    expect(errors).toEqual([]);
    expect(components[0]?.path).toBe(resolve(root, "components/a-one.json"));
    expect(components[0]?.doc.tagName).toBe("a-one");
  });

  it("is empty for a project with no components/ and nothing declared", async () => {
    const root = project({ "pages/index.json": { tagName: "main" } });
    expect(await collect(root, ["pages/index.json"])).toMatchObject({ errors: [], tags: [] });
  });

  it("adds a component a page names, resolved against the page's directory", async () => {
    const root = project({
      "pages/blog/_blog-card.json": comp("blog-card"),
      "pages/blog/index.json": { $elements: [{ $ref: "./_blog-card.json" }] },
    });
    // The same source twice (a dynamic route's expansions) is read once.
    const { tags, errors } = await collect(root, [
      "pages/blog/index.json",
      "pages/blog/index.json",
    ]);
    expect(tags).toEqual(["blog-card"]);
    expect(errors).toEqual([]);
  });

  it("resolves each layout's entries against that layout's directory, at every level of a nested layout", async () => {
    const root = project({
      "layouts/base.json": { $elements: [{ $ref: "./parts/site-nav.json" }] },
      "layouts/parts/site-nav.json": comp("site-nav"),
      "layouts/post/_post-meta.json": comp("post-meta"),
      "layouts/post/post.json": {
        $elements: [{ $ref: "./_post-meta.json" }],
        $layout: "./layouts/base.json",
      },
      "pages/index.json": { $layout: "./layouts/post/post.json" },
    });
    const { tags, errors } = await collect(root, ["pages/index.json"]);
    expect(tags).toEqual(["post-meta", "site-nav"]);
    expect(errors).toEqual([]);
  });

  it("resolves project.json's entries against the project root", async () => {
    const root = project({ "shared/x-badge.json": comp("x-badge") });
    const projectConfig: ProjectConfig = { $elements: [{ $ref: "./shared/x-badge.json" }] };
    const { tags, errors } = await collect(root, [], projectConfig);
    expect(tags).toEqual(["x-badge"]);
    expect(errors).toEqual([]);
  });

  it("names the project file the project has when one of its entries cannot compile", async () => {
    const root = project({}, { "project.jxn": "{}" });
    const projectConfig: ProjectConfig = { $elements: [{ $ref: "./shared/x-gone.json" }] };
    const { errors } = await collect(root, [], projectConfig);
    expect(errors).toEqual([
      'project.jxn: $elements entry "./shared/x-gone.json" names no file (shared/x-gone.json)',
    ]);
  });

  it("follows a component's own $ref entries transitively and lists each file once", async () => {
    const root = project({
      "components/a-host.json": comp("a-host", [{ $ref: "./nested/b-mid.json" }]),
      "components/nested/b-mid.json": comp("b-mid", [
        { $ref: "./c-leaf.json" },
        { $ref: "../a-host.json" },
      ]),
      "components/nested/c-leaf.json": comp("c-leaf"),
      "pages/index.json": { $elements: [{ $ref: "../components/nested/b-mid.json" }] },
    });
    const { tags, errors } = await collect(root, ["pages/index.json"]);
    expect(tags).toEqual(["a-host", "b-mid", "c-leaf"]);
    expect(errors).toEqual([]);
  });

  it("ignores bare-string entries, and entries that are not a $ref", async () => {
    const root = project({
      "pages/index.json": {
        $elements: ["@shoelace-style/shoelace", "./local.js", { $ref: "" }, { $ref: 3 }, null, 7],
      },
      "pages/other.json": { $elements: { $ref: "./nope.json" } },
    });
    const { tags, errors } = await collect(root, ["pages/index.json", "pages/other.json"]);
    expect(tags).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("refuses a $ref that names no file, naming the declarer, the entry and the resolved path", async () => {
    const root = project({
      "pages/blog/index.json": { $elements: [{ $ref: "./_blog-card.json" }] },
      "pages/blog/other.json": { $elements: [{ $ref: "./_blog-card.json" }] },
    });
    const { tags, errors } = await collect(root, [
      "pages/blog/index.json",
      "pages/blog/other.json",
    ]);
    expect(tags).toEqual([]);
    // Reported once, for the first document that names it.
    expect(errors).toEqual([
      'pages/blog/index.json: $elements entry "./_blog-card.json" names no file (pages/blog/_blog-card.json)',
    ]);
  });

  it("refuses a $ref that resolves outside the project root", async () => {
    const root = project({
      "pages/index.json": { $elements: [{ $ref: "../../outside/x-card.json" }] },
    });
    const { tags, errors } = await collect(root, ["pages/index.json"]);
    expect(tags).toEqual([]);
    expect(errors).toEqual([
      'pages/index.json: $elements entry "../../outside/x-card.json" names ../outside/x-card.json, outside the project',
    ]);
  });

  it("refuses a $ref to a document without a hyphenated tagName", async () => {
    const root = project({
      "data/nav.json": { items: [] },
      "pages/index.json": { $elements: [{ $ref: "../data/nav.json" }] },
    });
    const { tags, errors } = await collect(root, ["pages/index.json"]);
    expect(tags).toEqual([]);
    expect(errors).toEqual([
      'pages/index.json: $elements entry "../data/nav.json" names data/nav.json, which is not a component (no hyphenated tagName)',
    ]);
  });

  it("refuses a second file declaring a held tagName, naming both, and keeps the first", async () => {
    const root = project({
      "components/a.json": comp("dup-card"),
      "components/nested/b.json": comp("dup-card"),
      "pages/index.json": { $elements: [{ $ref: "../components/nested/b.json" }] },
    });
    const { components, errors } = await collect(root, ["pages/index.json"]);
    expect(components.map((c) => c.path)).toEqual([resolve(root, "components/a.json")]);
    expect(errors).toEqual([
      'components/a.json and components/nested/b.json both declare tagName "dup-card"; rename one',
    ]);
  });

  it("reports a seed that fails to parse, or has no hyphenated tagName, as a component compile error and leaves it out", async () => {
    const root = project(
      {
        "components/good-one.json": comp("good-one"),
        "components/plain.json": { tagName: "div" },
        "components/untagged.json": { children: [] },
      },
      { "components/broken.json": "{ not json" },
    );
    const { tags, errors } = await collect(root);
    expect(tags).toEqual(["good-one"]);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toStartWith("Error compiling component components/broken.json: ");
    expect(errors[1]).toBe(
      'Error compiling component components/plain.json: tagName "div" must contain a hyphen',
    );
    expect(errors[2]).toBe(
      'Error compiling component components/untagged.json: tagName "" must contain a hyphen',
    );
  });

  it("skips a page or a layout it cannot read", async () => {
    const root = project(
      {
        "components/ok-card.json": comp("ok-card"),
        "pages/orphan.json": {
          $elements: [{ $ref: "./_x-y.json" }],
          $layout: "./layouts/gone.json",
        },
      },
      { "pages/bad.json": "{ nope" },
    );
    const { tags, errors } = await collect(root, ["pages/bad.json", "pages/orphan.json"]);
    expect(tags).toEqual(["ok-card"]);
    expect(errors).toEqual([]);
  });
});
