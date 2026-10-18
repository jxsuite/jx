// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import {
  chromiumShellCommand,
  composeShellCommand,
  MAC_BROWSER_BUNDLES,
  electronAppCommand,
  electronShellCommand,
  findChromium,
  findElectron,
  shellEnv,
  shellIcon,
  shellUrl,
} from "../src/chromium/shell-command";
import type { ShellTarget } from "../src/chromium/shell-command";

const target: ShellTarget = {
  platformArgs: ["--ozone-platform=wayland"],
  serverUrl: "http://127.0.0.1:4321",
  token: "TOK",
  userDataDir: "/profiles/one",
};
const SHELL_URL = `${target.serverUrl}/__studio__/index.html?token=${target.token}`;

describe("findElectron", () => {
  test("is opt-in: without ELECTRON_BIN there is no Electron shell, even on PATH", () => {
    const which = mock((_bin: string) => "/usr/bin/electron");
    expect(findElectron({}, which)).toBeNull();
    expect(which).not.toHaveBeenCalled();
  });

  test("resolves ELECTRON_BIN through PATH", () => {
    expect(findElectron({ ELECTRON_BIN: "electron" }, () => "/nix/bin/electron")).toBe(
      "/nix/bin/electron",
    );
  });

  test("an ELECTRON_BIN that resolves to nothing is no Electron", () => {
    expect(findElectron({ ELECTRON_BIN: "missing" }, () => null)).toBeNull();
  });

  test("defaults to Bun.which", () => {
    expect(findElectron({ ELECTRON_BIN: "sh" })).toBe(Bun.which("sh"));
  });
});

describe("chromiumShellCommand", () => {
  test("is the --app window §9.2 specifies, with the platform flags last", () => {
    const command = chromiumShellCommand("/bin/chromium", target);
    expect(command).toEqual({
      args: [
        `--app=${SHELL_URL}`,
        "--class=jx-studio",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1400,900",
        "--user-data-dir=/profiles/one",
        "--ozone-platform=wayland",
      ],
      bin: "/bin/chromium",
      shell: "chromium",
    });
    expect(shellUrl(target)).toBe(SHELL_URL);
  });
});

describe("electronShellCommand", () => {
  const files = { icon: "/share/icon.png", main: "/b/main.js", preload: "/b/preload.js" };

  test("puts Chromium switches before the entry and the shell's own after it", () => {
    expect(electronShellCommand("/bin/electron", target, files, "linux")).toEqual({
      args: [
        "--ozone-platform=wayland",
        "--class=jx-studio",
        "/b/main.js",
        `--jx-url=${SHELL_URL}`,
        "--jx-preload=/b/preload.js",
        "--jx-user-data-dir=/profiles/one",
        "--jx-icon=/share/icon.png",
      ],
      bin: "/bin/electron",
      shell: "electron",
    });
  });

  test("passes --class only on Linux, where it is X11's WM_CLASS", () => {
    // On macOS, Electron hands a leading unknown switch to Node, which exits on "bad option".
    const { args } = electronShellCommand("/bin/electron", target, files, "darwin");
    expect(args).not.toContain("--class=jx-studio");
    expect(args).toContain("/b/main.js");
  });

  test("leaves the icon switch out when there is no icon", () => {
    const { args } = electronShellCommand("/bin/electron", target, { ...files, icon: null });
    expect(args.some((arg) => arg.startsWith("--jx-icon="))).toBe(false);
  });
});

describe("electronAppCommand", () => {
  const files = {
    backend: "/src/hub/main.ts",
    bun: "/bin/bun",
    icon: "/share/icon.png",
    main: "/b/app-main.js",
    preload: "/b/preload.js",
  };

  test("starts the app on its bundle, and names the backend, Bun and the preload", () => {
    expect(electronAppCommand("/bin/electron", files, "/proj", "darwin")).toEqual({
      args: [
        "/b/app-main.js",
        "--jx-bun=/bin/bun",
        "--jx-backend=/src/hub/main.ts",
        "--jx-preload=/b/preload.js",
        "--jx-icon=/share/icon.png",
        "--jx-project=/proj",
      ],
      bin: "/bin/electron",
      shell: "electron",
    });
  });

  test("on Linux it also sets X11's WM_CLASS, before the script", () => {
    const { args } = electronAppCommand("/bin/electron", files, null, "linux");
    expect(args.slice(0, 2)).toEqual(["--class=jx-studio", "/b/app-main.js"]);
  });

  test("names the project by switch, because an unpackaged argv has no position that is the user's", () => {
    const { args } = electronAppCommand("/bin/electron", files, "/proj");
    expect(args.filter((arg) => !arg.startsWith("-"))).toEqual(["/b/app-main.js"]);
  });

  test("leaves the icon and the project out when there are none", () => {
    const { args } = electronAppCommand("/bin/electron", { ...files, icon: null }, null);
    expect(
      args.some((arg) => arg.startsWith("--jx-icon=") || arg.startsWith("--jx-project=")),
    ).toBe(false);
  });
});

describe("composeShellCommand", () => {
  const bundle = mock(() => Promise.resolve({ main: "/b/main.js", preload: "/b/preload.js" }));
  const seedChromium = mock((_dir: string) => {});

  test("Electron wins when configured: bundles it, and leaves the Chromium profile alone", async () => {
    const command = await composeShellCommand(
      { chromium: "/bin/chromium", electron: "/bin/electron" },
      target,
      { bundle, icon: null, seedChromium },
    );
    expect(command.shell).toBe("electron");
    expect(command.args).toContain("/b/main.js");
    expect(bundle).toHaveBeenCalledTimes(1);
    expect(seedChromium).not.toHaveBeenCalled();
  });

  test("otherwise seeds the Chromium profile and opens --app", async () => {
    const command = await composeShellCommand(
      { chromium: "/bin/chromium", electron: null },
      target,
      { bundle, icon: null, seedChromium },
    );
    expect(command.shell).toBe("chromium");
    expect(seedChromium).toHaveBeenCalledWith("/profiles/one");
  });

  test("refuses when there is no shell at all", async () => {
    await expect(
      composeShellCommand({ chromium: null, electron: null }, target, {
        bundle,
        icon: null,
        seedChromium,
      }),
    ).rejects.toThrow("No window shell");
  });
});

describe("shellIcon", () => {
  test("finds the package's own icon", () => {
    expect(shellIcon()).toBe(join(import.meta.dir, "..", "icon.png"));
  });

  test("is null when the installed tree has none", () => {
    expect(shellIcon(join(import.meta.dir, "no-such-icon.png"))).toBeNull();
  });
});

describe("findChromium", () => {
  const none = (): string | null => null;

  test("CHROMIUM_BIN wins, then the PATH names in order", () => {
    const seen: string[] = [];
    const which = (bin: string): string | null => {
      seen.push(bin);
      return bin === "google-chrome" ? "/usr/bin/google-chrome" : null;
    };
    expect(findChromium({ CHROMIUM_BIN: "/opt/c" }, "linux", which)).toBe("/usr/bin/google-chrome");
    expect(seen).toEqual(["/opt/c", "chromium", "chromium-browser", "google-chrome"]);
  });

  test("an empty CHROMIUM_BIN is skipped, not looked up", () => {
    const seen: string[] = [];
    findChromium({ CHROMIUM_BIN: "" }, "linux", (bin) => {
      seen.push(bin);
      return null;
    });
    expect(seen).not.toContain("");
  });

  test("on Linux, nothing on PATH is no browser, whatever is in /Applications", () => {
    expect(findChromium({}, "linux", none, () => true)).toBeNull();
  });

  test("on macOS, falls back to the standard app bundles, Chrome first", () => {
    expect(findChromium({}, "darwin", none, () => true)).toBe(MAC_BROWSER_BUNDLES[0]);
    expect(findChromium({}, "darwin", none, (p) => p === MAC_BROWSER_BUNDLES[1])).toBe(
      MAC_BROWSER_BUNDLES[1],
    );
    expect(findChromium({}, "darwin", none, () => false)).toBeNull();
  });

  test("defaults to the host's platform, Bun.which and the filesystem", () => {
    expect(findChromium({ CHROMIUM_BIN: "sh" })).toBe(Bun.which("sh"));
  });
});

describe("shellEnv", () => {
  test("drops ELECTRON_RUN_AS_NODE and keeps everything else", () => {
    const env = { ELECTRON_RUN_AS_NODE: "1", HOME: "/home/u", PATH: "/bin" };
    expect(shellEnv(env)).toEqual({ HOME: "/home/u", PATH: "/bin" });
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
  });
});
