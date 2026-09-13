/// <reference lib="dom" />
/**
 * Edit-width-drag — the gesture that resizes the Edit column, and only that.
 *
 * The store it writes through is `./edit-width`, deliberately a leaf: this module needs
 * `applyEditZoom` from `canvas-utils.ts`, and `canvas-utils.ts` needs the store for the
 * `canvas.setEditWidth` command, so keeping the two apart is what stops those imports closing a
 * cycle. Everything here touches the DOM; nothing there does.
 *
 * @docs studio/design/breakpoints
 */

import { applyEditZoom } from "./canvas-utils";
import { bindSplit } from "../ui/panel-resize";
import {
  EDIT_CANVAS_GUTTER,
  EDIT_WIDTH_MIN,
  EDIT_WIDTH_SNAP_TOLERANCE,
  declaredWidthOfTab,
  setEditWidth,
  snapTargetsOfTab,
} from "./edit-width";
import { snapEditWidth } from "../utils/canvas-media";
import { rectOf } from "../utils/geometry";
import { tabOfPane } from "./canvas-surface";
import type { CanvasSurface } from "./canvas-surface";
import type { ResizeTarget, SplitElement } from "../ui/panel-resize";

/**
 * Apply a width to a live Edit column — the drag's only DOM writer.
 *
 * **Bare style writes, and never `renderPane`.** A full canvas render per `input` would rebuild the
 * iframe DOM, break the `jx-split`'s own pointer capture along with it, and be far too slow to drag
 * against — which is why this writes `session.ui.activeMedia` directly rather than going through
 * `canvas.setBreakpoint`, whose `run` ends in a `repaint`. (It is NOT because a re-render would
 * destroy an inline-edit session: pressing the handle already ended that, through the capture-phase
 * `commitActiveEditSession` in `studio.ts`. The reason is cost and capture, not the caret.)
 *
 * The direct write is safe because `activeMedia` is deliberately absent from
 * `installPaneRenderEffects`'s dependency list, so it repaints the Context bar, the overlays and
 * the Inspector — none of which owns the column — and schedules no canvas pass at all.
 *
 * **{@link applyEditZoom} is called only when there IS a zoom**, and that is a correctness fix, not
 * a micro-optimisation. It ends in `renderOnly("overlays")`, which is a full lit render of the
 * block action bar — and that render's first act is to tear down the drag handle's pragmatic-dnd
 * registration (`panels/block-action-bar.ts`, which already routes AROUND itself on scroll for
 * exactly this reason). At `editZoom === 1` there is nothing for it to do anyway: the column is
 * `width: 100%` under a `max-width` and the iframe is `width: 100%` under the column, so the CSS
 * write above has already reflowed the frame. `settle()` re-anchors once, on release.
 *
 * The breakpoint is derived from the MEASURED width rather than the requested one: the column is
 * `width: 100%` under a `max-width`, so a pane narrower than the request renders narrower than it,
 * and a readout computed from the request would name a band the page is not in.
 */
export function applyEditWidth(surface: CanvasSurface, column: HTMLElement, width: number): void {
  const tab = tabOfPane(surface.paneId);
  if (!tab) {
    return;
  }
  column.style.maxWidth = `${Math.round(width)}px`;
  if ((tab.session.ui.editZoom ?? 1) !== 1) {
    applyEditZoom(surface);
  }
  const rendered = rectOf(column).width || width;
  setEditWidth(surface.paneId, tab, rendered);
  column.dataset.editWidth = `${Math.round(rendered)}px`;
  column.classList.add("is-resizing");
}

/**
 * The Edit column, as a {@link ResizeTarget}.
 *
 * `grow` is the sign a rightward movement of the handle contributes: `+1` for the handle on the
 * right of the column, `-1` for the one on the left. **`scale` doubles it, and that is what makes
 * the two handles symmetric** — the column is centred by `justify-content: center`, so an edge that
 * moves `dx` only stays under the pointer if the total width changes by `2·dx`, the opposite edge
 * mirroring it. Both the placement and this sign are physical (`left`/`right`), because Studio's
 * own chrome is left-to-right; the artboard's `dir` is a property of the document inside the
 * iframe.
 *
 * **`lead` is the centre line.** The track a `jx-split` measures is the first boxed ancestor — the
 * canvas, since each handle stands beside the column rather than inside it — and the column is
 * centred in that canvas's CONTENT box, which is what `clientWidth` spans and a vertical scrollbar
 * does not. So the right handle sits `clientWidth / 2 + width / 2` from the track's start, and the
 * left one the same distance from its END, which for the trailing side is `track − clientWidth / 2`
 * plus the half-width. Being exact about the scrollbar costs one subtraction and is what keeps
 * `aria-valuenow` the handle's real position rather than one a few pixels off it.
 */
export function editWidthTarget(
  surface: CanvasSurface,
  column: HTMLElement,
  grow: 1 | -1,
): ResizeTarget {
  const tabOf = () => tabOfPane(surface.paneId);
  const centre = () => (column.parentElement?.clientWidth ?? 0) / 2;
  return {
    axis: "x",
    lead: (track) => (grow === 1 ? centre() : track - centre()),
    /*
     * The widest the pane can actually show. Read fresh, per the ResizeTarget contract, because a
     * dock drag or a window resize moves it under a drag that is already in flight. Before layout
     * (happy-dom measures nothing) there is no honest ceiling, so the floor is the only bound.
     */
    max: () => {
      const available = column.parentElement?.clientWidth ?? 0;
      return available > 0
        ? Math.max(EDIT_WIDTH_MIN, available - 2 * EDIT_CANVAS_GUTTER)
        : Number.POSITIVE_INFINITY;
    },
    min: () => EDIT_WIDTH_MIN,
    // The MEASURED width, not the stored one: a drag continues from what is on screen, which under
    // A pane narrower than the request is not the number that was asked for.
    read: () => rectOf(column).width || (tabOf() ? declaredWidthOfTab(tabOf()!) : EDIT_WIDTH_MIN),
    reset: () => {
      const tab = tabOf();
      return tab ? declaredWidthOfTab(tab) : EDIT_WIDTH_MIN;
    },
    scale: () => 2 * grow,
    settle: () => {
      /* Nothing is PERSISTED — the width dies with the mode. What settles is the chrome: the
         readout closes, and one `applyEditZoom` re-anchors the block action bar over the column's
         final width. That call is withheld during the drag (see {@link applyEditWidth}), so this is
         the one place per gesture the overlays are rebuilt. */
      column.classList.remove("is-resizing");
      applyEditZoom(surface);
    },
    snap: (value, modifiers) => {
      const tab = tabOf();
      if (modifiers.altKey || !tab) {
        return value;
      }
      return snapEditWidth(value, snapTargetsOfTab(tab), EDIT_WIDTH_SNAP_TOLERANCE);
    },
    write: (value) => {
      applyEditWidth(surface, column, value);
    },
  };
}

/**
 * Handles already wired, each with the unbind {@link bindSplit} handed back, so a re-render cannot
 * stack a second gesture on one element and a handle the stage has dropped does not keep
 * listening.
 *
 * `canvas-render.ts` mounts the handles after every Edit pass, and the stage document reuses the
 * nodes where it can — so a repeat mount of the same element must be a no-op. A mode round trip is
 * the other case: the handles are drawn only while there is a column, so leaving Edit removes them
 * and coming back draws two NEW ones. The old pair would otherwise stay bound — a window-resize
 * listener each, and a row in the adapter's own registry that `syncSplits` walks on every dock move
 * — so each mount first releases every handle no longer in the document. A `Map` rather than the
 * `WeakSet` this used to be, because an unbind is a thing to hold, and the sweep is what bounds
 * what it holds.
 */
const _wired = new Map<HTMLElement, () => void>();

/** Release every wired handle the document no longer contains. */
function sweepWired(): void {
  for (const [wired, unbind] of _wired) {
    if (!wired.isConnected) {
      unbind();
      _wired.delete(wired);
    }
  }
}

/**
 * Drive one handle — a `jx-split` — from the column's width. Idempotent per element.
 *
 * **The column is passed rather than inferred**, and the two are still created and replaced
 * together — a handle that outlived its column would be a handle with nothing to size. The handle
 * is not inside the column at all: `surfaces/canvas-stage.json` draws each one in a `display:
 * contents` slot BESIDE the column, in the canvas's own flex row, which is what makes the canvas
 * the track the element measures. Naming both nodes is the honest shape — the caller already holds
 * them — rather than walking from one to the other.
 */
export function mountEditWidthHandle(
  surface: CanvasSurface,
  handle: HTMLElement | undefined,
  column: HTMLElement | undefined,
  grow: 1 | -1,
): void {
  sweepWired();
  if (!handle || !column || _wired.has(handle)) {
    return;
  }
  _wired.set(handle, bindSplit(handle as SplitElement, editWidthTarget(surface, column, grow)));
}
