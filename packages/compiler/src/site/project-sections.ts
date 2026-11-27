/**
 * Project-sections — generic section orchestration (specs/extensions.md §8, §9)
 *
 * Loads every extension-contributed project.json section through the owning class's `projectData`
 * capability and returns the results keyed by section key. Hosts thread the record through the
 * build (route expansion, prototype resolution) without knowing any section's shape.
 *
 * @docs extending/extensions/project-sections
 */

import { createNodeFormatIO } from "./format-host.ts";
import { isNonNullObject } from "@jxsuite/schema/guards";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type { FormatEntry, ProjectSectionData } from "@jxsuite/schema/format-registry";
import type { ProjectConfig } from "@jxsuite/schema/types";

/* One section's `projectData` result. The host never reads inside it: it hands it to classes as
   `_project[key]` and back to the owner's own `resolvePaths` as `data`, so the capability contract
   in @jxsuite/schema names it and this module re-exports that name for the hosts built on it. */
export type { ProjectSectionData } from "@jxsuite/schema/format-registry";

/** Every loaded project section, keyed by its section key (`content`, `auth`, ...). */
export type ProjectSections = Record<string, ProjectSectionData>;

/**
 * Whether a section owner contributes to the build or the dev server (specs/extensions.md §8.4).
 *
 * A class that owns no project section is always active. A section owner is inactive when its value
 * is absent, `null`, or an object or array with no own keys, and active for any other value. One
 * test decides `emit`, `assets`, `head`, server-mount activation and section-owner push steps in
 * every host. Section loading is deliberately not gated by it.
 *
 * @param {Pick<FormatEntry, "project">} entry - The class entry
 * @param {ProjectConfig | undefined} projectConfig - The project config
 * @returns {boolean} Whether the entry's contributions apply
 */
export function sectionOwnerActive(
  entry: Pick<FormatEntry, "project">,
  projectConfig: ProjectConfig | undefined,
): boolean {
  if (entry.project == null) {
    return true;
  }
  const value: unknown = projectConfig?.[entry.project.key];
  if (value === undefined || value === null) {
    return false;
  }
  return isNonNullObject(value) ? Object.keys(value).length > 0 : true;
}

/**
 * Load all extension-contributed project sections.
 *
 * A section is loaded only when its key is present in the project config: `projectData` on an
 * absent section would only manufacture empty data (the parser's returns an empty Map), so skipping
 * keeps `_project` free of keys the author never declared — and is the cheaper rule. Loading is not
 * gated by {@link sectionOwnerActive} (specs/extensions.md §8.4): it contributes no file, route or
 * head entry, and the owner's `resolvePaths` reads the loaded value unguarded, so an empty section
 * must still load.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @param {ProjectConfig | undefined} projectConfig - Already-loaded project config
 * @param {ExtensionRegistry} registry - The project's extension registry
 * @param {{ lazy?: boolean; includeHeld?: boolean }} [options] - `lazy`: the host serves one page
 *   at a time, so an owner may load its section on demand (specs/extensions.md §8). A build leaves
 *   it off. `includeHeld`: the host shows authors their work, so entries a project's `hold` rules
 *   match are kept, labelled (site-architecture.md §7.6). Left off, they are left out.
 * @returns {Promise<ProjectSections>} Section key → projectData result
 */
export async function loadProjectSections(
  projectRoot: string,
  projectConfig: ProjectConfig | undefined,
  registry: ExtensionRegistry,
  options: { lazy?: boolean; includeHeld?: boolean } = {},
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
      ...(options.includeHeld === true && { includeHeld: true }),
    });
  }
  return sections;
}
