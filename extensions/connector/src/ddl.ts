/**
 * DDL — additive-only schema sync via the Kysely schema builder and introspector.
 *
 * The sync creates missing tables (with id and timestamp columns), adds missing columns to existing
 * tables (a to-one reference to a same-connection table gets a foreign key that clears on delete,
 * created targets-first), materializes junction tables for table↔table to-many references
 * (specs/relationships.md §3), and creates missing indexes. It NEVER drops or retypes anything:
 * type drift, columns unknown to the schema, orphaned junction tables, and reference columns whose
 * type or foreign key differs from the plan are reported as warnings, not fixed. `dryRun` compiles
 * the exact statements without executing them — the shape behind `jx db push --dry-run` and the
 * deploySchema capability.
 */

import { sql } from "kysely";
import { idDataType, planTable } from "./columns.ts";
import type { ColumnDefinitionBuilder, CreateTableBuilder, Kysely } from "kysely";
import type { ColumnSpec, SqlDialectKind, TablePlan } from "./columns.ts";
import type { DynamicDatabase } from "./query.ts";
import type { DeploySchemaResult, TableDef } from "./types.ts";

export interface SyncOptions {
  dialect: SqlDialectKind;
  /** Compile statements without executing them. */
  dryRun?: boolean;
}

/** Columns every synced table owns besides the schema fields. */
const SYSTEM_COLUMNS = new Set(["id", "created_at", "updated_at"]);

/** What deleting a referenced row does to the rows that point at it. */
const ON_DELETE = "set null";

interface Executable {
  compile: () => { sql: string };
  execute: () => Promise<void>;
}

/**
 * Synchronize the `data` section's tables into a database, additively.
 *
 * @param {Kysely<DynamicDatabase>} db - Kysely instance over the target connection
 * @param {Record<string, TableDef>} tables - Table definitions (the tables of one connection)
 * @param {SyncOptions} options
 * @returns {Promise<DeploySchemaResult>}
 */
export async function syncTables(
  db: Kysely<DynamicDatabase>,
  tables: Record<string, TableDef>,
  options: SyncOptions,
): Promise<DeploySchemaResult> {
  const { dialect, dryRun = false } = options;
  const statements: string[] = [];
  const warnings: string[] = [];

  const plans = orderPlans(
    Object.entries(tables).map(([name, def]) => planTable(name, def, tables, dialect)),
  );

  const introspected = await db.introspection.getTables({ withInternalKyselyTables: false });
  const existing = new Map(introspected.map((t) => [t.name, t]));
  const existingIndexes = await indexNames(db, dialect);
  const existingKeys = await foreignKeys(db, dialect);
  const ready = new Set(existing.keys());
  const deferred: { table: string; column: string; target: string }[] = [];

  const run = async (builder: Executable): Promise<void> => {
    statements.push(builder.compile().sql);
    if (!dryRun) {
      await builder.execute();
    }
  };

  const desiredNames = new Set<string>();
  for (const plan of plans) {
    desiredNames.add(plan.table);
    for (const junction of plan.junctions) {
      desiredNames.add(junction.table);
    }
  }

  for (const plan of plans) {
    const table = existing.get(plan.table);
    const keyInline = (col: ColumnSpec): boolean =>
      dialect === "sqlite" ||
      col.references!.table === plan.table ||
      ready.has(col.references!.table);
    const keyed =
      (col: ColumnSpec) =>
      (c: ColumnDefinitionBuilder): ColumnDefinitionBuilder =>
        c.references(`${col.references!.table}.id`).onDelete(ON_DELETE);
    const deferKey = (col: ColumnSpec): void => {
      deferred.push({ column: col.column, table: plan.table, target: col.references!.table });
    };
    if (!table) {
      await run(buildCreateTable(db, plan, dialect, keyInline));
      for (const col of plan.columns) {
        if (col.references && !keyInline(col)) {
          deferKey(col);
        }
      }
      ready.add(plan.table);
    } else {
      const byName = new Map(table.columns.map((c) => [c.name, c]));
      for (const col of plan.columns) {
        const current = byName.get(col.column);
        if (!current) {
          const inline = col.references !== null && keyInline(col);
          await run(
            inline
              ? db.schema.alterTable(plan.table).addColumn(col.column, col.dataType, keyed(col))
              : db.schema.alterTable(plan.table).addColumn(col.column, col.dataType),
          );
          if (col.references && !inline) {
            deferKey(col);
          }
          continue;
        }
        if (col.ref && !col.manyRef) {
          const drift = referenceDrift(plan.table, col, current.dataType, existingKeys);
          if (drift) {
            warnings.push(drift);
          }
        } else if (!sameDataType(current.dataType, col.dataType)) {
          warnings.push(
            `${plan.table}.${col.column}: type drift (database has "${current.dataType}", ` +
              `schema wants "${col.dataType}") — additive-only sync never retypes`,
          );
        }
      }
      if (plan.timestamps) {
        for (const stamp of ["created_at", "updated_at"]) {
          if (!byName.has(stamp)) {
            await run(db.schema.alterTable(plan.table).addColumn(stamp, "text"));
          }
        }
      }
      const declared = new Set(plan.columns.map((c) => c.column));
      for (const col of table.columns) {
        if (!declared.has(col.name) && !SYSTEM_COLUMNS.has(col.name)) {
          warnings.push(
            `${plan.table}.${col.name}: column exists in the database but not in the schema — ` +
              `never dropped`,
          );
        }
      }
    }

    for (const junction of plan.junctions) {
      if (!existing.has(junction.table)) {
        await run(
          db.schema
            .createTable(junction.table)
            .addColumn(junction.sourceColumn, junction.sourceIdType, (c) => c.notNull())
            .addColumn(junction.targetColumn, junction.targetIdType, (c) => c.notNull())
            .addPrimaryKeyConstraint(`${junction.table}_pk`, [
              junction.sourceColumn,
              junction.targetColumn,
            ]),
        );
      }
      const indexName = `${junction.table}_${junction.targetColumn}_idx`;
      if (!existingIndexes.has(indexName)) {
        await run(
          db.schema.createIndex(indexName).on(junction.table).columns([junction.targetColumn]),
        );
      }
    }

    for (const columns of plan.indexes) {
      const indexName = `${plan.table}_${columns.join("_")}_idx`;
      if (!existingIndexes.has(indexName)) {
        await run(db.schema.createIndex(indexName).on(plan.table).columns(columns));
      }
    }
  }

  for (const key of deferred) {
    await run(
      db.schema
        .alterTable(key.table)
        .addForeignKeyConstraint(
          `${key.table}_${key.column}_fkey`,
          [key.column],
          key.target,
          ["id"],
          (cb) => cb.onDelete(ON_DELETE),
        ),
    );
  }

  // Orphaned junction tables (a renamed to-many field leaves its old junction behind).
  const knownTables = new Set(plans.map((p) => p.table));
  for (const name of existing.keys()) {
    if (desiredNames.has(name) || knownTables.has(name)) {
      continue;
    }
    const looksLikeJunction = [...knownTables].some((t) => name.startsWith(`${t}_`));
    if (looksLikeJunction) {
      warnings.push(
        `${name}: junction table no longer matches any to-many field — orphaned, never dropped`,
      );
    }
  }

  return { applied: !dryRun, statements, warnings };
}

/** Build the CREATE TABLE for a plan (id strategy, timestamps, schema columns). */
function buildCreateTable(
  db: Kysely<DynamicDatabase>,
  plan: TablePlan,
  dialect: SqlDialectKind,
  keyInline: (col: ColumnSpec) => boolean,
): CreateTableBuilder<string, string> {
  let builder: CreateTableBuilder<string, string> = db.schema.createTable(plan.table);
  const idType = idDataType(plan.idType);
  builder =
    plan.idType === "integer"
      ? builder.addColumn("id", idType, (c) =>
          dialect === "postgres"
            ? c.primaryKey().generatedAlwaysAsIdentity()
            : c.primaryKey().autoIncrement(),
        )
      : builder.addColumn("id", idType, (c) => c.primaryKey().notNull());
  if (plan.timestamps) {
    builder = builder.addColumn("created_at", "text").addColumn("updated_at", "text");
  }
  for (const col of plan.columns) {
    builder =
      col.references && keyInline(col)
        ? builder.addColumn(col.column, col.dataType, (c) =>
            c.references(`${col.references!.table}.id`).onDelete(ON_DELETE),
          )
        : builder.addColumn(col.column, col.dataType);
  }
  return builder;
}

/**
 * Order plans so a key's target is created before its source (stable: declaration order breaks
 * ties, and a cycle takes the first remaining plan).
 */
function orderPlans(plans: TablePlan[]): TablePlan[] {
  const names = new Set(plans.map((p) => p.table));
  const placed = new Set<string>();
  const remaining = [...plans];
  const out: TablePlan[] = [];
  while (remaining.length > 0) {
    let index = remaining.findIndex((p) =>
      p.columns.every(
        (c) =>
          !c.references ||
          c.references.table === p.table ||
          !names.has(c.references.table) ||
          placed.has(c.references.table),
      ),
    );
    if (index === -1) {
      index = 0;
    }
    const [next] = remaining.splice(index, 1);
    placed.add(next!.table);
    out.push(next!);
  }
  return out;
}

/** Compare catalog and planned data types, normalising Postgres's catalog names. */
function sameDataType(have: string, want: string): boolean {
  const canonical = (type: string): string => {
    const lower = type.toLowerCase();
    switch (lower) {
      case "int":
      case "int4": {
        return "integer";
      }
      case "float8": {
        return "double precision";
      }
      case "bool": {
        return "boolean";
      }
      default: {
        return lower;
      }
    }
  };
  return canonical(have) === canonical(want);
}

/** The drift warning for a to-one reference column whose type or key differs from the plan. */
function referenceDrift(
  table: string,
  col: ColumnSpec,
  haveType: string,
  keys: Map<string, Map<string, string>> | null,
): string | null {
  const wantKey = col.references?.table ?? null;
  const haveKey = keys ? (keys.get(table)?.get(col.column) ?? null) : wantKey;
  if (sameDataType(haveType, col.dataType) && haveKey === wantKey) {
    return null;
  }
  const part = (key: string | null): string =>
    key === null ? " with no foreign key" : ` referencing "${key}"`;
  return (
    `${table}.${col.column}: reference column is ${haveType}${part(haveKey)}; the schema wants ` +
    `${col.dataType}${part(wantKey)} — additive-only sync never alters an existing column`
  );
}

/** Existing foreign keys (table → column → target table); null when the catalog is unreadable. */
async function foreignKeys(
  db: Kysely<DynamicDatabase>,
  dialect: SqlDialectKind,
): Promise<Map<string, Map<string, string>> | null> {
  try {
    const query =
      dialect === "postgres"
        ? sql<{ table: string; column: string; target: string }>`
            select kcu.table_name as "table", kcu.column_name as "column", ccu.table_name as target
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on kcu.constraint_schema = tc.constraint_schema and kcu.constraint_name = tc.constraint_name
            join information_schema.constraint_column_usage ccu
              on ccu.constraint_schema = tc.constraint_schema and ccu.constraint_name = tc.constraint_name
            where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = current_schema()`
        : sql<{ table: string; column: string; target: string }>`
            select m.name as "table", p."from" as "column", p."table" as target
            from sqlite_master m join pragma_foreign_key_list(m.name) p
            where m.type = 'table'`;
    const { rows } = await query.execute(db);
    const out = new Map<string, Map<string, string>>();
    for (const row of rows) {
      const columns = out.get(row.table) ?? new Map<string, string>();
      columns.set(row.column, row.target);
      out.set(row.table, columns);
    }
    return out;
  } catch {
    return null;
  }
}

/** Names of existing indexes (dialect-specific catalog queries; Kysely has no index introspection). */
async function indexNames(
  db: Kysely<DynamicDatabase>,
  dialect: SqlDialectKind,
): Promise<Set<string>> {
  try {
    const query =
      dialect === "postgres"
        ? sql<{ name: string }>`select indexname as name from pg_indexes`
        : sql<{ name: string }>`select name from sqlite_master where type = 'index'`;
    const { rows } = await query.execute(db);
    return new Set(rows.map((r) => r.name));
  } catch {
    // No catalog access (exotic dialect): fall back to emitting CREATE INDEX unconditionally.
    return new Set();
  }
}
