/**
 * How the hub names a project root and where it serves the Studio shell.
 *
 * @docs studio/desktop
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A project root the user has agreed to run code from (specs/desktop.md §4.7).
 *
 * A session cannot be bound to a plain string. This type is what makes the trust prompt a property
 * of the program rather than a list of callers to keep up to date: the only values of it are the
 * ones the hub's gate hands out, so a new way of opening a project that forgets to ask does not
 * compile.
 */
export type AuthorizedRoot = string & { readonly __authorizedRoot: unique symbol };

/** Where each window's server serves the Studio shell. */
export const STUDIO_SHELL_PATH = "/__studio__/index.html";

/**
 * Normalize a project root for comparison: absolute, symlinks resolved, case-folded on Windows.
 *
 * Dedupe is only as good as this. `/home/me/site` and `/home/me/./site/` and a symlink into it are
 * one project, and opening a second window for it because the strings differ is exactly the bug
 * multi-window is supposed to avoid.
 */
export function normalizeRoot(root: string): string {
  const real = realRoot(root);
  return process.platform === "win32" ? real.toLowerCase() : real;
}

/**
 * A root as the filesystem has it: absolute, with symlinks resolved, and its case kept.
 *
 * @param root The root.
 */
export function realRoot(root: string): string {
  const absolute = resolve(root);
  try {
    return realpathSync.native(absolute);
  } catch {
    // A root that does not exist yet (a project being created) keeps its resolved form.
    return absolute;
  }
}
