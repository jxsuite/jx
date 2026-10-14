import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { describe, test, expect, spyOn } from "bun:test";
import { reactive, isRef } from "@vue/reactivity";
import { resolvePrototype } from "../src/runtime";

import type { JxScope, JxScopeValue } from "../src/types";

try {
  GlobalRegistrator.register();
} catch {}

const wait = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

describe("resolvePrototype", () => {
  test("Request: returns ref", async () => {
    // Bun's `preconnect` rides along so the stub is a whole `fetch`.
    const { preconnect } = fetch;
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(async () => Response.json({ id: 1 }), { preconnect }),
    );
    const state: JxScope = reactive({});
    const result = await resolvePrototype(
      { $prototype: "Request", url: "/api/test" },
      state,
      "data",
    );
    expect(isRef(result)).toBe(true);
    state.data = result;
    await wait();
    // Read through the proxy, which unwraps the ref: a scope member, whatever was assigned.
    expect(state.data).toEqual<JxScopeValue>({ id: 1 });
  });
});
