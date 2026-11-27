// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGitOps, isHttpsRemote } from "../src/backend/git";

let root = "";

function run(...args: string[]): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd: root, stderr: "pipe", stdout: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "jx-git-sandbox-"));
  mkdirSync(root, { recursive: true });
  run("init");
  run("config", "user.email", "t@t.com");
  run("config", "user.name", "T");
  run("commit", "--allow-empty", "-m", "initial");
});

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

const session = () => ({ projectRoot: root });

describe("isHttpsRemote", () => {
  test("accepts https URLs only", () => {
    expect(isHttpsRemote("https://example.com/a.git")).toBe(true);
    expect(isHttpsRemote(" HTTPS://example.com/a.git")).toBe(true);
    expect(isHttpsRemote("git@github.com:a/b.git")).toBe(false);
    expect(isHttpsRemote("ssh://git@github.com/a/b.git")).toBe(false);
    expect(isHttpsRemote("http://example.com/a.git")).toBe(false);
    expect(isHttpsRemote("/tmp/repo")).toBe(false);
  });
});

describe("git in the sandboxed build keeps HTTPS remotes only", () => {
  test("adding an SSH remote is refused, naming the URL", async () => {
    const ops = createGitOps(session(), { httpsOnly: true });
    await expect(ops.gitAddRemote({ name: "ssh", url: "git@github.com:a/b.git" })).rejects.toThrow(
      /HTTPS only.*git@github\.com:a\/b\.git/,
    );
  });

  test("adding an HTTPS remote works", async () => {
    const ops = createGitOps(session(), { httpsOnly: true });
    await ops.gitAddRemote({ name: "web", url: "https://example.invalid/a.git" });
    const status = await ops.gitStatus();
    expect(status.remotes).toContain("web");
  });

  test("push, pull and fetch refuse a branch whose remote is SSH", async () => {
    run("remote", "add", "origin", "git@github.com:a/b.git");
    const ops = createGitOps(session(), { httpsOnly: true });
    await expect(ops.gitPush()).rejects.toThrow(/HTTPS only/);
    await expect(ops.gitPush({ setUpstream: true })).rejects.toThrow(/HTTPS only/);
    await expect(ops.gitPull()).rejects.toThrow(/HTTPS only/);
    await expect(ops.gitFetch()).rejects.toThrow(/HTTPS only/);
  });

  test("the branch's configured remote decides, not origin", async () => {
    const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: root })
      .stdout.toString()
      .trim();
    run("config", `branch.${branch}.remote`, "web");
    const ops = createGitOps(session(), { httpsOnly: true });
    // The HTTPS remote passes the guard, so git itself answers (the host does not exist).
    await expect(ops.gitFetch()).rejects.not.toThrow(/HTTPS only/);
  });

  test("a branch whose remote does not exist is left for git to answer", async () => {
    const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: root })
      .stdout.toString()
      .trim();
    run("config", `branch.${branch}.remote`, "missing");
    const ops = createGitOps(session(), { httpsOnly: true });
    await expect(ops.gitFetch()).rejects.not.toThrow(/HTTPS only/);
    run("config", `branch.${branch}.remote`, "web");
  });

  test("the ordinary build adds an SSH remote", async () => {
    const ops = createGitOps(session(), { httpsOnly: false });
    await ops.gitAddRemote({ name: "ssh2", url: "git@github.com:a/c.git" });
    const status = await ops.gitStatus();
    expect(status.remotes).toContain("ssh2");
  });

  test("the flag defaults from the environment the shell sets", async () => {
    process.env.JX_STUDIO_SANDBOX = "1";
    try {
      const ops = createGitOps(session());
      const refused = ops.gitAddRemote({ name: "x", url: "git@h:a/b.git" });
      await expect(refused).rejects.toThrow(/HTTPS only/);
    } finally {
      delete process.env.JX_STUDIO_SANDBOX;
    }
  });
});
