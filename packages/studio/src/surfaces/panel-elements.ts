/// <reference lib="dom" />
/**
 * The Insert surface: the Navigator's element palette, as a Jx document over the kit.
 *
 * This is the adapter. `panels/elements-panel.ts` keeps the panel — what the palette contains, what
 * each element is called, which npm components the open document has enabled, what the filter
 * matches, and what a click inserts where — and hands this module a projection with no decisions
 * left in it: the tab that is showing, a section per category that already knows whether it is
 * open, a named card per thing that can be inserted, and the one of three empty states each tab is
 * in.
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
import type { SurfaceHandle } from "../ui/surface";

registerSurface("panel-elements", elementsDoc);

/** One insertable HTML element: the tag is its identity and what a click inserts. */
export interface ElementCardView {
  tag: string;
  /** What the card is captioned, in the reader's language. */
  name: string;
  /** What the element is for, in one line: the card's tooltip. */
  description: string;
}

/** One category of the palette: an accordion section, keyed by a stable id, labelled by name. */
export interface ElementCategoryView {
  key: string;
  name: string;
  open: boolean;
  elements: ElementCardView[];
}

/** One insertable component. `title` is the row's tooltip: its package, or its path on disk. */
export interface ComponentCardView {
  tagName: string;
  title: string;
}

/** The palette's two tabs (§5.3). */
export type InsertTab = "elements" | "components";

/**
 * Which body a tab is showing under the filter.
 *
 * `"filtered"` and `"empty"` are different answers rather than one with a flag: a tab nothing
 * matches offers to clear the filter, and a tab with nothing in it teaches what it is for, because
 * there is no filter to clear.
 */
export type ElementsEmptyState = "none" | "filtered" | "empty";

/** What the panel says the surface should be showing right now. */
export interface ElementsValues {
  /** The tab that is showing. */
  tab: InsertTab;
  /** What the filter field holds — the reader's own text, never a normalised form of it. */
  filter: string;
  /** The filter's accessible name and placeholder, which says what it narrows. */
  filterLabel: string;
  categories: ElementCategoryView[];
  components: ComponentCardView[];
  elementsEmpty: ElementsEmptyState;
  componentsEmpty: ElementsEmptyState;
  /**
   * The other tab's offer when the filter empties this one but not that one ("Show 2 matching
   * components"), or `""`.
   */
  otherMatches: string;
}

/** What a control can ask the panel to do. Every one of them is a decision the panel owns. */
export interface ElementsActions {
  selectTab: (tab: string) => void;
  showOtherTab: () => void;
  setFilter: (value: string) => void;
  clearFilter: () => void;
  setSectionOpen: (key: string, open: boolean) => void;
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

/**
 * The scope the document reads: {@link ElementsValues}, the flags a `$switch` and a tab panel's
 * `active` need as their own values, and the actions its controls call.
 */
interface ElementsScope extends ElementsValues, ElementsActions {
  elementsShowing: boolean;
  componentsShowing: boolean;
  hasOtherMatches: boolean;
}

/** Write a projection into the scope. */
function project(scope: ElementsScope, values: ElementsValues): void {
  scope.tab = values.tab;
  scope.elementsShowing = values.tab === "elements";
  scope.componentsShowing = values.tab === "components";
  scope.filter = values.filter;
  scope.filterLabel = values.filterLabel;
  scope.categories = values.categories;
  scope.components = values.components;
  scope.elementsEmpty = values.elementsEmpty;
  scope.componentsEmpty = values.componentsEmpty;
  scope.otherMatches = values.otherMatches;
  scope.hasOtherMatches = values.otherMatches !== "";
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
  const scope: ElementsScope = reactive<ElementsScope>({
    categories: [],
    clearFilter: actions.clearFilter,
    components: [],
    componentsEmpty: "none",
    componentsShowing: false,
    elementsEmpty: "none",
    elementsShowing: true,
    filter: "",
    filterLabel: "",
    hasOtherMatches: false,
    insertComponent: actions.insertComponent,
    insertElement: actions.insertElement,
    otherMatches: "",
    selectTab: actions.selectTab,
    setFilter: actions.setFilter,
    setSectionOpen: actions.setSectionOpen,
    showOtherTab: actions.showOtherTab,
    tab: "elements",
  });
  project(scope, values);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on an element here, so the mount is all there is to wait for: the DOCUMENT is
     what this surface renders, and the kit elements inside it settle their own templates one
     `connectedCallback` later without anybody asking them to (studio-ui-guidelines.md §1.1,
     "await the element"). */
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
    connected: () => !disposed && (mounted === null || mounted.root.parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update: (next) => project(scope, next),
  };
}
