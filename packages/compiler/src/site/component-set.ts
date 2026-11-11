/**
 * Which components a site build compiles.
 *
 * Two rules meet here. Every file directly in `components/` is compiled whether or not anything
 * names it, because a page may use `components/<tag>.json` undeclared (imports.md §1.4) and the
 * build only learns which of those a page wrote by scanning its HTML for the tags it compiled. A
 * component anywhere else (a subdirectory of `components/`, a `_`-prefixed file beside the page
 * that uses it) reaches the build by being declared: a `{ "$ref" }` in the `$elements` of a page,
 * of a layout wrapping it, of `project.json`, or of a component already in the set
 * (site-architecture.md §10.3).
 *
 * The walk runs before any page is composed, over the documents as written, because a `$ref` is
 * relative to the file that declares it and the merged page no longer says which file that was.
 *
 * @docs framework/build
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import { projectFilePath } from "@jxsuite/schema/project-file/node";
import type { FormatRegistry } from "@jxsuite/schema/format-registry";
import type { JxDocument, ProjectConfig } from "@jxsuite/schema/types";
import { layoutChain } from "./layout-resolver.ts";
import { readPageDocument } from "./pages-discovery.ts";

/** One component a build compiles: where it was read from, the tag it defines, and its document. */
export interface SiteComponent {
  /** Absolute path of the component's source file. */
  path: string;
  tagName: string;
  doc: JxDocument;
}

/** What {@link collectSiteComponents} reads. A dependent that adds a declaring root adds it here. */
export interface SiteComponentInput {
  projectRoot: string;
  projectConfig: ProjectConfig;
  /** Absolute path of every route's source file. Repeats are read once. */
  pageSources: readonly string[];
  formatRegistry: FormatRegistry;
}

/** Who named a component: the declaring file (project-relative) and the entry as it wrote it. */
interface Declaration {
  declarer: string;
  ref: string;
}

/** The `{ "$ref" }` entries of a document's `$elements`. A bare string is an npm specifier. */
function refEntries(doc: { $elements?: unknown }): string[] {
  const { $elements: entries } = doc;
  if (!Array.isArray(entries)) {
    return [];
  }
  const refs: string[] = [];
  for (const entry of entries) {
    if (isJsonObject(entry) && isString(entry.$ref) && entry.$ref !== "") {
      refs.push(entry.$ref);
    }
  }
  return refs;
}

/**
 * The components a build of this project compiles, in compile order: the files directly in
 * `components/` (sorted by name), then every declared component not already among them, each
 * followed through its own `$elements`. Deduplicated by absolute path and unique by tag.
 *
 * A declared entry the build cannot compile is an error naming the declaring file, the entry and
 * the path it resolved to; so are two files that declare one `tagName`, where the first keeps the
 * tag. Nothing here throws: a page or layout that cannot be read is skipped, because compiling its
 * route reports it with the route.
 */
export async function collectSiteComponents(
  input: SiteComponentInput,
): Promise<{ components: SiteComponent[]; errors: string[] }> {
  const { formatRegistry, pageSources, projectConfig, projectRoot } = input;
  const components: SiteComponent[] = [];
  const errors: string[] = [];
  const visited = new Set<string>();
  const pathByTag = new Map<string, string>();
  const rel = (path: string) => relative(projectRoot, path).replaceAll("\\", "/");

  const visit = async (path: string, from: Declaration | null): Promise<void> => {
    if (visited.has(path)) {
      return;
    }
    const where = rel(path);
    const named = from ? `${from.declarer}: $elements entry "${from.ref}" names` : "";
    if (from) {
      if (where.startsWith("..") || isAbsolute(where)) {
        visited.add(path);
        errors.push(`${named} ${where}, outside the project`);
        return;
      }
      if (!existsSync(path)) {
        visited.add(path);
        errors.push(`${named} no file (${where})`);
        return;
      }
    }
    visited.add(path);
    let doc: JxDocument;
    try {
      doc = await readPageDocument(path, formatRegistry);
    } catch (error) {
      errors.push(`Error compiling component ${where}: ${errorMessage(error)}`);
      return;
    }
    const tagName = isString(doc.tagName) ? doc.tagName : "";
    if (!tagName.includes("-")) {
      errors.push(
        from
          ? `${named} ${where}, which is not a component (no hyphenated tagName)`
          : `Error compiling component ${where}: tagName "${tagName}" must contain a hyphen`,
      );
      return;
    }
    const holder = pathByTag.get(tagName);
    if (holder !== undefined) {
      errors.push(`${rel(holder)} and ${where} both declare tagName "${tagName}"; rename one`);
      return;
    }
    pathByTag.set(tagName, path);
    components.push({ doc, path, tagName });
    await visitDeclared(doc, path);
  };

  /** Visit what one declaring document names, each `$ref` against that document's directory. */
  const visitDeclared = async (
    doc: { $elements?: unknown },
    declarerPath: string,
    baseDir = dirname(declarerPath),
  ): Promise<void> => {
    for (const ref of refEntries(doc)) {
      // oxlint-disable-next-line no-await-in-loop -- Compile order is declaration order.
      await visit(resolve(baseDir, ref), { declarer: rel(declarerPath), ref });
    }
  };

  const componentsDir = resolve(projectRoot, "components");
  if (existsSync(componentsDir)) {
    const extensions = [".json", ...formatRegistry.documentExtensions("component")];
    /* Sorted, because this order is the order of the sheets in every page's `<head>`, and readdir
       has none of its own: on ext4 it follows a hash of the name, so the same project built to
       different bytes on different machines. */
    const seeds = readdirSync(componentsDir)
      .filter((file) => extensions.some((ext) => file.endsWith(ext)))
      .toSorted();
    for (const file of seeds) {
      // oxlint-disable-next-line no-await-in-loop -- Compile order is listing order.
      await visit(resolve(componentsDir, file), null);
    }
  }

  await visitDeclared(projectConfig, projectFilePath(projectRoot), projectRoot);

  for (const pagePath of new Set(pageSources)) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Compile order is route order.
      const pageDoc = await readPageDocument(pagePath, formatRegistry);
      const levels = layoutChain(pageDoc, projectConfig, projectRoot);
      // oxlint-disable-next-line no-await-in-loop
      await visitDeclared(pageDoc, pagePath);
      for (const level of levels) {
        // oxlint-disable-next-line no-await-in-loop
        await visitDeclared(level.doc, level.path);
      }
    } catch {
      // A page or layout that cannot be read is reported by its route's compile, with the route.
    }
  }

  return { components, errors };
}
