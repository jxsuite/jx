/**
 * Project-sections — generic section orchestration (specs/extensions.md §8, §9)
 *
 * Loads every extension-contributed project.json section through the owning class's `projectData`
 * capability and returns the results keyed by section key. Hosts thread the record through the
 * build (route expansion, prototype resolution) without knowing any section's shape.
 */

import { createNodeFormatIO } from "./format-host.ts";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type { ProjectSectionData } from "@jxsuite/schema/format-registry";
import type { ProjectConfig } from "@jxsuite/schema/types";

/* One section's `projectData` result. The host never reads inside it: it hands it to classes as
   `_project[key]` and back to the owner's own `resolvePaths` as `data`, so the capability contract
   in @jxsuite/schema names it and this module re-exports that name for the hosts built on it. */
export type { ProjectSectionData } from "@jxsuite/schema/format-registry";

/** Every loaded project section, keyed by its section key (`content`, `auth`, ...). */
export type ProjectSections = Record<string, ProjectSectionData>;

/**
 * Load all extension-contributed project sections.
 *
 * A section is loaded only when its key is present in the project config: `projectData` on an
 * absent section would only manufacture empty data (the parser's returns an empty Map), so skipping
 * keeps `_project` free of keys the author never declared — and is the cheaper rule.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @param {ProjectConfig | undefined} projectConfig - Already-loaded project config
 * @param {ExtensionRegistry} registry - The project's extension registry
 * @param {{ lazy?: boolean }} [options] - `lazy`: the host serves one page at a time, so an owner
 *   may load its section on demand (specs/extensions.md §8). A build leaves it off.
 * @returns {Promise<ProjectSections>} Section key → projectData result
 */
export async function loadProjectSections(
  projectRoot: string,
  projectConfig: ProjectConfig | undefined,
  registry: ExtensionRegistry,
  options: { lazy?: boolean } = {},
): Promise<ProjectSections> {
  const sections: ProjectSections = {};
  const io = createNodeFormatIO(projectRoot);
  for (const entry of registry.projectContributions()) {
    const key = entry.project?.key;
    if (!key || !entry.capabilities.projectData) {
      continue;
    }
    if (!projectConfig || !(key in projectConfig)) {
      continue;
    }
    sections[key] = await entry.call("projectData", projectConfig[key], {
      io,
      projectConfig,
      registry,
      root: projectRoot,
      ...(options.lazy === true && { lazy: true }),
    });
  }
  return sections;
}
