/// <reference lib="dom" />
/**
 * Project Settings as a dialog (§17.1): the flow that opens it, mounts the settings editor into it,
 * and takes both down.
 *
 * Project Settings was a document in the pane, the `project.json` tab under a `settings` editor
 * mode. The five workspaces made that the wrong home: a tab belongs to exactly one workspace, and
 * configuration belongs to all of them, so a settings TAB either pulled the author out of the
 * workspace they were in or had to be special-cased in every one. A dialog is reachable from every
 * workspace and leaves the one underneath where it was. What made the old modal a problem (a form
 * that hid the canvas it was tuning) left with the design tokens, which are the Styles workspace's
 * now; every section still here writes `project.json` as it is edited, through the one chokepoint
 * (`tabs/project-config.ts`), so the dialog has nothing to confirm and its one answer is Close.
 *
 * **Which section shows is the registry's, not this module's.** `settings/section-registry.ts`
 * holds the requested and the displayed section and outlives the dialog, which is what makes the
 * dialog reopen where the author left it for the rest of the session.
 *
 * Modality, Escape and focus restoration are the platform's: a `jx-dialog` in the dialog layer,
 * opened with `showModal()`, which puts focus back on whatever opened it when it closes.
 *
 * @docs studio/projects/settings
 */

import { activeRegistry } from "../commands/active-registry";
import { runActiveReported } from "../commands/run-reported";
import { mountSettingsPane } from "../panels/settings-pane";
import { openSettingsDialogSurface } from "../surfaces/settings-dialog";
import { layerHost } from "../ui/layers";
import type { SettingsPaneMount } from "../panels/settings-pane";
import type { DialogLayerHandle } from "../ui/surface";
import type { InspectorTabId } from "../shell";
import type { WorkspaceId } from "../workspace/workspace-ids";
import type { StylesView } from "../style/project-styles";
import type { PublishTab } from "../publish/publish-ids";

/** The open dialog, or `null` while none is up. */
let _dialog: DialogLayerHandle | null = null;

/** The editor mounted in the open dialog's body. */
let _pane: SettingsPaneMount | null = null;

/**
 * Leave Settings for the workspace something moved to: the Moved footnote's buttons.
 *
 * Closed FIRST, so the workspace the author asked for is what they see and focus returns to the
 * frame rather than to a row that is going away. A refusal (the switch is gated on an open project)
 * is filed in Problems under this surface's name instead of being dropped.
 *
 * A row that names an Inspector tab ("Head and SEO defaults → Page tab") also shows the Inspector
 * on that tab, AFTER the switch, because entering a workspace applies its frame preset and would
 * otherwise put the dock back as the preset has it. The tab is a document-level view, so with no
 * document open there is no tab to show and asking would only file a refusal; the dock is still
 * opened, which is where the tab appears once one is.
 *
 * A row that names a Styles view ("Colors and fonts → Styles › Variables") runs `styles.open` with
 * that view instead, which is the same workspace switch followed by the view.
 *
 * @param {WorkspaceId} workspace
 * @param {InspectorTabId} [inspector]
 * @param {StylesView} [view]
 * @returns {Promise<void>} Settles once every command the row runs has settled
 */
async function openMoved(
  workspace: WorkspaceId,
  inspector?: InspectorTabId,
  view?: StylesView,
  publishTab?: PublishTab,
): Promise<void> {
  closeSettingsDialog();
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

/**
 * Open Project Settings, or leave it up when it already is.
 *
 * Re-opening while it is up does not stack a second dialog: the section the caller asked for has
 * already been written to the registry, which redraws the editor that is showing.
 *
 * @returns {Promise<void>} Settles once the dialog is showing and the current section's row holds
 *   the keyboard
 */
export async function openSettingsDialog(): Promise<void> {
  if (_dialog) {
    await _dialog.ready;
    return;
  }
  const dialog = openSettingsDialogSurface({
    body: (host) => {
      _pane = mountSettingsPane(host, {
        openMoved: (workspace, inspector, view, publishTab) => {
          void openMoved(workspace, inspector, view, publishTab);
        },
      });
    },
    /* Escape or Close: the platform closed the dialog, so take the editor and the slot down with
       it. `close()` is idempotent, so the flow's own close running first is fine. */
    closed: () => {
      if (_dialog === dialog) {
        closeSettingsDialog();
      }
    },
    layer: layerHost("dialog"),
  });
  _dialog = dialog;
  await dialog.ready;
  /* Read after the wait, from the module: the body is created while the dialog mounts, and a close
     in between has already taken the editor down and cleared this. */
  const mounted = _pane;
  if (mounted === null || _dialog !== dialog) {
    return;
  }
  await mounted.ready;
  if (_dialog === dialog) {
    mounted.focusActive();
  }
}

/** Close Project Settings if it is open. Idempotent. */
export function closeSettingsDialog(): void {
  const dialog = _dialog;
  const pane = _pane;
  _dialog = null;
  _pane = null;
  pane?.dispose();
  dialog?.close();
}
