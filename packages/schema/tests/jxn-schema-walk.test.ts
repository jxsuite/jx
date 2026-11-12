/**
 * A JSON Schema read as far as a completion needs (`spec.md` §22.6): what it is made of, the
 * members it declares, the schema of one of them, and the values it names.
 */
import { describe, expect, test } from "bun:test";
import {
  descriptionOf,
  itemsOf,
  leavesOf,
  memberOf,
  namesOf,
  valuesOf,
} from "../src/jxn/schema-walk.ts";
import type { RootedSchema } from "../src/jxn/schema-walk.ts";
import type { JsonObject } from "../types.ts";

/** A schema that is its own document. */
const rooted = (schema: JsonObject): RootedSchema => ({ root: schema, schema });

/** A schema inside the document its `$ref`s point into. */
const within = (root: JsonObject, schema: JsonObject): RootedSchema => ({ root, schema });

/** An `if` branch that says which it is. A literal with a `then` member reads as a thenable. */
const branch = (keyword: string): JsonObject => ({ [keyword]: { description: keyword } });

describe("what a schema is made of", () => {
  test("is itself, what it refers to, and every member of its combiners and branches", () => {
    const root: JsonObject = {
      $defs: {
        "a/b": { description: "escaped slash" },
        "c~d": { description: "escaped tilde" },
        list: [{ description: "an item of a list" }],
        named: { $ref: "#/$defs/a~1b", description: "named" },
      },
    };
    const schema: JsonObject = {
      $ref: "#/$defs/named",
      allOf: [{ $ref: "#/$defs/c~0d" }],
      anyOf: [{ $ref: "#/$defs/list/0" }],
      oneOf: [{ description: "one" }, "not a schema"],
      ...branch("then"),
      ...branch("else"),
    };
    const descriptions = leavesOf(within(root, schema)).flatMap((leaf) =>
      leaf.description === undefined ? [] : [leaf.description],
    );
    expect(leavesOf(within(root, schema))[0]).toBe(schema);
    expect(descriptions).toEqual([
      "named",
      "escaped slash",
      "escaped tilde",
      "an item of a list",
      "one",
      "then",
      "else",
    ]);
  });

  test("ends where a schema refers to itself", () => {
    const root: JsonObject = {
      $defs: { node: { anyOf: [{ $ref: "#/$defs/node" }, { const: 1 }] } },
    };
    expect(leavesOf(within(root, { $ref: "#/$defs/node" }))).toHaveLength(4);
    expect(valuesOf(within(root, { $ref: "#/$defs/node" }))).toEqual([1]);
  });

  test("leaves out a `$ref` that points nowhere it can follow", () => {
    const root: JsonObject = { $defs: { text: "not a schema", value: { const: 1 } } };
    const refs = [
      "https://example.com/schema.json",
      "#/$defs/missing",
      "#/$defs/text",
      "#/$defs/text/deeper",
      "#/$defs/value/const/deeper",
    ];
    for (const $ref of refs) {
      expect(leavesOf(within(root, { $ref }))).toEqual([{ $ref }]);
    }
    // `#` alone is the document.
    expect(leavesOf(within(root, { $ref: "#" }))).toEqual([{ $ref: "#" }, root]);
  });
});

describe("the members a schema declares", () => {
  const root: JsonObject = {
    $defs: {
      base: { properties: { id: { description: "from the base" }, name: { type: "string" } } },
    },
  };
  const schema: JsonObject = {
    allOf: [{ $ref: "#/$defs/base" }],
    properties: { id: { description: "its own" }, odd: true, title: {} },
  };

  test("are each listed once, the first declaration first, with a schema that is one", () => {
    const names = namesOf(within(root, schema));
    expect([...names.keys()]).toEqual(["id", "title", "name"]);
    expect(names.get("id")?.schema).toEqual({ description: "its own" });
    expect(names.get("id")?.root).toBe(root);
    expect([...namesOf(rooted({ type: "string" }))]).toEqual([]);
  });

  test("are found by name wherever one is declared", () => {
    expect(memberOf(within(root, schema), "title")?.schema).toEqual({});
    expect(memberOf(within(root, schema), "name")?.schema).toEqual({ type: "string" });
    // Declared twice, it is either.
    expect(memberOf(within(root, schema), "id")?.schema).toEqual({
      anyOf: [{ description: "its own" }, { description: "from the base" }],
    });
    expect(memberOf(within(root, schema), "missing")).toBeNull();
    expect(memberOf(within(root, schema), "odd")).toBeNull();
  });

  test("are otherwise what a pattern or the rest of the object allows", () => {
    const open = rooted({
      additionalProperties: { description: "any other" },
      patternProperties: {
        "(": { description: "no pattern at all" },
        "^\\$": { description: "a jx member" },
        "^on": true,
        "^x-": { description: "an extension" },
      },
      properties: { id: { description: "declared" } },
    });
    expect(memberOf(open, "id")?.schema).toEqual({ description: "declared" });
    expect(memberOf(open, "x-one")?.schema).toEqual({
      anyOf: [{ description: "an extension" }, { description: "any other" }],
    });
    expect(memberOf(open, "plain")?.schema).toEqual({ description: "any other" });
    expect(memberOf(open, "onclick")?.schema).toEqual({ description: "any other" });
    expect(memberOf(rooted({ additionalProperties: false }), "plain")).toBeNull();
    expect(memberOf(rooted({ patternProperties: { "^a": {} } }), "b")).toBeNull();
  });
});

describe("the items of a list's schema", () => {
  test("are its `items`, through whatever it is made of", () => {
    const root: JsonObject = { $defs: { list: { items: { enum: ["a", "b"] }, type: "array" } } };
    expect(itemsOf(within(root, { $ref: "#/$defs/list" }))?.schema).toEqual({ enum: ["a", "b"] });
    expect(
      itemsOf(rooted({ oneOf: [{ items: { const: 1 } }, { items: { const: 2 } }] }))?.schema,
    ).toEqual({ anyOf: [{ const: 1 }, { const: 2 }] });
    expect(itemsOf(rooted({ type: "string" }))).toBeNull();
    expect(itemsOf(rooted({ items: false }))).toBeNull();
  });
});

describe("the values a schema names", () => {
  test("are its `const`, its `enum`, both booleans, and then its examples", () => {
    expect(valuesOf(rooted({ const: "one" }))).toEqual(["one"]);
    expect(valuesOf(rooted({ enum: ["ltr", "rtl", "auto"] }))).toEqual(["ltr", "rtl", "auto"]);
    expect(valuesOf(rooted({ type: "boolean" }))).toEqual([true, false]);
    expect(valuesOf(rooted({ type: ["string", "boolean"] }))).toEqual([true, false]);
    expect(valuesOf(rooted({ examples: ["./a.json", 2], type: "string" }))).toEqual([
      "./a.json",
      2,
    ]);
    // What is required comes before what is only suggested, whichever leaf says it.
    expect(
      valuesOf(rooted({ examples: ["suggested"], oneOf: [{ const: "required" }, { enum: [1] }] })),
    ).toEqual(["required", 1, "suggested"]);
  });

  test("are each listed once, and only what one token can hold", () => {
    expect(
      valuesOf(
        rooted({
          enum: ["a", null, { an: "object" }, ["a", "list"], "a"],
          examples: ["a", { an: "object" }, "b"],
        }),
      ),
    ).toEqual(["a", null, "b"]);
    expect(valuesOf(rooted({ type: "string" }))).toEqual([]);
  });

  test("are one boolean where the schema holds it to one", () => {
    expect(valuesOf(rooted({ const: false, type: "boolean" }))).toEqual([false]);
    expect(valuesOf(rooted({ enum: [true], type: "boolean" }))).toEqual([true]);
    expect(
      valuesOf(rooted({ oneOf: [{ type: "string" }, { const: false, type: "boolean" }] })),
    ).toEqual([false]);
  });
});

describe("what a schema says it is for", () => {
  test("is the first description among the schemas it is made of", () => {
    const root: JsonObject = { $defs: { named: { description: "from the definition" } } };
    expect(descriptionOf(rooted({ description: "its own" }))).toBe("its own");
    expect(descriptionOf(within(root, { $ref: "#/$defs/named" }))).toBe("from the definition");
    expect(descriptionOf(within(root, { $ref: "#/$defs/named", description: "its own" }))).toBe(
      "its own",
    );
    expect(descriptionOf(rooted({ description: 1, oneOf: [{ description: "a branch" }] }))).toBe(
      "a branch",
    );
    expect(descriptionOf(rooted({ type: "string" }))).toBeNull();
  });
});
