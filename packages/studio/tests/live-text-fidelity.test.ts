/**
 * A commit changes what the author changed and nothing else (studio.md §4.5, §8.2.7).
 *
 * `live-text-chips.test.ts` proves a binding's VALUE never reaches the document. These are the
 * cases where every `${…}` survived and the document was still damaged: a string that changed what
 * it means by being joined to its neighbour, a `{ "$ref" }` written as its spelling, an offset
 * counted over text the document does not hold, a block redrawn under the caret. Each fixture is
 * drawn by the real runtime through the real transform and stamper, edited as the DOM, and
 * committed through the real serializer and apply.
 */
import { caretAt, resetWorkspaceWithTab, selectAcross } from "./harness";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { buildScope, renderNode } from "@jxsuite/runtime";
import { cloneValue } from "@jxsuite/schema/doc-ops";
import { isNodeObject, isString } from "@jxsuite/schema/guards";
import { chipBeside, chipKey, sideWithin, snapRangeOutOfChips } from "../src/canvas/iframe-chips";
import { patchDisturbsActiveEdit } from "../src/canvas/iframe-entry";
import { applyIframePatch, textOpRedraws } from "../src/canvas/iframe-patch";
import { blockTextLength, offsetOf } from "../src/canvas/iframe-position";
import { makeStamper, MISSING_IMAGE_SELECTOR } from "../src/canvas/iframe-render";
import {
  isAtomicInline,
  isWholeTemplate,
  normalizeContent,
  sliceContent,
  toStored,
} from "../src/editor/content-slice";
import {
  activeBlockHolds,
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
  dropsBinding,
} from "../src/editor/inline-edit-apply";
import { normalizeInlineContent, toggleInlineFormat } from "../src/editor/inline-format";
import {
  computeEmptyPlaceholderClass,
  escapeTemplateText,
  isClosedContent,
  prepareForEditMode,
  refBindingKey,
} from "../src/utils/edit-display";
import type { IframeRenderCtx } from "../src/canvas/iframe-render";
import type { JxContentResult } from "../src/editor/inline-edit";
import type { JxScope } from "@jxsuite/runtime/types";
import type { JxDocOp } from "../src/tabs/patch-ops";
import type { JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";
import type { JxPath } from "../src/state";

const MAPPER = {
  arrayPaths: new Set<string>(),
  canvasMode: "edit",
  layoutWrapped: false,
  pageContentOffset: null,
  pageContentPrefix: null,
} as const;

/** The state every fixture resolves against. No value is spelled like the source that reads it. */
const STATE = {
  empty: "",
  html: "<i>MARKUP</i>",
  list: ["red", "green"],
  name: "ADA",
  nested: [["a", "b"], ["c"]],
  rows: [],
  spans: [{ tagName: "b", textContent: "ONE" }],
  url: "/RESOLVED",
};

/** A document's `state`, as a fixture declares it. */
type StateFixture = NonNullable<JxMutableNode["state"]>;

/** The scope the runtime builds for a document holding `state` ({@link STATE} by default). */
async function scopeOf(state: StateFixture = STATE): Promise<JxScope> {
  return buildScope({ state: structuredClone(state), tagName: "div" }, {}, "http://localhost/");
}

/** `node` drawn as the page draws it: the runtime alone, no transform. */
function page(node: JxMutableNode, scope: JxScope): HTMLElement {
  const el = renderNode(structuredClone(node), scope, { _path: [] });
  if (!(el instanceof HTMLElement)) {
    throw new TypeError("expected an element");
  }
  return el;
}

/** `node` drawn as the canvas draws it, mounted so selections resolve. */
function canvas(node: JxMutableNode, scope: JxScope, path: (string | number)[] = []): HTMLElement {
  const prepared = prepareForEditMode(structuredClone(node));
  if (!isNodeObject(prepared)) {
    throw new TypeError("expected a node");
  }
  const el = renderNode(prepared, scope, { _path: path, onNodeCreated: makeStamper(MAPPER) });
  if (!(el instanceof HTMLElement)) {
    throw new TypeError("expected an element");
  }
  document.body.append(el);
  return el;
}

/**
 * `base` with keys the node type does not spell: a `{ "$ref" }` where it names a string, a `null`.
 * Documents hold them, the runtime resolves them, and so the canvas must not damage them.
 */
function nodeWith(base: JxMutableNode, extra: Record<string, JxDocumentValue>): JxMutableNode {
  return Object.assign(base, extra);
}

/** What an edit session would commit for the block `el`. */
function commitOf(el: HTMLElement): JxContentResult {
  normalizeInlineContent(el);
  return serializeContent(el);
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

/** A tab holding `block` as its first child, and `tail` (a paragraph reading "Tail") after it. */
function tabWith(block: JxMutableNode, tail?: JxMutableNode) {
  return resetWorkspaceWithTab({
    children: [
      structuredClone(block),
      structuredClone(tail ?? { tagName: "p", textContent: "Tail" }),
    ],
    state: structuredClone(STATE),
    tagName: "div",
  });
}

const FIRST = ["children", 0];

/** The block at {@link FIRST} as stored. */
function stored(tab: ReturnType<typeof tabWith>): JxMutableNode {
  const { children } = tab.doc.document;
  const first = Array.isArray(children) ? children[0] : undefined;
  if (!isNodeObject(first)) {
    throw new TypeError("the tab's first child is not a node");
  }
  // A plain copy: the document is reactive, and a reactive proxy cannot be structured-cloned.
  return cloneValue(first);
}

/**
 * Commit what the canvas holds for `el` to the block at {@link FIRST}; returns whether it was
 * refused.
 */
function commitTo(
  tab: ReturnType<typeof tabWith>,
  el: HTMLElement,
  removed: string[] = [],
): boolean {
  const refused = mock();
  const got = commitOf(el);
  applyInlineCommit(tab, FIRST, got.children ?? null, got.textContent ?? null, {
    onRefused: refused,
    removedTags: removed,
  });
  return refused.mock.calls.length > 0;
}

afterEach(() => {
  stopEditing(true);
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("a string member that is one whole template stays a member", () => {
  test("typing beside a computed list keeps it a list", async () => {
    const scope = await scopeOf();
    const block: JxMutableNode = { children: ["Intro: ", "${state.spans}"], tagName: "p" };
    const tab = tabWith(block);
    const el = canvas(block, scope);
    expect(page(block, scope).innerHTML).toBe("Intro: <b>ONE</b>");
    textIn(el).data = "Intro x: ";
    expect(commitTo(tab, el)).toBe(false);
    expect(stored(tab)).toEqual({ children: ["Intro x: ", "${state.spans}"], tagName: "p" });
    // The page still draws the list as elements, not as its string form.
    expect(page(stored(tab), scope).innerHTML).toBe("Intro x: <b>ONE</b>");
  });

  test("a lone member is not folded into textContent when text is typed after it", async () => {
    const scope = await scopeOf();
    const block: JxMutableNode = { children: ["${state.spans}"], tagName: "p" };
    const tab = tabWith(block);
    const el = canvas(block, scope);
    expect(commitOf(el)).toEqual({ children: ["${state.spans}"] });
    el.append(" typed");
    expect(commitTo(tab, el)).toBe(false);
    expect(stored(tab).children).toEqual(["${state.spans}", " typed"]);
    expect(page(stored(tab), scope).innerHTML).toBe("<b>ONE</b> typed");
  });

  test("a templated textContent still comes back as one textContent", async () => {
    const scope = await scopeOf();
    const el = canvas({ tagName: "p", textContent: "${state.name}" }, scope);
    expect(commitOf(el)).toEqual({ textContent: "${state.name}" });
    el.append("!");
    expect(commitOf(el)).toEqual({ textContent: "${state.name}!" });
  });

  test("the element one templated member is drawn as is one member, until markup splits it", async () => {
    const scope = await scopeOf();
    const block: JxMutableNode = {
      children: ["Hello ${state.name} and bye", { tagName: "br" }],
      tagName: "p",
    };
    const el = canvas(block, scope);
    expect(commitOf(el).children?.[0]).toBe("Hello ${state.name} and bye");
    // Text typed outside the run is a member of its own, not joined into the template.
    el.prepend(String.raw`C:\new `);
    expect(commitOf(el).children?.slice(0, 2)).toEqual([
      String.raw`C:\new `,
      "Hello ${state.name} and bye",
    ]);
    // With every chip deleted from it, what is left of the run is plain text again.
    const lone = canvas({ children: ["a ${state.name}", { tagName: "br" }], tagName: "p" }, scope);
    lone.querySelector("[data-jx-tag]")?.remove();
    expect(commitOf(lone).children?.[0]).toBe("a ");
  });

  test("markup put inside that element splits the member, and everything in it is kept", async () => {
    const scope = await scopeOf();
    const el = canvas(
      { children: ["Hello ${state.name} and bye", { tagName: "br" }], tagName: "p" },
      scope,
    );
    const run = el.querySelector("[data-jx-text]");
    if (!run) {
      throw new TypeError("no text run");
    }
    // Bold over "Hel": the run now holds an element, so it is no one string any more.
    const text = textIn(run);
    const rest = text.splitText(3);
    const strong = document.createElement("strong");
    strong.append(text);
    rest.before(strong);
    expect(commitOf(el).children?.slice(0, 2)).toEqual([
      { tagName: "strong", textContent: "Hel" },
      "lo ${state.name} and bye",
    ]);
    expect(commitOf(el).children).toHaveLength(3);
  });

  test("a run left with no chip is text like the text beside it, joined and folded", async () => {
    const scope = await scopeOf();
    const el = canvas({ children: ["a ${state.name}", { tagName: "br" }], tagName: "p" }, scope);
    el.querySelector("[data-jx-tag]")?.remove();
    el.querySelector("br")?.remove();
    el.prepend("Intro ");
    // A member would have stood apart as `["Intro ", "a "]`: it is plain text, so one string.
    expect(commitOf(el)).toEqual({ textContent: "Intro a " });
  });

  test("text typed beside a chip inside <code> with markup is escaped as it is flattened", async () => {
    const scope = await scopeOf();
    const el = canvas(
      { children: [{ tagName: "code", textContent: "v${state.name}" }], tagName: "p" },
      scope,
    );
    const code = el.querySelector("code");
    if (!code) {
      throw new TypeError("no <code>");
    }
    const typed = document.createElement("u");
    typed.textContent = String.raw`a\b`;
    code.prepend(typed);
    // Flattened to one template: the typed backslash is escaped so it still reads as typed.
    expect(commitOf(el)).toEqual({
      children: [{ tagName: "code", textContent: String.raw`a\\bv${"${state.name}"}` }],
    });
    // With the chip gone it is no template, and the text is stored as it is seen.
    code.querySelector("[data-jx-tag]")?.remove();
    expect(commitOf(el)).toEqual({
      children: [{ tagName: "code", textContent: String.raw`a\bv` }],
    });
  });
});

describe("a plain string is not joined into a template", () => {
  const BLOCK: JxMutableNode = {
    children: [String.raw`C:\temp\new `, "${state.name}", { tagName: "br" }],
    tagName: "p",
  };

  test("a caret that only visits writes nothing, <br> included", async () => {
    const scope = await scopeOf();
    const tab = tabWith(BLOCK);
    const el = canvas(BLOCK, scope);
    expect(el.textContent).toBe(String.raw`C:\temp\new ADA`);
    expect(commitTo(tab, el)).toBe(false);
    expect(stored(tab)).toEqual(BLOCK);
    expect(tab.doc.dirty).toBeFalsy();
  });

  test("an edit keeps the backslashes literal", async () => {
    const scope = await scopeOf();
    const tab = tabWith(BLOCK);
    const el = canvas(BLOCK, scope);
    el.append("!");
    expect(commitTo(tab, el)).toBe(false);
    expect(page(stored(tab), scope).textContent).toBe(String.raw`C:\temp\new ADA!`);
  });
});

describe("text typed into a template reads back as typed", () => {
  test.each([
    ["a backtick", "Hello `"],
    ["backslashes", String.raw`C:\temp\new `],
    ["a unicode escape's start", String.raw`\u`],
  ])("%s", async (_name, typed) => {
    const scope = await scopeOf();
    const block: JxMutableNode = { tagName: "p", textContent: "Hello ${state.name}" };
    const tab = tabWith(block);
    const el = canvas(block, scope);
    textIn(el).data = typed;
    expect(commitTo(tab, el)).toBe(false);
    const after = stored(tab);
    expect(page(after, scope).textContent).toBe(`${typed}ADA`);
    // And the canvas, drawn again from the document, shows the same thing.
    expect(canvas(after, scope).textContent).toBe(`${typed}ADA`);
  });

  test("a ${…} typed by hand is still a binding, an open one a binding still being typed", () => {
    expect(escapeTemplateText("a\\b ${state.x} `c`")).toBe("a\\\\b ${state.x} \\`c\\`");
    // From an open `${` on, nothing is escaped: the author has not finished typing it.
    expect(escapeTemplateText("a\\b ${state.x.replace(/\\s/")).toBe(
      "a\\\\b ${state.x.replace(/\\s/",
    );
  });

  test("a binding typed as text is drawn again as a chip: its commit is not in place", async () => {
    const scope = await scopeOf();
    const el = canvas({ tagName: "p", textContent: "plain" }, scope, ["children", 0]);
    const commits: [string | null, boolean][] = [];
    startEditing(el, ["children", 0], {
      onCommit: (_path, _children, text, inPlace) => commits.push([text, inPlace]),
      onEnd: () => {},
      onInsert: () => {},
      onSplit: () => {},
    });
    textIn(el).data = "Hi ${state.";
    commitActiveBlock();
    textIn(el).data = "Hi ${state.name}";
    commitActiveBlock();
    expect(commits).toEqual([
      ["Hi ${state.", true],
      ["Hi ${state.name}", false],
    ]);
  });

  test("the author's own ${ makes a plain block a template too, so its text is escaped", async () => {
    const scope = await scopeOf();
    const el = canvas({ tagName: "p", textContent: "plain" }, scope);
    textIn(el).data = "C:\\temp ${state.name}";
    const got = commitOf(el);
    expect(got).toEqual({ textContent: "C:\\\\temp ${state.name}" });
    expect(page({ tagName: "p", ...got }, scope).textContent).toBe(String.raw`C:\temp ADA`);
  });

  test("a `$` typed before a run that starts with `{` does not open an expression", async () => {
    const scope = await scopeOf();
    const el = canvas({ tagName: "p", textContent: "{a\\\\b} ${state.name}" }, scope);
    el.prepend("$");
    const got = commitOf(el);
    expect(page({ tagName: "p", ...got }, scope).textContent).toBe("${a\\b} ADA");
  });

  test("a commit that stored text differently from how it is shown is not in place", async () => {
    const scope = await scopeOf();
    const el = canvas({ tagName: "p", textContent: "Hi ${state.name}" }, scope, ["children", 0]);
    const commits: boolean[] = [];
    startEditing(el, ["children", 0], {
      onCommit: (_path, _children, _text, inPlace) => commits.push(inPlace),
      onEnd: () => {},
      onInsert: () => {},
      onSplit: () => {},
    });
    commitActiveBlock();
    textIn(el).data = String.raw`Hi \ `;
    commitActiveBlock();
    // The first is an idle tick like any other; the second asks to be drawn again.
    expect(commits).toEqual([true, false]);
  });
});

describe("guard 3 counts a binding where it stands", () => {
  test("a typed copy does not stand in for a lost attribute binding", async () => {
    const scope = await scopeOf();
    const block: JxMutableNode = {
      children: [
        "See ",
        { attributes: { href: "${state.url}" }, tagName: "a", textContent: "here" },
      ],
      tagName: "p",
    };
    const tab = tabWith(block);
    const el = canvas(block, scope);
    el.append(" (${state.url})");
    expect(commitTo(tab, el)).toBe(true);
    expect(stored(tab)).toEqual(block);
  });

  const BOUND_INLINES: [string, JxMutableNode][] = [
    [
      "a $ref href",
      { attributes: { href: { $ref: "#/state/url" } }, tagName: "a", textContent: "x" },
    ],
    ["a $ref innerHTML", nodeWith({ tagName: "span" }, { innerHTML: { $ref: "#/state/html" } })],
    ["a template innerHTML", { innerHTML: "${state.html}", tagName: "span" }],
    ["computed children", { children: "${state.spans}", tagName: "span" }],
    [
      "a $ref text beside children",
      {
        children: [{ tagName: "b", textContent: "!" }],
        tagName: "span",
        textContent: { $ref: "#/state/name" },
      },
    ],
  ];
  test.each(BOUND_INLINES)("an inline child holding %s is not rewritten", async (_n, child) => {
    const scope = await scopeOf();
    const block: JxMutableNode = { children: ["See ", child, " tail"], tagName: "p" };
    const tab = tabWith(block);
    const el = canvas(block, scope);
    textIn(el).data = "See x ";
    expect(commitTo(tab, el)).toBe(true);
    expect(stored(tab)).toEqual(block);
  });

  test("a block's own $ref text, innerHTML and innerText are bindings a commit cannot carry", () => {
    const lost = [{ textContent: "ADA" }];
    expect(dropsBinding({ tagName: "p", textContent: { $ref: "#/state/name" } }, lost)).toBe(true);
    expect(dropsBinding({ innerHTML: "${state.html}", tagName: "p" }, lost)).toBe(true);
    expect(dropsBinding({ innerText: { $ref: "#/state/name" }, tagName: "p" }, lost)).toBe(true);
    const computed = nodeWith({ tagName: "p" }, { children: { $ref: "#/state/spans" } });
    expect(dropsBinding(computed, lost)).toBe(true);
    // A style or an attribute on the block itself is not content: a commit does not write it.
    expect(
      dropsBinding(
        { attributes: { title: "${state.name}" }, tagName: "p", textContent: "x" },
        lost,
      ),
    ).toBe(false);
  });

  test("a deleted chip excuses its binding once, as text or as a member", () => {
    const node: JxMutableNode = {
      children: ["a ", "${x}", { tagName: "br" }, "${x}"],
      tagName: "p",
    };
    expect(dropsBinding(node, [{ children: ["a ", "${x}"] }])).toBe(true);
    expect(dropsBinding(node, [{ children: ["a ", "${x}"] }], ["${x}"])).toBe(false);
    expect(dropsBinding(node, [{ children: ["a "] }], ["${x}"])).toBe(true);
    // A reference is excused by its own key, which no template spells.
    const ref: JxMutableNode = {
      children: [{ tagName: "b", textContent: { $ref: "#/state/name" } }],
      tagName: "p",
    };
    expect(dropsBinding(ref, [{ textContent: "" }])).toBe(true);
    expect(dropsBinding(ref, [{ textContent: "" }], [refBindingKey("#/state/name")])).toBe(false);
  });
});

describe("a { $ref } text in an inline child goes back as the reference it was", () => {
  test.each(["#/state/name", "window#/location/href", "$defs/x", "$map/item/title"])(
    "%s",
    async (pointer) => {
      const scope = await scopeOf();
      const block: JxMutableNode = {
        children: ["Hello ", { tagName: "strong", textContent: { $ref: pointer } }, " tail"],
        tagName: "p",
      };
      const tab = tabWith(block);
      const el = canvas(block, scope);
      textIn(el).data = "Hello x ";
      expect(commitTo(tab, el)).toBe(false);
      expect(stored(tab).children).toEqual([
        "Hello x ",
        { tagName: "strong", textContent: { $ref: pointer } },
        " tail",
      ]);
    },
  );

  test("its chip draws what the page draws for the reference", async () => {
    const scope = await scopeOf({ ...STATE, missing: null });
    for (const pointer of ["#/state/list", "#/state/missing", "#/state/name"]) {
      const node: JxMutableNode = { tagName: "h2", textContent: { $ref: pointer } };
      expect(canvas(node, scope).textContent).toBe(page(node, scope).textContent);
    }
  });

  test("the chip is counted by its reference, and Backspace beside its element is the engine's", async () => {
    const scope = await scopeOf();
    const el = canvas(
      {
        children: ["Hi ", { tagName: "strong", textContent: { $ref: "#/state/name" } }, " tail"],
        tagName: "p",
      },
      scope,
    );
    const chip = el.querySelector("[data-jx-tag]");
    expect(chip && chipKey(chip)).toBe(refBindingKey("#/state/name"));
    // The chip is inside an element closed to the caret: it is not beside a caret outside it.
    const tail = el.lastChild;
    expect(tail && chipBeside(el, tail, 0, -1)).toBeNull();
  });
});

describe("an element closed to the caret is one unit, one position long, on the canvas and in storage", () => {
  const CLOSED: JxMutableNode = { tagName: "strong", textContent: { $ref: "#/state/name" } };

  test("a cross-block delete takes one only when the selection reaches past it", async () => {
    const scope = await scopeOf();
    const head: JxMutableNode = { tagName: "p", textContent: "first" };
    const tail: JxMutableNode = { children: [CLOSED, " important text"], tagName: "p" };
    const el = canvas(tail, scope, ["children", 1]);
    // Before the <strong> and after it are two offsets, and neither counts what the element shows.
    expect(offsetOf(el, el, 0)).toBe(0);
    expect(offsetOf(el, el, 1)).toBe(1);
    expect(blockTextLength(el)).toBe(1 + " important text".length);
    /** Delete from "fi|rst" to `offset` of the tail; returns the caret and whether it was refused. */
    const cut = (offset: number, removed?: string[]) => {
      const tab = tabWith(head, tail);
      const refused = mock();
      const caret = applyRangeReplace(
        tab,
        { offset: 2, path: FIRST },
        { offset, path: ["children", 1] },
        [],
        "",
        refused,
        removed,
      );
      return { caret, refused: refused.mock.calls.length, stored: stored(tab) };
    };
    // Ending before it: it is kept, with everything after it.
    expect(cut(0)).toEqual({
      caret: { offset: 2, path: FIRST },
      refused: 0,
      stored: { children: ["fi", CLOSED, " important text"], tagName: "p" },
    });
    // Ending after it, and said to: it goes with the selection, and no more does.
    expect(cut(1, [refBindingKey("#/state/name")])).toEqual({
      caret: { offset: 2, path: FIRST },
      refused: 0,
      stored: { tagName: "p", textContent: "fi important text" },
    });
    // Ending after it with nothing said is a binding lost that nobody deleted.
    expect(cut(1)).toEqual({ caret: null, refused: 1, stored: head });
    // And four characters further on takes exactly those four.
    expect(cut(5, [refBindingKey("#/state/name")]).stored).toEqual({
      tagName: "p",
      textContent: "fiortant text",
    });
  });

  test("what is atomic in storage is what the canvas closes", () => {
    const nodes: JxMutableNode[] = [
      CLOSED,
      { children: "${state.spans}", tagName: "span" },
      { innerHTML: "${state.html}", tagName: "span" },
      { innerText: "${state.name}", tagName: "span" },
      { children: [{ tagName: "b" }], tagName: "span", textContent: "${state.name}" },
    ];
    for (const node of nodes) {
      expect(isClosedContent(node)).toBe(true);
      expect(isAtomicInline(node)).toBe(true);
      const drawn = prepareForEditMode(structuredClone(node));
      expect(drawn.attributes?.contenteditable).toBe("false");
    }
    expect(isAtomicInline({ tagName: "x-badge", textContent: "new" })).toBe(true);
    const openNodes: JxMutableNode[] = [
      { tagName: "em", textContent: "plain" },
      { tagName: "em", textContent: "${state.name}" },
      { children: ["a ", "${state.name}"], tagName: "em" },
      { children: [], tagName: "em", textContent: "${state.name}" },
    ];
    for (const open of openNodes) {
      expect(isClosedContent(open)).toBe(false);
      expect(isAtomicInline(open)).toBe(false);
    }
  });

  test("a slice keeps a whole inline as it is stored, and never cuts an atomic one", () => {
    const content = ["ab", { tagName: "em", textContent: "${x}" }, CLOSED, "cd"];
    expect(sliceContent(content, 0, 6)).toEqual(["ab", { tagName: "em", textContent: "${x}" }]);
    expect(sliceContent(content, 6, 9)).toEqual([CLOSED, "cd"]);
    expect(sliceContent(content, 7, 9)).toEqual(["cd"]);
  });
});

describe("stored content is joined only where that changes nothing it means", () => {
  test("isWholeTemplate", () => {
    expect(isWholeTemplate("${a}")).toBe(true);
    expect(isWholeTemplate("${a} ")).toBe(false);
    expect(isWholeTemplate("${a}${b}")).toBe(false);
    expect(isWholeTemplate("plain")).toBe(false);
  });

  test("normalizeContent joins plain text, escapes it into a template, and leaves a member alone", () => {
    expect(normalizeContent(["a", "", "b"])).toEqual(["ab"]);
    expect(normalizeContent([String.raw`C:\x `, "Hi ${n}"])).toEqual(["C:\\\\x Hi ${n}"]);
    expect(normalizeContent(["Hi ${n}", " `t`"])).toEqual(["Hi ${n} \\`t\\`"]);
    expect(normalizeContent(["a ${x}", "b ${y}"])).toEqual(["a ${x}b ${y}"]);
    expect(normalizeContent(["Intro ", "${list}", " end"])).toEqual(["Intro ", "${list}", " end"]);
    // A `$` meeting a `{`, or an open quote swallowing the next expression: left as two strings.
    expect(normalizeContent(["a$", "{b}"])).toEqual(["a$", "{b}"]);
    expect(normalizeContent(["${'", "${b}'}"])).toEqual(["${'", "${b}'}"]);
  });

  test("toStored folds one string into textContent unless it is a whole-template member", () => {
    expect(toStored([])).toEqual({ textContent: "" });
    expect(toStored(["a", "b"])).toEqual({ textContent: "ab" });
    expect(toStored(["Hi ${n}"])).toEqual({ textContent: "Hi ${n}" });
    expect(toStored(["${list}"])).toEqual({ children: ["${list}"] });
  });

  test("a merge that joins nothing leaves the surviving block as it is spelled", () => {
    const tab = tabWith({ tagName: "h3", textContent: "${state.name}" }, { tagName: "p" });
    expect(applyBlockMerge(tab, ["children", 1], FIRST)).toEqual({ offset: 13, path: FIRST });
    expect(tab.doc.document.children).toEqual([{ tagName: "h3", textContent: "${state.name}" }]);
  });

  test("a range that keeps the first block whole does not re-spell it either", () => {
    const tab = tabWith({ tagName: "h3", textContent: "${state.name}" });
    const caret = applyRangeReplace(
      tab,
      { offset: 13, path: FIRST },
      { offset: 4, path: ["children", 1] },
      [],
      "",
    );
    expect(caret).toEqual({ offset: 13, path: FIRST });
    expect(tab.doc.document.children).toEqual([{ tagName: "h3", textContent: "${state.name}" }]);
  });

  test("a cut may not fall inside an escaped run; one beside it leaves the text the run showed", () => {
    const block: JxMutableNode = {
      tagName: "p",
      textContent: String.raw`C:\\temp ${"${state.name}"} end`,
    };
    // Between the two backslashes that spell one: half an escape on each side.
    const inside = tabWith(block);
    const refused = mock();
    expect(
      applyRangeReplace(
        inside,
        { offset: 3, path: FIRST },
        { offset: 2, path: ["children", 1] },
        [],
        "",
        refused,
        ["${state.name}"],
      ),
    ).toBeNull();
    expect(stored(inside)).toEqual(block);
    expect(refused.mock.calls).toEqual([[FIRST, "lost"]]);
    // After the run: what is kept is no template any more, so it is stored as the text it showed.
    const beside = tabWith(block);
    expect(
      applyRangeReplace(
        beside,
        { offset: 9, path: FIRST },
        { offset: 2, path: ["children", 1] },
        [],
        "",
        refused,
        ["${state.name}"],
      ),
    ).toEqual({ offset: 9, path: FIRST });
    expect(stored(beside)).toEqual({ tagName: "p", textContent: String.raw`C:\temp il` });
    expect(refused).toHaveBeenCalledTimes(1);
  });
});

describe("content the canvas cannot draw as chips is drawn as the page draws it", () => {
  test("an array inside text, or as a textContent, is printed with its separators", async () => {
    const scope = await scopeOf();
    const nodes: JxMutableNode[] = [
      { tagName: "p", textContent: "Tags: ${state.list}." },
      { children: ["Tags: ${state.list}.", { tagName: "br" }], tagName: "p" },
      { tagName: "p", textContent: "${state.list}" },
      { tagName: "p", textContent: "${state.spans}" },
      { tagName: "p", textContent: "${state.nested}" },
      { children: ["${state.spans}"], tagName: "p" },
    ];
    for (const node of nodes) {
      expect(canvas(node, scope).textContent).toBe(page(node, scope).textContent);
    }
    expect(canvas(nodes[0]!, scope).textContent).toBe("Tags: red,green.");
  });

  test.each(["style", "script", "title", "textarea"])(
    "<%s> keeps its text as text",
    async (tag) => {
      const scope = await scopeOf();
      const node: JxMutableNode = { tagName: tag, textContent: "a{b:${state.name}}" };
      const el = canvas(node, scope);
      expect(el.querySelector("data")).toBeNull();
      expect(el.childNodes).toHaveLength(1);
      expect(el.textContent).toBe("a{b:ADA}");
      const ref = canvas({ tagName: tag, textContent: { $ref: "#/state/name" } }, scope);
      expect(ref.querySelector("data")).toBeNull();
      expect(ref.textContent).toBe("ADA");
    },
  );

  test("bound text inside SVG is the element's own text, closed to the caret", async () => {
    const scope = await scopeOf();
    const host = canvas(
      {
        children: [
          {
            children: [
              { tagName: "text", textContent: "n=${state.name}" },
              {
                children: ["m=${state.name}", { tagName: "tspan", textContent: "!" }],
                tagName: "text",
              },
              {
                children: [{ tagName: "p", textContent: "html ${state.name}" }],
                tagName: "foreignObject",
              },
            ],
            tagName: "svg",
          },
        ],
        tagName: "div",
      },
      scope,
    );
    const [first, second, foreign] = host.firstElementChild?.children ?? [];
    expect(first?.querySelector("data")).toBeNull();
    expect(first?.textContent).toBe("n=ADA");
    expect(first?.getAttribute("contenteditable")).toBe("false");
    expect(second?.querySelector("data")).toBeNull();
    expect(second?.textContent).toBe("m=ADA!");
    // Its text is a templated string child, drawn as the page draws it: closed like the first.
    expect(second?.getAttribute("contenteditable")).toBe("false");
    expect(second?.querySelector("tspan")?.getAttribute("contenteditable")).toBeNull();
    // HTML again inside <foreignObject>: chips are drawn there.
    expect(foreign?.querySelector("data[data-jx-tag]")).not.toBeNull();
  });

  test("bound innerText is drawn live and closed, and its commit is refused", async () => {
    const scope = await scopeOf();
    for (const innerText of ["${state.name}", { $ref: "#/state/name" }]) {
      const block: JxMutableNode = { innerText, tagName: "p" };
      const el = canvas(block, scope);
      expect(el.textContent).toBe("ADA");
      expect(isEditableBlock(el)).toBe(false);
      expect(el.classList.contains("empty-text-placeholder")).toBe(false);
      const tab = tabWith(block);
      expect(commitTo(tab, el)).toBe(true);
      expect(stored(tab)).toEqual(block);
    }
  });

  test("templated text draws whichever side of an empty `children` it is written on", async () => {
    const scope = await scopeOf();
    const nodes: JxMutableNode[] = [
      { tagName: "p", textContent: "Hi ${state.name}", children: [] },
      { children: [], tagName: "p", textContent: "Hi ${state.name}" },
      nodeWith({ tagName: "p", textContent: "Hi ${state.name}" }, { children: null }),
      { tagName: "p", textContent: { $ref: "#/state/name" }, children: [] },
    ];
    for (const node of nodes) {
      const el = canvas(node, scope);
      expect(el.textContent).toBe(page(node, scope).textContent);
      expect(el.classList.contains("empty-text-placeholder")).toBe(false);
    }
  });

  test("a $switch is not an empty container", () => {
    const node: JxMutableNode = {
      $switch: { $ref: "#/state/name" },
      cases: { ADA: { tagName: "p", textContent: "live" } },
      tagName: "div",
    };
    expect(computeEmptyPlaceholderClass(node)).toBeNull();
    expect(prepareForEditMode(structuredClone(node)).className).toBeUndefined();
    expect(computeEmptyPlaceholderClass({ tagName: "div" })).toBe("empty-container-placeholder");
  });
});

describe("a binding that reads a row is not evaluated without one", () => {
  const LIST = (rows: Record<string, string | boolean>[]): JxMutableNode => ({
    children: [
      {
        $prototype: "Array",
        items: { $ref: "#/state/rows" },
        map: {
          attributes: { "data-href": "/p/${item?.slug}", hidden: "${!item?.published}" },
          children: [
            { src: "${item.img}", tagName: "img" },
            { attributes: { src: "${item.img}" }, tagName: "img" },
          ],
          tagName: "article",
        },
      },
      { attributes: { hidden: "${!item?.published}" }, tagName: "p", textContent: "outside" },
    ],
    state: { rows },
    tagName: "div",
  });

  test("an empty list's template row is not hidden, and its links are not /p/undefined", async () => {
    const doc = LIST([]);
    const el = canvas(doc, await scopeOf({ rows: [] }));
    const article = el.querySelector("article");
    expect(article?.hasAttribute("hidden")).toBe(false);
    expect(article?.dataset.href).toBeUndefined();
    expect(el.querySelector("p")?.hasAttribute("hidden")).toBe(false);
    // Its images name no source at all, which the edit stylesheet draws as the placeholder.
    for (const img of el.querySelectorAll("img")) {
      expect(img.hasAttribute("src")).toBe(false);
    }
    expect(MISSING_IMAGE_SELECTOR.split(",").some((part) => el.querySelector(part))).toBe(true);
  });

  test("with a row, the row decides", async () => {
    const hiddenRow = canvas(
      LIST([{ published: false, slug: "a" }]),
      await scopeOf({ rows: [{ published: false, slug: "a" }] }),
    );
    expect(hiddenRow.querySelector("article")?.hasAttribute("hidden")).toBe(true);
    expect(hiddenRow.querySelector("article")?.dataset.href).toBe("/p/a");
    const shown = canvas(
      LIST([{ img: "/a.png", published: true }]),
      await scopeOf({ rows: [{ img: "/a.png", published: true }] }),
    );
    expect(shown.querySelector("article")?.hasAttribute("hidden")).toBe(false);
    expect(shown.querySelectorAll("img")[1]?.getAttribute("src")).toBe("/a.png");
  });
});

describe("Enter over a selection that touches a chip", () => {
  /** Start a session on `Hello <chip> and bye` and return what a split reports. */
  async function splitWith(select: (el: HTMLElement, chip: Element) => void) {
    const scope = await scopeOf();
    const block: JxMutableNode = { tagName: "p", textContent: "Hello ${state.name} and bye" };
    const tab = tabWith(block);
    const el = canvas(block, scope, FIRST);
    const split =
      mock<
        (path: JxPath, before: JxContentResult, after: JxContentResult, removed: string[]) => void
      >();
    startEditing(el, FIRST, {
      onCommit: () => {},
      onEnd: () => {},
      onInsert: () => {},
      onSplit: split,
    });
    const chip = el.querySelector("[data-jx-tag]");
    if (!chip) {
      throw new TypeError("no chip");
    }
    select(el, chip);
    expect(splitActiveBlock()).toBe(true);
    const [, before, after, removed] = split.mock.calls[0]!;
    const refused = mock();
    applyInlineSplit(tab, FIRST, before, after, refused, removed);
    return { after, before, refused, removed, tab };
  }

  test("a selection covering the chip drops it, as typing over it would", async () => {
    const { before, after, removed, refused, tab } = await splitWith((el) => {
      const first = el.firstChild!;
      const last = el.lastChild!;
      selectAcross(first, 2, last, 4);
    });
    expect(before).toEqual({ textContent: "He" });
    expect(after).toEqual({ textContent: " bye" });
    expect(removed).toEqual(["${state.name}"]);
    expect(refused).not.toHaveBeenCalled();
    expect(tab.doc.document.children).toHaveLength(3);
  });

  test("a caret inside the chip's text splits beside the chip, never through it", async () => {
    const { before, after, removed } = await splitWith((_el, chip) => {
      caretAt(textIn(chip), 1);
    });
    expect(removed).toEqual([]);
    const all = `${before.textContent ?? ""}|${after.textContent ?? ""}`;
    expect(all).toBe("Hello |${state.name} and bye");
  });
});

describe("a selection never rests inside a chip", () => {
  test("sideWithin: the half of the chip's text the position is in", async () => {
    const scope = await scopeOf();
    const el = canvas({ tagName: "h3", textContent: "${state.name}" }, scope);
    const chip = el.querySelector("[data-jx-tag]")!;
    const text = textIn(chip);
    expect(sideWithin(chip, text, 0)).toBe(-1);
    expect(sideWithin(chip, text, 3)).toBe(1);
    expect(sideWithin(chip, el, 0)).toBe(1);
  });

  test("snapRangeOutOfChips: a caret goes to the nearer edge, a range covers the chip whole", async () => {
    const scope = await scopeOf();
    const el = canvas({ tagName: "p", textContent: "a ${state.name} b" }, scope);
    const chip = el.querySelector("[data-jx-tag]")!;
    const text = textIn(chip);
    const caret = document.createRange();
    caret.setStart(text, 3);
    caret.collapse(true);
    expect(snapRangeOutOfChips(el, caret)).toBe(true);
    expect(offsetOf(el, caret.startContainer, caret.startOffset)).toBe(2 + "${state.name}".length);
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 3);
    expect(snapRangeOutOfChips(el, range)).toBe(true);
    expect(offsetOf(el, range.startContainer, range.startOffset)).toBe(2);
    expect(offsetOf(el, range.endContainer, range.endOffset)).toBe(2 + "${state.name}".length);
    const outside = document.createRange();
    outside.setStart(el.firstChild!, 1);
    expect(snapRangeOutOfChips(el, outside)).toBe(false);
  });
});

describe("formatting does not reach into a chip", () => {
  test("bold over a computed list leaves the list's own <strong> alone", async () => {
    const scope = await scopeOf({ ...STATE, spans: [{ tagName: "strong", textContent: "ONE" }] });
    const el = canvas({ children: ["Hello ", "${state.spans}", " and bye"], tagName: "p" }, scope);
    selectAcross(el.firstChild!, 2, el.lastChild!, 4);
    toggleInlineFormat("strong", el);
    const chip = el.querySelector("[data-jx-tag]");
    expect(chip?.innerHTML).toBe("<strong>ONE</strong>");
    // And the selection was wrapped, the chip inside it still a member.
    expect(commitOf(el)).toEqual({
      children: ["He", { children: ["llo ", "${state.spans}", " and"], tagName: "strong" }, " bye"],
    });
  });
});

describe("a patch that redraws the caret's block", () => {
  const CTX = async (): Promise<IframeRenderCtx> => ({
    defs: await scopeOf(),
    docBase: "http://localhost/",
    mapperCtx: { ...MAPPER },
    mode: "edit",
  });

  /** A container holding `doc` as the frame's full render stamps it. */
  async function frame(doc: JxMutableNode) {
    const ctx = await CTX();
    const container = document.createElement("div");
    const prepared = prepareForEditMode(structuredClone(doc));
    container.append(
      renderNode(prepared, ctx.defs, { _path: [], onNodeCreated: makeStamper(ctx.mapperCtx) }),
    );
    document.body.append(container);
    return { container, ctx, shadow: structuredClone(doc) };
  }

  const BOUND = "${state.name}";
  const DOC: JxMutableNode = {
    children: [
      { tagName: "h3", textContent: BOUND },
      { tagName: "p", textContent: "literal" },
    ],
    tagName: "div",
  };

  test("a text op on a bound node replaces its element, and the frame is told so beforehand", async () => {
    const { container } = await frame(DOC);
    const toBound: JxDocOp = {
      key: "textContent",
      op: "set-key",
      path: ["children", 1],
      value: BOUND,
    };
    const onBound: JxDocOp = {
      key: "textContent",
      op: "set-key",
      path: ["children", 0],
      value: "x",
    };
    const literal: JxDocOp = {
      key: "textContent",
      op: "set-key",
      path: ["children", 1],
      value: "y",
    };
    const ref: JxDocOp = {
      key: "textContent",
      op: "set-key",
      path: ["children", 1],
      value: { $ref: "#/state/name" },
    };
    expect(textOpRedraws(toBound, container)).toBe(true);
    expect(textOpRedraws(onBound, container)).toBe(true);
    expect(textOpRedraws(ref, container)).toBe(true);
    expect(textOpRedraws(literal, container)).toBe(false);
    expect(
      textOpRedraws({ key: "style", op: "set-key", path: ["children", 0], value: {} }, container),
    ).toBe(false);
  });

  test("such an op disturbs a session on that block; an in-place one does not", async () => {
    const { container } = await frame(DOC);
    const h3 = container.querySelector("h3")!;
    startEditing(h3, ["children", 0], {
      onCommit: () => {},
      onEnd: () => {},
      onInsert: () => {},
      onSplit: () => {},
    });
    const undo: JxDocOp = {
      key: "textContent",
      op: "set-key",
      path: ["children", 0],
      value: BOUND,
    };
    expect(patchDisturbsActiveEdit([undo])).toBe(false);
    expect(patchDisturbsActiveEdit([undo], (op) => textOpRedraws(op, container))).toBe(true);
    const style: JxDocOp = { key: "style", op: "set-key", path: ["children", 0], value: {} };
    expect(patchDisturbsActiveEdit([style], (op) => textOpRedraws(op, container))).toBe(false);
  });

  test("a block that was replaced under its session is never committed", async () => {
    const { container, ctx, shadow } = await frame(DOC);
    const old = container.querySelector("h3")!;
    const commit = mock();
    startEditing(old, ["children", 0], {
      onCommit: commit,
      onEnd: () => {},
      onInsert: () => {},
      onSplit: () => {},
    });
    old.append("Q");
    commitActiveBlock();
    expect(commit.mock.calls.at(-1)?.[2]).toBe(`${BOUND}Q`);
    commit.mockClear();
    // The undo: the document's text goes back to the bare template, and the element is replaced.
    applyIframePatch(
      shadow,
      [{ key: "textContent", op: "set-key", path: ["children", 0], value: BOUND }],
      container,
      ctx,
    );
    expect(old.isConnected).toBe(false);
    commitActiveBlock();
    stopEditing();
    // Nothing of the detached element's `…Q` is written back.
    expect(commit).not.toHaveBeenCalled();
  });

  test("activeBlockHolds: whether the caret's block shows what the document holds", async () => {
    const { container } = await frame(DOC);
    const h3 = container.querySelector("h3")!;
    const literal = container.querySelector("p")!;
    const callbacks = {
      onCommit: () => {},
      onEnd: () => {},
      onInsert: () => {},
      onSplit: () => {},
    };
    const heading: JxMutableNode = { tagName: "h3", textContent: BOUND };
    // With no session there is no block to ask about.
    expect(activeBlockHolds(heading)).toBe(false);
    startEditing(h3, ["children", 0], callbacks);
    expect(activeBlockHolds(heading)).toBe(true);
    expect(activeBlockHolds(null)).toBe(false);
    h3.append("Q");
    expect(activeBlockHolds(heading)).toBe(false);
    stopEditing(true);
    // A plain session holds a prop's value, not a block's content: never "what the block holds",
    // So a patch that disturbs it commits it rather than dropping what was typed.
    startEditing(literal, ["children", 1], callbacks, { plainText: true });
    expect(activeBlockHolds({ tagName: "p", textContent: "literal" })).toBe(false);
  });

  test("a structural op under a parent whose own text is bound is not applied in place", async () => {
    const doc: JxMutableNode = {
      children: [
        {
          children: [
            { tagName: "p", textContent: "A" },
            { tagName: "p", textContent: "B" },
          ],
          tagName: "section",
          textContent: "${state.empty}",
        },
        { children: [], tagName: "section", textContent: "Hi ${state.name} there" },
        {
          children: [{ tagName: "p", textContent: "A" }],
          tagName: "section",
          textContent: { $ref: "#/state/empty" },
        },
        { children: [{ tagName: "p", textContent: "L" }], tagName: "section" },
      ],
      tagName: "div",
    };
    const ops: JxDocOp[] = [
      {
        index: 1,
        node: { tagName: "p", textContent: "NEW" },
        op: "insert-child",
        parentPath: ["children", 0],
      },
      {
        fromIndex: 1,
        fromParentPath: ["children", 0],
        op: "move-child",
        toIndex: 0,
        toParentPath: ["children", 0],
      },
      {
        index: 0,
        node: { tagName: "p", textContent: "NEW" },
        op: "insert-child",
        parentPath: ["children", 1],
      },
      { index: 0, op: "remove-child", parentPath: ["children", 2] },
      // A move between two parents is refused for either one: out of a bound one, and into one.
      {
        fromIndex: 0,
        fromParentPath: ["children", 0],
        op: "move-child",
        toIndex: 0,
        toParentPath: ["children", 3],
      },
      {
        fromIndex: 0,
        fromParentPath: ["children", 3],
        op: "move-child",
        toIndex: 0,
        toParentPath: ["children", 1],
      },
    ];
    for (const op of ops) {
      const { container, ctx, shadow } = await frame(doc);
      expect(() => applyIframePatch(shadow, [op], container, ctx)).toThrow(
        "iframe-patch-structure-beside-bound-text",
      );
      container.remove();
    }
    // Beside LITERAL text the same op is applied in place, as it always was.
    const literal: JxMutableNode = {
      children: [
        { children: [{ tagName: "p", textContent: "A" }], tagName: "section", textContent: "x" },
      ],
      tagName: "div",
    };
    const { container, ctx, shadow } = await frame(literal);
    applyIframePatch(
      shadow,
      [
        {
          index: 1,
          node: { tagName: "p", textContent: "NEW" },
          op: "insert-child",
          parentPath: ["children", 0],
        },
      ],
      container,
      ctx,
    );
    expect(container.querySelector("section")?.textContent).toBe("xANEW");
    expect(isString(shadow.tagName)).toBe(true);
  });
});
