import { describe, expect, test } from "bun:test";
import { median, medianTimings, PHASES, table } from "./bench-build.ts";
import type { BuildTimings } from "../packages/compiler/src/site/site-build.ts";

const timings = (total: number, routes: number): BuildTimings => ({
  bundles: 10,
  components: 20,
  content: 30,
  outputs: 5,
  routes,
  setup: 1,
  total,
});

describe("median", () => {
  test("the middle of an odd list, the mean of the middle two of an even one", () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([40, 10, 20, 30])).toBe(25);
    expect(median([7])).toBe(7);
  });

  test("an empty list has no median", () => {
    expect(median([])).toBeNaN();
  });
});

test("the median of several builds is taken phase by phase", () => {
  const middle = medianTimings([timings(900, 800), timings(300, 100), timings(500, 400)]);
  expect(middle).toEqual(timings(500, 400));
});

test("the phases are listed in the order a build runs them", () => {
  expect(PHASES).toEqual(["setup", "content", "components", "routes", "bundles", "outputs"]);
});

test("the table has a cold and a warm row per project, in seconds, and names build errors", () => {
  const text = table([
    {
      cold: timings(25_900, 20_000),
      errors: 0,
      project: "jxsuite.com",
      routes: 161,
      warm: timings(6100, 2900),
    },
    { cold: timings(90, 40), errors: 2, project: "test-blank", routes: 4, warm: timings(80, 30) },
  ]);
  expect(text.split("\n")).toEqual([
    "| project               | routes | build | total | setup | content | components | routes | bundles | outputs |",
    "| --------------------- | ------ | ----- | ----- | ----- | ------- | ---------- | ------ | ------- | ------- |",
    "| jxsuite.com           | 161    | cold  | 25.90 | 0.00  | 0.03    | 0.02       | 20.00  | 0.01    | 0.01    |",
    "| jxsuite.com           | 161    | warm  | 6.10  | 0.00  | 0.03    | 0.02       | 2.90   | 0.01    | 0.01    |",
    "| test-blank (2 errors) | 4      | cold  | 0.09  | 0.00  | 0.03    | 0.02       | 0.04   | 0.01    | 0.01    |",
    "| test-blank (2 errors) | 4      | warm  | 0.08  | 0.00  | 0.03    | 0.02       | 0.03   | 0.01    | 0.01    |",
  ]);
});
