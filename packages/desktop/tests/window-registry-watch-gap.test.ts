/**
 * Window-registry-watch-gap.test.ts — the "no watch capability" fallback in `watchFocusRequests`.
 *
 * `window-registry.test.ts` already covers the EARLIER guard (the registry directory itself cannot
 * be created), by pointing `JX_STUDIO_WINDOWS_DIR` at a path under a plain file. That guard returns
 * before `fs.watch` is ever called, so it cannot reach `watch`'s own try/catch — the fallback for a
 * directory `mkdirSync` reports as ready but `watch` still refuses (some network filesystems have
 * no watch capability at all).
 *
 * A real "no watch capability" filesystem isn't something a test can depend on being available, so
 * this reaches the same catch the cheaper way: `mkdirSync` is mocked to a no-op for exactly this
 * file's registry directory, so it is never actually created on disk. `watch()` right after then
 * throws ENOENT — the same shape of failure the comment in the source describes, produced
 * deterministically rather than by depending on a specific filesystem's capabilities.
 */

import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as realFs from "node:fs";

const ROOT = join(tmpdir(), `jx-window-registry-watch-gap-${process.pid}`);
const REGISTRY = join(ROOT, "windows");
process.env.JX_STUDIO_WINDOWS_DIR = REGISTRY;

void mock.module("node:fs", () => ({
  ...realFs,
  mkdirSync: (path: string, opts?: unknown) => {
    if (path === REGISTRY) {
      // Pretend the directory is ready without actually creating it, so the `watch()` call right
      // After sees one that truly is not there.
      return;
    }
    return realFs.mkdirSync(path, opts as never);
  },
}));

const { watchFocusRequests } = await import("../src/chromium/window-registry");

describe("watchFocusRequests — no watch capability", () => {
  test("degrades to a no-op when the directory cannot actually be watched", () => {
    const stop = watchFocusRequests(process.pid, () => {});
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
  });
});
