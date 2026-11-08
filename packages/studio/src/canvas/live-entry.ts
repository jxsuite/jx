/**
 * The entry a collection page draws, as the canvas feeds it to the page (studio.md §22.5).
 *
 * A module of its own because two sides read it: `canvas-live-render.ts`, which seeds the page's
 * `ContentEntry` state with it when the entry is written inside its page, and `iframe-host.ts`,
 * which posts it again whenever the entry's fields change, so the page follows without a redraw.
 *
 * @docs studio/projects/browse
 */

import { collectionForFile } from "../content/collection-match";
import type { JsonObject } from "@jxsuite/schema/types";
import type { Tab } from "../tabs/tab";

/**
 * The entry as its page's `ContentEntry` state reads it, from the tab being written rather than
 * from disk: its id, its collection and its fields as they stand, so the page's title, date and
 * cover follow the Entry tab as it is edited. The body is the spliced tree, so `$children` is
 * empty.
 */
export function liveEntryState(tab: Tab | null, path: string): JsonObject {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  /* SAFETY: frontmatter is parsed YAML or a JSON entry's root: JSON-shaped field values, which is
     what a resolved entry's `data` carries. */
  const data = { ...tab?.doc.content.frontmatter } as JsonObject;
  return {
    $children: [],
    collection: collectionForFile(path)?.name ?? null,
    data,
    id: dot > 0 ? base.slice(0, dot) : base,
  };
}
