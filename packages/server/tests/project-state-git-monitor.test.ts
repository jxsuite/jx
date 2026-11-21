/**
 * The project state host's git monitor (`specs/project-state.md` §4.5): the status parser over
 * every record kind porcelain v2 prints, a real repository watched through `.git/HEAD`, `index` and
 * `refs`, and the debounce's coalescing and failures through a fake runner.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitSummary } from "@jxsuite/protocol/project-state";
import { toError } from "@jxsuite/schema/parse";
import { createGitMonitor, nodeGitRunner, parseStatus } from "../src/project-state/git-monitor.ts";
import type { GitMonitor, GitWatchFactory } from "../src/project-state/git-monitor.ts";

const IDENTITY = [
  "-c",
  "user.name=Monitor",
  "-c",
  "user.email=monitor@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

/** What `promise` rejected with; fails the test when it resolves. */
async function rejection<T>(promise: Promise<T>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return toError(error);
  }
  throw new Error("expected a rejection");
}

const dirs: string[] = [];
const monitors: GitMonitor[] = [];

afterEach(async () => {
  for (const monitor of monitors.splice(0)) {
    await monitor.close();
  }
  for (const dir of dirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

const until = async (check: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) {
      throw new Error("timed out");
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
};

describe("parseStatus", () => {
  test("reads every record kind, project-relative, sorted", () => {
    const out = [
      "# branch.oid 0123abcd",
      "# branch.head main",
      "# branch.upstream origin/main",
      "1 .M N... 100644 100644 100644 aaa aaa site/pages/a b.json",
      "1 A. N... 000000 100644 100644 000 bbb site/pages/new.json",
      "1 .D N... 100644 100644 000000 ccc ccc site/pages/gone.json",
      "2 R. N... 100644 100644 100644 ddd ddd R100 site/pages/to.json",
      "site/pages/from.json",
      "u UU N... 100644 100644 100644 100644 eee fff ggg site/pages/both.json",
      "? site/pages/untracked.json",
      "? other/elsewhere.json",
      "! site/ignored.log",
      "",
    ].join("\0");
    expect(parseStatus(out, "site/")).toEqual({
      branch: "main",
      changed: {
        "pages/a b.json": "modified",
        "pages/both.json": "modified",
        "pages/gone.json": "deleted",
        "pages/new.json": "added",
        "pages/to.json": "renamed",
        "pages/untracked.json": "untracked",
      },
      head: "0123abcd",
    });
  });

  test("a repository before its first commit, and a detached head", () => {
    expect(parseStatus("# branch.oid (initial)\0# branch.head (detached)\0", "")).toEqual({
      branch: null,
      changed: {},
      head: null,
    });
  });
});

describe("nodeGitRunner", () => {
  test("rejects with git's message on failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jx-git-runner-"));
    dirs.push(dir);
    const refused = await rejection(nodeGitRunner(dir)(["no-such-command"]));
    expect(refused.message).toContain("git no-such-command");
  });

  test("rejects when git cannot be spawned in the directory", async () => {
    const refused = await rejection(nodeGitRunner("/no/such/dir")(["status"]));
    expect(refused.message.length > 0).toBe(true);
  });
});

describe("createGitMonitor", () => {
  test("reports a commit and a working-tree change in a real repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "jx-git-monitor-"));
    dirs.push(root);
    const git = nodeGitRunner(root);
    await git(["init", "-q", "-b", "main"]);
    await writeFile(join(root, "a.json"), "{}\n");
    await git(["add", "-A"]);
    await git([...IDENTITY, "commit", "-q", "-m", "one"]);
    const reports: GitSummary[] = [];
    let moved = 0;
    const monitor = await createGitMonitor({
      onActivity: () => {
        moved += 1;
      },
      onChange: (summary) => reports.push(summary),
      root,
    });
    monitors.push(monitor);
    expect(monitor.summary).toEqual({ branch: "main", changed: {}, head: monitor.summary!.head });
    await writeFile(join(root, "a.json"), "[]\n");
    monitor.schedule();
    await until(() => reports.length === 1);
    expect(reports[0]!.changed).toEqual({ "a.json": "modified" });
    await git(["add", "-A"]);
    await git([...IDENTITY, "commit", "-q", "-m", "two"]);
    await until(() => reports.length === 2 && monitor.idle());
    expect(moved > 0).toBe(true);
    expect(reports[1]!.changed).toEqual({});
    expect(reports[1]!.head === reports[0]!.head).toBe(false);
  });

  test("a nested project sees only its own paths", async () => {
    const repo = await mkdtemp(join(tmpdir(), "jx-git-nested-"));
    dirs.push(repo);
    await nodeGitRunner(repo)(["init", "-q", "-b", "main"]);
    const root = join(repo, "site");
    await mkdir(root);
    await writeFile(join(root, "page.json"), "{}\n");
    await writeFile(join(repo, "outside.json"), "{}\n");
    const monitor = await createGitMonitor({ onChange: () => {}, root });
    monitors.push(monitor);
    expect(monitor.summary).toEqual({
      branch: "main",
      changed: { "page.json": "untracked" },
      head: null,
    });
  });

  test("outside a repository there is no summary and nothing to schedule", async () => {
    const root = await mkdtemp(join(tmpdir(), "jx-git-none-"));
    dirs.push(root);
    const monitor = await createGitMonitor({
      onChange: () => {},
      run: () => Promise.reject(new Error("not a git repository")),
      root,
    });
    monitors.push(monitor);
    monitor.schedule();
    expect(monitor.summary).toBeUndefined();
    expect(monitor.idle()).toBe(true);
  });

  test("a git that cannot run is reported, and a directory outside a repository is not", async () => {
    const root = await mkdtemp(join(tmpdir(), "jx-git-missing-"));
    dirs.push(root);
    const errors: string[] = [];
    for (const message of [
      "spawn git ENOENT",
      "git rev-parse failed: fatal: not a git repository (or any of the parent directories): .git",
    ]) {
      const monitor = await createGitMonitor({
        onChange: () => {},
        onError: (error) => errors.push(error.message),
        run: () => Promise.reject(new Error(message)),
        root,
      });
      monitors.push(monitor);
      expect(monitor.summary).toBeUndefined();
    }
    expect(errors).toEqual(["spawn git ENOENT"]);
  });

  test("coalesces a burst, owes a run asked for while one runs, and survives failures", async () => {
    let statusRuns = 0;
    let fail = true;
    let release: (() => void) | null = null;
    let notify: (() => void) | null = null;
    let reportWatchError: ((error: Error) => void) | null = null;
    const errors: string[] = [];
    const reports: GitSummary[] = [];
    const watch: GitWatchFactory = (paths, onChange, onError) => {
      expect(paths.map((path) => path.split("/").at(-1))).toEqual(["HEAD", "index", "refs"]);
      notify = onChange;
      reportWatchError = onError;
      return { close: () => Promise.resolve(), ready: Promise.resolve() };
    };
    const monitor = await createGitMonitor({
      debounceMs: 5,
      onChange: (summary) => reports.push(summary),
      onError: (error) => errors.push(error.message),
      root: "/repo",
      run: async (args) => {
        if (args[0] === "rev-parse") {
          return "/repo/.git\n/repo/.git\n\n";
        }
        statusRuns += 1;
        if (fail) {
          throw new Error(`status failed ${statusRuns}`);
        }
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return `# branch.oid c${statusRuns}\0# branch.head main\0`;
      },
      watch,
    });
    monitors.push(monitor);
    // The first read failed, so there is no summary yet.
    expect(monitor.summary).toBeUndefined();
    expect(errors).toEqual(["status failed 1"]);
    fail = false;
    notify!();
    notify!();
    await until(() => release !== null);
    expect(monitor.idle()).toBe(false);
    // Asked again while running: one more run is owed.
    monitor.schedule();
    const first = release!;
    release = null;
    first();
    await until(() => release !== null);
    release!();
    await until(() => monitor.idle());
    expect(reports.map((report) => report.head)).toEqual(["c2", "c3"]);
    fail = true;
    notify!();
    await until(() => errors.length === 2 && monitor.idle());
    expect(errors.at(-1)).toBe("status failed 4");
    reportWatchError!(new Error("watch broke"));
    expect(errors.at(-1)).toBe("watch broke");
    monitor.schedule();
    await monitor.close();
    expect(monitor.idle()).toBe(true);
  });
});
