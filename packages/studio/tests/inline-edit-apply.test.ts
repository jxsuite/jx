/**
 * Inline-edit apply logic — the serializable commit/split/insert results turned into transactDoc
 * mutations. Shared by the legacy in-realm editor and the iframe host, so tested directly against a
 * workspace doc.
 */
import { resetStudioState, resetWorkspaceWithTab } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  applyBlockMerge,
  applyInlineCommit,
  applyRangeReplace,
  applyInlineInsert,
  applyInlinePropCommit,
  applyInlineSplit,
  dropsBinding,
  isEmptyContent,
} from "../src/editor/inline-edit-apply";
import { undo } from "../src/tabs/transact";
import type { SlashCommand } from "../src/editor/inline-edit";
import type { Tab } from "../src/tabs/tab";
import type { JxMutableNode } from "@jxsuite/schema/types";
import { isString } from "@jxsuite/schema/guards";

let tab: Tab;
const freshDoc = () => ({ children: [{ tagName: "p", textContent: "Hello" }], tagName: "div" });

/** The element children of `node`, failing the test on a repeater or a bare text child. */
function nodesOf(node: JxMutableNode): JxMutableNode[] {
  const { children } = node;
  if (!Array.isArray(children)) {
    throw new TypeError("expected a static children array");
  }
  return children.map((child) => {
    if (isString(child)) {
      throw new Error(`expected an element child, got the text "${child}"`);
    }
    return child;
  });
}

const kids = () => nodesOf(tab.doc.document);

beforeEach(() => {
  resetStudioState();
  tab = resetWorkspaceWithTab(freshDoc());
});

describe("isEmptyContent", () => {
  test("treats blank text / empty or whitespace children / a lone <br> as empty", () => {
    expect(isEmptyContent()).toBe(true);
    expect(isEmptyContent({ textContent: "   " })).toBe(true);
    expect(isEmptyContent({ children: [] })).toBe(true);
    expect(isEmptyContent({ children: ["  "] })).toBe(true);
    expect(isEmptyContent({ children: [{ tagName: "br" }] })).toBe(true);
  });

  test("treats real content as non-empty", () => {
    expect(isEmptyContent({ textContent: "x" })).toBe(false);
    expect(isEmptyContent({ children: ["a", "b"] })).toBe(false);
    expect(isEmptyContent({ children: [{ tagName: "strong", textContent: "b" }] })).toBe(false);
  });
});

describe("applyInlineCommit", () => {
  test("commits plain textContent (clearing children)", () => {
    applyInlineCommit(tab, ["children", 0], null, "Updated");
    expect(kids()[0]!.textContent).toBe("Updated");
    expect(kids()[0]!.children).toBeUndefined();
  });

  test("commits rich children (clearing textContent)", () => {
    const rich = ["a ", { tagName: "strong", textContent: "b" }];
    applyInlineCommit(tab, ["children", 0], rich, null);
    expect(kids()[0]!.children).toEqual(rich);
    expect(kids()[0]!.textContent).toBeUndefined();
  });

  test("is a no-op when the text is unchanged", () => {
    applyInlineCommit(tab, ["children", 0], null, "Hello");
    expect(kids()[0]!.textContent).toBe("Hello");
  });
});

describe("applyBlockMerge", () => {
  /** Two plain paragraphs, plus a list whose single item follows them. */
  const twoParas = () => ({
    children: [
      { tagName: "p", textContent: "First" },
      { tagName: "p", textContent: "Second" },
    ],
    tagName: "div",
  });

  test("joins the second block onto the first and returns the seam", () => {
    tab = resetWorkspaceWithTab(twoParas());
    const seam = applyBlockMerge(tab, ["children", 1], ["children", 0]);

    expect(kids()).toHaveLength(1);
    expect(kids()[0]!.textContent).toBe("FirstSecond");
    // The caret belongs where the two blocks met — not at the end of the joined text.
    expect(seam).toEqual({ offset: 5, path: ["children", 0] });
  });

  test("merging an EMPTY block just removes it, leaving the caret at the previous end", () => {
    tab = resetWorkspaceWithTab({
      children: [
        { tagName: "p", textContent: "Kept" },
        { tagName: "p", textContent: "" },
      ],
      tagName: "div",
    });
    const seam = applyBlockMerge(tab, ["children", 1], ["children", 0]);
    expect(kids()).toHaveLength(1);
    expect(kids()[0]!.textContent).toBe("Kept");
    expect(seam).toEqual({ offset: 4, path: ["children", 0] });
  });

  test("merging INTO an empty block keeps the survivor's tag", () => {
    // Backspace at the start of a paragraph that follows an empty heading: the heading survives.
    tab = resetWorkspaceWithTab({
      children: [
        { tagName: "h2", textContent: "" },
        { tagName: "p", textContent: "Body" },
      ],
      tagName: "div",
    });
    const seam = applyBlockMerge(tab, ["children", 1], ["children", 0]);
    expect(kids()).toHaveLength(1);
    expect(kids()[0]).toMatchObject({ tagName: "h2", textContent: "Body" });
    expect(seam).toEqual({ offset: 0, path: ["children", 0] });
  });

  test("concatenates rich children, preserving inline markup from both sides", () => {
    tab = resetWorkspaceWithTab({
      children: [
        { children: ["a ", { tagName: "strong", textContent: "bold" }], tagName: "p" },
        { children: [{ tagName: "em", textContent: "it" }, " c"], tagName: "p" },
      ],
      tagName: "div",
    });
    const seam = applyBlockMerge(tab, ["children", 1], ["children", 0]);
    expect(kids()).toHaveLength(1);
    expect(kids()[0]!.children).toEqual([
      "a ",
      { tagName: "strong", textContent: "bold" },
      { tagName: "em", textContent: "it" },
      " c",
    ]);
    // The seam is the rendered length of the FIRST block: "a " + "bold".
    expect(seam).toEqual({ offset: 6, path: ["children", 0] });
  });

  test("a plain block merging a rich one becomes rich", () => {
    tab = resetWorkspaceWithTab({
      children: [
        { tagName: "p", textContent: "plain " },
        { children: [{ tagName: "strong", textContent: "rich" }], tagName: "p" },
      ],
      tagName: "div",
    });
    applyBlockMerge(tab, ["children", 1], ["children", 0]);
    expect(kids()[0]!.children).toEqual(["plain ", { tagName: "strong", textContent: "rich" }]);
    expect(kids()[0]!.textContent).toBeUndefined();
  });

  test("prunes the container a removal empties", () => {
    // Backspacing the only item out of a list must not leave an invisible <ul> behind.
    tab = resetWorkspaceWithTab({
      children: [
        { tagName: "p", textContent: "Intro" },
        { children: [{ tagName: "li", textContent: "only" }], tagName: "ul" },
      ],
      tagName: "div",
    });
    applyBlockMerge(tab, ["children", 1, "children", 0], ["children", 0]);
    expect(kids()).toHaveLength(1);
    expect(kids()[0]!.textContent).toBe("Introonly");
  });

  test("refuses a merge between a block and its own ancestor", () => {
    // A loose list item and the paragraph inside it are adjacent in document order, but joining
    // Them would mean a node absorbing its own parent.
    tab = resetWorkspaceWithTab({
      children: [{ children: [{ tagName: "p", textContent: "inner" }], tagName: "li" }],
      tagName: "div",
    });
    expect(applyBlockMerge(tab, ["children", 0, "children", 0], ["children", 0])).toBeNull();
    expect(kids()).toHaveLength(1);
  });

  test("refuses when a path does not resolve, and no-ops without a tab", () => {
    tab = resetWorkspaceWithTab(twoParas());
    expect(applyBlockMerge(tab, ["children", 9], ["children", 0])).toBeNull();
    expect(applyBlockMerge(tab, ["children", 1], ["children", 9])).toBeNull();
    expect(applyBlockMerge(null, ["children", 1], ["children", 0])).toBeNull();
    expect(kids()).toHaveLength(2);
  });

  test("the whole merge undoes as one step", () => {
    tab = resetWorkspaceWithTab(twoParas());
    applyBlockMerge(tab, ["children", 1], ["children", 0]);
    expect(kids()).toHaveLength(1);

    undo(tab);
    expect(kids()).toHaveLength(2);
    expect(kids()[0]!.textContent).toBe("First");
    expect(kids()[1]!.textContent).toBe("Second");
  });
});

describe("applyRangeReplace", () => {
  const fourParas = () => ({
    children: [
      { tagName: "p", textContent: "AAAA" },
      { tagName: "p", textContent: "BBBB" },
      { tagName: "p", textContent: "CCCC" },
      { tagName: "p", textContent: "DDDD" },
    ],
    tagName: "div",
  });

  test("collapses a selection spanning blocks, removing the ones between", () => {
    tab = resetWorkspaceWithTab(fourParas());
    const caret = applyRangeReplace(
      tab,
      { offset: 2, path: ["children", 0] },
      { offset: 2, path: ["children", 3] },
      [
        ["children", 1],
        ["children", 2],
      ],
      "",
    );

    expect(kids()).toHaveLength(1);
    expect(kids()[0]!.textContent).toBe("AADD");
    expect(caret).toEqual({ offset: 2, path: ["children", 0] });
  });

  test("typing over a cross-block selection inserts the text at the join", () => {
    tab = resetWorkspaceWithTab(fourParas());
    const caret = applyRangeReplace(
      tab,
      { offset: 2, path: ["children", 0] },
      { offset: 2, path: ["children", 3] },
      [
        ["children", 1],
        ["children", 2],
      ],
      "X",
    );
    expect(kids()[0]!.textContent).toBe("AAXDD");
    expect(caret).toEqual({ offset: 3, path: ["children", 0] });
  });

  test("two adjacent blocks need no intermediate removals", () => {
    tab = resetWorkspaceWithTab(fourParas());
    applyRangeReplace(
      tab,
      { offset: 1, path: ["children", 0] },
      { offset: 3, path: ["children", 1] },
      [],
      "",
    );
    expect(kids()).toHaveLength(3);
    expect(kids()[0]!.textContent).toBe("AB");
  });

  test("preserves inline markup on both sides of the collapse", () => {
    tab = resetWorkspaceWithTab({
      children: [
        { children: ["keep ", { tagName: "strong", textContent: "bold" }, " cut"], tagName: "p" },
        { children: ["cut ", { tagName: "em", textContent: "it" }, " keep"], tagName: "p" },
      ],
      tagName: "div",
    });
    applyRangeReplace(
      tab,
      { offset: 9, path: ["children", 0] },
      { offset: 4, path: ["children", 1] },
      [],
      "",
    );
    expect(kids()).toHaveLength(1);
    expect(kids()[0]!.children).toEqual([
      "keep ",
      { tagName: "strong", textContent: "bold" },
      { tagName: "em", textContent: "it" },
      " keep",
    ]);
  });

  test("removals run deepest-last so an earlier one cannot shift a later path", () => {
    // The between-blocks are given in document order; removing index 1 first would renumber 2.
    tab = resetWorkspaceWithTab(fourParas());
    applyRangeReplace(
      tab,
      { offset: 4, path: ["children", 0] },
      { offset: 0, path: ["children", 3] },
      [
        ["children", 1],
        ["children", 2],
      ],
      "",
    );
    expect(kids()).toHaveLength(1);
    expect(kids()[0]!.textContent).toBe("AAAADDDD");
  });

  test("prunes a container the collapse empties", () => {
    tab = resetWorkspaceWithTab({
      children: [
        { tagName: "p", textContent: "before" },
        { children: [{ tagName: "li", textContent: "item" }], tagName: "ul" },
        { tagName: "p", textContent: "after" },
      ],
      tagName: "div",
    });
    applyRangeReplace(
      tab,
      { offset: 6, path: ["children", 0] },
      { offset: 0, path: ["children", 2] },
      [["children", 1, "children", 0]],
      "",
    );
    // The list item went, and the empty <ul> did not survive it.
    expect(kids()).toHaveLength(1);
    expect(kids()[0]!.textContent).toBe("beforeafter");
  });

  test("refuses an ancestor/descendant pair, and no-ops without a tab", () => {
    tab = resetWorkspaceWithTab({
      children: [{ children: [{ tagName: "p", textContent: "inner" }], tagName: "li" }],
      tagName: "div",
    });
    expect(
      applyRangeReplace(
        tab,
        { offset: 0, path: ["children", 0] },
        { offset: 1, path: ["children", 0, "children", 0] },
        [],
        "",
      ),
    ).toBeNull();
    expect(
      applyRangeReplace(null, { offset: 0, path: [] }, { offset: 0, path: [] }, [], ""),
    ).toBeNull();
  });

  test("refuses when an endpoint does not resolve", () => {
    tab = resetWorkspaceWithTab(fourParas());
    expect(
      applyRangeReplace(
        tab,
        { offset: 0, path: ["children", 9] },
        { offset: 0, path: ["children", 1] },
        [],
        "",
      ),
    ).toBeNull();
    expect(kids()).toHaveLength(4);
  });

  test("the whole collapse undoes as one step", () => {
    tab = resetWorkspaceWithTab(fourParas());
    applyRangeReplace(
      tab,
      { offset: 2, path: ["children", 0] },
      { offset: 2, path: ["children", 3] },
      [
        ["children", 1],
        ["children", 2],
      ],
      "",
    );
    expect(kids()).toHaveLength(1);
    undo(tab);
    expect(kids()).toHaveLength(4);
    expect(kids().map((k) => k.textContent)).toEqual(["AAAA", "BBBB", "CCCC", "DDDD"]);
  });
});

describe("applyInlineSplit", () => {
  test("keeps the before-content, inserts a new <p> with the after-content, returns its path", () => {
    const newPath = applyInlineSplit(
      tab,
      ["children", 0],
      { textContent: "Hel" },
      { textContent: "lo" },
    );
    expect(newPath).toEqual(["children", 1]);
    expect(kids()[0]!.textContent).toBe("Hel");
    expect(kids()[1]).toMatchObject({ tagName: "p", textContent: "lo" });
    expect(tab.session.selection).toEqual([["children", 1]]);
  });
});

describe("applyInlineInsert", () => {
  const h2: SlashCommand = { description: "", label: "Heading 2", tag: "h2" };

  test("swaps the tag in place when the node is empty (returns the same path)", () => {
    applyInlineCommit(tab, ["children", 0], null, ""); // Make it empty first.
    const path = applyInlineInsert(tab, ["children", 0], h2, { textContent: "" });
    expect(path).toEqual(["children", 0]);
    expect(kids()[0]!.tagName).toBe("h2");
  });

  test("inserts a new element after when the node has content (returns the new path)", () => {
    const path = applyInlineInsert(tab, ["children", 0], h2, { textContent: "Hello" });
    expect(path).toEqual(["children", 1]);
    expect(kids()[0]!.textContent).toBe("Hello");
    expect(kids()[1]!.tagName).toBe("h2");
  });
});

// ─── A commit never stores a binding's value in the binding's place ───────────────

describe("the binding guard", () => {
  /* A `${…}` is drawn resolved on the canvas, inside a chip that serializes as the expression. A
     write that comes back without it either lost it (refused) or names it in `removedTags`, which
     is the author deleting the chip (studio.md §4.5, the third guard). */
  const NAME = "${state.name}";
  const boundDoc = () => ({
    children: [
      { children: ["Hello ", NAME], tagName: "p" },
      { tagName: "p", textContent: "Tail" },
    ],
    state: { name: "Ada" },
    tagName: "div",
  });
  const AT = ["children", 0];
  let refused: ReturnType<typeof mock<(path: (string | number)[]) => void>>;

  beforeEach(() => {
    tab = resetWorkspaceWithTab(boundDoc());
    refused = mock<(path: (string | number)[]) => void>();
  });

  const untouched = () => {
    expect(tab.doc.document).toEqual(boundDoc());
    expect(tab.doc.dirty).toBeFalsy();
  };

  describe("applyInlineCommit", () => {
    test("refuses the resolved text the canvas commits for a templated member", () => {
      applyInlineCommit(tab, AT, null, "Hello Ada", { onRefused: refused });
      untouched();
      expect(refused.mock.calls).toEqual([[AT]]);
    });

    test("refuses rich children that no longer carry the binding", () => {
      const rich = ["Hello ", { tagName: "strong", textContent: "Ada" }];
      applyInlineCommit(tab, AT, rich, null, { onRefused: refused });
      expect(kids()[0]!.children).toEqual(["Hello ", NAME]);
      untouched();
      expect(refused).toHaveBeenCalledTimes(1);
    });

    test("refuses without a listener too: the guard does not depend on being heard", () => {
      applyInlineCommit(tab, AT, null, "Hello Ada");
      untouched();
    });

    test("allows children that still carry the binding", () => {
      const edited = ["Howdy ", NAME, "!"];
      applyInlineCommit(tab, AT, edited, null, { onRefused: refused });
      expect(kids()[0]!.children).toEqual(edited);
      expect(refused).not.toHaveBeenCalled();
    });

    test("allows the binding to move into an element, where it is still a member", () => {
      // Emphasis over the chip: the canvas writes it as the element's one member, not its text.
      const moved = ["Hi ", { children: [NAME], tagName: "em" }];
      applyInlineCommit(tab, AT, moved, null, { onRefused: refused });
      expect(kids()[0]!.children).toEqual(moved);
      expect(refused).not.toHaveBeenCalled();
    });

    test("allows a textContent binding to move anywhere in the block's text", () => {
      tab = resetWorkspaceWithTab({
        children: [{ tagName: "p", textContent: `Hi ${NAME}` }],
        tagName: "div",
      });
      const moved = ["Hi ", { tagName: "em", textContent: NAME }];
      applyInlineCommit(tab, AT, moved, null, { onRefused: refused });
      expect(kids()[0]!.children).toEqual(moved);
      applyInlineCommit(tab, AT, null, `${NAME} says hi`, { onRefused: refused });
      expect(kids()[0]!.textContent).toBe(`${NAME} says hi`);
      expect(refused).not.toHaveBeenCalled();
    });

    test("a binding held twice has to come back twice", () => {
      tab = resetWorkspaceWithTab({
        children: [{ children: [NAME, { tagName: "br" }, NAME], tagName: "p" }],
        tagName: "div",
      });
      applyInlineCommit(tab, AT, [NAME, { tagName: "br" }, "Ada"], null, { onRefused: refused });
      expect(kids()[0]!.children).toEqual([NAME, { tagName: "br" }, NAME]);
      expect(refused).toHaveBeenCalledTimes(1);
    });

    test("a member nested in inline markup is held as well", () => {
      tab = resetWorkspaceWithTab({
        children: [
          {
            children: ["By ", { children: [NAME, { tagName: "br" }], tagName: "strong" }],
            tagName: "p",
          },
        ],
        tagName: "div",
      });
      applyInlineCommit(tab, AT, ["By ", { tagName: "strong", textContent: "Ada" }], null, {
        onRefused: refused,
      });
      expect(refused).toHaveBeenCalledTimes(1);
      applyInlineCommit(
        tab,
        AT,
        ["Written by ", { children: [NAME, { tagName: "br" }], tagName: "strong" }],
        null,
        { onRefused: refused },
      );
      expect(refused).toHaveBeenCalledTimes(1);
      expect(kids()[0]!.children).toHaveLength(2);
    });

    test("guard 3: a commit that drops a templated textContent is refused", () => {
      tab = resetWorkspaceWithTab({
        children: [{ tagName: "p", textContent: `Hello ${NAME}` }],
        tagName: "div",
      });
      applyInlineCommit(tab, AT, null, "Hello Ada", { onRefused: refused });
      expect(kids()[0]!.textContent).toBe(`Hello ${NAME}`);
      expect(refused.mock.calls).toEqual([[AT]]);
    });

    test("guard 3: the same commit goes through when the session reported the chip deleted", () => {
      tab = resetWorkspaceWithTab({
        children: [{ tagName: "p", textContent: `Hello ${NAME}` }],
        tagName: "div",
      });
      applyInlineCommit(tab, AT, null, "Hello there", {
        onRefused: refused,
        removedTags: [NAME, "${never.held}"],
      });
      expect(kids()[0]!.textContent).toBe("Hello there");
      expect(refused).not.toHaveBeenCalled();
    });

    test("a reported deletion excuses one copy, not every copy", () => {
      tab = resetWorkspaceWithTab({
        children: [{ tagName: "p", textContent: `${NAME} and ${NAME}` }],
        tagName: "div",
      });
      applyInlineCommit(tab, AT, null, "nobody", { onRefused: refused, removedTags: [NAME] });
      expect(refused).toHaveBeenCalledTimes(1);
      applyInlineCommit(tab, AT, null, `${NAME} only`, { onRefused: refused, removedTags: [NAME] });
      expect(kids()[0]!.textContent).toBe(`${NAME} only`);
      expect(refused).toHaveBeenCalledTimes(1);
    });

    test("a binding in a nested element's text or attribute is held as well", () => {
      const link = { attributes: { href: "${state.url}" }, tagName: "a", textContent: NAME };
      tab = resetWorkspaceWithTab({
        children: [{ children: ["By ", link], tagName: "p" }],
        tagName: "div",
      });
      // The canvas rebuilt the link from the DOM: the text's chip came back, the href did not.
      const rebuilt = { attributes: { href: "/ada" }, tagName: "a", textContent: NAME };
      applyInlineCommit(tab, AT, ["By ", rebuilt], null, { onRefused: refused });
      expect(refused).toHaveBeenCalledTimes(1);
      applyInlineCommit(tab, AT, ["Written by ", link], null, { onRefused: refused });
      expect(refused).toHaveBeenCalledTimes(1);
      expect(kids()[0]!.children).toEqual(["Written by ", link]);
    });

    test("a commit that only re-spells what the block holds writes nothing", () => {
      // The canvas hands the block back member for member.
      applyInlineCommit(tab, AT, ["Hello ", NAME], null, { onRefused: refused });
      untouched();
      tab = resetWorkspaceWithTab({
        children: [
          {
            children: [
              "By ",
              "the ",
              { attributes: { href: "/a" }, children: ["Dr"], tagName: "a" },
              { tagName: "br" },
            ],
            tagName: "p",
          },
        ],
        tagName: "div",
      });
      // A plain copy: the document is reactive, and a reactive proxy cannot be structured-cloned.
      const before = JSON.stringify(tab.doc.document);
      /* Three spellings of the same content: two plain strings as one, an element's one plain
         string as its `textContent` with its keys in another order, and a `<br>` the canvas
         serialized with an empty `textContent`. A caret that only visited must not dirty the tab. */
      applyInlineCommit(
        tab,
        AT,
        [
          "By the ",
          { tagName: "a", textContent: "Dr", attributes: { href: "/a" } },
          { tagName: "br", textContent: "" },
        ],
        null,
        { onRefused: refused },
      );
      expect(JSON.stringify(tab.doc.document)).toBe(before);
      expect(tab.doc.dirty).toBeFalsy();
      expect(refused).not.toHaveBeenCalled();
    });

    test("guard 3: a whole-template member joined to its neighbour is not a re-spelling", () => {
      /* `["Hello ", "${state.name}"]` and `"Hello ${state.name}"` hold the same binding and do not
         mean the same: the member's value may be nodes, spliced in, and the joined string prints
         it. Every `${…}` survives the join, so only counting the member itself catches it. */
      applyInlineCommit(tab, AT, null, `Hello ${NAME}`, { onRefused: refused });
      untouched();
      expect(refused.mock.calls).toEqual([[AT]]);
      // The other way is the author's to do: a `textContent` binding moved beside an element.
      tab = resetWorkspaceWithTab({
        children: [{ tagName: "p", textContent: NAME }],
        tagName: "div",
      });
      applyInlineCommit(tab, AT, [NAME, { tagName: "br" }], null, { onRefused: refused });
      expect(kids()[0]!.children).toEqual([NAME, { tagName: "br" }]);
      expect(refused).toHaveBeenCalledTimes(1);
    });

    test("allows any commit to a node with no template", () => {
      applyInlineCommit(
        tab,
        ["children", 1],
        ["Tail ", { tagName: "em", textContent: "x" }],
        null,
        {
          onRefused: refused,
        },
      );
      expect(kids()[1]!.children).toHaveLength(2);
      expect(refused).not.toHaveBeenCalled();
    });

    test("a commit carrying nothing is still nothing", () => {
      applyInlineCommit(tab, AT, null, null, { onRefused: refused });
      expect(kids()[0]!.children).toEqual(["Hello ", NAME]);
      untouched();
      expect(refused).not.toHaveBeenCalled();
    });
  });

  describe("applyInlineSplit", () => {
    test("refuses a split whose halves lost the binding, and stays on the block", () => {
      const path = applyInlineSplit(
        tab,
        AT,
        { textContent: "Hello " },
        { textContent: "Ada" },
        refused,
      );
      expect(path).toEqual(AT);
      untouched();
      expect(refused.mock.calls).toEqual([[AT]]);
    });

    test("allows a split that lost a chip the session reported deleted", () => {
      const path = applyInlineSplit(
        tab,
        AT,
        { textContent: "Hello " },
        { textContent: "there" },
        refused,
        [NAME],
      );
      expect(path).toEqual(["children", 1]);
      expect(kids()[0]!.textContent).toBe("Hello ");
      expect(refused).not.toHaveBeenCalled();
    });

    test("allows a split that keeps the binding in either half", () => {
      const path = applyInlineSplit(
        tab,
        AT,
        { textContent: "Hello " },
        { children: [NAME, "!"] },
        refused,
      );
      expect(path).toEqual(["children", 1]);
      expect(kids()[0]!.textContent).toBe("Hello ");
      expect(kids()[1]!.children).toEqual([NAME, "!"]);
      expect(refused).not.toHaveBeenCalled();
    });
  });

  describe("applyInlineInsert", () => {
    const h2: SlashCommand = { description: "", label: "Heading 2", tag: "h2" };

    test("refuses an insert that would commit the resolved text first", () => {
      const path = applyInlineInsert(tab, AT, h2, { textContent: "Hello Ada" }, refused);
      expect(path).toEqual(AT);
      untouched();
      expect(refused.mock.calls).toEqual([[AT]]);
    });

    test("refuses the in-place swap of a block whose binding drew as nothing", () => {
      // An empty value makes the block look empty, and the swap clears its children.
      const path = applyInlineInsert(tab, AT, h2, { textContent: "" }, refused);
      expect(path).toEqual(AT);
      untouched();
      expect(refused).toHaveBeenCalledTimes(1);
    });

    test("allows the swap once the session reported the chip deleted", () => {
      const path = applyInlineInsert(tab, AT, h2, { textContent: "" }, refused, [NAME]);
      expect(path).toEqual(AT);
      expect(kids()[0]!.tagName).toBe("h2");
      expect(refused).not.toHaveBeenCalled();
    });

    test("allows an insert after a block that still carries the binding", () => {
      const path = applyInlineInsert(tab, AT, h2, { children: ["Hello ", NAME] }, refused);
      expect(path).toEqual(["children", 1]);
      expect(kids()[0]!.children).toEqual(["Hello ", NAME]);
      expect(kids()[1]!.tagName).toBe("h2");
      expect(refused).not.toHaveBeenCalled();
    });
  });

  describe("applyRangeReplace", () => {
    test("refuses a cut through a templated member: the offsets are the canvas's", () => {
      // "Hello Ada" on the canvas; offset 8 is inside `${state.name}` in the stored content.
      const caret = applyRangeReplace(
        tab,
        { offset: 8, path: AT },
        { offset: 2, path: ["children", 1] },
        [],
        "",
        refused,
      );
      expect(caret).toBeNull();
      untouched();
      expect(refused.mock.calls).toEqual([[AT]]);
    });

    test("refuses when the binding is in the block the range ends in", () => {
      const caret = applyRangeReplace(
        tab,
        { offset: 2, path: ["children", 1] },
        { offset: 8, path: AT },
        [],
        "",
        refused,
      );
      expect(caret).toBeNull();
      untouched();
      expect(refused.mock.calls).toEqual([[["children", 1]]]);
    });

    test("a cut past a binding keeps it: an offset counts a chip as its expression", () => {
      /* `${a} is here and more`, cut after `${a} is` (7). The canvas counts the chip as the four
         characters it stands for, so the offset is the stored one and the cut is exact. */
      tab = resetWorkspaceWithTab({
        children: [
          { children: ["${a}", " is here and more", { tagName: "br" }], tagName: "p" },
          { tagName: "p", textContent: "Tail" },
        ],
        state: { a: "Alexander" },
        tagName: "div",
      });
      const caret = applyRangeReplace(
        tab,
        { offset: 7, path: AT },
        { offset: 2, path: ["children", 1] },
        [],
        "",
        refused,
      );
      expect(caret).toEqual({ offset: 7, path: AT });
      // The whole-template member stays a member of its own: joined, an array there is printed.
      expect(kids()[0]!.children).toEqual(["${a}", " isil"]);
      expect(refused).not.toHaveBeenCalled();
    });

    test("guard 3: a range that takes a binding is refused unless it reported the chip", () => {
      const cut = (removedTags?: string[]) =>
        applyRangeReplace(
          tab,
          { offset: 2, path: AT },
          { offset: 2, path: ["children", 1] },
          [],
          "",
          refused,
          removedTags,
        );
      expect(cut()).toBeNull();
      untouched();
      expect(refused.mock.calls).toEqual([[AT]]);
      expect(cut([NAME])).toEqual({ offset: 2, path: AT });
      expect(kids()[0]!.textContent).toBe("Heil");
    });

    test("an offset inside a binding in nested markup is a cut through it too", () => {
      tab = resetWorkspaceWithTab({
        children: [
          { children: ["By ", { tagName: "em", textContent: NAME }, "."], tagName: "p" },
          { tagName: "p", textContent: "Tail" },
        ],
        tagName: "div",
      });
      const caret = applyRangeReplace(
        tab,
        { offset: 5, path: AT },
        { offset: 1, path: ["children", 1] },
        [],
        "",
        refused,
        [NAME],
      );
      expect(caret).toBeNull();
      expect(refused).toHaveBeenCalledTimes(1);
    });

    test("the head's own text does not stand in for a binding the tail lost", () => {
      // Both ends spell the same binding; the range takes the tail's whole chip and reports nothing.
      const doc = () => ({
        children: [
          { tagName: "p", textContent: `By ${NAME}` },
          { children: ["Hello ", NAME], tagName: "p" },
        ],
        state: { name: "Ada" },
        tagName: "div",
      });
      tab = resetWorkspaceWithTab(doc());
      const caret = applyRangeReplace(
        tab,
        { offset: `By ${NAME}`.length, path: AT },
        { offset: `Hello ${NAME}`.length, path: ["children", 1] },
        [],
        "",
        refused,
      );
      expect(caret).toBeNull();
      expect(tab.doc.document).toEqual(doc());
      expect(refused).toHaveBeenCalledTimes(1);
    });

    test("allows a range that leaves the binding whole", () => {
      const caret = applyRangeReplace(
        tab,
        { offset: 2, path: ["children", 1] },
        { offset: 0, path: AT },
        [],
        "",
        refused,
      );
      // Order is the caller's; here the tail is the bound block, kept from offset 0.
      expect(caret).toEqual({ offset: 2, path: ["children", 1] });
      expect(kids()).toHaveLength(1);
      expect(kids()[0]!.children).toEqual(["TaHello ", NAME]);
      expect(refused).not.toHaveBeenCalled();
    });
  });

  describe("applyBlockMerge", () => {
    test("guard 3: a merge joins stored content, so the binding survives without a refusal", () => {
      const seam = applyBlockMerge(tab, ["children", 1], AT, refused);
      expect(seam?.path).toEqual(AT);
      expect(kids()).toHaveLength(1);
      // Each string is still the string it was: the member is not joined to the text after it.
      expect(kids()[0]!.children).toEqual(["Hello ", NAME, "Tail"]);
      expect(refused).not.toHaveBeenCalled();
    });

    test("the seam is the stored length, which is the offset the canvas counts to", () => {
      const seam = applyBlockMerge(tab, AT, ["children", 1]);
      expect(seam).toEqual({ offset: 4, path: ["children", 1] });
      const back = applyBlockMerge(resetWorkspaceWithTab(boundDoc()), ["children", 1], AT);
      expect(back?.offset).toBe(`Hello ${NAME}`.length);
    });

    test("a join that would swallow a binding into another expression keeps both strings", () => {
      // Apart, the second block holds `${b}`; as one string, the first block's open quote would
      // Make it text. So they are not made one string: each stays a member of its own.
      tab = resetWorkspaceWithTab({
        children: [
          { tagName: "p", textContent: "${'" },
          { tagName: "p", textContent: "${b}'}" },
        ],
        tagName: "div",
      });
      expect(applyBlockMerge(tab, ["children", 1], AT, refused)).toEqual({ offset: 3, path: AT });
      expect(kids()).toEqual([{ children: ["${'", "${b}'}"], tagName: "p" }]);
      expect(refused).not.toHaveBeenCalled();
    });

    test("guard 3: a block that draws its content from data is not merged into", () => {
      /* None of these has content a join can read, so the join would have written the other
         block's text over what each draws. */
      const drawn: JxMutableNode[] = [
        { children: "${state.spans}", tagName: "div" },
        { tagName: "h2", textContent: { $ref: "#/state/name" } },
        { innerHTML: "${state.html}", tagName: "div" },
        { innerText: { $ref: "#/state/name" }, tagName: "p" },
        { children: [{ tagName: "b", textContent: "x" }], tagName: "p", textContent: NAME },
      ];
      for (const block of drawn) {
        const doc = () => ({
          children: [structuredClone(block), { tagName: "p", textContent: "tail" }],
          tagName: "div",
        });
        tab = resetWorkspaceWithTab(doc());
        refused.mockClear();
        expect(applyBlockMerge(tab, ["children", 1], AT, refused)).toBeNull();
        expect(tab.doc.document).toEqual(doc());
        expect(refused.mock.calls).toEqual([[AT]]);
        // A range replace that ends in one, or starts in one, is refused the same way.
        expect(
          applyRangeReplace(
            tab,
            { offset: 0, path: AT },
            { offset: 2, path: ["children", 1] },
            [],
            "",
            refused,
          ),
        ).toBeNull();
        expect(tab.doc.document).toEqual(doc());
      }
    });
  });

  describe("dropsBinding", () => {
    const node = { children: ["a ", NAME], tagName: "p" };

    test("no node, or a node with no binding, holds nothing", () => {
      expect(dropsBinding(undefined, [{ textContent: "x" }])).toBe(false);
      expect(dropsBinding(null, [])).toBe(false);
      expect(dropsBinding({ tagName: "p", textContent: "plain" }, [{ textContent: "x" }])).toBe(
        false,
      );
    });

    test("a templated textContent and computed children are held like a member is", () => {
      expect(dropsBinding({ tagName: "p", textContent: NAME }, [{ textContent: "x" }])).toBe(true);
      expect(dropsBinding({ children: NAME, tagName: "ul" }, [{ textContent: "x" }])).toBe(true);
      expect(dropsBinding({ tagName: "p", textContent: NAME }, [{ children: [NAME] }])).toBe(false);
    });

    test("no committed piece at all drops everything held", () => {
      expect(dropsBinding(node, [])).toBe(true);
      expect(dropsBinding(node, [undefined])).toBe(true);
      expect(dropsBinding(node, [], [NAME])).toBe(false);
    });

    test("an expression with braces of its own is matched whole", () => {
      const lambda = '${f(state.x, {"a":1})}';
      const held = { children: ["On ", lambda], tagName: "p" };
      expect(dropsBinding(held, [{ children: ["At ", lambda] }])).toBe(false);
      expect(dropsBinding(held, [{ children: ["At ", '${f(state.x, {"a":2})}'] }])).toBe(true);
    });

    test("a nested element with neither text nor children carries nothing", () => {
      expect(dropsBinding(node, [{ children: [{ tagName: "br" }] }])).toBe(true);
      expect(dropsBinding(node, [{ children: [{ children: [NAME], tagName: "em" }] }])).toBe(false);
    });
  });
});

describe("applyInlinePropCommit", () => {
  const instanceDoc = () => ({
    children: [
      { tagName: "p", textContent: "Hello" },
      { $props: { title: "Local" }, tagName: "x-card" },
    ],
    tagName: "div",
  });

  beforeEach(() => {
    tab = resetWorkspaceWithTab(instanceDoc());
  });

  test("writes the value into the instance's $props", () => {
    applyInlinePropCommit(tab, ["children", 1], "title", "Regional");
    expect(kids()[1]!.$props?.["title"]).toBe("Regional");
    expect(tab.doc.dirty).toBe(true);
  });

  test("adds an unset prop (overriding the definition default)", () => {
    applyInlinePropCommit(tab, ["children", 1], "description", "Body text");
    expect(kids()[1]!.$props?.["description"]).toBe("Body text");
  });

  test("deletes the prop on an empty value (reverting to the definition default)", () => {
    applyInlinePropCommit(tab, ["children", 1], "title", "");
    expect(kids()[1]!.$props?.["title"]).toBeUndefined();
  });

  test("no-ops when the value is unchanged (load-bearing: Escape/disturb re-commits)", () => {
    const rootBefore = tab.doc.document;
    applyInlinePropCommit(tab, ["children", 1], "title", "Local");
    // TransactDoc swaps the root reference on every real transaction — same ref means no-op.
    expect(tab.doc.document).toBe(rootBefore);
    expect(tab.doc.dirty).toBeFalsy();
  });

  test("treats an unset prop and an empty value as unchanged", () => {
    const rootBefore = tab.doc.document;
    applyInlinePropCommit(tab, ["children", 1], "description", "");
    expect(tab.doc.document).toBe(rootBefore);
  });

  test("no-ops on a null tab or a missing node", () => {
    applyInlinePropCommit(null, ["children", 1], "title", "ghost");
    applyInlinePropCommit(tab, ["children", 9], "title", "ghost");
    expect(kids()[1]!.$props?.["title"]).toBe("Local");
  });
});

// ─── Tab routing (the cross-document-bleed fix) ─────────────────────────────────

describe("explicit-tab routing", () => {
  test("a null tab is a no-op for all three appliers (paths still computed)", () => {
    applyInlineCommit(null, ["children", 0], null, "ghost");
    expect(kids()[0]!.textContent).toBe("Hello");

    const splitPath = applyInlineSplit(
      null,
      ["children", 0],
      { textContent: "He" },
      {
        textContent: "llo",
      },
    );
    expect(splitPath).toEqual(["children", 1]);
    expect(kids()).toHaveLength(1);

    const h2: SlashCommand = { description: "", label: "Heading 2", tag: "h2" };
    const insertPath = applyInlineInsert(null, ["children", 0], h2, { textContent: "Hello" });
    expect(insertPath).toEqual(["children", 1]);
    expect(kids()).toHaveLength(1);
    // The empty-content branch also no-ops on a null tab.
    expect(applyInlineInsert(null, ["children", 0], h2, { textContent: "" })).toEqual([
      "children",
      0,
    ]);
    expect(kids()[0]!.tagName).toBe("p");
  });

  test("a commit against an INACTIVE tab mutates that tab without touching its selection", async () => {
    const { openTab, workspace } = await import("../src/workspace/workspace");
    const original = tab;
    original.session.selection = [["children", 0]];
    openTab({ document: { tagName: "div" }, id: "front-tab" });
    expect(workspace.activeTabId).toBe("front-tab");

    // The background tab still receives its late split — but its selection stays as the user
    // Left it (only the visible tab's selection follows edits).
    const newPath = applyInlineSplit(
      original,
      ["children", 0],
      { textContent: "He" },
      { textContent: "llo" },
    );
    const originalKids = nodesOf(original.doc.document);
    expect(newPath).toEqual(["children", 1]);
    expect(originalKids).toHaveLength(2);
    expect(original.session.selection).toEqual([["children", 0]]);
  });
});

// ─── Minimal op recording (no spurious counterpart clears) ──────────────────────

describe("commit op recording", () => {
  test("a plain-text commit on a childless node records ONLY set-text; rich adds no text clear when absent", async () => {
    const { setPatchConsumer } = await import("../src/tabs/patch-ops");
    const batches: string[][] = [];
    setPatchConsumer({
      apply: () => {},
      classify: (_t, ops) => {
        batches.push(ops.map((o) => o.op + ("key" in o ? `:${o.key}` : "")));
        return { patchable: false, reason: "spy" };
      },
      escalate: () => {},
      markConsumed: () => {},
    });
    try {
      // Plain text on a node with no children → a spurious `set-prop:children` would demote the
      // Cheap in-place text patch to a subtree re-render.
      applyInlineCommit(tab, ["children", 0], null, "Updated");
      expect(batches.at(-1)).toEqual(["set-text"]);
      // Rich commit on a node whose textContent was already cleared → no spurious set-text.
      applyInlineCommit(
        tab,
        ["children", 0],
        ["a ", { tagName: "strong", textContent: "b" }],
        null,
      );
      expect(batches.at(-1)).toEqual(["set-text", "set-prop:children"]); // Text present → cleared.
      applyInlineCommit(tab, ["children", 0], ["c ", { tagName: "em", textContent: "d" }], null);
      expect(batches.at(-1)).toEqual(["set-prop:children"]); // Already rich → children only.
      // Plain commit on the now-rich node clears children (real op, kept).
      applyInlineCommit(tab, ["children", 0], null, "flat");
      expect(batches.at(-1)).toEqual(["set-prop:children", "set-text"]);
    } finally {
      setPatchConsumer(null);
    }
  });
});
