/**
 * Character-offset slicing of block content. Pure data in, pure data out — no DOM, no document —
 * which is what makes the awkward cases (a bold run cut in half, a link straddling a boundary, a
 * `<br>` inside the range) cheap to pin down exactly.
 */
import { describe, expect, test } from "bun:test";
import {
  contentLength,
  contentOf,
  normalizeContent,
  piecesOf,
  Printed,
  sliceContent,
  spliceAcross,
  storePieces,
  toStored,
} from "../src/editor/content-slice";
import type { Content } from "../src/editor/content-slice";

/** "he" + bold("ll") + "o" — length 5, with a boundary inside the bold run. */
const RICH: Content = ["he", { tagName: "strong", textContent: "ll" }, "o"];

describe("contentOf", () => {
  test("reads either storage shape", () => {
    expect(contentOf({ tagName: "p", textContent: "abc" })).toEqual(["abc"]);
    expect(
      contentOf({ children: ["a", { tagName: "em", textContent: "b" }], tagName: "p" }),
    ).toEqual(["a", { tagName: "em", textContent: "b" }]);
  });

  test("an empty or absent block has no content", () => {
    expect(contentOf({ tagName: "p", textContent: "" })).toEqual([]);
    expect(contentOf({ tagName: "p" })).toEqual([]);
    expect(contentOf(null)).toEqual([]);
  });
});

describe("contentLength", () => {
  test("counts rendered characters through nesting", () => {
    expect(contentLength(RICH)).toBe(5);
    expect(
      contentLength([
        { children: ["a", { tagName: "code", textContent: "bc" }], tagName: "strong" },
      ]),
    ).toBe(3);
  });

  test("a void inline contributes nothing", () => {
    expect(contentLength([{ tagName: "br" }])).toBe(0);
  });
});

describe("sliceContent", () => {
  test("cuts plain text", () => {
    expect(sliceContent(["hello"], 1, 4)).toEqual(["ell"]);
  });

  test("cuts an inline element in half, keeping it an element", () => {
    // The whole point: "he**ll**o" cut at 3 keeps a SHORTER BOLD RUN, not plain text.
    expect(sliceContent(RICH, 0, 3)).toEqual(["he", { tagName: "strong", textContent: "l" }]);
    expect(sliceContent(RICH, 3, 5)).toEqual([{ tagName: "strong", textContent: "l" }, "o"]);
  });

  test("keeps a fully-contained element whole", () => {
    expect(sliceContent(RICH, 2, 4)).toEqual([{ tagName: "strong", textContent: "ll" }]);
  });

  test("drops elements entirely outside the range", () => {
    expect(sliceContent(RICH, 0, 2)).toEqual(["he"]);
    expect(sliceContent(RICH, 4, 5)).toEqual(["o"]);
  });

  test("preserves an element's other attributes when clipping it", () => {
    const link: Content = [
      "go ",
      { attributes: { href: "/spec" }, tagName: "a", textContent: "there" },
    ];
    expect(sliceContent(link, 0, 6)).toEqual([
      "go ",
      { attributes: { href: "/spec" }, tagName: "a", textContent: "the" },
    ]);
  });

  test("recurses through nested inline markup", () => {
    const nested: Content = [
      { children: ["a", { tagName: "em", textContent: "bc" }], tagName: "strong" },
    ];
    expect(sliceContent(nested, 0, 2)).toEqual([
      { children: ["a", { tagName: "em", textContent: "b" }], tagName: "strong" },
    ]);
  });

  test("keeps a void inline the range reaches", () => {
    // A `<br>` has no characters to clip, so a naive length test would drop it from every slice.
    const withBreak: Content = ["a", { tagName: "br" }, "b"];
    expect(sliceContent(withBreak, 1, 2)).toEqual([{ tagName: "br" }, "b"]);
  });

  test("an empty range yields nothing", () => {
    expect(sliceContent(RICH, 2, 2)).toEqual([]);
    expect(sliceContent(RICH, 5, 5)).toEqual([]);
  });

  test("clamps past the end", () => {
    expect(sliceContent(["abc"], 1, 99)).toEqual(["bc"]);
  });
});

describe("normalizeContent", () => {
  test("merges adjacent strings and drops empties", () => {
    expect(normalizeContent(["a", "", "b", { tagName: "em", textContent: "c" }, "d", "e"])).toEqual(
      ["ab", { tagName: "em", textContent: "c" }, "de"],
    );
  });
});

describe("spliceAcross", () => {
  test("joins the head's prefix to the tail's suffix", () => {
    // Keep "First" from the head, drop through "Second" in the tail, keep " line".
    expect(spliceAcross(["First line"], 5, ["Second line"], 6)).toEqual(["First line"]);
  });

  test("inserts replacement text between them", () => {
    expect(spliceAcross(["abcdef"], 2, ["uvwxyz"], 4, "-")).toEqual(["ab-yz"]);
  });

  test("preserves markup on both sides of the join", () => {
    const head: Content = ["keep ", { tagName: "strong", textContent: "bold" }, " cut"];
    const tail: Content = ["cut ", { tagName: "em", textContent: "it" }, " keep"];
    expect(spliceAcross(head, 9, tail, 4)).toEqual([
      "keep ",
      { tagName: "strong", textContent: "bold" },
      { tagName: "em", textContent: "it" },
      " keep",
    ]);
  });

  test("selecting whole blocks leaves an empty result", () => {
    expect(spliceAcross(["all"], 0, ["gone"], 4)).toEqual([]);
  });
});

describe("toStored", () => {
  test("folds all-plain content back to textContent", () => {
    expect(toStored(["a", "b"])).toEqual({ textContent: "ab" });
    expect(toStored([])).toEqual({ textContent: "" });
  });

  test("keeps children when markup survives", () => {
    expect(toStored(["a", { tagName: "em", textContent: "b" }])).toEqual({
      children: ["a", { tagName: "em", textContent: "b" }],
    });
  });
});

describe("a whole ${…} that is printed is not taken for a member on the way", () => {
  const LIST = "${state.list}";

  test("piecesOf marks a textContent that is one whole template, and nothing else", () => {
    expect(piecesOf({ tagName: "p", textContent: LIST })).toEqual([new Printed(LIST)]);
    expect(piecesOf({ tagName: "p", textContent: `x ${LIST}` })).toEqual([`x ${LIST}`]);
    expect(piecesOf({ children: [LIST], tagName: "p" })).toEqual([LIST]);
    expect(piecesOf({ tagName: "p", textContent: "" })).toEqual([]);
    expect(piecesOf({ tagName: "p" })).toEqual([]);
    expect(piecesOf(null)).toEqual([]);
    expect(contentLength([new Printed(LIST), "ab"])).toBe(LIST.length + 2);
  });

  test("storePieces folds it into textContent alone, joins it to text, and has no form for it beside a member", () => {
    expect(storePieces([new Printed(LIST)])).toEqual({ textContent: LIST });
    expect(storePieces([new Printed(LIST), "Tail"])).toEqual({ textContent: `${LIST}Tail` });
    expect(storePieces(["Head ", new Printed(LIST), new Printed(LIST)])).toEqual({
      textContent: `Head ${LIST}${LIST}`,
    });
    // The same string as a member stays one, alone or beside text.
    expect(storePieces([LIST])).toEqual({ children: [LIST] });
    expect(storePieces([LIST, "Tail"])).toEqual({ children: [LIST, "Tail"] });
    // Beside an element or a member there is nothing to join it to: no stored form says "printed".
    expect(storePieces([new Printed(LIST), { tagName: "br" }])).toBeNull();
    expect(storePieces([LIST, new Printed(LIST)])).toBeNull();
    expect(storePieces([])).toEqual({ textContent: "" });
  });

  test("a cut marks what it leaves of a longer template, and unescapes what is no template", () => {
    expect(sliceContent([`Tags${LIST}`], 4, 99)).toEqual([new Printed(LIST)]);
    expect(sliceContent([`Tags${LIST}!`], 4, 99)).toEqual([`${LIST}!`]);
    expect(sliceContent([String.raw`C:\\temp ${"${state.x}"}`], 0, 9)).toEqual([
      String.raw`C:\temp `,
    ]);
    // A string that was never a template is cut as it is, backslashes and all.
    expect(sliceContent([String.raw`C:\\temp x`], 0, 9)).toEqual([String.raw`C:\\temp `]);
    // Kept whole, a piece is the piece it was: a member stays a member, a mark stays a mark.
    expect(sliceContent([LIST, new Printed(LIST)], 0, 99)).toEqual([LIST, new Printed(LIST)]);
  });

  test("an inline cut down to a printed template beside its own markup cannot be stored", () => {
    const strong = { children: [`x${LIST}`, { tagName: "br" }], tagName: "strong" };
    expect(sliceContent([strong], 1, 99)).toBeNull();
    // At any depth: the inline around it cannot be stored either.
    expect(sliceContent([{ children: [strong], tagName: "em" }], 1, 99)).toBeNull();
    expect(spliceAcross(["Head"], 2, [strong], 1)).toBeNull();
    expect(spliceAcross([strong], 1, ["Tail"], 2)).toEqual([
      { tagName: "strong", textContent: "x" },
      "il",
    ]);
    // Cut down to the template alone, the inline holds it as its text: printed, as it was.
    const em = { tagName: "em", textContent: `x${LIST}` };
    expect(sliceContent([em], 1, 99)).toEqual([{ tagName: "em", textContent: LIST }]);
  });

  test("a splice keeps a <br> that ends the last block", () => {
    expect(spliceAcross(["Head"], 2, ["Tail", { tagName: "br" }], 1)).toEqual([
      "Heail",
      { tagName: "br" },
    ]);
  });
});
