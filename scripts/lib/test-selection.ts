/**
 * Which test files a diff can fail, workspace by workspace.
 *
 * Two questions are composed here and kept apart on purpose. `decide()` in `scripts/ci/affected.ts`
 * answers which WORKSPACES a changed path reaches, from `package.json` and the declared filesystem
 * edges; it is asked once per path, so a path's reach is exactly what the workspace gate says it
 * is. The import graph (`test-graph.ts`) then narrows each reached workspace to the test files that
 * load the path. Narrowing is refused, and the workspace runs whole, whenever the graph cannot
 * vouch for the answer:
 *
 * - The workspace gate itself failed open (a GLOBAL or unclassified path);
 * - The path is a workspace's `package.json`, `bunfig.toml` or `tsconfig*.json`, which change how
 *   every file in it resolves, loads or is measured;
 * - The path reaches the workspace through an EXTRA_EDGES entry, which exists precisely because no
 *   import records that dependency;
 * - The path is not a node of the graph: a fixture, a data file, a spawned entry point, a deleted
 *   file, a source file nothing imports yet. Whatever loads it does so by a route the graph has no
 *   record of.
 *
 * A changed TEST file reaches only its own workspace: the runner loads it and nothing downstream
 * does. One kind of path selects nothing at all: a module that is erased at run time (a
 * `types.ts`). No import of it survives transpilation, so it is never a node, and `tsc` is what
 * judges it.
 *
 * Otherwise the workspace runs the tests whose imports reach the path, plus every OPAQUE test: one
 * that reads the filesystem, spawns a process or computes an `import()` specifier, and so can
 * depend on a file it never imports.
 *
 * This is a FAST SIGNAL, not a gate, and one hole is left open knowingly. A source module that
 * loads code by a computed specifier (the runtime importing a project's modules, a host loading an
 * extension by name) can pull a changed file into a test that neither imports it nor is opaque. The
 * extensions, which are only ever loaded that way, are covered by their EXTRA_EDGES entries; the
 * rest is why CI's `test` matrix still runs every affected workspace whole.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { decide, edgeSeeds } from "../ci/affected.ts";
import { CODE_FILE, TEST_FILE, isTypeOnly, testsReaching } from "./test-graph.ts";
import type { TestGraph } from "./test-graph.ts";
import type { Workspace } from "./workspaces.ts";

export interface Selection {
  /** Workspace dir, e.g. "packages/studio". */
  dir: string;
  /** `all` runs the workspace's whole suite; `some` runs {@link files}. */
  mode: "all" | "some";
  /** Repo-relative test files, sorted. Every test in the workspace when `mode` is `all`. */
  files: string[];
  /** Of {@link files}, how many are there only because they are opaque. */
  opaque: number;
  /** How many test files the workspace has. */
  total: number;
  reason: string;
}

/**
 * Test helpers that touch the filesystem and are known to read only DATA files. A test is not
 * opaque merely for importing one: a data file no module imports already runs its workspace whole
 * (the unknown-file rule above), so the read is covered without the opaque tax.
 *
 * Each entry names the one thing the helper reads. `test-selection.test.ts` holds every entry to a
 * file that still exists and still matches `FS_ACCESS`, so a stale entry fails by name.
 */
export const DECLARED_READERS = {
  "packages/studio/tests/format-fixture.ts":
    "extensions/parser/src/Markdown.class.json, resolved through @jxsuite/parser's exports",
} satisfies Record<string, string>;

/** Files that change how every module in a workspace resolves, loads or is measured. */
const WORKSPACE_CONFIG = /^(?:package\.json|bunfig\.toml|tsconfig(?:\.[\w-]+)?\.json)$/;

export function selectTests(
  changed: string[],
  workspaces: Workspace[],
  graph: TestGraph,
  root: string,
): Selection[] {
  /** Workspace → why it runs whole. */
  const whole = new Map<string, string>();
  /** Workspace → the changed paths that reach it and can be traced through the graph. */
  const traced = new Map<string, Set<string>>();

  for (const path of changed) {
    const reach = decide([path], workspaces);
    if (reach.mode === "all") {
      for (const dir of reach.testDirs) {
        if (!whole.has(dir)) {
          whole.set(dir, reach.reason);
        }
      }
      continue;
    }
    const onDisk = existsSync(join(root, path));
    if (
      onDisk &&
      CODE_FILE.test(path) &&
      !graph.imports.has(path) &&
      isTypeOnly(readFileSync(join(root, path), "utf8"), path)
    ) {
      continue;
    }
    let untraceable: string | undefined;
    if (WORKSPACE_CONFIG.test(basename(path))) {
      untraceable = `${path} configures the whole workspace`;
    } else if (!graph.imports.has(path)) {
      untraceable = onDisk
        ? `${path} is not imported by any module, so its readers are unknown`
        : `${path} was deleted, so its readers are unknown`;
    }
    const seeded = new Set(edgeSeeds(path));
    // A test file is loaded by the runner and by nothing downstream, so it reaches its own
    // Workspace only: itself, and the opaque tests beside it that may read `tests/` as data.
    const owner = TEST_FILE.test(path)
      ? workspaces.find((w) => path.startsWith(`${w.dir}/`))?.dir
      : undefined;
    for (const dir of reach.testDirs) {
      if (owner !== undefined && dir !== owner && !seeded.has(dir)) {
        continue;
      }
      const why =
        untraceable ?? (seeded.has(dir) ? `${path} reaches ${dir} by a declared edge` : undefined);
      if (why !== undefined) {
        if (!whole.has(dir)) {
          whole.set(dir, why);
        }
        continue;
      }
      let paths = traced.get(dir);
      if (!paths) {
        paths = new Set();
        traced.set(dir, paths);
      }
      paths.add(path);
    }
  }

  const selections: Selection[] = [];
  for (const workspace of workspaces) {
    const tests = graph.tests.get(workspace.dir) ?? [];
    const wholeReason = whole.get(workspace.dir);
    if (wholeReason !== undefined) {
      selections.push({
        dir: workspace.dir,
        mode: "all",
        files: tests,
        opaque: 0,
        total: tests.length,
        reason: wholeReason,
      });
      continue;
    }
    const paths = traced.get(workspace.dir);
    if (!paths) {
      continue;
    }
    // A module whose relative import names nothing is the other half of a delete or a rename: the
    // Deleted path is no longer a node, so the importer stands in for it.
    const seeds = [...paths, ...graph.broken.keys()];
    const own = new Set(tests);
    const reached = [...testsReaching(graph, seeds)].filter((test) => own.has(test));
    const files = new Set(reached);
    let opaque = 0;
    for (const test of tests) {
      if (graph.opaque.has(test) && !files.has(test)) {
        files.add(test);
        opaque += 1;
      }
    }
    if (files.size === 0) {
      continue;
    }
    selections.push({
      dir: workspace.dir,
      mode: "some",
      files: [...files].toSorted(),
      opaque,
      total: tests.length,
      reason: `${reached.length} reached by import, ${opaque} opaque`,
    });
  }
  return selections;
}
