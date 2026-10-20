/**
 * Where a packaged application keeps what it runs.
 *
 * Electron-builder lays an app out as `app.asar` (the main process and the preload: what Electron
 * itself loads) beside a `resources` directory of files that must stay real files on disk, because
 * a child process cannot be started from inside an archive: the Bun that runs the backend, the
 * backend's bundle and its data, and the studio assets the backend serves. `scripts/stage-app.ts`
 * builds those, `electron-builder.yml` places them, and this is the one place the app learns
 * where.
 *
 * An unpackaged run has no such layout and is told where everything is by `--jx-*` switches.
 *
 * @docs studio/desktop
 */
import { join } from "node:path";

/** The files a packaged application starts its backend from. */
export interface AppLayout {
  /** The backend bundle, run by {@link AppLayout.bun}. */
  backend: string;
  /** The Bun executable carried inside the application. */
  bun: string;
  /** The window icon, on platforms whose windows carry one (macOS draws the bundle's). */
  icon: string | null;
  /** The preload every window shares. */
  preload: string;
  /** The studio assets directory each window's server serves. */
  studio: string;
}

/**
 * The layout of a packaged application.
 *
 * @param resourcesPath Electron's `process.resourcesPath`.
 * @param appPath Electron's `app.getAppPath()`, which for a packaged app is the `app.asar` itself.
 * @param platform The OS the app runs on; Windows' Bun is `bun.exe`.
 */
export function packagedLayout(
  resourcesPath: string,
  appPath: string,
  platform: NodeJS.Platform,
): AppLayout {
  return {
    backend: join(resourcesPath, "backend", "index.js"),
    bun: join(resourcesPath, "bun", platform === "win32" ? "bun.exe" : "bun"),
    icon: platform === "darwin" ? null : join(resourcesPath, "icon.png"),
    preload: join(appPath, "preload.js"),
    studio: join(resourcesPath, "studio"),
  };
}
