/**
 * Back to the workspace home — the way out of a view in a workspace that draws no tab strip.
 *
 * Media, Styles and Publish draw their home surface without a strip (`shell.ts`'s
 * `WorkspacePreset.tabStrip`, `specs/studio.md` §22.3). What they open beside their home has to be
 * leave-able anyway, and without a strip there is no chip to click and no × to press:
 *
 * - **Media**: a media file opened in its viewer leads back to the media library.
 * - **Publish**: a comparison (`git-diff`) leads back to the Publish home.
 * - **Styles**: `project.json` in its Code view leads back to the view the Styles home was left in,
 *   Variables or Elements. Code is a view of the same tab, so going back switches the view and
 *   closes nothing.
 *
 * {@link backTargetOf} is the one rule, read by the pane context bar (which draws the Back control,
 * naming the destination) and by `pane.backToHome` (the control's command, and Escape's). A media
 * viewer or a comparison is CLOSED on the way back, so the home is what is left: a strip-less pane
 * holds its home and one view beside it rather than a pile of views nobody can see, and the close
 * lands on the home (`workspace/workspace-switch.ts`'s close landing). Closing such a view any
 * other way (⌘W) lands there too.
 *
 * @docs studio/interface/tabs
 */

import { shell, workspaceDrawsTabStrip } from "../shell";
import { PROJECT_CONFIG_PATH } from "../tabs/tab";
import { tabOfPane } from "../canvas/canvas-surface";
import { workspace } from "./workspace";
import { workspaceOfTab } from "./tab-workspace";
import { homeWorkspaceOfTabId, isHomeWorkspace, workspaceInfo } from "./workspace-ids";
import { argsSchema, optionalStringArg, stringProperty } from "../commands/command-args";
import { EDITOR_KIND_LABELS, editorKindForMode } from "../commands/context";
import { isPopoverOpen } from "../ui/layers";
import type { WorkspaceId } from "./workspace-ids";
import type { Tab } from "../tabs/tab";
import type { AnyCommand } from "../commands/registry";

/** Where the Back control leads, and how it gets there. */
export type BackTarget =
  | {
      /** Close the view: the home beside it is what the pane shows next. */
      kind: "close";
      /** The control's text, naming the destination: "Back to Media". */
      label: string;
      /** Its tooltip: what happens to the view. */
      hint: string;
    }
  | {
      /** Switch the tab to another of its views (Styles' Code view back to the home view). */
      kind: "view";
      label: string;
      hint: string;
      /** The canvas mode to switch to: `tokens` or `stylebook`. */
      mode: string;
    };

/** The Code view's mode over `project.json`. */
const SOURCE_MODE = "source";

/**
 * Where a tab's Back control leads in workspace `id`, or `null` when there is nowhere to go back
 * to: a workspace that draws a strip (its strip is the way between documents), a tab of another
 * workspace, and a workspace's home itself.
 *
 * @param tab The tab a pane is showing
 * @param id The workspace on screen
 */
export function backTargetOf(
  tab: Tab | null,
  id: WorkspaceId = shell.workspace,
): BackTarget | null {
  if (!tab || workspaceDrawsTabStrip(id) || workspaceOfTab(tab) !== id) {
    return null;
  }
  if (id === "styles") {
    if (tab.documentPath !== PROJECT_CONFIG_PATH || tab.session.ui.canvasMode !== SOURCE_MODE) {
      return null;
    }
    const mode = shell.stylebook.view;
    const name = EDITOR_KIND_LABELS[editorKindForMode(mode)];
    return {
      hint: `Leave the Code view for the ${name} view of your styles`,
      kind: "view",
      label: `Back to ${name}`,
      mode,
    };
  }
  if (!isHomeWorkspace(id) || homeWorkspaceOfTabId(tab.id) === id) {
    return null;
  }
  const home = workspaceInfo(id).title;
  return {
    hint: `Close this view and return to ${home}`,
    kind: "close",
    label: `Back to ${home}`,
  };
}

/** {@link backTargetOf} for the tab a pane is showing. */
export function backTargetOfPane(paneId: string): BackTarget | null {
  return backTargetOf(tabOfPane(paneId));
}

/** What going back needs that this module may not import. */
export interface WorkspaceBackDeps {
  /** Close a tab through the strip's guarded close (`panels/tab-strip.ts` `requestClose`). */
  closeTab: (tabId: string) => void | Promise<void>;
  /** Switch a tab's editor (`studio.ts` `setCanvasMode`). */
  setCanvasMode: (tab: Tab, mode: string) => void;
  /**
   * Give the keyboard to the home a close landed on: the Media home's tile, the Publish change the
   * comparison was opened from. Without it the focus falls to the page body with the view.
   */
  focusHome?: (paneId: string, id: WorkspaceId) => void;
}

/**
 * Go back from what `paneId` shows to its workspace's home. `false` when there is nowhere to go.
 *
 * @param paneId The pane whose Back control was pressed
 * @param deps The close and the view switch
 */
export async function goBack(paneId: string, deps: WorkspaceBackDeps): Promise<boolean> {
  const tab = tabOfPane(paneId);
  const target = backTargetOf(tab);
  if (!tab || !target) {
    return false;
  }
  if (target.kind === "view") {
    tab.session.ui.preview = false;
    deps.setCanvasMode(tab, target.mode);
    return true;
  }
  const id = shell.workspace;
  await deps.closeTab(tab.id);
  // Only when the close went through: a refused close (unsaved work kept) leaves the view standing.
  if (!workspace.tabs.has(tab.id)) {
    deps.focusHome?.(paneId, id);
  }
  return true;
}

/**
 * `pane.backToHome`: the Back control's command, and Escape's.
 *
 * Gated with `when`, not `enablement`, because Escape is the chord: a disabled record still claims
 * its chord, and every other Escape in the global scope would be swallowed by a Back that is not
 * there. Three places keep their own Escape: a text field (the caret is a field's, and Escape there
 * is the field's own); the Code view, where Escape belongs to the code editor's widgets, so the
 * Back control is how Code is left; and an open popover (the pane context bar's Context menu, for
 * one), which the platform closes on Escape, and which a cancelled Escape would leave standing over
 * a view that had gone.
 *
 * @param deps The close and the view switch
 */
export function workspaceBackCommands(deps: WorkspaceBackDeps): AnyCommand[] {
  return [
    {
      args: argsSchema(
        {
          pane: stringProperty("Which pane to go back in. Defaults to the focused one."),
        },
        [],
      ),
      id: "pane.backToHome",
      title: "Back to Workspace Home",
      category: "View",
      level: "document",
      keybinding: "escape",
      menus: ["palette"],
      group: "5_pane",
      when: (ctx) =>
        !ctx.caret.active &&
        ctx.editor.kind !== "code" &&
        !isPopoverOpen() &&
        backTargetOfPane(workspace.activePaneId) !== null,
      requires: "a view opened beside a workspace home",
      undo: "none",
      run: async (_ctx, args) => {
        const paneId = optionalStringArg("pane.backToHome", args, "pane") ?? workspace.activePaneId;
        if (!(await goBack(paneId, deps))) {
          throw new RangeError(
            `command "pane.backToHome": pane "${paneId}" shows no view opened beside a ` +
              "workspace home, so there is nothing to go back from",
          );
        }
      },
    },
  ];
}
