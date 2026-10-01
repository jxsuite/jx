/**
 * The reconnect clock shared by the collab socket and the cloud `/events` stream: equal-jitter
 * backoff, and the wake triggers that cut a pending wait short when the browser says conditions
 * changed. The timer is stubbed rather than slept on, so every delay asserted here is exact.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { backoffDelay, createReconnectScheduler } from "../src/reconnect.ts";

describe("backoffDelay", () => {
  test("equal jitter: random 0 is the floor (half the window), random 1 the ceiling", () => {
    expect(backoffDelay(0, { random: () => 0 })).toBe(500);
    expect(backoffDelay(0, { random: () => 1 })).toBe(1000);
    expect(backoffDelay(0, { random: () => 0.5 })).toBe(750);
  });

  test("the window doubles per attempt from baseMs", () => {
    const delays = [0, 1, 2, 3].map((n) => backoffDelay(n, { baseMs: 100, random: () => 1 }));
    expect(delays).toEqual([100, 200, 400, 800]);
  });

  test("the window is capped at maxMs, however many attempts have failed", () => {
    expect(backoffDelay(10, { random: () => 1 })).toBe(30_000);
    expect(backoffDelay(10, { random: () => 0 })).toBe(15_000);
    // 2 ** 2000 is Infinity: the cap still holds rather than producing a NaN or infinite wait.
    expect(backoffDelay(2000, { maxMs: 5000, random: () => 1 })).toBe(5000);
  });

  test("every delay lies within [cap / 2, cap] under the default random source", () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const cap = Math.min(30_000, 1000 * 2 ** attempt);
      const delay = backoffDelay(attempt);
      expect(delay).toBeGreaterThanOrEqual(cap / 2);
      expect(delay).toBeLessThanOrEqual(cap);
    }
  });

  test("a negative attempt is treated as the first", () => {
    expect(backoffDelay(-3, { random: () => 1 })).toBe(1000);
  });
});

// ─── The scheduler ────────────────────────────────────────────────────────────

interface Pending {
  fn: () => void;
  ms: number;
  cleared: boolean;
}

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let timers: Pending[] = [];

beforeEach(() => {
  timers = [];
  globalThis.setTimeout = ((fn: () => void, ms: number) => {
    const entry = { cleared: false, fn, ms };
    timers.push(entry);
    return entry;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((entry: Pending) => {
    entry.cleared = true;
  }) as unknown as typeof clearTimeout;
});

afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

/** Run the most recent live timer, the way the event loop would. */
function runPending(): void {
  const live = timers.filter((t) => !t.cleared);
  const last = live.at(-1);
  if (!last) {
    throw new Error("no pending timer");
  }
  last.cleared = true;
  last.fn();
}

const live = () => timers.filter((t) => !t.cleared);

/** A window/document pair that counts its listeners, so `dispose()` can be held to removing them. */
class FakeTarget extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
  listeners = 0;
  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>) {
    this.listeners += 1;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>) {
    this.listeners -= 1;
    super.removeEventListener(...args);
  }
}

function setup(random = () => 1) {
  const win = new FakeTarget();
  const doc = new FakeTarget();
  let connects = 0;
  const scheduler = createReconnectScheduler(
    () => {
      connects += 1;
    },
    {
      doc: doc as unknown as Document,
      random,
      win: win as unknown as Window,
    },
  );
  return { connects: () => connects, doc, scheduler, win };
}

describe("createReconnectScheduler", () => {
  test("each failed attempt waits one doubled, jittered window", () => {
    const { connects, scheduler } = setup();
    scheduler.scheduleRetry();
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    runPending();
    expect(connects()).toBe(1);
    scheduler.scheduleRetry();
    runPending();
    scheduler.scheduleRetry();
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000, 4000]);
    scheduler.dispose();
  });

  test("the policy's own random source is used", () => {
    const { scheduler } = setup(() => 0);
    scheduler.scheduleRetry();
    expect(timers[0]!.ms).toBe(500);
    scheduler.dispose();
  });

  test("opened() resets the backoff to the first window", () => {
    const { scheduler } = setup();
    scheduler.scheduleRetry();
    runPending();
    scheduler.scheduleRetry();
    runPending();
    scheduler.opened();
    scheduler.scheduleRetry();
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000, 1000]);
    scheduler.dispose();
  });

  test("a second scheduleRetry while one is pending neither re-arms nor advances the backoff", () => {
    const { scheduler } = setup();
    scheduler.scheduleRetry();
    scheduler.scheduleRetry();
    expect(timers).toHaveLength(1);
    runPending();
    scheduler.scheduleRetry();
    // Still the SECOND window: the duplicate call did not count as a failed attempt.
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000]);
    scheduler.dispose();
  });

  test("wake() is a no-op while the socket is open or connecting", () => {
    const { connects, scheduler, win } = setup();
    scheduler.wake();
    win.dispatchEvent(new Event("online"));
    expect(connects()).toBe(0);
    expect(timers).toHaveLength(0);
    scheduler.dispose();
  });

  test("wake() retries a pending attempt now, and restarts the backoff", () => {
    const { connects, scheduler } = setup();
    scheduler.scheduleRetry();
    runPending();
    scheduler.scheduleRetry();
    expect(live().map((t) => t.ms)).toEqual([2000]);
    scheduler.wake();
    expect(connects()).toBe(2);
    expect(live()).toHaveLength(0);
    // The handshake the wake started fails: the first window again, not a third doubling.
    scheduler.scheduleRetry();
    expect(live().map((t) => t.ms)).toEqual([1000]);
    scheduler.dispose();
  });

  test("the network coming back is a wake", () => {
    const { connects, scheduler, win } = setup();
    scheduler.scheduleRetry();
    win.dispatchEvent(new Event("online"));
    expect(connects()).toBe(1);
    scheduler.dispose();
  });

  test("a page restored from the back/forward cache is a wake; a fresh pageshow is not", () => {
    const { connects, scheduler, win } = setup();
    scheduler.scheduleRetry();
    win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
    expect(connects()).toBe(0);
    win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(connects()).toBe(1);
    scheduler.dispose();
  });

  test("the tab becoming visible is a wake; becoming hidden is not", () => {
    const { connects, doc, scheduler } = setup();
    scheduler.scheduleRetry();
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(connects()).toBe(0);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(connects()).toBe(1);
    scheduler.dispose();
  });

  test("dispose() cancels the pending retry and removes every listener", () => {
    const { connects, doc, scheduler, win } = setup();
    expect(win.listeners).toBe(2);
    expect(doc.listeners).toBe(1);
    scheduler.scheduleRetry();
    const [pending] = timers;
    scheduler.dispose();
    scheduler.dispose();
    expect(pending!.cleared).toBe(true);
    expect(win.listeners).toBe(0);
    expect(doc.listeners).toBe(0);
    win.dispatchEvent(new Event("online"));
    scheduler.scheduleRetry();
    scheduler.wake();
    expect(connects()).toBe(0);
    expect(timers).toHaveLength(1);
  });

  test("a timer that fires after dispose() does not connect", () => {
    const { connects, scheduler } = setup();
    scheduler.scheduleRetry();
    const [pending] = timers;
    scheduler.dispose();
    pending!.fn();
    expect(connects()).toBe(0);
  });

  test("defaults to the global window and document when none is injected", () => {
    const globals = globalThis as Record<string, unknown>;
    const realWindow = globals["window"];
    const realDocument = globals["document"];
    const win = new FakeTarget();
    const doc = new FakeTarget();
    globals["window"] = win;
    globals["document"] = doc;
    try {
      let connects = 0;
      const scheduler = createReconnectScheduler(() => {
        connects += 1;
      });
      expect(win.listeners).toBe(2);
      expect(doc.listeners).toBe(1);
      scheduler.scheduleRetry();
      win.dispatchEvent(new Event("online"));
      expect(connects).toBe(1);
      scheduler.dispose();
      expect(win.listeners).toBe(0);
    } finally {
      globals["window"] = realWindow;
      globals["document"] = realDocument;
    }
  });

  test("runs without a DOM at all (server-side and test runtimes)", () => {
    const globals = globalThis as Record<string, unknown>;
    const realWindow = globals["window"];
    const realDocument = globals["document"];
    delete globals["window"];
    delete globals["document"];
    try {
      let connects = 0;
      const scheduler = createReconnectScheduler(
        () => {
          connects += 1;
        },
        { random: () => 1 },
      );
      scheduler.scheduleRetry();
      runPending();
      expect(connects).toBe(1);
      scheduler.dispose();
    } finally {
      if (realWindow !== undefined) {
        globals["window"] = realWindow;
      }
      if (realDocument !== undefined) {
        globals["document"] = realDocument;
      }
    }
  });
});
