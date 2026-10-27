import { describe, expect, mock, test } from "bun:test";

const library = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  checks: 0,
  listeners: new Array<string>(),
  quits: 0,
};

void mock.module("electron-updater", () => ({
  autoUpdater: {
    get autoDownload() {
      return library.autoDownload;
    },
    set autoDownload(value: boolean) {
      library.autoDownload = value;
    },
    get autoInstallOnAppQuit() {
      return library.autoInstallOnAppQuit;
    },
    set autoInstallOnAppQuit(value: boolean) {
      library.autoInstallOnAppQuit = value;
    },
    checkForUpdates: () => {
      library.checks += 1;
      return Promise.resolve({ updateInfo: { version: "1.0.0" } });
    },
    on: (event: string) => {
      library.listeners.push(event);
    },
    quitAndInstall: () => {
      library.quits += 1;
    },
  },
}));

const { loadAutoUpdater } = await import("../src/main/app");

describe("loadAutoUpdater", () => {
  test("hands the app electron-updater's autoUpdater behind the slice the app declares", async () => {
    const updater = await loadAutoUpdater();

    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    expect([library.autoDownload, library.autoInstallOnAppQuit]).toEqual([true, true]);
    expect([updater.autoDownload, updater.autoInstallOnAppQuit]).toEqual([true, true]);

    expect(await updater.checkForUpdates()).toBeUndefined();
    updater.on("update-downloaded", () => {});
    updater.quitAndInstall();
    expect([library.checks, library.listeners, library.quits]).toEqual([
      1,
      ["update-downloaded"],
      1,
    ]);
  });
});
