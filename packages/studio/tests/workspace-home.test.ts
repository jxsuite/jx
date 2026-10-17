/**
 * Workspace homes — `src/workspace/workspace-home.ts` over `src/surfaces/workspace-home.json`.
 *
 * A home is a virtual tab with a canvas mode of its own, routed by `canvas/canvas-render.ts` and
 * mounted per pane. The cases open one the way `view.setWorkspace` does, draw it into a stage the
 * way the canvas does, and read the document by `part`.
 */
import { flush, resetStudioState, surfaceOf } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeAllTabs, workspace } from "../src/workspace/workspace";
import { editorKindForMode } from "../src/commands/context";
import {
  detachWorkspaceHome,
  isWorkspaceHomeMode,
  openWorkspaceHome,
  renderWorkspaceHome,
  workspaceHomeMounted,
  workspaceHomeView,
} from "../src/workspace/workspace-home";
import { workspaceHomeTabId } from "../src/workspace/workspace-ids";
import { workspaceOfTab } from "../src/workspace/tab-workspace";
import { mountWorkspaceHomeSurface } from "../src/surfaces/workspace-home";

/** A stage, in the document, the way a pane hands one to the mode that owns it. */
function stage(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

beforeEach(() => {
  resetStudioState({ isSiteProject: true, projectConfig: { name: "Demo" } });
  closeAllTabs();
});

afterEach(() => {
  detachWorkspaceHome("primary");
  closeAllTabs();
  document.body.textContent = "";
});

describe("opening a home", () => {
  test("opens a virtual tab in the home's own mode, with no document behind it", () => {
    const tab = openWorkspaceHome("media");
    expect(tab.id).toBe(workspaceHomeTabId("media"));
    expect(tab.documentPath).toBeNull();
    expect(tab.capabilities.modes).toEqual(["media-home"]);
    expect(tab.session.ui.canvasMode).toBe("media-home");
    expect(workspaceOfTab(tab)).toBe("media");
  });

  test("is idempotent: a second open activates the same tab", () => {
    const first = openWorkspaceHome("publish");
    const second = openWorkspaceHome("publish");
    expect(second.id).toBe(first.id);
    expect([...workspace.tabs.keys()]).toEqual([workspaceHomeTabId("publish")]);
  });

  test("the home modes are their own editor kind, not the Canvas key scope", () => {
    expect(isWorkspaceHomeMode("media-home")).toBe(true);
    expect(isWorkspaceHomeMode("publish-home")).toBe(true);
    expect(isWorkspaceHomeMode("media")).toBe(false);
    expect(editorKindForMode("media-home")).toBe("home");
    expect(editorKindForMode("publish-home")).toBe("home");
  });
});

describe("drawing a home", () => {
  test("names the workspace and says what it is for", async () => {
    const tab = openWorkspaceHome("media");
    const host = stage();
    renderWorkspaceHome(surfaceOf(host), tab);
    await flush(4);
    const home = host.querySelector<HTMLElement>('[part="home"]')!;
    expect(home).not.toBeNull();
    expect(home.dataset.workspace).toBe("media");
    expect(home.dataset.jxRegion).toBe("pane.primary/home");
    expect(home.querySelector('[part="title"]')?.textContent).toBe("Media");
    expect(home.querySelector('[part="purpose"]')?.textContent).toMatch(/images/);
    // The heading names the region.
    const title = home.querySelector('[part="title"]')!;
    expect(home.getAttribute("aria-labelledby")).toBe(title.id);
    // The second sentence points at where media is managed until the workspace has its own surface.
    expect(home.querySelector('[part="detail"]')?.textContent).toMatch(/Files panel/);
  });

  test("a home already standing is not rebuilt; another tab's is", async () => {
    const media = openWorkspaceHome("media");
    const host = stage();
    const surface = surfaceOf(host);
    renderWorkspaceHome(surface, media);
    await flush(4);
    const root = host.querySelector('[part="home"]');
    expect(workspaceHomeMounted("primary", media)).toBe(true);
    renderWorkspaceHome(surface, media);
    await flush(4);
    expect(host.querySelector('[part="home"]')).toBe(root);

    const publish = openWorkspaceHome("publish");
    expect(workspaceHomeMounted("primary", publish)).toBe(false);
    renderWorkspaceHome(surface, publish);
    await flush(4);
    expect(host.querySelectorAll('[part="home"]')).toHaveLength(1);
    expect(host.querySelector<HTMLElement>('[part="home"]')?.dataset.workspace).toBe("publish");
  });

  test("detaching takes it down, and is idempotent", async () => {
    const tab = openWorkspaceHome("publish");
    const host = stage();
    renderWorkspaceHome(surfaceOf(host), tab);
    await flush(4);
    detachWorkspaceHome("primary");
    detachWorkspaceHome("primary");
    expect(workspaceHomeMounted("primary", tab)).toBe(false);
    await flush(2);
    expect(host.querySelector('[part="home"]')).toBeNull();
  });

  test("a stage that left the document is not a standing home", async () => {
    const tab = openWorkspaceHome("media");
    const host = stage();
    renderWorkspaceHome(surfaceOf(host), tab);
    await flush(4);
    host.remove();
    expect(workspaceHomeMounted("primary", tab)).toBe(false);
  });

  test("the view is the workspace's own record", () => {
    const tab = openWorkspaceHome("publish");
    expect(workspaceHomeView("secondary", tab)).toEqual({
      detail: "For now, commit and sync your changes from Source Control in the Design workspace.",
      icon: "paper-plane-tilt",
      purpose: "Review your changes and put them on the live site.",
      region: "pane.secondary/home",
      title: "Publish",
      workspace: "publish",
    });
  });
});

describe("the surface adapter", () => {
  test("an empty second sentence is not drawn at all", async () => {
    const host = stage();
    const view = workspaceHomeView("primary", openWorkspaceHome("media"));
    const handle = mountWorkspaceHomeSurface(host, { ...view, detail: "", title: "Library" });
    const root = await handle.ready;
    await flush(2);
    expect(root.querySelector('[part="title"]')?.textContent).toBe("Library");
    expect(root.querySelector('[part="detail"]')).toBeNull();
    handle.dispose();
  });

  test("a mount still in flight counts as attached; a disposed one never does", async () => {
    const host = stage();
    const handle = mountWorkspaceHomeSurface(
      host,
      workspaceHomeView("primary", openWorkspaceHome("publish")),
    );
    expect(handle.attached()).toBe(true);
    // Disposed before the mount lands: the late mount is taken straight back down.
    handle.dispose();
    expect(handle.attached()).toBe(false);
    await handle.ready;
    await flush(2);
    expect(host.querySelector('[part="home"]')).toBeNull();
  });
});
