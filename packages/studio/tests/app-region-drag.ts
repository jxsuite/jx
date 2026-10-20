/**
 * A model of how the frameless desktop window decides whether a press starts a window drag.
 *
 * Chromium resolves `-webkit-app-region` per element, nearest declaration first: a control inside a
 * drag region only receives the press when it declares `no-drag` itself. A regression guard for
 * commandbar.ts must encode that ancestry rule rather than check that some CSS rule exists, so this
 * walks up from the target and lets the nearest `app-region-drag` / `app-region-no-drag` class (the
 * literals shell-frame.json maps onto the property) decide.
 */

const DRAG_CLASS = "app-region-drag";
const NO_DRAG_CLASS = "app-region-no-drag";

/** True when `target`'s nearest app-region class, itself or an ancestor, marks a drag handle. */
export function isAppRegionDragTarget(target: EventTarget | null): boolean {
  let element: Element | null = target instanceof Element ? target : null;

  while (element) {
    if (element.classList.contains(NO_DRAG_CLASS)) {
      return false;
    }
    if (element.classList.contains(DRAG_CLASS)) {
      return true;
    }
    element = element.parentElement;
  }

  return false;
}
