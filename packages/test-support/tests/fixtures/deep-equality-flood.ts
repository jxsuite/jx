/**
 * Deliberately failing tests, run as a child process by `dom-equality.test.ts` and never by the
 * suite itself (no `.test.` in the name). Two distinct elements, each holding a large reachable
 * graph the way a live kit element holds its reactive state, compared with `toEqual`: the shape
 * that hangs Bun's diff printer. The package preload's guard is what makes it fail at once. The
 * plain-object failure beside it proves everything else still reaches Bun's own diff.
 */
import "../with-dom.ts";

import { expect, test } from "bun:test";

interface Graph {
  next: Graph | null;
  peers: Graph[];
  payload: string;
}

/** A wide, deep, cyclic object graph hung off an element, like a reactive effect graph. */
function heavy(tag: string): Element {
  const el = document.createElement(tag);
  document.body.append(el);
  let head: Graph | null = null;
  const all: Graph[] = [];
  for (let index = 0; index < 2000; index++) {
    const node: Graph = { next: head, payload: `effect ${index}`, peers: all };
    all.push(node);
    head = node;
  }
  Object.assign(el, { _state: { owner: el, document, head } });
  return el;
}

test("two live elements compared deeply are refused", () => {
  expect(heavy("jx-tabs")).toEqual(heavy("jx-tabs"));
});

test("an element inside a record compared deeply is refused", () => {
  expect({ host: { strip: heavy("jx-tabs") } }).toStrictEqual({
    host: { strip: heavy("jx-tabs") },
  });
});

test("plain objects still fail with Bun's diff", () => {
  expect({ count: 1 }).toEqual({ count: 2 });
});
