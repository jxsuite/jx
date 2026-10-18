/**
 * `Publish:` family tests: the five records' gates, and `runDeploy` as an Activity.
 *
 * Two things are asserted that are easy to get wrong and invisible when they are:
 *
 * - A deploy failure raises exactly ONE report, from `activity.fail`, and the caller does not also
 *   notify (§16 — a Problem and a toast for one failure is the double-reporting the tier system
 *   exists to prevent);
 * - The activity ENDS in every branch, including the one where Cloudflare answers nothing. A running
 *   activity is an idle blocker (`services/idle.ts`), so an operation that forgets to finish hangs
 *   `probe.idle()` and every screenshot after it.
 */
import { flush, installMockPlatform, resetStudioState, mountOverlayLayers } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isString } from "@jxsuite/schema/guards";

const { activities, resetActivities } = await import("../src/panels/activity-panel");
const { problems, resetNotifications, toasts } = await import("../src/services/notify");
const { forgetDeployment, observedDeployment } = await import("../src/publish/deploy-checklist");
const { dashboardUrl, publishCommands, registerPublishCommands, runDeploy } =
  await import("../src/publish/publish-commands");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext, makeContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { resetProjectShell, shell } = await import("../src/shell");

const DEPLOY = {
  provider: "cloudflare-pages" as const,
  accountId: "a".repeat(32),
  projectName: "my-site",
  productionUrl: "https://my-site.pages.dev",
};

const DEPLOYMENT_WIRE = {
  id: "d1",
  url: "https://abc.my-site.pages.dev",
  environment: "production",
  latest_stage: { name: "deploy", status: "success" },
  created_on: "2026-07-06T00:00:00Z",
};

function command(id: string) {
  return publishCommands().find((candidate) => candidate.id === id)!;
}

/** Run a Publish record the way the palette does: an empty context and no arguments. */
function runCommand(id: string): void | Promise<void> {
  /* SAFETY: a stored record is `AnyCommand`, whose args are erased to `never`. The records run
     here declare no `args`, so the registry hands each `run` undefined as well. */
  return command(id).run(emptyContext(), undefined as never);
}

/** A context whose host can reach Cloudflare (`capability.publish`), with a project in `project`. */
function canPublish(project: { open?: boolean; isRepo?: boolean }) {
  return makeContext({
    capability: { ...emptyContext().capability, publish: true },
    project: { ...emptyContext().project, ...project },
  });
}

function connect() {
  resetStudioState({ projectConfig: { build: { deploy: DEPLOY }, name: "My Site" } });
}

beforeEach(() => {
  resetActivities();
  resetNotifications();
  forgetDeployment();
  resetStudioState({ projectConfig: { name: "My Site" } });
  installMockPlatform();
});

describe("the records", () => {
  test("five of them, all Publish, all project-level", () => {
    const records = publishCommands();
    expect(records.map((record) => record.id)).toEqual([
      "publish.setUp",
      "publish.deploy",
      "publish.openDashboard",
      "publish.quick",
      "publish.open",
    ]);
    expect(records.every((record) => record.category === "Publish")).toBe(true);
    expect(records.every((record) => record.level === "project")).toBe(true);
    // Always REACHABLE, never silently absent: the palette shows them and states the requirement.
    // `publish.open` is the one scripted door, for the reason `styles.open` is: the palette's way
    // Into Publish is "Go to Publish".
    const listed = records.filter((record) => record.id !== "publish.open");
    expect(listed.every((record) => (record.menus ?? []).includes("palette"))).toBe(true);
    expect(command("publish.open").menus).toEqual(["never"]);
    expect(records.every((record) => isString(record.requires))).toBe(true);
    // Publishing is a workspace, never a primary command (studio.md §22.2).
    expect(records.some((record) => (record.menus ?? []).includes("commandbar/primary"))).toBe(
      false,
    );
  });

  test("registering them passes the registry's own placement and id checks", () => {
    const registry = createCommandRegistry({ getContext: emptyContext });
    registerPublishCommands(registry);
    expect([...registry.list()].map((record) => record.id).toSorted()).toEqual([
      "publish.deploy",
      "publish.open",
      "publish.openDashboard",
      "publish.quick",
      "publish.setUp",
    ]);
  });

  test("the gated four are hidden with no project, and appear with one", () => {
    // "Always listed" (docs/studio/publish.md): with a project open the family is VISIBLE even
    // When it cannot run, so the palette states the requirement instead of the row silently not
    // Existing.
    const open = makeContext({ project: { open: true } });
    for (const record of publishCommands().filter((entry) => entry.when)) {
      expect(record.when!(emptyContext())).toBe(false);
      expect(record.when!(open)).toBe(true);
    }
  });

  test("no record is a toggle — there is no delta against unstated state here", () => {
    expect(publishCommands().some((record) => /\.toggle[A-Z]/.test(record.id))).toBe(false);
  });

  test("Set Up is hidden without a project and refused without a reachable provider", () => {
    const setUp = command("publish.setUp");
    expect(setUp.when!(emptyContext())).toBe(false);
    const open = makeContext({ project: { open: true } });
    expect(setUp.when!(open)).toBe(true);
    // No `capability.publish` (no `cfApi` on the host) → enabled is false, and `requires` says why.
    expect(setUp.enablement!(open)).toBe(false);
    expect(setUp.enablement!(canPublish({ open: true }))).toBe(true);
  });

  test("Deploy needs a repository AND a connected provider AND a host that can reach CF", () => {
    const deploy = command("publish.deploy");
    const repo = canPublish({ isRepo: true, open: true });
    expect(deploy.enablement!(repo)).toBe(false);
    connect();
    expect(deploy.enablement!(repo)).toBe(true);
    expect(deploy.enablement!(canPublish({ open: true }))).toBe(false);
  });

  /*
   * THE CAPABILITY BELONGS TO THE FAMILY, not to its first member. `currentDeploy()` reads config
   * stored in the PROJECT, so a repo cloned with a deploy already configured carries it onto a host
   * whose PAL has no `cfApi`. Set Up Publishing was correctly disabled there while Deploy ran —
   * pushing the branch, then failing at `latestDeployment` after the push had gone out.
   */
  test("…and all three refuse on a host with no Cloudflare API, not just Set Up", () => {
    // No `capability.publish`: this host has no `cfApi`.
    connect();
    const ctx = makeContext({ project: { isRepo: true, open: true } });
    for (const id of ["publish.setUp", "publish.deploy", "publish.openDashboard"]) {
      expect([id, command(id).enablement!(ctx)]).toEqual([id, false]);
    }
  });

  test("Open Dashboard needs only the connection, and builds Cloudflare's own URL", () => {
    const dashboard = command("publish.openDashboard");
    expect(dashboard.enablement!(canPublish({ open: true }))).toBe(false);
    connect();
    expect(dashboard.enablement!(canPublish({ open: true }))).toBe(true);
    expect(dashboardUrl("acct", "site")).toBe("https://dash.cloudflare.com/acct/pages/view/site");
  });

  test("Open Dashboard opens the connected project in a new tab", () => {
    connect();
    const opened: unknown[][] = [];
    const original = window.open;
    window.open = (...args: unknown[]) => {
      opened.push(args);
      return null;
    };
    void runCommand("publish.openDashboard");
    window.open = original;
    expect(opened).toEqual([
      [`https://dash.cloudflare.com/${DEPLOY.accountId}/pages/view/my-site`, "_blank", "noopener"],
    ]);
  });

  test("Set Up opens the panel, and does not import it until it is run", async () => {
    // The lazy import is load-bearing: `commands/app-commands.ts` is read by three CI checks in a
    // Bare Bun process, and a module that opens a modal at import time would break all three.
    resetStudioState({ projectConfig: { name: "My Site" } });
    mountOverlayLayers(document.body);
    const { initLayers } = await import("../src/ui/layers");
    initLayers();
    await runCommand("publish.setUp");
    await flush();
    expect(document.querySelector('#layer-modal jx-dialog[part="publish"]')).toBeTruthy();
  });

  test("Deploy's run wrapper drives the same activity the direct call does", async () => {
    connect();
    installMockPlatform({
      cfApi: async (path: string) => (path.includes("/deployments") ? [DEPLOYMENT_WIRE] : {}),
    });
    await runCommand("publish.deploy");
    expect(activities).toHaveLength(1);
    expect(activities[0]!.state).toBe("done");
  });

  test("Open Dashboard with no connection does nothing rather than opening about:blank", () => {
    const opened: unknown[][] = [];
    const original = window.open;
    window.open = (...args: unknown[]) => {
      opened.push(args);
      return null;
    };
    void runCommand("publish.openDashboard");
    window.open = original;
    expect(opened).toEqual([]);
  });
});

describe("the workspace doors", () => {
  afterEach(() => {
    setActiveRegistry(null);
  });

  test("Quick Publish needs a repository, and is never a primary command", () => {
    const quick = command("publish.quick");
    expect(quick.enablement!(makeContext({ project: { open: true } }))).toBe(false);
    expect(quick.enablement!(makeContext({ project: { isRepo: true, open: true } }))).toBe(true);
    expect(quick.menus).toEqual(["commandbar/overflow", "palette"]);
  });

  test("Show Publish switches to the workspace, then to the sub-tab it names", async () => {
    const ran: unknown[] = [];
    const registry = createCommandRegistry({
      getContext: () => makeContext({ project: { open: true } }),
    });
    registry.register({
      category: "View",
      id: "view.setWorkspace",
      level: "application",
      run: (_ctx, args) => {
        ran.push(args);
      },
      title: "Show Workspace",
    });
    registerPublishCommands(registry);
    setActiveRegistry(registry);
    resetProjectShell();
    await registry.run("publish.open", { tab: "deploys" });
    expect(ran).toEqual([{ workspace: "publish" }]);
    expect(shell.publish.tab).toBe("deploys");
    // With no tab named, the workspace keeps the one it was left on.
    await registry.run("publish.open", {});
    expect(shell.publish.tab).toBe("deploys");
    expect(() => registry.run("publish.open", { tab: "history" })).toThrow(/not declared/);
  });

  test("Show Publish refuses with no registry to switch through", async () => {
    setActiveRegistry(null);
    /* SAFETY: a stored record is `AnyCommand`, whose args are erased to `never`; `publish.open`'s
       schema admits the empty object, which is what the registry would hand it with no tab. */
    const noArgs = {} as never;
    const running = Promise.resolve(command("publish.open").run(emptyContext(), noArgs));
    await expect(running).rejects.toThrow(/needs the window's command registry/);
  });
});

describe("runDeploy", () => {
  test("pushes, reads the deployment back, and records it for the checklist", async () => {
    connect();
    const { state } = installMockPlatform({
      cfApi: async (path: string) => (path.includes("/deployments") ? [DEPLOYMENT_WIRE] : {}),
    });
    expect(await runDeploy({ attempts: 1, delayMs: 0 })).toBe(true);
    expect(state.calls.some((call) => call[0] === "gitPush")).toBe(true);
    expect(observedDeployment()?.status).toBe("success");
    expect(activities).toHaveLength(1);
    expect(activities[0]!.state).toBe("done");
    expect(activities[0]!.status).toBe("deploy: success");
    expect(activities[0]!.steps.every((step) => step.state === "done")).toBe(true);
    expect(problems).toHaveLength(0);
  });

  test("a failed push is one Problem carrying the log, and no toast beside it", async () => {
    connect();
    installMockPlatform({
      gitPush: () => Promise.reject(new Error("remote rejected")),
    });
    expect(await runDeploy({ attempts: 1, delayMs: 0 })).toBe(false);
    expect(activities[0]!.state).toBe("failed");
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toBe("Could not push to the remote.");
    expect(problems[0]!.detail).toContain("remote rejected");
    expect(problems[0]!.action).toBe("git.push");
    expect(toasts).toHaveLength(0);
  });

  test("a Cloudflare that will not answer fails once, not on every attempt", async () => {
    connect();
    let calls = 0;
    installMockPlatform({
      cfApi: () => {
        calls += 1;
        return Promise.reject(new Error("502 Bad Gateway"));
      },
    });
    expect(await runDeploy({ attempts: 3, delayMs: 0 })).toBe(false);
    expect(calls).toBe(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toBe("Cloudflare did not answer.");
    expect(problems[0]!.detail).toContain("502 Bad Gateway");
  });

  test("no deployment yet ends honestly rather than claiming one or hanging", async () => {
    connect();
    installMockPlatform({ cfApi: async () => [] });
    expect(await runDeploy({ attempts: 2, delayMs: 0 })).toBe(true);
    expect(activities[0]!.state).toBe("done");
    expect(activities[0]!.status).toContain("has not reported a deployment yet");
    // Asked, and the answer was none — which is a fact the checklist may now state.
    expect(observedDeployment()).toBeNull();
    expect(problems).toHaveLength(0);
  });

  test("a push with no provider connected is still a completed push", async () => {
    installMockPlatform();
    expect(await runDeploy({ attempts: 1, delayMs: 0 })).toBe(true);
    expect(activities[0]!.state).toBe("done");
    expect(activities[0]!.status).toContain("No provider is connected");
  });

  test("cancelling during the last wait still returns without claiming a deploy", async () => {
    // The post-loop guard: the cancel lands while the FINAL delay is pending, so the loop exits
    // Normally and the "no deployment yet" line would otherwise be written over a cancellation.
    connect();
    const { cancelActivity } = await import("../src/panels/activity-panel");
    installMockPlatform({
      cfApi: async () => {
        cancelActivity(activities[0]!.id);
        return [];
      },
    });
    expect(await runDeploy({ attempts: 1, delayMs: 0 })).toBe(false);
    expect(activities[0]!.state).toBe("cancelled");
    expect(observedDeployment()).toBeNull();
  });

  test("cancelling stops the poll and leaves the entry cancelled, not running", async () => {
    connect();
    installMockPlatform({ cfApi: async () => [] });
    const { cancelActivity } = await import("../src/panels/activity-panel");
    const promise = runDeploy({ attempts: 5, delayMs: 1 });
    await flush(1);
    expect(cancelActivity(activities[0]!.id)).toBe(true);
    expect(await promise).toBe(false);
    expect(activities[0]!.state).toBe("cancelled");
  });
});
