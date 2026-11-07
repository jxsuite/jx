/**
 * What makes a file named `project.json` a project's configuration, and which project encloses a
 * path.
 *
 * A name is not enough. `pages/project.json` is a legal page with the route `/project`, and Nx
 * keeps its own `project.json` in every package of a workspace, so a walker that believes the name
 * turns a folder of pages into a project root. The content decides, and it decides in three ways,
 * because a file that does not parse is a different answer from a file that is something else: a
 * typo in a project file must not make its folder stop being a project, or a double-click on a page
 * there would walk past it to some ancestor and open the wrong thing.
 *
 * Pure, with no Node import: a walker takes its filesystem as a parameter.
 *
 * @docs studio/desktop
 */
import { isNonNullObject } from "./guards.ts";

/** The file that declares a project. */
export const PROJECT_FILE_NAME = "project.json";

/**
 * Members only a document has, and no project configuration does. `tagName` alone would not do: it
 * is optional, so `{ "$layout": "./base.json", "textContent": "Hi" }` is a whole page.
 */
const DOCUMENT_KEYS = [
  "$layout",
  "$paths",
  "$ref",
  "children",
  "innerHTML",
  "tagName",
  "textContent",
  "title",
] as const;

/** Members of Nx's `project.json`, which shares the name and is nothing to do with Jx. */
const NX_KEYS = ["projectType", "sourceRoot", "targets"] as const;

/**
 * What a file named `project.json` turned out to be.
 *
 * - `project`: a project's configuration.
 * - `other`: valid JSON that is something else, so the search goes on past it.
 * - `unreadable`: not JSON. Believed, and reported, because this is most likely a project with a typo
 *   in it, and the person who made the typo needs to hear about it.
 */
export type ProjectFileVerdict = "other" | "project" | "unreadable";

/**
 * Classify the text of a file named `project.json`.
 *
 * @param text The file's text.
 */
export function classifyProjectFile(text: string): ProjectFileVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "unreadable";
  }
  if (!isNonNullObject(parsed) || Array.isArray(parsed)) {
    return "other";
  }
  const members: object = parsed;
  const has = (key: string): boolean => Object.hasOwn(members, key);
  return DOCUMENT_KEYS.some((key) => has(key)) || NX_KEYS.some((key) => has(key))
    ? "other"
    : "project";
}

/** The filesystem a walk needs. */
export interface ProjectWalkIo {
  /** The folder holding `path`; a root answers with itself, which is how the walk knows to stop. */
  dirname: (path: string) => string;
  join: (directory: string, name: string) => string;
  /** The file's text, or null when it is absent or cannot be read. */
  readText: (path: string) => string | null;
}

/** The project a walk found. */
export interface EnclosingProject {
  /** The project file's path. */
  projectFile: string;
  /** The folder holding it. */
  root: string;
  verdict: Exclude<ProjectFileVerdict, "other">;
}

/**
 * Find the nearest project at or above a folder.
 *
 * @param startDirectory Where to begin; it is checked first.
 * @param io The filesystem.
 * @param stopAt The last folder to check. Without one the walk ends at the filesystem's root.
 * @returns The project, or null when nothing up to the limit is one.
 */
export function findEnclosingProject(
  startDirectory: string,
  io: ProjectWalkIo,
  stopAt?: string,
): EnclosingProject | null {
  const projectFile = io.join(startDirectory, PROJECT_FILE_NAME);
  const text = io.readText(projectFile);
  const verdict = text === null ? "other" : classifyProjectFile(text);
  if (verdict !== "other") {
    return { projectFile, root: startDirectory, verdict };
  }
  const parent = io.dirname(startDirectory);
  return startDirectory === stopAt || parent === startDirectory
    ? null
    : findEnclosingProject(parent, io, stopAt);
}
