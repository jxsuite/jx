/**
 * What a component's live preview is drawn with (src/browse/component-examples.ts): its declared
 * examples, and nothing borrowed from the rest of the project.
 */
import { describe, expect, test } from "bun:test";
import { componentExampleProps, isLiteralProp } from "../src/browse/component-examples";
import type { JxDocument } from "@jxsuite/schema/types";

const CARD: JxDocument = {
  state: {
    "#cache": { default: "", examples: ["private"] },
    date: { default: "", examples: ["2026-06-20"], type: "string" },
    hue: 214,
    link: { default: "", examples: ["${item.url}"], type: "string" },
    title: "",
  },
  tagName: "mu-card",
};

describe("isLiteralProp", () => {
  test("plain data is literal; a template, a binding or a source is not", () => {
    expect(isLiteralProp("Harbour")).toBe(true);
    expect(isLiteralProp(3)).toBe(true);
    expect(isLiteralProp(["a", { b: 1 }])).toBe(true);
    expect(isLiteralProp("${item.title}")).toBe(false);
    expect(isLiteralProp({ $ref: "#/state/x" })).toBe(false);
    expect(isLiteralProp([{ $expression: { operator: "!", target: true } }])).toBe(false);
    expect(isLiteralProp({ $prototype: "Request" })).toBe(false);
    expect(isLiteralProp(CARD.state?.missing)).toBe(false);
  });
});

describe("componentExampleProps", () => {
  test("the first literal example of each public typed entry", () => {
    expect([...componentExampleProps(CARD)]).toEqual([["date", "2026-06-20"]]);
  });

  test("a definition with no examples gives no props", () => {
    expect(componentExampleProps({ tagName: "x-bare" }).size).toBe(0);
  });
});
