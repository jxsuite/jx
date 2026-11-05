/**
 * The dev server's half of `packages/desktop/tests/git-nested-project.test.ts`: a project that is a
 * tracked subfolder of a larger repository, against real git through the real routes. A status path
 * has to be the path every other route reads, and a commit has to stay inside the project.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitStatusResult } from "@jxsuite/protocol";
import type { JsonObject } from "@jxsuite/schema/types";
import { handleStudioApi } from "../src/studio-api";

const BASE = mkdtempSync(join(tmpdir(), "jx-git-nested-server-"));
const REPO = join(BASE, "docs");
const SITE_FOLDER = "Sites/été site";
const PROJECT = join(REPO, SITE_FOLDER);
const OTHER = join(REPO, "Sites/other");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
}

async function route(name: string, body?: JsonObject, query = ""): Promise<Response> {
  const urlStr = `http://localhost/__studio/git/${name}?dir=${encodeURIComponent(PROJECT)}${query}`;
  const init: RequestInit = body
    ? {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    : {};
  const res = await handleStudioApi(new Request(urlStr, init), new URL(urlStr), BASE, PROJECT);
  if (!res) {
    throw new Error(`No response for ${name}`);
  }
  return res;
}

async function statusFiles(): Promise<GitStatusResult["files"]> {
  const res = await route("status");
  const status: GitStatusResult = await res.json();
  return status.files;
}

function committedPaths(): string[] {
  return git(REPO, "show", "--name-only", "-z", "--format=", "HEAD")
    .split("\0")
    .filter(Boolean)
    .toSorted();
}

beforeEach(() => {
  rmSync(REPO, { force: true, recursive: true });
  mkdirSync(join(PROJECT, "content"), { recursive: true });
  mkdirSync(OTHER, { recursive: true });
  git(REPO, "init", "-q", "-b", "main");
  git(REPO, "config", "user.email", "test@test.com");
  git(REPO, "config", "user.name", "Test");
  writeFileSync(join(PROJECT, "content/a.md"), "v1\n");
  writeFileSync(join(OTHER, "index.md"), "v1\n");
  git(REPO, "add", ".");
  git(REPO, "commit", "-qm", "initial");
});

afterAll(() => {
  rmSync(BASE, { force: true, recursive: true });
});

describe("git routes on a project nested in its repository", () => {
  test("status lists the project's changes, project-relative", async () => {
    writeFileSync(join(PROJECT, "content/a.md"), "v2\n");
    writeFileSync(join(PROJECT, "new.md"), "new\n");
    writeFileSync(join(OTHER, "index.md"), "v2\n");
    expect(await statusFiles()).toEqual([
      { path: "content/a.md", staged: false, status: "M" },
      { path: "new.md", staged: false, status: "U" },
    ]);
  });

  test("every listed path stages, which is what include all sends", async () => {
    writeFileSync(join(PROJECT, "content/a.md"), "v2\n");
    writeFileSync(join(PROJECT, "new.md"), "new\n");
    const listed = await statusFiles();
    const res = await route("stage", { files: listed.map((file) => file.path) });
    expect(res.status).toBe(200);
    const staged = await statusFiles();
    expect(staged.every((file) => file.staged)).toBe(true);
  });

  test("a listed path reads back through show and diff", async () => {
    writeFileSync(join(PROJECT, "content/a.md"), "v2\n");
    const [change] = await statusFiles();
    const path = encodeURIComponent(change!.path);
    const show = await route("show", undefined, `&path=${path}`);
    const shown = await show.json();
    expect(shown.content).toBe("v1\n");
    const diff = await route("diff", undefined, `&path=${path}`);
    const compared = await diff.json();
    expect(compared.diff).toContain("+v2");
  });

  test("commit leaves another project's staged change out of it, and staged", async () => {
    writeFileSync(join(PROJECT, "content/a.md"), "v2\n");
    writeFileSync(join(OTHER, "index.md"), "v2\n");
    git(OTHER, "add", "index.md");
    await route("stage", { files: ["content/a.md"] });
    const res = await route("commit", { message: "publish" });
    expect(res.status).toBe(200);
    expect(committedPaths()).toEqual([`${SITE_FOLDER}/content/a.md`]);
    expect(git(REPO, "diff", "--cached", "--name-only").trim()).toBe("Sites/other/index.md");
  });

  test("commit with nothing staged takes the project's changes, not the repository's", async () => {
    writeFileSync(join(PROJECT, "content/a.md"), "v2\n");
    writeFileSync(join(OTHER, "index.md"), "v2\n");
    const res = await route("commit", { message: "publish" });
    expect(res.status).toBe(200);
    expect(committedPaths()).toEqual([`${SITE_FOLDER}/content/a.md`]);
    expect(readFileSync(join(OTHER, "index.md"), "utf8")).toBe("v2\n");
  });

  test("a pull conflict names the project's file project-relative", async () => {
    const remote = join(BASE, "remote.git");
    rmSync(remote, { force: true, recursive: true });
    git(BASE, "clone", "-q", "--bare", REPO, remote);
    git(REPO, "remote", "add", "origin", remote);
    git(REPO, "fetch", "-q", "origin");
    git(REPO, "branch", "-q", "--set-upstream-to=origin/main", "main");
    git(REPO, "config", "pull.rebase", "false");
    const clone = join(BASE, "clone");
    rmSync(clone, { force: true, recursive: true });
    git(BASE, "clone", "-q", remote, clone);
    git(clone, "config", "user.email", "test@test.com");
    git(clone, "config", "user.name", "Test");
    writeFileSync(join(clone, SITE_FOLDER, "content/a.md"), "remote\n");
    git(clone, "commit", "-qam", "remote");
    git(clone, "push", "-q", "origin", "main");
    writeFileSync(join(PROJECT, "content/a.md"), "local\n");
    git(REPO, "commit", "-qam", "local");
    const res = await route("pull", {});
    expect(res.status).toBe(409);
    const refusal = await res.json();
    expect(refusal.conflicts).toEqual(["content/a.md"]);
  });
});
