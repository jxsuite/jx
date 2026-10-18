import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { handleStudioApi, parseGitStatus, projectHasRepository } from "../src/studio-api";
import { join, resolve } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import type { GitStatusResult } from "@jxsuite/protocol";
import type { JsonObject } from "@jxsuite/schema/types";

// ── parseGitStatus unit tests ───────────────────────────────────────────────

describe("parseGitStatus", () => {
  test("parses branch name", () => {
    const out = "# branch.head main\n# branch.oid abc123\n";
    const result = parseGitStatus(out);
    expect(result.branch).toBe("main");
    expect(result.files).toEqual([]);
  });

  test("parses ahead/behind counts", () => {
    const out = ["# branch.oid abc123", "# branch.head feature", "# branch.ab +3 -1"].join("\n");
    const result = parseGitStatus(out);
    expect(result.branch).toBe("feature");
    expect(result.ahead).toBe(3);
    expect(result.behind).toBe(1);
  });

  test("defaults ahead/behind to 0", () => {
    const out = "# branch.head main\n";
    const result = parseGitStatus(out);
    expect(result.ahead).toBe(0);
    expect(result.behind).toBe(0);
  });

  test("parses staged modified file (type 1)", () => {
    const out = "1 M. N... 100644 100644 100644 abc123 def456 src/app.js\n";
    const result = parseGitStatus(out);
    expect(result.files).toEqual([{ path: "src/app.js", staged: true, status: "M" }]);
  });

  test("parses unstaged modified file (type 1)", () => {
    const out = "1 .M N... 100644 100644 100644 abc123 def456 src/app.js\n";
    const result = parseGitStatus(out);
    expect(result.files).toEqual([{ path: "src/app.js", staged: false, status: "M" }]);
  });

  test("parses file modified in both index and worktree", () => {
    const out = "1 MM N... 100644 100644 100644 abc123 def456 src/app.js\n";
    const result = parseGitStatus(out);
    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toEqual({
      path: "src/app.js",
      staged: true,
      status: "M",
    });
    expect(result.files[1]).toEqual({
      path: "src/app.js",
      staged: false,
      status: "M",
    });
  });

  test("parses staged added file", () => {
    const out = "1 A. N... 000000 100644 100644 0000000 abc123 newfile.js\n";
    const result = parseGitStatus(out);
    expect(result.files).toEqual([{ path: "newfile.js", staged: true, status: "A" }]);
  });

  test("parses staged deleted file", () => {
    const out = "1 D. N... 100644 000000 000000 abc123 0000000 old.js\n";
    const result = parseGitStatus(out);
    expect(result.files).toEqual([{ path: "old.js", staged: true, status: "D" }]);
  });

  test("parses untracked file", () => {
    const out = "? todo.txt\n";
    const result = parseGitStatus(out);
    expect(result.files).toEqual([{ path: "todo.txt", staged: false, status: "U" }]);
  });

  test("parses rename entry (type 2)", () => {
    const out = "2 R. N... 100644 100644 100644 abc123 def456 R100\told.js\tnew.js\n";
    const result = parseGitStatus(out);
    expect(result.files).toEqual([{ path: "new.js", staged: true, status: "R" }]);
  });

  test("reads NUL-terminated records: verbatim non-ASCII paths, rename origin skipped", () => {
    const out = [
      "# branch.head main",
      "1 .M N... 100644 100644 100644 abc123 def456 content/products/72” Grapple.md",
      "2 R. N... 100644 100644 100644 abc123 def456 R100 pages/new name.md",
      "pages/old.md",
      "? content/products/Extra Augers 12”,16”.md",
      "",
    ].join("\0");
    const result = parseGitStatus(out);
    expect(result.branch).toBe("main");
    expect(result.files).toEqual([
      { path: "content/products/72” Grapple.md", staged: false, status: "M" },
      { path: "pages/new name.md", staged: true, status: "R" },
      { path: "content/products/Extra Augers 12”,16”.md", staged: false, status: "U" },
    ]);
  });

  test("parses file paths with spaces", () => {
    const out = "1 M. N... 100644 100644 100644 abc123 def456 path with spaces/file name.js\n";
    const result = parseGitStatus(out);
    expect(result.files[0]!.path).toBe("path with spaces/file name.js");
  });

  test("handles empty output", () => {
    const result = parseGitStatus("");
    expect(result).toEqual({ ahead: 0, behind: 0, branch: "", files: [] });
  });

  test("parses full realistic output", () => {
    const out = [
      "# branch.oid 38d753e",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -0",
      "1 M. N... 100644 100644 100644 abc123 def456 src/index.js",
      "1 .M N... 100644 100644 100644 abc123 def456 src/utils.js",
      "1 A. N... 000000 100644 100644 0000000 abc123 src/new.js",
      "? untracked.txt",
      "",
    ].join("\n");
    const result = parseGitStatus(out);
    expect(result.branch).toBe("main");
    expect(result.ahead).toBe(2);
    expect(result.behind).toBe(0);
    expect(result.files).toHaveLength(4);
    expect(result.files[0]).toEqual({
      path: "src/index.js",
      staged: true,
      status: "M",
    });
    expect(result.files[1]).toEqual({
      path: "src/utils.js",
      staged: false,
      status: "M",
    });
    expect(result.files[2]).toEqual({
      path: "src/new.js",
      staged: true,
      status: "A",
    });
    expect(result.files[3]).toEqual({
      path: "untracked.txt",
      staged: false,
      status: "U",
    });
  });
});

// ── Git endpoint integration tests ──────────────────────────────────────────

/**
 * @param {string} path
 * @param {string} [method]
 * @param {JsonObject} [body]
 * @returns {Promise<Response>}
 */
async function studioGitReq(path: string, method = "GET", body?: JsonObject) {
  const urlStr = `http://localhost${path}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await handleStudioApi(new Request(urlStr, init), new URL(urlStr), GIT_FIXTURE);
  if (!res) {
    throw new Error(`No response from handleStudioApi for ${method} ${path}`);
  }
  return res;
}

const GIT_FIXTURE = resolve(import.meta.dir, "_git_fixture");

/**
 * @param {string} cmd
 * @returns {string}
 */
function git(cmd: string) {
  return execSync(`git ${cmd}`, {
    cwd: GIT_FIXTURE,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_AUTHOR_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "Test",
    },
  });
}

describe("git endpoints", () => {
  beforeAll(() => {
    rmSync(GIT_FIXTURE, { force: true, recursive: true });
    mkdirSync(GIT_FIXTURE, { recursive: true });
    git("init -b main");
    git("config user.email test@test.com");
    git("config user.name Test");
    writeFileSync(join(GIT_FIXTURE, "hello.txt"), "hello");
    git("add hello.txt");
    git("commit -m initial");
  });

  afterAll(() => {
    rmSync(GIT_FIXTURE, { force: true, recursive: true });
  });

  test("GET status returns branch and empty files on clean repo", async () => {
    const res = await studioGitReq("/__studio/git/status");
    const data = /** @type {{ branch: string; files: unknown[] }} */ await res.json();
    expect(data.branch).toBeTruthy();
    expect(data.files).toEqual([]);
  });

  test("GET status shows untracked file", async () => {
    writeFileSync(join(GIT_FIXTURE, "new.txt"), "new");
    const res = await studioGitReq("/__studio/git/status");
    const data: GitStatusResult = await res.json();
    const untracked = data.files.find((f) => f.path === "new.txt");
    expect(untracked).toBeTruthy();
    expect(untracked?.status).toBe("U");
    expect(untracked?.staged).toBe(false);
  });

  test("GET status names a non-ASCII path as it is on disk", async () => {
    const name = "72” Grapple.md";
    writeFileSync(join(GIT_FIXTURE, name), "# Grapple");
    const res = await studioGitReq("/__studio/git/status");
    const data: GitStatusResult = await res.json();
    expect(data.files.map((f) => f.path)).toContain(name);
    rmSync(join(GIT_FIXTURE, name));
  });

  test("POST stage adds file to index", async () => {
    const stageRes = await studioGitReq("/__studio/git/stage", "POST", {
      files: ["new.txt"],
    });
    const stageData = /** @type {{ ok: boolean }} */ await stageRes.json();
    expect(stageData.ok).toBe(true);

    const statusRes = await studioGitReq("/__studio/git/status");
    const data: GitStatusResult = await statusRes.json();
    const staged = data.files.find((f) => f.path === "new.txt" && f.staged);
    expect(staged).toBeTruthy();
    expect(staged?.status).toBe("A");
  });

  test("POST unstage removes file from index", async () => {
    await studioGitReq("/__studio/git/unstage", "POST", { files: ["new.txt"] });
    const res = await studioGitReq("/__studio/git/status");
    const data: GitStatusResult = await res.json();
    const file = data.files.find((f) => f.path === "new.txt");
    expect(file?.staged).toBe(false);
  });

  test("POST commit creates a commit", async () => {
    git("add new.txt");
    const res = await studioGitReq("/__studio/git/commit", "POST", {
      message: "add new file",
    });
    const data = /** @type {{ ok: boolean; hash: string }} */ await res.json();
    expect(data.ok).toBe(true);
    expect(data.hash).toBeTruthy();

    const statusRes = await studioGitReq("/__studio/git/status");
    const statusData = /** @type {{ files: unknown[] }} */ await statusRes.json();
    expect(statusData.files).toEqual([]);
  });

  test("POST commit rejects empty message", async () => {
    const res = await studioGitReq("/__studio/git/commit", "POST", {
      message: "",
    });
    expect(res.status).toBe(400);
  });

  test("POST stage rejects path traversal", async () => {
    const res = await studioGitReq("/__studio/git/stage", "POST", {
      files: ["../etc/passwd"],
    });
    expect(res.status).toBe(400);
  });

  test("POST stage rejects empty files", async () => {
    const res = await studioGitReq("/__studio/git/stage", "POST", {
      files: [],
    });
    expect(res.status).toBe(400);
  });

  test("GET branches returns current branch", async () => {
    const res = await studioGitReq("/__studio/git/branches");
    const data = /** @type {{ current: string; branches: string[] }} */ await res.json();
    expect(data.current).toBeTruthy();
    expect(data.branches).toContain(data.current);
  });

  test("POST create-branch creates and switches", async () => {
    const res = await studioGitReq("/__studio/git/create-branch", "POST", {
      name: "test-branch",
    });
    const data = /** @type {{ ok: boolean }} */ await res.json();
    expect(data.ok).toBe(true);

    const branchRes = await studioGitReq("/__studio/git/branches");
    const branchData =
      /** @type {{ current: string; branches: string[] }} */ await branchRes.json();
    expect(branchData.current).toBe("test-branch");
    expect(branchData.branches).toContain("test-branch");
  });

  test("POST checkout switches branch", async () => {
    const res = await studioGitReq("/__studio/git/checkout", "POST", {
      branch: "main",
    });
    const data = /** @type {{ ok: boolean }} */ await res.json();
    expect(data.ok).toBe(true);

    const branchRes = await studioGitReq("/__studio/git/branches");
    const branchData = /** @type {{ current: string }} */ await branchRes.json();
    expect(branchData.current).toBe("main");
  });

  test("GET log returns commit history", async () => {
    const res = await studioGitReq("/__studio/git/log?limit=5");
    const data =
      /** @type {{ hash: string; message: string; author: string; date: string }[]} */ await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
    expect(data[0].hash).toBeTruthy();
    expect(data[0].message).toBeTruthy();
    expect(data[0].author).toBe("Test");
  });

  test("GET diff returns diff for modified file", async () => {
    writeFileSync(join(GIT_FIXTURE, "hello.txt"), "hello world");
    const res = await studioGitReq("/__studio/git/diff?path=hello.txt");
    const data = /** @type {{ diff: string }} */ await res.json();
    expect(data.diff).toContain("hello world");
  });

  test("POST discard restores file", async () => {
    await studioGitReq("/__studio/git/discard", "POST", {
      files: ["hello.txt"],
    });
    const res = await studioGitReq("/__studio/git/status");
    const data: GitStatusResult = await res.json();
    const modified = data.files.find((f) => f.path === "hello.txt");
    expect(modified).toBeUndefined();
  });

  test("POST push fails without remote (500)", async () => {
    const res = await studioGitReq("/__studio/git/push", "POST");
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });

  test("POST pull fails without remote (500)", async () => {
    const res = await studioGitReq("/__studio/git/pull", "POST");
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });

  test("POST fetch succeeds with no remotes (no-op)", async () => {
    // Git fetch exits 0 when there are no remotes configured — it is a silent no-op
    const res = await studioGitReq("/__studio/git/fetch", "POST");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("GET show returns file content at HEAD", async () => {
    const res = await studioGitReq("/__studio/git/show?path=hello.txt&ref=HEAD");
    expect(res.status).toBe(200);
    const data = /** @type {{ content: string }} */ await res.json();
    expect(data.content).toBe("hello");
  });

  test("GET show returns content for .json files", async () => {
    writeFileSync(join(GIT_FIXTURE, "doc.json"), '{"tagName":"div"}');
    git("add doc.json");
    git('commit -m "add json"');
    const res = await studioGitReq("/__studio/git/show?path=doc.json&ref=HEAD");
    expect(res.status).toBe(200);
    const data = /** @type {{ content: string }} */ await res.json();
    expect(data.content).toBe('{"tagName":"div"}');
  });

  test("GET show returns content for .md files", async () => {
    writeFileSync(join(GIT_FIXTURE, "page.md"), "# Hello");
    git("add page.md");
    git('commit -m "add md"');
    const res = await studioGitReq("/__studio/git/show?path=page.md&ref=HEAD");
    expect(res.status).toBe(200);
    const data = /** @type {{ content: string }} */ await res.json();
    expect(data.content).toBe("# Hello");
  });

  test("GET show rejects missing path parameter", async () => {
    const res = await studioGitReq("/__studio/git/show?ref=HEAD");
    expect(res.status).toBe(400);
  });

  test("GET show rejects path traversal", async () => {
    const res = await studioGitReq("/__studio/git/show?path=../etc/passwd&ref=HEAD");
    expect(res.status).toBe(400);
  });

  test("GET show fails for non-existent file", async () => {
    const res = await studioGitReq("/__studio/git/show?path=no-such-file.txt&ref=HEAD");
    expect(res.status).toBe(500);
  });

  test("GET show defaults ref to HEAD when omitted", async () => {
    const res = await studioGitReq("/__studio/git/show?path=hello.txt");
    expect(res.status).toBe(200);
    const data = /** @type {{ content: string }} */ await res.json();
    expect(data.content).toBe("hello");
  });
});

// ── A project inside a folder another repository ignores ────────────────────

describe("a project inside a folder another repository ignores", () => {
  const OUTER = resolve(import.meta.dir, "_git_outer_fixture");
  const NESTED = join(OUTER, "scratch", "site");

  /** One request against the nested project, as the server sees it when that project is open. */
  async function nestedReq(path: string, method = "GET") {
    const urlStr = `http://localhost${path}`;
    const res = await handleStudioApi(new Request(urlStr, { method }), new URL(urlStr), NESTED);
    if (!res) {
      throw new Error(`No response from handleStudioApi for ${method} ${path}`);
    }
    return res;
  }

  beforeAll(() => {
    rmSync(OUTER, { force: true, recursive: true });
    mkdirSync(NESTED, { recursive: true });
    execSync("git init -q -b main", { cwd: OUTER });
    writeFileSync(join(OUTER, ".gitignore"), "scratch/\n");
    writeFileSync(join(NESTED, "project.json"), "{}");
  });

  afterAll(() => {
    rmSync(OUTER, { force: true, recursive: true });
  });

  test("projectHasRepository tells an ignored folder from a tracked subfolder", async () => {
    expect(await projectHasRepository(NESTED)).toBe(false);
    mkdirSync(join(OUTER, "tracked"), { recursive: true });
    expect(await projectHasRepository(join(OUTER, "tracked"))).toBe(true);
  });

  test("status says it is not a repository, rather than describing the enclosing one", async () => {
    const res = await nestedReq("/__studio/git/status");
    const data: GitStatusResult = await res.json();
    expect(data.isRepo).toBe(false);
    expect(data.branch).toBe("");
  });

  test("every other command is refused instead of reaching the enclosing repository", async () => {
    for (const [path, method] of [
      ["/__studio/git/branches", "GET"],
      ["/__studio/git/fetch", "POST"],
      ["/__studio/git/pull", "POST"],
    ] as const) {
      const res = await nestedReq(path, method);
      expect(res.status).toBe(409);
      expect(await res.text()).toContain("not a git repository of its own");
    }
  });

  test("init gives the project a repository of its own", async () => {
    const init = await nestedReq("/__studio/git/init", "POST");
    expect(init.status).toBe(200);
    const res = await nestedReq("/__studio/git/status");
    const data: GitStatusResult = await res.json();
    expect(data.isRepo).toBe(true);
    expect(data.files.map((file) => file.path)).toContain("project.json");
  });
});
