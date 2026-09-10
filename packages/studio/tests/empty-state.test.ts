/**
 * The shared empty-state VOCABULARY — the words every region inherits rather than re-deciding.
 *
 * The rendering moved out: `tests/empty-state-surface.test.ts` pins what
 * `src/surfaces/empty-state.json` draws from a spec, and each converted panel pins its own
 * `[part="empty"]` block. `renderEmptyState` — the lit template these assertions used to paint — is
 * gone with its last caller, so what is left to hold is the part that was never about drawing: the
 * one verb, the stale-selection sentence, and the one action a region with no open document
 * offers.
 */
import "./with-dom.js";
import { beforeEach, describe, expect, mock, test } from "bun:test";

const openQuickSearch = mock(() => {});
void mock.module("../src/panels/quick-search.js", () => ({
  closeQuickSearch: () => {},
  initQuickSearch: () => {},
  openQuickSearch,
}));

const { CANVAS_VERB, clickAnythingTo, openPageAction, staleSelectionMessage } =
  await import("../src/panels/empty-state");

beforeEach(() => {
  openQuickSearch.mockClear();
});

describe("copy helpers", () => {
  test("clickAnythingTo builds one sentence from the shared verb", () => {
    expect(clickAnythingTo("style it")).toBe("Click anything on the canvas to style it.");
    expect(clickAnythingTo("style it").startsWith(CANVAS_VERB)).toBe(true);
  });

  test("every selection surface phrases its requirement the same way", () => {
    // The regression this guards: Properties said "Select an element to inspect" while Style,
    // Immediately beside it, said "Select an element to style" — two requirements, one need.
    const outcomes = ["edit its content", "style it", "wire it up"].map((outcome) =>
      clickAnythingTo(outcome),
    );
    for (const sentence of outcomes) {
      expect(sentence.startsWith(`${CANVAS_VERB} to `)).toBe(true);
      expect(sentence.endsWith(".")).toBe(true);
    }
  });

  test("staleSelectionMessage names what is gone, then hands back the shared verb", () => {
    const message = staleSelectionMessage();
    expect(message).toContain("no longer on the page");
    expect(message).toContain(CANVAS_VERB);
  });
});

describe("openPageAction", () => {
  test("defaults to one label and runs the open-a-file surface", async () => {
    const action = openPageAction();
    expect(action.label).toBe("Open a page…");
    action.run();
    // The Quick Access module is reached through a lazy import, so the call lands a tick later.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(openQuickSearch).toHaveBeenCalledTimes(1);
  });

  test("accepts a caller-supplied label", () => {
    expect(openPageAction("Open a layout…").label).toBe("Open a layout…");
  });
});
