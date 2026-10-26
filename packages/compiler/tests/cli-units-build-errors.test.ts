/**
 * Cli-units-build-errors.test.ts — jx build error-list footprint + compile-cli no-arg footprint
 *
 * See _cli-harness.ts for the one-footprint-per-process constraint.
 */

import { describe, expect, it } from "bun:test";
import { runCliCalls, runEntry, setBuildSite } from "./_cli-harness.ts";

describe("jx cli — build completed with errors", () => {
  it("exits 1 and lists every build error", async () => {
    setBuildSite(() =>
      Promise.resolve({
        errors: ["page A failed", "page B failed"],
        files: 0,
        routes: 2,
        serverEntries: [],
      }),
    );
    const result = await runEntry("cli", ["build", "/tmp/jx-cli-site"]);
    expect(result.exited).toBe(true);
    expect(result.exitCode).toBe(1);
    const errorText = result.errors.join("\n");
    expect(errorText).toContain("2 error(s)");
    expect(errorText).toContain("page A failed");
    expect(errorText).toContain("page B failed");
  });
});

describe("jx-compile cli — no source argument", () => {
  it("does nothing without a source argument", async () => {
    runCliCalls.length = 0;
    const result = await runEntry("compile-cli", []);
    expect(result.exited).toBe(false);
    expect(runCliCalls).toHaveLength(0);
  });
});
