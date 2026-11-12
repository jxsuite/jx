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
 * - `style` is re-emitted whole through the runtime's own `reapplyStyle`, with the same edit-mode
 *   transform (and the same sample row inside a repeater), so a bound declaration stays the
 *   runtime's binding rather than becoming a value written here.
 * - Every other key that changes rendered output re-renders the node's subtree via
 *   {@link renderSubtreeIframe}: `attributes`, `$props`, `cases`, `children`, `tagName`, a
 *   property. `insert-child` and `set-child` render the new subtree the same way.
 * - Structural relocation (`remove-child`, `move-child`) is a pure DOM move with `data-jx-path`
 *   remapping, which touches no property a binding writes.
 * - A structural op under a parent whose own text is bound is not applied at all: it throws, and the
 *   document is drawn again ({@link refuseBesideBoundText}).
 * - An event binding is stripped from an editing render, so its op changes nothing.
 *
 * Any op it cannot apply throws, which the caller reports as `patchError` so the parent escalates
 * to a full render.
 */

import { reapplyStyle, updateInstanceProps } from "@jxsuite/runtime";
import {
  isJsonObject,
  isNonNullObject,
  isNumber,
  isRef,
  isString,
  isTemplateString,
} from "@jxsuite/schema/guards";
import { getNodeAtPath } from "@jxsuite/schema/doc-ops";
import { applyDocOpToDoc } from "../tabs/doc-op-apply";
import { parseJxPath, serializeJxPath } from "./path-mapping";
import { disposeSubtree, renderSubtreeIframe } from "./iframe-subtree";
import { deliveredOutsideProps } from "./iframe-inline-edit";
import {
  BOUND_FIELD_ATTR,
  computeEmptyPlaceholderClass,
  editModeStyle,
  EMPTY_PLACEHOLDER_CLASSES,
  sampleRowAt,
} from "../utils/edit-display";
import type { IframeRenderCtx } from "./iframe-render";
import type { JxDocOp } from "../tabs/patch-ops";
import type { JxPath } from "../state";
import type { JxMutableNode, JxStyle } from "@jxsuite/schema/types";

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
  }
  if (!echoPaths?.length) {
    for (const op of forwardOps) {
      applyOpToDom(shadowDoc, op, container, ctx, propsBefore);
    }
    return;
  }
  // An ECHO: these ops describe DOM this frame already has, because its own caret produced it.
  // The shadow doc still needs them (it is the patch source of truth), but re-rendering the
  // Subtree the user is typing in would destroy the caret and the selection inside it.
  const echoed = new Set(echoPaths.map((p) => serializeJxPath(p)));
  for (const op of forwardOps) {
    if (op.op === "set-key" && echoed.has(serializeJxPath(op.path))) {
      // The content is already right; only the model-derived placeholder class can be stale, and
      // Reconciling a class touches neither the caret nor the text under it.
      syncEchoedPlaceholder(shadowDoc, op.path, container);
      continue;
    }
    applyOpToDom(shadowDoc, op, container, ctx, propsBefore);
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
      if (op.key === "$props" && patchProps(op, container, propsBefore.get(op))) {
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
  const newEl = renderSubtreeIframe(doc, [...parentPath, "children", index], ctx);
  // Remap existing siblings BEFORE attaching the new subtree so it isn't itself remapped.
  remapChildPaths(container, parentPath, index, 1);
  insertAt(parentEl, newEl, domChildReference(parentEl, parentNode, index));
  syncPlaceholderClass(parentEl, parentNode);
}

/** Re-render the node at `docPath` and swap it into the DOM in place (disposing the old subtree). */
function replaceSubtree(
  doc: JxMutableNode,
  docPath: JxPath,
  container: HTMLElement,
  ctx: IframeRenderCtx,
): void {
  const oldEl = requireElement(container, docPath);
  const newEl = renderSubtreeIframe(doc, docPath, ctx);
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
 * Shift the child-index segment of every `data-jx-path` under `container` whose path is
 * `[...parentPath, "children", i, ...]` with `i >= fromIndex`, by `delta`. Mirrors the legacy
 * patcher's `elToPath` remap, but the iframe stores paths as `data-jx-path` attributes.
 */
function remapChildPaths(
  container: HTMLElement,
  parentPath: JxPath,
  fromIndex: number,
  delta: number,
): void {
  const depth = parentPath.length;
  for (const el of container.querySelectorAll<HTMLElement>("[data-jx-path]")) {
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
    el.dataset.jxPath = serializeJxPath(np);
  }
}

/** Rewrite the `data-jx-path` of `el` and its descendants, replacing `oldPrefix` with `newPrefix`. */
function rewriteSubtreePathPrefix(el: HTMLElement, oldPrefix: JxPath, newPrefix: JxPath): void {
  const targets: HTMLElement[] = [el, ...el.querySelectorAll<HTMLElement>("[data-jx-path]")];
  for (const t of targets) {
    const p = elementPath(t);
    if (!p || p.length < oldPrefix.length || !oldPrefix.every((seg, i) => p[i] === seg)) {
      continue;
    }
    t.dataset.jxPath = serializeJxPath([...newPrefix, ...p.slice(oldPrefix.length)]);
  }
}

/** Read an element's stamped document path, or null when it carries no `data-jx-path`. */
function elementPath(el: HTMLElement): JxPath | null {
  const raw = el.dataset.jxPath;
  return raw === undefined ? null : parseJxPath(raw);
}

/**
 * Re-emit the node's style onto its element, matching the full render's edit-mode style transform.
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
  const el = requireElement(container, path);
  const node = getNodeAtPath(doc, path);
  /* SAFETY: buildScope writes `$media` only from the document's own `$media` map or the runtime's
   * root media map, both Record<string, string>, and the host scope may not supply the key. */
  const mediaQueries = (ctx?.defs["$media"] as Record<string, string> | undefined) ?? {};
  /* SAFETY: the edit-mode transform of a style object is a style object: it rebuilds the same
   * keys with the same kinds of value, and answers undefined only for an absent style. */
  const style = editModeStyle(node?.style, sampleRowAt(doc, path)) as JxStyle | undefined;
  reapplyStyle(el, style, mediaQueries, ctx?.defs ?? {});
}

/**
 * Write a LITERAL node's text, syncing the empty-placeholder class like the full render. Never
 * reached for a bound node ({@link isBoundNode}): its text is the runtime's to write.
 */
function patchText(doc: JxMutableNode, path: (string | number)[], container: HTMLElement): void {
  const el = requireElement(container, path);
  const node = getNodeAtPath(doc, path);
  const text = node?.textContent;
  el.textContent = text == null ? "" : String(text);
  syncPlaceholderClass(el, node);
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
