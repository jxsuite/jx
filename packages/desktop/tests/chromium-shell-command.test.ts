// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import {
  chromiumShellCommand,
  composeShellCommand,
  electronShellCommand,
  findElectron,
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
    expect(electronShellCommand("/bin/electron", target, files)).toEqual({
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

  test("leaves the icon switch out when there is no icon", () => {
    const { args } = electronShellCommand("/bin/electron", target, { ...files, icon: null });
    expect(args.some((arg) => arg.startsWith("--jx-icon="))).toBe(false);
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
