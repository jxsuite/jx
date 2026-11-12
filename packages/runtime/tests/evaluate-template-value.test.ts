/** `evaluateTemplateValue`: the runtime's own reading of a template, exported for editor tooling. */
import { describe, expect, test } from "bun:test";
import { effect, reactive } from "@vue/reactivity";
import { evaluateTemplateValue } from "../src/runtime";
import type { JxScope } from "../src/types";

describe("evaluateTemplateValue", () => {
  test("a single expression keeps its own value", () => {
    const nodes = [{ tagName: "p" }];
    const scope: JxScope = { count: 2, nodes, open: false };
    expect(evaluateTemplateValue("${state.nodes}", scope)).toBe(nodes);
    expect(evaluateTemplateValue("${state.open}", scope)).toBe(false);
    expect(evaluateTemplateValue("${state.count + 1}", scope)).toBe(3);
    expect(evaluateTemplateValue("${state.missing}", scope)).toBeUndefined();
  });

  test("text around an expression interpolates to a string", () => {
    expect(evaluateTemplateValue("${state.count} items", { count: 2 })).toBe("2 items");
    expect(evaluateTemplateValue("${state.a}${state.b}", { a: 1, b: 2 })).toBe("12");
  });

  test("it binds the names a rendered template sees", () => {
    const scope: JxScope = {
      $map: { index: 3, item: { title: "Row" } },
      $page: { locale: "en" },
      $site: { name: "Site" },
    };
    expect(evaluateTemplateValue("${item.title}", scope)).toBe("Row");
    expect(evaluateTemplateValue("${$map.item.title}", scope)).toBe("Row");
    expect(evaluateTemplateValue("${index}", scope)).toBe(3);
    expect(evaluateTemplateValue("${$site.name}/${$page.locale}", scope)).toBe("Site/en");
  });

  test("outside a row the row names are undefined, not an error", () => {
    expect(evaluateTemplateValue("${item}", {})).toBeUndefined();
    expect(evaluateTemplateValue("${index}", {})).toBeUndefined();
    expect(evaluateTemplateValue("${$map?.item ?? 'none'}", {})).toBe("none");
  });

  test("nothing is caught: a throwing expression and a bad source both throw", () => {
    expect(() => evaluateTemplateValue("${state.a.b}", {})).toThrow(TypeError);
    expect(() => evaluateTemplateValue("${state.}", {})).toThrow(SyntaxError);
  });

  test("its reads are tracked by the effect that calls it", () => {
    const scope = reactive<JxScope>({ title: "One" });
    const seen: unknown[] = [];
    effect(() => {
      seen.push(evaluateTemplateValue("${state.title}", scope));
    });
    scope.title = "Two";
    expect(seen).toEqual(["One", "Two"]);
  });
});
