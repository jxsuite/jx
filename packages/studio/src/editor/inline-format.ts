/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * Inline-format.js — Inline formatting engine for contenteditable editing
 *
 * Handles toggling inline formatting (bold, italic, code, etc.) with proper wrap/unwrap logic, DOM
 * normalization, and whitespace management.
 */

import { templateExpressions } from "@jxsuite/schema/guards";
import { KEEP_ATTR } from "./kept-node";

/** Tags considered inline formatting wrappers */
const FORMAT_TAGS = new Set([
  "strong",
  "em",
  "b",
  "i",
  "u",
  "del",
  "s",
  "strike",
  "code",
  "sub",
  "sup",
  "span",
]);

/** Whether `node` is an element. Decided by node type, so it holds for a node of any realm. */
function isElementNode(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

/** Whether `node` is a text node (`CDATASection` has its own node type and is excluded). */
function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

/** One edge-whitespace move {@link liftEdgeWhitespace} applies after its scan. */
interface EdgeWhitespaceLift {
  type: "lift-leading" | "lift-trailing";
  el: Element;
  /** The wrapper's first (leading) or last (trailing) child, whose edge whitespace moves out. */
  text: Text;
  ws: string;
}

/**
 * Check whether `tag` is currently active on both ends of the selection. Walks from anchor and
 * focus nodes up to editableRoot looking for the tag. Returns false if selection is outside
 * editableRoot or in plaintext-only mode.
 *
 * @param {string} tag
 * @param {HTMLElement | null} editableRoot
 * @returns {boolean}
 */
export function isTagActiveInSelection(tag: string, editableRoot: HTMLElement | null) {
  if (!editableRoot) {
    return false;
  }
  if (editableRoot.contentEditable === "plaintext-only") {
    return false;
  }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    return false;
  }

  const anchor = sel.anchorNode;
  const focus = sel.focusNode;
  if (!anchor || !focus) {
    return false;
  }
  if (!editableRoot.contains(anchor) || !editableRoot.contains(focus)) {
    return false;
  }

  /**
   * @param {Node | null} node
   * @returns {boolean}
   */
  const hasTag = (node: Node | null) => {
    let current = node;
    while (current && current !== editableRoot) {
      if (isElementNode(current) && current.tagName.toLowerCase() === tag) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  };

  return hasTag(anchor) && hasTag(focus);
}

/**
 * Toggle an inline format tag on/off for the current selection. If the tag is active → unwrap. If
 * not → wrap.
 *
 * @param {string} tag
 * @param {HTMLElement | null} editableRoot
 */
export function toggleInlineFormat(tag: string, editableRoot: HTMLElement | null) {
  if (!editableRoot) {
    return;
  }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    return;
  }
  const range = sel.getRangeAt(0);
  if (range.collapsed) {
    return;
  }
  if (!editableRoot.contains(range.commonAncestorContainer)) {
    return;
  }

  // Expand selection to fully include any partially-selected ${...} expressions
  expandRangeToTemplateExpressions(range);

  // Find all elements matching `tag` that intersect the selection
  const matches = findIntersectingElements(tag, range, editableRoot);

  if (matches.length > 0) {
    unwrapTagInRange(tag, range, editableRoot, matches);
  } else {
    wrapRangeInTag(tag, range, editableRoot);
  }

  normalizeInlineContent(editableRoot);
}

/**
 * Find all elements with the given tag that intersect the selection range.
 *
 * @param {string} tag
 * @param {Range} range
 * @param {HTMLElement} root
 * @returns {Element[]}
 */
function findIntersectingElements(tag: string, range: Range, root: HTMLElement) {
  const matches: Element[] = [];
  // Every descendant element, in document order: the same set a SHOW_ELEMENT tree walk visits.
  // Never one inside a chip: what a chip holds is the runtime's, drawn from data, not the author's
  // Formatting, and unwrapping a `<strong>` there took apart a computed list's own markup.
  for (const el of normalizable(root)) {
    if (el.tagName.toLowerCase() === tag && range.intersectsNode(el)) {
      matches.push(el);
    }
  }
  return matches;
}

/**
 * Unwrap all instances of `tag` within the range. Processes in reverse document order to preserve
 * earlier offsets.
 *
 * @param {string} tag
 * @param {Range} range
 * @param {HTMLElement} editableRoot
 * @param {Element[]} matches
 */
function unwrapTagInRange(
  _tag: string,
  _range: Range,
  _editableRoot: HTMLElement,
  matches: Element[],
) {
  // Process in reverse so DOM mutations don't shift later nodes
  for (let i = matches.length - 1; i >= 0; i--) {
    const el = matches[i]!;
    unwrapElement(el);
  }
}

/**
 * Replace an element with its children (unwrap).
 *
 * @param {Element} el
 */
function unwrapElement(el: Element) {
  const parent = el.parentNode;
  if (!parent) {
    return;
  }
  const frag = document.createDocumentFragment();
  while (el.firstChild) {
    frag.append(el.firstChild);
  }
  el.replaceWith(frag);
}

/**
 * Wrap the current selection range in a new element of the given tag. Handles whitespace:
 * leading/trailing whitespace stays outside the wrapper.
 *
 * @param {string} tag
 * @param {Range} range
 * @param {HTMLElement} _editableRoot
 */
function wrapRangeInTag(tag: string, range: Range, _editableRoot: HTMLElement) {
  const contents = range.extractContents();

  // Trim leading whitespace from the fragment
  const leadingWS = trimLeadingWhitespace(contents);
  // Trim trailing whitespace from the fragment
  const trailingWS = trimTrailingWhitespace(contents);

  // If nothing left after trimming, re-insert everything and bail
  if (!contents.hasChildNodes()) {
    if (leadingWS) {
      range.insertNode(document.createTextNode(leadingWS));
    }
    if (trailingWS) {
      const t = document.createTextNode(trailingWS);
      range.collapse(false);
      range.insertNode(t);
    }
    return;
  }

  const wrapper = document.createElement(tag);
  wrapper.append(contents);

  // Build the insertion fragment: [leadingWS] [wrapper] [trailingWS]
  const frag = document.createDocumentFragment();
  if (leadingWS) {
    frag.append(document.createTextNode(leadingWS));
  }
  frag.append(wrapper);
  if (trailingWS) {
    frag.append(document.createTextNode(trailingWS));
  }

  range.insertNode(frag);

  // Restore selection around the wrapper's contents
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(wrapper);
    sel.addRange(newRange);
  }
}

/**
 * Remove and return leading whitespace from a document fragment. Only trims if the first node is a
 * text node starting with whitespace.
 *
 * @param {DocumentFragment} frag
 * @returns {string | null}
 */
function trimLeadingWhitespace(frag: DocumentFragment) {
  const first = frag.firstChild;
  if (!first || first.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const text = first.textContent ?? "";
  const match = text.match(/^(\s+)/);
  if (!match) {
    return null;
  }
  const ws = match[1]!;
  if (text.length === ws.length) {
    // Entire node is whitespace — remove it
    first.remove();
  } else {
    first.textContent = text.slice(ws.length);
  }
  return ws;
}

/**
 * Remove and return trailing whitespace from a document fragment. Only trims if the last node is a
 * text node ending with whitespace.
 *
 * @param {DocumentFragment} frag
 * @returns {string | null}
 */
function trimTrailingWhitespace(frag: DocumentFragment) {
  const last = frag.lastChild;
  if (!last || last.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const text = last.textContent ?? "";
  const match = text.match(/(\s+)$/);
  if (!match) {
    return null;
  }
  const ws = match[1]!;
  if (text.length === ws.length) {
    last.remove();
  } else {
    last.textContent = text.slice(0, -ws.length);
  }
  return ws;
}

// ─── Normalization ─────────────────────────────────────────────────────────────

/** The attribute a chip carries its expression in (`utils/edit-display.ts`). */
const CHIP_SELECTOR = "[data-jx-tag]";

/**
 * Every element under `root` that inline normalization may touch: all of them except a CHIP and
 * whatever a chip holds (studio.md §4.5, §8.2.7).
 *
 * A chip stands for one binding and is not formatting. Two adjacent ones are two bindings, so they
 * are never merged; one alone inside a wrapper is not redundant nesting; one whose value is empty
 * is not an empty inline to remove. What a chip holds is the runtime's, drawn from data and
 * rewritten whenever the data changes, so none of it is normalized either.
 */
function normalizable(root: HTMLElement): Element[] {
  return [...root.querySelectorAll("*")].filter((el) => el.closest(CHIP_SELECTOR) === null);
}

/**
 * Whether `node` is an element closed to the caret: an inline whose content is a value (a `{ "$ref"
 * }` text, bound `innerHTML`) or a component instance (`utils/edit-display.ts`, `makeStamper`).
 *
 * It has a tag a formatting wrapper may share, and it is not formatting: it is one node of the
 * document, drawn from data. Merged into the `<em>` beside it, or collapsed into the `<em>` around
 * it, it stopped being the one chip and nothing else the serializer reads back as a reference, and
 * every commit of its block was refused from then on.
 */
function isClosed(node: Node | null): boolean {
  return node !== null && isElementNode(node) && node.getAttribute("contenteditable") === "false";
}

/**
 * `Node.normalize()` for everything outside a chip: adjacent text nodes are joined and empty ones
 * removed.
 *
 * Not the native method, because it reaches inside chips too, and the runtime keeps one Text node
 * there as the anchor its binding writes to. That node is empty whenever the value is (or is an
 * array, drawn as nodes before it), so the native call removed it and the chip never updated
 * again.
 */
function normalizeText(node: Node): void {
  let child = node.firstChild;
  while (child) {
    const next: ChildNode | null = child.nextSibling;
    if (isTextNode(child)) {
      if (child.data === "") {
        child.remove();
      } else if (next && isTextNode(next)) {
        absorbText(child, next);
        // Stay on `child`: the node after the one just absorbed may be text too.
        continue;
      }
    } else if (isElementNode(child) && !child.matches(CHIP_SELECTOR)) {
      normalizeText(child);
    }
    child = next;
  }
}

/**
 * Join `next` onto the end of `into` and remove it, moving a selection endpoint that was in `next`
 * to the same character in `into`, which is what the native `normalize()` does for a live range.
 */
function absorbText(into: Text, next: Text): void {
  const selection = into.ownerDocument.getSelection();
  const anchor = selection?.anchorNode ?? null;
  const focus = selection?.focusNode ?? null;
  const anchorOffset = selection?.anchorOffset ?? 0;
  const focusOffset = selection?.focusOffset ?? 0;
  const joinAt = into.length;
  const parent = next.parentNode;
  let index = 0;
  for (let prev = next.previousSibling; prev; prev = prev.previousSibling) {
    index += 1;
  }
  /** Where an end that stood at (`node`, `offset`) before the join stands after it. */
  const moved = (node: Node, offset: number): [Node, number] => {
    if (node === next) {
      return [into, joinAt + offset];
    }
    // An end counted among the parent's children, past the node that is gone, is one child back.
    return node === parent && offset > index ? [node, offset - 1] : [node, offset];
  };
  into.data += next.data;
  next.remove();
  if (!selection || !anchor || !focus) {
    return;
  }
  const [anchorNode, anchorAt] = moved(anchor, anchorOffset);
  const [focusNode, focusAt] = moved(focus, focusOffset);
  if (
    anchorNode !== anchor ||
    anchorAt !== anchorOffset ||
    focusNode !== focus ||
    focusAt !== focusOffset
  ) {
    selection.setBaseAndExtent(anchorNode, anchorAt, focusNode, focusAt);
  }
}

/**
 * Normalize the inline content of an editable root. Merges adjacent same-tag siblings, collapses
 * redundant nesting, removes empty inline elements, and lifts edge whitespace. Runs to
 * fixed-point.
 *
 * @param {HTMLElement | null} root
 */
export function normalizeInlineContent(root: HTMLElement | null) {
  if (!root) {
    return;
  }
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations += 1;

    // 1. Merge adjacent text nodes
    normalizeText(root);

    // 2. Merge adjacent same-tag siblings
    if (mergeAdjacentSiblings(root)) {
      changed = true;
    }

    // 3. Collapse redundant nesting (strong > strong → strong)
    if (collapseRedundantNesting(root)) {
      changed = true;
    }

    // 4. Remove empty inline elements
    if (removeEmptyInlines(root)) {
      changed = true;
    }

    // 5. Lift edge whitespace out of inline wrappers
    if (liftEdgeWhitespace(root)) {
      changed = true;
    }

    // 6. Unwrap bare <span> elements (no class, style, or attributes)
    if (unwrapBareSpans(root)) {
      changed = true;
    }
  }
}

/**
 * Merge adjacent sibling elements with the same tag name. E.g.,
 * <strong>a</strong><strong>b</strong> → <strong>ab</strong>
 *
 * @param {HTMLElement} root
 * @returns {boolean}
 */
function mergeAdjacentSiblings(root: HTMLElement) {
  let changed = false;
  const toMerge: [Element, Element][] = [];

  // Collect pairs first to avoid mutation during walk
  for (const el of normalizable(root)) {
    const next = el.nextSibling;
    if (
      next &&
      isElementNode(next) &&
      next.tagName === el.tagName &&
      FORMAT_TAGS.has(el.tagName.toLowerCase()) &&
      !isClosed(el) &&
      !isClosed(next) &&
      attributesMatch(el, next)
    ) {
      toMerge.push([el, next]);
    }
  }

  // Process in reverse to preserve earlier offsets
  for (let i = toMerge.length - 1; i >= 0; i--) {
    const [el, next] = toMerge[i]!;
    // Move all children from next into el
    while (next.firstChild) {
      el.append(next.firstChild);
    }
    next.remove();
    changed = true;
  }
  return changed;
}

/**
 * Collapse redundant nesting where a parent and its only child share the same tag. E.g.,
 * <strong><strong>x</strong></strong> → <strong>x</strong>
 *
 * @param {HTMLElement} root
 * @returns {boolean}
 */
function collapseRedundantNesting(root: HTMLElement) {
  let changed = false;
  const toCollapse: Element[] = [];

  for (const el of normalizable(root)) {
    if (!FORMAT_TAGS.has(el.tagName.toLowerCase())) {
      continue;
    }
    // Check if only child is an element with the same tag
    const only = el.firstChild;
    if (
      el.childNodes.length === 1 &&
      only !== null &&
      isElementNode(only) &&
      only.tagName === el.tagName &&
      !isClosed(el) &&
      !isClosed(only)
    ) {
      toCollapse.push(el);
    }
  }

  for (const el of toCollapse) {
    const inner = el.firstChild;
    if (inner === null || !isElementNode(inner) || inner.tagName !== el.tagName) {
      /* Three or more nested identical wrappers: collapsing the outer pair took this wrapper out of
         the tree. Its content is already where it belongs, and the pass after this one collapses
         whatever nesting is left. This used to throw out of the commit. */
      continue;
    }
    // Replace outer with inner's children
    while (inner.firstChild) {
      inner.before(inner.firstChild);
    }
    inner.remove();
    changed = true;
  }
  return changed;
}

/**
 * Remove empty inline elements.
 *
 * @param {HTMLElement} root
 * @returns {boolean}
 */
function removeEmptyInlines(root: HTMLElement) {
  let changed = false;
  const toRemove: Element[] = [];

  for (const el of normalizable(root)) {
    if (!FORMAT_TAGS.has(el.tagName.toLowerCase())) {
      continue;
    }
    if (el.childNodes.length === 0 && !el.textContent) {
      toRemove.push(el);
    }
  }

  for (const el of toRemove) {
    el.remove();
    changed = true;
  }
  return changed;
}

/**
 * Lift leading/trailing whitespace out of inline wrapper elements. E.g., <strong> text </strong> →
 * " "<strong>text</strong>" "
 *
 * @param {HTMLElement} root
 * @returns {boolean}
 */
function liftEdgeWhitespace(root: HTMLElement) {
  let changed = false;
  const ops: EdgeWhitespaceLift[] = [];

  for (const el of normalizable(root)) {
    if (!FORMAT_TAGS.has(el.tagName.toLowerCase())) {
      continue;
    }
    if (el === root) {
      continue;
    }

    const first = el.firstChild;
    if (first && isTextNode(first)) {
      const text = first.textContent;
      const m = text.match(/^(\s+)/);
      if (m && text.length > m[1]!.length) {
        ops.push({ el, text: first, type: "lift-leading", ws: m[1]! });
      }
    }

    const last = el.lastChild;
    if (last && isTextNode(last) && last !== first) {
      const text = last.textContent;
      const m = text.match(/(\s+)$/);
      if (m && text.length > m[1]!.length) {
        ops.push({ el, text: last, type: "lift-trailing", ws: m[1]! });
      }
    }
  }

  /* Each recorded text node is still its wrapper's edge child when its move runs: a move only edits
     a text node's data and inserts a sibling OUTSIDE its own wrapper, and a wrapper whose edge child
     is an element (the only place a nested move could insert) never recorded a move on that edge. */
  for (const op of ops) {
    if (op.type === "lift-leading") {
      op.text.textContent = op.text.textContent.slice(op.ws.length);
      op.el.parentNode?.insertBefore(document.createTextNode(op.ws), op.el);
    } else {
      op.text.textContent = op.text.textContent.slice(0, -op.ws.length);
      op.el.parentNode?.insertBefore(document.createTextNode(op.ws), op.el.nextSibling);
    }
    changed = true;
  }
  return changed;
}

/**
 * Unwrap bare <span> elements that have no class, style, or meaningful attributes. These are
 * semantically empty wrappers left over from formatting operations.
 *
 * @param {HTMLElement} root
 * @returns {boolean}
 */
function unwrapBareSpans(root: HTMLElement) {
  let changed = false;
  const toUnwrap: Element[] = [];

  for (const el of normalizable(root)) {
    if (el.tagName.toLowerCase() !== "span") {
      continue;
    }
    if (el === root) {
      continue;
    }
    // Keep spans with class, style, or any attributes
    if (el.attributes.length > 0) {
      continue;
    }
    toUnwrap.push(el);
  }

  for (const el of toUnwrap) {
    unwrapElement(el);
    changed = true;
  }
  return changed;
}

/**
 * Check if two elements have matching attributes (for merge eligibility). What they carry from
 * their document nodes must match; beyond that a simple formatting tag's attributes don't matter,
 * and for <a>, href must match.
 *
 * @param {Element} a
 * @param {Element} b
 * @returns {boolean}
 */
function attributesMatch(a: Element, b: Element) {
  /* What each carries from its document node (`editor/kept-node.ts`): a highlighted `<span>` and the
     plain `<span>` beside it are two different things, and merged they were one with the first
     one's class. */
  if (a.getAttribute(KEEP_ATTR) !== b.getAttribute(KEEP_ATTR)) {
    return false;
  }
  const tag = a.tagName.toLowerCase();
  if (tag === "a") {
    return a.getAttribute("href") === b.getAttribute("href");
  }
  // For simple format tags, always match
  return true;
}

// ─── Template expression preservation ─────────────────────────────────────────

/**
 * Expand a Range so that it fully includes any `${...}` template expressions that are partially
 * selected. Template expressions are atomic in Jx — if split across inline elements, the template
 * string breaks.
 *
 * Scans the text content of the start and end containers for `${...}` patterns and adjusts the
 * range boundaries outward to include the complete expression.
 *
 * @param {Range} range
 */
export function expandRangeToTemplateExpressions(range: Range) {
  expandBoundary(range, true); // Start
  expandBoundary(range, false); // End
}

/**
 * Expand one boundary (start or end) of a range to avoid splitting a ${...}. `isStart` = true
 * adjusts startContainer/startOffset, `isStart` = false adjusts endContainer/endOffset.
 *
 * @param {Range} range
 * @param {boolean} isStart
 */
function expandBoundary(range: Range, isStart: boolean) {
  const node = isStart ? range.startContainer : range.endContainer;
  const offset = isStart ? range.startOffset : range.endOffset;
  if (node.nodeType !== Node.TEXT_NODE) {
    return;
  }

  const text = node.textContent ?? "";

  /* Each ${...} of this text node, by the scanner every reader of a template shares: a brace in a
     string or an object literal inside the expression does not end it. */
  const exprs = templateExpressions(text);
  for (const expr of exprs) {
    // Expr = { start, end } — character indices of "$" and the closing "}" + 1
    if (isStart) {
      // If the range starts inside this expression, move it to include the whole expr
      if (offset > expr.start && offset < expr.end) {
        range.setStart(node, expr.start);
      }
    } else if (offset > expr.start && offset < expr.end) {
      // If the range ends inside this expression, expand to include the whole expr
      range.setEnd(node, expr.end);
    }
  }
}
