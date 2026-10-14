import { describe, test, expect } from "bun:test";
import { componentize } from "../src/componentize.ts";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue, JxElement } from "@jxsuite/schema/types";

/** The children array of `node`, failing the test where the slot is absent or a repeater. */
function childrenOf(node: JxElement): (JxElement | string)[] {
  const { children } = node;
  if (!Array.isArray(children)) {
    throw new TypeError("expected the node to carry an array of children");
  }
  return children;
}

/** The element at `index` of `node`'s children, failing the test where that slot is text or absent. */
function childAt(node: JxElement, index: number): JxElement {
  const child = childrenOf(node)[index];
  if (child === undefined || isString(child)) {
    throw new Error(`expected an element child at index ${index}`);
  }
  return child;
}

/** Every child of `node` as an element, failing the test where any of them is text. */
function elementChildren(node: JxElement): JxElement[] {
  return childrenOf(node).map((child) => {
    if (isString(child)) {
      throw new Error(`expected an element child, got the text "${child}"`);
    }
    return child;
  });
}

/** The values of a call-site's `$props`, failing the test where the node carries none. */
function propValues(node: JxElement | undefined): JsonValue[] {
  const props = node?.$props;
  if (!isJsonObject(props)) {
    throw new Error("expected the call-site to carry a $props object");
  }
  return Object.values(props);
}

function card(title: string, desc: string, href: string): JxElement {
  return {
    tagName: "div",
    style: { padding: "1rem", border: "1px solid #ccc" },
    children: [
      { tagName: "h3", textContent: title },
      { tagName: "p", textContent: desc },
      { tagName: "a", attributes: { href }, textContent: "Learn More" },
    ],
  };
}

describe("componentize", () => {
  test("returns empty when no recurring subtrees", () => {
    const pages = new Map<string, JxElement>([
      [
        "pages/index.json",
        {
          tagName: "div",
          children: [{ tagName: "h1", textContent: "Hello" }],
        },
      ],
    ]);
    const result = componentize(pages);
    expect(result.components.size).toBe(0);
  });

  test("detects recurring card pattern across pages", () => {
    const pages = new Map<string, JxElement>([
      [
        "pages/index.json",
        {
          tagName: "div",
          children: [card("Card A", "Description A", "/a"), card("Card B", "Description B", "/b")],
        },
      ],
    ]);
    const result = componentize(pages);
    expect(result.components.size).toBe(1);

    const [fileName, comp] = [...result.components.entries()][0]!;
    expect(fileName).toMatch(/\.json$/);
    expect(comp.$id).toBeTruthy();
    expect(comp.tagName).toMatch(/^component-/);
    expect(comp.instanceCount).toBe(2);
    expect(comp.template.tagName).toBe("div");
  });

  test("extracts varying text into state props with interpolation", () => {
    const pages = new Map<string, JxElement>([
      [
        "pages/index.json",
        {
          tagName: "div",
          children: [card("Title 1", "Desc 1", "/link1"), card("Title 2", "Desc 2", "/link2")],
        },
      ],
    ]);
    const result = componentize(pages);
    const comp = [...result.components.values()][0]!;

    expect(comp.template.state).toBeUndefined();

    const templateStr = JSON.stringify(comp.template);
    expect(templateStr).toContain("${state.");
  });

  test("rewrites call-sites with tagName and $props", () => {
    const pages = new Map<string, JxElement>([
      [
        "pages/index.json",
        {
          tagName: "div",
          children: [card("Card A", "Desc A", "/a"), card("Card B", "Desc B", "/b")],
        },
      ],
    ]);
    const result = componentize(pages);
    const page = result.rewrittenPages.get("pages/index.json")!;

    expect(Array.isArray(page.children)).toBe(true);
    const children = elementChildren(page);
    expect(children.length).toBe(2);

    for (const child of children) {
      expect(child.tagName).toMatch(/^component-/);
      expect(child.$props).toBeTruthy();
    }
  });

  test("detects pattern across multiple pages", () => {
    const pages = new Map<string, JxElement>([
      [
        "pages/index.json",
        {
          tagName: "div",
          children: [card("Home Card", "Home desc", "/home")],
        },
      ],
      [
        "pages/about.json",
        {
          tagName: "div",
          children: [card("About Card", "About desc", "/about")],
        },
      ],
    ]);
    const result = componentize(pages);
    expect(result.components.size).toBe(1);

    const comp = [...result.components.values()][0]!;
    expect(comp.instanceCount).toBe(2);

    const indexPage = result.rewrittenPages.get("pages/index.json")!;
    const aboutPage = result.rewrittenPages.get("pages/about.json")!;
    expect(childAt(indexPage, 0).tagName).toMatch(/^component-/);
    expect(childAt(aboutPage, 0).tagName).toMatch(/^component-/);
  });

  test("respects minInstances threshold", () => {
    const pages = new Map<string, JxElement>([
      [
        "pages/index.json",
        {
          tagName: "div",
          children: [card("A", "a", "/a"), card("B", "b", "/b")],
        },
      ],
    ]);
    const result = componentize(pages, { minInstances: 3 });
    expect(result.components.size).toBe(0);
  });

  test("respects minDepth threshold", () => {
    const pages = new Map<string, JxElement>([
      [
        "pages/index.json",
        {
          tagName: "div",
          children: [
            { tagName: "span", textContent: "A" },
            { tagName: "span", textContent: "B" },
          ],
        },
      ],
    ]);
    // Span with textContent has depth 1, minDepth 2 should skip
    const result = componentize(pages, { minDepth: 2 });
    expect(result.components.size).toBe(0);
  });

  test("static text stays literal, only varying values become interpolated", () => {
    const pages = new Map<string, JxElement>([
      [
        "pages/index.json",
        {
          tagName: "div",
          children: [card("Card A", "Desc A", "/a"), card("Card B", "Desc B", "/b")],
        },
      ],
    ]);
    const result = componentize(pages);
    const comp = [...result.components.values()][0]!;
    const templateStr = JSON.stringify(comp.template);
    // "Learn More" is the same across both cards, should NOT be interpolated
    expect(templateStr).toContain("Learn More");
  });

  test("preserves pages with no recurring patterns unchanged", () => {
    const pages = new Map<string, JxElement>([
      [
        "pages/index.json",
        {
          tagName: "div",
          children: [
            { tagName: "h1", textContent: "Hello" },
            { tagName: "p", textContent: "World" },
          ],
        },
      ],
    ]);
    const result = componentize(pages);
    const page = result.rewrittenPages.get("pages/index.json")!;
    expect(JSON.stringify(page)).toBe(
      JSON.stringify({
        tagName: "div",
        children: [
          { tagName: "h1", textContent: "Hello" },
          { tagName: "p", textContent: "World" },
        ],
      }),
    );
  });

  test("$props values match the actual instance values", () => {
    const pages = new Map<string, JxElement>([
      [
        "pages/index.json",
        {
          tagName: "div",
          children: [card("Alpha", "First", "/alpha"), card("Beta", "Second", "/beta")],
        },
      ],
    ]);
    const result = componentize(pages);
    const page = result.rewrittenPages.get("pages/index.json")!;
    const [first, second] = elementChildren(page);

    const allValues0 = propValues(first);
    const allValues1 = propValues(second);

    expect(allValues0).toContain("Alpha");
    expect(allValues0).toContain("First");
    expect(allValues0).toContain("/alpha");
    expect(allValues1).toContain("Beta");
    expect(allValues1).toContain("Second");
    expect(allValues1).toContain("/beta");
  });
});

describe("componentize — string children and edge shapes", () => {
  function banner(text: string): JxElement {
    return {
      tagName: "aside",
      children: [{ tagName: "strong", children: ["Note:", text] }, "static tail"],
    };
  }

  test("raw string children participate: varying text interpolates, static stays literal", () => {
    const pages = new Map<string, JxElement>([
      ["pages/index.json", { tagName: "div", children: [banner("first"), banner("second")] }],
    ]);
    const result = componentize(pages);
    expect(result.components.size).toBe(1);

    const comp = [...result.components.values()][0]!;
    const strong = childAt(comp.template, 0);
    expect(strong.children).toEqual(["Note:", "${state.text}"]);
    expect(childrenOf(comp.template)[1]).toBe("static tail");

    const page = result.rewrittenPages.get("pages/index.json")!;
    const children = elementChildren(page);
    expect(children[0]!.$props).toEqual({ text: "first" });
    expect(children[1]!.$props).toEqual({ text: "second" });
  });

  test("an attribute named like an index falls back to the 'value' state name", () => {
    const widget = (v: string): JxElement => ({
      tagName: "section",
      children: [{ tagName: "div", attributes: { "0": v }, children: [{ tagName: "i" }] }],
    });
    const pages = new Map<string, JxElement>([
      ["pages/index.json", { tagName: "div", children: [widget("alpha"), widget("beta")] }],
    ]);
    const result = componentize(pages);
    // The deeper section pattern claims first; its inner div repeat is subsumed by the claim.
    expect(result.components.size).toBe(1);

    const comp = [...result.components.values()][0]!;
    expect(comp.template.tagName).toBe("section");
    const div = childAt(comp.template, 0);
    expect(div.attributes?.["0"]).toBe("${state.value}");

    const page = result.rewrittenPages.get("pages/index.json")!;
    expect(childAt(page, 0).$props).toEqual({ value: "alpha" });
    expect(childAt(page, 1).$props).toEqual({ value: "beta" });
  });

  test("call-sites nested below the top level are rewritten in place", () => {
    const pages = new Map<string, JxElement>([
      [
        "pages/index.json",
        {
          tagName: "div",
          children: [
            { tagName: "main", children: [card("Nested A", "da", "/a")] },
            { tagName: "aside", children: [card("Nested B", "db", "/b")] },
          ],
        },
      ],
    ]);
    const result = componentize(pages);
    expect(result.components.size).toBe(1);

    const page = result.rewrittenPages.get("pages/index.json")!;
    const main = childAt(page, 0);
    const aside = childAt(page, 1);
    expect(childAt(main, 0).tagName).toMatch(/^component-/);
    expect(childAt(aside, 0).tagName).toMatch(/^component-/);
  });
});
