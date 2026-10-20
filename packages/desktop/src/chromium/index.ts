// oxlint-disable unicorn/no-process-exit -- standalone launcher CLI; exit codes are its interface
import { basename, isAbsolute, resolve } from "node:path";
import type { KeyValuePatch } from "@jxsuite/protocol";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  codeService,
  createProject,
  dataConnectionTest,
  dataConnections,
  dataDeleteRow,
  dataInsertRow,
  dataPush,
  dataRows,
  dataUpdateRow,
  discoverComponents,
  fetchPluginSchema,
  fetchProjectSchemas,
  findReferences,
  formatAction,
  getProjectRoot,
  handleCreateDirectory,
  handleDeleteFile,
  handleReadFile,
  handleReadFileBytes,
  handleRenameFile,
  handleResolveSiteContext,
  handleUploadFile,
  handleWriteFile,
  jxResolve,
  jxServerFunction,
  listDirectory,
  listExtensionCatalog,
  listExtensions,
  listFormats,
  listSecrets,
  locateFile,
  buildSite,
  clearPreviewOverlay,
  previewSite,
  setPreviewOverlay,
  openExternal,
  openProject,
  searchFiles,
  setDirectoryDialog,
  setFileDialog,
  pickProjectFile,
  setFileEventSink,
  setProjectRoot,
  setSecrets,
} from "../handlers";
import {
  gitAddRemote,
  gitBranches,
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitDiscard,
  gitFetch,
  gitInit,
  gitLog,
  gitPull,
  gitPush,
  gitShow,
  gitStage,
  gitStatus,
  gitUnstage,
} from "../git";
import {
  addPackage,
  dependenciesNeedInstall,
  installDependencies,
  listPackages,
  packageVersions,
  removePackage,
  setPackageVersions,
} from "../packages";
import { openDirectoryDialog, openFileDialog } from "./utils";
import { appInfo } from "./app-info";
import {
  findWindowByRoot,
  listWindows,
  nextWelcomeProfile,
  projectProfile,
  registerWindow,
  requestFocus,
  unregisterWindow,
  updateWindow,
  watchFocusRequests,
} from "./window-registry";
import { createProjectServer } from "@jxsuite/server/project-server";
import type { ImportApiOptions } from "@jxsuite/server/import-api";
import { bundleElectronShell } from "../electron-shell/bundle";
import {
  composeShellCommand,
  findChromium,
  findElectron,
  shellEnv,
  shellIcon,
} from "./shell-command";
import type { RpcHandler, RpcResult } from "@jxsuite/server/project-server";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { JsonObject } from "@jxsuite/schema/types";
import { listStarters } from "@jxsuite/starters";
import { readRecents, writeRecents } from "../recent-store";
import { patchSettings, readSettings, watchSettings } from "../settings-store";
import {
  githubSignIn,
  githubSignOut,
  githubTokenStatus,
  setAuthorizationHost,
} from "../github-signin";
import type { RecentProjectEntry, StudioRPC } from "../rpc-schema";

// ─── Project root ────────────────────────────────────────────────────────────

/* A welcome window — one this launcher opened for `File → New Window`, with no project yet. The
   positional argument is the project root and there is no flag surface (specs/desktop.md §9.3), so
   "no project" travels as an environment variable the parent sets and a user never types. Without
   it the child would adopt the parent's cwd, and a New Window opened from a project directory would
   silently re-open that project. */
const welcomeWindow = process.env.JX_STUDIO_NO_PROJECT === "1";

/**
 * The working directory, but only when it is a project — otherwise null.
 *
 * A bare `jx-studio` adopting its cwd is what makes "run it inside a project" open that project,
 * and that stays. What it must not do is adopt a directory that is not one. Launched from a desktop
 * entry or a shell sitting in `$HOME`, the unconditional fallback made the home directory the
 * project root, and the session then watched all of it: every unix socket underneath raised a watch
 * error, and `~/.wine/dosdevices/z:` (a link to `/`) took the walk out of the home directory
 * altogether. The window showed the welcome screen throughout — `probeRootProject` had already
 * decided a directory with no project.json is not a project — so the entire scan was work for a
 * project that was never opened.
 *
 * A root named on the command line or in `JSONSX_PROJECT_ROOT` is still taken at its word; only the
 * one nobody typed has to prove itself.
 */
export function implicitProjectRoot(cwd: string): string | null {
  return existsSync(resolve(cwd, "project.json")) ? cwd : null;
}

const projectRoot = welcomeWindow
  ? null
  : process.argv[2] || process.env.JSONSX_PROJECT_ROOT || implicitProjectRoot(process.cwd());

/**
 * Ask an existing window for this project to come forward; report whether there was one.
 *
 * Two windows on one project is not merely redundant — they would edit the same files through two
 * independent watchers and two undo histories. And before the registry existed the second launcher
 * fared worse than that: its Chromium shares the project's profile directory, so the browser
 * singleton handed the new window to the FIRST launcher's browser and the second launcher exited,
 * leaving a window pointing at a server that had just died.
 */
export function raiseExistingWindow(root: string | null): boolean {
  if (!root) {
    return false;
  }
  const openElsewhere = findWindowByRoot(root);
  if (!openElsewhere) {
    return false;
  }
  console.log(`[chromium] ${root} is already open (pid ${openElsewhere.pid}) — raising it`);
  requestFocus(openElsewhere.pid);
  return true;
}

if (raiseExistingWindow(projectRoot)) {
  process.exit(0);
}

setProjectRoot(projectRoot);
setFileDialog(openFileDialog);
setDirectoryDialog(openDirectoryDialog);

// ─── Windows ─────────────────────────────────────────────────────────────────

/* Where THIS window's browser profile lives. Chromium's process singleton is keyed on it, so it is
   also what makes a window a window: the parent picks the child's directory and passes it down,
   because only the parent can see which ones are already taken. */
const profileDir =
  process.env.JX_STUDIO_PROFILE_DIR ||
  (projectRoot ? projectProfile(projectRoot) : nextWelcomeProfile());

/**
 * Open another window: a fresh launcher process, which is what a window is on this build.
 *
 * @param root Project to open, or null for a welcome window.
 */
function spawnWindow(root: string | null): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    JX_STUDIO_PROFILE_DIR: root ? projectProfile(root) : nextWelcomeProfile(),
    /* "No project" has to be explicit, because the child inherits this process's cwd and would
       otherwise adopt whatever project lives there. */
    JX_STUDIO_NO_PROJECT: root ? "" : "1",
  };
  if (root) {
    delete env.JX_STUDIO_NO_PROJECT;
  }
  /* `import.meta.path`, not argv[1]: it names THIS module however the launcher was started —
     `bun run src/chromium/index.ts`, the Nix wrapper's absolute store path, or a bundle. */
  const child = spawn(process.execPath, [import.meta.path, ...(root ? [root] : [])], {
    detached: true,
    env,
    stdio: "inherit",
  });
  /* Unreferenced and detached: closing the window that opened another must not close the other. */
  child.unref();
}

/**
 * Open `root` in another window, or raise the window that already holds it.
 *
 * The answer is asked BEFORE anything is opened, because the caller has to be able to report which
 * of the two happened — "opened in a new window" is a lie when a window merely came forward.
 */
function openProjectInNewWindow(
  root: string,
): StudioRPC["bun"]["requests"]["openProjectInNewWindow"]["response"] {
  const existing = findWindowByRoot(root);
  if (existing) {
    requestFocus(existing.pid);
    return { focused: true };
  }
  spawnWindow(root);
  return { focused: false };
}

// ─── RPC handler dispatch map ────────────────────────────────────────────────

/**
 * Adapt a handler typed against its own params to the project server's {@link RpcHandler}.
 *
 * The server hands every handler the request frame's decoded `params`, untyped. What the shell
 * sends under each method name is fixed by rpc-schema.ts, which Studio's chromium transport and the
 * hub's per-window map (`hub/handlers.ts`) both compile against, and tests/_rpc-parity.ts holds
 * this map's method names to that schema. A handler that resolves `void` resolves `undefined`,
 * which the server sends as `null`.
 */
function wire<P>(handler: (params: P) => Promise<RpcResult> | Promise<void>): RpcHandler {
  /* SAFETY: `params` is the decoded frame the shell sent for this method, whose shape rpc-schema.ts
     declares and `handler`'s signature (P) restates; and a `Promise<void>` settles to `undefined`,
     which is an RpcResult. */
  return (params) => handler(params as P) as Promise<RpcResult>;
}

/* Exported so the schema↔handler parity test can enumerate the registered method names without
   standing up a browser: a request declared in rpc-schema.ts with no entry here reaches Studio as a
   silent empty result (that is exactly how searchFiles shipped unhandled). */
export const handlers = {
  addPackage: wire(addPackage),
  /* `codeService` declares no params today, but the frame's params are still handed through, so a
     backend that grows them receives what the shell sent. */
  codeService: wire(codeService),
  dependenciesNeedInstall: () => dependenciesNeedInstall(),
  createDirectory: wire(handleCreateDirectory),
  deleteFile: wire(handleDeleteFile),
  discoverComponents: wire(discoverComponents),
  fetchPluginSchema: wire(fetchPluginSchema),
  formatAction: wire(formatAction),
  gitAddRemote: wire(gitAddRemote),
  gitBranches: () => gitBranches(),
  // `View: Open in Browser` builds before it opens, so the reader sees what the author sees.
  buildSite: () => buildSite(),
  previewSite: wire(previewSite),
  /* Both publish synchronously into an in-memory overlay — `rpc-schema` declares `response: void`
     and `createProjectSession` throws where it is called, which `preview-site.test.ts` pins. The
     map's contract is a promise, so the adaptation is here rather than in the session. */
  setPreviewOverlay: wire(async (params: Parameters<typeof setPreviewOverlay>[0]) =>
    setPreviewOverlay(params),
  ),
  clearPreviewOverlay: wire(async (params: Parameters<typeof clearPreviewOverlay>[0]) =>
    clearPreviewOverlay(params),
  ),
  gitCheckout: wire(gitCheckout),
  gitCommit: wire(gitCommit),
  gitCreateBranch: wire(gitCreateBranch),
  gitDiff: wire(gitDiff),
  gitDiscard: wire(gitDiscard),
  gitFetch: wire(() => gitFetch()),
  gitInit: wire(() => gitInit()),
  gitLog: wire(gitLog),
  gitPull: wire(() => gitPull()),
  gitPush: wire(gitPush),
  gitShow: wire(gitShow),
  gitStage: wire(gitStage),
  gitStatus: () => gitStatus(),
  gitUnstage: wire(gitUnstage),
  fetchProjectSchemas: () => fetchProjectSchemas(),
  listDirectory: wire(listDirectory),
  listExtensionCatalog: () => listExtensionCatalog(),
  listExtensions: () => listExtensions(),
  listFormats: () => listFormats(),
  installDependencies: () => installDependencies(),
  listPackages: () => listPackages(),
  locateFile: wire(locateFile),
  searchFiles: wire(searchFiles),
  packageVersions: () => packageVersions(),
  setPackageVersions: wire(setPackageVersions),
  openProject: () => openProject(),
  openExternal: wire(openExternal),
  // About screen. No `updateStatus`: this build is replaced by whatever packaged it, not by itself.
  appInfo: () => Promise.resolve(appInfo()),
  // The picker WITHOUT the binding — `openProject` above re-roots this window as part of picking,
  // Which is the one thing the New Window branch must not do (see StudioPlatform.pickProject).
  pickProject: async () => {
    const picked = await pickProjectFile();
    return picked && { name: picked.name, root: picked.root };
  },
  // Multi-window. A window is a launcher process here; window-registry.ts is the map.
  newWindow: wire(() => {
    spawnWindow(null);
    return Promise.resolve();
  }),
  openProjectInNewWindow: wire(({ root }: { root: string }) =>
    Promise.resolve(openProjectInNewWindow(root)),
  ),
  listOpenWindows: () =>
    Promise.resolve(listWindows().map((win) => ({ id: win.pid, projectRoot: win.root }))),
  createProject: wire(createProject),
  listStarters: () => Promise.resolve(listStarters()),
  pickDirectory: async () => ({ path: await openDirectoryDialog() }),
  getProjectRoot: () => Promise.resolve({ root: getProjectRoot() }),
  setWindowProject: wire(({ root }: { root: string }) => {
    /* Dedupe first: if ANOTHER window already holds this project, raise it and say so rather than
       binding a second window to the same files. Studio treats `deduped` as "nothing was loaded
       here", so this window keeps whatever it was showing. */
    const existing = findWindowByRoot(root, process.pid);
    if (existing) {
      requestFocus(existing.pid);
      return Promise.resolve({ config: null, deduped: true });
    }
    // Rebind this launcher's root in place, then tell the registry so other windows can dedupe
    // Against it. Studio re-reads the project.json itself, so no config is returned.
    setProjectRoot(root);
    updateWindow(process.pid, { name: basename(root.replace(/[/\\]+$/, "")) || null, root });
    return Promise.resolve({ config: null, deduped: false });
  }),
  getRecentProjects: () => readRecents(),
  saveRecentProjects: wire(({ projects }: { projects: RecentProjectEntry[] }) =>
    writeRecents(projects),
  ),
  getSettings: () => readSettings(),
  patchSettings: wire(({ patch }: { patch: KeyValuePatch }) => patchSettings(patch)),
  githubSignIn: wire(githubSignIn),
  githubSignOut: wire(() => githubSignOut()),
  githubToken: () => githubTokenStatus(),
  jxResolve: wire(jxResolve),
  jxServerFunction: wire(jxServerFunction),
  // Data surface + secrets (desktop twins of /__studio/data/* + /__studio/secrets)
  dataConnections: () => dataConnections(),
  dataConnectionTest: wire(dataConnectionTest),
  dataPush: wire(dataPush),
  dataRows: wire(dataRows),
  dataInsertRow: wire(dataInsertRow),
  dataUpdateRow: wire(dataUpdateRow),
  dataDeleteRow: wire(dataDeleteRow),
  listSecrets: () => listSecrets(),
  setSecrets: wire(setSecrets),
  readFile: wire(handleReadFile),
  readFileBytes: wire(handleReadFileBytes),
  removePackage: wire(removePackage),
  renameFile: wire(handleRenameFile),
  findReferences: wire(findReferences),
  resolveSiteContext: wire(handleResolveSiteContext),
  uploadFile: wire(handleUploadFile),
  writeFile: wire(handleWriteFile),
} satisfies Record<string, RpcHandler>;

// ─── Static file serving + WebSocket RPC server ──────────────────────────────

const studioDir = process.env.JX_STUDIO_ASSETS || resolve(import.meta.dir, "../../assets/studio");

// One window, one launcher, one session — whose root tracks the process-global root. The factory
// Re-resolves this on every request/message, so setWindowProject takes effect live.
const defaultSession = {
  get projectRoot(): string | null {
    return getProjectRoot();
  },
  handlers,
};

/* The window's shell (shell-command.ts). Chromium is still looked for when Electron draws the
   window, because it is the site import's headless browser: puppeteer cannot open a page in
   Electron, which answers `Target.createTarget` with "Not supported". */
const electronBin = findElectron(process.env);
const chromiumBin = findChromium(process.env);
if (!chromiumBin && !electronBin) {
  console.error("[chromium] No chromium/chrome found. Install chromium or set CHROMIUM_BIN.");
  process.exit(1);
}

const importApi: ImportApiOptions = {
  resolveDest: (dir) => {
    // The webview resolves the destination under a natively-picked parent before posting.
    if (!isAbsolute(dir)) {
      throw new Error("directory must be an absolute path");
    }
    return dir;
  },
};
if (chromiumBin) {
  importApi.chromePath = chromiumBin;
}

const projectServer = createProjectServer({
  importApi,
  resolveSession: () => defaultSession,
  studioDir,
});

const { url: serverUrl, rpcToken } = projectServer;

/* The OAuth loopback redirect lands on this server, so sign-in cannot be wired until it exists. */
setAuthorizationHost({
  authorizer: projectServer.authorizer,
  port: projectServer.server.port ?? 0,
});

/* Push filesystem changes to the shell so the sidebar stays live, the way the dev server's SSE
   `fs` event does and the hub's per-window `onFileEvents` push does. Registering the sink is
   what STARTS the watcher, and re-rooting the session re-arms it, so this one call covers the whole
   life of the window including the projects it is pointed at later. */
setFileEventSink((events) => {
  projectServer.push("onFileEvents", { events });
});

/* Every chromium window is its own process with its own browser profile, so a settings change made
   in one is invisible to the others until something re-reads the file. The store's watch is what
   carries it across. */
const stopSettingsWatch = watchSettings((settings) => {
  projectServer.push("settingsChanged", { settings });
});

/* Another window may ask this one to come forward (see window-registry.ts). Only the page can
   raise an `--app` window, so the request is relayed to it. */
const stopFocusWatch = watchFocusRequests(process.pid, () => {
  projectServer.push("focusWindow");
});

/* Publish this window so other launchers can find, dedupe against, and raise it. Registered after
   the server exists so the entry can name the origin it is serving. */
registerWindow({
  name: projectRoot ? basename(projectRoot.replace(/[/\\]+$/, "")) || null : null,
  pid: process.pid,
  profileDir,
  root: projectRoot,
  url: serverUrl,
});

/** Leave the registry exactly once, however this process is ending. */
let released = false;
export function releaseWindow(): void {
  if (released) {
    return;
  }
  released = true;
  stopFocusWatch();
  stopSettingsWatch();
  unregisterWindow(process.pid);
}
process.on("exit", releaseWindow);

console.log(`[chromium] Studio server at ${serverUrl}`);
console.log(`[chromium] WebSocket RPC at ${serverUrl.replace(/^http/, "ws")}`);
console.log(`[chromium] Project root: ${projectRoot ?? "(none — welcome window)"}`);

// ─── Launch Chromium ─────────────────────────────────────────────────────────

/**
 * Seed the profile's Preferences so Chromium never offers to save credentials: the credentials
 * form's API-key field is a password input, and without these prefs Chromium offers to save it to
 * the OS password manager on every save. Chrome only honors these as profile preferences (there is
 * no flag), so they are merged into `<user-data-dir>/Default/Preferences` before every launch —
 * preserving whatever else Chromium has written there. A missing or corrupt file is replaced with a
 * fresh object holding just these keys.
 */
export function seedChromiumPreferences(userDataDir: string): void {
  const defaultDir = resolve(userDataDir, "Default");
  const prefsFile = resolve(defaultDir, "Preferences");
  let prefs: JsonObject = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(prefsFile, "utf8"));
    if (isJsonObject(parsed)) {
      prefs = parsed;
    }
  } catch {
    // Missing or corrupt Preferences: start from a fresh object.
  }
  prefs.credentials_enable_service = false;
  const profile = isJsonObject(prefs.profile) ? prefs.profile : {};
  profile.password_manager_enabled = false;
  profile.password_manager_leak_detection = false;
  prefs.profile = profile;
  mkdirSync(defaultDir, { recursive: true });
  writeFileSync(prefsFile, JSON.stringify(prefs), "utf8");
}

/**
 * Flags that depend on where the launcher is running rather than on what it is showing.
 *
 * - A Wayland session gets the Ozone Wayland backend instead of XWayland.
 * - Under snap confinement (`$SNAP` is set by snapd) Chromium's own sandbox cannot start: it needs
 *   `browser-support`'s `allow-sandbox`, which the Snap Store grants only to trusted publishers
 *   after manual review. The snap's confinement is the boundary instead, and the page it loads is
 *   this launcher's own loopback studio. The snap itself now runs the Electron application
 *   (specs/desktop.md §9.6), so this branch serves a launcher started inside confinement. The other
 *   two flags are the ones Canonical's own chromium launcher passes to the same binary: the snap
 *   has no `password-manager-service` plug, so the keyring must not be probed, and the gnome
 *   runtime it links against is GTK 3.
 */
export function chromiumPlatformArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const args: string[] = [];
  if (env.WAYLAND_DISPLAY) {
    args.push("--ozone-platform=wayland", "--enable-features=UseOzonePlatform");
  }
  if (env.SNAP) {
    args.push("--no-sandbox", "--password-store=basic", "--gtk-version=3");
  }
  return args;
}

let shellProcess: ChildProcess | undefined;

/** Start the window's shell (shell-command.ts), and end the launcher with it. */
async function launch(): Promise<void> {
  const command = await composeShellCommand(
    { chromium: chromiumBin, electron: electronBin },
    { platformArgs: chromiumPlatformArgs(), serverUrl, token: rpcToken, userDataDir: profileDir },
    { bundle: bundleElectronShell, icon: shellIcon(), seedChromium: seedChromiumPreferences },
  );
  console.log(`[chromium] Launching ${command.shell}: ${command.bin}`);
  const child = spawn(command.bin, command.args, {
    detached: false,
    env: shellEnv(process.env),
    stdio: "inherit",
  });
  shellProcess = child;
  child.on("close", (code) => {
    console.log(`[chromium] Browser closed (code ${code})`);
    process.exit(0);
  });
}

/* Not a top-level await: Bun's test runtime drops the continuation of one in a module loaded by
   dynamic import (see ../index.ts). `launched` lets tests await the same sequence. */
// oxlint-disable-next-line unicorn/prefer-top-level-await
export const launched = launch();

process.on("SIGINT", () => {
  shellProcess?.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shellProcess?.kill();
  process.exit(0);
});
