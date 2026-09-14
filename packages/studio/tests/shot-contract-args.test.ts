/**
 * `scripts/check-shot-contract.ts`'s `validateArgs` against the runtime's `coerceArgs` — the three
 * gaps issue 333 names, closed.
 *
 * The static check runs in the `checks` job over every manifest step; the runtime pass runs in
 * `registry.run` before the capture's command is entered. "A step that passes the static check
 * passes runtime coercion by construction" had three exceptions — the empty string, the bounds, and
 * `oneOf` — and the sweep in `tests/command-args.test.ts` over the real manifest was the only thing
 * standing in for them. These tests pin each rule by its fragment, then sweep a table of values
 * through BOTH passes and assert they agree on every one, so a fourth gap opens here rather than in
 * a capture.
 */
import { describe, expect, test } from "bun:test";
import { validateArgs } from "../../../scripts/check-shot-contract";
import {
  argsSchema,
  coerceArgs,
  enumProperty,
  numberProperty,
  pathListProperty,
  pathProperty,
  stringProperty,
} from "../src/commands/command-args";

/** `validateArgs` over one property, so a case reads as the property and the value. */
function issue(property: object, value: unknown): string[] {
  return validateArgs({ properties: { v: property } }, { v: value });
}

describe("the empty string", () => {
  test("is refused for a bare string, as stringArg refuses it", () => {
    expect(issue(stringProperty("d"), "")).toEqual([
      'with v ""; its args schema declares a non-empty string',
    ]);
    expect(issue(stringProperty("d"), "x")).toEqual([]);
  });

  test("is admitted by a type list, as typedArg admits it", () => {
    // `canvas.setBreakpoint`'s `media` is `["string", "null"]`; the runtime reads it with
    // `typedArg`, which checks membership and nothing else.
    expect(issue({ type: ["string", "null"] }, "")).toEqual([]);
  });

  test("an enum decides first, so a value outside it reads the enum's fragment", () => {
    expect(issue(enumProperty(["a"], "d"), "")).toEqual([
      'with v ""; its args schema declares "a"',
    ]);
  });

  test("a const that admits it decides alone, as the const row does at runtime", () => {
    /* Hypothetical (no shipped record declares an empty const), but the parity sweep below holds
       the two passes to it: the const row wins in `describeShape`, so the string rule never runs. */
    expect(issue({ const: "", type: "string" }, "")).toEqual([]);
    expect(issue({ const: "", type: "string" }, "x")).toEqual([
      'with v "x"; its args schema declares ""',
    ]);
  });

  test("names the declaring registry", () => {
    expect(issue({ declaredBy: "the panel registry", type: "string" }, "")).toEqual([
      'with v ""; the panel registry declares a non-empty string',
    ]);
  });
});

describe("minimum and maximum", () => {
  const bounded = numberProperty("d", { maximum: 5, minimum: 0.05 });

  test("a number inside the interval passes, at either end included", () => {
    expect(issue(bounded, 0.05)).toEqual([]);
    expect(issue(bounded, 5)).toEqual([]);
    expect(issue(bounded, 1)).toEqual([]);
  });

  test("a number outside it is refused, naming the interval", () => {
    expect(issue(bounded, 10)).toEqual([
      "with v 10; its args schema declares a number from 0.05 to 5",
    ]);
    expect(issue(bounded, 0)).toEqual([
      "with v 0; its args schema declares a number from 0.05 to 5",
    ]);
  });

  test("a half-open bound is checked on its own side, and named as such", () => {
    expect(issue(numberProperty("d", { minimum: 0 }), -1)).toEqual([
      "with v -1; its args schema declares a number of at least 0",
    ]);
    expect(issue(numberProperty("d", { minimum: 0 }), 3)).toEqual([]);
    expect(issue(numberProperty("d", { maximum: 9 }), 10)).toEqual([
      "with v 10; its args schema declares a number of at most 9",
    ]);
  });

  test("a bounded integer is held to both rules, the type first", () => {
    const property = { maximum: 9, minimum: 1, type: "integer" };
    expect(issue(property, 1.5)).toEqual(["with v 1.5 (number); its args schema declares integer"]);
    expect(issue(property, 12)).toEqual([
      "with v 12; its args schema declares a number from 1 to 9",
    ]);
    expect(issue(property, 3)).toEqual([]);
  });
});

describe("oneOf", () => {
  /** `canvas.setFit`'s shape: a word from a list, or a bounded number. */
  const fit = {
    oneOf: [
      { enum: ["width", "page"], type: "string" },
      { maximum: 5, minimum: 0.05, type: "number" },
    ],
  };

  test("the first admitting branch that accepts the value wins", () => {
    expect(issue(fit, "width")).toEqual([]);
    expect(issue(fit, 2)).toEqual([]);
    expect(issue(pathProperty("d", true), null)).toEqual([]);
    expect(issue(pathProperty("d", true), ["children", 0])).toEqual([]);
  });

  test("a value exactly one branch refused reads THAT branch's fragment", () => {
    expect(issue(fit, 10)).toEqual(["with v 10; its args schema declares a number from 0.05 to 5"]);
    expect(issue(fit, "fill")).toEqual([
      'with v "fill"; its args schema declares "width" | "page"',
    ]);
    expect(issue({ oneOf: [{ type: "string" }, { type: "null" }] }, "")).toEqual([
      'with v ""; its args schema declares a non-empty string',
    ]);
  });

  test("a value no branch could take is answered with the list of shapes", () => {
    expect(issue(fit, true)).toEqual([
      'with v true (boolean); its args schema declares "width" | "page" | number',
    ]);
    expect(issue(pathProperty("d", true), "x")).toEqual([
      'with v "x" (string); its args schema declares array | null',
    ]);
  });

  test("a branch with no type is always tried, and a nested oneOf reads through", () => {
    expect(
      issue({ oneOf: [{ const: 1 }, { oneOf: [{ type: "boolean" }, { type: "null" }] }] }, true),
    ).toEqual([]);
    expect(issue({ oneOf: [{ const: 1 }, { description: "any" }] }, "whatever")).toEqual([]);
    expect(issue({ oneOf: [{ const: 1 }, { const: 2 }] }, 3)).toEqual([
      "with v 3 (number); its args schema declares 1 | 2",
    ]);
    /* A typeless branch that refuses is listed as "anything": the nested oneOf admits every type
       and refused this one on its own branches, so the outer list has no type to print for it. */
    expect(
      issue({ oneOf: [{ const: 1 }, { oneOf: [{ type: "boolean" }, { type: "null" }] }] }, "x"),
    ).toEqual(['with v "x" (string); its args schema declares 1 | anything']);
  });

  test("a branch names its own registry, and the property's is the fallback", () => {
    expect(
      issue({ oneOf: [{ declaredBy: "the pane registry", enum: ["a"], type: "string" }] }, "b"),
    ).toEqual(['with v "b"; the pane registry declares "a"']);
    expect(
      issue({ declaredBy: "the panel registry", oneOf: [{ enum: ["a"], type: "string" }] }, "b"),
    ).toEqual(['with v "b"; the panel registry declares "a"']);
  });
});

describe("the static pass and the runtime pass agree", () => {
  /** Every shape a shipped record declares, plus the three the issue names. */
  const properties: Record<string, object> = {
    bounded: numberProperty("d", { maximum: 5, minimum: 0.05 }),
    boundedInteger: { maximum: 9, minimum: 1, type: "integer" },
    constEmpty: { const: "", type: "string" },
    constWord: { const: "page", type: "string" },
    fit: {
      oneOf: [
        { enum: ["width", "page"], type: "string" },
        { maximum: 5, minimum: 0.05, type: "number" },
      ],
    },
    integer: { type: "integer" },
    nullablePath: pathProperty("d", true),
    nullableString: { oneOf: [{ type: "string" }, { type: "null" }] },
    number: numberProperty("d"),
    path: pathProperty("d"),
    pathList: pathListProperty("d"),
    string: stringProperty("d"),
    tab: enumProperty(["page", "layers"], "d"),
    union: { type: ["string", "null"] },
  };

  /** The values, each tried against every property. */
  const values: unknown[] = [
    "",
    "x",
    "page",
    "width",
    0,
    0.05,
    1,
    1.5,
    5,
    10,
    -1,
    true,
    null,
    [],
    ["children", 0],
    [["children", 0]],
    { any: 1 },
  ];

  for (const [name, property] of Object.entries(properties)) {
    test(`${name}: refused by one pass iff refused by the other`, () => {
      const schema = argsSchema({ v: property });
      for (const value of values) {
        const staticRefuses = validateArgs(schema, { v: value }).length > 0;
        let runtimeRefuses = false;
        try {
          coerceArgs("x.y", schema, { v: value });
        } catch {
          runtimeRefuses = true;
        }
        expect(staticRefuses, `${name} with ${JSON.stringify(value)}`).toBe(runtimeRefuses);
      }
    });
  }
});
