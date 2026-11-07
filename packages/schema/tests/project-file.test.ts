import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  PROJECT_FILE_NAME,
  classifyProjectFile,
  findEnclosingProject,
} from "../src/project-file.ts";
import type { ProjectWalkIo } from "../src/project-file.ts";

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
    const tracked = execFileSync("git", ["ls-files", `*${PROJECT_FILE_NAME}`], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter((file) => file.split("/").pop() === PROJECT_FILE_NAME);
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

  test("ends at the filesystem's root with nothing found, having asked for each folder once", () => {
    const io = fakeIo({});
    expect(findEnclosingProject("/w/site", io)).toBeNull();
    expect(io.reads).toEqual(["/w/site/project.json", "/w/project.json", "/project.json"]);
  });

  test("never looks past the folder it was told to stop at", () => {
    const io = fakeIo({ "/w/project.json": SITE });
    expect(findEnclosingProject("/w/site/pages", io, "/w/site")).toBeNull();
    expect(io.reads).toEqual(["/w/site/pages/project.json", "/w/site/project.json"]);
  });

  test("checks the folder it stops at", () => {
    const io = fakeIo({ "/w/site/project.json": SITE });
    expect(findEnclosingProject("/w/site/pages", io, "/w/site")?.root).toBe("/w/site");
  });
});
