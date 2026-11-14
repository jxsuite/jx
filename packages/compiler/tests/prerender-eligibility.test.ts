/**
 * Prerender-eligibility.test.ts — which components ship a module, and what the static renderer
 * draws for the constructs that used to render nothing (compiler.md §8.1), as units.
 */

import { describe, expect, test } from "bun:test";
import { isMappedArray } from "@jxsuite/schema/guards";
import type { JsonValue, JxElement, JxMappedArray } from "@jxsuite/schema/types";
import { compile } from "../src/compiler";
import {
  buildInitialScope,
  computeLiveTags,
  createSlotFill,
  evaluateStaticTemplate,
  isComponentFullyStatic,
  isDynamic,
  isExpandedInstance,
  isLiveComponent,
  isRuntimeOnlyRef,
  orderComponentTags,
  renderMappedRows,
  renderStaticNode,
  renderedComponentTags,
} from "../src/shared";
import { compileElement } from "../src/targets/compile-element";

const li: JxElement = { tagName: "li", textContent: "${$map.item}" };
/** A repeater over a literal array, as a document holds one among its children. */
const repeater = (extra: Record<string, JsonValue> = {}): JxElement => ({
  $prototype: "Array",
  items: ["a", "b"],
  map: li,
  ...extra,
});
/** The same node as the type the renderer takes a repeater as. */
function rows(extra: Record<string, JsonValue> = {}): JxMappedArray {
  const node = repeater(extra);
  if (!isMappedArray(node)) {
    throw new Error("Expected a repeater");
  }
  return node;
}
const registryOf = (...defs: JxElement[]) =>
  new Map(defs.map((def) => [String(def.tagName), def] as const));

describe("isComponentFullyStatic — the constructs only a module can change", () => {
  test("a repeater over a literal array is static, in either position", () => {
    expect(isComponentFullyStatic({ children: rows(), tagName: "x-list" })).toBe(true);
    expect(isComponentFullyStatic({ children: [repeater()], tagName: "x-list" })).toBe(true);
    expect(
      isComponentFullyStatic({ children: [{ $prototype: "Array", items: [] }], tagName: "x-l" }),
    ).toBe(true);
  });

  test.each([
    ["items read from state", { items: { $ref: "#/state/rows" } }],
    ["a filter", { filter: { $ref: "#/state/keep" } }],
    ["a sort", { sort: { $ref: "#/state/order" } }],
    ["a key", { key: "$map/item" }],
    ["a handler in its map", { map: { onclick: { $ref: "#/state/go" }, tagName: "li" } }],
  ])("a repeater with %s is not", (_label, extra) => {
    const def: JxElement = { children: [repeater(extra)], tagName: "x-list" };
    expect(isComponentFullyStatic(def)).toBe(false);
  });

  test("a $switch is not static, whatever its discriminant", () => {
    const def: JxElement = {
      children: [{ $switch: { $ref: "#/state/v" }, cases: { a: { tagName: "p" } } }],
      state: { v: "a" },
      tagName: "x-switch",
    };
    expect(isComponentFullyStatic(def)).toBe(false);
  });

  test("a tag chosen at creation is not static", () => {
    const def: JxElement = {
      children: [
        {
          tagName: {
            $expression: {
              initial: "h3",
              operator: "?:",
              target: { $ref: "#/state/big" },
              value: "h2",
            },
          },
        },
      ],
      state: { big: true },
      tagName: "x-head",
    };
    expect(isComponentFullyStatic(def)).toBe(false);
  });

  test("another pseudo-element is not static", () => {
    const def = { children: [{ $prototype: "Request", url: "/x" }], tagName: "x-req" };
    expect(isComponentFullyStatic(def)).toBe(false);
  });
});

describe("the live set", () => {
  const chip: JxElement = { children: [{ tagName: "b" }], tagName: "x-chip" };
  const icon: JxElement = { tagName: "x-icon" };
  const card: JxElement = {
    children: [
      { tagName: "x-chip" },
      { children: rows({ map: { tagName: "x-icon" } }), tagName: "ul" },
      {
        $switch: { $ref: "#/state/v" },
        cases: { a: { tagName: "x-badge" }, b: { $ref: "./external.json" } },
      },
      {
        tagName: {
          $expression: {
            initial: "x-b",
            operator: "?:",
            target: { $ref: "#/state/v" },
            value: "x-a",
          },
        },
      },
      "text",
    ],
    state: { v: "a" },
    tagName: "x-card",
  };
  const badge: JxElement = { children: [{ tagName: "x-icon" }], tagName: "x-badge" };
  const a: JxElement = { tagName: "x-a" };
  const lone: JxElement = { children: [{ tagName: "x-card" }], tagName: "x-lone" };
  const registry = registryOf(chip, icon, card, badge, a, lone);

  test("renderedComponentTags reads children, both repeater forms, cases and tag candidates", () => {
    expect([...renderedComponentTags(card, registry)].toSorted()).toEqual([
      "x-a",
      "x-badge",
      "x-chip",
      "x-icon",
    ]);
    // The root names the definition itself, and an unregistered tag is not a component.
    expect(renderedComponentTags({ tagName: "x-card" }, registry).size).toBe(0);
    expect(
      [
        ...renderedComponentTags(
          { children: [repeater({ map: { tagName: "x-chip" } })] },
          registry,
        ),
      ].toSorted(),
    ).toEqual(["x-chip"]);
  });

  test("computeLiveTags closes over what a live definition renders", () => {
    // `x-card` is live for its $switch; everything it renders is live with it, transitively.
    // `x-lone` renders a live tag and is not live itself: static-ness is not inherited upward.
    expect([...computeLiveTags(registry)].toSorted()).toEqual([
      "x-a",
      "x-badge",
      "x-card",
      "x-chip",
      "x-icon",
    ]);
  });

  test("computeLiveTags counts what a live definition renders only on a page that draws it", () => {
    // A page that places the chip alone keeps it static: the card is live, but not drawn here.
    const alone = computeLiveTags(registry, { children: [{ tagName: "x-chip" }], tagName: "main" });
    expect([...alone].toSorted()).toEqual(["x-card"]);
    // A page that reaches the card through a static wrapper makes everything it renders live.
    const wrapped = computeLiveTags(registry, {
      children: [{ tagName: "x-lone" }],
      tagName: "main",
    });
    expect([...wrapped].toSorted()).toEqual(["x-a", "x-badge", "x-card", "x-chip", "x-icon"]);
  });

  test("isLiveComponent reads the set, or the definition when there is none", () => {
    const live = computeLiveTags(registry);
    expect(isLiveComponent("x-chip", chip, live)).toBe(true);
    expect(isLiveComponent("x-lone", lone, live)).toBe(false);
    expect(isLiveComponent("x-chip", chip)).toBe(false);
    expect(isLiveComponent("x-card", card)).toBe(true);
  });

  test("orderComponentTags puts a tag after every tag it renders, ties by name", () => {
    expect(
      orderComponentTags(["x-lone", "x-card", "x-icon", "x-chip", "x-badge"], registry),
    ).toEqual(["x-icon", "x-badge", "x-chip", "x-card", "x-lone"]);
    // A tag the page does not load is walked for its edges and left out.
    expect(orderComponentTags(["x-card", "x-icon"], registry)).toEqual(["x-icon", "x-card"]);
    expect(orderComponentTags(["x-ghost"], registry)).toEqual(["x-ghost"]);
  });

  test("orderComponentTags breaks a cycle where it meets it", () => {
    const ping: JxElement = { children: [{ tagName: "x-pong" }], tagName: "x-ping" };
    const pong: JxElement = { children: [{ tagName: "x-ping" }], tagName: "x-pong" };
    expect(orderComponentTags(["x-pong", "x-ping"], registryOf(ping, pong))).toEqual([
      "x-pong",
      "x-ping",
    ]);
  });
});

describe("renderMappedRows", () => {
  test("renders each row in a scope of its own, joined as its ancestors ask", () => {
    const scope = buildInitialScope({ rows: ["a", "b"] });
    const def = rows({ items: { $ref: "#/state/rows" } });
    expect(renderMappedRows(def, scope)).toBe("<li>a</li>\n<li>b</li>");
    expect(renderMappedRows(def, scope, null, null, true)).toBe("<li>a</li><li>b</li>");
    expect(renderMappedRows(rows(), null)).toBe("<li>a</li>\n<li>b</li>");
    // The rows did not leak their frame into the scope they inherit.
    expect(Object.hasOwn(scope, "$map")).toBe(false);
  });

  test("binds the bare item and index only inside a row", () => {
    const def = rows({ map: { tagName: "li", textContent: "${index}=${item}" } });
    expect(renderMappedRows(def, {})).toBe("<li>0=a</li>\n<li>1=b</li>");
    expect(evaluateStaticTemplate("${item}", {})).toBeNull();
    expect(evaluateStaticTemplate("${item}", { $map: ["not", "a", "frame"] })).toBeNull();
  });

  test("applies filter, then sort, as the element's first render does", () => {
    const scope = buildInitialScope({
      byText: {
        $expression: { operator: "-", target: { $ref: "$args/a/n" }, value: { $ref: "$args/b/n" } },
        parameters: ["a", "b"],
      },
      keep: {
        $expression: { operator: ">", target: { $ref: "$args/item/n" }, value: 1 },
        parameters: ["item"],
      },
      rows: [{ n: 3 }, { n: 1 }, { n: 2 }],
    });
    const map = { tagName: "li", textContent: "${$map.index}:${$map.item.n}" };
    const items = { $ref: "#/state/rows" };
    expect(renderMappedRows(rows({ filter: { $ref: "#/state/keep" }, items, map }), scope)).toBe(
      "<li>0:3</li>\n<li>1:2</li>",
    );
    expect(renderMappedRows(rows({ items, map, sort: { $ref: "#/state/byText" } }), scope)).toBe(
      "<li>0:1</li>\n<li>1:2</li>\n<li>2:3</li>",
    );
    expect(
      renderMappedRows(
        rows({ filter: { $ref: "#/state/keep" }, items, map, sort: { $ref: "#/state/byText" } }),
        scope,
      ),
    ).toBe("<li>0:2</li>\n<li>1:3</li>");
    // A source that does not resolve to a function is ignored, as the interpreter ignores it.
    expect(renderMappedRows(rows({ filter: { $ref: "#/state/rows" } }), scope)).toBe(
      "<li>a</li>\n<li>b</li>",
    );
  });

  test("refuses a template string as items", () => {
    expect(() => renderMappedRows(rows({ items: "${state.rows}" }), {})).toThrow(
      "A repeater's items must be a $ref or a literal array",
    );
  });

  test.each([
    ["a filter with no build-time value", { filter: { $ref: "#/state/remote" } }],
    ["a sort with no build-time value", { sort: { $ref: "#/state/remote" } }],
    ["a filter that throws on build-time data", { filter: { $ref: "#/state/deep" } }],
    ["items that are not an array", { items: { $ref: "#/state/label" } }],
    ["items that read nothing", { items: { $ref: "#/state/missing" } }],
    ["items with no build-time value", { items: { $ref: "#/state/feed" } }],
    ["items whose read throws", { items: { $ref: "#/state/boom" } }],
  ])("renders no rows for %s", (_label, extra) => {
    const scope = buildInitialScope({
      boom: { $prototype: "Function", body: "return state.missing.deep.value;" },
      deep: {
        $prototype: "Function",
        body: "return item.missing.deep.value;",
        parameters: ["item"],
      },
      feed: { $prototype: "Request", url: "/api/feed" },
      label: "text",
      // A bodyless `$src` function is a placeholder at build time: it must not filter to nothing.
      remote: { $prototype: "Function", $src: "./lib.js", parameters: ["item"] },
    });
    expect(renderMappedRows(rows(extra), scope)).toBe("");
  });

  test("renders no rows without a map", () => {
    expect(renderMappedRows({ $prototype: "Array", items: ["a"] }, {})).toBe("");
  });

  test("a repeater among an instance's children is slot content, rendered by the caller", () => {
    const fill = createSlotFill(rows(), {}, (child) => renderStaticNode(child, {}));
    expect(fill.groups.get("")).toEqual({ content: true, html: "<li>a</li>\n<li>b</li>" });
  });
});

describe("renderStaticNode — state with no build-time value", () => {
  const held = buildInitialScope({ feed: { $prototype: "Request", url: "/api/feed" } });

  test("isRuntimeOnlyRef reads the first token of a state pointer", () => {
    expect(isRuntimeOnlyRef("#/state/feed", held)).toBe(true);
    expect(isRuntimeOnlyRef("#/state/feed/items/0", held)).toBe(true);
    expect(isRuntimeOnlyRef("#/state/other", held)).toBe(false);
    expect(isRuntimeOnlyRef("$map/item", held)).toBe(false);
    const slashed = buildInitialScope({ "a/b": { $prototype: "Request", url: "/x" } });
    expect(isRuntimeOnlyRef("#/state/a~1b", slashed)).toBe(true);
  });

  test("a $switch over it renders the empty container", () => {
    const node = {
      $switch: { $ref: "#/state/feed" },
      cases: { undefined: { tagName: "p", textContent: "never" } },
      tagName: "section",
    };
    expect(renderStaticNode(node, held)).toBe("<section></section>");
    expect(renderStaticNode(node, null)).toBe("<section></section>");
  });

  test("a text child that resolves to nothing keeps its source on a page, not in a component", () => {
    const context = { componentDefs: new Map<string, JxElement>() };
    expect(renderStaticNode("late ${state.feed}", held)).toBe("late ${state.feed}");
    expect(renderStaticNode("late ${state.feed}", held, null, context)).toBe("");
  });

  test("a preformatted subtree joins nested arrays with nothing too", () => {
    const children = [["a", "b"], { tagName: "i", textContent: "c" }];
    expect(renderStaticNode(children, {}, null, null, true)).toBe("ab<i>c</i>");
    expect(renderStaticNode(children, {})).toBe("a\nb\n<i>c</i>");
  });
});

describe("an expanded instance's markup is finished HTML", () => {
  const sample = "<code>${state.zzz} stays</code>";

  test("isExpandedInstance reads either stamp", () => {
    expect(isExpandedInstance({ $static: true })).toBe(true);
    expect(isExpandedInstance({ $prerendered: true })).toBe(true);
    expect(isExpandedInstance({ innerHTML: sample })).toBe(false);
  });

  test("its `${` does not make the page dynamic", () => {
    expect(isDynamic({ $static: true, innerHTML: sample, tagName: "x-code" })).toBe(false);
    expect(isDynamic({ innerHTML: sample, tagName: "div" })).toBe(true);
  });

  test("the static target writes it as it stands", async () => {
    const { html } = await compile({
      children: [{ $static: true, innerHTML: sample, tagName: "x-code" }],
      tagName: "main",
    });
    expect(html).toContain(`<x-code data-jx-static>${sample}</x-code>`);
  });

  test("the client target writes it as it stands", async () => {
    const { html } = await compile({
      children: [
        { $prerendered: true, innerHTML: sample, tagName: "x-code" },
        { tagName: "p", textContent: "n=${state.n}" },
      ],
      state: { n: 1 },
      tagName: "main",
    });
    expect(html).toContain(`<x-code data-jx-prerendered>${sample}</x-code>`);
  });
});

describe("compileElement — a repeater's items", () => {
  const moduleOf = async (items: JsonValue) => {
    const { files } = await compileElement({
      children: [{ children: [repeater({ items })], tagName: "ul" }],
      state: { rows: ["a"] },
      tagName: "x-rows",
    });
    return files[0]!.content;
  };

  test("a literal array is written as JSON", async () => {
    const source = await moduleOf(["a", "b"]);
    expect(source).toContain('${["a","b"].map(');
    expect(source).not.toContain("ITEMS");
  });

  test("a pointer that reads nothing is an empty list", async () => {
    expect(await moduleOf({ $ref: "#/state/rows" })).toContain("${(s.rows ?? []).map(");
  });

  test("anything else is an empty list", async () => {
    expect(await moduleOf("nope")).toContain("${[].map(");
  });

  test("a template string is refused", async () => {
    let message = "";
    try {
      await moduleOf("${state.rows}");
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("not the template string");
  });
});
