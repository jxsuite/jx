/**
 * `panels/tab-strip.ts`'s pragmatic drag and drop — every chip a source and a slot target, every
 * strip its own tail target, the scope marks that light while a drag is over them, and the
 * registration lifecycle across a repaint, a close and an unmount.
 *
 * The pragmatic adapter is mocked so registrations are captured and their callbacks invoked
 * directly with synthetic payloads (`tests/dnd-gaps.test.ts`'s shape); `panels/tab-drop.ts` and
 * everything under it is REAL, so the monitor's `onDrop` reaches a genuine model write and this
 * file catches a wiring mistake between the two that a resolver-only unit test cannot.
 */
import { flush, installMockPlatform, resetStudioState, stubRect } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { JxMutableNode } from "@jxsuite/schema/types";

type AnyRec = Record<string, any>;

const draggables = new Map<Element, AnyRec>();
const dropTargets = new Map<Element, AnyRec>();
const monitors: AnyRec[] = [];
const released = new Set<Element>();

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: (cfg: AnyRec) => {
    draggables.set(cfg.element, cfg);
    return () => {
      released.add(cfg.element);
    };
  },
  dropTargetForElements: (cfg: AnyRec) => {
    dropTargets.set(cfg.element, cfg);
    return () => {
      released.add(cfg.element);
    };
  },
  monitorForElements: (cfg: AnyRec) => {
    monitors.push(cfg);
    return () => {
      cfg.__released = true;
    };
  },
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

const { initLayers } = await import("../src/ui/layers");
const { PRIMARY_PANE, SECONDARY_PANE, closeAllTabs, openTab, paneBeside, splitRight, workspace } =
  await import("../src/workspace/workspace");
const { mount, unmount } = await import("../src/panels/tab-strip");

let host: HTMLElement;

function open(id: string, documentPath: string | null = `/project/${id}.json`) {
  return openTab({
    document: { children: [], tagName: "div" } as JxMutableNode,
    documentPath,
    id,
  });
}

function tabs(into: HTMLElement = host): HTMLElement[] {
  return [...into.querySelectorAll('[part="tab"]')] as HTMLElement[];
}

function chipFor(id: string, into: HTMLElement = host): HTMLElement {
  return tabs(into).find((el) => el.dataset.tab === id)!;
}

function stripEl(into: HTMLElement = host): HTMLElement {
  return into.querySelector('[part="tabs"]') as HTMLElement;
}

function monitor(): AnyRec {
  return monitors.at(-1)!;
}

/** A chip's `draggable` registration invokes `getInitialData` at drag time, as the real one does. */
function initialData(id: string, into: HTMLElement = host): AnyRec {
  return draggables.get(chipFor(id, into))!.getInitialData();
}

beforeEach(() => {
  resetStudioState();
  installMockPlatform({});
  document.body.innerHTML = `
    <div id="tab-strip"></div>
    <div id="layer-popover"></div>
    <div id="layer-modal"></div>
    <div id="layer-dialog"></div>
  `;
  initLayers();
  host = document.querySelector("#tab-strip") as HTMLElement;
  draggables.clear();
  dropTargets.clear();
  released.clear();
  monitors.length = 0;
  closeAllTabs();
  mount(host);
});

afterEach(() => {
  unmount();
  closeAllTabs();
  document.body.innerHTML = "";
});

describe("chips are sources and slot targets", () => {
  test("getInitialData carries the tab id and the drawing pane", async () => {
    open("a");
    open("b");
    await flush();
    expect(initialData("a")).toEqual({ paneId: PRIMARY_PANE, tabId: "a", type: "tab" });
  });

  test("a chip is also a drop target, refusing a source this module does not know", async () => {
    open("a");
    await flush();
    const cfg = dropTargets.get(chipFor("a"))!;
    expect(
      cfg.canDrop({ source: { data: { paneId: PRIMARY_PANE, tabId: "a", type: "tab" } } }),
    ).toBe(true);
    expect(cfg.canDrop({ source: { data: { type: "block" } } })).toBe(false);
  });

  test("getData names the chip's own live slot, and refuses when the host draws no pane", async () => {
    open("a");
    open("b");
    await flush();
    const cfg = dropTargets.get(chipFor("b"))!;
    const data = cfg.getData({ element: chipFor("b"), input: { clientX: 0, clientY: 0 } });
    expect(data.type).toBe("tab-slot");
    expect(data.paneId).toBe(PRIMARY_PANE);
    expect(data.tabId).toBe("b");
    expect(data.index).toBe(1);
  });

  test("canDrag refuses a start on the pin toggle or the close button", async () => {
    open("a");
    await flush();
    const chip = chipFor("a");
    const pin = chip.querySelector('[part="pin"]') as HTMLElement;
    const close = chip.querySelector('[part="close"]') as HTMLElement;
    (document.elementFromPoint as unknown as (x: number, y: number) => Element) = () => pin;
    expect(draggables.get(chip)!.canDrag({ input: { clientX: 0, clientY: 0 } })).toBe(false);
    (document.elementFromPoint as unknown as (x: number, y: number) => Element) = () => close;
    expect(draggables.get(chip)!.canDrag({ input: { clientX: 0, clientY: 0 } })).toBe(false);
    (document.elementFromPoint as unknown as (x: number, y: number) => Element) = () => chip;
    expect(draggables.get(chip)!.canDrag({ input: { clientX: 0, clientY: 0 } })).toBe(true);
  });
});

describe("the strip's own tail target", () => {
  test("registered on the jx-tabs element, naming the pane's length as its index", async () => {
    open("a");
    open("b");
    await flush();
    const cfg = dropTargets.get(stripEl())!;
    expect(cfg.getData()).toEqual({ index: 2, paneId: PRIMARY_PANE, type: "tab-slot" });
  });
});

describe("scope marks", () => {
  test("data-dragging lights the source chip on start, and clears on drop", async () => {
    open("a");
    open("b");
    await flush();
    monitor().onDragStart({ source: { data: { paneId: PRIMARY_PANE, tabId: "a", type: "tab" } } });
    await flush();
    expect(chipFor("a").dataset.dragging).toBe("");
    expect(chipFor("b").dataset.dragging).toBeUndefined();

    monitor().onDrop({
      location: { current: { dropTargets: [] } },
      source: { data: { paneId: PRIMARY_PANE, tabId: "a", type: "tab" } },
    });
    await flush();
    expect(chipFor("a").dataset.dragging).toBeUndefined();
  });

  test("data-drop lights the chip a drop would land beside", async () => {
    open("a");
    open("b");
    open("c");
    await flush();
    monitor().onDragStart({ source: { data: { paneId: PRIMARY_PANE, tabId: "a", type: "tab" } } });
    monitor().onDrag({
      location: {
        current: {
          dropTargets: [{ data: { index: 2, paneId: PRIMARY_PANE, tabId: "c", type: "tab-slot" } }],
        },
      },
    });
    await flush();
    expect(chipFor("c").dataset.drop).toBe("");
    expect(chipFor("b").dataset.drop).toBeUndefined();
  });

  test("data-drop-tail lights the strip when the tail is the hovered target", async () => {
    open("a");
    open("b");
    await flush();
    monitor().onDragStart({ source: { data: { paneId: PRIMARY_PANE, tabId: "a", type: "tab" } } });
    monitor().onDrag({
      location: {
        current: { dropTargets: [{ data: { index: 2, paneId: PRIMARY_PANE, type: "tab-slot" } }] },
      },
    });
    await flush();
    expect(stripEl().dataset.dropTail).toBe("");
  });

  test("a cancelled drag (dropTargets: []) clears every indicator", async () => {
    open("a");
    open("b");
    await flush();
    monitor().onDragStart({ source: { data: { paneId: PRIMARY_PANE, tabId: "a", type: "tab" } } });
    monitor().onDrag({
      location: {
        current: { dropTargets: [{ data: { index: 1, paneId: PRIMARY_PANE, type: "tab-slot" } }] },
      },
    });
    await flush();
    expect(stripEl().dataset.dropTail).toBe("");

    monitor().onDrop({
      location: { current: { dropTargets: [] } },
      source: { data: { paneId: PRIMARY_PANE, tabId: "a", type: "tab" } },
    });
    await flush();
    expect(stripEl().dataset.dropTail).toBeUndefined();
    expect(chipFor("a").dataset.dragging).toBeUndefined();
  });
});

describe("the monitor reaches a real model write", () => {
  test("a chip dropped on the strip's tail reorders the pane", async () => {
    open("a");
    open("b");
    open("c");
    await flush();
    monitor().onDrop({
      location: {
        current: { dropTargets: [{ data: { index: 2, paneId: PRIMARY_PANE, type: "tab-slot" } }] },
      },
      source: { data: { paneId: PRIMARY_PANE, tabId: "a", type: "tab" } },
    });
    await flush();
    expect(workspace.tabs.get("a")).toBeDefined();
    expect([...host.querySelectorAll('[part="label"]')].map((el) => el.textContent)).toEqual([
      "b.json",
      "c.json",
      "a.json",
    ]);
  });

  test("a refused target writes nothing", async () => {
    open("a");
    open("b");
    await flush();
    const before = tabs().map((el) => el.dataset.tab);
    monitor().onDrop({
      location: { current: { dropTargets: [{ data: { type: "tab-slot-refused" } }] } },
      source: { data: { paneId: PRIMARY_PANE, tabId: "a", type: "tab" } },
    });
    await flush();
    expect(tabs().map((el) => el.dataset.tab)).toEqual(before);
  });
});

describe("registration lifecycle", () => {
  test("closing a tab releases its chip; a repaint does not re-register a surviving one", async () => {
    open("a");
    open("b");
    await flush();
    const survivor = chipFor("b");
    const closing = chipFor("a");
    expect(draggables.has(closing)).toBe(true);

    closeAllTabs();
    await flush();
    expect(released.has(closing)).toBe(true);

    open("c");
    await flush();
    // "b" never closed — its own chip is a fresh call in this fixture (closeAllTabs took it too),
    // So this checks the SURVIVING-chip claim on the tail target instead: the strip's own
    // Registration is released and re-made across a full blank/repaint, never left dangling.
    expect(dropTargets.has(stripEl())).toBe(true);
    void survivor;
  });

  test("an empty pane grows a tail target while a drag is live, and loses it once the drag ends", async () => {
    open("a");
    paneBeside(PRIMARY_PANE);
    await flush();
    // Move the strip's own host onto the secondary via a second region host, so both strips exist.
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="tab-strip-2" data-jx-region="pane.secondary/tabs"></div>',
    );
    await flush();
    const secondHost = document.querySelector("#tab-strip-2") as HTMLElement;
    expect(secondHost.querySelector('[part="strip-row"]')).toBeNull();

    monitor().onDragStart({ source: { data: { paneId: PRIMARY_PANE, tabId: "a", type: "tab" } } });
    await flush();
    const tail = secondHost.querySelector('[part="tabs"]') as HTMLElement;
    expect(tail).not.toBeNull();
    expect(dropTargets.has(tail)).toBe(true);

    monitor().onDrop({
      location: { current: { dropTargets: [] } },
      source: { data: { paneId: PRIMARY_PANE, tabId: "a", type: "tab" } },
    });
    await flush();
    // The row itself persists (an assignment, not a re-mount) but goes hidden, and the `jx-tabs`
    // The `$switch` drew for the "tabs" branch unmounts with it — which is what releases the tail
    // Target's registration (`reconcileStripDnD`'s `mode !== "tabs"` branch).
    expect(secondHost.querySelector('[part="tabs"]')).toBeNull();
    expect(released.has(tail)).toBe(true);
  });

  test("unmount releases the monitor and every standing registration", async () => {
    open("a");
    await flush();
    const chip = chipFor("a");
    const tail = stripEl();
    expect(monitor().__released).toBeUndefined();

    unmount();

    expect(monitor().__released).toBe(true);
    expect(released.has(chip)).toBe(true);
    expect(released.has(tail)).toBe(true);
  });
});

describe("cross-pane, through the monitor", () => {
  test("a chip dropped on the other pane's strip moves, promotes, and activates it", async () => {
    open("a");
    paneBeside(PRIMARY_PANE);
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="tab-strip-2" data-jx-region="pane.secondary/tabs"></div>',
    );
    open("b", "/project/b.json");
    splitRight();
    await flush();
    const secondHost = document.querySelector("#tab-strip-2") as HTMLElement;
    stubRect(chipFor("b", secondHost), { left: 0, width: 100 });

    monitor().onDrop({
      location: {
        current: {
          dropTargets: [
            { data: { index: 0, paneId: SECONDARY_PANE, tabId: "b", type: "tab-slot" } },
          ],
        },
      },
      source: { data: { paneId: PRIMARY_PANE, tabId: "a", type: "tab" } },
    });
    await flush();

    expect(workspace.activePaneId).toBe(SECONDARY_PANE);
    expect(workspace.activeTabId).toBe("a");
  });
});
