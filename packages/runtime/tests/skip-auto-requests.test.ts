/**
 * `setSkipAutoRequests` — the edit-mode gate on automatic `$prototype: "Request"` fetches, sibling
 * of `setSkipServerFunctions`. Studio's `buildScope` re-resolves every `state` entry on each full
 * canvas render, so without this an authoring action that escalates to a full render issued an HTTP
 * request every time.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { isRef, reactive } from "@vue/reactivity";
import { resolvePrototype, setSkipAutoRequests } from "../src/runtime";
import type { JxScope, JxScopeValue } from "../src/types";

try {
  GlobalRegistrator.register();
} catch {}

const wait = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/** Answer every `fetch` with `{ id: 1 }`, keeping Bun's `preconnect` so the stub is a whole `fetch`. */
function stubFetch() {
  const { preconnect } = fetch;
  const fetchMock = mock(() => Promise.resolve(Response.json({ id: 1 })));
  global.fetch = Object.assign(fetchMock, { preconnect });
  return fetchMock;
}

afterEach(() => {
  setSkipAutoRequests(false);
});

describe("setSkipAutoRequests", () => {
  test("suppresses the fetch for an automatic request, still returning a ref", async () => {
    const fetchMock = stubFetch();
    setSkipAutoRequests(true);
    const state = reactive<JxScope>({});
    const result = await resolvePrototype(
      { $prototype: "Request", url: "/api/test" },
      state,
      "data",
    );

    // The scope shape is unchanged — the ref simply stays at its pre-fetch value, which is exactly
    // What bindings observe before any real fetch resolves.
    expect(isRef(result)).toBe(true);
    state.data = result;
    await wait();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.data).toBeNull();
  });

  test("re-resolving many times issues no requests while gated", async () => {
    const fetchMock = stubFetch();
    setSkipAutoRequests(true);
    const state = reactive<JxScope>({});
    const results: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const result = await resolvePrototype(
        { $prototype: "Request", url: "/api/test" },
        state,
        "data",
      );
      results.push(result);
    }
    await wait();
    expect(fetchMock).not.toHaveBeenCalled();
    // Every re-resolution handed back a ref that is still parked at its pre-fetch value.
    expect(results.map((r) => (isRef(r) ? r.value : r))).toEqual([null, null, null, null, null]);
  });

  test("fetches again once the gate is lifted (preview mode)", async () => {
    const fetchMock = stubFetch();
    setSkipAutoRequests(false);
    const state = reactive<JxScope>({});
    const result = await resolvePrototype(
      { $prototype: "Request", url: "/api/test" },
      state,
      "data",
    );
    state.data = result;
    await wait();
    expect(fetchMock).toHaveBeenCalled();
    // Read through the proxy, which unwraps the ref: a scope member, whatever was assigned.
    expect(state.data).toEqual<JxScopeValue>({ id: 1 });
  });

  test("leaves manual requests alone — they never auto-fetch in either mode", async () => {
    const fetchMock = stubFetch();
    setSkipAutoRequests(true);
    const state = reactive<JxScope>({});
    const gated = await resolvePrototype(
      { $prototype: "Request", manual: true, url: "/api/test" },
      state,
      "data",
    );
    setSkipAutoRequests(false);
    const ungated = await resolvePrototype(
      { $prototype: "Request", manual: true, url: "/api/test" },
      state,
      "data",
    );
    await wait();
    expect(isRef(gated)).toBe(true);
    expect(isRef(ungated)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
