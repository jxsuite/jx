/**
 * `jx-textfield`'s behaviour sidecar: focus and selection on the inner native control, the id stem
 * two fields must not share, and the clear button's own three steps. Each of them is something a
 * document body cannot express — it can neither move focus nor dispatch from an element other than
 * the one whose handler is running.
 *
 * @docs extending/ui-kit
 */

/** The element's own native control. */
function controlOf(host: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  return host.querySelector<HTMLInputElement | HTMLTextAreaElement>('[part="input"]');
}

/**
 * Focus the field and select its value: all of it, the stem before the last dot (a filename with
 * its extension left alone), or nothing.
 *
 * @param host The `jx-textfield` element.
 * @param mode What to select once focused.
 */
export function selectValue(host: HTMLElement, mode: "all" | "stem" | "none" = "all"): void {
  const control = controlOf(host);
  if (!control) {
    return;
  }
  control.focus();
  if (mode === "none") {
    return;
  }
  if (mode === "stem") {
    const dot = control.value.lastIndexOf(".");
    control.setSelectionRange(0, dot > 0 ? dot : control.value.length);
    return;
  }
  control.select();
}

/** Focus the field without touching its selection. */
export function focusField(host: HTMLElement): void {
  controlOf(host)?.focus();
}

/** The `jx-textfield` an event inside one came from. */
function hostOf(event: Event): HTMLElement | null {
  const target = event.currentTarget;
  return target instanceof Element ? target.closest<HTMLElement>("jx-textfield") : null;
}

/**
 * Empty a clearable field: write "" into its value, put focus back on the control the reader was
 * in, and say so with `input` and then `change`.
 *
 * Both events come from the ELEMENT rather than from the clear button, because every host reads
 * `e.target.value` and the button's own `value` is not the field's. The platform fires nothing for
 * a value the element wrote itself, so the pair is dispatched here.
 *
 * @param state The element's reactive scope, whose `value` this empties.
 * @param event The click on the clear button.
 */
export function clearField(state: Record<string, unknown>, event: Event): void {
  const host = hostOf(event);
  if (!host) {
    return;
  }
  state["value"] = "";
  focusField(host);
  host.dispatchEvent(new Event("input", { bubbles: true }));
  host.dispatchEvent(new Event("change", { bubbles: true }));
}

let minted = 0;

/**
 * Give the instance an id stem no other field in the document shares, so its error and help
 * sentences can carry ids the control names in `aria-describedby`.
 *
 * A document cannot mint one: the closed operator set has no counter and no identity, and two
 * fields on one surface must not collide. This is the sidecar case specs/ui.md §3.2 sanctions.
 *
 * @param state The element's reactive scope, whose `uid` this writes.
 */
export function mintFieldId(state: Record<string, unknown>): void {
  minted += 1;
  state["uid"] = `jx-tf-${minted}`;
}
