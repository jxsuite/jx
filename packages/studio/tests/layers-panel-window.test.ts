/**
 * The Outline draws a WINDOW, and every question about the tree is answered from the model.
 *
 * The hazard this file exists for is the shift-range. `visibleRowPaths` used to read the rows out
 * of the DOM, which was exact while the tree drew all of them and becomes a silent lie the moment
 * it draws eleven of five thousand: `rangeSelection` degenerates to `[target]` when the anchor is
 * absent from the row list it is given (`tabs/selection.ts`), so shift-clicking two rows with a
 * scrolled-past anchor would have quietly selected ONE row and reported nothing wrong. That is a
 * correctness bug wearing a performance change's clothes, and the first test below is its witness.
 *
 * Everything else here is the rest of the audit: the keyboard walk, the reveal that follows a
 * selection made somewhere else, the ARIA set counts, and the drag that must not have the rows
 * pulled out from under it.
 *
 * The body is a Jx document now, so the rows are `[part="row"]`, the spacers are `jx-tree`'s own
 * and the drag mark the repaint guard looks for is `data-dragging` rather than a class.
 */
import { flush, resetWorkspaceWithTab, stubRect } from "./harness";
import { click, outlineHost, press, resetOutline, row, tree, treeItems } from "./outline-fixture";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import { view } from "../src/view";
import { getPanel, resetPanels } from "../src/panels/panel-registry";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { JxPath } from "../src/state";
import type { NavigatorPanelContext } from "../src/panels/panel-registry";

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

const { OUTLINE_ROW_HEIGHT, mountOutlinePanel, registerLayersPanel } =
  await import("../src/panels/layers-panel");

/** Children of the root — enough that a window is a small fraction of the tree. */
const CHILD_COUNT = 200;
/** Model rows: the root plus one per child. */
const ROW_COUNT = CHILD_COUNT + 1;
/** A Navigator tall enough for ten rows, which is a real one at 24px a row. */
const VIEWPORT = 240;

let scroller: HTMLElement;
let host: HTMLElement;

/** A page with a long, flat body — the shape a real article's Outline has. */
function makeDoc(): JxMutableNode {
  return {
    children: Array.from({ length: CHILD_COUNT }, (_v, index) => ({
      tagName: "p",
      textContent: `Row ${index}`,
    })),
    tagName: "div",
  } as JxMutableNode;
}

/**
 * Happy-dom performs no layout, so the two boxes the window is computed from are stubbed: the
 * scroller's viewport, and the tree's top relative to it — which is what moves when you scroll.
 */
function place(): void {
  const el = tree(host);
  if (el) {
    (el as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({ height: ROW_COUNT * OUTLINE_ROW_HEIGHT, top: -scroller.scrollTop }) as DOMRect;
  }
}

async function draw(): Promise<void> {
  mountOutlinePanel(
    {
      registerDnD: () => {},
      rerender: () => {
        void draw();
      },
    },
    host,
  );
  await flush(3);
  place();
}

async function scrollTo(top: number): Promise<void> {
  scroller.scrollTop = top;
  place();
  scroller.dispatchEvent(new Event("scroll"));
  await flush(3);
  place();
}

function childPath(index: number): JxPath {
  return ["children", index];
}

function rowFor(index: number): HTMLElement | null {
  return row(host, `children/${index}`);
}

function selection(): JxPath[] {
  return activeTab.value!.session.selection;
}

/** The two spacers that stand in for the rows the window left out. */
/**
 * The two spacers, in pixels.
 *
 * `jx-tree` draws them from its own `padtop`/`padbottom` props, so what the window reserves is read
 * off the element the panel handed the numbers to rather than off a declaration the panel composed
 * — the same evidence, one writer later.
 */
function pads(): number[] {
  return [...host.querySelectorAll<HTMLElement>('[part="pad-top"], [part="pad-bottom"]')].map(
    (el) => Number(/(-?[\d.]+)px/.exec(el.getAttribute("style") ?? "")?.[1] ?? 0),
  );
}

beforeEach(async () => {
  host = outlineHost(true);
  scroller = document.querySelector("#scroller") as HTMLElement;
  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: VIEWPORT });
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: ROW_COUNT * OUTLINE_ROW_HEIGHT,
  });
  stubRect(scroller, { height: VIEWPORT, top: 0 });
  resetWorkspaceWithTab(makeDoc());
  await draw();
  // The first pass draws everything, because nothing can be measured before the tree exists; the
  // Watch's opening measurement is what asks for the second, windowed one.
  await flush(3);
  place();
});

afterEach(() => {
  resetOutline();
  closeAllTabs();
  resetPanels();
});

describe("the shift-range is a range over the MODEL", () => {
  test("holds when the anchor has scrolled out of the window", async () => {
    click(rowFor(0)!);
    await flush();
    expect(selection()).toEqual([childPath(0)]);

    await scrollTo(OUTLINE_ROW_HEIGHT * 150);
    // The anchor is genuinely gone from the DOM — this is the state the DOM-derived range read as
    // "there is no anchor", and answered with a single row.
    expect(rowFor(0)).toBeNull();

    click(rowFor(149)!, { shiftKey: true });
    await flush();
    expect(selection()).toHaveLength(150);
    expect(selection()[0]).toEqual(childPath(0));
    expect(selection().at(-1)).toEqual(childPath(149));
  });

  test("holds when the TARGET is the row that scrolled away", async () => {
    await scrollTo(OUTLINE_ROW_HEIGHT * 150);
    click(rowFor(149)!);
    await flush();
    await scrollTo(0);
    expect(rowFor(149)).toBeNull();

    // Shift+↑ from a drawn row extends towards an anchor that is not drawn.
    press(rowFor(2)!, "ArrowUp", { shiftKey: true });
    await flush();
    expect(selection()).toHaveLength(149);
    expect(selection()[0]).toEqual(childPath(149));
    expect(selection().at(-1)).toEqual(childPath(1));
  });
});

describe("the window", () => {
  test("draws the viewport and its overscan, not the document", () => {
    const drawn = treeItems(host);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(20);
    expect(drawn.length).toBeLessThan(ROW_COUNT);
    expect(drawn[0]!.dataset.value).toBe("");
  });

  test("reserves the scroll height of every row it did not draw", () => {
    const [padTop, padBottom] = pads();
    expect(padTop).toBe(0);
    expect(padTop! + treeItems(host).length * OUTLINE_ROW_HEIGHT + padBottom!).toBe(
      ROW_COUNT * OUTLINE_ROW_HEIGHT,
    );
  });

  test("moves with the scroller, and still totals the whole document", async () => {
    await scrollTo(OUTLINE_ROW_HEIGHT * 100);
    expect(rowFor(0)).toBeNull();
    expect(rowFor(100)).not.toBeNull();
    const [padTop, padBottom] = pads();
    expect(padTop).toBeGreaterThan(0);
    expect(padTop! + treeItems(host).length * OUTLINE_ROW_HEIGHT + padBottom!).toBe(
      ROW_COUNT * OUTLINE_ROW_HEIGHT,
    );
  });

  test("reports each row's place in the DOCUMENT, not in the window", async () => {
    await scrollTo(OUTLINE_ROW_HEIGHT * 100);
    const el = rowFor(100)!;
    // 101st of 200 children, at depth 2 — a screen reader is told the same thing whether or not
    // The other 199 rows happen to be painted.
    expect(el.getAttribute("aria-posinset")).toBe("101");
    expect(el.getAttribute("aria-setsize")).toBe(String(CHILD_COUNT));
    expect(el.getAttribute("aria-level")).toBe("2");
  });

  test("hands the tab stop to a row the window actually holds", async () => {
    await scrollTo(OUTLINE_ROW_HEIGHT * 100);
    // The selection is empty and the root has scrolled away, so a stop derived from the model
    // Alone would name a row nobody painted — a tree with no way in.
    const stops = treeItems(host).filter((el) => el.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]!.isConnected).toBe(true);
  });
});

describe("the keyboard reaches rows the window does not hold", () => {
  test("End selects the last row of the document and scrolls to it", async () => {
    press(rowFor(1)!, "End");
    await flush();
    expect(selection()).toEqual([childPath(CHILD_COUNT - 1)]);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    place();
    scroller.dispatchEvent(new Event("scroll"));
    await flush(3);
    expect(rowFor(CHILD_COUNT - 1)).not.toBeNull();
  });

  test("Tab into a scrolled tree lands on a row, and ↑ from it walks the model", async () => {
    await scrollTo(OUTLINE_ROW_HEIGHT * 150);
    expect(selection()).toEqual([]);
    /* The state a reader is in the first time they reach a scrolled tree: nothing selected, and the
       ONE tab stop is wherever the element could put it — the first row the window drew, because
       the row `current` names is not one of them. The caret has to name that row too, or the first
       key press reports a move `from` nothing and the panel answers it about the top of the
       document, a hundred and fifty rows away from what is on screen. */
    const first = treeItems(host)[0]!;
    expect(first.tabIndex).toBe(0);
    const index = Number(first.dataset.value!.split("/")[1]);

    press(first, "ArrowUp");
    await flush();

    expect(selection()).toEqual([childPath(index - 1)]);
  });

  test("← climbs to a parent the window is not drawing", async () => {
    await scrollTo(OUTLINE_ROW_HEIGHT * 150);
    const child = rowFor(150)!;
    click(child);
    await flush();
    // The parent is the ROOT, and it scrolled off the top a hundred and fifty rows ago.
    expect(rowFor(0)).toBeNull();
    expect(treeItems(host).every((el) => el.getAttribute("aria-level") === "2")).toBe(true);

    press(child, "ArrowLeft");
    await flush();

    /* The one key that could never have been the element's. `jx-tree` climbs to the nearest DRAWN
       row at a shallower level, and every row on screen here is a sibling — so it says `move` and
       the panel answers from the parent index the row model recorded as it built the rows. A scan
       backwards for a smaller level would have found nothing at all. */
    expect(selection()).toEqual([[]]);
  });

  test("Home comes back to the root, and the keyboard comes with it", async () => {
    await scrollTo(OUTLINE_ROW_HEIGHT * 150);
    /* A key arrives at a FOCUSED row — that is what a keypress is — and the handoff is gated on
       it: `jx-tree` takes the keyboard to the revealed row only if the keyboard was the tree's to
       begin with, so a tree the reader never entered cannot yank focus out of wherever they are.
       A bare `dispatchEvent` on an unfocused row is the one case the element must decline. */
    rowFor(150)!.focus();
    press(rowFor(150)!, "Home");
    await flush();
    expect(selection()).toEqual([[]]);
    expect(scroller.scrollTop).toBe(0);
    /* And the keyboard is ON the root, not merely near it. The root's `pathKey([])` is the EMPTY
       STRING and that is a row value like any other: a tree reading `current: ""` as "there is no
       caret" would answer Home by scrolling the panel and leaving the reader focused a hundred and
       fifty rows down, with the tab stop and the selection somewhere they are not. */
    expect(row(host, "")).not.toBeNull();
    /* Compared by VALUE, not by node. A `toBe` on a live element that fails makes Bun's failure
       printer walk the happy-dom object graph, and the run goes out of memory instead of red. */
    const active = document.activeElement as HTMLElement | null;
    expect(
      `${active?.localName ?? "none"}[value=${JSON.stringify(active?.getAttribute("value"))}]`,
    ).toBe('jx-tree-item[value=""]');
  });

  test("↓ walks past the last DRAWN row instead of stopping at it", async () => {
    const last = treeItems(host).at(-1)!;
    const lastIndex = Number(last.dataset.value!.split("/")[1]);
    /* The caret is put on the row the key is pressed on, which is the app's own invariant rather
       than a convenience: Tab lands on the tab stop, and every gesture that moves the focus writes
       the caret before it moves anything. `jx-tree` reports the CARET's row as the one a move is
       from, so a test that pressed a key on a row the caret was not on would be measuring a state
       the tree cannot be in. */
    click(last);
    await flush();
    press(last, "ArrowDown");
    await flush();
    expect(selection()).toEqual([childPath(lastIndex + 1)]);
  });
});

describe("the reveal that follows a selection made elsewhere", () => {
  test("scrolls to a row the canvas selected far below the window", async () => {
    registerLayersPanel();
    activeTab.value!.session.selection = [childPath(180)];

    getPanel("layers")!.afterRender!(
      {
        deps: { getCanvasMode: () => "canvas", registerLayersDnD: () => {} },
        // The Navigator's answer to a repaint request is another `afterRender`, which is what
        // Carries the scroll watch's request for the second, windowed pass back to the rows.
        rerender: () => {
          void draw();
        },
      } as unknown as NavigatorPanelContext,
      host,
    );
    await flush(2);
    expect(scroller.scrollTop).toBeGreaterThan(OUTLINE_ROW_HEIGHT * 100);

    // A browser fires `scroll` after a programmatic `scrollTop`, and the watch repaints on it —
    // Which is why the reveal does not repaint itself. happy-dom does not, so the event is the one
    // Thing this test has to supply.
    place();
    scroller.dispatchEvent(new Event("scroll"));
    await flush(3);
    expect(rowFor(180)).not.toBeNull();
  });

  /*
   * The reveal follows the SELECTION, and a repaint is not a selection.
   *
   * A scroll changes the window, the window asks for a repaint, and the repaint re-runs this
   * panel's `afterRender` — so a reveal on every mount made the Outline unbrowsable past its own
   * selection. Measured in a browser on `sites/jxsuite.com/pages/compare.json`, selected row 840px
   * down an 890px viewport: asked 400 → got 400, asked 800 → got 800, asked 1500 → got 555, asked
   * 2400 → got 555. Everything past the selection was unreachable.
   *
   * This is the half a suite can hold: the DECISION not to reveal, which is arithmetic over the
   * model. That the reader's scroll survives a real wheel gesture in a real layout is the half only
   * a browser can answer, and it was driven there.
   */
  test("a scroll past the selection is not undone by the repaint it causes", async () => {
    activeTab.value!.session.selection = [childPath(10)];
    await draw();
    // The selection moved, so it was revealed: the window holds row 10 and the scroller is near it.
    expect(scroller.scrollTop).toBeLessThan(OUTLINE_ROW_HEIGHT * 20);

    await scrollTo(OUTLINE_ROW_HEIGHT * 150);

    expect(scroller.scrollTop).toBe(OUTLINE_ROW_HEIGHT * 150);
    expect(rowFor(150)).not.toBeNull();
  });

  test("a selection made elsewhere is still revealed once the reader has scrolled away", async () => {
    await scrollTo(OUTLINE_ROW_HEIGHT * 150);
    expect(rowFor(3)).toBeNull();

    activeTab.value!.session.selection = [childPath(3)];
    await draw();

    expect(scroller.scrollTop).toBeLessThan(OUTLINE_ROW_HEIGHT * 20);
  });
});

describe("a drag keeps the window it started with", () => {
  test("a scroll mid-drag does not repaint the rows pragmatic-dnd is holding", async () => {
    const dragged = treeItems(host)[2]!;
    dragged.dataset.dragging = "";
    const before = treeItems(host).length;

    scroller.scrollTop = OUTLINE_ROW_HEIGHT * 100;
    place();
    scroller.dispatchEvent(new Event("scroll"));
    await flush(3);

    expect(treeItems(host)).toHaveLength(before);
    expect(dragged.isConnected).toBe(true);
    expect(rowFor(100)).toBeNull();
  });
});

describe("the panel takes its own body down", () => {
  test("switching the pane to Project Styles removes the tree it drew", async () => {
    registerLayersPanel();
    expect(treeItems(host).length).toBeGreaterThan(0);
    getPanel("layers")!.afterRender!(
      {
        deps: { getCanvasMode: () => "stylebook", registerLayersDnD: () => {} },
        rerender: () => {},
      } as unknown as NavigatorPanelContext,
      host,
    );
    await flush(3);
    // Both bodies are APPENDED into the same content box, so a body nobody takes down sits under
    // The one that replaced it for the rest of the session.
    expect(host.querySelector('[part="outline"]')).toBeNull();
    expect(view._layersCollapsed).toBeDefined();
  });
});
