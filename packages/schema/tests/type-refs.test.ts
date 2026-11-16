import { describe, expect, test } from "bun:test";
import {
  collectTypeRefs,
  DEFS_POINTER_PREFIX,
  findDanglingTypeRefs,
  resolveTypeRef,
  typeDefinitionNames,
  typeRefFor,
  typeRefName,
} from "../src/type-refs";

describe("resolveTypeRef", () => {
  test("the document's definition wins, and the project's answers a name the document lacks", () => {
    const document = { Count: { type: "integer" } };
    const project = {
      Address: { properties: { zip: { type: "string" } } },
      Count: { type: "number" },
    };
    expect(resolveTypeRef("#/$defs/Count", document, project)).toEqual({
      name: "Count",
      schema: { type: "integer" },
      scope: "document",
    });
    expect(resolveTypeRef("#/$defs/Address", document, project)).toEqual({
      name: "Address",
      schema: project.Address,
      scope: "project",
    });
    expect(resolveTypeRef("#/$defs/Address", undefined, project)?.scope).toBe("project");
    expect(resolveTypeRef("#/$defs/Missing", document, project)).toBeNull();
    expect(resolveTypeRef("#/$defs/Missing")).toBeNull();
  });

  test("a longer pointer is walked inside the chosen definition and never falls through", () => {
    const project = {
      Address: {
        properties: { zip: { type: "string" } },
        oneOf: [{ type: "null" }, { type: "string" }],
      },
    };
    expect(
      resolveTypeRef("#/$defs/Address/properties/zip", { Address: { type: "string" } }, project),
    ).toBeNull();
    expect(resolveTypeRef("#/$defs/Address/properties/zip", {}, project)?.schema).toEqual({
      type: "string",
    });
    expect(resolveTypeRef("#/$defs/Address/oneOf/1", {}, project)?.schema).toEqual({
      type: "string",
    });
    expect(resolveTypeRef("#/$defs/Address/oneOf/2", {}, project)).toBeNull();
    expect(resolveTypeRef("#/$defs/Address/oneOf/01", {}, project)).toBeNull();
    expect(resolveTypeRef("#/$defs/Address/oneOf/-1", {}, project)).toBeNull();
    expect(resolveTypeRef("#/$defs/Address/properties/zip/type/x", {}, project)).toBeNull();
    expect(resolveTypeRef("#/$defs/Address/nope", {}, project)).toBeNull();
  });

  test("escapes decode, and inherited keys are not definitions", () => {
    const project = { "a/b~c": { type: "string" } };
    expect(resolveTypeRef("#/$defs/a~1b~0c", undefined, project)?.name).toBe("a/b~c");
    expect(resolveTypeRef("#/$defs/constructor", {})).toBeNull();
    expect(resolveTypeRef("#/$defs/toString", {}, {})).toBeNull();
  });

  test("anything but a #/$defs/ pointer resolves to null", () => {
    const defs = { X: { type: "string" } };
    for (const ref of ["#/state/x", "other.json#/$defs/X", "#/$defs/", "#/$defs", "X"]) {
      expect(resolveTypeRef(ref, defs, defs)).toBeNull();
    }
  });
});

describe("collectTypeRefs", () => {
  test("every type reference under a value is found with its RFC 6901 path", () => {
    const type = {
      $ref: "#/$defs/Top",
      anyOf: [{ $ref: "#/$defs/A" }, { type: "null" }],
      items: { $ref: "#/$defs/Item" },
      properties: {
        "a/b": { $ref: "#/$defs/Field" },
        plain: { $ref: "#/content/x" },
        weird: { $ref: 3 },
      },
    };
    expect(collectTypeRefs(type, "/state/x/type")).toEqual([
      { at: "/state/x/type/$ref", ref: "#/$defs/Top" },
      { at: "/state/x/type/anyOf/0/$ref", ref: "#/$defs/A" },
      { at: "/state/x/type/items/$ref", ref: "#/$defs/Item" },
      { at: "/state/x/type/properties/a~1b/$ref", ref: "#/$defs/Field" },
    ]);
    expect(collectTypeRefs("plain")).toEqual([]);
    expect(collectTypeRefs(null)).toEqual([]);
    expect(collectTypeRefs({ properties: "not a map", type: "object" })).toEqual([]);
  });

  test("instance data is never walked", () => {
    const type = {
      const: { $ref: "#/$defs/A" },
      default: { $ref: "#/$defs/A" },
      enum: [{ $ref: "#/$defs/A" }],
      examples: [{ $ref: "#/$defs/A" }],
      type: "object",
    };
    expect(collectTypeRefs(type)).toEqual([]);
  });
});

describe("findDanglingTypeRefs", () => {
  test("dangling references in state types and definitions are reported in document order", () => {
    const doc = {
      $defs: {
        Card: { properties: { owner: { $ref: "#/$defs/Gone" } }, type: "object" },
        Count: { type: "integer" },
        Klass: { $prototype: "Class", parameters: { x: { $ref: "#/$defs/parameters/src" } } },
        Plain: "not an object",
      },
      state: {
        bad: { default: [], type: { items: { $ref: "#/$defs/Missing" }, type: "array" } },
        good: { default: 0, type: { $ref: "#/$defs/Count" } },
        inline: { default: "", type: { type: "string" } },
        naked: "text",
        projectWide: { default: 0, type: { $ref: "#/$defs/Shared" } },
        string: { default: "", type: "string" },
      },
    };
    expect(findDanglingTypeRefs(doc, { Shared: { type: "string" } })).toEqual([
      { at: "/state/bad/type/items/$ref", ref: "#/$defs/Missing" },
      { at: "/$defs/Card/properties/owner/$ref", ref: "#/$defs/Gone" },
    ]);
    expect(findDanglingTypeRefs({})).toEqual([]);
    expect(findDanglingTypeRefs({ $defs: {}, state: {} })).toEqual([]);
  });

  test("project.json's own definitions resolve against themselves alone", () => {
    const defs = { List: { items: { $ref: "#/$defs/Address" } }, Address: { type: "object" } };
    expect(findDanglingTypeRefs({ $defs: defs })).toEqual([]);
    expect(
      findDanglingTypeRefs({ $defs: { ...defs, List: { items: { $ref: "#/$defs/Nope" } } } }),
    ).toEqual([{ at: "/$defs/List/items/$ref", ref: "#/$defs/Nope" }]);
  });
});

describe("typeDefinitionNames", () => {
  test("the document's names come first, then the project's it does not shadow, each sorted, and a class definition is not a type", () => {
    const names = typeDefinitionNames(
      {
        Zed: { type: "string" },
        Alpha: { type: "string" },
        Klass: { $prototype: "Class" },
        Raw: 3,
      },
      {
        Beta: { type: "string" },
        Alpha: { type: "integer" },
        Aardvark: { type: "string" },
        Other: [],
      },
    );
    expect(names).toEqual([
      { name: "Alpha", scope: "document" },
      { name: "Zed", scope: "document" },
      { name: "Aardvark", scope: "project" },
      { name: "Beta", scope: "project" },
    ]);
    expect(typeDefinitionNames()).toEqual([]);
  });
});

describe("typeRefFor and typeRefName", () => {
  test("a name survives typeRefFor and typeRefName, escapes included; a longer pointer, a non-object and a foreign $ref are not a name", () => {
    for (const name of ["Count", "a/b", "a~b", "~1"]) {
      expect(typeRefName({ $ref: typeRefFor(name) })).toBe(name);
    }
    expect(typeRefFor("a/b~c")).toBe(`${DEFS_POINTER_PREFIX}a~1b~0c`);
    expect(typeRefName({ $ref: "#/$defs/Address/properties/zip" })).toBeNull();
    expect(typeRefName({ $ref: "#/$defs/" })).toBeNull();
    expect(typeRefName({ $ref: "#/state/x" })).toBeNull();
    expect(typeRefName({ $ref: 3 })).toBeNull();
    expect(typeRefName({ $ref: "#/$defs/Count", description: "annotation" })).toBe("Count");
    expect(typeRefName("string")).toBeNull();
    expect(typeRefName(null)).toBeNull();
    expect(typeRefName(["#/$defs/Count"])).toBeNull();
  });
});
