/**
 * Packaged-bundle completeness check (scripts/verify-bundle.ts) — guards the class of regression
 * where a static data dir read by the bundled JS (create templates, starter sites) never gets
 * staged by electrobun.config.ts `build.copy`, surfacing only as a runtime ENOENT in the packaged
 * app (e.g. `lstat '.../app/bun/template/pages'` on first project creation).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { INIT_BUNDLE, REQUIRED, verifyBundle } from "../scripts/verify-bundle";

/** A sound launcher init bundle: the inlined view SDK and the boot signal src/boot.ts publishes. */
const CLEAN_INIT = "class Electroview {}\nglobalThis.__jxLauncher ??= {};\n";

/* What desktop 5.0.0–5.1.3 packaged instead (verbatim lines from the 5.1.3 macOS init.js): the
   file exists, so the old existence-only gate passed it, and it throws the moment it is imported. */
const THROWING_INIT = `// ../../node_modules/electrobun/lib/moved.cjs
var require_moved = __commonJS(function() {
  throw new Error("Electrobun 2.x APIs come from the Hutch devkit, not node_modules. ");
});
var import_view = __toESM(require_moved(), 1);
`;

const STARTER_IDS = ["alpha", "beta"];

let appDir: string;

/** Lay out a complete fake app dir: every required path plus a registry and its starter trees. */
function stageCompleteBundle(): void {
  for (const rel of REQUIRED) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, rel === INIT_BUNDLE ? CLEAN_INIT : rel.endsWith(".json") ? "[]" : "content");
  }
  writeFileSync(
    join(appDir, "bun", "registry.json"),
    JSON.stringify(STARTER_IDS.map((id) => ({ id, name: id }))),
  );
  for (const id of STARTER_IDS) {
    const projectFile = join(appDir, "bun", "sites", id, "project.json");
    mkdirSync(dirname(projectFile), { recursive: true });
    writeFileSync(projectFile, "{}");
  }
}

beforeEach(() => {
  appDir = mkdtempSync(join(tmpdir(), "jx-verify-bundle-"));
  stageCompleteBundle();
});

describe("verifyBundle", () => {
  test("a complete bundle reports nothing missing", () => {
    expect(verifyBundle(appDir)).toEqual([]);
  });

  test("a removed required file is reported by exact path", () => {
    rmSync(join(appDir, "bun", "template", "pages", "index.md"));
    expect(verifyBundle(appDir)).toEqual(["bun/template/pages/index.md"]);
  });

  test("a registry starter without a staged project tree is reported", () => {
    rmSync(join(appDir, "bun", "sites", "beta"), { force: true, recursive: true });
    expect(verifyBundle(appDir)).toEqual(["bun/sites/beta/project.json"]);
  });

  /* The workers are the one staged asset whose absence is invisible at runtime: Monaco just never
     starts a language service, so the packaged code view loses schema validation with no error.
     Keep them in REQUIRED so the postBuild gate is what catches an omission. */
  test("requires Monaco's worker bundles", () => {
    for (const worker of ["editor.worker.js", "json.worker.js", "ts.worker.js"]) {
      expect(REQUIRED).toContain(`views/studio/dist/workers/${worker}`);
    }
    rmSync(join(appDir, "views", "studio", "dist", "workers", "json.worker.js"));
    expect(verifyBundle(appDir)).toEqual(["views/studio/dist/workers/json.worker.js"]);
  });

  test("a missing registry is reported without throwing", () => {
    rmSync(join(appDir, "bun", "registry.json"));
    expect(verifyBundle(appDir)).toEqual(["bun/registry.json"]);
  });

  test("an init bundle built against node_modules/electrobun is reported, with the remedy", () => {
    writeFileSync(join(appDir, INIT_BUNDLE), THROWING_INIT);
    const problems = verifyBundle(appDir);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((line) => line.startsWith(`${INIT_BUNDLE}: `))).toBe(true);
    expect(problems.join("\n")).toContain("check-electrobun-vendor.ts --init");
  });

  test("a sound init bundle is not reported", () => {
    writeFileSync(join(appDir, INIT_BUNDLE), CLEAN_INIT);
    expect(verifyBundle(appDir)).toEqual([]);
  });

  test("a missing init bundle is reported once, as a missing path", () => {
    rmSync(join(appDir, INIT_BUNDLE));
    expect(verifyBundle(appDir)).toEqual([INIT_BUNDLE]);
  });
});
