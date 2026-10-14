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
 * @docs framework/concepts/components
 */

import type { JxDocument, JxElement, ProjectConfig } from "@jxsuite/schema/types";

/** The two modes the standard defines, or null for light DOM. */
export type ShadowMode = "open" | "closed";

/** A value `$shadow` or `defaults.shadow` may carry. */
export type ShadowSetting = ShadowMode | false;

/** Whether a document value is one of the settings `$shadow` / `defaults.shadow` may carry. */
function isShadowSetting(value: unknown): value is ShadowSetting {
  return value === false || value === "open" || value === "closed";
}

/**
 * The shadow mode a component renders in, or null for light DOM.
 *
 * A component's own `$shadow` wins over the project default in both directions — including
 * `$shadow: false`, which is how one component opts _out_ of a project that opted in.
 *
 * @param {JxDocument | JxElement | null | undefined} doc - The component definition
 * @param {ProjectConfig["defaults"] | undefined} defaults
 * @returns {ShadowMode | null}
 */
export function resolveShadowMode(
  doc: JxDocument | JxElement | null | undefined,
  defaults?: ProjectConfig["defaults"],
): ShadowMode | null {
  const own = doc?.$shadow;
  if (isShadowSetting(own)) {
    return own === false ? null : own;
  }
  const projectDefault = defaults?.shadow;
  return isShadowSetting(projectDefault) && projectDefault !== false ? projectDefault : null;
}

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
