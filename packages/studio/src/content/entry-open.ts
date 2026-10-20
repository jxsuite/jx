/**
 * Opening a content entry: on the canvas in its writing editor, or in the form when it has no body.
 *
 * `specs/studio.md` §22.5: an entry is written on the canvas, inside its template's layout. Opening
 * one opens the entry's OWN file as an ordinary tab — same id, history and dirty flag as a click in
 * any file list — in its writing editor (`edit`), which the Content workspace owns (§22.1), so the
 * Inspector's Entry tab and the writing-mode banner come with it. Every door into an entry goes
 * through {@link openEntry}: a row in the Content home, an entry in the Collections panel,
 * `content.openEntry`, and the entry Add new just made.
 *
 * The form-only `entry` editor (`content/entry-editor.ts`) stays as the fallback for an entry the
 * canvas cannot write: a JSON entry IS its fields and has no body, and a file-backed collection's
 * entries are rows of one file, which open in the grid.
 *
 * @docs studio/projects/content-types
 */

import { activateTab, workspace } from "../workspace/workspace";
import { collectionForFile } from "./collection-match";
import { writesEntryOnCanvas } from "./content-collections";
import { openEntryEditor } from "./entry-editor";
import type { Tab } from "../tabs/tab";

/** The editor an entry is written in on the canvas. */
export const WRITING_MODE = "edit";

/** The editors a tab already writes on the canvas in, which an open leaves alone. */
const CANVAS_MODES: ReadonlySet<string> = new Set(["edit", "design"]);

/**
 * The open tab for a path, if any (a document tab's id is its path, but a renamed one keeps its
 * id).
 */
function tabFor(path: string): Tab | null {
  for (const tab of workspace.tabs.values()) {
    if (tab.documentPath === path) {
      return tab;
    }
  }
  return null;
}

/**
 * Open a content entry where it is written.
 *
 * - An entry with a body opens on the canvas in `edit`. A tab already writing it on the canvas
 *   (`edit` or `design`) keeps its view; a tab showing its form is switched back to writing.
 * - A JSON entry opens in the form editor.
 * - Any other file opens as `openFileInTab` would open it.
 *
 * @returns The tab, or `null` when the file could not be opened.
 */
export async function openEntry(path: string): Promise<Tab | null> {
  if (!writesEntryOnCanvas(path)) {
    const match = collectionForFile(path);
    if (match && !match.fileBacked) {
      return openEntryEditor(path);
    }
    /* Dynamic for the reason `entry-editor.ts` gives: `files/files.ts` reaches the platform, the
       format registry and the packages layer. */
    const { openFileInTab } = await import("../files/files");
    await openFileInTab(path);
    return tabFor(path);
  }
  const { openFileInTab } = await import("../files/files");
  await openFileInTab(path);
  const tab = tabFor(path);
  if (!tab) {
    return null;
  }
  if (
    !CANVAS_MODES.has(tab.session.ui.canvasMode) &&
    tab.capabilities.modes.includes(WRITING_MODE)
  ) {
    tab.session.ui.canvasMode = WRITING_MODE;
    tab.session.ui.preview = false;
  }
  activateTab(tab.id);
  return tab;
}
