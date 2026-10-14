/** State gaps — the array-recursion branch of normalizeArrayChildren, uncovered by state.test.ts. */
import { describe, expect, test } from "bun:test";
import { normalizeArrayChildren } from "../src/state";
import type { JxMutableNode } from "@jxsuite/schema/types";

describe("normalizeArrayChildren", () => {
  test("recurses through a top-level array of nodes", () => {
    const legacy: JxMutableNode = {
      children: { $prototype: "Array", items: [1], map: { tagName: "li" } },
      tagName: "ul",
    };
    const list: JxMutableNode[] = [legacy, { tagName: "p" }];

    const result = normalizeArrayChildren(list);
    expect(result).toBe(list);
    // The legacy whole-children repeater became a single member of a children array.
    expect(legacy.children).toEqual([{ $prototype: "Array", items: [1], map: { tagName: "li" } }]);
  });

  test("passes primitives through untouched", () => {
    expect(normalizeArrayChildren("text")).toBe("text");
    expect(normalizeArrayChildren(null)).toBeNull();
  });
});
