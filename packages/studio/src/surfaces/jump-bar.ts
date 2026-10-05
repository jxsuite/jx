/// <reference lib="dom" />
/**
 * The jump bar, as a Jx document over the kit — the mount seam, and nothing else.
 *
 * `jump-bar.json` is the markup, the ARIA and the style; `panels/jump-bar.ts` is the flow — which
 * pane this bar is about, what its address is, which of its steps the registry can actually run,
 * and what a chevron opens. This module is the seam between them: one scope, one document mounted
 * into the slot the status bar leaves for it, and an `update()` that ASSIGNS rather than
 * re-mounts.
 *
 * The scope is reactive, so a repaint is an assignment to `segments` and the keyed `$map`
 * reconciles: a step whose key survives keeps its node, and the chevron the reader is aiming at
 * does not move under them.
 *
 * **The bar hides rather than un-mounts when there is no address.** With no tab open there is
 * nothing to print, and the document's own `hidden` takes it off the screen — the mount stays,
 * because the next tab open is one assignment away and re-mounting would cost a frame of blank
 * chrome.
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import jumpBarDoc from "./jump-bar.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("jump-bar", jumpBarDoc as unknown as JxDocument);

/**
 * One step of the address, as the document reads it.
 *
 * Every field is present on every step whatever its `control`, because a binding renders a value
 * and a `$switch` chooses on one: a step that omitted `title` would leave the readout case reading
 * an absent path.
 */
export interface ProjectedStep extends Record<string, unknown> {
  /** Unique within one bar: the repeater's key, and the argument `run` and `choose` receive. */
  key: string;
  /** `project` | `file` | `editor` | `node` — stamped so a test names a step without its text. */
  kind: string;
  label: string;
  /** The step's own context, then the command's title and chord. */
  title: string;
  /** `button` when the registry can run the step's command, `readout` when it cannot. */
  control: "button" | "readout";
  /** A button whose command is registered but refuses right now; its reason is in the title. */
  disabled: boolean;
  /** The leaf: where you are. Marked, never un-controlled. */
  current: boolean;
  /** The first step draws no separator before it. */
  leading: boolean;
  /** More than one place to go. One alternative is not a choice and renders no chevron. */
  hasChoices: boolean;
  /** The chevron's accessible name and tooltip. */
  altsLabel: string;
}

/** What a gesture on the bar asks of the flow. Read once, when the scope is made. */
export interface JumpBarActions {
  /** A step was pressed: run the command it names, with its args. */
  run: (key: string) => void;
  /** A chevron was pressed: open that step's siblings, hanging under the control that was hit. */
  choose: (key: string, anchor: HTMLElement | null) => void;
}

export interface JumpBarSurface {
  /** Bring the standing document up to date. An assignment; the mount is never rebuilt. */
  update: (steps: readonly ProjectedStep[]) => void;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope `jump-bar.json` reads. */
interface JumpBarScope extends Record<string, unknown>, JumpBarActions {
  region: string;
  segments: ProjectedStep[];
  empty: boolean;
}

/**
 * Mount the bar into the slot the status bar built for it.
 *
 * The host is CLEARED first: the slot is the bar's own, and whatever was in it belongs to a mount
 * this bar is no longer drawing.
 *
 * @param {HTMLElement} host The status bar's slot for the bar.
 * @param {string} region The `data-jx-region` the bar stamps on itself — `statusbar/document`.
 * @param {JumpBarActions} actions What a press does. Read once, when the scope is made.
 * @returns {JumpBarSurface}
 */
export function mountJumpBarSurface(
  host: HTMLElement,
  region: string,
  actions: JumpBarActions,
): JumpBarSurface {
  const scope = reactive<JumpBarScope>({
    ...actions,
    empty: true,
    region,
    segments: [],
  }) as JumpBarScope;

  host.replaceChildren();
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  void mountSurface("jump-bar", scope, host).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
      host.replaceChildren();
    },
    update(steps) {
      scope.segments = [...steps];
      scope.empty = steps.length === 0;
    },
  };
}
