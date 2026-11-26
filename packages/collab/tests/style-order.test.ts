import { describe, expect, test } from "bun:test";
import { isJsonObject } from "@jxsuite/schema/guards";
import { canonicalStyle, canonicalStyleKeys } from "../src/style-order.ts";

describe("canonicalStyleKeys", () => {
  test("puts border-color before border-bottom-color, whichever was written first", () => {
    expect(canonicalStyleKeys({ "border-color": "red", "border-bottom-color": "blue" })).toEqual([
      "border-color",
      "border-bottom-color",
    ]);
    expect(canonicalStyleKeys({ "border-bottom-color": "blue", "border-color": "red" })).toEqual([
      "border-color",
      "border-bottom-color",
    ]);
  });

  test("orders a chain through an intermediate shorthand, absent or present", () => {
    expect(canonicalStyleKeys({ "border-bottom-color": "a", border: "b" })).toEqual([
      "border",
      "border-bottom-color",
    ]);
    expect(
      canonicalStyleKeys({ "border-bottom-color": "a", "border-color": "b", border: "c" }),
    ).toEqual(["border", "border-color", "border-bottom-color"]);
  });

  test("breaks every other tie by name, and sorts a longhand's place among unrelated keys", () => {
    expect(
      canonicalStyleKeys({ width: "1", "margin-left": "0", margin: "1em", color: "red" }),
    ).toEqual(["color", "margin", "margin-left", "width"]);
  });

  test("reads camelCase keys as their kebab-case properties", () => {
    expect(canonicalStyleKeys({ marginLeft: "0", margin: "1em", borderBottomColor: "a" })).toEqual([
      "borderBottomColor",
      "margin",
      "marginLeft",
    ]);
    expect(
      canonicalStyleKeys({ webkitMaskImage: "x", maskImage: "y", WebkitMask: "z" }),
    ).toHaveLength(3);
  });

  test("keeps custom properties and unknown keys in name order", () => {
    expect(canonicalStyleKeys({ "--b": "1", "--a": "2", zzz: "3" })).toEqual(["--a", "--b", "zzz"]);
  });

  test("puts nested blocks after the declarations, by key name, and skips cleared keys", () => {
    expect(
      canonicalStyleKeys({
        "&:hover": { color: "a" },
        "& a": { color: "b" },
        width: "1",
        gone: undefined,
      }),
    ).toEqual(["width", "& a", "&:hover"]);
  });

  test("is a function of the key set alone", () => {
    const keys = [
      "margin",
      "marginTop",
      "padding",
      "paddingLeft",
      "padding-left",
      "color",
      "&:hover",
    ];
    const block = (order: string[]) =>
      Object.fromEntries(order.map((key) => [key, key.startsWith("&") ? { a: "1" } : "1"]));
    const expected = canonicalStyleKeys(block(keys));
    for (let i = 0; i < keys.length; i++) {
      const rotated = [...keys.slice(i), ...keys.slice(0, i)].toReversed();
      expect(canonicalStyleKeys(block(rotated))).toEqual(expected);
    }
  });
});

describe("canonicalStyle", () => {
  test("canonicalizes nested blocks at every depth", () => {
    const style = canonicalStyle({
      "&:hover": { marginLeft: "0", margin: "1em", "& b": { y: "1", x: "2" } },
      color: "red",
    });
    expect(Object.keys(style)).toEqual(["color", "&:hover"]);
    expect(JSON.stringify(style)).toBe(
      '{"color":"red","&:hover":{"margin":"1em","marginLeft":"0","& b":{"x":"2","y":"1"}}}',
    );
  });
});

describe("breakpoint blocks follow $media order", () => {
  const media = ["--sm", "--md", "--lg", "--dark"];
  test("a pair setting the same property keeps the authored order", () => {
    const style = canonicalStyle(
      { "@--md": { fontSize: "2rem" }, fontSize: "1rem", "@--sm": { fontSize: "1.5rem" } },
      media,
    );
    expect(Object.keys(style)).toEqual(["fontSize", "@--sm", "@--md"]);
  });
  test("no $media falls back to name order", () => {
    const block = { "@--sm": { a: "1" }, "@--md": { a: "2" }, "@--dark": { a: "3" } };
    expect(Object.keys(canonicalStyle(block))).toEqual(["@--dark", "@--md", "@--sm"]);
    expect(Object.keys(canonicalStyle(block, []))).toEqual(["@--dark", "@--md", "@--sm"]);
  });
  test("@--dark is ordered by $media when listed, and by name after the listed keys when not", () => {
    const block = { "@--dark": { a: "1" }, "@--lg": { a: "2" }, "@--sm": { a: "3" } };
    expect(Object.keys(canonicalStyle(block, ["--sm", "--dark", "--lg"]))).toEqual([
      "@--sm",
      "@--dark",
      "@--lg",
    ]);
    expect(Object.keys(canonicalStyle(block, ["--lg", "--sm"]))).toEqual([
      "@--lg",
      "@--sm",
      "@--dark",
    ]);
  });
  test("selectors keep name order and stay out of the breakpoint run, at every depth", () => {
    const style = canonicalStyle(
      { "@--md": { "@--sm": { a: "1" }, "@--md": { a: "2" } }, "&:hover": { a: "1" }, "@--sm": {} },
      media,
    );
    expect(Object.keys(style)).toEqual(["&:hover", "@--sm", "@--md"]);
    const inner = style["@--md"];
    expect(isJsonObject(inner) ? Object.keys(inner) : []).toEqual(["@--sm", "@--md"]);
  });
});
