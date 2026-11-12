/**
 * The schemas a `.jxn` file is completed from (`spec.md` §22.6): the ones its project root holds,
 * followed as they are written again, and the core where the root holds none.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { schemasFor } from "../src/schemas";

const TEMP = mkdtempSync(join(tmpdir(), "jx-vscode-schemas-"));

afterAll(() => {
  rmSync(TEMP, { force: true, recursive: true });
});

/** The core, which is flattened once and handed out again. */
const CORE = schemasFor(null);

/** A new project root under a name, with a page folder in it. */
function projectRoot(name: string): string {
  const root = join(TEMP, name);
  mkdirSync(join(root, "pages"), { recursive: true });
  writeFileSync(join(root, "project.jxn"), '/- kdl-version 2\nproject "Demo"\n');
  return root;
}

/** Write a file and say when it was written, in whole seconds from a fixed day. */
function writeAt(path: string, text: string, seconds: number): void {
  writeFileSync(path, text);
  utimesSync(path, 1_700_000_000 + seconds, 1_700_000_000 + seconds);
}

describe("a file in no project", () => {
  test("is completed from the core, as a document that is not on disk is", () => {
    mkdirSync(join(TEMP, "loose"), { recursive: true });
    expect(schemasFor(join(TEMP, "loose", "a.jxn"))).toBe(CORE);
    expect(Object.keys(CORE.document).length).toBeGreaterThan(0);
    expect(Object.keys(CORE.project).length).toBeGreaterThan(0);
  });
});

describe("a file in a project", () => {
  test("is completed from the two schemas its root holds, from any folder under it", () => {
    const root = projectRoot("both");
    writeAt(join(root, "document.schema.json"), '{ "title": "its documents" }', 1);
    writeAt(join(root, "project.schema.json"), '{ "title": "its project" }', 1);
    expect(schemasFor(join(root, "pages", "index.jxn"))).toEqual({
      document: { title: "its documents" },
      project: { title: "its project" },
    });
    expect(schemasFor(join(root, "project.jxn")).project).toEqual({ title: "its project" });
  });

  test("is completed from the core for a half its root does not hold", () => {
    const root = projectRoot("half");
    expect(schemasFor(join(root, "pages", "index.jxn"))).toEqual(CORE);

    writeAt(join(root, "document.schema.json"), '{ "title": "its documents" }', 1);
    const found = schemasFor(join(root, "pages", "index.jxn"));
    expect(found.document).toEqual({ title: "its documents" });
    expect(found.project).toBe(CORE.project);
  });

  test("is completed from the core while a schema is not one", () => {
    const root = projectRoot("broken");
    const file = join(root, "pages", "index.jxn");
    // Half written, as a schema is while it is being generated.
    writeAt(join(root, "document.schema.json"), '{ "title": ', 1);
    // JSON, and not a schema.
    writeAt(join(root, "project.schema.json"), "[]", 1);
    expect(schemasFor(file).document).toBe(CORE.document);
    expect(schemasFor(file).project).toBe(CORE.project);

    writeAt(join(root, "document.schema.json"), '{ "title": "whole" }', 2);
    expect(schemasFor(file).document).toEqual({ title: "whole" });
  });

  test("reads a schema once, and again when it has been written again", () => {
    const root = projectRoot("kept");
    const file = join(root, "pages", "index.jxn");
    const schema = join(root, "document.schema.json");

    writeAt(schema, '{ "title": "first" }', 1);
    const first = schemasFor(file).document;
    expect(schemasFor(file).document).toBe(first);

    // The time a file was written is what is kept by, so the same time is the same schema.
    writeAt(schema, '{ "title": "unseen" }', 1);
    expect(schemasFor(file).document).toBe(first);

    writeAt(schema, '{ "title": "second" }', 2);
    expect(schemasFor(file).document).toEqual({ title: "second" });
  });

  test("forgets a schema that is taken away", () => {
    const root = projectRoot("gone");
    const file = join(root, "pages", "index.jxn");
    const schema = join(root, "document.schema.json");

    writeAt(schema, '{ "title": "first" }', 1);
    expect(schemasFor(file).document).toEqual({ title: "first" });

    rmSync(schema);
    expect(schemasFor(file).document).toBe(CORE.document);

    // Written again at the time the first was: it is read, because nothing was kept of the first.
    writeAt(schema, '{ "title": "again" }', 1);
    expect(schemasFor(file).document).toEqual({ title: "again" });
  });
});
