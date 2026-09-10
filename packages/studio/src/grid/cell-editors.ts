/**
 * Grid cell editors and formatters — the lit → Tabulator bridge.
 *
 * Tabulator's editor contract is `(cell, onRendered, success, cancel) => element`: it parents the
 * returned element into the cell and expects `success(value)`/`cancel()` calls. Each factory here
 * lit-renders a control into a host element supplied by grid-view's single sanctioned element
 * factory — this module itself never creates DOM imperatively. Formatters likewise return a
 * rendered element (never an HTML string, which Tabulator would inject as innerHTML).
 *
 * Native inputs (the data-grid precedent) rather than Spectrum controls: cells are 24px
 * micro-controls where SWC shadow focus handling fights Tabulator's editor lifecycle.
 *
 * ## This surface stays lit, and the reason is structural rather than a shortage of will
 *
 * Every other control in the grid is a document — the frame, the toolbar, both popovers, and the
 * value picker for the two kinds that edit OUT of the cell (`surfaces/grid-cell.json`). These do
 * not, because they render into TABULATOR's DOM on Tabulator's clock, and a Jx document is mounted
 * asynchronously: `ui/surface.ts`'s `mountSurface` awaits `kitReady()` and then `mount()`. Three
 * things in the engine read the editor's own subtree in the SAME statement sequence that parents
 * it, so an empty box handed over now and filled a microtask later is not the same object:
 *
 * 1. `Edit.edit()` runs `element.appendChild(cellEditor)` and then `rendered()` on the next line —
 *    that is the `onRendered` callback below, whose whole job is to focus and select the control.
 *    With nothing in the box there is nothing to focus, so the keystroke that opened the editor
 *    lands on the table and the edit module blur-cancels the session.
 * 2. The statement after that walks `element.children` and adds a click-stopper to each. A child that
 *    arrives later never gets one, so the first click inside the editor bubbles to the cell and the
 *    SelectRange module reads it as a range interaction.
 * 3. `navigateNext`/`navigatePrev` call `nextCell.getComponent().edit()` SYNCHRONOUSLY inside the
 *    keydown handler, so Tab commits one editor and builds the next in one turn. That is what rules
 *    out the obvious escape — a pool of pre-mounted documents re-seeded per session — because a
 *    scope write flushes in a microtask (`@vue/reactivity` batches; `src/reactivity.ts` says so at
 *    its definition), and the second editor would open showing the first cell's value.
 *
 * The formatters are blocked a second way, which no seam fixes. `Cell._generateContents()` wipes
 * the cell and appends whatever the formatter returned, and it runs for every visible cell on every
 * render; with `renderVertical: "virtual"` (see `grid-view.ts`) `Row.wipe()`/`deleteCells()`
 * destroy those cells as they scroll out, and NOTHING calls back to say so. A document per cell
 * would enter `services/surface-registry.ts` on the way in and never leave it — an unbounded
 * registry keyed to nodes the engine has already thrown away — and would repaint asynchronously
 * while the reader scrolls.
 *
 * So the boundary is the cell, and it is the same boundary §9.4 already draws around Tabulator: the
 * engine is an island, and this file is the inside of it. The two kinds whose picker is bigger than
 * a cell escaped it by leaving the cell entirely, and that is the shape any future conversion has
 * to take — a document ANCHORED at the cell, not mounted in it. What would actually unblock the
 * rest is a synchronous mount path in the runtime (a document rendered into a detached host with
 * the kit already registered, no awaits), at which point 1 and 2 dissolve and only the formatter's
 * lifetime problem is left, which needs a teardown hook Tabulator does not have.
 */
import { html, render } from "lit-html";
import { cellToText, coerceCellInput } from "./schema-columns";
import type { GridCellValue, GridColumn } from "./grid-source";

/** The subset of Tabulator's CellComponent the editors/formatters touch. */
export interface CellLike {
  getValue: () => unknown;
}

export type CellEditorFn = (
  cell: CellLike,
  onRendered: (fn: () => void) => void,
  success: (value: unknown) => void,
  cancel: () => void,
) => HTMLElement;

export type CellFormatterFn = (cell: CellLike) => HTMLElement;

/** Detached-host factory — grid-view owns the one sanctioned document.createElement. */
export type HostFactory = (className: string) => HTMLElement;

/** Commit/cancel wiring shared by every text-ish editor. */
function inputEditor(makeHost: HostFactory, column: GridColumn, inputType: string): CellEditorFn {
  return (cell, onRendered, success, cancel) => {
    const host = makeHost("jx-grid-editor");
    let done = false;
    const commit = (raw: string) => {
      if (!done) {
        done = true;
        success(coerceCellInput(raw, column));
      }
    };
    const abort = () => {
      if (!done) {
        done = true;
        cancel();
      }
    };
    const initial =
      column.kind === "date"
        ? cellToText(cell.getValue() as GridCellValue).slice(0, 10)
        : cellToText(cell.getValue() as GridCellValue);
    render(
      html`<input
        class="jx-grid-input"
        type=${inputType}
        .value=${initial}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter") {
            commit((e.target as HTMLInputElement).value);
          } else if (e.key === "Escape") {
            abort();
          }
        }}
        @blur=${(e: Event) => commit((e.target as HTMLInputElement).value)}
      />`,
      host,
    );
    onRendered(() => {
      const input = host.querySelector("input");
      input?.focus();
      input?.select();
    });
    return host;
  };
}

function checkboxEditor(makeHost: HostFactory): CellEditorFn {
  return (cell, onRendered, success, cancel) => {
    const host = makeHost("jx-grid-editor");
    let done = false;
    render(
      html`<input
        class="jx-grid-checkbox"
        type="checkbox"
        .checked=${cell.getValue() === true}
        @change=${(e: Event) => {
          if (!done) {
            done = true;
            success((e.target as HTMLInputElement).checked);
          }
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Escape" && !done) {
            done = true;
            cancel();
          } else if (e.key === "Enter" && !done) {
            done = true;
            success((e.target as HTMLInputElement).checked);
          }
        }}
        @blur=${(e: Event) => {
          if (!done) {
            done = true;
            success((e.target as HTMLInputElement).checked);
          }
        }}
      />`,
      host,
    );
    onRendered(() => host.querySelector("input")?.focus());
    return host;
  };
}

function selectEditor(makeHost: HostFactory, column: GridColumn): CellEditorFn {
  const options = Array.isArray(column.schema?.enum)
    ? (column.schema.enum as unknown[]).map(String)
    : [];
  return (cell, onRendered, success, cancel) => {
    const host = makeHost("jx-grid-editor");
    let done = false;
    const current = cellToText(cell.getValue() as GridCellValue);
    render(
      html`<select
        class="jx-grid-select"
        @change=${(e: Event) => {
          if (!done) {
            done = true;
            const { value } = e.target as HTMLSelectElement;
            success(value === "" ? null : value);
          }
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Escape" && !done) {
            done = true;
            cancel();
          }
        }}
        @blur=${() => {
          if (!done) {
            done = true;
            cancel();
          }
        }}
      >
        <option value="" ?selected=${current === ""}>—</option>
        ${options.map(
          (option) =>
            html`<option value=${option} ?selected=${option === current}>${option}</option>`,
        )}
      </select>`,
      host,
    );
    onRendered(() => host.querySelector("select")?.focus());
    return host;
  };
}

/** Pill/chip editor for string arrays: Enter/comma adds, Backspace pops, × removes. */
function pillEditor(makeHost: HostFactory, column: GridColumn): CellEditorFn {
  return (cell, onRendered, success, cancel) => {
    const host = makeHost("jx-grid-editor jx-grid-pill-editor");
    const initial = coerceCellInput(cell.getValue(), column);
    const chips: string[] = Array.isArray(initial) ? [...initial] : [];
    let done = false;
    const finish = (committed: string[] | null) => {
      if (done) {
        return;
      }
      done = true;
      if (committed) {
        success(committed);
      } else {
        cancel();
      }
    };
    const inputEl = () => host.querySelector("input");
    const addFromInput = (input: HTMLInputElement): boolean => {
      const text = input.value.trim();
      if (text === "") {
        return false;
      }
      chips.push(text);
      input.value = "";
      return true;
    };
    const doRender = () => {
      render(
        html`<span class="jx-grid-pills">
          ${chips.map(
            (chip, i) => html`<span class="jx-grid-chip"
              >${chip}<button
                class="jx-grid-chip-x"
                title="Remove"
                @mousedown=${(e: Event) => e.preventDefault()}
                @click=${() => {
                  chips.splice(i, 1);
                  doRender();
                  inputEl()?.focus();
                }}
              >
                ×
              </button></span
            >`,
          )}
          <input
            class="jx-grid-pill-input"
            placeholder=${chips.length === 0 ? "add…" : ""}
            @keydown=${(e: KeyboardEvent) => {
              const input = e.target as HTMLInputElement;
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                if (addFromInput(input)) {
                  doRender();
                  inputEl()?.focus();
                } else if (e.key === "Enter") {
                  finish([...chips]);
                }
              } else if (e.key === "Backspace" && input.value === "" && chips.length > 0) {
                chips.pop();
                doRender();
                inputEl()?.focus();
              } else if (e.key === "Escape") {
                finish(null);
              }
            }}
            @blur=${(e: Event) => {
              addFromInput(e.target as HTMLInputElement);
              finish([...chips]);
            }}
          />
        </span>`,
        host,
      );
    };
    doRender();
    onRendered(() => inputEl()?.focus());
    return host;
  };
}

/** Editor factory for a column; undefined means the column is not editable in place. */
export function editorForColumn(
  column: GridColumn,
  makeHost: HostFactory,
): CellEditorFn | undefined {
  if (column.kind === "readonly" || (!column.editable && !column.insertOnly)) {
    return undefined;
  }
  switch (column.kind) {
    case "boolean": {
      return checkboxEditor(makeHost);
    }
    case "enum": {
      return selectEditor(makeHost, column);
    }
    case "date": {
      return inputEditor(makeHost, column, "date");
    }
    case "array": {
      return pillEditor(makeHost, column);
    }
    default: {
      // String/text/number/image/reference — text input + column-typed coercion.
      return inputEditor(makeHost, column, "text");
    }
  }
}

/** Formatter factory — plain-text projection rendered as a real element (innerHTML-safe). */
export function formatterForColumn(column: GridColumn, makeHost: HostFactory): CellFormatterFn {
  return (cell) => {
    const value = cell.getValue() as GridCellValue;
    const host = makeHost(`jx-grid-cell-content jx-grid-kind-${column.kind}`);
    if (column.kind === "boolean") {
      render(html`${value === true ? "✓" : ""}`, host);
    } else if (column.kind === "array" && Array.isArray(value)) {
      render(html`${value.map((item) => html`<span class="jx-grid-chip">${item}</span>`)}`, host);
    } else {
      render(html`${cellToText(value)}`, host);
    }
    return host;
  };
}
