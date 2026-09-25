/// <reference lib="dom" />
/**
 * The spreadsheet grid's frame, as a mounted document.
 *
 * This is the adapter. `grid/grid-panel.ts` is the flow — which tab has a controller, what the
 * toolbar's numbers mean, which saved view is applied, when the engine may be built — and this is
 * the surface it draws into: a reactive scope of already-formatted strings and booleans, and a
 * mount that survives every repaint.
 *
 * **Tabulator is an ISLAND and stays one** (specs/studio-ui-guidelines.md §9.4). The document draws
 * `[part="host"]` empty; this module announces that node the moment it is CREATED, one reconcile
 * step before it is in the page, and the flow builds the engine into it. Nothing about a column, a
 * range or a row reaches the document.
 *
 * **The host node's identity is now guaranteed by construction.** The lit shell wrapped that div in
 * a `guard()` because a template that re-rendered the toolbar could otherwise re-commit the host
 * and silently destroy the engine inside it. A document reconciles its tree in place, so a Save
 * badge ticking cannot take the node with it — the guarantee moved from a directive somebody had to
 * remember to the rendering model.
 *
 * **The container is CLEARED**, because this is a canvas stage rather than a panel body:
 * `canvas/canvas-render.ts` hands a stage to whichever mode owns it whole.
 *
 * @docs studio/editing/grid
 * @docs studio/data/grid
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import gridPanelDoc from "./grid-panel.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("grid-panel", gridPanelDoc as unknown as JxDocument);

/** Everything the frame draws, as one value. Every field is already a string or a boolean. */
export interface GridPanelView {
  /**
   * Whether there is a grid to draw at all.
   *
   * A tab can reach grid mode with no controller behind it (a stale deep link, a virtual id whose
   * source is gone), and that is a sentence rather than an empty table.
   */
  view: "missing" | "grid";
  /** "Save", or "Save (3)" — the dirty count is part of the name, not a badge beside it. */
  saveLabel: string;
  saveDisabled: boolean;
  refreshDisabled: boolean;
  /** Whether the source can take a new row, and whether it can lose one. */
  canInsert: boolean;
  canDelete: boolean;
  /** The View button's label: "View", the applied view's name, or that name with a drift dot. */
  viewLabel: string;
  /** What the filter box holds. Part of the saved view, so it survives a tab switch. */
  filter: string;
  groupState: "hidden" | "shown";
  /** "Grouped by Status · 3 groups" — the grouping is invisible in the rows, so the toolbar says it. */
  groupNote: string;
  /** Whether saving this source rewrites frontmatter. */
  lossyState: "hidden" | "shown";
  pagerState: "hidden" | "shown";
  /** "51–100" for the page on screen. */
  pageRange: string;
  prevDisabled: boolean;
  nextDisabled: boolean;
  /** Which of three things the far end says. */
  countState: "loading" | "error" | "total";
  /** "1 row" / "120 rows", already pluralised. */
  countLabel: string;
  error: string;
}

/** What a control asks the flow to do. Every one of them is a decision the flow owns. */
export interface GridPanelActions {
  save: () => void;
  refresh: () => void;
  addRow: () => void;
  deleteRows: () => void;
  fillDown: () => void;
  /** Both popovers open under their own button, so each is handed its opener. */
  openReplace: (anchor: HTMLElement) => void;
  openViews: (anchor: HTMLElement) => void;
  setFilter: (term: string) => void;
  prevPage: () => void;
  nextPage: () => void;
  /**
   * Tabulator's node exists, detached and empty. The flow decides whether the engine may be built
   * yet: nothing here knows whether the columns have loaded.
   */
  gridHost: (element: HTMLElement) => void;
}

export interface GridPanelSurfaceHandle {
  /** Resolves with the document's root once it has rendered. */
  ready: Promise<HTMLElement>;
  update: (view: GridPanelView) => void;
  dispose: () => void;
}

/** The scope the document reads: {@link GridPanelView} plus the actions its controls call. */
interface GridPanelScope extends Record<string, unknown>, GridPanelView, GridPanelActions {}

/** Write a projection into the scope. */
function project(scope: GridPanelScope, view: GridPanelView): void {
  scope.view = view.view;
  scope.saveLabel = view.saveLabel;
  scope.saveDisabled = view.saveDisabled;
  scope.refreshDisabled = view.refreshDisabled;
  scope.canInsert = view.canInsert;
  scope.canDelete = view.canDelete;
  scope.viewLabel = view.viewLabel;
  scope.filter = view.filter;
  scope.groupState = view.groupState;
  scope.groupNote = view.groupNote;
  scope.lossyState = view.lossyState;
  scope.pagerState = view.pagerState;
  scope.pageRange = view.pageRange;
  scope.prevDisabled = view.prevDisabled;
  scope.nextDisabled = view.nextDisabled;
  scope.countState = view.countState;
  scope.countLabel = view.countLabel;
  scope.error = view.error;
}

/** The `part` a node's definition carries, or "" for a text node or an unmarked element. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/**
 * Mount the grid frame into `host`, wired to `actions`.
 *
 * @param {HTMLElement} host - The pane's canvas stage
 * @param {GridPanelView} view - What to draw right now
 * @param {GridPanelActions} actions - What each control does
 * @returns {GridPanelSurfaceHandle}
 */
export function mountGridPanelSurface(
  host: HTMLElement,
  view: GridPanelView,
  actions: GridPanelActions,
): GridPanelSurfaceHandle {
  host.replaceChildren();
  const scope = reactive<GridPanelScope>({
    addRow: actions.addRow,
    canDelete: false,
    canInsert: false,
    countLabel: "",
    countState: "loading",
    deleteRows: actions.deleteRows,
    error: "",
    fillDown: actions.fillDown,
    filter: "",
    gridHost: actions.gridHost,
    groupNote: "",
    groupState: "hidden",
    lossyState: "hidden",
    nextDisabled: true,
    nextPage: actions.nextPage,
    openReplace: actions.openReplace,
    openViews: actions.openViews,
    pageRange: "",
    pagerState: "hidden",
    prevDisabled: true,
    prevPage: actions.prevPage,
    refresh: actions.refresh,
    refreshDisabled: false,
    save: actions.save,
    saveDisabled: true,
    saveLabel: "Save",
    setFilter: actions.setFilter,
    view: "grid",
    viewLabel: "View",
  }) as GridPanelScope;
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("grid-panel", scope, host, {
    onNodeCreated: (element, _path, def) => {
      /* Announced as CREATED rather than awaited: an un-awaited `connectedCallback` is one
         reconcile step later, and the engine wants the node before the frame is painted. */
      if (partOf(def) === "host" && element instanceof HTMLElement) {
        actions.gridHost(element);
      }
    },
  }).then((surface) => {
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
