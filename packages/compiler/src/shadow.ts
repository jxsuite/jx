/**
 * Shadow DOM, opt-in.
 *
 * Light DOM is the default and stays the default. It is not a placeholder for shadow DOM: a Jx
 * component's styles are reachable from the page, which is how a project restyles a component it
 * did not write, and the `<slot>` emulation that makes light-DOM composition work has different
 * distribution semantics from real slotting. Switching a component to a shadow root changes both,
 * so it is a per-component decision an author makes deliberately.
 *
 * `$shadow` on a component document, `defaults.shadow` on the project, `false` if neither says
 * otherwise. `"open"` and `"closed"` are the standard's two modes; the difference matters more here
 * than usual, because a **closed** declarative shadow root is not reachable through
 * `element.shadowRoot` and hydration has to find it another way (§16.6).
 *
 * The verdict itself is the runtime's (`resolveShadowMode` in `@jxsuite/runtime/css`), re-exported
 * here for the compiler's callers; the CSS scope a component sheet is written under is the
 * compiler's own.
 *
 * @docs framework/concepts/components
 */

import type { ShadowMode } from "@jxsuite/runtime/css";

export { resolveShadowMode, type ShadowMode, type ShadowSetting } from "@jxsuite/runtime/css";

/**
 * The CSS scope prefix for a component's own rules.
 *
 * In light DOM the prefix is the tag name, which is what makes `sty-card .inner` reach only that
 * component's descendants. Inside a shadow root the selector cannot see the host's tag name, and
 * `:host` is the standard's way to address it.
 *
 * @param {string} tagName
 * @param {ShadowMode | null} shadow
 * @returns {string}
 */
export function styleScopePrefix(tagName: string, shadow: ShadowMode | null): string {
  return shadow === null ? tagName : ":host";
}
