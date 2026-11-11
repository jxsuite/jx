/**
 * Site-build-declared-components.test.ts — a build compiles what a document declares, wherever the
 * file lives (site-architecture.md §10.3, imports.md §1.3).
 *
 * Each case is a build that used to come out green and wrong: a co-located `_blog-card.json` or a
 * `components/nested/` file a page named shipped as an empty custom-element tag with no module; a
 * dependency below the top level was written as `<tag>.js` and imported from a path nothing wrote;
 * two files declaring one tag built with the module of one and the stylesheet of the other.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSite } from "../src/site/site-build";
import type { JsonValue } from "@jxsuite/schema/types";

const BASE = resolve(import.meta.dir, "__test-site-declared-comp__");

function writeJSON(root: string, path: string, obj: JsonValue) {
  const full = resolve(root, path);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify(obj, null, 2), "utf8");
}

const read = (root: string, path: string) => readFileSync(resolve(root, "dist", path), "utf8");

/** A component with a runtime `state` entry, so the build loads its module rather than omit it. */
const live = (tagName: string, extra: Record<string, JsonValue> = {}): JsonValue => ({
  children: [
    { tagName: "span", textContent: "${state.count}" },
    { onclick: { $ref: "#/state/bump" }, tagName: "button", textContent: "+" },
  ],
  state: { bump: { $prototype: "Function", body: "state.count++" }, count: 0 },
  tagName,
  ...extra,
});

afterAll(() => {
  rmSync(BASE, { force: true, recursive: true });
});

describe("buildSite — components a document declares by $ref", () => {
  const TMP = resolve(BASE, "ok");
  let errors: string[] = [];

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "declared" });
    writeJSON(TMP, "pages/blog/_blog-card.json", live("blog-card"));
    writeJSON(TMP, "components/nested/deep-card.json", live("deep-card"));
    writeJSON(TMP, "components/nested/styled-dep.json", {
      children: [{ tagName: "em", textContent: "dep" }],
      style: { color: "rebeccapurple" },
      tagName: "styled-dep",
    });
    writeJSON(
      TMP,
      "components/host-card.json",
      live("host-card", {
        $elements: [{ $ref: "./nested/styled-dep.json" }],
        children: [{ tagName: "span", textContent: "${state.count}" }, { tagName: "styled-dep" }],
      }),
    );
    writeJSON(TMP, "layouts/parts/_layout-chip.json", live("layout-chip"));
    writeJSON(TMP, "layouts/base.json", {
      children: [{ tagName: "slot" }],
      tagName: "div",
    });
    writeJSON(TMP, "layouts/parts/post.json", {
      $elements: [{ $ref: "./_layout-chip.json" }],
      $layout: "./layouts/base.json",
      children: [{ tagName: "layout-chip" }, { tagName: "slot" }],
      tagName: "article",
    });
    writeJSON(TMP, "pages/blog/index.json", {
      $elements: [
        { $ref: "./_blog-card.json" },
        { $ref: "../../components/nested/deep-card.json" },
      ],
      $layout: "./layouts/parts/post.json",
      children: [{ tagName: "blog-card" }, { tagName: "deep-card" }, { tagName: "host-card" }],
      title: "Blog",
    });
    ({ errors } = await buildSite(TMP));
  });

  it("builds without errors", () => {
    expect(errors).toEqual([]);
  });

  it("a co-located _-prefixed component a page names is compiled and loaded, and is not routed", () => {
    expect(existsSync(resolve(TMP, "dist/components/blog-card.js"))).toBe(true);
    expect(read(TMP, "blog/index.html")).toContain("/components/blog-card.js");
    expect(existsSync(resolve(TMP, "dist/blog/_blog-card"))).toBe(false);
  });

  it("a component in a subdirectory of components/ that a page names is compiled", () => {
    expect(existsSync(resolve(TMP, "dist/components/deep-card.js"))).toBe(true);
    expect(read(TMP, "blog/index.html")).toContain("/components/deep-card.js");
  });

  it("an intermediate layout's declared component is compiled", () => {
    expect(existsSync(resolve(TMP, "dist/components/layout-chip.js"))).toBe(true);
    expect(read(TMP, "blog/index.html")).toContain("/components/layout-chip.js");
  });

  it("a dependency outside the top level is imported from where the build writes it", () => {
    expect(existsSync(resolve(TMP, "dist/components/styled-dep.js"))).toBe(true);
    const host = read(TMP, "components/host-card.js");
    expect(host).toContain("./styled-dep.js");
    expect(host).not.toContain("nested/styled-dep");
  });

  it("that dependency gets its stylesheet and its prerender", () => {
    expect(read(TMP, "components/styled-dep.css")).toContain("rebeccapurple");
    const html = read(TMP, "blog/index.html");
    expect(html).toContain("rebeccapurple");
    expect(html).toMatch(/<styled-dep[^>]*>\s*<em>dep<\/em>/);
  });
});

describe("buildSite — a declared component the build cannot compile", () => {
  it("a declared $ref that names no file fails the build and names the page", async () => {
    const TMP = resolve(BASE, "missing");
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "missing" });
    writeJSON(TMP, "pages/index.json", {
      $elements: [{ $ref: "./_gone-card.json" }],
      children: [{ tagName: "gone-card" }],
      title: "Home",
    });
    const { errors } = await buildSite(TMP);
    expect(errors).toEqual([
      'pages/index.json: $elements entry "./_gone-card.json" names no file (pages/_gone-card.json)',
    ]);
    // The page itself still builds.
    expect(existsSync(resolve(TMP, "dist/index.html"))).toBe(true);
  });

  it("two files declaring one tagName fail the build and name both", async () => {
    const TMP = resolve(BASE, "dup");
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "dup" });
    writeJSON(TMP, "components/a.json", live("dup-card", { style: { color: "red" } }));
    writeJSON(TMP, "components/b.json", live("dup-card", { style: { color: "blue" } }));
    writeJSON(TMP, "pages/index.json", { children: [{ tagName: "dup-card" }], title: "Home" });
    const { errors } = await buildSite(TMP);
    expect(errors).toEqual([
      'components/a.json and components/b.json both declare tagName "dup-card"; rename one',
    ]);
    // One file supplies the whole component: the first.
    const css = read(TMP, "components/dup-card.css");
    expect(css).toContain("red");
    expect(css).not.toContain("blue");
  });
});

describe("buildSite — declared components and the other build steps", () => {
  it("a nested component's server entry is bundled from its own directory", async () => {
    const TMP = resolve(BASE, "server");
    writeJSON(TMP, "project.json", {
      build: { adapter: "cloudflare-workers", outDir: "./dist" },
      name: "server",
      url: "https://test.com",
    });
    writeJSON(TMP, "components/nested/x.json", {
      children: [{ children: ["Contact"], tagName: "form" }],
      state: { nestedSend: { $export: "nestedSend", $src: "./x.server.js", timing: "server" } },
      tagName: "x-contact",
    });
    writeFileSync(
      resolve(TMP, "components/nested/x.server.js"),
      "export function nestedSend(args) { return { ok: true }; }\n",
      "utf8",
    );
    writeJSON(TMP, "pages/index.json", {
      $elements: [{ $ref: "../components/nested/x.json" }],
      children: [{ $props: {}, tagName: "x-contact" }],
      title: "Home",
    });
    const { errors } = await buildSite(TMP);
    expect(errors).toEqual([]);
    expect(read(TMP, "worker.js")).toContain("function nestedSend");
  });

  it("an intermediate layout's bare-string entry is bundled", async () => {
    const TMP = resolve(BASE, "npm");
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "npm" });
    writeJSON(TMP, "layouts/base.json", { children: [{ tagName: "slot" }], tagName: "div" });
    writeJSON(TMP, "layouts/inner.json", {
      $elements: ["@shoelace-style/shoelace/dist/components/button/button.js"],
      $layout: "./layouts/base.json",
      children: [{ children: ["Go"], tagName: "sl-button" }, { tagName: "slot" }],
      tagName: "section",
    });
    writeJSON(TMP, "pages/index.json", {
      $layout: "./layouts/inner.json",
      children: [{ children: ["Hi"], tagName: "p" }],
      title: "Home",
    });
    const { errors } = await buildSite(TMP);
    expect(errors).toEqual([]);
    const html = read(TMP, "index.html");
    const src = /src="(\/assets\/[^"]+)"/.exec(html)?.[1] ?? "";
    expect(src).not.toBe("");
    expect(existsSync(resolve(TMP, `dist${src}`))).toBe(true);
  });
});
