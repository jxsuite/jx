/**
 * Which program draws this launcher's window, and how it is started.
 *
 * Two shells load the same loopback Studio (specs/desktop.md §9.2):
 *
 * - **Electron** (`electron-shell/`), when `ELECTRON_BIN` names one. Its window is frameless, so
 *   Studio draws the titlebar, window buttons and drag region it draws on every platform. It is
 *   always opt-in: the Electron application of §9.7 does not use this launcher at all, and the snap
 *   leaves the variable unset.
 * - **Chromium `--app`** otherwise: the window frame is the browser's and the desktop's, and Studio
 *   draws none (§9.5 says why a browser cannot do better on Linux).
 *
 * The choice is explicit rather than discovered on `PATH` because the two shells differ visibly. A
 * developer who happens to have `electron` installed should not find their window changed under
 * them.
 *
 * @docs studio/desktop
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { STUDIO_SHELL_PATH } from "./app-id";

/** A program and its arguments, ready for `spawn`. */
export interface ShellCommand {
  args: string[];
  bin: string;
  /** Which shell it is, for the launcher's log line. */
  shell: "chromium" | "electron";
}

/** What both shells are told. */
export interface ShellTarget {
  /** Flags for where the launcher runs (`chromiumPlatformArgs`); both shells are Chromium inside. */
  platformArgs: readonly string[];
  /** The launcher's loopback origin. */
  serverUrl: string;
  /** The per-process token the shell URL carries. */
  token: string;
  /** This window's profile directory (§9.4). */
  userDataDir: string;
}

/** The tokened Studio URL either shell loads. */
export function shellUrl(target: ShellTarget): string {
  return `${target.serverUrl}${STUDIO_SHELL_PATH}?token=${target.token}`;
}

/**
 * The Electron binary to use, or null for the Chromium shell.
 *
 * @param env The launcher's environment.
 * @param which `Bun.which`, injectable for tests.
 */
export function findElectron(
  env: NodeJS.ProcessEnv,
  which: (bin: string) => string | null = Bun.which,
): string | null {
  const named = env.ELECTRON_BIN;
  return named ? which(named) : null;
}

/**
 * Where a macOS browser lives when nothing is on `PATH`: an app bundle's executable. Chrome first,
 * as the browser most machines have, then Chromium.
 */
export const MAC_BROWSER_BUNDLES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
] as const;

/**
 * A Chromium-family browser: the window's shell when Electron is not configured, and the site
 * import's headless browser either way (puppeteer cannot open a page in Electron).
 *
 * @param env The launcher's environment; `CHROMIUM_BIN` wins when it resolves.
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

/** `chromium --app=…`, as §9.2 specifies it. */
export function chromiumShellCommand(bin: string, target: ShellTarget): ShellCommand {
  return {
    args: [
      /* The shell path is a constant because Chromium bakes it into the window's app_id, which is
         the only string a taskbar can match this window to `jx-studio.desktop` by (see app-id.ts). */
      `--app=${shellUrl(target)}`,
      "--class=jx-studio",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1400,900",
      `--user-data-dir=${target.userDataDir}`,
      ...target.platformArgs,
    ],
    bin,
    shell: "chromium",
  };
}

/** Where the bundled shell lives, and the icon its window shows. */
export interface ElectronShellFiles {
  /** The window icon (X11 reads it off the window; Wayland from `jx-studio.desktop`). */
  icon: string | null;
  main: string;
  preload: string;
}

/**
 * `electron <main.js> --jx-…`: Chromium switches first, so Electron applies them to its Chromium,
 * then the entry and the shell's own switches.
 *
 * @param platform The OS the shell will run on; `process.platform` by default.
 */
export function electronShellCommand(
  bin: string,
  target: ShellTarget,
  files: ElectronShellFiles,
  platform: NodeJS.Platform = process.platform,
): ShellCommand {
  const args = [
    ...target.platformArgs,
    /* X11's WM_CLASS; Wayland's app_id comes from the shell's `app.setDesktopName`. Linux only:
       macOS's Electron hands an unknown leading switch to Node, which exits on "bad option". */
    ...(platform === "linux" ? ["--class=jx-studio"] : []),
    files.main,
    `--jx-url=${shellUrl(target)}`,
    `--jx-preload=${files.preload}`,
    `--jx-user-data-dir=${target.userDataDir}`,
  ];
  if (files.icon) {
    args.push(`--jx-icon=${files.icon}`);
  }
  return { args, bin, shell: "electron" };
}

/**
 * The environment the shell is started with: the launcher's own, minus `ELECTRON_RUN_AS_NODE`.
 *
 * Any Electron app that spawns this launcher (VS Code's extension host sets the variable for every
 * process it starts) passes the variable on, and Electron then runs `main.js` as plain Node, where
 * `require("electron")` fails and no window opens. Chromium ignores it, so it is dropped for both.
 *
 * @param env The launcher's environment.
 */
export function shellEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...rest } = env;
  return rest;
}

/** What the multi-window Electron app is started with. */
export interface ElectronAppFiles {
  /** The backend entry, run by Bun. */
  backend: string;
  /** The Bun executable the backend runs under. */
  bun: string;
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
 * Unlike {@link electronShellCommand} it is given no URL and no profile: the backend it spawns
 * stands up a server and a storage partition per window, and tells the app where each one is.
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
    `--jx-bun=${files.bun}`,
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
  return { args, bin, shell: "electron" };
}

/** The binaries the launcher found; at least one is non-null by the time a shell is composed. */
export interface ShellBinaries {
  chromium: string | null;
  electron: string | null;
}

/** What composing a shell may do besides returning its command line. */
export interface ShellDeps {
  /** Bundle the Electron shell (`electron-shell/bundle.ts`). */
  bundle: () => Promise<{ main: string; preload: string }>;
  /** The window icon, from {@link shellIcon}. */
  icon: string | null;
  /** Prepare a Chromium profile before its first launch (`seedChromiumPreferences`). */
  seedChromium: (userDataDir: string) => void;
}

/**
 * The window's shell command: Electron's when one is configured, Chromium `--app` otherwise.
 *
 * @throws {Error} When neither binary was found, which the launcher reports before it gets here.
 */
export async function composeShellCommand(
  bins: ShellBinaries,
  target: ShellTarget,
  deps: ShellDeps,
): Promise<ShellCommand> {
  if (bins.electron) {
    const bundle = await deps.bundle();
    return electronShellCommand(bins.electron, target, { ...bundle, icon: deps.icon });
  }
  if (!bins.chromium) {
    throw new Error("No window shell: set ELECTRON_BIN, or install Chromium.");
  }
  deps.seedChromium(target.userDataDir);
  return chromiumShellCommand(bins.chromium, target);
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
