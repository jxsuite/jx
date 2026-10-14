/**
 * Provider-utils — shared machinery behind the connector capability methods.
 *
 * Each provider (d1, supabase, sqlite) resolves a Kysely dialect its own way; deploySchema and
 * testConnection are then identical: open Kysely over the dialect, run the additive sync (or a
 * probe select), and always destroy the instance. Kept separate from connectors.ts so the provider
 * modules can share it without an import cycle.
 */

import { Kysely, sql } from "kysely";
import { syncTables } from "./ddl.ts";
import type { D1Database } from "@cloudflare/workers-types";
import type { Dialect } from "kysely";
import type { JsonObject } from "@jxsuite/schema/types";
import type { SqlDialectKind } from "./columns.ts";
import type { DynamicDatabase } from "./query.ts";
import type { ConnectionDef, DeploySchemaResult, TableDef, TestConnectionResult } from "./types.ts";

/** A Hyperdrive binding as the Supabase provider reads it: only its pooled connection string. */
export interface HyperdriveBinding {
  readonly connectionString: string;
}

/**
 * One host environment entry: an env var or secret (a string), or a platform binding a connection
 * names through its `binding` field (a D1 database, a Hyperdrive config).
 */
export type HostEnvValue = string | D1Database | HyperdriveBinding;

/**
 * The host environment a connection resolves against: process.env merged under `.dev.vars` plus
 * `JX_PROJECT_ROOT` on node/Bun hosts, or the Worker `env` (vars, secrets and bindings) on
 * Cloudflare. Connections carry identifiers only; every secret and binding is read from here.
 */
export type HostEnv = Readonly<Record<string, HostEnvValue | undefined>>;

/** The static capability surface of a connector provider implementation. */
export interface ConnectorProvider {
  kind: SqlDialectKind;
  dialect: (connection: ConnectionDef, env: HostEnv) => Dialect | Promise<Dialect>;
  deploySchema: (
    tables: Record<string, TableDef>,
    connection: ConnectionDef,
    options: { env: HostEnv; dryRun?: boolean },
  ) => Promise<DeploySchemaResult>;
  /** The wrangler binding fragment this connection provisions (`jx db push` patches wrangler.jsonc). */
  bindings: (connection: ConnectionDef) => JsonObject;
  testConnection: (connection: ConnectionDef, env: HostEnv) => Promise<TestConnectionResult>;
}

/**
 * Run the additive schema sync over a dialect, always destroying the Kysely instance.
 *
 * @param {Dialect} dialect
 * @param {SqlDialectKind} kind
 * @param {Record<string, TableDef>} tables
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<DeploySchemaResult>}
 */
export async function deployWithDialect(
  dialect: Dialect,
  kind: SqlDialectKind,
  tables: Record<string, TableDef>,
  options: { dryRun?: boolean } = {},
): Promise<DeploySchemaResult> {
  const db = new Kysely<DynamicDatabase>({ dialect });
  try {
    return await syncTables(db, tables, { dialect: kind, dryRun: options.dryRun ?? false });
  } finally {
    await db.destroy();
  }
}

/**
 * Probe a dialect with `select 1`.
 *
 * @param {Dialect} dialect
 * @returns {Promise<TestConnectionResult>}
 */
export async function testWithDialect(dialect: Dialect): Promise<TestConnectionResult> {
  const db = new Kysely<DynamicDatabase>({ dialect });
  try {
    await sql`select 1`.execute(db);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ok: false };
  } finally {
    await db.destroy();
  }
}

/** The tables of one connection (a data section filtered by connection name). */
export function tablesForConnection(
  tables: Record<string, TableDef>,
  connectionName: string,
): Record<string, TableDef> {
  return Object.fromEntries(
    Object.entries(tables).filter(([, def]) => def.connection === connectionName),
  );
}
