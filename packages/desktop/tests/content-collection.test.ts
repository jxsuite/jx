/**
 * Regression coverage for the desktop's integration with the parser's ContentCollection class.
 *
 * Two paths previously broke in the desktop build:
 *
 * 1. The class-driven config form — fetchPluginSchema() could not resolve a bare specifier like
 *    "@jxsuite/parser/ContentCollection.class.json", so the studio showed an empty form.
 * 2. The data sidebar — the runtime resolves the class by POSTing to /**jx_resolve**, which the
 *    desktop now serves via the jxResolve handler (loading content types + injecting _project).
 */
import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { isJsonObject, isNonNullObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

const { setProjectRoot, fetchPluginSchema, fetchProjectSchemas, jxResolve, listExtensions } =
  await import("./_session");

const PROJECT = join(import.meta.dir, "_fixtures_content");

/** Whether a plugin schema carries the `properties` map the config form is built from. */
function hasFormProperties(value: unknown): value is { properties: JsonObject } {
  return isNonNullObject(value) && "properties" in value && isJsonObject(value.properties);
}

/** Whether a schema member is a list of `{ $ref }` pointers (an `allOf` of root pointers). */
function isRefList(value: unknown): value is { $ref: string }[] {
  return (
    Array.isArray(value) && value.every((entry) => isJsonObject(entry) && isString(entry.$ref))
  );
}

/** Decode a jxResolve reply into each collection entry's `data.title`, failing on any other shape. */
function entryTitles(body: string): (JsonValue | undefined)[] {
  const entries: JsonValue = JSON.parse(body);
  if (!Array.isArray(entries)) {
    throw new TypeError(`jxResolve did not reply with an array: ${body}`);
  }
  return entries.map((entry) => {
    const data = isJsonObject(entry) ? entry.data : undefined;
    if (!isJsonObject(data)) {
      throw new Error(`jxResolve entry has no data object: ${JSON.stringify(entry)}`);
    }
    return data.title;
  });
}

describe("ContentCollection desktop integration", () => {
  test("fetchPluginSchema resolves a bare-specifier .class.json (drives the config form)", async () => {
    setProjectRoot(PROJECT);
    const schema = await fetchPluginSchema({
      prototype: "ContentCollection",
      src: "@jxsuite/parser/ContentCollection.class.json",
    });

    expect(schema).not.toBeNull();
    if (!hasFormProperties(schema)) {
      throw new Error("fetchPluginSchema returned a schema with no properties");
    }
    // The form is built from these constructor parameters.
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["contentType", "filter", "sort", "limit"]),
    );
    setProjectRoot(null);
  });

  test("jxResolve runs ContentCollection.resolve() with project content types (feeds the data sidebar)", async () => {
    setProjectRoot(PROJECT);
    const { status, body } = await jxResolve({
      body: JSON.stringify({
        $prototype: "ContentCollection",
        $src: "@jxsuite/parser/ContentCollection.class.json",
        contentType: "docs",
        sort: { field: "order", order: "asc" },
      }),
    });

    expect(status).toBe(200);
    expect(entryTitles(body)).toEqual(["Getting Started", "Advanced"]);
    setProjectRoot(null);
  });

  test("jxResolve honours filter rules", async () => {
    setProjectRoot(PROJECT);
    const { status, body } = await jxResolve({
      body: JSON.stringify({
        $prototype: "ContentCollection",
        $src: "@jxsuite/parser/ContentCollection.class.json",
        contentType: "docs",
        filter: [{ field: "title", op: "==", value: "Advanced" }],
      }),
    });

    expect(status).toBe(200);
    expect(entryTitles(body)).toEqual(["Advanced"]);
    setProjectRoot(null);
  });

  test("listExtensions serves the parser contribution with its fragment entry schema", async () => {
    setProjectRoot(PROJECT);
    const extensions = await listExtensions();
    expect(extensions).toHaveLength(1);
    expect(extensions[0]!.specifier).toBe("@jxsuite/parser");
    const content = extensions[0]!.contributions.find((c) => c.project.key === "content")!;
    expect(content.className).toBe("Content");
    const settings = content.studio?.settings;
    expect(isJsonObject(settings) ? settings.layout : undefined).toBe("map");
    const { entrySchema } = content;
    const entryValueSchema = isJsonObject(entrySchema)
      ? entrySchema.additionalProperties
      : undefined;
    const entryProperties = isJsonObject(entryValueSchema)
      ? entryValueSchema.properties
      : undefined;
    expect(Object.keys(isJsonObject(entryProperties) ? entryProperties : {})).toContain("source");
    setProjectRoot(null);
  });

  test("fetchProjectSchemas returns self-contained bundles (drives Monaco registration)", async () => {
    setProjectRoot(PROJECT);
    try {
      const { project, document } = await fetchProjectSchemas();
      // Root pointers only: Monaco gets these as inline objects and never fetches a URI.
      const allOf = project?.allOf;
      if (!isRefList(allOf)) {
        throw new Error("the project schema bundle has no allOf of root pointers");
      }
      expect(allOf.map((entry) => entry.$ref)).toEqual([
        "#/$defs/project-core-v2",
        "#/$defs/ext-parser-project-v1",
      ]);
      const projectDefs = project?.$defs;
      if (!isJsonObject(projectDefs)) {
        throw new Error("the project schema bundle has no $defs");
      }
      expect(projectDefs["ext-parser-project-v1"]).toBeDefined();
      expect(document?.$ref).toBeUndefined();
      const documentAllOf = document?.allOf;
      if (!isRefList(documentAllOf)) {
        throw new Error("the document schema bundle has no allOf of root pointers");
      }
      expect(documentAllOf.map((entry) => entry.$ref)).toEqual(["#/$defs/v1"]);
    } finally {
      // The bundler regenerates the entry documents on demand — keep the fixture pristine.
      rmSync(join(PROJECT, "project.schema.json"), { force: true });
      rmSync(join(PROJECT, "document.schema.json"), { force: true });
      setProjectRoot(null);
    }
  });
});
