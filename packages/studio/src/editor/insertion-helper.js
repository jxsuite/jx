/**
 * Insertion-helper.js — Single floating "+" button for element insertion on the canvas.
 *
 * Uses CSS Anchor Positioning to attach to sibling boundaries and empty containers. Uses Native
 * Observables (Chrome 135+) for declarative event handling.
 */

import { showSlashMenu } from "./slash-menu.js";

// ─── State ───────────────────────────────────────────────────────────────────

/** @type {any} */
let _ctx = null;

/** @type {HTMLElement | null} */
let _helper = null;

/** @type {HTMLElement | null} */
let _currentAnchor = null;

/** @type {{ edge: string; path: any[]; parentPath: any[]; idx: number } | null} */
let _insertionPoint = null;

/** @type {AbortController | null} */
let _abort = null;

// Edge detection threshold in pixels
const EDGE_THRESHOLD = 14;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Mount the insertion helper system.
 *
 * @param {object} ctx
 * @param {Function} ctx.getState
 * @param {Function} ctx.update
 * @param {Function} ctx.getCanvasMode
 * @param {Function} ctx.withPanelPointerEvents
 * @param {Function} ctx.effectiveZoom
 * @param {Function} ctx.defaultDef
 * @param {Function} ctx.insertNode
 * @param {Function} ctx.selectNode
 * @param {Function} ctx.parentElementPath
 * @param {Function} ctx.childIndex
 * @param {Function} ctx.getNodeAtPath
 * @param {WeakMap} ctx.elToPath
 * @param {object} ctx.panel
 */
export function mount(ctx) {
  _ctx = ctx;
  const { panel } = ctx;

  _helper = document.createElement("button");
  _helper.className = "insertion-helper";
  _helper.textContent = "+";
  _helper.addEventListener("click", onHelperClick);
  panel.overlay.appendChild(_helper);

  _abort = new AbortController();

  // Use Native Observable if available, fall back to addEventListener
  if (typeof panel.overlayClk.on === "function") {
    panel.overlayClk.on("mousemove", { signal: _abort.signal }).subscribe({ next: onMouseMove });

    panel.overlayClk.on("mouseleave", { signal: _abort.signal }).subscribe({ next: hide });
  } else {
    panel.overlayClk.addEventListener("mousemove", onMouseMove, { signal: _abort.signal });
    panel.overlayClk.addEventListener("mouseleave", hide, { signal: _abort.signal });
  }
}

export function unmount() {
  _abort?.abort();
  _abort = null;
  if (_helper?.parentElement) _helper.remove();
  clearAnchor();
  _helper = null;
  _ctx = null;
  _insertionPoint = null;
}

// ─── Detection ───────────────────────────────────────────────────────────────

/** @param {MouseEvent} e */
function onMouseMove(e) {
  if (!_ctx || !_helper) return;

  const { getCanvasMode } = _ctx;
  if (getCanvasMode() !== "design") {
    hide();
    return;
  }

  const { panel, withPanelPointerEvents, elToPath } = _ctx;
  const el = withPanelPointerEvents(() => document.elementFromPoint(e.clientX, e.clientY));

  if (!el || !panel.canvas.contains(el)) {
    hide();
    return;
  }

  const path = elToPath.get(el);
  if (!path) {
    hide();
    return;
  }

  // Empty container: show centered "+"
  if (el.classList.contains("empty-container-placeholder")) {
    showAt(el, "center", path, path, 0);
    return;
  }

  // Root element — can't insert siblings above/below root
  if (path.length === 0) {
    hide();
    return;
  }

  // Determine layout direction of parent container
  const parent = el.parentElement;
  if (!parent) {
    hide();
    return;
  }

  const parentStyle = getComputedStyle(parent);
  const display = parentStyle.display;
  const isFlex = display === "flex" || display === "inline-flex";
  const isGrid = display === "grid" || display === "inline-grid";
  const isRow =
    (isFlex && parentStyle.flexDirection.startsWith("row")) ||
    (isGrid && parentStyle.gridAutoFlow?.startsWith("column"));

  // Calculate relative position within element
  const rect = el.getBoundingClientRect();
  const parentPath = _ctx.parentElementPath(path);
  const childIdx = /** @type {number} */ (_ctx.childIndex(path));

  if (isRow) {
    const relX = e.clientX - rect.left;
    if (relX < EDGE_THRESHOLD) {
      showAt(el, "left", path, parentPath, childIdx);
    } else if (rect.width - relX < EDGE_THRESHOLD) {
      showAt(el, "right", path, parentPath, childIdx + 1);
    } else {
      hide();
    }
  } else {
    const relY = e.clientY - rect.top;
    if (relY < EDGE_THRESHOLD) {
      showAt(el, "top", path, parentPath, childIdx);
    } else if (rect.height - relY < EDGE_THRESHOLD) {
      showAt(el, "bottom", path, parentPath, childIdx + 1);
    } else {
      hide();
    }
  }
}

// ─── Show / Hide ─────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} el
 * @param {string} edge
 * @param {any[]} path
 * @param {any[]} parentPath
 * @param {number} idx
 */
function showAt(el, edge, path, parentPath, idx) {
  if (!_helper) return;

  // Set CSS anchor on target element
  if (_currentAnchor !== el) {
    clearAnchor();
    el.style.anchorName = "--jx-insert";
    _currentAnchor = el;
  }

  _helper.dataset.edge = edge;
  _helper.classList.add("visible");
  _insertionPoint = { edge, path, parentPath, idx };
}

function hide() {
  if (!_helper) return;
  _helper.classList.remove("visible");
  clearAnchor();
  _insertionPoint = null;
}

function clearAnchor() {
  if (_currentAnchor) {
    _currentAnchor.style.anchorName = "";
    _currentAnchor = null;
  }
}

// ─── Insertion ───────────────────────────────────────────────────────────────

function onHelperClick(/** @type {MouseEvent} */ e) {
  e.stopPropagation();
  e.preventDefault();

  if (!_ctx || !_helper || !_insertionPoint) return;

  showSlashMenu(_helper, "", {
    onSelect: onSlashSelect,
  });
}

/** @param {any} cmd */
function onSlashSelect(cmd) {
  if (!_ctx || !_insertionPoint) return;

  const { getState, update, defaultDef, insertNode, selectNode } = _ctx;
  const S = getState();
  const { parentPath, idx, edge } = _insertionPoint;

  const newDef = defaultDef(cmd.tag);
  const insertPath = edge === "center" ? _insertionPoint.path : parentPath;
  const insertIdx = edge === "center" ? 0 : idx;

  let s = insertNode(S, insertPath, insertIdx, newDef);
  const newPath = [...insertPath, "children", insertIdx];
  s = selectNode(s, newPath);
  update(s);

  hide();
}
