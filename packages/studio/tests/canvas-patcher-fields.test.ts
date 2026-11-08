/**
 * An entry's fields reaching the canvas without a redraw (studio.md §22.5): the canvas patcher's
 * verdict on a transaction that changed only frontmatter, and the post that carries it.
 */
import { resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeCanvasSurface } from "../src/canvas/canvas-surface";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import { setPatchConsumer } from "../src/tabs/patch-ops";
import { applyFieldsBatch, classifyFields, initCanvasPatcher } from "../src/canvas/canvas-patcher";
import { canvasPerf, resetCanvasPerf } from "../src/canvas/canvas-perf";
import type { CanvasPanel } from "../src/types";

const { panels } = activeCanvasSurface();

/** An artboard; the verdict reads only `ready`. */
function panel(ready = true): CanvasPanel {
  return {
    _width: null,
    canvas: document.createElement("div"),
    element: document.createElement("div"),
    mediaName: "",
    ready,
    renderScope: null,
    scrollContainer: document.createElement("div"),
    viewport: document.createElement("div"),
  };
}

/** A Markdown post open in `mode`, in a project whose `posts` collection it belongs to. */
function entryTab(mode = "edit", path = "content/posts/spring.md") {
  resetStudioState({
    isSiteProject: true,
    projectConfig: { content: { posts: { format: "markdown", source: "./content/posts" } } },
  });
  const tab = openTab({
    document: { children: [], tagName: "div" },
    documentPath: path,
    frontmatter: { title: "Spring" },
    id: path,
  });
  tab.session.ui.canvasMode = mode;
  return tab;
}

beforeEach(() => {
  resetCanvasPerf();
  initCanvasPatcher({ renderOverlays: () => {}, scheduleCanvasRender: () => {} });
});

afterEach(() => {
  setPatchConsumer(null);
  panels.length = 0;
  closeAllTabs();
});

describe("classifyFields", () => {
  test("an entry's field change, on a ready editable stage, is patchable", () => {
    panels.push(panel());
    expect(
      classifyFields(entryTab(), [{ after: "Summer", before: "Spring", field: "title" }]),
    ).toEqual({
      patchable: true,
      reason: "",
    });
  });

  test("a document that is not an entry, or a change to its layout, is redrawn", () => {
    panels.push(panel());
    const page = entryTab("edit", "pages/about.md");
    expect(classifyFields(page, [{ field: "title" }]).reason).toBe("fields-not-an-entry");
    const entry = entryTab();
    expect(classifyFields(entry, [{ field: "title" }, { field: "$layout" }]).reason).toBe(
      "fields-move-the-layout",
    );
    expect(canvasPerf.lastEscalationReason).toBe("fields-move-the-layout");
  });

  test("the stages decide as they do for document ops", () => {
    expect(classifyFields(entryTab(), [{ field: "title" }]).reason).toBe("no-panels");
    panels.push(panel(false));
    expect(classifyFields(entryTab(), [{ field: "title" }]).reason).toBe("panels-not-ready");
    expect(classifyFields(entryTab("preview"), [{ field: "title" }]).reason).toBe("mode-preview");
  });
});

describe("applyFieldsBatch", () => {
  test("throws when no frame received the fields, so the change is redrawn rather than lost", () => {
    expect(() => {
      applyFieldsBatch(entryTab());
    }).toThrow("no-ready-iframe-host");
  });
});
