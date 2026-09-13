/**
 * `jx-listbox`'s sidecar: the two things a document body cannot say about a list whose keyboard
 * belongs to somebody else.
 *
 * **The listbox is the single writer of every row's `selected`**, exactly as `jx-tabs` is of every
 * tab's, and for the same reason: the flag has to be moved on a foreign element and specs/ui.md §2
 * principle 5 forbids a sidecar writing an ATTRIBUTE on one. So the element observes a PROPERTY,
 * this module writes the property, and the option's own document is what turns it into
 * `aria-selected`. A consumer therefore moves the highlight by writing ONE string — the listbox's
 * `active`, which is the id its owning field already points `aria-activedescendant` at — instead of
 * re-deciding the question once per row.
 *
 * That is the whole of the duplication being closed. Studio's three palettes each carried
 * `aria-selected="${$map.index === state.activeIndex ? 'true' : 'false'}"` and a `data-selected`
 * beside it, in three files, with nothing keeping the three in agreement; the id reference is one
 * answer that reaches both the field and the row, which is what a light DOM is for (§2 principle
 * 2).
 *
 * **The active row is scrolled back into view**, which is the half no consumer could do at all: it
 * is measurement and a method call on another element, both of which belong here. `block:
 * "nearest"` is deliberate — it does nothing when the row is already visible, so a pointer moving
 * over a list never scrolls it under the pointer.
 *
 * What this module does NOT do is take focus, and that is the element's whole contract rather than
 * an omission. A `jx-listbox` has no `tabindex` and never calls `focus()`: one of its two owners is
 * a field that must keep the caret (a palette), and the other is NOTHING AT ALL — Studio's slash
 * menu filters for a caret sitting in the canvas, often in another realm, and every character typed
 * after the `/` has to keep landing there. A menu owns DOM focus by contract, which is exactly why
 * that surface is a listbox and not a menu.
 *
 * @docs extending/ui-kit
 */

/** A row element with the property accessors its own document installs. */
type OptionElement = HTMLElement & { selected?: boolean; disabled?: boolean; value?: string };

/** The reactive scope a `jx-listbox` document hands its handlers. */
export interface ListboxState {
  /** The id of the row the caret is on; the empty string when none is. */
  active?: string;
  [key: string]: unknown;
}

const ROW = "jx-option";
const LIST = "jx-listbox";

/**
 * The rows of one listbox, in document order, excluding the rows of any listbox nested inside it.
 *
 * Rows sit inside the panel's emulated `<slot>` and inside whatever `role="group"` wrappers a
 * consumer added for its headings, so this walks descendants and keeps the ones whose nearest
 * listbox is this one — the same shape `rowsOf` has in the menu behaviour.
 *
 * @param host The `jx-listbox` element.
 * @returns Its own rows.
 */
export function optionsOf(host: HTMLElement): OptionElement[] {
  return [...host.querySelectorAll<OptionElement>(ROW)].filter((row) => row.closest(LIST) === host);
}

/**
 * Bring every row's `selected` into agreement with the active id, and scroll the newly active one
 * back into view.
 *
 * @param host The `jx-listbox` element.
 * @param active The id of the row the caret is on; `""` for none.
 * @returns The row that is now active, or null when nothing is.
 */
export function syncListbox(host: HTMLElement, active: string): OptionElement | null {
  let landed: OptionElement | null = null;
  let moved = false;
  for (const row of optionsOf(host)) {
    const wanted = active !== "" && row.id === active;
    if (wanted) {
      landed = row;
      /* Only a row that was NOT already selected is scrolled to. A rows-changed mutation that
         leaves the same row active must not yank the list under a reader's pointer. */
      moved = row.selected !== true;
    }
    if (row.selected !== wanted) {
      row.selected = wanted;
    }
  }
  if (landed && moved && typeof landed.scrollIntoView === "function") {
    landed.scrollIntoView({ block: "nearest" });
  }
  return landed;
}

/**
 * Keep the rows in step with `active` for as long as the element lives.
 *
 * Two things move underneath this and neither produces the other's mutation record, so both are
 * watched. The ROWS change when a filter re-runs, which is a `childList` record — and the row
 * carrying the active id is then a different element, so its `selected` has to be re-asserted or
 * the highlight simply disappears. The ACTIVE ID changes when a key moves the caret, which mutates
 * no row at all; the document is what makes that write audible, by binding `data-active` to the
 * same state, exactly as `jx-select`'s sidecar reads a host write of `value` through `data-value`.
 *
 * There is deliberately no `onUnmount`, for the reason `select.ts` sets out at length: the runtime
 * initialises an element once, so a sidecar that disconnected on removal could never install
 * another, and an ordinary re-parent would leave the element rendering, reactive and deaf.
 *
 * @param state The element's reactive scope.
 * @param host The `jx-listbox` element.
 */
export function mountListbox(state: ListboxState, host: HTMLElement): void {
  syncListbox(host, String(state.active ?? ""));
  const observer = new MutationObserver(() => {
    syncListbox(host, String(state.active ?? ""));
  });
  observer.observe(host, {
    attributeFilter: ["data-active"],
    attributes: true,
    childList: true,
    subtree: true,
  });
}
