/**
 * `jx-combobox`'s sidecar: the keyboard a field owns over a list it does not contain, and the two
 * measurements that place the panel.
 *
 * The element is the composed half of the pair `jx-listbox` and `jx-option` are the primitive half
 * of. It brings one native `<input role="combobox">`, a `jx-popover` holding a `jx-listbox` of its
 * own rows, and the APG's editable-combobox contract over the two — reaching the list only through
 * `aria-controls` and `aria-activedescendant`, which are id references and therefore only resolve
 * because the kit is light DOM (specs/ui.md §2 principle 2).
 *
 * Four decisions here are decisions rather than defaults, and each is a thing a second answer would
 * be worse at:
 *
 * 1. **The element filters NOTHING.** `options` is the list that will be drawn, not a corpus to match
 *    against. Studio's palettes rank with a fuzzy scorer that knows about modes, recents and
 *    chords; `ai-credentials-form` shows a catalogue fetched from a provider. An element with its
 *    own opinion about matching would be a second ranking every one of them had to defeat, so the
 *    host re-answers `options` on `input` and this module never reads the text to decide a row.
 * 2. **Typing highlights nothing.** After a keystroke `activeIndex` is `-1`, so Enter commits what the
 *    READER typed until they arrow onto a row. That is what makes `allowsCustomValue` mean
 *    something — the reported gap is a model id field whose catalogue is "a set of suggestions,
 *    never a whitelist" — and it is equally right for a closed list, which refuses the text on
 *    commit rather than silently answering a different question.
 * 3. **Home and End are left alone.** They belong to the text caret in the field, which is where the
 *    reader's cursor actually is. The APG gives them to the list only in the variant where the
 *    LISTBOX has focus, and this one never does.
 * 4. **A refused value is refused ON THE COMMIT, and the native `change` never escapes.** Reverting
 *    after letting the input's own `change` bubble would deliver two committed edits for one
 *    gesture — the same defect `jx-textfield`'s clear button cancels a `pointerdown` to avoid. So
 *    the refusal stops the inner event at the input and dispatches one `change` from the HOST, and
 *    a host reading `e.target.value` reads the value that stands either way.
 *
 * @docs extending/ui-kit
 */

import { close, openAt } from "./popover.ts";

/** A row as the element draws it. */
export interface ComboboxRow {
  /** What the row commits; also what it draws, unless it carries a `label`. */
  value: string;
  /** What the row draws. */
  label?: string;
  /** A muted note at the end of the row. */
  description?: string;
  /** A row that cannot be picked. */
  disabled?: boolean;
  /** The face the row's label draws in. */
  face?: string;
  /** A colour chip before the label. */
  swatch?: string;
  /** A border-style rule before the label. */
  line?: string;
}

/** The reactive scope a `jx-combobox` document hands its handlers. */
export interface ComboboxState {
  value?: string;
  committed?: string;
  options?: ComboboxRow[];
  open?: boolean;
  activeIndex?: number;
  allowsCustomValue?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  uid?: string;
  [key: string]: unknown;
}

const HOST = "jx-combobox";

/** How many stems have been minted, so no two instances share one. */
let minted = 0;

/** The `jx-combobox` an event is being handled inside, whichever node bound the handler. */
function comboboxOf(event: Event): HTMLElement | null {
  const target = event.currentTarget;
  return target instanceof Element ? target.closest<HTMLElement>(HOST) : null;
}

/** The element's own text control. */
export function inputOf(host: HTMLElement): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('input[part="input"]');
}

/** The element's own panel. */
function panelOf(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('[part="popup"]');
}

/** The rows the element was handed, whatever it was handed. */
function rowsOf(state: ComboboxState): ComboboxRow[] {
  return Array.isArray(state.options) ? state.options : [];
}

/** Dispatch the element's own events, so `e.target` is the element and `e.target.value` its value. */
function announce(host: HTMLElement, ...names: string[]): void {
  for (const name of names) {
    host.dispatchEvent(new Event(name, { bubbles: true }));
  }
}

/** Whether the element may open its list at all. */
function operable(state: ComboboxState): boolean {
  return state.disabled !== true && state.readonly !== true;
}

/**
 * Show the panel under the field.
 *
 * The coordinates are written before the panel is shown, which is what `jx-popover` asks of whoever
 * opens it: its own toggle handler then clamps a real position into the viewport rather than the
 * origin.
 *
 * The source is the HOST rather than the inner input, and both halves of that matter. `matchWidth`
 * measures whatever the toggle names as its source, and the list has to be as wide as the FIELD —
 * the text box plus the chevron beside it — rather than as wide as the text box alone. And light
 * dismissal treats a popover's invoker subtree as part of the panel, so naming the host is what
 * keeps a press on the input, or on the chevron, from dismissing the list it just opened.
 *
 * @param host The `jx-combobox` element.
 */
export function openList(host: HTMLElement): void {
  const panel = panelOf(host);
  if (!panel) {
    return;
  }
  const box = host.getBoundingClientRect();
  const placed = panel as HTMLElement & { x: number; y: number };
  placed.x = Math.round(box.left);
  placed.y = Math.round(box.bottom);
  openAt(panel, host);
}

/** Hide the panel. `open` follows the platform's own toggle, never a write. */
export function closeList(host: HTMLElement): void {
  const panel = panelOf(host);
  if (panel) {
    close(panel);
  }
}

/**
 * The next row a caret may land on, stepping over disabled rows and wrapping at both ends.
 *
 * `-1` in means "nothing is highlighted", and the first step from there lands on an end rather than
 * beside one: down goes to the first row, up to the last. `-1` out means there is nowhere to go.
 *
 * @param rows The rows as they are drawn.
 * @param from The index the caret is on, or -1.
 * @param step +1 or -1.
 * @returns The index to move to, or -1 when no row can take the caret.
 */
export function nextIndex(rows: ComboboxRow[], from: number, step: number): number {
  const start = from < 0 ? (step > 0 ? -1 : 0) : from;
  for (const offset of rows.keys()) {
    const at = (((start + step * (offset + 1)) % rows.length) + rows.length) % rows.length;
    if (rows[at]?.disabled !== true) {
      return at;
    }
  }
  return -1;
}

/**
 * The row a piece of text names, compared without case.
 *
 * A picker normalises what the reader typed to the row's own spelling — `GPT-4O` commits as the
 * catalogue's `gpt-4o` — because the row is what the value means and the casing is not the reader's
 * to decide. Only `value` is compared: `label` is what a row DRAWS, and a list whose labels were
 * also accepted would make two strings commit the same row and neither of them what is stored.
 *
 * @param rows The rows as they are drawn.
 * @param text The text in the field.
 * @returns The row, or null when no row holds that value.
 */
export function rowFor(rows: ComboboxRow[], text: string): ComboboxRow | null {
  const wanted = text.toLowerCase();
  return rows.find((row) => String(row.value).toLowerCase() === wanted) ?? null;
}

/**
 * Take a row: its value into the field, the list closed, the caret back where the reader was, and
 * one `input`/`change` pair from the element.
 *
 * @param state The element's reactive scope.
 * @param host The `jx-combobox` element.
 * @param row The row to commit.
 */
function commitRow(state: ComboboxState, host: HTMLElement, row: ComboboxRow): void {
  const value = String(row.value);
  state.value = value;
  state.committed = value;
  state.activeIndex = -1;
  closeList(host);
  inputOf(host)?.focus();
  announce(host, "input", "change");
}

/**
 * Mint the element's id stem and record the value it starts out holding.
 *
 * The stem is what every id reference in the document is built from — the panel's, the listbox's
 * and one per row — so a consumer writes none of them and two comboboxes on one surface cannot
 * collide. A document cannot mint it: the closed operator set has no counter and no identity, which
 * is the sidecar case specs/ui.md §3.2 sanctions.
 *
 * @param state The element's reactive scope.
 * @param _host The `jx-combobox` element.
 */
export function mountCombobox(state: ComboboxState, _host: HTMLElement): void {
  minted += 1;
  state.uid = `jx-combobox-${minted}`;
  state.committed = String(state.value ?? "");
}

/**
 * The reader typing: the text becomes the value, nothing is highlighted, and the list opens.
 *
 * @param state The element's reactive scope.
 * @param event The control's own `input`, which goes on to bubble out of the element unchanged.
 */
export function onComboboxInput(state: ComboboxState, event: Event): void {
  const host = comboboxOf(event);
  const control = event.target;
  if (!host || !(control instanceof HTMLInputElement)) {
    return;
  }
  state.value = control.value;
  state.activeIndex = -1;
  if (operable(state)) {
    openList(host);
  }
}

/**
 * The panel's own toggle: the one source of truth for `open`.
 *
 * A list light-dismissed by a click outside, or closed with Escape, moves this exactly as a call to
 * {@link closeList} does — which is why `open` is mirrored rather than written.
 *
 * @param state The element's reactive scope.
 * @param event The platform's ToggleEvent, from the panel.
 */
export function onComboboxToggle(state: ComboboxState, event: Event): void {
  const opening = (event as { newState?: string }).newState === "open";
  state.open = opening;
  if (!opening) {
    state.activeIndex = -1;
  }
}

/**
 * The chevron: open the list, or close it when it is already open.
 *
 * @param state The element's reactive scope.
 * @param event The click.
 */
export function onComboboxButton(state: ComboboxState, event: Event): void {
  const host = comboboxOf(event);
  if (!host || !operable(state)) {
    return;
  }
  if (state.open === true) {
    closeList(host);
    return;
  }
  openList(host);
  inputOf(host)?.focus();
}

/**
 * A row was activated — by a click, or by Enter through {@link onComboboxKeydown}.
 *
 * @param state The element's reactive scope.
 * @param event The row's own bubbling `select`, whose detail is its value.
 */
export function onComboboxPick(state: ComboboxState, event: Event): void {
  const host = comboboxOf(event);
  const picked = String((event as CustomEvent<unknown>).detail ?? "");
  const row = rowFor(rowsOf(state), picked);
  if (!host || !row) {
    return;
  }
  commitRow(state, host, row);
}

/**
 * The commit: what the reader typed either stands or is refused, and a closed list is what refuses
 * it.
 *
 * Bound to the CONTROL's own `change`, which the platform fires on blur and on Enter. When the
 * value is accepted the event bubbles out of the element as itself, exactly as `jx-textfield`'s
 * does, so `e.target` is the inner input and its `validity` and `form` are live. When it is refused
 * the event stops at the control and the element dispatches one of its own instead — never both,
 * because two `change` events for one edit are two undo entries for one gesture.
 *
 * @param state The element's reactive scope.
 * @param event The control's `change`.
 */
export function onComboboxCommit(state: ComboboxState, event: Event): void {
  const host = comboboxOf(event);
  if (!host) {
    return;
  }
  const text = String(state.value ?? "");
  const row = rowFor(rowsOf(state), text);
  if (state.allowsCustomValue === true || text === "" || row) {
    /* A listed value commits in the ROW's spelling, so a picker normalises the case the reader
       typed; a custom value commits verbatim. */
    state.value = row ? String(row.value) : text;
    state.committed = String(state.value);
    return;
  }
  event.stopPropagation();
  state.value = String(state.committed ?? "");
  announce(host, "change");
}

/**
 * The combobox keyboard, on the field that owns it.
 *
 * @param {ComboboxState} state
 * @param {KeyboardEvent} event
 */
export function onComboboxKeydown(state: ComboboxState, event: KeyboardEvent): void {
  const host = comboboxOf(event);
  if (!host || event.ctrlKey || event.metaKey) {
    return;
  }
  const rows = rowsOf(state);
  const at = Number(state.activeIndex ?? -1);
  switch (event.key) {
    case "ArrowDown": {
      if (!operable(state)) {
        return;
      }
      if (state.open !== true) {
        openList(host);
        state.activeIndex = event.altKey ? -1 : nextIndex(rows, -1, 1);
      } else if (!event.altKey) {
        state.activeIndex = nextIndex(rows, at, 1);
      }
      break;
    }
    case "ArrowUp": {
      if (!operable(state)) {
        return;
      }
      if (event.altKey) {
        closeList(host);
        break;
      }
      if (state.open !== true) {
        openList(host);
        state.activeIndex = nextIndex(rows, -1, -1);
      } else {
        state.activeIndex = nextIndex(rows, at, -1);
      }
      break;
    }
    case "Enter": {
      const row = state.open === true && at >= 0 ? rows[at] : undefined;
      if (!row) {
        return;
      }
      commitRow(state, host, row);
      break;
    }
    case "Tab": {
      /* The one key that commits WITHOUT being cancelled: the reader is leaving, and taking the row
         they had highlighted with them is the APG's answer for a list-autocomplete combobox. */
      const row = state.open === true && at >= 0 ? rows[at] : undefined;
      if (row) {
        commitRow(state, host, row);
      }
      return;
    }
    case "Escape": {
      if (state.open !== true) {
        return;
      }
      closeList(host);
      /* Stopped as well as cancelled: a combobox inside a dialog must not close the dialog with the
         same press that closed its own list. */
      event.stopPropagation();
      break;
    }
    default: {
      return;
    }
  }
  event.preventDefault();
}
