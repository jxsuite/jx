/**
 * Overlays panel — the iframe canvas owns hit-testing and draws its own hover/selection boxes
 * inside each host's overlay layer, so this panel is a thin reactive delegate: it keeps
 * panel-header highlighting in sync and re-renders the block-action-bar on tracked session changes
 * (selection, hover, mode, activeMedia).
 */
import { flush, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, render, unmount } from "../src/panels/overlays";
import { activeCanvasSurface } from "../src/canvas/canvas-surface";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import type { CanvasPanel } from "../src/types";

/* The panels of the FOCUSED pane's stage. Panels belong to a pane's surface now, not to the
   app (`src/canvas/canvas-surface.ts`); the array identity is stable, so a module-level
   binding still sees what the render mutated. */
const canvasPanels = activeCanvasSurface().panels;

let isEditingFlag = false;

/** What the session looked like each time the panel painted the block-action bar. */
interface BarPaint {
  media: string | null;
  selection: string;
}

/** Every block-action-bar paint since the last reset, in order. */
let barPaints: BarPaint[] = [];

/** The delegate the panel is handed: it records which selection and breakpoint it painted for. */
function renderBlockActionBar(): void {
  const session = activeTab.value?.session;
  barPaints.push({
    media: session?.ui.activeMedia ?? null,
    selection: session?.selection.map((path) => path.join("/")).join("|") ?? "",
  });
}

/** A minimal iframe-era panel: element + header for the active-highlight sync. */
function makePanel(mediaName = "base"): CanvasPanel {
  const element = document.createElement("div");
  const header = document.createElement("div");
  header.setAttribute("part", "panel-header");
  const canvas = document.createElement("div");
  element.append(header, canvas);
  document.body.append(element);

  const panel: CanvasPanel = {
    _width: null,
    canvas,
    element,
    mediaName,
    ready: false,
    renderScope: null,
    scrollContainer: element,
    viewport: element,
  };
  canvasPanels.push(panel);
  return panel;
}

/** The header {@link makePanel} put first in the panel's element. */
function headerOf(panel: CanvasPanel): HTMLElement {
  const header = panel.element.querySelector('[part="panel-header"]');
  if (!(header instanceof HTMLElement)) {
    throw new TypeError(`panel "${panel.mediaName}" has no header`);
  }
  return header;
}

async function mountAndFlush() {
  mount({
    isEditing: () => isEditingFlag,
    renderBlockActionBar,
  });
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = "";
  isEditingFlag = false;
  barPaints = [];
  resetWorkspaceWithTab({
    children: [{ tagName: "p", textContent: "Hello" }],
    tagName: "div",
  });
});

afterEach(() => {
  unmount();
  canvasPanels.length = 0;
  closeAllTabs();
  document.body.innerHTML = "";
});

describe("overlays — header sync", () => {
  test("the flush highlights the active panel's header", async () => {
    const base = makePanel("base");
    const md = makePanel("md");
    activeTab.value!.session.ui.activeMedia = "md";
    await mountAndFlush();
    expect(headerOf(md).dataset.active).toBe("");
    expect(headerOf(base).dataset.active).toBeUndefined();
  });

  test("panels' DOM is otherwise untouched (the iframe draws its own overlays)", async () => {
    const panel = makePanel();
    const marker = document.createElement("div");
    panel.canvas.append(marker);
    activeTab.value!.session.selection = [["children", 0]];
    await mountAndFlush();
    expect(panel.canvas.contains(marker)).toBe(true);
  });
});

describe("overlays — lifecycle", () => {
  test("reactive effect re-runs the block-action-bar delegate when selection changes", async () => {
    makePanel();
    await mountAndFlush();
    barPaints = [];
    // A selection change re-runs the tracked effect, which schedules another flush.
    activeTab.value!.session.selection = [["children", 0]];
    await flush();
    expect(barPaints).toEqual([{ media: null, selection: "children/0" }]);
  });

  test("reactive effect re-runs the delegate when the ACTIVE PANEL (activeMedia) changes", async () => {
    makePanel();
    await mountAndFlush();
    barPaints = [];
    // A hit in another breakpoint panel re-anchors the bar even with an unchanged selection path.
    activeTab.value!.session.ui.activeMedia = "sm";
    await flush();
    expect(barPaints).toEqual([{ media: "sm", selection: "" }]);
  });

  test("render after unmount is a no-op (the block-action-bar delegate is not invoked)", async () => {
    makePanel();
    await mountAndFlush();
    unmount();
    barPaints = [];
    render();
    await flush();
    expect(barPaints).toEqual([]);
  });

  test("unmount between schedule and flush aborts the paint", async () => {
    makePanel();
    await mountAndFlush();
    render();
    unmount();
    await flush();
    expect(barPaints.length).toBeGreaterThan(0);
  });

  test("no active tab makes the flush a no-op", async () => {
    makePanel();
    await mountAndFlush();
    closeAllTabs();
    barPaints = [];
    render();
    await flush();
    expect(barPaints).toEqual([]);
  });

  test("multiple render calls coalesce into one flush", async () => {
    makePanel();
    await mountAndFlush();
    barPaints = [];
    render();
    render();
    render();
    await flush();
    expect(barPaints).toHaveLength(1);
  });
});
