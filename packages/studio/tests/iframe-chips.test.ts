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
  positionPrecedes,
  removeChip,
  removedSources,
  snapSelectionOutOfChips,
} from "../src/canvas/iframe-chips";
import type { SnappableSelection } from "../src/canvas/iframe-chips";
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

describe("a position inside a chip is beside nothing", () => {
  test("the end of one chip's own text is not beside the chip after it", () => {
    const p = block(`a${chip("${a}", "X")}${chip("${b}", "Y")}c`);
    const inside = p.querySelector("data")?.firstChild ?? null;
    // No caret can stand there, so no key pressed there takes the next chip.
    expect(beside(p, inside, 1, 1)).toBeNull();
    expect(beside(p, inside, 0, -1)).toBeNull();
    // From the text before the first chip, and after the second, each is beside its own.
    expect(beside(p, p.firstChild, 1, 1)).toBe("${a}");
    expect(beside(p, p.lastChild, 0, -1)).toBe("${b}");
  });
});

describe("a selection is moved out of a chip in the direction it was made", () => {
  /**
   * A selection from (`anchor`, `anchorOffset`) to (`focus`, `focusOffset`) that records where it
   * is moved to. Not the document's own: happy-dom reports a selection in the order it was set
   * while its `selectionchange` runs, so a backward one cannot be handed over as one.
   */
  function selectionOf(anchor: Node, anchorOffset: number, focus: Node, focusOffset: number) {
    const moves: [Node, number, Node, number][] = [];
    const sel: SnappableSelection = {
      anchorNode: anchor,
      anchorOffset,
      focusNode: focus,
      focusOffset,
      setBaseAndExtent: (a, ao, f, fo) => {
        moves.push([a, ao, f, fo]);
      },
    };
    return { moves, sel };
  }

  /** `ab` + a chip showing "Title" + `cd`; returns the block, its two texts and the chip's text. */
  function around() {
    const p = block(`ab${chip("${t}", "Title")}cd`);
    const [ab, data, cd] = p.childNodes;
    const title = data?.firstChild;
    if (!ab || !cd || !title) {
      throw new TypeError("expected three children");
    }
    return { ab, cd, p, title };
  }

  /** The one move a snap made, with each node named by its tag or its text. */
  function moved(moves: [Node, number, Node, number][]): (string | number)[][] {
    const name = (node: Node): string =>
      node instanceof Element ? node.tagName.toLowerCase() : (node.nodeValue ?? "");
    return moves.map(([a, ao, f, fo]) => [name(a), ao, name(f), fo]);
  }

  test("forward into the chip: the focus goes past it", () => {
    const { ab, p, title } = around();
    const { moves, sel } = selectionOf(ab, 1, title, 2);
    expect(snapSelectionOutOfChips(p, sel)).toBe(true);
    expect(moved(moves)).toEqual([["ab", 1, "p", 2]]);
  });

  test("backward into the chip: the focus goes before it, and is still the focus", () => {
    const { cd, p, title } = around();
    const { moves, sel } = selectionOf(cd, 1, title, 2);
    expect(snapSelectionOutOfChips(p, sel)).toBe(true);
    expect(moved(moves)).toEqual([["cd", 1, "p", 1]]);
  });

  test("backward out of the chip: the anchor goes past it, and is still the anchor", () => {
    const { ab, p, title } = around();
    const { moves, sel } = selectionOf(title, 2, ab, 1);
    expect(snapSelectionOutOfChips(p, sel)).toBe(true);
    expect(moved(moves)).toEqual([["p", 2, "ab", 1]]);
  });

  test("both ends in the chip cover it whole, either way round", () => {
    const { p, title } = around();
    const forward = selectionOf(title, 1, title, 3);
    expect(snapSelectionOutOfChips(p, forward.sel)).toBe(true);
    expect(moved(forward.moves)).toEqual([["p", 1, "p", 2]]);
    const backward = selectionOf(title, 3, title, 1);
    expect(snapSelectionOutOfChips(p, backward.sel)).toBe(true);
    expect(moved(backward.moves)).toEqual([["p", 2, "p", 1]]);
  });

  test("a caret in the chip goes to the nearer edge", () => {
    const { p, title } = around();
    const early = selectionOf(title, 1, title, 1);
    expect(snapSelectionOutOfChips(p, early.sel)).toBe(true);
    expect(moved(early.moves)).toEqual([["ab", 2, "ab", 2]]);
    const late = selectionOf(title, 4, title, 4);
    expect(snapSelectionOutOfChips(p, late.sel)).toBe(true);
    expect(moved(late.moves)).toEqual([["cd", 0, "cd", 0]]);
  });

  test("a selection that touches no chip, or has no ends, is left alone", () => {
    const { ab, cd, p } = around();
    const outside = selectionOf(ab, 1, cd, 1);
    expect(snapSelectionOutOfChips(p, outside.sel)).toBe(false);
    expect(outside.moves).toHaveLength(0);
    const empty: SnappableSelection = {
      anchorNode: null,
      anchorOffset: 0,
      focusNode: null,
      focusOffset: 0,
      setBaseAndExtent: () => {
        throw new Error("moved");
      },
    };
    expect(snapSelectionOutOfChips(p, empty)).toBe(false);
  });

  test("positionPrecedes orders two boundary points by the tree", () => {
    const p = block("ab<b>cd</b>ef");
    const next = block("gh");
    const [ab, bold, ef] = p.childNodes;
    const cd = bold?.firstChild;
    const gh = next.firstChild;
    if (!ab || !ef || !cd || !gh) {
      throw new TypeError("expected the fixture's nodes");
    }
    // The same node: by offset, and a point does not precede itself.
    expect(positionPrecedes(ab, 0, ab, 1)).toBe(true);
    expect(positionPrecedes(ab, 1, ab, 1)).toBe(false);
    expect(positionPrecedes(ab, 2, ab, 1)).toBe(false);
    // Siblings and cousins: by document order, whatever the offsets.
    expect(positionPrecedes(ab, 2, ef, 0)).toBe(true);
    expect(positionPrecedes(ef, 0, ab, 2)).toBe(false);
    expect(positionPrecedes(cd, 2, gh, 0)).toBe(true);
    expect(positionPrecedes(gh, 0, cd, 2)).toBe(false);
    // A point in an ancestor against one inside its child at index 1 (the <b>).
    expect(positionPrecedes(p, 1, cd, 0)).toBe(true);
    expect(positionPrecedes(p, 2, cd, 2)).toBe(false);
    expect(positionPrecedes(cd, 2, p, 2)).toBe(true);
    expect(positionPrecedes(cd, 0, p, 1)).toBe(false);
  });
});
