/**
 * View.js — Transient view state for Jx Studio
 *
 * Holds DOM references, editor instances, cleanup functions, and other mutable state that is the
 * OUTPUT of renderers (not the input). Separating this from persistent app state (in S via
 * store.js) makes renderer dependencies explicit.
 */

/** @type {any} */
export const view = {
  // Canvas infrastructure
  panzoomWrap: null,
  liveScope: null,
  renderGeneration: 0,
  centerObserver: null,
  needsCenter: true,
  panX: 0,
  panY: 0,
  prevCanvasMode: null,

  // Editor instances
  monacoEditor: null,
  functionEditor: null,

  // Inline editing
  componentInlineEdit: null,
  pendingInlineEdit: null,
  inlineEditCleanup: null,

  // Floating UI containers
  blockActionBarEl: null,
  linkPopoverHost: null,

  // Selection & drag
  selDragCleanup: null,

  // Cleanup arrays (reset on each render cycle)
  dndCleanups: [],
  canvasDndCleanups: [],
  canvasEventCleanups: [],

  // Pseudo-state preview
  forcedStyleTag: null,
  forcedAttrEl: null,
};
