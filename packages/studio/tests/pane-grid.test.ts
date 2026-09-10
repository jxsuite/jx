import { flush, resetStudioState, resetWorkspaceWithTab, stubRect } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  PRIMARY_PANE,
  SECONDARY_PANE,
  closeAllTabs,
  closePane,
  focusPane,
  openTab,
  splitRight,
  workspace,
} from "../src/workspace/workspace";
import { listRegions, resolveAllRegions, resolveRegion } from "../src/ui/regions";
import { DEFAULT_PANE_SPLIT, resetShellSurfaces, shell } from "../src/shell";
import { surfaceForPane } from "../src/canvas/surface-registry";
import { PANE_SELECTOR, STAGE_SELECTOR } from "../src/surfaces/pane-grid";
import { cellForPane, mount, paneGridReady, reconcile, unmount } from "../src/panels/pane-grid";

/**
 * The pane grid, as DOM.
 *
 * Three properties, and the first two are the ones no other gate can see:
 *
 * 1. **A cell is complete before it is published** (§18.1 rule 1). The stage, the strip and both
 *    region stamps exist in the same tick the cell first appears in the document.
 * 2. **Reconciling twice does nothing.** The grid is driven by a reactive effect over
 *    `workspace.panes`, which re-runs for reasons that are not pane changes; a reconciler that
 *    rebuilt would throw away the canvas's render root and every live iframe with it.
 * 3. **Region ids are derived from the pane, and UNIQUE.** `pane.primary` used to be a row of the
 *    `SHELL_REGION_HOSTS` table pointing at `#canvas-wrap`. Sixty screenshots crop it and its two
 *    siblings. Each has to still resolve, to exactly one element, and to the PRIMARY cell's stage
 *    rather than to the whole cell or to the side pane's.
 *
 * **Nothing below names a class**, and that is the conversion's own gate: the grid is a Jx document
 * now, so `.pane`, `.pane-stage` and `.pane-splitter` are gone and every query here is a `part`, a
 * region or a role. The one assertion that could not survive verbatim is the splitter's place in
 * the grid — it lived between two cells as their sibling and now lives inside its own row wrapper,
 * which generates no box — so it is re-authored as what it always stood for: DOCUMENT ORDER, and
 * membership of neither cell.
 */

/* The kit element, not the part it is addressed by. Both match the same node today, and only one
   of them goes red if the document ever writes its own separator again. */
const SPLITTER_SELECTOR = "jx-split";

function grid(): HTMLElement {
  return document.querySelector("#pane-grid") as HTMLElement;
}

function standUpGrid(): HTMLElement {
  document.body.innerHTML = `<div id="app"><div id="pane-grid"></div></div>`;
  return grid();
}

beforeEach(async () => {
  resetStudioState();
  closeAllTabs();
  shell.paneSplit = DEFAULT_PANE_SPLIT;
  standUpGrid();
  mount();
  await paneGridReady();
});

afterEach(() => {
  unmount();
  resetShellSurfaces();
  closeAllTabs();
});

describe("the cell", () => {
  test("the primary pane gets one cell, complete, with both region stamps", () => {
    const cell = cellForPane(PRIMARY_PANE);
    expect(cell).not.toBeNull();
    expect(cell!.root.isConnected).toBe(true);
    // Complete: the four surfaces are children of the root that was appended, not added after.
    expect([...cell!.root.children]).toEqual([cell!.strip, cell!.jump, cell!.chrome, cell!.stage]);
    expect(resolveRegion("pane.primary")).toBe(cell!.stage);
    expect(resolveRegion("pane.primary/tabs")).toBe(cell!.strip);
  });

  test("`pane.primary` names the STAGE, not the cell — widening it would widen nine shots", () => {
    const cell = cellForPane(PRIMARY_PANE)!;
    expect(resolveRegion("pane.primary")).not.toBe(cell.root);
    /* The stage's identity is a `part` and nothing else. It was a `.pane-stage` class, which is
       what `editor/shortcuts.ts`'s ctrl-wheel guard tested with `closest()`; the document emits no
       class, so the guard's selector is the one exported beside the document. */
    expect(cell.stage.getAttribute("part")).toBe("pane-stage");
    expect(cell.stage.className).toBe("");
    expect(cell.stage.closest(STAGE_SELECTOR)).toBe(cell.stage);
    expect(cell.root.getAttribute("part")).toBe("pane");
    expect(cell.stage.closest(PANE_SELECTOR)).toBe(cell.root);
  });

  test("nothing the grid draws carries a class at all", () => {
    /* The conversion's own gate. Every box below was a class in `styles/shell.css`; the rules moved
       into the document and are keyed on `part`, so a class reappearing here is a surface that has
       quietly opted back out of the design system. */
    const cell = cellForPane(PRIMARY_PANE)!;
    const classed = [...grid().querySelectorAll("*")].filter((el) => el.className !== "");
    expect(classed.map((el) => `${el.nodeName.toLowerCase()}.${el.className}`)).toEqual([]);
    for (const el of [cell.root, cell.strip, cell.jump, cell.chrome, cell.stage]) {
      expect(el.className).toBe("");
    }
  });

  test("the surface is registered against the stage before the cell is in the document", () => {
    const cell = cellForPane(PRIMARY_PANE)!;
    expect(surfaceForPane(PRIMARY_PANE).wrap).toBe(cell.stage);
    expect(surfaceForPane(PRIMARY_PANE).paneId).toBe(PRIMARY_PANE);
  });

  test("`pane` and `pane/x` still canonicalise onto the primary", () => {
    expect(resolveRegion("pane")).toBe(cellForPane(PRIMARY_PANE)!.stage);
    expect(resolveRegion("pane/tabs")).toBe(cellForPane(PRIMARY_PANE)!.strip);
  });
});

describe("reconcile", () => {
  test("is idempotent: a second pass performs no DOM operation at all", () => {
    /* Watched rather than mocked. `grid.append` was the only way in when the reconciler built its
       own nodes; a document's repeater inserts through `insertBefore`, so a mocked `append` would
       pass this test without ever proving anything. A subtree `childList` observer answers the real
       question — did the second pass touch one node — whichever call it would have used. */
    const before = cellForPane(PRIMARY_PANE)!.root;
    const observer = new MutationObserver(() => {});
    observer.observe(grid(), { childList: true, subtree: true });
    reconcile();
    reconcile();
    const touched = observer.takeRecords().length;
    observer.disconnect();
    expect(touched).toBe(0);
    expect(cellForPane(PRIMARY_PANE)!.root).toBe(before);
  });

  test("the stage element survives a reconcile, so the canvas keeps its render root", () => {
    const { stage } = cellForPane(PRIMARY_PANE)!;
    const marker = document.createElement("span");
    stage.append(marker);
    reconcile();
    expect(cellForPane(PRIMARY_PANE)!.stage).toBe(stage);
    expect(marker.isConnected).toBe(true);
  });

  test("a pane that leaves `workspace.panes` loses its cell and its surface record", async () => {
    resetWorkspaceWithTab();
    workspace.panes = [
      ...workspace.panes,
      { activeTabId: null, derived: null, id: "ghost", tabOrder: [] as string[] },
    ];
    await flush();
    const ghost = cellForPane("ghost");
    expect(ghost).not.toBeNull();
    expect(document.querySelectorAll(PANE_SELECTOR)).toHaveLength(2);

    workspace.panes = workspace.panes.filter((pane) => pane.id !== "ghost");
    await flush();
    expect(cellForPane("ghost")).toBeNull();
    expect(ghost!.root.isConnected).toBe(false);
    expect(resolveAllRegions("pane.ghost")).toHaveLength(0);
    expect(document.querySelectorAll(PANE_SELECTOR)).toHaveLength(1);
  });

  test("gaining a pane does not touch the cell that was already there", async () => {
    /* The load-bearing property of the reconciler. Re-parenting is not a move for an `<iframe>`:
       it reloads, which drops its `iframe-channel` connection, its shadow document and every panel
       that had reached `ready`. A grid that rebuilt on every pane change would blank the pane you
       were NOT splitting. */
    resetWorkspaceWithTab();
    /* Drained first. Building a cell schedules a canvas render for it, and that pass owns the
       stage's children — so a marker planted before the boot render lands is wiped by the canvas
       doing its job rather than by the grid rebuilding anything. */
    await flush();
    const before = cellForPane(PRIMARY_PANE)!;
    const marker = document.createElement("span");
    before.stage.append(marker);
    const surface = surfaceForPane(PRIMARY_PANE);

    workspace.panes = [
      ...workspace.panes,
      { activeTabId: null, derived: null, id: SECONDARY_PANE, tabOrder: [] as string[] },
    ];
    await flush();

    expect(cellForPane(PRIMARY_PANE)).toBe(before);
    expect(cellForPane(PRIMARY_PANE)!.stage).toBe(before.stage);
    expect(marker.isConnected).toBe(true);
    expect(marker.parentElement).toBe(before.stage);
    expect(surfaceForPane(PRIMARY_PANE)).toBe(surface);
    expect(surface.wrap).toBe(before.stage);
  });
});

describe("the grid's own tracks", () => {
  test("one cell is one full-width track, and there is no splitter", () => {
    expect(grid().style.gridTemplateColumns).toBe("minmax(0, 1fr)");
    expect(grid().querySelector(SPLITTER_SELECTOR)).toBeNull();
  });

  test("`shell.paneSplit` clamps, and is inert while the grid is unsplit", () => {
    shell.paneSplit = 0.3;
    reconcile();
    // Still one cell, so still one track: a restored split with nothing to split is harmless.
    expect(grid().style.gridTemplateColumns).toBe("minmax(0, 1fr)");
  });

  test("the tracks are written on the HOST, which is outside the document", () => {
    /* Where they are is the whole of defect S2's fix. `#pane-grid` is `surfaces/shell.json`'s cell,
       not anything this grid draws, so the one property a `pointermove` writes cannot be part of a
       projection and can never move a node. */
    expect(grid().id).toBe("pane-grid");
    expect(grid().hasAttribute("part")).toBe(false);
    expect(cellForPane(PRIMARY_PANE)!.root.parentElement).not.toBe(grid());
  });
});

describe("unmount", () => {
  test("disposes every cell and forgets the grid", async () => {
    const cell = cellForPane(PRIMARY_PANE)!;
    unmount();
    expect(cell.root.isConnected).toBe(false);
    expect(cellForPane(PRIMARY_PANE)).toBeNull();
    expect(resolveAllRegions("pane.primary")).toHaveLength(0);
    // Idempotent: mounting again after an unmount is what a project switch does.
    mount();
    await paneGridReady();
    expect(cellForPane(PRIMARY_PANE)).not.toBeNull();
  });

  test("mounting with no `#pane-grid` in the document is inert, not a throw", () => {
    unmount();
    document.body.innerHTML = "";
    expect(() => {
      mount();
    }).not.toThrow();
    expect(cellForPane(PRIMARY_PANE)).toBeNull();
    // And reconciling without a grid is a no-op rather than a null dereference.
    expect(() => {
      reconcile();
    }).not.toThrow();
  });
});

describe("the second cell", () => {
  /** Split the model and let the grid catch up. Returns the two cells, in grid order. */
  async function split() {
    resetWorkspaceWithTab();
    resetWorkspaceWithTab(undefined, { documentPath: "/project/other.json", id: "other" });
    expect(splitRight()?.id).toBe(SECONDARY_PANE);
    await flush();
    /* Read back through `workspace.panes` rather than through an exported `paneCells()`. The
       reconciler no longer needs such a list — `layout()` counts PANES, because the document's rows
       land one microtask after the model does — and `tests/reachability.test.ts` refuses an export
       whose only caller is a test. */
    return workspace.panes.map((pane) => cellForPane(pane.id)!);
  }

  test("a split draws a second cell, complete, with its own stamps and its own surface", async () => {
    const cells = await split();
    expect(cells).toHaveLength(2);
    expect(cells.map((cell) => cell.paneId)).toEqual([PRIMARY_PANE, SECONDARY_PANE]);

    const side = cellForPane(SECONDARY_PANE)!;
    expect(side.root.isConnected).toBe(true);
    expect([...side.root.children]).toEqual([side.strip, side.jump, side.chrome, side.stage]);
    expect(resolveRegion("pane.secondary")).toBe(side.stage);
    expect(resolveRegion("pane.secondary/tabs")).toBe(side.strip);
    // Its own surface record, registered against its own stage.
    expect(surfaceForPane(SECONDARY_PANE).wrap).toBe(side.stage);
    expect(surfaceForPane(SECONDARY_PANE).wrap).not.toBe(cellForPane(PRIMARY_PANE)!.stage);
  });

  test("the four ids THIS module stamps resolve to exactly ONE element each", async () => {
    /* Uniqueness is the load-bearing invariant of the whole family: `resolveRegion` takes the LAST
       match, so two elements carrying `pane.primary` is not an error — it is a silently wrong
       answer, and the sixty shots that crop `pane.primary` and `pane.primary/tabs` would
       photograph the SIDE pane without anything going red.

       Scoped to what this module emits, and named rather than swept. The sweep used to run over
       `listRegions()` on a bare `#pane-grid` and its comment cited `pane.primary/context` — an id
       that is never in this DOM, because `panels/pane-context.ts` is not mounted here. A sweep is
       only as strong as the renderers standing in the document, and the version of it that mounts
       every pane-scoped renderer at once lives in `pane-regions.test.ts`. */
    await split();
    const stamped = ["pane.primary", "pane.secondary", "pane.primary/tabs", "pane.secondary/tabs"];
    for (const id of stamped) {
      expect(resolveAllRegions(id)).toHaveLength(1);
      expect(listRegions()).toContain(id);
    }
    // And nothing else in this DOM is ambiguous either.
    expect(
      listRegions().filter((id) => !id.startsWith("overlay") && resolveAllRegions(id).length !== 1),
    ).toEqual([]);
  });

  test("`pane.primary` still names the PRIMARY cell's stage, which is why no shot moved", async () => {
    await split();
    expect(resolveRegion("pane.primary")).toBe(cellForPane(PRIMARY_PANE)!.stage);
    expect(resolveRegion("pane.primary/tabs")).toBe(cellForPane(PRIMARY_PANE)!.strip);
    expect(resolveRegion("pane")).toBe(cellForPane(PRIMARY_PANE)!.stage);
  });

  test("two tracks, and the splitter is between the cells and inside neither", async () => {
    const cells = await split();
    expect(grid().style.gridTemplateColumns).toBe("minmax(0, 0.5fr) 5px minmax(0, 0.5fr)");

    const splitter = grid().querySelector<HTMLElement>(SPLITTER_SELECTOR);
    expect(splitter).not.toBeNull();
    /* BETWEEN them, asserted as DOCUMENT ORDER rather than as `previousElementSibling`. Each pane
       is drawn in a `display: contents` row wrapper holding its own leading splitter, so the three
       are grid items of `#pane-grid` in this order without being siblings in the tree — and the
       thing that mattered was always the order the grid places them in. Compared as NAMES: bun's
       diff printer does not come back from a live happy-dom element. */
    const order = [...grid().querySelectorAll(`${PANE_SELECTOR}, ${SPLITTER_SELECTOR}`)];
    const label = (node: Element) =>
      node === splitter ? "splitter" : ((node as HTMLElement).dataset["paneId"] ?? "?");
    expect(order.map((node) => label(node))).toEqual([PRIMARY_PANE, "splitter", SECONDARY_PANE]);
    expect(order[0]).toBe(cells[0]!.root);
    expect(order[2]).toBe(cells[1]!.root);
    // And in NEITHER cell, which is what keeps a drag on it out of the pane-focus listener.
    expect(splitter!.closest(PANE_SELECTOR)).toBeNull();

    shell.paneSplit = 0.7;
    reconcile();
    expect(grid().style.gridTemplateColumns).toBe(`minmax(0, 0.7fr) 5px minmax(0, ${1 - 0.7}fr)`);
  });

  test("the splitter drags the ratio, clamps at a usable pane, and double-click restores 50/50", async () => {
    /* `jx-split` owns the gesture now (ui.md §5.5) and this module owns two lines: `setPaneSplit`
       on every `input` and `persistDocks` on every `change`. The element measures the grid ITSELF —
       which is why the rect below is what has to be stubbed and `clientWidth` no longer is — so the
       320px floor travels as pixels and is converted against the box actually being divided. The
       ratio lives on `shell.paneSplit` — pure LAYOUT, naming no tab, no document and no pane
       identity — and persists with the dock widths through `persistDocks`. */
    stubRect(grid(), { height: 800, width: 1000 });
    await split();
    const splitter = grid().querySelector(SPLITTER_SELECTOR) as HTMLElement;

    const drag = (from: number, to: number) => {
      splitter.dispatchEvent(new PointerEvent("pointerdown", { clientX: from, clientY: 0 }));
      splitter.dispatchEvent(new PointerEvent("pointermove", { clientX: to, clientY: 0 }));
      splitter.dispatchEvent(new PointerEvent("pointerup", { clientX: to, clientY: 0 }));
    };

    // 150px right of centre, over a 1000px grid, is +0.15 of the ratio.
    drag(500, 650);
    expect(shell.paneSplit).toBeCloseTo(0.65, 5);
    /* The gesture's own mark, and it is an ATTRIBUTE the element mirrors rather than a class a
       module reaches in and writes: the surface emits no classes at all. Off again here, because
       the gesture ended. */
    expect(splitter.dataset["dragging"]).toBeUndefined();
    reconcile();
    expect(grid().style.gridTemplateColumns).toBe("minmax(0, 0.65fr) 5px minmax(0, 0.35fr)");

    // The floor is a PANE, not a sliver: 320px of a 1000px grid, on both sides, symmetrically.
    drag(500, -5000);
    expect(shell.paneSplit).toBeCloseTo(0.32, 5);
    drag(500, 5000);
    expect(shell.paneSplit).toBeCloseTo(0.68, 5);

    /* On a WIDE grid the 320px floor stops binding and the shell's own supported range is what is
       left — which is the other half of the intersection, and the half no drag over a 1000px grid
       can reach: 320 of 2000 is 0.16, so [0.2, 0.8] is the tighter pair. The two bounds answer
       different questions and both have to be handed over, or a 4K window lets one pane take
       everything but 320px of the other. */
    stubRect(grid(), { height: 800, width: 2000 });
    drag(1000, -5000);
    expect(shell.paneSplit).toBeCloseTo(0.2, 5);
    drag(1000, 5000);
    expect(shell.paneSplit).toBeCloseTo(0.8, 5);
    /* Read off the ELEMENT as well as the store, and that is the assertion with teeth:
       `setPaneSplit` clamps to the same pair, so a splitter handed no bounds at all would still
       leave `shell.paneSplit` at 0.8 — while announcing 0.84 and drawing its thumb there. A control
       and the state it edits disagreeing about the layout is the failure this pins. */
    expect(splitter.getAttribute("aria-valuenow")).toBe(String(shell.paneSplit));
    expect(splitter.getAttribute("aria-valuemin")).toBe("0.2");
    expect(splitter.getAttribute("aria-valuemax")).toBe("0.8");
    stubRect(grid(), { height: 800, width: 1000 });
    drag(500, 5000);

    splitter.dispatchEvent(new MouseEvent("dblclick"));
    expect(shell.paneSplit).toBe(DEFAULT_PANE_SPLIT);
    /* And the trip BACK, which the double click never had: the element remembers where it was
       collapsed from, so a second one returns there instead of doing nothing. */
    splitter.dispatchEvent(new MouseEvent("dblclick"));
    expect(shell.paneSplit).toBeCloseTo(0.68, 5);
  });

  test("the splitter is a tab stop with a keyboard, which is what no drag handle could be", async () => {
    /* The gap this collapse closes. The pane split was the one dock-sized thing in Studio that no
       keyboard could move: `setupHandle` binds pointer events and nothing else, so a reader who
       cannot use a pointer had no way to reach the split at all — SC 2.1.1 — and no non-dragging
       pointer gesture beyond the one-way reset — SC 2.5.7. Every assertion here is about a door
       that did not exist, so none of them can be satisfied by the old handle. */
    stubRect(grid(), { height: 800, width: 1000 });
    await split();
    const splitter = grid().querySelector(SPLITTER_SELECTOR) as HTMLElement;
    expect(splitter.getAttribute("tabindex")).toBe("0");
    expect(splitter.getAttribute("role")).toBe("separator");
    expect(splitter.getAttribute("aria-label")).toBe("Pane split");
    expect(splitter.getAttribute("aria-valuenow")).toBe("0.5");

    const press = (key: string, shiftKey = false) => {
      splitter.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key, shiftKey }));
    };
    press("ArrowRight");
    expect(shell.paneSplit).toBeCloseTo(0.52, 5);
    press("ArrowLeft", true);
    expect(shell.paneSplit).toBeCloseTo(0.42, 5);
    // Home and End are the ends of the LEGAL range — the 320px floor, converted against the grid.
    press("End");
    expect(shell.paneSplit).toBeCloseTo(0.68, 5);
    press("Home");
    expect(shell.paneSplit).toBeCloseTo(0.32, 5);
    // Enter is the double click's other door: the even split, and back.
    press("Enter");
    expect(shell.paneSplit).toBe(DEFAULT_PANE_SPLIT);
    press("Enter");
    expect(shell.paneSplit).toBeCloseTo(0.32, 5);
    // The value the reader hears is the one the shell kept.
    expect(splitter.getAttribute("aria-valuenow")).toBe(String(shell.paneSplit));
  });

  test("a commit PERSISTS, and a move on its own does not", async () => {
    /* The two lines the flow still owns, and the only assertion that can tell them apart: `input`
       writes `shell.paneSplit` and `change` writes the record. Splitting them is the whole reason
       the element emits two events — a drag is five writes and one save, and a `persistDocks` on
       every `pointermove` would serialise the dock record five times for one gesture. */
    stubRect(grid(), { height: 800, width: 1000 });
    await split();
    const splitter = grid().querySelector(SPLITTER_SELECTOR) as HTMLElement;
    const stored = () =>
      (JSON.parse(localStorage.getItem("jx-studio-panel-widths") || "{}") as { paneSplit?: number })
        .paneSplit;

    localStorage.removeItem("jx-studio-panel-widths");
    splitter.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 0 }));
    splitter.dispatchEvent(new PointerEvent("pointermove", { clientX: 600, clientY: 0 }));
    expect(shell.paneSplit).toBeCloseTo(0.6, 5);
    expect(stored()).toBeUndefined();

    splitter.dispatchEvent(new PointerEvent("pointerup", { clientX: 600, clientY: 0 }));
    expect(stored()).toBeCloseTo(0.6, 5);
  });

  test("a splitter drawn onto a grid that is ALREADY split opens where the shell left it", async () => {
    /* The projection carries the live split, not a constant. It only reaches the element when the
       pane set changes — which is exactly the moment a splitter is created — so a restored 0.7
       session that opened its second pane with a 0.5 splitter would be a shell and a control
       disagreeing about the layout the reader is looking at, with the grid's own tracks siding with
       the shell. */
    shell.paneSplit = 0.6;
    stubRect(grid(), { height: 800, width: 1000 });
    await split();
    const splitter = grid().querySelector(SPLITTER_SELECTOR) as HTMLElement;
    expect(splitter.getAttribute("aria-valuenow")).toBe("0.6");
    // And it moves ON from there rather than from the default.
    splitter.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "ArrowRight" }));
    expect(shell.paneSplit).toBeCloseTo(0.62, 5);
  });

  test("the splitter is built once and re-used across reconciles", async () => {
    await split();
    const splitter = grid().querySelector(SPLITTER_SELECTOR);
    reconcile();
    reconcile();
    expect(grid().querySelectorAll(SPLITTER_SELECTOR)).toHaveLength(1);
    expect(grid().querySelector(SPLITTER_SELECTOR)).toBe(splitter);
  });

  test("a multi-step drag never removes the handle from the grid — not once", async () => {
    /* The splitter used to be positioned by `cells[1].root.before(_splitter)`, re-run from
       `layout()`. `layout()` runs on every `shell.paneSplit` write, which is every `pointermove` of
       the drag — and `.before()` on an already-positioned node is a REMOVE plus an insert. In
       Chrome that fires `lostpointercapture` on move #1, the rest of the gesture goes to whatever
       is under the cursor, and a drag asking for +0.20 lands +0.03.

       Zero childList mutations anywhere under the grid is the structural statement: a node that is
       never removed cannot lose its capture. It is true because the projection is SKIPPED when the
       pane set has not changed — the five `shell.paneSplit` writes this gesture makes reach no
       markup at all — and because the splitter belongs to the second pane's row rather than to a
       position something has to recompute. `subtree: true`, because the splitter is inside that
       row wrapper now and a childList watch on the grid alone would no longer see it move. */
    stubRect(grid(), { height: 800, width: 1000 });
    await split();
    const splitter = grid().querySelector(SPLITTER_SELECTOR) as HTMLElement;

    const observer = new MutationObserver(() => {});
    observer.observe(grid(), { childList: true, subtree: true });

    splitter.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 0 }));
    for (const clientX of [520, 560, 600, 640, 660]) {
      splitter.dispatchEvent(new PointerEvent("pointermove", { clientX, clientY: 0 }));
    }
    splitter.dispatchEvent(new PointerEvent("pointerup", { clientX: 660, clientY: 0 }));

    // Drained synchronously: the whole gesture is synchronous, so nothing has to be waited for —
    // And waiting would let the cells' scheduled canvas renders in, whose DOM is not the subject.
    const records = observer.takeRecords();
    observer.disconnect();
    /* Compared as NAMES, never as nodes. `expect(nodes).toEqual([])` on a failure hands bun's diff
       printer a live happy-dom element to serialize, and it does not come back — the regression
       this test guards would have looked like a hung test run rather than a red one.
       Built with `push` rather than `flatMap` + spread: `oxc(no-map-spread)` refuses the spread
       inside the callback and `unicorn(prefer-spread)` refuses `Array.from`, so this is the one
       spelling both rules accept — and it is the one the first rule's own help text names. */
    const name = (node: Node) =>
      node instanceof Element
        ? `${node.nodeName.toLowerCase()}[${node.getAttribute("part")}]`
        : node.nodeName;
    const removed: string[] = [];
    const added: string[] = [];
    for (const record of records) {
      for (const node of record.removedNodes) {
        removed.push(name(node));
      }
      for (const node of record.addedNodes) {
        added.push(name(node));
      }
    }

    expect(removed).toEqual([]);
    expect(added).toEqual([]);
    // The whole drag landed, not the first move's worth of it. 660 of a 1000px grid is +0.16 on the
    // Ratio, inside the 320px-a-side floor that caps this grid's drag at 0.68.
    expect(shell.paneSplit).toBeCloseTo(0.66, 5);
    expect(grid().querySelector(SPLITTER_SELECTOR)).toBe(splitter);
    expect(splitter.isConnected).toBe(true);
  });

  test("unsplitting takes the second cell away and the splitter with it", async () => {
    await split();
    const side = cellForPane(SECONDARY_PANE)!;
    closePane(SECONDARY_PANE);
    await flush();

    expect(cellForPane(SECONDARY_PANE)).toBeNull();
    expect(side.root.isConnected).toBe(false);
    expect(resolveAllRegions("pane.secondary")).toHaveLength(0);
    expect(grid().querySelector(SPLITTER_SELECTOR)).toBeNull();
    expect(grid().style.gridTemplateColumns).toBe("minmax(0, 1fr)");
    // And the survivor is untouched, still holding its own stage.
    expect(surfaceForPane(PRIMARY_PANE).wrap).toBe(cellForPane(PRIMARY_PANE)!.stage);
  });

  test("a departing pane is taken apart, bars and record and all", async () => {
    /* The half of the teardown a framework used to provide, and the one thing that had to be
       re-derived. lit notified a part of its disconnection and only then removed the nodes, so a
       `ref` detach ran the ordered teardown for free; a document's repeater drops a departed row
       and tells nobody. `panels/pane-grid.ts` therefore diffs the pane set and runs the teardown
       itself, in the document's own order, before it projects — and this is what proves the diff is
       there at all. Delete that loop and the pane's bars go on standing, its surface record goes on
       naming a stage nothing can reach, and every frame under it outlives the pane.

       Three witnesses, one per step: `panels/jump-bar.ts` and `panels/pane-context.ts` each write
       their `--*-h` back to `0px` through the host they still hold, and `disposePaneSurface` clears
       the record the canvas hosts resolve through. The marker is the fourth: nothing emptied the
       stage on the way past, which is what `releaseCanvasHosts` needs in order to find the frames
       inside it. */
    await split();
    // Drained, for the reason `gaining a pane` gives: the cell's own boot render owns the stage's
    // Children, and this marker is about what the TEARDOWN does to them.
    await flush();
    const side = cellForPane(SECONDARY_PANE)!;
    const marker = document.createElement("span");
    side.stage.append(marker);
    expect(surfaceForPane(SECONDARY_PANE).wrap).toBe(side.stage);

    closePane(SECONDARY_PANE);
    await flush();

    expect(surfaceForPane(SECONDARY_PANE).wrap).toBeNull();
    expect(side.root.style.getPropertyValue("--jump-bar-h")).toBe("0px");
    expect(side.root.style.getPropertyValue("--pane-context-h")).toBe("0px");
    // The stage kept its children through the teardown, which is what `releaseCanvasHosts` needs.
    expect(marker.parentElement).toBe(side.stage);
  });
});

describe("a pointer in a cell moves the keyboard into it", () => {
  const doc = () => ({ children: [{ tagName: "p", textContent: "x" }], tagName: "div" });

  async function split() {
    closeAllTabs();
    openTab({ document: doc(), documentPath: "/project/left.json", id: "left" });
    openTab({ document: doc(), documentPath: "/project/right.json", id: "right" });
    expect(splitRight()?.id).toBe(SECONDARY_PANE);
    await flush();
    // `splitRight` leaves the NEW pane focused, so put the keyboard back in the primary: every
    // Assertion below is about a pointer landing in the pane the keyboard is NOT in.
    focusPane(PRIMARY_PANE);
    expect(workspace.activePaneId).toBe(PRIMARY_PANE);
  }

  const down = (el: Element) => {
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  };

  test("every surface in the side cell focuses it — not only its tab strip", async () => {
    /* `panels/tab-strip.ts`'s strip row was the ONLY thing in the app that moved
       `workspace.activePaneId` by pointer. Clicking the side pane's canvas, its context bar, its
       jump bar or anything drawn into its stage left the keyboard in the primary, so the
       Inspector, the block action bar, the overlay effect and every keyboard command went on
       answering for a document the person was not looking at. */
    await split();
    const side = cellForPane(SECONDARY_PANE)!;
    for (const [name, el] of [
      ["stage", side.stage],
      ["chrome", side.chrome],
      ["jump", side.jump],
      ["root", side.root],
    ] as const) {
      focusPane(PRIMARY_PANE);
      down(el);
      expect(`${name}: ${workspace.activePaneId}`).toBe(`${name}: ${SECONDARY_PANE}`);
    }
  });

  test("a pointer deep INSIDE a cell counts — the listener is on the cell, not on each surface", async () => {
    await split();
    const side = cellForPane(SECONDARY_PANE)!;
    const deep = document.createElement("button");
    side.chrome.append(deep);
    down(deep);
    expect(workspace.activePaneId).toBe(SECONDARY_PANE);
  });

  test("a handler that stops propagation cannot take the pane's focus with it", async () => {
    /* CAPTURE phase, so a control inside the cell that swallows the event — a picker, a drag
       start — cannot leave the keyboard in the other pane.

       This is the one thing the document could not say. A Jx `on*` key binds through
       `addEventListener` with no options, so capture is not expressible; the listener is added by
       `panels/pane-grid.ts` to the cell element the document hands it. Delete the `{ capture: true
       }` and this case is the one that goes red. */
    await split();
    const side = cellForPane(SECONDARY_PANE)!;
    const swallow = document.createElement("button");
    swallow.addEventListener("pointerdown", (e) => e.stopPropagation());
    side.chrome.append(swallow);
    down(swallow);
    expect(workspace.activePaneId).toBe(SECONDARY_PANE);
  });

  test("the SPLITTER is not in a cell, so a drag on it never moves focus", async () => {
    /* The one interaction that must not be disturbed mid-gesture. It is a child of its pane's ROW
       rather than of either cell, so the listener structurally cannot see it. */
    await split();
    const splitter = grid().querySelector(SPLITTER_SELECTOR) as HTMLElement;
    expect(splitter.closest(PANE_SELECTOR)).toBeNull();
    down(splitter);
    expect(workspace.activePaneId).toBe(PRIMARY_PANE);
  });

  test("a pointer in the pane that already has focus changes nothing at all", async () => {
    /* `focusPane` is called on every pointerdown now, so it has to be free when it has nothing to
       do: `promoteMru` rewrites the order `⌃Tab` walks and `resetTabCycle` abandons a live walk
       through it. Clicking around in the pane you are already in must not touch either. */
    await split();
    const primary = cellForPane(PRIMARY_PANE)!;
    workspace.mruOrder = ["right", "left"];
    down(primary.stage);
    expect(workspace.activePaneId).toBe(PRIMARY_PANE);
    expect(workspace.mruOrder).toEqual(["right", "left"]);
  });
});
