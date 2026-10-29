/**
 * Find an executable the way `Bun.which` does, on `node:fs` alone.
 *
 * The desktop backend runs on Electron's Node (specs/desktop.md §7.1), so the code it reaches
 * cannot call `Bun.which`. The answer is held to Bun's by `tests/which.test.ts`: a name containing
 * a path separator is resolved against the working directory and returned when it is an executable
 * regular file; any other name is looked up in each non-empty `PATH` entry in order. On Windows,
 * where every file passes an `X_OK` check, only a launchable name counts: one that already ends in
 * `.exe`, `.cmd`, `.bat` or `.com` is tried as written, and any other gets each of those appended
 * in that order. Like Bun, it ignores `PATHEXT`, whose `.js` and `.vbs` entries name files a
 * process cannot spawn. The path returned is the one that was tried, so an appended extension is
 * lower case whatever the file's own case, and never its realpath.
 *
 * Node-only: it reads the filesystem, unlike the rest of this package's browser-safe modules.
 */
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

/** True when `path` is a regular file this process may execute. */
function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The extensions Bun's `which` tries on Windows, in its order. */
const WINDOWS_EXTENSIONS = [".exe", ".cmd", ".bat", ".com"];

/**
 * The names to try for `name`: itself elsewhere; on Windows, only names with a launchable
 * extension.
 */
function candidates(name: string, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") {
    return [name];
  }
  const lower = name.toLowerCase();
  if (WINDOWS_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return [name];
  }
  return WINDOWS_EXTENSIONS.map((extension) => `${name}${extension}`);
}

/**
 * The absolute path of the executable `name`, or null when there is none.
 *
 * @param name A command name, or a path (absolute, or relative to the working directory)
 * @param options `PATH` overrides the environment's search path
 */
export function which(
  name: string,
  options: { PATH?: string; platform?: NodeJS.Platform } = {},
): string | null {
  if (name === "") {
    return null;
  }
  const platform = options.platform ?? process.platform;
  if (name.includes("/") || (platform === "win32" && name.includes("\\"))) {
    return candidates(resolve(name), platform).find((path) => isExecutable(path)) ?? null;
  }
  const dirs = (options.PATH ?? process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const found = candidates(join(dir, name), platform).find((path) => isExecutable(path));
    if (found) {
      return found;
    }
  }
  return null;
}
