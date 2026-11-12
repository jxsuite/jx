/**
 * Which case of a `$switch` the canvas draws (src/canvas/switch-cases.ts, studio.md §4.5): the
 * render document is rebuilt with the chosen case, and the tab's own document is never written.
 */
import { describe, expect, test } from "bun:test";
import { switchCaseNames, withSwitchCases } from "../src/canvas/switch-cases";

import { getNodeAtPath } from "../src/state";

import type { JxMutableNode } from "@jxsuite/schema/types";

/** A document with a `$switch` at `["children", 1]` reading `state.tab`. */
function tabsDoc(): JxMutableNode {
  return {
    children: [
      { tagName: "h1", textContent: "Tabs" },
      {
        $switch: { $ref: "#/state/tab" },
        cases: {
          one: { tagName: "p", textContent: "First" },
          two: {
            $switch: { $ref: "#/state/inner" },
            cases: { a: { tagName: "i" }, b: { tagName: "b" } },
            tagName: "div",
          },
        },
        tagName: "section",
      },
    ],
    state: { inner: "a", tab: "one" },
    tagName: "main",
  };
}

describe("switchCaseNames", () => {
  test("a switch's cases, in the order it writes them, and none for anything else", () => {
    const doc = tabsDoc();
    expect(switchCaseNames(getNodeAtPath(doc, ["children", 1]))).toEqual(["one", "two"]);
    expect(switchCaseNames(getNodeAtPath(doc, ["children", 0]))).toEqual([]);
    expect(switchCaseNames({ $switch: { $ref: "#/state/x" }, tagName: "div" })).toEqual([]);
    expect(switchCaseNames("text")).toEqual([]);
    expect(switchCaseNames(null)).toEqual([]);
  });
});

describe("withSwitchCases", () => {
  test("nothing chosen is the document itself", () => {
    const doc = tabsDoc();
    const switched = withSwitchCases(doc, {});
    expect(switched.doc).toBe(doc);
    expect(switched.state).toEqual({});
  });

  test("a chosen case is read from a value of its own, and the document is not written", () => {
    const doc = tabsDoc();
    const before = JSON.stringify(doc);
    const { doc: next, state } = withSwitchCases(doc, { [JSON.stringify(["children", 1])]: "two" });
    expect(JSON.stringify(doc)).toBe(before);
    expect(state).toEqual({ "$__case:0": { default: "two" } });
    const node = getNodeAtPath(next, ["children", 1]);
    expect(node?.$switch).toEqual({ $ref: "#/state/$__case:0" });
    // Everything off the way to the switch is shared, so the rebuild costs one path.
    expect(getNodeAtPath(next, ["children", 0])).toBe(getNodeAtPath(doc, ["children", 0]));
    expect(node?.cases).toBe(getNodeAtPath(doc, ["children", 1])?.cases);
  });

  test("a switch inside another's case is chosen by its own path", () => {
    const doc = tabsDoc();
    const inner = ["children", 1, "cases", "two"];
    const { doc: next, state } = withSwitchCases(doc, {
      [JSON.stringify(["children", 1])]: "two",
      [JSON.stringify(inner)]: "b",
    });
    expect(state).toEqual({ "$__case:0": { default: "two" }, "$__case:1": { default: "b" } });
    expect(getNodeAtPath(next, inner)?.$switch).toEqual({ $ref: "#/state/$__case:1" });
  });

  test("a choice that names nothing leaves the switch drawing its own case", () => {
    const doc = tabsDoc();
    const choices = {
      [JSON.stringify(["children", 0])]: "one",
      [JSON.stringify(["children", 1])]: "gone",
      [JSON.stringify(["children", 7, "x"])]: "one",
      "not json": "one",
    };
    const switched = withSwitchCases(doc, choices);
    expect(switched.doc).toBe(doc);
    expect(switched.state).toEqual({});
  });

  test("a switch whose discriminant is not a reference is left alone", () => {
    const doc: JxMutableNode = {
      children: [{ $switch: "${state.tab}", cases: { one: { tagName: "p" } }, tagName: "div" }],
      tagName: "main",
    };
    expect(withSwitchCases(doc, { [JSON.stringify(["children", 0])]: "one" }).doc).toBe(doc);
  });
});
