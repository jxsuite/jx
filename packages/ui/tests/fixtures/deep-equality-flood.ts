/**
 * A deliberately failing test, run as a child process by `dom-guards.test.ts` and never by the
 * suite itself (no `.test.` in the name). Two live, mounted `jx-tabs` strips compared with
 * `toEqual`: the comparison measured hanging Bun's diff printer for over 100 seconds with no
 * output. The shared preload's deep-equality guard is what makes it fail at once, and the same
 * holds for a strip inside a class instance and for one a mock recorded (each measured silent until
 * killed at 20 seconds without the guard).
 */
import "../with-dom.ts";

import { expect, mock, test } from "bun:test";

import { mountedStrip } from "./strip.ts";

test("two live strips are not deeply equal", async () => {
  const first = await mountedStrip();
  const second = await mountedStrip();
  expect(first).toEqual(second);
});

test("a class instance holding a live strip is refused", async () => {
  class Box {
    readonly el: Element | null;
    constructor(el: Element | null) {
      this.el = el;
    }
  }
  expect(new Box(await mountedStrip())).toEqual(new Box(await mountedStrip()));
});

test("a mock that recorded a live strip is refused", async () => {
  const seen = mock((_strip: Element | null) => 0);
  seen(await mountedStrip());
  expect(seen).toHaveBeenCalledWith(await mountedStrip());
});
