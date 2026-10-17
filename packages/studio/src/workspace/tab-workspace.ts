/**
 * Which workspace a tab belongs to, and which of a pane's tabs its strip draws.
 *
 * Every tab belongs to exactly one workspace, and the answer is DERIVED from the tab rather than
 * stored on it: what a tab is (a Library, a media file, a comparison) and how it is being edited
 * (the configuration document's stylebook editor) are already on the tab, so a stored field would
 * be a second record of the same fact, free to disagree with it.
 *
 * - **Content**: the Library and the collection and page grids; an entry's form editor; and any file
 *   a content collection owns (collection-match.ts is the one matcher), because an entry is written
 *   in Content even when it is opened from somewhere else.
 * - **Media**: the media home and every media file's viewer.
 * - **Styles**: `project.json`, in either of its editors (Project Styles or the source). Project
 *   Settings is a dialog over every workspace (§17.1), not a tab, so it belongs to none.
 * - **Publish**: the publish home and every comparison (`git-diff`).
 * - **Design**: everything else: pages, templates, components and every other file.
 *
 * The rules read the tab's CURRENT editor, so switching an entry from its form to the canvas keeps
 * it in Content while a grid's kind decides between Content and Design, and
 * `workspace/workspace-switch.ts` follows the tab wherever that puts it.
 *
 * @docs studio/interface
 */

import { shell } from "../shell";
import { workspace } from "./workspace";
import { homeWorkspaceOfTabId } from "./workspace-ids";
import { parseGridTabId } from "../grid/grid-source";
import { collectionForFile } from "../content/collection-match";
import { PROJECT_CONFIG_PATH } from "../tabs/tab";
import type { Pane } from "./workspace";
import type { WorkspaceId } from "./workspace-ids";
import type { Tab } from "../tabs/tab";

/** The editors that are Content's whatever document they are over. */
const CONTENT_MODES: ReadonlySet<string> = new Set(["entry", "manage"]);

/** The workspace `tab` belongs to. Pure over the tab and the open project's configuration. */
export function workspaceOfTab(tab: Tab): WorkspaceId {
  const home = homeWorkspaceOfTabId(tab.id);
  if (home) {
    return home;
  }
  const mode = tab.session.ui.canvasMode;
  if (mode === "git-diff") {
    return "publish";
  }
  if (mode === "media") {
    return "media";
  }
  if (CONTENT_MODES.has(mode)) {
    return "content";
  }
  const grid = parseGridTabId(tab.id);
  if (grid) {
    // A data-table grid is the Data panel's, which is Design's; every other grid is content.
    return grid.kind === "data" ? "design" : "content";
  }
  if (tab.documentPath === PROJECT_CONFIG_PATH) {
    return "styles";
  }
  const collection = collectionForFile(tab.documentPath);
  if (collection && !collection.fileBacked) {
    return "content";
  }
  return "design";
}

/** The editors in which a document is written on the canvas, where the Inspector applies. */
const CANVAS_WRITING_MODES: ReadonlySet<string> = new Set(["edit", "design"]);

/**
 * Whether a tab is a document being written on the canvas: a file-backed tab in an editing canvas
 * mode. A Library, a grid, an entry's form, a home and a code view are not. Content's preset reads
 * it to draw the Inspector while an entry is written (`shell.ts`'s `WORKSPACE_PRESETS`).
 */
export function writesOnCanvas(tab: Tab): boolean {
  return (
    tab.documentPath !== null &&
    parseGridTabId(tab.id) === null &&
    CANVAS_WRITING_MODES.has(tab.session.ui.canvasMode)
  );
}

/** Whether a tab id names an open tab of the workspace on screen. */
export function isTabInWorkspace(tabId: string, id: WorkspaceId = shell.workspace): boolean {
  const tab = workspace.tabs.get(tabId);
  return tab !== undefined && workspaceOfTab(tab) === id;
}

/**
 * The tabs a pane's strip draws: its own, in strip order, less every tab of another workspace.
 *
 * The order is the pane's, so a drop index computed against {@link Pane.tabOrder} still lands
 * between the two chips it was dropped between: the hidden tabs keep their slots, they are only not
 * drawn.
 */
export function workspaceTabOrder(pane: Pane, id: WorkspaceId = shell.workspace): string[] {
  return pane.tabOrder.filter((tabId) => isTabInWorkspace(tabId, id));
}

/**
 * The tab a workspace was last in: the most recently used of its open tabs, in any pane, or the
 * first of them in strip order when none has been used yet (a restored session's tabs are opened
 * without being focused). `null` when the workspace has no tab open.
 */
export function lastTabOfWorkspace(id: WorkspaceId): string | null {
  const recent = workspace.mruOrder.find((tabId) => isTabInWorkspace(tabId, id));
  if (recent) {
    return recent;
  }
  for (const pane of workspace.panes) {
    const first = pane.tabOrder.find((tabId) => isTabInWorkspace(tabId, id));
    if (first) {
      return first;
    }
  }
  return null;
}

/** The tab `pane` should show for a workspace: its most recent one there, or `null`. */
export function paneTabOfWorkspace(pane: Pane, id: WorkspaceId): string | null {
  if (pane.activeTabId && isTabInWorkspace(pane.activeTabId, id)) {
    return pane.activeTabId;
  }
  return (
    workspace.mruOrder.find(
      (tabId) => pane.tabOrder.includes(tabId) && isTabInWorkspace(tabId, id),
    ) ??
    pane.tabOrder.find((tabId) => isTabInWorkspace(tabId, id)) ??
    null
  );
}
