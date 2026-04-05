/**
 * studio.js — JSONsx Studio main application
 *
 * Phase 1: Open a JSONsx file, render in canvas, edit properties
 * in the inspector, see changes live, and save.
 */

import {
  createState, selectNode, hoverNode, undo, redo,
  insertNode, removeNode, duplicateNode, updateProperty,
  updateStyle, updateAttribute, addDef, removeDef,
  getNodeAtPath, flattenTree, nodeLabel, pathKey,
  pathsEqual, parentElementPath, childIndex,
} from './state.js';

// ─── Globals ──────────────────────────────────────────────────────────────────

let S; // current state
let statusMsg = '';
let statusTimeout;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const canvas     = $('#canvas');
const overlay    = $('#overlay');
const overlayClk = $('#overlay-click');
const leftPanel  = $('#left-panel');
const rightPanel = $('#right-panel');
const toolbar    = $('#toolbar');
const statusbar  = $('#statusbar');

/** WeakMap<HTMLElement, Array> — maps rendered DOM elements to their JSON paths */
const elToPath = new WeakMap();

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const EMPTY_DOC = {
  tagName: 'div',
  style: { padding: '2rem', fontFamily: 'system-ui, sans-serif' },
  children: [
    { tagName: 'h1', textContent: 'New Component' },
    { tagName: 'p', textContent: 'Open a JSONsx file or start editing.' },
  ],
};

S = createState(structuredClone(EMPTY_DOC));
render();

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

  renderRightPanel();
  renderOverlays();
  renderStatusbar();
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

function renderCanvas() {
  canvas.innerHTML = '';
  canvas.style.transform = `scale(${S.ui.zoom})`;
  renderCanvasNode(S.document, [], canvas);
}

/**
 * Recursively render a JSONsx node to the canvas DOM.
 * Simplified renderer for the builder — no signals, no handlers.
 * Just static DOM from the JSON tree.
 */
function renderCanvasNode(node, path, parent) {
  if (!node || typeof node !== 'object') return;

  const tag = node.tagName || 'div';
  const el = document.createElement(tag);

  // Map element → path for click-to-select
  elToPath.set(el, path);

  // Apply textContent
  if (typeof node.textContent === 'string') {
    el.textContent = node.textContent;
  } else if (typeof node.textContent === 'object' && node.textContent?.$ref) {
    el.textContent = `{${node.textContent.$ref}}`;
    el.style.opacity = '0.6';
    el.style.fontStyle = 'italic';
  }

  // Apply id / className
  if (node.id) el.id = node.id;
  if (node.className) el.className = node.className;

  // Apply style
  if (node.style && typeof node.style === 'object') {
    for (const [prop, val] of Object.entries(node.style)) {
      if (typeof val === 'string' || typeof val === 'number') {
        try { el.style[prop] = val; } catch {}
      }
    }
  }

  // Apply attributes
  if (node.attributes && typeof node.attributes === 'object') {
    for (const [attr, val] of Object.entries(node.attributes)) {
      try { el.setAttribute(attr, val); } catch {}
    }
  }

  // Recursively render children
  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      renderCanvasNode(node.children[i], [...path, 'children', i], el);
    }
  }

  // Prevent canvas children from receiving pointer events
  el.style.pointerEvents = 'none';

  parent.appendChild(el);
  return el;
}

// ─── Overlay system ───────────────────────────────────────────────────────────

function renderOverlays() {
  overlay.innerHTML = '';

  if (S.hover && !pathsEqual(S.hover, S.selection)) {
    const el = findCanvasElement(S.hover);
    if (el) drawOverlayBox(el, 'hover');
  }

  if (S.selection) {
    const el = findCanvasElement(S.selection);
    if (el) drawOverlayBox(el, 'selection');
  }
}

function drawOverlayBox(el, type) {
  const zoom = S.ui.zoom;
  const canvasRect = canvas.parentElement.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();

  const box = document.createElement('div');
  box.className = `overlay-box overlay-${type}`;
  box.style.top = `${(elRect.top - canvasRect.top + canvas.parentElement.scrollTop) / zoom}px`;
  box.style.left = `${(elRect.left - canvasRect.left + canvas.parentElement.scrollLeft) / zoom}px`;
  box.style.width = `${elRect.width / zoom}px`;
  box.style.height = `${elRect.height / zoom}px`;

  if (type === 'selection') {
    const node = getNodeAtPath(S.document, S.selection);
    const label = document.createElement('div');
    label.className = 'overlay-label';
    label.textContent = nodeLabel(node);
    box.appendChild(label);
  }

  overlay.appendChild(box);
}

function findCanvasElement(path) {
  // Walk the canvas DOM to find the element at the given path
  let el = canvas.firstElementChild; // root node
  if (!el) return null;
  if (path.length === 0) return el;

  for (let i = 0; i < path.length; i += 2) {
    // path is like ['children', 0, 'children', 2]
    if (path[i] !== 'children') return null;
    const idx = path[i + 1];
    el = el.children[idx];
    if (!el) return null;
  }
  return el;
}

// ─── Canvas click-to-select ───────────────────────────────────────────────────

overlayClk.addEventListener('click', (e) => {
  const zoom = S.ui.zoom;
  const canvasRect = canvas.getBoundingClientRect();
  const x = (e.clientX - canvasRect.left) / zoom;
  const y = (e.clientY - canvasRect.top) / zoom;

  // Find the deepest element at this point
  // Temporarily allow pointer events to use elementFromPoint
  canvas.style.pointerEvents = 'auto';
  overlayClk.style.display = 'none';
  const elements = document.elementsFromPoint(e.clientX, e.clientY);
  overlayClk.style.display = '';
  canvas.style.pointerEvents = '';

  // Find the first element inside the canvas
  for (const el of elements) {
    if (canvas.contains(el) && el !== canvas) {
      const path = elToPath.get(el);
      if (path) {
        // Re-enable pointer events on all canvas children
        resetCanvasPointerEvents();
        update(selectNode(S, path));
        return;
      }
    }
  }
  // Click on empty canvas = deselect
  update(selectNode(S, null));
});

overlayClk.addEventListener('mousemove', (e) => {
  canvas.style.pointerEvents = 'auto';
  overlayClk.style.pointerEvents = 'none';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  overlayClk.style.pointerEvents = '';
  canvas.style.pointerEvents = '';

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

overlayClk.addEventListener('mouseleave', () => {
  if (S.hover) {
    S = hoverNode(S, null);
    renderOverlays();
  }
});

function resetCanvasPointerEvents() {
  const allEls = canvas.querySelectorAll('*');
  for (const el of allEls) el.style.pointerEvents = 'none';
}

// ─── Left panel: Layers ───────────────────────────────────────────────────────

function renderLeftPanel() {
  const tab = S.ui.leftTab;
  leftPanel.innerHTML = '';

  // Tabs
  const tabs = document.createElement('div');
  tabs.className = 'panel-tabs';
  for (const t of ['layers', 'blocks']) {
    const btn = document.createElement('div');
    btn.className = `panel-tab${t === tab ? ' active' : ''}`;
    btn.textContent = t;
    btn.onclick = () => { S = { ...S, ui: { ...S.ui, leftTab: t } }; renderLeftPanel(); };
    tabs.appendChild(btn);
  }
  leftPanel.appendChild(tabs);

  const body = document.createElement('div');
  body.className = 'panel-body';
  leftPanel.appendChild(body);

  if (tab === 'layers') renderLayers(body);
  else renderBlocks(body);
}

function renderLayers(container) {
  const rows = flattenTree(S.document);
  /** @type {Set<string>} */
  const collapsed = S._collapsed || (S._collapsed = new Set());

  for (const { node, path, depth } of rows) {
    // Check if any ancestor is collapsed
    let hidden = false;
    for (let d = 2; d <= path.length; d += 2) {
      const ancestorKey = pathKey(path.slice(0, d));
      // Check if a proper ancestor is collapsed
      if (d < path.length && collapsed.has(pathKey(path.slice(0, d)))) {
        hidden = true;
        break;
      }
    }
    if (hidden) continue;

    const row = document.createElement('div');
    row.className = `layer-row${pathsEqual(path, S.selection) ? ' selected' : ''}`;

    // Indent
    const indent = document.createElement('span');
    indent.className = 'layer-indent';
    indent.style.width = `${depth * 16}px`;
    row.appendChild(indent);

    // Collapse toggle
    const toggle = document.createElement('span');
    toggle.className = 'layer-toggle';
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const key = pathKey(path);
    if (hasChildren) {
      toggle.textContent = collapsed.has(key) ? '▶' : '▼';
      toggle.onclick = (e) => {
        e.stopPropagation();
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        renderLeftPanel();
      };
    }
    row.appendChild(toggle);

    // Tag badge
    const badge = document.createElement('span');
    badge.className = 'layer-tag';
    badge.textContent = node.tagName || 'div';
    row.appendChild(badge);

    // Label
    const label = document.createElement('span');
    label.className = 'layer-label';
    label.textContent = nodeLabel(node);
    row.appendChild(label);

    // Signal indicator
    if (node.$defs) {
      const hasSignals = Object.values(node.$defs).some(d => d.signal);
      if (hasSignals) {
        const dot = document.createElement('span');
        dot.className = 'layer-dot';
        dot.textContent = '⚡';
        dot.title = 'Has signals';
        row.appendChild(dot);
      }
    }

    // Delete button (not for root)
    if (path.length >= 2) {
      const del = document.createElement('span');
      del.className = 'layer-delete';
      del.textContent = '✕';
      del.title = 'Delete';
      del.onclick = (e) => {
        e.stopPropagation();
        update(removeNode(S, path));
      };
      row.appendChild(del);
    }

    row.onclick = () => update(selectNode(S, path));
    container.appendChild(row);
  }
}

function renderBlocks(container) {
  const blocks = [
    { label: 'div', def: { tagName: 'div' } },
    { label: 'section', def: { tagName: 'section' } },
    { label: 'h1', def: { tagName: 'h1', textContent: 'Heading' } },
    { label: 'h2', def: { tagName: 'h2', textContent: 'Heading' } },
    { label: 'h3', def: { tagName: 'h3', textContent: 'Heading' } },
    { label: 'p', def: { tagName: 'p', textContent: 'Paragraph text' } },
    { label: 'span', def: { tagName: 'span', textContent: 'Inline text' } },
    { label: 'button', def: { tagName: 'button', textContent: 'Button' } },
    { label: 'input', def: { tagName: 'input', attributes: { type: 'text', placeholder: 'Enter text...' } } },
    { label: 'img', def: { tagName: 'img', attributes: { src: '', alt: 'Image' } } },
    { label: 'ul', def: { tagName: 'ul', children: [{ tagName: 'li', textContent: 'Item' }] } },
    { label: 'a', def: { tagName: 'a', textContent: 'Link', attributes: { href: '#' } } },
  ];

  for (const { label, def } of blocks) {
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.style.cursor = 'grab';

    const badge = document.createElement('span');
    badge.className = 'layer-tag';
    badge.textContent = label;
    row.appendChild(badge);

    const lbl = document.createElement('span');
    lbl.className = 'layer-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    row.onclick = () => {
      // Insert as last child of selected node, or as last child of root
      const parentPath = S.selection || [];
      const parent = getNodeAtPath(S.document, parentPath);
      const idx = parent.children ? parent.children.length : 0;
      update(insertNode(S, parentPath, idx, structuredClone(def)));
    };

    container.appendChild(row);
  }
}

// ─── Right panel: Inspector ───────────────────────────────────────────────────

function renderRightPanel() {
  const tab = S.ui.rightTab;
  rightPanel.innerHTML = '';

  // Tabs
  const tabs = document.createElement('div');
  tabs.className = 'panel-tabs';
  for (const t of ['properties', 'source', 'handlers']) {
    const btn = document.createElement('div');
    btn.className = `panel-tab${t === tab ? ' active' : ''}`;
    btn.textContent = t;
    btn.onclick = () => { S = { ...S, ui: { ...S.ui, rightTab: t } }; renderRightPanel(); renderOverlays(); };
    tabs.appendChild(btn);
  }
  rightPanel.appendChild(tabs);

  const body = document.createElement('div');
  body.className = 'panel-body';
  rightPanel.appendChild(body);

  if (tab === 'properties') renderInspector(body);
  else if (tab === 'source') renderSourceView(body);
  else if (tab === 'handlers') renderHandlersView(body);
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

  renderInspectorSection(container, 'Element', true, () => {
    const fields = document.createElement('div');
    fields.className = 'inspector-fields';

    fields.appendChild(fieldRow('tagName', 'text', node.tagName || 'div', (v) => {
      update(updateProperty(S, S.selection, 'tagName', v || undefined));
    }));
    fields.appendChild(fieldRow('$id', 'text', node.$id || '', (v) => {
      update(updateProperty(S, S.selection, '$id', v || undefined));
    }));
    fields.appendChild(fieldRow('className', 'text', node.className || '', (v) => {
      update(updateProperty(S, S.selection, 'className', v || undefined));
    }));

    // textContent only when no children
    if (!Array.isArray(node.children) || node.children.length === 0) {
      const tc = typeof node.textContent === 'string' ? node.textContent
        : (node.textContent?.$ref ? `{$ref: ${node.textContent.$ref}}` : '');
      fields.appendChild(fieldRow('textContent', 'textarea', tc, (v) => {
        update(updateProperty(S, S.selection, 'textContent', v || undefined));
      }));
    }

    fields.appendChild(fieldRow('hidden', 'checkbox', !!node.hidden, (v) => {
      update(updateProperty(S, S.selection, 'hidden', v || undefined));
    }));

    return fields;
  });

  // Style section
  renderInspectorSection(container, 'Style', true, () => {
    const fields = document.createElement('div');
    fields.className = 'inspector-fields';
    const style = node.style || {};

    // Render existing style properties
    for (const [prop, val] of Object.entries(style)) {
      if (typeof val === 'object') continue; // skip nested selectors for now
      fields.appendChild(kvRow(prop, String(val),
        (newProp, newVal) => {
          if (newProp !== prop) {
            // Rename: remove old, add new
            let s = updateStyle(S, S.selection, prop, undefined);
            s = updateStyle(s, S.selection, newProp, newVal);
            update(s);
          } else {
            update(updateStyle(S, S.selection, prop, newVal));
          }
        },
        () => update(updateStyle(S, S.selection, prop, undefined))
      ));
    }

    // Add style button
    const add = document.createElement('span');
    add.className = 'kv-add';
    add.textContent = '+ Add style';
    add.onclick = () => {
      update(updateStyle(S, S.selection, 'color', '#000'));
    };
    fields.appendChild(add);
    return fields;
  });

  // Attributes section
  renderInspectorSection(container, 'Attributes', false, () => {
    const fields = document.createElement('div');
    fields.className = 'inspector-fields';
    const attrs = node.attributes || {};

    for (const [attr, val] of Object.entries(attrs)) {
      fields.appendChild(kvRow(attr, String(val),
        (newAttr, newVal) => {
          if (newAttr !== attr) {
            let s = updateAttribute(S, S.selection, attr, undefined);
            s = updateAttribute(s, S.selection, newAttr, newVal);
            update(s);
          } else {
            update(updateAttribute(S, S.selection, attr, newVal));
          }
        },
        () => update(updateAttribute(S, S.selection, attr, undefined))
      ));
    }

    const add = document.createElement('span');
    add.className = 'kv-add';
    add.textContent = '+ Add attribute';
    add.onclick = () => {
      update(updateAttribute(S, S.selection, 'data-', ''));
    };
    fields.appendChild(add);
    return fields;
  });

  // Defs section (signals + handlers)
  if (S.selection.length === 0 && node.$defs) {
    renderInspectorSection(container, 'Definitions', false, () => {
      const fields = document.createElement('div');
      fields.className = 'inspector-fields';
      for (const [name, def] of Object.entries(node.$defs)) {
        const row = document.createElement('div');
        row.className = 'def-row';

        const badge = document.createElement('span');
        badge.className = `def-badge ${def.$handler ? 'handler' : def.$compute ? 'computed' : 'signal'}`;
        badge.textContent = def.$handler ? 'H' : def.$compute ? 'C' : 'S';
        row.appendChild(badge);

        const nameEl = document.createElement('span');
        nameEl.className = 'def-name';
        nameEl.textContent = name;
        row.appendChild(nameEl);

        const del = document.createElement('span');
        del.className = 'def-del';
        del.textContent = '✕';
        del.onclick = () => update(removeDef(S, name));
        row.appendChild(del);

        fields.appendChild(row);
      }
      return fields;
    });
  }
}

/** Collapsible inspector section */
function renderInspectorSection(container, title, defaultOpen, contentFn) {
  const section = document.createElement('div');
  section.className = 'inspector-section';

  const header = document.createElement('div');
  header.className = `inspector-header${defaultOpen ? '' : ' collapsed'}`;
  header.textContent = title;

  const content = contentFn();
  if (!defaultOpen) content.classList.add('hidden');

  header.onclick = () => {
    header.classList.toggle('collapsed');
    content.classList.toggle('hidden');
  };

  section.appendChild(header);
  section.appendChild(content);
  container.appendChild(section);
}

/** Single property input row */
function fieldRow(label, type, value, onChange) {
  const row = document.createElement('div');
  row.className = 'field-row';

  const lbl = document.createElement('label');
  lbl.className = 'field-label';
  lbl.textContent = label;
  row.appendChild(lbl);

  let input;
  if (type === 'textarea') {
    input = document.createElement('textarea');
    input.className = 'field-input';
    input.value = value;
    let debounceTimer;
    input.oninput = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChange(input.value), 400);
    };
  } else if (type === 'checkbox') {
    input = document.createElement('input');
    input.className = 'field-input';
    input.type = 'checkbox';
    input.checked = !!value;
    input.onchange = () => onChange(input.checked);
  } else {
    input = document.createElement('input');
    input.className = 'field-input';
    input.type = type;
    input.value = value;
    let debounceTimer;
    input.oninput = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChange(input.value), 400);
    };
  }
  row.appendChild(input);
  return row;
}

/** Key-value pair row for styles / attributes */
function kvRow(key, value, onChange, onDelete) {
  const row = document.createElement('div');
  row.className = 'kv-row';

  const keyInput = document.createElement('input');
  keyInput.className = 'field-input kv-key';
  keyInput.value = key;

  const valInput = document.createElement('input');
  valInput.className = 'field-input kv-val';
  valInput.value = value;

  let debounceTimer;
  const commit = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onChange(keyInput.value, valInput.value), 400);
  };
  keyInput.oninput = commit;
  valInput.oninput = commit;

  const del = document.createElement('span');
  del.className = 'kv-del';
  del.textContent = '✕';
  del.onclick = onDelete;

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(del);
  return row;
}

// ─── Source view ──────────────────────────────────────────────────────────────

function renderSourceView(container) {
  if (!S.selection) {
    const ta = document.createElement('textarea');
    ta.id = 'source-view';
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
  const ta = document.createElement('textarea');
  ta.id = 'source-view';
  ta.value = JSON.stringify(node, null, 2);
  ta.readOnly = true;
  container.appendChild(ta);
}

// ─── Handlers view ────────────────────────────────────────────────────────────

function renderHandlersView(container) {
  if (S.handlersSource) {
    const ta = document.createElement('textarea');
    ta.id = 'source-view';
    ta.value = S.handlersSource;
    ta.readOnly = true;
    container.appendChild(ta);
  } else {
    container.innerHTML = '<div class="empty-state">No companion .js file loaded</div>';
  }
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function renderToolbar() {
  toolbar.innerHTML = '';

  // File group
  const fileGroup = group();
  fileGroup.appendChild(tbBtn('Open', openFile));
  fileGroup.appendChild(tbBtn('Save', saveFile));
  if (S.fileHandle) {
    const fname = document.createElement('span');
    fname.className = 'tb-filename';
    fname.textContent = S.fileHandle.name;
    fileGroup.appendChild(fname);
  }
  if (S.dirty) {
    const dot = document.createElement('span');
    dot.className = 'tb-dirty';
    dot.textContent = '●';
    fileGroup.appendChild(dot);
  }
  toolbar.appendChild(fileGroup);

  // Edit group
  const editGroup = group();
  editGroup.appendChild(tbBtn('Undo', () => update(undo(S))));
  editGroup.appendChild(tbBtn('Redo', () => update(redo(S))));
  toolbar.appendChild(editGroup);

  // Insert group
  const insertGroup = group();
  insertGroup.appendChild(tbBtn('Duplicate', () => {
    if (S.selection) update(duplicateNode(S, S.selection));
  }));
  insertGroup.appendChild(tbBtn('Delete', () => {
    if (S.selection) update(removeNode(S, S.selection));
  }));
  toolbar.appendChild(insertGroup);

  // Zoom group
  const zoomGroup = group();
  zoomGroup.appendChild(tbBtn('−', () => {
    S = { ...S, ui: { ...S.ui, zoom: Math.max(0.25, S.ui.zoom - 0.25) } };
    renderCanvas(); renderOverlays();
  }));
  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'tb-filename';
  zoomLabel.textContent = `${Math.round(S.ui.zoom * 100)}%`;
  zoomGroup.appendChild(zoomLabel);
  zoomGroup.appendChild(tbBtn('+', () => {
    S = { ...S, ui: { ...S.ui, zoom: Math.min(4, S.ui.zoom + 0.25) } };
    renderCanvas(); renderOverlays();
  }));
  toolbar.appendChild(zoomGroup);

  // Spacer
  const spacer = document.createElement('div');
  spacer.className = 'tb-spacer';
  toolbar.appendChild(spacer);

  // Export group
  const exportGroup = group();
  exportGroup.appendChild(tbBtn('Copy JSON', async () => {
    await navigator.clipboard.writeText(JSON.stringify(S.document, null, 2));
    statusMessage('Copied to clipboard');
  }));
  toolbar.appendChild(exportGroup);
}

function group() {
  const g = document.createElement('div');
  g.className = 'tb-group';
  return g;
}

function tbBtn(label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'tb-btn';
  btn.textContent = label;
  btn.onclick = onClick;
  return btn;
}

// ─── Statusbar ────────────────────────────────────────────────────────────────


function renderStatusbar() {
  const parts = [];
  if (S.selection) {
    const node = getNodeAtPath(S.document, S.selection);
    parts.push(`Selected: ${nodeLabel(node)}`);
    parts.push(`Path: ${S.selection.join(' > ') || 'root'}`);
  }
  if (statusMsg) parts.push(statusMsg);
  statusbar.textContent = parts.join('  |  ') || 'JSONsx Studio';
}

function statusMessage(msg, duration = 3000) {
  statusMsg = msg;
  renderStatusbar();
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => { statusMsg = ''; renderStatusbar(); }, duration);
}

// ─── File Operations ──────────────────────────────────────────────────────────

async function openFile() {
  try {
    // File System Access API
    if ('showOpenFilePicker' in window) {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'JSONsx Component', accept: { 'application/json': ['.json'] } }],
      });
      const file = await handle.getFile();
      const text = await file.text();
      const doc = JSON.parse(text);
      S = createState(doc);
      S.fileHandle = handle;
      S.dirty = false;

      // Try to load companion .js file
      await loadCompanionJS(handle);

      render();
      statusMessage(`Opened ${handle.name}`);
    } else {
      // Fallback: file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const text = await file.text();
        const doc = JSON.parse(text);
        S = createState(doc);
        S.dirty = false;
        render();
        statusMessage(`Opened ${file.name}`);
      };
      input.click();
    }
  } catch (e) {
    if (e.name !== 'AbortError') statusMessage(`Error: ${e.message}`);
  }
}

async function loadCompanionJS(handle) {
  try {
    // Try to get the parent directory to look for .js file
    // Note: getParent is not widely supported; best-effort
    const name = handle.name.replace(/\.json$/, '.js');
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
    const json = JSON.stringify(S.document, null, 2);

    if (S.fileHandle && 'createWritable' in S.fileHandle) {
      const writable = await S.fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      S = { ...S, dirty: false };
      renderToolbar();
      statusMessage('Saved');
    } else if ('showSaveFilePicker' in window) {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'component.json',
        types: [{ description: 'JSONsx Component', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      S = { ...S, fileHandle: handle, dirty: false };
      renderToolbar();
      statusMessage(`Saved as ${handle.name}`);
    } else {
      // Fallback: download
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'component.json';
      a.click();
      URL.revokeObjectURL(url);
      S = { ...S, dirty: false };
      renderToolbar();
      statusMessage('Downloaded');
    }
  } catch (e) {
    if (e.name !== 'AbortError') statusMessage(`Save error: ${e.message}`);
  }
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  // Don't intercept when typing in inputs
  if (e.target.matches('input, textarea, select')) {
    if (mod && e.key === 's') { e.preventDefault(); saveFile(); }
    return;
  }

  if (mod) {
    switch (e.key) {
      case 'o': e.preventDefault(); openFile(); break;
      case 's': e.preventDefault(); saveFile(); break;
      case 'z':
        e.preventDefault();
        update(e.shiftKey ? redo(S) : undo(S));
        break;
      case 'd':
        e.preventDefault();
        if (S.selection) update(duplicateNode(S, S.selection));
        break;
      case '0':
        e.preventDefault();
        S = { ...S, ui: { ...S.ui, zoom: 1 } };
        renderCanvas(); renderOverlays();
        break;
      case '=': case '+':
        e.preventDefault();
        S = { ...S, ui: { ...S.ui, zoom: Math.min(4, S.ui.zoom + 0.25) } };
        renderCanvas(); renderOverlays();
        break;
      case '-':
        e.preventDefault();
        S = { ...S, ui: { ...S.ui, zoom: Math.max(0.25, S.ui.zoom - 0.25) } };
        renderCanvas(); renderOverlays();
        break;
    }
    return;
  }

  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      if (S.selection && S.selection.length >= 2) {
        e.preventDefault();
        update(removeNode(S, S.selection));
      }
      break;
    case 'Escape':
      update(selectNode(S, null));
      break;
    case 'ArrowUp':
      e.preventDefault();
      navigateSelection(-1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      navigateSelection(1);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (S.selection && S.selection.length >= 2) {
        update(selectNode(S, parentElementPath(S.selection)));
      }
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (S.selection) {
        const node = getNodeAtPath(S.document, S.selection);
        if (node?.children?.length > 0) {
          update(selectNode(S, [...S.selection, 'children', 0]));
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
    const newPath = [...parentElementPath(S.selection), 'children', newIdx];
    update(selectNode(S, newPath));
  }
}

// ─── Autosave ─────────────────────────────────────────────────────────────────

let autosaveTimer;
const AUTO_SAVE_DELAY = 2000;

function scheduleAutosave() {
  if (!S.fileHandle || !S.dirty) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    if (S.fileHandle && S.dirty && 'createWritable' in S.fileHandle) {
      try {
        const writable = await S.fileHandle.createWritable();
        await writable.write(JSON.stringify(S.document, null, 2));
        await writable.close();
        S = { ...S, dirty: false };
        renderToolbar();
        statusMessage('Auto-saved');
      } catch {}
    }
  }, AUTO_SAVE_DELAY);
}

// Hook autosave into update
const _origUpdate = update;
update = function(newState) {
  _origUpdate(newState);
  if (S.dirty) scheduleAutosave();
};
