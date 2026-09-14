/**
 * Covers the two things `spec:release` owes that the pure library cannot prove alone: the landing
 * clock reads MERGE order off a real repository (a fragment written first but merged second mints
 * second), and `readFragments` reads the directory the way the lane will find it.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FRAGMENTS_DIR,
  fragmentLandingClock,
  orderFragments,
  readFragments,
  renderFragment,
} from "./lib/spec-release.ts";

/** A git command in `root`, with dates pinned so the test is deterministic. */
function git(root: string, args: string[], date = "2026-09-14T12:00:00Z"): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: date,
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_AUTHOR_NAME: "t",
      GIT_COMMITTER_DATE: date,
      GIT_COMMITTER_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** A repository with `main`, and a helper that adds a fragment on a branch at a given author date. */
function repo(): { root: string; branch: (name: string, fragment: string, at: string) => void } {
  const root = mkdtempSync(join(tmpdir(), "spec-release-"));
  git(root, ["init", "-q", "-b", "main"]);
  mkdirSync(join(root, FRAGMENTS_DIR), { recursive: true });
  writeFileSync(join(root, "README.md"), "root\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "root"], "2026-09-01T00:00:00Z");
  return {
    branch: (name, fragment, at) => {
      git(root, ["checkout", "-q", "-b", name, "main"]);
      // Git drops the directory with its last tracked file when the branch changes.
      mkdirSync(join(root, FRAGMENTS_DIR), { recursive: true });
      writeFileSync(join(root, FRAGMENTS_DIR, fragment), renderFragment("x.md", "patch", name));
      git(root, ["add", "."]);
      git(root, ["commit", "-q", "-m", name], at);
      git(root, ["checkout", "-q", "main"]);
    },
    root,
  };
}

describe("fragmentLandingClock", () => {
  test("orders by when a fragment MERGED, not by when it was written", () => {
    const { root, branch } = repo();
    // `early` is written first; `late` is written later but merged first.
    branch("early", "x-early.md", "2026-09-02T00:00:00Z");
    branch("late", "x-late.md", "2026-09-05T00:00:00Z");
    git(root, ["merge", "-q", "--no-ff", "-m", "merge late", "late"], "2026-09-10T00:00:00Z");
    git(root, ["merge", "-q", "--no-ff", "-m", "merge early", "early"], "2026-09-11T00:00:00Z");

    const clock = fragmentLandingClock(root);
    const fragments = readFragments(root);
    expect(fragments.map((f) => f.name)).toEqual(["x-early.md", "x-late.md"]);
    expect(orderFragments(fragments, clock).map((f) => f.name)).toEqual([
      "x-late.md",
      "x-early.md",
    ]);
    // The clock is the merge commit's, not the branch commit's.
    expect(clock(fragments[1]!)).toBe(Date.parse("2026-09-10T00:00:00Z") / 1000);
  });

  test("a fragment git has not seen sorts last, and a repository-less root reads as never", () => {
    const { root } = repo();
    writeFileSync(join(root, FRAGMENTS_DIR, "x-local.md"), renderFragment("x.md", "patch", "l"));
    expect(
      fragmentLandingClock(root)({
        level: "patch",
        name: "x-local.md",
        spec: "x.md",
        summary: "l",
      }),
    ).toBe(Number.POSITIVE_INFINITY);
    const nowhere = mkdtempSync(join(tmpdir(), "spec-release-none-"));
    expect(
      fragmentLandingClock(nowhere)({ level: "patch", name: "x.md", spec: "x.md", summary: "" }),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("readFragments", () => {
  test("reads every fragment by name, skips the directory's README, and is empty without the dir", () => {
    const root = mkdtempSync(join(tmpdir(), "spec-release-read-"));
    expect(readFragments(root)).toEqual([]);
    mkdirSync(join(root, FRAGMENTS_DIR), { recursive: true });
    writeFileSync(join(root, FRAGMENTS_DIR, "README.md"), "# not a fragment\n");
    writeFileSync(join(root, FRAGMENTS_DIR, "b.md"), renderFragment("ui.md", "minor", "two"));
    writeFileSync(join(root, FRAGMENTS_DIR, "a.md"), renderFragment("ui.md", "patch", "one"));
    expect(readFragments(root).map((f) => `${f.name}:${f.level}:${f.summary}`)).toEqual([
      "a.md:patch:one",
      "b.md:minor:two",
    ]);
  });
});
