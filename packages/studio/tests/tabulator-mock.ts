/**
 * Shared fake for `tabulator-tables` — grid tests never instantiate the real engine (it measures
 * layout, which happy-dom cannot do; same policy as monaco). Test files install it with:
 *
 * Void mock.module("tabulator-tables", () => tabulatorMockModule); void
 * mock.module("tabulator-tables/dist/css/tabulator.min.css", () => ({}));
 *
 * The fake records constructor options, exposes emit() to drive events, and implements the small
 * component surface (cells/rows/ranges) grid-view touches.
 */

import type { Options, RowData } from "tabulator-tables";
import type { GridCellValue } from "../src/grid/grid-source";

/*
 * Cell values are `GridCellValue`, the value type `grid-view.ts` instantiates the real Tabulator
 * with (`src/grid/tabulator-tables.d.ts`), so the fake stores and returns what the view hands it.
 */

type Handler = (...args: unknown[]) => void;

export interface FakeRow {
  data: RowData<GridCellValue>;
  element: HTMLElement;
  cells: FakeCell[];
  getData: () => RowData<GridCellValue>;
  getElement: () => HTMLElement;
  getCells: () => FakeCell[];
  reformat: () => void;
}

export interface FakeCell {
  row: FakeRow;
  field: string;
  element: HTMLElement;
  getValue: () => GridCellValue | undefined;
  getField: () => string;
  getElement: () => HTMLElement;
  getRow: () => FakeRow;
  setValue: (value: GridCellValue, mutate?: boolean) => void;
}

export interface FakeRange {
  getCells: () => FakeCell[][];
  getRows: () => FakeRow[];
}

export function fakeRow(data: RowData<GridCellValue>): FakeRow {
  const row: FakeRow = {
    cells: [],
    data,
    element: document.createElement("div"),
    getCells: () => row.cells,
    getData: () => row.data,
    getElement: () => row.element,
    reformat: () => {},
  };
  return row;
}

export function fakeCell(
  row: FakeRow,
  field: string,
  table: FakeTabulator | null = null,
): FakeCell {
  const cell: FakeCell = {
    element: document.createElement("div"),
    field,
    getElement: () => cell.element,
    getField: () => cell.field,
    getRow: () => cell.row,
    getValue: () => cell.row.data[cell.field],
    row,
    setValue: (value: GridCellValue, _mutate?: boolean) => {
      cell.row.data[cell.field] = value;
      // Real Tabulator fires cellEdited for programmatic setValue too.
      table?.emit("cellEdited", cell);
    },
  };
  row.cells.push(cell);
  return cell;
}

export function fakeRange(cells: FakeCell[][]): FakeRange {
  return {
    getCells: () => cells,
    getRows: () => {
      const rows: FakeRow[] = [];
      for (const cellRow of cells) {
        const row = cellRow[0]?.getRow();
        if (row && !rows.includes(row)) {
          rows.push(row);
        }
      }
      return rows;
    },
  };
}

export class FakeTabulator {
  static instances: FakeTabulator[] = [];
  static registeredModules: unknown[] = [];

  host: HTMLElement;
  options: Options<GridCellValue>;
  handlers = new Map<string, Handler[]>();
  data: RowData<GridCellValue>[];
  replaceDataCalls: RowData<GridCellValue>[][] = [];
  ranges: FakeRange[] = [];
  filter: ((data: RowData<GridCellValue>) => boolean) | null = null;
  clearFilterCalls = 0;
  destroyed = false;

  constructor(host: HTMLElement, options: Options<GridCellValue>) {
    this.host = host;
    this.options = options;
    this.data = options.data ?? [];
    FakeTabulator.instances.push(this);
  }

  static registerModule(modules: unknown[]) {
    FakeTabulator.registeredModules.push(...modules);
  }

  static reset() {
    FakeTabulator.instances = [];
  }

  on(event: string, handler: Handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }

  replaceData(data: RowData<GridCellValue>[]) {
    this.data = data;
    this.replaceDataCalls.push(data);
    return Promise.resolve();
  }

  getRows() {
    return this.data.map((row) => fakeRow(row));
  }

  getRanges() {
    return this.ranges;
  }

  /** The keys `scrollToRow` was called with, in order. */
  scrolledTo: string[] = [];

  getRow(index: string): FakeRow | false {
    const key = this.options.index ?? "id";
    const data = this.data.find((row) => String(row[key]) === index);
    if (!data) {
      return false;
    }
    const row = fakeRow(data);
    for (const field of Object.keys(data)) {
      fakeCell(row, field, this);
    }
    return row;
  }

  scrollToRow(index: string, _position?: string, _ifVisible?: boolean) {
    this.scrolledTo.push(index);
    return Promise.resolve();
  }

  /** Mirrors `selectableRange: 1`: a new range replaces the one there was. */
  addRange(start: FakeCell, end: FakeCell) {
    const cells = start.row.cells.slice(
      start.row.cells.indexOf(start),
      start.row.cells.indexOf(end) + 1,
    );
    const range = fakeRange([cells]);
    this.ranges = [range];
    return range;
  }

  setFilter(filter: (data: RowData<GridCellValue>) => boolean) {
    this.filter = filter;
  }

  clearFilter(_includeHeader?: boolean) {
    this.filter = null;
    this.clearFilterCalls += 1;
  }

  destroy() {
    this.destroyed = true;
  }
}

/** Module shape handed to mock.module for the tabulator-tables specifier. */
export const tabulatorMockModule = {
  ClipboardModule: {},
  EditModule: {},
  ExportModule: {},
  FilterModule: {},
  FormatModule: {},
  FrozenColumnsModule: {},
  InteractionModule: {},
  KeybindingsModule: {},
  MoveColumnsModule: {},
  ResizeColumnsModule: {},
  SelectRangeModule: {},
  SortModule: {},
  Tabulator: FakeTabulator,
  TooltipModule: {},
};
