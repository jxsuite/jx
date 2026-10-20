/// <reference lib="dom" />
/**
 * The Styles panel surface: the Styles workspace's Navigator, as a Jx document over the kit
 * (`specs/studio.md` §7.1).
 *
 * This is the adapter. `panels/styles-panel.ts` keeps every decision (which custom properties the
 * project declares and how they group, what each colour resolves to, which tags the catalogue holds
 * and which of them project.json already styles, which color schemes `$media` declares, and which
 * row is current) and hands this module one projection whose every field is already a string. The
 * document draws three sections and decides nothing.
 *
 * @docs studio/design/tokens
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import stylesPanelDoc from "./styles-panel.json";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("styles-panel", stylesPanelDoc);

/** One custom property under its group. */
export interface StylesVariableRow {
  /** The property, by its real name: `--accent`. Also the row's key. */
  name: string;
  /** What it is declared as, as text. */
  value: string;
  /** `swatch` for a colour, whose chip is drawn; `none` for every other group. */
  swatchState: "swatch" | "none";
  /** The colour the chip is painted, already resolved through any `var()` chain; "" for none. */
  swatch: string;
  /** Whether this is the property the Variables view is pointed at. */
  selected: boolean;
}

/** One group of custom properties: Colors, Fonts, Sizes & Spacing, Other. */
export interface StylesVariableGroup {
  /** The token group id, `color`; the key, and what a heading click shows. */
  id: string;
  title: string;
  /** How many the group holds, as text: "6". */
  count: string;
  /** The count, said in words for a screen reader: "6 variables". */
  countLabel: string;
  variables: StylesVariableRow[];
}

/** One element default, by tag name. */
export interface StylesElementRow {
  /** What a click selects: the compound path (`ul li`), or a component's tag. Also the key. */
  key: string;
  /** The tag name the row shows: `h1`, `li`, `site-card`. */
  tag: string;
  /** How deep the row sits, as a CSS length, read through `--row-indent`. */
  indent: string;
  /** Whether project.json already styles this tag: the dot. */
  customized: boolean;
  /** Whether this is the tag the Elements view has selected. */
  selected: boolean;
}

/** One block of the catalogue: Headings, Lists, Components. */
export interface StylesElementGroup {
  key: string;
  label: string;
  rows: StylesElementRow[];
}

/** One color scheme the project declares. */
export interface StylesSchemeRow {
  /** The `$media` entry, `--dark`. */
  key: string;
  /** "Light" or "Dark". */
  label: string;
  /** The media query that selects it: "(prefers-color-scheme: dark)". */
  query: string;
}

/** Everything the document draws. */
export interface StylesPanelValues {
  /** `none` asks for a project; `styles` draws the three sections. */
  body: "none" | "styles";
  /** Every custom property in the root style block, as text. */
  variableCount: string;
  variablesState: "empty" | "listed";
  groups: StylesVariableGroup[];
  elementGroups: StylesElementGroup[];
  /** How many tags project.json styles, as the on-screen count ("3 styled"), and in full words. */
  customizedCount: string;
  customizedLabel: string;
  schemesState: "empty" | "listed";
  schemes: StylesSchemeRow[];
}

/** What a control can ask the panel to do. Every one is a decision the flow owns. */
export interface StylesPanelActions {
  /** A group heading: the Variables view, at that group. */
  showGroup: (group: string) => void;
  /** A variable row: the Variables view, at that property. */
  selectVariable: (name: string) => void;
  /** **Add variable**: the Variables view's add row. */
  addVariable: () => void;
  /** An element row: the Elements view, with that tag selected. */
  selectElement: (path: string) => void;
  /** **Manage color schemes…**: Project Settings › Contexts. */
  manageSchemes: () => void;
}

export interface StylesPanelSurfaceHandle {
  readonly ready: Promise<unknown>;
  /** Whether the mounted root is still where it was put. */
  connected: () => boolean;
  update: (values: StylesPanelValues) => void;
  dispose: () => void;
}

interface StylesPanelScope extends StylesPanelValues, StylesPanelActions {}

/** The scope's shape before the first projection lands on it. */
export function emptyStylesPanelValues(): StylesPanelValues {
  return {
    body: "none",
    customizedCount: "0",
    customizedLabel: "",
    elementGroups: [],
    groups: [],
    schemes: [],
    schemesState: "empty",
    variableCount: "0",
    variablesState: "empty",
  };
}

/** Write a projection in, field by field, so an unchanged field is inert. */
function project(scope: StylesPanelScope, values: StylesPanelValues): void {
  scope.body = values.body;
  scope.variableCount = values.variableCount;
  scope.variablesState = values.variablesState;
  scope.groups = values.groups;
  scope.elementGroups = values.elementGroups;
  scope.customizedCount = values.customizedCount;
  scope.customizedLabel = values.customizedLabel;
  scope.schemesState = values.schemesState;
  scope.schemes = values.schemes;
}

/**
 * Mount the Styles panel into `container`, the content box the Navigator painted.
 *
 * @param container Where the document goes.
 * @param values What it shows to begin with.
 * @param actions What its controls do.
 */
export function mountStylesPanelSurface(
  container: HTMLElement,
  values: StylesPanelValues,
  actions: StylesPanelActions,
): StylesPanelSurfaceHandle {
  const scope: StylesPanelScope = reactive<StylesPanelScope>({
    ...emptyStylesPanelValues(),
    ...actions,
  });
  project(scope, values);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("styles-panel", scope, container).then((surface) => {
    if (disposed) {
      surface.dispose();
      return surface;
    }
    mounted = surface;
    return surface;
  });

  return {
    connected: () => {
      if (disposed) {
        return false;
      }
      const root = mounted?.root;
      // A mount still in flight is not yet in the container, and is not a reason to remount.
      return root === undefined ? true : container.contains(root);
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update: (next) => {
      project(scope, next);
    },
  };
}
