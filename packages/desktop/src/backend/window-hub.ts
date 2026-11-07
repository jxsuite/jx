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
import { setAuthorizationHost } from "./github-signin";
import {
  createProjectSession,
  resolveOpenTarget,
  setDirectoryDialog,
  setFileDialog,
} from "./project-session";
import type { RootGate } from "./project-session";
import { watchSettings } from "./settings-store";
import { buildWindowHandlers } from "./handlers";
import { STUDIO_SHELL_PATH, normalizeRoot, realRoot } from "./roots";
import type { AuthorizedRoot } from "./roots";
import { openTrustStore } from "./trust-store";
import type { TrustStore } from "./trust-store";
import type { HubControl, HubWindow, OpenOutcome, WindowRow } from "./handlers";
import type { BackendMessage, DialogKind, ShellMessage } from "../shared/protocol";

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
  /** Which folders the user has agreed to run; a parameter so a test need not touch the real store. */
  trust?: TrustStore;
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
  /**
   * Resolve once every window being opened has its server and has been announced.
   *
   * Opening is asynchronous because a server binds asynchronously; `openProject` answers at once
   * (the dedupe does not wait), and the `open-window` message follows when the port is known.
   */
  idle: () => Promise<void>;
  /** Open `root` (null for a welcome window) or raise the window that holds it, showing `file`. */
  openProject: (root: string | null, file?: string | null) => Promise<OpenOutcome>;
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
 * How long a launch that ended with nothing open waits before ending the app.
 *
 * Several paths reach the backend as separate messages, so the first one being refused says nothing
 * about the second, which may be a moment behind it on the channel.
 */
const QUIT_GRACE_MS = 300;

/**
 * Create the hub.
 *
 * @param options Its collaborators.
 */
export function createWindowHub(options: WindowHubOptions): WindowHub {
  const { appInfo, importApi, send, studioDir, trust = openTrustStore() } = options;
  const windows = new Map<number, Entry>();
  const dialogs = new Map<number, (path: string | null) => void>();
  // What the updater last said, which only the shell hears; the About screen asks the backend.
  let updateStatus: string | null = null;
  let nextWindow = 1;
  /**
   * Windows not on screen yet, whose prompt is up or whose server is still binding: what they will
   * become (for the dedupe), the documents asked of them meanwhile, and how it came out.
   */
  const opening = new Map<
    number,
    { done: Promise<OpenOutcome>; files: string[]; key: string | null; partition: string }
  >();
  /** The answers being waited for, so a folder asked about twice at once is asked once. */
  const prompts = new Map<string, Promise<boolean>>();
  /** The prompts on screen, by the id the shell answers with. */
  const trustAnswers = new Map<number, (trusted: boolean) => void>();
  let quitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set by `dispose`, so a server that finishes binding afterwards is stopped, not shown. */
  let disposed = false;
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
    const used = new Set([
      ...[...windows.values()].map((entry) => entry.partition),
      ...[...opening.values()].map((pending) => pending.partition),
    ]);
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

  /** Bring a window forward and queue a document for it, which its page collects when it can. */
  function raise(window: Entry, file: string | null): void {
    focus(window);
    if (file) {
      window.pendingDocuments.push(file);
      window.server.push("documentsPending", {});
    }
  }

  function retitle(window: HubWindow): void {
    // A window can close while a prompt it asked is up, and the shell has already forgotten it.
    if (!windows.has(window.id)) {
      return;
    }
    const root = window.session.projectRoot;
    send({ id: window.id, root, type: "window-root" });
    send({ id: window.id, title: titleFor(root), type: "set-title" });
  }

  /** Ask the user, through the shell's native dialog, whether to run a folder's code. */
  function askTrust(root: string): Promise<boolean> {
    if (disposed) {
      return Promise.resolve(false);
    }
    const requestId = nextDialog;
    nextDialog += 1;
    return new Promise((resolve) => {
      trustAnswers.set(requestId, resolve);
      // The folder this answer is about, which is not what a symlink's own name would claim.
      send({ requestId, root: realRoot(root), type: "confirm-trust" });
    });
  }

  /**
   * Whether the user has agreed, or now agrees, to run a folder's code. Asks at most once at a
   * time.
   */
  function ensureTrusted(root: string): Promise<boolean> {
    const key = normalizeRoot(root);
    const asked = prompts.get(key);
    if (asked) {
      return asked;
    }
    const answer = (async () => {
      if (await trust.isTrusted(root)) {
        return true;
      }
      const trusted = await askTrust(root);
      if (trusted) {
        // A store that cannot be written costs a second prompt next time, and not this open.
        await trust.grant(root).catch((error: Error) => {
          console.error("[hub] remembering a trusted folder failed:", error);
        });
      }
      return trusted;
    })().finally(() => {
      prompts.delete(key);
    });
    prompts.set(key, answer);
    return answer;
  }

  /** The one place an AuthorizedRoot comes from, so the one place a session learns a folder may run. */
  const gate: RootGate = {
    authorize: async (root) => {
      if (!(await ensureTrusted(root))) {
        return null;
      }
      // SAFETY: this is what the type means: the user has just said yes, or said it before.
      return root as AuthorizedRoot;
    },
    grant: async (root) => {
      await trust.grant(root).catch((error: Error) => {
        console.error("[hub] remembering a created project failed:", error);
      });
      // SAFETY: this is what the type means: the application itself just wrote this folder.
      return root as AuthorizedRoot;
    },
  };

  /**
   * End the app if a launch left nothing open.
   *
   * `window-all-closed` fires only when a window closes, so a launch that declined or was refused
   * before any window existed would otherwise be a process with no interface, holding the instance
   * lock so that the next double-click reaches nobody.
   */
  function quitIfNothingOpen(): void {
    if (quitTimer) {
      clearTimeout(quitTimer);
    }
    quitTimer = setTimeout(() => {
      quitTimer = null;
      if (!disposed && windows.size === 0 && opening.size === 0 && prompts.size === 0) {
        send({ type: "quit" });
      }
    }, QUIT_GRACE_MS);
  }

  /** Open whatever a path turns out to be, or say why it cannot be (specs/desktop.md §4.6). */
  function openPath(path: string): void {
    const target = resolveOpenTarget(path);
    if (target.kind === "refused") {
      send({ message: target.reason, type: "notice" });
      quitIfNothingOpen();
      return;
    }
    if (target.problem) {
      send({ message: target.problem, type: "notice" });
    }
    void openProject(target.root, target.file);
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
    authorize: gate.authorize,
    findWindowByRoot,
    focus,
    isOpening: (root) => {
      const key = normalizeRoot(root);
      return [...opening.values()].some((pending) => pending.key === key);
    },
    listOpenWindows: () => [...windows.values()].map((entry) => windowRow(entry)),
    openProject,
    retitle,
  };

  /** One row of the window list. */
  function windowRow(entry: Entry): WindowRow {
    return { id: entry.id, projectRoot: entry.session.projectRoot };
  }

  /**
   * Open a window for a project, or raise the one that already holds it, showing `file` there.
   *
   * Two windows on one project would edit the same files through two watchers and two undo
   * histories, so the dedupe is not a nicety. The answer says which of those happened, or that the
   * user declined, because a caller has to be able to report what actually happened.
   */
  async function openProject(
    root: string | null,
    file: string | null = null,
  ): Promise<OpenOutcome> {
    const existing = root ? findWindowByRoot(root) : null;
    if (existing) {
      raise(existing, file);
      return { focused: true };
    }
    const key = root ? normalizeRoot(root) : null;
    const pending = key ? [...opening.values()].find((entry) => entry.key === key) : null;
    if (pending) {
      /* Its prompt is up or its server is binding, and the window it becomes is the one this asked
         for, so the document waits with it. Declining declines both. */
      if (file) {
        pending.files.push(file);
      }
      const outcome = await pending.done;
      return outcome.declined ? outcome : { focused: true };
    }
    return openWindow(root, file);
  }

  async function openWindow(root: string | null, file: string | null): Promise<OpenOutcome> {
    const id = nextWindow;
    nextWindow += 1;
    const partition = root ? projectPartition(root) : welcomePartition();
    const files = file ? [file] : [];
    const done = bindWindow(id, root, partition, files);
    opening.set(id, { done, files, key: root ? normalizeRoot(root) : null, partition });
    try {
      return await done;
    } catch (error) {
      console.error("[hub] opening a window failed:", error);
      return { focused: false };
    } finally {
      opening.delete(id);
      if (windows.size === 0) {
        quitIfNothingOpen();
      }
    }
  }

  /**
   * Ask about the folder, then start window `id`'s project server, register the window and tell the
   * shell to show it. Nothing of the folder runs until the answer is in, and a window that is not
   * given one was never there.
   */
  async function bindWindow(
    id: number,
    root: string | null,
    partition: string,
    files: string[],
  ): Promise<OpenOutcome> {
    const authorized = root === null ? null : await gate.authorize(root);
    if (root !== null && authorized === null) {
      return { declined: true, focused: false };
    }
    /* Everything stays clickable while a prompt is up, so a window may have taken this project in the
       meantime, and the answer that lets this one open is the same one that let that one. */
    const holder = root === null ? null : findWindowByRoot(root);
    if (holder) {
      for (const file of files) {
        raise(holder, file);
      }
      if (files.length === 0) {
        focus(holder);
      }
      return { focused: true };
    }
    const session = createProjectSession(authorized, gate);
    const window: HubWindow = { id, pendingDocuments: files, session };
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
    const server = await createProjectServer(serverOptions);
    if (disposed) {
      // The hub stopped while the server was binding; nobody will ever show this window.
      server.stop();
      session.setProjectRoot(null);
      return { focused: false };
    }
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
    send({ id, root, type: "window-root" });
    return { focused: false };
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
    setAuthorizationHost({ authorizer: server.authorizer, port: server.server.port });
  }

  function closeWindow(id: number): void {
    const entry = windows.get(id);
    if (!entry) {
      return;
    }
    windows.delete(id);
    entry.server.stop();
    // Letting go stops the watcher and drops the unsaved-preview and format caches.
    entry.session.close();
    // The redirect must not name a server that just stopped.
    const newest = [...windows.values()].at(-1);
    if (newest) {
      claimAuthorizationRedirect(newest.server);
    }
  }

  /* Every window has its own webview and so its own settings kernel: a change made in one is news
     to the others exactly as it would be across processes. */
  const stopSettingsWatch = (options.watchSettings ?? watchSettings)((settings) => {
    for (const entry of windows.values()) {
      entry.server.push("settingsChanged", { settings });
    }
  });

  setFileDialog(() => requestDialog("file", "Open project.json"));
  setDirectoryDialog(() => requestDialog("directory", "Choose a folder for your new project"));

  return {
    dispose: () => {
      disposed = true;
      stopSettingsWatch();
      // Deleting the visited entry mid-iteration is what a Map permits, and `closeWindow` does.
      for (const id of windows.keys()) {
        closeWindow(id);
      }
      for (const resolve of dialogs.values()) {
        resolve(null);
      }
      dialogs.clear();
      // A prompt nobody can answer any more is a no.
      for (const resolve of trustAnswers.values()) {
        resolve(false);
      }
      trustAnswers.clear();
      if (quitTimer) {
        clearTimeout(quitTimer);
      }
      setFileDialog(null);
      setDirectoryDialog(null);
    },
    idle: async () => {
      while (opening.size > 0) {
        await Promise.allSettled([...opening.values()].map((pending) => pending.done));
      }
    },
    handle: (message) => {
      switch (message.type) {
        case "open-project": {
          void openProject(message.root);
          break;
        }
        case "open-path": {
          openPath(message.path);
          break;
        }
        case "trust-answer": {
          const resolve = trustAnswers.get(message.requestId);
          trustAnswers.delete(message.requestId);
          resolve?.(message.trusted);
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
