import { expect, test, describe } from "bun:test";
import { findTemplateExpressions } from "../src/editor/inline-format.js";

describe("findTemplateExpressions", () => {
  test("no expressions", () => {
    expect(findTemplateExpressions("hello world")).toEqual([]);
  });

  test("single expression", () => {
    expect(findTemplateExpressions("hello ${name} world")).toEqual([{ start: 6, end: 13 }]);
  });

  test("expression at start", () => {
    expect(findTemplateExpressions("${x} rest")).toEqual([{ start: 0, end: 4 }]);
  });

  test("expression at end", () => {
    expect(findTemplateExpressions("rest ${x}")).toEqual([{ start: 5, end: 9 }]);
  });

  test("multiple expressions", () => {
    expect(findTemplateExpressions("a ${b} c ${d} e")).toEqual([
      { start: 2, end: 6 },
      { start: 9, end: 13 },
    ]);
  });

  test("nested braces", () => {
    expect(findTemplateExpressions("${obj.map(x => {x})}")).toEqual([{ start: 0, end: 20 }]);
  });

  test("adjacent expressions", () => {
    expect(findTemplateExpressions("${a}${b}")).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 8 },
    ]);
  });

  test("dollar without brace is not an expression", () => {
    expect(findTemplateExpressions("$100 and ${x}")).toEqual([{ start: 9, end: 13 }]);
  });

  test("unclosed expression is ignored", () => {
    expect(findTemplateExpressions("${unclosed")).toEqual([]);
  });
});
