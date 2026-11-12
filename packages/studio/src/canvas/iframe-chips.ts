/// <reference lib="dom" />
/**
 * Chips in the editing host: the DOM half of "a chip is atomic" (studio.md §4.5).
 *
 * A chip is an element closed to the caret that stands for one binding. The engine already refuses
 * to put a caret inside one, but what it does NEXT to one is its own business and differs by engine
 * and by where the chip sits, so the editing host decides it here instead: an arrow key steps over
 * the chip whole, Backspace and Delete take it whole, and every chip an input removes is reported,
 * because a commit may drop a binding only when the author deleted it
 * (`editor/inline-edit-apply.ts`).
 *
 * Pure DOM traversal with no layout reads, so all of it runs under happy-dom.
 *
 * @docs studio/editing/writing
 */

import { refBindingKey, TAG_ATTR, TAG_REF_ATTR } from "../utils/edit-display";
import { chipAround, isAtom, isChip, offsetOf } from "./iframe-position";
import type { DomPosition } from "./iframe-position";

/** Which way from the caret: `-1` is toward the start of the block, `1` toward its end. */
export type Side = -1 | 1;

/**
 * The last node of `node`'s subtree in document order, treating a chip, and any element closed to
 * the caret, as a leaf: what such an element holds is not beside a caret outside it.
 */
function lastLeaf(node: Node): Node {
  let cur = node;
  while (!isAtom(cur) && cur.lastChild) {
    cur = cur.lastChild;
  }
  return cur;
}

/** The first node of `node`'s subtree in document order, with the same leaves as {@link lastLeaf}. */
function firstLeaf(node: Node): Node {
  let cur = node;
  while (!isAtom(cur) && cur.firstChild) {
    cur = cur.firstChild;
  }
  return cur;
}

/** The leaf before (`-1`) or after (`1`) `node` in document order, staying inside `block`. */
function neighbourLeaf(block: Node, node: Node, side: Side): Node | null {
  for (let cur: Node | null = node; cur && cur !== block; cur = cur.parentNode) {
    const sibling = side === -1 ? cur.previousSibling : cur.nextSibling;
    if (sibling) {
      return side === -1 ? lastLeaf(sibling) : firstLeaf(sibling);
    }
  }
  return null;
}

/** Whether a leaf holds nothing a caret could be next to: a text node with no characters. */
function isEmptyText(node: Node): boolean {
  return node.nodeType === node.TEXT_NODE && (node.nodeValue ?? "") === "";
}

/**
 * The chip immediately beside a collapsed caret at (`node`, `offset`) on `side`, or null when a
 * character, another element or the block's edge is there instead.
 *
 * "Immediately" is in document order, not among siblings: a caret at the start of an `<em>` whose
 * previous sibling is a chip is beside that chip, and so is one separated from it only by empty
 * text nodes, which editing leaves behind freely.
 */
export function chipBeside(block: Node, node: Node, offset: number, side: Side): Element | null {
  if (!block.contains(node) || chipAround(block, node)) {
    return null;
  }
  let leaf: Node | null;
  if (node.nodeType === node.TEXT_NODE) {
    const { length } = node.nodeValue ?? "";
    if (side === -1 ? offset > 0 : offset < length) {
      return null;
    }
    leaf = neighbourLeaf(block, node, side);
  } else {
    const child = node.childNodes[side === -1 ? offset - 1 : offset];
    if (child) {
      leaf = side === -1 ? lastLeaf(child) : firstLeaf(child);
    } else if (node === block) {
      leaf = null;
    } else {
      leaf = neighbourLeaf(block, node, side);
    }
  }
  while (leaf && isEmptyText(leaf)) {
    leaf = neighbourLeaf(block, leaf, side);
  }
  return isChip(leaf) ? leaf : null;
}

/** The index of `node` among its parent's child nodes. */
function indexInParent(node: Node): number {
  let index = 0;
  for (let prev = node.previousSibling; prev; prev = prev.previousSibling) {
    index += 1;
  }
  return index;
}

/**
 * Where a caret stands on `side` of `chip`: in the neighbouring text node when there is one (a
 * caret in text is one every engine draws), else at the chip's own place among its parent's
 * children.
 */
export function caretBeside(chip: Element, side: Side): DomPosition {
  const sibling = side === -1 ? chip.previousSibling : chip.nextSibling;
  if (sibling && sibling.nodeType === sibling.TEXT_NODE) {
    return { node: sibling, offset: side === -1 ? (sibling.nodeValue ?? "").length : 0 };
  }
  const parent = chip.parentNode ?? chip;
  return { node: parent, offset: indexInParent(chip) + (side === 1 ? 1 : 0) };
}

/** Every chip under `block`, outermost only, in document order. */
export function chipsIn(block: Element): Element[] {
  return [...block.querySelectorAll(`[${TAG_ATTR}]`)].filter(
    (chip) => chip.parentElement?.closest(`[${TAG_ATTR}]`) == null,
  );
}

/**
 * What a chip is counted as when a commit is asked whether it lost a binding
 * (`editor/inline-edit-apply.ts`): the expression it stands for, or for a `{ "$ref" }` chip the
 * reference, which is not a string and has its own key.
 */
export function chipKey(chip: Element): string {
  const ref = chip.getAttribute(TAG_REF_ATTR);
  return ref === null ? (chip.getAttribute(TAG_ATTR) ?? "") : refBindingKey(ref);
}

/** What each chip under `block` stands for ({@link chipKey}), in document order. */
export function chipSources(block: Element): string[] {
  return chipsIn(block).map((chip) => chipKey(chip));
}

/**
 * The expressions `before` holds that `after` no longer does, counted: two chips of one expression
 * with one left is one removal.
 */
export function removedSources(before: readonly string[], after: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const source of after) {
    left.set(source, (left.get(source) ?? 0) + 1);
  }
  const removed: string[] = [];
  for (const source of before) {
    const count = left.get(source) ?? 0;
    if (count > 0) {
      left.set(source, count - 1);
    } else {
      removed.push(source);
    }
  }
  return removed;
}

/**
 * The expressions of the chips in `block` that lie at or after `from` (a document offset into the
 * block) and before `to`: what a range over those offsets takes with it. `to` omitted means to the
 * block's end.
 */
export function chipSourcesBetween(block: HTMLElement, from: number, to?: number): string[] {
  const sources: string[] = [];
  for (const chip of chipsIn(block)) {
    const at = chip.parentNode ? offsetOf(block, chip.parentNode, indexInParent(chip)) : null;
    if (at !== null && at >= from && (to === undefined || at < to)) {
      sources.push(chipKey(chip));
    }
  }
  return sources;
}

/**
 * Take `chip` out of the document and leave the caret where it stood. Returns the expression it
 * stood for.
 */
export function removeChip(chip: Element): string {
  const source = chipKey(chip);
  const parent = chip.parentNode;
  const index = indexInParent(chip);
  chip.remove();
  const selection = chip.ownerDocument.getSelection();
  if (parent && selection) {
    selection.collapse(parent, index);
  }
  return source;
}

/**
 * Which side of `chip` a position inside it is nearer: before it when the position is in the first
 * half of the text the chip shows, after it otherwise. A press on a chip lands inside it, where no
 * caret can stand, and the side of the press is the only thing that says which edge was meant.
 */
export function sideWithin(chip: Element, node: Node, offset: number): Side {
  const total = chip.textContent.length;
  if (total === 0 || !chip.contains(node)) {
    return 1;
  }
  const lead = chip.ownerDocument.createRange();
  lead.setStart(chip, 0);
  lead.setEnd(node, offset);
  return lead.toString().length * 2 < total ? -1 : 1;
}

/**
 * Move the ends of `range` out of any chip in `block` they stand inside: the start to before its
 * chip and the end to after it, so a selection that touches a chip covers it whole. A collapsed
 * range goes to the nearer edge ({@link sideWithin}). Returns whether anything moved.
 */
export function snapRangeOutOfChips(block: Node, range: Range): boolean {
  const startChip = block.contains(range.startContainer)
    ? chipAround(block, range.startContainer)
    : null;
  const endChip = block.contains(range.endContainer) ? chipAround(block, range.endContainer) : null;
  if (!startChip && !endChip) {
    return false;
  }
  if (range.collapsed && startChip) {
    const at = caretBeside(
      startChip,
      sideWithin(startChip, range.startContainer, range.startOffset),
    );
    range.setStart(at.node, at.offset);
    range.collapse(true);
    return true;
  }
  if (startChip?.parentNode) {
    range.setStart(startChip.parentNode, indexInParent(startChip));
  }
  if (endChip?.parentNode) {
    range.setEnd(endChip.parentNode, indexInParent(endChip) + 1);
  }
  return true;
}
