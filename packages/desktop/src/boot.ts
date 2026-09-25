/// <reference lib="dom" />
/**
 * Boot.ts — the first thing a launcher's init bundle evaluates.
 *
 * @docs extending/embedding/platform-adapter
 *
 * Desktop 5.0.0 through 5.1.3 shipped an Electrobun init bundle that threw on IMPORT: a module Bun
 * had inlined into `views/studio/dist/init.js` threw while it evaluated, so the shim's own body —
 * `registerPlatform(createDesktopPlatform())` — never ran. Nothing recorded why. Studio is a
 * separate module script, so it booted anyway, found no adapter, and quietly registered the
 * dev-server one against a `views://` origin with nothing behind it. Every window was a Studio that
 * could not open a file, and the only trace was one console line nobody was looking at.
 *
 * So a launcher now ANNOUNCES itself before anything else in its bundle can throw, and records the
 * failure when something does. `globalThis.__jxLauncher` present with no adapter registered means
 * "a launcher owns this window and it failed", which Studio turns into a boot-failure screen instead
 * of a fallback (spec/desktop.md §3.3).
 *
 * **The first-import rule.** ESM evaluates a module's dependencies before the module, in import
 * order, and Bun's bundler preserves that order when it inlines them. This file's only runtime
 * import is `@jxsuite/studio/platform`, which has none of its own. So when `./boot` is the FIRST
 * import of a shim, this module body — and the announcement and error watch below — runs before any
 * other inlined module evaluates, which is the only position from which a throw in one of them can
 * be seen. Adding a runtime import here moves that import's whole graph in front of the watch; that
 * is why `hydrateGithubToken` arrives as a parameter instead of an import.
 */

import { announceLauncher, registerPlatform } from "@jxsuite/studio/platform";
import type { LauncherBootError, LauncherSignal } from "@jxsuite/studio/platform";
import type { StudioPlatform } from "@jxsuite/studio/types";

/** The part of `window` the error watch uses, so a test can hand it any `EventTarget`. */
type ErrorEventSource = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** An `Error`'s message and stack; anything else thrown, stringified. */
function toBootError(value: unknown): LauncherBootError {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack };
  }
  return { message: String(value) };
}

/**
 * Describe a page `error` event. A module that throws while evaluating reaches the page as exactly
 * this event, carrying the thrown value on `.error` — but a cross-origin script, or an event some
 * other code dispatched, may carry only `.message`, and neither is guaranteed.
 */
function describeErrorEvent(event: Event): LauncherBootError {
  const { error, message } = event as { error?: unknown; message?: unknown };
  if (error instanceof Error) {
    return toBootError(error);
  }
  if (typeof message === "string" && message !== "") {
    return { message };
  }
  return toBootError(error);
}

/**
 * Record the first `error` event `target` raises into `signal.error`, then stop listening.
 *
 * Only the FIRST error: a module that throws at import time takes everything after it down with it,
 * and the cascade it causes is noise next to the cause. `??=` keeps an error some earlier announcer
 * already recorded. Returns the function that stops the watch early; a target without
 * `addEventListener` (a test runner, a worker without one) gets a no-op.
 */
export function watchBootErrors(
  target: ErrorEventSource | undefined,
  signal: LauncherSignal,
): () => void {
  if (typeof target?.addEventListener !== "function") {
    return () => {};
  }
  const stop = () => {
    target.removeEventListener("error", onError);
  };
  function onError(event: Event) {
    signal.error ??= describeErrorEvent(event);
    stop();
  }
  target.addEventListener("error", onError);
  return stop;
}

/* Module evaluation IS the announcement. See the header: this runs before any other module the
   shim imports, so whatever throws next is recorded against a signal that already exists. */
const stopWatching = watchBootErrors(globalThis, announceLauncher());

/**
 * Stop recording page errors. Called once the shim's imports all evaluated: from then on an error
 * is Studio's own business, not evidence that the launcher failed to boot.
 */
export function settle(): void {
  stopWatching();
}

/** What `bootLauncher` needs from an adapter beyond the PAL: both launchers' `githubAuth.status()`. */
export interface BootablePlatform extends StudioPlatform {
  githubAuth: { status: () => PromiseLike<{ stored: boolean }> };
}

export interface BootLauncherOptions<P extends BootablePlatform> {
  /** Which launcher this is (`"electrobun"`, `"chromium"`); Studio names it on the failure screen. */
  launcher: string;
  /** The launcher's adapter factory. It may throw, and the throw is recorded rather than lost. */
  create: () => P;
  /** Studio's GitHub-token hydrator — a parameter, so importing it cannot precede the watch. */
  hydrateGithubToken: (stored: boolean) => void;
}

/**
 * Construct and register a launcher's adapter, recording a failure on `globalThis.__jxLauncher`.
 *
 * Registration happens synchronously, before the first `await`, so Studio's module script — which
 * may run as soon as this shim yields — always finds either an adapter or a recorded failure. Never
 * rejects: returns the adapter, or `null` when the factory threw.
 */
export async function bootLauncher<P extends BootablePlatform>({
  create,
  hydrateGithubToken,
  launcher,
}: BootLauncherOptions<P>): Promise<P | null> {
  settle();
  // Idempotent: the signal this module announced at import, unless something replaced it since.
  const signal = announceLauncher();
  signal.launcher = launcher;

  let platform: P;
  try {
    platform = create();
    registerPlatform(platform);
  } catch (error) {
    signal.error = toBootError(error);
    console.error(`[${launcher}] could not start its platform adapter:`, error);
    return null;
  }

  /* Ask the 0600 credential store whether a GitHub token exists, so the accounts pane can say so on
     the first frame. The answer is a boolean: the token itself stays out of the webview until a
     sign-in asks for it. */
  try {
    const { stored } = await platform.githubAuth.status();
    hydrateGithubToken(stored);
  } catch {
    // An unreachable store just means the accounts pane says "not signed in" until a sign-in runs.
  }
  return platform;
}

/**
 * Strip ?token from the address bar after boot so it never leaks (e.g. via a Referer header or a
 * copy-pasted URL). The chromium platform already captured it at construction; the loopback bind +
 * only-our-HTML-at-origin invariant is the real boundary. Best-effort: guarded for non-browser
 * (test) environments.
 */
export function stripLaunchToken(): void {
  try {
    const url = new URL(location.href);
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  } catch {
    // No `location`/`history` to clean, or a history API that refused: the boundary still holds.
  }
}
