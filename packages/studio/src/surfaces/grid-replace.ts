/// <reference lib="dom" />
/**
 * The grid's Find & Replace panel, as a mounted document.
 *
 * This is the adapter. `grid/grid-panel.ts` owns the flow — what a replacement costs, how many
 * cells changed, whether that closes the panel — and this module holds only the two strings the
 * fields hold, because a document's binding writes the scope and the scope is what the action
 * reads. The lit version kept them in two closure variables the template wrote to on every
 * keystroke, which is the same state one indirection further from the control that owns it.
 *
 * @docs studio/editing/grid
 */

import { reactive } from "../reactivity";
import { openPopoverSurface } from "../ui/popover-surface";
import { registerSurface } from "../ui/surface";
import gridReplaceDoc from "./grid-replace.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { PopoverSurfaceHandle } from "../ui/popover-surface";

registerSurface("grid-replace", gridReplaceDoc as unknown as JxDocument);

/** The slot id, and so the panel's region: `overlay.popover:grid/replace`. */
const SLOT = "grid/replace";

/** What a press hands the flow. */
export interface GridReplaceActions {
  /** Replace every match, and say how many cells moved. The flow decides whether to close. */
  replaceAll: (find: string, replace: string) => void;
  /** The platform closed the panel, or Cancel was pressed. */
  dismissed?: () => void;
}

export type GridReplaceSurfaceHandle = PopoverSurfaceHandle;

interface GridReplaceScope extends Record<string, unknown> {
  x: number;
  y: number;
  find: string;
  replace: string;
  setFind: (value: string) => void;
  setReplace: (value: string) => void;
  replaceAll: () => void;
  cancel: () => void;
}

/**
 * Open the Find & Replace panel under `anchor`.
 *
 * @param {{ x: number; y: number }} at - Where it opens, in viewport pixels
 * @param {GridReplaceActions} actions - What each press does
 * @param {HTMLElement | null} anchor - The toolbar button it hangs from
 * @returns {GridReplaceSurfaceHandle}
 */
export function openGridReplaceSurface(
  at: { x: number; y: number },
  actions: GridReplaceActions,
  anchor: HTMLElement | null,
): GridReplaceSurfaceHandle {
  const scope = reactive<GridReplaceScope>({
    cancel: () => {
      handle.close();
      actions.dismissed?.();
    },
    find: "",
    replace: "",
    replaceAll: () => {
      actions.replaceAll(scope.find, scope.replace);
    },
    setFind: (value) => {
      scope.find = value;
    },
    setReplace: (value) => {
      scope.replace = value;
    },
    x: at.x,
    y: at.y,
  }) as GridReplaceScope;

  const handle = openPopoverSurface({
    anchor,
    name: "grid-replace",
    scope,
    slot: SLOT,
    ...(actions.dismissed ? { onDismissed: actions.dismissed } : {}),
  });

  return handle;
}
