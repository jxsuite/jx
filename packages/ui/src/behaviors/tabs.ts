/**
 * The tabs behaviour: what a `jx-tabs` needs that the platform gives a role-carrying custom element
 * for free, which is nothing.
 *
 * A `<jx-tabs>` is the `role="tablist"` itself and its `<jx-tab>` children are the owned tabs, so
 * every part of the APG's tab pattern that a native control would supply — the roving caret, wrap
 * at both ends, Home and End, automatic versus manual activation, Delete on a closable tab — is
 * this module's. What it does beyond reading state is exactly the allowed set (specs/ui.md §2):
 * move focus, and write a child element's own declared props through the accessors that child
 * installs. It measures nothing, listens on no document, and never reaches for a foreign
 * attribute.
 *
 * `syncTabs` is the single writer of each child's `selected` and `tabIndex`. It is reached three
 * ways and they are all the same call: once from `onTabsMount`, because `defineElement` runs
 * `applyAttributes` BEFORE `distributeSlots` and no tab exists when the root's bindings first
 * evaluate; again from the `sync` computed the HOST reads through `data-selection`, which is what
 * makes a HOST write of `.selected` re-sync with no method call; and again from the observer
 * `onTabsMount` installs, because the tab SET moves too. Closing a tab is the whole reason
 * `closable` exists, and a strip that does not answer it is left with no `tabindex="0"` at all —
 * unreachable by Tab, with nothing for a host to press to repair it.
 *
 * @docs extending/ui-kit
 */

/** The tag of the tablist. */
const TABS = "jx-tabs";
/** The tag of one tab. */
const TAB = "jx-tab";

/** The reactive scope a `jx-tabs` document hands its handlers. */
export interface TabsState {
  selected?: string;
  label?: string;
  activation?: string;
  orientation?: string;
  [key: string]: unknown;
}

/** A tab element with the property accessors its document installs. */
type TabElement = HTMLElement & { value?: string; selected?: boolean };
/** A tablist element with the property accessors its document installs. */
type TabsElement = HTMLElement & { selected?: string };

/**
 * The element each scope belongs to, learned once at mount.
 *
 * A WeakMap rather than a key on the scope: the scope is a deep reactive proxy, and an element
 * stored in one is an element every effect that reads it subscribes to. The map is keyed by the
 * scope object the runtime hands every handler and every template, which is one identity per
 * instance and is released with it.
 */
const hosts = new WeakMap<object, HTMLElement>();

/**
 * The strips already watching their own tab set, so a second mount never observes twice.
 *
 * Keyed by the element and holding the observer: an observer is kept alive by the node it watches,
 * so this map only decides whether one already exists, and both die with the strip.
 */
const watched = new WeakMap<HTMLElement, MutationObserver>();

/**
 * Watch the tab set, because the selection is not the only thing that moves.
 *
 * The `sync` computed re-runs when `selected` CHANGES VALUE and at no other time, so a strip whose
 * tabs are added or removed underneath it — a closed document, a filtered dock, an array binding
 * that grew — keeps writing a caret onto tabs that are gone. Removing the current tab is the bad
 * case: no tab holds `tabindex="0"` afterwards and the host is `tabindex="-1"`, so the whole strip
 * drops out of the tab order.
 *
 * `syncTabs` writes only attributes and properties, never children, so nothing it does can feed
 * this observer back into itself.
 *
 * @param host The `jx-tabs` element.
 */
function watchTabs(host: HTMLElement): void {
  if (watched.has(host)) {
    return;
  }
  const observer = new MutationObserver(() => {
    syncTabs(host);
  });
  observer.observe(host, { childList: true, subtree: true });
  watched.set(host, observer);
}

/** The tablist an event's `currentTarget` is. */
function hostOf(event: Event): TabsElement | null {
  const target = event.currentTarget;
  return target instanceof HTMLElement && target.localName === TABS
    ? (target as TabsElement)
    : null;
}

/** Whether `host` is the nearest tablist around `node` — a nested strip owns its own keys. */
function ownsNode(host: HTMLElement, node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(TABS) === host;
}

/**
 * The tabs of one tablist, in order, excluding the tabs of any tablist nested inside it.
 *
 * The strip's own tabs are its direct children — a `<slot>` leaves no node, so a distributed tab
 * stands where the slot stood — but a surface may still wrap one, so this walks descendants and
 * keeps the ones whose nearest tablist is this one. That is also what excludes a nested strip's.
 *
 * @param host The `jx-tabs` element.
 * @returns Its own tabs, in document order.
 */
export function tabsOf(host: HTMLElement): TabElement[] {
  return [...host.querySelectorAll<TabElement>(TAB)].filter((tab) => tab.closest(TABS) === host);
}

/** A tab's value as a string; a tab with none stands for the empty selection. */
function valueOf(tab: TabElement): string {
  return String(tab.value ?? "");
}

/**
 * Move the roving caret to `index`, wrapping at both ends.
 *
 * @param tabs The strip's tabs.
 * @param index Where to put the caret; out of range wraps.
 * @returns The tab that took it, or null when there are none.
 */
export function focusTab(tabs: TabElement[], index: number): TabElement | null {
  if (tabs.length === 0) {
    return null;
  }
  const next = ((index % tabs.length) + tabs.length) % tabs.length;
  for (const [at, tab] of tabs.entries()) {
    tab.tabIndex = at === next ? 0 : -1;
  }
  const tab = tabs[next]!;
  tab.focus();
  return tab;
}

/**
 * Write the strip's selection onto its tabs: one `selected`, and exactly one `tabIndex` of 0 so Tab
 * enters and leaves the whole strip in one step.
 *
 * Idempotent by construction — it derives everything it writes from the host's own `selected` and
 * writes equal values into a reactive proxy, which triggers nothing. That matters because it runs
 * inside a render effect.
 *
 * @param host The `jx-tabs` element.
 */
export function syncTabs(host: HTMLElement): void {
  const tabs = tabsOf(host);
  if (tabs.length === 0) {
    return;
  }
  const selected = String((host as TabsElement).selected ?? "");
  const found = tabs.findIndex((tab) => valueOf(tab) === selected);
  const caret = found === -1 ? 0 : found;
  for (const [at, tab] of tabs.entries()) {
    tab.selected = valueOf(tab) === selected;
    tab.tabIndex = at === caret ? 0 : -1;
  }
}

/**
 * The `sync` computed's body: read the selection, and put it on the tabs.
 *
 * The HOST reads it as `data-selection`, so it is an effect of `selected` and re-runs whenever
 * anything writes that — a click, a key, or a host assigning `el.selected` from the outside.
 *
 * It rode the internal `<slot part="tabs">` until slot distribution stopped leaving a node: the
 * slot is now REPLACED by the tabs it matched, so the binding's element was detached the moment the
 * strip had any tabs at all. The effect went on firing at an orphan, which is a mechanism nothing
 * in the document can see and no test can read. `data-orientation` and `data-compact` on
 * `jx-action-group` are the same shape — a `data-` mirror of state the element already publishes —
 * and this one is that. Before mount the element does not yet know itself, and there are no tabs to
 * write to either; the value still comes back, so the attribute is right from the first paint.
 *
 * It takes the SCOPE rather than the selected value the plan spelled, because the runtime hands a
 * `$src` function only its declared positional arguments and the element is reachable only through
 * the scope it was learned against.
 *
 * @param scope The `jx-tabs` reactive scope.
 * @returns The current selection, for the attribute that reads it.
 */
export function applySelection(scope: TabsState): string {
  const selected = String(scope.selected ?? "");
  const host = hosts.get(scope);
  if (host) {
    syncTabs(host);
  }
  return selected;
}

/**
 * Learn the element, and sync once the tabs exist.
 *
 * Reached through the `jx-ready` the root dispatches from `onMount`, which is the kit's way of
 * giving an element its first sight of itself: a mount handler is called with the scope alone, and
 * an event handler's `currentTarget` is the host.
 *
 * @param {TabsState} scope
 * @param {Event} event
 */
export function onTabsMount(scope: TabsState, event: Event): void {
  const host = hostOf(event);
  if (!host) {
    return;
  }
  hosts.set(scope, host);
  syncTabs(host);
  watchTabs(host);
}

/**
 * A tab was activated: record it, then say so.
 *
 * `selected` is written BEFORE `change` is dispatched, so a listener reading `e.target.selected`
 * sees the new value — the two Studio call sites that already read it keep working with no handler
 * change. The `select` a tab dispatches is the strip's internal protocol and stops here; `change`
 * is the whole public event surface, and it means THE SELECTION MOVED: re-activating the tab that
 * is already current says nothing, so it dispatches nothing.
 *
 * @param {TabsState} scope
 * @param {Event} event The tab's `select`
 */
export function onTabsSelect(scope: TabsState, event: Event): void {
  const host = hostOf(event);
  if (!host || !ownsNode(host, event.target)) {
    return;
  }
  event.stopPropagation();
  const value = String((event as CustomEvent<unknown>).detail ?? "");
  if (value === String(scope.selected ?? "")) {
    return;
  }
  scope.selected = value;
  host.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: value }));
}

/**
 * The tab keyboard contract: the arrows of the strip's own orientation move the caret with wrap,
 * Home and End go to the ends, Enter and Space activate where activation is manual, and Delete
 * closes a closable tab through the same close button a pointer would press.
 *
 * With `activation="auto"` a move activates as it lands, which is what a two-item dock strip wants;
 * with `"manual"` the caret moves alone and Enter or Space commits — but only when the key was
 * pressed on the TAB. On the close button inside it, Enter and Space belong to the platform's own
 * button activation and this handler steps aside.
 *
 * @param {TabsState} scope
 * @param {KeyboardEvent} event
 */
export function onTabsKeydown(scope: TabsState, event: KeyboardEvent): void {
  const host = hostOf(event);
  if (!host || !ownsNode(host, event.target)) {
    return;
  }
  const tabs = tabsOf(host);
  if (tabs.length === 0) {
    return;
  }
  const active = tabs.findIndex(
    (tab) => tab === event.target || (event.target instanceof Node && tab.contains(event.target)),
  );
  const vertical = String(scope.orientation ?? "horizontal") === "vertical";
  const forward = vertical ? "ArrowDown" : "ArrowRight";
  const back = vertical ? "ArrowUp" : "ArrowLeft";
  let moved: number | null = null;
  switch (event.key) {
    case forward: {
      moved = active + 1;
      break;
    }
    case back: {
      moved = active === -1 ? -1 : active - 1;
      break;
    }
    case "Home": {
      moved = 0;
      break;
    }
    case "End": {
      moved = tabs.length - 1;
      break;
    }
    case "Enter":
    case " ": {
      const tab = tabs[active];
      // A key pressed on a control INSIDE the tab is the platform's to answer: the close button is
      // A real `<button>` and Enter or Space on it must close. Activating the tab here and then
      // Cancelling the default would leave a focusable control no keyboard can operate.
      if (!tab || event.target !== tab) {
        return;
      }
      tab.click();
      break;
    }
    case "Delete": {
      // The pointer's path, exactly: the close button stops the click, so activating it here
      // Cannot also select the tab.
      const close = tabs[active]?.querySelector<HTMLElement>('[part="close"]');
      if (!close) {
        return;
      }
      close.click();
      break;
    }
    default: {
      return;
    }
  }
  if (moved !== null) {
    const tab = focusTab(tabs, moved);
    if (tab && String(scope.activation ?? "auto") !== "manual") {
      tab.click();
    }
  }
  event.preventDefault();
  event.stopPropagation();
}
