/**
 * `jx-toolbar`'s behaviour sidecar: the roving caret over a row of MIXED controls, and the one
 * question `jx-action-group` never has to ask — does the control the caret is standing on want this
 * key for itself?
 *
 * **Why this is not `jx-action-group`.** That element roves `jx-action-button` and nothing else:
 * its `itemsOf` is a query for one tag, its `compact` seam is a rule about that tag's borders, and
 * its `selects="single"` clicks the child an arrow lands on. Both surfaces this element was built
 * for — Studio's grid toolbar and the Project Styles chrome bar — hold a `jx-textfield` beside
 * their buttons, and a text field is precisely the child that breaks every one of those three: it
 * is not an action button, it has no border to join, and an arrow key inside it is a caret move
 * rather than a selection. So the two elements are not one element under two names.
 * `jx-action-group` is a ROW OF BUTTONS that may be joined into a segmented control or made a
 * radiogroup; `jx-toolbar` is a CONTAINER OF ARBITRARY CONTROLS with one tab stop.
 *
 * What it does beyond reading state is the allowed set (specs/ui.md §2): move focus, write a
 * child's own declared `tabindex` prop (or, for a plain native control, its own `tabIndex`), and
 * read a text control's caret offset, which is a measurement. It measures no box, listens on no
 * document, and calls no platform overlay API. It owns no overflow menu, and §5.5 says why.
 *
 * @docs extending/ui-kit
 */

/** The tag of the toolbar. */
const TOOLBAR = "jx-toolbar";

/**
 * Anything that could take DOM focus. Deliberately not keyed on `tabindex`, because the roving
 * caret WRITES `tabindex` — a query that read it would stop finding the items it had just parked.
 */
const FOCUSABLE =
  "button, input, select, textarea, a[href], [contenteditable=''], [contenteditable='true']";

/**
 * Containers that run a roving caret of their own.
 *
 * A control inside one of these belongs to IT, not to the toolbar. Two roving carets over one set
 * of buttons is two writers of the same `tabindex`, and they do not agree: the group parks its
 * caret on the child it thinks is current and the toolbar parks the row's on another. So a nested
 * composite is left alone entirely — it keeps its own single tab stop, and the toolbar's arrows do
 * not reach into it. See §5.5 for why that limit is stated rather than engineered around.
 */
const COMPOSITE = "jx-action-group, jx-tabs, jx-tree, jx-swatch-group, jx-listbox, jx-menu";

/**
 * Controls whose own arrow keys are theirs: they step a value or drive a popup, rather than moving
 * a caret through text.
 *
 * These are not toolbar items at all, and the reason is not symmetry with {@link COMPOSITE} but
 * data loss: a reader arrowing along the row past a `<select>` or a spin button would rewrite the
 * value on the way past, once per press, and past a combobox would open and walk its list. An extra
 * tab stop is an inconvenience; silently changing what somebody chose is a defect. A text field is
 * the opposite case and IS an item — walking off the end of its text costs nothing — which is what
 * the boundary rule in {@link cedesKey} is for.
 */
const OWN_ARROWS =
  "select, input[type='range'], input[type='number'], [role='spinbutton'], [role='slider'], [role='combobox']";

/** `<input>` types that have a text caret a reader moves with the arrow keys. */
const TEXT_TYPES = new Set(["", "text", "search", "url", "tel", "password", "email"]);

/** The reactive scope a `jx-toolbar` document hands its handlers. */
export interface ToolbarState {
  orientation?: string;
  label?: string;
  [key: string]: unknown;
}

/** A toolbar item: a control, or the kit element that wraps one. */
type ItemElement = HTMLElement & { tabindex?: string; disabled?: boolean };

/** The toolbar an event's `currentTarget` is. */
function barOf(event: Event): HTMLElement | null {
  const target = event.currentTarget;
  return target instanceof HTMLElement && target.localName === TOOLBAR ? target : null;
}

/** Whether `bar` is the nearest toolbar around `node` — a key inside a nested one is its own. */
function ownsNode(bar: HTMLElement, node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(TOOLBAR) === bar;
}

/**
 * The element a focusable node stands for: the OUTERMOST custom element between it and the toolbar,
 * or the node itself when there is none.
 *
 * This is what makes one item out of the several focusable nodes a kit control owns — a
 * `jx-textfield` is its `<input>` AND its clear `<button>`, and a toolbar that counted both would
 * park a caret on a button that only exists while the field has a value. It is also what sees
 * through the `display: contents` wrappers a `$switch` branch leaves around a single control, which
 * Studio's grid toolbar has four of.
 *
 * @param bar The toolbar.
 * @param node A focusable node inside it.
 * @returns The item that node belongs to.
 */
function itemFor(bar: HTMLElement, node: HTMLElement): ItemElement {
  let item: ItemElement = node;
  for (let el = node.parentElement; el && el !== bar; el = el.parentElement) {
    if (el.localName.includes("-")) {
      item = el as ItemElement;
    }
  }
  return item;
}

/**
 * The node inside an item that actually takes focus.
 *
 * `[part="control"]` and `[part="input"]` are the kit's own two names for "this element's own
 * control" (`jx-button`, `jx-action-button`, `jx-swatch` and `jx-color-field` use the first,
 * `jx-textfield` and `jx-number-field` the second), so they are asked for first — but only if the
 * node wearing the name is FOCUSABLE. A composed control names the one node it wants roved: the
 * colour field is a swatch, a text field and two doors, and the swatch wears the name because it is
 * the opener, so the query finds it ahead of the text field's `[part="input"]`. On `jx-checkbox`
 * and `jx-switch` `[part="control"]` is the `<label>` that wraps the input, so taking the named
 * node on trust focused a label, which focuses nothing, and left the real control where it was. A
 * plain native control is its own answer, and anything else falls back to the first focusable node
 * the item holds.
 *
 * @param item A toolbar item.
 * @returns The node to focus and to ask about a key.
 */
export function controlOf(item: ItemElement): HTMLElement {
  if (item.matches(FOCUSABLE)) {
    return item;
  }
  const named = [...item.querySelectorAll<HTMLElement>('[part="control"], [part="input"]')].find(
    (node) => node.matches(FOCUSABLE),
  );
  return named ?? item.querySelector<HTMLElement>(FOCUSABLE) ?? item;
}

/**
 * The toolbar's own items, in document order.
 *
 * @param bar The `jx-toolbar` element.
 * @returns The controls it roves; a nested toolbar's, a nested composite's and a control that owns
 *   its own arrow keys are not among them.
 */
export function itemsOf(bar: HTMLElement): ItemElement[] {
  const items: ItemElement[] = [];
  for (const node of bar.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (node.closest(TOOLBAR) !== bar) {
      continue;
    }
    const composite = node.closest<HTMLElement>(COMPOSITE);
    if (composite && bar.contains(composite)) {
      continue;
    }
    const item = itemFor(bar, node);
    if (!items.includes(item) && !controlOf(item).matches(OWN_ARROWS)) {
      items.push(item);
    }
  }
  return items;
}

/**
 * Whether an item cannot take the caret.
 *
 * Read from the PROPERTY once the child has upgraded and from the attribute before it has, for the
 * reason `behaviors/action-group.ts` gives: the caret is placed from a lifecycle event and a
 * slotted child's own `connectedCallback` is async, so the toolbar can be asked to rove either side
 * of that moment. `hidden` counts too — a control a branch has hidden rather than removed is one
 * the reader cannot see, and a caret parked on it is a tab stop that goes nowhere.
 */
function isOut(item: ItemElement): boolean {
  if (item.hidden) {
    return true;
  }
  return item.disabled === undefined ? item.hasAttribute("disabled") : item.disabled === true;
}

/** The roving `tabindex` an item is currently carrying, as the string it was written as. */
function caretOf(item: ItemElement): string {
  return "tabindex" in item ? String(item.tabindex ?? "") : (item.getAttribute("tabindex") ?? "");
}

/**
 * Write the roving `tabindex` onto one item.
 *
 * A kit control declares a `tabindex` PROP for exactly this — it forwards the value to the native
 * control inside itself, so the toolbar never reaches into another element's internals. A plain
 * native control in the row is its own control, so its own `tabIndex` is that same write.
 */
function setCaret(item: ItemElement, value: string): void {
  if ("tabindex" in item) {
    item.tabindex = value;
  } else if (item.matches(FOCUSABLE)) {
    item.tabIndex = Number(value);
  }
}

/** Write `0` on `caret` and `-1` on every other item, the ones that cannot act included. */
function writeRoving(items: ItemElement[], caret: ItemElement | null): void {
  for (const item of items) {
    setCaret(item, item === caret ? "0" : "-1");
  }
}

/** The item that should hold the caret: the one that already does and still can, else the first. */
function caretFor(items: ItemElement[]): ItemElement | null {
  const live = items.filter((item) => !isOut(item));
  return live.find((item) => caretOf(item) === "0") ?? live[0] ?? null;
}

/**
 * Move the caret to the reachable item at `index`, wrapping at both ends, and focus its control.
 *
 * @param bar The toolbar whose caret is moving.
 * @param index An index into the REACHABLE items; negative counts from the end.
 * @returns The item that took the caret, or null when the toolbar has none that can.
 */
export function focusItem(bar: HTMLElement, index: number): ItemElement | null {
  const items = itemsOf(bar);
  const live = items.filter((item) => !isOut(item));
  if (live.length === 0) {
    return null;
  }
  const at = ((index % live.length) + live.length) % live.length;
  const caret = live[at]!;
  writeRoving(items, caret);
  controlOf(caret).focus();
  return caret;
}

/**
 * Whether a text control's caret has nowhere left to go in the direction `forward` names.
 *
 * A selection that cannot be read counts as the edge, and that direction is chosen deliberately: a
 * toolbar that ceded a key it could not reason about would leave the reader inside a control with
 * no arrow key out of it, which is SC 2.1.2. Chrome refuses `selectionStart` on `type="email"`, and
 * happy-dom answers null for the types it does not model, so this is a case that really occurs.
 */
function atEdge(node: HTMLInputElement | HTMLTextAreaElement, forward: boolean): boolean {
  let start: number | null = null;
  let end: number | null = null;
  try {
    start = node.selectionStart;
    end = node.selectionEnd;
  } catch {
    return true;
  }
  if (start === null || end === null) {
    return true;
  }
  if (start !== end) {
    // A live selection is a gesture in progress; the arrow that collapses it is the control's.
    return false;
  }
  return forward ? start >= String(node.value ?? "").length : start <= 0;
}

/** Whether `node` is a control with a text caret the arrow keys move. */
function isTextEntry(node: HTMLElement): node is HTMLInputElement | HTMLTextAreaElement {
  if (node.localName === "textarea") {
    return true;
  }
  return (
    node.localName === "input" && TEXT_TYPES.has((node.getAttribute("type") ?? "").toLowerCase())
  );
}

/**
 * Whether the focused control answers this key itself, so the toolbar must not.
 *
 * The whole of the mixed-row problem is here. A toolbar owns the arrow pair of its own axis, and
 * inside a text field that same pair moves the caret — the APG's own note says a toolbar holding
 * such a control needs an answer and does not give one. This is the answer: **the field keeps the
 * key while it has text left to walk in that direction, and the toolbar takes it at the edge.** So
 * the reader arrows in, edits, and arrows out with the same key they came in with, and no gesture
 * is lost either way. Home and End are the field's unconditionally, because inside text they mean
 * the ends of the line and a toolbar that stole them would break editing to save a keystroke.
 *
 * @param node The event's target.
 * @param key The key pressed.
 * @param forward The toolbar's own forward key on its own axis.
 * @returns Whether to stand aside.
 */
export function cedesKey(node: EventTarget | null, key: string, forward: string): boolean {
  if (!(node instanceof HTMLElement) || !isTextEntry(node)) {
    return false;
  }
  if (key === "Home" || key === "End") {
    return true;
  }
  return !atEdge(node, key === forward);
}

/**
 * Give the toolbar exactly one tab stop.
 *
 * Without this every control in the row is its own, because a native `<button>` and a native
 * `<input>` are both focusable with no `tabindex` at all — so the collapse to one is a WRITE that
 * has to happen before the reader's first Tab, not something their first arrow key can repair.
 *
 * Idempotent, which is what lets it be called from a lifecycle event that may arrive more than once
 * and from the observer below on every change to the row.
 *
 * @param bar The `jx-toolbar` element.
 */
export function syncRoving(bar: HTMLElement): void {
  const items = itemsOf(bar);
  writeRoving(items, caretFor(items));
}

/** Whether the row already says what {@link syncRoving} would write. */
function isSettled(bar: HTMLElement): boolean {
  const items = itemsOf(bar);
  const caret = caretFor(items);
  return items.every((item) => caretOf(item) === (item === caret ? "0" : "-1"));
}

/** Toolbars already being watched, so a second `jx-ready` does not observe one twice. */
const watched = new WeakSet<HTMLElement>();

/**
 * Keep the one-tab-stop invariant as the row's controls come and go.
 *
 * A Studio toolbar is not a fixed row: the grid's Add Row and Delete Rows appear with the source's
 * capabilities, its pager appears with a second page, and every button in it enables and disables
 * with the selection. A control appended afterwards arrives with no `tabindex` at all, which is a
 * SECOND tab stop in an element whose whole purpose is to have one; removing or disabling the one
 * holding the caret leaves ZERO, so a row of operable controls cannot be reached by Tab.
 *
 * `hidden` is watched beside `disabled` because {@link isOut} reads it, and the `$switch` branches a
 * surface writes are not the only way a control leaves the row.
 *
 * @param bar The `jx-toolbar` element.
 */
function watchRoving(bar: HTMLElement): void {
  if (watched.has(bar)) {
    return;
  }
  watched.add(bar);
  /* `isSettled` first, so the observer writes only when the invariant is actually broken: a
     re-write is a mutation of its own, and a callback that always writes is a loop. */
  const observer = new MutationObserver(() => {
    if (!isSettled(bar)) {
      syncRoving(bar);
    }
  });
  observer.observe(bar, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "hidden"],
  });
}

/**
 * The toolbar keyboard contract: the arrow pair of its own axis moves the caret between controls
 * with wrap, Home and End go to the ends, and a control that answers the key itself keeps it.
 *
 * Enter, Space, the focus ring and `:disabled` are the platform's, on each control.
 *
 * @param {ToolbarState} state
 * @param {KeyboardEvent} event
 */
export function onToolbarKeydown(state: ToolbarState, event: KeyboardEvent): void {
  const bar = barOf(event);
  if (!bar || !ownsNode(bar, event.target)) {
    return;
  }
  const vertical = state.orientation === "vertical";
  const forward = vertical ? "ArrowDown" : "ArrowRight";
  const back = vertical ? "ArrowUp" : "ArrowLeft";
  if (event.key !== forward && event.key !== back && event.key !== "Home" && event.key !== "End") {
    return;
  }
  if (cedesKey(event.target, event.key, forward)) {
    return;
  }
  const live = itemsOf(bar).filter((item) => !isOut(item));
  if (live.length === 0) {
    return;
  }
  const active = live.findIndex(
    (item) =>
      item === event.target || (event.target instanceof Node && item.contains(event.target)),
  );
  let index: number;
  if (event.key === forward) {
    index = active + 1;
  } else if (event.key === back) {
    index = active === -1 ? -1 : active - 1;
  } else if (event.key === "Home") {
    index = 0;
  } else {
    index = -1;
  }
  focusItem(bar, index);
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Collapse the toolbar to one tab stop once it has rendered, and keep it collapsed to one.
 *
 * `onMount` is handed the reactive scope alone, so the element announces itself with `jx-ready` —
 * the kit's existing readiness event — and this reads the host off that event.
 *
 * @param {ToolbarState} _state
 * @param {Event} event
 */
export function onToolbarReady(_state: ToolbarState, event: Event): void {
  const bar = barOf(event);
  if (bar) {
    syncRoving(bar);
    watchRoving(bar);
  }
}
