/**
 * File globbing on `node:fs`, answering what `Bun.Glob#scan({ cwd, dot: false })` answered.
 *
 * The desktop backend runs on Electron's Node (specs/desktop.md §7.1), so nothing it reaches may
 * call `Bun.Glob`. `fs.promises.glob` is the shared API, and two of its defaults differ from Bun's:
 * it yields directories as well as files, and it yields a symbolic link as itself. A third
 * difference is in the matcher, below. Bun's scan yields regular files only and does not follow
 * links, so both are filtered here. `tests/fs-glob.test.ts` holds the two answers equal on the same
 * tree.
 *
 * Paths are relative to `cwd` with the platform's own separator, as Bun's were.
 */
import type { Dirent } from "node:fs";
import { glob, opendir } from "node:fs/promises";
import { join, relative } from "node:path";

/** Bun's scan neither yields nor descends through a symbolic link, file or directory. */
function isLink(entry: Dirent): boolean {
  return entry.isSymbolicLink();
}

/**
 * Bun expands a one-alternative brace (`*.{json}`) and Node's matcher keeps it literal, so a
 * pattern built from a list that happens to hold one extension would match nothing. Unwrap those.
 */
function unwrapSingleBraces(pattern: string): string {
  return pattern.replaceAll(/\{([^{},]*)\}/g, "$1");
}

/**
 * Every regular file under `cwd` matching `pattern`, skipping dot-prefixed names.
 *
 * @yields {string} Each match, relative to `cwd`
 */
export async function* scanFiles(pattern: string, cwd: string): AsyncGenerator<string> {
  // Bun's scan throws for a root it cannot read; Node's glob yields nothing. Opening it first throws.
  const dir = await opendir(cwd);
  await dir.close();
  const options = { cwd, exclude: isLink, withFileTypes: true } as const;
  for await (const entry of glob(unwrapSingleBraces(pattern), options)) {
    if (entry.isFile()) {
      yield relative(cwd, join(entry.parentPath, entry.name));
    }
  }
}
