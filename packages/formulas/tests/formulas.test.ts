import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { describe, expect, test } from "bun:test";
import { compileExpression, evaluateExpression } from "@jxsuite/runtime/expression";
import { isString } from "@jxsuite/schema/guards";
import { catalog, formulaEntries } from "../src/index.ts";

import type { JsonObject, JsonValue, JxExpressionOperand } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  // Already registered
}

/** A formula argument: a JSON literal operand, or `undefined` for an argument passed as missing. */
type FormulaArgument = JxExpressionOperand | undefined;

/**
 * Invoke a catalog formula by name through the call operator against its state entry, and check the
 * result.
 */
function expectFormulaResult(name: string, args: FormulaArgument[], expected: JsonValue): void {
  /* SAFETY: the call operator resolves each argument through resolveOperand, which accepts
     `JxExpressionOperand | undefined` and returns an `undefined` operand unchanged, so an
     `undefined` slot reaches the formula's $args binding exactly as an explicit undefined would. */
  const operands = args as JxExpressionOperand[];
  const result = evaluateExpression(
    { operator: "call", target: { $ref: `#/state/${name}` }, value: operands },
    formulaEntries(),
    null,
  );
  expect(result).toEqual(expected);
}

describe("catalog integrity", () => {
  test("21 formulas, each named, described, and parameterized", () => {
    expect(catalog.length).toBe(21);
    for (const formula of catalog) {
      expect(formula.name.length).toBeGreaterThan(0);
      expect(formula.description.length).toBeGreaterThan(10);
      expect(formula.parameters.length).toBeGreaterThan(0);
    }
  });

  test("formulaEntries produces named-formula state entries", () => {
    const entries = formulaEntries();
    expect(Object.keys(entries).length).toBe(21);
    expect(entries.clamp!.parameters!.length).toBe(3);
    expect(entries.clamp!.$expression.operator).toBe("call");
  });
});

describe("formula behavior (interpreted)", () => {
  const cases: [string, FormulaArgument[], JsonValue][] = [
    ["clamp", [15, 0, 10], 10],
    ["clamp", [-5, 0, 10], 0],
    ["clamp", [7, 0, 10], 7],
    ["sum", [[1, 2, 3, 4]], 10],
    ["sum", [[]], 0],
    ["average", [[2, 4, 6]], 4],
    ["average", [[]], 0],
    ["count", [[1, 2, 3]], 3],
    ["count", ["hello"], 5],
    ["count", [undefined], 0],
    ["min", [[5, 2, 9]], 2],
    ["max", [[5, 2, 9]], 9],
    ["first", [[7, 8]], 7],
    ["first", [[]], null],
    ["last", [[7, 8]], 8],
    ["isEmpty", [[]], true],
    ["isEmpty", [[1]], false],
    ["isEmpty", [""], true],
    ["isEmpty", [undefined], true],
    ["compact", [[0, 1, "", "a", null, 2]], [1, "a", 2]],
    ["percent", [1, 4], 25],
    ["percent", [1, 0], 0],
    ["roundTo", [1.23456, 2], 1.23],
    ["roundTo", [1.23456], 1],
    ["capitalize", ["ada"], "Ada"],
    ["truncate", ["hello world", 5], "hello…"],
    ["truncate", ["hi", 5], "hi"],
    ["initials", ["ada lovelace"], "AL"],
    ["formatDate", ["2026-08-16T02:00:00Z", { dateStyle: "long" }], "August 16, 2026"],
    ["formatDate", ["2026-08-16T02:00:00Z"], "8/16/2026"],
    ["formatDate", [1_786_845_600_000, { month: "short", year: "numeric" }], "Aug 2026"],
    ["formatDate", [null, { dateStyle: "long" }], ""],
    ["formatDate", [undefined], ""],
    ["formatDate", [""], ""],
    ["formatNumber", [1234.5], "1,234.5"],
    ["formatNumber", [0], "0"],
    ["formatNumber", [0.256, { style: "percent" }], "26%"],
    ["formatNumber", [12, { currency: "USD", style: "currency" }], "$12.00"],
    ["formatNumber", [null], ""],
    ["formatNumber", [""], ""],
    ["relativeTime", [-3, "day"], "3 days ago"],
    ["relativeTime", [2], "in 2 days"],
    ["relativeTime", [0, "hour"], "in 0 hours"],
    ["relativeTime", [null, "day"], ""],
    ["notEmpty", [null], false],
    ["notEmpty", [undefined], false],
    ["notEmpty", [""], false],
    ["notEmpty", ["0"], false],
    ["notEmpty", [0], false],
    ["notEmpty", [false], false],
    ["notEmpty", [[]], false],
    ["notEmpty", ["a"], true],
    ["notEmpty", ["00"], true],
    ["notEmpty", [" "], true],
    ["notEmpty", [1], true],
    ["notEmpty", [true], true],
    ["notEmpty", [[0]], true],
    ["notEmpty", [{}], true],
    ["orBlank", ["0"], ""],
    ["orBlank", [0], ""],
    ["orBlank", [false], ""],
    ["orBlank", [null], ""],
    ["orBlank", [undefined], ""],
    ["orBlank", [""], ""],
    ["orBlank", ["a"], "a"],
    ["orBlank", [5], 5],
    ["orBlank", [["x"]], ["x"]],
    [
      "escapeHtml",
      [`<a href="x">Tom & 'Jerry'</a>`],
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
    ],
    ["escapeHtml", ["&amp;"], "&amp;amp;"],
    ["escapeHtml", [null], ""],
    ["escapeHtml", [undefined], ""],
    ["escapeHtml", [5], "5"],
  ];

  for (const [name, args, expected] of cases) {
    test(`${name}(${JSON.stringify(args).slice(1, -1)}) → ${JSON.stringify(expected)}`, () => {
      expectFormulaResult(name, args, expected);
    });
  }
});

describe("the Intl formulas follow the page", () => {
  /** Call a formula in a scope that has a page, as a template on that page does. */
  function onPage(locale: string, name: string, args: JxExpressionOperand[]): JsonValue {
    /* SAFETY: an Intl formula returns the string its formatter wrote. */
    return evaluateExpression(
      { operator: "call", target: { $ref: `#/state/${name}` }, value: args },
      { ...formulaEntries(), $page: { locale } },
      null,
    ) as JsonValue;
  }

  test("formatDate writes the page's language, with no locale named", () => {
    expect(onPage("fr", "formatDate", ["2026-08-16T02:00:00Z", { dateStyle: "long" }])).toBe(
      "16 août 2026",
    );
  });

  test("formatDate reads the day in UTC unless the options name a zone", () => {
    const late = "2026-08-16T02:00:00Z";
    expect(onPage("en-US", "formatDate", [late, { dateStyle: "short" }])).toBe("8/16/26");
    expect(
      onPage("en-US", "formatDate", [late, { dateStyle: "short", timeZone: "America/New_York" }]),
    ).toBe("8/15/26");
  });

  test("formatNumber and relativeTime do too", () => {
    expect(onPage("de", "formatNumber", [1234.5])).toBe("1.234,5");
    expect(onPage("de", "relativeTime", [-3, "day"])).toBe("vor 3 Tagen");
  });
});

describe("parameters a widget can be built from", () => {
  /** The JSON Schema half of a parameter's declared type, by formula and parameter name. */
  function declaredType(formula: string, parameter: string): JsonValue {
    const entry = catalog.find((candidate) => candidate.name === formula);
    const found = entry?.parameters.find(
      (candidate) => !isString(candidate) && candidate.name === parameter,
    );
    if (found === undefined || isString(found) || found.type === undefined) {
      throw new Error(`${formula}.${parameter} declares no type`);
    }
    /* SAFETY: the catalog is JSON, so a declared type is a JSON value. */
    return found.type as JsonValue;
  }

  test("formatDate's options name the styles as enums", () => {
    expect(declaredType("formatDate", "options")).toMatchObject({
      properties: {
        dateStyle: { enum: ["full", "long", "medium", "short"] },
        timeStyle: { enum: ["full", "long", "medium", "short"] },
      },
      text: "Intl.DateTimeFormatOptions",
      type: "object",
    });
  });

  test("formatNumber's options and relativeTime's unit are typed", () => {
    expect(declaredType("formatNumber", "options")).toMatchObject({
      properties: { style: { enum: ["decimal", "currency", "percent", "unit"] } },
      type: "object",
    });
    expect(declaredType("relativeTime", "unit")).toMatchObject({
      enum: ["year", "quarter", "month", "week", "day", "hour", "minute", "second"],
      type: "string",
    });
  });
});

describe("formula bodies compile — compiled === interpreted", () => {
  const samples = {
    average: { values: [2, 4, 6] },
    capitalize: { text: "ada" },
    clamp: { max: 10, min: 0, value: 15 },
    escapeHtml: { text: `<b title="x">a & 'b'</b>` },
    formatDate: { options: { dateStyle: "long" }, value: "2026-08-16T02:00:00Z" },
    formatNumber: { options: { style: "percent" }, value: 0.256 },
    initials: { name: "ada lovelace" },
    notEmpty: { value: "0" },
    orBlank: { value: "0" },
    relativeTime: { unit: "day", value: -3 },
    sum: { values: [1, 2, 3] },
    truncate: { length: 5, text: "hello world" },
  } satisfies Record<string, JsonObject>;

  for (const [name, args] of Object.entries(samples)) {
    test(name, () => {
      const formula = catalog.find((f) => f.name === name)!;
      const source = compileExpression(formula.expression);
      const fn = new Function("state", "_args", `return ${source}`);
      const interpreted = evaluateExpression(formula.expression, {}, null, { args });
      expect(fn({}, args)).toEqual(interpreted);
    });
  }
});
