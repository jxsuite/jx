/**
 * The project file on a real filesystem, for hosts that have one.
 *
 * Synchronous, and that is load-bearing rather than convenient: `loadProjectConfig` is a published
 * export, `siteOutDir` is synchronous, and a containment guard reads a project's collection roots
 * on every file operation, where an accidentally unawaited call would turn the guard into a no-op.
 *
 * @docs studio/desktop
 */
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { PROJECT_FILE_NAME, findEnclosingProject, parseProjectFile } from "./project-file.ts";
import type { EnclosingProject, ProjectFileRead, ProjectWalkIo } from "./project-file.ts";

/** Larger than any real project file, and small enough to read before anyone has answered. */
const MAX_PROJECT_FILE_BYTES = 4 * 1024 * 1024;

/**
 * Whether a failure to open means the file is there and this process may not read it.
 *
 * Being denied is not enough. Under a strict snap or the App Sandbox the same denial answers for
 * places this process may not look at all, like `/home/project.json` on the way up to the root, and
 * believing those would make a parent folder a project. Only a file that can be seen counts.
 */
function isDeniedHere(path: string): boolean {
  try {
    lstatSync(path);
  } catch {
    return false;
  }
  try {
    accessSync(path, constants.R_OK);
    return false;
  } catch {
    return true;
  }
}

/**
 * Read a candidate project file, which may be in a folder nobody has answered for.
 *
 * So the file is not to be trusted, and neither is what it is: a FIFO would block this process, and
 * a link to `/dev/zero` would never end. It is opened without blocking and read only if it is an
 * ordinary file of a sane size.
 *
 * @param path The candidate.
 * @returns Its text; "" when it is there and cannot be read, which `classifyProjectFile` reads as
 *   unreadable, so a walk stops and says so rather than opening some ancestor instead; and null
 *   when it is not there or is not a file.
 */
function readCandidate(path: string): string | null {
  let descriptor: number | null = null;
  try {
    // Read-only is zero, so this is read-only and non-blocking. Windows has no such flag, or FIFOs here.
    descriptor = openSync(path, constants.O_NONBLOCK);
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      return null;
    }
    return stats.size > MAX_PROJECT_FILE_BYTES ? "" : readFileSync(descriptor, "utf8");
  } catch {
    return isDeniedHere(path) ? "" : null;
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}

/** The walk over the real filesystem. */
export const NODE_PROJECT_WALK_IO: ProjectWalkIo = { dirname, join, readText: readCandidate };

/**
 * The project file's path in a folder.
 *
 * @param root The folder.
 */
export function projectFilePath(root: string): string {
  return join(root, PROJECT_FILE_NAME);
}

/**
 * Whether a folder named explicitly holds a project file.
 *
 * By name alone, because the caller has already said this is the project. A search, which could
 * land on a page by that name, uses {@link findEnclosingProjectOnDisk}.
 *
 * @param root The folder.
 */
export function hasProjectFile(root: string): boolean {
  return existsSync(projectFilePath(root));
}

/**
 * Find the nearest project at or above a folder.
 *
 * @param startDirectory Where to begin.
 * @param stopAt The last folder to check; the filesystem's root without one.
 */
export function findEnclosingProjectOnDisk(
  startDirectory: string,
  stopAt?: string,
): EnclosingProject | null {
  return findEnclosingProject(startDirectory, NODE_PROJECT_WALK_IO, stopAt);
}

/**
 * Read a folder's project file.
 *
 * @param root The folder.
 * @returns What it holds or what is wrong with it, or null when it has none.
 */
export function readProjectFile(root: string): ProjectFileRead | null {
  const path = projectFilePath(root);
  try {
    return parseProjectFile(path, readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
