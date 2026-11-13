/**
 * Runs the tests a working diff can fail, and no others. `bun run test:affected`.
 *
 * The full suite is ~1,240 test files, and until this existed the only local command that knew
 * which of them a change could reach was none: `scripts/ci/affected.ts` narrowed CI to the affected
 * WORKSPACES, while a local run (and the agent push gate, `bun run all-the-things`) ran every
 * workspace every time. This brings the workspace gate to the working tree and then narrows each
 * selected workspace to the test files whose import graph reaches a changed file
 * (`lib/test-selection.ts` has the rules, and the cases where it refuses to narrow).
 *
 * What it is NOT is a gate. Two things keep it a fast signal:
 *
 * - A partial run cannot be held to a per-file `coverageThreshold`: a file loaded by three of the
 *   thirty tests that exercise it reads as uncovered. So this runs without `--coverage`, and CI's
 *   `test` matrix stays a whole-workspace coverage run.
 * - The selection has one known hole (a source module loading code by a computed specifier; see
 *   `lib/test-selection.ts`), and CI's whole-workspace run is what stands behind it.
 *
 * Measured by replaying the last 100 commits on `main`: file-level narrowing kept 84% of the test
 * files the workspace gate had already selected, and 87% of studio's. About 400 of studio's 646
 * test files mount through `tests/harness.ts` and genuinely load most of the application (one of
 * them was checked against Bun's own module cache: 735 modules loaded, every one in its static
 * closure), so for a change to that core "the tests that load it" is most of them. That is why CI's
 * pull-request lane was NOT moved to this: it would trade the per-file coverage gate for about a
 * sixth of the test files. Against a local run of every workspace the saving is larger, 63% of the
 * files over the same commits, because most of it is the workspace gate arriving locally.
 *
 *     bun run test:affected                 # merge base with origin/main → working tree, + untracked
 *     bun run test:affected --base HEAD~1   # a different base
 *     bun run test:affected --staged        # only what is staged
 *     bun run test:affected --list          # print the selection, run nothing
 *     git diff --name-only A B | bun scripts/test-affected.ts --stdin --list
 *     bun run test:affected -- --bail       # everything after `--` goes to `bun test`
 */

import { relative } from "node:path";
import { buildTestGraph, repoRoot } from "./lib/test-graph.ts";
import { DECLARED_READERS, selectTests } from "./lib/test-selection.ts";
import type { Selection } from "./lib/test-selection.ts";
import { readWorkspaces } from "./lib/workspaces.ts";

export interface Options {
  base: string | undefined;
  staged: boolean;
  stdin: boolean;
  list: boolean;
  passthrough: string[];
}

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    base: undefined,
    staged: false,
    stdin: false,
    list: false,
    passthrough: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--") {
      options.passthrough = argv.slice(i + 1);
      break;
    } else if (arg === "--base") {
      i += 1;
      options.base = argv[i];
      if (options.base === undefined) {
        throw new Error("--base needs a ref");
      }
    } else if (arg === "--staged") {
      options.staged = true;
    } else if (arg === "--stdin") {
      options.stdin = true;
    } else if (arg === "--list") {
      options.list = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function git(root: string, ...args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  return result.exitCode === 0 ? result.stdout.toString() : undefined;
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The changed paths, or undefined when they cannot be determined — which the caller turns into a
 * full run, never an empty one.
 */
export async function changedPaths(root: string, options: Options): Promise<string[] | undefined> {
  if (options.stdin) {
    return lines(await Bun.stdin.text());
  }
  if (options.staged) {
    const staged = git(root, "diff", "--name-only", "--cached");
    return staged === undefined ? undefined : lines(staged);
  }
  let { base } = options;
  if (base === undefined) {
    // `origin/main` first: a local `main` that has not been pulled is behind the branch point and
    // Would over-select, which is safe but wasteful. No remote at all still leaves local `main`.
    for (const candidate of ["origin/main", "main"]) {
      const mergeBase = git(root, "merge-base", candidate, "HEAD");
      if (mergeBase !== undefined) {
        base = mergeBase.trim();
        break;
      }
    }
  }
  if (base === undefined) {
    return undefined;
  }
  // One-sided on purpose: `git diff <base>` compares the base to the WORKING TREE, so committed,
  // Staged and unstaged edits all count, and an agent mid-task tests what is actually on disk.
  const tracked = git(root, "diff", "--name-only", base);
  const untracked = git(root, "ls-files", "--others", "--exclude-standard");
  if (tracked === undefined || untracked === undefined) {
    return undefined;
  }
  return [...new Set([...lines(tracked), ...lines(untracked)])];
}

/** The `bun test` argument vector for one selection, relative to the workspace it runs in. */
export function commandFor(selection: Selection, passthrough: string[]): string[] {
  const files =
    selection.mode === "all"
      ? []
      : // A leading `./` makes each argument a path. Bare, it is a substring filter, and
        // `tests/tab.test.ts` would also collect `tests/grid-tab.test.ts`.
        selection.files.map((file) => `./${relative(selection.dir, file)}`);
  return ["test", "--isolate", ...passthrough, ...files];
}

export function describeSelections(selections: Selection[], everything: number): string[] {
  const out: string[] = [];
  const width = Math.max(0, ...selections.map((s) => s.dir.length));
  let selected = 0;
  for (const selection of selections) {
    selected += selection.files.length;
    const count = `${selection.files.length}/${selection.total}`.padStart(9);
    const mode = selection.mode === "all" ? "whole suite: " : "";
    out.push(`  ${selection.dir.padEnd(width)} ${count}  ${mode}${selection.reason}`);
  }
  out.push(`  ${selected} of ${everything} test files`);
  return out;
}

async function main(): Promise<number> {
  const options = parseArgs(Bun.argv.slice(2));
  const root = repoRoot();
  // `readWorkspaces()` and the workspace gate's anchors are relative to the repository root.
  process.chdir(root);
  const workspaces = await readWorkspaces();
  const graph = buildTestGraph(workspaces, { root, declaredReaders: DECLARED_READERS });
  const everything = [...graph.tests.values()].reduce((sum, tests) => sum + tests.length, 0);

  const changed = await changedPaths(root, options);
  let selections: Selection[];
  if (changed === undefined) {
    console.error("test:affected: could not determine the diff, so every workspace runs whole.");
    selections = workspaces.map((w) => {
      const files = graph.tests.get(w.dir) ?? [];
      return {
        dir: w.dir,
        mode: "all",
        files,
        opaque: 0,
        total: files.length,
        reason: "no diff",
      };
    });
  } else if (changed.length === 0) {
    console.error("test:affected: nothing changed, so nothing to run.");
    return 0;
  } else {
    selections = selectTests(changed, workspaces, graph, root);
  }

  console.error(`test:affected: ${changed?.length ?? "unknown"} changed path(s)`);
  for (const line of describeSelections(selections, everything)) {
    console.error(line);
  }
  if (options.list) {
    for (const selection of selections) {
      for (const file of selection.files) {
        console.log(file);
      }
    }
    return 0;
  }

  // `scripts/` is not a workspace, and its suites read the tree as data (agent notes, workflows,
  // Release config), so no graph can say which of them a path reaches. They take seconds: always run.
  const runs: { label: string; cwd: string; argv: string[] }[] = [
    { label: "scripts", cwd: root, argv: ["test", "--isolate", ...options.passthrough, "scripts"] },
    ...selections
      .filter((selection) => selection.files.length > 0)
      .map((selection) => ({
        label: selection.dir,
        cwd: `${root}/${selection.dir}`,
        argv: commandFor(selection, options.passthrough),
      })),
  ];

  const failed: string[] = [];
  for (const run of runs) {
    console.error(`\n── ${run.label} ${"─".repeat(Math.max(0, 70 - run.label.length))}`);
    const child = Bun.spawn([process.execPath, ...run.argv], {
      cwd: run.cwd,
      stdio: ["inherit", "inherit", "inherit"],
    });
    if ((await child.exited) !== 0) {
      failed.push(run.label);
    }
  }

  if (failed.length > 0) {
    console.error(`\ntest:affected: FAILED in ${failed.join(", ")}`);
    return 1;
  }
  console.error(`\ntest:affected: ${runs.length} suite(s) passed`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
