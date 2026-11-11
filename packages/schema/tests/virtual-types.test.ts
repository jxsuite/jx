/**
 * The file a checker reads for one function body (`spec.md` §23.3): what `State` says, which names
 * the function is called with, and that a position in the file maps back to the body.
 */
import { describe, expect, test } from "bun:test";
import type { JsonValue, JxElement } from "../types";
import {
  UNRESOLVED_MODULE_CODES,
  bodyOffsetOf,
  generateBodyTypes,
} from "../src/jxn/virtual-types.ts";
import { BOTH, EVENT_GLOBALS, eventOn } from "./event-types.ts";

/** A document literal; each test decides what it holds. */
function asDoc(value: JsonValue): JxElement {
  // SAFETY: every JxElement member is optional, and each test here decides what it holds.
  return value as JxElement;
}

/** The lines of a generated file. */
const linesOf = (text: string): string[] => text.split("\n");

/** The index signatures of the `State` interface. */
const signaturesOf = (text: string): string[] =>
  linesOf(text).filter((line) => line.trim().startsWith("["));

/** Every interface a generated file declares before the function, line for line. */
function declarationsOf(text: string): string[] {
  const lines = linesOf(text);
  const end = lines.findIndex((line) => line.startsWith("declare ") || line.startsWith("async "));
  return lines.slice(lines.indexOf("export {};") + 1, end);
}

/** The lines that say what a body's event is: its declaration and the function's signature. */
const eventOf = (text: string): string[] =>
  linesOf(text).filter(
    (line) => line.startsWith("declare const event") || line.startsWith("async function body"),
  );

/** The members of the `State` interface, one per line, without the index signature. */
function stateOf(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf("interface State {");
  const end = lines.indexOf("}", start);
  return lines
    .slice(start + 1, end)
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("["));
}

describe("State", () => {
  test("is what the document proves: literals, shapes and items", () => {
    const doc = asDoc({
      state: {
        count: 0,
        empty: {},
        flag: false,
        items: [{ id: 1, name: "a" }],
        mixed: [1, "a"],
        nested: { a: { b: [true] } },
        none: [],
        nothing: null,
        "odd key": 1,
        title: "x",
      },
    });
    const { text } = generateBodyTypes(doc, { key: "count", kind: "state" }, "");
    expect(stateOf(text)).toEqual([
      "count: number;",
      "empty: Record<string, any>;",
      "flag: boolean;",
      "items: { id: number; name: string }[];",
      "mixed: (number | string)[];",
      "nested: { a: { b: boolean[] } };",
      "none: any[];",
      "nothing: any;",
      '"odd key": number;',
      "title: string;",
    ]);
  });

  test("leaves what a document does not determine as any", () => {
    const doc = asDoc({
      state: {
        data: { $prototype: "Request", url: "/x" },
        deep: { a: { b: { c: { d: { e: 1 } } } } },
        formula: { $expression: { operator: "+", target: [1, 2] } },
        remote: { $export: "r", $src: "./s.js", timing: "server" },
        tpl: "Hello ${state.name}",
        wide: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ [`k${n}`]: n })),
      },
    });
    expect(stateOf(generateBodyTypes(doc, { key: "tpl", kind: "state" }, "").text)).toEqual([
      "data: any;",
      "deep: { a: { b: { c: { d: any } } } };",
      "formula: any;",
      "remote: any;",
      "tpl: any;",
      "wide: any[];",
    ]);
  });

  test("reads an expanded signal and a pure type definition", () => {
    const doc = asDoc({
      state: {
        a: { default: 5 },
        b: { default: null, type: "string" },
        c: { type: "integer" },
        d: { type: "boolean" },
        e: { type: "array" },
        f: { type: "object" },
      },
    });
    expect(stateOf(generateBodyTypes(doc, { key: "a", kind: "state" }, "").text)).toEqual([
      "a: number;",
      "b: string;",
      "c: number;",
      "d: boolean;",
      "e: any[];",
      "f: { [key: string]: any; };",
    ]);
  });

  test("reads the schema a typed entry declares, in type or beside it", () => {
    const doc = asDoc({
      state: {
        a: { default: [], type: { items: { type: "string" }, type: "array" } },
        b: { default: "idle", enum: ["idle", "loading"], type: "string" },
        c: { default: null, type: ["string", "null"] },
        d: { properties: { id: { type: "integer" } }, required: ["id"], type: "object" },
        e: { default: 1, type: { anyOf: [{ type: "number" }, { type: "string" }] } },
      },
    });
    expect(stateOf(generateBodyTypes(doc, { key: "a", kind: "state" }, "").text)).toEqual([
      "a: string[];",
      'b: "idle" | "loading";',
      "c: string | null;",
      "d: { id: number; };",
      "e: number | string;",
    ]);
  });

  test("reads the value written beside a type that says nothing of what it holds", () => {
    const doc = asDoc({
      state: {
        a: { default: [1, 2], type: "array" },
        b: { default: { x: 1 }, type: "object" },
        c: { default: [], type: "array" },
        d: { default: null, type: "object" },
        e: { default: "x", format: "image" },
        f: { default: 1, type: "string" },
      },
    });
    expect(stateOf(generateBodyTypes(doc, { key: "a", kind: "state" }, "").text)).toEqual([
      "a: number[];",
      "b: { x: number };",
      "c: any[];",
      "d: { [key: string]: any; };",
      "e: string;",
      "f: string;",
    ]);
  });

  test("names a definition the document holds, which the file declares before State", () => {
    const doc = asDoc({
      $defs: {
        Item: { properties: { id: { type: "integer" } }, required: ["id"], type: "object" },
      },
      state: {
        items: { default: [], type: { items: { $ref: "#/$defs/Item" }, type: "array" } },
        one: { default: null, type: { $ref: "#/$defs/Item" } },
      },
    });
    const { text } = generateBodyTypes(doc, { key: "items", kind: "state" }, "");
    expect(declarationsOf(text).slice(0, 3)).toEqual([
      "namespace $defs {",
      "  export type Item = { id: number; };",
      "}",
    ]);
    expect(stateOf(text)).toEqual(["items: $defs.Item[];", "one: $defs.Item;"]);
  });

  test("reads a reference as any in a document that holds no definitions", () => {
    const doc = asDoc({
      state: { one: { default: null, type: { $ref: "#/$defs/Item" } } },
    });
    const { text } = generateBodyTypes(doc, { key: "one", kind: "state" }, "");
    expect(text).not.toContain("namespace");
    expect(stateOf(text)).toEqual(["one: any;"]);
  });

  test("types a callable and a computed Function entry differently", () => {
    const doc = asDoc({
      onclick: { $ref: "#/state/save" },
      state: {
        double: { $prototype: "Function", body: "return state.n * 2;" },
        n: 1,
        save: { $prototype: "Function", body: "state.n = 0;" },
      },
    });
    expect(stateOf(generateBodyTypes(doc, { key: "save", kind: "state" }, "").text)).toEqual([
      "double: any;",
      "n: number;",
      "save: (...args: any[]) => any;",
    ]);
  });

  test("is closed to a name the document does not declare, and open to $ members", () => {
    const { text } = generateBodyTypes(asDoc({ state: { a: 1 } }), { key: "a", kind: "state" }, "");
    expect(signaturesOf(text)).toEqual(["  [key: `$${string}`]: any;"]);
  });

  test("is open when a layout supplies state the page does not name", () => {
    const { text } = generateBodyTypes(
      asDoc({ $layout: "./layout.json", state: { a: 1 } }),
      { key: "a", kind: "state" },
      "",
    );
    expect(signaturesOf(text)).toEqual(["  [key: string]: any;"]);
  });

  test("is closed for a page that says it has no layout", () => {
    const { text } = generateBodyTypes(
      asDoc({ $layout: false, state: { a: 1 } }),
      { key: "a", kind: "state" },
      "",
    );
    expect(signaturesOf(text)).toEqual(["  [key: `$${string}`]: any;"]);
  });
});

describe("the names a function is called with", () => {
  const doc = asDoc({
    state: {
      a: { $prototype: "Function", body: "" },
      b: { $prototype: "Function", body: "", parameters: ["event"] },
      c: { $prototype: "Function", body: "", parameters: ["state", { name: "n" }] },
      d: { $prototype: "Function", body: "", arguments: ["x", 1] },
      e: { $prototype: "Function", body: "", parameters: ["a", "state", "b"] },
    },
  });
  const paramsOf = (key: string): string[] =>
    generateBodyTypes(doc, { key, kind: "state" }, "").params;

  test("are state first, then the declared names", () => {
    expect(paramsOf("a")).toEqual(["state"]);
    expect(paramsOf("b")).toEqual(["state", "event"]);
    expect(paramsOf("c")).toEqual(["state", "n"]);
    expect(paramsOf("d")).toEqual(["state", "x"]);
    expect(paramsOf("missing")).toEqual(["state"]);
  });

  test("move a declared state to the front, as the runtime does, and never repeat it", () => {
    expect(paramsOf("e")).toEqual(["state", "a", "b"]);
  });

  test("type state as State and the rest as any, and leave event usable when undeclared", () => {
    const { text } = generateBodyTypes(doc, { key: "b", kind: "state" }, "");
    expect(linesOf(text).filter((line) => line.includes("event"))).toEqual([
      "declare const event: any;",
      "async function body(this: any, state: State, event: any) {",
    ]);
  });
});

describe("an inline handler", () => {
  const doc = asDoc({
    children: [
      {
        children: [
          {
            onclick: {
              $prototype: "Function",
              body: "state.inner = 1;",
              parameters: ["state", "e"],
            },
            tagName: "button",
          },
        ],
        state: { inner: 0, shared: "inner wins" },
        tagName: "section",
      },
    ],
    state: { shared: 1, top: true },
  });
  const target = {
    eventKey: "onclick",
    kind: "event",
    path: ["children", 0, "children", 0],
  } as const;

  test("sees its ancestors' state, the nearest element winning", () => {
    const unit = generateBodyTypes(doc, target, "state.inner = 1;");
    // An interface cannot extend one it disagrees with, so what it keeps is listed by reference.
    expect(declarationsOf(unit.text)).toEqual([
      "interface State$0 {",
      "  shared: number;",
      "  top: boolean;",
      "  [key: `$${string}`]: any;",
      "}",
      "interface State {",
      '  top: State$0["top"];',
      "  inner: number;",
      "  shared: string;",
      "  [key: `$${string}`]: any;",
      "}",
    ]);
    expect(unit.params).toEqual(["state", "e"]);
  });

  test("reads a State that extends the one around it where no name is declared twice", () => {
    const nested = asDoc({
      children: [
        {
          children: [{ onclick: { $prototype: "Function", body: "" }, tagName: "button" }],
          state: { inner: 0 },
          tagName: "section",
        },
      ],
      state: { top: true },
    });
    expect(declarationsOf(generateBodyTypes(nested, target, "").text)).toEqual([
      "interface State$0 {",
      "  top: boolean;",
      "  [key: `$${string}`]: any;",
      "}",
      "interface State extends State$0 {",
      "  inner: number;",
      "}",
    ]);
  });

  test("reads a path that leaves the document as the root alone", () => {
    const unit = generateBodyTypes(doc, { ...target, path: ["children", 5, "children", 0] }, "");
    expect(stateOf(unit.text)).toEqual(["shared: number;", "top: boolean;"]);
    expect(unit.params).toEqual(["state"]);
    expect(generateBodyTypes(doc, { ...target, path: ["children", 0, 1] }, "").params).toEqual([
      "state",
    ]);
  });
});

describe("a handler drawn by a map", () => {
  const handler = { $prototype: "Function", body: "" };
  const doc = asDoc({
    children: [
      {
        $prototype: "Array",
        items: { $ref: "#/state/todos" },
        map: {
          children: [
            {
              $prototype: "Array",
              items: { $ref: "$map/item/tags" },
              map: { onclick: handler, tagName: "span" },
            },
          ],
          onclick: handler,
          tagName: "li",
        },
      },
    ],
    state: { todos: [{ done: false, tags: ["a"] }] },
    tagName: "ul",
  });
  const row = ["children", 0, "map"] as const;
  const item =
    "(NonNullable<(State$0 extends { todos: infer V } ? V : any)> extends readonly (infer I)[] ? I : any)";

  test("reads the row it is drawn for as $map, over the state around it", () => {
    const { text } = generateBodyTypes(doc, { eventKey: "onclick", kind: "event", path: row }, "");
    expect(declarationsOf(text)).toEqual([
      "interface State$0 {",
      "  todos: { done: boolean; tags: string[] }[];",
      "  [key: `$${string}`]: any;",
      "}",
      "interface State extends State$0 {",
      `  $map: { item: ${item}; index: number };`,
      "}",
    ]);
  });

  test("reads the row of the nearest map, whose list may be read off the row around it", () => {
    const path = [...row, "children", 0, "map"];
    const { text } = generateBodyTypes(doc, { eventKey: "onclick", kind: "event", path }, "");
    const tags = `(NonNullable<${item}> extends { tags: infer V } ? V : any)`;
    expect(declarationsOf(text).slice(-3)).toEqual([
      "interface State extends State$0 {",
      `  $map: { item: (NonNullable<${tags}> extends readonly (infer I)[] ? I : any); index: number };`,
      "}",
    ]);
  });

  test("is told nothing of $map where the document's own state has one", () => {
    const own: JxElement = { ...doc, state: { $map: 1, todos: [] } };
    const { text } = generateBodyTypes(own, { eventKey: "onclick", kind: "event", path: row }, "");
    expect(declarationsOf(text)).toEqual([
      "interface State {",
      "  $map: number;",
      "  todos: any[];",
      "  [key: `$${string}`]: any;",
      "}",
    ]);
  });
});

describe("the event a handler is given", () => {
  const click = eventOn("button", "click", BOTH);
  const target = { eventKey: "onclick", kind: "event", path: ["children", 0] } as const;
  const button = (parameters: string[]): JxElement =>
    asDoc({
      children: [{ onclick: { $prototype: "Function", body: "", parameters }, tagName: "button" }],
    });

  test("is the platform's for the binding, on the platform's element for the tag", () => {
    const { text } = generateBodyTypes(button(["e"]), target, "");
    expect(eventOf(text)).toEqual([
      `declare const event: ${click};`,
      "async function body(this: any, state: State, e: typeof event) {",
    ]);
    // A project without the DOM library still has the interfaces the lookup reads.
    expect(linesOf(text).slice(4, 9)).toEqual(EVENT_GLOBALS);
  });

  test("is declared as event where the handler names no parameter for it", () => {
    const { text } = generateBodyTypes(button([]), target, "");
    expect(eventOf(text)).toEqual([
      `declare const event: ${click};`,
      "async function body(this: any, state: State) {",
    ]);
  });

  test("is written on a parameter called event, which hides the declared one", () => {
    const { text } = generateBodyTypes(button(["event", "more"]), target, "");
    expect(eventOf(text)).toEqual([
      `async function body(this: any, state: State, event: ${click}, more: any) {`,
    ]);
  });

  test("is any on an element with no tag", () => {
    const doc = asDoc({ children: [{ onclick: { $prototype: "Function", body: "" } }] });
    expect(eventOf(generateBodyTypes(doc, target, "").text)).toEqual([
      "declare const event: any;",
      "async function body(this: any, state: State) {",
    ]);
  });

  test("is the binding's for a state function a handler names, and any once it is named elsewhere", () => {
    const save = { $prototype: "Function", body: "", parameters: ["e"] };
    const bound = asDoc({
      children: [{ onclick: { $ref: "#/state/save" }, tagName: "button" }],
      state: { save },
    });
    expect(eventOf(generateBodyTypes(bound, { key: "save", kind: "state" }, "").text)).toEqual([
      `declare const event: ${click};`,
      "async function body(this: any, state: State, e: typeof event) {",
    ]);
    const called: JxElement = {
      ...bound,
      state: { other: { $prototype: "Function", body: "state.save(1)" }, save },
    };
    expect(eventOf(generateBodyTypes(called, { key: "save", kind: "state" }, "").text)).toEqual([
      "declare const event: any;",
      "async function body(this: any, state: State, e: any) {",
    ]);
  });
});

describe("positions", () => {
  const body = "const n = 1;\nstate.nope = n;";
  const unit = generateBodyTypes(asDoc({ state: { a: 1 } }), { key: "a", kind: "state" }, body);

  test("hold the body verbatim, so a position is one shift", () => {
    expect(unit.text.slice(unit.bodyStart, unit.bodyEnd)).toBe(body);
    // `nope` follows the first line and `state.`.
    const before = "const n = 1;\nstate.".length;
    expect(bodyOffsetOf(unit, unit.bodyStart + before)).toBe(before);
  });

  test("outside the body are the wrapper's, which the author did not write", () => {
    expect(bodyOffsetOf(unit, 0)).toBeNull();
    expect(bodyOffsetOf(unit, unit.bodyEnd + 1)).toBeNull();
    expect(bodyOffsetOf(unit, unit.bodyStart)).toBe(0);
    expect(bodyOffsetOf(unit, unit.bodyEnd)).toBe(body.length);
  });

  test("a missing module is not the author's to fix", () => {
    expect(UNRESOLVED_MODULE_CODES.has(2307)).toBe(true);
    expect(UNRESOLVED_MODULE_CODES.has(2339)).toBe(false);
  });
});
