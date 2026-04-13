/**
 * studio.js — JSONsx Studio main application
 *
 * Phase 1: Open a JSONsx file, render in canvas, edit properties
 * in the inspector, see changes live, and save.
 * Phase 2: Tree editing with drag-and-drop reordering.
 */

import {
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

import { renderNode as runtimeRenderNode, buildScope, defineElement } from "@jsonsx/runtime";

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { mdToJsonsx, jsonsxToMd } from "./md-convert.js";
import { MD_ALL, MD_BLOCK, MD_INLINE, isValidChild } from "./md-allowlist.js";
import {
  startEditing,
  stopEditing,
  isEditing,
  getActiveElement,
  isEditableBlock,
  isInlineElement,
} from "./inline-edit.js";
import {
  camelToKebab,
  camelToLabel,
  kebabToLabel,
  propLabel,
  attrLabel,
  abbreviateValue,
  inferInputType,
} from "./studio-utils.js";

import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  attachInstruction,
  extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";

import { html, render as litRender, nothing } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { classMap } from "lit-html/directives/class-map.js";
import { repeat } from "lit-html/directives/repeat.js";
import { ifDefined } from "lit-html/directives/if-defined.js";

import webdata from "./webdata.json";
import cssMeta from "./css-meta.json";
import htmlMeta from "./html-meta.json";
import stylebookMeta from "./stylebook-meta.json";

// ─── Spectrum Web Components ──────────────────────────────────────────────────
// Explicit class imports + registration — bare side-effect imports are tree-shaken
// by Bun's bundler despite sideEffects declarations in Spectrum's package.json.
import { components as _swc } from "./spectrum.js"; // eslint-disable-line no-unused-vars
import icons from "./icons.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

// ─── Globals ──────────────────────────────────────────────────────────────────

let S; // current state
let statusMsg = "";
let statusTimeout;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const COMMON_SELECTORS = [
  ":hover", ":focus", ":active", ":focus-within", ":focus-visible",
  ":disabled", ":first-child", ":last-child", "::before", "::after", "::placeholder",
];

function isNestedSelector(k) {
  return k.startsWith(":") || k.startsWith(".") || k.startsWith("&") || k.startsWith("[");
}

const canvasWrap = $("#canvas-wrap");
const activityBar = $("#activity-bar");
const leftPanel = $("#left-panel");
const rightPanel = $("#right-panel");
const toolbar = $("#toolbar");
const statusbar = $("#statusbar");

// ─── Component registry ───────────────────────────────────────────────────────

// Module-level debounce map for lit-html style inputs — survives re-renders
const _styleDebounceTimers = new Map();
function debouncedStyleCommit(prop, ms, fn) {
  return (...args) => {
    clearTimeout(_styleDebounceTimers.get(prop));
    _styleDebounceTimers.set(prop, setTimeout(() => {
      _styleDebounceTimers.delete(prop);
      fn(...args);
    }, ms));
  };
}

let componentRegistry = []; // cached list from /__studio/components
let componentRegistryLoaded = false;

async function loadComponentRegistry() {
  try {
    const res = await fetch("/__studio/components");
    if (res.ok) componentRegistry = await res.json();
    componentRegistryLoaded = true;
  } catch {
    componentRegistryLoaded = true;
  }
}

async function navigateToComponent(componentPath) {
  try {
    const res = await fetch(`/__studio/file?path=${encodeURIComponent(componentPath)}`);
    const data = await res.json();
    if (!data.content) return;
    const doc = JSON.parse(data.content);
    S = pushDocument(S, doc, data.path);
    S.dirty = false;
    render();
    statusMessage(`Editing component: ${doc.tagName || data.path}`);
  } catch (e) {
    statusMessage(`Error: ${e.message}`);
  }
}

async function navigateBack() {
  if (!S.documentStack || S.documentStack.length === 0) return;
  if (S.dirty && S.documentPath) {
    try {
      await fetch(`/__studio/file?path=${encodeURIComponent(S.documentPath)}`, {
        method: "PUT",
        body: JSON.stringify(S.document, null, 2),
      });
    } catch (e) {
      statusMessage(`Save error: ${e.message}`);
    }
  }
  S = popDocument(S);
  render();
  statusMessage("Returned to parent document");
}

async function closeFunctionEditor() {
  const editing = S.ui.editingFunction;
  if (!editing) return;
  if (functionEditor) {
    const currentCode = functionEditor.getValue();
    const minResult = await codeService("minify", { code: currentCode });
    const bodyToStore = minResult?.code ?? currentCode;
    if (editing.type === "def") {
      update(updateDef(S, editing.defName, { body: bodyToStore }));
    } else if (editing.type === "event") {
      const node = getNodeAtPath(S.document, editing.path);
      const current = node?.[editing.eventKey] || {};
      update(updateProperty(S, editing.path, editing.eventKey, {
        ...current,
        $prototype: "Function",
        body: bodyToStore,
      }));
    }
    functionEditor.dispose();
    functionEditor = null;
  }
  S = { ...S, ui: { ...S.ui, editingFunction: null } };
  renderCanvas();
  renderToolbar();
}

function computeRelativePath(fromDocPath, toCompPath) {
  if (!fromDocPath) return `./${toCompPath}`;
  const fromDir = fromDocPath.substring(0, fromDocPath.lastIndexOf("/"));
  const fromParts = fromDir.split("/").filter(Boolean);
  const toParts = toCompPath.split("/").filter(Boolean);
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }
  const ups = fromParts.length - common;
  const remaining = toParts.slice(common);
  return (ups > 0 ? "../".repeat(ups) : "./") + remaining.join("/");
}

// ─── OXC code services (server-backed) ───────────────────────────────────────

async function codeService(action, payload) {
  try {
    const res = await fetch(`/__studio/code/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Ask the server to locate a document by filename within the project root. */
async function locateDocument(name) {
  try {
    const res = await fetch("/__studio/locate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) return (await res.json()).path || null;
  } catch {}
  return null;
}

/** Cache of plugin schemas keyed by "$src::$prototype". */
const pluginSchemaCache = new Map();

/** Fetch and cache the schema for an external $prototype + $src module via the server. */
async function fetchPluginSchema(def) {
  if (!def.$src || !def.$prototype) return null;
  const cacheKey = `${def.$src}::${def.$prototype}`;
  if (pluginSchemaCache.has(cacheKey)) return pluginSchemaCache.get(cacheKey);

  try {
    const params = new URLSearchParams({ src: def.$src, prototype: def.$prototype });
    if (S.documentPath) params.set("base", `${location.origin}/${S.documentPath}`);
    const res = await fetch(`/__studio/plugin-schema?${params}`);
    if (!res.ok) { pluginSchemaCache.set(cacheKey, null); return null; }
    const { schema } = await res.json();
    pluginSchemaCache.set(cacheKey, schema);
    return schema;
  } catch {
    pluginSchemaCache.set(cacheKey, null);
    return null;
  }
}

function setLintMarkers(editor, diagnostics) {
  const model = editor.getModel();
  if (!model) return;
  const markers = diagnostics.map((d) => {
    const label = d.labels?.[0];
    if (!label) return null;
    const { line, column, length } = label.span;
    return {
      severity: d.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      message: d.message + (d.help ? `\n${d.help}` : ""),
      startLineNumber: line,
      startColumn: column,
      endLineNumber: line,
      endColumn: column + (length || 1),
      code: d.url ? { value: d.code, target: monaco.Uri.parse(d.url) } : d.code,
      source: "oxlint",
    };
  }).filter(Boolean);
  monaco.editor.setModelMarkers(model, "oxlint", markers);
}

function getFunctionArgs(editing) {
  if (editing.type === "def") {
    return S.document.state?.[editing.defName]?.parameters || ["state", "event"];
  } else if (editing.type === "event") {
    const node = getNodeAtPath(S.document, editing.path);
    return node?.[editing.eventKey]?.parameters || ["state", "event"];
  }
  return ["state", "event"];
}

/** WeakMap<HTMLElement, Array> — maps rendered DOM elements to their JSON paths */
const elToPath = new WeakMap();

/** DnD cleanup functions from previous render — called on re-render */
let dndCleanups = [];
/** Canvas DnD cleanup functions — separate from layer panel */
let canvasDndCleanups = [];

/** Cleanup function for the current selection drag registration */
let selDragCleanup = null;

/** Void elements that cannot accept children */
const VOID_ELEMENTS = new Set([
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

/**
 * Canvas panels: Array<{ mediaName, canvas, overlay, overlayClk, viewport, dropLine }>
 * Built dynamically in renderCanvas() based on $media definitions.
 */
let canvasPanels = [];

/** Pan/zoom state (module-level, not serialized) */
let panX = 0, panY = 0;
let panzoomWrap = null; // the transform container inside #canvas-wrap

/** Canvas mode: "edit" | "design" | "preview" | "source" | "stylebook" */
let canvasMode = "design";

/** Component-mode inline text editing state: { el, path, originalText, mediaName } or null */
let componentInlineEdit = null;
let pendingInlineEdit = null; // { path, mediaName } — set when we want to enter edit after next render
let componentSlashMenu = null; // the sp-popover element for slash commands

/** Active Monaco editor instance (or null when in canvas mode) */
let monacoEditor = null;

/** Active function editor Monaco instance (or null) */
let functionEditor = null;

/** Cached state scope from last runtime render */
let liveScope = null;

/**
 * Strip all on* event handler properties from a JSONsx document tree (deep clone).
 * Returns a new object safe for edit-mode rendering where clicks should be intercepted.
 */
function stripEventHandlers(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(stripEventHandlers);
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("on") && typeof v === "object" && (v?.$ref || v?.$prototype === "Function")) continue;
    if (k === "children") {
      out.children = Array.isArray(v) ? v.map(stripEventHandlers) : stripEventHandlers(v);
    } else if (k === "cases" && typeof v === "object") {
      const cases = {};
      for (const [ck, cv] of Object.entries(v)) cases[ck] = stripEventHandlers(cv);
      out.cases = cases;
    } else if (k === "state" || k === "style" || k === "attributes" || k === "$media") {
      out[k] = v; // preserve as-is
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Convert a template string to a displayable expression for edit mode.
 * Replaces ${expr} with ❮ expr ❯ so the runtime renders it as literal text.
 */
function templateToEditDisplay(str) {
  return str.replace(/\$\{([^}]+)\}/g, "\u276A $1 \u276B");
}

/**
 * Prepare a document for edit-mode rendering. Replaces template strings with
 * readable literal text, $prototype:Array with placeholders, and $ref bindings
 * with display labels. Preserves state so the runtime can still initialise scope.
 */
function prepareForEditMode(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(prepareForEditMode);

  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "state" || k === "$media" || k === "$props" || k === "$elements") {
      out[k] = v; // preserve as-is for runtime resolution
    } else if (k === "children") {
      if (Array.isArray(v)) {
        out.children = v.map(prepareForEditMode);
      } else if (v && typeof v === "object" && v.$prototype === "Array") {
        // Wrap the map template in a visual repeater perimeter
        const template = v.map;
        if (template && typeof template === "object") {
          out.children = [{
            tagName: "div",
            className: "repeater-perimeter",
            state: {
              "$map": { item: {}, index: 0 },
              "$map/item": {},
              "$map/index": 0,
            },
            children: [prepareForEditMode(template)],
          }];
        } else {
          out.children = [];
        }
      } else {
        out.children = prepareForEditMode(v);
      }
    } else if (k === "cases" && node.$switch && v && typeof v === "object") {
      // Replace $switch cases with a placeholder showing the first case or a label
      const caseKeys = Object.keys(v);
      if (caseKeys.length > 0) {
        const firstCase = v[caseKeys[0]];
        if (firstCase && typeof firstCase === "object" && !firstCase.$ref) {
          out.children = [prepareForEditMode(firstCase)];
        } else {
          out.children = [{
            tagName: "div",
            textContent: `[$switch: ${caseKeys.join(" | ")}]`,
            style: {
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontSize: "11px",
              padding: "6px 10px",
              background: "color-mix(in srgb, var(--danger) 8%, transparent)",
              border: "1px dashed color-mix(in srgb, var(--danger) 40%, transparent)",
              borderRadius: "4px",
              color: "var(--danger)",
              fontStyle: "italic",
            },
          }];
        }
      }
    } else if (k === "style") {
      // Replace template strings in style values with empty strings
      if (v && typeof v === "object") {
        const s = {};
        for (const [sk, sv] of Object.entries(v)) {
          s[sk] = typeof sv === "string" && sv.includes("${") ? "" : sv;
        }
        out.style = s;
      } else {
        out.style = v;
      }
    } else if (typeof v === "string" && v.includes("${")) {
      // Template string in a display property → show raw expression
      out[k] = templateToEditDisplay(v);
    } else if (v && typeof v === "object" && v.$ref) {
      // $ref binding → show ref path as literal text
      const ref = v.$ref;
      const label = ref.startsWith("#/state/") ? ref.slice(8) : ref;
      out[k] = `{${label}}`;
    } else {
      out[k] = prepareForEditMode(v);
    }
  }
  return out;
}

/**
 * Render a JSONsx document into a canvas element using the real runtime.
 * Populates elToPath for each created element via onNodeCreated callback.
 * Returns the live state scope on success, null on failure.
 */
async function renderCanvasLive(doc, canvasEl) {
  canvasEl.innerHTML = "";

  // Apply content mode typography styling
  if (S.mode === "content") {
    canvasEl.setAttribute("data-content-mode", "");
  } else {
    canvasEl.removeAttribute("data-content-mode");
  }

  const renderDoc = canvasMode === "preview" ? structuredClone(doc) : prepareForEditMode(stripEventHandlers(doc));

  // In edit mode, collect paths where $map templates were inlined as children[0]
  // so we can remap runtime paths (children,0,...) → (children,map,...)
  const mapParentPaths = new Set();
  if (canvasMode === "design" || canvasMode === "edit") {
    (function findMapParents(node, path) {
      if (!node || typeof node !== "object") return;
      if (node.children && typeof node.children === "object" && node.children.$prototype === "Array") {
        mapParentPaths.add(path.join("/"));
      }
      if (Array.isArray(node.children)) {
        for (let i = 0; i < node.children.length; i++) {
          findMapParents(node.children[i], [...path, "children", i]);
        }
      }
      if (node.$switch && node.cases) {
        for (const [k, v] of Object.entries(node.cases)) {
          findMapParents(v, [...path, "cases", k]);
        }
      }
    })(doc, []);
  }

  try {
    const docBase = S.documentPath
      ? `${location.origin}/${S.documentPath}`
      : undefined;

    // Register custom elements so the runtime can render them
    if (renderDoc.$elements) {
      for (const entry of renderDoc.$elements) {
        if (entry?.$ref) {
          const href = new URL(entry.$ref, docBase).href;
          try { await defineElement(href); } catch (e) {
            console.warn("Studio: failed to register element", entry.$ref, e);
          }
        }
      }
    }

    const $defs = await buildScope(renderDoc, {}, docBase);
    const el = runtimeRenderNode(renderDoc, $defs, {
      onNodeCreated(el, path) {
        // Remap $map paths: wrapper and template children → real document paths
        // prepareForEditMode wraps $map template in: children[0] (wrapper) > children[0] (template)
        // Real paths: wrapper → ['children'] ($map container), template → ['children', 'map']
        let mappedPath = path;
        if ((canvasMode === "design" || canvasMode === "edit") && mapParentPaths.size > 0) {
          for (let i = 0; i < path.length - 1; i++) {
            if (path[i] === "children" && path[i + 1] === 0) {
              const parentKey = path.slice(0, i).join("/");
              if (mapParentPaths.has(parentKey)) {
                if (path.length === i + 2) {
                  // Wrapper div itself → $map container path
                  mappedPath = path.slice(0, i + 1);
                } else if (path.length >= i + 4 && path[i + 2] === "children" && path[i + 3] === 0) {
                  // Template or its descendants → children/map/...rest
                  mappedPath = [...path.slice(0, i), "children", "map", ...path.slice(i + 4)];
                }
                break;
              }
            }
          }
        }
        elToPath.set(el, mappedPath);
      },
      _path: [],
    });
    if (canvasMode === "design" || canvasMode === "edit") {
      // Disable pointer events on all rendered elements for edit mode
      el.style.pointerEvents = "none";
      for (const child of el.querySelectorAll("*")) {
        child.style.pointerEvents = "none";
      }
    }
    canvasEl.appendChild(el);
    if (canvasMode === "design" || canvasMode === "edit") {
      // Custom element connectedCallbacks render children asynchronously —
      // sweep again after they've had a chance to run
      requestAnimationFrame(() => {
        for (const child of canvasEl.querySelectorAll("*")) {
          // Preserve pointer-events on the actively-edited element
          if (componentInlineEdit && child === componentInlineEdit.el) continue;
          child.style.pointerEvents = "none";
        }
      });
    }
    return $defs;
  } catch (err) {
    console.warn("JSONsx Studio: runtime render failed, falling back to structural preview", err);
    return null;
  }
}

// ─── Webdata: datalists for autocomplete ──────────────────────────────────────

const tagNameList = document.createElement("datalist");
tagNameList.id = "tag-names";
for (const tag of webdata.allTags) {
  const opt = document.createElement("option");
  opt.value = tag;
  tagNameList.appendChild(opt);
}
document.body.appendChild(tagNameList);

const cssPropList = document.createElement("datalist");
cssPropList.id = "css-props";
for (const [name] of webdata.cssProps) {
  const opt = document.createElement("option");
  opt.value = name;
  cssPropList.appendChild(opt);
}
document.body.appendChild(cssPropList);

/** Map<camelCaseName, initialValue> for placeholder hints */
const cssInitialMap = new Map(webdata.cssProps);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const EMPTY_DOC = {
  tagName: "div",
  style: { padding: "2rem", fontFamily: "system-ui, sans-serif" },
  children: [
    { tagName: "h1", textContent: "New Component" },
    { tagName: "p", textContent: "Open a JSONsx file or start editing." },
  ],
};

S = createState(structuredClone(EMPTY_DOC));
registerFunctionCompletions();
loadComponentRegistry();
loadProject();
render();

// Auto-open a document via ?open=path query parameter (server-backed)
{
  const openParam = new URLSearchParams(location.search).get("open");
  if (openParam) {
    fetch(`/__studio/file?path=${encodeURIComponent(openParam)}`)
      .then((r) => r.json())
      .then(async (data) => {
        if (data.content) {
          const doc = JSON.parse(data.content);
          S = createState(doc);
          S.dirty = false;
          S.documentPath = data.path;
          render();
          statusMessage(`Opened ${data.path}`);
        }
      })
      .catch((e) => statusMessage(`Error: ${e.message}`));
  }
}

// ─── Render loop ──────────────────────────────────────────────────────────────

function render() {
  renderToolbar();
  renderActivityBar();
  renderLeftPanel();
  renderCanvas();
  renderRightPanel();
  renderOverlays();
  renderStatusbar();
}

function update(newState) {
  const prevDoc = S.document;
  const prevSel = S.selection;
  S = newState;

  renderToolbar();

  if (prevDoc !== S.document) {
    renderCanvas();
    renderLeftPanel();
  } else if (!pathsEqual(prevSel, S.selection)) {
    renderLeftPanel();
  }

  // Skip right-panel rebuild when an input inside it is focused (user is typing)
  // unless the selection changed — that always needs a full re-render
  const activeTag = document.activeElement?.tagName;
  const rightHasFocus = rightPanel.contains(document.activeElement)
    && (activeTag === "INPUT" || activeTag === "TEXTAREA"
      || activeTag === "SP-TEXTFIELD" || activeTag === "SP-NUMBER-FIELD"
      || activeTag === "SP-PICKER" || activeTag === "SP-COMBOBOX" || activeTag === "SP-SEARCH");
  if (!rightHasFocus || !pathsEqual(prevSel, S.selection)) {
    renderRightPanel();
  }
  renderOverlays();
  updateForcedPseudoPreview();
  renderStatusbar();

  // Process pending inline edit. If renderCanvas was NOT called (selection-only change),
  // the canvas DOM is already populated — enter edit synchronously.
  // If renderCanvas WAS called, the async .then() will handle it instead.
  if (pendingInlineEdit && prevDoc === S.document) {
    const { path, mediaName: mn } = pendingInlineEdit;
    pendingInlineEdit = null;
    const targetPanel = canvasPanels.find(p => p.mediaName === mn) || canvasPanels[0];
    if (targetPanel) {
      const el = findCanvasElement(path, targetPanel.canvas);
      if (el) enterComponentInlineEdit(el, path);
    }
  }
}

// ─── Media helpers ────────────────────────────────────────────────────────────

/**
 * Classify $media entries into size breakpoints (get a canvas each)
 * and feature queries (rendered as toolbar toggles).
 */
function parseMediaEntries(mediaDef) {
  if (!mediaDef) return { sizeBreakpoints: [], featureQueries: [], baseWidth: 320 };
  const sizes = [],
    features = [];
  let baseWidth = 320;
  for (const [name, query] of Object.entries(mediaDef)) {
    if (name === "--") {
      const wm = String(query).match(/^(\d+)\s*px$/);
      baseWidth = wm ? parseFloat(wm[1]) : 320;
      continue;
    }
    const minMatch = query.match(/min-width:\s*([\d.]+)px/);
    const maxMatch = query.match(/max-width:\s*([\d.]+)px/);
    if (minMatch) sizes.push({ name, query, width: parseFloat(minMatch[1]), type: "min" });
    else if (maxMatch) sizes.push({ name, query, width: parseFloat(maxMatch[1]), type: "max" });
    else features.push({ name, query });
  }
  sizes.sort((a, b) => (a.type === "min" ? a.width - b.width : b.width - a.width));
  return { sizeBreakpoints: sizes, featureQueries: features, baseWidth };
}

/**
 * Compute which named breakpoints are active at a given canvas width.
 * For min-width canvases: all breakpoints with min-width <= canvasWidth are active.
 * For max-width canvases: all breakpoints with max-width >= canvasWidth are active.
 */
function activeBreakpointsForWidth(sizeBreakpoints, canvasWidth) {
  const active = new Set();
  for (const bp of sizeBreakpoints) {
    if (bp.type === "min" && canvasWidth >= bp.width) active.add(bp.name);
    else if (bp.type === "max" && canvasWidth <= bp.width) active.add(bp.name);
  }
  return active;
}

/**
 * Apply styles to a canvas element, including active media overrides.
 * Base (flat) styles applied first, then matching media overrides in source order.
 */
function applyCanvasStyle(el, styleDef, activeBreakpoints, featureToggles) {
  if (!styleDef || typeof styleDef !== "object") return;
  for (const [prop, val] of Object.entries(styleDef)) {
    if (typeof val === "string" || typeof val === "number") {
      try {
        el.style[prop] = val;
      } catch {}
    }
  }
  for (const [key, val] of Object.entries(styleDef)) {
    if (!key.startsWith("@") || typeof val !== "object") continue;
    const mediaName = key.slice(1);
    if (mediaName === "--") continue; // skip base canvas width key
    if (activeBreakpoints.has(mediaName) || featureToggles[mediaName]) {
      for (const [prop, v] of Object.entries(val)) {
        if (typeof v === "string" || typeof v === "number") {
          try {
            el.style[prop] = v;
          } catch {}
        }
      }
    }
  }
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

function renderCanvas() {
  // Function editor mode: editing a function body in Monaco (JS)
  if (S.ui.editingFunction) {
    renderFunctionEditor();
    return;
  }

  // Dispose function editor if switching away
  if (functionEditor) {
    functionEditor.dispose();
    functionEditor = null;
  }

  // Source mode: update existing Monaco editor without recreating
  if (canvasMode === "source" && monacoEditor) {
    const jsonStr = JSON.stringify(S.document, null, 2);
    const currentVal = monacoEditor.getValue();
    if (currentVal !== jsonStr) {
      // Prevent triggering the onChange handler for this programmatic update
      monacoEditor._ignoreNextChange = true;
      monacoEditor.setValue(jsonStr);
    }
    return;
  }

  // Clean up previous canvas DnD registrations
  for (const fn of canvasDndCleanups) fn();
  canvasDndCleanups = [];
  canvasPanels = [];

  // Dispose Monaco editor if switching away from source mode
  if (monacoEditor) {
    monacoEditor.dispose();
    monacoEditor = null;
  }

  canvasWrap.innerHTML = "";
  panzoomWrap = null;
  // Reset inline style overrides from other modes
  canvasWrap.style.padding = "";
  canvasWrap.style.alignItems = "";
  canvasWrap.style.overflow = "";

  // Stylebook mode: render element catalog with panzoom surface
  if (canvasMode === "stylebook") {
    renderStylebook();
    return;
  }

  // Source mode: create Monaco editor instead of canvas
  if (canvasMode === "source") {
    canvasWrap.style.padding = "0";
    const editorContainer = document.createElement("div");
    editorContainer.className = "source-editor";
    canvasWrap.appendChild(editorContainer);

    const jsonStr = JSON.stringify(S.document, null, 2);
    monacoEditor = monaco.editor.create(editorContainer, {
      value: jsonStr,
      language: "json",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      wordWrap: "on",
      tabSize: 2,
    });

    // Debounced sync back to state
    let debounce;
    monacoEditor.onDidChangeModelContent(() => {
      if (monacoEditor._ignoreNextChange) {
        monacoEditor._ignoreNextChange = false;
        return;
      }
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        try {
          const parsed = JSON.parse(monacoEditor.getValue());
          S = { ...S, document: parsed, dirty: true };
          renderToolbar();
          renderLeftPanel();
          renderRightPanel();
        } catch {
          // Invalid JSON — don't update state
        }
      }, 600);
    });
    return;
  }

  // Edit (content) mode — centered column, no panzoom, always 100%
  if (canvasMode === "edit") {
    canvasWrap.style.padding = "0";
    canvasWrap.style.overflow = "hidden";

    // Remove zoom indicator left over from design/preview mode
    const oldIndicator = document.querySelector(".zoom-indicator");
    if (oldIndicator) oldIndicator.remove();

    const scrollContainer = document.createElement("div");
    scrollContainer.className = "content-edit-canvas";

    const column = document.createElement("div");
    column.className = "content-edit-column";
    scrollContainer.appendChild(column);
    canvasWrap.appendChild(scrollContainer);

    // Create a canvas panel inside the column so overlays and selection work
    const panel = createCanvasPanel(null, null, true);
    column.appendChild(panel.element);
    canvasPanels.push(panel);
    renderCanvasIntoPanel(panel, new Set(), S.ui.featureToggles);
    return;
  }

  // Normal canvas mode (design / preview) — set up panzoom surface
  canvasWrap.style.padding = "0";
  canvasWrap.style.overflow = "hidden";

  const { sizeBreakpoints, featureQueries, baseWidth } = parseMediaEntries(S.document.$media);
  const hasMedia = sizeBreakpoints.length > 0;
  const featureToggles = S.ui.featureToggles;

  // Create panzoom wrapper (the element that gets transformed)
  panzoomWrap = document.createElement("div");
  panzoomWrap.className = "panzoom-wrap";
  panzoomWrap.style.transformOrigin = "0 0";
  canvasWrap.appendChild(panzoomWrap);

  if (!hasMedia) {
    // Single panel — use baseWidth if a custom one is defined, otherwise full-width
    const hasBaseWidth = S.document.$media && S.document.$media["--"];
    const label = hasBaseWidth ? `${mediaDisplayName("--")} (${baseWidth}px)` : null;
    const panel = createCanvasPanel(
      hasBaseWidth ? "base" : null,
      label,
      !hasBaseWidth,
      hasBaseWidth ? baseWidth : undefined,
    );
    panzoomWrap.appendChild(panel.element);
    canvasPanels.push(panel);
    renderCanvasIntoPanel(panel, new Set(), featureToggles);
    applyTransform();
    renderZoomIndicator();
    return;
  }

  // Build all panels (base + breakpoints), sorted widest-first (left to right)
  const allPanelDefs = [
    { name: "base", displayName: mediaDisplayName("--"), width: baseWidth,
      activeSet: activeBreakpointsForWidth(sizeBreakpoints, baseWidth) },
  ];
  for (const bp of sizeBreakpoints) {
    allPanelDefs.push({
      name: bp.name, displayName: mediaDisplayName(bp.name), width: bp.width,
      activeSet: activeBreakpointsForWidth(sizeBreakpoints, bp.width),
    });
  }
  allPanelDefs.sort((a, b) => b.width - a.width);

  for (const def of allPanelDefs) {
    const label = `${def.displayName} (${def.width}px)`;
    const panel = createCanvasPanel(def.name, label, false, def.width);
    panzoomWrap.appendChild(panel.element);
    canvasPanels.push(panel);
    renderCanvasIntoPanel(panel, def.activeSet, featureToggles);
  }

  // Highlight active panel header
  updateActivePanelHeaders();

  // Apply current zoom + pan transform
  applyTransform();

  // Floating zoom indicator
  renderZoomIndicator();
}

/**
 * Render document into a single canvas panel.
 * Tries runtime rendering first, falls back to structural preview.
 */
function renderCanvasIntoPanel(panel, activeBreakpoints, featureToggles) {
  renderCanvasLive(S.document, panel.canvas).then((scope) => {
    if (scope) {
      liveScope = scope;
      statusMessage("Runtime render OK", 1500);
    } else {
      // Fallback to structural preview
      renderCanvasNode(S.document, [], panel.canvas, activeBreakpoints, featureToggles);
    }
    registerPanelDnD(panel);
    registerPanelEvents(panel);
    renderOverlays();

    // Process pending inline edit now that the canvas is populated
    if (pendingInlineEdit) {
      const { path, mediaName: mn } = pendingInlineEdit;
      pendingInlineEdit = null;
      const targetPanel = canvasPanels.find(p => p.mediaName === mn) || canvasPanels[0];
      if (targetPanel) {
        const el = findCanvasElement(path, targetPanel.canvas);
        if (el) enterComponentInlineEdit(el, path);
      }
    }
  });
}

/**
 * Create a canvas panel DOM structure.
 * Returns { mediaName, element, canvas, overlay, overlayClk, viewport, dropLine }
 */
function createCanvasPanel(mediaName, label, fullWidth, width) {
  const panel = document.createElement("div");
  panel.className = `canvas-panel${fullWidth ? " full-width" : ""}`;
  if (mediaName !== null) panel.dataset.media = mediaName;

  if (label) {
    const header = document.createElement("div");
    header.className = "canvas-panel-header";
    header.textContent = label;
    header.onclick = () => {
      S = { ...S, ui: { ...S.ui, activeMedia: mediaName === "base" ? null : mediaName } };
      updateActivePanelHeaders();
      renderRightPanel();
    };
    panel.appendChild(header);
  }

  const viewport = document.createElement("div");
  viewport.className = "canvas-panel-viewport";
  // No overflow:hidden on viewport — full content height visible for pan/zoom
  if (width && !fullWidth) viewport.style.width = `${width}px`;

  const canvasDiv = document.createElement("div");
  canvasDiv.className = "canvas-panel-canvas";
  // No CSS zoom — zoom is handled by transform on the panzoom wrapper
  canvasDiv.style.width = width ? `${width}px` : "";

  const overlayDiv = document.createElement("div");
  overlayDiv.className = "canvas-panel-overlay";

  const dropLine = document.createElement("div");
  dropLine.className = "canvas-drop-indicator";
  dropLine.style.display = "none";
  overlayDiv.appendChild(dropLine);

  const clickDiv = document.createElement("div");
  clickDiv.className = "canvas-panel-click";

  viewport.appendChild(canvasDiv);
  viewport.appendChild(overlayDiv);
  viewport.appendChild(clickDiv);
  panel.appendChild(viewport);

  return {
    mediaName,
    element: panel,
    canvas: canvasDiv,
    overlay: overlayDiv,
    overlayClk: clickDiv,
    viewport,
    dropLine,
    _width: width || null,
  };
}

/**
 * Apply the current zoom + pan transform to the panzoom wrapper.
 */
function applyTransform() {
  if (!panzoomWrap) return;
  panzoomWrap.style.transform = `translate(${panX}px, ${panY}px) scale(${S.ui.zoom})`;
  const label = document.querySelector(".zoom-indicator-label");
  if (label) label.textContent = `${Math.round(S.ui.zoom * 100)}%`;
  renderOverlays();
  if (canvasMode === "stylebook") renderStylebookOverlays();
}

/**
 * Lightweight in-place zoom update — no full re-render.
 */
function applyZoom() {
  applyTransform();
}

/**
 * Calculate zoom + pan to fit all panels within the viewport.
 */
function fitToScreen() {
  if (!panzoomWrap) return;
  const wrapWidth = canvasWrap.clientWidth;
  const wrapHeight = canvasWrap.clientHeight;
  const gap = 24;
  const padding = 32;
  let totalPanelWidth = 0;
  let maxPanelHeight = 0;
  for (const p of canvasPanels) {
    totalPanelWidth += p._width || 800;
  }
  totalPanelWidth += gap * Math.max(0, canvasPanels.length - 1) + padding;

  // Get actual content height from rendered panels
  const wrapRect = panzoomWrap.getBoundingClientRect();
  const unscaledHeight = wrapRect.height / S.ui.zoom;
  maxPanelHeight = unscaledHeight + padding;

  const fitZoomW = wrapWidth / totalPanelWidth;
  const fitZoomH = wrapHeight / maxPanelHeight;
  const fitZoom = Math.min(5.0, Math.max(0.05, Math.min(fitZoomW, fitZoomH)));

  S = { ...S, ui: { ...S.ui, zoom: fitZoom } };
  // Center the content
  const scaledWidth = totalPanelWidth * fitZoom;
  const scaledHeight = maxPanelHeight * fitZoom;
  panX = Math.max(0, (wrapWidth - scaledWidth) / 2);
  panY = Math.max(0, (wrapHeight - scaledHeight) / 2);
  applyTransform();
}

/**
 * Render the floating zoom indicator at the bottom center of canvas-wrap.
 * Uses position: fixed, computed from canvas-wrap bounds.
 */
function renderZoomIndicator() {
  // Remove existing indicator if any
  let indicator = document.querySelector(".zoom-indicator");
  if (indicator) indicator.remove();

  indicator = document.createElement("div");
  indicator.className = "zoom-indicator";

  const label = document.createElement("span");
  label.className = "zoom-indicator-label";
  label.textContent = `${Math.round(S.ui.zoom * 100)}%`;
  indicator.appendChild(label);

  const fitBtn = document.createElement("sp-action-button");
  fitBtn.setAttribute("quiet", "");
  fitBtn.setAttribute("size", "s");
  fitBtn.className = "zoom-fit-btn";
  fitBtn.title = "Fit to screen";
  fitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="1"/><path d="M2 6h12M6 2v12"/></svg>`;
  fitBtn.addEventListener("click", fitToScreen);
  indicator.appendChild(fitBtn);

  document.body.appendChild(indicator);
  positionZoomIndicator();
}

function positionZoomIndicator() {
  const indicator = document.querySelector(".zoom-indicator");
  if (!indicator) return;
  const rect = canvasWrap.getBoundingClientRect();
  indicator.style.left = `${rect.left + rect.width / 2}px`;
  indicator.style.top = `${rect.bottom - 32}px`;
  indicator.style.transform = "translateX(-50%)";
}

function updateActivePanelHeaders() {
  for (const p of canvasPanels) {
    const header = p.element.querySelector(".canvas-panel-header");
    if (header) {
      const isActive =
        (S.ui.activeMedia === null && p.mediaName === "base") ||
        (S.ui.activeMedia === null && p.mediaName === null) ||
        S.ui.activeMedia === p.mediaName;
      header.classList.toggle("active", isActive);
    }
  }
}

// ─── Signals / defs helpers ──────────────────────────────────────────────────

/** Default templates for creating new signal definitions. */
const DEF_TEMPLATES = {
  state: { type: "string", default: "" },
  computed: { $compute: "", $deps: [] },
  request: { $prototype: "Request", url: "", method: "GET", timing: "client" },
  localStorage: { $prototype: "LocalStorage", key: "", default: null },
  sessionStorage: { $prototype: "SessionStorage", key: "", default: null },
  indexedDB: { $prototype: "IndexedDB", database: "", store: "", version: 1 },
  cookie: { $prototype: "Cookie", name: "", default: "" },
  set: { $prototype: "Set", default: [] },
  map: { $prototype: "Map", default: {} },
  formData: { $prototype: "FormData", fields: {} },
  function: { $prototype: "Function", body: "", parameters: [] },
  external: { $prototype: "", $src: "" },
};

/** Classify a state entry into a category string. */
function defCategory(def) {
  if (!def) return "state";
  if (def.$handler || def.$prototype === "Function") return "function";
  if (def.$compute) return "computed";
  if (def.$prototype) return "data";
  return "state";
}

/** Badge label for a def category. */
function defBadgeLabel(def) {
  if (!def) return "S";
  if (def.$handler || def.$prototype === "Function") return "F";
  if (def.$compute) return "C";
  if (def.$prototype) return def.$prototype.charAt(0);
  return "S";
}

/** Hint text for a signal row. */
function defHint(name, def) {
  if (!def) return "";
  if (def.$prototype === "Function") {
    if (def.body) return def.body.length > 20 ? def.body.slice(0, 20) + "..." : def.body;
    if (def.$src) return def.$src;
    return "function";
  }
  if (def.$handler) return "handler (legacy)";
  if (def.$compute)
    return "=" + (def.$compute.length > 20 ? def.$compute.slice(0, 20) + "..." : def.$compute);
  if (def.$prototype === "Request") return def.method + " " + (def.url || "").slice(0, 20);
  if (def.$prototype === "LocalStorage" || def.$prototype === "SessionStorage")
    return def.key || "";
  if (def.$prototype === "IndexedDB") return def.database || "";
  if (def.$prototype === "Cookie") return def.name || "";
  if (def.$prototype) return def.$prototype;
  if (def.attribute) return `[${def.attribute}] ${def.type || ""}`;
  return def.type || "";
}

/** Whether the current document defines a custom element (hyphenated tagName). */
function isCustomElementDoc() {
  return (S.document.tagName || "").includes("-");
}

/** Recursively collect CSS `part` attributes from the document tree. */
function collectCssParts(node, parts = []) {
  if (node?.attributes?.part) parts.push({ name: node.attributes.part, tag: node.tagName || "div" });
  if (Array.isArray(node?.children)) node.children.forEach((c) => collectCssParts(c, parts));
  return parts;
}

/**
 * Resolve a $ref value to a display string using signal defaults.
 * Used by the canvas to show real values instead of raw refs.
 */
function resolveDefaultForCanvas(value, defs) {
  if (!value || typeof value !== "object" || !value.$ref) return value;
  const ref = value.$ref;
  let defName;
  if (ref.startsWith("#/state/")) defName = ref.slice(8);
  else if (ref.startsWith("$")) defName = ref;
  else return `{${ref}}`;

  const def = defs?.[defName];
  if (!def) return `{${defName}}`;

  // State signal → use default
  if (!def.$compute && !def.$prototype) {
    if (def.default !== undefined && def.default !== null) {
      if (typeof def.default === "object") return JSON.stringify(def.default);
      return String(def.default);
    }
    return "";
  }
  // Computed → expression indicator
  if (def.$compute) return `\u0192(${defName})`;
  // Request → URL hint
  if (def.$prototype === "Request") return `\u27F3 ${def.url || "fetch"}`;
  // Storage → use default or key
  if (def.$prototype === "LocalStorage" || def.$prototype === "SessionStorage") {
    if (def.default !== undefined && def.default !== null) {
      if (typeof def.default === "object") return JSON.stringify(def.default);
      return String(def.default);
    }
    return `[${def.key || "storage"}]`;
  }
  if (def.$prototype) return `{${def.$prototype}}`;
  return `{${defName}}`;
}

/**
 * Recursively render a JSONsx node to the canvas DOM.
 * Media-aware: applies base styles + active breakpoint/feature overrides.
 */
function renderCanvasNode(node, path, parent, activeBreakpoints, featureToggles) {
  if (!node || typeof node !== "object") return;

  const tag = node.tagName || "div";
  const el = document.createElement(tag);

  elToPath.set(el, path);

  if (typeof node.textContent === "string") {
    el.textContent = node.textContent;
  } else if (typeof node.textContent === "object" && node.textContent?.$ref) {
    const resolved = resolveDefaultForCanvas(node.textContent, S.document.state);
    el.textContent = resolved;
    el.style.opacity = "0.7";
    el.style.fontStyle = "italic";
    el.title = `Bound: ${node.textContent.$ref}`;
  }

  if (node.id) el.id = node.id;
  if (node.className) el.className = node.className;

  applyCanvasStyle(el, node.style, activeBreakpoints, featureToggles);

  if (node.attributes && typeof node.attributes === "object") {
    for (const [attr, val] of Object.entries(node.attributes)) {
      try {
        if (typeof val === "object" && val?.$ref) {
          const resolved = resolveDefaultForCanvas(val, S.document.state);
          el.setAttribute(attr, resolved);
        } else {
          el.setAttribute(attr, val);
        }
      } catch {}
    }
  }

  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      renderCanvasNode(
        node.children[i],
        [...path, "children", i],
        el,
        activeBreakpoints,
        featureToggles,
      );
    }
  } else if (node.children && typeof node.children === "object" && node.children.$prototype === "Array") {
    // Wrap the map template in a visual repeater perimeter
    const template = node.children.map;
    if (template && typeof template === "object") {
      const wrapper = document.createElement("div");
      wrapper.className = "repeater-perimeter";
      elToPath.set(wrapper, [...path, "children"]);
      renderCanvasNode(
        template,
        [...path, "children", "map"],
        wrapper,
        activeBreakpoints,
        featureToggles,
      );
      el.appendChild(wrapper);
    }
  }

  if (node.$switch && node.cases && typeof node.cases === "object") {
    // $switch placeholder in structural preview
    const keys = Object.keys(node.cases);
    const placeholder = document.createElement("div");
    placeholder.textContent = `[$switch: ${keys.join(" | ")}]`;
    placeholder.style.cssText = "font-family:monospace;font-size:11px;padding:6px 10px;background:color-mix(in srgb, var(--danger) 8%, transparent);border:1px dashed color-mix(in srgb, var(--danger) 40%, transparent);border-radius:4px;color:var(--danger);font-style:italic";
    el.appendChild(placeholder);
  }

  el.style.pointerEvents = "none";
  parent.appendChild(el);
  return el;
}

/** Track the last drag pointer position for canvas drop calculations */
let lastDragInput = null;

/**
 * Register all canvas elements in a panel as DnD drop targets.
 */
function registerPanelDnD(panel) {
  const { canvas, overlayClk, dropLine } = panel;
  const allEls = canvas.querySelectorAll("*");

  const monitorCleanup = monitorForElements({
    onDragStart() {
      for (const el of canvas.querySelectorAll("*")) {
        el.style.pointerEvents = "auto";
      }
      // Disable click layers on ALL panels during drag
      for (const p of canvasPanels) p.overlayClk.style.pointerEvents = "none";
    },
    onDrag({ location }) {
      lastDragInput = location.current.input;
    },
    onDrop() {
      // Hide all drop lines
      for (const p of canvasPanels) p.dropLine.style.display = "none";
      lastDragInput = null;
      for (const el of canvas.querySelectorAll("*")) {
        el.style.pointerEvents = "none";
      }
      for (const p of canvasPanels) p.overlayClk.style.pointerEvents = "";
    },
  });
  canvasDndCleanups.push(monitorCleanup);

  for (const el of allEls) {
    const elPath = elToPath.get(el);
    if (!elPath) continue;

    const node = getNodeAtPath(S.document, elPath);
    const isVoid = VOID_ELEMENTS.has((node?.tagName || "div").toLowerCase());

    const cleanup = dropTargetForElements({
      element: el,
      canDrop({ source }) {
        const srcPath = source.data.path;
        if (srcPath && isAncestor(srcPath, elPath)) return false;
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
    canvasDndCleanups.push(cleanup);
  }
}

function getCanvasDropInstruction(el, elPath, isVoid) {
  const rect = el.getBoundingClientRect();
  if (!lastDragInput) return null;
  const y = lastDragInput.clientY;
  const relY = (y - rect.top) / rect.height;

  if (elPath.length === 0) return { type: "make-child" };
  if (isVoid) return relY < 0.5 ? { type: "reorder-above" } : { type: "reorder-below" };
  if (relY < 0.25) return { type: "reorder-above" };
  if (relY > 0.75) return { type: "reorder-below" };
  return { type: "make-child" };
}

function showCanvasDropIndicator(el, elPath, isVoid, panel) {
  const instruction = getCanvasDropInstruction(el, elPath, isVoid);
  const { dropLine, viewport } = panel;
  if (!instruction) {
    dropLine.style.display = "none";
    return;
  }

  const wrapRect = viewport.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const left = elRect.left - wrapRect.left + viewport.scrollLeft;
  const width = elRect.width;

  if (instruction.type === "make-child") {
    dropLine.style.display = "block";
    dropLine.style.top = `${elRect.top - wrapRect.top + viewport.scrollTop}px`;
    dropLine.style.left = `${left}px`;
    dropLine.style.width = `${width}px`;
    dropLine.style.height = `${elRect.height}px`;
    dropLine.className = "canvas-drop-indicator inside";
    el.classList.add("canvas-drop-target");
    return;
  }

  el.classList.remove("canvas-drop-target");
  const top =
    instruction.type === "reorder-above"
      ? elRect.top - wrapRect.top + viewport.scrollTop
      : elRect.bottom - wrapRect.top + viewport.scrollTop;

  dropLine.style.display = "block";
  dropLine.style.top = `${top}px`;
  dropLine.style.left = `${left}px`;
  dropLine.style.width = `${width}px`;
  dropLine.style.height = "2px";
  dropLine.className = "canvas-drop-indicator line";
}

// ─── Overlay system ───────────────────────────────────────────────────────────

function renderOverlays() {
  // Clear all panel overlays
  for (const p of canvasPanels) {
    p.overlay.innerHTML = "";
    p.overlay.appendChild(p.dropLine);
  }

  // In non-interactive modes (except stylebook), hide overlays and click interceptors
  if (canvasMode !== "design" && canvasMode !== "edit" && canvasMode !== "stylebook") {
    for (const p of canvasPanels) {
      p.overlayClk.style.pointerEvents = "none";
    }
    if (selDragCleanup) {
      selDragCleanup();
      selDragCleanup = null;
    }
    return;
  }
  // Stylebook manages its own overlays
  if (canvasMode === "stylebook") {
    // Elements tab: enable click interceptor for hit-testing
    // Variables tab: disable it so form inputs are directly interactive
    const enable = S.ui.stylebookTab === "elements";
    for (const p of canvasPanels) {
      p.overlayClk.style.pointerEvents = enable ? "" : "none";
    }
    return;
  }
  for (const p of canvasPanels) {
    p.overlayClk.style.pointerEvents = componentInlineEdit ? "none" : "";
  }

  if (selDragCleanup) {
    selDragCleanup();
    selDragCleanup = null;
  }

  // Draw hover overlay on whichever panel the hover is on
  if (S.hover && !pathsEqual(S.hover, S.selection)) {
    for (const p of canvasPanels) {
      const el = findCanvasElement(S.hover, p.canvas);
      if (el) drawOverlayBox(el, "hover", p);
    }
  }

  // Draw selection overlay only on the active panel
  if (S.selection) {
    const activePanel = getActivePanel();
    if (activePanel) {
      const el = findCanvasElement(S.selection, activePanel.canvas);
      if (el) {
        const box = drawOverlayBox(el, "selection", activePanel);
        // During inline edit: show label only, hide selection border
        if (componentInlineEdit) {
          box.style.border = "none";
        }
        if (S.selection.length >= 2 && !componentInlineEdit) {
          const label = box.querySelector(".overlay-label");
          if (label) {
            const handle = document.createElement("span");
            handle.className = "overlay-drag-handle";
            handle.textContent = "\u2847";
            label.prepend(handle);

            const path = S.selection;
            selDragCleanup = draggable({
              element: handle,
              getInitialData() {
                return { type: "tree-node", path };
              },
            });
          }
        }
      }
    }
  }
}

function getActivePanel() {
  if (canvasPanels.length === 0) return null;
  if (canvasPanels.length === 1) return canvasPanels[0];
  for (const p of canvasPanels) {
    if (S.ui.activeMedia === null && (p.mediaName === "base" || p.mediaName === null)) return p;
    if (p.mediaName === S.ui.activeMedia) return p;
  }
  return canvasPanels[0];
}

// ── Pseudo-state preview ──────────────────────────────────────────────────────
// When a pseudo-selector (:hover, :focus, etc.) is active in the style sidebar,
// force those styles onto the selected element so the user can see the result.

let _forcedStyleTag = null;
let _forcedAttrEl = null;

function updateForcedPseudoPreview() {
  // Clean up previous
  if (_forcedStyleTag) { _forcedStyleTag.remove(); _forcedStyleTag = null; }
  if (_forcedAttrEl) { _forcedAttrEl.removeAttribute("data-studio-forced"); _forcedAttrEl = null; }

  const sel = S.ui?.activeSelector;
  if (!sel || !sel.startsWith(":") || !S.selection) return;

  const panel = getActivePanel();
  if (!panel) return;
  const el = findCanvasElement(S.selection, panel.canvas);
  if (!el) return;

  // Read the nested style object for this selector
  const node = getNodeAtPath(S.document, S.selection);
  if (!node?.style) return;
  const activeTab = S.ui.activeMedia;
  const ctx = activeTab ? (node.style[`@${activeTab}`] || {}) : node.style;
  const rules = ctx[sel];
  if (!rules || typeof rules !== "object") return;

  // Build CSS text from the rules
  const cssProps = Object.entries(rules)
    .filter(([k]) => typeof rules[k] === "string" || typeof rules[k] === "number")
    .map(([k, v]) => `${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}: ${v} !important`)
    .join("; ");
  if (!cssProps) return;

  el.setAttribute("data-studio-forced", "1");
  _forcedAttrEl = el;

  const tag = document.createElement("style");
  tag.textContent = `[data-studio-forced] { ${cssProps} }`;
  document.head.appendChild(tag);
  _forcedStyleTag = tag;
}

/** Effective zoom scale — always 1 in edit (content) mode, S.ui.zoom otherwise. */
function effectiveZoom() {
  return canvasMode === "edit" ? 1 : S.ui.zoom;
}

function drawOverlayBox(el, type, panel) {
  const vpRect = panel.viewport.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const scale = effectiveZoom();

  const box = document.createElement("div");
  box.className = `overlay-box overlay-${type}`;
  box.style.top = `${(elRect.top - vpRect.top + panel.viewport.scrollTop) / scale}px`;
  box.style.left = `${(elRect.left - vpRect.left + panel.viewport.scrollLeft) / scale}px`;
  box.style.width = `${elRect.width / scale}px`;
  box.style.height = `${elRect.height / scale}px`;

  if (type === "selection") {
    const node = getNodeAtPath(S.document, S.selection);
    const label = document.createElement("div");
    label.className = "overlay-label";
    label.textContent = nodeLabel(node);
    box.appendChild(label);
  }

  panel.overlay.appendChild(box);
  return box;
}

function findCanvasElement(path, canvasEl) {
  let el = canvasEl.firstElementChild;
  if (!el) return null;
  if (path.length === 0) return el;

  for (let i = 0; i < path.length; i += 2) {
    if (path[i] !== "children" && path[i] !== "cases") return null;
    const idx = path[i + 1];
    if (idx === undefined) {
      // Odd-length path like ['children', 2, 'children'] — $map container
      // The wrapper div is children[0] of the current element
      el = el.children[0];
    } else if (idx === "map") {
      // $map template: wrapper is children[0], template is wrapper.children[0]
      el = el.children[0]?.children[0];
    } else {
      el = el.children[idx];
    }
    if (!el) return null;
  }
  return el;
}

// ─── Per-panel click-to-select ────────────────────────────────────────────────

function registerPanelEvents(panel) {
  const { canvas, overlayClk, mediaName } = panel;

  function withPanelPointerEvents(fn) {
    const els = canvas.querySelectorAll("*");
    for (const el of els) el.style.pointerEvents = "auto";
    overlayClk.style.display = "none";
    const result = fn();
    overlayClk.style.display = "";
    for (const el of els) el.style.pointerEvents = "none";
    return result;
  }

  // During component inline edit, the overlayClk is disabled (see enterComponentInlineEdit).
  // No mousedown passthrough needed — native events reach the contenteditable directly.

  overlayClk.addEventListener("click", (e) => {
    // If content-mode inline editing is active, treat click outside as blur
    if (isEditing()) {
      stopEditing();
    }

    // Component-mode inline editing is handled by its own document-level listener
    // (see enterComponentInlineEdit), so nothing to do here — just fall through.

    const elements = withPanelPointerEvents(() => document.elementsFromPoint(e.clientX, e.clientY));

    for (const el of elements) {
      if (canvas.contains(el) && el !== canvas) {
        const path = elToPath.get(el);
        if (path) {
          const newMedia = mediaName === "base" ? null : (mediaName ?? null);
          S = { ...S, ui: { ...S.ui, activeMedia: newMedia } };

          // In content mode: if clicking an already-selected editable block, enter inline editing
          if (S.mode === "content" && pathsEqual(path, S.selection) && isEditableBlock(el)) {
            enterInlineEdit(el, path);
            return;
          }

          // Component/JSON mode: select and schedule inline editing after render completes
          if (S.mode !== "content") {
            pendingInlineEdit = { path, mediaName };
            update(selectNode(S, path));
            return;
          }

          update(selectNode(S, path));
          return;
        }
      }
    }
    update(selectNode(S, null));
  });

  // Double-click shortcut for immediate inline editing in content mode
  overlayClk.addEventListener("dblclick", (e) => {
    if (S.mode !== "content") return;

    const elements = withPanelPointerEvents(() => document.elementsFromPoint(e.clientX, e.clientY));

    for (const el of elements) {
      if (canvas.contains(el) && el !== canvas) {
        const path = elToPath.get(el);
        if (path && isEditableBlock(el)) {
          const newMedia = mediaName === "base" ? null : (mediaName ?? null);
          S = { ...S, ui: { ...S.ui, activeMedia: newMedia } };
          update(selectNode(S, path));
          enterInlineEdit(el, path);
          return;
        }
      }
    }
  });

  overlayClk.addEventListener("contextmenu", (e) => {
    const elements = withPanelPointerEvents(() => document.elementsFromPoint(e.clientX, e.clientY));
    for (const el of elements) {
      if (canvas.contains(el) && el !== canvas) {
        const path = elToPath.get(el);
        if (path) {
          showContextMenu(e, path);
          return;
        }
      }
    }
    e.preventDefault();
  });

  overlayClk.addEventListener("mousemove", (e) => {
    const el = withPanelPointerEvents(() => document.elementFromPoint(e.clientX, e.clientY));
    if (el && canvas.contains(el) && el !== canvas) {
      const path = elToPath.get(el);
      if (path && !pathsEqual(path, S.hover)) {
        S = hoverNode(S, path);
        renderOverlays();
      }
    } else if (S.hover) {
      S = hoverNode(S, null);
      renderOverlays();
    }
  });

  overlayClk.addEventListener("mouseleave", () => {
    if (S.hover) {
      S = hoverNode(S, null);
      renderOverlays();
    }
  });
}

// ─── Inline editing bridge ────────────────────────────────────────────────────

/**
 * Enter inline editing mode on a canvas element.
 * Hides the overlay for the element and makes it contenteditable.
 */
function enterInlineEdit(el, path) {
  // Hide overlays while editing
  for (const p of canvasPanels) {
    p.overlay.style.display = "none";
    p.overlayClk.style.pointerEvents = "none";
  }

  startEditing(el, path, {
    onCommit(commitPath, children, textContent) {
      // Update the JSONsx node with the edited content
      if (children) {
        let s = updateProperty(S, commitPath, "textContent", undefined);
        s = updateProperty(s, commitPath, "children", children);
        update(s);
      } else if (textContent != null) {
        let s = updateProperty(S, commitPath, "children", undefined);
        s = updateProperty(s, commitPath, "textContent", textContent);
        update(s);
      }
    },

    onSplit(splitPath, before, after) {
      // Update current element with "before" content
      const tag = getNodeAtPath(S.document, splitPath)?.tagName ?? "p";
      let s = S;

      if (before.textContent != null) {
        s = updateProperty(s, splitPath, "children", undefined);
        s = updateProperty(s, splitPath, "textContent", before.textContent);
      } else if (before.children) {
        s = updateProperty(s, splitPath, "textContent", undefined);
        s = updateProperty(s, splitPath, "children", before.children);
      }

      // Insert new element after with "after" content
      const parentPath = parentElementPath(splitPath);
      const idx = childIndex(splitPath);
      const newNode = { tagName: tag };
      if (after.textContent != null) {
        newNode.textContent = after.textContent;
      } else if (after.children) {
        newNode.children = after.children;
      } else {
        newNode.textContent = "";
      }

      s = insertNode(s, parentPath, idx + 1, newNode);
      // Select the new element
      const newPath = [...parentPath, "children", idx + 1];
      s = selectNode(s, newPath);
      update(s);

      // Re-enter editing on the new element after render
      requestAnimationFrame(() => {
        const activePanel = getActivePanel();
        if (activePanel) {
          const newEl = findCanvasElement(newPath, activePanel.canvas);
          if (newEl && isEditableBlock(newEl)) {
            enterInlineEdit(newEl, newPath);
            // Place cursor at start of new element
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(newEl);
            range.collapse(true); // collapse to start
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      });
    },

    onInsert(afterPath, elementDef) {
      const parentPath = parentElementPath(afterPath);
      const idx = childIndex(afterPath);
      let s = insertNode(S, parentPath, idx + 1, structuredClone(elementDef));
      const newPath = [...parentPath, "children", idx + 1];
      s = selectNode(s, newPath);
      update(s);

      // If the inserted element is editable, enter editing
      requestAnimationFrame(() => {
        const activePanel = getActivePanel();
        if (activePanel) {
          const newEl = findCanvasElement(newPath, activePanel.canvas);
          if (newEl && isEditableBlock(newEl)) {
            enterInlineEdit(newEl, newPath);
          }
        }
      });
    },

    onEnd() {
      // Restore overlays after inline editing ends
      for (const p of canvasPanels) {
        p.overlay.style.display = "";
        p.overlayClk.style.pointerEvents = "";
      }
      renderOverlays();
    },
  });
}

// ─── Component-mode inline text editing ──────────────────────────────────────

function enterComponentInlineEdit(el, path) {
  // Already editing this element
  if (componentInlineEdit && componentInlineEdit.el === el) {
    return;
  }

  const node = getNodeAtPath(S.document, path);
  if (!node) return;

  // Skip nodes that shouldn't be inline-edited
  const tc = node.textContent;
  if (node.$props && (node.tagName || "").includes("-")) return;
  if (Array.isArray(node.children) && node.children.length > 0) return;
  if (node.children && typeof node.children === "object") return;
  if (tc && typeof tc === "object") return;
  const voids = new Set(["img", "input", "br", "hr", "video", "audio", "source", "embed"]);
  if (voids.has(node.tagName)) return;

  // Keep overlay visible for the label, but hide selection border to not obscure editing outline.
  // Disable click interceptor so native contenteditable handles all mouse interaction.
  for (const p of canvasPanels) {
    const boxes = p.overlay.querySelectorAll(".overlay-box");
    for (const box of boxes) {
      box.style.border = "none";
    }
    p.overlayClk.style.pointerEvents = "none";
  }

  el.contentEditable = "plaintext-only";
  el.style.pointerEvents = "auto"; // required for caretRangeFromPoint hit-testing
  el.style.cursor = "text";
  el.style.outline = "1px solid var(--accent, #4f8bc7)";
  el.style.outlineOffset = "-1px";
  el.style.minHeight = "1em";

  // Show raw textContent (not the ❮...❯ display transform)
  const rawText = typeof tc === "string" ? tc : "";
  el.textContent = rawText;

  componentInlineEdit = {
    el, path, originalText: rawText,
    mediaName: canvasPanels.find(p => p.canvas.contains(el))?.mediaName || null,
  };

  // Focus and place cursor at end
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  el.addEventListener("keydown", componentInlineKeydown);
  el.addEventListener("input", componentInlineInput);

  // Document-level mousedown: clicking outside the editing element commits
  // the edit and selects the new target element for inline editing.
  const outsideHandler = (evt) => {
    if (!componentInlineEdit) { document.removeEventListener("mousedown", outsideHandler, true); return; }
    if (componentInlineEdit.el.contains(evt.target)) return; // click within editing el — let it through
    // Let clicks inside the slash command menu through
    if (componentSlashMenu && componentSlashMenu.contains(evt.target)) return;
    document.removeEventListener("mousedown", outsideHandler, true);

    // Hit-test BEFORE commit (while the current canvas DOM + elToPath are still valid)
    let hitPath = null, hitMedia = null;
    for (const p of canvasPanels) {
      const els = p.canvas.querySelectorAll("*");
      for (const el of els) el.style.pointerEvents = "auto";
      p.overlayClk.style.display = "none";
      const found = document.elementsFromPoint(evt.clientX, evt.clientY);
      p.overlayClk.style.display = "";
      for (const el of els) el.style.pointerEvents = "none";
      for (const hit of found) {
        if (p.canvas.contains(hit) && hit !== p.canvas) {
          const path = elToPath.get(hit);
          if (path) {
            hitPath = path;
            hitMedia = p.mediaName;
            break;
          }
        }
      }
      if (hitPath) break;
    }

    // Commit + select new element in a single state update if possible
    const { el: editEl, path: editPath, originalText } = componentInlineEdit;
    const newText = (editEl.textContent ?? "").trim();
    cleanupComponentInlineEdit(editEl);

    // If empty, remove the node entirely
    const isEmpty = !newText;
    const pPath = parentElementPath(editPath);

    if (hitPath) {
      const media = hitMedia === "base" ? null : (hitMedia ?? null);
      pendingInlineEdit = { path: hitPath, mediaName: hitMedia };
      S = { ...S, ui: { ...S.ui, activeMedia: media } };
      if (isEmpty && pPath) {
        // Remove empty node; adjust hitPath if it shifts after removal
        let s = removeNode(S, editPath);
        // If hit path is a later sibling in the same parent, adjust index
        const removedIdx = childIndex(editPath);
        const hitIdx = childIndex(hitPath);
        const hitParent = parentElementPath(hitPath);
        if (hitParent && pPath && hitParent.join("/") === pPath.join("/") && hitIdx > removedIdx) {
          hitPath = [...pPath, "children", hitIdx - 1];
          pendingInlineEdit = { path: hitPath, mediaName: hitMedia };
        }
        update(selectNode(s, hitPath));
      } else if (newText !== originalText) {
        update(selectNode(updateProperty(S, editPath, "textContent", newText || undefined), hitPath));
      } else {
        update(selectNode(S, hitPath));
      }
    } else {
      // Clicked on empty space — just commit
      if (isEmpty && pPath) {
        update(removeNode(S, editPath));
      } else if (newText !== originalText) {
        update(updateProperty(S, editPath, "textContent", newText || undefined));
      } else {
        renderCanvas();
        renderOverlays();
      }
    }
  };
  document.addEventListener("mousedown", outsideHandler, true);
  componentInlineEdit._outsideHandler = outsideHandler;
}

function componentInlineKeydown(e) {
  // When slash menu is open, delegate navigation keys
  if (componentSlashMenu) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const items = [...componentSlashMenu.querySelectorAll("sp-menu-item")];
      if (!items.length) return;
      let idx = componentSlashMenu._activeIdx ?? 0;
      if (e.key === "ArrowDown") idx = (idx + 1) % items.length;
      else idx = (idx - 1 + items.length) % items.length;
      componentSlashMenu._activeIdx = idx;
      for (const it of items) it.removeAttribute("focused");
      items[idx].setAttribute("focused", "");
      items[idx].scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const items = [...componentSlashMenu.querySelectorAll("sp-menu-item")];
      const idx = componentSlashMenu._activeIdx ?? 0;
      if (items[idx]?._cmd) selectComponentSlashItem(items[idx]._cmd);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismissComponentSlashMenu();
      return;
    }
  }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    splitParagraph();
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancelComponentInlineEdit();
  }
  e.stopPropagation(); // prevent studio keyboard shortcuts
}

function splitParagraph() {
  if (!componentInlineEdit) return;
  const { el, path, mediaName } = componentInlineEdit;

  // Determine cursor offset within text
  const sel = el.ownerDocument.defaultView.getSelection();
  const fullText = el.textContent || "";
  let offset = fullText.length;
  if (sel.rangeCount) {
    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.startContainer, range.startOffset);
    offset = preRange.toString().length;
  }

  const textBefore = fullText.slice(0, offset);
  const textAfter = fullText.slice(offset);

  // Get node info for building the new sibling
  const node = getNodeAtPath(S.document, path);
  const tag = node?.tagName || "p";
  const pPath = parentElementPath(path);
  const idx = childIndex(path);
  if (!pPath) return; // can't split root

  const newDef = { tagName: tag, textContent: textAfter };
  const newPath = [...pPath, "children", idx + 1];

  cleanupComponentInlineEdit(el);

  // Compound mutation: update current text + insert sibling + select new
  let s = updateProperty(S, path, "textContent", textBefore || undefined);
  s = insertNode(s, pPath, idx + 1, newDef);
  s = selectNode(s, newPath);

  pendingInlineEdit = { path: newPath, mediaName };
  update(s);
}

function commitComponentInlineEdit() {
  if (!componentInlineEdit) return;
  const { el, path, originalText } = componentInlineEdit;
  const newText = (el.textContent ?? "").trim();

  cleanupComponentInlineEdit(el);

  // If empty, remove the node entirely
  const pPath = parentElementPath(path);
  if (!newText && pPath) {
    update(removeNode(S, path));
  } else if (newText !== originalText) {
    update(updateProperty(S, path, "textContent", newText || undefined));
  } else {
    renderCanvas();
    renderOverlays();
  }
}

function cancelComponentInlineEdit() {
  if (!componentInlineEdit) return;
  const { el } = componentInlineEdit;
  cleanupComponentInlineEdit(el);
  renderCanvas();
  renderOverlays();
}

function cleanupComponentInlineEdit(el) {
  el.removeEventListener("keydown", componentInlineKeydown);
  el.removeEventListener("input", componentInlineInput);
  dismissComponentSlashMenu();
  el.removeAttribute("contenteditable");
  el.style.cursor = "";
  el.style.outline = "";
  el.style.outlineOffset = "";
  el.style.minHeight = "";
  el.style.pointerEvents = "";

  // Remove the document-level outside-click handler
  if (componentInlineEdit?._outsideHandler) {
    document.removeEventListener("mousedown", componentInlineEdit._outsideHandler, true);
  }
  componentInlineEdit = null;

  // Restore overlay and click interceptor
  for (const p of canvasPanels) {
    p.overlay.style.display = "";
    p.overlayClk.style.pointerEvents = "";
  }
}

// ─── Component-mode slash commands ───────────────────────────────────────────

const COMPONENT_SLASH_COMMANDS = [
  { label: "Heading 1", tag: "h1", icon: "H1", description: "Large heading" },
  { label: "Heading 2", tag: "h2", icon: "H2", description: "Medium heading" },
  { label: "Heading 3", tag: "h3", icon: "H3", description: "Small heading" },
  { label: "Paragraph", tag: "p", icon: "\u00B6", description: "Plain text" },
  { label: "Unordered List", tag: "ul", icon: "\u2022", description: "Bulleted list" },
  { label: "Ordered List", tag: "ol", icon: "1.", description: "Numbered list" },
  { label: "Blockquote", tag: "blockquote", icon: "\u275D", description: "Quote block" },
  { label: "Image", tag: "img", icon: "\uD83D\uDDBC", description: "Insert image" },
  { label: "Horizontal Rule", tag: "hr", icon: "\u2014", description: "Divider line" },
  { label: "Button", tag: "button", icon: "\u25A2", description: "Button element" },
  { label: "Link", tag: "a", icon: "\uD83D\uDD17", description: "Anchor link" },
  { label: "Code Block", tag: "pre", icon: "<>", description: "Preformatted code" },
  { label: "Div", tag: "div", icon: "\u2610", description: "Container" },
  { label: "Section", tag: "section", icon: "\u00A7", description: "Section container" },
];

function componentInlineInput() {
  if (!componentInlineEdit) return;
  const { el, originalText } = componentInlineEdit;
  const text = el.textContent || "";

  // Only trigger slash menu when the paragraph was originally empty and starts with /
  if (originalText === "" && text.startsWith("/")) {
    const filter = text.slice(1).toLowerCase();
    showComponentSlashMenu(el, filter);
  } else {
    dismissComponentSlashMenu();
  }
}

function showComponentSlashMenu(el, filter) {
  dismissComponentSlashMenu();

  const items = filter
    ? COMPONENT_SLASH_COMMANDS.filter(
        (c) => c.label.toLowerCase().includes(filter) || c.tag.toLowerCase().includes(filter),
      )
    : COMPONENT_SLASH_COMMANDS;

  if (!items.length) return;

  const rect = el.getBoundingClientRect();

  const popover = document.createElement("sp-popover");
  popover.open = true;
  popover.placement = "bottom-start";
  popover.style.position = "fixed";
  popover.style.left = `${rect.left}px`;
  popover.style.top = `${rect.bottom + 4}px`;
  popover.style.zIndex = "9999";
  popover.style.maxHeight = "280px";
  popover.style.overflowY = "auto";

  const menu = document.createElement("sp-menu");
  menu.style.minWidth = "220px";

  for (let i = 0; i < items.length; i++) {
    const cmd = items[i];
    const mi = document.createElement("sp-menu-item");
    mi.textContent = cmd.label;
    mi._cmd = cmd;
    if (cmd.description) {
      const desc = document.createElement("span");
      desc.slot = "description";
      desc.textContent = cmd.description;
      mi.appendChild(desc);
    }
    if (i === 0) mi.setAttribute("focused", "");
    mi.addEventListener("click", () => selectComponentSlashItem(cmd));
    menu.appendChild(mi);
  }

  popover.appendChild(menu);
  (document.querySelector("sp-theme") || document.body).appendChild(popover);
  popover._activeIdx = 0;
  componentSlashMenu = popover;
}

function dismissComponentSlashMenu() {
  if (!componentSlashMenu) return;
  componentSlashMenu.remove();
  componentSlashMenu = null;
}

function selectComponentSlashItem(cmd) {
  if (!componentInlineEdit) return;
  const { el, path, mediaName } = componentInlineEdit;
  const pPath = parentElementPath(path);
  const idx = childIndex(path);
  if (!pPath) return;

  dismissComponentSlashMenu();
  cleanupComponentInlineEdit(el);

  const newDef = defaultDef(cmd.tag);
  const newPath = [...pPath, "children", idx];

  // Replace current empty paragraph with the chosen element
  let s = removeNode(S, path);
  s = insertNode(s, pPath, idx, newDef);
  s = selectNode(s, newPath);

  // If the new element has textContent, enter inline edit on it
  const hasText = newDef.textContent != null;
  if (hasText) pendingInlineEdit = { path: newPath, mediaName };
  update(s);
}

// ─── Activity bar ────────────────────────────────────────────────────────────

function tabIcon(tag, size) {
  const m = {
    "sp-icon-folder": (s) => html`<sp-icon-folder slot="icon" size=${s}></sp-icon-folder>`,
    "sp-icon-layers": (s) => html`<sp-icon-layers slot="icon" size=${s}></sp-icon-layers>`,
    "sp-icon-view-grid": (s) => html`<sp-icon-view-grid slot="icon" size=${s}></sp-icon-view-grid>`,
    "sp-icon-brackets": (s) => html`<sp-icon-brackets slot="icon" size=${s}></sp-icon-brackets>`,
    "sp-icon-data": (s) => html`<sp-icon-data slot="icon" size=${s}></sp-icon-data>`,
    "sp-icon-properties": (s) => html`<sp-icon-properties slot="icon" size=${s}></sp-icon-properties>`,
    "sp-icon-event": (s) => html`<sp-icon-event slot="icon" size=${s}></sp-icon-event>`,
    "sp-icon-brush": (s) => html`<sp-icon-brush slot="icon" size=${s}></sp-icon-brush>`,
    "sp-icon-artboard": (s) => html`<sp-icon-artboard slot="icon" size=${s}></sp-icon-artboard>`,
  };
  const fn = m[tag];
  return fn ? fn(size || "s") : nothing;
}

function renderActivityBar() {
  const tabs = [
    { value: "files",  icon: "sp-icon-folder",    label: "Files" },
    { value: "layers", icon: "sp-icon-layers",     label: "Layers" },
    { value: "blocks", icon: "sp-icon-view-grid",  label: "Blocks" },
    { value: "state",  icon: "sp-icon-brackets",   label: "State" },
    { value: "data",   icon: "sp-icon-data",       label: "Data" },
  ];
  const tpl = html`
    <sp-tabs selected=${S.ui.leftTab} direction="vertical" quiet
      @change=${(e) => {
        S = { ...S, ui: { ...S.ui, leftTab: e.target.selected } };
        renderActivityBar();
        renderLeftPanel();
      }}>
      ${tabs.map((t) => html`
        <sp-tab value=${t.value} title=${t.label} aria-label=${t.label}>
          ${tabIcon(t.icon, "m")}
        </sp-tab>
      `)}
    </sp-tabs>
  `;
  litRender(tpl, activityBar);
}

// ─── Left panel: Layers ───────────────────────────────────────────────────────

function renderLeftPanel() {
  const tab = S.ui.leftTab;
  leftPanel.innerHTML = "";

  const body = document.createElement("div");
  body.className = "panel-body";
  leftPanel.appendChild(body);

  if (tab === "files") renderFiles(body);
  else if (tab === "layers") {
    if (canvasMode === "stylebook") renderStylebookLayers(body);
    else renderLayers(body);
  }
  else if (tab === "blocks") renderBlocks(body);
  else if (tab === "state") renderSignals(body);
  else if (tab === "data") renderDataExplorer(body);
}

function renderComponentGroup(container, label, components, collapsed, isImported) {
  const header = document.createElement("div");
  header.className = `blocks-category${collapsed.has(label) ? " collapsed" : ""}`;
  header.textContent = `${label} (${components.length})`;
  header.onclick = () => {
    if (collapsed.has(label)) collapsed.delete(label);
    else collapsed.add(label);
    renderLeftPanel();
  };
  container.appendChild(header);
  if (collapsed.has(label)) return;

  for (const comp of components) {
    const row = document.createElement("div");
    row.className = `layer-row component-row${isImported ? "" : " available"}`;

    const icon = document.createElement("span");
    icon.className = "layer-tag component-tag";
    icon.textContent = "⬡";
    icon.style.background = isImported ? "var(--accent)" : "var(--bg-alt)";
    row.appendChild(icon);

    const lbl = document.createElement("span");
    lbl.className = "layer-label";
    lbl.textContent = comp.tagName;
    lbl.title = comp.path;
    row.appendChild(lbl);

    if (comp.$id) {
      const hint = document.createElement("span");
      hint.className = "signal-hint";
      hint.textContent = comp.$id;
      row.appendChild(hint);
    }

    row.onclick = () => navigateToComponent(comp.path);

    // Make draggable for instance insertion
    const instanceDef = {
      tagName: comp.tagName,
      $props: Object.fromEntries(
        comp.props.map((p) => [p.name, p.default !== undefined ? p.default : ""]),
      ),
    };
    const cleanup = draggable({
      element: row,
      getInitialData() {
        return { type: "block", fragment: structuredClone(instanceDef) };
      },
    });
    dndCleanups.push(cleanup);

    container.appendChild(row);
  }
}

function renderStylebookLayers(container) {
  const rootStyle = S.document?.style || {};
  const selectedTag = S.ui.stylebookSelection;

  if (S.ui.stylebookTab === "elements") {
    for (const section of stylebookMeta.$sections) {
      for (const entry of section.elements) {
        const row = document.createElement("div");
        row.className = `layer-row${entry.tag === selectedTag ? " selected" : ""}`;

        const badge = document.createElement("span");
        badge.className = "layer-tag";
        badge.textContent = entry.tag;
        row.appendChild(badge);

        const lbl = document.createElement("span");
        lbl.className = "layer-label";
        lbl.textContent = entry.text || `<${entry.tag}>`;
        lbl.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1";
        row.appendChild(lbl);

        if (hasTagStyle(rootStyle, entry.tag)) {
          const dot = document.createElement("span");
          dot.style.cssText = "width:6px;height:6px;border-radius:50%;background:var(--accent);flex-shrink:0";
          row.appendChild(dot);
        }

        row.onclick = () => {
          S = {
            ...S,
            selection: [],
            ui: { ...S.ui, stylebookSelection: entry.tag, rightTab: "style", activeSelector: `& ${entry.tag}` },
          };
          renderStylebookOverlays();
          renderRightPanel();
          renderLeftPanel();
          renderToolbar();
          // Scroll element into view on the canvas
          if (canvasPanels.length > 0) {
            const el = findStylebookEl(canvasPanels[0].canvas, entry.tag);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        };

        container.appendChild(row);
      }
    }
    // Custom components
    for (const comp of componentRegistry) {
      const row = document.createElement("div");
      row.className = `layer-row${comp.tagName === selectedTag ? " selected" : ""}`;

      const badge = document.createElement("span");
      badge.className = "layer-tag component-tag";
      badge.textContent = "⬡";
      badge.style.background = "var(--accent)";
      row.appendChild(badge);

      const lbl = document.createElement("span");
      lbl.className = "layer-label";
      lbl.textContent = comp.tagName;
      row.appendChild(lbl);

      row.onclick = () => {
        S = {
          ...S,
          selection: [],
          ui: { ...S.ui, stylebookSelection: comp.tagName, rightTab: "style", activeSelector: `& ${comp.tagName}` },
        };
        renderStylebookOverlays();
        renderRightPanel();
        renderLeftPanel();
        renderToolbar();
      };

      container.appendChild(row);
    }
  } else {
    // Variables tab — list variable names
    const style = rootStyle;
    for (const [k, v] of Object.entries(style)) {
      if (!k.startsWith("--")) continue;
      const row = document.createElement("div");
      row.className = "layer-row";

      const badge = document.createElement("span");
      badge.className = "layer-tag";
      badge.style.cssText = "font-size:10px;font-family:'SF Mono','Fira Code',monospace";
      badge.textContent = "var";
      row.appendChild(badge);

      const lbl = document.createElement("span");
      lbl.className = "layer-label";
      lbl.textContent = k;
      row.appendChild(lbl);

      const preview = document.createElement("span");
      preview.style.cssText = "font-size:11px;color:var(--fg-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px";
      preview.textContent = String(v);
      row.appendChild(preview);

      container.appendChild(row);
    }
    if (Object.keys(style).filter((k) => k.startsWith("--")).length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:16px;text-align:center;color:var(--fg-dim);font-size:12px";
      empty.textContent = "No variables defined";
      container.appendChild(empty);
    }
  }
}

function renderLayers(container) {
  // Clean up previous DnD registrations
  for (const fn of dndCleanups) fn();
  dndCleanups = [];

  const rows = flattenTree(S.document);
  /** @type {Set<string>} */
  const collapsed = S._collapsed || (S._collapsed = new Set());

  // Drop indicator line (positioned absolutely within container)
  container.style.position = "relative";
  const dropLine = document.createElement("div");
  dropLine.className = "drop-indicator";
  container.appendChild(dropLine);

  // ─── Components accordion ──────────────────────────────────────────────
  if (componentRegistry.length > 0) {
    const compCollapsed = S._collapsedComponents || (S._collapsedComponents = new Set(["Available"]));
    const importedRefs = new Set(
      (S.document.$elements || []).filter((e) => e.$ref).map((e) => e.$ref),
    );

    const imported = componentRegistry.filter((c) =>
      importedRefs.has(`./${c.path}`) || importedRefs.has(c.path) ||
      Array.from(importedRefs).some((ref) => ref.endsWith(c.path.split("/").pop())),
    );
    const available = componentRegistry.filter((c) => !imported.includes(c));

    const section = document.createElement("div");
    section.className = "components-section";

    if (imported.length > 0) renderComponentGroup(section, "Imported", imported, compCollapsed, true);
    if (available.length > 0) renderComponentGroup(section, "Available", available, compCollapsed, false);

    container.appendChild(section);

    const sep = document.createElement("div");
    sep.style.cssText = "border-bottom:1px solid var(--border);margin:4px 0";
    container.appendChild(sep);
  }

  for (const { node, path, depth, nodeType } of rows) {
    // Check if any ancestor is collapsed
    let hidden = false;
    for (let d = 1; d <= path.length; d++) {
      const sub = path.slice(0, d);
      if (d < path.length && collapsed.has(pathKey(sub))) {
        hidden = true;
        break;
      }
    }
    if (hidden) continue;

    // In content mode, skip inline elements (they're part of the parent text block)
    if (S.mode === "content" && path.length > 0 && nodeType === "element" && isInlineElement(node)) continue;

    const row = document.createElement("div");
    row.className = `layer-row${pathsEqual(path, S.selection) ? " selected" : ""}`;
    row.dataset.path = pathKey(path);

    // Drag handle (not for virtual map/case rows)
    const handle = document.createElement("span");
    handle.className = "layer-handle";
    if (nodeType === "element") {
      handle.textContent = "⠿";
    }
    row.appendChild(handle);

    // Indent
    const indent = document.createElement("span");
    indent.className = "layer-indent";
    indent.style.width = `${depth * 16}px`;
    row.appendChild(indent);

    // Collapse toggle
    const toggle = document.createElement("span");
    toggle.className = "layer-toggle";
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const hasMapChildren = node.children && typeof node.children === "object" && node.children.$prototype === "Array";
    const hasCases = node.$switch && node.cases && typeof node.cases === "object" && Object.keys(node.cases).length > 0;
    const isExpandable = hasChildren || hasMapChildren || hasCases || (nodeType === "map" && node.map);
    const key = pathKey(path);
    if (isExpandable) {
      const chevron = collapsed.has(key)
        ? document.createElement("sp-icon-chevron-right")
        : document.createElement("sp-icon-chevron-down");
      toggle.appendChild(chevron);
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        renderLeftPanel();
      });
    }
    row.appendChild(toggle);

    // Tag badge — different per nodeType
    const badge = document.createElement("span");
    if (nodeType === "map") {
      badge.className = "layer-tag map-tag";
      badge.textContent = "↻";
      badge.title = "Repeater (mapped array)";
    } else if (nodeType === "case" || nodeType === "case-ref") {
      badge.className = "layer-tag case-tag";
      badge.textContent = path[path.length - 1];
      badge.title = `$switch case: ${path[path.length - 1]}`;
    } else if (node.$switch) {
      badge.className = "layer-tag switch-tag";
      badge.textContent = "⇄";
      badge.title = "$switch";
    } else {
      badge.className = "layer-tag";
      badge.textContent = node.tagName || "div";
    }
    row.appendChild(badge);

    // Label
    const label = document.createElement("span");
    label.className = "layer-label";
    if (nodeType === "case-ref") {
      label.textContent = node.$ref || "external";
      label.style.fontStyle = "italic";
    } else {
      label.textContent = nodeLabel(node);
    }
    row.appendChild(label);

    // Delete button (not for root, and not for virtual map/case rows)
    if (path.length >= 2 && nodeType === "element") {
      const del = document.createElement("sp-action-button");
      del.setAttribute("quiet", "");
      del.setAttribute("size", "xs");
      del.className = "layer-delete";
      del.title = "Delete";
      const delIcon = document.createElement("sp-icon-close");
      delIcon.setAttribute("slot", "icon");
      del.appendChild(delIcon);
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        update(removeNode(S, path));
      });
      row.appendChild(del);
    }

    row.onclick = () => update(selectNode(S, path));
    if (nodeType === "element") row.oncontextmenu = (e) => showContextMenu(e, path);
    container.appendChild(row);

    // ─── Register draggable + drop target (element rows only) ────────────────
    if (nodeType !== "element") continue;
    const rowPath = path; // capture for closures
    const rowDepth = depth;
    const rowNode = node;

    const cleanup = combine(
      draggable({
        element: row,
        dragHandle: handle,
        getInitialData() {
          return { type: "tree-node", path: rowPath };
        },
        onDragStart() {
          row.classList.add("dragging");
        },
        onDrop() {
          row.classList.remove("dragging");
        },
      }),
      dropTargetForElements({
        element: row,
        canDrop({ source }) {
          const srcPath = source.data.path;
          // Can't drop onto self or descendant
          if (srcPath && isAncestor(srcPath, rowPath)) return false;
          return true;
        },
        getData({ input, element }) {
          return attachInstruction(
            { path: rowPath },
            {
              input,
              element,
              currentLevel: rowDepth,
              indentPerLevel: 16,
              block: isVoid ? ["make-child"] : [],
            },
          );
        },
        onDragEnter({ self }) {
          showDropIndicator(row, self.data, rowDepth, container);
        },
        onDrag({ self }) {
          showDropIndicator(row, self.data, rowDepth, container);
        },
        onDragLeave() {
          dropLine.style.display = "none";
          row.classList.remove("drop-target");
        },
        onDrop() {
          dropLine.style.display = "none";
          row.classList.remove("drop-target");
        },
      }),
    );
    dndCleanups.push(cleanup);
  }

  // ─── Global monitor: apply the drop ────────────────────────
  const monitorCleanup = monitorForElements({
    onDrop({ source, location }) {
      dropLine.style.display = "none";
      const target = location.current.dropTargets[0];
      if (!target) return;

      const instruction = extractInstruction(target.data);
      if (!instruction || instruction.type === "instruction-blocked") return;

      const srcData = source.data;
      const targetPath = target.data.path;

      applyDropInstruction(instruction, srcData, targetPath);
    },
  });
  dndCleanups.push(monitorCleanup);

  function showDropIndicator(rowEl, data, depth, container) {
    const instruction = extractInstruction(data);
    if (!instruction || instruction.type === "instruction-blocked") {
      dropLine.style.display = "none";
      rowEl.classList.remove("drop-target");
      return;
    }

    if (instruction.type === "make-child") {
      dropLine.style.display = "none";
      rowEl.classList.add("drop-target");
      return;
    }

    rowEl.classList.remove("drop-target");
    const rowRect = rowEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const indent = (instruction.type === "reorder-above" ? depth : depth) * 16 + 28;
    const top =
      instruction.type === "reorder-above"
        ? rowRect.top - containerRect.top + container.scrollTop
        : rowRect.bottom - containerRect.top + container.scrollTop;

    dropLine.style.display = "block";
    dropLine.style.top = `${top}px`;
    dropLine.style.left = `${indent}px`;
    dropLine.style.right = "8px";
  }
}

/** Apply a DnD instruction to the state */
function applyDropInstruction(instruction, srcData, targetPath) {
  if (srcData.type === "tree-node") {
    const fromPath = srcData.path;
    const targetParent = parentElementPath(targetPath);
    const targetIdx = childIndex(targetPath);

    switch (instruction.type) {
      case "reorder-above":
        update(moveNode(S, fromPath, targetParent, targetIdx));
        break;
      case "reorder-below":
        update(moveNode(S, fromPath, targetParent, targetIdx + 1));
        break;
      case "make-child": {
        const target = getNodeAtPath(S.document, targetPath);
        const len = target?.children?.length || 0;
        update(moveNode(S, fromPath, targetPath, len));
        break;
      }
    }
  } else if (srcData.type === "block") {
    const targetParent = parentElementPath(targetPath);
    const targetIdx = childIndex(targetPath);

    switch (instruction.type) {
      case "reorder-above":
        update(insertNode(S, targetParent, targetIdx, structuredClone(srcData.fragment)));
        break;
      case "reorder-below":
        update(insertNode(S, targetParent, targetIdx + 1, structuredClone(srcData.fragment)));
        break;
      case "make-child": {
        const target = getNodeAtPath(S.document, targetPath);
        const len = target?.children?.length || 0;
        update(insertNode(S, targetPath, len, structuredClone(srcData.fragment)));
        break;
      }
    }

    // Auto-import to $elements if the dropped block is a custom component
    const tag = srcData.fragment?.tagName;
    if (tag && tag.includes("-")) {
      const comp = componentRegistry.find((c) => c.tagName === tag);
      if (comp) {
        const elements = S.document.$elements || [];
        const alreadyImported = elements.some((e) =>
          e.$ref && (e.$ref === `./${comp.path}` || e.$ref.endsWith(comp.path.split("/").pop())),
        );
        if (!alreadyImported) {
          const relPath = computeRelativePath(S.documentPath, comp.path);
          S = applyMutation(S, (doc) => {
            if (!doc.$elements) doc.$elements = [];
            doc.$elements.push({ $ref: relPath });
          });
        }
      }
    }
  }
}

/** Generate a sensible default JSONsx node for a given tag name */
function defaultDef(tag) {
  const def = { tagName: tag };
  if (/^h[1-6]$/.test(tag)) def.textContent = "Heading";
  else if (tag === "p") def.textContent = "Paragraph text";
  else if (
    tag === "span" ||
    tag === "strong" ||
    tag === "em" ||
    tag === "small" ||
    tag === "mark" ||
    tag === "code" ||
    tag === "abbr" ||
    tag === "q" ||
    tag === "sub" ||
    tag === "sup" ||
    tag === "time"
  )
    def.textContent = "Text";
  else if (tag === "a") {
    def.textContent = "Link";
    def.attributes = { href: "#" };
  } else if (tag === "button") def.textContent = "Button";
  else if (tag === "label") def.textContent = "Label";
  else if (tag === "legend") def.textContent = "Legend";
  else if (tag === "caption") def.textContent = "Caption";
  else if (tag === "summary") def.textContent = "Summary";
  else if (
    tag === "li" ||
    tag === "dt" ||
    tag === "dd" ||
    tag === "th" ||
    tag === "td" ||
    tag === "option"
  )
    def.textContent = "Item";
  else if (tag === "blockquote") def.textContent = "Quote";
  else if (tag === "pre") def.textContent = "Preformatted text";
  else if (tag === "input") def.attributes = { type: "text", placeholder: "Enter text..." };
  else if (tag === "img") def.attributes = { src: "", alt: "Image" };
  else if (tag === "iframe") def.attributes = { src: "" };
  else if (tag === "select") def.children = [{ tagName: "option", textContent: "Option 1" }];
  else if (tag === "ul" || tag === "ol") def.children = [{ tagName: "li", textContent: "Item" }];
  else if (tag === "dl")
    def.children = [
      { tagName: "dt", textContent: "Term" },
      { tagName: "dd", textContent: "Definition" },
    ];
  else if (tag === "table")
    def.children = [
      {
        tagName: "thead",
        children: [{ tagName: "tr", children: [{ tagName: "th", textContent: "Header" }] }],
      },
      {
        tagName: "tbody",
        children: [{ tagName: "tr", children: [{ tagName: "td", textContent: "Cell" }] }],
      },
    ];
  else if (tag === "details")
    def.children = [
      { tagName: "summary", textContent: "Summary" },
      { tagName: "p", textContent: "Detail content" },
    ];
  return def;
}

function renderBlocks(container) {
  // Search filter
  const search = document.createElement("sp-search");
  search.setAttribute("size", "s");
  search.setAttribute("placeholder", "Filter elements…");
  container.appendChild(search);

  const list = document.createElement("div");
  container.appendChild(list);

  /** Collapsed category state (persists across re-renders via closure) */
  const collapsed = new Set();

  function renderList(filter) {
    list.innerHTML = "";

    for (const [category, elements] of Object.entries(webdata.elements)) {
      const filtered = filter ? elements.filter((e) => e.tag.includes(filter)) : elements;
      if (filtered.length === 0) continue;

      // Category header
      const header = document.createElement("div");
      header.className = `blocks-category${collapsed.has(category) ? " collapsed" : ""}`;
      header.textContent = category;
      header.onclick = () => {
        if (collapsed.has(category)) collapsed.delete(category);
        else collapsed.add(category);
        renderList(search.value.toLowerCase());
      };
      list.appendChild(header);

      if (collapsed.has(category)) continue;

      for (const { tag } of filtered) {
        const def = defaultDef(tag);
        const row = document.createElement("div");
        row.className = "block-row";

        // Live preview of the element
        const preview = document.createElement("div");
        preview.className = "block-preview";
        const unsafeTags = new Set(["script", "style", "link", "iframe", "object", "embed"]);
        const el = document.createElement(unsafeTags.has(tag) ? "span" : tag);
        el.textContent = tag;
        preview.appendChild(el);
        row.appendChild(preview);

        // Tag label below preview
        const lbl = document.createElement("div");
        lbl.className = "block-label";
        lbl.textContent = `<${tag}>`;
        row.appendChild(lbl);

        row.onclick = () => {
          const parentPath = S.selection || [];
          const parent = getNodeAtPath(S.document, parentPath);
          const idx = parent?.children ? parent.children.length : 0;
          update(insertNode(S, parentPath, idx, structuredClone(def)));
        };

        const blockDef = def;
        const cleanup = draggable({
          element: row,
          getInitialData() {
            return { type: "block", fragment: structuredClone(blockDef) };
          },
        });
        dndCleanups.push(cleanup);

        list.appendChild(row);
      }
    }
  }

  search.addEventListener("input", () => renderList(search.value.toLowerCase()));
  renderList("");
}

// ─── Stylebook ───────────────────────────────────────────────────────────────

/** Map from rendered stylebook DOM elements to their tag names */
let stylebookElToTag = new WeakMap();

/**
 * Build a DOM element tree from a stylebook-meta.json entry.
 * Applies any existing tag-scoped styles from rootStyle["& tag"].
 */
function buildStylebookElement(entry, rootStyle, activeBreakpoints) {
  const el = document.createElement(entry.tag);
  if (entry.text) el.textContent = entry.text;
  if (entry.attributes) {
    for (const [k, v] of Object.entries(entry.attributes)) {
      try { el.setAttribute(k, v); } catch {}
    }
  }
  if (entry.style) el.style.cssText = entry.style;
  // Apply custom styles from document root
  const tagStyle = rootStyle[`& ${entry.tag}`];
  if (tagStyle) {
    for (const [prop, val] of Object.entries(tagStyle)) {
      if (typeof val === "string" || typeof val === "number") {
        try { el.style[prop] = val; } catch {}
      }
    }
    // Apply media overrides for active breakpoints
    if (activeBreakpoints) {
      for (const [key, val] of Object.entries(tagStyle)) {
        if (!key.startsWith("@") || typeof val !== "object") continue;
        const mediaName = key.slice(1);
        if (mediaName === "--") continue;
        if (activeBreakpoints.has(mediaName)) {
          for (const [prop, v] of Object.entries(val)) {
            if (typeof v === "string" || typeof v === "number") {
              try { el.style[prop] = v; } catch {}
            }
          }
        }
      }
    }
  }
  if (entry.children) {
    for (const child of entry.children) {
      el.appendChild(buildStylebookElement(child, rootStyle, activeBreakpoints));
    }
  }
  return el;
}

function hasTagStyle(rootStyle, tag) {
  const s = rootStyle[`& ${tag}`];
  return s && typeof s === "object" && Object.keys(s).length > 0;
}

function renderStylebook() {
  stylebookElToTag = new WeakMap();
  const rootStyle = S.document.style || {};
  const filter = (S.ui.stylebookFilter || "").toLowerCase();
  const customizedOnly = S.ui.stylebookCustomizedOnly;

  const { sizeBreakpoints, baseWidth } = parseMediaEntries(S.document.$media);
  const hasMedia = sizeBreakpoints.length > 0;

  // Chrome bar (tabs + filter) — positioned absolutely above the panzoom surface
  const chrome = document.createElement("div");
  chrome.className = "sb-chrome";
  chrome.style.cssText = "position:absolute;top:0;left:0;right:0;z-index:15;background:var(--bg-panel);border-bottom:1px solid var(--border)";

  const tabBar = document.createElement("sp-tabs");
  tabBar.setAttribute("size", "s");
  for (const t of ["elements", "variables"]) {
    const tab = document.createElement("sp-tab");
    tab.setAttribute("label", t.charAt(0).toUpperCase() + t.slice(1));
    tab.setAttribute("value", t);
    if (S.ui.stylebookTab === t) tab.setAttribute("selected", "");
    tab.addEventListener("click", () => {
      S = { ...S, ui: { ...S.ui, stylebookTab: t } };
      renderCanvas();
      renderOverlays();
      renderLeftPanel();
    });
    tabBar.appendChild(tab);
  }
  chrome.appendChild(tabBar);

  // Filter bar (elements tab only)
  if (S.ui.stylebookTab === "elements") {
    const search = document.createElement("input");
    search.className = "field-input";
    search.style.cssText = "flex:1;max-width:200px;margin-left:8px";
    search.placeholder = "Filter\u2026";
    search.value = S.ui.stylebookFilter;
    search.oninput = () => {
      S = { ...S, ui: { ...S.ui, stylebookFilter: search.value } };
      renderCanvas();
      renderOverlays();
    };
    chrome.appendChild(search);

    const customizedBtn = document.createElement("button");
    customizedBtn.className = `tb-toggle${S.ui.stylebookCustomizedOnly ? " active" : ""}`;
    customizedBtn.style.marginLeft = "4px";
    customizedBtn.textContent = "Customized";
    customizedBtn.onclick = () => {
      S = { ...S, ui: { ...S.ui, stylebookCustomizedOnly: !S.ui.stylebookCustomizedOnly } };
      renderCanvas();
      renderOverlays();
    };
    chrome.appendChild(customizedBtn);
  }

  canvasWrap.appendChild(chrome);

  // Set up panzoom surface — same as normal canvas mode
  canvasWrap.style.overflow = "hidden";
  panzoomWrap = document.createElement("div");
  panzoomWrap.className = "panzoom-wrap";
  panzoomWrap.style.transformOrigin = "0 0";
  panzoomWrap.style.paddingTop = "36px"; // space for chrome bar
  canvasWrap.appendChild(panzoomWrap);

  // Build panel definitions
  const allPanelDefs = [];
  if (hasMedia) {
    allPanelDefs.push({
      name: "base", displayName: mediaDisplayName("--"), width: baseWidth,
      activeSet: activeBreakpointsForWidth(sizeBreakpoints, baseWidth),
    });
    for (const bp of sizeBreakpoints) {
      allPanelDefs.push({
        name: bp.name, displayName: mediaDisplayName(bp.name), width: bp.width,
        activeSet: activeBreakpointsForWidth(sizeBreakpoints, bp.width),
      });
    }
    allPanelDefs.sort((a, b) => b.width - a.width);
  }

  // Render content into panels
  const renderIntoPanel = (panel, activeBreakpoints) => {
    panel.canvas.classList.add("sb-canvas");
    if (S.ui.stylebookTab === "elements") {
      renderStylebookElementsIntoCanvas(panel.canvas, rootStyle, filter, customizedOnly, activeBreakpoints);
      for (const child of panel.canvas.querySelectorAll("*")) {
        child.style.pointerEvents = "none";
      }
      registerStylebookPanelEvents(panel);
    } else {
      renderStylebookVarsIntoCanvas(panel.canvas, rootStyle);
      panel.overlayClk.style.pointerEvents = "none";
    }
  };

  if (!hasMedia) {
    // Single panel
    const hasBaseWidth = S.document.$media && S.document.$media["--"];
    const label = hasBaseWidth ? `${mediaDisplayName("--")} (${baseWidth}px)` : null;
    const panel = createCanvasPanel(
      hasBaseWidth ? "base" : null,
      label,
      !hasBaseWidth,
      hasBaseWidth ? baseWidth : undefined,
    );
    panzoomWrap.appendChild(panel.element);
    canvasPanels.push(panel);
    renderIntoPanel(panel, new Set());
  } else {
    // Multi-panel: one per breakpoint, sorted widest first
    for (const def of allPanelDefs) {
      const label = `${def.displayName} (${def.width}px)`;
      const panel = createCanvasPanel(def.name, label, false, def.width);
      panzoomWrap.appendChild(panel.element);
      canvasPanels.push(panel);
      renderIntoPanel(panel, def.activeSet);
    }
    updateActivePanelHeaders();
  }

  applyTransform();
  renderZoomIndicator();
}

/** Render element sections into the canvas from stylebook-meta.json */
function renderStylebookElementsIntoCanvas(canvasEl, rootStyle, filter, customizedOnly, activeBreakpoints) {
  for (const section of stylebookMeta.$sections) {
    // Filter elements
    let entries = section.elements;
    if (filter) {
      entries = entries.filter((e) =>
        e.tag.includes(filter) || section.label.toLowerCase().includes(filter),
      );
    }
    if (customizedOnly) {
      entries = entries.filter((e) => hasTagStyle(rootStyle, e.tag));
    }
    if (entries.length === 0) continue;

    // Section container
    const sectionEl = document.createElement("div");
    sectionEl.className = "sb-section";

    // Section label
    const label = document.createElement("div");
    label.className = "sb-label";
    label.textContent = section.label;
    sectionEl.appendChild(label);

    // Section content
    const body = document.createElement("div");
    body.className = "sb-body";

    for (const entry of entries) {
      const el = buildStylebookElement(entry, rootStyle, activeBreakpoints);
      el.style.marginBottom = "0.5em";

      // Register for overlay hit-testing
      stylebookElToTag.set(el, entry.tag);
      // Also register in the global elToPath so drawOverlayBox label works
      elToPath.set(el, ["__sb", entry.tag]);

      body.appendChild(el);
    }

    sectionEl.appendChild(body);
    canvasEl.appendChild(sectionEl);
  }

  // Custom components from registry
  if (componentRegistry.length > 0) {
    let comps = componentRegistry;
    if (filter) comps = comps.filter((c) => c.tagName.toLowerCase().includes(filter));
    if (customizedOnly) comps = comps.filter((c) => hasTagStyle(rootStyle, c.tagName));
    if (comps.length > 0) {
      const sectionEl = document.createElement("div");
      sectionEl.className = "sb-section";
      const label = document.createElement("div");
      label.className = "sb-label";
      label.textContent = "Components";
      sectionEl.appendChild(label);
      const body = document.createElement("div");
      body.className = "sb-body";
      for (const comp of comps) {
        const el = document.createElement("div");
        el.style.cssText = "padding:12px;border:1px dashed var(--border);border-radius:4px;margin-bottom:0.5em;color:var(--fg-dim)";
        el.textContent = `<${comp.tagName}>`;
        const tagStyle = rootStyle[`& ${comp.tagName}`];
        if (tagStyle) {
          for (const [prop, val] of Object.entries(tagStyle)) {
            if (typeof val === "string" || typeof val === "number") {
              try { el.style[prop] = val; } catch {}
            }
          }
          // Apply media overrides for active breakpoints
          if (activeBreakpoints) {
            for (const [key, val] of Object.entries(tagStyle)) {
              if (!key.startsWith("@") || typeof val !== "object") continue;
              const mediaName = key.slice(1);
              if (mediaName === "--") continue;
              if (activeBreakpoints.has(mediaName)) {
                for (const [prop, v] of Object.entries(val)) {
                  if (typeof v === "string" || typeof v === "number") {
                    try { el.style[prop] = v; } catch {}
                  }
                }
              }
            }
          }
        }
        stylebookElToTag.set(el, comp.tagName);
        elToPath.set(el, ["__sb", comp.tagName]);
        body.appendChild(el);
      }
      sectionEl.appendChild(body);
      canvasEl.appendChild(sectionEl);
    }
  }

  if (canvasEl.children.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:48px;text-align:center;color:var(--fg-dim);font-size:13px";
    empty.textContent = customizedOnly ? "No customized elements" : "No matching elements";
    canvasEl.appendChild(empty);
  }
}

/** Render variables into the canvas (card-based layout matching Elements tab) */
function renderStylebookVarsIntoCanvas(canvasEl, rootStyle) {
  const varCats = stylebookMeta.$variables;

  const groups = {};
  for (const key of Object.keys(varCats)) groups[key] = [];
  for (const [k, v] of Object.entries(rootStyle)) {
    if (!k.startsWith("--")) continue;
    if (typeof v !== "string" && typeof v !== "number") continue;
    if (k.startsWith("--color")) groups.color.push([k, v]);
    else if (k.startsWith("--font")) groups.font.push([k, v]);
    else if (k.startsWith("--size") || k.startsWith("--spacing") || k.startsWith("--radius"))
      groups.size.push([k, v]);
    else groups.other.push([k, v]);
  }

  for (const [catKey, catMeta] of Object.entries(varCats)) {
    const vars = groups[catKey];

    const sectionEl = document.createElement("div");
    sectionEl.className = "sb-section";
    const label = document.createElement("div");
    label.className = "sb-label";
    label.textContent = catMeta.label;
    sectionEl.appendChild(label);

    const body = document.createElement("div");
    body.className = "sb-body";

    // Existing variable rows
    if (vars.length > 0) {
      for (const [varName, varVal] of vars) {
        body.appendChild(renderVarRow(catKey, catMeta, varName, String(varVal), false));
      }
    } else {
      const empty = document.createElement("div");
      empty.className = "sb-var-empty";
      empty.textContent = `No ${catMeta.label.toLowerCase()} variables yet.`;
      body.appendChild(empty);
    }

    // "Add" button at bottom of each section
    const addBtn = document.createElement("button");
    addBtn.className = "sb-var-add-btn";
    addBtn.innerHTML = `<span class="sb-var-add-icon">+</span> Add ${catMeta.label}`;
    addBtn.onclick = () => {
      // Insert new empty row just before the add button
      const row = renderVarRow(catKey, catMeta, null, "", true);
      body.insertBefore(row, addBtn);
      addBtn.style.display = "none";
      // Focus the name field
      const nameField = row.querySelector("sp-textfield");
      if (nameField) requestAnimationFrame(() => nameField.focus());
    };
    body.appendChild(addBtn);

    sectionEl.appendChild(body);
    canvasEl.appendChild(sectionEl);
  }
}

/**
 * Render a single variable row — used for both existing and add-new.
 * @param {string} catKey - "color"|"font"|"size"|"other"
 * @param {object} catMeta - { label, prefix, placeholder }
 * @param {string|null} varName - existing var name, or null for add-new
 * @param {string} varVal - current value, or "" for add-new
 * @param {boolean} isNew - true if this is an add-new row
 */
function renderVarRow(catKey, catMeta, varName, varVal, isNew) {
  const row = document.createElement("div");
  row.className = isNew ? "sb-var-row is-new" : "sb-var-row";

  // ─── Header: friendly name + dash name + delete ───
  const header = document.createElement("div");
  header.className = "sb-var-row-header";

  if (!isNew && varName) {
    const title = document.createElement("span");
    title.className = "sb-var-row-title";
    title.textContent = varDisplayName(varName, catMeta.prefix);
    header.appendChild(title);
    const ref = document.createElement("span");
    ref.className = "sb-var-row-ref";
    ref.textContent = varName;
    header.appendChild(ref);

    const del = document.createElement("sp-action-button");
    del.size = "s";
    del.quiet = true;
    del.className = "sb-var-del";
    del.style.pointerEvents = "auto";
    const delIcon = document.createElement("sp-icon-delete");
    delIcon.slot = "icon";
    del.appendChild(delIcon);
    del.onclick = () => update(updateStyle(S, [], varName, undefined));
    header.appendChild(del);
  }

  if (header.childNodes.length) row.appendChild(header);

  // ─── Horizontal input row: [swatch] + name(flex:2) + value(flex:3) + [actions] ───
  const inputRow = document.createElement("div");
  inputRow.className = "sb-var-input-row";

  // Color swatch
  let colorPicker = null;
  if (catKey === "color") {
    const swatch = document.createElement("div");
    swatch.className = "sb-var-swatch";
    swatch.style.backgroundColor = varVal || "var(--accent)";
    colorPicker = document.createElement("input");
    colorPicker.type = "color";
    try { colorPicker.value = (varVal && varVal.startsWith("#")) ? varVal : "#007acc"; } catch {}
    swatch.appendChild(colorPicker);
    inputRow.appendChild(swatch);
  }

  // Name column
  let nameField = null;
  if (isNew) {
    const nameCol = document.createElement("div");
    nameCol.className = "sb-var-col-name";
    const lbl = document.createElement("div");
    lbl.className = "sb-var-col-label";
    lbl.textContent = "Name";
    nameCol.appendChild(lbl);
    nameField = document.createElement("sp-textfield");
    nameField.size = "s";
    nameField.placeholder = catKey === "color" ? "Primary Blue" : catKey === "font" ? "Body Serif" : catKey === "size" ? "Spacing Large" : "Border Radius";
    nameField.style.pointerEvents = "auto";
    nameCol.appendChild(nameField);
    inputRow.appendChild(nameCol);
  }

  // Value column
  const valCol = document.createElement("div");
  valCol.className = "sb-var-col-value";
  if (isNew) {
    const lbl = document.createElement("div");
    lbl.className = "sb-var-col-label";
    lbl.textContent = "Value";
    valCol.appendChild(lbl);
  }

  let getValueFn;

  if (catKey === "color") {
    const hexField = document.createElement("sp-textfield");
    hexField.size = "s";
    hexField.value = varVal || "#007acc";
    hexField.placeholder = "#007acc";
    hexField.style.pointerEvents = "auto";
    valCol.appendChild(hexField);
    getValueFn = () => hexField.value.trim();

    if (colorPicker) {
      colorPicker.oninput = () => {
        hexField.value = colorPicker.value;
        const swatch = row.querySelector(".sb-var-swatch");
        if (swatch) swatch.style.backgroundColor = colorPicker.value;
        if (!isNew && varName) update(updateStyle(S, [], varName, colorPicker.value));
      };
      let debounce;
      hexField.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const v = hexField.value;
          try { colorPicker.value = v.startsWith("#") ? v : colorPicker.value; } catch {}
          const swatch = row.querySelector(".sb-var-swatch");
          if (swatch) swatch.style.backgroundColor = v;
          if (!isNew && varName) update(updateStyle(S, [], varName, v));
        }, 400);
      });
    }
  } else if (catKey === "size") {
    const ui = createUnitInput(varVal || "16px", {
      onChange: (newVal) => {
        const bar = row.querySelector(".sb-var-size-bar");
        if (bar) bar.style.width = newVal;
        if (!isNew && varName) update(updateStyle(S, [], varName, newVal));
      },
    });
    if (isNew) ui.textfield.value = "";
    valCol.appendChild(ui.wrap);
    getValueFn = () => ui.getValue();
  } else {
    const textField = document.createElement("sp-textfield");
    textField.size = "s";
    textField.value = varVal;
    textField.placeholder = catMeta.placeholder;
    textField.style.pointerEvents = "auto";
    valCol.appendChild(textField);
    getValueFn = () => textField.value.trim();

    if (!isNew && varName) {
      let debounce;
      textField.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const v = textField.value;
          const fontPrev = row.querySelector(".sb-var-font-preview");
          if (fontPrev) fontPrev.style.fontFamily = v;
          update(updateStyle(S, [], varName, v));
        }, 400);
      });
    }
  }

  inputRow.appendChild(valCol);

  // Action buttons for add-new (inline at end of input row)
  if (isNew) {
    const actions = document.createElement("div");
    actions.className = "sb-var-add-actions";

    const confirmBtn = document.createElement("sp-action-button");
    confirmBtn.size = "s";
    confirmBtn.style.pointerEvents = "auto";
    confirmBtn.textContent = "Add";
    confirmBtn.onclick = () => {
      const name = (nameField.value || "").trim();
      const val = getValueFn();
      const generatedVar = friendlyNameToVar(name, catMeta.prefix);
      if (!generatedVar || !val) return;
      update(updateStyle(S, [], generatedVar, val));
    };
    actions.appendChild(confirmBtn);

    const cancelBtn = document.createElement("sp-action-button");
    cancelBtn.size = "s";
    cancelBtn.quiet = true;
    cancelBtn.style.pointerEvents = "auto";
    const closeIcon = document.createElement("sp-icon-close");
    closeIcon.slot = "icon";
    cancelBtn.appendChild(closeIcon);
    cancelBtn.onclick = () => {
      const body = row.parentElement;
      row.remove();
      const addBtn = body?.querySelector(".sb-var-add-btn");
      if (addBtn) addBtn.style.display = "";
    };
    actions.appendChild(cancelBtn);

    inputRow.appendChild(actions);
  }

  row.appendChild(inputRow);

  // Live preview of generated var name (add-new only)
  if (isNew && nameField) {
    const preview = document.createElement("div");
    preview.className = "sb-var-add-preview";
    nameField.addEventListener("input", () => {
      preview.textContent = friendlyNameToVar(nameField.value || "", catMeta.prefix);
    });
    row.appendChild(preview);
  }

  // ─── Type-specific preview ───
  if (catKey === "font" && varVal) {
    const preview = document.createElement("div");
    preview.className = "sb-var-preview";
    const fontPrev = document.createElement("div");
    fontPrev.className = "sb-var-font-preview";
    fontPrev.style.fontFamily = varVal;
    fontPrev.textContent = "The quick brown fox jumps over the lazy dog";
    preview.appendChild(fontPrev);
    row.appendChild(preview);
  }

  if (catKey === "size" && varVal) {
    const preview = document.createElement("div");
    preview.className = "sb-var-preview";
    const track = document.createElement("div");
    track.className = "sb-var-size-track";
    const bar = document.createElement("div");
    bar.className = "sb-var-size-bar";
    bar.style.width = varVal;
    track.appendChild(bar);
    preview.appendChild(track);
    row.appendChild(preview);
  }

  return row;
}

function varDisplayName(varName, prefix) {
  return varName
    .replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "")
    .replace(/^--/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase()) || varName;
}

/** Convert a human-friendly name like "Primary Blue" to "--color-primary-blue" */
function friendlyNameToVar(name, prefix) {
  const slug = name.trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return "";
  return `${prefix}${slug}`;
}

/** Convert a $media key like "--tablet" to a friendly display name "Tablet". "--" returns "Base". */
function mediaDisplayName(name) {
  if (name === "--") return "Base";
  return name.replace(/^--/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || name;
}

/** Convert a human-friendly name like "Tablet" to a $media key "--tablet" */
function friendlyNameToMedia(name) {
  return friendlyNameToVar(name, "--");
}

/**
 * Creates a combined textfield + quiet sp-picker for CSS values with units.
 * Returns { wrap, textfield, picker, getValue, setValue }.
 * The picker hides automatically when the textfield value is non-numeric (e.g. "auto", "inherit").
 */
function createUnitInput(initialValue, { onChange, size = "s" } = {}) {
  const match = String(initialValue).match(/^(-?[\d.]+)\s*(px|em|rem|vw|vh|%|ch|ex|vmin|vmax|pt|cm|mm|in)?$/);
  let numVal = match ? match[1] : initialValue;
  let unitVal = match ? (match[2] || "px") : "";
  const isNumeric = !!match;

  const wrap = document.createElement("div");
  wrap.className = "sb-unit-input";
  wrap.style.pointerEvents = "auto";

  const textfield = document.createElement("sp-textfield");
  textfield.value = numVal;
  textfield.size = size;
  wrap.appendChild(textfield);

  const picker = document.createElement("sp-picker");
  picker.quiet = true;
  picker.size = size;
  if (!isNumeric) picker.style.display = "none";

  const units = [
    { value: "px", label: "px" },
    { value: "rem", label: "rem" },
    { value: "em", label: "em" },
    { value: "%", label: "%" },
    { value: "vw", label: "vw" },
    { value: "vh", label: "vh" },
    { value: "ch", label: "ch" },
    { value: "pt", label: "pt" },
    { divider: true },
    { value: "auto", label: "auto" },
    { value: "fit-content", label: "fit-content" },
  ];
  for (const u of units) {
    if (u.divider) {
      picker.appendChild(document.createElement("sp-menu-divider"));
    } else {
      const item = document.createElement("sp-menu-item");
      item.value = u.value;
      item.textContent = u.label;
      picker.appendChild(item);
    }
  }
  requestAnimationFrame(() => { picker.value = unitVal || "px"; });
  wrap.appendChild(picker);

  function getValue() {
    const num = textfield.value;
    const unit = picker.value;
    // Keyword units like "auto" replace the whole value
    if (unit === "auto" || unit === "fit-content") return unit;
    return num ? `${num}${unit}` : "";
  }

  // Textfield typing — show/hide picker based on numeric content
  let debounce;
  textfield.addEventListener("input", () => {
    clearTimeout(debounce);
    const raw = textfield.value.trim();
    const looksNumeric = /^-?[\d.]+$/.test(raw);
    picker.style.display = looksNumeric ? "" : "none";
    debounce = setTimeout(() => {
      if (onChange) onChange(looksNumeric ? `${raw}${picker.value}` : raw);
    }, 400);
  });

  // Picker change — keyword replaces input, numeric unit appends
  picker.addEventListener("change", () => {
    const unit = picker.value;
    if (unit === "auto" || unit === "fit-content") {
      textfield.value = unit;
      picker.style.display = "none";
      if (onChange) onChange(unit);
    } else {
      unitVal = unit;
      if (onChange) onChange(getValue());
    }
  });

  return { wrap, textfield, picker, getValue };
}

/** Click handler for stylebook canvas — selects elements via the elToPath/stylebookElToTag mapping */
function registerStylebookPanelEvents(panel) {
  const { canvas, overlayClk } = panel;

  overlayClk.addEventListener("click", (e) => {
    // Temporarily enable pointer events to hit-test
    const els = canvas.querySelectorAll("*");
    for (const el of els) el.style.pointerEvents = "auto";
    overlayClk.style.display = "none";
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    overlayClk.style.display = "";
    for (const el of els) el.style.pointerEvents = "none";

    // Find the closest element with a stylebook tag mapping (walk up parents for nested elements)
    for (const el of elements) {
      if (!canvas.contains(el) || el === canvas) continue;
      let cur = el;
      while (cur && cur !== canvas) {
        const tag = stylebookElToTag.get(cur);
        if (tag) {
          const newMedia = panel.mediaName === "base" ? null : (panel.mediaName ?? null);
          S = {
            ...S,
            selection: [],
            ui: { ...S.ui, stylebookSelection: tag, rightTab: "style", activeSelector: `& ${tag}`, activeMedia: newMedia },
          };
          renderStylebookOverlays();
          updateActivePanelHeaders();
          renderRightPanel();
          renderLeftPanel();
          renderToolbar();
          return;
        }
        cur = cur.parentElement;
      }
    }
    // Clicked empty area — deselect
    S = { ...S, ui: { ...S.ui, stylebookSelection: null, activeSelector: null } };
    renderStylebookOverlays();
    renderRightPanel();
  });

  overlayClk.addEventListener("mousemove", (e) => {
    // Hover effect
    const els = canvas.querySelectorAll("*");
    for (const el of els) el.style.pointerEvents = "auto";
    overlayClk.style.display = "none";
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    overlayClk.style.display = "";
    for (const el of els) el.style.pointerEvents = "none";

    let hoverTag = null;
    for (const el of elements) {
      if (!canvas.contains(el) || el === canvas) continue;
      let cur = el;
      while (cur && cur !== canvas) {
        const tag = stylebookElToTag.get(cur);
        if (tag) { hoverTag = tag; break; }
        cur = cur.parentElement;
      }
      if (hoverTag) break;
    }

    if (hoverTag !== panel._lastHoverTag) {
      panel._lastHoverTag = hoverTag;
      renderStylebookOverlays();
    }
  });
}

/** Draw selection + hover overlays for stylebook elements */
function renderStylebookOverlays() {
  if (canvasPanels.length === 0) return;

  const selectedTag = S.ui.stylebookSelection;

  for (const panel of canvasPanels) {
    panel.overlay.innerHTML = "";
    panel.overlay.appendChild(panel.dropLine);

    const hoverTag = panel._lastHoverTag;

    // Draw hover
    if (hoverTag && hoverTag !== selectedTag) {
      const el = findStylebookEl(panel.canvas, hoverTag);
      if (el) drawOverlayBoxRaw(el, "hover", panel, `<${hoverTag}>`);
    }

    // Draw selection
    if (selectedTag) {
      const el = findStylebookEl(panel.canvas, selectedTag);
      if (el) drawOverlayBoxRaw(el, "selection", panel, `<${selectedTag}>`);
    }
  }
}

/** Find a stylebook element by tag in the canvas */
function findStylebookEl(canvasEl, tag) {
  for (const child of canvasEl.querySelectorAll("*")) {
    if (stylebookElToTag.get(child) === tag) return child;
  }
  return null;
}

/** Draw an overlay box with a custom label (used by stylebook) */
function drawOverlayBoxRaw(el, type, panel, labelText) {
  const vpRect = panel.viewport.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const scale = effectiveZoom();

  const box = document.createElement("div");
  box.className = `overlay-box overlay-${type}`;
  box.style.top = `${(elRect.top - vpRect.top + panel.viewport.scrollTop) / scale}px`;
  box.style.left = `${(elRect.left - vpRect.left + panel.viewport.scrollLeft) / scale}px`;
  box.style.width = `${elRect.width / scale}px`;
  box.style.height = `${elRect.height / scale}px`;

  if (type === "selection" && labelText) {
    const label = document.createElement("div");
    label.className = "overlay-label";
    label.textContent = labelText;
    box.appendChild(label);
  }

  panel.overlay.appendChild(box);
  return box;
}

// ─── Left panel: Signals ─────────────────────────────────────────────────────

/** Expanded signal editor state (persists across renders). */
let expandedSignal = null;

function renderSignals(container) {
  const defs = S.document.state || {};
  const entries = Object.entries(defs);

  // Group by category
  const groups = { state: [], computed: [], data: [], function: [] };
  for (const [name, def] of entries) {
    groups[defCategory(def)].push([name, def]);
  }

  const categories = [
    { key: "state", label: "State", items: groups.state },
    { key: "computed", label: "Computed", items: groups.computed },
    { key: "data", label: "Data", items: groups.data },
    { key: "function", label: "Functions", items: groups.function },
  ];

  const collapsedCats = S._collapsedSignalCats || (S._collapsedSignalCats = new Set());

  for (const { key, label, items } of categories) {
    if (items.length === 0) continue;

    const header = document.createElement("div");
    header.className = `signal-category${collapsedCats.has(key) ? " collapsed" : ""}`;
    header.textContent = `${label} (${items.length})`;
    header.onclick = () => {
      if (collapsedCats.has(key)) collapsedCats.delete(key);
      else collapsedCats.add(key);
      renderLeftPanel();
    };
    container.appendChild(header);

    if (collapsedCats.has(key)) continue;

    for (const [name, def] of items) {
      const isExpanded = expandedSignal === name;
      const row = document.createElement("div");
      row.className = `signal-row${isExpanded ? " expanded" : ""}`;

      const badge = document.createElement("span");
      badge.className = `signal-badge ${defCategory(def)}`;
      badge.textContent = defBadgeLabel(def);
      row.appendChild(badge);

      const nameEl = document.createElement("span");
      nameEl.className = "signal-name";
      nameEl.textContent = name;
      row.appendChild(nameEl);

      const hint = document.createElement("span");
      hint.className = "signal-hint";
      hint.textContent = defHint(name, def);
      row.appendChild(hint);

      const del = document.createElement("sp-action-button");
      del.setAttribute("quiet", "");
      del.setAttribute("size", "xs");
      del.className = "signal-del";
      const delIcon = document.createElement("sp-icon-delete");
      delIcon.setAttribute("slot", "icon");
      del.appendChild(delIcon);
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        update(removeDef(S, name));
      });
      row.appendChild(del);

      row.onclick = () => {
        expandedSignal = isExpanded ? null : name;
        renderLeftPanel();
      };
      container.appendChild(row);

      // Expanded inline editor
      if (isExpanded) {
        const editor = document.createElement("div");
        editor.className = "signal-editor";
        renderSignalEditor(editor, name, def);
        container.appendChild(editor);
      }
    }
  }

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No state defined";
    container.appendChild(empty);
  }

  // Add signal button
  const addArea = document.createElement("div");
  addArea.className = "signals-add";

  const addSelect = document.createElement("sp-picker");
  addSelect.setAttribute("size", "s");
  addSelect.setAttribute("label", "+ Add\u2026");
  addSelect.setAttribute("placeholder", "+ Add\u2026");

  // Signals group
  for (const [value, label] of [["state", "State Signal"], ["computed", "Computed"]]) {
    const item = document.createElement("sp-menu-item");
    item.setAttribute("value", value);
    item.textContent = label;
    addSelect.appendChild(item);
  }

  const div1 = document.createElement("sp-menu-divider");
  addSelect.appendChild(div1);

  // Data Sources group
  for (const [value, label] of [
    ["request", "Fetch (Request)"],
    ["localStorage", "LocalStorage"],
    ["sessionStorage", "SessionStorage"],
    ["indexedDB", "IndexedDB"],
    ["cookie", "Cookie"],
    ["set", "Set"],
    ["map", "Map"],
    ["formData", "FormData"],
    ["external", "External Module\u2026"],
  ]) {
    const item = document.createElement("sp-menu-item");
    item.setAttribute("value", value);
    item.textContent = label;
    addSelect.appendChild(item);
  }

  const div2 = document.createElement("sp-menu-divider");
  addSelect.appendChild(div2);

  // Logic group
  const fnItem = document.createElement("sp-menu-item");
  fnItem.setAttribute("value", "function");
  fnItem.textContent = "Function";
  addSelect.appendChild(fnItem);
  addSelect.addEventListener("change", () => {
    const type = addSelect.value;
    if (!type) return;
    const template = DEF_TEMPLATES[type];
    if (!template) return;
    const isFunction = type === "function";
    let nameBase = isFunction ? "newFunction" : "$newSignal";
    let name = nameBase;
    let i = 1;
    while (S.document.state && S.document.state[name]) {
      name = nameBase + i++;
    }
    update(addDef(S, name, structuredClone(template)));
    expandedSignal = name;
    renderLeftPanel();
  });
  addArea.appendChild(addSelect);
  container.appendChild(addArea);
}

/** Render inline editor fields for a specific signal/def type. */
function renderSignalEditor(container, name, def) {
  const cat = defCategory(def);

  // Name field (common to all)
  container.appendChild(
    signalFieldRow("name", name, (v) => {
      if (v && v !== name && !(S.document.state && S.document.state[v])) {
        expandedSignal = v;
        update(renameDef(S, name, v));
      }
    }),
  );

  if (cat === "state") {
    // Type selector
    const typeSelect = document.createElement("div");
    typeSelect.className = "field-row";
    const typeLabel = document.createElement("label");
    typeLabel.className = "field-label";
    typeLabel.textContent = "type";
    typeSelect.appendChild(typeLabel);
    const sel = document.createElement("sp-picker");
    sel.setAttribute("size", "s");
    sel.className = "field-input";
    for (const t of ["string", "integer", "number", "boolean", "array", "object"]) {
      const item = document.createElement("sp-menu-item");
      item.setAttribute("value", t);
      item.textContent = t;
      sel.appendChild(item);
    }
    const _selType = def.type || "string";
    requestAnimationFrame(() => { sel.value = _selType; });
    sel.addEventListener("change", () => update(updateDef(S, name, { type: sel.value })));
    typeSelect.appendChild(sel);
    container.appendChild(typeSelect);

    // Default value
    const defaultVal =
      def.default !== undefined && def.default !== null
        ? typeof def.default === "object"
          ? JSON.stringify(def.default)
          : String(def.default)
        : "";
    container.appendChild(
      signalFieldRow("default", defaultVal, (v) => {
        let parsed = v;
        if (def.type === "integer") parsed = parseInt(v, 10) || 0;
        else if (def.type === "number") parsed = parseFloat(v) || 0;
        else if (def.type === "boolean") parsed = v === "true";
        else if (def.type === "array" || def.type === "object") {
          try {
            parsed = JSON.parse(v);
          } catch {
            parsed = v;
          }
        }
        update(updateDef(S, name, { default: parsed }));
      }),
    );

    // Description
    container.appendChild(
      signalFieldRow("desc", def.description || "", (v) => {
        update(updateDef(S, name, { description: v || undefined }));
      }),
    );

    // CEM annotations (custom element docs only)
    if (isCustomElementDoc()) {
      container.appendChild(
        signalFieldRow("attribute", def.attribute || "", (v) => {
          update(updateDef(S, name, { attribute: v || undefined }));
        }),
      );

      // reflects checkbox
      const reflRow = document.createElement("div");
      reflRow.className = "field-row";
      const reflLabel = document.createElement("label");
      reflLabel.className = "field-label";
      reflLabel.textContent = "reflects";
      reflRow.appendChild(reflLabel);
      const reflCheck = document.createElement("sp-checkbox");
      reflCheck.className = "field-check";
      reflCheck.checked = !!def.reflects;
      reflCheck.addEventListener("change", () => {
        update(updateDef(S, name, { reflects: reflCheck.checked || undefined }));
      });
      reflRow.appendChild(reflCheck);
      container.appendChild(reflRow);

      container.appendChild(
        signalFieldRow("deprecated", typeof def.deprecated === "string" ? def.deprecated : "", (v) => {
          update(updateDef(S, name, { deprecated: v || undefined }));
        }),
      );
    }
  } else if (cat === "computed") {
    // Expression
    const exprRow = document.createElement("div");
    exprRow.className = "field-row";
    const exprLabel = document.createElement("label");
    exprLabel.className = "field-label";
    exprLabel.textContent = "expr";
    exprRow.appendChild(exprLabel);
    const exprInput = document.createElement("textarea");
    exprInput.className = "field-input";
    exprInput.style.minHeight = "40px";
    exprInput.value = def.$compute || "";
    let debounce;
    exprInput.oninput = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const expr = exprInput.value;
        // Auto-detect deps from $-prefixed names
        const depMatches = expr.match(/\$[a-zA-Z_]\w*/g) || [];
        const deps = [...new Set(depMatches)].map((d) => `#/state/${d}`);
        update(updateDef(S, name, { $compute: expr, $deps: deps }));
      }, 500);
    };
    exprRow.appendChild(exprInput);
    container.appendChild(exprRow);

    // Show detected deps
    if (def.$deps && def.$deps.length > 0) {
      const depsRow = document.createElement("div");
      depsRow.className = "field-row";
      const depsLabel = document.createElement("label");
      depsLabel.className = "field-label";
      depsLabel.textContent = "deps";
      depsRow.appendChild(depsLabel);
      const depsText = document.createElement("span");
      depsText.className = "signal-hint";
      depsText.style.flex = "1";
      depsText.style.maxWidth = "none";
      depsText.textContent = def.$deps.map((d) => d.replace("#/state/", "")).join(", ");
      depsRow.appendChild(depsText);
      container.appendChild(depsRow);
    }
  } else if (cat === "data") {
    const proto = def.$prototype;

    if (proto === "Request") {
      container.appendChild(
        signalFieldRow("url", def.url || "", (v) => {
          update(updateDef(S, name, { url: v }));
        }),
      );
      // Method selector
      const methodRow = document.createElement("div");
      methodRow.className = "field-row";
      const methodLabel = document.createElement("label");
      methodLabel.className = "field-label";
      methodLabel.textContent = "method";
      methodRow.appendChild(methodLabel);
      const methodSel = document.createElement("sp-picker");
      methodSel.setAttribute("size", "s");
      methodSel.className = "field-input";
      for (const m of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
        const item = document.createElement("sp-menu-item");
        item.setAttribute("value", m);
        item.textContent = m;
        methodSel.appendChild(item);
      }
      const _mVal = def.method || "GET";
      requestAnimationFrame(() => { methodSel.value = _mVal; });
      methodSel.addEventListener("change", () => update(updateDef(S, name, { method: methodSel.value })));
      methodRow.appendChild(methodSel);
      container.appendChild(methodRow);
      // Timing
      const timingRow = document.createElement("div");
      timingRow.className = "field-row";
      const timingLabel = document.createElement("label");
      timingLabel.className = "field-label";
      timingLabel.textContent = "timing";
      timingRow.appendChild(timingLabel);
      const timingSel = document.createElement("sp-picker");
      timingSel.setAttribute("size", "s");
      timingSel.className = "field-input";
      for (const t of ["client", "server"]) {
        const item = document.createElement("sp-menu-item");
        item.setAttribute("value", t);
        item.textContent = t;
        timingSel.appendChild(item);
      }
      const _tVal = def.timing || "client";
      requestAnimationFrame(() => { timingSel.value = _tVal; });
      timingSel.addEventListener("change", () => update(updateDef(S, name, { timing: timingSel.value })));
      timingRow.appendChild(timingSel);
      container.appendChild(timingRow);
    } else if (proto === "LocalStorage" || proto === "SessionStorage") {
      container.appendChild(
        signalFieldRow("key", def.key || "", (v) => {
          update(updateDef(S, name, { key: v }));
        }),
      );
      const defaultStr =
        def.default !== undefined && def.default !== null
          ? typeof def.default === "object"
            ? JSON.stringify(def.default, null, 2)
            : String(def.default)
          : "";
      const defRow = document.createElement("div");
      defRow.className = "field-row";
      const defLabel = document.createElement("label");
      defLabel.className = "field-label";
      defLabel.textContent = "default";
      defRow.appendChild(defLabel);
      const defInput = document.createElement("textarea");
      defInput.className = "field-input";
      defInput.style.minHeight = "40px";
      defInput.value = defaultStr;
      let debounce;
      defInput.oninput = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          try {
            update(updateDef(S, name, { default: JSON.parse(defInput.value) }));
          } catch {
            update(updateDef(S, name, { default: defInput.value }));
          }
        }, 500);
      };
      defRow.appendChild(defInput);
      container.appendChild(defRow);
    } else if (proto === "IndexedDB") {
      container.appendChild(
        signalFieldRow("database", def.database || "", (v) => {
          update(updateDef(S, name, { database: v }));
        }),
      );
      container.appendChild(
        signalFieldRow("store", def.store || "", (v) => {
          update(updateDef(S, name, { store: v }));
        }),
      );
      container.appendChild(
        signalFieldRow("version", String(def.version || 1), (v) => {
          update(updateDef(S, name, { version: parseInt(v, 10) || 1 }));
        }),
      );
    } else if (proto === "Cookie") {
      container.appendChild(
        signalFieldRow("cookie", def.name || "", (v) => {
          update(updateDef(S, name, { name: v }));
        }),
      );
      container.appendChild(
        signalFieldRow("default", def.default || "", (v) => {
          update(updateDef(S, name, { default: v }));
        }),
      );
    } else if (proto === "Set" || proto === "Map" || proto === "FormData") {
      const defaultStr =
        def.default !== undefined && def.default !== null
          ? JSON.stringify(def.default, null, 2)
          : proto === "FormData"
            ? JSON.stringify(def.fields || {}, null, 2)
            : "";
      const fieldName = proto === "FormData" ? "fields" : "default";
      const defRow = document.createElement("div");
      defRow.className = "field-row";
      const defLabel = document.createElement("label");
      defLabel.className = "field-label";
      defLabel.textContent = fieldName;
      defRow.appendChild(defLabel);
      const defInput = document.createElement("textarea");
      defInput.className = "field-input";
      defInput.style.minHeight = "40px";
      defInput.value = defaultStr;
      let debounce;
      defInput.oninput = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          try {
            update(updateDef(S, name, { [fieldName]: JSON.parse(defInput.value) }));
          } catch {}
        }, 500);
      };
      defRow.appendChild(defInput);
      container.appendChild(defRow);
    } else {
      // ── Schema-driven fallback for external/plugin prototypes ──
      renderExternalPrototypeEditor(container, name, def);
    }
  } else if (cat === "function") {
    if (def.$src) {
      // External function source
      container.appendChild(
        signalFieldRow("$src", def.$src || "", (v) => {
          update(updateDef(S, name, { $src: v || undefined }));
        }),
      );
      container.appendChild(
        signalFieldRow("$export", def.$export || "", (v) => {
          update(updateDef(S, name, { $export: v || undefined }));
        }),
      );
    } else {
      // Inline function body
      const bodyRow = document.createElement("div");
      bodyRow.className = "field-row";
      const bodyLabel = document.createElement("label");
      bodyLabel.className = "field-label";
      bodyLabel.textContent = "body";
      bodyRow.appendChild(bodyLabel);
      const bodyInput = document.createElement("textarea");
      bodyInput.className = "field-input";
      bodyInput.style.minHeight = "60px";
      bodyInput.style.fontFamily = "'SF Mono', 'Fira Code', 'Consolas', monospace";
      bodyInput.style.fontSize = "11px";
      bodyInput.value = def.body || "";
      let debounce;
      bodyInput.oninput = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          update(updateDef(S, name, { body: bodyInput.value }));
        }, 500);
      };
      bodyRow.appendChild(bodyInput);
      container.appendChild(bodyRow);
    }

    // Parameters editor (CEM objects)
    renderParameterEditor(container, name, def);

    // Emits editor (custom elements only)
    if (isCustomElementDoc()) {
      renderEmitsEditor(container, name, def);
    }

    // Open in editor button
    const expandBtn = document.createElement("button");
    expandBtn.className = "kv-add";
    expandBtn.textContent = "Open in editor";
    expandBtn.style.marginTop = "4px";
    expandBtn.onclick = () => {
      S = { ...S, ui: { ...S.ui, editingFunction: { type: "def", defName: name } } };
      renderCanvas();
    };
    if (!def.$src) container.appendChild(expandBtn);

    // Description
    container.appendChild(
      signalFieldRow("desc", def.description || "", (v) => {
        update(updateDef(S, name, { description: v || undefined }));
      }),
    );
  }
}

// ─── CEM Editors ─────────────────────────────────────────────────────────────

/** Normalize a parameter entry to a CEM object. */
function normParam(p) {
  return typeof p === "string" ? { name: p } : p;
}

/** Track which functions have the advanced param editor open. */
const advancedParamOpen = new Set();

/** Render CEM parameter editor with basic/advanced toggle. */
function renderParameterEditor(container, name, def) {
  const params = (def.parameters || []).map(normParam);
  const isAdvanced = advancedParamOpen.has(name);

  const wrapper = document.createElement("div");
  wrapper.className = "field-row";
  wrapper.style.flexWrap = "wrap";

  const lbl = document.createElement("label");
  lbl.className = "field-label";
  lbl.textContent = "params";
  wrapper.appendChild(lbl);

  if (!isAdvanced) {
    // ── Basic mode: name chips ──
    const chipWrap = document.createElement("div");
    chipWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;flex:1;align-items:center";

    for (let i = 0; i < params.length; i++) {
      const chip = document.createElement("span");
      chip.style.cssText = "display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:3px;background:var(--bg-hover);font-size:11px;font-family:monospace";
      chip.textContent = params[i].name || "?";
      const del = document.createElement("span");
      del.textContent = "\u00d7";
      del.style.cssText = "cursor:pointer;opacity:0.5;margin-left:2px";
      del.onclick = () => {
        const next = params.filter((_, j) => j !== i);
        update(updateDef(S, name, { parameters: next.length ? next : undefined }));
      };
      chip.appendChild(del);
      chipWrap.appendChild(chip);
    }

    // Inline add input
    const addInput = document.createElement("input");
    addInput.className = "field-input";
    addInput.style.cssText = "width:60px;flex:0 0 auto;font-size:11px";
    addInput.placeholder = "+";
    addInput.onkeydown = (e) => {
      if (e.key === "Enter" && addInput.value.trim()) {
        const next = [...params, { name: addInput.value.trim() }];
        update(updateDef(S, name, { parameters: next }));
      }
    };
    chipWrap.appendChild(addInput);
    wrapper.appendChild(chipWrap);

    // Advanced toggle
    const toggle = document.createElement("span");
    toggle.textContent = "\u25b8 Advanced";
    toggle.style.cssText = "font-size:10px;color:var(--fg-dim);cursor:pointer;width:100%;margin-top:2px";
    toggle.onclick = () => { advancedParamOpen.add(name); renderLeftPanel(); };
    wrapper.appendChild(toggle);
  } else {
    // ── Advanced mode: full rows ──
    const list = document.createElement("div");
    list.style.cssText = "flex:1;display:flex;flex-direction:column;gap:4px";

    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:4px;align-items:center";

      const nameIn = document.createElement("input");
      nameIn.className = "field-input";
      nameIn.value = p.name || "";
      nameIn.placeholder = "name";
      nameIn.style.flex = "1";
      nameIn.onchange = () => {
        const next = [...params];
        next[i] = { ...next[i], name: nameIn.value };
        update(updateDef(S, name, { parameters: next }));
      };
      row.appendChild(nameIn);

      const typeIn = document.createElement("input");
      typeIn.className = "field-input";
      typeIn.value = p.type?.text || "";
      typeIn.placeholder = "type";
      typeIn.style.flex = "1";
      typeIn.onchange = () => {
        const next = [...params];
        next[i] = { ...next[i], type: typeIn.value ? { text: typeIn.value } : undefined };
        update(updateDef(S, name, { parameters: next }));
      };
      row.appendChild(typeIn);

      const descIn = document.createElement("input");
      descIn.className = "field-input";
      descIn.value = p.description || "";
      descIn.placeholder = "desc";
      descIn.style.flex = "2";
      descIn.onchange = () => {
        const next = [...params];
        next[i] = { ...next[i], description: descIn.value || undefined };
        update(updateDef(S, name, { parameters: next }));
      };
      row.appendChild(descIn);

      const optCheck = document.createElement("input");
      optCheck.type = "checkbox";
      optCheck.title = "optional";
      optCheck.checked = !!p.optional;
      optCheck.onchange = () => {
        const next = [...params];
        next[i] = { ...next[i], optional: optCheck.checked || undefined };
        update(updateDef(S, name, { parameters: next }));
      };
      row.appendChild(optCheck);

      const del = document.createElement("span");
      del.textContent = "\u00d7";
      del.style.cssText = "cursor:pointer;opacity:0.5";
      del.onclick = () => {
        const next = params.filter((_, j) => j !== i);
        update(updateDef(S, name, { parameters: next.length ? next : undefined }));
      };
      row.appendChild(del);

      list.appendChild(row);
    }

    // Add button
    const addBtn = document.createElement("button");
    addBtn.className = "kv-add";
    addBtn.textContent = "+ Add parameter";
    addBtn.onclick = () => {
      update(updateDef(S, name, { parameters: [...params, { name: "" }] }));
    };
    list.appendChild(addBtn);

    wrapper.appendChild(list);

    // Basic toggle
    const toggle = document.createElement("span");
    toggle.textContent = "\u25be Basic";
    toggle.style.cssText = "font-size:10px;color:var(--fg-dim);cursor:pointer;width:100%;margin-top:2px";
    toggle.onclick = () => { advancedParamOpen.delete(name); renderLeftPanel(); };
    wrapper.appendChild(toggle);
  }

  container.appendChild(wrapper);
}

/** Render CEM emits editor for function state entries. */
function renderEmitsEditor(container, name, def) {
  const emits = def.emits || [];
  if (emits.length === 0 && !isCustomElementDoc()) return;

  const header = document.createElement("div");
  header.style.cssText = "font-size:11px;font-weight:600;color:var(--fg-dim);margin:8px 0 4px;text-transform:uppercase;letter-spacing:0.05em";
  header.textContent = "Emits";
  container.appendChild(header);

  for (let i = 0; i < emits.length; i++) {
    const ev = emits[i];
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:4px;align-items:center;margin-bottom:4px";

    const nameIn = document.createElement("input");
    nameIn.className = "field-input";
    nameIn.value = ev.name || "";
    nameIn.placeholder = "event name";
    nameIn.style.flex = "1";
    nameIn.onchange = () => {
      const next = [...emits];
      next[i] = { ...next[i], name: nameIn.value };
      update(updateDef(S, name, { emits: next }));
    };
    row.appendChild(nameIn);

    const typeIn = document.createElement("input");
    typeIn.className = "field-input";
    typeIn.value = ev.type?.text || "";
    typeIn.placeholder = "type";
    typeIn.style.flex = "1";
    typeIn.onchange = () => {
      const next = [...emits];
      next[i] = { ...next[i], type: typeIn.value ? { text: typeIn.value } : undefined };
      update(updateDef(S, name, { emits: next }));
    };
    row.appendChild(typeIn);

    const descIn = document.createElement("input");
    descIn.className = "field-input";
    descIn.value = ev.description || "";
    descIn.placeholder = "description";
    descIn.style.flex = "2";
    descIn.onchange = () => {
      const next = [...emits];
      next[i] = { ...next[i], description: descIn.value || undefined };
      update(updateDef(S, name, { emits: next }));
    };
    row.appendChild(descIn);

    const del = document.createElement("span");
    del.textContent = "\u00d7";
    del.style.cssText = "cursor:pointer;opacity:0.5";
    del.onclick = () => {
      const next = emits.filter((_, j) => j !== i);
      update(updateDef(S, name, { emits: next.length ? next : undefined }));
    };
    row.appendChild(del);

    container.appendChild(row);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "kv-add";
  addBtn.textContent = "+ Add event";
  addBtn.onclick = () => {
    update(updateDef(S, name, { emits: [...emits, { name: "" }] }));
  };
  container.appendChild(addBtn);
}

/** Simple field row for signal editors. */
function signalFieldRow(label, value, onChange) {
  const row = document.createElement("div");
  row.className = "field-row";
  const lbl = document.createElement("sp-field-label");
  lbl.setAttribute("size", "s");
  lbl.textContent = label;
  row.appendChild(lbl);
  const input = document.createElement("sp-textfield");
  input.setAttribute("size", "s");
  input.value = value;
  let debounce;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => onChange(input.value), 400);
  });
  row.appendChild(input);
  return row;
}

// ─── Plugin schema-driven form rendering ────────────────────────────────────

/** Keys handled by the framework — skip when rendering schema fields. */
const STUDIO_RESERVED_KEYS = new Set([
  "$prototype", "$src", "$export", "signal", "timing", "default",
  "description", "body", "parameters", "name",
  "attribute", "reflects", "deprecated", "emits",
]);

/**
 * Render config form fields from a JSON Schema `properties` object.
 * Maps schema types to appropriate form controls.
 */
function renderSchemaFields(container, schema, def, name) {
  if (!schema?.properties) return;

  const required = new Set(schema.required ?? []);

  for (const [prop, ps] of Object.entries(schema.properties)) {
    if (STUDIO_RESERVED_KEYS.has(prop)) continue;

    const currentValue = def[prop];
    const row = document.createElement("div");
    row.className = "field-row";

    const label = document.createElement("sp-field-label");
    label.setAttribute("size", "s");
    label.textContent = prop + (required.has(prop) ? " *" : "");
    if (ps.description) label.title = ps.description;
    row.appendChild(label);

    if (ps.enum) {
      // Picker dropdown
      const sel = document.createElement("sp-picker");
      sel.setAttribute("size", "s");
      if (!required.has(prop)) {
        const blankItem = document.createElement("sp-menu-item");
        blankItem.setAttribute("value", "__none__");
        blankItem.textContent = "\u2014";
        sel.appendChild(blankItem);
      }
      for (const val of ps.enum) {
        const item = document.createElement("sp-menu-item");
        item.value = val;
        item.textContent = val;
        sel.appendChild(item);
      }
      const _schemaVal = currentValue !== undefined ? String(currentValue) : ps.default !== undefined ? String(ps.default) : "__none__";
      requestAnimationFrame(() => { sel.value = _schemaVal; });
      sel.addEventListener("change", () => update(updateDef(S, name, { [prop]: sel.value === "__none__" ? undefined : sel.value })));
      row.appendChild(sel);
    } else if (ps.type === "boolean") {
      const check = document.createElement("sp-checkbox");
      check.checked = currentValue ?? ps.default ?? false;
      check.addEventListener("change", () => update(updateDef(S, name, { [prop]: check.checked })));
      row.appendChild(check);
    } else if (ps.type === "integer" || ps.type === "number") {
      const input = document.createElement("sp-number-field");
      input.setAttribute("size", "s");
      if (ps.minimum !== undefined) input.setAttribute("min", ps.minimum);
      if (ps.maximum !== undefined) input.setAttribute("max", ps.maximum);
      if (ps.type === "integer") input.setAttribute("step", "1");
      if (currentValue !== undefined) input.value = currentValue;
      if (ps.default !== undefined) input.setAttribute("placeholder", String(ps.default));
      let debounce;
      input.addEventListener("change", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const parsed = ps.type === "integer" ? parseInt(input.value, 10) : parseFloat(input.value);
          update(updateDef(S, name, { [prop]: isNaN(parsed) ? undefined : parsed }));
        }, 400);
      });
      row.appendChild(input);
    } else if (ps.format === "json-schema") {
      // Schema parameter — render as collapsible schema editor
      const wrapper = document.createElement("div");
      wrapper.className = "schema-param-editor";

      const hasValue = currentValue && typeof currentValue === "object" && Object.keys(currentValue).length > 0;
      const isRef = currentValue && typeof currentValue === "object" && currentValue.$ref;

      if (hasValue && !isRef && currentValue.properties) {
        // Render a preview of the schema's properties as chips
        const preview = document.createElement("div");
        preview.style.cssText = "display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px";
        for (const k of Object.keys(currentValue.properties)) {
          const chip = document.createElement("span");
          chip.style.cssText = "background:var(--bg-alt);padding:1px 6px;border-radius:3px;font-size:10px;color:var(--fg-dim)";
          const t = currentValue.properties[k].type ?? "any";
          chip.textContent = `${k}: ${t}`;
          preview.appendChild(chip);
        }
        wrapper.appendChild(preview);
      }

      const textarea = document.createElement("sp-textfield");
      textarea.setAttribute("multiline", "");
      textarea.setAttribute("size", "s");
      textarea.style.minHeight = hasValue ? "80px" : "40px";
      textarea.style.fontFamily = "monospace";
      textarea.style.fontSize = "11px";
      textarea.value = currentValue !== undefined ? JSON.stringify(currentValue, null, 2) : "";
      textarea.setAttribute("placeholder", ps.description ?? "JSON Schema defining the data shape\u2026");
      let debounce;
      textarea.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          try { update(updateDef(S, name, { [prop]: JSON.parse(textarea.value) })); } catch {}
        }, 500);
      });
      wrapper.appendChild(textarea);
      row.appendChild(wrapper);
    } else if (ps.type === "array" || ps.type === "object") {
      const textarea = document.createElement("sp-textfield");
      textarea.setAttribute("multiline", "");
      textarea.setAttribute("size", "s");
      textarea.style.minHeight = "40px";
      textarea.value = currentValue !== undefined ? JSON.stringify(currentValue, null, 2) : "";
      if (ps.default !== undefined) textarea.setAttribute("placeholder", JSON.stringify(ps.default));
      let debounce;
      textarea.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          try { update(updateDef(S, name, { [prop]: JSON.parse(textarea.value) })); } catch {}
        }, 500);
      });
      row.appendChild(textarea);
    } else {
      // Default: text input
      const input = document.createElement("sp-textfield");
      input.setAttribute("size", "s");
      input.value = currentValue ?? "";
      const ph = ps.default !== undefined
        ? String(ps.default)
        : (ps.examples?.[0] ?? "");
      if (ph) input.setAttribute("placeholder", ph);
      if (ps.description) input.title = ps.description;
      let debounce;
      input.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          update(updateDef(S, name, { [prop]: input.value || undefined }));
        }, 400);
      });
      row.appendChild(input);
    }

    container.appendChild(row);
  }
}

/**
 * Render editor fields for an external $prototype + $src plugin.
 * Shows $src/$export inputs plus schema-driven config fields.
 */
function renderExternalPrototypeEditor(container, name, def) {
  container.appendChild(
    signalFieldRow("$src", def.$src || "", (v) => {
      update(updateDef(S, name, { $src: v || undefined }));
      pluginSchemaCache.delete(`${v}::${def.$prototype}`);
    }),
  );
  container.appendChild(
    signalFieldRow("$prototype", def.$prototype || "", (v) => {
      update(updateDef(S, name, { $prototype: v || undefined }));
      pluginSchemaCache.delete(`${def.$src}::${v}`);
    }),
  );
  if (def.$export) {
    container.appendChild(
      signalFieldRow("$export", def.$export || "", (v) => {
        update(updateDef(S, name, { $export: v || undefined }));
      }),
    );
  }

  // Schema-driven config fields (async with cache)
  if (def.$src && def.$prototype) {
    const schemaContainer = document.createElement("div");
    container.appendChild(schemaContainer);

    const cacheKey = `${def.$src}::${def.$prototype}`;
    if (pluginSchemaCache.has(cacheKey)) {
      const schema = pluginSchemaCache.get(cacheKey);
      if (schema) {
        if (schema.description) {
          const desc = document.createElement("div");
          desc.className = "signal-hint";
          desc.style.padding = "4px 0 8px";
          desc.textContent = schema.description;
          schemaContainer.appendChild(desc);
        }
        renderSchemaFields(schemaContainer, schema, def, name);
      }
    } else {
      schemaContainer.textContent = "Loading schema\u2026";
      schemaContainer.style.cssText = "padding:4px 0;font-size:11px;color:var(--fg-dim);font-style:italic";
      fetchPluginSchema(def).then((schema) => {
        schemaContainer.textContent = "";
        schemaContainer.style.cssText = "";
        if (schema) {
          if (schema.description) {
            const desc = document.createElement("div");
            desc.className = "signal-hint";
            desc.style.padding = "4px 0 8px";
            desc.textContent = schema.description;
            schemaContainer.appendChild(desc);
          }
          renderSchemaFields(schemaContainer, schema, def, name);
        }
      });
    }
  }
}

// ─── Data Explorer ──────────────────────────────────────────────────────────

/** Expanded data entries set — persists across renders. */
const expandedDataKeys = new Set();

/** Unwrap a Vue ref (has .value and .__v_isRef) to get the underlying value. */
function unwrapSignal(value) {
  if (value && typeof value === "object" && value.__v_isRef) return value.value;
  return value;
}

/** Type label for a signal value in the data explorer. */
function dataTypeLabel(value) {
  const v = unwrapSignal(value);
  if (v === null) return "null";
  if (v === undefined) return "pending";
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (typeof v === "object") return `{${Object.keys(v).length}}`;
  return typeof v;
}

/** Render the data explorer tab showing live resolved values. */
function renderDataExplorer(container) {
  if (!liveScope) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No live data \u2014 render the document in preview mode";
    container.appendChild(empty);
    return;
  }

  // Toolbar with refresh button
  const bar = document.createElement("div");
  bar.className = "data-explorer-toolbar";
  const refreshBtn = document.createElement("sp-action-button");
  refreshBtn.setAttribute("quiet", "");
  refreshBtn.setAttribute("size", "s");
  refreshBtn.className = "data-refresh-btn";
  const refreshIcon = document.createElement("sp-icon-refresh");
  refreshIcon.setAttribute("slot", "icon");
  refreshBtn.appendChild(refreshIcon);
  refreshBtn.append("Refresh");
  refreshBtn.addEventListener("click", () => {
    renderCanvas();
    setTimeout(() => renderLeftPanel(), 200);
  });
  bar.appendChild(refreshBtn);
  container.appendChild(bar);

  // Entries
  const defs = S.document.state || {};
  for (const [name, def] of Object.entries(defs)) {
    const value = liveScope[name];
    const unwrapped = unwrapSignal(value);
    const isExpanded = expandedDataKeys.has(name);

    const row = document.createElement("div");
    row.className = "data-row";

    const header = document.createElement("div");
    header.className = `data-row-header${isExpanded ? " expanded" : ""}`;

    const badge = document.createElement("span");
    badge.className = `signal-badge ${defCategory(def)}`;
    badge.textContent = defBadgeLabel(def);
    header.appendChild(badge);

    const nameEl = document.createElement("span");
    nameEl.className = "data-name";
    nameEl.textContent = name;
    header.appendChild(nameEl);

    const typeEl = document.createElement("span");
    typeEl.className = "data-type";
    typeEl.textContent = dataTypeLabel(value);
    if (unwrapped === null) typeEl.classList.add("data-pending");
    header.appendChild(typeEl);

    header.onclick = () => {
      if (expandedDataKeys.has(name)) expandedDataKeys.delete(name);
      else expandedDataKeys.add(name);
      renderLeftPanel();
    };
    row.appendChild(header);

    if (isExpanded) {
      const tree = document.createElement("div");
      tree.className = "data-tree";
      renderDataTree(tree, unwrapped, 0);
      row.appendChild(tree);
    }

    container.appendChild(row);
  }

  if (Object.keys(defs).length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No state defined";
    container.appendChild(empty);
  }
}

/**
 * Recursively render a JSON value as a tree view.
 */
function renderDataTree(container, value, depth, maxDepth = 5) {
  const indent = `${(depth + 1) * 12}px`;

  if (depth > maxDepth) {
    const el = document.createElement("div");
    el.className = "data-leaf data-ellipsis";
    el.style.paddingLeft = indent;
    el.textContent = "\u2026";
    container.appendChild(el);
    return;
  }

  if (value === null || value === undefined) {
    const el = document.createElement("div");
    el.className = "data-leaf data-null";
    el.style.paddingLeft = indent;
    el.textContent = String(value);
    container.appendChild(el);
    return;
  }

  if (typeof value !== "object") {
    const el = document.createElement("div");
    el.className = `data-leaf data-${typeof value}`;
    el.style.paddingLeft = indent;
    el.textContent = typeof value === "string" && value.length > 200
      ? `"${value.slice(0, 200)}\u2026"`
      : JSON.stringify(value);
    container.appendChild(el);
    return;
  }

  if (Array.isArray(value)) {
    const cap = 20;
    for (let i = 0; i < Math.min(value.length, cap); i++) {
      const itemRow = document.createElement("div");
      itemRow.className = "data-branch";
      itemRow.style.paddingLeft = indent;

      const keyEl = document.createElement("span");
      keyEl.className = "data-key";
      keyEl.textContent = `[${i}] `;
      itemRow.appendChild(keyEl);

      const item = value[i];
      if (item === null || item === undefined || typeof item !== "object") {
        const valEl = document.createElement("span");
        valEl.className = `data-value data-${item === null ? "null" : typeof item}`;
        valEl.textContent = typeof item === "string" && item.length > 80
          ? `"${item.slice(0, 80)}\u2026"`
          : JSON.stringify(item);
        itemRow.appendChild(valEl);
        container.appendChild(itemRow);
      } else {
        const valEl = document.createElement("span");
        valEl.className = "data-value data-object-label";
        valEl.textContent = Array.isArray(item) ? `Array(${item.length})` : `{${Object.keys(item).length}}`;
        itemRow.appendChild(valEl);
        container.appendChild(itemRow);
        renderDataTree(container, item, depth + 1, maxDepth);
      }
    }
    if (value.length > cap) {
      const el = document.createElement("div");
      el.className = "data-leaf data-ellipsis";
      el.style.paddingLeft = indent;
      el.textContent = `\u2026 ${value.length - cap} more`;
      container.appendChild(el);
    }
    return;
  }

  // Object
  const keys = Object.keys(value);
  const cap = 30;
  for (const key of keys.slice(0, cap)) {
    const itemRow = document.createElement("div");
    itemRow.className = "data-branch";
    itemRow.style.paddingLeft = indent;

    const keyEl = document.createElement("span");
    keyEl.className = "data-key";
    keyEl.textContent = key + ": ";
    itemRow.appendChild(keyEl);

    const v = value[key];
    if (v === null || v === undefined || typeof v !== "object") {
      const valEl = document.createElement("span");
      valEl.className = `data-value data-${v === null ? "null" : typeof v}`;
      valEl.textContent = typeof v === "string" && v.length > 80
        ? `"${v.slice(0, 80)}\u2026"`
        : JSON.stringify(v);
      itemRow.appendChild(valEl);
      container.appendChild(itemRow);
    } else {
      const valEl = document.createElement("span");
      valEl.className = "data-value data-object-label";
      valEl.textContent = Array.isArray(v) ? `Array(${v.length})` : `{${Object.keys(v).length}}`;
      itemRow.appendChild(valEl);
      container.appendChild(itemRow);
      renderDataTree(container, v, depth + 1, maxDepth);
    }
  }
  if (keys.length > cap) {
    const el = document.createElement("div");
    el.className = "data-leaf data-ellipsis";
    el.style.paddingLeft = indent;
    el.textContent = `\u2026 ${keys.length - cap} more`;
    container.appendChild(el);
  }
}

// ─── File management ──────────────────────────────────────────────────────────

async function loadProject() {
  try {
    const res = await fetch("/__studio/project");
    if (!res.ok) return;
    const meta = await res.json();
    setProjectState({
      root: meta.root,
      name: meta.name,
      dirs: new Map(),
      expanded: new Set(),
      selectedPath: null,
      searchQuery: "",
    });
    await loadDirectory(".");
  } catch {
    // Not on dev server — project features disabled
  }
}

async function loadDirectory(dirPath) {
  if (!projectState) return;
  try {
    const res = await fetch(`/__studio/files?dir=${encodeURIComponent(dirPath)}`);
    if (!res.ok) return;
    const entries = await res.json();
    projectState.dirs.set(dirPath, entries);
  } catch {
    projectState.dirs.set(dirPath, []);
  }
}

function fileTypeIcon(name, type) {
  let tag;
  if (type === "directory") {
    tag = projectState?.expanded?.has(name) ? "sp-icon-folder-open" : "sp-icon-folder";
  } else {
    const ext = name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "json": tag = "sp-icon-file-code"; break;
      case "md": tag = "sp-icon-file-txt"; break;
      case "js": case "ts": tag = "sp-icon-file-code"; break;
      case "css": tag = "sp-icon-file-code"; break;
      case "png": case "jpg": case "jpeg": case "svg": case "webp": case "gif":
        tag = "sp-icon-image"; break;
      default: tag = "sp-icon-document"; break;
    }
  }
  return document.createElement(tag);
}

function renderFiles(container) {
  if (!projectState) {
    const empty = document.createElement("div");
    empty.className = "file-tree-empty";
    empty.textContent = "No project loaded";
    container.appendChild(empty);
    return;
  }

  // ─── Toolbar ────────────────────────────────────
  const toolbar = document.createElement("div");
  toolbar.className = "files-toolbar";

  const actionGroup = document.createElement("sp-action-group");
  actionGroup.size = "xs";
  actionGroup.compact = true;
  actionGroup.quiet = true;

  const btnNewFile = document.createElement("sp-action-button");
  btnNewFile.size = "xs";
  btnNewFile.label = "New File";
  const iconAdd = document.createElement("sp-icon-add");
  iconAdd.slot = "icon";
  btnNewFile.appendChild(iconAdd);
  btnNewFile.addEventListener("click", () => createNewFile());
  actionGroup.appendChild(btnNewFile);

  const btnRefresh = document.createElement("sp-action-button");
  btnRefresh.size = "xs";
  btnRefresh.label = "Refresh";
  const iconRefresh = document.createElement("sp-icon-refresh");
  iconRefresh.slot = "icon";
  btnRefresh.appendChild(iconRefresh);
  btnRefresh.addEventListener("click", async () => {
    projectState.dirs.clear();
    await loadDirectory(".");
    for (const dir of projectState.expanded) await loadDirectory(dir);
    renderLeftPanel();
  });
  actionGroup.appendChild(btnRefresh);
  toolbar.appendChild(actionGroup);

  const search = document.createElement("sp-search");
  search.size = "s";
  search.quiet = true;
  search.placeholder = "Filter files…";
  search.value = projectState.searchQuery;
  search.addEventListener("input", (e) => {
    projectState.searchQuery = e.target.value;
    renderLeftPanel();
  });
  search.addEventListener("submit", (e) => e.preventDefault());
  toolbar.appendChild(search);

  container.appendChild(toolbar);

  // ─── File tree ──────────────────────────────────
  const tree = document.createElement("div");
  tree.className = "file-tree";
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-label", "Project files");

  renderTreeLevel(tree, ".", 0);

  container.appendChild(tree);

  // ─── Keyboard navigation (roving tabindex) ──────
  setupTreeKeyboard(tree);
}

function renderTreeLevel(container, dirPath, depth) {
  const entries = projectState.dirs.get(dirPath);
  if (!entries) {
    // Lazy load: fetch this directory then re-render
    loadDirectory(dirPath).then(() => renderLeftPanel());
    const placeholder = document.createElement("div");
    placeholder.className = "file-tree-item";
    placeholder.style.paddingLeft = `${8 + depth * 16}px`;
    placeholder.textContent = "Loading…";
    placeholder.style.color = "var(--fg-dim)";
    placeholder.style.fontStyle = "italic";
    container.appendChild(placeholder);
    return;
  }

  // Sort: directories first, then files, alphabetical within each group
  const sorted = [...entries].sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    return a.name.localeCompare(b.name);
  });

  // Filter by search query
  const query = projectState.searchQuery.toLowerCase();
  const filtered = query
    ? sorted.filter((e) => {
        if (e.type === "directory") return true; // always show dirs so children can match
        return e.name.toLowerCase().includes(query);
      })
    : sorted;

  for (const entry of filtered) {
    const isDir = entry.type === "directory";
    const isExpanded = projectState.expanded.has(entry.path);
    const isSelected = projectState.selectedPath === entry.path;

    const item = document.createElement("div");
    item.className = `file-tree-item${isSelected ? " selected" : ""}`;
    item.style.paddingLeft = `${8 + depth * 16}px`;
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-level", String(depth + 1));
    item.setAttribute("tabindex", "-1");
    item.dataset.path = entry.path;
    item.dataset.type = entry.type;

    if (isDir) {
      item.setAttribute("aria-expanded", String(isExpanded));

      // Expand/collapse toggle
      const toggle = document.createElement("span");
      toggle.className = "file-tree-toggle";
      toggle.textContent = isExpanded ? "▼" : "▶";
      item.appendChild(toggle);
    } else {
      // Empty spacer for alignment
      const spacer = document.createElement("span");
      spacer.className = "file-tree-toggle empty";
      spacer.textContent = " ";
      item.appendChild(spacer);
    }

    // Icon
    const iconWrap = document.createElement("span");
    iconWrap.className = "file-tree-icon";
    iconWrap.appendChild(fileTypeIcon(entry.path, entry.type));
    item.appendChild(iconWrap);

    // Name
    const nameEl = document.createElement("span");
    nameEl.className = "file-tree-name";
    nameEl.textContent = entry.name;
    item.appendChild(nameEl);

    // Click handler
    item.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (isDir) {
        // Toggle expand/collapse
        if (isExpanded) {
          projectState.expanded.delete(entry.path);
        } else {
          projectState.expanded.add(entry.path);
          if (!projectState.dirs.has(entry.path)) {
            await loadDirectory(entry.path);
          }
        }
        renderLeftPanel();
      } else {
        openFileFromTree(entry.path);
      }
    });

    // Context menu
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showFileContextMenu(e, entry);
    });

    container.appendChild(item);

    // Render children if directory is expanded
    if (isDir && isExpanded) {
      const group = document.createElement("div");
      group.setAttribute("role", "group");
      renderTreeLevel(group, entry.path, depth + 1);
      container.appendChild(group);
    }
  }
}

function setupTreeKeyboard(tree) {
  tree.addEventListener("keydown", (e) => {
    const items = [...tree.querySelectorAll('.file-tree-item')];
    const focused = tree.querySelector('.file-tree-item:focus');
    if (!focused || items.length === 0) return;

    const idx = items.indexOf(focused);
    let handled = true;

    switch (e.key) {
      case "ArrowDown":
        if (idx < items.length - 1) items[idx + 1].focus();
        break;
      case "ArrowUp":
        if (idx > 0) items[idx - 1].focus();
        break;
      case "ArrowRight":
        if (focused.dataset.type === "directory") {
          const path = focused.dataset.path;
          if (!projectState.expanded.has(path)) {
            projectState.expanded.add(path);
            loadDirectory(path).then(() => renderLeftPanel());
          }
        }
        break;
      case "ArrowLeft":
        if (focused.dataset.type === "directory") {
          const path = focused.dataset.path;
          if (projectState.expanded.has(path)) {
            projectState.expanded.delete(path);
            renderLeftPanel();
          }
        }
        break;
      case "Enter":
        focused.click();
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  });

  // Set first item focusable
  const first = tree.querySelector('.file-tree-item');
  if (first) first.setAttribute("tabindex", "0");
}

/** Context menu for file tree items using Spectrum popover + menu */
let fileContextPopover = null;

function showFileContextMenu(e, entry) {
  // Remove any existing popover
  if (fileContextPopover) {
    fileContextPopover.remove();
    fileContextPopover = null;
  }

  const isDir = entry.type === "directory";

  const popover = document.createElement("sp-popover");
  popover.placement = "right-start";
  popover.open = true;
  popover.style.position = "fixed";
  popover.style.left = `${e.clientX}px`;
  popover.style.top = `${e.clientY}px`;
  popover.style.zIndex = "9999";

  const menu = document.createElement("sp-menu");
  menu.style.minWidth = "160px";

  if (!isDir) {
    const openItem = document.createElement("sp-menu-item");
    openItem.textContent = "Open";
    openItem.addEventListener("click", () => {
      closeFileContextMenu();
      openFileFromTree(entry.path);
    });
    menu.appendChild(openItem);
  }

  if (isDir) {
    const newFileItem = document.createElement("sp-menu-item");
    newFileItem.textContent = "New File…";
    newFileItem.addEventListener("click", () => {
      closeFileContextMenu();
      createNewFile(entry.path);
    });
    menu.appendChild(newFileItem);
  }

  const divider = document.createElement("sp-menu-divider");
  menu.appendChild(divider);

  const renameItem = document.createElement("sp-menu-item");
  renameItem.textContent = "Rename…";
  renameItem.addEventListener("click", () => {
    closeFileContextMenu();
    renameFile(entry);
  });
  menu.appendChild(renameItem);

  const deleteItem = document.createElement("sp-menu-item");
  deleteItem.textContent = "Delete";
  deleteItem.style.color = "var(--danger)";
  deleteItem.addEventListener("click", () => {
    closeFileContextMenu();
    deleteFile(entry);
  });
  menu.appendChild(deleteItem);

  popover.appendChild(menu);
  document.body.appendChild(popover);
  fileContextPopover = popover;

  // Close on click outside
  const closeHandler = (ev) => {
    if (!popover.contains(ev.target)) {
      closeFileContextMenu();
      document.removeEventListener("mousedown", closeHandler, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", closeHandler, true), 0);
}

function closeFileContextMenu() {
  if (fileContextPopover) {
    fileContextPopover.remove();
    fileContextPopover = null;
  }
}

async function createNewFile(dirPath = ".") {
  const name = prompt("File name:", "untitled.json");
  if (!name) return;
  const path = dirPath === "." ? name : `${dirPath}/${name}`;
  const content = name.endsWith(".md")
    ? "---\ntitle: Untitled\n---\n\n"
    : JSON.stringify({ tagName: "div", children: [] }, null, 2);
  try {
    await fetch(`/__studio/file?path=${encodeURIComponent(path)}`, {
      method: "PUT",
      body: content,
    });
    // Refresh the directory
    await loadDirectory(dirPath);
    renderLeftPanel();
    statusMessage(`Created ${path}`);
  } catch (e) {
    statusMessage(`Error: ${e.message}`);
  }
}

async function renameFile(entry) {
  const newName = prompt("New name:", entry.name);
  if (!newName || newName === entry.name) return;
  const parentDir = entry.path.includes("/")
    ? entry.path.substring(0, entry.path.lastIndexOf("/"))
    : ".";
  const newPath = parentDir === "." ? newName : `${parentDir}/${newName}`;
  try {
    await fetch("/__studio/file/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: entry.path, to: newPath }),
    });
    await loadDirectory(parentDir);
    if (projectState.selectedPath === entry.path) {
      projectState.selectedPath = newPath;
    }
    renderLeftPanel();
    statusMessage(`Renamed to ${newName}`);
  } catch (e) {
    statusMessage(`Error: ${e.message}`);
  }
}

async function deleteFile(entry) {
  if (!confirm(`Delete "${entry.name}"?`)) return;
  try {
    await fetch(`/__studio/file?path=${encodeURIComponent(entry.path)}`, {
      method: "DELETE",
    });
    const parentDir = entry.path.includes("/")
      ? entry.path.substring(0, entry.path.lastIndexOf("/"))
      : ".";
    await loadDirectory(parentDir);
    if (projectState.selectedPath === entry.path) {
      projectState.selectedPath = null;
    }
    renderLeftPanel();
    statusMessage(`Deleted ${entry.name}`);
  } catch (e) {
    statusMessage(`Error: ${e.message}`);
  }
}

async function openFileFromTree(path) {
  // Auto-save current dirty document if on dev server
  if (S.dirty && S.documentPath) {
    try {
      const isContent = S.mode === "content";
      let output;
      if (isContent) {
        const mdast = jsonsxToMd(S.document);
        const md = unified()
          .use(remarkStringify, { bullet: "-", emphasis: "*", strong: "*" })
          .stringify(mdast);
        const fm = S.content?.frontmatter;
        const hasFrontmatter = fm && Object.keys(fm).length > 0;
        output = hasFrontmatter ? `---\n${stringifyYaml(fm).trim()}\n---\n\n${md}` : md;
      } else {
        output = JSON.stringify(S.document, null, 2);
      }
      await fetch(`/__studio/file?path=${encodeURIComponent(S.documentPath)}`, {
        method: "PUT",
        body: output,
      });
    } catch (e) {
      statusMessage(`Save error: ${e.message}`);
    }
  }

  // Fetch the file
  try {
    const res = await fetch(`/__studio/file?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (!data.content) return;

    if (path.endsWith(".md")) {
      loadMarkdown(data.content, null);
      S.documentPath = data.path;
    } else {
      const doc = JSON.parse(data.content);
      S = createState(doc);
      S.documentPath = data.path;
      S.dirty = false;
    }

    // Update tree selection
    projectState.selectedPath = path;

    render();
    statusMessage(`Opened ${data.path}`);
  } catch (e) {
    statusMessage(`Error: ${e.message}`);
  }
}

// ─── Right panel: Inspector ───────────────────────────────────────────────────

function renderRightPanel() {
  const tab = S.ui.rightTab;

  // ── Icon tabs ──────────────────────────────────────────────────────────
  const panelTabs = [
    { value: "properties", icon: "sp-icon-properties", label: "Properties" },
    { value: "events",     icon: "sp-icon-event",      label: "Events" },
    { value: "style",      icon: "sp-icon-brush",       label: "Style" },
  ];

  const tabsT = html`
    <div class="panel-tabs">
      <sp-tabs selected=${tab} quiet
        @change=${(e) => {
          const sel = e.target.selected;
          if (sel && sel !== tab) {
            S = { ...S, ui: { ...S.ui, rightTab: sel } };
            renderRightPanel();
            renderOverlays();
          }
        }}>
        ${panelTabs.map((t) => html`
          <sp-tab value=${t.value} title=${t.label} aria-label=${t.label}>
            ${tabIcon(t.icon, "xs")}
          </sp-tab>
        `)}
      </sp-tabs>
    </div>
  `;

  // ── Panel body ────────────────────────────────────────────────────────
  let bodyT = nothing;
  if (tab === "properties") {
    bodyT = propertiesSidebarTemplate();
  } else if (tab === "events") {
    bodyT = eventsSidebarTemplate();
  } else if (tab === "style") {
    try { bodyT = renderStylePanelTemplate(); } catch(e) { console.error("[renderStylePanelTemplate]", e); }
  }

  const tpl = html`
    ${tabsT}
    <div class="panel-body">${bodyT}</div>
  `;

  litRender(tpl, rightPanel);

  updateForcedPseudoPreview();
}

// ─── Inspector ────────────────────────────────────────────────────────────────

/** Properties panel — lit-html template with accordion sections */
function propertiesSidebarTemplate() {
  if (!S.selection) return html`<div class="empty-state">Select an element to inspect</div>`;
  const node = getNodeAtPath(S.document, S.selection);
  if (!node) return html`<div class="empty-state">Node not found</div>`;

  const path = S.selection;
  const isMapNode = node.$prototype === "Array";
  const isMapParent = node.children && typeof node.children === "object" && node.children.$prototype === "Array";
  const isSwitchNode = !!node.$switch;
  const isCustomInstance = (node.tagName || "").includes("-");
  const isRoot = path.length === 0;
  const tagName = node.tagName || "div";
  const attrs = node.attributes || {};

  const mapSignals = isInsideMapTemplate(path)
    ? [{ value: "$map/item", label: "$map/item" }, { value: "$map/index", label: "$map/index" }]
    : null;

  // Helper: render an attribute row using the style-row pattern
  function renderAttrRow(attr, entry, value) {
    const type = inferInputType(entry);
    const hasVal = value !== undefined && value !== "";

    // Boolean attributes render as checkboxes
    if (entry.type === "boolean") {
      return html`
        <div class="style-row" data-prop=${attr}>
          <div class="style-row-label">
            ${hasVal ? html`<span class="set-dot" title="Clear ${attr}"
              @click=${(e) => { e.stopPropagation(); update(updateAttribute(S, path, attr, undefined)); }}></span>` : nothing}
            <sp-field-label size="s" title=${attr}>${attrLabel(entry, attr)}</sp-field-label>
          </div>
          <sp-checkbox size="s" .checked=${live(!!value)}
            @change=${(e) => update(updateAttribute(S, path, attr, e.target.checked || undefined))}>
          </sp-checkbox>
        </div>
      `;
    }

    return html`
      <div class="style-row" data-prop=${attr}>
        <div class="style-row-label">
          ${hasVal ? html`<span class="set-dot" title="Clear ${attr}"
            @click=${(e) => { e.stopPropagation(); update(updateAttribute(S, path, attr, undefined)); }}></span>` : nothing}
          <sp-field-label size="s" title=${attr}>${attrLabel(entry, attr)}</sp-field-label>
        </div>
        ${widgetForType(type, entry, attr, value || "", (v) => update(updateAttribute(S, path, attr, v || undefined)))}
      </div>
    `;
  }

  // ── Collect applicable attributes from html-meta ──
  const applicableAttrs = {};
  for (const [attr, entry] of Object.entries(htmlMeta.$defs)) {
    if (!entry.$elements || entry.$elements.includes(tagName)) {
      applicableAttrs[attr] = entry;
    }
  }

  // Partition into sections
  const attrSections = {};
  for (const sec of htmlMeta.$sections) attrSections[sec.key] = [];
  for (const [attr, entry] of Object.entries(applicableAttrs)) {
    const secKey = entry.$section;
    if (attrSections[secKey]) attrSections[secKey].push({ name: attr, entry });
  }
  for (const sec of htmlMeta.$sections) {
    attrSections[sec.key].sort((a, b) => a.entry.$order - b.entry.$order);
  }

  // Collect "custom" attributes (not in html-meta)
  const knownAttrNames = new Set(Object.keys(applicableAttrs));
  const customAttrs = Object.entries(attrs).filter(([k]) => !knownAttrNames.has(k));

  // Auto-open sections that have set values
  const autoOpen = new Set();
  for (const [attr] of Object.entries(attrs)) {
    const entry = applicableAttrs[attr];
    if (entry) autoOpen.add(entry.$section);
  }
  // Also auto-open if there are custom attrs
  if (customAttrs.length > 0) autoOpen.add("__custom");

  function isSectionOpen(key) {
    if (S.ui.inspectorSections[key] !== undefined) return S.ui.inspectorSections[key];
    return autoOpen.has(key);
  }

  function toggleSection(key) {
    const current = isSectionOpen(key);
    S = { ...S, ui: { ...S.ui, inspectorSections: { ...S.ui.inspectorSections, [key]: !current } } };
    renderRightPanel();
  }

  // ── Build section templates ─────────────────────────────────────────

  // "Element" section — tagName, textContent, hidden
  const elemT = html`
    <sp-accordion-item label="Element" ?open=${isSectionOpen("__element") !== false}
      @sp-accordion-item-toggle=${() => toggleSection("__element")}>
      <div class="style-section-body">
        <div class="style-row" data-prop="tagName">
          <div class="style-row-label">
            <sp-field-label size="s">Tag</sp-field-label>
          </div>
          <sp-textfield size="s" .value=${live(tagName)} autocomplete="off" list="tag-names"
            @input=${debouncedStyleCommit("prop:tagName", 400, (e) => {
              update(updateProperty(S, path, "tagName", e.target.value || undefined));
            })}></sp-textfield>
        </div>
        <div class="style-row" data-prop="$id">
          <div class="style-row-label">
            ${node.$id ? html`<span class="set-dot" title="Clear $id"
              @click=${(e) => { e.stopPropagation(); update(updateProperty(S, path, "$id", undefined)); }}></span>` : nothing}
            <sp-field-label size="s">ID</sp-field-label>
          </div>
          <sp-textfield size="s" .value=${live(node.$id || "")}
            @input=${debouncedStyleCommit("prop:$id", 400, (e) => {
              update(updateProperty(S, path, "$id", e.target.value || undefined));
            })}></sp-textfield>
        </div>
        <div class="style-row" data-prop="className">
          <div class="style-row-label">
            ${node.className ? html`<span class="set-dot" title="Clear class"
              @click=${(e) => { e.stopPropagation(); update(updateProperty(S, path, "className", undefined)); }}></span>` : nothing}
            <sp-field-label size="s">Class</sp-field-label>
          </div>
          <sp-textfield size="s" .value=${live(node.className || "")}
            @input=${debouncedStyleCommit("prop:className", 400, (e) => {
              update(updateProperty(S, path, "className", e.target.value || undefined));
            })}></sp-textfield>
        </div>
        ${!Array.isArray(node.children) || node.children.length === 0 ? html`
          <div class="style-row" data-prop="textContent">
            <div class="style-row-label">
              ${node.textContent !== undefined ? html`<span class="set-dot" title="Clear text"
                @click=${(e) => { e.stopPropagation(); update(updateProperty(S, path, "textContent", undefined)); }}></span>` : nothing}
              <sp-field-label size="s">Text Content</sp-field-label>
            </div>
            <sp-textfield size="s" multiline .value=${live(typeof node.textContent === "string" ? node.textContent : (node.textContent ?? ""))}
              @input=${debouncedStyleCommit("prop:textContent", 400, (e) => {
                update(updateProperty(S, path, "textContent", e.target.value || undefined));
              })}></sp-textfield>
          </div>
        ` : nothing}
        <div class="style-row" data-prop="hidden">
          <div class="style-row-label">
            ${node.hidden ? html`<span class="set-dot" title="Clear hidden"
              @click=${(e) => { e.stopPropagation(); update(updateProperty(S, path, "hidden", undefined)); }}></span>` : nothing}
            <sp-field-label size="s">Hidden</sp-field-label>
          </div>
          <sp-checkbox size="s" .checked=${live(!!node.hidden)}
            @change=${(e) => update(updateProperty(S, path, "hidden", e.target.checked || undefined))}>
          </sp-checkbox>
        </div>
        ${isMapParent ? html`
          <div style="font-size:10px;color:var(--fg-dim);padding:4px 0;font-style:italic">
            Children: Repeater (select in layers to configure)
          </div>
        ` : nothing}
      </div>
    </sp-accordion-item>
  `;

  // "Repeater" section (if $map node)
  const repeaterT = isMapNode ? html`
    <sp-accordion-item label="Repeater" open>
      <div class="style-section-body" id="inspector-repeater"></div>
    </sp-accordion-item>
  ` : nothing;

  // "$switch" section
  const switchT = isSwitchNode ? html`
    <sp-accordion-item label="Switch" open>
      <div class="style-section-body" id="inspector-switch"></div>
    </sp-accordion-item>
  ` : nothing;

  // "Observed Attributes" section (custom element doc root)
  const observedAttrsT = (isCustomElementDoc() && isRoot) ? (() => {
    const state = S.document.state || {};
    const entries = Object.entries(state).filter(([, d]) => d.attribute);
    return html`
      <sp-accordion-item label="Observed Attributes" ?open=${isSectionOpen("__observed")}>
        <div class="style-section-body">
          ${entries.length === 0
            ? html`<div class="empty-state">No attributes declared. Set "attribute" on a state entry.</div>`
            : entries.map(([key, d]) => html`
              <div style="display:flex;gap:6px;align-items:center;padding:2px 0;font-size:11px">
                <code style="font-family:monospace;color:var(--accent)">${d.attribute}</code>
                <span style="color:var(--fg-dim)"> → </span>
                <span>${key}</span>
                ${d.type ? html`<span style="margin-left:auto;color:var(--fg-dim);font-size:10px">${d.type}</span>` : nothing}
                ${d.reflects ? html`<span style="font-size:9px;background:var(--bg-hover);padding:1px 4px;border-radius:3px">reflects</span>` : nothing}
              </div>
            `)
          }
        </div>
      </sp-accordion-item>
    `;
  })() : nothing;

  // "Component Props" section
  const compPropsT = isCustomInstance ? (() => {
    const comp = componentRegistry.find((c) => c.tagName === tagName);
    if (!comp) return html`
      <sp-accordion-item label="Component Props" open>
        <div class="style-section-body">
          <div class="empty-state">Component "${tagName}" not found in project</div>
        </div>
      </sp-accordion-item>
    `;
    const currentProps = node.$props || {};
    return html`
      <sp-accordion-item label="Component Props" open>
        <div class="style-section-body" id="inspector-comp-props"></div>
      </sp-accordion-item>
    `;
  })() : nothing;

  // HTML-meta attribute sections
  const attrSectionTemplates = htmlMeta.$sections
    .filter((sec) => attrSections[sec.key].length > 0)
    .map((sec) => {
      const sectionAttrs = attrSections[sec.key];
      const hasAnySet = sectionAttrs.some((a) => attrs[a.name] !== undefined);
      return html`
        <sp-accordion-item label=${sec.label}
          ?open=${isSectionOpen(sec.key)}
          @sp-accordion-item-toggle=${() => toggleSection(sec.key)}>
          ${hasAnySet ? html`<span slot="heading" class="set-dot set-dot--section"></span>` : nothing}
          <div class="style-section-body">
            ${sectionAttrs.map((a) => renderAttrRow(a.name, a.entry, attrs[a.name]))}
          </div>
        </sp-accordion-item>
      `;
    });

  // "Custom" attributes section (not in html-meta)
  const customSectionT = customAttrs.length > 0 || Object.keys(attrs).length > 0 ? html`
    <sp-accordion-item label="Custom"
      ?open=${isSectionOpen("__custom")}
      @sp-accordion-item-toggle=${() => toggleSection("__custom")}>
      ${customAttrs.length > 0 ? html`<span slot="heading" class="set-dot set-dot--section"></span>` : nothing}
      <div class="style-section-body" id="inspector-custom-attrs"></div>
    </sp-accordion-item>
  ` : nothing;

  // Media section (root only)
  const mediaT = isRoot ? html`
    <sp-accordion-item label="Media"
      ?open=${isSectionOpen("__media")}
      @sp-accordion-item-toggle=${() => toggleSection("__media")}>
      <div class="style-section-body" id="inspector-media"></div>
    </sp-accordion-item>
  ` : nothing;

  // CSS Properties + CSS Parts (custom element doc root)
  const cssPropsT = (isCustomElementDoc() && isRoot) ? (() => {
    const style = node.style || {};
    const cssProps = Object.entries(style).filter(([k]) => k.startsWith("--"));
    if (cssProps.length === 0) return nothing;
    return html`
      <sp-accordion-item label="CSS Properties"
        ?open=${isSectionOpen("__cssprops")}
        @sp-accordion-item-toggle=${() => toggleSection("__cssprops")}>
        <div class="style-section-body">
          ${cssProps.map(([prop, val]) => html`
            <div style="display:flex;gap:6px;align-items:center;padding:2px 0;font-size:11px">
              <code style="font-family:monospace;color:var(--accent)">${prop}</code>
              <span style="margin-left:auto;color:var(--fg-dim)">${String(val)}</span>
            </div>
          `)}
        </div>
      </sp-accordion-item>
    `;
  })() : nothing;

  const cssPartsT = (isCustomElementDoc() && isRoot) ? (() => {
    const parts = collectCssParts(S.document);
    if (parts.length === 0) return nothing;
    return html`
      <sp-accordion-item label="CSS Parts"
        ?open=${isSectionOpen("__cssparts")}
        @sp-accordion-item-toggle=${() => toggleSection("__cssparts")}>
        <div class="style-section-body">
          ${parts.map((p) => html`
            <div style="display:flex;gap:6px;align-items:center;padding:2px 0;font-size:11px">
              <code style="font-family:monospace;color:var(--accent)">${p.name}</code>
              <span style="color:var(--fg-dim)">&lt;${p.tag}&gt;</span>
            </div>
          `)}
        </div>
      </sp-accordion-item>
    `;
  })() : nothing;

  // ── Assemble ──
  const tpl = html`
    <div class="style-sidebar">
      <sp-accordion allow-multiple size="s">
        ${isMapNode ? repeaterT : elemT}
        ${isMapNode ? nothing : observedAttrsT}
        ${isMapNode ? nothing : switchT}
        ${isMapNode ? nothing : compPropsT}
        ${isMapNode ? nothing : attrSectionTemplates}
        ${isMapNode ? nothing : customSectionT}
        ${isMapNode ? nothing : mediaT}
        ${isMapNode ? nothing : cssPropsT}
        ${isMapNode ? nothing : cssPartsT}
      </sp-accordion>
    </div>
  `;

  // Schedule imperative rendering for sections that need it (bind toggles, complex interactions)
  requestAnimationFrame(() => {
    // Repeater section
    if (isMapNode) {
      const container = rightPanel.querySelector("#inspector-repeater");
      if (container && !container._rendered) {
        container._rendered = true;
        renderRepeaterFields(container, node, path, mapSignals);
      }
    }
    // Switch section
    if (isSwitchNode) {
      const container = rightPanel.querySelector("#inspector-switch");
      if (container && !container._rendered) {
        container._rendered = true;
        renderSwitchFields(container, node, path, mapSignals);
      }
    }
    // Component Props (needs bindableFieldRow)
    if (isCustomInstance) {
      const container = rightPanel.querySelector("#inspector-comp-props");
      if (container && !container._rendered) {
        container._rendered = true;
        renderComponentPropsFields(container, node, path, mapSignals);
      }
    }
    // Custom attrs (kvRow)
    const customContainer = rightPanel.querySelector("#inspector-custom-attrs");
    if (customContainer && !customContainer._rendered) {
      customContainer._rendered = true;
      renderCustomAttrsFields(customContainer, node, path, attrs, knownAttrNames);
    }
    // Media section
    if (isRoot) {
      const mediaContainer = rightPanel.querySelector("#inspector-media");
      if (mediaContainer && !mediaContainer._rendered) {
        mediaContainer._rendered = true;
        renderMediaFields(mediaContainer, node);
      }
    }
  });

  return tpl;
}

/** Imperative helper: repeater fields */
function renderRepeaterFields(container, node, path, mapSignals) {
  container.appendChild(
    bindableFieldRow("Items", "text", node.items, (v) => update(updateProperty(S, path, "items", v))),
  );
  if (node.filter) {
    container.appendChild(
      bindableFieldRow("Filter", "text", node.filter, (v) => update(updateProperty(S, path, "filter", v || undefined))),
    );
  }
  if (node.sort) {
    container.appendChild(
      bindableFieldRow("Sort", "text", node.sort, (v) => update(updateProperty(S, path, "sort", v || undefined))),
    );
  }
  const addRow = document.createElement("div");
  addRow.style.cssText = "display:flex;gap:8px;margin-top:4px";
  if (!node.filter) {
    const addFilter = document.createElement("span");
    addFilter.className = "kv-add";
    addFilter.textContent = "+ Add filter";
    addFilter.onclick = () => update(updateProperty(S, path, "filter", { $ref: "#/state/" }));
    addRow.appendChild(addFilter);
  }
  if (!node.sort) {
    const addSort = document.createElement("span");
    addSort.className = "kv-add";
    addSort.textContent = "+ Add sort";
    addSort.onclick = () => update(updateProperty(S, path, "sort", { $ref: "#/state/" }));
    addRow.appendChild(addSort);
  }
  container.appendChild(addRow);
  if (node.map) {
    const navBtn = document.createElement("sp-action-button");
    navBtn.setAttribute("size", "s");
    navBtn.textContent = "Edit template →";
    navBtn.style.cssText = "margin-top:8px;width:100%";
    navBtn.addEventListener("click", () => update(selectNode(S, [...path, "map"])));
    container.appendChild(navBtn);
  }
}

/** Imperative helper: switch fields */
function renderSwitchFields(container, node, path, mapSignals) {
  container.appendChild(
    bindableFieldRow("Expression", "text", node.$switch, (v) => update(updateProperty(S, path, "$switch", v)), null, mapSignals),
  );
  const casesHeader = document.createElement("div");
  casesHeader.style.cssText = "font-size:11px;font-weight:600;color:var(--fg-dim);margin:8px 0 4px;text-transform:uppercase;letter-spacing:0.05em";
  casesHeader.textContent = "Cases";
  container.appendChild(casesHeader);
  for (const caseName of Object.keys(node.cases || {})) {
    const caseRow = document.createElement("div");
    caseRow.className = "field-row";
    caseRow.style.cssText = "display:flex;align-items:center;gap:4px;margin-bottom:3px";
    const nameInput = document.createElement("input");
    nameInput.className = "field-input";
    nameInput.value = caseName;
    nameInput.style.flex = "1";
    let debounce;
    nameInput.oninput = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (nameInput.value && nameInput.value !== caseName) update(renameSwitchCase(S, path, caseName, nameInput.value));
      }, 500);
    };
    caseRow.appendChild(nameInput);
    const navBtn = document.createElement("span");
    navBtn.className = "bind-toggle";
    navBtn.textContent = "→";
    navBtn.title = "Edit case";
    navBtn.style.cursor = "pointer";
    navBtn.onclick = (e) => { e.stopPropagation(); update(selectNode(S, [...path, "cases", caseName])); };
    caseRow.appendChild(navBtn);
    const del = document.createElement("span");
    del.style.cssText = "cursor:pointer;color:var(--danger);font-size:11px";
    del.textContent = "\u2715";
    del.onclick = (e) => { e.stopPropagation(); update(removeSwitchCase(S, path, caseName)); };
    caseRow.appendChild(del);
    container.appendChild(caseRow);
  }
  const addCase = document.createElement("span");
  addCase.className = "kv-add";
  addCase.textContent = "+ Add case";
  addCase.onclick = () => {
    const existing = Object.keys(node.cases || {});
    update(addSwitchCase(S, path, `case${existing.length + 1}`));
  };
  container.appendChild(addCase);
}

/** Imperative helper: component props fields */
function renderComponentPropsFields(container, node, path, mapSignals) {
  const comp = componentRegistry.find((c) => c.tagName === node.tagName);
  if (!comp) {
    container.innerHTML = '<div class="empty-state">Component not found</div>';
    return;
  }
  const currentProps = node.$props || {};
  for (const prop of comp.props) {
    container.appendChild(
      bindableFieldRow(camelToLabel(prop.name), "text", currentProps[prop.name], (v) => update(updateProp(S, path, prop.name, v)), null, mapSignals),
    );
  }
  if (comp.props.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-state";
    hint.textContent = "No props defined";
    container.appendChild(hint);
  }
  const editLink = document.createElement("span");
  editLink.className = "kv-add";
  editLink.textContent = "→ Edit definition";
  editLink.onclick = () => navigateToComponent(comp.path);
  container.appendChild(editLink);
}

/** Imperative helper: custom (non-meta) attributes */
function renderCustomAttrsFields(container, node, path, attrs, knownAttrNames) {
  const customAttrs = Object.entries(attrs).filter(([k]) => !knownAttrNames.has(k));
  for (const [attr, val] of customAttrs) {
    container.appendChild(
      kvRow(
        attr,
        String(val),
        (newAttr, newVal) => {
          if (newAttr !== attr) {
            let s = updateAttribute(S, path, attr, undefined);
            s = updateAttribute(s, path, newAttr, newVal);
            update(s);
          } else {
            update(updateAttribute(S, path, attr, newVal));
          }
        },
        () => update(updateAttribute(S, path, attr, undefined)),
      ),
    );
  }
  const add = document.createElement("span");
  add.className = "kv-add";
  add.textContent = "+ Add attribute";
  add.onclick = () => update(updateAttribute(S, path, "data-", ""));
  container.appendChild(add);
}

/** Imperative helper: media breakpoint fields */
function renderMediaFields(container, node) {
  const media = node.$media || {};

  // ── Default canvas width ("--" key) ──
  const baseRow = document.createElement("div");
  baseRow.className = "kv-row";
  baseRow.style.alignItems = "center";

  const baseLabel = document.createElement("span");
  baseLabel.className = "field-label";
  baseLabel.style.width = "auto";
  baseLabel.style.marginRight = "4px";
  baseLabel.textContent = "Base width";
  baseRow.appendChild(baseLabel);

  const baseInput = document.createElement("input");
  baseInput.className = "field-input";
  baseInput.style.width = "70px";
  baseInput.style.flex = "none";
  baseInput.placeholder = "320px";
  baseInput.value = media["--"] || "";
  let baseDebounce;
  baseInput.oninput = () => {
    clearTimeout(baseDebounce);
    baseDebounce = setTimeout(() => {
      const val = baseInput.value.trim();
      if (val) update(updateMedia(S, "--", val));
      else update(updateMedia(S, "--", undefined));
    }, 400);
  };
  baseRow.appendChild(baseInput);

  if (media["--"]) {
    const del = document.createElement("span");
    del.className = "kv-del";
    del.textContent = "\u2715";
    del.onclick = () => update(updateMedia(S, "--", undefined));
    baseRow.appendChild(del);
  }
  container.appendChild(baseRow);

  // ── Breakpoint rows (excluding "--") ──
  for (const [name, query] of Object.entries(media)) {
    if (name === "--") continue;
    container.appendChild(mediaBreakpointRow(name, query));
  }

  // ── Add breakpoint flow ──
  const addWrap = document.createElement("div");

  const addLink = document.createElement("span");
  addLink.className = "kv-add";
  addLink.textContent = "+ Add breakpoint";
  addLink.onclick = () => {
    addLink.style.display = "none";
    addForm.style.display = "";
    nameInput.focus();
  };
  addWrap.appendChild(addLink);

  const addForm = document.createElement("div");
  addForm.style.display = "none";
  addForm.style.marginTop = "4px";

  const nameRow = document.createElement("div");
  nameRow.style.cssText = "display:flex;gap:4px;margin-bottom:3px;align-items:center";
  const nameInput = document.createElement("input");
  nameInput.className = "field-input";
  nameInput.placeholder = "Name (e.g. Tablet)";
  nameInput.style.flex = "1";
  const namePreview = document.createElement("span");
  namePreview.style.cssText = "font-size:10px;color:var(--fg-dim);font-family:'SF Mono','Fira Code',monospace;white-space:nowrap";
  nameInput.oninput = () => {
    const gen = friendlyNameToMedia(nameInput.value);
    namePreview.textContent = gen || "";
  };
  nameRow.appendChild(nameInput);
  nameRow.appendChild(namePreview);
  addForm.appendChild(nameRow);

  const queryRow = document.createElement("div");
  queryRow.style.cssText = "display:flex;gap:4px;margin-bottom:3px;align-items:center";
  const queryInput = document.createElement("input");
  queryInput.className = "field-input";
  queryInput.value = "(min-width: 768px)";
  queryInput.style.flex = "1";
  queryRow.appendChild(queryInput);
  addForm.appendChild(queryRow);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:4px";
  const addBtn = document.createElement("button");
  addBtn.className = "kv-add";
  addBtn.style.cssText = "padding:2px 10px;cursor:pointer";
  addBtn.textContent = "Add";
  addBtn.onclick = () => {
    const key = friendlyNameToMedia(nameInput.value);
    const q = queryInput.value.trim();
    if (key && q) {
      update(updateMedia(S, key, q));
    }
  };
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "kv-add";
  cancelBtn.style.cssText = "padding:2px 10px;cursor:pointer;color:var(--fg-dim)";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => {
    addForm.style.display = "none";
    addLink.style.display = "";
    nameInput.value = "";
    namePreview.textContent = "";
    queryInput.value = "(min-width: 768px)";
  };
  btnRow.appendChild(addBtn);
  btnRow.appendChild(cancelBtn);
  addForm.appendChild(btnRow);

  addWrap.appendChild(addForm);
  container.appendChild(addWrap);
}

/**
 * Render a single media breakpoint row with friendly name label, subtitle, and editable query.
 */
function mediaBreakpointRow(name, query) {
  const row = document.createElement("div");
  row.style.cssText = "margin-bottom:6px;padding:4px 0;border-bottom:1px solid var(--border)";

  // Header: friendly name (editable) + raw key
  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:4px;margin-bottom:2px";

  const friendlyInput = document.createElement("input");
  friendlyInput.className = "field-input";
  friendlyInput.value = mediaDisplayName(name);
  friendlyInput.style.cssText = "flex:1;font-weight:600;font-size:12px";

  const rawLabel = document.createElement("span");
  rawLabel.style.cssText = "font-size:10px;color:var(--fg-dim);font-family:'SF Mono','Fira Code',monospace;white-space:nowrap";
  rawLabel.textContent = name;

  const del = document.createElement("span");
  del.className = "kv-del";
  del.textContent = "\u2715";
  del.onclick = () => update(updateMedia(S, name, undefined));

  header.appendChild(friendlyInput);
  header.appendChild(rawLabel);
  header.appendChild(del);
  row.appendChild(header);

  // Query value row
  const valRow = document.createElement("div");
  valRow.style.cssText = "display:flex;gap:4px;align-items:center";
  const valInput = document.createElement("input");
  valInput.className = "field-input";
  valInput.value = query;
  valInput.style.flex = "1";

  let debounceTimer;

  // Rename on friendly name change
  friendlyInput.oninput = () => {
    const newKey = friendlyNameToMedia(friendlyInput.value);
    rawLabel.textContent = newKey || "";
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (newKey && newKey !== name) {
        let s = updateMedia(S, name, undefined);
        s = updateMedia(s, newKey, valInput.value);
        update(s);
      }
    }, 600);
  };

  // Query change
  valInput.oninput = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      update(updateMedia(S, name, valInput.value));
    }, 400);
  };

  valRow.appendChild(valInput);
  row.appendChild(valRow);
  return row;
}

// ─── Style Sidebar (metadata-driven) ───────────────────────────────────────────

const UNIT_RE = /^(-?[\d.]+)(px|rem|em|%|vw|vh|svw|svh|dvh|ms|s|fr|ch|ex|deg)?$/;

// inferInputType — imported from studio-utils.js

function conditionPasses(cond, styles) {
  const val = styles[cond.prop] ?? "";
  if (cond.values.length === 0) return val !== "" && val !== "initial";
  return cond.values.includes(val);
}

function allConditionsPass(entry, styles) {
  return (entry.$show ?? []).every((c) => conditionPasses(c, styles));
}

function autoOpenSections(node, currentSections) {
  const style = node.style || {};
  const result = { ...currentSections };
  for (const prop of Object.keys(style)) {
    if (typeof style[prop] === "object") continue;
    const entry = cssMeta.$defs[prop];
    const section = entry?.$section ?? "other";
    if (!result[section]) result[section] = true;
  }
  return result;
}

/** Get longhands for a shorthand property from css-meta */
function getLonghands(shorthandProp) {
  const result = [];
  for (const [name, entry] of Object.entries(cssMeta.$defs)) {
    if (entry.$shorthand === shorthandProp) result.push({ name, entry });
  }
  result.sort((a, b) => a.entry.$order - b.entry.$order);
  return result;
}

// ── Color popover singleton ─────────────────────────────────────────────────
let _colorPopover = null;
let _colorCallback = null;
let _colorDismissHandler = null;

/** Extract --color-* CSS custom properties from the document root style. */
function getColorVars() {
  const style = S.document?.style;
  if (!style) return [];
  const vars = [];
  for (const [k, v] of Object.entries(style)) {
    if (k.startsWith("--color") && (typeof v === "string" || typeof v === "number")) {
      vars.push({ name: k, value: String(v) });
    }
  }
  return vars;
}

/** Extract --font-* CSS custom properties from the document root style. */
function getFontVars() {
  const style = S.document?.style;
  if (!style) return [];
  const vars = [];
  for (const [k, v] of Object.entries(style)) {
    if (k.startsWith("--font") && (typeof v === "string" || typeof v === "number")) {
      vars.push({ name: k, value: String(v) });
    }
  }
  return vars;
}

/** Resolve a color value for display — if it's a var() reference, look up the actual color. */
function resolveColorForDisplay(val) {
  if (!val) return "transparent";
  const m = val.match(/^var\((--[^)]+)\)$/);
  if (m) {
    const style = S.document?.style;
    const resolved = style?.[m[1]];
    if (typeof resolved === "string") return resolved;
    return "transparent";
  }
  return val;
}

function ensureColorPopover() {
  if (_colorPopover) return;
  _colorPopover = document.createElement("sp-popover");
  _colorPopover.setAttribute("tabindex", "-1");
  _colorPopover.style.cssText = "padding:12px; position:fixed; z-index:9999";
  (document.querySelector("sp-theme") || document.body).appendChild(_colorPopover);
}

function closeColorPopover() {
  if (!_colorPopover) return;
  _colorPopover.open = false;
  _colorCallback = null;
  if (_colorDismissHandler) {
    document.removeEventListener("pointerdown", _colorDismissHandler, true);
    document.removeEventListener("keydown", _colorDismissHandler, true);
    _colorDismissHandler = null;
  }
}

function openColorPopover(anchorEl, currentColor, onChange) {
  ensureColorPopover();

  const colorVars = getColorVars();
  const resolvedColor = resolveColorForDisplay(currentColor) || "#000000";

  // Render popover content with lit-html
  const syncFromArea = (e) => {
    const area = _colorPopover.querySelector("sp-color-area");
    const slider = _colorPopover.querySelector("sp-color-slider");
    const tf = _colorPopover.querySelector(".color-popover-hex");
    if (slider) slider.color = area.color;
    if (tf) tf.value = area.color;
    _colorCallback?.(area.color);
  };

  const syncFromSlider = (e) => {
    const area = _colorPopover.querySelector("sp-color-area");
    const slider = _colorPopover.querySelector("sp-color-slider");
    const tf = _colorPopover.querySelector(".color-popover-hex");
    if (area) area.color = slider.color;
    if (tf) tf.value = area.color;
    _colorCallback?.(area.color);
  };

  const syncFromText = (e) => {
    const val = e.target.value.trim();
    if (!val) return;
    const area = _colorPopover.querySelector("sp-color-area");
    const slider = _colorPopover.querySelector("sp-color-slider");
    try {
      if (area) area.color = val;
      if (slider) slider.color = val;
    } catch {}
    _colorCallback?.(val);
  };

  const tpl = html`
    <div class="color-popover-inner">
      <sp-color-area style="width:200px; height:150px"
        color=${resolvedColor}
        @input=${syncFromArea}
      ></sp-color-area>
      <sp-color-slider style="width:200px"
        color=${resolvedColor}
        @input=${syncFromSlider}
      ></sp-color-slider>
      <sp-textfield size="s" class="color-popover-hex"
        .value=${live(currentColor || "")}
        placeholder="#000000"
        @change=${syncFromText}
      ></sp-textfield>
      ${colorVars.length > 0 ? html`
        <sp-divider size="s"></sp-divider>
        <span class="color-popover-swatches-label">Color Tokens</span>
        <sp-swatch-group size="xs" border="light" rounding="none">
          ${colorVars.map((cv) => html`
            <sp-swatch
              color=${cv.value}
              .value=${cv.name}
              title=${cv.name}
              @click=${(e) => {
                e.stopPropagation();
                const varRef = `var(${cv.name})`;
                _colorCallback?.(varRef);
                // Update the text field to show the var reference
                const tf = _colorPopover.querySelector(".color-popover-hex");
                if (tf) tf.value = varRef;
              }}
            ></sp-swatch>
          `)}
        </sp-swatch-group>
      ` : nothing}
    </div>
  `;

  litRender(tpl, _colorPopover);

  // Position below anchor
  const r = anchorEl.getBoundingClientRect();
  _colorPopover.style.left = `${r.left}px`;
  _colorPopover.style.top = `${r.bottom + 4}px`;
  _colorCallback = onChange;
  _colorPopover.open = true;

  // Dismiss on click-outside or Escape
  if (_colorDismissHandler) {
    document.removeEventListener("pointerdown", _colorDismissHandler, true);
    document.removeEventListener("keydown", _colorDismissHandler, true);
  }
  _colorDismissHandler = (e) => {
    if (e.type === "keydown") {
      if (e.key === "Escape") closeColorPopover();
      return;
    }
    // pointerdown — close if outside popover and outside the anchor swatch
    if (!_colorPopover.contains(e.target) && !anchorEl.contains(e.target)) {
      closeColorPopover();
    }
  };
  // Defer so the opening click doesn't immediately dismiss
  requestAnimationFrame(() => {
    document.addEventListener("pointerdown", _colorDismissHandler, true);
    document.addEventListener("keydown", _colorDismissHandler, true);
  });
}

function safeColor(val) {
  if (!val) return "transparent";
  return resolveColorForDisplay(val);
}

function renderColorInput(prop, value, onChange) {
  return html`
    <div class="style-input-color">
      <sp-swatch size="s" rounding="none" border="light"
        color=${safeColor(value)}
        @click=${(e) => {
          if (_colorPopover?.open) { closeColorPopover(); return; }
          openColorPopover(e.currentTarget, value, (c) => {
            onChange(c);
          });
        }}
      ></sp-swatch>
      <sp-textfield size="s" style="flex:1; min-width:0"
        .value=${live(value || "")}
        @input=${debouncedStyleCommit(`color:${prop}`, 400, (e) => {
          onChange(e.target.value.trim());
        })}
      ></sp-textfield>
    </div>
  `;
}

function renderNumberUnitInput(entry, prop, value, onChange) {
  const units = entry.$units || [];
  const keywords = entry.$keywords || [];
  const strVal = String(value ?? "");
  const match = strVal.match(UNIT_RE);
  const isKeyword = !match && strVal !== "" && keywords.includes(strVal);
  const isNumericVal = (v) => /^-?\d*\.?\d*$/.test(v);

  const currentUnit = isKeyword ? units[0] || "" : match ? match[2] || "" : units[0] || "";
  let displayValue;
  if (isKeyword) displayValue = strVal;
  else if (match) displayValue = match[1];
  else if (strVal !== "") {
    const num = parseFloat(strVal);
    displayValue = isNaN(num) ? strVal : String(num);
  } else displayValue = "";

  const isExpression = isKeyword || (displayValue !== "" && !isNumericVal(displayValue));
  const hasUnits = units.length > 0 || keywords.length > 0;
  const btnId = `style-unit-${prop}`;

  return html`
    <div class="style-input-number-unit">
      <div class=${classMap({ "input-group": true, "is-expression": isExpression })}>
        <sp-textfield size="s" placeholder="0"
          .value=${live(displayValue)}
          @input=${debouncedStyleCommit(`nui:${prop}`, 400, (e) => {
            const val = (e.target.value ?? "").trim();
            if (val === "") { onChange(""); return; }
            if (isNumericVal(val)) onChange(units.length > 0 ? val + currentUnit : val);
            else onChange(val);
          })}
        ></sp-textfield>
        ${hasUnits ? html`
          <sp-picker-button id=${btnId} size="s">
            <span slot="label">${currentUnit || units[0] || ""}</span>
          </sp-picker-button>
          <sp-overlay trigger="${btnId}@click" placement="bottom-end" offset="4">
            <sp-popover style="min-width: var(--spectrum-component-width-900, 64px)">
              <sp-menu label="CSS unit" @change=${(e) => {
                const chosen = e.target.value;
                if (keywords.includes(chosen)) {
                  onChange(chosen);
                } else if (units.includes(chosen)) {
                  // Re-commit with new unit
                  const curMatch = String(value ?? "").match(UNIT_RE);
                  const numPart = curMatch ? curMatch[1] : "";
                  if (numPart) onChange(numPart + chosen);
                }
              }}>
                ${units.map(u => html`<sp-menu-item value=${u}>${u}</sp-menu-item>`)}
                ${keywords.length > 0 && units.length > 0 ? html`<sp-menu-divider></sp-menu-divider>` : nothing}
                ${keywords.map(kw => html`<sp-menu-item value=${kw}>${kw}</sp-menu-item>`)}
              </sp-menu>
            </sp-popover>
          </sp-overlay>
        ` : nothing}
      </div>
    </div>
  `;
}

// abbreviateValue — imported from studio-utils.js

function renderButtonGroupInput(entry, prop, value, onChange) {
  const values = entry.$buttonValues || entry.enum || [];
  const iconMap = entry.$icons || {};
  const extra = entry.$buttonValues && entry.enum && entry.enum.length > entry.$buttonValues.length
    ? entry.enum.filter((v) => !entry.$buttonValues.includes(v)) : [];

  const menuId = `style-btngrp-${prop}`;
  const hasExtra = extra.length > 0;
  // If the current value is one of the extra (non-button) options, show it selected in the picker
  const extraSelected = hasExtra && extra.includes(value);

  return html`
    <div class="button-group-combo ${hasExtra ? "has-overflow" : ""}">
      <sp-action-group size="s" compact>
        ${values.map(v => html`
          <sp-action-button size="s" title=${v} ?selected=${v === value}
            @click=${() => onChange(v === value ? "" : v)}>
            ${iconMap[v] && icons[iconMap[v]]
              ? icons[iconMap[v]]
              : abbreviateValue(v)}
          </sp-action-button>
        `)}
      </sp-action-group>
      ${hasExtra ? html`
        <sp-picker-button size="s" id=${menuId}
          class=${extraSelected ? "has-selection" : ""}
        ></sp-picker-button>
        <sp-overlay trigger=${menuId}@click placement="bottom-end" type="auto">
          <sp-popover>
            <sp-menu @change=${(e) => { if (e.target.value) onChange(e.target.value); }}>
              <sp-menu-item value="__none__">\u2014</sp-menu-item>
              ${extra.map(v => {
                const label = v.includes("-") ? kebabToLabel(v) : v.replace(/^./, (c) => c.toUpperCase());
                return html`<sp-menu-item value=${v} ?selected=${v === value}>${label}</sp-menu-item>`;
              })}
            </sp-menu>
          </sp-popover>
        </sp-overlay>
      ` : nothing}
    </div>
  `;
}

/** Typography CSS properties that should preview their values in-menu */
const TYPO_PREVIEW_PROPS = new Set([
  "fontStyle", "fontVariant", "textTransform", "textDecoration",
]);

// camelToKebab — imported from studio-utils.js

/** Resolve the current font family for typography preview (handles var() references) */
function currentFontFamily() {
  const node = S.selection ? getNodeAtPath(S.document, S.selection) : null;
  const raw = node?.style?.fontFamily;
  if (!raw) return "";
  const m = typeof raw === "string" && raw.match(/^var\((--[^)]+)\)$/);
  if (m) return S.document?.style?.[m[1]] || "";
  return raw;
}

/**
 * Dual-mode keyword input — shared by select (enum) and combobox (examples) widgets.
 *
 * If the current value is one of the predefined options → renders as sp-picker
 * with Title Case labels (and typography preview when applicable).
 * Selecting "—" clears the value, which flips to combobox mode.
 *
 * If the value is empty or a custom string → renders as sp-combobox with
 * predefined options in its dropdown.  Selecting one flips to picker mode.
 *
 * Note: sp-combobox recreates items in shadow DOM as plain text, so typography
 * preview props use a manual sp-textfield + sp-overlay + sp-menu instead.
 */
function renderKeywordInput(options, prop, value, onChange) {
  const isTypoPreview = TYPO_PREVIEW_PROPS.has(prop) || prop === "fontWeight";
  const font = isTypoPreview ? currentFontFamily() : "";
  const cssProp = isTypoPreview ? camelToKebab(prop) : "";
  const isPredefined = value && options.includes(value);

  const menuItemsT = options.map((v) => {
    const label = v.includes("-") ? kebabToLabel(v) : v.replace(/^./, (c) => c.toUpperCase());
    if (isTypoPreview) {
      const previewStyle = `${cssProp}: ${v};${font ? ` font-family: ${font}` : ""}`;
      return html`<sp-menu-item value=${v} style=${previewStyle}>${label}</sp-menu-item>`;
    }
    return html`<sp-menu-item value=${v}>${label}</sp-menu-item>`;
  });

  // Picker mode — value matches a predefined keyword
  if (isPredefined) {
    const pickerStyle = isTypoPreview
      ? `${cssProp}: ${value};${font ? ` font-family: ${font}` : ""}`
      : "";
    return html`
      <sp-picker size="s" style=${pickerStyle} .value=${live(value)}
        @change=${(e) => onChange(e.target.value === "__none__" ? "" : e.target.value)}>
        <sp-menu-item value="__none__">\u2014</sp-menu-item>
        ${menuItemsT}
      </sp-picker>
    `;
  }

  // Combobox mode — empty or custom value
  // Typography props need manual overlay for styled menu items;
  // sp-combobox discards all item styling in its shadow DOM.
  if (isTypoPreview) {
    const menuId = `style-kw-${prop}`;
    return html`
      <div class="input-group">
        <sp-textfield size="s"
          placeholder=${cssInitialMap.get(prop) || ""}
          .value=${live(value || "")}
          @input=${debouncedStyleCommit(`kw:${prop}`, 400, (e) => onChange(e.target.value))}
        ></sp-textfield>
        <sp-picker-button size="s" id=${menuId}></sp-picker-button>
        <sp-overlay trigger=${menuId}@click placement="bottom-end" type="auto">
          <sp-popover>
            <sp-menu @change=${(e) => { if (e.target.value) onChange(e.target.value); }}>
              ${menuItemsT}
            </sp-menu>
          </sp-popover>
        </sp-overlay>
      </div>
    `;
  }

  return html`
    <sp-combobox size="s"
      placeholder=${cssInitialMap.get(prop) || ""}
      .value=${live(value || "")}
      @input=${debouncedStyleCommit(`kw:${prop}`, 400, (e) => onChange(e.target.value))}
      @change=${(e) => onChange(e.target.value)}>
      ${menuItemsT}
    </sp-combobox>
  `;
}

function renderSelectInput(entry, prop, value, onChange) {
  return renderKeywordInput(entry.enum || [], prop, value, onChange);
}

function handleFontPresetSelection(preset, onChange) {
  const varName = friendlyNameToVar(preset.title, "--font-");
  if (!S.document?.style?.[varName]) {
    S = updateStyle(S, [], varName, preset.value);
  }
  onChange(`var(${varName})`);
}

function renderFontOptions(fontVars, presets) {
  const unaddedPresets = presets.filter((p) => {
    const varName = friendlyNameToVar(p.title, "--font-");
    return !fontVars.some((fv) => fv.name === varName);
  });
  return html`
    ${fontVars.map((fv) => html`
      <sp-menu-item value=${fv.name}
        style="font-family: ${fv.value}">
        ${varDisplayName(fv.name, "--font-")}
      </sp-menu-item>
    `)}
    ${unaddedPresets.length > 0 ? html`
      <sp-menu-divider></sp-menu-divider>
      ${unaddedPresets.map((p) => html`
        <sp-menu-item value=${"__preset__:" + p.title}
          style="font-family: ${p.value}">
          ${p.title}
        </sp-menu-item>
      `)}
    ` : nothing}
  `;
}

function handleFontSelection(val, presets, onChange) {
  if (!val) return;
  if (val.startsWith("__preset__:")) {
    const title = val.slice("__preset__:".length);
    const preset = presets.find((p) => p.title === title);
    if (preset) handleFontPresetSelection(preset, onChange);
    return;
  }
  // Existing font var selected
  onChange("var(" + val + ")");
}

function renderFontVarPicker(fontVars, presets, value, onChange) {
  const varMatch = value.match(/^var\((--[^)]+)\)$/);
  const currentVarName = varMatch ? varMatch[1] : "";

  return html`
    <sp-picker size="s" class="font-var-picker"
      .value=${live(currentVarName || "__none__")}
      @change=${(e) => handleFontSelection(e.target.value, presets, onChange)}>
      ${renderFontOptions(fontVars, presets)}
    </sp-picker>
  `;
}

function renderFontCombobox(fontVars, presets, value, onChange) {
  return html`
    <sp-combobox size="s" class="font-combo-field"
      placeholder=${cssInitialMap.get("fontFamily") || ""}
      .value=${live(value || "")}
      @input=${debouncedStyleCommit("combo:fontFamily", 400, (e) => onChange(e.target.value))}
      @change=${(e) => {
        handleFontSelection(e.target.value, presets, onChange);
      }}>
      ${renderFontOptions(fontVars, presets)}
    </sp-combobox>
  `;
}

function renderComboboxInput(entry, prop, value, onChange) {
  const fontVars = (prop === "fontFamily") ? getFontVars() : [];
  const presets = entry.presets || [];
  const examples = entry.examples || [];
  const isVarRef = typeof value === "string" && value.startsWith("var(");

  // fontFamily: dual-mode control (var-picker / combobox)
  if (prop === "fontFamily") {
    if (isVarRef) {
      return renderFontVarPicker(fontVars, presets, value, onChange);
    }
    return renderFontCombobox(fontVars, presets, value, onChange);
  }

  // All other comboboxes: use the shared keyword dual-mode input
  if (examples.length > 0) {
    return renderKeywordInput(examples, prop, value, onChange);
  }

  // Fallback: plain textfield (no predefined options)
  return html`
    <sp-textfield size="s"
      placeholder=${cssInitialMap.get(prop) || ""}
      .value=${live(value || "")}
      @input=${debouncedStyleCommit(`combo:${prop}`, 400, (e) => onChange(e.target.value))}
    ></sp-textfield>
  `;
}

function renderNumberInput(entry, prop, value, onChange) {
  return html`
    <sp-number-field size="s" hide-stepper
      .value=${live(value !== undefined && value !== "" ? Number(value) : undefined)}
      min=${ifDefined(entry.minimum)} max=${ifDefined(entry.maximum)}
      step=${ifDefined(entry.maximum !== undefined && entry.maximum <= 1 ? 0.1 : undefined)}
      @change=${debouncedStyleCommit(`num:${prop}`, 400, (e) => {
        const v = e.target.value;
        if (v === undefined || isNaN(v)) onChange("");
        else onChange(Number(v));
      })}
    ></sp-number-field>
  `;
}

function renderTextInput(prop, value, onChange) {
  return html`
    <sp-textfield size="s"
      placeholder=${cssInitialMap.get(prop) || ""}
      .value=${live(value || "")}
      @input=${debouncedStyleCommit(`text:${prop}`, 400, (e) => onChange(e.target.value))}
    ></sp-textfield>
  `;
}

// camelToLabel, kebabToLabel, propLabel, attrLabel — imported from studio-utils.js

function widgetForType(type, entry, prop, value, onCommit) {
  switch (type) {
    case "button-group": return renderButtonGroupInput(entry, prop, value, onCommit);
    case "color": return renderColorInput(prop, value, onCommit);
    case "number-unit": return renderNumberUnitInput(entry, prop, value, onCommit);
    case "number": return renderNumberInput(entry, prop, value, onCommit);
    case "select": return renderSelectInput(entry, prop, value, onCommit);
    case "combobox": return renderComboboxInput(entry, prop, value, onCommit);
    default: return renderTextInput(prop, value, onCommit);
  }
}

function renderStyleRow(entry, prop, value, onCommit, onDelete, isWarning, gridMode) {
  const type = inferInputType(entry);
  const hasVal = value !== undefined && value !== "";
  return html`
    <div class=${classMap({ "style-row": true, "style-row--warning": isWarning })}
         data-prop=${prop}
         style=${gridMode && entry.$span === 2 ? "grid-column: 1 / -1" : ""}>
      <div class="style-row-label">
        ${hasVal ? html`<span class="set-dot" title="Clear ${prop}"
          @click=${(e) => { e.stopPropagation(); onDelete(); }}></span>` : nothing}
        <sp-field-label size="s" title=${prop}>${propLabel(entry, prop)}</sp-field-label>
      </div>
      ${widgetForType(type, entry, prop, value, onCommit)}
    </div>
  `;
}

function renderShorthandRow(shortProp, entry, style, commitFn, deleteFn) {
  const longhands = getLonghands(shortProp);
  const shortVal = style[shortProp];
  const hasLonghands = longhands.some((l) => style[l.name] !== undefined);
  const isExpanded = S.ui.styleShorthands[shortProp] ?? hasLonghands;
  const hasAnyVal = shortVal !== undefined || longhands.some((l) => style[l.name] !== undefined);

  return html`
    <div class="style-row" data-prop=${shortProp}>
      <div class="style-row-label">
        ${hasAnyVal ? html`<span class="set-dot" title="Clear ${shortProp}" @click=${(e) => {
          e.stopPropagation();
          let s = S;
          if (shortVal !== undefined) s = commitFn(s, shortProp, undefined);
          for (const l of longhands) {
            if (style[l.name] !== undefined) s = commitFn(s, l.name, undefined);
          }
          update(s);
        }}></span>` : nothing}
        <sp-field-label size="s" title=${shortProp}>${propLabel(entry, shortProp)}</sp-field-label>
      </div>
      <div class="style-shorthand-header">
        <sp-textfield size="s"
          .value=${live(shortVal || "")}
          placeholder=${!shortVal && hasLonghands ? longhands.map((l) => style[l.name] || "0").join(" ") : ""}
          @input=${debouncedStyleCommit(`short:${shortProp}`, 400, (e) => {
            let s = S;
            for (const l of longhands) {
              if (style[l.name] !== undefined) s = commitFn(s, l.name, undefined);
            }
            s = commitFn(s, shortProp, e.target.value || undefined);
            update(s);
          })}
        ></sp-textfield>
        <sp-action-button size="xs" quiet @click=${(e) => {
          e.stopPropagation();
          S = { ...S, ui: { ...S.ui, styleShorthands: { ...S.ui.styleShorthands, [shortProp]: !isExpanded } } };
          renderRightPanel();
        }}>
          ${isExpanded
            ? html`<sp-icon-chevron-down slot="icon"></sp-icon-chevron-down>`
            : html`<sp-icon-chevron-right slot="icon"></sp-icon-chevron-right>`}
        </sp-action-button>
      </div>
    </div>
    ${isExpanded ? longhands.map(({ name, entry: lEntry }) => {
      const lVal = style[name] ?? "";
      return html`
        <div class="style-row style-row--child" data-prop=${name}>
          <div class="style-row-label">
            ${lVal !== undefined && lVal !== "" ? html`<span class="set-dot" title="Clear ${name}"
              @click=${(e) => { e.stopPropagation(); update(commitFn(S, name, undefined)); }}></span>` : nothing}
            <sp-field-label size="s" title=${name}>${propLabel(lEntry, name)}</sp-field-label>
          </div>
          ${widgetForType(inferInputType(lEntry), lEntry, name, lVal, (newVal) => update(commitFn(S, name, newVal || undefined)))}
        </div>
      `;
    }) : nothing}
  `;
}


function styleSidebarTemplate(node, activeMediaTab, activeSelector) {
  const style = node.style || {};
  const { sizeBreakpoints } = parseMediaEntries(S.document.$media);
  const mediaNames = sizeBreakpoints.map((bp) => bp.name);
  const activeTab = activeMediaTab;

  // ── Media tabs template ──────────────────────────────────────────────────
  const mediaTabsT = mediaNames.length > 0 ? html`
    <sp-tabs size="s">
      <sp-tab label="Base" value="base"
        ?selected=${activeTab === null}
        @click=${() => {
          S = { ...S, ui: { ...S.ui, activeMedia: null } };
          updateActivePanelHeaders();
          renderRightPanel();
        }}></sp-tab>
      ${mediaNames.map((name) => html`
        <sp-tab label=${mediaDisplayName(name)} value=${name}
          ?selected=${activeTab === name}
          @click=${() => {
            S = { ...S, ui: { ...S.ui, activeMedia: name } };
            updateActivePanelHeaders();
            renderRightPanel();
          }}></sp-tab>
      `)}
    </sp-tabs>
  ` : nothing;

  // ── Selector dropdown ──────────────────────────────────────────────────────
  const contextStyle = activeTab ? (style[`@${activeTab}`] || {}) : style;
  const existingSelectors = Object.keys(contextStyle).filter(isNestedSelector);
  const existingSet = new Set(existingSelectors);
  const commonSet = new Set(COMMON_SELECTORS);
  const extraSelectors = existingSelectors.filter((s) => !commonSet.has(s));
  if (activeSelector && !commonSet.has(activeSelector) && !existingSet.has(activeSelector)) {
    extraSelectors.unshift(activeSelector);
  }

  const _selectorVal = activeSelector || "__base__";
  const selectorT = html`
    <div class="selector-bar">
      <sp-picker class="selector-select"
        .value=${live(_selectorVal)}
        @change=${(e) => {
          const val = e.target.value;
          if (val === "__add_custom__") {
            requestAnimationFrame(() => { e.target.value = activeSelector || "__base__"; });
            // Show inline input — imperative since it's a one-off interaction
            const picker = e.target;
            const bar = picker.closest(".selector-bar");
            picker.style.display = "none";
            const inp = document.createElement("input");
            inp.type = "text";
            inp.className = "selector-custom-input";
            inp.placeholder = ":hover, .child, &.active, [attr]";
            bar.appendChild(inp);
            inp.focus();
            let done = false;
            const finish = (accept) => {
              if (done) return;
              done = true;
              const v = inp.value.trim();
              inp.remove();
              picker.style.display = "";
              if (accept && v && isNestedSelector(v)) {
                S = { ...S, ui: { ...S.ui, activeSelector: v } };
                renderRightPanel();
              }
            };
            inp.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter") finish(true);
              else if (ev.key === "Escape") finish(false);
            });
            inp.addEventListener("blur", () => finish(inp.value.trim().length > 0));
            return;
          }
          const newSelector = val === "__base__" ? null : val;
          S = { ...S, ui: { ...S.ui, activeSelector: newSelector } };
          renderRightPanel();
        }}>
        <sp-menu-item value="__base__">(base)</sp-menu-item>
        <sp-menu-divider></sp-menu-divider>
        ${COMMON_SELECTORS.map((s) => html`
          <sp-menu-item value=${s}>${existingSet.has(s) ? `${s}  \u25CF` : s}</sp-menu-item>
        `)}
        ${extraSelectors.length > 0 ? html`
          <sp-menu-divider></sp-menu-divider>
          ${extraSelectors.map((s) => html`
            <sp-menu-item value=${s}>${s}  \u25CF</sp-menu-item>
          `)}
        ` : nothing}
        <sp-menu-divider></sp-menu-divider>
        <sp-menu-item value="__add_custom__">+ Add custom\u2026</sp-menu-item>
      </sp-picker>
    </div>
  `;

  // ── Determine the active style object ──────────────────────────────────────
  let activeStyle;
  let commitStyle;
  if (activeSelector && activeTab && mediaNames.length > 0) {
    activeStyle = (style[`@${activeTab}`] || {})[activeSelector] || {};
    commitStyle = (s, prop, val) =>
      updateMediaNestedStyle(s, S.selection, activeTab, activeSelector, prop, val);
  } else if (activeSelector) {
    activeStyle = style[activeSelector] || {};
    commitStyle = (s, prop, val) =>
      updateNestedStyle(s, S.selection, activeSelector, prop, val);
  } else if (activeTab !== null && mediaNames.length > 0) {
    activeStyle = {};
    for (const [p, v] of Object.entries(style[`@${activeTab}`] || {})) {
      if (typeof v !== "object") activeStyle[p] = v;
    }
    commitStyle = (s, prop, val) => updateMediaStyle(s, S.selection, activeTab, prop, val);
  } else {
    activeStyle = {};
    for (const [p, v] of Object.entries(style)) {
      if (typeof v !== "object") activeStyle[p] = v;
    }
    commitStyle = (s, prop, val) => updateStyle(s, S.selection, prop, val);
  }

  // Auto-open sections that have properties
  const newSections = autoOpenSections({ style: activeStyle }, S.ui.styleSections);
  if (JSON.stringify(newSections) !== JSON.stringify(S.ui.styleSections)) {
    S = { ...S, ui: { ...S.ui, styleSections: newSections } };
  }

  // Partition properties into sections
  const sectionProps = {};
  for (const sec of cssMeta.$sections) sectionProps[sec.key] = [];

  for (const [prop, entry] of Object.entries(cssMeta.$defs)) {
    if (typeof entry.$shorthand === "string") continue;
    const sec = entry.$section || "other";
    sectionProps[sec].push({ prop, entry });
  }
  for (const sec of cssMeta.$sections) {
    sectionProps[sec.key].sort((a, b) => a.entry.$order - b.entry.$order);
  }

  const otherProps = [];
  for (const prop of Object.keys(activeStyle)) {
    if (!cssMeta.$defs[prop]) otherProps.push(prop);
  }

  // ── Section templates ────────────────────────────────────────────────────
  const sectionTemplates = cssMeta.$sections
    .filter((sec) => sec.key !== "other")
    .map((sec) => {
      const entries = sectionProps[sec.key];

      const sectionActiveProps = entries.filter(({ prop, entry }) => {
        if (activeStyle[prop] !== undefined) return true;
        if (inferInputType(entry) === "shorthand") {
          return getLonghands(prop).some((l) => activeStyle[l.name] !== undefined);
        }
        return false;
      });

      const rows = [];
      for (const { prop, entry } of entries) {
        const val = activeStyle[prop];
        const hasVal = val !== undefined;
        const condMet = allConditionsPass(entry, activeStyle);
        const type = inferInputType(entry);
        if (!hasVal && !condMet) continue;

        if (type === "shorthand") {
          const longhands = getLonghands(prop);
          const hasAny = hasVal || longhands.some((l) => activeStyle[l.name] !== undefined);
          if (!hasAny && !condMet) continue;
          rows.push(renderShorthandRow(prop, entry, activeStyle, commitStyle, () => {}));
        } else {
          const isWarning = hasVal && !condMet;
          if (hasVal || condMet) {
            rows.push(renderStyleRow(
              entry, prop, val ?? "",
              (newVal) => update(commitStyle(S, prop, newVal || undefined)),
              () => update(commitStyle(S, prop, undefined)),
              isWarning, sec.$layout === "grid",
            ));
          }
        }
      }

      const isOpen = S.ui.styleSections[sec.key] ?? false;

      return html`
        <sp-accordion-item
          label=${sec.label}
          .open=${isOpen}
          @sp-accordion-item-toggle=${(e) => {
            S = { ...S, ui: { ...S.ui, styleSections: { ...S.ui.styleSections, [sec.key]: e.target.open } } };
          }}>
          ${sectionActiveProps.length > 0 ? html`
            <span slot="heading" style="display:flex;align-items:center;gap:6px">
              ${sec.label}
              <span class="set-dot set-dot--section"
                title="Clear all ${sec.label.toLowerCase()} properties"
                @click=${(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  let s = S;
                  for (const { prop, entry } of sectionActiveProps) {
                    if (activeStyle[prop] !== undefined) s = commitStyle(s, prop, undefined);
                    if (inferInputType(entry) === "shorthand") {
                      for (const l of getLonghands(prop)) {
                        if (activeStyle[l.name] !== undefined) s = commitStyle(s, l.name, undefined);
                      }
                    }
                  }
                  update(s);
                }}></span>
            </span>
          ` : nothing}
          <div class=${sec.$layout === "grid" ? "style-section-body--grid" : ""}>
            ${rows}
          </div>
        </sp-accordion-item>
      `;
    });

  // ── Custom section ─────────────────────────────────────────────────────────
  const customIsOpen = S.ui.styleSections.other ?? (otherProps.length > 0);
  const customSectionT = html`
    <sp-accordion-item
      label="Custom"
      .open=${customIsOpen}
      @sp-accordion-item-toggle=${(e) => {
        S = { ...S, ui: { ...S.ui, styleSections: { ...S.ui.styleSections, other: e.target.open } } };
      }}>
      <div>
        ${otherProps.map((prop) => html`
          <div class="kv-row">
            <sp-textfield size="s" class="kv-key" .value=${live(prop)}
              @change=${(e) => {
                const newProp = e.target.value.trim();
                if (newProp && newProp !== prop) {
                  let s = commitStyle(S, prop, undefined);
                  s = commitStyle(s, newProp, String(activeStyle[prop]));
                  update(s);
                }
              }}></sp-textfield>
            <sp-textfield size="s" class="kv-val"
              .value=${live(String(activeStyle[prop]))}
              placeholder=${ifDefined(cssInitialMap.get(prop))}
              @input=${debouncedStyleCommit(`custom:${prop}`, 400, (e) => {
                update(commitStyle(S, prop, e.target.value));
              })}></sp-textfield>
            <sp-action-button size="xs" quiet @click=${() => update(commitStyle(S, prop, undefined))}>
              <sp-icon-close slot="icon"></sp-icon-close>
            </sp-action-button>
          </div>
        `)}
        <div style="display:flex;gap:4px;padding-top:4px">
          <sp-textfield size="s" placeholder="Property name\u2026" style="flex:1"
            @keydown=${(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const prop = e.target.value.trim();
                if (prop) {
                  const initial = cssInitialMap.get(prop) || "";
                  update(commitStyle(S, prop, initial || ""));
                  e.target.value = "";
                }
              }
            }}></sp-textfield>
        </div>
      </div>
    </sp-accordion-item>
  `;

  return html`
    <div class="style-sidebar">
      ${mediaTabsT}
      ${selectorT}
      <sp-accordion allow-multiple size="s">
        ${sectionTemplates}
        ${customSectionT}
      </sp-accordion>
    </div>
  `;
}

/** Top-level Style panel — returns a lit-html template */
function renderStylePanelTemplate() {
  if (canvasMode === "stylebook" && S.ui.stylebookSelection) {
    const node = S.document;
    if (!node) return html`<div class="empty-state">No document loaded</div>`;
    return html`
      <div class="stylebook-style-header">Styling: &lt;${S.ui.stylebookSelection}&gt;</div>
      ${styleSidebarTemplate(node, S.ui.activeMedia, S.ui.activeSelector)}
    `;
  }
  if (!S.selection) return html`<div class="empty-state">Select an element to style</div>`;
  const node = getNodeAtPath(S.document, S.selection);
  if (!node) return html`<div class="empty-state">Select an element to style</div>`;
  return styleSidebarTemplate(node, S.ui.activeMedia, S.ui.activeSelector);
}

/** @deprecated — use renderStylePanelTemplate() for lit-html integration */
function renderStylePanel(container) {
  litRender(renderStylePanelTemplate(), container);
}

/** Single property input row */
function fieldRow(label, type, value, onChange, datalistId) {
  const row = document.createElement("div");
  row.className = "field-row";

  const lbl = document.createElement("sp-field-label");
  lbl.setAttribute("size", "s");
  lbl.textContent = label;
  row.appendChild(lbl);

  let input;
  if (type === "textarea") {
    input = document.createElement("sp-textfield");
    input.setAttribute("multiline", "");
    input.setAttribute("size", "s");
    input.value = value;
    let debounceTimer;
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChange(input.value), 400);
    });
  } else if (type === "checkbox") {
    input = document.createElement("sp-checkbox");
    input.checked = !!value;
    input.addEventListener("change", () => onChange(input.checked));
  } else {
    input = document.createElement("sp-textfield");
    input.setAttribute("size", "s");
    input.value = value;
    let debounceTimer;
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChange(input.value), 400);
    });
  }
  row.appendChild(input);
  return row;
}

/**
 * Check if a selection path is inside a $map template (contains [..., "children", "map", ...]).
 */
function isInsideMapTemplate(path) {
  if (!path) return false;
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i] === "children" && path[i + 1] === "map") return true;
  }
  return false;
}

/**
 * Field row with binding toggle — allows switching between static value and signal binding.
 * rawValue can be a string/bool (static) or { $ref: "..." } (bound).
 */
function bindableFieldRow(label, type, rawValue, onChange, filterFn, extraSignals) {
  const defs = S.document.state || {};
  const isBound = typeof rawValue === "object" && rawValue !== null && rawValue.$ref;
  const row = document.createElement("div");
  row.className = "field-row";

  const lbl = document.createElement("sp-field-label");
  lbl.setAttribute("size", "s");
  lbl.textContent = label;
  row.appendChild(lbl);

  function renderStatic() {
    const val = isBound ? "" : (rawValue ?? "");
    let input;
    if (type === "textarea") {
      input = document.createElement("sp-textfield");
      input.setAttribute("multiline", "");
      input.setAttribute("size", "s");
      input.value = val;
      let debounce;
      input.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => onChange(input.value), 400);
      });
    } else if (type === "checkbox") {
      input = document.createElement("sp-checkbox");
      input.checked = !!val;
      input.addEventListener("change", () => onChange(input.checked));
    } else {
      input = document.createElement("sp-textfield");
      input.setAttribute("size", "s");
      input.value = val;
      let debounce;
      input.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => onChange(input.value), 400);
      });
    }
    return input;
  }

  function renderBound() {
    const sel = document.createElement("sp-picker");
    sel.setAttribute("size", "s");
    sel.setAttribute("quiet", "");
    sel.setAttribute("placeholder", "\u2014 select signal \u2014");

    const signalDefs = Object.entries(defs).filter(([, d]) =>
      filterFn ? filterFn(d) : !d.$handler && d.$prototype !== "Function",
    );
    for (const [defName] of signalDefs) {
      const item = document.createElement("sp-menu-item");
      item.value = `#/state/${defName}`;
      item.textContent = defName;
      sel.appendChild(item);
    }

    if (extraSignals) {
      sel.appendChild(document.createElement("sp-menu-divider"));
      for (const sig of extraSignals) {
        const item = document.createElement("sp-menu-item");
        item.value = sig.value;
        item.textContent = sig.label;
        sel.appendChild(item);
      }
    }
    if (isBound && rawValue.$ref) {
      const _bindVal = rawValue.$ref;
      requestAnimationFrame(() => { sel.value = _bindVal; });
    }

    sel.addEventListener("change", () => {
      if (sel.value) {
        onChange({ $ref: sel.value });
      } else {
        onChange(undefined);
      }
    });
    return sel;
  }

  let inputEl = isBound ? renderBound() : renderStatic();
  row.appendChild(inputEl);

  // Toggle button
  const toggle = document.createElement("sp-action-button");
  toggle.setAttribute("size", "xs");
  toggle.setAttribute("quiet", "");
  toggle.textContent = isBound ? "\u26A1" : "\u2194";
  toggle.title = isBound ? "Unbind (switch to static)" : "Bind to signal";
  toggle.onclick = () => {
    if (isBound) {
      // Switch to static — use signal's default value
      const ref = rawValue.$ref;
      const defName = ref.startsWith("#/state/") ? ref.slice(8) : ref;
      const def = defs[defName];
      let staticVal = "";
      if (def && def.default !== undefined)
        staticVal =
          typeof def.default === "object" ? JSON.stringify(def.default) : String(def.default);
      onChange(staticVal || undefined);
    } else {
      // Switch to bound — pick first available signal
      const signalDefs = Object.entries(defs).filter(([, d]) =>
        filterFn ? filterFn(d) : !d.$handler && d.$prototype !== "Function",
      );
      if (signalDefs.length > 0) {
        onChange({ $ref: `#/state/${signalDefs[0][0]}` });
      } else if (extraSignals && extraSignals.length > 0) {
        onChange({ $ref: extraSignals[0].value });
      }
    }
  };
  row.appendChild(toggle);

  return row;
}

/** Key-value pair row for styles / attributes */
function kvRow(key, value, onChange, onDelete, datalistId) {
  const row = document.createElement("div");
  row.className = "kv-row";

  const keyInput = document.createElement("sp-textfield");
  keyInput.setAttribute("size", "s");
  keyInput.className = "kv-key";
  keyInput.value = key;

  const valInput = document.createElement("sp-textfield");
  valInput.setAttribute("size", "s");
  valInput.className = "kv-val";
  valInput.value = value;
  if (datalistId === "css-props") {
    valInput.setAttribute("placeholder", cssInitialMap.get(key) || "");
    keyInput.addEventListener("change", () => {
      valInput.setAttribute("placeholder", cssInitialMap.get(keyInput.value) || "");
    });
  }

  let debounceTimer;
  const commit = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onChange(keyInput.value, valInput.value), 400);
  };
  keyInput.addEventListener("input", commit);
  valInput.addEventListener("input", commit);

  const del = document.createElement("sp-action-button");
  del.setAttribute("size", "xs");
  del.setAttribute("quiet", "");
  const delIcon = document.createElement("sp-icon-close");
  delIcon.setAttribute("slot", "icon");
  del.appendChild(delIcon);
  del.addEventListener("click", onDelete);

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(del);
  return row;
}

// ─── Source view ──────────────────────────────────────────────────────────────

function renderSourceView(container) {
  if (!S.selection) {
    const ta = document.createElement("textarea");
    ta.id = "source-view";
    ta.value = JSON.stringify(S.document, null, 2);
    ta.onblur = () => {
      try {
        const parsed = JSON.parse(ta.value);
        S = { ...S, document: parsed, dirty: true };
        render();
      } catch {}
    };
    container.appendChild(ta);
    return;
  }

  const node = getNodeAtPath(S.document, S.selection);
  const ta = document.createElement("textarea");
  ta.id = "source-view";
  ta.value = JSON.stringify(node, null, 2);
  ta.readOnly = true;
  container.appendChild(ta);
}

// ─── Function editor (Monaco JS mode) ─────────────────────────────────────────

function renderFunctionEditor() {
  const editing = S.ui.editingFunction;

  // If editor already exists and matches current target, just sync value
  if (functionEditor && functionEditor._editingTarget === JSON.stringify(editing)) {
    const body = getFunctionBody(editing);
    const currentVal = functionEditor.getValue();
    if (currentVal !== body) {
      functionEditor._ignoreNextChange = true;
      functionEditor.setValue(body);
    }
    return;
  }

  // Dispose previous editors
  if (functionEditor) { functionEditor.dispose(); functionEditor = null; }
  if (monacoEditor) { monacoEditor.dispose(); monacoEditor = null; }

  // Clean up canvas DnD
  for (const fn of canvasDndCleanups) fn();
  canvasDndCleanups = [];
  canvasPanels = [];

  canvasWrap.innerHTML = "";
  canvasWrap.style.padding = "0";

  // Toolbar breadcrumb handles context display — re-render it
  renderToolbar();

  // Editor container
  const editorContainer = document.createElement("div");
  editorContainer.className = "source-editor";
  canvasWrap.appendChild(editorContainer);

  const body = getFunctionBody(editing);
  const args = getFunctionArgs(editing);

  functionEditor = monaco.editor.create(editorContainer, {
    value: body,
    language: "javascript",
    theme: "vs-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 12,
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    lineNumbers: "on",
    scrollBeyondLastLine: false,
    wordWrap: "on",
    tabSize: 2,
  });
  functionEditor._editingTarget = JSON.stringify(editing);

  // Format on open — show pretty-printed code, then run initial lint
  codeService("format", { code: body, args }).then((result) => {
    if (result?.code != null && functionEditor) {
      functionEditor._ignoreNextChange = true;
      functionEditor.setValue(result.code);
    }
  });
  codeService("lint", { code: body, args }).then((result) => {
    if (result?.diagnostics && functionEditor) setLintMarkers(functionEditor, result.diagnostics);
  });

  // Debounced sync back to state + lint on edit
  let syncDebounce, lintDebounce, lintGen = 0;
  functionEditor.onDidChangeModelContent(() => {
    if (functionEditor._ignoreNextChange) {
      functionEditor._ignoreNextChange = false;
      return;
    }

    clearTimeout(syncDebounce);
    syncDebounce = setTimeout(() => {
      const newBody = functionEditor.getValue();
      if (editing.type === "def") {
        update(updateDef(S, editing.defName, { body: newBody }));
      } else if (editing.type === "event") {
        const node = getNodeAtPath(S.document, editing.path);
        const current = node?.[editing.eventKey] || {};
        update(updateProperty(S, editing.path, editing.eventKey, {
          ...current,
          $prototype: "Function",
          body: newBody,
        }));
      }
      renderLeftPanel();
    }, 500);

    clearTimeout(lintDebounce);
    lintDebounce = setTimeout(() => {
      const gen = ++lintGen;
      const currentCode = functionEditor.getValue();
      codeService("lint", { code: currentCode, args }).then((result) => {
        if (gen !== lintGen) return;
        if (result?.diagnostics && functionEditor) setLintMarkers(functionEditor, result.diagnostics);
      });
    }, 750);
  });
}

function getFunctionBody(editing) {
  if (editing.type === "def") {
    return S.document.state?.[editing.defName]?.body || "";
  } else if (editing.type === "event") {
    const node = getNodeAtPath(S.document, editing.path);
    return node?.[editing.eventKey]?.body || "";
  }
  return "";
}

// Register Monaco JS completion provider for state scope variables (once)
let _completionRegistered = false;
function registerFunctionCompletions() {
  if (_completionRegistered) return;
  _completionRegistered = true;
  monaco.languages.registerCompletionItemProvider("javascript", {
    triggerCharacters: ["."],
    provideCompletionItems(model, position) {
      const defs = S?.document?.state || {};
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = Object.entries(defs).map(([key, def]) => {
        let kind = monaco.languages.CompletionItemKind.Variable;
        if (def?.$prototype === "Function" || def?.$handler) kind = monaco.languages.CompletionItemKind.Function;
        else if (def?.$prototype) kind = monaco.languages.CompletionItemKind.Property;
        return {
          label: `state.${key}`,
          kind,
          insertText: `state.${key}`,
          range,
        };
      });
      return { suggestions };
    },
  });
}

// ─── Events panel ─────────────────────────────────────────────────────────────

const EVENT_NAMES = [
  "onclick", "oninput", "onchange", "onsubmit", "onkeydown",
  "onkeyup", "onfocus", "onblur", "onmouseenter", "onmouseleave",
];

function eventsSidebarTemplate() {
  if (!S.selection) return html`<div class="empty-state">Select an element to edit events</div>`;
  const node = getNodeAtPath(S.document, S.selection);
  if (!node) return html`<div class="empty-state">Node not found</div>`;

  const defs = S.document.state || {};
  const functionDefs = Object.entries(defs).filter(
    ([, d]) => d.$prototype === "Function" || d.$handler,
  );

  // Declared CEM events (custom element docs)
  let declaredEventsT = nothing;
  if (isCustomElementDoc()) {
    const allEmits = [];
    for (const [fnName, d] of Object.entries(defs)) {
      if (Array.isArray(d.emits)) {
        for (const ev of d.emits) allEmits.push({ ...ev, _fn: fnName });
      }
    }
    if (allEmits.length > 0) {
      declaredEventsT = html`
        <div class="events-section">
          <sp-field-label size="s">Declared Events</sp-field-label>
          ${allEmits.map((ev) => html`
            <div class="declared-event-row" title=${ev.description || ""}>
              <code class="event-code">${ev.name || "(unnamed)"}</code>
              <span class="event-source">\u2190 ${ev._fn}</span>
              ${ev.type?.text ? html`<span class="event-type">${ev.type.text}</span>` : nothing}
            </div>
          `)}
        </div>
        <sp-divider size="s"></sp-divider>
      `;
    }
  }

  // Find existing event bindings
  const eventKeys = Object.keys(node).filter((k) => {
    if (!k.startsWith("on")) return false;
    const v = node[k];
    if (!v || typeof v !== "object") return false;
    return v.$ref || v.$prototype === "Function";
  });

  return html`
    <div class="events-panel">
      ${declaredEventsT}
      <div class="events-section">
        ${eventKeys.length > 0 ? html`
          <sp-field-label size="s">Event Bindings</sp-field-label>
        ` : nothing}
        ${eventKeys.map((evKey) => {
          const evVal = node[evKey];
          const isInline = evVal.$prototype === "Function";
          return html`
            <div class="event-binding">
              <div class="event-row">
                <sp-picker size="s" class="event-name" .value=${live(evKey)}
                  @change=${(e) => {
                    const newKey = e.target.value;
                    if (newKey && newKey !== evKey) {
                      let s = updateProperty(S, S.selection, evKey, undefined);
                      s = updateProperty(s, S.selection, newKey, node[evKey]);
                      update(s);
                    }
                  }}>
                  ${[evKey, ...EVENT_NAMES.filter((n) => n !== evKey)].map((n) =>
                    html`<sp-menu-item value=${n}>${n}</sp-menu-item>`
                  )}
                </sp-picker>
                <sp-picker size="s" class="event-mode" .value=${live(isInline ? "inline" : "ref")}
                  @change=${(e) => {
                    if (e.target.value === "inline") {
                      update(updateProperty(S, S.selection, evKey, { $prototype: "Function", body: "", parameters: [] }));
                    } else {
                      const firstFn = functionDefs[0];
                      update(updateProperty(S, S.selection, evKey, firstFn ? { $ref: `#/state/${firstFn[0]}` } : { $ref: "" }));
                    }
                  }}>
                  <sp-menu-item value="inline">inline</sp-menu-item>
                  <sp-menu-item value="ref">$ref</sp-menu-item>
                </sp-picker>
                <sp-action-button size="xs" quiet
                  @click=${() => update(updateProperty(S, S.selection, evKey, undefined))}>
                  <sp-icon-delete slot="icon"></sp-icon-delete>
                </sp-action-button>
              </div>
              ${isInline ? html`
                <div class="event-body-row">
                  <sp-textfield size="s" multiline grows placeholder="// handler body"
                    .value=${live(evVal.body || "")}
                    @input=${(e) => {
                      update(updateProperty(S, S.selection, evKey, {
                        $prototype: "Function",
                        body: e.target.value,
                        parameters: evVal.parameters || [],
                      }));
                    }}>
                  </sp-textfield>
                  <sp-action-button size="xs" quiet title="Open in editor"
                    @click=${() => {
                      S = { ...S, ui: { ...S.ui, editingFunction: { type: "event", path: S.selection, eventKey: evKey } } };
                      renderCanvas();
                    }}>
                    <sp-icon-code slot="icon"></sp-icon-code>
                  </sp-action-button>
                </div>
              ` : html`
                <sp-picker size="s" class="event-handler" .value=${live(evVal.$ref || "__none__")}
                  @change=${(e) => {
                    if (e.target.value && e.target.value !== "__none__") {
                      update(updateProperty(S, S.selection, evKey, { $ref: e.target.value }));
                    } else {
                      update(updateProperty(S, S.selection, evKey, undefined));
                    }
                  }}>
                  <sp-menu-item value="__none__">\u2014 none \u2014</sp-menu-item>
                  ${functionDefs.map(([fName]) =>
                    html`<sp-menu-item value=${`#/state/${fName}`}>${fName}</sp-menu-item>`
                  )}
                </sp-picker>
              `}
            </div>
          `;
        })}
        <sp-action-button size="s" quiet
          @click=${() => {
            let evName = "onclick";
            for (const name of EVENT_NAMES) {
              if (!node[name]) { evName = name; break; }
            }
            if (functionDefs.length > 0) {
              update(updateProperty(S, S.selection, evName, { $ref: `#/state/${functionDefs[0][0]}` }));
            } else {
              update(updateProperty(S, S.selection, evName, { $prototype: "Function", body: "", parameters: [] }));
            }
          }}>
          <sp-icon-add slot="icon"></sp-icon-add>
          Add Event
        </sp-action-button>
      </div>
    </div>
  `;
}

// ─── CEM Export ──────────────────────────────────────────────────────────────

/** Collect slot elements from the document tree. */
function collectSlots(node, slots = []) {
  if (node?.tagName === "slot") {
    slots.push(node.attributes?.name || "");
  }
  if (Array.isArray(node?.children)) node.children.forEach((c) => collectSlots(c, slots));
  return slots;
}

/** Generate and download a CEM 2.1.0 manifest for the current document. */
function exportCemManifest() {
  const doc = S.document;
  const tagName = doc.tagName;
  if (!tagName || !tagName.includes("-")) return;

  const state = doc.state || {};
  const members = [];
  const attributes = [];
  const events = [];
  const seenEvents = new Set();

  for (const [key, d] of Object.entries(state)) {
    if (key.startsWith("#")) continue; // private

    const cat = defCategory(d);

    if (cat === "function") {
      members.push({
        kind: "method",
        name: key,
        ...(d.description ? { description: d.description } : {}),
        ...(d.parameters ? { parameters: d.parameters.map(normParam) } : {}),
        ...(d.deprecated ? { deprecated: typeof d.deprecated === "string" ? d.deprecated : true } : {}),
      });
      // Collect emits
      if (Array.isArray(d.emits)) {
        for (const ev of d.emits) {
          if (ev.name && !seenEvents.has(ev.name)) {
            seenEvents.add(ev.name);
            events.push({
              name: ev.name,
              ...(ev.type ? { type: ev.type } : {}),
              ...(ev.description ? { description: ev.description } : {}),
            });
          }
        }
      }
    } else if (cat === "state") {
      members.push({
        kind: "field",
        name: key,
        ...(d.type ? { type: { text: d.type } } : {}),
        ...(d.default !== undefined ? { default: String(d.default) } : {}),
        ...(d.description ? { description: d.description } : {}),
        ...(d.attribute ? { attribute: d.attribute } : {}),
        ...(d.reflects ? { reflects: true } : {}),
        ...(d.deprecated ? { deprecated: typeof d.deprecated === "string" ? d.deprecated : true } : {}),
      });
      if (d.attribute) {
        attributes.push({
          name: d.attribute,
          ...(d.type ? { type: { text: d.type } } : {}),
          fieldName: key,
        });
      }
    }
  }

  // Slots
  const slotNames = collectSlots(doc);
  const slots = slotNames.map((name) => ({ name: name || "", ...(name ? {} : { description: "Default slot" }) }));

  // CSS custom properties
  const style = doc.style || {};
  const cssProperties = Object.entries(style)
    .filter(([k]) => k.startsWith("--"))
    .map(([name, val]) => ({ name, default: String(val) }));

  // CSS parts
  const cssParts = collectCssParts(doc).map((p) => ({ name: p.name }));

  const manifest = {
    schemaVersion: "2.1.0",
    modules: [{
      kind: "javascript-module",
      path: "",
      declarations: [{
        kind: "class",
        name: tagName,
        tagName,
        members,
        ...(attributes.length ? { attributes } : {}),
        ...(events.length ? { events } : {}),
        ...(slots.length ? { slots } : {}),
        ...(cssProperties.length ? { cssProperties } : {}),
        ...(cssParts.length ? { cssParts } : {}),
      }],
    }],
  };

  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${tagName}.cem.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function renderToolbar() {
  toolbar.innerHTML = "";

  // File group
  const fileGroup = group();
  fileGroup.appendChild(tbBtn("Open", openFile, "sp-icon-folder-open"));
  fileGroup.appendChild(tbBtn("Save", saveFile, "sp-icon-save-floppy"));
  if (S.fileHandle) {
    const fname = document.createElement("span");
    fname.className = "tb-filename";
    fname.textContent = S.fileHandle.name;
    fileGroup.appendChild(fname);
  }
  if (S.dirty) {
    const dot = document.createElement("span");
    dot.className = "tb-dirty";
    dot.textContent = "●";
    fileGroup.appendChild(dot);
  }
  toolbar.appendChild(fileGroup);

  // Breadcrumb (unified context: document stack + function editor)
  const hasStack = S.documentStack && S.documentStack.length > 0;
  const hasFunc = !!S.ui.editingFunction;
  if (hasStack || hasFunc) {
    const breadcrumb = document.createElement("div");
    breadcrumb.className = "breadcrumb";

    // Back button — pops the most recent context layer
    const back = document.createElement("sp-action-button");
    back.setAttribute("size", "s");
    const backIcon = document.createElement("sp-icon-back");
    backIcon.setAttribute("slot", "icon");
    back.appendChild(backIcon);
    back.append("Back");
    back.title = hasFunc ? "Close function editor" : "Return to parent document";
    back.addEventListener("click", hasFunc ? closeFunctionEditor : navigateBack);
    breadcrumb.appendChild(back);

    // Document stack crumbs
    if (hasStack) {
      for (const frame of S.documentStack) {
        const crumb = document.createElement("span");
        crumb.className = "breadcrumb-item";
        crumb.textContent = frame.documentPath?.split("/").pop() || "untitled";
        breadcrumb.appendChild(crumb);

        const sep = document.createElement("span");
        sep.className = "breadcrumb-sep";
        sep.textContent = " › ";
        breadcrumb.appendChild(sep);
      }
    }

    // Current document crumb
    const docName = S.documentPath?.split("/").pop() || S.document.tagName || "document";
    const docCrumb = document.createElement("span");
    docCrumb.className = `breadcrumb-item${hasFunc ? " clickable" : " current"}`;
    docCrumb.textContent = docName;
    if (hasFunc) {
      docCrumb.onclick = closeFunctionEditor;
    }
    breadcrumb.appendChild(docCrumb);

    // Function editor crumb
    if (hasFunc) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = " › ";
      breadcrumb.appendChild(sep);

      const editing = S.ui.editingFunction;
      const funcCrumb = document.createElement("span");
      funcCrumb.className = "breadcrumb-item current";
      funcCrumb.textContent = editing.type === "def"
        ? `ƒ ${editing.defName}`
        : `ƒ ${editing.eventKey}`;
      breadcrumb.appendChild(funcCrumb);
    }

    toolbar.appendChild(breadcrumb);
  }

  // Edit group
  const editGroup = group();
  editGroup.appendChild(tbBtn("Undo", () => update(undo(S)), "sp-icon-undo"));
  editGroup.appendChild(tbBtn("Redo", () => update(redo(S)), "sp-icon-redo"));
  toolbar.appendChild(editGroup);

  // Insert group
  const insertGroup = group();
  insertGroup.appendChild(
    tbBtn("Duplicate", () => {
      if (S.selection) update(duplicateNode(S, S.selection));
    }, "sp-icon-duplicate"),
  );
  insertGroup.appendChild(
    tbBtn("Delete", () => {
      if (S.selection) update(removeNode(S, S.selection));
    }, "sp-icon-delete"),
  );
  toolbar.appendChild(insertGroup);

  // Feature toggles (non-size media queries like --dark)
  const { featureQueries } = parseMediaEntries(S.document.$media);
  if (featureQueries.length > 0) {
    const toggleGroup = group();
    for (const { name, query } of featureQueries) {
      const btn = document.createElement("sp-action-button");
      btn.setAttribute("toggles", "");
      btn.setAttribute("size", "s");
      if (S.ui.featureToggles[name]) btn.setAttribute("selected", "");
      btn.textContent = mediaDisplayName(name);
      btn.title = query;
      btn.addEventListener("click", () => {
        const newToggles = { ...S.ui.featureToggles, [name]: !btn.selected };
        S = { ...S, ui: { ...S.ui, featureToggles: newToggles } };
        renderCanvas();
        renderOverlays();
        renderToolbar();
      });
      toggleGroup.appendChild(btn);
    }
    toolbar.appendChild(toggleGroup);
  }

  // Spacer — pushes mode switcher to the right
  const spacer = document.createElement("div");
  spacer.className = "tb-spacer";
  toolbar.appendChild(spacer);

  // Mode switcher (segmented button group)
  const modeGroup = document.createElement("sp-action-group");
  modeGroup.setAttribute("selects", "single");
  modeGroup.setAttribute("size", "s");
  modeGroup.setAttribute("compact", "");
  const modes = [
    { key: "edit",      label: "Edit",      iconTag: "sp-icon-edit" },
    { key: "design",    label: "Design",    iconTag: "sp-icon-artboard" },
    { key: "preview",   label: "Preview",   iconTag: "sp-icon-preview" },
    { key: "source",    label: "Code",      iconTag: "sp-icon-code" },
    { key: "stylebook", label: "Stylebook", iconTag: "sp-icon-brush" },
  ];
  for (const m of modes) {
    const btn = document.createElement("sp-action-button");
    btn.setAttribute("size", "s");
    if (canvasMode === m.key) btn.setAttribute("selected", "");
    const icon = document.createElement(m.iconTag);
    icon.setAttribute("slot", "icon");
    btn.appendChild(icon);
    btn.append(m.label);
    btn.addEventListener("click", () => {
      if (canvasMode === m.key) return;
      // Close function editor if leaving it
      if (S.ui.editingFunction) {
        if (functionEditor) { functionEditor.dispose(); functionEditor = null; }
        S = { ...S, ui: { ...S.ui, editingFunction: null } };
      }
      canvasMode = m.key;
      renderCanvas();
      renderOverlays();
      renderToolbar();
      renderLeftPanel();
      if (m.key === "stylebook") {
        S = { ...S, ui: { ...S.ui, rightTab: "style" } };
        renderRightPanel();
      }
    });
    modeGroup.appendChild(btn);
  }
  toolbar.appendChild(modeGroup);
}

function group() {
  const g = document.createElement("sp-action-group");
  g.setAttribute("compact", "");
  g.setAttribute("size", "s");
  return g;
}

function tbBtn(label, onClick, iconTag) {
  const btn = document.createElement("sp-action-button");
  btn.setAttribute("size", "s");
  if (iconTag) {
    const icon = document.createElement(iconTag);
    icon.setAttribute("slot", "icon");
    btn.appendChild(icon);
  }
  btn.append(label);
  btn.addEventListener("click", onClick);
  return btn;
}

// ─── Statusbar ────────────────────────────────────────────────────────────────

function renderStatusbar() {
  const parts = [];
  if (S.mode === "content") parts.push("Content Mode");
  if (S.selection) {
    const node = getNodeAtPath(S.document, S.selection);
    parts.push(`Selected: ${nodeLabel(node)}`);
    parts.push(`Path: ${S.selection.join(" > ") || "root"}`);
  }
  if (statusMsg) parts.push(statusMsg);
  statusbar.textContent = parts.join("  |  ") || "JSONsx Studio";
}

function statusMessage(msg, duration = 3000) {
  statusMsg = msg;
  renderStatusbar();
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => {
    statusMsg = "";
    renderStatusbar();
  }, duration);
}

// ─── File Operations ──────────────────────────────────────────────────────────

async function openFile() {
  try {
    // File System Access API
    if ("showOpenFilePicker" in window) {
      const [handle] = await window.showOpenFilePicker({
        types: [
          { description: "JSONsx Component", accept: { "application/json": [".json"] } },
          { description: "Markdown Content", accept: { "text/markdown": [".md"] } },
        ],
      });
      const file = await handle.getFile();
      const text = await file.text();

      if (handle.name.endsWith(".md")) {
        loadMarkdown(text, handle);
      } else {
        const doc = JSON.parse(text);
        S = createState(doc);
        S.fileHandle = handle;
        S.dirty = false;
        S.documentPath = await locateDocument(handle.name);
        await loadCompanionJS(handle);
      }

      render();
      statusMessage(`Opened ${handle.name}`);
    } else {
      // Fallback: file input
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,.md";
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const text = await file.text();

        if (file.name.endsWith(".md")) {
          loadMarkdown(text, null);
        } else {
          const doc = JSON.parse(text);
          S = createState(doc);
          S.dirty = false;
        }

        render();
        statusMessage(`Opened ${file.name}`);
      };
      input.click();
    }
  } catch (e) {
    if (e.name !== "AbortError") statusMessage(`Error: ${e.message}`);
  }
}

/**
 * Load a markdown string into the studio in content mode.
 * Parses frontmatter, converts mdast → JSONsx element tree.
 */
function loadMarkdown(source, fileHandle) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkDirective);

  const mdast = processor.parse(source);

  // Extract frontmatter from the first YAML node
  let frontmatter = {};
  const yamlNode = mdast.children.find((n) => n.type === "yaml");
  if (yamlNode) {
    try {
      frontmatter = parseYaml(yamlNode.value) ?? {};
    } catch {}
  }

  const jsonsxTree = mdToJsonsx(mdast);

  S = createState(jsonsxTree);
  S.mode = "content";
  S.content = { frontmatter };
  S.fileHandle = fileHandle;
  S.dirty = false;
}

async function loadCompanionJS(handle) {
  try {
    // Try to get the parent directory to look for .js file
    // Note: getParent is not widely supported; best-effort
    const name = handle.name.replace(/\.json$/, ".js");
    if (handle.getParent) {
      // Not yet available in any browser; skip for now
    }
    // Check $handlers in the document
    if (S.document.$handlers) {
      S.handlersSource = `// Companion file: ${S.document.$handlers}\n// (Read-only in builder — edit the JS file directly)`;
    }
  } catch {}
}

async function saveFile() {
  try {
    const isContent = S.mode === "content";
    let output, mimeType, ext, description;

    if (isContent) {
      // Convert JSONsx tree → mdast → markdown string
      const mdast = jsonsxToMd(S.document);
      const md = unified()
        .use(remarkStringify, { bullet: "-", emphasis: "*", strong: "*" })
        .stringify(mdast);

      // Prepend frontmatter if present
      const fm = S.content?.frontmatter;
      const hasFrontmatter = fm && Object.keys(fm).length > 0;
      output = hasFrontmatter ? `---\n${stringifyYaml(fm).trim()}\n---\n\n${md}` : md;
      mimeType = "text/markdown";
      ext = ".md";
      description = "Markdown Content";
    } else {
      output = JSON.stringify(S.document, null, 2);
      mimeType = "application/json";
      ext = ".json";
      description = "JSONsx Component";
    }

    if (S.fileHandle && "createWritable" in S.fileHandle) {
      const writable = await S.fileHandle.createWritable();
      await writable.write(output);
      await writable.close();
      S = { ...S, dirty: false };
      renderToolbar();
      statusMessage("Saved");
    } else if ("showSaveFilePicker" in window) {
      const handle = await window.showSaveFilePicker({
        suggestedName: isContent ? "content.md" : "component.json",
        types: [{ description, accept: { [mimeType]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(output);
      await writable.close();
      S = { ...S, fileHandle: handle, dirty: false };
      renderToolbar();
      statusMessage(`Saved as ${handle.name}`);
    } else {
      // Fallback: download
      const blob = new Blob([output], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = isContent ? "content.md" : "component.json";
      a.click();
      URL.revokeObjectURL(url);
      S = { ...S, dirty: false };
      renderToolbar();
      statusMessage("Downloaded");
    }
  } catch (e) {
    if (e.name !== "AbortError") statusMessage(`Save error: ${e.message}`);
  }
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

// Wheel handler: Ctrl+Scroll = zoom (cursor-centered), plain scroll = pan
canvasWrap.addEventListener("wheel", (e) => {
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
    panX = cursorX - (cursorX - panX) * ratio;
    panY = cursorY - (cursorY - panY) * ratio;
    S = { ...S, ui: { ...S.ui, zoom: newZoom } };
  } else {
    // Pan
    panX -= e.deltaX;
    panY -= e.deltaY;
  }
  applyTransform();
}, { passive: false });

// Middle-mouse drag panning
canvasWrap.addEventListener("pointerdown", (e) => {
  if (canvasMode === "edit") return; // no panning in edit mode
  if (e.button !== 1) return; // middle button only
  e.preventDefault();
  canvasWrap.setPointerCapture(e.pointerId);
  let lastX = e.clientX, lastY = e.clientY;
  const onMove = (ev) => {
    panX += ev.clientX - lastX;
    panY += ev.clientY - lastY;
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
window.addEventListener("resize", positionZoomIndicator);

document.addEventListener("keydown", (e) => {
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
        openFile();
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
        copyNode();
        break;
      case "x":
        e.preventDefault();
        cutNode();
        break;
      case "v":
        e.preventDefault();
        pasteNode();
        break;
      case "0":
        if (canvasMode === "edit") break;
        e.preventDefault();
        S = { ...S, ui: { ...S.ui, zoom: 1 } };
        panX = 16; panY = 16;
        applyTransform();
        break;
      case "=":
      case "+":
        if (canvasMode === "edit") break;
        e.preventDefault();
        S = { ...S, ui: { ...S.ui, zoom: Math.min(5.0, S.ui.zoom * 1.2) } };
        applyTransform();
        break;
      case "-":
        if (canvasMode === "edit") break;
        e.preventDefault();
        S = { ...S, ui: { ...S.ui, zoom: Math.max(0.05, S.ui.zoom / 1.2) } };
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
      navigateSelection(-1);
      break;
    case "ArrowDown":
      e.preventDefault();
      navigateSelection(1);
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

function navigateSelection(direction) {
  if (!S.selection) {
    update(selectNode(S, []));
    return;
  }
  if (S.selection.length < 2) return; // can't navigate from root

  const parent = getNodeAtPath(S.document, parentElementPath(S.selection));
  const idx = childIndex(S.selection);
  const newIdx = idx + direction;

  if (newIdx >= 0 && newIdx < parent.children.length) {
    const newPath = [...parentElementPath(S.selection), "children", newIdx];
    update(selectNode(S, newPath));
  }
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

let clipboard = null;

function copyNode() {
  if (!S.selection) return;
  const node = getNodeAtPath(S.document, S.selection);
  if (!node) return;
  clipboard = structuredClone(node);
  statusMessage("Copied");
}

function cutNode() {
  if (!S.selection || S.selection.length < 2) return;
  const node = getNodeAtPath(S.document, S.selection);
  if (!node) return;
  clipboard = structuredClone(node);
  update(removeNode(S, S.selection));
  statusMessage("Cut");
}

function pasteNode() {
  if (!clipboard) return;
  const parentPath = S.selection || [];
  const parent = getNodeAtPath(S.document, parentPath);
  if (!parent) return;

  if (S.selection && S.selection.length >= 2) {
    // Paste as sibling after selection
    const pp = parentElementPath(S.selection);
    const idx = childIndex(S.selection);
    update(insertNode(S, pp, idx + 1, structuredClone(clipboard)));
  } else {
    // Paste as last child of root/selected
    const idx = parent.children ? parent.children.length : 0;
    update(insertNode(S, parentPath, idx, structuredClone(clipboard)));
  }
  statusMessage("Pasted");
}

// ─── Context menu ─────────────────────────────────────────────────────────────

const ctxMenu = document.createElement("sp-popover");
const ctxMenuInner = document.createElement("sp-menu");
ctxMenu.appendChild(ctxMenuInner);
ctxMenu.style.position = "fixed";
ctxMenu.style.zIndex = "10000";
document.body.appendChild(ctxMenu);

document.addEventListener("click", () => {
  ctxMenu.removeAttribute("open");
});

function showContextMenu(e, path) {
  e.preventDefault();
  ctxMenu.removeAttribute("open");

  const node = getNodeAtPath(S.document, path);
  if (!node) return;

  // Select the node
  update(selectNode(S, path));

  ctxMenuInner.innerHTML = "";
  const items = [];

  items.push({ label: "Copy", action: copyNode });
  if (path.length >= 2) {
    items.push({ label: "Cut", action: cutNode });
    items.push({ label: "Duplicate", action: () => update(duplicateNode(S, S.selection)) });
    items.push({ label: "—" }); // separator
    items.push({ label: "Delete", action: () => update(removeNode(S, S.selection)), danger: true });
  }
  if (clipboard) {
    items.push({ label: "—" });
    items.push({
      label: "Paste inside",
      action: () => {
        const idx = node.children ? node.children.length : 0;
        update(insertNode(S, path, idx, structuredClone(clipboard)));
      },
    });
    if (path.length >= 2) {
      items.push({
        label: "Paste after",
        action: () => {
          const pp = parentElementPath(path);
          const idx = childIndex(path);
          update(insertNode(S, pp, idx + 1, structuredClone(clipboard)));
        },
      });
    }
  }

  for (const item of items) {
    if (item.label === "—") {
      const sep = document.createElement("sp-menu-divider");
      ctxMenuInner.appendChild(sep);
      continue;
    }
    const el = document.createElement("sp-menu-item");
    el.textContent = item.label;
    if (item.danger) el.style.color = "var(--danger)";
    el.addEventListener("click", () => {
      ctxMenu.removeAttribute("open");
      item.action();
    });
    ctxMenuInner.appendChild(el);
  }

  // Position the menu
  ctxMenu.setAttribute("open", "");
  const menuRect = ctxMenu.getBoundingClientRect();
  let x = e.clientX,
    y = e.clientY;
  if (x + menuRect.width > window.innerWidth) x = window.innerWidth - menuRect.width - 4;
  if (y + menuRect.height > window.innerHeight) y = window.innerHeight - menuRect.height - 4;
  ctxMenu.style.left = `${x}px`;
  ctxMenu.style.top = `${y}px`;
}

// ─── Autosave ─────────────────────────────────────────────────────────────────

let autosaveTimer;
const AUTO_SAVE_DELAY = 2000;

function scheduleAutosave() {
  if (!S.fileHandle || !S.dirty) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    if (S.fileHandle && S.dirty && "createWritable" in S.fileHandle) {
      try {
        const writable = await S.fileHandle.createWritable();
        await writable.write(JSON.stringify(S.document, null, 2));
        await writable.close();
        S = { ...S, dirty: false };
        renderToolbar();
        statusMessage("Auto-saved");
      } catch {}
    }
  }, AUTO_SAVE_DELAY);
}

// Hook autosave into update
const _origUpdate = update;
update = function (newState) {
  _origUpdate(newState);
  if (S.dirty) scheduleAutosave();
};
