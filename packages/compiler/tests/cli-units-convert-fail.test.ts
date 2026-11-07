/**
 * Cli-units-convert-fail.test.ts — jx convert when the project has no converter
 *
 * See _cli-harness.ts for the one-footprint-per-process constraint.
 */

import { describe, expect, it } from "bun:test";
import { runEntry, setRunConvert } from "./_cli-harness.ts";

describe("jx cli — convert", () => {
  it("says why and exits 1", async () => {
    setRunConvert(() => {
      throw new Error("@jxsuite/server is not installed");
    });
    const result = await runEntry("cli", ["convert", "pages", "--to", "jxn"]);
    expect(result.exited).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.errors.join(" ")).toContain("@jxsuite/server is not installed");
  });
});
