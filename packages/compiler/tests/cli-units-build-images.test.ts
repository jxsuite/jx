/**
 * Jx build with JX_IMAGES_OPTIMIZE=off: a build can be told to leave images alone without editing
 * the project, which is how a preview deploy skips the encoding.
 *
 * Its own file, for the one-footprint-per-process constraint `_cli-harness.ts` describes. What
 * counts as "off" is `imagesOptimizeOff`'s to decide, and `site-loader.test.ts` holds it to that.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { buildSiteCalls, NO_TIMINGS, runEntry, setBuildSite } from "./_cli-harness.ts";

describe("jx cli — image optimization for one build", () => {
  afterAll(() => {
    delete process.env.JX_IMAGES_OPTIMIZE;
  });

  it("asks the build to leave images alone when the environment says off", async () => {
    buildSiteCalls.length = 0;
    setBuildSite(() =>
      Promise.resolve({ errors: [], files: 1, routes: 1, serverEntries: [], timings: NO_TIMINGS }),
    );
    process.env.JX_IMAGES_OPTIMIZE = "off";
    await runEntry("cli", ["build"]);
    expect(buildSiteCalls[0]?.opts).toMatchObject({ optimizeImages: false });
  });
});
