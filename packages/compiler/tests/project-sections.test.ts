/**
 * Project-sections.test.ts — unit tests for the generic section orchestrator
 *
 * Uses a local (relative-path) extension fixture so every dispatch branch is exercised without the
 * parser package: a section class with a projectData capability, one without (skipped), a
 * contribution whose key is absent from the config (skipped), and a nullish project config.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildProjectExtensionRegistry } from "../src/site/format-host";
import { loadProjectSections } from "../src/site/project-sections";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type { JsonObject, ProjectConfig } from "@jxsuite/schema/types";

const TMP = resolve(import.meta.dir, "__test-project-sections__");

function writeFile(relPath: string, content: string) {
  const abs = resolve(TMP, relPath);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function writeJson(relPath: string, value: JsonObject | ProjectConfig) {
  writeFile(relPath, JSON.stringify(value, null, 2));
}

const projectConfig: ProjectConfig = {
  extensions: ["./ext"],
  name: "Sections Fixture",
  stuff: { a: 1 },
  vacant: { ignored: true },
};

let registry: ExtensionRegistry;

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });
  writeJson("project.json", projectConfig);

  writeJson("ext/jx-extension.json", {
    classes: {
      NoData: "./nodata.class.json",
      WithData: "./withdata.class.json",
    },
    name: "local-sections-ext",
  });

  // Owns a section but declares no projectData capability — must be skipped.
  writeJson("ext/nodata.class.json", {
    $prototype: "Class",
    project: { key: "vacant" },
    title: "NoData",
  });

  writeJson("ext/withdata.class.json", {
    $defs: {
      methods: {
        projectData: {
          identifier: "projectData",
          role: "projectData",
          scope: "static",
        },
      },
    },
    $implementation: "./withdata.js",
    $prototype: "Class",
    project: { key: "stuff" },
    title: "WithData",
  });

  writeFile(
    "ext/withdata.js",
    `export class WithData {
  static projectData(sectionValue, ctx) {
    return { root: ctx.root, section: sectionValue, sawRegistry: Boolean(ctx.registry), sawIo: Boolean(ctx.io), ...("lazy" in ctx && { lazy: ctx.lazy }) };
  }
}
`,
  );

  registry = await buildProjectExtensionRegistry(TMP, projectConfig);
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("loadProjectSections", () => {
  it("dispatches projectData for declared sections and skips capability-less ones", async () => {
    const sections = await loadProjectSections(TMP, projectConfig, registry);
    expect(Object.keys(sections)).toEqual(["stuff"]);
    expect(sections.stuff).toEqual({
      root: TMP,
      sawIo: true,
      sawRegistry: true,
      section: { a: 1 },
    });
  });

  /* A host that serves one page at a time asks for sections on demand (extensions.md §8); a build
     does not, and its owners must not see the key at all. */
  it("tells owners the host wants their sections on demand only when it does", async () => {
    const lazy = await loadProjectSections(TMP, projectConfig, registry, { lazy: true });
    expect(lazy.stuff).toMatchObject({ lazy: true });
    const built = await loadProjectSections(TMP, projectConfig, registry, { lazy: false });
    expect(built.stuff).not.toHaveProperty("lazy");
  });

  it("returns nothing without a project config, even with contributions registered", async () => {
    const sections = await loadProjectSections(TMP, undefined, registry);
    expect(sections).toEqual({});
  });

  it("skips contributions whose key the config does not declare", async () => {
    const partial: ProjectConfig = { extensions: ["./ext"], name: "No Stuff" };
    const sections = await loadProjectSections(TMP, partial, registry);
    expect(sections).toEqual({});
  });
});
