/// <reference lib="dom" />
/**
 * The Activity feed, as a Jx document over the kit.
 *
 * This is the adapter. `panels/activity-panel.ts` keeps the record — what an operation is, what its
 * log holds, what Cancel does to it and when a finished one retires — and hands this module a
 * projection plus the three things a click can ask for. The document
 * (`surfaces/panel-activity.json`) renders that and decides nothing.
 *
 * **The projection is flattened on the panel's side**, for the reason
 * `surfaces/settings-overview.ts` gives: a document's only conditional is `$switch` over a value,
 * so "does this entry have a log, and is it unfolded" is two questions the panel answers before the
 * scope is written.
 *
 * **One effect, not a repaint.** The Bottom dock used to re-render the whole tab whenever anything
 * in the activity store moved, because `render()` read the store from inside the dock's own effect.
 * A document has no render, so the subscription moved here: {@link mountActivitySurface} opens an
 * effect scope that reads {@link ActivitySurfaceDeps.project} and writes the result into the scope,
 * and the runtime updates exactly the bindings whose values changed. A log line appended to an open
 * row is one text write, not a repaint of twenty rows.
 *
 * **Mounting is idempotent because `afterRender` is not.** A panel's hook runs on EVERY paint of
 * the dock — showing or not (`panels/bottom-dock.ts`) — so this keeps the standing surface when it
 * is handed the container it is already in, and only mounts into one the document has been taken
 * out of.
 *
 * @docs studio/interface/problems-and-progress
 */

import { effect, effectScope, reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import activityDoc from "./panel-activity.json";
import type { EffectScope } from "@vue/reactivity";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("panel-activity", activityDoc as unknown as JxDocument);

/** One declared phase of an operation, as the surface reads it. */
export interface ActivityStepView {
  /** Stable within the row, so a step list reconciles instead of being rebuilt. */
  key: string;
  label: string;
  /** Drives the row's colour through `data-state`. */
  state: string;
  /** The one-character glyph the panel chose for that state. */
  icon: string;
}

/** One operation, as the surface reads it. */
export interface ActivityRowView {
  id: string;
  /** `running` | `done` | `failed` | `cancelled`, as `data-state`. */
  state: string;
  icon: string;
  title: string;
  source: string;
  hasSource: boolean;
  /** How long it has taken, already in the coarsest unit that is still true. */
  duration: string;
  status: string;
  hasStatus: boolean;
  steps: ActivityStepView[];
  hasSteps: boolean;
  /** The captured output, already joined — a document renders text, not an array. */
  logText: string;
  hasLog: boolean;
  /** The disclosure's whole wording, which is also its state. */
  logLabel: string;
  expanded: boolean;
  /** `hasLog && expanded`, so the `<pre>` is one `$switch` rather than two nested ones. */
  showLog: boolean;
  cancellable: boolean;
}

/** What the panel says the surface should be showing right now. */
export interface ActivityView {
  rows: ActivityRowView[];
  hasRows: boolean;
  hasFinished: boolean;
  /** "Clear 3 finished" — the count is the panel's, so the document holds no arithmetic. */
  clearLabel: string;
}

/** What the surface needs from the panel: one projection, and the three decisions it can ask for. */
export interface ActivitySurfaceDeps {
  /**
   * Recompute what the feed shows.
   *
   * Called from inside this surface's own effect, so every reactive record it reads on the way —
   * the activity list, an entry's status, its log — is tracked, and the surface follows a running
   * operation with nothing subscribing by hand.
   */
  project: () => ActivityView;
  cancel: (id: string) => void;
  clearFinished: () => void;
  toggleLog: (id: string) => void;
}

/** The scope the document reads: the projection, flattened, beside the three callbacks. */
interface ActivityScope extends Record<string, unknown> {
  rows: ActivityRowView[];
  hasRows: boolean;
  hasFinished: boolean;
  clearLabel: string;
  cancel: (id: string) => void;
  clearFinished: () => void;
  toggleLog: (id: string) => void;
}

let _container: HTMLElement | null = null;
let _scope: EffectScope | null = null;
let _mount: Promise<SurfaceHandle> | null = null;
let _handle: SurfaceHandle | null = null;

/** Write a projection into the scope. Replacing `rows` wholesale is what the keyed map wants. */
function write(scope: ActivityScope, view: ActivityView): void {
  scope.rows = view.rows;
  scope.hasRows = view.hasRows;
  scope.hasFinished = view.hasFinished;
  scope.clearLabel = view.clearLabel;
}

/** Whether the document this mounted is still standing in `container`. */
function standingIn(container: HTMLElement): boolean {
  if (_container !== container) {
    return false;
  }
  // Still mounting into this very container: a second call must not start a second mount.
  return _handle === null ? _mount !== null : (_handle.root as Node).parentNode === container;
}

/**
 * Draw the feed into `container`, or leave the one already there alone.
 *
 * @param {HTMLElement} container The element the panel's template paints for it
 * @param {ActivitySurfaceDeps} deps The panel's projection and its three callbacks
 */
export function mountActivitySurface(container: HTMLElement, deps: ActivitySurfaceDeps): void {
  if (standingIn(container)) {
    return;
  }
  disposeActivitySurface();
  _container = container;
  const scope = reactive<ActivityScope>({
    cancel: deps.cancel,
    clearFinished: deps.clearFinished,
    clearLabel: "",
    hasFinished: false,
    hasRows: false,
    rows: [],
    toggleLog: deps.toggleLog,
  }) as ActivityScope;
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      write(scope, deps.project());
    });
  });
  /* Nothing is called on an element here, so the mount is all there is to wait for: the DOCUMENT is
     what this surface renders, and the kit elements inside it settle their own templates one
     `connectedCallback` later without anybody asking them to (studio-ui-guidelines.md §1.1). */
  const pending = mountSurface("panel-activity", scope, container);
  _mount = pending;
  void pending.then((handle) => {
    if (_mount === pending) {
      _handle = handle;
    } else {
      handle.dispose();
    }
  });
}

/** Take the feed down and forget its container. Idempotent. */
export function disposeActivitySurface(): void {
  _scope?.stop();
  _scope = null;
  const pending = _mount;
  _mount = null;
  if (_handle) {
    _handle.dispose();
    _handle = null;
  } else if (pending) {
    void pending.then((handle) => handle.dispose());
  }
  _container = null;
}
