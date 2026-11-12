/**
 * Chips in the editing host (src/canvas/iframe-chips.ts, studio.md §4.5): which chip a caret is
 * beside, where a caret stands on either side of one, and which chips an input took.
 *
 * Pure DOM traversal, so happy-dom exercises all of it. Whether an engine DRAWS a caret at a chip
 * that ends its block is not something a test DOM can say; that was settled in Chromium.
 */
import "./with-dom.js";
import { afterEach, describe, expect, test } from "bun:test";
import {
  caretBeside,
  chipBeside,
  chipSources,
  chipSourcesBetween,
  chipsIn,
  removeChip,
  removedSources,
} from "../src/canvas/iframe-chips";
import { describeNode } from "@jxsuite/test-support/inspect-dom";

/** A chip's markup: closed to the caret, standing for `source`, showing `value`. */
const chip = (source: string, value = "v"): string =>
  `<data data-jx-tag="${source}" contenteditable="false">${value}</data>`;

/** Mount `html` as the content of one block and return the block. */
function block(html: string): HTMLElement {
  const p = document.createElement("p");
  p.innerHTML = html;
  document.body.append(p);
  return p;
}

/** The chip a caret at (`node`, `offset`) is beside, by the expression it stands for. */
function beside(root: HTMLElement, node: Node | null, offset: number, side: -1 | 1): string | null {
  if (!node) {
    throw new TypeError("expected a node");
  }
  const found = chipBeside(root, node, offset, side);
  return found instanceof HTMLElement ? (found.dataset.jxTag ?? null) : null;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("chipBeside", () => {
  test("a caret at the edge of a text node is beside the chip next to it", () => {
    const p = block(`By ${chip("${a}")} on`);
    const [lead, , tail] = p.childNodes;
    expect(beside(p, lead!, 3, 1)).toBe("${a}");
    expect(beside(p, tail!, 0, -1)).toBe("${a}");
    // A character between the caret and the chip means it is beside the character.
    expect(beside(p, lead!, 2, 1)).toBeNull();
    expect(beside(p, tail!, 1, -1)).toBeNull();
    // And the other way from the same spot there is text, not a chip.
    expect(beside(p, lead!, 3, -1)).toBeNull();
  });

  test("an element-anchored caret reads the child on that side", () => {
    const p = block(`${chip("${a}")}${chip("${b}")}`);
    expect(beside(p, p, 1, -1)).toBe("${a}");
    expect(beside(p, p, 1, 1)).toBe("${b}");
    expect(beside(p, p, 0, -1)).toBeNull();
    expect(beside(p, p, 2, 1)).toBeNull();
  });

  test("adjacency is in document order, through inline markup and empty text nodes", () => {
    const p = block(`${chip("${a}")}<em>word</em>`);
    const word = p.querySelector("em")?.firstChild ?? null;
    expect(beside(p, word, 0, -1)).toBe("${a}");
    // An empty text node between the caret and the chip is not something to be beside.
    p.querySelector("data")?.after(document.createTextNode(""));
    expect(beside(p, word, 0, -1)).toBe("${a}");
    // From inside an empty wrapper, the walk climbs out to find the neighbour.
    const q = block(`<em></em>${chip("${b}")}`);
    const em = q.querySelector("em");
    expect(beside(q, em, 0, 1)).toBe("${b}");
    expect(beside(q, em, 0, -1)).toBeNull();
  });

  test("a chip inside the text-run element is found from outside it, and the reverse", () => {
    const p = block(`<data data-jx-text="">Hi ${chip("${a}")}</data><em>x</em>`);
    const x = p.querySelector("em")?.firstChild ?? null;
    expect(beside(p, x, 0, -1)).toBe("${a}");
    const hi = p.querySelector("[data-jx-text]")?.firstChild ?? null;
    expect(beside(p, hi, 3, 1)).toBe("${a}");
  });

  test("no chip is beside a position outside the block, or one inside a chip", () => {
    const p = block(`a${chip("${a}")}`);
    const other = block("elsewhere");
    expect(beside(p, other.firstChild, 0, 1)).toBeNull();
    const inside = p.querySelector("data")?.firstChild ?? null;
    expect(beside(p, inside, 0, -1)).toBeNull();
  });
});

describe("caretBeside", () => {
  test("lands in the neighbouring text when there is some", () => {
    const p = block(`By ${chip("${a}")} on`);
    const target = p.querySelector("data");
    if (!target) {
      throw new TypeError("expected a chip");
    }
    const before = caretBeside(target, -1);
    expect([describeNode(before.node), before.offset]).toEqual([describeNode(p.firstChild!), 3]);
    const after = caretBeside(target, 1);
    expect([describeNode(after.node), after.offset]).toEqual([describeNode(p.lastChild!), 0]);
  });

  test("at a block's edge it is the chip's own place among its parent's children", () => {
    const p = block(`${chip("${a}")}${chip("${b}")}`);
    const [first, second] = chipsIn(p);
    const at = (target: Element, side: -1 | 1): number => {
      const position = caretBeside(target, side);
      expect(position.node).toBe(p);
      return position.offset;
    };
    expect(at(first!, -1)).toBe(0);
    expect(at(first!, 1)).toBe(1);
    expect(at(second!, 1)).toBe(2);
    // A detached chip has no parent to stand in.
    const loose = document.createElement("data");
    expect(caretBeside(loose, 1).node).toBe(loose);
  });
});

describe("what an input removed", () => {
  test("chipsIn and chipSources list the outermost chips, in order", () => {
    const p = block(`${chip("${a}")} x <b>${chip("${b}")}</b>`);
    // A chip a binding's value drew inside another is not one of the block's.
    const inner = document.createElement("data");
    inner.dataset.jxTag = "${inner}";
    p.querySelector("data")?.append(inner);
    expect(chipSources(p)).toEqual(["${a}", "${b}"]);
  });

  test("removedSources counts copies: two of one expression with one left is one removal", () => {
    expect(removedSources(["${a}", "${b}", "${a}"], ["${a}", "${b}"])).toEqual(["${a}"]);
    expect(removedSources(["${a}"], ["${a}"])).toEqual([]);
    expect(removedSources(["${a}", "${b}"], [])).toEqual(["${a}", "${b}"]);
    expect(removedSources([], ["${a}"])).toEqual([]);
  });

  test("chipSourcesBetween names the chips a range over document offsets covers", () => {
    // Offsets count a chip as its expression: `ab` 0..2, `${a}` 2..6, `cd` 6..8, `${b}` 8..12.
    const p = block(`ab${chip("${a}", "long value")}cd${chip("${b}")}`);
    expect(chipSourcesBetween(p, 0)).toEqual(["${a}", "${b}"]);
    expect(chipSourcesBetween(p, 2)).toEqual(["${a}", "${b}"]);
    expect(chipSourcesBetween(p, 3)).toEqual(["${b}"]);
    expect(chipSourcesBetween(p, 0, 2)).toEqual([]);
    expect(chipSourcesBetween(p, 0, 3)).toEqual(["${a}"]);
    expect(chipSourcesBetween(p, 0, 9)).toEqual(["${a}", "${b}"]);
  });

  test("removeChip takes the chip out and leaves the caret where it stood", () => {
    const p = block(`By ${chip("${a}")} on`);
    const target = p.querySelector("data");
    if (!target) {
      throw new TypeError("expected a chip");
    }
    expect(removeChip(target)).toBe("${a}");
    expect(p.textContent).toBe("By  on");
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(p);
    expect(selection?.anchorOffset).toBe(1);
    // A chip with no parent is still named, and nothing is moved.
    const loose = document.createElement("data");
    expect(removeChip(loose)).toBe("");
  });
});
