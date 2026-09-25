import "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import { CODE_DEBOUNCE, INPUT_DEBOUNCE, LIVE_PREVIEW, POLL_GIT } from "../src/ui/timing";
import { debouncedStyleCommit } from "../src/store";

// ─── Local helpers ───────────────────────────────────────────────────────────

/**
 * Swap `setTimeout` for a recorder so a delay can be asserted without waiting for it. Returns the
 * list the delays land in; the real timer is restored by the afterEach below.
 */
function recordDelays(): number[] {
  const delays: number[] = [];
  globalThis.setTimeout = ((_fn: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  return delays;
}

const realSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
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
