/**
 * Coverage-gap tests for src/panels/right-panel.ts: the render-after-unmount guard and the boundary
 * around a tab taking its body.
 *
 * Both used to be about a lit repaint. The first was a scheduled animation frame that fired after
 * `unmount()` had nulled the ctx; there is no scheduler any more, so what survives is the contract
 * it stood for — a `render()` after `unmount()` neither throws nor puts the dock back. The second
 * was a throwing style TEMPLATE inside `_doRender`'s `try`; the Style tab is a mounted document and
 * the dock renders no tab body at all, so the same contract is re-aimed at the seam that replaced
 * it — and the seam MOVED, which is why this test matters more than it did. A binder now runs
 * inside the runtime's `onNodeCreated`, where a throw would reject the mount and leave the dock
 * with no chrome at all rather than with one dead tab.
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

function makeCtx() {
  return {
    getCanvasMode: mock(() => "design"),
    mountAssistant: mock(() => {}),
    navigateToComponent: mock(() => {}),
    renderCanvas: mock(() => {}),
  };
}

/** The tab panel that is showing. Exactly one, always. */
function showingPanel(): HTMLElement | null {
  return store.rightPanel.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
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
  test("a render issued around unmount neither throws nor puts the dock back", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx() as never);
    render();
    unmount();
    expect(() => render()).not.toThrow();
    await flush(4);
    expect(store.rightPanel.querySelector('[role="tablist"]')).toBeNull();
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
    const panel = showingPanel();
    expect(panel?.dataset.tab).toBe("events");
    // The events body rendered content for the selected node (not the empty state).
    expect(panel!.textContent).not.toContain("Select an element");
  });

  test("a tab that throws while taking its body cannot stop the dock from drawing", async () => {
    resetWorkspaceWithTab();
    styleThrows = true;
    mount(makeCtx() as never);
    updateUi(activeTab.value, "rightTab", "style");
    render();
    await flush(4);
    /* The dock is still navigable, so the reader can leave the tab that failed — and the OTHER
       three tabs still got their hosts, which is the part the old boundary could not promise:
       `_ensureContainers` built them in a loop and the throw ended it. */
    expect(store.rightPanel.querySelector('[role="tablist"]')).not.toBeNull();
    expect(store.rightPanel.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(store.rightPanel.querySelectorAll('[part="panel-body"]')).toHaveLength(4);
  });
});
