/**
 * Site-build-cem-manifest.test.ts — the Custom Elements Manifest a site build writes beside the
 * component modules it compiles (spec.md §16.8).
 */

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CemPackageOut } from "@jxsuite/schema/cem-manifest";
import type { JsonValue } from "@jxsuite/schema/types";
import { buildSite } from "../src/site/site-build";

const ROOT = resolve(import.meta.dir, "__test-cem-manifest__");

function project(name: string, files: Record<string, JsonValue>): string {
  const root = resolve(ROOT, name);
  rmSync(root, { force: true, recursive: true });
  for (const [path, value] of Object.entries(files)) {
    const full = resolve(root, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, JSON.stringify(value, null, 2), "utf8");
  }
  return root;
}

/** The manifest a build wrote, parsed. */
function manifestOf(root: string, outDir = "dist"): CemPackageOut {
  /* SAFETY: the file is the text `cemManifestText` wrote for a `CemPackageOut`. */
  return JSON.parse(
    readFileSync(resolve(root, outDir, "custom-elements.json"), "utf8"),
  ) as CemPackageOut;
}

const card = {
  children: [
    { attributes: { part: "title" }, tagName: "h3", textContent: "${state.userName}" },
    { tagName: "slot" },
  ],
  observedAttributes: ["user-name"],
  state: { userName: { default: "Guest", type: "string" } },
  tagName: "user-card",
};
const badge = {
  children: [{ attributes: { part: "dot" }, tagName: "i" }],
  state: { tone: "info" },
  tagName: "app-badge",
};
const page = (tags: string[]): JsonValue => ({
  $elements: tags.map((tag) => ({ $ref: `../components/${tag}.json` })),
  children: tags.map((tagName) => ({ tagName })),
  tagName: "main",
});

afterAll(() => {
  rmSync(ROOT, { force: true, recursive: true });
});

describe("buildSite — Custom Elements Manifest", () => {
  test("writes dist/custom-elements.json describing every compiled component", async () => {
    const root = project("two", {
      "components/app-badge.json": badge,
      "components/user-card.json": card,
      "pages/index.json": page(["user-card", "app-badge"]),
      "project.json": { build: { outDir: "./dist" }, name: "cem" },
    });
    const result = await buildSite(root);
    expect(result.errors).toEqual([]);
    const manifest = manifestOf(root);
    expect(manifest.schemaVersion).toBe("2.1.0");
    expect(manifest.modules.map((module) => module.path)).toEqual([
      "dist/components/app-badge.js",
      "dist/components/user-card.js",
    ]);
    const [, userCard] = manifest.modules;
    const declaration = userCard?.declarations[0];
    expect(declaration?.name).toBe("UserCard");
    expect(declaration?.customElement).toBe(true);
    expect(declaration?.attributes).toEqual([
      { default: '"Guest"', fieldName: "userName", name: "user-name", type: { text: "string" } },
    ]);
    // Light DOM: no parts.
    expect(declaration?.cssParts).toBeUndefined();
    // The class name is the one the module defines.
    expect(readFileSync(resolve(root, "dist/components/user-card.js"), "utf8")).toContain(
      "class UserCard extends HTMLElement",
    );
    // `files` counts what was written, the manifest included.
    const written = ["index.html", "custom-elements.json", "components/user-card.js"];
    for (const file of written) {
      expect(existsSync(resolve(root, "dist", file))).toBe(true);
    }
  }, 30_000);

  test("lists css parts for a shadow component, by its own $shadow or the project default", async () => {
    const root = project("shadow", {
      "components/app-badge.json": { ...badge, $shadow: false },
      "components/open-card.json": { ...card, $shadow: "open", tagName: "open-card" },
      "components/user-card.json": card,
      "pages/index.json": page(["user-card", "app-badge", "open-card"]),
      "project.json": {
        build: { outDir: "./dist" },
        defaults: { shadow: "open" },
        name: "cem-shadow",
      },
    });
    const result = await buildSite(root);
    expect(result.errors).toEqual([]);
    const parts = new Map(
      manifestOf(root).modules.map((module) => [
        module.declarations[0].tagName,
        module.declarations[0].cssParts,
      ]),
    );
    expect(parts.get("open-card")).toEqual([{ name: "title" }]);
    // The project default reaches a component that says nothing.
    expect(parts.get("user-card")).toEqual([{ name: "title" }]);
    // And a component that opts out is light, whatever the project says.
    expect(parts.get("app-badge")).toBeUndefined();
  }, 30_000);

  test("writes no manifest when no component compiles", async () => {
    const root = project("none", {
      "pages/index.json": { tagName: "main", textContent: "Home" },
      "project.json": { build: { outDir: "./dist" }, name: "cem-none" },
    });
    const result = await buildSite(root);
    expect(result.errors).toEqual([]);
    expect(existsSync(resolve(root, "dist/custom-elements.json"))).toBe(false);
  }, 30_000);

  test("prints the generator's warnings", async () => {
    const root = project("warn", {
      "components/user-card.json": {
        ...card,
        state: { ...card.state, size: { attribute: "size", default: "md", type: "string" } },
      },
      "pages/index.json": page(["user-card"]),
      "project.json": { build: { outDir: "./dist" }, name: "cem-warn" },
    });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await buildSite(root);
      expect(result.errors).toEqual([]);
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages).toContain(
        'user-card: state entry "size" declares attribute "size", but the element does not observe it into that entry (spec.md §16.5); add it to observedAttributes or remove it',
      );
    } finally {
      warn.mockRestore();
    }
  }, 30_000);

  test("module paths stay relative to the project root under a nested outDir", async () => {
    const root = project("nested", {
      "components/user-card.json": card,
      "pages/index.json": page(["user-card"]),
      "project.json": { build: { outDir: "./build/site" }, name: "cem-nested" },
    });
    const result = await buildSite(root);
    expect(result.errors).toEqual([]);
    expect(manifestOf(root, "build/site").modules.map((module) => module.path)).toEqual([
      "build/site/components/user-card.js",
    ]);
  }, 30_000);
});
