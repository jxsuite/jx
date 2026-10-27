/**
 * The slice of Electron's API the shell uses, declared here rather than taken from the `electron`
 * package.
 *
 * The package's only job in this repository would be its types: the binary comes from the system
 * (nixpkgs `electron`, named by `ELECTRON_BIN`), never from `node_modules`, and installing the npm
 * package downloads a ~100 MB Electron build in its postinstall. So the shell declares exactly what
 * it calls, and the bundle leaves `electron` external for the runtime to provide.
 */
declare module "electron" {
  /** The event object Electron hands a cancellable listener. */
  export interface CancellableEvent {
    preventDefault: () => void;
  }

  /** `will-navigate`'s event: cancellable, and carrying the destination. */
  export interface NavigationEvent extends CancellableEvent {
    url: string;
  }

  /** `before-input-event`'s second argument. */
  export interface Input {
    type: string;
    key: string;
    control: boolean;
    shift: boolean;
  }

  export type WindowOpenResponse = { action: "deny" } | { action: "allow" };

  /** The `WebContents` events the shell listens for, by name. */
  export interface WebContentsEvents {
    "before-input-event": (event: CancellableEvent, input: Input) => void;
    "will-navigate": (event: NavigationEvent) => void;
    "will-prevent-unload": (event: CancellableEvent) => void;
  }

  export interface WebContents {
    on: <Name extends keyof WebContentsEvents>(
      event: Name,
      listener: WebContentsEvents[Name],
    ) => WebContents;
    setWindowOpenHandler: (handler: (details: { url: string }) => WindowOpenResponse) => void;
    toggleDevTools: () => void;
  }

  export interface WebPreferences {
    contextIsolation: boolean;
    nodeIntegration: boolean;
    /** Where the page's storage lives; `persist:`-prefixed names survive a restart. */
    partition?: string;
    preload: string;
    sandbox: boolean;
    spellcheck?: boolean;
  }

  export interface BrowserWindowConstructorOptions {
    frame: boolean;
    height: number;
    icon?: string;
    minHeight: number;
    minWidth: number;
    show: boolean;
    title: string;
    webPreferences: WebPreferences;
    width: number;
  }

  export class BrowserWindow {
    constructor(options: BrowserWindowConstructorOptions);
    static fromWebContents(contents: WebContents): BrowserWindow | null;
    static getFocusedWindow(): BrowserWindow | null;
    readonly webContents: WebContents;
    close(): void;
    /** Close without asking the page, so unsaved-change prompts do not run. */
    destroy(): void;
    focus(): void;
    isMaximized(): boolean;
    isMinimized(): boolean;
    loadURL(url: string): Promise<void>;
    maximize(): void;
    minimize(): void;
    on(event: "closed", listener: () => void): this;
    once(event: "ready-to-show", listener: () => void): this;
    restore(): void;
    setTitle(title: string): void;
    show(): void;
    unmaximize(): void;
  }

  /** The macOS Dock tile; `app.dock` is undefined on every other platform. */
  export interface Dock {
    setIcon: (image: string) => void;
  }

  /** The `app` events the shell listens for, by name. */
  export interface AppEvents {
    /** A file the user opened with the app (macOS: double-click, drop on the Dock tile). */
    "open-file": (event: CancellableEvent, path: string) => void;
    /** A second launch of the app, with the arguments and directory it was started with. */
    "second-instance": (event: CancellableEvent, argv: string[], cwd: string) => void;
    "window-all-closed": () => void;
    "will-quit": () => void;
  }

  export interface App {
    dock?: Dock;
    /** Whether this is a packaged build, whose files live in `process.resourcesPath`. */
    readonly isPackaged: boolean;
    /** A directory Electron keeps for the user; only the one the app derives its own from. */
    getPath: (name: "appData") => string;
    /** The directory the app lives in: the entry script's, when run as `electron <script>`. */
    getAppPath: () => string;
    on: <Name extends keyof AppEvents>(event: Name, listener: AppEvents[Name]) => App;
    quit: () => void;
    /** Take the single-instance lock: false means another instance holds it, and has been told. */
    requestSingleInstanceLock: () => boolean;
    /** Linux only: Electron does not define it elsewhere. */
    setDesktopName: (name: string) => void;
    setName: (name: string) => void;
    /**
     * Mac App Store builds only: take up a bookmark the open dialog returned, and so regain the
     * folder it names. Returns the function that gives the access back.
     */
    startAccessingSecurityScopedResource: (bookmark: string) => () => void;
    setPath: (name: "sessionData" | "userData", path: string) => void;
    whenReady: () => Promise<void>;
  }

  export interface IpcMainInvokeEvent {
    sender: WebContents;
  }

  export interface IpcMain {
    handle: (channel: string, listener: (event: IpcMainInvokeEvent) => void) => void;
  }

  export interface OpenDialogOptions {
    filters?: { extensions: string[]; name: string }[];
    properties: ("createDirectory" | "openDirectory" | "openFile")[];
    /** Mac App Store builds only: also return a bookmark for each pick. */
    securityScopedBookmarks?: boolean;
    title: string;
  }

  export interface OpenDialogReturnValue {
    /** One per path, in the same order, when `securityScopedBookmarks` was asked for. */
    bookmarks?: string[];
    canceled: boolean;
    filePaths: string[];
  }

  export interface MessageBoxOptions {
    buttons: string[];
    cancelId: number;
    defaultId: number;
    detail: string;
    message: string;
    title: string;
    type: "info" | "warning";
  }

  export interface Dialog {
    /** Ask without blocking the main process; `response` is the index of the button chosen. */
    showMessageBox: (options: MessageBoxOptions) => Promise<{ response: number }>;
    showMessageBoxSync: (window: BrowserWindow, options: MessageBoxOptions) => number;
    /** Sheet-modal on `window` when given one; free-standing otherwise. */
    showOpenDialog: {
      (window: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
      (options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
    };
  }

  /** The menu roles the macOS application menu is built from. */
  export type MenuRole = "appMenu" | "close" | "editMenu" | "toggleDevTools" | "windowMenu";

  export interface MenuItemConstructorOptions {
    click?: () => void;
    label?: string;
    role?: MenuRole;
    submenu?: MenuItemConstructorOptions[];
    type?: "separator";
  }

  /** An application menu, opaque to the shell once built. */
  export interface ElectronMenu {
    readonly items: readonly unknown[];
  }

  export interface ApplicationMenu {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => ElectronMenu;
    setApplicationMenu: (menu: ElectronMenu | null) => void;
  }

  export interface Shell {
    openExternal: (url: string) => Promise<void>;
  }

  export interface ContextBridge {
    exposeInMainWorld: <Api>(key: string, api: Api) => void;
  }

  export interface IpcRenderer {
    invoke: (channel: string) => Promise<void>;
  }

  /**
   * A message as it crosses a utility process's channel: structured-cloned plain data. Both ends
   * speak `hub/protocol.ts`, whose every message is discriminated by `type`; what ARRIVES is
   * checked against it before anything reads it.
   */
  export interface PortMessage {
    readonly type: string;
  }

  /** The utility process the backend runs as (`utilityProcess.fork`). */
  export interface UtilityProcess {
    kill: () => boolean;
    on: {
      (event: "exit", listener: (code: number) => void): void;
      (event: "message", listener: (message: Partial<PortMessage> | null) => void): void;
    };
    postMessage: (message: PortMessage) => void;
  }

  export interface UtilityProcessFork {
    fork: (
      modulePath: string,
      args: string[],
      options: { env: NodeJS.ProcessEnv; serviceName: string; stdio: "inherit" },
    ) => UtilityProcess;
  }

  export const app: App;
  export const contextBridge: ContextBridge;
  export const dialog: Dialog;
  export const ipcMain: IpcMain;
  export const ipcRenderer: IpcRenderer;
  export const Menu: ApplicationMenu;
  export const shell: Shell;
  export const utilityProcess: UtilityProcessFork;
}

/** What Electron adds to Node's `process`, which Node's own `Process` type does not declare. */
declare namespace NodeJS {
  interface Process {
    /** Set when the app runs as a Mac App Store build, which Electron's `mas` flavor reports. */
    mas?: boolean;
    /** The directory the installed app's `resources` live in. */
    resourcesPath?: string;
    /** Set when the app runs as a Microsoft Store (appx) package. */
    windowsStore?: boolean;
    /** A utility process's channel to the main process that forked it; absent anywhere else. */
    parentPort?: {
      on: (
        event: "message",
        listener: (event: { data: { readonly type?: string } | null }) => void,
      ) => void;
      postMessage: (message: { readonly type: string }) => void;
    };
  }
}
