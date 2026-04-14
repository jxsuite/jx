/**
 * inline-format.js — Inline formatting engine for contenteditable editing
 *
 * Handles toggling inline formatting (bold, italic, code, etc.) with proper
 * wrap/unwrap logic, DOM normalization, and whitespace management.
 */

/** Tags considered inline formatting wrappers */
const FORMAT_TAGS = new Set([
  "strong", "em", "b", "i", "u", "del", "s", "strike",
  "code", "sub", "sup", "span",
]);

/**
 * Check whether `tag` is currently active on both ends of the selection.
 * Walks from anchor and focus nodes up to editableRoot looking for the tag.
 * Returns false if selection is outside editableRoot or in plaintext-only mode.
 */
export function isTagActiveInSelection(tag, editableRoot) {
  if (!editableRoot) return false;
  if (editableRoot.contentEditable === "plaintext-only") return false;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;

  const anchor = sel.anchorNode;
  const focus = sel.focusNode;
  if (!editableRoot.contains(anchor) || !editableRoot.contains(focus)) return false;

  const hasTag = (node) => {
    while (node && node !== editableRoot) {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === tag) return true;
      node = node.parentNode;
    }
    return false;
  };

  return hasTag(anchor) && hasTag(focus);
}

/**
 * Toggle an inline format tag on/off for the current selection.
 * If the tag is active → unwrap. If not → wrap.
 */
export function toggleInlineFormat(tag, editableRoot) {
  if (!editableRoot) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  if (!editableRoot.contains(range.commonAncestorContainer)) return;

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
 */
function findIntersectingElements(tag, range, root) {
  const matches = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.tagName.toLowerCase() === tag && range.intersectsNode(node)) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  while (walker.nextNode()) {
    matches.push(walker.currentNode);
  }
  return matches;
}

/**
 * Unwrap all instances of `tag` within the range.
 * Processes in reverse document order to preserve earlier offsets.
 */
function unwrapTagInRange(tag, range, editableRoot, matches) {
  // Process in reverse so DOM mutations don't shift later nodes
  for (let i = matches.length - 1; i >= 0; i--) {
    const el = matches[i];
    unwrapElement(el);
  }
}

/**
 * Replace an element with its children (unwrap).
 */
function unwrapElement(el) {
  const parent = el.parentNode;
  if (!parent) return;
  const frag = document.createDocumentFragment();
  while (el.firstChild) {
    frag.appendChild(el.firstChild);
  }
  parent.replaceChild(frag, el);
}

/**
 * Wrap the current selection range in a new element of the given tag.
 * Handles whitespace: leading/trailing whitespace stays outside the wrapper.
 */
function wrapRangeInTag(tag, range, editableRoot) {
  const contents = range.extractContents();

  // Trim leading whitespace from the fragment
  const leadingWS = trimLeadingWhitespace(contents);
  // Trim trailing whitespace from the fragment
  const trailingWS = trimTrailingWhitespace(contents);

  // If nothing left after trimming, re-insert everything and bail
  if (!contents.hasChildNodes()) {
    if (leadingWS) range.insertNode(document.createTextNode(leadingWS));
    if (trailingWS) {
      const t = document.createTextNode(trailingWS);
      range.collapse(false);
      range.insertNode(t);
    }
    return;
  }

  const wrapper = document.createElement(tag);
  wrapper.appendChild(contents);

  // Build the insertion fragment: [leadingWS] [wrapper] [trailingWS]
  const frag = document.createDocumentFragment();
  if (leadingWS) frag.appendChild(document.createTextNode(leadingWS));
  frag.appendChild(wrapper);
  if (trailingWS) frag.appendChild(document.createTextNode(trailingWS));

  range.insertNode(frag);

  // Restore selection around the wrapper's contents
  const sel = window.getSelection();
  sel.removeAllRanges();
  const newRange = document.createRange();
  newRange.selectNodeContents(wrapper);
  sel.addRange(newRange);
}

/**
 * Remove and return leading whitespace from a document fragment.
 * Only trims if the first node is a text node starting with whitespace.
 */
function trimLeadingWhitespace(frag) {
  const first = frag.firstChild;
  if (!first || first.nodeType !== Node.TEXT_NODE) return null;
  const match = first.textContent.match(/^(\s+)/);
  if (!match) return null;
  const ws = match[1];
  if (first.textContent.length === ws.length) {
    // Entire node is whitespace — remove it
    frag.removeChild(first);
  } else {
    first.textContent = first.textContent.slice(ws.length);
  }
  return ws;
}

/**
 * Remove and return trailing whitespace from a document fragment.
 * Only trims if the last node is a text node ending with whitespace.
 */
function trimTrailingWhitespace(frag) {
  const last = frag.lastChild;
  if (!last || last.nodeType !== Node.TEXT_NODE) return null;
  const match = last.textContent.match(/(\s+)$/);
  if (!match) return null;
  const ws = match[1];
  if (last.textContent.length === ws.length) {
    frag.removeChild(last);
  } else {
    last.textContent = last.textContent.slice(0, -ws.length);
  }
  return ws;
}

// ─── Normalization ─────────────────────────────────────────────────────────────

/**
 * Normalize the inline content of an editable root.
 * Merges adjacent same-tag siblings, collapses redundant nesting,
 * removes empty inline elements, and lifts edge whitespace.
 * Runs to fixed-point.
 */
export function normalizeInlineContent(root) {
  if (!root) return;
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations++;

    // 1. Merge adjacent text nodes
    root.normalize();

    // 2. Merge adjacent same-tag siblings
    if (mergeAdjacentSiblings(root)) changed = true;

    // 3. Collapse redundant nesting (strong > strong → strong)
    if (collapseRedundantNesting(root)) changed = true;

    // 4. Remove empty inline elements
    if (removeEmptyInlines(root)) changed = true;

    // 5. Lift edge whitespace out of inline wrappers
    if (liftEdgeWhitespace(root)) changed = true;

    // 6. Unwrap bare <span> elements (no class, style, or attributes)
    if (unwrapBareSpans(root)) changed = true;
  }
}

/**
 * Merge adjacent sibling elements with the same tag name.
 * E.g., <strong>a</strong><strong>b</strong> → <strong>ab</strong>
 */
function mergeAdjacentSiblings(root) {
  let changed = false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toMerge = [];

  // Collect pairs first to avoid mutation during walk
  while (walker.nextNode()) {
    const el = walker.currentNode;
    const next = el.nextSibling;
    if (
      next &&
      next.nodeType === Node.ELEMENT_NODE &&
      next.tagName === el.tagName &&
      FORMAT_TAGS.has(el.tagName.toLowerCase()) &&
      attributesMatch(el, next)
    ) {
      toMerge.push([el, next]);
    }
  }

  // Process in reverse to preserve earlier offsets
  for (let i = toMerge.length - 1; i >= 0; i--) {
    const [el, next] = toMerge[i];
    // Move all children from next into el
    while (next.firstChild) {
      el.appendChild(next.firstChild);
    }
    next.remove();
    changed = true;
  }
  return changed;
}

/**
 * Collapse redundant nesting where a parent and its only child share the same tag.
 * E.g., <strong><strong>x</strong></strong> → <strong>x</strong>
 */
function collapseRedundantNesting(root) {
  let changed = false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toCollapse = [];

  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (!FORMAT_TAGS.has(el.tagName.toLowerCase())) continue;
    // Check if only child is an element with the same tag
    if (
      el.childNodes.length === 1 &&
      el.firstChild.nodeType === Node.ELEMENT_NODE &&
      el.firstChild.tagName === el.tagName
    ) {
      toCollapse.push(el);
    }
  }

  for (const el of toCollapse) {
    const inner = el.firstChild;
    // Replace outer with inner's children
    while (inner.firstChild) {
      el.insertBefore(inner.firstChild, inner);
    }
    el.removeChild(inner);
    changed = true;
  }
  return changed;
}

/**
 * Remove empty inline elements.
 */
function removeEmptyInlines(root) {
  let changed = false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toRemove = [];

  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (!FORMAT_TAGS.has(el.tagName.toLowerCase())) continue;
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
 * Lift leading/trailing whitespace out of inline wrapper elements.
 * E.g., <strong> text </strong> → " "<strong>text</strong>" "
 */
function liftEdgeWhitespace(root) {
  let changed = false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const ops = [];

  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (!FORMAT_TAGS.has(el.tagName.toLowerCase())) continue;
    if (el === root) continue;

    const first = el.firstChild;
    if (first && first.nodeType === Node.TEXT_NODE) {
      const m = first.textContent.match(/^(\s+)/);
      if (m && first.textContent.length > m[1].length) {
        ops.push({ type: "lift-leading", el, ws: m[1] });
      }
    }

    const last = el.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE && last !== first) {
      const m = last.textContent.match(/(\s+)$/);
      if (m && last.textContent.length > m[1].length) {
        ops.push({ type: "lift-trailing", el, ws: m[1] });
      }
    }
  }

  for (const op of ops) {
    if (op.type === "lift-leading") {
      op.el.firstChild.textContent = op.el.firstChild.textContent.slice(op.ws.length);
      op.el.parentNode.insertBefore(document.createTextNode(op.ws), op.el);
      changed = true;
    } else if (op.type === "lift-trailing") {
      op.el.lastChild.textContent = op.el.lastChild.textContent.slice(0, -op.ws.length);
      op.el.parentNode.insertBefore(document.createTextNode(op.ws), op.el.nextSibling);
      changed = true;
    }
  }
  return changed;
}

/**
 * Unwrap bare <span> elements that have no class, style, or meaningful attributes.
 * These are semantically empty wrappers left over from formatting operations.
 */
function unwrapBareSpans(root) {
  let changed = false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toUnwrap = [];

  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (el.tagName.toLowerCase() !== "span") continue;
    if (el === root) continue;
    // Keep spans with class, style, or any attributes
    if (el.attributes.length > 0) continue;
    toUnwrap.push(el);
  }

  for (const el of toUnwrap) {
    unwrapElement(el);
    changed = true;
  }
  return changed;
}

/**
 * Check if two elements have matching attributes (for merge eligibility).
 * For simple formatting tags, attributes don't matter.
 * For <a>, href must match.
 */
function attributesMatch(a, b) {
  const tag = a.tagName.toLowerCase();
  if (tag === "a") {
    return a.getAttribute("href") === b.getAttribute("href");
  }
  // For simple format tags, always match
  return true;
}

// ─── Template expression preservation ─────────────────────────────────────────

/**
 * Expand a Range so that it fully includes any `${...}` template expressions
 * that are partially selected. Template expressions are atomic in JSONsx — if
 * split across inline elements, the template string breaks.
 *
 * Scans the text content of the start and end containers for `${...}` patterns
 * and adjusts the range boundaries outward to include the complete expression.
 */
export function expandRangeToTemplateExpressions(range) {
  expandBoundary(range, true);  // start
  expandBoundary(range, false); // end
}

/**
 * Expand one boundary (start or end) of a range to avoid splitting a ${...}.
 * `isStart` = true adjusts startContainer/startOffset,
 * `isStart` = false adjusts endContainer/endOffset.
 */
function expandBoundary(range, isStart) {
  const node = isStart ? range.startContainer : range.endContainer;
  const offset = isStart ? range.startOffset : range.endOffset;
  if (node.nodeType !== Node.TEXT_NODE) return;

  const text = node.textContent;

  // Find all ${...} expression spans in this text node (supporting nested braces)
  const exprs = findTemplateExpressions(text);
  for (const expr of exprs) {
    // expr = { start, end } — character indices of "$" and the closing "}" + 1
    if (isStart) {
      // If the range starts inside this expression, move it to include the whole expr
      if (offset > expr.start && offset < expr.end) {
        range.setStart(node, expr.start);
      }
    } else {
      // If the range ends inside this expression, expand to include the whole expr
      if (offset > expr.start && offset < expr.end) {
        range.setEnd(node, expr.end);
      }
    }
  }
}

/**
 * Find all `${...}` expression spans in a string, handling nested braces.
 * Returns array of { start, end } where start is the index of '$' and
 * end is one past the closing '}'.
 */
export function findTemplateExpressions(text) {
  const results = [];
  let i = 0;
  while (i < text.length - 1) {
    if (text[i] === "$" && text[i + 1] === "{") {
      const start = i;
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      if (depth === 0) {
        results.push({ start, end: j });
        i = j;
        continue;
      }
    }
    i++;
  }
  return results;
}
