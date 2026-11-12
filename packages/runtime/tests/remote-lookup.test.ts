/**
 * `setRemoteLookupHandler`: a host's say over each remote lookup the runtime would start, an
 * automatic `Request` fetch or a `timing: "server"` call (embedding.md §5.2). The two skip switches
 * are all or nothing; this is the third answer, per lookup: run it, answer it from what the host
 * holds, or leave it alone.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { buildScope, setRemoteLookupHandler, setSkipAutoRequests } from "../src/runtime";
import type { RemoteLookup } from "../src/runtime";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";
import type { JxScopeValue } from "../src/types";

try {
  GlobalRegistrator.register();
} catch {}

const wait = (ms = 0) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

/** Answer every `fetch` with `answer(url)`, recording the URL and method of each call. */
function stubFetch(answer: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; method: string }[] = [];
  const { preconnect } = fetch;
  const fetchMock = mock((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url: String(url) });
    return Promise.resolve(answer(String(url)));
  });
  global.fetch = Object.assign(fetchMock, { preconnect });
  return calls;
}

afterEach(() => {
  setRemoteLookupHandler(null);
  setSkipAutoRequests(false);
});

const requestDoc = (entry: Record<string, JsonValue>): JxDocument => ({
  state: { posts: { $prototype: "Request", ...entry } },
});

describe("setRemoteLookupHandler, for a Request", () => {
  test("is told what the lookup asks for, and a lookup it runs is written", async () => {
    const calls = stubFetch(() => Response.json([1, 2]));
    const seen: RemoteLookup[] = [];
    setRemoteLookupHandler((lookup, run) => {
      seen.push(lookup);
      return run();
    });
    const state = await buildScope(
      requestDoc({ headers: { accept: "application/json" }, url: "/api/posts" }),
    );
    await wait();
    expect(calls).toEqual([{ method: "GET", url: "/api/posts" }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe("request");
    expect(seen[0]!.key).toBe("posts");
    expect(seen[0]!.scope).toBe(state);
    expect(seen[0]!.request).toEqual({
      headers: { accept: "application/json" },
      method: "GET",
      url: "/api/posts",
    });
    expect(state.posts).toEqual<JxScopeValue>([1, 2]);
  });

  test("a value it answers with is written at once, and nothing is fetched", async () => {
    const calls = stubFetch(() => Response.json("fetched"));
    setRemoteLookupHandler(() => ({ value: ["kept"] }));
    const state = await buildScope(requestDoc({ url: "/api/posts" }));
    // No turn of the event loop: the value is there when the scope is.
    expect(state.posts).toEqual<JxScopeValue>(["kept"]);
    await wait();
    expect(calls).toHaveLength(0);
  });

  test("null starts nothing and leaves the entry as it was", async () => {
    const calls = stubFetch(() => Response.json("fetched"));
    const methods: JsonValue[] = [];
    setRemoteLookupHandler((lookup) => {
      methods.push(lookup.request.method ?? null, lookup.request.body ?? null);
      return null;
    });
    const state = await buildScope(
      requestDoc({ body: { title: "x" }, method: "POST", url: "/api/posts" }),
    );
    await wait();
    expect(methods).toEqual(["POST", { title: "x" }]);
    expect(calls).toHaveLength(0);
    expect(state.posts).toBeNull();
  });

  test("a promise it answers with stands for the lookup: its rejection is the entry's failure", async () => {
    stubFetch(() => Response.json("fetched"));
    setRemoteLookupHandler(() => Promise.reject(new Error("no network")));
    const state = await buildScope(requestDoc({ url: "/api/posts" }));
    await wait();
    expect(state.posts).toEqual<JxScopeValue>({ error: "Error: no network" });
  });

  test("a failed response rejects the run the handler was handed", async () => {
    stubFetch(() => new Response(null, { status: 500, statusText: "Server Error" }));
    const failures: string[] = [];
    setRemoteLookupHandler((_lookup, run) => {
      const lookup = run();
      lookup.catch((error: Error | string) => failures.push(String(error)));
      return lookup;
    });
    const state = await buildScope(requestDoc({ url: "/api/posts" }));
    await wait();
    expect(failures).toEqual(["Server Error"]);
    expect(state.posts).toEqual<JxScopeValue>({ error: "Server Error" });
  });

  test("is asked again when the URL the entry reads changes, with the new URL", async () => {
    stubFetch((url) => Response.json(url));
    const urls: JsonValue[] = [];
    setRemoteLookupHandler((lookup, run) => {
      urls.push(lookup.request.url ?? null);
      return run();
    });
    const state = await buildScope({
      state: {
        page: 1,
        posts: { $prototype: "Request", url: "/api/posts?page=${state.page}" },
      },
    });
    await wait();
    state.page = 2;
    await wait();
    expect(urls).toEqual(["/api/posts?page=1", "/api/posts?page=2"]);
    expect(state.posts).toBe("/api/posts?page=2");
  });

  test("an answer that arrives for a binding that has moved on is not written", async () => {
    stubFetch(() => Response.json("fetched"));
    const answers: ((value: JsonValue) => void)[] = [];
    setRemoteLookupHandler(() => {
      const { promise, resolve } = Promise.withResolvers<JsonValue>();
      answers.push(resolve);
      return promise;
    });
    const state = await buildScope({
      state: {
        page: 1,
        posts: { $prototype: "Request", url: "/api/posts?page=${state.page}" },
      },
    });
    state.page = 2;
    await wait();
    expect(answers).toHaveLength(2);
    answers[1]!("second");
    await wait();
    answers[0]!("first, late");
    await wait();
    expect(state.posts).toBe("second");
  });

  test("a rejection that arrives for a binding that has moved on is not written either", async () => {
    stubFetch(() => Response.json("fetched"));
    const lookups: PromiseWithResolvers<JsonValue>[] = [];
    setRemoteLookupHandler(() => {
      const lookup = Promise.withResolvers<JsonValue>();
      lookups.push(lookup);
      return lookup.promise;
    });
    const state = await buildScope({
      state: {
        page: 1,
        posts: { $prototype: "Request", url: "/api/posts?page=${state.page}" },
      },
    });
    state.page = 2;
    await wait();
    lookups[1]!.resolve("second");
    await wait();
    lookups[0]!.reject(new Error("first, late"));
    await wait();
    expect(state.posts).toBe("second");
  });

  test("a lookup started through run is the handler's: it is not aborted when its binding moves on", async () => {
    /* A fetch that honours its signal, as the platform's does: handed the binding's own signal,
       the first lookup would be aborted the moment the URL changed. */
    const { preconnect } = fetch;
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetchMock = mock((url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal);
      const { promise, reject, resolve } = Promise.withResolvers<Response>();
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
      setTimeout(() => {
        resolve(Response.json(String(url)));
      }, 5);
      return promise;
    });
    global.fetch = Object.assign(fetchMock, { preconnect });
    const outcomes: string[] = [];
    setRemoteLookupHandler((_lookup, run) => {
      const lookup = run();
      lookup.then(
        (value) => outcomes.push(`ok ${String(value)}`),
        (error: Error) => outcomes.push(`rejected ${error.name}`),
      );
      return lookup;
    });
    const state = await buildScope({
      state: {
        page: 1,
        posts: { $prototype: "Request", url: "/api/posts?page=${state.page}" },
      },
    });
    state.page = 2;
    await wait(20);
    // The host may be keeping the first answer for whoever asks that question next.
    expect(outcomes).toEqual(["ok /api/posts?page=1", "ok /api/posts?page=2"]);
    expect(signals).toEqual([undefined, undefined]);
    expect(state.posts).toBe("/api/posts?page=2");
  });

  test("null on a later ask leaves the value an earlier answer wrote", async () => {
    stubFetch(() => Response.json("fetched"));
    let asks = 0;
    setRemoteLookupHandler(() => {
      asks += 1;
      return asks === 1 ? { value: "first" } : null;
    });
    const state = await buildScope({
      state: {
        page: 1,
        posts: { $prototype: "Request", url: "/api/posts?page=${state.page}" },
      },
    });
    state.page = 2;
    await wait();
    expect(asks).toBe(2);
    // "The entry keeps the value it has", which is not `null`.
    expect(state.posts).toBe("first");
  });

  test("taken away with null, the handler is asked nothing and the request runs as it always did", async () => {
    const calls = stubFetch(() => Response.json("fetched"));
    const asked = mock(() => null);
    setRemoteLookupHandler(asked);
    setRemoteLookupHandler(null);
    const state = await buildScope(requestDoc({ url: "/api/posts" }));
    await wait();
    expect(asked).not.toHaveBeenCalled();
    expect(calls).toEqual([{ method: "GET", url: "/api/posts" }]);
    expect(state.posts).toBe("fetched");
  });

  test("an abort a handler rejects with is nobody's failure: the entry is not written", async () => {
    stubFetch(() => Response.json("fetched"));
    setRemoteLookupHandler(() => {
      const error = new Error("nobody is waiting");
      error.name = "AbortError";
      return Promise.reject(error);
    });
    const state = await buildScope(requestDoc({ url: "/api/posts" }));
    await wait();
    expect(state.posts).toBeNull();
  });

  test("is not asked for a manual request, nor while automatic requests are skipped", async () => {
    stubFetch(() => Response.json("fetched"));
    const asked: string[] = [];
    setRemoteLookupHandler((lookup) => {
      asked.push(lookup.key);
      return { value: "answered" };
    });
    const manual = await buildScope(requestDoc({ manual: true, url: "/api/posts" }));
    setSkipAutoRequests(true);
    const skipped = await buildScope(requestDoc({ url: "/api/posts" }));
    await wait();
    expect(asked).toEqual([]);
    expect(manual.posts).toBeNull();
    expect(skipped.posts).toBeNull();
  });
});

describe("setRemoteLookupHandler, for a timing: server function", () => {
  const serverDoc: JxDocument = {
    state: {
      total: {
        $export: "sum",
        $src: "./sum.js",
        arguments: { a: 1 },
        timing: "server",
      },
    },
  };

  test("is told the module, the export and the arguments, and a call it runs is written", async () => {
    const calls = stubFetch(() => Response.json(42));
    const seen: RemoteLookup[] = [];
    setRemoteLookupHandler((lookup, run) => {
      seen.push(lookup);
      return run();
    });
    const state = await buildScope(serverDoc, {}, "http://localhost/pages/");
    await wait();
    expect(calls).toEqual([{ method: "POST", url: "/__jx_server__" }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe("server");
    expect(seen[0]!.key).toBe("total");
    expect(seen[0]!.scope).toBe(state);
    expect(seen[0]!.request).toEqual({
      $base: "http://localhost/pages/",
      $export: "sum",
      $src: "./sum.js",
      arguments: { a: 1 },
    });
    expect(state.total).toBe(42);
  });

  test("a value it answers with is written at once, and the proxy is never called", async () => {
    const calls = stubFetch(() => Response.json(42));
    setRemoteLookupHandler(() => ({ value: 7 }));
    const state = await buildScope(serverDoc);
    expect(state.total).toBe(7);
    await wait();
    expect(calls).toHaveLength(0);
  });

  test("null leaves the entry at its first value", async () => {
    const calls = stubFetch(() => Response.json(42));
    setRemoteLookupHandler(() => null);
    const state = await buildScope(serverDoc);
    await wait();
    expect(calls).toHaveLength(0);
    expect(state.total).toBeNull();
  });

  test("null on a later call leaves the value an earlier answer wrote", async () => {
    const calls = stubFetch(() => Response.json(42));
    let asks = 0;
    setRemoteLookupHandler(() => {
      asks += 1;
      return asks === 1 ? { value: 7 } : null;
    });
    const state = await buildScope({
      state: {
        n: 1,
        total: {
          $export: "sum",
          $src: "./sum.js",
          arguments: { a: { $ref: "#/state/n" } },
          timing: "server",
        },
      },
    });
    expect(state.total).toBe(7);
    state.n = 2;
    await wait();
    expect(asks).toBe(2);
    expect(state.total).toBe(7);
    expect(calls).toHaveLength(0);
  });

  test("an abort a handler rejects with is not logged: nobody was waiting, and nothing failed", async () => {
    stubFetch(() => Response.json(42));
    const errors = mock();
    const { error } = console;
    console.error = errors;
    try {
      setRemoteLookupHandler(() => {
        const abort = new Error("The host moved on");
        abort.name = "AbortError";
        return Promise.reject(abort);
      });
      const state = await buildScope(serverDoc);
      await wait();
      expect(state.total).toBeNull();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      console.error = error;
    }
  });

  test("a rejection is logged as the call's own failure and the entry keeps its value", async () => {
    stubFetch(() => Response.json(42));
    const errors = mock();
    const { error } = console;
    console.error = errors;
    try {
      setRemoteLookupHandler(() => Promise.reject(new Error("no adapter")));
      const state = await buildScope(serverDoc);
      await wait();
      expect(state.total).toBeNull();
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      console.error = error;
    }
  });
});
