import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_SCHEDULE, startUpdates, updatesEnabled } from "../src/electron-shell/updater";
import { fakeSchedule, fakeUpdater } from "./_fake-updater";

describe("updatesEnabled", () => {
  const packaged = {
    appImage: undefined,
    macAppStore: false,
    packaged: true,
    platform: "darwin",
    windowsStore: false,
  } as const;

  test("a packaged build updates itself", () => {
    expect(updatesEnabled(packaged)).toBe(true);
    expect(updatesEnabled({ ...packaged, platform: "win32" })).toBe(true);
  });

  test("a checkout has no feed to update from", () => {
    expect(updatesEnabled({ ...packaged, packaged: false })).toBe(false);
  });

  test("the Store updates a Store install", () => {
    expect(updatesEnabled({ ...packaged, platform: "win32", windowsStore: true })).toBe(false);
  });

  test("the App Store updates a Mac App Store install", () => {
    expect(updatesEnabled({ ...packaged, macAppStore: true })).toBe(false);
  });

  test("on Linux only the AppImage updates itself; a deb is the package manager's", () => {
    expect(updatesEnabled({ ...packaged, platform: "linux" })).toBe(false);
    expect(
      updatesEnabled({ ...packaged, appImage: "/home/u/JxStudio.AppImage", platform: "linux" }),
    ).toBe(true);
  });
});

describe("startUpdates", () => {
  test("downloads what it finds and installs on quit even when the user says later", () => {
    const { updater } = fakeUpdater();
    startUpdates(
      updater,
      { confirmRestart: () => Promise.resolve(false), status: () => {} },
      fakeSchedule().schedule,
    );
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  test("checks once soon after start, then on an interval", () => {
    const { updater, state } = fakeUpdater();
    const { calls, schedule } = fakeSchedule();
    startUpdates(
      updater,
      { confirmRestart: () => Promise.resolve(false), status: () => {} },
      schedule,
    );
    expect(calls.map(({ kind, ms }) => [kind, ms])).toEqual([
      ["timeout", 22],
      ["interval", 111],
    ]);
    calls[0]?.run();
    calls[1]?.run();
    expect(state.checks).toBe(2);
  });

  test("the default cadence is a first look at five seconds, then every four hours", () => {
    expect(DEFAULT_SCHEDULE).toEqual({ every: 14_400_000, first: 5000 });
  });

  test("reports what it finds in words", () => {
    const { emit, updater } = fakeUpdater();
    const status = mock((_text: string) => {});
    startUpdates(
      updater,
      { confirmRestart: () => Promise.resolve(false), status },
      fakeSchedule().schedule,
    );
    emit("checking-for-update");
    emit("update-not-available", { version: "1.0.0" });
    emit("update-available", { version: "1.1.0" });
    emit("error", new Error("offline"));
    expect(status.mock.calls.map(([text]) => text)).toEqual([
      "Checking for updates",
      "Up to date",
      "Update available (1.1.0)",
      "Update check failed: offline",
    ]);
  });

  test("a downloaded update asks once per version, and restarts only when told to", async () => {
    const { emit, state, updater } = fakeUpdater();
    const answers = [true, false];
    const asked: string[] = [];
    const status = mock((_text: string) => {});
    startUpdates(
      updater,
      {
        confirmRestart: (version) => {
          asked.push(version);
          return Promise.resolve(answers.shift() ?? false);
        },
        status,
      },
      fakeSchedule().schedule,
    );
    emit("update-downloaded", { version: "1.1.0" });
    await Bun.sleep(0);
    expect(status).toHaveBeenLastCalledWith("Update ready (1.1.0)");
    expect(state.quits).toBe(1);
    // The four-hourly check finds the same downloaded update again: no second prompt.
    emit("update-downloaded", { version: "1.1.0" });
    await Bun.sleep(0);
    expect(asked).toEqual(["1.1.0"]);
    // A newer one is a new question, and "later" leaves the app running.
    emit("update-downloaded", { version: "1.2.0" });
    await Bun.sleep(0);
    expect(asked).toEqual(["1.1.0", "1.2.0"]);
    expect(state.quits).toBe(1);
  });

  test("a check that rejects is handled, because its error also arrives as an event", async () => {
    const { state, updater } = fakeUpdater();
    state.checkRejects = true;
    const { calls, schedule } = fakeSchedule();
    startUpdates(
      updater,
      { confirmRestart: () => Promise.resolve(false), status: () => {} },
      schedule,
    );
    calls[0]?.run();
    await Bun.sleep(0);
    expect(state.checks).toBe(1);
  });
});
