/**
 * Pseudo-state preview — extracted from studio.js (Phase 4m). When a pseudo-selector (:hover,
 * :focus, etc.) is active in the style sidebar, force those styles onto the selected element.
 */

import { getState, getNodeAtPath } from "../store.js";
import { view } from "../view.js";
import { getActivePanel, findCanvasElement } from "../canvas/canvas-helpers.js";

export function updateForcedPseudoPreview() {
  if (view.forcedStyleTag) {
    view.forcedStyleTag.remove();
    view.forcedStyleTag = null;
  }
  if (view.forcedAttrEl) {
    view.forcedAttrEl.removeAttribute("data-studio-forced");
    view.forcedAttrEl = null;
  }

  const S = getState();
  const sel = S.ui?.activeSelector;
  if (!sel || !sel.startsWith(":") || !S.selection) return;

  const panel = getActivePanel();
  if (!panel) return;
  const el = findCanvasElement(S.selection, panel.canvas);
  if (!el) return;

  const node = getNodeAtPath(S.document, S.selection);
  if (!node?.style) return;
  const activeTab = S.ui.activeMedia;
  /** @type {any} */
  const ctx = activeTab ? node.style[`@${activeTab}`] || {} : node.style;
  const rules = ctx[sel];
  if (!rules || typeof rules !== "object") return;

  const cssProps = Object.entries(rules)
    .filter(([k]) => typeof rules[k] === "string" || typeof rules[k] === "number")
    .map(
      ([k, v]) =>
        `${k.replace(/[A-Z]/g, (/** @type {any} */ c) => `-${c.toLowerCase()}`)}: ${v} !important`,
    )
    .join("; ");
  if (!cssProps) return;

  el.setAttribute("data-studio-forced", "1");
  view.forcedAttrEl = el;

  const tag = document.createElement("style");
  tag.textContent = `[data-studio-forced] { ${cssProps} }`;
  document.head.appendChild(tag);
  view.forcedStyleTag = tag;
}
