/**
 * Cli-units-format-ok.test.ts — jx format hands its arguments on, from the working directory
 *
 * See _cli-harness.ts for the one-footprint-per-process constraint.
 */

import { describe, expect, it } from "bun:test";
import { runEntry, runFormatCalls, setRunFormat } from "./_cli-harness.ts";

describe("jx cli — format", () => {
  it("takes its positionals as paths, not as a project root", async () => {
    runFormatCalls.length = 0;
    setRunFormat(() => ({}));
    const result = await runEntry("cli", ["format", "pages", "--check"]);
    expect(result.exited).toBe(false);
    expect(runFormatCalls).toEqual([{ argv: ["pages", "--check"], root: process.cwd() }]);
  });
});
