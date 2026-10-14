import "./harness";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { CODE_DEBOUNCE, INPUT_DEBOUNCE, LIVE_PREVIEW, POLL_GIT } from "../src/ui/timing";
import { debouncedStyleCommit } from "../src/store";

// ─── Local helpers ───────────────────────────────────────────────────────────

const realSetTimeout = globalThis.setTimeout;

/**
 * Swap `setTimeout` for a recorder so a delay can be asserted without waiting for it. Returns the
 * list the delays land in; the scheduled callback never runs (the handle returned belongs to an
 * inert no-op timer), and the real timer is restored by the afterEach below.
 */
function recordDelays(): number[] {
  const delays: number[] = [];
  const recorder = (_callback: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    return realSetTimeout(() => {}, 0);
  };
  /* SAFETY: The recorder implements the one call shape the code under test makes,
     `setTimeout(callback, delay)` in `debouncedStyleCommit`, and answers it with a real timer
     handle; the overloads it lacks (extra callback arguments, a string handler, `__promisify__`)
     are never reached before the afterEach restores the real function. */
  spyOn(globalThis, "setTimeout").mockImplementation(recorder as typeof setTimeout);
  return delays;
}

afterEach(() => {
  mock.restore();
});

// ─── The constants themselves ────────────────────────────────────────────────

describe("timing constants", () => {
  test("the two debounces match the specs/studio-ui-guidelines.md §4.4 contract", () => {
    expect(INPUT_DEBOUNCE).toBe(400);
    expect(CODE_DEBOUNCE).toBe(500);
  });

  test("the remaining constants hold their shipped values", () => {
    expect(LIVE_PREVIEW).toBe(350);
    expect(POLL_GIT).toBe(30_000);
  });

  test("the ordering invariants hold", () => {
    // A provisional draft commit fires before a committing input; code waits longest of the three.
    expect(LIVE_PREVIEW).toBeLessThan(INPUT_DEBOUNCE);
    expect(INPUT_DEBOUNCE).toBeLessThan(CODE_DEBOUNCE);
    // The git poll must outlive every input debounce: a tick mid-edit buys nothing and costs I/O.
    expect(CODE_DEBOUNCE).toBeLessThan(POLL_GIT);
  });
});

// ─── The migrated call sites ─────────────────────────────────────────────────

describe("migrated consumers", () => {
  test("debouncedStyleCommit falls back to INPUT_DEBOUNCE when no delay is given", () => {
    const delays = recordDelays();
    debouncedStyleCommit("timing:default", undefined, () => {})();
    expect(delays).toEqual([INPUT_DEBOUNCE]);
  });

  test("debouncedStyleCommit still honours an explicit delay", () => {
    const delays = recordDelays();
    debouncedStyleCommit("timing:explicit", 42, () => {})();
    expect(delays).toEqual([42]);
  });
});
