/**
 * Perf tracing for Jx Studio user interactions.
 *
 * Launches headless Chrome, drives the studio through `window.__jxAutomation` (the app's own
 * command projection — the same paths a user hits), and records a DevTools timeline per scenario.
 * Output: scripts/perf/out/traces.json + a printed summary.
 *
 * Usage: bun scripts/perf/trace-studio.ts [--url <studio-url>] [--scen boot,palette] [--reps N]
 */

import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { JsonObject } from "@jxsuite/schema/types";

import { mapSources } from "./sources.ts";

import { analyze } from "./analysis";
import type { Analysis } from "./analysis";

/* Resolved from THIS file's own location rather than a fixed home-directory path, so the same
 * default works on any checkout — a contributor's machine, a fresh clone, or CI's container,
 * where neither the checkout path nor `$HOME` match a developer's local layout. */
const DEFAULT_PROJECT = resolve(import.meta.dir, "../../sites/jxsuite.com/project.json");
const DEFAULT_URL = `http://127.0.0.1:3000/packages/studio/index.html?project=${encodeURIComponent(DEFAULT_PROJECT)}&automation=1`;

/* The binary is overridable via `--chrome` or `CHROME_BIN`: CI hands the container Chrome for
 * Testing over, and NixOS installs it under another name.
 */
const CHROME_BIN = (() => {
  const argvIdx = Bun.argv.indexOf("--chrome");
  if (argvIdx !== -1) {
    return Bun.argv[argvIdx + 1]!;
  }
  return process.env.CHROME_BIN ?? "google-chrome-stable";
})();

const CATEGORIES = [
  "devtools.timeline",
  "toplevel",
  "v8.execute",
  "disabled-by-default-devtools.timeline.stack",
  "disabled-by-default-devtools.timeline.invalidationTracking",
  "disabled-by-default-v8.cpu_profiler",
];

/**
 * Below this baseline (ms), a percentage comparison is noise rather than a signal.
 *
 * `--compare`'s rule is `pct > 20 && freshValue - oldValue > 25`, which assumes both sides of the
 * comparison are large enough for a percentage to mean anything. A sub-1ms baseline breaks that
 * assumption: `grid-edit`'s tracked `scriptingMs` was 0.7, so a perfectly ordinary rep that spent a
 * few tens of milliseconds on real scripting — GC timing, a slower CI neighbor, one extra reflow —
 * read as a four-figure percentage and tripped the 25ms absolute floor at the same time, because
 * almost ANY real value clears both bars when the baseline is this close to zero. `wallMs` never
 * hits this (a scenario's wall clock is always at least tens of milliseconds), but `scriptingMs` /
 * `styleRecalcMs` / `layoutMs` on a light scenario legitimately can, so the floor applies to
 * whichever side of the pair is being judged, not just to `wallMs`.
 */
const MIN_BASELINE_MS = 5;

/** One metric's printed `--compare` cell, and whether it counts as a regression. */
export interface MetricComparison {
  cell: string;
  regressed: boolean;
}

/**
 * One metric's baseline-vs-fresh comparison: the printed cell, and whether it counts as a
 * regression. Exported so a test can hand it values without launching Chrome.
 */
export function compareMetric(oldValue: number, freshValue: number): MetricComparison {
  if (!oldValue) {
    return { cell: `n/a → ${freshValue}`, regressed: false };
  }
  const pct = Math.round(((freshValue - oldValue) / oldValue) * 100);
  const regressed = oldValue >= MIN_BASELINE_MS && pct > 20 && freshValue - oldValue > 25;
  return { cell: `${oldValue} → ${freshValue} (${pct > 0 ? "+" : ""}${pct}%)`, regressed };
}

/**
 * Move the tracer's own idle-probe cost out of `breakdown.scripting` and into `harnessMs`.
 *
 * `mapped` is `mapSources()`'s output for this analysis. Every frame that maps to
 * `src/services/idle.ts` is the harness's `probe.idle()` rAF poll, which runs inside the page being
 * measured but is not work a user's interaction causes. After this, `breakdown.scripting` is app
 * scripting, the only scripting number the baseline records or the gate judges.
 */
export function attributeHarness(r: Analysis, mapped: { file: string; totalMs: number }[]): void {
  let harness = 0;
  for (const f of mapped) {
    if (f.file.includes("/services/idle.ts")) {
      harness += f.totalMs;
    }
  }
  r.harnessMs = Number(harness.toFixed(1));
  r.breakdown.scripting = Number(Math.max(0, r.breakdown.scripting - r.harnessMs).toFixed(1));
}

/**
 * One scenario's row in `baseline.json`. `scriptingMs` is app scripting; `harnessMs` is what
 * {@link attributeHarness} took out of it, kept for a reader and never gated on.
 */
export interface BaselineScenario {
  name: string;
  wallMs: number;
  scriptingMs: number;
  harnessMs: number;
  styleRecalcMs: number;
  styleRecalcCount: number;
  layoutMs: number;
  gcMs: number;
}

/**
 * What the metrics MEAN, as a number: bump it whenever `analysis.ts` changes how a gated metric is
 * counted. A baseline records the version it was captured under, and `--compare` gates only against
 * a baseline of the same version, because numbers from two definitions are not the same quantity.
 *
 * 1. Whole-event durations on tid 1 (the September 2026 baseline; it carries no version field).
 * 2. Main-thread SELF time on the thread named `CrRendererMain`, with `EventDispatch`, `TimerFire`,
 *    `RunMicrotasks` and `v8.*` counted as scripting.
 */
export const ANALYZER_VERSION = 2;

/** The `baseline.json` file `--write-baseline` writes and `--compare` reads back. */
export interface Baseline {
  updatedAt: string;
  /** {@link ANALYZER_VERSION} at capture; absent on a baseline older than the field (version 1). */
  analyzerVersion?: number;
  scenarios: BaselineScenario[];
}

/** The trend run's report, and whether it fails the run. */
export interface TrendReport {
  markdown: string;
  fail: boolean;
}

/**
 * The `--compare` report: every scenario traced, against its baseline row.
 *
 * A baseline captured under another {@link ANALYZER_VERSION} is printed for a reader and never
 * gates: a red there would be the definition changing, not the code, and a pass would be the old
 * definition's slack. A scenario the baseline has no row for is listed as such rather than skipped,
 * so a scenario added since the baseline was captured is visibly unjudged until one is adopted.
 */
export function trendReport(
  baseline: Baseline,
  results: readonly Analysis[],
  path: string,
): TrendReport {
  const version = baseline.analyzerVersion ?? 1;
  const gating = version === ANALYZER_VERSION;
  let regression = false;
  const lines = [
    `### Studio perf: trend vs ${path} (recorded ${baseline.updatedAt}, analyzer v${version})`,
    "",
  ];
  if (!gating) {
    lines.push(
      `**Report only**: the baseline was captured under analyzer v${version} and this run measures v${ANALYZER_VERSION}, so the two are not the same quantity. Adopt this run's \`baseline.json\` artifact to gate again.`,
      "",
    );
  }
  lines.push(
    "| scenario | wall | scripting | styleRecalc | layout |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const now of results) {
    const base = baseline.scenarios.find((row) => row.name === now.scenario);
    if (!base) {
      lines.push(`| ${now.scenario} | not in baseline | | | |`);
      continue;
    }
    const { cells, regressed } = compareScenario(base, now);
    regression ||= regressed;
    lines.push(`| ${now.scenario} | ${cells.join(" | ")} |`);
  }
  if (regression) {
    lines.push(
      "",
      gating
        ? "REGRESSION: at least one metric grew by more than 20% against the baseline"
        : "Growth past 20% is shown above, but it does not fail a report-only run.",
    );
  }
  return { markdown: `${lines.join("\n")}\n`, fail: gating && regression };
}

/** The row `--write-baseline` records for an analysis {@link attributeHarness} has already seen. */
export function baselineScenario(r: Analysis): BaselineScenario {
  return {
    name: r.scenario,
    wallMs: r.wallMs,
    scriptingMs: r.breakdown.scripting,
    harnessMs: r.harnessMs,
    styleRecalcMs: r.styleRecalc.time,
    styleRecalcCount: r.styleRecalc.count,
    layoutMs: r.layout.time,
    gcMs: r.gcMs,
  };
}

/** One scenario's printed `--compare` cells, and whether any of its metrics regressed. */
export interface ScenarioComparison {
  cells: string[];
  regressed: boolean;
}

/**
 * One scenario's `--compare` row: its printed cells, and whether any metric regressed.
 *
 * Scripting is app scripting on both sides, the unit {@link baselineScenario} records and
 * `REPORT.md` promises. This used to add `harnessMs` back to the fresh side, which made the probe's
 * own wait a gated metric: on a busy runner one rAF poll can bill 70ms to a rep, so `palette-files`
 * read 8.8 → 72.8ms of scripting when its app scripting was 2.5ms, and failed a run whose code had
 * passed four minutes earlier (#403).
 */
export function compareScenario(
  base: Pick<BaselineScenario, "wallMs" | "scriptingMs" | "styleRecalcMs" | "layoutMs">,
  now: Analysis,
): ScenarioComparison {
  let regressed = false;
  const cells: string[] = [];
  const pairs: [number, number][] = [
    [base.wallMs, now.wallMs],
    [base.scriptingMs, now.breakdown.scripting],
    [base.styleRecalcMs, now.styleRecalc.time],
    [base.layoutMs, now.layout.time],
  ];
  for (const [oldValue, freshValue] of pairs) {
    const metric = compareMetric(oldValue, freshValue);
    regressed ||= metric.regressed;
    cells.push(metric.cell);
  }
  return { cells, regressed };
}

// ─── Same-runner A/B gate ────────────────────────────────────────────────────

/**
 * The four metrics both gates judge, in the order every table prints them. `wallMs` is the
 * interaction's wall clock; the other three are main-thread self time (`analysis.ts`).
 */
export const GATED_METRICS = ["wallMs", "scriptingMs", "styleRecalcMs", "layoutMs"] as const;
export type GatedMetric = (typeof GATED_METRICS)[number];

/** One repetition's gated metrics, plus its longest main-thread task (budgeted, never compared). */
export type RepMetrics = Record<GatedMetric, number> & { longTaskMs: number };

/** The numbers a repetition contributes, read off an analysis {@link attributeHarness} has seen. */
export function metricsOf(r: Analysis): RepMetrics {
  return {
    wallMs: r.wallMs,
    scriptingMs: r.breakdown.scripting,
    styleRecalcMs: r.styleRecalc.time,
    layoutMs: r.layout.time,
    longTaskMs: r.longTasks.length > 0 ? Math.max(...r.longTasks) : 0,
  };
}

/** The median of a non-empty sample (the mean of the two middle values when its size is even). */
export function median(xs: readonly number[]): number {
  const sorted = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The exact null distribution of the Mann-Whitney U statistic for samples of size `n` and `m`:
 * `counts[u]` is how many of the C(n+m, n) equally likely orderings give U = u. The recurrence
 * places the largest observation: from the first sample it beats all `m` of the second (U grows by
 * m), from the second it beats nothing.
 */
function uCounts(n: number, m: number): number[] {
  // Row i, column j is the distribution for sizes (i, j); built one row at a time.
  let prev: number[][] = Array.from({ length: m + 1 }, () => [1]);
  for (let i = 1; i <= n; i++) {
    const row: number[][] = [[1]];
    for (let j = 1; j <= m; j++) {
      const out = Array.from<number>({ length: i * j + 1 }).fill(0);
      const fromFirst = prev[j]!;
      const fromSecond = row[j - 1]!;
      for (let u = 0; u < fromFirst.length; u++) {
        out[u + j]! += fromFirst[u]!;
      }
      for (let u = 0; u < fromSecond.length; u++) {
        out[u]! += fromSecond[u]!;
      }
      row.push(out);
    }
    prev = row;
  }
  return prev[m]!;
}

/**
 * The one-sided exact Mann-Whitney p-value that `head` is stochastically GREATER than `base`: the
 * probability, were both samples drawn from one distribution, of a U at least as large as the one
 * observed. U counts the (head, base) pairs where head is larger, a tie counting one half.
 *
 * Ties make U a half-integer, and the exact table is tie-free, so the observed U is rounded DOWN
 * before the tail is summed. That can only grow the p-value: a tie never makes the gate stricter.
 */
export function mannWhitneyGreater(head: readonly number[], base: readonly number[]): number {
  if (head.length === 0 || base.length === 0) {
    return 1;
  }
  let u = 0;
  for (const h of head) {
    for (const b of base) {
      u += h > b ? 1 : h === b ? 0.5 : 0;
    }
  }
  const counts = uCounts(head.length, base.length);
  const total = counts.reduce((a, b) => a + b, 0);
  let tail = 0;
  for (let k = Math.floor(u); k < counts.length; k++) {
    tail += counts[k]!;
  }
  return tail / total;
}

/** A head median must exceed base's by this factor before anything else is asked. */
export const AB_RATIO = 1.2;
/** ...and by at least this many milliseconds, so a 2 ms → 3 ms move on a tiny metric never fires. */
export const AB_FLOOR_MS = 25;
/** ...and the reps must separate at this one-sided Mann-Whitney level. */
export const AB_ALPHA = 0.05;
/**
 * The fewest repetitions per side the A/B gate accepts. At three per side the smallest p-value the
 * exact test can produce is 1/20 = 0.05, which never clears {@link AB_ALPHA}, so a run that small
 * could not fail and would be a gate in name only. Four per side reaches 1/70.
 */
export const MIN_AB_REPS = 4;
/** Repetitions per side by default: five per side gives a smallest attainable p of 1/252. */
export const DEFAULT_AB_REPS = 5;

/** One side's repetitions of one metric, summarised. */
export interface SideStats {
  median: number;
  min: number;
  max: number;
  reps: number[];
}

function sideStats(reps: readonly number[]): SideStats {
  return {
    median: Number(median(reps).toFixed(1)),
    min: Math.min(...reps),
    max: Math.max(...reps),
    reps: [...reps],
  };
}

/** One metric's A/B verdict. `ratio` is null where base's median is zero. */
export interface ABComparison {
  metric: GatedMetric;
  base: SideStats;
  head: SideStats;
  ratio: number | null;
  p: number;
  regressed: boolean;
}

/**
 * Compare one metric's repetitions on the base build against the same metric's repetitions on the
 * head build, both traced on the same runner in one interleaved session.
 *
 * A regression needs all four of:
 *
 * 1. Base's median at least {@link MIN_BASELINE_MS}. The same floor the absolute gate keeps: below it
 *    a ratio is noise, and `wallMs` (never that small) still guards the scenario.
 * 2. Head's median above base's by more than {@link AB_RATIO} (20%): a change worth a reviewer's time.
 * 3. ...and by more than {@link AB_FLOOR_MS} absolute: a change a person could feel.
 * 4. The two samples separate: a one-sided exact Mann-Whitney U test, p < {@link AB_ALPHA}.
 *
 * Why Mann-Whitney rather than "outside the spread" or a t-test: interaction timings are
 * right-skewed and carry the occasional outlier repetition (a GC, a neighbour's burst on the
 * runner). A rank test makes no normality assumption, uses every repetition rather than only the
 * two medians, and one wild repetition moves U by at most one sample's worth, so a single outlier
 * on either side can neither manufacture a regression nor hide one. "Every head rep above every
 * base rep" is the same test at its strictest level, which at five reps per side is p = 1/252; the
 * 0.05 level tolerates a few crossings, so a real regression with one noisy rep still fails. The
 * test is exact (the full U distribution is enumerated), so it is honest at the small sample sizes
 * a CI time budget allows. Conditions 1 to 3 are practical significance; condition 4 is
 * statistical.
 */
export function compareAB(
  metric: GatedMetric,
  baseReps: readonly number[],
  headReps: readonly number[],
): ABComparison {
  const base = sideStats(baseReps);
  const head = sideStats(headReps);
  const ratio = base.median > 0 ? Number((head.median / base.median).toFixed(2)) : null;
  const p = Number(mannWhitneyGreater(headReps, baseReps).toFixed(4));
  const regressed =
    base.median >= MIN_BASELINE_MS &&
    head.median > base.median * AB_RATIO &&
    head.median - base.median > AB_FLOOR_MS &&
    p < AB_ALPHA;
  return { metric, base, head, ratio, p, regressed };
}

/**
 * Which build goes first in repetition `rep`. Alternating (base, head), (head, base) means neither
 * side always runs right after the other's work, so a cache, a GC debt or a thermal trend that one
 * rep leaves behind is billed to both sides equally rather than always to the same one.
 */
export function abOrder(rep: number): ["base", "head"] | ["head", "base"] {
  return rep % 2 === 0 ? ["base", "head"] : ["head", "base"];
}

/** An absolute ceiling for a scenario that has no base to compare against. */
export interface Budget {
  wallMs: number;
  longTaskMs: number;
}

/** `scripts/perf/budgets.json`: a default ceiling, and per-scenario overrides of either field. */
export interface BudgetFile {
  default: Budget;
  scenarios?: Record<string, Partial<Budget>>;
}

/** A head-only scenario's medians against its budget, and what (if anything) it exceeded. */
export interface BudgetCheck {
  wallMs: number;
  longTaskMs: number;
  violations: string[];
}

/** The ceiling that applies to one scenario. */
export function budgetFor(file: BudgetFile, scenario: string): Budget {
  return { ...file.default, ...file.scenarios?.[scenario] };
}

/**
 * The budget violations of a head-only scenario (one new in this change, or one that fails on the
 * base build): its median wall clock and its median longest task against {@link budgetFor}. Empty
 * when it is within budget.
 */
export function checkBudget(reps: readonly RepMetrics[], budget: Budget): BudgetCheck {
  const wallMs = Number(median(reps.map((r) => r.wallMs)).toFixed(1));
  const longTaskMs = Number(median(reps.map((r) => r.longTaskMs)).toFixed(1));
  const violations: string[] = [];
  if (wallMs > budget.wallMs) {
    violations.push(`wall ${wallMs}ms > ${budget.wallMs}ms`);
  }
  if (longTaskMs > budget.longTaskMs) {
    violations.push(`longest task ${longTaskMs}ms > ${budget.longTaskMs}ms`);
  }
  return { wallMs, longTaskMs, violations };
}

/** One scenario's outcome in an A/B run. */
export type ABScenarioResult =
  | { name: string; kind: "compared"; comparisons: ABComparison[] }
  | {
      name: string;
      kind: "head-only";
      reason: string;
      wallMs: number;
      longTaskMs: number;
      budget: Budget;
      violations: string[];
    }
  | { name: string; kind: "head-failed"; error: string }
  /* Base threw on a scenario BOTH builds declare: nothing was compared, so the gate cannot say the
     change is fine. A broken base build or an unresolvable base project lands here, loudly. */
  | { name: string; kind: "base-failed"; error: string }
  /* Head no longer declares the command the scenario needs: the scenario would otherwise vanish
     from the gate, so unregistering a command cannot quietly drop the scenarios that drive it. */
  | { name: string; kind: "head-missing"; requires: string };

/** An error's first line, at most 300 characters: what fits in one Markdown table cell. */
export function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").replaceAll("|", String.raw`\|`).slice(0, 300);
}

/**
 * Everything one scenario's repetitions produced in an A/B run, before it is judged: which build
 * declares the command it needs, what (if anything) each side threw, and each side's metrics.
 */
export interface ScenarioRun {
  name: string;
  /** The command the scenario needs, or `""` when it needs none. */
  requires: string;
  /** Whether head declares {@link requires} (true when there is none). */
  headHas: boolean;
  /** Whether base declares {@link requires} (true when there is none). */
  baseHas: boolean;
  /**
   * Why base cannot reach the state the scenario measures (a {@link ScenarioUnavailableError} from
   * its setup), or `""`. Not a failure: it is a missing feature, which is a missing command by
   * another route.
   */
  baseUnavailable: string;
  /** The first line of what head threw, or `""`. */
  headError: string;
  /** The first line of what base threw, or `""`. */
  baseError: string;
  base: readonly RepMetrics[];
  head: readonly RepMetrics[];
  budget: Budget;
}

/**
 * Judge one scenario's run. The order is the gate's contract:
 *
 * 1. Head lacks the required command → `head-missing` (fails): a scenario must not leave the gate
 *    because the build under review stopped declaring what drives it.
 * 2. Head threw → `head-failed` (fails).
 * 3. Base lacks the required command, or cannot reach the state the scenario measures
 *    ({@link ScenarioUnavailableError}) → `head-only`, held to the absolute budget: a new feature,
 *    or one base shows empty, has nothing to be compared with.
 * 4. Base threw on a scenario it declares → `base-failed` (fails): the downgrade to a budget is for a
 *    scenario base CANNOT run, never for one it broke on, or a broken base would pass the gate.
 * 5. Otherwise → `compared`, every gated metric through {@link compareAB}.
 */
export function classifyScenario(run: ScenarioRun): ABScenarioResult {
  const { name } = run;
  if (!run.headHas) {
    return { name, kind: "head-missing", requires: run.requires };
  }
  if (run.headError) {
    return { name, kind: "head-failed", error: run.headError };
  }
  if (!run.baseHas || run.baseUnavailable) {
    return {
      name,
      kind: "head-only",
      reason: run.baseHas
        ? `base cannot run it: ${run.baseUnavailable}`
        : `base has no ${run.requires}`,
      budget: run.budget,
      ...checkBudget(run.head, run.budget),
    };
  }
  if (run.baseError) {
    return { name, kind: "base-failed", error: run.baseError };
  }
  return {
    name,
    kind: "compared",
    comparisons: GATED_METRICS.map((metric) =>
      compareAB(
        metric,
        run.base.map((m) => m[metric]),
        run.head.map((m) => m[metric]),
      ),
    ),
  };
}

/**
 * The scenarios a `--scen` filter names, in {@link SCENARIOS} order; every scenario when it is
 * empty. Throws on a name no scenario has, so a typo cannot select nothing and report a pass.
 */
export function selectScenarios<S extends { name: string }>(
  filter: string,
  scenarios: readonly S[],
): S[] {
  if (!filter) {
    return [...scenarios];
  }
  const wanted = filter
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const known = new Set(scenarios.map((s) => s.name));
  const unknown = wanted.filter((name) => !known.has(name));
  if (unknown.length > 0 || wanted.length === 0) {
    throw new Error(
      `--scen ${filter}: no scenario named ${unknown.join(", ") || "(empty)"}; known: ${[...known].join(", ")}`,
    );
  }
  return scenarios.filter((s) => wanted.includes(s.name));
}

/**
 * Whether an A/B run fails the gate: a regression, a busted budget, a head scenario that threw or
 * lost its command, a base scenario that threw, or a run that judged nothing at all.
 */
export function abFailed(results: readonly ABScenarioResult[]): boolean {
  return (
    results.length === 0 ||
    results.some((r) =>
      r.kind === "compared"
        ? r.comparisons.some((c) => c.regressed)
        : r.kind === "head-only"
          ? r.violations.length > 0
          : true,
    )
  );
}

/** One `::error::` annotation per failing non-compared result, for the CI log. */
export function abAnnotations(results: readonly ABScenarioResult[]): string[] {
  return results.flatMap((r) => {
    if (r.kind === "head-failed") {
      return [`::error::perf scenario ${r.name}: head threw: ${r.error}`];
    }
    if (r.kind === "base-failed") {
      return [`::error::perf scenario ${r.name}: base threw, so nothing was compared: ${r.error}`];
    }
    if (r.kind === "head-missing") {
      return [`::error::perf scenario ${r.name}: head has no ${r.requires}, so it left the gate`];
    }
    return [];
  });
}

function statsCell(s: SideStats): string {
  return `${s.median} [${s.min}–${s.max}]`;
}

/** The A/B report as Markdown, for the console and for the CI job summary. */
export function abMarkdown(
  results: readonly ABScenarioResult[],
  meta: { reps: number; baseUrl: string; headUrl: string },
): string {
  const lines = [
    `### Studio perf: same-runner A/B (${meta.reps} interleaved reps per side)`,
    "",
    `Regression = head median > base median × ${AB_RATIO} AND > base + ${AB_FLOOR_MS} ms AND one-sided Mann-Whitney p < ${AB_ALPHA} (base median ≥ ${MIN_BASELINE_MS} ms). Cells are median [min–max] in ms.`,
    "",
    "| scenario | metric | base | head | head/base | p | verdict |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of results) {
    if (r.kind !== "compared") {
      continue;
    }
    for (const c of r.comparisons) {
      const verdict = c.regressed
        ? "**REGRESSED**"
        : c.base.median < MIN_BASELINE_MS
          ? "below floor"
          : "ok";
      lines.push(
        `| ${r.name} | ${c.metric} | ${statsCell(c.base)} | ${statsCell(c.head)} | ${c.ratio ?? "n/a"} | ${c.p} | ${verdict} |`,
      );
    }
  }
  const others = results.filter((r) => r.kind !== "compared");
  if (others.length > 0) {
    lines.push(
      "",
      "#### Not compared",
      "",
      "A scenario base cannot run (new in head) is held to an absolute budget; one that threw on either side, or that head no longer declares, fails.",
      "",
      "| scenario | why | wall (median) | longest task (median) | budget | verdict |",
      "| --- | --- | --- | --- | --- | --- |",
    );
    for (const r of others) {
      if (r.kind === "head-failed") {
        lines.push(`| ${r.name} | head threw | | | | **FAILED**: ${r.error.slice(0, 200)} |`);
      } else if (r.kind === "base-failed") {
        lines.push(
          `| ${r.name} | base threw on a scenario both builds declare | | | | **FAILED**: ${r.error.slice(0, 200)} |`,
        );
      } else if (r.kind === "head-missing") {
        lines.push(
          `| ${r.name} | head has no ${r.requires} | | | | **FAILED**: the scenario left the gate |`,
        );
      } else {
        lines.push(
          `| ${r.name} | ${r.reason} | ${r.wallMs} | ${r.longTaskMs} | wall ≤ ${r.budget.wallMs}, task ≤ ${r.budget.longTaskMs} | ${r.violations.length > 0 ? `**OVER BUDGET**: ${r.violations.join("; ")}` : "ok"} |`,
        );
      }
    }
  }
  lines.push(
    "",
    results.length === 0
      ? "**Result: FAIL**: no scenario was judged."
      : abFailed(results)
        ? "**Result: FAIL**: at least one regression, budget overrun, or scenario that failed or left the gate."
        : "**Result: pass**",
  );
  return `${lines.join("\n")}\n`;
}

/** One debuggable target from Chrome's `/json/list` DevTools HTTP endpoint. */
interface CdpTarget {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export class Cdp {
  private nextId = 1;
  private ws: WebSocket;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private events: { method: string; params: any }[] = [];
  private listeners = new Map<string, ((params: any) => void)[]>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(JSON.stringify(msg.error)));
          } else {
            p.resolve(msg.result);
          }
        }
      } else if (msg.method) {
        const fns = this.listeners.get(msg.method);
        if (fns?.length) {
          for (const fn of fns) {
            fn(msg.params);
          }
        } else {
          this.events.push({ method: msg.method, params: msg.params });
        }
      }
    });
  }

  static async connect(port: number) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    /* SAFETY: `/json/list` is Chrome's DevTools HTTP endpoint on the port this script launched it
     * with; it answers an array of target descriptors, each carrying `type`, `url` and
     * `webSocketDebuggerUrl`. */
    const list = (await response.json()) as CdpTarget[];
    const page =
      list.find((target) => target.type === "page" && target.url === "about:blank") ??
      list.find((target) => target.type === "page");
    if (!page) {
      throw new Error("no page target");
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((res, rej) => {
      const onOpen = () => {
        res();
      };
      const onError = () => {
        rej(new Error("websocket failed"));
      };
      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onError, { once: true });
    });
    const cdp = new Cdp(ws);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    return cdp;
  }

  send<T = any>(method: string, params?: JsonObject): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((onResult, onError) => {
      this.pending.set(id, { resolve: onResult, reject: onError });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, fn: (params: any) => void) {
    if (!this.listeners.has(method)) {
      this.listeners.set(method, []);
    }
    this.listeners.get(method)!.push(fn);
  }

  off(method: string, fn?: (params: any) => void) {
    if (fn) {
      const fns = this.listeners.get(method);
      if (fns) {
        const i = fns.indexOf(fn);
        if (i !== -1) {
          fns.splice(i, 1);
        }
      }
    } else {
      this.listeners.delete(method);
    }
  }

  eventsOf(method: string): any[] {
    return this.events.filter((e) => e.method === method).map((e) => e.params);
  }

  drain() {
    this.events = [];
  }

  close() {
    this.ws.close();
  }
}

async function launchChrome(userDataDir: string, port: number) {
  const proc = Bun.spawn(
    [
      CHROME_BIN,
      "--headless=new",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      // Chromium's own sandbox refuses to run as root (the CI container is `--user root`) and a
      // Container's default 64 MB /dev/shm is too small for Chrome's shared memory, so both
      // Guards are disabled here rather than left to crash the renderer on first navigation.
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  let stderr = "";
  void new Response(proc.stderr)
    .text()
    .then((text) => {
      stderr = text;
    })
    .catch(() => {});
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
      return proc;
    } catch {
      await Bun.sleep(250);
    }
  }
  proc.kill(9);
  throw new Error(`Chrome did not come up${stderr ? `:\n${stderr.slice(-2000)}` : ""}`);
}

/**
 * The `Runtime.evaluate` parameters for one harness expression.
 *
 * No `replMode`. Under it, Chrome wraps the completion value in a promise of its own, and
 * `awaitPromise` awaits only that wrapper: an expression whose value IS a promise answered `{}` at
 * once, its rejection never surfaced, and nothing waited for it. Every `runCommand` and every
 * `idle()` this harness ran was fire-and-forget for as long as the flag was there, so each trace
 * window closed a few CDP round trips after its first step, a scenario whose command threw (the
 * whole `panels` scenario, once its commands changed their arguments) still "passed", and the gated
 * numbers measured whatever happened to land in that window.
 */
export function evaluateParams(expression: string, awaitPromise: boolean): JsonObject {
  return { expression, awaitPromise, returnByValue: true };
}

async function evalJs(cdp: Cdp, expression: string, awaitPromise = false): Promise<any> {
  const r: any = await cdp.send("Runtime.evaluate", evaluateParams(expression, awaitPromise));
  if (r.exceptionDetails) {
    throw new Error(
      String(
        r.exceptionDetails.exception?.description ??
          JSON.stringify(r.exceptionDetails).slice(0, 300),
      ),
    );
  }
  return r.result.value;
}

async function waitFor(cdp: Cdp, expression: string, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evalJs(cdp, expression)) {
        return;
      }
    } catch {
      /* Mid-navigation */
    }
    await Bun.sleep(200);
  }
  throw new Error(`waitFor timed out: ${expression}`);
}

async function idle(cdp: Cdp) {
  /* Awaited, so a step's trace window holds the work it caused. A timeout is reported rather than
     thrown: the scenario's numbers are still real, they just include a busy tail. */
  const settled = await evalJs(
    cdp,
    `${withDeadline("__jxAutomation.probe.idle()", "idle()", COMMAND_DEADLINE_MS)}.then(() => '', (error) => String(error))`,
    true,
  );
  if (settled) {
    console.error(`[idle] ${String(settled).slice(0, 300)}`);
  }
}

/** How long one command (or one idle probe) may stay pending before the harness calls it hung. */
export const COMMAND_DEADLINE_MS = 30_000;

/**
 * A page-side promise expression raced against a deadline that rejects naming what hung.
 *
 * Without it a promise that never settles was reported as `{"code":-32000,"message":"Promise was
 * collected"}`: the inspector holds an awaited promise WEAKLY, so once nothing in the page can
 * settle it, V8 collects it and the evaluate fails with no word on which step it was. The deadline
 * timer holds the race strongly, so a hang is now an error that says which command it was and how
 * long it waited, and the timer is cleared the moment the promise settles.
 */
export function withDeadline(expression: string, label: string, deadlineMs: number): string {
  const message = JSON.stringify(`${label} did not settle within ${deadlineMs} ms`);
  return `((t) => Promise.race([Promise.resolve().then(() => ${expression}), new Promise((_, reject) => { t = setTimeout(() => reject(new Error(${message})), ${deadlineMs}); })]).finally(() => clearTimeout(t)))()`;
}

/**
 * The page-side expression that runs one command: from a timer task, not from the evaluate itself.
 *
 * `Runtime.evaluate` runs its expression inside the renderer's `Receive mojo message` task with no
 * `FunctionCall` or `v8.run` slice around it, so the trace gives that time no category: a command's
 * whole synchronous part (everything before its first `await`) was invisible to `scripting`. An 80
 * ms busy loop injected into `palette.open` moved the scenario's wall clock by 255 ms and its
 * scripting by nothing. Scheduling the call on a timer puts it under `TimerFire`, which is how work
 * a user's gesture causes arrives too (under an input task's `EventDispatch`). The whole chain runs
 * under {@link withDeadline}, so a command that never settles fails naming itself.
 */
export function commandExpression(
  id: string,
  args: JsonObject,
  deadlineMs = COMMAND_DEADLINE_MS,
): string {
  const run = `new Promise((resolve) => setTimeout(resolve, 0)).then(() => __jxAutomation.run(${JSON.stringify(id)}, ${JSON.stringify(args)}))`;
  return withDeadline(run, `command "${id}"`, deadlineMs);
}

async function runCommand(cdp: Cdp, id: string, args: JsonObject = {}) {
  await evalJs(cdp, commandExpression(id, args), true);
  await idle(cdp);
}

// ─── Trace capture ───────────────────────────────────────────────────────────

async function capture(cdp: Cdp, name: string, interactions: () => Promise<void>) {
  cdp.drain();
  await cdp.send("Tracing.start", { traceConfig: { includedCategories: CATEGORIES } });
  const t0 = performance.now();
  /* A scenario that throws still ends the trace: a session left tracing refuses the next
     `Tracing.start`, and the A/B run recovers from a failing scenario and carries on. */
  let failure: { error: unknown } | null = null;
  try {
    await interactions();
  } catch (error) {
    failure = { error };
  }
  const wall = performance.now() - t0;
  const done = new Promise<void>((res) => {
    cdp.on("Tracing.tracingComplete", () => {
      res();
    });
  });
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.tracingComplete");
  const raw = cdp.eventsOf("Tracing.dataCollected").flatMap((p: any) => p.value);
  cdp.drain();
  if (failure) {
    throw failure.error;
  }
  return { name, wall, events: raw };
}

// ─── Analysis ────────────────────────────────────────────────────────────────

// ─── Scenarios ───────────────────────────────────────────────────────────────

/**
 * One traced user path. `setup` runs before each repetition, untraced, so a scenario puts the app
 * in its own starting state instead of inheriting whatever the previous scenario left. `requires`
 * names a command the scenario cannot run without: a build that does not declare it (the A/B base,
 * a pre-workspaces checkout) skips the scenario by name rather than tracing something else.
 */
export interface Scenario {
  name: string;
  describe: string;
  requires?: string;
  /** Untraced preparation. `url` is the Studio URL of the build being traced (A/B traces two). */
  setup?: (cdp: Cdp, url: string) => Promise<void>;
  interactions: (cdp: Cdp, url: string) => Promise<void>;
}

/**
 * Thrown by a scenario's setup when the build cannot reach the state the scenario measures: the
 * feature is there by command but draws nothing to measure. On base it is judged like a missing
 * `requires` command (head alone, against the budget); on head it fails, because head must be able
 * to show what its own scenarios time.
 */
export class ScenarioUnavailableError extends Error {
  override name = "ScenarioUnavailableError";
}

/** Rows the collection grid is drawing. */
const GRID_ROWS = `document.querySelectorAll(".tabulator-row").length`;

/**
 * Open the `docs` grid once, untraced, and require it to draw rows, then go back to the page.
 *
 * Without this the scenario timed whatever the grid happened to show, and on `main` before the
 * workspaces redesign that was nothing: its collection resolver put `"source": "../../docs"` under
 * the site (`sites/jxsuite.com/docs`), every listing was a 500, and the grid was an empty table.
 * Head draws the sixty-odd docs pages, so the A/B compared an empty grid with a full one and read
 * the row rendering as a +28% wall regression. An empty grid is not the interaction being timed.
 * Warming the grid here also makes the traced opens the repeat opens a person does.
 */
async function requireGridRows(cdp: Cdp) {
  await openIndexInDesign(cdp);
  await runCommand(cdp, "collection.editInGrid", { name: "docs" });
  try {
    await waitFor(cdp, `${GRID_ROWS} > 0`, 10_000);
  } catch {
    throw new ScenarioUnavailableError(`the "docs" grid drew no rows`);
  } finally {
    await runCommand(cdp, "document.open", { path: "pages/index.md" });
  }
}

async function pressEscape(cdp: Cdp) {
  for (const type of ["keyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", {
      type,
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
  }
  await idle(cdp);
}

/** Open pages/index.md on the canvas, in the Design workspace where the build has workspaces. */
async function openIndexInDesign(cdp: Cdp) {
  if (await hasCommand(cdp, "view.setWorkspace")) {
    await runCommand(cdp, "view.setWorkspace", { workspace: "design" });
  }
  await runCommand(cdp, "document.open", { path: "pages/index.md" });
}

async function hasCommand(cdp: Cdp, id: string): Promise<boolean> {
  return Boolean(
    await evalJs(
      cdp,
      `__jxAutomation.probe.commands().some((c) => c.id === ${JSON.stringify(id)})`,
    ),
  );
}

export const SCENARIOS: Scenario[] = [
  {
    name: "boot",
    describe: "Cold boot, no document: navigation → app idle (perceived startup cost)",
    interactions: async (cdp, url) => {
      await cdp.send("Page.navigate", { url });
      await waitFor(cdp, "!!globalThis.__jxAutomation");
      await idle(cdp);
    },
  },
  {
    name: "document-boot",
    describe:
      "Cold boot straight into a document (?file=pages/index.md): navigation → canvas live and idle",
    interactions: async (cdp, url) => {
      await cdp.send("Page.navigate", { url: `${url}&file=pages/index.md` });
      await waitFor(cdp, "__jxAutomation.probe.state().document?.open === true");
      await idle(cdp);
    },
  },
  {
    name: "assistant",
    describe: "Assistant panel open + focus + new chat, then close (×3)",
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "view.setAssistant", { open: true });
        await runCommand(cdp, "assistant.newChat");
        await runCommand(cdp, "view.setAssistant", { open: false });
      }
    },
  },
  {
    name: "palette",
    describe: "Command palette: open → typed filter → Escape (×3)",
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "palette.open");
        await cdp.send("Input.insertText", { text: "open" });
        await idle(cdp);
        await pressEscape(cdp);
      }
    },
  },
  {
    name: "palette-files",
    describe: "File palette: openFiles → typed filter → Escape (×3)",
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "palette.openFiles");
        await idle(cdp);
        await cdp.send("Input.insertText", { text: "jx" });
        await idle(cdp);
        await pressEscape(cdp);
      }
    },
  },
  {
    name: "canvas-edit",
    describe:
      "Selection + inspector tab cycling on pages/index.md (×3). The document is opened in setup, untraced: this measures the editing path, not the open.",
    setup: openIndexInDesign,
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "selection.set", { path: [] });
        await runCommand(cdp, "view.setRightTab", { tab: "style" });
        await runCommand(cdp, "view.setRightTab", { tab: "properties" });
        await runCommand(cdp, "selection.set", { path: null });
        await runCommand(cdp, "view.setRightTab", { tab: "events" });
        await runCommand(cdp, "view.setRightTab", { tab: "properties" });
      }
    },
  },
  {
    name: "grid-edit",
    describe: `Collection grid: open the "docs" grid, switch to pages/index.md and back (read-only; ×3)`,
    /* The grid declares one mode, so the Source ↔ Grid cycle this scenario used to run was refused on
       every step on both sides of the workspaces redesign. Opening the grid and leaving it are the
       steps a person repeats. Requires the project to declare a content collection (the traced
       site's `docs` does), and the grid to draw its rows ({@link requireGridRows}). */
    setup: requireGridRows,
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "collection.editInGrid", { name: "docs" });
        await runCommand(cdp, "document.open", { path: "pages/index.md" });
      }
    },
  },
  {
    name: "regions",
    describe: `Shell region cycling: view.cycleRegion (×6)`,
    // Its own starting state, not whichever document and focus the scenario before it left.
    setup: openIndexInDesign,
    interactions: async (cdp) => {
      for (let i = 0; i < 6; i++) {
        await runCommand(cdp, "view.cycleRegion");
      }
    },
  },
  {
    name: "panels",
    describe: `Navigator panel, Inspector dock and Bottom dock tab switching on an open page (×3 each)`,
    /* Arguments every one of these commands accepts on both sides of the workspaces redesign. This
       scenario used to pass `view.setNavigator { panel }`, `view.setRightPanel { panel }` and
       `view.setBottomTab { tab: "events" }`, none of which the registry accepts; every step threw,
       and the un-awaited harness reported the throws as a 40ms scenario. */
    setup: openIndexInDesign,
    interactions: async (cdp) => {
      await runCommand(cdp, "view.setActivity", { tab: "layers" });
      await runCommand(cdp, "view.setActivity", { tab: "data" });
      await runCommand(cdp, "view.setActivity", { tab: "files" });
      await runCommand(cdp, "view.setRightPanel", { open: false });
      await runCommand(cdp, "view.setRightPanel", { open: true });
      await runCommand(cdp, "view.setNavigator", { open: true });
      await runCommand(cdp, "view.setBottomTab", { tab: "activity" });
      await runCommand(cdp, "view.setBottomTab", { tab: "problems" });
      await runCommand(cdp, "view.setBottomTab", { tab: "activity" });
    },
  },
  {
    name: "settings",
    describe:
      "Project Settings: open → dismiss (×3). Dismiss is Escape where Settings is a modal and document.close where it is a document tab, so every build pays a full open each time.",
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "settings.open");
        const modal = await evalJs(cdp, "__jxAutomation.probe.state().modal?.open === true");
        await (modal ? pressEscape(cdp) : runCommand(cdp, "document.close"));
      }
    },
  },
  /* ── The workspaces redesign's own paths (studio.md §22). Each needs `view.setWorkspace`, so a
     build without workspaces refuses them by name rather than tracing something else. ── */
  {
    name: "workspaces",
    describe: "Workspace switching: Design → Content → Media → Styles → Publish → Design (×2)",
    requires: "view.setWorkspace",
    setup: async (cdp) => {
      await runCommand(cdp, "view.setWorkspace", { workspace: "design" });
    },
    interactions: async (cdp) => {
      for (let i = 0; i < 2; i++) {
        for (const workspace of ["content", "media", "styles", "publish", "design"]) {
          await runCommand(cdp, "view.setWorkspace", { workspace });
        }
      }
    },
  },
  {
    name: "site-panel",
    describe:
      "Design workspace with the Site panel: show it, open two pages, switch to Files and back (×3). The panel's filter is a typed field with no command, so it is not traced.",
    requires: "view.setWorkspace",
    setup: async (cdp) => {
      await runCommand(cdp, "view.setWorkspace", { workspace: "design" });
      await runCommand(cdp, "view.setActivity", { tab: "files" });
    },
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "view.setActivity", { tab: "site" });
        await runCommand(cdp, "document.open", { path: "pages/index.md" });
        await runCommand(cdp, "document.open", { path: "pages/features.json" });
        await runCommand(cdp, "view.setActivity", { tab: "files" });
      }
    },
  },
  {
    name: "content",
    describe:
      "Content home on the docs collection: table → cards → board → table, open an entry into writing mode, close back to the home (×2)",
    requires: "view.setWorkspace",
    setup: async (cdp) => {
      await runCommand(cdp, "view.setWorkspace", { workspace: "content" });
      await runCommand(cdp, "content.showCollection", { collection: "docs" });
      await runCommand(cdp, "content.setLayout", { layout: "table" });
    },
    interactions: async (cdp) => {
      for (let i = 0; i < 2; i++) {
        await runCommand(cdp, "content.setLayout", { layout: "cards" });
        await runCommand(cdp, "content.setLayout", { layout: "board" });
        await runCommand(cdp, "content.setLayout", { layout: "table" });
        /* The docs collection's source is `../../docs`, so its entries are named relative to the
           project like that: `docs/start.md` names no file, and the open it asked for never came. */
        await runCommand(cdp, "content.openEntry", { path: "../../docs/start.md" });
        await runCommand(cdp, "document.close");
      }
    },
  },
  {
    name: "media",
    describe:
      "Media home: filter to images, search, select a file, filter to video, back to all (×2). Selecting resets the filter and the search, which is how the scenario returns to its start; media.browse has no sort argument, so sort is not traced.",
    requires: "view.setWorkspace",
    setup: async (cdp) => {
      await runCommand(cdp, "view.setWorkspace", { workspace: "media" });
      await runCommand(cdp, "media.browse", { select: "public/starters/blog.jpg" });
    },
    interactions: async (cdp) => {
      for (let i = 0; i < 2; i++) {
        await runCommand(cdp, "media.browse", { filter: "image" });
        await runCommand(cdp, "media.browse", { query: "starters" });
        await runCommand(cdp, "media.browse", { select: "public/starters/blog.jpg" });
        await runCommand(cdp, "media.browse", { filter: "video" });
        await runCommand(cdp, "media.browse", { filter: "all" });
      }
    },
  },
  {
    name: "styles",
    describe: "Styles workspace: Elements (stylebook) → Variables → Elements (×3)",
    requires: "view.setWorkspace",
    setup: async (cdp) => {
      await runCommand(cdp, "styles.open", { view: "elements" });
    },
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "styles.open", { view: "variables" });
        await runCommand(cdp, "styles.open", { view: "elements" });
      }
    },
  },
  {
    name: "publish",
    describe: "Publish workspace: Review → Deploys → Branches → Hosting (×2; read-only)",
    requires: "view.setWorkspace",
    setup: async (cdp) => {
      await runCommand(cdp, "publish.open", { tab: "review" });
    },
    interactions: async (cdp) => {
      for (let i = 0; i < 2; i++) {
        for (const tab of ["deploys", "branches", "hosting", "review"]) {
          await runCommand(cdp, "publish.open", { tab });
        }
      }
    },
  },
  {
    name: "add-new",
    describe: "Add New dialog: file.new → Escape, nothing created (×3)",
    requires: "view.setWorkspace",
    setup: async (cdp) => {
      await runCommand(cdp, "view.setWorkspace", { workspace: "design" });
    },
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "file.new");
        await pressEscape(cdp);
      }
    },
  },
  {
    name: "quick-publish",
    describe: "Quick Publish dialog: publish.quick → Escape, nothing sent (×3)",
    requires: "view.setWorkspace",
    setup: async (cdp) => {
      await runCommand(cdp, "view.setWorkspace", { workspace: "design" });
    },
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "publish.quick");
        await pressEscape(cdp);
      }
    },
  },
  {
    name: "inspector-page",
    describe:
      "Inspector Page tab ↔ Element on pages/index.md: Page → select root → Properties → clear → Page (×3)",
    requires: "view.setWorkspace",
    setup: openIndexInDesign,
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "view.setRightTab", { tab: "page" });
        await runCommand(cdp, "selection.set", { path: [] });
        await runCommand(cdp, "view.setRightTab", { tab: "properties" });
        await runCommand(cdp, "selection.set", { path: null });
        await runCommand(cdp, "view.setRightTab", { tab: "page" });
      }
    },
  },
];

// ─── Orchestration ───────────────────────────────────────────────────────────

const argv = Bun.argv.slice(2);
function flag(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? (argv[i + 1] ?? fallback) : fallback;
}

/** A path flag: absolute as given, relative to this directory otherwise (the old `--out` rule). */
function pathFlag(value: string): string {
  return value.startsWith("/") ? value : resolve(import.meta.dir, value);
}

/** One traced build: its Studio URL and the Chrome session that drives it. */
interface Side {
  label: "base" | "head";
  url: string;
  cdp: Cdp;
  chrome: ReturnType<typeof Bun.spawn>;
  /** Chrome's throwaway profile, removed by {@link closeSide}. */
  profileDir: string;
}

async function openSide(label: Side["label"], url: string, port: number): Promise<Side> {
  const profileDir = await mkdtemp(join(tmpdir(), `jx-perf-${label}-`));
  let chrome: ReturnType<typeof Bun.spawn> | null = null;
  try {
    chrome = await launchChrome(profileDir, port);
    await Bun.sleep(400);
    const cdp = await Cdp.connect(port);
    /* `--cpu-throttle N` slows the renderer N times, to reproduce locally what only a CI runner's
       timing shows (a race between a command and the canvas it waits on, say). Never in CI. */
    const throttle = Number(flag("cpu-throttle", "1"));
    if (throttle > 1) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    }
    return { label, url, cdp, chrome, profileDir };
  } catch (error) {
    chrome?.kill(9);
    await chrome?.exited;
    await rm(profileDir, { recursive: true, force: true });
    throw error;
  }
}

/** Take one side down: its CDP socket, its Chrome (waited for), then its profile directory. */
async function closeSide(side: Pick<Side, "cdp" | "chrome" | "profileDir">): Promise<void> {
  side.cdp.close();
  side.chrome.kill(9);
  await side.chrome.exited;
  await rm(side.profileDir, { recursive: true, force: true });
}

async function loadStudio(side: Pick<Side, "cdp" | "url">) {
  await side.cdp.send("Page.navigate", { url: side.url });
  await waitFor(side.cdp, "!!globalThis.__jxAutomation");
  await idle(side.cdp);
}

/** Run one repetition of a scenario on one side: its setup untraced, its interactions traced. */
async function traceRep(
  side: Pick<Side, "cdp" | "url" | "label">,
  scenario: Scenario,
  rep: number,
  dumpDir: string | null,
): Promise<Analysis> {
  await scenario.setup?.(side.cdp, side.url);
  console.error(`[${side.label} ${scenario.name} rep ${rep}] start`);
  const t0 = Date.now();
  const { name, wall, events } = await capture(side.cdp, scenario.name, () =>
    scenario.interactions(side.cdp, side.url),
  );
  if (dumpDir) {
    /* Whole and per repetition: a sliced JSON array does not parse, so every dump past 20MB was
       unreadable, and one file name per scenario kept only the last repetition. */
    await Bun.write(
      `${dumpDir}/${side.label}-${scenario.name}-${rep}-raw.json`,
      JSON.stringify(events),
    );
  }
  console.error(
    `[${side.label} ${scenario.name} rep ${rep}] captured ${events.length} events in ${Date.now() - t0}ms`,
  );
  return analyze(name, wall, events);
}

function outDirOf(): string {
  return flag("out", "") === ""
    ? `/tmp/opencode/jx-perf-out-${Date.now()}`
    : pathFlag(flag("out", ""));
}

async function appendSummary(markdown: string) {
  const path = flag("summary", "");
  if (path) {
    await appendFile(path, markdown);
  }
}

/** One scenario's repetitions on both sides, before {@link classifyScenario} judges them. */
interface ScenarioOutcome {
  name: string;
  requires: string;
  headHas: boolean;
  baseHas: boolean;
  baseUnavailable: string;
  headError: string;
  baseError: string;
  runs: Record<Side["label"], { metrics: RepMetrics; mapped: MappedSource[] }[]>;
}

/** Run one scenario's interleaved repetitions on two loaded sides. */
async function runScenarioAB(
  scenario: Scenario,
  sides: Record<Side["label"], Side>,
  reps: number,
  dumpDir: string | null,
): Promise<ScenarioOutcome> {
  const { base, head } = sides;
  const needs = scenario.requires;
  const headHas = !needs || (await hasCommand(head.cdp, needs));
  const baseHas = !needs || (await hasCommand(base.cdp, needs));
  let baseError = "";
  let baseUnavailable = "";
  let headError = "";
  const runs: ScenarioOutcome["runs"] = { base: [], head: [] };
  // A scenario head cannot run is not run on either side: it is judged `head-missing`.
  const sideReps = headHas ? reps : 0;
  for (let rep = 0; rep < sideReps && !headError && !baseError; rep++) {
    for (const label of abOrder(rep)) {
      if ((label === "base" && (!baseHas || baseUnavailable)) || (label === "head" && headError)) {
        continue;
      }
      const side = sides[label];
      try {
        const r = await traceRep(side, scenario, rep, dumpDir);
        const mapped = await mapSources(r.bundled);
        attributeHarness(r, mapped);
        /* `bundled` holds only the OUTERMOST `FunctionCall` per task, so work under a timer whose
           callback is the harness's own (every command's synchronous part) maps to nothing. The
           CPU profile's self-time frames still name it, bundle-relative. */
        const evidence =
          mapped.length > 0
            ? mapped
            : r.topFrames.map((f) => ({ file: f.label, totalMs: f.selfMs }));
        runs[label].push({ metrics: metricsOf(r), mapped: evidence });
      } catch (error) {
        // The first line only: a stack would break the Markdown table row it is printed in.
        const message = firstLine(error instanceof Error ? error.message : String(error));
        console.error(`[${label} ${scenario.name} rep ${rep}] threw: ${message}`);
        if (label === "base" && error instanceof ScenarioUnavailableError) {
          baseUnavailable = message;
        } else if (label === "base") {
          baseError = message;
        } else {
          headError = message;
        }
        await loadStudio(side).catch(() => {});
      }
    }
  }
  return {
    name: scenario.name,
    requires: needs ?? "",
    headHas,
    baseHas,
    baseUnavailable,
    headError,
    baseError,
    runs,
  };
}

/**
 * The same-runner A/B gate (`--base-url`). Base and head are each served by their own dev server
 * and driven by their own Chrome; every scenario runs its repetitions interleaved between the two
 * ({@link abOrder}), so whatever the machine is doing during a scenario is paid by both builds. The
 * gate then judges head against base ({@link compareAB}) rather than against numbers recorded on
 * another machine on another day, which is the failure this mode exists to remove: a September
 * baseline from a loud dev machine made a CI runner read every scenario as 37 to 95% faster, and
 * the one real regression as a 100% one with a 2940% scripting cell.
 */
async function runAB(baseUrl: string, headUrl: string) {
  const reps = Number(flag("reps", String(DEFAULT_AB_REPS)));
  if (!(reps >= MIN_AB_REPS)) {
    throw new Error(`--reps ${reps}: the A/B gate needs at least ${MIN_AB_REPS} per side`);
  }
  const port = Number(flag("port", "9226"));
  const scenFilter = flag("scen", "");
  const outDir = outDirOf();
  await mkdir(outDir, { recursive: true });
  const dumpDir = flag("dump", "0") === "1" ? outDir : null;
  const budgetText = await Bun.file(pathFlag(flag("budgets", "budgets.json"))).text();
  /* SAFETY: budgets.json is committed beside this file and `BudgetFile` is its whole shape. */
  const budgets = JSON.parse(budgetText) as BudgetFile;

  // Before any Chrome starts: a `--scen` typo is a usage error, not a run that judged nothing.
  const selected = selectScenarios(scenFilter, SCENARIOS);

  const results: ABScenarioResult[] = [];
  const hot: string[] = [];
  for (const scenario of selected) {
    /* A fresh Chrome per side for EVERY scenario. The two sides must enter each scenario in the
       same state, and a shared browser cannot promise that: a scenario base cannot run leaves
       head's renderer five repetitions older than base's, and a side reloaded to recover from a
       throw is back at a fresh boot while the other carries every document and tab before it.
       On CI that read `regions` as wall 299 -> 396 ms (+33%) after base's `grid-edit` setup
       threw, and locally as exactly one extra 33 ms frame after head alone ran `grid-edit`; the
       same scenario A/B'd on its own reads 231 against 231. */
    const sides: Side[] = [];
    try {
      const base = await openSide("base", baseUrl, port);
      sides.push(base);
      const head = await openSide("head", headUrl, port + 1);
      sides.push(head);
      await loadStudio(base);
      await loadStudio(head);
      const outcome = await runScenarioAB(scenario, { base, head }, reps, dumpDir);
      const result = classifyScenario({
        ...outcome,
        base: outcome.runs.base.map((run) => run.metrics),
        head: outcome.runs.head.map((run) => run.metrics),
        budget: budgetFor(budgets, scenario.name),
      });
      results.push(result);
      if (result.kind === "compared") {
        for (const c of result.comparisons.filter((comparison) => comparison.regressed)) {
          hot.push(hotSources(scenario.name, c, outcome.runs));
        }
      }
    } finally {
      await Promise.all(sides.map((side) => closeSide(side)));
    }
  }
  for (const line of abAnnotations(results)) {
    console.log(line);
  }

  const markdown = abMarkdown(results, { reps, baseUrl, headUrl });
  console.log(`\n${markdown}`);
  for (const block of hot) {
    console.log(block);
  }
  await appendSummary(markdown);
  await Bun.write(
    `${outDir}/ab.json`,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), baseUrl, headUrl, reps, results },
      null,
      2,
    ),
  );
  console.log(`Wrote ${outDir}/ab.json`);
  if (abFailed(results)) {
    process.exitCode = 1;
  }
}

interface MappedSource {
  file: string;
  totalMs: number;
}

/**
 * A regressed metric's evidence: the original sources hottest in the head repetition whose value
 * sits nearest head's median, beside the same for base, so the failure names code and not just a
 * number.
 */
function hotSources(
  scenario: string,
  c: ABComparison,
  runs: Record<"base" | "head", { metrics: RepMetrics; mapped: MappedSource[] }[]>,
): string {
  const nearest = (side: "base" | "head", target: number) =>
    runs[side].toSorted(
      (a, b) => Math.abs(a.metrics[c.metric] - target) - Math.abs(b.metrics[c.metric] - target),
    )[0]?.mapped ?? [];
  const list = (mapped: MappedSource[]) =>
    mapped
      .slice(0, 8)
      .map((f) => `    ${f.file} (${f.totalMs}ms)`)
      .join("\n");
  return [
    `== ${scenario} ${c.metric}: ${c.base.median} → ${c.head.median}ms ==`,
    "  head, hot original sources:",
    list(nearest("head", c.head.median)),
    "  base, hot original sources:",
    list(nearest("base", c.base.median)),
    "",
  ].join("\n");
}

/**
 * The absolute mode (`--compare`, `--write-baseline`): one build, compared against a recorded
 * baseline. The nightly trend run uses it; a pull request uses {@link runAB}.
 */
async function runAbsolute() {
  const url = flag("url", DEFAULT_URL);
  const reps = Math.max(1, Number(flag("reps", "3")));
  const scenFilter = flag("scen", "");
  const port = Number(flag("port", "9226"));
  const side = await openSide("head", url, port);
  try {
    const { cdp } = side;
    const outDir = outDirOf();
    await mkdir(outDir, { recursive: true });
    const dumpDir = flag("dump", "0") === "1" ? outDir : null;
    const selected = selectScenarios(scenFilter, SCENARIOS);
    const results: Analysis[] = [];

    if (!selected.some((s) => s.name === "boot")) {
      await loadStudio(side);
    }

    for (const scenario of selected) {
      const runs: Analysis[] = [];
      if (scenario.requires && !(await hasCommand(cdp, scenario.requires))) {
        console.error(
          `[scenario ${scenario.name}] skipped: this build has no "${scenario.requires}"`,
        );
        continue;
      }
      for (let r = 0; r < reps; r++) {
        runs.push(await traceRep(side, scenario, r, dumpDir));
      }
      const active = (run: Analysis) =>
        run.breakdown.scripting + run.breakdown.rendering + run.breakdown.painting;
      const middle = [...runs].toSorted((a, b) => active(a) - active(b))[
        Math.floor(runs.length / 2)
      ]!;
      console.log(
        `[${scenario.name}] active per rep: ${runs.map((x) => active(x)).join(", ")}ms (reported median ${active(middle)}ms)`,
      );
      results.push(middle);
    }

    const written: (Analysis & { sources: MappedSource[] })[] = [];
    for (const r of results) {
      // Attributed before printing, so the `scripting` this block shows is the one the gate judges.
      const mapped = await mapSources(r.bundled);
      attributeHarness(r, mapped);
      written.push({ ...r, sources: mapped });
      console.log(`\n== ${r.scenario} (wall ${r.wallMs}ms, busy ${r.busyMs}ms) ==`);
      console.log(
        JSON.stringify(
          {
            breakdown: r.breakdown,
            styleRecalc: r.styleRecalc,
            styleCauses: r.styleCauses,
            layout: r.layout,
            gcMs: r.gcMs,
            longTasks: r.longTasks,
          },
          null,
          2,
        ),
      );
      if (r.topFrames.length > 0) {
        console.log("top frames:");
        for (const f of r.topFrames) {
          console.log(`  ${f.label} (self ${f.selfMs}ms, total ${f.totalMs}ms)`);
        }
      }
      console.log(
        `harness idle-probe cost attributed: ${r.harnessMs}ms (subtracted from scripting)`,
      );
      if (mapped.some((f) => f.file.startsWith("packages/"))) {
        console.log("hot original sources:");
        for (const f of mapped.slice(0, 10)) {
          console.log(`  ${f.file} (${f.totalMs}ms)`);
        }
      }
    }
    /* Written after attribution, so the file carries the same app scripting the gate judges and
       the original-source list a reader needs, not the pre-subtraction numbers. */
    await Bun.write(
      `${outDir}/traces.json`,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), url, reps, results: written },
        null,
        2,
      ),
    );
    console.log(`\nWrote ${outDir}/traces.json`);

    if (flag("write-baseline", "0") === "1") {
      const baselinePath = pathFlag(flag("baseline-out", "baseline.json"));
      const baseline: Baseline = {
        updatedAt: new Date().toISOString(),
        analyzerVersion: ANALYZER_VERSION,
        scenarios: results.map((r) => baselineScenario(r)),
      };
      await Bun.write(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
      console.log(`Wrote ${baselinePath}`);
    }

    const comparePath = flag("compare", "");
    if (comparePath) {
      /* SAFETY: `--compare` reads a baseline `--write-baseline` produced (studio-perf.yml passes the
       * tracked scripts/perf/baseline.json), and that branch serialises a `Baseline` literal. */
      const baseline = JSON.parse(await Bun.file(comparePath).text()) as Baseline;
      const report = trendReport(baseline, results, comparePath);
      if ((baseline.analyzerVersion ?? 1) !== ANALYZER_VERSION) {
        console.log(
          `::warning::${comparePath} was captured under analyzer v${baseline.analyzerVersion ?? 1}; this run is v${ANALYZER_VERSION}, so the trend is report-only until a new baseline is adopted`,
        );
      }
      if (report.fail) {
        process.exitCode = 1;
      }
      console.log(`\n${report.markdown}`);
      await appendSummary(report.markdown);
    }
  } finally {
    await closeSide(side);
  }
}

async function main() {
  const baseUrl = flag("base-url", "");
  await (baseUrl ? runAB(baseUrl, flag("url", DEFAULT_URL)) : runAbsolute());
}

if (import.meta.main) {
  await main();
}
