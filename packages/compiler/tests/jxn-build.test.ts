/**
 * A starter built from `.jxn` documents is the same site, byte for byte, as the one built from
 * `.json`, and none of it is KDL. This is the property that says Jx Notation is a spelling.
 */
import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

const mockSharp = () => ({
  metadata: () => Promise.resolve({ format: "jpeg", height: 600, width: 800 }),
  resize: () => ({ toFormat: () => ({ toFile: () => Promise.resolve() }) }),
});
void mock.module("sharp", () => ({ default: mockSharp }));

const { buildSite } = await import("../src/site/site-build.ts");
const { serializeJxn } = await import("@jxsuite/schema/jxn");

const STARTERS = resolve(import.meta.dir, "../../starters/sites");
const WORK = resolve(import.meta.dir, ".jxn-build");
const DOCUMENT_ROOTS = ["components", "layouts", "pages"];
const SOURCE_TIME = new Date("2026-01-01T00:00:00Z");

afterAll(() => {
  rmSync(WORK, { force: true, recursive: true });
});

/** Every file under a directory, by its path from there. */
function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** A copy of a JSON value, with each string that names a converted file renamed. */
function renameRefs(value: JsonValue, rename: (text: string) => string): JsonValue {
  if (isString(value)) {
    return rename(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renameRefs(item, rename));
  }
  if (!isJsonObject(value)) {
    return value;
  }
  const entries = Object.entries(value);
  return Object.fromEntries(entries.map(([key, item]) => [key, renameRefs(item, rename)]));
}

/** What a reference becomes, when it names a file the conversion renames. */
function renamed(text: string, bases: readonly string[], known: ReadonlySet<string>): string {
  const named = text.endsWith(".json") && bases.some((base) => known.has(resolve(base, text)));
  return named ? `${text.slice(0, -".json".length)}.jxn` : text;
}

/** A file's value, as JSON. */
function readValue(path: string): JsonValue {
  // SAFETY: JSON.parse without a reviver only ever yields a JSON value.
  return JSON.parse(readFileSync(path, "utf8")) as JsonValue;
}

/** Turn every document in a project into `.jxn`, and its references with it. */
function toNotation(root: string): number {
  const files = DOCUMENT_ROOTS.flatMap((dir) => walk(join(root, dir)));
  const documents = files.filter((path) => path.endsWith(".json"));
  const known = new Set(documents);
  for (const path of documents) {
    const bases = [dirname(path), root];
    const value = renameRefs(readValue(path), (text) => renamed(text, bases, known));
    // SAFETY: a document's members are all optional, and this one is a starter's, as committed.
    writeFileSync(`${path.slice(0, -".json".length)}.jxn`, serializeJxn(value as JxDocument));
    rmSync(path);
  }
  const projectPath = join(root, "project.json");
  const project = renameRefs(readValue(projectPath), (text) => renamed(text, [root], known));
  writeFileSync(projectPath, JSON.stringify(project, null, 2));
  return documents.length;
}

describe("a starter written in Jx Notation", () => {
  test.each(readdirSync(STARTERS))(
    "%s builds to the same bytes",
    async (name) => {
      const json = join(WORK, name, "json");
      const notation = join(WORK, name, "jxn");
      const keep = (path: string) => !/(?:^|\/)(?:node_modules|dist)(?:\/|$)/u.test(path);
      cpSync(join(STARTERS, name), json, { filter: keep, recursive: true });
      cpSync(join(STARTERS, name), notation, { filter: keep, recursive: true });
      expect(toNotation(notation)).toBeGreaterThan(0);
      // A sitemap's `lastmod` is a source file's mtime, and writing the copies took a moment.
      for (const path of [...walk(json), ...walk(notation)]) {
        utimesSync(path, SOURCE_TIME, SOURCE_TIME);
      }

      const fromJson = await buildSite(json, { clean: true, verbose: false });
      const fromNotation = await buildSite(notation, { clean: true, verbose: false });
      expect(fromJson.errors).toEqual([]);
      expect(fromNotation.errors).toEqual([]);
      expect(fromNotation.routes).toBe(fromJson.routes);

      const out = (root: string) =>
        walk(join(root, "dist"))
          .map((path) => relative(join(root, "dist"), path))
          .toSorted();
      expect(out(notation)).toEqual(out(json));
      const changed = out(json).filter(
        (file) =>
          !readFileSync(join(json, "dist", file)).equals(
            readFileSync(join(notation, "dist", file)),
          ),
      );
      expect(changed).toEqual([]);
      expect(out(notation).filter((file) => file.endsWith(".jxn"))).toEqual([]);
    },
    120_000,
  );
});
