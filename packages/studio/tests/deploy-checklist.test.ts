/**
 * Deploy checklist tests — the ordered prerequisite chain, its three states, the status-bar item
 * whose label IS the next blocking step, and the Activity-tab surface
 * (`src/surfaces/panel-deploy-checklist.json`).
 *
 * The rendering half is addressed by `part` and `data-state`, never by a class: the checklist is a
 * document now, and `.activity-row--running` is a name nothing writes any more.
 *
 * The assertion that matters most is the `unknown` one: "Cloudflare reports no deployments" and
 * "nobody has asked Cloudflare" are different sentences, and collapsing them is how a checklist
 * tells a user to redo a deploy that already succeeded.
 */
import { flush, installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { GitStatusResult } from "@jxsuite/protocol";

const { shell } = await import("../src/shell");
const { setProjectState } = await import("../src/store");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const {
  deployChecklist,
  deployStatusItem,
  forgetDeployment,
  nextDeployStep,
  noteDeployment,
  observedDeployment,
  syncDeployChecklist,
} = await import("../src/publish/deploy-checklist");
const { disposeDeployChecklistSurface } = await import("../src/surfaces/panel-deploy-checklist");

function gitStatus(over: Partial<GitStatusResult> = {}): GitStatusResult {
  return { ahead: 0, behind: 0, branch: "main", files: [], isRepo: true, remotes: [], ...over };
}

/** One step by id, so an assertion never depends on the array's index. */
function step(id: string) {
  return deployChecklist().find((candidate) => candidate.id === id)!;
}

const DEPLOY = {
  provider: "cloudflare-pages" as const,
  accountId: "a".repeat(32),
  projectName: "my-site",
  productionUrl: "https://my-site.pages.dev",
};

beforeEach(() => {
  forgetDeployment();
  shell.git.status = null;
  resetStudioState({ projectConfig: { name: "My Site" } });
  installMockPlatform();
  setActiveRegistry(null);
});

describe("deployChecklist — the repository links", () => {
  test("a project source control has not reported on is unknown, not untracked", () => {
    // The distinction the whole module exists for: at cold start `shell.git.status` is null, and
    // Saying "this project is not tracked by git" then would be a guess presented as a fact.
    expect(step("repo").state).toBe("unknown");
    expect(step("remote").state).toBe("unknown");
  });

  test("no repository blocks at the first link", () => {
    shell.git.status = gitStatus({ branch: "", isRepo: false });
    expect(step("repo").state).toBe("todo");
    expect(nextDeployStep()?.id).toBe("repo");
    expect(nextDeployStep()?.command).toBe("git.init");
  });

  test("a tracked repository names its branch and moves the block to the remote", () => {
    shell.git.status = gitStatus();
    expect(step("repo").state).toBe("done");
    expect(step("repo").detail).toContain("main");
    expect(nextDeployStep()?.id).toBe("remote");
    expect(nextDeployStep()?.command).toBe("git.createGithubRepository");
  });

  test("a remote with unpushed commits blocks on a push, and says how many", () => {
    shell.git.status = gitStatus({ ahead: 3, remotes: ["origin"] });
    expect(step("remote").state).toBe("todo");
    expect(step("remote").command).toBe("git.push");
    expect(step("remote").detail).toContain("3 commit(s)");
    expect(step("remote").detail).toContain("origin");
  });

  test("a current remote is done", () => {
    shell.git.status = gitStatus({ remotes: ["origin"] });
    expect(step("remote").state).toBe("done");
    expect(step("remote").detail).toContain("Up to date with origin");
  });
});

describe("deployChecklist — the provider links", () => {
  beforeEach(() => {
    shell.git.status = gitStatus({ remotes: ["origin"] });
  });

  test("a platform that cannot reach Cloudflare says so instead of pretending", () => {
    // `installMockPlatform()` supplies no `cfApi`. The step is not `todo`, because "connect a
    // Provider" is not an action available here — it is the host's job, and the detail says so.
    expect(step("provider").state).toBe("unknown");
    expect(step("provider").detail).toContain("cannot reach the Cloudflare API");
  });

  test("a reachable platform with no connection is a plain todo", () => {
    installMockPlatform({ cfApi: async () => ({}) });
    expect(step("provider").state).toBe("todo");
    expect(nextDeployStep()?.command).toBe("publish.setUp");
  });

  test("a connected provider is done and names the Pages project", () => {
    setProjectState({
      expanded: new Set(),
      projectConfig: { build: { deploy: DEPLOY }, name: "My Site" },
    } as never);
    expect(step("provider").state).toBe("done");
    expect(step("provider").detail).toContain("my-site");
  });
});

describe("deployChecklist — the deployment link", () => {
  beforeEach(() => {
    shell.git.status = gitStatus({ remotes: ["origin"] });
    setProjectState({
      expanded: new Set(),
      projectConfig: { build: { deploy: DEPLOY }, name: "My Site" },
    } as never);
  });

  test("with no provider connected, nothing is deployed and it says why", () => {
    resetStudioState({ projectConfig: { name: "My Site" } });
    expect(step("deployed").state).toBe("todo");
    expect(step("deployed").detail).toContain("no provider is connected");
  });

  test("unasked is unknown, and says it is not a claim", () => {
    expect(step("deployed").state).toBe("unknown");
    expect(step("deployed").detail).toContain("not been asked");
  });

  test("asked-and-none is a todo — the difference from unasked is the whole point", () => {
    noteDeployment(null);
    expect(observedDeployment()).toBeNull();
    expect(step("deployed").state).toBe("todo");
    expect(step("deployed").detail).toContain("no deployments");
  });

  test("a successful deployment completes the chain", () => {
    noteDeployment({
      createdOn: "2026-07-06T00:00:00Z",
      environment: "production",
      id: "d1",
      stage: "deploy",
      status: "success",
      url: "https://abc.my-site.pages.dev",
    });
    expect(step("deployed").state).toBe("done");
    expect(nextDeployStep()).toBeNull();
  });

  test("a failed deployment blocks, and quotes the stage that failed", () => {
    noteDeployment({
      createdOn: "2026-07-06T00:00:00Z",
      environment: "production",
      id: "d1",
      stage: "build",
      status: "failure",
      url: "https://abc.my-site.pages.dev",
    });
    expect(step("deployed").state).toBe("todo");
    expect(step("deployed").detail).toContain("build: failure");
  });
});

describe("deployStatusItem — the status bar's project field", () => {
  test("no project, no item", () => {
    setProjectState(null as never);
    expect(deployStatusItem()).toBeNull();
  });

  test("its label IS the next blocking prerequisite", () => {
    shell.git.status = gitStatus({ branch: "", isRepo: false });
    expect(deployStatusItem()).toEqual({
      command: "git.init",
      label: "Track this project with git",
      title: "A deploy ships what the repository holds, so the repository comes first.",
    });
  });

  test("a whole chain reads as ambient state, pointing at the dashboard", () => {
    shell.git.status = gitStatus({ remotes: ["origin"] });
    setProjectState({
      expanded: new Set(),
      projectConfig: { build: { deploy: DEPLOY }, name: "My Site" },
    } as never);
    noteDeployment({
      createdOn: "2026-07-06T00:00:00Z",
      environment: "production",
      id: "d1",
      stage: "deploy",
      status: "success",
      url: "https://abc.my-site.pages.dev",
    });
    expect(deployStatusItem()).toEqual({
      command: "publish.openDashboard",
      label: "Deployed",
      title: "https://my-site.pages.dev",
    });
  });
});

describe("the deploy-checklist surface", () => {
  afterEach(() => {
    /* The checklist holds an effect scope and a mounted document; a suite that left one standing
       would hand the next test a surface projecting the state it has just reset. */
    disposeDeployChecklistSurface();
    document.body.replaceChildren();
  });

  /**
   * Paint the tab's container the way the Activity panel does, and let the document mount into it.
   *
   * Two waits, not one: `mountSurface` resolves when the DOCUMENT has rendered, and the kit
   * elements inside it settle their own templates one `connectedCallback` later.
   */
  async function paint(): Promise<HTMLElement> {
    const host = document.createElement("div");
    const container = document.createElement("div");
    container.dataset.deployChecklist = "";
    host.append(container);
    document.body.append(host);
    syncDeployChecklist(host);
    await flush();
    await flush();
    return host;
  }

  function steps(host: HTMLElement): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('[part="step"]')];
  }

  function stepStates(host: HTMLElement): string[] {
    return steps(host).map((row) => row.dataset["state"] ?? "");
  }

  test("draws nothing at all when no project is open", async () => {
    setProjectState(null as never);
    const host = await paint();
    expect(host.textContent?.trim()).toBe("");
    expect(host.querySelector('[part="list"]')).toBeNull();
  });

  test("draws every link of the chain, each carrying its own state", async () => {
    shell.git.status = gitStatus({ branch: "", isRepo: false });
    const host = await paint();
    expect(steps(host)).toHaveLength(4);
    expect(steps(host).map((row) => row.dataset["step"])).toEqual([
      "repo",
      "remote",
      "provider",
      "deployed",
    ]);
    expect(host.querySelector<HTMLElement>('[part="row"]')?.dataset["state"]).toBe("running");
    expect(host.textContent).toContain("Track this project with git");
    expect(host.textContent).toContain("Connect a deploy provider");
  });

  /* `unknown` is not a third kind of "no", and the surface is where that stops being an internal
     distinction: the step the app has not asked about is styled apart from the one it has. */
  test("an unasked link draws as unknown rather than as a todo", async () => {
    shell.git.status = null;
    const host = await paint();
    expect(stepStates(host).slice(0, 2)).toEqual(["unknown", "unknown"]);
    expect(
      host.querySelector('[part="step"][data-state="unknown"] [part="step-icon"]')?.textContent,
    ).toBe("?");
  });

  test("a step the registry cannot run draws no button, rather than a dead one", async () => {
    shell.git.status = gitStatus({ branch: "", isRepo: false });
    const host = await paint();
    expect(host.querySelector('[part="action"]')).toBeNull();
  });

  test("the next action carries the command's own title and runs it", async () => {
    shell.git.status = gitStatus({ branch: "", isRepo: false });
    const runs: string[] = [];
    const registry = createCommandRegistry({ getContext: emptyContext });
    registry.register({
      category: "Source Control",
      id: "git.init",
      level: "project",
      run: () => {
        runs.push("git.init");
      },
      title: "Initialize Repository",
    });
    setActiveRegistry(registry);
    const host = await paint();
    const action = host.querySelector<HTMLElement>('[part="action"]')!;
    expect(action.textContent).toContain("Initialize Repository");
    action.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(runs).toEqual(["git.init"]);
  });

  test("a disabled command keeps its row and states the requirement", async () => {
    shell.git.status = gitStatus({ branch: "", isRepo: false });
    const registry = createCommandRegistry({ getContext: emptyContext });
    registry.register({
      category: "Source Control",
      id: "git.init",
      level: "project",
      requires: "an open project",
      enablement: () => false,
      run: () => {},
      title: "Initialize Repository",
    });
    setActiveRegistry(registry);
    const host = await paint();
    const action = host.querySelector<HTMLElement>('[part="action"]')!;
    // `jx-button` draws the native control, and `disabled` is what that control carries.
    expect(action.querySelector<HTMLButtonElement>('[part="control"]')?.disabled).toBe(true);
    expect(action.getAttribute("title")).toContain("requires an open project");
  });

  test("a whole chain says so and offers no next action", async () => {
    shell.git.status = gitStatus({ remotes: ["origin"] });
    setProjectState({
      expanded: new Set(),
      projectConfig: { build: { deploy: DEPLOY }, name: "My Site" },
    } as never);
    noteDeployment({
      createdOn: "2026-07-06T00:00:00Z",
      environment: "production",
      id: "d1",
      stage: "deploy",
      status: "success",
      url: "https://abc.my-site.pages.dev",
    });
    const host = await paint();
    expect(host.querySelector<HTMLElement>('[part="row"]')?.dataset["state"]).toBe("done");
    expect(host.querySelector('[part="summary"]')?.textContent).toBe(
      "Everything this project needs to ship is in place.",
    );
    expect(stepStates(host)).toEqual(["done", "done", "done", "done"]);
    expect(host.querySelector('[part="action"]')).toBeNull();
  });

  /* The whole reason the observation is reactive: a deploy that lands writes it, and the row moves
     off "unknown" with nothing repainting the tab. As a lit template it was redrawn by whatever
     else the dock happened to be doing, which is not a subscription. */
  test("a deployment observed while the surface is up moves the row without a repaint", async () => {
    shell.git.status = gitStatus({ remotes: ["origin"] });
    setProjectState({
      expanded: new Set(),
      projectConfig: { build: { deploy: DEPLOY }, name: "My Site" },
    } as never);
    const host = await paint();
    expect(stepStates(host).at(-1)).toBe("unknown");
    noteDeployment({
      createdOn: "2026-07-06T00:00:00Z",
      environment: "production",
      id: "d1",
      stage: "deploy",
      status: "success",
      url: "https://abc.my-site.pages.dev",
    });
    await flush();
    expect(stepStates(host).at(-1)).toBe("done");
    expect(host.querySelector<HTMLElement>('[part="row"]')?.dataset["state"]).toBe("done");
  });

  /* The dock runs every tab's `afterRender` against the same painted body, so "no container" is
     how this surface learns the Activity tab is not the one showing. */
  test("a body with no container takes the standing document down", async () => {
    shell.git.status = gitStatus({ branch: "", isRepo: false });
    const host = await paint();
    expect(host.querySelector('[part="list"]')).toBeTruthy();
    const other = document.createElement("div");
    syncDeployChecklist(other);
    await flush();
    expect(host.querySelector('[part="list"]')).toBeNull();
  });

  /* `afterRender` runs on EVERY paint of the dock, so being handed the container the document is
     already standing in has to be a no-op rather than a second mount — two lists in one row is
     what the guard prevents, and a document rebuilt under a reader's pointer is what it costs. */
  test("being re-handed the same container mounts nothing new", async () => {
    shell.git.status = gitStatus({ branch: "", isRepo: false });
    const host = await paint();
    const before = host.querySelector('[part="list"]');
    syncDeployChecklist(host);
    syncDeployChecklist(host);
    await flush();
    expect(host.querySelectorAll('[part="list"]')).toHaveLength(1);
    expect(host.querySelector('[part="list"]')).toBe(before);
  });

  /* The dock repainted before the first mount had landed: the promise still resolves, and the
     handle it carries belongs to a container that is no longer the one being drawn into. */
  test("a mount that lands after the container moved disposes itself", async () => {
    shell.git.status = gitStatus({ branch: "", isRepo: false });
    const first = document.createElement("div");
    const firstContainer = document.createElement("div");
    firstContainer.dataset.deployChecklist = "";
    first.append(firstContainer);
    document.body.append(first);
    syncDeployChecklist(first);

    // Before the first mount resolves, which is the whole point.
    const second = await paint();
    expect(second.querySelector('[part="list"]')).toBeTruthy();
    expect(first.querySelector('[part="list"]')).toBeNull();
  });
});
