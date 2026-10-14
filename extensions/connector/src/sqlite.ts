/**
 * Sqlite provider — file-backed SQLite over bun:sqlite.
 *
 * The dev-server default and the `local: "sqlite"` stand-in target: connections resolve to
 * `<root>/.jx/data/<name>.sqlite` (or the connection's `file` path) under the project root the host
 * publishes as `env.JX_PROJECT_ROOT`. Node/Bun hosts only — deployed Cloudflare sites use D1 or
 * Supabase.
 */

import { isString } from "@jxsuite/schema/guards";
import { createBunSqliteDialect } from "./dialects/bun-sqlite.ts";
import { deployWithDialect, testWithDialect } from "./provider-utils.ts";
import type { Dialect } from "kysely";
import type { ConnectorProvider, HostEnv } from "./provider-utils.ts";
import type { ConnectionDef } from "./types.ts";

/** Resolve the SQLite file path for a connection. */
export function sqliteFilePath(connection: ConnectionDef, env: HostEnv): string {
  const projectRoot = env["JX_PROJECT_ROOT"];
  const root = isString(projectRoot) ? projectRoot : ".";
  const name = connection.$name ?? "default";
  const file = connection.file ?? `./.jx/data/${name}.sqlite`;
  if (file === ":memory:" || file.startsWith("/")) {
    return file;
  }
  return `${root.replace(/\/$/, "")}/${file.replace(/^\.\//, "")}`;
}

/** Build the bun:sqlite dialect for a connection. */
function sqliteDialect(connection: ConnectionDef, env: HostEnv): Dialect {
  return createBunSqliteDialect({ url: sqliteFilePath(connection, env) });
}

export const Sqlite = {
  bindings: () => ({}),
  deploySchema: async (
    tables: Parameters<ConnectorProvider["deploySchema"]>[0],
    connection: ConnectionDef,
    options: { env: HostEnv; dryRun?: boolean },
  ) => {
    const dialect = sqliteDialect(connection, options.env);
    return deployWithDialect(dialect, "sqlite", tables, { dryRun: options.dryRun ?? false });
  },
  dialect: sqliteDialect,
  kind: "sqlite",
  testConnection: async (connection: ConnectionDef, env: HostEnv) => {
    try {
      return await testWithDialect(sqliteDialect(connection, env));
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), ok: false };
    }
  },
} satisfies ConnectorProvider;
