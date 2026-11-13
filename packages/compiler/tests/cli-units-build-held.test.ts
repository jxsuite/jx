/**
 * Jx build --include-held: held entries are left out unless a person asks for them, by name.
 *
 * Its own file, for the one-footprint-per-process constraint `_cli-harness.ts` describes.
 */

import { describe, expect, it } from "bun:test";
import { buildSiteCalls, NO_TIMINGS, runEntry, setBuildSite } from "./_cli-harness.ts";

describe("jx cli — --include-held", () => {
  it("asks the build to keep held entries", async () => {
    buildSiteCalls.length = 0;
    setBuildSite(() =>
      Promise.resolve({ errors: [], files: 1, routes: 1, serverEntries: [], timings: NO_TIMINGS }),
    );
    await runEntry("cli", ["build", "--include-held"]);
    expect(buildSiteCalls[0]?.opts).toMatchObject({ includeHeld: true });
  });
});
