/// <reference lib="dom" />
/**
 * The slash menu, as a Jx document over the kit — the mount seam, and nothing else.
 *
 * `slash-menu.json` is the markup, the ARIA and the style; `editor/slash-menu.ts` is the flow —
 * which commands are on offer, what the filter matches, which row is active and what a pick does.
 *
 * **It is a listbox, and it is deliberately not `surfaces/menu.json`.** Every other Studio menu is
 * that surface, and the rule is that a second list of actions is a defect (§12.5) — but the two
 * differ on the one thing a menu cannot give up. `jx-menu` owns the keyboard: showing it moves the
 * caret onto its first row, which is the whole point of a roving-focus menu. This panel filters a
 * caret that is somewhere else — inside the canvas's `contenteditable`, and usually inside the
 * canvas IFRAME — and every character typed after the `/` has to keep landing there, so the panel
 * that takes the keyboard is the panel that ends the interaction it exists to serve. What is left
 * once focus is off the table is a combobox popup: `role="listbox"`, an active row marked with
 * `aria-selected`, and an external driver for the arrow keys.
 *
 * The one case with no caret to protect is the menu opened BY NAME — `insert.openSlashMenu`, the
 * palette, a toolbar button — and that one grows a filter field of its own, which is the element
 * that carries `aria-activedescendant` and makes the whole thing announce properly.
 *
 * The panel is a `jx-popover`, so light dismissal, Escape on the topmost popover and the top layer
 * are the platform's; the hand-rolled `mousedown` capture listener that used to do the first of
 * those is gone with the Spectrum markup.
 *
 * @docs studio/editing/slash-commands
 */

import { reactive } from "../reactivity";
import { clearLayerSlot, getLayerSlot } from "../ui/layers";
import { mountSurface, registerSurface } from "../ui/surface";
import slashMenuDoc from "./slash-menu.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("slash-menu", slashMenuDoc as unknown as JxDocument);

/** The popover slot id; the region is `overlay.menu:slash-menu`, which is what the shots crop. */
const SLOT = "slash-menu";

/** One offer, as the document reads it. */
export interface SlashMenuRow extends Record<string, unknown> {
  /** The element's tag — unique in the list, so it is the repeater's key. */
  key: string;
  /** Where the row sits in the filtered list: what a key, a click and a hover all address. */
  index: number;
  label: string;
  description: string;
  /** Whether {@link SlashMenuRow.description} has anything in it; `$switch` is the conditional. */
  hasDescription: boolean;
}

/** What the panel is showing right now. */
export interface SlashMenuView {
  /** Where the panel's inline-start edge sits, in viewport pixels. */
  x: number;
  /** Where its block-start edge sits. */
  y: number;
  /** Whether the panel carries a filter field of its own — true only when opened by name. */
  showFilter: boolean;
  /** What that field contains. */
  filter: string;
  rows: SlashMenuRow[];
  /** The highlighted row, as an index into {@link SlashMenuView.rows}. */
  activeIndex: number;
}

/** What a gesture on the panel asks of the flow. Read once, when the scope is made. */
export interface SlashMenuActions {
  /** The filter field changed. */
  input: (value: string) => void;
  /** A row was clicked. */
  activateRow: (index: number) => void;
  /** The pointer entered a row; the highlight follows it. */
  hover: (index: number) => void;
  /** The panel closed on its own — light dismissal, or Escape reaching the platform. */
  dismissed: () => void;
}

export interface SlashMenuSurface {
  /** The layer slot the panel is mounted in. */
  readonly host: HTMLElement;
  /** Settles once the document is mounted and the panel shown, or it was closed first. */
  readonly ready: Promise<void>;
  /** Bring the standing panel up to date. An assignment; the mount is never rebuilt. */
  readonly update: (view: SlashMenuView) => void;
  /** Put the caret in the filter field, when there is one. */
  readonly focusFilter: () => void;
  /** Scroll the active row into view — a measurement, which is why it stays imperative. */
  readonly revealActive: () => void;
  /** Close the panel now; the slot is emptied before this returns. */
  readonly close: () => void;
}

/** The scope `slash-menu.json` reads. */
interface SlashMenuScope extends Record<string, unknown> {
  x: number;
  y: number;
  showFilter: boolean;
  filter: string;
  rows: SlashMenuRow[];
  activeIndex: number;
  activeId: string;
  isEmpty: boolean;
  expanded: boolean;
  input: (value: string) => void;
  activateRow: (index: number) => void;
  hover: (index: number) => void;
}

type PopoverElement = HTMLElement & {
  open?: boolean;
  showPopover: (options?: { source?: Element }) => void;
  hidePopover: () => void;
};

/** The id `aria-activedescendant` names — the same one the row stamps on itself. */
function optionId(index: number): string {
  return `slash-menu-option-${index}`;
}

/**
 * Open the panel.
 *
 * @param {SlashMenuView} view What it shows to begin with.
 * @param {SlashMenuActions} actions What each gesture does.
 * @param {Element | null} [anchor] The element it was opened from, when the caller has one in this
 *   realm. It becomes the popover's invoker, so the platform restores focus to it on close and a
 *   press on it does not light-dismiss the panel its own click is about to open.
 * @returns {SlashMenuSurface}
 */
export function openSlashMenuSurface(
  view: SlashMenuView,
  actions: SlashMenuActions,
  anchor?: Element | null,
): SlashMenuSurface {
  const slot = getLayerSlot("popover", SLOT);
  const controller = new AbortController();
  let panel: PopoverElement | null = null;
  let mounted: SurfaceHandle | null = null;
  let closed = false;

  const scope = reactive<SlashMenuScope>({
    activateRow: (index: number) => {
      actions.activateRow(index);
    },
    activeId: optionId(view.activeIndex),
    activeIndex: view.activeIndex,
    expanded: view.rows.length > 0,
    filter: view.filter,
    hover: (index: number) => {
      actions.hover(index);
    },
    input: (value: string) => {
      actions.input(value);
    },
    isEmpty: view.rows.length === 0,
    rows: [...view.rows],
    showFilter: view.showFilter,
    x: view.x,
    y: view.y,
  }) as SlashMenuScope;

  const finish = (fromPlatform: boolean): void => {
    if (closed) {
      return;
    }
    closed = true;
    controller.abort();
    mounted?.dispose();
    mounted = null;
    clearLayerSlot("popover", SLOT);
    if (fromPlatform) {
      actions.dismissed();
    }
  };

  const ready = (async () => {
    const surface = await mountSurface("slash-menu", scope, slot, { signal: controller.signal });
    if (controller.signal.aborted) {
      return;
    }
    mounted = surface;
    panel = surface.root as PopoverElement;
    panel.addEventListener("toggle", (event) => {
      if ((event as { newState?: string }).newState === "closed") {
        finish(true);
      }
    });
    // A custom element connects asynchronously: `jx-ready` is the panel saying its `popover`
    // Attribute is on and it may be shown.
    if (!panel.hasAttribute("popover")) {
      await new Promise<void>((resolve) => {
        panel!.addEventListener("jx-ready", () => resolve(), { once: true });
      });
    }
    if (controller.signal.aborted) {
      return;
    }
    panel.showPopover(anchor instanceof HTMLElement ? { source: anchor } : undefined);
  })();

  return {
    close: () => {
      if (closed) {
        return;
      }
      if (panel?.open) {
        panel.hidePopover();
      }
      finish(false);
    },
    focusFilter: () => {
      slot.querySelector<HTMLInputElement>('[part="filter"]')?.focus();
    },
    host: slot,
    ready,
    revealActive: () => {
      slot.querySelector('[part="option"][data-selected]')?.scrollIntoView({ block: "nearest" });
    },
    update: (next) => {
      if (closed) {
        return;
      }
      scope.x = next.x;
      scope.y = next.y;
      scope.showFilter = next.showFilter;
      scope.filter = next.filter;
      scope.rows = [...next.rows];
      scope.activeIndex = next.activeIndex;
      scope.activeId = optionId(next.activeIndex);
      scope.isEmpty = next.rows.length === 0;
      scope.expanded = next.rows.length > 0;
    },
  };
}
