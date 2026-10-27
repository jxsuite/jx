/**
 * A fake electron-updater `autoUpdater` and a schedule the test runs by hand, for the updater's own
 * tests and for the app's, which start it.
 */
import type { AutoUpdater, UpdateSchedule, UpdaterEvents } from "../src/main/updater";

/** The fake updater, what it recorded, and a way to fire its events. */
export interface FakeUpdater {
  /** Fire an event as electron-updater would. */
  emit: <Name extends keyof UpdaterEvents>(
    name: Name,
    ...args: Parameters<UpdaterEvents[Name]>
  ) => void;
  state: { checkRejects: boolean; checks: number; quits: number };
  updater: AutoUpdater;
}

/** Build a fresh fake updater. */
export function fakeUpdater(): FakeUpdater {
  const listeners = new Map<string, (...args: never[]) => void>();
  const state = { checkRejects: false, checks: 0, quits: 0 };
  const updater: AutoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: () => {
      state.checks += 1;
      return state.checkRejects ? Promise.reject(new Error("offline")) : Promise.resolve();
    },
    on: (event, listener) => {
      listeners.set(event, listener);
    },
    quitAndInstall: () => {
      state.quits += 1;
    },
  };
  return {
    emit: (name, ...args) => {
      // SAFETY: `listeners` holds each event's listener under its name; `args` is that event's own.
      (listeners.get(name) as ((...a: unknown[]) => void) | undefined)?.(...args);
    },
    state,
    updater,
  };
}

/** One timer the code under test asked for. */
export interface ScheduledCall {
  kind: "interval" | "timeout";
  ms: number;
  run: () => void;
}

/** A schedule whose timers never fire on their own: the test runs `calls[n].run()`. */
export function fakeSchedule() {
  const calls: ScheduledCall[] = [];
  const schedule: UpdateSchedule = {
    every: 111,
    first: 22,
    setInterval: (run, ms) => {
      calls.push({ kind: "interval", ms, run });
    },
    setTimeout: (run, ms) => {
      calls.push({ kind: "timeout", ms, run });
    },
  };
  return { calls, schedule };
}
