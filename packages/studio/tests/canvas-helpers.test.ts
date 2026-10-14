import { resetStudioState, resetWorkspaceWithTab } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  bubbleInlinePath,
  getActivePanel,
  panelMediaToActiveMedia,
  panelOfSurface,
} from "../src/canvas/canvas-helpers";
import { activeCanvasSurface, surfaceForPane } from "../src/canvas/canvas-surface";
import { PRIMARY_PANE, SECONDARY_PANE, closeAllTabs, workspace } from "../src/workspace/workspace";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { CanvasPanel } from "../src/types";

/* The panels of the FOCUSED pane's stage. Panels belong to a pane's surface now, not to the
   app (`src/canvas/canvas-surface.ts`); the array identity is stable, so a module-level
   binding still sees what the render mutated. */
const canvasPanels = activeCanvasSurface().panels;

/** An artboard record named for its breakpoint: the only member the active-panel lookup reads. */
function board(mediaName: string | null): CanvasPanel {
  /* SAFETY: `panelOfSurface` (and `getActivePanel` over it) reads nothing of a record but
     `mediaName`, which it only compares with `===` against "base" and the tab's `activeMedia`
     (`string | null`); a surface teardown reaches only `renderScope?.`. So the DOM members are
     never touched, and a null `mediaName`, which this suite uses to pin the null-media branch, is
     compared rather than dereferenced. */
  return { mediaName } as CanvasPanel;
}

beforeEach(() => {
  resetStudioState();
  canvasPanels.length = 0;
  closeAllTabs();
});

// ─── panelMediaToActiveMedia ──────────────────────────────────────────────────

describe("panelMediaToActiveMedia", () => {
  test("empty string means base context (null)", () => {
    expect(panelMediaToActiveMedia("")).toBeNull();
  });

  test("null and undefined mean base context", () => {
    const missing: string | undefined = undefined;
    expect(panelMediaToActiveMedia(null)).toBeNull();
    expect(panelMediaToActiveMedia(missing)).toBeNull();
  });

  test("'base' maps to null", () => {
    expect(panelMediaToActiveMedia("base")).toBeNull();
  });

  test("named breakpoint passes through", () => {
    expect(panelMediaToActiveMedia("md")).toBe("md");
  });
});

// ─── getActivePanel ───────────────────────────────────────────────────────────

describe("getActivePanel", () => {
  test("returns null when there are no panels", () => {
    expect(getActivePanel()).toBeNull();
  });

  test("returns the only panel when there is exactly one", () => {
    const panel = board("anything");
    canvasPanels.push(panel);
    expect(getActivePanel()).toBe(panel);
  });

  test("activeMedia null resolves to the base panel", () => {
    resetWorkspaceWithTab();
    const base = board("base");
    const md = board("md");
    canvasPanels.push(md, base);
    expect(getActivePanel()).toBe(base);
  });

  test("activeMedia null resolves to a null-media panel", () => {
    resetWorkspaceWithTab();
    const plain = board(null);
    const md = board("md");
    canvasPanels.push(md, plain);
    expect(getActivePanel()).toBe(plain);
  });

  test("named activeMedia resolves to the matching panel", () => {
    const tab = resetWorkspaceWithTab();
    tab.session.ui.activeMedia = "md";
    const base = board("base");
    const md = board("md");
    canvasPanels.push(base, md);
    expect(getActivePanel()).toBe(md);
  });

  test("falls back to the first panel when nothing matches", () => {
    const tab = resetWorkspaceWithTab();
    tab.session.ui.activeMedia = "xl";
    const sm = board("sm");
    const md = board("md");
    canvasPanels.push(sm, md);
    expect(getActivePanel()).toBe(sm);
  });

  test("no active tab behaves like activeMedia null", () => {
    closeAllTabs();
    const base = board("base");
    canvasPanels.push(board("md"), base);
    expect(getActivePanel()).toBe(base);
  });
});

// ─── panelOfSurface, in a lens ────────────────────────────────────────────────

/*
 * "The active panel" is what the block action bar anchors to, what the Style panel resolves its
 * breakpoint context from, and what every panel-relative measurement starts at — so a lens getting
 * it wrong is not one wrong artboard, it is every one of those addressing the pane beside it.
 *
 * The line that decides it is `activeMediaOfPane(surface.paneId)`, and spelling it
 * `tabOfPane(...)?.session.ui.activeMedia` — which is what it means for every OTHER pane, and what
 * it was before the lens existed — left the whole suite green.
 */
describe("panelOfSurface in a breakpoint lens", () => {
  test("resolves the LENS's own breakpoint, not the breakpoint of the tab it shares", () => {
    const tab = resetWorkspaceWithTab();
    // The tab is on the base artboard in the pane that owns it.
    tab.session.ui.activeMedia = null;
    workspace.panes.push({ activeTabId: null, derived: null, id: SECONDARY_PANE, tabOrder: [] });
    workspace.panes[1]!.derived = {
      diff: null,
      kind: "lens",
      media: "md",
      mode: "design",
      preset: "breakpoint",
      reason: "",
      sourcePaneId: PRIMARY_PANE,
      status: "ready",
      zoom: 1,
    };
    const side = surfaceForPane(SECONDARY_PANE);
    const base = board("base");
    const md = board("md");
    side.panels.length = 0;
    side.panels.push(base, md);
    canvasPanels.push(base, md);

    expect(panelOfSurface(side)).toBe(md);
    // …and the pane that owns the tab still answers with the tab's, which is the base artboard.
    expect(getActivePanel()).toBe(base);
    side.panels.length = 0;
  });
});

// ─── bubbleInlinePath ─────────────────────────────────────────────────────────

describe("bubbleInlinePath", () => {
  const doc: JxMutableNode = {
    children: [
      {
        children: [{ tagName: "strong", textContent: "bold" }],
        tagName: "p",
      },
      {
        children: [{ children: [{ tagName: "em" }], tagName: "p" }],
        tagName: "section",
      },
    ],
    tagName: "div",
  };

  test("returns path unchanged when doc is undefined", () => {
    const path = ["children", 0];
    expect(bubbleInlinePath(undefined, path)).toBe(path);
  });

  test("bubbles inline strong out of its paragraph", () => {
    const result = bubbleInlinePath(doc, ["children", 0, "children", 0]);
    expect(result).toEqual(["children", 0]);
  });

  test("stops at a non-inline ancestor (p inside div)", () => {
    const result = bubbleInlinePath(doc, ["children", 0]);
    expect(result).toEqual(["children", 0]);
  });

  test("non-inline child is returned as-is", () => {
    // P inside section is not inline-in-context
    const result = bubbleInlinePath(doc, ["children", 1, "children", 0]);
    expect(result).toEqual(["children", 1, "children", 0]);
  });

  test("bubbles em out of nested paragraph but not past section", () => {
    const result = bubbleInlinePath(doc, ["children", 1, "children", 0, "children", 0]);
    expect(result).toEqual(["children", 1, "children", 0]);
  });

  test("invalid path (missing node) returns original path", () => {
    const path = ["children", 9, "children", 0];
    expect(bubbleInlinePath(doc, path)).toBe(path);
  });

  test("short path (root) is returned as-is", () => {
    const path: (string | number)[] = [];
    expect(bubbleInlinePath(doc, path)).toBe(path);
  });

  test("defaults missing tagNames to div (non-inline)", () => {
    const anonDoc: JxMutableNode = {
      children: [{ children: [{ textContent: "x" }] }],
    };
    const result = bubbleInlinePath(anonDoc, ["children", 0, "children", 0]);
    expect(result).toEqual(["children", 0, "children", 0]);
  });
});
