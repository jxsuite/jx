// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bundleElectronApp } from "../src/main/bundle";

const outDir = mkdtempSync(join(tmpdir(), "jx-shell-bundle-test-"));
afterAll(() => rmSync(outDir, { force: true, recursive: true }));

describe("bundleElectronApp preload", () => {
  test("the preload is CommonJS whose only outside module is electron", async () => {
    const bundle = await bundleElectronApp(join(outDir, "preload"));
    const code = readFileSync(bundle.preload, "utf8");
    // A sandboxed preload can require `electron` and nothing else, and it may not be ESM.
    const required = [...code.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
    expect(new Set(required)).toEqual(new Set(["electron"]));
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/^\s*export\s/m);
    expect(code).toContain("__jxShell");
  });

  test("a failed build is an error carrying the bundler's messages", async () => {
    const failure: Awaited<ReturnType<typeof Bun.build>> = {
      logs: [],
      outputs: [],
      success: false,
    };
    const failed = spyOn(Bun, "build").mockResolvedValue(failure);
    try {
      await expect(bundleElectronApp(outDir)).rejects.toThrow(
        "Bundling the Electron shell failed.",
      );
    } finally {
      failed.mockRestore();
    }
  });
});

describe("bundleElectronApp", () => {
  test("emits the multi-window app's main process and the shared preload as CommonJS", async () => {
    const dir = join(outDir, "app");
    const bundle = await bundleElectronApp(dir);
    expect(bundle).toEqual({ main: join(dir, "app-main.js"), preload: join(dir, "preload.js") });
    const main = readFileSync(bundle.main, "utf8");
    expect(main).not.toMatch(/^\s*import\s/m);
    expect(main).not.toMatch(/^\s*export\s/m);
    // The app starts a Bun child and speaks the hub's protocol; neither may be left outside.
    expect(main).toContain("second-instance");
    // `import.meta` is a syntax error in CommonJS, and Bun leaves it in place rather than rewriting.
    expect(main).not.toContain("import.meta");
    /* The app finds its own script with `app.getAppPath()`. Every module-identity global is wrong in
       a bundle: Bun folds `__filename`, `module.filename` and `import.meta.filename` to the source
       file's name at build time, and `require.main` is Electron's own internal module. None may
       be relied on, and no source path may appear in the artifact. */
    for (const identity of ["__filename", "module.filename", "require.main"]) {
      expect(main).not.toContain(identity);
    }
    expect(main).toContain("getAppPath");
    expect(main).not.toContain(join(import.meta.dir, ".."));
    expect(main).toContain("window-closed");
    /* Outside the bundle: Electron and Node's own modules, which the main process may use, and
       nothing of this repository's or anyone's. electron-updater is inlined, and brings its own
       dependencies with it, which use the bare names (`path`, `fs`) as well as `node:`-prefixed ones. */
    const required = new Set([...main.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]));
    const outside = [...required].filter(
      (name) => name !== "electron" && !builtinModules.includes(name.replace(/^node:/, "")),
    );
    expect(outside).toEqual([]);
    expect(required.has("electron")).toBe(true);
  });

  test("the default directory is the process's own", async () => {
    const before = new Set(process.listeners("exit"));
    const bundle = await bundleElectronApp();
    const cleanup = process.listeners("exit").find((listener) => !before.has(listener));
    const prefix = join(tmpdir(), "jx-electron-shell-");
    expect(dirname(bundle.main).startsWith(prefix)).toBe(true);
    process.off("exit", cleanup!);
    cleanup!(0);
    expect(existsSync(dirname(bundle.main))).toBe(false);
  });
});
