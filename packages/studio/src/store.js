/**
 * Store.js — Shared state hub for Jx Studio
 *
 * Every other studio module imports from this file for shared state, DOM refs, render
 * orchestration, and state.js re-exports. This prevents circular dependencies by keeping store.js
 * free of domain-specific imports.
 */

// ─── Re-exports from state.js ────────────────────────────────────────────────

export {
  createState,
  selectNode,
  hoverNode,
  undo,
  redo,
  insertNode,
  removeNode,
  duplicateNode,
  moveNode,
  updateProperty,
  updateStyle,
  updateAttribute,
  addDef,
  removeDef,
  updateDef,
  renameDef,
  updateMediaStyle,
  updateMedia,
  updateNestedStyle,
  updateMediaNestedStyle,
  pushDocument,
  popDocument,
  updateProp,
  addSwitchCase,
  removeSwitchCase,
  renameSwitchCase,
  applyMutation,
  getNodeAtPath,
  flattenTree,
  nodeLabel,
  pathKey,
  pathsEqual,
  parentElementPath,
  childIndex,
  isAncestor,
  projectState,
  setProjectState,
} from "./state.js";

// ─── DOM shortcuts & element refs ────────────────────────────────────────────

export const $ = (/** @type {string} */ sel) => document.querySelector(sel);
export const _$$ = (/** @type {string} */ sel) => document.querySelectorAll(sel);

export const canvasWrap = /** @type {any} */ (document.querySelector("#canvas-wrap"));
export const activityBar = /** @type {any} */ (document.querySelector("#activity-bar"));
export const leftPanel = /** @type {any} */ (document.querySelector("#left-panel"));
export const rightPanel = /** @type {any} */ (document.querySelector("#right-panel"));
export const toolbarEl = /** @type {any} */ (document.querySelector("#toolbar"));
export const statusbarEl = /** @type {any} */ (document.querySelector("#statusbar"));

// ─── Shared mutable state container ─────────────────────────────────────────
// A plain object so all importers share the same reference and see mutations.
// Used by extracted modules; studio.js keeps local aliases during migration.

/**
 * @type {{
 *   S: any;
 *   canvasMode: string;
 *   panX: number;
 *   panY: number;
 *   panzoomWrap: any;
 *   componentInlineEdit: any;
 *   pendingInlineEdit: any;
 *   monacoEditor: any;
 *   functionEditor: any;
 *   liveScope: any;
 *   blockActionBarEl: any;
 *   inlineEditCleanup: any;
 *   selDragCleanup: any;
 *   componentSlashMenu: any;
 * }}
 */
export const ctx = {
  S: undefined,
  canvasMode: "design",
  panX: 0,
  panY: 0,
  panzoomWrap: null,
  componentInlineEdit: null,
  pendingInlineEdit: null,
  monacoEditor: null,
  functionEditor: null,
  liveScope: null,
  blockActionBarEl: null,
  inlineEditCleanup: null,
  selDragCleanup: null,
  componentSlashMenu: null,
};

// ─── Shared containers (mutated in place by owner modules) ───────────────────

/** WeakMap<HTMLElement, Array> — maps rendered DOM elements to their JSON paths */
export const elToPath = new WeakMap();

/**
 * Canvas panels: Array<{ mediaName, canvas, overlay, overlayClk, viewport, dropLine }>
 *
 * @type {any[]}
 */
export const canvasPanels = [];

// ─── Shared constants ────────────────────────────────────────────────────────

/** Void elements that cannot accept children */
export const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export const COMMON_SELECTORS = [
  ":hover",
  ":focus",
  ":active",
  ":focus-within",
  ":focus-visible",
  ":disabled",
  ":first-child",
  ":last-child",
  "::before",
  "::after",
  "::placeholder",
];

/** @param {any} k */
export function isNestedSelector(k) {
  return k.startsWith(":") || k.startsWith(".") || k.startsWith("&") || k.startsWith("[");
}

// ─── Shared utilities ────────────────────────────────────────────────────────

const _styleDebounceTimers = new Map();

/**
 * @param {any} prop
 * @param {any} ms
 * @param {any} fn
 */
export function debouncedStyleCommit(prop, ms, fn) {
  return (/** @type {any[]} */ ...args) => {
    clearTimeout(_styleDebounceTimers.get(prop));
    _styleDebounceTimers.set(
      prop,
      setTimeout(() => {
        _styleDebounceTimers.delete(prop);
        fn(...args);
      }, ms),
    );
  };
}

/** Cancel a pending debounced commit for the given prop key. */
export function cancelStyleDebounce(/** @type {string} */ prop) {
  clearTimeout(_styleDebounceTimers.get(prop));
  _styleDebounceTimers.delete(prop);
}

/**
 * Strip all on* event handler properties from a Jx document tree (deep clone).
 *
 * @param {any} node
 * @returns {any}
 */
export function stripEventHandlers(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(stripEventHandlers);
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("on") && typeof v === "object" && (v?.$ref || v?.$prototype === "Function"))
      continue;
    if (k === "children") {
      out.children = Array.isArray(v) ? v.map(stripEventHandlers) : stripEventHandlers(v);
    } else if (k === "cases" && typeof v === "object") {
      /** @type {Record<string, any>} */
      const cases = {};
      for (const [ck, cv] of Object.entries(v)) cases[ck] = stripEventHandlers(cv);
      out.cases = cases;
    } else if (k === "state" || k === "style" || k === "attributes" || k === "$media") {
      out[k] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Render orchestration ────────────────────────────────────────────────────

/** @type {Map<string, Function>} */
const _renderers = new Map();

/**
 * Register a named renderer. Called at module import time by each module.
 *
 * @param {string} name
 * @param {Function} fn
 */
export function registerRenderer(name, fn) {
  _renderers.set(name, fn);
}

/** Call all registered renderers (full repaint). */
export function render() {
  for (const fn of _renderers.values()) fn();
}

/**
 * Call specific renderers by name.
 *
 * @param {...string} names
 */
export function renderOnly(...names) {
  for (const name of names) {
    const fn = _renderers.get(name);
    if (fn) fn();
  }
}

// ─── Update dispatch (late-bound) ────────────────────────────────────────────
// studio.js registers the real update implementation via setUpdateFn() during bootstrap.
// This allows extracted modules to import `update` from store.js without circular deps.

/** @type {Function} */
let _updateFn = () => {
  throw new Error("update() called before setUpdateFn() — bootstrap not complete");
};

/** @type {Function} */
let _getStateFn = () => null;

/**
 * Register the update implementation. Called by studio.js at module load time.
 *
 * @param {Function} fn
 */
export function setUpdateFn(fn) {
  _updateFn = fn;
}

/**
 * Register the state getter. Called by studio.js at module load time.
 *
 * @param {Function} fn — returns current S
 */
export function setGetStateFn(fn) {
  _getStateFn = fn;
}

/**
 * Get the current state (live, not stale).
 *
 * @returns {any}
 */
export function getState() {
  return _getStateFn();
}

/**
 * Dispatch a state update + selective re-render.
 *
 * @param {any} newState
 */
export function update(newState) {
  _updateFn(newState);
}

/** @type {Function[]} */
const _updateMiddleware = [];

/**
 * Register middleware that runs after every update().
 *
 * @param {Function} fn — receives (state) after core update
 */
export function addUpdateMiddleware(fn) {
  _updateMiddleware.push(fn);
}

/**
 * Run all registered update middleware.
 *
 * @param {any} state
 */
export function runUpdateMiddleware(state) {
  for (const mw of _updateMiddleware) mw(state);
}

/** @type {Function[]} */
const _postRenderHooks = [];

/**
 * Register a hook that runs after renders in update().
 *
 * @param {Function} fn — receives (prevDoc, prevSel)
 */
export function addPostRenderHook(fn) {
  _postRenderHooks.push(fn);
}

/**
 * Run all registered post-render hooks.
 *
 * @param {any} prevDoc
 * @param {any} prevSel
 */
export function runPostRenderHooks(prevDoc, prevSel) {
  for (const hook of _postRenderHooks) hook(prevDoc, prevSel);
}
