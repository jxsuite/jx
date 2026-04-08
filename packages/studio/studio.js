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
} from "./state.js";

import { renderNode as runtimeRenderNode, buildScope } from "@jsonsx/runtime";

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
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  attachInstruction,
  extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";

import webdata from "./webdata.json";
import cssMeta from "./css-meta.json";
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
const leftPanel = $("#left-panel");
const rightPanel = $("#right-panel");
const toolbar = $("#toolbar");
const statusbar = $("#statusbar");

// ─── Component registry ───────────────────────────────────────────────────────

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
    return S.document.$defs?.[editing.defName]?.arguments || ["$defs", "event"];
  } else if (editing.type === "event") {
    const node = getNodeAtPath(S.document, editing.path);
    return node?.[editing.eventKey]?.arguments || ["$defs", "event"];
  }
  return ["$defs", "event"];
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

/** Whether the canvas is in preview mode (live interactivity) vs edit mode */
let previewMode = false;

/** Whether the canvas is replaced by the Monaco source editor */
let sourceMode = false;

/** Active Monaco editor instance (or null when in canvas mode) */
let monacoEditor = null;

/** Active function editor Monaco instance (or null) */
let functionEditor = null;

/** Cached $defs scope from last runtime render */
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
    } else if (k === "$defs" || k === "style" || k === "attributes" || k === "$media") {
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
 * with display labels. Preserves $defs so the runtime can still initialise scope.
 */
function prepareForEditMode(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(prepareForEditMode);

  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$defs" || k === "$media") {
      out[k] = v; // preserve as-is
    } else if (k === "children") {
      if (Array.isArray(v)) {
        out.children = v.map(prepareForEditMode);
      } else if (v && typeof v === "object" && v.$prototype === "Array") {
        // Replace mapped array with a placeholder node
        const label = v.items?.$ref || "items";
        out.children = [{
          tagName: "div",
          textContent: `[Array: ${label}]`,
          style: {
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: "11px",
            padding: "6px 10px",
            background: "rgba(100,100,100,0.08)",
            border: "1px dashed rgba(150,150,150,0.4)",
            borderRadius: "4px",
            color: "#888",
            fontStyle: "italic",
          },
        }];
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
              background: "rgba(199,91,79,0.08)",
              border: "1px dashed rgba(199,91,79,0.4)",
              borderRadius: "4px",
              color: "#c75b4f",
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
      const label = ref.startsWith("#/$defs/") ? ref.slice(8) : ref;
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
 * Returns the live $defs scope on success, null on failure.
 */
async function renderCanvasLive(doc, canvasEl) {
  canvasEl.innerHTML = "";

  // Apply content mode typography styling
  if (S.mode === "content") {
    canvasEl.setAttribute("data-content-mode", "");
  } else {
    canvasEl.removeAttribute("data-content-mode");
  }

  const renderDoc = previewMode ? structuredClone(doc) : prepareForEditMode(stripEventHandlers(doc));
  try {
    const docBase = S.documentPath
      ? `${location.origin}/${S.documentPath}`
      : undefined;
    const $defs = await buildScope(renderDoc, {}, docBase);
    const el = runtimeRenderNode(renderDoc, $defs, {
      onNodeCreated(el, path) {
        elToPath.set(el, path);
      },
      _path: [],
    });
    if (!previewMode) {
      // Disable pointer events on all rendered elements for edit mode
      el.style.pointerEvents = "none";
      for (const child of el.querySelectorAll("*")) {
        child.style.pointerEvents = "none";
      }
    }
    canvasEl.appendChild(el);
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
  const rightHasFocus = rightPanel.contains(document.activeElement)
    && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA");
  if (!rightHasFocus || !pathsEqual(prevSel, S.selection)) {
    renderRightPanel();
  }
  renderOverlays();
  updateForcedPseudoPreview();
  renderStatusbar();
}

// ─── Media helpers ────────────────────────────────────────────────────────────

/**
 * Classify $media entries into size breakpoints (get a canvas each)
 * and feature queries (rendered as toolbar toggles).
 */
function parseMediaEntries(mediaDef) {
  if (!mediaDef) return { sizeBreakpoints: [], featureQueries: [] };
  const sizes = [],
    features = [];
  for (const [name, query] of Object.entries(mediaDef)) {
    const minMatch = query.match(/min-width:\s*([\d.]+)px/);
    const maxMatch = query.match(/max-width:\s*([\d.]+)px/);
    if (minMatch) sizes.push({ name, query, width: parseFloat(minMatch[1]), type: "min" });
    else if (maxMatch) sizes.push({ name, query, width: parseFloat(maxMatch[1]), type: "max" });
    else features.push({ name, query });
  }
  sizes.sort((a, b) => (a.type === "min" ? a.width - b.width : b.width - a.width));
  return { sizeBreakpoints: sizes, featureQueries: features };
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
  if (sourceMode && monacoEditor) {
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

  // Source mode: create Monaco editor instead of canvas
  if (sourceMode) {
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

  // Normal canvas mode — restore padding
  canvasWrap.style.padding = "";

  const { sizeBreakpoints, featureQueries } = parseMediaEntries(S.document.$media);
  const hasMedia = sizeBreakpoints.length > 0;
  const featureToggles = S.ui.featureToggles;

  if (!hasMedia) {
    // Single full-width canvas (backward-compatible)
    const panel = createCanvasPanel(null, null, true);
    canvasWrap.appendChild(panel.element);
    canvasPanels.push(panel);
    renderCanvasIntoPanel(panel, new Set(), featureToggles);
    return;
  }

  // Base canvas (mobile-first default: 320px)
  const baseWidth = sizeBreakpoints[0].type === "min" ? 320 : sizeBreakpoints[0].width;
  const baseActive = activeBreakpointsForWidth(sizeBreakpoints, baseWidth);
  const basePanel = createCanvasPanel("base", `Base (${baseWidth}px)`, false, baseWidth);
  canvasWrap.appendChild(basePanel.element);
  canvasPanels.push(basePanel);
  renderCanvasIntoPanel(basePanel, baseActive, featureToggles);

  // One panel per size breakpoint
  for (const bp of sizeBreakpoints) {
    const active = activeBreakpointsForWidth(sizeBreakpoints, bp.width);
    const label = `${bp.name} (${bp.width}px)`;
    const panel = createCanvasPanel(bp.name, label, false, bp.width);
    canvasWrap.appendChild(panel.element);
    canvasPanels.push(panel);
    renderCanvasIntoPanel(panel, active, featureToggles);
  }

  // Highlight active panel header
  updateActivePanelHeaders();
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
  if (width && !fullWidth) viewport.style.width = `${width * S.ui.zoom}px`;

  const canvasDiv = document.createElement("div");
  canvasDiv.className = "canvas-panel-canvas";
  canvasDiv.style.zoom = S.ui.zoom;
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
  };
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
  state: { signal: true, type: "string", default: "" },
  computed: { signal: true, $compute: "", $deps: [] },
  request: { signal: true, $prototype: "Request", url: "", method: "GET", timing: "client" },
  localStorage: { signal: true, $prototype: "LocalStorage", key: "", default: null },
  sessionStorage: { signal: true, $prototype: "SessionStorage", key: "", default: null },
  indexedDB: { signal: true, $prototype: "IndexedDB", database: "", store: "", version: 1 },
  cookie: { signal: true, $prototype: "Cookie", name: "", default: "" },
  set: { signal: true, $prototype: "Set", default: [] },
  map: { signal: true, $prototype: "Map", default: {} },
  formData: { signal: true, $prototype: "FormData", fields: {} },
  function: { $prototype: "Function", body: "", arguments: [] },
  external: { signal: true, $prototype: "", $src: "" },
};

/** Classify a $defs entry into a category string. */
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
  return def.type || "";
}

/**
 * Resolve a $ref value to a display string using signal defaults.
 * Used by the canvas to show real values instead of raw refs.
 */
function resolveDefaultForCanvas(value, defs) {
  if (!value || typeof value !== "object" || !value.$ref) return value;
  const ref = value.$ref;
  let defName;
  if (ref.startsWith("#/$defs/")) defName = ref.slice(8);
  else if (ref.startsWith("$")) defName = ref;
  else return `{${ref}}`;

  const def = defs?.[defName];
  if (!def) return `{${defName}}`;

  // State signal → use default
  if (def.signal && !def.$compute && !def.$prototype) {
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
    const resolved = resolveDefaultForCanvas(node.textContent, S.document.$defs);
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
          const resolved = resolveDefaultForCanvas(val, S.document.$defs);
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
    // $map placeholder in structural preview
    const placeholder = document.createElement("div");
    placeholder.textContent = `[$map: ${node.children.items?.$ref || "items"}]`;
    placeholder.style.cssText = "font-family:monospace;font-size:11px;padding:6px 10px;background:rgba(100,100,100,0.08);border:1px dashed rgba(150,150,150,0.4);border-radius:4px;color:#888;font-style:italic";
    el.appendChild(placeholder);
  }

  if (node.$switch && node.cases && typeof node.cases === "object") {
    // $switch placeholder in structural preview
    const keys = Object.keys(node.cases);
    const placeholder = document.createElement("div");
    placeholder.textContent = `[$switch: ${keys.join(" | ")}]`;
    placeholder.style.cssText = "font-family:monospace;font-size:11px;padding:6px 10px;background:rgba(199,91,79,0.08);border:1px dashed rgba(199,91,79,0.4);border-radius:4px;color:#c75b4f;font-style:italic";
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

  // In preview mode, hide overlays and click interceptors
  if (previewMode) {
    for (const p of canvasPanels) {
      p.overlayClk.style.pointerEvents = "none";
    }
    if (selDragCleanup) {
      selDragCleanup();
      selDragCleanup = null;
    }
    return;
  }
  for (const p of canvasPanels) {
    p.overlayClk.style.pointerEvents = "";
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
        if (S.selection.length >= 2) {
          const label = box.querySelector(".overlay-label");
          if (label) {
            const handle = document.createElement("span");
            handle.className = "overlay-drag-handle";
            handle.textContent = "⠿";
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

function drawOverlayBox(el, type, panel) {
  const vpRect = panel.viewport.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();

  const box = document.createElement("div");
  box.className = `overlay-box overlay-${type}`;
  box.style.top = `${elRect.top - vpRect.top + panel.viewport.scrollTop}px`;
  box.style.left = `${elRect.left - vpRect.left + panel.viewport.scrollLeft}px`;
  box.style.width = `${elRect.width}px`;
  box.style.height = `${elRect.height}px`;

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
    if (path[i] !== "children") return null;
    const idx = path[i + 1];
    el = el.children[idx];
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

  overlayClk.addEventListener("click", (e) => {
    // If inline editing is active, treat click outside as blur
    if (isEditing()) {
      stopEditing();
    }

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

// ─── Left panel: Layers ───────────────────────────────────────────────────────

function renderLeftPanel() {
  const tab = S.ui.leftTab;
  leftPanel.innerHTML = "";

  // Tabs
  const tabs = document.createElement("div");
  tabs.className = "panel-tabs";
  for (const t of ["layers", "blocks", "state", "data"]) {
    const btn = document.createElement("div");
    btn.className = `panel-tab${t === tab ? " active" : ""}`;
    btn.textContent = t;
    btn.onclick = () => {
      S = { ...S, ui: { ...S.ui, leftTab: t } };
      renderLeftPanel();
    };
    tabs.appendChild(btn);
  }
  leftPanel.appendChild(tabs);

  const body = document.createElement("div");
  body.className = "panel-body";
  leftPanel.appendChild(body);

  if (tab === "layers") renderLayers(body);
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
      toggle.textContent = collapsed.has(key) ? "▶" : "▼";
      toggle.onclick = (e) => {
        e.stopPropagation();
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        renderLeftPanel();
      };
    }
    row.appendChild(toggle);

    // Tag badge — different per nodeType
    const badge = document.createElement("span");
    if (nodeType === "map") {
      badge.className = "layer-tag map-tag";
      badge.textContent = "[ ]";
      badge.title = "$map (reactive array)";
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

    // Signal indicator
    if (node.$defs) {
      const hasSignals = Object.values(node.$defs).some((d) => d.signal);
      if (hasSignals) {
        const dot = document.createElement("span");
        dot.className = "layer-dot";
        dot.textContent = "⚡";
        dot.title = "Has signals";
        row.appendChild(dot);
      }
    }

    // Delete button (not for root, and not for virtual map/case rows)
    if (path.length >= 2 && nodeType === "element") {
      const del = document.createElement("span");
      del.className = "layer-delete";
      del.textContent = "✕";
      del.title = "Delete";
      del.onclick = (e) => {
        e.stopPropagation();
        update(removeNode(S, path));
      };
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
  const search = document.createElement("input");
  search.className = "field-input blocks-search";
  search.placeholder = "Filter elements…";
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
        const el = document.createElement(tag);
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

  search.oninput = () => renderList(search.value.toLowerCase());
  renderList("");
}

// ─── Left panel: Signals ─────────────────────────────────────────────────────

/** Expanded signal editor state (persists across renders). */
let expandedSignal = null;

function renderSignals(container) {
  const defs = S.document.$defs || {};
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

      const del = document.createElement("span");
      del.className = "signal-del";
      del.textContent = "\u2715";
      del.onclick = (e) => {
        e.stopPropagation();
        update(removeDef(S, name));
      };
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

  const addSelect = document.createElement("select");
  addSelect.innerHTML = `
    <option value="">+ Add…</option>
    <optgroup label="Signals">
      <option value="state">State Signal</option>
      <option value="computed">Computed</option>
    </optgroup>
    <optgroup label="Data Sources">
      <option value="request">Fetch (Request)</option>
      <option value="localStorage">LocalStorage</option>
      <option value="sessionStorage">SessionStorage</option>
      <option value="indexedDB">IndexedDB</option>
      <option value="cookie">Cookie</option>
      <option value="set">Set</option>
      <option value="map">Map</option>
      <option value="formData">FormData</option>
      <option value="external">External Module\u2026</option>
    </optgroup>
    <optgroup label="Logic">
      <option value="function">Function</option>
    </optgroup>
  `;
  addSelect.onchange = () => {
    const type = addSelect.value;
    if (!type) return;
    const template = DEF_TEMPLATES[type];
    if (!template) return;
    const isFunction = type === "function";
    let nameBase = isFunction ? "newFunction" : "$newSignal";
    let name = nameBase;
    let i = 1;
    while (S.document.$defs && S.document.$defs[name]) {
      name = nameBase + i++;
    }
    update(addDef(S, name, structuredClone(template)));
    expandedSignal = name;
    renderLeftPanel();
  };
  addArea.appendChild(addSelect);
  container.appendChild(addArea);
}

/** Render inline editor fields for a specific signal/def type. */
function renderSignalEditor(container, name, def) {
  const cat = defCategory(def);

  // Name field (common to all)
  container.appendChild(
    signalFieldRow("name", name, (v) => {
      if (v && v !== name && !(S.document.$defs && S.document.$defs[v])) {
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
    const sel = document.createElement("select");
    sel.className = "field-input";
    for (const t of ["string", "integer", "number", "boolean", "array", "object"]) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if (def.type === t) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = () => update(updateDef(S, name, { type: sel.value }));
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
        const deps = [...new Set(depMatches)].map((d) => `#/$defs/${d}`);
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
      depsText.textContent = def.$deps.map((d) => d.replace("#/$defs/", "")).join(", ");
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
      const methodSel = document.createElement("select");
      methodSel.className = "field-input";
      for (const m of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        if (def.method === m) opt.selected = true;
        methodSel.appendChild(opt);
      }
      methodSel.onchange = () => update(updateDef(S, name, { method: methodSel.value }));
      methodRow.appendChild(methodSel);
      container.appendChild(methodRow);
      // Timing
      const timingRow = document.createElement("div");
      timingRow.className = "field-row";
      const timingLabel = document.createElement("label");
      timingLabel.className = "field-label";
      timingLabel.textContent = "timing";
      timingRow.appendChild(timingLabel);
      const timingSel = document.createElement("select");
      timingSel.className = "field-input";
      for (const t of ["client", "server"]) {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        if (def.timing === t) opt.selected = true;
        timingSel.appendChild(opt);
      }
      timingSel.onchange = () => update(updateDef(S, name, { timing: timingSel.value }));
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

    // Arguments field (comma-separated)
    const argsStr = (def.arguments || []).join(", ");
    container.appendChild(
      signalFieldRow("args", argsStr, (v) => {
        const args = v ? v.split(",").map((a) => a.trim()).filter(Boolean) : [];
        update(updateDef(S, name, { arguments: args.length > 0 ? args : undefined }));
      }),
    );

    // Signal checkbox (reactive computed wrapper)
    const sigRow = document.createElement("div");
    sigRow.className = "field-row";
    const sigLabel = document.createElement("label");
    sigLabel.className = "field-label";
    sigLabel.textContent = "signal";
    sigRow.appendChild(sigLabel);
    const sigCheck = document.createElement("input");
    sigCheck.type = "checkbox";
    sigCheck.className = "field-input";
    sigCheck.checked = !!def.signal;
    sigCheck.onchange = () => {
      update(updateDef(S, name, { signal: sigCheck.checked || undefined }));
    };
    sigRow.appendChild(sigCheck);
    container.appendChild(sigRow);

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

/** Simple field row for signal editors. */
function signalFieldRow(label, value, onChange) {
  const row = document.createElement("div");
  row.className = "field-row";
  const lbl = document.createElement("label");
  lbl.className = "field-label";
  lbl.textContent = label;
  row.appendChild(lbl);
  const input = document.createElement("input");
  input.className = "field-input";
  input.value = value;
  let debounce;
  input.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => onChange(input.value), 400);
  };
  row.appendChild(input);
  return row;
}

// ─── Plugin schema-driven form rendering ────────────────────────────────────

/** Keys handled by the framework — skip when rendering schema fields. */
const STUDIO_RESERVED_KEYS = new Set([
  "$prototype", "$src", "$export", "signal", "timing", "default",
  "description", "body", "arguments", "name",
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

    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = prop + (required.has(prop) ? " *" : "");
    if (ps.description) label.title = ps.description;
    row.appendChild(label);

    if (ps.enum) {
      // Select dropdown
      const sel = document.createElement("select");
      sel.className = "field-input";
      if (!required.has(prop)) {
        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = "\u2014";
        sel.appendChild(emptyOpt);
      }
      for (const val of ps.enum) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = val;
        if (currentValue === val || (currentValue === undefined && ps.default === val)) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = () => update(updateDef(S, name, { [prop]: sel.value || undefined }));
      row.appendChild(sel);
    } else if (ps.type === "boolean") {
      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "field-check";
      check.checked = currentValue ?? ps.default ?? false;
      check.onchange = () => update(updateDef(S, name, { [prop]: check.checked }));
      row.appendChild(check);
    } else if (ps.type === "integer" || ps.type === "number") {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "field-input";
      if (ps.minimum !== undefined) input.min = ps.minimum;
      if (ps.maximum !== undefined) input.max = ps.maximum;
      if (ps.type === "integer") input.step = "1";
      input.value = currentValue ?? "";
      input.placeholder = ps.default !== undefined ? String(ps.default) : "";
      let debounce;
      input.oninput = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const parsed = ps.type === "integer" ? parseInt(input.value, 10) : parseFloat(input.value);
          update(updateDef(S, name, { [prop]: isNaN(parsed) ? undefined : parsed }));
        }, 400);
      };
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

      const textarea = document.createElement("textarea");
      textarea.className = "field-input";
      textarea.style.minHeight = hasValue ? "80px" : "40px";
      textarea.style.fontFamily = "monospace";
      textarea.style.fontSize = "11px";
      textarea.value = currentValue !== undefined ? JSON.stringify(currentValue, null, 2) : "";
      textarea.placeholder = ps.description ?? "JSON Schema defining the data shape\u2026";
      let debounce;
      textarea.oninput = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          try { update(updateDef(S, name, { [prop]: JSON.parse(textarea.value) })); } catch {}
        }, 500);
      };
      wrapper.appendChild(textarea);
      row.appendChild(wrapper);
    } else if (ps.type === "array" || ps.type === "object") {
      const textarea = document.createElement("textarea");
      textarea.className = "field-input";
      textarea.style.minHeight = "40px";
      textarea.value = currentValue !== undefined ? JSON.stringify(currentValue, null, 2) : "";
      textarea.placeholder = ps.default !== undefined ? JSON.stringify(ps.default) : "";
      let debounce;
      textarea.oninput = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          try { update(updateDef(S, name, { [prop]: JSON.parse(textarea.value) })); } catch {}
        }, 500);
      };
      row.appendChild(textarea);
    } else {
      // Default: text input
      const input = document.createElement("input");
      input.className = "field-input";
      input.value = currentValue ?? "";
      input.placeholder = ps.default !== undefined
        ? String(ps.default)
        : (ps.examples?.[0] ?? "");
      if (ps.description) input.title = ps.description;
      let debounce;
      input.oninput = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          update(updateDef(S, name, { [prop]: input.value || undefined }));
        }, 400);
      };
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
  const refreshBtn = document.createElement("button");
  refreshBtn.className = "data-refresh-btn";
  refreshBtn.textContent = "\u27F3 Refresh";
  refreshBtn.onclick = () => {
    renderCanvas();
    setTimeout(() => renderLeftPanel(), 200);
  };
  bar.appendChild(refreshBtn);
  container.appendChild(bar);

  // Entries
  const defs = S.document.$defs || {};
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
    if (def.signal && unwrapped === null) typeEl.classList.add("data-pending");
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
    empty.textContent = "No $defs defined";
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

// ─── Right panel: Inspector ───────────────────────────────────────────────────

function renderRightPanel() {
  const tab = S.ui.rightTab;
  rightPanel.innerHTML = "";

  // Tabs
  const tabs = document.createElement("div");
  tabs.className = "panel-tabs";
  for (const t of ["properties", "events", "style"]) {
    const btn = document.createElement("div");
    btn.className = `panel-tab${t === tab ? " active" : ""}`;
    btn.textContent = t;
    btn.onclick = () => {
      S = { ...S, ui: { ...S.ui, rightTab: t } };
      renderRightPanel();
      renderOverlays();
    };
    tabs.appendChild(btn);
  }
  rightPanel.appendChild(tabs);

  const body = document.createElement("div");
  body.className = "panel-body";
  rightPanel.appendChild(body);

  if (tab === "properties") renderInspector(body);
  else if (tab === "events") renderEventsPanel(body);
  else if (tab === "style") renderStylePanel(body);

  updateForcedPseudoPreview();
}

// ─── Inspector ────────────────────────────────────────────────────────────────

function renderInspector(container) {
  if (!S.selection) {
    container.innerHTML = '<div class="empty-state">Select an element to inspect</div>';
    return;
  }

  const node = getNodeAtPath(S.document, S.selection);
  if (!node) {
    container.innerHTML = '<div class="empty-state">Node not found</div>';
    return;
  }

  const isMapNode = node.$prototype === "Array"; // selected the $map row itself
  const isMapParent = node.children && typeof node.children === "object" && node.children.$prototype === "Array";
  const isSwitchNode = !!node.$switch;
  const isCustomInstance = (node.tagName || "").includes("-");

  // ─── $map inspector (when the $map row itself is selected) ───
  if (isMapNode) {
    renderInspectorSection(container, "$map Configuration", true, () => {
      const fields = document.createElement("div");
      fields.className = "inspector-fields";

      fields.appendChild(
        bindableFieldRow("items", "text", node.items, (v) => {
          update(updateProperty(S, S.selection, "items", v));
        }),
      );

      if (node.filter) {
        fields.appendChild(
          bindableFieldRow("filter", "text", node.filter, (v) => {
            update(updateProperty(S, S.selection, "filter", v || undefined));
          }),
        );
      }

      if (node.sort) {
        fields.appendChild(
          bindableFieldRow("sort", "text", node.sort, (v) => {
            update(updateProperty(S, S.selection, "sort", v || undefined));
          }),
        );
      }

      // Add filter/sort buttons
      const addRow = document.createElement("div");
      addRow.style.cssText = "display:flex;gap:8px;margin-top:4px";
      if (!node.filter) {
        const addFilter = document.createElement("span");
        addFilter.className = "kv-add";
        addFilter.textContent = "+ Add filter";
        addFilter.onclick = () => update(updateProperty(S, S.selection, "filter", { $ref: "#/$defs/" }));
        addRow.appendChild(addFilter);
      }
      if (!node.sort) {
        const addSort = document.createElement("span");
        addSort.className = "kv-add";
        addSort.textContent = "+ Add sort";
        addSort.onclick = () => update(updateProperty(S, S.selection, "sort", { $ref: "#/$defs/" }));
        addRow.appendChild(addSort);
      }
      fields.appendChild(addRow);

      // Navigate into template
      if (node.map) {
        const navBtn = document.createElement("button");
        navBtn.className = "toolbar-btn";
        navBtn.textContent = "Edit template →";
        navBtn.style.cssText = "margin-top:8px;width:100%";
        navBtn.onclick = () => update(selectNode(S, [...S.selection, "map"]));
        fields.appendChild(navBtn);
      }

      return fields;
    });
    return; // $map rows don't have normal element sections
  }

  renderInspectorSection(container, "Element", true, () => {
    const fields = document.createElement("div");
    fields.className = "inspector-fields";

    fields.appendChild(
      fieldRow(
        "tagName",
        "text",
        node.tagName || "div",
        (v) => {
          update(updateProperty(S, S.selection, "tagName", v || undefined));
        },
        "tag-names",
      ),
    );
    fields.appendChild(
      fieldRow("$id", "text", node.$id || "", (v) => {
        update(updateProperty(S, S.selection, "$id", v || undefined));
      }),
    );
    fields.appendChild(
      fieldRow("className", "text", node.className || "", (v) => {
        update(updateProperty(S, S.selection, "className", v || undefined));
      }),
    );

    // textContent only when no children
    if (!Array.isArray(node.children) || node.children.length === 0) {
      const tcRaw = node.textContent;
      fields.appendChild(
        bindableFieldRow("textContent", "textarea", tcRaw, (v) => {
          update(updateProperty(S, S.selection, "textContent", v || undefined));
        }),
      );
    }

    fields.appendChild(
      bindableFieldRow("hidden", "checkbox", node.hidden, (v) => {
        update(updateProperty(S, S.selection, "hidden", v || undefined));
      }),
    );

    // $map parent hint
    if (isMapParent) {
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:10px;color:var(--fg-dim);padding:4px 0;font-style:italic";
      hint.textContent = "Children: $map (select in layers to edit)";
      fields.appendChild(hint);
    }

    return fields;
  });

  // $switch section
  if (isSwitchNode) {
    renderInspectorSection(container, "$switch", true, () => {
      const fields = document.createElement("div");
      fields.className = "inspector-fields";

      fields.appendChild(
        bindableFieldRow("$switch", "text", node.$switch, (v) => {
          update(updateProperty(S, S.selection, "$switch", v));
        }),
      );

      const casesHeader = document.createElement("div");
      casesHeader.style.cssText = "font-size:11px;font-weight:600;color:var(--fg-dim);margin:8px 0 4px;text-transform:uppercase;letter-spacing:0.05em";
      casesHeader.textContent = "Cases";
      fields.appendChild(casesHeader);

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
            if (nameInput.value && nameInput.value !== caseName) {
              update(renameSwitchCase(S, S.selection, caseName, nameInput.value));
            }
          }, 500);
        };
        caseRow.appendChild(nameInput);

        const navBtn = document.createElement("span");
        navBtn.className = "bind-toggle";
        navBtn.textContent = "→";
        navBtn.title = "Edit case";
        navBtn.style.cursor = "pointer";
        navBtn.onclick = (e) => {
          e.stopPropagation();
          update(selectNode(S, [...S.selection, "cases", caseName]));
        };
        caseRow.appendChild(navBtn);

        const del = document.createElement("span");
        del.style.cssText = "cursor:pointer;color:var(--danger);font-size:11px";
        del.textContent = "✕";
        del.onclick = (e) => {
          e.stopPropagation();
          update(removeSwitchCase(S, S.selection, caseName));
        };
        caseRow.appendChild(del);

        fields.appendChild(caseRow);
      }

      const addCase = document.createElement("span");
      addCase.className = "kv-add";
      addCase.textContent = "+ Add case";
      addCase.onclick = () => {
        const existing = Object.keys(node.cases || {});
        const newName = `case${existing.length + 1}`;
        update(addSwitchCase(S, S.selection, newName));
      };
      fields.appendChild(addCase);

      return fields;
    });
  }

  // Component Props section (for custom element instances)
  if (isCustomInstance) {
    renderInspectorSection(container, "Component Props", true, () => {
      const fields = document.createElement("div");
      fields.className = "inspector-fields";

      const comp = componentRegistry.find((c) => c.tagName === node.tagName);
      if (!comp) {
        const hint = document.createElement("div");
        hint.className = "empty-state";
        hint.textContent = `Component "${node.tagName}" not found in project`;
        fields.appendChild(hint);
        return fields;
      }

      const currentProps = node.$props || {};
      for (const prop of comp.props) {
        fields.appendChild(
          bindableFieldRow(prop.name, "text", currentProps[prop.name], (v) => {
            update(updateProp(S, S.selection, prop.name, v));
          }),
        );
      }

      if (comp.props.length === 0) {
        const hint = document.createElement("div");
        hint.className = "empty-state";
        hint.textContent = "No props defined";
        fields.appendChild(hint);
      }

      const editLink = document.createElement("span");
      editLink.className = "kv-add";
      editLink.textContent = "→ Edit definition";
      editLink.onclick = () => navigateToComponent(comp.path);
      fields.appendChild(editLink);

      return fields;
    });
  }

  // Attributes section
  renderInspectorSection(container, "Attributes", false, () => {
    const fields = document.createElement("div");
    fields.className = "inspector-fields";
    const attrs = node.attributes || {};

    for (const [attr, val] of Object.entries(attrs)) {
      fields.appendChild(
        kvRow(
          attr,
          String(val),
          (newAttr, newVal) => {
            if (newAttr !== attr) {
              let s = updateAttribute(S, S.selection, attr, undefined);
              s = updateAttribute(s, S.selection, newAttr, newVal);
              update(s);
            } else {
              update(updateAttribute(S, S.selection, attr, newVal));
            }
          },
          () => update(updateAttribute(S, S.selection, attr, undefined)),
        ),
      );
    }

    const add = document.createElement("span");
    add.className = "kv-add";
    add.textContent = "+ Add attribute";
    add.onclick = () => {
      update(updateAttribute(S, S.selection, "data-", ""));
    };
    fields.appendChild(add);
    return fields;
  });

  // Media breakpoints section (root only)
  if (S.selection.length === 0) {
    renderInspectorSection(container, "Media", false, () => {
      const fields = document.createElement("div");
      fields.className = "inspector-fields";
      const media = node.$media || {};

      for (const [name, query] of Object.entries(media)) {
        fields.appendChild(
          kvRow(
            name,
            query,
            (newName, newQuery) => {
              if (newName !== name) {
                let s = updateMedia(S, name, undefined);
                s = updateMedia(s, newName, newQuery);
                update(s);
              } else {
                update(updateMedia(S, name, newQuery));
              }
            },
            () => update(updateMedia(S, name, undefined)),
          ),
        );
      }

      const add = document.createElement("span");
      add.className = "kv-add";
      add.textContent = "+ Add breakpoint";
      add.onclick = () => update(updateMedia(S, "--bp", "(min-width: 768px)"));
      fields.appendChild(add);
      return fields;
    });
  }
}

// ─── Style Sidebar (metadata-driven) ───────────────────────────────────────────

const UNIT_RE = /^(-?[\d.]+)(px|rem|em|%|vw|vh|svw|svh|dvh|ms|s|fr|ch|ex|deg)?$/;

function inferInputType(entry) {
  if (entry.$shorthand === true) return "shorthand";
  if (entry.$input === "button-group") return "button-group";
  if (entry.format === "color") return "color";
  if (entry.$units !== undefined) return "number-unit";
  if (entry.type === "number") return "number";
  if (Array.isArray(entry.enum)) return "select";
  if (Array.isArray(entry.examples)) return "combobox";
  return "text";
}

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

function renderColorInput(value, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "style-input-color";

  const swatch = document.createElement("input");
  swatch.type = "color";
  try {
    swatch.value = value || "#000000";
  } catch {
    swatch.value = "#000000";
  }

  const text = document.createElement("input");
  text.type = "text";
  text.value = value || "";
  text.placeholder = cssInitialMap.get("color") || "";

  swatch.oninput = () => {
    text.value = swatch.value;
    onChange(swatch.value);
  };

  let debounce;
  text.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const v = text.value.trim();
      // Sync swatch if it's a valid hex color
      if (/^#[0-9a-f]{6}$/i.test(v)) {
        try {
          swatch.value = v;
        } catch {}
      }
      onChange(v);
    }, 400);
  };

  wrap.appendChild(swatch);
  wrap.appendChild(text);
  return wrap;
}

function renderNumberUnitInput(entry, value, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "style-input-number-unit";
  const units = entry.$units || [];
  const keywords = entry.$keywords || [];
  const strVal = String(value ?? "");
  const match = strVal.match(UNIT_RE);
  const isKeyword = !match && strVal !== "" && keywords.includes(strVal);

  let currentUnit = isKeyword ? units[0] || "" : match ? match[2] || "" : units[0] || "";
  let activeKeyword = isKeyword ? strVal : null;

  // Number input (hidden when keyword is active)
  const numInput = document.createElement("input");
  numInput.type = "number";
  numInput.value = isKeyword ? "" : match ? match[1] : strVal === "" ? "" : strVal;
  if (entry.minimum !== undefined) numInput.min = entry.minimum;
  if (entry.maximum !== undefined) numInput.max = entry.maximum;
  if (entry.type === "number" || (entry.maximum !== undefined && entry.maximum <= 1)) {
    numInput.step = "0.1";
  }

  // Keyword label (shown when keyword is active, hidden otherwise)
  const kwLabel = document.createElement("span");
  kwLabel.className = "unit-kw-label";

  if (isKeyword) {
    numInput.style.display = "none";
    kwLabel.textContent = strVal;
    kwLabel.style.display = "";
  } else {
    kwLabel.style.display = "none";
  }

  let debounce;
  const commit = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const n = numInput.value;
      if (n === "") { onChange(""); return; }
      onChange(units.length > 0 ? n + currentUnit : n);
    }, 400);
  };
  numInput.oninput = commit;

  // Popover-based unit/keyword picker
  if (units.length > 0 || keywords.length > 0) {
    const popId = "unit-pop-" + (++_popoverId);
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "unit-trigger";
    trigger.setAttribute("popovertarget", popId);
    trigger.textContent = isKeyword ? "⌄" : currentUnit;

    const pop = document.createElement("div");
    pop.id = popId;
    pop.setAttribute("popover", "auto");
    pop.className = "unit-popover";

    const pick = (unitOrKw, isKw) => {
      pop.hidePopover();
      if (isKw) {
        activeKeyword = unitOrKw;
        numInput.style.display = "none";
        kwLabel.textContent = unitOrKw;
        kwLabel.style.display = "";
        trigger.textContent = "⌄";
        onChange(unitOrKw);
      } else {
        activeKeyword = null;
        currentUnit = unitOrKw;
        numInput.style.display = "";
        kwLabel.style.display = "none";
        trigger.textContent = unitOrKw;
        if (numInput.value !== "") commit();
      }
    };

    for (const u of units) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "unit-option" + (u === currentUnit && !isKeyword ? " active" : "");
      btn.textContent = u;
      btn.onclick = () => pick(u, false);
      pop.appendChild(btn);
    }
    if (keywords.length > 0 && units.length > 0) {
      const sep = document.createElement("hr");
      sep.className = "unit-sep";
      pop.appendChild(sep);
    }
    for (const kw of keywords) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "unit-option unit-kw" + (isKeyword && kw === strVal ? " active" : "");
      btn.textContent = kw;
      btn.onclick = () => pick(kw, true);
      pop.appendChild(btn);
    }

    pop.addEventListener("toggle", (e) => {
      if (e.newState === "open") {
        const r = trigger.getBoundingClientRect();
        pop.style.position = "fixed";
        pop.style.top = r.bottom + 2 + "px";
        pop.style.left = r.right + "px";
        pop.style.transform = "translateX(-100%)";
      }
    });

    wrap.appendChild(numInput);
    wrap.appendChild(kwLabel);
    wrap.appendChild(trigger);
    wrap.appendChild(pop);
  } else {
    wrap.appendChild(numInput);
  }

  return wrap;
}
let _popoverId = 0;

function abbreviateValue(val) {
  const map = {
    inline: "inl",
    "inline-block": "i-blk",
    "inline-flex": "i-flx",
    "inline-grid": "i-grd",
    contents: "cnt",
    "flow-root": "flow",
    nowrap: "no-wr",
    "wrap-reverse": "wr-rev",
    "flex-start": "start",
    "flex-end": "end",
    "space-between": "betw",
    "space-around": "arnd",
    "space-evenly": "even",
    stretch: "str",
    baseline: "base",
    normal: "norm",
    "row-reverse": "row-r",
    "column-reverse": "col-r",
    column: "col",
  };
  return map[val] || val;
}

function renderButtonGroupInput(entry, value, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "style-input-button-group";

  const values = entry.$buttonValues || entry.enum || [];
  const iconMap = entry.$icons || {};

  for (const v of values) {
    const btn = document.createElement("button");
    btn.className = "style-btn-group-item" + (v === value ? " active" : "");
    btn.type = "button";
    btn.title = v;
    btn.dataset.value = v;

    const iconKey = iconMap[v];
    if (iconKey && icons[iconKey]) {
      btn.innerHTML = icons[iconKey];
    } else {
      btn.textContent = abbreviateValue(v);
      btn.classList.add("text-only");
    }

    btn.onclick = () => onChange(v === value ? "" : v);
    wrap.appendChild(btn);
  }

  // Overflow select for enum values not in $buttonValues
  if (entry.$buttonValues && entry.enum && entry.enum.length > entry.$buttonValues.length) {
    const extra = entry.enum.filter((v) => !entry.$buttonValues.includes(v));
    const more = document.createElement("select");
    more.className = "style-btn-group-overflow";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "+";
    more.appendChild(blank);
    for (const v of extra) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      if (v === value) opt.selected = true;
      more.appendChild(opt);
    }
    more.onchange = () => {
      if (more.value) onChange(more.value);
      more.value = "";
    };
    wrap.appendChild(more);
  }

  return wrap;
}

function renderSelectInput(entry, value, onChange) {
  const select = document.createElement("select");
  select.className = "field-input";
  select.style.flex = "1";
  select.style.minWidth = "0";

  const blankOpt = document.createElement("option");
  blankOpt.value = "";
  blankOpt.textContent = "—";
  select.appendChild(blankOpt);

  const vals = entry.enum;
  let found = false;
  for (const v of vals) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    if (v === value) {
      opt.selected = true;
      found = true;
    }
    select.appendChild(opt);
  }
  // If current value not in enum, add it
  if (value && !found) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    opt.selected = true;
    select.appendChild(opt);
  }

  select.onchange = () => onChange(select.value);
  return select;
}

function renderComboboxInput(entry, prop, value, onChange) {
  const id = `style-dl-${prop}`;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "field-input";
  input.style.flex = "1";
  input.style.minWidth = "0";
  input.value = value || "";
  input.placeholder = cssInitialMap.get(prop) || "";
  input.setAttribute("list", id);

  const dl = document.createElement("datalist");
  dl.id = id;
  for (const ex of entry.examples) {
    const opt = document.createElement("option");
    opt.value = ex;
    dl.appendChild(opt);
  }

  let debounce;
  input.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => onChange(input.value), 400);
  };

  const frag = document.createDocumentFragment();
  frag.appendChild(dl);
  frag.appendChild(input);
  // Wrap in a span to return single element
  const wrap = document.createElement("span");
  wrap.style.display = "contents";
  wrap.appendChild(dl);
  wrap.appendChild(input);
  return wrap;
}

function renderNumberInput(entry, value, onChange) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "field-input";
  input.style.flex = "1";
  input.style.minWidth = "0";
  input.value = value ?? "";
  if (entry.minimum !== undefined) input.min = entry.minimum;
  if (entry.maximum !== undefined) input.max = entry.maximum;
  if (entry.maximum !== undefined && entry.maximum <= 1) input.step = "0.1";

  let debounce;
  input.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (input.value === "") onChange("");
      else onChange(Number(input.value));
    }, 400);
  };
  return input;
}

function renderTextInput(prop, value, onChange) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "field-input";
  input.style.flex = "1";
  input.style.minWidth = "0";
  input.value = value || "";
  input.placeholder = cssInitialMap.get(prop) || "";

  let debounce;
  input.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => onChange(input.value), 400);
  };
  return input;
}

function camelToLabel(prop) {
  return prop.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function propLabel(entry, prop) {
  return entry?.$label || camelToLabel(prop);
}

function renderStyleRow(entry, prop, value, onCommit, onDelete, isWarning, gridMode) {
  const type = inferInputType(entry);
  const hasVal = value !== undefined && value !== "";
  const row = document.createElement("div");
  row.className =
    "style-row" +
    (isWarning ? " style-row--warning" : "") +
    (type === "button-group" ? " style-row--button-group" : "") +
    (gridMode ? " style-row--stacked" : "");
  row.dataset.prop = prop;
  if (gridMode && entry.$span === 2) row.style.gridColumn = "1 / -1";

  const label = document.createElement("span");
  label.className = "style-row-label";
  if (hasVal) {
    const dot = document.createElement("span");
    dot.className = "set-dot";
    dot.title = `Clear ${prop}`;
    dot.onclick = (e) => { e.stopPropagation(); onDelete(); };
    label.appendChild(dot);
  }
  const labelText = document.createTextNode(propLabel(entry, prop));
  label.appendChild(labelText);
  label.title = prop;
  row.appendChild(label);

  let widget;
  switch (type) {
    case "button-group":
      widget = renderButtonGroupInput(entry, value, onCommit);
      break;
    case "color":
      widget = renderColorInput(value, onCommit);
      break;
    case "number-unit":
      widget = renderNumberUnitInput(entry, value, onCommit);
      break;
    case "number":
      widget = renderNumberInput(entry, value, onCommit);
      break;
    case "select":
      widget = renderSelectInput(entry, value, onCommit);
      break;
    case "combobox":
      widget = renderComboboxInput(entry, prop, value, onCommit);
      break;
    default:
      widget = renderTextInput(prop, value, onCommit);
      break;
  }
  row.appendChild(widget);

  return row;
}

function renderShorthandRow(shortProp, entry, style, commitFn, deleteFn) {
  const frag = document.createDocumentFragment();
  const longhands = getLonghands(shortProp);
  const shortVal = style[shortProp];
  const hasLonghands = longhands.some((l) => style[l.name] !== undefined);
  const isExpanded = S.ui.styleShorthands[shortProp] ?? hasLonghands;

  // Shorthand header row
  const row = document.createElement("div");
  row.className = "style-row";
  row.dataset.prop = shortProp;

  const label = document.createElement("span");
  label.className = "style-row-label";
  const hasAnyVal = shortVal !== undefined || longhands.some((l) => style[l.name] !== undefined);
  if (hasAnyVal) {
    const dot = document.createElement("span");
    dot.className = "set-dot";
    dot.title = `Clear ${shortProp}`;
    dot.onclick = (e) => {
      e.stopPropagation();
      let s = S;
      if (shortVal !== undefined) s = commitFn(s, shortProp, undefined);
      for (const l of longhands) {
        if (style[l.name] !== undefined) s = commitFn(s, l.name, undefined);
      }
      update(s);
    };
    label.appendChild(dot);
  }
  label.appendChild(document.createTextNode(propLabel(entry, shortProp)));
  label.title = shortProp;
  row.appendChild(label);

  // Shorthand value — plain text input
  const input = document.createElement("input");
  input.type = "text";
  input.className = "field-input";
  input.style.flex = "1";
  input.style.minWidth = "0";
  input.value = shortVal || "";
  if (!shortVal && hasLonghands) {
    // Synthetic placeholder from longhands
    input.placeholder = longhands.map((l) => style[l.name] || "0").join(" ");
  }

  let debounce;
  input.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      // Writing shorthand clears all longhands
      let s = S;
      for (const l of longhands) {
        if (style[l.name] !== undefined) {
          s = commitFn(s, l.name, undefined);
        }
      }
      s = commitFn(s, shortProp, input.value || undefined);
      update(s);
    }, 400);
  };
  row.appendChild(input);

  // Expand toggle
  const toggle = document.createElement("span");
  toggle.className = "style-shorthand-toggle";
  toggle.textContent = isExpanded ? "⌃" : "⌄";
  toggle.onclick = (e) => {
    e.stopPropagation();
    S = {
      ...S,
      ui: { ...S.ui, styleShorthands: { ...S.ui.styleShorthands, [shortProp]: !isExpanded } },
    };
    renderRightPanel();
  };
  row.appendChild(toggle);

  frag.appendChild(row);

  // Expanded longhand rows
  if (isExpanded) {
    for (const { name, entry: lEntry } of longhands) {
      const lVal = style[name] ?? "";
      const lRow = renderStyleRow(
        lEntry,
        name,
        lVal,
        (newVal) => {
          update(commitFn(S, name, newVal || undefined));
        },
        () => update(commitFn(S, name, undefined)),
      );
      lRow.classList.add("style-row--child");
      frag.appendChild(lRow);
    }
  }

  return frag;
}

function renderSectionAddControl(sectionKey, onAdd) {
  const wrap = document.createElement("div");
  wrap.className = "style-add-input";
  wrap.style.display = "none";

  const dlId = `style-add-dl-${sectionKey}`;
  const dl = document.createElement("datalist");
  dl.id = dlId;
  for (const [name, entry] of Object.entries(cssMeta.$defs)) {
    if ((entry.$section || "other") === sectionKey && typeof entry.$shorthand !== "string") {
      const opt = document.createElement("option");
      opt.value = name;
      dl.appendChild(opt);
    }
  }
  wrap.appendChild(dl);

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Property name…";
  input.setAttribute("list", dlId);
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const prop = input.value.trim();
      if (prop) {
        onAdd(prop);
        input.value = "";
        wrap.style.display = "none";
      }
    } else if (e.key === "Escape") {
      input.value = "";
      wrap.style.display = "none";
    }
  };
  input.onblur = () => {
    setTimeout(() => {
      wrap.style.display = "none";
    }, 150);
  };
  wrap.appendChild(input);

  // Return wrap and a show function
  wrap._show = () => {
    wrap.style.display = "flex";
    input.focus();
  };
  return wrap;
}

function renderStyleSidebar(container, node, activeMediaTab, activeSelector) {
  const wrapper = document.createElement("div");
  wrapper.className = "style-sidebar";
  const style = node.style || {};
  const { sizeBreakpoints } = parseMediaEntries(S.document.$media);
  const mediaNames = sizeBreakpoints.map((bp) => bp.name);
  const activeTab = activeMediaTab;

  // Media tabs (only if there are breakpoints)
  if (mediaNames.length > 0) {
    const tabs = document.createElement("div");
    tabs.className = "media-tabs";

    const baseTab = document.createElement("div");
    baseTab.className = `media-tab${activeTab === null ? " active" : ""}`;
    baseTab.textContent = "Base";
    baseTab.onclick = () => {
      S = { ...S, ui: { ...S.ui, activeMedia: null } };
      updateActivePanelHeaders();
      renderRightPanel();
    };
    tabs.appendChild(baseTab);

    for (const name of mediaNames) {
      const tab = document.createElement("div");
      tab.className = `media-tab${activeTab === name ? " active" : ""}`;
      tab.textContent = name;
      tab.onclick = () => {
        S = { ...S, ui: { ...S.ui, activeMedia: name } };
        updateActivePanelHeaders();
        renderRightPanel();
      };
      tabs.appendChild(tab);
    }
    wrapper.appendChild(tabs);
  }

  // ── Selector dropdown ──────────────────────────────────────────────────────
  const contextStyle = activeTab ? (style[`@${activeTab}`] || {}) : style;
  const existingSelectors = Object.keys(contextStyle).filter(isNestedSelector);
  const existingSet = new Set(existingSelectors);

  const selectorBar = document.createElement("div");
  selectorBar.className = "selector-bar";

  const sel = document.createElement("select");
  sel.className = "selector-select";

  // (base)
  const baseOpt = document.createElement("option");
  baseOpt.value = "";
  baseOpt.textContent = "(base)";
  baseOpt.selected = !activeSelector;
  sel.appendChild(baseOpt);

  // Common pseudo-selectors
  const commonGroup = document.createElement("optgroup");
  commonGroup.label = "Pseudo-selectors";
  for (const s of COMMON_SELECTORS) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = existingSet.has(s) ? `${s}  \u25CF` : s;
    opt.selected = activeSelector === s;
    commonGroup.appendChild(opt);
  }
  sel.appendChild(commonGroup);

  // Custom selectors already on the node (+ activeSelector if not yet in any list)
  const commonSet = new Set(COMMON_SELECTORS);
  const extraSelectors = existingSelectors.filter((s) => !commonSet.has(s));
  if (activeSelector && !commonSet.has(activeSelector) && !existingSet.has(activeSelector)) {
    extraSelectors.unshift(activeSelector);
  }
  if (extraSelectors.length > 0) {
    const extraGroup = document.createElement("optgroup");
    extraGroup.label = "Custom";
    for (const s of extraSelectors) {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = `${s}  \u25CF`;
      opt.selected = activeSelector === s;
      extraGroup.appendChild(opt);
    }
    sel.appendChild(extraGroup);
  }

  // + Add custom...
  const addOpt = document.createElement("option");
  addOpt.value = "__add_custom__";
  addOpt.textContent = "+ Add custom\u2026";
  sel.appendChild(addOpt);

  sel.onchange = () => {
    const val = sel.value;
    if (val === "__add_custom__") {
      sel.value = activeSelector || "";
      // Show inline input
      sel.style.display = "none";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "selector-custom-input";
      inp.placeholder = ":hover, .child, &.active, [attr]";
      selectorBar.appendChild(inp);
      inp.focus();
      let done = false;
      const finish = (accept) => {
        if (done) return;
        done = true;
        const v = inp.value.trim();
        inp.remove();
        sel.style.display = "";
        if (accept && v && isNestedSelector(v)) {
          S = { ...S, ui: { ...S.ui, activeSelector: v } };
          renderRightPanel();
        }
      };
      inp.onkeydown = (e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      };
      inp.onblur = () => finish(inp.value.trim().length > 0);
      return;
    }
    const newSelector = val === "" ? null : val;
    S = { ...S, ui: { ...S.ui, activeSelector: newSelector } };
    renderRightPanel();
  };

  selectorBar.appendChild(sel);
  wrapper.appendChild(selectorBar);

  // ── Determine the active style object ──────────────────────────────────────
  let activeStyle;
  let commitStyle; // (state, prop, val) => newState
  if (activeSelector && activeTab && mediaNames.length > 0) {
    // Media + selector: style["@--md"][":hover"]
    activeStyle = (style[`@${activeTab}`] || {})[activeSelector] || {};
    commitStyle = (s, prop, val) =>
      updateMediaNestedStyle(s, S.selection, activeTab, activeSelector, prop, val);
  } else if (activeSelector) {
    // Selector only: style[":hover"]
    activeStyle = style[activeSelector] || {};
    commitStyle = (s, prop, val) =>
      updateNestedStyle(s, S.selection, activeSelector, prop, val);
  } else if (activeTab !== null && mediaNames.length > 0) {
    // Media only: style["@--md"] flat props
    activeStyle = {};
    for (const [p, v] of Object.entries(style[`@${activeTab}`] || {})) {
      if (typeof v !== "object") activeStyle[p] = v;
    }
    commitStyle = (s, prop, val) => updateMediaStyle(s, S.selection, activeTab, prop, val);
  } else {
    // Base: flat props
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
  const assigned = new Set();

  // Sort known properties into sections
  for (const [prop, entry] of Object.entries(cssMeta.$defs)) {
    // Skip longhands (rendered inside their shorthand)
    if (typeof entry.$shorthand === "string") continue;
    const sec = entry.$section || "other";
    sectionProps[sec].push({ prop, entry });
  }
  // Sort each section by $order
  for (const sec of cssMeta.$sections) {
    sectionProps[sec.key].sort((a, b) => a.entry.$order - b.entry.$order);
  }

  // Collect leftover "other" properties (on node but not in meta, or with string $shorthand that are standalone)
  const otherProps = [];
  for (const prop of Object.keys(activeStyle)) {
    if (!cssMeta.$defs[prop]) {
      otherProps.push(prop);
      assigned.add(prop);
    }
  }

  // Render sections
  for (const sec of cssMeta.$sections) {
    // Determine which props in this section are active (have values or meet conditions)
    const entries = sectionProps[sec.key];
    if (sec.key === "other") {
      // "Other" section: only render if there are unrecognized properties
      if (otherProps.length === 0) continue;

      const section = document.createElement("div");
      section.className = "style-section";
      const isOpen = S.ui.styleSections[sec.key] ?? false;

      const header = document.createElement("div");
      header.className = `style-section-header${isOpen ? "" : " collapsed"}`;
      const collapse = document.createElement("span");
      collapse.className = "style-section-collapse";
      collapse.textContent = "▼";
      const labelEl = document.createElement("span");
      labelEl.className = "style-section-label";
      labelEl.textContent = sec.label;
      header.appendChild(collapse);
      header.appendChild(labelEl);

      const body = document.createElement("div");
      body.className = `style-section-body${isOpen ? "" : " hidden"}`;

      header.onclick = () => {
        const nowOpen = !header.classList.contains("collapsed");
        header.classList.toggle("collapsed");
        body.classList.toggle("hidden");
        S = {
          ...S,
          ui: { ...S.ui, styleSections: { ...S.ui.styleSections, [sec.key]: !nowOpen } },
        };
      };

      for (const prop of otherProps) {
        body.appendChild(
          kvRow(
            prop,
            String(activeStyle[prop]),
            (newProp, newVal) => {
              if (newProp !== prop) {
                let s = commitStyle(S, prop, undefined);
                s = commitStyle(s, newProp, newVal);
                update(s);
              } else {
                update(commitStyle(S, prop, newVal));
              }
            },
            () => update(commitStyle(S, prop, undefined)),
            "css-props",
          ),
        );
      }

      section.appendChild(header);
      section.appendChild(body);
      wrapper.appendChild(section);
      continue;
    }

    // Normal section
    const section = document.createElement("div");
    section.className = "style-section";
    section.dataset.key = sec.key;
    const isOpen = S.ui.styleSections[sec.key] ?? false;

    const header = document.createElement("div");
    header.className = `style-section-header${isOpen ? "" : " collapsed"}`;
    const collapse = document.createElement("span");
    collapse.className = "style-section-collapse";
    collapse.textContent = "▼";
    const labelEl = document.createElement("span");
    labelEl.className = "style-section-label";
    labelEl.textContent = sec.label;
    header.appendChild(collapse);
    header.appendChild(labelEl);

    // Section set-indicator: dot visible when any prop in section has a value
    const sectionActiveProps = entries.filter(({ prop, entry }) => {
      if (activeStyle[prop] !== undefined) return true;
      if (inferInputType(entry) === "shorthand") {
        return getLonghands(prop).some((l) => activeStyle[l.name] !== undefined);
      }
      return false;
    });
    if (sectionActiveProps.length > 0) {
      const dot = document.createElement("span");
      dot.className = "set-dot set-dot--section";
      dot.title = `Clear all ${sec.label.toLowerCase()} properties`;
      dot.onclick = (e) => {
        e.stopPropagation();
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
      };
      header.appendChild(dot);
    }

    // Add button
    const addBtn = document.createElement("button");
    addBtn.className = "style-section-add";
    addBtn.textContent = "+";
    addBtn.onclick = (e) => {
      e.stopPropagation();
      // Ensure section is open
      if (body.classList.contains("hidden")) {
        header.classList.remove("collapsed");
        body.classList.remove("hidden");
        S = { ...S, ui: { ...S.ui, styleSections: { ...S.ui.styleSections, [sec.key]: true } } };
      }
      addControl._show();
    };
    header.appendChild(addBtn);

    const body = document.createElement("div");
    body.className = `style-section-body${isOpen ? "" : " hidden"}${sec.$layout === "grid" ? " style-section-body--grid" : ""}`;

    header.onclick = (e) => {
      if (e.target === addBtn) return;
      const nowOpen = !header.classList.contains("collapsed");
      header.classList.toggle("collapsed");
      body.classList.toggle("hidden");
      S = { ...S, ui: { ...S.ui, styleSections: { ...S.ui.styleSections, [sec.key]: !nowOpen } } };
    };

    // Render property rows
    for (const { prop, entry } of entries) {
      const val = activeStyle[prop];
      const hasVal = val !== undefined;
      const condMet = allConditionsPass(entry, activeStyle);
      const type = inferInputType(entry);

      // Skip if no value and conditions not met
      if (!hasVal && !condMet) continue;

      if (type === "shorthand") {
        // Shorthand row: render if shorthand or any longhands exist, or conditions met
        const longhands = getLonghands(prop);
        const hasAny = hasVal || longhands.some((l) => activeStyle[l.name] !== undefined);
        if (!hasAny && !condMet) continue;

        body.appendChild(renderShorthandRow(prop, entry, activeStyle, commitStyle, () => {}));
      } else {
        // Warning if has value but conditions not met
        const isWarning = hasVal && !condMet;

        if (hasVal || condMet) {
          body.appendChild(
            renderStyleRow(
              entry,
              prop,
              val ?? "",
              (newVal) => update(commitStyle(S, prop, newVal || undefined)),
              () => update(commitStyle(S, prop, undefined)),
              isWarning,
              sec.$layout === "grid",
            ),
          );
        }
      }
    }

    // Add control for this section
    const addControl = renderSectionAddControl(sec.key, (prop) => {
      const initial = cssInitialMap.get(prop) || "";
      update(commitStyle(S, prop, initial || ""));
    });
    body.appendChild(addControl);

    section.appendChild(header);
    section.appendChild(body);
    wrapper.appendChild(section);
  }

  container.appendChild(wrapper);
}

/** Top-level Style panel — renders as its own right-panel tab */
function renderStylePanel(container) {
  if (!S.selection) {
    container.innerHTML = '<div class="empty-state">Select an element to style</div>';
    return;
  }
  const node = getNodeAtPath(S.document, S.selection);
  if (!node) {
    container.innerHTML = '<div class="empty-state">Select an element to style</div>';
    return;
  }
  renderStyleSidebar(container, node, S.ui.activeMedia, S.ui.activeSelector);
}

/** Collapsible inspector section */
function renderInspectorSection(container, title, defaultOpen, contentFn) {
  const section = document.createElement("div");
  section.className = "inspector-section";

  const header = document.createElement("div");
  header.className = `inspector-header${defaultOpen ? "" : " collapsed"}`;
  header.textContent = title;

  const content = contentFn();
  if (!defaultOpen) content.classList.add("hidden");

  header.onclick = () => {
    header.classList.toggle("collapsed");
    content.classList.toggle("hidden");
  };

  section.appendChild(header);
  section.appendChild(content);
  container.appendChild(section);
}

/** Single property input row */
function fieldRow(label, type, value, onChange, datalistId) {
  const row = document.createElement("div");
  row.className = "field-row";

  const lbl = document.createElement("label");
  lbl.className = "field-label";
  lbl.textContent = label;
  row.appendChild(lbl);

  let input;
  if (type === "textarea") {
    input = document.createElement("textarea");
    input.className = "field-input";
    input.value = value;
    let debounceTimer;
    input.oninput = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChange(input.value), 400);
    };
  } else if (type === "checkbox") {
    input = document.createElement("input");
    input.className = "field-input";
    input.type = "checkbox";
    input.checked = !!value;
    input.onchange = () => onChange(input.checked);
  } else {
    input = document.createElement("input");
    input.className = "field-input";
    input.type = type;
    input.value = value;
    if (datalistId) input.setAttribute("list", datalistId);
    let debounceTimer;
    input.oninput = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChange(input.value), 400);
    };
  }
  row.appendChild(input);
  return row;
}

/**
 * Field row with binding toggle — allows switching between static value and signal binding.
 * rawValue can be a string/bool (static) or { $ref: "..." } (bound).
 */
function bindableFieldRow(label, type, rawValue, onChange, filterFn) {
  const defs = S.document.$defs || {};
  const isBound = typeof rawValue === "object" && rawValue !== null && rawValue.$ref;
  const row = document.createElement("div");
  row.className = "field-row";

  const lbl = document.createElement("label");
  lbl.className = "field-label";
  lbl.textContent = label;
  row.appendChild(lbl);

  function renderStatic() {
    const val = isBound ? "" : (rawValue ?? "");
    let input;
    if (type === "textarea") {
      input = document.createElement("textarea");
      input.className = "field-input";
      input.value = val;
      let debounce;
      input.oninput = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => onChange(input.value), 400);
      };
    } else if (type === "checkbox") {
      input = document.createElement("input");
      input.className = "field-input";
      input.type = "checkbox";
      input.checked = !!val;
      input.onchange = () => onChange(input.checked);
    } else {
      input = document.createElement("input");
      input.className = "field-input";
      input.type = type;
      input.value = val;
      let debounce;
      input.oninput = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => onChange(input.value), 400);
      };
    }
    return input;
  }

  function renderBound() {
    const sel = document.createElement("select");
    sel.className = "bind-select";
    sel.innerHTML = '<option value="">— select signal —</option>';

    const signalDefs = Object.entries(defs).filter(([, d]) =>
      filterFn ? filterFn(d) : !d.$handler && d.$prototype !== "Function",
    );
    for (const [defName] of signalDefs) {
      const opt = document.createElement("option");
      opt.value = `#/$defs/${defName}`;
      opt.textContent = defName;
      if (isBound && rawValue.$ref === `#/$defs/${defName}`) opt.selected = true;
      sel.appendChild(opt);
    }

    sel.onchange = () => {
      if (sel.value) {
        onChange({ $ref: sel.value });
      } else {
        onChange(undefined);
      }
    };
    return sel;
  }

  let inputEl = isBound ? renderBound() : renderStatic();
  row.appendChild(inputEl);

  // Toggle button
  const toggle = document.createElement("span");
  toggle.className = `bind-toggle${isBound ? " bound" : ""}`;
  toggle.textContent = isBound ? "\u26A1" : "\u2194";
  toggle.title = isBound ? "Unbind (switch to static)" : "Bind to signal";
  toggle.onclick = () => {
    if (isBound) {
      // Switch to static — use signal's default value
      const ref = rawValue.$ref;
      const defName = ref.startsWith("#/$defs/") ? ref.slice(8) : ref;
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
        onChange({ $ref: `#/$defs/${signalDefs[0][0]}` });
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

  const keyInput = document.createElement("input");
  keyInput.className = "field-input kv-key";
  keyInput.value = key;
  if (datalistId) keyInput.setAttribute("list", datalistId);

  const valInput = document.createElement("input");
  valInput.className = "field-input kv-val";
  valInput.value = value;
  // Show CSS initial value as placeholder hint
  if (datalistId === "css-props") {
    valInput.placeholder = cssInitialMap.get(key) || "";
    keyInput.addEventListener("change", () => {
      valInput.placeholder = cssInitialMap.get(keyInput.value) || "";
    });
  }

  let debounceTimer;
  const commit = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onChange(keyInput.value, valInput.value), 400);
  };
  keyInput.oninput = commit;
  valInput.oninput = commit;

  const del = document.createElement("span");
  del.className = "kv-del";
  del.textContent = "✕";
  del.onclick = onDelete;

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

  // Header bar
  const header = document.createElement("div");
  header.className = "function-editor-header";
  const title = document.createElement("span");
  title.textContent = editing.type === "def"
    ? `Function: ${editing.defName}`
    : `Event: ${editing.eventKey} on ${nodeLabel(getNodeAtPath(S.document, editing.path))}`;
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.className = "tb-btn";
  closeBtn.textContent = "Close";
  closeBtn.onclick = async () => {
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
  };
  header.appendChild(closeBtn);
  canvasWrap.appendChild(header);

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
    return S.document.$defs?.[editing.defName]?.body || "";
  } else if (editing.type === "event") {
    const node = getNodeAtPath(S.document, editing.path);
    return node?.[editing.eventKey]?.body || "";
  }
  return "";
}

// Register Monaco JS completion provider for $defs scope variables (once)
let _completionRegistered = false;
function registerFunctionCompletions() {
  if (_completionRegistered) return;
  _completionRegistered = true;
  monaco.languages.registerCompletionItemProvider("javascript", {
    triggerCharacters: ["."],
    provideCompletionItems(model, position) {
      const defs = S?.document?.$defs || {};
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
          label: `$defs.${key}`,
          kind,
          insertText: `$defs.${key}`,
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

function renderEventsPanel(container) {
  if (!S.selection) {
    container.innerHTML = '<div class="empty-state">Select an element to edit events</div>';
    return;
  }
  const node = getNodeAtPath(S.document, S.selection);
  if (!node) {
    container.innerHTML = '<div class="empty-state">Node not found</div>';
    return;
  }

  const defs = S.document.$defs || {};
  const functionDefs = Object.entries(defs).filter(
    ([, d]) => d.$prototype === "Function" || d.$handler,
  );

  const fields = document.createElement("div");
  fields.className = "inspector-fields";

  // Find existing event bindings (both $ref and inline Function)
  const eventKeys = Object.keys(node).filter((k) => {
    if (!k.startsWith("on")) return false;
    const v = node[k];
    if (!v || typeof v !== "object") return false;
    return v.$ref || v.$prototype === "Function";
  });

  for (const evKey of eventKeys) {
    const evVal = node[evKey];
    const isInline = evVal.$prototype === "Function";

    const evRow = document.createElement("div");
    evRow.className = "event-row";
    evRow.style.flexWrap = "wrap";

    // Event name select
    const nameInput = document.createElement("select");
    nameInput.className = "field-input event-name";
    nameInput.innerHTML = `<option value="${evKey}">${evKey}</option>`;
    for (const evName of EVENT_NAMES) {
      if (evName !== evKey) {
        const opt = document.createElement("option");
        opt.value = evName;
        opt.textContent = evName;
        nameInput.appendChild(opt);
      }
    }
    nameInput.onchange = () => {
      let s = updateProperty(S, S.selection, evKey, undefined);
      s = updateProperty(s, S.selection, nameInput.value, node[evKey]);
      update(s);
    };
    evRow.appendChild(nameInput);

    // Mode select (inline / $ref)
    const modeSelect = document.createElement("select");
    modeSelect.className = "field-input";
    modeSelect.style.width = "60px";
    modeSelect.style.flexShrink = "0";
    modeSelect.innerHTML = `
      <option value="inline"${isInline ? " selected" : ""}>inline</option>
      <option value="ref"${!isInline ? " selected" : ""}>$ref</option>
    `;
    modeSelect.onchange = () => {
      if (modeSelect.value === "inline") {
        update(updateProperty(S, S.selection, evKey, { $prototype: "Function", body: "", arguments: [] }));
      } else {
        const firstFn = functionDefs[0];
        update(updateProperty(S, S.selection, evKey, firstFn ? { $ref: `#/$defs/${firstFn[0]}` } : { $ref: "" }));
      }
    };
    evRow.appendChild(modeSelect);

    // Delete button
    const del = document.createElement("span");
    del.className = "kv-del";
    del.textContent = "\u2715";
    del.onclick = () => update(updateProperty(S, S.selection, evKey, undefined));
    evRow.appendChild(del);

    if (isInline) {
      // Inline mode: body textarea
      const bodyWrap = document.createElement("div");
      bodyWrap.style.cssText = "width: 100%; display: flex; gap: 4px; align-items: start; margin-top: 3px;";
      const bodyTA = document.createElement("textarea");
      bodyTA.className = "field-input";
      bodyTA.style.minHeight = "36px";
      bodyTA.style.fontFamily = "'SF Mono', 'Fira Code', 'Consolas', monospace";
      bodyTA.style.fontSize = "11px";
      bodyTA.style.flex = "1";
      bodyTA.value = evVal.body || "";
      let debounce;
      bodyTA.oninput = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          update(updateProperty(S, S.selection, evKey, {
            $prototype: "Function",
            body: bodyTA.value,
            arguments: evVal.arguments || [],
          }));
        }, 500);
      };
      bodyWrap.appendChild(bodyTA);

      // Expand to editor button
      const expandBtn = document.createElement("button");
      expandBtn.className = "kv-add";
      expandBtn.textContent = "↗";
      expandBtn.title = "Open in editor";
      expandBtn.style.padding = "2px 6px";
      expandBtn.onclick = () => {
        S = { ...S, ui: { ...S.ui, editingFunction: { type: "event", path: S.selection, eventKey: evKey } } };
        renderCanvas();
      };
      bodyWrap.appendChild(expandBtn);

      evRow.appendChild(bodyWrap);
    } else {
      // $ref mode: handler select
      const handlerSel = document.createElement("select");
      handlerSel.className = "field-input event-handler";
      handlerSel.style.flex = "1";
      handlerSel.innerHTML = '<option value="">— none —</option>';
      for (const [fName] of functionDefs) {
        const opt = document.createElement("option");
        opt.value = `#/$defs/${fName}`;
        opt.textContent = fName;
        if (evVal.$ref === `#/$defs/${fName}`) opt.selected = true;
        handlerSel.appendChild(opt);
      }
      handlerSel.onchange = () => {
        if (handlerSel.value) {
          update(updateProperty(S, S.selection, evKey, { $ref: handlerSel.value }));
        } else {
          update(updateProperty(S, S.selection, evKey, undefined));
        }
      };
      // Insert before the delete button
      evRow.insertBefore(handlerSel, del);
    }

    fields.appendChild(evRow);
  }

  // Add event button
  const add = document.createElement("span");
  add.className = "kv-add";
  add.textContent = "+ Add event";
  add.onclick = () => {
    let evName = "onclick";
    for (const name of EVENT_NAMES) {
      if (!node[name]) { evName = name; break; }
    }
    if (functionDefs.length > 0) {
      update(updateProperty(S, S.selection, evName, { $ref: `#/$defs/${functionDefs[0][0]}` }));
    } else {
      update(updateProperty(S, S.selection, evName, { $prototype: "Function", body: "", arguments: [] }));
    }
  };
  fields.appendChild(add);

  container.appendChild(fields);
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function renderToolbar() {
  toolbar.innerHTML = "";

  // File group
  const fileGroup = group();
  fileGroup.appendChild(tbBtn("Open", openFile));
  fileGroup.appendChild(tbBtn("Save", saveFile));
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

  // Breadcrumb (component navigation stack)
  if (S.documentStack && S.documentStack.length > 0) {
    const breadcrumb = document.createElement("div");
    breadcrumb.className = "breadcrumb";

    const back = document.createElement("button");
    back.className = "toolbar-btn";
    back.textContent = "← Back";
    back.title = "Return to parent document";
    back.onclick = navigateBack;
    breadcrumb.appendChild(back);

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

    const current = document.createElement("span");
    current.className = "breadcrumb-item current";
    current.textContent = S.documentPath?.split("/").pop() || S.document.tagName || "component";
    breadcrumb.appendChild(current);

    toolbar.appendChild(breadcrumb);
  }

  // Edit group
  const editGroup = group();
  editGroup.appendChild(tbBtn("Undo", () => update(undo(S))));
  editGroup.appendChild(tbBtn("Redo", () => update(redo(S))));
  toolbar.appendChild(editGroup);

  // Insert group
  const insertGroup = group();
  insertGroup.appendChild(
    tbBtn("Duplicate", () => {
      if (S.selection) update(duplicateNode(S, S.selection));
    }),
  );
  insertGroup.appendChild(
    tbBtn("Delete", () => {
      if (S.selection) update(removeNode(S, S.selection));
    }),
  );
  toolbar.appendChild(insertGroup);

  // Zoom group
  const zoomGroup = group();
  zoomGroup.appendChild(
    tbBtn("−", () => {
      S = { ...S, ui: { ...S.ui, zoom: Math.max(0.25, S.ui.zoom - 0.25) } };
      renderCanvas();
      renderOverlays();
      renderToolbar();
    }),
  );
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "tb-filename";
  zoomLabel.textContent = `${Math.round(S.ui.zoom * 100)}%`;
  zoomGroup.appendChild(zoomLabel);
  zoomGroup.appendChild(
    tbBtn("+", () => {
      S = { ...S, ui: { ...S.ui, zoom: Math.min(4, S.ui.zoom + 0.25) } };
      renderCanvas();
      renderOverlays();
      renderToolbar();
    }),
  );
  toolbar.appendChild(zoomGroup);

  // Edit / Preview toggle
  const modeGroup = group();
  const modeBtn = document.createElement("button");
  modeBtn.className = `tb-toggle${previewMode ? " active" : ""}`;
  modeBtn.textContent = previewMode ? "▶ Preview" : "✎ Edit";
  modeBtn.title = previewMode ? "Switch to edit mode" : "Switch to live preview";
  modeBtn.onclick = () => {
    previewMode = !previewMode;
    renderCanvas();
    renderOverlays();
    renderToolbar();
  };
  modeGroup.appendChild(modeBtn);
  toolbar.appendChild(modeGroup);

  // Source / Canvas toggle
  const srcGroup = group();
  const srcBtn = document.createElement("button");
  srcBtn.className = `tb-toggle${sourceMode ? " active" : ""}`;
  srcBtn.textContent = sourceMode ? "{ } Source" : "{ }";
  srcBtn.title = sourceMode ? "Switch to canvas view" : "Edit document source";
  srcBtn.onclick = () => {
    // Close function editor if active
    if (S.ui.editingFunction) {
      if (functionEditor) { functionEditor.dispose(); functionEditor = null; }
      S = { ...S, ui: { ...S.ui, editingFunction: null } };
    }
    sourceMode = !sourceMode;
    renderCanvas();
    renderOverlays();
    renderToolbar();
  };
  srcGroup.appendChild(srcBtn);
  toolbar.appendChild(srcGroup);

  // Feature toggles (non-size media queries like --dark)
  const { featureQueries } = parseMediaEntries(S.document.$media);
  if (featureQueries.length > 0) {
    const toggleGroup = group();
    for (const { name, query } of featureQueries) {
      const btn = document.createElement("button");
      btn.className = `tb-toggle${S.ui.featureToggles[name] ? " active" : ""}`;
      btn.textContent = name;
      btn.title = query;
      btn.onclick = () => {
        const newToggles = { ...S.ui.featureToggles, [name]: !S.ui.featureToggles[name] };
        S = { ...S, ui: { ...S.ui, featureToggles: newToggles } };
        renderCanvas();
        renderOverlays();
        renderToolbar();
      };
      toggleGroup.appendChild(btn);
    }
    toolbar.appendChild(toggleGroup);
  }

  // Spacer
  const spacer = document.createElement("div");
  spacer.className = "tb-spacer";
  toolbar.appendChild(spacer);

  // Export group
  const exportGroup = group();
  exportGroup.appendChild(
    tbBtn("Copy JSON", async () => {
      await navigator.clipboard.writeText(JSON.stringify(S.document, null, 2));
      statusMessage("Copied to clipboard");
    }),
  );
  toolbar.appendChild(exportGroup);
}

function group() {
  const g = document.createElement("div");
  g.className = "tb-group";
  return g;
}

function tbBtn(label, onClick) {
  const btn = document.createElement("button");
  btn.className = "tb-btn";
  btn.textContent = label;
  btn.onclick = onClick;
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
        e.preventDefault();
        S = { ...S, ui: { ...S.ui, zoom: 1 } };
        renderCanvas();
        renderOverlays();
        break;
      case "=":
      case "+":
        e.preventDefault();
        S = { ...S, ui: { ...S.ui, zoom: Math.min(4, S.ui.zoom + 0.25) } };
        renderCanvas();
        renderOverlays();
        break;
      case "-":
        e.preventDefault();
        S = { ...S, ui: { ...S.ui, zoom: Math.max(0.25, S.ui.zoom - 0.25) } };
        renderCanvas();
        renderOverlays();
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

const ctxMenu = document.createElement("div");
ctxMenu.className = "ctx-menu";
ctxMenu.style.display = "none";
document.body.appendChild(ctxMenu);

document.addEventListener("click", () => {
  ctxMenu.style.display = "none";
});

function showContextMenu(e, path) {
  e.preventDefault();
  ctxMenu.style.display = "none";

  const node = getNodeAtPath(S.document, path);
  if (!node) return;

  // Select the node
  update(selectNode(S, path));

  ctxMenu.innerHTML = "";
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
      const sep = document.createElement("div");
      sep.className = "ctx-sep";
      ctxMenu.appendChild(sep);
      continue;
    }
    const el = document.createElement("div");
    el.className = `ctx-item${item.danger ? " danger" : ""}`;
    el.textContent = item.label;
    el.onclick = () => {
      ctxMenu.style.display = "none";
      item.action();
    };
    ctxMenu.appendChild(el);
  }

  // Position the menu
  ctxMenu.style.display = "block";
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
