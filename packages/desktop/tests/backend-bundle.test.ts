import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BACKEND_DATA, BACKEND_EXTERNALS, BACKEND_MODULES } from "../scripts/lib/backend-bundle";

const DESKTOP = resolve(import.meta.dir, "..");

describe("the backend bundle", () => {
  test("package.nix's install check treats the same modules as external", () => {
    const nix = readFileSync(resolve(DESKTOP, "package.nix"), "utf8");
    const block = /resolveExternals = \[([^\]]*)\]/.exec(nix)?.[1] ?? "";
    const listed = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.toSorted()).toEqual([...BACKEND_EXTERNALS].toSorted());
  });

  test("every data file or directory the inlined modules read exists in the checkout", () => {
    expect(BACKEND_DATA.filter(({ from }) => !existsSync(resolve(DESKTOP, from)))).toEqual([]);
  });

  /* The compiler resolves these by name from the backend's own directory, so a package missing from
     the staged node_modules is a site that quietly loads its runtime from a CDN. Each must be
     installed to be staged, and what each needs at run time must be staged with it. */
  test("the staged modules are installed, and closed under their own runtime dependencies", () => {
    const root = resolve(DESKTOP, "../../node_modules");
    const staged = new Set<string>(BACKEND_MODULES);
    for (const name of staged) {
      const manifest = resolve(root, name, "package.json");
      expect(existsSync(manifest)).toBe(true);
      // SAFETY: an installed package's own manifest, whose `dependencies` is a string map.
      const { dependencies = {} } = JSON.parse(readFileSync(manifest, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      // `@types/*` are types for the editor and never loaded.
      const missing = Object.keys(dependencies).filter(
        (dep) => !dep.startsWith("@types/") && !staged.has(dep),
      );
      expect(missing).toEqual([]);
    }
  });
});
