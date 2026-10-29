/**
 * Install a workspace extension into a throwaway project, the way a real install places it.
 *
 * An extension resolves from the project's own `node_modules` and never from the host running the
 * tool, first-party ones included (specs/extensions.md §3). A test that builds a project in the
 * system temporary directory therefore has to give it the extension, because nothing above that
 * directory will. This links `<root>/node_modules/<name>` to the workspace package, which is what
 * `bun install` makes of a `workspace:` dependency, so the test exercises the same resolution a
 * user's install does.
 */
import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The workspace install every package is hoisted into. */
const WORKSPACE_MODULES = resolve(import.meta.dir, "../../../node_modules");

/**
 * Link each named workspace package into `projectRoot/node_modules`.
 *
 * @param {string} projectRoot - The throwaway project
 * @param {string[]} names - Package names, e.g. "@jxsuite/parser"
 */
export function installWorkspaceExtension(projectRoot: string, ...names: string[]): void {
  for (const name of names) {
    const target = realpathSync(join(WORKSPACE_MODULES, name));
    const link = join(projectRoot, "node_modules", ...name.split("/"));
    mkdirSync(dirname(link), { recursive: true });
    // A junction on Windows, which needs no privilege; ignored elsewhere.
    symlinkSync(target, link, "junction");
  }
}
