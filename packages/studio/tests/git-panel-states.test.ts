/**
 * The Source Control panel's four moods, as the document draws them —
 * `src/surfaces/git-panel.json`, mounted by `src/surfaces/git-panel.ts` and projected by
 * `src/panels/git-panel.ts`.
 *
 * Everything is addressed by `part`, by `role` or by the region grammar, because the panel is a
 * document: there is no `sp-action-button`, `sp-picker` or `.git-file-row` to find any more. A row
 * carries the file it draws (`data-path`) so a query says which row it is acting on rather than
 * counting siblings.
 *
 * Every draw is awaited. `mountSurface` is asynchronous and each kit element settles its own
 * template one `connectedCallback` after that, so the synchronous `render(); assert;` this file
 * used to do would now assert against an empty container.
 */
import "./with-dom.js";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { flush } from "./harness";
import type { StudioPlatform } from "../src/types";

let mockPlatform: Partial<StudioPlatform>;

void mock.module("../src/platform.js", () => ({
  getPlatform: () => mockPlatform,
  // Reached transitively: the settings kernel asks whether a platform is registered before writing.
  hasPlatform: () => true,
  registerPlatform: () => {},
}));

void mock.module("../src/workspace/workspace.js", () => ({
  activeTab: { value: null },
  /* Reached through `panels/git-diff-open.ts`: a changed file the canvas cannot render opens a
     path-keyed stub tab, the way a media file does, and an already-open one is re-activated. A
     partial mock of a module the graph reaches is a LOAD error, not a missing stub at call time, so
     these are here whether or not a given test clicks a row. */
  activateTab: () => {},
  closeTab: () => {},
  openTab: () => {},
  // `store.ts` registers the primary pane's canvas stage at `initShellRefs`, and
  // `canvas/canvas-surface.ts` resolves a pane through `paneById` — both reached transitively from
  // This panel's imports, neither called by it.
  focusPane: () => {},
  paneById: () => {},
  PRIMARY_PANE: "primary",
  SECONDARY_PANE: "secondary",
  renameTab: () => {},
  setWorkspaceProject: () => {},
  workspace: { activePaneId: "primary", panes: [], projectRoot: null, tabs: new Map() },
}));

void mock.module("../src/packages/pull-package-sync.js", () => ({
  autoSyncProjectOnOpen: async () => {},
  isAutomatedPackageDiff: () => false,
  planPackageDiscard: async () => ({ automated: true, discard: [], removeUntracked: [] }),
  pullWithPackageSync: async () => {},
}));

const { setProjectState } = (await import("../src/state.js")) as any;
const { resetProjectShell, shell } = await import("../src/shell.js");
const { cleanupGitPanel, gitPanelValues, mountGitPanel, platformSupportsClone, renderGitPanel } =
  await import("../src/panels/git-panel.js");

/** Stage project-level source-control state — the panel reads nothing else. */
function stageGit(patch: Record<string, unknown>) {
  resetProjectShell();
  shell.leftTab = "git";
  Object.assign(shell.git, patch);
}

/**
 * The Navigator's panel host, as `left-panel.ts` paints it: a `.panel-body` with the
 * `.panel-content` the document is mounted into one level in.
 */
function panelHost(): HTMLElement {
  const body = document.createElement("div");
  body.className = "panel-body";
  const content = document.createElement("div");
  content.className = "panel-content";
  body.append(content);
  document.body.append(body);
  return body;
}

/** The accessible name of one action button — the kit forwards it to the inner control. */
function controlName(panel: HTMLElement, part: string): string | null | undefined {
  return panel.querySelector(`[part="${part}"] [part="control"]`)?.getAttribute("aria-label");
}

/** Mount the panel and let the document — and every kit element in it — settle. */
async function draw(deps: Record<string, unknown> = {}): Promise<HTMLElement> {
  const host = panelHost();
  mountGitPanel(host, deps);
  await flush(6);
  return host.querySelector(".panel-content") as HTMLElement;
}

beforeEach(() => {
  cleanupGitPanel();
  for (const stale of document.querySelectorAll("body > .panel-body")) {
    stale.remove();
  }
  setProjectState(null);
  stageGit({});
  mockPlatform = {
    gitBranches: async () => ({ branches: ["main"], current: "main" }),
    gitLog: async () => [],
    gitStatus: async () => ({
      ahead: 0,
      behind: 0,
      branch: "main",
      files: [],
      isRepo: true,
      remotes: ["origin"],
    }),
  };
});

/** A repository whose read has landed, with whatever the test wants changed about it. */
function seedRepo(status: Record<string, unknown> = {}) {
  setProjectState({ name: "test-project" });
  stageGit({
    branches: { branches: ["main", "dev"], current: "main" },
    status: {
      ahead: 0,
      behind: 0,
      branch: "main",
      files: [],
      isRepo: true,
      remotes: ["origin"],
      ...status,
    },
  });
}

describe("the four moods", () => {
  test("no project — teaches what source control is for", async () => {
    setProjectState(null);
    const panel = await draw();
    const empty = panel.querySelector('[part="empty"][data-view="no-project"]');
    expect(empty?.textContent).toContain("Open a project");
    expect(panel.querySelector('[part="clone"]')).toBeNull();
  });

  test("no project with clone support — offers Clone as a real button", async () => {
    mockPlatform.gitClone = async (_url: string) => ({ ok: true, root: "/tmp/cloned" });
    setProjectState(null);
    const panel = await draw();
    expect(panel.querySelector('[part="clone"]')?.textContent).toContain("Clone Git Repository");
  });

  test("a first read still in flight draws the loading line and nothing else", async () => {
    setProjectState({ name: "test-project" });
    stageGit({ loading: true, status: null });
    const panel = await draw();
    expect(panel.querySelector('[part="status"][data-view="loading"]')).toBeNull();
    // `loading: true` is past the bootstrap branch: the repo body is drawn, busy.
    expect(panel.querySelector('[part="status"][data-status="busy"]')?.textContent).toContain(
      "Loading",
    );
  });

  test("a project git is not tracking offers both ways to start", async () => {
    setProjectState({ name: "test-project" });
    stageGit({
      status: { ahead: 0, behind: 0, branch: "", files: [], isRepo: false, remotes: [] },
    });
    const panel = await draw();
    expect(panel.querySelector('[part="empty"][data-view="no-repo"]')?.textContent).toContain(
      "not tracked by git yet",
    );
    expect(panel.querySelector('[part="init"]')?.textContent).toContain("Initialize Repository");
    expect(panel.querySelector('[part="create-repository"]')?.textContent).toContain(
      "Create GitHub repository",
    );
  });
});

describe("the sync bar", () => {
  test("a repository with no remote says so and offers to make one", async () => {
    seedRepo({ remotes: [] });
    const panel = await draw();
    const bar = panel.querySelector<HTMLElement>('[part="sync-bar"]');
    expect(bar?.dataset.remote).toBe("none");
    expect(bar?.textContent).toContain("Local only");
    expect(panel.querySelector('[part="create-repository"]')).toBeTruthy();
    expect(panel.textContent).not.toContain("Up to date");
  });

  test("a repository with a remote draws the three remote verbs and no publish button", async () => {
    seedRepo();
    const panel = await draw();
    expect(panel.querySelector<HTMLElement>('[part="sync-bar"]')?.dataset.remote).toBe("yes");
    expect(panel.querySelector('[part="sync-label"]')?.textContent).toBe("Up to date");
    for (const part of ["fetch", "pull", "push"]) {
      expect(panel.querySelector(`[part="${part}"]`)).toBeTruthy();
    }
    expect(panel.querySelector('[part="create-repository"]')).toBeNull();
  });

  test("ahead and behind counts reach the label and both button names", async () => {
    seedRepo({ ahead: 3, behind: 1 });
    const panel = await draw();
    expect(panel.querySelector('[part="sync-label"]')?.textContent).toBe("3 ahead, 1 behind");
    // The name is on the control the reader actually reaches, which is where the kit forwards it.
    expect(controlName(panel, "pull")).toBe("Pull (1 behind)");
    expect(controlName(panel, "push")).toBe("Push (3 ahead)");
  });

  test("the last-updated stamp is drawn only once a read has landed", async () => {
    seedRepo();
    const cold = await draw();
    expect(cold.querySelector('[part="sync-time"]')).toBeNull();
    cleanupGitPanel();
    shell.git.lastUpdated = Date.parse("2024-05-01T14:04:00Z");
    const stamped = await draw();
    expect(stamped.querySelector('[part="sync-time"]')?.textContent).toContain("Last updated");
  });
});

describe("the changed files", () => {
  test("each file is one keyed row, with its status as a letter and in words", async () => {
    seedRepo({
      files: [
        { path: "src/index.js", staged: false, status: "M" },
        { path: "src/util.js", staged: true, status: "A" },
      ],
    });
    const panel = await draw();
    const modified = panel.querySelector('[part="file-row"][data-path="src/index.js"]');
    expect(modified?.querySelector('[part="file-name"]')?.textContent).toBe("index.js");
    expect(modified?.querySelector('[part="file-dir"]')?.textContent).toBe("src");
    expect(modified?.querySelector('[part="badge"][data-status]')?.textContent).toBe("M");
    expect(modified?.querySelector('[part="file-open"]')?.getAttribute("aria-label")).toBe(
      "src/index.js, modified",
    );
    // A staged file is listed twice — under Staged Changes and under its component.
    expect(panel.querySelectorAll('[part="file-row"][data-path="src/util.js"]').length).toBe(2);
    expect(
      panel.querySelector('[part="section"][data-section="staged"] [part="section-title"]')
        ?.textContent,
    ).toBe("Staged Changes");
  });

  test("a file at the project root draws no directory", async () => {
    seedRepo({ files: [{ path: "README.md", staged: false, status: "M" }] });
    const panel = await draw();
    const row = panel.querySelector('[part="file-row"][data-path="README.md"]');
    expect(row?.querySelector('[part="file-name"]')?.textContent).toBe("README.md");
    expect(row?.querySelector('[part="file-dir"]')).toBeNull();
  });

  test("an empty working tree teaches what lands here, and offers no Stage all", async () => {
    seedRepo();
    const panel = await draw();
    expect(panel.querySelector('[part="empty-message"][data-empty="changes"]')?.textContent).toBe(
      "Nothing to commit. Files you edit and save show up here.",
    );
    expect(panel.querySelector('[part="stage-all"]')).toBeNull();
    expect(panel.querySelector('[part="section"][data-section="staged"]')).toBeNull();
  });

  test("the commit form carries the region the screenshot pipeline addresses", async () => {
    seedRepo();
    const panel = await draw();
    expect(panel.querySelector<HTMLElement>('[part="commit"]')?.dataset.jxRegion).toBe(
      "navigator/panel:git/commit",
    );
  });
});

describe("the projection on its own", () => {
  test("groups files by component, with anything unrenderable under Other", () => {
    seedRepo({
      files: [
        { path: "components/card.json", staged: false, status: "M" },
        { path: "scripts/build.ts", staged: false, status: "M" },
        { path: "top.json", staged: true, status: "A" },
      ],
    });
    expect(gitPanelValues().groups.map((group) => group.key)).toEqual([
      "/top.json",
      "/components",
      "Other",
    ]);
  });

  test("the branch picker always offers a row that mints a new branch", () => {
    seedRepo();
    const values = gitPanelValues();
    expect(values.branchOptions.map((option) => option.value)).toEqual(["main", "dev", "__new__"]);
    expect(values.branchValue).toBe("main");
    expect(values.branchName).toBe("main");
  });

  test("a repository with no branches at all still names its checked-out one", () => {
    setProjectState({ name: "p" });
    stageGit({
      branches: null,
      status: { ahead: 0, behind: 0, branch: "trunk", files: [], isRepo: true, remotes: [] },
    });
    const values = gitPanelValues();
    expect(values.branchName).toBe("trunk");
    expect(values.branchValue).toBe("");
  });

  test("a repository with neither reads as an em dash rather than as nothing", () => {
    setProjectState({ name: "p" });
    stageGit({
      branches: null,
      status: { ahead: 0, behind: 0, branch: "", files: [], isRepo: true, remotes: [] },
    });
    expect(gitPanelValues().branchName).toBe("—");
  });

  test("the changes tab prints its count only when there is one", () => {
    seedRepo();
    expect(gitPanelValues().changesLabel).toBe("Local Changes");
    shell.git.status!.files = [{ path: "a.json", staged: false, status: "M" }];
    expect(gitPanelValues().changesLabel).toBe("Local Changes (1)");
  });

  test("an error is projected as both a flag and a sentence", () => {
    seedRepo();
    shell.git.error = "broken pipe";
    const values = gitPanelValues();
    expect(values.hasError).toBe(true);
    expect(values.error).toBe("broken pipe");
  });
});

describe("platformSupportsClone", () => {
  test("returns true when the platform has gitClone", () => {
    mockPlatform = { gitClone: async (_url: string) => ({ ok: true, root: "" }) };
    expect(platformSupportsClone()).toBe(true);
  });

  test("returns false when it does not", () => {
    mockPlatform = {};
    expect(platformSupportsClone()).toBe(false);
  });
});

test("a panel taken down while its mount is still in flight leaves nothing behind", async () => {
  // The Navigator can paint another panel one tick after this one — or a project can close — so the
  // Mount that lands afterwards has to dispose itself rather than appear in a container nobody is
  // Looking at.
  setProjectState({ name: "test-project" });
  stageGit({
    status: { ahead: 0, behind: 0, branch: "main", files: [], isRepo: true, remotes: [] },
  });
  const host = panelHost();
  mountGitPanel(host, {});
  cleanupGitPanel();
  await flush(6);
  expect(host.querySelector('[part="git-panel"]')).toBeNull();
});

test("the lit renderer is a stub the Navigator no longer draws through", () => {
  // It survives only because `NavigatorPanelDeps` still declares the injection.
  expect(renderGitPanel({})).toBeDefined();
});
