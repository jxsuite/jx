/**
 * The Electron application: one main process that owns every Studio window.
 *
 * This is the shell the packaged app runs. Electron is the root process, the Bun backend (`hub/`)
 * is its child, and a window is a `BrowserWindow` the backend asked for, where the per-window
 * launcher (`chromium/index.ts`) makes every window a process of its own. The division is the one
 * the OS draws: Electron does what only an app can (windows, the menu bar, native dialogs, the
 * single-instance lock, file associations), and the backend does everything about a project. They
 * speak the small protocol in `hub/protocol.ts`; project I/O never crosses it, and stays on each
 * window's token-gated WebSocket.
 *
 * Takes the Electron API as a parameter, like `shell.ts`, so it can be exercised without Electron;
 * `app-main.ts` is the entry that passes the real one.
 *
 * @docs studio/desktop
 */
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type * as Electron from "electron";
import type { BrowserWindow } from "electron";
import { shellEnv } from "../chromium/shell-command";
import type { BackendMessage, DialogKind, ShellMessage } from "../hub/protocol";
import { spawnBackend } from "./backend-process";
import type { BackendProcess, SpawnBackend } from "./backend-process";
import { fileGrantStore, openFolderGrants } from "./folder-grants";
import type { GrantStore } from "./folder-grants";
import { packagedLayout } from "./layout";
import type { AppLayout } from "./layout";
import {
  createStudioWindow,
  identifyApp,
  installApplicationMenu,
  raiseWindow,
  registerWindowActions,
  switchValue,
} from "./shell";
import { DEFAULT_SCHEDULE, startUpdates, updatesEnabled } from "./updater";
import type { AutoUpdater, UpdateSchedule } from "./updater";

/**
 * What the app is told: `--jx-<name>=<value>` switches (an unpackaged run's only source) or,
 * packaged, the layout of its own resources, and one bare project path.
 */
export interface AppArgs {
  /** The backend entry the Bun runtime runs. */
  backend: string;
  /** The Bun executable. */
  bun: string;
  /** The window icon. */
  icon: string | null;
  /** The preload bundle every window shares. */
  preload: string;
  /** The project to open first, or null for a welcome window. */
  root: string | null;
  /** The studio assets directory, when the launch names one (a packaged app always does). */
  studio: string | null;
}

/** What the app needs from the machine, each replaceable by a test. */
export interface AppDeps {
  cwd: string;
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
  /** Where a Mac App Store build keeps the folders the user has granted it; a parameter for tests. */
  grantStore?: GrantStore;
  /** Load electron-updater's `autoUpdater`; a parameter so a test never loads the real one. */
  loadUpdater: () => Promise<AutoUpdater>;
  /** Whether this is a Mac App Store install, which the App Store updates. */
  macAppStore: boolean;
  platform: NodeJS.Platform;
  /** Electron's `process.resourcesPath`, where a packaged app keeps its files. */
  resourcesPath: string;
  schedule: UpdateSchedule;
  spawn: SpawnBackend;
  /** Whether this is a Microsoft Store install, which the Store updates. */
  windowsStore: boolean;
}

/** What a started app lets its caller reach. */
export interface AppHandle {
  backend: BackendProcess;
  /** The open windows by the backend's id for them. */
  windows: ReadonlyMap<number, BrowserWindow>;
}

/** Whether `path` is `directory` or lies inside it; an empty `directory` contains nothing. */
function isWithin(directory: string, path: string): boolean {
  if (directory === "") {
    return false;
  }
  const inside = relative(directory, path);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
}

/**
 * The project a launch names: `--jx-project=<path>`, else the first bare argument, else
 * `JSONSX_PROJECT_ROOT`, else the working directory but only when it holds a `project.json`.
 *
 * A path nobody typed has to prove itself. A launch from a desktop entry or a shell sitting in
 * `$HOME` must not adopt the home directory as a project, so that window is a welcome window.
 *
 * The bare argument is what `jx-studio ./site` passes, and it has to work whether or not the app is
 * packaged. An unpackaged run is `electron <switches> <script> …`, so no position in argv is the
 * user's; what is known is where the app lives, and the script is the one bare argument inside that
 * directory. (Not the script's own path: a bundle cannot ask for it. Bun folds `__filename`,
 * `module.filename` and `import.meta.filename` to the source file's name at build time, and
 * `require.main` is Electron's own internal module.) A packaged app's argv has no script, and
 * nothing then lies inside `appPath`.
 *
 * @param args The launch's arguments: everything after the program.
 * @param env The launch's environment.
 * @param cwd The launch's working directory.
 * @param exists Whether a path exists.
 * @param appPath The directory the app lives in (`app.getAppPath()`), which holds no project.
 */
export function projectRootFrom(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  exists: (path: string) => boolean,
  appPath = "",
): string | null {
  const bare = args.find((arg) => !arg.startsWith("-") && !isWithin(appPath, resolve(cwd, arg)));
  const named = switchValue(args, "project") ?? bare;
  if (named) {
    return projectDirOf(resolve(cwd, named));
  }
  if (env.JSONSX_PROJECT_ROOT) {
    return resolve(cwd, env.JSONSX_PROJECT_ROOT);
  }
  return exists(resolve(cwd, "project.json")) ? cwd : null;
}

/**
 * Read the app's switches.
 *
 * @param args The launch's arguments: everything after the program.
 * @param env The launch's environment.
 * @param cwd The launch's working directory.
 * @param exists Whether a path exists.
 * @param appPath The directory the app lives in (`app.getAppPath()`), which holds no project.
 * @param layout A packaged app's own layout, which the switches override.
 * @throws {Error} When neither a switch nor a layout says where something is.
 */
export function parseAppArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  exists: (path: string) => boolean,
  appPath = "",
  layout: AppLayout | null = null,
): AppArgs {
  const backend = switchValue(args, "backend") ?? layout?.backend;
  const bun = switchValue(args, "bun") ?? layout?.bun;
  const preload = switchValue(args, "preload") ?? layout?.preload;
  if (!backend || !bun || !preload) {
    throw new Error("The Jx Studio app needs --jx-backend, --jx-bun and --jx-preload.");
  }
  return {
    backend,
    bun,
    icon: switchValue(args, "icon") ?? layout?.icon ?? null,
    preload,
    root: projectRootFrom(args, env, cwd, exists, appPath),
    studio: layout?.studio ?? null,
  };
}

/** The project directory a path the OS handed us names: a `project.json`'s folder, or the folder. */
export function projectDirOf(path: string): string {
  return basename(path) === "project.json" ? dirname(path) : path;
}

/**
 * Electron's `process.resourcesPath`: the installed app's `resources` directory, empty in a
 * checkout.
 */
function electronResourcesPath(): string {
  return process.resourcesPath ?? "";
}

/** The `autoUpdater` of electron-updater, loaded when an installation that can update itself starts. */
export async function loadAutoUpdater(): Promise<AutoUpdater> {
  const { autoUpdater } = await import("electron-updater");
  return {
    set autoDownload(value: boolean) {
      autoUpdater.autoDownload = value;
    },
    get autoDownload() {
      return autoUpdater.autoDownload;
    },
    set autoInstallOnAppQuit(value: boolean) {
      autoUpdater.autoInstallOnAppQuit = value;
    },
    get autoInstallOnAppQuit() {
      return autoUpdater.autoInstallOnAppQuit;
    },
    checkForUpdates: async () => {
      await autoUpdater.checkForUpdates();
    },
    on: (event, listener) => {
      /* SAFETY: each event `AutoUpdater` declares is one of electron-updater's, and `listener` is
         typed for that event's own payload; TypeScript cannot correlate the generic name. */
      autoUpdater.on(event, listener as never);
    },
    quitAndInstall: () => {
      autoUpdater.quitAndInstall();
    },
  };
}

/** What the open dialog returned: the path, and the bookmark that regains it after a relaunch. */
interface Picked {
  bookmark: string | undefined;
  path: string;
}

/**
 * Ask the user for a path with the native dialog, sheet-modal on the focused window when there is
 * one. Electron routes this through the desktop portal on Linux and the system panel elsewhere,
 * which is what let the launcher's D-Bus and AppleScript pickers go.
 */
async function choosePath(
  electron: typeof Electron,
  kind: DialogKind,
  title: string,
  sandboxed = false,
): Promise<Picked | null> {
  /* Under the App Sandbox a pick grants exactly what was picked: a project.json would grant that
     one file, and none of the pages beside it. So a sandboxed build asks for the folder. */
  const folder = kind === "directory" || sandboxed;
  const options: Electron.OpenDialogOptions = {
    properties: folder ? ["openDirectory", "createDirectory"] : ["openFile"],
    title: sandboxed && kind === "file" ? "Open project folder" : title,
  };
  if (kind === "file" && !sandboxed) {
    options.filters = [{ extensions: ["json"], name: "Project files" }];
  }
  if (sandboxed) {
    options.securityScopedBookmarks = true;
  }
  try {
    const parent = electron.BrowserWindow.getFocusedWindow();
    const result = await (parent
      ? electron.dialog.showOpenDialog(parent, options)
      : electron.dialog.showOpenDialog(options));
    const path = result.canceled ? undefined : result.filePaths[0];
    return path === undefined ? null : { bookmark: result.bookmarks?.[0], path };
  } catch (error) {
    console.error("[electron-app]", error);
    return null;
  }
}

/**
 * Start the application: take the instance lock, spawn the backend, open what it asks for.
 *
 * @param electron The Electron API (`app-main.ts` passes the real module).
 * @param argv The process argv.
 * @param deps The machine, replaceable by a test.
 * @returns The running app, or null when another instance holds the lock and has been told.
 * @throws {Error} When the launcher left out a switch.
 */
export async function startApp(
  electron: typeof Electron,
  argv: readonly string[],
  deps: Partial<AppDeps> = {},
): Promise<AppHandle | null> {
  const {
    cwd = process.cwd(),
    env = process.env,
    exists = existsSync,
    grantStore,
    loadUpdater = loadAutoUpdater,
    macAppStore = process.mas === true,
    platform = process.platform,
    resourcesPath = electronResourcesPath(),
    schedule = { ...DEFAULT_SCHEDULE, setInterval, setTimeout },
    spawn = spawnBackend,
    windowsStore = process.windowsStore === true,
  } = deps;
  const { app } = electron;
  // Everything after the executable; the script, when there is one, is told apart by `appPath`.
  const userArgs = (all: readonly string[]): readonly string[] => all.slice(1);

  /* The name, and with it the profile, come before the lock: the lock lives in the user-data
     directory, and an unpackaged Electron is named "Electron", so without this every unpackaged
     Electron app on the machine would share one lock and one profile with this one. */
  app.setName("Jx Studio");
  app.setPath("userData", join(app.getPath("appData"), "Jx Studio"));

  /* The lock comes before the switches are read: a second launch has no backend of its own to
     describe, only a project to hand to the first, which has already been told by this call. */
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return null;
  }
  const packaged = app.isPackaged;
  const layout = packaged ? packagedLayout(resourcesPath, app.getAppPath(), platform) : null;
  const args = parseAppArgs(userArgs(argv), env, cwd, exists, app.getAppPath(), layout);
  // An unpackaged run on macOS shows Electron's own Dock tile unless it is told otherwise.
  if (args.icon) {
    app.dock?.setIcon(args.icon);
  }
  identifyApp(app, args, platform);

  const windows = new Map<number, BrowserWindow>();
  let backend: BackendProcess | null = null;
  let ready = false;
  let restarting = false;
  const queue: ShellMessage[] = [];
  /** The project folders asked for, in order: what a restarted backend is told to open again. */
  const openRoots: string[] = [];

  /* A Mac App Store build is sandboxed: it reads a folder only after the user picks it, and the
     permission reaches the backend only if the backend started after it was given. Picked folders
     are kept as bookmarks, taken up before the backend starts, and a pick that none covers
     restarts the backend (specs/desktop.md §7.7). */
  const grantsFile = join(app.getPath("appData"), "Jx Studio", "folder-grants.json");
  const grants = macAppStore
    ? openFolderGrants(grantStore ?? fileGrantStore(grantsFile), (bookmark) =>
        app.startAccessingSecurityScopedResource(bookmark),
      )
    : null;

  /** Tell the backend, or hold the message until it says it is listening. */
  function post(message: ShellMessage): void {
    if (message.type === "open-project" && message.root !== null) {
      openRoots.push(message.root);
    }
    if (ready && backend) {
      backend.send(message);
    } else {
      queue.push(message);
    }
  }

  // A second launch is another request to open something, not another app.
  app.on("second-instance", (_event, secondArgv, secondCwd) => {
    const root = projectRootFrom(userArgs(secondArgv), {}, secondCwd, exists, app.getAppPath());
    post({ root, type: "open-project" });
  });
  // The OS hands a double-clicked project.json here (on macOS), possibly before the app is ready.
  app.on("open-file", (event, path) => {
    event.preventDefault();
    post({ root: projectDirOf(path), type: "open-project" });
  });
  // One window per project, and the app ends with the last of them.
  app.on("window-all-closed", () => {
    if (!restarting) {
      app.quit();
    }
  });
  app.on("will-quit", () => backend?.kill());
  post({ root: args.root, type: "open-project" });

  await app.whenReady();
  installApplicationMenu(electron, platform, {
    newWindow: () => post({ root: null, type: "open-project" }),
    openProject: () => {
      void choosePath(electron, "file", "Open project.json", grants !== null).then((picked) => {
        if (!picked) {
          return;
        }
        // A sandboxed build is handed the project's folder; the others, its project.json.
        const isProject = grants
          ? exists(join(picked.path, "project.json"))
          : picked.path.endsWith("project.json");
        if (isProject) {
          void openPicked(picked, "file");
        }
      });
    },
  });
  registerWindowActions(electron);

  function onBackend(message: BackendMessage): void {
    switch (message.type) {
      case "ready": {
        ready = true;
        for (const queued of queue.splice(0)) {
          backend?.send(queued);
        }
        break;
      }
      case "open-window": {
        const { id } = message;
        const window = createStudioWindow(electron, {
          icon: args.icon,
          partition: message.partition,
          preload: args.preload,
          title: message.title,
          url: message.url,
        });
        windows.set(id, window);
        window.on("closed", () => {
          windows.delete(id);
          post({ id, type: "window-closed" });
        });
        window.loadURL(message.url).catch((error: Error) => {
          console.error("[electron-app]", error);
        });
        break;
      }
      case "focus-window": {
        const window = windows.get(message.id);
        if (window) {
          raiseWindow(window);
        }
        break;
      }
      case "set-title": {
        windows.get(message.id)?.setTitle(message.title);
        break;
      }
      case "dialog": {
        void choosePath(electron, message.kind, message.title, grants !== null).then(
          async (picked) => {
            if (picked && grants && (await needsRestart(picked, message.kind))) {
              // The backend that asked cannot read this folder, and is replaced; its request ends.
              await restartBackend(picked, message.kind);
              return;
            }
            post({
              path: answerPath(picked, message.kind),
              requestId: message.requestId,
              type: "dialog-result",
            });
          },
        );
        break;
      }
      case "quit": {
        app.quit();
        break;
      }
      default: {
        // `BackendMessage` is closed, and the adapter has already refused anything else.
        break;
      }
    }
  }

  /* A packaged app tells its backend where the studio assets are and what it is, which are what an
     unpackaged run learns from its environment (the Nix wrapper sets JX_STUDIO_ASSETS). */
  const backendEnv = shellEnv(env);
  if (args.studio) {
    backendEnv.JX_STUDIO_ASSETS = args.studio;
    backendEnv.JX_STUDIO_CHANNEL = "stable";
  }

  /** Start a backend, after taking up every folder grant, so it inherits all of them. */
  function startBackend(): void {
    grants?.restore();
    ready = false;
    const child = spawn(args.bun, args.backend, backendEnv);
    backend = child;
    child.onMessage(onBackend);
    // A backend that is gone leaves windows with nothing to talk to; end rather than show them.
    // One this app replaced on purpose is not that.
    child.onExit(() => {
      if (backend === child) {
        app.quit();
      }
    });
  }

  /** The folder a pick grants: a sandboxed build is always handed the folder itself. */
  function folderOf(picked: Picked, kind: DialogKind): string {
    return grants || kind === "directory" ? picked.path : dirname(picked.path);
  }

  /** What the backend that asked is told was chosen: for a project, the project.json inside. */
  function answerPath(picked: Picked | null, kind: DialogKind): string | null {
    if (!picked) {
      return null;
    }
    if (grants && kind === "file") {
      const file = join(picked.path, "project.json");
      return exists(file) ? file : null;
    }
    return picked.path;
  }

  /** Whether the running backend, which started before this pick, can see the picked folder. */
  async function needsRestart(picked: Picked, kind: DialogKind): Promise<boolean> {
    return !grants?.covers(folderOf(picked, kind));
  }

  /** Open a project the user picked: at once if the backend can read it, else after a restart. */
  async function openPicked(picked: Picked, kind: DialogKind): Promise<void> {
    if (grants && (await needsRestart(picked, kind))) {
      await restartBackend(picked, kind);
    } else {
      post({ root: folderOf(picked, kind), type: "open-project" });
    }
  }

  /**
   * Replace the backend with one that starts after `picked` was granted, then open what was open.
   *
   * Every open window belongs to the old backend, so they close. Unsaved work is the user's to
   * keep, so when a project is open this asks first and does nothing on Cancel.
   */
  async function restartBackend(picked: Picked, kind: DialogKind): Promise<void> {
    const folder = folderOf(picked, kind);
    const reopen = [...new Set(openRoots)];
    if (reopen.length > 0) {
      const { response } = await electron.dialog.showMessageBox({
        buttons: ["Restart", "Cancel"],
        cancelId: 1,
        defaultId: 0,
        detail:
          "The Mac App Store allows Jx Studio into a folder only for a backend that starts after you choose it. Open projects close and reopen; save your work first.",
        message: "Jx Studio needs to restart to open this folder.",
        title: "Jx Studio",
        type: "info",
      });
      if (response !== 0) {
        return;
      }
    }
    if (picked.bookmark) {
      grants?.add(folder, picked.bookmark);
    }
    restarting = true;
    const old = backend;
    backend = null;
    for (const window of windows.values()) {
      window.destroy();
    }
    windows.clear();
    openRoots.length = 0;
    queue.length = 0;
    old?.kill();
    startBackend();
    restarting = false;
    for (const root of reopen) {
      post({ root, type: "open-project" });
    }
    // A project file opens its project; a folder picked for somewhere to create one opens nothing.
    post({ root: kind === "file" ? folder : null, type: "open-project" });
  }

  startBackend();

  if (updatesEnabled({ appImage: env.APPIMAGE, macAppStore, packaged, platform, windowsStore })) {
    loadUpdater()
      .then((updater) => {
        startUpdates(
          updater,
          {
            confirmRestart: async (version) => {
              const { response } = await electron.dialog.showMessageBox({
                buttons: ["Restart Now", "Later"],
                cancelId: 1,
                defaultId: 0,
                detail:
                  "Jx Studio restarts to finish updating. Choosing Later installs it the next time you quit.",
                message: `Jx Studio ${version} is ready.`,
                title: "Jx Studio",
                type: "info",
              });
              return response === 0;
            },
            status: (text) => post({ text, type: "update-status" }),
          },
          schedule,
        );
      })
      .catch((error: Error) => {
        console.error("[electron-app]", error);
      });
  }
  return {
    get backend() {
      if (!backend) {
        throw new Error("the backend is being replaced");
      }
      return backend;
    },
    windows,
  };
}
