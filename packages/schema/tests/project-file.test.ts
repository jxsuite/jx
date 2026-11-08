import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  NEW_PROJECT_FILE_NAME,
  PROJECT_FILE_NAMES,
  ProjectFileConflictError,
  baseName,
  classifyProjectFile,
  findEnclosingProject,
  isProjectConfigPath,
  isProjectFileName,
  parseProjectFile,
  parseProjectSource,
  pickProjectFileName,
  serializeProjectFile,
} from "../src/project-file.ts";
import type { ProjectFileVerdict, ProjectWalkIo } from "../src/project-file.ts";

/** A filesystem of exactly these files, in POSIX spelling, recording what was read. */
function fakeIo(files: Record<string, string>): ProjectWalkIo & { reads: string[] } {
  const reads: string[] = [];
  return {
    dirname: (path) => posix.dirname(path),
    join: (directory, name) => posix.join(directory, name),
    readText: (path) => {
      reads.push(path);
      return files[path] ?? null;
    },
    reads,
  };
}

describe("classifyProjectFile", () => {
  test.each([
    ["a configuration", '{ "name": "Site", "url": "https://example.com" }'],
    ["an empty object, since every member is optional", "{}"],
  ])("%s is a project", (_label, text) => {
    expect(classifyProjectFile(text)).toBe("project");
  });

  test.each([
    ["an element", '{ "tagName": "main" }'],
    ["a page with no tagName", '{ "$layout": "./base.json", "textContent": "Hi" }'],
    ["children alone", '{ "children": [] }'],
    ["a title alone", '{ "title": "About" }'],
    ["a $ref", '{ "$ref": "./other.json" }'],
    ["routed paths", '{ "$paths": {} }'],
    ["markup", '{ "innerHTML": "<p>x</p>" }'],
    ["Nx's targets", '{ "name": "web", "targets": {} }'],
    ["Nx's sourceRoot", '{ "name": "web", "sourceRoot": "apps/web/src" }'],
    ["Nx's projectType", '{ "name": "web", "projectType": "application" }'],
    ["an array", "[]"],
    ["a scalar", "1"],
    ["null", "null"],
  ])("%s is something else", (_label, text) => {
    expect(classifyProjectFile(text)).toBe("other");
  });

  test.each([
    ["a trailing comma", '{ "name": "Site", }'],
    ["an unfinished object", '{ "name": '],
    ["nothing at all", ""],
  ])("%s is unreadable, not something else", (_label, text) => {
    expect(classifyProjectFile(text)).toBe("unreadable");
  });

  test("an inherited member does not count", () => {
    expect(classifyProjectFile('{ "name": "constructor" }')).toBe("project");
  });

  test("every tracked project file is a project", () => {
    const root = resolve(import.meta.dir, "../../..");
    const tracked = execFileSync("git", ["ls-files", `*${NEW_PROJECT_FILE_NAME}`], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter((file) => file.split("/").pop() === NEW_PROJECT_FILE_NAME);
    expect(tracked.length).toBeGreaterThan(0);
    for (const file of tracked) {
      const text = readFileSync(join(root, file), "utf8");
      expect([file, classifyProjectFile(text)]).toEqual([file, "project"]);
    }
  });
});

describe("findEnclosingProject", () => {
  const SITE = '{ "name": "Site" }';

  test("finds the folder it starts in", () => {
    expect(findEnclosingProject("/w/site", fakeIo({ "/w/site/project.json": SITE }))).toEqual({
      projectFile: "/w/site/project.json",
      root: "/w/site",
      verdict: "project",
    });
  });

  test("walks up from a nested folder to the nearest project", () => {
    const io = fakeIo({ "/w/project.json": SITE, "/w/site/project.json": SITE });
    expect(findEnclosingProject("/w/site/pages/blog", io)?.root).toBe("/w/site");
  });

  test("walks past a page named project.json", () => {
    const io = fakeIo({
      "/w/site/pages/project.json": '{ "tagName": "main" }',
      "/w/site/project.json": SITE,
    });
    expect(findEnclosingProject("/w/site/pages", io)?.root).toBe("/w/site");
  });

  test("walks past Nx's project.json to the project around it", () => {
    const io = fakeIo({
      "/w/apps/web/project.json": '{ "name": "web", "targets": {} }',
      "/w/project.json": SITE,
    });
    expect(findEnclosingProject("/w/apps/web", io)?.root).toBe("/w");
  });

  test("believes an unreadable file rather than walking past it to an ancestor", () => {
    const io = fakeIo({ "/w/project.json": SITE, "/w/site/project.json": "{ oops" });
    expect(findEnclosingProject("/w/site/pages", io)).toEqual({
      projectFile: "/w/site/project.json",
      root: "/w/site",
      verdict: "unreadable",
    });
  });

  test("ends at the filesystem's root with nothing found, having asked for each name in each folder once", () => {
    const io = fakeIo({});
    expect(findEnclosingProject("/w/site", io)).toBeNull();
    expect(io.reads).toEqual([
      "/w/site/project.jxn",
      "/w/site/project.json",
      "/w/project.jxn",
      "/w/project.json",
      "/project.jxn",
      "/project.json",
    ]);
  });

  test("never looks past the folder it was told to stop at", () => {
    const io = fakeIo({ "/w/project.json": SITE });
    expect(findEnclosingProject("/w/site/pages", io, "/w/site")).toBeNull();
    expect(io.reads).toEqual([
      "/w/site/pages/project.jxn",
      "/w/site/pages/project.json",
      "/w/site/project.jxn",
      "/w/site/project.json",
    ]);
  });

  test("checks the folder it stops at", () => {
    const io = fakeIo({ "/w/site/project.json": SITE });
    expect(findEnclosingProject("/w/site/pages", io, "/w/site")?.root).toBe("/w/site");
  });
});

describe("project.jxn", () => {
  const JXN = 'project "Site"\nurl "https://example.com"\n';

  test("both names are a project's, and nothing else is", () => {
    for (const name of PROJECT_FILE_NAMES) {
      expect(isProjectFileName(name)).toBe(true);
      expect(isProjectConfigPath(name)).toBe(true);
    }
    expect(isProjectFileName("pages/project.jxn")).toBe(false);
    expect(isProjectConfigPath("new-project.jxn")).toBe(false);
    expect(isProjectFileName(null)).toBe(false);
  });

  test.each<[string, string, ProjectFileVerdict]>([
    ["a declared project", JXN, "project"],
    ["a page by that name", 'h1 "About the project"', "other"],
    ["a project with a typo after its declaration", 'project "Site"\ndefaults {', "project"],
    ["a binary file", "\0\0", "unreadable"],
  ])("%s", (_label, text, verdict) => {
    expect(classifyProjectFile(text, "/w/site/project.jxn")).toBe(verdict);
  });

  test("the walk finds a project.jxn, and walks past a page by that name", () => {
    const io = fakeIo({
      "/w/site/pages/project.jxn": 'h1 "About"',
      "/w/site/project.jxn": JXN,
    });
    expect(findEnclosingProject("/w/site/pages", io)).toEqual({
      projectFile: "/w/site/project.jxn",
      root: "/w/site",
      verdict: "project",
    });
  });

  test("a folder holding both is a conflict, which no walk passes", () => {
    const io = fakeIo({
      "/w/project.json": '{ "name": "Outer" }',
      "/w/site/project.json": '{ "name": "Site" }',
      "/w/site/project.jxn": JXN,
    });
    expect(findEnclosingProject("/w/site/pages", io)).toEqual({
      projectFile: "/w/site/project.jxn",
      root: "/w/site",
      verdict: "conflict",
    });
  });

  test("a page named project.jxn beside a project.json is no conflict", () => {
    const io = fakeIo({
      "/w/site/project.json": '{ "name": "Site" }',
      "/w/site/project.jxn": 'h1 "About"',
    });
    expect(findEnclosingProject("/w/site", io)?.verdict).toBe("project");
  });

  test("which name a folder holds", () => {
    expect(pickProjectFileName((name) => name === "project.jxn")).toBe("project.jxn");
    expect(pickProjectFileName((name) => name === "project.json")).toBe("project.json");
    expect(pickProjectFileName(() => true)).toBe("conflict");
    expect(pickProjectFileName(() => false)).toBeNull();
  });

  test("the conflict names both files, and is an error of its own kind", () => {
    const error = new ProjectFileConflictError("/w/site");
    expect(error.name).toBe("ProjectFileConflictError");
    expect(error.message).toContain("project.jxn");
    expect(error.message).toContain("project.json");
    expect(error.message).toContain("/w/site");
  });

  test("a file is read in the format its name says", () => {
    expect(parseProjectSource(JXN, "/w/project.jxn")).toEqual({
      name: "Site",
      url: "https://example.com",
    });
    expect(parseProjectSource('{ "name": "Site" }', "/w/project.json")).toEqual({ name: "Site" });
    expect(parseProjectFile("/w/project.jxn", "project\nproject")).toMatchObject({
      error: expect.stringContaining("/w/project.jxn"),
    });
  });

  test("a project.jxn is written in Jx Notation, keeping its comments", () => {
    const previous =
      '/- kdl-version 2\n// The site.\nproject "Site"\n\n// Where it lives.\nurl "https://a.example"\n';
    const written = serializeProjectFile(
      { name: "Site", url: "https://b.example" },
      previous,
      "/w/project.jxn",
    );
    expect(written).toBe(previous.replace("a.example", "b.example"));
    expect(serializeProjectFile({ name: "Site" }, null, "project.jxn")).toBe(
      "/- kdl-version 2\nproject Site\n",
    );
  });

  test("a project file is written as JSON without a path, which is a new project's name", () => {
    expect(NEW_PROJECT_FILE_NAME).toBe("project.json");
    expect(serializeProjectFile({ name: "Site" }, null)).toBe('{\n  "name": "Site"\n}\n');
  });

  test("a path's base name, in either separator", () => {
    expect(baseName("a/b/project.jxn")).toBe("project.jxn");
    expect(baseName(String.raw`C:\a\project.json`)).toBe("project.json");
    expect(baseName("project.json")).toBe("project.json");
  });
});
