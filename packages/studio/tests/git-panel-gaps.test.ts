/**
 * Gap coverage for `src/panels/git-panel.ts` — the FLOW, now that the markup is a document:
 * refreshGitStatus, the clone dialog, gitAction error handling, branch switching, commit and
 * commit-and-sync, the commit menu, file rows, stage/unstage/discard, the History tab, the poll
 * timer and cleanup.
 *
 * Complements `tests/git-panel-states.test.ts`, which asserts what the four moods DRAW.
 *
 * Every control is addressed by `part` and by the row's own `data-path`, never by a class: the
 * panel is `src/surfaces/git-panel.json` mounted into the Navigator's `.panel-content`. And every
 * draw is awaited — `mountSurface` is asynchronous, and each kit element settles its own template
 * one `connectedCallback` after that.
 */
import "./with-dom.js";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { notifyModule } from "./notify-mock";

// ─── Controllable module state (captured by mock.module factories) ───────────

let mockPlatform: any;
const activeTabRef: { value: any } = { value: { session: { ui: {} } } };
let calls: [string, ...unknown[]][] = [];
let statusMessages: string[] = [];
let confirmCalls: string[] = [];
let confirmResult = true;
let publishCalls: unknown[] = [];
let promptCalls: { headline: string; opts: Record<string, any> }[] = [];
let promptResult: string | null = null;
let menuCalls: Record<string, any>[] = [];

void mock.module("../src/platform.js", () => ({
  getPlatform: () => mockPlatform,
  hasPlatform: () => true,
  registerPlatform: () => {},
}));

void mock.module("../src/workspace/workspace.js", () => ({
  activeTab: activeTabRef,
  /* Reached through `panels/git-diff-open.ts`: a changed file that the canvas cannot render opens
     a path-keyed stub tab, the way a media file does, and an already-open one is re-activated. A
     partial mock of a module the graph reaches is a LOAD error rather than a missing stub at call
     time, so these are here whether or not a given test clicks a row. */
  activateTab: () => {},
  closeAllTabs: () => {},
  closeTab: () => {},
  openTab: () => {},
  // `store.ts` registers the primary pane's canvas stage at `initShellRefs`, and
  // `canvas/canvas-surface.ts` resolves a pane through `paneById` — both reached transitively
  // From this panel's imports, neither called by it.
  focusPane: () => {},
  paneById: () => {},
  PRIMARY_PANE: "primary",
  SECONDARY_PANE: "secondary",
  renameTab: () => {},
  // `shell.ts` reads the project root from this store to load that project's named layouts, so
  // The stand-in has to carry it — an absent export is a module-resolution error, not a null.
  // `panes`/`activePaneId` are here for the same reason: a canvas surface addresses a pane.
  // `tabs` joins them for `git-diff-open.ts`, which looks a comparison's tab up by path.
  workspace: { activePaneId: "primary", panes: [], projectRoot: null, tabs: new Map() },
}));

/* The panel's job is: read the comparison, store it, and put the pane the file's OWN tab is in
   into git-diff. WHICH tab that is belongs to `git-diff-open.ts` and is tested there — stubbed
   here so these tests fail for the panel's reasons rather than the opener's. */
const openedComparisons: string[] = [];
void mock.module("../src/panels/git-diff-open.js", () => ({
  comparisonRefusal: (path: string, status: string) =>
    status === "R" ? "renamed" : path.endsWith(".png") ? "media" : null,
  openComparisonTab: (path: string) => {
    openedComparisons.push(path);
    return Promise.resolve({ documentPath: path, id: path });
  },
}));

void mock.module("../src/ui/layers.js", () => ({
  /* Converted surfaces mount themselves into a layer, so they import `layerHost` from
     here — a mock without it fails the whole file at import time. */
  layerHost: () => document.body,
  clearLayerSlot: () => {},
  // Reached transitively (progress-modal, quick-search); the panel never calls them.
  getLayerSlot: (_kind: string, id: string) => {
    const el = document.createElement("div");
    el.id = id;
    return el;
  },
  showConfirmDialog: async (headline: string) => {
    confirmCalls.push(headline);
    return confirmResult;
  },
  showDialog: () => Promise.resolve(null),
  // The prompt dialog's own rendering/validation is covered in tests/ui-layers-gaps.test.ts; here
  // Only the options the panel passes and how it handles the resolved value matter.
  showPromptDialog: async (headline: string, opts: Record<string, any> = {}) => {
    promptCalls.push({ headline, opts });
    return promptResult;
  },
}));

/* The kit menu is the split button's dropdown now, so what this file tests is the ROW the panel
   hands it — the menu's own popover, focus and dismissal belong to `tests/surfaces-menu.test.ts`. */
void mock.module("../src/surfaces/menu.js", () => ({
  openMenu: (options: Record<string, any>) => {
    menuCalls.push(options);
    return { close: () => {}, host: document.createElement("div"), ready: Promise.resolve() };
  },
}));

void mock.module("../src/services/notify.js", () =>
  notifyModule((call) => statusMessages.push(call.message)),
);

void mock.module("../src/github/github-publish.js", () => ({
  createGithubRepository: async (opts: unknown) => {
    publishCalls.push(opts);
    return true;
  },
}));

let pullSyncCalls = 0;
let pullSyncImpl: () => Promise<void> = async () => {};

void mock.module("../src/packages/pull-package-sync.js", () => ({
  autoSyncProjectOnOpen: async () => {},
  isAutomatedPackageDiff: () => false,
  planPackageDiscard: async () => ({ automated: true, discard: [], removeUntracked: [] }),
  pullWithPackageSync: () => {
    pullSyncCalls += 1;
    return pullSyncImpl();
  },
}));

const { setProjectState } = (await import("../src/state.js")) as any;
const { resetProjectShell, shell } = await import("../src/shell.js");
const {
  cleanupGitPanel,
  cloneRepository,
  loadDiffForLens,
  mountGitPanel,
  noteFileSaved,
  refreshGitStatus,
} = await import("../src/panels/git-panel.js");

// Source control is project state now; `shell.git` is where the panel reads and writes it.
const git = shell.git as unknown as Record<string, any>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function flush(turns = 3) {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

function log(name: string, impl: (...args: any[]) => any) {
  return (...args: any[]) => {
    calls.push([name, ...args]);
    return impl(...args);
  };
}

const baseFiles = () => [
  { path: "src/page.json", staged: false, status: "M" },
  { path: "src/new.json", staged: false, status: "A" },
  { path: "src/gone.json", staged: false, status: "D" },
  { path: "assets/logo.png", staged: false, status: "M" },
  { path: "untracked.txt", staged: false, status: "U" },
  { path: "staged.json", staged: true, status: "M" },
];

function baseStatus(files = baseFiles()) {
  return {
    ahead: 1,
    behind: 2,
    branch: "main",
    files,
    isRepo: true,
    remotes: ["origin"],
  };
}

function freshPlatform(): any {
  return {
    gitBranches: log("gitBranches", async () => ({ branches: ["main", "dev"], current: "main" })),
    gitCheckout: log("gitCheckout", async () => {}),
    gitCommit: log("gitCommit", async () => {}),
    gitCreateBranch: log("gitCreateBranch", async () => {}),
    gitDiscard: log("gitDiscard", async () => {}),
    gitFetch: log("gitFetch", async () => {}),
    gitInit: log("gitInit", async () => {}),
    gitLog: log("gitLog", async () => []),
    gitPull: log("gitPull", async () => {}),
    gitPush: log("gitPush", async () => {}),
    gitShow: log("gitShow", async () => "ORIGINAL"),
    gitStage: log("gitStage", async () => {}),
    gitStatus: log("gitStatus", async () => baseStatus()),
    gitUnstage: log("gitUnstage", async () => {}),
    readFile: log("readFile", async () => "CURRENT"),
  };
}

function seedRepoUi(overrides: Record<string, unknown> = {}) {
  git.branches = { branches: ["main", "dev"], current: "main" };
  git.status = baseStatus();
  Object.assign(git, overrides);
}

/**
 * Mount the panel into a fresh Navigator host and let the document settle.
 *
 * The host mirrors what `left-panel.ts` paints — a `.panel-body` whose `.panel-content` is the node
 * the document goes into — because that is the one line of the seam this panel owns.
 */
async function draw(deps: Record<string, unknown> = {}): Promise<HTMLElement> {
  const body = document.createElement("div");
  body.className = "panel-body";
  const content = document.createElement("div");
  content.className = "panel-content";
  body.append(content);
  document.body.append(body);
  mountGitPanel(body, deps);
  await flush(6);
  return content;
}

function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function callNames() {
  return calls.map((c) => c[0]);
}

/** One of the panel's own controls, by the `part` the document gives it. */
/**
 * The GIT PANEL's own part, never a kit element's internals.
 *
 * A `part` name belongs to the definition that owns the box, and in light DOM those names share one
 * tree: this panel's two sub-tabs are `jx-tab`s, and a `jx-tab` ships a `[part="status"]` of its
 * own — the wrapper its `status` slot distributes into — which stands EARLIER in the document than
 * the panel's own status line. An unscoped `querySelector` therefore answered with an empty span
 * and the loading indicator read as missing. Every kit element's parts are addressed through the
 * element (`ui.md` §3.2), so the way to ask for one of this document's own is to step over them.
 */
function part(panel: HTMLElement, name: string): HTMLElement | null {
  return (
    [...panel.querySelectorAll<HTMLElement>(`[part="${name}"]`)].find(
      (el) => el.parentElement?.closest("jx-tab") == null,
    ) ?? null
  );
}

/**
 * The panel's own error banner.
 *
 * By its ROLE as well as its part: `part` is scoped to the element that declares it, and both
 * `jx-textfield` and `jx-select` carry an `error` part of their own — each earlier in the panel
 * than this one, so a bare `[part="error"]` finds the commit field's empty sentence.
 */
function errorBanner(panel: HTMLElement): HTMLElement | null {
  return panel.querySelector<HTMLElement>('[part="error"][role="alert"]');
}

/** One changed file's row, and the verb on it. */
function rowAction(panel: HTMLElement, path: string, action: string) {
  const row = panel.querySelector(`[part="file-row"][data-path="${path}"]`);
  expect(row).toBeTruthy();
  return row!.querySelector(`[part="${action}"]`);
}

/** The commit field's own control — a textarea, because the field is multiline. */
function commitInput(panel: HTMLElement): HTMLTextAreaElement {
  return panel.querySelector('[part="commit-input"] [part="input"]') as HTMLTextAreaElement;
}

/** The branch picker's own `<select>`, which is what the reader touches. */
function branchControl(panel: HTMLElement): HTMLSelectElement {
  return panel.querySelector('[part="branch-picker"] [part="control"]') as HTMLSelectElement;
}

beforeEach(() => {
  cleanupGitPanel();
  for (const stale of document.querySelectorAll("body > .panel-body")) {
    stale.remove();
  }
  resetProjectShell();
  activeTabRef.value = { session: { ui: {} } };
  calls = [];
  statusMessages = [];
  confirmCalls = [];
  confirmResult = true;
  publishCalls = [];
  promptCalls = [];
  promptResult = null;
  menuCalls = [];
  openedComparisons.length = 0;
  shell.leftTab = "git";
  mockPlatform = freshPlatform();
  pullSyncCalls = 0;
  pullSyncImpl = async () => {};
  setProjectState({ name: "proj" });
});

afterEach(() => {
  cleanupGitPanel();
});

// ─── refreshGitStatus ─────────────────────────────────────────────────────────

describe("refreshGitStatus", () => {
  test("populates status and branches, clears loading", async () => {
    await refreshGitStatus();
    expect(git.status.branch).toBe("main");
    expect(git.branches).toEqual({ branches: ["main", "dev"], current: "main" });
    expect(git.loading).toBe(false);
    expect(git.error).toBeNull();
    expect(callNames()).toContain("gitStatus");
    expect(callNames()).toContain("gitBranches");
  });

  test("records error message on failure", async () => {
    mockPlatform.gitStatus = log("gitStatus", async () => {
      throw new Error("status boom");
    });
    await refreshGitStatus();
    expect(String(git.error)).toContain("status boom");
    expect(git.loading).toBe(false);
  });

  test("does nothing when no project is open", async () => {
    setProjectState(null);
    await refreshGitStatus();
    expect(calls).toEqual([]);
  });

  test("keeps the status when the branch lookup fails on a repo-less project", async () => {
    // `git branch` exits non-zero outside a work tree while `git status` answers isRepo:false.
    mockPlatform.gitStatus = log("gitStatus", async () => ({
      ahead: 0,
      behind: 0,
      branch: "",
      files: [],
      isRepo: false,
      remotes: [],
    }));
    mockPlatform.gitBranches = log("gitBranches", async () => {
      throw new Error("not a git repository");
    });
    await refreshGitStatus();
    expect(git.status.isRepo).toBe(false);
    expect(git.error).toBeNull();
  });

  test("surfaces a branch failure on a project that IS a repo", async () => {
    mockPlatform.gitBranches = log("gitBranches", async () => {
      throw new Error("branches boom");
    });
    await refreshGitStatus();
    expect(git.status.isRepo).toBe(true);
    expect(String(git.error)).toContain("branches boom");
  });
});

// ─── cloneRepository ──────────────────────────────────────────────────────────

describe("cloneRepository", () => {
  const noopCtx = { openRecentProject: async () => {} };

  test("reports unsupported platform when gitClone is missing", async () => {
    await cloneRepository(noopCtx);
    expect(statusMessages).toContain("Cloning is not supported on this platform.");
    expect(promptCalls).toEqual([]);
  });

  test("asks for the URL through the prompt dialog", async () => {
    mockPlatform.gitClone = log("gitClone", async () => ({ ok: true, root: "/x" }));
    await cloneRepository(noopCtx);
    expect(promptCalls).toHaveLength(1);
    const { headline, opts } = promptCalls[0]!;
    expect(headline).toBe("Clone Git Repository");
    expect(opts.confirmLabel).toBe("Clone");
    expect(opts.placeholder).toBe("https://github.com/user/repo.git");
    expect(opts.validate("")).toBe("Enter a repository URL.");
    expect(opts.validate("https://github.com/u/r.git")).toBe("");
  });

  test("a confirmed URL clones and opens the project", async () => {
    mockPlatform.gitClone = log("gitClone", async () => ({ ok: true, root: "/tmp/clone" }));
    promptResult = "https://github.com/u/r.git";
    const opened: string[] = [];
    await cloneRepository({
      openRecentProject: async (root: string) => {
        opened.push(root);
      },
    });
    expect(calls).toContainEqual(["gitClone", "https://github.com/u/r.git"]);
    expect(opened).toEqual(["/tmp/clone"]);
    expect(statusMessages).toContain("Cloning repository…");
    expect(statusMessages).toContain("Clone complete.");
  });

  test("a dismissed dialog clones nothing", async () => {
    mockPlatform.gitClone = log("gitClone", async () => ({ ok: true, root: "/x" }));
    promptResult = null;
    await cloneRepository(noopCtx);
    expect(callNames()).not.toContain("gitClone");
  });

  test("clone failure surfaces a status message", async () => {
    mockPlatform.gitClone = log("gitClone", async () => {
      throw new Error("denied");
    });
    promptResult = "https://github.com/u/r.git";
    await cloneRepository(noopCtx);
    expect(statusMessages.some((m) => m.includes("Could not clone the repository"))).toBe(true);
  });

  test("clone result without root does not open a project", async () => {
    mockPlatform.gitClone = log("gitClone", async () => ({ ok: false, root: "" }));
    promptResult = "https://github.com/u/r.git";
    const opened: string[] = [];
    await cloneRepository({
      openRecentProject: async (root: string) => {
        opened.push(root);
      },
    });
    expect(opened).toEqual([]);
    expect(statusMessages).not.toContain("Clone complete.");
  });
});

// ─── Panel bootstrap branches ────────────────────────────────────────────────

describe("panel bootstrap", () => {
  test("no status and not loading triggers a background refresh", async () => {
    const panel = await draw();
    await flush();
    expect(callNames()).toContain("gitStatus");
    expect(git.status.isRepo).toBe(true);
    // And the finished read reaches the document with no repaint from anywhere else.
    expect(part(panel, "sync-label")).toBeTruthy();
  });

  test("a failed refresh does not re-arm the background fetch", async () => {
    // Otherwise the render triggered by the failure is the next render's reason to fetch again.
    git.error = "status boom";
    const panel = await draw();
    await flush();
    expect(callNames()).not.toContain("gitStatus");
    expect(errorBanner(panel)?.textContent).toContain("status boom");
  });

  test("the clone action in the no-project state is the one the bootstrap injected", async () => {
    setProjectState(null);
    mockPlatform.gitClone = log("gitClone", async () => ({ ok: true, root: "/x" }));
    let cloned = 0;
    const panel = await draw({
      cloneRepository: () => {
        cloned += 1;
      },
    });
    click(part(panel, "clone"));
    expect(cloned).toBe(1);
  });

  test("initialize repository runs gitInit and refreshes", async () => {
    git.status = { ahead: 0, behind: 0, branch: "", files: [], isRepo: false, remotes: [] };
    const panel = await draw();
    click(part(panel, "init"));
    await flush();
    expect(callNames()).toContain("gitInit");
    expect(callNames()).toContain("gitStatus");
    expect(statusMessages).toContain("Initializing repository…");
    expect(statusMessages).toContain("Repository initialized.");
  });

  test("publish in the non-repo state calls createGithubRepository with the project name", async () => {
    git.status = { ahead: 0, behind: 0, branch: "", files: [], isRepo: false, remotes: [] };
    const panel = await draw();
    click(part(panel, "create-repository"));
    await flush();
    expect(publishCalls).toEqual([{ projectName: "proj" }]);
  });

  test("the no-remote sync bar's publish falls back to a default project name", async () => {
    setProjectState({});
    seedRepoUi();
    git.status.remotes = [];
    const panel = await draw();
    click(part(panel, "create-repository"));
    await flush();
    expect(publishCalls).toEqual([{ projectName: "my-project" }]);
  });

  test("the sync bar shows a last-updated time after a successful refresh", async () => {
    await refreshGitStatus();
    seedRepoUi();
    const panel = await draw();
    expect(part(panel, "sync-time")?.textContent).toContain("Last updated");
  });

  test("an empty file list teaches what lands in the changes tab", async () => {
    seedRepoUi();
    git.status.files = [];
    const panel = await draw();
    expect(panel.textContent).toContain("Nothing to commit.");
    expect(part(panel, "stage-all")).toBeNull();
  });

  test("error and loading indicators render from project state", async () => {
    seedRepoUi({ error: "broken pipe", loading: true });
    const panel = await draw();
    expect(errorBanner(panel)!.textContent).toContain("broken pipe");
    expect(part(panel, "status")!.textContent).toContain("Loading");
  });
});

// ─── Sync bar actions + gitAction ────────────────────────────────────────────

describe("sync bar actions", () => {
  test("refresh re-fetches status", async () => {
    seedRepoUi();
    const panel = await draw();
    click(part(panel, "refresh"));
    await flush();
    expect(callNames()).toContain("gitStatus");
  });

  test("fetch, pull, and push dispatch git actions then refresh", async () => {
    seedRepoUi();
    const panel = await draw();
    click(part(panel, "fetch"));
    await flush();
    click(part(panel, "pull"));
    await flush();
    click(part(panel, "push"));
    await flush();
    const names = callNames();
    expect(names).toContain("gitFetch");
    expect(names).toContain("gitPush");
    // Pull goes through the package-aware orchestrator, not a raw platform gitPull.
    expect(pullSyncCalls).toBe(1);
    expect(names).not.toContain("gitPull");
    expect(names.filter((n) => n === "gitStatus").length).toBe(3);
  });

  test("a failing pull records the error and stops loading", async () => {
    seedRepoUi();
    pullSyncImpl = async () => {
      throw new Error("pull broke");
    };
    const panel = await draw();
    click(part(panel, "pull"));
    await flush();
    expect(pullSyncCalls).toBe(1);
    expect(String(git.error)).toContain("pull broke");
    expect(git.loading).toBe(false);
  });

  test("a failing git action records the error and stops loading", async () => {
    seedRepoUi();
    mockPlatform.gitFetch = log("gitFetch", async () => {
      throw new Error("net down");
    });
    const panel = await draw();
    click(part(panel, "fetch"));
    await flush();
    expect(String(git.error)).toContain("net down");
    expect(git.loading).toBe(false);
  });
});

// ─── Branch selector ─────────────────────────────────────────────────────────

describe("branch selector", () => {
  function chooseBranch(panel: HTMLElement, value: string) {
    const control = branchControl(panel);
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return control;
  }

  test("selecting another branch checks it out", async () => {
    seedRepoUi();
    const panel = await draw();
    chooseBranch(panel, "dev");
    await flush();
    expect(calls).toContainEqual(["gitCheckout", "dev"]);
  });

  test("selecting the current branch is a no-op", async () => {
    seedRepoUi();
    const panel = await draw();
    chooseBranch(panel, "main");
    await flush();
    expect(callNames()).not.toContain("gitCheckout");
  });

  test("the new-branch row opens the prompt and creates the branch", async () => {
    seedRepoUi();
    const panel = await draw();
    promptResult = "feat-x";
    chooseBranch(panel, "__new__");
    await flush(4);

    expect(promptCalls).toHaveLength(1);
    const { headline, opts } = promptCalls[0]!;
    expect(headline).toBe("New Branch");
    expect(opts.confirmLabel).toBe("Create");
    expect(opts.message).toContain("main");
    expect(opts.validate("  ")).toBe("Enter a branch name.");
    expect(opts.validate("feat-x")).toBe("");
    expect(calls).toContainEqual(["gitCreateBranch", "feat-x"]);
  });

  /* A `<select>` always holds one of its options, so putting the control back on the checked-out
     branch is a WRITE the document has to be able to see. The panel announces what the reader
     chose first, which is what makes putting it back a change rather than a no-op (§9.3). */
  test("the picker goes back to the checked-out branch when the dialog is dismissed", async () => {
    seedRepoUi();
    const panel = await draw();
    promptResult = null;
    chooseBranch(panel, "__new__");
    await flush(4);
    expect(callNames()).not.toContain("gitCreateBranch");
    expect(branchControl(panel).value).toBe("main");
  });
});

// ─── Commit form ─────────────────────────────────────────────────────────────

describe("commit form", () => {
  function typeMessage(panel: HTMLElement, value: string) {
    const input = commitInput(panel);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input;
  }

  function chord(input: Element, init: KeyboardEventInit) {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", ...init }),
    );
  }

  test("typing in the message field updates project state", async () => {
    seedRepoUi();
    const panel = await draw();
    typeMessage(panel, "hello commit");
    expect(git.commitMessage).toBe("hello commit");
  });

  test("Ctrl+Enter commits and clears the message", async () => {
    seedRepoUi({ commitMessage: "  quick fix  " });
    const panel = await draw();
    chord(commitInput(panel), { ctrlKey: true });
    await flush();
    expect(calls).toContainEqual(["gitCommit", "quick fix"]);
    expect(git.commitMessage).toBe("");
    expect(callNames()).toContain("gitStatus");
  });

  test("Cmd+Enter commits on macOS", async () => {
    seedRepoUi({ commitMessage: "mac commit" });
    const panel = await draw();
    chord(commitInput(panel), { metaKey: true });
    await flush();
    expect(calls).toContainEqual(["gitCommit", "mac commit"]);
  });

  test("a bare Enter is a newline, not a commit", async () => {
    seedRepoUi({ commitMessage: "not yet" });
    const panel = await draw();
    chord(commitInput(panel), {});
    await flush();
    expect(callNames()).not.toContain("gitCommit");
  });

  test("Ctrl+Enter without a message does nothing", async () => {
    seedRepoUi();
    const panel = await draw();
    chord(commitInput(panel), { ctrlKey: true });
    await flush();
    expect(callNames()).not.toContain("gitCommit");
  });

  test("commit and sync commits, pushes, then refreshes", async () => {
    seedRepoUi({ commitMessage: "sync msg" });
    const panel = await draw();
    click(part(panel, "commit-button"));
    await flush();
    expect(calls).toContainEqual(["gitCommit", "sync msg"]);
    expect(callNames()).toContain("gitPush");
    expect(callNames()).toContain("gitStatus");
    expect(git.commitMessage).toBe("");
  });

  test("commit and sync without a message does nothing", async () => {
    seedRepoUi();
    const panel = await draw();
    click(part(panel, "commit-button"));
    await flush();
    expect(callNames()).not.toContain("gitCommit");
    expect(callNames()).not.toContain("gitPush");
  });

  test("commit and sync records the error when the push fails", async () => {
    seedRepoUi({ commitMessage: "doomed" });
    mockPlatform.gitPush = log("gitPush", async () => {
      throw new Error("push boom");
    });
    const panel = await draw();
    click(part(panel, "commit-button"));
    await flush();
    expect(String(git.error)).toContain("push boom");
    expect(git.loading).toBe(false);
  });

  /* The split button's dropdown is the KIT MENU. It was a hand-built `<div>` toggled by a
     module-level flag, and the flag existed only because the template declared the menu `hidden`
     unconditionally and the two were fighting — every repaint, the 30-second poll among them, left
     whatever the handler had last done standing. What is left to test is the row the panel hands
     `openMenu`, and that its `run` commits without pushing. */
  test("the commit menu offers one row, and it commits without syncing", async () => {
    seedRepoUi({ commitMessage: "menu msg" });
    const panel = await draw();
    click(part(panel, "commit-menu"));
    // The menu surface is reached through a lazy import, so the open lands a turn later.
    await flush();
    expect(menuCalls).toHaveLength(1);
    const options = menuCalls[0]!;
    expect(options.region).toBe("git-commit");
    expect(options.rows.map((row: any) => row.title)).toEqual(["Commit (don't sync)"]);
    // The button that opened it is the popover's invoker, so a mousedown on it is not a dismissal.
    expect(options.opener).toBe(part(panel, "commit-menu"));
    expect(typeof options.place).toBe("function");
    expect(options.place(new DOMRect(0, 0, 120, 40))).toEqual(expect.any(Object));

    options.rows[0].run();
    await flush();
    expect(calls).toContainEqual(["gitCommit", "menu msg"]);
    expect(callNames()).not.toContain("gitPush");
  });
});

// ─── File rows: diff click, stage, unstage, discard ──────────────────────────

describe("file rows", () => {
  function openFile(panel: HTMLElement, path: string) {
    click(rowAction(panel, path, "file-open"));
  }

  test("clicking a modified .json file loads a diff and switches canvas mode", async () => {
    seedRepoUi();
    const modes: string[] = [];
    const diffs: any[] = [];
    const panel = await draw({
      // The mode is written on the tab the COMPARISON is in, which is the tab keyed by the clicked
      // File's path. It used to be `activeTab.value` — so clicking one file flipped whatever
      // Document happened to be focused into git-diff and drew the other file's comparison on it.
      setCanvasMode: (_tab: unknown, m: string) => modes.push(m),
      setGitDiffState: (s: any) => diffs.push(s),
    });
    openFile(panel, "src/page.json");
    await flush();
    expect(calls).toContainEqual(["gitShow", { path: "src/page.json", ref: "HEAD" }]);
    expect(calls).toContainEqual(["readFile", "src/page.json"]);
    expect(git.diffState).toEqual({
      currentContent: "CURRENT",
      filePath: "src/page.json",
      fileStatus: "M",
      originalContent: "ORIGINAL",
    });
    expect(modes).toEqual(["git-diff"]);
    expect(openedComparisons).toEqual(["src/page.json"]);
    expect(diffs.length).toBe(1);
    expect(git.loading).toBe(false);
  });

  test("clicking an added file uses an empty original without gitShow", async () => {
    seedRepoUi();
    const panel = await draw({ setCanvasMode: () => {} });
    openFile(panel, "src/new.json");
    await flush();
    expect(callNames()).not.toContain("gitShow");
    expect(git.diffState.originalContent).toBe("");
    expect(git.diffState.fileStatus).toBe("A");
  });

  test("diff state is stored even without canvas-mode context", async () => {
    seedRepoUi();
    const panel = await draw({});
    openFile(panel, "src/page.json");
    await flush();
    expect(git.diffState.filePath).toBe("src/page.json");
  });

  test("a deleted file compares its last committed version against nothing", async () => {
    /* It used to be ignored on click, justified by "no pair of texts to put side by side". One side
       is the empty string, which is exactly what an ADDED file had always done. */
    seedRepoUi();
    const panel = await draw({});
    openFile(panel, "src/gone.json");
    await flush();
    expect(calls).toContainEqual(["gitShow", { path: "src/gone.json", ref: "HEAD" }]);
    // Never `readFile` on a path that is gone — it would throw.
    expect(callNames()).not.toContain("readFile");
    expect(git.diffState.currentContent).toBe("");
    expect(git.diffState.originalContent).toBe("ORIGINAL");
  });

  test("a media file is refused with a sentence rather than ignored", async () => {
    // The boundary said out loud: a comparison of an image is not text, and handing Monaco bytes
    // Would render mojibake. The row responds; it just responds by explaining.
    seedRepoUi();
    const panel = await draw({});
    openFile(panel, "assets/logo.png");
    await flush();
    expect(callNames()).not.toContain("gitShow");
    expect(callNames()).not.toContain("readFile");
    expect(String(git.error)).toContain("media");
    expect(openedComparisons).not.toContain("assets/logo.png");
  });

  test("a row for a file the last status read no longer holds does nothing", async () => {
    /* The row is captured BEFORE the status moves, because the document is reactive now: emptying
       the file list takes the row off screen on the same tick. What is under test is the flow's own
       guard — a click that arrives against a status that no longer knows the path. */
    seedRepoUi();
    const panel = await draw({});
    const open = rowAction(panel, "src/page.json", "file-open");
    git.status = baseStatus([]);
    click(open);
    await flush();
    expect(callNames()).not.toContain("gitShow");
    expect(git.diffState).toBeNull();
  });

  test("diff load failure records a friendly error", async () => {
    seedRepoUi();
    mockPlatform.readFile = log("readFile", async () => {
      throw new Error("read fail");
    });
    const panel = await draw({});
    openFile(panel, "src/page.json");
    await flush();
    expect(String(git.error)).toContain("Failed to load diff");
    expect(String(git.error)).toContain("read fail");
    expect(git.loading).toBe(false);
  });

  /* The DIFF LENS's reader (§18.4, finding 4). It is the same `readGitDiff` the row click above
     makes — one definition site, because a second copy is how the panel and the lens come to
     disagree about what "the diff of this file" means — with the one difference the lens needs: a
     failure the PANE can state, rather than an error banner over a document nobody asked about. */
  test("loadDiffForLens reads the same pair of texts the row click does", async () => {
    seedRepoUi();
    // oxlint-disable-next-line typescript/await-thenable -- Bun types the matcher `void`; it returns a real Promise and the await is load-bearing.
    await expect(loadDiffForLens("src/page.json", "M")).resolves.toEqual({
      currentContent: "CURRENT",
      filePath: "src/page.json",
      fileStatus: "M",
      originalContent: "ORIGINAL",
    });
    expect(calls).toContainEqual(["gitShow", { path: "src/page.json", ref: "HEAD" }]);
  });

  test("loadDiffForLens answers null when the read fails — the pane says so, not a banner", async () => {
    seedRepoUi();
    mockPlatform.readFile = log("readFile", async () => {
      throw new Error("read fail");
    });
    const { warn } = console;
    const warned: unknown[] = [];
    console.warn = (...args: unknown[]) => warned.push(args[0]);
    try {
      // oxlint-disable-next-line typescript/await-thenable -- Bun types the matcher `void`; it returns a real Promise and the await is load-bearing.
      await expect(loadDiffForLens("src/page.json", "M")).resolves.toBeNull();
    } finally {
      console.warn = warn;
    }
    expect(warned).toContain("loadDiffForLens:");
    // `shell.git.error` is the SOURCE CONTROL panel's banner. A lens failing to read its own
    // Comparison is not a source-control failure and must not raise one.
    expect(git.error).toBeNull();
  });

  test("discard asks for confirmation then discards", async () => {
    seedRepoUi();
    const panel = await draw();
    click(rowAction(panel, "src/page.json", "discard"));
    await flush();
    expect(confirmCalls).toContain("Discard Changes");
    expect(calls).toContainEqual(["gitDiscard", ["src/page.json"]]);
  });

  test("a declined confirmation leaves the file alone", async () => {
    seedRepoUi();
    confirmResult = false;
    const panel = await draw();
    click(rowAction(panel, "src/page.json", "discard"));
    await flush();
    expect(callNames()).not.toContain("gitDiscard");
  });

  test("an untracked file cannot be discarded, and its button says so", async () => {
    seedRepoUi();
    const panel = await draw();
    const discard = rowAction(panel, "untracked.txt", "discard")!;
    expect(discard.querySelector('[part="control"]')?.hasAttribute("disabled")).toBe(true);
    click(discard);
    await flush();
    expect(confirmCalls).toEqual([]);
    expect(callNames()).not.toContain("gitDiscard");
  });

  test("stage and unstage act on single files", async () => {
    seedRepoUi();
    const panel = await draw();
    click(rowAction(panel, "src/page.json", "stage"));
    await flush();
    click(part(panel, "unstage"));
    await flush();
    expect(calls).toContainEqual(["gitStage", ["src/page.json"]]);
    expect(calls).toContainEqual(["gitUnstage", ["staged.json"]]);
  });

  test("stage all and unstage all act on the full lists", async () => {
    seedRepoUi();
    const panel = await draw();
    click(part(panel, "stage-all"));
    await flush();
    click(part(panel, "unstage-all"));
    await flush();
    expect(calls).toContainEqual([
      "gitStage",
      ["src/page.json", "src/new.json", "src/gone.json", "assets/logo.png", "untracked.txt"],
    ]);
    expect(calls).toContainEqual(["gitUnstage", ["staged.json"]]);
  });

  test("files group by component directory with non-json under Other", async () => {
    seedRepoUi();
    const panel = await draw();
    const groups = [...panel.querySelectorAll('[part="group-name"]')].map((el) => el.textContent);
    expect(groups).toContain("/src");
    expect(groups).toContain("Other");
    expect(groups).toContain("/staged.json");
  });
});

// ─── History tab ─────────────────────────────────────────────────────────────

describe("history tab", () => {
  function tab(panel: HTMLElement, name: string) {
    return panel.querySelector(`[part="tab"][data-tab="${name}"]`);
  }

  test("switching to history fetches the log and renders relative dates", async () => {
    seedRepoUi();
    const now = Date.now();
    const entries = [
      { author: "ada", date: new Date(now).toISOString(), hash: "aaaaaaa1111", message: "fresh" },
      {
        author: "ada",
        date: new Date(now - 5 * 60_000 - 2000).toISOString(),
        hash: "bbbbbbb2222",
        message: "minutes",
      },
      {
        author: "bob",
        date: new Date(now - 3 * 3_600_000 - 60_000).toISOString(),
        hash: "ccccccc3333",
        message: "hours",
      },
      {
        author: "bob",
        date: new Date(now - 2 * 86_400_000 - 3_600_000).toISOString(),
        hash: "ddddddd4444",
        message: "days",
      },
      {
        author: "eve",
        date: "2020-01-02T00:00:00.000Z",
        hash: "eeeeeee5555",
        message: "ancient",
      },
    ];
    mockPlatform.gitLog = log("gitLog", async () => entries);
    const panel = await draw();
    click(tab(panel, "history"));
    await flush(4);
    expect(calls).toContainEqual(["gitLog", 30]);
    expect(git.logEntries).toEqual(entries);

    const text = panel.textContent!;
    expect(text).toContain("just now");
    expect(text).toContain("5m ago");
    expect(text).toContain("3h ago");
    expect(text).toContain("2d ago");
    expect(text).toContain("2020");
    expect(text).toContain("aaaaaaa");
    expect(panel.querySelectorAll('[part="history-entry"]').length).toBe(5);
    // The commit form is not drawn beside the log: one tab body at a time.
    expect(part(panel, "commit")).toBeNull();
  });

  test("history with cached empty entries teaches what a commit is, without refetching", async () => {
    seedRepoUi({ logEntries: [] });
    const panel = await draw();
    click(tab(panel, "history"));
    await flush(4);
    expect(callNames()).not.toContain("gitLog");
    expect(panel.textContent).toContain("No commits yet.");
  });

  test("a log fetch failure records the error", async () => {
    seedRepoUi();
    mockPlatform.gitLog = log("gitLog", async () => {
      throw new Error("log boom");
    });
    const panel = await draw();
    click(tab(panel, "history"));
    await flush(4);
    expect(String(git.error)).toContain("log boom");
  });

  test("the changes tab carries the count in its own name", async () => {
    seedRepoUi();
    const panel = await draw();
    expect(tab(panel, "changes")?.getAttribute("label")).toBe("Local Changes (6)");
  });
});

// ─── Poll timer + cleanup ────────────────────────────────────────────────────

describe("poll timer", () => {
  test("the interval refreshes only when the git tab is visible and idle", async () => {
    cleanupGitPanel();
    const realSetInterval = globalThis.setInterval;
    let pollCb: (() => void) | null = null;
    let pollMs = 0;
    (globalThis as any).setInterval = (fn: () => void, ms: number) => {
      pollCb = fn;
      pollMs = ms;
      return 123_456;
    };
    try {
      seedRepoUi();
      await draw();
    } finally {
      globalThis.setInterval = realSetInterval;
    }
    expect(pollCb).toBeTruthy();
    expect(pollMs).toBe(30_000);

    calls = [];
    git.loading = false;
    pollCb!();
    await flush();
    expect(callNames()).toContain("gitStatus");

    calls = [];
    git.loading = true;
    pollCb!();
    await flush();
    expect(calls).toEqual([]);

    calls = [];
    git.loading = false;
    shell.leftTab = "layers";
    pollCb!();
    await flush();
    expect(calls).toEqual([]);

    cleanupGitPanel();
  });

  test("cleanupGitPanel is idempotent, and takes the document down with the timer", async () => {
    seedRepoUi();
    const panel = await draw(); // Arms the timer and mounts the surface
    cleanupGitPanel();
    cleanupGitPanel(); // Second call hits the no-timer, no-surface branch
    expect(panel.querySelector('[part="git-panel"]')).toBeNull();
  });

  test("a repaint into the same host keeps the standing document", async () => {
    seedRepoUi();
    const panel = await draw();
    const root = panel.querySelector('[part="git-panel"]');
    mountGitPanel(panel.closest(".panel-body") as HTMLElement, {});
    await flush(4);
    expect(panel.querySelector('[part="git-panel"]')).toBe(root!);
  });

  test("a mount into a different host replaces the standing document", async () => {
    seedRepoUi();
    const first = await draw();
    const second = await draw();
    expect(first.querySelector('[part="git-panel"]')).toBeNull();
    expect(second.querySelector('[part="git-panel"]')).toBeTruthy();
  });
});

describe("keeping an open comparison fresh", () => {
  /* A comparison is two texts read ONCE, so nothing about it notices a save or a commit. That was
     invisible while the artboards merely drew two documents side by side; with change marks on
     them, a stale comparison means the tint and the count are lying about a file the author is
     editing while they look at it. */

  test("a save of the compared file re-reads it, and bumps the revision", async () => {
    seedRepoUi();
    git.diffState = {
      currentContent: "OLD",
      filePath: "src/page.json",
      fileStatus: "M",
      originalContent: "ORIGINAL",
    };
    const before = git.rev;
    mockPlatform.readFile = log("readFile", async () => "SAVED");
    await noteFileSaved("src/page.json");
    expect(git.diffState.currentContent).toBe("SAVED");
    expect(git.rev).toBeGreaterThan(before);
  });

  test("a save of some OTHER file bumps the revision and re-reads nothing", async () => {
    seedRepoUi();
    git.diffState = {
      currentContent: "OLD",
      filePath: "src/page.json",
      fileStatus: "M",
      originalContent: "ORIGINAL",
    };
    calls.length = 0;
    await noteFileSaved("src/elsewhere.json");
    // The revision still moves: a Diff LENS may be following that other file.
    expect(git.rev).toBeGreaterThan(0);
    expect(callNames()).not.toContain("readFile");
    expect(git.diffState.currentContent).toBe("OLD");
  });

  test("a save with no comparison open is harmless", async () => {
    seedRepoUi();
    git.diffState = null;
    await noteFileSaved("src/page.json");
    expect(git.diffState).toBeNull();
  });

  test("a read that fails leaves the comparison that last read cleanly", async () => {
    seedRepoUi();
    git.diffState = {
      currentContent: "OLD",
      filePath: "src/page.json",
      fileStatus: "M",
      originalContent: "ORIGINAL",
    };
    mockPlatform.readFile = log("readFile", async () => {
      throw new Error("disk gone");
    });
    await noteFileSaved("src/page.json");
    // A momentary failure is not a reason to blank a review someone is in the middle of.
    expect(git.diffState.currentContent).toBe("OLD");
  });

  test("a refresh re-reads the open comparison against the status it just fetched", async () => {
    seedRepoUi();
    git.diffState = {
      currentContent: "OLD",
      filePath: "src/page.json",
      fileStatus: "M",
      originalContent: "OLD-HEAD",
    };
    mockPlatform.gitShow = log("gitShow", async () => "NEW-HEAD");
    mockPlatform.readFile = log("readFile", async () => "NEW");
    await refreshGitStatus();
    expect(git.diffState.originalContent).toBe("NEW-HEAD");
    expect(git.diffState.currentContent).toBe("NEW");
  });

  test("a file that is no longer changed loses its comparison rather than keeping a stale one", async () => {
    // What the author's own commit just made true: there is nothing left to compare.
    seedRepoUi();
    git.diffState = {
      currentContent: "X",
      filePath: "src/committed.json",
      fileStatus: "M",
      originalContent: "Y",
    };
    await refreshGitStatus();
    expect(git.diffState).toBeNull();
  });

  test("every refresh bumps the revision, which is what re-issues a lens's read", async () => {
    seedRepoUi();
    const before = git.rev;
    await refreshGitStatus();
    expect(git.rev).toBeGreaterThan(before);
  });
});

describe("the changed-file row is a real control", () => {
  test("is a button, with a name that carries the file and its status in words", async () => {
    // It was a bare span with a cursor and a title: the panel's primary verb was mouse-only, and
    // The status was a single letter and a colour with nothing to read aloud. A `<button>` needs
    // No role, no tabindex and no key handler of its own.
    seedRepoUi();
    const panel = await draw({});
    const open = rowAction(panel, "src/page.json", "file-open")!;
    expect(open.tagName).toBe("BUTTON");
    expect(open.getAttribute("aria-label")).toBe("src/page.json, modified");
    expect(rowAction(panel, "src/gone.json", "file-open")!.getAttribute("aria-label")).toBe(
      "src/gone.json, deleted",
    );
  });

  test("a status with no word of its own still says the file changed", async () => {
    seedRepoUi();
    git.status = baseStatus([{ path: "odd.json", staged: false, status: "X" }]);
    const panel = await draw({});
    expect(rowAction(panel, "odd.json", "file-open")!.getAttribute("aria-label")).toBe(
      "odd.json, changed",
    );
  });
});
