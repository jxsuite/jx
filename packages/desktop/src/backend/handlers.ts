/**
 * The RPC handler map for ONE window of the hub.
 *
 * One backend process holds many windows, so every method closes over the window's own
 * `ProjectSession` (and the git and package operations over it). What the webview sends under each
 * name is fixed by `rpc-schema.ts`, and `tests/hub-handlers.test.ts` holds this map's names to that
 * schema; the webview side is `webview/platform.ts`.
 *
 * The window-level operations (open, focus, retitle, list) are not the session's to answer, so they
 * go through {@link HubControl}, which `window-hub.ts` implements.
 *
 * @docs studio/desktop
 */
import type { AppInfo, KeyValuePatch } from "@jxsuite/protocol";
import type { RpcConnection, RpcHandler, RpcResult } from "@jxsuite/server/project-server";
import { listStarters } from "@jxsuite/starters";
import { createGitOps } from "./git";
import { githubSignIn, githubSignOut, githubTokenStatus } from "./github-signin";
import { createPackageOps } from "./packages";
import { pickProjectFile } from "./project-session";
import type { ProjectSession } from "./project-session";
import type { AuthorizedRoot } from "./roots";
import { readRecents, writeRecents } from "./recent-store";
import { patchSettings, readSettings } from "./settings-store";
import type { RecentProjectEntry } from "../shared/rpc-schema";

/** A window as the handlers see it: the session that answers for it, and nothing about its pixels. */
export interface HubWindow {
  id: number;
  /**
   * Documents asked of this window that its page has not collected yet. A queue the page drains,
   * rather than a push of each path, because a window can be asked before its page has booted.
   */
  pendingDocuments: string[];
  session: ProjectSession;
}

/** One row of the window list. */
export interface WindowRow {
  id: number;
  projectRoot: string | null;
}

/**
 * What opening a project did: it raised a window that already held it, it made a new one, or the
 * user declined to run the folder's code and it did neither.
 */
export interface OpenOutcome {
  declined?: true;
  focused: boolean;
  /** The folder is not there (moved, renamed or deleted), so nothing was opened. */
  missing?: true;
}

/** What a window's handlers may ask of the hub that owns it. */
export interface HubControl {
  /** Version, channel and commit for the About screen. */
  appInfo: () => AppInfo;
  /** Ask whether a folder may run; null when the user declined. */
  authorize: (root: string) => Promise<AuthorizedRoot | null>;
  /** The open window other than `except` that holds `root`, if any. */
  findWindowByRoot: (root: string, except?: HubWindow) => HubWindow | null;
  /** Bring a window forward. */
  focus: (window: HubWindow) => void;
  /** Whether a window for this folder is on its way: its prompt is up or its server is binding. */
  isOpening: (root: string) => boolean;
  /** Every open window and the project it holds. */
  listOpenWindows: () => WindowRow[];
  /** Whether a folder a window was asked to open is gone (a moved or deleted recent project). */
  folderIsMissing?: (root: string) => boolean;
  /** Open `root` (null for a welcome window), or raise the window that holds it. */
  openProject: (root: string | null) => Promise<OpenOutcome>;
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
 * {@link wire} for a handler that also reads the socket the request arrived on: the project state
 * subscription streams to it, and an overlay is owned by it when its client names no `clientId`.
 */
function wireConnected<P>(
  // oxlint-disable-next-line typescript/no-invalid-void-type -- an overlay call answers nothing
  handler: (params: P, connection?: RpcConnection) => Promise<RpcResult> | RpcResult | void,
): RpcHandler {
  /* SAFETY: as in `wire`: `params` is the decoded frame for this method, whose shape
     rpc-schema.ts declares and `handler`'s signature (P) restates. */
  return async (params, connection) => (await handler(params as P, connection)) ?? undefined;
}

/**
 * {@link wire} for an unconditional write or delete: refused on a socket that has subscribed to the
 * project state, which writes with a base (`project-state.md` §5), and served to any other.
 */
function wireUnconditional<P>(
  method: string,
  session: HubWindow["session"],
  handler: (params: P) => Promise<RpcResult> | Promise<void>,
): RpcHandler {
  return async (params, connection) => {
    session.refuseUnconditional(method, connection);
    /* SAFETY: as in `wire`. */
    return (await handler(params as P)) ?? undefined;
  };
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
    clearPreviewOverlay: wireConnected(session.clearPreviewOverlay),
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
    deleteFile: wireUnconditional("deleteFile", session, session.handleDeleteFile),
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
    newWindow: wire(async () => {
      await hub.openProject(null);
    }),
    openExternal: wire(session.openExternal),
    openProject: async () => {
      const result = await session.openProject();
      if (result) {
        hub.retitle(window);
      }
      return result;
    },
    openProjectInNewWindow: wire(({ root }: { root: string }) => hub.openProject(root)),
    packageVersions: () => pkg.packageVersions(),
    patchSettings: wire(({ patch }: { patch: KeyValuePatch }) => patchSettings(patch)),
    pickDirectory: () => session.pickDirectory(),
    // The picker WITHOUT the binding: `openProject` above re-roots this window as part of picking.
    pickProject: async () => {
      const picked = await pickProjectFile();
      return picked && { name: picked.name, root: picked.root };
    },
    previewSite: wire(session.previewSite),
    projectDelete: wire(session.projectDelete),
    projectSubscribe: wireConnected(session.projectSubscribe),
    projectWrite: wire(session.projectWrite),
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
    setPreviewOverlay: wireConnected(session.setPreviewOverlay),
    setSecrets: wire(session.setSecrets),
    setWindowProject: wire(async ({ root }: { root: string }) => {
      // Before anything asks about, or binds to, a folder that is not there.
      if (hub.folderIsMissing?.(root)) {
        return { config: null, deduped: false, missing: true };
      }
      /* Dedupe first: if ANOTHER window holds this project, raise it and say so rather than binding
         a second window to the same files. Studio treats `deduped` as "nothing was loaded here". */
      const existing = hub.findWindowByRoot(root, window);
      if (existing) {
        hub.focus(existing);
        return { config: null, deduped: true };
      }
      const authorized = await hub.authorize(root);
      if (!authorized) {
        return { config: null, declined: true, deduped: false };
      }
      /* Asked again: everything stays clickable while a prompt is up, so another window may have
         taken this project, or be about to on the same answer. */
      const holder = hub.findWindowByRoot(root, window);
      if (holder) {
        hub.focus(holder);
        return { config: null, deduped: true };
      }
      if (hub.isOpening(root)) {
        return { config: null, deduped: true };
      }
      session.setProjectRoot(authorized);
      hub.retitle(window);
      return { config: null, deduped: false };
    }),
    // Each document once: a page collects what is queued, and whatever it took is no longer queued.
    takeOpenDocuments: () => Promise.resolve(window.pendingDocuments.splice(0)),
    uploadFile: wireUnconditional("uploadFile", session, session.handleUploadFile),
    writeFile: wireUnconditional("writeFile", session, session.handleWriteFile),
  } satisfies Record<string, RpcHandler>;
}
