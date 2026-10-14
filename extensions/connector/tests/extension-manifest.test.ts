/**
 * Extension-package surface tests (specs/extensions.md §4–§5, mirroring
 * extensions/parser/tests/extension-manifest.test.ts): the manifest validates against the generated
 * extension-manifest schema, every class descriptor exists and carries the expected admission
 * blocks, and the project fragment is a standalone-valid 2020-12 document.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

const require = createRequire(import.meta.url);

const MANIFEST_PATH = resolve(import.meta.dir, "../jx-extension.json");

/** The value at `keys` under `value`, or `undefined` where a step is not an object: `?.` for JSON. */
function at(value: JsonValue | undefined, ...keys: string[]): JsonValue | undefined {
  let current = value;
  for (const key of keys) {
    current = isJsonObject(current) ? current[key] : undefined;
  }
  return current;
}

function objectOf(value: JsonValue | undefined, label: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new Error(`${label} is not a JSON object`);
  }
  return value;
}

function stringOf(value: JsonValue | undefined, label: string): string {
  if (!isString(value)) {
    throw new Error(`${label} is not a string`);
  }
  return value;
}

function loadJson(path: string): JsonObject {
  const parsed: JsonValue = JSON.parse(readFileSync(path, "utf8"));
  return objectOf(parsed, path);
}

const manifest = loadJson(MANIFEST_PATH);
const manifestClasses = objectOf(manifest.classes, "manifest.classes");
const classRefs = Object.entries(manifestClasses).map(([name, ref]) =>
  stringOf(ref, `manifest.classes.${name}`),
);

/** An ajv instance with the shipped core + field-union defaults registered. */
function makeAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(loadJson(require.resolve("@jxsuite/schema/schemas/project.core.schema.json")));
  ajv.addSchema(loadJson(require.resolve("@jxsuite/schema/schemas/project.fields.schema.json")));
  return ajv;
}

describe("jx-extension.json manifest", () => {
  test("validates against the extension-manifest schema", () => {
    const schema = loadJson(require.resolve("@jxsuite/schema/extension-manifest.schema.json"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    expect(validate(manifest)).toBe(true);
  });

  test("carries the package name and is wired through package.json", () => {
    const pkg = loadJson(resolve(import.meta.dir, "../package.json"));
    expect(manifest.name).toBe(pkg.name);
    expect(pkg.jx).toBe("./jx-extension.json");
    expect(at(pkg, "exports", "./jx-extension.json")).toBe("./jx-extension.json");
    expect(at(pkg, "exports", "./worker")).toBe("./src/worker.ts");
    expect(at(pkg, "exports", "./types")).toBe("./src/types.ts");
    expect(at(pkg, "exports", "./schemas/project.fragment.schema.json")).toBeDefined();
    expect(pkg.files).toContain("jx-extension.json");
    expect(pkg.files).toContain("schemas/");
    // Every class descriptor is addressable through the exports map.
    for (const ref of classRefs) {
      const exportKey = ref.replace("./src/", "./");
      expect(at(pkg, "exports", exportKey)).toBe(ref);
    }
  });

  test("every classes entry points at an existing descriptor", () => {
    expect(Object.keys(manifestClasses).toSorted()).toEqual([
      "Connections",
      "D1",
      "Data",
      "Sqlite",
      "Supabase",
      "TableDelete",
      "TableEntry",
      "TableInsert",
      "TableQuery",
      "TableUpdate",
    ]);
    for (const ref of classRefs) {
      const classPath = resolve(dirname(MANIFEST_PATH), ref);
      expect(existsSync(classPath)).toBe(true);
    }
  });

  test("admission blocks: connector providers, section owners, and the data mount", () => {
    const classDef = (name: string) =>
      loadJson(
        resolve(
          dirname(MANIFEST_PATH),
          stringOf(manifestClasses[name], `manifest.classes.${name}`),
        ),
      );

    for (const provider of ["D1", "Supabase", "Sqlite"]) {
      const connector = at(classDef(provider), "connector");
      expect(at(connector, "serve")).toBe("@jxsuite/connector/worker");
      expect(at(connector, "provider")).toBeTypeOf("string");
      expect(["sqlite", "postgres"]).toContain(String(at(connector, "kind")));
    }
    expect(at(classDef("D1"), "connector", "local")).toBe("sqlite");

    const data = classDef("Data");
    expect(at(data, "project", "key")).toBe("data");
    expect(at(data, "project", "referenceable")).toBe(true);
    expect(data.server).toEqual({
      basePath: "/_jx/data",
      module: "@jxsuite/connector/worker",
      order: 20,
    });

    expect(at(classDef("Connections"), "project", "key")).toBe("connections");

    for (const stateClass of [
      "TableQuery",
      "TableEntry",
      "TableInsert",
      "TableUpdate",
      "TableDelete",
    ]) {
      const def = classDef(stateClass);
      const lower = at(def, "$defs", "methods", "lower");
      expect(at(def, "$studio", "stateDefaults")).toEqual({ timing: "client" });
      expect(at(lower, "role")).toBe("lower");
      expect(at(lower, "timing")).toEqual(["compiler"]);
    }
  });
});

describe("project fragment", () => {
  const fragment = loadJson(resolve(import.meta.dir, "../schemas/project.fragment.schema.json"));

  test("is a standalone-valid 2020-12 document contributing connections + data", () => {
    expect(fragment.$id).toBe("https://jxsuite.com/schema/ext/connector/project/v1");
    expect(fragment.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    const properties = objectOf(fragment.properties, "fragment.properties");
    expect(Object.keys(properties).toSorted()).toEqual(["connections", "data"]);
    expect(() => makeAjv().compile(fragment)).not.toThrow();
  });

  test("accepts connections + tables with field schemas, refs, and permissions", () => {
    const validate = makeAjv().compile(fragment);
    const section = {
      connections: {
        main: { binding: "DB", databaseId: "uuid-1", provider: "d1" },
        pg: { hyperdriveId: "hd", provider: "supabase", urlEnv: "SUPABASE_DB_URL" },
      },
      data: {
        comments: {
          connection: "main",
          id: "uuid",
          indexes: ["created_at", ["author", "created_at"]],
          ownerField: "user_id",
          permissions: { delete: "owner", insert: "authenticated", read: "public" },
          schema: {
            properties: {
              author: { $ref: "#/data/users" },
              message: { type: "string" },
              tags: { items: { $ref: "#/content/tags" }, type: "array" },
            },
            required: ["message"],
            type: "object",
          },
          timestamps: true,
        },
      },
    };
    expect(validate(section)).toBe(true);
  });

  test("rejects malformed connections, tables, and permission rules", () => {
    const validate = makeAjv().compile(fragment);
    expect(validate({ connections: { main: {} } })).toBe(false); // Provider is required.
    expect(validate({ data: { t: { connection: "main" } } })).toBe(false); // Schema is required.
    expect(
      validate({
        data: {
          t: { connection: "main", permissions: { read: "everyone" }, schema: { type: "object" } },
        },
      }),
    ).toBe(false);
    expect(
      validate({
        data: {
          t: { connection: "main", id: "guid", schema: { type: "object" } },
        },
      }),
    ).toBe(false);
    expect(
      validate({
        data: {
          t: {
            connection: "main",
            schema: { properties: { bad: { junk: true } }, type: "object" },
          },
        },
      }),
    ).toBe(false);
  });
});
