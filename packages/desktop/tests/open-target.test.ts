/** What a path the operating system handed over turns out to be (specs/desktop.md §4.6). */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveOpenTarget } from "../src/backend/project-session";

let scratch: string;

function write(path: string, text: string): string {
  const absolute = join(scratch, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, text);
  return absolute;
}

beforeAll(() => {
  const made = mkdtempSync(join(tmpdir(), "jx-open-target-"));
  scratch = realpathSync(made);
  write("site/project.json", '{ "name": "Site" }');
  write("site/pages/index.json", '{ "tagName": "main" }');
  write("site/pages/project.json", '{ "tagName": "main", "textContent": "Our projects" }');
  write("site/content/note.md", "# Note");
  write("broken/project.json", "{ oops");
  write("broken/pages/index.json", "{}");
  write("mono/project.json", '{ "name": "Mono" }');
  write("mono/apps/web/project.json", '{ "name": "web", "targets": {} }');
  write("mono/apps/web/src/data.json", "{}");
  write("nx/project.json", '{ "name": "web", "targets": {} }');
  write("loose/card.json", '{ "tagName": "div" }');
  write("notation/project.jxn", 'project "Notation"\n');
  write("notation/pages/project.jxn", 'h1 "About the project"\n');
  write("twice/project.jxn", 'project "Twice"\n');
  write("twice/project.json", '{ "name": "Twice" }');
  write("twice/pages/index.json", '{ "tagName": "main" }');
});

afterAll(() => {
  rmSync(scratch, { force: true, recursive: true });
});

describe("resolveOpenTarget", () => {
  const at = (path: string): string => join(scratch, path);

  test("a project file opens its project, showing nothing in particular", () => {
    expect(resolveOpenTarget(at("site/project.json"))).toEqual({
      file: null,
      kind: "project",
      problem: null,
      root: at("site"),
    });
  });

  test("a project's folder opens that project", () => {
    expect(resolveOpenTarget(at("site"))).toEqual({
      file: null,
      kind: "project",
      problem: null,
      root: at("site"),
    });
  });

  test.each([
    ["a page", "site/pages/index.json", "pages/index.json"],
    ["a Markdown file", "site/content/note.md", "content/note.md"],
    ["a page named project.json, which is a page", "site/pages/project.json", "pages/project.json"],
  ])("%s opens its project with the file in a tab", (_label, path, file) => {
    expect(resolveOpenTarget(at(path))).toEqual({
      file,
      kind: "project",
      problem: null,
      root: at("site"),
    });
  });

  test("Nx's project.json is walked past, to the Jx project around it", () => {
    expect(resolveOpenTarget(at("mono/apps/web/src/data.json"))).toMatchObject({
      file: "apps/web/src/data.json",
      root: at("mono"),
    });
    expect(resolveOpenTarget(at("mono/apps/web/project.json"))).toMatchObject({
      file: "apps/web/project.json",
      root: at("mono"),
    });
  });

  test("a project file with a typo is still that project, and says so", () => {
    const target = resolveOpenTarget(at("broken/pages/index.json"));
    expect(target).toMatchObject({ file: "pages/index.json", kind: "project", root: at("broken") });
    expect(target.kind === "project" ? target.problem : null).toContain("can't read");
    expect(target.kind === "project" ? target.problem : null).toContain(at("broken/project.json"));
  });

  test("a project.jxn opens its project, and a page by that name is a page in it", () => {
    expect(resolveOpenTarget(at("notation/project.jxn"))).toEqual({
      file: null,
      kind: "project",
      problem: null,
      root: at("notation"),
    });
    expect(resolveOpenTarget(at("notation/pages/project.jxn"))).toEqual({
      file: "pages/project.jxn",
      kind: "project",
      problem: null,
      root: at("notation"),
    });
  });

  test("a folder holding both project files opens, and names both", () => {
    const target = resolveOpenTarget(at("twice/pages/index.json"));
    expect(target).toMatchObject({ file: "pages/index.json", kind: "project", root: at("twice") });
    const problem = target.kind === "project" ? target.problem : null;
    expect(problem).toContain("project.jxn and project.json");
    expect(problem).toContain("open the project again");
  });

  test("a folder is not a project because something above it is", () => {
    expect(resolveOpenTarget(at("site/pages"))).toMatchObject({ kind: "refused" });
  });

  test.each([
    ["a folder with no project file", "loose", "it has no project.jxn or project.json"],
    ["a file in no project", "loose/card.json", "card.json isn't inside a Jx project"],
    ["a project file that is really Nx's, with none around it", "nx/project.json", "isn't inside"],
    ["a path that is not there", "gone/page.json", "can't find"],
  ])("%s is refused with a sentence", (_label, path, words) => {
    const target = resolveOpenTarget(at(path));
    expect(target.kind).toBe("refused");
    expect(target.kind === "refused" ? target.reason : "").toContain(words);
  });

  describe("a candidate is untrusted until someone has answered for its folder", () => {
    test("a FIFO named project.json is not read, so it cannot hold up the backend", () => {
      if (process.platform === "win32") {
        return;
      }
      write("fifo/pages/a.json", "{}");
      execFileSync("mkfifo", [at("fifo/project.json")]);
      expect(resolveOpenTarget(at("fifo/pages/a.json"))).toMatchObject({ kind: "refused" });
    });

    test("a link to a device is not read either", () => {
      if (process.platform === "win32") {
        return;
      }
      write("device/pages/a.json", "{}");
      symlinkSync("/dev/zero", at("device/project.json"));
      expect(resolveOpenTarget(at("device/pages/a.json"))).toMatchObject({ kind: "refused" });
    });

    test("a directory named project.json is not a project file", () => {
      write("dir/project.json/x", "");
      write("dir/a.json", "{}");
      expect(resolveOpenTarget(at("dir/a.json"))).toMatchObject({ kind: "refused" });
    });

    test("a file too large to be one is believed and reported, without being read", () => {
      write("huge/pages/a.json", "{}");
      truncateSync(write("huge/project.json", ""), 5 * 1024 * 1024);
      expect(resolveOpenTarget(at("huge/pages/a.json"))).toMatchObject({
        file: "pages/a.json",
        root: at("huge"),
      });
    });

    test("one it may not read stops the walk rather than opening the folder above", () => {
      if (process.platform === "win32" || process.getuid?.() === 0) {
        return;
      }
      write("locked/project.json", '{ "name": "Outer" }');
      write("locked/inner/pages/a.json", "{}");
      const secret = write("locked/inner/project.json", '{ "name": "Inner" }');
      chmodSync(secret, 0o000);
      try {
        const target = resolveOpenTarget(at("locked/inner/pages/a.json"));
        expect(target).toMatchObject({ root: at("locked/inner") });
        expect(target.kind === "project" ? target.problem : null).toContain("can't read");
      } finally {
        chmodSync(secret, 0o600);
      }
    });
  });

  test("it runs nothing: a module beside the project is never loaded", () => {
    write("site/boom.js", 'throw new Error("ran");');
    expect(resolveOpenTarget(at("site/project.json")).kind).toBe("project");
  });
});
