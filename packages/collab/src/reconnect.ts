/// <reference lib="dom" />
/**
 * Reconnect timing shared by every long-lived socket Studio holds: the collab socket
 * (`ws-client.ts`) and the cloud session's `/events` stream
 * (`packages/studio/src/platforms/cloud.ts`).
 *
 * **Jitter, because every client loses the socket at the same instant.** A gateway deploy or a
 * relay restart drops every connected Studio together, and a plain doubling backoff brings them all
 * back together too — at 1s, 2s, 4s, … in lockstep, so each retry wave lands on the server as one
 * spike. Equal jitter ({@link backoffDelay}) keeps the doubling but spreads each wave across the
 * upper half of its window, which keeps a floor under the delay (a retry never fires immediately on
 * a server that is still down) while decorrelating the herd.
 *
 * **Wake triggers, because a timer is the wrong clock for a laptop.** A socket that dropped while
 * the machine slept or the network was gone can be sitting in a 30-second wait when the network
 * returns. The browser says so — `online`, a `pageshow` restored from the back/forward cache, a tab
 * becoming visible — and {@link ReconnectScheduler.wake} turns any of them into a retry now. It
 * only ever SHORTENS a pending wait: a socket that is open or mid-handshake is left alone, so a tab
 * switch never tears down a healthy connection.
 *
 * This module imports nothing, deliberately: the cloud adapter reads it eagerly, before the dynamic
 * import that pulls in Yjs, so it must not drag the CRDT into the initial bundle (the same
 * constraint, and the same reason, as `negotiate.ts`).
 */

/** Backoff tuning. Every field is optional; the defaults are what production uses. */
export interface ReconnectPolicy {
  /** The first retry's window, in ms. Doubles per failed attempt. Default 1000. */
  baseMs?: number;
  /** The ceiling on any one window, in ms. Default 30 000. */
  maxMs?: number;
  /** Source of jitter in [0, 1]. Default `Math.random`; tests pin it. */
  random?: () => number;
}

const DEFAULT_BASE_MS = 1000;
const DEFAULT_MAX_MS = 30_000;

/**
 * The delay before retry number `attempt` (0-based), with **equal jitter**: half the capped window
 * is fixed and the other half is random, so the result lies in `[cap / 2, cap]` where `cap =
 * min(maxMs, baseMs × 2^attempt)`.
 *
 * Full jitter (`random × cap`) spreads the herd wider but can retry at ~0ms, which against a server
 * that is still restarting is a wasted handshake per client; equal jitter keeps the floor.
 */
export function backoffDelay(attempt: number, policy: ReconnectPolicy = {}): number {
  const base = policy.baseMs ?? DEFAULT_BASE_MS;
  const max = policy.maxMs ?? DEFAULT_MAX_MS;
  const random = policy.random ?? Math.random;
  // `2 ** attempt` reaches Infinity long before an attempt counter overflows; `min` absorbs it.
  const cap = Math.min(max, base * 2 ** Math.max(0, attempt));
  return cap / 2 + (random() * cap) / 2;
}

/** The DOM surfaces the scheduler listens on (injectable for tests and non-browser runtimes). */
export interface ReconnectWakeSources {
  win?: Pick<Window, "addEventListener" | "removeEventListener">;
  doc?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
}

export interface ReconnectScheduler {
  /**
   * The socket closed: arm one retry after the next backoff delay. A second call while a retry is
   * already pending is a no-op, so a close that arrives twice cannot double the attempt count.
   */
  scheduleRetry: () => void;
  /** The socket opened: the next failure starts the backoff from the first window again. */
  opened: () => void;
  /**
   * Conditions changed (network back, page shown): if a retry is pending, run it NOW. A no-op when
   * nothing is pending — the socket is open or a handshake is already in flight, and either way
   * there is nothing to hurry.
   */
  wake: () => void;
  /** Cancel any pending retry and remove every wake listener. Idempotent. */
  dispose: () => void;
}

/**
 * Drive `connect` through jittered backoff and the browser's wake signals.
 *
 * The caller owns the socket; this owns only WHEN `connect` runs again. The caller reports the two
 * edges it sees — {@link ReconnectScheduler.opened} on `open`,
 * {@link ReconnectScheduler.scheduleRetry} on `close` — and calls {@link ReconnectScheduler.dispose}
 * when it is done with the socket for good.
 */
export function createReconnectScheduler(
  connect: () => void,
  opts: ReconnectPolicy & ReconnectWakeSources = {},
): ReconnectScheduler {
  const win =
    opts.win ??
    (typeof window === "undefined"
      ? undefined
      : (window as Pick<Window, "addEventListener" | "removeEventListener">));
  const doc = opts.doc ?? (typeof document === "undefined" ? undefined : document);
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const fire = () => {
    timer = null;
    if (!disposed) {
      connect();
    }
  };

  const wake = () => {
    if (disposed || timer === null) {
      return;
    }
    clearTimeout(timer);
    /* The backoff that accumulated was measured against the conditions that just ended — an
       offline laptop fails every attempt for as long as it is offline. Carrying it forward would
       make the first failure after the network returns wait a full 30 seconds. */
    attempt = 0;
    fire();
  };

  const onPageShow = (event: Event) => {
    // A fresh load is not a wake: only a page restored from the back/forward cache was frozen.
    if ((event as PageTransitionEvent).persisted) {
      wake();
    }
  };
  const onVisibility = () => {
    if (doc?.visibilityState === "visible") {
      wake();
    }
  };

  win?.addEventListener("online", wake);
  win?.addEventListener("pageshow", onPageShow);
  doc?.addEventListener("visibilitychange", onVisibility);

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      win?.removeEventListener("online", wake);
      win?.removeEventListener("pageshow", onPageShow);
      doc?.removeEventListener("visibilitychange", onVisibility);
    },
    opened() {
      attempt = 0;
    },
    scheduleRetry() {
      if (disposed || timer !== null) {
        return;
      }
      const delay = backoffDelay(attempt, opts);
      attempt += 1;
      timer = setTimeout(fire, delay);
    },
    wake,
  };
}
