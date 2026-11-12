/// <reference lib="dom" />
/**
 * The canvas editing host — the mechanics of a document-wide caret.
 *
 * The canvas container is a single `contenteditable` (see `syncEditableRoot`), so the browser owns
 * everything it is genuinely good at: placing the caret where you clicked, moving it across block
 * boundaries with line-wrap-aware Up/Down, Home/End, word motion, IME, and drag-selecting across
 * paragraphs. There is no "edit session" to enter and no modal state — the caret simply exists.
 *
 * This module owns three things and nothing else:
 *
 * 1. **Which block the caret is in**, derived from `selectionchange` rather than stored. Entering and
 *    leaving a block are reported to the bridge, which is where commits and the parent's
 *    selection/toolbar state live.
 * 2. **The `beforeinput` chokepoint.** Structural intents are prevented and handed to the document
 *    model; single-block text edits run natively. The decision itself is pure and lives in
 *    {@link file://./editable-actions.ts}.
 * 3. **Caret capture/restore in model coordinates**, so a surgical patch can rewrite the DOM under a
 *    live caret without the caret jumping (see {@link file://./iframe-position.ts}).
 *
 * A structural handler that is absent SUPPRESSES its action rather than falling back to the
 * browser's own restructuring — an unimplemented merge must leave the document untouched, never let
 * the engine silently join two blocks behind the model's back.
 *
 * @docs studio/editing/writing
 */

import { classifyBeforeInput } from "./editable-actions";
import {
  caretBeside,
  chipBeside,
  chipSources,
  removeChip,
  removedSources,
  snapRangeOutOfChips,
} from "./iframe-chips";
import type { Side } from "./iframe-chips";
import {
  activeBlockAt,
  blockTextLength,
  isAtBlockStart,
  isChip,
  samePath,
  toDocPos,
  toDomPosition,
} from "./iframe-position";
import { serializeJxPath } from "./path-mapping";
import { isFunction } from "@jxsuite/schema/guards";
import type { DocPos, DocRange, EditablePredicate } from "./iframe-position";
import type { JxPath } from "../state";

/**
 * The capabilities the editing host needs from its bridge. Injected rather than imported so the
 * host stays free of the channel/protocol layer, mirroring `InteractionDeps` and
 * `GrabDetectorDeps`.
 */
export interface EditableRootDeps {
  /** The live render's canvas mode; the caret exists only in design/edit. Absent = permissive. */
  getMode?: () => string;
  /** Which elements may hold a caret. */
  isEditableBlock: EditablePredicate;
  /** The caret entered a block. */
  onActivate: (el: HTMLElement, path: JxPath) => void;
  /** The caret left the active block (or the canvas). */
  onDeactivate: () => void;
  /** The selection moved WITHIN the active block. */
  onSelectionChange?: () => void;
  /**
   * A prop-bound component-internal marker was pressed. Returns whether it was activated — the
   * bridge decides, since only it can see the raw `$props` value behind the binding.
   */
  onPropActivate?: (el: HTMLElement) => boolean;
  /**
   * A collection page's text drawn from one field of the entry being written was pressed
   * (`data-jx-entry-field`, studio.md §22.5). Returns whether it was activated.
   */
  onFieldActivate?: (el: HTMLElement) => boolean;
  /** Split the active block at the caret. Returns whether it was handled. */
  onSplit?: () => boolean;
  /** Join the block at `at` onto the previous one. Returns whether it was handled. */
  onMergeBackward?: (at: DocPos) => boolean;
  /** Pull the next block up into the one at `at`. Returns whether it was handled. */
  onMergeForward?: (at: DocPos) => boolean;
  /** Replace `[from, to)` — possibly spanning blocks — with `text`. Returns whether it was handled. */
  onReplaceRange?: (from: DocPos, to: DocPos, text: string) => boolean;
  /**
   * Commit the active block's content to the document WITHOUT releasing it — the idle tick.
   *
   * Typing used to reach the document only when the caret left the block, so a crash, a tab switch,
   * or a co-author's view lost everything since the last block change. This fires after a pause in
   * typing instead, which also gives undo its granularity: one entry per typing burst.
   */
  onCommitTick?: () => void;
  /** Idle milliseconds before {@link onCommitTick}. Defaults to {@link COMMIT_IDLE_MS}. */
  commitDelayMs?: number;
  /**
   * The author's input removed these chips from the active block (studio.md §4.5): each is the
   * expression the chip stood for. The bridge reports them with the block's next commit, which is
   * what lets that commit drop the binding rather than be refused for losing it.
   */
  onTagsRemoved?: (sources: string[]) => void;
}

/** The inputs that delete one position backward or forward from a collapsed caret. */
const DELETE_ONE = new Map<string, Side>([
  ["deleteContentBackward", -1],
  ["deleteContentForward", 1],
]);

/**
 * How long typing must pause before the active block is committed.
 *
 * Long enough that ordinary typing produces one commit per phrase rather than per keystroke (each
 * commit is a transaction, a patch round-trip, a collab publish, and an undo entry); short enough
 * that what you see on screen is what a save or a crash would keep.
 */
export const COMMIT_IDLE_MS = 500;

/** The selection's current endpoints in document coordinates, or null when it is outside the canvas. */
export function captureDocSelection(
  container: HTMLElement,
  isEditable: EditablePredicate,
): DocRange | null {
  const sel = container.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) {
    return null;
  }
  if (!container.contains(sel.anchorNode) || !container.contains(sel.focusNode)) {
    return null;
  }
  const anchor = toDocPos(sel.anchorNode, sel.anchorOffset, isEditable);
  const head = toDocPos(sel.focusNode, sel.focusOffset, isEditable);
  return anchor && head ? { anchor, head } : null;
}

/**
 * Put the selection back at `range`'s document coordinates. Returns false when neither endpoint's
 * block still renders — the caller then leaves the caret wherever the browser put it rather than
 * moving it somewhere arbitrary.
 */
export function restoreDocSelection(container: HTMLElement, range: DocRange): boolean {
  const anchor = toDomPosition(container, range.anchor);
  const head = toDomPosition(container, range.head) ?? anchor;
  if (!anchor) {
    return false;
  }
  const sel = container.ownerDocument.getSelection();
  if (!sel) {
    return false;
  }
  const domRange = container.ownerDocument.createRange();
  domRange.setStart(anchor.node, anchor.offset);
  sel.removeAllRanges();
  sel.addRange(domRange);
  if (head && head !== anchor) {
    sel.extend(head.node, head.offset);
  }
  return true;
}

/** The editing host's control surface. */
export interface EditableRootHandle {
  /** Tear the host down. */
  stop: () => void;
  /**
   * Forget the active element without committing or notifying — for when the EDITING ENGINE has
   * already ended the session itself (Enter / Escape in a prop host) and only this module's
   * bookkeeping is left pointing at it.
   */
  forget: () => void;
  /**
   * Re-derive the active block from the live selection. Call after moving the selection
   * programmatically — `selectionchange` is dispatched as a task, so a caller that needs the
   * activation to have happened before it returns cannot wait for the event.
   */
  sync: () => void;
  /** Put the caret at a document position and activate its block. False when the path is gone. */
  placeCaret: (pos: DocPos) => boolean;
  /**
   * Commit the active block NOW, cancelling any pending idle tick. Called before anything that
   * reads the document as authoritative — a save, a tab switch, a mode change.
   */
  flush: () => void;
  /** The current selection in document coordinates, or null when it is outside the canvas. */
  capture: () => DocRange | null;
  /** Restore a captured selection and re-activate its block. */
  restore: (range: DocRange) => boolean;
  /**
   * Whether an IME composition is in flight.
   *
   * While it is, the DOM holds provisional text and the input engine owns a selection tied to it,
   * so nothing may rewrite the editable subtree — a remote patch or a re-render would cancel the
   * composition and lose whatever the author had half-typed.
   */
  isComposing: () => boolean;
}

/**
 * Whether an element carries `dataset`. HTML, SVG and MathML elements all mix in
 * `HTMLOrSVGElement`; an element from any other namespace has no `dataset` at all.
 */
function hasDataset(el: Element): el is Element & HTMLOrSVGElement {
  return "dataset" in el;
}

/** Wire the editing host on `container`. */
export function startEditableRoot(
  container: HTMLElement,
  deps: EditableRootDeps,
): EditableRootHandle {
  const doc = container.ownerDocument;
  /** The element the caret is currently editing — a page block, or a prop-bound nested host. */
  let activeEl: HTMLElement | null = null;
  /** Its serialized document path. Null for a prop-bound host, which has no path of its own. */
  let activeKey: string | null = null;

  const editingAllowed = () => {
    const mode = deps.getMode?.();
    return mode === undefined || mode === "design" || mode === "edit";
  };

  /** Pending idle-commit timer, or null when none is armed. */
  let commitTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelCommitTick = () => {
    if (commitTimer !== null) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
  };

  /**
   * Commit the active block in place, keeping the caret where the user left it.
   *
   * The commit normalizes the block's inline content (merging adjacent text nodes, unwrapping empty
   * formatting) before serializing, which REWRITES the very text nodes the caret is anchored in.
   * Capturing the caret in document coordinates first and restoring afterwards is what makes an
   * idle commit invisible — without it, typing would jump the caret every time you paused.
   */
  const commitTick = () => {
    commitTimer = null;
    if (!activeEl || !deps.onCommitTick) {
      return;
    }
    const caret = captureDocSelection(container, deps.isEditableBlock);
    deps.onCommitTick();
    if (caret) {
      restoreDocSelection(container, caret);
    }
  };

  /**
   * True between `compositionstart` and `compositionend`.
   *
   * An IME composition is a multi-keystroke transaction the browser owns: the DOM holds provisional
   * text and the engine holds selection state tied to it. Committing mid-composition would read
   * that half-formed text into the document AND — the part that actually breaks input —
   * `restoreDocSelection` would reset the selection under the IME, cancelling the composition. So
   * every commit is suspended for the duration and exactly one runs when it ends.
   *
   * This surface had no composition handling at all, which is why the 500 ms idle tick could land
   * in the middle of typing Japanese, Chinese, Korean or Vietnamese.
   */
  let composing = false;

  /** (Re)arm the idle tick — every keystroke pushes it further out. */
  const scheduleCommitTick = () => {
    if (!deps.onCommitTick || !activeEl || composing) {
      return;
    }
    cancelCommitTick();
    commitTimer = setTimeout(commitTick, deps.commitDelayMs ?? COMMIT_IDLE_MS);
  };

  const onCompositionStart = () => {
    composing = true;
    // A tick already armed by the keystrokes that opened the composition must not fire inside it.
    cancelCommitTick();
  };

  const onCompositionEnd = () => {
    composing = false;
    // One commit for the whole composed run, on the same idle path a normal edit takes.
    scheduleCommitTick();
  };

  /**
   * Drop the active element WITHOUT telling the engine — the engine is what asked.
   *
   * `deactivate()` exists for the caret leaving, and calls `onDeactivate` to commit on the way out.
   * When the ENGINE ends a session itself (Enter or Escape in a prop host), that has already
   * happened, and calling back into it would re-enter a teardown that is mid-flight. What was
   * missing was the other half: nothing cleared `activeEl`/`activeKey`, so the host kept pointing
   * at a dead session — `onPointerDownCapture`'s `el !== activeEl` guard was then false and the
   * next click on the same text did nothing at all, and `inPropHost` stayed true with no session
   * behind it.
   */
  const forget = () => {
    cancelCommitTick();
    activeEl = null;
    activeKey = null;
  };

  /** Release whatever is active, if anything. */
  const deactivate = () => {
    if (!activeEl) {
      return;
    }
    // Leaving the block commits it through `onDeactivate`, so a pending tick is redundant — and
    // Firing it afterwards would commit a block that is no longer active.
    cancelCommitTick();
    activeEl = null;
    activeKey = null;
    deps.onDeactivate();
  };

  /**
   * Re-derive the active block from the live selection.
   *
   * This is the whole "enter editing" flow: there is no gesture to recognise, because a caret
   * inside a block IS the edit. Click, arrow, Home, a restored caret after a patch — every one of
   * them arrives here the same way.
   */
  /**
   * The outermost chip that is `node` or holds it, when the block it stands in can take the caret.
   * A chip in a block that is closed to the caret is that block's business, not the caret's.
   */
  const editableChipAround = (node: Node | null): Element | null => {
    let chip: Element | null = null;
    for (let cur = node; cur && cur !== container; cur = cur.parentNode) {
      if (isChip(cur)) {
        chip = cur;
      }
    }
    return chip && activeBlockAt(chip.parentNode, deps.isEditableBlock) ? chip : null;
  };

  /**
   * Move a selection end that stands INSIDE a chip to the chip's edge. Returns whether it moved.
   *
   * A chip is closed to the caret, but a press on one still lands the selection in its text: the
   * engine puts it there and then draws no caret, takes no typing, and steps nowhere on an arrow
   * key, so on a block that is one chip and nothing else (a heading bound to a title) a click did
   * nothing at all. The edge nearer the press is where the author meant, and a selection that
   * reaches into a chip covers it whole.
   */
  const snapOutOfChips = (sel: Selection): boolean => {
    if (sel.rangeCount === 0) {
      return false;
    }
    const chip = editableChipAround(sel.anchorNode) ?? editableChipAround(sel.focusNode);
    const block = chip ? activeBlockAt(chip.parentNode, deps.isEditableBlock) : null;
    if (!block) {
      return false;
    }
    /* Backward when the anchor comes after the focus: a range from one to the other collapses,
       because a range's end cannot precede its start. */
    let backward = false;
    if (!sel.isCollapsed && sel.anchorNode && sel.focusNode) {
      const order = doc.createRange();
      order.setStart(sel.anchorNode, sel.anchorOffset);
      order.setEnd(sel.focusNode, sel.focusOffset);
      backward = order.collapsed;
    }
    const range = sel.getRangeAt(0).cloneRange();
    if (!snapRangeOutOfChips(block.el, range)) {
      return false;
    }
    if (backward) {
      sel.setBaseAndExtent(
        range.endContainer,
        range.endOffset,
        range.startContainer,
        range.startOffset,
      );
    } else {
      sel.setBaseAndExtent(
        range.startContainer,
        range.startOffset,
        range.endContainer,
        range.endOffset,
      );
    }
    return true;
  };

  const syncActiveBlock = () => {
    if (!editingAllowed()) {
      deactivate();
      return;
    }
    const sel = doc.getSelection();
    if (sel) {
      // Read on below from where the selection now is: the move's own event finds nothing to do.
      snapOutOfChips(sel);
    }
    const focus = sel?.focusNode ?? null;
    if (!focus) {
      // An ABSENT selection is transient, not intent: a re-render, a `removeAllRanges()`, or the
      // Window losing focus all momentarily empty it. Deactivating here would commit and drop the
      // Caret's block for what is about to become the very same selection again. Only a selection
      // That has genuinely moved somewhere else releases the block.
      return;
    }
    if (!container.contains(focus)) {
      deactivate();
      return;
    }
    const block = activeBlockAt(focus, deps.isEditableBlock);
    if (!block) {
      // No stamped block — but a prop-bound nested host has no `data-jx-path` of its own, so a
      // Caret still inside the active element is the session continuing, not leaving it. Without
      // This, opening a prop-bound host would tear itself down on its own first selectionchange.
      if (activeEl?.contains(focus)) {
        deps.onSelectionChange?.();
        return;
      }
      deactivate();
      return;
    }
    const key = serializeJxPath(block.path);
    /* The same ELEMENT, not only the same path. A patch that redraws the block (an undo, a
       co-author's edit, a refused commit's redraw) puts a new element at the path, and a host
       still holding the old one would go on committing the detached element's content: the text
       the patch had just replaced, written back on the next keystroke. */
    if (key === activeKey && block.el === activeEl) {
      deps.onSelectionChange?.();
      return;
    }
    // Leaving a block is what flushes its content to the document, so the order matters: the old
    // Block must be released before the new one is activated.
    deactivate();
    activeEl = block.el;
    activeKey = key;
    deps.onActivate(block.el, block.path);
  };

  /**
   * Resolve the range a `beforeinput` will affect, in model coordinates.
   *
   * A COLLAPSED selection is the author's intent, and it outranks `getTargetRanges()`.
   *
   * For Backspace at a block's start, Chromium reports the range it would DELETE — which reaches
   * back out of this block and into the previous one, because joining them is how the engine
   * implements the keystroke. Read as the affected range, that makes a boundary merge look like a
   * cross-block selection edit, and the keystroke gets suppressed: Backspace at a block start
   * silently does nothing. The caret says what the author meant; the target range says what the
   * browser would have done about it.
   *
   * `getTargetRanges()` still wins for a real selection, where it is authoritative about what will
   * be removed. It is also absent on synthetic events, so the selection is the fallback there.
   *
   * Happy-dom implements no `getTargetRanges()` at all, so unit tests always take the selection
   * branch and CANNOT distinguish these two readings — this one is pinned by CDP.
   */
  const affectedRange = (
    e: InputEvent,
  ): { from: DocPos; to: DocPos; endEl: HTMLElement } | null => {
    // Happy-dom ships no `getTargetRanges` at all, so the method's presence is probed, not assumed.
    const [target] = isFunction(e.getTargetRanges) ? e.getTargetRanges() : [];
    const sel = doc.getSelection();
    const useSelection = sel && sel.rangeCount > 0 && (sel.isCollapsed || !target);
    let startNode: Node | null;
    let startOffset: number;
    let endNode: Node | null;
    let endOffset: number;
    if (useSelection) {
      const r = sel.getRangeAt(0);
      ({ startContainer: startNode, startOffset, endContainer: endNode, endOffset } = r);
    } else if (target) {
      ({ startContainer: startNode, startOffset, endContainer: endNode, endOffset } = target);
    } else {
      return null;
    }
    const from = toDocPos(startNode, startOffset, deps.isEditableBlock);
    const to = toDocPos(endNode, endOffset, deps.isEditableBlock);
    const endBlock = activeBlockAt(endNode, deps.isEditableBlock);
    return from && to && endBlock ? { endEl: endBlock.el, from, to } : null;
  };

  /**
   * The chips the active block held when the input now in flight began, or null between inputs.
   * Compared with what is left when the `input` lands: a chip is closed to the caret, so the only
   * way one leaves through an input is the author deleting, cutting or typing over it.
   */
  let chipsBefore: string[] | null = null;

  /** The collapsed caret inside the active page block, or null. */
  const caretInActiveBlock = (): { block: HTMLElement; node: Node; offset: number } | null => {
    const sel = doc.getSelection();
    if (!activeEl || activeKey === null || !sel || !sel.isCollapsed || !sel.focusNode) {
      return null;
    }
    return activeEl.contains(sel.focusNode)
      ? { block: activeEl, node: sel.focusNode, offset: sel.focusOffset }
      : null;
  };

  /**
   * Backspace or Delete with a chip immediately beside the caret takes the chip, whole, and nothing
   * else. Done here rather than left to the engine so that it is the same in every engine and at a
   * block's edge, and so the removal is reported at the moment it is known to be the author's.
   * Returns whether the input was handled.
   */
  const deleteChipBeside = (e: InputEvent): boolean => {
    const side = DELETE_ONE.get(e.inputType);
    const caret = side === undefined ? null : caretInActiveBlock();
    const chip =
      side === undefined || !caret ? null : chipBeside(caret.block, caret.node, caret.offset, side);
    if (!chip) {
      return false;
    }
    e.preventDefault();
    deps.onTagsRemoved?.([removeChip(chip)]);
    // The edit landed without the engine, so the `input` it would have fired is fired for it.
    container.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: e.inputType }));
    return true;
  };

  /**
   * Left and Right step over a chip beside the caret as one unit. A chip is closed to the caret, so
   * there is no position inside it to stop at, and what an engine does at one that ends its block
   * is not something to leave to the engine.
   */
  const onKeyDown = (e: KeyboardEvent) => {
    if (
      (e.key !== "ArrowLeft" && e.key !== "ArrowRight") ||
      e.shiftKey ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      !editingAllowed()
    ) {
      return;
    }
    const caret = caretInActiveBlock();
    if (!caret) {
      return;
    }
    const rtl = doc.defaultView?.getComputedStyle(caret.block).direction === "rtl";
    const side: Side = (e.key === "ArrowLeft") === rtl ? 1 : -1;
    const chip = chipBeside(caret.block, caret.node, caret.offset, side);
    if (!chip) {
      return;
    }
    e.preventDefault();
    const across = caretBeside(chip, side);
    doc.getSelection()?.collapse(across.node, across.offset);
  };

  const onBeforeInput = (e: InputEvent) => {
    if (!editingAllowed()) {
      return;
    }
    chipsBefore = null;
    if (deleteChipBeside(e)) {
      return;
    }
    classifyAndApply(e);
    // An input the chokepoint took over changes no DOM here, so it has nothing to compare.
    if (!e.defaultPrevented && activeEl && activeKey !== null) {
      chipsBefore = chipSources(activeEl);
    }
  };

  const classifyAndApply = (e: InputEvent) => {
    const resolved = affectedRange(e);
    const action = classifyBeforeInput({
      atBlockEnd: resolved ? resolved.to.offset >= blockTextLength(resolved.endEl) : false,
      atBlockStart: resolved ? isAtBlockStart(resolved.from) : false,
      data: e.data ?? "",
      from: resolved?.from ?? null,
      /* An adopted element with no path IS the prop-bound host — `onPointerDownCapture` sets
         exactly that pair, and `syncActiveBlock` preserves it while the caret stays inside. */
      inPropHost: activeEl !== null && activeKey === null,
      inputType: e.inputType,
      to: resolved?.to ?? null,
    });

    switch (action.kind) {
      case "native": {
        return;
      }
      case "split": {
        // A split whose range spans two blocks would have to delete across the boundary first;
        // Without a range handler there is no correct way to do that, so suppress rather than
        // Silently drop the far half.
        e.preventDefault();
        if (!samePath(action.from, action.to) && !deps.onReplaceRange) {
          return;
        }
        deps.onSplit?.();
        return;
      }
      case "mergeBackward": {
        e.preventDefault();
        deps.onMergeBackward?.(action.at);
        return;
      }
      case "mergeForward": {
        e.preventDefault();
        deps.onMergeForward?.(action.at);
        return;
      }
      case "replaceRange": {
        e.preventDefault();
        deps.onReplaceRange?.(action.from, action.to, action.text);
        return;
      }
      default: {
        // "reject" — the browser must not act, and there is nothing for us to do either.
        e.preventDefault();
      }
    }
  };

  /**
   * Prop-bound component internals sit inside a `contenteditable="false"` island, so a click alone
   * cannot put a caret in them. Capture-phase pointerdown gives the bridge a chance to open a
   * nested editing host BEFORE the browser computes the caret, so the click still lands where it
   * was aimed.
   *
   * Any other press inside uneditable content (a component's own internals, frozen layout chrome)
   * drops the selection. The browser leaves the selection where it was when the press lands on
   * something no caret can enter, so the caret went on blinking in the block clicked BEFORE, with
   * the component now selected in the editor and every keystroke still typed into that block.
   */
  const onPointerDownCapture = (e: PointerEvent) => {
    // A secondary press asks for the element menu, not an edit: see `onMouseDownCapture`.
    if (!editingAllowed() || e.button === 2) {
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    /* A press anywhere outside an open field ends it, so what was typed is written. The page around
       a field is locked, and a press on locked chrome places no caret, so without this the field
       stayed open (and unwritten) until the caret happened to reach another block. */
    if (activeEl?.dataset.jxEntryField !== undefined && !(target && activeEl.contains(target))) {
      deactivate();
    }
    /* An entry's field, drawn by the locked page it is written in: its own nested editing host,
       the way a prop-bound marker inside a component is, because the page around it is frozen. */
    const field = deps.onFieldActivate ? target?.closest("[data-jx-entry-field]") : null;
    if (field && deps.onFieldActivate) {
      /* SAFETY: the marker is stamped through the runtime's attribute path onto an element it
         built as `HTMLElement` (foreign-namespace nodes included, as the prop branch below says). */
      const host = field as HTMLElement;
      if (host !== activeEl) {
        deactivate();
        if (deps.onFieldActivate(host)) {
          activeEl = host;
          activeKey = null;
        }
      }
      return;
    }
    let el = deps.onPropActivate ? target : null;
    while (el && el !== container) {
      if (hasDataset(el) && el.dataset.jxBoundProp && deps.onPropActivate) {
        /* SAFETY: The runtime builds SVG and MathML nodes as `createElementNS(...) as HTMLElement`
           and stamps `data-jx-bound-prop` through that same `HTMLElement`-typed path, so a
           foreign-namespace prop host already travels downstream as an `HTMLElement`. */
        const host = el as HTMLElement;
        if (host !== activeEl) {
          deactivate();
          if (deps.onPropActivate(host)) {
            // Adopt the nested host so the caret landing inside it is not read as a block change.
            activeEl = host;
            activeKey = null;
          }
        }
        return;
      }
      // A stamped page block first means this is ordinary page DOM, not component internals.
      if (hasDataset(el) && el.dataset.jxPath) {
        break;
      }
      el = el.parentElement;
    }
    /* A chip in a block the caret can enter is not uneditable content to back out of: the press
       is aimed at that block, and the selection it leaves inside the chip is moved to the chip's
       edge when it lands (`snapOutOfChips`). */
    if (editableChipAround(target)) {
      return;
    }
    if (target?.closest("[contenteditable]")?.getAttribute("contenteditable") === "false") {
      doc.getSelection()?.removeAllRanges();
    }
  };

  /**
   * A secondary press outside the active block selects, it never starts an edit.
   *
   * The whole canvas is one `contenteditable`, and a right-button press places the caret where it
   * lands, as a left one does. That caret activated the block through `selectionchange`, so every
   * right-click on a block also entered inline editing: the bridge's edit start ran ahead of the
   * menu's mount in the same task, which held the element menu back by hundreds of milliseconds on
   * a real page, and the block was left in edit mode after the menu closed. Cancelling the press's
   * default keeps the caret where it was; `contextmenu` still fires, so the menu is unaffected. The
   * block being edited keeps its native press, because the caret placed there is what the native
   * spelling and edit menu reads. A right-click elsewhere leaves that block, as a left click
   * would.
   */
  const onMouseDownCapture = (e: MouseEvent) => {
    if (e.button !== 2 || !editingAllowed()) {
      return;
    }
    if (activeEl && e.target instanceof Node && activeEl.contains(e.target)) {
      return;
    }
    e.preventDefault();
    if (activeEl) {
      deactivate();
      doc.getSelection()?.removeAllRanges();
    }
  };

  /**
   * Reordering is the block action bar's drag handle, full stop. A `contenteditable` region is
   * natively draggable by its text, which would both fight text selection and move content behind
   * the document model's back.
   */
  const onDragStart = (e: Event) => {
    e.preventDefault();
  };

  /**
   * Every applied edit re-arms the idle tick. Listening to `input` (not `beforeinput`) means this
   * counts what actually landed — including the native single-block edits the chokepoint waved
   * through, and the DOM changes a structural handler made on our behalf.
   */
  const onInput = () => {
    if (chipsBefore && activeEl) {
      const removed = removedSources(chipsBefore, chipSources(activeEl));
      if (removed.length > 0) {
        deps.onTagsRemoved?.(removed);
      }
    }
    chipsBefore = null;
    scheduleCommitTick();
  };

  doc.addEventListener("selectionchange", syncActiveBlock);
  container.addEventListener("beforeinput", onBeforeInput);
  container.addEventListener("input", onInput);
  container.addEventListener("keydown", onKeyDown);
  container.addEventListener("compositionstart", onCompositionStart);
  container.addEventListener("compositionend", onCompositionEnd);
  container.addEventListener("dragstart", onDragStart);
  doc.addEventListener("pointerdown", onPointerDownCapture, true);
  doc.addEventListener("mousedown", onMouseDownCapture, true);

  return {
    capture: () => captureDocSelection(container, deps.isEditableBlock),
    forget,
    /** Whether an IME composition is in flight — callers must not rewrite the DOM under it. */
    isComposing: () => composing,
    flush: () => {
      // Mid-composition, the DOM holds provisional text and the IME owns the selection: committing
      // Would both capture a half-formed string and cancel the composition. The composition's own
      // `compositionend` commits it, and anything that must read the document first (saving) already
      // Waits on this returning.
      if (composing) {
        return;
      }
      if (commitTimer !== null) {
        cancelCommitTick();
        commitTick();
      }
    },
    placeCaret: (pos) => {
      const ok = restoreDocSelection(container, { anchor: pos, head: pos });
      if (ok) {
        syncActiveBlock();
      }
      return ok;
    },
    restore: (range) => {
      const ok = restoreDocSelection(container, range);
      if (ok) {
        syncActiveBlock();
      }
      return ok;
    },
    stop: () => {
      doc.removeEventListener("selectionchange", syncActiveBlock);
      container.removeEventListener("beforeinput", onBeforeInput);
      container.removeEventListener("input", onInput);
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("compositionstart", onCompositionStart);
      container.removeEventListener("compositionend", onCompositionEnd);
      container.removeEventListener("dragstart", onDragStart);
      doc.removeEventListener("pointerdown", onPointerDownCapture, true);
      doc.removeEventListener("mousedown", onMouseDownCapture, true);
      // Deactivating commits, so the pending tick is cancelled rather than fired.
      deactivate();
    },
    sync: syncActiveBlock,
  };
}
