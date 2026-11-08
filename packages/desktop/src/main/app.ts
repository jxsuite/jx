/**
 * The Electron application: one main process that owns every Studio window.
 *
 * This is the shell the packaged app runs. Electron is the root process, the backend (`backend/`)
 * is its utility process on Electron's own Node, and a window is a `BrowserWindow` the backend
 * asked for. The division is the one the OS draws: Electron does what only an app can (windows, the
 * menu bar, native dialogs, the single-instance lock, file associations), and the backend does
 * everything about a project. They speak the small protocol in `shared/protocol.ts`; project I/O
 * never crosses it, and stays on each window's token-gated WebSocket.
 *
 * Takes the Electron API as a parameter, like `shell.ts`, so it can be exercised without Electron;
 * `app-main.ts` is the entry that passes the real one.
 *
 * @docs studio/desktop
 */
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as Electron from "electron";
import type { BrowserWindow } from "electron";
import { isString } from "@jxsuite/schema/guards";
import { shellEnv } from "./command";
import type { BackendMessage, DialogKind, ShellMessage } from "../shared/protocol";
import { utilityBackend } from "./backend-process";
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
import { PROJECT_FILE_NAMES, isProjectFileName } from "@jxsuite/schema/project-file";

/**
 * What the app is told: `--jx-<name>=<value>` switches (an unpackaged run's only source) or,
 * packaged, the layout of its own resources, and any bare paths to open.
 */
export interface AppArgs {
  /** The backend bundle, run as a utility process. */
  backend: string;
  /** The window icon. */
  icon: string | null;
  /** The paths the launch was handed, for the backend to make sense of. */
  paths: string[];
  /** The preload bundle every window shares. */
  preload: string;
  /** The project to open first when no path says otherwise, or null for a welcome window. */
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
 * The paths a launch was handed: every bare argument, absolute.
 *
 * Every one, because a file manager passes all of a multi-selection (`%F`), and a `file:` URL is
 * one too, because an AppImage's bundled desktop entry says `%U`. The rest of the argv is switches,
 * the app's own script, and whatever Chromium appends, all of which this tells apart.
 *
 * The bare argument has to work whether or not the app is packaged. An unpackaged run is `electron
 * <switches> <script> …`, so no position in argv is the user's; what is known is where the app
 * lives, and the script is the one bare argument inside that directory. (Not the script's own path:
 * a bundle cannot ask for it. Bun folds `__filename`, `module.filename` and `import.meta.filename`
 * to the source file's name at build time, and `require.main` is Electron's own internal module.) A
 * packaged app's argv has no script, and nothing then lies inside `appPath`.
 *
 * @param args The launch's arguments: everything after the program.
 * @param cwd The launch's working directory.
 * @param appPath The directory the app lives in (`app.getAppPath()`), which holds no project.
 */
export function launchPathsFrom(args: readonly string[], cwd: string, appPath = ""): string[] {
  const paths: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("-")) {
      continue;
    }
    let path: string;
    try {
      path = arg.startsWith("file:") ? fileURLToPath(arg) : resolve(cwd, arg);
    } catch {
      // `file://server/share`, or a URL that does not decode. Kept, so the user is told it can't open.
      path = resolve(cwd, arg);
    }
    if (!isWithin(appPath, path)) {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * The project a launch names when it names no path: `--jx-project=<path>`, else
 * `JSONSX_PROJECT_ROOT`, else the working directory but only when it holds a `project.json`.
 *
 * A path nobody typed has to prove itself. A launch from a desktop entry or a shell sitting in
 * `$HOME` must not adopt the home directory as a project, so that window is a welcome window.
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
  const named = switchValue(args, "project");
  if (named) {
    return projectDirOf(resolve(cwd, named));
  }
  if (launchPathsFrom(args, cwd, appPath).length > 0) {
    return null;
  }
  if (env.JSONSX_PROJECT_ROOT) {
    return resolve(cwd, env.JSONSX_PROJECT_ROOT);
  }
  return PROJECT_FILE_NAMES.some((name) => exists(resolve(cwd, name))) ? cwd : null;
}

/** What a launch wants opened, worked out by the launch that knows its own argv. */
export interface LaunchRequest {
  paths: string[];
  root: string | null;
}

/**
 * Whether a value handed over by a second launch is one of these.
 *
 * @param value What arrived with `second-instance`.
 */
export function isLaunchRequest(
  value: Electron.LaunchData | undefined,
): value is LaunchRequest & Electron.LaunchData {
  if (!value) {
    return false;
  }
  const { paths, root } = value;
  return (
    Array.isArray(paths) &&
    paths.every((path) => isString(path)) &&
    (root === null || isString(root))
  );
}

/**
 * Read the app's switches.
 *
 * @param args The launch's arguments: everything after the program.
 * @param env The launch's environment.
 * @param cwd The launch's working directory.
 * @param exists Whether a path exists.
 * @param appPath The directory the app lives in (`app.getAppPath()`), which holds no project.
 * @param layout A packaged app's own layout, which is all it is told.
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
  /* A packaged app runs what it was packaged with. `--jx-backend=` names a script to run as the
     backend, and a shortcut file can carry arguments, so honouring it there would let a file on the
     desktop run anything inside a signed application. */
  const backend = layout ? layout.backend : switchValue(args, "backend");
  const preload = layout ? layout.preload : switchValue(args, "preload");
  if (!backend || !preload) {
    throw new Error("The Jx Studio app needs --jx-backend and --jx-preload.");
  }
  return {
    backend,
    icon: (layout ? layout.icon : switchValue(args, "icon")) ?? null,
    paths: launchPathsFrom(args, cwd, appPath),
    preload,
    root: projectRootFrom(args, env, cwd, exists, appPath),
    studio: layout?.studio ?? null,
  };
}

/** The project a `--jx-project` switch names: a project file's folder, or the folder. */
export function projectDirOf(path: string): string {
  return isProjectFileName(basename(path)) ? dirname(path) : path;
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

/**
 * The prompt before a folder's code first runs (specs/desktop.md §4.7).
 *
 * It names the folder by its path and never by the project's `name`, which is the folder's to
 * choose, and a prompt reading "Open Acme Corp's site?" is worse than none. A folder's name is the
 * folder's to choose too, so anything that could lay out the text differently (a newline that
 * starts a line of its own, a bidirectional override) is drawn as a replacement character. Cancel
 * is the default, because this is the one answer that cannot be taken back by anything the folder
 * does.
 *
 * @param root The folder.
 */
export function trustPrompt(root: string): Electron.MessageBoxOptions {
  const shown = root.replaceAll(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "\uFFFD");
  return {
    buttons: ["Open", "Cancel"],
    cancelId: 1,
    defaultId: 1,
    detail: `${shown}\n\nA Jx project runs code on this computer with your permissions, so only open a folder you trust. Jx Studio remembers your answer for this folder and doesn't ask again, even if its files change later.`,
    message: "Open this folder and run its code?",
    noLink: true,
    title: "Jx Studio",
    type: "warning",
  };
}

/** What the open dialog returned: the path, and the bookmark that regains it after a relaunch. */
interface Picked {
  bookmark: string | undefined;
  path: string;
}

/**
 * Ask the user for a path with the native dialog, sheet-modal on the focused window when there is
 * one. Electron routes this through the desktop portal on Linux and the system panel elsewhere, so
 * the backend needs no picker of its own.
 */
async function choosePath(
  electron: typeof Electron,
  kind: DialogKind,
  title: string,
  sandboxed = false,
  defaultPath?: string,
): Promise<Picked | null> {
  /* Under the App Sandbox a pick grants exactly what was picked: a project.json would grant that
     one file, and none of the pages beside it. So a sandboxed build asks for the folder. */
  const folder = kind === "directory" || sandboxed;
  const options: Electron.OpenDialogOptions = {
    properties: folder ? ["openDirectory", "createDirectory"] : ["openFile"],
    title: sandboxed && kind === "file" ? "Open project folder" : title,
  };
  if (defaultPath) {
    options.defaultPath = defaultPath;
  }
  if (kind === "file" && !sandboxed) {
    options.filters = [{ extensions: ["jxn", "json"], name: "Project files" }];
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
 * @throws {Error} When an unpackaged run left out a switch.
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
    spawn = utilityBackend(electron.utilityProcess),
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
  /* Handed over with the lock rather than left in argv for the first instance to parse. Only this
     process knows which bare argument is its own script: in a checkout, each launch's bundle may be
     a different path. And Electron warns that the argv the first instance sees can be reordered. */
  const handedOver: LaunchRequest = {
    paths: launchPathsFrom(userArgs(argv), cwd, app.getAppPath()),
    // Not this launch's environment: the first instance's project is not this one's to change.
    root: projectRootFrom(userArgs(argv), {}, cwd, exists, app.getAppPath()),
  };
  if (!app.requestSingleInstanceLock({ ...handedOver })) {
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
  /** What each window holds, as the backend reports it: what a restarted one is told to reopen. */
  const heldRoots = new Map<number, string | null>();
  /** How many paths have arrived from outside, which replace the window a launch would open. */
  let pathsFromOutside = 0;
  /** The welcome window the launch asked for, while it can still be called off. */
  let launchWelcome: ShellMessage | null = null;
  /** Whether the first backend has started, before which nothing can restart it. */
  let backendStarted = false;
  /** Files that arrived before then and need a folder the user has not granted. */
  const awaitingGrant: string[] = [];
  /** One folder prompt at a time, each of which may replace the backend. */
  let grantChain: Promise<void> = Promise.resolve();
  /** Notices on screen, which a `quit` waits for, or the user would never get to read them. */
  let noticesShowing = 0;
  let quitAfterNotices = false;

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
    if (ready && backend) {
      backend.send(message);
    } else {
      queue.push(message);
    }
  }

  /**
   * Tell the user something, with no window needed and none held up: a dialog that blocks the main
   * process would stop every open project from drawing until it is dismissed.
   */
  function notify(message: string): void {
    noticesShowing += 1;
    electron.dialog
      .showMessageBox({
        buttons: ["OK"],
        cancelId: 0,
        defaultId: 0,
        detail: "",
        message,
        noLink: true,
        title: "Jx Studio",
        type: "warning",
      })
      .catch((error: Error) => {
        console.error("[electron-app]", error);
      })
      .finally(() => {
        noticesShowing -= 1;
        if (quitAfterNotices && noticesShowing === 0) {
          app.quit();
        }
      });
  }

  /** Hand a path to the backend, once a sandboxed build has the folder it lies in. */
  function openPath(path: string): void {
    if (!grants || grants.covers(path)) {
      post({ path, type: "open-path" });
    } else if (backendStarted) {
      grantChain = grantChain
        .then(() => grantFolderFor(path))
        .catch((error: Error) => {
          // One failed folder prompt must not stop every file after it.
          console.error("[electron-app]", error);
        });
    } else {
      // A cold launch: asking now would restart a backend that has not started yet.
      awaitingGrant.push(path);
    }
  }

  /** A path arrived from outside: it replaces the welcome window a launch would otherwise open. */
  function openFromOutside(path: string): void {
    pathsFromOutside += 1;
    // Something is being opened now, so an earlier launch's reason to end no longer holds.
    quitAfterNotices = false;
    if (launchWelcome) {
      const queued = queue.indexOf(launchWelcome);
      if (queued !== -1) {
        queue.splice(queued, 1);
      }
      launchWelcome = null;
    }
    openPath(path);
  }

  // A second launch is another request to open something, not another app.
  app.on("second-instance", (_event, secondArgv, secondCwd, additionalData) => {
    // What the launch worked out for itself. Its argv is the fallback, and not the first choice.
    const { paths, root } = isLaunchRequest(additionalData)
      ? additionalData
      : {
          paths: launchPathsFrom(userArgs(secondArgv), secondCwd, app.getAppPath()),
          root: projectRootFrom(userArgs(secondArgv), {}, secondCwd, exists, app.getAppPath()),
        };
    quitAfterNotices = false;
    for (const path of paths) {
      openFromOutside(path);
    }
    if (paths.length === 0 || root !== null) {
      post({ root, type: "open-project" });
    }
  });
  // The OS hands a double-clicked file here (on macOS), possibly before the app is ready.
  app.on("open-file", (event, path) => {
    event.preventDefault();
    openFromOutside(path);
  });
  // One window per project, and the app ends with the last of them.
  app.on("window-all-closed", () => {
    if (!restarting) {
      app.quit();
    }
  });
  app.on("will-quit", () => backend?.kill());

  /* After `whenReady`, so a macOS double-click that launched the app has had its `open-file` first:
     without that the launch's own welcome window opens beside the project. An `open-file` that comes
     later still can call the window off until the backend is listening. */
  await app.whenReady();
  for (const path of args.paths) {
    openFromOutside(path);
  }
  if (args.root !== null || pathsFromOutside === 0) {
    const first: ShellMessage = { root: args.root, type: "open-project" };
    launchWelcome = args.root === null ? first : null;
    post(first);
  }
  installApplicationMenu(electron, platform, {
    newWindow: () => post({ root: null, type: "open-project" }),
    openProject: () => {
      void choosePath(electron, "file", "Open project file", grants !== null).then((picked) => {
        if (!picked) {
          return;
        }
        // A sandboxed build is handed the project's folder; the others, its project file.
        const isProject = grants
          ? PROJECT_FILE_NAMES.some((name) => exists(join(picked.path, name)))
          : isProjectFileName(basename(picked.path));
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
        quitAfterNotices = false;
        window.on("closed", () => {
          windows.delete(id);
          heldRoots.delete(id);
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
        const asker = backend;
        void choosePath(electron, message.kind, message.title, grants !== null).then(
          async (picked) => {
            if (picked && grants && (await needsRestart(picked, message.kind))) {
              // The backend that asked cannot read this folder, and is replaced; its request ends.
              await restartBackend(picked, message.kind);
              return;
            }
            // A replaced backend's ids start again, so its answer could land on another's question.
            if (backend === asker) {
              post({
                path: answerPath(picked, message.kind),
                requestId: message.requestId,
                type: "dialog-result",
              });
            }
          },
        );
        break;
      }
      case "confirm-trust": {
        const { requestId, root } = message;
        const asker = backend;
        /* A replaced backend's ids start again, so an answer about one folder could land on another
           folder's question and trust it. Dropping it opens nothing, which is the safe way to be
           wrong: the user can open the file again. */
        const answer = (trusted: boolean): void => {
          if (backend === asker) {
            post({ requestId, trusted, type: "trust-answer" });
          }
        };
        const parent = electron.BrowserWindow.getFocusedWindow();
        const prompt = trustPrompt(root);
        // Over the window that asked, so nothing can be edited there that its answer would discard.
        const shown = parent
          ? electron.dialog.showMessageBox(parent, prompt)
          : electron.dialog.showMessageBox(prompt);
        shown.then(
          ({ response }) => {
            answer(response === 0);
          },
          (error: Error) => {
            // A prompt that could not be shown was not answered yes.
            console.error("[electron-app]", error);
            answer(false);
          },
        );
        break;
      }
      case "notice": {
        notify(message.message);
        break;
      }
      case "window-root": {
        heldRoots.set(message.id, message.root);
        break;
      }
      case "quit": {
        if (noticesShowing > 0) {
          quitAfterNotices = true;
        } else {
          app.quit();
        }
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
    const child = spawn(args.backend, backendEnv);
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

  /** What the backend that asked is told was chosen: for a project, the project file inside. */
  function answerPath(picked: Picked | null, kind: DialogKind): string | null {
    if (!picked) {
      return null;
    }
    if (grants && kind === "file") {
      // With both, the backend's picker reports the conflict, so either one will do to reach it.
      const file = PROJECT_FILE_NAMES.map((name) => join(picked.path, name)).find((path) =>
        exists(path),
      );
      return file ?? null;
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
    } else if (kind === "file" && !grants) {
      post({ path: picked.path, type: "open-path" });
    } else {
      post({ root: folderOf(picked, kind), type: "open-project" });
    }
  }

  /**
   * Ask for the folder around a file the OS handed a sandboxed build, then open the file.
   *
   * It asks for a folder because the sandbox grants what was handed over, which is that one file
   * and none of the project around it. It starts the dialog beside the file, and it cannot look for
   * the project first, because it cannot read there yet.
   */
  async function grantFolderFor(path: string): Promise<void> {
    if (grants?.covers(path)) {
      post({ path, type: "open-path" });
      return;
    }
    const picked = await choosePath(electron, "file", "Open project folder", true, dirname(path));
    if (picked && isWithin(picked.path, path)) {
      await restartBackend(picked, "file", path);
      return;
    }
    if (picked) {
      notify(`${basename(path)} isn't inside the folder you chose, so Jx Studio can't open it.`);
    }
    // Nothing else is open or on its way, so this launch has nothing left to do.
    if (windows.size === 0 && queue.length === 0) {
      if (noticesShowing > 0) {
        quitAfterNotices = true;
      } else {
        app.quit();
      }
    }
  }

  /**
   * Replace the backend with one that starts after `picked` was granted, then open what was open.
   *
   * Every open window belongs to the old backend, so they close. Unsaved work is the user's to
   * keep, so when a project is open this asks first and does nothing on Cancel.
   */
  async function restartBackend(
    picked: Picked,
    kind: DialogKind,
    thenOpen?: string,
  ): Promise<void> {
    const folder = folderOf(picked, kind);
    const reopen = [
      ...new Set([...heldRoots.values()].filter((root): root is string => root !== null)),
    ];
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
    // Until the new backend says it is listening, messages wait in the queue rather than reach the old.
    ready = false;
    for (const window of windows.values()) {
      window.destroy();
    }
    windows.clear();
    heldRoots.clear();
    queue.length = 0;
    old?.kill();
    startBackend();
    restarting = false;
    for (const root of reopen) {
      post({ root, type: "open-project" });
    }
    if (thenOpen) {
      post({ path: thenOpen, type: "open-path" });
      return;
    }
    // A project file opens its project; a folder picked for somewhere to create one opens nothing.
    post({ root: kind === "file" ? folder : null, type: "open-project" });
  }

  startBackend();
  backendStarted = true;
  for (const path of awaitingGrant.splice(0)) {
    openPath(path);
  }

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
    // The backend a restart replaced is not the one a caller wants, so this reads the live one.
    get backend() {
      /* SAFETY: `startBackend()` ran above, before the handle existed, and a restart replaces the
         backend in the same step that ends the old one, so `backend` is never null here. */
      return backend as BackendProcess;
    },
    windows,
  };
}
