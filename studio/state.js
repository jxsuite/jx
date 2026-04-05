/**
 * state.js — Builder state model and mutation API
 *
 * All state changes go through named mutation functions.
 * State is immutable — every mutation produces a new state object.
 * History is a linear stack of { document, selection } snapshots.
 *
 * Path convention:
 *   [] = root document
 *   ['children', 0] = first child
 *   ['children', 0, 'children', 2] = third child of first child
 */

const HISTORY_LIMIT = 100;

// ─── Path utilities ───────────────────────────────────────────────────────────

/** Walk the document tree and return the node at the given path. */
export function getNodeAtPath(doc, path) {
  let node = doc;
  for (const key of path) {
    if (node == null) return undefined;
    node = node[key];
  }
  return node;
}

/** Return the path to the parent element (strips trailing 'children' + index). */
export function parentElementPath(path) {
  return path.length >= 2 ? path.slice(0, -2) : null;
}

/** Return the child index (last segment of the path). */
export function childIndex(path) {
  return path[path.length - 1];
}

/** Serialize a path to a string key for Map lookups. */
export function pathKey(path) {
  return path.join('/');
}

/** Compare two paths for equality. */
export function pathsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** Returns true if `path` is an ancestor of (or equal to) `descendant`. */
export function isAncestor(path, descendant) {
  if (path.length > descendant.length) return false;
  return path.every((v, i) => v === descendant[i]);
}

// ─── Tree flattening (for layer panel) ────────────────────────────────────────

/**
 * Flatten a JSONsx document into an array of { node, path, depth } rows.
 * Only walks static children arrays, not Array namespace maps.
 */
export function flattenTree(doc, path = [], depth = 0) {
  const rows = [{ node: doc, path, depth }];
  const children = doc.children;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      const childPath = [...path, 'children', i];
      rows.push(...flattenTree(children[i], childPath, depth + 1));
    }
  }
  return rows;
}

/** Get a display label for a node (for layers + overlays). */
export function nodeLabel(node) {
  if (!node) return '?';
  if (node.$id) return node.$id;
  const tag = node.tagName ?? 'div';
  if (typeof node.textContent === 'string' && node.textContent.length > 0) {
    return `${tag} — ${node.textContent.slice(0, 24)}`;
  }
  return tag;
}

// ─── State factory ────────────────────────────────────────────────────────────

export function createState(doc) {
  const initial = { document: doc, selection: null };
  return {
    document: doc,
    selection: null,
    hover: null,
    history: [initial],
    historyIndex: 0,
    dirty: false,
    fileHandle: null,
    handlersSource: null,
    ui: {
      leftTab: 'layers',      // 'layers' | 'blocks'
      rightTab: 'properties',  // 'properties' | 'source' | 'handlers'
      zoom: 1,
    },
  };
}

// ─── Core mutation ────────────────────────────────────────────────────────────

/**
 * Apply a mutation to the document. Clones the document immutably,
 * applies the mutation function to the clone, and pushes to history.
 */
export function applyMutation(state, mutationFn) {
  const newDoc = structuredClone(state.document);
  mutationFn(newDoc);
  const truncated = state.history.slice(0, state.historyIndex + 1);
  truncated.push({ document: newDoc, selection: state.selection });
  if (truncated.length > HISTORY_LIMIT) truncated.shift();
  return {
    ...state,
    document: newDoc,
    history: truncated,
    historyIndex: truncated.length - 1,
    dirty: true,
  };
}

// ─── Selection / hover ────────────────────────────────────────────────────────

export function selectNode(state, path) {
  return { ...state, selection: path };
}

export function hoverNode(state, path) {
  return { ...state, hover: path };
}

// ─── Undo / redo ──────────────────────────────────────────────────────────────

export function undo(state) {
  if (state.historyIndex <= 0) return state;
  const idx = state.historyIndex - 1;
  const snap = state.history[idx];
  return { ...state, document: snap.document, selection: snap.selection, historyIndex: idx, dirty: true };
}

export function redo(state) {
  if (state.historyIndex >= state.history.length - 1) return state;
  const idx = state.historyIndex + 1;
  const snap = state.history[idx];
  return { ...state, document: snap.document, selection: snap.selection, historyIndex: idx, dirty: true };
}

// ─── Document mutations ───────────────────────────────────────────────────────

export function insertNode(state, parentPath, index, nodeDef) {
  return applyMutation(state, doc => {
    const parent = getNodeAtPath(doc, parentPath);
    if (!parent.children) parent.children = [];
    parent.children.splice(index, 0, nodeDef);
  });
}

export function removeNode(state, path) {
  if (!path || path.length < 2) return state; // can't remove root
  const elemPath = parentElementPath(path);
  const idx = childIndex(path);
  const newState = applyMutation(state, doc => {
    getNodeAtPath(doc, elemPath).children.splice(idx, 1);
  });
  // Clear selection if we removed the selected node
  if (state.selection && isAncestor(path, state.selection)) {
    return { ...newState, selection: null };
  }
  return newState;
}

export function duplicateNode(state, path) {
  if (!path || path.length < 2) return state;
  const node = getNodeAtPath(state.document, path);
  if (!node) return state;
  const elemPath = parentElementPath(path);
  const idx = childIndex(path);
  const newState = insertNode(state, elemPath, idx + 1, structuredClone(node));
  return selectNode(newState, [...elemPath, 'children', idx + 1]);
}

export function moveNode(state, fromPath, toParentPath, toIndex) {
  return applyMutation(state, doc => {
    const fromParent = getNodeAtPath(doc, parentElementPath(fromPath));
    const fromIdx = childIndex(fromPath);
    const [node] = fromParent.children.splice(fromIdx, 1);
    const toParent = getNodeAtPath(doc, toParentPath);
    if (!toParent.children) toParent.children = [];
    toParent.children.splice(toIndex, 0, node);
  });
}

export function updateProperty(state, path, key, value) {
  return applyMutation(state, doc => {
    const node = getNodeAtPath(doc, path);
    if (value === undefined || value === null || value === '') delete node[key];
    else node[key] = value;
  });
}

export function updateStyle(state, path, prop, value) {
  return applyMutation(state, doc => {
    const node = getNodeAtPath(doc, path);
    if (!node.style) node.style = {};
    if (value === undefined || value === '') delete node.style[prop];
    else node.style[prop] = value;
    if (Object.keys(node.style).length === 0) delete node.style;
  });
}

export function updateAttribute(state, path, attr, value) {
  return applyMutation(state, doc => {
    const node = getNodeAtPath(doc, path);
    if (!node.attributes) node.attributes = {};
    if (value === undefined || value === '') delete node.attributes[attr];
    else node.attributes[attr] = value;
    if (Object.keys(node.attributes).length === 0) delete node.attributes;
  });
}

export function addDef(state, name, def) {
  return applyMutation(state, doc => {
    if (!doc.$defs) doc.$defs = {};
    doc.$defs[name] = def;
  });
}

export function removeDef(state, name) {
  return applyMutation(state, doc => {
    if (doc.$defs) {
      delete doc.$defs[name];
      if (Object.keys(doc.$defs).length === 0) delete doc.$defs;
    }
  });
}
