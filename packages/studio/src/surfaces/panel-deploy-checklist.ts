/// <reference lib="dom" />
/**
 * The deploy checklist, as a Jx document over the kit.
 *
 * This is the adapter. `publish/deploy-checklist.ts` keeps the chain — what a prerequisite IS,
 * which link is forged, which is merely unasked, and which command forges the next one — and hands
 * this module a projection plus the one thing a click can ask for. The document
 * (`surfaces/panel-deploy-checklist.json`) renders that and decides nothing.
 *
 * **The projection is flattened on the checklist's side**, for the reason
 * `surfaces/panel-problems.ts` gives: a document's only conditional is `$switch` over a value, so
 * "does the registry have this command, is it visible, and is it enabled" is three questions the
 * checklist answers before the scope is written.
 *
 * **One effect, not a repaint.** The checklist used to be a lit template interpolated into the
 * Activity tab's body, so it was redrawn whenever anything in the activity store moved and never
 * when source control reported. The subscription moved here: {@link mountDeployChecklistSurface}
 * opens an effect scope that reads {@link DeployChecklistDeps.project} and writes the result into
 * the scope, so the row now follows `shell.git`, the project config, the observed deployment and
 * the command registry — every one of which is reactive — and follows nothing else.
 *
 * **Mounting is idempotent because `afterRender` is not.** A panel's hook runs on EVERY paint of
 * the dock — showing or not (`panels/bottom-dock.ts`) — so this keeps the standing surface when it
 * is handed the container it is already in, and only mounts into one the document has been taken
 * out of.
 *
 * @docs studio/publish
 */

import { effect, effectScope, reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import checklistDoc from "./panel-deploy-checklist.json";
import type { EffectScope } from "@vue/reactivity";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("panel-deploy-checklist", checklistDoc as unknown as JxDocument);

/** One prerequisite, as the document draws it. Every field is a value: no records, no closures. */
export interface DeployStepRowView {
  /** The step's id — its reconcile key, and what `data-step` carries. */
  id: string;
  /** `done` | `todo` | `unknown`, as `data-state`. `unknown` is not a third kind of "no". */
  state: string;
  /** The one-character glyph the checklist chose for that state. */
  icon: string;
  /** The label, and — unless the link is forged — the sentence that says what is missing. */
  text: string;
}

/** What the checklist says the surface should be showing right now. */
export interface DeployChecklistView {
  /** No project, no checklist: the row is about a thing to ship, and there is nothing to ship. */
  hasProject: boolean;
  /** `running` while any link is unforged, `done` when the chain is whole. */
  rowState: string;
  rowIcon: string;
  /** The blocking step's detail, or the sentence that says nothing is blocking. */
  summary: string;
  steps: DeployStepRowView[];
  hasAction: boolean;
  /** The command's own title, so the button is read as a verb rather than as "Retry". */
  actionLabel: string;
  /** The command's tooltip: its title, or its title with the reason it is refused. */
  actionTitle: string;
  actionDisabled: boolean;
}

/** What the surface needs from the checklist: one projection, and the one decision it can ask for. */
export interface DeployChecklistDeps {
  /**
   * Recompute what the row shows.
   *
   * Called from inside this surface's own effect, so every reactive record it reads on the way —
   * source control's status, the project config, the command registry — is tracked, and the row
   * follows a repository that has just gained a remote with nothing subscribing by hand.
   */
  project: () => DeployChecklistView;
  /** Run the next blocking step's command. Which command that is stays the checklist's. */
  runAction: () => void;
}

/** The scope the document reads: the projection, flattened, beside the one callback. */
interface DeployChecklistScope extends Record<string, unknown>, DeployChecklistView {
  runAction: () => void;
}

let _container: HTMLElement | null = null;
let _scope: EffectScope | null = null;
let _mount: Promise<SurfaceHandle> | null = null;
let _handle: SurfaceHandle | null = null;

/** Write a projection into the scope. Replacing `steps` wholesale is what the keyed map wants. */
function write(scope: DeployChecklistScope, view: DeployChecklistView): void {
  scope.hasProject = view.hasProject;
  scope.rowState = view.rowState;
  scope.rowIcon = view.rowIcon;
  scope.summary = view.summary;
  scope.steps = view.steps;
  scope.hasAction = view.hasAction;
  scope.actionLabel = view.actionLabel;
  scope.actionTitle = view.actionTitle;
  scope.actionDisabled = view.actionDisabled;
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
 * Draw the checklist into `container`, or leave the one already there alone.
 *
 * @param container The element the Activity tab's template paints for it.
 * @param deps The checklist's projection and its one callback.
 */
export function mountDeployChecklistSurface(
  container: HTMLElement,
  deps: DeployChecklistDeps,
): void {
  if (standingIn(container)) {
    return;
  }
  disposeDeployChecklistSurface();
  _container = container;
  const scope = reactive<DeployChecklistScope>({
    actionDisabled: false,
    actionLabel: "",
    actionTitle: "",
    hasAction: false,
    hasProject: false,
    rowIcon: "",
    rowState: "running",
    runAction: deps.runAction,
    steps: [],
    summary: "",
  }) as DeployChecklistScope;
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      write(scope, deps.project());
    });
  });
  /* Nothing is called on an element here, so the mount is all there is to wait for: the DOCUMENT is
     what this surface renders, and the kit elements inside it settle their own templates one
     `connectedCallback` later without anybody asking them to (studio-ui-guidelines.md §1.1). */
  const pending = mountSurface("panel-deploy-checklist", scope, container);
  _mount = pending;
  void pending.then((handle) => {
    if (_mount === pending) {
      _handle = handle;
    } else {
      handle.dispose();
    }
  });
}

/** Take the checklist down and forget its container. Idempotent. */
export function disposeDeployChecklistSurface(): void {
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
