/// <reference lib="dom" />
/**
 * The Compare view's bar, as a mounted document.
 *
 * This is the adapter. `canvas/diff-toolbar.ts` is the flow — what the count means for the half
 * that is showing, which step is reachable, whether a comparison has a visual half at all, and what
 * a step does to both artboards — and this is the surface it draws into: a reactive scope of
 * already-formatted strings and booleans, and a mount that survives every redraw.
 *
 * **One mount per pane, not per redraw.** The bar re-renders on every step, and a step must never
 * go through `renderCanvas`: that rebuilds the stage and remounts both artboard iframes, tearing
 * down the very documents it is trying to move you through. A remount here would be the same defect
 * one level down, so a redraw writes the scope and the document reconciles itself.
 *
 * @docs studio/publish/source-control
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import diffToolbarDoc from "./diff-toolbar.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("diff-toolbar", diffToolbarDoc as unknown as JxDocument);

/** Everything the bar draws, as one value. Every field is already a string or a boolean. */
export interface DiffToolbarView {
  /**
   * Whether the Visual/Code pair is a choice or a statement.
   *
   * A file the canvas cannot draw has one half and no alternative, and a control that cannot move
   * is not drawn as a control — the rule a one-value axis follows everywhere else. The Visual
   * button is never drawn disabled.
   */
  viewMode: "static" | "choice";
  /** `"true"` / `"false"`, because a radio's checkedness is a tri-state on the kit's button. */
  visualChecked: "true" | "false";
  codeChecked: "true" | "false";
  /** "No changes", "12 changes", "3 of 12", or what the Code half reports instead. */
  countLabel: string;
  /** Whether there is anywhere to step. With nothing to walk, the count stands alone. */
  stepper: "hidden" | "shown";
  prevDisabled: boolean;
  nextDisabled: boolean;
  /** Whether a sibling group was too large to pair up, so some changes read as add/remove. */
  degraded: "hidden" | "shown";
  /** Whether document settings moved — root keys, which have no node to tint. */
  rootKeys: "hidden" | "shown";
  /** "Changed: state, $media" — the tooltip on the root-key note. */
  rootKeysTitle: string;
}

/** What a control asks the flow to do. Every one of them is a decision the flow owns. */
export interface DiffToolbarActions {
  showVisual: () => void;
  showCode: () => void;
  previous: () => void;
  next: () => void;
}

export interface DiffToolbarSurfaceHandle {
  /** Resolves with the document's root once it has rendered. */
  ready: Promise<HTMLElement>;
  update: (view: DiffToolbarView) => void;
  dispose: () => void;
}

/** The scope the document reads: {@link DiffToolbarView} plus the actions its controls call. */
interface DiffToolbarScope extends Record<string, unknown>, DiffToolbarView, DiffToolbarActions {}

/** Write a projection into the scope. */
function project(scope: DiffToolbarScope, view: DiffToolbarView): void {
  scope.viewMode = view.viewMode;
  scope.visualChecked = view.visualChecked;
  scope.codeChecked = view.codeChecked;
  scope.countLabel = view.countLabel;
  scope.stepper = view.stepper;
  scope.prevDisabled = view.prevDisabled;
  scope.nextDisabled = view.nextDisabled;
  scope.degraded = view.degraded;
  scope.rootKeys = view.rootKeys;
  scope.rootKeysTitle = view.rootKeysTitle;
}

/**
 * Mount the bar into `host`, wired to `actions`.
 *
 * The host is CLEARED first: this document is the whole of what the bar shows.
 *
 * @param {HTMLElement} host - The stage's floating toolbar slot
 * @param {DiffToolbarView} view - What to draw right now
 * @param {DiffToolbarActions} actions - What each control does
 * @returns {DiffToolbarSurfaceHandle}
 */
export function mountDiffToolbarSurface(
  host: HTMLElement,
  view: DiffToolbarView,
  actions: DiffToolbarActions,
): DiffToolbarSurfaceHandle {
  host.replaceChildren();
  const scope = reactive<DiffToolbarScope>({
    codeChecked: "false",
    countLabel: "",
    degraded: "hidden",
    next: actions.next,
    nextDisabled: true,
    prevDisabled: true,
    previous: actions.previous,
    rootKeys: "hidden",
    rootKeysTitle: "",
    showCode: actions.showCode,
    showVisual: actions.showVisual,
    stepper: "hidden",
    viewMode: "choice",
    visualChecked: "true",
  }) as DiffToolbarScope;
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("diff-toolbar", scope, host).then((surface) => {
    if (disposed) {
      surface.dispose();
      return surface.root as HTMLElement;
    }
    mounted = surface;
    return surface.root as HTMLElement;
  });

  return {
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update: (next) => project(scope, next),
  };
}
