/**
 * What makes a file named `project.jxn` or `project.json` a project's configuration, and which
 * project encloses a path (`site-architecture.md` §2.3).
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
import { classifyJxn } from "./jxn/classify.ts";
import { isJxnPath } from "./jxn/document.ts";
import { parseProject, serializeProject } from "./jxn/project.ts";
import { parseProjectConfig } from "./parse.ts";
import type { ProjectConfig } from "../types.ts";

/**
 * The names a project file may have. Neither is preferred: a folder holding both is refused,
 * because silently reading one would leave the other looking live and not being so.
 */
export const PROJECT_FILE_NAMES = ["project.jxn", "project.json"] as const;

/** One of {@link PROJECT_FILE_NAMES}. */
export type ProjectFileName = (typeof PROJECT_FILE_NAMES)[number];

/**
 * What a new project's file is called (`site-architecture.md` §2.4). Never what an existing
 * project's is: that is whichever of {@link PROJECT_FILE_NAMES} its folder holds.
 */
export const NEW_PROJECT_FILE_NAME: ProjectFileName = "project.jxn";

/**
 * Whether a file name is one a project file may have.
 *
 * @param name A bare file name, with no folder.
 */
export function isProjectFileName(name: string | null | undefined): name is ProjectFileName {
  return name === "project.jxn" || name === "project.json";
}

/**
 * Whether a project-relative path is the project's own file.
 *
 * Exact, on purpose: `endsWith` also answers for `new-project.json`, and `pages/project.json` is a
 * page.
 *
 * @param path A path relative to the project's root.
 */
export function isProjectConfigPath(path: string | null | undefined): boolean {
  return isProjectFileName(path);
}

/**
 * The file name at the end of a path, in either separator.
 *
 * @param path A path.
 */
export function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/**
 * What a folder holding both project files is told.
 *
 * @param root The folder, as the person will recognise it.
 */
export function projectFileConflict(root: string): string {
  return `${root} holds both project.jxn and project.json, and a project has one. Keep the one you edit and delete the other`;
}

/** A folder holding both project files. */
export class ProjectFileConflictError extends Error {
  /** @param root The folder. */
  constructor(root: string) {
    super(projectFileConflict(root));
    this.name = "ProjectFileConflictError";
  }
}

/**
 * Which project file a folder holds, from the names in it.
 *
 * @param has Whether the folder holds a file by this name.
 * @returns The name; "conflict" when it holds both; null when neither.
 */
export function pickProjectFileName(
  has: (name: ProjectFileName) => boolean,
): ProjectFileName | "conflict" | null {
  const found = PROJECT_FILE_NAMES.filter((name) => has(name));
  if (found.length > 1) {
    return "conflict";
  }
  return found[0] ?? null;
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
 * What a file named `project.jxn` or `project.json` turned out to be.
 *
 * - `project`: a project's configuration.
 * - `other`: something else, such as a page by that name, so the search goes on past it.
 * - `unreadable`: neither. Believed, and reported, because this is most likely a project with a typo
 *   in it, and the person who made the typo needs to hear about it.
 */
export type ProjectFileVerdict = "other" | "project" | "unreadable";

/**
 * Classify the text of a project file candidate.
 *
 * A `project.jxn` says what it is with its first node (`spec.md` §22.5), which is read without
 * parsing the file, so a typo further down still leaves its folder a project. A `project.json` is
 * judged by its members, because JSON has no way to say.
 *
 * @param text The file's text.
 * @param path The file's name or path, which decides the format.
 */
export function classifyProjectFile(text: string, path = "project.json"): ProjectFileVerdict {
  if (isJxnPath(path)) {
    const kind = classifyJxn(text);
    return kind === "document" ? "other" : kind;
  }
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
  /** The project file's path; with a conflict, the `project.jxn` of the two. */
  projectFile: string;
  /** The folder holding it. */
  root: string;
  /** What it is: a project, a project that cannot be read, or a folder holding both files. */
  verdict: Exclude<ProjectFileVerdict, "other"> | "conflict";
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
  const found = PROJECT_FILE_NAMES.flatMap((name) => {
    const projectFile = io.join(startDirectory, name);
    const text = io.readText(projectFile);
    const verdict = text === null ? "other" : classifyProjectFile(text, name);
    return verdict === "other" ? [] : [{ projectFile, root: startDirectory, verdict }];
  });
  const [first] = found;
  if (first) {
    return found.length > 1 ? { ...first, verdict: "conflict" } : first;
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
    return { config: parseProjectSource(text, path), path, text };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), path, text };
  }
}

/**
 * Parse a project file's text in the format its name says.
 *
 * @param text The file's text.
 * @param path The file's path, which decides the format and names it in an error.
 * @throws {Error} When it does not read: a `JxnError`, with a line and column, for `project.jxn`.
 */
export function parseProjectSource(text: string, path: string): ProjectConfig {
  return isJxnPath(path) ? parseProject(text, path) : parseProjectConfig(text, path);
}

/**
 * Write a project's configuration, keeping as much of the text it replaces as can be kept.
 *
 * A `project.jxn` keeps its comments through the merge `spec.md` §22.4 describes, and a
 * `project.json` keeps its layout.
 *
 * @param config The configuration.
 * @param previous The file's current text, or null for a new one.
 * @param path The file's path, which decides the format. A new project's name without one.
 * @throws {Error} When a `project.jxn` holds what Jx Notation cannot spell, naming the pointer.
 */
export function serializeProjectFile(
  config: ProjectConfig,
  previous: string | null,
  path: string = NEW_PROJECT_FILE_NAME,
): string {
  return isJxnPath(path)
    ? serializeProject(config, previous ?? undefined)
    : rewriteJson(config, previous);
}
