import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { JsonObject } from "@jxsuite/schema/types";

import type { Analysis } from "./analysis.ts";
import {
  AB_ALPHA,
  ANALYZER_VERSION,
  AB_METRICS,
  GATED_METRICS,
  failsGate,
  abAnnotations,
  ScenarioUnavailableError,
  classifyScenario,
  selectScenarios,
  trendReport,
  withDeadline,
  DEFAULT_AB_REPS,
  MIN_AB_REPS,
  SCENARIOS,
  abFailed,
  abMarkdown,
  abOrder,
  attributeHarness,
  budgetFor,
  checkBudget,
  commandExpression,
  compareAB,
  mannWhitneyGreater,
  median,
  metricsOf,
  baselineScenario,
  compareMetric,
  compareScenario,
  evaluateParams,
  firstLine,
} from "./trace-studio.ts";

describe("evaluateParams", () => {
  test("awaits the expression's own promise: no replMode wrapper", () => {
    // Under replMode, awaitPromise awaited Chrome's wrapper and every command ran un-awaited.
    expect(evaluateParams("__jxAutomation.run('x')", true)).toEqual({
      expression: "__jxAutomation.run('x')",
      awaitPromise: true,
      returnByValue: true,
    });
  });
});

describe("SCENARIOS", () => {
  test("names each scenario once", () => {
    const names = SCENARIOS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("traces every workspace path the redesign introduced", () => {
    const names = new Set(SCENARIOS.map((s) => s.name));
    for (const name of [
      "workspaces",
      "site-panel",
      "content",
      "media",
      "styles",
      "publish",
      "add-new",
      "quick-publish",
      "inspector-page",
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  test("runs only command ids Studio's source declares", async () => {
    // A renamed command fails here, by name, instead of in a browser run nobody reads.
    const self = await Bun.file(resolve(import.meta.dir, "trace-studio.ts")).text();
    const used = new Set(
      [...self.matchAll(/runCommand\(cdp, "([\w.]+)"/g)].map((match) => match[1]!),
    );
    const src = resolve(import.meta.dir, "../../packages/studio/src");
    let declared = "";
    for (const file of await readdir(src, { recursive: true })) {
      if (file.endsWith(".ts") && !file.endsWith(".test.ts")) {
        declared += await Bun.file(join(src, file)).text();
      }
    }
    const missing = [...used].filter((id) => !declared.includes(`"${id}"`));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(10);
  });
});

/** An analysis carrying only the fields the baseline and the gate read. */
function analysis(
  scenario: string,
  m: { wallMs: number; scripting: number; styleRecalc: number; layout: number; harnessMs?: number },
): Analysis {
  return {
    scenario,
    wallMs: m.wallMs,
    busyMs: 0,
    longTasks: [],
    breakdown: { scripting: m.scripting, rendering: 0, painting: 0, loading: 0, gc: 0 },
    styleRecalc: { count: 1, time: m.styleRecalc, elements: 0 },
    styleCauses: [],
    layout: { count: 1, time: m.layout, invalidated: 0 },
    topFrames: [],
    bundled: [],
    harnessMs: m.harnessMs ?? 0,
    gcMs: 0,
  };
}

/** `palette-files` as scripts/perf/baseline.json tracks it. */
const PALETTE_FILES_BASE = { wallMs: 370.5, scriptingMs: 8.8, styleRecalcMs: 13.9, layoutMs: 3.7 };

describe("compareMetric", () => {
  test("a zero baseline is informational only, never a regression", () => {
    expect(compareMetric(0, 42)).toEqual({ cell: "n/a → 42", regressed: false });
  });

  test("a near-zero baseline does not regress on an ordinary absolute jump", () => {
    // The bug this guards: grid-edit's tracked scriptingMs was 0.7 — a few real ms of scripting
    // (routine jitter, not a regression) reads as a four-figure percentage against it.
    const { cell, regressed } = compareMetric(0.7, 87.7);
    expect(regressed).toBe(false);
    expect(cell).toBe("0.7 → 87.7 (+12429%)");
  });

  test("a baseline right at the floor still regresses on a real jump", () => {
    expect(compareMetric(5, 40).regressed).toBe(true);
  });

  test("a large baseline regresses only past both the percent and absolute bars", () => {
    expect(compareMetric(1000, 1150).regressed).toBe(false); // +15%, under the 20% bar
    expect(compareMetric(1000, 1021).regressed).toBe(false); // +21%, under the 25ms bar
    expect(compareMetric(1000, 1260).regressed).toBe(true); // +26%, +260ms — both bars cleared
  });

  test("a metric that improves is never a regression, whatever the baseline", () => {
    expect(compareMetric(0.7, 0.1).regressed).toBe(false);
    expect(compareMetric(1000, 100).regressed).toBe(false);
  });
});

describe("attributeHarness", () => {
  test("moves the idle probe's cost out of scripting and into harnessMs", () => {
    // The #403 run: 72.8ms of scripting, 70.3ms of it the probe's rAF poll.
    const r = analysis("palette-files", {
      wallMs: 96.4,
      scripting: 72.8,
      styleRecalc: 4.6,
      layout: 1.6,
    });
    attributeHarness(r, [
      { file: "packages/studio/src/services/idle.ts:148", totalMs: 70.3 },
      { file: "packages/studio/src/panels/palette.ts:12", totalMs: 1.9 },
    ]);
    expect(r.harnessMs).toBe(70.3);
    expect(r.breakdown.scripting).toBe(2.5);
  });

  test("never drives scripting below zero", () => {
    const r = analysis("boot", { wallMs: 250, scripting: 10, styleRecalc: 0, layout: 0 });
    attributeHarness(r, [{ file: "packages/studio/src/services/idle.ts:148", totalMs: 23.6 }]);
    expect(r.breakdown.scripting).toBe(0);
  });
});

describe("compareScenario", () => {
  test("the idle probe's own wait is not a scripting regression", () => {
    // The bug this guards: --compare added harnessMs back, so this read 8.8 → 72.8 (+727%).
    // That failed a run whose code had passed four minutes earlier.
    const now = analysis("palette-files", {
      wallMs: 96.4,
      scripting: 2.5,
      styleRecalc: 4.6,
      layout: 1.6,
      harnessMs: 70.3,
    });
    const { cells, regressed } = compareScenario(PALETTE_FILES_BASE, now);
    expect(regressed).toBe(false);
    expect(cells[1]).toBe("8.8 → 2.5 (-72%)");
  });

  test("app scripting that grows past both bars still regresses", () => {
    const now = analysis("palette-files", {
      wallMs: 96.4,
      scripting: 60,
      styleRecalc: 4.6,
      layout: 1.6,
    });
    expect(compareScenario(PALETTE_FILES_BASE, now).regressed).toBe(true);
  });

  test("any one regressed metric fails the row", () => {
    const now = analysis("palette-files", {
      wallMs: 600,
      scripting: 2.5,
      styleRecalc: 4.6,
      layout: 1.6,
    });
    const { cells, regressed } = compareScenario(PALETTE_FILES_BASE, now);
    expect(regressed).toBe(true);
    expect(cells).toHaveLength(4);
  });
});

describe("baselineScenario", () => {
  test("records app scripting, the unit compareScenario judges", () => {
    const r = analysis("palette-files", {
      wallMs: 96.4,
      scripting: 72.8,
      styleRecalc: 4.6,
      layout: 1.6,
    });
    attributeHarness(r, [{ file: "packages/studio/src/services/idle.ts:148", totalMs: 70.3 }]);
    const row = baselineScenario(r);
    expect(row.scriptingMs).toBe(2.5);
    expect(row.harnessMs).toBe(70.3);
    // A baseline written from a run can never regress against that same run.
    // This fails if the writer and the comparer ever disagree about harnessMs again.
    expect(compareScenario(row, r).regressed).toBe(false);
  });
});

describe("median", () => {
  test("is the middle value of an odd sample and the mean of the middle two of an even one", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("mannWhitneyGreater", () => {
  test("complete separation at n = m = 5 is the exact 1/252", () => {
    expect(mannWhitneyGreater([6, 7, 8, 9, 10], [1, 2, 3, 4, 5])).toBeCloseTo(1 / 252, 10);
  });

  test("is one-sided: a faster head is never significant", () => {
    expect(mannWhitneyGreater([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])).toBe(1);
  });

  test("sums the exact upper tail at n = m = 4", () => {
    // Of the 70 orderings, one gives U = 16, one U = 15 and two U = 14.
    expect(mannWhitneyGreater([4, 6, 7, 8], [1, 2, 3, 5])).toBeCloseTo(2 / 70, 10);
    expect(mannWhitneyGreater([3, 6, 7, 8], [1, 2, 4, 5])).toBeCloseTo(4 / 70, 10);
  });

  test("identical samples give no evidence, and a tie can only make the test more lenient", () => {
    expect(mannWhitneyGreater([5, 5, 5, 5], [5, 5, 5, 5])).toBeGreaterThan(0.5);
    const tied = mannWhitneyGreater([6, 7, 8, 9, 5], [1, 2, 3, 4, 5]);
    expect(tied).toBeGreaterThanOrEqual(mannWhitneyGreater([6, 7, 8, 9, 5.1], [1, 2, 3, 4, 5]));
  });

  test("an empty side proves nothing", () => {
    expect(mannWhitneyGreater([], [1])).toBe(1);
  });
});

describe("compareAB", () => {
  test("the settings regression the absolute gate saw is a regression here too", () => {
    const c = compareAB("scriptingMs", [5, 6, 5.5, 4.8, 6.1], [150, 152, 149, 160, 155]);
    expect(c.regressed).toBe(true);
    expect(c.base.median).toBe(5.5);
    expect(c.head.median).toBe(152);
    expect(c.ratio).toBe(27.64);
    expect(c.p).toBeLessThan(AB_ALPHA);
  });

  test("a large median shift with overlapping reps is noise, not a regression", () => {
    /* Head's median is +40% and +100ms, but one quiet head rep sits under base's slowest: the
       samples cross, and at five reps per side that crossing is not evidence. */
    const c = compareAB("wallMs", [250, 400, 260, 255, 600], [350, 360, 240, 900, 380]);
    expect(c.head.median).toBeGreaterThan(c.base.median * 1.2);
    expect(c.p).toBeGreaterThanOrEqual(AB_ALPHA);
    expect(c.regressed).toBe(false);
  });

  test("a clean separation under the 20% bar is not a regression", () => {
    const c = compareAB("wallMs", [1000, 1001, 1002, 1003, 1004], [1100, 1101, 1102, 1103, 1104]);
    expect(c.p).toBeLessThan(AB_ALPHA);
    expect(c.regressed).toBe(false);
  });

  test("a clean separation under the 25ms floor is not a regression", () => {
    const c = compareAB("layoutMs", [10, 10, 11, 10, 12], [30, 31, 30, 29, 32]);
    expect(c.regressed).toBe(false);
  });

  test("a base median under the floor is never judged on its ratio", () => {
    // The grid-edit case: 0.7ms of base scripting against a few real milliseconds on head.
    const c = compareAB("scriptingMs", [0.7, 0.6, 0.8, 0.7, 0.7], [40, 41, 42, 39, 40]);
    expect(c.regressed).toBe(false);
  });

  test("a zero base median has no ratio", () => {
    expect(compareAB("layoutMs", [0, 0, 0, 0], [1, 1, 1, 1]).ratio).toBeNull();
  });
});

describe("abOrder", () => {
  test("alternates which build goes first, so neither always follows the other", () => {
    expect([0, 1, 2, 3].map((rep) => abOrder(rep))).toEqual([
      ["base", "head"],
      ["head", "base"],
      ["base", "head"],
      ["head", "base"],
    ]);
  });
});

describe("rep counts", () => {
  test("the minimum can produce a p-value under the gate's alpha, and three per side cannot", () => {
    const sep = (n: number) =>
      mannWhitneyGreater(
        Array.from({ length: n }, (_, i) => 100 + i),
        Array.from({ length: n }, (_, i) => i),
      );
    expect(sep(MIN_AB_REPS)).toBeLessThan(AB_ALPHA);
    expect(sep(MIN_AB_REPS - 1)).toBeGreaterThanOrEqual(AB_ALPHA);
    expect(DEFAULT_AB_REPS).toBeGreaterThanOrEqual(MIN_AB_REPS);
  });
});

describe("budgets", () => {
  const file = {
    default: { wallMs: 8000, longTaskMs: 500 },
    scenarios: { workspaces: { wallMs: 12_000 } },
  };

  test("a scenario override replaces only the fields it names", () => {
    expect(budgetFor(file, "workspaces")).toEqual({ wallMs: 12_000, longTaskMs: 500 });
    expect(budgetFor(file, "publish")).toEqual(file.default);
  });

  test("judges the median repetition, so one slow rep does not bust a budget", () => {
    const rep = (wallMs: number, longTaskMs: number) => ({
      wallMs,
      longTaskMs,
      mainThreadMs: 0,
      scriptingMs: 0,
      styleRecalcMs: 0,
      layoutMs: 0,
    });
    const ok = checkBudget([rep(900, 80), rep(20_000, 900), rep(950, 90)], file.default);
    expect(ok).toEqual({ wallMs: 950, longTaskMs: 90, violations: [] });
    const over = checkBudget([rep(9000, 600), rep(9100, 650), rep(8900, 610)], file.default);
    expect(over.violations).toEqual(["wall 9000ms > 8000ms", "longest task 610ms > 500ms"]);
  });

  test("the committed budget file has a default ceiling for both fields", async () => {
    const committed = await Bun.file(resolve(import.meta.dir, "budgets.json")).json();
    expect(committed.default.wallMs).toBeGreaterThan(0);
    expect(committed.default.longTaskMs).toBeGreaterThan(0);
  });
});

describe("metricsOf", () => {
  test("reads the gated metrics and the longest task off an analysis", () => {
    const r = analysis("x", { wallMs: 300, scripting: 20, styleRecalc: 10, layout: 5 });
    r.longTasks = [60, 120, 80];
    expect(metricsOf(r)).toEqual({
      wallMs: 300,
      mainThreadMs: 35,
      scriptingMs: 20,
      styleRecalcMs: 10,
      layoutMs: 5,
      longTaskMs: 120,
    });
    r.longTasks = [];
    expect(metricsOf(r).longTaskMs).toBe(0);
  });
});

describe("abFailed and abMarkdown", () => {
  const meta = { reps: 5, baseUrl: "http://b", headUrl: "http://h" };
  const ok = compareAB("wallMs", [100, 101, 102, 103, 104], [100, 101, 102, 103, 104]);
  const bad = compareAB("wallMs", [100, 101, 102, 103, 104], [300, 301, 302, 303, 304]);
  const headOnly = {
    name: "workspaces",
    kind: "head-only" as const,
    reason: "base has no view.setWorkspace",
    wallMs: 1800,
    longTaskMs: 120,
    budget: { wallMs: 8000, longTaskMs: 500 },
    violations: [],
  };

  test("passes when every compared metric holds and every head-only scenario is in budget", () => {
    const results = [{ name: "palette", kind: "compared" as const, comparisons: [ok] }, headOnly];
    expect(abFailed(results)).toBe(false);
    const md = abMarkdown(results, meta);
    expect(md).toContain("| palette | wallMs | 102 [100–104] | 102 [100–104] | 1 |");
    expect(md).toContain("| workspaces | base has no view.setWorkspace | 1800 | 120 |");
    expect(md).toContain("**Result: pass**");
  });

  test("fails on a regression, a budget overrun or a head scenario that threw", () => {
    expect(abFailed([{ name: "settings", kind: "compared", comparisons: [bad] }])).toBe(true);
    expect(abFailed([{ ...headOnly, violations: ["wall 9000ms > 8000ms"] }])).toBe(true);
    const threw = { name: "media", kind: "head-failed" as const, error: "no such command" };
    expect(abFailed([threw])).toBe(true);
    const md = abMarkdown(
      [{ name: "settings", kind: "compared", comparisons: [bad] }, threw],
      meta,
    );
    expect(md).toContain("**REGRESSED**");
    expect(md).toContain("**FAILED**: no such command");
    expect(md).toContain("**Result: FAIL**");
  });

  /* `canvas-edit` on the workspaces redesign, as CI measured it: faster overall, with work moved
     from scripting into style recalculation. Gated per component, that was a red X. */
  test("a component that grows while the interaction does not is a diagnostic, not a failure", () => {
    const style = compareAB(
      "styleRecalcMs",
      [44.2, 39.7, 54.8, 41, 45],
      [78.5, 73.1, 85.4, 76, 80],
    );
    const wall = compareAB("wallMs", [862, 830, 1019, 850, 870], [845, 828, 985, 840, 850]);
    expect(style.regressed).toBe(true);
    expect(style.gated).toBe(false);
    expect(failsGate(style)).toBe(false);
    const results = [
      { name: "canvas-edit", kind: "compared" as const, comparisons: [wall, style] },
    ];
    expect(abFailed(results)).toBe(false);
    const md = abMarkdown(results, meta);
    expect(md).toContain("| canvas-edit | styleRecalcMs |");
    expect(md).toContain("up (diagnostic)");
    expect(md).toContain("**Result: pass**");
    // The same growth on a gated metric fails.
    const main = compareAB("mainThreadMs", [100, 101, 102, 103, 104], [300, 301, 302, 303, 304]);
    expect(main.gated).toBe(true);
    expect(abFailed([{ name: "x", kind: "compared", comparisons: [main] }])).toBe(true);
  });

  test("labels a metric under the floor rather than calling it ok", () => {
    const tiny = compareAB("layoutMs", [1, 1, 1, 1], [2, 2, 2, 2]);
    const md = abMarkdown([{ name: "regions", kind: "compared", comparisons: [tiny] }], meta);
    expect(md).toContain("below floor");
  });
});

describe("commandExpression", () => {
  test("runs the command from a timer task, so its synchronous work is categorised scripting", async () => {
    const calls: [string, JsonObject][] = [];
    const page = {
      __jxAutomation: {
        run: (id: string, args: JsonObject) => {
          calls.push([id, args]);
          return "ran";
        },
      },
      setTimeout,
    };
    const expression = commandExpression("palette.open", { mode: "x" });
    expect(expression).toContain("setTimeout");
    // oxlint-disable-next-line typescript/no-implied-eval -- evaluates the page-side string the harness sends.
    const evaluate = new Function("__jxAutomation", "setTimeout", `return ${expression};`);
    const pending = evaluate(page.__jxAutomation, page.setTimeout);
    // Nothing runs inside the evaluate itself: the call waits for the timer.
    expect(calls).toEqual([]);
    expect(await pending).toBe("ran");
    expect(calls).toEqual([["palette.open", { mode: "x" }]]);
  });

  test("a command that throws rejects the evaluate rather than hanging it", async () => {
    const expression = commandExpression("x", {});
    const evaluate = new Function("__jxAutomation", `return ${expression};`);
    const failing = {
      run: () => {
        throw new Error("unavailable");
      },
    };
    expect(evaluate(failing)).rejects.toThrow("unavailable");
  });

  /* On CI a hung command surfaced as `Promise was collected`, which names nothing: the inspector
     holds an awaited promise weakly. The deadline holds it strongly and names the step. */
  test("a command that never settles rejects naming itself, after the deadline", async () => {
    const expression = commandExpression("view.setRightTab", { tab: "style" }, 20);
    const evaluate = new Function("__jxAutomation", `return ${expression};`);
    const hung = { run: () => new Promise(() => {}) };
    expect(evaluate(hung)).rejects.toThrow(
      'command "view.setRightTab" did not settle within 20 ms',
    );
  });

  test("a settled command clears its deadline", async () => {
    const expression = withDeadline("Promise.resolve(7)", "x", 60_000);
    // oxlint-disable-next-line typescript/no-implied-eval -- evaluates the page-side string the harness sends.
    const started = performance.now();
    expect(await new Function(`return ${expression};`)()).toBe(7);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("firstLine", () => {
  test("keeps an error to one table-safe line", () => {
    const text = "Command unavailable | nope\n    at Object.run (studio.js:1)";
    expect(firstLine(text)).toBe(String.raw`Command unavailable \| nope`);
  });
});

describe("classifyScenario", () => {
  const budget = { wallMs: 8000, longTaskMs: 500 };
  const rep = (wallMs: number) => ({
    wallMs,
    mainThreadMs: 0,
    scriptingMs: 0,
    styleRecalcMs: 0,
    layoutMs: 0,
    longTaskMs: 50,
  });
  const reps = (wallMs: number) => [0, 1, 2, 3, 4].map((i) => rep(wallMs + i));
  const meta = { reps: 5, baseUrl: "b", headUrl: "h" };
  const run = {
    name: "settings",
    requires: "",
    headHas: true,
    baseHas: true,
    baseUnavailable: "",
    headError: "",
    baseError: "",
    base: reps(100),
    head: reps(100),
    budget,
  };

  test("a scenario both builds ran is compared on every metric, and gated on two", () => {
    const result = classifyScenario(run);
    expect(result.kind).toBe("compared");
    const comparisons = result.kind === "compared" ? result.comparisons : [];
    expect(comparisons.map((c) => c.metric)).toEqual([...AB_METRICS]);
    expect(comparisons.filter((c) => c.gated).map((c) => c.metric)).toEqual([...GATED_METRICS]);
    expect(GATED_METRICS).toEqual(["wallMs", "mainThreadMs"]);
  });

  test("base throwing on a scenario both builds declare FAILS, it is not downgraded to a budget", () => {
    const result = classifyScenario({ ...run, baseError: "project did not resolve", base: [] });
    expect(result).toEqual({
      name: "settings",
      kind: "base-failed",
      error: "project did not resolve",
    });
    expect(abFailed([result])).toBe(true);
    expect(abAnnotations([result])[0]).toStartWith("::error::perf scenario settings: base threw");
    const md = abMarkdown([result], meta);
    expect(md).toContain("base threw on a scenario both builds declare");
    expect(md).toContain("**FAILED**: project did not resolve");
  });

  test("a scenario base cannot run is held to the budget", () => {
    const result = classifyScenario({
      ...run,
      requires: "view.setWorkspace",
      baseHas: false,
      base: [],
    });
    expect(result).toMatchObject({
      kind: "head-only",
      reason: "base has no view.setWorkspace",
      violations: [],
    });
    expect(abFailed([result])).toBe(false);
    expect(abAnnotations([result])).toEqual([]);
  });

  /* `grid-edit` on a base whose collection resolver drew the docs grid empty: comparing an empty
     table with a full one timed the row rendering, not the change. */
  test("a base that cannot reach the scenario's state is held to the budget, not compared", () => {
    const result = classifyScenario({
      ...run,
      baseUnavailable: `the "docs" grid drew no rows`,
      base: [],
    });
    expect(result).toMatchObject({
      kind: "head-only",
      reason: `base cannot run it: the "docs" grid drew no rows`,
      violations: [],
    });
    expect(abFailed([result])).toBe(false);
    // Still a FAILURE when the same base also threw: unavailable is not a licence to break.
    expect(classifyScenario({ ...run, baseUnavailable: "", baseError: "boom" }).kind).toBe(
      "base-failed",
    );
  });

  test("the unavailable signal is its own error class, so a plain throw cannot pass as one", () => {
    const unavailable = new ScenarioUnavailableError("no rows");
    expect(unavailable).toBeInstanceOf(Error);
    expect(unavailable.name).toBe("ScenarioUnavailableError");
    expect(new Error("no rows")).not.toBeInstanceOf(ScenarioUnavailableError);
  });

  test("head losing the command a scenario needs fails rather than dropping it", () => {
    const result = classifyScenario({
      ...run,
      requires: "view.setWorkspace",
      headHas: false,
      base: [],
      head: [],
    });
    expect(result).toEqual({
      name: "settings",
      kind: "head-missing",
      requires: "view.setWorkspace",
    });
    expect(abFailed([result])).toBe(true);
    expect(abAnnotations([result])[0]).toContain("so it left the gate");
    expect(abMarkdown([result], meta)).toContain(
      "| settings | head has no view.setWorkspace | | | | **FAILED**: the scenario left the gate |",
    );
  });

  test("head throwing is reported over base throwing", () => {
    const result = classifyScenario({ ...run, headError: "boom", baseError: "bang" });
    expect(result).toEqual({ name: "settings", kind: "head-failed", error: "boom" });
    expect(abAnnotations([result])).toEqual(["::error::perf scenario settings: head threw: boom"]);
  });

  test("a run that judged nothing fails", () => {
    expect(abFailed([])).toBe(true);
    expect(abMarkdown([], meta)).toContain("**Result: FAIL**: no scenario was judged.");
  });
});

describe("selectScenarios", () => {
  const all = [{ name: "boot" }, { name: "palette" }, { name: "settings" }];

  test("no filter selects every scenario; a filter keeps scenario order", () => {
    expect(selectScenarios("", all)).toEqual(all);
    expect(selectScenarios("settings, boot", all).map((s) => s.name)).toEqual(["boot", "settings"]);
  });

  test("an unknown or empty name throws instead of selecting nothing", () => {
    expect(() => selectScenarios("setings", all)).toThrow("no scenario named setings");
    expect(() => selectScenarios(",", all)).toThrow("(empty)");
  });
});

describe("trendReport", () => {
  const row = {
    name: "settings",
    ...PALETTE_FILES_BASE,
    harnessMs: 0,
    styleRecalcCount: 1,
    gcMs: 0,
  };
  const current = { updatedAt: "2026-10-19", analyzerVersion: ANALYZER_VERSION, scenarios: [row] };
  const legacy = { updatedAt: "2026-09-20", scenarios: [row] };
  const slow = analysis("settings", { wallMs: 900, scripting: 200, styleRecalc: 14, layout: 4 });
  const fresh = analysis("workspaces", { wallMs: 900, scripting: 2, styleRecalc: 1, layout: 1 });

  test("a baseline of this analyzer version gates", () => {
    const report = trendReport(current, [slow], "baseline.json");
    expect(report.fail).toBe(true);
    expect(report.markdown).toContain("REGRESSION");
  });

  test("a baseline from another analyzer version (or with none) is report-only", () => {
    const report = trendReport(legacy, [slow, fresh], "baseline.json");
    expect(report.fail).toBe(false);
    expect(report.markdown).toContain("analyzer v1");
    expect(report.markdown).toContain("**Report only**");
    expect(report.markdown).toContain("does not fail a report-only run");
  });

  test("a scenario the baseline has no row for is listed, not skipped", () => {
    const report = trendReport(current, [fresh], "baseline.json");
    expect(report.markdown).toContain("| workspaces | not in baseline | | | |");
    expect(report.fail).toBe(false);
  });

  test("the committed baseline's analyzer version is one this analyzer knows", async () => {
    const committed = await Bun.file(resolve(import.meta.dir, "baseline.json")).json();
    expect(committed.analyzerVersion ?? 1).toBeLessThanOrEqual(ANALYZER_VERSION);
  });
});
