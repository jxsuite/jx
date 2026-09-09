/// <reference lib="dom" />
/**
 * The Project Styles outline: what the Navigator's Outline panel shows while the pane is drawing
 * the element catalogue, as a Jx document over the kit.
 *
 * This is the adapter. `panels/stylebook-layers-panel.ts` keeps the panel — which tags the
 * catalogue contains, how a child's compound path is spelled, which of them the open file has
 * already styled, what the component registry holds and which row is selected — and hands this
 * module a flat projection with no decisions left in it: one row per line, already indented,
 * already keyed, already told whether it is the selected one.
 *
 * The flattening happens on the panel's side rather than here for the reason
 * `surfaces/settings-overview.ts` gives: a document's only conditional is `$switch` over a value,
 * and the catalogue is a recursive tree whose children are deduplicated by tag. The panel walks it
 * and the surface renders a list.
 *
 * **The container is not cleared**, which is the one line where a panel differs from a settings
 * section. A section is handed the pane's whole content area and starts by emptying it; a panel
 * body is a node lit renders into, and its comment markers are how lit finds its own content again.
 * So the document is APPENDED, and {@link StylebookLayersSurfaceHandle.connected} is how the panel
 * finds out that lit has since painted something else over the top of it.
 *
 * @docs studio/design/stylebook
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import stylebookLayersDoc from "./panel-stylebook-layers.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("panel-stylebook-layers", stylebookLayersDoc as unknown as JxDocument);

/**
 * One line of the catalogue, as the document draws it. Every field is a value: no records, no
 * closures, no tree.
 */
export interface StylebookRowView {
  /**
   * The row's reconcile key AND what a click selects — for an element the compound path (`"ul
   * li"`), for a component its tag name. One field, because they have never differed and a second
   * one is a second thing to keep in step.
   */
  key: string;
  /** The badge's text: the tag for an element, the glyph for a component. */
  tag: string;
  /** The row's name: the specimen's own text, or `<tag>` where it has none. */
  label: string;
  /** How deep the row sits, as a CSS length. Read by one shared rule through `--row-indent`. */
  indent: string;
  /** Whether this is the selected tag. Drawn as `aria-current`, so it is announced. */
  selected: boolean;
  /** Whether the open file has already styled this tag — the dot at the end of the row. */
  customized: boolean;
  /** `element` or `component`: which of the two badge drawings the row gets. */
  kind: string;
}

/** One custom property the open file declares. */
export interface StylebookVariableView {
  /** The reconcile key. Same as {@link name}; kept separate so the key never follows the label. */
  key: string;
  /** The property, `--accent` and its like. */
  name: string;
  /** Whatever it is declared as, as text. */
  value: string;
}

/** What the panel says the surface should be showing right now. */
export interface StylebookLayersValues {
  /** `elements` or `variables` — `shell.stylebook.tab`, which names the `$switch` case. */
  tab: string;
  rows: StylebookRowView[];
  variables: StylebookVariableView[];
  /** Whether there is anything under the variables tab: the document has no `length` to ask. */
  hasVariables: boolean;
}

/** What a control can ask the panel to do. The one thing a row does is select itself. */
export interface StylebookLayersActions {
  selectRow: (path: string) => void;
}

export interface StylebookLayersSurfaceHandle {
  /** Bring the mounted document up to date with a whole projection. */
  update: (values: StylebookLayersValues) => void;
  /** Whether the document this mounted is still standing in the container it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope the document reads: the projection, plus the one thing a row can ask for. */
interface StylebookLayersScope
  extends Record<string, unknown>, StylebookLayersValues, StylebookLayersActions {}

/** Write a projection into the scope. */
function project(scope: StylebookLayersScope, values: StylebookLayersValues): void {
  scope.tab = values.tab;
  scope.rows = values.rows;
  scope.variables = values.variables;
  scope.hasVariables = values.hasVariables;
}

/**
 * Mount the Project Styles outline into `container`, which is the `.panel-content` the Navigator
 * just painted.
 *
 * Nothing is called on the elements, so the mount is all this has to wait for: the DOCUMENT is what
 * this surface renders, and the kit elements inside it settle their own templates one
 * `connectedCallback` later without anybody here asking them to (guidelines §1.1, "await the
 * element").
 */
export function mountStylebookLayersSurface(
  container: HTMLElement,
  values: StylebookLayersValues,
  actions: StylebookLayersActions,
): StylebookLayersSurfaceHandle {
  const scope = reactive<StylebookLayersScope>({
    hasVariables: false,
    rows: [],
    selectRow: actions.selectRow,
    tab: "elements",
    variables: [],
  }) as StylebookLayersScope;
  project(scope, values);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  void mountSurface("panel-stylebook-layers", scope, container).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    /* While the mount is still in flight there is nothing in the container to ask about, so the
       answer is simply whether this handle is still wanted — answering no would start a second
       mount racing the first. Once mounted, the question is whether the root is still where it was
       put: a Navigator that painted another panel, or the Outline's own lit branch, cleared this
       document out from under it. */
    connected: () =>
      !disposed && (mounted === null || (mounted.root as Node).parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    update: (next) => {
      project(scope, next);
    },
  };
}
