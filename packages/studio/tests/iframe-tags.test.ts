/**
 * Dynamic tags in the canvas frame (src/canvas/iframe-tags.ts, studio.md §6.9): which chip a click
 * landed on, what a template resolves to in a scope, how many rows a repeater draws, and a chip
 * placed at the caret.
 *
 * DOM traversal and the runtime's own template evaluator, so happy-dom exercises all of it.
 */
import "./with-dom.js";
import { afterEach, describe, expect, test } from "bun:test";
import {
  chipAt,
  chipBlockActive,
  evaluateTemplates,
  insertChip,
  rowCountOf,
  tagClickAt,
  withFormulas,
} from "../src/canvas/iframe-tags";
import { catalog } from "@jxsuite/formulas";

import type { JxScope } from "@jxsuite/runtime/types";
import type { JxStateDefinition } from "@jxsuite/schema/types";

/** A chip's markup: closed to the caret, standing for `source`, showing `value`. */
const chip = (source: string, value = "v", extra = ""): string =>
  `<data data-jx-tag="${source}" contenteditable="false"${extra}>${value}</data>`;

/** Mount `html` under the body and return the element with `id`, or the first one mounted. */
function mount(html: string, id?: string): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  document.body.append(holder);
  const el = id === undefined ? holder.firstElementChild : holder.querySelector(`#${id}`);
  if (!(el instanceof HTMLElement)) {
    throw new TypeError("nothing mounted");
  }
  return el;
}

/** The state entry a packaged formula is vendored as. */
function packaged(name: string): JxStateDefinition {
  const formula = catalog.find((entry) => entry.name === name);
  if (!formula) {
    throw new TypeError(`no packaged formula ${name}`);
  }
  return { $expression: formula.expression, parameters: formula.parameters };
}

/** An attribute of an element that may not be there. */
function attrOf(el: Element | null, name: string): string | null {
  return el === null ? null : el.getAttribute(name);
}

/** Put a collapsed caret at (`node`, `offset`). */
function caret(node: Node, offset: number): void {
  document.getSelection()?.collapse(node, offset);
}

/** A block's children as text: a chip as the expression it stands for, in braces. */
function drawn(block: Element): string {
  return [...block.childNodes]
    .map((node) =>
      node instanceof Element ? `{${attrOf(node, "data-jx-tag") ?? node.tagName}}` : node.nodeValue,
    )
    .join("");
}

afterEach(() => {
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

describe("which chip a click landed on", () => {
  test("the outermost chip around the target, and none outside one", () => {
    const block = mount(
      `<p data-jx-path='["children",0]'>a ${chip("${state.x}", "<b id='in'>v</b>")} b</p>`,
    );
    const inner = block.querySelector("#in");
    expect(attrOf(chipAt(inner), "data-jx-tag")).toBe("${state.x}");
    expect(chipAt(block)).toBeNull();
    expect(chipAt(null)).toBeNull();
  });

  test("reports the block, the source and which chip of that source it is", () => {
    const block = mount(
      `<p data-jx-path='["children",2]'>${chip("${state.x}", "one")} and ${chip("${state.y}", "two")} and <data data-jx-text="">${chip("${state.x}", "three")}</data></p>`,
    );
    const chips = [...block.querySelectorAll("data[data-jx-tag]")];
    expect(tagClickAt(chips[0] ?? null, false)).toMatchObject({
      active: false,
      occurrence: 0,
      path: ["children", 2],
      ref: null,
      source: "${state.x}",
    });
    // The second chip of the same source, inside the element a templated member is drawn as.
    expect(tagClickAt(chips[2] ?? null, true)).toMatchObject({ active: true, occurrence: 1 });
    expect(tagClickAt(chips[1] ?? null, true)).toMatchObject({
      occurrence: 0,
      source: "${state.y}",
    });
    expect(tagClickAt(chips[0] ?? null, false)?.rect).toEqual({ height: 0, width: 0, x: 0, y: 0 });
  });

  test("a chip in an inline child that is a node of its own belongs to that child", () => {
    const block = mount(
      `<p data-jx-path='["children",0]'>${chip("${state.x}")}<em data-jx-path='["children",0,"children",1]'>${chip("${state.x}")}</em></p>`,
    );
    const inner = block.querySelector("em data");
    expect(tagClickAt(inner, false)).toMatchObject({
      occurrence: 0,
      path: ["children", 0, "children", 1],
    });
  });

  test("a { $ref } chip says its pointer", () => {
    const block = mount(
      `<h2 data-jx-path='["children",0]'><data data-jx-tag='\${state?.["t"]}' data-jx-tag-ref="#/state/t" contenteditable="false">T</data></h2>`,
    );
    expect(tagClickAt(block.firstElementChild, false)).toMatchObject({
      ref: "#/state/t",
      source: '${state?.["t"]}',
    });
  });

  test("nothing for a click off a chip, in an echo row, or in a block with no path", () => {
    const echo = mount(`<p data-jx-echo-path='["children",0,"map"]'>${chip("${item.t}")}</p>`);
    expect(tagClickAt(echo.firstElementChild, false)).toBeNull();
    const loose = mount(`<p>${chip("${item.t}")}</p>`);
    expect(tagClickAt(loose.firstElementChild, false)).toBeNull();
    expect(tagClickAt(loose, false)).toBeNull();
  });

  test("whether the chip's block already held the caret", () => {
    const active = mount(`<p data-jx-active-block="">${chip("${state.x}")}</p>`);
    const idle = mount(`<p>${chip("${state.x}")}</p>`);
    expect(chipBlockActive(active.firstElementChild)).toBe(true);
    expect(chipBlockActive(idle.firstElementChild)).toBe(false);
    expect(chipBlockActive(active)).toBe(false);
  });
});

describe("evaluating a template where it is drawn", () => {
  const scope: JxScope = {
    $map: {
      index: 2,
      item: { date: "2026-10-29T16:03:00Z", n: 3, tags: ["a", "b"], title: "Hello" },
    },
    count: 1234.5,
    flag: false,
    nothing: null,
    record: { a: 1 },
  };

  test("answers each template's value as text, with what kind of value it is", () => {
    const results = evaluateTemplates(
      [
        { id: "title", template: "${$map.item.title}" },
        { id: "bare", template: "${item.title}" },
        { id: "n", template: "${state.count}" },
        { id: "flag", template: "${state.flag}" },
        { id: "list", template: "${item.tags}" },
        { id: "one", template: "${[item.tags[0]]}" },
        { id: "record", template: "${state.record}" },
        { id: "nothing", template: "${state.nothing}" },
        { id: "missing", template: "${state.missing}" },
        { id: "mixed", template: "Row ${index}: ${item.title}" },
      ],
      scope,
    );
    expect(results).toEqual([
      { id: "title", text: "Hello", type: "string" },
      { id: "bare", text: "Hello", type: "string" },
      { id: "n", text: "1234.5", type: "number" },
      { id: "flag", text: "false", type: "boolean" },
      { id: "list", text: "2 items", type: "array" },
      { id: "one", text: "1 item", type: "array" },
      { id: "record", text: '{"a":1}', type: "object" },
      { id: "nothing", text: "", type: "empty" },
      { id: "missing", text: "", type: "empty" },
      { id: "mixed", text: "Row 2: Hello", type: "string" },
    ]);
  });

  test("a template that throws is its own result, and the ones beside it keep their values", () => {
    const [bad, good, uncompilable] = evaluateTemplates(
      [
        { id: "bad", template: "${state.missing.deep}" },
        { id: "good", template: "${item.n}" },
        { id: "syntax", template: "${)}" },
      ],
      scope,
    );
    expect(bad).toMatchObject({ id: "bad", text: "", type: "empty" });
    expect(bad?.error).toContain("undefined");
    expect(good).toEqual({ id: "good", text: "3", type: "number" });
    expect(uncompilable?.error).toBeString();
  });

  test("a long value is cut for a popover line", () => {
    const [long] = evaluateTemplates([{ id: "x", template: "${'a'.repeat(400)}" }], scope);
    expect(long?.text).toHaveLength(241);
    expect(long?.text.endsWith("…")).toBe(true);
  });

  test("a formula the document does not hold yet is defined for the evaluation alone", () => {
    const formulas = { formatDate: packaged("formatDate"), orBlank: packaged("orBlank") };
    const [long, plain] = evaluateTemplates(
      [
        { id: "long", template: '${state.formatDate(item.date, {"dateStyle":"long"})}' },
        { id: "blank", template: "${state.orBlank(state.nothing)}" },
      ],
      scope,
      formulas,
    );
    expect(long).toEqual({ id: "long", text: "October 29, 2026", type: "string" });
    expect(plain).toEqual({ id: "blank", text: "", type: "empty" });
    // The scope the canvas draws with is not written.
    expect("formatDate" in scope).toBe(false);
    // Without the formulas the same template fails, which is what a preset is filtered on.
    const [missing] = evaluateTemplates(
      [{ id: "long", template: "${state.formatDate(item.date)}" }],
      scope,
    );
    expect(missing?.error).toBeString();
  });

  test("a formula the scope already has is the scope's, and a default fills an argument left out", () => {
    const own: JxScope = { ...scope, orBlank: () => "the document's own" };
    expect(withFormulas(own, { orBlank: packaged("orBlank") })).toBe(own);
    expect(withFormulas(own, {})).toBe(own);
    expect(withFormulas(own, { notFormula: { default: 1 } })).toBe(own);
    const [mine, relative] = evaluateTemplates(
      [
        { id: "mine", template: "${state.orBlank(1)}" },
        { id: "relative", template: "${state.relativeTime(-3)}" },
      ],
      own,
      { orBlank: packaged("orBlank"), relativeTime: packaged("relativeTime") },
    );
    expect(mine?.text).toBe("the document's own");
    // `unit` defaults to "day".
    expect(relative?.text).toBe("3 days ago");
  });
});

describe("how many rows of a repeater are drawn", () => {
  const row = (attr: string, coords: string, extra = ""): string =>
    `<li ${attr}='["children",0,"map"]' data-jx-row="${coords}"${extra}></li>`;

  test("the rows beside the active one, and which of them it is", () => {
    const list = mount(
      `<ul>${row("data-jx-echo-path", "[0]")}${row("data-jx-path", "[1]")}${row("data-jx-echo-path", "[2]")}</ul>`,
    );
    expect(rowCountOf(list, ["children", 0])).toEqual({ active: 1, drawn: 3, total: 3 });
    expect(rowCountOf(list, ["children", 9])).toBeNull();
  });

  test("a list the cap cut short says how many items it has", () => {
    const list = mount(
      `<ul>${row("data-jx-path", "[0]")}${row("data-jx-echo-path", "[1]", ' data-jx-rows-more="2 of 512 rows"')}</ul>`,
    );
    expect(rowCountOf(list, ["children", 0])).toEqual({ active: 0, drawn: 2, total: 512 });
  });

  test("the template row of an empty list is no row", () => {
    const list = mount(`<ul>${row("data-jx-path", "[0]", ' data-jx-template-row=""')}</ul>`);
    expect(rowCountOf(list, ["children", 0])).toEqual({ active: 0, drawn: 0, total: 0 });
  });

  test("a nested repeater counts the rows of the outer row the active one stands in", () => {
    const inner = (attr: string, coords: string): string =>
      `<b ${attr}='["children",0,"map","children",0,"map"]' data-jx-row="${coords}"></b>`;
    const list = mount(
      `<div>${inner("data-jx-path", "[0,0]")}${inner("data-jx-echo-path", "[0,1]")}` +
        `${inner("data-jx-echo-path", "[1,0]")}${inner("data-jx-echo-path", "[1,1]")}${inner("data-jx-echo-path", "[1,2]")}</div>`,
    );
    expect(rowCountOf(list, ["children", 0, "map", "children", 0])).toEqual({
      active: 0,
      drawn: 2,
      total: 2,
    });
  });
});

describe("a chip placed at the caret", () => {
  test("between text, splitting the run it stands in", () => {
    const block = mount("<p>Hello world</p>");
    caret(block.firstChild!, 5);
    const placed = insertChip(block, "state.name", null);
    expect(drawn(block)).toBe("Hello{${state.name}} world");
    expect(attrOf(placed, "data-jx-tag-label")).toBe("Name");
    expect(attrOf(placed, "data-jx-tag-kind")).toBe("field");
    expect(placed.getAttribute("contenteditable")).toBe("false");
    expect(placed.textContent).toBe("");
    // The caret is after the chip, in the text that follows it.
    const selection = document.getSelection();
    expect(selection?.anchorNode).toBe(placed.nextSibling);
    expect(selection?.anchorOffset).toBe(0);
  });

  test("at the block's start and at its end", () => {
    const start = mount("<p>Hello</p>");
    caret(start.firstChild!, 0);
    insertChip(start, "item.a", null);
    expect(drawn(start)).toBe("{${item.a}}Hello");

    const end = mount("<p>Hello</p>");
    caret(end.firstChild!, 5);
    const placed = insertChip(end, "item.b", null);
    expect(drawn(end)).toBe("Hello{${item.b}}");
    // No empty text node is left behind the chip, and the caret is at the block's edge.
    expect(end.lastChild).toBe(placed);
    expect(document.getSelection()?.anchorNode).toBe(end);
    expect(document.getSelection()?.anchorOffset).toBe(2);
  });

  test("beside another chip, on either side, never inside it", () => {
    const block = mount(`<p>${chip("${item.a}", "A")}</p>`);
    caret(block, 1);
    insertChip(block, "item.b", null);
    expect(drawn(block)).toBe("{${item.a}}{${item.b}}");
    caret(block, 0);
    insertChip(block, "item.c", null);
    expect(drawn(block)).toBe("{${item.c}}{${item.a}}{${item.b}}");
    // A selection that somehow stands inside a chip is not a place to put one: the block's end.
    const inside = block.querySelector("data")!;
    inside.textContent = "v";
    caret(inside.firstChild!, 1);
    insertChip(block, "item.d", null);
    expect(drawn(block)).toBe("{${item.c}}{${item.a}}{${item.b}}{${item.d}}");
  });

  test("at the end of a selection, which is not typed over", () => {
    const block = mount("<p>Hello world</p>");
    const range = document.createRange();
    range.setStart(block.firstChild!, 0);
    range.setEnd(block.firstChild!, 5);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    insertChip(block, "state.x", null);
    expect(drawn(block)).toBe("Hello{${state.x}} world");
  });

  test("with no caret in the block, at its end, and an empty block loses its filler line", () => {
    const other = mount("<p>Elsewhere</p>");
    const block = mount("<p>Hello</p>");
    caret(other.firstChild!, 2);
    insertChip(block, "state.x", null);
    expect(drawn(block)).toBe("Hello{${state.x}}");
    const empty = mount("<p><br></p>");
    document.getSelection()?.removeAllRanges();
    insertChip(empty, "state.y", null);
    expect(drawn(empty)).toBe("{${state.y}}");
  });

  test("a line break the author wrote beside the caret is kept", () => {
    const block = mount("<p>Hello<br>world</p>");
    caret(block.firstChild!, 5);
    insertChip(block, "state.name", null);
    expect(block.querySelectorAll("br")).toHaveLength(1);
    expect(drawn(block)).toBe("Hello{${state.name}}{BR}world");
    // A lone break beside a chip in a block that holds more than the two is no filler either.
    const lines = mount("<p><br>text</p>");
    caret(lines, 0);
    insertChip(lines, "state.x", null);
    expect(lines.querySelectorAll("br")).toHaveLength(1);
  });

  test("a chip is named by the schema's title when the titles hold one, and a custom one says so", () => {
    const block = mount("<p></p>");
    const titled = insertChip(block, "item.data.date", { "item.data.date": "Post date" });
    expect(attrOf(titled, "data-jx-tag-label")).toBe("Post date");
    const custom = insertChip(block, "a ? b : c", null);
    expect(attrOf(custom, "data-jx-tag-kind")).toBe("custom");
    expect(attrOf(custom, "data-jx-tag-label")).toBe("Custom expression");
  });
});
