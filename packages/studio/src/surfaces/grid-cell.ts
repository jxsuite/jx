/// <reference lib="dom" />
/**
 * The grid's cell value picker, as a mounted document.
 *
 * This is the adapter. `grid/cell-popovers.ts` is the flow — which kinds edit this way, what a
 * relationship column points at, what a pick writes through the edit buffer — and this is the panel
 * it draws into.
 *
 * **The media picker is an ISLAND** (specs/studio-ui-guidelines.md §9.4), and it stayed one when it
 * became a document. The document draws `[part="picker-host"]` empty and the CALLER fills it
 * through {@link GridCellSurfaceOptions.island} — the same seam `surfaces/dialog.ts` gives a rich
 * dialog body. What goes in the box is the decision of the module that owns the box's contents,
 * which is why this adapter does not name the media picker at all.
 *
 * @docs studio/editing/grid
 */

import { isString } from "@jxsuite/schema/guards";
import { reactive } from "../reactivity";
import { openPopoverSurface } from "../ui/popover-surface";
import { registerSurface } from "../ui/surface";
import gridCellDoc from "./grid-cell.json";
import type { JxElement } from "@jxsuite/schema/types";
import type { JxPath } from "@jxsuite/runtime/types";
import type { OpenPopoverSurfaceOptions, PopoverSurfaceHandle } from "../ui/popover-surface";
import type { SurfaceOption } from "../ui/surface";

registerSurface("grid-cell", gridCellDoc);

/** The slot id, and so the panel's region: `overlay.popover:grid/cell`. */
const SLOT = "grid/cell";

/** Everything the panel draws. */
export interface GridCellView {
  x: number;
  y: number;
  /** The column's title — the panel's heading and its accessible name. */
  title: string;
  /** Which of the two pickers is drawn. */
  kind: "reference" | "image";
  /** "Entries of “post”", when the column names a target type. */
  hint: string;
  hintState: "hidden" | "shown";
  options: SurfaceOption[];
  /** What the list holds; empty when the current value is not one of its rows. */
  value: string;
  /** What the free-text field holds: the current value when no row matches it. */
  custom: string;
}

export interface GridCellSurfaceOptions {
  view: GridCellView;
  /** A pick, from either control. The empty string means "no value". */
  pick: (value: string) => void;
  /** Fill the media picker's host, once it exists. Only called for an `image` column. */
  island?: (host: HTMLElement) => void;
  /** The platform closed the panel, or Done was pressed. */
  dismissed?: () => void;
}

interface GridCellScope extends GridCellView {
  pick: (value: string) => void;
  done: () => void;
}

/** The `part` a node's definition carries, or "" for a text node or an unmarked element. */
function partOf(def: JxElement | string): string {
  const part = isString(def) ? undefined : def.attributes?.["part"];
  return isString(part) ? part : "";
}

/**
 * Open the cell value picker.
 *
 * @param {GridCellSurfaceOptions} options
 * @returns {PopoverSurfaceHandle}
 */
export function openGridCellSurface(options: GridCellSurfaceOptions): PopoverSurfaceHandle {
  const { view } = options;
  const scope: GridCellScope = reactive<GridCellScope>({
    custom: view.custom,
    done: () => {
      handle.close();
      options.dismissed?.();
    },
    hint: view.hint,
    hintState: view.hintState,
    kind: view.kind,
    options: view.options,
    pick: options.pick,
    title: view.title,
    value: view.value,
    x: view.x,
    y: view.y,
  });

  const popover: OpenPopoverSurfaceOptions<GridCellScope> = {
    anchor: null,
    name: "grid-cell",
    scope,
    slot: SLOT,
  };
  if (options.dismissed) {
    popover.onDismissed = options.dismissed;
  }
  if (options.island) {
    popover.onNodeCreated = (
      element: HTMLElement | Text,
      _path: JxPath,
      def: JxElement | string,
    ) => {
      if (partOf(def) === "picker-host" && element instanceof HTMLElement) {
        options.island?.(element);
      }
    };
  }
  const handle = openPopoverSurface(popover);
  return handle;
}
