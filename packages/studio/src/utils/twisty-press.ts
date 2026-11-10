/// <reference lib="dom" />
/**
 * A press on a tree row's twisty is a toggle, and never the start of a drag.
 *
 * The twisty is a 14px target inside a row that is itself draggable. A press drifts a few pixels
 * between `mousedown` and `mouseup`; past the browser's drag threshold it starts a NATIVE drag on
 * the draggable row and no `click` is ever delivered, so a toggle that worked on one try was
 * swallowed on the next. A drag source refuses the drag from its `canDrag`, which pragmatic
 * drag-and-drop answers with `preventDefault()` on `dragstart`, and the click survives.
 *
 * `canDrag` is asked at `dragstart`, and by then the pointer has already moved. So the answer is
 * not read from where the pointer is now but from where the press BEGAN: a capture-phase
 * `pointerdown` records whether it landed on a twisty, and the hit-test at the current point is
 * only the fallback for a drag that began with no pointer press observed (a test, or an assistive
 * technology that synthesises one).
 *
 * @docs studio/design/layers
 */

import { elementAtPoint } from "./geometry";

/** The kit's twisty: the chevron cell at the start of a `jx-tree-item`. */
export const TWISTY_SELECTOR = '[part="twisty"]';

/**
 * Whether the press now in progress began on a twisty, or null while no press has been observed.
 *
 * Null and false are different answers: a press that began elsewhere on the row is a drag the
 * reader meant, and a pointer that drifts onto a twisty on its way (a press on the badge beside it,
 * moving toward the chevron) must not turn it into a refused one.
 */
let pressedOnTwisty: boolean | null = null;
let tracking = false;

/**
 * Start recording where presses begin. Idempotent, and cheap: one capture listener on the document
 * that sets a boolean.
 */
export function trackTwistyPress(): void {
  if (tracking) {
    return;
  }
  tracking = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      pressedOnTwisty =
        event.target instanceof Element && event.target.closest(TWISTY_SELECTOR) !== null;
    },
    true,
  );
}

/**
 * Whether the drag now being asked about began on a twisty.
 *
 * @param input - The pointer position `dragstart` reports
 */
export function dragStartsOnTwisty(input: { clientX: number; clientY: number }): boolean {
  return (
    pressedOnTwisty ??
    elementAtPoint(input.clientX, input.clientY)?.closest(TWISTY_SELECTOR) != null
  );
}
