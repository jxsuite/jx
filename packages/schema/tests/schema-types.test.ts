/**
 * The type a JSON Schema says (`spec.md` §5.2, §23.3): what each keyword writes, where a type needs
 * brackets, and which names in one say where the document wrote them.
 */
import { describe, expect, test } from "bun:test";
import type { JsonObject, JsonValue } from "../types";
import {
  definitionParts,
  definitionsOf,
  pointerInto,
  propertyName,
  schemaParts,
  written,
} from "../src/jxn/schema-types.ts";
import type { TypePart, WrittenName } from "../src/jxn/schema-types.ts";

/** The type a schema says, in a document that has `$defs`. */
function typed(schema: JsonValue | undefined, defs = true): string {
  return written(schemaParts(schema, { defs, pointer: "" }));
}

/** An object with no members, whose every key reads as a value that is not there. */
const NOTHING: JsonObject = {};

/** The names of a type that the document wrote. */
function names(parts: readonly TypePart[]): WrittenName[] {
  return parts.filter((part): part is WrittenName => typeof part !== "string");
}

describe("a name as TypeScript writes it", () => {
  test("is bare where it is an identifier and quoted where it is not", () => {
    expect(propertyName("count")).toBe("count");
    expect(propertyName("$map")).toBe("$map");
    expect(propertyName("my key")).toBe('"my key"');
    expect(propertyName("1st")).toBe('"1st"');
  });
});

describe("a JSON Pointer one step down", () => {
  test("escapes what a pointer reserves", () => {
    expect(pointerInto("", "state")).toBe("/state");
    expect(pointerInto("/children", 0)).toBe("/children/0");
    expect(pointerInto("/state", "a/b~c")).toBe("/state/a~1b~0c");
  });
});

describe("the type a keyword names", () => {
  test("is the one TypeScript has for it", () => {
    expect(typed({ type: "string" })).toBe("string");
    expect(typed({ type: "number" })).toBe("number");
    expect(typed({ type: "integer" })).toBe("number");
    expect(typed({ type: "boolean" })).toBe("boolean");
    expect(typed({ type: "null" })).toBe("null");
  });

  test("is any where the schema names none it reads", () => {
    expect(typed({ type: "date" })).toBe("any");
    expect(typed({ minimum: 0 })).toBe("any");
    expect(typed({})).toBe("any");
  });

  test("is any where the schema is not an object", () => {
    expect(typed(true)).toBe("any");
    expect(typed("string")).toBe("any");
    expect(typed(NOTHING.absent)).toBe("any");
  });

  test("is not read off properties or items alone, which constrain nothing without a type", () => {
    expect(typed({ properties: { a: { type: "string" } } })).toBe("any");
    expect(typed({ items: { type: "string" } })).toBe("any");
  });

  test("is each of a list of them, said once", () => {
    expect(typed({ type: ["string", "null"] })).toBe("string | null");
    expect(typed({ type: ["number", "integer"] })).toBe("number");
    expect(typed({ type: [] })).toBe("any");
  });
});

describe("the values a schema lists", () => {
  test("are each a type", () => {
    expect(typed({ enum: ["idle", "loading"], type: "string" })).toBe('"idle" | "loading"');
    expect(typed({ enum: [1, true, null, "a"] })).toBe('1 | true | null | "a"');
    expect(typed({ const: "only" })).toBe('"only"');
    expect(typed({ const: null })).toBe("null");
  });

  test("give way to the keyword where one is no type", () => {
    expect(typed({ enum: [{ a: 1 }], type: "object" })).toBe("{ [key: string]: any; }");
    expect(typed({ enum: [], type: "string" })).toBe("string");
    expect(typed({ const: [1], type: "array" })).toBe("any[]");
  });
});

describe("a list", () => {
  test("is of what its items are", () => {
    expect(typed({ items: { type: "string" }, type: "array" })).toBe("string[]");
    expect(typed({ items: { items: { type: "number" }, type: "array" }, type: "array" })).toBe(
      "number[][]",
    );
  });

  test("is of anything where items does not say", () => {
    expect(typed({ type: "array" })).toBe("any[]");
    expect(typed({ items: [{ type: "string" }], type: "array" })).toBe("any[]");
  });

  test("brackets an item that is more than one type", () => {
    expect(typed({ items: { type: ["string", "null"] }, type: "array" })).toBe("(string | null)[]");
  });
});

describe("an object", () => {
  test("names each property, optional unless it is required", () => {
    const schema = {
      properties: { done: { type: "boolean" }, id: { type: "integer" }, "my key": {} },
      required: ["id"],
      type: "object",
    };
    expect(typed(schema)).toBe('{ done?: boolean; id: number; "my key"?: any; }');
  });

  test("holds anything where it names no property", () => {
    expect(typed({ type: "object" })).toBe("{ [key: string]: any; }");
    expect(typed({ properties: [], type: "object" })).toBe("{ [key: string]: any; }");
  });

  test("holds what additionalProperties says where it names no property", () => {
    expect(typed({ additionalProperties: { type: "number" }, type: "object" })).toBe(
      "{ [key: string]: number; }",
    );
  });

  test("holds anything beside its properties where it is open", () => {
    const properties = { a: { type: "string" } };
    expect(typed({ additionalProperties: true, properties, type: "object" })).toBe(
      "{ a?: string; [key: string]: any; }",
    );
    expect(typed({ additionalProperties: { type: "number" }, properties, type: "object" })).toBe(
      "{ a?: string; [key: string]: any; }",
    );
    expect(typed({ additionalProperties: false, properties, type: "object" })).toBe(
      "{ a?: string; }",
    );
  });
});

describe("schemas combined", () => {
  const text = { type: "string" };
  const count = { type: "number" };
  const flag = { type: "boolean" };

  test("are a union for anyOf and oneOf, and an intersection for allOf", () => {
    expect(typed({ anyOf: [text, count] })).toBe("string | number");
    expect(typed({ oneOf: [text, count] })).toBe("string | number");
    expect(typed({ allOf: [text, count] })).toBe("string & number");
  });

  test("are the one schema where there is one, and the keyword where there is none", () => {
    expect(typed({ anyOf: [text] })).toBe("string");
    expect(typed({ anyOf: [], type: "number" })).toBe("number");
  });

  test("bracket a union inside an intersection, and nothing inside a union", () => {
    expect(typed({ allOf: [{ anyOf: [text, count] }, flag] })).toBe("(string | number) & boolean");
    expect(typed({ anyOf: [{ allOf: [text, count] }, flag] })).toBe("string & number | boolean");
    expect(typed({ anyOf: [{ anyOf: [text, count] }, flag] })).toBe("string | number | boolean");
  });

  test("say once a member that is only words", () => {
    expect(typed({ anyOf: [text, count, text] })).toBe("string | number");
    expect(typed({ allOf: [text, text] })).toBe("string");
  });

  test("bracket either inside a list", () => {
    expect(typed({ items: { allOf: [text, count] }, type: "array" })).toBe("(string & number)[]");
  });
});

describe("a reference", () => {
  test("is the definition it names, in the namespace the document's are written in", () => {
    expect(typed({ $ref: "#/$defs/TodoItem" })).toBe("$defs.TodoItem");
    expect(typed({ items: { $ref: "#/$defs/TodoItem" }, type: "array" })).toBe("$defs.TodoItem[]");
  });

  test("is read before anything written beside it", () => {
    expect(typed({ $ref: "#/$defs/A", type: "string" })).toBe("$defs.A");
  });

  test("is any in a document that has no definitions", () => {
    expect(typed({ $ref: "#/$defs/TodoItem" }, false)).toBe("any");
  });

  test("is any where it names something else", () => {
    expect(typed({ $ref: "#/$defs/returnTypes/Day" })).toBe("any");
    expect(typed({ $ref: "#/$defs/not-a-name" })).toBe("any");
    expect(typed({ $ref: "./other.json#/$defs/A" })).toBe("any");
    expect(typed({ $ref: "#/state/a" })).toBe("any");
  });

  test("is not one where $ref is not a string", () => {
    expect(typed({ $ref: 1, type: "string" })).toBe("string");
  });
});

describe("the names of a type", () => {
  test("say which member of the document each is", () => {
    const schema = {
      properties: {
        "a/b": { type: "string" },
        kids: { items: { $ref: "#/$defs/Node" }, type: "array" },
        other: { anyOf: [{ type: "null" }, { $ref: "#/$defs/Node" }] },
      },
      type: "object",
    };
    expect(names(schemaParts(schema, { defs: true, pointer: "/$defs/Node" }))).toEqual([
      { kind: "member", name: "a/b", pointer: "/$defs/Node/properties/a~1b", written: '"a/b"' },
      { kind: "member", name: "kids", pointer: "/$defs/Node/properties/kids", written: "kids" },
      {
        kind: "ref",
        name: "Node",
        pointer: "/$defs/Node/properties/kids/items",
        written: "Node",
      },
      { kind: "member", name: "other", pointer: "/$defs/Node/properties/other", written: "other" },
      {
        kind: "ref",
        name: "Node",
        pointer: "/$defs/Node/properties/other/anyOf/1",
        written: "Node",
      },
    ]);
  });

  test("are each kept where a type is written twice, so a rename reaches both", () => {
    const schema = { anyOf: [{ $ref: "#/$defs/A" }, { type: "null" }, { $ref: "#/$defs/A" }] };
    const parts = schemaParts(schema, { defs: true, pointer: "/$defs/B" });
    expect(written(parts)).toBe("$defs.A | null | $defs.A");
    expect(names(parts).map((part) => part.pointer)).toEqual([
      "/$defs/B/anyOf/0",
      "/$defs/B/anyOf/2",
    ]);
  });

  test("reach what a map holds", () => {
    const schema = { additionalProperties: { $ref: "#/$defs/A" }, type: "object" };
    expect(names(schemaParts(schema, { defs: true, pointer: "/state/a/type" }))).toEqual([
      { kind: "ref", name: "A", pointer: "/state/a/type/additionalProperties", written: "A" },
    ]);
  });
});

describe("the definitions a document holds", () => {
  test("are its $defs", () => {
    const defs: JsonObject = { A: { type: "string" } };
    expect(definitionsOf({ $defs: defs })).toBe(defs);
    expect(definitionsOf({ $defs: {} })).toEqual({});
  });

  test("are none where it has no $defs that is an object", () => {
    expect(definitionsOf({})).toBeNull();
    expect(definitionsOf({ $defs: [] })).toBeNull();
    expect(definitionsOf({ $defs: "A" })).toBeNull();
    expect(definitionsOf(NOTHING.absent)).toBeNull();
    expect(definitionsOf([])).toBeNull();
  });
});

describe("the namespace of a document's definitions", () => {
  const defs: JsonObject = {
    Status: { enum: ["idle", "loading"], type: "string" },
    TodoItem: {
      properties: { state: { $ref: "#/$defs/Status" }, text: { type: "string" } },
      required: ["text"],
      type: "object",
    },
    "not-a-name": { type: "string" },
  };

  test("declares each under its own name, and leaves out one that is no identifier", () => {
    expect(written(definitionParts(defs, true)).split("\n")).toEqual([
      "export namespace $defs {",
      '  export type Status = "idle" | "loading";',
      "  export type TodoItem = { state?: $defs.Status; text: string; };",
      "}",
    ]);
  });

  test("is exported only where it is asked to be", () => {
    expect(written(definitionParts(defs, false)).split("\n")[0]).toBe("namespace $defs {");
    expect(written(definitionParts({}, false))).toBe("namespace $defs {\n}");
  });

  test("says where each definition and each name in one was written", () => {
    expect(
      names(definitionParts(defs, true)).map((part) => `${part.kind} ${part.pointer}`),
    ).toEqual([
      "member /$defs/Status",
      "member /$defs/TodoItem",
      "member /$defs/TodoItem/properties/state",
      "ref /$defs/TodoItem/properties/state",
      "member /$defs/TodoItem/properties/text",
    ]);
  });
});
