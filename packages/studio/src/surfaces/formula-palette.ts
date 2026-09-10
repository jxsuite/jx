/// <reference lib="dom" />
/**
 * The formula palette (spec §19.9): a search over the formula catalog, mounted into the popover
 * layer as a Jx document.
 *
 * `formula-palette.json` is the markup, the ARIA and the style; this is the decisions — which
 * entries match the query, how they group, which one the highlight is on, and what a pick hands
 * back. Two controls open it, the expression editor's ⟨⟩ button and the formula workspace's Catalog
 * button, and both pass the same three things: the catalog to browse, what to do with a pick, and
 * the control the panel should hang under.
 *
 * **The mount is standing.** One slot in the popover layer, one document in it, and `open` is a
 * field of the scope rather than a render call — so opening the palette twice reuses the same
 * element tree and the `$switch` on `open` is what puts the overlay on screen and takes it away.
 * `getLayerSlot` hands back the same slot every time until something clears it, which is the one
 * case that re-mounts: a slot the layer no longer holds is not one this module may render into.
 *
 * **The rows and the highlight are separate fields**, exactly as `surfaces/palette.json`'s are —
 * and the highlight is now ONE field rather than a per-row comparison. A key moves `activeId`, the
 * kit's `jx-listbox` is handed that id as `active`, and its sidecar is the single writer of every
 * `jx-option`'s `selected`; `groups` changes only when the query does, and the keyed lists
 * reconcile then and only then. The same string is what the field points `aria-activedescendant`
 * at, so the row a reader hears and the row a reader sees cannot come apart. That is also why each
 * row carries the FLAT index it occupies across all the groups: the rows are a nested `$map`, an
 * inner map cannot reach the outer one's counter, and the index is what the id, the row's `value`
 * and a hover all name.
 *
 * @docs studio/logic/formulas
 */

import { reactive } from "../reactivity";
import { getLayerSlot } from "../ui/layers";
import { mountSurface, registerSurface } from "../ui/surface";
import { rectOf } from "../utils/geometry";
import formulaPaletteDoc from "./formula-palette.json";

import type { FormulaCatalogEntry } from "../ui/formula-catalog";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("formula-palette", formulaPaletteDoc as unknown as JxDocument);

/** The popover slot id, and so the `overlay.popover:formula-palette` region the shots address. */
const SLOT = "formula-palette";

/** The panel's width, needed to keep an anchored panel inside the right-hand edge. */
const PANEL_WIDTH = 568;

export interface FormulaPaletteOpts {
  entries: FormulaCatalogEntry[];
  onPick: (entry: FormulaCatalogEntry) => void;
  /** Optional anchor element the panel is positioned under; centered when absent. */
  anchor?: HTMLElement | null;
}

/** One catalog entry, as the document draws it. */
interface RowProjection {
  /** Identity across updates: the entry's kind and name, which no two entries share. */
  key: string;
  /**
   * Where this row sits in the FLAT list of matches — what a key, a click and a hover all address.
   *
   * The rows are a `$map` inside a `$map`, and the inner one's `$map.index` counts within its own
   * group. A row that only knew that could neither build the id the highlight is named by nor carry
   * it as the `value` its own `select` event hands back.
   */
  index: number;
  label: string;
  description: string;
  kind: string;
}

/** One catalog group, in the catalog's own first-seen order. */
interface GroupProjection {
  key: string;
  label: string;
  rows: RowProjection[];
}

/** The scope `formula-palette.json` reads, and the six things a gesture asks of this module. */
interface FormulaPaletteScope extends Record<string, unknown> {
  open: boolean;
  query: string;
  groups: GroupProjection[];
  /**
   * The highlighted row's element id — the field's `aria-activedescendant` AND the listbox's
   * `active`, which is the one string this surface writes to move the caret. `""` when no row can
   * take it.
   */
  activeId: string;
  /** Whether the listbox has anything in it — the combobox's `aria-expanded`. */
  expanded: boolean;
  isEmpty: boolean;
  /** Which empty state: nothing matched what was typed, or there was nothing to match. */
  emptyHint: string;
  anchored: boolean;
  /** The two measured custom properties an anchored panel is positioned by; empty when centred. */
  anchorVars: string;
  close: () => void;
  input: (value: string) => void;
  move: (delta: number) => void;
  activate: () => void;
  hover: (index: number) => void;
  activateRow: (value: unknown) => void;
}

let _open = false;
let _opts: FormulaPaletteOpts | null = null;
let _query = "";
let _selectedIndex = 0;
/** The matches as last projected, so a key or a click addresses the row the reader sees. */
let _matches: FormulaCatalogEntry[] = [];

let _scope: FormulaPaletteScope | null = null;
let _mount: Promise<SurfaceHandle> | null = null;
let _host: HTMLElement | null = null;

/** The element id of the row at `index`; the document spells the same string. */
function optionId(index: number): string {
  return `formula-palette-option-${index}`;
}

/** Entries matching the current query (label, name, group, or description substring). */
function filteredEntries(): FormulaCatalogEntry[] {
  const entries = _opts?.entries ?? [];
  const needle = _query.trim().toLowerCase();
  if (!needle) {
    return entries;
  }
  return entries.filter(
    (e) =>
      e.label.toLowerCase().includes(needle) ||
      e.name.toLowerCase().includes(needle) ||
      e.group.toLowerCase().includes(needle) ||
      e.description.toLowerCase().includes(needle),
  );
}

/** Group entries for display, preserving first-seen group order and carrying the flat index. */
function groupRows(entries: readonly FormulaCatalogEntry[]): GroupProjection[] {
  const groups = new Map<string, GroupProjection>();
  for (const [index, entry] of entries.entries()) {
    const row: RowProjection = {
      description: entry.description,
      index,
      key: `${entry.kind}:${entry.name}`,
      kind: entry.kind,
      label: entry.label,
    };
    const bucket = groups.get(entry.group);
    if (bucket) {
      bucket.rows.push(row);
    } else {
      groups.set(entry.group, { key: entry.group, label: entry.group, rows: [row] });
    }
  }
  return [...groups.values()];
}

/**
 * The panel's position as two custom properties, or the empty string for a centred panel.
 *
 * A rect belongs to the moment it was measured, so this is taken once per open and written as data
 * the document's own rule reads. A zero box is what a detached or unlaid-out anchor gives back, and
 * pinning the panel to the top-left corner of the window is worse than centring it.
 */
function anchorVars(anchor: HTMLElement | null): string {
  if (!anchor) {
    return "";
  }
  const rect = rectOf(anchor);
  if (rect.top === 0 && rect.left === 0 && rect.width === 0) {
    return "";
  }
  const left = Math.max(8, Math.min(rect.left, (globalThis.innerWidth || 1200) - PANEL_WIDTH));
  return `--formula-palette-left:${left}px;--formula-palette-top:${rect.bottom + 4}px`;
}

/** The document's scope, created once. */
function scope(): FormulaPaletteScope {
  _scope ??= reactive<FormulaPaletteScope>({
    activate: () => {
      const entry = _matches[_selectedIndex];
      if (entry) {
        pickEntry(entry);
      }
    },
    activateRow: (value) => {
      /* The row's own `select` carries its `value`, which is the flat index as the document spelled
         it — a string, because an attribute is what a row's value is. */
      const entry = _matches[Number(value)];
      if (entry) {
        pickEntry(entry);
      }
    },
    activeId: "",
    anchored: false,
    anchorVars: "",
    close: closeFormulaPalette,
    emptyHint: "",
    expanded: false,
    groups: [],
    hover: (index) => {
      select(index);
    },
    input: (value) => {
      _query = value;
      _selectedIndex = 0;
      project();
    },
    isEmpty: true,
    move: (delta) => {
      /* Nothing to move through, nothing to name. Clamping an empty list lands on index 0, and now
         that the id IS the highlight that would point the field at a row which is not there. */
      if (_matches.length === 0) {
        return;
      }
      select(Math.max(0, Math.min(_selectedIndex + delta, _matches.length - 1)));
    },
    open: false,
    query: "",
  }) as FormulaPaletteScope;
  return _scope;
}

/**
 * Move the highlight without touching the rows, so nothing reconciles on an arrow key.
 *
 * ONE field is written. The listbox turns that id into the active row's `selected`; before the kit
 * owned it, this wrote a second field as well and every row re-decided its own `aria-selected` and
 * `data-selected` against it.
 */
function select(index: number): void {
  _selectedIndex = index;
  scope().activeId = optionId(index);
}

/**
 * Mount the document into the popover slot, once.
 *
 * `getLayerSlot` hands back the same element until something clears it; a different one means the
 * slot this module was rendering into is gone from the layer, and the standing mount goes with it.
 */
function ensureMounted(): void {
  const host = getLayerSlot("popover", SLOT);
  if (_host === host) {
    return;
  }
  const stale = _mount;
  _host = host;
  _mount = mountSurface("formula-palette", scope(), host);
  if (stale) {
    void stale.then((handle) => {
      handle.dispose();
    });
  }
}

/** Project the palette's state onto the document's scope. */
function project(): void {
  const state = scope();
  state.open = _open;
  if (!_open) {
    _matches = [];
    return;
  }
  const entries = filteredEntries();
  _matches = entries;
  state.query = _query;
  state.groups = groupRows(entries);
  state.isEmpty = entries.length === 0;
  state.emptyHint = _query.trim() === "" ? "No entries available" : "No results";
  state.expanded = entries.length > 0;
  /* No rows, no active descendant: an id pointing at a row that is not there is a field claiming a
     highlight a reader would never find. */
  state.activeId = entries.length > 0 ? optionId(_selectedIndex) : "";
}

/**
 * Focus the field once the document has drawn it.
 *
 * The mount settling means the DOCUMENT rendered; the `$switch` on `open` reconciles one microtask
 * later, so the field exists a turn after that — which is why this waits for the mount and then for
 * a turn, rather than reaching for the element straight away.
 */
function focusInput(): void {
  const pending = _mount;
  if (!pending) {
    return;
  }
  void pending.then(() => {
    setTimeout(() => {
      if (_open) {
        _host?.querySelector<HTMLInputElement>('[part="input"]')?.focus();
      }
    }, 0);
  });
}

/** Close first, then hand the entry over: the caller usually opens something of its own. */
function pickEntry(entry: FormulaCatalogEntry): void {
  const opts = _opts;
  closeFormulaPalette();
  opts?.onPick(entry);
}

/**
 * Open the palette over `opts.entries`.
 *
 * @param {FormulaPaletteOpts} opts
 */
export function openFormulaPalette(opts: FormulaPaletteOpts): void {
  _open = true;
  _opts = opts;
  _query = "";
  _selectedIndex = 0;
  const state = scope();
  const vars = anchorVars(opts.anchor ?? null);
  state.anchorVars = vars;
  state.anchored = vars !== "";
  ensureMounted();
  project();
  focusInput();
}

/** Close the palette. A no-op when it is not up. */
export function closeFormulaPalette(): void {
  _open = false;
  _opts = null;
  if (_mount) {
    project();
  }
}
