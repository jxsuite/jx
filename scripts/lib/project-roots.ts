/**
 * The project roots a script walks. Beside `workspaces.ts` and not in it, because `affected.ts`
 * runs that one before anything is installed, and this reads the project file through its module.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hasProjectFile } from "../../packages/schema/src/project-file-node.ts";

/**
 * The folders directly inside `directory` that hold a project.
 *
 * @param directory The folder to look in; one that is not there holds none.
 */
export function projectRootsIn(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .map((name) => join(directory, name))
    .filter((path) => hasProjectFile(path))
    .toSorted();
}
