/// <reference lib="dom" />
/**
 * ⑪ · Logic — the Bottom dock tab, as a mounted document.
 *
 * This is the adapter. `panels/formula-workspace.ts` is the flow — it reads which of the two
 * surfaces is open, resolves the expression at that document position, keeps the chip selection,
 * evaluates the live preview and turns every edit into a transaction — and this is the surface it
 * draws into. Nothing here reads a document, unrolls a tree or evaluates anything.
 *
 * **Three islands, all through `onNodeCreated`** (specs/studio-ui-guidelines.md §9.4).
 * `[part="code-host"]` receives Monaco, `[part="editor-host"]` receives the expression editor —
 * still a lit surface of its own, and another conversion's to move — and one `[part="tree-host"]`
 * per data-rail entry receives the value tree, which is a mounted document of its own. Each is
 * announced as it is CREATED, one reconcile step before it is in the page, so connectedness is
 * deliberately not consulted: "is it connected" answers no for exactly the node that needs
 * filling.
 *
 * **A host is held, never re-found.** A keyed `$map` keeps a rail entry's node across an update, so
 * a tree host whose entry moved under it would still be showing the previous one's value; the flow
 * repaints the hosts it holds after every projection rather than querying the tab for them.
 *
 * **The mount does not clear its host, and that is the difference between this seam and the
 * Inspector's.** The Bottom dock renders its tabs with lit, and the Logic record draws `nothing` —
 * so what the document is appended into still holds lit's own comment markers, and taking them away
 * would break the dock's next paint. The runtime appends rather than replacing, so leaving them
 * alone costs nothing; {@link LogicWorkspaceSurface.connected} is how the flow finds out that a
 * repaint for another tab has swept the document away.
 *
 * @docs studio/logic/formula-workspace
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import logicWorkspaceDoc from "./logic-workspace.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("logic-workspace", logicWorkspaceDoc as unknown as JxDocument);

/** One chip of the pipeline, as the document draws it. */
export interface LogicChipView {
  /** The joined node path: the repeater's key, the chip's `data-path`, and what a click reports. */
  key: string;
  /** The operand's label or the operator's spelling — the chip's text and its own tooltip. */
  label: string;
  /** The live value at this node. Empty draws nothing. */
  badge: string;
  /** Whether the preview has a value here at all: `""` is a legitimate one. */
  hasBadge: boolean;
}

/** One entry of the data rail: a name in the canvas's scope, and what kind of value it holds. */
export interface LogicScopeEntryView {
  /** The entry name — the repeater's key, and the identity its tree host is announced with. */
  key: string;
  name: string;
  /** `object`, `array (3)`, `string` — whatever `panels/data-explorer.ts` calls it. */
  type: string;
}

/** Everything the Logic tab shows, already decided. */
export interface LogicWorkspaceView {
  /** `empty` (nothing open in the tab) or `ready`. */
  state: string;
  /** What the tab is for, said when nothing is open in it (§11.1). */
  emptyMessage: string;
  /** Which body the ready state draws: `formula`, `code`, or `missing`. */
  surface: string;
  /** `fx` or `ƒ` — which of the two things is open, before you read its name. */
  glyph: string;
  name: string;
  /** `state expression`, `event handler` — the kind, beside the name. */
  kind: string;
  /** The title's tooltip: the document position, which the name alone does not give. */
  titleHint: string;
  /** The formula surface offers the catalog; the code surface has Monaco's own completions. */
  hasCatalog: boolean;
  /** The `missing` surface's sentence: a target the document no longer holds an expression at. */
  missingMessage: string;
  chips: LogicChipView[];
  /** `root`, or the one-line summary of the chip-selected sub-node. */
  selectedSummary: string;
  hasScope: boolean;
  scopeEmptyMessage: string;
  scopeEntries: LogicScopeEntryView[];
  /** `value`, `error` or `pending` — which of the three answers the result line is giving. */
  resultTone: string;
  resultText: string;
  /** `(mutates target)`. Empty draws nothing. */
  resultNote: string;
  hasResultNote: boolean;
}

/** What the tab may ask the flow to do. */
export interface LogicWorkspaceActions {
  /** A chip was pressed; the key is the one the projection gave it. */
  selectChip: (key: string) => void;
  /** Open the formula catalog, anchored on the control that asked. */
  browseCatalog: (anchor: HTMLElement) => void;
  /** Close whichever surface is open. The only thing that clears the tab's target. */
  close: () => void;
}

/** Where the flow's islands land. */
export interface LogicWorkspaceIslands {
  /** Monaco's container. */
  codeSlot: (host: HTMLElement) => void;
  /** The expression editor's container. */
  editorSlot: (host: HTMLElement) => void;
  /** One rail entry's value tree, announced with the entry name it belongs to. */
  treeSlot: (key: string, host: HTMLElement) => void;
}

interface LogicWorkspaceScope
  extends Record<string, unknown>, LogicWorkspaceView, LogicWorkspaceActions {}

export interface LogicWorkspaceSurface {
  /** Re-project. The document's bindings skip every value that did not move. */
  update: (view: LogicWorkspaceView) => void;
  /** Whether the mounted root is still where it was put. */
  connected: () => boolean;
  /** Resolves when the document has rendered, so a caller may read the DOM it drew. */
  ready: Promise<void>;
  dispose: () => void;
}

/** The tab with nothing open in it — the state it opens in, and the one Close returns it to. */
export function emptyLogicWorkspaceView(): LogicWorkspaceView {
  return {
    chips: [],
    emptyMessage: "",
    glyph: "",
    hasCatalog: false,
    hasResultNote: false,
    hasScope: false,
    kind: "",
    missingMessage: "",
    name: "",
    resultNote: "",
    resultText: "",
    resultTone: "pending",
    scopeEmptyMessage: "",
    scopeEntries: [],
    selectedSummary: "",
    state: "empty",
    surface: "formula",
    titleHint: "",
  };
}

/** Assign the projection field by field: the runtime writes only the bindings that moved. */
function project(scope: LogicWorkspaceScope, view: LogicWorkspaceView): void {
  for (const [key, value] of Object.entries(view)) {
    (scope as Record<string, unknown>)[key] = value;
  }
}

/** The `part` a node was rendered with, or "". */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/** The `key` of the `$map` item a node was rendered inside, or "". */
function itemKey(state: JxScope | undefined): string {
  const item = (state?.["$map"] as { item?: unknown } | undefined)?.item;
  const key =
    item !== null && typeof item === "object" ? (item as Record<string, unknown>).key : "";
  return typeof key === "string" ? key : "";
}

/**
 * Mount the Logic tab into `host` — the Bottom dock's body, which the dock re-paints for its other
 * tabs and which therefore keeps whatever lit left in it.
 *
 * @param {HTMLElement} host The dock body the Logic tab was painted into.
 * @param {LogicWorkspaceView} view The first projection.
 * @param {LogicWorkspaceActions} actions What a control does; read once, when the surface is
 *   mounted.
 * @param {LogicWorkspaceIslands} islands Where Monaco, the expression editor and the trees land.
 * @returns {LogicWorkspaceSurface}
 */
export function mountLogicWorkspace(
  host: HTMLElement,
  view: LogicWorkspaceView,
  actions: LogicWorkspaceActions,
  islands: LogicWorkspaceIslands,
): LogicWorkspaceSurface {
  const scope = reactive<LogicWorkspaceScope>({
    ...emptyLogicWorkspaceView(),
    ...actions,
  } as LogicWorkspaceScope) as LogicWorkspaceScope;
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("logic-workspace", scope, host, {
    onNodeCreated: (element, _path, def, state) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      const part = partOf(def);
      if (part === "code-host") {
        islands.codeSlot(element);
      } else if (part === "editor-host") {
        islands.editorSlot(element);
      } else if (part === "tree-host") {
        /* Read out of the node's own `$map` scope rather than off the element. A node is announced
           when it is BUILT, one append before its attributes are settled, so `dataset` answers ""
           for exactly the host that needs filling. */
        islands.treeSlot(itemKey(state), element);
      }
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    connected: () => {
      const root = mounted?.root;
      return root instanceof HTMLElement ? root.isConnected : !disposed;
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update(next) {
      project(scope, next);
    },
  };
}
