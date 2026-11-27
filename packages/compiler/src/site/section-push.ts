/**
 * Section-push: the one loop that composes section owners' `deploySchema` steps for a schema push
 * (specs/extensions.md §11.1, §12). Both hosts call it: `jx db push` (`db-push.ts`) with each
 * provider's own class, and the dev server's studio push (`@jxsuite/server`) with the `local:`
 * stand-ins its mounts receive. The host stays extension-agnostic: registry dispatch only, no
 * extension import and no section-name literal.
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { isString } from "@jxsuite/schema/guards";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type {
  ImplementationExport,
  SectionDeployOptions,
  SectionPushStep,
} from "@jxsuite/schema/format-registry";
import type { ProjectConfig } from "@jxsuite/schema/types";

export type { SectionPushStep } from "@jxsuite/schema/format-registry";

/** What one section owner contributed to a push. */
export interface SectionPushResult {
  /** The section key the owner contributes under. */
  section: string;
  steps: SectionPushStep[];
  warnings: string[];
  /** True when the steps were executed (never on a dry run or after an error). */
  applied: boolean;
  /** The owner's thrown message, when its `deploySchema` (or a connector import) failed. */
  error?: string;
}

/** The connector implementation classes a push hands section owners, keyed by provider id. */
type ConnectorClasses = Record<string, ImplementationExport | null | undefined>;

/**
 * Resolve connector implementation classes keyed by provider id. With `standins`, a connector
 * declaring `local: "<provider>"` is served by the registry's class for that provider instead of
 * its own (specs/extensions.md §12); without, each provider is its own class, as the generated
 * worker builds the map.
 *
 * Each provider is its implementation module's export (specs/extensions.md §6.1): this host only
 * routes it. A module exporting no such export yields a nullish entry, which the receiving mount or
 * section owner reports as an unavailable provider.
 *
 * @param {ExtensionRegistry} registry
 * @param {{ standins: boolean }} options
 * @returns {Promise<ConnectorClasses>}
 */
export async function resolveConnectorClasses(
  registry: ExtensionRegistry,
  options: { standins: boolean },
): Promise<ConnectorClasses> {
  const entries = registry.connectors();
  const out: ConnectorClasses = {};
  for (const entry of entries) {
    const provider = String(entry.connector!.provider);
    const { local } = entry.connector!;
    const target =
      options.standins && isString(local)
        ? (entries.find((e) => e.connector!.provider === local) ?? entry)
        : entry;
    out[provider] = await target.implementationExport();
  }
  return out;
}

/**
 * Run every section owner's `deploySchema` (any non-connector project contribution declaring the
 * capability), in contribution order. A section absent or null in the project contributes nothing;
 * a step with no kind takes the section key; an owner that throws is reported on its result.
 *
 * @param {ExtensionRegistry} registry
 * @param {ProjectConfig} config
 * @param {object} options - `standins` picks the connector classes handed to the owners
 * @returns {Promise<SectionPushResult[]>}
 */
export async function pushSectionOwners(
  registry: ExtensionRegistry,
  config: ProjectConfig,
  options: {
    env: SectionDeployOptions["env"];
    dryRun: boolean;
    connection?: string | undefined;
    standins: boolean;
  },
): Promise<SectionPushResult[]> {
  const { dryRun, env, standins } = options;
  const owners = registry
    .projectContributions()
    .filter((entry) => entry.connector === null && entry.capabilities.deploySchema);

  // Resolved lazily and once, so a project without a section owner imports no connector code.
  let connectorsPromise: Promise<ConnectorClasses> | undefined;
  const results: SectionPushResult[] = [];
  for (const entry of owners) {
    const { key } = entry.project!;
    const section = config[key];
    if (section === undefined || section === null) {
      continue;
    }
    try {
      connectorsPromise ??= resolveConnectorClasses(registry, { standins });
      const connectors = await connectorsPromise;
      const deployOptions: SectionDeployOptions = { connectors, dryRun, env };
      if (options.connection !== undefined) {
        deployOptions.connection = options.connection;
      }
      const result = await entry.call("deploySchema", section, config, deployOptions);
      const steps = result.steps.map((step) => {
        step.kind ||= key;
        return step;
      });
      results.push({
        applied: !dryRun,
        section: key,
        steps,
        warnings: result.warnings,
      });
    } catch (error) {
      results.push({
        applied: false,
        error: errorMessage(error),
        section: key,
        steps: [],
        warnings: [],
      });
    }
  }
  return results;
}
