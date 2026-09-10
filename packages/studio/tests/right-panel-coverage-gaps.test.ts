/**
 * Coverage-gap tests for src/panels/right-panel.ts: the scheduled-render-after-unmount guard and
 * the dock's own render catch.
 *
 * The second one used to be about a throwing style TEMPLATE, which the dock rendered on every
 * repaint inside a `try`. The Style tab is a mounted document now and the dock renders no tab body
 * at all, so the template and its catch are both gone — what survives is the contract they stood
 * for, re-aimed at the seam that replaced them: a tab whose bind throws must not stop the dock's
 * own chrome from drawing, and must not escape as an unhandled error.
 */
import { flush, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let styleThrows = false;
void mock.module("../src/panels/style-panel", () => ({
  /* Only the BIND throws; the unbind (`null`) is what `unmount()` calls, and a teardown that threw
     would fail the afterEach rather than the behaviour under test. */
  bindStyleHost: (el: HTMLElement | null) => {
    if (el && styleThrows) {
      throw new Error("style tab exploded");
    }
  },
}));

// Namespace import: `rightPanel` is a mutable binding populated by initShellRefs in beforeEach.
const store = await import("../src/store");
const { initShellRefs, updateUi } = store;
const { mount, render, unmount } = await import("../src/panels/right-panel");
const { activeTab, closeAllTabs } = await import("../src/workspace/workspace");

// Panel scheduler coalesces via requestAnimationFrame; make it a plain macrotask so a pending
// Frame survives unmount (cancelAnimationFrame cannot cancel a timeout id).
const origRaf = globalThis.requestAnimationFrame;
(globalThis as unknown as Record<string, unknown>).requestAnimationFrame = (
  cb: FrameRequestCallback,
) => setTimeout(() => cb(0), 0) as unknown as number;

function makeCtx() {
  return {
    getCanvasMode: mock(() => "design"),
    mountAssistant: mock(() => {}),
    navigateToComponent: mock(() => {}),
    renderCanvas: mock(() => {}),
  };
}

beforeEach(() => {
  document.body.innerHTML = `<div id="app">
    <div id="toolbar"></div><div id="activity-bar"></div><div id="left-panel"></div>
    <div id="canvas-wrap"></div><div id="right-panel"></div>
    <div id="statusbar"></div>
  </div>`;
  initShellRefs();
  resetStudioState();
  styleThrows = false;
});

afterEach(() => {
  unmount();
  closeAllTabs();
});

describe("right panel gaps", () => {
  test("a frame scheduled before unmount lands harmlessly after it", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render(); // Schedules a flush on the stubbed (uncancelable) frame.
    unmount(); // Nulls the ctx before the frame fires.
    await flush(4);
    expect(store.rightPanel.querySelector("sp-tabs")).toBeNull();
  });

  test("the events tab consults the custom-element predicate once a node is selected", async () => {
    const tab = resetWorkspaceWithTab({
      children: [{ tagName: "button", textContent: "Go" }],
      state: { greet: { $prototype: "Function", body: "return 1" } },
      tagName: "my-widget",
    } as never);
    tab.session.selection = [["children", 0]];
    mount(makeCtx() as never);
    updateUi(activeTab.value, "rightTab", "events");
    render();
    await flush(4);
    const visible = [...store.rightPanel.querySelectorAll(".panel-body")].filter(
      (el) => (el as HTMLElement).style.display !== "none",
    );
    expect(visible).toHaveLength(1);
    // The events body rendered content for the selected node (not the empty state).
    expect(visible[0]!.textContent).not.toContain("Select an element");
  });

  test("a tab that throws while binding is caught, and the dock still draws its chrome", async () => {
    resetWorkspaceWithTab();
    styleThrows = true;
    mount(makeCtx() as never);
    updateUi(activeTab.value, "rightTab", "style");
    render();
    await flush(4);
    // The header and the tab strip are rendered BEFORE the containers are made, so the dock is
    // Still navigable: the reader can leave the tab that failed.
    expect(store.rightPanel.querySelector("sp-tabs")).not.toBeNull();
    expect(store.rightPanel.querySelectorAll("sp-tab")).not.toHaveLength(0);
  });
});

afterEach(() => {
  globalThis.requestAnimationFrame = origRaf;
});
