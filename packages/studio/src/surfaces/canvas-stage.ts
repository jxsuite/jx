/// <reference lib="dom" />
/**
 * The canvas's chrome, as a mounted document.
 *
 * This is the adapter. `canvas/canvas-render.ts` is the flow — which mode a pane is in, which
 * breakpoints a document declares, how wide Edit's column is, whether a comparison has a visual
 * half — and `canvas/canvas-utils.ts` is the geometry; this is the surface they draw into.
 *
 * **The mount OUTLIVES a re-render, and that is not an optimisation.** Every artboard owns a live
 * iframe holding a rendered document, so the stage's identity across a content-only repaint is the
 * difference between a repaint and a reload. The lit shell got that from position-based diffing and
 * a comment saying so; a document gets it from a keyed array, which is stronger — a breakpoint's
 * frame follows its NAME rather than its index, so adding `sm` in front of `md` no longer hands
 * `md`'s iframe to `sm`'s width. `canvas-render.ts` disposes this handle on a real mode transition,
 * which is exactly when the structure on the stage stops being the stage's.
 *
 * **A repaint lands one microtask later, and every caller must wait for it.** The runtime coalesces
 * a mapped array's re-render into one microtask on purpose (a reactive array mutated in place
 * triggers once per element it touches, and an effect run between two of those writes sees an array
 * that is half of each state). So `update()` hands back the promise that settles once the artboards
 * are in the page, and the geometry — the pan transform, the fit, the content zoom, the iframe
 * mount — runs behind it rather than on the next line.
 *
 * **Every island stays an island** (specs/studio-ui-guidelines.md §9.4). The document draws each
 * host empty and this module announces it the moment it is CREATED, one reconcile step before it is
 * in the page; Monaco, the artboard iframes, the Document Header card, the Compare bar and the
 * Project Styles bar are all attached by the modules that own them.
 *
 * @docs studio/interface/canvas
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import canvasStageDoc from "./canvas-stage.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("canvas-stage", canvasStageDoc as unknown as JxDocument);

/** One artboard, as the document reads it. Every field is already a string or a boolean. */
export interface CanvasStagePanelItem {
  /** The breakpoint's name, or "" for the single board a document with no `$media` gets. */
  key: string;
  /** What `data-media` says, or null to leave the attribute off entirely. */
  mediaAttr: string | null;
  /** The breakpoint's display name and width; only drawn when `header` is `"shown"`. */
  label: string;
  header: "hidden" | "shown";
  fullWidth: boolean;
  /** `--panel-viewport-w` / `--panel-canvas-w`, as one inline declaration list. */
  widthVars: string;
}

/** Everything the stage draws, as one value. */
export interface CanvasStageView {
  /** Which of the three frame shapes. `boards` covers Preview, the pan/zoom surface and Edit. */
  frame: "boards" | "source" | "code";
  /** The `boards` frame's outer box. Meaningless for the two Monaco frames. */
  framePart: "preview-stage" | "panzoom" | "edit-canvas";
  /** The `boards` frame's inner box: a pass-through, or Edit's column. */
  innerPart: "boards" | "edit-column";
  /** `--preview-w` or `--boards-inset`, as one inline declaration list; "" for neither. */
  frameVars: string;
  /** Whether Edit's column hugs its content — a component definition rather than a page. */
  hug: boolean;
  /** What stands over the frame, and only ever one of the three. */
  lead: "none" | "header" | "toolbar" | "chrome";
  /** Whether Edit draws the Document Header card inside its column. */
  columnHeader: "hidden" | "shown";
  /** Whether the column has its two width handles. */
  handles: "hidden" | "shown";
  panels: CanvasStagePanelItem[];
}

/** What a control asks the flow to do, and where an island is told to attach. */
export interface CanvasStageActions {
  /** The breakpoint header was clicked: make that artboard's breakpoint this pane's. */
  pickPanel: (key: string) => void;
  /**
   * A host the document drew, announced as it is BUILT — one reconcile step before it is in the
   * page, which is what lets an editor be handed a node before the frame paints.
   *
   * `detail` is the handle's side for `edit-handle` and the card's placement for `doc-header`; the
   * artboard's own three parts are not announced here at all, because a record is filled from
   * {@link CanvasStageHandle.panelNode} once the reconcile has settled.
   */
  host: (part: string, element: HTMLElement, detail: string) => void;
}

export interface CanvasStageHandle {
  /** Resolves once the first render is in the page. */
  ready: Promise<void>;
  /**
   * Draw this view. The returned promise settles once the artboards have reconciled — see the note
   * on the microtask at the top of this file.
   */
  update: (view: CanvasStageView) => Promise<void>;
  /** One artboard's node for a `panel*` part, or null when this stage never drew it. */
  panelNode: (key: string, part: string) => HTMLElement | null;
  dispose: () => void;
}

/** The scope the document reads: {@link CanvasStageView} plus the one control it draws. */
interface CanvasStageScope extends Record<string, unknown>, CanvasStageView {
  pickPanel: (key: string) => void;
}

/**
 * One STATIC attribute off a node's definition, or "".
 *
 * Static is the whole point. A node is announced as it is BUILT, one reconcile step before its
 * attributes are settled, so nothing here may read the element: `part` is what the node is,
 * `data-slot` says which of the two bound parts it is (see {@link CanvasStageView.framePart}), and
 * `data-side` / `data-placement` tell two nodes of one part apart.
 */
function attrOf(def: JxElement | string, name: string): string {
  const value = typeof def === "string" ? undefined : def.attributes?.[name];
  return typeof value === "string" ? value : "";
}

/** The `key` of the `$map` item a node was rendered inside, or "". */
function itemKey(state: JxScope | undefined): string {
  const item = (state?.["$map"] as { item?: unknown } | undefined)?.item;
  const key =
    item !== null && typeof item === "object" ? (item as Record<string, unknown>).key : "";
  return typeof key === "string" ? key : "";
}

/** The three parts an artboard is made of; everything else is a singleton host. */
const PANEL_PARTS = new Set(["panel", "panel-viewport", "panel-canvas"]);

/** Remember one of an artboard's three nodes, under the breakpoint it belongs to. */
function recordBoard(
  boards: Map<string, Map<string, HTMLElement>>,
  key: string,
  part: string,
  element: HTMLElement,
): void {
  let parts = boards.get(key);
  if (!parts) {
    parts = new Map();
    boards.set(key, parts);
  }
  parts.set(part, element);
}

/** Write a projection into the scope. */
function project(scope: CanvasStageScope, view: CanvasStageView): void {
  scope.frame = view.frame;
  scope.framePart = view.framePart;
  scope.innerPart = view.innerPart;
  scope.frameVars = view.frameVars;
  scope.hug = view.hug;
  scope.lead = view.lead;
  scope.columnHeader = view.columnHeader;
  scope.handles = view.handles;
  scope.panels = view.panels;
}

/**
 * Mount the stage into `host`, wired to `actions`.
 *
 * The host is CLEARED first: this document is the whole of what the stage shows, and
 * `canvas-render.ts` hands a stage to whichever mode owns it whole.
 *
 * @param {HTMLElement} host - The pane's stage cell
 * @param {CanvasStageView} view - What to draw right now
 * @param {CanvasStageActions} actions - What the header does, and where the islands attach
 * @returns {CanvasStageHandle}
 */
export function mountCanvasStage(
  host: HTMLElement,
  view: CanvasStageView,
  actions: CanvasStageActions,
): CanvasStageHandle {
  host.replaceChildren();
  /* Per artboard, per part. A keyed row that survives a repaint is NOT re-announced — that is what
     "the iframe survives" means — so the record a fresh render builds is filled from here rather
     than from a callback that will not fire again. */
  const boards = new Map<string, Map<string, HTMLElement>>();
  const scope = reactive<CanvasStageScope>({
    columnHeader: "hidden",
    frame: "boards",
    framePart: "panzoom",
    frameVars: "",
    handles: "hidden",
    hug: false,
    innerPart: "boards",
    lead: "none",
    panels: [],
    pickPanel: actions.pickPanel,
  }) as CanvasStageScope;
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("canvas-stage", scope, host, {
    onNodeCreated: (element, _path, def, state) => {
      const part = attrOf(def, "part");
      if (PANEL_PARTS.has(part) && element instanceof HTMLElement) {
        /* Keyed out of the node's own `$map` scope rather than off the element, for the reason
           {@link attrOf} gives: `dataset` answers "" for exactly the board that needs filling. */
        recordBoard(boards, itemKey(state), part, element);
      } else if (part && element instanceof HTMLElement) {
        const slot = attrOf(def, "data-slot");
        const named =
          slot === "frame" ? scope.framePart : slot === "inner" ? scope.innerPart : part;
        actions.host(named, element, attrOf(def, "data-side") || attrOf(def, "data-placement"));
      }
    },
  }).then((surface) => {
    if (disposed) {
      /* Cleared AGAIN, because the mount ran to completion after the teardown: `onNodeCreated`
         fires during that render, so a stage disposed inside its own await would otherwise keep
         answering `panelNode` with nodes it has just detached — records bound to DOM that is in no
         document, which is an artboard that renders nothing rather than an error. */
      surface.dispose();
      boards.clear();
      return;
    }
    mounted = surface;
  });

  return {
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
      boards.clear();
    },
    panelNode: (key, part) => boards.get(key)?.get(part) ?? null,
    ready,
    update(next) {
      /* Prune BEFORE the write, so a breakpoint the document has stopped declaring cannot hand its
         old nodes to a later render that happens to declare the name again. A row that survives
         keeps its entry, which is the whole point. */
      const live = new Set(next.panels.map((panel) => panel.key));
      for (const key of boards.keys()) {
        if (!live.has(key)) {
          // Deleting the entry the iterator is standing on is defined behaviour for a Map.
          boards.delete(key);
        }
      }
      project(scope, next);
      /* AFTER the write, so the ordering is the microtask queue's rather than a guess: the array's
         re-render was coalesced into a microtask the write above has just queued, and this
         continuation is queued behind it. Chained off `ready` so an update that lands before the
         first render still waits for that render rather than for a queue it is not in yet. */
      return ready.then(() => {});
    },
  };
}
