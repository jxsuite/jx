/// <reference lib="dom" />
/**
 * Workspace homes — the virtual tab a workspace opens on when none of its own tabs is open.
 *
 * A home is a tab like the Library is a tab: it sits in a pane's strip, it can be closed, and it
 * has a canvas mode of its own (`media-home`, `publish-home`) that `canvas/canvas-render.ts` routes
 * here. It has no document — the tab carries a stub, exactly as the grid tabs do — and its id is in
 * the `workspace://` space `workspace/workspace-ids.ts` declares, so it can never collide with a
 * file.
 *
 * What a home DRAWS today is a small empty state naming the workspace and what it is for
 * (`surfaces/workspace-home.json`). That is deliberately the whole of it: the Media and Publish
 * workspaces each replace their home's body with a surface of their own, and the mechanism (the
 * tab, the mode, the routing and the per-pane mount) is what stays.
 *
 * @docs studio/interface
 */

import { activateTab, openTab, workspace } from "./workspace";
import {
  WORKSPACE_HOME_MODES,
  homeWorkspaceOfTabId,
  workspaceHomeTabId,
  workspaceInfo,
} from "./workspace-ids";
import { mountWorkspaceHomeSurface } from "../surfaces/workspace-home";
import { paneRegion } from "../ui/regions";
import type { HomeWorkspaceId } from "./workspace-ids";
import type { Tab } from "../tabs/tab";
import type { CanvasSurface } from "../canvas/canvas-surface";
import type { WorkspaceHomeHandle, WorkspaceHomeView } from "../surfaces/workspace-home";

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

// ─── Mounting ────────────────────────────────────────────────────────────────

interface ActiveHome {
  tabId: string;
  wrap: HTMLElement;
  surface: WorkspaceHomeHandle;
}

/**
 * The home mounted in each pane, keyed by pane id. Per pane rather than a singleton for the reason
 * `media/media-pane.ts` gives: two panes can each show a home at once.
 */
const _active = new Map<string, ActiveHome>();

/** Whether this tab's home is already mounted in this pane and still in the document. */
export function workspaceHomeMounted(paneId: string, tab: Tab): boolean {
  const home = _active.get(paneId);
  return (
    home !== undefined && home.tabId === tab.id && home.wrap.isConnected && home.surface.attached()
  );
}

/** Tear one pane's home down (mode change, tab switch, project close). Idempotent. */
export function detachWorkspaceHome(paneId: string): void {
  const home = _active.get(paneId);
  if (!home) {
    return;
  }
  home.surface.dispose();
  _active.delete(paneId);
}

/**
 * The second sentence each home draws: where the work is done TODAY. The purpose sentence says what
 * the workspace is for; until its own surface lands, a home that stopped there would promise an
 * action the page does not offer, so it points at the place that does.
 */
const HOME_DETAIL: Readonly<Record<HomeWorkspaceId, string>> = {
  media: "For now, your media files are in the Files panel and in the Library's Media category.",
  publish: "For now, commit and sync your changes from Source Control in the Design workspace.",
};

/** What a home tab's surface draws. */
export function workspaceHomeView(paneId: string, tab: Tab): WorkspaceHomeView {
  const id = homeWorkspaceOfTabId(tab.id) ?? "publish";
  const info = workspaceInfo(id);
  return {
    detail: HOME_DETAIL[id],
    icon: info.icon,
    purpose: info.purpose,
    region: paneRegion(paneId, "home"),
    title: info.title,
    workspace: id,
  };
}

/**
 * Draw a home tab into its pane's stage.
 *
 * @param {CanvasSurface} surface
 * @param {Tab} tab
 */
export function renderWorkspaceHome(surface: CanvasSurface, tab: Tab): void {
  const { paneId, wrap } = surface;
  if (workspaceHomeMounted(paneId, tab)) {
    return;
  }
  detachWorkspaceHome(paneId);
  const mounted = mountWorkspaceHomeSurface(wrap, workspaceHomeView(paneId, tab));
  _active.set(paneId, { surface: mounted, tabId: tab.id, wrap });
}
