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
  insertNode,
  updateProperty,
  updateDef,
  pushDocument,
  popDocument,
  getNodeAtPath,
  pathsEqual,
  parentElementPath,
  childIndex,
  isAncestor,
  canvasWrap,
  toolbarEl,
  elToPath,
  canvasPanels,
  VOID_ELEMENTS,
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
  notify,
  projectState,
  setProjectState,
  updateUi,
  setUpdateSessionFn,
  setGetDocFn,
  setGetSessionFn,
  toFlat,
  fromFlat,
} from "./store.js";

import { view } from "./view.js";

import { renderNode as runtimeRenderNode, buildScope, defineElement } from "@jxsuite/runtime";

import {
  startEditing,
  stopEditing,
  isEditing,
  getActiveElement,
  isEditableBlock,
  isInlineInContext,
} from "./editor/inline-edit.js";
import {
  enterComponentInlineEdit,
  initComponentInlineEdit,
} from "./editor/component-inline-edit.js";
import { dismissSlashMenu as sharedDismissSlashMenu } from "./editor/slash-menu.js";
import {
  renderStatusbar,
  statusMessage,
  setStatusbarRenderer,
  mountStatusbar,
} from "./panels/statusbar.js";
import {
  openFile as _openFile,
  loadMarkdown as _loadMarkdown,
  saveFile as _saveFile,
  exportFile as _exportFile,
} from "./files/file-ops.js";
import {
  loadProject as _loadProject,
  openProject as _openProject,
  renderFilesTemplate as _renderFilesTemplate,
  openFileFromTree as _openFileFromTree,
  setupTreeKeyboard,
} from "./files/files.js";
import { eventsSidebarTemplate as _eventsSidebarTemplate } from "./panels/events-panel.js";
import { renderImportsTemplate } from "./panels/imports-panel.js";
import { renderHeadTemplate } from "./panels/head-panel.js";
import { exportCemManifest as _exportCemManifest } from "./services/cem-export.js";

import { registerPlatform, getPlatform, hasPlatform } from "./platform.js";
import {
  parseMediaEntries,
  activeBreakpointsForWidth,
  applyCanvasStyle,
  collectMediaOverrides,
  applyOverridesToCanvas,
} from "./utils/canvas-media.js";
import { createDevServerPlatform } from "./platforms/devserver.js";
import { codeService } from "./services/code-services.js";
import {
  getEffectiveMedia,
  getEffectiveImports,
  getEffectiveElements,
  getEffectiveHead,
} from "./site-context.js";
import {
  defCategory,
  defBadgeLabel,
  resolveDefaultForCanvas,
  renderSignalsTemplate,
} from "./panels/signals-panel.js";
import {
  componentRegistry,
  loadComponentRegistry,
  computeRelativePath,
} from "./files/components.js";

import {
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

import { html, render as litRender, nothing } from "lit-html";
import { ref } from "lit-html/directives/ref.js";
import { styleMap } from "lit-html/directives/style-map.js";
import { ifDefined } from "lit-html/directives/if-defined.js";

import webdata from "../data/webdata.json";
import { renderDataExplorerTemplate } from "./panels/data-explorer.js";
import { renderGitPanel } from "./panels/git-panel.js";

// ─── Spectrum Web Components ──────────────────────────────────────────────────
// Explicit class imports + registration — bare side-effect imports are tree-shaken
// by Bun's bundler despite sideEffects declarations in Spectrum's package.json.
import { components as _swc } from "./ui/spectrum.js"; // eslint-disable-line no-unused-vars
import "./ui/panel-resize.js";
import { showContextMenu, dismissContextMenu } from "./editor/context-menu.js";
import { initShortcuts } from "./editor/shortcuts.js";
import * as insertionHelper from "./editor/insertion-helper.js";
import { renderActivityBar } from "./panels/activity-bar.js";
import { renderBrowse } from "./browse/browse.js";
import * as toolbarPanel from "./panels/toolbar.js";
import * as overlaysPanel from "./panels/overlays.js";
import * as rightPanelMod from "./panels/right-panel.js";
import * as leftPanelMod from "./panels/left-panel.js";
import { renderStylebookMode, renderStylebookOverlays } from "./panels/stylebook-panel.js";
import {
  registerLayersDnD,
  registerComponentsDnD,
  registerElementsDnD,
  applyDropInstruction,
} from "./panels/dnd.js";
import { mediaDisplayName, defaultDef } from "./panels/shared.js";
import { renderFunctionEditor, registerFunctionCompletions } from "./panels/editors.js";
import {
  renderBlockActionBar,
  dismissLinkPopover,
  initBlockActionBar,
} from "./panels/block-action-bar.js";
import { initCssData } from "./panels/style-utils.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

// ─── Globals ──────────────────────────────────────────────────────────────────
// These mutable variables are local to studio.js for now. As sections are extracted
// into their own modules, they will migrate to ctx in store.js.

/** @type {any} */
let S; // current state (flat compatibility view)
/** @type {any} */
let doc = null; // doc slice (persisted, history, autosave)
/** @type {any} */
let session = null; // session slice (selection, hover, ui)

/** Creates a display:contents container appended to sp-theme or body, for floating popovers/menus. */
function createFloatingContainer() {
  const el = document.createElement("div");
  el.style.display = "contents";
  (document.querySelector("sp-theme") || document.body).appendChild(el);
  return el;
}

let canvasMode = "design";

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
  if (view.functionEditor) {
    const currentCode = view.functionEditor.getValue();
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
    view.functionEditor.dispose();
    view.functionEditor = null;
  }
  updateUi("editingFunction", null);
}

import { prepareForEditMode, restoreTemplateExpressions } from "./utils/edit-display.js";

/**
 * Render a Jx document into a canvas element using the real runtime. Populates elToPath for each
 * created element via onNodeCreated callback. Returns the live state scope on success, null on
 * failure.
 *
 * @param {number} gen - Render generation for staleness detection
 * @param {any} doc
 * @param {any} canvasEl
 */
async function renderCanvasLive(gen, doc, canvasEl) {
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
    const root = projectState?.projectRoot || "";
    const docPrefix = root ? `${root}/` : "";
    const docBase = S.documentPath ? `${location.origin}/${docPrefix}${S.documentPath}` : undefined;

    // Register custom elements so the runtime can render them
    let effectiveElements = getEffectiveElements(renderDoc.$elements);

    // In content mode (markdown), auto-discover components for directive-based
    // custom elements that have no explicit $elements registration.
    if (S.mode === "content" && componentRegistry.length > 0) {
      const existingRefs = new Set(
        effectiveElements.map((/** @type {any} */ e) => (typeof e === "string" ? e : e?.$ref)),
      );
      /** @param {any} node */
      const collectTags = (node) => {
        /** @type {Set<string>} */
        const tags = new Set();
        if (!node || typeof node !== "object") return tags;
        if (node.tagName) tags.add(node.tagName);
        if (Array.isArray(node.children)) {
          for (const child of node.children) {
            for (const t of collectTags(child)) tags.add(t);
          }
        }
        return tags;
      };
      for (const tag of collectTags(renderDoc)) {
        const comp = componentRegistry.find((/** @type {any} */ c) => c.tagName === tag);
        if (comp && comp.source !== "npm") {
          const relPath = computeRelativePath(S.documentPath, comp.path);
          if (!existingRefs.has(relPath)) {
            effectiveElements.push({ $ref: relPath });
            existingRefs.add(relPath);
          }
        }
      }
    }

    if (effectiveElements.length) {
      renderDoc.$elements = effectiveElements;
      for (const entry of effectiveElements) {
        if (typeof entry === "string") {
          try {
            const specifier =
              entry.startsWith("/") || entry.startsWith(".")
                ? entry
                : `/${projectState?.projectRoot || ""}/node_modules/${entry}`.replace(/\/+/g, "/");
            await import(specifier);
          } catch (/** @type {any} */ e) {
            console.warn("Studio: failed to import package", entry, e);
          }
        } else if (entry?.$ref) {
          const href = new URL(entry.$ref, docBase).href;
          try {
            await defineElement(href);
          } catch (/** @type {any} */ e) {
            console.warn("Studio: failed to register element", entry.$ref, e);
          }
        }
      }
    }

    // Bail out if a newer render started while we were importing elements
    if (gen !== view.renderGeneration) return null;

    // Inject site-level imports so buildScope can resolve $prototype names
    renderDoc.imports = getEffectiveImports(renderDoc.imports);

    // Apply project-level styles mirroring the compiler convention:
    //   viewport ≈ :root  → CSS custom properties (they inherit down)
    //   canvasEl ≈ body   → regular CSS properties (inline beats CSS defaults)
    // This ensures project font-family, color, etc. override the
    // content-mode fallback typography rules in the stylesheet.
    // In edit mode, propagate to the .content-edit-canvas wrapper for seamless appearance.
    const viewport = canvasEl.closest(".canvas-panel-viewport");
    const editSurface = canvasMode === "edit" ? canvasEl.closest(".content-edit-canvas") : null;
    const siteStyle = projectState?.projectConfig?.style;
    if (viewport) {
      viewport.style.cssText = "";
      if (siteStyle && typeof siteStyle === "object") {
        for (const [k, v] of Object.entries(siteStyle)) {
          if (k.startsWith("--")) {
            viewport.style.setProperty(k, String(v));
          } else {
            /** @type {any} */ (viewport.style)[k] = v;
          }
        }
      }
    }
    if (editSurface) {
      if (siteStyle && typeof siteStyle === "object") {
        for (const [k, v] of Object.entries(siteStyle)) {
          if (k.startsWith("--")) {
            /** @type {any} */ (editSurface).style.setProperty(k, String(v));
          } else {
            /** @type {any} */ (editSurface.style)[k] = v;
          }
        }
      }
    }
    if (siteStyle && typeof siteStyle === "object") {
      for (const [k, v] of Object.entries(siteStyle)) {
        if (!k.startsWith("--")) {
          /** @type {any} */ (canvasEl.style)[k] = v;
        }
      }
    }

    // Inject site-level $media so runtime can resolve media queries in styles
    renderDoc.$media = getEffectiveMedia(renderDoc.$media);

    // Inject $head elements (link/meta/script) into document.head
    const effectiveHead = getEffectiveHead(renderDoc.$head);
    if (effectiveHead.length) {
      for (const entry of effectiveHead) {
        if (!entry?.tagName) continue;
        const tag = entry.tagName.toLowerCase();
        const attrs = { ...entry.attributes };
        const root = projectState?.projectRoot || "";
        for (const key of ["href", "src"]) {
          if (
            attrs[key] &&
            !attrs[key].startsWith("/") &&
            !attrs[key].startsWith(".") &&
            !attrs[key].startsWith("http")
          ) {
            attrs[key] = `/${root}/node_modules/${attrs[key]}`.replace(/\/+/g, "/");
          }
        }
        const selector = `${tag}${attrs.href ? `[href="${attrs.href}"]` : ""}${attrs.src ? `[src="${attrs.src}"]` : ""}`;
        if (selector !== tag && document.head.querySelector(selector)) continue;
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, /** @type {string} */ (v));
        if (entry.textContent) el.textContent = entry.textContent;
        document.head.appendChild(el);
      }
    }

    const $defs = await buildScope(renderDoc, {}, docBase);
    // Bail out if a newer render started while buildScope was running
    if (gen !== view.renderGeneration) return null;
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
          if (view.componentInlineEdit && child === view.componentInlineEdit.el) continue;
          if (editingEl && child === editingEl) continue;
          /** @type {any} */ (child).style.pointerEvents = "none";
        }
      });
    }
    return $defs;
  } catch (/** @type {any} */ err) {
    console.warn("renderCanvasLive failed:", err.message, err);
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

initCssData(webdata);

// Persistent render hosts for lit-html (must be before bootstrap/render)
let zoomIndicatorHost = document.createElement("div");
zoomIndicatorHost.style.display = "contents";
document.body.appendChild(zoomIndicatorHost);

// ─── Module-level UI state (must be before render() call) ─────────────────────

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
({ doc, session } = fromFlat(S));

// ─── Render loop ──────────────────────────────────────────────────────────────

// Mount extracted panel modules
toolbarPanel.mount(toolbarEl, {
  navigateBack: () => navigateBack(),
  closeFunctionEditor: () => closeFunctionEditor(),
  openProject: () => openProject(),
  openFile: () => openFile(),
  saveFile: () => saveFile(),
  parseMediaEntries,
  getCanvasMode: () => canvasMode,
  setCanvasMode: (/** @type {any} */ m) => {
    canvasMode = m;
  },
  renderCanvas: () => renderCanvas(),
  safeRenderRightPanel: () => safeRenderRightPanel(),
});

overlaysPanel.mount({
  effectiveZoom,
  getCanvasMode: () => canvasMode,
  isEditing,
  renderBlockActionBar,
  findCanvasElement,
  getActivePanel,
});

initBlockActionBar({
  getCanvasMode: () => canvasMode,
  findCanvasElement,
  getActivePanel,
  navigateToComponent,
  createFloatingContainer,
});

initComponentInlineEdit({ findCanvasElement });

rightPanelMod.mount({
  navigateToComponent,
  getCanvasMode: () => canvasMode,
  renderCanvas: () => renderCanvas(),
  updateForcedPseudoPreview,
});

leftPanelMod.mount({
  getCanvasMode: () => canvasMode,
  renderImportsTemplate,
  renderFilesTemplate,
  renderSignalsTemplate,
  renderDataExplorerTemplate,
  renderHeadTemplate,
  renderGitPanel,
  renderCanvas: () => renderCanvas(),
  defCategory,
  defBadgeLabel,
  navigateToComponent,
  webdata,
  defaultDef,
  registerLayersDnD,
  registerElementsDnD,
  registerComponentsDnD,
  setupTreeKeyboard,
});

// Register all renderers with the store so render()/renderOnly() work
registerRenderer("toolbar", () => toolbarPanel.render());
registerRenderer("activityBar", () => renderActivityBar(S));
registerRenderer("leftPanel", () => leftPanelMod.render());
registerRenderer("canvas", () => renderCanvas());
registerRenderer("rightPanel", () => rightPanelMod.render());
registerRenderer("overlays", () => overlaysPanel.render());
registerRenderer("statusbar", () => renderStatusbar(S));
setStatusbarRenderer(() => renderStatusbar(S));
mountStatusbar();

function safeRenderLeftPanel() {
  leftPanelMod.render();
}

function safeRenderRightPanel() {
  rightPanelMod.render();
}

// Register the update implementation with the store
setGetStateFn(() => S);
setUpdateFn(function _update(/** @type {any} */ newState) {
  const prev = S;
  const prevDoc = S.document;
  const prevSel = S.selection;
  S = newState;

  // Keep doc/session slices in sync with flat S
  ({ doc, session } = fromFlat(S));

  const docChanged = prevDoc !== S.document;
  const selChanged = !pathsEqual(prevSel, S.selection);
  const modeChanged = prev.mode !== S.mode;
  const uiChanged = prev.ui !== S.ui;

  const canvasUiChanged =
    uiChanged &&
    (prev.ui?.editingFunction !== S.ui?.editingFunction ||
      prev.ui?.settingsTab !== S.ui?.settingsTab ||
      prev.ui?.stylebookTab !== S.ui?.stylebookTab ||
      prev.ui?.stylebookFilter !== S.ui?.stylebookFilter ||
      prev.ui?.stylebookCustomizedOnly !== S.ui?.stylebookCustomizedOnly ||
      prev.ui?.featureToggles !== S.ui?.featureToggles);
  const leftUiChanged =
    uiChanged && (prev.ui?.leftTab !== S.ui?.leftTab || prev.ui?.settingsTab !== S.ui?.settingsTab);

  if (docChanged || modeChanged || canvasUiChanged) {
    try {
      renderCanvas();
    } catch (e) {
      console.error("renderCanvas error:", e);
    }
    safeRenderLeftPanel();
  } else if (selChanged || leftUiChanged) {
    safeRenderLeftPanel();
  }

  if (uiChanged && prev.ui?.activeMedia !== S.ui?.activeMedia) {
    updateActivePanelHeaders();
  }

  runPostRenderHooks(prevDoc, prevSel);
  runUpdateMiddleware(S);

  notify({
    doc: docChanged,
    selection: selChanged,
    hover: false,
    ui: uiChanged,
    mode: modeChanged,
  });
});

// Register session dispatch — lightweight path for selection/hover/ui changes
setGetDocFn(() => doc);
setGetSessionFn(() => session);
setUpdateSessionFn(function _updateSession(/** @type {any} */ patch) {
  const prev = session;
  session = { ...session, ...patch };
  if (patch.ui) {
    session.ui = { ...prev.ui, ...patch.ui };
  }
  S = toFlat(doc, session);

  const selChanged = !pathsEqual(prev.selection, session.selection);
  const uiChanged = prev.ui !== session.ui;

  const canvasUiChanged =
    uiChanged &&
    (prev.ui?.editingFunction !== session.ui?.editingFunction ||
      prev.ui?.settingsTab !== session.ui?.settingsTab ||
      prev.ui?.stylebookTab !== session.ui?.stylebookTab ||
      prev.ui?.stylebookFilter !== session.ui?.stylebookFilter ||
      prev.ui?.stylebookCustomizedOnly !== session.ui?.stylebookCustomizedOnly ||
      prev.ui?.featureToggles !== session.ui?.featureToggles);
  const leftUiChanged =
    uiChanged &&
    (prev.ui?.leftTab !== session.ui?.leftTab || prev.ui?.settingsTab !== session.ui?.settingsTab);

  if (canvasUiChanged) {
    try {
      renderCanvas();
    } catch (e) {
      console.error("renderCanvas error:", e);
    }
    safeRenderLeftPanel();
  } else if (selChanged || leftUiChanged) {
    safeRenderLeftPanel();
  }

  if (uiChanged && prev.ui?.activeMedia !== session.ui?.activeMedia) {
    updateActivePanelHeaders();
  }

  runPostRenderHooks(doc.document, prev.selection);

  const hoverChanged = prev.hover !== session.hover;
  notify({ doc: false, selection: selChanged, hover: hoverChanged, ui: uiChanged, mode: false });
});

// Register post-render hook for pseudo-state preview
addPostRenderHook(() => updateForcedPseudoPreview());

// Register post-render hook for pending inline edit
addPostRenderHook((/** @type {any} */ prevDoc) => {
  if (view.pendingInlineEdit && prevDoc === S.document) {
    const { path, mediaName: mn } = view.pendingInlineEdit;
    view.pendingInlineEdit = null;
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
  const isAbsPath =
    _openParam.startsWith("/") || _openParam.startsWith("~") || /^[A-Za-z]:[/\\]/.test(_openParam);
  if (!isAbsPath) {
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
          // Set PAL project root to absolute path so file ops work
          if (siteCtx.sitePath) {
            platform.projectRoot = siteCtx.sitePath;
            // Await activation so the server resolves project-relative static files
            if (platform.activate) await platform.activate();
          }

          setProjectState({
            root: siteCtx.sitePath,
            name: siteCtx.projectConfig?.name || "Project",
            projectRoot: siteCtx.sitePath,
            isSiteProject: true,
            projectConfig: siteCtx.projectConfig,
            projectDirs: [],
            dirs: new Map(),
            expanded: new Set(),
            selectedPath: siteCtx.fileRelPath || null,
            searchQuery: "",
          });

          await loadComponentRegistry();

          // Load directory tree and populate projectDirs from conventional dirs found
          const conventionalDirs = [
            "pages",
            "layouts",
            "components",
            "content",
            "data",
            "public",
            "styles",
          ];
          const dirEntries = await platform.listDirectory(".");
          projectState.dirs.set(".", dirEntries);
          const foundDirs = [];
          for (const e of dirEntries) {
            if (e.type === "directory" && conventionalDirs.includes(e.name)) {
              foundDirs.push(e.name);
              projectState.expanded.add(e.path || e.name);
              const sub = await platform.listDirectory(e.path || e.name);
              projectState.dirs.set(e.path || e.name, sub);
            }
          }
          projectState.projectDirs = foundDirs;
        }

        // Read and open the file
        const fileRelPath = siteCtx.fileRelPath || _openParam;
        const content = await platform.readFile(fileRelPath);
        if (content) {
          const parsed = JSON.parse(content);
          S = createState(parsed);
          S.dirty = false;
          S.documentPath = fileRelPath;
          S.ui = { ...S.ui, leftTab: "files" };
          ({ doc, session } = fromFlat(S));
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
  loadProject();
  render();
}

// ─── Media helpers ────────────────────────────────────────────────────────────

/**
 * After a runtime render, apply active media overrides as inline styles so they beat the base
 * inline styles the runtime already set. The runtime uses @media CSS rules for overrides, but those
 * can never beat inline base styles.
 *
 * @param {Element} canvasEl
 * @param {Set<string>} activeBreakpoints
 */
function applyCanvasMediaOverrides(canvasEl, activeBreakpoints) {
  if (!activeBreakpoints.size) return;
  const docMedia = getEffectiveMedia(S.document.$media || {});
  const validBreakpoints = new Set();
  for (const name of activeBreakpoints) {
    if (docMedia[name]) validBreakpoints.add(name);
  }
  const overrides = collectMediaOverrides(document.styleSheets, validBreakpoints);
  applyOverridesToCanvas(canvasEl, overrides);
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

function renderCanvas() {
  // Advance render generation so stale async renders from the previous cycle bail out
  ++view.renderGeneration;

  // Always clear Lit's internal state so it builds fresh DOM. Stale async
  // renderCanvasLive calls from a previous cycle can corrupt nested ChildPart
  // markers (Comment nodes inside panzoom-wrap) in ways the root-only
  // ensureLitState check cannot detect.
  // @ts-ignore
  if (canvasWrap["_$litPart$"]) {
    canvasWrap.textContent = "";
    // @ts-ignore
    delete canvasWrap["_$litPart$"];
  }

  // Function editor mode: editing a function body in Monaco (JS)
  if (S.ui.editingFunction) {
    renderFunctionEditor();
    return;
  }

  // Dispose function editor if switching away
  if (view.functionEditor) {
    view.functionEditor.dispose();
    view.functionEditor = null;
  }

  // Source mode: update existing Monaco editor without recreating
  if (canvasMode === "source" && view.monacoEditor) {
    const jsonStr = JSON.stringify(S.document, null, 2);
    const currentVal = view.monacoEditor.getValue();
    if (currentVal !== jsonStr) {
      // Prevent triggering the onChange handler for this programmatic update
      view.monacoEditor._ignoreNextChange = true;
      view.monacoEditor.setValue(jsonStr);
    }
    return;
  }

  // Detect whether this is a mode transition or a content-only re-render
  const modeChanged = canvasMode !== view.prevCanvasMode;
  view.prevCanvasMode = canvasMode;

  // DnD handlers are registered on inner canvas elements that get replaced on every
  // content render, so always clean them up.
  for (const fn of view.canvasDndCleanups) fn();
  view.canvasDndCleanups = [];

  // Panel event handlers (click, dblclick, etc.) capture closures over panel references.
  // Always re-register to keep closures fresh across document switches.
  for (const fn of view.canvasEventCleanups) fn();
  view.canvasEventCleanups = [];

  // Panel JS objects are cheap — always clear and repopulate from templates.
  // The actual DOM elements are preserved by Lit's diffing on content-only re-renders.
  canvasPanels.length = 0;

  if (modeChanged) {
    // Full teardown on mode transitions — new panel structure needed
    if (view.centerObserver) {
      view.centerObserver.disconnect();
      view.centerObserver = null;
    }

    // Dispose Monaco editor if switching away from source mode
    if (view.monacoEditor) {
      view.monacoEditor.dispose();
      view.monacoEditor = null;
    }

    litRender(nothing, canvasWrap);
    view.panzoomWrap = null;
    // Reset inline style overrides from other modes
    canvasWrap.style.padding = "";
    canvasWrap.style.alignItems = "";
    canvasWrap.style.display = "";
    canvasWrap.style.overflow = "";
    canvasWrap.style.overflow = "";

    // Clear zoom indicator (only re-rendered by design/preview/stylebook)
    try {
      litRender(nothing, zoomIndicatorHost);
    } catch {
      const newHost = document.createElement("div");
      newHost.style.display = "contents";
      zoomIndicatorHost.replaceWith(newHost);
      zoomIndicatorHost = newHost;
    }

    // Dismiss open popovers/toolbars that are no longer relevant
    if (view.blockActionBarEl) litRender(nothing, view.blockActionBarEl);
    dismissLinkPopover();
    dismissContextMenu();
    sharedDismissSlashMenu();
  }

  // Manage mode: project-level file browser table
  if (canvasMode === "manage") {
    canvasWrap.style.padding = "0";
    canvasWrap.style.overflow = "auto";
    renderBrowse(canvasWrap, {
      openFile: (/** @type {string} */ path) => {
        canvasMode = "edit";
        openFileFromTree(path);
      },
    });
    return;
  }

  // Settings mode: render element catalog with panzoom surface
  if (canvasMode === "settings") {
    renderStylebookMode({
      canvasPanelTemplate,
      applyTransform,
      observeCenterUntilStable,
      renderZoomIndicator,
      updateActivePanelHeaders,
      overlayBoxDescriptor,
      effectiveZoom,
    });
    return;
  }

  // Source mode: create Monaco editor instead of canvas
  if (canvasMode === "source") {
    canvasWrap.style.padding = "0";
    canvasWrap.style.display = "block";
    /** @type {HTMLDivElement | null} */
    let editorContainer = null;
    litRender(
      html`<div class="source-wrap">
        <div class="source-toolbar">
          <sp-action-button size="s" @click=${exportFile}>
            <sp-icon-export slot="icon"></sp-icon-export>
            Export
          </sp-action-button>
        </div>
        <div
          class="source-editor"
          ${ref((el) => {
            if (el) editorContainer = /** @type {HTMLDivElement} */ (el);
          })}
        ></div>
      </div>`,
      canvasWrap,
    );

    const jsonStr = JSON.stringify(S.document, null, 2);
    view.monacoEditor = monaco.editor.create(/** @type {any} */ (editorContainer), {
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
    view.monacoEditor.onDidChangeModelContent(() => {
      if (view.monacoEditor._ignoreNextChange) {
        view.monacoEditor._ignoreNextChange = false;
        return;
      }
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        try {
          const parsed = JSON.parse(view.monacoEditor.getValue());
          update({ ...S, document: parsed, dirty: true });
        } catch {
          // Invalid JSON — don't update state
        }
      }, 600);
    });
    return;
  }

  // Edit (content) mode — centered column, no panzoom, always 100%
  if (canvasMode === "edit") {
    if (modeChanged) {
      canvasWrap.style.padding = "0";
      canvasWrap.style.overflow = "hidden";

      // Remove zoom indicator left over from design/preview mode
      try {
        litRender(nothing, zoomIndicatorHost);
      } catch {
        const newHost = document.createElement("div");
        newHost.style.display = "contents";
        zoomIndicatorHost.replaceWith(newHost);
        zoomIndicatorHost = newHost;
      }
    }

    const { tpl: panelTpl, panel } = canvasPanelTemplate(null, null, true);
    const editTpl = html`
      <div class="content-edit-canvas">
        <div class="content-edit-column">${panelTpl}</div>
      </div>
    `;
    litRender(editTpl, canvasWrap);
    canvasPanels.push(panel);
    renderCanvasIntoPanel(panel, new Set(), S.ui.featureToggles);
    return;
  }

  // Normal canvas mode (design / preview) — set up panzoom surface
  if (modeChanged) {
    canvasWrap.style.padding = "0";
    canvasWrap.style.overflow = "hidden";
  }

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
            if (el) view.panzoomWrap = /** @type {HTMLDivElement} */ (el);
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
    if (modeChanged) {
      observeCenterUntilStable();
    }
    renderZoomIndicator();
    return;
  }

  // Build all panels: base first, then breakpoints in declared order (ascending for min-width,
  // descending for max-width — matching the direction of the design's media queries).
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
          if (el) view.panzoomWrap = /** @type {HTMLDivElement} */ (el);
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
  if (modeChanged) {
    observeCenterUntilStable();
  }

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
  const gen = view.renderGeneration;
  renderCanvasLive(gen, S.document, panel.canvas).then((scope) => {
    // Skip post-render setup if a newer render has started
    if (gen !== view.renderGeneration) return;
    if (scope) {
      view.liveScope = scope;
      applyCanvasMediaOverrides(panel.canvas, activeBreakpoints);
      statusMessage("Runtime render OK", 1500);
    } else {
      // Fallback to structural preview
      renderCanvasNode(S.document, [], panel.canvas, activeBreakpoints, featureToggles);
    }
    registerPanelDnD(panel);
    registerPanelEvents(panel);
    renderOverlays();

    // Process pending inline edit now that the canvas is populated
    if (view.pendingInlineEdit) {
      const { path, mediaName: mn } = view.pendingInlineEdit;
      view.pendingInlineEdit = null;
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
                updateUi("activeMedia", mediaName === "base" ? null : mediaName);
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
  if (!view.panzoomWrap) return;
  const wrapWidth = canvasWrap.clientWidth;
  const wrapHeight = canvasWrap.clientHeight;
  const contentWidth = view.panzoomWrap.scrollWidth;
  const contentHeight = view.panzoomWrap.scrollHeight;
  const scaledWidth = contentWidth * S.ui.zoom;
  const scaledHeight = contentHeight * S.ui.zoom;
  view.panX = Math.max(16, (wrapWidth - scaledWidth) / 2);
  // Center vertically only when content fits; top-align with margin when taller
  const verticalCenter = (wrapHeight - scaledHeight) / 2;
  view.panY = verticalCenter > 16 ? verticalCenter : 16;
}

/**
 * Attach a ResizeObserver to view.panzoomWrap that re-centers until the user pans. Handles async
 * content (runtime rendering, data fetching) that changes layout after initial paint.
 */
function observeCenterUntilStable() {
  if (view.centerObserver) {
    view.centerObserver.disconnect();
    view.centerObserver = null;
  }
  if (!view.panzoomWrap) return;
  view.needsCenter = true;
  view.centerObserver = new ResizeObserver(() => {
    if (!view.needsCenter) {
      view.centerObserver?.disconnect();
      view.centerObserver = null;
      return;
    }
    centerCanvas();
    applyTransform();
  });
  view.centerObserver.observe(view.panzoomWrap);
  // Also center immediately for synchronous content
  centerCanvas();
}

/** Apply the current zoom + pan transform to the panzoom wrapper. */
function applyTransform() {
  if (!view.panzoomWrap) return;
  view.panzoomWrap.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${S.ui.zoom})`;
  const label = document.querySelector(".zoom-indicator-label");
  if (label) label.textContent = `${Math.round(S.ui.zoom * 100)}%`;
  renderOverlays();
  if (canvasMode === "settings") renderStylebookOverlays();
}

/** Lightweight in-place zoom update — no full re-render. */
function _applyZoom() {
  applyTransform();
}

/** Calculate zoom + pan to fit all panels within the viewport. */
function fitToScreen() {
  if (!view.panzoomWrap) return;
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
  const wrapRect = view.panzoomWrap.getBoundingClientRect();
  const unscaledHeight = wrapRect.height / S.ui.zoom;
  maxPanelHeight = unscaledHeight + padding;

  const fitZoomW = wrapWidth / totalPanelWidth;
  const fitZoomH = wrapHeight / maxPanelHeight;
  const fitZoom = Math.min(5.0, Math.max(0.05, Math.min(fitZoomW, fitZoomH)));

  session = { ...session, ui: { ...session.ui, zoom: fitZoom } };
  S = toFlat(doc, session);
  // Center the content
  const scaledWidth = totalPanelWidth * fitZoom;
  const scaledHeight = maxPanelHeight * fitZoom;
  view.panX = Math.max(0, (wrapWidth - scaledWidth) / 2);
  view.panY = Math.max(0, (wrapHeight - scaledHeight) / 2);
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
    // Lit markers were corrupted — replace the host element to fully reset Lit state
    const newHost = document.createElement("div");
    newHost.style.display = "contents";
    zoomIndicatorHost.replaceWith(newHost);
    zoomIndicatorHost = newHost;
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
      view.lastDragInput = location.current.input;
    },
    onDrop() {
      // Hide all drop lines
      for (const p of canvasPanels) p.dropLine.style.display = "none";
      view.lastDragInput = null;
      for (const el of canvas.querySelectorAll("*")) {
        /** @type {any} */ (el).style.pointerEvents = "none";
      }
      for (const p of canvasPanels) p.overlayClk.style.pointerEvents = "";
    },
  });
  view.canvasDndCleanups.push(monitorCleanup);

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
  overlaysPanel.render();
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

// ── Pseudo-state preview ──────────────────────────────────────────────────────
// When a pseudo-selector (:hover, :focus, etc.) is active in the style sidebar,
// force those styles onto the selected element so the user can see the result.

function updateForcedPseudoPreview() {
  // Clean up previous
  if (view.forcedStyleTag) {
    view.forcedStyleTag.remove();
    view.forcedStyleTag = null;
  }
  if (view.forcedAttrEl) {
    view.forcedAttrEl.removeAttribute("data-studio-forced");
    view.forcedAttrEl = null;
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
  view.forcedAttrEl = el;

  const tag = document.createElement("style");
  tag.textContent = `[data-studio-forced] { ${cssProps} }`;
  document.head.appendChild(tag);
  view.forcedStyleTag = tag;
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
    if (!el) break;
  }

  // Verify the result: if DOM traversal landed on the wrong element
  // (e.g. a custom element template child instead of the intended node),
  // fall back to scanning elToPath.
  if (el) {
    const elPath = elToPath.get(el);
    if (elPath && pathsEqual(elPath, path)) return el;
    // el has no path or wrong path — it's a template element, not the target
  }

  // Fall back: scan all descendants for an element with matching elToPath
  for (const candidate of canvasEl.querySelectorAll("*")) {
    const p = elToPath.get(candidate);
    if (p && pathsEqual(p, path)) return candidate;
  }
  return null;
}

// ─── Per-panel click-to-select ────────────────────────────────────────────────

/** @param {any} panel */
function registerPanelEvents(panel) {
  const { canvas, overlayClk, mediaName } = panel;
  const ac = new AbortController();
  const opts = { signal: ac.signal };
  view.canvasEventCleanups.push(() => ac.abort());

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

  overlayClk.addEventListener(
    "click",
    (/** @type {any} */ e) => {
      // Don't intercept clicks meant for the block action bar
      const barInner = view.blockActionBarEl?.firstElementChild;
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

      const elements = withPanelPointerEvents(() =>
        document.elementsFromPoint(e.clientX, e.clientY),
      );

      for (const el of elements) {
        if (canvas.contains(el) && el !== canvas) {
          const originalPath = elToPath.get(el);
          if (originalPath) {
            let path = bubbleInlinePath(S.document, originalPath);
            const newMedia = mediaName === "base" ? null : (mediaName ?? null);
            const withMedia = { ...S, ui: { ...S.ui, activeMedia: newMedia } };

            // Find the DOM element for the bubbled path (may differ from hit element)
            // When path didn't change (no inline bubbling), prefer the hit element directly
            // since findCanvasElement can't navigate into custom element template DOM.
            const resolvedEl = path === originalPath ? el : findCanvasElement(path, canvas) || el;

            // Re-click on selected editable block: enter inline editing
            // Edit mode / content mode → rich text editing (enterInlineEdit)
            // Design mode → plaintext component editing (enterComponentInlineEdit via view.pendingInlineEdit)
            if (
              pathsEqual(path, S.selection) &&
              isEditableBlock(resolvedEl) &&
              (canvasMode === "edit" || S.mode === "content")
            ) {
              S = withMedia;
              enterInlineEdit(resolvedEl, path);
              return;
            }

            // Design mode or first click: select and schedule component inline editing
            if (canvasMode === "design" && S.mode !== "content") {
              view.pendingInlineEdit = { path, mediaName };
              update(selectNode(withMedia, path));
              return;
            }

            update(selectNode(withMedia, path));
            return;
          }
        }
      }
      update(selectNode(S, null));
    },
    opts,
  );

  // Double-click shortcut for immediate inline editing
  overlayClk.addEventListener(
    "dblclick",
    (/** @type {any} */ e) => {
      const barInner = view.blockActionBarEl?.firstElementChild;
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

      const elements = withPanelPointerEvents(() =>
        document.elementsFromPoint(e.clientX, e.clientY),
      );

      for (const el of elements) {
        if (canvas.contains(el) && el !== canvas) {
          const originalPath = elToPath.get(el);
          if (originalPath) {
            const path = bubbleInlinePath(S.document, originalPath);
            const resolvedEl = path === originalPath ? el : findCanvasElement(path, canvas) || el;
            if (isEditableBlock(resolvedEl)) {
              const newMedia = mediaName === "base" ? null : (mediaName ?? null);
              const withMedia = { ...S, ui: { ...S.ui, activeMedia: newMedia } };
              update(selectNode(withMedia, path));
              enterInlineEdit(resolvedEl, path);
              return;
            }
          }
        }
      }
    },
    opts,
  );

  overlayClk.addEventListener(
    "contextmenu",
    (/** @type {any} */ e) => {
      const barInner = view.blockActionBarEl?.firstElementChild;
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
      const elements = withPanelPointerEvents(() =>
        document.elementsFromPoint(e.clientX, e.clientY),
      );
      for (const el of elements) {
        if (canvas.contains(el) && el !== canvas) {
          let path = elToPath.get(el);
          if (path) {
            path = bubbleInlinePath(S.document, path);
            showContextMenu(e, path, S, { onEditComponent: navigateToComponent });
            return;
          }
        }
      }
      e.preventDefault();
    },
    opts,
  );

  overlayClk.addEventListener(
    "mousemove",
    (/** @type {any} */ e) => {
      const barInner = view.blockActionBarEl?.firstElementChild;
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
    },
    opts,
  );

  overlayClk.addEventListener(
    "mouseleave",
    () => {
      if (S.hover) {
        S = hoverNode(S, null);
        renderOverlays();
      }
    },
    opts,
  );

  // Mount insertion helper — positioned via CSS Anchor Positioning
  insertionHelper.mount({
    getState: () => S,
    update,
    getCanvasMode: () => canvasMode,
    withPanelPointerEvents,
    effectiveZoom,
    defaultDef,
    insertNode,
    selectNode,
    parentElementPath,
    childIndex,
    getNodeAtPath,
    elToPath,
    panel,
  });
  view.canvasEventCleanups.push(() => insertionHelper.unmount());
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

    onInsert(/** @type {any} */ afterPath, /** @type {any} */ cmd, /** @type {any} */ commitData) {
      // cmd comes from the shared slash menu: { label, tag, description }
      const isEmpty =
        !commitData ||
        (commitData.textContent != null && commitData.textContent.trim() === "") ||
        (commitData.children &&
          (commitData.children.length === 0 ||
            (commitData.children.length === 1 &&
              typeof commitData.children[0] === "string" &&
              commitData.children[0].trim() === "") ||
            (commitData.children.length === 1 &&
              typeof commitData.children[0] === "object" &&
              commitData.children[0]?.tagName === "br")));

      // If the element is empty, swap its tagName instead of inserting after
      if (isEmpty) {
        let s = S;
        s = updateProperty(s, afterPath, "tagName", cmd.tag);
        s = updateProperty(s, afterPath, "children", undefined);
        const def = defaultDef(cmd.tag);
        if (def.textContent && def.textContent !== "Paragraph text") {
          s = updateProperty(s, afterPath, "textContent", def.textContent);
        } else {
          s = updateProperty(s, afterPath, "textContent", undefined);
        }
        s = selectNode(s, afterPath);
        update(s);

        requestAnimationFrame(() => {
          const activePanel = getActivePanel();
          if (activePanel) {
            const el = findCanvasElement(afterPath, activePanel.canvas);
            if (el && isEditableBlock(el)) {
              enterInlineEdit(el, afterPath);
            }
          }
        });
        return;
      }

      const elementDef = defaultDef(cmd.tag);
      const parentPath = /** @type {any} */ (parentElementPath(afterPath));
      const idx = /** @type {number} */ (childIndex(afterPath));

      // Apply pending commit from inline edit first (batched to avoid double render)
      let s = S;
      if (commitData) {
        if (commitData.children) {
          s = updateProperty(s, afterPath, "textContent", undefined);
          s = updateProperty(s, afterPath, "children", commitData.children);
        } else if (commitData.textContent != null) {
          s = updateProperty(s, afterPath, "children", undefined);
          s = updateProperty(s, afterPath, "textContent", commitData.textContent);
        }
      }

      s = insertNode(s, parentPath, idx + 1, structuredClone(elementDef));
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
      if (view.inlineEditCleanup) {
        view.inlineEditCleanup();
        view.inlineEditCleanup = null;
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
  view.inlineEditCleanup = inlineEditCleanup;
}

// ─── Left panel: delegated to panels/left-panel.js ───────────────────────────

function renderLeftPanel() {
  leftPanelMod.render();
}

// ─── DnD registration: delegated to panels/dnd.js ───────────────────────────

// ─── Stylebook ───────────────────────────────────────────────────────────────
// Extracted to panels/stylebook-panel.js

// ─── Inspector ────────────────────────────────────────────────────────────────
// Extracted to panels/properties-panel.js

// ─── Style Sidebar (metadata-driven) ───────────────────────────────────────────

// UNIT_RE — imported from ui/unit-selector.js

// inferInputType — imported from studio-utils.js

// ─── Style panel ────────────────────────────────────────────────────────────
// Extracted to panels/style-utils.js, panels/style-inputs.js, panels/style-panel.js

// ─── Source/Function editors: delegated to panels/editors.js ─────────────────

// ─── Toolbar (delegated to panels/toolbar.js) ────────────────────────────────

function renderToolbar() {
  toolbarPanel.render();
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
async function loadMarkdown(/** @type {any} */ source, /** @type {any} */ fileHandle) {
  const ns = await _loadMarkdown(source, fileHandle);
  S = ns;
}
function saveFile() {
  return _saveFile(fileOpsCtx());
}
function exportFile() {
  return _exportFile(fileOpsCtx());
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
      get S() {
        return S;
      },
      set S(v) {
        S = v;
      },
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
  panX: view.panX,
  panY: view.panY,
  setPan: (x, y) => {
    view.panX = x;
    view.panY = y;
    view.needsCenter = false;
  },
  applyTransform,
  positionZoomIndicator,
  componentInlineEdit: view.componentInlineEdit,
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
const AUTO_SAVE_DELAY = 2000;

function scheduleAutosave() {
  if (!S.fileHandle || !S.dirty) return;
  clearTimeout(view.autosaveTimer);
  view.autosaveTimer = setTimeout(async () => {
    if (S.fileHandle && S.dirty && "createWritable" in S.fileHandle) {
      try {
        const writable = await S.fileHandle.createWritable();
        await writable.write(JSON.stringify(S.document, null, 2));
        await writable.close();
        update({ ...S, dirty: false });
        statusMessage("Auto-saved");
      } catch {}
    }
  }, AUTO_SAVE_DELAY);
}

addUpdateMiddleware((/** @type {any} */ state) => {
  if (state.dirty) scheduleAutosave();
});
