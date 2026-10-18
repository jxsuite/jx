/// <reference lib="dom" />
/**
 * Parent-realm live component preview — registers a project component's custom element and
 * instantiates it in the editor document. Used by the browse grid and the components-palette DnD
 * cards. (The stylebook renders components inside the canvas iframe instead, via `$elements` refs
 * in its generated specimen doc.)
 */

import { defineElement, setSkipServerFunctions } from "@jxsuite/runtime";
import { projectState } from "../store";
import type { ComponentEntry } from "../files/components";
import type { JsonValue } from "@jxsuite/schema/types";

/**
 * Render a live component preview by registering its custom element and instantiating it.
 *
 * @param {ComponentEntry} comp
 * @param {ReadonlyMap<string, JsonValue>} [props] - Sample props (`browse/component-examples.ts`),
 *   set as properties before the instance connects, the way a parent's `$props` reach it (spec.md
 *   §16.2)
 * @returns {Promise<HTMLElement>}
 */
export async function renderComponentPreview(
  comp: ComponentEntry,
  props: ReadonlyMap<string, JsonValue> = new Map(),
) {
  setSkipServerFunctions(true);
  try {
    if (!(await defineComponent(comp))) {
      return _componentFallback(comp.tagName);
    }
    const el = document.createElement(comp.tagName);
    for (const p of comp.props || []) {
      if (p.default !== undefined && p.default !== "false" && p.default !== "''") {
        const val = String(p.default).replaceAll(/^'|'$/g, "");
        el.setAttribute(p.name, val);
      }
    }
    // Read at connection as the instance's own props, ahead of the attribute defaults above.
    /* SAFETY: an element is an ordinary extensible object, so any string key can be written; the
       instance reads each declared prop back off itself when it connects. */
    const properties = el as HTMLElement & Record<string, JsonValue>;
    for (const [name, value] of props) {
      properties[name] = value;
    }
    return el;
  } catch (error) {
    console.warn("Component preview failed:", comp.tagName, error);
    return _componentFallback(comp.tagName);
  }
}

/**
 * Make sure a component's element is defined in this window, registering a project definition from
 * its file. Answers whether the tag can now be instantiated: a package's element only when its
 * package already defined it, and a format-class source (Markdown) never, since it cannot be
 * imported as a module.
 */
export async function defineComponent(comp: ComponentEntry): Promise<boolean> {
  if (comp.source === "npm") {
    return Boolean(customElements.get(comp.tagName));
  }
  if (comp.path && !comp.path.endsWith(".json")) {
    return false;
  }
  const root = projectState?.projectRoot;
  await defineElement(`${location.origin}/${root ? `${root}/` : ""}${comp.path}`);
  return true;
}

/** @param {string} tagName */
function _componentFallback(tagName: string) {
  const fallback = document.createElement("div");
  fallback.style.cssText =
    "padding:12px;border:1px dashed var(--border);border-radius:var(--radius);color:var(--fg-dim)";
  fallback.textContent = `<${tagName}>`;
  return fallback;
}
