/**
 * Site-build-component-formulas.test.ts — a project's pure named formulas reach its components.
 *
 * A component's `state` is its own scope, so a template inside one could not call a formula the
 * project declares: `${state.formatDate(state.date)}` built an empty element, prerendered and in
 * the browser. A formula is a function, not state, so it crosses the boundary that signals do not
 * (spec.md §13.4): the closed pure ones are inherited from the project, under whatever the
 * component declares itself, and each is written into the module of a component that reads it.
 *
 * Real builds, and the emitted module run in a DOM: every claim here failed as an empty element
 * while the emitted text looked plausible.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import type { Element } from "happy-dom";
import { inheritProjectFormulas } from "../src/shared";
import { buildSite } from "../src/site/site-build";
import { compileElement } from "../src/targets/compile-element";
import type { JsonValue, JxDocument, JxStateDefinition } from "@jxsuite/schema/types";

const TMP = resolve(import.meta.dir, "__test-component-formulas__");
const BARE = resolve(import.meta.dir, "__test-component-formulas-bare__");

function writeJSON(root: string, path: string, obj: JsonValue) {
  mkdirSync(resolve(root, ...path.split("/").slice(0, -1)), { recursive: true });
  writeFileSync(resolve(root, path), JSON.stringify(obj, null, 2), "utf8");
}

const read = (root: string, path: string) => readFileSync(resolve(root, "dist", path), "utf8");
const html = (name: string) => read(TMP, `${name}/index.html`);
const component = (tag: string) => read(TMP, `components/${tag}.js`);

/** `formatDate` as `@jxsuite/formulas` ships it: empty in, empty out; else the page's locale. */
const formatDate = {
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

/** Calls `double`, so a component that reads this one inherits both. */
const quadruple = {
  $expression: {
    operator: "call",
    target: { $ref: "#/state/double" },
    value: [{ operator: "call", target: { $ref: "#/state/double" }, value: [{ $ref: "$args/n" }] }],
  },
  parameters: ["n"],
} satisfies JxStateDefinition;

/** Pure, but it reads project DATA state, which never crosses: so neither does it. */
const withSite = {
  $expression: { operator: "+", target: { $ref: "$args/text" }, value: { $ref: "#/state/brand" } },
  parameters: ["text"],
} satisfies JxStateDefinition;

/** Calls `withSite`, so it goes with it. */
const shout = {
  $expression: {
    operator: "call",
    target: { $ref: "#/state/withSite" },
    value: [{ $ref: "$args/text" }],
  },
  parameters: ["text"],
} satisfies JxStateDefinition;

/** Has `parameters`, and writes state: a callable, but not a pure one. */
const bumpBy = {
  $expression: { operator: "+=", target: { $ref: "#/state/total" }, value: { $ref: "$args/n" } },
  parameters: ["n"],
} satisfies JxStateDefinition;

const PROJECT_STATE = { brand: "Probe", bumpBy, double, formatDate, quadruple, shout, withSite };
const LONG = '{"dateStyle":"long","timeZone":"UTC"}';

/** Static: one prop, one template that calls a project formula. */
const DATE_STAMP = {
  children: [{ tagName: "time", textContent: `\${state.formatDate(state.date, ${LONG})}` }],
  state: { date: "" },
  tagName: "date-stamp",
} satisfies JxDocument;

/** A client component: it has a handler, and its call reads a prop. */
const QUAD_COUNTER = {
  children: [
    { tagName: "output", textContent: "${state.quadruple(state.n)}" },
    { onclick: { $ref: "#/state/bump" }, tagName: "button", textContent: "+" },
  ],
  state: { bump: { $prototype: "Function", body: "state.clicks++" }, clicks: 0, n: 1 },
  tagName: "quad-counter",
} satisfies JxDocument;

/** Declares its own `double`, which shadows the project's, and reads project data it cannot see. */
const OWN_DOUBLE = {
  children: [
    { id: "own", tagName: "output", textContent: "${state.double(state.n)}" },
    { id: "data", tagName: "span", textContent: "[${state.brand}]" },
    { onclick: { $ref: "#/state/bump" }, tagName: "button", textContent: "+" },
  ],
  state: {
    bump: { $prototype: "Function", body: "state.clicks++" },
    clicks: 0,
    double: {
      $expression: { operator: "*", target: { $ref: "$args/n" }, value: 10 },
      parameters: ["n"],
    },
    n: 3,
  },
  tagName: "own-double",
} satisfies JxDocument;

/** Wraps another component, and calls a formula itself: both levels inherit. */
const STAMP_CARD = {
  $elements: [{ $ref: "./date-stamp.json" }],
  children: [
    { tagName: "b", textContent: "${state.double(21)}" },
    { $props: { date: "2026-01-02T00:00:00Z" }, tagName: "date-stamp" },
  ],
  tagName: "stamp-card",
} satisfies JxDocument;

/** Calls nothing from the project. */
const PLAIN_NOTE = {
  children: [{ tagName: "p", textContent: "${state.text}" }],
  state: { text: "note" },
  tagName: "plain-note",
} satisfies JxDocument;

let win: Window;

/** The element a query found, failing the suite when nothing rendered. */
function rendered<E extends Element>(element: E | null, selector: string): E {
  if (!element) {
    throw new Error(`Expected ${selector} to be rendered`);
  }
  return element;
}

const settle = () =>
  new Promise((r) => {
    setTimeout(r, 20);
  });

beforeAll(async () => {
  for (const root of [TMP, BARE]) {
    rmSync(root, { force: true, recursive: true });
  }

  writeJSON(TMP, "project.json", {
    build: { outDir: "./dist" },
    name: "Probe",
    state: PROJECT_STATE,
  });
  writeJSON(TMP, "components/date-stamp.json", DATE_STAMP);
  writeJSON(TMP, "components/quad-counter.json", QUAD_COUNTER);
  writeJSON(TMP, "components/own-double.json", OWN_DOUBLE);
  writeJSON(TMP, "components/plain-note.json", PLAIN_NOTE);
  writeJSON(TMP, "components/stamp-card.json", STAMP_CARD);

  // Nothing on this page but a static component that calls a project formula.
  writeJSON(TMP, "pages/stamped.json", {
    children: [
      { $props: { date: "2026-08-16T02:00:00Z" }, tagName: "date-stamp" },
      { tagName: "date-stamp" },
    ],
    tagName: "main",
    title: "Stamped",
  });
  writeJSON(TMP, "pages/counted.json", {
    children: [{ $props: { n: 2 }, tagName: "quad-counter" }, { tagName: "own-double" }],
    tagName: "main",
    title: "Counted",
  });
  writeJSON(TMP, "pages/plain.json", {
    children: [{ tagName: "plain-note" }, { tagName: "stamp-card" }],
    tagName: "main",
    title: "Plain",
  });

  // The same component in a project that declares no state at all.
  writeJSON(BARE, "project.json", { build: { outDir: "./dist" }, name: "Bare" });
  writeJSON(BARE, "components/date-stamp.json", DATE_STAMP);
  writeJSON(BARE, "pages/stamped.json", {
    children: [{ $props: { date: "2026-08-16T02:00:00Z" }, tagName: "date-stamp" }],
    tagName: "main",
    title: "Stamped",
  });

  await buildSite(TMP, { verbose: false });
  await buildSite(BARE, { verbose: false });

  win = new Window({ url: "https://example.test" });
  Object.assign(globalThis, {
    CustomEvent: win.CustomEvent,
    Element: win.Element,
    Event: win.Event,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    customElements: win.customElements,
    document: win.document,
    window: win.window,
  });
});

afterAll(() => {
  for (const root of [TMP, BARE]) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("a project formula called inside a component: the build", () => {
  test("the prerendered component holds the formatted value", () => {
    const stamped = html("stamped");
    expect(stamped).toContain("<time>August 16, 2026</time>");
    // The second instance has no date, and the formula's own guard answers the empty string.
    expect(stamped).toContain("<time></time>");
  });

  test("a page whose only formula call is inside a static component stays static", () => {
    const stamped = html("stamped");
    expect(stamped).toContain("data-jx-static");
    expect(stamped).not.toContain("<script");
    expect(stamped).not.toContain("importmap");
    expect(existsSync(resolve(TMP, "dist/stamped/index.js"))).toBe(false);
  });

  test("a client component is prerendered with the formula's value for its props", () => {
    expect(html("counted")).toMatch(
      /<quad-counter[^>]*data-jx-prerendered[^>]*><output>8<\/output>/,
    );
  });

  test("a formula only a component reads is in that component's module, once", () => {
    // No page reads `quadruple`, so every page dropped its copy (compiler.md §8.1).
    expect(html("counted")).not.toContain("quadruple");
    const quad = component("quad-counter");
    expect(quad.split("this.state.quadruple = ")).toHaveLength(2);
    // And what it calls came with it.
    expect(quad.split("this.state.double = ")).toHaveLength(2);
    expect(quad).not.toContain("this.state.formatDate = ");
  });

  test("a component that calls no project formula is compiled as it was", async () => {
    const { files } = await compileElement(structuredClone(PLAIN_NOTE));
    expect(component("plain-note")).toBe(files[0]!.content);
  });

  test("the component's own entry shadows the project's", () => {
    expect(html("counted")).toContain('<output id="own">30</output>');
    const own = component("own-double");
    expect(own.split("this.state.double = ")).toHaveLength(2);
    expect(own).toContain("_args.n * 10");
    expect(own).not.toContain("_args.n * 2");
  });

  test("project data state does not reach a component", () => {
    expect(html("counted")).not.toContain("Probe]");
    const own = component("own-double");
    expect(own).not.toContain("Probe");
    expect(own).not.toContain("brand:");
  });

  test("a component nested in a component inherits as well", () => {
    const plain = html("plain");
    expect(plain).toContain("<b>42</b>");
    expect(plain).toContain("<time>January 2, 2026</time>");
  });

  test("a project with no state builds the component as it always did", async () => {
    // Nothing to inherit, so the call has no callee: the element is empty, as before.
    expect(read(BARE, "stamped/index.html")).toContain("<time></time>");
    const { files } = await compileElement(structuredClone(DATE_STAMP));
    expect(read(BARE, "components/date-stamp.js")).toBe(files[0]!.content);
    expect(files[0]!.content).not.toContain("this.state.formatDate = ");
  });
});

describe("a project formula called inside a component: the emitted element", () => {
  test("hydrates the prerendered instance to the same value, and follows a prop", async () => {
    await import(resolve(TMP, "dist/components/quad-counter.js"));
    const [, instance] = html("counted").match(/(<quad-counter.*?<\/quad-counter>)/s) ?? [];
    win.document.body.innerHTML = instance ?? "";
    const host = rendered(win.document.querySelector("quad-counter"), "quad-counter");
    await settle();
    expect(host.querySelector("output")?.textContent).toBe("8");

    /* SAFETY: the compiled element class assigns its reactive record to `state`. */
    (host as Element & { state: { n: number } }).state.n = 5;
    await settle();
    expect(host.querySelector("output")?.textContent).toBe("20");
  });

  test("the component's own formula is the one its element calls", async () => {
    await import(resolve(TMP, "dist/components/own-double.js"));
    win.document.body.innerHTML = "<own-double></own-double>";
    const host = rendered(win.document.querySelector("own-double"), "own-double");
    await settle();
    expect(host.querySelector("#own")?.textContent).toBe("30");
    expect(host.querySelector("#data")?.textContent).toBe("[]");
  });
});

describe("inheritProjectFormulas", () => {
  const stateOf = (doc: JxDocument) =>
    Object.keys(inheritProjectFormulas(doc, PROJECT_STATE).state ?? {});

  test("merges only what the component reads, under its own state", () => {
    expect(stateOf(DATE_STAMP)).toEqual(["formatDate", "date"]);
    expect(stateOf(QUAD_COUNTER)).toEqual(["double", "quadruple", "bump", "clicks", "n"]);
  });

  test("answers the document itself when nothing is inherited", () => {
    expect(inheritProjectFormulas(PLAIN_NOTE, PROJECT_STATE)).toBe(PLAIN_NOTE);
    expect(inheritProjectFormulas(DATE_STAMP, null)).toBe(DATE_STAMP);
    expect(inheritProjectFormulas(DATE_STAMP, {})).toBe(DATE_STAMP);
    // Every inheritable name is one the component declares.
    const all = {
      state: { double, formatDate, quadruple },
      tagName: "all-own",
    } satisfies JxDocument;
    expect(inheritProjectFormulas(all, PROJECT_STATE)).toBe(all);
  });

  test("never replaces an entry the component declares, even one a formula calls", () => {
    const doc = {
      children: [{ tagName: "p", textContent: "${state.quadruple(1)}" }],
      state: { double: 7 },
      tagName: "own-entry",
    } satisfies JxDocument;
    const merged = inheritProjectFormulas(doc, PROJECT_STATE);
    const state: Record<string, JxStateDefinition> = merged.state;
    expect(Object.keys(state)).toEqual(["quadruple", "double"]);
    expect(state.double).toBe(7);
    expect(state.quadruple).toBe(quadruple);
  });

  test("leaves data state, impure callables and formulas that read data on the project", () => {
    const doc = {
      children: [
        { tagName: "p", textContent: "${state.brand}${state.shout('a')}${state.withSite('b')}" },
        { onclick: { $ref: "#/state/bumpBy" }, tagName: "button" },
      ],
      tagName: "reads-all",
    } satisfies JxDocument;
    expect(inheritProjectFormulas(doc, PROJECT_STATE)).toBe(doc);
  });

  test("a component with a $src Function inherits every formula, its reads being unseen", () => {
    const doc = {
      state: { go: { $prototype: "Function", $src: "./go.js" } },
      tagName: "side-car",
    } satisfies JxDocument;
    expect(stateOf(doc)).toEqual(["double", "formatDate", "quadruple", "go"]);
  });

  test("compileElement merges for a component and its $elements dependencies", async () => {
    const { files } = await compileElement(resolve(TMP, "components/stamp-card.json"), {
      projectState: PROJECT_STATE,
    });
    const byTag = new Map(files.map((f) => [f.tagName, f.content]));
    expect(byTag.get("stamp-card")).toContain("this.state.double = ");
    expect(byTag.get("date-stamp")).toContain("this.state.formatDate = ");
  });
});
