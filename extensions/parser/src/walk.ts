/**
 * Walk — the one directory walk behind every collection's file discovery (node-only).
 *
 * Two properties are the reason it is not a bare `readdirSync(dir, { recursive: true })`:
 *
 * - **Sorted.** Entries are visited by name within each directory, depth first, so a collection loads
 *   in the same order on every machine. The platform's own directory order is whatever the
 *   filesystem returns, and "first one wins" rules (a duplicate id, a duplicate route) must not
 *   depend on it.
 * - **Pruned.** A directory an `exclude` pattern excludes whole (`**` + `/node_modules/**`,
 *   `internal/**`, a dot-folder) is never read, which is the difference between a vault that sits
 *   beside a website's `node_modules` building in a blink and building after listing every file in
 *   it. A directory that cannot be read is skipped rather than failing the whole collection.
 *
 * @module @jxsuite/parser/walk
 * @license MIT
 * @docs framework/site/content-collections
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExcludeMatcher } from "./content-rules.ts";

/**
 * Absolute paths of the files under `root` whose name `accept`s and that `exclude` does not hide.
 *
 * A symlink is a file when it points at one and is ignored when it dangles; a symlinked directory
 * is not entered, which is what keeps a link back to an ancestor from looping.
 *
 * @param {string} root - Absolute directory
 * @param {(name: string) => boolean} accept - Whether a file name is an entry file
 * @param {ExcludeMatcher} exclude - The type's `exclude` patterns, matched against root-relative
 *   paths
 * @returns {string[]}
 */
export function walkFiles(
  root: string,
  accept: (name: string) => boolean,
  exclude: ExcludeMatcher,
): string[] {
  const found: string[] = [];
  const walk = (dir: string, rel: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!exclude.excludesDir(path)) {
          walk(join(dir, entry.name), path);
        }
      } else if (accept(entry.name) && !exclude.excludedBy(path)) {
        const full = join(dir, entry.name);
        if (!entry.isSymbolicLink() || statSync(full, { throwIfNoEntry: false })?.isFile()) {
          found.push(full);
        }
      }
    }
  };
  walk(root, "");
  return found;
}
