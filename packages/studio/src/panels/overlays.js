/**
 * Overlays panel — renders hover/selection overlay boxes on canvas panels. Delegates block action
 * bar rendering to studio.js via ctx callback.
 */

import { html, render as litRender, nothing } from "lit-html";
import { getState, canvasPanels, pathsEqual } from "../store.js";
import { view } from "../view.js";

/** @type {any} */
let _ctx = null;

/**
 * Mount the overlays panel.
 *
 * @param {any} ctx — { effectiveZoom, getCanvasMode, isEditing, renderBlockActionBar,
 *   findCanvasElement, getActivePanel }
 */
export function mount(ctx) {
  _ctx = ctx;
}

export function unmount() {
  _ctx = null;
}

/**
 * @param {any} el
 * @param {any} type
 * @param {any} panel
 */
function overlayBoxDescriptor(el, type, panel) {
  const vpRect = panel.viewport.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const scale = _ctx.effectiveZoom();
  return {
    cls: `overlay-box overlay-${type}`,
    top: `${(elRect.top - vpRect.top + panel.viewport.scrollTop) / scale}px`,
    left: `${(elRect.left - vpRect.left + panel.viewport.scrollLeft) / scale}px`,
    width: `${elRect.width / scale}px`,
    height: `${elRect.height / scale}px`,
  };
}

export function render() {
  if (!_ctx) return;
  const S = getState();
  const canvasMode = _ctx.getCanvasMode();

  if (canvasMode !== "design" && canvasMode !== "edit" && canvasMode !== "settings") {
    for (const p of canvasPanels) {
      litRender(nothing, p.overlay);
      p.overlayClk.style.pointerEvents = "none";
    }
    if (view.selDragCleanup) {
      view.selDragCleanup();
      view.selDragCleanup = null;
    }
    return;
  }

  if (canvasMode === "settings") {
    const enable = S.ui.stylebookTab === "elements";
    for (const p of canvasPanels) {
      p.overlayClk.style.pointerEvents = enable ? "" : "none";
    }
    return;
  }

  for (const p of canvasPanels) {
    p.overlayClk.style.pointerEvents = view.componentInlineEdit || _ctx.isEditing() ? "none" : "";
  }

  if (view.selDragCleanup) {
    view.selDragCleanup();
    view.selDragCleanup = null;
  }

  for (const p of canvasPanels) {
    /**
     * @type {{
     *   cls: string;
     *   top: string;
     *   left: string;
     *   width: string;
     *   height: string;
     *   border?: string;
     * }[]}
     */
    const boxes = [];

    if (S.hover && !pathsEqual(S.hover, S.selection)) {
      const el = _ctx.findCanvasElement(S.hover, p.canvas);
      if (el) boxes.push(overlayBoxDescriptor(el, "hover", p));
    }

    if (S.selection && p === _ctx.getActivePanel()) {
      const el = _ctx.findCanvasElement(S.selection, p.canvas);
      if (el) {
        const desc = overlayBoxDescriptor(el, "selection", p);
        if (view.componentInlineEdit || _ctx.isEditing()) /** @type {any} */ (desc).border = "none";
        boxes.push(desc);
      }
    }

    litRender(
      html`
        ${p.dropLine}
        ${boxes.map(
          (b) => html`
            <div
              class=${b.cls}
              style="top:${b.top};left:${b.left};width:${b.width};height:${b.height}${b.border
                ? `;border:${b.border}`
                : ""}"
            ></div>
          `,
        )}
      `,
      p.overlay,
    );
  }

  _ctx.renderBlockActionBar();
}
