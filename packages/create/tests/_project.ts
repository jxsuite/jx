/** A generated project's configuration, from whichever project file its folder holds. */
import { readFileSync } from "node:fs";
import { parseProjectSource } from "@jxsuite/schema/project-file";
import { projectFilePath } from "@jxsuite/schema/project-file/node";
import type { ProjectConfig } from "@jxsuite/schema/types";

/**
 * Read the project file a scaffold wrote: `project.jxn` for a new project, `project.json` for a
 * starter that still has one.
 *
 * @param dir The project's root.
 */
export function readProject(dir: string): ProjectConfig {
  const path = projectFilePath(dir);
  return parseProjectSource(readFileSync(path, "utf8"), path);
}
