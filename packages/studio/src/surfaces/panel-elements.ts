/// <reference lib="dom" />
/**
 * The Insert surface: the Navigator's element palette, as a Jx document over the kit.
 *
 * This is the adapter. `panels/elements-panel.ts` keeps the panel — what the palette contains,
 * which npm components the open document has enabled, what the filter matches, and what a click
 * inserts where — and hands this module a projection with no decisions left in it: a section per
 * category that already knows whether it is open, a card per thing that can be inserted, and the
 * one of three empty states the palette is in.
 *
 * The flattening is here rather than in the document for the reason `surfaces/settings-overview.ts`
 * gives: `$switch` over a value is the only conditional a document has, and "is there anything to
 * show, and is that because the filter matched nothing" is two questions.
 *
 * **The filter value is an echo.** `setFilter` is handed what the field now holds and the panel
 * writes exactly that back into the scope — not a normalised form of it. A binding only writes when
 * the scope value changes, so a scope holding the lower-cased text while the field holds what was
 * typed is a binding that fires on every keystroke and puts the reader's caret back at the end of a
 * word it just rewrote. Matching lower-cases at the point of comparison instead.
 *
 * **The container is NOT cleared**, which is the difference between a panel and a settings section.
 * A section is handed the pane's whole content area; a panel is handed `.panel-content`, a node lit
 * owns and renders `nothing` into, so its markers are already there and taking them out would leave
 * lit holding a part whose ends are detached. Appending beside them is safe both ways: a repaint of
 * the same panel commits `nothing` again, which lit skips, and a switch to another panel commits
 * that panel's template, which clears to the end of the parent and takes this document with it.
 * {@link ElementsSurfaceHandle.connected} is then how the panel finds out.
 *
 * @docs studio/design/elements
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import elementsDoc from "./panel-elements.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("panel-elements", elementsDoc as unknown as JxDocument);

/** One insertable HTML element: the tag is its identity, its caption and what a click inserts. */
export interface ElementCardView {
  tag: string;
}

/** One category of the palette — an accordion section, keyed and labelled by its name. */
export interface ElementCategoryView {
  name: string;
  open: boolean;
  elements: ElementCardView[];
}

/** One insertable component. `title` is the row's tooltip: its package, or its path on disk. */
export interface ComponentCardView {
  tagName: string;
  title: string;
}

/**
 * Which body the palette is showing under its filter.
 *
 * `"filtered"` and `"empty"` are different answers rather than one with a flag: a palette nothing
 * matches offers to clear the filter, and a palette with nothing in it teaches what the region is
 * for, because there is no filter to clear.
 */
export type ElementsEmptyState = "none" | "filtered" | "empty";

/** What the panel says the surface should be showing right now. */
export interface ElementsValues {
  /** What the filter field holds — the reader's own text, never a normalised form of it. */
  filter: string;
  categories: ElementCategoryView[];
  components: ComponentCardView[];
  componentsOpen: boolean;
  hasComponents: boolean;
  emptyState: ElementsEmptyState;
}

/** What a control can ask the panel to do. Every one of them is a decision the panel owns. */
export interface ElementsActions {
  setFilter: (value: string) => void;
  clearFilter: () => void;
  setSectionOpen: (name: string, open: boolean) => void;
  setComponentsOpen: (open: boolean) => void;
  insertElement: (tag: string) => void;
  insertComponent: (tagName: string) => void;
}

export interface ElementsSurfaceHandle {
  /** Bring the mounted document up to date. */
  update: (values: ElementsValues) => void;
  /**
   * Settles once the document has rendered.
   *
   * The palette has an imperative step after every paint — `panels/dnd.ts` hangs the drag on each
   * card and fills its preview — and a mount is asynchronous, so the panel needs somewhere to
   * wait.
   */
  ready: Promise<void>;
  /** Whether the document this mounted is still standing in the container it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope the document reads: {@link ElementsValues} plus the actions its controls call. */
interface ElementsScope extends Record<string, unknown>, ElementsValues, ElementsActions {}

/** Write a projection into the scope. */
function project(scope: ElementsScope, values: ElementsValues): void {
  scope.filter = values.filter;
  scope.categories = values.categories;
  scope.components = values.components;
  scope.componentsOpen = values.componentsOpen;
  scope.hasComponents = values.hasComponents;
  scope.emptyState = values.emptyState;
}

/**
 * Mount the Insert document into `container`, wired to `actions`.
 *
 * @param {HTMLElement} container - The panel's `.panel-content`
 * @param {ElementsValues} values - What to draw right now
 * @param {ElementsActions} actions - What each control does
 * @returns {ElementsSurfaceHandle}
 */
export function mountElementsSurface(
  container: HTMLElement,
  values: ElementsValues,
  actions: ElementsActions,
): ElementsSurfaceHandle {
  const scope = reactive<ElementsScope>({
    categories: [],
    clearFilter: actions.clearFilter,
    components: [],
    componentsOpen: true,
    emptyState: "none",
    filter: "",
    hasComponents: false,
    insertComponent: actions.insertComponent,
    insertElement: actions.insertElement,
    setComponentsOpen: actions.setComponentsOpen,
    setFilter: actions.setFilter,
    setSectionOpen: actions.setSectionOpen,
  }) as ElementsScope;
  project(scope, values);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on an element here, so the mount is all there is to wait for: the DOCUMENT is
     what this surface renders, and the kit elements inside it settle their own templates one
     `connectedCallback` later without anybody asking them to (§1.1, "await the element"). */
  const ready = mountSurface("panel-elements", scope, container).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    /* In flight the answer is yes: nothing has landed yet, so there is nothing that could have been
       taken away, and answering no would start a second mount racing the first. Once mounted the
       question is whether the root is still in the container — a panel that was switched away from
       had its document cleared out from under it by lit. */
    connected: () =>
      !disposed && (mounted === null || (mounted.root as Node).parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update: (next) => project(scope, next),
  };
}
