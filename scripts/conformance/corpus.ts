/**
 * What the conformance harness builds and visits (scripts/conformance/README.md).
 *
 * The corpus is derived from the tree, never listed: every starter, every site and the examples
 * project. A project added to one of those directories is in the next capture without an edit here,
 * which is the property that keeps a conformance suite from quietly covering last year's sites.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** One project the harness builds. */
export interface Project {
  /** A name unique in the corpus, and the directory a capture stores it under. */
  id: string;
  /** The project root, relative to the repository root. */
  dir: string;
}

/** Directories whose every child with a project file is a project. */
const PROJECT_PARENTS = ["packages/starters/sites", "sites"];
/** Directories that are themselves a project. */
const PROJECT_ROOTS = ["examples"];
const PROJECT_FILES = ["project.jxn", "project.json"];

function isProject(dir: string): boolean {
  return PROJECT_FILES.some((name) => existsSync(join(dir, name)));
}

/**
 * Every project under a repository root, sorted by id.
 *
 * @param root The repository root to read. It need not be this checkout: a baseline is captured
 *   from another tree's projects, built by that tree's compiler.
 */
export function corpus(root: string): Project[] {
  const projects: Project[] = [];
  for (const parent of PROJECT_PARENTS) {
    const names = existsSync(join(root, parent)) ? readdirSync(join(root, parent)) : [];
    for (const name of names.toSorted()) {
      if (isProject(join(root, parent, name))) {
        projects.push({ dir: join(parent, name), id: name });
      }
    }
  }
  for (const dir of PROJECT_ROOTS) {
    if (isProject(join(root, dir))) {
      projects.push({ dir, id: dir.replaceAll("/", "-") });
    }
  }
  return projects.toSorted((a, b) => a.id.localeCompare(b.id));
}

/** What a build writes inside a project's own directory. */
const BUILD_LEFTOVERS = ["dist", ".cache"];

/**
 * Note what a project directory holds before it is built in place, and return the undo: a function
 * that removes whatever build output was not there before.
 *
 * Projects are built where they are, because a project may read files beside itself (the site's
 * content is `../../docs`) and a copy would not find them. But a starter is a template that gets
 * copied and published, and a `dist/` left in one is copied and published with it: the first run of
 * this harness left thirteen, and a test that stages a starter by copying it then found the old URL
 * of a renamed asset in the built Markdown. Output that was already there is someone else's and is
 * left alone.
 */
export function leaveAsFound(root: string): () => void {
  const created = BUILD_LEFTOVERS.filter((name) => !existsSync(join(root, name)));
  return () => {
    for (const name of created) {
      rmSync(join(root, name), { force: true, recursive: true });
    }
  };
}

/** Keep the projects named in a comma-separated list, or all of them when the list is empty. */
export function selectProjects(projects: readonly Project[], only: string): Project[] {
  const wanted = new Set(
    only
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  if (wanted.size === 0) {
    return [...projects];
  }
  const unknown = [...wanted].filter((name) => !projects.some((project) => project.id === name));
  if (unknown.length > 0) {
    const known = projects.map((project) => project.id).join(", ");
    throw new Error(`No such project: ${unknown.join(", ")}. The corpus has: ${known}.`);
  }
  return projects.filter((project) => wanted.has(project.id));
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return htmlFiles(path);
    }
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

/**
 * The URL paths a built site answers with a page, sorted: `index.html` is its directory, and any
 * other `.html` file is itself. Read from the output rather than from the route table, because the
 * output is the contract: a compiler that emits the same pages under a different internal route
 * model conforms.
 */
export function routesOf(dist: string): string[] {
  if (!existsSync(dist)) {
    return [];
  }
  return htmlFiles(dist)
    .map((file) => {
      const path = `/${relative(dist, file).split(sep).join("/")}`;
      return path.endsWith("/index.html") ? path.slice(0, -"index.html".length) : path;
    })
    .toSorted();
}

/**
 * At most `max` routes, spread evenly across the sorted list, always keeping the first.
 *
 * A site with a hundred pages generated from one template is mostly one page a hundred times, and
 * visiting each costs minutes. Even spacing over the sorted paths takes a few from every section of
 * the site, and is the same choice on every run, so two captures sample the same pages.
 */
export function sample(routes: readonly string[], max: number): string[] {
  if (max <= 0 || routes.length <= max) {
    return [...routes];
  }
  const picked = new Set<string>();
  for (let index = 0; index < max; index += 1) {
    const route = routes[Math.floor((index * routes.length) / max)];
    if (route !== undefined) {
      picked.add(route);
    }
  }
  return [...picked];
}

/** A file-system-safe name for a route: `/` is `index`, `/docs/start/` is `docs~start`. */
export function slugOf(route: string): string {
  const trimmed = route.replaceAll(/^\/+|\/+$/gu, "");
  return trimmed === "" ? "index" : trimmed.replaceAll("/", "~").replaceAll(/[^\w.~-]/gu, "_");
}
