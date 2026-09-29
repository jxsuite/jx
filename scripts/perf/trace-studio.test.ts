import { describe, expect, test } from "bun:test";

import { compareMetric } from "./trace-studio.ts";

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
