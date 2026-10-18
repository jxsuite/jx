/**
 * The RPC handler map for ONE window of the hub.
 *
 * `chromium/index.ts` answers a window's RPC from module-global functions bound to the one project
 * root its process holds; here a process holds many windows, so every method closes over the
 * window's own `ProjectSession` (and the git and package operations over it). What the webview
 * sends under each name is fixed by `rpc-schema.ts`, and `tests/hub-handlers.test.ts` holds this
 * map's names to that schema, as `tests/chromium-index.test.ts` does the per-window launcher's,
 * because the webview side is the same adapter (`chromium/platform.ts`).
 *
 * The window-level operations (open, focus, retitle, list) are not the session's to answer, so they
 * go through {@link HubControl}, which `window-hub.ts` implements.
 *
 * @docs studio/desktop
 */
import type { AppInfo, KeyValuePatch } from "@jxsuite/protocol";
import type { RpcHandler, RpcResult } from "@jxsuite/server/project-server";
import { listStarters } from "@jxsuite/starters";
import { createGitOps } from "../git";
import { githubSignIn, githubSignOut, githubTokenStatus } from "../github-signin";
import { createPackageOps } from "../packages";
import { pickProjectFile } from "../project-session";
import type { ProjectSession } from "../project-session";
import { readRecents, writeRecents } from "../recent-store";
import { patchSettings, readSettings } from "../settings-store";
import type { RecentProjectEntry } from "../rpc-schema";

/** A window as the handlers see it: the session that answers for it, and nothing about its pixels. */
export interface HubWindow {
  id: number;
  session: ProjectSession;
}

/** One row of the window list. */
export interface WindowRow {
  id: number;
  projectRoot: string | null;
}

/** What opening a project did: it raised a window that already held it, or it made a new one. */
export interface OpenOutcome {
  focused: boolean;
}

/** What a window's handlers may ask of the hub that owns it. */
export interface HubControl {
  /** Version, channel and commit for the About screen. */
  appInfo: () => AppInfo;
  /** The open window other than `except` that holds `root`, if any. */
  findWindowByRoot: (root: string, except?: HubWindow) => HubWindow | null;
  /** Bring a window forward. */
  focus: (window: HubWindow) => void;
  /** Every open window and the project it holds. */
  listOpenWindows: () => WindowRow[];
  /** Open `root` (null for a welcome window), or raise the window that holds it. */
  openProject: (root: string | null) => OpenOutcome;
  /** The window's project changed; retitle it. */
  retitle: (window: HubWindow) => void;
}

/**
 * Adapt a handler typed against its own params to the server's {@link RpcHandler}.
 *
 * The server hands every handler the request frame's decoded `params`, untyped. What the page sends
 * under each name is `rpc-schema.ts`'s, which the handler's signature restates.
 */
function wire<P>(handler: (params: P) => Promise<RpcResult> | Promise<void>): RpcHandler {
  /* SAFETY: `params` is the decoded frame the page sent for this method, whose shape rpc-schema.ts
     declares and `handler`'s signature (P) restates; and a `Promise<void>` settles to `undefined`,
     which is an RpcResult. */
  return (params) => handler(params as P) as Promise<RpcResult>;
}

/**
 * Build the map for one window.
 *
 * @param window The window the handlers answer for.
 * @param hub The hub that owns it.
 */
export function buildWindowHandlers(window: HubWindow, hub: HubControl) {
  const { session } = window;
  const git = createGitOps(session);
  const pkg = createPackageOps(session);
  return {
    addPackage: wire(pkg.addPackage),
    buildSite: () => session.buildSite(),
    clearPreviewOverlay: wire(async (params: Parameters<typeof session.clearPreviewOverlay>[0]) =>
      session.clearPreviewOverlay(params),
    ),
    codeService: wire(session.codeService),
    createDirectory: wire(session.handleCreateDirectory),
    createProject: wire(async (params: Parameters<typeof session.createProject>[0]) => {
      const result = await session.createProject(params);
      hub.retitle(window);
      return result;
    }),
    dataConnections: () => session.dataConnections(),
    dataConnectionTest: wire(session.dataConnectionTest),
    dataDeleteRow: wire(session.dataDeleteRow),
    dataInsertRow: wire(session.dataInsertRow),
    dataPush: wire(session.dataPush),
    dataRows: wire(session.dataRows),
    dataUpdateRow: wire(session.dataUpdateRow),
    deleteFile: wire(session.handleDeleteFile),
    dependenciesNeedInstall: () => pkg.dependenciesNeedInstall(),
    discoverComponents: wire(session.discoverComponents),
    fetchPluginSchema: wire(session.fetchPluginSchema),
    fetchProjectSchemas: () => session.fetchProjectSchemas(),
    findReferences: wire(session.findReferences),
    formatAction: wire(session.formatAction),
    getProjectRoot: () => Promise.resolve({ root: session.projectRoot }),
    getRecentProjects: () => readRecents(),
    getSettings: () => readSettings(),
    gitAddRemote: wire(git.gitAddRemote),
    gitBranches: () => git.gitBranches(),
    gitCheckout: wire(git.gitCheckout),
    gitCommit: wire(git.gitCommit),
    gitCreateBranch: wire(git.gitCreateBranch),
    gitDiff: wire(git.gitDiff),
    gitDiscard: wire(git.gitDiscard),
    gitFetch: wire(() => git.gitFetch()),
    gitInit: wire(() => git.gitInit()),
    gitLog: wire(git.gitLog),
    gitPull: wire(() => git.gitPull()),
    gitPush: wire(git.gitPush),
    gitShow: wire(git.gitShow),
    gitStage: wire(git.gitStage),
    gitStatus: () => git.gitStatus(),
    gitUnstage: wire(git.gitUnstage),
    githubSignIn: wire(githubSignIn),
    githubSignOut: wire(() => githubSignOut()),
    githubToken: () => githubTokenStatus(),
    appInfo: () => Promise.resolve(hub.appInfo()),
    installDependencies: () => pkg.installDependencies(),
    jxResolve: wire(session.jxResolve),
    jxServerFunction: wire(session.jxServerFunction),
    listDirectory: wire(session.listDirectory),
    listExtensionCatalog: () => session.listExtensionCatalog(),
    listExtensions: () => session.listExtensions(),
    listFormats: () => session.listFormats(),
    listOpenWindows: () => Promise.resolve(hub.listOpenWindows()),
    listPackages: () => pkg.listPackages(),
    listSecrets: () => session.listSecrets(),
    listStarters: () => Promise.resolve(listStarters()),
    locateFile: wire(session.locateFile),
    newWindow: wire(() => {
      hub.openProject(null);
      return Promise.resolve();
    }),
    openExternal: wire(session.openExternal),
    openProject: async () => {
      const result = await session.openProject();
      if (result) {
        hub.retitle(window);
      }
      return result;
    },
    openProjectInNewWindow: wire(({ root }: { root: string }) =>
      Promise.resolve(hub.openProject(root)),
    ),
    packageVersions: () => pkg.packageVersions(),
    patchSettings: wire(({ patch }: { patch: KeyValuePatch }) => patchSettings(patch)),
    pickDirectory: () => session.pickDirectory(),
    // The picker WITHOUT the binding: `openProject` above re-roots this window as part of picking.
    pickProject: async () => {
      const picked = await pickProjectFile();
      return picked && { name: picked.name, root: picked.root };
    },
    previewSite: wire(session.previewSite),
    readFile: wire(session.handleReadFile),
    readFileBytes: wire(session.handleReadFileBytes),
    removePackage: wire(pkg.removePackage),
    renameFile: wire(session.handleRenameFile),
    resolveSiteContext: wire(session.handleResolveSiteContext),
    saveRecentProjects: wire(({ projects }: { projects: RecentProjectEntry[] }) =>
      writeRecents(projects),
    ),
    searchFiles: wire(session.searchFiles),
    setPackageVersions: wire(pkg.setPackageVersions),
    setPreviewOverlay: wire(async (params: Parameters<typeof session.setPreviewOverlay>[0]) =>
      session.setPreviewOverlay(params),
    ),
    setSecrets: wire(session.setSecrets),
    setWindowProject: wire(({ root }: { root: string }) => {
      /* Dedupe first: if ANOTHER window holds this project, raise it and say so rather than binding
         a second window to the same files. Studio treats `deduped` as "nothing was loaded here". */
      const existing = hub.findWindowByRoot(root, window);
      if (existing) {
        hub.focus(existing);
        return Promise.resolve({ config: null, deduped: true });
      }
      session.setProjectRoot(root);
      hub.retitle(window);
      return Promise.resolve({ config: null, deduped: false });
    }),
    uploadFile: wire(session.handleUploadFile),
    writeFile: wire(session.handleWriteFile),
  } satisfies Record<string, RpcHandler>;
}
