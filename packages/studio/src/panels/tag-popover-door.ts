/// <reference lib="dom" />
/**
 * The way in to the tag popover (studio.md §6.9), apart from the popover's own flow.
 *
 * A chip on the canvas, a Bound pill and a chip in the Inspector each open one tag's popover, and
 * each knows something the tab's state does not hold: where on screen it was pressed, and what
 * should take the keyboard back. This module is that hand-off and nothing else. A door says where
 * it stands, then runs `canvas.setTagPopover` like any script; the flow (`dynamic-tag.ts`) takes
 * the hint when the state it watches changes.
 *
 * It is a module of its own so the doors do not import the flow: the flow reads the Data panel's
 * list of sources, and the Inspector, which is one of the doors, is read by that panel.
 *
 * @docs studio/editing/dynamic-tags
 */

import { runActiveReported } from "../commands/run-reported";
import { activeTab } from "../workspace/workspace";

import type { TagAddress } from "../editor/dynamic-tags";
import type { ViewportPoint } from "../surfaces/menu";

/** The gap between what was pressed and the panel under it, in pixels. */
export const TAG_POPOVER_GAP = 6;

/** What a door says about the popover it is about to open. Good for one open, then gone. */
export interface TagPopoverHint {
  /**
   * Where the panel goes: its top-left corner, and in `above` the top edge of what was pressed,
   * which the panel is put over when it does not fit under. Null lets the flow choose.
   */
  at: (ViewportPoint & { above?: number }) | null;
  /** What takes focus back when the popover closes; the canvas when there is none. */
  returnFocus: HTMLElement | null;
}

let pending: TagPopoverHint | null = null;
let replace: (() => void) | null = null;

/** The hint the last door left, taken: a second ask answers null. */
export function takeTagPopoverHint(): TagPopoverHint | null {
  const hint = pending;
  pending = null;
  return hint;
}

/** Register what places the panel again when the tag a door names is the one already open. */
export function setTagPopoverReplacer(fn: (() => void) | null): void {
  replace = fn;
}

/** Whether two addresses name one tag. */
function sameAddress(a: TagAddress, b: TagAddress): boolean {
  return (
    a.index === b.index &&
    JSON.stringify(a.path) === JSON.stringify(b.path) &&
    JSON.stringify(a.slot) === JSON.stringify(b.slot)
  );
}

/**
 * Open the popover of one tag from a place on screen. The place and what takes focus back are a
 * hint for this open; which tag is open is the tab's, written by the command.
 */
export function openTagPopover(
  address: TagAddress,
  hint: { at?: ViewportPoint & { above?: number }; returnFocus?: HTMLElement | null } = {},
): void {
  pending = { at: hint.at ?? null, returnFocus: hint.returnFocus ?? null };
  const open = activeTab.value?.session.ui.tagPopover;
  if (open && sameAddress(open, address)) {
    // The same tag pressed again is the same state, so nothing the flow watches moves.
    replace?.();
    return;
  }
  void runActiveReported(
    "canvas.setTagPopover",
    { tag: { index: address.index, path: [...address.path], slot: [...address.slot] } },
    "Dynamic tag",
  );
}

/** Close the popover, by the same command a script would use. */
export function closeTagPopover(): void {
  if (activeTab.value?.session.ui.tagPopover) {
    void runActiveReported("canvas.setTagPopover", { tag: null }, "Dynamic tag");
  }
}
