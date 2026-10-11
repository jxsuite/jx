/** `src/tabs/typing.ts` — the per-tab "typed since a save kept it" set Save's enablement reads. */
import { describe, expect, test } from "bun:test";
import { effect } from "../src/reactivity";
import { clearTyping, hasTyping, noteTyping } from "../src/tabs/typing";

describe("typing", () => {
  test("a note is per tab, and a clear forgets it", () => {
    expect(hasTyping("a")).toBe(false);
    noteTyping("a");
    expect(hasTyping("a")).toBe(true);
    expect(hasTyping("b")).toBe(false);
    clearTyping("a");
    expect(hasTyping("a")).toBe(false);
  });

  test("an effect reading it re-runs on the first keystroke and on the clear", () => {
    const seen: boolean[] = [];
    const runner = effect(() => {
      seen.push(hasTyping("tracked"));
    });
    noteTyping("tracked");
    // A second note changes nothing, so it re-runs nothing.
    noteTyping("tracked");
    clearTyping("tracked");
    expect(seen).toEqual([false, true, false]);
    runner.effect.stop();
  });
});
