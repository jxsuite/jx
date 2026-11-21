/**
 * Refactor-watcher-gaps.test.ts — deterministic branch coverage for createFsWatcher, driven by a
 * mocked chokidar so ignored event types and debounce-timer resets can be exercised without racing
 * a real filesystem watcher.
 */

import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import type { FsEventPayload } from "../src/refactor/fs-events";

type AllListener = (eventType: string, changedPath: string) => void;
/** What chokidar's `error` event can carry here: an Error, or the non-Error a test throws. */
type WatchFailure = Error | string;
type ErrorListener = (error: WatchFailure) => void;

/** The part of chokidar's options these tests read back. */
interface WatchOptions {
  awaitWriteFinish?: { pollInterval: number; stabilityThreshold: number };
}

class FakeWatcher {
  closed = false;
  /** The options `watch()` was called with, so a test can read what was asked of chokidar. */
  options: WatchOptions = {};
  private readyListeners: (() => void)[] = [];
  private listeners: AllListener[] = [];
  private errorListeners: ErrorListener[] = [];

  on(...subscription: ["all", AllListener] | ["error", ErrorListener]): this {
    if (subscription[0] === "error") {
      this.errorListeners.push(subscription[1]);
    } else {
      this.listeners.push(subscription[1]);
    }
    return this;
  }

  /** Chokidar's one-shot `ready`, the only event this wrapper listens to with `once`. */
  once(_event: "ready", listener: () => void): this {
    this.readyListeners.push(listener);
    return this;
  }

  /** Chokidar's `ready`: the initial scan is done. */
  emitReady(): void {
    for (const listener of this.readyListeners.splice(0)) {
      listener();
    }
  }

  emit(eventType: string, changedPath: string): void {
    for (const listener of this.listeners) {
      listener(eventType, changedPath);
    }
  }

  /** Chokidar's `error` event. An EventEmitter with no listener for it THROWS instead of logging. */
  emitError(error: WatchFailure): void {
    if (this.errorListeners.length === 0) {
      throw error;
    }
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

let lastWatcher: FakeWatcher | null = null;
void mock.module("chokidar", () => ({
  watch: (_root: string, options: WatchOptions) => {
    lastWatcher = new FakeWatcher();
    lastWatcher.options = options;
    return lastWatcher;
  },
}));

const { createFsWatcher } = await import("../src/refactor/watcher.ts");

const ROOT = "/fake/project";

const sleep = (ms: number) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

describe("createFsWatcher — event filtering and debounce", () => {
  test("ignores payload-less event types and coalesces rapid changes into one batch", async () => {
    const batches: FsEventPayload[][] = [];
    const handle = createFsWatcher(ROOT, (events) => batches.push(events), { debounce: 20 });
    const watcher = lastWatcher!;
    try {
      // An event type toFsEvent does not map (and the root itself, whose relative path is empty)
      // Produces no payload and schedules nothing.
      watcher.emit("raw", join(ROOT, "a.json"));
      watcher.emit("unlinkDir", ROOT);
      await sleep(60);
      expect(batches).toHaveLength(0);

      // Two rapid valid events: the second clears the first's pending debounce timer, so both
      // Arrive coalesced in a single batch.
      watcher.emit("add", join(ROOT, "a.json"));
      watcher.emit("change", join(ROOT, "a.json"));
      watcher.emit("change", join(ROOT, "b.json"));
      await sleep(60);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toEqual([
        { isDir: false, path: "a.json", type: "add" },
        { isDir: false, path: "b.json", type: "change" },
      ]);
    } finally {
      await handle.close();
    }
  });
});

describe("createFsWatcher — watch errors", () => {
  test("logs a watch error instead of letting it throw", () => {
    const handle = createFsWatcher(ROOT, () => {});
    const watcher = lastWatcher!;
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args.join(" "));
    try {
      // What a unix socket under the watched root produces. Before the listener existed, one of
      // These ended the launcher; a home directory holds a dozen.
      const enxio = Object.assign(new Error("ENXIO: no such device or address, watch 'a.sock'"), {
        code: "ENXIO",
      });
      expect(() => watcher.emitError(enxio)).not.toThrow();
      expect(logged.some((line) => line.includes("ENXIO"))).toBe(true);

      // A thrown non-Error still has to produce a line rather than "undefined".
      logged.length = 0;
      watcher.emitError("plain string failure");
      expect(logged.some((line) => line.includes("plain string failure"))).toBe(true);
    } finally {
      console.error = original;
      void handle.close();
    }
  });
});

describe("createFsWatcher — readiness and errors", () => {
  test("`ready` settles when chokidar finishes its initial scan, not before", async () => {
    const handle = createFsWatcher(ROOT, () => {});
    const watcher = lastWatcher!;
    let settled = false;
    void handle.ready.then(() => {
      settled = true;
    });
    await sleep(5);
    expect(settled).toBe(false);
    watcher.emitReady();
    await handle.ready;
    expect(settled).toBe(true);
    await handle.close();
  });

  test("closing before the scan finished still settles `ready`", async () => {
    const handle = createFsWatcher(ROOT, () => {});
    await handle.close();
    await handle.ready;
    expect(lastWatcher!.closed).toBe(true);
  });

  test("a write is reported once it is whole, as the dev server's watcher does", async () => {
    const defaults = createFsWatcher(ROOT, () => {});
    expect(lastWatcher!.options.awaitWriteFinish).toEqual({
      pollInterval: 10,
      stabilityThreshold: 50,
    });
    await defaults.close();
    const tuned = createFsWatcher(ROOT, () => {}, { stabilityThreshold: 5 });
    expect(lastWatcher!.options.awaitWriteFinish).toEqual({
      pollInterval: 10,
      stabilityThreshold: 5,
    });
    await tuned.close();
  });

  test("an `onError` callback receives watch errors instead of the log", async () => {
    const seen: string[] = [];
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args.join(" "));
    const handle = createFsWatcher(ROOT, () => {}, {
      onError: (error) => seen.push(error.message),
    });
    try {
      lastWatcher!.emitError("EMFILE: too many open files");
      expect(seen).toEqual(["EMFILE: too many open files"]);
      expect(logged).toEqual([]);
    } finally {
      console.error = original;
      await handle.close();
    }
  });
});
