/**
 * Where a component instance delivers a prop — `src/utils/prop-source.ts` (studio.md §8.2.6).
 *
 * The canvas's prop-bound text and the Inspector's Component Settings both ask this question, so
 * the answer is tested once here, against the routes the runtime and the site build read.
 */
import "./with-dom";
import { afterEach, describe, expect, test } from "bun:test";
import { defineElement, renderNode } from "@jxsuite/runtime";
import {
  attributeNamesProp,
  deliveredOutsideProps,
  describePropSource,
  payloadOf,
  propSource,
  propSources,
  reflectedProperty,
  shorthandCarries,
  shorthandDelivers,
} from "../src/utils/prop-source";
import type { JxMutableNode } from "@jxsuite/schema/types";
import { stubAriaLabel } from "./aria-reflection";

let restoreAria = (): void => {};
function withAriaLabel(): void {
  restoreAria = stubAriaLabel();
}
afterEach(() => {
  restoreAria();
  restoreAria = () => {};
});

// ─── deliveredOutsideProps ───────────────────────────────────────────────────

describe("deliveredOutsideProps", () => {
  test("a node that is absent, or carries only $props, delivers nothing by another route", () => {
    expect(deliveredOutsideProps(undefined, "label")).toBe(false);
    expect(deliveredOutsideProps({ $props: { label: "x" }, tagName: "x-card" }, "label")).toBe(
      false,
    );
    expect(deliveredOutsideProps({ attributes: {}, tagName: "x-card" }, "label")).toBe(false);
  });

  test("a props.* attribute delivers exactly the prop it names", () => {
    const node: JxMutableNode = { attributes: { "props.label": "x" }, tagName: "x-card" };
    expect(deliveredOutsideProps(node, "label")).toBe(true);
    expect(deliveredOutsideProps(node, "note")).toBe(false);
  });

  test("an attribute named like a reflected DOM property delivers the prop, whatever its case", () => {
    expect(deliveredOutsideProps({ attributes: { title: "x" }, tagName: "x-card" }, "title")).toBe(
      true,
    );
    expect(deliveredOutsideProps({ attributes: { TITLE: "x" }, tagName: "x-card" }, "title")).toBe(
      true,
    );
    expect(deliveredOutsideProps({ attributes: { role: "x" }, tagName: "x-card" }, "role")).toBe(
      true,
    );
  });

  test("an attribute named like a prop that is no DOM property delivers nothing", () => {
    /* The runtime's merge asks `key in this`; `ribbon` is not on an element, so setting the
       attribute writes no property and the instance renders as though it were absent. */
    for (const attr of ["ribbon", "RIBBON", "Ribbon"]) {
      const node: JxMutableNode = { attributes: { [attr]: "x" }, tagName: "x-card" };
      expect(deliveredOutsideProps(node, "ribbon")).toBe(false);
    }
    const kebab: JxMutableNode = { attributes: { "card-label": "x" }, tagName: "x-card" };
    expect(deliveredOutsideProps(kebab, "cardLabel")).toBe(false);
  });

  test("the kebab attribute of a camelCase DOM property delivers it", () => {
    withAriaLabel();
    const node: JxMutableNode = { attributes: { "aria-label": "x" }, tagName: "x-card" };
    expect(deliveredOutsideProps(node, "ariaLabel")).toBe(true);
    expect(deliveredOutsideProps(node, "aria")).toBe(false);
  });

  test("a data-jx-props payload delivers the props it names and no others", () => {
    const node: JxMutableNode = {
      attributes: { "data-jx-props": JSON.stringify({ label: "x" }) },
      tagName: "x-card",
    };
    expect(deliveredOutsideProps(node, "label")).toBe(true);
    expect(deliveredOutsideProps(node, "note")).toBe(false);
  });

  test("a payload that does not parse to an object delivers nothing", () => {
    for (const payload of ["{label", '"label"', "null", "[1]"]) {
      const node: JxMutableNode = { attributes: { "data-jx-props": payload }, tagName: "x-card" };
      expect(deliveredOutsideProps(node, "label")).toBe(false);
      // An array is an object to `typeof`, and its indices would read as props.
      expect(payloadOf(node)).toBeNull();
    }
  });

  test("a top-level key delivers the prop, but a reserved or $-prefixed key does not", () => {
    const node: JxMutableNode = { $id: "card", label: "Top", name: "n", tagName: "x-card" };
    expect(deliveredOutsideProps(node, "label")).toBe(true);
    expect(deliveredOutsideProps(node, "note")).toBe(false);
    expect(deliveredOutsideProps(node, "name")).toBe(false);
    expect(deliveredOutsideProps(node, "tagName")).toBe(false);
    expect(deliveredOutsideProps(node, "$id")).toBe(false);
  });
});

// ─── The shorthand's key, as each reader sees it ─────────────────────────────

describe("shorthandDelivers", () => {
  test("the runtime lowercases the key, so any casing of a lowercase prop delivers it", () => {
    expect(shorthandDelivers("props.label", "label")).toBe(true);
    expect(shorthandDelivers("props.Label", "label")).toBe(true);
  });

  test("a camelCase prop is delivered only by the key the site build lifts as written", () => {
    expect(shorthandDelivers("props.cardLabel", "cardLabel")).toBe(true);
    // The runtime reads `cardlabel` and the build reads `cardlabel`: neither is `cardLabel`.
    expect(shorthandDelivers("props.cardlabel", "cardLabel")).toBe(false);
  });

  test("anything that is not a props.* name with a key delivers nothing", () => {
    expect(shorthandDelivers("props.", "")).toBe(false);
    expect(shorthandDelivers("label", "label")).toBe(false);
    expect(shorthandDelivers("data-props.label", "label")).toBe(false);
  });
});

describe("attributeNamesProp", () => {
  test("the shorthand and the payload are routes of their own, never a same-named attribute", () => {
    withAriaLabel();
    expect(attributeNamesProp("props.title", "title")).toBe(false);
    expect(attributeNamesProp("data-jx-props", "dataJxProps")).toBe(false);
    expect(attributeNamesProp("aria-label", "ariaLabel")).toBe(true);
  });
});

describe("reflectedProperty", () => {
  test("asks the element prototype, as the runtime's `key in this` does", () => {
    expect(reflectedProperty("title")).toBe(true);
    expect(reflectedProperty("role")).toBe(true);
    expect(reflectedProperty("ribbon")).toBe(false);
  });
});

// ─── propSources ─────────────────────────────────────────────────────────────

describe("propSources", () => {
  test("the shorthand alone is the source, with the attribute it lives in", () => {
    const node: JxMutableNode = {
      attributes: { "props.caption": "A view", "props.src": "/a.png" },
      tagName: "deck-figure",
    };
    expect(propSource(node, "src")).toEqual({
      key: "props.src",
      route: "props-attribute",
      value: "/a.png",
    });
    expect(propSource(node, "alt")).toBeNull();
    expect(propSource(undefined, "src")).toBeNull();
  });

  test("each route wins in the order the runtime applies it", () => {
    const node: JxMutableNode = {
      $props: { title: "props" },
      attributes: {
        "data-jx-props": JSON.stringify({ title: "payload" }),
        "props.title": "shorthand",
        title: "attribute",
      },
      tagName: "x-card",
      title: "property",
    };
    expect(propSources(node, "title").map((s) => s.route)).toEqual([
      "property",
      "attribute",
      "$props",
      "props-attribute",
      "payload",
    ]);
  });

  test("without a $props block a reflected attribute beats a top-level key", () => {
    /* The runtime applies an instance's properties before its attributes unless `$props` routes it
       through the property-first path, which applies them the other way round. */
    const node: JxMutableNode = {
      attributes: { title: "attribute" },
      tagName: "x-card",
      title: "p",
    };
    expect(propSources(node, "title").map((s) => s.route)).toEqual(["attribute", "property"]);
  });

  test("an attribute named like a prop that is no DOM property is no source at all", () => {
    const node: JxMutableNode = {
      $props: { ribbon: "props" },
      attributes: { Ribbon: "attribute", ribbon: "attribute" },
      tagName: "x-card",
    };
    expect(propSources(node, "ribbon").map((s) => s.route)).toEqual(["$props"]);
  });

  test("of two spellings of one shorthand key, the exact one comes first", () => {
    const node: JxMutableNode = {
      attributes: { "props.Label": "folded", "props.label": "exact" },
      tagName: "x-card",
    };
    expect(propSources(node, "label").map((s) => s.key)).toEqual(["props.label", "props.Label"]);
  });

  test("a payload member is read off the parsed object", () => {
    const node: JxMutableNode = {
      attributes: { "data-jx-props": JSON.stringify({ count: 3 }) },
      tagName: "x-card",
    };
    expect(payloadOf(node)).toEqual({ count: 3 });
    expect(propSource(node, "count")).toEqual({ key: "count", route: "payload", value: 3 });
    expect(payloadOf({ tagName: "x-card" })).toBeNull();
    expect(payloadOf()).toBeNull();
  });
});

// ─── What the shorthand can carry ────────────────────────────────────────────

describe("shorthandCarries", () => {
  test("a literal string for a lowercase prop, and nothing else", () => {
    expect(shorthandCarries("label", "Hi")).toBe(true);
    expect(shorthandCarries("label", "${state.name}")).toBe(false);
    expect(shorthandCarries("label", 3)).toBe(false);
    expect(shorthandCarries("label", true)).toBe(false);
    expect(shorthandCarries("label", { $ref: "#/state/name" })).toBe(false);
    expect(shorthandCarries("cardLabel", "Hi")).toBe(false);
  });
});

describe("describePropSource", () => {
  test("names the key that holds the value", () => {
    expect(describePropSource({ key: "props.src", route: "props-attribute", value: "" })).toBe(
      "the props.src attribute",
    );
    expect(describePropSource({ key: "title", route: "attribute", value: "" })).toBe(
      "the title attribute",
    );
    expect(describePropSource({ key: "label", route: "property", value: "" })).toBe(
      "the instance's label property",
    );
    expect(describePropSource({ key: "label", route: "payload", value: "" })).toBe(
      "the data-jx-props payload",
    );
    expect(describePropSource({ key: "label", route: "$props", value: "" })).toBe("$props");
  });
});

// ─── Against the runtime ─────────────────────────────────────────────────────

describe("the winning source is the value the runtime draws", () => {
  /*
   * The order above is a claim about `connectedCallback` and `renderNode`, so it is checked against
   * them: each case renders a real instance and compares the text it draws with what `propSource`
   * says, falling back to the definition's default where Studio finds no source. Two documented
   * divergences are not here: an attribute in `observedAttributes` (not modelled), and two spellings
   * of one `props.*` key, where the live page takes whichever the attribute list writes last.
   */
  let n = 0;
  async function drawn(instance: Omit<JxMutableNode, "tagName">, prop: string): Promise<string> {
    n += 1;
    const tagName = `x-prop-source-${n}`;
    await defineElement({
      children: [{ tagName: "i", textContent: `\${state.${prop}}` }],
      state: { [prop]: "DEF" },
      tagName,
    });
    const el = renderNode({ ...instance, tagName }, {});
    if (!(el instanceof HTMLElement)) {
      throw new TypeError("an instance renders to an element");
    }
    document.body.append(el);
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    const text = el.querySelector("i")?.textContent ?? "";
    el.remove();
    return text;
  }

  const cases: [string, Omit<JxMutableNode, "tagName">, string][] = [
    ["an attribute that is no DOM property", { attributes: { ribbon: "ATTR" } }, "ribbon"],
    ["the same, in capitals", { attributes: { RIBBON: "ATTR" } }, "ribbon"],
    [
      "the same, beside $props",
      { $props: { ribbon: "PROPS" }, attributes: { ribbon: "ATTR" } },
      "ribbon",
    ],
    [
      "a reflected attribute beside $props",
      { $props: { title: "PROPS" }, attributes: { title: "ATTR" } },
      "title",
    ],
    [
      "a reflected attribute beside a top-level key",
      { attributes: { title: "ATTR" }, title: "TOP" },
      "title",
    ],
    [
      "all three property routes",
      { $props: { title: "PROPS" }, attributes: { title: "ATTR" }, title: "TOP" },
      "title",
    ],
    ["a top-level key beside $props", { $props: { tag: "PROPS" }, tag: "TOP" }, "tag"],
    [
      "the shorthand beside $props",
      { $props: { tag: "PROPS" }, attributes: { "props.tag": "SH" } },
      "tag",
    ],
    ["a capitalised shorthand key", { attributes: { "props.Tag": "SH" } }, "tag"],
    [
      "the shorthand beside a payload",
      { attributes: { "data-jx-props": JSON.stringify({ tag: "PAY" }), "props.tag": "SH" } },
      "tag",
    ],
    ["a payload alone", { attributes: { "data-jx-props": JSON.stringify({ tag: "PAY" }) } }, "tag"],
  ];
  for (const [name, instance, prop] of cases) {
    test(name, async () => {
      const studio = propSource({ ...instance, tagName: "x-card" }, prop)?.value ?? "DEF";
      expect(await drawn(instance, prop)).toBe(String(studio));
    });
  }
});
