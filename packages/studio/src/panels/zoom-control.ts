/// <reference lib="dom" />
/**
 * The status bar's zoom field, as words and numbers: what the FOCUSED pane's zoom and fit say, and
 * the commands its gestures run.
 *
 * This is the projection half of the control the floating zoom pod used to be. The pod was drawn by
 * the pane context bar, once per pane, over the stage; the status bar is the shell's one ambient
 * strip and is drawn once, so the field reports the pane the author is working in (the one the jump
 * bar and the Inspector already follow, and the one `canvas.zoomIn`, `canvas.zoomOut` and
 * `canvas.zoomReset` act on). Clicking into the other pane re-points it.
 *
 * Nothing here renders and nothing writes: {@link zoomProjectionFor} reads, and the `*Command`
 * helpers name the command a gesture runs, so `surfaces/statusbar.ts` can send it through the
 * registry and the control stays "every interactive item is a command" (§16.2).
 *
 * **The slider is logarithmic.** Zoom is multiplicative (the step is 1.2 and the wheel is
 * exponential), so a linear 5%-500% track would put 100% a fifth of the way along and spend most of
 * its length above 200%. Position runs 0-{@link ZOOM_POSITION_MAX} and maps by `zoom = min * (max /
 * min) ^ (position / 100)`, which puts 100% at 65 on the artboard's 5%-500% range and 63 on Edit's
 * 25%-300% one.
 *
 * @docs studio/interface/canvas
 */

import { isNumber } from "@jxsuite/schema/guards";
import {
  EDIT_ZOOM_MAX,
  EDIT_ZOOM_MIN,
  PAN_ZOOM_MAX,
  PAN_ZOOM_MIN,
  getFit,
  stageZoom,
} from "../canvas/canvas-utils";
import type { FitMode } from "../canvas/canvas-utils";
import {
  canvasModeOfPane,
  derivationOfPane,
  surfaceForPane,
  tabOfPane,
} from "../canvas/canvas-surface";
import { diffShowsCode } from "../canvas/diff-view";
import { homeWorkspaceOfTabId } from "../workspace/workspace-ids";
import { canRenderComparison } from "./git-diff-open";
import { shell } from "../shell";
import type { CommandRegistry } from "../commands/registry";
import type { CommandArgValues } from "../commands/command-args";
import type { SurfaceOption } from "../ui/surface";

/** The top of the slider's track. The bottom is 0, and one keyboard step is 1. */
export const ZOOM_POSITION_MAX = 100;

/** The fit entries the Fit select offers, in menu order. `1` is "actual size", a numeric fit. */
export const FIT_CHOICES: readonly { value: string; fit: FitMode; label: string }[] = [
  { fit: "page", label: "Fit page", value: "page" },
  { fit: "width", label: "Fit width", value: "width" },
  { fit: 1, label: "Actual size", value: "actual" },
  { fit: "none", label: "No fit", value: "none" },
];

/** The modes whose stage is the panzoom surface, the only ones with a fit to state. */
const STAGE_ZOOM_MODES = new Set(["design", "stylebook", "git-diff"]);

/** A scale range, for the slider's mapping. */
interface ZoomRange {
  min: number;
  max: number;
}

const PAN_ZOOM_RANGE: ZoomRange = { max: PAN_ZOOM_MAX, min: PAN_ZOOM_MIN };
const EDIT_ZOOM_RANGE: ZoomRange = { max: EDIT_ZOOM_MAX, min: EDIT_ZOOM_MIN };

/** Zoom as the slider's position, held inside the track. */
export function zoomToPosition(zoom: number, range: ZoomRange): number {
  const clamped = Math.min(range.max, Math.max(range.min, zoom));
  return (Math.log(clamped / range.min) / Math.log(range.max / range.min)) * ZOOM_POSITION_MAX;
}

/**
 * The slider's position as a zoom.
 *
 * Rounded to a tenth of a percent: fine enough that the thumb the reader dragged to is the thumb
 * that is drawn once the write comes back (the projection maps the stored zoom to a position
 * again), and coarse enough that the stored number is not a long float in the session.
 */
export function positionToZoom(position: number, range: ZoomRange): number {
  const held = Math.min(ZOOM_POSITION_MAX, Math.max(0, position));
  const zoom = range.min * (range.max / range.min) ** (held / ZOOM_POSITION_MAX);
  return Math.min(range.max, Math.max(range.min, Math.round(zoom * 1000) / 1000));
}

/** Which entry the Fit select shows as chosen. A numeric fit reads as "actual size" only at 1. */
function fitChoiceValue(fit: FitMode): string {
  if (isNumber(fit)) {
    return fit === 1 ? "actual" : "";
  }
  return fit;
}

/** The path this pane is comparing, or "" before it has a comparison. */
function comparisonPathOf(paneId: string): string {
  const derived = derivationOfPane(paneId);
  const state =
    derived?.kind === "lens" && derived.preset === "diff" ? derived.diff : shell.git.diffState;
  return state?.filePath ?? "";
}

/** The field's words and numbers. `state: "hidden"` draws no field at all. */
export interface ZoomProjection {
  state: "shown" | "hidden";
  /** "125%". */
  label: string;
  /** The command the slider runs: `canvas.setZoom` on the artboard, `canvas.setEditZoom` in Edit. */
  slideCommand: string;
  /** Where the thumb is. Integral, so the control never holds a value it would have to round. */
  position: number;
  min: number;
  max: number;
  step: number;
  /** What the slider is announced as: the percentage, not its position on the track. */
  valuetext: string;
  fitState: "shown" | "hidden";
  fitValue: string;
  fitOptions: SurfaceOption[];
  zoomOutHint: string;
  zoomInHint: string;
  resetHint: string;
  sliderHint: string;
}

/** The projection of a pane with nothing to zoom. */
export function hiddenZoomProjection(): ZoomProjection {
  return {
    fitOptions: [],
    fitState: "hidden",
    fitValue: "",
    label: "100%",
    max: ZOOM_POSITION_MAX,
    min: 0,
    position: 0,
    resetHint: "",
    sliderHint: "",
    slideCommand: "canvas.setZoom",
    state: "hidden",
    step: 1,
    valuetext: "100%",
    zoomInHint: "",
    zoomOutHint: "",
  };
}

/** `Title (chord)`, the chord read off the keymap so a rebind is the hint's too. */
function hintFor(registry: CommandRegistry | null, id: string, words: string): string {
  const chord = registry?.keymap.formatBinding(id);
  return chord ? `${words} (${chord})` : words;
}

/**
 * What the zoom field says for one pane.
 *
 * The visibility rule is the pod's, carried over whole. Edit shows the content zoom and no Fit (a
 * fit is a statement about an artboard). Design, Stylebook and a comparison's VISUAL half show zoom
 * and Fit. Preview is absent because its frame is a real viewport that scrolls its own document, so
 * there is nothing to zoom; so is a comparison's CODE half, one Monaco diff editor with no panzoom
 * surface under it, where every verb would move nothing but the label; so is Review changes in the
 * Publish workspace, whose boards are fitted to their column on arrival (the wheel still zooms
 * them, studio.md §22.8). Every other mode (Source, Grid, a workspace home) has no stage to zoom.
 *
 * `diff-view.ts` is not reactive, so the Visual/Code switch repaints this field itself
 * (`canvas/diff-toolbar.ts` through `setDiffChromeRepaint`).
 *
 * @param paneId The pane to describe: the focused one, for the status bar.
 * @param registry Where the hints' chords come from; `null` before the registry is composed.
 */
export function zoomProjectionFor(
  paneId: string,
  registry: CommandRegistry | null,
): ZoomProjection {
  const tab = tabOfPane(paneId);
  if (!tab) {
    return hiddenZoomProjection();
  }
  const mode = canvasModeOfPane(paneId);
  const edit = mode === "edit";
  if (!edit) {
    if (!STAGE_ZOOM_MODES.has(mode)) {
      return hiddenZoomProjection();
    }
    if (
      mode === "git-diff" &&
      (diffShowsCode(paneId, canRenderComparison(comparisonPathOf(paneId))) ||
        homeWorkspaceOfTabId(tab.id) === "publish")
    ) {
      return hiddenZoomProjection();
    }
  }
  const surface = surfaceForPane(paneId);
  const zoom = edit ? tab.session.ui.editZoom : stageZoom(surface);
  const percent = `${Math.round(zoom * 100)}%`;
  return {
    fitOptions: edit ? [] : FIT_CHOICES.map(({ label, value }) => ({ label, value })),
    fitState: edit ? "hidden" : "shown",
    fitValue: edit ? "" : fitChoiceValue(getFit(surface)),
    label: percent,
    max: ZOOM_POSITION_MAX,
    min: 0,
    position: Math.round(zoomToPosition(zoom, edit ? EDIT_ZOOM_RANGE : PAN_ZOOM_RANGE)),
    resetHint: hintFor(registry, "canvas.zoomReset", "Reset to 100%"),
    sliderHint: "Zoom. Double-click to reset to 100%.",
    slideCommand: edit ? "canvas.setEditZoom" : "canvas.setZoom",
    state: "shown",
    step: 1,
    valuetext: percent,
    zoomInHint: hintFor(registry, "canvas.zoomIn", "Zoom in"),
    zoomOutHint: hintFor(registry, "canvas.zoomOut", "Zoom out"),
  };
}

/** A command and its arguments, as the registry runs them. */
export interface ZoomCommand {
  id: string;
  args: CommandArgValues;
}

/**
 * The command a slider position runs: the position mapped back to a scale on the range the
 * projection was drawn for.
 */
export function slideCommandFor(projection: ZoomProjection, position: number): ZoomCommand {
  const edit = projection.slideCommand === "canvas.setEditZoom";
  return {
    args: { zoom: positionToZoom(position, edit ? EDIT_ZOOM_RANGE : PAN_ZOOM_RANGE) },
    id: projection.slideCommand,
  };
}

/**
 * The command a Fit choice runs, or `null` for a value the select does not offer.
 *
 * "Fit page" is its own command and the other three are `canvas.setFit`: the control may magnify a
 * small artboard past life size, and the fit applied on arrival never does. Same declared state,
 * two caps; `canvas.setFit "page"` keeps the capped one.
 */
export function fitCommandFor(value: string): ZoomCommand | null {
  const choice = FIT_CHOICES.find((entry) => entry.value === value);
  if (!choice) {
    return null;
  }
  return choice.fit === "page"
    ? { args: {}, id: "canvas.fitPage" }
    : { args: { fit: choice.fit }, id: "canvas.setFit" };
}
