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
  removeNode,
  moveNode,
  updateProperty,
  updateStyle,
  updateAttribute,
  updateDef,
  updateMedia,
  pushDocument,
  popDocument,
  updateProp,
  addSwitchCase,
  removeSwitchCase,
  renameSwitchCase,
  applyMutation,
  getNodeAtPath,
  nodeLabel,
  pathsEqual,
  parentElementPath,
  childIndex,
  isAncestor,
  canvasWrap,
  leftPanel,
  toolbarEl,
  elToPath,
  canvasPanels,
  VOID_ELEMENTS,
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
  notify,
  projectState,
  setProjectState,
  updateFrontmatter,
  updateUi,
  updateSession,
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
  getInlineActions,
} from "./editor/inline-edit.js";
import {
  showSlashMenu as sharedShowSlashMenu,
  dismissSlashMenu as sharedDismissSlashMenu,
  isSlashMenuOpen,
} from "./editor/slash-menu.js";
import { toggleInlineFormat, isTagActiveInSelection } from "./editor/inline-format.js";
import {
  camelToLabel,
  attrLabel,
  inferInputType,
  findCollectionSchema,
  friendlyNameToVar,
  varDisplayName,
  parseCemType,
} from "./utils/studio-utils.js";
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
import { codeService, setLintMarkers, getFunctionArgs } from "./services/code-services.js";
import {
  getEffectiveMedia,
  getEffectiveStyle,
  getEffectiveImports,
  getEffectiveElements,
  getEffectiveHead,
} from "./site-context.js";
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
import { ref } from "lit-html/directives/ref.js";
import { styleMap } from "lit-html/directives/style-map.js";
import { ifDefined } from "lit-html/directives/if-defined.js";

import webdata from "../data/webdata.json";
import htmlMeta from "../data/html-meta.json";
import stylebookMeta from "../data/stylebook-meta.json";
import { renderDataExplorerTemplate } from "./panels/data-explorer.js";
import { renderGitPanel } from "./panels/git-panel.js";

// ─── Spectrum Web Components ──────────────────────────────────────────────────
// Explicit class imports + registration — bare side-effect imports are tree-shaken
// by Bun's bundler despite sideEffects declarations in Spectrum's package.json.
import { components as _swc } from "./ui/spectrum.js"; // eslint-disable-line no-unused-vars
import { renderFieldRow } from "./ui/field-row.js";
import "./ui/panel-resize.js";
import { showContextMenu, dismissContextMenu } from "./editor/context-menu.js";
import { convertToComponent } from "./editor/convert-to-component.js";
import { initShortcuts } from "./editor/shortcuts.js";
import * as insertionHelper from "./editor/insertion-helper.js";
import { renderActivityBar } from "./panels/activity-bar.js";
import { renderBrowse } from "./browse/browse.js";
import { renderCollectionsEditor } from "./settings/collections-editor.js";
import { renderDefsEditor } from "./settings/defs-editor.js";
import * as toolbarPanel from "./panels/toolbar.js";
import * as overlaysPanel from "./panels/overlays.js";
import * as rightPanelMod from "./panels/right-panel.js";
import * as leftPanelMod from "./panels/left-panel.js";
import { mediaDisplayName } from "./panels/shared.js";
import { initCssData, getCssInitialMap } from "./panels/style-utils.js";
import { widgetForType } from "./panels/style-inputs.js";
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

  // Mark empty elements with placeholder classes for design-mode visibility
  if (out.tagName && !out.textContent && !out.innerHTML) {
    const hasChildren = Array.isArray(out.children) && out.children.length > 0;
    if (!hasChildren) {
      const tag = out.tagName;
      const textTags = new Set([
        "p",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "blockquote",
        "li",
        "dt",
        "dd",
        "th",
        "td",
        "span",
        "strong",
        "em",
        "small",
        "mark",
        "code",
        "abbr",
        "q",
        "sub",
        "sup",
        "time",
        "a",
        "button",
        "label",
        "legend",
        "caption",
        "summary",
        "pre",
        "option",
      ]);
      const containerTags = new Set([
        "div",
        "section",
        "article",
        "aside",
        "header",
        "footer",
        "main",
        "nav",
        "figure",
        "figcaption",
        "details",
        "fieldset",
        "form",
        "ul",
        "ol",
        "dl",
        "table",
      ]);
      if (textTags.has(tag)) {
        out.className = out.className
          ? out.className + " empty-text-placeholder"
          : "empty-text-placeholder";
      } else if (containerTags.has(tag)) {
        out.className = out.className
          ? out.className + " empty-container-placeholder"
          : "empty-container-placeholder";
      }
    }
  }

  return out;
}

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

rightPanelMod.mount({
  propertiesSidebarTemplate,
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
  selectStylebookTag,
  stylebookMeta,
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
    renderSettings();
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

/** Saved selection range for format button mousedown→click flow */
function captureSelectionRange() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) view.savedRange = sel.getRangeAt(0).cloneRange();
}

/**
 * @param {any} e
 * @param {any} action
 */
function onFormatClick(e, action) {
  e.stopPropagation();
  if (action.command === "link") {
    showLinkPopover(e.target.closest("sp-action-button"));
  } else if (view.savedRange) {
    const sel = /** @type {any} */ (window.getSelection());
    const anchor = view.savedRange.startContainer;
    const editableRoot = (
      anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement
    )?.closest("[contenteditable]");
    if (editableRoot) {
      editableRoot.focus();
      sel.removeAllRanges();
      sel.addRange(view.savedRange);
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
view.linkPopoverHost = document.createElement("div");
view.linkPopoverHost.style.display = "contents";
(document.querySelector("sp-theme") || document.body).appendChild(view.linkPopoverHost);

/** Dismiss the link popover if open. */
function dismissLinkPopover() {
  if (view.linkPopoverHost) litRender(nothing, view.linkPopoverHost);
}

/** @param {any} anchorBtn */
function showLinkPopover(anchorBtn) {
  // Dismiss existing
  litRender(nothing, view.linkPopoverHost);

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
    const field = view.linkPopoverHost.querySelector("sp-textfield");
    const url = /** @type {any} */ (field)?.value;
    if (existingLink) {
      existingLink.setAttribute("href", url);
    } else if (url) {
      document.execCommand("createLink", false, url);
    }
    litRender(nothing, view.linkPopoverHost);
    renderBlockActionBar();
  };

  const onRemove = () => {
    const frag = document.createDocumentFragment();
    while (existingLink.firstChild) frag.appendChild(existingLink.firstChild);
    existingLink.parentNode.replaceChild(frag, existingLink);
    litRender(nothing, view.linkPopoverHost);
    renderBlockActionBar();
  };

  const onKeydown = (/** @type {any} */ e) => {
    if (e.key === "Enter") onApply();
    else if (e.key === "Escape") {
      litRender(nothing, view.linkPopoverHost);
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
    view.linkPopoverHost,
  );

  requestAnimationFrame(
    () =>
      /** @type {HTMLElement | null} */ (
        view.linkPopoverHost?.querySelector("sp-textfield")
      )?.focus(),
  );
}

/** Move the selected node up (swap with previous sibling). */
function moveSelectionUp() {
  if (!S.selection || S.selection.length < 2) return;
  const idx = /** @type {number} */ (childIndex(S.selection));
  if (idx <= 0) return;
  const pPath = /** @type {any} */ (parentElementPath(S.selection));
  update(moveNode(S, S.selection, pPath, idx - 1));
  session = { ...session, selection: [...pPath, "children", idx - 1] };
  S = toFlat(doc, session);
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
  session = { ...session, selection: [...pPath, "children", idx + 1] };
  S = toFlat(doc, session);
  renderOverlays();
}

/**
 * Render the unified block action bar above the selected element. Combines tag indicator, drag
 * handle, move arrows, and inline formatting.
 */
function renderBlockActionBar() {
  // Ensure persistent render container exists
  if (!view.blockActionBarEl) {
    view.blockActionBarEl = createFloatingContainer();
  }

  // Tear down drag if it was active
  if (view.selDragCleanup) {
    view.selDragCleanup();
    view.selDragCleanup = null;
  }

  if (!S.selection || (canvasMode !== "design" && canvasMode !== "edit")) {
    litRender(nothing, view.blockActionBarEl);
    return;
  }

  const activePanel = getActivePanel();
  if (!activePanel) {
    litRender(nothing, view.blockActionBarEl);
    return;
  }
  const el = findCanvasElement(S.selection, activePanel.canvas);
  const node = el && getNodeAtPath(S.document, S.selection);
  if (!el || !node) {
    litRender(nothing, view.blockActionBarEl);
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
        ${S.selection.length >= 2 && node.tagName
          ? (() => {
              const isComp =
                node.tagName.includes("-") &&
                componentRegistry.some((/** @type {any} */ c) => c.tagName === node.tagName);
              if (isComp) {
                const comp = componentRegistry.find(
                  (/** @type {any} */ c) => c.tagName === node.tagName,
                );
                return html`<sp-action-button
                  size="xs"
                  quiet
                  title="Edit Component"
                  @click=${() => navigateToComponent(comp.path)}
                  ><sp-icon-edit slot="icon" size="xs"></sp-icon-edit
                ></sp-action-button>`;
              }
              return html`<sp-action-button
                size="xs"
                quiet
                title="Convert to Component"
                @click=${() => convertToComponent(S)}
                ><sp-icon-box slot="icon" size="xs"></sp-icon-box
              ></sp-action-button>`;
            })()
          : nothing}
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
    view.blockActionBarEl,
  );

  // Post-render side effects
  requestAnimationFrame(() => {
    const bar = view.blockActionBarEl?.firstElementChild;
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
        if (view.selDragCleanup) {
          view.selDragCleanup();
          view.selDragCleanup = null;
        }
        view.selDragCleanup = draggable({
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

// ─── Component-mode inline text editing ──────────────────────────────────────

/**
 * @param {any} el
 * @param {any} path
 */
function enterComponentInlineEdit(el, path) {
  // Already editing this element
  if (view.componentInlineEdit && view.componentInlineEdit.el === el) {
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
  const voids = new Set(["img", "input", "br", "hr", "video", "audio", "source", "embed", "slot"]);
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

  view.componentInlineEdit = {
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
    if (!view.componentInlineEdit) {
      document.removeEventListener("mousedown", outsideHandler, true);
      return;
    }
    if (view.componentInlineEdit.el.contains(evt.target)) return; // click within editing el — let it through
    // Let clicks through when the slash command menu is open
    if (isSlashMenuOpen()) return;
    // Let clicks inside the block action bar through
    if (view.blockActionBarEl && view.blockActionBarEl.contains(evt.target)) return;
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
    const { el: editEl, path: editPath, originalText } = view.componentInlineEdit;
    const newText = (editEl.textContent ?? "").trim();
    cleanupComponentInlineEdit(editEl);

    // If empty, remove the node entirely
    const isEmpty = !newText;
    const pPath = parentElementPath(editPath);

    if (hitPath) {
      const media = hitMedia === "base" ? null : (hitMedia ?? null);
      view.pendingInlineEdit = { path: hitPath, mediaName: hitMedia };
      const withMedia = { ...S, ui: { ...S.ui, activeMedia: media } };
      if (isEmpty && pPath) {
        // Remove empty node; adjust hitPath if it shifts after removal
        let s = removeNode(withMedia, editPath);
        // If hit path is a later sibling in the same parent, adjust index
        const removedIdx = /** @type {number} */ (childIndex(editPath));
        const hitIdx = /** @type {number} */ (childIndex(hitPath));
        const hitParent = parentElementPath(hitPath);
        if (hitParent && pPath && hitParent.join("/") === pPath.join("/") && hitIdx > removedIdx) {
          hitPath = [...pPath, "children", hitIdx - 1];
          view.pendingInlineEdit = { path: hitPath, mediaName: hitMedia };
        }
        update(selectNode(s, hitPath));
      } else if (newText !== originalText) {
        update(
          selectNode(
            updateProperty(withMedia, editPath, "textContent", newText || undefined),
            hitPath,
          ),
        );
      } else {
        update(selectNode(withMedia, hitPath));
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
  view.componentInlineEdit._outsideHandler = outsideHandler;

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
  if (!view.componentInlineEdit) return;
  const { el, path, mediaName } = view.componentInlineEdit;

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

  view.pendingInlineEdit = { path: newPath, mediaName };
  update(s);
}

function _commitComponentInlineEdit() {
  if (!view.componentInlineEdit) return;
  const { el, path, originalText } = view.componentInlineEdit;
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
  if (!view.componentInlineEdit) return;
  const { el } = view.componentInlineEdit;
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
  if (view.componentInlineEdit?._outsideHandler) {
    document.removeEventListener("mousedown", view.componentInlineEdit._outsideHandler, true);
  }
  view.componentInlineEdit = null;

  // Restore overlay and click interceptor
  for (const p of canvasPanels) {
    p.overlay.style.display = "";
    p.overlayClk.style.pointerEvents = "";
  }
}

// ─── Component-mode slash commands (delegates to shared slash-menu.js) ────────

function componentInlineInput() {
  if (!view.componentInlineEdit) return;
  const { el, originalText } = view.componentInlineEdit;
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
  if (!view.componentInlineEdit) return;
  const { el, path, mediaName } = view.componentInlineEdit;
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
  if (hasText) view.pendingInlineEdit = { path: newPath, mediaName };
  update(s);
}

// ─── Left panel: delegated to panels/left-panel.js ───────────────────────────

function renderLeftPanel() {
  leftPanelMod.render();
}

/** Register DnD on layer rows after litRender — called from left-panel.js */
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
              view.layerDragSourceHeight = row.offsetHeight;
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
        view.dndCleanups.push(cleanup);
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
    view.dndCleanups.push(monitorCleanup);
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
        view.dndCleanups.push(cleanup);
      },
    );
  });
}

/** @type {any} */

/**
 * @param {any} rowEl
 * @param {any} data
 * @param {any} container
 */
function showLayerDropGap(rowEl, data, container) {
  const instruction = extractInstruction(data);

  // Clear previous drop-target highlight
  if (view._currentDropTargetRow && view._currentDropTargetRow !== rowEl) {
    view._currentDropTargetRow.classList.remove("drop-target");
  }

  if (!instruction || instruction.type === "instruction-blocked") {
    clearLayerDropGap(container);
    return;
  }

  if (instruction.type === "make-child") {
    clearLayerDropGap(container);
    rowEl.classList.add("drop-target");
    view._currentDropTargetRow = rowEl;
    return;
  }

  rowEl.classList.remove("drop-target");
  view._currentDropTargetRow = rowEl;

  // Shift rows to create gap
  const rows = Array.from(container.querySelectorAll(".layers-tree .layer-row"));
  const targetIdx = rows.indexOf(rowEl);
  const gap = view.layerDragSourceHeight;

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
  if (view._currentDropTargetRow) {
    view._currentDropTargetRow.classList.remove("drop-target");
    view._currentDropTargetRow = null;
  }
  const rows = container.querySelectorAll(".layers-tree .layer-row");
  for (const r of rows) r.style.transform = "";
}

/**
 * Select a tag in the stylebook — shared by layers panel click and canvas click.
 *
 * @param {string} tag
 * @param {string | null} [media]
 */
function selectStylebookTag(tag, media) {
  updateSession({
    selection: [],
    ui: {
      stylebookSelection: tag,
      rightTab: "style",
      activeSelector: `& ${tag}`,
      ...(media !== undefined ? { activeMedia: media } : {}),
    },
  });
  renderStylebookOverlays();
  requestAnimationFrame(() => {
    if (canvasPanels.length > 0) {
      const el = findStylebookEl(canvasPanels[0].canvas, tag);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
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
        if (comp.source === "npm") {
          // npm web component: add cherry-picked subpath specifier
          const specifier = comp.modulePath ? `${comp.package}/${comp.modulePath}` : comp.package;
          const alreadyImported = elements.some(
            (/** @type {any} */ e) => e === specifier || e === comp.package,
          );
          if (!alreadyImported) {
            S = applyMutation(S, (/** @type {any} */ doc) => {
              if (!doc.$elements) doc.$elements = [];
              doc.$elements.push(specifier);
            });
          }
        } else {
          // JX component: add $ref object
          const alreadyImported = elements.some(
            (/** @type {any} */ e) =>
              e.$ref &&
              (e.$ref === `./${comp.path}` || e.$ref.endsWith(comp.path.split("/").pop())),
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
        view.dndCleanups.push(cleanup);
      },
    );
  });
}

// ─── Stylebook ───────────────────────────────────────────────────────────────

/** Map from rendered stylebook DOM elements to their tag names */

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
  try {
    if (comp.source === "npm") {
      // npm components are already imported via $elements — check if registered
      if (!customElements.get(comp.tagName)) {
        throw new Error("not registered");
      }
    } else {
      const root = projectState?.projectRoot;
      const url = `${location.origin}/${root ? root + "/" : ""}${comp.path}`;
      await defineElement(url);
    }
    const el = document.createElement(comp.tagName);
    for (const p of comp.props || []) {
      if (p.default !== undefined && p.default !== "false" && p.default !== "''") {
        const val = String(p.default).replace(/^'|'$/g, "");
        el.setAttribute(p.name, val);
      }
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

function renderSettings() {
  const settingsTab = S.ui.settingsTab || "stylebook";

  // Top-level settings tabs chrome bar
  const settingsChromeBarTpl = html`
    <div
      class="sb-chrome settings-top-chrome"
      style="position:absolute;top:0;left:0;right:0;z-index:16;background:var(--bg-panel);border-bottom:1px solid var(--border)"
    >
      <sp-tabs
        size="s"
        selected=${settingsTab}
        @change=${(/** @type {any} */ e) => {
          updateUi("settingsTab", e.target.selected);
        }}
      >
        <sp-tab label="Stylebook" value="stylebook"></sp-tab>
        <sp-tab label="Definitions" value="definitions"></sp-tab>
        <sp-tab label="Collections" value="collections"></sp-tab>
      </sp-tabs>
    </div>
  `;

  // Non-stylebook tabs: render editor into canvasWrap with offset for chrome bar
  if (settingsTab === "definitions" || settingsTab === "collections") {
    /** @type {any} */ (canvasWrap).style.overflow = "hidden";

    litRender(
      html`${settingsChromeBarTpl}
        <div
          class="settings-editor-container"
          style="position:absolute;inset:40px 0 0 0;overflow:auto"
        ></div>`,
      /** @type {any} */ (canvasWrap),
    );

    const container = /** @type {HTMLElement} */ (
      canvasWrap.querySelector(".settings-editor-container")
    );
    if (settingsTab === "definitions") renderDefsEditor(container);
    else renderCollectionsEditor(container);
    return;
  }

  // Stylebook tab — existing behavior
  view.stylebookElToTag = new WeakMap();
  const rootStyle = getEffectiveStyle(S.document.style);
  const filter = (S.ui.stylebookFilter || "").toLowerCase();
  const customizedOnly = S.ui.stylebookCustomizedOnly;

  const { sizeBreakpoints, baseWidth } = parseMediaEntries(getEffectiveMedia(S.document.$media));
  const hasMedia = sizeBreakpoints.length > 0;

  // Chrome bar (tabs + filter) — positioned absolutely above the panzoom surface
  const onTabClick = (/** @type {string} */ t) => {
    updateUi("stylebookTab", t);
  };

  const onFilterInput = (/** @type {any} */ e) => {
    updateUi("stylebookFilter", e.target.value);
  };

  const onCustomizedToggle = () => {
    updateUi("stylebookCustomizedOnly", !S.ui.stylebookCustomizedOnly);
  };

  const chromeBarTpl = html`
    ${settingsChromeBarTpl}
    <div
      class="sb-chrome"
      style="position:absolute;top:36px;left:0;right:0;z-index:15;background:var(--bg-panel);border-bottom:1px solid var(--border)"
    >
      <sp-tabs
        size="s"
        selected=${S.ui.stylebookTab || "elements"}
        @change=${(/** @type {any} */ e) => {
          onTabClick(e.target.selected);
        }}
      >
        ${["elements", "variables"].map(
          (t) => html`
            <sp-tab label=${t.charAt(0).toUpperCase() + t.slice(1)} value=${t}></sp-tab>
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
        style="transform-origin:0 0;padding-top:72px"
        ${ref((el) => {
          if (el) view.panzoomWrap = /** @type {HTMLDivElement} */ (el);
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
            view.stylebookElToTag.set(card, entry.tag);
            elToPath.set(card, ["__sb", entry.tag]);
            for (const child of el.querySelectorAll("*")) {
              const tag = child.tagName.toLowerCase();
              if (!view.stylebookElToTag.has(child)) {
                view.stylebookElToTag.set(child, tag);
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
              view.stylebookElToTag.set(card, comp.tagName);
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
 * Click handler for stylebook canvas — selects elements via the elToPath/view.stylebookElToTag
 * mapping
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
        const tag = view.stylebookElToTag.get(cur);
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
    updateSession({ ui: { stylebookSelection: null, activeSelector: null } });
    renderStylebookOverlays();
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
        const tag = view.stylebookElToTag.get(cur);
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
    if (view.stylebookElToTag.get(child) === tag) return child;
  }
  return null;
}

// ─── Right panel: Inspector ───────────────────────────────────────────────────

function renderRightPanel() {
  rightPanelMod.render();
}

// ─── Inspector ────────────────────────────────────────────────────────────────

/** Frontmatter-only panel shown in content mode when no element is selected */
function renderFrontmatterOnlyPanel() {
  const fm = S.content?.frontmatter || {};
  const col = findCollectionSchema(S.documentPath, projectState?.projectConfig);
  const schemaProps = col?.schema?.properties;
  const requiredFields = new Set(col?.schema?.required || []);

  /** @type {{ field: string; entry: any; value: any }[]} */
  const fields = [];
  if (schemaProps) {
    for (const [field, fieldSchema] of Object.entries(
      /** @type {Record<string, any>} */ (schemaProps),
    )) {
      fields.push({ field, entry: fieldSchema, value: fm[field] });
    }
    for (const [field, value] of Object.entries(fm)) {
      if (!schemaProps[field]) {
        fields.push({
          field,
          entry: { type: typeof value === "boolean" ? "boolean" : "string" },
          value,
        });
      }
    }
  } else {
    for (const [field, value] of Object.entries(fm)) {
      fields.push({
        field,
        entry: { type: typeof value === "boolean" ? "boolean" : "string" },
        value,
      });
    }
  }

  if (fields.length === 0 && !schemaProps) {
    return html`<div class="empty-state">No frontmatter. Select an element to inspect.</div>`;
  }

  return html`
    <div class="style-sidebar">
      <sp-accordion allow-multiple size="s">
        <sp-accordion-item label=${col ? `Frontmatter (${col.name})` : "Frontmatter"} open>
          <div class="style-section-body">
            ${fields.map((f) => renderFmFieldRow(f.field, f.entry, f.value, requiredFields))}
          </div>
        </sp-accordion-item>
      </sp-accordion>
    </div>
  `;
}

/** Render a single frontmatter field row (shared between both panels) */
function renderFmFieldRow(
  /** @type {string} */ field,
  /** @type {any} */ entry,
  /** @type {any} */ value,
  /** @type {Set<string>} */ requiredFields,
) {
  const isRequired = requiredFields.has(field);
  const label = field.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
  const displayLabel = label + (isRequired ? " *" : "");
  const hasVal = value !== undefined && value !== "" && value !== false;
  const onClear = () => update(updateFrontmatter(S, field, undefined));

  // Boolean → checkbox
  if (entry.type === "boolean") {
    return renderFieldRow({
      prop: field,
      label: displayLabel,
      hasValue: hasVal,
      onClear,
      widget: html`
        <sp-checkbox
          size="s"
          .checked=${live(!!value)}
          @change=${(/** @type {any} */ e) =>
            update(updateFrontmatter(S, field, e.target.checked || undefined))}
        ></sp-checkbox>
      `,
    });
  }

  // Array of strings → comma-separated text
  if (entry.type === "array") {
    const display = Array.isArray(value) ? value.join(", ") : value || "";
    return renderFieldRow({
      prop: field,
      label: displayLabel,
      hasValue: hasVal,
      onClear,
      widget: html`
        <sp-textfield
          size="s"
          placeholder="comma, separated"
          .value=${live(display)}
          @input=${debouncedStyleCommit(`fm:${field}`, 400, (/** @type {any} */ e) => {
            const arr = e.target.value
              ? e.target.value
                  .split(",")
                  .map((/** @type {string} */ s) => s.trim())
                  .filter(Boolean)
              : undefined;
            update(updateFrontmatter(S, field, arr));
          })}
        ></sp-textfield>
      `,
    });
  }

  // Enum → select
  if (Array.isArray(entry.enum)) {
    return renderFieldRow({
      prop: field,
      label: displayLabel,
      hasValue: hasVal,
      onClear,
      widget: html`
        <sp-picker
          size="s"
          .value=${live(value || "")}
          @change=${(/** @type {any} */ e) =>
            update(updateFrontmatter(S, field, e.target.value || undefined))}
        >
          ${entry.enum.map(
            (/** @type {string} */ opt) => html`<sp-menu-item value=${opt}>${opt}</sp-menu-item>`,
          )}
        </sp-picker>
      `,
    });
  }

  // Number
  if (entry.type === "number") {
    return renderFieldRow({
      prop: field,
      label: displayLabel,
      hasValue: hasVal,
      onClear,
      widget: html`
        <sp-number-field
          size="s"
          hide-stepper
          .value=${live(value !== undefined ? Number(value) : undefined)}
          @change=${debouncedStyleCommit(`fm:${field}`, 400, (/** @type {any} */ e) => {
            const v = e.target.value;
            update(updateFrontmatter(S, field, isNaN(v) ? undefined : Number(v)));
          })}
        ></sp-number-field>
      `,
    });
  }

  // Default: text (handles string, date, etc.)
  return renderFieldRow({
    prop: field,
    label: displayLabel,
    hasValue: hasVal,
    onClear,
    widget: html`
      <sp-textfield
        size="s"
        placeholder=${entry.format === "date" ? "YYYY-MM-DD" : ""}
        .value=${live(value || "")}
        @input=${debouncedStyleCommit(`fm:${field}`, 400, (/** @type {any} */ e) => {
          update(updateFrontmatter(S, field, e.target.value || undefined));
        })}
      ></sp-textfield>
    `,
  });
}

/** Properties panel — lit-html template with accordion sections */
function propertiesSidebarTemplate() {
  // In content mode with no selection, still show frontmatter fields
  if (!S.selection) {
    if (S.mode === "content") {
      return renderFrontmatterOnlyPanel();
    }
    return html`<div class="empty-state">Select an element to inspect</div>`;
  }
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
      return renderFieldRow({
        prop: attr,
        label: attrLabel(entry, attr),
        hasValue: hasVal,
        onClear: () => update(updateAttribute(S, path, attr, undefined)),
        widget: html`
          <sp-checkbox
            size="s"
            .checked=${live(!!value)}
            @change=${(/** @type {any} */ e) =>
              update(updateAttribute(S, path, attr, e.target.checked || undefined))}
          >
          </sp-checkbox>
        `,
      });
    }

    return renderFieldRow({
      prop: attr,
      label: attrLabel(entry, attr),
      hasValue: hasVal,
      onClear: () => update(updateAttribute(S, path, attr, undefined)),
      widget: widgetForType(type, entry, attr, value || "", (/** @type {any} */ v) =>
        update(updateAttribute(S, path, attr, v || undefined)),
      ),
    });
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

  // Collect "custom" attributes (not in html-meta and not CEM-defined props)
  const knownAttrNames = new Set(Object.keys(applicableAttrs));
  // For npm web components, CEM-defined props are rendered in "Component Props"
  if (isCustomInstance) {
    const comp = componentRegistry.find((c) => c.tagName === node.tagName);
    if (comp) for (const p of comp.props) knownAttrNames.add(p.name);
  }
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
    updateUi("inspectorSections", { ...S.ui.inspectorSections, [key]: !current });
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

  // ── Frontmatter section (content mode only) ──
  const frontmatterT =
    S.mode === "content"
      ? (() => {
          const fm = S.content?.frontmatter || {};
          const col = findCollectionSchema(S.documentPath, projectState?.projectConfig);
          const schemaProps = col?.schema?.properties;
          const requiredFields = new Set(col?.schema?.required || []);

          /** @type {{ field: string; entry: any; value: any }[]} */
          const fields = [];
          if (schemaProps) {
            for (const [field, fieldSchema] of Object.entries(
              /** @type {Record<string, any>} */ (schemaProps),
            )) {
              fields.push({ field, entry: fieldSchema, value: fm[field] });
            }
            for (const [field, value] of Object.entries(fm)) {
              if (!schemaProps[field]) {
                fields.push({
                  field,
                  entry: { type: typeof value === "boolean" ? "boolean" : "string" },
                  value,
                });
              }
            }
          } else {
            for (const [field, value] of Object.entries(fm)) {
              fields.push({
                field,
                entry: { type: typeof value === "boolean" ? "boolean" : "string" },
                value,
              });
            }
          }

          if (fields.length === 0 && !schemaProps) return nothing;

          return html`
            <sp-accordion-item
              label=${col ? `Frontmatter (${col.name})` : "Frontmatter"}
              ?open=${isSectionOpen("__frontmatter") !== false}
              @sp-accordion-item-toggle=${() => toggleSection("__frontmatter")}
            >
              <div class="style-section-body">
                ${fields.map((f) => renderFmFieldRow(f.field, f.entry, f.value, requiredFields))}
              </div>
            </sp-accordion-item>
          `;
        })()
      : nothing;

  // ── Assemble ──
  const tpl = html`
    <div class="style-sidebar">
      <sp-accordion allow-multiple size="s">
        ${frontmatterT} ${isMapNode ? repeaterT : elemT} ${isMapNode ? nothing : observedAttrsT}
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
  // For npm web components, props map to attributes; for JX components, use $props
  const isNpm = comp.source === "npm";
  const currentVals = isNpm ? node.attributes || {} : node.$props || {};
  const updateFn = isNpm
    ? (/** @type {string} */ name, /** @type {any} */ v) =>
        update(updateAttribute(S, path, name, v === "" ? undefined : v))
    : (/** @type {string} */ name, /** @type {any} */ v) => update(updateProp(S, path, name, v));

  const defs = S.document.state || {};
  const signalDefs = Object.entries(defs).filter(
    ([, d]) => !d.$handler && d.$prototype !== "Function",
  );
  const extraSignals = mapSignals;

  return html`
    ${comp.props.map((/** @type {any} */ prop) => {
      const rawValue = currentVals[prop.name];
      const isBound = typeof rawValue === "object" && rawValue !== null && rawValue.$ref;
      const hasVal = rawValue !== undefined && rawValue !== null;
      const parsed = parseCemType(prop.type);
      const onChange = (/** @type {any} */ v) => updateFn(prop.name, v);

      const clearProp = (/** @type {any} */ e) => {
        e.stopPropagation();
        updateFn(prop.name, undefined);
      };

      const onToggleBind = () => {
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

      // Signal picker for bound mode
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
            ([defName]) =>
              html`<sp-menu-item value=${`#/state/${defName}`}>${defName}</sp-menu-item>`,
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

      // Widget based on CEM type
      /** @type {any} */
      let debounce;
      const staticVal = isBound ? "" : (rawValue ?? "");
      /** @type {any} */
      let widgetTpl;
      if (parsed.kind === "boolean") {
        widgetTpl = html`<sp-checkbox
          size="s"
          .checked=${live(!!staticVal)}
          @change=${(/** @type {any} */ e) => onChange(e.target.checked || undefined)}
        ></sp-checkbox>`;
      } else if (parsed.kind === "number") {
        widgetTpl = html`<sp-number-field
          size="s"
          value=${staticVal}
          @input=${(/** @type {any} */ e) => {
            clearTimeout(debounce);
            debounce = setTimeout(() => onChange(e.target.value), 400);
          }}
        ></sp-number-field>`;
      } else if (parsed.kind === "combobox") {
        const options = /** @type {string[]} */ (/** @type {any} */ (parsed).options);
        widgetTpl = html`<jx-value-selector
          .value=${String(staticVal)}
          size="s"
          placeholder="—"
          .options=${options.map((o) => ({ value: o, label: camelToLabel(o) }))}
          @change=${(/** @type {any} */ e) => onChange(e.detail?.value ?? e.target.value)}
        ></jx-value-selector>`;
      } else {
        widgetTpl = html`<sp-textfield
          size="s"
          value=${staticVal}
          @input=${(/** @type {any} */ e) => {
            clearTimeout(debounce);
            debounce = setTimeout(() => onChange(e.target.value), 400);
          }}
        ></sp-textfield>`;
      }

      return html`
        <div class="style-row" data-prop=${prop.name}>
          <div class="style-row-label">
            ${hasVal
              ? html`<span class="set-dot" title="Clear ${prop.name}" @click=${clearProp}></span>`
              : nothing}
            <sp-field-label size="s" title=${prop.description || prop.name}
              >${camelToLabel(prop.name)}</sp-field-label
            >
            <sp-action-button
              size="xs"
              quiet
              title=${isBound ? "Unbind (switch to static)" : "Bind to signal"}
              @click=${onToggleBind}
              >${isBound ? "\u26A1" : "\u2194"}</sp-action-button
            >
          </div>
          ${isBound ? boundTpl : widgetTpl}
        </div>
      `;
    })}
    ${comp.props.length === 0 ? html`<div class="empty-state">No props defined</div>` : nothing}
    ${comp.path
      ? html`<span class="kv-add" @click=${() => navigateToComponent(comp.path)}
          >→ Edit definition</span
        >`
      : nothing}
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
        style=${view.showAddBreakpointForm ? "display:none" : ""}
        @click=${(/** @type {any} */ _e) => {
          view.showAddBreakpointForm = true;
          renderRightPanel();
        }}
        >+ Add breakpoint</span
      >
      ${view.showAddBreakpointForm
        ? html`
            <div style="margin-top:4px">
              <div style="display:flex;gap:4px;margin-bottom:3px;align-items:center">
                <input
                  class="field-input"
                  placeholder="Name (e.g. Tablet)"
                  style="flex:1"
                  @input=${(/** @type {any} */ e) => {
                    view.addBreakpointPreview = friendlyNameToMedia(e.target.value) || "";
                    renderRightPanel();
                  }}
                />
                <span
                  style="font-size:10px;color:var(--fg-dim);font-family:'SF Mono','Fira Code',monospace;white-space:nowrap"
                  >${view.addBreakpointPreview}</span
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
                      view.showAddBreakpointForm = false;
                      view.addBreakpointPreview = "";
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
                    view.showAddBreakpointForm = false;
                    view.addBreakpointPreview = "";
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

// UNIT_RE — imported from ui/unit-selector.js

// inferInputType — imported from studio-utils.js

// ─── Style panel ────────────────────────────────────────────────────────────
// Extracted to panels/style-utils.js, panels/style-inputs.js, panels/style-panel.js

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
  const placeholder = datalistId === "css-props" ? getCssInitialMap().get(key) || "" : "";
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
              if (el) el.setAttribute("placeholder", getCssInitialMap().get(e.target.value) || "");
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
              update({ ...S, document: parsed, dirty: true });
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
  if (view.functionEditor && view.functionEditor._editingTarget === JSON.stringify(editing)) {
    const body = getFunctionBody(editing);
    const currentVal = view.functionEditor.getValue();
    if (currentVal !== body) {
      view.functionEditor._ignoreNextChange = true;
      view.functionEditor.setValue(body);
    }
    return;
  }

  // Dispose previous editors
  if (view.functionEditor) {
    view.functionEditor.dispose();
    view.functionEditor = null;
  }
  if (view.monacoEditor) {
    view.monacoEditor.dispose();
    view.monacoEditor = null;
  }

  // Clean up canvas DnD and event handlers
  for (const fn of view.canvasDndCleanups) fn();
  view.canvasDndCleanups = [];
  for (const fn of view.canvasEventCleanups) fn();
  view.canvasEventCleanups = [];
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

  view.functionEditor = monaco.editor.create(/** @type {any} */ (editorContainer), {
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
  view.functionEditor._editingTarget = JSON.stringify(editing);

  // Format on open — show pretty-printed code, then run initial lint
  codeService("format", { code: body, args }).then((result) => {
    if (result?.code != null && view.functionEditor) {
      view.functionEditor._ignoreNextChange = true;
      view.functionEditor.setValue(result.code);
    }
  });
  codeService("lint", { code: body, args }).then((result) => {
    if (result?.diagnostics && view.functionEditor)
      setLintMarkers(view.functionEditor, result.diagnostics);
  });

  // Debounced sync back to state + lint on edit
  /** @type {any} */
  let syncDebounce;
  /** @type {any} */
  let lintDebounce;
  let lintGen = 0;
  view.functionEditor.onDidChangeModelContent(() => {
    if (view.functionEditor._ignoreNextChange) {
      view.functionEditor._ignoreNextChange = false;
      return;
    }

    clearTimeout(syncDebounce);
    syncDebounce = setTimeout(() => {
      const newBody = view.functionEditor.getValue();
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
      const currentCode = view.functionEditor.getValue();
      codeService("lint", { code: currentCode, args }).then((result) => {
        if (gen !== lintGen) return;
        if (result?.diagnostics && view.functionEditor)
          setLintMarkers(view.functionEditor, result.diagnostics);
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
function registerFunctionCompletions() {
  if (view._completionRegistered) return;
  view._completionRegistered = true;
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
