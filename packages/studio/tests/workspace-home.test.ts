/**
 * Workspace homes: `src/workspace/workspace-home.ts`, which routes each home tab to its workspace's
 * own surface.
 *
 * A home is a virtual tab with a canvas mode of its own, routed by `canvas/canvas-render.ts` and
 * mounted per pane. The cases open one the way `view.setWorkspace` does, draw it into a stage the
 * way the canvas does, and read the document by `part`. What each surface draws is its own suite's
 * (`media-library.test.ts`, `publish-workspace.test.ts`); this one is about the routing.
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
} from "../src/workspace/workspace-home";
import { workspaceHomeTabId } from "../src/workspace/workspace-ids";
import { workspaceOfTab } from "../src/workspace/tab-workspace";

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
  test("the Publish home is the Publish workspace", async () => {
    const tab = openWorkspaceHome("publish");
    const host = stage();
    renderWorkspaceHome(surfaceOf(host), tab);
    await flush(4);
    const home = host.querySelector<HTMLElement>('[part="publish"]');
    expect(home?.dataset.jxRegion).toBe("pane.primary/publish");
    expect(workspaceHomeMounted("primary", tab)).toBe(true);
  });

  test("the Media home is the media library", async () => {
    const tab = openWorkspaceHome("media");
    const host = stage();
    renderWorkspaceHome(surfaceOf(host), tab);
    await flush(4);
    const library = host.querySelector<HTMLElement>('[part="media-library"]');
    expect(library?.dataset.jxRegion).toBe("pane.primary/media-library");
    expect(library?.dataset.mode).toBe("manage");
    expect(workspaceHomeMounted("primary", tab)).toBe(true);
    detachWorkspaceHome("primary");
    expect(workspaceHomeMounted("primary", tab)).toBe(false);
  });

  test("a home already standing is not rebuilt; another tab's is", async () => {
    const media = openWorkspaceHome("media");
    const host = stage();
    const surface = surfaceOf(host);
    renderWorkspaceHome(surface, media);
    await flush(4);
    const root = host.querySelector('[part="media-library"]');
    expect(workspaceHomeMounted("primary", media)).toBe(true);
    renderWorkspaceHome(surface, media);
    await flush(4);
    expect(host.querySelector('[part="media-library"]')).toBe(root);

    const publish = openWorkspaceHome("publish");
    expect(workspaceHomeMounted("primary", publish)).toBe(false);
    renderWorkspaceHome(surface, publish);
    await flush(4);
    expect(host.querySelectorAll('[part="publish"]')).toHaveLength(1);
    expect(host.querySelector('[part="media-library"]')).toBeNull();
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
    expect(host.querySelector('[part="publish"]')).toBeNull();
  });

  test("a stage that left the document is not a standing home", async () => {
    const tab = openWorkspaceHome("publish");
    const host = stage();
    renderWorkspaceHome(surfaceOf(host), tab);
    await flush(4);
    host.remove();
    expect(workspaceHomeMounted("primary", tab)).toBe(false);
  });
});
