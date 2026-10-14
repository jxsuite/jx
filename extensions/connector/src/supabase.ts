/**
 * Supabase provider — postgres connections over postgres-js.
 *
 * The connection URL is never committed: `urlEnv` names the env var carrying it (.dev.vars locally,
 * a platform secret in production). From Workers, a Hyperdrive binding (named by `binding`,
 * provisioned from `hyperdriveId`) takes precedence — its `connectionString` fronts the database
 * with connection pooling. postgres-js and the kysely-postgres-js dialect load lazily so hosts that
 * never touch a postgres connection never import them.
 */

import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import { deployWithDialect, testWithDialect } from "./provider-utils.ts";
import type { Dialect } from "kysely";
import type { ConnectorProvider, HostEnv } from "./provider-utils.ts";
import type { ConnectionDef } from "./types.ts";

/**
 * Resolve the postgres URL for a connection: Hyperdrive binding first, then `urlEnv`.
 *
 * @param {ConnectionDef} connection
 * @param {HostEnv} env
 * @returns {string}
 */
export function resolvePostgresUrl(connection: ConnectionDef, env: HostEnv): string {
  const { binding, urlEnv, $name = "connection" } = connection;
  const bound = binding ? env[binding] : undefined;
  if (isNonNullObject(bound) && "connectionString" in bound && isString(bound.connectionString)) {
    return bound.connectionString;
  }
  const url = urlEnv ? env[urlEnv] : undefined;
  if (isString(url) && url !== "") {
    return url;
  }
  throw new Error(
    `Supabase connection "${$name}" is unreachable: no "${binding ?? "<binding>"}" Hyperdrive ` +
      `binding on env and ${urlEnv ? `env.${urlEnv} is unset` : `no "urlEnv" is configured`}`,
  );
}

/** Build the postgres-js dialect for a URL (lazy imports keep non-postgres hosts lean). */
async function postgresDialect(url: string): Promise<Dialect> {
  const { default: postgres } = await import("postgres");
  const { PostgresJSDialect } = await import("kysely-postgres-js");
  // Prepare: false — Supabase's transaction-mode pooler does not support prepared statements.
  return new PostgresJSDialect({ postgres: postgres(url, { prepare: false }) });
}

export const Supabase = {
  bindings: (connection: ConnectionDef) =>
    connection.hyperdriveId
      ? {
          hyperdrive: [
            {
              binding: connection.binding ?? "HYPERDRIVE",
              id: connection.hyperdriveId,
            },
          ],
        }
      : {},
  deploySchema: async (
    tables: Parameters<ConnectorProvider["deploySchema"]>[0],
    connection: ConnectionDef,
    options: { env: HostEnv; dryRun?: boolean },
  ) => {
    const dialect = await postgresDialect(resolvePostgresUrl(connection, options.env));
    return deployWithDialect(dialect, "postgres", tables, { dryRun: options.dryRun ?? false });
  },
  dialect: (connection: ConnectionDef, env: HostEnv) =>
    postgresDialect(resolvePostgresUrl(connection, env)),
  kind: "postgres",
  testConnection: async (connection: ConnectionDef, env: HostEnv) => {
    try {
      const dialect = await postgresDialect(resolvePostgresUrl(connection, env));
      return await testWithDialect(dialect);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), ok: false };
    }
  },
} satisfies ConnectorProvider;
