/// <reference lib="dom" />
/**
 * Document positions — the caret's model coordinates.
 *
 * A DOM caret (`{ node, offset }`) is destroyed by any re-render of its block, so it cannot survive
 * a surgical patch, a subtree render, or a cross-block edit. A {@link DocPos} is the same position
 * expressed against the DOCUMENT: the block's `data-jx-path` plus a character offset into that
 * block's rendered text. It survives anything that leaves the block's path resolvable, which is
 * what lets the caret stay put while the patcher rewrites the DOM underneath it.
 *
 * The offset is deliberately measured in CHARACTERS OF RENDERED TEXT, not DOM child indices, so it
 * is agnostic to inline markup: `<p>a<strong>bc</strong>d</p>` has length 4, and offset 3 is
 * between "c" and "d" no matter how the bold run is nested (or whether a commit re-nested it).
 *
 * **A chip counts as the expression it stands for.** Bound text is drawn as its live value inside a
 * chip (studio.md §4.5), and the value's length says nothing about the document: `${state.name}`
 * drawn as "Ada" is thirteen characters of stored text. So a chip is ONE unit as long as its
 * `data-jx-tag`, no position lies inside it, and an offset counted here is the same offset into the
 * block's stored content, which is what lets a cross-block cut slice that content exactly
 * (`editor/content-slice.ts`).
 *
 * **An element closed to the caret counts as nothing.** A component instance, or an inline element
 * whose content is a value (a `{ "$ref" }` text, bound `innerHTML`), shows text that has no
 * relation to what its node stores, so it is one unit of length zero here and in the stored content
 * alike (`isAtomicInline` there). Counted as the text it shows, or as its chip's expression, it put
 * every later offset in its block out by the difference.
 *
 * Everything here is pure DOM traversal with NO layout reads, so it is fully exercisable under
 * happy-dom — unlike the caret-from-point and line-geometry paths, which are Chromium-only.
 *
 * @docs studio/editing/writing
 */

import { jxPathSelector, parseJxPath, serializeJxPath } from "./path-mapping";
import { TAG_ATTR, TAG_REF_ATTR } from "../utils/edit-display";
import type { JxPath } from "../state";

/** A caret/selection endpoint in document coordinates: a block path + a character offset into it. */
export interface DocPos {
  path: JxPath;
  offset: number;
}

/** A selection in document coordinates. Collapsed when both ends are equal. */
export interface DocRange {
  anchor: DocPos;
  head: DocPos;
}

/** A live DOM caret position: a node and an offset into it, as a Selection endpoint carries. */
export interface DomPosition {
  node: Node;
  offset: number;
}

/** Whether an element is a block the caret may live inside. Injected so the editable set is policy. */
export type EditablePredicate = (el: HTMLElement) => boolean;

/**
 * Whether an element ends the walk up from a caret: a component instance is an atomic island whose
 * internals belong to another document.
 *
 * Without this barrier a caret inside a component would keep walking and find an ancestor PAGE
 * block, so typing would rewrite the whole instance's `children` — silently replacing the component
 * with the text you typed. Component instances render `contenteditable="false"` (see
 * `makeStamper`); the tag-name test is the belt-and-braces twin for trees that were never stamped.
 *
 * A component definition opened as its own document is excluded: there its subtree IS the document.
 */
function isIslandBoundary(el: HTMLElement): boolean {
  if (el.dataset.jxDefinitionRoot !== undefined) {
    return false;
  }
  return el.getAttribute("contenteditable") === "false" || el.tagName.includes("-");
}

/**
 * The nearest ancestor-or-self of `node` that is an editable block carrying a `data-jx-path`.
 *
 * Mirrors the walk-up in {@link file://./iframe-inline-edit.ts}'s `findEditableTarget`, but starts
 * from a DOM node (a Selection endpoint) rather than an event target, and returns the parsed path.
 * The walk stops at a component island — see {@link isIslandBoundary}.
 */
export function activeBlockAt(
  node: Node | null,
  isEditable: EditablePredicate,
): { el: HTMLElement; path: JxPath } | null {
  let el = node instanceof Element ? node : (node?.parentElement ?? null);
  while (el) {
    if (el instanceof HTMLElement) {
      if (el.dataset.jxPath && isEditable(el)) {
        return { el, path: parseJxPath(el.dataset.jxPath) };
      }
      if (isIslandBoundary(el)) {
        return null;
      }
    }
    el = el.parentElement;
  }
  return null;
}

/** Locate the rendered element for a document path via its stamped `data-jx-path`. */
export function elementForPath(container: HTMLElement, path: JxPath): HTMLElement | null {
  // The escaping lives in `jxPathSelector`, which the popover work extracted for its own lookup.
  // This function had the only other copy of it, and two spellings of one escaping rule is how the
  // Two come to disagree about a path containing a quote.
  const el = container.querySelector(jxPathSelector(serializeJxPath(path)));
  return el instanceof HTMLElement ? el : null;
}

/** Whether `node` is a chip: the element that stands for one binding (studio.md §4.5). */
export function isChip(node: Node | null): node is Element {
  return node !== null && node.nodeType === node.ELEMENT_NODE && "hasAttribute" in node
    ? /* SAFETY: an ELEMENT_NODE with `hasAttribute` is an Element, in whichever realm it lives. */
      (node as Element).hasAttribute(TAG_ATTR)
    : false;
}

/** The outermost chip that is `node` or holds it, looking no further up than `block`. */
export function chipAround(block: Node, node: Node): Element | null {
  let found: Element | null = null;
  for (let cur: Node | null = node; cur && cur !== block; cur = cur.parentNode) {
    if (isChip(cur)) {
      found = cur;
    }
  }
  return found;
}

/**
 * Whether `node` is one unit no caret position lies inside: a chip, or an element closed to the
 * caret (a component instance, an inline whose content is drawn from data).
 */
export function isAtom(node: Node | null): node is Element {
  if (node === null || node.nodeType !== node.ELEMENT_NODE || !("hasAttribute" in node)) {
    return false;
  }
  // SAFETY: an ELEMENT_NODE with `hasAttribute` is an Element, in whichever realm it lives.
  const el = node as Element;
  return el.hasAttribute(TAG_ATTR) || el.getAttribute("contenteditable") === "false";
}

/** The outermost {@link isAtom} that is `node` or holds it, looking no further up than `block`. */
export function atomAround(block: Node, node: Node): Element | null {
  let found: Element | null = null;
  for (let cur: Node | null = node; cur && cur !== block; cur = cur.parentNode) {
    if (isAtom(cur)) {
      found = cur;
    }
  }
  return found;
}

/**
 * How many characters of the document `node` stands for: a chip is its expression, whole, and an
 * element closed to the caret, or a `{ "$ref" }` chip, is none.
 */
function unitLength(node: Node): number {
  if (node.nodeType === node.TEXT_NODE) {
    // SAFETY: a TEXT_NODE is a Text, whose `length` is its data's.
    return (node as Text).length;
  }
  if (isChip(node)) {
    return node.hasAttribute(TAG_REF_ATTR) ? 0 : (node.getAttribute(TAG_ATTR)?.length ?? 0);
  }
  if (isAtom(node)) {
    return 0;
  }
  let total = 0;
  for (const child of node.childNodes) {
    total += unitLength(child);
  }
  return total;
}

/** The index of `node` among its parent's child nodes. */
function indexInParent(node: Node): number {
  let index = 0;
  for (let prev = node.previousSibling; prev; prev = prev.previousSibling) {
    index += 1;
  }
  return index;
}

/** The block's text length in document characters — the maximum valid offset within it. */
export function blockTextLength(block: HTMLElement): number {
  let total = 0;
  for (const child of block.childNodes) {
    total += unitLength(child);
  }
  return total;
}

/**
 * The character offset of a DOM position within `block`.
 *
 * Element-anchored carets (the caret sitting "at child index N" rather than inside a text node,
 * what the browser produces next to a `<br>`, a chip or an atomic island) resolve by the same rule
 * as text-anchored ones. A position INSIDE a chip, or inside an element closed to the caret, is not
 * a position: it reads as that unit's start when it is at its very beginning and as its end
 * otherwise. Returns null when the position is not inside the block, or lies past the end of its
 * node (a stale position against a re-rendered node).
 */
export function offsetOf(block: HTMLElement, node: Node, offset: number): number | null {
  if (!block.contains(node)) {
    return null;
  }
  const limit =
    node.nodeType === node.TEXT_NODE
      ? // SAFETY: a TEXT_NODE is a Text.
        (node as Text).length
      : node.childNodes.length;
  if (offset < 0 || offset > limit) {
    return null;
  }
  let at: Node = node;
  let count = 0;
  const atom = atomAround(block, node);
  if (atom) {
    // The whole unit when the position is past its start; nothing of it at its start.
    const atStart = offset === 0 && startsSubtree(atom, node);
    count = atStart ? 0 : unitLength(atom);
    at = atom;
  } else if (node.nodeType === node.TEXT_NODE) {
    count = offset;
  } else {
    for (let i = 0; i < offset; i++) {
      count += unitLength(node.childNodes[i]!);
    }
  }
  // Everything before the position, level by level, up to the block.
  for (let cur: Node = at; cur !== block; cur = cur.parentNode!) {
    for (let prev = cur.previousSibling; prev; prev = prev.previousSibling) {
      count += unitLength(prev);
    }
  }
  return count;
}

/** Whether `node` is `root` or the first node at every level down from it. */
function startsSubtree(root: Node, node: Node): boolean {
  for (let cur: Node = node; cur !== root; cur = cur.parentNode!) {
    if (cur.previousSibling) {
      return false;
    }
  }
  return true;
}

/**
 * The DOM position for a character offset within `block`, clamped into range.
 *
 * The inverse of {@link offsetOf} up to one well-known ambiguity: a `<br>` contributes no
 * characters, so the position immediately before and immediately after a soft line break share an
 * offset and resolve to the earlier (end-of-previous-line) DOM position. That is the same ambiguity
 * every offset-based editor carries at a line break, and it is invisible for the paths that use
 * this (caret restore after a patch, and block-boundary edits, which clamp to 0 / length anyway).
 *
 * A chip is stepped over whole: an offset that falls inside one resolves to the position just after
 * it, and one at a chip's edge to the neighbouring text when there is some, else to the chip's own
 * place among its parent's children.
 */
export function domPositionAt(block: HTMLElement, offset: number): DomPosition {
  const target = Math.max(0, Math.min(offset, blockTextLength(block)));
  let seen = 0;
  /** `found` is the answer; `last` is the end of the last unit walked, the answer if none is found. */
  const at: PositionSearch = { found: null, last: null };
  const visit = (node: Node): boolean => {
    if (node.nodeType === node.TEXT_NODE) {
      // SAFETY: a TEXT_NODE is a Text.
      const text = node as Text;
      if (seen + text.length >= target) {
        // Clamped: a target inside the chip just before this text is this text's start.
        at.found = { node: text, offset: Math.max(0, target - seen) };
        return true;
      }
      seen += text.length;
      at.last = { node: text, offset: text.length };
      return false;
    }
    if (isAtom(node)) {
      const parent = node.parentNode ?? block;
      const index = indexInParent(node);
      const length = unitLength(node);
      if (target <= seen) {
        // Before the chip, with no text ahead of it to hold the caret.
        at.found = { node: parent, offset: index };
        return true;
      }
      seen += length;
      at.last = { node: parent, offset: index + 1 };
      if (seen >= target) {
        // Inside or at the end of the chip: just after it, unless text follows (found next).
        at.found = at.last;
        return afterChipIsFinal(node);
      }
      return false;
    }
    for (const child of node.childNodes) {
      if (visit(child)) {
        return true;
      }
    }
    return false;
  };
  visit(block);
  // No unit reaches the target: either the block has no text at all (caret goes to the element
  // Itself) or the walk ended early on a whitespace-collapsed tail (caret goes to the last text end).
  return at.found ?? at.last ?? { node: block, offset: 0 };
}

/** What {@link domPositionAt}'s walk has so far: the answer, and the fallback if there is none. */
interface PositionSearch {
  found: DomPosition | null;
  last: DomPosition | null;
}

/**
 * Whether the position just after `chip` is where a caret there belongs: true unless a text node
 * follows it directly, in which case that node's start is the same offset and the better anchor (a
 * caret in text is one every engine draws).
 */
function afterChipIsFinal(chip: Element): boolean {
  return chip.nextSibling?.nodeType !== chip.TEXT_NODE;
}

/**
 * Convert a DOM position to document coordinates. Returns null when the position is not inside any
 * editable block (canvas chrome, a `contenteditable="false"` island, layout-only nodes).
 */
export function toDocPos(
  node: Node | null,
  offset: number,
  isEditable: EditablePredicate,
): DocPos | null {
  const block = activeBlockAt(node, isEditable);
  if (!block || !node) {
    return null;
  }
  const charOffset = offsetOf(block.el, node, offset);
  return charOffset === null ? null : { offset: charOffset, path: block.path };
}

/**
 * Resolve a document position back to a live DOM position. Returns null only when the path no
 * longer resolves to an element — a stale OFFSET is clamped rather than rejected, so a caret in a
 * block whose text shrank under a remote edit lands at the block's new end instead of being
 * dropped.
 */
export function toDomPosition(container: HTMLElement, pos: DocPos): DomPosition | null {
  const el = elementForPath(container, pos.path);
  return el ? domPositionAt(el, pos.offset) : null;
}

/** Whether a document position sits at the very start of its block. */
export function isAtBlockStart(pos: DocPos): boolean {
  return pos.offset <= 0;
}

/** Whether a document position sits at the very end of its block, given the block's live element. */
export function isAtBlockEnd(block: HTMLElement, pos: DocPos): boolean {
  return pos.offset >= blockTextLength(block);
}

/** Whether two document positions address the same block. */
export function samePath(a: DocPos, b: DocPos): boolean {
  return serializeJxPath(a.path) === serializeJxPath(b.path);
}

/**
 * Every block the caret can reach inside `container`, in DOCUMENT ORDER.
 *
 * Order comes from the rendered DOM rather than from the document tree because that is where it is
 * already correct: a list item, a table cell, a block inside a nested container, and a repeater's
 * rendered rows all fall into the right sequence with no traversal rules to get wrong. Blocks
 * inside a component island are excluded — {@link activeBlockAt} refuses to resolve out of one, so a
 * block that does not resolve to ITSELF is not reachable by the caret.
 */
export function blocksInOrder(
  container: HTMLElement,
  isEditable: EditablePredicate,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of container.querySelectorAll<HTMLElement>("[data-jx-path]")) {
    if (isEditable(el) && !sealedInIsland(el, container)) {
      out.push(el);
    }
  }
  return out;
}

/**
 * Whether any ancestor of `el` up to `container` is a component island.
 *
 * {@link activeBlockAt} cannot answer this for a block that is itself stamped — the walk returns
 * that block immediately and never reaches the barrier above it. Caret navigation has to look
 * upward explicitly, or arrowing through the document would step into a component's internals.
 */
function sealedInIsland(el: HTMLElement, container: HTMLElement): boolean {
  let cur = el.parentElement;
  while (cur && cur !== container) {
    if (isIslandBoundary(cur)) {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

/**
 * The block immediately before (-1) or after (+1) `path` in document order, or null at the ends of
 * the document.
 */
export function adjacentBlock(
  container: HTMLElement,
  path: JxPath,
  direction: -1 | 1,
  isEditable: EditablePredicate,
): { el: HTMLElement; path: JxPath } | null {
  const blocks = blocksInOrder(container, isEditable);
  const key = serializeJxPath(path);
  const index = blocks.findIndex((el) => el.dataset.jxPath === key);
  const neighbour = index === -1 ? undefined : blocks[index + direction];
  // SAFETY: blocksInOrder collects only elements matching `[data-jx-path]`, so the attribute is set.
  return neighbour
    ? { el: neighbour, path: parseJxPath(neighbour.dataset.jxPath as string) }
    : null;
}
