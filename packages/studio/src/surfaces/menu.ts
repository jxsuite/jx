/**
 * The menu surface: a `jx-menu` of command-record projections, mounted into a popover layer slot.
 *
 * This is the first Studio surface rendered as a Jx document (studio-ui-guidelines.md §6, §9.3):
 * `menu.json` is the markup, ARIA and style, and this adapter is the decisions — which records,
 * what they print, where the panel opens, what runs on select. The kit owns the menu contract
 * (roving focus, typeahead, submenus, light dismissal, Escape) through the platform's own popover,
 * so nothing here binds a key, and the one window listener is the record of which pointers are held
 * ({@link pointersReleased}): a menu asked for mid-press is shown on the release.
 *
 * Every menu opens in a `getLayerSlot("popover", id)` slot, which is what carries the
 * `overlay.menu:<id>` region the screenshot pipeline addresses, and is torn down when the popover
 * closes — by a row, by a key, or by a click outside — through the one `toggle` event the platform
 * fires for all three.
 *
 * The rows are HOST STATE: the scope is reactive, so `setRows()` reconciles the open menu through
 * the document's keyed `$map` — a row whose id survives keeps its node and the caret, a new one is
 * inserted, a gone one removed — which is how a settings section registering while the gear menu is
 * up appears in it without the menu closing.
 *
 * @docs studio/interface/canvas
 * @docs studio/interface/preferences
 */
import type { JxScope } from "@jxsuite/runtime/types";
import { ensureCaret } from "@jxsuite/ui/behaviors/menu";
import { reactive } from "../reactivity";
import { clearLayerSlot, getLayerSlot } from "../ui/layers";
import { mountSurface, registerSurface } from "../ui/surface";
import { rectOf } from "../utils/geometry";
import menuDoc from "./menu.json";

registerSurface("menu", menuDoc);

/**
 * What a row prints: a projection of one command record, decided by the adapter that opens the
 * menu.
 */
export interface MenuRowProjection {
  /** The command id; the row's `value`, what `run` receives, and the row's identity across updates. */
  id: string;
  title: string;
  /** The formatted chord, if the row should teach one. */
  chord?: string;
  disabled: boolean;
  /** The one-sentence reason a disabled row cannot act. */
  requires?: string;
  destructive: boolean;
  /** A group boundary: a divider is drawn above this row. */
  dividerAbove: boolean;
  /** `"true"` or `"false"` for a checkbox row; absent for a plain one. */
  checked?: "true" | "false";
  /**
   * The rows of this row's submenu, one level deep. The row still runs its own command — a submenu
   * is a second way in, never a replacement (studio-ui-guidelines.md §8.4).
   */
  children?: readonly MenuRowProjection[];
  /** The submenu's accessible name; the row's title by default. */
  submenuLabel?: string;
  /** What this row runs, instead of the menu-wide `run(id)`. */
  run?: () => void;
}

export interface OpenMenuOptions {
  rows: readonly MenuRowProjection[];
  /** The menu's accessible name. */
  label: string;
  /** Where the panel opens, in viewport pixels, when `place` is not given. */
  origin?: ViewportPoint;
  /**
   * Where the panel opens as a function of its measured box: run once the popover is shown and
   * again a frame later, so a menu that hangs off a control can put its bottom flush with a floor.
   */
  place?: (box: DOMRect) => ViewportPoint;
  /** The lowest edge the menu and its submenus may reach; the viewport by default. */
  floor?: () => number;
  /**
   * Where the menu hangs relative to `opener`, as a CSS `position-area` value, on an engine with
   * anchor positioning (ui.md §5.1). Derived when omitted: a menu with an `opener` and neither a
   * `place` nor a `floor` hangs `block-end span-inline-end` — below it, leading edges aligned,
   * which is what every such caller's `origin` computes — and every other menu is placed by its
   * coordinates: a context menu at the pointer, a menu whose `place` right-aligns it, a menu that
   * sits on a floor. Pass the empty string to keep a menu with an opener on its coordinates.
   */
  placement?: string;
  /**
   * The popover slot id; the region becomes `overlay.menu:<id>`, so the context menu passes
   * `context`.
   */
  region: string;
  /**
   * Runs the selected row's command, for rows without a `run` of their own. Called before the menu
   * closes.
   */
  run?: (id: string) => void;
  /**
   * What held the keyboard before the menu took it, handed back when the menu closes — and, when it
   * is a control, the popover's invoker, so a mousedown on it does not light-dismiss the menu its
   * own click is about to toggle.
   */
  opener?: HTMLElement | null;
  /** Called once, however the menu closed. */
  onClosed?: (handle: MenuHandle) => void;
}

export interface MenuHandle {
  /** The layer slot the menu is mounted in. */
  readonly host: HTMLElement;
  /** Settles once the document is mounted and the popover shown, or the menu was closed first. */
  readonly ready: Promise<void>;
  /** Close the menu now, synchronously: the slot is emptied before this returns. */
  readonly close: () => void;
  /** Replace the rows; the open menu reconciles in place and the caret is kept on a row. */
  readonly setRows: (rows: readonly MenuRowProjection[]) => void;
}

/** A point in viewport pixels: where a floating panel's corner sits. */
export interface ViewportPoint {
  x: number;
  y: number;
}

type MenuElement = HTMLElement & {
  open?: boolean;
  x?: number;
  y?: number;
  showPopover: (options?: { source?: Element }) => void;
};

/**
 * A row as the document reads it: the projection with every optional filled in, plus the flags its
 * bindings need.
 */
type ProjectedRow = Omit<
  MenuRowProjection,
  "checked" | "children" | "chord" | "requires" | "submenuLabel"
> & {
  chord: string;
  requires: string;
  checked: "true" | "false" | "";
  enabled: boolean;
  noChord: boolean;
  noDivider: boolean;
  haspopup: boolean;
  submenuLabel: string;
  children: ProjectedRow[];
};

/** The scope shape `menu.json` reads. */
interface MenuScope {
  rows: ProjectedRow[];
  label: string;
  x: number;
  y: number;
  floor: number;
  placement: string;
  select: (scope: JxScope, event: Event) => void;
}

/** The default hang of a menu from its opener, which every `origin` of such a caller computes. */
const BELOW_OPENER = "block-end span-inline-end";

/** What {@link OpenMenuOptions.placement} means once the derivation has been applied. */
export function placementOf(
  options: Pick<OpenMenuOptions, "floor" | "opener" | "origin" | "place" | "placement">,
): string {
  if (options.placement !== undefined) {
    return options.placement;
  }
  return options.opener && !options.origin && !options.place && !options.floor ? BELOW_OPENER : "";
}

/**
 * Where a menu with no coordinates of its own opens on an engine that cannot anchor it: below its
 * opener, leading edges aligned — the same corner the placement names.
 */
function belowOpener(opener: HTMLElement | null | undefined): ViewportPoint {
  if (!opener) {
    return { x: 0, y: 0 };
  }
  const box = rectOf(opener);
  return { x: Math.round(box.left), y: Math.round(box.bottom) };
}

function project(row: MenuRowProjection, depth = 0): ProjectedRow {
  const children = depth === 0 ? (row.children ?? []).map((child) => project(child, 1)) : [];
  return {
    ...row,
    checked: row.checked ?? "",
    children,
    chord: row.chord ?? "",
    enabled: !row.disabled,
    haspopup: children.length > 0,
    noChord: !row.chord,
    noDivider: !row.dividerAbove,
    requires: row.requires ?? "",
    submenuLabel: row.submenuLabel ?? row.title,
  };
}

/** The row, at either level, a select event's detail names. */
function rowById(rows: readonly ProjectedRow[], id: string): ProjectedRow | undefined {
  for (const row of rows) {
    if (row.id === id) {
      return row;
    }
    const child = row.children.find((c) => c.id === id);
    if (child) {
      return child;
    }
  }
  return undefined;
}

/**
 * Open a menu.
 *
 * @param {OpenMenuOptions} options
 * @returns {MenuHandle}
 */
export function openMenu(options: OpenMenuOptions): MenuHandle {
  const slot = getLayerSlot("popover", options.region);
  const controller = new AbortController();
  let menu: MenuElement | null = null;
  let dispose: (() => void) | null = null;
  let closed = false;

  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    controller.abort();
    dispose?.();
    dispose = null;
    clearLayerSlot("popover", options.region);
    restoreFocus(options.opener ?? null);
    options.onClosed?.(handle);
  };

  /* `place` is first asked before anything is laid out, so it is handed an empty box: a real
     `DOMRect` whose every edge and dimension is zero. */
  const initial = options.place
    ? options.place(new DOMRect())
    : (options.origin ?? belowOpener(options.opener));
  const scope: MenuScope = reactive<MenuScope>({
    floor: options.floor?.() ?? 0,
    label: options.label,
    placement: placementOf(options),
    rows: options.rows.map((row) => project(row)),
    select: (_scope: JxScope, event: Event) => {
      /* SAFETY: `menu.json` binds this handler to `onselect` alone, and a row's `select` is raised
         by the runtime's `dispatchEvent` statement in `jx-menu-item.json`, which always constructs
         a `CustomEvent` whose `detail` is the row's value. */
      const id = String((event as CustomEvent).detail);
      const row = rowById(scope.rows, id);
      if (!row) {
        return;
      }
      // Run BEFORE closing: a command reads its target synchronously on entry, and closing the
      // Menu is what clears it.
      handBackKeyboard(menu, options.opener ?? null);
      if (row.run) {
        row.run();
      } else {
        options.run?.(id);
      }
      handle.close();
    },
    x: initial.x,
    y: initial.y,
  });

  /** Put the panel where `place` says, from its box as laid out now. */
  const place = (): void => {
    if (closed || !menu || !options.place) {
      return;
    }
    const at = options.place(rectOf(menu));
    scope.x = at.x;
    scope.y = at.y;
  };

  /* Read through a call, not the property path: `close()` can abort the controller while the menu
     is awaiting `jx-ready`, and a direct test after that `await` would be narrowed to the value the
     test before it saw. */
  const aborted = (): boolean => controller.signal.aborted;

  const ready = (async () => {
    const mounted = await mountSurface("menu", scope, slot, { signal: controller.signal });
    if (aborted()) {
      // Closed before the document finished mounting; the runtime already disposed it.
      return;
    }
    ({ dispose } = mounted);
    // The document's root IS the menu, and a custom element connects asynchronously: `jx-ready` is
    // The menu saying its `popover` attribute is on and it may be shown.
    // SAFETY: `menu.json`'s root definition carries `tagName: "jx-menu"`, so the mounted root is
    // The kit's menu element, which reflects `open`, `x` and `y` and inherits `showPopover`.
    menu = mounted.root as MenuElement;
    menu.addEventListener("toggle", (event) => {
      if (event.newState === "closed") {
        finish();
      }
    });
    if (!menu.hasAttribute("popover")) {
      await new Promise<void>((resolve) => {
        menu!.addEventListener("jx-ready", () => resolve(), { once: true });
      });
    }
    if (aborted()) {
      return;
    }
    await pointersReleased(controller.signal);
    if (aborted()) {
      return;
    }
    const source =
      options.opener instanceof HTMLElement && options.opener !== document.body
        ? options.opener
        : undefined;
    menu.showPopover(source ? { source } : undefined);
    // Showing a popover lays it out, so the first pass measures a real box; the second, a frame
    // Later, catches a font or an image that landed after.
    place();
    requestAnimationFrame(place);
  })();

  const handle: MenuHandle = {
    close: () => {
      if (closed) {
        return;
      }
      if (menu?.open) {
        menu.hidePopover();
      }
      finish();
    },
    host: slot,
    ready,
    setRows: (rows) => {
      if (closed) {
        return;
      }
      // The row whose submenu holds the caret, if one does: should the new rows take that submenu
      // Away with them (a row with no children owns none), the caret goes back to the row.
      const active = document.activeElement;
      const holder = active?.closest("jx-menu");
      const ownerId =
        holder && holder !== menu
          ? holder.parentElement?.closest<HTMLElement>("jx-menu-item")?.dataset.commandId
          : undefined;
      scope.rows = rows.map((row) => project(row));
      // The rows reconcile in microtasks of their own — the submenu's rows in one queued by the
      // Row's — so the caret is checked once all of them have run, from the task queue.
      setTimeout(() => {
        if (closed || !menu || menu.contains(document.activeElement)) {
          return;
        }
        const owner = ownerId
          ? menu.querySelector<HTMLElement>(`jx-menu-item[data-command-id="${ownerId}"]`)
          : null;
        const submenu = owner?.querySelector<MenuElement>("jx-menu") ?? null;
        // The submenu that held the caret is gone with its rows: its owner takes the caret.
        // Still up with rows left: the caret stays inside it, on the first.
        if (owner && !(submenu?.open && submenu.querySelector("jx-menu-item"))) {
          owner.focus();
        } else {
          ensureCaret(menu);
        }
      }, 0);
    },
  };
  return handle;
}

/**
 * The pointers pressed in this document and not yet released, by `pointerId`.
 *
 * Read by {@link pointersReleased}. Window listeners in the capture phase, so the record is current
 * before any handler in the document runs, a `contextmenu` handler included. A press in the canvas
 * iframe is never seen here, and needs not be: that release lands in the iframe's document, which
 * cannot light-dismiss a popover in this one. Bound at load, so the press that asks for the first
 * menu is already recorded; not at all without a window, where the docs build imports this module
 * for the command catalog and nothing is ever pressed.
 */
const pressedPointers = new Set<number>();
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (event) => pressedPointers.add(event.pointerId), true);
  window.addEventListener("pointerup", (event) => pressedPointers.delete(event.pointerId), true);
  window.addEventListener(
    "pointercancel",
    (event) => pressedPointers.delete(event.pointerId),
    true,
  );
  // A release outside a window that lost focus may never arrive.
  window.addEventListener("blur", () => pressedPointers.clear());
}

/**
 * Settle once no pointer is held down in this document, or when `signal` aborts.
 *
 * A menu shown while the button that asked for it is still down is light-dismissed by that button's
 * release. On Linux and macOS `contextmenu` fires on the PRESS, so every right-click menu opened
 * with the button held, and the release that followed is a `pointerup` outside the popover. The
 * HTML light-dismiss algorithm hides every `auto` popover on it, before the event reaches any
 * listener, so it cannot be cancelled. Chromium 156 exempts a non-primary button and Electron 43's
 * Chromium does not: in the desktop app the menu flashed and vanished. Waiting for the release is
 * what Windows does natively, where `contextmenu` fires on it; a menu opened by a click or a key
 * has nothing held and is shown at once.
 */
function pointersReleased(signal: AbortSignal): Promise<void> {
  if (pressedPointers.size === 0 || signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const waiting = new AbortController();
    const settle = (): void => {
      if (pressedPointers.size === 0 || signal.aborted) {
        waiting.abort();
        resolve();
      }
    };
    // Registered after the record's own listeners, so each sees the record already updated.
    const options = { capture: true, signal: waiting.signal };
    window.addEventListener("pointerup", settle, options);
    window.addEventListener("pointercancel", settle, options);
    window.addEventListener("blur", settle, { signal: waiting.signal });
    signal.addEventListener("abort", settle, { signal: waiting.signal });
  });
}

/**
 * Give the keyboard back to the opener BEFORE a chosen row runs, while the menu still holds it.
 *
 * A row that opens a modal dialog (Open Project Settings, a confirmation) calls `showModal()` from
 * inside its run, and the platform records whatever is focused at that moment as the element to
 * restore when the dialog closes. Left alone that is the menu ROW, which is gone by the time the
 * dialog closes, so Escape dropped focus on `<body>` instead of the gear that opened the menu. The
 * opener is where focus goes when the menu closes anyway ({@link restoreFocus}); doing it first
 * only makes it the element the dialog remembers. Only when the menu holds focus, for the reason
 * `restoreFocus` gives.
 */
function handBackKeyboard(menu: MenuElement | null, opener: HTMLElement | null): void {
  if (menu?.contains(document.activeElement) && opener?.isConnected && opener !== document.body) {
    opener.focus({ preventScroll: true });
  }
}

/**
 * Hand the keyboard back to the opener, only when the menu still held it: an outside CLICK has
 * already moved focus somewhere the author chose, and yanking it back would fight them. In a
 * browser the platform does this itself when an `auto` popover hides; this covers the test DOM and
 * a popover hidden programmatically.
 */
function restoreFocus(opener: HTMLElement | null): void {
  const active = document.activeElement;
  if (opener?.isConnected && (!active || active === document.body)) {
    opener.focus();
  }
}
