import { flush, installMockPlatform, resetStudioState, stubRect } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { notifyModule } from "./notify-mock";
import { fakeCell, fakeRange, fakeRow, FakeTabulator, tabulatorMockModule } from "./tabulator-mock";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import { undo } from "../src/tabs/transact";
import type { GridCellValue, GridSource } from "../src/grid/grid-source";
import type { CellPopoverArgs } from "../src/grid/cell-popovers";
import type { FakeCell, FakeRow } from "./tabulator-mock";
import type { ColumnDefinition } from "tabulator-tables";
import { isFunction } from "@jxsuite/schema/guards";

void mock.module("tabulator-tables", () => tabulatorMockModule);
void mock.module("tabulator-tables/dist/css/tabulator.min.css", () => ({}));
void mock.module("../src/ui/layers.js", () => ({
  /* Converted surfaces mount themselves into a layer, so they import `layerHost` from
     here — a mock without it fails the whole file at import time. */
  layerHost: () => document.body,
  showConfirmDialog: async () => true,
}));
void mock.module("../src/ui/progress-modal.js", () => ({
  showProgressModal: () => ({ done: () => {}, fail: () => {}, setStatus: () => {} }),
}));
void mock.module("../src/services/notify.js", () => notifyModule(() => {}));

const popoverCalls: {
  column: string;
  value: GridCellValue;
  commit: CellPopoverArgs["commit"];
}[] = [];
void mock.module("../src/grid/cell-popovers.js", () => ({
  hasPopoverEditor: (column: { kind: string }) =>
    column.kind === "image" || column.kind === "reference",
  openCellValuePopover: async (args: CellPopoverArgs) => {
    popoverCalls.push({ column: args.column.field, commit: args.commit, value: args.value });
  },
  referenceTargetType: () => null,
}));

const { createGridController, ROW_KEY_FIELD } = await import("../src/grid/grid-controller");
const { createGridView } = await import("../src/grid/grid-view");
const { gridIdleBlockers } = await import("../src/grid/grid-idle");

function stubSource(overrides: Partial<GridSource> = {}): GridSource {
  return {
    capabilities: { delete: true, insert: true, remotePaging: false, remoteSort: false },
    columns: async () => [
      { editable: true, field: "id", kind: "readonly", pk: true, title: "Id" },
      { editable: true, field: "title", kind: "string", title: "Title" },
      { editable: true, field: "count", kind: "number", title: "Count" },
      { editable: true, field: "done", kind: "boolean", title: "Done" },
    ],
    commit: async (batch) => ({
      cells: batch.cells.map((c) => ({ field: c.field, ok: true, rowKey: c.rowKey })),
      deletes: batch.deletes.map((d) => ({ ok: true, rowKey: d.rowKey })),
      inserts: batch.inserts.map((i) => ({ ok: true, tempKey: i.tempKey })),
    }),
    id: "grid://collection/x",
    label: "x",
    rows: async () => ({
      rows: [
        { cells: { count: 1, done: false, id: "a", title: "One" }, key: "a" },
        { cells: { count: 2, done: true, id: "b", title: "Two" }, key: "b" },
      ],
      total: 2,
    }),
    ...overrides,
  };
}

/**
 * A column definition as this suite drives it. `createGridView` gives every column a `field`, an
 * `editable` callback and a `formatter` (src/grid/grid-view.ts); Tabulator would hand those
 * callbacks its own cell, and this suite hands them the mock's.
 */
interface DrivenColumn extends Omit<
  ColumnDefinition<GridCellValue>,
  "editable" | "field" | "formatter"
> {
  editable: (cell: FakeCell) => boolean;
  field: string;
  formatter: (
    cell: FakeCell,
    formatterParams: Record<string, never>,
    onRendered: (fn: () => void) => void,
  ) => HTMLElement | string;
}

/** Every column the view built, in the order it handed them to Tabulator. */
function drivenColumns(table: FakeTabulator): DrivenColumn[] {
  /* SAFETY: the fake keeps the options object `createGridView` constructed it with, untouched, and
     its `columns` is `applyGridLayout(columnDefs, layout)`: the view's own records, every one with a
     `field`, an `editable` and a `formatter`. FakeCell and FakeRow implement every member of the
     ambient CellComponent and RowComponent (src/grid/tabulator-tables.d.ts), differing only in
     `getValue` also answering `undefined` for a field the row's data does not hold. */
  return table.options.columns as DrivenColumn[];
}

/** The column the view built for `field`. */
function drivenColumn(table: FakeTabulator, field: string): DrivenColumn {
  const column = drivenColumns(table).find((candidate) => candidate.field === field);
  if (!column) {
    throw new Error(`the view built no "${field}" column`);
  }
  return column;
}

async function setupView(source: GridSource = stubSource()) {
  const tab = openTab({
    capabilities: { modes: ["grid"] },
    document: { tagName: "div" },
    documentPath: null,
    id: source.id,
  });
  const controller = createGridController(tab, source);
  await controller.load();
  const host = document.createElement("div");
  document.body.append(host);
  const view = createGridView(host, controller);
  const table = FakeTabulator.instances.at(-1)!;
  return { controller, host, table, tab, view };
}

beforeEach(() => {
  resetStudioState();
  closeAllTabs();
  installMockPlatform();
  FakeTabulator.reset();
  popoverCalls.length = 0;
});

describe("createGridView — construction", () => {
  test("builds Tabulator with spreadsheet options and initial data", async () => {
    const { table } = await setupView();
    expect(table.options.index).toBe(ROW_KEY_FIELD);
    expect(table.options.selectableRange).toBe(1);
    expect(table.options.clipboardPasteAction).toBe("range");
    expect(table.options.editTriggerEvent).toBe("dblclick");
    expect(table.options.history).toBeFalse();
    expect(table.data).toHaveLength(2);
    expect(table.data[0]![ROW_KEY_FIELD]).toBe("a");
    expect(FakeTabulator.registeredModules.length).toBeGreaterThan(10);
  });

  test("maps columns: readonly gets no editor, pk freezes, filters/sort follow capabilities", async () => {
    const { table } = await setupView();
    const id = drivenColumn(table, "id");
    const title = drivenColumn(table, "title");
    expect(id.editor).toBeUndefined();
    expect(id.frozen).toBeTrue();
    expect(title.editor).toBeFunction();
    expect(title.headerFilter).toBe("input");
    expect(drivenColumn(table, "done").headerFilter).toBeUndefined();
    expect(title.headerSort).toBeTrue();
    expect(drivenColumn(table, "count").sorter).toBe("number");
  });

  test("remote sources disable header sort and filters", async () => {
    const { table } = await setupView(
      stubSource({
        capabilities: { delete: true, insert: true, remotePaging: true, remoteSort: true },
        id: "grid://data/main/users",
      }),
    );
    const defs = drivenColumns(table);
    expect(defs.every((d) => d.headerSort === false)).toBeTrue();
    expect(defs.every((d) => d.headerFilter === undefined)).toBeTrue();
  });
});

describe("gridIdleBlockers", () => {
  /*
   * Filtered by grid id rather than asserted whole. `liveGrids` is module state and every other
   * test in this file builds a view it never destroys, so an unfiltered assertion would pass or
   * fail on test ORDER — which is the one thing a quiescence test must not do.
   */
  const mine = (id: string) => gridIdleBlockers().filter((line) => line.includes(id));

  /** The `.tabulator-range` div the SelectRange module paints, with a box happy-dom cannot compute. */
  function paintOutline(host: HTMLElement): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "tabulator-range-overlay";
    const outline = document.createElement("div");
    outline.className = "tabulator-range";
    overlay.append(outline);
    host.append(overlay);
    stubRect(outline, { height: 28, left: 376, top: 180, width: 142 });
    return outline;
  }

  test("a grid is in-flight until it is built AND its range is laid out", async () => {
    const id = "grid://idle/built";
    const { host, table, view } = await setupView(stubSource({ id }));

    // `data.openGrid` has already resolved by here and `editor.kind` already reads "grid", which
    // Is precisely why the screenshot runner used to photograph the table mid-build.
    expect(mine(id)).toEqual([`grid[${id}]: building`]);

    table.emit("tableBuilt");
    expect(mine(id)).toEqual([`grid[${id}]: selection range not laid out`]);

    const row = fakeRow({ [ROW_KEY_FIELD]: "a" });
    const cell = fakeCell(row, "title", table);
    table.ranges.push(fakeRange([[cell]]));
    // The MODEL now has a range and the OUTLINE is still unpainted. This is the window the probe
    // Used to call settled, and `data-grid.png` alternated across it 16 times in ten days.
    expect(mine(id)).toEqual([`grid[${id}]: selection range outline not painted`]);

    paintOutline(host);
    expect(mine(id)).toEqual([]);

    view.destroy();
    expect(mine(id)).toEqual([]);
  });

  test("a range whose outline has no box yet is still in-flight", async () => {
    const id = "grid://idle/zero-box";
    const { host, table, view } = await setupView(stubSource({ id }));
    table.emit("tableBuilt");
    const row = fakeRow({ [ROW_KEY_FIELD]: "a" });
    table.ranges.push(fakeRange([[fakeCell(row, "title", table)]]));

    // Tabulator appends the overlay before it positions it. An element with a zero-width box is a
    // Range that has not been laid out, so presence alone would reopen the window this closes.
    const outline = paintOutline(host);
    stubRect(outline, { height: 0, left: 0, top: 0, width: 0 });
    expect(mine(id)).toEqual([`grid[${id}]: selection range outline not painted`]);

    view.destroy();
  });

  test("an empty grid never waits for the range it will never be given", async () => {
    const id = "grid://idle/empty";
    const { table, view } = await setupView(
      stubSource({ id, rows: async () => ({ rows: [], total: 0 }) }),
    );

    table.emit("tableBuilt");
    // `selectableRange: 1` gives no range to a table with no cells, so requiring one here would
    // Block `probeIdle()` until it timed out.
    expect(mine(id)).toEqual([]);
    view.destroy();
  });

  test("a destroyed grid stops answering, even if it never finished building", async () => {
    const id = "grid://idle/torn-down";
    const { view } = await setupView(stubSource({ id }));
    expect(mine(id)).toEqual([`grid[${id}]: building`]);
    view.destroy();
    // A probe left behind on a torn-down table would block every later idle check forever.
    expect(mine(id)).toEqual([]);
  });
});

describe("cellEdited → buffer", () => {
  test("edits flow into the buffer with column-typed coercion and paint the cell dirty", async () => {
    const { controller, table } = await setupView();
    const row = fakeRow({ [ROW_KEY_FIELD]: "a", count: 1, title: "One" });
    const cell = fakeCell(row, "count", table);

    row.data.count = "42"; // Simulates a paste of text into a number column.
    table.emit("cellEdited", cell);

    expect(controller.buffer.effectiveValue("a", "count")).toBe(42);
    expect(row.getData().count).toBe(42); // Normalized back into the table.
    expect(cell.element.classList.contains("jx-grid-cell--dirty")).toBeTrue();
  });

  test("pending-delete rows are not editable", async () => {
    const { controller, table } = await setupView();
    controller.buffer.deleteRow("a");
    const titleDef = drivenColumn(table, "title");
    const row = fakeRow({ [ROW_KEY_FIELD]: "a", title: "One" });
    const cell = fakeCell(row, "title", table);
    expect(titleDef.editable(cell)).toBeFalse();
    const rowB = fakeRow({ [ROW_KEY_FIELD]: "b", title: "Two" });
    expect(titleDef.editable(fakeCell(rowB, "title", table))).toBeTrue();
  });

  test("paste bursts group into one undo entry", async () => {
    const { controller, host, table } = await setupView();
    const rowA = fakeRow({ [ROW_KEY_FIELD]: "a", title: "One" });
    const rowB = fakeRow({ [ROW_KEY_FIELD]: "b", title: "Two" });

    host.dispatchEvent(new Event("paste", { bubbles: true }));
    rowA.data.title = "P1";
    table.emit("cellEdited", fakeCell(rowA, "title", table));
    rowB.data.title = "P2";
    table.emit("cellEdited", fakeCell(rowB, "title", table));
    await flush();

    expect(controller.buffer.dirtyCount()).toBe(2);
    controller.buffer.undo();
    expect(controller.buffer.dirtyCount()).toBe(0);
  });
});

describe("buffer → table sync", () => {
  test("tableBuilt flushes a queued refresh; undo through the tab delegate replaces data", async () => {
    const { controller, tab, table } = await setupView();
    table.emit("tableBuilt");

    const row = fakeRow({ [ROW_KEY_FIELD]: "a", count: 1, title: "One" });
    row.data.title = "Edited";
    table.emit("cellEdited", fakeCell(row, "title", table));
    expect(controller.buffer.isDirty()).toBeTrue();

    undo(tab);
    await flush();
    expect(controller.buffer.isDirty()).toBeFalse();
    const lastData = table.replaceDataCalls.at(-1)!;
    expect(lastData.find((r) => r[ROW_KEY_FIELD] === "a")!.title).toBe("One");
  });

  test("controller.addRow refreshes the table with the pending insert appended", async () => {
    const { controller, table } = await setupView();
    table.emit("tableBuilt");
    const tempKey = controller.addRow({ title: "Born" });
    await flush();
    const lastData = table.replaceDataCalls.at(-1)!;
    expect(lastData.at(-1)![ROW_KEY_FIELD]).toBe(tempKey);
    expect(lastData.at(-1)!.title).toBe("Born");
  });
});

describe("view actions", () => {
  test("fillDown copies the range's first row through the range as one undo group", async () => {
    const { controller, table, view } = await setupView();
    const rowA = fakeRow({ [ROW_KEY_FIELD]: "a", count: 1, title: "One" });
    const rowB = fakeRow({ [ROW_KEY_FIELD]: "b", count: 2, title: "Two" });
    const cells = [
      [fakeCell(rowA, "title", table), fakeCell(rowA, "count", table)],
      [fakeCell(rowB, "title", table), fakeCell(rowB, "count", table)],
    ];
    table.ranges = [fakeRange(cells)];

    view.fillDown();
    expect(controller.buffer.effectiveValue("b", "title")).toBe("One");
    expect(controller.buffer.effectiveValue("b", "count")).toBe(1);
    controller.buffer.undo(); // One group.
    expect(controller.buffer.isDirty()).toBeFalse();
  });

  test("fillDown without a multi-row range is a no-op", async () => {
    const { controller, table, view } = await setupView();
    view.fillDown();
    const rowA = fakeRow({ [ROW_KEY_FIELD]: "a", title: "One" });
    table.ranges = [fakeRange([[fakeCell(rowA, "title", table)]])];
    view.fillDown();
    expect(controller.buffer.isDirty()).toBeFalse();
  });

  test("getSelectedRowKeys dedupes across ranges", async () => {
    const { table, view } = await setupView();
    const rowA = fakeRow({ [ROW_KEY_FIELD]: "a" });
    const rowB = fakeRow({ [ROW_KEY_FIELD]: "b" });
    table.ranges = [
      fakeRange([[fakeCell(rowA, "title", table)]]),
      fakeRange([[fakeCell(rowA, "count", table)], [fakeCell(rowB, "count", table)]]),
    ];
    expect(view.getSelectedRowKeys().toSorted()).toEqual(["a", "b"]);
  });

  test("setSearch installs a cross-column text filter; empty clears it", async () => {
    const { table, view } = await setupView();
    view.setSearch("two");
    expect(table.filter).not.toBeNull();
    expect(table.filter!({ count: 2, title: "Two" })).toBeTrue();
    expect(table.filter!({ count: 1, title: "One" })).toBeFalse();
    view.setSearch("  ");
    expect(table.filter).toBeNull();
  });

  test("destroy tears down the table and unbinds the controller", async () => {
    const { controller, table, view } = await setupView();
    table.emit("tableBuilt");
    view.destroy();
    expect(table.destroyed).toBeTrue();
    const before = table.replaceDataCalls.length;
    controller.addRow({});
    expect(table.replaceDataCalls.length).toBe(before);
  });
});

describe("popover cells and insert-only columns", () => {
  const richSource = (): GridSource =>
    stubSource({
      columns: async () => [
        {
          editable: false,
          field: "__path",
          insertOnly: true,
          kind: "string",
          pk: true,
          title: "Path",
        },
        { editable: true, field: "cover", kind: "image", title: "Cover" },
        { editable: true, field: "title", kind: "string", title: "Title" },
      ],
      id: "grid://collection/rich",
    });

  test("image/reference columns get no inline editor; dblclick opens the popover", async () => {
    const { controller, table } = await setupView(richSource());
    expect(drivenColumn(table, "cover").editor).toBeUndefined();
    expect(drivenColumn(table, "title").editor).toBeFunction();

    controller.buffer.setCell("a", "cover", "/img/a.png");
    const row = fakeRow({ [ROW_KEY_FIELD]: "a", cover: "/img/a.png" });
    const cell = fakeCell(row, "cover", table);
    table.emit("cellDblClick", {}, cell);
    await flush();
    expect(popoverCalls).toHaveLength(1);
    expect(popoverCalls[0]!.value).toBe("/img/a.png");

    popoverCalls[0]!.commit("/img/b.png");
    expect(controller.buffer.effectiveValue("a", "cover")).toBe("/img/b.png");
    expect(row.data.cover).toBe("/img/b.png"); // Normalized into the table.
  });

  test("popover never opens for pending-delete rows or non-popover kinds", async () => {
    const { controller, table } = await setupView(richSource());
    controller.buffer.deleteRow("a");
    const row = fakeRow({ [ROW_KEY_FIELD]: "a", cover: "x" });
    table.emit("cellDblClick", {}, fakeCell(row, "cover", table));
    table.emit("cellDblClick", {}, fakeCell(row, "title", table));
    await flush();
    expect(popoverCalls).toHaveLength(0);
  });

  test("insert-only columns are editable only on pending-insert rows", async () => {
    const { controller, table } = await setupView(richSource());
    const pathDef = drivenColumn(table, "__path");

    const existing = fakeRow({ [ROW_KEY_FIELD]: "a" });
    expect(pathDef.editable(fakeCell(existing, "__path", table))).toBeFalse();

    const tempKey = controller.buffer.insertRow({});
    const inserted = fakeRow({ [ROW_KEY_FIELD]: tempKey });
    expect(pathDef.editable(fakeCell(inserted, "__path", table))).toBeTrue();
  });
});

describe("column layout persistence", () => {
  test("saved layout applies at creation; resize/move events persist changes", async () => {
    const { clearGridLayout, loadGridLayout, saveGridLayout } =
      await import("../src/grid/grid-layout");
    clearGridLayout("grid://collection/x");
    saveGridLayout("grid://collection/x", { order: ["count", "title"], widths: { title: 321 } });

    const { table } = await setupView();
    expect(drivenColumns(table).map((d) => d.field)).toEqual(["count", "title", "id", "done"]);
    expect(drivenColumn(table, "title").width).toBe(321);

    table.emit("columnResized", { getField: () => "done", getWidth: () => 77 });
    expect(loadGridLayout("grid://collection/x")!.widths!.done).toBe(77);

    table.emit("columnMoved", { getField: () => "done" }, [
      { getField: () => "done" },
      { getField: () => "id" },
    ]);
    expect(loadGridLayout("grid://collection/x")!.order).toEqual(["done", "id"]);
    clearGridLayout("grid://collection/x");
  });
});

describe("formatters and sorters", () => {
  test("the column formatter renders into a host and paints error state on render", async () => {
    const { controller, table } = await setupView();
    const titleDef = drivenColumn(table, "title");
    const row = fakeRow({ [ROW_KEY_FIELD]: "a", title: "One" });
    const cell = fakeCell(row, "title", table);

    controller.buffer.applyCommitResult({
      cells: [{ error: "bad value", field: "title", ok: false, rowKey: "a" }],
      deletes: [],
      inserts: [],
    });
    const rendered: (() => void)[] = [];
    const host = titleDef.formatter(cell, {}, (fn) => rendered.push(fn));
    if (!(host instanceof HTMLElement)) {
      throw new TypeError("the formatter rendered bare text instead of a host element");
    }
    expect(host.className).toContain("jx-grid-cell-content");
    expect(host.textContent).toBe("One");
    for (const fn of rendered) {
      fn();
    }
    expect(cell.element.classList.contains("jx-grid-cell--error")).toBeTrue();
    expect(cell.element.getAttribute("title")).toBe("bad value");
  });

  test("array columns sort by their joined text", async () => {
    const { table } = await setupView(
      stubSource({
        columns: async () => [
          { editable: true, field: "id", kind: "readonly", pk: true, title: "Id" },
          { editable: true, field: "tags", kind: "array", title: "Tags" },
        ],
        id: "grid://collection/arr",
      }),
    );
    const { sorter } = drivenColumn(table, "tags");
    if (!isFunction(sorter)) {
      throw new TypeError("the array column sorts by a named sorter instead of its joined text");
    }
    expect(sorter(["alpha"], ["beta"])).toBeLessThan(0);
    expect(sorter(["beta"], ["alpha"])).toBeGreaterThan(0);
    expect(sorter(["same"], ["same"])).toBe(0);
  });
});

describe("event guards and deferred refresh", () => {
  test("refreshData before tableBuilt queues and flushes once built", async () => {
    const { table, view } = await setupView();
    expect(table.replaceDataCalls).toHaveLength(0);
    view.refreshData(); // Not built yet — deferred.
    expect(table.replaceDataCalls).toHaveLength(0);
    table.emit("tableBuilt");
    await flush();
    expect(table.replaceDataCalls).toHaveLength(1);
  });

  test("cellEdited for an unknown field is ignored", async () => {
    const { controller, table } = await setupView();
    const row = fakeRow({ [ROW_KEY_FIELD]: "a", ghost: "x" });
    table.emit("cellEdited", fakeCell(row, "ghost", table));
    expect(controller.buffer.isDirty()).toBeFalse();
  });

  test("overlapping burst triggers share one open group; Delete keydown opens one", async () => {
    const { controller, host, table } = await setupView();
    // Two synchronous pastes — the second hits the group-already-open early return.
    host.dispatchEvent(new Event("paste", { bubbles: true }));
    host.dispatchEvent(new Event("paste", { bubbles: true }));
    const rowA = fakeRow({ [ROW_KEY_FIELD]: "a", title: "One" });
    rowA.data.title = "P1";
    table.emit("cellEdited", fakeCell(rowA, "title", table));
    await flush();
    controller.buffer.undo(); // One group despite two paste events.
    expect(controller.buffer.dirtyCount()).toBe(0);

    host.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "x" }));
    host.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Delete" }));
    const rowB = fakeRow({ [ROW_KEY_FIELD]: "b", title: "Two" });
    rowB.data.title = "";
    table.emit("cellEdited", fakeCell(rowB, "title", table));
    await flush();
    expect(controller.buffer.dirtyCount()).toBe(1);
    controller.buffer.undo();
    expect(controller.buffer.dirtyCount()).toBe(0);
  });
});

describe("row painting", () => {
  test("rowFormatter applies pending-delete and insert classes from buffer state", async () => {
    const { controller, table } = await setupView();
    /* SAFETY: `createGridView` passes `rowFormatter: paintRow`, which reads a row only through
       `getData` and `getElement`; FakeRow implements both over the row object the test builds. */
    const rowFormatter = table.options.rowFormatter as (row: FakeRow) => void;

    controller.buffer.deleteRow("a");
    const rowA = fakeRow({ [ROW_KEY_FIELD]: "a" });
    rowFormatter(rowA);
    expect(rowA.element.classList.contains("jx-grid-row--pending-delete")).toBeTrue();

    const tempKey = controller.buffer.insertRow({});
    const rowNew = fakeRow({ [ROW_KEY_FIELD]: tempKey });
    rowFormatter(rowNew);
    expect(rowNew.element.classList.contains("jx-grid-row--pending-insert")).toBeTrue();
  });
});
