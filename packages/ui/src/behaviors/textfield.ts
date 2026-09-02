/**
 * `jx-textfield`'s behaviour sidecar: focus and selection on the inner native control, which are
 * the two things a document cannot express.
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
