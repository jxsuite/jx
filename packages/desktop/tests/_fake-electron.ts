/**
 * A stand-in for the slice of Electron the shell uses (`src/electron-shell/electron.d.ts`),
 * recording what the shell asked of it so a test can drive the window's events by hand.
 */
import { mock } from "bun:test";
import type * as Electron from "electron";

/** A recorded `BrowserWindow`: its options, its calls, and the listeners on it and its contents. */
export interface FakeWindow {
  options: Electron.BrowserWindowConstructorOptions;
  maximized: boolean;
  minimized: boolean;
  calls: string[];
  ready: (() => void) | undefined;
  /** The `closed` listener, fired by a test to close the window. */
  closed: (() => void) | undefined;
  loaded: string | undefined;
  contents: FakeContents;
  title: string;
}

/** A recorded `WebContents`. */
export interface FakeContents {
  listeners: Map<string, (...args: never[]) => void>;
  openHandler: ((details: { url: string }) => Electron.WindowOpenResponse) | undefined;
  devTools: number;
}

/** The fake API plus what it recorded. */
export interface FakeElectron {
  api: typeof Electron;
  windows: FakeWindow[];
  handlers: Map<string, (event: Electron.IpcMainInvokeEvent) => void>;
  paths: Map<string, string>;
  desktopName: string[];
  appListeners: Map<string, (...args: never[]) => void>;
  /** Fire an `app` event as Electron would, with the arguments its listener takes. */
  emitApp: <Name extends keyof Electron.AppEvents>(
    name: Name,
    ...args: Parameters<Electron.AppEvents[Name]>
  ) => void;
  /** What `app.requestSingleInstanceLock` answers. */
  lock: boolean;
  /** The button `dialog.showMessageBox` answers with next. */
  messageAnswer: number;
  /** Each `dialog.showMessageBox` call's options. */
  messageBoxes: Electron.MessageBoxOptions[];
  /** Whether `app.isPackaged` reads true. */
  packaged: boolean;
  /** Each `dialog.showOpenDialog` call: its options, and whether it named a parent window. */
  openDialogs: { options: Electron.OpenDialogOptions; parented: boolean }[];
  /** What `dialog.showOpenDialog` answers next. */
  openAnswer: Electron.OpenDialogReturnValue;
  /** Which window `BrowserWindow.getFocusedWindow` resolves. */
  focusedWindow: FakeWindow | null;
  /** When set, every `loadURL` rejects with it. */
  loadError: Error | null;
  /** When set, every `dialog.showOpenDialog` rejects with it. */
  openError: Error | null;
  quit: ReturnType<typeof mock>;
  openExternal: ReturnType<typeof mock>;
  setApplicationMenu: ReturnType<typeof mock>;
  /** Templates handed to `Menu.buildFromTemplate`, in order. */
  menuTemplates: Electron.MenuItemConstructorOptions[][];
  /** Names handed to `app.setName`. */
  names: string[];
  /** Icons handed to `app.dock.setIcon`. */
  dockIcons: string[];
  exposed: Map<string, unknown>;
  invoked: string[];
  /** What `dialog.showMessageBoxSync` answers next. */
  dialogAnswer: number;
  /** Which window `fromWebContents` resolves; the latest one by default. */
  senderWindow: FakeWindow | null | undefined;
}

/** Build a fresh fake. */
export function fakeElectron(): FakeElectron {
  const record: Omit<FakeElectron, "api"> = {
    appListeners: new Map(),
    desktopName: [],
    dialogAnswer: 1,
    dockIcons: [],
    emitApp: (name, ...args) => {
      /* SAFETY: `appListeners` holds each event's listener under its name, and the signature above
         ties `args` to that event's own parameters. */
      const listener = record.appListeners.get(name) as ((...a: unknown[]) => void) | undefined;
      listener?.(...args);
    },
    focusedWindow: null,
    loadError: null,
    lock: true,
    menuTemplates: [],
    messageAnswer: 0,
    messageBoxes: [],
    names: [],
    openAnswer: { canceled: true, filePaths: [] },
    openError: null,
    openDialogs: [],
    packaged: false,
    exposed: new Map(),
    handlers: new Map(),
    invoked: [],
    openExternal: mock((_url: string) => Promise.resolve()),
    paths: new Map(),
    quit: mock(() => {}),
    senderWindow: undefined,
    setApplicationMenu: mock((_menu: Electron.ElectronMenu | null) => {}),
    windows: [],
  };

  class BrowserWindow {
    readonly webContents: Electron.WebContents;
    private readonly fake: FakeWindow;

    constructor(options: Electron.BrowserWindowConstructorOptions) {
      const contents: FakeContents = { devTools: 0, listeners: new Map(), openHandler: undefined };
      this.fake = {
        calls: [],
        closed: undefined,
        contents,
        loaded: undefined,
        maximized: false,
        minimized: false,
        options,
        ready: undefined,
        title: options.title,
      };
      record.windows.push(this.fake);
      const webContents: Electron.WebContents = {
        on: (event, listener) => {
          contents.listeners.set(event, listener);
          return webContents;
        },
        setWindowOpenHandler: (handler) => {
          contents.openHandler = handler;
        },
        toggleDevTools: () => {
          contents.devTools += 1;
        },
      };
      this.webContents = webContents;
      windowsByFake.set(this.fake, this);
    }

    static fromWebContents(_contents: Electron.WebContents): BrowserWindow | null {
      const target =
        record.senderWindow === undefined ? record.windows.at(-1) : record.senderWindow;
      return target ? (windowsByFake.get(target) ?? null) : null;
    }

    static getFocusedWindow(): BrowserWindow | null {
      return record.focusedWindow ? (windowsByFake.get(record.focusedWindow) ?? null) : null;
    }

    close(): void {
      this.fake.calls.push("close");
    }
    on(_event: "closed", listener: () => void): this {
      this.fake.closed = listener;
      return this;
    }
    setTitle(title: string): void {
      this.fake.title = title;
    }
    focus(): void {
      this.fake.calls.push("focus");
    }
    isMaximized(): boolean {
      return this.fake.maximized;
    }
    isMinimized(): boolean {
      return this.fake.minimized;
    }
    loadURL(url: string): Promise<void> {
      this.fake.loaded = url;
      return record.loadError ? Promise.reject(record.loadError) : Promise.resolve();
    }
    maximize(): void {
      this.fake.calls.push("maximize");
      this.fake.maximized = true;
    }
    minimize(): void {
      this.fake.calls.push("minimize");
      this.fake.minimized = true;
    }
    once(_event: "ready-to-show", listener: () => void): this {
      this.fake.ready = listener;
      return this;
    }
    restore(): void {
      this.fake.calls.push("restore");
      this.fake.minimized = false;
    }
    show(): void {
      this.fake.calls.push("show");
    }
    unmaximize(): void {
      this.fake.calls.push("unmaximize");
      this.fake.maximized = false;
    }
  }
  const windowsByFake = new WeakMap<FakeWindow, BrowserWindow>();

  const app: Electron.App = {
    dock: {
      setIcon: (image) => {
        record.dockIcons.push(image);
      },
    },
    getAppPath: () => "/b",
    getPath: () => "/appdata",
    get isPackaged(): boolean {
      return record.packaged;
    },
    on: (event, listener) => {
      // SAFETY: the map holds listeners of every event's shape; a test fires the one it named.
      record.appListeners.set(event, listener as (...args: never[]) => void);
      return app;
    },
    quit: () => record.quit(),
    requestSingleInstanceLock: () => record.lock,
    setDesktopName: (name) => {
      record.desktopName.push(name);
    },
    setName: (name) => {
      record.names.push(name);
    },
    setPath: (name, path) => {
      record.paths.set(name, path);
    },
    whenReady: () => Promise.resolve(),
  };

  // Typed as the module itself, so a member electron.d.ts declares and this omits fails to compile.
  const api: typeof Electron = {
    app,
    BrowserWindow,
    contextBridge: {
      exposeInMainWorld: <Api>(key: string, value: Api) => {
        record.exposed.set(key, value);
      },
    },
    dialog: {
      showMessageBox: (options) => {
        record.messageBoxes.push(options);
        return Promise.resolve({ response: record.messageAnswer });
      },
      showMessageBoxSync: () => record.dialogAnswer,
      showOpenDialog: (
        first: Electron.BrowserWindow | Electron.OpenDialogOptions,
        second?: Electron.OpenDialogOptions,
      ) => {
        // SAFETY: the two overloads differ only in the leading window, which `second` marks.
        const options = (second ?? first) as Electron.OpenDialogOptions;
        record.openDialogs.push({ options, parented: second !== undefined });
        return record.openError
          ? Promise.reject(record.openError)
          : Promise.resolve(record.openAnswer);
      },
    },
    ipcMain: {
      handle: (channel: string, listener: (event: Electron.IpcMainInvokeEvent) => void) => {
        record.handlers.set(channel, listener);
      },
    },
    ipcRenderer: {
      invoke: (channel: string) => {
        record.invoked.push(channel);
        return Promise.resolve();
      },
    },
    Menu: {
      buildFromTemplate: (template) => {
        record.menuTemplates.push(template);
        return { items: template };
      },
      setApplicationMenu: (menu) => record.setApplicationMenu(menu),
    },
    shell: { openExternal: (url: string) => record.openExternal(url) },
  };

  /* The record itself, not a copy: `dialogAnswer` and `senderWindow` are read by the closures
     above at call time, so a test sets them on this object. */
  return Object.assign(record, { api });
}
