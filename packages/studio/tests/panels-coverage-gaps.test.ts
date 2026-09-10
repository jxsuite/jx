/**
 * Coverage-gap tests for panel modules:
 *
 * - Stylebook-doc: nested `@` blocks stripped during media hoisting, and top-level non-tag selector
 *   passthrough.
 * - Tab-bar: the render catch when the template throws.
 * - Layers-panel: slot badges, move-in container detection (void / legacy array-object / non-array
 *   children), stray-toggle clicks, and startLayerTitleEdit guards.
 * - Dnd: the onGenerateDragPreview suppressors for layer and component drags.
 */
import { flush, registerPrimaryStage, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { JxPath } from "../src/state";
import type { Tab } from "../src/tabs/tab";
import { surfaceForPane } from "../src/canvas/surface-registry";

type AnyRec = Record<string, any>;

const draggables: AnyRec[] = [];
let previewsDisabled = 0;

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: (cfg: AnyRec) => {
    draggables.push(cfg);
    return () => {};
  },
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));
void mock.module("@atlaskit/pragmatic-drag-and-drop/combine", () => ({
  combine:
    (...fns: (() => void)[]) =>
    () => {
      for (const fn of fns) {
        fn();
      }
    },
}));
void mock.module("@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview", () => ({
  disableNativeDragPreview: () => {
    previewsDisabled += 1;
  },
}));
void mock.module("@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item", () => ({
  attachInstruction: (data: AnyRec) => data,
  extractInstruction: (data: AnyRec) => data.__instr ?? null,
}));
void mock.module("../src/panels/component-preview", () => ({
  renderComponentPreview: async (comp: AnyRec) => {
    const el = document.createElement(comp.tagName);
    el.textContent = "preview";
    return el;
  },
}));

const { buildStylebookDoc, hasTagStyle, transposeStylebookStyle } =
  await import("../src/panels/stylebook-doc");
const paneContext = await import("../src/panels/pane-context");
const { detachOutline, mountOutlinePanel, startLayerTitleEdit } =
  await import("../src/panels/layers-panel");
const dnd = await import("../src/panels/dnd");
const { initShellRefs } = await import("../src/store");
const { componentRegistry } = await import("../src/files/components");
const { view } = await import("../src/view");
const { activeTab, closeAllTabs } = await import("../src/workspace/workspace");
const { initLayers } = await import("../src/ui/layers");

// ─── Stylebook doc transforms ────────────────────────────────────────────────

describe("transposeStylebookStyle gaps", () => {
  test("a media block nested inside a tag rule keeps whatever nests inside IT", () => {
    // The hoist used to flatten this to one level and strip the inner query. Both survive now.
    const out = transposeStylebookStyle({
      p: {
        "@--sm": { "@--nested": { color: "blue" }, color: "red" },
        margin: "0",
      },
    } as never) as Record<string, any>;
    expect(out["& .element-card-preview p"]).toEqual({
      "@--sm": { "@--nested": { color: "blue" }, color: "red" },
      margin: "0",
    });
  });

  test("top-level non-tag selectors pass through untransformed", () => {
    const out = transposeStylebookStyle({
      ":hover": { color: "red" },
      ".brand": { color: "blue" },
      p: { margin: "0" },
    } as never) as Record<string, any>;
    expect(out[":hover"]).toEqual({ color: "red" });
    expect(out[".brand"]).toEqual({ color: "blue" });
    expect(out["& .element-card-preview p"]).toEqual({ margin: "0" });
  });

  test("hasTagStyle sees customizations under media blocks", () => {
    expect(hasTagStyle({ "@--sm": { p: { margin: "0" } } } as never, "p")).toBe(true);
    expect(hasTagStyle({ "@--sm": { p: {} } } as never, "p")).toBe(false);
  });
});

describe("buildStylebookDoc component filtering", () => {
  const meta = { $sections: [{ elements: [{ tag: "p", text: "Para" }], label: "Text" }] };
  const components = [
    { path: "components/my-card.json", tagName: "my-card" },
    { path: "components/other.json", tagName: "other-thing" },
  ] as never;

  test("the filter narrows the Components section by tag name", () => {
    const { doc, tagToCardPath } = buildStylebookDoc({
      components,
      customizedOnly: false,
      effectiveMedia: {},
      effectiveStyle: {},
      filter: "card",
      meta: meta as never,
      projectRoot: null,
    });
    expect(tagToCardPath.has("my-card")).toBe(true);
    expect(tagToCardPath.has("other-thing")).toBe(false);
    expect((doc as Record<string, unknown>).$elements).toEqual([
      { $ref: "/components/my-card.json" },
    ]);
  });

  test("customizedOnly keeps only components the effective style touches", () => {
    const { tagToCardPath } = buildStylebookDoc({
      components,
      customizedOnly: true,
      effectiveMedia: {},
      effectiveStyle: { "my-card": { color: "red" } } as never,
      filter: "",
      meta: meta as never,
      projectRoot: null,
    });
    expect(tagToCardPath.has("my-card")).toBe(true);
    expect(tagToCardPath.has("other-thing")).toBe(false);
    expect(tagToCardPath.has("p")).toBe(false); // Uncustomized element sections drop too.
  });
});

// ─── Pane chrome render catch ────────────────────────────────────────────────

describe("pane-context interaction gaps", () => {
  function makePaneCtx(overrides: Partial<Parameters<typeof paneContext.mount>[1]> = {}) {
    return {
      exportFile: mock(() => {}),
      parseMediaEntries: () => ({ baseWidth: 1280, featureQueries: [], sizeBreakpoints: [] }),
      setCanvasMode: mock((_tab: Tab | null, _mode: string) => {}),
      ...overrides,
    };
  }

  afterEach(() => {
    paneContext.unmount();
    closeAllTabs();
    document.body.innerHTML = "";
  });

  /** A control of the pane's chrome, by the `part` the document stamps on it. */
  function podPart(root: HTMLElement, name: string): HTMLElement {
    return root.querySelector<HTMLElement>(`[part="${name}"]`)!;
  }

  test("the pod's panzoom actions run without a panzoom surface", async () => {
    resetStudioState();
    const tab = resetWorkspaceWithTab();
    tab.session.ui.zoom = 2.4;
    /* THE PANE's mode, not the ctx's. The pod reads `canvasModeOfPane` now — a fixture that named
       a mode only in the ctx was describing a state the app cannot be in, and a default `.json`
       tab opens in `edit`, whose "−" drives `editZoom` rather than the panzoom `ui.zoom`. */
    tab.session.ui.canvasMode = "design";
    surfaceForPane("primary").panzoomWrap = null; // Canvas-utils actions guard on this and no-op cleanly.
    const root = document.createElement("div");
    document.body.append(root);
    paneContext.mount(root, makePaneCtx() as never);
    // A mounted document settles over several turns; the pod does not exist on the next tick.
    await flush(8);

    podPart(root, "zoom-out").click();
    await flush(4);
    expect(tab.session.ui.zoom).toBeCloseTo(2);

    podPart(root, "zoom-label").click();
    await flush(4);
    expect(tab.session.ui.zoom).toBeCloseTo(2); // Guarded no-ops without a panzoom surface.
  });

  test("render after unmount is a guarded no-op", () => {
    expect(() => {
      paneContext.render();
    }).not.toThrow();
  });
});

describe("pane-context render failure", () => {
  test("a throwing template is caught and does not break mount", async () => {
    resetStudioState();
    resetWorkspaceWithTab();
    const host = document.createElement("div");
    document.body.append(host);
    expect(() => {
      paneContext.mount(host, {
        exportFile: () => {},
        // `getCanvasMode` used to be the thrower, and it is gone from the ctx — the bar asks its own
        // Pane's tab. `parseMediaEntries` is the remaining injected call on the render path.
        parseMediaEntries: () => {
          throw new Error("media exploded");
        },
        setCanvasMode: () => {},
      });
    }).not.toThrow();
    await flush(6);
    expect(() => {
      paneContext.render();
    }).not.toThrow();
    // …and nothing was left half-drawn: the projection threw before a mount was ever asked for.
    expect(host.querySelector('[part="bar"]')).toBeNull();
    paneContext.unmount();
    host.remove();
  });
});

// ─── Layers panel ────────────────────────────────────────────────────────────

describe("layers-panel gaps", () => {
  let host: HTMLElement;

  function makeDoc(): JxMutableNode {
    return {
      children: [
        { tagName: "img" },
        { tagName: "p", textContent: "after-img" },
        { children: [{ tagName: "li", textContent: "x" }], tagName: "ul" },
        { tagName: "p", textContent: "after-ul" },
        { children: [{ tagName: "em", textContent: "y" }], tagName: "div" },
        { tagName: "p", textContent: "after-ref" },
        { attributes: { name: "header" }, tagName: "slot" },
        { tagName: "slot" },
      ],
      tagName: "div",
    };
  }

  async function renderLayers() {
    mountOutlinePanel({ registerDnD: () => {}, rerender: () => {} }, host);
    await flush(3);
    return host;
  }

  function rowByKey(path: JxPath): HTMLElement | null {
    return (
      [...host.querySelectorAll<HTMLElement>('[part="row"]')].find(
        (el) => el.dataset.path === path.join("/"),
      ) ?? null
    );
  }

  /**
   * Select the row, re-render, and report whether "Move Into Previous" can act on it.
   *
   * Row actions exist for the selected row (and the hovered one) only, so selecting first is the
   * real interaction — clicking a row does both. The button itself is always rendered: ONE shape,
   * so an unavailable verb is disabled rather than removed, and "can this node move in" is read off
   * the kit control's `disabled` rather than off the button's presence.
   */
  async function canMoveIn(path: JxPath): Promise<boolean> {
    activeTab.value!.session.selection = [path];
    await renderLayers();
    const btn = rowByKey(path)?.querySelector('[part="action"][data-command="selection.moveIn"]');
    if (!btn) {
      throw new Error(`no Move Into Previous button on row ${path.join("/")}`);
    }
    return !btn.querySelector('[part="control"]')!.hasAttribute("disabled");
  }

  beforeEach(() => {
    detachOutline();
    document.body.innerHTML = `
      <div class="panel-body"><div class="panel-content"></div></div>
      <div id="layer-popover"></div>
      <div id="layer-modal"></div>
      <div id="layer-dialog"></div>
    `;
    initLayers();
    host = document.querySelector(".panel-body") as HTMLElement;
    view._layersCollapsed = new Set();
    view.dndCleanups = [];
    resetWorkspaceWithTab(makeDoc());
  });

  afterEach(() => {
    detachOutline();
    closeAllTabs();
    document.body.innerHTML = "";
  });

  function badge(path: JxPath): HTMLElement {
    return rowByKey(path)!.querySelector('[part="badge"]') as HTMLElement;
  }

  test("slot rows get the slot badge with named and default titles", async () => {
    await renderLayers();
    const named = badge(["children", 6]);
    expect(named.dataset.kind).toBe("slot");
    expect(named.textContent).toBe("▣");
    expect(named.getAttribute("title")).toBe('Slot "header"');
    expect(badge(["children", 7]).getAttribute("title")).toBe("Default slot");
  });

  test("move-in is unavailable after a void sibling", async () => {
    await renderLayers();
    expect(await canMoveIn(["children", 1])).toBe(false);
  });

  test("a legacy array-object children sibling still counts as a container", async () => {
    const doc = activeTab.value!.doc.document as AnyRec;
    doc.children[2].children = {
      $prototype: "Array",
      items: { $ref: "#/state/things" },
      map: { tagName: "li", textContent: "item" },
    };
    await renderLayers();
    expect(await canMoveIn(["children", 3])).toBe(true);
  });

  test("non-array object children (a $ref) do not count as a container", async () => {
    const doc = activeTab.value!.doc.document as AnyRec;
    doc.children[4].children = { $ref: "#/state/body" };
    await renderLayers();
    expect(await canMoveIn(["children", 5])).toBe(false);
  });

  test("a click on the chevron collapses the row without also selecting it", async () => {
    await renderLayers();
    const toggle = rowByKey(["children", 2])!.querySelector('[part="toggle"]') as HTMLElement;
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    expect(view._layersCollapsed!.has("children/2")).toBe(true);
    // The chevron stops the click: collapsing a branch is not a way of selecting it.
    expect(activeTab.value!.session.selection).toEqual([]);
  });

  test("a text line has no title to rename", async () => {
    /* The row EXISTS in the model — it is drawn, it is keyed, it sits under its paragraph — and it
       is still not renameable, because a text node has nowhere to put a `$title`. That is the
       branch a "the node is gone" guard could never reach: the node is right there. */
    const doc = activeTab.value!.doc.document as AnyRec;
    doc.children[0].children = ["just words"];
    await renderLayers();
    const textRow = rowByKey(["children", 0, "children", 0])!;
    expect(textRow.dataset.kind).toBe("text");

    expect(() => {
      startLayerTitleEdit(["children", 0, "children", 0], () => {});
    }).not.toThrow();
    await flush(2);
    expect(host.querySelector('[part="title-input"]')).toBeNull();
  });

  test("startLayerTitleEdit returns silently when the path is in no row at all", async () => {
    await renderLayers();
    expect(() => {
      startLayerTitleEdit(["children", 99], () => {});
    }).not.toThrow();
    await flush(2);
    expect(host.querySelector('[part="title-input"]')).toBeNull();
  });

  test("Escape after a commit is a no-op — the rename is already over", async () => {
    await renderLayers();
    const rerender = mock(() => {});
    startLayerTitleEdit(["children", 1], rerender);
    await flush(2);
    const input = rowByKey(["children", 1])!.querySelector(
      '[part="title-input"]',
    ) as HTMLInputElement;
    input.value = "Committed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur"));
    await flush(2);
    expect(rerender).toHaveBeenCalledTimes(1);

    input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
    await flush(2);
    expect(rerender).toHaveBeenCalledTimes(1);
    const node = (activeTab.value!.doc.document.children as JxMutableNode[])[1]!;
    expect(node.$title).toBe("Committed");
  });
});

// ─── DnD drag-preview suppression ────────────────────────────────────────────

describe("dnd drag previews", () => {
  const raf = () =>
    new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });

  beforeEach(() => {
    draggables.length = 0;
    previewsDisabled = 0;
    componentRegistry.length = 0;
    view.dndCleanups = [];
    document.body.innerHTML = `<div id="left-panel"></div>`;
    initShellRefs();
    registerPrimaryStage();
  });

  test("Outline row drags suppress the native drag image", async () => {
    const leftPanel = document.querySelector("#left-panel") as HTMLElement;
    leftPanel.innerHTML = `<div part="outline">
      <div part="row" data-dnd-row data-path="children/0" data-dnd-depth="0"></div>
    </div>`;
    dnd.registerLayersDnD();
    await raf();
    await flush();
    expect(draggables).toHaveLength(1);
    draggables[0]!.onGenerateDragPreview({ nativeSetDragImage: null });
    expect(previewsDisabled).toBe(1);
  });

  test("component-card drags suppress the native drag image", async () => {
    const leftPanel = document.querySelector("#left-panel") as HTMLElement;
    leftPanel.innerHTML = `<div class="components-section">
      <div data-component-tag="my-card"><div class="element-card-preview"></div></div>
    </div>`;
    componentRegistry.push({ tagName: "my-card" } as never);
    dnd.registerComponentsDnD();
    await raf();
    await flush();
    expect(draggables).toHaveLength(1);
    draggables[0]!.onGenerateDragPreview({ nativeSetDragImage: null });
    expect(previewsDisabled).toBe(1);
  });
});
