/**
 * The project state host's git monitor (`specs/project-state.md` §4.5): a watch on the repository's
 * `HEAD`, `index` and `refs`, a debounce, then one `git status --porcelain=v2 -z`, reported only
 * when the summary differs from the last one reported. A commit, checkout, stage or pull is
 * observed this way whoever ran it; the host also asks for a run after each file event, because an
 * edit to the working tree moves the summary without touching the repository's own files.
 *
 * Paths are project-relative through `git-scope.ts`, the rules both backends already share, so a
 * project nested inside a larger repository sees only its own changes.
 *
 * Runs on Node (the desktop backend's utility process) and on Bun: it spawns git through
 * `node:child_process` and watches through chokidar.
 *
 * @module
 */

import { spawn } from "node:child_process";
import { watch } from "chokidar";
import { projectRelativePath } from "@jxsuite/protocol/git-scope";
import { toError } from "@jxsuite/schema/parse";
import type { GitRunner } from "@jxsuite/protocol/git-scope";
import type { GitSummary, WorkingState } from "@jxsuite/protocol/project-state";

/** The quiet period between the last repository change and the status run (§4.5). */
export const GIT_DEBOUNCE_MS = 150;

/** Run git in `cwd` through `node:child_process`, resolving stdout and rejecting on failure. */
export function nodeGitRunner(cwd: string): GitRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      proc.stdout.on("data", (chunk: Buffer) => out.push(chunk));
      proc.stderr.on("data", (chunk: Buffer) => err.push(chunk));
      proc.once("error", reject);
      proc.once("close", (code) => {
        if (code === 0) {
          resolve(Buffer.concat(out).toString("utf8"));
        } else {
          const message = Buffer.concat(err).toString("utf8").trim();
          reject(new Error(`git ${args[0] ?? ""} failed: ${message || `exit ${code}`}`));
        }
      });
    });
}

/** The working state an entry's two status letters (index, worktree) give it (§6.2). */
function stateOf(xy: string): WorkingState {
  if (xy.includes("D")) {
    return "deleted";
  }
  return xy.startsWith("A") ? "added" : "modified";
}

/** The rest of a record after `count` space-separated fields: a path, which may hold spaces. */
function afterFields(record: string, count: number): string {
  let at = 0;
  for (let field = 0; field < count; field += 1) {
    at = record.indexOf(" ", at) + 1;
  }
  return record.slice(at);
}

/**
 * Read `git status --porcelain=v2 -z --branch` output as a {@link GitSummary}, with every path made
 * project-relative against `prefix` (`git rev-parse --show-prefix`). A path outside the project is
 * left out: its working state belongs to another project in the same repository.
 */
export function parseStatus(out: string, prefix: string): GitSummary {
  const summary: GitSummary = { branch: null, changed: {}, head: null };
  const records = out.split("\0");
  const put = (path: string, state: WorkingState): void => {
    if (path.startsWith(prefix)) {
      summary.changed[projectRelativePath(prefix, path)] = state;
    }
  };
  for (let at = 0; at < records.length; at += 1) {
    const record = records[at]!;
    if (record.startsWith("# branch.oid ")) {
      const oid = record.slice("# branch.oid ".length);
      summary.head = oid === "(initial)" ? null : oid;
    } else if (record.startsWith("# branch.head ")) {
      const head = record.slice("# branch.head ".length);
      summary.branch = head === "(detached)" ? null : head;
    } else if (record.startsWith("1 ")) {
      put(afterFields(record, 8), stateOf(record.slice(2, 4)));
    } else if (record.startsWith("2 ")) {
      put(afterFields(record, 9), "renamed");
      // A rename's original path is the next record.
      at += 1;
    } else if (record.startsWith("u ")) {
      put(afterFields(record, 10), "modified");
    } else if (record.startsWith("? ")) {
      put(record.slice(2), "untracked");
    }
  }
  const sorted: Record<string, WorkingState> = {};
  for (const path of Object.keys(summary.changed).toSorted()) {
    sorted[path] = summary.changed[path]!;
  }
  summary.changed = sorted;
  return summary;
}

/** A watch over the repository's own files; told of every change, whatever it was. */
export interface GitWatchHandle {
  ready: Promise<void>;
  close: () => Promise<void>;
}

/** Watch `paths` (absolute), calling `onChange` for every change and `onError` for a failure. */
export type GitWatchFactory = (
  paths: readonly string[],
  onChange: () => void,
  onError: (error: Error) => void,
) => GitWatchHandle;

/** The default {@link GitWatchFactory}: chokidar, with no write-finish wait (git writes by rename). */
export const chokidarGitWatch: GitWatchFactory = (paths, onChange, onError) => {
  const watcher = watch([...paths], { ignoreInitial: true, ignorePermissionErrors: true });
  watcher.on("all", () => onChange());
  watcher.on("error", (cause) =>
    onError(cause instanceof Error ? cause : new Error(String(cause))),
  );
  const ready = new Promise<void>((resolve) => {
    watcher.once("ready", () => resolve());
  });
  return { close: () => watcher.close(), ready };
};

export interface GitMonitorOptions {
  /** The absolute project root, git's working directory. */
  root: string;
  /** Runs git in the root; defaults to {@link nodeGitRunner}. */
  run?: GitRunner;
  /** Watches the repository's files; defaults to {@link chokidarGitWatch}. */
  watch?: GitWatchFactory;
  /** Defaults to {@link GIT_DEBOUNCE_MS}. */
  debounceMs?: number;
  /** Told each summary that differs from the last one reported. */
  onChange: (summary: GitSummary) => void;
  /** Told of a failed status run or watch error; never fatal. */
  onError?: (error: Error) => void;
  /** Told whenever the repository's files move, before the debounce. */
  onActivity?: () => void;
}

export interface GitMonitor {
  /** The last summary reported, or read at start; `undefined` outside a repository. */
  readonly summary: GitSummary | undefined;
  /** Ask for a status run after the debounce (a working-tree change). */
  schedule: () => void;
  /** Whether no run is waiting, running or owed. */
  idle: () => boolean;
  close: () => Promise<void>;
}

/** The repository's own directories, read once at start. */
interface RepositoryDirs {
  gitDir: string;
  commonDir: string;
  prefix: string;
}

/** Git's own answer for a directory outside every repository, which is no failure. */
const NOT_A_REPOSITORY = /not a git repository/i;

/**
 * The repository's directories, or `null` outside one. Any other failure (no git on the `PATH`, a
 * git too old for `--path-format`) is reported too, so a missing summary always has a reason.
 */
async function repositoryDirs(
  run: GitRunner,
  report: (error: Error) => void,
): Promise<RepositoryDirs | null> {
  try {
    const out = await run([
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
      "--git-common-dir",
      "--show-prefix",
    ]);
    const [gitDir = "", commonDir = "", prefix = ""] = out.split("\n");
    return { commonDir, gitDir, prefix };
  } catch (error) {
    const failure = toError(error);
    if (!NOT_A_REPOSITORY.test(failure.message)) {
      report(failure);
    }
    return null;
  }
}

/**
 * Start a git monitor over `root`. Resolves once the first summary is read (or the root is found to
 * be outside any repository) and the watch is armed; that first summary is not reported.
 */
export async function createGitMonitor(options: GitMonitorOptions): Promise<GitMonitor> {
  const run = options.run ?? nodeGitRunner(options.root);
  const debounceMs = options.debounceMs ?? GIT_DEBOUNCE_MS;
  const report = (error: Error): void => {
    options.onError?.(error);
  };
  const dirs = await repositoryDirs(run, report);
  let summary: GitSummary | undefined;
  let last = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let owed = false;
  let closed = false;

  const read = async (prefix: string): Promise<GitSummary> =>
    parseStatus(
      await run([
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "-z",
        "--branch",
        "--untracked-files=all",
        "--",
        ".",
      ]),
      prefix,
    );

  const runStatus = async (prefix: string): Promise<void> => {
    running = true;
    try {
      const next = await read(prefix);
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        summary = next;
        options.onChange(next);
      }
    } catch (error) {
      report(toError(error));
    } finally {
      running = false;
    }
    if (owed) {
      owed = false;
      schedule();
    }
  };

  const schedule = (): void => {
    if (dirs === null || closed) {
      return;
    }
    if (running) {
      owed = true;
      return;
    }
    if (timer !== null) {
      clearTimeout(timer);
    }
    const { prefix } = dirs;
    timer = setTimeout(() => {
      timer = null;
      void runStatus(prefix);
    }, debounceMs);
  };

  let handle: GitWatchHandle | null = null;
  if (dirs !== null) {
    try {
      summary = await read(dirs.prefix);
      last = JSON.stringify(summary);
    } catch (error) {
      report(toError(error));
    }
    handle = (options.watch ?? chokidarGitWatch)(
      [`${dirs.gitDir}/HEAD`, `${dirs.gitDir}/index`, `${dirs.commonDir}/refs`],
      () => {
        options.onActivity?.();
        schedule();
      },
      report,
    );
    await handle.ready;
  }

  return {
    close: async () => {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await handle?.close();
    },
    idle: () => timer === null && !running && !owed,
    schedule,
    get summary() {
      return summary === undefined ? undefined : structuredClone(summary);
    },
  };
}
