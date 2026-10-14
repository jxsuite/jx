/// <reference lib="dom" />
/**
 * The data section's actions row, as a mounted document.
 *
 * This is the adapter. `panels/data-grid.ts` is the flow — which section keys are data-domain,
 * whether the platform serves the data routes, what a test returned, what a push does — and this is
 * the row it draws into `surfaces/settings-contributed.json`'s actions host.
 *
 * **The seam did not move; what fills it did.** The generic contributed-section renderer stays
 * extension-agnostic: it draws an empty host and hands it to whoever contributed the actions. That
 * host used to be lit-rendered on every redraw, so it is now MOUNTED once per host and projected on
 * every redraw — which is also what stops a redraw arriving mid-test from replacing the row and
 * losing the button the reader has their pointer on.
 *
 * @docs studio/data/grid
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import dataActionsDoc from "./data-actions.json";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("data-actions", dataActionsDoc);

/** Everything the row draws. */
export interface DataActionsView {
  /** Only the connections section can test a connection; the data section has none to name. */
  testState: "hidden" | "shown";
  /** "Test Connection", or "Testing…" while one is in flight. */
  testLabel: string;
  testDisabled: boolean;
  resultState: "hidden" | "shown";
  /** `"true"` or `"false"` — a word, because a document switches and styles on words. */
  resultOk: string;
  /** "main: connected", or "main: could not reach the host". */
  resultText: string;
  /** The failure in full, when the sentence was shortened. */
  resultTitle: string;
}

/** What a press asks the flow to do. */
export interface DataActionsCallbacks {
  test: () => void;
  push: () => void;
  openGrid: () => void;
}

export interface DataActionsSurfaceHandle {
  ready: Promise<HTMLElement>;
  update: (view: DataActionsView) => void;
  dispose: () => void;
}

interface DataActionsScope extends DataActionsView, DataActionsCallbacks {}

/** Write a projection into the scope. */
function project(scope: DataActionsScope, view: DataActionsView): void {
  scope.testState = view.testState;
  scope.testLabel = view.testLabel;
  scope.testDisabled = view.testDisabled;
  scope.resultState = view.resultState;
  scope.resultOk = view.resultOk;
  scope.resultText = view.resultText;
  scope.resultTitle = view.resultTitle;
}

/**
 * Mount the actions row into `host`.
 *
 * @param {HTMLElement} host - The section document's actions island
 * @param {DataActionsView} view - What to draw right now
 * @param {DataActionsCallbacks} actions - What each press does
 * @returns {DataActionsSurfaceHandle}
 */
export function mountDataActionsSurface(
  host: HTMLElement,
  view: DataActionsView,
  actions: DataActionsCallbacks,
): DataActionsSurfaceHandle {
  const scope: DataActionsScope = reactive<DataActionsScope>({
    openGrid: actions.openGrid,
    push: actions.push,
    resultOk: "false",
    resultState: "hidden",
    resultText: "",
    resultTitle: "",
    test: actions.test,
    testDisabled: false,
    testLabel: "Test Connection",
    testState: "hidden",
  });
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("data-actions", scope, host).then((surface) => {
    /* SAFETY: `data-actions.json`'s root definition is a `div` element, so the runtime mounts an
       HTMLElement; a `Text` root only comes from a document whose root is a bare string. */
    const root = surface.root as HTMLElement;
    if (disposed) {
      surface.dispose();
      return root;
    }
    mounted = surface;
    return root;
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
