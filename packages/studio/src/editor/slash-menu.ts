/// <reference lib="dom" />
/**
 * The slash menu — the shared element-insertion list, and the flow behind it.
 *
 * One implementation used by inline editing in both realms (Edit/Content and Design mode), by the
 * block action bar's convert menu, and by the canvas `+`. `surfaces/slash-menu.json` is the panel —
 * its markup, its ARIA and every value in its style — and this module is the decisions: what is on
 * offer, what the filter matches, which row is active, and what a pick does.
 *
 * **Why this is not `surfaces/menu.json`.** Every other Studio menu is that surface, and §12.5 says
 * a second list of actions is a defect — but a `jx-menu` owns DOM focus by contract: showing one
 * moves the caret onto its first row. This panel exists to filter a caret that is somewhere else,
 * inside the canvas's `contenteditable` and usually inside the canvas IFRAME, and every character
 * typed after the `/` has to keep landing there. A panel that takes the keyboard ends the
 * interaction it exists to serve. So the panel is a listbox that marks its active row and never
 * takes focus, and the keys are taken where they actually land — a document-level capturing
 * listener for this realm, and {@link handleSlashMenuKey} called straight across the bridge for the
 * other one. That listener is not a focus trap and cannot become one: it forwards four keys to the
 * same driver the bridge uses, and everything else keeps going to the caret.
 *
 * Light dismissal, the top layer and Escape-on-the-topmost-popover are the platform's, through the
 * `jx-popover` the document is rooted in; the `mousedown` capture listener that used to hand-roll
 * the first of those went with the Spectrum markup.
 *
 * @docs studio/editing/slash-commands
 */

import { openSlashMenuSurface } from "../surfaces/slash-menu";
import { rectOf } from "../utils/geometry";
import type { SlashMenuRow, SlashMenuSurface, SlashMenuView } from "../surfaces/slash-menu";

interface SlashCommand {
  label: string;
  tag: string;
  description: string;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

const SLASH_COMMANDS = [
  { description: "Large heading", label: "Heading 1", tag: "h1" },
  { description: "Medium heading", label: "Heading 2", tag: "h2" },
  { description: "Small heading", label: "Heading 3", tag: "h3" },
  { description: "Plain text", label: "Paragraph", tag: "p" },
  { description: "Unordered list", label: "Bulleted List", tag: "ul" },
  { description: "Numbered list", label: "Numbered List", tag: "ol" },
  { description: "Quote block", label: "Blockquote", tag: "blockquote" },
  { description: "Insert image", label: "Image", tag: "img" },
  { description: "Divider line", label: "Horizontal Rule", tag: "hr" },
  { description: "Button element", label: "Button", tag: "button" },
  { description: "Anchor link", label: "Link", tag: "a" },
  { description: "Preformatted code", label: "Code Block", tag: "pre" },
  { description: "Insert table", label: "Table", tag: "table" },
  { description: "Container", label: "Div", tag: "div" },
  { description: "Section container", label: "Section", tag: "section" },
];

// ─── State ────────────────────────────────────────────────────────────────────

/** Callbacks a caller passes to {@link showSlashMenu}/{@link showSlashMenuAtRect}. */
export interface SlashMenuCallbacks {
  onSelect: (cmd: SlashCommand) => void;
  /** Fired whenever the menu closes (outside click, Escape, no matches, and just before select). */
  onDismiss?: () => void;
  showFilter?: boolean;
  commands?: SlashCommand[];
}

/** The anchor geometry the menu positions from (a DOMRect satisfies this). */
export interface SlashMenuAnchorRect {
  left: number;
  bottom: number;
}

let callbacks: SlashMenuCallbacks | null = null;
let activeIdx = 0;

/** What the current open() asked for, so a repaint driven by the keyboard reproduces it. */
let showFilter = false;
/** What the panel's own filter field holds. Empty for an anchored menu, which has no field. */
let filterText = "";
let filteredItems: SlashCommand[] = [];
let open = false;
let _anchorRect: SlashMenuAnchorRect | null = null;
let _surface: SlashMenuSurface | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/** @returns {boolean} */
export function isSlashMenuOpen() {
  return open;
}

/**
 * Show (or update) the slash menu anchored below `anchorEl`.
 *
 * @param {HTMLElement} anchorEl — the element being edited (for positioning)
 * @param {string} filter — current typed filter text (after the "/")
 * @param {SlashMenuCallbacks} cbs
 */
export function showSlashMenu(anchorEl: HTMLElement, filter: string, cbs: SlashMenuCallbacks) {
  showAt(rectOf(anchorEl), filter, cbs, anchorEl);
}

/**
 * Show (or update) the slash menu anchored below a PARENT-VIEWPORT rect — for callers with no
 * anchor element in this realm (the canvas iframe posts the edited element's rect across the bridge
 * and the host converts it).
 *
 * @param {SlashMenuAnchorRect} rect
 * @param {string} filter
 * @param {SlashMenuCallbacks} cbs
 */
export function showSlashMenuAtRect(
  rect: SlashMenuAnchorRect,
  filter: string,
  cbs: SlashMenuCallbacks,
) {
  showAt(rect, filter, cbs);
}

/** Everything on offer right now: what the caller named, or the standard set. */
function source(): SlashCommand[] {
  return callbacks?.commands || SLASH_COMMANDS;
}

/** The offers a filter leaves standing. An empty filter leaves all of them. */
function matching(filter: string, from: SlashCommand[]): SlashCommand[] {
  return filter
    ? from.filter(
        (c) => c.label.toLowerCase().includes(filter) || c.tag.toLowerCase().includes(filter),
      )
    : from;
}

/** What the panel should be showing, from the state above. */
function view(): SlashMenuView {
  const rect = _anchorRect;
  return {
    activeIndex: activeIdx,
    filter: filterText,
    rows: filteredItems.map((cmd, index): SlashMenuRow => ({
      description: cmd.description,
      hasDescription: Boolean(cmd.description),
      index,
      key: cmd.tag,
      label: cmd.label,
    })),
    showFilter,
    // The gap between the anchor and the panel is the `--jx-popover-offset` token the element
    // Already applies, so this is the anchor's own edge rather than an edge plus a guess.
    x: rect ? rect.left : 0,
    y: rect ? rect.bottom : 0,
  };
}

/** Push the current state to the open panel. A no-op when there is none. */
function paint(): void {
  _surface?.update(view());
}

/** Shared body of the two show entry points. */
function showAt(
  rect: SlashMenuAnchorRect,
  filter: string,
  cbs: SlashMenuCallbacks,
  anchor?: Element | null,
) {
  callbacks = cbs;
  _anchorRect = rect;

  filteredItems = matching(filter, cbs.commands || SLASH_COMMANDS);

  if (filteredItems.length === 0 && !cbs.showFilter) {
    dismissSlashMenu();
    return;
  }

  activeIdx = 0;
  showFilter = cbs.showFilter || false;

  if (_surface) {
    paint();
    return;
  }

  open = true;
  filterText = "";
  document.addEventListener("keydown", onKeydown, true); // Capture phase
  _surface = openSlashMenuSurface(
    view(),
    {
      activateRow: (index) => {
        const cmd = filteredItems[index];
        if (cmd) {
          select(cmd);
        }
      },
      dismissed: onPlatformDismiss,
      hover: (index) => {
        activeIdx = index;
        paint();
      },
      input: onFilterInput,
    },
    anchor ?? null,
  );
  if (showFilter) {
    const surface = _surface;
    void surface.ready.then(() => {
      if (_surface === surface) {
        surface.focusFilter();
      }
    });
  }
}

/**
 * Forget everything about the open menu and hand back whoever asked for it.
 *
 * Split out because there are two ways one closes — this module closing it, and the PLATFORM
 * closing it (a click outside, Escape on the topmost popover) — and both have to leave exactly the
 * same state behind.
 */
function teardown(): SlashMenuCallbacks | null {
  const cbs = callbacks;
  open = false;
  callbacks = null;
  _anchorRect = null;
  filteredItems = [];
  filterText = "";
  activeIdx = 0;
  document.removeEventListener("keydown", onKeydown, true);
  return cbs;
}

export function dismissSlashMenu() {
  if (!open) {
    return;
  }
  const surface = _surface;
  _surface = null;
  const cbs = teardown();
  surface?.close();
  // After teardown so a re-entrant show from the callback sees a closed menu. select() relies on
  // This ordering too: dismiss (→ onDismiss) fires BEFORE onSelect.
  cbs?.onDismiss?.();
}

/** The platform closed the panel — a click outside, or Escape reaching the topmost popover. */
function onPlatformDismiss(): void {
  if (!open) {
    return;
  }
  _surface = null;
  teardown()?.onDismiss?.();
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/** @param {SlashCommand} cmd */
function select(cmd: SlashCommand) {
  const cbs = callbacks;
  dismissSlashMenu();
  cbs?.onSelect(cmd);
}

/** @param {string} value */
function onFilterInput(value: string) {
  filterText = value;
  filteredItems = matching(value.toLowerCase(), source());
  activeIdx = 0;
  paint();
}

/**
 * Drive the open menu with a navigation key. The canvas-iframe bridge calls this DIRECTLY (the key
 * was pressed in the iframe realm — a synthetic keydown redispatch on this document would lose the
 * capture-first + stopPropagation semantics the menu relies on to shield other handlers).
 *
 * The offers are read from the array behind the panel rather than from its rows: the rows are a
 * rendering, and a key that arrives while the document is still reconciling would otherwise be
 * counting a list that has not caught up.
 *
 * @param {string} key — "ArrowDown" | "ArrowUp" | "Enter" | "Escape"
 */
export function handleSlashMenuKey(key: string): void {
  if (!open) {
    return;
  }
  const count = filteredItems.length;

  if (key === "ArrowDown") {
    if (count === 0) {
      return;
    }
    activeIdx = (activeIdx + 1) % count;
    paint();
    _surface?.revealActive();
  } else if (key === "ArrowUp") {
    if (count === 0) {
      return;
    }
    activeIdx = (activeIdx - 1 + count) % count;
    paint();
    _surface?.revealActive();
  } else if (key === "Enter") {
    const cmd = filteredItems[activeIdx];
    if (cmd) {
      select(cmd);
    }
  } else if (key === "Escape") {
    dismissSlashMenu();
  }
}

/** @param {KeyboardEvent} e */
function onKeydown(e: KeyboardEvent) {
  if (!open) {
    return;
  }
  if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) {
    e.preventDefault();
    e.stopPropagation();
    handleSlashMenuKey(e.key);
  }
}
