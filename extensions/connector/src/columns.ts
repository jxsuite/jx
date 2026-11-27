/**
 * Columns — single source of truth for field schema → SQL column mapping and value coercion.
 *
 * Table column schemas are plain Jx field schemas (the core field union) plus relationship refs
 * (specs/relationships.md). This module derives the physical column plan for a table — scalar
 * columns, reference FK columns, and junction tables for table↔table to-many refs — and the two-way
 * value coercion between JSON payloads and SQL storage.
 *
 * Storage model (v1, uniform across sqlite and postgres):
 *
 * - String → text · number → real/double precision · integer → integer
 * - Boolean → integer 0/1 on sqlite, boolean on postgres
 * - Array/object → JSON-serialized text
 * - To-one reference (`{ $ref }`) → `<field>_id` column storing the target id: typed like a
 *   same-connection table target's `id` and carrying a foreign key, else `text` with no key
 * - To-many reference to a table on the same connection (`array` of `$ref` into the data section) →
 *   junction table `${sourceTable}_${fieldName}` (relationships.md §3), no column on the source
 * - To-many reference to any other section or connection → JSON text column of id strings
 */

import { isBoolean, isNumber, isString } from "@jxsuite/schema/guards";
import type { ColumnDataType } from "kysely";
import type { JsonValue } from "@jxsuite/schema/types";
import type { DynamicRow, SqlValue } from "./query.ts";
import type { TableDef } from "./types.ts";

export type SqlDialectKind = "sqlite" | "postgres";

/** Parsed relationship-ref target: `#/<sectionKey>/<entryName>`. */
export interface RefTarget {
  section: string;
  name: string;
}

/** Parse a relationship ref pointer, or null when the string is not one. */
export function parseRefPointer(pointer: JsonValue | undefined): RefTarget | null {
  if (!isString(pointer)) {
    return null;
  }
  const match = pointer.match(/^#\/([A-Za-z][\w-]*)\/([\w.-]+)$/);
  if (!match) {
    return null;
  }
  return { name: match[2]!, section: match[1]! };
}

/** A table a to-one reference column can carry a foreign key to. */
export interface ForeignKeyTarget {
  table: string;
  idType: "uuid" | "integer";
}

/**
 * The key-able target of a table → table reference: the pointer's section is `data`, the target is
 * declared, and it lives on the source table's connection (one database holds neither a key nor a
 * join into another). Null for everything else.
 *
 * @param {RefTarget | null} ref
 * @param {TableDef} source
 * @param {Record<string, TableDef>} allTables
 * @returns {ForeignKeyTarget | null}
 */
export function foreignKeyTarget(
  ref: RefTarget | null,
  source: TableDef,
  allTables: Record<string, TableDef>,
): ForeignKeyTarget | null {
  if (ref?.section !== "data") {
    return null;
  }
  const target = allTables[ref.name];
  if (!target || target.connection !== source.connection) {
    return null;
  }
  return { idType: target.id ?? "uuid", table: ref.name };
}

/** The one id comparison: `1` and `"1"` are the same key; nullish is null. */
export function idKey(value: SqlValue | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * Convert an id to its target's kind for a query or a bind: an integer id is a safe integer (or its
 * decimal string), a uuid id a non-empty string. Undefined when malformed.
 */
export function typedId(
  idType: "uuid" | "integer",
  value: SqlValue | undefined,
): string | number | undefined {
  if (idType === "uuid") {
    return isString(value) && value !== "" ? value : undefined;
  }
  if (isNumber(value)) {
    return Number.isSafeInteger(value) ? value : undefined;
  }
  if (isString(value) && /^-?\d+$/.test(value)) {
    const num = Number(value);
    return Number.isSafeInteger(num) ? num : undefined;
  }
  return undefined;
}

/** How a column's values are stored and coerced. */
export type ColumnStorage = "text" | "number" | "integer" | "boolean" | "json";

/** One physical column derived from a schema field. */
export interface ColumnSpec {
  /** Schema field name (the wire-payload key). */
  field: string;
  /** Physical column name (`<field>_id` for to-one references). */
  column: string;
  /** SQL data type passed to the Kysely schema builder. */
  dataType: ColumnDataType;
  storage: ColumnStorage;
  /** Set for reference fields (to-one FK columns and to-many JSON id lists). */
  ref: RefTarget | null;
  /** True for to-many reference fields stored as JSON id arrays (non-table targets). */
  manyRef: boolean;
  /** Set only on a keyed to-one column: the table its foreign key targets. */
  references: ForeignKeyTarget | null;
}

/** A junction table materializing a table↔table to-many reference (relationships.md §3). */
export interface JunctionSpec {
  /** Junction table name: `${sourceTable}_${fieldName}`. */
  table: string;
  /** Schema field on the source table this junction materializes. */
  field: string;
  sourceTable: string;
  targetTable: string;
  /** `${sourceTable}_id`. */
  sourceColumn: string;
  /** `${targetTable}_id`, suffixed `_2` when the reference is self-referential. */
  targetColumn: string;
  sourceIdType: ColumnDataType;
  targetIdType: ColumnDataType;
}

/** The full physical plan for one table. */
export interface TablePlan {
  table: string;
  idType: "uuid" | "integer";
  timestamps: boolean;
  columns: ColumnSpec[];
  junctions: JunctionSpec[];
  indexes: string[][];
}

/** SQL data type of a table's primary key. */
export function idDataType(idKind: "uuid" | "integer"): ColumnDataType {
  return idKind === "uuid" ? "text" : "integer";
}

/** Map a scalar field schema type to the SQL data type for a dialect. */
function scalarDataType(type: string | undefined, dialect: SqlDialectKind): ColumnDataType {
  switch (type) {
    case "number": {
      return dialect === "postgres" ? "double precision" : "real";
    }
    case "integer": {
      return "integer";
    }
    case "boolean": {
      return dialect === "postgres" ? "boolean" : "integer";
    }
    default: {
      return "text";
    }
  }
}

/** Storage class for a scalar field schema type. */
function scalarStorage(type: string | undefined): ColumnStorage {
  switch (type) {
    case "number": {
      return "number";
    }
    case "integer": {
      return "integer";
    }
    case "boolean": {
      return "boolean";
    }
    case "array":
    case "object": {
      return "json";
    }
    default: {
      return "text";
    }
  }
}

/**
 * Derive the physical plan for a table: columns, junction tables, and index column lists.
 *
 * @param {string} tableName - The data-section key naming the table
 * @param {TableDef} table - The table definition
 * @param {Record<string, TableDef>} allTables - The full data section (junction id types)
 * @param {SqlDialectKind} dialect - SQL dialect family
 * @returns {TablePlan}
 */
export function planTable(
  tableName: string,
  table: TableDef,
  allTables: Record<string, TableDef>,
  dialect: SqlDialectKind,
): TablePlan {
  const idType = table.id ?? "uuid";
  const columns: ColumnSpec[] = [];
  const junctions: JunctionSpec[] = [];

  for (const [field, schema] of Object.entries(table.schema.properties ?? {})) {
    const toOne = parseRefPointer(schema.$ref);
    if (toOne) {
      const target = foreignKeyTarget(toOne, table, allTables);
      columns.push({
        column: `${field}_id`,
        dataType: target ? idDataType(target.idType) : "text",
        field,
        manyRef: false,
        ref: toOne,
        references: target,
        storage: "text",
      });
      continue;
    }

    const itemsRef = schema.type === "array" ? parseRefPointer(schema.items?.$ref) : null;
    const junctionTarget = foreignKeyTarget(itemsRef, table, allTables);
    if (itemsRef && junctionTarget) {
      const selfRef = itemsRef.name === tableName;
      junctions.push({
        field,
        sourceColumn: `${tableName}_id`,
        sourceIdType: idDataType(idType),
        sourceTable: tableName,
        table: `${tableName}_${field}`,
        targetColumn: selfRef ? `${itemsRef.name}_id_2` : `${itemsRef.name}_id`,
        targetIdType: idDataType(junctionTarget.idType),
        targetTable: itemsRef.name,
      });
      continue;
    }
    if (itemsRef) {
      // To-many reference into a non-table section or another connection: JSON array of id strings.
      columns.push({
        column: field,
        dataType: "text",
        field,
        manyRef: true,
        ref: itemsRef,
        references: null,
        storage: "json",
      });
      continue;
    }

    columns.push({
      column: field,
      dataType: scalarDataType(schema.type, dialect),
      field,
      manyRef: false,
      ref: null,
      references: null,
      storage: scalarStorage(schema.type),
    });
  }

  // The owner column backs "owner" permission rules even when the schema does not declare it —
  // The data mount writes it via setColumns and scopes reads/writes through whereOwner.
  if (table.ownerField && !columns.some((c) => c.field === table.ownerField)) {
    columns.push({
      column: table.ownerField,
      dataType: "text",
      field: table.ownerField,
      manyRef: false,
      ref: null,
      references: null,
      storage: "text",
    });
  }

  const byField = new Map(columns.map((c) => [c.field, c.column]));
  const indexes: string[][] = [];
  for (const index of table.indexes ?? []) {
    const fields = Array.isArray(index) ? index : [index];
    const cols = fields.map((f) => byField.get(f) ?? f);
    indexes.push(cols);
  }

  return {
    columns,
    idType,
    indexes,
    junctions,
    table: tableName,
    timestamps: table.timestamps !== false,
  };
}

/** Generate a fresh primary key for an insert, or undefined when the database assigns one. */
export function newRowId(idKind: "uuid" | "integer"): string | undefined {
  return idKind === "uuid" ? crypto.randomUUID() : undefined;
}

/**
 * Coerce one JSON payload value to its SQL storage representation.
 *
 * @param {ColumnSpec} spec
 * @param {JsonValue | undefined} value - Already-validated payload value
 * @param {SqlDialectKind} dialect
 * @returns {JsonValue}
 */
export function toStorage(
  spec: ColumnSpec,
  value: JsonValue | undefined,
  dialect: SqlDialectKind,
): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (spec.references?.idType === "integer" && isString(value)) {
    return typedId("integer", value) ?? value;
  }
  switch (spec.storage) {
    case "boolean": {
      return dialect === "postgres" ? value === true : value === true ? 1 : 0;
    }
    case "json": {
      return JSON.stringify(value);
    }
    default: {
      return value;
    }
  }
}

/**
 * Coerce a database row back to its JSON payload shape (booleans, JSON columns).
 *
 * @param {ColumnSpec[]} specs - Column plan of the table
 * @param {DynamicRow} row - Raw row from the driver
 * @returns {DynamicRow}
 */
export function fromStorage(specs: ColumnSpec[], row: DynamicRow) {
  const out = { ...row };
  for (const spec of specs) {
    const value = out[spec.column];
    if (value === null || value === undefined) {
      continue;
    }
    if (spec.references?.idType === "integer" && isNumber(value)) {
      out[spec.column] = String(value);
    } else if (spec.storage === "boolean" && !isBoolean(value)) {
      out[spec.column] = value === 1 || value === "1";
    } else if (spec.storage === "json" && isString(value)) {
      try {
        /* SAFETY: JSON.parse only ever yields JSON values (null, booleans, numbers, strings, arrays
           and plain objects); a malformed string throws instead and is handled below. */
        out[spec.column] = JSON.parse(value) as JsonValue;
      } catch {
        // Malformed stored JSON stays a string rather than failing the read.
      }
    }
  }
  return out;
}
