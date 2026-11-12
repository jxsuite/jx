/**
 * The frame's answer to a remote lookup, and how it says where a binding stands
 * (`canvas/iframe-remote.ts`, studio.md §4.5): the units under the end-to-end cases in
 * `canvas-remote.test.ts`. What "author code runs on the canvas once" has to survive is here: a
 * lookup that never answers, one that throws before it starts, one asked for in a loop, and one the
 * session it belonged to has moved on from.
 */
import "./with-dom.js";
import { describe, expect, mock, test } from "bun:test";
import {
  REMOTE_LIMIT,
  adoptRemote,
  adoptRemoteResults,
  answerLookup,
  entryStatuses,
  inheritedStatuses,
  isRemoteEntry,
  newRemoteStore,
  readsStateKey,
  remoteKey,
  stampStatuses,
} from "../src/canvas/iframe-remote";
import type { RemoteStore, StatusContext } from "../src/canvas/iframe-remote";
import type { RemoteResult } from "../src/canvas/iframe-protocol";
import type { RemoteLookup } from "@jxsuite/runtime";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

const wait = (ms = 0) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const SCOPE = {};

/** A `GET` lookup of `url`, under the state key `key`. */
function request(url: string, key = "posts", extra: JsonObject = {}): RemoteLookup {
  return { key, kind: "request", request: { method: "GET", url, ...extra }, scope: SCOPE };
}

/** A store that fetches, on a host with a backend, in session `tab:0`. */
function fetching(onSettled: RemoteStore["onSettled"] = () => {}, timeoutMs = 1000): RemoteStore {
  const store = newRemoteStore(onSettled, () => {}, timeoutMs);
  adoptRemote(store, { fetch: true, results: {}, server: true, session: "tab:0" });
  return store;
}

/** The value a promise settles to, or the message it rejects with. */
async function outcome(answer: ReturnType<typeof answerLookup>): Promise<JsonValue> {
  if (!(answer instanceof Promise)) {
    throw new TypeError("expected a lookup in flight");
  }
  try {
    return await answer;
  } catch (error) {
    return `rejected: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Ask `store` for `lookup`, and answer with how the lookup it started came out. */
function ask(
  store: RemoteStore,
  lookup: RemoteLookup,
  run: () => Promise<JsonValue>,
): Promise<JsonValue> {
  return outcome(answerLookup(store, lookup, run));
}

describe("remoteKey", () => {
  test("is the same for the same question, whatever order its keys were written in", () => {
    const a = remoteKey({ kind: "request", request: { headers: { a: "1", b: "2" }, url: "/x" } });
    const b = remoteKey({ kind: "request", request: { url: "/x", headers: { b: "2", a: "1" } } });
    expect(a).toBe(b);
  });

  test("differs by kind, by URL, by method, by a header and by an argument", () => {
    const keys = [
      remoteKey({ kind: "request", request: { method: "GET", url: "/x" } }),
      remoteKey({ kind: "server", request: { method: "GET", url: "/x" } }),
      remoteKey({ kind: "request", request: { method: "GET", url: "/y" } }),
      remoteKey({ kind: "request", request: { method: "HEAD", url: "/x" } }),
      remoteKey({ kind: "request", request: { headers: { a: "1" }, method: "GET", url: "/x" } }),
      remoteKey({ kind: "server", request: { $export: "f", arguments: { n: [1, null] } } }),
      remoteKey({ kind: "server", request: { $export: "f", arguments: { n: [1, 2] } } }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("answerLookup", () => {
  test("runs a lookup once, hands every later ask its answer at once, and tells the host", async () => {
    const settled: [string, RemoteResult][] = [];
    const store = fetching((key, result) => settled.push([key, result]));
    const run = mock(() => Promise.resolve<JsonValue>([1]));
    expect(await ask(store, request("/x"), run)).toEqual([1]);
    expect(answerLookup(store, request("/x"), run)).toEqual({ value: [1] });
    // Another state key asking the same question is the same lookup.
    expect(answerLookup(store, request("/x", "again"), run)).toEqual({ value: [1] });
    expect(run).toHaveBeenCalledTimes(1);
    expect(settled).toEqual([[remoteKey(request("/x")), { ok: true, value: [1] }]]);
  });

  test("two asks while one is out share it", async () => {
    const store = fetching();
    const { promise, resolve } = Promise.withResolvers<JsonValue>();
    const run = mock(() => promise);
    const first = answerLookup(store, request("/x"), run);
    const second = answerLookup(store, request("/x"), run);
    expect(second).toBe(first);
    resolve("late");
    expect(await outcome(second)).toBe("late");
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("keeps a failure: a request's is written as the page writes it, a server call's is not written", async () => {
    const store = fetching();
    const run = mock(() => Promise.reject<JsonValue>(new Error("boom")));
    expect(await ask(store, request("/x"), run)).toBe("rejected: boom");
    expect(answerLookup(store, request("/x"), run)).toEqual({ value: { error: "boom" } });
    const call: RemoteLookup = {
      key: "total",
      kind: "server",
      request: { $export: "sum", $src: "./s.js", arguments: {} },
      scope: SCOPE,
    };
    await ask(store, call, run);
    expect(answerLookup(store, call, run)).toBeNull();
    expect(run).toHaveBeenCalledTimes(2);
    expect(entryStatuses(store, SCOPE, { total: { timing: "server" } })).toEqual({
      total: { error: "boom", status: "failed" },
    });
  });

  test("a rejection that is a bare string, or an empty one, still has a reason", async () => {
    const store = fetching();
    // What the runtime rejects a failed response with is its status text, a string.
    // eslint-disable-next-line prefer-promise-reject-errors -- the shape under test
    const text = () => Promise.reject<JsonValue>("Not Found");
    // eslint-disable-next-line prefer-promise-reject-errors -- the shape under test
    const empty = () => Promise.reject<JsonValue>("");
    const blank = new TypeError("erased below");
    blank.message = "";
    const nameless = () => Promise.reject<JsonValue>(blank);
    expect(await ask(store, request("/a"), text)).toBe("rejected: Not Found");
    expect(await ask(store, request("/b"), empty)).toBe("rejected: The request failed");
    await ask(store, request("/c"), nameless);
    const kept = (url: string) => store.settled.get(remoteKey(request(url)));
    expect(kept("/c")).toEqual({ error: "TypeError", ok: false });
  });

  test("a lookup that throws before it returns a promise fails like any other", async () => {
    const store = fetching();
    const result = await ask(store, request("/x"), () => {
      throw new TypeError("Invalid URL");
    });
    expect(result).toBe("rejected: Invalid URL");
    const failed = store.settled.get(remoteKey(request("/x")));
    expect(failed).toEqual({
      error: "Invalid URL",
      ok: false,
    });
  });

  test("one that never answers is given up as failed, and its late answer is dropped", async () => {
    const store = fetching(() => {}, 10);
    const { promise, resolve } = Promise.withResolvers<JsonValue>();
    const answer = answerLookup(store, request("/slow"), () => promise);
    // Nothing waited: the caller has a promise at once.
    expect(answer).toBeInstanceOf(Promise);
    expect(await outcome(answer)).toBe("rejected: No answer after 0 seconds");
    resolve("too late");
    await wait();
    const slow = store.settled.get(remoteKey(request("/slow")));
    expect(slow).toEqual({
      error: "No answer after 0 seconds",
      ok: false,
    });
  });

  test("never starts a request that is not a GET, whatever the case of its method", () => {
    const store = fetching();
    const run = mock(() => Promise.resolve<JsonValue>(1));
    for (const method of ["POST", "put", "Delete", "PATCH"]) {
      expect(answerLookup(store, request("/x", "saved", { method }), run)).toBeNull();
    }
    expect(run).not.toHaveBeenCalled();
    expect(entryStatuses(store, SCOPE, { saved: { $prototype: "Request" } })).toEqual({
      saved: { status: "not-run" },
    });
  });

  test("a GET runs whatever the case its method is written in", () => {
    const store = fetching();
    const run = mock(() => Promise.resolve<JsonValue>(1));
    for (const [i, method] of ["get", "Get", "GET"].entries()) {
      expect(answerLookup(store, request(`/x${i}`, "posts", { method }), run)).toBeInstanceOf(
        Promise,
      );
    }
    expect(run).toHaveBeenCalledTimes(3);
  });

  test("a method that is not the text GET is refused, whatever fetch would make of it", () => {
    const store = fetching();
    const run = mock(() => Promise.resolve<JsonValue>(1));
    /* `fetch` turns `["POST"]` into POST: an array, a number, a record and a padded name are each
       not the word, and the canvas draws a document as written, schema-valid or not. */
    const methods: JsonValue[] = [
      ["POST"],
      ["delete"],
      ["GET"],
      7,
      true,
      { m: "GET" },
      null,
      " GET",
      "",
      "HEAD",
      "${state.verb}",
    ];
    for (const method of methods) {
      expect(answerLookup(store, request("/x", "saved", { method }), run)).toBeNull();
    }
    expect(run).not.toHaveBeenCalled();
    expect(entryStatuses(store, SCOPE, { saved: { $prototype: "Request" } })).toEqual({
      saved: { status: "not-run" },
    });
    // A lookup that names no method at all is the default, which is a GET.
    const bare: RemoteLookup = {
      key: "bare",
      kind: "request",
      request: { url: "/b" },
      scope: SCOPE,
    };
    expect(answerLookup(store, bare, run)).toBeInstanceOf(Promise);
  });

  test("never calls a server function on a host with no backend", () => {
    const store = newRemoteStore();
    adoptRemote(store, { fetch: true, results: {}, server: false, session: "tab:0" });
    const run = mock(() => Promise.resolve<JsonValue>(1));
    const call: RemoteLookup = { key: "total", kind: "server", request: {}, scope: SCOPE };
    expect(answerLookup(store, call, run)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  test("stops asking after the limit, so a URL that is new every time cannot loop", async () => {
    const store = fetching();
    const run = mock(() => Promise.resolve<JsonValue>(1));
    for (let i = 0; i < REMOTE_LIMIT + 5; i++) {
      void answerLookup(store, request(`/x?t=${i}`), run);
    }
    await wait();
    expect(run).toHaveBeenCalledTimes(REMOTE_LIMIT);
    // The one past the limit is not run, and says so rather than hanging as pending.
    expect(entryStatuses(store, SCOPE, { posts: { $prototype: "Request" } })).toEqual({
      posts: { status: "not-run" },
    });
    // A Refresh is a new session, and the count starts over.
    adoptRemote(store, { fetch: true, results: {}, server: true, session: "tab:1" });
    void answerLookup(store, request("/x?t=new"), run);
    expect(run).toHaveBeenCalledTimes(REMOTE_LIMIT + 1);
  });

  test("an answer that arrives after its session ended is the host's to judge, and never this session's", async () => {
    const settled: [string, RemoteResult, string][] = [];
    const store = fetching((key, result, session) => settled.push([key, result, session]));
    const { promise, resolve } = Promise.withResolvers<JsonValue>();
    void answerLookup(store, request("/x"), () => promise);
    adoptRemote(store, { fetch: true, results: {}, server: true, session: "tab:1" });
    resolve("stale");
    await wait();
    // Not an answer of the session the frame draws now.
    expect(store.settled.size).toBe(0);
    // Reported under the session it was asked in, which the host drops after a Refresh.
    expect(settled).toEqual([[remoteKey(request("/x")), { ok: true, value: "stale" }, "tab:0"]]);
  });

  test("a Refresh while a lookup is out fetches again", () => {
    const store = fetching();
    const run = mock(() => Promise.withResolvers<JsonValue>().promise);
    void answerLookup(store, request("/x"), run);
    adoptRemote(store, { fetch: true, results: {}, server: true, session: "tab:1" });
    void answerLookup(store, request("/x"), run);
    expect(run).toHaveBeenCalledTimes(2);
    // And the new session's lookup is its own: out, with no answer of the old one's.
    expect(store.settled.size).toBe(0);
    expect(entryStatuses(store, SCOPE, { posts: { $prototype: "Request" } })).toEqual({
      posts: { status: "pending" },
    });
  });

  test("a frame handed another tab and then the first one again keeps the lookup it had out", async () => {
    const settled: [string, RemoteResult, string][] = [];
    const store = fetching((key, result, session) => settled.push([key, result, session]));
    const { promise, resolve } = Promise.withResolvers<JsonValue>();
    const run = mock(() => promise);
    void answerLookup(store, request("/slow"), run);
    // The frame is reused for another tab's document, and then draws the first tab again.
    adoptRemote(store, { fetch: true, results: {}, server: true, session: "other:0" });
    adoptRemote(store, { fetch: true, results: {}, server: true, session: "tab:0" });
    const again = answerLookup(store, request("/slow"), run);
    expect(run).toHaveBeenCalledTimes(1);
    resolve("one answer");
    expect(await outcome(again)).toBe("one answer");
    expect(settled).toEqual([
      [remoteKey(request("/slow")), { ok: true, value: "one answer" }, "tab:0"],
    ]);
    const key = remoteKey(request("/slow"));
    expect(store.settled.get(key)).toEqual({
      ok: true,
      value: "one answer",
    });
  });

  test("a lookup that answers while its frame draws another tab is still reported for its own", async () => {
    const settled: [string, RemoteResult, string][] = [];
    const store = fetching((key, result, session) => settled.push([key, result, session]));
    const { promise, resolve } = Promise.withResolvers<JsonValue>();
    void answerLookup(store, request("/slow"), () => promise);
    adoptRemote(store, { fetch: true, results: {}, server: true, session: "other:0" });
    const changes = mock();
    store.onChange = changes;
    resolve("late");
    await wait();
    expect(settled).toEqual([[remoteKey(request("/slow")), { ok: true, value: "late" }, "tab:0"]]);
    // Nothing of the other tab's is touched: no answer kept under its session, no status redrawn.
    expect(store.settled.size).toBe(0);
    expect(changes).not.toHaveBeenCalled();
  });

  test("the host's answer replaces one this frame holds for the same lookup", () => {
    const store = fetching();
    const key = remoteKey(request("/x"));
    adoptRemoteResults(store, "tab:0", { [key]: { ok: true, value: "mine" } });
    // Two frames answered one lookup; the host kept the other, and a render says so.
    adoptRemote(store, {
      fetch: true,
      results: { [key]: { ok: true, value: "the tab's" } },
      server: true,
      session: "tab:0",
    });
    expect(answerLookup(store, request("/x"), mock())).toEqual({ value: "the tab's" });
  });

  test("two state keys asking one question while it is out are both loading", () => {
    const store = fetching();
    const run = mock(() => Promise.withResolvers<JsonValue>().promise);
    void answerLookup(store, request("/x", "a"), run);
    void answerLookup(store, request("/x", "b"), run);
    expect(run).toHaveBeenCalledTimes(1);
    const state = { a: { $prototype: "Request" }, b: { $prototype: "Request" } };
    expect(entryStatuses(store, SCOPE, state)).toEqual({
      a: { status: "pending" },
      b: { status: "pending" },
    });
  });
});

describe("a frame that does not fetch", () => {
  test("waits for the host, and a new session ends the wait without an answer", async () => {
    const store = newRemoteStore();
    adoptRemote(store, { fetch: false, results: {}, server: true, session: "tab:0" });
    const run = mock(() => Promise.resolve<JsonValue>(1));
    const waiting = outcome(answerLookup(store, request("/x"), run));
    const failing = outcome(answerLookup(store, request("/y"), run));
    const key = remoteKey(request("/x"));
    adoptRemoteResults(store, "tab:0", {
      [key]: { ok: true, value: "passed on" },
      [remoteKey(request("/y"))]: { error: "nope", ok: false },
    });
    expect(await waiting).toBe("passed on");
    expect(await failing).toBe("rejected: nope");
    // The same answer again changes nothing.
    const changes = mock();
    store.onChange = changes;
    adoptRemoteResults(store, "tab:0", { [key]: { ok: true, value: "again" } });
    expect(changes).not.toHaveBeenCalled();
    expect(store.settled.get(key)).toEqual({ ok: true, value: "passed on" });

    const abandoned = answerLookup(store, request("/z"), run);
    adoptRemote(store, { fetch: false, results: {}, server: true, session: "tab:1" });
    // Rejected, as an abort, which the runtime drops without reporting.
    expect(await outcome(abandoned)).toBe("rejected: The canvas moved on");
    const reason = await Promise.resolve(abandoned).then(
      () => "answered",
      (error: Error) => error.name,
    );
    expect(reason).toBe("AbortError");
    expect(run).not.toHaveBeenCalled();
  });

  test("says a status may have changed when an answer arrives, its own or one passed on", async () => {
    const changes = mock();
    const store = newRemoteStore(() => {}, changes);
    adoptRemote(store, { fetch: true, results: {}, server: true, session: "tab:0" });
    const { promise, resolve } = Promise.withResolvers<JsonValue>();
    void answerLookup(store, request("/own"), () => promise);
    changes.mockClear();
    resolve(1);
    await wait();
    // The chip that said Loading is drawn again because of this call and nothing else.
    expect(changes).toHaveBeenCalledTimes(1);

    adoptRemote(store, { fetch: false, results: {}, server: true, session: "tab:0" });
    void answerLookup(store, request("/theirs"), mock());
    changes.mockClear();
    adoptRemoteResults(store, "tab:0", { [remoteKey(request("/theirs"))]: { ok: true, value: 2 } });
    expect(changes).toHaveBeenCalledTimes(1);
    expect(entryStatuses(store, SCOPE, { posts: { $prototype: "Request" } })).toEqual({
      posts: { status: "resolved" },
    });
  });

  test("two state keys waiting on one lookup are both written when it is passed on", async () => {
    const store = newRemoteStore();
    adoptRemote(store, { fetch: false, results: {}, server: true, session: "tab:0" });
    const run = mock(() => Promise.resolve<JsonValue>(1));
    const a = outcome(answerLookup(store, request("/x", "a"), run));
    const b = outcome(answerLookup(store, request("/x", "b"), run));
    adoptRemoteResults(store, "tab:0", {
      [remoteKey(request("/x"))]: { ok: true, value: "passed" },
    });
    expect(await Promise.all([a, b])).toEqual(["passed", "passed"]);
    expect(run).not.toHaveBeenCalled();
  });

  test("named the fetcher while it waits, it runs the lookup at the next ask and answers the wait", async () => {
    const settled: [string, RemoteResult, string][] = [];
    const store = newRemoteStore((key, result, session) => settled.push([key, result, session]));
    adoptRemote(store, { fetch: false, results: {}, server: true, session: "tab:0" });
    const run = mock(() => Promise.resolve<JsonValue>("fetched here"));
    const waited = outcome(answerLookup(store, request("/x"), run));
    expect(run).not.toHaveBeenCalled();
    // The artboard that was fetching is gone: the host hands this frame the role, same session.
    adoptRemote(store, { fetch: true, results: {}, server: true, session: "tab:0" });
    const asked = outcome(answerLookup(store, request("/x"), run));
    expect(run).toHaveBeenCalledTimes(1);
    expect(await asked).toBe("fetched here");
    // What asked while it waited is written by the same answer.
    expect(await waited).toBe("fetched here");
    expect(settled).toHaveLength(1);
    expect(entryStatuses(store, SCOPE, { posts: { $prototype: "Request" } })).toEqual({
      posts: { status: "resolved" },
    });
  });
});

describe("entryStatuses and inheritedStatuses", () => {
  test("an entry nobody asked about is not run; a plain entry is not listed at all", () => {
    const store = fetching();
    expect(isRemoteEntry({ $prototype: "Request" })).toBe(true);
    expect(isRemoteEntry({ timing: "server" })).toBe(true);
    expect(isRemoteEntry({ $prototype: "Set" })).toBe(false);
    expect(isRemoteEntry("text")).toBe(false);
    expect(
      entryStatuses(store, SCOPE, {
        count: 1,
        later: { $prototype: "Request", manual: true, url: "/x" },
      }),
    ).toEqual({ later: { status: "not-run" } });
    expect(entryStatuses(store, SCOPE, {})).toEqual({});
  });

  test("an entry that reads an unresolved one is unresolved too, however far", () => {
    const entries = { ok: { status: "resolved" }, posts: { status: "pending" } } as const;
    expect(
      inheritedStatuses(entries, {
        count: "${state.posts.length}",
        label: "${state.count} posts",
        ok: { $prototype: "Request" },
        other: "${state.ok.length}",
        posts: { $prototype: "Request" },
      }),
    ).toEqual({
      count: { status: "pending" },
      label: { status: "pending" },
      posts: { status: "pending" },
    });
    expect(inheritedStatuses({}, {})).toEqual({});
  });

  test("inheritance does not depend on the order the entries are declared in", () => {
    expect(
      inheritedStatuses(
        { posts: { status: "pending" } },
        // Declared furthest first: `label` reads `count`, which is not known unresolved yet.
        {
          label: "${state.count} posts",
          count: "${state.posts.length}",
          posts: { $prototype: "Request" },
        },
      ),
    ).toEqual({
      count: { status: "pending" },
      label: { status: "pending" },
      posts: { status: "pending" },
    });
  });

  test("a request with an answer is resolved, whatever its URL reads", () => {
    const entries = { me: { status: "pending" }, posts: { status: "resolved" } } as const;
    expect(
      inheritedStatuses(entries, {
        me: { $prototype: "Request", url: "/me" },
        posts: { $prototype: "Request", url: "/posts?of=${state.me?.id}" },
      }),
    ).toEqual({ me: { status: "pending" } });
  });

  test("a request never asked about because what it reads failed or is loading says that, not Runs on the live page", async () => {
    const store = fetching();
    const state = {
      later: { $prototype: "Request", manual: true, url: "/x/${state.me?.id}" },
      me: { $prototype: "Request", url: "/api/me" },
      name: "${state.me?.name}",
      posts: { $prototype: "Request", url: "/api/posts/${state.me?.id}" },
      tags: { $prototype: "Request", url: "/api/tags/${state.name}" },
    };
    const { promise, reject } = Promise.withResolvers<JsonValue>();
    // The runtime asks about `me` alone: a URL that reads a value not there yet is never asked.
    void answerLookup(store, request("/api/me", "me"), () => promise);
    expect(entryStatuses(store, SCOPE, state)).toEqual({
      later: { status: "not-run" },
      me: { status: "pending" },
      posts: { status: "pending" },
      // Through a plain entry that reads the one still out.
      tags: { status: "pending" },
    });
    reject(new Error("Boom"));
    await wait();
    expect(entryStatuses(store, SCOPE, state)).toEqual({
      // A `manual` request waits for a handler, whatever its URL reads.
      later: { status: "not-run" },
      me: { error: "Boom", status: "failed" },
      posts: { error: "Boom", status: "failed" },
      tags: { error: "Boom", status: "failed" },
    });
  });

  test("readsStateKey tells a key from a longer name and from another object's member", () => {
    expect(readsStateKey("${state.posts.length}", "posts")).toBe(true);
    expect(readsStateKey("${state?.posts}", "posts")).toBe(true);
    expect(readsStateKey('${state["my-posts"][0]}', "my-posts")).toBe(true);
    expect(readsStateKey("#/state/posts/0", "posts")).toBe(true);
    expect(readsStateKey("#/state/a~1b", "a/b")).toBe(true);
    expect(readsStateKey("${state.postsCount}", "posts")).toBe(false);
    expect(readsStateKey("${item.state.posts}", "posts")).toBe(false);
    expect(readsStateKey("#/state/posts2", "posts")).toBe(false);
    expect(readsStateKey("${state.a$b}", "a$b")).toBe(true);
    // `state` at the end of a longer name is another name.
    expect(readsStateKey("${mystate.posts}", "posts")).toBe(false);
    expect(readsStateKey("${$state.posts}", "posts")).toBe(false);
    // A spread is a read; a member of another object after one is still not.
    expect(readsStateKey("${[...state.posts].length}", "posts")).toBe(true);
    expect(readsStateKey("${[...item.state.posts]}", "posts")).toBe(false);
  });
});

describe("stampStatuses", () => {
  /** A container holding `html`, and a context over `unresolved`. */
  function drawn(html: string, ctx: Partial<StatusContext> = {}) {
    const container = document.createElement("div");
    container.innerHTML = html;
    const context: StatusContext = {
      failureOf: () => null,
      nodeAt: () => null,
      unresolved: {},
      ...ctx,
    };
    return { bindings: stampStatuses(container, context), container, context };
  }

  test("marks a chip by the weightiest unresolved entry it reads, and clears a stale mark", () => {
    const { bindings, container, context } = drawn(
      '<p data-jx-path="[0]">' +
        '<data data-jx-tag="${state.a + state.b}" data-jx-tag-label="A"></data>' +
        '<data data-jx-tag="${state.c}" data-jx-tag-label="C">3</data>' +
        '<data data-jx-tag="{}" data-jx-tag-ref="#/state/b" data-jx-tag-label="B"></data></p>',
      {
        unresolved: {
          a: { status: "not-run" },
          b: { error: "Not Found", status: "failed" },
        },
      },
    );
    const [first, second, third] = [...container.querySelectorAll("data")];
    expect(first!.dataset.jxStatus).toBe("failed");
    expect(first!.dataset.jxStatusNote).toBe("Could not load");
    expect(first!.getAttribute("title")).toBe("Not Found");
    expect(second!.dataset.jxStatus).toBeUndefined();
    expect(third!.dataset.jxStatus).toBe("failed");
    expect(bindings).toEqual([
      { error: "Not Found", path: [0], source: "${state.a + state.b}", status: "failed" },
      { path: [0], source: "${state.c}", status: "resolved" },
      { error: "Not Found", path: [0], source: '{"$ref":"#/state/b"}', status: "failed" },
    ]);

    // The answers arrive: the same pass takes every mark off again.
    stampStatuses(container, { ...context, unresolved: {} });
    expect(container.querySelectorAll("[data-jx-status]")).toHaveLength(0);
    expect(first!.hasAttribute("title")).toBe(false);
  });

  test("a chip that reads an entry loading and one the canvas does not run says it is loading", () => {
    const { container } = drawn('<data data-jx-tag="${state.a + state.b}"></data>', {
      unresolved: { a: { status: "not-run" }, b: { status: "pending" } },
    });
    expect(container.querySelector("data")?.dataset.jxStatus).toBe("pending");
    const other = drawn('<data data-jx-tag="${state.a + state.b}"></data>', {
      unresolved: { a: { status: "pending" }, b: { status: "not-run" } },
    });
    expect(other.container.querySelector("data")?.dataset.jxStatus).toBe("pending");
  });

  test("a chip whose own expression throws says so in its own words, not as data that failed to load", () => {
    const { container } = drawn(
      '<p data-jx-path="[0]"><data data-jx-tag="${state.user.name}"></data>' +
        '<data data-jx-tag="${state.posts.length}"></data></p>',
      {
        failureOf: () => "Cannot read properties of null (reading 'name')",
        unresolved: { posts: { error: "Not Found", status: "failed" } },
      },
    );
    const [thrown, unloaded] = [...container.querySelectorAll("data")];
    expect(thrown!.dataset.jxStatus).toBe("failed");
    expect(thrown!.dataset.jxStatusNote).toBe("Has an error");
    expect(thrown!.getAttribute("title")).toBe("Cannot read properties of null (reading 'name')");
    expect(unloaded!.dataset.jxStatusNote).toBe("Could not load");
  });

  test("a chip in a template row is never asked why it is empty: the row has no item by design", () => {
    const failureOf = mock(() => "Cannot read properties of null (reading 'title')");
    const { bindings, container } = drawn(
      '<ul data-jx-path="[0]"><li data-jx-template-row data-jx-path="[0,&quot;map&quot;]">' +
        '<data data-jx-tag="${item.title}"></data>' +
        '<span><data data-jx-tag="${state.posts.length}"></data></span></li></ul>' +
        '<p data-jx-path="[1]"><data data-jx-tag="${state.user.name}"></data></p>',
      { failureOf, unresolved: { posts: { status: "pending" } } },
    );
    const [row, nested, outside] = [...container.querySelectorAll("data")];
    expect(row!.dataset.jxStatus).toBeUndefined();
    expect(row!.hasAttribute("title")).toBe(false);
    // What it reads of the document's own data is still said.
    expect(nested!.dataset.jxStatus).toBe("pending");
    expect(outside!.dataset.jxStatus).toBe("failed");
    expect(failureOf).toHaveBeenCalledTimes(1);
    expect(bindings.map((binding) => binding.status)).toEqual(["resolved", "pending", "failed"]);
  });

  test("a chip in an echo row is reported under its own block's path, as the first row's is", () => {
    const { bindings } = drawn(
      '<ul data-jx-path="[0]">' +
        '<li data-jx-path="[0,&quot;map&quot;]"><data data-jx-tag="${state.bad.x}"></data></li>' +
        '<li data-jx-echo-path="[0,&quot;map&quot;]"><data data-jx-tag="${state.bad.x}"></data></li>' +
        "</ul>",
      { unresolved: { bad: { error: "Boom", status: "failed" } } },
    );
    expect(bindings.map((binding) => binding.path)).toEqual([
      [0, "map"],
      [0, "map"],
    ]);
  });

  test("asks an empty chip why it is empty, and only an empty one", () => {
    const failureOf = mock((_chip: Element, source: string) =>
      source.includes("missing") ? "missing is undefined" : null,
    );
    const { bindings, container } = drawn(
      '<data data-jx-tag="${state.missing.x}"></data>' +
        '<data data-jx-tag="${state.blank}"></data>' +
        '<data data-jx-tag="${state.full}">text</data>' +
        '<data data-jx-tag="${state.nodes}"><b></b></data>',
      { failureOf },
    );
    expect(failureOf).toHaveBeenCalledTimes(2);
    expect(bindings.map((binding) => binding.status)).toEqual([
      "failed",
      "resolved",
      "resolved",
      "resolved",
    ]);
    // A chip with no addressable block around it has no path.
    expect(bindings[0]).toEqual({
      error: "missing is undefined",
      path: null,
      source: "${state.missing.x}",
      status: "failed",
    });
    expect(container.querySelector("data")?.dataset.jxStatus).toBe("failed");
  });

  test("marks a block whose own property reads an unresolved entry, not one whose text does", () => {
    const nodes = new Map<string, JsonObject>([
      ["[0]", { attributes: { src: "${state.user.avatar}" }, tagName: "img" }],
      ["[1]", { tagName: "p", textContent: "${state.user.name}" }],
      ["[2]", { children: [{ textContent: "${state.user.name}" }], tagName: "div" }],
    ]);
    const { bindings, container } = drawn(
      '<img data-jx-bound-field="Image" data-jx-path="[0]">' +
        '<p data-jx-bound-field="Text" data-jx-path="[1]"></p>' +
        '<div data-jx-bound-field="Text" data-jx-path="[2]"></div>' +
        '<p data-jx-bound-field="Text" data-jx-path="not json"></p>',
      {
        nodeAt: (path) => nodes.get(JSON.stringify(path)),
        unresolved: { user: { status: "pending" } },
      },
    );
    const marks = [...container.querySelectorAll<HTMLElement>("[data-jx-bound-field]")];
    expect(marks.map((el) => el.dataset.jxStatus)).toEqual([
      "pending",
      undefined,
      undefined,
      undefined,
    ]);
    expect(bindings).toEqual([{ path: [0], source: "Image", status: "pending" }]);
  });

  test("a template row says why its list has no items, when the reason is the data", () => {
    const repeater = { $prototype: "Array", items: { $ref: "#/state/posts" }, map: {} };
    const { bindings, container } = drawn(
      '<li data-jx-template-row data-jx-path="[0,&quot;map&quot;]"></li>' +
        '<li data-jx-template-row data-jx-path="[1,&quot;map&quot;]"></li>' +
        '<li data-jx-template-row data-jx-path="[2]"></li>',
      {
        nodeAt: (path) =>
          path.length === 1 && path[0] === 0
            ? repeater
            : { ...repeater, items: { $ref: "#/state/local" } },
        unresolved: { posts: { status: "not-run" } },
      },
    );
    const rows = [...container.querySelectorAll<HTMLElement>("li")];
    expect(rows[0]!.dataset.jxStatus).toBe("not-run");
    expect(rows[0]!.dataset.jxStatusNote).toBe("Runs on the live page");
    // A list that is simply empty, and a row whose stamp names no repeater, keep "No items".
    expect(rows[1]!.dataset.jxStatus).toBeUndefined();
    expect(rows[2]!.dataset.jxStatus).toBeUndefined();
    expect(bindings).toEqual([
      { path: [0], source: '{"$ref":"#/state/posts"}', status: "not-run" },
    ]);
  });

  test("a template row is judged by the list it stands in for, not by what its template reads", () => {
    const { bindings, container } = drawn(
      '<li data-jx-template-row data-jx-path="[0,&quot;map&quot;]"></li>',
      {
        // An empty local list whose rows would read an entry that is still loading.
        nodeAt: () => ({
          $prototype: "Array",
          items: { $ref: "#/state/local" },
          map: { tagName: "li", textContent: "${state.posts.length}" },
        }),
        unresolved: { posts: { status: "pending" } },
      },
    );
    expect(container.querySelector("li")?.dataset.jxStatus).toBeUndefined();
    expect(bindings).toEqual([]);
  });
});
