/**
 * `jx-swatch-group`'s behaviour sidecar: one tab stop, the radio group's arrow keys, and the single
 * writer of every child swatch's chosen state.
 *
 * A `<jx-swatch-group>` IS the `role="radiogroup"` and its `<jx-swatch>` children are its radios,
 * so every part of the APG's radio-group pattern that a native `<input type="radio">` set would
 * supply is this module's: the roving caret with exactly one `tabindex="0"`, wrap at both ends,
 * Home and End, disabled members skipped, and selection following focus. What it does beyond
 * reading state is the allowed set (specs/ui.md §2): move focus, and write a child's own declared
 * props through the accessors that child installs.
 *
 * SELECTION FOLLOWS FOCUS, AND IT DOES SO BY CLICKING. An arrow key moves the caret and then CLICKS
 * the swatch it landed on, exactly as `behaviors/action-group.ts` does, rather than writing
 * `checked` on it: a swatch dispatches `select` from inside its own click handler, so a group that
 * wrote the child's state directly would move the selection with nothing announcing it and the host
 * would never hear the key at all. One path for a pointer and a key is one behaviour to be wrong
 * about.
 *
 * {@link syncSwatches} is the single writer of each child's `checked` and `tabindex`, and it is
 * reached three ways that are all the same call: from `onSwatchGroupMount`, because `defineElement`
 * runs `applyAttributes` BEFORE `distributeSlots` and no swatch exists when the root's bindings
 * first evaluate; from the `sync` computed the host reads through `data-selection`, which is what
 * makes a HOST write of `.value` re-sync with no method call; and from the observer the mount
 * installs, because the swatch SET moves too — a palette filtered by a search box is the ordinary
 * case, and a group whose caret-holder was filtered away has no `tabindex="0"` left at all.
 *
 * @docs extending/ui-kit
 */

/** The tag of the group. */
const GROUP = "jx-swatch-group";
/** The tag of one swatch. */
const SWATCH = "jx-swatch";

/** The reactive scope a `jx-swatch-group` document hands its handlers. */
export interface SwatchGroupState {
  /** The value of the chosen swatch; the empty string when none is. */
  value?: string;
  /** The group's accessible name. */
  label?: string;
  [key: string]: unknown;
}

/** A swatch element with the property accessors its own document installs. */
type SwatchElement = HTMLElement & {
  value?: string;
  color?: string;
  checked?: string;
  disabled?: boolean;
  tabindex?: string;
};

/** A group element with the accessors its own document installs. */
type GroupElement = HTMLElement & { value?: string };

/**
 * The element each scope belongs to, learned once at mount.
 *
 * A WeakMap rather than a key on the scope: the scope is a deep reactive proxy, and an element
 * stored in one is an element every effect that reads it subscribes to.
 */
const hosts = new WeakMap<object, HTMLElement>();

/** The groups already watching their own swatch set, so a second mount never observes twice. */
const watched = new WeakMap<HTMLElement, MutationObserver>();

/** The group an event's `currentTarget` is. */
function hostOf(event: Event): GroupElement | null {
  const target = event.currentTarget;
  return target instanceof HTMLElement && target.localName === GROUP
    ? (target as GroupElement)
    : null;
}

/** Whether `group` is the nearest group around `node` — a key inside a nested group is its own. */
function ownsNode(group: HTMLElement, node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(GROUP) === group;
}

/**
 * The swatches of one group, in order, excluding those of any group nested inside it.
 *
 * @param group The `jx-swatch-group` element.
 * @returns Its own swatches, in document order.
 */
export function swatchesOf(group: HTMLElement): SwatchElement[] {
  return [...group.querySelectorAll<SwatchElement>(SWATCH)].filter(
    (swatch) => swatch.closest(GROUP) === group,
  );
}

/** What a swatch stands for: its own `value`, falling back to the colour it draws. */
function valueOf(swatch: SwatchElement): string {
  return String(swatch.value || swatch.color || "");
}

/**
 * Whether a swatch cannot be chosen.
 *
 * Read from the PROPERTY once the child has upgraded and from the attribute before it has, because
 * the caret is placed from a lifecycle event and a slotted child's own `connectedCallback` is
 * async: the group can legitimately be asked to rove either side of that moment.
 */
function isDisabled(swatch: SwatchElement): boolean {
  return swatch.disabled === undefined ? swatch.hasAttribute("disabled") : swatch.disabled === true;
}

/** Put the caret ON a swatch: the focusable node is the button inside it, never the host. */
function focusControl(swatch: SwatchElement): void {
  const control = swatch.querySelector<HTMLElement>('[part="control"]');
  (control ?? swatch).focus();
}

/**
 * Focus the enabled swatch at `index`, wrapping at both ends.
 *
 * It moves FOCUS and nothing else. The roving `tabindex` is {@link syncSwatches}'s alone, and the
 * two stay together because focusing is followed by a click: the click moves the group's `value`,
 * the `sync` computed reads that, and the caret lands on the swatch that took focus in the same
 * synchronous turn. Writing the caret here as well would be a second writer of one fact — the shape
 * the module header rules out — and it would be a writer no test could ever catch failing, because
 * the first one always overwrites it a moment later.
 *
 * @param group The group whose focus is moving.
 * @param index An index into the group's ENABLED swatches; negative counts from the end.
 * @returns The swatch that took focus, or null when the group has none that can.
 */
export function focusSwatch(group: HTMLElement, index: number): SwatchElement | null {
  const enabled = swatchesOf(group).filter((swatch) => !isDisabled(swatch));
  if (enabled.length === 0) {
    return null;
  }
  const at = ((index % enabled.length) + enabled.length) % enabled.length;
  const caret = enabled[at]!;
  focusControl(caret);
  return caret;
}

/**
 * Write the group's selection onto its swatches: one `checked="true"`, and exactly one
 * `tabindex="0"` so Tab enters and leaves the whole group in one step.
 *
 * Idempotent by construction — everything it writes is derived from the host's own `value`, and an
 * equal write into a reactive proxy triggers nothing. That matters because it runs inside a render
 * effect. The caret goes to the chosen swatch, or to the first that can be chosen when the value
 * names none, which is what the APG asks of a radio group with no selection.
 *
 * @param group The `jx-swatch-group` element.
 */
export function syncSwatches(group: HTMLElement): void {
  const swatches = swatchesOf(group);
  if (swatches.length === 0) {
    return;
  }
  const value = String((group as GroupElement).value ?? "");
  const enabled = swatches.filter((swatch) => !isDisabled(swatch));
  const chosen = enabled.find((swatch) => valueOf(swatch) === value);
  const caret = chosen ?? enabled[0] ?? null;
  for (const swatch of swatches) {
    swatch.checked = valueOf(swatch) === value ? "true" : "false";
    swatch.tabindex = swatch === caret ? "0" : "-1";
  }
}

/** Keep the one-tab-stop invariant as the group's swatches come and go. */
function watchSwatches(group: HTMLElement): void {
  if (watched.has(group)) {
    return;
  }
  /* `syncSwatches` writes only attributes and properties, never children, so nothing it does can
     feed this observer back into itself. */
  const observer = new MutationObserver(() => {
    syncSwatches(group);
  });
  observer.observe(group, { childList: true, subtree: true });
  watched.set(group, observer);
}

/**
 * The `sync` computed's body: read the selection, and put it on the swatches.
 *
 * The HOST reads it as `data-selection`, so it is an effect of `value` and re-runs whenever
 * anything writes that — a click, a key, or a host assigning `el.value` from the outside. It takes
 * the SCOPE rather than the value, because the runtime hands a `$src` function only its declared
 * positional arguments and the element is reachable only through the scope it was learned against.
 *
 * @param scope The `jx-swatch-group` reactive scope.
 * @returns The current value, for the attribute that reads it.
 */
export function applySwatchSelection(scope: SwatchGroupState): string {
  const value = String(scope.value ?? "");
  const host = hosts.get(scope);
  if (host) {
    syncSwatches(host);
  }
  return value;
}

/**
 * Learn the element, sync once the swatches exist, and keep watching them.
 *
 * Reached through the `jx-ready` the root dispatches from `onMount`, which is the kit's way of
 * giving an element its first sight of itself: a mount handler is called with the scope alone, and
 * an event handler's `currentTarget` is the host.
 *
 * @param scope The group's reactive scope.
 * @param event The element's own `jx-ready`.
 */
export function onSwatchGroupMount(scope: SwatchGroupState, event: Event): void {
  const host = hostOf(event);
  if (!host) {
    return;
  }
  hosts.set(scope, host);
  syncSwatches(host);
  watchSwatches(host);
}

/**
 * A swatch was activated: record it, then say so.
 *
 * `value` is written BEFORE `change` is dispatched, so a listener reading `e.target.value` sees the
 * new one. The `select` a swatch dispatches is the group's internal protocol and stops here;
 * `change` is the whole public event surface and it means THE SELECTION MOVED, so re-choosing the
 * swatch that is already chosen dispatches nothing.
 *
 * @param scope The group's reactive scope.
 * @param event The swatch's `select`.
 */
export function onSwatchGroupSelect(scope: SwatchGroupState, event: Event): void {
  const host = hostOf(event);
  if (!host || !ownsNode(host, event.target)) {
    return;
  }
  event.stopPropagation();
  const value = String((event as CustomEvent<unknown>).detail ?? "");
  if (value === String(scope.value ?? "")) {
    return;
  }
  scope.value = value;
  host.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: value }));
}

/**
 * The radio group's keyboard contract: either arrow pair moves the caret between enabled swatches
 * with wrap, Home and End go to the ends, and the swatch the caret lands on is chosen.
 *
 * Both pairs move, because a palette wraps into rows and a reader pressing Down on a grid means
 * "the next one". Space and Enter are the platform's, on each swatch's own `<button>`.
 *
 * The scope is not read: the caret is a fact about the DOM rather than about the group's value, and
 * choosing what it lands on is a click, which comes back through `select` like any other.
 *
 * @param _scope The group's reactive scope, unread.
 * @param event The keydown.
 */
export function onSwatchGroupKeydown(_scope: SwatchGroupState, event: KeyboardEvent): void {
  const host = hostOf(event);
  if (!host || !ownsNode(host, event.target)) {
    return;
  }
  const enabled = swatchesOf(host).filter((swatch) => !isDisabled(swatch));
  if (enabled.length === 0) {
    return;
  }
  const active = enabled.findIndex(
    (swatch) =>
      swatch === event.target || (event.target instanceof Node && swatch.contains(event.target)),
  );
  let moved: number;
  switch (event.key) {
    case "ArrowDown":
    case "ArrowRight": {
      moved = active + 1;
      break;
    }
    case "ArrowLeft":
    case "ArrowUp": {
      moved = active === -1 ? -1 : active - 1;
      break;
    }
    case "Home": {
      moved = 0;
      break;
    }
    case "End": {
      moved = -1;
      break;
    }
    default: {
      return;
    }
  }
  event.preventDefault();
  event.stopPropagation();
  focusSwatch(host, moved)?.click();
}
