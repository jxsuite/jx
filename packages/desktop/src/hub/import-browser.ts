/**
 * The browser the site import drives: puppeteer cannot open a page in Electron, so the import needs
 * a Chromium-family browser of its own.
 *
 * @docs studio/desktop
 */
import { existsSync } from "node:fs";

/**
 * Where a macOS browser lives when nothing is on `PATH`: an app bundle's executable. Chrome first,
 * as the browser most machines have, then Chromium.
 */
export const MAC_BROWSER_BUNDLES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
] as const;

/**
 * A Chromium-family browser for the site import, or null when there is none.
 *
 * @param env The backend's environment; `CHROMIUM_BIN` wins when it resolves.
 * @param platform On macOS a browser is an app bundle rather than a `PATH` entry, so the standard
 *   bundles are tried last.
 * @param which `Bun.which`, injectable for tests. It resolves on every platform, with no dependency
 *   on a POSIX `which`, which a stock Windows shell lacks.
 * @param exists `existsSync`, injectable for tests.
 */
export function findChromium(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  which: (bin: string) => string | null = Bun.which,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const candidates = [
    env.CHROMIUM_BIN,
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
  ];
  for (const bin of candidates) {
    // An unset or empty CHROMIUM_BIN is skipped, not looked up.
    const found = bin ? which(bin) : null;
    if (found) {
      return found;
    }
  }
  if (platform === "darwin") {
    return MAC_BROWSER_BUNDLES.find((bundle) => exists(bundle)) ?? null;
  }
  return null;
}
