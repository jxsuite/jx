/**
 * The menu surface: a `jx-menu` of command-record projections, mounted into a popover layer slot.
 *
 * This is the first Studio surface rendered as a Jx document (specs/studio-ui-guidelines.md §6,
 * §9.3): `menu.json` is the markup, ARIA and style, and this adapter is the decisions — which
 * records, what they print, where the panel opens, what runs on select. The kit owns the menu
 * contract (roving focus, typeahead, submenus, light dismissal, Escape) through the platform's own
 * popover, so nothing here binds a key or a document listener.
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
import type { JxDocument } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import { ensureCaret } from "@jxsuite/ui/behaviors/menu";
import { reactive } from "../reactivity";
import { clearLayerSlot, getLayerSlot } from "../ui/layers";
import { mountSurface, registerSurface } from "../ui/surface";
import { rectOf } from "../utils/geometry";
import menuDoc from "./menu.json";

registerSurface("menu", menuDoc as unknown as JxDocument);

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
  origin?: { x: number; y: number };
  /**
   * Where the panel opens as a function of its measured box: run once the popover is shown and
   * again a frame later, so a menu that hangs off a control can put its bottom flush with a floor.
   */
  place?: (box: DOMRect) => { x: number; y: number };
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
interface MenuScope extends Record<string, unknown> {
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
function belowOpener(opener: HTMLElement | null | undefined): { x: number; y: number } {
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

const ZERO_BOX = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
  x: 0,
  y: 0,
} as DOMRect;

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

  const initial = options.place
    ? options.place(ZERO_BOX)
    : (options.origin ?? belowOpener(options.opener));
  const scope: MenuScope = reactive({
    floor: options.floor?.() ?? 0,
    label: options.label,
    placement: placementOf(options),
    rows: options.rows.map((row) => project(row)),
    select: (_scope: JxScope, event: Event) => {
      const id = String((event as CustomEvent).detail);
      const row = rowById(scope.rows, id);
      if (!row) {
        return;
      }
      // Run BEFORE closing: a command reads its target synchronously on entry, and closing the
      // Menu is what clears it.
      if (row.run) {
        row.run();
      } else {
        options.run?.(id);
      }
      handle.close();
    },
    x: initial.x,
    y: initial.y,
  }) as MenuScope;

  /** Put the panel where `place` says, from its box as laid out now. */
  const place = (): void => {
    if (closed || !menu || !options.place) {
      return;
    }
    const at = options.place(rectOf(menu));
    scope.x = at.x;
    scope.y = at.y;
  };

  const ready = (async () => {
    const mounted = await mountSurface("menu", scope, slot, { signal: controller.signal });
    if (controller.signal.aborted) {
      // Closed before the document finished mounting; the runtime already disposed it.
      return;
    }
    ({ dispose } = mounted);
    // The document's root IS the menu, and a custom element connects asynchronously: `jx-ready` is
    // The menu saying its `popover` attribute is on and it may be shown.
    menu = mounted.root as MenuElement;
    menu.addEventListener("toggle", (event) => {
      if ((event as { newState?: string }).newState === "closed") {
        finish();
      }
    });
    if (!menu.hasAttribute("popover")) {
      await new Promise<void>((resolve) => {
        menu!.addEventListener("jx-ready", () => resolve(), { once: true });
      });
    }
    if (controller.signal.aborted) {
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
