/**
 * Readers for what a kit button says about itself, kept out of `harness.ts` because that file is
 * read-only while a test-writing wave is in flight.
 *
 * A `hint` on `jx-action-button` and `jx-button` has two homes (ui.md §5.1): while the button can
 * act it is the text of a `jx-tooltip` the element renders as its own child, wired to the control
 * by `aria-describedby`; while the button is disabled it is the control's native `title`, because a
 * disabled control can open no tip. A test that read every hint through `getAttribute("title")` was
 * therefore reading the wrong place for every enabled button, and these are what it reads instead.
 */

/** The element's own `<button part="control">`, or the element itself when it is one. */
function controlOf(el: Element | null): Element | null {
  if (!el) {
    return null;
  }
  return el.getAttribute("part") === "control"
    ? el
    : (el.querySelector('[part="control"]') ?? null);
}

/**
 * The `jx-tooltip` an enabled kit button renders for its hint, found through the control's own
 * `aria-describedby` rather than by tag, so a tip a host slotted in for some other reason is not
 * mistaken for the hint's.
 */
export function tooltipOf(el: Element | null): HTMLElement | null {
  const control = controlOf(el);
  /* The tip is the HOST's child, beside the control rather than inside it, so a reader handed the
     control looks up to the element that rendered both. */
  const host = control?.closest("jx-action-button, jx-button") ?? el;
  const ids = control?.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
  for (const id of ids) {
    const tip = host?.querySelector<HTMLElement>(`jx-tooltip[id="${id}"]`);
    if (tip) {
      return tip;
    }
  }
  return null;
}

/**
 * The hint a kit button carries, read from wherever the kit put it: the tip's text while the button
 * is enabled, the control's `title` while it is disabled, and null when it has neither.
 *
 * It THROWS on an enabled control that carries a `title`, rather than reading it. One affordance
 * per state is the contract (ui.md §5.1), and a reader that fell back to the title would let a
 * Studio assertion pass on a kit that had regressed to the mouse-only affordance for a button that
 * can act — the exact regression the retargeting was for.
 *
 * @param el The `jx-action-button` or `jx-button` host (or its control).
 */
export function hintOf(el: Element | null): string | null {
  const tip = tooltipOf(el);
  if (tip) {
    return tip.textContent;
  }
  const control = controlOf(el);
  const title = control?.getAttribute("title") ?? null;
  if (title !== null && !control?.hasAttribute("disabled")) {
    throw new Error(
      `hintOf: an enabled control carries title="${title}" and no tooltip; an enabled hint is a jx-tooltip (ui.md 5.1)`,
    );
  }
  return title;
}

/**
 * The text a kit button PRINTS: its `[part="label"]`, which is the slot container inside the
 * control and nothing else. The host's own `textContent` is no longer that, because an enabled hint
 * is a `jx-tooltip` child of the host and its text is light DOM like everything else in the kit.
 *
 * @param el The `jx-action-button` or `jx-button` host.
 */
export function printedOf(el: Element | null): string {
  return el?.querySelector('[part="label"]')?.textContent?.trim() ?? "";
}
