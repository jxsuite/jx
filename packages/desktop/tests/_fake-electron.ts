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
  loaded: string | undefined;
  contents: FakeContents;
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
  appListeners: Map<string, () => void>;
  quit: ReturnType<typeof mock>;
  openExternal: ReturnType<typeof mock>;
  setApplicationMenu: ReturnType<typeof mock>;
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
    exposed: new Map(),
    handlers: new Map(),
    invoked: [],
    openExternal: mock((_url: string) => Promise.resolve()),
    paths: new Map(),
    quit: mock(() => {}),
    senderWindow: undefined,
    setApplicationMenu: mock((_menu: null) => {}),
    windows: [],
  };

  class BrowserWindow {
    readonly webContents: Electron.WebContents;
    private readonly fake: FakeWindow;

    constructor(options: Electron.BrowserWindowConstructorOptions) {
      const contents: FakeContents = { devTools: 0, listeners: new Map(), openHandler: undefined };
      this.fake = {
        calls: [],
        contents,
        loaded: undefined,
        maximized: false,
        minimized: false,
        options,
        ready: undefined,
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

    close(): void {
      this.fake.calls.push("close");
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
      return Promise.resolve();
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
    on: (event, listener) => {
      record.appListeners.set(event, listener);
      return app;
    },
    quit: () => record.quit(),
    setDesktopName: (name) => {
      record.desktopName.push(name);
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
    dialog: { showMessageBoxSync: () => record.dialogAnswer },
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
    Menu: { setApplicationMenu: (menu: null) => record.setApplicationMenu(menu) },
    shell: { openExternal: (url: string) => record.openExternal(url) },
  };

  /* The record itself, not a copy: `dialogAnswer` and `senderWindow` are read by the closures
     above at call time, so a test sets them on this object. */
  return Object.assign(record, { api });
}
