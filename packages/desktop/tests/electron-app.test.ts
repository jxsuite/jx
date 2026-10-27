// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { BackendMessage, ShellMessage } from "../src/hub/protocol";
import { SHELL_CHANNELS } from "../src/electron-shell/bridge";
import {
  parseAppArgs as parseAppArgsRaw,
  projectDirOf,
  projectRootFrom as projectRootFromRaw,
  startApp,
} from "../src/electron-shell/app";
import type { AppDeps } from "../src/electron-shell/app";
import type { BackendProcess } from "../src/electron-shell/backend-process";
import type { Grant } from "../src/electron-shell/folder-grants";
import { posix } from "./_posix";
import { fakeElectron } from "./_fake-electron";
import { fakeSchedule, fakeUpdater } from "./_fake-updater";
import { packagedLayout } from "../src/electron-shell/layout";
import type { FakeElectron } from "./_fake-electron";

/** `projectRootFrom`, answering in POSIX spelling and handing `exists` POSIX paths. */
function projectRootFrom(
  ...[args, env, cwd, exists, appPath]: Parameters<typeof projectRootFromRaw>
) {
  const root = projectRootFromRaw(args, env, cwd, (path) => exists(posix(path)), appPath);
  return root === null ? root : posix(root);
}

/** `parseAppArgs`, answering in POSIX spelling and handing `exists` POSIX paths. */
function parseAppArgs(
  ...[argv, env, cwd, exists, appPath, layout]: Parameters<typeof parseAppArgsRaw>
) {
  const parsed = parseAppArgsRaw(argv, env, cwd, (path) => exists(posix(path)), appPath, layout);
  const spelled = (path: string | null) => (path === null ? path : posix(path));
  return {
    ...parsed,
    backend: posix(parsed.backend),
    icon: spelled(parsed.icon),
    preload: posix(parsed.preload),
    root: spelled(parsed.root),
    studio: spelled(parsed.studio),
  };
}

/** A backend the test drives: what the app sent it, and a way to speak for it. */
function fakeBackend() {
  const sent: ShellMessage[] = [];
  let toApp: (message: BackendMessage) => void = () => {};
  let onExit: () => void = () => {};
  let killed = 0;
  const process: BackendProcess = {
    kill: () => {
      killed += 1;
    },
    onExit: (listener) => {
      onExit = listener;
    },
    onMessage: (listener) => {
      toApp = listener;
    },
    send: (message) =>
      sent.push(
        message.type === "open-project" && message.root !== null
          ? { ...message, root: posix(message.root) }
          : message,
      ),
  };
  return {
    emit: (message: BackendMessage) => toApp(message),
    exit: () => onExit(),
    killed: () => killed,
    process,
    sent,
  };
}

const ARGV = [
  "/bin/electron",
  "/b/app-main.js",
  "--jx-backend=/build/backend/index.js",
  "--jx-preload=/b/preload.js",
  "--jx-icon=/share/icon.png",
  "--jx-project=/proj/alpha",
];

interface Started {
  backend: ReturnType<typeof fakeBackend>;
  fake: FakeElectron;
  handle: NonNullable<Awaited<ReturnType<typeof startApp>>>;
  spawned: { env: NodeJS.ProcessEnv; script: string }[];
}

/** Start the app over fakes. */
async function started(
  options: {
    argv?: string[];
    configure?: (fake: FakeElectron) => void;
    deps?: Partial<AppDeps>;
  } = {},
): Promise<Started> {
  const fake = fakeElectron();
  options.configure?.(fake);
  const backend = fakeBackend();
  const spawned: Started["spawned"] = [];
  const deps: Partial<AppDeps> = {
    cwd: "/work",
    env: { ELECTRON_RUN_AS_NODE: "1", HOME: "/home/u" },
    exists: () => false,
    platform: "linux",
    spawn: (script, env) => {
      spawned.push({
        env: env.JX_STUDIO_ASSETS ? { ...env, JX_STUDIO_ASSETS: posix(env.JX_STUDIO_ASSETS) } : env,
        script: posix(script),
      });
      return backend.process;
    },
    ...options.deps,
  };
  const given = deps.exists ?? (() => false);
  const handle = await startApp(fake.api, options.argv ?? ARGV, {
    ...deps,
    exists: (path) => given(posix(path)),
  });
  if (!handle) {
    throw new Error("the app did not start");
  }
  return { backend, fake, handle, spawned };
}

/** The message a window-opening backend sends. */
const openWindow: Extract<BackendMessage, { type: "open-window" }> = {
  id: 1,
  partition: "persist:project-abc",
  title: "alpha — Jx Studio",
  type: "open-window",
  url: "http://127.0.0.1:4000/__studio__/index.html?token=T",
};

const realError = console.error;
afterEach(() => {
  console.error = realError;
});

describe("projectRootFrom", () => {
  const none = (): boolean => false;

  test("a --jx-project switch names the project, resolved against the working directory", () => {
    expect(projectRootFrom(["--jx-project=/abs"], {}, "/cwd", none)).toBe("/abs");
    expect(projectRootFrom(["--jx-project=rel"], {}, "/cwd", none)).toBe("/cwd/rel");
  });

  test("a bare argument names the project, resolved against the working directory", () => {
    expect(projectRootFrom(["site"], {}, "/cwd", none)).toBe("/cwd/site");
    expect(projectRootFrom(["/abs/site"], {}, "/cwd", none)).toBe("/abs/site");
  });

  test("the app's own script is the one bare argument that is not a project", () => {
    const appPath = "/b";
    /* `electron <script> site`: the script lies inside the app's directory, so the next bare
       argument is the project. */
    expect(projectRootFrom(["/b/app-main.js", "site"], {}, "/cwd", none, appPath)).toBe(
      "/cwd/site",
    );
    expect(projectRootFrom(["/b/app-main.js"], {}, "/cwd", none, appPath)).toBeNull();
    // However the script was spelled: relative paths resolve against the directory it was run in.
    expect(projectRootFrom(["app-main.js"], {}, "/b", none, appPath)).toBeNull();
    // A project beside the app's directory, not inside it, is still a project.
    expect(projectRootFrom(["/bsite"], {}, "/cwd", none, appPath)).toBe("/bsite");
  });

  test("switches are never taken for a path, and a named project beats a bare one", () => {
    expect(projectRootFrom(["-psn_0_1", "--jx-icon=/i"], {}, "/cwd", none)).toBeNull();
    expect(projectRootFrom(["site", "--jx-project=/named"], {}, "/cwd", none)).toBe("/named");
  });

  test("JSONSX_PROJECT_ROOT comes next", () => {
    expect(projectRootFrom([], { JSONSX_PROJECT_ROOT: "/env" }, "/cwd", none)).toBe("/env");
    expect(projectRootFrom([], { JSONSX_PROJECT_ROOT: "rel" }, "/cwd", none)).toBe("/cwd/rel");
  });

  test("the working directory counts only when it is a project, so $HOME never does", () => {
    const isProject = (path: string): boolean => path === "/cwd/project.json";
    expect(projectRootFrom([], {}, "/cwd", isProject)).toBe("/cwd");
    expect(projectRootFrom([], {}, "/home/u", isProject)).toBeNull();
  });
});

describe("projectDirOf", () => {
  test("a project.json means its folder; anything else is already a folder", () => {
    expect(projectDirOf("/p/site/project.json")).toBe("/p/site");
    expect(projectDirOf("/p/site")).toBe("/p/site");
  });
});

describe("parseAppArgs", () => {
  test("reads every switch", () => {
    expect(parseAppArgs(ARGV, {}, "/cwd", () => false)).toEqual({
      backend: "/build/backend/index.js",
      icon: "/share/icon.png",
      preload: "/b/preload.js",
      root: "/proj/alpha",
      studio: null,
    });
  });

  test("leaves the icon out, and the project, when they were not given", () => {
    const args = parseAppArgs(["--jx-backend=/m", "--jx-preload=/p"], {}, "/cwd", () => false);
    expect(args.icon).toBeNull();
    expect(args.root).toBeNull();
  });

  test.each(["backend", "preload"])("refuses to start without --jx-%s", (missing) => {
    const argv = ARGV.filter((arg) => !arg.startsWith(`--jx-${missing}=`));
    expect(() => parseAppArgs(argv, {}, "/cwd", () => false)).toThrow("--jx-backend");
  });
});

describe("startApp", () => {
  test("a second instance quits at once, having told the first, and starts nothing", async () => {
    const fake = fakeElectron();
    fake.lock = false;
    const spawn = mock(() => fakeBackend().process);
    // No switches at all: a second launch has no backend of its own to describe.
    const handle = await startApp(fake.api, ["/bin/electron", "/b/app-main.js"], { spawn });
    expect(handle).toBeNull();
    expect(fake.quit).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("pins the app's name and profile before the lock, which lives in that profile", async () => {
    // An unpackaged Electron is "Electron": without this every such app shares one lock and profile.
    const fake = fakeElectron();
    fake.lock = false;
    await startApp(fake.api, ["/bin/electron"], { spawn: () => fakeBackend().process });
    expect(fake.names).toEqual(["Jx Studio"]);
    expect(posix(fake.paths.get("userData") ?? "")).toBe("/appdata/Jx Studio");
  });

  test("starts the backend bundle, without the variable that would make Electron a Node", async () => {
    const { spawned } = await started();
    expect(spawned).toEqual([{ env: { HOME: "/home/u" }, script: "/build/backend/index.js" }]);
  });

  test("starts it as a utility process of this Electron when no spawn is injected", async () => {
    const fake = fakeElectron();
    const handle = await startApp(fake.api, ARGV, {
      cwd: "/work",
      env: { HOME: "/home/u" },
      exists: () => false,
      platform: "linux",
    });
    expect(posix(fake.forks[0]?.modulePath ?? "")).toBe("/build/backend/index.js");
    expect(fake.forks[0]?.options.serviceName).toBe("Jx Studio Backend");
    handle?.backend.kill();
  });

  test("holds the first open until the backend is listening, then sends it", async () => {
    const { backend } = await started();
    expect(backend.sent).toEqual([]);
    backend.emit({ type: "ready" });
    expect(backend.sent).toEqual([{ root: "/proj/alpha", type: "open-project" }]);
    // Once ready, a message goes straight through.
    backend.emit({ type: "dialog", kind: "file", requestId: 1, title: "t" });
    await Bun.sleep(0);
    expect(backend.sent).toHaveLength(2);
  });

  test("names the app for the OS and registers the window actions", async () => {
    const { fake } = await started({ deps: { platform: "darwin" } });
    expect(new Set(fake.names)).toEqual(new Set(["Jx Studio"]));
    expect([...fake.handlers.keys()].toSorted()).toEqual(Object.values(SHELL_CHANNELS).toSorted());
  });
});

describe("windows", () => {
  test("open-window builds a window in the project's partition and loads its page", async () => {
    const { backend, fake, handle } = await started();
    backend.emit(openWindow);
    const window = fake.windows.at(0);
    expect(window?.options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:project-abc",
      preload: "/b/preload.js",
      sandbox: true,
    });
    expect(window?.options).toMatchObject({
      frame: false,
      icon: "/share/icon.png",
      title: "alpha — Jx Studio",
    });
    expect(window?.loaded).toBe(openWindow.url);
    expect(handle.windows.has(1)).toBe(true);
  });

  test("hands the icon it was given to the macOS Dock tile", async () => {
    const { fake } = await started();
    expect(fake.dockIcons).toEqual(["/share/icon.png"]);
  });

  test("closing a window forgets it and tells the backend", async () => {
    const { backend, fake, handle } = await started();
    backend.emit({ type: "ready" });
    backend.emit(openWindow);
    fake.windows[0]?.closed?.();
    expect(handle.windows.has(1)).toBe(false);
    expect(backend.sent.at(-1)).toEqual({ id: 1, type: "window-closed" });
  });

  test("a page that will not load is reported, not swallowed", async () => {
    const errors = mock((..._args: unknown[]) => {});
    console.error = errors;
    const { backend } = await started({
      configure: (fake) => {
        fake.loadError = new Error("refused");
      },
    });
    backend.emit(openWindow);
    await Bun.sleep(0);
    expect(errors.mock.calls[0]?.[0]).toBe("[electron-app]");
  });

  test("focus-window raises a minimized window, and an unknown one changes nothing", async () => {
    const { backend, fake } = await started();
    backend.emit(openWindow);
    const window = fake.windows.at(0);
    if (!window) {
      throw new Error("no window");
    }
    window.minimized = true;
    backend.emit({ id: 1, type: "focus-window" });
    expect(window.calls).toEqual(["restore", "show", "focus"]);
    backend.emit({ id: 404, type: "focus-window" });
    expect(window.calls).toHaveLength(3);
  });

  test("set-title retitles the window it names", async () => {
    const { backend, fake } = await started();
    backend.emit(openWindow);
    backend.emit({ id: 1, title: "beta — Jx Studio", type: "set-title" });
    backend.emit({ id: 404, title: "ignored", type: "set-title" });
    expect(fake.windows[0]?.title).toBe("beta — Jx Studio");
  });
});

describe("dialogs", () => {
  /** Ask for a dialog and return what the app answered the backend with. */
  async function ask(
    kind: "directory" | "file",
    fake: FakeElectron,
    backend: Started["backend"],
  ): Promise<ShellMessage | undefined> {
    backend.emit({ type: "ready" });
    backend.emit({ kind, requestId: 7, title: "Pick", type: "dialog" });
    await Bun.sleep(0);
    expect(fake.openDialogs).not.toHaveLength(0);
    return backend.sent.at(-1);
  }

  test("a project pick filters to JSON and answers the chosen path", async () => {
    const { backend, fake } = await started({
      configure: (f) => {
        f.openAnswer = { canceled: false, filePaths: ["/p/project.json"] };
      },
    });
    expect(await ask("file", fake, backend)).toEqual({
      path: "/p/project.json",
      requestId: 7,
      type: "dialog-result",
    });
    expect(fake.openDialogs[0]?.options).toEqual({
      filters: [{ extensions: ["json"], name: "Project files" }],
      properties: ["openFile"],
      title: "Pick",
    });
  });

  test("a folder pick can make a folder, and has no file filter", async () => {
    const { backend, fake } = await started({
      configure: (f) => {
        f.openAnswer = { canceled: false, filePaths: ["/p"] };
      },
    });
    await ask("directory", fake, backend);
    expect(fake.openDialogs[0]?.options).toEqual({
      properties: ["openDirectory", "createDirectory"],
      title: "Pick",
    });
  });

  test("cancelling answers null, and so does choosing nothing", async () => {
    const cancelled = await started();
    expect(await ask("file", cancelled.fake, cancelled.backend)).toMatchObject({ path: null });
    const empty = await started({
      configure: (f) => {
        f.openAnswer = { canceled: false, filePaths: [] };
      },
    });
    expect(await ask("file", empty.fake, empty.backend)).toMatchObject({ path: null });
  });

  test("is a sheet on the focused window when there is one", async () => {
    const { backend, fake } = await started();
    backend.emit(openWindow);
    fake.focusedWindow = fake.windows[0] ?? null;
    await ask("file", fake, backend);
    expect(fake.openDialogs[0]?.parented).toBe(true);
  });

  test("a dialog that fails is reported and answers null", async () => {
    const errors = mock((..._args: unknown[]) => {});
    console.error = errors;
    const { backend, fake } = await started({
      configure: (f) => {
        f.openError = new Error("no portal");
      },
    });
    expect(await ask("file", fake, backend)).toMatchObject({ path: null, type: "dialog-result" });
    expect(errors.mock.calls[0]?.[0]).toBe("[electron-app]");
  });
});

describe("the app's life", () => {
  test("a quit from the backend, the backend's exit and the last window all end the app", async () => {
    const quit = await started();
    quit.backend.emit({ type: "quit" });
    expect(quit.fake.quit.mock.calls).toEqual([[]]);

    const exited = await started();
    exited.backend.exit();
    expect(exited.fake.quit.mock.calls).toEqual([[]]);

    const last = await started();
    last.fake.emitApp("window-all-closed");
    expect(last.fake.quit.mock.calls).toEqual([[]]);
  });

  test("the backend does not outlive the app", async () => {
    const { backend, fake } = await started();
    fake.emitApp("will-quit");
    expect(backend.killed()).toBe(1);
  });
});

describe("launches and files", () => {
  /** Fire the app's `second-instance` event. */
  function secondLaunch(fake: FakeElectron, argv: string[], cwd: string): void {
    fake.emitApp("second-instance", { preventDefault: () => {} }, argv, cwd);
  }

  test("a second launch opens the project it names, in this process", async () => {
    const { backend, fake } = await started();
    backend.emit({ type: "ready" });
    secondLaunch(fake, ["/bin/electron", "/b/app-main.js", "--jx-project=/proj/beta"], "/x");
    expect(backend.sent.at(-1)).toEqual({ root: "/proj/beta", type: "open-project" });
  });

  test("a second launch from inside a project opens that project; from anywhere else, a welcome window", async () => {
    const { backend, fake } = await started({
      deps: { exists: (path) => path === "/proj/gamma/project.json" },
    });
    backend.emit({ type: "ready" });
    secondLaunch(fake, ["/bin/electron", "/b/app-main.js"], "/proj/gamma");
    expect(backend.sent.at(-1)).toEqual({ root: "/proj/gamma", type: "open-project" });
    secondLaunch(fake, ["/bin/electron", "/b/app-main.js"], "/home/u");
    expect(backend.sent.at(-1)).toEqual({ root: null, type: "open-project" });
  });

  test("a bare argument names the project, with or without a script before it", async () => {
    // Unpackaged, as the Nix wrapper runs it: the script is in argv, and so is the project.
    const unpackaged = await started({ argv: [...ARGV.slice(0, -1), "site"] });
    unpackaged.backend.emit({ type: "ready" });
    expect(unpackaged.backend.sent).toEqual([{ root: "/work/site", type: "open-project" }]);
    secondLaunch(unpackaged.fake, ["/bin/electron", "/b/app-main.js", "other"], "/w2");
    expect(unpackaged.backend.sent.at(-1)).toEqual({ root: "/w2/other", type: "open-project" });

    // Packaged: no script, so the first bare argument is the project.
    const packaged = await started({
      argv: ["/Applications/Jx Studio", "--jx-backend=/m", "--jx-preload=/p", "site"],
    });
    packaged.backend.emit({ type: "ready" });
    expect(packaged.backend.sent).toEqual([{ root: "/work/site", type: "open-project" }]);
  });

  test("a file the OS opens is a project to open, even before the backend is up", async () => {
    const { backend, fake } = await started();
    let prevented = 0;
    fake.emitApp("open-file", { preventDefault: () => (prevented += 1) }, "/p/site/project.json");
    expect(prevented).toBe(1);
    backend.emit({ type: "ready" });
    expect(backend.sent).toEqual([
      { root: "/proj/alpha", type: "open-project" },
      { root: "/p/site", type: "open-project" },
    ]);
  });
});

/** The File menu's two items' actions. */
interface FileMenuItems {
  newWindow: () => void;
  openProject: () => void;
}

describe("the macOS File menu", () => {
  /** The File menu's two items, from the template the app installed. */
  function fileMenu(fake: FakeElectron): FileMenuItems {
    const file = fake.menuTemplates.at(0)?.find((item) => item.label === "File");
    const items = file?.submenu ?? [];
    const newWindow = items.at(0);
    const openProject = items.at(1);
    if (!newWindow?.click || !openProject?.click) {
      throw new Error("no File menu");
    }
    return { newWindow: newWindow.click, openProject: openProject.click };
  }

  test("New Window asks for a welcome window", async () => {
    const { backend, fake } = await started({ deps: { platform: "darwin" } });
    backend.emit({ type: "ready" });
    fileMenu(fake).newWindow();
    expect(backend.sent.at(-1)).toEqual({ root: null, type: "open-project" });
  });

  test("Open Project opens the folder of the project.json chosen, and nothing else", async () => {
    const { backend, fake } = await started({
      configure: (f) => {
        f.openAnswer = { canceled: false, filePaths: ["/p/site/project.json"] };
      },
      deps: { platform: "darwin" },
    });
    backend.emit({ type: "ready" });
    fileMenu(fake).openProject();
    await Bun.sleep(0);
    expect(backend.sent.at(-1)).toEqual({ root: "/p/site", type: "open-project" });

    const before = backend.sent.length;
    fake.openAnswer = { canceled: false, filePaths: ["/p/site/notes.txt"] };
    fileMenu(fake).openProject();
    await Bun.sleep(0);
    fake.openAnswer = { canceled: true, filePaths: [] };
    fileMenu(fake).openProject();
    await Bun.sleep(0);
    expect(backend.sent).toHaveLength(before);
  });

  test("there is no application menu off macOS", async () => {
    const { fake } = await started();
    expect(fake.setApplicationMenu).toHaveBeenCalledWith(null);
    expect(fake.menuTemplates).toEqual([]);
  });
});

describe("app-main.ts", () => {
  test("quits rather than linger when the app cannot start", async () => {
    const fake = fakeElectron();
    void mock.module("electron", () => fake.api);
    const errors = mock((..._args: unknown[]) => {});
    const spy = spyOn(console, "error").mockImplementation(errors);
    try {
      // This process's argv carries no --jx-backend, which is exactly a failed start.
      await import("../src/electron-shell/app-main");
      await Bun.sleep(0);
      expect(fake.quit).toHaveBeenCalled();
      expect(errors.mock.calls[0]?.[0]).toBe("[electron-app]");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("a project.json path names its project's folder", () => {
  const none = (): boolean => false;

  test("whether it arrives by switch or as a bare argument, as a file association delivers it", () => {
    expect(projectRootFrom(["--jx-project=/p/site/project.json"], {}, "/cwd", none)).toBe(
      "/p/site",
    );
    expect(projectRootFrom(["/p/site/project.json"], {}, "/cwd", none)).toBe("/p/site");
    expect(projectRootFrom(["site/project.json"], {}, "/cwd", none)).toBe("/cwd/site");
    // Only that file name: another .json is just a path the user chose.
    expect(projectRootFrom(["/p/site/other.json"], {}, "/cwd", none)).toBe("/p/site/other.json");
  });
});

describe("parseAppArgs for a packaged app", () => {
  const layout = packagedLayout("/R", "/R/app.asar", "linux");

  test("takes everything from the layout when no switch says otherwise", () => {
    expect(parseAppArgs([], {}, "/cwd", () => false, "/R/app.asar", layout)).toEqual({
      backend: "/R/backend/index.js",
      icon: "/R/icon.png",
      preload: "/R/app.asar/preload.js",
      root: null,
      studio: "/R/studio",
    });
  });

  test("lets a switch override the layout", () => {
    const args = parseAppArgs(
      ["--jx-backend=/mine/index.js"],
      {},
      "/cwd",
      () => false,
      "/R/app.asar",
      layout,
    );
    expect(args.backend).toBe("/mine/index.js");
    expect(args.preload).toBe("/R/app.asar/preload.js");
  });

  test("macOS gets no window icon, because the bundle draws its own", () => {
    const mac = packagedLayout("/R", "/R/app.asar", "darwin");
    expect(parseAppArgs([], {}, "/cwd", () => false, "/R/app.asar", mac).icon).toBeNull();
  });
});

describe("startApp when packaged", () => {
  /** Start a packaged app: the executable alone in argv, as the OS launches it. */
  function packaged(options: { deps?: Partial<AppDeps>; platform?: NodeJS.Platform } = {}) {
    return started({
      argv: ["/Applications/Jx Studio"],
      configure: (fake) => {
        fake.packaged = true;
      },
      deps: {
        loadUpdater: () => Promise.reject(new Error("not under test")),
        platform: options.platform ?? "linux",
        resourcesPath: "/R",
        ...options.deps,
      },
    });
  }

  test("runs the backend from its own resources, with no switches", async () => {
    errorsQuiet();
    const { spawned } = await packaged();
    expect(spawned[0]?.script).toBe("/R/backend/index.js");
  });

  test("tells the backend where the studio assets are, and that this is a stable build", async () => {
    errorsQuiet();
    const { spawned } = await packaged();
    expect(spawned[0]?.env).toMatchObject({
      HOME: "/home/u",
      JX_STUDIO_ASSETS: "/R/studio",
      JX_STUDIO_CHANNEL: "stable",
    });
  });

  test("opens its windows with the preload inside app.asar", async () => {
    errorsQuiet();
    const { backend, fake } = await packaged();
    backend.emit(openWindow);
    expect(posix(fake.windows[0]?.options.webPreferences.preload ?? "")).toBe("/b/preload.js");
  });

  test("an unpackaged run sets neither, because its launcher says what it is", async () => {
    const { spawned } = await started();
    expect(spawned[0]?.env).not.toHaveProperty("JX_STUDIO_ASSETS");
    expect(spawned[0]?.env).not.toHaveProperty("JX_STUDIO_CHANNEL");
  });
});

/** Silence the "[electron-app]" line a packaged start logs when its updater is not under test. */
function errorsQuiet(): void {
  console.error = () => {};
}

describe("self-updates", () => {
  /** Start a packaged app whose updater is the fake. */
  async function updating(
    options: {
      answer?: number;
      deps?: Partial<AppDeps>;
      env?: NodeJS.ProcessEnv;
      platform?: NodeJS.Platform;
    } = {},
  ) {
    const updater = fakeUpdater();
    const timers = fakeSchedule();
    const load = mock(() => Promise.resolve(updater.updater));
    const app = await started({
      argv: ["/Applications/Jx Studio"],
      configure: (fake) => {
        fake.packaged = true;
        fake.messageAnswer = options.answer ?? 0;
      },
      deps: {
        env: options.env ?? {},
        loadUpdater: load,
        macAppStore: false,
        platform: options.platform ?? "darwin",
        resourcesPath: "/R",
        schedule: timers.schedule,
        windowsStore: false,
        ...options.deps,
      },
    });
    await Bun.sleep(0);
    return { ...app, load, timers, updater };
  }

  test("a packaged build starts the updater, which checks on its schedule", async () => {
    const { load, timers, updater } = await updating();
    expect(load).toHaveBeenCalledTimes(1);
    timers.calls[0]?.run();
    expect(updater.state.checks).toBe(1);
  });

  test.each([
    ["a checkout", { configure: false }],
    ["a Store install", { platform: "win32" as const, windowsStore: true }],
    ["a Mac App Store install", { macAppStore: true }],
    ["a Linux build that is not an AppImage", { platform: "linux" as const }],
  ])("%s does not", async (_name, options) => {
    const load = mock(() => Promise.resolve(fakeUpdater().updater));
    await started({
      // A checkout is told where everything is by switches; an installed app by its resources.
      argv: "configure" in options ? ARGV : ["/Applications/Jx Studio"],
      configure: (fake) => {
        fake.packaged = !("configure" in options);
      },
      deps: {
        env: {},
        loadUpdater: load,
        macAppStore: "macAppStore" in options,
        platform: "platform" in options ? options.platform : "darwin",
        resourcesPath: "/R",
        schedule: fakeSchedule().schedule,
        windowsStore: "windowsStore" in options,
      },
    });
    await Bun.sleep(0);
    expect(load.mock.calls).toEqual([]);
  });

  test("a Linux AppImage does", async () => {
    const { load } = await updating({
      env: { APPIMAGE: "/h/JxStudio.AppImage" },
      platform: "linux",
    });
    expect(load.mock.calls).toHaveLength(1);
  });

  test("tells the About screen, through the backend, what the updater found", async () => {
    const { backend, updater } = await updating();
    backend.emit({ type: "ready" });
    updater.emit("update-available", { version: "9.9.9" });
    expect(backend.sent.at(-1)).toEqual({
      text: "Update available (9.9.9)",
      type: "update-status",
    });
  });

  test("asks before restarting into a downloaded update, and restarts when told to", async () => {
    const { fake, updater } = await updating({ answer: 0 });
    updater.emit("update-downloaded", { version: "2.0.0" });
    await Bun.sleep(0);
    expect(fake.messageBoxes[0]).toMatchObject({
      buttons: ["Restart Now", "Later"],
      message: "Jx Studio 2.0.0 is ready.",
      type: "info",
    });
    expect(updater.state.quits).toBe(1);
  });

  test("leaves the app running when the user says later", async () => {
    const { updater } = await updating({ answer: 1 });
    updater.emit("update-downloaded", { version: "2.0.0" });
    await Bun.sleep(0);
    expect(updater.state.quits).toBe(0);
  });

  test("an updater that cannot load is reported and does not stop the app", async () => {
    const errors = mock((..._args: unknown[]) => {});
    console.error = errors;
    const { handle } = await updating({
      deps: { loadUpdater: () => Promise.reject(new Error("no module")) },
    });
    await Bun.sleep(0);
    expect(errors.mock.calls[0]?.[0]).toBe("[electron-app]");
    expect(handle.windows.size).toBe(0);
  });
});

describe("a Mac App Store build, which the App Sandbox lets into a folder only after it is picked", () => {
  const BARE = [
    "/bin/electron",
    "/b/app-main.js",
    "--jx-backend=/build/backend/index.js",
    "--jx-preload=/b/preload.js",
  ];

  /** Start the app as a Mac App Store build over fakes, with a new fake backend per spawn. */
  async function sandboxed(options: { argv?: string[]; granted?: Grant[] } = {}) {
    const backends: ReturnType<typeof fakeBackend>[] = [];
    const written: Grant[][] = [];
    const accessedAtSpawn: string[][] = [];
    let fakeRef: FakeElectron | undefined;
    const app = await started({
      argv: options.argv ?? BARE,
      configure: (fake) => {
        fakeRef = fake;
      },
      deps: {
        grantStore: {
          read: () => options.granted ?? [],
          write: (grants) => written.push([...grants]),
        },
        exists: (path: string) => path.startsWith("/p/") && path.endsWith("/project.json"),
        macAppStore: true,
        platform: "darwin",
        spawn: () => {
          const next = fakeBackend();
          backends.push(next);
          accessedAtSpawn.push([...(fakeRef?.accessed ?? [])]);
          return next.process;
        },
      },
    });
    return { ...app, accessedAtSpawn, backends, written };
  }

  /** Make the first backend say it is listening, then ask for a folder the way Studio does. */
  function ask(
    app: Awaited<ReturnType<typeof sandboxed>>,
    kind: "directory" | "file",
    pick: { bookmarks?: string[]; filePaths: string[] },
  ) {
    app.backends.at(-1)?.emit({ type: "ready" });
    app.fake.openAnswer = { canceled: false, ...pick };
    app.backends.at(-1)?.emit({ kind, requestId: 7, title: "Open", type: "dialog" });
  }

  test("takes up every stored grant before the backend is spawned, so the backend inherits them", async () => {
    const app = await sandboxed({ granted: [{ bookmark: "OLD", path: "/Users/u/site" }] });
    expect(app.accessedAtSpawn).toEqual([["OLD"]]);
    expect(app.fake.accessed).toEqual(["OLD"]);
  });

  test("asks for the project's folder, with a bookmark, because a picked file grants only itself", async () => {
    const app = await sandboxed();
    ask(app, "file", { bookmarks: ["B"], filePaths: ["/p/site"] });
    await Bun.sleep(0);
    expect(app.fake.openDialogs[0]?.options).toEqual({
      properties: ["openDirectory", "createDirectory"],
      securityScopedBookmarks: true,
      title: "Open project folder",
    });
  });

  test("answers a pick inside a granted folder as usual, and does not restart", async () => {
    const app = await sandboxed({ granted: [{ bookmark: "OLD", path: "/p" }] });
    ask(app, "file", { bookmarks: ["B"], filePaths: ["/p/site"] });
    await Bun.sleep(0);
    expect(app.backends).toHaveLength(1);
    expect(app.backends[0]?.sent).toContainEqual({
      path: "/p/site/project.json",
      requestId: 7,
      type: "dialog-result",
    });
  });

  test("a pick no grant covers keeps the bookmark and restarts the backend onto that project", async () => {
    const app = await sandboxed();
    ask(app, "file", { bookmarks: ["B"], filePaths: ["/p/site"] });
    await Bun.sleep(0);
    expect(app.written.at(-1)).toEqual([{ bookmark: "B", path: "/p/site" }]);
    expect(app.backends[0]?.killed()).toBe(1);
    expect(app.backends).toHaveLength(2);
    // The new backend started after the grant was taken up, which is the whole point.
    expect(app.accessedAtSpawn[1]).toContain("B");
    expect(app.backends[0]?.sent.some((message) => message.type === "dialog-result")).toBe(false);
    app.backends[1]?.emit({ type: "ready" });
    expect(app.backends[1]?.sent).toContainEqual({ root: "/p/site", type: "open-project" });
    expect(app.fake.messageBoxes).toEqual([]);
  });

  test("a folder picked to create a project in restarts onto a welcome window, not a project", async () => {
    const app = await sandboxed();
    ask(app, "directory", { bookmarks: ["B"], filePaths: ["/Users/u/Sites"] });
    await Bun.sleep(0);
    expect(app.written.at(-1)).toEqual([{ bookmark: "B", path: "/Users/u/Sites" }]);
    app.backends[1]?.emit({ type: "ready" });
    expect(app.backends[1]?.sent).toContainEqual({ root: null, type: "open-project" });
  });

  test("with a project open it asks first, and Cancel leaves everything as it was", async () => {
    const app = await sandboxed({ argv: ARGV });
    app.fake.messageAnswer = 1;
    ask(app, "file", { bookmarks: ["B"], filePaths: ["/p/other"] });
    await Bun.sleep(0);
    expect(app.fake.messageBoxes).toHaveLength(1);
    expect(app.backends).toHaveLength(1);
    expect(app.backends[0]?.killed()).toBe(0);
    expect(app.written).toEqual([]);
  });

  test("with a project open, Restart closes its windows and opens it again beside the new one", async () => {
    const app = await sandboxed({ argv: ARGV });
    app.backends[0]?.emit({ type: "ready" });
    app.backends[0]?.emit(openWindow);
    app.fake.messageAnswer = 0;
    ask(app, "file", { bookmarks: ["B"], filePaths: ["/p/other"] });
    await Bun.sleep(0);
    expect(app.fake.windows[0]?.calls).toContain("destroy");
    expect(app.fake.quit).not.toHaveBeenCalled();
    app.backends[1]?.emit({ type: "ready" });
    expect(app.backends[1]?.sent).toEqual([
      { root: "/proj/alpha", type: "open-project" },
      { root: "/p/other", type: "open-project" },
    ]);
  });

  test("the handle answers with the live backend, which a restart replaces", async () => {
    const app = await sandboxed();
    expect(app.handle.backend).toBe(app.backends[0]?.process);
    ask(app, "file", { bookmarks: ["B"], filePaths: ["/p/site"] });
    await Bun.sleep(0);
    expect(app.handle.backend).toBe(app.backends[1]?.process);
  });

  test("the backend it replaced ending is not the app ending; the new one ending is", async () => {
    const app = await sandboxed();
    ask(app, "file", { bookmarks: ["B"], filePaths: ["/p/site"] });
    await Bun.sleep(0);
    expect(app.backends).toHaveLength(2);
    app.backends[0]?.exit();
    expect(app.fake.quit.mock.calls).toEqual([]);
    app.backends[1]?.exit();
    expect(app.fake.quit.mock.calls).toHaveLength(1);
  });

  test("the File menu's Open Project goes through the same grants", async () => {
    const app = await sandboxed();
    app.backends[0]?.emit({ type: "ready" });
    app.fake.openAnswer = {
      bookmarks: ["B"],
      canceled: false,
      filePaths: ["/p/site"],
    };
    const file = app.fake.menuTemplates.at(0)?.find((item) => item.label === "File");
    file?.submenu?.at(1)?.click?.();
    await Bun.sleep(0);
    expect(app.fake.openDialogs[0]?.options.securityScopedBookmarks).toBe(true);
    expect(app.written.at(-1)).toEqual([{ bookmark: "B", path: "/p/site" }]);
    expect(app.backends).toHaveLength(2);
    app.backends[1]?.emit({ type: "ready" });
    expect(app.backends[1]?.sent).toContainEqual({ root: "/p/site", type: "open-project" });
  });

  test("an app that is not a Mac App Store build never asks for bookmarks or restarts", async () => {
    const app = await started({ argv: BARE });
    app.backend.emit({ type: "ready" });
    app.fake.openAnswer = { canceled: false, filePaths: ["/p/site"] };
    app.backend.emit({ kind: "file", requestId: 3, title: "Open", type: "dialog" });
    await Bun.sleep(0);
    expect(app.fake.openDialogs[0]?.options.securityScopedBookmarks).toBeUndefined();
    expect(app.fake.accessed).toEqual([]);
    expect(app.backend.killed()).toBe(0);
  });
});
