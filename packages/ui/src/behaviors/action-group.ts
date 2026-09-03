/**
 * `jx-action-group`'s behaviour sidecar: the roving caret, and nothing else.
 *
 * The group owns focus movement because that is local state no store should hold, and because a
 * button cannot write about its own position among its siblings. It does NOT own selection: every
 * real call site keeps the selected value in the host, so in `selects="single"` an arrow does not
 * write `checked` on a child — it CLICKS the child, exactly as `behaviors/menu.ts` does for Enter,
 * and the host's own click handler then decides. That leaves one path for pointer and keyboard
 * instead of two that can disagree.
 *
 * What it does beyond reading state is the allowed set (specs/ui.md §2): move focus, and write a
 * child's own declared `tabindex` prop. It measures nothing, listens on no document, and calls no
 * platform overlay API. The `tabindex` prop exists precisely so this module never has to reach into
 * a child's internals to place the caret. The one observer it does own watches the group's OWN
 * subtree, for the reason `watchRoving` gives.
 *
 * @docs extending/ui-kit
 */

const GROUP = "jx-action-group";
const ITEM = "jx-action-button";

/** The reactive scope a `jx-action-group` document hands its handlers. */
export interface ActionGroupState {
  selects?: string;
  orientation?: string;
  [key: string]: unknown;
}

/** A child action button, with the property accessors its own document installs. */
type ItemElement = HTMLElement & {
  tabindex?: string;
  disabled?: boolean;
  selected?: boolean;
  checked?: string;
};

/** The group an event's `currentTarget` is. */
function groupOf(event: Event): HTMLElement | null {
  const target = event.currentTarget;
  return target instanceof HTMLElement && target.localName === GROUP ? target : null;
}

/** Whether `group` is the nearest group around `node` — a key inside a nested group is its own. */
function ownsNode(group: HTMLElement, node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(GROUP) === group;
}

/**
 * The action buttons of one group, in order, excluding those of any group nested inside it.
 *
 * Children sit inside the emulated `<slot>` and may sit inside wrappers a surface adds, so this
 * walks descendants and keeps the ones whose nearest group is this one. THE SEAM IS NARROWER: the
 * segmented rules in `jx-action-group.json` reach the slot's own children only, so a button a
 * surface has wrapped is roved but not joined, and a nested group's buttons are neither.
 *
 * @param group The `jx-action-group` element.
 * @returns Its own action buttons, in document order.
 */
export function itemsOf(group: HTMLElement): ItemElement[] {
  return [...group.querySelectorAll<ItemElement>(ITEM)].filter(
    (item) => item.closest(GROUP) === group,
  );
}

/**
 * Whether a child cannot act.
 *
 * Read from the PROPERTY once the child has upgraded and from the attribute before it has, because
 * the caret is placed from a lifecycle event and a slotted child's own `connectedCallback` is
 * async: the group can legitimately be asked to rove either side of that moment. The property is
 * consulted first where it exists, since a host that wrote `el.disabled = false` over an authored
 * `disabled` attribute means the property.
 */
function isDisabled(item: ItemElement): boolean {
  return item.disabled === undefined ? item.hasAttribute("disabled") : item.disabled === true;
}

/** Whether a child is the one the host currently considers chosen — either spelling, as above. */
function isChosen(item: ItemElement): boolean {
  if (item.selected === undefined && item.checked === undefined) {
    return item.hasAttribute("selected") || item.getAttribute("checked") === "true";
  }
  return item.selected === true || item.checked === "true";
}

/** Put the caret ON a child: the focusable node is the button inside it, never the host. */
function focusControl(item: ItemElement): void {
  const control = item.querySelector<HTMLElement>('[part="control"]');
  (control ?? item).focus();
}

/** Write the roving tabindex: `0` on `caret`, `-1` on every other child, disabled ones included. */
function writeRoving(items: ItemElement[], caret: ItemElement | null): void {
  for (const item of items) {
    item.tabindex = item === caret ? "0" : "-1";
  }
}

/**
 * The child that should hold the caret: the one that already holds it and still can, else the
 * chosen one, else the first that can act — and null when nothing in the group can.
 */
function caretFor(items: ItemElement[]): ItemElement | null {
  const enabled = items.filter((item) => !isDisabled(item));
  const held = enabled.find((item) => item.tabindex === "0");
  return held ?? enabled.find((item) => isChosen(item)) ?? enabled[0] ?? null;
}

/**
 * Move the caret to the enabled child at `index`, wrapping at both ends, and focus it.
 *
 * @param group The group whose caret is moving.
 * @param index An index into the group's ENABLED children; negative counts from the end.
 * @returns The child that took the caret, or null when the group has none that can.
 */
export function focusItem(group: HTMLElement, index: number): ItemElement | null {
  const items = itemsOf(group);
  const enabled = items.filter((item) => !isDisabled(item));
  if (enabled.length === 0) {
    return null;
  }
  const at = ((index % enabled.length) + enabled.length) % enabled.length;
  const caret = enabled[at]!;
  writeRoving(items, caret);
  focusControl(caret);
  return caret;
}

/**
 * Give the group exactly one tab stop.
 *
 * Without this every child is its own tab stop, because a native `<button>` is focusable with no
 * `tabindex` at all — so the collapse to one is a WRITE, not the absence of one, and it has to
 * happen before the reader's first Tab rather than on their first arrow key. The caret stays where
 * it already is when that child can still take it, else it goes to the chosen child, else to the
 * first that can act.
 *
 * Idempotent, which is what lets it be called from a lifecycle event that may arrive more than
 * once, and from the observer below on every change to the group.
 *
 * @param group The `jx-action-group` element.
 */
export function syncRoving(group: HTMLElement): void {
  const items = itemsOf(group);
  writeRoving(items, caretFor(items));
}

/** Whether the group's children already say what {@link syncRoving} would write. */
function isSettled(group: HTMLElement): boolean {
  const items = itemsOf(group);
  const caret = caretFor(items);
  return items.every((item) => item.tabindex === (item === caret ? "0" : "-1"));
}

/** Groups already being watched, so a second `jx-ready` does not observe them twice. */
const watched = new WeakSet<HTMLElement>();

/**
 * Keep the one-tab-stop invariant as the group's children change.
 *
 * Placing the caret once at mount is not enough, and the failure is not cosmetic: a child appended
 * afterwards arrives with no `tabindex` at all, which is a SECOND tab stop in an element whose
 * whole purpose is to have one; removing or disabling the child that holds the caret leaves ZERO,
 * so a toolbar of enabled, operable buttons cannot be reached by Tab at all. Both are the ordinary
 * life of a Studio toolbar, whose buttons enable and disable with the selection and whose rows are
 * built from `$switch` and mapped arrays.
 *
 * The observer is on the group's own subtree only. It cannot see a `disabled` written as a PROPERTY
 * rather than an attribute — a mutation record is an attribute record — so a host that flips
 * `el.disabled = true` on the caret-holder is still asked to let the group hear about it, which an
 * arrow key, a click or a re-render all do.
 *
 * @param group The `jx-action-group` element.
 */
function watchRoving(group: HTMLElement): void {
  if (watched.has(group)) {
    return;
  }
  watched.add(group);
  /* `isSettled` first, so the observer writes only when the invariant is actually broken: a
     re-write would be a mutation of its own, and a callback that always writes is a loop. */
  const observer = new MutationObserver(() => {
    if (!isSettled(group)) {
      syncRoving(group);
    }
  });
  observer.observe(group, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled"],
  });
}

/**
 * The group's keyboard contract: the arrow along its own axis moves the caret with wrap, Home and
 * End go to the ends, and in `selects="single"` the child that takes the caret is CLICKED so the
 * host hears the same event it would hear from a pointer.
 *
 * Enter, Space, the focus ring and `:disabled` are the platform's, on each child's own `<button>`.
 *
 * @param {ActionGroupState} state
 * @param {KeyboardEvent} event
 */
export function onGroupKeydown(state: ActionGroupState, event: KeyboardEvent): void {
  const group = groupOf(event);
  if (!group || !ownsNode(group, event.target)) {
    return;
  }
  const vertical = state.orientation === "vertical";
  const enabled = itemsOf(group).filter((item) => !isDisabled(item));
  const active = enabled.findIndex(
    (item) =>
      item === event.target || (event.target instanceof Node && item.contains(event.target)),
  );
  let caret: ItemElement | null = null;
  if (event.key === (vertical ? "ArrowDown" : "ArrowRight")) {
    caret = focusItem(group, active + 1);
  } else if (event.key === (vertical ? "ArrowUp" : "ArrowLeft")) {
    caret = focusItem(group, active === -1 ? -1 : active - 1);
  } else if (event.key === "Home") {
    caret = focusItem(group, 0);
  } else if (event.key === "End") {
    caret = focusItem(group, -1);
  } else {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  /* Arrow-to-select, and the reason it is a click rather than a write: `jx-action-button` emits
     `change` only from inside its own click handler, so a group that wrote `checked` on a child
     would move the selection with nothing announcing it — the host would never hear the key at
     all. Clicking is the one path both a pointer and an arrow take. */
  if (caret && state.selects === "single") {
    caret.click();
  }
}

/**
 * Collapse the group to one tab stop once it has rendered, and keep it collapsed to one.
 *
 * `onMount` is handed the reactive scope and nothing else, so the element announces itself with
 * `jx-ready` — the kit's existing readiness event — and this reads the host off that event.
 *
 * @param {ActionGroupState} _state
 * @param {Event} event
 */
export function onGroupReady(_state: ActionGroupState, event: Event): void {
  const group = groupOf(event);
  if (group) {
    syncRoving(group);
    watchRoving(group);
  }
}
