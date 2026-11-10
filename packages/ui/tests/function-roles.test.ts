/**
 * The kit's behaviour sidecars are `$src` Function entries with no body to read, so each one's role
 * comes from the document that uses it (`spec.md` §5.3 4d). The interpreter used to ask the
 * imported function instead, and this guard is what proves the two agree for every entry the kit
 * ships: a component that disagrees on purpose declares `parameters`.
 */
import { describe, expect, test } from "bun:test";
import { classifyFunctionEntries } from "@jxsuite/schema/function-role";
import { bodyReturnsValue, isFunction, isFunctionDef } from "@jxsuite/schema/guards";
import type { FunctionRole } from "@jxsuite/schema/function-role";
import { documents, KIT_MODULES } from "../src/index.ts";
import type { JxScope, JxScopeValue } from "@jxsuite/runtime/types";

/** Which role the imported function itself would have had under the old introspection rule. */
function introspectedRole(fn: (...args: never[]) => void, declared: boolean): FunctionRole {
  return declared || fn.length >= 2 || !bodyReturnsValue(fn.toString()) ? "callable" : "computed";
}

interface Entry {
  component: string;
  key: string;
  expected: FunctionRole;
  actual: FunctionRole | undefined;
}

/** Every bodyless `$src` entry of every kit document, with both verdicts. */
function kitEntries(): Entry[] {
  const found: Entry[] = [];
  for (const [component, doc] of Object.entries(documents)) {
    const roles = classifyFunctionEntries(doc);
    for (const [key, def] of Object.entries(doc.state ?? {})) {
      if (!isFunctionDef(def) || !def.$src || def.body) {
        continue;
      }
      const mod: JxScope | undefined = Object.entries(KIT_MODULES).find(
        ([specifier]) => specifier === def.$src,
      )?.[1];
      const fn: JxScopeValue | undefined = mod?.[def.$export ?? key];
      if (!isFunction(fn)) {
        continue;
      }
      const declared = (def.parameters ?? def.arguments ?? []).length > 0;
      found.push({
        actual: roles.get(key),
        component,
        expected: introspectedRole(fn, declared),
        key,
      });
    }
  }
  return found;
}

describe("the kit's $src Function entries", () => {
  test("the document's verdict matches what each export is", () => {
    const entries = kitEntries();
    expect(entries.length).toBeGreaterThan(80);
    const disagree = entries.filter((e) => e.actual !== e.expected);
    expect(disagree.map((e) => `${e.component}.${e.key}`)).toEqual([]);
  });

  test("jx-menu's root keyboard handler stays a callable", () => {
    const menu = documents["jx-menu"];
    expect(menu.onkeydown).toBeDefined();
    expect(classifyFunctionEntries(menu).get("onKeydown")).toBe("callable");
  });
});
