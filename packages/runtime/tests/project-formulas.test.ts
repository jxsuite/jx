import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, describe, expect, test } from "bun:test";
import { reactive } from "@vue/reactivity";
import { defineElement, mount, setProjectFormulas } from "../src/runtime";
import { formulaScopeReads, inheritableFormulas, isPureNamedFormula } from "../src/expression";
import type { JsonValue, JxDocument, JxStateDefinition } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

const double = {
  $expression: { operator: "*", target: { $ref: "$args/n" }, value: 2 },
  parameters: ["n"],
} satisfies JxStateDefinition;

/** Calls `double`. */
const quadruple = {
  $expression: {
    operator: "call",
    target: { $ref: "#/state/double" },
    value: [{ operator: "call", target: { $ref: "#/state/double" }, value: [{ $ref: "$args/n" }] }],
  },
  parameters: ["n"],
} satisfies JxStateDefinition;

/** Pure, and reads project data state. */
const withBrand = {
  $expression: { operator: "+", target: { $ref: "$args/text" }, value: { $ref: "#/state/brand" } },
  parameters: ["text"],
} satisfies JxStateDefinition;

/** Calls `withBrand`, through the `parent#/` spelling of a scope read. */
const shout = {
  $expression: {
    operator: "call",
    target: { $ref: "parent#/withBrand" },
    value: [{ $ref: "$args/text" }],
  },
  parameters: ["text"],
} satisfies JxStateDefinition;

/** Writes state: a callable, not a pure formula. */
const bumpBy = {
  $expression: { operator: "+=", target: { $ref: "#/state/total" }, value: { $ref: "$args/n" } },
  parameters: ["n"],
} satisfies JxStateDefinition;

const PROJECT = { $site: double, brand: "Acme", bumpBy, double, quadruple, shout, withBrand };

afterEach(() => {
  setProjectFormulas(null);
});

/** Define `doc` once, connect an instance, and answer it after its first render. */
async function connected(doc: JxDocument & { tagName: string }, props?: Record<string, JsonValue>) {
  await defineElement(doc);
  const el = document.createElement(doc.tagName);
  Object.assign(el, props);
  document.body.append(el);
  await tick();
  return el;
}

describe("inheritableFormulas", () => {
  test("keeps the closed pure formulas, in the project's order", () => {
    expect(Object.keys(inheritableFormulas(PROJECT))).toEqual(["double", "quadruple"]);
  });

  test("a formula that reads data state stays behind, and so does what calls it", () => {
    const taken = inheritableFormulas(PROJECT);
    expect(taken).not.toHaveProperty("withBrand");
    expect(taken).not.toHaveProperty("shout");
    // Declared before the formula it calls: dropped on a later pass.
    expect(inheritableFormulas({ shout, withBrand })).toEqual({});
  });

  test("data state, an impure callable and an injected-context name are never taken", () => {
    const taken = inheritableFormulas(PROJECT);
    expect(taken).not.toHaveProperty("brand");
    expect(taken).not.toHaveProperty("bumpBy");
    expect(taken).not.toHaveProperty("$site");
  });

  test("no project state is no formulas", () => {
    expect(inheritableFormulas(null)).toEqual({});
    expect(inheritableFormulas({})).toEqual({});
  });

  test("a formula may call itself", () => {
    const loop = {
      $expression: { operator: "call", target: { $ref: "#/state/loop" }, value: [1] },
      parameters: ["n"],
    };
    expect(Object.keys(inheritableFormulas({ loop }))).toEqual(["loop"]);
  });
});

describe("formulaScopeReads", () => {
  test("names each scope key the body reads, however the ref spells it", () => {
    expect(formulaScopeReads(quadruple)).toEqual(["double"]);
    expect(formulaScopeReads(shout)).toEqual(["withBrand"]);
    expect(
      formulaScopeReads({
        $expression: {
          operator: "+",
          target: { $ref: "#/state/a~1b/deep" },
          value: [{ $ref: "bare" }, { $ref: "" }, 3, null, { literal: { $ref: "#/state/no" } }],
        },
      }),
    ).toEqual(["a/b", "bare", ""]);
  });

  test("arguments, iteration context and globals are not the scope", () => {
    expect(formulaScopeReads(double)).toEqual([]);
    expect(
      formulaScopeReads({
        $expression: {
          operator: "call",
          target: { $ref: "window#/Math/max" },
          value: [
            { $ref: "$map/item" },
            { $ref: "$reduce/acc" },
            { $ref: "document#/title" },
            { $ref: "event#/detail" },
          ],
        },
      }),
    ).toEqual([]);
  });
});

describe("isPureNamedFormula", () => {
  test("an expression with parameters and no write, nested or in a case", () => {
    expect(isPureNamedFormula(double)).toBe(true);
    expect(isPureNamedFormula(bumpBy)).toBe(false);
    expect(isPureNamedFormula({ $expression: double.$expression })).toBe(false);
    expect(isPureNamedFormula("text")).toBe(false);
    const write = { operator: "push", target: { $ref: "#/state/log" }, value: 1 };
    expect(
      isPureNamedFormula({
        $expression: { cases: { a: write }, operator: "switch", target: "a" },
        parameters: ["n"],
      }),
    ).toBe(false);
    expect(
      isPureNamedFormula({
        $expression: { operator: "call", target: { $ref: "$args/n" }, value: [1, write] },
        parameters: ["n"],
      }),
    ).toBe(false);
  });
});

describe("a component inherits the project's pure formulas (spec.md §13.4)", () => {
  test("a template inside a component calls one, and follows a prop", async () => {
    setProjectFormulas(PROJECT);
    const el = await connected(
      { state: { n: 1 }, tagName: "pf-quad", textContent: "${state.quadruple(state.n)}" },
      { n: 2 },
    );
    expect(el.textContent).toBe("8");

    Object.assign(el, { n: 5 });
    await tick();
    expect(el.textContent).toBe("20");
    el.remove();
  });

  test("the component's own entry of that name wins", async () => {
    setProjectFormulas(PROJECT);
    const el = await connected({
      state: {
        double: {
          $expression: { operator: "*", target: { $ref: "$args/n" }, value: 10 },
          parameters: ["n"],
        },
      },
      tagName: "pf-own",
      // The inherited `quadruple` resolves `double` in the component's scope too.
      textContent: "${state.double(3)}:${state.quadruple(1)}",
    });
    expect(el.textContent).toBe("30:100");
    el.remove();
  });

  test("a prop of that name wins", async () => {
    setProjectFormulas(PROJECT);
    const el = await connected(
      { tagName: "pf-prop", textContent: "${state.double}" },
      { double: "mine" },
    );
    expect(el.textContent).toBe("mine");
    el.remove();
  });

  test("an inherited formula is not a host property, whatever the project named it", async () => {
    // Names the host element owns: an accessor over one replaced the DOM member on every component.
    const named = { append: double, remove: double, replaceChildren: double, title: double };
    setProjectFormulas(named);
    const el = document.createElement("pf-host-names");
    el.innerHTML = "<b>slotted</b>";
    await defineElement({
      children: [
        { tagName: "slot" },
        { tagName: "p", textContent: "n=${state.n}:${state.append(2)}" },
      ],
      state: { n: 1 },
      tagName: "pf-host-names",
    });
    document.body.append(el);
    await tick();
    // It rendered, slot content included: the runtime's own `append` and `replaceChildren` ran.
    expect(el.querySelector("p")?.textContent).toBe("n=1:4");
    expect(el.querySelector("b")?.textContent).toBe("slotted");
    for (const name of Object.keys(named)) {
      expect(Object.hasOwn(el, name)).toBe(false);
    }
    expect(el.title).toBe("");
    // The component's declared entry is still its interface.
    expect(Object.hasOwn(el, "n")).toBe(true);
    el.remove();
    expect(el.isConnected).toBe(false);
  });

  test("a prop given under an inherited name stays a live property", async () => {
    setProjectFormulas(PROJECT);
    const el = await connected(
      { tagName: "pf-prop-live", textContent: "${state.double}" },
      { double: "mine" },
    );
    expect(el.textContent).toBe("mine");
    Object.assign(el, { double: "yours" });
    await tick();
    expect(el.textContent).toBe("yours");
    el.remove();
  });

  test("project data state is not visible in the component", async () => {
    setProjectFormulas(PROJECT);
    const el = await connected({
      tagName: "pf-data",
      textContent: "[${state.brand}][${typeof state.withBrand}][${typeof state.bumpBy}]",
    });
    expect(el.textContent).toBe("[undefined][undefined][undefined]");
    el.remove();
  });

  test("with no project formulas a component is its own document", async () => {
    const el = await connected({
      tagName: "pf-bare",
      textContent: "[${typeof state.double}]",
    });
    expect(el.textContent).toBe("[undefined]");
    el.remove();
  });

  test("an instance connected after the project changes reads the new formulas", async () => {
    setProjectFormulas(PROJECT);
    const doc = { tagName: "pf-late", textContent: "${typeof state.double}" };
    const first = await connected(doc);
    expect(first.textContent).toBe("function");
    // The same definition, connected twice under one project: built once.
    const again = await connected(doc);
    expect(again.textContent).toBe("function");

    setProjectFormulas({});
    const second = await connected(doc);
    expect(second.textContent).toBe("undefined");
    for (const el of [first, again, second]) {
      el.remove();
    }
  });

  test("an external $switch case is a component boundary, and inherits too", async () => {
    setProjectFormulas(PROJECT);
    const host = document.createElement("div");
    document.body.append(host);
    await mount(
      {
        children: [
          {
            $switch: { $ref: "#/state/view" },
            cases: { a: { $ref: "./pf-case.json" } },
            tagName: "section",
          },
        ],
        tagName: "div",
      },
      host,
      {
        base: "http://localhost/app/",
        resolver: (url) =>
          url === "http://localhost/app/pf-case.json"
            ? { tagName: "p", textContent: "${state.double(4)}" }
            : undefined,
        scope: reactive({ view: "a" }),
      },
    );
    await tick();
    await tick();
    expect(host.querySelector("p")?.textContent).toBe("8");
    host.remove();
  });
});
