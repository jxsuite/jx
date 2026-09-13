/// <reference lib="dom" />
/**
 * Which `<dialog>` the canvas draws open, and the rule that decides it from a selection.
 *
 * The dialog twin of `popover-state.ts`, and the same shape on purpose: one writer of
 * `ui.openDialog` (`setOpenDialog`), one asymmetric reveal rule (selecting at or inside a dialog
 * opens it; selecting outside every dialog leaves the open one alone, so it can be styled from the
 * Inspector), and no watch of its own — `popover-state.ts`'s reveal effect runs both rules, because
 * two effects over the same selection would be two observers of one fact.
 *
 * A dialog shown in place is the canvas's affordance and nothing more: `session.ui.openDialog` is
 * per-tab view state, takes no undo entry, does not replicate, and is not restored with a session.
 * Preview renders the dialog natively, modal, backdrop and all.
 *
 * @docs studio/interface/canvas
 */

import { ancestorDialogPath } from "./dialog-path";
import { postDialogOpen } from "./iframe-host";
import { primarySelection } from "../tabs/selection";
import { updateSession } from "../store";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { JxPath } from "../state";
import type { Tab } from "../tabs/tab";

/** Whether two paths address the same node. */
function samePath(a: JxPath | null, b: JxPath | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.length === b.length && a.every((seg, i) => seg === b[i]);
}

/**
 * Write `ui.openDialog` and tell every frame showing this tab.
 *
 * The single writer. `canvas.setDialogOpen`, the reveal rule and an invoker's click in the canvas
 * all land here, so the model and the frames cannot disagree about which dialog is open.
 *
 * @param tab The tab whose dialog state is written.
 * @param path The dialog to open, or null to close.
 */
export function setOpenDialog(tab: Tab, path: JxPath | null): void {
  updateSession(tab, { ui: { openDialog: path } });
  postDialogOpen(tab, path);
}

/**
 * Open the dialog `path` is at or inside, if it is not already the open one.
 *
 * @returns Whether anything changed.
 */
export function openDialogFor(tab: Tab, path: JxPath | null): boolean {
  const target = ancestorDialogPath(tab.doc.document as JxMutableNode, path);
  if (target === null || samePath(tab.session.ui.openDialog, target)) {
    return false;
  }
  setOpenDialog(tab, target);
  return true;
}

/** The reveal rule for dialogs, over the tab's primary selection. */
export function reconcileOpenDialog(tab: Tab | null | undefined): void {
  if (tab) {
    openDialogFor(tab, primarySelection(tab.session.selection));
  }
}
