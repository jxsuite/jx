/**
 * The live preview's `$page` and `$site` against the build's (site-architecture.md §5.5). Both
 * hosts read the same facts from the same files, so for a page whose values need no state
 * resolution the composed state is the built state, field for field. What the preview cannot
 * compute (a translation set, a templated title) is named in the spec and not compared here.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { composeRoute, readProjectConfig, routeTable } from "@jxsuite/site/compose";
import type { SiteIO } from "@jxsuite/site/compose";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue, JxStateDefinition } from "@jxsuite/schema/types";
import { buildSite } from "../src/site/site-build.ts";

const DIR = resolve(import.meta.dir, "__test-page-context-parity__");

const FILES = {
  "layouts/base.json": {
    children: [
      { attributes: { id: "title" }, tagName: "p", textContent: "${state.$page.title}" },
      {
        attributes: { id: "description" },
        tagName: "p",
        textContent: "${state.$page.description ?? ''}",
      },
      { attributes: { id: "url" }, tagName: "p", textContent: "${state.$page.url}" },
      { attributes: { id: "locale" }, tagName: "p", textContent: "${state.$page.locale}" },
      { attributes: { id: "site" }, tagName: "p", textContent: "${state.$site.name}" },
      { tagName: "slot" },
    ],
    tagName: "div",
    title: "Shell",
  },
  "pages/about.json": {
    $head: [{ attributes: { content: "About us", name: "description" }, tagName: "meta" }],
    $lang: "fr",
    $layout: "./layouts/base.json",
    children: [{ tagName: "main", textContent: "About" }],
    title: "About",
  },
  "pages/blog/[slug].json": {
    $layout: "./layouts/base.json",
    $paths: { param: "slug", values: ["hello"] },
    children: [
      { attributes: { id: "param" }, tagName: "p", textContent: "${state.$page.params.slug}" },
    ],
    title: "Post",
  },
  "pages/docs/[...path].json": {
    $layout: "./layouts/base.json",
    $paths: { param: "path", values: ["a/b"] },
    children: [
      { attributes: { id: "param" }, tagName: "p", textContent: "${state.$page.params.path}" },
    ],
    title: "Docs",
  },
} satisfies Record<string, JsonObject>;

const FILE_MAP = new Map<string, JsonObject>(Object.entries(FILES));

/** A `SiteIO` over the same files the build reads. */
function diskIO(): SiteIO {
  return {
    paths: () => [...FILE_MAP.keys()].filter((path) => path.startsWith("pages/")),
    read: (path) => {
      const doc = FILE_MAP.get(path);
      return Promise.resolve(doc === undefined ? null : JSON.stringify(doc));
    },
  };
}

/** One field of a state object, whatever the object turns out to be. */
const field = (object: JxStateDefinition | undefined, key: string): JsonValue | undefined =>
  isJsonObject(object) ? object[key] : undefined;

const text = (source: string, id: string) =>
  new RegExp(`<p id="${id}">([^<]*)</p>`).exec(source)?.[1] ?? "";

describe("the live preview's $page and $site agree with the build", () => {
  beforeAll(async () => {
    rmSync(DIR, { force: true, recursive: true });
    mkdirSync(DIR, { recursive: true });
    writeFileSync(
      resolve(DIR, "project.json"),
      JSON.stringify({ build: { outDir: "./dist" }, defaults: { lang: "en" }, name: "Parity" }),
    );
    for (const [path, doc] of FILE_MAP) {
      mkdirSync(resolve(DIR, path, ".."), { recursive: true });
      writeFileSync(resolve(DIR, path), JSON.stringify(doc));
    }
    const result = await buildSite(DIR, { verbose: false });
    expect(result.errors).toHaveLength(0);
  }, 60_000);

  afterAll(() => {
    rmSync(DIR, { force: true, recursive: true });
  });

  it.each([
    ["/about", "about/index.html"],
    ["/blog/hello", "blog/hello/index.html"],
    ["/docs/a/b", "docs/a/b/index.html"],
  ])("%s", async (url, built) => {
    const config = await readProjectConfig({
      paths: () => [],
      read: (path) =>
        Promise.resolve(path === "project.json" ? readFileSync(resolve(DIR, path), "utf8") : null),
    });
    const composed = await composeRoute(diskIO(), routeTable(diskIO().paths()), config, url);
    const source = readFileSync(resolve(DIR, "dist", built), "utf8");
    const state = composed?.doc.state;
    const page = state?.$page;
    const site = state?.$site;
    expect(text(source, "title")).toBe(String(field(page, "title")));
    expect(text(source, "description")).toBe(String(field(page, "description") ?? ""));
    expect(text(source, "url")).toBe(String(field(page, "url")));
    expect(text(source, "locale")).toBe(String(field(page, "locale")));
    expect(text(source, "site")).toBe(String(field(site, "name")));
    if (url !== "/about") {
      const params = field(page, "params");
      const [first] = isJsonObject(params) ? Object.values(params) : [];
      expect(text(source, "param")).toBe(String(first));
    }
  });
});
