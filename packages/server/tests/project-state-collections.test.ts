/**
 * The collection loader's lists (`specs/project-state.md` §8.1): each content type's entry files as
 * the project's own section owner resolves them, falling back to the source's files when it cannot
 * answer.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProjectExtensionRegistry } from "@jxsuite/compiler/format-host";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type { ContentLoaderEntry } from "@jxsuite/schema/types";
import { collectionLoaderResolver } from "../src/project-state/collections.ts";
import type { SectionLoader } from "../src/project-state/collections.ts";

describe("collectionLoaderResolver", () => {
  const files = [
    "content/blog/a.md",
    "content/blog/b.md",
    "content/fr/docs/intro.md",
    "content/en/docs/intro.md",
    "data/authors.json",
    "data/tags.json",
  ];
  const config = {
    content: {
      authors: { source: "./data/authors.json" },
      blog: { source: "./content/blog" },
      docs: { source: "./content/{locale}/docs" },
      tags: { source: "./data/tags.json" },
    },
    name: "p",
  };
  const registry = (): Promise<ExtensionRegistry> => buildProjectExtensionRegistry(tmpdir());
  /** A loaded entry with the loader's `_meta`, or none. */
  const entry = (meta?: ContentLoaderEntry["_meta"]): ContentLoaderEntry => ({
    body: null,
    data: {},
    id: "e",
    ...(meta !== undefined && { _meta: meta }),
  });
  const input = { config, files, root: "/project" };

  test("keeps the files the loader kept: where and hold count, locales match by name", async () => {
    const loader: SectionLoader = () =>
      Promise.resolve({
        content: new Map<string, ContentLoaderEntry[]>([
          ["authors", [entry({})]],
          ["blog", [entry({ path: "a.md" }), entry()]],
          ["docs", [entry({ locale: "FR", path: "intro.md" })]],
        ]),
      });
    const resolve = collectionLoaderResolver(registry, loader);
    expect(await resolve(input)).toEqual({
      authors: ["data/authors.json"],
      blog: ["content/blog/a.md"],
      docs: ["content/fr/docs/intro.md"],
      tags: ["data/tags.json"],
    });
  });

  test("falls back to the source's files when the loader cannot answer", async () => {
    const sources = {
      authors: ["data/authors.json"],
      blog: ["content/blog/a.md", "content/blog/b.md"],
      docs: ["content/fr/docs/intro.md", "content/en/docs/intro.md"],
      tags: ["data/tags.json"],
    };
    const failing = collectionLoaderResolver(registry, () => Promise.reject(new Error("no")));
    expect(await failing(input)).toEqual(sources);
    const unloaded = collectionLoaderResolver(registry, () => Promise.resolve({ content: {} }));
    expect(await unloaded(input)).toEqual(sources);
    // The compiler's own loader, over a project that installs no section owner.
    const root = mkdtempSync(join(tmpdir(), "jx-collections-"));
    try {
      expect(await collectionLoaderResolver(registry)({ ...input, root })).toEqual(sources);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("a project with no content asks the loader nothing", async () => {
    let asked = false;
    const resolve = collectionLoaderResolver(registry, () => {
      asked = true;
      return Promise.resolve({});
    });
    expect(await resolve({ config: { name: "p" }, files, root: "/project" })).toEqual({});
    expect(asked).toBe(false);
  });
});
