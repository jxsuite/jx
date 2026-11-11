/**
 * A drag that starts on a twisty is refused, judged by where the PRESS began.
 *
 * `canDrag` is asked at `dragstart`, after the pointer has drifted off the 14px target, so the
 * answer is recorded at `pointerdown` and the hit-test at the current point is only a fallback.
 */
import "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { dragStartsOnTwisty, trackTwistyPress } from "../src/utils/twisty-press";

function press(target: Element): void {
  target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="row"><span part="twisty"><i id="glyph"></i></span><span id="label">Hero</span></div>
  `;
  trackTwistyPress();
});

describe("dragStartsOnTwisty", () => {
  /* Must stay FIRST: the press state is module-level and no later test can return it to "never pressed". */
  test("with no press observed, the point under the pointer decides", () => {
    const glyph = document.querySelector("#glyph")!;
    const original = document.elementFromPoint;
    try {
      document.elementFromPoint = () => glyph;
      expect(dragStartsOnTwisty({ clientX: 1, clientY: 1 })).toBe(true);
      document.elementFromPoint = () => null;
      expect(dragStartsOnTwisty({ clientX: 1, clientY: 1 })).toBe(false);
    } finally {
      document.elementFromPoint = original;
    }
  });

  test("a press that began on the twisty refuses the drag wherever the pointer is by dragstart", () => {
    press(document.querySelector("#glyph")!);
    expect(dragStartsOnTwisty({ clientX: 400, clientY: 400 })).toBe(true);
  });

  test("the next press elsewhere on the row clears it, so the row still drags", () => {
    press(document.querySelector("#glyph")!);
    press(document.querySelector("#label")!);
    expect(dragStartsOnTwisty({ clientX: 400, clientY: 400 })).toBe(false);
  });

  test("a press that began off the twisty is not turned into a refusal by a drift onto it", () => {
    press(document.querySelector("#label")!);
    const glyph = document.querySelector("#glyph")!;
    const original = document.elementFromPoint;
    try {
      document.elementFromPoint = () => glyph;
      expect(dragStartsOnTwisty({ clientX: 1, clientY: 1 })).toBe(false);
    } finally {
      document.elementFromPoint = original;
    }
  });

  test("tracking is idempotent: a second call adds no second listener", () => {
    trackTwistyPress();
    trackTwistyPress();
    press(document.querySelector("#glyph")!);
    expect(dragStartsOnTwisty({ clientX: 0, clientY: 0 })).toBe(true);
  });
});
