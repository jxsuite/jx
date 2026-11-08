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
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  NEW_PROJECT_FILE_NAME,
  ProjectFileConflictError,
  findEnclosingProject,
  parseProjectFile,
  pickProjectFileName,
} from "./project-file.ts";
import type {
  EnclosingProject,
  ProjectFileName,
  ProjectFileRead,
  ProjectWalkIo,
} from "./project-file.ts";

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
  let descriptor: number;
  try {
    // Read-only is zero, so this is read-only and non-blocking. Windows has no such flag, or FIFOs here.
    descriptor = openSync(path, constants.O_NONBLOCK);
  } catch {
    return isDeniedHere(path) ? "" : null;
  }
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      return null;
    }
    return stats.size > MAX_PROJECT_FILE_BYTES ? "" : readFileSync(descriptor, "utf8");
  } catch {
    // It opened, so it is there: a failure now is a read error, never an absence.
    return "";
  } finally {
    closeSync(descriptor);
  }
}

/** The walk over the real filesystem. */
export const NODE_PROJECT_WALK_IO: ProjectWalkIo = { dirname, join, readText: readCandidate };

/**
 * Which project file a folder holds.
 *
 * @param root The folder.
 * @returns Its name; "conflict" when the folder holds both; null when it holds neither.
 */
export function projectFileNameIn(root: string): ProjectFileName | "conflict" | null {
  return pickProjectFileName((name) => existsSync(join(root, name)));
}

/**
 * The project file's path in a folder: whichever of the two names it holds, or a new project's name
 * when it holds neither, which is where a project file would be written.
 *
 * @param root The folder.
 * @throws {ProjectFileConflictError} When the folder holds both, which no host may choose between.
 */
export function projectFilePath(root: string): string {
  const name = projectFileNameIn(root);
  if (name === "conflict") {
    throw new ProjectFileConflictError(root);
  }
  return join(root, name ?? NEW_PROJECT_FILE_NAME);
}

/** Which project file a folder holds, and when it last changed: what a cache of it keys on. */
export interface ProjectFileStamp {
  mtime: number;
  path: string;
}

/**
 * The project file a folder holds and when it last changed.
 *
 * A cache compares both, because converting a project changes which file it is and need not change
 * the time.
 *
 * @param root The folder.
 * @returns Null when the folder holds no project file, or holds both, which is no project to serve
 *   until the person editing it chooses.
 */
export function projectFileStamp(root: string): ProjectFileStamp | null {
  const name = projectFileNameIn(root);
  if (name === null || name === "conflict") {
    return null;
  }
  const path = join(root, name);
  const mtime = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
  return mtime === undefined ? null : { mtime, path };
}

/**
 * Whether a cached stamp still describes the file.
 *
 * @param cached What the cache holds.
 * @param stamp What the folder holds now.
 */
export function isSameStamp(
  cached: ProjectFileStamp | undefined,
  stamp: ProjectFileStamp,
): boolean {
  return cached !== undefined && cached.mtime === stamp.mtime && cached.path === stamp.path;
}

/**
 * Whether a folder named explicitly holds a project file, of either name.
 *
 * By name alone, because the caller has already said this is the project. A search, which could
 * land on a page by that name, uses {@link findEnclosingProjectOnDisk}. A folder holding both files
 * holds one, and reading it reports the conflict.
 *
 * @param root The folder.
 */
export function hasProjectFile(root: string): boolean {
  return projectFileNameIn(root) !== null;
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
 * @returns What it holds or what is wrong with it, a folder holding both files included, or null
 *   when it has none.
 */
export function readProjectFile(root: string): ProjectFileRead | null {
  let path: string;
  try {
    path = projectFilePath(root);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), path: root, text: "" };
  }
  try {
    return parseProjectFile(path, readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
