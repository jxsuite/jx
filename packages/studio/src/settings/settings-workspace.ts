/// <reference lib="dom" />
/**
 * Project Settings as a workspace (§17.1, §22.9): the home that hosts the settings editor, mounted
 * into a pane's stage, and the two ways out of it.
 *
 * Project Settings was a dialog, and before that the `project.json` tab under a `settings` editor
 * mode. The dialog was reachable from every workspace, but a dialog is a box of fixed size over a
 * window that has a whole stage to spare, and the map-layout sections (Content types, Data tables,
 * Connections) are two columns of their own inside the editor's two columns: four columns in 900px.
 * A workspace gives the editor the stage, and keeps what the dialog was for: Settings is reached
 * from every workspace through its links (the gear menu, ⌘⇧, and every `settings.open` deep link),
 * and **Back** returns to the workspace it was opened from, which the top bar cannot say because it
 * draws no tab for Settings.
 *
 * **Per pane**, for the reason `publish/publish-workspace.ts` gives: the home is a tab, so two
 * panes can each show it. Each mount is the editor, built when the home is drawn and taken down
 * when the pane's stage moves on (a switch to another workspace, a project closing). A visit is
 * therefore a fresh editor: a half-typed entry or a failed save's error from the last visit, or
 * from another project's, does not come back. **Which section shows is the registry's**, not this
 * module's (`settings/section-registry.ts`), and the registry outlives every mount, which is what
 * makes Settings reopen where the author left it for the rest of the session.
 *
 * @docs studio/projects/settings
 */

import { activeRegistry } from "../commands/active-registry";
import { runActiveReported } from "../commands/run-reported";
import { mountSettingsPane } from "../panels/settings-pane";
import { previousWorkspace } from "../shell";
import { paneRegion } from "../ui/regions";
import { DEFAULT_WORKSPACE, workspaceInfo } from "../workspace/workspace-ids";
import type { CanvasSurface } from "../canvas/canvas-surface";
import type { SettingsPaneMount, SettingsPaneOptions } from "../panels/settings-pane";
import type { PublishTab } from "../publish/publish-ids";
import type { InspectorTabId } from "../shell";
import type { StylesView } from "../style/project-styles";
import type { Tab } from "../tabs/tab";
import type { WorkspaceId } from "../workspace/workspace-ids";

/** The region part the home is stamped with, under its pane: `pane.<id>/settings`. */
export const SETTINGS_REGION_PART = "settings";

/** The region of the Settings home in `paneId`. */
export function settingsRegion(paneId: string): string {
  return paneRegion(paneId, SETTINGS_REGION_PART);
}

/** One pane's mount: the editor, and which tab and stage it was drawn for. */
interface PaneMount {
  pane: SettingsPaneMount;
  tabId: string;
  wrap: HTMLElement;
}

const _panes = new Map<string, PaneMount>();

/** Panes whose next mount takes the keyboard: Settings was asked for before its home was drawn. */
const _focusOnMount = new Set<string>();

/**
 * Where Back goes: the workspace entered before Settings, or Design when there was none (a session
 * that was restored into Settings).
 */
export function returnWorkspace(): WorkspaceId {
  const previous = previousWorkspace();
  return previous === null || previous === "settings" ? DEFAULT_WORKSPACE : previous;
}

/**
 * Leave Settings for the workspace it was opened from.
 *
 * A refusal (the switch is gated on an open project) is filed in Problems under this surface's name
 * instead of being dropped.
 */
export async function leaveSettings(): Promise<void> {
  await runActiveReported("view.setWorkspace", { workspace: returnWorkspace() }, "Settings");
}

/**
 * Leave Settings for the workspace something moved to: the Moved footnote's buttons.
 *
 * A row that names an Inspector tab ("Head and SEO defaults → Page tab") also shows the Inspector
 * on that tab, AFTER the switch, because entering a workspace applies its frame preset and would
 * otherwise put the dock back as the preset has it. The tab is a document-level view, so with no
 * document open there is no tab to show and asking would only file a refusal; the dock is still
 * opened, which is where the tab appears once one is.
 *
 * A row that names a Styles view ("Colors and fonts → Styles › Variables") runs `styles.open` with
 * that view instead, which is the same workspace switch followed by the view, and a row that names
 * a Publish sub-tab runs `publish.open` on it.
 *
 * @param {WorkspaceId} workspace
 * @param {InspectorTabId} [inspector]
 * @param {StylesView} [view]
 * @param {PublishTab} [publishTab]
 * @returns {Promise<void>} Settles once every command the row runs has settled
 */
export async function openMoved(
  workspace: WorkspaceId,
  inspector?: InspectorTabId,
  view?: StylesView,
  publishTab?: PublishTab,
): Promise<void> {
  if (view !== undefined) {
    await runActiveReported("styles.open", { view }, "Settings");
    return;
  }
  // Hosting is a Publish sub-tab, not the workspace's first: the button says where it lands.
  if (publishTab !== undefined) {
    await runActiveReported("publish.open", { tab: publishTab }, "Settings");
    return;
  }
  await runActiveReported("view.setWorkspace", { workspace }, "Settings");
  if (inspector === undefined) {
    return;
  }
  await runActiveReported("view.setRightPanel", { open: true }, "Settings");
  if (activeRegistry()?.isEnabled("view.setRightTab") === true) {
    await runActiveReported("view.setRightTab", { tab: inspector }, "Settings");
  }
}

/** Whether this tab's home is already mounted in this pane and still in the document. */
export function settingsWorkspaceMounted(paneId: string, tab: Tab): boolean {
  const mount = _panes.get(paneId);
  return (
    mount !== undefined && mount.tabId === tab.id && mount.wrap.isConnected && mount.pane.attached()
  );
}

/** Tear one pane's home down (mode change, tab switch, project close). Idempotent. */
export function detachSettingsWorkspace(paneId: string): void {
  const mount = _panes.get(paneId);
  if (!mount) {
    return;
  }
  _panes.delete(paneId);
  mount.pane.dispose();
}

/** Put the keyboard on the current section's row once the editor has drawn it. */
async function focusWhenReady(paneId: string, mount: PaneMount): Promise<void> {
  await mount.pane.ready;
  if (_panes.get(paneId) === mount) {
    await mount.pane.focusActive();
  }
}

/**
 * Give the keyboard to the Settings home in `paneId`, on the current section's row: what opening
 * Settings does, so an author who asked for Advanced › Raw JSON is on Raw JSON rather than on the
 * first group's tab stop. Served now when the home is standing in the pane, or by its next mount
 * there.
 *
 * @param {string} paneId
 * @returns {Promise<void>} Settles once the keyboard has moved, or once the request is queued
 */
export async function focusSettingsHome(paneId: string): Promise<void> {
  const mount = _panes.get(paneId);
  if (mount?.wrap.isConnected === true && mount.pane.attached()) {
    await focusWhenReady(paneId, mount);
    return;
  }
  _focusOnMount.add(paneId);
}

/**
 * What the home's controls do, the same in every pane: Back and the Moved buttons are workspace
 * switches, window-level commands that act wherever the author is, and no fact about the pane the
 * home is drawn in goes into them. Declared here rather than in {@link renderSettingsWorkspace} so
 * nothing that consults the window's state is reached from a function holding a pane.
 */
const HOME_ACTIONS: Omit<SettingsPaneOptions, "region"> = {
  back: () => {
    void leaveSettings();
  },
  backLabel: () => `Back to ${workspaceInfo(returnWorkspace()).title}`,
  openMoved: (workspace, inspector, view, publishTab) => {
    void openMoved(workspace, inspector, view, publishTab);
  },
};

/**
 * Draw the Settings home into a pane's stage. It reads the pane's id and its stage, and nothing
 * else of the canvas surface.
 *
 * @param {Pick<CanvasSurface, "paneId" | "wrap">} surface
 * @param {Tab} tab
 */
export function renderSettingsWorkspace(
  surface: Pick<CanvasSurface, "paneId" | "wrap">,
  tab: Tab,
): void {
  const { paneId, wrap } = surface;
  if (settingsWorkspaceMounted(paneId, tab)) {
    return;
  }
  detachSettingsWorkspace(paneId);
  const pane = mountSettingsPane(wrap, { ...HOME_ACTIONS, region: settingsRegion(paneId) });
  const mount: PaneMount = { pane, tabId: tab.id, wrap };
  _panes.set(paneId, mount);
  if (_focusOnMount.delete(paneId)) {
    void focusWhenReady(paneId, mount);
  }
}
