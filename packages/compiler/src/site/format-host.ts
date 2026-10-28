/**
 * Format-host — node-side FormatHostIO and project registry construction
 *
 * Provides the filesystem/module I/O the shared extension registry needs to run inside the compiler
 * (and dev server). Extensions are declared explicitly in project.json's `extensions` array and
 * discovered through their jx-extension.json manifests; see specs/extensions.md.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { buildExtensionRegistry, EXTENSION_MANIFEST } from "@jxsuite/schema/extension-registry";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type {
  FormatHostIO,
  ImplementationExport,
  ProjectBlock,
  StudioHints,
} from "@jxsuite/schema/format-registry";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue, ProjectConfig } from "@jxsuite/schema/types";

export type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
export type { FormatRegistry, FormatEntry } from "@jxsuite/schema/format-registry";

/**
 * Import a class $implementation module by absolute path, tolerating source-vs-built layouts. A
 * `.class.json` typically declares `"$implementation": "./markdown.js"` next to its TypeScript
 * source: under Bun the sibling `.ts` resolves directly, while under node the built module lives in
 * the package's `dist/` directory. Tries, in order: the literal path, src/ → dist/, that same file
 * with its `.ts` extension read as `.js` (a descriptor that names its TypeScript source, whose
 * built module is JavaScript), and .js → .ts.
 *
 * @param {string} path - Absolute path to the implementation module
 * @returns {Promise<ImplementationExport>} The module's namespace object, whose named exports (and
 *   `default`) are read by name
 */
export async function importImplementation(path: string): Promise<ImplementationExport> {
  const candidates = [path];
  const srcSeg = `${sep}src${sep}`;
  const distSeg = `${sep}dist${sep}`;
  if (path.includes(srcSeg)) {
    const built = path.replace(srcSeg, distSeg);
    candidates.push(built);
    if (built.endsWith(".ts")) {
      candidates.push(`${built.slice(0, -3)}.js`);
    }
  }
  if (path.endsWith(".js")) {
    candidates.push(`${path.slice(0, -3)}.ts`);
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await import(pathToFileURL(candidate).href);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Resolve a bare specifier from the PROJECT's own node_modules, and nowhere else.
 *
 * There is deliberately no host fallback (specs/extensions.md §3). Extensions, first-party ones
 * included, reach a project only through its own install, the way a third-party extension must: a
 * host that answered for `@jxsuite/parser` would let a project missing that dependency edit on one
 * machine and fail to build on the next.
 *
 * @param {string} projectRoot
 * @param {string} specifier - Bare specifier, e.g. "@jxsuite/parser/jx-extension.json"
 * @returns {string} Absolute resolved path
 */
export function resolveFromProject(projectRoot: string, specifier: string): string {
  return createRequire(resolve(projectRoot, "package.json")).resolve(specifier);
}

/** Create a node FormatHostIO rooted at a project (bare specifiers resolve from its node_modules). */
export function createNodeFormatIO(projectRoot: string): FormatHostIO {
  return {
    importModule: (path) => importImplementation(path),
    loadJson: async (path) => JSON.parse(readFileSync(path, "utf8")),
    resolvePath: (base, ref) => {
      if (ref.startsWith("./") || ref.startsWith("../")) {
        return resolve(dirname(base), ref);
      }
      if (isAbsolute(ref)) {
        return ref;
      }
      return resolveFromProject(projectRoot, ref);
    },
  };
}

/** Where an extension package's manifest resolves from the project, if it does. */
export interface ExtensionResolution {
  /** Resolvable from the PROJECT's own node_modules — the only place an extension resolves from. */
  project: boolean;
  /** The resolved manifest path, when `project` is true. */
  manifestPath?: string;
}

/**
 * Probe whether a project resolves an extension package, without loading it.
 *
 * Probes the MANIFEST rather than the package directory, because the manifest is what the registry
 * resolves (see `loadExtension`): a package present in node_modules whose `exports` map omits
 * `./jx-extension.json` is one whose enablement would throw, so it must not read as resolvable.
 *
 * @param {string} projectRoot - The project whose node_modules is probed
 * @param {string} name - Bare package specifier, e.g. "@jxsuite/parser"
 * @returns {ExtensionResolution}
 */
export function probeExtension(projectRoot: string, name: string): ExtensionResolution {
  try {
    return {
      manifestPath: resolveFromProject(projectRoot, `${name}/${EXTENSION_MANIFEST}`),
      project: true,
    };
  } catch {
    return { project: false };
  }
}

/** Build the extension registry for a project from its project.json `extensions` array. */
export async function buildProjectExtensionRegistry(
  projectRoot: string,
  projectConfig?: ProjectConfig,
): Promise<ExtensionRegistry> {
  return buildExtensionRegistry(
    projectConfig?.extensions,
    createNodeFormatIO(projectRoot),
    resolve(projectRoot, "project.json"),
  );
}

/** A registry of what a project has installed, and the enabled packages it has not. */
export interface InstalledExtensionRegistry {
  registry: ExtensionRegistry;
  /** Bare specifiers `project.json` enables whose manifest the project does not resolve. */
  missing: string[];
}

/**
 * Build the registry an EDITOR needs: every enabled extension the project resolves, skipping the
 * package ones it has not installed yet.
 *
 * A build must fail on a missing extension, and does, through {@link buildProjectExtensionRegistry}.
 * A studio must not: a project opened before its install has run resolves none of its package
 * extensions, and the format list, the extensions panel and the class picker should answer with
 * what is there rather than with an error. `missing` says what was skipped, so the host can say so
 * once instead of logging a resolution stack per request. Relative (local) extensions are never
 * skipped, because no install produces them.
 *
 * @param {string} projectRoot
 * @param {ProjectConfig} [projectConfig]
 * @returns {Promise<InstalledExtensionRegistry>}
 */
export async function buildInstalledExtensionRegistry(
  projectRoot: string,
  projectConfig?: ProjectConfig,
): Promise<InstalledExtensionRegistry> {
  const missing: string[] = [];
  const present: string[] = [];
  for (const specifier of projectConfig?.extensions ?? []) {
    const local = specifier.startsWith("./") || specifier.startsWith("../");
    if (local || probeExtension(projectRoot, specifier).project) {
      present.push(specifier);
    } else {
      missing.push(specifier);
    }
  }
  const registry = await buildExtensionRegistry(
    present,
    createNodeFormatIO(projectRoot),
    resolve(projectRoot, "project.json"),
  );
  return { missing, registry };
}

/**
 * Whether any of a previous build's `missing` packages resolves now — the cache check a host runs
 * so that a registry built before an install does not outlive it.
 *
 * @param {string} projectRoot
 * @param {string[]} missing
 * @returns {boolean}
 */
export function anyNowInstalled(projectRoot: string, missing: string[]): boolean {
  return missing.some((specifier) => probeExtension(projectRoot, specifier).project);
}

/**
 * The one line a host logs for the packages {@link buildInstalledExtensionRegistry} skipped.
 *
 * @param {string[]} missing
 * @returns {string}
 */
export function missingExtensionsNotice(missing: string[]): string {
  const names = missing.map((m) => `"${m}"`).join(", ");
  return (
    `project.json enables ${names}, which this project has not installed, so ` +
    `${missing.length === 1 ? "it is" : "they are"} not loaded. Install the project's dependencies.`
  );
}

// ─── Studio extensions payload ────────────────────────────────────────────────

/** One project-section contribution on the studio wire (specs/extensions.md §9/§9.1). */
export interface ExtensionsPayloadContribution {
  /** The $prototype-visible class name declaring the `project` block. */
  className: string;
  /** The class descriptor's `project` admission block. */
  project: ProjectBlock;
  /** The class descriptor's `$studio` block (settings section vocabulary), when declared. */
  studio: StudioHints | null;
  /**
   * The section's value schema — `properties[<key>]` of the extension's project fragment, which
   * JSON Schema lets be a boolean as well as an object — or null when the extension ships no
   * project fragment (or it lacks the key).
   */
  entrySchema: JsonValue;
}

/** One manifest class of an extension on the studio wire. */
export interface ExtensionsPayloadClass {
  name: string;
  /** The class's resolved descriptor path. */
  path: string;
  /** Present on a plain state class: one with no admission blocks. */
  state?: boolean;
  /** The descriptor's `$studio.stateDefaults` hint (specs/extensions.md §10), when it is an object. */
  stateDefaults?: JsonObject;
}

/** One extension package on the studio wire (the formats route's `extensions` sibling array). */
export interface ExtensionsPayloadEntry {
  specifier: string;
  name: string;
  title?: string;
  description?: string;
  contributions: ExtensionsPayloadContribution[];
  /**
   * Every manifest class of the extension with its resolved descriptor path, in declaration order
   * (additive; lets the studio address a class by `$src` without hardcoding its package layout).
   * Plain state classes (no admission blocks — `$prototype` targets like TableQuery or Session)
   * carry `state: true` plus their `$studio.stateDefaults` hint (specs/extensions.md §10), so the
   * studio can offer them in its add-state picker and seed new defs (e.g. `timing: "client"`).
   */
  classes: ExtensionsPayloadClass[];
}

/**
 * Build the studio-facing extensions payload from a project's extension registry: per extension,
 * its manifest identity plus every project-section contribution paired with the entry schema read
 * from the extension's shipped project fragment. Unreadable fragments degrade to a null entrySchema
 * (the studio renders the section without field metadata).
 *
 * @param {ExtensionRegistry} registry
 * @returns {ExtensionsPayloadEntry[]}
 */
export function buildExtensionsPayload(registry: ExtensionRegistry): ExtensionsPayloadEntry[] {
  const payload: ExtensionsPayloadEntry[] = [];
  for (const ext of registry.extensions) {
    let fragmentProperties: JsonObject = {};
    if (ext.schemas.project) {
      try {
        // SAFETY: JSON.parse only ever yields JSON values; its `any` return type says nothing more.
        const fragment = JSON.parse(readFileSync(ext.schemas.project, "utf8")) as JsonValue;
        const properties = isJsonObject(fragment) ? fragment.properties : undefined;
        fragmentProperties = isJsonObject(properties) ? properties : {};
      } catch {
        fragmentProperties = {};
      }
    }
    const contributions: ExtensionsPayloadContribution[] = [];
    for (const cls of ext.classes) {
      if (!cls.project) {
        continue;
      }
      contributions.push({
        className: cls.name,
        entrySchema: fragmentProperties[cls.project.key] ?? null,
        project: cls.project,
        studio: cls.studio,
      });
    }
    const entry: ExtensionsPayloadEntry = {
      classes: ext.classes.map((cls) => {
        const stateDefaults = cls.studio?.stateDefaults;
        const isState =
          cls.project === null &&
          cls.server === null &&
          cls.connector === null &&
          cls.extensions.length === 0;
        const payloadClass: ExtensionsPayloadClass = { name: cls.name, path: cls.classPath };
        if (isState) {
          payloadClass.state = true;
        }
        if (isJsonObject(stateDefaults)) {
          payloadClass.stateDefaults = stateDefaults;
        }
        return payloadClass;
      }),
      contributions,
      name: ext.manifest.name,
      specifier: ext.specifier,
    };
    if (ext.manifest.title !== undefined) {
      entry.title = ext.manifest.title;
    }
    if (ext.manifest.description !== undefined) {
      entry.description = ext.manifest.description;
    }
    payload.push(entry);
  }
  return payload;
}

/** Error message for an unregistered non-JSON extension, naming the fix. */
export function unknownFormatError(path: string, ext: string): Error {
  return new Error(
    `No format class registered for "${ext}" (${path}). ` +
      `Enable an extension providing this format in project.json "extensions", ` +
      `e.g. "@jxsuite/parser".`,
  );
}
