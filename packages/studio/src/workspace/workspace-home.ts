/// <reference lib="dom" />
/**
 * Workspace homes — the virtual tab a workspace opens on when none of its own tabs is open.
 *
 * A home is a tab like a grid is a tab: it sits in a pane's strip, it can be closed, and it has a
 * canvas mode of its own (`content-home`, `media-home`, `publish-home`) that
 * `canvas/canvas-render.ts` routes here. It has no document — the tab carries a stub, exactly as
 * the grid tabs do — and its id is in the `workspace://` space `workspace/workspace-ids.ts`
 * declares, so it can never collide with a file.
 *
 * What a home DRAWS is its workspace's own surface: the Content home is the collection it shows
 * (`browse/library-pane.ts`, studio.md §22.5), the Media home is the media library
 * (`media/media-library.ts`, §22.6) and the Publish home is the Publish workspace
 * (`publish/publish-workspace.ts`, §22.8). The mechanism (the tab, the mode, the routing and the
 * per-pane mount) is the same for all three, and this module only routes.
 *
 * @docs studio/interface
 */

import { activateTab, openTab, workspace } from "./workspace";
import { WORKSPACE_HOME_MODES, homeWorkspaceOfTabId, workspaceHomeTabId } from "./workspace-ids";
import {
  detachMediaLibrary,
  mediaLibraryMounted,
  renderMediaLibrary,
} from "../media/media-library";
import { detachLibraryPane, libraryPaneMounted, renderLibraryMode } from "../browse/library-pane";
import {
  detachPublishWorkspace,
  publishWorkspaceMounted,
  renderPublishWorkspace,
} from "../publish/publish-workspace";
import type { HomeWorkspaceId } from "./workspace-ids";
import type { Tab } from "../tabs/tab";
import type { CanvasSurface } from "../canvas/canvas-surface";

/** The stub a home tab carries: it is never read, and nothing is ever saved from it. */
const HOME_STUB_DOCUMENT = { children: [], tagName: "div" };

/** The canvas modes a home draws under. */
export const WORKSPACE_HOME_MODE_SET: ReadonlySet<string> = new Set(
  Object.values(WORKSPACE_HOME_MODES),
);

/** Whether a canvas mode is a workspace home's. */
export function isWorkspaceHomeMode(mode: string): boolean {
  return WORKSPACE_HOME_MODE_SET.has(mode);
}

/**
 * Open (or activate) a workspace's home.
 *
 * Idempotent by construction, which is what lets `view.setWorkspace` say "show me Media" without
 * caring whether an earlier switch opened its home already.
 */
export function openWorkspaceHome(id: HomeWorkspaceId): Tab {
  const tabId = workspaceHomeTabId(id);
  const existing = workspace.tabs.get(tabId);
  if (existing) {
    activateTab(tabId);
    return existing;
  }
  return openTab({
    capabilities: { modes: [WORKSPACE_HOME_MODES[id]] },
    document: structuredClone(HOME_STUB_DOCUMENT),
    documentPath: null,
    id: tabId,
  });
}

/**
 * Put a workspace's home in `paneId`'s strip without showing it, unless it is open already.
 *
 * A workspace with no Navigator (Media, Publish) has no other way back to its home than its tab: a
 * media file opened from the Site panel lands in Media on its viewer, and with the home absent the
 * strip offered that viewer alone and closing it left an empty stage. Keeping the home beside it is
 * what makes the grid one click away, and what closing the viewer falls back to.
 */
export function placeWorkspaceHome(id: HomeWorkspaceId, paneId: string): void {
  openTab({
    background: true,
    capabilities: { modes: [WORKSPACE_HOME_MODES[id]] },
    document: structuredClone(HOME_STUB_DOCUMENT),
    documentPath: null,
    id: workspaceHomeTabId(id),
    paneId,
  });
}

// ─── Mounting ────────────────────────────────────────────────────────────────

/** Whether this tab's home is already mounted in this pane and still in the document. */
export function workspaceHomeMounted(paneId: string, tab: Tab): boolean {
  const id = homeWorkspaceOfTabId(tab.id);
  if (id === "media") {
    return mediaLibraryMounted(paneId, tab);
  }
  if (id === "content") {
    return libraryPaneMounted(paneId, tab);
  }
  return publishWorkspaceMounted(paneId, tab);
}

/** Tear one pane's home down (mode change, tab switch, project close). Idempotent. */
export function detachWorkspaceHome(paneId: string): void {
  detachMediaLibrary(paneId);
  detachLibraryPane(paneId);
  detachPublishWorkspace(paneId);
}

/**
 * Draw a home tab into its pane's stage.
 *
 * @param {CanvasSurface} surface
 * @param {Tab} tab
 */
export function renderWorkspaceHome(surface: CanvasSurface, tab: Tab): void {
  const { paneId } = surface;
  if (workspaceHomeMounted(paneId, tab)) {
    return;
  }
  detachWorkspaceHome(paneId);
  const id = homeWorkspaceOfTabId(tab.id);
  if (id === "media") {
    renderMediaLibrary(surface, tab);
    return;
  }
  if (id === "content") {
    renderLibraryMode(surface, tab);
    return;
  }
  renderPublishWorkspace(surface, tab);
}
