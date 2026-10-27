/**
 * Where a packaged application keeps what it runs.
 *
 * Electron-builder lays an app out as `app.asar` (the main process and the preload: what Electron
 * itself loads) beside a `resources` directory of files that must stay real files on disk, because
 * a utility process cannot be started from inside an archive: the backend's bundle with its data
 * and native modules, and the studio assets the backend serves. `scripts/stage-app.ts` builds
 * those, `electron-builder.yml` places them, and this is the one place the app learns where.
 *
 * An unpackaged run has no such layout and is told where everything is by `--jx-*` switches.
 *
 * @docs studio/desktop
 */
import { join } from "node:path";

/** The files a packaged application starts its backend from. */
export interface AppLayout {
  /** The backend bundle, run as a utility process on Electron's own Node. */
  backend: string;
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
 * @param platform The OS the app runs on; macOS draws its window icon from the bundle.
 */
export function packagedLayout(
  resourcesPath: string,
  appPath: string,
  platform: NodeJS.Platform,
): AppLayout {
  return {
    backend: join(resourcesPath, "backend", "index.js"),
    icon: platform === "darwin" ? null : join(resourcesPath, "icon.png"),
    preload: join(appPath, "preload.js"),
    studio: join(resourcesPath, "studio"),
  };
}
