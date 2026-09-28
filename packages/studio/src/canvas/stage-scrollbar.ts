/// <reference lib="dom" />
/**
 * Stage scrollbar — how wide the stage's own scrollbar is, published on the pane's cell.
 *
 * The zoom pod floats in the pane's chrome layer (`surfaces/pane-grid.json`, `[part="chrome"]`),
 * and that layer spans the WHOLE lower cell, scrollbar gutter included. Edit's scroller is the
 * stage document's `[part="edit-canvas"]`, which sits in the same cell with its native vertical
 * scrollbar flush against the same edge. The pod was placed a fixed `--jx-space-4` (12px) in from
 * that edge, and a classic scrollbar is 15px in Chromium on Linux, so the pod painted 3px into the
 * track (more with its shadow) and swallowed clicks on it.
 *
 * **CSS cannot measure a scrollbar, and the pod's document cannot see the scroller.** The scroller
 * belongs to `surfaces/canvas-stage.json`; the pod to `surfaces/pane-context.json`. So the
 * renderer, which is the one module that knows which element scrolls in which mode, hands the
 * scroller here, and this module writes its width onto the cell as {@link STAGE_SCROLLBAR_VAR}. The
 * pod's margin adds it by cascade. It is the seam `--jump-bar-h` and `--pane-context-h` already
 * use, run the other way: there each bar owns its answer and the stage reads it; here the stage
 * owns its scroller and the chrome reads the answer.
 *
 * **On the CELL, never on `:root`**, for the reason `panels/jump-bar.ts` gives at the same seam:
 * two panes have two stages, and one document-level number would push the other pane's pod in by a
 * scrollbar it does not have. A stage outside any cell writes the root, which only happens in a
 * test fixture.
 *
 * **Edit only, and 0 everywhere else by construction.** `canvas-render.ts` tracks the scroller from
 * the Edit branch and releases it at every teardown (a mode transition, a full reset, the pane's
 * own teardown), and a release writes `0px`. Design, Stylebook and a comparison clip their stage
 * rather than scroll it, so the pod goes back to its plain inset there.
 *
 * The observer writes a custom property on the cell. That moves the pod, which is in the chrome
 * layer, and never the observed scroller, so there is no resize loop.
 */

import { PANE_SELECTOR } from "../surfaces/pane-grid";
import type { CanvasSurface } from "./surface-registry";

/**
 * The custom property the cell carries: the stage scroller's scrollbar width, in px.
 *
 * `surfaces/pane-context.json`'s `[part="pod"]` margin reads it, and
 * `tests/stage-scrollbar.test.ts` joins the two names so renaming either side goes red.
 */
export const STAGE_SCROLLBAR_VAR = "--stage-scrollbar-w";

/**
 * How much of `scroller`'s width its vertical scrollbar takes.
 *
 * `offsetWidth` is the border box and `clientWidth` the padding box minus the scrollbar, so the
 * difference is exactly the scrollbar for a box that draws no border — which `[part="edit-canvas"]`
 * does not (`surfaces/canvas-stage.json`). Give it one and this would count the border too.
 *
 * An OVERLAY scrollbar (macOS, GTK's overlay mode) reserves no width and correctly answers 0, so
 * those platforms keep the pod at its plain inset. So does a DOM with no layout engine.
 *
 * @param {HTMLElement} scroller
 * @returns {number}
 */
export function scrollbarWidthOf(scroller: HTMLElement): number {
  return Math.max(0, scroller.offsetWidth - scroller.clientWidth);
}

/** The cell a stage belongs to, or the document root when it is outside every cell. */
function cellOf(surface: CanvasSurface): HTMLElement {
  return surface.wrap?.closest<HTMLElement>(PANE_SELECTOR) ?? document.documentElement;
}

/**
 * Publish `scroller`'s scrollbar width on this stage's cell, and keep it current.
 *
 * **Observed, not measured once.** The scroller's content box shrinks when a scrollbar appears and
 * grows when it goes, so one `ResizeObserver` hears the page growing past the pane and shrinking
 * back as well as every window, dock and split resize.
 *
 * **Idempotent for the scroller it already holds**, because Edit's `.then` runs on every
 * content-only repaint and the stage document keeps its scroller across them: re-observing it each
 * time would churn an observer for nothing. A DIFFERENT scroller (the stage changed hands) releases
 * the old one first, and `null` only releases.
 *
 * @param {CanvasSurface} surface
 * @param {HTMLElement | null} scroller The element that scrolls this stage, or null for none.
 */
export function trackStageScrollbar(surface: CanvasSurface, scroller: HTMLElement | null): void {
  if (surface.stageScrollbar?.scroller === scroller) {
    return;
  }
  releaseStageScrollbar(surface);
  if (!scroller) {
    return;
  }
  const cell = cellOf(surface);
  const write = () => {
    cell.style.setProperty(STAGE_SCROLLBAR_VAR, `${scrollbarWidthOf(scroller)}px`);
  };
  const observer = new ResizeObserver(write);
  observer.observe(scroller);
  surface.stageScrollbar = { observer, scroller };
  write();
}

/**
 * Stop observing this stage's scroller and put the cell's offset back to 0. Idempotent.
 *
 * Safe while the surface has no host yet, because a surface is addressable before its stage exists
 * and the teardown paths run for it all the same.
 *
 * @param {CanvasSurface} surface
 */
export function releaseStageScrollbar(surface: CanvasSurface): void {
  surface.stageScrollbar?.observer.disconnect();
  surface.stageScrollbar = null;
  cellOf(surface).style.setProperty(STAGE_SCROLLBAR_VAR, "0px");
}
