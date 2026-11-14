/**
 * Time whole-site builds, phase by phase.
 *
 *     bun run bench:build [--only a,b] [--runs N] [--json <file>]
 *
 * For every project in the conformance corpus (scripts/conformance/corpus.ts) this measures two
 * builds a person actually waits for:
 *
 * - **cold**: the project's image cache is deleted first, so every variant is encoded.
 * - **warm**: the cache is full, so the build is everything but encoding. The median of `--runs`
 *   builds (default 3), because one build is one sample of a noisy machine.
 *
 * Each is reported with the phases `buildSite` divides its own time into (`BuildTimings`), which is
 * what tells a slow compiler from slow content loading: `content` is extension code the compiler
 * only waits for, and the rest is the compiler's own.
 *
 * It is a measurement, not a gate. Numbers from one machine say nothing about another, so nothing
 * compares a run against a committed figure; a change that claims to make builds faster runs this
 * before and after on the same machine and reports both. There is no "one file edited" case yet
 * because every build is a full build (site-architecture.md §12.3): it would measure `warm` again.
 */

import { rmSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import { getImageCacheDir } from "../packages/compiler/src/site/image-cache.ts";
import { buildSite } from "../packages/compiler/src/site/site-build.ts";
import { corpus, leaveAsFound, selectProjects } from "./conformance/corpus.ts";
import type { BuildPhase, BuildTimings } from "../packages/compiler/src/site/site-build.ts";

const REPO = resolve(import.meta.dir, "..");

/** The phases, in the order a build runs them and a table shows them. */
export const PHASES: readonly BuildPhase[] = [
  "setup",
  "content",
  "components",
  "routes",
  "bundles",
  "outputs",
];

/** One project's measurements. */
export interface ProjectResult {
  project: string;
  routes: number;
  errors: number;
  cold: BuildTimings;
  warm: BuildTimings;
}

/** The middle value of a list, or the mean of the two middle ones. An empty list has none. */
export function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  if (upper === undefined) {
    return Number.NaN;
  }
  return sorted.length % 2 === 0 && lower !== undefined ? (lower + upper) / 2 : upper;
}

/** The per-phase median of several builds' timings. */
export function medianTimings(runs: readonly BuildTimings[]): BuildTimings {
  const of = (name: BuildPhase | "total") => median(runs.map((run) => run[name]));
  return {
    bundles: of("bundles"),
    components: of("components"),
    content: of("content"),
    outputs: of("outputs"),
    routes: of("routes"),
    setup: of("setup"),
    total: of("total"),
  };
}

/** Milliseconds as seconds, to the precision a person compares builds at. */
function seconds(ms: number): string {
  return (ms / 1000).toFixed(2);
}

/** A Markdown table: one row per project and build, a column per phase, in seconds. */
export function table(results: readonly ProjectResult[]): string {
  const header = ["project", "routes", "build", "total", ...PHASES];
  const rows: string[][] = [];
  for (const result of results) {
    const name = result.errors > 0 ? `${result.project} (${result.errors} errors)` : result.project;
    for (const build of ["cold", "warm"] as const) {
      const phases = PHASES.map((phase) => seconds(result[build][phase]));
      rows.push([name, String(result.routes), build, seconds(result[build].total), ...phases]);
    }
  }
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(" | ")} |`;
  const rule = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  return [line(header), rule, ...rows.map((row) => line(row))].join("\n");
}

/** Run `work` with the build's own chatter silenced; its warnings are not what is being read. */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const { error, log, warn } = console;
  const silent = () => {};
  Object.assign(console, { error: silent, log: silent, warn: silent });
  try {
    return await work();
  } finally {
    Object.assign(console, { error, log, warn });
  }
}

async function measure(project: string, root: string, runs: number): Promise<ProjectResult> {
  // A project is built where it is, and is left without any output it did not already have.
  const restore = leaveAsFound(root);
  rmSync(getImageCacheDir(root), { force: true, recursive: true });
  const cold = await quietly(async () => buildSite(root, { clean: true }));
  const warm: BuildTimings[] = [];
  for (let run = 0; run < runs; run += 1) {
    const built = await quietly(async () => buildSite(root, { clean: true }));
    warm.push(built.timings);
  }
  restore();
  return {
    cold: cold.timings,
    errors: cold.errors.length,
    project,
    routes: cold.routes,
    warm: medianTimings(warm),
  };
}

function flag(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const runs = Math.max(1, Number(flag(args, "--runs") ?? 3));
  const projects = selectProjects(corpus(REPO), flag(args, "--only") ?? "");
  const results: ProjectResult[] = [];
  for (const project of projects) {
    results.push(await measure(project.id, join(REPO, project.dir), runs));
    console.error(`measured ${project.id}`);
  }
  console.log(table(results));
  const machine = {
    bun: Bun.version,
    cpus: cpus().length,
    platform: `${process.platform}-${process.arch}`,
  };
  console.log(
    `\n${machine.cpus} CPUs, ${machine.platform}, Bun ${machine.bun}, warm = median of ${runs}`,
  );
  const out = flag(args, "--json");
  if (out) {
    await Bun.write(out, `${JSON.stringify({ machine, results, runs }, null, 2)}\n`);
  }
}
