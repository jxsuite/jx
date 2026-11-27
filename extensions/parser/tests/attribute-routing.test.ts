/**
 * Directive attribute routing (jx-markdown.md §6.6): one rule for every element, standard or
 * custom.
 */
import { describe, expect, test } from "bun:test";

import { isNodeObject } from "@jxsuite/schema/guards";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import { serializeJxMarkdown } from "../src/serialize";
import { isElementLevelKey, transpileJxMarkdown } from "../src/transpile";

/** The first child of a page, which must be one element. */
function firstChild(doc: { children?: unknown }): JxElement {
  const first = Array.isArray(doc.children) ? doc.children[0] : undefined;
  if (!isNodeObject(first)) {
    throw new Error(`Expected one element, got ${JSON.stringify(first)}`);
  }
  return first;
}

/** The first child a page of one directive transpiles to. */
function child(directive: string): JxElement {
  return firstChild(transpileJxMarkdown(`---\ntagName: my-page\n---\n\n${directive}\n`));
}

/** Serialize an element inside a page and transpile it back. */
function roundTrip(el: JxElement): JxElement {
  const doc: JxDocument = { tagName: "my-page", children: [el] };
  return firstChild(transpileJxMarkdown(serializeJxMarkdown(doc)));
}

describe("isElementLevelKey (jx-markdown.md §6.6)", () => {
  test("keeps structural keys, keyword keys, handlers and the six element properties", () => {
    for (const key of [
      "style",
      "children",
      "cases",
      "textContent",
      "innerText",
      "innerHTML",
      "$ref",
      "$props",
      "$title",
      "onclick",
      "oninput",
      "id",
      "className",
      "hidden",
      "tabIndex",
      "lang",
      "dir",
    ]) {
      expect(isElementLevelKey(key)).toBe(true);
    }
  });

  test("sends every other name to attributes", () => {
    for (const key of [
      "href",
      "src",
      "alt",
      "title",
      "type",
      "placeholder",
      "value",
      "checked",
      "selected",
      "class",
      "for",
      "tabindex",
      "aria-label",
      "data-x",
      "slot",
      "variant",
    ]) {
      expect(isElementLevelKey(key)).toBe(false);
    }
  });
});

describe("one rule on every element", () => {
  test("a custom element keeps its class, id, handlers and element properties on the element", () => {
    expect<unknown>(
      child(
        '::my-card{#c1 className="card" hidden tabIndex="0" lang="fr" dir="rtl" onclick.ref="#/state/open" variant="compact" data-x="1" aria-label="Card" slot="s" title="T"}',
      ),
    ).toEqual({
      tagName: "my-card",
      id: "c1",
      className: "card",
      hidden: true,
      tabIndex: "0",
      lang: "fr",
      dir: "rtl",
      onclick: { $ref: "#/state/open" },
      attributes: {
        variant: "compact",
        "data-x": "1",
        "aria-label": "Card",
        slot: "s",
        title: "T",
      },
    });
  });

  test("a bare hidden hides on every element", () => {
    expect<unknown>(child("::div{hidden}").hidden).toBe(true);
    expect<unknown>(child("::my-card{hidden}").hidden).toBe(true);
    expect<unknown>(child('::div{hidden="${state.off}"}').hidden).toBe("${state.off}");
    expect<unknown>(child('::div{hidden="false"}').hidden).toBe("false");
  });

  test("a standard and a custom element route the same attribute list identically", () => {
    const list =
      '#a .b className="c" hidden onclick.ref="#/state/go" type="text" for="x" data-k="1" style.color="red"';
    const { tagName: _a, ...standard } = child(`::div{${list}}`);
    const { tagName: _b, ...custom } = child(`::my-card{${list}}`);
    expect(custom).toEqual(standard);
  });

  test("the section 6.6 examples transpile to the JSON the spec shows", () => {
    expect<unknown>(
      child('::my-card{#featured className="card" onclick.ref="#/state/open" variant="compact"}'),
    ).toEqual({
      tagName: "my-card",
      id: "featured",
      className: "card",
      onclick: { $ref: "#/state/open" },
      attributes: { variant: "compact" },
    });
  });

  test("shorthands follow the rule", () => {
    for (const tag of ["div", "my-card"]) {
      const el = child(`::${tag}{#main .card}`);
      expect(el.id).toBe("main");
      expect(el.attributes).toEqual({ class: "card" });
    }
  });

  test("a switch keeps its cases", () => {
    const el = child('::div{switch.ref="#/state/route" cases.home.ref="./home.json"}');
    expect(el.$switch).toEqual({ $ref: "#/state/route" });
    expect(el.cases).toEqual({ home: { $ref: "./home.json" } });
    expect(el.attributes).toBeUndefined();
  });

  test("innerText is the element's text, not an attribute", () => {
    for (const tag of ["p", "my-card"]) {
      const el = child(`::${tag}{innerText="a"}`);
      expect(el).toMatchObject({ innerText: "a" });
      expect(el.attributes).toBeUndefined();
    }
  });

  test("value, checked and selected are attributes, bound or literal", () => {
    const input = child('::input{value.ref="#/state/v" checked="${state.done}"}');
    expect(input.attributes).toEqual({
      value: { $ref: "#/state/v" },
      checked: "${state.done}",
    });
    expect(input.value).toBeUndefined();
    expect<unknown>(child("::option{selected}").attributes).toEqual({ selected: "" });
  });
});

describe("save and reopen (serializeJxMarkdown then transpileJxMarkdown)", () => {
  test("a custom element's class, id, element properties and handler survive", () => {
    const el = {
      tagName: "my-card",
      id: "c1",
      className: "card",
      lang: "fr",
      dir: "rtl",
      onclick: { $ref: "#/state/open" },
      attributes: { variant: "compact", "data-x": "1", slot: "s", title: "T" },
    } satisfies JxElement;
    expect(roundTrip(el)).toEqual(el);
  });

  test("a standard element's handler and attributes survive", () => {
    const el = {
      tagName: "a",
      className: "k",
      onclick: { $ref: "#/state/go" },
      attributes: { href: "/x", title: "t" },
      textContent: "go",
    } satisfies JxElement;
    expect(roundTrip(el)).toEqual(el);
  });

  test("a switch node's cases survive", () => {
    const el = {
      tagName: "div",
      $switch: { $ref: "#/state/route" },
      cases: { home: { $ref: "./home.json" } },
    } satisfies JxElement;
    expect(roundTrip(el)).toEqual(el);
  });

  test("an element-level reflected property comes back under attributes", () => {
    const el = { tagName: "a", textContent: "go", href: "/x" };
    const back = roundTrip(el);
    expect(back.attributes).toEqual({ href: "/x" });
    expect(back).not.toHaveProperty("href");
  });
});
