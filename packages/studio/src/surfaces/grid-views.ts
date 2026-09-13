/// <reference lib="dom" />
/**
 * The grid's View panel, as a mounted document.
 *
 * This is the adapter. `grid/grid-panel.ts` is the flow — what a saved view is, what storage holds,
 * what applying one does to four surfaces at once — and this is the panel it draws into. Every
 * field arrives already decided: the flow never hands over a `GridColumn`, a `GridSortSpec` or a
 * `SavedView`, only strings and booleans, so nothing here knows what a facet means.
 *
 * **It re-projects rather than re-opens.** `localStorage` is not reactive and neither is the
 * engine, so a column drag saved by `grid-view.ts` and a Save-as done from the palette both reach
 * the panel the same way: the flow calls {@link GridViewsSurfaceHandle.update} and the open panel
 * reconciles. The lit version rebuilt its whole template on every one of those, which is why
 * deleting a view moved the focus back to the top of the list.
 *
 * @docs studio/editing/grid
 */

import { reactive } from "../reactivity";
import { openPopoverSurface } from "../ui/popover-surface";
import { registerSurface } from "../ui/surface";
import gridViewsDoc from "./grid-views.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { PopoverSurfaceHandle } from "../ui/popover-surface";

registerSurface("grid-views", gridViewsDoc as unknown as JxDocument);

/** The slot id, and so the panel's region: `overlay.popover:grid/views`. */
const SLOT = "grid/views";

/** One row of the saved-view list. */
export interface GridSavedViewRow {
  /** The view's name: its identity across repaints, and what every button hands back. */
  key: string;
  name: string;
  /** `"true"` for the view currently applied. A string, because a document switches on words. */
  active: string;
  /** `"true"` or `"false"` for `aria-current`. */
  current: string;
  /** The delete button's accessible name, which says which view it forgets. */
  deleteLabel: string;
}

/** A closed list of choices, in the shape the kit's select reads. */
export interface GridSelectOption {
  value: string;
  label: string;
}

/** One column's visibility. */
export interface GridColumnToggle {
  field: string;
  title: string;
  visible: boolean;
}

/** Everything the panel draws, as one value. */
export interface GridViewsView {
  /** Where the panel opens, in viewport pixels. */
  x: number;
  y: number;
  viewsState: "empty" | "listed";
  views: GridSavedViewRow[];
  /** "Save view…" until one is applied, then "Save as…". */
  saveLabel: string;
  columns: GridColumnToggle[];
  /** Every column, plus the "Source order" row that clears the sort. */
  fieldOptions: GridSelectOption[];
  dirOptions: GridSelectOption[];
  groupOptions: GridSelectOption[];
  sortField: string;
  sortDir: string;
  /** There is no sort to redirect, so the direction control is off rather than lying. */
  sortDirDisabled: boolean;
  groupField: string;
}

/** What a control asks the flow to do. */
export interface GridViewsActions {
  applyView: (name: string) => void;
  deleteView: (name: string) => void;
  saveView: () => void;
  reset: () => void;
  toggleColumn: (field: string, visible: boolean) => void;
  setSortField: (field: string) => void;
  setSortDir: (dir: string) => void;
  setGroup: (field: string) => void;
  /** The platform closed the panel: clicked outside, Escape, or a second press on the button. */
  dismissed?: () => void;
}

export interface GridViewsSurfaceHandle extends PopoverSurfaceHandle {
  update: (view: GridViewsView) => void;
}

interface GridViewsScope extends Record<string, unknown>, GridViewsView, GridViewsActions {}

/** Write a projection into the scope. */
function project(scope: GridViewsScope, view: GridViewsView): void {
  scope.x = view.x;
  scope.y = view.y;
  scope.viewsState = view.viewsState;
  scope.views = view.views;
  scope.saveLabel = view.saveLabel;
  scope.columns = view.columns;
  scope.fieldOptions = view.fieldOptions;
  scope.dirOptions = view.dirOptions;
  scope.groupOptions = view.groupOptions;
  scope.sortField = view.sortField;
  scope.sortDir = view.sortDir;
  scope.sortDirDisabled = view.sortDirDisabled;
  scope.groupField = view.groupField;
}

/**
 * Open the View panel under `anchor`.
 *
 * @param {GridViewsView} view - What it shows to begin with
 * @param {GridViewsActions} actions - What each control does
 * @param {HTMLElement | null} anchor - The toolbar button it hangs from
 * @returns {GridViewsSurfaceHandle}
 */
export function openGridViewsSurface(
  view: GridViewsView,
  actions: GridViewsActions,
  anchor: HTMLElement | null,
): GridViewsSurfaceHandle {
  const scope = reactive<GridViewsScope>({
    applyView: actions.applyView,
    columns: [],
    deleteView: actions.deleteView,
    dirOptions: [],
    fieldOptions: [],
    groupField: "",
    groupOptions: [],
    reset: actions.reset,
    saveLabel: "Save view…",
    saveView: actions.saveView,
    setGroup: actions.setGroup,
    setSortDir: actions.setSortDir,
    setSortField: actions.setSortField,
    sortDir: "asc",
    sortDirDisabled: true,
    sortField: "",
    toggleColumn: actions.toggleColumn,
    views: [],
    viewsState: "empty",
    x: 0,
    y: 0,
  }) as GridViewsScope;
  project(scope, view);

  const handle = openPopoverSurface({
    anchor,
    name: "grid-views",
    scope,
    slot: SLOT,
    ...(actions.dismissed ? { onDismissed: actions.dismissed } : {}),
  });

  return {
    close: handle.close,
    host: handle.host,
    isOpen: handle.isOpen,
    ready: handle.ready,
    update: (next) => {
      if (handle.isOpen()) {
        project(scope, next);
      }
    },
  };
}
