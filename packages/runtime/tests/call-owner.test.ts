import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { describe, expect, test } from "bun:test";
import { reactive } from "@vue/reactivity";
import { evaluateExpression } from "../src/expression";
import { runStatements } from "../src/statements";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const ref = (pointer: string) => ({ $ref: pointer });

describe("call binds the receiver the pointer's parent names", () => {
  test("a nested pointer is owned by its parent object", () => {
    const state = reactive({
      svc: {
        n: 2,
        double(this: { n: number }) {
          return this.n * 2;
        },
      },
    });
    expect(
      evaluateExpression(
        { operator: "call", target: ref("#/state/svc/double"), value: [] },
        state,
        null,
      ),
    ).toBe(4);
  });

  test("a scope-level function is owned by the scope, as the compiled lowering binds it", () => {
    const state = reactive({
      k: 3,
      read(this: { k: number }) {
        return this.k;
      },
    });
    expect(
      evaluateExpression({ operator: "call", target: ref("#/state/read"), value: [] }, state, null),
    ).toBe(3);
  });

  test("a $map item's method is owned by the item", () => {
    const state = reactive({
      $map: {
        item: {
          v: 5,
          read(this: { v: number }) {
            return this.v;
          },
        },
      },
    });
    expect(
      evaluateExpression(
        { operator: "call", target: ref("$map/item/read"), value: [] },
        state,
        null,
      ),
    ).toBe(5);
  });

  test("a pointer with no parent segment has no receiver", () => {
    const state = reactive({});
    const seen = evaluateExpression(
      { operator: "call", target: ref("$args/fn"), value: [] },
      state,
      null,
      {
        args: {
          fn(this: unknown) {
            return this;
          },
        },
      },
    );
    expect(seen).toBeUndefined();
  });

  test("a pointer in a scheme the owner rule does not know binds no receiver", () => {
    /*
     * `event#/` resolves through the event rather than the scope, and calleeOwner has no rule for
     * it. The callee still resolved, so the call must go ahead — with no `this` at all, rather than
     * the scope, the event, or a throw.
     */
    const seen: unknown[] = [];
    const event = new CustomEvent("go", {
      detail: {
        fn(this: unknown, ...args: unknown[]) {
          seen.push(this, ...args);
          return "ran";
        },
      },
    });
    expect(
      evaluateExpression(
        { operator: "call", target: ref("event#/detail/fn"), value: [1] },
        reactive({}),
        event,
      ),
    ).toBe("ran");
    expect(seen).toEqual([undefined, 1]);
  });

  test("a parent-scope prop's method is owned by the prop", () => {
    const state = reactive({
      user: {
        name: "Ada",
        greet(this: { name: string }, punctuation: string) {
          return `hi ${this.name}${punctuation}`;
        },
      },
    });
    expect(
      evaluateExpression(
        { operator: "call", target: ref("parent#/user/greet"), value: ["!"] },
        state,
        null,
      ),
    ).toBe("hi Ada!");
  });
});

describe("runStatements dispatch target", () => {
  test("a thunk target is read at dispatch time when there is no event", async () => {
    const el = document.createElement("div");
    const details: unknown[] = [];
    el.addEventListener("ping", (e) => {
      details.push((e as CustomEvent).detail);
    });
    await runStatements([{ dispatchEvent: "ping", detail: 1 }], reactive({}), null, {
      target: () => el,
    });
    expect(details).toEqual([1]);
  });

  test("a thunk that yields nothing dispatches nothing", async () => {
    expect(
      await runStatements([{ dispatchEvent: "ping" }], reactive({}), null, { target: () => null }),
    ).toBeUndefined();
  });

  test("an event's own currentTarget wins over the option", async () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const hits: string[] = [];
    a.addEventListener("out", () => hits.push("a"));
    b.addEventListener("out", () => hits.push("b"));
    a.addEventListener("go", (e) => {
      void runStatements([{ dispatchEvent: "out" }], reactive({}), e, { target: () => b });
    });
    a.dispatchEvent(new Event("go"));
    await Promise.resolve();
    expect(hits).toEqual(["a"]);
  });
});
