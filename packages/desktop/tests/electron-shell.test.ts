// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { describe, expect, mock, test } from "bun:test";
import type * as Electron from "electron";
import { SHELL_CHANNELS, SHELL_GLOBAL, exposeShell, shellBridge } from "../src/shared/bridge";
import {
  createStudioWindow,
  installApplicationMenu,
  isExternalLink,
  isShellNavigation,
  identifyApp,
  macApplicationMenu,
  raiseWindow,
  registerWindowActions,
  shellWindowOptions,
  switchValue,
} from "../src/main/shell";
import { fakeElectron } from "./_fake-electron";
import type { FakeElectron, FakeWindow } from "./_fake-electron";

const URL_ARG = "http://127.0.0.1:4321/__studio__/index.html?token=TOK";
const ORIGIN = "http://127.0.0.1:4321";
const ARGS = { icon: "/share/icon.png", preload: "/tmp/b/preload.js" };
const ICONLESS = { icon: null, preload: "/tmp/b/preload.js" };

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

/** Set the app up as `app.ts` does and open one Studio window over a fresh fake. */
async function started(
  platform: NodeJS.Platform = "linux",
  icon: string | null = ARGS.icon,
): Promise<{ fake: FakeElectron; window: FakeWindow }> {
  const fake = fakeElectron();
  identifyApp(fake.api.app, { icon }, platform);
  installApplicationMenu(fake.api, platform);
  registerWindowActions(fake.api);
  const opened = createStudioWindow(fake.api, { icon, preload: ARGS.preload, url: URL_ARG });
  await opened.loadURL(URL_ARG);
  const window = fake.windows.at(-1);
  if (!window) {
    throw new Error("no window opened");
  }
  return { fake, window };
}

describe("navigation policy", () => {
  test("only the window's own origin stays in it", () => {
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
    const options = shellWindowOptions(ARGS);
    expect(options).toMatchObject({ frame: false, icon: "/share/icon.png", show: false });
    expect(options.webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      preload: "/tmp/b/preload.js",
      sandbox: true,
    });
  });

  test("carries no icon key when there is none", () => {
    expect("icon" in shellWindowOptions(ICONLESS)).toBe(false);
  });
});

describe("window actions", () => {
  /** Register the actions over a fake with one window, and invoke a channel as its page would. */
  function setup() {
    const fake = fakeElectron();
    registerWindowActions(fake.api);
    const opened = new fake.api.BrowserWindow(shellWindowOptions(ARGS));
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

describe("a Studio window", () => {
  test("names the app for the desktop and loads Studio", async () => {
    const { fake, window } = await started();
    expect(fake.desktopName).toEqual(["jx-studio.desktop"]);
    expect(fake.setApplicationMenu).toHaveBeenCalledWith(null);
    expect(window.loaded).toBe(URL_ARG);
    const registered = [...fake.handlers.keys()].toSorted();
    const channels = Object.values(SHELL_CHANNELS).toSorted();
    expect(registered).toEqual(channels);
  });

  test("shows the window once it has painted", async () => {
    const { window } = await started();
    expect(window.calls).not.toContain("show");
    window.ready?.();
    expect(window.calls).toContain("show");
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

  test("on macOS: names the app, sets the Dock icon, and installs the application menu", async () => {
    const { fake, window } = await started("darwin");
    // Electron defines setDesktopName on Linux only; calling it on macOS would throw.
    expect(fake.desktopName).toEqual([]);
    expect(fake.names).toEqual(["Jx Studio"]);
    expect(fake.dockIcons).toEqual(["/share/icon.png"]);
    expect(fake.menuTemplates).toEqual([macApplicationMenu()]);
    expect(fake.setApplicationMenu).toHaveBeenCalledWith({ items: macApplicationMenu() });
    // The same frameless window: Studio draws its macOS-style buttons (`csd: "mac"`).
    expect(window.options.frame).toBe(false);
    expect(window.loaded).toBe(URL_ARG);
  });

  test("on macOS without an icon, the Dock keeps its own", async () => {
    const { fake } = await started("darwin", null);
    expect(fake.dockIcons).toEqual([]);
  });

  test("other platforms get neither the desktop name nor a menu", async () => {
    const { fake } = await started("win32");
    expect(fake.desktopName).toEqual([]);
    expect(fake.names).toEqual([]);
    expect(fake.setApplicationMenu).toHaveBeenCalledWith(null);
  });
});

describe("macApplicationMenu", () => {
  test("is the platform's roles: app, edit, DevTools and window, with no file menu", () => {
    const roles = macApplicationMenu().map((item) => item.role ?? item.label);
    expect(roles).toEqual(["appMenu", "editMenu", "View", "windowMenu"]);
    expect(macApplicationMenu()[2]?.submenu).toEqual([{ role: "toggleDevTools" }]);
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
    await import("../src/preload/preload");
    expect(fake.exposed.has(SHELL_GLOBAL)).toBe(true);
  });
});

describe("switchValue", () => {
  test("reads a --jx-<name>= switch, and is null when it is absent", () => {
    expect(switchValue(["--jx-a=1", "--jx-b=two=2"], "b")).toBe("two=2");
    expect(switchValue(["--jx-a=1"], "b")).toBeNull();
    expect(switchValue(["--jx-b="], "b")).toBe("");
  });
});

describe("shellWindowOptions extras", () => {
  const base = { icon: null, preload: "/b/preload.js" };

  test("a window can have its own title and storage partition", () => {
    const options = shellWindowOptions(base, { partition: "persist:p", title: "T" });
    expect(options.title).toBe("T");
    expect(options.webPreferences.partition).toBe("persist:p");
  });

  test("without extras it is the app's title in the default partition", () => {
    const options = shellWindowOptions(base);
    expect(options.title).toBe("Jx Studio");
    expect("partition" in options.webPreferences).toBe(false);
  });
});

describe("createStudioWindow", () => {
  test("wires a window without loading its page, so a caller can hold it first", () => {
    const fake = fakeElectron();
    createStudioWindow(fake.api, {
      icon: null,
      partition: "persist:p",
      preload: "/b/preload.js",
      title: "T",
      url: URL_ARG,
    });
    const window = fake.windows.at(0);
    expect(window?.loaded).toBeUndefined();
    expect(window?.options.webPreferences.partition).toBe("persist:p");
    // The same guards every window gets: navigation, DevTools, the unsaved-changes prompt.
    expect([...(window?.contents.listeners.keys() ?? [])].toSorted()).toEqual([
      "before-input-event",
      "will-navigate",
      "will-prevent-unload",
    ]);
    expect(window?.contents.openHandler).toBeDefined();
    expect(window?.ready).toBeDefined();
  });
});

describe("raiseWindow", () => {
  /** A window over a fresh fake, and the fake's record of it. */
  function opened() {
    const fake = fakeElectron();
    const window = new fake.api.BrowserWindow(shellWindowOptions({ icon: null, preload: "/p" }));
    const record = fake.windows.at(0);
    if (!record) {
      throw new Error("no window");
    }
    return { record, window };
  }

  test("shows and focuses a window that is on screen", () => {
    const { record, window } = opened();
    raiseWindow(window);
    expect(record.calls).toEqual(["show", "focus"]);
  });

  test("restores a minimized window first", () => {
    const { record, window } = opened();
    record.minimized = true;
    raiseWindow(window);
    expect(record.calls).toEqual(["restore", "show", "focus"]);
  });
});

describe("the macOS menu with a File menu", () => {
  const actions = { newWindow: mock(() => {}), openProject: mock(() => {}) };

  test("File sits between the app menu and Edit, with New Window and Open Project", () => {
    const menu = macApplicationMenu(actions);
    expect(menu.map((item) => item.role ?? item.label)).toEqual([
      "appMenu",
      "File",
      "editMenu",
      "View",
      "windowMenu",
    ]);
    const labels = menu.at(1)?.submenu?.map((item) => item.label ?? item.role ?? item.type);
    expect(labels).toEqual(["New Window", "Open Project…", "separator", "close"]);
  });

  test("its items run the actions, and carry no accelerator Studio's keymap would share", () => {
    const items = macApplicationMenu(actions).at(1)?.submenu ?? [];
    const newWindow = items.at(0);
    items.at(1)?.click?.();
    newWindow?.click?.();
    expect(actions.newWindow).toHaveBeenCalledTimes(1);
    expect(actions.openProject).toHaveBeenCalledTimes(1);
    expect(newWindow && "accelerator" in newWindow).toBe(false);
  });

  test("installApplicationMenu installs it on macOS, and nothing elsewhere", () => {
    const mac = fakeElectron();
    installApplicationMenu(mac.api, "darwin", actions);
    expect(mac.menuTemplates[0]?.some((item) => item.label === "File")).toBe(true);
    const linux = fakeElectron();
    installApplicationMenu(linux.api, "linux", actions);
    expect(linux.setApplicationMenu).toHaveBeenCalledWith(null);
  });
});
