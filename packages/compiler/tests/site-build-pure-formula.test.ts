/**
 * Site-build-pure-formula.test.ts — what a built page pays for a pure named formula in its state.
 *
 * A named formula (spec.md §19.4c) is a function, not reactive state. A page calls one from a
 * template (`${state.formatDate(…)}`), the build resolves the call, and nothing is left for the
 * browser to do. Counting the declaration itself as state made a page with one date tag a client
 * page. The formula now ships only while something left for the client still reads it (compiler.md
 * §3).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDynamic, isPureNamedFormula, referencesStateKey } from "../src/shared";
import { buildSite } from "../src/site/site-build";
import type { JsonValue, JxStateDefinition } from "@jxsuite/schema/types";

const TMP = resolve(import.meta.dir, "__test-pure-formula__");

function writeJSON(path: string, obj: JsonValue) {
  mkdirSync(resolve(TMP, ...path.split("/").slice(0, -1)), { recursive: true });
  writeFileSync(resolve(TMP, path), JSON.stringify(obj, null, 2), "utf8");
}

/** A page under its own layout, so a dynamic page's island is `dist/<name>/<tag>.js`. */
function page(name: string, tag: string, doc: Record<string, JsonValue>) {
  writeJSON(`layouts/${tag}.json`, { children: [{ tagName: "slot" }], tagName: tag });
  writeJSON(`pages/${name}.json`, { $layout: `./layouts/${tag}.json`, title: name, ...doc });
}

const html = (name: string) => readFileSync(resolve(TMP, "dist", name, "index.html"), "utf8");
const islandPath = (name: string, tag: string) => resolve(TMP, "dist", name, `${tag}.js`);
const island = (name: string, tag: string) => readFileSync(islandPath(name, tag), "utf8");

/** `formatDate` as `@jxsuite/formulas` ships it: empty in, empty out; else the page's locale. */
const formatDate = {
  $description: "Format a date in the page's locale.",
  $expression: {
    initial: {
      operator: "call",
      target: { $ref: "window#/Intl/formatDate" },
      value: [{ $ref: "$args/value" }, null, { $ref: "$args/options" }],
    },
    operator: "?:",
    target: {
      operator: "===",
      target: { operator: "??", target: { $ref: "$args/value" }, value: "" },
      value: "",
    },
    value: "",
  },
  parameters: [{ name: "value" }, { name: "options", optional: true }],
} satisfies JxStateDefinition;

const double = {
  $expression: { operator: "*", target: { $ref: "$args/n" }, value: 2 },
  parameters: ["n"],
} satisfies JxStateDefinition;

/** Calls `double`, so a read of it is a read of both. */
const quadruple = {
  $expression: {
    operator: "call",
    target: { $ref: "#/state/double" },
    value: [{ operator: "call", target: { $ref: "#/state/double" }, value: [{ $ref: "$args/n" }] }],
  },
  parameters: ["n"],
} satisfies JxStateDefinition;

/** Has `parameters`, and writes state: a callable, but not a pure one. */
const bumpBy = {
  $expression: { operator: "+=", target: { $ref: "#/state/count" }, value: { $ref: "$args/n" } },
  parameters: ["n"],
} satisfies JxStateDefinition;

const POSTS = [
  { date: "2026-08-16T02:00:00Z", title: "First" },
  { date: "", title: "Undated" },
];

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });

  writeJSON("project.json", { build: { outDir: "./dist" }, name: "Probe" });
  mkdirSync(resolve(TMP, "pages"), { recursive: true });
  writeFileSync(resolve(TMP, "pages/sidecar.js"), "export function go() {}\n", "utf8");

  // The whole of the page's state is one formula, called from a template inside a repeater.
  page("dated", "dated-shell", {
    children: [
      {
        children: {
          $prototype: "Array",
          items: POSTS,
          map: {
            children: [
              { tagName: "h2", textContent: "${$map.item.title}" },
              {
                tagName: "time",
                textContent: '${state.formatDate($map.item.date, {"dateStyle":"long"})}',
              },
            ],
            tagName: "li",
          },
        },
        tagName: "ul",
      },
    ],
    state: { formatDate },
  });

  // A formula nothing calls at all.
  page("unused", "unused-shell", {
    children: [{ tagName: "p", textContent: "Fixed text" }],
    state: { double },
  });

  // Read by a template the build cannot resolve: `count` changes in the browser.
  page("live", "live-shell", {
    children: [
      { tagName: "output", textContent: "${state.quadruple(state.count)}" },
      { onclick: { $ref: "#/state/bump" }, tagName: "button", textContent: "+" },
    ],
    state: {
      bump: { $prototype: "Function", body: "state.count++" },
      count: 1,
      double,
      formatDate,
      quadruple,
    },
  });

  // Read only by a handler body, which no template scan resolves.
  page("handler", "handler-shell", {
    children: [{ onclick: { $ref: "#/state/show" }, tagName: "button", textContent: "Show" }],
    state: {
      double,
      show: { $prototype: "Function", body: "console.log(state.double(21))" },
    },
  });

  // A `$src` module's reads cannot be seen, so its page keeps every formula.
  page("sidecar", "sidecar-shell", {
    children: [{ onclick: { $ref: "#/state/go" }, tagName: "button", textContent: "Go" }],
    state: { double, go: { $prototype: "Function", $src: "./sidecar.js" } },
  });

  // Read in the forms a dotted-name scan would miss: a bracket, an optional chain, a destructure.
  page("spelled", "spelled-shell", {
    children: [{ onclick: { $ref: "#/state/show" }, tagName: "button", textContent: "Show" }],
    state: {
      double,
      formatDate,
      quadruple,
      show: {
        $prototype: "Function",
        body: 'console.log(state["double"](1), state?.formatDate(0))',
      },
    },
  });
  page("destructured", "destructured-shell", {
    children: [{ onclick: { $ref: "#/state/show" }, tagName: "button", textContent: "Show" }],
    state: {
      double,
      show: { $prototype: "Function", body: "const { double } = state; console.log(double(1))" },
    },
  });

  // A callable that writes state is not a pure formula, and is kept as it always was.
  page("impure", "impure-shell", {
    children: [{ tagName: "p", textContent: "Fixed text" }],
    state: { bumpBy },
  });

  await buildSite(TMP, { verbose: false });
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("a pure named formula on a built page", () => {
  test("a page whose only state is a formula called inside a repeater builds static", () => {
    const dated = html("dated");
    expect(dated).toContain("August 16, 2026");
    expect(dated).toContain("First");
    expect(dated).toContain("Undated");
    // The undated row's call ran too, and gave the empty string its guard promises.
    expect(dated).toMatch(/<time[^>]*><\/time>/);
    expect(dated).not.toContain("state.formatDate");
    expect(dated).not.toContain('<script type="module"');
    expect(dated).not.toContain("dated-shell.js");
    expect(existsSync(islandPath("dated", "dated-shell"))).toBe(false);
  });

  test("a formula nothing calls does not make its page dynamic", () => {
    expect(html("unused")).not.toContain('<script type="module"');
    expect(existsSync(islandPath("unused", "unused-shell"))).toBe(false);
  });

  test("a formula a client template still reads ships, with the formula it calls", () => {
    const live = island("live", "live-shell");
    expect(live).toContain("this.state.quadruple = ");
    expect(live).toContain("this.state.double = ");
    expect(live).toContain("s.quadruple(s.count)");
  });

  test("a formula no surviving reader names is dropped from a page that is dynamic anyway", () => {
    expect(island("live", "live-shell")).not.toContain("this.state.formatDate = ");
  });

  test("a formula read only by a handler body ships", () => {
    expect(island("handler", "handler-shell")).toContain("this.state.double = ");
  });

  test("a formula read through a bracket, an optional chain or a destructure ships", () => {
    const spelled = island("spelled", "spelled-shell");
    expect(spelled).toContain("this.state.double = ");
    expect(spelled).toContain("this.state.formatDate = ");
    // Nothing reads this one in any spelling.
    expect(spelled).not.toContain("this.state.quadruple = ");
    expect(island("destructured", "destructured-shell")).toContain("this.state.double = ");
  });

  test("a surviving $src module keeps every formula", () => {
    expect(island("sidecar", "sidecar-shell")).toContain("this.state.double = ");
  });

  test("a callable that writes state is not a pure formula, and still ships", () => {
    expect(existsSync(islandPath("impure", "impure-shell"))).toBe(true);
    expect(island("impure", "impure-shell")).toContain("this.state.bumpBy = ");
  });
});

describe("isPureNamedFormula", () => {
  test("an expression with parameters and no write is one", () => {
    expect(isPureNamedFormula(double)).toBe(true);
    expect(isPureNamedFormula(formatDate)).toBe(true);
    expect(isPureNamedFormula(quadruple)).toBe(true);
  });

  test("a computed value, a handler and plain state are not", () => {
    expect(isPureNamedFormula({ $expression: double.$expression })).toBe(false);
    expect(isPureNamedFormula({ $expression: double.$expression, parameters: [] })).toBe(false);
    expect(
      isPureNamedFormula({ $prototype: "Function", body: "return 1", parameters: ["n"] }),
    ).toBe(false);
    expect(isPureNamedFormula(0)).toBe(false);
    expect(isPureNamedFormula(null)).toBe(false);
  });

  test("a write anywhere in the body makes it impure", () => {
    expect(isPureNamedFormula(bumpBy)).toBe(false);
    const write = { operator: "push", target: { $ref: "#/state/log" }, value: 1 };
    const nested = (body: JxStateDefinition) => isPureNamedFormula(body);
    expect(nested({ $expression: { operator: "!", target: write }, parameters: ["n"] })).toBe(
      false,
    );
    expect(
      nested({
        $expression: { operator: "+", target: 1, value: [0, write] },
        parameters: ["n"],
      }),
    ).toBe(false);
    expect(
      nested({
        $expression: { initial: write, operator: "?:", target: true, value: 1 },
        parameters: ["n"],
      }),
    ).toBe(false);
    expect(
      nested({
        $expression: { cases: { a: write }, default: 0, operator: "switch", target: "a" },
        parameters: ["n"],
      }),
    ).toBe(false);
    expect(
      nested({
        $expression: { cases: { a: 1 }, default: write, operator: "switch", target: "a" },
        parameters: ["n"],
      }),
    ).toBe(false);
    // A plain-object literal that happens to hold the word is data, not a node.
    expect(
      nested({
        $expression: { operator: "??", target: { $ref: "$args/n" }, value: { note: "push" } },
        parameters: ["n"],
      }),
    ).toBe(true);
  });
});

describe("isDynamic and pure named formulas", () => {
  test("a formula alone is not dynamic", () => {
    expect(isDynamic({ state: { double }, tagName: "div", textContent: "hi" })).toBe(false);
    expect(isDynamic({ state: { double, quadruple }, tagName: "div" })).toBe(false);
  });

  test("a formula something on the node reads is", () => {
    expect(
      isDynamic({ state: { double }, tagName: "div", textContent: "${state.double(2)}" }),
    ).toBe(true);
    // Read by an inline handler, which nothing else in the scan would flag.
    expect(
      isDynamic({
        onclick: { $prototype: "Function", body: "alert(state.double(2))" },
        state: { double },
        tagName: "button",
      }),
    ).toBe(true);
    expect(
      isDynamic({
        children: [{ $props: { fn: { $ref: "#/state/double" } }, tagName: "x-child" }],
        state: { double },
        tagName: "div",
      }),
    ).toBe(true);
  });

  test("an impure callable is state, as before", () => {
    expect(isDynamic({ state: { bumpBy }, tagName: "div" })).toBe(true);
  });

  test("other state beside an unread formula decides as it always did", () => {
    expect(isDynamic({ state: { count: 0, double }, tagName: "div" })).toBe(true);
    expect(isDynamic({ state: { double, label: { type: "string" } }, tagName: "div" })).toBe(false);
  });
});

describe("referencesStateKey", () => {
  test("finds a template read, a body read and a $ref, and nothing longer than the key", () => {
    expect(referencesStateKey('"${state.fmt(1)}"', "fmt")).toBe(true);
    expect(referencesStateKey('"return state.fmt"', "fmt")).toBe(true);
    expect(referencesStateKey('{"$ref":"#/state/fmt"}', "fmt")).toBe(true);
    expect(referencesStateKey('{"$ref":"#/state/fmt/length"}', "fmt")).toBe(true);
    expect(referencesStateKey('"${state.fmtLong(1)}"', "fmt")).toBe(false);
    expect(referencesStateKey('{"$ref":"#/state/fmtLong"}', "fmt")).toBe(false);
  });

  /** A body as the scan meets it: inside a serialized document. */
  const body = (text: string) => JSON.stringify({ body: text });

  test("finds an optional read, a literal-keyed bracket read, and a read across white space", () => {
    expect(referencesStateKey(body("return state?.fmt(1)"), "fmt")).toBe(true);
    expect(referencesStateKey(body('return state["fmt"](1)'), "fmt")).toBe(true);
    expect(referencesStateKey(body("return state['fmt'](1)"), "fmt")).toBe(true);
    expect(referencesStateKey(body('return state?.[ "fmt" ](1)'), "fmt")).toBe(true);
    expect(referencesStateKey(body("return state\n  .fmt(1)"), "fmt")).toBe(true);
    expect(referencesStateKey(body('return state["fmt-date"](1)'), "fmt-date")).toBe(true);
    expect(referencesStateKey(body('return state["fmtLong"](1)'), "fmt")).toBe(false);
    expect(referencesStateKey(body("return state?.fmtLong(1)"), "fmt")).toBe(false);
    expect(referencesStateKey(body("return prevstate.fmt"), "fmt")).toBe(false);
  });

  test("state handed on whole reads every key; a member read and prose do not", () => {
    expect(referencesStateKey(body("const { fmt } = state; return fmt(1)"), "fmt")).toBe(true);
    expect(referencesStateKey(body("const s = state\nreturn s.fmt(1)"), "fmt")).toBe(true);
    expect(referencesStateKey(body("return { ...state }"), "fmt")).toBe(true);
    expect(referencesStateKey(body("const s = state"), "fmt")).toBe(true);
    expect(referencesStateKey(body("const n = state.count; return n"), "fmt")).toBe(false);
    expect(referencesStateKey(body("state.count = state.count + 1"), "fmt")).toBe(false);
    expect(referencesStateKey(JSON.stringify({ textContent: "a = state of mind" }), "fmt")).toBe(
      false,
    );
    expect(referencesStateKey(JSON.stringify({ state: { count: 0 }, tagName: "p" }), "fmt")).toBe(
      false,
    );
  });

  test("a key that ends in $ is found before a call's parenthesis", () => {
    expect(referencesStateKey('"${state.fmt$(1)}"', "fmt$")).toBe(true);
    expect(referencesStateKey('"${state.fmt$x(1)}"', "fmt$")).toBe(false);
    expect(referencesStateKey('"${state.fmt$$(1)}"', "fmt$")).toBe(false);
  });
});
