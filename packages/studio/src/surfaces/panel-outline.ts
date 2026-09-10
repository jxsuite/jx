/// <reference lib="dom" />
/**
 * The Navigator's Outline — the open document's element tree, as a Jx document over the kit.
 *
 * This is the adapter. `panels/layers-panel.ts` keeps the Outline — which rows exist and in what
 * order, what a row is called, which of them a collapsed ancestor removes, what the window onto
 * them is, which verbs the registry places on a row, and the whole of the keyboard model — and
 * hands this module one flat projection: a word saying whether there is a tree at all, two spacer
 * heights, and one row object per line whose every field is already a string.
 *
 * **The rows are ONE vocabulary, discriminated.** A text node's line and an element's line are the
 * same `part="row"` with a different `data-kind`, so the drag island, the window arithmetic and the
 * stylesheet each address rows once rather than twice — and the projection is what decides which of
 * the two a line is, exactly as `panel-data.json`'s rows do.
 *
 * **Three things reach the host through `onNodeCreated`** (guidelines §9.4), because each is a fact
 * about a node that only exists once it has been created:
 *
 * - The tree element, which is what the virtual window is measured against and what the scroll watch
 *   binds to. Nothing about the window can be computed before it.
 * - The rename input, which has to be focused and selected the moment it appears. A document says
 *   what is drawn; where the caret goes is not a value it can hold.
 * - The drag rows, indirectly: the panel re-registers pragmatic-dnd once the mount has settled, which
 *   is why {@link OutlineSurfaceHandle.ready} is a promise rather than a boolean.
 *
 * **The container is not cleared**, which is the one line where a panel differs from a pane. A pane
 * is handed the canvas stage whole; a panel body is a node lit renders `nothing` into, and its
 * comment markers are how lit finds its own content again. So the document is APPENDED, and
 * {@link OutlineSurfaceHandle.connected} is how the panel finds out that something else has since
 * been painted over the top of it.
 *
 * @docs studio/design/layers
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import outlineDoc from "./panel-outline.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("panel-outline", outlineDoc as unknown as JxDocument);

/**
 * One verb on a row, already resolved against THAT ROW'S node.
 *
 * `PLACEMENT_MATRIX["outline/row"]` says a row action acts on the row's node rather than on the
 * selection, and the hovered row is not the selected one — so `disabled` and `tooltip` are answers
 * the panel computed under `withCommandTarget`, not questions the document could ask.
 */
export interface OutlineCommandView {
  /** The record's id: the reconcile key, and what a click runs. */
  id: string;
  /** The row this verb belongs to, because a nested `$map` cannot see the outer item. */
  row: string;
  /** The accessible name — the record's own `title`, never a surface's word for it. */
  title: string;
  /** The tooltip: the chord when it can act, the `requires` sentence when it cannot. */
  tooltip: string;
  /** The glyph by its name in the kit's manifest; empty draws the label instead. */
  icon: string;
  disabled: boolean;
  /** `"true"` for a `destructive: true` record, which is drawn in the danger colour. */
  destructive: string;
}

/**
 * One line of the Outline, as the document draws it. Every field is a value: no paths, no nodes, no
 * closures, and nothing the document has to compute.
 */
export interface OutlineRowView {
  /** `pathKey(path)` — the reconcile key, the drag key and the roving-focus key. */
  key: string;
  /** `element` or `text`: which of the two row drawings this line gets. */
  kind: string;
  /** The row's `JxPath`, verbatim as JSON — node IDENTITY, which `pathKey` is not. */
  jxPath: string;
  /** The row's own left padding at this depth, as a CSS length. */
  indent: string;
  /** `aria-level`, 1-based. */
  level: string;
  /** `aria-posinset` / `aria-setsize`: the row's place in the DOCUMENT, not in the window. */
  posInSet: string;
  setSize: string;
  selected: string;
  /** `""` on the row that carries the keyboard position, `null` on every other. */
  primary: string | null;
  /** `"true"`, `"false"`, or `null` on a row with nothing under it. */
  expanded: string | null;
  /** The single tab stop: `"0"` on one row of the window, `"-1"` on the rest. */
  tabindex: string;
  /** Which chevron to draw: `none`, `open` or `closed`. */
  chevron: string;
  /** The badge's text, and which of the six badge drawings it gets. */
  badge: string;
  badgeKind: string;
  /** The badge's tooltip, or `null` where the badge speaks for itself. */
  badgeTitle: string | null;
  label: string;
  labelItalic: string;
  /** `"true"` while this row is the one being renamed. */
  editing: string;
  /** What the rename input opens with, and what it shows when the title is empty. */
  editValue: string;
  placeholder: string;
  /** `"true"` where the row offers the grab handle. */
  draggable: string;
  /** The four `data-dnd-*` attributes the drag island reads, or `null` on a row it may not move. */
  dndRow: string | null;
  dndDepth: string | null;
  dndVoid: string | null;
  dndExpanded: string | null;
  /** `shown` gives the cluster its backing plate; `hidden` leaves it invisible and empty. */
  actions: string;
  /** Empty on every row but the selected one and the hovered one. */
  commands: OutlineCommandView[];
  /** `"true"` when there are more verbs than the row's budget, so `⋮` is drawn. */
  overflow: string;
}

/** Everything the document draws, as one value. */
export interface OutlineValues {
  /** `rows` or `empty` — whether this document has anything in it at all. */
  view: string;
  rows: OutlineRowView[];
  /** The windowed list's two spacers, as inline declarations. */
  padTop: string;
  padBottom: string;
  /** The empty state's sentence, and the label on the one action that answers it. */
  emptyMessage: string;
  emptyLabel: string;
}

/** What a control can ask the Outline to do. Every one of them is a decision the panel owns. */
export interface OutlineActions {
  /** A row was clicked, with the two accumulate modifiers and the range one. */
  activate: (key: string, ctrl: boolean, meta: boolean, shift: boolean) => void;
  /** The chevron was clicked: collapse or expand this row. */
  toggle: (key: string) => void;
  /** The pointer entered a row, and left the tree. */
  hover: (key: string) => void;
  hoverOut: () => void;
  /** One key of the ARIA tree model, against the row it was pressed on. */
  walk: (key: string, keyName: string, shift: boolean) => void;
  /** Start renaming a row — a double-click, which is the pointer's F2. */
  rename: (key: string) => void;
  /**
   * A right-click.
   *
   * Named by `$ref` in handler position, so it arrives as `(scope, event)`: `showContextMenu` takes
   * the event itself — it calls `preventDefault` and places the menu at the pointer — and the row
   * comes back off the event's own target through `outlineRowPath`, which is what that
   * `data-jx-path` is for.
   */
  contextMenu: (scope: JxScope, event: Event) => void;
  /** Run one of the row's verbs, against the row rather than against the selection. */
  runRow: (id: string, row: string, control: unknown) => void;
  /** Open the `⋮` menu under its own button. */
  overflowRow: (key: string, opener: unknown) => void;
  /** The rename input's three moments. */
  editInput: (value: string) => void;
  editCommit: () => void;
  editCancel: () => void;
  /** The one thing an empty page offers. */
  emptyAction: () => void;
  /** The tree element exists: the window is measured against it and the scroll watch binds to it. */
  treeReady: (element: HTMLElement) => void;
  /** The rename input exists, detached and empty. Where the caret goes is the host's decision. */
  editReady: (element: HTMLElement) => void;
}

export interface OutlineSurfaceHandle {
  /** Resolves once the document has rendered — the first moment its rows are in the DOM. */
  ready: Promise<void>;
  /** Whether the document this mounted is still standing in the container it was given. */
  connected: () => boolean;
  /** Bring the mounted document up to date with a whole projection. */
  update: (values: OutlineValues) => void;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope the document reads: the projection, plus everything its controls can call. */
interface OutlineScope extends Record<string, unknown>, OutlineValues, OutlineActions {}

/** Write a projection into the scope. */
function project(scope: OutlineScope, values: OutlineValues): void {
  scope.view = values.view;
  scope.rows = values.rows;
  scope.padTop = values.padTop;
  scope.padBottom = values.padBottom;
  scope.emptyMessage = values.emptyMessage;
  scope.emptyLabel = values.emptyLabel;
}

/** The `part` a node's definition carries, or "" for a text node or an unmarked element. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/**
 * Mount the Outline into `container`, which is the `.panel-content` the Navigator just painted.
 *
 * @param {HTMLElement} container - The node lit rendered this panel's (empty) body into
 * @param {OutlineValues} values - What to draw right now
 * @param {OutlineActions} actions - What each control does
 * @returns {OutlineSurfaceHandle}
 */
export function mountOutlineSurface(
  container: HTMLElement,
  values: OutlineValues,
  actions: OutlineActions,
): OutlineSurfaceHandle {
  const scope = reactive<OutlineScope>({
    activate: actions.activate,
    contextMenu: actions.contextMenu,
    editCancel: actions.editCancel,
    editCommit: actions.editCommit,
    editInput: actions.editInput,
    editReady: actions.editReady,
    emptyAction: actions.emptyAction,
    emptyLabel: "",
    emptyMessage: "",
    hover: actions.hover,
    hoverOut: actions.hoverOut,
    overflowRow: actions.overflowRow,
    padBottom: "",
    padTop: "",
    rename: actions.rename,
    rows: [],
    runRow: actions.runRow,
    toggle: actions.toggle,
    treeReady: actions.treeReady,
    view: "empty",
    walk: actions.walk,
  }) as OutlineScope;
  project(scope, values);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on an element here, so the mount is all there is to wait for: the two islands
     announce themselves through `onNodeCreated` as they are created, which is one
     `connectedCallback` EARLIER than awaiting the element would be (guidelines §1.1). */
  const ready = mountSurface("panel-outline", scope, container, {
    onNodeCreated: (element, _path, def) => {
      /* A text node carries no `part`, so narrowing and asking are the same question — asked once,
         rather than as a guard clause whose only reachable answer is the one below. */
      const part = element instanceof HTMLElement ? partOf(def) : "";
      if (part === "tree") {
        actions.treeReady(element as HTMLElement);
      } else if (part === "title-input") {
        actions.editReady(element as HTMLElement);
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
    /* While the mount is still in flight there is nothing in the container to ask about, so the
       answer is simply whether this handle is still wanted — answering no would start a second
       mount racing the first. Once mounted, the question is whether the root is still where it was
       put: a Navigator that painted another panel, or the stylebook's own catalogue, cleared this
       document out from under it. */
    connected: () =>
      !disposed && (mounted === null || (mounted.root as Node).parentNode === container),
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
