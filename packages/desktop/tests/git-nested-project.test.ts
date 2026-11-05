/**
 * A project that is a tracked subfolder of a larger repository.
 *
 * Git prints status paths from the repository root and reads pathspecs from the cwd, so Studio's
 * "Include all" asked for `Sites/acme/Sites/acme/…` and failed with `git add failed: … did not
 * match any files`. Real repositories on purpose: the defect lives in what git does, and a stubbed
 * git would agree with whichever coordinate system the code assumed. The folder name carries a
 * space and a non-ASCII byte, the two things git quotes when it is not asked to print verbatim.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  gitCommit,
  gitDiscard,
  gitLog,
  gitShow,
  gitStage,
  gitStatus,
  gitUnstage,
  setProjectRoot,
} from "./_session";

const BASE = mkdtempSync(join(tmpdir(), "jx-git-nested-"));
const REPO = join(BASE, "docs");
const FOLDER = "Sites/acmé site";
const PROJECT = join(REPO, FOLDER);
const OTHER = join(REPO, "Sites/other");
let attempt = 0;

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString();
}

async function statusFiles() {
  const status = await gitStatus();
  return status.files;
}

async function lastMessage() {
  const [entry] = await gitLog({ limit: 1 });
  return entry.message;
}

/** What the last commit changed, repository-relative and verbatim, a rename as both its paths. */
function committedPaths(): string[] {
  return git(REPO, "show", "--name-only", "--no-renames", "-z", "--format=", "HEAD")
    .split("\0")
    .filter(Boolean)
    .toSorted();
}

/** Paths staged across the whole repository, whichever project they belong to. */
function stagedPaths(): string[] {
  return git(REPO, "diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean).toSorted();
}

beforeEach(() => {
  attempt += 1;
  rmSync(REPO, { force: true, recursive: true });
  mkdirSync(join(PROJECT, "content/team"), { recursive: true });
  mkdirSync(OTHER, { recursive: true });
  git(REPO, "init", "-q", "-b", "main");
  git(REPO, "config", "user.email", "test@test.com");
  git(REPO, "config", "user.name", "Test");
  git(REPO, "config", "core.quotePath", "true");
  writeFileSync(join(PROJECT, "content/team/dylan.md"), "v1\n");
  writeFileSync(join(PROJECT, "old.md"), "v1\n");
  writeFileSync(join(OTHER, "index.md"), "v1\n");
  git(REPO, "add", ".");
  git(REPO, "commit", "-qm", `initial ${attempt}`);
  setProjectRoot(PROJECT);
});

afterAll(() => {
  setProjectRoot(null);
  rmSync(BASE, { force: true, recursive: true });
});

describe("status", () => {
  test("names the project's changes from the project root", async () => {
    writeFileSync(join(PROJECT, "content/team/dylan.md"), "v2\n");
    writeFileSync(join(PROJECT, "new.md"), "new\n");
    expect(await statusFiles()).toEqual([
      { path: "content/team/dylan.md", staged: false, status: "M" },
      { path: "new.md", staged: false, status: "U" },
    ]);
  });

  test("leaves out what changed elsewhere in the repository", async () => {
    writeFileSync(join(OTHER, "index.md"), "v2\n");
    writeFileSync(join(REPO, "stray.md"), "stray\n");
    expect(await statusFiles()).toEqual([]);
  });

  test("a rename inside the project reads as its new project-relative name", async () => {
    git(PROJECT, "mv", "old.md", "renamed.md");
    expect(await statusFiles()).toEqual([{ path: "renamed.md", staged: true, status: "R" }]);
  });
});

describe("the verbs that take a path back", () => {
  test("include all: every listed change stages, which is the reported failure", async () => {
    writeFileSync(join(PROJECT, "content/team/dylan.md"), "v2\n");
    writeFileSync(join(PROJECT, "new.md"), "new\n");
    const files = await statusFiles();
    await gitStage({ files: files.map((file) => file.path) });
    expect(await statusFiles()).toEqual([
      { path: "content/team/dylan.md", staged: true, status: "M" },
      { path: "new.md", staged: true, status: "A" },
    ]);
  });

  test("a listed path unstages, and discards", async () => {
    writeFileSync(join(PROJECT, "old.md"), "v2\n");
    const [change] = await statusFiles();
    await gitStage({ files: [change!.path] });
    await gitUnstage({ files: [change!.path] });
    expect(await statusFiles()).toEqual([{ path: "old.md", staged: false, status: "M" }]);
    await gitDiscard({ files: [change!.path] });
    expect(readFileSync(join(PROJECT, "old.md"), "utf8")).toBe("v1\n");
  });

  test("a listed path shows the same file's committed text", async () => {
    writeFileSync(join(PROJECT, "old.md"), "v2\n");
    const [change] = await statusFiles();
    expect(await gitShow({ path: change!.path })).toBe("v1\n");
  });
});

describe("commit", () => {
  test("commits what the project staged", async () => {
    writeFileSync(join(PROJECT, "old.md"), "v2\n");
    await gitStage({ files: ["old.md"] });
    await gitCommit({ message: "publish" });
    expect(await lastMessage()).toBe("publish");
    expect(committedPaths()).toEqual([`${FOLDER}/old.md`]);
  });

  test("another project's staged change stays out of the commit, and stays staged", async () => {
    writeFileSync(join(PROJECT, "old.md"), "v2\n");
    writeFileSync(join(OTHER, "index.md"), "v2\n");
    git(OTHER, "add", "index.md");
    await gitStage({ files: ["old.md"] });
    await gitCommit({ message: "publish" });
    expect(committedPaths()).toEqual([`${FOLDER}/old.md`]);
    expect(stagedPaths()).toEqual(["Sites/other/index.md"]);
  });

  test("a staged rename stays a rename when another project has something staged", async () => {
    writeFileSync(join(OTHER, "index.md"), "v2\n");
    git(OTHER, "add", "index.md");
    git(PROJECT, "mv", "old.md", "renamed.md");
    await gitCommit({ message: "publish" });
    expect(committedPaths()).toEqual([`${FOLDER}/old.md`, `${FOLDER}/renamed.md`]);
    expect(git(REPO, "ls-tree", "-r", "--name-only", "HEAD", "--", `${FOLDER}/old.md`)).toBe("");
    expect(stagedPaths()).toEqual(["Sites/other/index.md"]);
  });

  test("nothing of its own staged commits its own tracked changes, not the repository's", async () => {
    writeFileSync(join(PROJECT, "old.md"), "v2\n");
    writeFileSync(join(OTHER, "index.md"), "v2\n");
    await gitCommit({ message: "publish" });
    expect(committedPaths()).toEqual([`${FOLDER}/old.md`]);
    expect(readFileSync(join(OTHER, "index.md"), "utf8")).toBe("v2\n");
  });

  test("a merge underway finishes as a merge, whatever else it staged", async () => {
    git(REPO, "checkout", "-qb", "theirs");
    writeFileSync(join(OTHER, "index.md"), "theirs\n");
    writeFileSync(join(PROJECT, "old.md"), "theirs\n");
    git(REPO, "commit", "-qam", "theirs");
    git(REPO, "checkout", "-q", "main");
    writeFileSync(join(PROJECT, "old.md"), "mine\n");
    git(REPO, "commit", "-qam", "mine");
    expect(Bun.spawnSync(["git", "merge", "theirs"], { cwd: REPO }).exitCode).not.toBe(0);
    writeFileSync(join(PROJECT, "old.md"), "resolved\n");
    await gitStage({ files: ["old.md"] });
    await gitCommit({ message: "merge" });
    expect(existsSync(join(REPO, ".git/MERGE_HEAD"))).toBe(false);
    expect(git(REPO, "rev-list", "--parents", "-n1", "HEAD").trim().split(" ")).toHaveLength(3);
    expect(stagedPaths()).toEqual([]);
  });
});

describe("a project at the repository's root", () => {
  test("is unchanged: root-relative is project-relative, and the first commit works", async () => {
    const root = join(BASE, "root");
    mkdirSync(root);
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "test@test.com");
    git(root, "config", "user.name", "Test");
    writeFileSync(join(root, "a.md"), "a\n");
    setProjectRoot(root);
    expect(await statusFiles()).toEqual([{ path: "a.md", staged: false, status: "U" }]);
    await gitStage({ files: ["a.md"] });
    await gitCommit({ message: "first" });
    expect(await lastMessage()).toBe("first");
    writeFileSync(join(root, "a.md"), "b\n");
    await gitCommit({ message: "every tracked change" });
    expect(await lastMessage()).toBe("every tracked change");
    expect(await statusFiles()).toEqual([]);
    rmSync(root, { force: true, recursive: true });
  });
});
