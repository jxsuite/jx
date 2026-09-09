/// <reference lib="dom" />
/**
 * The Problems surface: the Bottom dock's first tab, as a Jx document over the kit.
 *
 * This is the adapter. `panels/problems-panel.ts` keeps the panel — what a problem IS, how the list
 * is grouped, which command a row's recovery button carries and what a click does — and hands this
 * module a projection: whether there is anything to show, the Clear button's label, and the groups
 * with their rows already flattened. The document renders that.
 *
 * The flattening happens on the panel's side rather than here for the reason
 * `surfaces/settings-overview.ts` gives: a document has no conditional beyond `$switch` over a
 * value, and "does the registry have this command, and is it enabled" is three questions. The panel
 * answers them and the surface reads booleans.
 *
 * **The container is not cleared, and that is the one line where a panel differs from a settings
 * section.** A section is handed the pane's whole content area and starts by emptying it; a panel
 * body is a node lit renders into, and its comment markers are how lit finds its own content again.
 * Removing them leaves lit inserting into a range that is no longer in the document, silently. So
 * the document is APPENDED, and it is the panel's business (not this module's) to take it down
 * again when the dock paints another tab into the same host.
 *
 * @docs studio/interface/problems-and-progress
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import problemsDoc from "./panel-problems.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("panel-problems", problemsDoc as unknown as JxDocument);

/** One problem, as the document draws it. Every field is a value: no records, no closures. */
export interface ProblemRowView {
  /** The notification's id — the row's reconcile key, and what every button hands back. */
  id: string;
  /** `error` | `warn` | `info` | `success`: the glyph's colour and the row's left edge. */
  severity: string;
  /** The severity glyph itself, one character. */
  icon: string;
  message: string;
  hasPath: boolean;
  path: string;
  /** The path button's tooltip — "Open project.json". */
  pathTitle: string;
  hasDetail: boolean;
  detail: string;
  hasAction: boolean;
  /** The recovery command's title, so the button says what it does rather than "Retry". */
  actionLabel: string;
  actionDisabled: boolean;
  /** The command's tooltip: its title, or its title with the reason it is refused. */
  actionTitle: string;
  /** The dismiss button's accessible name, which has to name the row it dismisses. */
  dismissLabel: string;
}

/** One heading and the rows under it. */
export interface ProblemGroupView {
  source: string;
  rows: ProblemRowView[];
}

/** What the panel says the surface should be showing right now. */
export interface ProblemsValues {
  hasProblems: boolean;
  /** "Clear 3" — the count is part of the label, so the button says how much it takes. */
  clearLabel: string;
  groups: ProblemGroupView[];
}

/** What a control can ask the panel to do. Every one of them is a decision the panel owns. */
export interface ProblemsActions {
  clearAll: () => void;
  dismissRow: (id: string) => void;
  openPath: (path: string) => void;
  runAction: (id: string) => void;
}

export interface ProblemsSurfaceHandle {
  /** Bring the mounted document up to date with a whole projection. */
  update: (values: ProblemsValues) => void;
  /** Whether the document this mounted is still standing in the container it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope the document reads: the projection, and the four things a row can ask for. */
interface ProblemsScope extends Record<string, unknown> {
  hasProblems: boolean;
  clearLabel: string;
  groups: ProblemGroupView[];
  clearAll: () => void;
  dismissRow: (id: string) => void;
  openPath: (path: string) => void;
  runAction: (id: string) => void;
}

/** Write a projection into the scope. */
function project(scope: ProblemsScope, values: ProblemsValues): void {
  scope.hasProblems = values.hasProblems;
  scope.clearLabel = values.clearLabel;
  scope.groups = values.groups;
}

/**
 * Mount the Problems document into `container`, which is the panel body the dock just painted.
 *
 * Nothing is called on the elements, so the mount is all this has to wait for: the DOCUMENT is what
 * this surface renders, and the kit elements inside it settle their own templates one
 * `connectedCallback` later without anybody here asking them to (guidelines §1.1, "await the
 * element").
 */
export function mountProblemsSurface(
  container: HTMLElement,
  values: ProblemsValues,
  actions: ProblemsActions,
): ProblemsSurfaceHandle {
  const scope = reactive<ProblemsScope>({
    clearAll: actions.clearAll,
    clearLabel: "",
    dismissRow: actions.dismissRow,
    groups: [],
    hasProblems: false,
    openPath: actions.openPath,
    runAction: actions.runAction,
  }) as ProblemsScope;
  project(scope, values);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  void mountSurface("panel-problems", scope, container).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    /* While the mount is still in flight there is nothing in the container to ask about, so the
       answer is simply whether this handle is still wanted. Once mounted, the question is whether
       the root is still where it was put: a dock that repainted with another tab selected, or one
       that collapsed, had the panel body emptied out from under it. */
    connected: () =>
      !disposed && (mounted === null || (mounted.root as Node).parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    update: (values_) => {
      project(scope, values_);
    },
  };
}
