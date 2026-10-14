/**
 * Db-push — `jx db push [root] [--dry-run] [--connection <name>]` (plan Part 4a).
 *
 * Registry-driven: every `connections` entry resolves to its connector class (by
 * `connector.provider`) and the additive schema sync runs through the class's `deploySchema`
 * capability with the connection's tables from the `data` section. The environment is process.env
 * merged under `<root>/.dev.vars` (wrangler convention, specs/extensions.md §13). After a non-dry
 * apply, each connector's `bindings` fragment is deep-merged into wrangler.jsonc via
 * `applyBindingFragments` (user keys preserved).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyBindingFragments } from "@jxsuite/create/scaffold";
import { buildProjectExtensionRegistry } from "./format-host.ts";
import { loadProjectConfig } from "./site-loader.ts";
import type { DataPushRequest, FormatEntry } from "@jxsuite/schema/format-registry";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { JsonObject } from "@jxsuite/schema/types";

/* `jx db push` takes the same request as the Studio data-push route, so the shape is declared once
   in @jxsuite/schema; `DbPushOptions` stays this module's public name for it. */
export type { DataPushRequest as DbPushOptions } from "@jxsuite/schema/format-registry";

export interface ConnectionPushResult {
  connection: string;
  provider: string;
  tables: string[];
  statements: string[];
  warnings: string[];
  applied: boolean;
}

export interface DbPushResult {
  results: ConnectionPushResult[];
  /** True when wrangler.jsonc was rewritten with binding fragments. */
  bindingsPatched: boolean;
  wranglerPath: string | null;
}

/**
 * How a push reads a connector's `deploySchema` answer (`DeploySchemaResult`): every member
 * optional, and defaulted where it is read.
 */
interface DeployResultLike {
  statements?: string[];
  warnings?: string[];
  applied?: boolean;
}

/**
 * Push the project's table schemas to their connections' databases.
 *
 * @param {string} projectRoot - Absolute path to the project directory
 * @param {DataPushRequest} [options]
 * @returns {Promise<DbPushResult>}
 */
export async function dbPush(
  projectRoot: string,
  options: DataPushRequest = {},
): Promise<DbPushResult> {
  const { dryRun = false, connection: only } = options;
  const { config } = loadProjectConfig(projectRoot);
  const registry = await buildProjectExtensionRegistry(projectRoot, config);

  const connections = isJsonObject(config.connections) ? config.connections : {};
  const tables = isJsonObject(config.data) ? config.data : {};

  const names = Object.keys(connections).filter((name) => !only || name === only);
  if (only && names.length === 0) {
    throw new Error(`Unknown connection "${only}" (no such connections entry in project.json)`);
  }
  if (names.length === 0) {
    throw new Error(
      `project.json has no "connections" section — nothing to push. Declare a connection and ` +
        `its tables in the "data" section first.`,
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...readDevVars(projectRoot),
    JX_PROJECT_ROOT: projectRoot,
  };

  const results: ConnectionPushResult[] = [];
  const fragments: JsonObject[] = [];
  for (const name of names) {
    const declared = connections[name];
    // An entry that is not an object declares no provider, so it fails the lookup just below.
    const connection: JsonObject = isJsonObject(declared)
      ? { ...declared, $name: name }
      : { $name: name };
    const provider = String(connection.provider ?? "");
    const entry = connectorByProvider(registry.connectors(), provider);
    if (!entry) {
      throw new Error(
        `Connection "${name}" names provider "${provider}", but no enabled extension provides ` +
          `it (enable the extension in project.json "extensions")`,
      );
    }
    const connectionTables: Record<string, JsonObject> = {};
    for (const [tableName, def] of Object.entries(tables)) {
      if (isJsonObject(def) && def.connection === name) {
        connectionTables[tableName] = def;
      }
    }

    /* A connector's `deploySchema` answers `{ statements, applied, warnings }` (extensions.md §8);
       this push reads each member as optional and defaults it where it is read. */
    const deployed: DeployResultLike = await entry.call(
      "deploySchema",
      connectionTables,
      connection,
      { dryRun, env },
    );
    results.push({
      applied: deployed.applied ?? !dryRun,
      connection: name,
      provider,
      statements: deployed.statements ?? [],
      tables: Object.keys(connectionTables),
      warnings: deployed.warnings ?? [],
    });

    if (entry.capabilities.bindings) {
      // A connector's `bindings` answers with a wrangler config fragment (extensions.md §8).
      const fragment = await entry.call("bindings", connection);
      if (isJsonObject(fragment) && Object.keys(fragment).length > 0) {
        fragments.push(fragment);
      }
    }
  }

  // Apply binding fragments to wrangler.jsonc (skipped on dry runs and non-wrangler projects).
  const wranglerPath = resolve(projectRoot, "wrangler.jsonc");
  let bindingsPatched = false;
  if (!dryRun && fragments.length > 0 && existsSync(wranglerPath)) {
    const existing = readFileSync(wranglerPath, "utf8");
    const { content, patched } = applyBindingFragments(existing, fragments);
    if (patched && content !== existing) {
      writeFileSync(wranglerPath, content, "utf8");
      bindingsPatched = true;
    }
  }

  return { bindingsPatched, results, wranglerPath: existsSync(wranglerPath) ? wranglerPath : null };
}

/** Find the connector class serving a provider id. */
function connectorByProvider(entries: FormatEntry[], provider: string): FormatEntry | undefined {
  return entries.find((entry) => entry.connector?.provider === provider);
}

/**
 * Parse `<root>/.dev.vars` (wrangler convention): KEY=VALUE lines, `#` comments, optional
 * single/double quotes. Kept deliberately tiny; the dev server has its own copy in
 * `@jxsuite/server` (dev-vars.ts) — the compiler cannot depend on the server package.
 *
 * @param {string} projectRoot
 * @returns {Record<string, string>}
 */
export function readDevVars(projectRoot: string): Record<string, string> {
  const path = resolve(projectRoot, ".dev.vars");
  if (!existsSync(path)) {
    return {};
  }
  // A later line for the same key replaces an earlier one.
  const vars = new Map<string, string>();
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== "") {
      vars.set(key, value);
    }
  }
  return Object.fromEntries(vars);
}
