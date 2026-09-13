/**
 * Tests for src/settings/schema-field-ui.ts — the field-type dispatch every schema editor shares.
 *
 * The module used to be a set of lit templates as well, and those assertions did not move here: the
 * card is a Jx document now (`surfaces/schema-builder.json`, driven by `ui/form-controls.ts`) and
 * `tests/form-controls.test.ts` drives it through its parts. What is left is the part no surface
 * could take with it — what a property's type IS, what format it carries, and what a chosen type
 * writes back — which is why three editors import it instead of each reading `type`, `items.format`
 * and `$ref` their own way.
 */
import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import {
  detectFieldFormat,
  detectFieldType,
  schemaForType,
  yamlDefault,
} from "../src/settings/schema-field-ui";

// ─── detectFieldType / detectFieldFormat ─────────────────────────────────────

describe("detectFieldType", () => {
  test("returns reference for $ref schemas", () => {
    expect(detectFieldType({ $ref: "#/content/posts" })).toBe("reference");
  });

  test("returns explicit type", () => {
    expect(detectFieldType({ type: "number" })).toBe("number");
    expect(detectFieldType({ type: "object" })).toBe("object");
  });

  test("defaults to string when no type", () => {
    expect(detectFieldType({})).toBe("string");
  });
});

describe("detectFieldFormat", () => {
  test("array reads format off items", () => {
    expect(detectFieldFormat({ items: { format: "image", type: "string" }, type: "array" })).toBe(
      "image",
    );
  });

  test("array without items format falls through to own format", () => {
    expect(detectFieldFormat({ items: { type: "string" }, type: "array" })).toBe("");
  });

  test("string format returned directly", () => {
    expect(detectFieldFormat({ format: "date", type: "string" })).toBe("date");
  });

  test("no format yields empty string", () => {
    expect(detectFieldFormat({ type: "string" })).toBe("");
  });
});

// ─── schemaForType ───────────────────────────────────────────────────────────

describe("schemaForType", () => {
  test("number", () => {
    expect(schemaForType("number")).toEqual({ type: "number" });
  });

  test("boolean", () => {
    expect(schemaForType("boolean")).toEqual({ type: "boolean" });
  });

  test("array without format", () => {
    expect(schemaForType("array")).toEqual({ items: { type: "string" }, type: "array" });
  });

  test("array with format puts format on items", () => {
    expect(schemaForType("array", "image")).toEqual({
      items: { format: "image", type: "string" },
      type: "array",
    });
  });

  test("object skeleton", () => {
    expect(schemaForType("object")).toEqual({ properties: {}, required: [], type: "object" });
  });

  test("reference produces empty $ref target", () => {
    expect(schemaForType("reference")).toEqual({ $ref: "#/content/" });
  });

  test("string default with and without format", () => {
    expect(schemaForType("string")).toEqual({ type: "string" });
    expect(schemaForType("string", "color")).toEqual({ format: "color", type: "string" });
  });
});

// ─── yamlDefault ─────────────────────────────────────────────────────────────

describe("yamlDefault", () => {
  test("date format yields ISO date (YYYY-MM-DD)", () => {
    expect(yamlDefault("string", "date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("image format yields empty quoted string", () => {
    expect(yamlDefault("string", "image")).toBe('""');
  });

  test("per-type defaults", () => {
    expect(yamlDefault("boolean")).toBe("false");
    expect(yamlDefault("number")).toBe("0");
    expect(yamlDefault("array")).toBe("[]");
    expect(yamlDefault("object")).toBe("{}");
    expect(yamlDefault("string")).toBe('""');
  });
});
