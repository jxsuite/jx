// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { describe, expect, mock, test } from "bun:test";
import type * as Electron from "electron";
import {
  SHELL_CHANNELS,
  SHELL_GLOBAL,
  exposeShell,
  shellBridge,
} from "../src/electron-shell/bridge";
import {
  isExternalLink,
  isShellNavigation,
  parseShellArgs,
  registerWindowActions,
  shellWindowOptions,
  startShell,
} from "../src/electron-shell/shell";
import { fakeElectron } from "./_fake-electron";
import type { FakeElectron, FakeWindow } from "./_fake-electron";

const URL_ARG = "http://127.0.0.1:4321/__studio__/index.html?token=TOK";
const ORIGIN = "http://127.0.0.1:4321";
const ARGV = [
  "/nix/bin/electron",
  "/tmp/b/main.js",
  `--jx-url=${URL_ARG}`,
  "--jx-preload=/tmp/b/preload.js",
  "--jx-user-data-dir=/profiles/one",
  "--jx-icon=/share/icon.png",
];

/** A cancellable event that remembers whether it was cancelled. */
function event(url = ""): Electron.NavigationEvent & { prevented: boolean } {
  const result = {
    preventDefault() {
      result.prevented = true;
    },
    prevented: false,
    url,
  };
  return result;
}

/** Fire a recorded `WebContents` listener. */
function fire(window: FakeWindow, name: string, ...args: unknown[]): void {
  const listener = window.contents.listeners.get(name);
  if (!listener) {
    throw new Error(`no ${name} listener`);
  }
  // SAFETY: each test passes the arguments its named event's listener takes (electron.d.ts).
  (listener as (...a: unknown[]) => void)(...args);
}

/** Start a shell over a fresh fake and return both. */
async function started(argv = ARGV): Promise<{ fake: FakeElectron; window: FakeWindow }> {
  const fake = fakeElectron();
  await startShell(fake.api, argv);
  const window = fake.windows.at(-1);
  if (!window) {
    throw new Error("no window opened");
  }
  return { fake, window };
}

describe("parseShellArgs", () => {
  test("reads every --jx- switch", () => {
    expect(parseShellArgs(ARGV)).toEqual({
      icon: "/share/icon.png",
      preload: "/tmp/b/preload.js",
      url: URL_ARG,
      userDataDir: "/profiles/one",
    });
  });

  test("the icon and profile are optional", () => {
    expect(parseShellArgs(ARGV.slice(0, 4))).toMatchObject({ icon: null, userDataDir: null });
  });

  test("the URL and preload are not", () => {
    expect(() => parseShellArgs(["electron", "main.js"])).toThrow("--jx-url and --jx-preload");
    expect(() => parseShellArgs(ARGV.slice(0, 3))).toThrow("--jx-url and --jx-preload");
  });
});

describe("navigation policy", () => {
  test("only the launcher's own origin stays in the shell", () => {
    expect(isShellNavigation(`${ORIGIN}/__studio__/index.html`, ORIGIN)).toBe(true);
    expect(isShellNavigation("http://127.0.0.1:9999/", ORIGIN)).toBe(false);
    expect(isShellNavigation("https://jxsuite.com/docs", ORIGIN)).toBe(false);
    expect(isShellNavigation("not a url", ORIGIN)).toBe(false);
  });

  test("only web and mail links are handed to the user's browser", () => {
    expect(isExternalLink("https://jxsuite.com")).toBe(true);
    expect(isExternalLink("http://example.com")).toBe(true);
    expect(isExternalLink("mailto:a@b.c")).toBe(true);
    expect(isExternalLink("file:///etc/passwd")).toBe(false);
    expect(isExternalLink("data:text/html,x")).toBe(false);
    expect(isExternalLink("not a url")).toBe(false);
  });
});

describe("shellWindowOptions", () => {
  test("is frameless, hidden until painted, and isolated from Node", () => {
    const options = shellWindowOptions(parseShellArgs(ARGV));
    expect(options).toMatchObject({ frame: false, icon: "/share/icon.png", show: false });
    expect(options.webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      preload: "/tmp/b/preload.js",
      sandbox: true,
    });
  });

  test("carries no icon key when there is none", () => {
    const iconless = parseShellArgs(ARGV.slice(0, 4));
    expect("icon" in shellWindowOptions(iconless)).toBe(false);
  });
});

describe("window actions", () => {
  /** Register the actions over a fake with one window, and invoke a channel as its page would. */
  function setup() {
    const fake = fakeElectron();
    registerWindowActions(fake.api);
    const opened = new fake.api.BrowserWindow(shellWindowOptions(parseShellArgs(ARGV)));
    const window = fake.windows[0]!;
    expect(opened.webContents).toBeDefined();
    const invoke = (channel: string): void => {
      const handler = fake.handlers.get(channel);
      if (!handler) {
        throw new Error(`no handler for ${channel}`);
      }
      // SAFETY: the fake's fromWebContents never reads the sender; it resolves `senderWindow`.
      handler({ sender: {} as Electron.WebContents });
    };
    return { fake, invoke, window };
  }

  test("minimize, close", () => {
    const { invoke, window } = setup();
    invoke(SHELL_CHANNELS.minimize);
    invoke(SHELL_CHANNELS.close);
    expect(window.calls).toEqual(["minimize", "close"]);
  });

  test("maximize toggles against the window's real state", () => {
    const { invoke, window } = setup();
    invoke(SHELL_CHANNELS.maximize);
    invoke(SHELL_CHANNELS.maximize);
    expect(window.calls).toEqual(["maximize", "unmaximize"]);
  });

  test("focus restores a minimized window before raising it", () => {
    const { invoke, window } = setup();
    invoke(SHELL_CHANNELS.focus);
    window.minimized = true;
    invoke(SHELL_CHANNELS.focus);
    expect(window.calls).toEqual(["show", "focus", "restore", "show", "focus"]);
  });

  test("a sender with no window is ignored", () => {
    const { fake, invoke, window } = setup();
    fake.senderWindow = null;
    invoke(SHELL_CHANNELS.close);
    expect(window.calls).toEqual([]);
  });
});

describe("startShell", () => {
  test("names the app for the desktop, keeps its profile, and loads Studio", async () => {
    const { fake, window } = await started();
    expect(fake.desktopName).toEqual(["jx-studio.desktop"]);
    expect(fake.paths.get("userData")).toBe("/profiles/one");
    expect(fake.paths.get("sessionData")).toBe("/profiles/one");
    expect(fake.setApplicationMenu).toHaveBeenCalledWith(null);
    expect(window.loaded).toBe(URL_ARG);
    const registered = [...fake.handlers.keys()].toSorted();
    const channels = Object.values(SHELL_CHANNELS).toSorted();
    expect(registered).toEqual(channels);
  });

  test("without a profile directory Electron keeps its own", async () => {
    const { fake } = await started(ARGV.slice(0, 4));
    expect(fake.paths.size).toBe(0);
  });

  test("shows the window once it has painted, and quits when it closes", async () => {
    const { fake, window } = await started();
    expect(window.calls).not.toContain("show");
    window.ready?.();
    expect(window.calls).toContain("show");
    fake.appListeners.get("window-all-closed")?.();
    expect(fake.quit).toHaveBeenCalled();
  });

  test("same-origin navigation proceeds; a web link leaves for the browser", async () => {
    const { fake, window } = await started();
    const inside = event(`${ORIGIN}/__studio__/index.html`);
    fire(window, "will-navigate", inside);
    expect(inside.prevented).toBe(false);

    const outside = event("https://jxsuite.com/docs");
    fire(window, "will-navigate", outside);
    expect(outside.prevented).toBe(true);
    expect(fake.openExternal).toHaveBeenCalledWith("https://jxsuite.com/docs");
  });

  test("a non-web navigation is refused without reaching the desktop", async () => {
    const { fake, window } = await started();
    const sneaky = event("file:///etc/passwd");
    fire(window, "will-navigate", sneaky);
    expect(sneaky.prevented).toBe(true);
    expect(fake.openExternal).not.toHaveBeenCalled();
  });

  test("window.open never opens a window: web links go to the browser", async () => {
    const { fake, window } = await started();
    expect(window.contents.openHandler?.({ url: "https://example.com" })).toEqual({
      action: "deny",
    });
    expect(window.contents.openHandler?.({ url: "about:blank" })).toEqual({ action: "deny" });
    expect(fake.openExternal).toHaveBeenCalledTimes(1);
  });

  test("Ctrl+Shift+I toggles DevTools and nothing else does", async () => {
    const { window } = await started();
    const key = (input: Partial<Electron.Input>): boolean => {
      const e = event();
      fire(window, "before-input-event", e, {
        control: true,
        key: "I",
        shift: true,
        type: "keyDown",
        ...input,
      });
      return e.prevented;
    };
    expect(key({})).toBe(true);
    expect(key({ key: "i" })).toBe(true);
    expect(window.contents.devTools).toBe(2);
    expect(key({ type: "keyUp" })).toBe(false);
    expect(key({ shift: false })).toBe(false);
    expect(key({ control: false })).toBe(false);
    expect(key({ key: "J" })).toBe(false);
    expect(window.contents.devTools).toBe(2);
  });

  test("unsaved changes ask before closing, and only Close lets the unload through", async () => {
    const { fake, window } = await started();
    const stay = event();
    fire(window, "will-prevent-unload", stay);
    expect(stay.prevented).toBe(false);

    fake.dialogAnswer = 0;
    const leave = event();
    fire(window, "will-prevent-unload", leave);
    expect(leave.prevented).toBe(true);
  });

  test("bad arguments reject before anything is opened", async () => {
    const fake = fakeElectron();
    await expect(startShell(fake.api, ["electron"])).rejects.toThrow("--jx-url");
    expect(fake.windows).toHaveLength(0);
  });
});

describe("bridge", () => {
  test("each control invokes its channel", async () => {
    const fake = fakeElectron();
    const bridge = shellBridge(fake.api.ipcRenderer);
    await bridge.windowControls.minimize();
    await bridge.windowControls.maximize();
    await bridge.windowControls.close();
    await bridge.focus();
    expect(fake.invoked).toEqual([
      SHELL_CHANNELS.minimize,
      SHELL_CHANNELS.maximize,
      SHELL_CHANNELS.close,
      SHELL_CHANNELS.focus,
    ]);
  });

  test("is exposed on the global the adapter reads", () => {
    const fake = fakeElectron();
    exposeShell(fake.api.contextBridge, fake.api.ipcRenderer);
    expect(SHELL_GLOBAL).toBe("__jxShell");
    // SAFETY: exposeShell published shellBridge's object under this key, the line above.
    const bridge = fake.exposed.get(SHELL_GLOBAL) as object;
    expect(Object.keys(bridge).toSorted()).toEqual(["focus", "windowControls"]);
  });
});

describe("entry points", () => {
  test("preload.ts publishes the bridge through the runtime's own modules", async () => {
    const fake = fakeElectron();
    void mock.module("electron", () => fake.api);
    await import("../src/electron-shell/preload");
    expect(fake.exposed.has(SHELL_GLOBAL)).toBe(true);
  });

  test("main.ts quits rather than linger when the shell cannot start", async () => {
    const fake = fakeElectron();
    void mock.module("electron", () => fake.api);
    const errors = mock((..._args: unknown[]) => {});
    const realError = console.error;
    console.error = errors;
    try {
      // This process's argv carries no --jx-url, which is exactly a failed start.
      await import("../src/electron-shell/main");
      await Bun.sleep(0);
      expect(fake.quit).toHaveBeenCalled();
      expect(errors.mock.calls[0]?.[0]).toBe("[electron-shell]");
    } finally {
      console.error = realError;
    }
  });
});
