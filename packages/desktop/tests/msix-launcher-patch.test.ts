/**
 * `scripts/msix-launcher-patch.ts` - the rewrite of Electrobun's launcher that lets an MSIX start.
 *
 * The regression these guard: the patch called `__require("fs")`, an Electrobun 1 bundler helper
 * that Electrobun 2's launcher does not define, so the patched launcher threw a ReferenceError at
 * startup and desktop 5.2.0 installed from the Microsoft Store without ever opening a window. The
 * behavioural test below runs the patched branch for real, which is the only check of this kind
 * that would have failed.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FLAT_FILES_ORIGINAL,
  FLAT_FILES_PATCHED,
  REQUIRED_IMPORTS,
  importedNames,
  patchLauncherMain,
} from "../scripts/msix-launcher-patch";

/** The launcher's header, as Electrobun 2 emits it. */
const IMPORTS = `import { join, dirname, resolve } from "path";
import { dlopen, suffix, ptr, toArrayBuffer } from "bun:ffi";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { spawn } from "child_process";
`;

/** A launcher reduced to the part the patch touches. `entry` returns where the app was loaded from. */
const launcher = (imports = IMPORTS, branch = FLAT_FILES_ORIGINAL) => `${imports}
export function entry(appFolderPath) {
  let appEntrypointPath;
  if (false) {
    appEntrypointPath = "asar";
  ${branch}
  return appEntrypointPath;
}
`;

describe("importedNames", () => {
  test("collects every name the launcher imports, across statements", () => {
    const names = importedNames(IMPORTS);
    for (const name of ["join", "dirname", "dlopen", "readFileSync", "tmpdir", "spawn"]) {
      expect(names.has(name)).toBe(true);
    }
  });

  test("reads the local name of an aliased import", () => {
    expect(importedNames(`import { readFileSync as read } from "fs";`)).toEqual(new Set(["read"]));
  });

  test("ignores default and namespace imports, which it cannot name from a brace list", () => {
    expect(importedNames(`import path from "path";\nimport * as os from "os";`).size).toBe(0);
  });
});

describe("patchLauncherMain", () => {
  test("swaps the flat-files branch for the temp-copy version", () => {
    const patched = patchLauncherMain(launcher());
    expect(patched).toContain(FLAT_FILES_PATCHED);
    expect(patched).not.toContain(FLAT_FILES_ORIGINAL);
  });

  test("never references __require, which Electrobun 2's launcher does not define", () => {
    expect(FLAT_FILES_PATCHED).not.toContain("__require");
    expect(patchLauncherMain(launcher())).not.toContain("__require");
  });

  test("everything the patched branch calls is something the launcher imports", () => {
    for (const name of REQUIRED_IMPORTS) {
      expect(FLAT_FILES_PATCHED).toContain(`${name}(`);
      expect(importedNames(IMPORTS).has(name)).toBe(true);
    }
  });

  test("throws, rather than shipping an unpatched launcher, when the branch is gone", () => {
    expect(() => patchLauncherMain(launcher(IMPORTS, "} else { /* reshaped */ }"))).toThrow(
      "no longer matches",
    );
  });

  test.each([...REQUIRED_IMPORTS])("throws when the launcher does not import %s", (name) => {
    const stripped = IMPORTS.replace(new RegExp(`\\b${name},?\\s?`), "");
    expect(() => patchLauncherMain(launcher(stripped))).toThrow(name);
  });
});

describe("the patched launcher, executed", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "msix-launcher-patch-"));
    mkdirSync(join(root, "app", "bun"), { recursive: true });
    writeFileSync(join(root, "app", "bun", "index.js"), "// the app\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Evaluates a launcher source as a function body with exactly the names the real launcher imports
   * in scope. No temp module is written, so Bun's coverage has no stray source file to count, and a
   * name the source uses but was never given (`__require`) throws ReferenceError as it did in
   * 5.2.0.
   */
  const entryOf = (source: string): ((dir: string) => string) => {
    const body = source
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n")
      .replace("export function", "function");
    return new Function(
      "join",
      "readFileSync",
      "tmpdir",
      "writeFileSync",
      `${body}\nreturn entry;`,
    )(join, readFileSync, tmpdir, writeFileSync) as (dir: string) => string;
  };

  test("the 5.2.0 patch, calling __require, throws before the app can start", () => {
    const broken = launcher().replace(
      FLAT_FILES_ORIGINAL,
      FLAT_FILES_PATCHED.replace(
        "readFileSync(__flatEntry",
        '__require("fs").readFileSync(__flatEntry',
      ),
    );
    expect(() => entryOf(broken)(join(root, "app"))).toThrow(ReferenceError);
  });

  test("copies the app entrypoint to the temp directory and returns the copy", () => {
    const copy = entryOf(patchLauncherMain(launcher()))(join(root, "app"));

    // The Worker must start from the temp copy: reading WindowsApps directly is the EPERM.
    expect(copy.startsWith(tmpdir())).toBe(true);
    expect(existsSync(copy)).toBe(true);
    expect(readFileSync(copy, "utf8")).toBe("// the app\n");
    rmSync(copy, { force: true });
  });

  test("the unpatched launcher would have read WindowsApps directly (the case being fixed)", () => {
    expect(entryOf(launcher())(join(root, "app"))).toBe(join(root, "app", "bun", "index.js"));
  });
});
