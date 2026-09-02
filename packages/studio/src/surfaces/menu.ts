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
 * @docs studio/interface/canvas
 */
import type { JxDocument } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import { clearLayerSlot, getLayerSlot } from "../ui/layers";
import { mountSurface, registerSurface } from "../ui/surface";
import menuDoc from "./menu.json";

registerSurface("menu", menuDoc as unknown as JxDocument);

/**
 * What a row prints: a projection of one command record, decided by the adapter that opens the
 * menu.
 */
export interface MenuRowProjection {
  /** The command id; the row's `value`, and what `run` receives. */
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
}

export interface OpenMenuOptions {
  rows: readonly MenuRowProjection[];
  /** The menu's accessible name. */
  label: string;
  /** Where the panel opens, in viewport pixels. */
  origin: { x: number; y: number };
  /**
   * The popover slot id; the region becomes `overlay.menu:<id>`, so the context menu passes
   * `context`.
   */
  region: string;
  /** Runs the selected row's command. Called before the menu closes. */
  run: (id: string) => void;
  /** What held the keyboard before the menu took it, handed back when the menu closes. */
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
}

type MenuElement = HTMLElement & { open?: boolean };

/** The scope shape `menu.json` reads: rows with their derived flags, the position, and `select`. */
interface MenuScope extends Record<string, unknown> {
  rows: (MenuRowProjection & { noDivider: boolean; noChord: boolean; enabled: boolean })[];
  label: string;
  x: number;
  y: number;
  select: (scope: JxScope, event: Event) => void;
}

/**
 * Open a menu at a point.
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

  const scope: MenuScope = {
    label: options.label,
    rows: options.rows.map((row) => ({
      ...row,
      chord: row.chord ?? "",
      enabled: !row.disabled,
      noChord: !row.chord,
      noDivider: !row.dividerAbove,
      requires: row.requires ?? "",
    })),
    select: (_scope, event) => {
      const id = String((event as CustomEvent).detail);
      // Run BEFORE closing: a command reads its target synchronously on entry, and closing the
      // Menu is what clears it.
      options.run(id);
      handle.close();
    },
    x: options.origin.x,
    y: options.origin.y,
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
    if (!controller.signal.aborted) {
      menu.showPopover();
    }
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
