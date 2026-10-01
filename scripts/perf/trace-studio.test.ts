import { describe, expect, test } from "bun:test";

import type { Analysis } from "./analysis.ts";
import {
  attributeHarness,
  baselineScenario,
  compareMetric,
  compareScenario,
} from "./trace-studio.ts";

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
