/**
 * The edges of editing bound text in place (studio.md §4.5, §8.2.7): what a commit, a split, a
 * merge and a cross-block delete do where a unit has no text of its own, where a template's escapes
 * stop being escapes, and where a string that is printed would come to stand as a member.
 *
 * `live-text-fidelity.test.ts` proves a commit changes only what the author changed inside one
 * block. These are the cases two blocks, or a block and its inline children, make possible. Each
 * fixture is drawn by the real runtime through the real transform and stamper, edited as the DOM,
 * and committed through the real serializer and apply.
 */
import { resetWorkspaceWithTab } from "./harness";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { buildScope, renderNode, setCanvasDelinkAnchors } from "@jxsuite/runtime";
import { cloneValue } from "@jxsuite/schema/doc-ops";
import { isNodeObject } from "@jxsuite/schema/guards";
import {
  chipSources,
  chipSourcesBetween,
  chipsIn,
  removedSources,
} from "../src/canvas/iframe-chips";
import { applyIframePatch } from "../src/canvas/iframe-patch";
import { blockTextLength, offsetOf } from "../src/canvas/iframe-position";
import { makeStamper } from "../src/canvas/iframe-render";
import { newRowView } from "../src/canvas/iframe-rows";
import { parseJxPath } from "../src/canvas/path-mapping";
import { contentLength, sameContent, sliceContent, toStored } from "../src/editor/content-slice";
import {
  commitActiveBlock,
  isEditableBlock,
  serializeContent,
  splitActiveBlock,
  startEditing,
  stopEditing,
} from "../src/editor/inline-edit";
import {
  applyBlockMerge,
  applyInlineCommit,
  applyInlineSplit,
  applyRangeReplace,
  bindingRefusal,
} from "../src/editor/inline-edit-apply";
import { normalizeInlineContent, toggleInlineFormat } from "../src/editor/inline-format";
import { applyLink } from "../src/editor/inline-link";
import {
  forgetKeptAttribute,
  KEEP_ATTR,
  keptBindingKeys,
  keptJson,
  keptNodeOf,
  stampKept,
} from "../src/editor/kept-node";
import {
  prepareForEditMode,
  refBindingKey,
  slotBindingKeys,
  unescapeTemplateText,
} from "../src/utils/edit-display";
import type { IframeRenderCtx } from "../src/canvas/iframe-render";
import type { JxContentResult } from "../src/editor/inline-edit";
import type { JxScope } from "@jxsuite/runtime/types";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { JxPath } from "../src/state";

const MAPPER = {
  canvasMode: "edit",
  layoutWrapped: false,
  pageContentOffset: null,
  pageContentPrefix: null,
} as const;

/** The state every fixture resolves against. No value is spelled like the source that reads it. */
const STATE = {
  list: ["red", "green"],
  n: 4217,
  name: "ADA",
  spans: [{ tagName: "b", textContent: "ONE" }],
  url: "/RESOLVED",
};

/** A document of `blocks`, drawn on the canvas, with the tab that holds it. */
async function setup(blocks: JxMutableNode[]) {
  const scope: JxScope = await buildScope(
    { state: structuredClone(STATE), tagName: "div" },
    {},
    "http://localhost/",
  );
  const doc: JxMutableNode = { children: structuredClone(blocks), tagName: "div" };
  const tab = resetWorkspaceWithTab({ ...structuredClone(doc), state: structuredClone(STATE) });
  const prepared = prepareForEditMode(structuredClone(doc));
  if (!isNodeObject(prepared)) {
    throw new TypeError("expected a node");
  }
  // As the canvas draws: anchors de-linked, their URL on `data-jx-href`.
  setCanvasDelinkAnchors(true);
  const root = renderNode(prepared, scope, { _path: [], onNodeCreated: makeStamper(MAPPER) });
  if (!(root instanceof HTMLElement)) {
    throw new TypeError("expected an element");
  }
  const container = document.createElement("div");
  container.append(root);
  document.body.append(container);
  // And as the frame stamps it once drawn (`iframe-entry.ts`).
  stampKept(container, doc, isEditableBlock);
  /** The element drawn for the block at `index`. */
  const el = (index: number): HTMLElement => {
    const found = root.querySelector<HTMLElement>(`[data-jx-path='["children",${index}]']`);
    if (!found) {
      throw new TypeError(`no block ${index}`);
    }
    return found;
  };
  /** The blocks as the document now holds them. */
  const stored = (): JxMutableNode[] => {
    const { children } = tab.doc.document;
    return Array.isArray(children) ? cloneValue(children).filter((c) => isNodeObject(c)) : [];
  };
  /** The text the page draws for the stored block at `index`. */
  const pageText = (index: number): string => {
    const node = stored()[index];
    const drawn = node ? renderNode(structuredClone(node), scope, { _path: [] }) : null;
    return drawn instanceof HTMLElement ? drawn.textContent : "";
  };
  /** The markup the page draws for the stored block at `index`. */
  const pageHtml = (index: number): string => {
    const node = stored()[index];
    const drawn = node ? renderNode(structuredClone(node), scope, { _path: [] }) : null;
    return drawn instanceof HTMLElement ? drawn.innerHTML : "";
  };
  return { container, doc, el, pageHtml, pageText, root, scope, stored, tab };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

/** The path stamped on `el`. */
function pathOf(el: HTMLElement): JxPath {
  return parseJxPath(el.dataset.jxPath ?? "[]");
}

/** The document offset of a DOM position in `block`. */
function at(block: HTMLElement, node: Node, offset: number): number {
  const found = offsetOf(block, node, offset);
  if (found === null) {
    throw new TypeError("the position is not in the block");
  }
  return found;
}

/**
 * Collapse a selection from (`a`, `an`, `ao`) to (`b`, `bn`, `bo`) the way the frame posts it
 * (`postRangeReplace` in `canvas/iframe-inline-edit.ts`): offsets and covered chips read off the
 * canvas. Returns whether it was refused.
 */
function replaceRange(
  fixture: Fixture,
  [a, an, ao]: [HTMLElement, Node, number],
  [b, bn, bo]: [HTMLElement, Node, number],
  text = "",
) {
  const from = { offset: at(a, an, ao), path: pathOf(a) };
  const to = { offset: at(b, bn, bo), path: pathOf(b) };
  const removed = [...chipSourcesBetween(a, from.offset), ...chipSourcesBetween(b, 0, to.offset)];
  const refused = mock();
  applyRangeReplace(fixture.tab, from, to, [], text, refused, removed);
  return { refused: refused.mock.calls.length > 0, removed };
}

/** Open a session on `el` whose commits go to `fixture`'s tab. Returns what was refused and split. */
function edit(fixture: Fixture, el: HTMLElement, removed: string[] = []) {
  const refused = mock();
  const sent: JxContentResult[] = [];
  const path = pathOf(el);
  startEditing(el, path, {
    onCommit: (p, children, textContent) => {
      sent.push(children ? { children } : { textContent });
      applyInlineCommit(fixture.tab, p, children, textContent, {
        onRefused: refused,
        removedTags: removed,
      });
    },
    onEnd: () => {},
    onInsert: () => {},
    onSplit: (p, before, after, gone) => {
      applyInlineSplit(fixture.tab, p, before, after, refused, [...removed, ...gone]);
    },
  });
  return { refused, sent };
}

/** The first text node directly in `el`. */
function textIn(el: Element): Text {
  for (const child of el.childNodes) {
    if (child instanceof Text) {
      return child;
    }
  }
  throw new TypeError("no text node");
}

/** The chip in `el` that stands for `source`. */
function chipOf(el: HTMLElement, source: string): Element {
  const chip = chipsIn(el)[chipSources(el).indexOf(source)];
  if (!chip) {
    throw new TypeError(`no chip for ${source}`);
  }
  return chip;
}

/** The index of `node` among its parent's child nodes. */
function indexOf(node: Node): number {
  let index = 0;
  for (let prev = node.previousSibling; prev; prev = prev.previousSibling) {
    index += 1;
  }
  return index;
}

/**
 * An inline `tagName` whose text is a `{ "$ref" }` to `pointer`: a key the node type spells as a
 * string, which documents hold as a reference all the same.
 */
function refInline(tagName: string, pointer: string): JxMutableNode {
  const node: JxMutableNode = { tagName };
  return Object.assign(node, { textContent: { $ref: pointer } });
}

const REF_EM = refInline("em", "#/state/n");

afterEach(() => {
  setCanvasDelinkAnchors(false);
  stopEditing(true);
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("an element closed to the caret is one unit: before it and after it are two offsets", () => {
  test("a cross-block delete that starts after one keeps it", async () => {
    const f = await setup([
      { children: ["Price: ", REF_EM], tagName: "p" },
      { tagName: "p", textContent: "Tail" },
    ]);
    const a = f.el(0);
    const b = f.el(1);
    // Before the <em> and after it are different positions, and so different offsets.
    expect(at(a, a, 1)).toBe(7);
    expect(at(a, a, 2)).toBe(8);
    expect(blockTextLength(a)).toBe(8);
    const done = replaceRange(f, [a, a, a.childNodes.length], [b, textIn(b), 1]);
    expect(done).toEqual({ refused: false, removed: [] });
    expect(f.stored()).toEqual([{ children: ["Price: ", REF_EM, "ail"], tagName: "p" }]);
  });

  test("one that starts before it takes it, and says so", async () => {
    const f = await setup([
      { children: ["Price: ", REF_EM], tagName: "p" },
      { tagName: "p", textContent: "Tail" },
    ]);
    const a = f.el(0);
    const b = f.el(1);
    const done = replaceRange(f, [a, a, 1], [b, textIn(b), 1]);
    expect(done).toEqual({ refused: false, removed: [refBindingKey("#/state/n")] });
    expect(f.stored()).toEqual([{ tagName: "p", textContent: "Price: ail" }]);
  });

  test("a cross-block delete that ends in a block one closes keeps it", async () => {
    const f = await setup([
      { tagName: "p", textContent: "Hello" },
      { children: ["Price: ", REF_EM], tagName: "p" },
    ]);
    const a = f.el(0);
    const b = f.el(1);
    const done = replaceRange(f, [a, textIn(a), 2], [b, textIn(b), 1], "Z");
    expect(done).toEqual({ refused: false, removed: [] });
    expect(f.stored()).toEqual([{ children: ["HeZrice: ", REF_EM], tagName: "p" }]);
  });

  test("Enter over one selected whole drops it, as typing over it would", async () => {
    const f = await setup([{ children: ["Price: ", REF_EM, " each"], tagName: "p" }]);
    const el = f.el(0);
    const session = edit(f, el);
    window.getSelection()?.setBaseAndExtent(el, 1, el, 2);
    expect(splitActiveBlock()).toBe(true);
    expect(session.refused).not.toHaveBeenCalled();
    expect(f.stored()).toEqual([
      { tagName: "p", textContent: "Price: " },
      { tagName: "p", textContent: " each" },
    ]);
  });

  test("storage counts one as the canvas does, whatever it shows or stores", async () => {
    const closed: JxMutableNode[] = [
      {
        children: [{ tagName: "b", textContent: "!" }],
        tagName: "span",
        textContent: "${state.name}",
      },
      { innerHTML: "${state.name}", tagName: "span" },
      { tagName: "x-badge", textContent: "new!" },
      REF_EM,
    ];
    for (const inline of closed) {
      const content = [inline, "abcdef"];
      expect(contentLength(content)).toBe(7);
      // A cut after the unit and four characters on keeps the unit and those four.
      expect(sliceContent(content, 0, 5)).toEqual([inline, "abcd"]);
      // One that ends before the unit keeps none of it; one that starts after it, none of it.
      expect(sliceContent(content, 0, 0)).toEqual([]);
      expect(sliceContent(content, 1, 7)).toEqual(["abcdef"]);
    }
    const f = await setup([{ children: [closed[0]!, "abcdef"], tagName: "p" }]);
    const el = f.el(0);
    expect(at(el, el, 1)).toBe(1);
    expect(blockTextLength(el)).toBe(7);
    expect(at(el, textIn(el), 4)).toBe(5);
  });
});

describe("a template's literal run is written as text once the string is no template", () => {
  /** `C:\temp ` as a template spells it, and as the page shows it. */
  const ESCAPED = String.raw`C:\\temp `;
  const SHOWN = String.raw`C:\temp `;
  const BLOCK: JxMutableNode = { tagName: "p", textContent: `${ESCAPED}\${state.name}` };

  test("unescapeTemplateText reads a run as a template literal reads it", () => {
    expect(unescapeTemplateText(ESCAPED)).toBe(SHOWN);
    expect(unescapeTemplateText(String.raw`a\`b`)).toBe("a`b");
    expect(unescapeTemplateText(String.raw`a\nb\tc\$d\q`)).toBe("a\nb\tc$dq");
    expect(unescapeTemplateText(`${String.raw`\$`}{x}`)).toBe("${x}");
    expect(unescapeTemplateText(String.raw`\x41\u0042\u{43}\0`)).toBe("ABC\0");
    expect(unescapeTemplateText("plain")).toBe("plain");
    // Not a template literal a page could evaluate: there is no text to read.
    expect(unescapeTemplateText(String.raw`bad \u12`)).toBeNull();
    expect(unescapeTemplateText(String.raw`bad \u{110000}`)).toBeNull();
    expect(unescapeTemplateText(String.raw`bad \u{12`)).toBeNull();
    expect(unescapeTemplateText(String.raw`bad \uZZZZ`)).toBeNull();
    expect(unescapeTemplateText(String.raw`octal \07`)).toBeNull();
    expect(unescapeTemplateText(String.raw`octal \7`)).toBeNull();
    expect(unescapeTemplateText(String.raw`bad \x4`)).toBeNull();
    expect(unescapeTemplateText("ends \\")).toBeNull();
    // A backslash before a line break continues the line: neither is text.
    expect(unescapeTemplateText("a\\\nb\\\r\nc")).toBe("abc");
    expect(unescapeTemplateText("a ` b")).toBeNull();
  });

  test("deleting the chip leaves the text the page showed", async () => {
    const f = await setup([BLOCK]);
    const el = f.el(0);
    expect(f.pageText(0)).toBe(`${SHOWN}ADA`);
    const was = chipSources(el);
    chipOf(el, "${state.name}").remove();
    const session = edit(f, el, removedSources(was, chipSources(el)));
    stopEditing(true);
    expect(session.refused).not.toHaveBeenCalled();
    expect(f.stored()).toEqual([{ tagName: "p", textContent: SHOWN }]);
    expect(f.pageText(0)).toBe(SHOWN);
  });

  test("Enter before the chip leaves the text the page showed in the first half", async () => {
    const f = await setup([BLOCK]);
    const el = f.el(0);
    const session = edit(f, el);
    window.getSelection()?.collapse(el, indexOf(chipOf(el, "${state.name}")));
    expect(splitActiveBlock()).toBe(true);
    expect(session.refused).not.toHaveBeenCalled();
    expect(f.stored()).toEqual([
      { tagName: "p", textContent: SHOWN },
      { tagName: "p", textContent: "${state.name}" },
    ]);
    expect(f.pageText(0)).toBe(SHOWN);
  });

  test("bold over the run stores the text, and the block is drawn again", async () => {
    const f = await setup([{ tagName: "p", textContent: `${ESCAPED}\${state.name}!` }]);
    const el = f.el(0);
    const inPlace: boolean[] = [];
    startEditing(el, [...pathOf(el)], {
      onCommit: (p, children, textContent, here) => {
        inPlace.push(here);
        applyInlineCommit(f.tab, p, children, textContent);
      },
      onEnd: () => {},
      onInsert: () => {},
      onSplit: () => {},
    });
    window.getSelection()?.setBaseAndExtent(el, 0, el, indexOf(chipOf(el, "${state.name}")));
    toggleInlineFormat("strong", el);
    commitActiveBlock();
    expect(f.stored()).toEqual([
      {
        children: [{ tagName: "strong", textContent: SHOWN }, "${state.name}!"],
        tagName: "p",
      },
    ]);
    expect(f.pageText(0)).toBe(`${SHOWN}ADA!`);
    // The canvas still shows a chip where the document now holds text: not left in place.
    expect(inPlace).toEqual([false]);
  });

  test("a cut that leaves a piece of a template with no ${ stores that piece as text", async () => {
    const f = await setup([
      { tagName: "p", textContent: "first" },
      { tagName: "p", textContent: `\${state.name} ${ESCAPED}` },
    ]);
    const a = f.el(0);
    const b = f.el(1);
    const chip = chipOf(b, "${state.name}");
    const done = replaceRange(f, [a, textIn(a), 2], [b, b, indexOf(chip) + 1]);
    expect(done).toEqual({ refused: false, removed: ["${state.name}"] });
    expect(f.stored()).toEqual([{ tagName: "p", textContent: `fi ${SHOWN}` }]);
    expect(f.pageText(0)).toBe(`fi ${SHOWN}`);
  });

  test("the same inside an inline element of the block", async () => {
    const f = await setup([
      { tagName: "p", textContent: "first" },
      {
        children: [{ tagName: "u", textContent: String.raw`${"${state.name}"}a\\b` }, " end"],
        tagName: "p",
      },
    ]);
    const a = f.el(0);
    const b = f.el(1);
    const u = b.querySelector("u");
    if (!u) {
      throw new TypeError("no <u>");
    }
    const done = replaceRange(
      f,
      [a, textIn(a), 2],
      [b, u, indexOf(chipOf(b, "${state.name}")) + 1],
    );
    expect(done.refused).toBe(false);
    expect(f.stored()).toEqual([
      { children: ["fi", { tagName: "u", textContent: String.raw`a\b` }, " end"], tagName: "p" },
    ]);
  });

  test("a plain string beside a member is not a piece of any template", async () => {
    const f = await setup([
      { children: [SHOWN, "${state.name}"], tagName: "p" },
      { tagName: "p", textContent: "Tail" },
    ]);
    const a = f.el(0);
    const b = f.el(1);
    // From the end of the first block, with nothing of it selected.
    const done = replaceRange(f, [a, a, a.childNodes.length], [b, textIn(b), 1]);
    expect(done).toEqual({ refused: false, removed: [] });
    expect(f.stored()).toEqual([{ children: [SHOWN, "${state.name}", "ail"], tagName: "p" }]);

    const g = await setup([
      { tagName: "p", textContent: "Head" },
      { children: ["a `b` ", "${state.name}"], tagName: "p" },
    ]);
    const typed = replaceRange(
      g,
      [g.el(0), textIn(g.el(0)), 2],
      [g.el(1), textIn(g.el(1)), 0],
      "Z",
    );
    expect(typed.refused).toBe(false);
    expect(g.stored()).toEqual([{ children: ["HeZa `b` ", "${state.name}"], tagName: "p" }]);
  });
});

describe("a string that is printed never comes to stand as a member", () => {
  test("a merge onto a textContent that is one template joins the text on", async () => {
    const f = await setup([
      { tagName: "p", textContent: "${state.list}" },
      { tagName: "p", textContent: "Tail" },
    ]);
    expect(f.pageText(0)).toBe("red,green");
    const refused = mock();
    expect(applyBlockMerge(f.tab, ["children", 1], ["children", 0], refused)).toEqual({
      offset: "${state.list}".length,
      path: ["children", 0],
    });
    expect(refused).not.toHaveBeenCalled();
    expect(f.stored()).toEqual([{ tagName: "p", textContent: "${state.list}Tail" }]);
    expect(f.pageText(0)).toBe("red,greenTail");
  });

  test("a merge of a textContent template onto text joins it the same way", async () => {
    const f = await setup([
      { tagName: "p", textContent: "Head " },
      { tagName: "p", textContent: "${state.list}" },
    ]);
    applyBlockMerge(f.tab, ["children", 1], ["children", 0]);
    expect(f.stored()).toEqual([{ tagName: "p", textContent: "Head ${state.list}" }]);
    expect(f.pageText(0)).toBe("Head red,green");
  });

  test("a member stays a member through the same merge", async () => {
    const f = await setup([
      { children: ["${state.spans}"], tagName: "p" },
      { tagName: "p", textContent: "Tail" },
    ]);
    applyBlockMerge(f.tab, ["children", 1], ["children", 0]);
    expect(f.stored()).toEqual([{ children: ["${state.spans}", "Tail"], tagName: "p" }]);
    expect(f.pageHtml(0)).toBe("<b>ONE</b>Tail");
  });

  test("a merge that would leave a printed template beside an element is refused", async () => {
    const f = await setup([
      { tagName: "p", textContent: "${state.spans}" },
      { children: [{ tagName: "strong", textContent: "x" }, " y"], tagName: "p" },
    ]);
    const before = f.stored();
    const refused = mock();
    expect(applyBlockMerge(f.tab, ["children", 1], ["children", 0], refused)).toBeNull();
    expect(refused).toHaveBeenCalledTimes(1);
    expect(f.stored()).toEqual(before);
  });

  test("a cut that leaves one whole ${…} of a longer string keeps it printed", async () => {
    const f = await setup([
      { tagName: "p", textContent: "Head" },
      { children: ["Tags${state.spans}", { tagName: "br" }], tagName: "p" },
    ]);
    expect(f.pageText(1)).toBe("Tags[object Object]");
    const b = f.el(1);
    const run = b.querySelector("[data-jx-text]");
    if (!run) {
      throw new TypeError("no text run");
    }
    const done = replaceRange(f, [f.el(0), textIn(f.el(0)), 2], [b, textIn(run), 4]);
    expect(done.refused).toBe(false);
    expect(f.stored()).toEqual([
      { children: ["He${state.spans}", { tagName: "br" }], tagName: "p" },
    ]);
    expect(f.pageText(0)).toBe("He[object Object]");
  });

  test("bold beside a printed template that would leave it alone is refused", async () => {
    const block: JxMutableNode = { tagName: "p", textContent: "Tags${state.spans}" };
    const f = await setup([block]);
    const el = f.el(0);
    const session = edit(f, el);
    window.getSelection()?.setBaseAndExtent(textIn(el), 0, textIn(el), 4);
    toggleInlineFormat("strong", el);
    stopEditing(true);
    expect(session.sent).toEqual([
      { children: [{ tagName: "strong", textContent: "Tags" }, "${state.spans}"] },
    ]);
    expect(session.refused).toHaveBeenCalledTimes(1);
    expect(f.stored()).toEqual([block]);
  });

  test("Enter after a printed chip that would leave it a member is refused", async () => {
    const block: JxMutableNode = {
      children: [{ tagName: "strong", textContent: "A" }, "${state.spans}é"],
      tagName: "p",
    };
    const f = await setup([block]);
    const el = f.el(0);
    const session = edit(f, el);
    const chip = chipOf(el, "${state.spans}");
    window.getSelection()?.collapse(chip.parentNode, indexOf(chip) + 1);
    splitActiveBlock();
    expect(session.refused).toHaveBeenCalledTimes(1);
    expect(f.stored()).toEqual([block]);
  });

  test("a member may be new, and may not be made of a binding that was printed", () => {
    const printed: JxMutableNode = { tagName: "p", textContent: "Tags ${state.spans}" };
    const strong: JxMutableNode = { tagName: "strong", textContent: "Tags" };
    expect(bindingRefusal(printed, [{ children: [strong, "${state.spans}"] }])).toBe("alone");
    expect(bindingRefusal(printed, [{ children: [strong, " ${state.spans}"] }])).toBeNull();
    // A binding the author added beside the one that was there may stand as a member.
    expect(
      bindingRefusal(printed, [{ children: ["Tags ${state.spans}", strong, "${state.spans}"] }]),
    ).toBeNull();
    expect(
      bindingRefusal(printed, [{ children: ["Tags ${state.spans}", strong, "${state.n}"] }]),
    ).toBeNull();
    // One that was a member already still is, and a second copy of it may not become one.
    const member: JxMutableNode = {
      children: ["${state.spans}", strong, "x ${state.spans}"],
      tagName: "p",
    };
    expect(
      bindingRefusal(member, [{ children: ["${state.spans}", strong, "x ${state.spans}", "!"] }]),
    ).toBeNull();
    expect(
      bindingRefusal(member, [{ children: ["${state.spans}", strong, "${state.spans}"] }]),
    ).toBe("alone");
    // A deleted chip is not what a member may be made of either.
    expect(
      bindingRefusal(member, [{ children: [strong, "${state.spans}"] }], ["${state.spans}"]),
    ).toBeNull();
    expect(bindingRefusal(printed, [{ textContent: "Tags" }])).toBe("lost");
  });

  test("sameContent tells a printed template from a member, both ways", () => {
    const printed = { textContent: "${state.spans}" };
    const member = { children: ["${state.spans}"] };
    expect(sameContent(printed, member)).toBe(false);
    expect(sameContent(member, printed)).toBe(false);
    expect(sameContent(printed, { textContent: "${state.spans}" })).toBe(true);
    expect(sameContent(member, { children: ["${state.spans}"] })).toBe(true);
    expect(toStored(["${state.spans}"])).toEqual({ children: ["${state.spans}"] });
  });
});

describe("two strings a join would make an expression of stay two strings", () => {
  test.each([[["a $", "{b}"]], [["$", "{"]], [["cost: $", "{", "x"]]])(
    "a caret that only visits %j writes nothing",
    async (children) => {
      const block: JxMutableNode = { children, tagName: "p" };
      const f = await setup([block]);
      const el = f.el(0);
      expect(el.textContent).toBe(children.join(""));
      const session = edit(f, el);
      stopEditing(true);
      expect(session.refused).not.toHaveBeenCalled();
      expect(f.stored()).toEqual([block]);
      expect(f.tab.doc.dirty).toBeFalsy();
      expect(f.pageText(0)).toBe(children.join(""));
    },
  );

  test("only two PLAIN strings are kept apart that way: beside a template there is nothing to join", async () => {
    const f = await setup([{ children: ["$", "{x} ${state.name}", "$", "plain"], tagName: "p" }]);
    const el = f.el(0);
    // Each `$` is the author's text in a text node, not a chip closed to the caret.
    expect(chipSources(el)).toEqual(["${state.name}"]);
    expect([...el.childNodes].map((node) => node.nodeType)).toEqual([3, 1, 3, 3]);
  });

  test("typing beside them keeps them apart", async () => {
    const f = await setup([{ children: ["a $", "{b}"], tagName: "p" }]);
    const el = f.el(0);
    const session = edit(f, el);
    el.append(" typed");
    stopEditing(true);
    expect(session.refused).not.toHaveBeenCalled();
    expect(f.stored()).toEqual([{ children: ["a $", "{b} typed"], tagName: "p" }]);
    expect(f.pageText(0)).toBe("a ${b} typed");
  });
});

describe("an inline element closed to the caret is not formatting to normalize", () => {
  const X_EM: JxMutableNode = { tagName: "em", textContent: "x" };
  const NAME_EM = refInline("em", "#/state/name");
  const NAME_CODE = refInline("code", "#/state/name");

  test.each<[string, (JxMutableNode | string)[]]>([
    ["a same-tag inline before it", [X_EM, NAME_EM]],
    ["a same-tag inline after it", [NAME_EM, X_EM]],
    ["two of them side by side", [NAME_EM, REF_EM]],
    ["one nested alone in its own tag", [{ children: [NAME_EM], tagName: "em" }]],
    ["a <code> whose text is a reference", ["See ", NAME_CODE]],
    [
      "a <code> holding a whole-template member",
      [{ children: ["${state.name}", " x"], tagName: "code" }],
    ],
    ["a <code> holding a template", [{ tagName: "code", textContent: "v${state.n}" }]],
  ])("a caret visit to %s writes nothing and is not refused", async (_name, children) => {
    const block: JxMutableNode = { children, tagName: "p" };
    const f = await setup([block]);
    const el = f.el(0);
    normalizeInlineContent(el);
    expect(serializeContent(el)).toEqual({ children });
    const session = edit(f, el);
    stopEditing(true);
    expect(session.refused).not.toHaveBeenCalled();
    expect(f.stored()).toEqual([block]);
    expect(f.tab.doc.dirty).toBeFalsy();
  });

  test("typing in such a block is stored", async () => {
    const f = await setup([{ children: [X_EM, NAME_EM], tagName: "p" }]);
    const el = f.el(0);
    const session = edit(f, el);
    el.append(" typed");
    stopEditing(true);
    expect(session.refused).not.toHaveBeenCalled();
    expect(f.stored()).toEqual([{ children: [X_EM, NAME_EM, " typed"], tagName: "p" }]);
  });

  test("three nested wrappers of one tag collapse to one and do not throw", async () => {
    const f = await setup([
      {
        children: [{ children: [{ children: [X_EM], tagName: "em" }], tagName: "em" }],
        tagName: "p",
      },
    ]);
    const el = f.el(0);
    expect(() => normalizeInlineContent(el)).not.toThrow();
    expect(serializeContent(el)).toEqual({ children: [X_EM] });
  });
});

describe("normalizing text keeps the selection where it was", () => {
  test("an end anchored after the node that is absorbed moves back with it", async () => {
    const f = await setup([{ tagName: "p", textContent: "Hello ${state.name} world${state.n}" }]);
    const el = f.el(0);
    const was = chipSources(el);
    chipOf(el, "${state.name}").remove();
    expect(el.childNodes).toHaveLength(3);
    // Shift+End from inside " world": the focus lands after the chip that ends the block.
    window.getSelection()?.setBaseAndExtent(el.childNodes[1]!, 2, el, 3);
    const session = edit(f, el, removedSources(was, chipSources(el)));
    expect(() => commitActiveBlock()).not.toThrow();
    expect(session.refused).not.toHaveBeenCalled();
    expect(f.stored()).toEqual([{ tagName: "p", textContent: "Hello  world${state.n}" }]);
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(el.firstChild);
    expect(selection?.anchorOffset).toBe(8);
    expect(selection?.focusNode).toBe(el);
    expect(selection?.focusOffset).toBe(2);
  });

  test("an end anchored before the absorbed node, or in another element, is left alone", async () => {
    const f = await setup([
      { children: ["a", "b", { tagName: "strong", textContent: "c" }], tagName: "p" },
    ]);
    const el = f.el(0);
    const strong = el.querySelector("strong");
    if (!strong) {
      throw new TypeError("no <strong>");
    }
    window.getSelection()?.setBaseAndExtent(el, 1, strong, 1);
    normalizeInlineContent(el);
    const selection = window.getSelection();
    expect(el.childNodes).toHaveLength(2);
    expect(selection?.anchorNode).toBe(el);
    expect(selection?.anchorOffset).toBe(1);
    expect(selection?.focusNode).toBe(strong);
    expect(selection?.focusOffset).toBe(1);
  });
});

describe("a visit that re-spells nothing in the document leaves the canvas matching it", () => {
  test("a commit that only joined text nodes asks for the block to be drawn again", async () => {
    const block: JxMutableNode = {
      children: ["Hello ", "world", { tagName: "strong", textContent: "!" }],
      tagName: "p",
    };
    const f = await setup([block]);
    const el = f.el(0);
    const respelled = mock();
    startEditing(el, [...pathOf(el)], {
      onCommit: (p, children, textContent) => {
        applyInlineCommit(f.tab, p, children, textContent, { onRespelled: respelled });
      },
      onEnd: () => {},
      onInsert: () => {},
      onSplit: () => {},
    });
    stopEditing(true);
    expect(f.stored()).toEqual([block]);
    expect(f.tab.doc.dirty).toBeFalsy();
    // The canvas holds two nodes where the document holds three members: it must be redrawn.
    expect(el.childNodes).toHaveLength(2);
    expect(respelled.mock.calls).toEqual([[["children", 0]]]);
  });

  test("a commit spelled as the document spells it asks for nothing", async () => {
    const children: (JxMutableNode | string)[] = [
      "Hello world",
      { tagName: "strong", textContent: "!" },
    ];
    const block: JxMutableNode = { children, tagName: "p" };
    const f = await setup([block, { tagName: "p" }]);
    const respelled = mock();
    applyInlineCommit(f.tab, ["children", 0], structuredClone(children), null, {
      onRespelled: respelled,
    });
    // An empty block committed as empty text is not spelled differently: neither holds content.
    applyInlineCommit(f.tab, ["children", 1], null, "", { onRespelled: respelled });
    expect(respelled.mock.calls).toEqual([]);
    expect(f.stored()).toEqual([block, { tagName: "p" }]);
    expect(f.tab.doc.dirty).toBeFalsy();
  });

  test("drawn again, a structural patch lands where the document puts it", async () => {
    const children: (JxMutableNode | string)[] = [
      "Hello ",
      "world",
      { tagName: "strong", textContent: "!" },
    ];
    const f = await setup([{ children, tagName: "p" }]);
    // A visit joined the two text nodes: the canvas is one node short of the document.
    normalizeInlineContent(f.el(0));
    expect(f.el(0).childNodes).toHaveLength(2);
    const shadow = structuredClone(f.doc);
    const ctx: IframeRenderCtx = {
      defs: f.scope,
      docBase: "http://localhost/",
      hooks: {},
      mapperCtx: MAPPER,
      mode: "edit",
      rows: newRowView(),
    };
    // The redraw a re-spelled commit asks for: the block's own content, set again.
    applyIframePatch(
      shadow,
      [{ key: "children", op: "set-key", path: ["children", 0], value: structuredClone(children) }],
      f.container,
      ctx,
    );
    applyIframePatch(
      shadow,
      [
        {
          index: 2,
          node: { tagName: "em", textContent: "NEW" },
          op: "insert-child",
          parentPath: ["children", 0],
        },
      ],
      f.container,
      ctx,
    );
    expect(f.el(0).textContent).toBe("Hello worldNEW!");
  });
});

describe("an inline element keeps what its node holds besides content", () => {
  /** `attributes` with its `href` a reference to `pointer`: a key the type spells as a string. */
  function refHref(attributes: NonNullable<JxMutableNode["attributes"]>, pointer: string) {
    return Object.assign(attributes, { href: { $ref: pointer } });
  }
  const REF_HREF = refHref({ rel: "me" }, "#/state/url");

  const BOUND_LINK: JxMutableNode = {
    attributes: { href: "${state.url}", title: "${state.name}" },
    tagName: "a",
    textContent: "the link",
  };

  test.each<[string, JxMutableNode]>([
    ["a link whose href and title are bound", BOUND_LINK],
    [
      "a link whose href is a reference",
      {
        attributes: REF_HREF,
        tagName: "a",
        textContent: "here",
      },
    ],
    ["a span with a class", { attributes: { class: "hl" }, tagName: "span", textContent: "here" }],
    [
      "a span with a style and a handler",
      {
        onclick: { $ref: "#/state/go" },
        style: { color: "red" },
        tagName: "span",
        textContent: "here",
      },
    ],
    ["an image", { attributes: { alt: "A", src: "/a.png" }, tagName: "img" }],
    ["an inline whose content is bound markup", { innerHTML: "${state.name}", tagName: "span" }],
    [
      "a component instance",
      { $props: { label: "${state.name}" }, tagName: "x-badge", textContent: "new" },
    ],
  ])(
    "a visit to a paragraph holding %s writes nothing, and typing keeps it",
    async (_n, inline) => {
      const block: JxMutableNode = { children: ["See ", inline, " now"], tagName: "p" };
      const f = await setup([block]);
      const el = f.el(0);
      const visit = edit(f, el);
      stopEditing(true);
      expect(visit.refused).not.toHaveBeenCalled();
      expect(f.stored()).toEqual([block]);
      expect(f.tab.doc.dirty).toBeFalsy();

      textIn(el).data = "Sexe ";
      const typed = edit(f, el);
      stopEditing(true);
      expect(typed.refused).not.toHaveBeenCalled();
      expect(f.stored()).toEqual([{ children: ["Sexe ", inline, " now"], tagName: "p" }]);
    },
  );

  test("the canvas shows the resolved URL, and the commit carries the binding", async () => {
    const f = await setup([{ children: ["See ", BOUND_LINK], tagName: "p" }]);
    const anchor = f.el(0).querySelector("a");
    expect(anchor?.dataset.jxHref).toBe("/RESOLVED");
    expect(serializeContent(f.el(0))).toEqual({ children: ["See ", BOUND_LINK] });
  });

  test("a URL set in the link popover replaces the one the node held, and says so", async () => {
    const f = await setup([{ children: ["See ", BOUND_LINK], tagName: "p" }]);
    const el = f.el(0);
    const anchor = el.querySelector("a");
    if (!anchor) {
      throw new TypeError("no link");
    }
    window.getSelection()?.setBaseAndExtent(textIn(anchor), 0, textIn(anchor), 3);
    const replaced = applyLink(el, "/new");
    expect(replaced).toEqual(slotBindingKeys("${state.url}", "attributes/href"));
    // Still de-linked, and its title still the binding it was.
    expect(anchor.dataset.jxHref).toBe("/new");
    expect(anchor.hasAttribute("href")).toBe(false);
    const linked: JxMutableNode = {
      attributes: { href: "/new", title: "${state.name}" },
      tagName: "a",
      textContent: "the link",
    };
    expect(serializeContent(el)).toEqual({ children: ["See ", linked] });
    // Unreported, a binding went missing that nobody deleted; reported, it is the author's.
    expect(bindingRefusal(f.stored()[0], [serializeContent(el)])).toBe("lost");
    const session = edit(f, el, replaced);
    stopEditing(true);
    expect(session.refused).not.toHaveBeenCalled();
    expect(f.stored()).toEqual([{ children: ["See ", linked], tagName: "p" }]);
  });

  test("unlinking reports every binding the link held outside its text", async () => {
    const f = await setup([
      {
        children: [
          "See ",
          { attributes: { href: "${state.url}" }, tagName: "a", textContent: "${state.name}'s" },
        ],
        tagName: "p",
      },
    ]);
    const el = f.el(0);
    const anchor = el.querySelector("a");
    if (!anchor) {
      throw new TypeError("no link");
    }
    window.getSelection()?.setBaseAndExtent(textIn(anchor), 0, textIn(anchor), 2);
    const removed = applyLink(el, null);
    expect(removed).toEqual(slotBindingKeys("${state.url}", "attributes/href"));
    const session = edit(f, el, removed);
    stopEditing(true);
    expect(session.refused).not.toHaveBeenCalled();
    expect(f.stored()).toEqual([{ tagName: "p", textContent: "See ${state.name}'s" }]);
    // A link that holds no binding, and a selection in no link at all, report nothing.
    const g = await setup([
      {
        children: [{ attributes: { href: "/a" }, tagName: "a", textContent: "plain" }],
        tagName: "p",
      },
    ]);
    const plain = g.el(0).querySelector("a");
    if (!plain) {
      throw new TypeError("no link");
    }
    window.getSelection()?.setBaseAndExtent(textIn(plain), 0, textIn(plain), 2);
    expect(applyLink(g.el(0), "/b")).toEqual([]);
    expect(serializeContent(g.el(0))).toEqual({
      children: [{ attributes: { href: "/b" }, tagName: "a", textContent: "plain" }],
    });
  });

  test("a link the author makes is read off the canvas", async () => {
    const f = await setup([{ tagName: "p", textContent: "plain" }]);
    const el = f.el(0);
    const made = document.createElement("a");
    made.setAttribute("href", "/made");
    made.title = "Made";
    made.textContent = "link";
    el.append(made);
    expect(serializeContent(el)).toEqual({
      children: [
        "plain",
        { attributes: { href: "/made", title: "Made" }, tagName: "a", textContent: "link" },
      ],
    });
  });

  test("two links, or two spans, that hold different things are not merged into one", async () => {
    const children: (JxMutableNode | string)[] = [
      { attributes: { href: "/one" }, tagName: "a", textContent: "A" },
      { attributes: { href: "/two" }, tagName: "a", textContent: "B" },
      { attributes: { class: "hl" }, tagName: "span", textContent: "C" },
      { attributes: { class: "dim" }, tagName: "span", textContent: "D" },
    ];
    const f = await setup([{ children, tagName: "p" }]);
    const el = f.el(0);
    normalizeInlineContent(el);
    expect(el.children).toHaveLength(4);
    expect(serializeContent(el)).toEqual({ children });
    // Split in two, a span is the same span in both halves, and those two are one again.
    const twin = el.children[2]?.cloneNode(true);
    if (twin) {
      el.children[2]?.after(twin);
    }
    normalizeInlineContent(el);
    expect(el.children).toHaveLength(4);
    expect(el.children[2]?.textContent).toBe("CC");
  });

  test("a key patched in place is the key the next commit carries", async () => {
    const span: JxMutableNode = { style: { color: "red" }, tagName: "span", textContent: "here" };
    const f = await setup([{ children: ["See ", span], tagName: "p" }]);
    const shadow = structuredClone(f.doc);
    const ctx: IframeRenderCtx = {
      defs: f.scope,
      docBase: "http://localhost/",
      hooks: {},
      mapperCtx: MAPPER,
      mode: "edit",
      rows: newRowView(),
    };
    const slot = ["children", 0, "children", 1];
    applyIframePatch(
      shadow,
      [{ key: "style", op: "set-key", path: slot, value: { color: "blue" } }],
      f.container,
      ctx,
    );
    expect(serializeContent(f.el(0))).toEqual({
      children: ["See ", { ...span, style: { color: "blue" } }],
    });
    // Drawn again by a patch, an element is stamped again; with nothing left to keep, unstamped.
    applyIframePatch(
      shadow,
      [{ key: "attributes", op: "set-key", path: slot, value: { class: "hl" } }],
      f.container,
      ctx,
    );
    expect(serializeContent(f.el(0))).toEqual({
      children: ["See ", { ...span, attributes: { class: "hl" }, style: { color: "blue" } }],
    });
    applyIframePatch(
      shadow,
      [
        { key: "attributes", op: "set-key", path: slot, value: undefined },
        { key: "style", op: "set-key", path: slot, value: undefined },
      ],
      f.container,
      ctx,
    );
    expect(f.el(0).querySelector("span")?.hasAttribute(KEEP_ATTR)).toBe(false);
    // A diff side is read, not written: nothing is edited in place there.
    const g = await setup([{ children: ["See ", span], tagName: "p" }]);
    g.el(0).querySelector("span")?.removeAttribute(KEEP_ATTR);
    applyIframePatch(
      structuredClone(g.doc),
      [{ key: "style", op: "set-key", path: slot, value: { color: "blue" } }],
      g.container,
      { ...ctx, defs: g.scope, mode: "git-diff" },
    );
    expect(g.el(0).querySelector("span")?.hasAttribute(KEEP_ATTR)).toBe(false);
  });

  test("keptJson: the whole node when it is closed to the caret, else all but tag and content", () => {
    expect(keptJson({ tagName: "em", textContent: "x" })).toBeNull();
    expect(keptJson({ children: ["x"], tagName: "em" })).toBeNull();
    expect(keptJson({ attributes: { class: "hl" }, tagName: "span", textContent: "x" })).toBe(
      '{"attributes":{"class":"hl"}}',
    );
    const badge: JxMutableNode = { tagName: "x-badge", textContent: "new" };
    expect(keptJson(badge)).toBe(JSON.stringify(badge));
    expect(keptJson(REF_EM)).toBe(JSON.stringify(REF_EM));
  });

  test("stampKept stamps only under a parent that holds a caret, and takes a stale stamp off", () => {
    const host = document.createElement("div");
    host.innerHTML =
      `<p data-jx-path='["children",0]'><span data-jx-path='["children",0,"children",0]' ${KEEP_ATTR}='{"old":1}'>a</span>` +
      `<span data-jx-path='["children",0,"children",1]'>b</span><i>c</i></p>` +
      `<section data-jx-path='["children",1]'><span data-jx-path='["children",1,"children",0]'>d</span></section>`;
    const doc: JxMutableNode = {
      children: [
        {
          attributes: { id: "block" },
          children: [
            { tagName: "span", textContent: "a" },
            { attributes: { class: "hl" }, tagName: "span", textContent: "b" },
          ],
          tagName: "p",
        },
        {
          children: [{ attributes: { class: "x" }, tagName: "span", textContent: "d" }],
          tagName: "section",
        },
      ],
      tagName: "div",
    };
    stampKept(host, doc, (parent) => parent.tagName === "P");
    const kept = [...host.querySelectorAll("[data-jx-path]")].map((el) =>
      el.getAttribute(KEEP_ATTR),
    );
    // The paragraph's own parent holds no caret; the section's span is under one that does not.
    expect(kept).toEqual([null, null, '{"attributes":{"class":"hl"}}', null, null]);
  });

  test("keptNodeOf reads only what the frame stamped; forgetKeptAttribute drops one attribute", () => {
    const el = document.createElement("a");
    expect(keptNodeOf(el)).toBeNull();
    el.setAttribute(KEEP_ATTR, "{not json");
    expect(keptNodeOf(el)).toBeNull();
    el.setAttribute(KEEP_ATTR, '"a string"');
    expect(keptNodeOf(el)).toBeNull();
    forgetKeptAttribute(el, "href");
    expect(el.getAttribute(KEEP_ATTR)).toBe('"a string"');

    el.setAttribute(KEEP_ATTR, '{"attributes":{"href":"/a","rel":"me"},"className":"c"}');
    forgetKeptAttribute(el, "target");
    expect(keptNodeOf(el)).toEqual({ attributes: { href: "/a", rel: "me" }, className: "c" });
    forgetKeptAttribute(el, "href");
    expect(keptNodeOf(el)).toEqual({ attributes: { rel: "me" }, className: "c" });
    forgetKeptAttribute(el, "rel");
    expect(keptNodeOf(el)).toEqual({ className: "c" });
    el.setAttribute(KEEP_ATTR, '{"attributes":{"href":"/a"}}');
    forgetKeptAttribute(el, "href");
    expect(el.hasAttribute(KEEP_ATTR)).toBe(false);

    // What it carries is counted by where it stands: one attribute, or every key it holds.
    expect(keptBindingKeys(el)).toEqual([]);
    el.setAttribute(
      KEEP_ATTR,
      JSON.stringify({
        attributes: { href: "/p/${state.a}/${state.b}", title: { $ref: "#/state/t" } },
        style: { color: "${state.c}" },
      }),
    );
    expect(keptBindingKeys(el, "href")).toEqual([
      "attributes/href\u0000${state.a}",
      "attributes/href\u0000${state.b}",
    ]);
    expect(keptBindingKeys(el, "rel")).toEqual([]);
    expect(keptBindingKeys(el)).toEqual([
      "attributes/href\u0000${state.a}",
      "attributes/href\u0000${state.b}",
      `attributes/title\u0000${refBindingKey("#/state/t")}`,
      "style/color\u0000${state.c}",
    ]);
  });
});

describe("a merge or a range removes only a member of a children array", () => {
  const SWITCH: JxMutableNode = {
    $switch: { $ref: "#/state/name" },
    cases: { ADA: { tagName: "p", textContent: "Case A text" } },
    tagName: "div",
  };
  const CASE = ["children", 1, "cases", "ADA"];
  const blocks = (): JxMutableNode[] => [
    { tagName: "p", textContent: "Head" },
    SWITCH,
    { tagName: "p", textContent: "Plain after" },
    { tagName: "p", textContent: "Second plain" },
  ];

  test("a $switch case is not merged away: its text would be left twice", async () => {
    const f = await setup(blocks());
    const refused = mock();
    expect(applyBlockMerge(f.tab, CASE, ["children", 0], refused)).toBeNull();
    expect(f.stored()).toEqual(blocks());
    expect(f.tab.doc.dirty).toBeFalsy();
    // Nothing would have been lost, so nothing is said: the keystroke does nothing.
    expect(refused.mock.calls).toEqual([]);
    // A case named by a number is a case all the same: it is the key before it that says so.
    const numbered: JxMutableNode[] = [
      { tagName: "p", textContent: "Head" },
      { ...SWITCH, cases: { 0: { tagName: "p", textContent: "Case 0 text" } } },
    ];
    const g = await setup(numbered);
    expect(applyBlockMerge(g.tab, ["children", 1, "cases", 0], ["children", 0])).toBeNull();
    expect(g.stored()).toEqual(numbered);
  });

  test("a block merged INTO a case is joined on, and the block after it is untouched", async () => {
    const f = await setup(blocks());
    expect(applyBlockMerge(f.tab, ["children", 2], CASE)).toEqual({ offset: 11, path: CASE });
    expect(f.stored()).toEqual([
      { tagName: "p", textContent: "Head" },
      { ...SWITCH, cases: { ADA: { tagName: "p", textContent: "Case A textPlain after" } } },
      { tagName: "p", textContent: "Second plain" },
    ]);
  });

  test("a range that would remove a case, at its end or between its ends, is not applied", async () => {
    const f = await setup(blocks());
    const head = { offset: 2, path: ["children", 0] };
    expect(applyRangeReplace(f.tab, head, { offset: 4, path: CASE }, [], "")).toBeNull();
    expect(
      applyRangeReplace(f.tab, head, { offset: 2, path: ["children", 2] }, [CASE], ""),
    ).toBeNull();
    expect(f.stored()).toEqual(blocks());
    // One that starts in the case and ends in a member after it removes only the member.
    expect(
      applyRangeReplace(
        f.tab,
        { offset: 4, path: CASE },
        { offset: 5, path: ["children", 2] },
        [],
        "",
      ),
    ).toEqual({ offset: 4, path: CASE });
    expect(f.stored()[1]).toEqual({
      ...SWITCH,
      cases: { ADA: { tagName: "p", textContent: "Case after" } },
    });
    expect(f.stored()).toHaveLength(3);
  });

  test("a path between the ends that lies inside one of them is that end's content, and stays", async () => {
    const link: JxMutableNode = {
      attributes: { href: "/docs" },
      tagName: "a",
      textContent: "docs",
    };
    const f = await setup([
      { children: ["See ", link, " now"], tagName: "p" },
      { children: [link, " tail"], tagName: "p" },
    ]);
    // The frame used to list the first block's link, and could list the last one's, as between.
    const between = [
      ["children", 0, "children", 1],
      ["children", 1, "children", 0],
    ];
    expect(
      applyRangeReplace(
        f.tab,
        { offset: 10, path: ["children", 0] },
        { offset: 6, path: ["children", 1] },
        between,
        "",
      ),
    ).toEqual({ offset: 10, path: ["children", 0] });
    expect(f.stored()).toEqual([{ children: ["See ", link, " nail"], tagName: "p" }]);
  });

  test("a last block that is all one link is removed once, and the block after it stays", async () => {
    const link: JxMutableNode = {
      attributes: { href: "/docs" },
      tagName: "a",
      textContent: "docs",
    };
    const after: JxMutableNode = { tagName: "p", textContent: "Still here" };
    const f = await setup([
      { tagName: "p", textContent: "Head" },
      { children: [link], tagName: "p" },
      after,
    ]);
    /* Listed as a block between, the link was removed first, which emptied its paragraph; the
       paragraph was pruned, and the removal of the range's end then took the block that had moved
       into its place. */
    applyRangeReplace(
      f.tab,
      { offset: 2, path: ["children", 0] },
      { offset: 4, path: ["children", 1] },
      [["children", 1, "children", 0]],
      "",
    );
    expect(f.stored()).toEqual([{ tagName: "p", textContent: "He" }, after]);
  });
});

describe("a cut never falls inside a unit, in either end, whatever stands before it", () => {
  const TAIL: JxMutableNode = { tagName: "p", textContent: "Tail" };

  /** Delete from `offset` of `head` to "T|ail"; returns why it was refused and what is stored. */
  function cutHead(head: JxMutableNode, offset: number, removed: string[]) {
    const tab = resetWorkspaceWithTab({ children: [structuredClone(head), TAIL], tagName: "div" });
    const refused = mock();
    applyRangeReplace(
      tab,
      { offset, path: ["children", 0] },
      { offset: 1, path: ["children", 1] },
      [],
      "",
      refused,
      removed,
    );
    return {
      refused: refused.mock.calls.map((call) => call[1]),
      stored: tab.doc.document.children,
    };
  }

  test("an expression after a closed inline is found where the canvas counts it", () => {
    const badge: JxMutableNode = { tagName: "x-badge", textContent: "new!" };
    const head: JxMutableNode = { children: [badge, "ab ${state.name} cd"], tagName: "p" };
    // One for the badge, three for "ab ": offset 6 is two characters into the expression.
    expect(cutHead(head, 6, ["${state.name}"])).toEqual({
      refused: ["lost"],
      stored: [head, TAIL],
    });
    // At the expression's own start the cut is clean, and the badge before it is kept.
    expect(cutHead(head, 4, ["${state.name}"])).toEqual({
      refused: [],
      stored: [{ children: [badge, "ab ail"], tagName: "p" }],
    });
  });

  test("a literal run that holds an escape is one unit between two expressions too", () => {
    const head: JxMutableNode = {
      tagName: "p",
      textContent: String.raw`${"${state.name}"} C:\\temp ${"${state.name}"}`,
    };
    // Thirteen for the first expression, then ` C:\` : offset 17 is between the two backslashes.
    expect(cutHead(head, 17, ["${state.name}"])).toEqual({
      refused: ["lost"],
      stored: [head, TAIL],
    });
    // A literal run with no escape in it is the author's text, and is cut anywhere.
    const plain: JxMutableNode = {
      tagName: "p",
      textContent: "${state.name} C:temp ${state.name}",
    };
    expect(cutHead(plain, 17, ["${state.name}"])).toEqual({
      refused: [],
      stored: [{ tagName: "p", textContent: "${state.name} C:tail" }],
    });
  });

  test("the last block's cut is checked like the first one's", () => {
    const tab = resetWorkspaceWithTab({
      children: [
        { tagName: "p", textContent: "first" },
        { tagName: "p", textContent: "x ${state.name} end" },
      ],
      tagName: "div",
    });
    const refused = mock();
    /** Delete from "fi|rst" to `offset` of the last block. */
    const cutTail = (offset: number) =>
      applyRangeReplace(
        tab,
        { offset: 2, path: ["children", 0] },
        { offset, path: ["children", 1] },
        [],
        "",
        refused,
        ["${state.name}"],
      );
    // Four characters into the expression: half of it would be left.
    expect(cutTail(6)).toBeNull();
    expect(refused.mock.calls).toEqual([[["children", 0], "lost"]]);
    expect(tab.doc.document.children).toHaveLength(2);
    // Just past it: the expression goes with the selection, whole.
    expect(cutTail(15)).toEqual({ offset: 2, path: ["children", 0] });
    expect(tab.doc.document.children).toEqual([{ tagName: "p", textContent: "fi end" }]);
  });
});

describe("a style patched in place inside a repeater reads each row's own item", () => {
  test("a row-bound declaration resolves per row, where the page's scope has no row at all", async () => {
    const state = { rows: [{ tint: "rgb(1, 2, 3)" }, { tint: "rgb(4, 5, 6)" }] };
    const scope: JxScope = await buildScope({ state, tagName: "div" }, {}, "http://localhost/");
    const doc: JxMutableNode = {
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: { style: { color: "red" }, tagName: "li", textContent: "row" },
        },
      ],
      tagName: "ul",
    };
    const prepared = prepareForEditMode(structuredClone(doc));
    const rows = newRowView();
    const container = document.createElement("div");
    container.append(
      renderNode(prepared, scope, { _path: [], onNodeCreated: makeStamper(MAPPER, rows) }),
    );
    document.body.append(container);
    const [first, second] = container.querySelectorAll("li");
    expect(first?.dataset.jxPath).toBe('["children",0,"map"]');
    expect(second?.dataset.jxEchoPath).toBe('["children",0,"map"]');
    applyIframePatch(
      structuredClone(doc),
      [
        {
          key: "style",
          op: "set-key",
          path: ["children", 0, "map"],
          value: { color: "${item.tint}" },
        },
      ],
      container,
      {
        defs: scope,
        docBase: "http://localhost/",
        hooks: {},
        mapperCtx: MAPPER,
        mode: "edit",
        rows,
      },
    );
    // The runtime writes a bound declaration as a custom property holding its resolved value.
    expect(first?.getAttribute("style")).toContain("rgb(1, 2, 3)");
    expect(second?.getAttribute("style")).toContain("rgb(4, 5, 6)");
  });
});
