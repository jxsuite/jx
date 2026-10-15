/**
 * A component module on a site deployed under a path (specs/site-architecture.md §14.7).
 *
 * The page rewrite re-roots the URLs of finished HTML, but a component module is a JavaScript file
 * the page loads, and the URLs the COMPILER writes into it are absolute paths too:
 * `import('/assets/x.js')` for a `$lazy` function, `import { f } from '/assets/x.js'` for a static
 * one. Under a base they named files the host does not serve, so a lazily loaded search client
 * never loaded and a component with a sidecar failed to evaluate. A site at an origin root must be
 * left exactly as it was.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JsonValue } from "@jxsuite/schema/types";
import { buildSite } from "../src/site/site-build";

const TMP = resolve(import.meta.dir, "__test-component-base-path__");

/** Writes JSON, pretty-printed. */
function write(path: string, contents: JsonValue) {
  writeText(path, JSON.stringify(contents, null, 2));
}

/** Writes a source file verbatim. */
function writeText(path: string, text: string) {
  mkdirSync(resolve(TMP, ...path.split("/").slice(0, -1)), { recursive: true });
  writeFileSync(resolve(TMP, path), text, "utf8");
}

async function buildAt(url: string) {
  write("project.json", {
    build: { outDir: "./dist" },
    images: { optimize: false },
    name: "Component Probe",
    url,
  });
  const result = await buildSite(TMP, { verbose: false });
  expect(result.errors).toEqual([]);
  return {
    component: readFileSync(resolve(TMP, "dist/components/probe-box.js"), "utf8"),
    page: readFileSync(resolve(TMP, "dist/app.js"), "utf8"),
  };
}

beforeAll(() => {
  rmSync(TMP, { force: true, recursive: true });
  // A hermetic npm package: `$src: "npm:tiny-lib"` is bundled to /assets/tiny-lib.js by the build.
  write("node_modules/tiny-lib/package.json", {
    main: "index.js",
    name: "tiny-lib",
    type: "module",
    version: "1.0.0",
  });
  writeText(
    "node_modules/tiny-lib/index.js",
    "export function eager(s) { return s; }\nexport function later(s) { return s; }\n",
  );
  write("components/probe-box.json", {
    $id: "ProbeBox",
    state: {
      eager: { $prototype: "Function", $src: "npm:tiny-lib", parameters: ["s"] },
      later: {
        $lazy: true,
        $prototype: "Function",
        $src: "npm:tiny-lib",
        parameters: ["s"],
      },
      onMount: {
        $prototype: "Function",
        arguments: ["state"],
        body: "state.later(state); state.eager(state);",
      },
    },
    tagName: "probe-box",
    children: [{ tagName: "p", textContent: "box" }],
  });
  write("pages/index.json", {
    children: [
      { tagName: "probe-box" },
      { tagName: "button", textContent: "go", onclick: { $ref: "#/state/pageLater" } },
    ],
    state: {
      pageLater: { $lazy: true, $prototype: "Function", $src: "npm:tiny-lib", parameters: ["s"] },
    },
    title: "Home",
  });
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("a component whose site url carries a path", () => {
  test("loads its lazy and static sidecars from under that path", async () => {
    const { component } = await buildAt("https://example.pages.dev/m/probe/");
    expect(component).toMatch(/import\('\/m\/probe\/assets\/[^']+\.js'\)/);
    expect(component).toMatch(/from '\/m\/probe\/assets\/[^']+\.js'/);
    expect(component).not.toMatch(/(?:import\(|from )'\/assets\//);
  });

  test("so does the page's own module", async () => {
    const { page } = await buildAt("https://example.pages.dev/m/probe/");
    expect(page).toMatch(/from '\/m\/probe\/assets\/[^']+\.js'/);
    expect(page).not.toMatch(/(?:import\(|from )'\/assets\//);
  });

  test("a site at an origin root names /assets/ exactly as before", async () => {
    const { component, page } = await buildAt("https://example.pages.dev/");
    expect(component).toMatch(/import\('\/assets\/[^']+\.js'\)/);
    expect(component).toMatch(/from '\/assets\/[^']+\.js'/);
    expect(page).toMatch(/from '\/assets\/[^']+\.js'/);
    expect(component + page).not.toContain("/m/probe");
  });
});
