/**
 * Which program draws this launcher's window, and how it is started.
 *
 * Two shells load the same loopback Studio (specs/desktop.md §9.2):
 *
 * - **Electron** (`electron-shell/`), when `ELECTRON_BIN` names one. Its window is frameless, so
 *   Studio draws the titlebar, window buttons and drag region it draws under Electrobun. The Nix
 *   package sets the variable; on any other machine it is opt-in.
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
 */
export function electronShellCommand(
  bin: string,
  target: ShellTarget,
  files: ElectronShellFiles,
): ShellCommand {
  const args = [
    ...target.platformArgs,
    // X11's WM_CLASS; Wayland's app_id comes from the shell's `app.setDesktopName`.
    "--class=jx-studio",
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
 * The app icon beside this package, when the installed tree carries it.
 *
 * @param path Where to look; the package's own `icon.png` by default.
 */
export function shellIcon(path = resolve(import.meta.dir, "../../icon.png")): string | null {
  return existsSync(path) ? path : null;
}
