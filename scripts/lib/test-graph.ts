/**
 * The module graph under every test file, and the question it answers: which tests can a change to
 * this file reach?
 *
 * `scripts/ci/affected.ts` answers that per WORKSPACE, from `package.json`. This answers it per
 * TEST FILE, from the import statements themselves, and is only ever used to narrow a workspace
 * `affected.ts` already selected — it never adds one, so the workspace gate's guarantees
 * (EXTRA_EDGES, GLOBAL, fail open) stay the outer bound.
 *
 * What the graph can see: static imports, `import()` and `require()` of a literal specifier, a
 * `mock.module()` target (its importer still names it), JSON and CSS imports, and each workspace's
 * bunfig `preload`. What it cannot see is a file read as DATA — `readFileSync`, a glob over `src/`,
 * a spawned script. Two rules stand in front of that, and both are in `scripts/test-affected.ts`:
 *
 * 1. A test that reads the filesystem or spawns a process is OPAQUE (see {@link FS_ACCESS}) and runs
 *    whenever its workspace is selected at all.
 * 2. A changed file that is not code and is not a node of this graph has no known reader, so its
 *    workspace runs whole.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { Workspace } from "./workspaces.ts";

/** A file Bun evaluates as a module. Everything else is a leaf: imported, never scanned. */
export const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** The names `bun test` collects. */
export const TEST_FILE = /(?:\.test|\.spec|_test|_spec)\.(?:[cm]?[jt]s|[jt]sx)$/;

/**
 * A call that can reach a file the import graph does not know about: a filesystem read, a spawned
 * process, or an `import()` whose specifier is computed. Deliberately broad: a test that only reads
 * back its own temp directory matches too, and running it when it was not needed costs seconds,
 * where missing a test that greps `src/` costs a round trip through CI.
 */
export const FS_ACCESS =
  /\b(?:readFileSync|readdirSync|readFile|readdir|opendirSync|globSync|existsSync|statSync|spawnSync|spawn|execSync|execFileSync|execFile)\s*\(|\bBun\s*\.\s*(?:file|spawn|spawnSync|\$)\b|\bGlob\s*\(|\$`|import\.meta\.glob|\b(?:import|require)\(\s*(?!["'`)]|\/\*)/;

export interface TestGraph {
  /** Every node, repo-relative POSIX path → the nodes it imports. */
  imports: Map<string, Set<string>>;
  /** The inverse of {@link imports}. */
  importers: Map<string, Set<string>>;
  /** Workspace dir → its test files. */
  tests: Map<string, string[]>;
  /** Test file → why it runs whenever its workspace is selected. */
  opaque: Map<string, string>;
  /** Importer → the relative specifiers in it that resolve to nothing. */
  broken: Map<string, string[]>;
}

export interface GraphOptions {
  root: string;
  /**
   * Helpers that match {@link FS_ACCESS} and are known to read only paths the workspace gate
   * already tracks. A test is not opaque merely for importing one. Each entry says what it reads.
   */
  declaredReaders?: Record<string, string>;
}

type Loader = "ts" | "tsx" | "js" | "jsx";

const transpilers = new Map<Loader, Bun.Transpiler>();

function loaderFor(path: string): Loader {
  if (path.endsWith("x")) {
    return path.endsWith(".tsx") ? "tsx" : "jsx";
  }
  return /\.[cm]?ts$/.test(path) ? "ts" : "js";
}

/** The literal specifiers a module names, in any import form. */
export function specifiersOf(source: string, path: string): string[] {
  const loader = loaderFor(path);
  let transpiler = transpilers.get(loader);
  if (!transpiler) {
    transpiler = new Bun.Transpiler({ loader });
    transpilers.set(loader, transpiler);
  }
  return transpiler.scanImports(source).map((i) => i.path);
}

/**
 * True when a module is erased entirely at run time: interfaces and type aliases, nothing else. No
 * test can load anything from such a file, so a change to it is `tsc`'s to judge and no suite's.
 */
export function isTypeOnly(source: string, path: string): boolean {
  if (!/\.[cm]?tsx?$/.test(path)) {
    return false;
  }
  try {
    return new Bun.Transpiler({ loader: loaderFor(path) }).transformSync(source).trim() === "";
  } catch {
    return false;
  }
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/** The test files `bun test` would collect under a workspace. */
export function testFilesOf(root: string, dir: string): string[] {
  const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}");
  const found: string[] = [];
  for (const file of glob.scanSync({ cwd: join(root, dir), followSymlinks: false })) {
    const path = toPosix(file);
    if (TEST_FILE.test(path) && !/(?:^|\/)(?:node_modules|dist|result|coverage)\//.test(path)) {
      found.push(`${dir}/${path}`);
    }
  }
  return found.toSorted();
}

/** The modules a workspace's bunfig loads before every test file, as written. */
export function preloadsOf(root: string, dir: string): string[] {
  const bunfig = join(root, dir, "bunfig.toml");
  if (!existsSync(bunfig)) {
    return [];
  }
  const parsed = Bun.TOML.parse(readFileSync(bunfig, "utf8"));
  const test = "test" in parsed ? parsed.test : undefined;
  const preload = isJsonObject(test) ? test.preload : undefined;
  if (isString(preload)) {
    return [preload];
  }
  return Array.isArray(preload) ? preload.filter((entry) => isString(entry)) : [];
}

export function buildTestGraph(workspaces: Workspace[], options: GraphOptions): TestGraph {
  const root = realpathSync(options.root);
  const declared = options.declaredReaders ?? {};
  const graph: TestGraph = {
    imports: new Map(),
    importers: new Map(),
    tests: new Map(),
    opaque: new Map(),
    broken: new Map(),
  };
  /** Nodes whose own text matches FS_ACCESS. */
  const readers = new Set<string>();

  /** Repo-relative path of a resolved module, or undefined when it is not ours to track. */
  const resolveFrom = (specifier: string, importer: string): string | undefined | null => {
    let resolved: string;
    try {
      resolved = Bun.resolveSync(specifier, dirname(join(root, importer)));
    } catch {
      // A relative specifier that names nothing is a deleted or renamed module. A bare one is an
      // Optional peer or a virtual module, which no change in this repository can move.
      return specifier.startsWith(".") ? null : undefined;
    }
    if (!resolved.startsWith("/") && !/^[A-Za-z]:/.test(resolved)) {
      return undefined; // A builtin: `node:fs`, `bun:test`.
    }
    const real = toPosix(relative(root, realpathSync(resolved)));
    if (real.startsWith("..") || /(?:^|\/)node_modules\//.test(real)) {
      return undefined;
    }
    return real;
  };

  const link = (from: string, to: string): void => {
    graph.imports.get(from)!.add(to);
    let back = graph.importers.get(to);
    if (!back) {
      back = new Set();
      graph.importers.set(to, back);
    }
    back.add(from);
  };

  const visit = (start: string): void => {
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (graph.imports.has(node)) {
        continue;
      }
      graph.imports.set(node, new Set());
      if (!CODE_FILE.test(node)) {
        continue;
      }
      const source = readFileSync(join(root, node), "utf8");
      if (FS_ACCESS.test(source)) {
        readers.add(node);
      }
      let specifiers: string[];
      try {
        specifiers = specifiersOf(source, node);
      } catch {
        // Unparseable: its importers still reach it, and a change to it still selects them.
        continue;
      }
      for (const specifier of specifiers) {
        const target = resolveFrom(specifier, node);
        if (target === null) {
          const list = graph.broken.get(node) ?? [];
          list.push(specifier);
          graph.broken.set(node, list);
        } else if (target !== undefined) {
          link(node, target);
          stack.push(target);
        }
      }
    }
  };

  for (const workspace of workspaces) {
    const tests = testFilesOf(root, workspace.dir);
    graph.tests.set(workspace.dir, tests);
    const preloads: string[] = [];
    for (const specifier of preloadsOf(root, workspace.dir)) {
      // Resolved as though the workspace's own package.json named it, which is how Bun reads it.
      const target = resolveFrom(specifier, `${workspace.dir}/bunfig.toml`);
      if (target) {
        preloads.push(target);
      }
    }
    for (const test of tests) {
      visit(test);
      for (const preload of preloads) {
        visit(preload);
        link(test, preload);
      }
    }
  }

  // A test is opaque when it, or a helper it imports from outside any `src/`, can read a file the
  // Graph does not know about. `src/` modules are exempt on purpose: what a source module reads at
  // Run time is either a path its caller hands it or a data file beside it, and the second is covered
  // By the unknown-file rule. A helper under `tests/` or `scripts/` that scans the tree is not.
  const isSource = (path: string): boolean => /(?:^|\/)src\//.test(path);
  for (const tests of graph.tests.values()) {
    for (const test of tests) {
      const seen = new Set([test]);
      const stack = [test];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (readers.has(node) && !(node in declared)) {
          graph.opaque.set(test, node === test ? "reads the filesystem" : `imports ${node}`);
          break;
        }
        for (const next of graph.imports.get(node) ?? []) {
          if (!seen.has(next) && !isSource(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
    }
  }

  return graph;
}

/** Every test file that reaches any of `files` through the import graph. */
export function testsReaching(graph: TestGraph, files: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [...files];
  const found = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) {
      continue;
    }
    seen.add(node);
    if (TEST_FILE.test(node) && graph.imports.has(node)) {
      found.add(node);
    }
    for (const importer of graph.importers.get(node) ?? []) {
      stack.push(importer);
    }
  }
  return found;
}

/** Absolute path of the repository root, from any file under `scripts/`. */
export function repoRoot(): string {
  return resolve(import.meta.dir, "../..");
}
