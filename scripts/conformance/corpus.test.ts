import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { corpus, leaveAsFound, routesOf, sample, selectProjects, slugOf } from "./corpus.ts";

let root = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "jx-conformance-corpus-"));
  const file = (path: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), "");
  };
  file("packages/starters/sites/shop/project.jxn");
  file("packages/starters/sites/blog/project.json");
  file("packages/starters/sites/notes/README.md");
  file("sites/jxsuite.com/project.jxn");
  file("examples/project.jxn");
  file("dist/index.html");
  file("dist/about/index.html");
  file("dist/404.html");
  file("dist/docs/start/index.html");
  file("dist/assets/app.js");
});

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("corpus", () => {
  test("every directory with a project file is a project, sorted, and nothing else is", () => {
    expect(corpus(root)).toEqual([
      { dir: "packages/starters/sites/blog", id: "blog" },
      { dir: "examples", id: "examples" },
      { dir: "sites/jxsuite.com", id: "jxsuite.com" },
      { dir: "packages/starters/sites/shop", id: "shop" },
    ]);
  });

  test("a tree with none of the directories has an empty corpus", () => {
    expect(corpus(join(root, "dist"))).toEqual([]);
  });

  test("this repository's corpus holds every starter, the site and the examples", () => {
    const ids = corpus(resolve(import.meta.dir, "../..")).map((project) => project.id);
    expect(ids).toContain("jxsuite.com");
    expect(ids).toContain("examples");
    expect(ids).toContain("blog");
    expect(ids.length).toBeGreaterThan(13);
  });
});

describe("selectProjects", () => {
  const projects = [
    { dir: "a", id: "blog" },
    { dir: "b", id: "shop" },
  ];

  test("an empty list selects everything, and a list selects by id", () => {
    expect(selectProjects(projects, "")).toEqual(projects);
    expect(selectProjects(projects, " shop , ")).toEqual([{ dir: "b", id: "shop" }]);
  });

  test("an unknown name is refused, and the corpus is named", () => {
    expect(() => selectProjects(projects, "shop,sohp")).toThrow(
      "No such project: sohp. The corpus has: blog, shop.",
    );
  });
});

describe("routesOf", () => {
  test("index.html is its directory, another page is itself, and assets are not routes", () => {
    expect(routesOf(join(root, "dist"))).toEqual(["/", "/404.html", "/about/", "/docs/start/"]);
  });

  test("a build that wrote nothing has no routes", () => {
    expect(routesOf(join(root, "absent"))).toEqual([]);
  });
});

describe("sample", () => {
  const routes = ["/", "/a/", "/b/", "/c/", "/d/", "/e/", "/f/", "/g/"];

  test("a short list, or no limit, is kept whole", () => {
    expect(sample(routes, 8)).toEqual(routes);
    expect(sample(routes, 0)).toEqual(routes);
  });

  test("a long list is thinned evenly, keeps its first, and is the same every time", () => {
    const first = sample(routes, 4);
    expect(first).toEqual(["/", "/b/", "/d/", "/f/"]);
    expect(sample(routes, 4)).toEqual(first);
    expect(sample(routes, 3)).toEqual(["/", "/b/", "/e/"]);
  });
});

test("a project is left without build output it did not have, and keeps what it had", () => {
  const project = join(root, "packages/starters/sites/shop");
  const had = join(root, "sites/jxsuite.com");
  mkdirSync(join(had, "dist"));
  const restoreProject = leaveAsFound(project);
  const restoreHad = leaveAsFound(had);
  mkdirSync(join(project, "dist/about"), { recursive: true });
  mkdirSync(join(project, ".cache"));
  mkdirSync(join(had, ".cache"));
  restoreProject();
  restoreHad();
  expect(existsSync(join(project, "dist"))).toBe(false);
  expect(existsSync(join(project, ".cache"))).toBe(false);
  expect(existsSync(join(project, "project.jxn"))).toBe(true);
  expect(existsSync(join(had, "dist"))).toBe(true);
  expect(existsSync(join(had, ".cache"))).toBe(false);
});

test("a route becomes a file name that is safe and still readable", () => {
  expect(slugOf("/")).toBe("index");
  expect(slugOf("/docs/start/")).toBe("docs~start");
  expect(slugOf("/404.html")).toBe("404.html");
  expect(slugOf("/fr-ca/à propos/")).toBe("fr-ca~__propos");
});
