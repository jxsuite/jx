/**
 * Registering `.jxn` for an AppImage (specs/desktop.md §7.8): what it writes, what it runs, how a
 * moved AppImage is noticed, and how the window reaches it.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  JXN_MIME_XML,
  appImageDesktopEntry,
  fileTypeState,
  nodeFileTypeHost,
  registerFileTypeActions,
  registerFileTypes,
} from "../src/main/file-types";
import type { FileTypeHost } from "../src/main/file-types";
import { FILE_TYPE_CHANNELS, shellBridge } from "../src/shared/bridge";
import { fakeElectron } from "./_fake-electron";

/** An in-memory host: the files written, the programs run, and which tools are on `PATH`. */
function memoryHost(overrides: Partial<FileTypeHost> = {}) {
  const files = new Map<string, string>();
  const runs: string[] = [];
  const host: FileTypeHost = {
    appImage: "/home/ada/Apps/Jx Studio.AppImage",
    copyFile: (from, to) => {
      files.set(to, `copy of ${from}`);
    },
    dataHome: "/home/ada/.local/share",
    icon: "/tmp/.mount_jx/resources/icon.png",
    readText: (path) => files.get(path) ?? null,
    run: (program, args) => {
      runs.push(`${program} ${args.join(" ")}`);
      return Promise.resolve();
    },
    which: (program) => `/usr/bin/${program}`,
    writeText: (path, text) => {
      files.set(path, text);
    },
    ...overrides,
  };
  return { files, host, runs };
}

const ENTRY = "/home/ada/.local/share/applications/jx-studio-appimage.desktop";

describe("registering", () => {
  test("writes the type, the icon and an entry for this AppImage, then tells the desktop", async () => {
    const { files, host, runs } = memoryHost();
    const report = await registerFileTypes(host);
    expect(files.get("/home/ada/.local/share/mime/packages/jx-studio.xml")).toBe(JXN_MIME_XML);
    expect(files.get("/home/ada/.local/share/jx-studio/icon.png")).toBe(
      "copy of /tmp/.mount_jx/resources/icon.png",
    );
    expect(files.get(ENTRY)).toBe(
      appImageDesktopEntry(
        "/home/ada/Apps/Jx Studio.AppImage",
        "/home/ada/.local/share/jx-studio/icon.png",
      ),
    );
    expect(runs).toEqual([
      "/usr/bin/update-mime-database /home/ada/.local/share/mime",
      "/usr/bin/update-desktop-database /home/ada/.local/share/applications",
    ]);
    expect(report.ran).toEqual(["update-mime-database", "update-desktop-database"]);
    expect(report.skipped).toEqual([]);
    expect(report.wrote).toHaveLength(3);
  });

  test("names a tool that is not there rather than failing, and needs no icon", async () => {
    const { files, host, runs } = memoryHost({ icon: null, which: () => null });
    const report = await registerFileTypes(host);
    expect(runs).toEqual([]);
    expect(report.skipped).toEqual(["update-mime-database", "update-desktop-database"]);
    expect(files.get(ENTRY)).toContain("Icon=jx-studio\n");
  });

  test("is refused outside an AppImage, which has nothing of its own to register", async () => {
    const { host } = memoryHost({ appImage: null });
    let refusal = "";
    try {
      await registerFileTypes(host);
    } catch (error_) {
      refusal = String(error_);
    }
    expect(refusal).toContain("Only an AppImage");
  });

  test("the entry opens files with this AppImage, quoted as the desktop entry spec asks", () => {
    const entry = appImageDesktopEntry('/odd/"$name`\\.AppImage', null);
    expect(entry).toContain(String.raw`Exec="/odd/\"\$name\`\\.AppImage" %F`);
    expect(entry).toContain("MimeType=application/json;text/markdown;text/x-jxn;\n");
  });
});

describe("whether it is registered", () => {
  test("not yet, then for this AppImage, then stale once the AppImage moves", async () => {
    const { host } = memoryHost();
    expect(fileTypeState(host)).toBe("unregistered");
    await registerFileTypes(host);
    expect(fileTypeState(host)).toBe("registered");
    host.appImage = "/home/ada/Downloads/Jx Studio.AppImage";
    expect(fileTypeState(host)).toBe("stale");
  });
});

describe("on this machine", () => {
  let home = "";

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  test("writes under XDG_DATA_HOME, and runs what is on PATH", async () => {
    home = mkdtempSync(join(tmpdir(), "jx-file-types-"));
    const icon = join(home, "icon.png");
    writeFileSync(icon, "png");
    const host = nodeFileTypeHost(
      { APPIMAGE: "/apps/Jx.AppImage", PATH: "", XDG_DATA_HOME: join(home, "share") },
      icon,
    );
    host.which = () => null;
    expect(fileTypeState(host)).toBe("unregistered");
    await registerFileTypes(host);
    expect(readFileSync(join(home, "share/mime/packages/jx-studio.xml"), "utf8")).toBe(
      JXN_MIME_XML,
    );
    expect(readFileSync(join(home, "share/jx-studio/icon.png"), "utf8")).toBe("png");
    expect(fileTypeState(host)).toBe("registered");
    // A program that fails rejects, and one that succeeds resolves.
    let failed = false;
    await host.run("false", []).catch(() => {
      failed = true;
    });
    expect(failed).toBe(true);
    await host.run("true", []);
  });

  test("is no AppImage without APPIMAGE, and defaults to ~/.local/share", () => {
    const host = nodeFileTypeHost({}, null);
    expect(host.appImage).toBeNull();
    expect(host.dataHome).toEndWith(join(".local", "share"));
    expect(host.which("sh")).not.toBeNull();
  });

  test("ships the type the Nix package installs", () => {
    const committed = readFileSync(resolve(import.meta.dir, "../jx-studio.mime.xml"), "utf8");
    // The same type, under a header comment the AppImage's copy leaves out.
    expect(committed.replace(/<!--[\s\S]*?-->\n/, "")).toBe(JXN_MIME_XML);
  });
});

describe("the window's way in", () => {
  test("an AppImage's window is offered the command, and reaches the main process with it", async () => {
    const fake = fakeElectron();
    const { files, host } = memoryHost();
    registerFileTypeActions(fake.api, host);
    const bridge = shellBridge(fake.api.ipcRenderer);
    expect(await bridge.fileTypes?.state()).toBe("unregistered");
    await bridge.fileTypes?.register();
    expect(files.has(ENTRY)).toBe(true);
    expect(await bridge.fileTypes?.state()).toBe("registered");
    expect(fake.listeners.has(FILE_TYPE_CHANNELS.available)).toBe(true);
  });

  test("a window whose question fails keeps its controls, without the command", () => {
    const fake = fakeElectron();
    fake.api.ipcRenderer.sendSync = () => {
      throw new Error("no answer");
    };
    const bridge = shellBridge(fake.api.ipcRenderer);
    expect(bridge.fileTypes).toBeUndefined();
    expect(bridge.windowControls).toBeDefined();
  });

  test("any other window is not offered it at all", () => {
    const fake = fakeElectron();
    registerFileTypeActions(fake.api, memoryHost({ appImage: null }).host);
    expect(shellBridge(fake.api.ipcRenderer).fileTypes).toBeUndefined();
  });
});
