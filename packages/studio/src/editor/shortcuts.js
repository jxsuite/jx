/**
 * Shortcuts.js — Keyboard shortcuts for Jx Studio
 *
 * Extracted from studio.js. Registers wheel-zoom, middle-mouse pan, resize listener, and keydown
 * shortcuts on the canvas / document.
 */

import {
  selectNode,
  undo,
  redo,
  removeNode,
  duplicateNode,
  getNodeAtPath,
  parentElementPath,
  childIndex,
  canvasWrap,
  update,
} from "../../store.js";
import { isEditing } from "./inline-edit.js";
import { copyNode, cutNode, pasteNode } from "./context-menu.js";

/**
 * Initialise all keyboard (and wheel/pointer) shortcuts.
 *
 * @param {() => {
 *   S: any;
 *   setS: (s: any) => void;
 *   canvasMode: string;
 *   panX: number;
 *   panY: number;
 *   setPan: (x: number, y: number) => void;
 *   applyTransform: () => void;
 *   positionZoomIndicator: () => void;
 *   componentInlineEdit: any;
 *   saveFile: () => void;
 *   openProject: () => void;
 * }} getContext
 */
export function initShortcuts(getContext) {
  // Wheel handler: Ctrl+Scroll = zoom (cursor-centered), plain scroll = pan
  canvasWrap.addEventListener(
    "wheel",
    (/** @type {any} */ e) => {
      const { S, setS, canvasMode, panX, panY, setPan, applyTransform } = getContext();
      // Edit (content) mode: let the scroll container handle scrolling natively
      if (canvasMode === "edit") return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Zoom towards cursor
        const rect = canvasWrap.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        const oldZoom = S.ui.zoom;
        const delta = -e.deltaY * 0.005;
        const newZoom = Math.min(5.0, Math.max(0.05, oldZoom * (1 + delta)));
        const ratio = newZoom / oldZoom;
        // Adjust pan so the point under cursor stays stationary
        setPan(cursorX - (cursorX - panX) * ratio, cursorY - (cursorY - panY) * ratio);
        setS({ ...S, ui: { ...S.ui, zoom: newZoom } });
      } else {
        // Pan
        setPan(panX - e.deltaX, panY - e.deltaY);
      }
      applyTransform();
    },
    { passive: false },
  );

  // Middle-mouse drag panning
  canvasWrap.addEventListener("pointerdown", (/** @type {any} */ e) => {
    const ctx = getContext();
    if (ctx.canvasMode === "edit") return; // no panning in edit mode
    if (e.button !== 1) return; // middle button only
    e.preventDefault();
    canvasWrap.setPointerCapture(e.pointerId);
    let lastX = e.clientX,
      lastY = e.clientY;
    const onMove = (/** @type {any} */ ev) => {
      const { panX, panY, setPan, applyTransform } = getContext();
      setPan(panX + (ev.clientX - lastX), panY + (ev.clientY - lastY));
      lastX = ev.clientX;
      lastY = ev.clientY;
      applyTransform();
    };
    const onUp = () => {
      canvasWrap.releasePointerCapture(e.pointerId);
      canvasWrap.removeEventListener("pointermove", onMove);
      canvasWrap.removeEventListener("pointerup", onUp);
    };
    canvasWrap.addEventListener("pointermove", onMove);
    canvasWrap.addEventListener("pointerup", onUp);
  });

  // Reposition zoom indicator on resize
  window.addEventListener("resize", () => getContext().positionZoomIndicator());

  document.addEventListener("keydown", (e) => {
    const {
      S,
      setS,
      canvasMode,
      setPan,
      applyTransform,
      componentInlineEdit,
      saveFile,
      openProject,
    } = getContext();
    const mod = e.ctrlKey || e.metaKey;

    // Don't intercept when typing in inputs or contenteditable
    if (e.target instanceof HTMLElement && e.target.matches("input, textarea, select")) {
      if (mod && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
      return;
    }
    if (isEditing()) {
      // Let inline editor handle its own keyboard events; only intercept Save
      if (mod && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
      return;
    }
    if (componentInlineEdit) {
      if (mod && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
      return;
    }

    if (mod) {
      switch (e.key) {
        case "o":
          e.preventDefault();
          openProject();
          break;
        case "s":
          e.preventDefault();
          saveFile();
          break;
        case "z":
          e.preventDefault();
          update(e.shiftKey ? redo(S) : undo(S));
          break;
        case "d":
          e.preventDefault();
          if (S.selection) update(duplicateNode(S, S.selection));
          break;
        case "c":
          e.preventDefault();
          copyNode(S);
          break;
        case "x":
          e.preventDefault();
          cutNode(S);
          break;
        case "v":
          e.preventDefault();
          pasteNode(S);
          break;
        case "0":
          if (canvasMode === "edit") break;
          e.preventDefault();
          setS({ ...S, ui: { ...S.ui, zoom: 1 } });
          setPan(16, 16);
          applyTransform();
          break;
        case "=":
        case "+":
          if (canvasMode === "edit") break;
          e.preventDefault();
          setS({ ...S, ui: { ...S.ui, zoom: Math.min(5.0, S.ui.zoom * 1.2) } });
          applyTransform();
          break;
        case "-":
          if (canvasMode === "edit") break;
          e.preventDefault();
          setS({ ...S, ui: { ...S.ui, zoom: Math.max(0.05, S.ui.zoom / 1.2) } });
          applyTransform();
          break;
      }
      return;
    }

    switch (e.key) {
      case "Delete":
      case "Backspace":
        if (S.selection && S.selection.length >= 2) {
          e.preventDefault();
          update(removeNode(S, S.selection));
        }
        break;
      case "Escape":
        update(selectNode(S, null));
        break;
      case "ArrowUp":
        e.preventDefault();
        navigateSelection(S);
        break;
      case "ArrowDown":
        e.preventDefault();
        navigateSelection(S, 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (S.selection && S.selection.length >= 2) {
          update(selectNode(S, parentElementPath(S.selection)));
        }
        break;
      case "ArrowRight":
        e.preventDefault();
        if (S.selection) {
          const node = getNodeAtPath(S.document, S.selection);
          if (node?.children?.length > 0) {
            update(selectNode(S, [...S.selection, "children", 0]));
          }
        }
        break;
    }
  });
}

/**
 * @param {any} S
 * @param {number} [direction]
 */
function navigateSelection(S, direction = -1) {
  if (!S.selection) {
    update(selectNode(S, []));
    return;
  }
  if (S.selection.length < 2) return; // can't navigate from root

  const parent = getNodeAtPath(S.document, /** @type {any} */ (parentElementPath(S.selection)));
  const idx = /** @type {number} */ (childIndex(S.selection));
  const newIdx = idx + direction;
  if (parent?.children && newIdx >= 0 && newIdx < parent.children.length) {
    update(selectNode(S, [...parentElementPath(S.selection), "children", newIdx]));
  }
}
