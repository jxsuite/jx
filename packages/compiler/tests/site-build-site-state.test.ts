/**
 * Site-build-site-state.test.ts — what a built page pays for the project's `state`.
 *
 * Every project `state` entry reaches a page twice: read-only under `$site`, and as the page's own
 * entry when neither the page nor its layout declares the key. The second copy is a naked value, so
 * left alone it made every page of a site dynamic the moment the project declared one constant. A
 * built page keeps it only while something on the page still reads it bare.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSite } from "../src/site/site-build";
import type { JsonValue } from "@jxsuite/schema/types";

const TMP = resolve(import.meta.dir, "__test-site-state__");

function writeJSON(path: string, obj: JsonValue) {
  mkdirSync(resolve(TMP, ...path.split("/").slice(0, -1)), { recursive: true });
  writeFileSync(resolve(TMP, path), JSON.stringify(obj, null, 2), "utf8");
}

/** A page under its own layout, so a dynamic page's island is `dist/<name>/<tag>.js`. */
function page(
  name: string,
  tag: string,
  doc: Record<string, JsonValue>,
  layoutState: JsonValue = {},
) {
  writeJSON(`layouts/${tag}.json`, {
    children: [{ tagName: "slot" }],
    state: layoutState,
    tagName: tag,
  });
  writeJSON(`pages/${name}.json`, { $layout: `./layouts/${tag}.json`, title: name, ...doc });
}

const html = (name: string) => readFileSync(resolve(TMP, "dist", name, "index.html"), "utf8");
const islandPath = (name: string, tag: string) => resolve(TMP, "dist", name, `${tag}.js`);
const island = (name: string, tag: string) => readFileSync(islandPath(name, tag), "utf8");

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });

  writeJSON("project.json", {
    build: { outDir: "./dist" },
    name: "Probe",
    state: {
      clicks: 0,
      name: "Shadow",
      siteName: "Acme",
      tagline: "Hello",
      theme: "dark",
      track: { $prototype: "Function", $src: "./track.js" },
    },
    url: "https://example.com",
  });
  mkdirSync(resolve(TMP, "pages"), { recursive: true });
  writeFileSync(resolve(TMP, "pages/track.js"), "export function track() {}\n", "utf8");
  writeFileSync(resolve(TMP, "pages/sidecar.js"), "export function go() {}\n", "utf8");

  page("plain", "plain-shell", { children: [{ tagName: "p", textContent: "Fixed text" }] });

  page("about", "about-shell", {
    children: [
      { tagName: "p", textContent: "${$site.siteName}" },
      { tagName: "p", textContent: "${state.tagline}" },
      { tagName: "p", textContent: "${$site.name} / ${state.name}" },
    ],
  });

  page("counter", "counter-shell", {
    children: [
      { onclick: { $ref: "#/state/bump" }, tagName: "button", textContent: "${state.clicks}" },
    ],
    state: { bump: { $prototype: "Function", body: "state.clicks++" } },
  });

  const themed = [{ tagName: "p", textContent: "${state.theme}" }];
  /* A handler keeps each page dynamic, so the island is there to read the precedence from. */
  const poke = { $prototype: "Function", body: "state.theme = state.theme + '!'" };
  page("page-theme", "page-shell", {
    children: [...themed, { onclick: { $ref: "#/state/poke" }, tagName: "button" }],
    state: { poke, theme: "light" },
  });
  page(
    "layout-theme",
    "themed-shell",
    {
      children: [...themed, { onclick: { $ref: "#/state/poke" }, tagName: "button" }],
      state: { poke },
    },
    { theme: "sepia" },
  );

  page("sidecar", "sidecar-shell", {
    children: [{ onclick: { $ref: "#/state/go" }, tagName: "button", textContent: "Go" }],
    state: { go: { $prototype: "Function", $src: "./sidecar.js" } },
  });
  page("tracked", "tracked-shell", {
    children: [{ onclick: { $ref: "#/state/track" }, tagName: "button", textContent: "Track" }],
  });

  await buildSite(TMP, { verbose: false });
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("project state on a built page", () => {
  test("a page that reads no site state ships no JavaScript", () => {
    expect(html("plain")).not.toContain("plain-shell.js");
    expect(existsSync(islandPath("plain", "plain-shell"))).toBe(false);
  });

  test("site state read through $site or as a constant is prerendered, and the page stays static", () => {
    const about = html("about");
    expect(about).toContain("Acme");
    expect(about).toContain("Hello");
    expect(about).toContain("Probe / Shadow");
    expect(existsSync(islandPath("about", "about-shell"))).toBe(false);
  });

  test("an entry the page writes stays live, and one it never reads is dropped", () => {
    const counter = island("counter", "counter-shell");
    expect(counter).toMatch(/^\s*clicks:\s*0,$/m);
    expect(counter).not.toMatch(/^\s*siteName:/m);
    expect(counter).not.toMatch(/^\s*track:/m);
  });

  test("the page, then its layout, wins over the project", () => {
    expect(island("page-theme", "page-shell")).toMatch(/^\s*theme:\s*"light",$/m);
    expect(island("layout-theme", "themed-shell")).toMatch(/^\s*theme:\s*"sepia",$/m);
  });

  test("a surviving $src handler keeps every inherited entry", () => {
    expect(island("sidecar", "sidecar-shell")).toMatch(/^\s*siteName:\s*"Acme",$/m);
    expect(island("tracked", "tracked-shell")).toMatch(/^\s*siteName:\s*"Acme",$/m);
  });
});
