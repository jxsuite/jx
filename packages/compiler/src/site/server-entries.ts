/**
 * Server-entries.ts — where the site worker's `timing: "server"` entries come from.
 *
 * Every document that can declare a server entry is read as written: the page, each layout in its
 * chain, `project.json`'s `state` (which every page inherits) and every compiled component
 * (compiler.md §6.3, site-architecture.md §14.1.1). The merged page cannot stand in for them,
 * because layout resolution merges state and splices children, and after that nothing records which
 * file a relative `$src` was written against.
 *
 * A relative `$src` (`./`, `../`) resolves against the directory of the document that declares it,
 * and the worker receives it as a `./` path from the project root, because the worker bundle
 * resolves every import from there (compiler.md §12). Any other specifier, a package export most
 * often, is kept as written and resolves from the root unchanged.
 *
 * Each entry is served at `/_jx/server/<export>`, so an export name is one function across the
 * whole site. One module that several documents declare is one route; two different modules
 * exporting one name cannot both be served, and a page calling the one left out would silently
 * receive the other's answer, so that is an error rather than a choice made for the author.
 *
 * @docs framework/site/deployment
 */

import { dirname, relative, resolve, sep } from "node:path";
import { collectServerEntries } from "../shared.ts";
import type { JxElement } from "@jxsuite/schema/types";

/** One `timing: "server"` entry as one document declares it, before deduplication. */
export interface ServerEntryRecord {
  /** The `$export`: the name the worker imports and the route it registers it under. */
  exportName: string;
  /** The specifier the worker imports, resolvable from the project root. */
  src: string;
  /** The declaring document, project-relative with `/` separators (`layouts/base.json`). */
  declaredIn: string;
}

/** What {@link dedupeServerEntries} hands the site worker: its routes, and a message for each clash. */
export interface DedupedServerEntries {
  /** One entry per export name, the `{ exportName, src }` pairs `compileSiteServer` imports. */
  entries: { exportName: string; src: string }[];
  /** One message per export name that two or more different modules claim. */
  errors: string[];
}

/** `path` relative to the project root, with `/` separators whatever the platform's own. */
function projectRelative(path: string, projectRoot: string): string {
  return relative(projectRoot, path).split(sep).join("/");
}

/**
 * The specifier the worker imports for a `$src` written in a document under `docDir`.
 *
 * A `./` or `../` path is resolved against `docDir` and returned as a `./` path from the project
 * root, in POSIX form so the generated import is valid on every platform. Anything else is returned
 * as written.
 */
export function resolveServerSrc(src: string, docDir: string, projectRoot: string): string {
  if (!src.startsWith("./") && !src.startsWith("../")) {
    return src;
  }
  return `./${projectRelative(resolve(docDir, src), projectRoot)}`;
}

/**
 * Every server entry one document declares, in document order, each `src` resolved against the
 * document's own directory and each record naming the document.
 */
export function documentServerEntries(
  doc: JxElement,
  docPath: string,
  projectRoot: string,
): ServerEntryRecord[] {
  const docDir = dirname(docPath);
  const declaredIn = projectRelative(docPath, projectRoot);
  return collectServerEntries(doc).map((entry) => ({
    exportName: entry.exportName,
    src: resolveServerSrc(entry.src, docDir, projectRoot),
    declaredIn,
  }));
}

/**
 * One entry per export name, the list the site worker serves, plus one error per export name that
 * two or more different modules claim.
 *
 * Export names keep the order they were first seen in. A name declared by several documents for the
 * same module is one entry and no message. A name two modules claim keeps the first module, so the
 * worker can still be written, and its error names every module with the first document that
 * declared it.
 */
export function dedupeServerEntries(records: readonly ServerEntryRecord[]): DedupedServerEntries {
  // Export name → each distinct module claiming it → the first document declaring that module.
  const claims = new Map<string, Map<string, string>>();
  for (const { exportName, src, declaredIn } of records) {
    const modules = claims.get(exportName) ?? new Map<string, string>();
    claims.set(exportName, modules);
    if (!modules.has(src)) {
      modules.set(src, declaredIn);
    }
  }

  const entries: { exportName: string; src: string }[] = [];
  const errors: string[] = [];
  for (const [exportName, modules] of claims) {
    const claimed = [...modules];
    entries.push({ exportName, src: claimed[0]![0] });
    if (claimed.length > 1) {
      const named = claimed.map(([src, declaredIn]) => `${src} (declared in ${declaredIn})`);
      errors.push(
        `Server function "${exportName}" is exported by ${claimed.length} different modules: ` +
          `${named.join(", ")}. The site worker serves one function per export name, at ` +
          `/_jx/server/${exportName}, so a call meant for any but the first would get the first's ` +
          `answer. Rename the export in all but one module, and the $export that names it.`,
      );
    }
  }
  return { entries, errors };
}
