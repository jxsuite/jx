/**
 * `integerArg`, and the `integer` row of `coerceArgs`'s dispatch — issue 333's third part.
 *
 * A bare `type: "integer"` property used to read as a plain number, so `1.5` passed the schema pass
 * that `registry.run` makes before `run`; `typedArg` held a type LIST to integrality and the bare
 * form had no reader. No shipped record declares one, which is why the sweep in
 * `tests/command-args.test.ts` never saw it; these tests are the row's own.
 */
import { describe, expect, test } from "bun:test";
import { argsSchema, coerceArgs, describeShape, integerArg } from "../src/commands/command-args";

describe("integerArg", () => {
  test("returns a whole number", () => {
    expect(integerArg("x.y", { n: 3 }, "n")).toBe(3);
    expect(integerArg("x.y", { n: 0 }, "n")).toBe(0);
    expect(integerArg("x.y", { n: -2 }, "n")).toBe(-2);
  });

  test("refuses a fraction, a string, NaN and a missing value, naming each", () => {
    expect(() => integerArg("x.y", { n: 1.5 }, "n")).toThrow(
      'command "x.y" argument "n": expected an integer, got number 1.5',
    );
    expect(() => integerArg("x.y", { n: "3" }, "n")).toThrow('expected an integer, got "3"');
    expect(() => integerArg("x.y", { n: Number.NaN }, "n")).toThrow("expected an integer");
    expect(() => integerArg("x.y", {}, "n")).toThrow("expected an integer, got missing");
    expect(() => integerArg("x.y", { n: 1.5 }, "n")).toThrow(RangeError);
  });
});

describe("the integer row", () => {
  test("a bare integer type is its own row; a bounded one stays the bounded row", () => {
    expect(describeShape({ type: "integer" })).toBe("integer");
    expect(describeShape({ maximum: 9, minimum: 1, type: "integer" })).toBe("bounded-number");
    // A half-open integer reads as a bare integer, as a half-open number reads as a plain one.
    expect(describeShape({ minimum: 0, type: "integer" })).toBe("integer");
  });

  test("coerceArgs routes the bare form to integerArg, so 1.5 is refused before run", () => {
    const schema = argsSchema({ n: { description: "d", type: "integer" } });
    expect(coerceArgs("x.y", schema, { n: 2 })).toEqual({ n: 2 });
    expect(() => coerceArgs("x.y", schema, { n: 1.5 })).toThrow(
      'command "x.y" argument "n": expected an integer, got number 1.5',
    );
  });

  test("a bounded integer is held to integrality before the interval", () => {
    const schema = argsSchema({ n: { description: "d", maximum: 9, minimum: 1, type: "integer" } });
    expect(coerceArgs("x.y", schema, { n: 3 })).toEqual({ n: 3 });
    expect(() => coerceArgs("x.y", schema, { n: 1.5 })).toThrow(
      "expected an integer, got number 1.5",
    );
    expect(() => coerceArgs("x.y", schema, { n: 12 })).toThrow(
      "12 is outside the supported range 1–9",
    );
  });

  test("a oneOf lists the integer row as 'an integer'", () => {
    const schema = argsSchema({
      v: { description: "d", oneOf: [{ type: "boolean" }, { type: "integer" }] },
    });
    expect(coerceArgs("x.y", schema, { v: 4 })).toEqual({ v: 4 });
    expect(() => coerceArgs("x.y", schema, { v: "s" })).toThrow(
      'command "x.y" argument "v": expected a boolean or an integer, got "s"',
    );
  });
});
