/**
 * Site-build-shared-dependency.test.ts — issue #330, built end to end.
 *
 * `compileElement` returns a component's `$elements` dependencies as extra files, and the
 * component-compile stage of `buildSite` recorded one tag per file it was handed. A dependency two
 * parents name was therefore recorded once per parent, plus once for its own compile, and
 * `injectComponentScripts` inlined its stylesheet and loaded its module once per record. The
 * issue's shape is card → button → icon: three copies of `lcb-icon { display: inline-block }` in
 * one `<head>`. Here the icon is reached through two parents AND directly from the page, and its
 * rule and its module must each land exactly once. The same duplicate records also wrote the icon's
 * module three times (identical bytes) and counted every write, so the build report over-counted;
 * the reported figure must equal the files actually on disk.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSite } from "../src/site/site-build";

/** @param {string} root @param {string} path @param {unknown} obj */
function writeJSON(root: string, path: string, obj: unknown) {
  const full = resolve(root, path);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify(obj, null, 2), "utf8");
}

/** How many times `needle` occurs in `haystack`, non-overlapping. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The `<head>` of a built page. */
function headOf(html: string): string {
  return html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
}

// ── The issue's shape: card → button → icon, plus the icon on the page itself ─

describe("buildSite — a dependency shared by two parents is emitted once (issue #330)", () => {
  const TMP = resolve(import.meta.dir, "__test-site-shared-dep__");
  let errors: string[] = [];
  let files = 0;
  let html = "";

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "shared" });
    // The leaf: a live component (it has a handler), so its module is loaded as well as its CSS —
    // A static leaf would prove the rule but not the script.
    writeJSON(TMP, "components/lcb-icon.json", {
      children: [{ onclick: { $ref: "#/state/tap" }, tagName: "i", textContent: "${state.name}" }],
      state: { name: "arrow", tap: { $prototype: "Function", body: "state.name = 'tapped';" } },
      style: { display: "inline-block" },
      tagName: "lcb-icon",
    });
    // Two parents that each name the leaf in `$elements`: the icon comes back as an extra file
    // From BOTH compiles, and then once more from its own.
    writeJSON(TMP, "components/lcb-button.json", {
      $elements: [{ $ref: "./lcb-icon.json" }],
      children: [{ tagName: "lcb-icon" }],
      style: { padding: "4px" },
      tagName: "lcb-button",
    });
    writeJSON(TMP, "components/lcb-card.json", {
      $elements: [{ $ref: "./lcb-button.json" }, { $ref: "./lcb-icon.json" }],
      children: [{ tagName: "lcb-button" }, { tagName: "lcb-icon" }],
      style: { border: "1px solid" },
      tagName: "lcb-card",
    });
    writeJSON(TMP, "pages/index.json", {
      $layout: false,
      children: [{ tagName: "lcb-card" }, { tagName: "lcb-icon" }],
      tagName: "div",
      title: "shared",
    });
    ({ errors, files } = await buildSite(TMP, { verbose: false }));
    html = readFileSync(resolve(TMP, "dist/index.html"), "utf8");
  });

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  it("builds without error", () => {
    expect(errors).toEqual([]);
  });

  it("inlines the shared dependency's rule exactly once", () => {
    expect(count(headOf(html), "lcb-icon { display: inline-block }")).toBe(1);
  });

  it("inlines each parent's rule exactly once too", () => {
    expect(count(headOf(html), "lcb-card { border: 1px solid }")).toBe(1);
    expect(count(headOf(html), "lcb-button { padding: 4px }")).toBe(1);
  });

  it("loads the shared dependency's module exactly once, and preloads it once", () => {
    expect(count(html, '<script type="module" src="/components/lcb-icon.js"></script>')).toBe(1);
    expect(count(html, '<link rel="modulepreload" href="/components/lcb-icon.js">')).toBe(1);
  });

  it("keeps the order the first occurrence had", () => {
    // `compileElement` walks `$elements` depth-first and returns a dependency BEFORE its
    // Dependent, so the result does not depend on which parent the directory listing compiles
    // First: button-first yields [icon, button] then [button, icon, card]; card-first yields
    // [icon, button, icon, card] then [icon, button]. Either way the first-seen order is icon,
    // Button, card, and a later duplicate must not move an earlier tag: equal-specificity rules
    // Cascade by source order.
    const head = headOf(html);
    expect(head.indexOf("lcb-icon {")).toBeLessThan(head.indexOf("lcb-button {"));
    expect(head.indexOf("lcb-button {")).toBeLessThan(head.indexOf("lcb-card {"));
  });

  it("reports the files it produced, not the writes it attempted", () => {
    // Three arrivals of the icon's module used to be three writes of the same bytes and three
    // Counts; the report now matches the tree on disk exactly (14 reported for 11 files before).
    const onDisk = readdirSync(resolve(TMP, "dist"), { recursive: true, withFileTypes: true });
    expect(files).toBe(onDisk.filter((entry) => entry.isFile()).length);
  });
});
