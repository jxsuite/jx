/**
 * The menu behaviour: what a `jx-menu` needs that the closed operator set cannot express.
 *
 * Every function here is a `(state, event)` handler a `jx-menu` document names through `$src`, or a
 * helper those handlers share. What they do beyond reading state is exactly the allowed set
 * (specs/ui.md §2): move focus, measure, and call an element's own `showPopover()` /
 * `hidePopover()`. Light dismissal, Escape on the topmost popover and focus restoration are the
 * platform's; this module adds the roving caret, typeahead, the submenu stack and the viewport
 * clamp.
 *
 * A submenu is a child `jx-menu` slotted into a row (`slot="submenu"`), so it is a DOM descendant
 * of its parent panel and the platform treats the two as one popover hierarchy: opening the child
 * does not close the parent, and a click outside closes both.
 */

const ROW = "jx-menu-item";
const MENU = "jx-menu";

/** The reactive scope a `jx-menu` document hands its handlers. */
export interface MenuState {
  open?: boolean;
  x?: number;
  y?: number;
  [key: string]: unknown;
}

/** A row element with the property accessors its document installs. */
type RowElement = HTMLElement & { expanded?: boolean; disabled?: boolean };
/** A menu element with the property accessors its document installs. */
type MenuElement = HTMLElement & { open?: boolean; x?: number; y?: number };

/** The menu an event's `currentTarget` is. */
function menuOf(event: Event): MenuElement | null {
  const target = event.currentTarget;
  return target instanceof HTMLElement && target.localName === MENU
    ? (target as MenuElement)
    : null;
}

/**
 * Whether `menu` is the nearest menu around `node` — a key or a hover in a nested submenu is that
 * submenu's.
 */
function ownsNode(menu: HTMLElement, node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(MENU) === menu;
}

/**
 * The rows of one menu, in order, excluding the rows of any submenu it contains and any row that
 * cannot act. Rows sit inside the panel's emulated `<slot>` and inside `role="none"` wrappers a
 * surface may add, so this walks descendants and keeps the ones whose nearest menu is this one.
 */
export function rowsOf(
  menu: HTMLElement,
  options: { includeDisabled?: boolean } = {},
): RowElement[] {
  const rows = [...menu.querySelectorAll<RowElement>(ROW)].filter(
    (row) => row.closest(MENU) === menu,
  );
  return options.includeDisabled
    ? rows
    : rows.filter((row) => row.getAttribute("aria-disabled") !== "true");
}

/** The submenu a row owns: the `jx-menu` slotted into it, if any. */
export function submenuOf(row: HTMLElement): MenuElement | null {
  for (const menu of row.querySelectorAll<MenuElement>(MENU)) {
    if (menu.parentElement?.closest(ROW) === row) {
      return menu;
    }
  }
  return null;
}

/** The row a submenu is slotted into, if it is a submenu. */
export function parentRowOf(menu: HTMLElement): RowElement | null {
  return (menu.parentElement?.closest(ROW) as RowElement | null) ?? null;
}

/** The outermost menu of a stack. */
export function rootMenuOf(menu: HTMLElement): HTMLElement {
  let root = menu;
  for (;;) {
    const row = parentRowOf(root);
    const above = row?.closest(MENU);
    if (!row || !(above instanceof HTMLElement)) {
      return root;
    }
    root = above;
  }
}

function isShowing(menu: MenuElement): boolean {
  return menu.open === true;
}

/** Show a menu panel through the platform, if it is not already showing. */
export function showMenu(menu: MenuElement): void {
  if (!isShowing(menu) && typeof menu.showPopover === "function") {
    menu.showPopover();
  }
}

/** Hide a menu panel through the platform, if it is showing. */
export function hideMenu(menu: MenuElement): void {
  if (isShowing(menu) && typeof menu.hidePopover === "function") {
    menu.hidePopover();
  }
}

/** Move the roving caret to `index`, wrapping at both ends. */
export function focusRow(rows: RowElement[], index: number): RowElement | null {
  if (rows.length === 0) {
    return null;
  }
  const next = ((index % rows.length) + rows.length) % rows.length;
  for (const [at, row] of rows.entries()) {
    row.tabIndex = at === next ? 0 : -1;
  }
  const row = rows[next]!;
  row.focus();
  return row;
}

/** The row that holds the caret, as an index into `rows`; -1 when none does. */
function activeIndex(rows: RowElement[], target: EventTarget | null): number {
  return rows.findIndex(
    (row) => row === target || (target instanceof Node && row.contains(target)),
  );
}

/** Open a row's submenu beside it and move the caret into it. */
export function openSubmenu(
  row: RowElement,
  options: { focus?: boolean } = {},
): MenuElement | null {
  const sub = submenuOf(row);
  if (!sub) {
    return null;
  }
  const box = row.getBoundingClientRect();
  sub.x = Math.round(box.right) - 2;
  sub.y = Math.round(box.top) - 4;
  row.expanded = true;
  showMenu(sub);
  if (options.focus) {
    focusRow(rowsOf(sub), 0);
  }
  return sub;
}

/** Close every submenu open under `menu` except the one a given row owns. */
function closeSubmenus(menu: HTMLElement, except: RowElement | null = null): void {
  for (const row of rowsOf(menu, { includeDisabled: true })) {
    if (row === except) {
      continue;
    }
    const sub = submenuOf(row);
    if (sub) {
      hideMenu(sub);
    }
  }
}

/** A row's label text: its label part, else all of its text. */
function rowLabel(row: HTMLElement): string {
  return row.querySelector('[part="label"]')?.textContent ?? row.textContent ?? "";
}

/** The next row after `active` whose label starts with `char`, wrapping; -1 when none does. */
function typeaheadHit(rows: RowElement[], active: number, char: string): number {
  const labels = rows.map((row) => rowLabel(row).trim().toLowerCase());
  for (let step = 1; step <= labels.length; step++) {
    const at = (active + step) % labels.length;
    if (labels[at]!.startsWith(char)) {
      return at;
    }
  }
  return -1;
}

/** A single printable character, for typeahead; `null` for anything else. */
function typeaheadChar(event: KeyboardEvent): string | null {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
    ? event.key.toLowerCase()
    : null;
}

/**
 * The menu keyboard contract, on the menu whose row holds the caret. A key that lands in a nested
 * submenu belongs to that submenu's own handler and is left alone here.
 *
 * @param {MenuState} _state
 * @param {KeyboardEvent} event
 */
export function onMenuKeydown(_state: MenuState, event: KeyboardEvent): void {
  const menu = menuOf(event);
  if (!menu || !ownsNode(menu, event.target)) {
    return;
  }
  const rows = rowsOf(menu);
  const active = activeIndex(rows, event.target);
  switch (event.key) {
    case "ArrowDown": {
      focusRow(rows, active + 1);
      break;
    }
    case "ArrowUp": {
      focusRow(rows, active === -1 ? -1 : active - 1);
      break;
    }
    case "Home": {
      focusRow(rows, 0);
      break;
    }
    case "End": {
      focusRow(rows, -1);
      break;
    }
    case "Enter":
    case " ": {
      rows[active]?.click();
      break;
    }
    case "ArrowRight": {
      const row = rows[active];
      if (!row || !submenuOf(row)) {
        return;
      }
      closeSubmenus(menu, row);
      openSubmenu(row, { focus: true });
      break;
    }
    case "ArrowLeft": {
      const parent = parentRowOf(menu);
      if (!parent) {
        return;
      }
      hideMenu(menu);
      parent.focus();
      break;
    }
    case "Escape": {
      // One level at a time: the submenu with the caret, else the whole menu.
      const parent = parentRowOf(menu);
      hideMenu(menu);
      parent?.focus();
      break;
    }
    case "Tab": {
      hideMenu(rootMenuOf(menu) as MenuElement);
      break;
    }
    default: {
      const char = typeaheadChar(event);
      if (char === null) {
        return;
      }
      const hit = typeaheadHit(rows, active, char);
      if (hit === -1) {
        return;
      }
      focusRow(rows, hit);
    }
  }
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Mirror the platform's toggle into state; on show, clamp into the viewport once laid out and move
 * the caret to the first row; on hide, close whatever submenus were open and clear the parent row's
 * expanded state.
 *
 * @param {MenuState} state
 * @param {Event} event The platform's ToggleEvent
 */
export function onMenuToggle(state: MenuState, event: Event): void {
  const menu = menuOf(event);
  if (!menu) {
    return;
  }
  const opening = (event as { newState?: string }).newState === "open";
  state.open = opening;
  const parent = parentRowOf(menu);
  if (!opening) {
    closeSubmenus(menu);
    if (parent) {
      parent.expanded = false;
    }
    return;
  }
  clampIntoViewport(state, menu);
  if (!menu.contains(document.activeElement)) {
    focusRow(rowsOf(menu), 0);
  }
}

/**
 * Keep a shown panel inside the viewport. Measured after a frame, because an unlaid-out panel is
 * zero wide and would never appear to overflow anything; a zero-size box (a test DOM) is left where
 * it is.
 *
 * @param {MenuState} state
 * @param {HTMLElement} menu
 */
export function clampIntoViewport(state: MenuState, menu: HTMLElement): void {
  const measure = (): void => {
    const box = menu.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) {
      return;
    }
    const margin = 4;
    const maxX = window.innerWidth - box.width - margin;
    const maxY = window.innerHeight - box.height - margin;
    if (box.right > window.innerWidth - margin) {
      state.x = Math.max(margin, Math.round(maxX));
    }
    if (box.bottom > window.innerHeight - margin) {
      state.y = Math.max(margin, Math.round(maxY));
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(measure);
  } else {
    measure();
  }
}

/**
 * Hover: entering a row that owns a submenu opens it (closing any sibling's); entering one that
 * does not closes whatever submenu was open.
 *
 * @param {MenuState} _state
 * @param {Event} event
 */
export function onMenuPointerOver(_state: MenuState, event: Event): void {
  const menu = menuOf(event);
  if (!menu || !(event.target instanceof Element)) {
    return;
  }
  const row = event.target.closest<RowElement>(ROW);
  if (!row || row.closest(MENU) !== menu) {
    return;
  }
  const sub = submenuOf(row);
  closeSubmenus(menu, row);
  if (sub && !isShowing(sub) && row.getAttribute("aria-disabled") !== "true") {
    openSubmenu(row);
  }
}
