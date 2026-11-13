/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * Inline-edit.js — Contenteditable inline editing for content mode
 *
 * Manages the lifecycle of editing text-bearing block elements directly on the canvas. Handles rich
 * text formatting, Enter for new paragraphs, and slash commands for inserting elements.
 */

import {
  displayTagName,
  isNonNullObject,
  isString,
  templateExpressions,
} from "@jxsuite/schema/guards";
import { normalizeInlineContent } from "./inline-format";
import { execEditingCommand } from "./inline-link";
import { isWholeTemplate, sameContent } from "./content-slice";
import { keptNodeOf } from "./kept-node";
import { ELEMENT_DEFS, isEditableTag } from "./editable-tags";
import { chipSourcesBetween, snapRangeOutOfChips } from "../canvas/iframe-chips";
import { offsetOf } from "../canvas/iframe-position";
import {
  escapeTemplateText,
  TAG_ATTR,
  TAG_MEMBER_ATTR,
  TAG_REF_ATTR,
  TEXT_ATTR,
  unescapeTemplateText,
} from "../utils/edit-display";
import type { EditableVerdicts } from "./editable-tags";
import type { JxPath } from "../state";
import type { JsonPrimitive, JxMutableNode } from "@jxsuite/schema/types";

/**
 * The slash-menu surface inline editing drives. Injected (rather than imported) so this module
 * stays free of the menu's heavy `lit-html` / `ui/layers` dependencies — the editor realm wires the
 * real menu, the canvas iframe supplies its own (or a no-op) without bloating the slim iframe
 * bundle.
 */
/** What a slash menu is opened with: the pick handler, and how the list is filtered and sourced. */
export interface SlashMenuOptions {
  onSelect: (cmd: SlashCommand) => void;
  showFilter?: boolean;
  commands?: SlashCommand[];
}

export interface SlashController {
  show: (anchorEl: HTMLElement, filter: string, cbs: SlashMenuOptions) => void;
  dismiss: () => void;
  isOpen: () => boolean;
}

const noopSlash: SlashController = {
  dismiss: () => {
    // No slash controller wired in this realm.
  },
  isOpen: () => false,
  show: () => {
    // No slash controller wired in this realm.
  },
};
let slash: SlashController = noopSlash;

/** Inject the slash-menu controller inline editing should drive (call once at realm init). */
export function setSlashController(controller: SlashController): void {
  slash = controller;
}

export interface InlineAction {
  tag: string;
  label: string;
  /**
   * REMOVED from the data, for the same reason `shortcut` below was, and the field stays only so an
   * older `elements-meta.json` still parses.
   *
   * It held an `sp-icon-*` name — a SECOND definition site for a glyph the `format.*` command
   * record already carries (`panels/block-action-bar.ts`, kit keys like `text-b` and
   * `text-italic`), and one that named a Spectrum element rather than a key in the kit's manifest.
   * The bar draws `toolOf(registry, command, …)`, so this was never read: `$inlineActions` says
   * WHICH of the eight verbs a tag accepts and in what order, and the record says what each one
   * looks like. Nothing reads this.
   */
  icon?: string;
  command?: string;
  /**
   * REMOVED from the data, and the field stays only so an older `elements-meta.json` still parses.
   *
   * It held `"Cmd+B"` — a mac spelling, printed verbatim into every tooltip on every platform,
   * which is the hardcoded-chord defect §13.3 exists to kill. The chord now lives on the `format.*`
   * record (`panels/block-action-bar.ts`) and is formatted by the keymap's one formatter. Nothing
   * reads this.
   */
  shortcut?: string;
}

export interface SlashCommand {
  label: string;
  tag: string;
  description: string;
  /**
   * The heading the offer is listed under. Absent for the HTML elements, which are the menu's
   * first, unheaded group; `"Components"` for the project's components (§5.7).
   */
  group?: string;
  /**
   * Whether `tag` names a project component: the pick inserts `buildComponentInstance` and imports
   * the component (`editor/insert-component.ts`) rather than an element's default definition.
   */
  component?: boolean;
}

export interface JxContentResult {
  textContent?: string | null;
  children?: (JxMutableNode | string)[];
}

// ─── Inline tag set (tags that represent rich text formatting) ─────────────

/** Fallback set — used when parent context is unknown */
const INLINE_TAGS = new Set([
  "em",
  "strong",
  "del",
  "code",
  "a",
  "span",
  "br",
  "img",
  "b",
  "i",
  "u",
  "sub",
  "sup",
  "s",
]);

// ─── Context-aware inline scoping ─────────────────────────────────────────

/**
 * Check if a child tag is inline within the context of a given parent tag. Uses $inlineChildren
 * from elements-meta.json.
 *
 * @param {string} childTag
 * @param {string} parentTag
 * @returns {boolean}
 */
export function isInlineInContext(childTag: string, parentTag: string) {
  if (!parentTag) {
    return INLINE_TAGS.has(childTag);
  }
  const parentDef = ELEMENT_DEFS[parentTag];
  if (!parentDef || !parentDef.$inlineChildren) {
    return false;
  }
  return parentDef.$inlineChildren.includes(childTag);
}

/**
 * Get the resolved $inlineActions for a given element tag. Follows string references (e.g., "h1" →
 * look up h1's actions).
 *
 * @param {string} tag
 * @returns {InlineAction[] | null}
 */
export function getInlineActions(tag: string) {
  const def = ELEMENT_DEFS[tag];
  if (!def) {
    return null;
  }
  let actions = def.$inlineActions;
  if (isString(actions)) {
    const refDef = ELEMENT_DEFS[actions];
    actions = refDef?.$inlineActions ?? undefined;
  }
  if (!Array.isArray(actions)) {
    return null;
  }
  return actions;
}

// ─── Editing state ─────────────────────────────────────────────────────────

let activeEl: HTMLElement | null = null; // Currently contenteditable element
let activePath: JxPath | null = null; // JSON path to the active element
/**
 * @type {((
 *       path: JxPath,
 *       children: (JxMutableNode | string)[] | null,
 *       textContent: string | null,
 *     ) => void)
 *   | null}
 */
let commitFn:
  | ((
      path: JxPath,
      children: (JxMutableNode | string)[] | null,
      textContent: string | null,
      inPlace: boolean,
    ) => void)
  | null = null; // Function(path, newChildren, newTextContent, inPlace) to commit changes
/**
 * @type {((path: JxPath, beforeChildren: JxContentResult, afterChildren: JxContentResult) => void)
 *   | null}
 */
let splitFn:
  | ((
      path: JxPath,
      beforeChildren: JxContentResult,
      afterChildren: JxContentResult,
      removedTags: string[],
    ) => void)
  | null = null; // Function(path, beforeChildren, afterChildren) to split paragraph
/**
 * @type {((path: JxPath, elementDef: SlashCommand, commitData?: JxContentResult) => void)
 *   | null}
 */
let insertFn:
  | ((path: JxPath, elementDef: SlashCommand, commitData?: JxContentResult) => void)
  | null = null; // Function(path, elementDef, commitData?) to insert after current block
let endFn: (() => void) | null = null; // Function() called when editing stops

/**
 * Plain (plaintext-only) session state — used for prop-bound text, where the committed value is a
 * plain string (a directive attribute), so rich formatting, Enter-split, and the slash menu are all
 * disabled: Enter commits, Escape restores `_plainOriginal`.
 *
 * Escape is a genuine cancel, and `_plainPosted` is what makes it one. Restoring the text is not
 * enough on its own: if an idle tick already wrote during the session, the document holds the typed
 * value and the restored text must be written back over it. Conversely a session that never posted
 * and ends matching its original must write NOTHING — the host's "unchanged value" guard cannot be
 * relied on for that, because it compares against the STORED prop and an unset prop's stored value
 * is `undefined` while the marker renders the definition's default.
 */
let _plainMode = false;
let _plainOriginal = "";
/** Whether this plain session has posted a commit — see the note above on Escape. */
let _plainPosted = false;

/**
 * The live document's format overrides for which tags hold a caret. Injected per render (the same
 * shape as `setSlashController`), because the answer depends on the document's format class — a
 * `.md` page and a native `.json` component have different vocabularies.
 */
let editableVerdicts: EditableVerdicts = null;

/** Adopt the format's per-tag caret verdicts for the live render (null = built-in metadata only). */
export function setEditableVerdicts(verdicts: EditableVerdicts): void {
  editableVerdicts = verdicts;
}

/**
 * Whether an element can hold a text caret.
 *
 * Derived from the document's element vocabulary rather than a hand-maintained list — see
 * {@link file://./editable-tags.ts}.
 */
export function isEditableBlock(el: HTMLElement) {
  /* Closed explicitly, whatever its tag. Edit mode closes every element whose content is a value
     rather than the author's text (`prepareForEditMode`: computed children, bound `innerHTML`, a
     `{ "$ref" }` text), because a caret there would commit the value as the element's content when
     it leaves, and the binding is gone without a key being pressed. */
  return (
    el.getAttribute("contenteditable") !== "false" && isEditableTag(el.tagName, editableVerdicts)
  );
}

/**
 * Whether `el` is INLINE CONTENT of the block around it rather than a block of its own: its parent
 * can hold a caret and accepts its tag inline (a link or a `<span>` in a paragraph).
 *
 * Such an element is stamped and can hold a caret, so the caret's "block" may be one, and it is in
 * the canvas's list of blocks. But document order among BLOCKS skips it: the block before a
 * paragraph is the paragraph before it, not the link that paragraph ends with, and a selection that
 * ends in the next paragraph has no block "between" its ends when the first one holds a link.
 */
export function isInlineOfBlock(el: HTMLElement): boolean {
  const parent = el.parentElement;
  return (
    parent !== null &&
    isEditableTag(parent.tagName, editableVerdicts) &&
    isInlineInContext(el.tagName.toLowerCase(), parent.tagName.toLowerCase())
  );
}

/**
 * The formatting marks: a way some of a block's text is written, with nothing of their own for an
 * author to address. A link, an image and a `<span>` are inline too and are not marks: each holds
 * something the Inspector edits (a URL, a source, a class).
 */
const TEXT_MARK_TAGS = new Set(["B", "CODE", "DEL", "EM", "I", "S", "STRONG", "SUB", "SUP", "U"]);

/**
 * Whether `el` is a formatting mark in a block's text ({@link isInlineOfBlock}). A press or a hover
 * on one addresses the block: selected on its own, bold text was a box inside its paragraph with a
 * Delete of its own, where the author meant the paragraph (studio.md §4.4).
 */
export function isTextMark(el: HTMLElement): boolean {
  return TEXT_MARK_TAGS.has(el.tagName) && isInlineOfBlock(el);
}

/**
 * Check if a node is an inline child. When parentNode is provided, uses context-aware scoping from
 * metadata. Without parent, uses the fallback INLINE_TAGS set.
 *
 * @param {JxMutableNode | JsonPrimitive} node A document child entry; a text or other scalar child
 *   is never an inline element.
 * @param {JxMutableNode} [parentNode]
 * @returns {boolean}
 */
export function isInlineElement(node: JxMutableNode | JsonPrimitive, parentNode?: JxMutableNode) {
  if (!isNonNullObject(node)) {
    return false;
  }
  const childTag = (displayTagName(node.tagName) || "div").toLowerCase();
  if (parentNode) {
    const parentTag = (displayTagName(parentNode.tagName) || "div").toLowerCase();
    return isInlineInContext(childTag, parentTag);
  }
  return INLINE_TAGS.has(childTag);
}

/**
 * Start inline editing on a canvas element.
 *
 * @param {HTMLElement} el - The canvas DOM element to edit
 * @param {JxPath} path - JSON path to the element
 * @param {{
 *   onCommit: (
 *     path: JxPath,
 *     children: (JxMutableNode | string)[] | null,
 *     textContent: string | null,
 *   ) => void;
 *   onSplit: (
 *     path: JxPath,
 *     beforeChildren: JxContentResult,
 *     afterChildren: JxContentResult,
 *   ) => void;
 *   onInsert: (path: JxPath, elementDef: SlashCommand, commitData?: JxContentResult) => void;
 *   onEnd: () => void;
 * }} callbacks
 * @param {{ plainText?: boolean }} [opts] - `plainText` runs a plaintext-only session (prop-bound
 *   text: no rich formatting/split/slash; Enter commits, Escape cancels)
 */
export function startEditing(
  el: HTMLElement,
  path: JxPath,
  callbacks: {
    onCommit: (
      path: JxPath,
      children: (JxMutableNode | string)[] | null,
      textContent: string | null,
      inPlace: boolean,
    ) => void;
    /** `removedTags` is what each chip the split's selection covered stood for (`chipKey`). */
    onSplit: (
      path: JxPath,
      beforeChildren: JxContentResult,
      afterChildren: JxContentResult,
      removedTags: string[],
    ) => void;
    onInsert: (path: JxPath, elementDef: SlashCommand, commitData?: JxContentResult) => void;
    onEnd: () => void;
  },
  opts?: { plainText?: boolean },
) {
  if (activeEl) {
    // Re-enter (e.g. after a split/insert re-render): tear the old session down WITHOUT firing the
    // User-visible `onEnd` — a re-enter must not reset the parent toolbar via a stray `editEnd`.
    stopEditing(true);
  }

  activeEl = el;
  activePath = path;
  commitFn = callbacks.onCommit;
  splitFn = callbacks.onSplit;
  insertFn = callbacks.onInsert;
  endFn = callbacks.onEnd;
  _plainMode = opts?.plainText === true;
  _plainOriginal = _plainMode ? el.textContent : "";
  _plainPosted = false;

  // Mark the caret's block so the empty-block slash hint can target it. The editing host itself is
  // The canvas container (see syncEditableRoot) — activating a block does NOT make it a separate
  // Contenteditable, which is exactly what lets the caret cross block boundaries natively.
  //
  // A prop-bound block is the one exception: it lives inside a `contenteditable="false"` component
  // Island, so it needs its own nested editing host to be reachable at all.
  el.dataset.jxActiveBlock = "";
  if (_plainMode) {
    try {
      el.contentEditable = "plaintext-only";
    } catch {
      // Engines without plaintext-only support throw on assignment; paste is already plain via
      // HandlePaste, and the keydown plain branch inertifies the format shortcuts.
      el.contentEditable = "true";
    }
    el.focus();
  }

  // The caret is NOT moved here. It is already wherever the user clicked or arrowed to — moving it
  // To the end of the block (as this used to) is precisely what made editing feel modal.

  el.addEventListener("keydown", handleKeydown);
  el.addEventListener("input", handleInput);
  el.addEventListener("paste", handlePaste);
}

/**
 * Stop editing and commit changes. Pass `silent` to skip the `onEnd` callback (used by the re-enter
 * path so a stop→start sequence doesn't post a user-visible `editEnd`).
 *
 * @param {boolean} [silent]
 */
export function stopEditing(silent = false) {
  if (!activeEl) {
    return;
  }

  commitChanges(false);
  slash.dismiss();

  delete activeEl.dataset.jxActiveBlock;
  // Only a prop-bound block ever claimed its own editing host; page blocks are edited through the
  // Container's, which must stay editable after the caret leaves this block.
  if (_plainMode) {
    activeEl.contentEditable = "false";
  }

  activeEl.removeEventListener("keydown", handleKeydown);
  activeEl.removeEventListener("input", handleInput);
  activeEl.removeEventListener("paste", handlePaste);

  activeEl = null;
  activePath = null;
  commitFn = null;
  splitFn = null;
  insertFn = null;
  _plainMode = false;
  _plainOriginal = "";
  _plainPosted = false;

  if (silent) {
    endFn = null;
  } else if (endFn) {
    const fn = endFn;
    endFn = null;
    fn();
  }
}

/**
 * Commit the active block's content to the document WITHOUT releasing it.
 *
 * The idle-tick counterpart to {@link stopEditing}: the caret stays exactly where it is and the
 * block stays active, so typing continues uninterrupted while the document keeps up. Callers are
 * responsible for preserving the caret across the DOM normalization this performs — the editing
 * host does that in model coordinates (see `commitTick`).
 *
 * A no-op when nothing is active, and the apply side no-ops an unchanged value, so calling this on
 * every pause is cheap.
 */
export function commitActiveBlock(): void {
  commitChanges(true);
}

/**
 * Whether the active block shows exactly what `node` holds: nothing has been typed into it that the
 * document has not been given. False for a plain session, whose content is a prop's value and not a
 * block's, and when nothing is active.
 */
export function activeBlockHolds(node: JxMutableNode | null | undefined): boolean {
  if (!activeEl || _plainMode || !node) {
    return false;
  }
  normalizeInlineContent(activeEl);
  return sameContent(node, serializeContent(activeEl));
}

/**
 * End the session WITHOUT committing, firing `onEnd`: for a block the document is about to redraw
 * whose content the document already holds ({@link activeBlockHolds}).
 *
 * Committing on the way out is right when the block holds typing the document has not seen, and
 * wrong when it does not: the patch that is about to land may be an undo of this very block, and a
 * commit of what the block still shows would write the undone text straight back.
 */
export function abandonEditing(): void {
  releaseWithoutCommit();
}

/**
 * Whether the live session is PLAIN — a prop value rather than a block of the document.
 *
 * Exported because the format bridge is in another module and `_plainMode` is file-local, so
 * `applyFormatIntent` could not even ask: a ⌘B forwarded out to the parent came back as an
 * `applyFormat` intent and ran `toggleInlineFormat` on a `plaintext-only` host, wrapping the prop's
 * text in a `<strong>` that its next commit then flattened away — losing nothing visible, but
 * mutating the DOM under a session whose whole contract is that it holds one plain string.
 */
export function isPlainSession(): boolean {
  return _plainMode && activeEl !== null;
}

/**
 * Whether inline editing is currently active.
 *
 * @returns {boolean}
 */
export function isEditing() {
  return activeEl !== null;
}

/**
 * Get the currently editing element.
 *
 * @returns {HTMLElement | null}
 */
export function getActiveElement() {
  return activeEl;
}

/**
 * Get the document path of the currently editing element (null when no session is live).
 *
 * @returns {JxPath | null}
 */
export function getActivePath() {
  return activePath;
}

/**
 * Whether the DI'd slash menu reports itself open — session-lifecycle guards must not commit-and-
 * end on a pointerdown that is really a slash-menu interaction.
 *
 * @returns {boolean}
 */
export function isSlashActive() {
  return slash.isOpen();
}

// ─── Event handlers ────────────────────────────────────────────────────────

/** @param {KeyboardEvent} e */
function handleKeydown(e: KeyboardEvent) {
  if (_plainMode) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (activeEl) {
        /* Cancel: restore the original text. `commitChanges` then posts it ONLY if this session had
           already written (an idle tick), which is what makes Escape undo the tick instead of
           leaving it standing — and what stops a bare Escape from writing anything at all. */
        activeEl.textContent = _plainOriginal;
      }
      stopEditing();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      stopEditing();
      return;
    }
    // Inertify the browser's native rich shortcuts for the contentEditable="true" fallback.
    if ((e.ctrlKey || e.metaKey) && ["b", "i", "u", "`"].includes(e.key)) {
      e.preventDefault();
    }
  }

  // Escape and Enter are NOT handled here. Enter arrives as a `beforeinput` (`insertParagraph`),
  // Which is the one place structural intent is classified; Escape belongs to the editing host,
  // Which owns dismissing the caret. See {@link file://../canvas/iframe-editable-root.ts}.
  //
  // Neither is the "/" gesture, and neither are the format chords. Both used to be here, and
  // Both were DEAD: this listener is attached to the BLOCK, and for an ordinary block the editing
  // Host is the canvas container (see {@link startEditing}), so the focused element — and every
  // Keydown's target — is the container, never a descendant of it. The "/" trigger is
  // {@link handleSlashTrigger}, driven from the host; the format chords are `format.*` records
  // Whose chords the frame forwards (`canvas/iframe-keys.ts`). A revived copy here would have
  // Toggled bold twice per press.
}

function handleInput() {
  // Check if slash menu should update or dismiss
  if (slash.isOpen()) {
    refreshSlashMenu();
  }
}

/** @param {ClipboardEvent} e */
function handlePaste(e: ClipboardEvent) {
  e.preventDefault();
  // Paste as plain text to avoid foreign HTML
  const text = e.clipboardData?.getData("text/plain") ?? "";
  execEditingCommand("insertText", text);
}

// ─── Enter: split the active block ─────────────────────────────────────────

/**
 * Split the active block at the caret, reporting the two halves through `onSplit`.
 *
 * Called from the editing host's `beforeinput` chokepoint (`insertParagraph`), never from a keydown
 * — Enter is a structural intent, and `beforeinput` is the one place those are recognised.
 *
 * A non-collapsed selection INSIDE the block is dropped by construction: the "before" half ends at
 * the selection's start and the "after" half begins at its end. A selection spanning two blocks is
 * the caller's to reject (the `after` range could not be built against this block).
 *
 * The active block is released WITHOUT committing — the split writes both halves itself, and a
 * commit racing it would re-apply the pre-split text over the first one. Returns false when there
 * is nothing to split.
 */
export function splitActiveBlock(): boolean {
  if (!splitFn || !activeEl || !activePath) {
    return false;
  }

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    return false;
  }

  // A copy: the ends are moved below, and the live selection is the author's to keep.
  const range = sel.getRangeAt(0).cloneRange();

  /* A chip is one unit, so a selection end inside one is moved to its edge: a split with the caret
     in a chip's text otherwise cut the chip in two and left its binding in both halves. And the
     chips a selection covers go with the selection the split drops, which is the author's deletion,
     so they are reported as one: unreported, the split was refused for losing a binding the author
     had selected and replaced. */
  snapRangeOutOfChips(activeEl, range);
  const from = offsetOf(activeEl, range.startContainer, range.startOffset);
  const to = offsetOf(activeEl, range.endContainer, range.endOffset);
  const removed =
    range.collapsed || from === null || to === null ? [] : chipSourcesBetween(activeEl, from, to);

  const beforeRange = document.createRange();
  beforeRange.setStart(activeEl, 0);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  const afterRange = document.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.setEnd(activeEl, activeEl.childNodes.length);

  const beforeChildren = fragmentToJx(beforeRange.cloneContents());
  const afterChildren = fragmentToJx(afterRange.cloneContents());

  const path = [...activePath];
  const split = splitFn;

  releaseWithoutCommit();
  split(path, beforeChildren, afterChildren, removed);
  return true;
}

/**
 * Drop the active block's bookkeeping without committing it, firing `onEnd`. Used by the paths that
 * write the block's content themselves (split, slash-insert) — a commit afterwards would clobber
 * what they just wrote.
 */
function releaseWithoutCommit(): void {
  if (!activeEl) {
    return;
  }
  delete activeEl.dataset.jxActiveBlock;
  if (_plainMode) {
    activeEl.contentEditable = "false";
  }
  activeEl.removeEventListener("keydown", handleKeydown);
  activeEl.removeEventListener("input", handleInput);
  activeEl.removeEventListener("paste", handlePaste);
  activeEl = null;
  activePath = null;
  commitFn = null;
  splitFn = null;
  insertFn = null;
  _plainMode = false;
  _plainOriginal = "";
  _plainPosted = false;

  if (endFn) {
    const fn = endFn;
    endFn = null;
    fn();
  }
}

// ─── Content sync: DOM → Jx ────────────────────────────────────────────

/**
 * Serialize the active block and hand it to `onCommit`.
 *
 * `inPlace` distinguishes the idle tick (the caret is still in this block) from a release. The
 * parent uses it to suppress the DOM half of the echoed patch, so a commit mid-typing cannot
 * re-render the subtree the caret lives in.
 */
function commitChanges(inPlace: boolean) {
  if (!commitFn || !activeEl || !activePath) {
    return;
  }

  if (_plainMode) {
    // A prop value is a plain single-line string (a directive attribute) — flatten any newline
    // That survived plaintext editing and skip the rich DOM→Jx serialization entirely.
    const text = activeEl.textContent.replaceAll("\n", " ");
    /*
     * A SESSION THAT CHANGED NOTHING MUST WRITE NOTHING.
     *
     * This branch used to post unconditionally, and the only guard was the host's
     * "same value, do nothing" check against the STORED prop — which does not fire when the prop is
     * unset, because the marker renders the DEFINITION's default and the stored value is
     * `undefined`. So merely clicking a component's text and clicking away wrote
     * `$props.<name> = "<the default>"`: the tab went dirty, an undo entry appeared, and that
     * instance was silently detached from its definition forever. Escape did the same thing, which
     * made "cancel" a way to modify the document.
     *
     * `_plainPosted` is what keeps Escape honest AFTER an idle tick has already written: the
     * restored text equals the original, but something WAS written, so it must be written back.
     */
    if (text === _plainOriginal.replaceAll("\n", " ") && !_plainPosted) {
      return;
    }
    _plainPosted = true;
    commitFn(activePath, null, text, inPlace);
    return;
  }

  /* A block that is no longer in the document is not the block the document holds: a patch
     replaced it (an undo, a co-author's edit, a refused commit's redraw), and what it shows is
     what the document held BEFORE that. Writing it would silently put the undone text back. */
  if (!activeEl.isConnected) {
    return;
  }

  normalizeInlineContent(activeEl);
  const state: SerializeState = { respelled: false };
  const result = nodesToContent(activeEl, state);
  // Text stored differently from how it is shown is drawn again from the document: not in place.
  commitFn(
    activePath,
    result.children ?? null,
    result.textContent ?? null,
    inPlace && !state.respelled,
  );
}

// ─── Pieces: what a block's content is made of, read off the canvas ─────────

/**
 * One thing an element's content holds, as the serializer reads it (studio.md §4.5, §8.2.7).
 *
 * - `plain` is the author's text: a text node, stored as it is seen.
 * - `template` is one `${…}` of a templated string: a chip's expression, written verbatim.
 * - `literal` is a literal run of a templated string that is only right once evaluated (it holds an
 *   escape), drawn as a chip. It is written verbatim while the string it stands in is still a
 *   template, and as the text it shows once it is not ({@link joinRun}).
 * - `member` is one whole string member of `children`: a chip marked as one, or the element a
 *   templated member is drawn as. It is never joined with what stands beside it.
 * - `node` is an element.
 *
 * The distinction is what keeps a commit from changing what a string MEANS while leaving every
 * binding in it. A string with no `${` is literal text; one with a `${` is the inside of a template
 * literal, where a backslash is an escape; and one that is a single whole `${…}` and a member of
 * `children` is the only string whose value may be nodes (spec.md §8.4). So text joined into a
 * template is escaped, text beside a member stays a member of its own, and a member is never folded
 * into a `textContent`.
 */
type Piece =
  | { kind: "plain" | "template" | "literal" | "member"; text: string }
  | { kind: "node"; node: JxMutableNode };

/** A {@link TextPiece} that is joined with the pieces beside it: every sort but a member. */
type RunPiece = TextPiece & { kind: "plain" | "template" | "literal" };

/** Whether a piece is one a run is made of. */
function isRunPiece(piece: Piece): piece is RunPiece {
  return piece.kind === "plain" || piece.kind === "template" || piece.kind === "literal";
}

/** A {@link Piece} that is text of one sort or another. */
type TextPiece = Exclude<Piece, { kind: "node" }>;

/** What one serialization learned besides the content. */
interface SerializeState {
  /**
   * Whether the canvas no longer shows the block as the document now holds it: a backslash or a
   * backtick the author typed into a templated string, stored escaped, or a whole `${…}` typed (or
   * inserted) as text, which is a binding and is drawn as a chip. The block is then drawn again
   * from the document rather than left as typed, which keeps an offset counted on the canvas an
   * offset into the stored text and keeps an expression from standing on the canvas as text.
   */
  respelled: boolean;
}

/** Whether `node` is a chip: the element that stands for one binding. */
function isChipNode(node: Node): node is Element & HTMLOrSVGElement {
  return isDatasetElementNode(node) && node.hasAttribute(TAG_ATTR);
}

/**
 * The piece of a string a chip stands for: one `${…}`, or a literal run drawn as a chip because it
 * holds an escape (`templateRuns` in `utils/edit-display.ts`).
 */
function chipRunPiece(chip: Element): RunPiece {
  const text = chip.getAttribute(TAG_ATTR) ?? "";
  return { kind: isWholeTemplate(text) ? "template" : "literal", text };
}

/** The text piece a chip stands for: a whole member, or part of a string ({@link chipRunPiece}). */
function chipPiece(chip: Element): TextPiece {
  return chip.hasAttribute(TAG_MEMBER_ATTR)
    ? { kind: "member", text: chip.getAttribute(TAG_ATTR) ?? "" }
    : chipRunPiece(chip);
}

/**
 * A run that holds no `${…}` as the plain text it is, or null when it is a template all the same:
 * the author's own text holds a `${`, or a literal run cannot be read as text.
 *
 * A literal run was spelled for the inside of a template literal. With the last expression gone
 * from its string (the chip deleted, the run split off or wrapped on its own) the string is literal
 * text, so the run is written as what it shows: `C:\\temp` left as it was spelled would put a
 * second backslash on the page.
 */
function plainRun(run: readonly RunPiece[]): string | null {
  let out = "";
  for (const piece of run) {
    if (piece.kind === "template") {
      return null;
    }
    const text = piece.kind === "literal" ? unescapeTemplateText(piece.text) : piece.text;
    if (text === null) {
      return null;
    }
    out += text;
  }
  return out.includes("${") ? null : out;
}

/**
 * Join a run of pieces into the one string they are.
 *
 * The string is a template when the run holds an expression, and also when the author's own text
 * holds a `${`: any string with one is read as a template, whoever wrote it. In a template the
 * author's text is escaped so that it reads back as it was typed ({@link escapeTemplateText}), and
 * a literal run stays as it is spelled. With no expression the string is plain text, and a literal
 * run is the text it shows ({@link plainRun}).
 */
function joinRun(run: readonly RunPiece[], state: SerializeState): string {
  const plain = plainRun(run);
  if (plain !== null) {
    // A chip the canvas still draws is text in the document now: drawn again, not left in place.
    state.respelled ||= run.some((piece) => piece.kind === "literal");
    return plain;
  }
  let out = "";
  for (const [index, piece] of run.entries()) {
    if (piece.kind === "plain") {
      // A `$` that would open an expression with the `{` the next piece starts with is escaped too.
      const opens = piece.text.endsWith("$") && run[index + 1]?.text.startsWith("{") === true;
      const escaped = escapeTemplateText(opens ? piece.text.slice(0, -1) : piece.text);
      // A whole `${…}` in the author's own text is a binding now, and is drawn as a chip.
      state.respelled ||=
        opens || escaped !== piece.text || templateExpressions(piece.text).length > 0;
      out += opens ? `${escaped}\\$` : escaped;
    } else {
      out += piece.text;
    }
  }
  return out;
}

/** Read `node` onto the end of `out` as pieces. */
function collectPieces(node: Node, out: Piece[], state: SerializeState): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (text !== "") {
      out.push({ kind: "plain", text });
    }
    return;
  }
  if (!isDatasetElementNode(node)) {
    return;
  }
  /* A CHIP FIRST, before anything reads text (studio.md §4.5). A chip shows a binding's resolved
     value and carries the expression it stands for; the expression is what the document holds, so
     it is what is written, verbatim, whatever the chip's content is. This is the second of the
     three guards that keep a commit from storing a value where a template was. */
  if (node.hasAttribute(TAG_ATTR)) {
    out.push(chipPiece(node));
    return;
  }
  if (node.hasAttribute(TEXT_ATTR)) {
    /* The element one templated string member is drawn as. It is not a node of the document: while
       it holds only text and chips it is that one member; once the author has put an element in it
       (bold over part of it) there is no one string left, and what it holds is written in its
       place. */
    const inner: Piece[] = [];
    for (const child of node.childNodes) {
      collectPieces(child, inner, state);
    }
    const run = inner.filter((piece) => isRunPiece(piece));
    if (run.length === inner.length) {
      const text = joinRun(run, state);
      if (text !== "") {
        // Still a template: one member. With no `${` left in it, text like any other.
        out.push({ kind: text.includes("${") ? "member" : "plain", text });
      }
    } else {
      out.push(...inner);
    }
    return;
  }
  out.push({ kind: "node", node: domNodeToJx(node, state) });
}

/**
 * The stored content a list of pieces stands for: `{ textContent }` when it is one string that is
 * not a member, `{ children }` otherwise.
 *
 * Adjacent plain and template pieces are one string. A member is a string of its own whatever
 * stands beside it, and is never folded into `textContent`: `children: ["${state.list}"]` splices
 * an array in as nodes, and `textContent: "${state.list}"` prints it.
 */
function piecesToContent(pieces: readonly Piece[], state: SerializeState): JxContentResult {
  const children: (JxMutableNode | string)[] = [];
  let run: RunPiece[] = [];
  let members = 0;
  const flush = (): void => {
    const text = joinRun(run, state);
    run = [];
    if (text !== "") {
      children.push(text);
    }
  };
  for (const piece of pieces) {
    if (isRunPiece(piece)) {
      run.push(piece);
      continue;
    }
    flush();
    if (piece.kind === "node") {
      children.push(piece.node);
    } else {
      members += 1;
      children.push(piece.text);
    }
  }
  flush();
  const [only] = children;
  if (only === undefined) {
    return { textContent: "" };
  }
  if (children.length === 1 && isString(only) && members === 0) {
    return { textContent: only };
  }
  return { children };
}

/** The content of `parent`'s child nodes. */
function nodesToContent(parent: ParentNode, state: SerializeState): JxContentResult {
  const pieces: Piece[] = [];
  for (const child of parent.childNodes) {
    collectPieces(child, pieces, state);
  }
  return piecesToContent(pieces, state);
}

/**
 * Serialize the content of `el` as an edit session would commit it: the `{ textContent }` or `{
 * children }` a block holding that DOM stands for. Exported for the round-trip guarantee (studio.md
 * §4.5): what the canvas rendered for a block serializes back to what the block holds, string for
 * string and member for member.
 *
 * @param {HTMLElement} el
 * @returns {JxContentResult}
 */
export function serializeContent(el: HTMLElement): JxContentResult {
  return nodesToContent(el, { respelled: false });
}

/**
 * Whether `node` is an element carrying `dataset` — an HTML, SVG or MathML element, which is every
 * element an HTML editing host can hold. Decided by node type and feature, not `instanceof`, so it
 * holds for a node of any realm.
 */
function isDatasetElementNode(node: Node): node is Element & HTMLOrSVGElement {
  return node.nodeType === Node.ELEMENT_NODE && "dataset" in node;
}

/** Browser execCommand output tags, mapped to the tags Jx documents use for the same formatting. */
const BROWSER_TAG_CONVENTIONS = new Map([
  ["b", "strong"],
  ["i", "em"],
  ["s", "del"],
  ["strike", "del"],
]);

/**
 * Everything under `node` as the text it stands for, in pieces: a text node's own, and for a chip
 * the expression it carries, never the value it shows. Elements are read through.
 */
function flattenText(node: Node, out: RunPiece[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push({ kind: "plain", text: node.textContent ?? "" });
    return;
  }
  if (isChipNode(node)) {
    out.push(chipRunPiece(node));
    return;
  }
  for (const child of node.childNodes) {
    flattenText(child, out);
  }
}

/** Whether `el` holds an element that is neither a chip nor the element one member is drawn as. */
function holdsMarkup(el: Element): boolean {
  for (const child of el.children) {
    if (!child.hasAttribute(TAG_ATTR) && !child.hasAttribute(TEXT_ATTR)) {
      return true;
    }
  }
  return false;
}

/**
 * Convert a DOM element to a Jx element definition.
 *
 * @param {Element & HTMLOrSVGElement} el
 * @returns {JxMutableNode}
 */
function domNodeToJx(el: Element & HTMLOrSVGElement, state: SerializeState): JxMutableNode {
  const tag = el.tagName.toLowerCase();
  /* What the element's document node holds that the canvas cannot be read back for
     (`editor/kept-node.ts`): written back verbatim, so a bound `href` goes back as its binding and
     a `class` is still there. An element closed to the caret carries its whole node, and is that
     node: nothing in it is the author's to have edited. */
  const kept = keptNodeOf(el);
  if (kept && el.getAttribute("contenteditable") === "false" && isString(kept.tagName)) {
    return kept;
  }
  const result: JxMutableNode = { ...kept, tagName: BROWSER_TAG_CONVENTIONS.get(tag) ?? tag };

  if (tag === "a") {
    // A canvas anchor is DE-LINKED in design/edit: the runtime stamps its URL as `data-jx-href` so a
    // Click selects the anchor instead of navigating the iframe (see setCanvasDelinkAnchors). Reading
    // Only `href` here would serialize every edited link as `[text]()` — silently destroying the URL
    // Of any paragraph that happens to contain one. Read only for an attribute the document node
    // Does not hold: a link the author just made, or one whose URL they just set (`applyLink`).
    const attributes = { ...kept?.attributes };
    const href = el.dataset.jxHref ?? el.getAttribute("href");
    if (!("href" in attributes) && href != null) {
      attributes.href = href;
    }
    // `title` is an HTMLElement property: an HTML `<a>` reflects the attribute, an SVG `<a>` has none.
    if (!("title" in attributes) && "title" in el && isString(el.title) && el.title) {
      attributes.title = el.title;
    }
    if (Object.keys(attributes).length > 0) {
      result.attributes = attributes;
    }
  }
  const { childNodes } = el;
  const [only] = childNodes;
  if (childNodes.length === 1 && only && isChipNode(only) && only.hasAttribute(TAG_REF_ATTR)) {
    /* A `{ "$ref" }` text: one chip and nothing else. A reference is an object, not a string, so
       it goes back as the object it was; its chip's `data-jx-tag` is a name for it, not a
       spelling. Read before anything flattens the element, a `<code>` included. */
    result.textContent = { $ref: only.getAttribute(TAG_REF_ATTR) ?? "" };
    return result;
  }
  if (tag === "code" && holdsMarkup(el)) {
    /* Markup inside `<code>` is flattened to text, with a chip inside it written as its
       expression, not its value. One that holds only text and chips is read like any other
       element, so a whole-template member in it is still a member. */
    const run: RunPiece[] = [];
    flattenText(el, run);
    result.textContent = joinRun(run, state);
    return result;
  }

  /* Folded like a block's own content: an inline whose content is all one string (a run and a
     chip, say) is stored as one `textContent`, which is the form it was drawn from. */
  const content = nodesToContent(el, state);
  if (content.children) {
    result.children = content.children;
  } else if (el.childNodes.length > 0 || kept === null) {
    result.textContent = content.textContent ?? "";
  }
  // An element that carries its node's own keys and holds nothing (an `<img>`) has no text at all.
  return result;
}

/**
 * Convert a DocumentFragment to a Jx-compatible structure. Returns { textContent } or { children }.
 *
 * @param {DocumentFragment} frag
 * @returns {JxContentResult}
 */
function fragmentToJx(frag: DocumentFragment): JxContentResult {
  const state: SerializeState = { respelled: false };
  const pieces: Piece[] = [];
  for (const child of frag.childNodes) {
    collectPieces(child, pieces, state);
  }
  const [only] = pieces;
  if (
    pieces.length === 1 &&
    only?.kind === "node" &&
    only.node.tagName === "span" &&
    isString(only.node.textContent)
  ) {
    return { textContent: only.node.textContent };
  }
  /* Folded as a commit folds it: a half that is all one string (a run and a chip, two text nodes
     the browser left side by side) is one `textContent`, the form it was drawn from. */
  return piecesToContent(pieces, state);
}

// ─── Rich text helpers ─────────────────────────────────────────────────────

/**
 * @param {Range} range
 * @returns {string}
 */
function getTextBeforeCursor(range: Range) {
  const preRange = document.createRange();
  preRange.setStart(activeEl!, 0);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString();
}

// ─── Slash command menu (delegates to shared slash-menu.js) ──────────────

/** Track the character offset where "/" was typed so we can detect backspace-past-slash */
let _slashFilterStart = 0;

/**
 * Whether a literal "/" in the block anchors the open menu.
 *
 * False when the menu was opened BY NAME — `insert.openSlashMenu`, the palette, the automation
 * runner — where there is no slash in the text at all. Two behaviours hang off it, and both are
 * wrong without it: the filter would be re-derived from the text before the caret and dismiss the
 * menu on the very next keystroke, and selecting a block would delete everything from the previous
 * slash in the line ("and/or…") back to the caret. A command-opened menu filters in its own field
 * and deletes nothing.
 */
let _slashAnchored = true;

/**
 * Open the slash menu at the caret.
 *
 * Exported because the block-level `keydown` listener that used to call it never fires: for an
 * ordinary block the editing host is the canvas container, so the "/" gesture is recognised at the
 * host ({@link handleSlashTrigger}) and a command opens it from the other realm entirely.
 *
 * @param opts.anchored Whether a literal "/" precedes the caret. See {@link _slashAnchored}.
 */
export function openSlashMenu(opts?: { anchored?: boolean }): void {
  if (!activeEl || !insertFn || !activePath) {
    return;
  }
  /*
   * Never in a plain session. A prop value is one string — there is nowhere to insert a block, and
   * `enterPropEditAt` says so by passing `onInsert: () => {}`. That no-op is TRUTHY, so the
   * precondition above let the menu open anyway, and choosing an item then ran the rich select
   * path: it deleted the typed "/…" run and called `releaseWithoutCommit`, so the edit was
   * discarded and no block was inserted either. The menu also captures Enter and Escape
   * document-wide, so it took the two keys the docs promise for this session.
   *
   * Guarded here rather than at the trigger so a programmatic `openSlashMenu()` is covered too.
   */
  if (_plainMode) {
    return;
  }

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    return;
  }
  const range = sel.getRangeAt(0);
  _slashAnchored = opts?.anchored !== false;
  _slashFilterStart = getTextBeforeCursor(range).length;

  // An unanchored menu carries its own filter field: there is no "/…" run in the document for the
  // Author to type into, so without one the list could only ever be filtered by scrolling it.
  const menu: SlashMenuOptions = { onSelect: handleSlashSelect };
  if (!_slashAnchored) {
    menu.showFilter = true;
  }
  slash.show(activeEl, "", menu);
}

/**
 * The "/" gesture, driven from the EDITING HOST.
 *
 * A slash opens the menu at the start of a block or after a space — anywhere else it is punctuation
 * ("and/or"), and a menu there would be an ambush. The character is allowed to land first, so the
 * document holds what the author typed whether or not they pick anything from the list.
 */
export function handleSlashTrigger(e: KeyboardEvent): void {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || !activeEl) {
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return;
  }
  const textBefore = getTextBeforeCursor(sel.getRangeAt(0));
  if (textBefore === "" || textBefore.endsWith(" ") || textBefore.endsWith("\n")) {
    requestAnimationFrame(() => openSlashMenu());
  }
}

/**
 * Re-filter an open menu from the text the author has typed after the "/".
 *
 * Exported for the same reason {@link openSlashMenu} is: the `input` listener that called it is on
 * the block, and a contenteditable's `input` targets the editing HOST.
 */
export function refreshSlashMenu(): void {
  if (!activeEl || !_slashAnchored) {
    // The menu owns its own filter field; the document has no "/…" run to derive one from, and
    // Deriving one would dismiss the menu on the first character.
    return;
  }

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    slash.dismiss();
    return;
  }

  const range = sel.getRangeAt(0);
  const fullText = getTextBeforeCursor(range);
  const slashIdx = fullText.lastIndexOf("/");

  if (slashIdx === -1 || fullText.length < _slashFilterStart - 1) {
    slash.dismiss();
    return;
  }

  const filter = fullText.slice(slashIdx + 1).toLowerCase();
  slash.show(activeEl, filter, { onSelect: handleSlashSelect });
}

/** @param {SlashCommand} cmd */
function handleSlashSelect(cmd: SlashCommand) {
  if (!activeEl || !insertFn || !activePath) {
    return;
  }

  /* Remove the "/command" run the author typed — but ONLY when a "/" is what opened the menu.
     An unanchored menu (opened by name, from the palette or `insert.openSlashMenu`) has no such
     run, and this walk would delete from the last slash ANYWHERE earlier in the block back to the
     caret: type "and/or" and pick Heading, and "or" goes with it. */
  const sel = _slashAnchored ? window.getSelection() : null;
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    const fullText = getTextBeforeCursor(range);
    const slashIdx = fullText.lastIndexOf("/");
    if (slashIdx !== -1) {
      const walker = document.createTreeWalker(activeEl, NodeFilter.SHOW_TEXT);
      let charCount = 0;
      let slashNode: Text | null = null;
      let slashOffset = 0;
      while (walker.nextNode()) {
        // SAFETY: the walker shows only text nodes (SHOW_TEXT), and nextNode() just landed on one.
        const node = walker.currentNode as Text;
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

  // Compute commit data inline instead of calling commitChanges() — avoids a separate
  // Update() call that would race with the insertFn update() (two concurrent async renders).
  normalizeInlineContent(activeEl);
  const commitResult = serializeContent(activeEl);

  const path = [...activePath];
  const insert = insertFn;

  // The insert carries `commitResult`, so it writes this block's content itself — releasing without
  // A commit keeps the two from racing.
  releaseWithoutCommit();

  // Pass commit data so onInsert can batch commit + insert into a single update()
  insert(path, cmd, commitResult);
}
