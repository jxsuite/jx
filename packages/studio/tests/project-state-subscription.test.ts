import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  answerSubscribe,
  contentHash,
  createMemoryEventLog,
} from "@jxsuite/protocol/project-state";
import type {
  IndexedFile,
  ProjectEvent,
  ProjectEventInit,
  ProjectEventLog,
  SubscribeRequest,
  SubscribeResponse,
} from "@jxsuite/protocol/project-state";
import type { ProjectStateListener } from "@jxsuite/protocol/project-state-frames";
import { createContentStore, contentStore } from "../src/project-state/store";
import type { ContentStore } from "../src/project-state/store";
import {
  projectStateLive,
  projectStateServed,
  projectStateTracksWrites,
  startProjectStateSubscription,
  startProjectStateSync,
  stopProjectStateSync,
  whenProjectStateSettled,
} from "../src/project-state/subscription";
import type { AppliedEvent } from "../src/project-state/subscription";

/** A host built on the protocol's reference log and answer, serving one listener at a time. */
function fakeHost(epoch = "e1", capacity = 64) {
  let log: ProjectEventLog = createMemoryEventLog({ capacity, epoch });
  const files = new Map<string, IndexedFile>();
  let listener: ProjectStateListener | null = null;
  const requests: SubscribeRequest[] = [];
  const failures: Error[] = [];
  const snapshot = () => ({
    components: [],
    files: [...files.values()],
    formats: "f",
    readiness: "ready" as const,
  });
  const record = (event: ProjectEvent) => {
    if (event.type === "fileAdded") {
      files.set(event.path, {
        docId: event.docId,
        indexed: true,
        isDir: event.isDir,
        kind: "page",
        path: event.path,
        ...(event.hash !== undefined && { hash: event.hash }),
      });
    } else if (event.type === "fileChanged") {
      files.set(event.path, { ...files.get(event.path)!, hash: event.hash });
    } else if (event.type === "fileRemoved") {
      files.delete(event.path);
    }
  };
  return {
    requests,
    failures,
    get listener() {
      return listener;
    },
    subscribe: mock(
      async (request: SubscribeRequest, next: ProjectStateListener): Promise<SubscribeResponse> => {
        requests.push(request);
        const failure = failures.shift();
        if (failure) {
          throw failure;
        }
        listener = next;
        return answerSubscribe(log, request, snapshot);
      },
    ),
    /** Append an event; deliver it unless `silent` (a frame the client never received). */
    emit(init: ProjectEventInit, silent = false): ProjectEvent {
      const event = log.append(init);
      record(event);
      if (!silent) {
        listener?.events({ epoch: log.epoch, events: [event] });
      }
      return event;
    },
    /** Append without logging a delivery, then send a frame of arbitrary events. */
    frame(events: ProjectEvent[], frameEpoch = log.epoch) {
      listener?.events({ epoch: frameEpoch, events });
    },
    end() {
      listener?.ended?.(log.epoch);
    },
    restart(next: string) {
      log = createMemoryEventLog({ capacity, epoch: next });
    },
  };
}

const flush = () =>
  new Promise((resume) => {
    setTimeout(resume, 0);
  });

/** Let every queued connect and frame run. */
async function settle(sub: { idle: () => Promise<void> }) {
  for (let i = 0; i < 5; i += 1) {
    await flush();
    await sub.idle();
  }
}

const added = async (path: string, docId: string, text: string): Promise<ProjectEventInit> => ({
  docId,
  hash: await contentHash(text),
  isDir: false,
  origin: "external",
  path,
  type: "fileAdded",
});

const changed = async (path: string, docId: string, text: string): Promise<ProjectEventInit> => ({
  docId,
  hash: await contentHash(text),
  origin: "external",
  path,
  type: "fileChanged",
});

afterEach(() => {
  stopProjectStateSync();
});

describe("startProjectStateSubscription", () => {
  test("a first connect sends the client id alone, applies the snapshot and goes live", async () => {
    const host = fakeHost();
    host.emit(await added("a.json", "d1", "A"));
    const store = createContentStore();
    const live: boolean[] = [];
    const snapshots: string[][] = [];
    const sub = startProjectStateSubscription({
      clientId: "win",
      onLive: (next) => live.push(next),
      onSnapshot: (paths) => snapshots.push(paths),
      store,
      subscribe: host.subscribe,
    });
    await settle(sub);
    expect(host.requests).toEqual([{ clientId: "win" }]);
    expect(store.docAt("a.json")?.docId).toBe("d1");
    expect(sub.live).toBe(true);
    expect(sub.unavailable).toBe(false);
    expect(sub.answered).toBe(true);
    expect(live).toEqual([true]);
    expect(snapshots).toEqual([]);
    sub.stop();
    expect(live).toEqual([true, false]);
  });

  test("later frames apply in order, each attributed by its bytes", async () => {
    const host = fakeHost();
    const store = createContentStore();
    const applied: AppliedEvent[][] = [];
    const sub = startProjectStateSubscription({
      onEvents: (batch) => applied.push(batch),
      store,
      subscribe: host.subscribe,
    });
    await settle(sub);
    host.emit(await added("a.json", "d1", "A"));
    void store.noteOwnWrite("a.json", "B");
    host.emit(await changed("a.json", "d1", "B"));
    host.emit(await changed("a.json", "d1", "C"));
    await settle(sub);
    expect(applied.map((batch) => batch.map(({ event, own }) => [event.type, own]))).toEqual([
      [["fileAdded", false]],
      [["fileChanged", true]],
      [["fileChanged", false]],
    ]);
    expect(store.hashAt("a.json")).toBe(await contentHash("C"));
    sub.stop();
  });

  test("a gap resubscribes with the cursor, and the replay fills it", async () => {
    const host = fakeHost();
    const store = createContentStore();
    const sub = startProjectStateSubscription({ store, subscribe: host.subscribe });
    await settle(sub);
    host.emit(await added("a.json", "d1", "A"));
    await settle(sub);
    const missed = host.emit(await added("b.json", "d2", "B"), true);
    host.emit(await added("c.json", "d3", "C"));
    await settle(sub);
    expect(host.requests.at(-1)).toEqual({ epoch: "e1", sinceRev: 1 });
    expect(store.docAt("b.json")?.docId).toBe("d2");
    expect(store.docAt("c.json")?.docId).toBe("d3");
    expect(missed.rev).toBe(2);
    // A frame from another epoch is a gap too.
    host.frame([], "elsewhere");
    await settle(sub);
    expect(host.requests.at(-1)).toEqual({ epoch: "e1", sinceRev: 3 });
    sub.stop();
  });

  test("an end resubscribes, and a restarted host's snapshot reports what it changed", async () => {
    const host = fakeHost();
    const store = createContentStore();
    const snapshots: string[][] = [];
    const live: boolean[] = [];
    host.emit(await added("a.json", "d1", "A"), true);
    host.emit(await added("b.json", "d2", "B"), true);
    const sub = startProjectStateSubscription({
      onLive: (next) => live.push(next),
      onSnapshot: (paths) => snapshots.push(paths),
      store,
      subscribe: host.subscribe,
    });
    await settle(sub);
    host.emit(await changed("a.json", "d1", "A2"), true);
    host.restart("e2");
    host.end();
    await settle(sub);
    expect(host.requests.at(-1)).toEqual({ epoch: "e1", sinceRev: 2 });
    expect(snapshots).toEqual([["a.json"]]);
    expect(live).toEqual([true, false, true]);
    // A snapshot that changed nothing reports nothing.
    host.restart("e3");
    host.end();
    await settle(sub);
    expect(snapshots).toHaveLength(1);
    sub.stop();
  });

  test("a host that refuses the first subscribe is unavailable until a later attempt answers", async () => {
    const host = fakeHost();
    host.failures.push(new Error("404"));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delays: number[] = [];
    const sub = startProjectStateSubscription({
      retryDelay: (attempt) => {
        delays.push(attempt);
        return 0;
      },
      store: createContentStore(),
      subscribe: async (request, listener) => {
        if (host.requests.length > 0) {
          await gate;
        }
        return host.subscribe(request, listener);
      },
    });
    await settle(sub);
    expect(sub.unavailable).toBe(true);
    expect(sub.answered).toBe(false);
    expect(sub.live).toBe(false);
    expect(host.requests).toHaveLength(1);
    // It is asked again, as a dropped one is: only an answer says what the host serves.
    expect(delays).toEqual([0]);
    release();
    for (let i = 0; i < 10 && !sub.live; i += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    expect(sub.unavailable).toBe(false);
    expect(sub.answered).toBe(true);
    expect(sub.live).toBe(true);
    sub.stop();
  });

  test("a resubscribe that fails after an answer is retried with a growing delay", async () => {
    const host = fakeHost();
    const delays: number[] = [];
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      const sub = startProjectStateSubscription({
        retryDelay: (attempt) => {
          delays.push(attempt);
          return 0;
        },
        store: createContentStore(),
        subscribe: host.subscribe,
      });
      await settle(sub);
      host.failures.push(new Error("down"), new Error("still down"));
      host.end();
      await settle(sub);
      expect(delays).toEqual([0, 1]);
      expect(sub.live).toBe(true);
      expect(host.requests).toHaveLength(4);
      expect(warn).toHaveBeenCalledTimes(2);
      // A later failure starts counting again.
      host.failures.push(new Error("again"));
      host.end();
      await settle(sub);
      expect(delays).toEqual([0, 1, 0]);
      sub.stop();
    } finally {
      console.warn = original;
    }
  });

  test("the default delay doubles from half a second and stop cancels it", async () => {
    const host = fakeHost();
    const sub = startProjectStateSubscription({
      store: createContentStore(),
      subscribe: host.subscribe,
    });
    await settle(sub);
    const original = console.warn;
    console.warn = () => {};
    try {
      host.failures.push(new Error("down"));
      host.end();
      await settle(sub);
      const before = host.requests.length;
      sub.stop();
      await new Promise((resume) => {
        setTimeout(resume, 600);
      });
      expect(host.requests).toHaveLength(before);
    } finally {
      console.warn = original;
    }
  });

  test("nothing reaches the store after stop, nor from a replaced subscription", async () => {
    const host = fakeHost();
    const store = createContentStore();
    const sub = startProjectStateSubscription({ store, subscribe: host.subscribe });
    await settle(sub);
    const stale = host.listener!;
    host.end();
    await settle(sub);
    // The replaced listener's frames and end are dropped.
    stale.events({ epoch: "e1", events: [host.emit(await added("x.json", "dx", "X"), true)] });
    stale.ended?.("e1");
    await settle(sub);
    expect(store.docAt("x.json")).toBeUndefined();
    expect(host.requests).toHaveLength(2);
    sub.stop();
    host.emit(await added("y.json", "dy", "Y"));
    host.end();
    await settle(sub);
    expect(store.docAt("y.json")).toBeUndefined();
    expect(host.requests).toHaveLength(2);
  });

  test("frames queued behind an end replay from where the store is, losing nothing", async () => {
    const host = fakeHost();
    const store = createContentStore();
    const sub = startProjectStateSubscription({ store, subscribe: host.subscribe });
    await settle(sub);
    /* Two frames wait behind a note in flight, and the host ends the subscription in the same
       tick: they belong to the replaced subscription and must not move the cursor past the store. */
    const a = await added("a.json", "d1", "A");
    const b = await added("b.json", "d2", "B");
    void store.noteOwnWrite("z.json", "Z");
    host.emit(a);
    host.emit(b);
    host.end();
    await settle(sub);
    expect(host.requests).toEqual([{}, { epoch: "e1", sinceRev: 0 }]);
    expect(store.docAt("a.json")?.docId).toBe("d1");
    expect(store.docAt("b.json")?.docId).toBe("d2");
    expect(sub.live).toBe(true);
    sub.stop();
  });

  test("settled resolves on the first answer, a refusal, or a stop", async () => {
    const host = fakeHost();
    const answered = startProjectStateSubscription({
      store: createContentStore(),
      subscribe: host.subscribe,
    });
    await answered.settled();
    expect(answered.answered).toBe(true);
    answered.stop();

    const refused = fakeHost();
    refused.failures.push(new Error("404"));
    const unavailable = startProjectStateSubscription({
      store: createContentStore(),
      subscribe: refused.subscribe,
    });
    await unavailable.settled();
    expect(unavailable.unavailable).toBe(true);

    const hanging = startProjectStateSubscription({
      store: createContentStore(),
      subscribe: () => new Promise(() => {}),
    });
    hanging.stop();
    await hanging.settled();
    expect(hanging.answered).toBe(false);
  });

  test("a frame queued before stop is not applied after it", async () => {
    const host = fakeHost();
    const store = createContentStore();
    const sub = startProjectStateSubscription({ store, subscribe: host.subscribe });
    await settle(sub);
    // The frame waits behind a note in flight, and the stop lands while it waits.
    void store.noteOwnWrite("q.json", "Q");
    host.emit(await added("p.json", "dp", "P"));
    host.emit(await added("q.json", "dq", "Q"));
    sub.stop();
    await settle(sub);
    expect(store.docAt("q.json")).toBeUndefined();
  });

  test("an answer or a failure that arrives after stop is dropped", async () => {
    let resolve: (response: SubscribeResponse) => void = () => {};
    let reject: (error: Error) => void = () => {};
    const store = createContentStore();
    const pending = startProjectStateSubscription({
      store,
      subscribe: () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    });
    pending.stop();
    resolve({ epoch: "e", events: [], kind: "events", rev: 0 });
    await settle(pending);
    expect(pending.live).toBe(false);
    const failing = startProjectStateSubscription({
      store,
      subscribe: () =>
        new Promise((_, no) => {
          reject = no;
        }),
    });
    failing.stop();
    reject(new Error("late"));
    await settle(failing);
    expect(failing.unavailable).toBe(false);
  });

  test("an answer of no events reports none, and a frame that cannot apply is logged", async () => {
    const host = fakeHost();
    const store = createContentStore();
    const batches: AppliedEvent[][] = [];
    const sub = startProjectStateSubscription({
      onEvents: (batch) => batches.push(batch),
      store,
      subscribe: host.subscribe,
    });
    await settle(sub);
    host.end();
    await settle(sub);
    expect(batches).toEqual([]);
    const broken: ContentStore = {
      ...store,
      applyEvent: () => {
        throw new Error("broken");
      },
      isOwnEvent: () => false,
      settled: () => store.settled(),
    };
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const host2 = fakeHost();
      const sub2 = startProjectStateSubscription({ store: broken, subscribe: host2.subscribe });
      host2.emit(await added("a.json", "d1", "A"), true);
      await settle(sub2);
      host2.end();
      await settle(sub2);
      expect(logged.map(([message]) => message)).toEqual([
        "[project-state] a frame could not be applied:",
      ]);
      sub2.stop();
    } finally {
      console.error = original;
    }
    sub.stop();
  });
});

describe("the window's subscription", () => {
  test("a platform without the member starts nothing", () => {
    expect(startProjectStateSync({})).toBeNull();
    expect(projectStateLive()).toBe(false);
    expect(projectStateServed()).toBe(false);
    expect(projectStateTracksWrites()).toBe(false);
  });

  test("starting one replaces the one before, and stopping forgets it", async () => {
    const host = fakeHost();
    const first = startProjectStateSync({ subscribeProjectState: host.subscribe });
    expect(projectStateTracksWrites()).toBe(true);
    // Nothing says the host takes a base until it has answered.
    expect(projectStateServed()).toBe(false);
    await settle(first!);
    expect(projectStateLive()).toBe(true);
    expect(projectStateServed()).toBe(true);
    expect(contentStore.formats).toBe("f");
    const second = startProjectStateSync({ subscribeProjectState: host.subscribe });
    expect(first!.live).toBe(false);
    // Stopping a subscription that is not the window's leaves the window's alone.
    stopProjectStateSync(first);
    expect(projectStateTracksWrites()).toBe(true);
    stopProjectStateSync(second);
    expect(projectStateTracksWrites()).toBe(false);
    contentStore.reset();
  });

  test("a write waits for the window's subscription to settle, or for the timeout", async () => {
    // No subscription: nothing to wait for.
    await whenProjectStateSettled(1);
    const host = fakeHost();
    startProjectStateSync({ subscribeProjectState: host.subscribe });
    await whenProjectStateSettled(1000);
    expect(projectStateServed()).toBe(true);
    // A host that never answers holds a write no longer than the timeout.
    startProjectStateSync({ subscribeProjectState: () => new Promise(() => {}) });
    await whenProjectStateSettled(5);
    expect(projectStateServed()).toBe(false);
    contentStore.reset();
  });

  test("a refused host tracks no writes", async () => {
    const host = fakeHost();
    host.failures.push(new Error("404"));
    const sub = startProjectStateSync({ subscribeProjectState: host.subscribe });
    await settle(sub!);
    expect(projectStateTracksWrites()).toBe(false);
    stopProjectStateSync();
    expect(projectStateLive()).toBe(false);
  });
});
