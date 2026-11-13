/**
 * A starter built from `.jxn` documents, as the starters are committed, is the same site, byte for
 * byte, as the one built from their `.json` spelling, and none of it is KDL. This is the property
 * that says Jx Notation is a spelling.
 */
import { parseProjectSource, serializeProjectFile } from "@jxsuite/schema/project-file";
import { projectFilePath } from "@jxsuite/schema/project-file/node";
import { afterAll, describe, expect, test } from "bun:test";
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
import { installFakeBinding } from "./_fake-binding.ts";
import type { JsonValue } from "@jxsuite/schema/types";

installFakeBinding();

const { buildSite } = await import("../src/site/site-build.ts");
const { parseJxn } = await import("@jxsuite/schema/jxn");

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
  const named = text.endsWith(".jxn") && bases.some((base) => known.has(resolve(base, text)));
  return named ? `${text.slice(0, -".jxn".length)}.json` : text;
}

/** A `.jxn` document's value. */
function readValue(path: string): JsonValue {
  // SAFETY: a document read from Jx Notation is a JSON value by construction.
  return parseJxn(readFileSync(path, "utf8"), path) as JsonValue;
}

/** Turn every `.jxn` document in a project into `.json`, and its references with it. */
function toJsonSpelling(root: string): number {
  const files = DOCUMENT_ROOTS.flatMap((dir) => walk(join(root, dir)));
  const documents = files.filter((path) => path.endsWith(".jxn"));
  const known = new Set(documents);
  for (const path of documents) {
    const bases = [dirname(path), root];
    const value = renameRefs(readValue(path), (text) => renamed(text, bases, known));
    writeFileSync(`${path.slice(0, -".jxn".length)}.json`, `${JSON.stringify(value, null, 2)}\n`);
    rmSync(path);
  }
  // The project file in whichever notation the starter has, with its references following.
  const projectPath = projectFilePath(root);
  const text = readFileSync(projectPath, "utf8");
  const config: unknown = parseProjectSource(text, projectPath);
  const project = isJsonObject(config)
    ? renameRefs(config, (ref) => renamed(ref, [root], known))
    : null;
  if (!isJsonObject(project)) {
    throw new TypeError(`${projectPath} is not a project`);
  }
  writeFileSync(projectPath, serializeProjectFile(project, text, projectPath));
  return documents.length;
}

/** Where two files first part, with enough on each side to read. */
function firstDifference(left: string, right: string): string {
  const a = readFileSync(left, "utf8");
  const b = readFileSync(right, "utf8");
  let index = 0;
  while (index < a.length && a[index] === b[index]) {
    index += 1;
  }
  const around = (text: string) => JSON.stringify(text.slice(Math.max(0, index - 60), index + 120));
  return `${left}@${index}: ${around(a)} / ${around(b)}`;
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
      expect(toJsonSpelling(json)).toBeGreaterThan(0);
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
      // What differs, when something does: which file is not enough to act on.
      expect(
        changed.map((file) =>
          firstDifference(join(json, "dist", file), join(notation, "dist", file)),
        ),
      ).toEqual([]);
      expect(out(notation).filter((file) => file.endsWith(".jxn"))).toEqual([]);
    },
    120_000,
  );
});
