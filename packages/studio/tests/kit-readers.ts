/**
 * Readers for what a kit control says about itself, kept out of `harness.ts` because that file is
 * read-only while a test-writing wave is in flight.
 *
 * A `hint` on `jx-action-button`, `jx-button` and `jx-switch` has two homes (ui.md §5.1): while the
 * control can act it is the text of a `jx-tooltip` the element renders as its own child, wired to
 * the control by `aria-describedby`; while the control is disabled it is a native `title`, because
 * a disabled control can open no tip. A test that read every hint through `getAttribute("title")`
 * was therefore reading the wrong place for every enabled control, and these are what it reads
 * instead.
 *
 * The two ends are one node on a button and two on a switch. A button's `<button part="control">`
 * takes the focus, carries `aria-describedby` and, while disabled, the `title`. A switch's `<label
 * part="control">` WRAPS an `<input part="input">`: the input is what is described, and the label
 * is the row the reader hovers, so the label is what carries the title (#332).
 */

/** The kit hosts these readers know, and the selector of the node each one describes. */
const HOSTS = "jx-action-button, jx-button, jx-switch";

/** The kit element `el` is or is inside, or `el` itself for a bare control. */
function hostOf(el: Element | null): Element | null {
  return el?.closest(HOSTS) ?? el;
}

/**
 * The node the kit DESCRIBES with the tip: the control that takes the focus and carries
 * `aria-describedby` and `disabled` — a button's `[part="control"]`, a switch's `[part="input"]`.
 */
function describedOf(el: Element | null): Element | null {
  const host = hostOf(el);
  if (!host) {
    return null;
  }
  if (host.localName === "jx-switch") {
    return host.querySelector('[part="input"]');
  }
  return host.getAttribute("part") === "control"
    ? host
    : (host.querySelector('[part="control"]') ?? null);
}

/** The node the kit puts the `title` on while disabled: `[part="control"]` on every host. */
function titledOf(el: Element | null): Element | null {
  const host = hostOf(el);
  if (!host) {
    return null;
  }
  return host.getAttribute("part") === "control"
    ? host
    : (host.querySelector('[part="control"]') ?? null);
}

/**
 * The `jx-tooltip` an enabled kit button renders for its hint, found through the control's own
 * `aria-describedby` rather than by tag, so a tip a host slotted in for some other reason is not
 * mistaken for the hint's.
 */
export function tooltipOf(el: Element | null): HTMLElement | null {
  const control = describedOf(el);
  /* The tip is the HOST's child, beside the control rather than inside it, so a reader handed the
     control looks up to the element that rendered both. */
  const host = hostOf(el);
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
 * The hint a kit control carries, read from wherever the kit put it: the tip's text while the
 * control is enabled, the native `title` while it is disabled, and null when it has neither.
 *
 * It THROWS on an enabled control that carries a `title`, rather than reading it. One affordance
 * per state is the contract (ui.md §5.1), and a reader that fell back to the title would let a
 * Studio assertion pass on a kit that had regressed to the mouse-only affordance for a control that
 * can act — the exact regression the retargeting was for.
 *
 * @param el The `jx-action-button`, `jx-button` or `jx-switch` host (or its control).
 */
export function hintOf(el: Element | null): string | null {
  const tip = tooltipOf(el);
  if (tip) {
    return tip.textContent;
  }
  const control = describedOf(el);
  const title = titledOf(el)?.getAttribute("title") ?? null;
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
