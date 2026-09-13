/**
 * Schema field semantics — what a studio field type IS, in JSON Schema terms, for every surface
 * that edits one.
 *
 * There is no markup here any more, and that is the point. This module was the shared FIELD CARD
 * for the content-types builder and the `$defs` editor, in lit over Spectrum; both draw the same
 * card as a Jx document now (`surfaces/schema-builder.json` and `surfaces/settings-defs.json`, one
 * vocabulary), and what neither of them could take with it is the dispatch below — which type a
 * property has, which format it carries, and what a chosen type writes back. Three surfaces agree
 * on that by importing it rather than by each reading `type`, `items.format` and `$ref` their own
 * way; `grid/schema-columns.ts` says so at its own door.
 */

import { isMediaFormat } from "../utils/studio-utils";

export interface SchemaProperty {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  items?: SchemaProperty;
  format?: string;
  $ref?: string;
}

export const FIELD_TYPES = ["string", "number", "boolean", "array", "object", "reference"];

export const FORMAT_OPTIONS = ["", "image", "date", "color"];

/**
 * Detect the studio field type from a JSON Schema property definition.
 *
 * @param {SchemaProperty} schema
 * @returns {string}
 */
export function detectFieldType(schema: SchemaProperty) {
  if (schema.$ref) {
    return "reference";
  }
  return schema.type || "string";
}

/**
 * Detect the format from a JSON Schema property definition.
 *
 * @param {SchemaProperty} schema
 * @returns {string}
 */
export function detectFieldFormat(schema: SchemaProperty) {
  if (schema.type === "array" && schema.items?.format) {
    return schema.items.format;
  }
  return schema.format || "";
}

/**
 * Build a JSON Schema property definition from a type and optional format.
 *
 * @param {string} type
 * @param {string} [format]
 * @returns {object}
 */
export function schemaForType(type: string, format?: string) {
  switch (type) {
    case "number": {
      return { type: "number" };
    }
    case "boolean": {
      return { type: "boolean" };
    }
    case "array": {
      return format
        ? { items: { format, type: "string" }, type: "array" }
        : { items: { type: "string" }, type: "array" };
    }
    case "object": {
      return { properties: {}, required: [], type: "object" };
    }
    case "reference": {
      return { $ref: "#/content/" };
    }
    default: {
      return format ? { format, type: "string" } : { type: "string" };
    }
  }
}

/**
 * Generate a YAML frontmatter default value for a given schema type.
 *
 * @param {string} type
 * @param {string} [format]
 * @returns {string}
 */
export function yamlDefault(type: string, format?: string) {
  if (format === "date") {
    return new Date().toISOString().split("T")[0];
  }
  if (isMediaFormat(format)) {
    return '""';
  }
  switch (type) {
    case "boolean": {
      return "false";
    }
    case "number": {
      return "0";
    }
    case "array": {
      return "[]";
    }
    case "object": {
      return "{}";
    }
    default: {
      return '""';
    }
  }
}
