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
 * It is also the one place that knows what a project file is called and how to read and write one,
 * so that changing either is one change. Pure, with no Node import, because Studio and a Worker use
 * it: a walker takes its filesystem as a parameter, and `./project-file/node` supplies the real
 * one.
 *
 * @docs studio/desktop
 */
import { isNonNullObject } from "./guards.ts";
import { rewriteJson } from "./json-layout.ts";
import { parseProjectConfig } from "./parse.ts";
import type { ProjectConfig } from "../types.ts";

/** The file that declares a project. */
export const PROJECT_FILE_NAME = "project.json";

/**
 * Whether a project-relative path is the project's own file.
 *
 * Exact, on purpose: `endsWith` also answers for `new-project.json`, and `pages/project.json` is a
 * page.
 *
 * @param path A path relative to the project's root.
 */
export function isProjectConfigPath(path: string | null | undefined): boolean {
  return path === PROJECT_FILE_NAME;
}

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

/** A project file as read: its configuration, or what is wrong with it. */
export type ProjectFileRead =
  | { config: ProjectConfig; path: string; text: string }
  | { error: string; path: string; text: string };

/**
 * Parse a project file's text, reporting what is wrong rather than throwing it.
 *
 * Each host decides what a broken file means. `jx build` refuses, Studio shows a Problem, and a
 * live preview carries on, because refusing would hide the one error the author can act on behind a
 * blank origin. So this answers with the problem, and does not throw on a host's behalf.
 *
 * @param path The file's path, which a problem names.
 * @param text The file's text.
 */
export function parseProjectFile(path: string, text: string): ProjectFileRead {
  try {
    return { config: parseProjectConfig(text, path), path, text };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), path, text };
  }
}

/**
 * Write a project's configuration, keeping as much of the text it replaces as can be kept.
 *
 * @param config The configuration.
 * @param previous The file's current text, or null for a new one.
 */
export function serializeProjectFile(config: ProjectConfig, previous: string | null): string {
  return rewriteJson(config, previous);
}
