/**
 * Prototype-resolver.js — Generic $prototype resolution at build time
 *
 * Mirrors the runtime's import-map → .class.json → class → resolve() pipeline, but runs at compile
 * time using filesystem APIs.
 *
 * Any state entry with a $prototype that names an external class (through its `$src`, the
 * document's `imports`, or an enabled extension's manifest) gets resolved: the class is
 * constructed, its value is taken, and the state entry is replaced with it. An entry the build
 * cannot resolve fails the build (compiler.md §3).
 *
 * This is the extension point for content sources (Markdown, CSV, etc.) — each provides a
 * .class.json + JS implementation, and the compiler resolves them generically.
 *
 * @module prototype-resolver
 */

import { dirname } from "node:path";
import { isJsonObject, isPrototypeDef, isString } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type {
  JxDocument,
  JxMutableNode,
  JxPrototypeDef,
  JxStateDefinition,
  ProjectConfig,
} from "@jxsuite/schema/types";
import { externalClassConfig, isExternalClassDef } from "../shared.ts";
import { instantiateAndResolve, loadClass, locateClass } from "./external-class.ts";
import type { ClassRoute, ExternalClassConfig } from "./external-class.ts";
import type { ProjectSections } from "./project-sections.ts";

/**
 * Prototype names handled elsewhere (builtins + legacy content system). These are skipped by the
 * generic resolver.
 */
const SKIP_PROTOTYPES = new Set(["Function", "LocalStorage", "SessionStorage", "Array"]);

/** Project-level context the build threads into every resolved class. */
interface PrototypeProjectContext {
  config?: ProjectConfig;
  sections?: ProjectSections;
  registry?: ExtensionRegistry;
  registerBundle?: (specifier: string) => void;
  /**
   * Write each resolved value as the entry's initial value (`{ "default": value }`) instead of the
   * value itself. A component's state is what its compiled module starts from, so a value resolved
   * for one has to stay a state entry; a page's is baked into its markup and then stripped.
   */
  asInitialValues?: boolean;
}

/**
 * Resolve all generic $prototype entries in a document's state at build time.
 *
 * A client- or server-timed entry stays for its own pipeline, unless its registry class has a
 * `lower` capability, which compiles it away here into a core-shape def (specs/extensions.md §8.3).
 * Every other entry that names an external class (`timing: "compiler"`, or no `timing`) is located,
 * loaded, constructed and replaced with its value (`external-class.ts`).
 *
 * Nothing is swallowed: a `lower` that throws, a compiler-timed entry that names no class, and a
 * class that cannot be located, loaded or resolved are each collected, and one error naming every
 * such entry is thrown after the rest have been tried.
 *
 * @param {JxMutableNode | JxDocument} doc - The document (mutated in place)
 * @param {ClassRoute} route - Route info
 * @param {string} projectRoot - Absolute path to the project root
 * @param {PrototypeProjectContext} [projectContext] - Project-level context injected into all
 *   classes; `sections` holds the extension-loaded project sections keyed by section key (spread
 *   into `_project`); `registry` enables manifest class resolution and the generic `lower`
 *   capability
 * @returns {Promise<Record<string, JxStateDefinition>>} The entries it replaced, lowered or
 *   resolved, by state key
 */
export async function resolvePrototypes(
  doc: JxMutableNode | JxDocument,
  route: ClassRoute,
  projectRoot: string,
  projectContext: PrototypeProjectContext = {},
): Promise<Record<string, JxStateDefinition>> {
  const replaced: Record<string, JxStateDefinition> = {};
  const { state } = doc;
  if (!state) {
    return replaced;
  }
  const failures: string[] = [];
  const lookup = {
    docDir: route.sourcePath ? dirname(route.sourcePath) : null,
    imports: doc.imports,
    projectRoot,
    registry: projectContext.registry,
  };

  for (const [key, def] of Object.entries(state)) {
    if (!isPrototypeDef(def)) {
      continue;
    }
    if (SKIP_PROTOTYPES.has(def.$prototype)) {
      continue;
    }
    const label = `"${key}" ($prototype "${def.$prototype}")`;
    // Only resolve timing: "compiler" (or unset timing with a class mapping). Timing: "server"
    // And timing: "client" stay for their pipelines — but a registry class with a `lower`
    // Capability compiles away here into a core-shape def (specs/extensions.md §8.3): dynamic
    // Data becomes a plain reactive fetch with no extension code shipped to the browser.
    if (def.timing && def.timing !== "compiler") {
      const entry = projectContext.registry?.byName(def.$prototype);
      if (entry?.capabilities.lower) {
        try {
          const lowered = await entry.call("lower", def, {
            projectConfig: projectContext.config,
            root: projectRoot,
            route,
          });
          // A lowered def may name client modules it depends on via `$bundle`
          // (extensions.md §8.3): the site build bundles each specifier for the browser.
          // The key is host metadata, not part of the core def shape — strip it.
          if (isJsonObject(lowered)) {
            const bundles = lowered.$bundle;
            if (Array.isArray(bundles)) {
              for (const specifier of bundles) {
                if (isString(specifier)) {
                  projectContext.registerBundle?.(specifier);
                }
              }
            }
            delete lowered.$bundle;
          }
          state[key] = lowered;
          replaced[key] = lowered;
        } catch (error) {
          failures.push(`${label}: its class could not lower it: ${errorMessage(error)}`);
        }
      }
      continue;
    }

    try {
      const located = locateClass(def, lookup);
      if (located === undefined) {
        // A built-in at compiler timing, and an unset-timing name nothing maps, are not this
        // Resolver's: the first belongs to its own target, the second may only ever run interpreted.
        if (def.timing === "compiler" && isExternalClassDef(def)) {
          failures.push(
            `${label} names no class: give it a $src or an imports entry, or enable the ` +
              `extension that provides "${def.$prototype}"`,
          );
        }
        continue;
      }
      const Ctor = await loadClass(located);
      const { value } = await instantiateAndResolve(
        Ctor,
        buildConfig(def, route, projectRoot, state, projectContext),
      );
      if (projectContext.asInitialValues) {
        state[key] = { default: value ?? null };
      } else {
        // Preserve timing metadata on the resolved value so compilePage() can strip it
        if (def.timing && isJsonObject(value)) {
          value.timing = def.timing;
        }
        state[key] = value;
      }
      replaced[key] = state[key];
    } catch (error) {
      const hint = def.timing ? "" : ' (set "timing": "client" if it must run in the browser)';
      failures.push(`${label}: ${errorMessage(error)}${hint}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      failures.length === 1
        ? `state entry ${failures[0]}`
        : `${failures.length} state entries could not be resolved: ${failures.join("; ")}`,
    );
  }
  return replaced;
}

/**
 * The config a class is constructed with during the build: the entry's own keys minus the reserved
 * ones (spec.md §12.3), plus what only the build host knows.
 *
 * @param {JxPrototypeDef} def
 * @param {ClassRoute} route
 * @param {string} projectRoot
 * @param {Record<string, JxStateDefinition>} state - The document's whole state
 * @param {PrototypeProjectContext} projectContext
 * @returns {ExternalClassConfig}
 */
function buildConfig(
  def: JxPrototypeDef,
  route: ClassRoute,
  projectRoot: string,
  state: Record<string, JxStateDefinition>,
  projectContext: PrototypeProjectContext,
): ExternalClassConfig {
  const config: ExternalClassConfig = { ...externalClassConfig(def) };

  // Auto-set basePath from the document's directory if the config has `src` but no `basePath`
  if (config.src && !config.basePath && route.sourcePath) {
    config.basePath = dirname(route.sourcePath);
  }

  // Inject universal context — available to all classes. Extension-loaded sections land under
  // Their section keys (e.g. _project.content for the parser's content collections).
  config._project = {
    config: projectContext.config ?? null,
    root: projectRoot,
    ...projectContext.sections,
  };
  config._document = { route, state };
  return config;
}
