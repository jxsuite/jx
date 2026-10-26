/**
 * The build's filesystem half of layout resolution.
 *
 * The rule — which layout a page uses, how its children land in the layout's slots, which
 * properties the page extends onto it — is `@jxsuite/site/layout`, because the studio's canvas and
 * the cloud's live preview have to reach the same answer and neither can import this package. What
 * is left here is the part that genuinely needs a disk: turning `./layouts/base.json` into bytes,
 * and saying which file was wrong when it is.
 */

import { existsSync, readFileSync } from "node:fs";
import { errorMessage, parseJxDocument } from "@jxsuite/schema/parse";
import { resolve } from "node:path";
import { resolveLayout as resolveLayoutWith } from "@jxsuite/site/layout";
import type { JxDocument, ProjectConfig } from "@jxsuite/schema/types";

/**
 * A layout loader (`LayoutLoader` in `@jxsuite/site/layout`) over the project's own directory. It
 * reads synchronously, which is what lets {@link layoutChain} walk a chain without awaiting each
 * level, and a synchronous loader is still one `resolveLayout` accepts.
 */
export function nodeLayoutLoader(projectRoot: string): (layoutRef: string) => JxDocument {
  return (layoutRef: string) => {
    const layoutPath = resolve(projectRoot, layoutRef);
    if (!existsSync(layoutPath)) {
      throw new Error(`Layout not found: ${layoutRef} (resolved to ${layoutPath})`);
    }
    try {
      return parseJxDocument(readFileSync(layoutPath, "utf8"), layoutPath);
    } catch (error) {
      throw new Error(`Invalid layout JSON at ${layoutPath}: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  };
}

/**
 * Resolve a page's layout against a project on disk.
 *
 * @param {JxDocument} pageDoc - The raw page document
 * @param {ProjectConfig} projectConfig - Site configuration (for defaults.layout)
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<JxDocument>} The merged document (layout wrapping page content)
 */
export function resolveLayout(
  pageDoc: JxDocument,
  projectConfig: ProjectConfig,
  projectRoot: string,
): Promise<JxDocument> {
  return resolveLayoutWith(pageDoc, projectConfig, nodeLayoutLoader(projectRoot));
}

/**
 * Every layout a page is wrapped in, innermost first, each with the absolute path it was read from.
 *
 * The chain {@link resolveLayout} follows: the page's `$layout`, else `defaults.layout`, then each
 * layout's own `$layout`. A reference that is not a non-empty string ends it, which is how
 * `"$layout": false` opts a page out, and so does a layout already in the chain, so a layout that
 * names itself is listed once rather than followed forever.
 *
 * It exists for what the merged document no longer says: which file declared what. Resolution
 * merges state and splices children, so a relative path a layout wrote is relative to the layout's
 * own file, and only the chain still names that file.
 *
 * @param {JxDocument} pageDoc - The raw page document
 * @param {ProjectConfig} projectConfig - Site configuration (for defaults.layout)
 * @param {string} projectRoot - Project root directory, which every `$layout` is relative to
 * @returns {{ path: string; doc: JxDocument }[]} Each layout's absolute path and document
 */
export function layoutChain(
  pageDoc: JxDocument,
  projectConfig: ProjectConfig,
  projectRoot: string,
): { path: string; doc: JxDocument }[] {
  const load = nodeLayoutLoader(projectRoot);
  const chain: { path: string; doc: JxDocument }[] = [];
  let ref = pageDoc.$layout ?? projectConfig.defaults?.layout;
  while (ref) {
    const path = resolve(projectRoot, ref);
    if (chain.some((level) => level.path === path)) {
      break;
    }
    const doc = load(ref);
    chain.push({ doc, path });
    ref = doc.$layout;
  }
  return chain;
}
