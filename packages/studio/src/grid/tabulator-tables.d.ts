/**
 * Minimal ambient types for tabulator-tables 6.x — the package ships no declarations. Only the
 * surface grid-view.ts touches is typed; extend here as usage grows.
 *
 * Every component is generic over `Value`, the type of one cell value. Tabulator stores the row
 * objects it is handed (`data`, `replaceData`) and gives the same values back (`getValue`,
 * `getData`, sorter and filter arguments), so the caller that builds the table names the value type
 * once and reads it back from every component. Values written in (`setValue`, an editor's
 * `success`, `selectableRangeClearCellsValue`) must be of that same type for the promise to hold.
 */
declare module "tabulator-tables" {
  /** One row object as the table stores it: cell values keyed by field. */
  export type RowData<Value> = Record<string, Value>;

  export interface CellComponent<Value> {
    getValue: () => Value;
    getField: () => string;
    getElement: () => HTMLElement;
    getRow: () => RowComponent<Value>;
    setValue: (value: Value, mutate?: boolean) => void;
  }

  export interface RowComponent<Value> {
    getData: () => RowData<Value>;
    getElement: () => HTMLElement;
    getCells: () => CellComponent<Value>[];
    reformat: () => void;
  }

  export interface RangeComponent<Value> {
    getRows: () => RowComponent<Value>[];
    getCells: () => CellComponent<Value>[][];
  }

  export interface ColumnComponent {
    getField: () => string;
    getWidth: () => number;
  }

  export type CellEditor<Value> = (
    cell: CellComponent<Value>,
    onRendered: (fn: () => void) => void,
    success: (value: Value) => void,
    cancel: () => void,
  ) => HTMLElement | false;

  export type CellFormatter<Value> = (
    cell: CellComponent<Value>,
    /** Always `{}`: no column definition here declares `formatterParams`. */
    formatterParams: Record<string, never>,
    onRendered: (fn: () => void) => void,
  ) => HTMLElement | string;

  export interface ColumnDefinition<Value> {
    title: string;
    field?: string | undefined;
    width?: number | undefined;
    frozen?: boolean | undefined;
    editor?: CellEditor<Value> | undefined;
    editable?: boolean | ((cell: CellComponent<Value>) => boolean) | undefined;
    formatter?: CellFormatter<Value> | undefined;
    sorter?: string | ((a: Value, b: Value) => number) | undefined;
    headerSort?: boolean | undefined;
    headerFilter?: string | undefined;
    cssClass?: string | undefined;
    resizable?: boolean | string | undefined;
    headerSortTristate?: boolean | undefined;
  }

  /** Which table regions a clipboard copy includes. */
  export interface ClipboardCopyConfig {
    columnHeaders?: boolean;
    columnGroups?: boolean;
    rowHeaders?: boolean;
    rowGroups?: boolean;
    columnCalcs?: boolean;
    dataTree?: boolean;
    formatCells?: boolean;
  }

  export interface Options<Value> {
    data?: RowData<Value>[];
    columns?: ColumnDefinition<Value>[];
    index?: string;
    layout?: string;
    height?: string | number;
    renderVertical?: string;
    renderHorizontal?: string;
    history?: boolean;
    reactiveData?: boolean;
    editTriggerEvent?: string;
    headerSortClickElement?: string;
    selectableRange?: number | boolean;
    selectableRangeColumns?: boolean;
    selectableRangeRows?: boolean;
    selectableRangeClearCells?: boolean;
    selectableRangeClearCellsValue?: Value;
    clipboard?: boolean;
    clipboardCopyStyled?: boolean;
    clipboardCopyConfig?: ClipboardCopyConfig;
    clipboardCopyRowRange?: string;
    clipboardPasteParser?: string;
    clipboardPasteAction?: string;
    movableColumns?: boolean;
    columnDefaults?: Partial<ColumnDefinition<Value>>;
    rowFormatter?: (row: RowComponent<Value>) => void;
    placeholder?: string;
  }

  export class Tabulator<Value> {
    constructor(host: HTMLElement, options: Options<Value>);
    static registerModule(modules: unknown[]): void;
    on(event: string, callback: (...args: never[]) => void): void;
    replaceData(data: RowData<Value>[]): Promise<void>;
    getRows(activeOnly?: string): RowComponent<Value>[];
    getRanges(): RangeComponent<Value>[];
    /** The row whose `index` field holds `index`, or `false` for none. */
    getRow(index: string): RowComponent<Value> | false;
    /** Scroll a row into view; rejects when no row holds `index`. */
    scrollToRow(index: string, position?: string, ifVisible?: boolean): Promise<void>;
    /** Select the range between two cells, replacing the oldest range past `selectableRange`. */
    addRange(start: CellComponent<Value>, end: CellComponent<Value>): RangeComponent<Value>;
    setFilter(filter: (data: RowData<Value>) => boolean): void;
    clearFilter(includeHeaderFilters?: boolean): void;
    redraw(force?: boolean): void;
    destroy(): void;
  }

  export const EditModule: unknown;
  export const FormatModule: unknown;
  export const SortModule: unknown;
  export const FilterModule: unknown;
  export const ResizeColumnsModule: unknown;
  export const MoveColumnsModule: unknown;
  export const FrozenColumnsModule: unknown;
  export const SelectRangeModule: unknown;
  export const ClipboardModule: unknown;
  export const ExportModule: unknown;
  export const KeybindingsModule: unknown;
  export const InteractionModule: unknown;
  export const TooltipModule: unknown;
}

declare module "tabulator-tables/dist/css/tabulator.min.css" {
  const css: unknown;
  export default css;
}
