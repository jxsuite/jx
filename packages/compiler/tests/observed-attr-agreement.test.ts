/**
 * One observed-attribute rule, two tiers (spec.md §16.5): the interpreter's `absorbAttribute` and
 * `declaredDefaults`, and what a compiled element module carries (`observedAttrHelperSource` and
 * `observedDefaultsSource`). The rule is logic, so the guard is behavioural: both run over one
 * matrix of held type × attribute value × default, and the emitted defaults are evaluated and
 * compared with the runtime's answer.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { absorbAttribute, declaredDefaults } from "@jxsuite/runtime";
import type { JxScope, JxScopeValue } from "@jxsuite/runtime/types";
import type { JxDocument } from "@jxsuite/schema/types";
import {
  OBSERVED_ATTR_HELPER,
  observedAttrHelperSource,
  observedDefaultsSource,
} from "../src/shared";

const DEFINITION: JxDocument = {
  observedAttributes: ["username", "count", "user-name", "meta", "shout", "greet", "amount"],
  state: {
    amount: { type: "number" },
    count: { default: 1, type: "number" },
    greet: { $prototype: "Function", body: "return 1" },
    meta: { kind: "none" },
    other: "unobserved",
    shout: "${state.username}!",
    userName: "",
    username: "Guest",
  },
  tagName: "agreement-card",
};

/** What the temp module exports: the inlined rule, and the definition's emitted defaults. */
interface ObservedHelpers {
  __jxAbsorbAttr: (
    state: JxScope,
    name: string,
    value: string | null,
    defaults?: ReadonlyMap<string, JxScopeValue>,
  ) => void;
  defaults: () => Map<string, JxScopeValue>;
}

const dir = resolve(import.meta.dir, "__test-observed-attr__");
mkdirSync(dir, { recursive: true });
const helperFile = resolve(dir, "helpers.js");
writeFileSync(
  helperFile,
  `${observedAttrHelperSource()}\n` +
    `export const defaults = () => ${observedDefaultsSource(DEFINITION)};\n` +
    `export { ${OBSERVED_ATTR_HELPER} };\n`,
  "utf8",
);
/* SAFETY: the module written above exports exactly these two, from the source the compiler emits
   into every element module that observes an attribute. */
const helpers = (await import(helperFile)) as ObservedHelpers;

afterAll(() => {
  rmSync(dir, { force: true, recursive: true });
});

const HELD: readonly (readonly [string, JxScopeValue])[] = [
  ["a string", "text"],
  ["a number", 5],
  ["true", true],
  ["false", false],
  ["null", null],
  ["an object", { kind: "none" }],
  ["nothing", undefined],
];
const VALUES: readonly (string | null)[] = ["", "false", "3", "x", null];
const DEFAULTS: readonly (readonly [string, ReadonlyMap<string, JxScopeValue> | undefined])[] = [
  ["no defaults", undefined],
  ["no entry", new Map()],
  ["a default", new Map<string, JxScopeValue>([["key", "DEFAULT"]])],
  ["a zero default", new Map<string, JxScopeValue>([["key", 0]])],
  ["a computed entry", new Map<string, JxScopeValue>([["key", undefined]])],
];

/** A scope holding `held` under `key`, or nothing at all. */
function scopeOf(key: string, held: JxScopeValue): JxScope {
  /* SAFETY: a plain record of scope values is a scope as far as the rule reads and writes one. */
  return (held === undefined ? {} : { [key]: held }) as JxScope;
}

/** One row through both functions, each over its own copy of the same state. */
function both(
  held: JxScopeValue,
  name: string,
  value: string | null,
  defaults?: ReadonlyMap<string, JxScopeValue>,
) {
  const key = name === "user-name" ? "userName" : name;
  const compiled = scopeOf(key, held);
  const interpreted = scopeOf(key, held);
  helpers.__jxAbsorbAttr(compiled, name, value, defaults);
  absorbAttribute(interpreted, name, value, defaults);
  return { compiled, interpreted };
}

describe("the inlined attribute rule agrees with absorbAttribute", () => {
  for (const [heldName, held] of HELD) {
    for (const value of VALUES) {
      for (const [defaultsName, defaults] of DEFAULTS) {
        test(`holding ${heldName}, value ${JSON.stringify(value)}, ${defaultsName}`, () => {
          const { compiled, interpreted } = both(held, "key", value, defaults);
          expect(compiled).toEqual(interpreted);
        });
      }
    }
  }

  test("a kebab-case name writes its camel-cased key", () => {
    const { compiled, interpreted } = both("", "user-name", "Ada");
    expect(compiled).toEqual({ userName: "Ada" });
    expect(compiled).toEqual(interpreted);
  });

  test("the matrix reaches every branch of the rule", () => {
    expect(both(false, "key", "").compiled).toEqual({ key: true });
    expect(both(true, "key", "false").compiled).toEqual({ key: false });
    expect(both(5, "key", "3").compiled).toEqual({ key: 3 });
    expect(both(5, "key", null).compiled).toEqual({ key: 0 });
    expect(both("t", "key", null).compiled).toEqual({ key: "" });
    expect(both("t", "key", null, new Map([["key", "D"]])).compiled).toEqual({ key: "D" });
    expect(both("t", "key", "x", new Map([["key", undefined]])).compiled).toEqual({ key: "t" });
    expect(helpers.__jxAbsorbAttr.length).toBe(4);
    const empty = scopeOf("key", HELD.at(-1)![1]);
    helpers.__jxAbsorbAttr(empty, "key", "3");
    expect(empty).toEqual({ key: "3" });
  });
});

describe("the emitted defaults agree with declaredDefaults", () => {
  const observedKeys = new Set([
    "username",
    "count",
    "userName",
    "meta",
    "shout",
    "greet",
    "amount",
  ]);

  test("for every observed key, and no other", () => {
    const expected = [...declaredDefaults(DEFINITION)].filter(([key]) => observedKeys.has(key));
    expect([...helpers.defaults()]).toEqual(expected);
  });

  test("a computed entry is present with undefined, and a pure type definition is absent", () => {
    const defaults = helpers.defaults();
    expect(defaults.has("shout")).toBe(true);
    expect(defaults.get("shout")).toBeUndefined();
    expect(defaults.has("greet")).toBe(true);
    expect(defaults.has("amount")).toBe(false);
    expect(defaults.has("other")).toBe(false);
  });

  test("an object default is a fresh copy per evaluation", () => {
    const first = helpers.defaults().get("meta");
    expect(first).toEqual({ kind: "none" });
    expect(helpers.defaults().get("meta")).not.toBe(first);
  });
});
