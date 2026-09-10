/**
 * Coverage-gap tests for src/panels/block-action-bar.ts:
 *
 * - OnCanvasScroll guards (no ctx / open link popover / no selection)
 * - The reposition fast path resurrecting a missing bar
 * - Anchor-out-of-canvas hiding via barPosition + canvasWrap bounds
 * - Window-edge clamping
 * - Bar mousedown skipping the link panel
 * - IsLinkPopoverOpen()
 * - Stale Move up/down clicks after the selection is gone
 * - The drag handle's onGenerateDragPreview suppressor
 */
import { flush, registerPrimaryStage, resetWorkspaceWithTab, stubRect } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { JxPath } from "../src/state";
import {
  registerCanvasSurface,
  surfaceForPane,
  unregisterCanvasSurface,
} from "../src/canvas/surface-registry";

type AnyRec = Record<string, any>;

const draggables: AnyRec[] = [];
let previewsDisabled = 0;

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: (cfg: AnyRec) => {
    draggables.push(cfg);
    return () => {};
  },
}));
void mock.module("@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview", () => ({
  disableNativeDragPreview: () => {
    previewsDisabled += 1;
  },
}));

const host: {
  anchor: { left: number; top: number; width: number; height: number } | null;
  editing: boolean;
  posted: AnyRec[];
} = { anchor: null, editing: false, posted: [] };

void mock.module("../src/canvas/iframe-host", () => ({
  getEditBarAnchorRect: () => host.anchor,
  getEditSnapshot: () => ({ editing: host.editing, editingProp: null, snapshot: null }),
  postApplyFormat: (intent: AnyRec) => host.posted.push(intent),
  requestCanvasEval: () => Promise.resolve(null),
}));

const {
  dismissBlockActionBar,
  dismissLinkPopover,
  initBlockActionBar,
  isLinkPopoverOpen,
  onCanvasScroll,
  openLinkPopoverFromShortcut,
  renderBlockActionBar,
} = await import("../src/panels/block-action-bar");
const { initLayers } = await import("../src/ui/layers");
// Namespace import: `canvasWrap` is a mutable binding populated by initShellRefs below.
const store = await import("../src/store");
const { view } = await import("../src/view");
const { PRIMARY_PANE, SECONDARY_PANE, closeAllTabs, focusPane, openTab, splitRight } =
  await import("../src/workspace/workspace");
const { applyDerivation, noopDerivationDeps, setPaneDerivation } =
  await import("../src/workspace/pane-derive");
const { surfacesShowingTab } = await import("../src/canvas/canvas-surface");

document.body.innerHTML = `<div id="app">
  <div id="toolbar"></div><div id="activity-bar"></div><div id="left-panel"></div>
  <div class="pane-stage" data-jx-region="pane.primary"></div><div id="right-panel"></div><div id="chat-panel"></div>
  <div id="statusbar"></div>
  <div id="layer-popover"></div><div id="layer-modal"></div><div id="layer-dialog"></div>
</div>`;
initLayers();
store.initShellRefs();
registerPrimaryStage();

let canvasMode = "design";

function setup(docNode: JxMutableNode, selection: JxPath | null) {
  const tab = resetWorkspaceWithTab(docNode);
  tab.session.selection = selection ? [selection] : [];
  host.anchor = { height: 20, left: 30, top: 200, width: 100 };
  return tab;
}

function bar(): HTMLElement | null {
  return (view.blockActionBarEl?.querySelector('[part="bar"]') as HTMLElement) ?? null;
}

/** Render, then let the document reconcile: the bar is a mount, not a synchronous template. */
async function render(): Promise<void> {
  renderBlockActionBar();
  await flush(3);
}

/** Whether the bar is hidden because its anchor left the stage. */
function isOffscreen(): boolean {
  return bar()!.dataset.offscreen !== undefined;
}

/** The bar's placed edges, as the two custom properties the document's `left`/`top` read. */
function barAt(): [string, string] {
  const el = bar()!;
  return [
    el.style.getPropertyValue("--jx-bar-x").trim(),
    el.style.getPropertyValue("--jx-bar-y").trim(),
  ];
}

const raf = () =>
  new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });

const scrollDoc = () => {
  const e = new Event("scroll");
  Object.defineProperty(e, "target", { configurable: true, value: document });
  onCanvasScroll(e);
};

describe("onCanvasScroll guards (pre-init)", () => {
  test("scrolls before initBlockActionBar are ignored", () => {
    expect(() => {
      scrollDoc();
    }).not.toThrow();
    expect(bar()).toBeNull();
  });
});

describe("block action bar gaps", () => {
  beforeEach(async () => {
    initBlockActionBar({
      getCanvasMode: () => canvasMode,
      navigateToComponent: () => {},
    });
    canvasMode = "design";
    host.editing = false;
    host.posted = [];
    draggables.length = 0;
    previewsDisabled = 0;
    dismissLinkPopover();
    dismissBlockActionBar();
    await flush();
    // Reset canvas-wrap geometry to a tall area so barPosition's bounds check stays inert
    // Unless a test narrows it deliberately.
    stubRect(surfaceForPane("primary").wrap, { height: 2000, left: 0, top: 0, width: 1600 });
  });

  test("scrolls without a selection are ignored", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, null);
    expect(() => {
      scrollDoc();
    }).not.toThrow();
    expect(bar()).toBeNull();
  });

  test("scrolls while the link popover is open never reposition (typed URL survives)", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    host.editing = true;
    await render();
    expect(bar()).toBeTruthy();
    openLinkPopoverFromShortcut();
    await flush(2);
    expect(isLinkPopoverOpen()).toBe(true);
    const before = barAt();
    host.anchor = { height: 20, left: 90, top: 900, width: 100 };
    scrollDoc();
    await raf();
    await flush();
    expect(barAt()).toEqual(before);
    dismissLinkPopover();
    expect(isLinkPopoverOpen()).toBe(false);
  });

  test("a scroll with no live bar falls back to a full render", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    expect(bar()).toBeNull();
    scrollDoc();
    await raf();
    await flush(3);
    expect(bar()).toBeTruthy();
  });

  /* THE STAGE THE CARET IS ON, which with a derived pane is not the same as "the stage showing
     the active tab". A lens displays the document its source pane owns, so `surfacesShowingTab`
     answers with BOTH — and taking the first clips the bar against whichever pane comes earlier in
     the grid. The author typing in the side pane then loses the bar whenever their caret sits
     outside the primary's viewport, which is most of the time once the two stages have scrolled
     apart. Two rects, one per stage, and the anchor is inside exactly one of them. */
  test("the bar is clipped against the FOCUSED pane's stage, not the first one showing the tab", async () => {
    const tab = setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, [
      "children",
      0,
    ]);
    openTab({ document: { tagName: "div" }, documentPath: "scratch.json", id: "scratch.json" });
    expect(splitRight()?.id).toBe(SECONDARY_PANE);
    setPaneDerivation(SECONDARY_PANE, {
      diff: null,
      kind: "lens",
      media: null,
      mode: "design",
      preset: "breakpoint",
      reason: "",
      sourcePaneId: PRIMARY_PANE,
      status: "ready",
      zoom: 1,
    });
    applyDerivation(SECONDARY_PANE, noopDerivationDeps());
    focusPane(SECONDARY_PANE);
    expect(surfacesShowingTab(tab).map((s) => s.paneId)).toEqual([PRIMARY_PANE, SECONDARY_PANE]);

    // A stage of its own for the lens — two live hosts is the configuration under test.
    const sideStage = document.createElement("div");
    document.body.append(sideStage);
    registerCanvasSurface(SECONDARY_PANE, sideStage);
    // The primary is scrolled somewhere else entirely; the lens is where the caret is.
    stubRect(surfaceForPane(PRIMARY_PANE).wrap, { height: 100, left: 0, top: 0, width: 1600 });
    stubRect(sideStage, { height: 800, left: 0, top: 100, width: 1600 });
    host.anchor = { height: 20, left: 30, top: 400, width: 100 };

    await render();

    expect(bar()).toBeTruthy();
    expect(isOffscreen()).toBe(false);
    unregisterCanvasSurface(SECONDARY_PANE);
    sideStage.remove();
  });

  test("an anchor scrolled out of the canvas area hides the bar", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    stubRect(surfaceForPane("primary").wrap, { height: 400, left: 0, top: 100, width: 1600 });
    await render();
    expect(bar()).toBeTruthy();

    // Below the canvas area → reposition hides it without tearing the bar down.
    host.anchor = { height: 20, left: 30, top: 900, width: 100 };
    scrollDoc();
    await raf();
    await flush();
    expect(isOffscreen()).toBe(true);

    // Above the canvas area → same.
    host.anchor = { height: 20, left: 30, top: 10, width: 100 };
    scrollDoc();
    await raf();
    await flush();
    expect(isOffscreen()).toBe(true);

    // Back inside → visible again.
    host.anchor = { height: 20, left: 30, top: 250, width: 100 };
    scrollDoc();
    await raf();
    await flush();
    expect(isOffscreen()).toBe(false);
  });

  test("a bar wider than the window is clamped back inside the right edge", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await render();
    const el = bar()!;
    stubRect(el, { height: 30, left: window.innerWidth - 10, top: 200, width: 300 });
    host.anchor = { height: 20, left: window.innerWidth - 10, top: 300, width: 100 };
    scrollDoc();
    await raf();
    await flush();
    await raf();
    // The clamp writes the same custom property the document's `left` reads, so the next repaint
    // That re-projects the anchor overwrites it rather than fighting it.
    expect(el.style.getPropertyValue("--jx-bar-x").trim()).toBe(
      `${Math.max(0, window.innerWidth - 300)}px`,
    );
  });

  test("mousedown inside the link panel is not focus-guarded", async () => {
    /* The exemption the `sp-textfield` one stood for: a URL field a press cannot reach is a field
       nobody can type in. It is addressed by PART now, because the panel is the bar's own
       `jx-popover` rather than a foreign control someone appended to the bar. */
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    host.editing = true;
    await render();
    openLinkPopoverFromShortcut();
    await flush(2);
    const field = bar()!.querySelector('[part="link-field"]')!;
    const e = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    field.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);

    // A plain bar press IS prevented (keeps the iframe selection).
    const e2 = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    bar()!.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(true);
    dismissLinkPopover();
  });

  test("stale Move up/down clicks after the selection clears are no-ops", async () => {
    const tab = setup(
      {
        children: [
          { tagName: "p", textContent: "a" },
          { tagName: "p", textContent: "b" },
          { tagName: "p", textContent: "c" },
        ],
        tagName: "div",
      },
      ["children", 1],
    );
    await render();
    const press = (id: string) =>
      bar()!
        .querySelector(`[data-command-id="${id}"] [part="control"]`)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const before = JSON.stringify(tab.doc.document);
    tab.session.selection = [];
    press("selection.moveUp");
    press("selection.moveDown");
    expect(JSON.stringify(tab.doc.document)).toBe(before);
  });

  test("the drag handle registers a draggable that suppresses the native preview", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await render();
    expect(draggables.length).toBeGreaterThan(0);
    const handle = draggables.at(-1)!;
    expect(handle.getInitialData()).toEqual({ path: ["children", 0], type: "tree-node" });
    handle.onGenerateDragPreview({ nativeSetDragImage: null });
    expect(previewsDisabled).toBe(1);
  });

  test("hiding and drawing again replaces the registration through the cleanup seam", async () => {
    setup({ children: [{ tagName: "p", textContent: "hi" }], tagName: "div" }, ["children", 0]);
    await render();
    const first = draggables.length;
    expect(view.selDragCleanup).not.toBeNull();

    // A repaint keeps the node and the one registration on it; only a teardown replaces them.
    await render();
    expect(draggables.length).toBe(first);

    dismissBlockActionBar();
    await flush();
    expect(view.selDragCleanup).toBeNull();
    await render();
    expect(draggables.length).toBe(first + 1);
    expect(view.selDragCleanup).not.toBeNull();
    closeAllTabs();
  });
});
