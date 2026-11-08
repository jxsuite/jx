/// <reference lib="dom" />
/**
 * Which file the open project is declared by, `project.jxn` or `project.json`
 * (`site-architecture.md` §2.3).
 *
 * Studio reaches the project file through `projectConfigPath()`, and this is what makes that the
 * open project's own file rather than a constant. It is learned from the listing of the project's
 * root, which every host answers, as the project opens. A folder holding both files is reported,
 * and the configuration cannot be saved until one is gone (`tabs/project-config.ts`).
 *
 * @docs framework/concepts/jxn-files
 */
import {
  NEW_PROJECT_FILE_NAME,
  pickProjectFileName,
  projectFileConflict,
} from "@jxsuite/schema/project-file";
import type { ProjectFileName } from "@jxsuite/schema/project-file";
import { notify } from "../services/notify";
import { setProjectConfigPath } from "../tabs/tab";
import type { StudioPlatform } from "../types";

/** Whether the open project's folder holds both project files. */
let conflicted = false;

/** Whether the open project's folder holds both project files, so neither may be written. */
export function hasProjectFileConflict(): boolean {
  return conflicted;
}

/**
 * Learn which project file the open project has, and say so to `projectConfigPath()`.
 *
 * @param platform The host, whose project root is already the project's.
 * @returns The file's name, "conflict" when the folder holds both, or null when it holds neither.
 */
export async function learnProjectFileName(
  platform: Pick<StudioPlatform, "listDirectory">,
): Promise<ProjectFileName | "conflict" | null> {
  let names: ReadonlySet<string> = new Set();
  try {
    const entries = await platform.listDirectory(".");
    names = new Set(entries.filter((entry) => entry.type === "file").map((entry) => entry.name));
  } catch {
    // A root that cannot be listed has no project file Studio can see, which is a new project's.
  }
  const picked = pickProjectFileName((name) => names.has(name));
  conflicted = picked === "conflict";
  // With both, the Jx Notation one is what the editor shows, and nothing is written to either.
  setProjectConfigPath(picked === "conflict" ? "project.jxn" : (picked ?? NEW_PROJECT_FILE_NAME));
  if (picked === "conflict") {
    notify.error(projectFileConflict("This project's folder"), {
      key: "project-file-conflict",
      path: "project.jxn",
      source: "Project",
    });
  }
  return picked;
}
