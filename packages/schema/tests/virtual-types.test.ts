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
      "f: any;",
    ]);
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
    expect(stateOf(unit.text)).toEqual(["shared: string;", "top: boolean;", "inner: number;"]);
    expect(unit.params).toEqual(["state", "e"]);
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
