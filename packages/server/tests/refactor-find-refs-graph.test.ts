/**
 * The usage query answered from a project state host's graph (`specs/project-state.md` §8, §12):
 * over a real project and a real host, every question gets the answer the tree walk gives, and a
 * host below `indexed` offers no graph, so the caller walks the tree.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildProjectExtensionRegistry } from "@jxsuite/compiler/format-host";
import { isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";
import { findReferences, invalidateReferenceCache } from "../src/refactor/index";
import type { GraphReferences, ReferencesResult } from "../src/refactor/index";
import { createProjectStateHost } from "../src/project-state/host.ts";

const roots: string[] = [];

afterAll(() => {
  invalidateReferenceCache();
  for (const dir of roots) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A project with references of every lane the walk reads, and the files it must skip. */
function seed(): string {
  const root = mkdtempSync(join(tmpdir(), "jx-findrefs-graph-"));
  roots.push(root);
  const write = (rel: string, content: JsonValue): void => {
    const fp = join(root, rel);
    mkdirSync(join(fp, ".."), { recursive: true });
    writeFileSync(fp, isString(content) ? content : JSON.stringify(content));
  };
  write("project.json", { defaults: { layout: "./layouts/base.json" }, name: "p" });
  write("components/card.json", { children: [{ tagName: "span" }], tagName: "my-card" });
  write("pages/index.json", {
    $layout: "layouts/base.json",
    children: [{ $ref: "../components/card.json" }, { tagName: "my-card" }],
  });
  write("pages/about.json", {
    children: [
      { tagName: "my-card" },
      { tagName: "my-card" },
      { src: "/logo.png", tagName: "img" },
    ],
  });
  write("layouts/base.json", { $elements: ["../components/card.json"], children: [] });
  write("vendor/card.json", { children: [{ $ref: "./card.json" }] });
  write("public/logo.png", "x");
  write("pages/broken.json", "{ not valid json ");
  write("pages/page.schema.json", { examples: [{ $layout: "./layouts/base.json" }] });
  write("notes/readme.txt", "./components/card.json");
  return root;
}

/** The answer with its errors reduced to their paths, which is what the two reports share. */
const comparable = (result: ReferencesResult) => ({
  ...result,
  errors: result.errors.map((error) => error.path),
});

describe("findReferences from the graph", () => {
  test("every question gets the tree walk's answer", async () => {
    const root = seed();
    const host = await createProjectStateHost({ git: false, onError: () => {}, root });
    try {
      await host.idle();
      expect(host.readiness).toBe("ready");
      const graph = host.references();
      expect(graph === null).toBe(false);
      const { formats } = await buildProjectExtensionRegistry(root);
      const questions = [
        { path: "components/card.json" },
        { tagName: "my-card" },
        { path: "layouts/base.json" },
        { path: "public/logo.png" },
        { path: "components" },
        { path: "pages/unused.json" },
        {},
      ];
      for (const question of questions) {
        invalidateReferenceCache();
        const walked = await findReferences({ ...question, registry: formats, root });
        const answered = await findReferences({ ...question, graph, registry: formats, root });
        expect(comparable(answered)).toEqual(comparable(walked));
      }
      const card = await findReferences({
        graph,
        path: "components/card.json",
        registry: formats,
        root,
      });
      expect(card.tagName).toBe("my-card");
      expect(card.errors).toEqual([
        { error: "The document could not be read", path: "pages/broken.json" },
      ]);
      expect(card.files.map((file) => file.path)).toEqual([
        "layouts/base.json",
        "pages/about.json",
        "pages/index.json",
      ]);
    } finally {
      await host.close();
    }
  });

  test("a held host offers no graph, so the caller walks the tree", async () => {
    const root = seed();
    const host = await createProjectStateHost({ git: false, hold: true, onError: () => {}, root });
    try {
      expect(host.references()).toBeNull();
      expect(host.docIdAt("pages/index.json")).toEqual(expect.any(String));
      expect(host.docIdAt("pages/missing.json")).toBeNull();
    } finally {
      await host.close();
    }
  });

  test("a document of a format the project parses is read from the graph", async () => {
    const graph: GraphReferences = {
      documents: [
        {
          path: "content/post.md",
          refs: {
            contentTypes: [],
            defines: null,
            implicitLayout: false,
            prototypes: [],
            refs: [{ refType: "src", rootRelativeBare: false, value: "../media/a.png" }],
            tagCounts: {},
            tags: [],
          },
        },
      ],
      extensions: [".md"],
      mounts: [],
    };
    const { formats } = await buildProjectExtensionRegistry(tmpdir());
    const result = await findReferences({
      graph,
      path: "media/a.png",
      registry: formats,
      root: "/project",
    });
    expect(result.files).toEqual([
      {
        count: 1,
        path: "content/post.md",
        refs: [{ count: 1, ref: "../media/a.png", refType: "src" }],
      },
    ]);
    expect(result.tagName).toBeNull();
  });
});
