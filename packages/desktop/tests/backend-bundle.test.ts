import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BACKEND_DATA,
  BACKEND_MODULES,
  BACKEND_NATIVES,
  bundleBackend,
  moduleClosure,
  WORKSPACE_MODULES,
} from "../scripts/lib/backend-bundle";
import type { BackendBundle } from "../scripts/lib/backend-bundle";

const DESKTOP = resolve(import.meta.dir, "..");

describe("the backend bundle", () => {
  test("package.nix's install check resolves the same native packages", () => {
    const nix = readFileSync(resolve(DESKTOP, "package.nix"), "utf8");
    const block = /backendNatives = \[([^\]]*)\]/.exec(nix)?.[1] ?? "";
    const listed = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(listed.toSorted()).toEqual([...BACKEND_NATIVES].toSorted());
  });

  test("every data file or directory the inlined modules read exists in the checkout", () => {
    expect(BACKEND_DATA.filter(({ from }) => !existsSync(resolve(DESKTOP, from)))).toEqual([]);
  });

  /* A package missing from the staged node_modules is a site that quietly loads its runtime from a
     CDN, or a native module that throws on first use. The closure must reach each staged package
     and what each loads at run time. */
  test("the staged closure holds every listed package and what each depends on", () => {
    const closure = new Set(moduleClosure([...BACKEND_NATIVES, ...BACKEND_MODULES]));
    for (const name of [...BACKEND_NATIVES, ...BACKEND_MODULES]) {
      expect(closure.has(name)).toBe(true);
    }
    for (const name of closure) {
      // SAFETY: an installed package's own manifest, whose `dependencies` is a string map.
      const { dependencies = {} } = JSON.parse(
        readFileSync(join(WORKSPACE_MODULES, name, "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> };
      const missing = Object.keys(dependencies).filter(
        (dep) =>
          !closure.has(dep) && !existsSync(join(WORKSPACE_MODULES, name, "node_modules", dep)),
      );
      expect({ missing, name }).toEqual({ missing: [], name });
    }
    // The platform binaries of esbuild and sharp come with them (optional dependencies, this host's).
    expect([...closure].some((name) => name.startsWith("@esbuild/"))).toBe(true);
    expect([...closure].some((name) => name.startsWith("@img/sharp-"))).toBe(true);
  });

  test("a package that is not installed cannot be staged", () => {
    expect(() => moduleClosure(["no-such-package-jx"])).toThrow("is not installed");
  });
});

/*
 * The Mac App Store's automated review rejected 6.1.0 for the system ICU symbols JavaScriptCore
 * imports, and only removing Bun from the package fixes that (specs/desktop.md §7.1). The backend
 * now runs on Electron's Node, so the bundle must hold no Bun code at all, wherever it came from:
 * this bundles exactly as staging does and fails naming each source file that put a Bun call in.
 */
describe("the backend bundle is a Node program", () => {
  let outdir: string;
  let bundle: BackendBundle;

  beforeAll(async () => {
    outdir = mkdtempSync(join(tmpdir(), "jx-backend-bundle-"));
    bundle = await bundleBackend(outdir, { stageModules: false });
  }, 120_000);

  afterAll(() => rmSync(outdir, { force: true, recursive: true }));

  test("contains no Bun API and imports nothing from bun", () => {
    const bunUse =
      /\bBun\.[A-Za-z]+|from\s*["']bun(?::[a-z]+)?["']|require\(["']bun(?::[a-z]+)?["']\)/;
    const offenders = bundle.inputs.filter((input) => {
      if (input.includes("node_modules") || !existsSync(input)) {
        return false;
      }
      // Comments mention Bun freely; only code counts.
      const code = readFileSync(input, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join("\n");
      return bunUse.test(code);
    });
    expect(offenders).toEqual([]);
    expect(bunUse.test(bundle.code)).toBe(false);
  });

  test("is ESM, with the package.json that makes Node read it so and its data beside it", () => {
    const manifest = readFileSync(join(outdir, "package.json"), "utf8");
    expect(JSON.parse(manifest)).toEqual({ type: "module" });
    for (const { to } of BACKEND_DATA) {
      expect(existsSync(join(outdir, to))).toBe(true);
    }
  });

  test("leaves the native packages to the staged node_modules", () => {
    for (const name of BACKEND_NATIVES) {
      expect(bundle.code.includes(`"${name}"`) || bundle.code.includes(`'${name}'`)).toBe(true);
    }
  });
});
