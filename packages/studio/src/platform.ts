/// <reference lib="dom" />
/**
 * Platform.js — Platform Abstraction Layer (PAL)
 *
 * Studio is backend-agnostic. Each deployment target (desktop, dev server, cloud) registers a
 * platform adapter at startup. All file I/O, project loading, and component discovery goes through
 * this interface.
 *
 * Uses window.__jxPlatform so the platform can be registered from a separate script bundle (e.g.
 * init.js) before studio.js loads.
 *
 * See spec/desktop.md §3 for the full StudioPlatform interface.
 *
 * **Every call is counted.** `getPlatform()` hands out a counting proxy, not the raw adapter, so
 * "is Studio waiting on I/O?" is one number rather than thirty hand-instrumented methods
 * (`probe.idle()`'s in-flight I/O condition, §13.5). Wrapping at the READ point rather than at
 * `registerPlatform` is deliberate: desktop pre-registers its adapter on `window.__jxPlatform`
 * without ever calling the registrar, and this is the seam both paths share.
 */

import { isFunction, isNonNullObject, isString } from "@jxsuite/schema/guards";
import type { StudioPlatform } from "./types";

/** What a launcher's boot module recorded when its adapter could not be constructed. */
export interface LauncherBootError {
  message: string;
  stack?: string | undefined;
}

/**
 * A launcher's announcement that it owns this window's adapter (spec/desktop.md §3.3).
 *
 * Published by the launcher boot module's FIRST import, before any other module in its bundle
 * evaluates, so it exists even when a later import throws. Present with no adapter registered, it
 * means the launcher failed, and Studio must say so rather than fall back to the dev server. That
 * fallback is what desktop 5.0.0-5.1.3 did for months: its init bundle threw on import, and every
 * window ran the dev-server adapter against a `views://` origin with nothing behind it.
 */
export interface LauncherSignal {
  /** Which launcher announced (`"electrobun"`, `"chromium"`), once its boot module's body ran. */
  launcher?: string | undefined;
  /** The first error the page raised during boot, or the adapter factory's own throw. */
  error?: LauncherBootError | undefined;
}

declare global {
  /** The registered adapter, set by `registerPlatform` or pre-registered by a launcher bundle. */
  var __jxPlatform: StudioPlatform | undefined;
  /** The launcher's boot signal (spec/desktop.md §3.3), when a launcher announced itself. */
  var __jxLauncher: LauncherSignal | undefined;
}

/** @param {StudioPlatform} platform */
export function registerPlatform(platform: StudioPlatform) {
  globalThis.__jxPlatform = platform;
}

/**
 * Publish the launcher signal on `globalThis.__jxLauncher`, or return the one already published.
 *
 * Idempotent, so an error recorded by the first announcer survives a second call.
 */
export function announceLauncher(): LauncherSignal {
  return (globalThis.__jxLauncher ??= {});
}

/** The launcher signal, when a launcher's boot module announced itself in this window. */
export function launcherSignal(): LauncherSignal | undefined {
  return globalThis.__jxLauncher;
}

// ─── In-flight accounting ─────────────────────────────────────────────────────

/** Method name → how many of its calls have not settled. Entries are deleted at zero. */
const inFlight = new Map<string, number>();

/**
 * One entry per platform call whose promise has not settled, named by its method.
 *
 * Repeats are meaningful: two concurrent `gitStatus` reads are two reasons the shell is not
 * settled, and the rejection message that names them is the whole point of "Determinism" in
 * `scripts/screenshots/README.md` — 115 sleeps were 115 places that could not fail.
 */
export function platformInFlight(): string[] {
  const names: string[] = [];
  for (const [method, count] of inFlight) {
    for (let i = 0; i < count; i++) {
      names.push(method);
    }
  }
  return names;
}

function enter(method: string): void {
  inFlight.set(method, (inFlight.get(method) ?? 0) + 1);
}

function leave(method: string): void {
  const count = (inFlight.get(method) ?? 1) - 1;
  if (count > 0) {
    inFlight.set(method, count);
  } else {
    inFlight.delete(method);
  }
}

/** A promise-like result, recognised the way `await` recognises one: by a callable `then`. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (isNonNullObject(value) || isFunction(value)) && "then" in value && isFunction(value.then);
}

/**
 * One adapter method, wrapped so each call whose result is a promise counts as in flight under
 * `method` until that promise settles. Any other result is returned untouched.
 *
 * The arguments are `never[]` because the wrapper is reached through the proxy, whose callers are
 * typed by the member's own StudioPlatform signature; it relays whatever they pass, unread.
 */
function countCalls<R>(
  method: string,
  member: (...args: never[]) => R,
  adapter: StudioPlatform,
): (...args: never[]) => R {
  return (...args: never[]): R => {
    const result = member.apply(adapter, args);
    if (!isThenable(result)) {
      return result;
    }
    enter(method);
    const settle = () => {
      leave(method);
    };
    // Both arms: a rejected platform call is a call that FINISHED. Leaving it counted would
    // Wedge every later `idle()` behind an error the caller already handled.
    result.then(settle, settle);
    return result;
  };
}

/**
 * Wrap an adapter so every promise-returning member is counted while it is outstanding.
 *
 * Synchronous members are passed through untouched — they cannot be outstanding. Wrappers are
 * memoised per property so `platform.readFile === platform.readFile`, which matters because call
 * sites cache and compare these (`live-context.ts` tests `typeof platform[key] === "function"` to
 * derive `capability.*`, and a fresh closure per read would allocate on every predicate).
 */
function countingPlatform(platform: StudioPlatform): StudioPlatform {
  const wrappers = new Map<
    string,
    { raw: StudioPlatform[keyof StudioPlatform]; wrapper: unknown }
  >();
  return new Proxy(platform, {
    get(target, property) {
      /* `this` stays the raw adapter: a proxy receiver would re-enter this trap for every internal
         property read the method makes, counting nothing and costing everything.
         SAFETY: a get trap is asked for any key, not only the ones StudioPlatform declares (`then`
         when the proxy is awaited, inherited `toString`, symbols). An undeclared key reads as
         undefined or an Object.prototype member, which the checks below relay untouched or wrap
         exactly as they would a declared method, so the keyof claim never reaches a caller. */
      const value = target[property as keyof StudioPlatform];
      if (!isFunction(value) || !isString(property)) {
        return value;
      }
      // Keyed by the FUNCTION, not just the name: an adapter whose method is replaced later (a
      // Lazily-installed capability, a test swapping one out) must not keep answering through a
      // Wrapper closed over the old implementation.
      const cached = wrappers.get(property);
      if (cached && cached.raw === value) {
        return cached.wrapper;
      }
      const wrapper = countCalls<ReturnType<typeof value>>(property, value, target);
      wrappers.set(property, { raw: value, wrapper });
      return wrapper;
    },
  });
}

/** The adapter the counting proxy currently wraps, so re-registration re-wraps and nothing else. */
let counted: { raw: StudioPlatform; wrapped: StudioPlatform } | null = null;

/** @returns {StudioPlatform} */
export function getPlatform() {
  const raw = globalThis.__jxPlatform;
  if (!raw) {
    throw new Error("No platform registered. Call registerPlatform() before starting Studio.");
  }
  if (counted?.raw !== raw) {
    counted = { raw, wrapped: countingPlatform(raw) };
  }
  return counted.wrapped;
}

/** @returns {boolean} */
export function hasPlatform() {
  return globalThis.__jxPlatform != null;
}
