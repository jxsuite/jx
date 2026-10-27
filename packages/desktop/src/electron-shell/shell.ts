/**
 * The Electron application's windows: frameless windows onto each project's loopback Studio.
 *
 * A browser draws its own frame, and on Linux nothing a page can ask for removes it
 * (specs/desktop.md §9.5): Chrome 155's Additional Windowing Controls work only in an installed web
 * app and leave Chromium's caption buttons in place, and the Unframed display mode that would hide
 * them is ChromeOS-only. An embedder owns its window, so these open without a frame and Studio
 * draws the titlebar it draws on every platform.
 *
 * MacOS gets the same window: Studio draws its macOS-style window buttons there too
 * (`commandbar.ts`, `csd: "mac"`), and the app adds the one thing macOS requires of an app that
 * Linux does not, an application menu (see {@link macApplicationMenu}).
 *
 * Takes the Electron API as a parameter so it can be exercised without Electron; `app.ts` passes
 * the real one.
 *
 * @docs studio/desktop
 */
import type * as Electron from "electron";
import type { BrowserWindow, WebContents } from "electron";
import { SHELL_CHANNELS } from "./bridge";

/** What every window of the app shares. */
export interface ShellArgs {
  /** The window's icon (X11 reads it from the window; Wayland from the desktop entry). */
  icon: string | null;
  /** The preload bundle, beside the main-process entry. */
  preload: string;
}

/**
 * The value of a `--jx-<name>=<value>` switch, or null when it is absent.
 *
 * @param argv The process argv.
 * @param name The switch's name, without the `--jx-` prefix.
 */
export function switchValue(argv: readonly string[], name: string): string | null {
  const prefix = `--jx-${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

/**
 * Whether a navigation stays inside the window: only its own server's origin does.
 *
 * Studio is one page plus same-origin reloads, and anything else (a link in a preview, a docs link)
 * belongs in the user's browser.
 *
 * @param target Where the page is going.
 * @param origin The window's server origin.
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

/** What distinguishes one window from another in a shell that holds several. */
export interface WindowExtras {
  /** The window's page-storage partition, so one project's storage stays apart from another's. */
  partition?: string;
  title?: string;
}

/**
 * The window's construction options; exported so the test pins the security-relevant ones.
 *
 * @param args The window's icon and the preload every window of the shell shares.
 * @param extras What differs per window.
 */
export function shellWindowOptions(
  args: Pick<ShellArgs, "icon" | "preload">,
  extras: WindowExtras = {},
): Electron.BrowserWindowConstructorOptions {
  const options: Electron.BrowserWindowConstructorOptions = {
    frame: false,
    height: 900,
    // Resize-edges.ts's floor, so the shell and Studio agree on the smallest usable window.
    minHeight: 300,
    minWidth: 400,
    show: false,
    title: extras.title ?? "Jx Studio",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: args.preload,
      sandbox: true,
    },
    width: 1400,
  };
  if (extras.partition) {
    options.webPreferences.partition = extras.partition;
  }
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

/** Keep the page inside its server's origin, sending the user's links to their browser. */
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
 * Ctrl+Shift+I opens DevTools, as it does in a Chromium app window. On Linux the shell installs no
 * application menu (Electron's default one would claim Ctrl+W, Ctrl+R and the zoom keys before
 * Studio's keymap sees them), so this one binding is restored by hand. macOS also has ⌥⌘I, from
 * {@link macApplicationMenu}.
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
 * The macOS application menu.
 *
 * Linux gets none (see {@link bindDevTools}), but macOS cannot go without one: Cut, Copy, Paste,
 * Select All and Quit are menu items there, not browser behaviour, so a window with no menu has
 * text fields that ignore ⌘C and an app that ignores ⌘Q. Built from Electron's roles so every label
 * and chord is the platform's own. The menu never pre-empts Studio's keymap: Chromium offers a key
 * equivalent to the page first and gives it to the menu only when the page did not handle it, so a
 * chord Studio binds (⌘Z, ⌘W) still reaches Studio, and the menu answers only the ones it leaves
 * alone. DevTools sits under View at the macOS chord, ⌥⌘I.
 */
export function macApplicationMenu(actions?: MenuActions): Electron.MenuItemConstructorOptions[] {
  /* Items without accelerators: both chords are Studio commands'
     `keybinding` (`view.newWindow`, `project.open`), which its keymap dispatches, and a chord with
     two owners fires twice. The menu keeps the items because a native menu is where a macOS user
     looks for them. */
  const file: Electron.MenuItemConstructorOptions[] = actions
    ? [
        {
          label: "File",
          submenu: [
            { click: actions.newWindow, label: "New Window" },
            { click: actions.openProject, label: "Open Project…" },
            { type: "separator" },
            { role: "close" },
          ],
        },
      ]
    : [];
  return [
    { role: "appMenu" },
    ...file,
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "toggleDevTools" }] },
    { role: "windowMenu" },
  ];
}

/** What the multi-window app's File menu does; absent in a shell that holds a single window. */
export interface MenuActions {
  newWindow: () => void;
  openProject: () => void;
}

/**
 * Install the application menu for `platform`: macOS's, or none at all.
 *
 * @param actions The File menu's actions, when the shell has windows to open.
 */
export function installApplicationMenu(
  electron: typeof Electron,
  platform: NodeJS.Platform,
  actions?: MenuActions,
): void {
  electron.Menu.setApplicationMenu(
    platform === "darwin" ? electron.Menu.buildFromTemplate(macApplicationMenu(actions)) : null,
  );
}

/**
 * Name the app to the desktop: the Wayland `app_id` that matches the window to `jx-studio.desktop`
 * on Linux, and on macOS the name the menu's roles print ("Quit Jx Studio") plus the Dock tile's
 * icon. An unbundled Electron is otherwise "Electron" with Electron's icon in the Dock.
 */
export function identifyApp(
  app: Electron.App,
  args: Pick<ShellArgs, "icon">,
  platform: NodeJS.Platform,
): void {
  if (platform === "linux") {
    app.setDesktopName("jx-studio.desktop");
  } else if (platform === "darwin") {
    app.setName("Jx Studio");
    if (args.icon) {
      app.dock?.setIcon(args.icon);
    }
  }
}

/** Bring a window forward, restoring it first if it is minimized. */
export function raiseWindow(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

/**
 * Register the window actions. Each acts on the window whose page asked, so a stray message can
 * never reach another window.
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
  on(SHELL_CHANNELS.focus, raiseWindow);
}

/** What opens a Studio window. */
export interface StudioWindowSpec extends WindowExtras {
  icon: string | null;
  /** The preload bundle every window shares. */
  preload: string;
  /** The tokened Studio shell URL on the window's loopback server. */
  url: string;
}

/**
 * Build one Studio window and wire it, without loading its page yet.
 *
 * The one place a window is built, so the security-relevant options, the navigation policy and the
 * unsaved-changes prompt cannot differ between windows. Split from loading so a caller can hold the
 * window before the page arrives: a raise request can follow an open request by a message.
 *
 * @param electron The Electron API.
 * @param spec What distinguishes this window.
 */
export function createStudioWindow(
  electron: typeof Electron,
  spec: StudioWindowSpec,
): BrowserWindow {
  const window = new electron.BrowserWindow(shellWindowOptions(spec, spec));
  const contents = window.webContents;
  guardNavigation(electron, contents, new URL(spec.url).origin);
  bindDevTools(contents);
  contents.on("will-prevent-unload", (event) => confirmUnload(electron, window, event));
  window.once("ready-to-show", () => window.show());
  return window;
}
