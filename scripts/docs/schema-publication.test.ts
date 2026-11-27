/**
 * Every core schema artifact is served from jxsuite.com at its `$id`, and every canonical URL a
 * shipped schema references is one the site publishes (specs/extensions.md §5.4). A client that
 * fetches the canonical URLs instead of holding an entry document gets the shipped defaults only if
 * the site's `copy` map serves them; nothing else judges that map, because `sites/**` runs no
 * workspace suite.
 *
 * It lives in `scripts/docs/` beside the site's other build-time helpers, and runs unconditionally
 * via `bun test --isolate scripts` in test.yml's `changes` job. `scripts/docs/**` is in
 * `affected.ts`'s NO_TESTS list, so editing it costs no workspace matrix run.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseProject } from "@jxsuite/schema/jxn";
import type { JsonValue } from "@jxsuite/schema/types";

import { candidatePaths, classifySchema } from "../check-schema-freshness.ts";

const SITE = "sites/jxsuite.com";
/** The trailing slash keeps the class-descriptor `$id`s (`https://jxsuite.com/schemas/...`) out. */
export const CANONICAL = "https://jxsuite.com/schema/";

/**
 * Map each canonical URL the site publishes to its repo-relative source.
 *
 * @param copy The site's `copy` map, source (relative to the site) to destination
 * @returns The canonical URL to repo-relative source path
 */
export function publishedSchemas(copy: Record<string, string>): Map<string, string> {
  const published = new Map<string, string>();
  for (const [source, destination] of Object.entries(copy)) {
    const match = /^schema\/(.+)\/index\.json$/.exec(destination);
    if (match) {
      published.set(`${CANONICAL}${match[1]}`, join(SITE, source));
    }
  }
  return published;
}

/**
 * Collect every canonical `$ref` URL under a node, without its fragment.
 *
 * @param node Any parsed JSON value
 * @returns The sorted unique canonical URLs
 */
export function canonicalRefs(node: JsonValue): string[] {
  // A `$ref` member is `"$ref":"<string>"` in the compact serialization, at any depth.
  const pattern = new RegExp(`"\\$ref":"(${CANONICAL}[^"#]*)`, "g");
  const urls = [...JSON.stringify(node).matchAll(pattern)].map((match) => match[1]!);
  return [...new Set(urls)].toSorted();
}

/* SAFETY: every path read here comes from `git ls-files` or the copy map and is a committed JSON
 * file, so the parse yields a JSON value. */
const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, "utf8")) as JsonValue;

/** A schema file's `$id`, or the empty string when it declares none. */
function idOf(path: string): string {
  const doc = readJson(path);
  // SAFETY: a schema file is a JSON object, and `$id` is a string when present.
  return (doc as { $id?: string }).$id ?? "";
}

/* SAFETY: parseProject returns the project's JSON value, and `copy` is a string-to-string map in
 * the site's project file (the site build reads it as one). */
const { copy } = parseProject(readFileSync(join(SITE, "project.jxn"), "utf8")) as {
  copy: Record<string, string>;
};
const published = publishedSchemas(copy);
const paths = candidatePaths();
const core = paths.filter((p) => classifySchema(p) === "core");
const referencing = paths.filter((p) => ["core", "fragment"].includes(classifySchema(p)));

describe("schema publication", () => {
  test("canonicalRefs collects nested canonical refs without their fragments and ignores every other ref", () => {
    const refs = canonicalRefs({
      $id: "https://jxsuite.com/schemas/Foo.class.json",
      $ref: "https://jxsuite.com/schema/project/core/v2#/$defs/X",
      anyOf: [{ items: { $ref: "https://jxsuite.com/schema/project/fields/v2" } }],
      properties: { a: { $ref: "#/$defs/y" }, b: { $ref: "https://example.com/schema/z" } },
    });
    expect(refs).toEqual([
      "https://jxsuite.com/schema/project/core/v2",
      "https://jxsuite.com/schema/project/fields/v2",
    ]);
  });

  test("every schema path the copy map publishes serves the document whose $id names it", () => {
    expect(published.size).toBeGreaterThan(0);
    for (const [url, source] of published) {
      expect(existsSync(source), `${source} (published at ${url}) does not exist`).toBe(true);
      expect(idOf(source), `${source} is published at ${url}`).toBe(url);
    }
  });

  test("every core schema artifact is published at its $id", () => {
    expect(core.length).toBeGreaterThan(0);
    for (const path of core) {
      const id = idOf(path);
      expect(id.startsWith(CANONICAL), `${path} declares $id ${id}, outside ${CANONICAL}`).toBe(
        true,
      );
      expect(
        published.get(id),
        `${path} declares $id ${id}, but ${SITE}/project.jxn copy has no entry serving it: add ` +
          `"../../${path}" "${id.slice("https://jxsuite.com/".length)}/index.json"`,
      ).toBe(path);
    }
  });

  test("every canonical $ref in a core artifact or an extension fragment names a published schema", () => {
    const all = new Set<string>();
    for (const path of referencing) {
      for (const url of canonicalRefs(readJson(path))) {
        all.add(url);
        expect(
          published.has(url),
          `${path} references ${url}, which the site does not publish`,
        ).toBe(true);
      }
    }
    expect(all.has("https://jxsuite.com/schema/project/fields/v2")).toBe(true);
    expect(all.has("https://jxsuite.com/schema/project/core/v2")).toBe(true);
  });
});
