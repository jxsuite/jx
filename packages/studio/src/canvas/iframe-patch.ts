/// <reference lib="dom" />
/**
 * In-iframe surgical patcher — applies value-carrying forward ops to the iframe's shadow doc and
 * the live DOM, so an edit updates in place instead of re-rendering the whole document. This is the
 * cross-frame analog of `canvas-patcher.ts`: the parent classifies + records ops and posts the
 * forward (value-carrying) half; the iframe folds them into its non-reactive shadow doc and mutates
 * the DOM it owns.
 *
 * **One writer per property.** Edit and Design resolve bindings live (studio.md §4.5), so the
 * runtime's effects write to the same DOM this patcher does, and two writers to one property is a
 * race the later one wins: a text write over a bound node would be undone by the binding's next
 * run, or would stand over a value that has since changed. So the patcher writes a property
 * directly only where no binding can:
 *
 * - `textContent` is written in place only on a node whose text is LITERAL, before and after the op.
 *   A node with any bound property is re-rendered instead, through the transform the full render
 *   uses, which is also what puts a chip back when text gains or loses a `${…}`.
 * - `style` is re-emitted whole through the runtime's own `reapplyStyle`, against the scope the node
 *   was drawn with, so a bound declaration stays the runtime's binding rather than becoming a value
 *   written here.
 * - Every other key that changes rendered output re-renders the node's subtree via
 *   {@link renderSubtreeIframe}: `attributes`, `$props`, `cases`, `children`, `tagName`, a
 *   property. `insert-child` and `set-child` render the new subtree the same way.
 * - Structural relocation (`remove-child`, `move-child`) is a pure DOM move with `data-jx-path`
 *   remapping, which touches no property a binding writes.
 * - A structural op under a parent whose own text is bound is not applied at all: it throws, and the
 *   document is drawn again ({@link refuseBesideBoundText}).
 * - An event binding is stripped from an editing render, so its op changes nothing.
 *
 * **A path under a repeater names every row's instance** (studio.md §4.5). The document holds a
 * repeater's template once and the canvas draws it once per item, so an op on a `map` path is
 * applied to each element drawn for it ({@link instancesOf}), each with the scope of its own row:
 * text is written, a style re-emitted and a subtree drawn again in every row, and each row shows
 * its own item's values. A row's ROOT is drawn again like any other node and handed to the
 * runtime's list, which holds each row by its root ({@link replaceInstance}). An op that would
 * splice children by index beside a repeater or inside a template throws instead, for the reasons
 * given where each is refused.
 *
 * **A row the list draws later is drawn from the document.** The runtime's list keeps the template
 * it was created with, so once a patch has changed a template, a row a list adds on its own (the
 * list grew, an empty one filled, a keyed item was replaced) would show the template as it was.
 * Each such row is drawn again from the shadow document as soon as its list reports it
 * ({@link redrawStaleRows}).
 *
 * Any op it cannot apply throws, which the caller reports as `patchError` so the parent escalates
 * to a full render.
 */

import { reapplyStyle, replaceListRow, updateInstanceProps } from "@jxsuite/runtime";
import {
  isJsonObject,
  isMappedArray,
  isNumber,
  isRef,
  isTemplateString,
} from "@jxsuite/schema/guards";
import { getNodeAtPath } from "@jxsuite/schema/doc-ops";
import { applyDocOpToDoc } from "../tabs/doc-op-apply";
import {
  ECHO_PATH_ATTR,
  STAMPED_SELECTOR,
  parseJxPath,
  rowsOf,
  serializeJxPath,
  stampedPathOf,
} from "./path-mapping";
import { carryRowMarks, instancesOf, syncRows } from "./iframe-rows";
import { disposeSubtree, renderSubtreeIframe } from "./iframe-subtree";
import { deliveredOutsideProps } from "./iframe-inline-edit";
import { isEditableMode } from "./iframe-render";
import { isEditableBlock } from "../editor/inline-edit";
import { stampKept } from "../editor/kept-node";
import {
  BOUND_FIELD_ATTR,
  computeEmptyPlaceholderClass,
  drawsManyNodes,
  EMPTY_PLACEHOLDER_CLASSES,
} from "../utils/edit-display";
import type { IframeRenderCtx } from "./iframe-render";
import type { JxDocOp } from "../tabs/patch-ops";
import type { JxPath } from "../state";
import type { JxMutableNode } from "@jxsuite/schema/types";

/**
 * Apply a batch of forward ops. Every op is folded into the shadow doc first (so DOM reads see
 * post-mutation truth, mirroring the parent patcher reading its already-mutated reactive doc), then
 * each op patches the DOM. Throws on the first op it cannot apply surgically.
 */
export function applyIframePatch(
  shadowDoc: JxMutableNode,
  forwardOps: JxDocOp[],
  container: HTMLElement,
  ctx?: IframeRenderCtx,
  echoPaths?: JxPath[],
  redrawPaths?: JxPath[],
): void {
  /* What each `$props` op replaces, read before the fold takes it: an instance is updated in place
     from the difference (see patchProps), and the folded doc holds only the new block. */
  const propsBefore: PropsBefore = new Map();
  const redrawn = new Set((redrawPaths ?? []).map((p) => serializeJxPath(p)));
  for (const op of forwardOps) {
    /* Not for a path the sender asked to have drawn again: with no block to diff against, the op
       re-renders the instance (see applyOpToDom). */
    if (op.op === "set-key" && op.key === "$props" && !redrawn.has(serializeJxPath(op.path))) {
      const node = getNodeAtPath(shadowDoc, op.path);
      if (node) {
        propsBefore.set(op, { ...node });
      }
    }
    applyDocOpToDoc(shadowDoc, op);
    /* From here on a row a list draws by itself is drawn from a template this op has changed
       (`redrawStaleRows`). A structural op inside a template is refused below, so the path of a
       key or of a replaced child is the whole of what can change one. */
    if (ctx && (op.op === "set-key" ? op.path : opParentPath(op)).includes("map")) {
      ctx.rows.templatesPatched = true;
    }
  }
  try {
    if (!echoPaths?.length) {
      for (const op of forwardOps) {
        applyOpToDom(shadowDoc, op, container, ctx, propsBefore);
        restampKept(shadowDoc, op, container, ctx);
      }
      return;
    }
    // An ECHO: these ops describe DOM this frame already has, because its own caret produced it.
    // The shadow doc still needs them (it is the patch source of truth), but re-rendering the
    // Subtree the user is typing in would destroy the caret and the selection inside it.
    const echoed = new Set(echoPaths.map((p) => serializeJxPath(p)));
    /* The caret produced that DOM in ONE row. Every other row draws the same node and has not
       been told, so each echoed path is drawn again there, once, after the batch: an edit in a
       row is an edit to the template (studio.md §4.5). */
    const echoRows = new Map<string, JxPath>();
    for (const op of forwardOps) {
      if (op.op === "set-key" && echoed.has(serializeJxPath(op.path))) {
        // The content is already right; only the model-derived placeholder class can be stale, and
        // Reconciling a class touches neither the caret nor the text under it.
        syncEchoedPlaceholder(shadowDoc, op.path, container);
        echoRows.set(serializeJxPath(op.path), op.path);
        continue;
      }
      applyOpToDom(shadowDoc, op, container, ctx, propsBefore);
      restampKept(shadowDoc, op, container, ctx);
    }
    for (const path of echoRows.values()) {
      redrawEchoRows(shadowDoc, path, container, ctx);
    }
  } finally {
    /* Whatever was drawn was stamped by the view's choice alone; settle it against the rows that
       are now in the DOM. In a `finally` because an op that throws mid-batch has still drawn the
       ones before it, and the full render that answers it is a round trip away. */
    if (ctx) {
      syncRows(container, ctx.rows);
    }
  }
}

/** The path of the node whose `children` a structural op splices. */
function opParentPath(op: Exclude<JxDocOp, { op: "set-key" }>): JxPath {
  return op.op === "move-child" ? op.toParentPath : op.parentPath;
}

/**
 * Draw again every row a list has drawn, on its own, from a template a patch has since changed
 * (`RowView.stale`, filled by the list hook in iframe-rows.ts), and settle the stamps. Called
 * whenever a list reports a redraw; with nothing waiting it does nothing.
 *
 * The runtime's list reads its template once, when it is created, and the patcher changes the
 * shadow document and the rows that are on screen. Without this a row added after a text or a class
 * edit showed the old text and the old class beside rows that showed the new ones.
 */
export function redrawStaleRows(
  shadowDoc: JxMutableNode,
  container: HTMLElement,
  ctx: IframeRenderCtx,
): void {
  const { stale } = ctx.rows;
  if (stale.length === 0) {
    return;
  }
  for (let el = stale.shift(); el; el = stale.shift()) {
    const serialized = stampedPathOf(el);
    // A row that has gone again, or was drawn again by something else, has nothing to redraw.
    if (serialized === undefined || !container.contains(el)) {
      continue;
    }
    const path = parseJxPath(serialized);
    if (getNodeAtPath(shadowDoc, path)) {
      replaceInstance(shadowDoc, path, el, ctx);
    }
  }
  syncRows(container, ctx.rows);
}

/**
 * Draw the node at `path` again in every ECHO row, leaving the addressable one as the caret made
 * it. A path with one element (anything outside a repeater) has no echo row, and nothing happens.
 */
function redrawEchoRows(
  doc: JxMutableNode,
  path: JxPath,
  container: HTMLElement,
  ctx: IframeRenderCtx | undefined,
): void {
  const echoes = instancesOf(container, path).filter((el) => el.hasAttribute(ECHO_PATH_ATTR));
  if (echoes.length === 0 || !ctx) {
    return;
  }
  for (const el of echoes) {
    replaceInstance(doc, path, el, ctx);
  }
}

/**
 * Stamp again what the elements `op` drew or changed carry from their document nodes
 * (`editor/kept-node.ts`): a node drawn again has lost its stamp with its element, and a key set in
 * place (a style, an event handler, which changes nothing on the canvas at all) left the element
 * carrying the value from before. A commit of the block around it would have written that back. A
 * removal or a move changes no node, so there is nothing to stamp.
 */
function restampKept(
  doc: JxMutableNode,
  op: JxDocOp,
  container: HTMLElement,
  ctx: IframeRenderCtx | undefined,
): void {
  // Only where text is edited in place: a preview draws the page, and carries no stamps at all.
  if (!ctx || !isEditableMode(ctx.mode)) {
    return;
  }
  if (op.op !== "set-key" && op.op !== "insert-child" && op.op !== "set-child") {
    return;
  }
  const path = op.op === "set-key" ? op.path : [...op.parentPath, "children", op.index];
  const el = findElement(container, path);
  if (el) {
    stampKept(el, doc, isEditableBlock);
  }
}

/**
 * The node each `set-key $props` op of a batch found, by op: a copy of its own keys, so the block
 * the op replaced and everything else the node hands its instance. Read at the op's own moment,
 * because a later op of the batch may move another node onto that path.
 */
type PropsBefore = Map<JxDocOp, JxMutableNode>;

/**
 * Re-derive the empty-placeholder class of an ECHOED node without writing its content.
 *
 * An echo is the author's own typing coming back as a patch, so the DOM already holds the text —
 * but `empty-text-placeholder` was stamped when the block was empty and nothing else would ever
 * take it off, because the write that would have (patchText) is exactly what echo suppression
 * skips. The CSS asks the DOM whether the block is empty, so nothing is misdrawn in the meantime;
 * this keeps the class itself honest, so the DOM does not carry a claim the document contradicts.
 *
 * Best-effort by design: a missing element is not an error worth escalating a full render (and the
 * caret with it) over a class.
 */
function syncEchoedPlaceholder(
  doc: JxMutableNode,
  path: (string | number)[],
  container: HTMLElement,
): void {
  const el = findElement(container, path);
  if (el) {
    syncPlaceholderClass(el, getNodeAtPath(doc, path));
  }
}

/** The render context, asserted present for ops that re-render a subtree (the caller always has it). */
function requireCtx(ctx: IframeRenderCtx | undefined): IframeRenderCtx {
  if (!ctx) {
    throw new Error("iframe-patch-no-render-ctx");
  }
  return ctx;
}

function applyOpToDom(
  doc: JxMutableNode,
  op: JxDocOp,
  container: HTMLElement,
  ctx: IframeRenderCtx | undefined,
  propsBefore: PropsBefore,
): void {
  switch (op.op) {
    case "set-key": {
      if (op.key === "style") {
        patchStyle(doc, op.path, container, ctx);
        return;
      }
      /* A repeater has no element: a key of the Array node itself (its `items`, its `filter`)
         changes which rows exist, which only the runtime's own list can redraw. */
      if (isMappedArray(getNodeAtPath(doc, op.path))) {
        throw new Error("iframe-patch-repeater-node");
      }
      /* One writer per property: bound text is the runtime's to write, as chips (§4.5), which a
         text write cannot draw, and neither can it take the chips off text that stopped being
         bound. Either way the node is drawn again, as the full render would draw it. */
      if (op.key === "textContent" && isBoundNode(doc, op.path, container)) {
        replaceSubtree(doc, op.path, container, requireCtx(ctx));
        return;
      }
      if (op.key === "textContent") {
        patchText(doc, op.path, container);
        return;
      }
      // Event bindings are stripped from the design/edit render — nothing to patch.
      if (op.key.startsWith("on")) {
        return;
      }
      /* In place only for an instance drawn once: inside a repeater a prop is as a rule a
         binding on the row, and each row's instance is drawn again with its own. */
      if (
        op.key === "$props" &&
        !op.path.includes("map") &&
        patchProps(op, container, propsBefore.get(op))
      ) {
        return;
      }
      // Any other key (attributes / cases / tagName / a non-event prop), and a `$props` change the
      // Instance cannot take in place, changes rendered output: re-render the node's subtree.
      replaceSubtree(doc, op.path, container, requireCtx(ctx));
      return;
    }
    case "insert-child": {
      insertChild(doc, op.parentPath, op.index, container, requireCtx(ctx));
      return;
    }
    case "set-child": {
      replaceSubtree(doc, [...op.parentPath, "children", op.index], container, requireCtx(ctx));
      return;
    }
    case "remove-child": {
      removeChild(doc, op.parentPath, op.index, container);
      return;
    }
    case "move-child": {
      moveChild(doc, op.fromParentPath, op.fromIndex, op.toParentPath, op.toIndex, container);
      return;
    }
    default: {
      // The JxDocOp union is exhaustively handled above; this guards a future op kind.
      throw new Error(`iframe-patch-unsupported-op:${JSON.stringify(op)}`);
    }
  }
}

// ─── Structural ops needing a subtree render (Phase 3b-2) ───────────────────────

/**
 * Refuse a structural op under a parent whose own text is BOUND, so the caller draws the whole
 * document again.
 *
 * Two things about such a parent cannot be known from here. Whether its text put a node in the DOM
 * ahead of its children depends on the binding's value right now (an empty one writes none), so a
 * child's place cannot be counted. And whether the parent is drawn as text runs and chips or as a
 * closed block with its text a property depends on whether it has children at all, which this op
 * may be changing. A child spliced in by index landed one place out with nothing reported, the
 * stamped paths agreeing with the document while the order on screen did not.
 */
function refuseBesideBoundText(parentNode: JxMutableNode | undefined): void {
  const text = parentNode?.textContent;
  if (isTemplateString(text) || isRef(text)) {
    throw new Error("iframe-patch-structure-beside-bound-text");
  }
}

/**
 * Refuse a structural op whose parent holds a repeater or a computed list, or that sits inside a
 * repeater's template, so the caller draws the whole document again (studio.md §4.5).
 *
 * Beside a repeater a child's index in the document and its index in the DOM are different numbers,
 * and {@link domChildReference} counts DOM children: an insert spliced by index landed in the wrong
 * place, between two rows as likely as not, with every stamped path agreeing with the document.
 * Inside a template the splice would have to be repeated in every row, each with its own scope, and
 * a row the list draws later would not have it. The parent's `containerVerdict`
 * (`canvas-patcher.ts`) refuses both first; this is the frame's own word, because the two builds
 * can differ.
 */
function refuseBesideRepeater(parentPath: JxPath, parentNode: JxMutableNode | undefined): void {
  if (parentPath.includes("map")) {
    throw new Error("iframe-patch-structure-on-map-path");
  }
  const children = parentNode?.children;
  if (Array.isArray(children) && children.some((child) => drawsManyNodes(child))) {
    throw new Error("iframe-patch-structure-beside-repeater");
  }
}

/** Render the inserted node and splice it into the parent's DOM, shifting later siblings up. */
function insertChild(
  doc: JxMutableNode,
  parentPath: JxPath,
  index: number,
  container: HTMLElement,
  ctx: IframeRenderCtx,
): void {
  const parentEl = requireElement(container, parentPath);
  const parentNode = getNodeAtPath(doc, parentPath);
  refuseBesideBoundText(parentNode);
  refuseBesideRepeater(parentPath, parentNode);
  const newEl = renderSubtreeIframe(doc, [...parentPath, "children", index], ctx);
  // Remap existing siblings BEFORE attaching the new subtree so it isn't itself remapped.
  remapChildPaths(container, parentPath, index, 1);
  insertAt(parentEl, newEl, domChildReference(parentEl, parentNode, index));
  syncPlaceholderClass(parentEl, parentNode);
}

/**
 * Re-render the node at `docPath` and swap it into the DOM in place (disposing the old subtree), in
 * every row that draws it.
 */
function replaceSubtree(
  doc: JxMutableNode,
  docPath: JxPath,
  container: HTMLElement,
  ctx: IframeRenderCtx,
): void {
  requireElement(container, docPath);
  for (const el of instancesOf(container, docPath)) {
    replaceInstance(doc, docPath, el, ctx);
  }
}

/**
 * Draw one row's instance of the node at `docPath` again, with the scope and the row it was drawn
 * with, and swap it in.
 *
 * A row's ROOT is handed to the runtime's list (`replaceListRow`). The list holds that node: it
 * moves it when the list reorders and removes it when the row goes, so a root swapped in behind its
 * back would be left standing by the list's next redraw and the old one put back, stale. Told, the
 * list keeps the row (its key, its item, its index) and holds the new node for it. The marks the
 * list wrote on the old root go to the new one. Everything below the root is the row's content and
 * is replaced directly.
 */
function replaceInstance(
  doc: JxMutableNode,
  docPath: JxPath,
  oldEl: HTMLElement,
  ctx: IframeRenderCtx,
): void {
  const scope = ctx.rows.scopes.get(oldEl);
  const newEl = renderSubtreeIframe(
    doc,
    docPath,
    ctx,
    scope ? { rows: rowsOf(oldEl), scope } : undefined,
  );
  if (
    newEl instanceof HTMLElement &&
    docPath.at(-1) === "map" &&
    oldEl.dataset.jxRow !== undefined
  ) {
    carryRowMarks(oldEl, newEl);
    ctx.rows.known.add(newEl);
    if (replaceListRow(oldEl, newEl, () => disposeSubtree(newEl))) {
      disposeSubtree(oldEl);
      return;
    }
  }
  disposeSubtree(oldEl);
  oldEl.replaceWith(newEl);
}

/**
 * Write a changed `$props` block into the live component instance, and answer whether it took it.
 *
 * An instance is a running thing: its definition's bindings read the props, so writing the ones
 * that changed redraws exactly what reads them, and its slotted children, nested instances, images
 * and embedded frames are not rebuilt (§4.1). The runtime refuses whenever that could differ from a
 * fresh render of the instance, and the caller then re-renders the subtree as it always did. So
 * does this, in the two cases only the document can see: the sender named the path to be drawn
 * again (there is no `before`), and the node hands a changed prop over by another route as well (a
 * `props.*` attribute, a same-named attribute or top-level key, a `data-jx-props` payload), which a
 * fresh instance would read and which can win over `$props` at connection.
 *
 * The new block is the op's own value and not the folded doc's, for the reason `before` is read at
 * fold time: by now a later op of the batch may have put another node at this path.
 */
function patchProps(
  op: Extract<JxDocOp, { op: "set-key" }>,
  container: HTMLElement,
  before: JxMutableNode | undefined,
): boolean {
  const el = findElement(container, op.path);
  const after = op.value;
  if (!before || !el || (after !== undefined && !isJsonObject(after))) {
    return false;
  }
  const was = before.$props ?? {};
  const now = after ?? {};
  const changed = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(
    (key) => JSON.stringify(was[key]) !== JSON.stringify(now[key]),
  );
  if (changed.some((key) => deliveredOutsideProps(before, key))) {
    return false;
  }
  return updateInstanceProps(el, before.$props, after);
}

// ─── Structural ops (no subtree render: pure DOM move + data-jx-path remap) ──────

/** Remove the element at `parentPath/children/index`, shift later siblings down, dispose its scope. */
function removeChild(
  doc: JxMutableNode,
  parentPath: JxPath,
  index: number,
  container: HTMLElement,
): void {
  refuseBesideBoundText(getNodeAtPath(doc, parentPath));
  /* The removed child is already out of the folded doc, so what is asked is whether a repeater
     REMAINS beside it; removing the repeater itself finds no element below and escalates there. */
  refuseBesideRepeater(parentPath, getNodeAtPath(doc, parentPath));
  const el = requireElement(container, [...parentPath, "children", index]);
  const parentEl = el.parentElement;
  disposeSubtree(el);
  el.remove();
  remapChildPaths(container, parentPath, index + 1, -1);
  if (parentEl) {
    syncPlaceholderClass(parentEl, getNodeAtPath(doc, parentPath));
  }
}

/**
 * Move the element from `fromParentPath/children/fromIndex` to `toParentPath/children/toIndex`.
 * Detach first, shift the from-parent's later siblings down, then re-read the to-parent's (possibly
 * shifted) path, shift its siblings up, rewrite the moved subtree's path prefix, and reinsert. The
 * shadow doc is already folded, so `toIndex` and the to-parent's children reflect post-move truth.
 */
function moveChild(
  doc: JxMutableNode,
  fromParentPath: JxPath,
  fromIndex: number,
  toParentPath: JxPath,
  toIndex: number,
  container: HTMLElement,
): void {
  refuseBesideBoundText(getNodeAtPath(doc, fromParentPath));
  refuseBesideBoundText(getNodeAtPath(doc, toParentPath));
  refuseBesideRepeater(fromParentPath, getNodeAtPath(doc, fromParentPath));
  refuseBesideRepeater(toParentPath, getNodeAtPath(doc, toParentPath));
  const fromPath = [...fromParentPath, "children", fromIndex];
  const el = requireElement(container, fromPath);
  const fromParentEl = el.parentElement;
  // Resolve the destination element before any remap renames it out from under us.
  const toParentEl = requireElement(container, toParentPath);

  el.remove();
  remapChildPaths(container, fromParentPath, fromIndex + 1, -1);
  // The detach remap may have shifted the to-parent's own path — read it fresh.
  const toPrefix = elementPath(toParentEl) ?? toParentPath;
  remapChildPaths(container, toPrefix, toIndex, 1);
  rewriteSubtreePathPrefix(el, fromPath, [...toPrefix, "children", toIndex]);

  const toParentNode = getNodeAtPath(doc, toPrefix);
  insertAt(toParentEl, el, domChildReference(toParentEl, toParentNode, toIndex));

  // Emptiness may have changed at either end (e.g. moved the last/only child out, or into an empty
  // Container) — keep both parents' placeholder classes in sync with the folded doc.
  if (fromParentEl) {
    syncPlaceholderClass(
      fromParentEl,
      getNodeAtPath(doc, elementPath(fromParentEl) ?? fromParentPath),
    );
  }
  syncPlaceholderClass(toParentEl, toParentNode);
}

/**
 * Put `el`'s empty-placeholder class back in step with its (folded) doc node — a container's after
 * a child change, a text block's after its content changed.
 */
function syncPlaceholderClass(el: Element, node: JxMutableNode | undefined): void {
  for (const cls of EMPTY_PLACEHOLDER_CLASSES) {
    el.classList.remove(cls);
  }
  const placeholder = node ? computeEmptyPlaceholderClass(node) : null;
  if (placeholder) {
    el.classList.add(placeholder);
  }
}

/** Insert `node` before `ref`, or append when `ref` is null (inserting at the end). */
function insertAt(parentEl: Element, node: Node, ref: ChildNode | null): void {
  if (ref) {
    ref.before(node);
  } else {
    parentEl.append(node);
  }
}

/**
 * The DOM node currently occupying `children[index]` of `parentEl`, or null to append. The runtime
 * renders an optional leading text node (when the parent has its own textContent) followed by one
 * node per child entry, in order — so the index is offset by that text node.
 */
function domChildReference(
  parentEl: Element,
  parentNode: JxMutableNode | undefined,
  index: number,
): ChildNode | null {
  const text = parentNode?.textContent;
  const textOffset = text != null && String(text) !== "" ? 1 : 0;
  return parentEl.childNodes[textOffset + index] ?? null;
}

/**
 * Shift the child-index segment of every stamped path under `container` that is `[...parentPath,
 * "children", i, ...]` with `i >= fromIndex`, by `delta`. Mirrors the legacy patcher's `elToPath`
 * remap, but the iframe stores paths as attributes: `data-jx-path`, and for a node in an echo row
 * `data-jx-echo-path`, which names the same document node and moves with it.
 */
function remapChildPaths(
  container: HTMLElement,
  parentPath: JxPath,
  fromIndex: number,
  delta: number,
): void {
  const depth = parentPath.length;
  for (const el of container.querySelectorAll<HTMLElement>(STAMPED_SELECTOR)) {
    const p = elementPath(el);
    if (!p || p.length < depth + 2 || p[depth] !== "children") {
      continue;
    }
    const idx = p[depth + 1];
    if (!isNumber(idx) || idx < fromIndex) {
      continue;
    }
    if (!parentPath.every((seg, i) => p[i] === seg)) {
      continue;
    }
    const np = [...p];
    np[depth + 1] = idx + delta;
    writeElementPath(el, np);
  }
}

/**
 * Rewrite the stamped path of `el` and its descendants, replacing `oldPrefix` with `newPrefix`,
 * whichever of the two attributes each carries it in.
 */
function rewriteSubtreePathPrefix(el: HTMLElement, oldPrefix: JxPath, newPrefix: JxPath): void {
  const targets: HTMLElement[] = [el, ...el.querySelectorAll<HTMLElement>(STAMPED_SELECTOR)];
  for (const t of targets) {
    const p = elementPath(t);
    if (!p || p.length < oldPrefix.length || !oldPrefix.every((seg, i) => p[i] === seg)) {
      continue;
    }
    writeElementPath(t, [...newPrefix, ...p.slice(oldPrefix.length)]);
  }
}

/** Read an element's stamped document path, or null when it is no node of the document. */
function elementPath(el: HTMLElement): JxPath | null {
  const raw = stampedPathOf(el);
  return raw === undefined ? null : parseJxPath(raw);
}

/** Write an element's document path back into the attribute it was read from. */
function writeElementPath(el: HTMLElement, path: JxPath): void {
  if (el.dataset.jxPath === undefined) {
    el.dataset.jxEchoPath = serializeJxPath(path);
  } else {
    el.dataset.jxPath = serializeJxPath(path);
  }
}

/**
 * Re-emit the node's style onto its element, and inside a repeater onto every row's, each against
 * the scope it was drawn with, so a declaration that reads the row resolves to that row's value.
 * Pass the document's merged `$media` map (the same one resolveCanvasDocument put on the render
 * doc, carried on the render ctx's built scope) through to reapplyStyle so an `@--name` block
 * resolves to its real `@media (min-width:…)` query — otherwise a surgical edit on a media-bearing
 * node would re-emit an invalid `@media name` and silently drop the responsive rule until the next
 * full render.
 */
function patchStyle(
  doc: JxMutableNode,
  path: (string | number)[],
  container: HTMLElement,
  ctx: IframeRenderCtx | undefined,
): void {
  requireElement(container, path);
  const node = getNodeAtPath(doc, path);
  /* SAFETY: buildScope writes `$media` only from the document's own `$media` map or the runtime's
   * root media map, both Record<string, string>, and the host scope may not supply the key. */
  const mediaQueries = (ctx?.defs["$media"] as Record<string, string> | undefined) ?? {};
  for (const el of instancesOf(container, path)) {
    reapplyStyle(el, node?.style, mediaQueries, ctx?.rows.scopes.get(el) ?? ctx?.defs ?? {});
  }
}

/**
 * Write a LITERAL node's text, syncing the empty-placeholder class like the full render. Never
 * reached for a bound node ({@link isBoundNode}): its text is the runtime's to write.
 */
function patchText(doc: JxMutableNode, path: (string | number)[], container: HTMLElement): void {
  requireElement(container, path);
  const node = getNodeAtPath(doc, path);
  const text = node?.textContent;
  // Every row draws this node, and literal text is the same text in each.
  for (const el of instancesOf(container, path)) {
    el.textContent = text == null ? "" : String(text);
    syncPlaceholderClass(el, node);
  }
}

/**
 * Whether the node at `path` is bound: its text is a template or a `{ "$ref" }` after this op, or
 * the element the canvas drew for it carries the bound-block mark, which is how text that WAS bound
 * until this op is known.
 */
function isBoundNode(
  doc: JxMutableNode,
  path: (string | number)[],
  container: HTMLElement,
): boolean {
  if (findElement(container, path)?.hasAttribute(BOUND_FIELD_ATTR)) {
    return true;
  }
  const text = getNodeAtPath(doc, path)?.textContent;
  return isTemplateString(text) || isRef(text);
}

/**
 * Whether a `textContent` op REPLACES the element at its path rather than writing its text: true of
 * a node that is bound before or after the op ({@link isBoundNode}), asked before the op is
 * applied. The frame must know, because an element about to be replaced cannot go on being the
 * block the caret is editing (`canvas/iframe-entry.ts`).
 */
export function textOpRedraws(op: JxDocOp, container: HTMLElement): boolean {
  if (op.op !== "set-key" || op.key !== "textContent") {
    return false;
  }
  return (
    isTemplateString(op.value) ||
    isRef(op.value) ||
    findElement(container, op.path)?.hasAttribute(BOUND_FIELD_ATTR) === true
  );
}

/** Locate the rendered element for a document path via its stamped `data-jx-path` attribute. */
function requireElement(container: HTMLElement, path: (string | number)[]): HTMLElement {
  const el = findElement(container, path);
  if (!el) {
    throw new Error(`iframe-patch-element-not-found:${serializeJxPath(path)}`);
  }
  return el;
}

/** The rendered element for a document path, or null when this render has none. */
function findElement(container: HTMLElement, path: (string | number)[]): HTMLElement | null {
  const serialized = serializeJxPath(path);
  const esc = serialized.replaceAll("\\", String.raw`\\`).replaceAll("'", String.raw`\'`);
  const el = container.querySelector(`[data-jx-path='${esc}']`);
  return el instanceof HTMLElement ? el : null;
}
