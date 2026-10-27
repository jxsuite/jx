/**
 * How a checkout starts the Electron application (`scripts/run-electron-app.ts`): which Electron,
 * with which switches, in which environment, and with which icon.
 *
 * @docs studio/desktop
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as executables from "@jxsuite/schema/which";

/** A program and its arguments, ready for `spawn`. */
export interface ShellCommand {
  args: string[];
  bin: string;
}

/**
 * The Electron binary to use, or null when `ELECTRON_BIN` is unset or does not resolve.
 *
 * @param env The script's environment.
 * @param which `which` from `@jxsuite/schema/which`, injectable for tests.
 */
export function findElectron(
  env: NodeJS.ProcessEnv,
  which: (bin: string) => string | null = executables.which,
): string | null {
  const named = env.ELECTRON_BIN;
  return named ? which(named) : null;
}

/**
 * The environment Electron is started with: the caller's own, minus `ELECTRON_RUN_AS_NODE`.
 *
 * Any Electron app that spawns this script (VS Code's extension host sets the variable for every
 * process it starts) passes the variable on, and Electron then runs the main entry as plain Node,
 * where `require("electron")` fails and no window opens.
 *
 * @param env The caller's environment.
 */
export function shellEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...rest } = env;
  return rest;
}

/** What the multi-window Electron app is started with. */
export interface ElectronAppFiles {
  /** The backend bundle, run as a utility process on Electron's own Node. */
  backend: string;
  /** The window icon. */
  icon: string | null;
  /** The bundled main-process entry (`app-main.js`). */
  main: string;
  /** The bundled preload. */
  preload: string;
}

/**
 * `electron <app-main.js> --jx-…`: the multi-window app (`electron-shell/app.ts`).
 *
 * It is given no URL and no profile: the backend it spawns stands up a server and a storage
 * partition per window, and tells the app where each one is.
 *
 * @param bin The Electron executable.
 * @param files What the app is made of.
 * @param root The project to open first, or null for a welcome window.
 * @param platform The OS the app will run on; `process.platform` by default.
 */
export function electronAppCommand(
  bin: string,
  files: ElectronAppFiles,
  root: string | null,
  platform: NodeJS.Platform = process.platform,
): ShellCommand {
  const args = [
    // X11's WM_CLASS, on Linux only: elsewhere Electron hands an unknown leading switch to Node.
    ...(platform === "linux" ? ["--class=jx-studio"] : []),
    files.main,
    `--jx-backend=${files.backend}`,
    `--jx-preload=${files.preload}`,
  ];
  if (files.icon) {
    args.push(`--jx-icon=${files.icon}`);
  }
  if (root) {
    // A switch, not a bare path: an unpackaged argv has no position that is the user's.
    args.push(`--jx-project=${root}`);
  }
  return { args, bin };
}

/**
 * The icon file a platform shows: macOS gets its own full-bleed tile (`icon-macos.png`, rendered
 * from `icon-macos.svg`, which carries the margin and shadow the Dock expects), everything else the
 * flat `icon.png`.
 *
 * @param platform The OS the app runs on.
 */
export function iconFileFor(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "icon-macos.png" : "icon.png";
}

/**
 * The app icon beside this package, when the installed tree carries it.
 *
 * @param path Where to look; this platform's icon in the package by default.
 */
export function shellIcon(
  path = resolve(import.meta.dir, "../..", iconFileFor(process.platform)),
): string | null {
  return existsSync(path) ? path : null;
}
