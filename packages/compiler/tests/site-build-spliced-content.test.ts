/**
 * Site-build-spliced-content.test.ts — content a computed-children template splices in is rendered
 * as written, never evaluated as a template and never bound (spec.md §8.4).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSite } from "../src/site/site-build";
import type { JsonValue } from "@jxsuite/schema/types";

const TMP = resolve(import.meta.dir, "__test-spliced-content__");

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

/** @returns {string[]} The source of every JavaScript file the build wrote */
function moduleSources(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".js")) {
        found.push(full);
      }
    }
  };
  walk(resolve(TMP, "dist"));
  return found.map((f) => readFileSync(f, "utf8"));
}

/** @returns {string} Every JavaScript file the build wrote, joined */
function modules(): string {
  return moduleSources().join("\n");
}

/** What the Markdown parser yields for an entry that quotes templates. */
const CHILDREN = [
  {
    children: ["Use ", { tagName: "code", textContent: "Clicked ${state.count} times" }],
    tagName: "p",
  },
  { tagName: "p", children: ["Missing ${state.missing} stays", " and ${"] },
  {
    attributes: { title: "${state.count}" },
    style: { color: "${state.count}" },
    tagName: "pre",
    children: [{ tagName: "code", textContent: "const a = `${" }],
  },
];

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });
  writeJSON("project.json", {
    build: { outDir: "./dist" },
    defaults: { layout: false },
    imports: { Entry: "./classes/entry.class.json" },
    name: "Spliced",
  });
  writeJSON("classes/entry.class.json", {
    $implementation: "./entry.js",
    $prototype: "Class",
    title: "Entry",
  });
  write(
    "classes/entry.js",
    `export class Entry {\n  resolve() { return { $children: ${JSON.stringify(CHILDREN)} }; }\n}\n`,
  );
  writeJSON("pages/index.json", {
    children: [
      { tagName: "h1", textContent: "${state.count} authored" },
      { tagName: "div", children: "${state.entry.$children}" },
      {
        tagName: "button",
        textContent: "go",
        onclick: { $prototype: "Function", body: "state.count++" },
      },
    ],
    state: { count: { default: 3 }, entry: { $prototype: "Entry", timing: "compiler" } },
    tagName: "main",
  });
  await buildSite(TMP, { verbose: false });
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("content a computed-children template splices in (spec.md §8.4)", () => {
  it("is rendered as written", () => {
    const page = html("");
    expect(page).toContain("<code>Clicked ${state.count} times</code>");
    expect(page).toContain("Missing ${state.missing} stays and ${");
    expect(page).toContain("const a = `${");
    expect(page).not.toContain("Clicked undefined");
  });

  it("adds no binding and leaves the module parseable", () => {
    const text = modules();
    expect(text).not.toContain("Clicked");
    expect(text).not.toContain("state.missing");
    const transpiler = new Bun.Transpiler({ loader: "js" });
    for (const source of moduleSources()) {
      expect(() => transpiler.transformSync(source)).not.toThrow();
    }
  });

  it("keeps a template the page authors beside the splice bound", () => {
    expect(modules()).toContain("authored");
    expect(html("")).toContain("data-bind");
  });
});
