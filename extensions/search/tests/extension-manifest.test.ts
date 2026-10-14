/**
 * Extension-package surface tests (specs/extensions.md §4–§5, mirroring
 * extensions/auth/tests/extension-manifest.test.ts): the manifest validates against the generated
 * extension-manifest schema, every class descriptor exists and carries the expected admission
 * blocks (search section owner with projectData + emit; Search state class with lower), and the
 * project fragment is a standalone-valid 2020-12 document contributing the `search` section.
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

/** The value at `keys` under `value`, or `undefined` where a step is not an object — `?.` for JSON. */
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
    expect(at(pkg, "exports", "./client")).toBe("./src/client.ts");
    expect(at(pkg, "exports", "./schemas/project.fragment.schema.json")).toBeDefined();
    expect(pkg.files).toContain("jx-extension.json");
    expect(pkg.files).toContain("schemas/");
    expect(at(pkg, "dependencies", "@jxsuite/schema")).toBe("workspace:^");
    expect(stringOf(at(pkg, "dependencies", "minisearch"), "dependencies.minisearch")).toMatch(
      /^\^7\./,
    );
    // Every class descriptor is addressable through the exports map.
    for (const ref of classRefs) {
      const exportKey = ref.replace("./src/", "./");
      expect(at(pkg, "exports", exportKey)).toBe(ref);
    }
  });

  test("every classes entry points at an existing descriptor", () => {
    expect(Object.keys(manifestClasses).toSorted()).toEqual(["Search", "SearchIndex"]);
    for (const ref of classRefs) {
      const classPath = resolve(dirname(MANIFEST_PATH), ref);
      expect(existsSync(classPath)).toBe(true);
    }
  });

  test("admission blocks: section owner declares projectData + emit; Search declares lower", () => {
    const classDef = (name: string) =>
      loadJson(
        resolve(
          dirname(MANIFEST_PATH),
          stringOf(manifestClasses[name], `manifest.classes.${name}`),
        ),
      );

    const owner = classDef("SearchIndex");
    const ownerMethods = at(owner, "$defs", "methods");
    expect(at(owner, "project", "key")).toBe("search");
    expect(at(ownerMethods, "projectData", "role")).toBe("projectData");
    expect(at(ownerMethods, "projectData", "timing")).toEqual(["compiler", "server"]);
    expect(at(ownerMethods, "emit", "role")).toBe("emit");
    expect(at(ownerMethods, "emit", "timing")).toEqual(["compiler"]);

    const search = classDef("Search");
    const searchMethods = at(search, "$defs", "methods");
    expect(search.project).toBeUndefined();
    expect(search.$studio).toEqual({ stateDefaults: { timing: "client" } });
    expect(at(searchMethods, "lower", "role")).toBe("lower");
    expect(at(searchMethods, "lower", "timing")).toEqual(["compiler"]);
  });
});

describe("project fragment", () => {
  const fragment = loadJson(resolve(import.meta.dir, "../schemas/project.fragment.schema.json"));

  test("is a standalone-valid 2020-12 schema contributing the search section", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(fragment);
    expect(validate).toBeInstanceOf(Function);
    expect(at(fragment, "properties", "search")).toBeDefined();
  });

  test("carries the shared first-party fragment $id shape (specs/extensions.md §5.1)", () => {
    /*
     * The assertion connector, parser and auth already had. Adding it here makes the §5.1
     * convention true by construction across all six first-party fragments rather than by prose.
     */
    expect(fragment.$id).toBe("https://jxsuite.com/schema/ext/search/project/v1");
  });

  test("accepts a typical section and rejects malformed ones", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: true });
    const validate = ajv.compile(fragment);

    expect(
      validate({
        search: {
          output: "/search-index.json",
          collections: { docs: { basePath: "/docs/", boost: { title: 4, heading: 2 } } },
        },
      }),
    ).toBe(true);

    // Missing collections
    expect(validate({ search: {} })).toBe(false);
    // Empty collections map
    expect(validate({ search: { collections: {} } })).toBe(false);
    // Collection without basePath
    expect(validate({ search: { collections: { docs: {} } } })).toBe(false);
    // Unknown engine
    expect(
      validate({ search: { engine: "fuse", collections: { docs: { basePath: "/d/" } } } }),
    ).toBe(false);
  });
});
