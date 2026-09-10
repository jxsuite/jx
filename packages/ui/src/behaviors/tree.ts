/**
 * `jx-tree`'s behaviour sidecar: the roving caret, the ARIA tree keyboard, typeahead, the
 * multi-select anchor, and the two things a WINDOWED tree cannot do for itself.
 *
 * A `<jx-tree>` IS the `role="tree"` and its `<jx-tree-item>` children are its items, so every part
 * of the APG's tree pattern a native control would supply is this module's. What it does beyond
 * reading state is exactly the allowed set (specs/ui.md §2): move focus, call an element's own
 * `scrollIntoView()`, and write a child's own declared props through the accessors that child
 * installs. It measures nothing, listens on no document, and never reaches for a foreign
 * attribute.
 *
 * **The tree draws a SLICE, and it knows it.** `jx-tree` takes a FLAT list of already-projected
 * rows — each item carrying its own `level`, `posinset` and `setsize` — because a windowed tree's
 * DOM holds only the rows the viewport can show. Two consequences run through everything below. The
 * counts a reader hears are the host's and are never derived from `items.length`, which would
 * announce "4 items" over a four-thousand-row directory. And a move that runs off either end of the
 * drawn slice has no element to land on, so it is not performed here: `padtop` and `padbottom` are
 * the element's only knowledge of what it cannot see, and a move past them dispatches `move` and
 * stops, leaving the host to scroll and write `current`. A tree with no pads is not windowed, the
 * ends of the slice are the ends of the model, and the same code clamps there instead — which is
 * the APG's answer for a tree, where the arrows deliberately do NOT wrap.
 *
 * **Typeahead is the second of those, and it does not look like the first.** A move announces its
 * own failure; a letter never does, because the search over a slice always answers and the answer
 * is simply the wrong row. A windowed tree therefore dispatches `typeahead` for EVERY printable
 * character rather than only when the slice holds no match — the pad is consulted before the rows,
 * the same order Home and End already use, and for the same reason.
 *
 * {@link syncTree} is the single writer of every drawn item's `caret`, and it is reached three ways
 * that are all the same call: from `onTreeMount`, because `defineElement` runs `applyAttributes`
 * BEFORE `distributeSlots` and no item exists when the root's bindings first evaluate; from the
 * `sync` computed the host reads through `data-current`, which is what makes a HOST write of
 * `.current` re-sync with no method call; and from the observer the mount installs, because the ROW
 * SET moves too — a scroll repaints the whole slice, and a tree whose caret-holder was scrolled
 * away has no `tabindex="0"` left at all.
 *
 * **Every key the tree does not own reaches the host untouched.** That is not tidiness: cut and
 * paste are the WCAG 2.5.7 alternative to the drag island (studio-ui-guidelines.md §8.2), they are
 * host commands with chords, and a tree that swallowed `Ctrl`/`Cmd`+`X` would take the only
 * pointer-free way to move a node with it.
 *
 * @docs extending/ui-kit
 */

/** The tag of the tree. */
const TREE = "jx-tree";
/** The tag of one row. */
const ITEM = "jx-tree-item";

/** What the reader meant by putting the caret somewhere. */
export type SelectMode = "replace" | "toggle" | "range";

/** The detail of the `select` event: an INTENT, never a resolved set. */
export interface TreeSelectDetail {
  /** The row the reader acted on. */
  value: string;
  /** Replace the selection, toggle this row into it, or extend from `anchor` to here. */
  mode: SelectMode;
  /** Where a range extends from. Equal to `value` for `replace` and `toggle`. */
  anchor: string;
}

/** The detail of the `move` event: a caret move the drawn slice cannot satisfy. */
export interface TreeMoveDetail {
  /** The row the caret is on now. */
  from: string;
  /** The key that asked for the move, so the host knows which way and how far. */
  key: string;
}

/** The detail of the `typeahead` event: a letter the drawn slice cannot answer FOR THE MODEL. */
export interface TreeTypeaheadDetail {
  /** The row the caret is on now — where the search starts, and where it wraps back to. */
  from: string;
  /** The character the reader typed, lowercased: exactly what the element matches labels on. */
  char: string;
}

/** The detail of the `expand` event: the expansion a row should be given. */
export interface TreeExpandDetail {
  /** The row whose twisty was operated. */
  value: string;
  /** The state it should be put into, not the state it is in. */
  expanded: boolean;
}

/** The reactive scope a `jx-tree` document hands its handlers. */
export interface TreeState {
  label?: string;
  multiple?: boolean;
  current?: string;
  anchor?: string;
  padtop?: number;
  padbottom?: number;
  [key: string]: unknown;
}

/** A row element with the property accessors its own document installs. */
type ItemElement = HTMLElement & {
  value?: string;
  label?: string;
  level?: number;
  expanded?: string;
  selected?: boolean;
  disabled?: boolean;
  caret?: boolean;
};

/** A tree element with the accessors its own document installs. */
type TreeElement = HTMLElement & {
  current?: string;
  anchor?: string;
  multiple?: boolean;
  padtop?: number;
  padbottom?: number;
};

/**
 * The element each scope belongs to, learned once at mount.
 *
 * A WeakMap rather than a key on the scope: the scope is a deep reactive proxy, and an element
 * stored in one is an element every effect that reads it subscribes to.
 */
const hosts = new WeakMap<object, HTMLElement>();

/** The trees already watching their own row set, so a second mount never observes twice. */
const watched = new WeakMap<HTMLElement, MutationObserver>();

/** The tree an event's `currentTarget` is. */
function hostOf(event: Event): TreeElement | null {
  const target = event.currentTarget;
  return target instanceof HTMLElement && target.localName === TREE
    ? (target as TreeElement)
    : null;
}

/** Whether `tree` is the nearest tree around `node` — a key inside a nested tree is its own. */
function ownsNode(tree: HTMLElement, node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(TREE) === tree;
}

/**
 * Read a prop from a row, from the PROPERTY once the child has upgraded and from the attribute
 * before it has.
 *
 * The caret is placed from a lifecycle event and a slotted child's own `connectedCallback` is
 * async, so a tree can legitimately be asked to rove either side of that moment.
 */
function propOf(item: ItemElement, key: keyof ItemElement, attribute: string): string {
  const value = item[key];
  return value === undefined ? (item.getAttribute(attribute) ?? "") : String(value);
}

/** What a row stands for: the detail of the events it provokes, and what `current` is matched on. */
function valueOf(item: ItemElement): string {
  return propOf(item, "value", "value");
}

/** How deep a row sits. One-based, as `aria-level` is; anything unreadable is the top level. */
function levelOf(item: ItemElement): number {
  const level = Number(propOf(item, "level", "aria-level"));
  return Number.isFinite(level) && level >= 1 ? Math.trunc(level) : 1;
}

/** A row's expansion: `"true"`, `"false"`, or `""` for a leaf, which owns no `aria-expanded`. */
function expansionOf(item: ItemElement): string {
  const expanded = propOf(item, "expanded", "aria-expanded");
  return expanded === "true" || expanded === "false" ? expanded : "";
}

/** Whether a row cannot be acted on. */
function isDisabled(item: ItemElement): boolean {
  return item.disabled === undefined
    ? item.hasAttribute("disabled") || item.getAttribute("aria-disabled") === "true"
    : item.disabled === true;
}

/**
 * What typeahead matches: the row's `label`, and where it has none, all of its text.
 *
 * Those two are not a guess and a fallback — they are exactly the two things accname computes for
 * this row. A row with a `label` writes `aria-label`, which wins over name-from-content, and a row
 * without one is named by its content. Matching anything else would let a reader type a letter the
 * row never announced and watch the caret move somewhere they were not told about.
 */
function labelOf(item: ItemElement): string {
  const named = propOf(item, "label", "label");
  return named === "" ? (item.textContent ?? "") : named;
}

/**
 * The rows of one tree, in document order, excluding the rows of any tree nested inside it and any
 * row that cannot be acted on.
 *
 * A row is the tree's own child — a `<slot>` leaves no node, so a distributed row stands where the
 * slot stood — but a host that windows wraps its `$map` output in a `role="none"` container, so
 * this walks descendants and keeps the ones whose nearest tree is this one.
 *
 * @param tree The `jx-tree` element.
 * @param options `includeDisabled` keeps rows a reader cannot act on, for the writers that must
 *   still address every drawn row.
 * @returns Its own rows, in document order.
 */
export function itemsOf(
  tree: HTMLElement,
  options: { includeDisabled?: boolean } = {},
): ItemElement[] {
  const items = [...tree.querySelectorAll<ItemElement>(ITEM)].filter(
    (item) => item.closest(TREE) === tree,
  );
  return options.includeDisabled ? items : items.filter((item) => !isDisabled(item));
}

/**
 * Write the tree's caret onto its rows: exactly one `caret`, so Tab enters and leaves the whole
 * tree in one step.
 *
 * Idempotent by construction — everything it writes is derived from the host's own `current`, and
 * an equal write into a reactive proxy triggers nothing. That matters because it runs inside a
 * render effect.
 *
 * **The caret falls back to the first drawn row, and the fallback is the point.** Under windowing
 * the row `current` names is routinely NOT drawn: it has been scrolled past. A tree that insisted
 * on it would have no `tabindex="0"` anywhere and would drop out of the tab order entirely, which
 * is the failure `jx-tabs` records for a closed tab and is worse here, because scrolling causes it.
 * The fallback moves the tab STOP and never `current` itself, so the host's model is untouched and
 * a reader who tabs in lands on a row they can see.
 *
 * @param tree The `jx-tree` element.
 */
export function syncTree(tree: HTMLElement): void {
  const items = itemsOf(tree, { includeDisabled: true });
  if (items.length === 0) {
    return;
  }
  const current = String((tree as TreeElement).current ?? "");
  const enabled = items.filter((item) => !isDisabled(item));
  const caret = enabled.find((item) => valueOf(item) === current) ?? enabled[0] ?? null;
  for (const item of items) {
    item.caret = item === caret;
  }
}

/** Keep the one-tab-stop invariant as the drawn slice comes and goes. */
function watchTree(tree: HTMLElement): void {
  if (watched.has(tree)) {
    return;
  }
  /* `syncTree` writes only properties, never children, so nothing it does can feed this observer
     back into itself. */
  const observer = new MutationObserver(() => {
    syncTree(tree);
  });
  observer.observe(tree, { childList: true, subtree: true });
  watched.set(tree, observer);
}

/**
 * The `sync` computed's body: read the caret, and put it on the rows.
 *
 * The HOST reads it as `data-current`, so it is an effect of `current` and re-runs whenever
 * anything writes that — a click, a key, or a host assigning `el.current` from the outside. It
 * takes the SCOPE rather than the value, because the runtime hands a `$src` function only its
 * declared positional arguments and the element is reachable only through the scope it was learned
 * against.
 *
 * @param scope The `jx-tree` reactive scope.
 * @returns The current caret value, for the attribute that reads it.
 */
export function applyCurrent(scope: TreeState): string {
  const current = String(scope.current ?? "");
  const host = hosts.get(scope);
  if (host) {
    syncTree(host);
  }
  return current;
}

/**
 * Learn the element, sync once the rows exist, and keep watching them.
 *
 * Reached through the `jx-ready` the root dispatches from `onMount`, which is the kit's way of
 * giving an element its first sight of itself: a mount handler is called with the scope alone, and
 * an event handler's `currentTarget` is the host.
 *
 * @param {TreeState} scope
 * @param {Event} event
 */
export function onTreeMount(scope: TreeState, event: Event): void {
  const host = hostOf(event);
  if (!host) {
    return;
  }
  hosts.set(scope, host);
  syncTree(host);
  watchTree(host);
}

/** Where the caret is now, as an index into `items`; -1 when it is nowhere. */
function activeIndex(items: ItemElement[], target: EventTarget | null): number {
  return items.findIndex(
    (item) => item === target || (target instanceof Node && item.contains(target)),
  );
}

/** Say a public thing, from the tree, so `e.target` is the element a host wrote. */
function announce(host: HTMLElement, name: string, detail: unknown): void {
  host.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
}

/**
 * Put the caret on a drawn row: write `current`, move the roving tab stop, take focus, reveal the
 * row, and say the caret moved.
 *
 * `current` is written BEFORE `change` is dispatched, so a listener reading `e.target.current` sees
 * the new value — the same order `jx-tabs` keeps for `selected`.
 */
function moveTo(host: HTMLElement, scope: TreeState, item: ItemElement): void {
  scope.current = valueOf(item);
  syncTree(host);
  item.focus();
  if (typeof item.scrollIntoView === "function") {
    item.scrollIntoView({ block: "nearest" });
  }
  announce(host, "change", valueOf(item));
}

/** Rows exist above the drawn slice. */
function hasAbove(scope: TreeState): boolean {
  return Number(scope.padtop ?? 0) > 0;
}

/** Rows exist below the drawn slice. */
function hasBelow(scope: TreeState): boolean {
  return Number(scope.padbottom ?? 0) > 0;
}

/**
 * Ask the host for a row this tree cannot reach.
 *
 * The one thing a windowed composite cannot do for itself, and the reason it is an event rather
 * than a scroll: the element knows a row exists past the pad, and nothing else about it — not where
 * it is in the model, not how tall the rows above it are, not whether the host would rather expand
 * something first.
 */
function beyond(host: HTMLElement, scope: TreeState, key: string): void {
  announce(host, "move", { from: String(scope.current ?? ""), key } satisfies TreeMoveDetail);
}

/**
 * Whether the drawn rows are only PART of the model. Both pads at zero is the only way they are
 * not.
 */
function windowed(scope: TreeState): boolean {
  return hasAbove(scope) || hasBelow(scope);
}

/**
 * Ask the host to resolve a letter against the model.
 *
 * The same shape as {@link beyond} and for the same reason, but it is reached differently, and the
 * difference is the whole point. A move off the end of the slice ANNOUNCES ITSELF: there is no
 * element to land on, so the element discovers it has run out and asks. Typeahead never discovers
 * anything — a drawn row starting with `f` either exists or does not, and whether it is the model's
 * next `f` after the caret is a question the slice cannot even pose. Left to itself the search
 * wraps inside the slice, so in a four-thousand-row directory `f` reached the twenty rows the
 * viewport happened to hold and called that the tree.
 *
 * So the pad is consulted BEFORE the rows, exactly as Home and End consult it — and a windowed tree
 * asks the host every time rather than only when it finds nothing, because "found nothing" and
 * "found the wrong row" are the same state from in here.
 */
function seek(host: HTMLElement, scope: TreeState, char: string): void {
  announce(host, "typeahead", {
    char,
    from: String(scope.current ?? ""),
  } satisfies TreeTypeaheadDetail);
}

/**
 * Say what the reader meant by landing here, and keep the anchor.
 *
 * The tree owns the ANCHOR and dispatches an INTENT; the HOST owns the selection set. That split is
 * forced by windowing rather than chosen: resolving a Shift range means naming every row between
 * two of them, and the rows between are exactly the ones a drawn slice does not have.
 *
 * With `multiple` off every intent is `replace`, so a host that never asked for multi-select cannot
 * be handed a `toggle` by a reader holding a modifier down.
 */
function intend(
  host: HTMLElement,
  scope: TreeState,
  value: string,
  mode: SelectMode,
  from: string,
): void {
  const kind: SelectMode = scope.multiple === true ? mode : "replace";
  const held = String(scope.anchor ?? "");
  const anchor = kind === "range" ? (held === "" ? from || value : held) : value;
  scope.anchor = anchor;
  announce(host, "select", { anchor, mode: kind, value } satisfies TreeSelectDetail);
}

/** Which selection a modifier state means. */
function modeOf(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): SelectMode {
  if (event.shiftKey) {
    return "range";
  }
  return event.ctrlKey || event.metaKey ? "toggle" : "replace";
}

/** A single printable character, for typeahead; `null` for anything else. */
function typeaheadChar(event: KeyboardEvent): string | null {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
    ? event.key.toLowerCase()
    : null;
}

/** The next row after `active` whose label starts with `char`, wrapping; -1 when none does. */
function typeaheadHit(items: ItemElement[], active: number, char: string): number {
  const labels = items.map((item) => labelOf(item).trim().toLowerCase());
  for (let step = 1; step <= labels.length; step++) {
    const at = (active + step) % labels.length;
    if (labels[at]!.startsWith(char)) {
      return at;
    }
  }
  return -1;
}

/** The parent of the row at `active`: the nearest drawn row above it at a shallower level. */
function parentIndex(items: ItemElement[], active: number): number {
  const level = levelOf(items[active]!);
  for (let at = active - 1; at >= 0; at--) {
    if (levelOf(items[at]!) < level) {
      return at;
    }
  }
  return -1;
}

/** Everything one claimed key may ask for, so the switch below states intent and nothing else. */
interface Step {
  /** Where the caret should land, as an index into the drawn rows. */
  to: number;
  /** The key to report when `to` is outside the drawn slice. */
  key: string;
  /** Whether landing there is also a selection. */
  select: boolean;
}

/**
 * The ARIA tree keyboard contract, on the tree whose row holds the caret.
 *
 * The arrows walk the drawn rows and do NOT wrap, which is the APG's rule for a tree and a
 * deliberate difference from the kit's menu and tablist: in a list of actions wrapping is a
 * convenience, and in a document outline it is a reader losing their place. Home and End go to the
 * ends. `ArrowRight` opens a collapsed row and steps into an open one; `ArrowLeft` closes an open
 * row and steps out of a closed one. Enter activates. Space is a selection verb and never an
 * activation, so a multi-select tree has one key that adds a row without opening it. A printable
 * character is typeahead — over the drawn rows when the slice IS the model, and dispatched as
 * `typeahead` for the host to resolve when a pad says it is not (see {@link seek}).
 *
 * **Selection follows the caret unless a modifier says otherwise.** Shift extends from the anchor,
 * `Ctrl`/`Cmd` moves the caret alone, and a plain move replaces — the three the APG names for a
 * multi-select tree, and the first is the only one a single-select tree ever sees.
 *
 * Every other key returns before anything is prevented or stopped, which is what keeps the host's
 * chords — cut, paste, delete, rename, select-all — reachable from a focused row.
 *
 * @param {TreeState} scope
 * @param {KeyboardEvent} event
 */
export function onTreeKeydown(scope: TreeState, event: KeyboardEvent): void {
  const host = hostOf(event);
  if (!host || !ownsNode(host, event.target)) {
    return;
  }
  const items = itemsOf(host);
  if (items.length === 0) {
    return;
  }
  const active = activeIndex(items, event.target);
  const from = String(scope.current ?? "");
  const accel = event.ctrlKey || event.metaKey;
  const item = items[active];
  let step: Step | null = null;

  switch (event.key) {
    case "ArrowDown": {
      step = { key: event.key, select: !accel, to: active === -1 ? 0 : active + 1 };
      break;
    }
    case "ArrowUp": {
      step = { key: event.key, select: !accel, to: active === -1 ? items.length - 1 : active - 1 };
      break;
    }
    case "Home":
    case "End": {
      /* The ends of the MODEL, not the ends of the slice. A drawn row exists at both indices
         whenever the tree has any rows at all, so unlike an arrow this cannot discover that it has
         run out — the pad has to be consulted first, or End in a windowed tree lands on the last row
         the viewport happens to show and calls it the bottom. */
      const outward = event.key === "Home" ? hasAbove(scope) : hasBelow(scope);
      if (outward) {
        event.preventDefault();
        event.stopPropagation();
        beyond(host, scope, event.key);
        return;
      }
      step = { key: event.key, select: true, to: event.key === "Home" ? 0 : items.length - 1 };
      break;
    }
    case "ArrowRight": {
      if (!item) {
        return;
      }
      const expansion = expansionOf(item);
      if (expansion === "") {
        return;
      }
      if (expansion === "false") {
        event.preventDefault();
        event.stopPropagation();
        announce(host, "expand", {
          expanded: true,
          value: valueOf(item),
        } satisfies TreeExpandDetail);
        return;
      }
      // Open: the first child is the next drawn row, and only when it is genuinely deeper.
      const next = items[active + 1];
      if (next && levelOf(next) <= levelOf(item)) {
        return;
      }
      step = { key: event.key, select: true, to: active + 1 };
      break;
    }
    case "ArrowLeft": {
      if (!item) {
        return;
      }
      if (expansionOf(item) === "true") {
        event.preventDefault();
        event.stopPropagation();
        announce(host, "expand", {
          expanded: false,
          value: valueOf(item),
        } satisfies TreeExpandDetail);
        return;
      }
      const parent = parentIndex(items, active);
      // A top-level row has no parent to step out to, and neither does one whose parent is above
      // The drawn slice — but those two are not the same, and only the second is answerable.
      if (parent === -1 && levelOf(item) === 1) {
        return;
      }
      step = { key: event.key, select: true, to: parent };
      break;
    }
    case "Enter": {
      if (!item) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      announce(host, "activate", valueOf(item));
      return;
    }
    case " ": {
      if (!item) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      intend(host, scope, valueOf(item), scope.multiple === true ? "toggle" : "replace", from);
      return;
    }
    default: {
      const char = typeaheadChar(event);
      if (char === null) {
        return;
      }
      if (windowed(scope)) {
        event.preventDefault();
        event.stopPropagation();
        seek(host, scope, char);
        return;
      }
      const hit = typeaheadHit(items, active, char);
      if (hit === -1) {
        return;
      }
      step = { key: event.key, select: true, to: hit };
    }
  }

  event.preventDefault();
  event.stopPropagation();
  const landing = items[step.to];
  if (!landing) {
    // Off the drawn slice. A pad on that side means the model has more; nothing there means the
    // Slice ends where the model does, and a tree clamps rather than wrapping.
    if (step.to < 0 ? hasAbove(scope) : hasBelow(scope)) {
      beyond(host, scope, step.key);
    }
    return;
  }
  moveTo(host, scope, landing);
  if (step.select) {
    intend(host, scope, valueOf(landing), modeOf(event), from);
  }
}

/**
 * A pointer landed on a row: the caret follows it, and the modifiers say what it meant.
 *
 * Delegated on the TREE rather than dispatched by each row, which is the one place the kit departs
 * from its own child-dispatches-`select` idiom (`jx-tab`, `jx-menu-item`, `jx-swatch`). The reason
 * is the modifiers: a selection intent is `Shift` or `Ctrl`/`Cmd` plus a row, and a row that
 * dispatched its own custom event would have to copy three booleans out of the mouse event into a
 * detail for the tree to read them back. One listener that reads the real `MouseEvent` is one
 * answer for the pointer and the keyboard both, and it is why a row needs no click handler at all
 * beyond the two that STOP one.
 *
 * @param {TreeState} scope
 * @param {MouseEvent} event
 */
export function onTreeClick(scope: TreeState, event: MouseEvent): void {
  const host = hostOf(event);
  if (!host || !(event.target instanceof Element)) {
    return;
  }
  const item = event.target.closest<ItemElement>(ITEM);
  if (!item || item.closest(TREE) !== host || isDisabled(item)) {
    return;
  }
  const from = String(scope.current ?? "");
  moveTo(host, scope, item);
  intend(host, scope, valueOf(item), modeOf(event), from);
}

/**
 * A double click means "do the thing this row is for", exactly as Enter does.
 *
 * One name for both, because a pointer-only reader and a keyboard-only reader must be able to reach
 * the same verb, and a tree whose only activation was Enter would be an SC 2.1.1 failure read
 * backwards.
 *
 * @param {TreeState} _scope
 * @param {MouseEvent} event
 */
export function onTreeDblClick(_scope: TreeState, event: MouseEvent): void {
  const host = hostOf(event);
  if (!host || !(event.target instanceof Element)) {
    return;
  }
  const item = event.target.closest<ItemElement>(ITEM);
  if (!item || item.closest(TREE) !== host || isDisabled(item)) {
    return;
  }
  announce(host, "activate", valueOf(item));
}

/**
 * A row's twisty was pressed: turn its internal `toggle` into the tree's own `expand`.
 *
 * The row says only which row it was; the tree says what should HAPPEN to it, and it says it from
 * itself, so `expand` has one dispatcher and `e.target` is the element the host wrote — whether the
 * reader used the twisty or `ArrowLeft`.
 *
 * @param {TreeState} _scope
 * @param {Event} event
 */
export function onTreeToggle(_scope: TreeState, event: Event): void {
  const host = hostOf(event);
  if (!host || !ownsNode(host, event.target) || !(event.target instanceof Element)) {
    return;
  }
  event.stopPropagation();
  const item = event.target.closest<ItemElement>(ITEM);
  if (!item || isDisabled(item)) {
    return;
  }
  announce(host, "expand", {
    expanded: expansionOf(item) !== "true",
    value: valueOf(item),
  } satisfies TreeExpandDetail);
}
