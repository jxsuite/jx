/**
 * Src/services/harness/interaction-store.ts — where a turn waits on the author (specs/ai.md §3.4,
 * specs/ai.md §3.11): the four ways a pending question settles, and Stop reaching it through the
 * call's signal.
 */
import { describe, expect, test } from "bun:test";
import type { InteractionRequest } from "@jxsuite/ai/tools";
import { createInteractionStore } from "../src/services/harness/interaction-store";
import type { InteractionStore } from "../src/services/harness/interaction-store";

const QUESTION: InteractionRequest = {
  context: "",
  kind: "question",
  options: [],
  question: "Which?",
};

function put(store: InteractionStore, request = QUESTION, signal = new AbortController().signal) {
  if (store.strategy.mode !== "inline") {
    throw new Error("the store resolves inline");
  }
  return store.strategy.resolve(request, { callId: "call_1", signal });
}

describe("the interaction store", () => {
  test("holds a request until it is answered, then lets go of it", async () => {
    const store = createInteractionStore();
    const answering = put(store);
    expect(store.pending).toEqual({ callId: "call_1", request: QUESTION });
    expect(store.answer("This one")).toBe(true);
    expect(await answering).toEqual({ answer: "This one", kind: "question", skipped: false });
    expect(store.pending).toBeNull();
  });

  test("a skip settles as skipped, not as an answer", async () => {
    const store = createInteractionStore();
    const answering = put(store);
    expect(store.skip()).toBe(true);
    expect(await answering).toEqual({ answer: null, kind: "question", skipped: true });
  });

  test("cancel and reset settle as neither answered nor skipped", async () => {
    for (const settle of ["cancel", "reset"] as const) {
      const store = createInteractionStore();
      const answering = put(store);
      store[settle]();
      expect(await answering).toEqual({ answer: null, kind: "question", skipped: false });
      expect(store.pending).toBeNull();
    }
  });

  test("answering, skipping and cancelling with nothing pending are no-ops", () => {
    const store = createInteractionStore();
    expect(store.answer("x")).toBe(false);
    expect(store.skip()).toBe(false);
    store.cancel();
    expect(store.pending).toBeNull();
  });

  test("the host hears when a request is put, before the turn waits on it", async () => {
    const seen: (string | null)[] = [];
    const store = createInteractionStore({
      onPending: () => seen.push(store.pending?.callId ?? null),
    });
    const answering = put(store);
    expect(seen).toEqual(["call_1"]);
    store.answer("yes");
    await answering;
    expect(seen).toHaveLength(1);
  });

  test("a turn stopped before the request is put settles it at once, unheard", async () => {
    let heard = 0;
    const store = createInteractionStore({ onPending: () => (heard += 1) });
    const controller = new AbortController();
    controller.abort();
    expect(await put(store, QUESTION, controller.signal)).toEqual({
      answer: null,
      kind: "question",
      skipped: false,
    });
    expect([store.pending, heard]).toEqual([null, 0]);
  });

  test("stopping the turn settles the pending request", async () => {
    const store = createInteractionStore();
    const controller = new AbortController();
    const answering = put(store, QUESTION, controller.signal);
    controller.abort();
    expect(await answering).toEqual({ answer: null, kind: "question", skipped: false });
    expect(store.pending).toBeNull();
  });

  test("an answered request stops listening to its turn's signal", async () => {
    const store = createInteractionStore();
    const controller = new AbortController();
    const answering = put(store, QUESTION, controller.signal);
    store.answer("first");
    await answering;
    // The next request is not the one the old signal belonged to.
    const next = put(store);
    controller.abort();
    expect(store.pending).not.toBeNull();
    store.answer("second");
    expect(await next).toMatchObject({ answer: "second" });
  });

  test("an approval the turn's stop settles is refused", async () => {
    const store = createInteractionStore();
    const approving = put(store, {
      kind: "approval",
      reason: "destructive",
      summary: "Delete it",
      title: "Delete",
      tool: "delete_node",
    });
    store.cancel();
    expect(await approving).toEqual({ approved: false, kind: "approval" });
  });
});
