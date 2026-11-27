/** `jx db push` — a section owner's error prints with the whole push, then exits 1. */

import { expect, test } from "bun:test";
import { runEntry, setDbPush } from "./_cli-harness";

test("db push with a failed section prints the connection lines and error, then exits 1", async () => {
  setDbPush(async () => ({
    bindingsPatched: false,
    results: [
      {
        applied: true,
        connection: "main",
        provider: "sqlite",
        statements: [],
        tables: [],
        warnings: [],
      },
    ],
    sections: [{ applied: false, error: "boom", section: "auth", steps: [], warnings: [] }],
    wranglerPath: null,
  }));
  const run = await runEntry("cli", ["db", "push", "/proj"]);
  expect(run.exited).toBe(true);
  expect(run.exitCode).toBe(1);
  expect(run.logs.some((l) => l.includes("main (sqlite)"))).toBe(true);
  expect(run.logs.some((l) => l.includes("auth (section) — 0 step(s) [dry-run]"))).toBe(true);
  expect(run.errors.some((e) => e.includes("error: boom"))).toBe(true);
});
