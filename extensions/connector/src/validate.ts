/**
 * Validate — hand-rolled row validation against a table's column schema.
 *
 * Deliberately not ajv: ajv compiles validators with `new Function`, which Workers forbid. The
 * grammar here is the small field-schema subset tables actually use (scalar types, arrays, objects,
 * enums, relationship refs), plus payload-level rules: unknown and read-only fields are rejected,
 * required fields are enforced on full (insert) validation, and form-shaped string values are
 * coerced to their declared column types ("42" → 42, "true" → true) so plain FormData submissions
 * validate cleanly.
 */

import { isBoolean, isJsonObject, isNumber, isString } from "@jxsuite/schema/guards";
import { foreignKeyTarget, parseRefPointer, typedId } from "./columns.ts";
import type { RefTarget } from "./columns.ts";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import type { ColumnFieldSchema, TableDef } from "./types.ts";

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  /** The coerced payload (schema-typed values), keyed by schema field name. */
  value: JsonObject;
}

/** Columns the data mount owns; clients may never write them. */
const READ_ONLY_FIELDS = new Set(["id", "created_at", "updated_at"]);

/**
 * Validate (and coerce) a row payload against a table definition.
 *
 * @param {TableDef} table - The table definition from the `data` section
 * @param {JsonValue} payload - Parsed request body
 * @param {{ partial?: boolean; tables?: Record<string, TableDef> }} [options] - `partial` skips
 *   required-field checks (PATCH); `tables` (the data section) enables the integer-id shape rule
 * @returns {ValidationResult}
 */
export function validateRow(
  table: TableDef,
  payload: JsonValue,
  options: { partial?: boolean; tables?: Record<string, TableDef> } = {},
): ValidationResult {
  const { partial = false, tables } = options;
  const errors: ValidationIssue[] = [];
  const value: JsonObject = {};

  if (!isJsonObject(payload)) {
    return { errors: [{ field: "", message: "Body must be a JSON object" }], valid: false, value };
  }
  const fields = table.schema.properties ?? {};

  for (const [key, raw] of Object.entries(payload)) {
    if (READ_ONLY_FIELDS.has(key)) {
      errors.push({ field: key, message: "Read-only field" });
      continue;
    }
    const schema = fields[key];
    if (!schema) {
      errors.push({ field: key, message: "Unknown field" });
      continue;
    }
    const coerced = coerceField(
      key,
      schema,
      raw,
      errors,
      (ref) => foreignKeyTarget(ref, table, tables ?? {})?.idType === "integer",
    );
    if (coerced !== INVALID) {
      value[key] = coerced;
    }
  }

  if (!partial) {
    for (const required of table.schema.required ?? []) {
      if (payload[required] === undefined) {
        errors.push({ field: required, message: "Required field is missing" });
      }
    }
  }

  return { errors, valid: errors.length === 0, value };
}

/** Sentinel distinguishing "coercion failed" from a legitimate undefined/null value. */
const INVALID = Symbol("invalid");

/**
 * Coerce one payload value against its field schema, appending errors on mismatch.
 *
 * @param {string} field
 * @param {ColumnFieldSchema} schema
 * @param {JsonValue} raw
 * @param {ValidationIssue[]} errors
 * @param {(ref: RefTarget) => boolean} isIntegerTarget - Whether a ref keys an integer-id table
 * @returns {JsonValue | typeof INVALID} The coerced value, or the INVALID sentinel
 */
function coerceField(
  field: string,
  schema: ColumnFieldSchema,
  raw: JsonValue,
  errors: ValidationIssue[],
  isIntegerTarget: (ref: RefTarget) => boolean,
): JsonValue | typeof INVALID {
  if (raw === null) {
    return null;
  }

  const toOne = parseRefPointer(schema.$ref);
  if (toOne) {
    if (!isString(raw) || raw === "") {
      errors.push({ field, message: "Reference value must be an entry id string" });
      return INVALID;
    }
    if (isIntegerTarget(toOne) && typedId("integer", raw) === undefined) {
      errors.push({ field, message: "Reference value must be an integer id" });
      return INVALID;
    }
    return raw;
  }

  const itemsRef = schema.type === "array" ? parseRefPointer(schema.items?.$ref) : null;
  if (itemsRef) {
    const list = parseMaybeJson(raw);
    if (!Array.isArray(list) || list.some((item) => !isString(item) || item === "")) {
      errors.push({ field, message: "Reference list must be an array of entry id strings" });
      return INVALID;
    }
    if (isIntegerTarget(itemsRef) && list.some((item) => typedId("integer", item) === undefined)) {
      errors.push({ field, message: "Reference list must be an array of integer ids" });
      return INVALID;
    }
    return list;
  }

  const coerced = coerceScalar(schema, raw);
  if (coerced === INVALID) {
    errors.push({ field, message: `Expected ${schema.type ?? "string"}` });
    return INVALID;
  }
  if (schema.enum && !schema.enum.some((allowed) => allowed === coerced)) {
    errors.push({ field, message: "Value is not one of the allowed choices" });
    return INVALID;
  }
  return coerced;
}

/** Coerce a scalar payload value to its schema type, or INVALID. */
function coerceScalar(schema: ColumnFieldSchema, raw: JsonValue): JsonValue | typeof INVALID {
  switch (schema.type) {
    case "number":
    case "integer": {
      let num: number;
      if (isNumber(raw)) {
        num = raw;
      } else if (isString(raw) && raw.trim() !== "" && !Number.isNaN(Number(raw))) {
        num = Number(raw);
      } else {
        return INVALID;
      }
      if (schema.type === "integer" && !Number.isInteger(num)) {
        return INVALID;
      }
      return num;
    }
    case "boolean": {
      if (isBoolean(raw)) {
        return raw;
      }
      if (raw === "true" || raw === "on" || raw === "1" || raw === 1) {
        return true;
      }
      if (raw === "false" || raw === "off" || raw === "0" || raw === 0 || raw === "") {
        return false;
      }
      return INVALID;
    }
    case "array": {
      const parsed = parseMaybeJson(raw);
      return Array.isArray(parsed) ? parsed : INVALID;
    }
    case "object": {
      const parsed = parseMaybeJson(raw);
      return isJsonObject(parsed) ? parsed : INVALID;
    }
    default: {
      return isString(raw) ? raw : INVALID;
    }
  }
}

/** Parse JSON-looking strings (FormData carries arrays/objects as text); pass everything else. */
function parseMaybeJson(raw: JsonValue): JsonValue {
  if (!isString(raw)) {
    return raw;
  }
  const text = raw.trim();
  if (!text.startsWith("[") && !text.startsWith("{")) {
    return raw;
  }
  try {
    return JSON.parse(text);
  } catch {
    return raw;
  }
}
