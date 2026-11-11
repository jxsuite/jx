/**
 * Cli-units-format-fail.test.ts — jx format says why it could not start
 *
 * See _cli-harness.ts for the one-footprint-per-process constraint.
 */

import { describe, expect, it } from "bun:test";
import { runEntry, setRunFormat } from "./_cli-harness.ts";

describe("jx cli — format", () => {
  it("says why and exits 1", async () => {
    setRunFormat(() => {
      throw new Error("@jxsuite/server is not installed");
    });
    const result = await runEntry("cli", ["format"]);
    expect(result.exited).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.errors.join(" ")).toContain("@jxsuite/server is not installed");
  });
});
