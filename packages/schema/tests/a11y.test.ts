/** Accessibility rules — one case per finding, one per silence a bound value earns. */
import { describe, expect, test } from "bun:test";

import { WCAG_CRITERIA, findA11yDefects } from "../src/a11y";
import type { JxElement } from "../types";

const doc = (children: unknown[]): JxElement =>
  ({ children, tagName: "div" }) as unknown as JxElement;

const rules = (root: JxElement) => findA11yDefects(root).map((d) => d.rule);

describe("interactive-unnamed", () => {
  test("a button, link or summary with no text and no label is unnamed", () => {
    const found = findA11yDefects(
      doc([
        { tagName: "button" },
        { attributes: { href: "/x" }, tagName: "a" },
        { tagName: "summary" },
        { attributes: { role: "button" }, tagName: "div" },
      ]),
    );
    expect(found.map((d) => d.rule)).toEqual(
      Array.from({ length: 4 }, () => "interactive-unnamed"),
    );
    expect(found[0]).toMatchObject({
      criterion: "4.1.2",
      message: "the <button> has no accessible name.",
      path: ["children", 0],
      severity: "error",
    });
    expect(found[0]!.detail).toContain("See docs/framework/concepts/accessibility.");
    expect(WCAG_CRITERIA[found[0]!.criterion]).toBe("Name, Role, Value");
  });

  test("text, a slot, a named image, a nested named child, aria-label or title each name it", () => {
    expect(
      rules(
        doc([
          { children: ["Save"], tagName: "button" },
          { children: [{ tagName: "slot" }], tagName: "button" },
          { children: [{ attributes: { alt: "Home" }, tagName: "img" }], tagName: "button" },
          {
            children: [{ children: [{ tagName: "span", textContent: "Go" }], tagName: "span" }],
            tagName: "button",
          },
          { attributes: { "aria-label": "Close" }, tagName: "button" },
          { attributes: { id: "h1" }, tagName: "h1", textContent: "Heading" },
          { attributes: { "aria-labelledby": "h1" }, tagName: "button" },
          { tagName: "button", title: "Help" },
          { tagName: "button", textContent: "Open" },
        ]),
      ),
    ).toEqual([]);
  });

  test("every shape `textContent` and `children` can take names a control", () => {
    /* The conservative branches of `hasContentName`, each of which is a SILENCE the lint owes an
       author: it may not accuse what it cannot read. They were reachable and unmeasured, so the
       one gate that says whether the lint stays quiet had nothing holding it. */
    expect(
      rules(
        doc([
          // A bound `textContent` — an object rather than a string, so its text is unknown.
          { tagName: "button", textContent: { $ref: "#/state/label" } },
          // A child element that carries the name, found by the recursive walk.
          { children: [{ tagName: "span", textContent: "Go" }], tagName: "button" },
          // `children` that is not an array at all: a mapped array, whose rows the document decides.
          { children: { $ref: "#/state/rows" }, tagName: "button" },
          // A `map` block, which is the same answer written the other way.
          { items: { $ref: "#/state/rows" }, map: { tagName: "span" }, tagName: "button" },
        ]),
      ),
    ).toEqual([]);
  });

  test("an empty string is not content, in either position", () => {
    // The mirror of the branches above: present, readable, and says nothing.
    expect(rules(doc([{ tagName: "button", textContent: "   " }]))).toEqual([
      "interactive-unnamed",
    ]);
    expect(rules(doc([{ children: ["  "], tagName: "button" }]))).toEqual(["interactive-unnamed"]);
    expect(rules(doc([{ children: [], tagName: "button" }]))).toEqual(["interactive-unnamed"]);
  });

  test("a bound name, role or content is not judged", () => {
    expect(
      rules(
        doc([
          { attributes: { "aria-label": "${state.label || null}" }, tagName: "button" },
          { attributes: { "aria-label": { $ref: "#/state/label" } }, tagName: "button" },
          { tagName: "button", textContent: { $ref: "#/state/label" } },
          { tagName: "button", textContent: "${state.label}" },
          { attributes: { role: "${state.role}" }, tagName: "div" },
          {
            children: { $prototype: "Array", items: [], map: { tagName: "span" } },
            tagName: "button",
          },
          {
            $switch: "#/state/x",
            cases: { a: { tagName: "span", textContent: "A" } },
            tagName: "button",
          },
        ] as unknown[]),
      ),
    ).toEqual([]);
  });

  test("an unlinked <a> is not a control, and an empty aria-label names nothing", () => {
    expect(rules(doc([{ tagName: "a" }]))).toEqual([]);
    expect(rules(doc([{ attributes: { "aria-label": " " }, tagName: "button" }]))).toEqual([
      "interactive-unnamed",
    ]);
  });

  test("inputs are named by a label, a placeholder, a value or an alt, by type", () => {
    expect(
      rules(
        doc([
          { attributes: { for: "q" }, children: ["Search"], tagName: "label" },
          { attributes: { id: "q" }, tagName: "input" },
          { children: ["Name", { tagName: "input" }], tagName: "label" },
          { attributes: { placeholder: "Email" }, tagName: "input" },
          { attributes: { type: "submit", value: "Send" }, tagName: "input" },
          { attributes: { alt: "Go", type: "image" }, tagName: "input" },
          { attributes: { type: "hidden" }, tagName: "input" },
          { attributes: { type: "${state.kind}" }, tagName: "input" },
          { attributes: { "aria-label": "Age" }, tagName: "select" },
          { attributes: { placeholder: "Notes" }, tagName: "textarea" },
        ]),
      ),
    ).toEqual([]);
    expect(
      rules(
        doc([
          { tagName: "input" },
          { attributes: { type: "submit" }, tagName: "input" },
          { attributes: { type: "image" }, tagName: "input" },
          { tagName: "select" },
          { tagName: "textarea" },
        ]),
      ),
    ).toEqual(Array.from({ length: 5 }, () => "interactive-unnamed"));
  });

  test("a bound id/for pair is a label the rule cannot read, so it stays silent", () => {
    /*
     * `<label for="row-${index}">` beside `<input id="row-${index}">` is the only correct way to
     * label a field inside a repeater, and both halves are templates. Read literally, the id
     * resolves to the sentinel and the `for` never enters the set, so the one correct form was the
     * one reported — at `error` severity, which fails `jx validate --strict` on a good document.
     */
    expect(
      rules({
        children: {
          $prototype: "Array",
          items: { $ref: "#/state/rows" },
          map: {
            children: [
              { attributes: { for: "row-${$map.index}" }, children: ["Name"], tagName: "label" },
              { attributes: { id: "row-${$map.index}" }, tagName: "input" },
            ],
            tagName: "li",
          },
        },
        tagName: "ul",
      } as unknown as JxElement),
    ).toEqual([]);
    // The flat form too, and a bound `for` alone is enough to make the pairing unreadable.
    expect(
      rules(
        doc([
          { attributes: { for: "field-${state.uid}" }, children: ["Name"], tagName: "label" },
          { attributes: { id: "field-${state.uid}" }, tagName: "input" },
        ]),
      ),
    ).toEqual([]);
    // …and a document with no bound labelling at all still reports a genuinely unlabelled field.
    expect(rules(doc([{ tagName: "input" }]))).toEqual(["interactive-unnamed"]);
  });

  test("a redundant role on a native control still consults the native labelling routes", () => {
    /*
     * A role on a native control is legal, and `role="combobox"` on an `<input>` is what the ARIA
     * Authoring Practices prescribe. The role branch used to answer before `<label for>` was ever
     * consulted, so the APG combobox — and a `role="slider"` range, and a `role="spinbutton"`
     * number with a placeholder — were all reported while carrying a perfectly good name.
     */
    expect(
      rules(
        doc([
          { attributes: { for: "q" }, children: ["Search"], tagName: "label" },
          {
            attributes: {
              "aria-controls": "lb",
              "aria-expanded": "false",
              id: "q",
              role: "combobox",
            },
            tagName: "input",
          },
          { attributes: { "aria-label": "Results", id: "lb", role: "listbox" }, tagName: "ul" },
        ]),
      ),
    ).toEqual([]);
    expect(
      rules(
        doc([
          {
            children: [
              "Find",
              { attributes: { role: "searchbox", type: "search" }, tagName: "input" },
            ],
            tagName: "label",
          },
        ]),
      ),
    ).toEqual([]);
    expect(
      rules(
        doc([
          {
            attributes: { placeholder: "Qty", role: "spinbutton", type: "number" },
            tagName: "input",
          },
        ]),
      ),
    ).toEqual([]);
    // The role branch still speaks for an element the native routes do not cover.
    expect(rules(doc([{ attributes: { role: "textbox" }, tagName: "div" }]))).toEqual([
      "interactive-unnamed",
    ]);
  });

  test("a linked <area> is named by its alt, and one with no href is not judged", () => {
    expect(
      rules(
        doc([
          {
            attributes: { alt: "Home", coords: "0,0,9,9", href: "/", shape: "rect" },
            tagName: "area",
          },
          { attributes: { alt: "${state.alt}", href: "/a" }, tagName: "area" },
          { attributes: { "aria-label": "Shop", href: "/b" }, tagName: "area" },
          { attributes: { coords: "0,0,9,9", shape: "rect" }, tagName: "area" },
        ]),
      ),
    ).toEqual([]);
    /*
     * An area IS the link text, so an empty alt is not the "decorative" decision it is on an
     * <img> — it leaves a link a reader hears as its URL.
     */
    expect(
      rules(
        doc([
          { attributes: { coords: "0,0,9,9", href: "/", shape: "rect" }, tagName: "area" },
          { attributes: { alt: "", href: "/a" }, tagName: "area" },
        ]),
      ),
    ).toEqual(["interactive-unnamed", "interactive-unnamed"]);
    expect(findA11yDefects(doc([{ attributes: { href: "/" }, tagName: "area" }]))[0]).toMatchObject(
      {
        criterion: "4.1.2",
        message: "the <area> has no accessible name.",
      },
    );
  });

  test("a role that must be labelled is not named by content, and an unknown role is not judged", () => {
    expect(
      rules(doc([{ attributes: { role: "textbox" }, children: ["x"], tagName: "div" }])),
    ).toEqual(["interactive-unnamed"]);
    expect(rules(doc([{ attributes: { role: "region" }, tagName: "div" }]))).toEqual([]);
  });
});

describe("img-alt-missing", () => {
  test("an image with no alt at all is reported; an empty alt, a bound alt or a presentation role is fine", () => {
    expect(rules(doc([{ tagName: "img" }]))).toEqual(["img-alt-missing"]);
    expect(
      rules(
        doc([
          { attributes: { alt: "" }, tagName: "img" },
          { attributes: { alt: "${state.alt}" }, tagName: "img" },
          { attributes: { alt: { $ref: "#/state/alt" } }, tagName: "img" },
          { attributes: { role: "presentation" }, tagName: "img" },
          { attributes: { "aria-label": "Logo" }, tagName: "img" },
        ]),
      ),
    ).toEqual([]);
    expect(findA11yDefects(doc([{ tagName: "img" }]))[0]).toMatchObject({
      criterion: "1.1.1",
      message: "the <img> has no alt text.",
    });
  });
});

describe("aria-target-missing", () => {
  test("a reference to an id nothing has is reported, per token", () => {
    const found = findA11yDefects(
      doc([
        { attributes: { id: "h" }, tagName: "h2" },
        {
          attributes: { "aria-labelledby": "h missing", "aria-controls": "panel" },
          tagName: "div",
        },
      ]),
    );
    expect(found.map((d) => [d.rule, d.message])).toEqual([
      [
        "aria-target-missing",
        "the <div> points aria-controls at #panel, which nothing in this document has as its id.",
      ],
      [
        "aria-target-missing",
        "the <div> points aria-labelledby at #missing, which nothing in this document has as its id.",
      ],
    ]);
    expect(found[0]!.criterion).toBe("1.3.1");
  });

  test("a top-level id counts, a bound reference is not judged, and a bound id anywhere silences the rule", () => {
    expect(
      rules(
        doc([
          { id: "h", tagName: "h2" },
          { attributes: { "aria-labelledby": "h" }, tagName: "div" },
        ]),
      ),
    ).toEqual([]);
    expect(
      rules(doc([{ attributes: { "aria-labelledby": "${state.id}" }, tagName: "div" }])),
    ).toEqual([]);
    expect(
      rules(
        doc([
          { attributes: { id: "row-${$map.index}" }, tagName: "li" },
          { attributes: { "aria-controls": "nowhere" }, tagName: "button", textContent: "x" },
        ]),
      ),
    ).toEqual([]);
  });
});

describe("roles outside their containers", () => {
  test("a tab, a menu item and an option need their container, and find it through any ancestor", () => {
    expect(
      rules(
        doc([
          { attributes: { role: "tab" }, tagName: "button", textContent: "A" },
          { attributes: { role: "menuitem" }, tagName: "div", textContent: "B" },
          { attributes: { role: "menuitemcheckbox" }, tagName: "div", textContent: "C" },
          { attributes: { role: "option" }, tagName: "div", textContent: "D" },
        ]),
      ),
    ).toEqual([
      "tab-outside-tablist",
      "menuitem-outside-menu",
      "menuitem-outside-menu",
      "option-outside-listbox",
    ]);
    expect(
      rules(
        doc([
          {
            attributes: { role: "tablist" },
            children: [
              {
                attributes: { "aria-selected": "true", role: "tab" },
                children: [{ tagName: "span", textContent: "A" }],
                tagName: "button",
              },
            ],
            tagName: "div",
          },
          {
            attributes: { role: "menubar" },
            children: [
              {
                attributes: { role: "group" },
                children: [{ attributes: { role: "menuitem" }, tagName: "div", textContent: "B" }],
                tagName: "div",
              },
            ],
            tagName: "div",
          },
          {
            attributes: { "aria-label": "Choices", role: "listbox" },
            children: [{ attributes: { role: "option" }, tagName: "div", textContent: "D" }],
            tagName: "ul",
          },
          {
            children: [{ attributes: { role: "option" }, tagName: "option", textContent: "E" }],
            tagName: "select",
            attributes: { "aria-label": "Pick" },
          },
        ]),
      ),
    ).toEqual([]);
  });

  test("the root, a custom-element ancestor and a bound ancestor role are all context the lint cannot see", () => {
    expect(
      rules({ attributes: { role: "menuitem" }, tagName: "div", textContent: "x" } as JxElement),
    ).toEqual([]);
    expect(
      rules(
        doc([
          {
            children: [{ attributes: { role: "tab" }, tagName: "button", textContent: "A" }],
            tagName: "jx-tabs",
          },
        ]),
      ),
    ).toEqual([]);
    expect(
      rules(
        doc([
          {
            attributes: { role: "${state.role}" },
            children: [{ attributes: { role: "option" }, tagName: "div", textContent: "D" }],
            tagName: "div",
          },
        ]),
      ),
    ).toEqual([]);
  });

  test("a container that owns the element through aria-owns is its container, wherever it sits", () => {
    expect(
      rules(
        doc([
          { attributes: { "aria-owns": "t1 t2", role: "tablist" }, tagName: "div" },
          {
            attributes: { "aria-selected": "true", id: "t1", role: "tab" },
            tagName: "button",
            textContent: "A",
          },
          {
            attributes: { "aria-selected": "false", id: "t2", role: "tab" },
            tagName: "button",
            textContent: "B",
          },
          {
            attributes: { "aria-label": "Actions", "aria-owns": "m1", role: "menu" },
            tagName: "div",
          },
          { attributes: { id: "m1", role: "menuitem" }, tagName: "div", textContent: "C" },
          {
            attributes: { "aria-label": "Choices", "aria-owns": "o1", role: "listbox" },
            tagName: "ul",
          },
          { attributes: { id: "o1", role: "option" }, tagName: "li", textContent: "D" },
        ]),
      ),
    ).toEqual([]);
    // A role that may not own a tab owns nothing here, and a tab no container names is still loose.
    expect(
      rules(
        doc([
          { attributes: { "aria-owns": "t1", role: "group" }, tagName: "div" },
          { attributes: { id: "t1", role: "tab" }, tagName: "button", textContent: "A" },
        ]),
      ),
    ).toEqual(["tab-outside-tablist"]);
    expect(
      rules(
        doc([
          { attributes: { "aria-owns": "t1", role: "tablist" }, tagName: "div" },
          { attributes: { id: "t1", role: "tab" }, tagName: "button", textContent: "A" },
          { attributes: { id: "t2", role: "tab" }, tagName: "button", textContent: "B" },
        ]),
      ),
    ).toEqual(["tab-outside-tablist"]);
    // A bound aria-owns, and a bound id on the tab, are both pairings the lint cannot read.
    expect(
      rules(
        doc([
          { attributes: { "aria-owns": "tab-${state.i}", role: "tablist" }, tagName: "div" },
          {
            attributes: { id: "tab-${state.i}", role: "tab" },
            tagName: "button",
            textContent: "A",
          },
        ]),
      ),
    ).toEqual([]);
  });
});

describe("tablist-none-selected", () => {
  test("a tablist whose tabs are none selected warns; a bound or a true selection is fine", () => {
    const tabs = (selected: unknown) => ({
      attributes: { role: "tablist" },
      children: [
        {
          attributes: { "aria-selected": selected, role: "tab" },
          tagName: "button",
          textContent: "A",
        },
        {
          attributes: { "aria-selected": "false", role: "tab" },
          tagName: "button",
          textContent: "B",
        },
      ],
      tagName: "div",
    });
    const found = findA11yDefects(doc([tabs("false")]));
    expect(found.map((d) => d.rule)).toEqual(["tablist-none-selected"]);
    expect(found[0]).toMatchObject({ criterion: "4.1.2", severity: "warn" });
    expect(found[0]!.message).toContain("2 tab(s)");
    const selectedText = doc([tabs("true")]);
    const selectedBoolean = doc([tabs(true)]);
    const selectedBound = doc([tabs("${state.selected}")]);
    expect(rules(selectedText)).toEqual([]);
    expect(rules(selectedBoolean)).toEqual([]);
    expect(rules(selectedBound)).toEqual([]);
    expect(rules(doc([{ attributes: { role: "tablist" }, tagName: "div" }]))).toEqual([]);
  });
});

describe("dialog-unnamed", () => {
  test("a <dialog> or a dialog role with no label is reported; content is not a name", () => {
    expect(
      rules(
        doc([
          { children: [{ tagName: "h2", textContent: "Title" }], tagName: "dialog" },
          { attributes: { role: "alertdialog" }, tagName: "div", textContent: "Sure?" },
        ]),
      ),
    ).toEqual(["dialog-unnamed", "dialog-unnamed"]);
    expect(
      rules(
        doc([
          {
            attributes: { "aria-labelledby": "t" },
            children: [{ attributes: { id: "t" }, tagName: "h2", textContent: "Title" }],
            tagName: "dialog",
          },
          { attributes: { "aria-label": "${state.title}" }, tagName: "dialog" },
        ]),
      ),
    ).toEqual([]);
  });
});

describe("activedescendant-not-focusable", () => {
  test("a container managing focus must be focusable itself", () => {
    expect(
      rules(
        doc([{ attributes: { "aria-activedescendant": "opt-1", role: "listbox" }, tagName: "ul" }]),
      ),
    ).toEqual(["interactive-unnamed", "activedescendant-not-focusable", "aria-target-missing"]);
    expect(
      rules(
        doc([
          { attributes: { id: "opt-1" }, tagName: "li" },
          {
            attributes: {
              "aria-activedescendant": "opt-1",
              "aria-label": "Choices",
              role: "listbox",
            },
            tabIndex: 0,
            tagName: "ul",
          },
          { attributes: { "aria-activedescendant": "opt-1", tabindex: "-1" }, tagName: "div" },
          {
            attributes: { "aria-activedescendant": "opt-1", "aria-label": "Search" },
            tagName: "input",
          },
        ]),
      ),
    ).toEqual([]);
    expect(
      findA11yDefects(
        doc([{ attributes: { "aria-activedescendant": "${state.active}" }, tagName: "div" }]),
      )[0],
    ).toMatchObject({
      criterion: "2.1.1",
      rule: "activedescendant-not-focusable",
    });
  });
});

describe("custom-element-in-select", () => {
  test("a jx-option inside a select is reported, and so is any other custom element", () => {
    const found = findA11yDefects(
      doc([
        {
          attributes: { "aria-label": "Font" },
          children: [
            { attributes: { value: "a" }, children: ["Alpha"], tagName: "jx-option" },
            { attributes: { value: "b" }, children: ["Beta"], tagName: "option" },
            { children: [{ tagName: "jx-icon" }], tagName: "option" },
          ],
          tagName: "select",
        },
      ]),
    );
    expect(found.map((d) => [d.rule, d.path])).toEqual([
      ["custom-element-in-select", ["children", 0, "children", 0]],
      ["custom-element-in-select", ["children", 0, "children", 2, "children", 0]],
    ]);
    expect(found[0]).toMatchObject({
      criterion: "4.1.2",
      message: "<jx-option> is a custom element inside a <select>.",
      severity: "error",
    });
    expect(found[0]!.detail).toContain("select.options");
  });

  test("a jx-select is the same select, and a listbox is not", () => {
    expect(
      rules(
        doc([
          {
            children: [{ attributes: { value: "a" }, children: ["Alpha"], tagName: "jx-option" }],
            tagName: "jx-select",
          },
        ]),
      ),
    ).toEqual(["custom-element-in-select"]);
    expect(
      rules(
        doc([
          {
            children: [{ attributes: { value: "a" }, children: ["Alpha"], tagName: "jx-option" }],
            tagName: "jx-listbox",
          },
        ]),
      ),
    ).toEqual([]);
  });

  test("it reaches a mapped row and a switch branch, where a row list is actually written", () => {
    expect(
      findA11yDefects(
        doc([
          {
            attributes: { "aria-label": "Font" },
            children: {
              $prototype: "Array",
              items: [],
              map: { children: ["${$map.item.label}"], tagName: "jx-option" },
            },
            tagName: "select",
          },
        ] as unknown[]),
      ).map((d) => [d.rule, d.path]),
    ).toEqual([["custom-element-in-select", ["children", 0, "children", "map"]]]);
  });
});

describe("the walk", () => {
  test("reaches a mapped-array template, a $map row and every $switch case, with their paths", () => {
    const found = findA11yDefects(
      doc([
        { children: { $prototype: "Array", items: [], map: { tagName: "button" } }, tagName: "ul" },
        { $prototype: "Array", items: [], map: { tagName: "img" }, tagName: "div" },
        { $switch: "#/state/x", cases: { one: { tagName: "dialog" } }, tagName: "div" },
      ] as unknown[]),
    );
    expect(found.map((d) => [d.rule, d.path])).toEqual([
      ["interactive-unnamed", ["children", 0, "children", "map"]],
      ["img-alt-missing", ["children", 1, "map"]],
      ["dialog-unnamed", ["children", 2, "cases", "one"]],
    ]);
  });

  test("the criteria table names every criterion a rule cites", () => {
    expect(Object.keys(WCAG_CRITERIA).toSorted()).toEqual(["1.1.1", "1.3.1", "2.1.1", "4.1.2"]);
  });
});
