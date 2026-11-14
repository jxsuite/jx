/**
 * One element definition, two tiers (spec.md §8.1): the runtime assigns each key as a DOM property,
 * and the static emitter writes the attribute HTML reflects it to. This is spec.md §8.3's "does not
 * change meaning as it hydrates" as a test: the element the runtime renders and the element the
 * built HTML parses to must answer the same property.
 *
 * Happy-dom is not a browser, so the cases are the properties it reflects. A property it does not
 * reflect (`type` among them) is a `buildAttrs` unit case in `shared.test.ts`.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { describe, expect, test } from "bun:test";
import { renderNode } from "@jxsuite/runtime";
import type { JxElement } from "@jxsuite/schema/types";
import { renderStaticNode } from "../src/shared";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

/** What a case reads back from an element: a property's value or an attribute's text. */
type Reading = string | number | boolean | null;

/** The element the runtime renders from a definition. */
function live(def: JxElement): Element {
  const node = renderNode(def, {});
  if (!(node instanceof Element)) {
    throw new TypeError("Expected the runtime to render an element");
  }
  return node;
}

/** The element the static emitter's HTML parses to. */
function built(def: JxElement): Element {
  const template = document.createElement("template");
  template.innerHTML = renderStaticNode(def, null);
  const el = template.content.firstElementChild;
  if (!el) {
    throw new Error("Expected the static emitter to write an element");
  }
  return el;
}

/** Read a property by name, as a case names it. */
function property(name: string): (el: Element) => Reading {
  /* SAFETY: every case names a property its element has, whose value is a string, number or
     boolean; a missing one reads `undefined`, which fails the comparison with the expected value. */
  return (el) => (el as Element & Record<string, Reading>)[name] ?? null;
}

const CASES: [label: string, def: JxElement, read: (el: Element) => Reading, expected: Reading][] =
  [
    ["a href", { href: "/x", tagName: "a" }, (el) => el.getAttribute("href"), "/x"],
    ["img alt", { alt: "A chart", tagName: "img" }, property("alt"), "A chart"],
    ["input placeholder", { placeholder: "p", tagName: "input" }, property("placeholder"), "p"],
    ["input disabled", { disabled: true, tagName: "input" }, property("disabled"), true],
    ["input not disabled", { disabled: false, tagName: "input" }, property("disabled"), false],
    ["input value", { tagName: "input", value: "v" }, property("value"), "v"],
    [
      "input checked",
      { checked: true, tagName: "input", type: "checkbox" },
      property("checked"),
      true,
    ],
    ["option value", { tagName: "option", value: "o" }, property("value"), "o"],
    ["option selected", { selected: true, tagName: "option" }, property("selected"), true],
    ["td colSpan", { colSpan: 3, tagName: "td" }, property("colSpan"), 3],
    ["label htmlFor", { htmlFor: "f", tagName: "label" }, property("htmlFor"), "f"],
    ["textarea value", { tagName: "textarea", value: "hi" }, property("value"), "hi"],
    ["div hidden", { hidden: true, tagName: "div" }, property("hidden"), true],
    ["div tabIndex", { tabIndex: 3, tagName: "div" }, property("tabIndex"), 3],
    ["input name", { name: "q", tagName: "input" }, property("name"), "q"],
    ["div title", { tagName: "div", title: "tip" }, (el) => el.getAttribute("title"), "tip"],
  ];

describe("the runtime and the static emitter agree on an element's properties", () => {
  test.each(CASES)("%s", (_label, def, read, expected) => {
    expect(read(live(def))).toBe(expected);
    expect(read(built(def))).toBe(expected);
  });

  test("where a property and attributes name one attribute, both leave the attributes entry", () => {
    const def: JxElement = { attributes: { href: "/b" }, href: "/a", tagName: "a" };
    expect(live(def).getAttribute("href")).toBe("/b");
    expect(built(def).getAttribute("href")).toBe("/b");
  });

  test("a property the element lacks is no attribute in either tier", () => {
    const def: JxElement = { href: "/x", tagName: "div" };
    expect(live(def).hasAttribute("href")).toBe(false);
    expect(built(def).hasAttribute("href")).toBe(false);
  });
});
