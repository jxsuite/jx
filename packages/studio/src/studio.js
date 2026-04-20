/**
 * Studio.js — Jx Studio main application
 *
 * Phase 1: Open a Jx file, render in canvas, edit properties in the inspector, see changes live,
 * and save. Phase 2: Tree editing with drag-and-drop reordering.
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
  updateDef,
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
  canvasWrap,
  leftPanel,
  rightPanel,
  toolbarEl,
  elToPath,
  canvasPanels,
  VOID_ELEMENTS,
  COMMON_SELECTORS,
  isNestedSelector,
  debouncedStyleCommit,
  stripEventHandlers,
  registerRenderer,
  render,
  update,
  setUpdateFn,
  setGetStateFn,
  addUpdateMiddleware,
  runUpdateMiddleware,
  addPostRenderHook,
  runPostRenderHooks,
  projectState,
  setProjectState,
} from "./store.js";

import { renderNode as runtimeRenderNode, buildScope, defineElement } from "@jxplatform/runtime";

import {
  startEditing,
  stopEditing,
  isEditing,
  getActiveElement,
  isEditableBlock,
  isInlineElement,
  isInlineInContext,
  getInlineActions,
} from "./editor/inline-edit.js";
import {
  showSlashMenu as sharedShowSlashMenu,
  dismissSlashMenu as sharedDismissSlashMenu,
  isSlashMenuOpen,
} from "./editor/slash-menu.js";
import { toggleInlineFormat, isTagActiveInSelection } from "./editor/inline-format.js";
import {
  camelToKebab,
  camelToLabel,
  kebabToLabel,
  propLabel,
  attrLabel,
  abbreviateValue,
  inferInputType,
  friendlyNameToVar,
  varDisplayName,
} from "./utils/studio-utils.js";
import { renderStatusbar, statusMessage, setStatusbarRenderer } from "./panels/statusbar.js";
import {
  openFile as _openFile,
  loadMarkdown as _loadMarkdown,
  saveFile as _saveFile,
} from "./files/file-ops.js";
import {
  loadProject as _loadProject,
  openProject as _openProject,
  renderFilesTemplate as _renderFilesTemplate,
  openFileFromTree as _openFileFromTree,
  setupTreeKeyboard,
} from "./files/files.js";
import { eventsSidebarTemplate as _eventsSidebarTemplate } from "./panels/events-panel.js";
import { exportCemManifest as _exportCemManifest } from "./services/cem-export.js";

import { registerPlatform, getPlatform, hasPlatform } from "./platform.js";
import { createDevServerPlatform } from "./platforms/devserver.js";
import { codeService, setLintMarkers, getFunctionArgs } from "./services/code-services.js";
import { getEffectiveMedia, getEffectiveStyle, getEffectiveImports } from "./site-context.js";
import {
  defCategory,
  defBadgeLabel,
  isCustomElementDoc,
  collectCssParts,
  resolveDefaultForCanvas,
  renderSignalsTemplate,
} from "./panels/signals-panel.js";
import {
  componentRegistry,
  loadComponentRegistry,
  computeRelativePath,
} from "./files/components.js";

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
import { ref } from "lit-html/directives/ref.js";
import { styleMap } from "lit-html/directives/style-map.js";
import { ifDefined } from "lit-html/directives/if-defined.js";

import webdata from "../data/webdata.json";
import cssMeta from "../data/css-meta.json";
import htmlMeta from "../data/html-meta.json";
import stylebookMeta from "../data/stylebook-meta.json";
import { renderDataExplorerTemplate } from "./panels/data-explorer.js";

// ─── Spectrum Web Components ──────────────────────────────────────────────────
// Explicit class imports + registration — bare side-effect imports are tree-shaken
// by Bun's bundler despite sideEffects declarations in Spectrum's package.json.
import { components as _swc } from "./ui/spectrum.js"; // eslint-disable-line no-unused-vars
import icons from "./ui/icons.js";
import { showContextMenu } from "./editor/context-menu.js";
import { initShortcuts } from "./editor/shortcuts.js";
import { renderActivityBar, tabIcon } from "./panels/activity-bar.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

// ─── Globals ──────────────────────────────────────────────────────────────────
// These mutable variables are local to studio.js for now. As sections are extracted
// into their own modules, they will migrate to ctx in store.js.

/** @type {any} */
let S; // current state

/** Creates a display:contents container appended to sp-theme or body, for floating popovers/menus. */
function createFloatingContainer() {
  const el = document.createElement("div");
  el.style.display = "contents";
  (document.querySelector("sp-theme") || document.body).appendChild(el);
  return el;
}

const toolbar = toolbarEl;

let canvasMode = "design";
let panX = 0;
let panY = 0;
let needsCenter = true;
/** @type {ResizeObserver | null} */
let centerObserver = null;
/** @type {any} */
let panzoomWrap = null;
/** @type {any} */
let componentInlineEdit = null;
/** @type {any} */
let pendingInlineEdit = null;
/** @type {any} */
let monacoEditor = null;
/** @type {any} */
let functionEditor = null;
/** @type {any} */
let liveScope = null;
/** @type {any} */
let blockActionBarEl = null;
/** @type {any} */
let _inlineEditCleanup = null;
/** @type {any} */
let selDragCleanup = null;

// ─── Component registry ───────────────────────────────────────────────────────

/** @param {any} componentPath */
async function navigateToComponent(componentPath) {
  try {
    const platform = getPlatform();
    const content = await platform.readFile(componentPath);
    if (!content) return;
    const doc = JSON.parse(content);
    S = pushDocument(S, doc, componentPath);
    S.dirty = false;
    render();
    statusMessage(`Editing component: ${doc.tagName || componentPath}`);
  } catch (/** @type {any} */ e) {
    const err = /** @type {any} */ (e);
    statusMessage(`Error: ${err.message}`);
  }
}

async function navigateBack() {
  if (!S.documentStack || S.documentStack.length === 0) return;
  if (S.dirty && S.documentPath) {
    try {
      const platform = getPlatform();
      await platform.writeFile(S.documentPath, JSON.stringify(S.document, null, 2));
    } catch (/** @type {any} */ e) {
      const err = /** @type {any} */ (e);
      statusMessage(`Save error: ${err.message}`);
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
      update(
        updateProperty(S, editing.path, editing.eventKey, {
          ...current,
          $prototype: "Function",
          body: bodyToStore,
        }),
      );
    }
    functionEditor.dispose();
    functionEditor = null;
  }
  S = { ...S, ui: { ...S.ui, editingFunction: null } };
  renderCanvas();
  renderToolbar();
}

/**
 * DnD cleanup functions from previous render — called on re-render
 *
 * @type {any[]}
 */
let dndCleanups = [];
/**
 * Canvas DnD cleanup functions — separate from layer panel
 *
 * @type {any[]}
 */
let canvasDndCleanups = [];

/**
 * Convert a template string to a displayable expression for edit mode. Replaces ${expr} with ❮ expr
 * ❯ so the runtime renders it as literal text.
 *
 * @param {any} str
 */
function templateToEditDisplay(str) {
  return str.replace(/\$\{([^}]+)\}/g, "\u276A $1 \u276B");
}

/**
 * Reverse templateToEditDisplay: walk all text nodes in `el` and replace ❪ expr ❫ back to ${expr}
 * so the user edits raw template syntax.
 *
 * @param {any} el
 */
function restoreTemplateExpressions(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = /** @type {any} */ (walker.currentNode);
    if (node.textContent.includes("\u276A")) {
      node.textContent = node.textContent.replace(/\u276A\s*(.*?)\s*\u276B/g, "${$1}");
    }
  }
}

/**
 * Prepare a document for edit-mode rendering. Replaces template strings with readable literal text,
 * $prototype:Array with placeholders, and $ref bindings with display labels. Preserves state so the
 * runtime can still initialise scope.
 *
 * @param {any} node
 * @returns {any}
 */
function prepareForEditMode(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(prepareForEditMode);

  /** @type {Record<string, any>} */
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
          out.children = [
            {
              tagName: "div",
              className: "repeater-perimeter",
              state: {
                $map: { item: {}, index: 0 },
                "$map/item": {},
                "$map/index": 0,
              },
              children: [prepareForEditMode(template)],
            },
          ];
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
          out.children = [
            {
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
            },
          ];
        }
      }
    } else if (k === "style") {
      // Replace template strings in style values with empty strings
      if (v && typeof v === "object") {
        /** @type {Record<string, any>} */
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
 * Render a Jx document into a canvas element using the real runtime. Populates elToPath for each
 * created element via onNodeCreated callback. Returns the live state scope on success, null on
 * failure.
 *
 * @param {any} doc
 * @param {any} canvasEl
 */
async function renderCanvasLive(doc, canvasEl) {
  canvasEl.innerHTML = "";

  // Apply content mode typography styling
  if (S.mode === "content") {
    canvasEl.setAttribute("data-content-mode", "");
  } else {
    canvasEl.removeAttribute("data-content-mode");
  }

  const renderDoc =
    canvasMode === "preview" ? structuredClone(doc) : prepareForEditMode(stripEventHandlers(doc));

  // In edit mode, collect paths where $map templates were inlined as children[0]
  // so we can remap runtime paths (children,0,...) → (children,map,...)
  const mapParentPaths = new Set();
  if (canvasMode === "design" || canvasMode === "edit") {
    (function findMapParents(/** @type {any} */ node, /** @type {any[]} */ path) {
      if (!node || typeof node !== "object") return;
      if (
        node.children &&
        typeof node.children === "object" &&
        node.children.$prototype === "Array"
      ) {
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
    const docBase = S.documentPath ? `${location.origin}/${S.documentPath}` : undefined;

    // Register custom elements so the runtime can render them
    if (renderDoc.$elements) {
      for (const entry of renderDoc.$elements) {
        if (entry?.$ref) {
          const href = new URL(entry.$ref, docBase).href;
          try {
            await defineElement(href);
          } catch (/** @type {any} */ e) {
            console.warn("Studio: failed to register element", entry.$ref, e);
          }
        }
      }
    }

    // Inject site-level imports so buildScope can resolve $prototype names
    renderDoc.imports = getEffectiveImports(renderDoc.imports);

    const $defs = await buildScope(renderDoc, {}, docBase);
    const el = /** @type {HTMLElement} */ (
      runtimeRenderNode(renderDoc, $defs, {
        onNodeCreated(/** @type {any} */ el, /** @type {any} */ path) {
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
                  } else if (
                    path.length >= i + 4 &&
                    path[i + 2] === "children" &&
                    path[i + 3] === 0
                  ) {
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
      })
    );
    if (canvasMode === "design" || canvasMode === "edit") {
      // Disable pointer events on all rendered elements for edit mode
      el.style.pointerEvents = "none";
      for (const child of el.querySelectorAll("*")) {
        /** @type {any} */ (child).style.pointerEvents = "none";
      }
    }
    canvasEl.appendChild(el);
    if (canvasMode === "design" || canvasMode === "edit") {
      // Custom element connectedCallbacks render children asynchronously —
      // sweep again after they've had a chance to run
      requestAnimationFrame(() => {
        const editingEl = getActiveElement();
        for (const child of canvasEl.querySelectorAll("*")) {
          // Preserve pointer-events on the actively-edited element
          if (componentInlineEdit && child === componentInlineEdit.el) continue;
          if (editingEl && child === editingEl) continue;
          /** @type {any} */ (child).style.pointerEvents = "none";
        }
      });
    }
    return $defs;
  } catch (/** @type {any} */ err) {
    console.warn("Jx Studio: runtime render failed, falling back to structural preview", err);
    return null;
  }
}

// ─── Webdata: datalists for autocomplete ──────────────────────────────────────

const datalistHost = document.createElement("div");
datalistHost.style.display = "contents";
document.body.appendChild(datalistHost);
litRender(
  html`
    <datalist id="tag-names">
      ${webdata.allTags.map((/** @type {any} */ tag) => html`<option value=${tag}></option>`)}
    </datalist>
    <datalist id="css-props">
      ${webdata.cssProps.map((/** @type {any} */ [name]) => html`<option value=${name}></option>`)}
    </datalist>
  `,
  datalistHost,
);

/** Map<camelCaseName, initialValue> for placeholder hints */
const cssInitialMap = new Map(/** @type {any} */ (webdata.cssProps));

// Persistent render hosts for lit-html (must be before bootstrap/render)
const zoomIndicatorHost = document.createElement("div");
zoomIndicatorHost.style.display = "contents";
document.body.appendChild(zoomIndicatorHost);

// ─── Icon maps & module-level UI state (must be before render() call) ─────────

const toolbarIconMap = /** @type {Record<string, any>} */ ({
  "sp-icon-folder-open": html`<sp-icon-folder-open slot="icon"></sp-icon-folder-open>`,
  "sp-icon-save-floppy": html`<sp-icon-save-floppy slot="icon"></sp-icon-save-floppy>`,
  "sp-icon-back": html`<sp-icon-back slot="icon"></sp-icon-back>`,
  "sp-icon-undo": html`<sp-icon-undo slot="icon"></sp-icon-undo>`,
  "sp-icon-redo": html`<sp-icon-redo slot="icon"></sp-icon-redo>`,
  "sp-icon-duplicate": html`<sp-icon-duplicate slot="icon"></sp-icon-duplicate>`,
  "sp-icon-delete": html`<sp-icon-delete slot="icon"></sp-icon-delete>`,
  "sp-icon-edit": html`<sp-icon-edit slot="icon"></sp-icon-edit>`,
  "sp-icon-artboard": html`<sp-icon-artboard slot="icon"></sp-icon-artboard>`,
  "sp-icon-preview": html`<sp-icon-preview slot="icon"></sp-icon-preview>`,
  "sp-icon-code": html`<sp-icon-code slot="icon"></sp-icon-code>`,
  "sp-icon-brush": html`<sp-icon-brush slot="icon"></sp-icon-brush>`,
  "sp-icon-document": html`<sp-icon-document slot="icon"></sp-icon-document>`,
});

/**
 * @param {any} label
 * @param {any} onClick
 * @param {any} iconTag
 */
function tbBtnTpl(label, onClick, iconTag) {
  return html`
    <sp-action-button size="s" @click=${onClick}>
      ${iconTag ? toolbarIconMap[iconTag] : nothing} ${label}
    </sp-action-button>
  `;
}

let elementsCollapsed = new Set();
let elementsFilter = "";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

// Register the dev server platform adapter (PAL) as default if none pre-registered
if (!hasPlatform()) {
  registerPlatform(createDevServerPlatform());
}

const EMPTY_DOC = {
  tagName: "div",
  style: { padding: "2rem", fontFamily: "system-ui, sans-serif" },
  children: [
    { tagName: "h1", textContent: "New Component" },
    { tagName: "p", textContent: "Open a Jx file or start editing." },
  ],
};

S = createState(structuredClone(EMPTY_DOC));

// ─── Render loop ──────────────────────────────────────────────────────────────

// Register all renderers with the store so render()/renderOnly() work
registerRenderer("toolbar", () => renderToolbar());
registerRenderer("activityBar", () => renderActivityBar(S));
registerRenderer("leftPanel", () => renderLeftPanel());
registerRenderer("canvas", () => renderCanvas());
registerRenderer("rightPanel", () => renderRightPanel());
registerRenderer("overlays", () => renderOverlays());
registerRenderer("statusbar", () => renderStatusbar(S));
setStatusbarRenderer(() => renderStatusbar(S));

// Register the update implementation with the store
setGetStateFn(() => S);
setUpdateFn(function _update(/** @type {any} */ newState) {
  const prevDoc = S.document;
  const prevSel = S.selection;
  S = newState;

  renderToolbar();

  if (prevDoc !== S.document) {
    try {
      renderCanvas();
    } catch (e) {
      console.warn("renderCanvas error:", e);
    }
    renderLeftPanel();
  } else if (!pathsEqual(prevSel, S.selection)) {
    renderLeftPanel();
  }

  // Skip right-panel rebuild when an input inside it is focused (user is typing)
  // unless the selection changed — that always needs a full re-render
  // Also re-render when color popover is open (changes come from outside rightPanel)
  const colorPopoverOpen = !!_colorPopoverHost.querySelector("sp-popover[open]");
  const activeTag = document.activeElement?.tagName;
  const rightHasFocus =
    !colorPopoverOpen &&
    rightPanel.contains(document.activeElement) &&
    (activeTag === "INPUT" ||
      activeTag === "TEXTAREA" ||
      activeTag === "SP-TEXTFIELD" ||
      activeTag === "SP-NUMBER-FIELD" ||
      activeTag === "SP-PICKER" ||
      activeTag === "SP-COMBOBOX" ||
      activeTag === "SP-SEARCH");
  if (!rightHasFocus || !pathsEqual(prevSel, S.selection)) {
    renderRightPanel();
  }
  renderOverlays();
  renderStatusbar(S);

  // Post-render hooks (pseudo-state preview, pending inline edit, etc.)
  runPostRenderHooks(prevDoc, prevSel);

  // Update middleware (autosave, etc.)
  runUpdateMiddleware(S);
});

// Register post-render hook for pseudo-state preview
addPostRenderHook(() => updateForcedPseudoPreview());

// Register post-render hook for pending inline edit
addPostRenderHook((/** @type {any} */ prevDoc) => {
  if (pendingInlineEdit && prevDoc === S.document) {
    const { path, mediaName: mn } = pendingInlineEdit;
    pendingInlineEdit = null;
    const targetPanel =
      canvasPanels.find((/** @type {any} */ p) => p.mediaName === mn) || canvasPanels[0];
    if (targetPanel) {
      const el = findCanvasElement(path, targetPanel.canvas);
      if (el) enterComponentInlineEdit(el, path);
    }
  }
});

// Now that renderers and update are registered, bootstrap
registerFunctionCompletions();

const _openParam = new URLSearchParams(location.search).get("open");

if (_openParam) {
  // ?open= mode: skip normal loadProject, set up site context from the path
  if (!_openParam.startsWith("/") && !_openParam.startsWith("~")) {
    statusMessage(`Error: ?open= requires an absolute path (got "${_openParam}")`);
    render();
  } else {
    render();
    const platform = getPlatform();
    (async () => {
      try {
        const siteCtx = platform.resolveSiteContext
          ? await platform.resolveSiteContext(_openParam)
          : { sitePath: null };

        if (siteCtx.sitePath) {
          // Set PAL project root to server-relative path so file ops work
          if (siteCtx.relPath) platform.projectRoot = siteCtx.relPath;

          setProjectState({
            root: siteCtx.sitePath,
            name: siteCtx.siteConfig?.name || "Project",
            projectRoot: siteCtx.relPath || ".",
            isSiteProject: true,
            siteConfig: siteCtx.siteConfig,
            projectDirs: [],
            dirs: new Map(),
            expanded: new Set(),
            selectedPath: siteCtx.fileRelPath || null,
            searchQuery: "",
          });

          await loadComponentRegistry();

          // Load directory tree
          const dirEntries = await platform.listDirectory(".");
          projectState.dirs.set(".", dirEntries);
          for (const e of dirEntries) {
            if (e.type === "directory" && ["pages", "components", "layouts"].includes(e.name)) {
              projectState.expanded.add(e.path || e.name);
              const sub = await platform.listDirectory(e.path || e.name);
              projectState.dirs.set(e.path || e.name, sub);
            }
          }
        }

        // Read and open the file
        const fileRelPath = siteCtx.fileRelPath || _openParam;
        const content = await platform.readFile(fileRelPath);
        if (content) {
          const doc = JSON.parse(content);
          S = createState(doc);
          S.dirty = false;
          S.documentPath = fileRelPath;
          S.ui = { ...S.ui, leftTab: "files" };
          render();
          statusMessage(`Opened ${_openParam}`);
        }
      } catch (/** @type {any} */ e) {
        statusMessage(`Error: ${e.message}`);
      }
    })();
  }
} else {
  // Normal mode: probe for project at server root
  loadComponentRegistry();
  loadProject();
  render();
}

// ─── Media helpers ────────────────────────────────────────────────────────────

/**
 * Classify $media entries into size breakpoints (get a canvas each) and feature queries (rendered
 * as toolbar toggles).
 *
 * @param {any} mediaDef
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
 * Compute which named breakpoints are active at a given canvas width. For min-width canvases: all
 * breakpoints with min-width <= canvasWidth are active. For max-width canvases: all breakpoints
 * with max-width >= canvasWidth are active.
 *
 * @param {any} sizeBreakpoints
 * @param {any} canvasWidth
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
 * Apply styles to a canvas element, including active media overrides. Base (flat) styles applied
 * first, then matching media overrides in source order.
 *
 * @param {any} el
 * @param {any} styleDef
 * @param {any} activeBreakpoints
 * @param {any} featureToggles
 */
function applyCanvasStyle(el, styleDef, activeBreakpoints, featureToggles) {
  if (!styleDef || typeof styleDef !== "object") return;
  for (const [prop, val] of Object.entries(styleDef)) {
    if (typeof val === "string" || typeof val === "number") {
      try {
        if (prop.startsWith("--")) el.style.setProperty(prop, String(val));
        else /** @type {any} */ (el.style)[prop] = val;
      } catch {}
    }
  }
  for (const [key, val] of Object.entries(styleDef)) {
    if (!key.startsWith("@") || typeof val !== "object") continue;
    const mediaName = key.slice(1);
    if (mediaName === "--") continue; // skip base canvas width key
    if (activeBreakpoints.has(mediaName) || featureToggles[mediaName]) {
      for (const [prop, v] of Object.entries(/** @type {any} */ (val))) {
        if (typeof v === "string" || typeof v === "number") {
          try {
            if (prop.startsWith("--")) el.style.setProperty(prop, String(v));
            else /** @type {any} */ (el.style)[prop] = v;
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

  // Clean up previous canvas DnD registrations and center observer
  if (centerObserver) {
    centerObserver.disconnect();
    centerObserver = null;
  }
  for (const fn of canvasDndCleanups) fn();
  canvasDndCleanups = [];
  canvasPanels.length = 0;

  // Dispose Monaco editor if switching away from source mode
  if (monacoEditor) {
    monacoEditor.dispose();
    monacoEditor = null;
  }

  litRender(nothing, canvasWrap);
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
    /** @type {HTMLDivElement | null} */
    let editorContainer = null;
    litRender(
      html`<div
        class="source-editor"
        ${ref((el) => {
          if (el) editorContainer = /** @type {HTMLDivElement} */ (el);
        })}
      ></div>`,
      canvasWrap,
    );

    const jsonStr = JSON.stringify(S.document, null, 2);
    monacoEditor = monaco.editor.create(/** @type {any} */ (editorContainer), {
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
    /** @type {any} */
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
    try {
      litRender(nothing, zoomIndicatorHost);
    } catch {
      zoomIndicatorHost.textContent = "";
    }

    const { tpl: panelTpl, panel } = canvasPanelTemplate(null, null, true);
    litRender(
      html`
        <div class="content-edit-canvas">
          <div class="content-edit-column">${panelTpl}</div>
        </div>
      `,
      canvasWrap,
    );
    canvasPanels.push(panel);
    renderCanvasIntoPanel(panel, new Set(), S.ui.featureToggles);
    return;
  }

  // Normal canvas mode (design / preview) — set up panzoom surface
  canvasWrap.style.padding = "0";
  canvasWrap.style.overflow = "hidden";

  const {
    sizeBreakpoints,
    featureQueries: _featureQueries,
    baseWidth,
  } = parseMediaEntries(getEffectiveMedia(S.document.$media));
  const hasMedia = sizeBreakpoints.length > 0;
  const featureToggles = S.ui.featureToggles;

  // Create panzoom wrapper (the element that gets transformed)
  if (!hasMedia) {
    // Single panel — use baseWidth if a custom one is defined, otherwise full-width
    const effectiveMedia = getEffectiveMedia(S.document.$media);
    const hasBaseWidth = effectiveMedia && effectiveMedia["--"];
    const label = hasBaseWidth ? `${mediaDisplayName("--")} (${baseWidth}px)` : null;
    const { tpl: panelTpl, panel } = canvasPanelTemplate(
      hasBaseWidth ? "base" : null,
      label,
      !hasBaseWidth,
      hasBaseWidth ? baseWidth : undefined,
    );
    litRender(
      html`
        <div
          class="panzoom-wrap"
          style="transform-origin:0 0"
          ${ref((el) => {
            if (el) panzoomWrap = /** @type {HTMLDivElement} */ (el);
          })}
        >
          ${panelTpl}
        </div>
      `,
      canvasWrap,
    );
    canvasPanels.push(panel);
    renderCanvasIntoPanel(panel, new Set(), featureToggles);
    applyTransform();
    observeCenterUntilStable();
    renderZoomIndicator();
    return;
  }

  // Build all panels (base + breakpoints), sorted widest-first (left to right)
  const allPanelDefs = [
    {
      name: "base",
      displayName: mediaDisplayName("--"),
      width: baseWidth,
      activeSet: activeBreakpointsForWidth(sizeBreakpoints, baseWidth),
    },
  ];
  for (const bp of sizeBreakpoints) {
    allPanelDefs.push({
      name: bp.name,
      displayName: mediaDisplayName(bp.name),
      width: bp.width,
      activeSet: activeBreakpointsForWidth(sizeBreakpoints, bp.width),
    });
  }
  allPanelDefs.sort((a, b) => b.width - a.width);

  /** @type {{ tpl: any; panel: any; activeSet: any }[]} */
  const panelEntries = allPanelDefs.map((def) => {
    const label = `${def.displayName} (${def.width}px)`;
    const { tpl, panel } = canvasPanelTemplate(def.name, label, false, def.width);
    return { tpl, panel, activeSet: def.activeSet };
  });

  litRender(
    html`
      <div
        class="panzoom-wrap"
        style="transform-origin:0 0"
        ${ref((el) => {
          if (el) panzoomWrap = /** @type {HTMLDivElement} */ (el);
        })}
      >
        ${panelEntries.map((e) => e.tpl)}
      </div>
    `,
    canvasWrap,
  );

  for (const { panel, activeSet } of panelEntries) {
    canvasPanels.push(panel);
    renderCanvasIntoPanel(panel, activeSet, featureToggles);
  }

  // Highlight active panel header
  updateActivePanelHeaders();

  // Apply current zoom + pan transform
  applyTransform();
  observeCenterUntilStable();

  // Floating zoom indicator
  renderZoomIndicator();
}

/**
 * Render document into a single canvas panel. Tries runtime rendering first, falls back to
 * structural preview.
 *
 * @param {any} panel
 * @param {any} activeBreakpoints
 * @param {any} featureToggles
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
      const targetPanel = canvasPanels.find((p) => p.mediaName === mn) || canvasPanels[0];
      if (targetPanel) {
        const el = findCanvasElement(path, targetPanel.canvas);
        if (el) enterComponentInlineEdit(el, path);
      }
    }
  });
}

/**
 * Create a canvas panel DOM structure. Returns { mediaName, element, canvas, overlay, overlayClk,
 * viewport, dropLine }
 *
 * @param {any} mediaName
 * @param {any} label
 * @param {any} fullWidth
 * @param {any} [width]
 */
function canvasPanelTemplate(mediaName, label, fullWidth, width) {
  /**
   * @type {{
   *   mediaName: any;
   *   element: Element | null;
   *   canvas: Element | null;
   *   overlay: Element | null;
   *   overlayClk: Element | null;
   *   viewport: Element | null;
   *   dropLine: Element | null;
   *   _width: any;
   * }}
   */
  const panel = {
    mediaName,
    element: null,
    canvas: null,
    overlay: null,
    overlayClk: null,
    viewport: null,
    dropLine: null,
    _width: width || null,
  };
  const tpl = html`
    <div
      class=${`canvas-panel${fullWidth ? " full-width" : ""}`}
      data-media=${ifDefined(mediaName !== null ? mediaName : undefined)}
      ${ref((el) => {
        if (el) panel.element = el;
      })}
    >
      ${label
        ? html`
            <div
              class="canvas-panel-header"
              @click=${() => {
                S = { ...S, ui: { ...S.ui, activeMedia: mediaName === "base" ? null : mediaName } };
                updateActivePanelHeaders();
                renderRightPanel();
              }}
            >
              ${label}
            </div>
          `
        : nothing}
      <div
        class="canvas-panel-viewport"
        style=${styleMap({ width: width && !fullWidth ? `${width}px` : "" })}
        ${ref((el) => {
          if (el) panel.viewport = el;
        })}
      >
        <div
          class="canvas-panel-canvas"
          style=${styleMap({ width: width ? `${width}px` : "" })}
          ${ref((el) => {
            if (el) panel.canvas = el;
          })}
        ></div>
        <div
          class="canvas-panel-overlay"
          ${ref((el) => {
            if (el) panel.overlay = el;
          })}
        >
          <div
            class="canvas-drop-indicator"
            style="display:none"
            ${ref((el) => {
              if (el) panel.dropLine = el;
            })}
          ></div>
        </div>
        <div
          class="canvas-panel-click"
          ${ref((el) => {
            if (el) panel.overlayClk = el;
          })}
        ></div>
      </div>
    </div>
  `;
  return { tpl, panel };
}

/** Center canvas in viewport. */
function centerCanvas() {
  if (!panzoomWrap) return;
  const wrapWidth = canvasWrap.clientWidth;
  const wrapHeight = canvasWrap.clientHeight;
  const contentWidth = panzoomWrap.scrollWidth;
  const contentHeight = panzoomWrap.scrollHeight;
  const scaledWidth = contentWidth * S.ui.zoom;
  const scaledHeight = contentHeight * S.ui.zoom;
  panX = Math.max(16, (wrapWidth - scaledWidth) / 2);
  // Center vertically only when content fits; top-align with margin when taller
  const verticalCenter = (wrapHeight - scaledHeight) / 2;
  panY = verticalCenter > 16 ? verticalCenter : 16;
}

/**
 * Attach a ResizeObserver to panzoomWrap that re-centers until the user pans. Handles async content
 * (runtime rendering, data fetching) that changes layout after initial paint.
 */
function observeCenterUntilStable() {
  if (centerObserver) {
    centerObserver.disconnect();
    centerObserver = null;
  }
  if (!panzoomWrap) return;
  needsCenter = true;
  centerObserver = new ResizeObserver(() => {
    if (!needsCenter) {
      centerObserver?.disconnect();
      centerObserver = null;
      return;
    }
    centerCanvas();
    applyTransform();
  });
  centerObserver.observe(panzoomWrap);
  // Also center immediately for synchronous content
  centerCanvas();
}

/** Apply the current zoom + pan transform to the panzoom wrapper. */
function applyTransform() {
  if (!panzoomWrap) return;
  panzoomWrap.style.transform = `translate(${panX}px, ${panY}px) scale(${S.ui.zoom})`;
  const label = document.querySelector(".zoom-indicator-label");
  if (label) label.textContent = `${Math.round(S.ui.zoom * 100)}%`;
  renderOverlays();
  if (canvasMode === "stylebook") renderStylebookOverlays();
}

/** Lightweight in-place zoom update — no full re-render. */
function _applyZoom() {
  applyTransform();
}

/** Calculate zoom + pan to fit all panels within the viewport. */
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
 * Render the floating zoom indicator at the bottom center of canvas-wrap. Uses position: fixed,
 * computed from canvas-wrap bounds.
 */
function renderZoomIndicator() {
  // Reset lit-html state if the host was disconnected or markers were ejected
  if (!zoomIndicatorHost.isConnected) document.body.appendChild(zoomIndicatorHost);
  try {
    litRender(
      html`
        <div class="zoom-indicator">
          <span class="zoom-indicator-label">${Math.round(S.ui.zoom * 100)}%</span>
          <sp-action-button
            quiet
            size="s"
            class="zoom-fit-btn"
            title="Fit to screen"
            @click=${fitToScreen}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <rect x="2" y="2" width="12" height="12" rx="1" />
              <path d="M2 6h12M6 2v12" />
            </svg>
          </sp-action-button>
        </div>
      `,
      zoomIndicatorHost,
    );
  } catch {
    zoomIndicatorHost.textContent = "";
    litRender(
      html`
        <div class="zoom-indicator">
          <span class="zoom-indicator-label">${Math.round(S.ui.zoom * 100)}%</span>
          <sp-action-button
            quiet
            size="s"
            class="zoom-fit-btn"
            title="Fit to screen"
            @click=${fitToScreen}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <rect x="2" y="2" width="12" height="12" rx="1" />
              <path d="M2 6h12M6 2v12" />
            </svg>
          </sp-action-button>
        </div>
      `,
      zoomIndicatorHost,
    );
  }
  positionZoomIndicator();
}

function positionZoomIndicator() {
  const indicator = /** @type {HTMLElement | null} */ (document.querySelector(".zoom-indicator"));
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

/**
 * Recursively render a Jx node to the canvas DOM. Media-aware: applies base styles + active
 * breakpoint/feature overrides.
 *
 * @param {any} node
 * @param {any} path
 * @param {any} parent
 * @param {any} activeBreakpoints
 * @param {any} featureToggles
 */
function renderCanvasNode(node, path, parent, activeBreakpoints, featureToggles) {
  // Text node children: bare strings/numbers/booleans → DOM Text nodes
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    parent.appendChild(document.createTextNode(String(node)));
    return;
  }
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
  } else if (
    node.children &&
    typeof node.children === "object" &&
    node.children.$prototype === "Array"
  ) {
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
    placeholder.style.cssText =
      "font-family:monospace;font-size:11px;padding:6px 10px;background:color-mix(in srgb, var(--danger) 8%, transparent);border:1px dashed color-mix(in srgb, var(--danger) 40%, transparent);border-radius:4px;color:var(--danger);font-style:italic";
    el.appendChild(placeholder);
  }

  el.style.pointerEvents = "none";
  parent.appendChild(el);
  return el;
}

/**
 * Track the last drag pointer position for canvas drop calculations
 *
 * @type {any}
 */
let lastDragInput = null;

/**
 * Register all canvas elements in a panel as DnD drop targets.
 *
 * @param {any} panel
 */
function registerPanelDnD(panel) {
  const { canvas, overlayClk: _overlayClk, dropLine } = panel;
  const allEls = canvas.querySelectorAll("*");

  const monitorCleanup = monitorForElements({
    onDragStart() {
      for (const el of canvas.querySelectorAll("*")) {
        /** @type {any} */ (el).style.pointerEvents = "auto";
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
        /** @type {any} */ (el).style.pointerEvents = "none";
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
    canvasDndCleanups.push(cleanup);
  }
}

/**
 * @param {any} el
 * @param {any} elPath
 * @param {any} isVoid
 */
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

  const scale = effectiveZoom();
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

// ─── Overlay system ───────────────────────────────────────────────────────────

function renderOverlays() {
  // In non-interactive modes (except stylebook), hide overlays and click interceptors
  if (canvasMode !== "design" && canvasMode !== "edit" && canvasMode !== "stylebook") {
    for (const p of canvasPanels) {
      litRender(nothing, p.overlay);
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
    const enable = S.ui.stylebookTab === "elements";
    for (const p of canvasPanels) {
      p.overlayClk.style.pointerEvents = enable ? "" : "none";
    }
    return;
  }
  for (const p of canvasPanels) {
    p.overlayClk.style.pointerEvents = componentInlineEdit || isEditing() ? "none" : "";
  }

  if (selDragCleanup) {
    selDragCleanup();
    selDragCleanup = null;
  }

  // Collect overlay boxes per panel, then render in batch
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

    // Hover overlay
    if (S.hover && !pathsEqual(S.hover, S.selection)) {
      const el = findCanvasElement(S.hover, p.canvas);
      if (el) boxes.push(overlayBoxDescriptor(el, "hover", p));
    }

    // Selection overlay (only on active panel)
    if (S.selection && p === getActivePanel()) {
      const el = findCanvasElement(S.selection, p.canvas);
      if (el) {
        const desc = overlayBoxDescriptor(el, "selection", p);
        if (componentInlineEdit || isEditing()) /** @type {any} */ (desc).border = "none";
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
  renderBlockActionBar();
}

/**
 * Build an overlay box descriptor (no DOM creation).
 *
 * @param {any} el
 * @param {any} type
 * @param {any} panel
 */
function overlayBoxDescriptor(el, type, panel) {
  const vpRect = panel.viewport.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const scale = effectiveZoom();
  return {
    cls: `overlay-box overlay-${type}`,
    top: `${(elRect.top - vpRect.top + panel.viewport.scrollTop) / scale}px`,
    left: `${(elRect.left - vpRect.left + panel.viewport.scrollLeft) / scale}px`,
    width: `${elRect.width / scale}px`,
    height: `${elRect.height / scale}px`,
  };
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

// ── Floating inline toolbar ────────────────────────────────────────────────

/** Pre-built icon templates for inline format buttons (avoids unsafeStatic) */
const formatIconMap = /** @type {Record<string, any>} */ ({
  "sp-icon-text-bold": html`<sp-icon-text-bold slot="icon"></sp-icon-text-bold>`,
  "sp-icon-text-italic": html`<sp-icon-text-italic slot="icon"></sp-icon-text-italic>`,
  "sp-icon-text-underline": html`<sp-icon-text-underline slot="icon"></sp-icon-text-underline>`,
  "sp-icon-text-strikethrough": html`<sp-icon-text-strikethrough
    slot="icon"
  ></sp-icon-text-strikethrough>`,
  "sp-icon-text-superscript": html`<sp-icon-text-superscript
    slot="icon"
  ></sp-icon-text-superscript>`,
  "sp-icon-text-subscript": html`<sp-icon-text-subscript slot="icon"></sp-icon-text-subscript>`,
  "sp-icon-code": html`<sp-icon-code slot="icon"></sp-icon-code>`,
  "sp-icon-link": html`<sp-icon-link slot="icon"></sp-icon-link>`,
});

/**
 * Prevent the bar from stealing focus from contenteditable
 *
 * @param {any} e
 */
function onBarMousedown(e) {
  if (e.target.closest("sp-textfield")) return;
  if (e.target.closest(".bar-drag-handle")) return;
  e.preventDefault();
}

/**
 * Saved selection range for format button mousedown→click flow
 *
 * @type {any}
 */
let savedRange = null;
function captureSelectionRange() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
}

/**
 * @param {any} e
 * @param {any} action
 */
function onFormatClick(e, action) {
  e.stopPropagation();
  if (action.command === "link") {
    showLinkPopover(e.target.closest("sp-action-button"));
  } else if (savedRange) {
    const sel = /** @type {any} */ (window.getSelection());
    const anchor = savedRange.startContainer;
    const editableRoot = (
      anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement
    )?.closest("[contenteditable]");
    if (editableRoot) {
      editableRoot.focus();
      sel.removeAllRanges();
      sel.addRange(savedRange);
      applyInlineFormat(action);
    }
  }
}

function renderParentSelector() {
  const pPath = parentElementPath(S.selection);
  if (!pPath) return nothing;
  const parentNode = getNodeAtPath(S.document, pPath);
  return html`
    <sp-action-button
      size="xs"
      quiet
      title="Select parent: ${nodeLabel(parentNode)}"
      @click=${(/** @type {any} */ e) => {
        e.stopPropagation();
        update(selectNode(S, pPath));
      }}
    >
      <sp-icon-back slot="icon"></sp-icon-back>
    </sp-action-button>
  `;
}

function renderMoveArrows() {
  const idx = /** @type {number} */ (childIndex(S.selection));
  const pPath = parentElementPath(S.selection);
  const parentNode = getNodeAtPath(S.document, /** @type {any} */ (pPath));
  const siblings = parentNode?.children;
  return html`
    <sp-action-button
      size="xs"
      quiet
      title="Move up"
      ?disabled=${idx <= 0}
      @click=${(/** @type {any} */ e) => {
        e.stopPropagation();
        moveSelectionUp();
      }}
    >
      <sp-icon-arrow-up slot="icon"></sp-icon-arrow-up>
    </sp-action-button>
    <sp-action-button
      size="xs"
      quiet
      title="Move down"
      ?disabled=${!siblings || idx >= siblings.length - 1}
      @click=${(/** @type {any} */ e) => {
        e.stopPropagation();
        moveSelectionDown();
      }}
    >
      <sp-icon-arrow-down slot="icon"></sp-icon-arrow-down>
    </sp-action-button>
  `;
}

/**
 * Apply an inline format action.
 *
 * @param {any} action
 */
function applyInlineFormat(action) {
  // Map commands to semantic tags
  /** @type {Record<string, any>} */
  const cmdToTag = {
    bold: "strong",
    italic: "em",
    underline: "u",
    strikethrough: "del",
    superscript: "sup",
    subscript: "sub",
    code: "code",
  };

  const tag = cmdToTag[action.command];
  if (tag) {
    const editableRoot = getActiveElement();
    toggleInlineFormat(tag, editableRoot);
  }
  requestAnimationFrame(() => renderBlockActionBar());
}

/** Show a link URL popover anchored to a toolbar button. */
const linkPopoverHost = document.createElement("div");
linkPopoverHost.style.display = "contents";
(document.querySelector("sp-theme") || document.body).appendChild(linkPopoverHost);

/** @param {any} anchorBtn */
function showLinkPopover(anchorBtn) {
  // Dismiss existing
  litRender(nothing, linkPopoverHost);

  const sel = window.getSelection();
  /** @type {any} */
  let existingLink = null;
  if (sel?.rangeCount) {
    /** @type {any} */
    let node = sel.anchorNode;
    while (node && node !== document.body) {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === "a") {
        existingLink = node;
        break;
      }
      node = node.parentNode;
    }
  }

  const rect = anchorBtn.getBoundingClientRect();

  const onApply = () => {
    const field = linkPopoverHost.querySelector("sp-textfield");
    const url = /** @type {any} */ (field)?.value;
    if (existingLink) {
      existingLink.setAttribute("href", url);
    } else if (url) {
      document.execCommand("createLink", false, url);
    }
    litRender(nothing, linkPopoverHost);
    renderBlockActionBar();
  };

  const onRemove = () => {
    const frag = document.createDocumentFragment();
    while (existingLink.firstChild) frag.appendChild(existingLink.firstChild);
    existingLink.parentNode.replaceChild(frag, existingLink);
    litRender(nothing, linkPopoverHost);
    renderBlockActionBar();
  };

  const onKeydown = (/** @type {any} */ e) => {
    if (e.key === "Enter") onApply();
    else if (e.key === "Escape") {
      litRender(nothing, linkPopoverHost);
    }
  };

  litRender(
    html`
      <sp-popover
        class="link-popover"
        open
        style="position:fixed; left:${rect.left}px; top:${rect.bottom + 4}px; z-index:30"
      >
        <sp-textfield
          placeholder="https://..."
          size="s"
          style="width:200px"
          value=${existingLink?.getAttribute("href") || ""}
          @keydown=${onKeydown}
        ></sp-textfield>
        <sp-action-button size="xs" @click=${onApply}>
          ${existingLink ? "Update" : "Apply"}
        </sp-action-button>
        ${existingLink
          ? html` <sp-action-button size="xs" @click=${onRemove}>Remove</sp-action-button> `
          : nothing}
      </sp-popover>
    `,
    linkPopoverHost,
  );

  requestAnimationFrame(
    () =>
      /** @type {HTMLElement | null} */ (linkPopoverHost?.querySelector("sp-textfield"))?.focus(),
  );
}

/** Move the selected node up (swap with previous sibling). */
function moveSelectionUp() {
  if (!S.selection || S.selection.length < 2) return;
  const idx = /** @type {number} */ (childIndex(S.selection));
  if (idx <= 0) return;
  const pPath = /** @type {any} */ (parentElementPath(S.selection));
  update(moveNode(S, S.selection, pPath, idx - 1));
  S = { ...S, selection: [...pPath, "children", idx - 1] };
  renderOverlays();
}

/** Move the selected node down (swap with next sibling). */
function moveSelectionDown() {
  if (!S.selection || S.selection.length < 2) return;
  const idx = /** @type {number} */ (childIndex(S.selection));
  const pPath = /** @type {any} */ (parentElementPath(S.selection));
  const parentNode = getNodeAtPath(S.document, pPath);
  const siblings = parentNode?.children;
  if (!siblings || idx >= siblings.length - 1) return;
  update(moveNode(S, S.selection, pPath, idx + 2));
  S = { ...S, selection: [...pPath, "children", idx + 1] };
  renderOverlays();
}

/**
 * Render the unified block action bar above the selected element. Combines tag indicator, drag
 * handle, move arrows, and inline formatting.
 */
function renderBlockActionBar() {
  // Ensure persistent render container exists
  if (!blockActionBarEl) {
    blockActionBarEl = createFloatingContainer();
  }

  // Tear down drag if it was active
  if (selDragCleanup) {
    selDragCleanup();
    selDragCleanup = null;
  }

  if (!S.selection || (canvasMode !== "design" && canvasMode !== "edit")) {
    litRender(nothing, blockActionBarEl);
    return;
  }

  const activePanel = getActivePanel();
  if (!activePanel) {
    litRender(nothing, blockActionBarEl);
    return;
  }
  const el = findCanvasElement(S.selection, activePanel.canvas);
  const node = el && getNodeAtPath(S.document, S.selection);
  if (!el || !node) {
    litRender(nothing, blockActionBarEl);
    return;
  }

  const tag = (node.tagName ?? "div").toLowerCase();
  const elRect = el.getBoundingClientRect();
  const topPos = elRect.top < 80 ? elRect.bottom + 4 : elRect.top - 38;

  // Inline format state
  const inlineEditing = isEditing() || el.contentEditable === "true";
  const actions = getInlineActions(tag) || [];
  const showFormat = inlineEditing && actions.length > 0;
  const activeValues = showFormat
    ? actions.filter((a) => isTagActiveInSelection(a.tag, el)).map((a) => a.tag)
    : [];

  litRender(
    html`
      <div
        class="block-action-bar"
        style="left:${elRect.left}px; top:${topPos}px"
        @mousedown=${onBarMousedown}
      >
        ${S.selection.length >= 2 ? renderParentSelector() : nothing}

        <span class="bar-tag">${node.$id || (node.tagName ?? "div")}</span>

        ${S.selection.length >= 2
          ? html`<span class="bar-drag-handle" title="Drag to reorder">⡇</span>`
          : nothing}
        ${S.selection.length >= 2 ? renderMoveArrows() : nothing}
        ${showFormat
          ? html`
              <sp-divider size="s" vertical></sp-divider>
              <sp-action-group
                size="xs"
                compact
                emphasized
                selects="multiple"
                selected=${activeValues.length ? JSON.stringify(activeValues) : nothing}
              >
                ${actions.map(
                  (action) => html`
                    <sp-action-button
                      size="xs"
                      value=${action.tag}
                      title="${action.label}${action.shortcut ? ` (${action.shortcut})` : ""}"
                      @mousedown=${captureSelectionRange}
                      @click=${(/** @type {any} */ e) => onFormatClick(e, action)}
                    >
                      ${formatIconMap[action.icon] ?? nothing}
                    </sp-action-button>
                  `,
                )}
              </sp-action-group>
            `
          : nothing}
      </div>
    `,
    blockActionBarEl,
  );

  // Post-render side effects
  requestAnimationFrame(() => {
    const bar = blockActionBarEl?.firstElementChild;
    if (!bar) return;
    // Clamp to window
    const barRect = bar.getBoundingClientRect();
    if (barRect.right > window.innerWidth) {
      bar.style.left = `${Math.max(0, window.innerWidth - barRect.width)}px`;
    }
    // Attach drag handle
    if (S.selection.length >= 2) {
      const handle = bar.querySelector(".bar-drag-handle");
      if (handle) {
        selDragCleanup = draggable({
          element: handle,
          getInitialData: () => ({ type: "tree-node", path: S.selection }),
        });
      }
    }
  });
}

// ── Pseudo-state preview ──────────────────────────────────────────────────────
// When a pseudo-selector (:hover, :focus, etc.) is active in the style sidebar,
// force those styles onto the selected element so the user can see the result.

/** @type {any} */
let _forcedStyleTag = null;
/** @type {any} */
let _forcedAttrEl = null;

function updateForcedPseudoPreview() {
  // Clean up previous
  if (_forcedStyleTag) {
    _forcedStyleTag.remove();
    _forcedStyleTag = null;
  }
  if (_forcedAttrEl) {
    _forcedAttrEl.removeAttribute("data-studio-forced");
    _forcedAttrEl = null;
  }

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
  /** @type {any} */
  const ctx = activeTab ? node.style[`@${activeTab}`] || {} : node.style;
  const rules = ctx[sel];
  if (!rules || typeof rules !== "object") return;

  // Build CSS text from the rules
  const cssProps = Object.entries(rules)
    .filter(([k]) => typeof rules[k] === "string" || typeof rules[k] === "number")
    .map(
      ([k, v]) =>
        `${k.replace(/[A-Z]/g, (/** @type {any} */ c) => `-${c.toLowerCase()}`)}: ${v} !important`,
    )
    .join("; ");
  if (!cssProps) return;

  el.setAttribute("data-studio-forced", "1");
  _forcedAttrEl = el;

  const tag = document.createElement("style");
  tag.textContent = `[data-studio-forced] { ${cssProps} }`;
  document.head.appendChild(tag);
  _forcedStyleTag = tag;
}

/**
 * Walk up the tree from a path, bubbling past inline elements until we find the nearest non-inline
 * ancestor. Returns the original path if already non-inline.
 *
 * @param {any} doc
 * @param {any} path
 */
function bubbleInlinePath(doc, path) {
  let currentPath = path;
  while (currentPath.length >= 2) {
    const node = getNodeAtPath(doc, currentPath);
    const pPath = parentElementPath(currentPath);
    const parentNode = pPath ? getNodeAtPath(doc, pPath) : null;
    if (!node || !parentNode) break;
    const childTag = (node.tagName ?? "div").toLowerCase();
    const parentTag = (parentNode.tagName ?? "div").toLowerCase();
    if (!isInlineInContext(childTag, parentTag)) break;
    currentPath = pPath;
  }
  return currentPath;
}

/** Effective zoom scale — always 1 in edit (content) mode, S.ui.zoom otherwise. */
function effectiveZoom() {
  return canvasMode === "edit" ? 1 : S.ui.zoom;
}

/**
 * @param {any} path
 * @param {any} canvasEl
 */
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

/** @param {any} panel */
function registerPanelEvents(panel) {
  const { canvas, overlayClk, mediaName } = panel;

  /** @param {any} fn */
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

  overlayClk.addEventListener("click", (/** @type {any} */ e) => {
    // Don't intercept clicks meant for the block action bar
    const barInner = blockActionBarEl?.firstElementChild;
    if (barInner) {
      const r = barInner.getBoundingClientRect();
      if (
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      )
        return;
    }
    // If content-mode inline editing is active, treat click outside as blur
    if (isEditing()) {
      stopEditing();
    }

    // Component-mode inline editing is handled by its own document-level listener
    // (see enterComponentInlineEdit), so nothing to do here — just fall through.

    const elements = withPanelPointerEvents(() => document.elementsFromPoint(e.clientX, e.clientY));

    for (const el of elements) {
      if (canvas.contains(el) && el !== canvas) {
        let path = elToPath.get(el);
        if (path) {
          path = bubbleInlinePath(S.document, path);
          const newMedia = mediaName === "base" ? null : (mediaName ?? null);
          S = { ...S, ui: { ...S.ui, activeMedia: newMedia } };

          // Find the DOM element for the bubbled path (may differ from hit element)
          const resolvedEl = findCanvasElement(path, canvas) || el;

          // Re-click on selected editable block: enter inline editing
          // Edit mode / content mode → rich text editing (enterInlineEdit)
          // Design mode → plaintext component editing (enterComponentInlineEdit via pendingInlineEdit)
          if (
            pathsEqual(path, S.selection) &&
            isEditableBlock(resolvedEl) &&
            (canvasMode === "edit" || S.mode === "content")
          ) {
            enterInlineEdit(resolvedEl, path);
            return;
          }

          // Design mode or first click: select and schedule component inline editing
          if (canvasMode === "design" && S.mode !== "content") {
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

  // Double-click shortcut for immediate inline editing
  overlayClk.addEventListener("dblclick", (/** @type {any} */ e) => {
    const barInner = blockActionBarEl?.firstElementChild;
    if (barInner) {
      const r = barInner.getBoundingClientRect();
      if (
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      )
        return;
    }
    if (canvasMode !== "edit" && canvasMode !== "design") return;

    const elements = withPanelPointerEvents(() => document.elementsFromPoint(e.clientX, e.clientY));

    for (const el of elements) {
      if (canvas.contains(el) && el !== canvas) {
        let path = elToPath.get(el);
        if (path) {
          path = bubbleInlinePath(S.document, path);
          const resolvedEl = findCanvasElement(path, canvas) || el;
          if (isEditableBlock(resolvedEl)) {
            const newMedia = mediaName === "base" ? null : (mediaName ?? null);
            S = { ...S, ui: { ...S.ui, activeMedia: newMedia } };
            update(selectNode(S, path));
            enterInlineEdit(resolvedEl, path);
            return;
          }
        }
      }
    }
  });

  overlayClk.addEventListener("contextmenu", (/** @type {any} */ e) => {
    const barInner = blockActionBarEl?.firstElementChild;
    if (barInner) {
      const r = barInner.getBoundingClientRect();
      if (
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      )
        return;
    }
    const elements = withPanelPointerEvents(() => document.elementsFromPoint(e.clientX, e.clientY));
    for (const el of elements) {
      if (canvas.contains(el) && el !== canvas) {
        let path = elToPath.get(el);
        if (path) {
          path = bubbleInlinePath(S.document, path);
          showContextMenu(e, path, S);
          return;
        }
      }
    }
    e.preventDefault();
  });

  overlayClk.addEventListener("mousemove", (/** @type {any} */ e) => {
    const barInner = blockActionBarEl?.firstElementChild;
    if (barInner) {
      const r = barInner.getBoundingClientRect();
      if (
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      )
        return;
    }
    const el = withPanelPointerEvents(() => document.elementFromPoint(e.clientX, e.clientY));
    if (el && canvas.contains(el) && el !== canvas) {
      let path = elToPath.get(el);
      if (path) {
        path = bubbleInlinePath(S.document, path);
        if (!pathsEqual(path, S.hover)) {
          S = hoverNode(S, path);
          renderOverlays();
        }
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
 * Enter inline editing mode on a canvas element. Hides the overlay for the element and makes it
 * contenteditable.
 *
 * @param {any} el
 * @param {any} path
 */
function enterInlineEdit(el, path) {
  // Restore raw template expressions before editing.
  // prepareForEditMode renders ${expr} as ❪ expr ❫ for display;
  // revert so the user edits the real syntax and commits it back intact.
  restoreTemplateExpressions(el);

  // Hide overlays while editing
  for (const p of canvasPanels) {
    p.overlay.style.display = "none";
    p.overlayClk.style.pointerEvents = "none";
  }

  startEditing(el, path, {
    onCommit(
      /** @type {any} */ commitPath,
      /** @type {any} */ children,
      /** @type {any} */ textContent,
    ) {
      // Update the Jx node with the edited content
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

    onSplit(/** @type {any} */ splitPath, /** @type {any} */ before, /** @type {any} */ after) {
      // Update current element with "before" content
      const tag = "p";
      let s = S;

      if (before.textContent != null) {
        s = updateProperty(s, splitPath, "children", undefined);
        s = updateProperty(s, splitPath, "textContent", before.textContent);
      } else if (before.children) {
        s = updateProperty(s, splitPath, "textContent", undefined);
        s = updateProperty(s, splitPath, "children", before.children);
      }

      // Insert new element after with "after" content
      const parentPath = /** @type {any} */ (parentElementPath(splitPath));
      const idx = /** @type {number} */ (childIndex(splitPath));
      /** @type {any} */
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
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        }
      });
    },

    onInsert(/** @type {any} */ afterPath, /** @type {any} */ cmd) {
      // cmd comes from the shared slash menu: { label, tag, description }
      const elementDef = defaultDef(cmd.tag);
      const parentPath = /** @type {any} */ (parentElementPath(afterPath));
      const idx = /** @type {number} */ (childIndex(afterPath));
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
      // Cleanup inline edit listeners
      if (_inlineEditCleanup) {
        _inlineEditCleanup();
        _inlineEditCleanup = null;
      }
      // Restore overlays after inline editing ends
      for (const p of canvasPanels) {
        p.overlay.style.display = "";
        p.overlayClk.style.pointerEvents = "";
      }
      renderOverlays();
    },
  });

  // Show the block action bar (with inline formatting buttons) on the viewport
  // Defer to ensure this runs after any synchronous renderOverlays() from update()
  requestAnimationFrame(() => renderBlockActionBar());

  // Re-render action bar when selection changes inside contenteditable
  const selectionHandler = () => renderBlockActionBar();
  document.addEventListener("selectionchange", selectionHandler);
  el.addEventListener("mouseup", selectionHandler);
  el.addEventListener("keyup", selectionHandler);

  // Store listeners for cleanup
  const inlineEditCleanup = () => {
    document.removeEventListener("selectionchange", selectionHandler);
    el.removeEventListener("mouseup", selectionHandler);
    el.removeEventListener("keyup", selectionHandler);
  };
  _inlineEditCleanup = inlineEditCleanup;
}

// ─── Component-mode inline text editing ──────────────────────────────────────

/**
 * @param {any} el
 * @param {any} path
 */
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
    el,
    path,
    originalText: rawText,
    mediaName: canvasPanels.find((p) => p.canvas.contains(el))?.mediaName || null,
  };

  // Focus and place cursor at end
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);

  el.addEventListener("keydown", componentInlineKeydown);
  el.addEventListener("input", componentInlineInput);

  // Document-level mousedown: clicking outside the editing element commits
  // the edit and selects the new target element for inline editing.
  const outsideHandler = (/** @type {any} */ evt) => {
    if (!componentInlineEdit) {
      document.removeEventListener("mousedown", outsideHandler, true);
      return;
    }
    if (componentInlineEdit.el.contains(evt.target)) return; // click within editing el — let it through
    // Let clicks through when the slash command menu is open
    if (isSlashMenuOpen()) return;
    // Let clicks inside the block action bar through
    if (blockActionBarEl && blockActionBarEl.contains(evt.target)) return;
    document.removeEventListener("mousedown", outsideHandler, true);

    // Hit-test BEFORE commit (while the current canvas DOM + elToPath are still valid)
    let hitPath = null,
      hitMedia = null;
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
        const removedIdx = /** @type {number} */ (childIndex(editPath));
        const hitIdx = /** @type {number} */ (childIndex(hitPath));
        const hitParent = parentElementPath(hitPath);
        if (hitParent && pPath && hitParent.join("/") === pPath.join("/") && hitIdx > removedIdx) {
          hitPath = [...pPath, "children", hitIdx - 1];
          pendingInlineEdit = { path: hitPath, mediaName: hitMedia };
        }
        update(selectNode(s, hitPath));
      } else if (newText !== originalText) {
        update(
          selectNode(updateProperty(S, editPath, "textContent", newText || undefined), hitPath),
        );
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

  // Re-render block action bar to show inline formatting buttons
  renderBlockActionBar();
}

/** @param {any} e */
function componentInlineKeydown(e) {
  // When slash menu is open, let the shared module's capturing handler deal with it
  if (isSlashMenuOpen()) {
    if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) return;
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
  const sel = /** @type {any} */ (el.ownerDocument.defaultView?.getSelection());
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

  const tag = "p";
  const pPath = /** @type {any} */ (parentElementPath(path));
  const idx = /** @type {number} */ (childIndex(path));
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

function _commitComponentInlineEdit() {
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

/** @param {any} el */
function cleanupComponentInlineEdit(el) {
  el.removeEventListener("keydown", componentInlineKeydown);
  el.removeEventListener("input", componentInlineInput);
  sharedDismissSlashMenu();
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

// ─── Component-mode slash commands (delegates to shared slash-menu.js) ────────

function componentInlineInput() {
  if (!componentInlineEdit) return;
  const { el, originalText } = componentInlineEdit;
  const text = el.textContent || "";

  // Only trigger slash menu when the paragraph was originally empty and starts with /
  if (originalText === "" && text.startsWith("/")) {
    const filter = text.slice(1).toLowerCase();
    sharedShowSlashMenu(el, filter, { onSelect: handleComponentSlashSelect });
  } else {
    sharedDismissSlashMenu();
  }
}

/** @param {any} cmd */
function handleComponentSlashSelect(cmd) {
  if (!componentInlineEdit) return;
  const { el, path, mediaName } = componentInlineEdit;
  const pPath = parentElementPath(path);
  const idx = /** @type {number} */ (childIndex(path));
  if (!pPath) return;

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

// ─── Left panel: Layers ───────────────────────────────────────────────────────

function renderLeftPanel() {
  const tab = S.ui.leftTab;

  /** @type {any} */
  let content;
  if (tab === "layers")
    content = canvasMode === "stylebook" ? renderStylebookLayersTemplate() : renderLayersTemplate();
  else if (tab === "components") content = renderComponentsTemplate();
  else if (tab === "files") content = renderFilesTemplate();
  else if (tab === "blocks") content = renderElementsTemplate();
  else if (tab === "state") content = renderSignalsTemplate(S, { renderLeftPanel, renderCanvas });
  else if (tab === "data")
    content = renderDataExplorerTemplate(S.document.state, liveScope, {
      renderCanvas,
      renderLeftPanel,
      defCategory,
      defBadgeLabel,
    });
  else content = nothing;

  litRender(html`<div class="panel-body">${content}</div>`, /** @type {any} */ (leftPanel));

  // Post-render side effects
  if (tab === "layers" && canvasMode !== "stylebook") registerLayersDnD();
  else if (tab === "components") registerComponentsDnD();
  else if (tab === "blocks") registerElementsDnD();
  else if (tab === "files") {
    const tree = /** @type {any} */ (leftPanel)?.querySelector(".file-tree");
    if (tree) setupTreeKeyboard(tree);
  }
}

/** Returns a TemplateResult — called from renderLeftPanel only when tab=layers & not stylebook */
function renderLayersTemplate() {
  // Clean up previous DnD registrations
  for (const fn of dndCleanups) fn();
  dndCleanups = [];

  const rows = flattenTree(S.document);
  const collapsed = S._collapsed || (S._collapsed = new Set());

  // Build layer rows
  /** @type {any[]} */
  const layerRows = [];
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

    // Text node children: display-only row with truncated preview
    if (nodeType === "text") {
      const textPreview = String(node).length > 40 ? String(node).slice(0, 40) + "…" : String(node);
      layerRows.push(html`
        <div
          class="layer-row"
          style="padding-left:${depth * 16 + 8}px; opacity: 0.6; font-style: italic;"
        >
          <span class="layer-tag" style="background: #64748b; font-size: 0.65rem;">text</span>
          <span class="layer-label">${textPreview}</span>
        </div>
      `);
      continue;
    }

    // Skip inline elements
    if (path.length >= 2 && nodeType === "element") {
      const pPath = parentElementPath(path);
      const parentNode = pPath ? getNodeAtPath(S.document, pPath) : null;
      if (parentNode && isInlineElement(node, parentNode)) continue;
    }

    const key = pathKey(path);
    const isSelected = pathsEqual(path, S.selection);
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const hasMapChildren =
      node.children && typeof node.children === "object" && node.children.$prototype === "Array";
    const hasCases =
      node.$switch &&
      node.cases &&
      typeof node.cases === "object" &&
      Object.keys(node.cases).length > 0;
    const isExpandable =
      hasChildren || hasMapChildren || hasCases || (nodeType === "map" && node.map);
    const isVoidEl = VOID_ELEMENTS.has((node.tagName || "div").toLowerCase());

    // Badge
    /** @type {any} */
    let badgeClass, badgeText, badgeTitle;
    if (nodeType === "map") {
      badgeClass = "layer-tag map-tag";
      badgeText = "↻";
      badgeTitle = "Repeater (mapped array)";
    } else if (nodeType === "case" || nodeType === "case-ref") {
      badgeClass = "layer-tag case-tag";
      badgeText = path[path.length - 1];
      badgeTitle = `$switch case: ${path[path.length - 1]}`;
    } else if (node.$switch) {
      badgeClass = "layer-tag switch-tag";
      badgeText = "⇄";
      badgeTitle = "$switch";
    } else {
      badgeClass = "layer-tag";
      badgeText = node.tagName || "div";
      badgeTitle = undefined;
    }

    // Label
    /** @type {any} */
    let labelText, labelItalic;
    if (nodeType === "case-ref") {
      labelText = node.$ref || "external";
      labelItalic = true;
    } else {
      labelText = nodeLabel(node);
      labelItalic = false;
    }

    // Compute move-button availability for element nodes
    const isElement = nodeType === "element";
    const isRoot = path.length < 2;
    const idx = isElement ? /** @type {number} */ (childIndex(path)) : 0;
    const parentPath = isElement && !isRoot ? /** @type {any} */ (parentElementPath(path)) : null;
    const parentNode = parentPath ? getNodeAtPath(S.document, parentPath) : null;
    const siblingCount = parentNode?.children?.length || 0;
    const canMoveUp = isElement && !isRoot && idx > 0;
    const canMoveDown = isElement && !isRoot && idx < siblingCount - 1;
    // "in" = move into the previous sibling (become its last child)
    const prevSibling = canMoveUp && parentNode ? parentNode.children[idx - 1] : null;
    const canMoveIn =
      isElement &&
      !isRoot &&
      prevSibling &&
      !VOID_ELEMENTS.has((prevSibling.tagName || "div").toLowerCase());
    // "out" = move out of parent to grandparent (after parent)
    const grandparentPath =
      isElement && parentPath && parentPath.length >= 2
        ? /** @type {any} */ (parentElementPath(parentPath))
        : null;
    const canMoveOut = isElement && !isRoot && !!grandparentPath;

    layerRows.push(html`
      <div
        class="layer-row${isSelected ? " selected" : ""}"
        data-path=${key}
        data-dnd-row=${isElement ? key : nothing}
        data-dnd-depth=${isElement ? depth : nothing}
        data-dnd-void=${isElement && isVoidEl ? "" : nothing}
        @click=${() => update(selectNode(S, path))}
        @contextmenu=${isElement ? (/** @type {any} */ e) => showContextMenu(e, path, S) : nothing}
      >
        <span class="layer-indent" style="width:${depth * 16}px"></span>
        <span class="layer-toggle"
          >${isExpandable
            ? html`
                ${collapsed.has(key)
                  ? html`<sp-icon-chevron-right></sp-icon-chevron-right>`
                  : html`<sp-icon-chevron-down></sp-icon-chevron-down>`}
              `
            : nothing}</span
        >
        <span class=${badgeClass} title=${badgeTitle ?? nothing}>${badgeText}</span>
        <span class="layer-label" style=${labelItalic ? "font-style:italic" : nothing}
          >${labelText}</span
        >
        ${isElement && !isRoot
          ? html`
              <span class="layer-actions">
                ${canMoveUp
                  ? html`<sp-action-button
                      quiet
                      size="xs"
                      title="Move up"
                      @click=${(/** @type {any} */ e) => {
                        e.stopPropagation();
                        /** @type {HTMLElement} */ (e.currentTarget).blur();
                        update(moveNode(S, path, parentPath, idx - 1));
                      }}
                    >
                      <sp-icon-arrow-up slot="icon"></sp-icon-arrow-up>
                    </sp-action-button>`
                  : nothing}
                ${canMoveDown
                  ? html`<sp-action-button
                      quiet
                      size="xs"
                      title="Move down"
                      @click=${(/** @type {any} */ e) => {
                        e.stopPropagation();
                        /** @type {HTMLElement} */ (e.currentTarget).blur();
                        update(moveNode(S, path, parentPath, idx + 1));
                      }}
                    >
                      <sp-icon-arrow-down slot="icon"></sp-icon-arrow-down>
                    </sp-action-button>`
                  : nothing}
                ${canMoveIn
                  ? html`<sp-action-button
                      quiet
                      size="xs"
                      title="Move into previous sibling"
                      @click=${(/** @type {any} */ e) => {
                        e.stopPropagation();
                        /** @type {HTMLElement} */ (e.currentTarget).blur();
                        const prevPath = [...parentPath, idx - 1];
                        const prev = getNodeAtPath(S.document, prevPath);
                        const len = prev?.children?.length || 0;
                        update(moveNode(S, path, prevPath, len));
                      }}
                    >
                      <sp-icon-arrow-right slot="icon"></sp-icon-arrow-right>
                    </sp-action-button>`
                  : nothing}
                ${canMoveOut
                  ? html`<sp-action-button
                      quiet
                      size="xs"
                      title="Move out of parent"
                      @click=${(/** @type {any} */ e) => {
                        e.stopPropagation();
                        /** @type {HTMLElement} */ (e.currentTarget).blur();
                        const parentIdx = /** @type {number} */ (childIndex(parentPath));
                        update(moveNode(S, path, grandparentPath, parentIdx + 1));
                      }}
                    >
                      <sp-icon-arrow-left slot="icon"></sp-icon-arrow-left>
                    </sp-action-button>`
                  : nothing}
                <sp-action-button
                  quiet
                  size="xs"
                  class="layer-delete"
                  title="Delete"
                  @click=${(/** @type {any} */ e) => {
                    e.stopPropagation();
                    update(removeNode(S, path));
                  }}
                >
                  <sp-icon-close slot="icon"></sp-icon-close>
                </sp-action-button>
              </span>
            `
          : nothing}
      </div>
    `);

    // Collapse toggle click handler — we add it via event delegation on the layer-toggle span
    // It's already in the template above as the toggle span, but we need the click handler
  }

  return html`
    <div class="layers-container" style="position:relative">
      <div
        class="layers-tree"
        @click=${(/** @type {any} */ e) => {
          const toggle = e.target.closest(".layer-toggle");
          if (!toggle) return;
          e.stopPropagation();
          const row = toggle.closest(".layer-row");
          if (!row) return;
          const key = row.dataset.path;
          if (!key) return;
          if (collapsed.has(key)) collapsed.delete(key);
          else collapsed.add(key);
          renderLeftPanel();
        }}
      >
        ${layerRows}
      </div>
    </div>
  `;
}

/** Register DnD on layer rows after litRender — called from renderLeftPanel */
function registerLayersDnD() {
  requestAnimationFrame(() => {
    const container = /** @type {any} */ (leftPanel)?.querySelector(".layers-container");
    if (!container) return;

    container.querySelectorAll("[data-dnd-row]").forEach(
      /** @param {any} row */ (row) => {
        const rowPath = /** @type {string} */ (row.dataset.path)
          .split("/")
          .map((/** @type {any} */ s) => (/^\d+$/.test(s) ? parseInt(s) : s));
        const rowDepth = parseInt(/** @type {string} */ (row.dataset.dndDepth)) || 0;
        const isVoid = row.hasAttribute("data-dnd-void");

        const cleanup = combine(
          draggable({
            element: row,
            canDrag(/** @type {any} */ { element: _el, input }) {
              // Prevent drag when clicking action buttons
              const target = /** @type {HTMLElement} */ (
                document.elementFromPoint(input.clientX, input.clientY)
              );
              if (target?.closest(".layer-actions")) return false;
              return true;
            },
            getInitialData() {
              return { type: "tree-node", path: rowPath };
            },
            onDragStart() {
              row.classList.add("dragging");
              layerDragSourceHeight = row.offsetHeight;
            },
            onDrop() {
              row.classList.remove("dragging");
            },
          }),
          dropTargetForElements({
            element: row,
            canDrop(/** @type {any} */ { source }) {
              const srcPath = source.data.path;
              if (srcPath && isAncestor(srcPath, rowPath)) return false;
              return true;
            },
            getData(/** @type {any} */ { input, element }) {
              return attachInstruction(
                { path: rowPath },
                /** @type {any} */ ({
                  input,
                  element,
                  currentLevel: rowDepth,
                  indentPerLevel: 16,
                  block: isVoid ? ["make-child"] : [],
                }),
              );
            },
            onDragEnter(/** @type {any} */ { self }) {
              showLayerDropGap(row, self.data, container);
            },
            onDrag(/** @type {any} */ { self }) {
              showLayerDropGap(row, self.data, container);
            },
            onDragLeave() {
              clearLayerDropGap(container);
            },
            onDrop() {
              clearLayerDropGap(container);
            },
          }),
        );
        dndCleanups.push(cleanup);
      },
    );

    // Global monitor
    const monitorCleanup = monitorForElements({
      onDrop(/** @type {any} */ { source, location }) {
        clearLayerDropGap(container);
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
  });
}

/** Register DnD on component rows — called from renderLeftPanel when tab=components */
function registerComponentsDnD() {
  requestAnimationFrame(() => {
    const container = /** @type {any} */ (leftPanel)?.querySelector(".components-section");
    if (!container) return;

    container.querySelectorAll("[data-component-tag]").forEach(
      /** @param {any} row */ (row) => {
        const tagName = row.dataset.componentTag;
        if (!tagName) return;
        const comp = componentRegistry.find(/** @param {any} c */ (c) => c.tagName === tagName);
        if (!comp) return;

        // Fill preview with live rendered component
        const preview = row.querySelector(".element-card-preview");
        if (preview && !preview.querySelector(tagName)) {
          renderComponentPreview(comp).then((el) => {
            preview.textContent = "";
            preview.appendChild(el);
          });
        }

        const instanceDef = {
          tagName: comp.tagName,
          $props: Object.fromEntries(
            comp.props.map((/** @type {any} */ p) => [
              p.name,
              p.default !== undefined ? p.default : "",
            ]),
          ),
        };
        const cleanup = draggable({
          element: row,
          getInitialData() {
            return { type: "block", fragment: structuredClone(instanceDef) };
          },
        });
        dndCleanups.push(cleanup);
      },
    );
  });
}

/** @type {any} */
let _currentDropTargetRow = null;
let layerDragSourceHeight = 0;

/**
 * @param {any} rowEl
 * @param {any} data
 * @param {any} container
 */
function showLayerDropGap(rowEl, data, container) {
  const instruction = extractInstruction(data);

  // Clear previous drop-target highlight
  if (_currentDropTargetRow && _currentDropTargetRow !== rowEl) {
    _currentDropTargetRow.classList.remove("drop-target");
  }

  if (!instruction || instruction.type === "instruction-blocked") {
    clearLayerDropGap(container);
    return;
  }

  if (instruction.type === "make-child") {
    clearLayerDropGap(container);
    rowEl.classList.add("drop-target");
    _currentDropTargetRow = rowEl;
    return;
  }

  rowEl.classList.remove("drop-target");
  _currentDropTargetRow = rowEl;

  // Shift rows to create gap
  const rows = Array.from(container.querySelectorAll(".layers-tree .layer-row"));
  const targetIdx = rows.indexOf(rowEl);
  const gap = layerDragSourceHeight;

  for (let i = 0; i < rows.length; i++) {
    if (rows[i].classList.contains("dragging")) continue;
    if (instruction.type === "reorder-above") {
      rows[i].style.transform = i >= targetIdx ? `translateY(${gap}px)` : "";
    } else {
      rows[i].style.transform = i > targetIdx ? `translateY(${gap}px)` : "";
    }
  }
}

/** @param {any} container */
function clearLayerDropGap(container) {
  if (_currentDropTargetRow) {
    _currentDropTargetRow.classList.remove("drop-target");
    _currentDropTargetRow = null;
  }
  const rows = container.querySelectorAll(".layers-tree .layer-row");
  for (const r of rows) r.style.transform = "";
}

/** Returns a TemplateResult — called from renderLeftPanel when tab=components */
function renderComponentsTemplate() {
  if (componentRegistry.length === 0) {
    return html`<div
      class="empty-state"
      style="padding:24px;text-align:center;color:var(--text-hint)"
    >
      No components found in this project.
    </div>`;
  }

  return html`
    <div class="components-section" style="padding:4px">
      ${componentRegistry.map(
        /** @param {any} comp */ (comp) => html`
          <div
            class="element-card"
            data-component-tag=${comp.tagName}
            @click=${() => navigateToComponent(comp.path)}
            title=${comp.path}
          >
            <div class="element-card-preview">
              <span style="color:var(--fg-dim);font-size:11px;font-style:italic"
                >&lt;${comp.tagName}&gt;</span
              >
            </div>
            <div class="element-card-label">
              ${comp.tagName}${comp.$id
                ? html` <span class="signal-hint">${comp.$id}</span>`
                : nothing}
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

/**
 * Select a tag in the stylebook — shared by layers panel click and canvas click.
 *
 * @param {string} tag
 * @param {string | null} [media]
 */
function selectStylebookTag(tag, media) {
  S = {
    ...S,
    selection: [],
    ui: {
      ...S.ui,
      stylebookSelection: tag,
      rightTab: "style",
      activeSelector: `& ${tag}`,
      ...(media !== undefined ? { activeMedia: media } : {}),
    },
  };
  renderStylebookOverlays();
  renderRightPanel();
  renderLeftPanel();
  renderToolbar();
  if (canvasPanels.length > 0) {
    const el = findStylebookEl(canvasPanels[0].canvas, tag);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function renderStylebookLayersTemplate() {
  const rootStyle = S.document?.style || {};
  const selectedTag = S.ui.stylebookSelection;

  if (S.ui.stylebookTab === "elements") {
    /**
     * Render a stylebook entry row with recursive children.
     *
     * @param {any} entry
     * @param {number} depth
     * @returns {any}
     */
    const renderEntryRow = (entry, depth = 0) => {
      const tag = entry.tag;
      // Deduplicate children by tag (e.g. multiple <li> → show one "li" row)
      const uniqueChildren = entry.children
        ? [...new Map(entry.children.map((/** @type {any} */ c) => [c.tag, c])).values()]
        : [];
      return html`
        <div
          class="layer-row${tag === selectedTag ? " selected" : ""}"
          style="padding-left:${8 + depth * 16}px"
          @click=${(/** @type {any} */ e) => {
            e.stopPropagation();
            selectStylebookTag(tag);
          }}
        >
          <span class="layer-tag">${tag}</span>
          <span
            class="layer-label"
            style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1"
            >${entry.text || `<${tag}>`}</span
          >
          ${hasTagStyle(rootStyle, tag)
            ? html`<span
                style="width:6px;height:6px;border-radius:50%;background:var(--accent);flex-shrink:0"
              ></span>`
            : nothing}
        </div>
        ${uniqueChildren.map((/** @type {any} */ child) => renderEntryRow(child, depth + 1))}
      `;
    };

    /** @type {any[]} */
    const elementRows = [];
    for (const section of stylebookMeta.$sections) {
      for (const entry of /** @type {any[]} */ (section.elements)) {
        elementRows.push(renderEntryRow(entry, 0));
      }
    }
    // Custom components
    const compRows = componentRegistry.map(
      /** @param {any} comp */ (comp) => html`
        <div
          class="layer-row${comp.tagName === selectedTag ? " selected" : ""}"
          @click=${() => selectStylebookTag(comp.tagName)}
        >
          <span class="layer-tag component-tag" style="background:var(--accent)">⬡</span>
          <span class="layer-label">${comp.tagName}</span>
        </div>
      `,
    );
    return html`${elementRows}${compRows}`;
  } else {
    // Variables tab
    const style = rootStyle;
    const vars = Object.entries(style).filter(([k]) => k.startsWith("--"));
    if (vars.length === 0) {
      return html`<div style="padding:16px;text-align:center;color:var(--fg-dim);font-size:12px">
        No variables defined
      </div>`;
    }
    return html`${vars.map(
      ([k, v]) => html`
        <div class="layer-row">
          <span class="layer-tag" style="font-size:10px;font-family:'SF Mono','Fira Code',monospace"
            >var</span
          >
          <span class="layer-label">${k}</span>
          <span
            style="font-size:11px;color:var(--fg-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px"
            >${String(v)}</span
          >
        </div>
      `,
    )}`;
  }
}

/**
 * Apply a DnD instruction to the state
 *
 * @param {any} instruction
 * @param {any} srcData
 * @param {any} targetPath
 */
function applyDropInstruction(instruction, srcData, targetPath) {
  if (srcData.type === "tree-node") {
    const fromPath = srcData.path;
    const targetParent = /** @type {any} */ (parentElementPath(targetPath));
    const targetIdx = /** @type {number} */ (childIndex(targetPath));

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
    const targetParent = /** @type {any} */ (parentElementPath(targetPath));
    const targetIdx = /** @type {number} */ (childIndex(targetPath));

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
      const comp = componentRegistry.find((/** @type {any} */ c) => c.tagName === tag);
      if (comp) {
        const elements = S.document.$elements || [];
        const alreadyImported = elements.some(
          (/** @type {any} */ e) =>
            e.$ref && (e.$ref === `./${comp.path}` || e.$ref.endsWith(comp.path.split("/").pop())),
        );
        if (!alreadyImported) {
          const relPath = computeRelativePath(S.documentPath, comp.path);
          S = applyMutation(S, (/** @type {any} */ doc) => {
            if (!doc.$elements) doc.$elements = [];
            doc.$elements.push({ $ref: relPath });
          });
        }
      }
    }
  }
}

/**
 * Generate a sensible default Jx node for a given tag name
 *
 * @param {any} tag
 */
function defaultDef(tag) {
  /** @type {any} */
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

const unsafeTags = new Set(["script", "style", "link", "iframe", "object", "embed"]);

function renderElementsTemplate() {
  const categories = Object.entries(webdata.elements).map(
    (/** @type {any} */ [category, elements]) => {
      const filtered = elementsFilter
        ? elements.filter((/** @type {any} */ e) => e.tag.includes(elementsFilter))
        : elements;
      if (filtered.length === 0) return nothing;

      return html`
        <sp-accordion-item
          label=${category}
          ?open=${!elementsCollapsed.has(category)}
          @sp-accordion-item-toggle=${(/** @type {any} */ e) => {
            if (e.target.open) elementsCollapsed.delete(category);
            else elementsCollapsed.add(category);
          }}
        >
          ${filtered.map((/** @type {any} */ { tag }) => {
            const def = defaultDef(tag);
            return html`
              <div
                class="element-card"
                data-block-tag=${tag}
                @click=${() => {
                  const parentPath = S.selection || [];
                  const parent = getNodeAtPath(S.document, parentPath);
                  const idx = parent?.children ? parent.children.length : 0;
                  update(insertNode(S, parentPath, idx, structuredClone(def)));
                }}
              >
                <div class="element-card-preview"></div>
                <div class="element-card-label">&lt;${tag}&gt;</div>
              </div>
            `;
          })}
        </sp-accordion-item>
      `;
    },
  );

  return html`
    <sp-search
      size="s"
      placeholder="Filter elements…"
      value=${elementsFilter}
      @input=${(/** @type {any} */ e) => {
        elementsFilter = e.target.value.toLowerCase();
        renderLeftPanel();
      }}
    ></sp-search>
    <sp-accordion class="elements-list" allow-multiple>${categories}</sp-accordion>
  `;
}

function registerElementsDnD() {
  requestAnimationFrame(() => {
    const container = /** @type {any} */ (leftPanel)?.querySelector(".panel-body");
    if (!container) return;
    container.querySelectorAll("[data-block-tag]").forEach(
      /** @param {any} row */ (row) => {
        const tag = row.dataset.blockTag;
        const preview = row.querySelector(".element-card-preview");
        if (preview && !preview.firstChild) {
          const el = document.createElement(unsafeTags.has(tag) ? "span" : tag);
          el.textContent = tag;
          preview.appendChild(el);
        }
        const def = defaultDef(tag);
        const cleanup = draggable({
          element: row,
          getInitialData() {
            return { type: "block", fragment: structuredClone(def) };
          },
        });
        dndCleanups.push(cleanup);
      },
    );
  });
}

// ─── Stylebook ───────────────────────────────────────────────────────────────

/** Map from rendered stylebook DOM elements to their tag names */
let stylebookElToTag = new WeakMap();

/**
 * Build a DOM element tree from a stylebook-meta.json entry. Applies any existing tag-scoped styles
 * from rootStyle["& tag"].
 *
 * @param {any} entry
 * @param {any} rootStyle
 * @param {any} activeBreakpoints
 */
function buildStylebookElement(entry, rootStyle, activeBreakpoints) {
  const el = document.createElement(entry.tag);
  if (entry.text) el.textContent = entry.text;
  if (entry.attributes) {
    for (const [k, v] of Object.entries(entry.attributes)) {
      try {
        el.setAttribute(k, /** @type {string} */ (v));
      } catch {}
    }
  }
  if (entry.style) el.style.cssText = entry.style;
  // Apply custom styles from document root
  const tagStyle = rootStyle[`& ${entry.tag}`];
  if (tagStyle) {
    for (const [prop, val] of Object.entries(tagStyle)) {
      if (typeof val === "string" || typeof val === "number") {
        try {
          /** @type {any} */ (el.style)[prop] = val;
        } catch {}
      }
    }
    // Apply media overrides for active breakpoints
    if (activeBreakpoints) {
      for (const [key, val] of Object.entries(tagStyle)) {
        if (!key.startsWith("@") || typeof val !== "object") continue;
        const mediaName = key.slice(1);
        if (mediaName === "--") continue;
        if (activeBreakpoints.has(mediaName)) {
          for (const [prop, v] of Object.entries(/** @type {any} */ (val))) {
            if (typeof v === "string" || typeof v === "number") {
              try {
                /** @type {any} */ (el.style)[prop] = v;
              } catch {}
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

/**
 * Render a live component preview by registering its custom element and instantiating it. Falls
 * back to a placeholder if registration fails.
 *
 * @param {any} comp - Entry from componentRegistry ({ tagName, path, props })
 * @returns {Promise<HTMLElement>}
 */
async function renderComponentPreview(comp) {
  const url = `${location.origin}/${comp.path}`;
  try {
    await defineElement(url);
    const el = document.createElement(comp.tagName);
    for (const p of comp.props || []) {
      if (p.default !== undefined) /** @type {any} */ (el)[p.name] = p.default;
    }
    return el;
  } catch (/** @type {any} */ e) {
    console.warn("Component preview failed:", comp.tagName, e);
    const fallback = document.createElement("div");
    fallback.style.cssText =
      "padding:12px;border:1px dashed var(--border);border-radius:4px;color:var(--fg-dim)";
    fallback.textContent = `<${comp.tagName}>`;
    return fallback;
  }
}

/**
 * @param {any} rootStyle
 * @param {any} tag
 */
function hasTagStyle(rootStyle, tag) {
  const s = rootStyle[`& ${tag}`];
  return s && typeof s === "object" && Object.keys(s).length > 0;
}

function renderStylebook() {
  stylebookElToTag = new WeakMap();
  const rootStyle = getEffectiveStyle(S.document.style);
  const filter = (S.ui.stylebookFilter || "").toLowerCase();
  const customizedOnly = S.ui.stylebookCustomizedOnly;

  const { sizeBreakpoints, baseWidth } = parseMediaEntries(getEffectiveMedia(S.document.$media));
  const hasMedia = sizeBreakpoints.length > 0;

  // Chrome bar (tabs + filter) — positioned absolutely above the panzoom surface
  const onTabClick = (/** @type {string} */ t) => {
    S = { ...S, ui: { ...S.ui, stylebookTab: t } };
    renderCanvas();
    renderOverlays();
    renderLeftPanel();
  };

  const onFilterInput = (/** @type {any} */ e) => {
    S = { ...S, ui: { ...S.ui, stylebookFilter: e.target.value } };
    renderCanvas();
    renderOverlays();
  };

  const onCustomizedToggle = () => {
    S = { ...S, ui: { ...S.ui, stylebookCustomizedOnly: !S.ui.stylebookCustomizedOnly } };
    renderCanvas();
    renderOverlays();
  };

  const chromeBarTpl = html`
    <div
      class="sb-chrome"
      style="position:absolute;top:0;left:0;right:0;z-index:15;background:var(--bg-panel);border-bottom:1px solid var(--border)"
    >
      <sp-tabs size="s">
        ${["elements", "variables"].map(
          (t) => html`
            <sp-tab
              label=${t.charAt(0).toUpperCase() + t.slice(1)}
              value=${t}
              ?selected=${S.ui.stylebookTab === t}
              @click=${() => onTabClick(t)}
            ></sp-tab>
          `,
        )}
      </sp-tabs>
      ${S.ui.stylebookTab === "elements"
        ? html`
            <input
              class="field-input"
              style="flex:1;max-width:200px;margin-left:8px"
              placeholder="Filter…"
              .value=${S.ui.stylebookFilter}
              @input=${onFilterInput}
            />
            <button
              class="tb-toggle${S.ui.stylebookCustomizedOnly ? " active" : ""}"
              style="margin-left:4px"
              @click=${onCustomizedToggle}
            >
              Customized
            </button>
          `
        : nothing}
    </div>
  `;

  // Set up panzoom surface — same as normal canvas mode
  /** @type {any} */ (canvasWrap).style.overflow = "hidden";

  // Build panel definitions
  /** @type {any[]} */
  const allPanelDefs = [];
  if (hasMedia) {
    allPanelDefs.push({
      name: "base",
      displayName: mediaDisplayName("--"),
      width: baseWidth,
      activeSet: activeBreakpointsForWidth(sizeBreakpoints, baseWidth),
    });
    for (const bp of sizeBreakpoints) {
      allPanelDefs.push({
        name: bp.name,
        displayName: mediaDisplayName(bp.name),
        width: bp.width,
        activeSet: activeBreakpointsForWidth(sizeBreakpoints, bp.width),
      });
    }
    allPanelDefs.sort((a, b) => b.width - a.width);
  }

  // Render content into panels
  const renderIntoPanel = (/** @type {any} */ panel, /** @type {any} */ activeBreakpoints) => {
    panel.canvas.classList.add("sb-canvas");
    if (S.ui.stylebookTab === "elements") {
      renderStylebookElementsIntoCanvas(
        panel.canvas,
        rootStyle,
        filter,
        customizedOnly,
        activeBreakpoints,
      );
      for (const child of panel.canvas.querySelectorAll("*")) {
        child.style.pointerEvents = "none";
      }
      registerStylebookPanelEvents(panel);
    } else {
      renderStylebookVarsIntoCanvas(panel.canvas, rootStyle);
      panel.overlayClk.style.pointerEvents = "none";
    }
  };

  /** @type {{ tpl: any; panel: any; activeSet: any }[]} */
  let panelEntries;
  if (!hasMedia) {
    // Single panel
    const effectiveMedia = getEffectiveMedia(S.document.$media);
    const hasBaseWidth = effectiveMedia && effectiveMedia["--"];
    const label = hasBaseWidth ? `${mediaDisplayName("--")} (${baseWidth}px)` : null;
    const entry = canvasPanelTemplate(
      hasBaseWidth ? "base" : null,
      label,
      !hasBaseWidth,
      hasBaseWidth ? baseWidth : undefined,
    );
    panelEntries = [{ tpl: entry.tpl, panel: entry.panel, activeSet: new Set() }];
  } else {
    // Multi-panel: one per breakpoint, sorted widest first
    panelEntries = allPanelDefs.map((def) => {
      const label = `${def.displayName} (${def.width}px)`;
      const { tpl, panel } = canvasPanelTemplate(def.name, label, false, def.width);
      return { tpl, panel, activeSet: def.activeSet };
    });
  }

  litRender(
    html`
      ${chromeBarTpl}
      <div
        class="panzoom-wrap"
        style="transform-origin:0 0;padding-top:36px"
        ${ref((el) => {
          if (el) panzoomWrap = /** @type {HTMLDivElement} */ (el);
        })}
      >
        ${panelEntries.map((e) => e.tpl)}
      </div>
    `,
    /** @type {any} */ (canvasWrap),
  );

  for (const { panel, activeSet } of panelEntries) {
    canvasPanels.push(panel);
    renderIntoPanel(panel, activeSet);
  }
  if (hasMedia) {
    updateActivePanelHeaders();
  }

  applyTransform();
  observeCenterUntilStable();
  renderZoomIndicator();
}

/**
 * @param {any} canvasEl
 * @param {any} rootStyle
 * @param {any} filter
 * @param {any} customizedOnly
 * @param {any} activeBreakpoints
 */
function renderStylebookElementsIntoCanvas(
  canvasEl,
  rootStyle,
  filter,
  customizedOnly,
  activeBreakpoints,
) {
  /** @type {import("lit-html").TemplateResult[]} */
  const sectionTemplates = [];

  for (const section of stylebookMeta.$sections) {
    // Filter elements
    let entries = /** @type {any} */ (section.elements);
    if (filter) {
      entries = entries.filter(
        (/** @type {any} */ e) =>
          e.tag.includes(filter) || section.label.toLowerCase().includes(filter),
      );
    }
    if (customizedOnly) {
      entries = entries.filter((/** @type {any} */ e) => hasTagStyle(rootStyle, e.tag));
    }
    if (entries.length === 0) continue;

    const cardTemplates = entries.map((/** @type {any} */ entry) => {
      const el = buildStylebookElement(entry, rootStyle, activeBreakpoints);
      return html`
        <div
          class="element-card"
          ${ref((card) => {
            if (!card) return;
            stylebookElToTag.set(card, entry.tag);
            elToPath.set(card, ["__sb", entry.tag]);
            for (const child of el.querySelectorAll("*")) {
              const tag = child.tagName.toLowerCase();
              if (!stylebookElToTag.has(child)) {
                stylebookElToTag.set(child, tag);
                elToPath.set(child, ["__sb", tag]);
              }
            }
          })}
        >
          <div
            class="element-card-preview"
            ${ref((c) => {
              if (c && !c.firstChild) c.appendChild(el);
            })}
          ></div>
          <div class="element-card-label">&lt;${entry.tag}&gt;</div>
        </div>
      `;
    });

    sectionTemplates.push(html`
      <div class="sb-section">
        <div class="sb-label">${section.label}</div>
        <div class="sb-body">${cardTemplates}</div>
      </div>
    `);
  }

  // Custom components from registry
  if (componentRegistry.length > 0) {
    let comps = componentRegistry;
    if (filter)
      comps = comps.filter((/** @type {any} */ c) => c.tagName.toLowerCase().includes(filter));
    if (customizedOnly)
      comps = comps.filter((/** @type {any} */ c) => hasTagStyle(rootStyle, c.tagName));
    if (comps.length > 0) {
      const compCards = comps.map((/** @type {any} */ comp) => {
        /** @type {HTMLDivElement | null} */
        let previewEl = null;
        const cardTpl = html`
          <div
            class="element-card"
            style="display:inline-flex;width:auto"
            ${ref((card) => {
              if (!card) return;
              stylebookElToTag.set(card, comp.tagName);
              elToPath.set(card, ["__sb", comp.tagName]);
            })}
          >
            <div
              class="element-card-preview"
              ${ref((c) => {
                if (c) previewEl = /** @type {HTMLDivElement} */ (c);
              })}
            ></div>
            <div class="element-card-label">&lt;${comp.tagName}&gt;</div>
          </div>
        `;
        // Fill preview asynchronously with live rendered component
        renderComponentPreview(comp).then((el) => {
          if (previewEl) previewEl.appendChild(el);
        });
        return cardTpl;
      });

      sectionTemplates.push(html`
        <div class="sb-section">
          <div class="sb-label">Components</div>
          <div class="sb-body">${compCards}</div>
        </div>
      `);
    }
  }

  if (sectionTemplates.length === 0) {
    litRender(
      html`
        <div style="padding:48px;text-align:center;color:var(--fg-dim);font-size:13px">
          ${customizedOnly ? "No customized elements" : "No matching elements"}
        </div>
      `,
      canvasEl,
    );
  } else {
    litRender(html`${sectionTemplates}`, canvasEl);
  }
}

/**
 * Render variables into the canvas (card-based layout matching Elements tab)
 *
 * @param {any} canvasEl
 * @param {any} rootStyle
 */
function renderStylebookVarsIntoCanvas(canvasEl, rootStyle) {
  const varCats = stylebookMeta.$variables;

  /** @type {Record<string, any>} */
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

  /** @type {Map<string, HTMLElement | null>} */
  const bodyRefs = new Map();

  const sectionTemplates = Object.entries(varCats).map(([catKey, catMeta]) => {
    const vars = groups[catKey];

    const onAdd = () => {
      const bodyEl = bodyRefs.get(catKey);
      if (!bodyEl) return;
      const addBtn = bodyEl.querySelector(".sb-var-add-btn");
      const row = renderVarRow(catKey, /** @type {any} */ (catMeta), null, "", true);
      bodyEl.insertBefore(row, addBtn);
      if (addBtn) /** @type {any} */ (addBtn).style.display = "none";
      const nameField = /** @type {any} */ (row.querySelector("sp-textfield"));
      if (nameField) requestAnimationFrame(() => nameField.focus());
    };

    return html`
      <div class="sb-section">
        <div class="sb-label">${/** @type {any} */ (catMeta).label}</div>
        <div
          class="sb-body"
          ${ref((el) => {
            if (el) bodyRefs.set(catKey, /** @type {HTMLElement} */ (el));
          })}
        >
          ${vars.length > 0
            ? vars.map((/** @type {[string, any]} */ [varName, varVal]) =>
                renderVarRow(catKey, /** @type {any} */ (catMeta), varName, String(varVal), false),
              )
            : html`<div class="sb-var-empty">
                No ${/** @type {any} */ (catMeta).label.toLowerCase()} variables yet.
              </div>`}
          <button class="sb-var-add-btn" @click=${onAdd}>
            <span class="sb-var-add-icon">+</span> Add ${/** @type {any} */ (catMeta).label}
          </button>
        </div>
      </div>
    `;
  });

  litRender(html`${sectionTemplates}`, canvasEl);
}

/**
 * Render a single variable row — used for both existing and add-new.
 *
 * @param {string} catKey - "color"|"font"|"size"|"other"
 * @param {any} catMeta - { label, prefix, placeholder }
 * @param {string | null} varName - Existing var name, or null for add-new
 * @param {string} varVal - Current value, or "" for add-new
 * @param {boolean} isNew - True if this is an add-new row
 */
function renderVarRow(catKey, catMeta, varName, varVal, isNew) {
  const row = document.createElement("div");
  row.className = isNew ? "sb-var-row is-new" : "sb-var-row";

  /** @type {any} */
  let colorPicker = null;
  /** @type {any} */
  let nameField = null;
  /** @type {any} */
  let getValueFn;
  /** @type {any} */
  let hexField = null;

  // ─── Color swatch setup ───
  const swatchTpl =
    catKey === "color"
      ? html`
          <div
            class="sb-var-swatch"
            style=${styleMap({ backgroundColor: varVal || "var(--accent)" })}
          >
            <input
              type="color"
              .value=${varVal && varVal.startsWith("#") ? varVal : "#007acc"}
              ${ref((el) => {
                if (el) colorPicker = el;
              })}
              @input=${() => {
                if (!colorPicker || !hexField) return;
                hexField.value = colorPicker.value;
                const swatch = /** @type {any} */ (row.querySelector(".sb-var-swatch"));
                if (swatch) swatch.style.backgroundColor = colorPicker.value;
                if (!isNew && varName) update(updateStyle(S, [], varName, colorPicker.value));
              }}
            />
          </div>
        `
      : nothing;

  // ─── Name column (add-new only) ───
  const namePlaceholder =
    catKey === "color"
      ? "Primary Blue"
      : catKey === "font"
        ? "Body Serif"
        : catKey === "size"
          ? "Spacing Large"
          : "Border Radius";

  const nameColTpl = isNew
    ? html`
        <div class="sb-var-col-name">
          <div class="sb-var-col-label">Name</div>
          <sp-textfield
            size="s"
            placeholder=${namePlaceholder}
            style="pointer-events:auto"
            ${ref((el) => {
              if (el) nameField = el;
            })}
          ></sp-textfield>
        </div>
      `
    : nothing;

  // ─── Value column ───
  /** @type {any} */
  let valueContent;

  if (catKey === "color") {
    /** @type {any} */
    let debounce;
    valueContent = html`
      <sp-textfield
        size="s"
        .value=${varVal || "#007acc"}
        placeholder="#007acc"
        style="pointer-events:auto"
        ${ref((el) => {
          if (el) hexField = el;
        })}
        @input=${() => {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            if (!hexField) return;
            const v = hexField.value;
            try {
              if (colorPicker) colorPicker.value = v.startsWith("#") ? v : colorPicker.value;
            } catch {}
            const swatch = /** @type {any} */ (row.querySelector(".sb-var-swatch"));
            if (swatch) swatch.style.backgroundColor = v;
            if (!isNew && varName) update(updateStyle(S, [], varName, v));
          }, 400);
        }}
      ></sp-textfield>
    `;
    getValueFn = () => hexField?.value?.trim() || "";
  } else if (catKey === "size") {
    const ui = createUnitInput(varVal || "16px", {
      onChange: (/** @type {any} */ newVal) => {
        const bar = /** @type {any} */ (row.querySelector(".sb-var-size-bar"));
        if (bar) bar.style.width = newVal;
        if (!isNew && varName) update(updateStyle(S, [], varName, newVal));
      },
    });
    if (isNew) ui.textfield.value = "";
    valueContent = html`<div
      ${ref((el) => {
        if (el && !el.firstChild) el.appendChild(ui.wrap);
      })}
    ></div>`;
    getValueFn = () => ui.getValue();
  } else {
    /** @type {any} */
    let textFieldEl = null;
    /** @type {any} */
    let debounce;
    valueContent = html`
      <sp-textfield
        size="s"
        .value=${varVal}
        placeholder=${catMeta.placeholder}
        style="pointer-events:auto"
        ${ref((el) => {
          if (el) textFieldEl = el;
        })}
        @input=${() => {
          if (!textFieldEl || isNew || !varName) return;
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            const v = textFieldEl.value;
            const fontPrev = /** @type {any} */ (row.querySelector(".sb-var-font-preview"));
            if (fontPrev) fontPrev.style.fontFamily = v;
            update(updateStyle(S, [], varName, v));
          }, 400);
        }}
      ></sp-textfield>
    `;
    getValueFn = () => textFieldEl?.value?.trim() || "";
  }

  const valColTpl = html`
    <div class="sb-var-col-value">
      ${isNew ? html`<div class="sb-var-col-label">Value</div>` : nothing} ${valueContent}
    </div>
  `;

  // ─── Action buttons (add-new only) ───
  const actionsTpl = isNew
    ? html`
        <div class="sb-var-add-actions">
          <sp-action-button
            size="s"
            style="pointer-events:auto"
            @click=${() => {
              const name = (nameField?.value || "").trim();
              const val = getValueFn();
              const generatedVar = friendlyNameToVar(name, catMeta.prefix);
              if (!generatedVar || !val) return;
              update(updateStyle(S, [], generatedVar, val));
            }}
            >Add</sp-action-button
          >
          <sp-action-button
            size="s"
            quiet
            style="pointer-events:auto"
            @click=${() => {
              const body = row.parentElement;
              row.remove();
              const addBtn = /** @type {any} */ (body?.querySelector(".sb-var-add-btn"));
              if (addBtn) addBtn.style.display = "";
            }}
          >
            <sp-icon-close slot="icon"></sp-icon-close>
          </sp-action-button>
        </div>
      `
    : nothing;

  // ─── Header ───
  const headerTpl =
    !isNew && varName
      ? html`
          <div class="sb-var-row-header">
            <span class="sb-var-row-title">${varDisplayName(varName, catMeta.prefix)}</span>
            <span class="sb-var-row-ref">${varName}</span>
            <sp-action-button
              size="s"
              quiet
              class="sb-var-del"
              style="pointer-events:auto"
              @click=${() => update(updateStyle(S, [], varName, undefined))}
            >
              <sp-icon-delete slot="icon"></sp-icon-delete>
            </sp-action-button>
          </div>
        `
      : nothing;

  // ─── Live preview of generated var name (add-new) ───
  const addPreviewTpl = isNew
    ? html`
        <div
          class="sb-var-add-preview"
          ${ref((el) => {
            if (!el || !nameField) return;
            nameField.addEventListener("input", () => {
              el.textContent = friendlyNameToVar(nameField.value || "", catMeta.prefix);
            });
          })}
        ></div>
      `
    : nothing;

  // ─── Type-specific preview ───
  const typePrevTpl =
    catKey === "font" && varVal
      ? html`
          <div class="sb-var-preview">
            <div class="sb-var-font-preview" style=${styleMap({ fontFamily: varVal })}>
              The quick brown fox jumps over the lazy dog
            </div>
          </div>
        `
      : catKey === "size" && varVal
        ? html`
            <div class="sb-var-preview">
              <div class="sb-var-size-track">
                <div class="sb-var-size-bar" style=${styleMap({ width: varVal })}></div>
              </div>
            </div>
          `
        : nothing;

  litRender(
    html`
      ${headerTpl}
      <div class="sb-var-input-row">${swatchTpl} ${nameColTpl} ${valColTpl} ${actionsTpl}</div>
      ${addPreviewTpl} ${typePrevTpl}
    `,
    row,
  );

  return row;
}

// varDisplayName, friendlyNameToVar — imported from studio-utils.js

/**
 * Convert a $media key like "--tablet" to a friendly display name "Tablet". "--" returns "Base".
 *
 * @param {any} name
 */
function mediaDisplayName(name) {
  if (name === "--") return "Base";
  return (
    name
      .replace(/^--/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (/** @type {any} */ c) => c.toUpperCase()) || name
  );
}

/**
 * Convert a human-friendly name like "Tablet" to a $media key "--tablet"
 *
 * @param {any} name
 */
function friendlyNameToMedia(name) {
  return friendlyNameToVar(name, "--");
}

/**
 * Creates a combined textfield + quiet sp-picker for CSS values with units. Returns { wrap,
 * textfield, picker, getValue, setValue }. The picker hides automatically when the textfield value
 * is non-numeric (e.g. "auto", "inherit").
 *
 * @param {any} initialValue
 * @param {any} [options]
 */
function createUnitInput(initialValue, { onChange, size = "s" } = {}) {
  const match = String(initialValue).match(
    /^(-?[\d.]+)\s*(px|em|rem|vw|vh|%|ch|ex|vmin|vmax|pt|cm|mm|in)?$/,
  );
  let numVal = match ? match[1] : initialValue;
  let unitVal = match ? match[2] || "px" : "";
  const isNumeric = !!match;

  const wrap = document.createElement("div");
  wrap.className = "sb-unit-input";
  wrap.style.pointerEvents = "auto";

  /** @type {any} */
  let textfield = null;
  /** @type {any} */
  let picker = null;

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

  /** @type {any} */
  let debounce;

  function getValue() {
    const num = textfield?.value;
    const unit = picker?.value;
    if (unit === "auto" || unit === "fit-content") return unit;
    return num ? `${num}${unit}` : "";
  }

  litRender(
    html`
      <sp-textfield
        .value=${numVal}
        size=${size}
        ${ref((el) => {
          if (el) textfield = el;
        })}
        @input=${() => {
          clearTimeout(debounce);
          const raw = textfield?.value?.trim();
          const looksNumeric = /^-?[\d.]+$/.test(raw || "");
          if (picker) picker.style.display = looksNumeric ? "" : "none";
          debounce = setTimeout(() => {
            if (onChange) onChange(looksNumeric ? `${raw}${picker?.value}` : raw);
          }, 400);
        }}
      ></sp-textfield>
      <sp-picker
        quiet
        size=${size}
        style=${styleMap({ display: isNumeric ? "" : "none" })}
        ${ref((el) => {
          if (el) {
            picker = el;
            requestAnimationFrame(() => {
              /** @type {any} */ (el).value = unitVal || "px";
            });
          }
        })}
        @change=${() => {
          const unit = picker?.value;
          if (unit === "auto" || unit === "fit-content") {
            if (textfield) textfield.value = unit;
            if (picker) picker.style.display = "none";
            if (onChange) onChange(unit);
          } else {
            unitVal = unit;
            if (onChange) onChange(getValue());
          }
        }}
      >
        ${units.map((u) =>
          u.divider
            ? html`<sp-menu-divider></sp-menu-divider>`
            : html`<sp-menu-item value=${u.value}>${u.label}</sp-menu-item>`,
        )}
      </sp-picker>
    `,
    wrap,
  );

  return { wrap, textfield, picker, getValue };
}

/**
 * Click handler for stylebook canvas — selects elements via the elToPath/stylebookElToTag mapping
 *
 * @param {any} panel
 */
function registerStylebookPanelEvents(panel) {
  const { canvas, overlayClk } = panel;

  overlayClk.addEventListener("click", (/** @type {any} */ e) => {
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
      let cur = /** @type {any} */ (el);
      while (cur && cur !== canvas) {
        const tag = stylebookElToTag.get(cur);
        if (tag) {
          const newMedia = panel.mediaName === "base" ? null : (panel.mediaName ?? null);
          selectStylebookTag(tag, newMedia);
          updateActivePanelHeaders();
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

  overlayClk.addEventListener("mousemove", (/** @type {any} */ e) => {
    const els = canvas.querySelectorAll("*");
    for (const el of els) el.style.pointerEvents = "auto";
    overlayClk.style.display = "none";
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    overlayClk.style.display = "";
    for (const el of els) el.style.pointerEvents = "none";

    let hoverTag = null;
    for (const el of elements) {
      if (!canvas.contains(el) || el === canvas) continue;
      let cur = /** @type {any} */ (el);
      while (cur && cur !== canvas) {
        const tag = stylebookElToTag.get(cur);
        if (tag) {
          hoverTag = tag;
          break;
        }
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
    const hoverTag = panel._lastHoverTag;
    /**
     * @type {{
     *   cls: string;
     *   top: string;
     *   left: string;
     *   width: string;
     *   height: string;
     *   label?: string;
     * }[]}
     */
    const boxes = [];

    if (hoverTag && hoverTag !== selectedTag) {
      const el = findStylebookEl(panel.canvas, hoverTag);
      if (el) boxes.push({ ...overlayBoxDescriptor(el, "hover", panel), label: undefined });
    }

    if (selectedTag) {
      const el = findStylebookEl(panel.canvas, selectedTag);
      if (el)
        boxes.push({ ...overlayBoxDescriptor(el, "selection", panel), label: `<${selectedTag}>` });
    }

    litRender(
      html`
        ${panel.dropLine}
        ${boxes.map(
          (b) => html`
            <div
              class=${b.cls}
              style="top:${b.top};left:${b.left};width:${b.width};height:${b.height}"
            >
              ${b.label ? html`<div class="overlay-label">${b.label}</div>` : nothing}
            </div>
          `,
        )}
      `,
      panel.overlay,
    );
  }
}

/** Find a stylebook element by tag in the canvas */
function findStylebookEl(/** @type {any} */ canvasEl, /** @type {any} */ tag) {
  for (const child of canvasEl.querySelectorAll("*")) {
    if (stylebookElToTag.get(child) === tag) return child;
  }
  return null;
}

// ─── Right panel: Inspector ───────────────────────────────────────────────────

function renderRightPanel() {
  const tab = S.ui.rightTab;

  // ── Icon tabs ──────────────────────────────────────────────────────────
  const panelTabs = [
    { value: "properties", icon: "sp-icon-properties", label: "Properties" },
    { value: "events", icon: "sp-icon-event", label: "Events" },
    { value: "style", icon: "sp-icon-brush", label: "Style" },
  ];

  const tabsT = html`
    <div class="panel-tabs">
      <sp-tabs
        selected=${tab}
        quiet
        @change=${(/** @type {any} */ e) => {
          const sel = e.target.selected;
          if (sel && sel !== tab) {
            S = { ...S, ui: { ...S.ui, rightTab: sel } };
            renderRightPanel();
            renderOverlays();
          }
        }}
      >
        ${panelTabs.map(
          (t) => html`
            <sp-tab value=${t.value} title=${t.label} aria-label=${t.label}>
              ${tabIcon(t.icon, "xs")}
            </sp-tab>
          `,
        )}
      </sp-tabs>
    </div>
  `;

  // ── Panel body ────────────────────────────────────────────────────────
  /** @type {any} */
  let bodyT = nothing;
  if (tab === "properties") {
    bodyT = propertiesSidebarTemplate();
  } else if (tab === "events") {
    bodyT = _eventsSidebarTemplate(S, {
      isCustomElementDoc: () => isCustomElementDoc(S),
      renderCanvas,
    });
  } else if (tab === "style") {
    try {
      bodyT = renderStylePanelTemplate();
    } catch (/** @type {any} */ e) {
      console.error("[renderStylePanelTemplate]", e);
    }
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
  const isMapParent =
    node.children && typeof node.children === "object" && node.children.$prototype === "Array";
  const isSwitchNode = !!node.$switch;
  const isCustomInstance = (node.tagName || "").includes("-");
  const isRoot = path.length === 0;
  const tagName = node.tagName || "div";
  const attrs = node.attributes || {};

  const mapSignals = isInsideMapTemplate(path)
    ? [
        { value: "$map/item", label: "$map/item" },
        { value: "$map/index", label: "$map/index" },
      ]
    : null;

  // Helper: render an attribute row using the style-row pattern
  function renderAttrRow(
    /** @type {any} */ attr,
    /** @type {any} */ entry,
    /** @type {any} */ value,
  ) {
    const type = inferInputType(entry);
    const hasVal = value !== undefined && value !== "";

    // Boolean attributes render as checkboxes
    if (entry.type === "boolean") {
      return html`
        <div class="style-row" data-prop=${attr}>
          <div class="style-row-label">
            ${hasVal
              ? html`<span
                  class="set-dot"
                  title="Clear ${attr}"
                  @click=${(/** @type {any} */ e) => {
                    e.stopPropagation();
                    update(updateAttribute(S, path, attr, undefined));
                  }}
                ></span>`
              : nothing}
            <sp-field-label size="s" title=${attr}>${attrLabel(entry, attr)}</sp-field-label>
          </div>
          <sp-checkbox
            size="s"
            .checked=${live(!!value)}
            @change=${(/** @type {any} */ e) =>
              update(updateAttribute(S, path, attr, e.target.checked || undefined))}
          >
          </sp-checkbox>
        </div>
      `;
    }

    return html`
      <div class="style-row" data-prop=${attr}>
        <div class="style-row-label">
          ${hasVal
            ? html`<span
                class="set-dot"
                title="Clear ${attr}"
                @click=${(/** @type {any} */ e) => {
                  e.stopPropagation();
                  update(updateAttribute(S, path, attr, undefined));
                }}
              ></span>`
            : nothing}
          <sp-field-label size="s" title=${attr}>${attrLabel(entry, attr)}</sp-field-label>
        </div>
        ${widgetForType(type, entry, attr, value || "", (/** @type {any} */ v) =>
          update(updateAttribute(S, path, attr, v || undefined)),
        )}
      </div>
    `;
  }

  // ── Collect applicable attributes from html-meta ──
  const applicableAttrs = /** @type {Record<string, any>} */ ({});
  for (const [attr, entry] of /** @type {[string, any][]} */ (Object.entries(htmlMeta.$defs))) {
    if (!entry.$elements || entry.$elements.includes(tagName)) {
      applicableAttrs[attr] = entry;
    }
  }

  // Partition into sections
  const attrSections = /** @type {Record<string, any[]>} */ ({});
  for (const sec of htmlMeta.$sections) attrSections[sec.key] = [];
  for (const [attr, entry] of Object.entries(applicableAttrs)) {
    const secKey = entry.$section;
    if (attrSections[secKey]) attrSections[secKey].push({ name: attr, entry });
  }
  for (const sec of htmlMeta.$sections) {
    attrSections[sec.key].sort(
      (/** @type {any} */ a, /** @type {any} */ b) => a.entry.$order - b.entry.$order,
    );
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

  function isSectionOpen(/** @type {any} */ key) {
    if (S.ui.inspectorSections[key] !== undefined) return S.ui.inspectorSections[key];
    return autoOpen.has(key);
  }

  function toggleSection(/** @type {any} */ key) {
    const current = isSectionOpen(key);
    S = {
      ...S,
      ui: { ...S.ui, inspectorSections: { ...S.ui.inspectorSections, [key]: !current } },
    };
    renderRightPanel();
  }

  // ── Build section templates ─────────────────────────────────────────

  // "Element" section — tagName, textContent, hidden
  const elemT = html`
    <sp-accordion-item
      label="Element"
      ?open=${isSectionOpen("__element") !== false}
      @sp-accordion-item-toggle=${() => toggleSection("__element")}
    >
      <div class="style-section-body">
        <div class="style-row" data-prop="tagName">
          <div class="style-row-label">
            <sp-field-label size="s">Tag</sp-field-label>
          </div>
          <sp-textfield
            size="s"
            .value=${live(tagName)}
            autocomplete="off"
            list="tag-names"
            @input=${debouncedStyleCommit("prop:tagName", 400, (/** @type {any} */ e) => {
              update(updateProperty(S, path, "tagName", e.target.value || undefined));
            })}
          ></sp-textfield>
        </div>
        <div class="style-row" data-prop="$id">
          <div class="style-row-label">
            ${node.$id
              ? html`<span
                  class="set-dot"
                  title="Clear $id"
                  @click=${(/** @type {any} */ e) => {
                    e.stopPropagation();
                    update(updateProperty(S, path, "$id", undefined));
                  }}
                ></span>`
              : nothing}
            <sp-field-label size="s">ID</sp-field-label>
          </div>
          <sp-textfield
            size="s"
            .value=${live(node.$id || "")}
            @input=${debouncedStyleCommit("prop:$id", 400, (/** @type {any} */ e) => {
              update(updateProperty(S, path, "$id", e.target.value || undefined));
            })}
          ></sp-textfield>
        </div>
        <div class="style-row" data-prop="className">
          <div class="style-row-label">
            ${node.className
              ? html`<span
                  class="set-dot"
                  title="Clear class"
                  @click=${(/** @type {any} */ e) => {
                    e.stopPropagation();
                    update(updateProperty(S, path, "className", undefined));
                  }}
                ></span>`
              : nothing}
            <sp-field-label size="s">Class</sp-field-label>
          </div>
          <sp-textfield
            size="s"
            .value=${live(node.className || "")}
            @input=${debouncedStyleCommit("prop:className", 400, (/** @type {any} */ e) => {
              update(updateProperty(S, path, "className", e.target.value || undefined));
            })}
          ></sp-textfield>
        </div>
        ${!Array.isArray(node.children) || node.children.length === 0
          ? html`
              <div class="style-row" data-prop="textContent">
                <div class="style-row-label">
                  ${node.textContent !== undefined
                    ? html`<span
                        class="set-dot"
                        title="Clear text"
                        @click=${(/** @type {any} */ e) => {
                          e.stopPropagation();
                          update(updateProperty(S, path, "textContent", undefined));
                        }}
                      ></span>`
                    : nothing}
                  <sp-field-label size="s">Text Content</sp-field-label>
                </div>
                <sp-textfield
                  size="s"
                  multiline
                  .value=${live(
                    typeof node.textContent === "string"
                      ? node.textContent
                      : (node.textContent ?? ""),
                  )}
                  @input=${debouncedStyleCommit("prop:textContent", 400, (/** @type {any} */ e) => {
                    update(updateProperty(S, path, "textContent", e.target.value || undefined));
                  })}
                ></sp-textfield>
              </div>
            `
          : nothing}
        <div class="style-row" data-prop="hidden">
          <div class="style-row-label">
            ${node.hidden
              ? html`<span
                  class="set-dot"
                  title="Clear hidden"
                  @click=${(/** @type {any} */ e) => {
                    e.stopPropagation();
                    update(updateProperty(S, path, "hidden", undefined));
                  }}
                ></span>`
              : nothing}
            <sp-field-label size="s">Hidden</sp-field-label>
          </div>
          <sp-checkbox
            size="s"
            .checked=${live(!!node.hidden)}
            @change=${(/** @type {any} */ e) =>
              update(updateProperty(S, path, "hidden", e.target.checked || undefined))}
          >
          </sp-checkbox>
        </div>
        ${isMapParent
          ? html`
              <div style="font-size:10px;color:var(--fg-dim);padding:4px 0;font-style:italic">
                Children: Repeater (select in layers to configure)
              </div>
            `
          : nothing}
      </div>
    </sp-accordion-item>
  `;

  // "Repeater" section (if $map node)
  const repeaterT = isMapNode
    ? html`
        <sp-accordion-item label="Repeater" open>
          <div class="style-section-body">
            ${renderRepeaterFieldsTemplate(node, path, mapSignals)}
          </div>
        </sp-accordion-item>
      `
    : nothing;

  // "$switch" section
  const switchT = isSwitchNode
    ? html`
        <sp-accordion-item label="Switch" open>
          <div class="style-section-body">
            ${renderSwitchFieldsTemplate(node, path, mapSignals)}
          </div>
        </sp-accordion-item>
      `
    : nothing;

  // "Observed Attributes" section (custom element doc root)
  const observedAttrsT =
    isCustomElementDoc(S) && isRoot
      ? (() => {
          const state = S.document.state || {};
          const entries = Object.entries(state).filter(([, d]) => d.attribute);
          return html`
            <sp-accordion-item label="Observed Attributes" ?open=${isSectionOpen("__observed")}>
              <div class="style-section-body">
                ${entries.length === 0
                  ? html`<div class="empty-state">
                      No attributes declared. Set "attribute" on a state entry.
                    </div>`
                  : entries.map(
                      ([key, d]) => html`
                        <div
                          style="display:flex;gap:6px;align-items:center;padding:2px 0;font-size:11px"
                        >
                          <code style="font-family:monospace;color:var(--accent)"
                            >${d.attribute}</code
                          >
                          <span style="color:var(--fg-dim)"> → </span>
                          <span>${key}</span>
                          ${d.type
                            ? html`<span style="margin-left:auto;color:var(--fg-dim);font-size:10px"
                                >${d.type}</span
                              >`
                            : nothing}
                          ${d.reflects
                            ? html`<span
                                style="font-size:9px;background:var(--bg-hover);padding:1px 4px;border-radius:3px"
                                >reflects</span
                              >`
                            : nothing}
                        </div>
                      `,
                    )}
              </div>
            </sp-accordion-item>
          `;
        })()
      : nothing;

  // "Component Props" section
  const compPropsT = isCustomInstance
    ? html`
        <sp-accordion-item label="Component Props" open>
          <div class="style-section-body">
            ${renderComponentPropsFieldsTemplate(node, path, mapSignals)}
          </div>
        </sp-accordion-item>
      `
    : nothing;

  // HTML-meta attribute sections
  const attrSectionTemplates = htmlMeta.$sections
    .filter((sec) => attrSections[sec.key].length > 0)
    .map((sec) => {
      const sectionAttrs = attrSections[sec.key];
      const hasAnySet = sectionAttrs.some((/** @type {any} */ a) => attrs[a.name] !== undefined);
      return html`
        <sp-accordion-item
          label=${sec.label}
          ?open=${isSectionOpen(sec.key)}
          @sp-accordion-item-toggle=${() => toggleSection(sec.key)}
        >
          ${hasAnySet
            ? html`<span slot="heading" class="set-dot set-dot--section"></span>`
            : nothing}
          <div class="style-section-body">
            ${sectionAttrs.map((/** @type {any} */ a) =>
              renderAttrRow(a.name, a.entry, attrs[a.name]),
            )}
          </div>
        </sp-accordion-item>
      `;
    });

  // "Custom" attributes section (not in html-meta)
  const customSectionT =
    customAttrs.length > 0 || Object.keys(attrs).length > 0
      ? html`
          <sp-accordion-item
            label="Custom"
            ?open=${isSectionOpen("__custom")}
            @sp-accordion-item-toggle=${() => toggleSection("__custom")}
          >
            ${customAttrs.length > 0
              ? html`<span slot="heading" class="set-dot set-dot--section"></span>`
              : nothing}
            <div class="style-section-body">
              ${renderCustomAttrsFieldsTemplate(node, path, attrs, knownAttrNames)}
            </div>
          </sp-accordion-item>
        `
      : nothing;

  // Media section (root only)
  const mediaT = isRoot
    ? html`
        <sp-accordion-item
          label="Media"
          ?open=${isSectionOpen("__media")}
          @sp-accordion-item-toggle=${() => toggleSection("__media")}
        >
          <div class="style-section-body">${renderMediaFieldsTemplate(node)}</div>
        </sp-accordion-item>
      `
    : nothing;

  // CSS Properties + CSS Parts (custom element doc root)
  const cssPropsT =
    isCustomElementDoc(S) && isRoot
      ? (() => {
          const style = node.style || {};
          const cssProps = Object.entries(style).filter(([k]) => k.startsWith("--"));
          if (cssProps.length === 0) return nothing;
          return html`
            <sp-accordion-item
              label="CSS Properties"
              ?open=${isSectionOpen("__cssprops")}
              @sp-accordion-item-toggle=${() => toggleSection("__cssprops")}
            >
              <div class="style-section-body">
                ${cssProps.map(
                  ([prop, val]) => html`
                    <div
                      style="display:flex;gap:6px;align-items:center;padding:2px 0;font-size:11px"
                    >
                      <code style="font-family:monospace;color:var(--accent)">${prop}</code>
                      <span style="margin-left:auto;color:var(--fg-dim)">${String(val)}</span>
                    </div>
                  `,
                )}
              </div>
            </sp-accordion-item>
          `;
        })()
      : nothing;

  const cssPartsT =
    isCustomElementDoc(S) && isRoot
      ? (() => {
          const parts = collectCssParts(S.document);
          if (parts.length === 0) return nothing;
          return html`
            <sp-accordion-item
              label="CSS Parts"
              ?open=${isSectionOpen("__cssparts")}
              @sp-accordion-item-toggle=${() => toggleSection("__cssparts")}
            >
              <div class="style-section-body">
                ${parts.map(
                  (p) => html`
                    <div
                      style="display:flex;gap:6px;align-items:center;padding:2px 0;font-size:11px"
                    >
                      <code style="font-family:monospace;color:var(--accent)">${p.name}</code>
                      <span style="color:var(--fg-dim)">&lt;${p.tag}&gt;</span>
                    </div>
                  `,
                )}
              </div>
            </sp-accordion-item>
          `;
        })()
      : nothing;

  // ── Assemble ──
  const tpl = html`
    <div class="style-sidebar">
      <sp-accordion allow-multiple size="s">
        ${isMapNode ? repeaterT : elemT} ${isMapNode ? nothing : observedAttrsT}
        ${isMapNode ? nothing : switchT} ${isMapNode ? nothing : compPropsT}
        ${isMapNode ? nothing : attrSectionTemplates} ${isMapNode ? nothing : customSectionT}
        ${isMapNode ? nothing : mediaT} ${isMapNode ? nothing : cssPropsT}
        ${isMapNode ? nothing : cssPartsT}
      </sp-accordion>
    </div>
  `;

  return tpl;
}

/** Repeater fields template */
function renderRepeaterFieldsTemplate(
  /** @type {any} */ node,
  /** @type {any} */ path,
  /** @type {any} */ _mapSignals,
) {
  return html`
    ${bindableFieldRow("Items", "text", node.items, (/** @type {any} */ v) =>
      update(updateProperty(S, path, "items", v)),
    )}
    ${node.filter
      ? bindableFieldRow("Filter", "text", node.filter, (/** @type {any} */ v) =>
          update(updateProperty(S, path, "filter", v || undefined)),
        )
      : nothing}
    ${node.sort
      ? bindableFieldRow("Sort", "text", node.sort, (/** @type {any} */ v) =>
          update(updateProperty(S, path, "sort", v || undefined)),
        )
      : nothing}
    <div style="display:flex;gap:8px;margin-top:4px">
      ${!node.filter
        ? html`<span
            class="kv-add"
            @click=${() => update(updateProperty(S, path, "filter", { $ref: "#/state/" }))}
            >+ Add filter</span
          >`
        : nothing}
      ${!node.sort
        ? html`<span
            class="kv-add"
            @click=${() => update(updateProperty(S, path, "sort", { $ref: "#/state/" }))}
            >+ Add sort</span
          >`
        : nothing}
    </div>
    ${node.map
      ? html`
          <sp-action-button
            size="s"
            style="margin-top:8px;width:100%"
            @click=${() => update(selectNode(S, [...path, "map"]))}
            >Edit template →</sp-action-button
          >
        `
      : nothing}
  `;
}

/** Switch fields template */
function renderSwitchFieldsTemplate(
  /** @type {any} */ node,
  /** @type {any} */ path,
  /** @type {any} */ mapSignals,
) {
  const caseNames = Object.keys(node.cases || {});
  return html`
    ${bindableFieldRow(
      "Expression",
      "text",
      node.$switch,
      (/** @type {any} */ v) => update(updateProperty(S, path, "$switch", v)),
      null,
      mapSignals,
    )}
    <div
      style="font-size:11px;font-weight:600;color:var(--fg-dim);margin:8px 0 4px;text-transform:uppercase;letter-spacing:0.05em"
    >
      Cases
    </div>
    ${caseNames.map((caseName) => {
      /** @type {any} */
      let debounce;
      return html`
        <div class="field-row" style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
          <input
            class="field-input"
            value=${caseName}
            style="flex:1"
            @input=${(/** @type {any} */ e) => {
              clearTimeout(debounce);
              debounce = setTimeout(() => {
                if (e.target.value && e.target.value !== caseName)
                  update(renameSwitchCase(S, path, caseName, e.target.value));
              }, 500);
            }}
          />
          <span
            class="bind-toggle"
            title="Edit case"
            style="cursor:pointer"
            @click=${(/** @type {any} */ e) => {
              e.stopPropagation();
              update(selectNode(S, [...path, "cases", caseName]));
            }}
            >→</span
          >
          <span
            style="cursor:pointer;color:var(--danger);font-size:11px"
            @click=${(/** @type {any} */ e) => {
              e.stopPropagation();
              update(removeSwitchCase(S, path, caseName));
            }}
            >✕</span
          >
        </div>
      `;
    })}
    <span
      class="kv-add"
      @click=${() => {
        update(addSwitchCase(S, path, `case${caseNames.length + 1}`));
      }}
      >+ Add case</span
    >
  `;
}

/** Component props fields template */
function renderComponentPropsFieldsTemplate(
  /** @type {any} */ node,
  /** @type {any} */ path,
  /** @type {any} */ mapSignals,
) {
  const comp = componentRegistry.find((c) => c.tagName === node.tagName);
  if (!comp) return html`<div class="empty-state">Component not found</div>`;
  const currentProps = node.$props || {};
  return html`
    ${comp.props.map((/** @type {any} */ prop) =>
      bindableFieldRow(
        camelToLabel(prop.name),
        "text",
        currentProps[prop.name],
        (/** @type {any} */ v) => update(updateProp(S, path, prop.name, v)),
        null,
        mapSignals,
      ),
    )}
    ${comp.props.length === 0 ? html`<div class="empty-state">No props defined</div>` : nothing}
    <span class="kv-add" @click=${() => navigateToComponent(comp.path)}>→ Edit definition</span>
  `;
}

/** Custom attrs fields template */
function renderCustomAttrsFieldsTemplate(
  /** @type {any} */ node,
  /** @type {any} */ path,
  /** @type {any} */ attrs,
  /** @type {any} */ knownAttrNames,
) {
  const customAttrs = Object.entries(attrs).filter(([k]) => !knownAttrNames.has(k));
  return html`
    ${customAttrs.map(([attr, val]) =>
      kvRow(
        attr,
        String(val),
        (/** @type {any} */ newAttr, /** @type {any} */ newVal) => {
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
    )}
    <span class="kv-add" @click=${() => update(updateAttribute(S, path, "data-", ""))}
      >+ Add attribute</span
    >
  `;
}

/** Media breakpoint fields template */
let showAddBreakpointForm = false;
let addBreakpointPreview = "";

function renderMediaFieldsTemplate(/** @type {any} */ node) {
  const media = node.$media || {};
  /** @type {any} */
  let baseDebounce;
  const breakpoints = Object.entries(media).filter(([k]) => k !== "--");

  return html`
    <div class="kv-row" style="align-items:center">
      <span class="field-label" style="width:auto;margin-right:4px">Base width</span>
      <input
        class="field-input"
        style="width:70px;flex:none"
        placeholder="320px"
        value=${media["--"] || ""}
        @input=${(/** @type {any} */ e) => {
          clearTimeout(baseDebounce);
          baseDebounce = setTimeout(() => {
            const val = e.target.value.trim();
            update(updateMedia(S, "--", val || undefined));
          }, 400);
        }}
      />
      ${media["--"]
        ? html`<span class="kv-del" @click=${() => update(updateMedia(S, "--", undefined))}
            >✕</span
          >`
        : nothing}
    </div>

    ${breakpoints.map(([name, query]) => mediaBreakpointRowTemplate(name, query))}

    <div>
      <span
        class="kv-add"
        style=${showAddBreakpointForm ? "display:none" : ""}
        @click=${(/** @type {any} */ _e) => {
          showAddBreakpointForm = true;
          renderRightPanel();
        }}
        >+ Add breakpoint</span
      >
      ${showAddBreakpointForm
        ? html`
            <div style="margin-top:4px">
              <div style="display:flex;gap:4px;margin-bottom:3px;align-items:center">
                <input
                  class="field-input"
                  placeholder="Name (e.g. Tablet)"
                  style="flex:1"
                  @input=${(/** @type {any} */ e) => {
                    addBreakpointPreview = friendlyNameToMedia(e.target.value) || "";
                    renderRightPanel();
                  }}
                />
                <span
                  style="font-size:10px;color:var(--fg-dim);font-family:'SF Mono','Fira Code',monospace;white-space:nowrap"
                  >${addBreakpointPreview}</span
                >
              </div>
              <div style="display:flex;gap:4px;margin-bottom:3px;align-items:center">
                <input class="field-input add-bp-query" value="(min-width: 768px)" style="flex:1" />
              </div>
              <div style="display:flex;gap:4px">
                <button
                  class="kv-add"
                  style="padding:2px 10px;cursor:pointer"
                  @click=${(/** @type {any} */ e) => {
                    const wrap = e.target.closest("div").parentElement;
                    const nameVal = wrap.querySelector("input")?.value;
                    const queryVal = wrap.querySelector(".add-bp-query")?.value?.trim();
                    const key = friendlyNameToMedia(nameVal);
                    if (key && queryVal) {
                      showAddBreakpointForm = false;
                      addBreakpointPreview = "";
                      update(updateMedia(S, key, queryVal));
                    }
                  }}
                >
                  Add
                </button>
                <button
                  class="kv-add"
                  style="padding:2px 10px;cursor:pointer;color:var(--fg-dim)"
                  @click=${() => {
                    showAddBreakpointForm = false;
                    addBreakpointPreview = "";
                    renderRightPanel();
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          `
        : nothing}
    </div>
  `;
}

/** Single media breakpoint row template */
function mediaBreakpointRowTemplate(/** @type {any} */ name, /** @type {any} */ query) {
  /** @type {any} */
  let debounceTimer;
  let currentRawLabel = name;
  return html`
    <div style="margin-bottom:6px;padding:4px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
        <input
          class="field-input"
          value=${mediaDisplayName(name)}
          style="flex:1;font-weight:600;font-size:12px"
          @input=${(/** @type {any} */ e) => {
            const newKey = friendlyNameToMedia(e.target.value);
            currentRawLabel = newKey || "";
            const rawEl = e.target.parentElement?.querySelector(".bp-raw-label");
            if (rawEl) rawEl.textContent = currentRawLabel;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              if (newKey && newKey !== name) {
                const queryEl = e.target
                  .closest("div[style]")
                  ?.parentElement?.querySelector(".bp-query-input");
                let s = updateMedia(S, name, undefined);
                s = updateMedia(s, newKey, queryEl?.value || query);
                update(s);
              }
            }, 600);
          }}
        />
        <span
          class="bp-raw-label"
          style="font-size:10px;color:var(--fg-dim);font-family:'SF Mono','Fira Code',monospace;white-space:nowrap"
          >${name}</span
        >
        <span class="kv-del" @click=${() => update(updateMedia(S, name, undefined))}>✕</span>
      </div>
      <div style="display:flex;gap:4px;align-items:center">
        <input
          class="field-input bp-query-input"
          value=${query}
          style="flex:1"
          @input=${(/** @type {any} */ e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => update(updateMedia(S, name, e.target.value)), 400);
          }}
        />
      </div>
    </div>
  `;
}

// ─── Style Sidebar (metadata-driven) ───────────────────────────────────────────

const UNIT_RE = /^(-?[\d.]+)(px|rem|em|%|vw|vh|svw|svh|dvh|ms|s|fr|ch|ex|deg)?$/;

// inferInputType — imported from studio-utils.js

function conditionPasses(/** @type {any} */ cond, /** @type {any} */ styles) {
  const val = styles[cond.prop] ?? "";
  if (cond.values.length === 0) return val !== "" && val !== "initial";
  return cond.values.includes(val);
}

function allConditionsPass(/** @type {any} */ entry, /** @type {any} */ styles) {
  return (entry.$show ?? []).every((/** @type {any} */ c) => conditionPasses(c, styles));
}

function autoOpenSections(/** @type {any} */ node, /** @type {any} */ currentSections) {
  const style = node.style || {};
  const result = { ...currentSections };
  for (const prop of Object.keys(style)) {
    if (typeof style[prop] === "object") continue;
    const entry = /** @type {Record<string, any>} */ (cssMeta.$defs)[prop];
    const section = entry?.$section ?? "other";
    if (!result[section]) result[section] = true;
  }
  return result;
}

/** Get longhands for a shorthand property from css-meta */
function getLonghands(/** @type {any} */ shorthandProp) {
  const result = [];
  for (const [name, entry] of /** @type {[string, any][]} */ (Object.entries(cssMeta.$defs))) {
    if (entry.$shorthand === shorthandProp) result.push({ name, entry });
  }
  result.sort((a, b) => a.entry.$order - b.entry.$order);
  return result;
}

// ── Color popover singleton ─────────────────────────────────────────────────
/** @type {any} */
/** @type {any} */
let _colorCallback = null;
/** @type {any} */
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
function resolveColorForDisplay(/** @type {any} */ val) {
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

const _colorPopoverHost = createFloatingContainer();

function closeColorPopover() {
  litRender(nothing, _colorPopoverHost);
  _colorCallback = null;
  if (_colorDismissHandler) {
    document.removeEventListener("pointerdown", _colorDismissHandler, true);
    document.removeEventListener("keydown", _colorDismissHandler, true);
    _colorDismissHandler = null;
  }
}

function openColorPopover(
  /** @type {any} */ anchorEl,
  /** @type {any} */ currentColor,
  /** @type {any} */ onChange,
) {
  const colorVars = getColorVars();
  const rawResolved = resolveColorForDisplay(currentColor) || "#000000";
  // Ensure # prefix so Spectrum components return #-prefixed hex
  const resolvedColor =
    rawResolved.startsWith("#") || rawResolved.startsWith("rgb") || rawResolved.startsWith("hsl")
      ? rawResolved
      : `#${rawResolved}`;

  const popoverQuery = (/** @type {string} */ sel) => _colorPopoverHost.querySelector(sel);

  /** Ensure hex color always has a # prefix */
  const normalizeHex = (/** @type {string} */ c) => {
    if (!c) return c;
    if (c.startsWith("var(") || c.startsWith("rgb") || c.startsWith("hsl")) return c;
    const hex = c.replace(/^#?/, "#");
    return hex;
  };

  // Render popover content with lit-html
  const syncFromArea = (/** @type {any} */ _e) => {
    /** @type {any} */
    const area = popoverQuery("sp-color-area");
    /** @type {any} */
    const slider = popoverQuery("sp-color-slider");
    /** @type {any} */
    const tf = popoverQuery(".color-popover-hex");
    const color = normalizeHex(String(area.color));
    if (slider) slider.color = color;
    if (tf) tf.value = color;
    _colorCallback?.(color);
  };

  const syncFromSlider = (/** @type {any} */ _e) => {
    /** @type {any} */
    const area = popoverQuery("sp-color-area");
    /** @type {any} */
    const slider = popoverQuery("sp-color-slider");
    /** @type {any} */
    const tf = popoverQuery(".color-popover-hex");
    const color = normalizeHex(String(slider.color));
    if (area) area.color = color;
    if (tf) tf.value = color;
    _colorCallback?.(color);
  };

  const syncFromText = (/** @type {any} */ e) => {
    const val = e.target.value.trim();
    if (!val) return;
    /** @type {any} */
    const area = popoverQuery("sp-color-area");
    /** @type {any} */
    const slider = popoverQuery("sp-color-slider");
    try {
      if (area) area.color = val;
      if (slider) slider.color = val;
    } catch {}
    _colorCallback?.(val);
  };

  const r = anchorEl.getBoundingClientRect();

  litRender(
    html`
      <sp-popover
        open
        tabindex="-1"
        style="padding:12px;position:fixed;z-index:9999;left:${r.left}px;top:${r.bottom +
        4}px;overflow:visible"
      >
        <div class="color-popover-inner">
          <sp-color-area
            style="width:200px; height:150px; --mod-colorarea-width:200px; --mod-colorarea-height:150px"
            color=${resolvedColor}
            @input=${syncFromArea}
          ></sp-color-area>
          <sp-color-slider
            style="width:200px; --mod-colorslider-length:200px"
            color=${resolvedColor}
            @input=${syncFromSlider}
          ></sp-color-slider>
          <sp-textfield
            size="s"
            class="color-popover-hex"
            style="width:200px"
            .value=${live(currentColor || "")}
            placeholder="#000000"
            @change=${syncFromText}
          ></sp-textfield>
          ${colorVars.length > 0
            ? html`
                <sp-divider size="s"></sp-divider>
                <span class="color-popover-swatches-label">Color Tokens</span>
                <sp-swatch-group size="xs" border="light" rounding="none">
                  ${colorVars.map(
                    (cv) => html`
                      <sp-swatch
                        color=${cv.value}
                        .value=${cv.name}
                        title=${cv.name}
                        @click=${(/** @type {any} */ e) => {
                          e.stopPropagation();
                          const varRef = `var(${cv.name})`;
                          _colorCallback?.(varRef);
                          /** @type {any} */
                          const tf = popoverQuery(".color-popover-hex");
                          if (tf) tf.value = varRef;
                        }}
                      ></sp-swatch>
                    `,
                  )}
                </sp-swatch-group>
              `
            : nothing}
        </div>
      </sp-popover>
    `,
    _colorPopoverHost,
  );

  _colorCallback = onChange;

  // Dismiss on click-outside or Escape
  if (_colorDismissHandler) {
    document.removeEventListener("pointerdown", _colorDismissHandler, true);
    document.removeEventListener("keydown", _colorDismissHandler, true);
  }
  _colorDismissHandler = (/** @type {any} */ e) => {
    if (e.type === "keydown") {
      if (e.key === "Escape") closeColorPopover();
      return;
    }
    const popover = popoverQuery("sp-popover");
    if (popover && !popover.contains(e.target) && !anchorEl.contains(e.target)) {
      closeColorPopover();
    }
  };
  requestAnimationFrame(() => {
    document.addEventListener("pointerdown", _colorDismissHandler, true);
    document.addEventListener("keydown", _colorDismissHandler, true);
  });
}

function safeColor(/** @type {any} */ val) {
  if (!val) return "transparent";
  return resolveColorForDisplay(val);
}

function renderColorInput(
  /** @type {any} */ prop,
  /** @type {any} */ value,
  /** @type {any} */ onChange,
) {
  return html`
    <div class="style-input-color">
      <sp-swatch
        size="s"
        rounding="none"
        border="light"
        color=${safeColor(value)}
        @click=${(/** @type {any} */ e) => {
          if (_colorPopoverHost.querySelector("sp-popover[open]")) {
            closeColorPopover();
            return;
          }
          openColorPopover(e.currentTarget, value, (/** @type {any} */ c) => {
            onChange(c);
          });
        }}
      ></sp-swatch>
      <sp-textfield
        size="s"
        style="flex:1; min-width:0"
        .value=${live(value || "")}
        @input=${debouncedStyleCommit(`color:${prop}`, 400, (/** @type {any} */ e) => {
          onChange(e.target.value.trim());
        })}
      ></sp-textfield>
    </div>
  `;
}

function renderNumberUnitInput(
  /** @type {any} */ entry,
  /** @type {any} */ prop,
  /** @type {any} */ value,
  /** @type {any} */ onChange,
) {
  const units = entry.$units || [];
  const keywords = entry.$keywords || [];
  const strVal = String(value ?? "");
  const match = strVal.match(UNIT_RE);
  const isKeyword = !match && strVal !== "" && keywords.includes(strVal);
  const isNumericVal = (/** @type {any} */ v) => /^-?\d*\.?\d*$/.test(v);

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
        <sp-textfield
          size="s"
          placeholder="0"
          .value=${live(displayValue)}
          @input=${debouncedStyleCommit(`nui:${prop}`, 400, (/** @type {any} */ e) => {
            const val = (e.target.value ?? "").trim();
            if (val === "") {
              onChange("");
              return;
            }
            if (isNumericVal(val)) onChange(units.length > 0 ? val + currentUnit : val);
            else onChange(val);
          })}
        ></sp-textfield>
        ${hasUnits
          ? html`
              <sp-picker-button id=${btnId} size="s">
                <span slot="label">${currentUnit || units[0] || ""}</span>
              </sp-picker-button>
              <sp-overlay trigger="${btnId}@click" placement="bottom-end" offset="4">
                <sp-popover style="min-width: var(--spectrum-component-width-900, 64px)">
                  <sp-menu
                    label="CSS unit"
                    @change=${(/** @type {any} */ e) => {
                      const chosen = e.target.value;
                      if (keywords.includes(chosen)) {
                        onChange(chosen);
                      } else if (units.includes(chosen)) {
                        // Re-commit with new unit
                        const curMatch = String(value ?? "").match(UNIT_RE);
                        const numPart = curMatch ? curMatch[1] : "";
                        if (numPart) onChange(numPart + chosen);
                      }
                    }}
                  >
                    ${units.map(
                      (/** @type {any} */ u) => html`<sp-menu-item value=${u}>${u}</sp-menu-item>`,
                    )}
                    ${keywords.length > 0 && units.length > 0
                      ? html`<sp-menu-divider></sp-menu-divider>`
                      : nothing}
                    ${keywords.map(
                      (/** @type {any} */ kw) =>
                        html`<sp-menu-item value=${kw}>${kw}</sp-menu-item>`,
                    )}
                  </sp-menu>
                </sp-popover>
              </sp-overlay>
            `
          : nothing}
      </div>
    </div>
  `;
}

// abbreviateValue — imported from studio-utils.js

/** @param {any} entry @param {any} prop @param {any} value @param {any} onChange */
function renderButtonGroupInput(entry, prop, value, onChange) {
  const values = entry.$buttonValues || entry.enum || [];
  /** @type {Record<string, any>} */
  const iconMap = entry.$icons || {};
  const extra =
    entry.$buttonValues && entry.enum && entry.enum.length > entry.$buttonValues.length
      ? entry.enum.filter((/** @type {any} */ v) => !entry.$buttonValues.includes(v))
      : [];

  const menuId = `style-btngrp-${prop}`;
  const hasExtra = extra.length > 0;
  // If the current value is one of the extra (non-button) options, show it selected in the picker
  const extraSelected = hasExtra && extra.includes(value);

  return html`
    <div class="button-group-combo ${hasExtra ? "has-overflow" : ""}">
      <sp-action-group size="s" compact>
        ${values.map(
          (/** @type {any} */ v) => html`
            <sp-action-button
              size="s"
              title=${v}
              ?selected=${v === value}
              @click=${() => onChange(v === value ? "" : v)}
            >
              ${
                /** @type {any} */ (iconMap)[v] &&
                /** @type {any} */ (icons)[/** @type {any} */ (iconMap)[v]]
                  ? /** @type {any} */ (icons)[/** @type {any} */ (iconMap)[v]]
                  : abbreviateValue(v)
              }
            </sp-action-button>
          `,
        )}
      </sp-action-group>
      ${hasExtra
        ? html`
            <sp-picker-button
              size="s"
              id=${menuId}
              class=${extraSelected ? "has-selection" : ""}
            ></sp-picker-button>
            <sp-overlay trigger="${menuId}@click" placement="bottom-end" type="auto">
              <sp-popover>
                <sp-menu
                  @change=${(/** @type {any} */ e) => {
                    if (e.target.value) onChange(e.target.value);
                  }}
                >
                  <sp-menu-item value="__none__">—</sp-menu-item>
                  ${extra.map((/** @type {any} */ v) => {
                    const label = v.includes("-")
                      ? kebabToLabel(v)
                      : v.replace(/^./, (/** @type {any} */ c) => c.toUpperCase());
                    return html`<sp-menu-item value=${v} ?selected=${v === value}
                      >${label}</sp-menu-item
                    >`;
                  })}
                </sp-menu>
              </sp-popover>
            </sp-overlay>
          `
        : nothing}
    </div>
  `;
}

/** Typography CSS properties that should preview their values in-menu */
const TYPO_PREVIEW_PROPS = new Set(["fontStyle", "fontVariant", "textTransform", "textDecoration"]);

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
 * If the current value is one of the predefined options → renders as sp-picker with Title Case
 * labels (and typography preview when applicable). Selecting "—" clears the value, which flips to
 * combobox mode.
 *
 * If the value is empty or a custom string → renders as sp-combobox with predefined options in its
 * dropdown. Selecting one flips to picker mode.
 *
 * Note: sp-combobox recreates items in shadow DOM as plain text, so typography preview props use a
 * manual sp-textfield + sp-overlay + sp-menu instead.
 *
 * @param {any} options @param {any} prop @param {any} value @param {any} onChange
 */
function renderKeywordInput(options, prop, value, onChange) {
  const isTypoPreview = TYPO_PREVIEW_PROPS.has(prop) || prop === "fontWeight";
  const font = isTypoPreview ? currentFontFamily() : "";
  const cssProp = isTypoPreview ? camelToKebab(prop) : "";

  const comboOptions = options.map((/** @type {any} */ v) => {
    const label = v.includes("-")
      ? kebabToLabel(v)
      : v.replace(/^./, (/** @type {any} */ c) => c.toUpperCase());
    const style = isTypoPreview ? `${cssProp}: ${v};${font ? ` font-family: ${font}` : ""}` : "";
    return { value: v, label, style };
  });

  return html`<jx-styled-combobox
    size="s"
    .value=${value || ""}
    placeholder=${cssInitialMap.get(prop) || ""}
    .options=${comboOptions}
    @change=${(/** @type {any} */ e) => onChange(e.target.value)}
    @input=${debouncedStyleCommit(`kw:${prop}`, 400, (/** @type {any} */ e) =>
      onChange(e.target.value),
    )}
  ></jx-styled-combobox>`;
}

function renderSelectInput(
  /** @type {any} */ entry,
  /** @type {any} */ prop,
  /** @type {any} */ value,
  /** @type {any} */ onChange,
) {
  return renderKeywordInput(entry.enum || [], prop, value, onChange);
}

function handleFontPresetSelection(/** @type {any} */ preset, /** @type {any} */ onChange) {
  const varName = friendlyNameToVar(preset.title, "--font-");
  if (!S.document?.style?.[varName]) {
    S = updateStyle(S, [], varName, preset.value);
  }
  onChange(`var(${varName})`);
}

function handleFontSelection(
  /** @type {any} */ val,
  /** @type {any} */ presets,
  /** @type {any} */ onChange,
) {
  if (!val) return;
  // sp-picker returns the option's value attribute (prefixed or var name)
  if (val.startsWith("__preset__:")) {
    const title = val.slice("__preset__:".length);
    const preset = presets.find((/** @type {any} */ p) => p.title === title);
    if (preset) handleFontPresetSelection(preset, onChange);
    return;
  }
  if (val.startsWith("--")) {
    onChange(`var(${val})`);
    return;
  }
  // sp-combobox returns display text — match against preset titles and font var
  // display names before falling through to plain text
  const preset = presets.find((/** @type {any} */ p) => p.title === val);
  if (preset) {
    handleFontPresetSelection(preset, onChange);
    return;
  }
  const fontVars = getFontVars();
  const matchedVar = fontVars.find(
    (/** @type {any} */ fv) => varDisplayName(fv.name, "--font-") === val,
  );
  if (matchedVar) {
    onChange(`var(${matchedVar.name})`);
    return;
  }
  // Plain font family string (e.g. "serif", "Arial, sans-serif")
  onChange(val);
}

/**
 * Build font options array for jx-styled-combobox. Local font vars first, divider, then unadded
 * presets.
 *
 * @param {any[]} fontVars @param {any[]} presets
 * @returns {{ value: string; label: string; style: string }[] | { divider: true }[]}
 */
function buildFontOptions(fontVars, presets) {
  /** @type {any[]} */
  const opts = fontVars.map((/** @type {any} */ fv) => ({
    value: fv.name,
    label: varDisplayName(fv.name, "--font-"),
    style: `font-family: ${fv.value}`,
  }));
  const unadded = presets.filter(
    (/** @type {any} */ p) =>
      !fontVars.some((/** @type {any} */ fv) => fv.name === friendlyNameToVar(p.title, "--font-")),
  );
  if (unadded.length > 0 && opts.length > 0) opts.push({ divider: true });
  for (const p of unadded) {
    opts.push({
      value: "__preset__:" + p.title,
      label: p.title,
      style: `font-family: ${p.value}`,
    });
  }
  return opts;
}

function renderComboboxInput(
  /** @type {any} */ entry,
  /** @type {any} */ prop,
  /** @type {any} */ value,
  /** @type {any} */ onChange,
) {
  const fontVars = prop === "fontFamily" ? getFontVars() : [];
  const presets = entry.presets || [];
  const examples = entry.examples || [];

  // fontFamily: single jx-styled-combobox with font options
  if (prop === "fontFamily") {
    // Strip var() wrapper so the component can match the option value
    const varMatch = typeof value === "string" && value.match(/^var\((--[^)]+)\)$/);
    const comboValue = varMatch ? varMatch[1] : value || "";
    const fontOptions = buildFontOptions(fontVars, presets);
    return html`<jx-styled-combobox
      size="s"
      .value=${comboValue}
      placeholder=${cssInitialMap.get("fontFamily") || ""}
      .options=${fontOptions}
      @change=${(/** @type {any} */ e) => handleFontSelection(e.target.value, presets, onChange)}
      @input=${debouncedStyleCommit("combo:fontFamily", 400, (/** @type {any} */ e) =>
        onChange(e.target.value),
      )}
    ></jx-styled-combobox>`;
  }

  // All other comboboxes: use the shared keyword dual-mode input
  if (examples.length > 0) {
    return renderKeywordInput(examples, prop, value, onChange);
  }

  // Fallback: plain textfield (no predefined options)
  return html`
    <sp-textfield
      size="s"
      placeholder=${cssInitialMap.get(prop) || ""}
      .value=${live(value || "")}
      @input=${debouncedStyleCommit(`combo:${prop}`, 400, (/** @type {any} */ e) =>
        onChange(e.target.value),
      )}
    ></sp-textfield>
  `;
}

function renderNumberInput(
  /** @type {any} */ entry,
  /** @type {any} */ prop,
  /** @type {any} */ value,
  /** @type {any} */ onChange,
) {
  return html`
    <sp-number-field
      size="s"
      hide-stepper
      .value=${live(value !== undefined && value !== "" ? Number(value) : undefined)}
      min=${ifDefined(entry.minimum)}
      max=${ifDefined(entry.maximum)}
      step=${ifDefined(entry.maximum !== undefined && entry.maximum <= 1 ? 0.1 : undefined)}
      @change=${debouncedStyleCommit(`num:${prop}`, 400, (/** @type {any} */ e) => {
        const v = e.target.value;
        if (v === undefined || isNaN(v)) onChange("");
        else onChange(Number(v));
      })}
    ></sp-number-field>
  `;
}

function renderTextInput(
  /** @type {any} */ prop,
  /** @type {any} */ value,
  /** @type {any} */ onChange,
) {
  return html`
    <sp-textfield
      size="s"
      placeholder=${cssInitialMap.get(prop) || ""}
      .value=${live(value || "")}
      @input=${debouncedStyleCommit(`text:${prop}`, 400, (/** @type {any} */ e) =>
        onChange(e.target.value),
      )}
    ></sp-textfield>
  `;
}

// camelToLabel, kebabToLabel, propLabel, attrLabel — imported from studio-utils.js

function widgetForType(
  /** @type {any} */ type,
  /** @type {any} */ entry,
  /** @type {any} */ prop,
  /** @type {any} */ value,
  /** @type {any} */ onCommit,
) {
  switch (type) {
    case "button-group":
      return renderButtonGroupInput(entry, prop, value, onCommit);
    case "color":
      return renderColorInput(prop, value, onCommit);
    case "number-unit":
      return renderNumberUnitInput(entry, prop, value, onCommit);
    case "number":
      return renderNumberInput(entry, prop, value, onCommit);
    case "select":
      return renderSelectInput(entry, prop, value, onCommit);
    case "combobox":
      return renderComboboxInput(entry, prop, value, onCommit);
    default:
      return renderTextInput(prop, value, onCommit);
  }
}

function renderStyleRow(
  /** @type {any} */ entry,
  /** @type {any} */ prop,
  /** @type {any} */ value,
  /** @type {any} */ onCommit,
  /** @type {any} */ onDelete,
  /** @type {any} */ isWarning,
  /** @type {any} */ gridMode,
) {
  const type = inferInputType(entry);
  const hasVal = value !== undefined && value !== "";
  return html`
    <div
      class=${classMap({ "style-row": true, "style-row--warning": isWarning })}
      data-prop=${prop}
      style=${gridMode && entry.$span === 2 ? "grid-column: 1 / -1" : ""}
    >
      <div class="style-row-label">
        ${hasVal
          ? html`<span
              class="set-dot"
              title="Clear ${prop}"
              @click=${(/** @type {any} */ e) => {
                e.stopPropagation();
                onDelete();
              }}
            ></span>`
          : nothing}
        <sp-field-label size="s" title=${prop}>${propLabel(entry, prop)}</sp-field-label>
      </div>
      ${widgetForType(type, entry, prop, value, onCommit)}
    </div>
  `;
}

function renderShorthandRow(
  /** @type {any} */ shortProp,
  /** @type {any} */ entry,
  /** @type {any} */ style,
  /** @type {any} */ commitFn,
  /** @type {any} */ _deleteFn,
) {
  const longhands = getLonghands(shortProp);
  const shortVal = style[shortProp];
  const hasLonghands = longhands.some((l) => style[l.name] !== undefined);
  const isExpanded = S.ui.styleShorthands[shortProp] ?? hasLonghands;
  const hasAnyVal = shortVal !== undefined || longhands.some((l) => style[l.name] !== undefined);

  return html`
    <div class="style-row" data-prop=${shortProp}>
      <div class="style-row-label">
        ${hasAnyVal
          ? html`<span
              class="set-dot"
              title="Clear ${shortProp}"
              @click=${(/** @type {any} */ e) => {
                e.stopPropagation();
                let s = S;
                if (shortVal !== undefined) s = commitFn(s, shortProp, undefined);
                for (const l of longhands) {
                  if (style[l.name] !== undefined) s = commitFn(s, l.name, undefined);
                }
                update(s);
              }}
            ></span>`
          : nothing}
        <sp-field-label size="s" title=${shortProp}>${propLabel(entry, shortProp)}</sp-field-label>
      </div>
      <div class="style-shorthand-header">
        <sp-textfield
          size="s"
          .value=${live(shortVal || "")}
          placeholder=${!shortVal && hasLonghands
            ? longhands.map((l) => style[l.name] || "0").join(" ")
            : ""}
          @input=${debouncedStyleCommit(`short:${shortProp}`, 400, (/** @type {any} */ e) => {
            let s = S;
            for (const l of longhands) {
              if (style[l.name] !== undefined) s = commitFn(s, l.name, undefined);
            }
            s = commitFn(s, shortProp, e.target.value || undefined);
            update(s);
          })}
        ></sp-textfield>
        <sp-action-button
          size="xs"
          quiet
          @click=${(/** @type {any} */ e) => {
            e.stopPropagation();
            S = {
              ...S,
              ui: {
                ...S.ui,
                styleShorthands: { ...S.ui.styleShorthands, [shortProp]: !isExpanded },
              },
            };
            renderRightPanel();
          }}
        >
          ${isExpanded
            ? html`<sp-icon-chevron-down slot="icon"></sp-icon-chevron-down>`
            : html`<sp-icon-chevron-right slot="icon"></sp-icon-chevron-right>`}
        </sp-action-button>
      </div>
    </div>
    ${isExpanded
      ? longhands.map(({ name, entry: lEntry }) => {
          const lVal = style[name] ?? "";
          return html`
            <div class="style-row style-row--child" data-prop=${name}>
              <div class="style-row-label">
                ${lVal !== undefined && lVal !== ""
                  ? html`<span
                      class="set-dot"
                      title="Clear ${name}"
                      @click=${(/** @type {any} */ e) => {
                        e.stopPropagation();
                        update(commitFn(S, name, undefined));
                      }}
                    ></span>`
                  : nothing}
                <sp-field-label size="s" title=${name}>${propLabel(lEntry, name)}</sp-field-label>
              </div>
              ${widgetForType(
                inferInputType(lEntry),
                lEntry,
                name,
                lVal,
                (/** @type {any} */ newVal) => update(commitFn(S, name, newVal || undefined)),
              )}
            </div>
          `;
        })
      : nothing}
  `;
}

function styleSidebarTemplate(
  /** @type {any} */ node,
  /** @type {any} */ activeMediaTab,
  /** @type {any} */ activeSelector,
) {
  const style = node.style || {};
  const { sizeBreakpoints } = parseMediaEntries(getEffectiveMedia(S.document.$media));
  const mediaNames = sizeBreakpoints.map((bp) => bp.name);
  const activeTab = activeMediaTab;

  // ── Media tabs template ──────────────────────────────────────────────────
  const mediaTabsT =
    mediaNames.length > 0
      ? html`
          <sp-tabs size="s">
            <sp-tab
              label="Base"
              value="base"
              ?selected=${activeTab === null}
              @click=${() => {
                S = { ...S, ui: { ...S.ui, activeMedia: null } };
                updateActivePanelHeaders();
                renderRightPanel();
              }}
            ></sp-tab>
            ${mediaNames.map(
              (name) => html`
                <sp-tab
                  label=${mediaDisplayName(name)}
                  value=${name}
                  ?selected=${activeTab === name}
                  @click=${() => {
                    S = { ...S, ui: { ...S.ui, activeMedia: name } };
                    updateActivePanelHeaders();
                    renderRightPanel();
                  }}
                ></sp-tab>
              `,
            )}
          </sp-tabs>
        `
      : nothing;

  // ── Selector dropdown ──────────────────────────────────────────────────────
  const contextStyle = activeTab ? style[`@${activeTab}`] || {} : style;
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
      <sp-picker
        class="selector-select"
        .value=${live(_selectorVal)}
        @change=${(/** @type {any} */ e) => {
          const val = e.target.value;
          if (val === "__add_custom__") {
            requestAnimationFrame(() => {
              e.target.value = activeSelector || "__base__";
            });
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
            const finish = (/** @type {any} */ accept) => {
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
        }}
      >
        <sp-menu-item value="__base__">(base)</sp-menu-item>
        <sp-menu-divider></sp-menu-divider>
        ${COMMON_SELECTORS.map(
          (s) => html`
            <sp-menu-item value=${s}>${existingSet.has(s) ? `${s}  \u25CF` : s}</sp-menu-item>
          `,
        )}
        ${extraSelectors.length > 0
          ? html`
              <sp-menu-divider></sp-menu-divider>
              ${extraSelectors.map((s) => html` <sp-menu-item value=${s}>${s} ●</sp-menu-item> `)}
            `
          : nothing}
        <sp-menu-divider></sp-menu-divider>
        <sp-menu-item value="__add_custom__">+ Add custom…</sp-menu-item>
      </sp-picker>
    </div>
  `;

  // ── Determine the active style object ──────────────────────────────────────
  /** @type {Record<string, any>} */
  let activeStyle;
  /** @type {any} */
  let commitStyle;
  if (activeSelector && activeTab && mediaNames.length > 0) {
    activeStyle = (style[`@${activeTab}`] || {})[activeSelector] || {};
    commitStyle = (/** @type {any} */ s, /** @type {any} */ prop, /** @type {any} */ val) =>
      updateMediaNestedStyle(s, S.selection, activeTab, activeSelector, prop, val);
  } else if (activeSelector) {
    activeStyle = style[activeSelector] || {};
    commitStyle = (/** @type {any} */ s, /** @type {any} */ prop, /** @type {any} */ val) =>
      updateNestedStyle(s, S.selection, activeSelector, prop, val);
  } else if (activeTab !== null && mediaNames.length > 0) {
    activeStyle = {};
    for (const [p, v] of Object.entries(style[`@${activeTab}`] || {})) {
      if (typeof v !== "object") activeStyle[p] = v;
    }
    commitStyle = (/** @type {any} */ s, /** @type {any} */ prop, /** @type {any} */ val) =>
      updateMediaStyle(s, S.selection, activeTab, prop, val);
  } else {
    activeStyle = {};
    for (const [p, v] of Object.entries(style)) {
      if (typeof v !== "object") activeStyle[p] = v;
    }
    commitStyle = (/** @type {any} */ s, /** @type {any} */ prop, /** @type {any} */ val) =>
      updateStyle(s, S.selection, prop, val);
  }

  // Auto-open sections that have properties
  const newSections = autoOpenSections({ style: activeStyle }, S.ui.styleSections);
  if (JSON.stringify(newSections) !== JSON.stringify(S.ui.styleSections)) {
    S = { ...S, ui: { ...S.ui, styleSections: newSections } };
  }

  // Partition properties into sections
  const sectionProps = /** @type {Record<string, any[]>} */ ({});
  for (const sec of cssMeta.$sections) sectionProps[sec.key] = [];

  for (const [prop, entry] of /** @type {[string, any][]} */ (Object.entries(cssMeta.$defs))) {
    if (typeof entry.$shorthand === "string") continue;
    const sec = entry.$section || "other";
    sectionProps[sec].push({ prop, entry });
  }
  for (const sec of cssMeta.$sections) {
    sectionProps[sec.key].sort(
      (/** @type {any} */ a, /** @type {any} */ b) => a.entry.$order - b.entry.$order,
    );
  }

  const otherProps = [];
  for (const prop of Object.keys(activeStyle)) {
    if (!(/** @type {Record<string, any>} */ (cssMeta.$defs)[prop])) otherProps.push(prop);
  }

  // ── Section templates ────────────────────────────────────────────────────
  const sectionTemplates = cssMeta.$sections
    .filter((sec) => sec.key !== "other")
    .map((sec) => {
      const entries = sectionProps[sec.key];

      const sectionActiveProps = entries.filter((/** @type {any} */ { prop, entry }) => {
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
            rows.push(
              renderStyleRow(
                entry,
                prop,
                val ?? "",
                (/** @type {any} */ newVal) => update(commitStyle(S, prop, newVal || undefined)),
                () => update(commitStyle(S, prop, undefined)),
                isWarning,
                sec.$layout === "grid",
              ),
            );
          }
        }
      }

      const isOpen = S.ui.styleSections[sec.key] ?? false;

      return html`
        <sp-accordion-item
          label=${sec.label}
          .open=${isOpen}
          @sp-accordion-item-toggle=${(/** @type {any} */ e) => {
            S = {
              ...S,
              ui: { ...S.ui, styleSections: { ...S.ui.styleSections, [sec.key]: e.target.open } },
            };
          }}
        >
          ${sectionActiveProps.length > 0
            ? html`
                <span slot="heading" style="display:flex;align-items:center;gap:6px">
                  ${sec.label}
                  <span
                    class="set-dot set-dot--section"
                    title="Clear all ${sec.label.toLowerCase()} properties"
                    @click=${(/** @type {any} */ e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      let s = S;
                      for (const { prop, entry } of sectionActiveProps) {
                        if (activeStyle[prop] !== undefined) s = commitStyle(s, prop, undefined);
                        if (inferInputType(entry) === "shorthand") {
                          for (const l of getLonghands(prop)) {
                            if (activeStyle[l.name] !== undefined)
                              s = commitStyle(s, l.name, undefined);
                          }
                        }
                      }
                      update(s);
                    }}
                  ></span>
                </span>
              `
            : nothing}
          <div class=${sec.$layout === "grid" ? "style-section-body--grid" : ""}>${rows}</div>
        </sp-accordion-item>
      `;
    });

  // ── Custom section ─────────────────────────────────────────────────────────
  const customIsOpen = S.ui.styleSections.other ?? otherProps.length > 0;
  const customSectionT = html`
    <sp-accordion-item
      label="Custom"
      .open=${customIsOpen}
      @sp-accordion-item-toggle=${(/** @type {any} */ e) => {
        S = {
          ...S,
          ui: { ...S.ui, styleSections: { ...S.ui.styleSections, other: e.target.open } },
        };
      }}
    >
      <div>
        ${otherProps.map(
          (prop) => html`
            <div class="kv-row">
              <sp-textfield
                size="s"
                class="kv-key"
                .value=${live(prop)}
                @change=${(/** @type {any} */ e) => {
                  const newProp = e.target.value.trim();
                  if (newProp && newProp !== prop) {
                    let s = commitStyle(S, prop, undefined);
                    s = commitStyle(s, newProp, String(activeStyle[prop]));
                    update(s);
                  }
                }}
              ></sp-textfield>
              <sp-textfield
                size="s"
                class="kv-val"
                .value=${live(String(activeStyle[prop]))}
                placeholder=${ifDefined(cssInitialMap.get(prop))}
                @input=${debouncedStyleCommit(`custom:${prop}`, 400, (/** @type {any} */ e) => {
                  update(commitStyle(S, prop, e.target.value));
                })}
              ></sp-textfield>
              <sp-action-button
                size="xs"
                quiet
                @click=${() => update(commitStyle(S, prop, undefined))}
              >
                <sp-icon-close slot="icon"></sp-icon-close>
              </sp-action-button>
            </div>
          `,
        )}
        <div style="display:flex;gap:4px;padding-top:4px">
          <sp-textfield
            size="s"
            placeholder="Property name…"
            style="flex:1"
            @keydown=${(/** @type {any} */ e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const prop = e.target.value.trim();
                if (prop) {
                  const initial = cssInitialMap.get(prop) || "";
                  update(commitStyle(S, prop, initial || ""));
                  e.target.value = "";
                }
              }
            }}
          ></sp-textfield>
        </div>
      </div>
    </sp-accordion-item>
  `;

  return html`
    <div class="style-sidebar">
      ${mediaTabsT} ${selectorT}
      <sp-accordion allow-multiple size="s"> ${sectionTemplates} ${customSectionT} </sp-accordion>
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
function _renderStylePanel(/** @type {any} */ container) {
  litRender(renderStylePanelTemplate(), container);
}

/** Single property input row */
function _fieldRow(
  /** @type {any} */ label,
  /** @type {any} */ type,
  /** @type {any} */ value,
  /** @type {any} */ onChange,
  /** @type {any} */ _datalistId,
) {
  /** @type {any} */
  let debounceTimer;
  const onInput = (/** @type {any} */ e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onChange(e.target.value), 400);
  };
  const inputTpl =
    type === "textarea"
      ? html`<sp-textfield
          multiline
          size="s"
          value=${value ?? ""}
          @input=${onInput}
        ></sp-textfield>`
      : type === "checkbox"
        ? html`<sp-checkbox
            ?checked=${!!value}
            @change=${(/** @type {any} */ e) => onChange(e.target.checked)}
          ></sp-checkbox>`
        : html`<sp-textfield size="s" value=${value ?? ""} @input=${onInput}></sp-textfield>`;
  return html`
    <div class="field-row">
      <sp-field-label size="s">${label}</sp-field-label>
      ${inputTpl}
    </div>
  `;
}

/** Check if a selection path is inside a $map template (contains [..., "children", "map", ...]). */
function isInsideMapTemplate(/** @type {any} */ path) {
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
function bindableFieldRow(
  /** @type {any} */ label,
  /** @type {any} */ type,
  /** @type {any} */ rawValue,
  /** @type {any} */ onChange,
  /** @type {any} */ filterFn = null,
  /** @type {any} */ extraSignals = null,
) {
  const defs = S.document.state || {};
  const isBound = typeof rawValue === "object" && rawValue !== null && rawValue.$ref;

  const signalDefs = Object.entries(defs).filter(([, d]) =>
    filterFn ? filterFn(d) : !d.$handler && d.$prototype !== "Function",
  );

  /** @type {any} */
  let debounce;
  const onInput = (/** @type {any} */ e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => onChange(e.target.value), 400);
  };

  const staticVal = isBound ? "" : (rawValue ?? "");
  const staticTpl =
    type === "textarea"
      ? html`<sp-textfield multiline size="s" value=${staticVal} @input=${onInput}></sp-textfield>`
      : type === "checkbox"
        ? html`<sp-checkbox
            ?checked=${!!staticVal}
            @change=${(/** @type {any} */ e) => onChange(e.target.checked)}
          ></sp-checkbox>`
        : html`<sp-textfield size="s" value=${staticVal} @input=${onInput}></sp-textfield>`;

  const boundTpl = html`
    <sp-picker
      size="s"
      quiet
      placeholder="— select signal —"
      value=${isBound && rawValue.$ref ? rawValue.$ref : nothing}
      @change=${(/** @type {any} */ e) => {
        if (e.target.value) onChange({ $ref: e.target.value });
        else onChange(undefined);
      }}
    >
      ${signalDefs.map(
        ([defName]) => html`<sp-menu-item value=${`#/state/${defName}`}>${defName}</sp-menu-item>`,
      )}
      ${extraSignals
        ? html`
            <sp-menu-divider></sp-menu-divider>
            ${extraSignals.map(
              (/** @type {any} */ sig) =>
                html`<sp-menu-item value=${sig.value}>${sig.label}</sp-menu-item>`,
            )}
          `
        : nothing}
    </sp-picker>
  `;

  const onToggle = () => {
    if (isBound) {
      const ref = rawValue.$ref;
      const defName = ref.startsWith("#/state/") ? ref.slice(8) : ref;
      const def = defs[defName];
      let staticVal = "";
      if (def && def.default !== undefined)
        staticVal =
          typeof def.default === "object" ? JSON.stringify(def.default) : String(def.default);
      onChange(staticVal || undefined);
    } else {
      if (signalDefs.length > 0) {
        onChange({ $ref: `#/state/${signalDefs[0][0]}` });
      } else if (extraSignals?.length > 0) {
        onChange({ $ref: extraSignals[0].value });
      }
    }
  };

  return html`
    <div class="field-row">
      <sp-field-label size="s">${label}</sp-field-label>
      ${isBound ? boundTpl : staticTpl}
      <sp-action-button
        size="xs"
        quiet
        title=${isBound ? "Unbind (switch to static)" : "Bind to signal"}
        @click=${onToggle}
        >${isBound ? "\u26A1" : "\u2194"}</sp-action-button
      >
    </div>
  `;
}

/** Key-value pair row for styles / attributes */
function kvRow(
  /** @type {any} */ key,
  /** @type {any} */ value,
  /** @type {any} */ onChange,
  /** @type {any} */ onDelete,
  /** @type {any} */ datalistId = null,
) {
  /** @type {any} */
  let debounceTimer;
  let currentKey = key;
  let currentVal = value;
  const commit = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onChange(currentKey, currentVal), 400);
  };
  const placeholder = datalistId === "css-props" ? cssInitialMap.get(key) || "" : "";
  return html`
    <div class="kv-row">
      <sp-textfield
        size="s"
        class="kv-key"
        value=${key}
        @input=${(/** @type {any} */ e) => {
          currentKey = e.target.value;
          commit();
        }}
        @change=${datalistId === "css-props"
          ? (/** @type {any} */ e) => {
              const el = e.target.closest(".kv-row")?.querySelector(".kv-val");
              if (el) el.setAttribute("placeholder", cssInitialMap.get(e.target.value) || "");
            }
          : nothing}
      ></sp-textfield>
      <sp-textfield
        size="s"
        class="kv-val"
        value=${value}
        placeholder=${placeholder}
        @input=${(/** @type {any} */ e) => {
          currentVal = e.target.value;
          commit();
        }}
      ></sp-textfield>
      <sp-action-button size="xs" quiet @click=${onDelete}>
        <sp-icon-close slot="icon"></sp-icon-close>
      </sp-action-button>
    </div>
  `;
}

// ─── Source view ──────────────────────────────────────────────────────────────

function _renderSourceView(/** @type {any} */ container) {
  if (!S.selection) {
    litRender(
      html`
        <textarea
          id="source-view"
          .value=${live(JSON.stringify(S.document, null, 2))}
          @blur=${(/** @type {any} */ e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              S = { ...S, document: parsed, dirty: true };
              render();
            } catch {}
          }}
        ></textarea>
      `,
      container,
    );
    return;
  }

  const node = getNodeAtPath(S.document, S.selection);
  litRender(
    html`
      <textarea id="source-view" readonly .value=${live(JSON.stringify(node, null, 2))}></textarea>
    `,
    container,
  );
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
  if (functionEditor) {
    functionEditor.dispose();
    functionEditor = null;
  }
  if (monacoEditor) {
    monacoEditor.dispose();
    monacoEditor = null;
  }

  // Clean up canvas DnD
  for (const fn of canvasDndCleanups) fn();
  canvasDndCleanups = [];
  canvasPanels.length = 0;

  litRender(nothing, canvasWrap);
  canvasWrap.style.padding = "0";

  // Toolbar breadcrumb handles context display — re-render it
  renderToolbar();

  // Editor container
  /** @type {HTMLDivElement | null} */
  let editorContainer = null;
  litRender(
    html`<div
      class="source-editor"
      ${ref((el) => {
        if (el) editorContainer = /** @type {HTMLDivElement} */ (el);
      })}
    ></div>`,
    canvasWrap,
  );

  const body = getFunctionBody(editing);
  const args = getFunctionArgs(editing, S);

  functionEditor = monaco.editor.create(/** @type {any} */ (editorContainer), {
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
  /** @type {any} */
  let syncDebounce;
  /** @type {any} */
  let lintDebounce;
  let lintGen = 0;
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
        update(
          updateProperty(S, editing.path, editing.eventKey, {
            ...current,
            $prototype: "Function",
            body: newBody,
          }),
        );
      }
      renderLeftPanel();
    }, 500);

    clearTimeout(lintDebounce);
    lintDebounce = setTimeout(() => {
      const gen = ++lintGen;
      const currentCode = functionEditor.getValue();
      codeService("lint", { code: currentCode, args }).then((result) => {
        if (gen !== lintGen) return;
        if (result?.diagnostics && functionEditor)
          setLintMarkers(functionEditor, result.diagnostics);
      });
    }, 750);
  });
}

function getFunctionBody(/** @type {any} */ editing) {
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
        if (def?.$prototype === "Function" || def?.$handler)
          kind = monaco.languages.CompletionItemKind.Function;
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

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function renderToolbar() {
  const hasStack = S.documentStack && S.documentStack.length > 0;
  const hasFunc = !!S.ui.editingFunction;

  // Breadcrumb template
  const breadcrumbTpl =
    hasStack || hasFunc
      ? html`
          <div class="breadcrumb">
            <sp-action-button
              size="s"
              title=${hasFunc ? "Close function editor" : "Return to parent document"}
              @click=${hasFunc ? closeFunctionEditor : navigateBack}
            >
              ${toolbarIconMap["sp-icon-back"]}Back
            </sp-action-button>
            ${hasStack
              ? S.documentStack.map(
                  (/** @type {any} */ frame) => html`
                    <span class="breadcrumb-item"
                      >${frame.documentPath?.split("/").pop() || "untitled"}</span
                    >
                    <span class="breadcrumb-sep"> › </span>
                  `,
                )
              : nothing}
            <span
              class="breadcrumb-item${hasFunc ? " clickable" : " current"}"
              @click=${hasFunc ? closeFunctionEditor : nothing}
            >
              ${S.documentPath?.split("/").pop() || S.document.tagName || "document"}
            </span>
            ${hasFunc
              ? html`
                  <span class="breadcrumb-sep"> › </span>
                  <span class="breadcrumb-item current"
                    >${S.ui.editingFunction.type === "def"
                      ? `ƒ ${S.ui.editingFunction.defName}`
                      : `ƒ ${S.ui.editingFunction.eventKey}`}</span
                  >
                `
              : nothing}
          </div>
        `
      : nothing;

  // Feature toggles
  const { featureQueries } = parseMediaEntries(getEffectiveMedia(S.document.$media));
  const togglesTpl =
    featureQueries.length > 0
      ? html`
          <sp-action-group compact size="s">
            ${featureQueries.map(
              ({ name, query }) => html`
                <sp-action-button
                  toggles
                  size="s"
                  title=${query}
                  ?selected=${!!S.ui.featureToggles[name]}
                  @click=${() => {
                    const newToggles = {
                      ...S.ui.featureToggles,
                      [name]: !S.ui.featureToggles[name],
                    };
                    S = { ...S, ui: { ...S.ui, featureToggles: newToggles } };
                    renderCanvas();
                    renderOverlays();
                    renderToolbar();
                  }}
                >
                  ${mediaDisplayName(name)}
                </sp-action-button>
              `,
            )}
          </sp-action-group>
        `
      : nothing;

  // Mode switcher
  const modes = [
    { key: "edit", label: "Edit", iconTag: "sp-icon-edit" },
    { key: "design", label: "Design", iconTag: "sp-icon-artboard" },
    { key: "preview", label: "Preview", iconTag: "sp-icon-preview" },
    { key: "source", label: "Code", iconTag: "sp-icon-code" },
    { key: "stylebook", label: "Stylebook", iconTag: "sp-icon-brush" },
  ];

  const modeSwitcherTpl = html`
    <sp-action-group selects="single" size="s" compact>
      ${modes.map(
        (m) => html`
          <sp-action-button
            size="s"
            ?selected=${canvasMode === m.key}
            @click=${() => {
              if (canvasMode === m.key) return;
              if (S.ui.editingFunction) {
                if (functionEditor) {
                  functionEditor.dispose();
                  functionEditor = null;
                }
                S = { ...S, ui: { ...S.ui, editingFunction: null } };
              }
              canvasMode = m.key;
              panX = 0;
              panY = 0;
              renderCanvas();
              renderOverlays();
              renderToolbar();
              renderLeftPanel();
              if (m.key === "stylebook") {
                S = { ...S, ui: { ...S.ui, rightTab: "style" } };
                renderRightPanel();
              }
            }}
          >
            ${toolbarIconMap[m.iconTag]}${m.label}
          </sp-action-button>
        `,
      )}
    </sp-action-group>
  `;

  const tpl = html`
    <sp-action-group compact size="s">
      ${tbBtnTpl("Open Project", openProject, "sp-icon-folder-open")}
      ${tbBtnTpl("Open File", openFile, "sp-icon-document")}
      ${tbBtnTpl("Save", saveFile, "sp-icon-save-floppy")}
      ${S.fileHandle ? html`<span class="tb-filename">${S.fileHandle.name}</span>` : nothing}
      ${S.dirty ? html`<span class="tb-dirty">●</span>` : nothing}
    </sp-action-group>
    ${breadcrumbTpl}
    <sp-action-group compact size="s">
      ${tbBtnTpl("Undo", () => update(undo(S)), "sp-icon-undo")}
      ${tbBtnTpl("Redo", () => update(redo(S)), "sp-icon-redo")}
    </sp-action-group>
    <sp-action-group compact size="s">
      ${tbBtnTpl(
        "Duplicate",
        () => {
          if (S.selection) update(duplicateNode(S, S.selection));
        },
        "sp-icon-duplicate",
      )}
      ${tbBtnTpl(
        "Delete",
        () => {
          if (S.selection) update(removeNode(S, S.selection));
        },
        "sp-icon-delete",
      )}
    </sp-action-group>
    ${togglesTpl}
    <div class="tb-spacer"></div>
    ${modeSwitcherTpl}
  `;

  litRender(tpl, toolbar);
}

// ─── File Operations (delegated to file-ops.js) ─────────────────────────────

function fileOpsCtx() {
  return {
    S,
    commit: (/** @type {any} */ ns) => {
      S = ns;
      render();
    },
    renderToolbar,
  };
}
function openFile() {
  return _openFile(fileOpsCtx());
}
function loadMarkdown(/** @type {any} */ source, /** @type {any} */ fileHandle) {
  const ns = _loadMarkdown(source, fileHandle);
  S = ns;
}
function saveFile() {
  return _saveFile(fileOpsCtx());
}

// ─── File tree (delegated to files.js) ───────────────────────────────────────

function loadProject() {
  return _loadProject();
}
function openProject() {
  return _openProject({
    S,
    commit: (/** @type {any} */ ns) => {
      S = ns;
    },
    renderActivityBar: () => renderActivityBar(S),
    renderLeftPanel,
  });
}
function renderFilesTemplate() {
  return _renderFilesTemplate({ openProject, openFileFromTree, renderLeftPanel });
}
function openFileFromTree(/** @type {any} */ path) {
  return _openFileFromTree(
    {
      S,
      commit: (/** @type {any} */ ns) => {
        S = ns;
      },
      render,
      loadMarkdown,
    },
    path,
  );
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
initShortcuts(() => ({
  S,
  setS: (ns) => {
    S = ns;
  },
  canvasMode,
  panX,
  panY,
  setPan: (x, y) => {
    panX = x;
    panY = y;
    needsCenter = false;
  },
  applyTransform,
  positionZoomIndicator,
  componentInlineEdit,
  saveFile,
  openProject,
  enterEditOnPath(path) {
    requestAnimationFrame(() => {
      const activePanel = getActivePanel();
      if (activePanel) {
        const el = findCanvasElement(path, activePanel.canvas);
        if (el && isEditableBlock(el)) {
          enterInlineEdit(el, path);
        }
      }
    });
  },
}));

// ─── Autosave (registered as update middleware) ──────────────────────────────

/** @type {any} */
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

addUpdateMiddleware((/** @type {any} */ state) => {
  if (state.dirty) scheduleAutosave();
});
// trigger rebuild
