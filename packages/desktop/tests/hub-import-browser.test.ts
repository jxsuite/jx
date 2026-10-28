import { describe, expect, test } from "bun:test";
import { MAC_BROWSER_BUNDLES, findChromium } from "../src/backend/import-browser";

describe("findChromium", () => {
  const none = (): string | null => null;

  test("CHROMIUM_BIN wins, then the PATH names in order", () => {
    const seen: string[] = [];
    const which = (bin: string): string | null => {
      seen.push(bin);
      return bin === "google-chrome" ? "/usr/bin/google-chrome" : null;
    };
    expect(findChromium({ CHROMIUM_BIN: "/opt/c" }, "linux", which)).toBe("/usr/bin/google-chrome");
    expect(seen).toEqual(["/opt/c", "chromium", "chromium-browser", "google-chrome"]);
  });

  test("an empty CHROMIUM_BIN is skipped, not looked up", () => {
    const seen: string[] = [];
    findChromium({ CHROMIUM_BIN: "" }, "linux", (bin) => {
      seen.push(bin);
      return null;
    });
    expect(seen).not.toContain("");
  });

  test("on Linux, nothing on PATH is no browser, whatever is in /Applications", () => {
    expect(findChromium({}, "linux", none, () => true)).toBeNull();
  });

  test("on macOS, falls back to the standard app bundles, Chrome first", () => {
    expect(findChromium({}, "darwin", none, () => true)).toBe(MAC_BROWSER_BUNDLES[0]);
    expect(findChromium({}, "darwin", none, (p) => p === MAC_BROWSER_BUNDLES[1])).toBe(
      MAC_BROWSER_BUNDLES[1],
    );
    expect(findChromium({}, "darwin", none, () => false)).toBeNull();
  });

  test("defaults to the host's platform, Bun.which and the filesystem", () => {
    expect(findChromium({ CHROMIUM_BIN: "sh" })).toBe(Bun.which("sh"));
  });
});
