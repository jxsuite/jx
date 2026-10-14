/**
 * Inherited-style.js — the effective inherited style for a breakpoint tab, **and the breakpoint it
 * came from**.
 *
 * Walks the cascade (base → each media block in order) up to but not including the active
 * breakpoint, producing the set of property values that would apply if no explicit override exists
 * on the current tab.
 *
 * The walk has always known the donor — it is the loop variable — and the answer was thrown away
 * one line later, which left the inspector able to show an inherited value only as an input
 * placeholder, visually identical to the CSS initial value rendered beside it.
 * {@link computeInheritedSources} keeps the donor; {@link computeInheritedStyle} is the projection
 * that drops it, for callers that only want the value.
 */

import { getNestedStyle, isNumber, isString } from "@jxsuite/schema/guards";
import type { JxStyle } from "@jxsuite/schema/types";

/** One inherited property: the value that shows through, and the breakpoint it was set on. */
export interface InheritedSource {
  value: string | number;
  /** The donor breakpoint's name, or `null` when the value comes from the base context. */
  donor: string | null;
}

/**
 * Compute the inherited style map WITH each value's donor breakpoint.
 *
 * @param {JxStyle} style — full style object (flat props + @media blocks + selectors)
 * @param {string[]} mediaNames — ordered breakpoint names (from parseMediaEntries, respects cascade
 *   direction)
 * @param {string | null} activeTab — current breakpoint tab name, or null for base
 * @param {string | null} activeSelector — current nested selector, or null
 * @returns {Record<string, InheritedSource>} Prop → { value, donor }
 */
export function computeInheritedSources(
  style: JxStyle,
  mediaNames: string[],
  activeTab: string | null,
  activeSelector: string | null = null,
): Record<string, InheritedSource> {
  if (activeTab === null || mediaNames.length === 0) {
    return {};
  }

  // A Map re-set keeps the key's first position, exactly as reassigning an object property does.
  const inherited = new Map<string, InheritedSource>();

  /** Layer one block over the accumulator, recording `donor` for everything it contributes. */
  const layer = (block: JxStyle | undefined, donor: string | null) => {
    for (const [p, v] of Object.entries(block ?? {})) {
      // Declarations only: nested blocks, block lists and `$ref` objects are not inherited values.
      if (v === undefined || isString(v) || isNumber(v)) {
        inherited.set(p, { donor, value: v ?? "" });
      }
    }
  };

  if (activeSelector) {
    // Selector inheritance: base selector → each media's selector block, in cascade order.
    layer(getNestedStyle(style, activeSelector), null);
    for (const name of mediaNames) {
      if (name === activeTab) {
        break;
      }
      layer(getNestedStyle(getNestedStyle(style, `@${name}`), activeSelector), name);
    }
    return Object.fromEntries(inherited);
  }

  // Base flat props first, then each media block in order until the current tab.
  layer(style, null);
  for (const name of mediaNames) {
    if (name === activeTab) {
      break;
    }
    layer(getNestedStyle(style, `@${name}`), name);
  }
  return Object.fromEntries(inherited);
}

/**
 * Compute the inherited style object for a given breakpoint tab — values only.
 *
 * @param {JxStyle} style — full style object (flat props + @media blocks + selectors)
 * @param {string[]} mediaNames — ordered breakpoint names (from parseMediaEntries, respects cascade
 *   direction)
 * @param {string | null} activeTab — current breakpoint tab name, or null for base
 * @param {string | null} activeSelector — current nested selector, or null
 * @returns {Record<string, string | number>} Inherited style map (prop → value)
 */
export function computeInheritedStyle(
  style: JxStyle,
  mediaNames: string[],
  activeTab: string | null,
  activeSelector: string | null = null,
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(computeInheritedSources(style, mediaNames, activeTab, activeSelector)).map(
      ([prop, source]) => [prop, source.value],
    ),
  );
}
