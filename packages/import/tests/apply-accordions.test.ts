import { describe, expect, test } from "bun:test";
import { isString } from "@jxsuite/schema/guards";
import type { JxElement, JxStyle } from "@jxsuite/schema/types";
import { applyAccordions, countLeaves, readAccordionRows } from "../src/apply-accordions.ts";

/** A node's child array, failing the test when the slot holds a repeater or nothing. */
function childrenOf(node: JxElement): (JxElement | string)[] {
  if (!Array.isArray(node.children)) {
    throw new TypeError("expected a child array");
  }
  return node.children;
}

/** The element at `index` among a node's children, failing the test on text or a missing child. */
function elementChild(node: JxElement, index: number): JxElement {
  const child = childrenOf(node)[index];
  if (child === undefined || isString(child)) {
    throw new TypeError(`expected an element at children[${index}]`);
  }
  return child;
}

/** Every child of a node, failing the test if any of them is text. */
function elementChildren(node: JxElement): JxElement[] {
  return childrenOf(node).map((_, index) => elementChild(node, index));
}

/** A node's style object, failing the test when the rewrite dropped it. */
function styleOf(node: JxElement): JxStyle {
  if (node.style === undefined) {
    throw new TypeError("expected a style object");
  }
  return node.style;
}

/**
 * The reference corpus's accordion, as the tree stands when this pass runs: styles applied, classes
 * still present, framework directives intact, every row but none of them actually openable.
 */
function alpineAccordion(titles: readonly string[]): JxElement {
  return {
    attributes: {
      "x-data": "{ open_accordion_item: null }",
      class: "accordion-wrapper numbered-accordion-items",
    },
    children: titles.map((title, index): JxElement => ({
      attributes: {
        class: "accordion-item",
        ":class": `{ 'active': open_accordion_item === ${index} }`,
      },
      children: [
        {
          attributes: {
            class: "accordion-title",
            "@click": `open_accordion_item = (open_accordion_item === ${index} ? null : ${index})`,
          },
          children: [{ tagName: "h5", textContent: title }],
          style: { cursor: "pointer", display: "flex" },
          tagName: "div",
        },
        {
          attributes: {
            class: "accordion-text",
            hidden: "",
            "x-collapse.duration.250ms": "",
            "x-show": `open_accordion_item === ${index} `,
          },
          children: [
            { children: [{ tagName: "li", textContent: `body ${index}` }], tagName: "ul" },
          ],
          style: { display: "none", height: "0px", overflow: "hidden" },
          tagName: "div",
        },
      ],
      style: { marginBottom: "32px" },
      tagName: "div",
    })),
    tagName: "div",
  };
}

function page(widget: JxElement): JxElement {
  return { children: [widget], tagName: "div" };
}

describe("applyAccordions", () => {
  test("converts the corpus accordion to native <details>", () => {
    const tree = page(alpineAccordion(["Available Sizes", "Roof Pitch", "Eave Overhang"]));

    const result = applyAccordions(tree);

    expect(result).toEqual({ converted: 1, rows: 3 });
    const root = elementChild(tree, 0);
    expect(elementChildren(root).map((c) => c.tagName)).toEqual(["details", "details", "details"]);
  });

  test("gives every row of one widget the same name, so they stay mutually exclusive", () => {
    /* The source state was a single scalar: opening one row closed the others. Same-named details
       reproduce that natively, which plain <details> would not. */
    const tree = page(alpineAccordion(["A", "B", "C"]));

    applyAccordions(tree);

    const root = elementChild(tree, 0);
    const names = elementChildren(root).map((d) => d.attributes!["name"]);
    expect(new Set(names).size).toBe(1);
    expect(names[0]).toBeTruthy();
  });

  test("gives two separate widgets different names", () => {
    const tree: JxElement = {
      children: [alpineAccordion(["A", "B"]), alpineAccordion(["C", "D"])],
      tagName: "div",
    };

    applyAccordions(tree);

    const [first, second] = elementChildren(tree);
    const nameOf = (w: JxElement) => elementChild(w, 0).attributes!["name"];
    expect(nameOf(first!)).not.toBe(nameOf(second!));
  });

  test("puts the title inside <summary> and leaves the body a sibling", () => {
    const tree = page(alpineAccordion(["Available Sizes", "Roof Pitch"]));

    applyAccordions(tree);

    const details = elementChild(elementChild(tree, 0), 0);
    const [summary, body] = elementChildren(details);
    expect(summary!.tagName).toBe("summary");
    expect(countLeaves(summary!)).toEqual(["t:Available Sizes"]);
    expect(countLeaves(body!)).toEqual(["t:body 0"]);
  });

  test("unconceals the body so its content is reachable again", () => {
    const tree = page(alpineAccordion(["A", "B"]));

    applyAccordions(tree);

    const details = elementChild(elementChild(tree, 0), 0);
    const body = elementChild(details, 1);
    expect(body.attributes!["hidden"]).toBeUndefined();
    const bodyStyle = styleOf(body);
    expect(bodyStyle["display"]).toBeUndefined();
    expect(bodyStyle["height"]).toBeUndefined();
  });

  test("deletes the dead directives nothing will ever execute", () => {
    const tree = page(alpineAccordion(["A", "B"]));

    applyAccordions(tree);

    const serialized = JSON.stringify(tree);
    for (const directive of ["x-data", "x-show", "x-collapse", "@click", ":class"]) {
      expect(serialized).not.toContain(directive);
    }
  });

  test("keeps the classes and styling the site authored", () => {
    const tree = page(alpineAccordion(["A", "B"]));

    applyAccordions(tree);

    const details = elementChild(elementChild(tree, 0), 0);
    expect(details.attributes!["class"]).toBe("accordion-item");
    expect(styleOf(details)["marginBottom"]).toBe("32px");
  });

  test("conserves every leaf across the rewrite", () => {
    const tree = page(alpineAccordion(["Available Sizes", "Roof Pitch", "Posts"]));
    const before = countLeaves(tree);

    applyAccordions(tree);

    expect(countLeaves(tree)).toEqual(before);
  });
});

describe("closure, and what it refuses", () => {
  const idents = new Set(["open"]);

  function widget(children: JxElement[]): JxElement {
    return { attributes: { "x-data": "{ open: null }" }, children, tagName: "div" };
  }

  function row(toggleKey: string, compareKey: string): JxElement {
    return {
      children: [
        {
          attributes: { "@click": `open = (open === ${toggleKey} ? null : ${toggleKey})` },
          tagName: "div",
        },
        { attributes: { "x-show": `open === ${compareKey}` }, tagName: "div" },
      ],
      tagName: "div",
    };
  }

  /** Build the widget, then read it — kept apart so the assertions stay shallow. */
  function read(rows: JxElement[]): ReturnType<typeof readAccordionRows> {
    return readAccordionRows(widget(rows), idents);
  }

  test("reads a well-formed widget", () => {
    expect(read([row("0", "0"), row("1", "1")])).toHaveLength(2);
  });

  test("refuses when a row's toggle and predicate disagree", () => {
    expect(read([row("0", "0"), row("1", "2")])).toBeNull();
  });

  test("refuses when two rows claim the same key", () => {
    expect(read([row("0", "0"), row("0", "0")])).toBeNull();
  });

  test("refuses a row with no predicate at all", () => {
    const bare: JxElement = { children: [], tagName: "div" };
    expect(read([row("0", "0"), bare])).toBeNull();
  });

  test("refuses a toggle over an ident nobody declared", () => {
    const stray: JxElement = {
      children: [
        { attributes: { "@click": "other = (other === 1 ? null : 1)" }, tagName: "div" },
        { attributes: { "x-show": "other === 1" }, tagName: "div" },
      ],
      tagName: "div",
    };
    expect(read([row("0", "0"), stray])).toBeNull();
  });

  test("refuses a single-row widget, which is not an accordion", () => {
    expect(read([row("0", "0")])).toBeNull();
  });

  test("leaves an unrecognised widget completely untouched", () => {
    const unrecognised = widget([row("0", "0"), row("1", "2")]);
    const tree = page(unrecognised);
    const before = JSON.stringify(tree);

    expect(applyAccordions(tree)).toEqual({ converted: 0, rows: 0 });
    expect(JSON.stringify(tree)).toBe(before);
  });

  test("ignores a repeater, which has no literal rows to read", () => {
    const repeater: JxElement = {
      attributes: { "x-data": "{ open: null }" },
      children: { $prototype: "Array", items: [] },
      tagName: "div",
    };
    const tree = page(repeater);
    expect(applyAccordions(tree)).toEqual({ converted: 0, rows: 0 });
  });
});

describe("leaf census", () => {
  test("counts a bare text child", () => {
    const node: JxElement = { children: ["hello", "  ", "world"], tagName: "p" };
    expect(countLeaves(node)).toEqual(["t:hello", "t:world"]);
  });

  test("counts an image by its source, so a swapped picture reads as loss", () => {
    const node: JxElement = {
      children: [{ attributes: { src: "/a.png" }, tagName: "img" }],
      tagName: "p",
    };
    expect(countLeaves(node)).toEqual(["m:/a.png"]);
  });

  test("counts a lone string", () => {
    expect(countLeaves("just text")).toEqual(["t:just text"]);
    expect(countLeaves("   ")).toEqual([]);
  });
});

describe("what the rewrite refuses to touch", () => {
  test("refuses a root whose rows are interleaved with real text", () => {
    /* Loose text between rows is content this transform has nowhere to put, so the widget is left
       exactly as it is rather than dropping it. */
    const widget: JxElement = {
      attributes: { "x-data": "{ open: null }" },
      children: [
        {
          children: [
            { attributes: { "@click": "open = (open === 0 ? null : 0)" }, tagName: "div" },
            { attributes: { "x-show": "open === 0" }, tagName: "div" },
          ],
          tagName: "div",
        },
        "stray text nobody accounted for",
      ],
      tagName: "div",
    };
    const tree: JxElement = { children: [widget], tagName: "div" };
    const before = JSON.stringify(tree);

    expect(applyAccordions(tree)).toEqual({ converted: 0, rows: 0 });
    expect(JSON.stringify(tree)).toBe(before);
  });

  test("tolerates insignificant whitespace between rows", () => {
    const row = (index: number): JxElement => ({
      children: [
        {
          attributes: { "@click": `open = (open === ${index} ? null : ${index})` },
          tagName: "div",
        },
        { attributes: { "x-show": `open === ${index}` }, tagName: "div" },
      ],
      tagName: "div",
    });
    const widget: JxElement = {
      attributes: { "x-data": "{ open: null }" },
      children: [row(0), "\n  ", row(1)],
      tagName: "div",
    };

    expect(applyAccordions({ children: [widget], tagName: "div" })).toEqual({
      converted: 1,
      rows: 2,
    });
  });

  test("strips a string-valued inline handler but never a Jx object handler", () => {
    const widget: JxElement = {
      attributes: { "x-data": "{ open: null }" },
      children: [0, 1].map((index): JxElement => ({
        children: [
          {
            attributes: {
              onclick: "legacyThing()",
              "@click": `open = (open === ${index} ? null : ${index})`,
            },
            tagName: "div",
          },
          { attributes: { "x-show": `open === ${index}` }, tagName: "div" },
        ],
        tagName: "div",
      })),
      tagName: "div",
    };
    const tree: JxElement = { children: [widget], tagName: "div" };

    applyAccordions(tree);

    expect(JSON.stringify(tree)).not.toContain("legacyThing");
  });
});

describe("rows containing loose text", () => {
  test("carries a row's own text children through the rewrite", () => {
    const row = (index: number): JxElement => ({
      children: [
        {
          children: ["Title text"],
          attributes: { "@click": `open = (open === ${index} ? null : ${index})` },
          tagName: "div",
        },
        {
          attributes: { "x-show": `open === ${index}`, hidden: "" },
          children: [`body ${index}`],
          tagName: "div",
        },
      ],
      tagName: "div",
    });
    const widget: JxElement = {
      attributes: { "x-data": "{ open: null }" },
      children: [row(0), row(1)],
      tagName: "div",
    };
    const tree: JxElement = { children: [widget], tagName: "div" };
    const before = countLeaves(tree);

    expect(applyAccordions(tree)).toEqual({ converted: 1, rows: 2 });
    expect(countLeaves(tree)).toEqual(before);
  });
});
