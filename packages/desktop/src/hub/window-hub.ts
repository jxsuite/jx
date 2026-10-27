/**
 * The window hub: every project window of the app, in one Bun process.
 *
 * A `Map` of windows, one `ProjectSession` and one loopback server each, deduped by normalized
 * project root. The hub never draws a window. It tells the Electron main process to (`open-window`,
 * `focus-window`, `set-title`, over `protocol.ts`) and is told when one closes. Everything a
 * window's page asks of the project goes to that window's own server, through the webview adapter
 * (`webview/platform.ts`).
 *
 * One server per window rather than one for all of them, though `createProjectServer` could route
 * by window id: a window's server holds its own token and its own session, so a canvas iframe,
 * which is cross-origin by construction and carries that token in its URL, can drive its own
 * project and no other.
 *
 * @docs studio/desktop
 */
import { createHash } from "node:crypto";
import type { AppInfo } from "@jxsuite/protocol";
import type { ImportApiOptions } from "@jxsuite/server/import-api";
import { createProjectServer } from "@jxsuite/server/project-server";
import type {
  CreateProjectServerOptions,
  ProjectServerHandle,
} from "@jxsuite/server/project-server";
import { setAuthorizationHost } from "../github-signin";
import { createProjectSession, setDirectoryDialog, setFileDialog } from "../project-session";
import { watchSettings } from "../settings-store";
import { buildWindowHandlers } from "./handlers";
import { STUDIO_SHELL_PATH, normalizeRoot } from "./roots";
import type { HubControl, HubWindow, OpenOutcome, WindowRow } from "./handlers";
import type { BackendMessage, DialogKind, ShellMessage } from "./protocol";

/** What the hub is built from. */
export interface WindowHubOptions {
  /** Version, channel and commit for the About screen. */
  appInfo: () => AppInfo;
  /** Site import's options, or absent when there is no browser to drive it with. */
  importApi?: ImportApiOptions;
  /** Speak to the Electron main process. */
  send: (message: BackendMessage) => void;
  /** The studio assets directory each window's server serves. */
  studioDir: string;
  /** The user-settings watch; a parameter so a test need not watch the real store. */
  watchSettings?: typeof watchSettings;
}

/** A window and the server that answers for it. */
interface Entry extends HubWindow {
  partition: string;
  server: ProjectServerHandle;
}

/** The hub's public face: the shell's messages in, and the windows it holds. */
export interface WindowHub {
  /** Stop every window's server and the settings watch; pending dialogs resolve as cancelled. */
  dispose: () => void;
  /** React to a message from the Electron main process. */
  handle: (message: ShellMessage) => void;
  /** Open `root` (null for a welcome window) or raise the window that holds it. */
  openProject: (root: string | null) => OpenOutcome;
  /** Every open window and the project it holds. */
  windows: () => WindowRow[];
}

/**
 * A window's title: the project's folder name, then the app's.
 *
 * @param root The project root, or null for a welcome window.
 */
export function titleFor(root: string | null): string {
  if (!root) {
    return "Jx Studio";
  }
  const name = root
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .pop();
  // A root with no folder name (the volume root) has nothing to put before the app's.
  return name ? `${name} — Jx Studio` : "Jx Studio";
}

/**
 * The storage partition a project's window keeps its page storage in.
 *
 * It is the Electron-side twin of the Linux launcher's per-project Chromium profile: one project's
 * layout and settings stay apart from another's, and survive the window. Hashed because a path is
 * not a legal partition name and a project's location is nobody's business but the user's.
 *
 * @param root The project root.
 */
export function projectPartition(root: string): string {
  const key = createHash("sha256").update(normalizeRoot(root)).digest("hex").slice(0, 16);
  return `persist:project-${key}`;
}

/**
 * Create the hub.
 *
 * @param options Its collaborators.
 */
export function createWindowHub(options: WindowHubOptions): WindowHub {
  const { appInfo, importApi, send, studioDir } = options;
  const windows = new Map<number, Entry>();
  const dialogs = new Map<number, (path: string | null) => void>();
  // What the updater last said, which only the shell hears; the About screen asks the backend.
  let updateStatus: string | null = null;
  let nextWindow = 1;
  let nextDialog = 1;

  /** The window other than `except` that holds `root`, if any. */
  function findWindowByRoot(root: string, except?: HubWindow): Entry | null {
    const key = normalizeRoot(root);
    for (const entry of windows.values()) {
      const held = entry.session.projectRoot;
      if (entry !== except && held && normalizeRoot(held) === key) {
        return entry;
      }
    }
    return null;
  }

  /** The lowest `welcome-<n>` partition no open window is using, so a welcome window keeps its. */
  function welcomePartition(): string {
    const used = new Set([...windows.values()].map((entry) => entry.partition));
    for (let index = 0; ; index += 1) {
      const partition = `persist:welcome-${index}`;
      if (!used.has(partition)) {
        return partition;
      }
    }
  }

  function focus(window: HubWindow): void {
    send({ id: window.id, type: "focus-window" });
  }

  function retitle(window: HubWindow): void {
    send({ id: window.id, title: titleFor(window.session.projectRoot), type: "set-title" });
  }

  /**
   * Ask the user for a path through the shell's native dialog.
   *
   * @param kind Whether to pick a project file or a folder.
   * @param title The dialog's title.
   */
  function requestDialog(kind: DialogKind, title: string): Promise<string | null> {
    const requestId = nextDialog;
    nextDialog += 1;
    return new Promise((resolve) => {
      dialogs.set(requestId, resolve);
      send({ kind, requestId, title, type: "dialog" });
    });
  }

  const control: HubControl = {
    appInfo: () => {
      const info = appInfo();
      return updateStatus === null ? info : { ...info, updateStatus };
    },
    findWindowByRoot,
    focus,
    listOpenWindows: () => [...windows.values()].map((entry) => windowRow(entry)),
    openProject,
    retitle,
  };

  /** One row of the window list. */
  function windowRow(entry: Entry): WindowRow {
    return { id: entry.id, projectRoot: entry.session.projectRoot };
  }

  /**
   * Open a window for a project, or raise the one that already holds it.
   *
   * Two windows on one project would edit the same files through two watchers and two undo
   * histories, so the dedupe is not a nicety. The answer is returned because the caller has to be
   * able to say which of the two happened.
   */
  function openProject(root: string | null): OpenOutcome {
    const existing = root ? findWindowByRoot(root) : null;
    if (existing) {
      focus(existing);
      return { focused: true };
    }
    openWindow(root);
    return { focused: false };
  }

  function openWindow(root: string | null): void {
    const id = nextWindow;
    nextWindow += 1;
    const session = createProjectSession(root);
    const partition = root ? projectPartition(root) : welcomePartition();
    const window: HubWindow = { id, session };
    const handlers = buildWindowHandlers(window, control);
    const serverOptions: CreateProjectServerOptions = {
      resolveSession: () => ({
        get projectRoot(): string | null {
          return session.projectRoot;
        },
        handlers,
      }),
      studioDir,
    };
    if (importApi) {
      serverOptions.importApi = importApi;
    }
    const server = createProjectServer(serverOptions);
    /* The same object the handlers closed over, completed: `findWindowByRoot(…, window)` compares by
       identity, and a copy here would make a window dedupe against itself. */
    windows.set(id, Object.assign(window, { partition, server }));
    // Registering the sink is what starts the watcher; re-rooting the session re-arms it.
    session.setFileEventSink((events) => {
      server.push("onFileEvents", { events });
    });
    claimAuthorizationRedirect(server);
    send({
      id,
      partition,
      title: titleFor(root),
      type: "open-window",
      url: `${server.url}${STUDIO_SHELL_PATH}?token=${server.rpcToken}`,
    });
  }

  /**
   * Point the OAuth redirect at a window's loopback server.
   *
   * The redirect lands on THIS window's server, so the newest window owns it. That is right for a
   * flow the user starts from a window and finishes in a browser seconds later; one outstanding
   * when another window opens is abandoned, and says so, rather than redirecting to a port nobody
   * is listening on.
   */
  function claimAuthorizationRedirect(server: ProjectServerHandle): void {
    setAuthorizationHost({ authorizer: server.authorizer, port: server.server.port ?? 0 });
  }

  function closeWindow(id: number): void {
    const entry = windows.get(id);
    if (!entry) {
      return;
    }
    windows.delete(id);
    entry.server.stop();
    // Re-rooting to nothing stops the watcher and drops the unsaved-preview and format caches.
    entry.session.setProjectRoot(null);
    // The redirect must not name a server that just stopped.
    const newest = [...windows.values()].at(-1);
    if (newest) {
      claimAuthorizationRedirect(newest.server);
    }
  }

  /* Every window has its own webview and so its own settings kernel: a change made in one is news
     to the others exactly as it is across processes under the Linux launcher. */
  const stopSettingsWatch = (options.watchSettings ?? watchSettings)((settings) => {
    for (const entry of windows.values()) {
      entry.server.push("settingsChanged", { settings });
    }
  });

  setFileDialog(() => requestDialog("file", "Open project.json"));
  setDirectoryDialog(() => requestDialog("directory", "Choose a folder for your new project"));

  return {
    dispose: () => {
      stopSettingsWatch();
      // Deleting the visited entry mid-iteration is what a Map permits, and `closeWindow` does.
      for (const id of windows.keys()) {
        closeWindow(id);
      }
      for (const resolve of dialogs.values()) {
        resolve(null);
      }
      dialogs.clear();
      setFileDialog(null);
      setDirectoryDialog(null);
    },
    handle: (message) => {
      switch (message.type) {
        case "open-project": {
          openProject(message.root);
          break;
        }
        case "window-closed": {
          closeWindow(message.id);
          break;
        }
        case "dialog-result": {
          const resolve = dialogs.get(message.requestId);
          dialogs.delete(message.requestId);
          resolve?.(message.path);
          break;
        }
        case "update-status": {
          updateStatus = message.text;
          break;
        }
        default: {
          // `ShellMessage` is closed, and the entry has already refused anything else.
          break;
        }
      }
    },
    openProject,
    windows: () => [...windows.values()].map((entry) => windowRow(entry)),
  };
}
