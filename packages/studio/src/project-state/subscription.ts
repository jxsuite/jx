/**
 * Subscription.ts — keep the content store current from the host's project state subscription
 * (`project-state.md` §3, §11.1).
 *
 * A platform whose host serves the subscription exposes `subscribeProjectState` (`StudioPlatform`,
 * `studio.md` §3.4). This module sends the cursor's request on every connect, the first one
 * included (§3.1), applies the answer and every later frame to the store in revision order, and
 * subscribes again with the same cursor whenever a frame does not continue it (a gap, §3.2) or the
 * host ends the subscription. A host that answers with events replays exactly what was missed; one
 * that answers with a snapshot replaces the store's state. A reconnect is therefore a subscribe
 * with `{ epoch, sinceRev }` and nothing else: no listing is re-read, and no resync reason exists
 * any more (`project-state.md` §3.3).
 *
 * **A host that does not serve it.** A first subscribe that fails (a dev server that predates the
 * stream answers 404, a cloud session whose capability route answers 404, a 5xx while a session
 * hydrates) leaves the subscription {@link ProjectStateSubscription.unavailable}: Studio then has
 * no live account of other writers' changes (`studio.md` §9.2) and writes unconditionally. It is
 * asked again with the same growing delay a dropped one is, since only an answer says what the host
 * serves, and the first answer makes it available from then on. A resubscribe that fails after the
 * host has answered once is a restart or a dropped connection; until it answers, the subscription
 * is not live.
 *
 * @license MIT
 * @docs extending/embedding/platform-adapter
 */

import { createSubscriptionCursor } from "@jxsuite/protocol/project-state-frames";
import type { CursorStep, ProjectEventsParams } from "@jxsuite/protocol/project-state-frames";
import type { ProjectEvent } from "@jxsuite/protocol/project-state";
import type { StudioPlatform } from "../types";
import { contentStore } from "./store";
import type { ContentStore, StoreChange } from "./store";

/** One event the subscription applied, and whether it was the echo of Studio's own write. */
export interface AppliedEvent {
  event: ProjectEvent;
  own: boolean;
}

/** How to run one subscription. */
export interface ProjectStateSubscriptionOptions {
  /** The platform's `subscribeProjectState`. */
  subscribe: NonNullable<StudioPlatform["subscribeProjectState"]>;
  /** The store to keep current; the open project's by default. */
  store?: ContentStore;
  /** Names this window across reconnects (§3.1). */
  clientId?: string;
  /** Told every batch of events, in revision order, once the store holds them. */
  onEvents?: (applied: AppliedEvent[]) => void;
  /**
   * Told when a snapshot replaced state the store already held: the paths whose bytes it changed or
   * removed. A first snapshot reports nothing, since there was nothing to change.
   */
  onSnapshot?: (paths: string[]) => void;
  /**
   * Told after every snapshot the store applied, the first included, with what it changed: the
   * caches derived from the store (`derive.ts`) compare the project fields it replaced.
   */
  onSnapshotApplied?: (change: StoreChange) => void;
  /** Told whenever the subscription goes live or stops being live. */
  onLive?: (live: boolean) => void;
  /** The delay before retry `attempt` (from 0) after a failed resubscribe. */
  retryDelay?: (attempt: number) => number;
}

/** A running subscription. */
export interface ProjectStateSubscription {
  /** Whether the host has answered and the store follows it. */
  readonly live: boolean;
  /**
   * Whether the host has refused every subscribe so far, without ever answering one: Studio follows
   * no other writer until it does (the subscribe is retried).
   */
  readonly unavailable: boolean;
  /** Whether the host has answered a subscribe at least once, so it serves the contract. */
  readonly answered: boolean;
  /** Stop applying frames; the adapter's next subscribe replaces its stream. */
  stop: () => void;
  /** Resolves once every frame received so far has been applied. */
  idle: () => Promise<void>;
  /**
   * Resolves once the host's first answer has reached the store, or the host refused the first
   * subscribe, or the subscription stopped: from then on {@link answered} and {@link unavailable} say
   * what the host serves.
   */
  settled: () => Promise<void>;
}

/** Doubling from half a second, capped at thirty. */
const defaultRetryDelay = (attempt: number): number => Math.min(30_000, 500 * 2 ** attempt);

/** Subscribe the store to the host's project state. */
export function startProjectStateSubscription(
  options: ProjectStateSubscriptionOptions,
): ProjectStateSubscription {
  const store = options.store ?? contentStore;
  const retryDelay = options.retryDelay ?? defaultRetryDelay;
  const cursor = createSubscriptionCursor(options.clientId);
  let stopped = false;
  let live = false;
  let unavailable = false;
  let answered = false;
  let held = false;
  /** Bumped by every connect, so frames for a replaced subscription are dropped. */
  let generation = 0;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Frames apply one at a time, in the order they arrived. */
  let queue: Promise<void> = Promise.resolve();
  const { promise: answeredOrNot, resolve: resolveSettled } = Promise.withResolvers<null>();
  const firstSettled: Promise<void> = answeredOrNot.then(() => {});
  const markSettled = () => {
    resolveSettled(null);
  };

  const setLive = (next: boolean) => {
    if (live !== next) {
      live = next;
      options.onLive?.(next);
    }
  };

  const enqueue = (work: () => Promise<void> | void) => {
    queue = queue.then(work).catch((error) => {
      console.error("[project-state] a frame could not be applied:", error);
    });
  };

  /**
   * Apply one answer or frame. The cursor reads it only here, after the generation check: a frame
   * queued for a subscription that has since been replaced (an `ended`, a gap) must not advance the
   * cursor, or the replacement's request would ask from past events the store never applied.
   */
  const apply = async (gen: number, read: () => CursorStep) => {
    if (stopped || gen !== generation) {
      return;
    }
    const step = read();
    if (step.kind === "gap") {
      void connect();
      return;
    }
    // An own write's hash is noted before the write; the event it caused waits for the note.
    await store.settled();
    if (step.kind === "snapshot") {
      const change = store.applySnapshot(step.response.snapshot);
      const first = !held;
      held = true;
      setLive(true);
      if (!first && change.paths.length > 0) {
        options.onSnapshot?.(change.paths);
      }
      options.onSnapshotApplied?.(change);
      markSettled();
      return;
    }
    const applied: AppliedEvent[] = [];
    for (const event of step.events) {
      const own = store.isOwnEvent(event);
      store.applyEvent(event);
      applied.push({ event, own });
    }
    setLive(true);
    if (applied.length > 0) {
      options.onEvents?.(applied);
    }
    markSettled();
  };

  const retry = () => {
    const delay = retryDelay(failures);
    failures += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  };

  // Every caller has checked `stopped`: a stop clears the retry and drops every later frame.
  async function connect(): Promise<void> {
    generation += 1;
    const gen = generation;
    const params = {
      ended: () => {
        if (!stopped && gen === generation) {
          setLive(false);
          void connect();
        }
      },
      events: (frame: ProjectEventsParams) => {
        if (!stopped && gen === generation) {
          enqueue(() => apply(gen, () => cursor.frame(frame)));
        }
      },
    };
    try {
      const response = await options.subscribe(cursor.request(), params);
      if (stopped || gen !== generation) {
        return;
      }
      answered = true;
      unavailable = false;
      failures = 0;
      enqueue(() => apply(gen, () => cursor.answer(response)));
    } catch (error) {
      if (stopped || gen !== generation) {
        return;
      }
      setLive(false);
      if (answered) {
        console.warn("[project-state] resubscribing after a failure:", error);
      } else {
        /* Nothing has said the host serves the subscription: Studio follows no other writer until
           an answer does, and the next attempt asks again. */
        unavailable = true;
        markSettled();
      }
      retry();
    }
  }

  void connect();

  return {
    get live() {
      return live;
    },
    get unavailable() {
      return unavailable;
    },
    get answered() {
      return answered;
    },
    stop() {
      stopped = true;
      generation += 1;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      setLive(false);
      markSettled();
    },
    async idle() {
      let seen: Promise<void> | null = null;
      while (seen !== queue) {
        seen = queue;
        await seen;
      }
    },
    settled() {
      return firstSettled;
    },
  };
}

/** The window's running subscription, `null` when its platform has none. */
let active: ProjectStateSubscription | null = null;

/**
 * Subscribe the open project's store, replacing the subscription before it, when the platform's
 * host serves one; `null` otherwise.
 */
export function startProjectStateSync(
  platform: Pick<StudioPlatform, "subscribeProjectState">,
  options: Omit<ProjectStateSubscriptionOptions, "subscribe" | "store"> = {},
): ProjectStateSubscription | null {
  active?.stop();
  active = null;
  const subscribe = platform.subscribeProjectState;
  if (!subscribe) {
    return null;
  }
  const subscription = startProjectStateSubscription({ ...options, subscribe });
  active = subscription;
  return subscription;
}

/**
 * Stop `subscription`, and forget it when it is the window's; with no argument, stop the window's
 * own (a project being left, whose frames must not reach the next project's store).
 */
export function stopProjectStateSync(subscription: ProjectStateSubscription | null = active): void {
  subscription?.stop();
  if (active === subscription) {
    active = null;
  }
}

/** Whether the window's subscription is live: Studio's own writes are then attributed by hash. */
export function projectStateLive(): boolean {
  return active?.live ?? false;
}

/**
 * Whether Studio should note the hashes of its writes: a subscription is running and its host has
 * not refused it. A note made before the first answer still matches the echo the answer replays.
 */
export function projectStateTracksWrites(): boolean {
  return active !== null && !active.unavailable;
}

/**
 * Resolves once the window's subscription knows whether its host serves the contract (its
 * `settled`), or after `timeoutMs` when the host has not said, or at once when there is no
 * subscription. A write waits on it, so that it neither goes out without a base to a host that
 * takes one nor names a base before the store holds the host's account.
 */
export async function whenProjectStateSettled(timeoutMs: number): Promise<void> {
  const subscription = active;
  if (subscription === null) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([subscription.settled(), timeout]);
  clearTimeout(timer);
}

/**
 * Whether the window's host serves the project state contract: it has answered a subscribe, so
 * Studio's writes and deletes name their base through it (`project-state.md` §5), reconnecting or
 * not. Before the first answer nothing says the host takes a base, so Studio writes as it did.
 */
export function projectStateServed(): boolean {
  return active?.answered ?? false;
}
