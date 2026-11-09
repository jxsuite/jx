/**
 * `@jxsuite/site` never reaches the body eraser (`spec.md` §23.1): it analyses no body, and the
 * TypeScript compiler the eraser carries stops a Cloudflare Worker from booting. A page that needs
 * the eraser loads it in the browser, from the URL `pageShell` is given.
 */
import { describe, expect, test } from "bun:test";

describe("the import graph", () => {
  test("no module this package bundles reaches the eraser or TypeScript", async () => {
    const names = ["compose", "context", "head-merger", "layout", "pagination", "paths", "routes"];
    const entries = [...names, "serve", "shell", "site-style"].map(
      (name) => new URL(`../src/${name}.ts`, import.meta.url).pathname,
    );
    const result = await Bun.build({ entrypoints: entries, target: "browser", packages: "bundle" });
    expect(result.success).toBe(true);
    const sources = await Promise.all(result.outputs.map((output) => output.text()));
    for (const source of sources) {
      expect(source).not.toContain("ts-blank-space");
      expect(source).not.toContain("createSourceFile");
    }
  });
});
