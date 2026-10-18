/**
 * The Publish workspace, `src/publish/publish-workspace.ts` over
 * `src/surfaces/publish-workspace.json` (studio.md §22.8): Review changes, Deploys, Branches and
 * Hosting.
 *
 * The workspace is drawn the way the canvas draws a home, into a stage, and every control is
 * addressed by `part` and by the `data-*` the document stamps on it. Every verb behind a control is
 * somebody else's (source control's, publishing's, a command record's), so the assertions are about
 * what reached the platform, the shell record or the registry.
 */
import { flush, installMockPlatform, resetStudioState, setValue, surfaceOf } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { GitStatusResult, StudioPlatform } from "../src/types";
import type { AnyCommand } from "../src/commands/registry";

const compared: string[] = [];
void mock.module("../src/panels/git-diff-open.js", () => ({
  comparisonRefusal: () => null,
  openComparisonTab: async (path: string) => {
    compared.push(path);
    return null;
  },
}));

let confirmAnswer = true;
let promptAnswer: string | null = null;
/* The real layer module, with its two answers stood in: the workspace reaches the whole overlay
   stack through the kit, so a mock of four names would be a load error rather than a double. */
const realLayers = await import("../src/ui/layers");
void mock.module("../src/ui/layers.js", () => ({
  ...realLayers,
  showConfirmDialog: async () => confirmAnswer,
  showPromptDialog: async () => promptAnswer,
}));

const { createCommandRegistry } = await import("../src/commands/registry");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { makeContext } = await import("../src/commands/context");
const { resetProjectShell, shell } = await import("../src/shell");
const { setPreviewNavigateHandler } = await import("../src/canvas/preview-navigate");
const { beginActivity, resetActivities } = await import("../src/panels/activity-panel");
const { forgetDeployment } = await import("../src/publish/deploy-checklist");
const { cleanupSourceControl } = await import("../src/publish/source-control");
const { openWorkspaceHome } = await import("../src/workspace/workspace-home");
const { closeAllTabs } = await import("../src/workspace/workspace");
const pw = await import("../src/publish/publish-workspace");

const DEPLOY = {
  accountId: "a".repeat(32),
  productionUrl: "https://my-site.pages.dev",
  projectName: "my-site",
  provider: "cloudflare-pages" as const,
};

function repo(files: GitStatusResult["files"], extra: Partial<GitStatusResult> = {}) {
  return {
    ahead: 1,
    behind: 2,
    branch: "main",
    files,
    isRepo: true,
    remotes: ["origin"],
    ...extra,
  } satisfies GitStatusResult;
}

const FILES: GitStatusResult["files"] = [
  { path: "pages/index.json", staged: true, status: "M" },
  { path: "pages/about.json", staged: false, status: "U" },
];

let calls: unknown[][] = [];
let current: GitStatusResult = repo(FILES);

/** A platform member that records its calls beside the harness's own, for the defaults below. */
function logged<A extends unknown[], R>(name: string, fn: (...args: A) => R) {
  return (...args: A): R => {
    calls.push([name, ...args]);
    return fn(...args);
  };
}

function install(overrides: Partial<StudioPlatform> = {}) {
  const installed = installMockPlatform(
    {
      gitBranches: logged("gitBranches", async () => ({
        branches: ["main", "feature"],
        current: "main",
      })),
      gitLog: async () => [
        { author: "ada", date: "2026-01-01T00:00:00Z", hash: "abcdef1234", message: "First" },
      ],
      gitStatus: logged("gitStatus", async () => current),
      ...overrides,
    },
    { "pages/about.json": "{}", "pages/index.json": "{}" },
  );
  ({ calls } = installed.state);
  return installed;
}

const ran: { id: string; args: unknown }[] = [];

/** A registry carrying stand-ins for every record the workspace draws a button for. */
function registry(disabled: readonly string[] = []) {
  const reg = createCommandRegistry({ getContext: () => makeContext({ project: { open: true } }) });
  const ids = [
    "git.init",
    "git.createGithubRepository",
    "git.push",
    "git.signInToGithub",
    "publish.setUp",
    "publish.deploy",
    "publish.openDashboard",
  ];
  for (const id of ids) {
    const record: AnyCommand = {
      category: "Publish",
      enablement: () => !disabled.includes(id),
      id,
      level: "project",
      requires: "a reason",
      run: (_ctx, args) => {
        ran.push({ args, id });
      },
      title: `Run ${id}`,
    };
    reg.register(record);
  }
  setActiveRegistry(reg);
  return reg;
}

let host: HTMLElement;

/** Draw the Publish home into a fresh stage and let the document settle. */
async function draw(): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  pw.renderPublishWorkspace(surfaceOf(host), openWorkspaceHome("publish"));
  await flush(6);
  return host.querySelector<HTMLElement>('[part="publish"]')!;
}

const part = (name: string) => host.querySelector<HTMLElement>(`[part="${name}"]`);
const parts = (name: string) => [...host.querySelectorAll<HTMLElement>(`[part="${name}"]`)];
const asked = () => calls.map(([name]) => name);

beforeEach(async () => {
  resetProjectShell();
  forgetDeployment();
  resetActivities();
  closeAllTabs();
  resetStudioState({ name: "Demo", projectConfig: { name: "Demo" }, projectRoot: "/p" });
  current = repo(FILES);
  install();
  registry();
  ran.length = 0;
  compared.length = 0;
  confirmAnswer = true;
  promptAnswer = null;
  // The first read, as the workspace's own mount would start it.
  const { refreshGitStatus } = await import("../src/publish/source-control");
  await refreshGitStatus();
  calls.length = 0;
});

afterEach(() => {
  pw.detachPublishWorkspace("primary");
  cleanupSourceControl();
  setActiveRegistry(null);
  setPreviewNavigateHandler(null);
  closeAllTabs();
  document.body.textContent = "";
});

// ─── The frame ───────────────────────────────────────────────────────────────

describe("the frame", () => {
  test("stamps its region, names itself, and lists the four sub-tabs with the count", async () => {
    const root = await draw();
    expect(root.dataset.jxRegion).toBe("pane.primary/publish");
    expect(root.getAttribute("aria-labelledby")).toBe(part("heading")!.id);
    expect(parts("tab").map((tab) => tab.getAttribute("label"))).toEqual([
      "Review changes (2)",
      "Deploys",
      "Branches",
      "Hosting",
    ]);
    expect(part("headline")?.textContent).toBe("On main · 2 changes to publish");
    expect(pw.publishWorkspaceMounted("primary", openWorkspaceHome("publish"))).toBe(true);
  });

  test("a sub-tab is chosen through the strip, and an unknown one is ignored", async () => {
    await draw();
    const tabs = part("tabs")!;
    tabs.dispatchEvent(new CustomEvent("change", { detail: "branches" }));
    await flush(4);
    expect(shell.publish.tab).toBe("branches");
    expect(part("branches")).not.toBeNull();
    tabs.dispatchEvent(new CustomEvent("change", { detail: "nowhere" }));
    await flush(2);
    expect(shell.publish.tab).toBe("branches");
  });

  test("detaching takes it down, and is idempotent", async () => {
    await draw();
    pw.detachPublishWorkspace("primary");
    pw.detachPublishWorkspace("primary");
    await flush(2);
    expect(part("publish")).toBeNull();
  });

  test("the first mount starts the first read when nothing has been read", async () => {
    resetProjectShell();
    await draw();
    await flush(4);
    expect(asked()).toContain("gitStatus");
  });
});

// ─── Review changes ──────────────────────────────────────────────────────────

describe("Review changes", () => {
  test("with no project open it says what publishing is for, and clones where it can", async () => {
    let cloned = 0;
    const { setSourceControlDeps } = await import("../src/publish/source-control");
    setSourceControlDeps({
      cloneRepository: () => {
        cloned += 1;
      },
    });
    install({ gitClone: async () => ({ ok: true, root: "/x" }) });
    const { setProjectState } = await import("../src/state");
    setProjectState(null);
    await draw();
    expect(part("empty-message")?.textContent).toMatch(/^Open a project to publish it\./);
    part("clone")!.click();
    expect(cloned).toBe(1);
    setSourceControlDeps({});
  });

  test("draws the change list grouped, each row naming its controls after the file", async () => {
    await draw();
    expect(parts("group-name").map((name) => name.textContent)).toEqual(["/pages"]);
    expect(parts("file-name").map((name) => name.textContent)).toEqual([
      "index.json",
      "about.json",
    ]);
    expect(part("included")?.textContent).toBe("1 of 2 included");
    const include = host.querySelector<HTMLElement>(
      '[part="include"][data-path="pages/index.json"]',
    );
    expect(
      include?.getAttribute("label") ?? include?.querySelector("input")?.getAttribute("aria-label"),
    ).toBe("Include pages/index.json");
    expect(part("sync-label")?.textContent).toBe("1 ahead, 2 behind");
  });

  test("a checkbox includes or leaves out its file, and Include all takes every one", async () => {
    await draw();
    const box = host.querySelector<HTMLInputElement>(
      '[part="include"][data-path="pages/about.json"] input',
    )!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(2);
    // The last one: the first is Review changes including what it had not shown before.
    expect(calls.findLast(([name]) => name === "gitStage")).toEqual([
      "gitStage",
      ["pages/about.json"],
    ]);
    const all = host.querySelector<HTMLInputElement>('[part="include-all"] input')!;
    all.checked = false;
    all.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(2);
    expect(calls.find(([name]) => name === "gitUnstage")).toEqual([
      "gitUnstage",
      ["pages/index.json"],
    ]);
  });

  test("Before and after opens the comparison; Discard asks and discards", async () => {
    await draw();
    host.querySelector<HTMLElement>('[part="compare"][data-path="pages/index.json"]')!.click();
    await flush(4);
    expect(compared).toEqual(["pages/index.json"]);
    host.querySelector<HTMLElement>('[part="discard"][data-path="pages/index.json"]')!.click();
    await flush(4);
    expect(calls.find(([name]) => name === "gitDiscard")).toEqual([
      "gitDiscard",
      ["pages/index.json"],
    ]);
  });

  test("the sync verbs run from the bar, Push as its record", async () => {
    await draw();
    for (const name of ["refresh", "fetch", "pull", "push"]) {
      part(name)!.click();
      await flush(2);
    }
    expect(asked()).toEqual(expect.arrayContaining(["gitStatus", "gitFetch"]));
    expect(ran.map((entry) => entry.id)).toEqual(["git.push"]);
  });

  test("with no remote, Create GitHub repository runs its record", async () => {
    current = repo(FILES, { remotes: [] });
    const { refreshGitStatus } = await import("../src/publish/source-control");
    await refreshGitStatus();
    await draw();
    part("create-repository")!.click();
    expect(ran.map((entry) => entry.id)).toEqual(["git.createGithubRepository"]);
  });

  test("the destination card is stamped as its own region; Send for review is refused here", async () => {
    await draw();
    const destination = host.querySelector<HTMLElement>(
      '[data-jx-region="pane.primary/publish/commit"]',
    );
    expect(destination?.getAttribute("part")).toBe("destination");
    const review = host.querySelector<HTMLElement>(
      '[part="destination-card"][data-destination="review"]',
    );
    review!.click();
    await flush(4);
    expect(shell.publish.destination).toBe("review");
    expect(part("refusal")?.textContent).toMatch(/cannot open a pull request/);
    // The button never names a destination this host refuses.
    expect(part("publish-button")?.dataset.destination).toBe("live");
  });

  test("the summary is the commit message, and Publish commits and pushes", async () => {
    await draw();
    expect(part("blocker")?.textContent).toBe("Write a summary of the change first.");
    const field = host.querySelector<HTMLTextAreaElement>('[part="summary"] textarea')!;
    setValue(field, "Fix the header");
    await flush(4);
    expect(shell.git.commitMessage).toBe("Fix the header");
    expect(part("blocker")).toBeNull();
    expect(part("publish-button")?.textContent.trim()).toBe("Commit and push");
    part("publish-button")!.click();
    await flush(6);
    expect(asked()).toEqual(expect.arrayContaining(["gitCommit", "gitPush"]));
  });

  test("the checks name the next deploy step and run its command", async () => {
    await draw();
    const deploy = host.querySelector<HTMLElement>('[part="check"][data-check="deploy"]')!;
    // One commit is not on the remote yet, so the next link of the chain is the push.
    expect(deploy.dataset.state).toBe("todo");
    expect(deploy.querySelector('[part="check-text"]')?.textContent).toMatch(/^Push to a remote: /);
    deploy.querySelector<HTMLElement>('[part="check-action"]')!.click();
    await flush(2);
    expect(ran.map((entry) => entry.id)).toEqual(["git.push"]);
  });

  test("a build check is offered where the host can build, and runs", async () => {
    install({ buildSite: async () => ({ errors: [], files: 1, routes: 3 }) });
    await draw();
    host
      .querySelector<HTMLElement>('[part="check"][data-check="build"] [part="check-action"]')!
      .click();
    await flush(6);
    expect(
      host.querySelector('[part="check"][data-check="build"] [part="check-text"]')?.textContent,
    ).toBe("Site builds: 3 page(s).");
  });

  test("the recent commits are read the first time Review changes is shown", async () => {
    await draw();
    await flush(4);
    expect(part("history-message")?.textContent).toBe("First");
  });

  test("the moods: no project, no repository, nothing to publish", async () => {
    current = { ...repo([]), isRepo: false };
    const { refreshGitStatus } = await import("../src/publish/source-control");
    await refreshGitStatus();
    await draw();
    // Initialize is the one way forward offered, as its record: nothing here creates a GitHub
    // Repository for a project git does not track (studio-ui-guidelines.md §12.5).
    expect(part("create-repository")).toBeNull();
    part("init")!.click();
    await flush(2);
    expect(ran.map((entry) => entry.id)).toEqual(["git.init"]);
    pw.detachPublishWorkspace("primary");

    current = repo([]);
    await refreshGitStatus();
    await draw();
    expect(part("empty-message")?.textContent).toMatch(/^Nothing to publish\./);
    expect(part("headline")?.textContent).toBe("On main · nothing to publish");
  });

  test("an error is the workspace's one failure line", async () => {
    await draw();
    shell.git.error = "index.lock exists";
    await flush(2);
    expect(part("failure")?.textContent).toBe("index.lock exists");
  });
});

// ─── Deploys ─────────────────────────────────────────────────────────────────

describe("Deploys", () => {
  test("with no host that can reach Cloudflare, it says so and lists nothing", async () => {
    shell.publish.tab = "deploys";
    await draw();
    expect(part("deploys")).not.toBeNull();
    expect(part("live-none")?.textContent).toMatch(/^No host is connected\./);
    expect(
      host.querySelector('[part="deploy-history"] [part="empty-message"]')?.textContent,
    ).toMatch(/cannot reach the Cloudflare API/);
  });

  test("lists every deployment, the previews apart, and opens one outside Studio", async () => {
    const urls: string[] = [];
    setPreviewNavigateHandler((url) => {
      urls.push(url);
    });
    install({
      cfApi: async () => [
        {
          created_on: "2026-01-01T00:00:00Z",
          deployment_trigger: { metadata: { branch: "studio/pricing" } },
          environment: "preview",
          id: "d2",
          latest_stage: { name: "deploy", status: "success" },
          url: "https://d2.my-site.pages.dev",
        },
        {
          created_on: "2026-01-01T00:00:00Z",
          environment: "production",
          id: "d1",
          latest_stage: { name: "deploy", status: "success" },
          url: "https://d1.my-site.pages.dev",
        },
      ],
    });
    resetStudioState({ name: "Demo", projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    shell.publish.tab = "deploys";
    await draw();
    await flush(6);
    expect(part("live-url")?.textContent).toBe("https://my-site.pages.dev");
    expect(part("live-summary")?.textContent).toMatch(/· deploy: success$/);
    expect(parts("deployment-label").map((label) => label.textContent)).toEqual([
      "studio/pricing",
      "Production",
      "studio/pricing",
    ]);
    part("open-deployment")!.click();
    part("visit")!.click();
    expect(urls).toEqual(["https://d2.my-site.pages.dev", "https://my-site.pages.dev"]);
    host.querySelector<HTMLElement>('[part="command"][data-command="publish.deploy"]')!.click();
    expect(ran.map((entry) => entry.id)).toEqual(["publish.deploy"]);
  });

  test("a host that does not answer is said in words, and Refresh asks again", async () => {
    let asks = 0;
    install({
      cfApi: async () => {
        asks += 1;
        throw new Error("401");
      },
    });
    resetStudioState({ name: "Demo", projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    shell.publish.tab = "deploys";
    await draw();
    await flush(6);
    expect(host.querySelector('[part="deploy-history"] [part="empty-message"]')?.textContent).toBe(
      "The host did not answer: 401",
    );
    part("reload-deploys")!.click();
    await flush(4);
    expect(asks).toBe(2);
  });

  test("a deploy in progress shows its steps", async () => {
    beginActivity({
      source: "Publish",
      steps: ["Push to the remote", "Ask Cloudflare for the deployment"],
      title: "Deploy",
    }).step("Push to the remote");
    shell.publish.tab = "deploys";
    await draw();
    expect(part("activity-title")?.textContent).toBe("Deploy");
    expect(parts("activity-step").map((step) => step.dataset.state)).toEqual([
      "running",
      "pending",
    ]);
  });
});

// ─── Branches ────────────────────────────────────────────────────────────────

describe("Branches", () => {
  test("lists the branches, the current one with its sync, and switches another", async () => {
    shell.publish.tab = "branches";
    await draw();
    expect(parts("branch-name").map((name) => name.textContent)).toEqual(["main", "feature"]);
    expect(part("branch-sync")?.textContent).toBe("1 ahead, 2 behind");
    host.querySelector<HTMLElement>('[part="switch"][data-branch="feature"]')!.click();
    await flush(4);
    expect(calls.find(([name]) => name === "gitCheckout")).toEqual(["gitCheckout", "feature"]);
  });

  test("New branch asks for a name; on the cloud a switch says it reloads", async () => {
    install({ gitHosted: true });
    shell.publish.tab = "branches";
    await draw();
    expect(part("branch-note")?.textContent).toMatch(/reloads Studio/);
    expect(part("switch")?.textContent.trim()).toBe("Switch and reload");
    promptAnswer = "studio/new";
    part("new-branch")!.click();
    await flush(4);
    expect(calls.find(([name]) => name === "gitCreateBranch")).toEqual([
      "gitCreateBranch",
      "studio/new",
    ]);
  });
});

// ─── Hosting ─────────────────────────────────────────────────────────────────

describe("Hosting", () => {
  test("says where the project is saved and hosted, with each source command as a button", async () => {
    shell.publish.tab = "hosting";
    await draw();
    expect(part("hosting")).not.toBeNull();
    expect(parts("hosting-summary")[0]?.textContent).toBe(
      "Saved in git and pushed to origin, on main.",
    );
    expect(part("host-name")?.textContent).toBe("Another host");
    const commands = parts("command").map((button) => button.dataset.command);
    expect(commands).toEqual([
      "git.push",
      "git.signInToGithub",
      "publish.setUp",
      "publish.openDashboard",
    ]);
    host.querySelector<HTMLElement>('[part="command"][data-command="publish.setUp"]')!.click();
    expect(ran.at(-1)?.id).toBe("publish.setUp");
  });

  test("the build adapter is the Deploy section, mounted into its island", async () => {
    shell.publish.tab = "hosting";
    await draw();
    await flush(4);
    expect(host.querySelector('[part="adapter-island"] [part="adapter"]')).not.toBeNull();
  });

  test("a refused command is drawn disabled with its reason", async () => {
    registry(["publish.setUp"]);
    shell.publish.tab = "hosting";
    await draw();
    const setUp = host.querySelector<HTMLElement>('[part="command"][data-command="publish.setUp"]');
    expect(setUp?.getAttribute("title")).toBe("Run publish.setUp: requires a reason");
  });

  test("the host block says which host this is before one is connected", async () => {
    install({ cfApi: async () => [], cfConnect: async () => null });
    shell.publish.tab = "hosting";
    await draw();
    expect(part("host-name")?.textContent).toBe("Jx Cloud, on Cloudflare");
    pw.detachPublishWorkspace("primary");
    install({ cfApi: async () => [] });
    await draw();
    expect(part("host-name")?.textContent).toBe("Your Cloudflare account");
    expect(part("hosting-summary")).not.toBeNull();
  });

  test("Deploys with a reachable host and no provider says to connect one", async () => {
    install({ cfApi: async () => [] });
    shell.publish.tab = "deploys";
    await draw();
    expect(host.querySelector('[part="deploy-history"] [part="empty-message"]')?.textContent).toBe(
      "Connect a host under Hosting, and every deployment it makes is listed here.",
    );
  });

  test("where the project is saved follows the repository's state", async () => {
    shell.publish.tab = "hosting";
    current = repo(FILES, { remotes: [] });
    const { refreshGitStatus } = await import("../src/publish/source-control");
    await refreshGitStatus();
    await draw();
    expect(parts("hosting-summary")[0]?.textContent).toMatch(/^Saved in git on this machine only/);
    expect(parts("command").map((button) => button.dataset.command)).toContain(
      "git.createGithubRepository",
    );
    pw.detachPublishWorkspace("primary");
    install({ gitHosted: true });
    current = repo(FILES);
    await refreshGitStatus();
    await draw();
    expect(parts("hosting-summary")[0]?.textContent).toMatch(/^Saved on GitHub \(origin\)/);
    pw.detachPublishWorkspace("primary");
    current = { ...repo([]), isRepo: false };
    await refreshGitStatus();
    await draw();
    expect(parts("hosting-summary")[0]?.textContent).toMatch(/^Not tracked by git yet/);
    expect(parts("command").map((button) => button.dataset.command)[0]).toBe("git.init");
  });

  test("a connected host names its project and its address, and the checklist follows", async () => {
    install({ cfApi: async () => [] });
    resetStudioState({ name: "Demo", projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    shell.publish.tab = "hosting";
    await draw();
    expect(part("host-name")?.textContent).toBe("Cloudflare Pages: my-site");
    expect(part("live-url")?.textContent).toBe("https://my-site.pages.dev");
    expect(parts("checklist-step").map((step) => step.dataset.step)).toEqual([
      "repo",
      "remote",
      "provider",
      "deployed",
    ]);
  });

  /* The picker is the Deploy section's own surface, mounted into a node of this document, so it
     does not follow this document's state. An adapter changed elsewhere (Raw JSON, the Code view,
     a collaborator) reaches it on the workspace's next projection. */
  test("the build adapter follows project.json when it is changed elsewhere", async () => {
    resetStudioState({
      name: "Demo",
      projectConfig: { build: { adapter: "static" }, name: "Demo" },
    });
    shell.publish.tab = "hosting";
    await draw();
    await flush(4);
    const picker = () =>
      host.querySelector<HTMLElement & { value?: string }>(
        '[part="adapter-island"] [part="adapter"]',
      );
    expect(picker()?.value).toBe("static");
    const { projectState } = await import("../src/state");
    projectState!.projectConfig!.build = { adapter: "bun" };
    shell.git.commitMessage = "anything the projection reads";
    await flush(4);
    expect(picker()?.value).toBe("bun");
  });

  test("Hosting drawn again mounts the adapter afresh, and detaching takes it down", async () => {
    shell.publish.tab = "hosting";
    await draw();
    await flush(4);
    host.querySelector<HTMLElement>('[part="tab"][data-tab="review"]')?.click();
    pw.showPublishTab("review");
    await flush(4);
    pw.showPublishTab("hosting");
    await flush(4);
    expect(host.querySelectorAll('[part="adapter-island"] [part="adapter"]')).toHaveLength(1);
    pw.detachPublishWorkspace("primary");
    expect(host.querySelector('[part="adapter"]')).toBeNull();
  });
});

// ─── The fixes the review asked for ─────────────────────────────────────────

describe("Review changes includes what it shows for the first time", () => {
  /** A platform whose index really moves, so the status after a stage says what was staged. */
  function staging() {
    install({
      gitStage: logged("gitStage", async (paths: string[]) => {
        current = repo(
          current.files.map((file) =>
            paths.includes(file.path) ? { ...file, staged: true } : file,
          ),
        );
      }),
      gitUnstage: logged("gitUnstage", async (paths: string[]) => {
        current = repo(
          current.files.map((file) =>
            paths.includes(file.path) ? { ...file, staged: false } : file,
          ),
        );
      }),
    });
  }

  test("an untouched change set opens with every change included, as the board draws it", async () => {
    staging();
    await draw();
    await flush(6);
    expect(calls.filter(([name]) => name === "gitStage")).toEqual([
      ["gitStage", ["pages/about.json"]],
    ]);
    expect(part("included")?.textContent).toBe("2 of 2 included");
  });

  test("a file the author leaves out stays out; a new change is included", async () => {
    staging();
    await draw();
    await flush(6);
    const box = host.querySelector<HTMLInputElement>(
      '[part="include"][data-path="pages/about.json"] input',
    )!;
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(6);
    expect(part("included")?.textContent).toBe("1 of 2 included");
    current = repo([...current.files, { path: "pages/new.json", staged: false, status: "U" }]);
    const { refreshGitStatus } = await import("../src/publish/source-control");
    await refreshGitStatus();
    await flush(6);
    expect(calls.filter(([name]) => name === "gitStage")).toEqual([
      ["gitStage", ["pages/about.json"]],
      ["gitStage", ["pages/new.json"]],
    ]);
    expect(part("included")?.textContent).toBe("2 of 3 included");
  });

  test("on another sub-tab nothing is staged", async () => {
    staging();
    shell.publish.tab = "branches";
    await draw();
    await flush(6);
    expect(asked()).not.toContain("gitStage");
  });
});

describe("the destination cards", () => {
  test("exactly the chosen card is a checked radio, drawn selected", async () => {
    await draw();
    const card = (value: string) =>
      host.querySelector<HTMLElement>(`[part="destination-card"][data-destination="${value}"]`)!;
    const radio = (value: string) => card(value).querySelector<HTMLElement>('[role="radio"]');
    expect(radio("live")?.getAttribute("aria-checked")).toBe("true");
    expect(radio("review")?.getAttribute("aria-checked")).toBe("false");
    expect(card("live").dataset.selected).toBe("");
    expect(card("review").dataset.selected).toBeUndefined();
  });
});

describe("Deploys, kept current", () => {
  const ROW = (id: string, createdOn: string, environment = "production", status = "success") => ({
    created_on: createdOn,
    environment,
    id,
    latest_stage: { name: status === "active" ? "build" : "deploy", status },
    url: `https://${id}.my-site.pages.dev`,
  });
  type Row = ReturnType<typeof ROW>;

  test("each deployment says its state in words, with what the host reported as its tooltip", async () => {
    install({
      cfApi: async () => [
        ROW("d5", "2026-01-05T00:00:00Z", "production", "failure"),
        ROW("d4", "2026-01-04T00:00:00Z", "production", "active"),
        ROW("d3", "2026-01-03T00:00:00Z", "production", "canceled"),
        ROW("d2", "2026-01-02T00:00:00Z"),
        ROW("d1", "2026-01-01T00:00:00Z"),
        ROW("p1", "2026-01-01T00:00:00Z", "preview"),
      ],
    });
    resetStudioState({ name: "Demo", projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    shell.publish.tab = "deploys";
    await draw();
    await flush(6);
    const history = [
      ...host.querySelectorAll<HTMLElement>('[part="deploy-history"] [part="deployment-status"]'),
    ];
    expect(history.map((status) => status.textContent)).toEqual([
      "Failed",
      "Building…",
      "Canceled",
      "Live",
      "Replaced",
      "Ready",
    ]);
    expect(history[3]?.getAttribute("title")).toBe("deploy: success");
    expect(history[1]?.getAttribute("title")).toBe("build: active");
  });

  test("an answer that arrives after a project switch is dropped, never observed", async () => {
    let answer: (rows: Row[]) => void = () => {};
    install({
      cfApi: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    resetStudioState({ name: "Demo", projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    const loading = pw.loadDeployments();
    expect(shell.publish.deploys.state).toBe("loading");
    resetProjectShell();
    answer([ROW("old", "2026-01-01T00:00:00Z")]);
    await loading;
    expect([
      shell.publish.deploys.project,
      shell.publish.deploys.rows,
      shell.publish.deploys.state,
    ]).toEqual(["", [], "idle"]);
    const { observedDeployment } = await import("../src/publish/deploy-checklist");
    expect(observedDeployment()).toBeNull();
  });

  test("…and so is one about a Pages project the config no longer names", async () => {
    let answer: (rows: Row[]) => void = () => {};
    install({
      cfApi: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    resetStudioState({ name: "Demo", projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    const loading = pw.loadDeployments();
    const { projectState } = await import("../src/state");
    projectState!.projectConfig!.build = { deploy: { ...DEPLOY, projectName: "other" } };
    answer([ROW("old", "2026-01-01T00:00:00Z")]);
    await loading;
    // Settled, so the next read is not refused as one already in flight.
    expect(shell.publish.deploys.state).toBe("idle");
    expect(shell.publish.deploys.rows).toEqual([]);
  });

  test("…a failure after a switch is dropped the same way", async () => {
    let fail: (error: Error) => void = () => {};
    install({
      cfApi: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    });
    resetStudioState({ name: "Demo", projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    const loading = pw.loadDeployments();
    resetProjectShell();
    fail(new Error("401"));
    await loading;
    expect(shell.publish.deploys).toMatchObject({ error: "", state: "idle" });
  });

  test("a deploy that finishes after the list was read makes Deploys read it again", async () => {
    let asks = 0;
    install({
      cfApi: async () => {
        asks += 1;
        return asks === 1
          ? [ROW("d1", "2026-01-01T00:00:00Z")]
          : [ROW("d2", "2026-01-02T00:00:00Z"), ROW("d1", "2026-01-01T00:00:00Z")];
      },
    });
    resetStudioState({ name: "Demo", projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    shell.publish.tab = "deploys";
    await draw();
    await flush(6);
    expect(asks).toBe(1);
    const { noteDeployment } = await import("../src/publish/deploy-checklist");
    noteDeployment({
      createdOn: "2026-01-02T00:00:00Z",
      environment: "production",
      id: "d2",
      stage: "deploy",
      status: "success",
      url: "https://d2.my-site.pages.dev",
    });
    await flush(8);
    expect(asks).toBe(2);
    expect(shell.publish.deploys.rows.map((row) => row.id)).toEqual(["d2", "d1"]);
  });

  test("the live line names the newer of the listed and the observed deployment", async () => {
    resetStudioState({ name: "Demo", projectConfig: { build: { deploy: DEPLOY }, name: "Demo" } });
    install({ cfApi: async () => [] });
    shell.publish.deploys.project = "my-site";
    shell.publish.deploys.state = "loaded";
    shell.publish.deploys.rows = [
      {
        createdOn: "2026-01-01T00:00:00Z",
        environment: "production",
        id: "d1",
        stage: "deploy",
        status: "success",
        url: "u1",
      },
    ];
    const { noteDeployment } = await import("../src/publish/deploy-checklist");
    noteDeployment({
      branch: "main",
      createdOn: "2026-01-02T00:00:00Z",
      environment: "production",
      id: "d2",
      stage: "deploy",
      status: "success",
      url: "u2",
    });
    expect(pw.publishWorkspaceView("pane.primary/publish").liveSummary).toMatch(/ from main · /);
    // An observed preview never stands in for the live site while a production row is listed.
    noteDeployment({
      branch: "studio/x",
      createdOn: "2026-01-03T00:00:00Z",
      environment: "preview",
      id: "p1",
      stage: "deploy",
      status: "success",
      url: "u3",
    });
    expect(pw.publishWorkspaceView("pane.primary/publish").liveSummary).not.toMatch(/studio\/x/);
  });
});

describe("Branches, named for a screen reader", () => {
  test("each switch button is named after its branch", async () => {
    shell.publish.tab = "branches";
    await draw();
    const button = host.querySelector<HTMLElement>('[part="switch"][data-branch="feature"]')!;
    expect(
      button.getAttribute("label") ?? button.querySelector("button")?.getAttribute("aria-label"),
    ).toBe("Switch to feature");
  });

  test("…and on the cloud, says it reloads", async () => {
    install({ gitHosted: true });
    shell.publish.tab = "branches";
    await draw();
    const button = host.querySelector<HTMLElement>('[part="switch"][data-branch="feature"]')!;
    expect(
      button.getAttribute("label") ?? button.querySelector("button")?.getAttribute("aria-label"),
    ).toBe("Switch to feature and reload");
  });
});
