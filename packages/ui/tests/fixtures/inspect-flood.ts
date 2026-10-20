/**
 * A deliberately failing test, run as a child process by `dom-guards.test.ts` and never by the
 * suite itself (no `.test.` in the name). Two live, mounted `jx-tabs` strips, each carrying its
 * reactive state, compared with `toBe`: the shape that once printed 2.8 million lines in CI. The
 * shared preload's compact printer is what keeps its failure message short.
 */
import "../with-dom.ts";

import { expect, test } from "bun:test";

import { mountedStrip } from "./strip.ts";

test("two live strips are not the same element", async () => {
  const first = await mountedStrip();
  const second = await mountedStrip();
  expect(first).toBe(second);
});
