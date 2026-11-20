/**
 * Whether a folder a window was asked to open is gone.
 *
 * A recent project can be moved, renamed or deleted between launches. The answer is asked before
 * anything prompts about the folder or binds a window to it, so the person who clicked it is told
 * instead of watching a window flash open and close.
 */

import { statSync } from "node:fs";
import type { Stats } from "node:fs";

/** Error codes that mean "no such place", and nothing else (a sandbox refusal is not one). */
const ABSENT = new Set(["ENOENT", "ENOTDIR"]);

/**
 * @param root The absolute folder path.
 * @param stat `statSync`, replaceable by a test.
 * @returns True only when the filesystem says the path does not exist. A permission error, which
 *   the Mac App Store sandbox gives for a folder it has not granted, is not absence.
 */
export function folderIsMissing(root: string, stat: (path: string) => Stats = statSync): boolean {
  try {
    stat(root);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && ABSENT.has(String(error.code));
  }
}
