/**
 * Command-args — the runtime half of every command's `args` JSON Schema.
 *
 * The assertions that matter are the MESSAGES, not the throws: plan §13.5's headline failure
 * ("names panel 'head'; the registry declares 'page'") is only a sentence a reader can act on
 * because {@link enumArg} prints the declared set. A test that only asserted `toThrow()` would let
 * that regress silently, so every refusal here is matched against its text.
 *
 * The second half is {@link coerceArgs}, the pass `registry.run` makes over every received record
 * before `run`. Its cases are one per row of the dispatch table, each asserting the sentence is the
 * READER's own — and a sweep over every schema `appCommandSet()` ships, so a property shape no
 * reader exists for cannot reach the registry as a silent pass-through.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  argsSchema,
  booleanArg,
  booleanProperty,
  boundedNumberArg,
  coerceArgs,
  derivedEnumProperty,
  describeShape,
  enumArg,
  enumProperty,
  nullablePathArg,
  numberArg,
  numberProperty,
  optionalStringArg,
  pathArg,
  pathListProperty,
  pathProperty,
  stringArg,
  stringProperty,
  typedArg,
} from "../src/commands/command-args";
import type { CoercionRow } from "../src/commands/command-args";
import { appCommandSet } from "../src/commands/app-commands";

describe("stringArg", () => {
  test("returns a non-empty string", () => {
    expect(stringArg("x.y", { name: "posts" }, "name")).toBe("posts");
  });

  test("refuses a missing value by name, and says which command asked", () => {
    expect(() => stringArg("data.expandRow", {}, "name")).toThrow(
      'command "data.expandRow" argument "name": expected a non-empty string, got missing',
    );
  });

  test("refuses the empty string — an unset field is not a value", () => {
    expect(() => stringArg("x.y", { name: "" }, "name")).toThrow("expected a non-empty string");
  });

  test("quotes back a wrong-typed value with its type", () => {
    expect(() => stringArg("x.y", { name: 7 }, "name")).toThrow("got number 7");
  });
});

describe("optionalStringArg", () => {
  test("undefined stays undefined", () => {
    expect(optionalStringArg("x.y", {}, "section")).toBeUndefined();
  });

  test("a present value is validated like a required one", () => {
    expect(optionalStringArg("x.y", { section: "head" }, "section")).toBe("head");
    expect(() => optionalStringArg("x.y", { section: null }, "section")).toThrow(
      "expected a non-empty string",
    );
  });
});

describe("numberArg", () => {
  test("accepts finite numbers, including zero and negatives", () => {
    expect(numberArg("x.y", { zoom: 0 }, "zoom")).toBe(0);
    expect(numberArg("x.y", { zoom: -1.5 }, "zoom")).toBe(-1.5);
  });

  test("refuses NaN and Infinity — neither is a zoom", () => {
    expect(() => numberArg("x.y", { zoom: Number.NaN }, "zoom")).toThrow(
      "expected a finite number",
    );
    expect(() => numberArg("x.y", { zoom: Number.POSITIVE_INFINITY }, "zoom")).toThrow(
      "expected a finite number",
    );
  });

  test("refuses a numeric string — coercion is what hides a mistyped step", () => {
    expect(() => numberArg("canvas.setZoom", { zoom: "0.8" }, "zoom")).toThrow('got "0.8"');
  });
});

describe("boundedNumberArg", () => {
  test("passes a value inside the interval through, endpoints included", () => {
    expect(boundedNumberArg("x.y", { zoom: 0.05 }, "zoom", 0.05, 5)).toBe(0.05);
    expect(boundedNumberArg("x.y", { zoom: 5 }, "zoom", 0.05, 5)).toBe(5);
  });

  test("REJECTS rather than clamping, and names the range", () => {
    expect(() => boundedNumberArg("canvas.setZoom", { zoom: 10 }, "zoom", 0.05, 5)).toThrow(
      'command "canvas.setZoom" argument "zoom": 10 is outside the supported range 0.05–5',
    );
    expect(() => boundedNumberArg("canvas.setZoom", { zoom: 0 }, "zoom", 0.05, 5)).toThrow(
      "outside the supported range",
    );
  });
});

describe("booleanArg", () => {
  test("false is a value, not an absence", () => {
    expect(booleanArg("view.setAssistant", { open: false }, "open")).toBe(false);
    expect(booleanArg("view.setAssistant", { open: true }, "open")).toBe(true);
  });

  test("refuses a missing flag — a setter with a default is a toggle in disguise", () => {
    expect(() => booleanArg("view.setAssistant", {}, "open")).toThrow(
      'command "view.setAssistant" argument "open": expected a boolean, got missing',
    );
  });

  test('refuses the string "false"', () => {
    expect(() => booleanArg("x.y", { open: "false" }, "open")).toThrow('got "false"');
  });
});

describe("enumArg", () => {
  const panels = ["files", "layers", "page"] as const;

  test("returns a declared value", () => {
    expect(enumArg("view.setActivity", { tab: "layers" }, "tab", panels)).toBe("layers");
  });

  test("the refusal prints the declared set — this is §13.5's headline message", () => {
    expect(() => enumArg("view.setActivity", { tab: "head" }, "tab", panels)).toThrow(
      'command "view.setActivity" argument "tab": "head" is not declared — declared: ' +
        "files, layers, page",
    );
  });

  test("a missing value is refused the same way", () => {
    expect(() => enumArg("view.setActivity", {}, "tab", panels)).toThrow(
      "missing is not declared — declared: files, layers, page",
    );
  });

  test("an empty set prints 'none' — a derived list before its project is honestly empty", () => {
    expect(() => enumArg("project.enableExtension", { package: "@acme/x" }, "package", [])).toThrow(
      'command "project.enableExtension" argument "package": "@acme/x" is not declared — ' +
        "declared: none",
    );
  });
});

describe("pathArg", () => {
  test("the empty array is the document root and is legal", () => {
    expect(pathArg("selection.set", { path: [] }, "path")).toEqual([]);
  });

  test("accepts mixed keys and indexes", () => {
    expect(pathArg("selection.set", { path: ["children", 0] }, "path")).toEqual(["children", 0]);
  });

  test("refuses a non-array", () => {
    expect(() => pathArg("selection.set", { path: "children/0" }, "path")).toThrow(
      "expected an array of path segments",
    );
  });

  test("refuses an array holding a non-segment", () => {
    expect(() => pathArg("selection.set", { path: ["children", {}] }, "path")).toThrow(
      "expected an array of path segments",
    );
  });
});

describe("nullablePathArg", () => {
  test("null clears the selection", () => {
    expect(nullablePathArg("selection.set", { path: null }, "path")).toBeNull();
  });

  test("anything else goes through pathArg", () => {
    expect(nullablePathArg("selection.set", { path: [1] }, "path")).toEqual([1]);
    expect(() => nullablePathArg("selection.set", { path: 3 }, "path")).toThrow(
      "expected an array of path segments",
    );
  });
});

describe("schema fragments", () => {
  test("argsSchema requires every property by default and forbids extras", () => {
    const schema = argsSchema({ tab: enumProperty(["a", "b"], "Which tab.") });
    expect(schema).toEqual({
      additionalProperties: false,
      properties: { tab: { description: "Which tab.", enum: ["a", "b"], type: "string" } },
      required: ["tab"],
      type: "object",
    });
  });

  test("argsSchema takes an explicit required list for optional arguments", () => {
    const schema = argsSchema({ section: stringProperty("A section.") }, []) as {
      required: string[];
    };
    expect(schema.required).toEqual([]);
  });

  test("enumProperty copies the declared array — the schema cannot alias live state", () => {
    const declared = ["a", "b"];
    const prop = enumProperty(declared, "d") as { enum: string[] };
    declared.push("c");
    expect(prop.enum).toEqual(["a", "b"]);
  });

  test("numberProperty carries the bounds the coercion enforces", () => {
    expect(numberProperty("Zoom.", { maximum: 5, minimum: 0.05 })).toEqual({
      description: "Zoom.",
      maximum: 5,
      minimum: 0.05,
      type: "number",
    });
    expect(numberProperty("Zoom.")).toEqual({ description: "Zoom.", type: "number" });
  });

  test("booleanProperty carries the sense in its description", () => {
    expect(booleanProperty("True to open.")).toEqual({
      description: "True to open.",
      type: "boolean",
    });
  });

  test("pathProperty is an array of segments, and nullable on request", () => {
    expect(pathProperty("A path.")).toEqual({
      description: "A path.",
      items: { type: ["string", "number"] },
      type: "array",
    });
    expect(pathProperty("A path.", true)).toEqual({
      description: "A path.",
      oneOf: [{ items: { type: ["string", "number"] }, type: "array" }, { type: "null" }],
    });
  });

  test("stringProperty is a plain string with its sentence", () => {
    expect(stringProperty("A name.")).toEqual({ description: "A name.", type: "string" });
  });
});

describe("typedArg", () => {
  test("admits a value of any listed JSON type, null only when listed", () => {
    expect(typedArg("canvas.setEditWidth", { width: 640 }, "width", ["number", "null"])).toBe(640);
    expect(
      typedArg("canvas.setEditWidth", { width: null }, "width", ["number", "null"]),
    ).toBeNull();
    expect(() => typedArg("x.y", { v: null }, "v", ["number"])).toThrow(
      'command "x.y" argument "v": expected number, got object null',
    );
  });

  test("the refusal lists the types as prose and quotes the value back", () => {
    expect(() =>
      typedArg("canvas.setEditWidth", { width: "wide" }, "width", ["number", "null"]),
    ).toThrow(
      'command "canvas.setEditWidth" argument "width": expected number or null, got "wide"',
    );
    expect(() => typedArg("x.y", {}, "v", ["string", "number", "boolean"])).toThrow(
      "expected string, number or boolean, got missing",
    );
  });

  test("number means finite, integer means whole, object means neither array nor null", () => {
    expect(() => typedArg("x.y", { v: Number.NaN }, "v", ["number", "null"])).toThrow(
      "expected number or null",
    );
    expect(typedArg("x.y", { v: 2 }, "v", ["integer"])).toBe(2);
    expect(() => typedArg("x.y", { v: 2.5 }, "v", ["integer"])).toThrow("expected integer");
    expect(typedArg("x.y", { v: { a: 1 } }, "v", ["object"])).toEqual({ a: 1 });
    expect(() => typedArg("x.y", { v: [1] }, "v", ["object"])).toThrow("expected object");
    expect(typedArg("x.y", { v: [1] }, "v", ["array"])).toEqual([1]);
    expect(() => typedArg("x.y", { v: 1 }, "v", ["nonsense"])).toThrow("expected nonsense");
  });
});

describe("describeShape — which reader a property's shape names", () => {
  const rows: [string, object, CoercionRow][] = [
    ["a declared enum", enumProperty(["a"], "d"), "enum"],
    ["a derived enum", derivedEnumProperty(() => ["a"], "d"), "enum"],
    ["a const", { const: 1, description: "d" }, "const"],
    ["a oneOf", pathProperty("d", true), "one-of"],
    ["a type list", { description: "d", type: ["number", "null"] }, "typed"],
    ["a bare null type", { type: "null" }, "typed"],
    ["a bare object type", { type: "object" }, "typed"],
    ["a boolean", booleanProperty("d"), "boolean"],
    ["a bounded number", numberProperty("d", { maximum: 5, minimum: 0.05 }), "bounded-number"],
    ["an integer with bounds", { maximum: 9, minimum: 1, type: "integer" }, "bounded-number"],
    ["a plain number", numberProperty("d"), "number"],
    ["a half-open number", numberProperty("d", { minimum: 0 }), "number"],
    ["a string", stringProperty("d"), "string"],
    ["a path", pathProperty("d"), "path"],
    ["a path list", pathListProperty("d"), "path-list"],
    ["an array of something else", { items: { type: "string" }, type: "array" }, "pass-through"],
    // A type list on the items is not enough: the `path` row is `JxPath`'s string|number exactly,
    // Because `pathArg` refuses a null segment and would read this shape wrongly.
    [
      "an array whose items admit null",
      { items: { type: ["string", "null"] }, type: "array" },
      "pass-through",
    ],
    [
      "a path with its segment types the other way round",
      { items: { type: ["number", "string"] }, type: "array" },
      "path",
    ],
    ["a description alone", { description: "d" }, "pass-through"],
  ];

  test.each(rows)("%s", (_label, property, row) => {
    expect(describeShape(property)).toBe(row);
  });

  test("classifying a derived enum does not read its getter", () => {
    let reads = 0;
    const property = {
      description: "d",
      get enum() {
        reads += 1;
        return ["a"];
      },
      type: "string",
    };
    expect(describeShape(property)).toBe("enum");
    expect(reads).toBe(0);
  });
});

describe("coerceArgs — the pass registry.run makes before run", () => {
  test("a key the schema does not declare is refused, and the sentence lists what is", () => {
    const schema = argsSchema({ tab: enumProperty(["files", "layers"], "Which panel.") });
    expect(() => coerceArgs("view.setActivity", schema, { tab: "files", panel: "head" })).toThrow(
      'command "view.setActivity" argument "panel": not declared — declared: tab',
    );
    expect(() => coerceArgs("a.one", argsSchema({}), { x: 1 })).toThrow(
      'command "a.one" argument "x": not declared — declared: none',
    );
  });

  test("an undeclared key is kept when the schema leaves additionalProperties open", () => {
    const schema = { properties: { tab: stringProperty("d") }, type: "object" };
    expect(coerceArgs("a.one", schema, { tab: "x", extra: 1 })).toEqual({ extra: 1, tab: "x" });
  });

  test("a required key that is absent reads the reader's own 'missing' sentence", () => {
    const schema = argsSchema({ tab: enumProperty(["files", "layers", "page"], "Which panel.") });
    expect(() => coerceArgs("view.setActivity", schema, {})).toThrow(
      'command "view.setActivity" argument "tab": missing is not declared — declared: ' +
        "files, layers, page",
    );
    expect(() =>
      coerceArgs("view.setAssistant", argsSchema({ open: booleanProperty("d") }), {}),
    ).toThrow('command "view.setAssistant" argument "open": expected a boolean, got missing');
  });

  test("an optional key that is absent is skipped, and an explicit undefined is an absence", () => {
    const schema = argsSchema({ pane: stringProperty("Which pane."), view: stringProperty("d") }, [
      "view",
    ]);
    expect(coerceArgs("diff.setView", schema, { view: "code" })).toEqual({ view: "code" });
    expect(coerceArgs("diff.setView", schema, { pane: undefined, view: "code" })).toEqual({
      view: "code",
    });
    // Present, it is read like a required one — the rule `optionalStringArg` already has.
    expect(() => coerceArgs("diff.setView", schema, { pane: "", view: "code" })).toThrow(
      'command "diff.setView" argument "pane": expected a non-empty string, got ""',
    );
  });

  test("the enum row is enumArg, sentence for sentence", () => {
    const schema = argsSchema({ tab: enumProperty(["files", "layers", "page"], "Which panel.") });
    expect(coerceArgs("view.setActivity", schema, { tab: "layers" })).toEqual({ tab: "layers" });
    expect(() => coerceArgs("view.setActivity", schema, { tab: "head" })).toThrow(
      'command "view.setActivity" argument "tab": "head" is not declared — declared: ' +
        "files, layers, page",
    );
  });

  test("a derived enum's getter is read AT COERCION TIME, so the list is the live one", () => {
    // The record is built once, before any project; the palette, the assistant and this pass all
    // Read the choice list when they need it. A list frozen at build time would refuse every
    // Value a project later supplied.
    let declared: string[] = [];
    const schema = argsSchema({
      package: derivedEnumProperty(() => declared, "The extension to turn on."),
    });
    expect(() =>
      coerceArgs("project.enableExtension", schema, { package: "@jxsuite/parser" }),
    ).toThrow(
      'command "project.enableExtension" argument "package": "@jxsuite/parser" is not ' +
        "declared — declared: none",
    );
    declared = ["@jxsuite/parser", "@jxsuite/search"];
    expect(coerceArgs("project.enableExtension", schema, { package: "@jxsuite/parser" })).toEqual({
      package: "@jxsuite/parser",
    });
  });

  test("the const row is equality, and names the constant", () => {
    const schema = argsSchema({ mode: { const: "design", description: "d" } });
    expect(coerceArgs("a.one", schema, { mode: "design" })).toEqual({ mode: "design" });
    expect(() => coerceArgs("a.one", schema, { mode: "edit" })).toThrow(
      'command "a.one" argument "mode": expected the constant "design", got "edit"',
    );
  });

  test("the boolean row is booleanArg", () => {
    const schema = argsSchema({ open: booleanProperty("True to open.") });
    expect(coerceArgs("view.setAssistant", schema, { open: false })).toEqual({ open: false });
    expect(() => coerceArgs("view.setAssistant", schema, { open: "false" })).toThrow(
      'command "view.setAssistant" argument "open": expected a boolean, got "false"',
    );
  });

  test("the bounded-number row is boundedNumberArg — it rejects, it does not clamp", () => {
    const schema = argsSchema({ zoom: numberProperty("Zoom.", { maximum: 5, minimum: 0.05 }) });
    expect(coerceArgs("canvas.setZoom", schema, { zoom: 2 })).toEqual({ zoom: 2 });
    expect(() => coerceArgs("canvas.setZoom", schema, { zoom: 10 })).toThrow(
      'command "canvas.setZoom" argument "zoom": 10 is outside the supported range 0.05–5',
    );
  });

  test("the number row is numberArg", () => {
    const schema = argsSchema({ zoom: numberProperty("Zoom.") });
    expect(coerceArgs("canvas.setZoom", schema, { zoom: -1.5 })).toEqual({ zoom: -1.5 });
    expect(() => coerceArgs("canvas.setZoom", schema, { zoom: "0.8" })).toThrow(
      'command "canvas.setZoom" argument "zoom": expected a finite number, got "0.8"',
    );
  });

  test("the string row is stringArg, so the empty string is refused", () => {
    const schema = argsSchema({ name: stringProperty("A name.") });
    expect(coerceArgs("data.expandRow", schema, { name: "posts" })).toEqual({ name: "posts" });
    expect(() => coerceArgs("data.expandRow", schema, { name: "" })).toThrow(
      'command "data.expandRow" argument "name": expected a non-empty string, got ""',
    );
    expect(() => coerceArgs("data.expandRow", schema, { name: 7 })).toThrow("got number 7");
  });

  test("the path row is pathArg — [] is the root and legal", () => {
    const schema = argsSchema({ path: pathProperty("A path.") });
    expect(coerceArgs("formula.editEvent", schema, { path: [] })).toEqual({ path: [] });
    expect(coerceArgs("formula.editEvent", schema, { path: ["children", 0] })).toEqual({
      path: ["children", 0],
    });
    expect(() => coerceArgs("formula.editEvent", schema, { path: "children/0" })).toThrow(
      'command "formula.editEvent" argument "path": expected an array of path segments ' +
        '(strings or numbers), got "children/0"',
    );
  });

  test("the path-list row is pathListArg, so one bare path is refused by entry", () => {
    const schema = argsSchema({ paths: pathListProperty("The paths.") });
    expect(coerceArgs("selection.setPaths", schema, { paths: [["children", 0]] })).toEqual({
      paths: [["children", 0]],
    });
    expect(() => coerceArgs("selection.setPaths", schema, { paths: ["children", 0] })).toThrow(
      'command "selection.setPaths" argument "paths": entry 0 is not a document path — expected ' +
        'an array of segments, got "children"',
    );
  });

  test("the typed row is typedArg — a type list admits null only when it lists it", () => {
    const schema = argsSchema({
      width: { description: "d", type: ["number", "null"] },
    });
    expect(coerceArgs("canvas.setEditWidth", schema, { width: null })).toEqual({ width: null });
    expect(coerceArgs("canvas.setEditWidth", schema, { width: 640 })).toEqual({ width: 640 });
    expect(() => coerceArgs("canvas.setEditWidth", schema, { width: "wide" })).toThrow(
      'command "canvas.setEditWidth" argument "width": expected number or null, got "wide"',
    );
    // `canvas.setTestProp`'s ladder: any JSON value, and the refusal is only for what JSON is not.
    const ladder = argsSchema({
      value: { description: "d", type: ["string", "number", "boolean", "array", "object", "null"] },
    });
    expect(coerceArgs("canvas.setTestProp", ladder, { value: { a: [1] } })).toEqual({
      value: { a: [1] },
    });
    expect(() => coerceArgs("canvas.setTestProp", ladder, { value: Number.NaN })).toThrow(
      "expected string, number, boolean, array, object or null",
    );
  });

  test("the oneOf row tries the branch that admits the value's type, and reads ITS sentence", () => {
    // `canvas.setFit`'s shape: a fit word, or a pan-zoom scale.
    const schema = argsSchema({
      fit: {
        description: "d",
        oneOf: [
          { enum: ["width", "page", "none"], type: "string" },
          { maximum: 5, minimum: 0.05, type: "number" },
        ],
      },
    });
    expect(coerceArgs("canvas.setFit", schema, { fit: "page" })).toEqual({ fit: "page" });
    expect(coerceArgs("canvas.setFit", schema, { fit: 2 })).toEqual({ fit: 2 });
    // A number out of range reads boundedNumberArg's sentence, not a list of shapes.
    expect(() => coerceArgs("canvas.setFit", schema, { fit: 10 })).toThrow(
      'command "canvas.setFit" argument "fit": 10 is outside the supported range 0.05–5',
    );
    // A string that is not a fit word reads enumArg's.
    expect(() => coerceArgs("canvas.setFit", schema, { fit: "huge" })).toThrow(
      'command "canvas.setFit" argument "fit": "huge" is not declared — declared: width, page, none',
    );
    // Only a value NO branch could take is answered with the shapes.
    expect(() => coerceArgs("canvas.setFit", schema, { fit: true })).toThrow(
      'command "canvas.setFit" argument "fit": expected one of "width" | "page" | "none" or a ' +
        "number from 0.05 to 5, got boolean true",
    );
  });

  test("a nullable path is a oneOf, and nullablePathArg's behaviour falls out of it", () => {
    const schema = argsSchema({ path: pathProperty("A path.", true) });
    expect(coerceArgs("selection.set", schema, { path: null })).toEqual({ path: null });
    expect(coerceArgs("selection.set", schema, { path: ["children", 1] })).toEqual({
      path: ["children", 1],
    });
    expect(() => coerceArgs("selection.set", schema, { path: 3 })).toThrow(
      'command "selection.set" argument "path": expected a document path or null, got number 3',
    );
    expect(() => coerceArgs("selection.set", schema, {})).toThrow(
      'command "selection.set" argument "path": expected a document path or null, got missing',
    );
  });

  test("a nullable string is a oneOf whose string branch keeps stringArg's refusal of the empty string", () => {
    const schema = argsSchema({
      selector: { description: "d", oneOf: [{ type: "string" }, { type: "null" }] },
    });
    expect(coerceArgs("style.setSelector", schema, { selector: null })).toEqual({ selector: null });
    expect(coerceArgs("style.setSelector", schema, { selector: ":hover" })).toEqual({
      selector: ":hover",
    });
    expect(() => coerceArgs("style.setSelector", schema, { selector: "" })).toThrow(
      'command "style.setSelector" argument "selector": expected a non-empty string, got ""',
    );
  });

  test("when two branches admit the type and both refuse, the shapes are listed", () => {
    const schema = argsSchema({
      v: {
        description: "d",
        oneOf: [
          { enum: ["a"], type: "string" },
          { enum: ["b"], type: "string" },
        ],
      },
    });
    expect(coerceArgs("x.y", schema, { v: "b" })).toEqual({ v: "b" });
    expect(() => coerceArgs("x.y", schema, { v: "c" })).toThrow(
      'command "x.y" argument "v": expected one of "a" or one of "b", got "c"',
    );
  });

  test("a branch with no type is always tried, and a nested oneOf prints its branches", () => {
    const schema = argsSchema({
      v: {
        description: "d",
        oneOf: [{ const: 1 }, { oneOf: [{ type: "boolean" }, { type: "null" }] }],
      },
    });
    expect(coerceArgs("x.y", schema, { v: 1 })).toEqual({ v: 1 });
    expect(coerceArgs("x.y", schema, { v: false })).toEqual({ v: false });
    expect(() => coerceArgs("x.y", schema, { v: "no" })).toThrow(
      'command "x.y" argument "v": expected the constant number 1 or a boolean or null, got "no"',
    );
  });

  test("a shaped branch no reader exists for prints as 'anything' in the listing", () => {
    // A `type: "array"` branch whose items are strings is not a path, so it is the pass-through
    // Row; it has a type, so the pre-check skips it for a number, and with no branch admitting the
    // Value and none refusing it in its own words, the listing is composed and names it.
    const schema = argsSchema({
      v: {
        description: "d",
        oneOf: [{ type: "string" }, { items: { type: "string" }, type: "array" }],
      },
    });
    expect(coerceArgs("x.y", schema, { v: ["a"] })).toEqual({ v: ["a"] });
    expect(() => coerceArgs("x.y", schema, { v: 42 })).toThrow(
      'command "x.y" argument "v": expected a non-empty string or anything, got number 42',
    );
  });

  test("the listing names every row's shape in one line, and 'anything' for the pass-through", () => {
    // No typed branch admits a plain object, so the sentence has to print each shape.
    const schema = argsSchema({
      v: {
        description: "d",
        oneOf: [
          { type: "boolean" },
          { type: "number" },
          { maximum: 9, minimum: 1, type: "integer" },
          { type: "string" },
          pathProperty("d"),
          pathListProperty("d"),
          { description: "anything at all" },
        ],
      },
    });
    // A branch with no `type` is always tried; the pass-through branch admits the value.
    expect(coerceArgs("x.y", schema, { v: { any: 1 } })).toEqual({ v: { any: 1 } });
    const closed = argsSchema({
      v: {
        description: "d",
        oneOf: [
          { type: "boolean" },
          { type: "number" },
          { maximum: 9, minimum: 1, type: "integer" },
          { type: "string" },
          pathProperty("d"),
          pathListProperty("d"),
        ],
      },
    });
    expect(() => coerceArgs("x.y", closed, { v: { any: 1 } })).toThrow(
      'command "x.y" argument "v": expected a boolean or a finite number or a number from 1 to 9 ' +
        'or a non-empty string or a document path or a list of document paths, got object {"any":1}',
    );
    const open = argsSchema({
      v: { description: "d", oneOf: [{ enum: ["a"], type: "string" }, { description: "any" }] },
    });
    expect(coerceArgs("x.y", open, { v: 3 })).toEqual({ v: 3 });
    expect(coerceArgs("x.y", open, { v: "a" })).toEqual({ v: "a" });
  });

  test("the pass-through row hands the value on unchanged — and no shipped record reaches it", () => {
    const schema = argsSchema({ blob: { description: "Anything at all." } });
    expect(coerceArgs("a.one", schema, { blob: { any: "thing" } })).toEqual({
      blob: { any: "thing" },
    });
    expect(describeShape({ description: "Anything at all." })).toBe("pass-through");
  });

  test("the result is a fresh record holding what each reader returned", () => {
    const schema = argsSchema(
      { pane: stringProperty("d"), scheme: enumProperty(["auto", "dark", "light"], "d") },
      ["scheme"],
    );
    const args = { scheme: "dark" };
    const coerced = coerceArgs("canvas.setColorScheme", schema, args);
    expect(coerced).toEqual({ scheme: "dark" });
    expect(coerced).not.toBe(args);
  });
});

/**
 * The sweep: every schema `appCommandSet()` ships lands every property in a named row.
 *
 * `pass-through` is the row for a shape no reader exists for. A record that reached it would have a
 * schema the palette prompts from and the shot check validates against, but that `registry.run`
 * lets through unread — which is the disagreement `coerceArgs` exists to end. The sweep is what
 * keeps the table and the records in step: a new keyword in a schema fails here, by name, before a
 * caller finds the hole.
 */
describe("every shipped args schema", () => {
  interface Shape {
    additionalProperties?: boolean;
    properties?: Record<string, object>;
    required?: readonly string[];
  }
  const withArgs = appCommandSet().filter((command) => command.args !== undefined);

  test("there are schemas to sweep", () => {
    expect(withArgs.length).toBeGreaterThan(60);
  });

  test("lands every property in a named coercion row, never the pass-through", () => {
    const strays: string[] = [];
    for (const command of withArgs) {
      const { properties = {} } = command.args as Shape;
      for (const [key, property] of Object.entries(properties)) {
        if (describeShape(property) === "pass-through") {
          strays.push(`${command.id}.${key}`);
        }
      }
    }
    expect(strays, "a property shape no reader coerces — add a row, or change the shape").toEqual(
      [],
    );
  });

  test("closes its key set and requires only keys it declares", () => {
    for (const command of withArgs) {
      const { additionalProperties, properties = {}, required = [] } = command.args as Shape;
      // An open key set would let a misspelt argument through unread, which is the shot check's
      // Headline failure arriving at run time with nothing to say.
      expect(additionalProperties, `${command.id} leaves additionalProperties open`).toBe(false);
      for (const key of required) {
        expect(key in properties, `${command.id} requires undeclared "${key}"`).toBe(true);
      }
    }
  });

  test("requires nothing on a keybound record — a chord runs it with {}", () => {
    /* `handleKeyEvent` calls `registry.run(id)` with no args, and the pass now refuses a missing
       required key before `run` is entered. `diff.nextChange` and `diff.previousChange` declared
       `pane` required (the `argsSchema` default) while `paneOfArgs` fell back to the focused pane;
       this is what would have turned F7 into a thrown RangeError inside a keydown listener. */
    for (const command of withArgs) {
      if (command.keybinding === undefined) {
        continue;
      }
      const { required = [] } = command.args as Shape;
      expect(required, `${command.id} is keybound but requires ${required.join(", ")}`).toEqual([]);
      expect(() => coerceArgs(command.id, command.args!, {})).not.toThrow();
    }
  });

  test("declares optional what its run defaults — the six records the pass found", () => {
    // Each `run` reads `pane` through a fallback to the focused pane, and the popover/dialog pair
    // Default `open` to true and `path` to the selection's. The schemas said otherwise.
    const optional: Record<string, string[]> = {
      "canvas.setColorScheme": ["pane"],
      "canvas.setDialogOpen": ["open", "pane", "path"],
      "canvas.setLayoutVisible": ["pane"],
      "canvas.setPopoverOpen": ["open", "pane", "path"],
      "diff.nextChange": ["pane"],
      "diff.previousChange": ["pane"],
    };
    for (const [id, keys] of Object.entries(optional)) {
      const command = withArgs.find((c) => c.id === id)!;
      const { required = [] } = command.args as Shape;
      for (const key of keys) {
        expect(required, `${id} still requires "${key}"`).not.toContain(key);
      }
    }
  });

  test("admits every step of the shipped screenshot manifest", async () => {
    /* `scripts/check-shot-contract.ts` validates each manifest step against the same schema in the
       `checks` job — required keys, unknown keys, type, const and enum — but not everything the
       rows above read: it admits `""` for a string `stringArg` refuses, ignores `minimum` and
       `maximum`, and does not descend into `oneOf`. So a step that passes the static check does
       NOT pass the runtime pass by construction; this sweep over the real manifest with the real
       records is the proof for the manifest as shipped, and a step that opens one of those three
       gaps fails here rather than in a capture. Quarantined shots are read past, as the checker
       and the runner read past them. */
    const manifest = (await Bun.file(
      resolve(import.meta.dir, "../../../scripts/screenshots/manifest.json"),
    ).json()) as {
      shots: {
        status?: { state?: string };
        steps?: { args?: Record<string, unknown>; cmd?: string }[];
        then?: { steps?: { args?: Record<string, unknown>; cmd?: string }[] }[];
      }[];
    };
    const byId = new Map(withArgs.map((command) => [command.id, command]));
    let checked = 0;
    for (const shot of manifest.shots) {
      if (shot.status?.state === "quarantined") {
        continue;
      }
      const steps = [...(shot.steps ?? []), ...(shot.then ?? []).flatMap((s) => s.steps ?? [])];
      for (const step of steps) {
        const command = step.cmd === undefined ? undefined : byId.get(step.cmd);
        if (!command) {
          continue;
        }
        expect(() => coerceArgs(command.id, command.args!, step.args ?? {})).not.toThrow();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
