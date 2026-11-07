/**
 * Cli-units-convert-ok.test.ts — jx convert hands its arguments on, from the working directory
 *
 * See _cli-harness.ts for the one-footprint-per-process constraint.
 */

import { describe, expect, it } from "bun:test";
import { runConvertCalls, runEntry, setRunConvert } from "./_cli-harness.ts";

describe("jx cli — convert", () => {
  it("takes its positionals as paths, not as a project root", async () => {
    runConvertCalls.length = 0;
    setRunConvert(() => ({}));
    const result = await runEntry("cli", ["convert", "pages", "components", "--to", "jxn"]);
    expect(result.exited).toBe(false);
    expect(runConvertCalls).toEqual([
      { argv: ["pages", "components", "--to", "jxn"], root: process.cwd() },
    ]);
  });
});
