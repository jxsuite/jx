#!/usr/bin/env bun
/**
 * Cli.js — entrypoint for the AI-assistant eval harness.
 *
 * Usage: `bun run evals/cli.js [--tasks <glob-or-path>...] [--k <n>]`
 *
 * Loads golden tasks, runs each through the real agent loop `k` times, grades with the render
 * critic (+ schema baseline), and writes a timestamped run under evals/runs/. Exits non-zero when a
 * task regresses vs the previous run so it can gate CI.
 *
 * Requires OPENAI_API_KEY (OPENAI_BASE_URL / OPENAI_MODEL optional) — the harness calls the real
 * model, mirroring packages/server/src/ai-api.js config resolution.
 *
 * @license MIT
 */

import { useNativeFetch } from "../tests/harness/native-fetch.ts";
import "../tests/with-dom.ts";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { runTask, resolveConfig } from "./runner.js";
import type { Task } from "./runner.js";
import { writeRun } from "./scoreboard.js";

// The provider is reached as a server reaches it: happy-dom's fetch would apply CORS to it.
useNativeFetch();

const TASKS_DIR = join(import.meta.dir, "tasks");

/** The command line, parsed: which tasks to run, and how many trials each gets. */
interface CliArgs {
  tasks: string[];
  k: number;
}

/** Parse `--tasks a b --k 3` style args. */
function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { tasks: [], k: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--k") {
      i += 1;
      out.k = Number(argv[i]) || 3;
    } else if (argv[i] === "--tasks") {
      for (
        let next = argv[i + 1];
        next !== undefined && !next.startsWith("--");
        next = argv[i + 1]
      ) {
        i += 1;
        out.tasks.push(next);
      }
    }
  }
  return out;
}

/** Resolve task files: explicit paths/ids, or every *.json in tasks/. */
function loadTasks(selectors: string[]): Task[] {
  const files =
    selectors.length > 0
      ? selectors.map((s) => {
          if (isAbsolute(s)) {
            return s;
          }
          if (s.endsWith(".json")) {
            return join(process.cwd(), s);
          }
          return join(TASKS_DIR, `${s}.json`); // Bare id
        })
      : readdirSync(TASKS_DIR)
          .filter((f) => f.endsWith(".json"))
          .map((f) => join(TASKS_DIR, f));
  /* SAFETY: every file read here is a golden task fixture, authored by hand to the `Task`
     interface (evals/tasks/*.json, or a path a developer names with --tasks). Nothing generates
     them, and one that drifts from the interface fails in its own trial, where the transcript shows
     it. */
  return files
    .filter((f) => existsSync(f) && statSync(f).isFile())
    .map((f) => JSON.parse(readFileSync(f, "utf8")) as Task);
}

/** ISO timestamp safe for a directory name (e.g. 20260618-141233). */
function stampNow() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

async function main() {
  const { tasks: selectors, k } = parseArgs(process.argv.slice(2));

  if (!resolveConfig().apiKey) {
    console.error("✗ OPENAI_API_KEY is not set — the harness needs a real model to run.");
    process.exit(2);
  }

  const tasks = loadTasks(selectors);
  if (tasks.length === 0) {
    console.error("✗ No tasks found. Add JSON tasks under evals/tasks/ or pass --tasks <path>.");
    process.exit(2);
  }

  console.log(`Running ${tasks.length} task(s) × k=${k} through the real agent loop…`);
  const results = [];
  for (const task of tasks) {
    const r = await runTask(task, { k });
    console.log(`  ${r.passAtK ? "✅" : "❌"} ${r.id}  rate=${(r.passRate * 100).toFixed(0)}%`);
    results.push(r);
  }

  /* A run in which no trial reached the model measured the endpoint, not the scaffolding. Written
     down, it would become the baseline the next run is diffed against, so it is refused instead. */
  const trials = results.flatMap((r) => r.trials);
  if (trials.every((t) => t.rounds === 0 && t.loopError !== null)) {
    console.error(
      `✗ No trial got a reply from the model: ${trials[0]?.loopError ?? "no trials ran"}`,
    );
    process.exit(2);
  }

  const { outDir, summary, regressed } = writeRun(results, { stamp: stampNow() });
  const { usage } = summary;
  const cacheHit = usage.cacheRatio === null ? "n/a" : `${(usage.cacheRatio * 100).toFixed(0)}%`;
  console.log(
    `\nMean pass-rate ${(summary.meanPassRate * 100).toFixed(0)}% · ` +
      `${usage.inputTokens} input tokens, ${cacheHit} from cache · report: ${join(outDir, "report.md")}`,
  );
  if (regressed.length > 0) {
    console.error(`✗ Regressions: ${regressed.join(", ")}`);
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
