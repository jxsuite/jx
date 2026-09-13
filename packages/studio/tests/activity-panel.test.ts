/**
 * The Activity tracker (`panels/activity-panel.ts`) — the record a long operation lives in.
 *
 * What is worth pinning: that an entry is written through the REACTIVE proxy (so a running
 * operation is not a frozen row), that a failure lands in Problems carrying its log, that Cancel
 * only exists when an operation actually handed one over, and that `probeIdle()` counts a running
 * operation and stops counting a finished one.
 */
import { flush, renderInto } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  activities,
  activityById,
  activityDuration,
  activityView,
  activityIdleBlockers,
  beginActivity,
  cancelActivity,
  clearFinishedActivities,
  isFinished,
  MAX_FINISHED_ACTIVITIES,
  registerActivityPanel,
  renderActivityBody,
  resetActivities,
  runningActivities,
  syncActivitySurface,
} from "../src/panels/activity-panel";
import { disposeActivitySurface } from "../src/surfaces/panel-activity";
import { disposeDeployChecklistSurface } from "../src/surfaces/panel-deploy-checklist";
import { getPanel, panelContext, resetPanels } from "../src/panels/panel-registry";
import { problems, resetNotifications } from "../src/services/notify";
import { effect, effectScope } from "../src/reactivity";
import type { TemplateResult } from "lit-html";

beforeEach(() => {
  resetActivities();
  resetNotifications();
  resetPanels();
});

afterEach(() => {
  // The feed holds an effect scope and a mounted document; a suite that left one standing would
  // Hand the next test a surface projecting the activities it has just reset. The deploy checklist
  // Beside it is the same, and the panel's `afterRender` mounts both.
  disposeActivitySurface();
  disposeDeployChecklistSurface();
  document.body.replaceChildren();
  resetActivities();
  resetNotifications();
  resetPanels();
});

/**
 * Paint the tab the way the Bottom dock does — lit's body, then the panel's `afterRender` — and let
 * the document mount into the container that body carries.
 *
 * Two waits, not one: `mountSurface` resolves when the DOCUMENT has rendered, and the kit elements
 * inside it settle their own templates one `connectedCallback` later.
 */
async function paint(host: HTMLElement = document.createElement("div")): Promise<HTMLElement> {
  document.body.append(host);
  await renderInto(renderActivityBody() as TemplateResult, host);
  syncActivitySurface(host);
  await flush();
  await flush();
  return host;
}

/** Everything the mounted feed drew under one part name. */
function parts(host: HTMLElement, name: string): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(`[part="${name}"]`)];
}

/** The one element under a part name, or null. */
function part(host: HTMLElement, name: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[part="${name}"]`);
}

describe("beginActivity", () => {
  test("records a running entry with its declared steps", () => {
    const handle = beginActivity({
      source: "Packages",
      status: "Resolving…",
      steps: ["Resolve", "Install"],
      title: "Update dependencies",
    });
    expect(activities).toHaveLength(1);
    expect(handle.entry.state).toBe("running");
    expect(handle.entry.source).toBe("Packages");
    expect(handle.entry.steps.map((step) => step.state)).toEqual(["pending", "pending"]);
    expect(activityById(handle.id)).toBe(handle.entry);
    expect(runningActivities()).toHaveLength(1);
  });

  test("the handle writes through the reactive proxy, so an effect sees every change", () => {
    const seen: string[] = [];
    const handle = beginActivity({ title: "Clone" });
    const scope = effectScope();
    scope.run(() => {
      effect(() => {
        seen.push(activities.map((entry) => `${entry.status}/${entry.state}`).join("|"));
      });
    });
    handle.setStatus("Fetching");
    handle.done("Cloned");
    scope.stop();
    // The failure this guards is the one that makes a live operation look frozen: pushing the
    // Literal and then writing to it goes through the raw target and skips every effect. The
    // Intermediate frames are the ending's two writes, which is why the assertion is on the
    // Sequence's shape rather than on its length.
    expect(seen[0]).toBe("/running");
    expect(seen).toContain("Fetching/running");
    expect(seen.at(-1)).toBe("Cloned/done");
  });

  test("log drops blank chunks and keeps the rest", () => {
    const handle = beginActivity({ title: "Install" });
    handle.log("resolving\n");
    handle.log("   ");
    handle.log("");
    handle.log("done");
    expect(handle.entry.log).toEqual(["resolving", "done"]);
  });

  test("step advances the plan and appends an unplanned one", () => {
    const handle = beginActivity({ steps: ["Read", "Write"], title: "Open project" });
    handle.step("Write");
    expect(handle.entry.steps.map((step) => step.state)).toEqual(["done", "running"]);
    expect(handle.entry.status).toBe("Write");
    handle.step("Verify");
    expect(handle.entry.steps.map((step) => step.label)).toEqual(["Read", "Write", "Verify"]);
    expect(handle.entry.steps.map((step) => step.state)).toEqual(["done", "done", "running"]);
  });

  test("done finishes the entry and every remaining step", () => {
    const handle = beginActivity({ steps: ["One", "Two"], title: "Import" });
    handle.done("Imported");
    expect(handle.entry.state).toBe("done");
    expect(handle.entry.endedAt).not.toBeNull();
    expect(handle.entry.steps.every((step) => step.state === "done")).toBe(true);
    expect(isFinished(handle.entry)).toBe(true);
    expect(runningActivities()).toHaveLength(0);
  });

  test("a second ending is ignored — the first outcome is the one that happened", () => {
    const handle = beginActivity({ title: "Install" });
    handle.done("Installed");
    handle.fail("too late");
    expect(handle.entry.state).toBe("done");
    expect(handle.entry.status).toBe("Installed");
    // And no Problem: a list whose promise is "everything here still needs fixing" must not carry
    // A failure the operation reported after it had already succeeded.
    expect(problems).toHaveLength(0);
    handle.setStatus("later still");
    expect(handle.entry.status).toBe("Installed");
  });

  test("fail raises a Problem carrying the captured log as its detail", () => {
    const handle = beginActivity({ source: "Packages", title: "Install" });
    handle.log("error: no matching version");
    handle.fail("bun install failed", { action: "packages.install", path: "package.json" });

    expect(handle.entry.state).toBe("failed");
    expect(handle.entry.steps).toEqual([]);
    expect(problems).toHaveLength(1);
    const problem = problems[0]!;
    expect(problem.severity).toBe("error");
    expect(problem.message).toBe("bun install failed");
    expect(problem.source).toBe("Packages");
    expect(problem.detail).toBe("error: no matching version");
    expect(problem.action).toBe("packages.install");
    expect(problem.path).toBe("package.json");
  });

  test("a failure with no log and no source still names the operation", () => {
    beginActivity({ title: "Publish" }).fail("nope");
    expect(problems[0]!.source).toBe("Publish");
    expect(problems[0]!.detail).toBeUndefined();
  });
});

describe("cancelActivity", () => {
  test("runs the callback and marks the entry cancelled", () => {
    let stopped = 0;
    const handle = beginActivity({
      cancel: () => {
        stopped += 1;
      },
      title: "Install",
    });
    expect(handle.entry.cancellable).toBe(true);

    expect(cancelActivity(handle.id)).toBe(true);
    expect(stopped).toBe(1);
    expect(handle.entry.state).toBe("cancelled");
    expect(handle.entry.cancellable).toBe(false);
    // Cancelling twice must not re-run the callback: the operation is already stopped.
    expect(cancelActivity(handle.id)).toBe(false);
    expect(stopped).toBe(1);
  });

  test("an operation that offered no cancel cannot be cancelled, and says so", () => {
    const handle = beginActivity({ title: "Install" });
    expect(handle.entry.cancellable).toBe(false);
    expect(cancelActivity(handle.id)).toBe(false);
    expect(cancelActivity("nope")).toBe(false);
  });
});

describe("the list", () => {
  test("clearFinishedActivities keeps what is still running", () => {
    beginActivity({ title: "Done one" }).done();
    const running = beginActivity({ title: "Still going" });
    expect(clearFinishedActivities()).toBe(1);
    expect(activities.map((entry) => entry.id)).toEqual([running.id]);
  });

  test("finished entries retire past the cap; running ones never do", () => {
    const running = beginActivity({ title: "Long one" });
    for (let index = 0; index <= MAX_FINISHED_ACTIVITIES; index += 1) {
      beginActivity({ title: `Op ${index}` }).done();
    }
    expect(activities.filter((entry) => isFinished(entry))).toHaveLength(MAX_FINISHED_ACTIVITIES);
    expect(activityById(running.id)).toBeDefined();
    // The oldest went, not the newest.
    expect(activities.some((entry) => entry.title === "Op 0")).toBe(false);
    expect(activities.some((entry) => entry.title === `Op ${MAX_FINISHED_ACTIVITIES}`)).toBe(true);
  });
});

describe("activityIdleBlockers", () => {
  test("a running operation blocks idle and a finished one does not", () => {
    const handle = beginActivity({ status: "Resolving…", title: "Install" });
    expect(activityIdleBlockers()).toEqual(["activity: Install — Resolving…"]);
    handle.done();
    expect(activityIdleBlockers()).toEqual([]);
  });

  test("an operation with no status still names itself", () => {
    beginActivity({ title: "Install" });
    expect(activityIdleBlockers()).toEqual(["activity: Install — running"]);
  });
});

describe("activityDuration", () => {
  test("reports in the coarsest unit that is still true", () => {
    const handle = beginActivity({ title: "Install" });
    const start = handle.entry.startedAt;
    expect(activityDuration(handle.entry, start + 400)).toBe("400ms");
    expect(activityDuration(handle.entry, start + 4200)).toBe("4s");
    expect(activityDuration(handle.entry, start + 95_000)).toBe("1m 35s");
    // A clock that has gone backwards reports zero rather than a negative duration.
    expect(activityDuration(handle.entry, start - 10)).toBe("0ms");
  });

  test("a finished entry freezes at the time it ended", () => {
    const handle = beginActivity({ title: "Install" });
    handle.done();
    const frozen = activityDuration(handle.entry, handle.entry.startedAt + 10_000);
    expect(frozen).toBe(activityDuration(handle.entry, handle.entry.startedAt + 90_000));
  });
});

describe("the surface", () => {
  test("an empty list says what the region is for", async () => {
    const host = await paint();
    expect(part(host, "empty-message")?.textContent).toContain(
      "Long operations show their progress",
    );
    expect(part(host, "list")).toBeNull();
  });

  test("a running operation renders its status, its steps and a Cancel button", async () => {
    const handle = beginActivity({
      cancel: () => {},
      source: "Packages",
      status: "Resolving…",
      steps: ["Resolve", "Install"],
      title: "Update dependencies",
    });
    const host = await paint();
    expect(part(host, "row")?.dataset.state).toBe("running");
    expect(part(host, "row-title")?.textContent).toBe("Update dependencies");
    expect(part(host, "source")?.textContent).toBe("Packages");
    expect(part(host, "status")?.textContent).toBe("Resolving…");
    expect(parts(host, "step")).toHaveLength(2);
    const cancel = part(host, "cancel");
    expect(cancel).not.toBeNull();
    cancel!.click();
    expect(handle.entry.state).toBe("cancelled");
  });

  test("an operation with no cancel renders no button that pretends otherwise", async () => {
    beginActivity({ title: "Install" });
    const host = await paint();
    expect(part(host, "cancel")).toBeNull();
    expect(part(host, "steps")).toBeNull();
    expect(part(host, "log-toggle")).toBeNull();
  });

  test("the log is a disclosure, and the flag lives on the record", async () => {
    const handle = beginActivity({ title: "Install" });
    handle.log("line one");
    const host = await paint();
    const toggle = part(host, "log-toggle")!;
    expect(toggle.textContent).toContain("Show log (1 line(s))");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(part(host, "log")).toBeNull();

    toggle.click();
    expect(handle.entry.expanded).toBe(true);
    // Nothing repaints the tab: the surface's own effect saw the flag move on the record.
    await flush();
    expect(part(host, "log")?.textContent).toContain("line one");
    expect(part(host, "log-toggle")?.textContent).toContain("Hide log");
    expect(part(host, "log-toggle")?.getAttribute("aria-expanded")).toBe("true");
  });

  test("Clear offers itself only once something has finished, and clears exactly that", async () => {
    beginActivity({ title: "Running" });
    const host = await paint();
    expect(part(host, "clear")).toBeNull();

    beginActivity({ title: "Finished" }).done();
    await flush();
    const clear = part(host, "clear")!;
    expect(clear.textContent).toContain("Clear 1 finished");
    clear.click();
    await flush();
    expect(activities).toHaveLength(1);
    expect(parts(host, "row")).toHaveLength(1);
  });

  test("a live operation moves the row it is on, with no repaint of the tab", async () => {
    const handle = beginActivity({ status: "Resolving…", title: "Install" });
    const host = await paint();
    const row = part(host, "row")!;

    handle.step("Fetch");
    handle.log("downloading");
    await flush();
    // The same element: one effect wrote the fields that changed, and the keyed row stayed put.
    expect(part(host, "row")).toBe(row);
    expect(part(host, "status")?.textContent).toBe("Fetch");
    expect(parts(host, "step")).toHaveLength(1);
    expect(part(host, "log-toggle")?.textContent).toContain("Show log (1 line(s))");

    handle.fail("nope");
    await flush();
    expect(part(host, "row")?.dataset.state).toBe("failed");
  });

  test("the projection answers every question the document can ask", () => {
    const handle = beginActivity({
      source: "Packages",
      status: "Resolving…",
      steps: ["One", "Two"],
      title: "Install",
    });
    handle.log("a");
    handle.log("b");
    handle.step("Two");
    const view = activityView();
    expect(view.hasRows).toBe(true);
    expect(view.hasFinished).toBe(false);
    const row = view.rows[0]!;
    expect(row).toMatchObject({
      cancellable: false,
      expanded: false,
      hasLog: true,
      hasSource: true,
      hasStatus: true,
      hasSteps: true,
      icon: "⋯",
      logLabel: "Show log (2 line(s))",
      logText: "a\nb",
      showLog: false,
      source: "Packages",
      state: "running",
      status: "Two",
      title: "Install",
    });
    // Keyed by position as well as label, because an operation may append a step it has already
    // Run and two rows carrying one key is how a keyed list stops reconciling.
    expect(row.steps).toMatchObject([
      { icon: "✓", key: "0:One", label: "One", state: "done" },
      { icon: "⋯", key: "1:Two", label: "Two", state: "running" },
    ]);

    handle.done("Installed");
    const finished = activityView();
    expect(finished.hasFinished).toBe(true);
    expect(finished.clearLabel).toBe("Clear 1 finished");
    expect(finished.rows[0]!.icon).toBe("✓");
  });
});

describe("the panel's afterRender", () => {
  test("keeps the standing surface when the tab is painted again", async () => {
    beginActivity({ title: "Install" });
    const host = await paint();
    const row = part(host, "row")!;

    // The dock runs afterRender on every paint, so a second call must not remount: a remount would
    // Throw away the row the reader is watching and start its effect over.
    await paint(host);
    expect(part(host, "row")).toBe(row);
    expect(parts(host, "row")).toHaveLength(1);
  });

  test("takes the surface down when another tab owns the body", async () => {
    beginActivity({ title: "Install" });
    const host = await paint();
    expect(part(host, "row")).not.toBeNull();

    const container = host.querySelector<HTMLElement>("[data-activity-surface]")!;
    // What the dock paints when Problems is showing: a body with no container of ours in it.
    host.replaceChildren();
    syncActivitySurface(host);
    await flush();
    // The document went with it. A surface left standing in DOM lit has thrown away keeps an
    // Effect subscribed to the activity store and a scope nothing will ever read.
    expect(container.childNodes).toHaveLength(0);

    // And it comes back when the tab does.
    const again = await paint();
    expect(part(again, "row-title")?.textContent).toBe("Install");
  });

  test("a mount still in flight when the tab goes leaves nothing standing", async () => {
    beginActivity({ title: "Install" });
    const host = document.createElement("div");
    document.body.append(host);
    await renderInto(renderActivityBody() as TemplateResult, host);
    const container = host.querySelector<HTMLElement>("[data-activity-surface]")!;

    // `mountSurface` waits for the kit, so a tab switch can land between the two — and a document
    // That arrives after its host has been given up must not attach to it.
    syncActivitySurface(host);
    disposeActivitySurface();
    await flush();
    await flush();
    expect(container.childNodes).toHaveLength(0);
  });
});

describe("the panel record", () => {
  test("is a project-level Bottom dock tab with a running-operations badge", () => {
    registerActivityPanel();
    const panel = getPanel("activity")!;
    expect(panel.dock).toBe("bottom");
    expect(panel.level).toBe("project");
    expect(panel.title).toBe("Activity");
    expect(panel.rail).toBe(false);

    const ctx = panelContext();
    expect(panel.badge?.(ctx)).toBeNull();
    beginActivity({ title: "Install" });
    expect(panel.badge?.(ctx)).toBe(1);
  });

  test("renders a body with the containers its two surfaces mount into, and no document", async () => {
    registerActivityPanel();
    const panel = getPanel("activity")!;
    const ctx = { deps: {} as never, doc: null, rerender: () => {} };
    const host = document.createElement("div");
    document.body.append(host);
    await renderInto(panel.render(ctx) as TemplateResult, host);
    /* Two hosts, because a document CLEARS the node it is given and lit renders BESIDE foreign
       nodes: the deploy checklist and the feed can never share one. */
    expect(host.querySelector("[data-deploy-checklist]")).not.toBeNull();
    expect(host.querySelector("[data-activity-surface]")).not.toBeNull();

    beginActivity({ title: "Install" });
    panel.afterRender?.(ctx, host);
    await flush();
    await flush();
    expect(part(host, "row-title")?.textContent).toBe("Install");
    // And the checklist mounted into its own container, above the feed.
    expect(host.querySelector('[data-deploy-checklist] [part="checklist"]')).not.toBeNull();
    disposeDeployChecklistSurface();
  });
});
