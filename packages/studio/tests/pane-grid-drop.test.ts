/**
 * The pane grid's right-edge drop zone (§18.1) — the target that creates a second pane.
 *
 * The pragmatic adapter is mocked so registrations are captured and their callbacks invoked
 * directly with synthetic payloads, the same shape `tests/dnd-gaps.test.ts` uses. This is the
 * ARMING half: `panels/tab-strip.ts`'s own monitor is what actually resolves a drop, so resolution
 * itself is `tests/tab-drop.test.ts`'s job.
 */
import { flush, resetStudioState, resetWorkspaceWithTab, stubRect } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type AnyRec = Record<string, any>;

const dropTargets = new Map<Element, AnyRec>();
const monitors: AnyRec[] = [];
const released = new Set<Element>();

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
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

const { PRIMARY_PANE, SECONDARY_PANE, closeAllTabs, closePane, splitRight, workspace } =
  await import("../src/workspace/workspace");
const { DEFAULT_PANE_SPLIT, resetShellSurfaces, shell } = await import("../src/shell");
const { cellForPane, mount, paneGridReady, unmount } = await import("../src/panels/pane-grid");

function grid(): HTMLElement {
  return document.querySelector("#pane-grid") as HTMLElement;
}

function standUpGrid(): HTMLElement {
  document.body.innerHTML = `<div id="app"><div id="pane-grid"></div></div>`;
  return grid();
}

/** Ask a pane's registered drop zone what a hover at `clientX` would answer. */
function getDataFor(paneId: string, clientX: number): AnyRec {
  const element = cellForPane(paneId)!.dropZone;
  const cfg = dropTargets.get(element)!;
  return cfg.getData({ input: { clientX } });
}

/** Whether a pane's drop zone currently accepts a tab-drop source. */
function canDropFor(paneId: string): boolean {
  const cfg = dropTargets.get(cellForPane(paneId)!.dropZone)!;
  return cfg.canDrop({ source: { data: { paneId: "primary", tabId: "a", type: "tab" } } });
}

beforeEach(async () => {
  resetStudioState();
  closeAllTabs();
  shell.paneSplit = DEFAULT_PANE_SPLIT;
  dropTargets.clear();
  released.clear();
  monitors.length = 0;
  standUpGrid();
  mount();
  await paneGridReady();
  // 320px wide — bigger than the 120px band floor, so the band is the fixed 120px case.
  stubRect(cellForPane(PRIMARY_PANE)!.dropZone, { left: 0, width: 320 });
});

afterEach(() => {
  unmount();
  resetShellSurfaces();
  closeAllTabs();
});

describe("registration", () => {
  test("every pane's drop zone is registered, and accepts a tab-drop source by default", () => {
    expect(dropTargets.has(cellForPane(PRIMARY_PANE)!.dropZone)).toBe(true);
    expect(canDropFor(PRIMARY_PANE)).toBe(true);
  });

  test("a source this module does not recognise is refused by canDrop", () => {
    const cfg = dropTargets.get(cellForPane(PRIMARY_PANE)!.dropZone)!;
    expect(cfg.canDrop({ source: { data: { type: "block" } } })).toBe(false);
  });
});

describe("edgeData — only the last pane under the cap accepts its right band", () => {
  test("the right 120px band of the (only, last) pane accepts", () => {
    // Right edge is at x=320; the band is [200, 320].
    expect(getDataFor(PRIMARY_PANE, 250).type).toBe("pane-edge");
    expect(getDataFor(PRIMARY_PANE, 250).paneId).toBe(PRIMARY_PANE);
  });

  test("outside the band, on the same pane, is refused", () => {
    expect(getDataFor(PRIMARY_PANE, 50).type).toBe("pane-edge-refused");
  });

  test("both zones refuse once the grid is already at MAX_PANES", async () => {
    resetWorkspaceWithTab();
    splitRight();
    await flush();
    stubRect(cellForPane(PRIMARY_PANE)!.dropZone, { left: 0, width: 320 });
    stubRect(cellForPane(SECONDARY_PANE)!.dropZone, { left: 320, width: 320 });

    expect(getDataFor(PRIMARY_PANE, 300).type).toBe("pane-edge-refused");
    expect(getDataFor(SECONDARY_PANE, 620).type).toBe("pane-edge-refused");
  });

  test("with one pane, only the LAST pane's zone would ever accept — there is only one", () => {
    // Degenerate but worth stating: `edgeData` checks identity against `panes.at(-1)`, not against
    // "the primary" by name, so a single-pane grid's only pane is trivially both.
    expect(workspace.panes).toHaveLength(1);
    expect(getDataFor(PRIMARY_PANE, 250).type).toBe("pane-edge");
  });
});

describe("arming", () => {
  function armingMonitor(): AnyRec {
    return monitors.at(-1)!;
  }

  test("inert by default: no pane carries data-armed", () => {
    expect(cellForPane(PRIMARY_PANE)!.dropZone.dataset.armed !== undefined).toBe(false);
  });

  test("a recognised drag start arms every zone", () => {
    armingMonitor().onDragStart!({
      source: { data: { paneId: "primary", tabId: "a", type: "tab" } },
    });
    expect(cellForPane(PRIMARY_PANE)!.dropZone.dataset.armed !== undefined).toBe(true);
  });

  test("hovering the band lights data-over on that pane only, and nowhere else once it moves off", async () => {
    resetWorkspaceWithTab();
    splitRight();
    await flush();
    stubRect(cellForPane(PRIMARY_PANE)!.dropZone, { left: 0, width: 320 });
    stubRect(cellForPane(SECONDARY_PANE)!.dropZone, { left: 320, width: 320 });

    armingMonitor().onDrag!({
      location: {
        current: { dropTargets: [{ data: { paneId: SECONDARY_PANE, type: "pane-edge" } }] },
      },
    });
    expect(cellForPane(SECONDARY_PANE)!.dropZone.dataset.over !== undefined).toBe(true);
    expect(cellForPane(PRIMARY_PANE)!.dropZone.dataset.over !== undefined).toBe(false);

    armingMonitor().onDrag!({ location: { current: { dropTargets: [] } } });
    expect(cellForPane(SECONDARY_PANE)!.dropZone.dataset.over !== undefined).toBe(false);
  });

  test("onDrop disarms every zone", () => {
    armingMonitor().onDragStart!({
      source: { data: { paneId: "primary", tabId: "a", type: "tab" } },
    });
    expect(cellForPane(PRIMARY_PANE)!.dropZone.dataset.armed !== undefined).toBe(true);
    armingMonitor().onDrop!({ location: { current: { dropTargets: [] } } });
    expect(cellForPane(PRIMARY_PANE)!.dropZone.dataset.armed !== undefined).toBe(false);
  });

  test("this monitor never resolves a drop — it only ever writes the surface's drag state", () => {
    const before = workspace.panes.length;
    armingMonitor().onDrop!({
      source: { data: { paneId: "primary", tabId: "a", type: "tab" } },
      location: {
        current: { dropTargets: [{ data: { paneId: PRIMARY_PANE, type: "pane-edge" } }] },
      },
    });
    expect(workspace.panes).toHaveLength(before);
  });
});

describe("teardown", () => {
  test("a departing cell releases its drop zone's registration", async () => {
    resetWorkspaceWithTab();
    splitRight();
    await flush();
    const zone = cellForPane(SECONDARY_PANE)!.dropZone;
    expect(dropTargets.has(zone)).toBe(true);
    expect(released.has(zone)).toBe(false);

    closePane(SECONDARY_PANE);
    await flush();
    expect(released.has(zone)).toBe(true);
  });

  test("unmount releases the arming monitor", () => {
    expect(monitors.at(-1)!.__released).toBeUndefined();
    unmount();
    expect(monitors.at(-1)!.__released).toBe(true);
  });
});
