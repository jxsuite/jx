/**
 * The spreadsheet grid's frame — `grid/grid-panel.ts` over `surfaces/grid-panel.json`.
 *
 * Everything is addressed by `part`, because the frame, the saved-view panel and find-and-replace
 * are documents: there is no `.jx-grid-toolbar`, `.jx-grid-view-popover` or `sp-action-button` to
 * find any more. A press goes to the kit element's own `[part="control"]`, which is what a reader
 * clicks; a disabled control is asserted there for the same reason.
 *
 * Three claims this file exists to hold to account:
 *
 * 1. **Tabulator's node survives a repaint.** The lit shell needed `guard([source.id])` around the
 *    host div, because re-rendering the toolbar would otherwise re-commit it and destroy the engine
 *    inside. A document reconciles in place, so the guarantee should now hold with nothing
 *    defending it — and "should" is what a test is for.
 * 2. **The engine is only ever handed an attached node.** The document announces the host as it is
 *    CREATED, one step before the frame lands; the panel builds from its own effect once the mount
 *    has settled. A build against a detached node is silent in happy-dom and fatal in a browser.
 * 3. **A saved view is four facets applied in one order**, reachable from the panel and from the
 *    palette, and the two go through the same store.
 */
import {
  flush,
  installMockPlatform,
  mountOverlayLayers,
  resetStudioState,
  surfaceOf,
} from "./harness";

import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { notifyModule } from "./notify-mock";
import type { NotifyCall } from "./notify-mock";
import { FakeTabulator, tabulatorMockModule } from "./tabulator-mock";
import { initLayers } from "../src/ui/layers";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import type { GridEditBatch, GridSource } from "../src/grid/grid-source";

void mock.module("tabulator-tables", () => tabulatorMockModule);
void mock.module("tabulator-tables/dist/css/tabulator.min.css", () => ({}));
/** Every notification the flow reported, in order. */
const notifications: NotifyCall[] = [];
void mock.module("../src/services/notify.js", () =>
  notifyModule((call) => notifications.push(call)),
);

const { createGridController } = await import("../src/grid/grid-controller");
const {
  detachGridPanel,
  gridPanelMounted,
  gridViewCommands,
  registerGridViewCommands,
  renderGridMode,
} = await import("../src/grid/grid-panel");
const {
  clearGridLayout,
  listSavedViews,
  loadGridLayout,
  resetGridLayout,
  saveGridLayout,
  saveViewAs,
} = await import("../src/grid/grid-layout");

beforeAll(() => {
  mountOverlayLayers();
  initLayers();
});

// ─── Addressing ───────────────────────────────────────────────────────────────

/** A node by its `part`, anywhere under `root`. */
function part(root: ParentNode, name: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[part="${name}"]`);
}

/** The control a reader actually presses inside a kit button. */
function control(root: ParentNode, name: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[part="${name}"] [part="control"]`);
  if (!el) {
    throw new Error(`no control inside [part="${name}"]`);
  }
  return el;
}

function press(root: ParentNode, name: string): void {
  control(root, name).click();
}

/** The native `<select>` inside a `jx-select`; writing the host's property moves no reader's. */
function select(root: ParentNode, name: string): HTMLSelectElement {
  const el = root.querySelector<HTMLSelectElement>(`[part="${name}"] select`);
  if (!el) {
    throw new Error(`no select inside [part="${name}"]`);
  }
  return el;
}

/** Pick a value the way a reader does: on the control, and let the event bubble to the host. */
function pick(root: ParentNode, name: string, value: string): void {
  const el = select(root, name);
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The native `<input>` inside a `jx-textfield`. */
function field(root: ParentNode, name: string): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(`[part="${name}"] input`);
  if (!el) {
    throw new Error(`no input inside [part="${name}"]`);
  }
  return el;
}

function type(root: ParentNode, name: string, value: string): void {
  const el = field(root, name);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The frame's visible text, whitespace-collapsed. */
function text(root: ParentNode & { textContent: string | null }): string {
  return (root.textContent ?? "").replaceAll(/\s+/g, " ").trim();
}

/** Answer the topmost `jx-dialog`: the confirm/cancel events both flows dispatch. */
async function answerDialog(answer: "confirm" | "cancel", value?: string): Promise<void> {
  const dialog = document.querySelector<HTMLElement>("#layer-dialog jx-dialog");
  if (!dialog) {
    throw new Error("no dialog is open");
  }
  if (value !== undefined) {
    const input = dialog.querySelector<HTMLInputElement>('jx-textfield [part="input"]');
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  dialog.dispatchEvent(new Event(answer));
  await flush(3);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function stubSource(id = "grid://collection/posts"): GridSource & { commits: GridEditBatch[] } {
  const commits: GridEditBatch[] = [];
  return {
    capabilities: { delete: true, insert: true, remotePaging: false, remoteSort: false },
    columns: async () => [{ editable: true, field: "title", kind: "string", title: "Title" }],
    async commit(batch) {
      commits.push(batch);
      return {
        cells: batch.cells.map((c) => ({ field: c.field, ok: true, rowKey: c.rowKey })),
        deletes: batch.deletes.map((d) => ({ ok: true, rowKey: d.rowKey })),
        inserts: batch.inserts.map((i) => ({ ok: true, tempKey: i.tempKey })),
      };
    },
    commits,
    id,
    label: "posts",
    rows: async () => ({ rows: [{ cells: { title: "One" }, key: "a" }], total: 1 }),
  };
}

function gridTab(id = "grid://collection/posts") {
  return openTab({
    capabilities: { modes: ["grid"] },
    document: { tagName: "div" },
    documentPath: null,
    id,
  });
}

/** A stage, a tab, a loaded controller and a mounted frame. */
async function mountGrid(source: GridSource) {
  const wrap = document.createElement("div");
  document.body.append(wrap);
  const tab = gridTab(source.id);
  const controller = createGridController(tab, source);
  await controller.load();
  renderGridMode(surfaceOf(wrap), tab);
  await flush(3);
  return { controller, tab, wrap };
}

beforeEach(() => {
  detachGridPanel("primary");
  resetStudioState();
  closeAllTabs();
  installMockPlatform();
  FakeTabulator.reset();
  notifications.length = 0;
});

describe("renderGridMode", () => {
  test("draws the toolbar and hands Tabulator the empty node the document made", async () => {
    const { tab, wrap } = await mountGrid(stubSource());

    expect(part(wrap, "toolbar")).not.toBeNull();
    const host = part(wrap, "host")!;
    // The document draws it EMPTY: anything rendered inside would be destroyed by the first build.
    expect(gridPanelMounted("primary", tab)).toBeTrue();
    expect(text(wrap)).toContain("1 row");

    const table = FakeTabulator.instances.at(-1);
    expect(table).toBeDefined();
    expect(host.contains(table!.host)).toBeTrue();
    // And it was attached before the engine touched it — a detached build draws nothing at all.
    expect(host.isConnected).toBeTrue();
  });

  test("the toolbar is one named region, not a bag of anonymous buttons", async () => {
    const { wrap } = await mountGrid(stubSource());
    const toolbar = part(wrap, "toolbar")!;
    expect(toolbar.getAttribute("role")).toBe("toolbar");
    expect(toolbar.getAttribute("aria-label")).toBe("Grid actions");
    for (const name of ["save", "refresh", "add-row", "delete-rows", "fill-down", "replace"]) {
      expect(part(toolbar, name)).not.toBeNull();
    }
    /* Not one CSS class between them. Mapped to names rather than compared as elements: `toEqual`
       over a happy-dom node walks its whole parent chain and never comes back. */
    expect(
      [...wrap.querySelectorAll("[class]")].map((el) => el.className).filter((name) => name !== ""),
    ).toEqual([]);
  });

  test("CSV file tabs lazily provision their controller from any open path", async () => {
    installMockPlatform({}, { "lazy.csv": "a,b\n1,2\n" });
    const wrap = document.createElement("div");
    document.body.append(wrap);
    // Simulates a deep-link/quick-search open: format modes gave the tab grid mode, no controller.
    const tab = openTab({
      capabilities: { modes: ["grid", "source"] },
      document: { tagName: "div" },
      documentPath: "lazy.csv",
      id: "lazy.csv",
    });
    renderGridMode(surfaceOf(wrap), tab);
    await flush(3);
    expect(part(wrap, "missing")).toBeNull();
    expect(text(wrap)).toContain("1 row");
  });

  test("tabs without a controller get the sentence and no controls to press", async () => {
    const wrap = document.createElement("div");
    document.body.append(wrap);
    const tab = gridTab("grid://collection/orphan");
    renderGridMode(surfaceOf(wrap), tab);
    await flush(3);
    expect(part(wrap, "missing")?.textContent).toContain("no grid source");
    // A toolbar over a grid that does not exist would offer a Save with nothing to save.
    expect(part(wrap, "toolbar")).toBeNull();
    expect(part(wrap, "host")).toBeNull();
    expect(gridPanelMounted("primary", tab)).toBeFalse();
  });

  test("same-tab re-render is a no-op; switching tabs rebuilds the view", async () => {
    const wrap = document.createElement("div");
    document.body.append(wrap);
    const tabA = gridTab("grid://collection/a");
    const controllerA = createGridController(tabA, stubSource("grid://collection/a"));
    await controllerA.load();
    renderGridMode(surfaceOf(wrap), tabA);
    await flush(3);
    const firstCount = FakeTabulator.instances.length;
    renderGridMode(surfaceOf(wrap), tabA);
    await flush(3);
    expect(FakeTabulator.instances.length).toBe(firstCount);

    const tabB = gridTab("grid://collection/b");
    const controllerB = createGridController(tabB, stubSource("grid://collection/b"));
    await controllerB.load();
    renderGridMode(surfaceOf(wrap), tabB);
    await flush(3);
    expect(FakeTabulator.instances.length).toBe(firstCount + 1);
    expect(FakeTabulator.instances.at(-2)!.destroyed).toBeTrue();
    expect(gridPanelMounted("primary", tabA)).toBeFalse();
    expect(gridPanelMounted("primary", tabB)).toBeTrue();
  });

  /* What `guard([controller.source.id])` used to buy, asserted without it.
     Tabulator owns the host's children the moment createGridView hands the node over, so a toolbar
     repaint must leave the node — and therefore the engine — alone. The lit shell could only
     promise that with a directive; a document reconciles its tree in place, so the node is the same
     node by construction. This test is what says "by construction" is true rather than hoped. */
  test("a toolbar repaint keeps the engine and its host node", async () => {
    const { controller, wrap } = await mountGrid(stubSource("grid://collection/guarded"));

    const engines = FakeTabulator.instances.length;
    const host = part(wrap, "host")!;

    // A toolbar-only state change: the effect tracks `saving`, so this re-projects the frame.
    controller.state.saving = true;
    await flush(2);
    expect(control(wrap, "refresh").hasAttribute("disabled")).toBeTrue();
    controller.state.saving = false;
    await flush(2);

    expect(part(wrap, "host")).toBe(host);
    expect(FakeTabulator.instances.length).toBe(engines);
    expect(FakeTabulator.instances.at(-1)!.destroyed).toBeFalse();
  });

  test("Save reflects the dirty count and triggers controller.save", async () => {
    const source = stubSource();
    const { controller, wrap } = await mountGrid(source);

    expect(text(part(wrap, "save")!)).toBe("Save");
    expect(control(wrap, "save").hasAttribute("disabled")).toBeTrue();

    controller.buffer.setCell("a", "title", "Edited");
    await flush(2);
    expect(text(part(wrap, "save")!)).toBe("Save (1)");
    expect(control(wrap, "save").hasAttribute("disabled")).toBeFalse();

    press(wrap, "save");
    await flush(2);
    expect(source.commits).toHaveLength(1);
    expect(control(wrap, "save").hasAttribute("disabled")).toBeTrue();
  });

  test("a source that cannot insert or delete draws neither verb", async () => {
    const source = stubSource("grid://collection/readonly");
    source.capabilities = { delete: false, insert: false, remotePaging: false, remoteSort: false };
    const { wrap } = await mountGrid(source);
    expect(part(wrap, "add-row")).toBeNull();
    expect(part(wrap, "delete-rows")).toBeNull();
    // The slots are still there: a capability the source gains repaints into them.
    expect(part(wrap, "insert-slot")).not.toBeNull();
  });

  test("Add Row appends a pending insert through the controller", async () => {
    const { controller, wrap } = await mountGrid(stubSource());
    press(wrap, "add-row");
    await flush(2);
    expect(controller.buffer.state.inserts.size).toBe(1);
    expect(text(part(wrap, "save")!)).toBe("Save (1)");
  });

  test("collection grids show the frontmatter-rewrite note; CSV grids do not", async () => {
    const { wrap } = await mountGrid(stubSource());
    expect(part(wrap, "note")?.dataset["note"]).toBe("lossy");
    expect(text(wrap)).toContain("rewrites frontmatter");

    detachGridPanel("primary");
    closeAllTabs();
    const csvTab = openTab({
      capabilities: { modes: ["grid", "source"] },
      document: { tagName: "div" },
      documentPath: "data.csv",
      id: "data.csv",
    });
    const csvController = createGridController(csvTab, stubSource("data.csv"));
    await csvController.load();
    const wrap2 = document.createElement("div");
    document.body.append(wrap2);
    renderGridMode(surfaceOf(wrap2), csvTab);
    await flush(3);
    expect(text(wrap2)).not.toContain("rewrites frontmatter");
  });

  test("toolbar actions drive the view: refresh, delete-selected, fill-down, filter", async () => {
    const { controller, wrap } = await mountGrid(stubSource());
    const table = FakeTabulator.instances.at(-1)!;

    // The filter box installs a filter on the table and persists with the rest of the view.
    type(wrap, "filter", "one");
    await flush(2);
    expect(table.filter).not.toBeNull();
    expect(loadGridLayout("grid://collection/posts")?.filter).toBe("one");

    // Fill Down without a range is a safe no-op.
    press(wrap, "fill-down");
    expect(controller.buffer.isDirty()).toBeFalse();

    // Delete Rows uses the view's selected keys (none selected → no-op).
    press(wrap, "delete-rows");
    expect(controller.buffer.isDirty()).toBeFalse();

    // Refresh reloads from the source.
    press(wrap, "refresh");
    await flush(2);
    expect(text(wrap)).toContain("1 row");
  });

  test("a failing source surfaces its error as an alert, not as a row count", async () => {
    const source = stubSource("grid://collection/broken");
    source.rows = async () => {
      throw new Error("backend exploded");
    };
    const { wrap } = await mountGrid(source);
    const error = part(wrap, "load-error")!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain("backend exploded");
    expect(part(wrap, "count-text")).toBeNull();
  });

  test("remote-paged sources get a working Prev/Next pager", async () => {
    const queries: unknown[] = [];
    const source = stubSource("grid://data/main/users");
    source.capabilities = { delete: true, insert: true, remotePaging: true, remoteSort: true };
    source.rows = async (q) => {
      queries.push({ ...q });
      return { rows: [{ cells: { title: "Row" }, key: `r${q?.offset ?? 0}` }], total: 120 };
    };
    const { wrap } = await mountGrid(source);

    expect(control(wrap, "prev").hasAttribute("disabled")).toBeTrue();
    expect(text(part(wrap, "pager")!)).toContain("1–50");

    press(wrap, "next");
    await flush(2);
    expect(queries.at(-1)).toEqual({ limit: 50, offset: 50 });
    expect(text(part(wrap, "pager")!)).toContain("51–100");
    expect(control(wrap, "prev").hasAttribute("disabled")).toBeFalse();

    press(wrap, "prev");
    await flush(2);
    expect(queries.at(-1)).toEqual({ limit: 50, offset: 0 });
  });

  test("a local source has no pager at all", async () => {
    const { wrap } = await mountGrid(stubSource("grid://collection/local"));
    expect(part(wrap, "pager")).toBeNull();
  });

  test("detachGridPanel destroys the view and stops projections", async () => {
    const { controller, wrap } = await mountGrid(stubSource());
    const table = FakeTabulator.instances.at(-1)!;

    detachGridPanel("primary");
    expect(table.destroyed).toBeTrue();
    expect(gridPanelMounted("primary", controller.tab)).toBeFalse();

    controller.buffer.setCell("a", "title", "After detach");
    await flush(2);
    expect(text(wrap)).not.toContain("Save (1)"); // Effect stopped.
  });
});

// ─── Find & replace ───────────────────────────────────────────────────────────

const replacePanel = () =>
  document.querySelector<HTMLElement>('#layer-popover [part="replace-panel"]');

describe("find and replace", () => {
  test("buffers replacements, reports the count and closes", async () => {
    const { controller, wrap } = await mountGrid(stubSource());
    press(wrap, "replace");
    await flush(3);

    const panel = replacePanel()!;
    expect(panel).not.toBeNull();
    type(panel, "find", "One");
    type(panel, "replace", "Uno");
    press(panel, "replace-all");
    await flush(3);

    expect(controller.buffer.effectiveValue("a", "title")).toBe("Uno");
    expect(text(wrap)).toContain("Save (1)");
    expect(replacePanel()).toBeNull();
  });

  test("a run that matched nothing keeps the panel up so the terms can be corrected", async () => {
    const { controller, wrap } = await mountGrid(stubSource("grid://collection/nomatch"));
    press(wrap, "replace");
    await flush(3);
    const panel = replacePanel()!;
    type(panel, "find", "absent");
    type(panel, "replace", "x");
    press(panel, "replace-all");
    await flush(3);
    expect(controller.buffer.isDirty()).toBeFalse();
    expect(replacePanel()).not.toBeNull();
  });

  test("a second press on the button toggles the panel rather than stacking a second one", async () => {
    const { wrap } = await mountGrid(stubSource("grid://collection/toggle"));
    press(wrap, "replace");
    await flush(3);
    expect(document.querySelectorAll('#layer-popover [part="replace-panel"]')).toHaveLength(1);

    press(wrap, "replace");
    await flush(3);
    expect(replacePanel()).toBeNull();

    press(wrap, "replace");
    await flush(3);
    expect(document.querySelectorAll('#layer-popover [part="replace-panel"]')).toHaveLength(1);
    press(wrap, "replace");
    await flush(3);
  });

  test("Cancel takes it down and writes nothing", async () => {
    const { controller, wrap } = await mountGrid(stubSource("grid://collection/cancel"));
    press(wrap, "replace");
    await flush(3);
    const panel = replacePanel()!;
    type(panel, "find", "One");
    press(panel, "cancel");
    await flush(3);
    expect(replacePanel()).toBeNull();
    expect(controller.buffer.isDirty()).toBeFalse();
  });
});

// ─── Saved views (plan §12 P7.2) ─────────────────────────────────────────────

const VIEW_GRID = "grid://collection/views";

/** Three columns and three rows, so hiding, sorting and grouping all have something to bite on. */
function viewSource(): GridSource {
  return {
    capabilities: { delete: false, insert: true, remotePaging: false, remoteSort: false },
    columns: async () => [
      { editable: true, field: "title", kind: "string", title: "Title" },
      { editable: true, field: "status", kind: "string", title: "Status" },
      { editable: true, field: "body", kind: "text", title: "Body" },
    ],
    commit: async () => ({ cells: [], deletes: [], inserts: [] }),
    id: VIEW_GRID,
    label: "views",
    rows: async () => ({
      rows: [
        { cells: { body: "b", status: "draft", title: "Beta" }, key: "b" },
        { cells: { body: "a", status: "live", title: "Alpha" }, key: "a" },
      ],
      total: 2,
    }),
  };
}

const viewsPanel = () => document.querySelector<HTMLElement>('#layer-popover [part="views-panel"]');

async function openViews(wrap: HTMLElement): Promise<HTMLElement> {
  press(wrap, "views");
  await flush(3);
  const panel = viewsPanel();
  if (!panel) {
    throw new Error("the View panel did not open");
  }
  return panel;
}

/** One column's checkbox, addressed by the column it governs. */
function columnBox(panel: ParentNode, column: string): HTMLInputElement {
  const el = panel.querySelector<HTMLInputElement>(`[part="column"][data-field="${column}"] input`);
  if (!el) {
    throw new Error(`no checkbox for column "${column}"`);
  }
  return el;
}

function toggleColumn(panel: ParentNode, column: string, checked: boolean): void {
  const box = columnBox(panel, column);
  box.checked = checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("saved views", () => {
  beforeEach(() => {
    clearGridLayout(VIEW_GRID);
  });

  test("the button says View until a view is applied, then names it and flags drift", async () => {
    const { wrap } = await mountGrid(viewSource());
    expect(text(part(wrap, "views")!)).toBe("View");

    const panel = await openViews(wrap);
    press(panel, "save-view");
    await flush(3);
    await answerDialog("confirm", "Recent");
    expect(listSavedViews(VIEW_GRID).map((v) => v.name)).toEqual(["Recent"]);
    expect(text(part(wrap, "views")!)).toBe("Recent");

    /* The engine writes storage too — a column drag goes straight to `saveGridLayout` from
       `grid-view.ts` — and storage is not reactive, so the drift dot lands on the next bump.
       Opening the panel is that bump, which is why the first press here closes and the second
       re-opens. */
    saveGridLayout(VIEW_GRID, { hidden: ["body"] });
    press(wrap, "views");
    await flush(2);
    expect(viewsPanel()).toBeNull();
    press(wrap, "views");
    await flush(3);
    expect(text(part(wrap, "views")!)).toBe("Recent •");
  });

  test("the panel names the applied view for assistive technology too", async () => {
    const { wrap } = await mountGrid(viewSource());
    saveGridLayout(VIEW_GRID, {});
    saveViewAs(VIEW_GRID, "Applied");
    const panel = await openViews(wrap);
    const row = part(panel, "view-name")!;
    expect(row.dataset["active"]).toBe("true");
    expect(row.getAttribute("aria-current")).toBe("true");
  });

  test("hiding a column persists it and rebuilds the engine without that column", async () => {
    const { wrap } = await mountGrid(viewSource());
    const before = FakeTabulator.instances.at(-1)!;
    const panel = await openViews(wrap);

    expect(columnBox(panel, "body").checked).toBeTrue();
    toggleColumn(panel, "body", false);
    await flush(3);

    expect(loadGridLayout(VIEW_GRID)?.hidden).toEqual(["body"]);
    expect(before.destroyed).toBeTrue();
    const after = FakeTabulator.instances.at(-1)!;
    expect(after).not.toBe(before);
    expect((after.options.columns as { field?: string }[]).map((c) => c.field)).toEqual([
      "title",
      "status",
    ]);

    // And back: the open panel has re-projected, so the box shows what storage now holds.
    expect(columnBox(viewsPanel()!, "body").checked).toBeFalse();
    toggleColumn(viewsPanel()!, "body", true);
    await flush(3);
    expect(loadGridLayout(VIEW_GRID)?.hidden).toEqual([]);
  });

  test("the sort and group selects drive the controller and persist", async () => {
    const { controller, wrap } = await mountGrid(viewSource());
    const panel = await openViews(wrap);

    pick(panel, "sort-field", "title");
    await flush(3);
    expect(controller.state.query).toEqual({ dir: "asc", orderBy: "title" });
    expect(loadGridLayout(VIEW_GRID)?.sort).toEqual({ dir: "asc", field: "title" });

    const dir = select(viewsPanel()!, "sort-dir");
    expect(dir.hasAttribute("disabled")).toBeFalse();
    pick(viewsPanel()!, "sort-dir", "desc");
    await flush(3);
    expect(controller.state.query.dir).toBe("desc");

    pick(viewsPanel()!, "group-field", "status");
    await flush(3);
    expect(controller.state.grouping).toBe("status");
    expect(loadGridLayout(VIEW_GRID)?.groupBy).toBe("status");
    expect(text(part(wrap, "note")!)).toContain("Grouped by Status · 2 groups");

    pick(viewsPanel()!, "group-field", "");
    await flush(3);
    expect(controller.state.grouping).toBeNull();
    expect(part(wrap, "note")?.dataset["note"]).not.toBe("grouping");
  });

  test("clearing the sort back to source order is reachable from the same select", async () => {
    const { controller, wrap } = await mountGrid(viewSource());
    saveGridLayout(VIEW_GRID, { sort: { dir: "asc", field: "title" } });
    const panel = await openViews(wrap);
    pick(panel, "sort-field", "");
    await flush(3);
    expect(loadGridLayout(VIEW_GRID)?.sort).toBeNull();
    expect(controller.state.query.orderBy).toBeUndefined();
  });

  test("the direction control is off while there is no sort to redirect", async () => {
    const { controller, wrap } = await mountGrid(viewSource());
    const panel = await openViews(wrap);
    expect(select(panel, "sort-dir").hasAttribute("disabled")).toBeTrue();
    pick(panel, "sort-dir", "desc");
    await flush(3);
    expect(controller.state.query.dir).toBeUndefined();
  });

  test("applying a saved view puts every facet back at once", async () => {
    const { controller, wrap } = await mountGrid(viewSource());
    saveGridLayout(VIEW_GRID, {
      filter: "alpha",
      groupBy: "status",
      hidden: ["body"],
      sort: { dir: "desc", field: "title" },
    });
    saveViewAs(VIEW_GRID, "Everything");
    // Now put the grid somewhere else entirely, then come back through the saved view.
    resetGridLayout(VIEW_GRID);
    controller.setGrouping(null);
    await controller.setSort(null);

    const panel = await openViews(wrap);
    const row = part(panel, "view-name")!;
    expect(row.textContent!.trim()).toBe("Everything");
    row.click();
    await flush(3);

    expect(controller.state.grouping).toBe("status");
    expect(controller.state.query).toEqual({ dir: "desc", orderBy: "title" });
    expect(loadGridLayout(VIEW_GRID)?.hidden).toEqual(["body"]);
    const table = FakeTabulator.instances.at(-1)!;
    expect((table.options.columns as { field?: string }[]).map((c) => c.field)).toEqual([
      "title",
      "status",
    ]);
    expect(viewsPanel()).toBeNull(); // Applying closes the panel.
  });

  test("Reset forgets the layout and keeps the named views", async () => {
    const { controller, wrap } = await mountGrid(viewSource());
    saveGridLayout(VIEW_GRID, { groupBy: "status", hidden: ["body"] });
    saveViewAs(VIEW_GRID, "Kept");
    controller.setGrouping("status");

    const panel = await openViews(wrap);
    press(panel, "reset");
    await flush(3);

    expect(loadGridLayout(VIEW_GRID)).toEqual({});
    expect(listSavedViews(VIEW_GRID).map((v) => v.name)).toEqual(["Kept"]);
    expect(controller.state.grouping).toBeNull();
    expect(viewsPanel()).toBeNull();
  });

  test("deleting a view asks first, and a refusal keeps it", async () => {
    const { wrap } = await mountGrid(viewSource());
    saveGridLayout(VIEW_GRID, {});
    saveViewAs(VIEW_GRID, "Doomed");

    const panel = await openViews(wrap);
    press(panel, "view-delete");
    await flush(3);
    await answerDialog("cancel");
    expect(listSavedViews(VIEW_GRID)).toHaveLength(1);

    press(viewsPanel()!, "view-delete");
    await flush(3);
    await answerDialog("confirm");
    expect(listSavedViews(VIEW_GRID)).toHaveLength(0);
    // The open panel re-projected: the row is gone and the empty state took its place.
    expect(part(viewsPanel()!, "view-name")).toBeNull();
    expect(part(viewsPanel()!, "empty")).not.toBeNull();
  });

  test("an empty list says so instead of showing nothing", async () => {
    const { wrap } = await mountGrid(viewSource());
    const panel = await openViews(wrap);
    expect(part(panel, "empty")?.textContent).toContain("No saved views yet");
  });

  test("cancelling the name prompt saves nothing", async () => {
    const { wrap } = await mountGrid(viewSource());
    const panel = await openViews(wrap);
    press(panel, "save-view");
    await flush(3);
    await answerDialog("cancel");
    expect(listSavedViews(VIEW_GRID)).toEqual([]);
  });

  test("a stored sort, grouping and filter are applied when the engine first appears", async () => {
    saveGridLayout(VIEW_GRID, {
      filter: "beta",
      groupBy: "status",
      sort: { dir: "desc", field: "title" },
    });
    const { controller, wrap } = await mountGrid(viewSource());
    expect(controller.state.query).toEqual({ dir: "desc", orderBy: "title" });
    expect(controller.state.grouping).toBe("status");
    expect(FakeTabulator.instances.at(-1)!.filter).not.toBeNull();
    // And the box shows the term, so the reader can see why rows are missing.
    expect(field(wrap, "filter").value).toBe("beta");
  });
});

describe("saved-view commands", () => {
  beforeEach(() => {
    clearGridLayout(VIEW_GRID);
  });

  const byId = (id: string) => gridViewCommands().find((command) => command.id === id)!;

  test("every record is a document-level palette verb", () => {
    const records = gridViewCommands();
    expect(records.map((r) => r.id).toSorted()).toEqual([
      "grid.applyView",
      "grid.deleteView",
      "grid.resetView",
      "grid.saveView",
    ]);
    for (const record of records) {
      expect(record.level).toBe("document");
      expect(record.menus).toEqual(["palette"]);
      expect(record.requires).toBe("a grid on screen");
      // Visible only inside a project, and enabled only with a grid on screen — two questions,
      // Asked separately, so a closed project hides the row and an open one explains the refusal.
      expect(record.when!({ project: { open: true } } as never)).toBeTrue();
      expect(record.when!({ project: { open: false } } as never)).toBeFalse();
      expect(record.enablement!({} as never)).toBeFalse();
    }
  });

  test("they are disabled, and refuse, when no grid is on screen", () => {
    detachGridPanel("primary");
    const record = byId("grid.resetView");
    expect(record.enablement!({} as never)).toBeFalse();
    expect(() => record.run({} as never, undefined as never)).toThrow("needs a grid on screen");
  });

  test("save, apply, delete and reset go through the same store as the panel", async () => {
    const { controller, wrap } = await mountGrid(viewSource());
    expect(byId("grid.saveView").enablement!({} as never)).toBeTrue();

    saveGridLayout(VIEW_GRID, { hidden: ["body"] });
    const saving = byId("grid.saveView").run({} as never, undefined as never);
    await flush(3);
    await answerDialog("confirm", "By command");
    await saving;
    expect(listSavedViews(VIEW_GRID).map((v) => v.name)).toEqual(["By command"]);

    resetGridLayout(VIEW_GRID);
    await byId("grid.applyView").run({} as never, { name: "By command" } as never);
    await flush(3);
    expect(loadGridLayout(VIEW_GRID)?.hidden).toEqual(["body"]);
    expect(text(part(wrap, "views")!)).toBe("By command");

    await byId("grid.resetView").run({} as never, undefined as never);
    expect(loadGridLayout(VIEW_GRID)).toEqual({});
    expect(controller.state.grouping).toBeNull();

    await byId("grid.deleteView").run({} as never, { name: "By command" } as never);
    await flush(2);
    expect(listSavedViews(VIEW_GRID)).toEqual([]);
    expect(text(part(wrap, "views")!)).toBe("View");
  });

  test("an unknown view name is refused by name, listing what the grid has", async () => {
    await mountGrid(viewSource());
    saveGridLayout(VIEW_GRID, {});
    saveViewAs(VIEW_GRID, "Real");
    expect(() => byId("grid.applyView").run({} as never, { name: "ghost" } as never)).toThrow(
      /"ghost" is not a saved view of views — it has: Real/,
    );
  });

  test("registerGridViewCommands puts all four into a registry", () => {
    const ids: string[] = [];
    registerGridViewCommands({
      registerAll: (commands: readonly { id: string }[]) => ids.push(...commands.map((c) => c.id)),
    } as never);
    expect(ids).toHaveLength(4);
  });
});

describe("saved views — the awkward corners", () => {
  beforeEach(() => {
    clearGridLayout(VIEW_GRID);
  });

  test("the name field refuses a blank in the dialog, not after it", async () => {
    const { wrap } = await mountGrid(viewSource());
    const panel = await openViews(wrap);
    press(panel, "save-view");
    await flush(3);
    await answerDialog("confirm", "   ");
    // Refused: the dialog is still up, saying why, and nothing was written.
    const dialog = document.querySelector<HTMLElement>("#layer-dialog jx-dialog")!;
    expect(dialog).not.toBeNull();
    expect(text(dialog)).toContain("Name the view.");
    expect(text(dialog)).toContain("saved for views");
    expect(listSavedViews(VIEW_GRID)).toEqual([]);
    await answerDialog("cancel");
  });

  /* Light dismissal is the platform's, not this flow's — but the flow still holds a handle, and a
     handle it does not let go of makes the next press read as a toggle and close nothing. */
  test("a light dismissal is reported, so the next press re-opens", async () => {
    const { wrap } = await mountGrid(viewSource());
    const panel = await openViews(wrap);
    panel.dispatchEvent(Object.assign(new Event("toggle"), { newState: "closed" }));
    await flush(3);

    press(wrap, "views");
    await flush(3);
    expect(viewsPanel()).not.toBeNull();
  });

  /* Re-authored from the lit suite, where it asserted the toolbar label. The label is still the
     visible half — a view that was not kept must not be named on the button — and the sentence
     saying WHY is the half the author acts on, so both are pinned. */
  test("a name storage cannot keep is reported, not silently dropped", async () => {
    const { wrap } = await mountGrid(viewSource());
    const panel = await openViews(wrap);
    press(panel, "save-view");
    await flush(3);

    /* Privacy mode, reproduced rather than simulated: reading `localStorage` THROWS, which is what
       `grid-layout.ts` catches. The old suite reached this branch by mocking the dialog into
       returning a blank name, which the field now refuses before the flow ever sees it. */
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage is disabled");
      },
    });
    try {
      await answerDialog("confirm", "Unkeepable");
      await flush(2);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "localStorage", original);
      }
    }

    expect(listSavedViews(VIEW_GRID)).toEqual([]);
    // The button must not name a view nothing remembers.
    expect(text(part(wrap, "views")!)).toBe("View");
    const warned = notifications.find((call) => call.options.key === "grid.saveView");
    expect(warned?.severity).toBe("warn");
    expect(warned?.message).toContain("local storage disabled");
  });

  test("one group is one group, not one groups", async () => {
    const { controller, wrap } = await mountGrid(viewSource());
    controller.buffer.setCell("b", "status", "live");
    controller.setGrouping("status");
    await flush(2);
    expect(text(part(wrap, "note")!)).toContain("Grouped by Status · 1 group");
  });

  /* The flow re-projects the View panel from its own effect, which keeps ticking after a press has
     closed the panel — an apply, a Reset, or a second press on the button. The projection has to be
     dropped rather than written into a disposed document. */
  test("a projection after the panel closed is dropped rather than thrown", async () => {
    const { controller, wrap } = await mountGrid(viewSource());
    saveGridLayout(VIEW_GRID, { hidden: ["body"] });
    saveViewAs(VIEW_GRID, "Closed");
    const panel = await openViews(wrap);
    part(panel, "view-name")!.click();
    await flush(3);
    expect(viewsPanel()).toBeNull();

    // Everything the effect tracks, moved after the panel is gone.
    controller.buffer.setCell("a", "title", "Edited");
    controller.setGrouping("status");
    await flush(3);
    expect(viewsPanel()).toBeNull();
    expect(text(part(wrap, "save")!)).toBe("Save (1)");
  });

  test("detaching takes the open panels down with it", async () => {
    const { wrap } = await mountGrid(viewSource());
    await openViews(wrap);
    expect(viewsPanel()).not.toBeNull();
    detachGridPanel("primary");
    await flush(2);
    expect(viewsPanel()).toBeNull();
  });
});
