/// <reference lib="dom" />
/**
 * The pane grid, as a mounted document — the mount seam, and nothing else.
 *
 * `pane-grid.json` is the structure and the style: the cell's own two-row grid, the four empty
 * boxes inside it, the splitter between two cells. `panels/pane-grid.ts` is the flow — which panes
 * exist, what a cell's stage is furnished with, in what order a departing cell is taken apart, and
 * what the grid's own tracks are. This module is the seam between them: one reactive scope holding
 * the projected rows, one document mounted into `#pane-grid`, and an `update()` that ASSIGNS.
 *
 * **Every box the document draws is an island's host** (specs/studio-ui-guidelines.md §9.4), which
 * is why the whole of this file's interface is `onNodeCreated`. A cell's four boxes are announced
 * as they are CREATED — one reconcile step before the row is in the page, so the flow's stage
 * furnishing, the two bars' mounts and the pane-focus listener are all in place while the cell is
 * still detached (§18.1 rule 1).
 *
 * **The pane-focus listener is attached HERE rather than declared in the document**, and that is a
 * schema gap rather than a preference: a document's `on*` key binds through `addEventListener` with
 * no options, so there is no way to say CAPTURE. The listener has to be capture-phase — a control
 * inside a cell that stops propagation would otherwise silently keep the keyboard in the other pane
 * — so the flow adds it to the cell element it is handed. See {@link PaneGridActions.cellPart}.
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import paneGridDoc from "./pane-grid.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("pane-grid", paneGridDoc as unknown as JxDocument);

/**
 * The `part` a pane's CELL carries.
 *
 * `panels/jump-bar.ts` and `panels/pane-context.ts` both write a `--*-h` custom property onto the
 * cell so the stage can read it back by cascade, and each is handed a box inside the cell rather
 * than the cell itself — so both resolve it with {@link PANE_SELECTOR}. It replaces a `.pane`
 * class: a converted surface emits none, and a `part` is the hook a document offers instead.
 */
export const PANE_PART = "pane";

/**
 * The `part` a pane's STAGE carries — the canvas's host, and the id nine screenshots crop.
 *
 * `pane-stage` rather than `stage`, and the qualifier is load-bearing: `surfaces/canvas-stage.json`
 * mounts INTO this box and its own root is `part="stage"`, as are the media pane's and the git
 * panel's. This name is resolved with `closest()` from outside the surface, so it has to be one no
 * other document can answer — see the surface's own test.
 */
export const STAGE_PART = "pane-stage";

/** `closest()` from anything inside a cell to the cell. */
export const PANE_SELECTOR = `[part="${PANE_PART}"]`;

/**
 * `closest()` from an event target to the stage it happened in.
 *
 * `editor/shortcuts.ts`'s ctrl-wheel guard is the one reader: "everywhere that is not A stage" has
 * as many answers as there are panes, so it asks the element rather than a registry.
 */
export const STAGE_SELECTOR = `[part="${STAGE_PART}"]`;

/** The five boxes a cell is made of, in the order the document draws them. */
export type PaneCellPart = "pane" | "strip" | "jump" | "chrome" | "stage";

const CELL_PARTS: ReadonlyMap<string, PaneCellPart> = new Map([
  ["pane", "pane"],
  ["strip", "strip"],
  ["jump", "jump"],
  ["chrome", "chrome"],
  ["pane-stage", "stage"],
]);

/**
 * One row of the grid: a pane, and whether a splitter leads it.
 *
 * Every field is a finished value. The document asks no question about a pane — not which index it
 * is at, not how many there are — so a projection cannot disagree with what is drawn.
 */
export interface PaneGridRow extends Record<string, unknown> {
  /** The pane id. The repeater's key, and what every action is addressed with. */
  id: string;
  /** `"shown"` for every row but the first. The `$switch` the leading splitter hangs off. */
  split: "hidden" | "shown";
  /** `pane.<id>` — stamped on the STAGE, because that is what the shots crop. */
  region: string;
  /** `pane.<id>/tabs` — stamped on the strip host. */
  stripRegion: string;
}

/**
 * The splitter's constants and its opening position — everything `jx-split` is handed.
 *
 * It arrives from the FLOW rather than being read here, because every number in it belongs to a
 * module this one deliberately does not import: `min` and `max` are `shell.ts`'s supported range
 * and `collapse` its default split, and `gap` is the pane grid's own idea of a usable pane. This
 * module is the seam between the document and the flow and knows nothing about either.
 */
export interface PaneGridSplit {
  /** Where the splitter sits: the primary pane's share of the grid. */
  value: number;
  /** The smallest share the primary may have. */
  min: number;
  /** The largest. */
  max: number;
  /** The smallest either pane may be dragged to, in PIXELS — the element converts it itself. */
  gap: number;
  /** What Enter and a double click move to, and back from. */
  collapse: number;
}

/** What the flow wants to be told about. Read once, when the scope is made. */
export interface PaneGridActions {
  /**
   * One of a cell's five boxes exists, detached and empty.
   *
   * Called once per box per cell, in document order (`pane` first), while the row is still inside
   * the runtime's own render pass. The flow builds its record, furnishes the stage and adds the
   * cell's capture-phase `pointerdown` listener from here.
   */
  cellPart: (paneId: string, part: PaneCellPart, element: HTMLElement) => void;
  /**
   * The splitter moved, and is still moving: once per `pointermove` of a drag, and once per key.
   *
   * There is nothing to wire and nothing to un-wire any more. `jx-split` owns the gesture, the
   * capture and the keyboard, and reports the value it has already bounded — so this is the whole
   * of the flow's part in a drag, and the document is not touched by one at all.
   */
  move: (value: number) => void;
  /** The gesture ended, or a key committed. Persist once. */
  settle: () => void;
}

export interface PaneGridSurface {
  /** Resolves once the first projection is in the document. */
  ready: Promise<void>;
  /**
   * Bring the standing document up to date. An assignment; the mount is never rebuilt.
   *
   * The split is re-asserted HERE, on a pane-set change, and nowhere else — which is what keeps a
   * drag clear of the document entirely. During one the element is the single writer of its own
   * position and the flow only mirrors it into `shell`; the scope catches up the next time the grid
   * gains or loses a pane, which is the only moment anything else could have moved it.
   */
  update: (rows: PaneGridRow[], split: number) => void;
  /** Take the document down and give `#pane-grid` back empty. Idempotent. */
  dispose: () => void;
}

/** The scope `pane-grid.json` reads. */
interface PaneGridScope extends Record<string, unknown> {
  rows: PaneGridRow[];
  /** `jx-split`'s `value`. */
  paneSplit: number;
  splitMin: number;
  splitMax: number;
  splitGap: number;
  /** `jx-split`'s `collapse`. */
  splitDefault: number;
  move: (value: number) => void;
  settle: () => void;
}

/** The `part` a node's definition carries, or `""` for a text node or an unmarked element. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/**
 * The pane a created node belongs to, read from the row scope the runtime renders it with.
 *
 * NOT from `data-pane-id`: `onNodeCreated` fires before `applyAttributes`, so at this point the
 * element carries nothing at all. `$map.item` is the row the runtime is building, which is the same
 * object the projection put in `rows`.
 */
function paneOf(state: JxScope | undefined): string {
  const row = (state?.["$map"] as { item?: { id?: unknown } } | undefined)?.item;
  return typeof row?.id === "string" ? row.id : "";
}

/**
 * Mount the grid into `host`, wired to `actions`.
 *
 * The host is CLEARED first: `#pane-grid` belongs to this document alone, and anything already in
 * it is a previous mount that a project switch forgot to take down.
 *
 * @param {HTMLElement} host `#pane-grid`.
 * @param {PaneGridRow[]} rows What to draw on the first paint.
 * @param {PaneGridSplit} split The splitter's constants, and where it opens.
 * @param {PaneGridActions} actions What to tell the flow about. Read once.
 * @returns {PaneGridSurface}
 */
export function mountPaneGridSurface(
  host: HTMLElement,
  rows: PaneGridRow[],
  split: PaneGridSplit,
  actions: PaneGridActions,
): PaneGridSurface {
  host.replaceChildren();
  const scope = reactive<PaneGridScope>({
    move: actions.move,
    paneSplit: split.value,
    rows,
    settle: actions.settle,
    splitDefault: split.collapse,
    splitGap: split.gap,
    splitMax: split.max,
    splitMin: split.min,
  }) as PaneGridScope;

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("pane-grid", scope, host, {
    /* No `instanceof` narrowing and no "is there a pane" guard, and both absences are structural.
       `pane-grid.json` draws no text and no `textContent`, so every node the runtime reports here
       is an element; and the five cell parts exist only inside the repeater's rows, so a `$map`
       scope is always there to name the pane. A guard on either would be a branch the document
       cannot reach — which is a line no test could ever cover, which is a claim nothing checks. */
    onNodeCreated: (element, _path, def, state) => {
      const cellPart = CELL_PARTS.get(partOf(def));
      if (cellPart) {
        actions.cellPart(paneOf(state), cellPart, element as HTMLElement);
      }
    },
  }).then((surface) => {
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
    ready,
    update(next, value) {
      scope.rows = next;
      scope.paneSplit = value;
    },
  };
}
