/**
 * Canvas DnD — extracted from studio.js (Phase 4m). Registers canvas elements as drag-and-drop
 * targets using @atlaskit/pragmatic-drag-and-drop.
 */

import {
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

import {
  getState,
  elToPath,
  canvasPanels,
  getNodeAtPath,
  VOID_ELEMENTS,
  isAncestor,
} from "../store.js";
import { view } from "../view.js";
import { applyDropInstruction } from "../panels/dnd.js";

/** @type {any} */
let _ctx = null;

/**
 * Initialize the canvas DnD module.
 *
 * @param {{ effectiveZoom: () => number }} ctx
 */
export function initCanvasDnD(ctx) {
  _ctx = ctx;
}

/**
 * Register all canvas elements in a panel as DnD drop targets.
 *
 * @param {any} panel
 */
export function registerPanelDnD(panel) {
  const { canvas, dropLine } = panel;
  const allEls = canvas.querySelectorAll("*");

  const monitorCleanup = monitorForElements({
    onDragStart() {
      for (const el of canvas.querySelectorAll("*")) {
        /** @type {any} */ (el).style.pointerEvents = "auto";
      }
      for (const p of canvasPanels) p.overlayClk.style.pointerEvents = "none";
    },
    onDrag({ location }) {
      view.lastDragInput = location.current.input;
    },
    onDrop() {
      for (const p of canvasPanels) p.dropLine.style.display = "none";
      view.lastDragInput = null;
      for (const el of canvas.querySelectorAll("*")) {
        /** @type {any} */ (el).style.pointerEvents = "none";
      }
      for (const p of canvasPanels) p.overlayClk.style.pointerEvents = "";
    },
  });
  view.canvasDndCleanups.push(monitorCleanup);

  const S = getState();
  for (const el of allEls) {
    const elPath = elToPath.get(el);
    if (!elPath) continue;

    const node = getNodeAtPath(S.document, elPath);
    const isVoid = VOID_ELEMENTS.has((node?.tagName || "div").toLowerCase());

    const cleanup = dropTargetForElements({
      element: el,
      canDrop({ source }) {
        const srcPath = source.data.path;
        if (srcPath && isAncestor(/** @type {any} */ (srcPath), elPath)) return false;
        return true;
      },
      getData() {
        return { path: elPath, _isVoid: isVoid };
      },
      onDragEnter() {
        showCanvasDropIndicator(el, elPath, isVoid, panel);
      },
      onDrag() {
        showCanvasDropIndicator(el, elPath, isVoid, panel);
      },
      onDragLeave() {
        dropLine.style.display = "none";
        el.classList.remove("canvas-drop-target");
      },
      onDrop({ source }) {
        dropLine.style.display = "none";
        el.classList.remove("canvas-drop-target");
        const instruction = getCanvasDropInstruction(el, elPath, isVoid);
        if (!instruction) return;
        applyDropInstruction(instruction, source.data, elPath);
      },
    });
    view.canvasDndCleanups.push(cleanup);
  }
}

/**
 * @param {any} el
 * @param {any} elPath
 * @param {any} isVoid
 */
function getCanvasDropInstruction(el, elPath, isVoid) {
  const rect = el.getBoundingClientRect();
  if (!view.lastDragInput) return null;
  const y = view.lastDragInput.clientY;
  const relY = (y - rect.top) / rect.height;

  if (elPath.length === 0) return { type: "make-child" };
  if (isVoid) return relY < 0.5 ? { type: "reorder-above" } : { type: "reorder-below" };
  if (relY < 0.25) return { type: "reorder-above" };
  if (relY > 0.75) return { type: "reorder-below" };
  return { type: "make-child" };
}

/**
 * @param {any} el
 * @param {any} elPath
 * @param {any} isVoid
 * @param {any} panel
 */
function showCanvasDropIndicator(el, elPath, isVoid, panel) {
  const instruction = getCanvasDropInstruction(el, elPath, isVoid);
  const { dropLine, viewport } = panel;
  if (!instruction) {
    dropLine.style.display = "none";
    return;
  }

  const scale = _ctx.effectiveZoom();
  const wrapRect = viewport.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const left = (elRect.left - wrapRect.left + viewport.scrollLeft) / scale;
  const width = elRect.width / scale;

  if (instruction.type === "make-child") {
    dropLine.style.display = "block";
    dropLine.style.top = `${(elRect.top - wrapRect.top + viewport.scrollTop) / scale}px`;
    dropLine.style.left = `${left}px`;
    dropLine.style.width = `${width}px`;
    dropLine.style.height = `${elRect.height / scale}px`;
    dropLine.className = "canvas-drop-indicator inside";
    el.classList.add("canvas-drop-target");
    return;
  }

  el.classList.remove("canvas-drop-target");
  const top =
    instruction.type === "reorder-above"
      ? (elRect.top - wrapRect.top + viewport.scrollTop) / scale
      : (elRect.bottom - wrapRect.top + viewport.scrollTop) / scale;

  dropLine.style.display = "block";
  dropLine.style.top = `${top}px`;
  dropLine.style.left = `${left}px`;
  dropLine.style.width = `${width}px`;
  dropLine.style.height = "2px";
  dropLine.className = "canvas-drop-indicator line";
}
