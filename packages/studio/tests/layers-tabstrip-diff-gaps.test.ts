/**
 * Three edges that the Outline, the overlay layers and the tab strip only reach when something is
 * MISSING — and where the honest answer is "do nothing", which is exactly the shape of code no test
 * arrives at by accident.
 *
 * - The Outline's walk runs off the END of its model: ↓ from the last row, → from a last row that is
 *   expandable but whose only child is a text node (not a tree item). Both answers are -1, and -1
 *   must not be treated as an index.
 * - A keyboard jump can name a row that the repaint it provoked STILL does not hold. The pending
 *   focus is spent either way, and spending it on nothing must leave the tree's single tab stop
 *   where the roving pass put it rather than clearing every one of them.
 * - A popover anchored inside the dialog layer belongs in the dialog layer, and `toastsAreHeld`
 *   answers "no" for a realm whose `location` cannot be read at all.
 * - The tab strip's drag carries a payload, and both of its menus close on an outside click — and the
 *   overflow menu reopened AFTER such a click is the live one, which is the reachable state a stale
 *   `_overflowHandle` would have to be visible in.
 */
import { flush, key, resetWorkspaceWithTab, stubRect } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  activeTab,
  closeAllTabs,
  openTab,
  tabCommands,
  workspace,
} from "../src/workspace/workspace";
import { view } from "../src/view";
import { getLayerSlot, initLayers, toastsAreHeld } from "../src/ui/layers";
import { createCommandRegistry } from "../src/commands/registry";
import { setActiveRegistry } from "../src/commands/active-registry";
import { makeContext } from "../src/commands/context";
import { defaultCommands, noopCommandDeps } from "../src/commands/defaults";
import { resetPanels } from "../src/panels/panel-registry";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { JxPath } from "../src/state";

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

const {
  OUTLINE_ROW_HEIGHT,
  applyRowSelection,
  detachOutline,
  mountOutlinePanel,
  startLayerTitleEdit,
} = await import("../src/panels/layers-panel");
const { dismissOverflowMenu, mount, unmount } = await import("../src/panels/tab-strip");

/** Errors happy-dom reports for a listener that threw — a dispatch never rethrows them. */
function captureErrors(): { messages: string[]; stop: () => void } {
  const messages: string[] = [];
  const onError = (e: Event) => messages.push((e as ErrorEvent).message ?? "error");
  window.addEventListener("error", onError);
  return { messages, stop: () => window.removeEventListener("error", onError) };
}

// ─── The Outline ──────────────────────────────────────────────────────────────

/** A Navigator tall enough for ten rows, which is a real one at 24px a row. */
const VIEWPORT = 240;

let scroller: HTMLElement;
let host: HTMLElement;
/** What the tree's top measures as, relative to the scroller. */
let treeTop: () => number;
/** What the panel's `rerender` does — a real repaint, or a spy that stands in for one. */
let onRerender: () => void;

/** Happy-dom performs no layout, so the box the window is computed from is stubbed by hand. */
function place(rowCount: number): void {
  const tree = host.querySelector<HTMLElement>('[part="tree"]');
  if (tree) {
    (tree as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({ height: rowCount * OUTLINE_ROW_HEIGHT, top: treeTop() }) as DOMRect;
  }
}

async function renderOutline(rowCount: number): Promise<void> {
  mountOutlinePanel({ registerDnD: () => {}, rerender: () => onRerender() }, host);
  await flush(3);
  place(rowCount);
}

function rowByKey(pathKey: string): HTMLElement | null {
  return (
    [...host.querySelectorAll<HTMLElement>('[part="row"]')].find(
      (el) => el.dataset.value === pathKey,
    ) ?? null
  );
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[part="row"][role="treeitem"]')];
}

function selection(): JxPath[] {
  return activeTab.value!.session.selection;
}

function setUpOutlineDom(): void {
  detachOutline();
  document.body.innerHTML = `
    <div id="scroller"><div class="panel-body"><div class="panel-content"></div></div></div>
    <div id="layer-popover"></div>
    <div id="layer-modal"></div>
    <div id="layer-dialog"></div>
  `;
  initLayers();
  scroller = document.querySelector("#scroller") as HTMLElement;
  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: VIEWPORT });
  stubRect(scroller, { height: VIEWPORT, top: 0 });
  host = document.querySelector(".panel-body") as HTMLElement;
  view._layersCollapsed = new Set();
  view.dndCleanups = [];
  treeTop = () => -scroller.scrollTop;
  onRerender = () => {};
}

describe("the Outline's walk off the end of its model", () => {
  /** The last row is expandable and its only child is TEXT — drawn, but never a tree item. */
  const TAIL_DOC = {
    children: [
      { tagName: "p", textContent: "One" },
      { children: ["just words"], tagName: "section" },
    ],
    tagName: "div",
  } as unknown as JxMutableNode;

  /** Root + p + section + the section's text row. */
  const ROW_COUNT = 4;

  beforeEach(async () => {
    setUpOutlineDom();
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: ROW_COUNT * OUTLINE_ROW_HEIGHT,
    });
    resetWorkspaceWithTab(TAIL_DOC);
    onRerender = () => {
      void renderOutline(ROW_COUNT);
    };
    await renderOutline(ROW_COUNT);
    await flush();
  });

  afterEach(() => {
    detachOutline();
    closeAllTabs();
    resetPanels();
    document.body.innerHTML = "";
  });

  test("↓ from the last tree item stays put — the text row below it is not a step", async () => {
    // The text row is drawn BELOW the last tree item, so the walk has something to skip before it
    // Runs out of model.
    const tail = [...host.querySelectorAll<HTMLElement>('[part="row"]')].at(-1)!;
    expect(tail.textContent).toContain("just words");
    expect(tail.localName).not.toBe("jx-tree-item");

    const last = rowByKey("children/1")!;
    last.click();
    await flush();
    expect(selection()).toEqual([["children", 1]]);

    key(last, "ArrowDown");
    await flush();
    expect(selection()).toEqual([["children", 1]]);
  });

  test("→ on an expanded last row is a no-op, not an index of -1", async () => {
    const last = rowByKey("children/1")!;
    // It really is expanded: the branch under test is the one that DESCENDS, not the one that opens.
    expect(last.getAttribute("aria-expanded")).toBe("true");
    last.click();
    await flush();
    last.focus();
    const drawn = rows().length;

    const errors = captureErrors();
    key(last, "ArrowRight");
    await flush(2);
    errors.stop();

    expect(errors.messages).toEqual([]);
    // Nothing moved: no collapse was toggled, the row count is what it was, and the keyboard is
    // Still here. The only child below this row is a TEXT line, so the descent has nowhere to land.
    expect(view._layersCollapsed!.size).toBe(0);
    expect(selection()).toEqual([["children", 1]]);
    expect(rows()).toHaveLength(drawn);
    expect(document.activeElement).toBe(rowByKey("children/1"));

    // …and the same key on a COLLAPSED row does move, which is what makes the above an assertion
    // Rather than a key nothing is bound to.
    key(last, "ArrowLeft");
    await flush(2);
    expect(view._layersCollapsed!.has("children/1")).toBe(true);
    key(rowByKey("children/1")!, "ArrowRight");
    await flush(2);
    expect(view._layersCollapsed!.size).toBe(0);
  });

  test("a row activation with no document open leaves the closed tab's selection alone", () => {
    const tab = activeTab.value!;
    applyRowSelection(["children", 0]);
    expect(tab.session.selection).toEqual([["children", 0]]);

    closeAllTabs();
    expect(activeTab.value).toBeNull();
    applyRowSelection(["children", 1]);
    expect(tab.session.selection).toEqual([["children", 0]]);
  });
});

describe("a keyboard jump the repaint still cannot draw", () => {
  const CHILD_COUNT = 200;
  const ROW_COUNT = CHILD_COUNT + 1;

  function makeDoc(): JxMutableNode {
    return {
      children: Array.from({ length: CHILD_COUNT }, (_v, index) => ({
        tagName: "p",
        textContent: `Row ${index}`,
      })),
      tagName: "div",
    } as JxMutableNode;
  }

  beforeEach(async () => {
    setUpOutlineDom();
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: ROW_COUNT * OUTLINE_ROW_HEIGHT,
    });
    resetWorkspaceWithTab(makeDoc());
    onRerender = () => {
      void renderOutline(ROW_COUNT);
    };
    // First paint draws everything (nothing is measurable yet); the watch asks for the windowed one.
    await renderOutline(ROW_COUNT);
    await flush();
    place(ROW_COUNT);
  });

  afterEach(() => {
    detachOutline();
    closeAllTabs();
    resetPanels();
    document.body.innerHTML = "";
  });

  test("End keeps the tree's single tab stop when the repaint lands short", async () => {
    // The window is frozen at the top of the list: the scroll happens, the paint does not follow.
    treeTop = () => 0;
    expect(rows().length).toBeLessThan(ROW_COUNT);

    const errors = captureErrors();
    key(rows()[1]!, "End");
    await flush(3);
    errors.stop();

    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(selection()).toEqual([["children", CHILD_COUNT - 1]]);
    // The row it wanted is still not drawn, so the pending focus was spent on nothing…
    expect(rowByKey(`children/${CHILD_COUNT - 1}`)).toBeNull();
    expect(errors.messages).toEqual([]);
    // …and the roving tab stop the repaint set is still the tree's one keyboard position.
    expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1);
  });

  test("a rename aimed below the window scrolls to the row, and the input follows it", async () => {
    // The window is frozen at the top of the list: the scroll happens, the paint does not follow.
    treeTop = () => 0;
    expect(rowByKey("children/180")).toBeNull();

    const errors = captureErrors();
    startLayerTitleEdit(["children", 180], () => {});
    await flush(2);
    errors.stop();

    // The scroll is immediate; DRAWING the row is the window's business, so the input cannot be
    // Inserted into a tree that does not hold the row — and asking for it is not an error either.
    expect(errors.messages).toEqual([]);
    expect(scroller.scrollTop).toBeGreaterThan(OUTLINE_ROW_HEIGHT * 100);
    expect(rowByKey("children/180")).toBeNull();
    expect(host.querySelector('[part="title-input"]')).toBeNull();

    // Let the window catch up: the rename is still live, so the row arrives already editing.
    treeTop = () => -scroller.scrollTop;
    place(ROW_COUNT);
    scroller.dispatchEvent(new Event("scroll"));
    await flush(3);
    expect(rowByKey("children/180")).not.toBeNull();
    expect(rowByKey("children/180")!.querySelector('[part="title-input"]')).not.toBeNull();

    // A path that is in no row at all asks for nothing: there is no row to scroll to, and no
    // Rename is started — the row the reader is on keeps its input.
    const scrolled = scroller.scrollTop;
    startLayerTitleEdit(["children", 999], () => {});
    await flush(2);
    expect(scroller.scrollTop).toBe(scrolled);
    expect(rowByKey("children/180")!.querySelector('[part="title-input"]')).not.toBeNull();
  });
});

// ─── The overlay layers ───────────────────────────────────────────────────────

/*
 * `popoverLayerFor` is gone, and the reason is worth more than the tests were.
 *
 * It answered "which layer must this popover use to paint above the surface that opened it", because
 * the four hosts are sibling stacking contexts (popover 1000, modal 2000, dialog 3000, toast 4000)
 * and a menu anchored inside a modal would otherwise render entirely beneath it. Every menu now
 * opens as a native `popover` in the TOP LAYER, which is above every stacking context by definition
 * — so the question has no answer left to give. Its last caller went with `renderPopover`.
 *
 * What replaces the assertion is the one below: a menu raised from inside a dialog is reachable,
 * which is the behaviour the layer arithmetic existed to produce.
 */
describe("a popover opened from inside a dialog", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="layer-popover"></div>
      <div id="layer-modal"></div>
      <div id="layer-dialog"><button id="in-dialog"></button></div>
      <div id="layer-toast"></div>
    `;
    initLayers();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("lands in the popover layer, because the top layer settles the stacking", () => {
    const slot = getLayerSlot("popover", "from-dialog");
    expect(slot.closest("#layer-popover")).not.toBeNull();
    expect(slot.dataset.jxRegion).toBe("overlay.menu:from-dialog");
  });
});

describe("toastsAreHeld", () => {
  test("a realm whose location cannot be read is not automation", () => {
    const search = Object.getOwnPropertyDescriptor(globalThis.location, "search");
    Object.defineProperty(globalThis.location, "search", {
      configurable: true,
      get: () => {
        throw new Error("no location in this realm");
      },
    });
    try {
      expect(toastsAreHeld()).toBe(false);
    } finally {
      if (search) {
        Object.defineProperty(globalThis.location, "search", search);
      }
    }
  });
});

// ─── The tab strip ────────────────────────────────────────────────────────────

describe("the tab strip", () => {
  let stripHost: HTMLElement;

  function open(id: string) {
    return openTab({
      document: { children: [], tagName: "div" } as JxMutableNode,
      documentPath: `/project/${id}.json`,
      id,
    });
  }

  function chips(): HTMLElement[] {
    return [...stripHost.querySelectorAll('[part="tab"]')] as HTMLElement[];
  }

  function strip(): HTMLElement {
    return stripHost.querySelector('[part="tabs"]') as HTMLElement;
  }

  /** Happy-dom performs no layout (scrollWidth/clientWidth are 0); stub them to fake overflow. */
  function stubMetrics(el: HTMLElement, scrollWidth: number, clientWidth: number) {
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  }

  /**
   * Dispatch a dragstart carrying a DataTransfer, which happy-dom's own DragEvent does not. The two
   * fields the handler writes are the two this stub records.
   */
  function dragStart(el: HTMLElement): { effectAllowed: string; data: Map<string, string> } {
    const data = new Map<string, string>();
    const dataTransfer = {
      data,
      effectAllowed: "uninitialized",
      setData(type: string, value: string) {
        data.set(type, value);
      },
    };
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    el.dispatchEvent(event);
    return dataTransfer;
  }

  /**
   * Both menus are the kit's now (`surfaces/menu.ts`), so a menu on screen is a `jx-menu` in a
   * popover slot — and its light dismissal is the platform's `popover="auto"` rather than a
   * document listener this strip arms a frame after opening.
   */
  function popovers(): Element[] {
    return [...document.querySelectorAll("#layer-popover jx-menu")];
  }

  function publishRegistry() {
    const registry = createCommandRegistry({
      getContext: () => makeContext({ document: { open: workspace.activeTabId !== null } }),
    });
    registry.registerAll([
      ...defaultCommands(noopCommandDeps()),
      ...tabCommands({ openFile: () => {}, openFileInPane: () => {} }),
    ]);
    setActiveRegistry(registry);
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tab-strip"></div>
      <div id="layer-popover"></div>
      <div id="layer-modal"></div>
      <div id="layer-dialog"></div>
    `;
    initLayers();
    stripHost = document.querySelector("#tab-strip") as HTMLElement;
    closeAllTabs();
    workspace.closedTabs = [];
    mount(stripHost);
  });

  afterEach(() => {
    unmount();
    setActiveRegistry(null);
    closeAllTabs();
    document.body.innerHTML = "";
  });

  test("a chip's drag declares a move and carries the tab id", async () => {
    open("a");
    open("b");
    await flush();

    const dataTransfer = dragStart(chips()[0]!);
    await flush();

    expect(dataTransfer.effectAllowed).toBe("move");
    expect(dataTransfer.data.get("text/plain")).toBe("a");
    expect(chips()[0]!.dataset.dragging !== undefined).toBe(true);

    chips()[0]!.dispatchEvent(new Event("dragend", { bubbles: true }));
    await flush();
  });

  test("the overflow menu closes on a click outside it, and stays for one inside", async () => {
    open("a");
    open("b");
    await flush();
    stubMetrics(strip(), 500, 100);
    // Poke a re-render so the strip is measured again and the chevron is drawn.
    open("c");
    await flush();

    (stripHost.querySelector('[part="overflow"]:not([hidden])') as HTMLElement).click();
    await flush(3);
    expect(popovers()).toHaveLength(1);

    // A mousedown inside the menu is not "outside": the menu is there to be clicked.
    const item = document.querySelector("#layer-popover jx-menu-item") as HTMLElement;
    item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(popovers()).toHaveLength(1);

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(popovers()).toHaveLength(0);
  });

  /**
   * The reachable state a stale `_overflowHandle` would have to show itself in: the field is
   * written by the open, cleared by the outside-click hook, and read once more by the NEXT open.
   * What the strip owes here is a menu that lists the tabs as they are now, and a
   * {@link dismissOverflowMenu} that takes down the menu on screen rather than the one before it.
   */
  test("the overflow menu reopened after an outside click is the live one", async () => {
    open("a");
    open("b");
    await flush();
    stubMetrics(strip(), 500, 100);
    // Poke a re-render so the strip is measured again and the chevron is drawn.
    open("c");
    await flush();

    const chevron = () => stripHost.querySelector('[part="overflow"]:not([hidden])') as HTMLElement;
    chevron().click();
    await flush(3);
    expect(document.querySelectorAll("#layer-popover jx-menu-item")).toHaveLength(3);

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(popovers()).toHaveLength(0);

    // A fourth tab arrives while no menu is up, so the reopened menu is only right if it was built
    // From the pane's order as it stands NOW.
    open("d");
    await flush();
    chevron().click();
    await flush(3);

    expect(popovers()).toHaveLength(1);
    expect(document.querySelectorAll("#layer-popover jx-menu-item")).toHaveLength(4);

    // And the strip's handle addresses THAT menu: the exported dismiss takes it off the screen.
    dismissOverflowMenu();
    expect(popovers()).toHaveLength(0);
  });

  test("the tab context menu closes on a click outside it", async () => {
    open("a");
    publishRegistry();
    await flush();

    chips()[0]!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
    );
    await flush(3);
    expect(popovers()).toHaveLength(1);

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(popovers()).toHaveLength(0);

    // The strip's own handle went with it: reopening draws one menu, not a second beside a stale one.
    chips()[0]!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
    );
    await flush(3);
    expect(popovers()).toHaveLength(1);
  });
});
