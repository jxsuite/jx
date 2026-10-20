/**
 * The shared preload (`@jxsuite/test-support/preload`) proved against the kit's own elements, the
 * shape that cost CI a run each time: two live `jx-tabs` strips, each carrying its reactive graph.
 * Each fixture is a real failing test, run the way CI runs a file, from this workspace so its
 * `bunfig.toml` preload applies. This is the test that fails if the wiring goes.
 */
import { expect, test } from "bun:test";

import { DOM_EQUALITY_MESSAGE } from "@jxsuite/test-support/dom-equality";

/** Runs one fixture file as its own `bun test`, killing it if it outlives `deadline` ms. */
async function runFixture(file: string, deadline: number) {
  const started = performance.now();
  const child = Bun.spawn(["bun", "test", "--isolate", file], {
    cwd: `${import.meta.dir}/..`,
    stderr: "pipe",
    stdout: "pipe",
  });
  const timer = setTimeout(() => {
    child.kill();
  }, deadline);
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  return { code, elapsed: performance.now() - started, output: `${out}${err}` };
}

test("a failing toBe between two live kit elements prints a few lines, naming both", async () => {
  /* Without the hook the same failure printed 6.6 million lines (338 MB). */
  const { code, output } = await runFixture("./tests/fixtures/inspect-flood.ts", 25_000);
  expect(code).toBe(1);
  expect(output).toContain("(fail) two live strips are not the same element");
  expect(output.length).toBeLessThan(4000);
  /* Distinct markers, not occurrences: under GitHub Actions the child also repeats the message
     as a one-line `::error` annotation, so the same two elements are printed more than once. */
  const markers = new Set(output.matchAll(/<jx-tabs [^\n%]*?#(\d+)/gu).map((match) => match[1]));
  expect(markers.size).toBe(2);
}, 30_000);

test("deep equality on live kit elements is refused at once instead of hanging", async () => {
  /* Without the guard this comparison was measured silent for over 100 seconds. */
  const deadline = 25_000;
  const { code, elapsed, output } = await runFixture(
    "./tests/fixtures/deep-equality-flood.ts",
    deadline,
  );
  expect(elapsed).toBeLessThan(deadline);
  expect(code).toBe(1);
  expect(output).toContain("(fail) two live strips are not deeply equal");
  expect(output).toContain(DOM_EQUALITY_MESSAGE);
  expect(output).toContain("expect(received).toEqual(expected): received is <jx-tabs ");
  expect(output).toContain("(fail) a class instance holding a live strip is refused");
  expect(output).toContain("expect(received).toEqual(expected): received.el is <jx-tabs ");
  expect(output).toContain("(fail) a mock that recorded a live strip is refused");
  expect(output).toContain("toHaveBeenCalledWith(expected): expected[0] is <jx-tabs ");
  expect(output).toContain(" 0 pass\n 3 fail");
  expect(output.length).toBeLessThan(8000);
}, 30_000);
