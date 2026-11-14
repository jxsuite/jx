/**
 * One prop-supply rule, two tiers (spec.md §13.2): the interpreter's `instanceSupplies` and the
 * copy a compiled element module inlines (`propSupplyHelperSource`). The rule is logic, so the
 * guard is behavioural: both run over one matrix of key × own property × attribute and must answer
 * alike on every row.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { instanceSupplies } from "@jxsuite/runtime";
import type { JsonValue } from "@jxsuite/schema/types";
import { NATIVE_SETTER_HELPER, PROP_SUPPLY_HELPER, propSupplyHelperSource } from "../src/shared";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

/** The two functions a compiled module inlines, loaded from the source the compiler emits. */
interface BridgeHelpers {
  __jxSupplies: (el: HTMLElement, key: string) => boolean;
  __jxNativeSetter: (el: HTMLElement, key: string) => ((value: JsonValue) => void) | undefined;
}

const dir = resolve(import.meta.dir, "__test-prop-supply__");
mkdirSync(dir, { recursive: true });
const helperFile = resolve(dir, "helpers.js");
writeFileSync(
  helperFile,
  `${propSupplyHelperSource()}\nexport { ${PROP_SUPPLY_HELPER}, ${NATIVE_SETTER_HELPER} };\n`,
  "utf8",
);
/* SAFETY: the module written above exports exactly these two functions, from the source the
   compiler emits into every element module that has a property bridge. */
const helpers = (await import(helperFile)) as BridgeHelpers;

afterAll(() => {
  rmSync(dir, { force: true, recursive: true });
});

const KEYS = ["count", "title", "ariaLabel", "tabIndex"] as const;
const OWN = ["absent", "present", "undefined"] as const;
const ATTRIBUTE = ["none", "exact", "kebab"] as const;

const kebab = (key: string) => key.replaceAll(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`);

function instance(key: string, own: (typeof OWN)[number], attribute: (typeof ATTRIBUTE)[number]) {
  const el = document.createElement("div");
  if (own !== "absent") {
    Object.defineProperty(el, key, {
      configurable: true,
      value: own === "present" ? "v" : undefined,
      writable: true,
    });
  }
  if (attribute !== "none") {
    el.setAttribute(attribute === "exact" ? key : kebab(key), "a");
  }
  return el;
}

describe("the inlined supply rule agrees with instanceSupplies", () => {
  for (const key of KEYS) {
    for (const own of OWN) {
      for (const attribute of ATTRIBUTE) {
        test(`${key}: own property ${own}, attribute ${attribute}`, () => {
          const el = instance(key, own, attribute);
          expect(helpers.__jxSupplies(el, key)).toBe(instanceSupplies(el, key));
        });
      }
    }
  }

  test("the matrix reaches both answers", () => {
    expect(helpers.__jxSupplies(instance("count", "absent", "none"), "count")).toBe(false);
    expect(helpers.__jxSupplies(instance("count", "undefined", "none"), "count")).toBe(true);
    expect(helpers.__jxSupplies(instance("ariaLabel", "absent", "kebab"), "ariaLabel")).toBe(true);
    expect(helpers.__jxSupplies(instance("count", "absent", "exact"), "count")).toBe(true);
  });
});

describe("the inlined native-setter walk", () => {
  test("finds the platform's setter for a reflected name", () => {
    const el = document.createElement("div");
    const set = helpers.__jxNativeSetter(el, "title");
    expect(set).toBeFunction();
    set?.call(el, "T");
    expect(el.getAttribute("title")).toBe("T");
  });

  test("answers undefined for a name the platform does not own, and for a method", () => {
    const el = document.createElement("div");
    expect(helpers.__jxNativeSetter(el, "count")).toBeUndefined();
    expect(helpers.__jxNativeSetter(el, "append")).toBeUndefined();
  });
});
