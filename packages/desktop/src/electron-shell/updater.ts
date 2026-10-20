/**
 * Self-updates for the packaged application, over electron-updater.
 *
 * The updater runs in the Electron main process, which is the only process that can replace the
 * application and restart it. What the rest of the app needs from it is small: Studio's About
 * screen shows a line of words ("Update ready (1.4.2)"), reached through the backend as a protocol
 * message, and the user is asked once, natively, before the app restarts into the new version.
 *
 * Everything the updater touches is a parameter, so a test holds the whole sequence with a fake
 * that emits events by hand. The feed is the one `electron-builder.yml` publishes to: the latest
 * GitHub release's `latest*.yml` files.
 *
 * @docs studio/desktop
 */

/** The `autoUpdater` events this module listens for, and what each carries. */
export interface UpdaterEvents {
  "checking-for-update": () => void;
  error: (error: Error) => void;
  "update-available": (info: UpdateInfo) => void;
  "update-downloaded": (info: UpdateInfo) => void;
  "update-not-available": (info: UpdateInfo) => void;
}

/** What electron-updater says about a release. */
export interface UpdateInfo {
  version: string;
}

/** The slice of electron-updater's `autoUpdater` used here. */
export interface AutoUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates: () => Promise<void>;
  on: <Name extends keyof UpdaterEvents>(event: Name, listener: UpdaterEvents[Name]) => void;
  quitAndInstall: () => void;
}

/** What the surrounding app lets the updater do. */
export interface UpdateHooks {
  /** Ask whether to restart into `version` now. Resolves true to restart. */
  confirmRestart: (version: string) => Promise<boolean>;
  /** Tell the About screen, in words, what the updater last found. */
  status: (text: string) => void;
}

/** When the updater waits before its first check, and between checks. */
export interface UpdateSchedule {
  /** Milliseconds between checks. */
  every: number;
  /** Milliseconds before the first check, so the update never competes with the first window. */
  first: number;
  setInterval: (run: () => void, ms: number) => void;
  setTimeout: (run: () => void, ms: number) => void;
}

/** What decides whether this installation can update itself. */
export interface UpdateEnvironment {
  /** `process.env.APPIMAGE`: set when the Linux app is an AppImage, which is the one that updates. */
  appImage: string | undefined;
  /** Whether this is a packaged build; an unpackaged run has no feed. */
  packaged: boolean;
  platform: NodeJS.Platform;
  /** `process.windowsStore`: a Store install is updated by the Store. */
  windowsStore: boolean;
}

/**
 * Whether this installation updates itself.
 *
 * Only where electron-updater can replace the running application: not in a checkout, not a Store
 * package (the Store does it), and on Linux only the AppImage (a `.deb` is the package manager's).
 * The Nix package and the snap are not AppImages, and their own tools replace them.
 *
 * @param environment The facts it depends on.
 */
export function updatesEnabled(environment: UpdateEnvironment): boolean {
  if (!environment.packaged || environment.windowsStore) {
    return false;
  }
  return environment.platform !== "linux" || environment.appImage !== undefined;
}

/** The default cadence: a first look five seconds in, then every four hours. */
export const DEFAULT_SCHEDULE: Pick<UpdateSchedule, "every" | "first"> = {
  every: 4 * 60 * 60 * 1000,
  first: 5000,
};

/**
 * Start checking for updates, downloading what it finds and asking before it restarts.
 *
 * @param updater Electron-updater's `autoUpdater`.
 * @param hooks What the surrounding app lets it do.
 * @param schedule When to check.
 */
export function startUpdates(
  updater: AutoUpdater,
  hooks: UpdateHooks,
  schedule: UpdateSchedule,
): void {
  updater.autoDownload = true;
  // A user who says "later" still gets the update, the next time the app closes.
  updater.autoInstallOnAppQuit = true;

  let prompted: string | null = null;
  updater.on("checking-for-update", () => hooks.status("Checking for updates"));
  updater.on("update-not-available", () => hooks.status("Up to date"));
  updater.on("update-available", (info) => hooks.status(`Update available (${info.version})`));
  updater.on("update-downloaded", (info) => {
    hooks.status(`Update ready (${info.version})`);
    // Once per version: the four-hourly check finds the same downloaded update again.
    if (prompted === info.version) {
      return;
    }
    prompted = info.version;
    void hooks.confirmRestart(info.version).then((restart) => {
      if (restart) {
        updater.quitAndInstall();
      }
    });
  });
  updater.on("error", (error) => hooks.status(`Update check failed: ${error.message}`));

  const check = (): void => {
    // A failed check also arrives as the `error` event; this only keeps the rejection handled.
    updater.checkForUpdates().catch(() => {});
  };
  schedule.setTimeout(check, schedule.first);
  schedule.setInterval(check, schedule.every);
}
