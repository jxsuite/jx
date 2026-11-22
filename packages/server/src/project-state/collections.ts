/**
 * The collection loader's lists for the project state host's dependency graph
 * (`specs/project-state.md` §8.1): each content type's entry files as the project's own `content`
 * section owner resolves them, so `where` and `hold` count as well as `exclude`. Shared by every
 * host that runs `createProjectStateHost` (the desktop session and the dev server, §10.1, §10.2).
 *
 * @docs studio/desktop
 */

import { extname } from "node:path";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type { ProjectSectionData } from "@jxsuite/schema/format-registry";
import type { ContentLoaderEntry, ProjectConfig } from "@jxsuite/schema/types";
import { sourceCollections } from "./host-deps.ts";
import type { CollectionResolver } from "./host-deps.ts";

/** What the collection loader is asked for: every project section an extension loads. */
export type SectionLoader = (
  root: string,
  config: ProjectConfig | undefined,
  registry: ExtensionRegistry,
  options: { includeHeld: boolean },
) => Promise<Record<string, ProjectSectionData>>;

/**
 * Whether `file` is the one `entry` came from: its source-relative path and its locale. An entry of
 * a single-file source names no path, and comes from that file.
 */
function cameFrom(entry: ContentLoaderEntry, file: string, singleFile: boolean): boolean {
  const path = entry._meta?.path;
  if (path === undefined) {
    return singleFile;
  }
  if (file !== path && !file.endsWith(`/${path}`)) {
    return false;
  }
  const locale = entry._meta?.locale?.toLowerCase();
  return (
    locale === undefined ||
    file
      .slice(0, file.length - path.length)
      .split("/")
      .some((segment) => segment.toLowerCase() === locale)
  );
}

/**
 * The compiler's section loader, imported when a collection is first resolved: the build pipeline
 * is not loaded for a window that never subscribes.
 */
const compilerSections: SectionLoader = async (root, config, registry, options) => {
  const { loadProjectSections } = await import("@jxsuite/compiler/project-sections");
  return loadProjectSections(root, config, registry, options);
};

/**
 * Each content type's entry files as the collection loader resolves them (§8.1): the files the
 * type's `source` covers (`sourceCollections`), less the ones the loader left out, so `where` and
 * `hold` count as well as `exclude`. The loader is the project's own `content` section owner,
 * reached through its extension registry; a project that installs none, a type the loader did not
 * answer, or a load that failed falls back to the source's files.
 *
 * @param registryFor The project's extension registry, as the session builds it.
 * @param loadSections The section loader; the compiler's by default.
 */
export function collectionLoaderResolver(
  registryFor: () => Promise<ExtensionRegistry>,
  loadSections: SectionLoader = compilerSections,
): CollectionResolver {
  return async (input) => {
    const candidates = await sourceCollections(input);
    if (Object.keys(candidates).length === 0) {
      return candidates;
    }
    let section: ProjectSectionData | undefined;
    try {
      const sections = await loadSections(input.root, input.config, await registryFor(), {
        includeHeld: true,
      });
      section = sections.content;
    } catch {
      return candidates;
    }
    if (!(section instanceof Map)) {
      return candidates;
    }
    const resolved: Record<string, readonly string[]> = {};
    const sources = new Map<string, string>();
    const content = input.config?.content;
    if (isJsonObject(content)) {
      for (const [type, def] of Object.entries(content)) {
        if (isJsonObject(def) && isString(def.source)) {
          sources.set(type, def.source);
        }
      }
    }
    for (const [type, files] of Object.entries(candidates)) {
      const entries = section.get(type);
      const singleFile = extname(sources.get(type) ?? "") !== "";
      resolved[type] =
        entries === undefined
          ? files
          : files.filter((file) => entries.some((entry) => cameFrom(entry, file, singleFile)));
    }
    return resolved;
  };
}
