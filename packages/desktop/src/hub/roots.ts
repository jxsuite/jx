/**
 * How the hub names a project root and where it serves the Studio shell.
 *
 * @docs studio/desktop
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

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
  let normalized = resolve(root);
  try {
    normalized = realpathSync.native(normalized);
  } catch {
    // A root that does not exist yet (a project being created) keeps its resolved form.
  }
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
