/// <reference lib="dom" />
/**
 * The project's media browser, as a mounted document.
 *
 * This is the adapter. `ui/media-picker.ts` is the flow — which files count as media, what a row's
 * caption says, what a pick writes and what a loaded thumbnail is worth — and this is the panel it
 * draws into. Every row arrives already decided: a name, a URL, two words of caption, and the
 * string a pick commits.
 *
 * **The platform owns dismissal.** The root is a `jx-popover`, so Escape, light dismissal, the top
 * layer and focus back to the invoker are its contract rather than three document listeners and a
 * `z-index` chosen from the layer the anchor happened to be in. That is not only tidier: an overlay
 * drawn into a layer div paints UNDERNEATH a modal `<dialog>` and is inert besides (ui.md §6),
 * which is the whole reason `panels/seo-modal.ts` had to fork its own Browse onto the kit menu, and
 * a top-layer popover has no such problem.
 *
 * **The last row opens the big picker.** **Browse all media…** hands the same commit to the Media
 * workspace's own surface in a dialog (`media/media-library.ts`), so the compact list and the full
 * one are two sizes of one picker rather than two pickers.
 *
 * **The filter takes the caret, and the adapter is what puts it there.** A `jx-popover` moves focus
 * into itself but has no opinion about which control; the panel is a search box over a list, so the
 * box is where typing should land. The node is reached through the mounted root rather than a
 * document-wide selector, the way `surfaces/slash-menu.ts` reaches its own.
 *
 * @docs studio/projects/media
 */

import { openPopoverSurface } from "../ui/popover-surface";
import { reactive } from "../reactivity";
import { registerSurface } from "../ui/surface";
import mediaBrowserDoc from "./media-browser.json";
import type { OpenPopoverSurfaceOptions, PopoverSurfaceHandle } from "../ui/popover-surface";

registerSurface("media-browser", mediaBrowserDoc);

/** The slot id, and so the panel's region: `overlay.menu:media-picker`. */
const SLOT = "media-picker";

/** One browsable file, in the shape the document reads. */
export interface MediaBrowserRow {
  /** The row's identity across a filter keystroke: the file's path on disk. */
  key: string;
  /** What a pick commits — the site URL, which is the authored form. */
  path: string;
  /** The project-relative file, which is the key every measurement is stored under. */
  file: string;
  name: string;
  thumbState: "hidden" | "shown";
  thumbSrc: string;
  captionState: "hidden" | "shown";
  /** "1200 × 800 · 84 KB", or the half of it that is known. */
  caption: string;
}

/** Everything the panel draws, as one value. */
export interface MediaBrowserView {
  /** Where the panel opens, in viewport pixels. The kit clamps it into the viewport. */
  x: number;
  y: number;
  filter: string;
  rowsState: "empty" | "listed";
  rows: MediaBrowserRow[];
  /** What stands in for the list when nothing matches. */
  emptyLabel: string;
  moreState: "hidden" | "shown";
  /** "…10 more" — the cap is fifty and a truncated list says so. */
  moreLabel: string;
  /** The last row: "Browse all media…", or "Browse all images…" for a field that holds a picture. */
  browseAllLabel: string;
}

/** What a control asks the flow to do. */
export interface MediaBrowserActions {
  setFilter: (value: string) => void;
  pick: (path: string) => void;
  /** A thumbnail finished decoding at that size. The flow decides whether it is news. */
  measure: (file: string, width: number, height: number) => void;
  /** Open the full-size picker: the Media workspace's surface, in a dialog (studio.md §9.3). */
  browseAll: () => void;
  /** The platform closed the panel: clicked outside, Escape, or a second press on the invoker. */
  dismissed?: () => void;
}

export interface MediaBrowserSurfaceHandle extends PopoverSurfaceHandle {
  update: (view: MediaBrowserView) => void;
}

interface MediaBrowserScope extends MediaBrowserView, Omit<MediaBrowserActions, "dismissed"> {}

/** Write a projection into the scope. */
function project(scope: MediaBrowserScope, view: MediaBrowserView): void {
  scope.x = view.x;
  scope.y = view.y;
  scope.filter = view.filter;
  scope.rowsState = view.rowsState;
  scope.rows = view.rows;
  scope.emptyLabel = view.emptyLabel;
  scope.moreState = view.moreState;
  scope.moreLabel = view.moreLabel;
  scope.browseAllLabel = view.browseAllLabel;
}

/**
 * Open the media browser under `anchor`.
 *
 * @param {MediaBrowserView} view - What it shows to begin with
 * @param {MediaBrowserActions} actions - What each control does
 * @param {HTMLElement | null} anchor - The control it was opened from
 * @returns {MediaBrowserSurfaceHandle}
 */
export function openMediaBrowserSurface(
  view: MediaBrowserView,
  actions: MediaBrowserActions,
  anchor: HTMLElement | null,
): MediaBrowserSurfaceHandle {
  const scope: MediaBrowserScope = reactive<MediaBrowserScope>({
    browseAll: actions.browseAll,
    browseAllLabel: view.browseAllLabel,
    emptyLabel: view.emptyLabel,
    filter: view.filter,
    measure: actions.measure,
    moreLabel: view.moreLabel,
    moreState: view.moreState,
    pick: actions.pick,
    rows: view.rows,
    rowsState: view.rowsState,
    setFilter: actions.setFilter,
    x: view.x,
    y: view.y,
  });

  const options: OpenPopoverSurfaceOptions<MediaBrowserScope> = {
    anchor,
    name: "media-browser",
    scope,
    slot: SLOT,
  };
  if (actions.dismissed) {
    options.onDismissed = actions.dismissed;
  }
  const handle = openPopoverSurface(options);

  void handle.ready.then(() => {
    if (handle.isOpen()) {
      handle.host.querySelector<HTMLInputElement>('[part="filter"] [part="input"]')?.focus();
    }
  });

  return {
    close: handle.close,
    host: handle.host,
    isOpen: handle.isOpen,
    ready: handle.ready,
    update: (next) => project(scope, next),
  };
}
