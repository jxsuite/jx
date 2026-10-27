/**
 * Build info the backend can report to the About screen on its own.
 *
 * The packaged Electron application composes a richer answer: its updater has a feed and can say
 * "Update ready (1.4.2)" (`hub/window-hub.ts` merges that in). On its own the backend has no feed,
 * so it reports **no** `updateStatus` at all rather than an "Up to date" it has no way to have
 * checked. An absent field is how the About screen knows not to draw the row.
 */

import type { AppInfo } from "@jxsuite/protocol";
import pkg from "../../package.json" with { type: "json" };

/**
 * Which build this is, from what the process was started with.
 *
 * Inside a snap, snapd sets `$SNAP` in every confined process and the Snap Store is what replaces
 * the build, so it reports `snap` whatever else is set. Otherwise a packaged application declares
 * its channel (the Electron shell sets `JX_STUDIO_CHANNEL` for its backend), and failing that the
 * Nix wrapper's `JX_STUDIO_ASSETS` store path (specs/desktop.md §9.3) means `system`. A checkout
 * (`bun run desktop`) sets neither, and is `development`.
 */
export function releaseChannel(): string {
  if (process.env.SNAP) {
    return "snap";
  }
  // A packaged application says what it is; the Electron shell sets this for its backend.
  if (process.env.JX_STUDIO_CHANNEL) {
    return process.env.JX_STUDIO_CHANNEL;
  }
  return process.env.JX_STUDIO_ASSETS ? "system" : "development";
}

/** Version, channel and commit for the About screen. */
export function appInfo(): AppInfo {
  return {
    channel: releaseChannel(),
    /* The commit is stamped into the studio bundle at build time, not into this process, so the
       About screen already has a better answer than anything reachable from here — a `git` call in
       a Nix store path would name the store, not the release. */
    hash: process.env.JX_STUDIO_COMMIT || "unknown",
    version: pkg.version,
  };
}
