/**
 * The guard proved the way CI would meet it: a real failing test file, run as its own `bun test`
 * from this workspace so the preload applies. Unguarded, the fixture's first test hangs Bun's diff
 * printer with no output (measured: still silent when killed at 40 seconds); guarded, the whole
 * file fails in well under a second.
 */
import { expect, test } from "bun:test";

import { DOM_EQUALITY_MESSAGE } from "../src/dom-equality.ts";

/** Ample for a file that fails in tens of milliseconds, and far short of the hang it replaces. */
const DEADLINE_MS = 15_000;

test("deep equality on live elements fails fast and briefly; plain objects keep Bun's diff", async () => {
  const started = performance.now();
  const child = Bun.spawn(["bun", "test", "--isolate", "./tests/fixtures/deep-equality-flood.ts"], {
    cwd: `${import.meta.dir}/..`,
    stderr: "pipe",
    stdout: "pipe",
  });
  const timer = setTimeout(() => {
    child.kill();
  }, DEADLINE_MS);
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  const elapsed = performance.now() - started;
  const output = `${out}${err}`;

  expect(elapsed).toBeLessThan(DEADLINE_MS);
  expect(code).toBe(1);
  expect(output.length).toBeLessThan(6000);
  expect(output).toContain("(fail) two live elements compared deeply are refused");
  expect(output).toContain("expect(received).toEqual(expected): received is <jx-tabs>");
  expect(output).toContain("received.host.strip is <jx-tabs>");
  expect(output.split(DOM_EQUALITY_MESSAGE).length - 1).toBeGreaterThanOrEqual(2);
  expect(output).toContain("(fail) plain objects still fail with Bun's diff");
  expect(output).toContain('-   "count": 2,');
}, 30_000);
