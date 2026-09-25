/**
 * The init-bundle content check (scripts/init-bundle.ts) — guards the regression where the
 * launcher's `views/studio/dist/init.js` is built against `node_modules/electrobun` instead of the
 * vendored SDK, and so throws on import in every packaged app. Desktop 5.0.0–5.1.3 all shipped that
 * bundle, and every one of them passed a check that only asked whether the file existed.
 */
import { describe, expect, test } from "bun:test";
import { initBundleArgs, initBundleProblems } from "../scripts/init-bundle";

/* Verbatim lines from the init.js shipped in desktop-v5.1.3 for macOS (lines 35–37 and 13221–13222
   of that 13k-line file). Inlined rather than read from disk so this suite stays inside its own
   workspace and needs neither a release artifact nor the submodule. */
const SHIPPED_5_1_3 = `// ../../node_modules/electrobun/lib/moved.cjs
var require_moved = __commonJS(function() {
  throw new Error("Electrobun 2.x APIs come from the Hutch devkit, not node_modules. " + "Run \`npx electrobun dev\` (or \`hutch electrobun prepare\`) so imports " + "resolve from .hutch/devkit, and see the migration guide: " + "https://electrobun.dev/electrobun/guides/migrating-to-v2");
});

// src/platform.ts
var import_view = __toESM(require_moved(), 1);
`;

/** What a sound Electrobun launcher bundle carries: the inlined SDK and the boot signal. */
const CLEAN_ELECTROBUN = `// ../../vendor/electrobun/package/src/browser/index.ts
class Electroview {
  constructor(config) { this.rpc = config.rpc; }
}

// ../studio/src/platform.ts
function announceLauncher() {
  g.__jxLauncher ??= {};
  return g.__jxLauncher;
}
`;

/** The chromium launcher's bundle: the boot signal and no Electrobun at all. */
const CLEAN_CHROMIUM = `// ../studio/src/platform.ts
function announceLauncher() {
  g.__jxLauncher ??= {};
  return g.__jxLauncher;
}
`;

describe("initBundleArgs", () => {
  test("builds a browser bundle with a linked sourcemap into the given outdir", () => {
    expect(initBundleArgs("./src/init.ts", "./assets/studio/dist")).toEqual([
      "build",
      "./src/init.ts",
      "--outdir",
      "./assets/studio/dist",
      "--target",
      "browser",
      "--sourcemap=linked",
    ]);
  });
});

describe("initBundleProblems", () => {
  test("the shipped 5.1.3 bundle is rejected, and the remedy names the vendor script", () => {
    const problems = initBundleProblems(SHIPPED_5_1_3, { electrobun: true });
    expect(problems.length).toBe(3);
    expect(problems[0]).toContain("bun scripts/check-electrobun-vendor.ts --init");
    expect(problems[1]).toContain("the Electrobun view SDK is not inlined");
    expect(problems[2]).toContain("the launcher boot signal (src/boot.ts) is missing");
  });

  test("either marker of the throwing stub is enough on its own", () => {
    const pathOnly = `${CLEAN_ELECTROBUN}// ../../node_modules/electrobun/lib/moved.cjs\n`;
    const bindingOnly = `${CLEAN_ELECTROBUN}var import_view = __toESM(require_moved(), 1);\n`;
    for (const code of [pathOnly, bindingOnly]) {
      const problems = initBundleProblems(code, { electrobun: true });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("check-electrobun-vendor.ts --init");
    }
  });

  test("a bundle that inlines the SDK and publishes the boot signal passes", () => {
    expect(initBundleProblems(CLEAN_ELECTROBUN, { electrobun: true })).toEqual([]);
  });

  test("the chromium launcher needs no Electroview", () => {
    expect(initBundleProblems(CLEAN_CHROMIUM, { electrobun: false })).toEqual([]);
    // …but the same bundle judged as the Electrobun launcher's is missing its SDK.
    expect(initBundleProblems(CLEAN_CHROMIUM, { electrobun: true })).toEqual([
      "the Electrobun view SDK is not inlined (no `class Electroview`)",
    ]);
  });

  test("the chromium launcher is still rejected if an Electrobun import inlines the stub", () => {
    const problems = initBundleProblems(`${CLEAN_CHROMIUM}${SHIPPED_5_1_3}`, { electrobun: false });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("lib/moved.cjs");
  });

  test("a bundle without the boot signal is rejected on both launchers", () => {
    const noSignal = CLEAN_ELECTROBUN.replaceAll("__jxLauncher", "launcher");
    for (const electrobun of [true, false]) {
      expect(initBundleProblems(noSignal, { electrobun })).toEqual([
        "the launcher boot signal (src/boot.ts) is missing (no `__jxLauncher`)",
      ]);
    }
  });
});
