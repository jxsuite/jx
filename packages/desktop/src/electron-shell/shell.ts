/**
 * The Electron shell: one frameless window onto the launcher's loopback Studio.
 *
 * It replaces `chromium --app=…` on Linux for one reason (specs/desktop.md §9.5): a browser draws
 * its own frame, and on Linux nothing a page can ask for removes it — Chrome 155's Additional
 * Windowing Controls work only in an installed web app and leave Chromium's caption buttons in
 * place, and the Unframed display mode that would hide them is ChromeOS-only. An embedder owns its
 * window, so this one opens it without a frame and lets Studio draw the titlebar it already draws
 * under Electrobun.
 *
 * Everything else stays the launcher's: the project server, the RPC socket, the window registry and
 * the one-process-per-window model (§9.4). The shell is given a URL and a profile directory and
 * does nothing a browser would not, apart from the four window actions in `bridge.ts`.
 *
 * Takes the Electron API as a parameter so it can be exercised without Electron; `main.ts` is the
 * two-line entry that passes the real one.
 *
 * @docs studio/desktop
 */
import type * as Electron from "electron";
import type { BrowserWindow, WebContents } from "electron";
import { SHELL_CHANNELS } from "./bridge";

/** What the launcher tells the shell, as `--jx-<name>=<value>` switches. */
export interface ShellArgs {
  /** The window's icon (X11 reads it from the window; Wayland from the desktop entry). */
  icon: string | null;
  /** The preload bundle, beside `main.js`. */
  preload: string;
  /** The tokened Studio shell URL on the launcher's loopback server. */
  url: string;
  /** This window's profile directory, chosen by the launcher (§9.4). */
  userDataDir: string | null;
}

/**
 * Read the shell's switches out of `process.argv`.
 *
 * @param argv The shell process's argv.
 * @throws {Error} When the launcher left out the URL or the preload, which nothing can stand in
 *   for.
 */
export function parseShellArgs(argv: readonly string[]): ShellArgs {
  const read = (name: string): string | null => {
    const prefix = `--jx-${name}=`;
    const found = argv.find((arg) => arg.startsWith(prefix));
    return found === undefined ? null : found.slice(prefix.length);
  };
  const url = read("url");
  const preload = read("preload");
  if (!url || !preload) {
    throw new Error("The Jx Studio shell needs --jx-url and --jx-preload.");
  }
  return { icon: read("icon"), preload, url, userDataDir: read("user-data-dir") };
}

/**
 * Whether a navigation stays inside the shell: only the launcher's own origin does.
 *
 * Mirrors Electrobun's `navigationRules` (`window-manager.ts`): Studio is one page plus same-origin
 * reloads, and anything else (a link in a preview, a docs link) belongs in the user's browser.
 *
 * @param target Where the page is going.
 * @param origin The launcher's origin.
 */
export function isShellNavigation(target: string, origin: string): boolean {
  try {
    return new URL(target).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Whether a URL leaving the shell may be handed to the user's browser. Only web and mail links: the
 * desktop's URL handlers can run anything, and a page has no business reaching them through
 * Studio.
 *
 * @param target The URL the page tried to open.
 */
export function isExternalLink(target: string): boolean {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(target).protocol);
  } catch {
    return false;
  }
}

/** The window's construction options; exported so the test pins the security-relevant ones. */
export function shellWindowOptions(args: ShellArgs): Electron.BrowserWindowConstructorOptions {
  const options: Electron.BrowserWindowConstructorOptions = {
    frame: false,
    height: 900,
    // Resize-edges.ts's floor, so the shell and Studio agree on the smallest usable window.
    minHeight: 300,
    minWidth: 400,
    show: false,
    title: "Jx Studio",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: args.preload,
      sandbox: true,
    },
    width: 1400,
  };
  if (args.icon) {
    options.icon = args.icon;
  }
  return options;
}

/**
 * Answer a blocked unload the way a browser would, by asking.
 *
 * Studio cancels `beforeunload` while a tab has unsaved edits (`studio.ts`). Chromium turns that
 * into its leave-page prompt; Electron turns it into a close that silently does nothing, so the
 * shell has to ask itself. Choosing to close is what lets the unload proceed.
 */
function confirmUnload(
  electron: typeof Electron,
  window: BrowserWindow,
  event: Electron.CancellableEvent,
): void {
  const choice = electron.dialog.showMessageBoxSync(window, {
    buttons: ["Close Without Saving", "Cancel"],
    cancelId: 1,
    defaultId: 1,
    detail: "Changes you have not saved will be lost.",
    message: "This window has unsaved changes.",
    title: "Jx Studio",
    type: "warning",
  });
  if (choice === 0) {
    event.preventDefault();
  }
}

/** Keep the page inside the launcher's origin, sending the user's links to their browser. */
function guardNavigation(electron: typeof Electron, contents: WebContents, origin: string): void {
  const openOutside = (target: string): void => {
    if (isExternalLink(target)) {
      void electron.shell.openExternal(target);
    }
  };
  contents.on("will-navigate", (event) => {
    if (!isShellNavigation(event.url, origin)) {
      event.preventDefault();
      openOutside(event.url);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
}

/**
 * Ctrl+Shift+I opens DevTools, as it does in a Chromium app window. The shell installs no
 * application menu (Electron's default one would claim Ctrl+W, Ctrl+R and the zoom keys before
 * Studio's keymap sees them), so this one binding is restored by hand.
 */
function bindDevTools(contents: WebContents): void {
  contents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      input.control &&
      input.shift &&
      input.key.toLowerCase() === "i"
    ) {
      event.preventDefault();
      contents.toggleDevTools();
    }
  });
}

/**
 * Register the window actions. Each acts on the window whose page asked, so a stray message can
 * never reach another window (there is one per process today, but the handler does not rely on
 * it).
 */
export function registerWindowActions(electron: typeof Electron): void {
  const on = (channel: string, act: (window: BrowserWindow) => void): void => {
    electron.ipcMain.handle(channel, (event) => {
      const window = electron.BrowserWindow.fromWebContents(event.sender);
      if (window) {
        act(window);
      }
    });
  };
  on(SHELL_CHANNELS.minimize, (window) => window.minimize());
  on(SHELL_CHANNELS.maximize, (window) => {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });
  on(SHELL_CHANNELS.close, (window) => window.close());
  on(SHELL_CHANNELS.focus, (window) => {
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  });
}

/**
 * Start the shell: configure the app, open the window, load Studio.
 *
 * @param electron The Electron API (`main.ts` passes the real module).
 * @param argv The process argv the launcher composed.
 * @returns The window, once Studio's page has been asked to load.
 */
export async function startShell(
  electron: typeof Electron,
  argv: readonly string[],
): Promise<BrowserWindow> {
  const args = parseShellArgs(argv);
  const { app } = electron;
  // The window's Wayland app_id (and X11 WM_CLASS), which is what matches it to jx-studio.desktop.
  app.setDesktopName("jx-studio.desktop");
  if (args.userDataDir) {
    app.setPath("userData", args.userDataDir);
    app.setPath("sessionData", args.userDataDir);
  }
  // One window per process: when it closes, so does the shell, and the launcher with it.
  app.on("window-all-closed", () => app.quit());
  await app.whenReady();
  electron.Menu.setApplicationMenu(null);
  registerWindowActions(electron);

  const window = new electron.BrowserWindow(shellWindowOptions(args));
  const contents = window.webContents;
  guardNavigation(electron, contents, new URL(args.url).origin);
  bindDevTools(contents);
  contents.on("will-prevent-unload", (event) => confirmUnload(electron, window, event));
  window.once("ready-to-show", () => window.show());
  await window.loadURL(args.url);
  return window;
}
