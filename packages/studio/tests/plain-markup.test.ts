/**
 * A literal `innerHTML` is content too (studio.md §4.5).
 *
 * An edit session stores a block's content as `textContent` or `children`. A block that spelled its
 * content as `innerHTML` kept that key through every write, so one edit left it holding its content
 * twice: the canvas drew both, a build drew the stale one, and the inline elements of the second
 * copy were addressable inside a block that was not theirs. These prove the three things that stop
 * it: markup a commit can write back whole is read as the content it spells, every write removes
 * the key, and markup a commit cannot write back closes its block instead.
 */
import { resetStudioState, resetWorkspaceWithTab } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  contentOf,
  isAtomicInline,
  piecesOf,
  sameContent,
  sliceContent,
} from "../src/editor/content-slice";
import {
  applyBlockMerge,
  applyInlineCommit,
  applyInlineInsert,
  applyInlineSplit,
  applyRangeReplace,
  bindingRefusal,
} from "../src/editor/inline-edit-apply";
import { nearestHit } from "../src/canvas/iframe-interaction";
import { isTextMark } from "../src/editor/inline-edit";
import { keptJson } from "../src/editor/kept-node";
import {
  holdsOpaqueLiteral,
  isClosedContent,
  openMarkup,
  prepareForEditMode,
} from "../src/utils/edit-display";
import { plainMarkup } from "../src/utils/plain-markup";
import { isNodeObject } from "@jxsuite/schema/guards";
import type { CommitRefused } from "../src/editor/inline-edit-apply";
import type { Tab } from "../src/tabs/tab";
import type { JxMutableNode } from "@jxsuite/schema/types";

const BOLD = "<strong>A company behind it.</strong> Founded in 2002.";
const STRONG: JxMutableNode = { tagName: "strong", textContent: "A company behind it." };
const BOLD_CONTENT: (JxMutableNode | string)[] = [STRONG, " Founded in 2002."];

/** The element children of `node`, failing the test on anything else. */
function nodesOf(node: JxMutableNode): JxMutableNode[] {
  const { children } = node;
  if (!Array.isArray(children)) {
    throw new TypeError("expected a static children array");
  }
  return children.filter((child) => isNodeObject(child));
}

describe("plainMarkup", () => {
  test("text and bare formatting elements are the content they spell", () => {
    expect(plainMarkup("Plain text.")).toEqual(["Plain text."]);
    expect(plainMarkup(BOLD)).toEqual(BOLD_CONTENT);
    expect(plainMarkup("a<em></em>b<br>c<BR/>")).toEqual([
      "a",
      { tagName: "em" },
      "b",
      { tagName: "br" },
      "c",
      { tagName: "br" },
    ]);
    expect(plainMarkup("<em>very <strong>much</strong></em>")).toEqual([
      { children: ["very ", { tagName: "strong", textContent: "much" }], tagName: "em" },
    ]);
    expect(plainMarkup("")).toEqual([]);
  });

  test("the character references it knows are decoded, and a bare ampersand is itself", () => {
    expect(plainMarkup("Tom &amp; Jerry &lt;3 &#65;&#x42;&nbsp;&quot;&apos;&gt;")).toEqual([
      "Tom & Jerry <3 AB \"'>",
    ]);
    expect(plainMarkup("P & L, 100&")).toEqual(["P & L, 100&"]);
    // A name with no `;` may still be a reference to the parser (`&copy`), so it is not guessed at.
    expect(plainMarkup("R&D")).toBeNull();
  });

  test("anything a commit could not write back is refused", () => {
    // An attribute, an element that is not formatting, a tag a commit renames, a comment.
    expect(plainMarkup('<span class="yes">Mature</span>')).toBeNull();
    expect(plainMarkup("<p>a paragraph</p>")).toBeNull();
    expect(plainMarkup("<b>bold</b>")).toBeNull();
    expect(plainMarkup("<!-- note -->")).toBeNull();
    expect(plainMarkup("<em/>")).toBeNull();
    expect(plainMarkup("</br>")).toBeNull();
    // A reference it does not decode, and one the parser would replace.
    expect(plainMarkup("caf&eacute;")).toBeNull();
    expect(plainMarkup("&#0;")).toBeNull();
    expect(plainMarkup("&#xD800;")).toBeNull();
    expect(plainMarkup("&#x110000;")).toBeNull();
    expect(plainMarkup("AT&T;")).toBeNull();
    // Markup that does not nest, and markup inside `<code>`, which a commit flattens.
    expect(plainMarkup("<em>open")).toBeNull();
    expect(plainMarkup("<em>a</strong>")).toBeNull();
    expect(plainMarkup("</em>")).toBeNull();
    expect(plainMarkup("<code>a <em>b</em></code>")).toBeNull();
    expect(plainMarkup("1 < 2")).toBeNull();
  });

  test("text that would be read as a template once stored is refused", () => {
    // `&#36;{` is how markup spells that text so that it is not one (parser.md §8).
    expect(plainMarkup("price: &#36;{amount}")).toBeNull();
    expect(plainMarkup("$&#123;x}")).toBeNull();
    expect(plainMarkup("<em>$</em>{x}")).toEqual([{ tagName: "em", textContent: "$" }, "{x}"]);
  });
});

describe("which innerHTML blocks hold a caret", () => {
  test("plain markup is open, and is the content it spells", () => {
    const node: JxMutableNode = { innerHTML: BOLD, tagName: "span" };
    expect(openMarkup(node)).toEqual(BOLD_CONTENT);
    expect(isClosedContent(node)).toBe(false);
    expect(holdsOpaqueLiteral(node)).toBe(false);
    expect(prepareForEditMode(node)).toEqual(node);
    expect(contentOf(node)).toEqual(BOLD_CONTENT);
    expect(piecesOf(node)).toEqual(BOLD_CONTENT);
    expect(isAtomicInline(node)).toBe(false);
  });

  test("markup a commit could not write back closes its block", () => {
    const node: JxMutableNode = { innerHTML: '<span class="yes">Mature</span>', tagName: "td" };
    expect(openMarkup(node)).toBeNull();
    expect(isClosedContent(node)).toBe(true);
    expect(prepareForEditMode(node)).toEqual({
      ...node,
      attributes: { contenteditable: "false" },
    });
    expect(contentOf(node)).toEqual([]);
    expect(isAtomicInline(node)).toBe(true);
    // Closed, so it is carried whole rather than rebuilt from the canvas.
    expect(keptJson(node)).toBe(JSON.stringify(node));
  });

  test("content spelled twice is closed: no write could keep the two in step", () => {
    const twice: JxMutableNode = { children: BOLD_CONTENT, innerHTML: BOLD, tagName: "span" };
    expect(openMarkup(twice)).toBeNull();
    expect(isClosedContent(twice)).toBe(true);
    expect(isClosedContent({ innerHTML: "x", tagName: "p", textContent: "x" })).toBe(true);
    // An empty key beside real content is no second spelling.
    expect(isClosedContent({ innerHTML: "", tagName: "p", textContent: "x" })).toBe(false);
    expect(isClosedContent({ children: [], innerHTML: "x", tagName: "p", textContent: "" })).toBe(
      false,
    );
  });

  test("a literal innerText is closed, and bound markup still is", () => {
    const text: JxMutableNode = { innerText: "one\ntwo", tagName: "p" };
    expect(isClosedContent(text)).toBe(true);
    expect(prepareForEditMode(text)).toEqual({ ...text, attributes: { contenteditable: "false" } });
    expect(isClosedContent({ innerText: "", tagName: "p" })).toBe(false);
    expect(openMarkup({ innerHTML: "${state.html}" })).toBeNull();
    expect(isClosedContent({ innerHTML: "${state.html}", tagName: "p" })).toBe(true);
    expect(holdsOpaqueLiteral({ innerHTML: "${state.html}" })).toBe(false);
  });

  test("an open inline child's markup is content, read off the canvas and not carried", () => {
    expect(keptJson({ innerHTML: "<em>x</em>", tagName: "span" })).toBeNull();
    expect(keptJson({ className: "lead", innerHTML: "<em>x</em>", tagName: "span" })).toBe(
      JSON.stringify({ className: "lead" }),
    );
  });
});

describe("content read through markup", () => {
  test("a commit of markup nobody typed in says what the block holds", () => {
    const node: JxMutableNode = { innerHTML: BOLD, tagName: "span" };
    expect(sameContent(node, { children: BOLD_CONTENT })).toBe(true);
    // As the canvas serializes it: an empty element carries an empty text.
    expect(
      sameContent(
        { innerHTML: "a<br>b" },
        { children: ["a", { tagName: "br", textContent: "" }, "b"] },
      ),
    ).toBe(true);
    expect(sameContent({ innerHTML: "Plain." }, { textContent: "Plain." })).toBe(true);
    expect(sameContent(node, { children: [...BOLD_CONTENT, "!"] })).toBe(false);
  });

  test("an inline child's markup compares as the content it spells", () => {
    const held = { children: ["a ", { innerHTML: "<em>b</em> c", tagName: "span" }] };
    const drawn = {
      children: ["a ", { children: [{ tagName: "em", textContent: "b" }, " c"], tagName: "span" }],
    };
    expect(sameContent(held, drawn)).toBe(true);
    // Opaque markup is no content to compare: the node is itself.
    const opaque = { children: [{ innerHTML: "<i>x</i>", tagName: "span" }] };
    expect(sameContent(opaque, opaque)).toBe(true);
    expect(sameContent(opaque, { children: [{ tagName: "span", textContent: "x" }] })).toBe(false);
  });

  test("a slice through an inline child stores what it kept and drops the markup", () => {
    const content = ["a ", { innerHTML: "<em>bc</em> d", tagName: "span" }];
    expect(sliceContent(content, 0, 3)).toEqual([
      "a ",
      { children: [{ tagName: "em", textContent: "b" }], tagName: "span" },
    ]);
  });
});

describe("a write to an innerHTML block", () => {
  let tab: Tab;
  const block = (): JxMutableNode => {
    const [first] = nodesOf(tab.doc.document);
    if (!first) {
      throw new Error("the document holds no block");
    }
    return first;
  };
  const open = (...children: JxMutableNode[]): void => {
    tab = resetWorkspaceWithTab({ children, tagName: "div" });
  };

  beforeEach(() => {
    resetStudioState();
    open({ innerHTML: BOLD, tagName: "p" }, { tagName: "p", textContent: "Next." });
  });

  test("a visit writes nothing and asks for no redraw", () => {
    const onRespelled = mock();
    applyInlineCommit(tab, ["children", 0], BOLD_CONTENT, null, { onRespelled });
    expect(block()).toEqual({ innerHTML: BOLD, tagName: "p" });
    expect(tab.doc.dirty).toBe(false);
    expect(onRespelled).not.toHaveBeenCalled();
  });

  test("an edit stores children and removes the markup", () => {
    const edited = [STRONG, " Founded in Belgium in 2002."];
    applyInlineCommit(tab, ["children", 0], edited, null);
    expect(block()).toEqual({ children: edited, tagName: "p" });
  });

  test("an edit to plain text stores text and removes the markup", () => {
    applyInlineCommit(tab, ["children", 0], null, "All plain now.");
    expect(block()).toEqual({ tagName: "p", textContent: "All plain now." });
  });

  test("a split, a merge and a range replace each remove it", () => {
    applyInlineSplit(
      tab,
      ["children", 0],
      { children: [STRONG] },
      { textContent: " Founded in 2002." },
    );
    expect(block()).toEqual({ children: [STRONG], tagName: "p" });

    open({ innerHTML: BOLD, tagName: "p" }, { tagName: "p", textContent: "Next." });
    applyInlineSplit(tab, ["children", 0], { textContent: "A" }, { textContent: "B" });
    expect(block()).toEqual({ tagName: "p", textContent: "A" });

    open({ innerHTML: BOLD, tagName: "p" }, { tagName: "p", textContent: "Next." });
    expect(applyBlockMerge(tab, ["children", 1], ["children", 0])).toEqual({
      offset: 37,
      path: ["children", 0],
    });
    expect(block()).toEqual({
      children: [STRONG, " Founded in 2002.Next."],
      tagName: "p",
    });

    open({ innerHTML: "One.", tagName: "p" }, { tagName: "p", textContent: "Two." });
    applyBlockMerge(tab, ["children", 1], ["children", 0]);
    expect(block()).toEqual({ tagName: "p", textContent: "One.Two." });

    open({ innerHTML: BOLD, tagName: "p" }, { tagName: "p", textContent: "Next." });
    applyRangeReplace(
      tab,
      { offset: 20, path: ["children", 0] },
      { offset: 4, path: ["children", 1] },
      [],
      "",
    );
    expect(block()).toEqual({ children: [STRONG, "."], tagName: "p" });

    open({ innerHTML: "One.", tagName: "p" }, { tagName: "p", textContent: "Two." });
    applyRangeReplace(
      tab,
      { offset: 2, path: ["children", 0] },
      { offset: 3, path: ["children", 1] },
      [],
      "",
    );
    expect(block()).toEqual({ tagName: "p", textContent: "On." });
  });

  test("a slash insert removes it, whichever way the block is left", () => {
    const quote = { description: "A quotation", label: "Quote", tag: "blockquote" };
    applyInlineInsert(tab, ["children", 0], quote, { textContent: "Kept." });
    expect(block()).toEqual({ tagName: "p", textContent: "Kept." });

    open({ innerHTML: BOLD, tagName: "p" });
    applyInlineInsert(tab, ["children", 0], quote, { children: BOLD_CONTENT });
    expect(block()).toEqual({ children: BOLD_CONTENT, tagName: "p" });

    open({ innerHTML: "", tagName: "p" });
    applyInlineInsert(tab, ["children", 0], quote, { textContent: "" });
    expect(block().tagName).toBe("blockquote");
    expect("innerHTML" in block()).toBe(false);
  });

  test("a write to markup the canvas cannot be read back for is refused", () => {
    const opaque: JxMutableNode = { innerHTML: '<span class="yes">Mature</span>', tagName: "p" };
    open(opaque, { tagName: "p", textContent: "Next." });
    const refused = mock<CommitRefused>();

    expect(bindingRefusal(opaque, [{ textContent: "Mature" }])).toBe("markup");
    expect(bindingRefusal([null, opaque], [{ textContent: "Mature" }])).toBe("markup");
    applyInlineCommit(tab, ["children", 0], null, "Mature", { onRefused: refused });
    // Joined onto it, and removed as the block a join takes its text from.
    expect(applyBlockMerge(tab, ["children", 1], ["children", 0], refused)).toBeNull();
    open({ tagName: "p", textContent: "First." }, opaque);
    expect(applyBlockMerge(tab, ["children", 1], ["children", 0], refused)).toBeNull();

    expect(tab.doc.document.children).toEqual([{ tagName: "p", textContent: "First." }, opaque]);
    expect(refused.mock.calls.map(([, reason]) => reason)).toEqual(["markup", "markup", "markup"]);
  });
});

describe("isTextMark", () => {
  const inside = (parentTag: string, tag: string): HTMLElement => {
    const parent = document.createElement(parentTag);
    const el = document.createElement(tag);
    parent.append(el);
    return el;
  };

  test("a formatting element in a block's text is a mark", () => {
    expect(isTextMark(inside("p", "strong"))).toBe(true);
    expect(isTextMark(inside("span", "em"))).toBe(true);
    expect(isTextMark(inside("li", "code"))).toBe(true);
  });

  test("an inline element with something of its own to edit is not", () => {
    expect(isTextMark(inside("p", "a"))).toBe(false);
    expect(isTextMark(inside("p", "span"))).toBe(false);
    expect(isTextMark(inside("p", "img"))).toBe(false);
  });

  test("a formatting element that is no block's text is not", () => {
    expect(isTextMark(inside("div", "strong"))).toBe(false);
    expect(isTextMark(document.createElement("strong"))).toBe(false);
  });

  test("a press on a mark hits the block around it; a link is hit as itself", () => {
    const block = document.createElement("p");
    block.dataset.jxPath = '["children",0]';
    block.innerHTML =
      '<strong data-jx-path=\'["children",0,"children",0]\'><em>deep</em></strong>' +
      '<a data-jx-path=\'["children",0,"children",1]\'>link</a>';
    document.body.append(block);
    expect(nearestHit(block.querySelector("em"))?.path).toEqual(["children", 0]);
    expect(nearestHit(block.querySelector("a"))?.path).toEqual(["children", 0, "children", 1]);
    block.remove();
  });
});
