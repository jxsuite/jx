/// <reference lib="dom" />
/**
 * The shared empty state as a mounted document — the seam, and nothing else.
 *
 * `empty-state.json` is the markup and the style; `panels/empty-state.ts` is the VOCABULARY (the
 * copy rules, the shared verbs, `openPageAction`), and it keeps it: this module imports the spec
 * type rather than restating it, so a region that says "click anything on the canvas to style it"
 * is still saying the one sentence every equivalent surface says.
 *
 * **The seam is a node a lit caller interpolates.** A document CLEARS the host it is given and lit
 * renders BESIDE foreign nodes, so the two can never share a container — and every caller here is a
 * lit render root that draws a panel's content OR this instead of it. So the surface owns a
 * `display: contents` host of its own, exactly as `surfaces/ai-credentials-form.ts` does, and the
 * caller hands that node to lit as a child value. lit inserts a Node it is given rather than
 * cloning it, takes it back out when the branch flips to the panel's own markup, and puts the same
 * one back when it flips again — so the document survives the switch instead of being rebuilt by
 * it, and no caller has to remember to dispose anything.
 *
 * **One surface per OWNER, not one per call.** {@link emptyState} caches by the lit host, because
 * an empty state is drawn from inside a render function that runs on every tick: a fresh mount per
 * call would hand lit a new node every time, which is a remount of the document on every repaint of
 * the region around it. Keyed by the host, the repaint is an assignment.
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import emptyStateDoc from "./empty-state.json";
import type { EmptyStateSpec } from "../panels/empty-state";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("empty-state", emptyStateDoc as unknown as JxDocument);

/** One button, as the document draws it: a key, a word, and whether it can act. */
interface EmptyStateActionRow extends Record<string, unknown> {
  /** The repeater's key and what a press is addressed with — this action's slot in the list. */
  id: string;
  label: string;
  disabled: boolean;
}

/**
 * What the document draws, with every branch already decided.
 *
 * Named apart from the scope rather than derived from it with `Omit`: the scope carries the kit's
 * `Record<string, unknown>` index signature, and `Omit` over a type with one keeps the signature
 * and drops every named property — so the projection below would have type-checked against
 * anything.
 */
interface EmptyStateView {
  message: string;
  detail: string;
  hasDetail: boolean;
  compact: boolean;
  actions: EmptyStateActionRow[];
  hasActions: boolean;
}

/** The scope `empty-state.json` reads. Every field is a value; the document asks no question. */
interface EmptyStateScope extends Record<string, unknown>, EmptyStateView {
  runAction: (id: string) => void;
}

/** A standing empty state: the node a caller interpolates, and the way to change what it says. */
export interface EmptyStateSurface {
  /** The element the document lives in — handed to a lit template as a child value. */
  readonly host: HTMLElement;
  /** Bring the standing surface up to date. An assignment; the mount is never rebuilt. */
  update: (spec: EmptyStateSpec) => void;
  /** Take the document down and give the host back empty. Idempotent. */
  dispose: () => void;
}

/**
 * Mount an empty state into a host of the surface's own.
 *
 * @param {EmptyStateSpec} spec What the region says to begin with.
 * @returns {EmptyStateSurface}
 */
export function createEmptyStateSurface(spec: EmptyStateSpec): EmptyStateSurface {
  const host = document.createElement("div");
  /* `display: contents` for the reason `surfaces/ai-credentials-form.ts` gives: the callers lay
     their bodies out themselves — a Navigator body is a scroll column, a canvas stage is a block —
     and a wrapper box would become the child in the document root's place and take the centring
     below it with it. */
  host.style.display = "contents";

  /** The handlers, held apart from the scope so `runAction` never has to be reassigned. */
  let handlers: (() => void)[] = [];
  const scope = reactive<EmptyStateScope>({
    ...project(spec),
    runAction: (id: string) => {
      handlers[Number(id)]?.();
    },
  }) as EmptyStateScope;
  handlers = handlersOf(spec);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  void mountSurface("empty-state", scope, host).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
      host.replaceChildren();
    },
    host,
    update(next) {
      handlers = handlersOf(next);
      Object.assign(scope, project(next));
    },
  };
}

/** The spec as the document reads it: every branch already decided, nothing left to derive. */
function project(spec: EmptyStateSpec): EmptyStateView {
  const actions = spec.actions ?? [];
  return {
    actions: actions.map((action, index) => ({
      disabled: Boolean(action.disabled),
      id: String(index),
      label: action.label,
    })),
    compact: Boolean(spec.compact),
    detail: spec.detail ?? "",
    hasActions: actions.length > 0,
    /* The detail is drawn when there IS one, which the empty string is not: a caller that passes
       `detail: ""` means "no second sentence", and a `<p>` with nothing in it is a gap the reader
       has to account for. */
    hasDetail: (spec.detail ?? "") !== "",
    message: spec.message,
  };
}

/** The actions' handlers, positionally — the document addresses a press by its row's index. */
function handlersOf(spec: EmptyStateSpec): (() => void)[] {
  return (spec.actions ?? []).map((action) => action.run);
}

/** One standing surface per lit host. */
const _surfaces = new WeakMap<HTMLElement, EmptyStateSurface>();

/**
 * The empty state for a lit render root, as a node that root's template interpolates.
 *
 * `litRender(hasContent ? content : emptyState(host, spec), host)` — the surface is mounted the
 * first time the region is empty and ASSIGNED every time after, so flipping between a panel's own
 * markup and its empty state neither rebuilds the document nor leaves it behind.
 *
 * @param {HTMLElement} owner The lit host the region renders into.
 * @param {EmptyStateSpec} spec What this region says right now.
 * @returns {HTMLElement} The node to hand lit.
 */
export function emptyState(owner: HTMLElement, spec: EmptyStateSpec): HTMLElement {
  const standing = _surfaces.get(owner);
  if (standing) {
    standing.update(spec);
    return standing.host;
  }
  const surface = createEmptyStateSurface(spec);
  _surfaces.set(owner, surface);
  return surface.host;
}
