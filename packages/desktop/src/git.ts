import { getProjectRoot } from "./handlers";
import type { GitBranchesResult, GitFileStatus, GitLogEntry, GitStatusResult } from "./rpc-schema";

/**
 * The porcelain code → the one letter Studio's git panel understands. Copied from the dev server's
 * `parseGitStatus` so the two backends say the same thing about the same change; anything not here
 * passes through as itself.
 */
const STATUS_LETTERS = new Map<string, string>([
  ["A", "A"],
  ["C", "C"],
  ["D", "D"],
  ["M", "M"],
  ["R", "R"],
  ["T", "T"],
  ["U", "U"],
]);

/**
 * `git status --porcelain=v1` → the panel's rows.
 *
 * A v1 line is `XY<space>path`: column X is the index, column Y the working tree, and either may be
 * a SPACE. That is the bug this function replaces. The old code trimmed the whole output before
 * splitting it into lines, which ate the leading space of the FIRST line only — ` M pages/index.md`
 * became `M pages/index.md`, `slice(3)` then landed one character late, and the panel showed
 * `index.md` under a folder called `ages` and asked git for a file that did not exist. The second
 * changed file in a list was fine; the first was always wrong when its change was unstaged.
 *
 * Lines are split first and never trimmed. Then, as the dev server does with v2: one row per
 * non-space column, so a file both staged and modified again is two rows, `staged` says which. `??`
 * is one untracked row, `!!` is nothing, and a rename's path is the NEW name — the one the working
 * tree has, and the one a click will read.
 *
 * @param {string} out - Raw stdout of `git status --porcelain=v1`
 * @returns {GitFileStatus[]}
 */
export function parsePorcelainV1(out: string): GitFileStatus[] {
  const files: GitFileStatus[] = [];
  /*
   * `gitStatus` asks for `-z`: without it git C-quotes any path holding a byte outside printable
   * ASCII (`"72\342\200\235 Grapple.md"`), which no file on disk is called. With `-z` records end
   * in NUL, paths are verbatim, and a rename is `XY new` followed by the original path as its own
   * record. Newline output is still read, for callers and tests that hand it plain text.
   */
  const nulTerminated = out.includes("\0");
  const records = out.split(nulTerminated ? "\0" : "\n");
  for (let index = 0; index < records.length; index += 1) {
    const line = records[index]!;
    if (line.length < 4) {
      continue;
    }
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    if (xy === "!!") {
      continue;
    }
    if (xy === "??") {
      files.push({ path: rest, staged: false, status: "U" });
      continue;
    }
    let path = rest;
    if (nulTerminated) {
      if (xy.includes("R") || xy.includes("C")) {
        index += 1;
      }
    } else {
      const arrow = rest.indexOf(" -> ");
      path = arrow === -1 ? rest : rest.slice(arrow + " -> ".length);
    }
    const [x = " ", y = " "] = xy;
    if (x !== " ") {
      files.push({ path, staged: true, status: STATUS_LETTERS.get(x) ?? x });
    }
    if (y !== " ") {
      files.push({ path, staged: false, status: STATUS_LETTERS.get(y) ?? y });
    }
  }
  return files;
}

/** Build git operations bound to one project session (its projectRoot is the git cwd). */
export function createGitOps(session: { readonly projectRoot: string | null }) {
  async function git(...args: string[]): Promise<string> {
    const root = session.projectRoot;
    if (!root) {
      throw new Error("No project open");
    }
    const proc = Bun.spawn(["git", ...args], {
      cwd: root,
      stderr: "pipe",
      stdout: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`git ${args[0]} failed: ${stderr.trim()}`);
    }
    return stdout;
  }

  /**
   * Whether the project is under version control of its OWN: inside a work tree, and not in a
   * folder that work tree ignores. Git answers for the nearest enclosing checkout, so a project
   * copied into another repository's ignored folder would otherwise publish, branch and pull
   * against that repository (the dev server's `projectHasRepository` says the same).
   */
  async function hasRepository(): Promise<boolean> {
    try {
      await git("rev-parse", "--is-inside-work-tree");
    } catch (error) {
      // No project at all is `git()`'s own refusal, not an answer about one.
      if (!session.projectRoot) {
        throw error;
      }
      return false;
    }
    try {
      // `check-ignore` exits 0 (resolves) when the path IS ignored, and 1 (throws) when not.
      await git("check-ignore", "-q", ".");
      return false;
    } catch {
      return true;
    }
  }

  /** {@link git} for a command that acts on the project's repository, refused when it has none. */
  async function repoGit(...args: string[]): Promise<string> {
    if (!(await hasRepository())) {
      throw new Error(
        "This project is not a git repository of its own. Initialize one to use source control.",
      );
    }
    return git(...args);
  }

  async function gitStatus(): Promise<GitStatusResult> {
    if (!session.projectRoot) {
      throw new Error("No project open");
    }

    if (!(await hasRepository())) {
      return {
        ahead: 0,
        behind: 0,
        branch: "",
        files: [],
        isRepo: false,
        remotes: [],
      };
    }

    const branchRaw = await git("branch", "--show-current");
    const branch = branchRaw.trim();
    // Every untracked FILE, not its collapsed folder: see the dev server's status route.
    const files = parsePorcelainV1(
      await git("status", "--porcelain=v1", "-z", "--untracked-files=all"),
    );

    let ahead = 0;
    let behind = 0;
    try {
      ahead = Math.trunc(Number(await git("rev-list", "--count", "@{u}..HEAD"))) || 0;
      behind = Math.trunc(Number(await git("rev-list", "--count", "HEAD..@{u}"))) || 0;
    } catch {
      // No upstream configured
    }

    let remotes: string[] = [];
    try {
      const remotesOut = await git("remote");
      remotes = remotesOut.trim().split("\n").filter(Boolean);
    } catch {
      // No remotes
    }

    return { ahead, behind, branch, files, isRepo: true, remotes };
  }

  async function gitBranches(): Promise<GitBranchesResult> {
    const currentRaw = await repoGit("branch", "--show-current");
    const current = currentRaw.trim();
    const output = await repoGit("branch", "-a", "--format=%(refname:short)");
    const branches = output.trim().split("\n").filter(Boolean);
    return { branches, current };
  }

  async function gitLog(params: { limit?: number }): Promise<GitLogEntry[]> {
    const limit = params.limit ?? 50;
    const output = await repoGit("log", `--max-count=${limit}`, "--format=%H%n%s%n%an%n%aI%n---");
    const entries: GitLogEntry[] = [];
    const chunks = output.trim().split("\n---\n").filter(Boolean);
    for (const chunk of chunks) {
      const [hash, message, author, date] = chunk.split("\n");
      if (hash && message && author && date) {
        entries.push({ author, date, hash, message });
      }
    }
    return entries;
  }

  async function gitStage(params: { files: string[] }): Promise<void> {
    await repoGit("add", "--", ...params.files);
  }

  async function gitUnstage(params: { files: string[] }): Promise<void> {
    await repoGit("restore", "--staged", "--", ...params.files);
  }

  async function gitCommit(params: { message: string }): Promise<void> {
    await repoGit("commit", "-m", params.message);
  }

  async function gitPush(params?: { setUpstream?: boolean }): Promise<void> {
    if (params?.setUpstream) {
      const branchRaw = await repoGit("rev-parse", "--abbrev-ref", "HEAD");
      const branch = branchRaw.trim();
      await repoGit("push", "-u", "origin", branch);
    } else {
      await repoGit("push");
    }
  }

  async function gitPull(): Promise<void> {
    await repoGit("pull");
  }

  async function gitFetch(): Promise<void> {
    await repoGit("fetch");
  }

  async function gitCheckout(params: { branch: string }): Promise<void> {
    await repoGit("checkout", params.branch);
  }

  async function gitCreateBranch(params: { name: string }): Promise<void> {
    await repoGit("checkout", "-b", params.name);
  }

  async function gitDiff(params: { path?: string }): Promise<string> {
    if (params.path) {
      return repoGit("diff", "--", params.path);
    }
    return repoGit("diff");
  }

  async function gitShow(params: { path: string; ref?: string }): Promise<string> {
    const ref = params.ref || "HEAD";
    // `./` so the path resolves against the project root rather than the repository root. See the
    // Same call in the dev server's studio API for what it costs to omit.
    return repoGit("show", `${ref}:./${params.path}`);
  }

  async function gitDiscard(params: { files: string[] }): Promise<void> {
    await repoGit("checkout", "--", ...params.files);
  }

  async function gitInit(): Promise<void> {
    await git("init");
  }

  async function gitAddRemote(params: { name: string; url: string }): Promise<void> {
    await repoGit("remote", "add", params.name, params.url);
  }

  return {
    gitStatus,
    gitBranches,
    gitLog,
    gitStage,
    gitUnstage,
    gitCommit,
    gitPush,
    gitPull,
    gitFetch,
    gitCheckout,
    gitCreateBranch,
    gitDiff,
    gitShow,
    gitDiscard,
    gitInit,
    gitAddRemote,
  };
}

// ─── Legacy free functions (default process-global session via getProjectRoot) ──
// Used by the chromium/ dev launcher and the test suite.

const _legacy = createGitOps({
  get projectRoot() {
    return getProjectRoot();
  },
});

export const { gitStatus } = _legacy;
export const { gitBranches } = _legacy;
export const { gitLog } = _legacy;
export const { gitStage } = _legacy;
export const { gitUnstage } = _legacy;
export const { gitCommit } = _legacy;
export const { gitPush } = _legacy;
export const { gitPull } = _legacy;
export const { gitFetch } = _legacy;
export const { gitCheckout } = _legacy;
export const { gitCreateBranch } = _legacy;
export const { gitDiff } = _legacy;
export const { gitShow } = _legacy;
export const { gitDiscard } = _legacy;
export const { gitInit } = _legacy;
export const { gitAddRemote } = _legacy;
