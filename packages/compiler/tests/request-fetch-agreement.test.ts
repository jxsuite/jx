/**
 * Request-fetch-agreement.test.ts — the compiled `Request` fetch and the interpreter's agree.
 *
 * Asserting on emitted text alone let the two tiers diverge (the compiled one had no debounce and
 * no abort). Here the same scenario drives `resolvePrototype` and the block `emitRequestFetch`
 * emits, against a stubbed `fetch`, and what each did is compared (spec.md §11.2).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { resolvePrototype } from "@jxsuite/runtime";
import type { JsonValue, JxPrototypeDef } from "@jxsuite/schema/types";
import { effect, isRef, onEffectCleanup, reactive, stop, toRaw } from "@vue/reactivity";
import { emitRequestFetch } from "../src/shared.ts";

/** One call the stub saw, held open until the test settles it. */
interface Call {
  url: string;
  method: string;
  headers: unknown;
  body: unknown;
  signal: AbortSignal;
  respond: (status: number, json: JsonValue) => void;
  fail: (error: Error) => void;
}

/** What a tier did: every call (aborted or not), and every value the entry took. */
interface Trace {
  calls: { url: string; method: string; headers: unknown; body: unknown; aborted: boolean }[];
  values: JsonValue[];
}

interface Harness {
  state: Record<string, JsonValue | undefined>;
  calls: Call[];
  runners: ReturnType<typeof effect>[];
}

type Tier = "runtime" | "compiled";

const realFetch = globalThis.fetch;
const DELAY = 20;
const WAIT = 60;
const wait = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

/** A plain copy of a reactive value, so the trace holds what was written and not a live proxy. */
const snapshot = (v: JsonValue | undefined): JsonValue =>
  v === undefined ? null : structuredClone(toRaw(v));

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replace `fetch` with a stub that records each call and rejects with the signal's reason on abort. */
function stubFetch(calls: Call[]) {
  // SAFETY: the stub takes the one call shape the emitted code and the interpreter both make.
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        throw new Error("fetch was called without a signal");
      }
      calls.push({
        body: init.body,
        fail: reject,
        headers: init.headers,
        method: init.method ?? "GET",
        respond: (status, json) => {
          resolve(Response.json(json, { status, statusText: status === 200 ? "OK" : "Not Found" }));
        },
        signal,
        url: String(input),
      });
      signal.addEventListener("abort", () => {
        reject(signal.reason);
      });
    })) as typeof fetch;
}

/** Run `script` against one tier and report what it did. */
async function drive(
  tier: Tier,
  def: JxPrototypeDef,
  initial: Record<string, JsonValue>,
  script: (h: Harness) => Promise<void>,
): Promise<Trace> {
  const calls: Call[] = [];
  stubFetch(calls);
  // SAFETY: `reactive` types the object it was given; the scenario writes only JSON values to it.
  const state = reactive<object>({ ...initial, r: null }) as Harness["state"];
  const runners: Harness["runners"] = [];
  const values: JsonValue[] = [];

  if (tier === "runtime") {
    const entry = await resolvePrototype(def, state, "r");
    if (!isRef(entry)) {
      throw new Error("Expected a Request entry to resolve to a ref");
    }
    // SAFETY: a Request entry's ref holds the JSON body, or the `{ error }` object.
    runners.push(effect(() => values.push(snapshot(entry.value as JsonValue))));
  } else {
    // oxlint-disable-next-line no-new-func -- evaluating the emitted artefact IS the assertion here.
    const run = new Function(
      "state",
      "effect",
      "onEffectCleanup",
      "_runners",
      emitRequestFetch("r", def, { collect: "_runners" }),
    );
    run(state, effect, onEffectCleanup, runners);
    runners.push(effect(() => values.push(snapshot(state.r))));
  }

  await script({ calls, runners, state });
  // Read before the runners stop: stopping aborts the compiled tier's last fetch, and the
  // Interpreter never stops its effect (it aborts on a re-run only).
  const trace: Trace = {
    calls: calls.map((c) => ({
      aborted: c.signal.aborted,
      body: c.body,
      headers: c.headers,
      method: c.method,
      url: c.url,
    })),
    values,
  };
  for (const runner of runners) {
    stop(runner);
  }
  return trace;
}

/** Both tiers on one scenario: they agree, and the shared answer is returned. */
async function both(
  def: JxPrototypeDef,
  initial: Record<string, JsonValue>,
  script: (h: Harness) => Promise<void>,
): Promise<Trace> {
  const runtime = await drive("runtime", def, initial, script);
  const compiled = await drive("compiled", def, initial, script);
  expect(compiled).toEqual(runtime);
  return compiled;
}

const req = (extra: Partial<JxPrototypeDef> = {}): JxPrototypeDef => ({
  $prototype: "Request",
  url: "/api/${state.q}",
  ...extra,
});

describe("compiled Request agrees with the interpreter", () => {
  test("a static url fetches once and assigns the body", async () => {
    const trace = await both({ $prototype: "Request", url: "/api/x" }, {}, async (h) => {
      await wait(5);
      h.calls[0]!.respond(200, { v: "a" });
      await wait(5);
    });
    expect(trace.calls.map((c) => c.url)).toEqual(["/api/x"]);
    expect(trace.values).toEqual([null, { v: "a" }]);
  });

  test("a change aborts the fetch it replaces and only the newer body lands", async () => {
    const trace = await both(req(), { q: "a" }, async (h) => {
      await wait(5);
      h.state.q = "b";
      await wait(5);
      h.calls[1]!.respond(200, { v: "b" });
      await wait(5);
    });
    expect(trace.calls.map((c) => [c.url, c.aborted])).toEqual([
      ["/api/a", true],
      ["/api/b", false],
    ]);
    expect(trace.values).toEqual([null, { v: "b" }]);
  });

  test("an aborted fetch writes no error", async () => {
    const trace = await both(req(), { q: "a" }, async (h) => {
      await wait(5);
      h.state.q = "b";
      await wait(WAIT / 3);
    });
    expect(trace.values).toEqual([null]);
  });

  test("a url that interpolates undefined is not fetched, and changing to one aborts the fetch in flight", async () => {
    const trace = await both(req(), {}, async (h) => {
      await wait(5);
      h.state.q = "a";
      await wait(5);
      h.state.q = undefined;
      await wait(5);
    });
    expect(trace.calls.map((c) => [c.url, c.aborted])).toEqual([["/api/a", true]]);
    expect(trace.values).toEqual([null]);
  });

  test("a failed response and a network error are written as { error }", async () => {
    const failed = await both(req(), { q: "a" }, async (h) => {
      await wait(5);
      h.calls[0]!.respond(404, {});
      await wait(5);
    });
    expect(failed.values).toEqual([null, { error: "Not Found" }]);

    const network = await both(req(), { q: "a" }, async (h) => {
      await wait(5);
      h.calls[0]!.fail(new TypeError("Failed to fetch"));
      await wait(5);
    });
    expect(network.values).toEqual([null, { error: "TypeError: Failed to fetch" }]);
  });

  test("debounce delays the first fetch", async () => {
    const seen: number[] = [];
    const trace = await both(req({ debounce: DELAY }), { q: "a" }, async (h) => {
      await wait(DELAY / 2);
      seen.push(h.calls.length);
      await wait(WAIT);
      seen.push(h.calls.length);
    });
    expect(seen.slice(-2)).toEqual([0, 1]);
    expect(trace.calls.map((c) => c.url)).toEqual(["/api/a"]);
  });

  test("a change inside the delay restarts it", async () => {
    const trace = await both(req({ debounce: DELAY }), { q: "a" }, async (h) => {
      await wait(DELAY / 2);
      h.state.q = "b";
      await wait(WAIT);
    });
    expect(trace.calls.map((c) => c.url)).toEqual(["/api/b"]);
  });

  test("method, headers and body reach fetch beside the signal", async () => {
    const trace = await both(
      {
        $prototype: "Request",
        body: { n: 1 },
        headers: { "X-A": "1" },
        method: "POST",
        url: "/api/x",
      },
      {},
      async () => {
        await wait(5);
      },
    );
    expect(trace.calls[0]).toEqual({
      aborted: false,
      body: '{"n":1}',
      headers: { "X-A": "1" },
      method: "POST",
      url: "/api/x",
    });
  });
});

describe("compiled Request teardown", () => {
  /** Run the compiled block alone, so the test owns `stop()`. */
  function compiled(def: JxPrototypeDef) {
    const calls: Call[] = [];
    stubFetch(calls);
    // SAFETY: `reactive` types the object it was given; the scenario writes only JSON values to it.
    const state = reactive<object>({ q: "a", r: null }) as Harness["state"];
    const runners: ReturnType<typeof effect>[] = [];
    // oxlint-disable-next-line no-new-func -- evaluating the emitted artefact IS the assertion here.
    const run = new Function(
      "state",
      "effect",
      "onEffectCleanup",
      "_runners",
      emitRequestFetch("r", def, { collect: "_runners" }),
    );
    run(state, effect, onEffectCleanup, runners);
    return { calls, runners, state };
  }

  test("stop() aborts the fetch in flight", async () => {
    const { calls, runners, state } = compiled(req());
    await wait(5);
    stop(runners[0]!);
    await wait(5);
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(state.r).toBeNull();
  });

  test("stop() cancels a pending delay", async () => {
    const { calls, runners } = compiled(req({ debounce: DELAY }));
    await wait(DELAY / 2);
    stop(runners[0]!);
    await wait(WAIT);
    expect(calls).toHaveLength(0);
  });
});
