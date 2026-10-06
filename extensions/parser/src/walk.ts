/**
 * Walk — the one directory walk behind every collection's file discovery (node-only).
 *
 * Three properties are the reason it is not a bare `readdirSync(dir, { recursive: true })`:
 *
 * - **Sorted.** Entries are visited by name within each directory, depth first, so a collection loads
 *   in the same order on every machine. The platform's own directory order is whatever the
 *   filesystem returns, and "first one wins" rules (a duplicate id, a duplicate route) must not
 *   depend on it.
 * - **Pruned.** A directory an `exclude` pattern excludes whole (`**` + `/node_modules/**`,
 *   `internal/**`, a dot-folder) is never read, which is the difference between a vault that sits
 *   beside a website's `node_modules` building in a blink and building after listing every file in
 *   it. A directory that cannot be read is skipped rather than failing the whole collection.
 * - **Loop-safe.** A symlinked directory is followed, as `readdirSync` always did, because a monorepo
 *   that mounts shared documentation into a collection (`content/docs` pointing at `../../docs`) is
 *   a real layout. What it refuses is a link back into a directory it is already inside, which
 *   would otherwise recurse until the platform gave up.
 *
 * @module @jxsuite/parser/walk
 * @license MIT
 * @docs framework/site/content-collections
 */

import { readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExcludeMatcher } from "./content-rules.ts";

/**
 * Absolute paths of the files under `root` whose name `accept`s and that `exclude` does not hide.
 *
 * A symlink is a file when it points at one and is ignored when it dangles. A symlink to a
 * directory is entered once per path that reaches it, except that a link resolving to a directory
 * the walk is currently inside is skipped, so a link back to an ancestor cannot loop. Links are
 * trusted: where one points is the author's choice, exactly as it is for any other file in the
 * source.
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
  /** The real path of every directory the walk is inside right now, root first. */
  const inside = new Set<string>();
  const real = (path: string): string | undefined => {
    try {
      return realpathSync(path);
    } catch {
      return undefined;
    }
  };
  const walk = (dir: string, rel: string, realDir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    inside.add(realDir);
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const full = join(dir, entry.name);
      let isDirectory = entry.isDirectory();
      let realChild = join(realDir, entry.name);
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        const target = statSync(full, { throwIfNoEntry: false });
        isDirectory = target?.isDirectory() === true;
        isFile = target?.isFile() === true;
        if (isDirectory) {
          const resolved = real(full);
          if (resolved === undefined) {
            continue;
          }
          realChild = resolved;
        }
      }
      if (isDirectory) {
        if (!inside.has(realChild) && !exclude.excludesDir(path)) {
          walk(full, path, realChild);
        }
      } else if (isFile && accept(entry.name) && !exclude.excludedBy(path)) {
        found.push(full);
      }
    }
    inside.delete(realDir);
  };
  walk(root, "", real(root) ?? root);
  return found;
}
