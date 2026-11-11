/// <reference lib="dom" />
/**
 * Wait for an element's OWN `jx-ready`.
 *
 * `jx-ready` BUBBLES, and four kit elements announce themselves with it: `jx-tabs`, `jx-menu`,
 * `jx-popover` and `jx-action-group`. A panel that holds any of them is therefore told it is ready
 * by a descendant, before its own `popover` attribute is on, and a `showPopover()` made on that
 * answer throws. A listener on the panel has to ask whose announcement it heard, which is the check
 * `surfaces/dialog.ts` `whenReady` makes for a dialog's own template.
 *
 * Callers test `hasAttribute("popover")` first, because a panel that has already rendered will not
 * announce itself again.
 *
 * @docs extending/ui-kit
 */

/**
 * Resolves on the first `jx-ready` whose target is `element` itself.
 *
 * @param {HTMLElement} element
 * @returns {Promise<void>}
 */
export function whenOwnReady(element: HTMLElement): Promise<void> {
  return new Promise<void>((resolve) => {
    element.addEventListener("jx-ready", function onReady(event: Event) {
      if (event.target !== element) {
        return;
      }
      element.removeEventListener("jx-ready", onReady);
      resolve();
    });
  });
}
