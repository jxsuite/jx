/**
 * Source control's flow, `src/publish/source-control.ts`: what git is asked and in what order,
 * under one loading and error contract, with a comparison that follows the working tree.
 *
 * The verbs used to be the Source Control panel's buttons; they are the Publish workspace's now
 * (studio.md §5.5, §22.8), and this suite drives them as functions so it fails for the flow's
 * reasons. What the workspace DRAWS is `publish-workspace.test.ts`'s.
 */
import "./with-dom.js";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { notifyModule } from "./notify-mock";
import type { NotifyCall } from "./notify-mock";
import type { PromptDialogOptions } from "../src/ui/layers";
import type { GitDiffState, GitStatusResult, StudioPlatform } from "../src/types";

// ─── Boundaries ──────────────────────────────────────────────────────────────

let confirmAnswer = true;
let promptAnswer: string | null = null;
const confirms: string[] = [];
const prompts: { headline: string; opts: PromptDialogOptions }[] = [];
void mock.module("../src/ui/layers.js", () => ({
  getLayerSlot: (_kind: string, id: string) => {
    const el = document.createElement("div");
    el.id = id;
    return el;
  },
  layerHost: () => document.body,
  showConfirmDialog: async (headline: string, message: string) => {
    confirms.push(`${headline}: ${message}`);
    return confirmAnswer;
  },
  showDialog: async () => null,
  showPromptDialog: async (headline: string, opts: PromptDialogOptions) => {
    prompts.push({ headline, opts });
    return promptAnswer;
  },
}));

const opened: string[] = [];
/** What a test wants to know at the moment the comparison's tab opens. */
let onOpen: () => void = () => {};
void mock.module("../src/panels/git-diff-open.js", () => ({
  comparisonRefusal: (path: string, status: string) =>
    status === "R" ? "renamed" : path.endsWith(".png") ? "media" : null,
  openComparisonTab: async (path: string) => {
    opened.push(path);
    onOpen();
    return { documentPath: path, id: path };
  },
}));

let pulls = 0;
let pullFailure: Error | null = null;
void mock.module("../src/packages/pull-package-sync.js", () => ({
  autoSyncProjectOnOpen: async () => {},
  isAutomatedPackageDiff: () => false,
  planPackageDiscard: async () => ({ automated: true, discard: [], removeUntracked: [] }),
  pullWithPackageSync: async () => {
    pulls += 1;
    if (pullFailure) {
      throw pullFailure;
    }
  },
}));

let token: string | null = "ghp_token";
void mock.module("../src/github/github-auth.js", () => ({
  authenticateGithub: async () => token,
  clearGithubToken: () => {},
  getGithubToken: () => token,
}));

const repoCalls: { projectName: string }[] = [];
void mock.module("../src/github/github-publish.js", () => ({
  createGithubRepository: async (opts: { projectName: string }) => {
    repoCalls.push(opts);
    return true;
  },
}));

const notes: NotifyCall[] = [];
void mock.module("../src/services/notify.js", () => notifyModule((call) => notes.push(call)));

const harness = await import("./harness");
const { installMockPlatform, resetStudioState } = harness;
const { setProjectState } = await import("../src/state.js");
const { resetProjectShell, shell } = await import("../src/shell.js");
const { pinClock, unpinClock } = await import("../src/services/clock.js");
const sc = await import("../src/publish/source-control.js");

/** A tracked repository on `main`, with these changed files. */
function repo(files: GitStatusResult["files"] = [], extra: Partial<GitStatusResult> = {}) {
  return {
    ahead: 0,
    behind: 0,
    branch: "main",
    files,
    isRepo: true,
    remotes: ["origin"],
    ...extra,
  } satisfies GitStatusResult;
}

let calls: unknown[][] = [];
let platform: StudioPlatform;

/** A platform member that records its calls beside the harness's own, for the defaults below. */
function logged<A extends unknown[], R>(name: string, fn: (...args: A) => R) {
  return (...args: A): R => {
    calls.push([name, ...args]);
    return fn(...args);
  };
}

function install(overrides: Partial<StudioPlatform> = {}) {
  const installed = installMockPlatform({
    gitBranches: logged("gitBranches", async () => ({
      branches: ["main", "feature"],
      current: "main",
    })),
    gitStatus: logged("gitStatus", async () =>
      repo([{ path: "pages/index.json", staged: false, status: "M" }]),
    ),
    ...overrides,
  });
  ({ calls } = installed.state);
  ({ platform } = installed);
  return installed;
}

/** The verbs the platform was asked, by name, in order. */
const asked = () => calls.map(([name]) => name);

beforeEach(() => {
  resetProjectShell();
  resetStudioState({ name: "Demo", projectRoot: "/p" });
  confirmAnswer = true;
  promptAnswer = null;
  confirms.length = 0;
  prompts.length = 0;
  opened.length = 0;
  onOpen = () => {};
  pulls = 0;
  pullFailure = null;
  token = "ghp_token";
  repoCalls.length = 0;
  notes.length = 0;
  install();
  sc.setSourceControlDeps({});
});

afterEach(() => {
  sc.cleanupSourceControl();
});

// ─── Reading ─────────────────────────────────────────────────────────────────

describe("refreshGitStatus", () => {
  test("reads the status and the branches, stamps the time and bumps the revision", async () => {
    pinClock(1000);
    const { rev } = shell.git;
    await sc.refreshGitStatus();
    expect(shell.git.status?.files).toHaveLength(1);
    expect(shell.git.branches?.current).toBe("main");
    expect(shell.git.lastUpdated).toBe(1000);
    expect(shell.git.rev).toBe(rev + 1);
    expect(shell.git.loading).toBe(false);
    unpinClock();
  });

  test("does nothing with no project open", async () => {
    setProjectState(null);
    await sc.refreshGitStatus();
    expect(calls).toEqual([]);
  });

  test("a failed status is the one error line", async () => {
    install({
      gitStatus: async () => {
        throw new Error("no git");
      },
    });
    await sc.refreshGitStatus();
    expect(shell.git.error).toBe("no git");
  });

  test("a branch failure on a project that is not a repository is expected, and silent", async () => {
    install({
      gitBranches: async () => {
        throw new Error("not a work tree");
      },
      gitStatus: async () => ({ ...repo(), isRepo: false }),
    });
    await sc.refreshGitStatus();
    expect(shell.git.status?.isRepo).toBe(false);
    expect(shell.git.error).toBeNull();
  });

  test("a branch failure on a repository is reported", async () => {
    install({
      gitBranches: async () => {
        throw new Error("broken refs");
      },
    });
    await sc.refreshGitStatus();
    expect(shell.git.error).toBe("broken refs");
  });

  test("once the log has been read, every refresh reads it again", async () => {
    shell.git.logEntries = [];
    await sc.refreshGitStatus();
    expect(asked()).toContain("gitLog");
  });

  test("the log is fetched on request, and a failure is the error line", async () => {
    install({
      gitLog: async () => [
        { author: "ada", date: "2026-01-01T00:00:00Z", hash: "abc", message: "m" },
      ],
    });
    await sc.fetchGitLog();
    expect(shell.git.logEntries).toHaveLength(1);
    install({
      gitLog: async () => {
        throw new Error("log broke");
      },
    });
    await sc.fetchGitLog();
    expect(shell.git.error).toBe("log broke");
  });
});

// ─── Cloning, and what the host can do ───────────────────────────────────────

describe("cloning", () => {
  test("refuses out loud on a host that cannot clone", async () => {
    await sc.cloneRepository({ openRecentProject: async () => {} });
    expect(notes.at(-1)?.message).toBe("Cloning is not supported on this platform.");
    expect(sc.platformSupportsClone()).toBe(false);
  });

  test("asks for the URL, clones, and opens what it cloned", async () => {
    const roots: string[] = [];
    install({ gitClone: async () => ({ ok: true, root: "/cloned" }) });
    expect(sc.platformSupportsClone()).toBe(true);
    promptAnswer = "https://github.com/a/b.git";
    await sc.cloneRepository({
      openRecentProject: async (root) => {
        roots.push(root);
      },
    });
    expect(prompts[0]?.headline).toBe("Clone Git Repository");
    expect(prompts[0]?.opts.validate?.("  ", "")).toBe("Enter a repository URL.");
    expect(prompts[0]?.opts.validate?.("x", "")).toBe("");
    expect(roots).toEqual(["/cloned"]);
  });

  test("a dismissed prompt clones nothing, and a failure is reported", async () => {
    let cloned = 0;
    install({
      gitClone: async () => {
        cloned += 1;
        throw new Error("denied");
      },
    });
    await sc.cloneRepository({ openRecentProject: async () => {} });
    expect(cloned).toBe(0);
    promptAnswer = "https://x";
    await sc.cloneRepository({ openRecentProject: async () => {} });
    expect(notes.at(-1)).toMatchObject({ message: "Could not clone the repository." });
  });

  test("a clone with no root opens nothing", async () => {
    const roots: string[] = [];
    install({ gitClone: async () => ({ ok: true, root: "" }) });
    promptAnswer = "https://x";
    await sc.cloneRepository({
      openRecentProject: async (root) => {
        roots.push(root);
      },
    });
    expect(roots).toEqual([]);
  });

  test("the injected clone flow runs, and is a no-op before injection", () => {
    sc.runCloneRepository();
    let ran = 0;
    sc.setSourceControlDeps({
      cloneRepository: () => {
        ran += 1;
      },
    });
    sc.runCloneRepository();
    expect(ran).toBe(1);
  });

  test("the host's git semantics: sessions and pull requests are declared, not assumed", () => {
    expect(sc.platformHostsGit()).toBe(false);
    expect(sc.platformOpensPullRequests()).toBe(false);
    install({ createPullRequest: async () => ({ number: 1, url: "u" }), gitHosted: true });
    expect(sc.platformHostsGit()).toBe(true);
    expect(sc.platformOpensPullRequests()).toBe(true);
  });
});

// ─── Verbs ───────────────────────────────────────────────────────────────────

describe("the verbs", () => {
  test("including stages and leaving out unstages, then re-reads", async () => {
    await sc.setIncluded("a.json", true);
    await sc.setIncluded("b.json", false);
    expect(calls.filter(([name]) => name === "gitStage" || name === "gitUnstage")).toEqual([
      ["gitStage", ["a.json"]],
      ["gitUnstage", ["b.json"]],
    ]);
    expect(asked()).toContain("gitStatus");
  });

  test("include all stages what is left out, and leave all out unstages what is in", async () => {
    shell.git.status = repo([
      { path: "a.json", staged: true, status: "M" },
      { path: "b.json", staged: false, status: "M" },
    ]);
    await sc.setAllIncluded(true);
    shell.git.status = repo([
      { path: "a.json", staged: true, status: "M" },
      { path: "b.json", staged: false, status: "M" },
    ]);
    await sc.setAllIncluded(false);
    expect(calls.filter(([name]) => name === "gitStage" || name === "gitUnstage")).toEqual([
      ["gitStage", ["b.json"]],
      ["gitUnstage", ["a.json"]],
    ]);
  });

  test("include all with nothing to move asks git nothing", async () => {
    shell.git.status = repo([{ path: "a.json", staged: true, status: "M" }]);
    await sc.setAllIncluded(true);
    expect(calls).toEqual([]);
  });

  test("a failing verb is the error line and drops the busy flag", async () => {
    install({
      gitStage: async () => {
        throw new Error("index.lock");
      },
    });
    expect(await sc.gitAction((plat) => plat.gitStage(["x"]))).toBe(false);
    expect(shell.git.error).toBe("index.lock");
    expect(shell.git.loading).toBe(false);
  });

  test("fetch, push and pull run their verbs; a failed pull is the error line", async () => {
    await sc.fetchRemote();
    await sc.pushCurrentBranch();
    await sc.pullRemote();
    expect(asked()).toEqual(expect.arrayContaining(["gitFetch", "gitPush"]));
    expect(pulls).toBe(1);
    pullFailure = new Error("conflict");
    await sc.pullRemote();
    expect(shell.git.error).toBe("conflict");
    expect(shell.git.loading).toBe(false);
  });

  test("discard asks first, refuses an untracked file, and discards on yes", async () => {
    shell.git.status = repo([
      { path: "a.json", staged: false, status: "M" },
      { path: "new.json", staged: false, status: "U" },
    ]);
    await sc.discardFile("new.json");
    expect(confirms).toEqual([]);
    confirmAnswer = false;
    await sc.discardFile("a.json");
    expect(asked()).not.toContain("gitDiscard");
    confirmAnswer = true;
    await sc.discardFile("a.json");
    expect(calls.find(([name]) => name === "gitDiscard")).toEqual(["gitDiscard", ["a.json"]]);
  });

  test("initialize tracks the project and re-reads; a failure is reported with its Retry", async () => {
    await sc.initRepository();
    expect(asked()).toEqual(["gitInit", "gitStatus", "gitBranches"]);
    install({
      gitInit: async () => {
        throw new Error("read-only");
      },
    });
    await sc.initRepository();
    expect(notes.at(-1)).toMatchObject({
      message: "Could not initialize the repository.",
      options: { action: "git.init" },
    });
  });

  test("create repository is named after the project, with a default", async () => {
    await sc.createRepository();
    setProjectState(null);
    await sc.createRepository();
    expect(repoCalls).toEqual([{ projectName: "Demo" }, { projectName: "my-project" }]);
  });

  test("signing in says so only when it worked", async () => {
    await sc.signInToGithub();
    token = null;
    await sc.signInToGithub();
    expect(notes.map((note) => note.message)).toEqual(["Signed in to GitHub."]);
  });
});

describe("branches", () => {
  test("checking out the current branch asks git nothing", async () => {
    shell.git.branches = { branches: ["main"], current: "main" };
    await sc.checkoutBranch("main");
    expect(calls).toEqual([]);
  });

  test("another branch is checked out in place on an ordinary working tree", async () => {
    shell.git.branches = { branches: ["main", "feature"], current: "main" };
    await sc.checkoutBranch("feature");
    expect(confirms).toEqual([]);
    expect(calls[0]).toEqual(["gitCheckout", "feature"]);
  });

  test("where a branch is a session, the reload is asked about first", async () => {
    install({ gitHosted: true });
    shell.git.branches = { branches: ["main", "feature"], current: "main" };
    confirmAnswer = false;
    await sc.checkoutBranch("feature");
    expect(confirms[0]).toContain("reloads Studio on that branch");
    expect(asked()).not.toContain("gitCheckout");
    confirmAnswer = true;
    await sc.checkoutBranch("feature");
    expect(asked()).toContain("gitCheckout");
  });

  test("a new branch is named in a prompt and created from the current one", async () => {
    shell.git.branches = { branches: ["main"], current: "main" };
    await sc.createBranch();
    expect(asked()).not.toContain("gitCreateBranch");
    expect(prompts[0]?.opts.message).toBe("Branching from main.");
    expect(prompts[0]?.opts.validate?.("", "")).toBe("Enter a branch name.");
    expect(prompts[0]?.opts.validate?.("x", "")).toBe("");
    promptAnswer = "  studio/pricing ";
    await sc.createBranch();
    expect(calls.find(([name]) => name === "gitCreateBranch")).toEqual([
      "gitCreateBranch",
      "studio/pricing",
    ]);
  });

  test("with no branch read yet, the prompt says where it branches from in words", async () => {
    await sc.createBranch();
    expect(prompts[0]?.opts.message).toBe("Branching from the current branch.");
    shell.git.status = repo([], { branch: "trunk" });
    await sc.createBranch();
    expect(prompts[1]?.opts.message).toBe("Branching from trunk.");
  });
});

// ─── Comparisons ─────────────────────────────────────────────────────────────

describe("comparisons", () => {
  function withFiles(files: Record<string, string>, show = "old") {
    return install({
      gitShow: async () => show,
      readFile: async (path: string) => {
        const content = files[path];
        if (content === undefined) {
          throw new Error(`no such file: ${path}`);
        }
        return content;
      },
    });
  }

  test("each side is read only where it exists", async () => {
    withFiles({ "a.json": "new" });
    expect(await sc.readGitDiff("a.json", "M")).toEqual({
      currentContent: "new",
      filePath: "a.json",
      fileStatus: "M",
      originalContent: "old",
    });
    const added = await sc.readGitDiff("a.json", "A");
    expect(added.originalContent).toBe("");
    const deleted = await sc.readGitDiff("gone.json", "D");
    expect(deleted.currentContent).toBe("");
  });

  test("the lens reader answers null when the read fails", async () => {
    withFiles({});
    const { warn } = console;
    console.warn = () => {};
    expect(await sc.loadDiffForLens("missing.json", "M")).toBeNull();
    console.warn = warn;
  });

  test("Before and after opens the file's own tab in Diff", async () => {
    withFiles({ "a.json": "new" });
    const modes: [unknown, string][] = [];
    const states: (GitDiffState | null)[] = [];
    sc.setSourceControlDeps({
      setCanvasMode: (tab, mode) => {
        modes.push([tab?.id, mode]);
      },
      setGitDiffState: (state) => {
        states.push(state);
      },
    });
    shell.git.status = repo([{ path: "a.json", staged: false, status: "M" }]);
    const statesWhenOpened: number[] = [];
    onOpen = () => {
      statesWhenOpened.push(states.length);
    };
    await sc.openFileComparison("a.json");
    expect(opened).toEqual(["a.json"]);
    // The canvas has the comparison before the tab opens, because the tab opens already in Diff.
    expect(statesWhenOpened).toEqual([1]);
    expect(modes).toEqual([["a.json", "git-diff"]]);
    expect(states[0]?.currentContent).toBe("new");
    expect(shell.git.diffState?.filePath).toBe("a.json");
    expect(shell.git.loading).toBe(false);
  });

  test("a rename and a media file are refused in words; an unknown path is ignored", async () => {
    shell.git.status = repo([
      { path: "b.json", staged: false, status: "R" },
      { path: "logo.png", staged: false, status: "M" },
    ]);
    await sc.openFileComparison("nowhere.json");
    expect(shell.git.error).toBeNull();
    await sc.openFileComparison("b.json");
    expect(shell.git.error).toBe('"b.json" has no change this view can open.');
    await sc.openFileComparison("logo.png");
    expect(shell.git.error).toBe("media");
    expect(opened).toEqual([]);
  });

  test("a failed read is a friendly error", async () => {
    withFiles({});
    shell.git.status = repo([{ path: "a.json", staged: false, status: "M" }]);
    await sc.openFileComparison("a.json");
    expect(shell.git.error).toMatch(/^Failed to load diff: /);
    expect(shell.git.loading).toBe(false);
  });

  test("a save of the compared file re-reads it; another file's only bumps the revision", async () => {
    withFiles({ "a.json": "v2" });
    shell.git.loading = true;
    shell.git.diffState = {
      currentContent: "v1",
      filePath: "a.json",
      fileStatus: "M",
      originalContent: "old",
    };
    const { rev } = shell.git;
    await sc.noteFileSaved("b.json");
    expect(shell.git.rev).toBe(rev + 1);
    expect(shell.git.diffState.currentContent).toBe("v1");
    // Busy: the save does not start a second status read.
    expect(asked()).not.toContain("gitStatus");
    await sc.noteFileSaved("a.json");
    expect(shell.git.diffState.currentContent).toBe("v2");
    await sc.noteFileSaved(null);
  });

  test("a save that cannot be re-read keeps the last clean comparison", async () => {
    withFiles({});
    shell.git.loading = true;
    shell.git.diffState = {
      currentContent: "v1",
      filePath: "a.json",
      fileStatus: "M",
      originalContent: "old",
    };
    await sc.noteFileSaved("a.json");
    expect(shell.git.diffState.currentContent).toBe("v1");
  });

  test("a refresh re-reads the open comparison, and drops one for a file no longer changed", async () => {
    withFiles({ "pages/index.json": "fresh" });
    shell.git.diffState = {
      currentContent: "stale",
      filePath: "pages/index.json",
      fileStatus: "M",
      originalContent: "old",
    };
    await sc.refreshGitStatus();
    expect(shell.git.diffState.currentContent).toBe("fresh");
    install({ gitStatus: async () => repo([]) });
    await sc.refreshGitStatus();
    expect(shell.git.diffState).toBeNull();
  });

  test("a refresh whose re-read fails keeps the comparison", async () => {
    withFiles({});
    shell.git.diffState = {
      currentContent: "kept",
      filePath: "pages/index.json",
      fileStatus: "M",
      originalContent: "old",
    };
    await sc.refreshGitStatus();
    expect(shell.git.diffState.currentContent).toBe("kept");
  });
});

// ─── Rows ────────────────────────────────────────────────────────────────────

describe("rows", () => {
  test("files group by the folder of what the app can render, the rest under Other", () => {
    const groups = sc.groupFilesByComponent([
      { path: "pages/index.json", staged: true, status: "M" },
      { path: "pages/about.md", staged: false, status: "A" },
      { path: "project.json", staged: false, status: "M" },
      { path: "src/app.ts", staged: false, status: "U" },
    ]);
    // No format class is loaded here, so a Markdown page is not something the app can render yet
    // And sits under Other with the TypeScript, in the order the files were listed.
    expect(groups.map((group) => [group.name, group.files.map((file) => file.name)])).toEqual([
      ["/pages", ["index.json"]],
      ["Other", ["about.md", "app.ts"]],
      ["/project.json", ["project.json"]],
    ]);
    expect(groups[0]?.files[0]).toEqual({
      cannotDiscard: false,
      dir: "pages",
      hasDir: true,
      included: true,
      key: "pages/index.json",
      label: "pages/index.json, modified",
      name: "index.json",
      path: "pages/index.json",
      status: "M",
      statusWord: "modified",
    });
    expect(groups[1]?.files[1]?.cannotDiscard).toBe(true);
  });

  test("a status with no word of its own still says the file changed", () => {
    expect(sc.statusWord("X")).toBe("changed");
    expect(sc.changeRow({ path: "a", staged: false, status: "X" }).hasDir).toBe(false);
  });

  test("the compact tag is one vocabulary beside the words, an unknown letter an edit", () => {
    expect(["A", "D", "M", "R", "U", "X"].map((letter) => sc.statusTag(letter))).toEqual([
      "NEW",
      "DELETED",
      "EDIT",
      "RENAMED",
      "NEW",
      "EDIT",
    ]);
  });
});

describe("including what has not been shown", () => {
  test("a path is new once: unstaged ones are returned, every listed one is marked shown", () => {
    shell.git.status = repo([
      { path: "a.json", staged: false, status: "M" },
      { path: "b.json", staged: true, status: "M" },
    ]);
    const answers = [sc.unshownUnstagedChanges(), sc.unshownUnstagedChanges()];
    expect(answers).toEqual([["a.json"], []]);
  });

  test("a path that left the status is new again, and so is every path of another project", () => {
    const changed = repo([{ path: "a.json", staged: false, status: "M" }]);
    const answers: string[][] = [];
    shell.git.status = changed;
    answers.push(sc.unshownUnstagedChanges());
    shell.git.status = repo([]);
    answers.push(sc.unshownUnstagedChanges());
    shell.git.status = changed;
    answers.push(sc.unshownUnstagedChanges());
    resetStudioState({ name: "Other", projectRoot: "/q" });
    answers.push(sc.unshownUnstagedChanges());
    expect(answers).toEqual([["a.json"], [], ["a.json"], ["a.json"]]);
  });

  test("cleanup forgets what was shown", () => {
    shell.git.status = repo([{ path: "a.json", staged: false, status: "M" }]);
    const first = sc.unshownUnstagedChanges();
    sc.cleanupSourceControl();
    expect([first, sc.unshownUnstagedChanges()]).toEqual([["a.json"], ["a.json"]]);
  });

  test("stages what is new, and waits out a read in flight or a project git does not track", async () => {
    const changed = [{ path: "a.json", staged: false, status: "M" }];
    const staged = () => calls.filter(([name]) => name === "gitStage");
    const counts: number[] = [];
    shell.git.status = repo(changed);
    shell.git.loading = true;
    await sc.includeNewChanges();
    counts.push(staged().length);
    shell.git.loading = false;
    shell.git.status = repo(changed, { isRepo: false });
    await sc.includeNewChanges();
    counts.push(staged().length);
    shell.git.status = repo(changed);
    await sc.includeNewChanges();
    counts.push(staged().length);
    // The mock's index does not move, so this is the author having left it out since.
    shell.git.status = repo(changed);
    await sc.includeNewChanges();
    counts.push(staged().length);
    expect(counts).toEqual([0, 0, 1, 1]);
    expect(staged()[0]).toEqual(["gitStage", ["a.json"]]);
  });

  test("a commit row carries the short hash, the author and the age", () => {
    pinClock("2026-01-01T01:00:00Z");
    expect(
      sc.commitRow({
        author: "ada",
        date: "2026-01-01T00:00:00Z",
        hash: "abcdef123",
        message: "m",
      }),
    ).toEqual({ hash: "abcdef1", key: "abcdef123", message: "m", meta: "ada · 1h ago" });
    expect(sc.lastUpdatedLabel(null)).toBe("");
    expect(sc.lastUpdatedLabel(Date.parse("2026-01-01T01:00:00Z"))).toMatch(/^Last updated /);
    unpinClock();
  });
});

// ─── The poll ────────────────────────────────────────────────────────────────

describe("the poll", () => {
  test("refreshes only while Publish is showing and idle, and stops on cleanup", async () => {
    const realSetInterval = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    let tick: (() => void) | null = null;
    let cleared = 0;
    const fakeSetInterval = (fn: () => void) => {
      tick = fn;
      return 123_456;
    };
    const fakeClearInterval = () => {
      cleared += 1;
    };
    /* SAFETY: the flow arms its poll as `setInterval(() => {…}, POLL_GIT)`, a function handler and
       a delay, and only ever hands the handle back to `clearInterval`, so a fake that records the
       handler and returns an inert numeric id serves every use. Both are restored in `finally`. */
    globalThis.setInterval = fakeSetInterval as typeof setInterval;
    globalThis.clearInterval = fakeClearInterval;
    try {
      sc.armGitPoll();
      sc.armGitPoll();
      shell.workspace = "design";
      tick!();
      expect(asked()).not.toContain("gitStatus");
      shell.workspace = "publish";
      shell.git.loading = true;
      tick!();
      expect(asked()).not.toContain("gitStatus");
      shell.git.loading = false;
      tick!();
      await Promise.resolve();
      expect(asked()).toContain("gitStatus");
      sc.cleanupSourceControl();
      sc.cleanupSourceControl();
      expect(cleared).toBe(1);
    } finally {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClear;
      shell.workspace = "design";
    }
  });
});

// ─── The commands ────────────────────────────────────────────────────────────

describe("the Source Control family", () => {
  test("keeps its four ids", () => {
    expect(sc.sourceControlCommands().map((command) => command.id)).toEqual([
      "git.init",
      "git.createGithubRepository",
      "git.push",
      "git.signInToGithub",
    ]);
    void platform;
  });
});
