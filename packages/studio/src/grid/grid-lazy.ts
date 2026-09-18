/**
 * Lazy grid engine.
 *
 * `grid-view.ts` is the only module that imports `tabulator-tables`, and as of 6.5.3 Tabulator's
 * `Row` class runs `document.createElement` in a static field, so the CLASS DEFINITION — not the
 * table's construction — needs a DOM to exist. That makes `grid-view.ts` unsafe to reach with a
 * static value-import from any module that must load with no DOM: `app-commands.ts` pulls
 * `gridViewCommands` from `grid-panel.ts` for the command set `scripts/check-command-levels.ts` and
 * its siblings read in a bare Bun process (see `commands/defaults.ts`'s note on
 * `selection.convertToComponent` for the sibling convention this follows).
 *
 * So `grid-panel.ts` never has a static value-import of `./grid-view`; it loads the engine through
 * here instead, exactly as `services/monaco-lazy.ts` defers Monaco. Real usage pays no cost for it
 * — a grid tab cannot exist before `document` does — and the two accessors mirror Monaco's: one for
 * code that MOUNTS a grid (async is free there), one for code that can only run with a grid engine
 * already loaded.
 */
import type * as gridViewModule from "./grid-view";

export type GridEngine = typeof gridViewModule;

let _engine: GridEngine | null = null;
let _loading: Promise<GridEngine> | null = null;

/**
 * Load the Tabulator-backed grid engine. Memoized — concurrent callers share one import.
 *
 * @returns {Promise<GridEngine>}
 */
export function loadGridEngine(): Promise<GridEngine> {
  if (_engine) {
    return Promise.resolve(_engine);
  }
  // Not `async`: an async function wraps the memo in a fresh promise per call, so concurrent
  // Callers could not observe that they share one in-flight load.
  _loading ??= import("./grid-view").then((engine) => {
    _engine = engine;
    return engine;
  });
  return _loading;
}

/**
 * The loaded engine, or null before the first grid mount.
 *
 * For call sites that can run synchronously once a grid already exists in the session — they must
 * not force the module to load, only read it if it is already there.
 *
 * @returns {GridEngine | null}
 */
export function loadedGridEngine(): GridEngine | null {
  return _engine;
}

/** Reset the memo (tests only). */
export function resetGridLazy(): void {
  _engine = null;
  _loading = null;
}
