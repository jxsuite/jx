/**
 * The rules both Studio backends share for a project nested inside a larger repository. The real
 * git behaviour they depend on is asserted against real repositories by each backend's
 * `git-nested-project.test.ts`; this pins the decision, including the branches a fixture reaches
 * only with effort.
 */

import { describe, expect, test } from "bun:test";
import { projectCommitArgs, projectRelativePath, readGitPrefix } from "../src/git-scope";
import type { GitRunner } from "../src/git-scope";

/** A repository whose answers are given: its prefix, its index and whether a merge is underway. */
function repository(prefix: string, staged: string[], merging = false): GitRunner {
  return (args) => {
    if (args[0] === "diff") {
      return Promise.resolve(staged.map((path) => `${path}\0`).join(""));
    }
    if (args.includes("--show-prefix")) {
      return Promise.resolve(`${prefix}\n`);
    }
    return merging ? Promise.resolve("abc123\n") : Promise.reject(new Error("no MERGE_HEAD"));
  };
}

const COMMIT = ["commit", "-m", "summary"];

describe("readGitPrefix", () => {
  test("is the folder without git's newline, and empty at the root", async () => {
    expect(await readGitPrefix(repository("Sites/acme/", []))).toBe("Sites/acme/");
    expect(await readGitPrefix(repository("", []))).toBe("");
  });

  test("keeps a folder name git prints verbatim", async () => {
    expect(await readGitPrefix(repository("Sites/acmé site/", []))).toBe("Sites/acmé site/");
  });
});

describe("projectRelativePath", () => {
  test("strips the project's folder", () => {
    expect(projectRelativePath("Sites/acme/", "Sites/acme/pages/index.md")).toBe("pages/index.md");
  });

  test("is the identity at the repository root", () => {
    expect(projectRelativePath("", "pages/index.md")).toBe("pages/index.md");
  });

  test("leaves a path outside the project as git printed it", () => {
    expect(projectRelativePath("Sites/acme/", "Sites/other/index.md")).toBe("Sites/other/index.md");
  });

  test("does not mistake a sibling folder sharing the name's start for the project", () => {
    expect(projectRelativePath("Sites/acme/", "Sites/acme-two/index.md")).toBe(
      "Sites/acme-two/index.md",
    );
  });
});

describe("projectCommitArgs", () => {
  test("at the root: the index when anything is staged", async () => {
    expect(await projectCommitArgs(repository("", ["a.md"]), "summary")).toEqual(COMMIT);
  });

  test("at the root: every tracked change when nothing is", async () => {
    expect(await projectCommitArgs(repository("", []), "summary")).toEqual([...COMMIT, "-a"]);
  });

  test("at the root, a merge with nothing staged still takes every tracked change", async () => {
    expect(await projectCommitArgs(repository("", [], true), "summary")).toEqual([...COMMIT, "-a"]);
  });

  test("nested with only its own staged: the index exactly", async () => {
    const run = repository("Sites/acme/", ["Sites/acme/a.md", "Sites/acme/b.md"]);
    expect(await projectCommitArgs(run, "summary")).toEqual(COMMIT);
  });

  test("nested with others staged too: only its own, cwd-relative", async () => {
    const run = repository("Sites/acme/", ["Sites/acme/a.md", "Sites/other/b.md"]);
    expect(await projectCommitArgs(run, "summary")).toEqual([...COMMIT, "--only", "--", "a.md"]);
  });

  test("nested with nothing of its own staged: its own tracked changes, never -a", async () => {
    expect(await projectCommitArgs(repository("Sites/acme/", []), "summary")).toEqual([
      ...COMMIT,
      "--",
      ".",
    ]);
    expect(await projectCommitArgs(repository("Sites/acme/", ["other/b.md"]), "summary")).toEqual([
      ...COMMIT,
      "--",
      ".",
    ]);
  });

  test("nested during a merge: the merge, which git refuses to split", async () => {
    const run = repository("Sites/acme/", ["Sites/acme/a.md", "Sites/other/b.md"], true);
    expect(await projectCommitArgs(run, "summary")).toEqual(COMMIT);
  });
});
