/**
 * Component props — prop-entry derivation from a component doc's state (the CEM "field" subset) and
 * the component-doc gate. The values a component is drawn with are state values set for the canvas
 * (`state-values.test.ts`).
 */
import { describe, expect, test } from "bun:test";
import { componentPropEntries, isComponentDoc } from "../src/component-props";

import type { JxMutableNode } from "@jxsuite/schema/types";

describe("isComponentDoc", () => {
  test("a custom-element root is a component doc; pages and fragments are not", () => {
    expect(isComponentDoc({ tagName: "x-card" })).toBe(true);
    expect(isComponentDoc({ tagName: "div" })).toBe(false);
    expect(isComponentDoc({})).toBe(false);
    expect(isComponentDoc(null)).toBe(false);
  });
});

describe("componentPropEntries", () => {
  test("derives plain-data entries with their defaults, skipping behavior and private keys", () => {
    const doc: JxMutableNode = {
      state: {
        "#secret": "hidden",
        computedTitle: "${state.title}",
        count: { default: 3, type: "number" },
        fetcher: { $prototype: "Request", url: "/x" },
        greet: { $prototype: "Function", body: "" },
        legend: { max: 10, type: "number" },
        summary: { $expression: { operator: "+", target: 1, value: 1 } },
        tags: ["a", "b"],
        title: "Hello",
        total: { $compute: "1 + 1" },
      },
      tagName: "x-card",
    };
    expect(componentPropEntries(doc)).toEqual([
      { name: "count", value: 3 },
      { name: "legend", value: undefined },
      { name: "tags", value: ["a", "b"] },
      { name: "title", value: "Hello" },
    ]);
  });

  test("an empty/missing state yields no entries", () => {
    expect(componentPropEntries({ tagName: "x-card" })).toEqual([]);
    expect(componentPropEntries(null)).toEqual([]);
  });
});
