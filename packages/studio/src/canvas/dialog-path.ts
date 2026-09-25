/// <reference lib="dom" />
/**
 * Which `<dialog>` a document path belongs to — the pure half of the open-on-selection rule for
 * dialogs, and the dialog twin of `popover-path.ts`.
 *
 * Separate from `dialog-state.ts` for the reason its twin gives: the command record in
 * `canvas-utils.ts` has to answer "is there a dialog here?" for its `enablement`, and
 * `dialog-state.ts` reaches `iframe-host.ts`, which reaches `canvas-utils.ts`. Nothing here touches
 * a frame, a channel or the DOM.
 *
 * @docs studio/interface/canvas
 */

import { activeTab } from "../workspace/workspace";
import { getNodeAtPath } from "../state";
import { documentHasDialog, isDialog } from "@jxsuite/schema/dialogs";
import { primarySelection } from "../tabs/selection";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { JxPath } from "../state";
import type { Tab } from "../tabs/tab";

/**
 * The nearest ancestor-or-self of `path` that is a `<dialog>`, or null when there is none.
 *
 * Walks prefixes of the path rather than the tree, exactly as `ancestorPopoverPath` does, so a
 * `map` or `cases` hop needs no special case.
 *
 * @param doc The document the path addresses.
 * @param path The selected node's path.
 * @returns The dialog's path, or null.
 */
export function ancestorDialogPath(
  doc: JxMutableNode | null | undefined,
  path: JxPath | null | undefined,
): JxPath | null {
  if (!doc || !path) {
    return null;
  }
  for (let end = path.length; end >= 0; end -= 1) {
    const prefix = path.slice(0, end);
    const node = getNodeAtPath(doc, prefix);
    if (node && typeof node === "object" && isDialog(node)) {
      return prefix;
    }
  }
  return null;
}

/**
 * The dialog a `canvas.setDialogOpen` call means for `tab`, or null when there is none.
 *
 * An explicit `path` is taken at its word but still CHECKED, so a path that is not a dialog is
 * refused rather than silently opening nothing. With no argument the answer is the dialog the
 * SELECTION is at or inside.
 *
 * @param tab The tab whose document is consulted.
 * @param explicit A path the caller named, if any.
 * @returns The dialog's path, or null.
 */
export function dialogPathFor(tab: Tab, explicit?: JxPath): JxPath | null {
  const doc = tab.doc.document as JxMutableNode | undefined;
  if (!doc) {
    return null;
  }
  if (explicit) {
    const node = getNodeAtPath(doc, explicit);
    return node && typeof node === "object" && isDialog(node) ? explicit : null;
  }
  return ancestorDialogPath(doc, primarySelection(tab.session.selection));
}

/** Whether the active document holds a `<dialog>` at all — the command's `enablement`. */
export function activeDocumentHasDialog(): boolean {
  const doc = activeTab.value?.doc.document as JxMutableNode | undefined;
  return doc ? documentHasDialog(doc) : false;
}
