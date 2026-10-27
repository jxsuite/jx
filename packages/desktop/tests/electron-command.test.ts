import { describe, expect, mock, test } from "bun:test";
import * as executables from "@jxsuite/schema/which";
import { join } from "node:path";
import {
  electronAppCommand,
  findElectron,
  iconFileFor,
  shellEnv,
  shellIcon,
} from "../src/electron-shell/command";

describe("findElectron", () => {
  test("is opt-in: without ELECTRON_BIN there is no Electron, even on PATH", () => {
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

  test("defaults to a PATH lookup", () => {
    expect(findElectron({ ELECTRON_BIN: "sh" })).toBe(executables.which("sh"));
  });
});

describe("electronAppCommand", () => {
  const files = {
    backend: "/build/backend/index.js",
    icon: "/share/icon.png",
    main: "/b/app-main.js",
    preload: "/b/preload.js",
  };

  test("starts the app on its bundle, and names the backend and the preload", () => {
    expect(electronAppCommand("/bin/electron", files, "/proj", "darwin")).toEqual({
      args: [
        "/b/app-main.js",
        "--jx-backend=/build/backend/index.js",
        "--jx-preload=/b/preload.js",
        "--jx-icon=/share/icon.png",
        "--jx-project=/proj",
      ],
      bin: "/bin/electron",
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

describe("shellIcon", () => {
  test("finds the package's own icon", () => {
    expect(shellIcon()).toBe(join(import.meta.dir, "..", iconFileFor(process.platform)));
  });

  test("macOS has its own tile; every other platform the flat icon", () => {
    expect(iconFileFor("darwin")).toBe("icon-macos.png");
    expect(iconFileFor("linux")).toBe("icon.png");
    expect(iconFileFor("win32")).toBe("icon.png");
  });

  test("is null when the installed tree has none", () => {
    expect(shellIcon(join(import.meta.dir, "no-such-icon.png"))).toBeNull();
  });
});

describe("shellEnv", () => {
  test("drops ELECTRON_RUN_AS_NODE and keeps everything else", () => {
    const env = { ELECTRON_RUN_AS_NODE: "1", HOME: "/home/u", PATH: "/bin" };
    expect(shellEnv(env)).toEqual({ HOME: "/home/u", PATH: "/bin" });
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
  });
});
