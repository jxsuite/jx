// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bundleElectronShell } from "../src/electron-shell/bundle";

const outDir = mkdtempSync(join(tmpdir(), "jx-shell-bundle-test-"));
afterAll(() => rmSync(outDir, { force: true, recursive: true }));

describe("bundleElectronShell", () => {
  test("emits CommonJS entries whose only outside module is electron", async () => {
    const bundle = await bundleElectronShell(outDir);
    expect(bundle).toEqual({ main: join(outDir, "main.js"), preload: join(outDir, "preload.js") });
    for (const file of [bundle.main, bundle.preload]) {
      const code = readFileSync(file, "utf8");
      // A sandboxed preload can require `electron` and nothing else, and neither entry may be ESM.
      const required = [...code.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
      expect(new Set(required)).toEqual(new Set(["electron"]));
      expect(code).not.toMatch(/^\s*import\s/m);
      expect(code).not.toMatch(/^\s*export\s/m);
    }
    expect(readFileSync(bundle.preload, "utf8")).toContain("__jxShell");
  });

  test("by default writes into a directory of its own, removed when the process exits", async () => {
    const before = new Set(process.listeners("exit"));
    const bundle = await bundleElectronShell();
    const cleanup = process.listeners("exit").find((listener) => !before.has(listener));
    expect(existsSync(bundle.main)).toBe(true);
    const prefix = join(tmpdir(), "jx-electron-shell-");
    expect(dirname(bundle.main).startsWith(prefix)).toBe(true);
    expect(cleanup).toBeDefined();
    process.off("exit", cleanup!);
    cleanup!(0);
    expect(existsSync(dirname(bundle.main))).toBe(false);
  });

  test("a failed build is an error carrying the bundler's messages", async () => {
    const failure: Awaited<ReturnType<typeof Bun.build>> = {
      logs: [],
      outputs: [],
      success: false,
    };
    const failed = spyOn(Bun, "build").mockResolvedValue(failure);
    try {
      await expect(bundleElectronShell(outDir)).rejects.toThrow(
        "Bundling the Electron shell failed.",
      );
    } finally {
      failed.mockRestore();
    }
  });
});
