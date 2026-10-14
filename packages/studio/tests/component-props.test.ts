/**
 * Component test props (M6) — prop-entry derivation from a component doc's state (the CEM "field"
 * subset), the pure render-doc substitution that seeds chosen values, and the component-doc gate.
 */
import { describe, expect, test } from "bun:test";
import {
  componentPropEntries,
  isComponentDoc,
  substitutePreviewProps,
} from "../src/component-props";

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

describe("substitutePreviewProps", () => {
  const DOC: JxMutableNode = {
    children: [],
    state: {
      count: { default: 3, type: "number" },
      greet: { $prototype: "Function", body: "" },
      title: "Hello",
    },
    tagName: "x-card",
  };

  test("seeds literals directly and signal defs through `default`, leaving the source intact", () => {
    const seeded = substitutePreviewProps(DOC, { count: 7, title: "Test" });
    expect(seeded.state?.title).toBe("Test");
    expect(seeded.state?.count).toEqual({ default: 7, type: "number" });
    // Pure rebuild: the source doc's state is untouched (it is what gets edited and saved).
    expect(DOC.state?.title).toBe("Hello");
    expect(DOC.state?.count).toEqual({ default: 3, type: "number" });
    expect(seeded).not.toBe(DOC);
  });

  test("never overrides behavioral or unknown entries (stale test values are dropped)", () => {
    const seeded = substitutePreviewProps(DOC, { gone: "x", greet: "nope" });
    // Nothing seedable → the doc is returned as-is (no pointless rebuild).
    expect(seeded).toBe(DOC);
  });
});
