/** The package barrel: every public entry point re-exports from the phase modules. */
import { describe, expect, test } from "bun:test";
import * as api from "../src/index.ts";

describe("package exports", () => {
  test("exposes the pipeline surface", () => {
    const exported = new Map(Object.entries(api));
    for (const name of [
      "importSite",
      "capturePage",
      "launchBrowser",
      "closeBrowser",
      "convertToJx",
      "emitProject",
      "emitMultiPageProject",
      "captureStyles",
      "diffAllStyles",
      "extractMedia",
      "applyStylesToTree",
      "collectAssets",
      "downloadAssets",
      "rewriteAssetUrls",
      "applyTokens",
      "crawlSite",
      "detectLayout",
      "componentize",
      "aiComponentize",
      "diffScreenshots",
      "verifyProject",
    ] as const) {
      expect(exported.get(name)).toBeFunction();
    }
    expect(Array.isArray(api.STYLE_ALLOWLIST)).toBe(true);
  });
});
