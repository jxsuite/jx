/**
 * Tests for src/services/context-resolver.ts — generic `#/$context/` pointer resolution: plain
 * walks, `{@param}` substitution, the `$formats` virtual root, and a regression suite pinning the
 * `content` enum refs shipped in the real ContentCollection.class.json.
 */
import { describe, expect, test } from "bun:test";
import { resolveContextPointer } from "../src/services/context-resolver";
import contentCollectionClass from "@jxsuite/parser/ContentCollection.class.json";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { JsonValue, ProjectConfig } from "@jxsuite/schema/types";

const projectConfig = {
  auth: { roles: ["admin", "editor"] },
  connections: { main: { provider: "d1" }, replica: { provider: "sqlite" } },
  content: {
    page: { schema: { properties: { body: {}, title: {} } }, source: "./content/page/" },
    post: {
      schema: { properties: { date: {}, slug: {}, title: {} } },
      source: "./content/post/",
    },
  },
} satisfies ProjectConfig;

describe("resolveContextPointer basics", () => {
  test("non-context pointers resolve to undefined", () => {
    expect(resolveContextPointer("#/content", { projectConfig })).toBeUndefined();
    expect(resolveContextPointer("$contentTypes", { projectConfig })).toBeUndefined();
    expect(resolveContextPointer("", { projectConfig })).toBeUndefined();
  });

  test("walks top-level and nested project config keys", () => {
    expect(resolveContextPointer("#/$context/connections", { projectConfig })).toEqual(
      projectConfig.connections,
    );
    expect(resolveContextPointer("#/$context/auth/roles", { projectConfig })).toEqual([
      "admin",
      "editor",
    ]);
    expect(
      resolveContextPointer("#/$context/content/post/schema/properties", { projectConfig }),
    ).toEqual({ date: {}, slug: {}, title: {} });
  });

  // Legacy-form coverage: old class descriptors point at `contentTypes`; the walker is key-agnostic
  // So a contentTypes-keyed config keeps resolving.
  test("follows any section name without special-casing (legacy contentTypes vs content)", () => {
    const config = { contentTypes: { doc: { schema: {} } } } satisfies ProjectConfig;
    expect(resolveContextPointer("#/$context/contentTypes", { projectConfig: config })).toEqual({
      doc: { schema: {} },
    });
  });

  test("missing segments resolve to undefined", () => {
    expect(resolveContextPointer("#/$context/nope", { projectConfig })).toBeUndefined();
    expect(
      resolveContextPointer("#/$context/content/missing/schema", { projectConfig }),
    ).toBeUndefined();
    expect(
      resolveContextPointer("#/$context/auth/roles/0/deeper", { projectConfig }),
    ).toBeUndefined();
  });

  test("walking through a primitive resolves to undefined", () => {
    const config = { name: "site" } satisfies ProjectConfig;
    expect(
      resolveContextPointer("#/$context/name/deeper", { projectConfig: config }),
    ).toBeUndefined();
  });

  test("array indices resolve as plain segments", () => {
    expect(resolveContextPointer("#/$context/auth/roles/1", { projectConfig })).toBe("editor");
  });
});

describe("{@param} substitution", () => {
  test("substitutes string scope values into the walk", () => {
    expect(
      resolveContextPointer("#/$context/content/{@contentType}/schema/properties", {
        projectConfig,
        scope: { contentType: "post" },
      }),
    ).toEqual({ date: {}, slug: {}, title: {} });
  });

  test("numeric scope values substitute as strings", () => {
    expect(
      resolveContextPointer("#/$context/auth/roles/{@idx}", {
        projectConfig,
        scope: { idx: 0 },
      }),
    ).toBe("admin");
  });

  test("missing scope, missing param, or empty value resolve to undefined", () => {
    const pointer = "#/$context/content/{@contentType}/schema/properties";
    expect(resolveContextPointer(pointer, { projectConfig })).toBeUndefined();
    expect(resolveContextPointer(pointer, { projectConfig, scope: {} })).toBeUndefined();
    expect(
      resolveContextPointer(pointer, { projectConfig, scope: { contentType: "" } }),
    ).toBeUndefined();
    expect(
      resolveContextPointer(pointer, { projectConfig, scope: { contentType: { odd: true } } }),
    ).toBeUndefined();
  });
});

describe("$formats virtual root", () => {
  test("returns registered format names", () => {
    expect(
      resolveContextPointer("#/$context/$formats", {
        formats: [{ name: "markdown" }, { name: "json" }],
        projectConfig,
      }),
    ).toEqual(["markdown", "json"]);
  });

  test("defaults to an empty list without formats", () => {
    expect(resolveContextPointer("#/$context/$formats", { projectConfig })).toEqual([]);
  });

  test("sub-pointers under $formats resolve to undefined", () => {
    expect(
      resolveContextPointer("#/$context/$formats/markdown", {
        formats: [{ name: "markdown" }],
        projectConfig,
      }),
    ).toBeUndefined();
  });
});

// ─── Regression: ContentCollection.class.json enum refs ──────────────────────

const classParams = contentCollectionClass.$defs.parameters;

/** The keys an enum consumer offers for a resolved object; anything else fails the test. */
function enumChoices(resolved: JsonValue | undefined): string[] {
  if (!isJsonObject(resolved)) {
    throw new TypeError(`expected the pointer to resolve to an object, got ${String(resolved)}`);
  }
  return Object.keys(resolved);
}

describe("ContentCollection.class.json enum refs (descriptor regression)", () => {
  test("contentType enum ref resolves to the project content type keys", () => {
    const ref = classParams.contentType.type.enum.$ref;
    expect(ref).toBe("#/$context/content");
    const resolved = resolveContextPointer(ref, { projectConfig });
    // Enum consumers apply Object.keys to object results — same choices as before
    expect(enumChoices(resolved)).toEqual(["page", "post"]);
  });

  test("filter/sort field enum refs resolve the selected content type's properties", () => {
    for (const param of ["filter", "sort"] as const) {
      const ref = classParams[param].type.items.properties.field.enum.$ref;
      expect(ref).toBe("#/$context/content/{@contentType}/schema/properties");
      const resolved = resolveContextPointer(ref, {
        projectConfig,
        scope: { contentType: "post" },
      });
      expect(enumChoices(resolved)).toEqual(["date", "slug", "title"]);
    }
  });

  test("field enum refs without a selected contentType resolve to undefined (textfield fallback)", () => {
    const ref = classParams.filter.type.items.properties.field.enum.$ref;
    expect(resolveContextPointer(ref, { projectConfig, scope: {} })).toBeUndefined();
  });
});
