/**
 * Client-switch.test.ts — `$switch` on a dynamic page (issue #127).
 *
 * `buildClientNode` had no `$switch` branch at all, so the node fell through to the generic element
 * path: a container was emitted and then `children` was looked for to recurse into. `cases` is not
 * `children`, so the subtree was never visited and the page compiled to `<div><div></div></div>`
 * with no binding — no error, no warning, content missing. The same node through the element target
 * emitted both branches correctly, so this was one construct with two implementations and one of
 * them missing.
 *
 * Every assertion here is on branch CONTENT: the tests that existed passed against a target that
 * emitted neither branch, which is why this went unnoticed.
 */

import { describe, expect, test } from "bun:test";
import { compileClient } from "../src/targets/compile-client";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

const SWITCH_NODE: JxElement = {
  $switch: { $ref: "#/state/mode" },
  cases: {
    a: { tagName: "p", textContent: "AAA-BRANCH" },
    b: { tagName: "p", textContent: "BBB-BRANCH" },
  },
};

const DOC: JxDocument = {
  children: [SWITCH_NODE],
  state: { mode: "a" },
  tagName: "div",
};

const compile = (doc: JxDocument = DOC) => compileClient(doc, { modulePath: "app.js", title: "t" });

const moduleOf = (r: { files: { content: string }[] }) => r.files[0]?.content ?? "";

describe("compileClient — $switch", () => {
  test("emits every branch's content", () => {
    const js = moduleOf(compile());

    expect(js).toContain("AAA-BRANCH");
    expect(js).toContain("BBB-BRANCH");
  });

  test("binds the container rather than emitting an empty div", () => {
    const { html } = compile();

    expect(html).toContain("data-bind");
    expect(html).toMatch(/:render="_sw0"/);
  });

  test("keys the lookup on the discriminant", () => {
    expect(moduleOf(compile())).toContain("[String(state.mode)]");
  });

  test("falls back to an empty template for an unmatched key", () => {
    // A discriminant with no matching case renders nothing rather than throwing on `undefined`.
    expect(moduleOf(compile())).toContain("?? html``");
  });

  test("accepts a template-string discriminant", () => {
    const js = moduleOf(
      compile({ ...DOC, children: [{ ...SWITCH_NODE, $switch: "${state.mode}" }] }),
    );

    expect(js).toContain("[String(`${state.mode}`)]");
  });

  test("skips an external $ref case it cannot fetch at compile time", () => {
    const js = moduleOf(
      compile({
        ...DOC,
        children: [
          {
            ...SWITCH_NODE,
            cases: { a: { tagName: "p", textContent: "AAA-BRANCH" }, b: { $ref: "./other.json" } },
          },
        ],
      }),
    );

    expect(js).toContain("AAA-BRANCH");
    expect(js).not.toContain("other.json");
  });

  test("imports lit-html, which the binding needs", () => {
    expect(moduleOf(compile())).toContain("lit-html");
  });
});

describe("compileClient — $switch inside a lit region", () => {
  const rowSwitch: JxElement = {
    $switch: { $ref: "$map/item/kind" },
    cases: {
      a: { tagName: "b", textContent: "ROW-A-BRANCH" },
      b: { tagName: "i", textContent: "ROW-B-BRANCH" },
    },
    tagName: "li",
  };
  const listOf = (map: JxElement): JxElement => ({
    $prototype: "Array",
    items: { $ref: "#/state/rows" },
    map,
  });

  test("renders a switch in a mapped row's template, keyed on the row", () => {
    const js = moduleOf(
      compile({ children: [listOf(rowSwitch)], state: { rows: [] }, tagName: "ul" }),
    );

    expect(js).toContain("ROW-A-BRANCH");
    expect(js).toContain("ROW-B-BRANCH");
    expect(js).toContain("[String(item.kind)]");
  });

  test("renders a switch nested in another switch's case", () => {
    const js = moduleOf(
      compile({
        children: [
          {
            ...SWITCH_NODE,
            cases: {
              a: { ...SWITCH_NODE, cases: { a: { tagName: "p", textContent: "INNER-CASE-TEXT" } } },
            },
          },
        ],
        state: { mode: "a" },
        tagName: "div",
      }),
    );

    expect(js).toContain("INNER-CASE-TEXT");
  });

  test("renders a switch beside a mapped array among an element's children", () => {
    const js = moduleOf(
      compile({
        children: [listOf({ tagName: "li", textContent: "row" }), SWITCH_NODE],
        state: { mode: "a", rows: [] },
        tagName: "div",
      }),
    );

    expect(js).toContain("AAA-BRANCH");
    expect(js).toContain("BBB-BRANCH");
  });

  test("a row's switch with no matching key renders nothing", () => {
    const js = moduleOf(
      compile({ children: [listOf(rowSwitch)], state: { rows: [] }, tagName: "ul" }),
    );

    expect(js).toContain("[String(item.kind)] ?? html``");
  });

  test("a row's switch accepts a template-string discriminant", () => {
    const js = moduleOf(
      compile({
        children: [listOf({ ...rowSwitch, $switch: "${$map.item.kind}" })],
        state: { rows: [] },
        tagName: "ul",
      }),
    );

    expect(js).toContain("[String(`${item.kind}`)]");
  });
});
