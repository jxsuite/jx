/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * Repeater rows on the editing canvas (studio.md §4.5). Runs inside the canvas iframe.
 *
 * A repeater (`$prototype: "Array"`) draws every item through its template, so one document node
 * has one element PER ROW. Everything that finds an element by document path (selection, the
 * patcher, the caret, a drop) takes the first match, so exactly one row of each repeater is
 * addressable: its nodes carry `data-jx-path`. Every other row is an **echo row**, whose nodes
 * carry the same path as `data-jx-echo-path` and whose root is closed to the caret. Which row a
 * node was drawn in is `data-jx-row`, a coordinate of its own and never part of the path.
 *
 * **Nested repeaters.** A node inside two repeaters has two row coordinates, and it is addressable
 * only when BOTH name their repeater's active row. An inner repeater's active row is one number for
 * the repeater, shared by every outer row that draws it, because its document path is the same in
 * each. An outer row whose inner list is shorter than that number has no such row, so the choice is
 * clamped per drawn list: the last row it has. Pressing in an echo row makes every repeater around
 * the pressed node active at the pressed coordinates, in one step.
 *
 * One pass, {@link syncRows}, decides every stamp from the rows that are in the DOM, so a render, a
 * patch, a promotion and a list that redrew itself all reach the same picture the same way.
 *
 * **A stamp says where a node IS, not where it was drawn.** The runtime names a node by the render
 * path its list or its `$switch` was created with, and neither learns of anything that happens
 * afterwards: a keyed row reused at another index, a structural patch that shifted the paths above
 * it. A node either of them draws later is therefore stamped with a row or a path that has since
 * moved. The pass reads each node's place from the stamped element it stands in, which the patcher
 * and the list keep right, and a node created outside a draw asks for the pass to run.
 *
 * The template row and the row cap are marked on the row's own element, from the nodes the list
 * reports, so the marks go where the rows go.
 *
 * @docs studio/design/repeaters
 */

import {
  ECHO_PATH_ATTR,
  ROW_ATTR,
  STAMPED_SELECTOR,
  enclosingRepeaterPaths,
  jxInstanceSelector,
  pageDocPath,
  parseJxPath,
  rowsOf,
  serializeJxPath,
  stampedPathOf,
  stripRowIndices,
  withRowIndices,
} from "./path-mapping";
import { isJsonObject, isNumber } from "@jxsuite/schema/guards";
import { SAMPLE_ROW_KEY } from "../utils/edit-display";
import { rectOf } from "../utils/geometry";
import { DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT } from "./iframe-protocol";
import type { SerializableRect } from "./iframe-protocol";
import type { PathMapCtx } from "./path-mapping";
import type { JxPath } from "../state";
import type { JxRenderOptions, JxScope } from "@jxsuite/runtime/types";
import type { JsonValue } from "@jxsuite/schema/types";

/**
 * The attribute on the one row a repeater with no items is drawn with: its template, resolved
 * against a sample item. The edit stylesheet marks it "No items: showing the template".
 */
export const TEMPLATE_ROW_ATTR = "data-jx-template-row";

/**
 * The attribute on the last row drawn of a list the row cap cut short. Its value is what the edit
 * stylesheet says there: how many rows are drawn, of how many items.
 */
export const ROWS_MORE_ATTR = "data-jx-rows-more";

/**
 * What an echo row's element held as `contenteditable` before the row was closed, so making the row
 * active puts it back: the empty string for no attribute at all.
 */
const ECHO_CLOSED_ATTR = "data-jx-echo-closed";

/** The row state of one frame: what the host chose, and what the live render drew. */
export interface RowView {
  /** Each repeater's active row, by its serialized document path. Absent means the first. */
  active: Map<string, number>;
  /** At most this many rows of a repeater are drawn. */
  limit: number;
  /** A sample item per repeater, by serialized document path, for a list with nothing to draw. */
  samples: Readonly<Record<string, JsonValue>>;
  /** Whether rows are closed, capped and sampled: false for a render nobody edits (Preview). */
  editing: boolean;
  /** The scope the runtime rendered each stamped element with: a row's own inside a repeater. */
  scopes: WeakMap<HTMLElement, JxScope>;
  /**
   * How many draws (a render, a subtree drawn again) are running: what they create is settled by
   * them.
   */
  drawing: number;
  /**
   * Whether a patch has changed a repeater's template since the render. The runtime's lists still
   * hold the template they were created with, so a row one of them draws from then on is stale.
   */
  templatesPatched: boolean;
  /** The row roots each list has reported, so a row it draws later is known to be new. */
  known: WeakSet<Node>;
  /** Rows a list drew from a template a patch has since changed, waiting to be drawn again. */
  stale: HTMLElement[];
  /** Ask for the stamps to be settled once what is being created now is in the DOM. */
  settleSoon?: () => void;
}

/** A fresh {@link RowView}: every repeater on its first row, the default cap, no samples. */
export function newRowView(init: Partial<Pick<RowView, "limit" | "samples" | "editing">> = {}) {
  const view: RowView = {
    active: new Map(),
    editing: init.editing ?? true,
    ...newDrawnState(),
    limit: init.limit ?? DEFAULT_ROW_LIMIT,
    samples: init.samples ?? {},
  };
  return view;
}

/** What a view holds about ONE render's drawn tree, new for each render. */
export function newDrawnState(): Pick<
  RowView,
  "scopes" | "drawing" | "templatesPatched" | "known" | "stale"
> {
  return {
    drawing: 0,
    known: new WeakSet(),
    scopes: new WeakMap(),
    stale: [],
    templatesPatched: false,
  };
}

/** A row cap as the frame applies it: a whole number of rows, at least one, or the default. */
export function normalizeRowLimit(limit: JsonValue | undefined): number {
  return isNumber(limit) && Number.isInteger(limit) && limit >= 1
    ? Math.min(limit, MAX_ROW_LIMIT)
    : DEFAULT_ROW_LIMIT;
}

/**
 * Replace a view's active rows with the host's map (`canvas.setActiveRow`), dropping anything that
 * is not a row index.
 */
export function adoptActiveRows(
  view: RowView,
  rows: Readonly<Record<string, JsonValue>> | null | undefined,
): void {
  view.active.clear();
  for (const [key, row] of Object.entries(rows ?? {})) {
    if (isNumber(row) && Number.isInteger(row) && row >= 0) {
      view.active.set(key, row);
    }
  }
}

/** The view's active rows as the plain record the host keeps. */
export function activeRowsRecord(view: RowView): Record<string, number> {
  return Object.fromEntries(view.active);
}

/**
 * The key of one DRAWN list: the repeater's document path with the rows of the repeaters around it,
 * which tells an inner list in one outer row from the same list in the next.
 */
function listKey(repeater: JxPath, outerRows: readonly number[]): string {
  return serializeJxPath(withRowIndices(repeater, outerRows));
}

/**
 * Whether the list the runtime names by the render path `path` is the page's own. Inside a layout,
 * a list of the layout's chrome is under no page path, and draws what the page will.
 */
function isPageList(path: JxPath, ctx: PathMapCtx): boolean {
  const prefix = ctx.layoutWrapped ? ctx.pageContentPrefix : null;
  return !prefix || (path.length >= prefix.length && prefix.every((seg, i) => path[i] === seg));
}

/**
 * Whether a node at `path`, drawn at `rows`, is in the active row of every repeater around it, by
 * the view's choice alone. The stamper asks this as each node is created, before the rows that
 * exist are known; {@link syncRows} then clamps a choice no drawn list can honour.
 */
export function isActiveRow(view: RowView, path: JxPath, rows: readonly number[]): boolean {
  if (rows.length === 0) {
    return true;
  }
  const repeaters = enclosingRepeaterPaths(path);
  // A path whose rows do not line up with its repeaters is no row this module understands.
  if (repeaters.length !== rows.length) {
    return true;
  }
  return repeaters.every(
    (repeater, depth) => (view.active.get(serializeJxPath(repeater)) ?? 0) === rows[depth],
  );
}

/** What {@link syncRows} reads off one stamped element. */
interface Stamped {
  el: HTMLElement;
  path: JxPath;
  rows: number[];
  repeaters: JxPath[];
}

/**
 * The steps of `path` below the element a node at it stands in: `["children", i]` for a child,
 * `["cases", key]` for a `$switch`'s live case, and for a row's root the repeater's own step and
 * its `map`.
 */
function ownSteps(path: JxPath): JxPath {
  const end = path.length;
  if (path[end - 1] === "map" && path[end - 2] !== "cases") {
    return path[end - 2] === "children" ? path.slice(-2) : path.slice(-3);
  }
  return path.slice(-2);
}

/**
 * Put `entry`'s path and rows in step with the stamped element it stands in, `above`.
 *
 * What the runtime draws after the first render is named by the path its list or its `$switch` was
 * created with. A keyed row that has moved since, or a structural patch that shifted the paths
 * above, is news to neither, so the new node says the old row or the old path. Where it stands is
 * the truth: its own steps under the element above it, in that element's rows, with its own index
 * when it is a row's root (which the list reports for itself).
 */
function settleFromAbove(entry: Stamped, above: Stamped): void {
  const { el } = entry;
  const own = ownSteps(entry.path);
  const isRowRoot = own.at(-1) === "map" && entry.path.at(-2) !== "cases";
  if (entry.path.length === above.path.length + own.length) {
    const path = [...above.path, ...own];
    if (path.some((seg, i) => seg !== entry.path[i])) {
      entry.path = path;
      const serialized = serializeJxPath(path);
      if (el.dataset.jxPath === undefined) {
        el.setAttribute(ECHO_PATH_ATTR, serialized);
      } else {
        el.dataset.jxPath = serialized;
      }
    }
  }
  const ownRow = entry.rows.at(-1);
  const rows = isRowRoot && ownRow !== undefined ? [...above.rows, ownRow] : above.rows;
  if (entry.rows.length === rows.length && rows.some((row, i) => row !== entry.rows[i])) {
    entry.rows = [...rows];
    el.setAttribute(ROW_ATTR, JSON.stringify(rows));
  }
}

/**
 * Every stamped element under `root` (and `root` itself), with its path and rows, each settled
 * against the stamped element it stands in ({@link settleFromAbove}). In document order, so an
 * element is settled before anything inside it reads it.
 */
function stampedUnder(root: HTMLElement): Stamped[] {
  const out: Stamped[] = [];
  const byEl = new Map<Element, Stamped>();
  const found = root.querySelectorAll<HTMLElement>(STAMPED_SELECTOR);
  for (const el of root.matches(STAMPED_SELECTOR) ? [root, ...found] : found) {
    // SAFETY: STAMPED_SELECTOR matched, so one of the two attributes holds the path.
    const path = parseJxPath(stampedPathOf(el) as string);
    const entry: Stamped = { el, path, repeaters: [], rows: rowsOf(el) };
    const above = el === root ? null : el.parentElement?.closest(STAMPED_SELECTOR);
    const settled = above ? byEl.get(above) : undefined;
    if (settled) {
      settleFromAbove(entry, settled);
    }
    const repeaters = enclosingRepeaterPaths(entry.path);
    entry.repeaters = repeaters.length === entry.rows.length ? repeaters : [];
    byEl.set(el, entry);
    out.push(entry);
  }
  return out;
}

/** Close an echo row's element to the caret, remembering what it held. */
function closeEcho(el: HTMLElement, isRowRoot: boolean): void {
  if (el.hasAttribute(ECHO_CLOSED_ATTR)) {
    return;
  }
  const held = el.getAttribute("contenteditable");
  /* The row's root closes the row. Below it only an element that re-opened editing does anything
     (page content slotted into a component instance, `makeStamper` in iframe-render.ts), and a
     root that is closed for its own reasons (an instance, content drawn from data) is left alone,
     so making the row active does not open it. */
  if (isRowRoot ? held === "false" : held !== "true") {
    return;
  }
  el.setAttribute(ECHO_CLOSED_ATTR, held ?? "");
  el.setAttribute("contenteditable", "false");
}

/** Undo {@link closeEcho} on an element whose row became the active one. */
function reopenEcho(el: HTMLElement): void {
  const held = el.getAttribute(ECHO_CLOSED_ATTR);
  if (held === null) {
    return;
  }
  el.removeAttribute(ECHO_CLOSED_ATTR);
  if (held === "") {
    el.removeAttribute("contenteditable");
  } else {
    el.setAttribute("contenteditable", held);
  }
}

/**
 * Carry a row's marks from the element that was its root to the one drawn in its place. The list
 * writes them when it settles and has no reason to settle again for a root that was only redrawn.
 */
export function carryRowMarks(from: HTMLElement, to: HTMLElement): void {
  for (const name of [TEMPLATE_ROW_ATTR, ROWS_MORE_ATTR]) {
    mark(to, name, from.getAttribute(name));
  }
}

/** Set or clear a marker attribute. */
function mark(el: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

/**
 * Put every stamp under `container` in step with the view: each node's path and rows say where it
 * stands, the active row of each repeater carries `data-jx-path`, and every other row carries the
 * echo attribute and is closed to the caret.
 *
 * Read from the rows that are in the DOM, so an active row no drawn list has (a list that shrank,
 * an inner list shorter than its neighbour's) is clamped to the last row that list does have, and a
 * path that has any element always has an addressable one.
 */
export function syncRows(container: HTMLElement, view: RowView): void {
  const stamped = stampedUnder(container).filter((s) => s.rows.length > 0);
  // The row indices each drawn list has.
  const present = new Map<string, Set<number>>();
  for (const { repeaters, rows } of stamped) {
    for (const [depth, repeater] of repeaters.entries()) {
      const key = listKey(repeater, rows.slice(0, depth));
      const seen = present.get(key) ?? new Set<number>();
      // SAFETY: `repeaters` is as long as `rows` here (`stampedUnder`).
      seen.add(rows[depth] as number);
      present.set(key, seen);
    }
  }
  /** The row of the list at `key` that is active: the chosen one, or the last the list has. */
  const effective = (repeater: JxPath, key: string): number => {
    const wanted = view.active.get(serializeJxPath(repeater)) ?? 0;
    const seen = present.get(key);
    if (!seen || seen.has(wanted)) {
      return wanted;
    }
    return Math.max(...seen);
  };
  for (const { el, path, repeaters, rows } of stamped) {
    const serialized = serializeJxPath(path);
    const active = repeaters.every(
      (repeater, depth) =>
        effective(repeater, listKey(repeater, rows.slice(0, depth))) === rows[depth],
    );
    const isRowRoot = repeaters.length > 0 && path.at(-1) === "map";
    if (active) {
      el.removeAttribute(ECHO_PATH_ATTR);
      mark(el, "data-jx-path", serialized);
      reopenEcho(el);
    } else {
      delete el.dataset.jxPath;
      mark(el, ECHO_PATH_ATTR, serialized);
      if (view.editing) {
        closeEcho(el, isRowRoot);
      }
    }
  }
}

/** One repeater whose active row a press changed. */
export interface RowActivation {
  /** The repeater's document path. */
  path: JxPath;
  row: number;
}

/** The nearest element at or above `start` that was drawn for a document node, in any row. */
export function nearestStampedEl(start: Element | null): HTMLElement | null {
  for (let el = start; el; el = el.parentElement) {
    if (el instanceof HTMLElement && stampedPathOf(el) !== undefined) {
      return el;
    }
  }
  return null;
}

/**
 * Make the row `target` was pressed in the active one, for every repeater around it, and answer
 * which repeaters changed; null when the press was not in an echo row.
 *
 * The promotion is a rename of the attributes on the two rows' subtrees and nothing else: no node
 * is drawn again, so the press that follows lands on the very element that was pressed.
 */
export function promoteRowAt(
  target: Element | null,
  container: HTMLElement,
  view: RowView,
): RowActivation[] | null {
  const el = nearestStampedEl(target);
  const echoed = el?.dataset.jxEchoPath;
  if (!el || echoed === undefined) {
    return null;
  }
  const rows = rowsOf(el);
  const repeaters = enclosingRepeaterPaths(parseJxPath(echoed));
  if (repeaters.length !== rows.length) {
    return null;
  }
  const changed: RowActivation[] = [];
  for (const [depth, path] of repeaters.entries()) {
    const key = serializeJxPath(path);
    // SAFETY: `repeaters` is as long as `rows`, checked above.
    const row = rows[depth] as number;
    if ((view.active.get(key) ?? 0) !== row) {
      view.active.set(key, row);
      changed.push({ path, row });
    }
  }
  syncRows(container, view);
  return changed;
}

/**
 * Every element drawn for the document node at `path`, in document order: the active row's first or
 * not, one per row that draws it. A patch to a path under a repeater iterates these.
 */
export function instancesOf(container: ParentNode, path: JxPath): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(jxInstanceSelector(serializeJxPath(path)))];
}

/** What {@link repeaterRect} measured. */
export interface RepeaterBox {
  /** How many rows of the repeater are in the DOM. */
  rows: number;
  /** Their union, or null when none of them is rendered. */
  rect: SerializableRect | null;
}

/**
 * The box of a repeater, which has no element of its own: the union of its rows' boxes, every row
 * and not only the active one. The rect is null when no row is rendered (a repeater inside a closed
 * popover, a hidden section), which `isRendered` decides.
 */
export function repeaterRect(
  container: ParentNode,
  repeater: JxPath,
  isRendered: (el: Element) => boolean,
): RepeaterBox {
  const roots = instancesOf(container, [...repeater, "map"]);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const root of roots) {
    if (!isRendered(root)) {
      continue;
    }
    const r = rectOf(root);
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.width);
    bottom = Math.max(bottom, r.y + r.height);
  }
  return {
    rect: left === Infinity ? null : { height: bottom - top, width: right - left, x: left, y: top },
    rows: roots.length,
  };
}

/**
 * Write a moved row's new index onto its subtree. A keyed list reuses a row at another index, and
 * the runtime reports the row's root alone (`onNodeMoved`); every stamped node under it was drawn
 * at the old index and says so until it is told otherwise.
 */
export function restampMovedRow(node: Node, renderPath: JxPath): void {
  if (!(node instanceof HTMLElement)) {
    return;
  }
  const { rows } = stripRowIndices(renderPath);
  const depth = rows.length - 1;
  const row = rows[depth];
  if (row === undefined) {
    return;
  }
  const found = node.querySelectorAll<HTMLElement>(`[${ROW_ATTR}]`);
  for (const el of node.hasAttribute(ROW_ATTR) ? [node, ...found] : found) {
    const coords = rowsOf(el);
    if (coords.length > depth && coords[depth] !== row) {
      coords[depth] = row;
      el.setAttribute(ROW_ATTR, JSON.stringify(coords));
    }
  }
}

/** The runtime's list-authoring hooks (embedding.md §2.4), as the editing canvas sets them. */
export type RowHooks = Pick<
  JxRenderOptions,
  "rowLimit" | "emptyRow" | "onListReconciled" | "onNodeMoved"
>;

/**
 * The hooks that make the runtime draw a repeater as the canvas shows it: capped, with one sample
 * row when it has no items, and reporting every redraw so the stamps follow.
 *
 * `changed` is called after a list drew or redrew itself. The first render calls it too, before the
 * tree is in the document; the caller decides when there is something to sync.
 */
export function rowHooks(view: RowView, ctx: PathMapCtx, changed: () => void): RowHooks {
  const hooks: RowHooks = {
    onListReconciled: (path, result) => {
      /* The marks are written on the rows the list says it has, so they are the rows' own: they
         stay with a row that moves and need no path to be found by. A layout's own list is the
         layout's, and says nothing here. */
      const page = isPageList(path, ctx);
      const last = result.count > result.rendered ? result.nodes.length - 1 : -1;
      for (const [index, node] of result.nodes.entries()) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (page) {
          mark(node, TEMPLATE_ROW_ATTR, result.empty ? "" : null);
          mark(
            node,
            ROWS_MORE_ATTR,
            index === last ? `${result.rendered} of ${result.count} rows` : null,
          );
        }
        if (!view.known.has(node)) {
          view.known.add(node);
          /* Drawn by the list on its own, from the template it was created with, which a patch
             has changed since: `redrawStaleRows` (iframe-patch.ts) draws it again. */
          if (page && view.templatesPatched && view.drawing === 0) {
            view.stale.push(node);
          }
        }
      }
      changed();
    },
    onNodeMoved: (node, path) => {
      restampMovedRow(node, path);
    },
  };
  if (!view.editing) {
    return hooks;
  }
  hooks.rowLimit = view.limit;
  hooks.emptyRow = (_arrayDef, path) => {
    if (!isPageList(path, ctx)) {
      // A layout's own list draws what the page will: nothing.
      return;
    }
    const { path: repeater } = stripRowIndices(pageDocPath(path, ctx));
    /* No sample is no item: every binding that reads one throws, is survived, and draws
       nothing, so a chip shows its name and an attribute stays off. An empty object would read
       as `undefined` instead, and the template row would spell that word wherever it has text. */
    const sample = view.samples[serializeJxPath(repeater)] ?? null;
    if (!isJsonObject(sample)) {
      return sample;
    }
    /* Marked, so an attribute that reads the row can tell this made-up item from a real one and
       stay off (`templateRowAttribute` in utils/edit-display.ts). Not enumerable: nothing that
       walks the item sees a field the list never declared. */
    return Object.defineProperty({ ...sample }, SAMPLE_ROW_KEY, { value: true });
  };
  return hooks;
}

/** Whether a caret can stand in `node`'s own content: nothing around it is closed to the caret. */
function takesCaret(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest("[contenteditable]")?.getAttribute("contenteditable") !== "false";
}

/**
 * The caret position nearest `wall` on the side the selection comes from: the end of the last text
 * before it, or the start of the first text after it, that a caret can stand in. A chip counts as
 * text, and the position is beside it in its block. Null when `stop` (the selection's anchor) is
 * reached first: there is nothing between the anchor and the wall to select.
 */
function caretBeside(
  wall: HTMLElement,
  before: boolean,
  container: HTMLElement,
  stop: Node,
): { node: Node; offset: number } | null {
  // Every node, and the loop below reads only text and chips: a comment (a list's anchor) is neither.
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_ALL);
  walker.currentNode = wall;
  if (!before) {
    // Past everything the wall holds: its next sibling, or an ancestor's.
    while (!walker.nextSibling()) {
      if (!walker.parentNode()) {
        return null;
      }
    }
  }
  for (
    let node: Node | null = before ? walker.previousNode() : walker.currentNode;
    node;
    node = before ? walker.previousNode() : walker.nextNode()
  ) {
    if (node === stop && node instanceof Text) {
      // The anchor's own text is the nearest: the selection ends at its edge.
      return { node, offset: before ? node.length : 0 };
    }
    if (node instanceof Text && node.length > 0 && takesCaret(node)) {
      return { node, offset: before ? node.length : 0 };
    }
    const parent = node.parentNode;
    if (
      node instanceof HTMLElement &&
      node.dataset.jxTag !== undefined &&
      parent &&
      takesCaret(parent)
    ) {
      const index = [...parent.childNodes].indexOf(node);
      return { node: parent, offset: before ? index + 1 : index };
    }
    if (node === stop) {
      return null;
    }
  }
  return null;
}

/** Every root of an echo row under `container`, in document order. */
function echoRowRoots(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[${ECHO_PATH_ATTR}$='"map"]'][${ROW_ATTR}]`)];
}

/**
 * Keep a selection that began in an addressable block out of the echo rows: its focus is moved back
 * to the edge of the first echo row between the two ends. Answers whether it moved.
 *
 * An echo row is closed to the caret, but a drag or a Shift press still extends a selection into
 * one. Its focus is then in no block the document addresses: the session ended, the click that
 * closed the drag selected whatever element held both ends (the repeater's whole parent), and
 * Delete removed that. Every row is the same template, so the text of the next row is not more text
 * to select: the selection ends where the row does.
 */
export function keepSelectionOutOfEchoRows(sel: Selection, container: HTMLElement): boolean {
  const { anchorNode, focusNode } = sel;
  if (!anchorNode || !focusNode || sel.isCollapsed) {
    return false;
  }
  const elementOf = (node: Node): Element | null =>
    node instanceof Element ? node : node.parentElement;
  const from = nearestStampedEl(elementOf(anchorNode));
  const to = nearestStampedEl(elementOf(focusNode));
  if (from?.dataset.jxPath === undefined || to?.dataset.jxEchoPath === undefined) {
    return false;
  }
  /* Where each node starts, against where the anchor does. An echo row never holds the anchor,
     which is addressable, so "starts after" is "comes after". */
  const fromAnchor = container.ownerDocument.createRange();
  fromAnchor.setStart(anchorNode, 0);
  fromAnchor.collapse(true);
  const forward = fromAnchor.comparePoint(focusNode, 0) > 0;
  const roots = echoRowRoots(container);
  // The echo row nearest the anchor on the focus's side: the selection stops at its near edge.
  const wall = forward
    ? roots.find((root) => fromAnchor.comparePoint(root, 0) > 0)
    : roots.findLast((root) => fromAnchor.comparePoint(root, 0) < 0);
  if (!wall) {
    return false;
  }
  /* Where a caret can stand, so the block the selection now ends in is the block being edited: an
     end between two elements names no block, and the session would end there. With nothing to
     select between the anchor and the wall, the selection collapses where it began. */
  const edge = caretBeside(wall, forward, container, anchorNode) ?? {
    node: anchorNode,
    offset: sel.anchorOffset,
  };
  sel.setBaseAndExtent(anchorNode, sel.anchorOffset, edge.node, edge.offset);
  return true;
}
