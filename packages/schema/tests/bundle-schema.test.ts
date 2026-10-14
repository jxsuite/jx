/**
 * BundleSchema round-trip suite (specs/extensions.md §5.4): the bundled compound document must
 * validate exactly the same instances as the unbundled entry document resolved through a file
 * loader. Structure is also pinned: relative-path refs are rewritten to canonical `$id`s, targets
 * embed once under `$defs` (keyed by `$id`, resource boundaries preserved), nested relative refs
 * inline recursively, and `$id`-less files get generated `urn:jx:bundled:*` identities.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PROJECT_CORE_SCHEMA_ID,
  PROJECT_FIELDS_SCHEMA_ID,
  bundleSchema,
  emitProjectSchema,
} from "../src/project-schemas";
import { isJsonObject } from "../src/guards";
import { generateProjectCoreSchema } from "../src/schema";
import type { JsonObject, JsonValue } from "../types";

const TMP = resolve(import.meta.dir, "__test-bundle-schema__");

/** File loader for the bundler — plain reads, no restrictions (tests exercise paths directly). */
const loadJson = async (path: string): Promise<JsonObject> => {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isJsonObject(parsed)) {
    throw new Error(`${path} does not hold a JSON object`);
  }
  return parsed;
};

/** The value at `keys` below `value`, descending only through JSON objects. */
function dig(value: JsonValue | undefined, ...keys: string[]): JsonValue | undefined {
  let current = value;
  for (const key of keys) {
    current = isJsonObject(current) ? current[key] : undefined;
  }
  return current;
}

/** The `$ref` of each member of a composition array such as `allOf`. */
function refsIn(value: JsonValue | undefined): (JsonValue | undefined)[] {
  return Array.isArray(value) ? value.map((member) => dig(member, "$ref")) : [];
}

/** Write a fixture file: a JSON value, or the generated core schema (whose arrays are readonly). */
function writeJson(
  relPath: string,
  content: JsonValue | ReturnType<typeof generateProjectCoreSchema>,
) {
  const abs = resolve(TMP, relPath);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, JSON.stringify(content, null, 2), "utf8");
}

/** A parser-like project fragment contributing `content`, with fields on the well-known union. */
const contentFragment = {
  $id: "https://test.invalid/parser/project.fragment.schema.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  properties: {
    content: {
      additionalProperties: {
        properties: {
          format: { type: "string" },
          schema: {
            properties: {
              properties: {
                additionalProperties: { $ref: PROJECT_FIELDS_SCHEMA_ID },
                type: "object",
              },
            },
            type: "object",
          },
          source: { type: "string" },
        },
        required: ["source"],
        type: "object",
      },
      type: "object",
    },
  },
  type: "object",
};

const entrySchema = emitProjectSchema({
  corePath: "./core.schema.json",
  fragments: ["./frags/project.fragment.schema.json"],
});

/** A project the entry accepts; `extraFields` joins the posts collection's field map. */
function validProject(extraFields: JsonObject = {}) {
  return {
    $schema: "./project.schema.json",
    content: {
      posts: {
        format: "Markdown",
        schema: {
          properties: {
            author: { $ref: "#/content/authors" },
            title: { type: "string" },
            ...extraFields,
          },
        },
        source: "./content/posts/",
      },
    },
    extensions: ["@jxsuite/parser"],
    name: "Bundle Fixture",
  };
}

beforeAll(() => {
  rmSync(TMP, { force: true, recursive: true });
  writeJson("core.schema.json", generateProjectCoreSchema());
  writeJson("frags/project.fragment.schema.json", contentFragment);
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

/** Compile the UNBUNDLED entry with a file loader (the validate-project resolution model). */
async function compileUnbundled() {
  const entryPath = resolve(TMP, "project.schema.json");
  writeFileSync(entryPath, JSON.stringify(entrySchema, null, 2), "utf8");
  const withId = { ...structuredClone(entrySchema), $id: pathToFileURL(entryPath).href };
  const ajv = new Ajv2020({
    allErrors: true,
    loadSchema: async (uri) => loadJson(new URL(uri).pathname),
    strict: false,
  });
  return ajv.compileAsync(withId);
}

describe("bundleSchema round-trip", () => {
  test("the bundled document validates the same instances as the file-resolved entry", async () => {
    const validateFiles = await compileUnbundled();
    const bundled = await bundleSchema(entrySchema, loadJson, TMP);
    // Self-contained: compiles with NO external resolution at all.
    const validateBundled = new Ajv2020({ allErrors: true, strict: false }).compile(bundled);

    const cases = [
      validProject(),
      { ...validProject(), unknownTopLevelKey: {} },
      validProject({ broken: { neither: "type nor $ref" } }),
      validProject({ tags: { items: { $ref: "#/content/tags" }, type: "array" } }),
      { content: "not an object", name: 5 },
    ];
    for (const doc of cases) {
      expect(validateBundled(doc)).toBe(validateFiles(doc));
    }
    // And the verdicts themselves are the expected ones (valid, then three failures, then valid).
    expect(validateBundled(cases[0]!)).toBe(true);
    expect(validateBundled(cases[1]!)).toBe(false);
    expect(validateBundled(cases[2]!)).toBe(false);
  });

  test("relative refs are rewritten to canonical $ids and targets embed once under $defs", async () => {
    const bundled = await bundleSchema(entrySchema, loadJson, TMP);
    const fragId = contentFragment.$id;
    expect(refsIn(bundled.allOf)).toEqual([PROJECT_CORE_SCHEMA_ID, fragId]);
    const defs = bundled.$defs;
    expect(dig(defs, PROJECT_CORE_SCHEMA_ID, "$id")).toBe(PROJECT_CORE_SCHEMA_ID);
    expect(dig(defs, fragId, "$id")).toBe(fragId);
    // The entry's own Fields embed survives with its canonical $id.
    expect(dig(defs, "Fields", "$id")).toBe(PROJECT_FIELDS_SCHEMA_ID);
    // Canonical refs inside embedded resources stay untouched.
    const fieldsRef = dig(
      defs,
      fragId,
      "properties",
      "content",
      "additionalProperties",
      "properties",
      "schema",
      "properties",
      "properties",
      "additionalProperties",
      "$ref",
    );
    expect(fieldsRef).toBe(PROJECT_FIELDS_SCHEMA_ID);
  });

  test("does not mutate the input entry document", async () => {
    const input = structuredClone(entrySchema);
    await bundleSchema(input, loadJson, TMP);
    expect(input).toEqual(entrySchema);
  });
});

describe("bundleSchema mechanics", () => {
  test("nested relative refs inline recursively against the referrer's directory", async () => {
    writeJson("nested/leaf.schema.json", {
      $id: "https://test.invalid/leaf",
      type: "string",
    });
    writeJson("nested/mid.schema.json", {
      $id: "https://test.invalid/mid",
      properties: { leafy: { $ref: "./leaf.schema.json" } },
      type: "object",
    });
    const entry = { $ref: "./nested/mid.schema.json" };
    const bundled = await bundleSchema(entry, loadJson, TMP);
    expect(bundled.$ref).toBe("https://test.invalid/mid");
    const defs = bundled.$defs;
    expect(dig(defs, "https://test.invalid/mid", "properties", "leafy", "$ref")).toBe(
      "https://test.invalid/leaf",
    );
    expect(dig(defs, "https://test.invalid/leaf", "type")).toBe("string");
    const validate = new Ajv2020({ strict: false }).compile(bundled);
    expect(validate({ leafy: "ok" })).toBe(true);
    expect(validate({ leafy: 42 })).toBe(false);
  });

  test("pointer fragments survive the rewrite and $id-less files get generated urns", async () => {
    writeJson("anon.schema.json", {
      $defs: { Named: { const: "named" } },
    });
    const entry = {
      properties: { pick: { $ref: "./anon.schema.json#/$defs/Named" } },
      type: "object",
    };
    const bundled = await bundleSchema(entry, loadJson, TMP);
    expect(dig(bundled, "properties", "pick", "$ref")).toBe("urn:jx:bundled:1#/$defs/Named");
    expect(dig(bundled, "$defs", "urn:jx:bundled:1", "$id")).toBe("urn:jx:bundled:1");
    const validate = new Ajv2020({ strict: false }).compile(bundled);
    expect(validate({ pick: "named" })).toBe(true);
    expect(validate({ pick: "other" })).toBe(false);
  });

  test("a target whose $id is already in the compound document is not embedded twice", async () => {
    writeJson("fields-default.schema.json", {
      $id: PROJECT_FIELDS_SCHEMA_ID,
      type: "object",
    });
    // The entry already embeds the fields resource ($defs.Fields) — the file ref must land there.
    const entry = {
      ...emitProjectSchema({ corePath: "./core.schema.json", fragments: [] }),
      properties: { probe: { $ref: "./fields-default.schema.json" } },
    };
    const bundled = await bundleSchema(entry, loadJson, TMP);
    expect(dig(bundled, "properties", "probe", "$ref")).toBe(PROJECT_FIELDS_SCHEMA_ID);
    const defs = bundled.$defs;
    expect(isJsonObject(defs)).toBe(true);
    expect(dig(defs, PROJECT_FIELDS_SCHEMA_ID)).toBeUndefined();
    expect(dig(defs, "Fields")).toBeDefined();
  });

  test("'..' segments normalize so aliased paths share one embed", async () => {
    const entry = {
      allOf: [
        { $ref: "./frags/../frags/project.fragment.schema.json" },
        { $ref: "./frags/project.fragment.schema.json" },
      ],
    };
    const bundled = await bundleSchema(entry, loadJson, TMP);
    const fragId = contentFragment.$id;
    expect(refsIn(bundled.allOf)).toEqual([fragId, fragId]);
    const defs = bundled.$defs;
    expect(isJsonObject(defs) ? Object.keys(defs) : defs).toEqual([fragId]);
  });

  test("alsoEmbed pulls in resources only a canonical-$id ref reaches", async () => {
    /* A document fragment's shapes are named by canonical URI from the paths union, so no
       path-`$ref` walks to the file — without alsoEmbed the union ref would dangle. */
    writeJson("frags/document.fragment.schema.json", {
      $defs: { ContentPathsSource: { properties: { collection: { type: "string" } } } },
      $id: "https://test.invalid/parser/document/v1",
    });
    const entry = {
      $defs: {
        PathsValue: { $ref: "https://test.invalid/parser/document/v1#/$defs/ContentPathsSource" },
      },
    };
    const bundled = await bundleSchema(entry, loadJson, TMP, [
      "./frags/document.fragment.schema.json",
    ]);
    expect(dig(bundled, "$defs", "https://test.invalid/parser/document/v1")).toBeDefined();
    // Self-contained: ajv compiles it with no external resolution.
    expect(() => new Ajv2020({ strict: false }).compile(bundled)).not.toThrow();
  });

  test("unloadable ref targets throw with the loader failure as cause", async () => {
    const entry = { $ref: "./does-not-exist.schema.json" };
    const failing = async () => {
      throw new Error("ENOENT boom");
    };
    expect(bundleSchema(entry, failing, TMP)).rejects.toThrow(
      /cannot load \$ref target ".*does-not-exist\.schema\.json": ENOENT boom/,
    );
    try {
      await bundleSchema(entry, failing, TMP);
    } catch (error) {
      expect(error).toMatchObject({ cause: expect.any(Error) });
    }
  });

  test("windows-style separators and local '#/...' refs are left semantically intact", async () => {
    const entry = {
      $defs: { Local: { type: "number" } },
      properties: { n: { $ref: "#/$defs/Local" } },
      type: "object",
    };
    const bundled = await bundleSchema(entry, loadJson, `${TMP}\\`);
    expect(dig(bundled, "properties", "n", "$ref")).toBe("#/$defs/Local");
    expect(bundled).toEqual(entry);
  });

  test("a ref collapsing to a bare filename resolves against '.' (no directory component)", async () => {
    // A "sub" baseDir plus a parent-escaping "../child.json" ref cancel out to a bare "child.json"
    // With no directory part, so schemaDirOf finds no "/" and returns "." as the embed's scope.
    const seen: string[] = [];
    const loader = async (path: string): Promise<JsonObject> => {
      seen.push(path);
      return { type: "string" };
    };
    const entry = { properties: { c: { $ref: "../child.json" } }, type: "object" };
    const bundled = await bundleSchema(entry, loader, "sub");
    expect(seen).toEqual(["child.json"]);
    expect(dig(bundled, "properties", "c", "$ref")).toBe("urn:jx:bundled:1");
  });

  test("leading '..' segments survive normalization for relative base dirs", async () => {
    // A relative baseDir with a parent-escaping ref keeps its ".." prefix (only absolute paths
    // Clamp at the root) — the loader receives the preserved relative path.
    const seen: string[] = [];
    const loader = async (path: string): Promise<JsonObject> => {
      seen.push(path);
      return { type: "string" };
    };
    const entry = { properties: { x: { $ref: "../../shared/frag.json" } }, type: "object" };
    const bundled = await bundleSchema(entry, loader, "rel");
    expect(seen).toEqual(["../shared/frag.json"]);
    expect(dig(bundled, "properties", "x", "$ref")).toBe("urn:jx:bundled:1");
  });
});
