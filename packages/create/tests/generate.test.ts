import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { generateProject } from "../generate";

import TEMPLATE_VERSIONS from "../template-versions.json";

const TMP = resolve(tmpdir(), `jx-create-test-${Date.now()}`);
const STARTER_FIXTURE = resolve(tmpdir(), `jx-create-array-starter-${Date.now()}`);

// Every starter id resolves to a local tree whose project.json is a JSON array, not an object.
// Generate.ts imports @jxsuite/starters lazily, so registering this after the static import works.
void mock.module("@jxsuite/starters", () => ({ getStarterDir: () => STARTER_FIXTURE }));

afterEach(() => {
  rmSync(TMP, { force: true, recursive: true });
});

afterAll(() => {
  rmSync(STARTER_FIXTURE, { force: true, recursive: true });
});

describe("generateProject — wrangler.jsonc", () => {
  test("static adapter does not emit wrangler.jsonc or wrangler dep", async () => {
    await generateProject(TMP, { adapter: "static", name: "My Site" });

    expect(existsSync(join(TMP, "wrangler.jsonc"))).toBe(false);
    const pkg = JSON.parse(readFileSync(join(TMP, "package.json"), "utf8"));
    expect(pkg.devDependencies.wrangler).toBeUndefined();
    expect(pkg.scripts.deploy).toBeUndefined();
  });

  test("cloudflare-pages emits wrangler.jsonc", async () => {
    await generateProject(TMP, {
      adapter: "cloudflare-pages",
      name: "My Site",
    });

    const wrangler = JSON.parse(readFileSync(join(TMP, "wrangler.jsonc"), "utf8"));
    expect(wrangler.name).toBe("my-site");
    expect(wrangler.pages_build_output_dir).toBe("./dist");
    expect(wrangler.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const pkg = JSON.parse(readFileSync(join(TMP, "package.json"), "utf8"));
    expect(pkg.devDependencies.wrangler).toBe("^4");
    expect(pkg.scripts.deploy).toBe("wrangler pages deploy dist");
  });

  test("cloudflare-workers emits wrangler.jsonc with an assets binding", async () => {
    await generateProject(TMP, {
      adapter: "cloudflare-workers",
      name: "My Site",
    });

    const wrangler = JSON.parse(readFileSync(join(TMP, "wrangler.jsonc"), "utf8"));
    expect(wrangler.main).toBe("./dist/worker.js");
    expect(wrangler.assets).toEqual({ binding: "ASSETS", directory: "./dist" });

    const pkg = JSON.parse(readFileSync(join(TMP, "package.json"), "utf8"));
    expect(pkg.devDependencies.wrangler).toBe("^4");
    expect(pkg.scripts.deploy).toBe("wrangler deploy");

    const project = JSON.parse(readFileSync(join(TMP, "project.json"), "utf8"));
    expect(project.build.adapter).toBe("cloudflare-workers");
  });

  test("scaffolded project.json uses the extension model", async () => {
    await generateProject(TMP, { adapter: "static", name: "My Site" });

    const project = JSON.parse(readFileSync(join(TMP, "project.json"), "utf8"));
    // $schema binds the generated per-project schema and leads the file by convention.
    expect(Object.keys(project)[0]).toBe("$schema");
    expect(project.$schema).toBe("./project.schema.json");
    expect(project.extensions).toEqual(["@jxsuite/parser"]);
    expect(project.content).toEqual({});
    expect(project.imports).toBeUndefined();
    expect(project.contentTypes).toBeUndefined();

    // Projects own their extension dependencies, at the ranges the generated version map names.
    // A shape-only regex passed happily while every one of these named an unpublishable version,
    // Which is how scaffolded projects shipped asking for a compiler that predates their template.
    const pkg = JSON.parse(readFileSync(join(TMP, "package.json"), "utf8"));
    expect(pkg.dependencies["@jxsuite/parser"]).toBe(TEMPLATE_VERSIONS.parser);
    expect(pkg.devDependencies["@jxsuite/compiler"]).toBe(TEMPLATE_VERSIONS.compiler);
    expect(pkg.devDependencies["@jxsuite/runtime"]).toBe(TEMPLATE_VERSIONS.runtime);
    expect(pkg.devDependencies["@jxsuite/server"]).toBe(TEMPLATE_VERSIONS.server);

    // Every @jxsuite range a scaffold emits must come FROM the map, so a future hardcoded literal
    // In generate.ts is red here rather than discovered by a user's failing install.
    const mapped = Object.values(TEMPLATE_VERSIONS);
    for (const bag of [pkg.dependencies, pkg.devDependencies]) {
      for (const [name, range] of Object.entries(bag ?? {})) {
        if (name.startsWith("@jxsuite/")) {
          expect(mapped.some((known) => known === range)).toBe(true);
        }
      }
    }
  });
});

describe("generateProject — starter project.json", () => {
  test("rejects a starter whose project.json is not a JSON object, and rolls back", async () => {
    mkdirSync(STARTER_FIXTURE, { recursive: true });
    writeFileSync(join(STARTER_FIXTURE, "project.json"), "[]");

    let failure: unknown;
    try {
      await generateProject(TMP, { name: "My Site", starter: "listy" });
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(
      new TypeError('Starter "listy" has a project.json that is not a JSON object'),
    );
    expect(existsSync(TMP)).toBe(false);
  });
});
