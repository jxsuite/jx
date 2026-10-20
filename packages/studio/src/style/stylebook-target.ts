/**
 * What a tab is styling while it draws the Styles workspace's Elements view: a TAG, not a node.
 *
 * The Elements view is a catalogue of specimens, and picking one moves `shell.stylebook.selection`
 * (`selectStylebookTag`), never the tab's document selection: an `h1` specimen is not a node of
 * `project.json`, so there is no path that names it. Every place that answers "what am I pointed
 * at" (the status bar's selection field, the command bar's selection segment, the Inspector's
 * header) asks this first, and falls back to the document selection only when it says null. Before
 * they shared it, two of the three read the document selection alone, and the Outline's row click
 * parked that on the root, so `h1 · Base` was being edited under a header and a path that both said
 * `div`.
 *
 * The answer is null outside the Elements view, which is the whole condition the status bar always
 * had: the stylebook selection outlives a workspace switch (coming back to Styles finds `h1` still
 * picked), but a Content page, the Variables view or the Publish home is not editing `h1`.
 */

import { shell } from "../shell";
import { PROJECT_STYLES_VIEW } from "./project-styles";

import type { Tab } from "../tabs/tab";

/** The tag the tab's Elements view is styling, or null when the tab is not styling a tag. */
export function stylebookTarget(tab: Tab | null | undefined): string | null {
  return tab?.session.ui.canvasMode === PROJECT_STYLES_VIEW ? shell.stylebook.selection : null;
}
