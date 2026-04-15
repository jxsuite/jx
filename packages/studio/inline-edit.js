/**
 * inline-edit.js — Contenteditable inline editing for content mode
 *
 * Manages the lifecycle of editing text-bearing block elements directly
 * on the canvas. Handles rich text formatting, Enter for new paragraphs,
 * and slash commands for inserting elements.
 */

import { MD_BLOCK, MD_INLINE } from "./md-allowlist.js";
import elementsMeta from "./elements-meta.json";
import { toggleInlineFormat, normalizeInlineContent } from "./inline-format.js";

// ─── Inline tag set (tags that represent rich text formatting) ─────────────

/** Fallback set — used when parent context is unknown */
const INLINE_TAGS = new Set(["em", "strong", "del", "code", "a", "span", "br", "img", "b", "i", "u", "sub", "sup", "s"]);

/** Tags that can be edited inline (text-bearing block elements) */
const EDITABLE_BLOCKS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "td",
  "th",
  "blockquote",
]);

// ─── Context-aware inline scoping ─────────────────────────────────────────

/**
 * Check if a child tag is inline within the context of a given parent tag.
 * Uses $inlineChildren from elements-meta.json.
 * @param {string} childTag
 * @param {string} parentTag
 * @returns {boolean}
 */
export function isInlineInContext(childTag, parentTag) {
  if (!parentTag) return INLINE_TAGS.has(childTag);
  const parentDef = /** @type {Record<string, any>} */ (elementsMeta.$defs)[parentTag];
  if (!parentDef || !parentDef.$inlineChildren) return false;
  return parentDef.$inlineChildren.includes(childTag);
}

/**
 * Get the resolved $inlineActions for a given element tag.
 * Follows string references (e.g., "h1" → look up h1's actions).
 * @param {string} tag
 * @returns {any[] | null}
 */
export function getInlineActions(tag) {
  const def = /** @type {Record<string, any>} */ (elementsMeta.$defs)[tag];
  if (!def) return null;
  let actions = def.$inlineActions;
  if (typeof actions === "string") {
    const refDef = /** @type {Record<string, any>} */ (elementsMeta.$defs)[actions];
    actions = refDef?.$inlineActions ?? null;
  }
  if (!Array.isArray(actions)) return null;
  return actions;
}

// ─── Editing state ─────────────────────────────────────────────────────────

/** @type {HTMLElement | null} */
let activeEl = null; // currently contenteditable element
/** @type {any[] | null} */
let activePath = null; // JSON path to the active element
/** @type {((path: any[], children: any, textContent: any) => void) | null} */
let commitFn = null; // function(path, newChildren, newTextContent) to commit changes
/** @type {((path: any[], beforeChildren: any, afterChildren: any) => void) | null} */
let splitFn = null; // function(path, beforeChildren, afterChildren) to split paragraph
/** @type {((path: any[], elementDef: any) => void) | null} */
let insertFn = null; // function(path, elementDef) to insert after current block
/** @type {(() => void) | null} */
let endFn = null; // function() called when editing stops
/** @type {any} */
let slashMenuEl = null; // slash command menu element
/** @type {any} */
let slashMenuCleanup = null;

/**
 * Check if an element is a text-bearing editable block.
 * @param {HTMLElement} el
 * @returns {boolean}
 */
export function isEditableBlock(el) {
  return EDITABLE_BLOCKS.has(el.tagName.toLowerCase());
}

/**
 * Check if a node is an inline child.
 * When parentNode is provided, uses context-aware scoping from metadata.
 * Without parent, uses the fallback INLINE_TAGS set.
 * @param {any} node
 * @param {any} [parentNode]
 * @returns {boolean}
 */
export function isInlineElement(node, parentNode) {
  if (!node || typeof node !== "object") return false;
  const childTag = (node.tagName ?? "div").toLowerCase();
  if (parentNode) {
    const parentTag = (parentNode.tagName ?? "div").toLowerCase();
    return isInlineInContext(childTag, parentTag);
  }
  return INLINE_TAGS.has(childTag);
}

/**
 * Start inline editing on a canvas element.
 *
 * @param {HTMLElement} el - The canvas DOM element to edit
 * @param {Array<any>} path - JSON path to the element
 * @param {Record<string, any>} callbacks - { onCommit, onSplit, onInsert, onEnd }
 *   onCommit(path, children|null, textContent|null) — save inline content
 *   onSplit(path, beforeChildren, afterChildren) — Enter key: split block
 *   onInsert(path, elementDef) — slash command: insert after
 *   onEnd() — called when editing stops (for overlay restoration)
 */
export function startEditing(el, path, callbacks) {
  if (activeEl) stopEditing();

  activeEl = el;
  activePath = path;
  commitFn = callbacks.onCommit;
  splitFn = callbacks.onSplit;
  insertFn = callbacks.onInsert;
  endFn = callbacks.onEnd;

  // Enable editing
  el.contentEditable = "true";
  el.style.pointerEvents = "auto";
  el.style.outline = "2px solid var(--accent, #4a9eff)";
  el.style.outlineOffset = "1px";
  el.style.cursor = "text";
  el.focus();

  // Place cursor at end
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }

  el.addEventListener("keydown", handleKeydown);
  el.addEventListener("input", handleInput);
  el.addEventListener("blur", handleBlur);
  el.addEventListener("paste", handlePaste);
}

/**
 * Stop editing and commit changes.
 */
export function stopEditing() {
  if (!activeEl) return;

  commitChanges();
  dismissSlashMenu();

  activeEl.contentEditable = "false";
  activeEl.style.pointerEvents = "";
  activeEl.style.outline = "";
  activeEl.style.outlineOffset = "";
  activeEl.style.cursor = "";

  activeEl.removeEventListener("keydown", handleKeydown);
  activeEl.removeEventListener("input", handleInput);
  activeEl.removeEventListener("blur", handleBlur);
  activeEl.removeEventListener("paste", handlePaste);

  activeEl = null;
  activePath = null;
  commitFn = null;
  splitFn = null;
  insertFn = null;

  if (endFn) {
    const fn = endFn;
    endFn = null;
    fn();
  }
}

/**
 * Whether inline editing is currently active.
 * @returns {boolean}
 */
export function isEditing() {
  return activeEl !== null;
}

/**
 * Get the currently editing element.
 * @returns {HTMLElement | null}
 */
export function getActiveElement() {
  return activeEl;
}

// ─── Event handlers ────────────────────────────────────────────────────────

/**
 * @param {KeyboardEvent} e
 */
function handleKeydown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    stopEditing();
    return;
  }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleEnterKey();
    return;
  }

  // Slash command trigger
  if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
    // Check if at start of empty block or after a space/newline
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const textBefore = getTextBeforeCursor(range);
      if (textBefore === "" || textBefore.endsWith(" ") || textBefore.endsWith("\n")) {
        // Let the / character be typed, then show menu on next input
        requestAnimationFrame(() => showSlashMenu());
        return;
      }
    }
  }

  // Rich text shortcuts
  if (e.ctrlKey || e.metaKey) {
    switch (e.key) {
      case "b":
        e.preventDefault();
        toggleInlineFormat("strong", activeEl);
        break;
      case "i":
        e.preventDefault();
        toggleInlineFormat("em", activeEl);
        break;
      case "`":
        e.preventDefault();
        toggleInlineFormat("code", activeEl);
        break;
    }
  }

  // Dismiss slash menu on non-matching keys
  if (slashMenuEl && !["ArrowUp", "ArrowDown", "Enter", "Backspace", "Delete"].includes(e.key)) {
    // Let the input handler deal with filtering
  }
}

function handleInput() {
  // Check if slash menu should update or dismiss
  if (slashMenuEl) {
    updateSlashMenu();
  }
}

/**
 * @param {FocusEvent} e
 */
function handleBlur(e) {
  // Don't close if clicking the slash menu
  if (slashMenuEl && slashMenuEl.contains(/** @type {Node | null} */ (e.relatedTarget))) return;

  // Delay to allow click events to fire
  setTimeout(() => {
    if (activeEl && document.activeElement !== activeEl) {
      stopEditing();
    }
  }, 150);
}

/**
 * @param {ClipboardEvent} e
 */
function handlePaste(e) {
  e.preventDefault();
  // Paste as plain text to avoid foreign HTML
  const text = e.clipboardData?.getData("text/plain") ?? "";
  document.execCommand("insertText", false, text);
}

// ─── Enter key: split paragraph ────────────────────────────────────────────

function handleEnterKey() {
  if (!splitFn || !activeEl || !activePath) return;

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  const range = sel.getRangeAt(0);

  // Create two ranges: before cursor and after cursor
  const beforeRange = document.createRange();
  beforeRange.setStart(activeEl, 0);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  const afterRange = document.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.setEnd(activeEl, activeEl.childNodes.length);

  // Extract content from both ranges
  const beforeFrag = beforeRange.cloneContents();
  const afterFrag = afterRange.cloneContents();

  const beforeChildren = fragmentToJsonsx(beforeFrag);
  const afterChildren = fragmentToJsonsx(afterFrag);

  // Stop editing before mutating state (which will re-render)
  const path = [...activePath];
  activeEl.contentEditable = "false";
  activeEl.removeEventListener("keydown", handleKeydown);
  activeEl.removeEventListener("input", handleInput);
  activeEl.removeEventListener("blur", handleBlur);
  activeEl.removeEventListener("paste", handlePaste);
  activeEl = null;

  splitFn(path, beforeChildren, afterChildren);
}

// ─── Content sync: DOM → Jx ────────────────────────────────────────────

function commitChanges() {
  if (!commitFn || !activeEl || !activePath) return;

  normalizeInlineContent(activeEl);
  const result = elementToJsonsx(activeEl);
  commitFn(activePath, result.children ?? null, result.textContent ?? null);
}

/**
 * Convert a contenteditable element's content to Jx children/textContent.
 * Returns { textContent } for plain text or { children } for rich content.
 * @param {HTMLElement} el
 * @returns {{ textContent?: string | null, children?: any[] }}
 */
function elementToJsonsx(el) {
  const nodes = el.childNodes;

  // If just a single text node, use textContent
  if (nodes.length === 0) return { textContent: "" };
  if (nodes.length === 1 && nodes[0].nodeType === Node.TEXT_NODE) {
    return { textContent: nodes[0].textContent };
  }

  // Mixed content → children array
  /** @type {any[]} */
  const children = [];
  for (const child of nodes) {
    const jsx = domNodeToJsonsx(child);
    if (jsx) children.push(jsx);
  }

  // If all children are plain text spans (no formatting, no attributes),
  // collapse them into a single textContent
  const allPlainText = children.every(
    (/** @type {any} */ c) => c.tagName === "span" && c.textContent != null && !c.children && !c.attributes && !c.style
  );
  if (allPlainText) {
    return { textContent: children.map((/** @type {any} */ c) => c.textContent).join("") };
  }

  return { children };
}

/**
 * Convert a DOM node to a Jx element definition.
 * @param {Node} node
 * @returns {any}
 */
function domNodeToJsonsx(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    if (!text) return null;
    return { tagName: "span", textContent: text };
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = /** @type {HTMLElement} */ (node);
  const tag = el.tagName.toLowerCase();
  /** @type {Record<string, any>} */
  const result = { tagName: tag };

  // Map browser execCommand output to our tag conventions
  /** @type {Record<string, string>} */
  const tagMap = { b: "strong", i: "em", s: "del", strike: "del" };
  if (tagMap[tag]) result.tagName = tagMap[tag];

  // Attributes
  if (tag === "a" && /** @type {HTMLAnchorElement} */ (el).href) {
    result.attributes = { href: el.getAttribute("href") };
    if (/** @type {HTMLAnchorElement} */ (el).title) result.attributes.title = /** @type {HTMLAnchorElement} */ (el).title;
  }
  if (tag === "code") {
    result.textContent = el.textContent;
    return result;
  }

  // Recurse children
  const childNodes = el.childNodes;
  if (childNodes.length === 0) {
    result.textContent = "";
  } else if (childNodes.length === 1 && childNodes[0].nodeType === Node.TEXT_NODE) {
    result.textContent = childNodes[0].textContent;
  } else {
    result.children = [];
    for (const child of childNodes) {
      const jsx = domNodeToJsonsx(child);
      if (jsx) result.children.push(jsx);
    }
  }

  return result;
}

/**
 * Convert a DocumentFragment to a Jx-compatible structure.
 * Returns { textContent } or { children }.
 * @param {DocumentFragment} frag
 * @returns {{ textContent?: string | null, children?: any[] }}
 */
function fragmentToJsonsx(frag) {
  const nodes = frag.childNodes;
  if (nodes.length === 0) return { textContent: "" };
  if (nodes.length === 1 && nodes[0].nodeType === Node.TEXT_NODE) {
    return { textContent: nodes[0].textContent };
  }

  /** @type {any[]} */
  const children = [];
  for (const child of nodes) {
    const jsx = domNodeToJsonsx(child);
    if (jsx) children.push(jsx);
  }

  if (children.length === 1 && children[0].tagName === "span" && children[0].textContent != null) {
    return { textContent: children[0].textContent };
  }

  return children.length > 0 ? { children } : { textContent: "" };
}

// ─── Rich text helpers ─────────────────────────────────────────────────────

/**
 * @param {Range} range
 * @returns {string}
 */
function getTextBeforeCursor(range) {
  const preRange = document.createRange();
  preRange.setStart(/** @type {Node} */ (activeEl), 0);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString();
}

// ─── Slash command menu ────────────────────────────────────────────────────

/** Default slash command items */
const SLASH_COMMANDS = [
  { label: "Heading 1", tag: "h1", icon: "H1", description: "Large heading" },
  { label: "Heading 2", tag: "h2", icon: "H2", description: "Medium heading" },
  { label: "Heading 3", tag: "h3", icon: "H3", description: "Small heading" },
  { label: "Paragraph", tag: "p", icon: "P", description: "Plain text" },
  { label: "Bulleted List", tag: "ul", icon: "\u2022", description: "Unordered list" },
  { label: "Numbered List", tag: "ol", icon: "1.", description: "Ordered list" },
  { label: "Blockquote", tag: "blockquote", icon: '"', description: "Quote block" },
  { label: "Code Block", tag: "pre", icon: "<>", description: "Fenced code" },
  { label: "Image", tag: "img", icon: "\uD83D\uDDBC", description: "Insert image" },
  { label: "Horizontal Rule", tag: "hr", icon: "\u2014", description: "Divider line" },
  { label: "Table", tag: "table", icon: "\u229E", description: "Insert table" },
];

/** Project-level component commands — populated externally
 * @type {Array<{ label: string, tag: string, description: string }>}
 */
let projectComponents = [];

/**
 * Set available project components for the slash menu.
 * @param {Array<{ label: string, tag: string, description: string }>} components
 */
export function setProjectComponents(components) {
  projectComponents = components;
}

function showSlashMenu() {
  dismissSlashMenu();

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  slashMenuEl = document.createElement("sp-popover");
  const slashMenuInner = document.createElement("sp-menu");
  slashMenuEl.appendChild(slashMenuInner);
  slashMenuEl._menuInner = slashMenuInner;
  slashMenuEl.style.position = "fixed";
  slashMenuEl.style.left = `${rect.left}px`;
  slashMenuEl.style.top = `${rect.bottom + 4}px`;
  slashMenuEl.tabIndex = -1;

  renderSlashItems("");
  document.body.appendChild(slashMenuEl);
  slashMenuEl.setAttribute("open", "");

  // Track filter text after the /
  slashMenuEl._filterStart = getTextBeforeCursor(range).length;
}

function updateSlashMenu() {
  if (!slashMenuEl || !activeEl) return;

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    dismissSlashMenu();
    return;
  }

  const range = sel.getRangeAt(0);
  const fullText = getTextBeforeCursor(range);

  // Find the position of the last /
  const slashIdx = fullText.lastIndexOf("/");
  if (slashIdx < 0) {
    dismissSlashMenu();
    return;
  }

  const filter = fullText.slice(slashIdx + 1).toLowerCase();

  // If user backspaced past the /, dismiss
  if (fullText.length < (slashMenuEl._filterStart || 0) - 1) {
    dismissSlashMenu();
    return;
  }

  renderSlashItems(filter);

  // If no items match, dismiss
  if (slashMenuEl._menuInner.children.length === 0) {
    dismissSlashMenu();
  }
}

/**
 * @param {string} filter
 */
function renderSlashItems(filter) {
  if (!slashMenuEl) return;
  const menuInner = slashMenuEl._menuInner;
  menuInner.innerHTML = "";

  const allItems = [
    ...SLASH_COMMANDS,
    ...projectComponents.map((/** @type {any} */ c) => ({
      ...c,
      icon: "\u25C6",
      isComponent: true,
    })),
  ];

  const items = filter
    ? allItems.filter(
        (/** @type {any} */ i) => i.label.toLowerCase().includes(filter) || i.tag.toLowerCase().includes(filter),
      )
    : allItems;

  let activeIdx = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const row = document.createElement("sp-menu-item");
    if (i === 0) row.setAttribute("selected", "");

    const icon = document.createElement("span");
    icon.slot = "icon";
    icon.textContent = item.icon;
    row.appendChild(icon);

    row.textContent = item.label;
    // Re-append icon since textContent cleared it
    row.prepend(icon);
    if (item.description) {
      const desc = document.createElement("span");
      desc.slot = "description";
      desc.textContent = item.description;
      row.appendChild(desc);
    }

    row.addEventListener("mouseenter", () => {
      for (const r of menuInner.querySelectorAll("sp-menu-item")) r.removeAttribute("selected");
      row.setAttribute("selected", "");
      activeIdx = i;
    });

    row.addEventListener("click", (/** @type {Event} */ e) => {
      e.preventDefault();
      e.stopPropagation();
      selectSlashItem(item);
    });

    menuInner.appendChild(row);
  }

  // Keyboard navigation within the menu
  if (!slashMenuEl._keyHandler) {
    slashMenuEl._keyHandler = (/** @type {KeyboardEvent} */ e) => {
      if (!slashMenuEl) return;
      const rows = menuInner.querySelectorAll("sp-menu-item");
      if (!rows.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        rows[activeIdx]?.removeAttribute("selected");
        activeIdx = (activeIdx + 1) % rows.length;
        rows[activeIdx]?.setAttribute("selected", "");
        rows[activeIdx]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        rows[activeIdx]?.removeAttribute("selected");
        activeIdx = (activeIdx - 1 + rows.length) % rows.length;
        rows[activeIdx]?.setAttribute("selected", "");
        rows[activeIdx]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const match = items[activeIdx];
        if (match) selectSlashItem(match);
      } else if (e.key === "Escape") {
        e.preventDefault();
        dismissSlashMenu();
      }
    };
    activeEl?.addEventListener("keydown", slashMenuEl._keyHandler);
  }
}

/**
 * @param {any} item
 */
function selectSlashItem(item) {
  if (!activeEl || !insertFn || !activePath) return;

  // Remove the /command text from the element
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    const fullText = getTextBeforeCursor(range);
    const slashIdx = fullText.lastIndexOf("/");
    if (slashIdx >= 0) {
      // Delete from slash position to cursor
      const preRange = document.createRange();
      preRange.setStart(activeEl, 0);
      preRange.setEnd(range.startContainer, range.startOffset);

      // Walk to find the text node and offset of the slash
      const walker = document.createTreeWalker(activeEl, NodeFilter.SHOW_TEXT);
      let charCount = 0;
      /** @type {Text | null} */
      let slashNode = null;
      let slashOffset = 0;
      while (walker.nextNode()) {
        const node = /** @type {Text} */ (walker.currentNode);
        if (charCount + node.length > slashIdx) {
          slashNode = node;
          slashOffset = slashIdx - charCount;
          break;
        }
        charCount += node.length;
      }

      if (slashNode) {
        const delRange = document.createRange();
        delRange.setStart(slashNode, slashOffset);
        delRange.setEnd(range.startContainer, range.startOffset);
        delRange.deleteContents();
      }
    }
  }

  // Commit current content before inserting
  commitChanges();
  dismissSlashMenu();

  // Build the element definition to insert
  const def = buildDefaultForTag(item.tag);

  const path = [...activePath];
  activeEl.contentEditable = "false";
  activeEl.removeEventListener("keydown", handleKeydown);
  activeEl.removeEventListener("input", handleInput);
  activeEl.removeEventListener("blur", handleBlur);
  activeEl.removeEventListener("paste", handlePaste);
  activeEl = null;

  insertFn(path, def);
}

function dismissSlashMenu() {
  if (!slashMenuEl) return;
  if (slashMenuEl._keyHandler && activeEl) {
    activeEl.removeEventListener("keydown", slashMenuEl._keyHandler);
  }
  slashMenuEl.remove();
  slashMenuEl = null;
}

/**
 * Build a default Jx element definition for a given tag.
 * @param {string} tag
 * @returns {any}
 */
function buildDefaultForTag(tag) {
  switch (tag) {
    case "h1":
      return { tagName: "h1", textContent: "Heading" };
    case "h2":
      return { tagName: "h2", textContent: "Heading" };
    case "h3":
      return { tagName: "h3", textContent: "Heading" };
    case "h4":
      return { tagName: "h4", textContent: "Heading" };
    case "h5":
      return { tagName: "h5", textContent: "Heading" };
    case "h6":
      return { tagName: "h6", textContent: "Heading" };
    case "p":
      return { tagName: "p", textContent: "" };
    case "ul":
      return { tagName: "ul", children: [{ tagName: "li", textContent: "Item" }] };
    case "ol":
      return { tagName: "ol", children: [{ tagName: "li", textContent: "Item" }] };
    case "blockquote":
      return { tagName: "blockquote", children: [{ tagName: "p", textContent: "Quote" }] };
    case "pre":
      return { tagName: "pre", children: [{ tagName: "code", textContent: "" }] };
    case "hr":
      return { tagName: "hr" };
    case "img":
      return { tagName: "img", attributes: { src: "", alt: "Image" } };
    case "table":
      return {
        tagName: "table",
        children: [
          {
            tagName: "thead",
            children: [{ tagName: "tr", children: [{ tagName: "th", textContent: "Header" }] }],
          },
          {
            tagName: "tbody",
            children: [{ tagName: "tr", children: [{ tagName: "td", textContent: "Cell" }] }],
          },
        ],
      };
    default:
      // Custom component / directive
      return { tagName: tag, textContent: "" };
  }
}
