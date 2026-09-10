import "./harness";
import { describe, expect, test } from "bun:test";
import { clearDraft, hasDraft, scheduleDraftCommit, setDraft } from "../src/ui/field-input";

// ─── Local helpers ───────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ─── Draft-store edge cases ──────────────────────────────────────────────────

describe("draft store edge cases", () => {
  test("clearDraft cancels a pending debounced commit", async () => {
    let calls = 0;
    setDraft("g1", "abc");
    scheduleDraftCommit("g1", 10, () => {
      calls += 1;
    });
    clearDraft("g1");
    await sleep(30);
    expect(calls).toBe(0);
    expect(hasDraft("g1")).toBe(false);
  });

  test("scheduleDraftCommit without a draft is a no-op", async () => {
    let calls = 0;
    clearDraft("g2");
    scheduleDraftCommit("g2", 5, () => {
      calls += 1;
    });
    await sleep(20);
    expect(calls).toBe(0);
  });
});
