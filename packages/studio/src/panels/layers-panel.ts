/// <reference lib="dom" />
/**
 * Layers panel — the Outline: the document tree, with collapse, selection, drag-and-drop
 * reordering, and per-row actions that are RENDERINGS of the command registry.
 *
 * **One panel, two bodies, and both of them are documents now.** The tree is
 * `surfaces/panel-outline.json`; the Project Styles catalogue is
 * `surfaces/panel-stylebook-layers.json` (`panels/stylebook-layers-panel.ts`). This module renders
 * neither. It owns the record — only the record can know which body the pane is asking for — and
 * everything that is a DECISION: which rows exist and in what order, what a row is called, what the
 * window onto them is, which verbs the registry places on which row, and the whole of the keyboard
 * model. The surface reads values. The two bodies are appended into the same `.panel-content`, so
 * each mode takes the other's document down on the way in; that symmetry is the whole of the seam.
 *
 * Four things this file is deliberate about.
 *
 * **Rows are `registry.forPlacement("outline/row")`.** Every row used to carry five hand-built
 * action buttons, always visible, on every row. They collapse to the selected row plus the hovered
 * one, which is Gutenberg's rule and the one plan §3.2 ⑩ codifies: the floating bar owns
 * selection-scoped verbs, the inspector owns values. The verbs, their names, their chords and their
 * disabled reasons all come from the records in `block-action-bar.ts` — the surface renders, it
 * does not decide. A row that is neither selected nor hovered is projected with an EMPTY command
 * list, so the cluster costs nothing rather than being hidden by a rule: a `display: none` kit
 * element is still an upgraded custom element, which is the whole cost the collapse exists to
 * remove.
 *
 * **A row says something.** On a real page the tree was a wall of rows all reading "div": only
 * text-bearing nodes got a preview and containers got the tag they already wear as a coloured
 * badge. {@link outlineLabel} derives an identity instead — a title, an `$id`, a class, a landmark
 * name, the first text inside — and returns "" rather than repeat the badge.
 *
 * **It is a tree, and it is reachable.** `role="tree"` / `role="treeitem"` with a roving tabindex
 * and the arrow-key model ARIA specifies: ↑↓ walk the visible rows, → expands then descends, ←
 * collapses then ascends, Enter/F2 renames. The keys are cases in the document (`$switch` on
 * `event#/key`); what each one MEANS is {@link onOutlineKey}.
 *
 * **The rows are a MODEL, and the DOM holds a window onto it** ({@link OutlineRow}, `ui/
 * virtual-window.ts`). A 5 000-node page drew 5 000 rows on every repaint. It now draws the
 * viewport plus three rows of overscan — and because the DOM is no longer the whole list, nothing
 * may ASK the DOM what the whole list is. Every question about "which rows exist, and in what
 * order" — the shift-range, the arrow walk, Home/End, ←'s climb to the parent, the reveal that
 * follows the selection — is answered from the array {@link buildOutlineRows} produces. A
 * shift-range read off the DOM would silently select the wrong set the moment either end of it
 * scrolled out of the window: a correctness bug wearing a performance change's clothes.
 *
 * @docs studio/design/layers
 */

import { nothing } from "lit-html";
import { displayTagName, isTagExpression, tagNameCandidates } from "@jxsuite/schema/guards";
import {
  VOID_ELEMENTS,
  childIndex,
  flattenTree,
  getNodeAtPath,
  nodeLabel,
  parentElementPath,
  pathKey,
  pathsEqual,
} from "../store";
import { activeTab } from "../workspace/workspace";
import {
  isSelected as isPathSelected,
  primarySelection,
  rangeSelection,
  selectionAnchor,
  toggleSelected,
} from "../tabs/selection";
import type { JxPath } from "../state";
import type { JxMutableNode } from "@jxsuite/schema/types";
import { mutateUpdateProperty, transactDoc } from "../tabs/transact";
import { view } from "../view";
import { setActivityTab } from "../shell";
import { registerPanel } from "./panel-registry";
import { detachStylebookLayers, mountStylebookLayersPanel } from "./stylebook-layers-panel";
import { selectStylebookTag, stylebookMeta } from "./stylebook-panel";
import { isInlineElement } from "../editor/inline-edit";
import { showContextMenu } from "../editor/context-menu";
import { revealPathInCanvas } from "../canvas/popover-state";
import {
  commandTooltip,
  runCommand,
  selectionCommandRegistry,
  showCommandOverflow,
  withCommandTarget,
} from "./block-action-bar";
import {
  listWindow,
  measuredRowHeight,
  revealListRow,
  watchListWindow,
} from "../ui/virtual-window";
import { mountOutlineSurface } from "../surfaces/panel-outline";
import type { AnyCommand, CommandRegistry } from "../commands/registry";
import type { ListWindowWatch } from "../ui/virtual-window";
import type { PanelBody } from "./panel-registry";
import type {
  OutlineCommandView,
  OutlineRowView,
  OutlineSurfaceHandle,
  OutlineValues,
} from "../surfaces/panel-outline";

// ─── What a row says ─────────────────────────────────────────────────────────

/** How much of a text preview a 240px column can carry before it is just noise. */
const LABEL_MAX = 32;

/** How much of a text NODE's own content the row previews. */
const TEXT_PREVIEW_MAX = 40;

/**
 * Tags whose human name is worth more than the tag itself.
 *
 * Deliberately short. `section`, `ul` and `table` are omitted: "Section" next to a `section` badge
 * is the repetition this function exists to remove.
 */
const LANDMARK_NAMES: Readonly<Record<string, string>> = {
  article: "Article",
  aside: "Sidebar",
  dialog: "Dialog",
  figure: "Figure",
  footer: "Footer",
  form: "Form",
  header: "Header",
  main: "Main",
  nav: "Navigation",
};

/** Trim and ellipsize to {@link LABEL_MAX}. */
function truncate(text: string): string {
  const clean = text.replaceAll(/\s+/gu, " ").trim();
  return clean.length > LABEL_MAX ? `${clean.slice(0, LABEL_MAX)}…` : clean;
}

/**
 * The first text anywhere under `node`, or "".
 *
 * Bounded at three levels and short-circuited on the first hit: a container's identity is usually
 * its heading or its first line, and walking a whole subtree per row would cost the render what the
 * five-buttons-per-row build already cost it.
 */
function firstText(node: JxMutableNode, depth = 0): string {
  if (typeof node.textContent === "string" && node.textContent.trim()) {
    return node.textContent.trim();
  }
  if (depth >= 3 || !Array.isArray(node.children)) {
    return "";
  }
  for (const child of node.children) {
    if (typeof child === "string" && child.trim()) {
      return child.trim();
    }
    if (child && typeof child === "object") {
      const found = firstText(child, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return "";
}

/** The node's first class name, when it has a plain (unbound) `class` attribute. */
function firstClass(node: JxMutableNode): string {
  const value = node.attributes?.class;
  return typeof value === "string" ? (value.trim().split(/\s+/u)[0] ?? "") : "";
}

/**
 * What an Outline row says about `node`, beyond the tag its badge already shows.
 *
 * Returns "" when the node has no identity of its own — the badge is then the whole answer, which
 * is honest, and quieter than a column of "div".
 *
 * This is NOT `nodeLabel()`. `nodeLabel` answers "name this node anywhere" and prefixes the tag (`p
 * — Hello`), which is right for the canvas overlay and the status bar and wrong here, where the tag
 * is already a coloured badge two pixels to the left. Those surfaces are unchanged.
 */
export function outlineLabel(node: JxMutableNode): string {
  if (node.$title) {
    return truncate(node.$title);
  }
  // Repeaters and slots have a real name of their own; nodeLabel already composes it.
  if (node.$prototype === "Array" || node.tagName === "slot") {
    return nodeLabel(node);
  }
  if (node.$id) {
    return `#${truncate(node.$id)}`;
  }
  if (typeof node.textContent === "string" && node.textContent.trim()) {
    return truncate(node.textContent);
  }
  const cls = firstClass(node);
  if (cls) {
    return `.${truncate(cls)}`;
  }
  const landmark = LANDMARK_NAMES[displayTagName(node.tagName).toLowerCase()];
  if (landmark) {
    return landmark;
  }
  const inner = firstText(node);
  if (inner) {
    return `“${truncate(inner)}”`;
  }
  const count = Array.isArray(node.children) ? node.children.length : 0;
  return count > 0 ? `${count} item${count === 1 ? "" : "s"}` : "";
}

// ─── Row actions, from the registry ──────────────────────────────────────────

/**
 * Verbs shown inline on a row before the rest fold into `⋮`. A 240px column is the budget.
 *
 * Four is what the Outline's own verbs cost: the moves (up, down, into previous, out of parent),
 * which are the reason a document tree has rows you can grab at all. Duplicate and Delete sort
 * after them (`3_structure`, `9_danger`) and so ride in the `⋮` menu with their names and chords
 * intact — they are also on the block action bar, in the row's context menu, and on ⌘D / Delete.
 * The four moves are on none of those.
 */
export const OUTLINE_ROW_MAX_ITEMS = 4;

/**
 * The row's action cluster, as values.
 *
 * The glyph is `command.icon`, verbatim — the same one line `block-action-bar.ts`'s own `toolOf`
 * projection is, because the records carry kit names and "what glyph does this record draw" must
 * have exactly one answer. A record with no icon projects "" and the button draws its title.
 *
 * Wrapped in {@link withCommandTarget} so every record is evaluated against THIS ROW'S node rather
 * than the selection — `PLACEMENT_MATRIX["outline/row"]` says row actions act on the row's node,
 * and the hovered row is not the selected one.
 */
export function rowCommandViews(
  registry: CommandRegistry,
  path: JxPath,
  key: string,
): { commands: OutlineCommandView[]; overflow: AnyCommand[] } {
  return withCommandTarget(path, () => {
    const placed = registry.forPlacement("outline/row");
    return {
      commands: placed.slice(0, OUTLINE_ROW_MAX_ITEMS).map((command) => ({
        destructive: command.destructive === true ? "true" : "false",
        disabled: registry.disabledReason(command.id) !== undefined,
        icon: command.icon ?? "",
        id: command.id,
        row: key,
        title: command.title,
        tooltip: commandTooltip(registry, command),
      })),
      overflow: placed.slice(OUTLINE_ROW_MAX_ITEMS),
    };
  });
}

// ─── The tree, as a keyboard surface ─────────────────────────────────────────

/**
 * Pixels of indent per level, the depth past which the column stops paying, and the row's own
 * gutter.
 */
const INDENT_STEP = 16;
const INDENT_MAX_DEPTH = 6;
const INDENT_BASE = 8;

/**
 * The indent for `depth`, capped.
 *
 * Uncapped, a depth-12 row pushed 192px of empty space in front of a badge and a label inside a
 * 240px column, which is what made the panel scroll sideways instead of reading as a tree.
 */
export function indentWidth(depth: number): number {
  return Math.min(depth, INDENT_MAX_DEPTH) * INDENT_STEP;
}

/** The inverse of {@link pathKey}: numeric segments come back as numbers, as the doc stores them. */
function pathFromKey(key: string): JxPath {
  return key ? (key.split("/").map((s) => (/^\d+$/u.test(s) ? Number(s) : s)) as JxPath) : [];
}

// ─── The row model, and the window onto it ───────────────────────────────────

/**
 * One row the Outline WOULD draw, whether or not it is currently in the window.
 *
 * Built in a first pass that decides visibility (collapsed ancestors, inline elements, the content
 * root) and costs nothing but the decision; the projections are built in a second pass, for the
 * window only. Splitting the two is the whole saving — the expensive half is the kit elements a
 * row's cluster mounts, not the walk that finds it.
 */
interface OutlineRow {
  /** `pathKey(path)` — the drag-and-drop and roving-focus key, and the `$map`'s reconcile key. */
  key: string;
  path: JxPath;
  depth: number;
  /** Index of this row's parent in the model, or -1 at the top level. Feeds ← and `aria-setsize`. */
  parent: number;
  /**
   * Whether this row is a `role="treeitem"`.
   *
   * Text-node rows are drawn but are not tree items, and were never part of the keyboard walk or a
   * shift-range — so moving those questions to the model has to carry the same distinction rather
   * than quietly start selecting text nodes.
   */
  item: boolean;
  node: JxMutableNode | string | number | boolean;
  nodeType: string;
  /** 1-based position among the row's `role="treeitem"` siblings — see {@link numberOutlineSets}. */
  posInSet: number;
  /** How many `role="treeitem"` siblings the row has, itself included. */
  setSize: number;
}

/**
 * The declared height of one row — `surfaces/panel-outline.json`'s `[part="row"] { block-size }`.
 *
 * A window needs a row height BEFORE the first row exists, so this constant is what the first paint
 * windows by; {@link outlineRowHeight} measures a real row afterwards and believes the measurement.
 * The document declares the height explicitly so the two cannot drift apart in silence.
 */
export const OUTLINE_ROW_HEIGHT = 24;

/** The selector the window, the reveal and the focus move address a drawn row by. */
const ROW_SELECTOR = '[part="row"]';

/** The rows the Outline last built, in display order. */
let _outlineRows: OutlineRow[] = [];
/** The `[part="tree"]` element, kept between renders so a window can be computed for the next one. */
let _outlineList: HTMLElement | null = null;
/** The scroll watch that repaints the Outline as its scroller moves. */
let _outlineWatch: ListWindowWatch | null = null;
/** The Navigator repaint, captured per mount so the scroll watch never holds a stale one. */
let _outlineRerender: (() => void) | null = null;
/** The row under the pointer, which is the second row that carries a cluster. */
let _hoveredKey: string | null = null;
/** The row being renamed, the text typed into it so far, and whose repaint to spend on commit. */
let _editing: { key: string; text: string; rerender: () => void } | null = null;

/** The height one row actually has; the declared constant until a row has been laid out. */
function outlineRowHeight(): number {
  return measuredRowHeight(_outlineList, ROW_SELECTOR, OUTLINE_ROW_HEIGHT);
}

/** The model index of the row keyed `key`, or -1. */
function outlineIndexOfKey(key: string | undefined): number {
  return key === undefined ? -1 : _outlineRows.findIndex((row) => row.key === key);
}

/** The model index of `path`, or -1. Used by the reveal, which is given a path and not a row. */
function outlineIndexOfPath(path: JxPath | null): number {
  return path === null ? -1 : _outlineRows.findIndex((row) => pathsEqual(row.path, path));
}

/**
 * The next `role="treeitem"` row from `index`, walking by `step`; -1 at the ends.
 *
 * The step is over the MODEL, so ↓ at the bottom of the window moves to the row below the window
 * rather than stopping dead — which is what a DOM-indexed walk did the moment the tree windowed.
 */
function outlineStep(index: number, step: 1 | -1): number {
  for (let i = index + step; i >= 0 && i < _outlineRows.length; i += step) {
    if (_outlineRows[i]!.item) {
      return i;
    }
  }
  return -1;
}

/**
 * The visible rows' paths, in display order — the list a shift-range is a range OF.
 *
 * Read from the MODEL, not from the DOM. It used to walk `data-jx-path` off the rendered rows,
 * which was exact while every row was rendered and became a silent lie the moment the tree
 * windowed: `rangeSelection` degenerates to `[target]` when the anchor is absent from the list it
 * is given (`tabs/selection.ts`), so shift-clicking with a scrolled-past anchor would have selected
 * one row and said nothing. "Visible" still means what it always meant — a collapsed ancestor
 * removes its descendants from the model too — it just no longer means "painted".
 */
function visibleRowPaths(): JxPath[] {
  const paths: JxPath[] = [];
  for (const row of _outlineRows) {
    if (row.item) {
      paths.push(row.path);
    }
  }
  return paths;
}

/**
 * Scroll the model row at `index` into the window, and say whether the scroller moved.
 *
 * The repaint is the scroll watch's, not this function's — see `revealListRow`.
 */
function revealOutlineRow(index: number): boolean {
  return revealListRow(_outlineList, index, outlineRowHeight());
}

/**
 * Repaint the Outline because its window changed.
 *
 * Deferred to a microtask so a scroll that arrives while the runtime is committing cannot re-enter
 * the render that is producing the rows.
 *
 * **Never during a drag.** `panels/dnd.ts` holds the drop targets it registered on the rendered
 * rows and shifts the rows either side of the pointer by a transform; re-rendering underneath it
 * would drop both. A wheel-scroll mid-drag therefore keeps the window the drag started with, and
 * the drop's own repaint restores it. The drag marks its row with `data-dragging`, which is an
 * attribute rather than a class for the reason the document's style block gives.
 *
 * **Never for a tree that is gone.** The stylebook draws a different panel into the same dock,
 * whose scroller is the one this watch is still listening to.
 */
function outlineWindowChanged(): void {
  if (_outlineList?.isConnected !== true || _outlineList.querySelector("[data-dragging]")) {
    return;
  }
  queueMicrotask(() => _outlineRerender?.());
}

/**
 * Keep the tree watching whatever scrolls it.
 *
 * Split from {@link OutlineActions.treeReady} on purpose, and the split is the whole of why the
 * window works. `onNodeCreated` hands over the element as it is BUILT — one tick before it is in
 * the document — so `nearestScroller` walking up from it at that moment finds nothing, binds no
 * watch, and the tree silently draws all five thousand rows for the rest of the session. The
 * element is remembered there, because the next projection's `listWindow` needs it; the watch is
 * bound HERE, from the post-mount tick, where the element is connected and the scroller resolves.
 *
 * Idempotent by construction: `watchListWindow` hands back the same watch for the same element and
 * scroller, so calling it after every draw costs a comparison. The first paint of a session draws
 * every row, because nothing can be measured before them; the watch's opening measurement is what
 * asks for the second, windowed one.
 */
function watchOutlineTree(): void {
  if (!_outlineList) {
    return;
  }
  _outlineWatch = watchListWindow(_outlineWatch, _outlineList, {
    count: () => _outlineRows.length,
    onChange: outlineWindowChanged,
    rowHeight: outlineRowHeight,
  });
}

/**
 * The node an Outline row stands for, read back off the row.
 *
 * Rows carry their `JxPath` verbatim, as JSON, in `data-jx-path` — node IDENTITY in the DOM. That
 * is a different thing from the neighbouring `data-value`, which is `pathKey`'s lossy `join("/")`
 * string and is the row's `value`: the drag-and-drop key, the caret key, and the detail of every
 * event the row provokes. `["children", "0"]` and `["children", 0]` share a key and are different
 * nodes, and a segment containing a slash has no key at all.
 *
 * Everything that has to point at a node from outside the projection — the context menu, drag
 * reorder, canvas to Outline sync, a collaborator's cursor, a jump from Problems — needs the
 * unambiguous one.
 */
export function outlineRowPath(el: Element | null): JxPath | null {
  const row = el?.closest<HTMLElement>("[data-jx-path]");
  if (!row?.dataset.jxPath) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(row.dataset.jxPath);
    return Array.isArray(parsed) ? (parsed as JxPath) : null;
  } catch {
    return null;
  }
}

/** The rendered row for a model key, or null when the window does not currently hold it. */
function rowElementFor(key: string): HTMLElement | null {
  return (
    _outlineList?.querySelector<HTMLElement>(`${ROW_SELECTOR}[data-value="${CSS.escape(key)}"]`) ??
    null
  );
}

/**
 * Move the keyboard to the model row at `index`, bringing it into the window if it is outside one.
 *
 * On a microtask, because the DOCUMENT is what draws the row: the projection written on this tick
 * is a binding that runs on the next, so a query made here and now would find the row the PREVIOUS
 * projection put at that key — or, for a row the window did not hold, no row at all. A row that has
 * still not arrived is one the scroll watch has yet to draw, and stealing the keyboard later is
 * worse than not having moved it.
 */
function focusModelRow(index: number): void {
  const row = _outlineRows[index];
  if (!row) {
    return;
  }
  if (!rowElementFor(row.key)) {
    revealOutlineRow(index);
  }
  queueMicrotask(() => {
    rowElementFor(row.key)?.focus();
  });
}

/** Select the model row at `index`, so the canvas and the inspector follow the keyboard. */
function selectModelRow(index: number, gesture: { range?: boolean } = {}): void {
  const row = _outlineRows[index];
  if (row) {
    applyRowSelection(row.path, gesture);
  }
}

/**
 * Apply one row activation to the selection, honouring the two accumulate gestures (§6.5).
 *
 * - Plain: replace the selection with this path. **This is the only branch a keyboard walk or an
 *   unmodified click can reach, and it is byte-identical to what the Outline always did.**
 * - Ctrl/Cmd: toggle this path in or out, leaving the rest alone.
 * - Shift: the contiguous run of VISIBLE rows from the anchor to here.
 *
 * @param {JxPath} path
 * @param {{ additive?: boolean; range?: boolean }} gesture
 */
export function applyRowSelection(
  path: JxPath,
  gesture: { additive?: boolean; range?: boolean } = {},
): void {
  const tab = activeTab.value;
  if (!tab) {
    return;
  }
  if (gesture.range) {
    tab.session.selection = rangeSelection(
      visibleRowPaths(),
      selectionAnchor(tab.session.selection),
      path,
    );
    return;
  }
  if (gesture.additive) {
    tab.session.selection = toggleSelected(tab.session.selection, path);
    return;
  }
  tab.session.selection = [path];
}

/**
 * The reader meant that row, and `mode` says what by.
 *
 * The three modes are the ARIA tree's own — a plain move or click replaces, `Ctrl`/`Cmd` toggles,
 * `Shift` extends — and each maps onto the gesture {@link applyRowSelection} already had. What
 * `jx-tree` cannot do is RESOLVE the range: naming every row between two of them means naming rows
 * the drawn slice does not have, so the element dispatches the intent and the range is resolved
 * here against {@link visibleRowPaths}, which reads the MODEL.
 */
function selectOutlineRow(key: string, mode: string): void {
  const row = _outlineRows[outlineIndexOfKey(key)];
  if (!row) {
    return;
  }
  applyRowSelection(row.path, { additive: mode === "toggle", range: mode === "range" });
  redrawOutline();
}

/**
 * A row should be opened or closed.
 *
 * The detail says the state the row should be PUT INTO, so there is nothing left to work out about
 * which way a toggle was going. The guard is still load bearing, in BOTH directions: a leaf's
 * twisty box is drawn empty and still answers a click, and the element reads a leaf's expansion as
 * "open me" — so the dead 14px in front of a row with nothing under it is a click that must change
 * nothing at all, rather than one that quietly reaches into the collapsed set on its way past. The
 * row must also still be in the model: a key from a stale projection would go into that set with
 * nothing left to take it out again.
 */
function expandOutlineRow(key: string, expanded: boolean): void {
  const row = _outlineRows[outlineIndexOfKey(key)];
  if (!row || !isExpandable(row)) {
    return;
  }
  const collapsed = outlineCollapsed();
  if (expanded) {
    collapsed.delete(key);
  } else {
    collapsed.add(key);
  }
  redrawOutline();
}

/**
 * The caret has to reach a row the window did not draw.
 *
 * `jx-tree` walks the DRAWN rows, which is all it can see; when a pad says the model continues that
 * way it dispatches `move` and performs nothing. Each key is answered here exactly as the element
 * would have answered it over a slice that held everything — and ← is the one that could never have
 * been the element's, because the model records each row's PARENT as it builds it and a scan for
 * "the nearest row above at a shallower level" can only ever see painted rows.
 *
 * The selection comes with it, for two reasons that point the same way. In an outline "focus
 * follows selection" is what an author means by pressing Down; and `jx-tree` raises `select` beside
 * `change` on every arrow it can perform itself, so a step the window could not satisfy must not be
 * the one step that silently does not — which is also what puts the tab stop on the revealed row,
 * rather than leaving the reader FOCUSED on one row while Tab comes back to another.
 *
 * @param {string} from The row the caret is on
 * @param {string} keyName The key the element could not perform
 */
function moveOutlineCaret(from: string, keyName: string): void {
  const index = outlineIndexOfKey(from);
  let target: number;
  switch (keyName) {
    case "Home": {
      target = outlineStep(-1, 1);
      break;
    }
    case "End": {
      target = outlineStep(_outlineRows.length, -1);
      break;
    }
    case "ArrowUp": {
      target = outlineStep(index, -1);
      break;
    }
    case "ArrowLeft": {
      target = _outlineRows[index]?.parent ?? -1;
      break;
    }
    // ↓ and → both ask for the next drawn row; over the model they are the same step.
    case "ArrowDown":
    case "ArrowRight": {
      target = outlineStep(index, 1);
      break;
    }
    default: {
      return;
    }
  }
  if (!_outlineRows[target]) {
    return;
  }
  selectModelRow(target);
  focusModelRow(target);
  redrawOutline();
}

/**
 * Start inline title editing on a layer row.
 *
 * The input is a CASE of the row now, not a node this module creates and inserts: the document
 * draws it when the projection says this row is the one being renamed, and takes it away again when
 * the projection stops saying so. That is what retired the four imperative writes the predecessor
 * made into a tree it did not own — and with them the stale `display: none` a keyed re-render could
 * leave on the label of whichever node inherited the row.
 *
 * A row the window does not hold is scrolled to and left to the scroll watch, which is the same
 * "the row exists on the next pass" the reveal has always relied on. Renaming through a command
 * (⌘↵, the palette, the block bar) is the one gesture in the app where re-pressing it is obvious.
 *
 * @param {JxPath} path
 * @param {() => void} rerender
 */
export function startLayerTitleEdit(path: JxPath, rerender: () => void) {
  const tab = activeTab.value;
  if (!tab) {
    return;
  }
  const index = outlineIndexOfPath(path);
  const row = _outlineRows[index];
  /* The row's own node, not a second `getNodeAtPath` walk: the model already holds it, and reading
     it back off the model is what makes "a text line has no `$title` to write" a real branch rather
     than a defensive null check nothing can reach. */
  if (!row?.item || typeof row.node !== "object") {
    return;
  }
  _editing = { key: row.key, rerender, text: row.node.$title || "" };
  if (!rowElementFor(row.key)) {
    revealOutlineRow(index);
  }
  redrawOutline();
}

/** Whether a rename is live on `key`. */
function isEditing(key: string): boolean {
  return _editing?.key === key;
}

/** Record what the rename input holds, so a blur can commit it without reading the DOM back. */
function editInput(text: string): void {
  if (_editing) {
    _editing.text = text;
  }
}

/** Write the typed title (or clear it) and end the rename. Idempotent — a blur follows an Enter. */
function editCommit(): void {
  const session = _editing;
  const tab = activeTab.value;
  if (!session) {
    return;
  }
  _editing = null;
  const value = session.text.trim();
  if (tab) {
    transactDoc(tab, (t) =>
      mutateUpdateProperty(t, pathFromKey(session.key), "$title", value || undefined),
    );
  }
  session.rerender();
  redrawOutline();
}

/** End the rename without writing anything. */
function editCancel(): void {
  const session = _editing;
  if (!session) {
    return;
  }
  _editing = null;
  session.rerender();
  redrawOutline();
}

// ─── The rows, and the window ────────────────────────────────────────────────

/** The collapsed set, which is module state on `view` and survives every repaint. */
function outlineCollapsed(): Set<string> {
  view._layersCollapsed ||= new Set();
  return view._layersCollapsed;
}

/**
 * Pass one: the rows the Outline WOULD draw, in display order.
 *
 * Every line here is a decision about VISIBILITY — a collapsed ancestor, an inline element the
 * canvas edits as text rather than as a block, the root the content mode does not own — and no line
 * here builds a projection. That split is the whole saving: the walk is O(nodes) and costs a few
 * comparisons per node, while the half it defers mounts a kit element per verb on the rows that
 * offer them. Only the rows in the window ever pay it.
 *
 * @param {JxMutableNode} doc @param {string} mode @param {Set<string>} collapsed
 */
function buildOutlineRows(doc: JxMutableNode, mode: string, collapsed: Set<string>): OutlineRow[] {
  const rows: OutlineRow[] = [];
  /** Indices of the rows still open above the row being decided; the last of them is its parent. */
  const ancestors: number[] = [];
  // Rows arrive in pre-order, so "is any ancestor collapsed?" is a running depth comparison rather
  // Than a per-row walk back up the path. The old form did `path.slice(0, d)` + `pathKey(sub)` for
  // Every ancestor of every row — O(depth) array copies and string joins per row, on every render.
  let collapsedAtDepth: number | null = null;
  for (const { node, path, depth, nodeType } of flattenTree(doc)) {
    if (collapsedAtDepth !== null && depth > collapsedAtDepth) {
      continue;
    }
    // Back at or above the collapsed ancestor's depth: it no longer covers this row.
    collapsedAtDepth = null;
    const key = pathKey(path);
    if (collapsed.has(key)) {
      collapsedAtDepth = depth;
    }

    if (mode === "content" && path.length === 0) {
      continue;
    }

    const isText = nodeType === "text";
    if (!isText) {
      // After the text-node branch, a row's node is a JxMutableNode or it is not a row at all.
      if (typeof node !== "object" || node === null) {
        continue;
      }
      if (path.length >= 2 && nodeType === "element") {
        const parentPath = parentElementPath(path);
        const parentNode = parentPath ? getNodeAtPath(doc, parentPath) : null;
        if (parentNode && isInlineElement(node, parentNode)) {
          continue;
        }
      }
    }

    while (ancestors.length > 0 && rows[ancestors.at(-1)!]!.depth >= depth) {
      ancestors.pop();
    }
    rows.push({
      depth,
      item: !isText,
      key,
      node,
      nodeType,
      parent: ancestors.at(-1) ?? -1,
      path,
      posInSet: 0,
      setSize: 0,
    });
    ancestors.push(rows.length - 1);
  }
  return numberOutlineSets(rows);
}

/**
 * Stamp each row's position among its siblings — the two attributes a WINDOWED tree cannot omit.
 *
 * A tree that draws every row lets the assistive technology count them itself. A windowed one hands
 * it eleven rows out of five thousand, and without `aria-posinset`/`aria-setsize` it will read
 * "item 3 of 11" for a document with hundreds of sections: not a missing nicety, a false statement.
 * Only `role="treeitem"` rows are counted — a text-node row is drawn, but it is not in the set.
 */
function numberOutlineSets(rows: OutlineRow[]): OutlineRow[] {
  const totals = new Map<number, number>();
  for (const row of rows) {
    if (row.item) {
      totals.set(row.parent, (totals.get(row.parent) ?? 0) + 1);
    }
  }
  const seen = new Map<number, number>();
  for (const row of rows) {
    if (!row.item) {
      continue;
    }
    const position = (seen.get(row.parent) ?? 0) + 1;
    seen.set(row.parent, position);
    row.posInSet = position;
    row.setSize = totals.get(row.parent) ?? position;
  }
  return rows;
}

/** Whether the row has anything under it — children, a map template, or `$switch` cases. */
function isExpandable(row: OutlineRow): boolean {
  if (!row.item || typeof row.node !== "object") {
    return false;
  }
  const node = row.node as JxMutableNode;
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const hasMapChildren =
    node.children !== undefined &&
    typeof node.children === "object" &&
    (node.children as unknown as Record<string, unknown>).$prototype === "Array";
  const hasCases =
    Boolean(node.$switch) &&
    typeof node.cases === "object" &&
    node.cases !== null &&
    Object.keys(node.cases).length > 0;
  return hasChildren || hasMapChildren || hasCases || (row.nodeType === "map" && Boolean(node.map));
}

/** The badge: what it says, which of the six drawings it gets, and what it says on hover. */
function rowBadge(row: OutlineRow): {
  badge: string;
  badgeKind: string;
  badgeTitle: string | null;
} {
  const node = row.node as JxMutableNode;
  if (row.nodeType === "map") {
    return { badge: "↻", badgeKind: "map", badgeTitle: "Repeating list — one copy per item" };
  }
  if (row.nodeType === "case" || row.nodeType === "case-ref") {
    const name = String(row.path.at(-1) ?? "");
    return { badge: name, badgeKind: "case", badgeTitle: `Condition case: ${name}` };
  }
  if (node.$switch) {
    return { badge: "⇄", badgeKind: "switch", badgeTitle: "Condition" };
  }
  if (node.tagName === "slot") {
    const slotName = node.attributes?.name;
    return {
      badge: "▣",
      badgeKind: "slot",
      badgeTitle:
        typeof slotName === "string" && slotName.trim()
          ? `Slot "${slotName.trim()}"`
          : "Default slot",
    };
  }
  /* The ROW BADGE, which is the one place the tag is shown as itself rather than folded into a
     label — so it is the one that rendered `[object Object]` for a chosen tag after the other reads
     were fixed. `outlineLabel` never returns a tag (it prefers a title, an id, text, a class, a
     landmark), which is why fixing `nodeLabel` did not reach here. */
  return {
    badge: displayTagName(node.tagName) || "div",
    badgeKind: "tag",
    badgeTitle: isTagExpression(node.tagName)
      ? `Tag chosen when the element is created: ${tagNameCandidates(node.tagName).join(" or ")}`
      : null,
  };
}

/** A text node's row: drawn, and deliberately not a tree item — there is nothing to do to it. */
function textRowView(row: OutlineRow): OutlineRowView {
  const text = String(row.node);
  return {
    actions: "hidden",
    badge: "text",
    badgeKind: "text",
    badgeTitle: null,
    commands: [],
    dndDepth: null,
    dndExpanded: null,
    dndRow: null,
    dndVoid: null,
    draggable: "false",
    editValue: "",
    editing: "false",
    expanded: "",
    indent: `${indentWidth(row.depth) + INDENT_BASE}px`,
    jxPath: JSON.stringify(row.path),
    key: row.key,
    kind: "text",
    label: text.length > TEXT_PREVIEW_MAX ? `${text.slice(0, TEXT_PREVIEW_MAX)}…` : text,
    labelItalic: "false",
    level: "",
    overflow: "false",
    placeholder: "",
    posInSet: "",
    selected: "false",
    setSize: "",
  };
}

/**
 * Pass two: one row, projected.
 *
 * Called for the rows in the window and for no others, which is why it takes the document facts it
 * needs (`selection`, `mode`) as arguments instead of reading `activeTab` for each row.
 */
function outlineRowView(
  row: OutlineRow,
  doc: { selection: JxPath[]; mode: string },
  collapsed: Set<string>,
  registry: CommandRegistry,
): OutlineRowView {
  if (!row.item) {
    return textRowView(row);
  }
  const { depth, key, nodeType, path } = row;
  const node = row.node as JxMutableNode;

  const selected = isPathSelected(doc.selection, path);
  const expandable = isExpandable(row);
  // Array nodes can't accept dropped children (their content is the single map template), so they
  // Block the make-child drop instruction like void elements do.
  const isVoidEl =
    VOID_ELEMENTS.has((displayTagName(node.tagName) || "div").toLowerCase()) || nodeType === "map";
  // Array (repeater) nodes are first-class structural nodes — movable/draggable/deletable like
  // Elements. Both sit at a numeric child index; templates (path tail "map") and case nodes do
  // Not, so they stay selectable/editable but not structurally manipulable.
  const structural =
    (nodeType === "element" || nodeType === "map") && typeof childIndex(path) === "number";
  const isRoot = doc.mode === "content" ? path.length === 0 : path.length < 2;
  const grabbable = structural && !isRoot;
  const open = expandable && !collapsed.has(key);
  const editing = isEditing(key);

  /* The cluster exists for the selected row and the hovered one, and for no other. While the row is
     being renamed it exists for neither: the input owns the row's whole width, and the verbs would
     sit on top of its right edge. */
  const showActions = grabbable && !editing && (selected || key === _hoveredKey);
  const { commands, overflow } = showActions
    ? rowCommandViews(registry, path, key)
    : { commands: [], overflow: [] };

  const { badge, badgeKind, badgeTitle } = rowBadge(row);
  const { $title: _ignored, ...withoutTitle } = node;
  return {
    actions: showActions ? "shown" : "hidden",
    badge,
    badgeKind,
    badgeTitle,
    commands,
    dndDepth: structural ? String(depth) : null,
    dndExpanded: structural && open ? "" : null,
    dndRow: structural ? key : null,
    dndVoid: structural && isVoidEl ? "" : null,
    draggable: grabbable ? "true" : "false",
    editValue: editing ? (node.$title ?? "") : "",
    editing: editing ? "true" : "false",
    /* `""` is a LEAF, and it is not "no answer": it is what tells `jx-tree-item` to draw no chevron
       and write no `aria-expanded`, and what makes `ArrowRight` on a row with nothing under it do
       nothing instead of stepping onto the row below. The chevron used to be a second field saying
       the same three things. */
    expanded: expandable ? (open ? "true" : "false") : "",
    indent: `${indentWidth(depth) + INDENT_BASE}px`,
    jxPath: JSON.stringify(path),
    key,
    kind: "element",
    label: nodeType === "case-ref" ? node.$ref || "external" : outlineLabel(node),
    labelItalic: nodeType === "case-ref" ? "true" : "false",
    level: String(depth + 1),
    overflow: overflow.length > 0 ? "true" : "false",
    placeholder: outlineLabel(withoutTitle) || displayTagName(node.tagName) || "div",
    posInSet: String(row.posInSet),
    selected: selected ? "true" : "false",
    setSize: String(row.setSize),
  };
}

/**
 * The row the caret starts on, as the projection reports it.
 *
 * A SEED, not a clamp. The tab stop this replaced was decided over the WINDOW and re-decided on
 * every paint, so a wheel moved it; `jx-tree` owns the caret, holds it across every repaint that
 * does not change `current`, and clamps only the tab STOP into the drawn rows — so this module
 * keeps no caret of its own. What it owes the element is a row to start on and a row to come back
 * to when the one it was on has gone, and the primary selection is that row.
 *
 * It must NAME one, and the fallback is what guarantees it rather than tidiness: `move` reports the
 * caret's own row as `from`, and a tree nobody has touched yet — or one scrolled far enough that
 * the selected row is not drawn — would report `""` and send every ↓ off the bottom of the window
 * back to the top of the document.
 */
function outlineCaretKey(window: OutlineRow[], selection: JxPath[]): string {
  const primary = primarySelection(selection);
  const held = primary === null ? -1 : outlineIndexOfPath(primary);
  const row = _outlineRows[held];
  return row?.item === true ? row.key : (window.find((line) => line.item)?.key ?? "");
}

/**
 * What the surface should be showing right now.
 *
 * Exported because it is the half of this module that is worth testing on its own: given the open
 * document, the collapsed set and the window, it is the whole of what the Outline draws.
 *
 * @returns {OutlineValues}
 */
export function outlineValues(): OutlineValues {
  const tab = activeTab.value;
  const collapsed = outlineCollapsed();
  const registry = selectionCommandRegistry();
  const mode = tab?.doc.mode ?? "";

  _outlineRows = tab ? buildOutlineRows(tab.doc.document, mode, collapsed) : [];
  // The window is computed from the PREVIOUS render's tree element, because that is the only one
  // That exists while this projection is being built. On the first paint of a session there is none
  // And `listWindow` answers "all of them" — which is exactly what the Outline did before it
  // Windowed, and what the tree's `onNodeCreated` then measures in order to ask for a second pass.
  const range = listWindow(_outlineList, {
    count: _outlineRows.length,
    rowHeight: outlineRowHeight(),
  });
  const selection = tab?.session.selection ?? [];
  const drawn = _outlineRows.slice(range.start, range.end);
  return {
    current: outlineCaretKey(drawn, selection),
    emptyLabel: "Add an element",
    emptyMessage: "This page is empty. Everything you add to it is listed here, in order.",
    padBottom: range.padBottom,
    padTop: range.padTop,
    rows: drawn.map((row) => outlineRowView(row, { mode, selection }, collapsed, registry)),
    view: _outlineRows.length === 0 ? "empty" : "rows",
  };
}

// ─── The standing surface ────────────────────────────────────────────────────

/**
 * The surface standing in the Navigator, and the node it was mounted into.
 *
 * One slot rather than a per-host map, for the reason `panels/stylebook-layers-panel.ts` gives:
 * there is one Navigator, so a mount into a DIFFERENT node is the old one being replaced, and
 * holding both would leave the first one's effects running against a scope nobody writes any more.
 */
let standing: { host: HTMLElement; handle: OutlineSurfaceHandle } | null = null;
/** Re-register drag-and-drop once the rows the projection asked for are actually in the DOM. */
let _registerDnD: (() => void) | null = null;

/** Update the standing surface with a fresh projection. A no-op before the first mount. */
function redrawOutline(): void {
  standing?.handle.update(outlineValues());
}

/** Take down every drag registration the last pass made, then make them again. */
function reregisterDnD(): void {
  for (const fn of view.dndCleanups) {
    fn();
  }
  view.dndCleanups = [];
  _registerDnD?.();
}

/**
 * Keep the selected row on screen after a repaint.
 *
 * Two cases, where there used to be one. If the row is drawn, it scrolls itself into view. If it is
 * NOT — the canvas selected a node three thousand rows down, a jump from Problems, a collaborator's
 * edit — then the row the author is meant to see is precisely the one with no element to call
 * `scrollIntoView` on, and the reveal has to be arithmetic: scroll to where the model says the row
 * is, and let the scroll watch draw it. Silently doing nothing would be the windowing bug that
 * looks like a selection bug.
 */
function revealSelectedRow(): void {
  const drawn = _outlineList?.querySelector(`${ROW_SELECTOR}[aria-selected="true"]`);
  if (drawn) {
    drawn.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    return;
  }
  revealOutlineRow(outlineIndexOfPath(primarySelection(activeTab.value?.session.selection)));
}

/** The pointer moved onto a row: it, and the selected row, are the two that carry a cluster. */
function hoverRow(key: string): void {
  if (_hoveredKey === key) {
    return;
  }
  _hoveredKey = key;
  redrawOutline();
}

/** The pointer left the tree, so no row is under it. Also the suites' reset. */
export function clearOutlineHover(): void {
  if (_hoveredKey === null) {
    return;
  }
  _hoveredKey = null;
  redrawOutline();
}

/**
 * Draw the Outline — mounting the document the first time, updating it every time after.
 *
 * `panels/left-panel.ts` hands a panel's `afterRender` the CONTENT box itself, which is the node
 * lit renders this panel's (empty) body into and the one whose comment markers must survive. The
 * `.panel-content` lookup below is what that call used to require and is kept for a caller handing
 * the body around it; either way the document must not be appended to the wrong one of the two, or
 * the tree is drawn under whatever the Navigator paints next.
 *
 * @param {{ rerender: () => void; registerDnD: () => void }} ctx
 * @param {HTMLElement} host - The panel's content box
 */
export function mountOutlinePanel(
  ctx: { rerender: () => void; registerDnD: () => void },
  host: HTMLElement,
): void {
  const target = host.querySelector<HTMLElement>(".panel-content") ?? host;
  if (standing && (standing.host !== target || !standing.handle.connected())) {
    standing.handle.dispose();
    standing = null;
  }
  // The scroll watch outlives this call and must never repaint through a closure from an earlier
  // One — the Navigator's scheduler is the only thing that knows how to draw the Outline.
  _outlineRerender = ctx.rerender;
  _registerDnD = ctx.registerDnD;

  const values = outlineValues();
  if (standing) {
    standing.handle.update(values);
  } else {
    standing = {
      handle: mountOutlineSurface(target, values, {
        contextMenu: (_scope, event) => {
          const path = outlineRowPath(event.target as Element | null);
          if (path) {
            showContextMenu(event as MouseEvent, path, { rerender: () => _outlineRerender?.() });
            redrawOutline();
          }
        },
        editCancel,
        editCommit,
        editInput,
        editReady: (element) => {
          /* On a microtask, because `onNodeCreated` fires as the node is BUILT and one tick before
             it is in the document — which is exactly why it is the seam (guidelines §9.4): it
             hands over the element earlier than awaiting the mount would, and the host decides
             when it is worth anything. An unconnected input cannot take focus. */
          queueMicrotask(() => {
            const input = element as HTMLInputElement;
            if (input.isConnected) {
              input.focus();
              input.select?.();
            }
          });
        },
        expand: expandOutlineRow,
        emptyAction: () => {
          /* `"insert"`, not `"blocks"`. The panel was renamed in P3.1 and this call kept the old id
             for three phases, so the one action an empty page offers landed the Navigator on "No
             Navigator panel is registered as blocks". `setActivityTab` takes a `NavigatorPanelId`
             now, so this cannot recur. */
          setActivityTab("insert");
        },
        hover: hoverRow,
        hoverOut: clearOutlineHover,
        move: moveOutlineCaret,
        overflowRow: (key, opener) => {
          const path = pathFromKey(key);
          const registry = selectionCommandRegistry();
          const { overflow } = rowCommandViews(registry, path, key);
          if (opener instanceof HTMLElement && overflow.length > 0) {
            showCommandOverflow(opener, registry, overflow, path);
          }
        },
        rename: (key) => {
          /* The selection follows the rename, which is what `Enter` always did: the row being
             renamed is the row the inspector and the canvas are about. */
          const index = outlineIndexOfKey(key);
          selectModelRow(index);
          startLayerTitleEdit(pathFromKey(key), () => _outlineRerender?.());
        },
        reveal: (key) => {
          revealPathInCanvas(pathFromKey(key));
        },
        runRow: (id, key, control) => {
          if (control instanceof HTMLElement) {
            control.blur();
          }
          runCommand(selectionCommandRegistry(), id, pathFromKey(key));
          redrawOutline();
        },
        select: selectOutlineRow,
        treeReady: (element) => {
          _outlineList = element;
        },
      }),
      host: target,
    };
  }
  /* A resolved promise's `.then` is a microtask, so this is one tick after the projection either
     way — but on the FIRST pass the mount is genuinely asynchronous (the kit has to be defined
     before a document can render), and a `requestAnimationFrame` inside `registerLayersDnD` would
     otherwise find an empty container and register nothing at all. */
  void standing.handle.ready.then(() => {
    watchOutlineTree();
    reregisterDnD();
    revealSelectedRow();
  });
}

/**
 * Take the tree down.
 *
 * Called by the record when the pane starts showing Project Styles. Without it the document
 * survives its own irrelevance: both bodies are appended into the same `.panel-content`, so the one
 * nobody took down sits under the one that replaced it for the rest of the session.
 */
export function detachOutline(): void {
  standing?.handle.dispose();
  standing = null;
  _outlineList = null;
  _outlineWatch?.window.destroy();
  _outlineWatch = null;
  _hoveredKey = null;
  _editing = null;
}

/**
 * Contribute the Outline panel.
 *
 * `level: "document"` — it writes the open document's tree (reorder, rename, delete, duplicate).
 * "Outline" rather than "Layers" is §3.2 ③'s name for it; the id stays `layers` because that is
 * what `view.setActivity` and 26 screenshot steps address it by, and an id is not a label.
 */
export function registerLayersPanel(): void {
  registerPanel({
    id: "layers",
    title: "Outline",
    level: "document",
    dock: "navigator",
    icon: "stack",
    requiresDocument: "Open a page to see the elements it is built from.",
    /*
     * One panel, two bodies, and neither of them is lit's. The body is a document either way, so
     * there is nothing for lit to draw here — a document CLEARS nothing and is APPENDED, and lit's
     * own comment markers inside `.panel-content` are what it finds its (empty) content by.
     */
    render: (): PanelBody => nothing,
    /*
     * `afterRender` runs on every repaint, and both mounts are idempotent — the standing surface is
     * updated where it is still there and re-mounted only where something has taken it out. The
     * detach on each side is not symmetry for its own sake: the two documents are appended into the
     * same node, so a body nobody took down would sit under the one that replaced it.
     */
    afterRender: (ctx, host) => {
      if (ctx.deps.getCanvasMode() === "stylebook") {
        detachOutline();
        mountStylebookLayersPanel({ selectStylebookTag, stylebookMeta }, host);
        return;
      }
      detachStylebookLayers();
      mountOutlinePanel({ registerDnD: ctx.deps.registerLayersDnD, rerender: ctx.rerender }, host);
    },
  });
}
