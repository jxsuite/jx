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
/** What the dock last handed the Style tab, so a test can ask it whether the tab is showing. */
let styleDeps: { isShowing?: () => boolean } | undefined;
void mock.module("../src/panels/style-panel", () => ({
  /* Only the BIND throws; the unbind (`null`) is what `unmount()` calls, and a teardown that threw
     would fail the afterEach rather than the behaviour under test. */
  bindStyleHost: (el: HTMLElement | null, deps?: { isShowing?: () => boolean }) => {
    if (el && styleThrows) {
      throw new Error("style tab exploded");
    }
    if (el) {
      styleDeps = deps;
    }
  },
}));

// Namespace import: `rightPanel` is a mutable binding populated by initShellRefs in beforeEach.
const store = await import("../src/store");
const { initShellRefs, updateUi } = store;
const { mount, render, unmount } = await import("../src/panels/right-panel");
const { activeTab, closeAllTabs } = await import("../src/workspace/workspace");

/** The shell's Inspector cell, which `initShellRefs()` found in `beforeEach`. */
function inspectorHost(): HTMLElement {
  return store.requireShellRef(store.rightPanel, "right-panel");
}

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
  return inspectorHost().querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
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
  test("the Style tab is told it is showing only while it is the selected tab", async () => {
    // A hidden Style tab skips its projection, which rebuilt thousands of nodes per selection.
    resetWorkspaceWithTab();
    activeTab.value!.session.ui.rightTab = "style";
    mount(makeCtx());
    await flush(4);
    const isShowing = styleDeps?.isShowing;
    expect(isShowing).toBeDefined();
    activeTab.value!.session.ui.rightTab = "properties";
    expect(isShowing?.()).toBe(false);
    activeTab.value!.session.ui.rightTab = "style";
    expect(isShowing?.()).toBe(true);
  });

  test("a render issued around unmount neither throws nor puts the dock back", async () => {
    resetWorkspaceWithTab();
    mount(makeCtx());
    render();
    unmount();
    expect(() => render()).not.toThrow();
    await flush(4);
    expect(inspectorHost().querySelector('[role="tablist"]')).toBeNull();
  });

  test("the events tab consults the custom-element predicate once a node is selected", async () => {
    const tab = resetWorkspaceWithTab({
      children: [{ tagName: "button", textContent: "Go" }],
      state: { greet: { $prototype: "Function", body: "return 1" } },
      tagName: "my-widget",
    });
    tab.session.selection = [["children", 0]];
    mount(makeCtx());
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
    mount(makeCtx());
    updateUi(activeTab.value, "rightTab", "style");
    render();
    await flush(4);
    /* The dock is still navigable, so the reader can leave the tab that failed — and the OTHER
       three tabs still got their hosts, which is the part the old boundary could not promise:
       `_ensureContainers` built them in a loop and the throw ended it. */
    expect(inspectorHost().querySelector('[role="tablist"]')).not.toBeNull();
    expect(inspectorHost().querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(inspectorHost().querySelectorAll('[part="panel-body"]')).toHaveLength(4);
  });
});
