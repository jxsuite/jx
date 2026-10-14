/**
 * Connectors — the first-party provider map and the `resolveDialect` seam.
 *
 * `resolveDialect(connectionName, projectConfig, env)` is the contract dependents build on (the
 * auth extension resolves its Better Auth database through it): look the connection up in the
 * project's `connections` section, find its provider, and return the Kysely dialect plus the SQL
 * dialect family. Hosts with an extension registry should prefer registry dispatch — this map
 * covers the first-party providers only.
 */

import { D1 } from "./d1.ts";
import { Sqlite } from "./sqlite.ts";
import { Supabase } from "./supabase.ts";
import type { Dialect } from "kysely";
import type { SqlDialectKind } from "./columns.ts";
import type { ConnectorProvider, HostEnv } from "./provider-utils.ts";
import type { ConnectionDef } from "./types.ts";

export type {
  ConnectorProvider,
  HostEnv,
  HostEnvValue,
  HyperdriveBinding,
} from "./provider-utils.ts";
export { tablesForConnection } from "./provider-utils.ts";
export { D1 } from "./d1.ts";
export { Sqlite } from "./sqlite.ts";
export { Supabase } from "./supabase.ts";

/** First-party providers keyed by their `connector.provider` id. */
export const PROVIDERS = {
  d1: D1,
  sqlite: Sqlite,
  supabase: Supabase,
} satisfies Record<string, ConnectorProvider>;

/** True when `id` names one of the first-party providers (own keys only, never prototype members). */
function isFirstPartyProvider(id: string): id is keyof typeof PROVIDERS {
  return Object.hasOwn(PROVIDERS, id);
}

/** The `connections`-bearing slice of a project config. */
export interface ConnectionsConfig {
  connections?: Record<string, ConnectionDef>;
}

/**
 * Resolve a named connection to its Kysely dialect and SQL dialect family.
 *
 * @param {string} connectionName - Key of the project.json `connections` section
 * @param {ConnectionsConfig} projectConfig - The (partial) project config
 * @param {HostEnv} env - Host environment (bindings + env vars)
 * @returns {Promise<{ dialect: Dialect; type: SqlDialectKind }>}
 */
export async function resolveDialect(
  connectionName: string,
  projectConfig: ConnectionsConfig,
  env: HostEnv,
): Promise<{ dialect: Dialect; type: SqlDialectKind }> {
  const connections = projectConfig.connections ?? {};
  const connection = connections[connectionName];
  if (!connection) {
    throw new Error(`Unknown connection "${connectionName}" (no such connections entry)`);
  }
  const provider = isFirstPartyProvider(connection.provider)
    ? PROVIDERS[connection.provider]
    : undefined;
  if (!provider) {
    throw new Error(
      `Connection "${connectionName}" names unknown provider "${connection.provider}" ` +
        `(first-party providers: ${Object.keys(PROVIDERS).join(", ")})`,
    );
  }
  const dialect = await provider.dialect({ ...connection, $name: connectionName }, env);
  return { dialect, type: provider.kind };
}
