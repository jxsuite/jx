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
  return path.join("/");
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
 * Flatten a JSONsx document into an array of { node, path, depth, nodeType } rows.
 * Walks static children arrays, $map templates, and $switch cases.
 *
 * nodeType: 'element' (default) | 'map' | 'case' | 'case-ref'
 */
export function flattenTree(doc, path = [], depth = 0) {
  const rows = [{ node: doc, path, depth, nodeType: "element" }];

  // Custom component instances are atomic in the layer tree — don't recurse into internals
  if (doc.$props && (doc.tagName || "").includes("-")) {
    return rows;
  }

  const children = doc.children;

  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      const childPath = [...path, "children", i];
      rows.push(...flattenTree(children[i], childPath, depth + 1));
    }
  } else if (children && typeof children === "object" && children.$prototype === "Array") {
    // $map — emit the map container, then recurse into the template
    rows.push({ node: children, path: [...path, "children"], depth: depth + 1, nodeType: "map" });
    const mapDef = children.map;
    if (mapDef && typeof mapDef === "object") {
      rows.push(...flattenTree(mapDef, [...path, "children", "map"], depth + 2));
    }
  }

  // $switch — emit each case as a virtual child
  if (doc.$switch && doc.cases && typeof doc.cases === "object") {
    for (const [caseName, caseDef] of Object.entries(doc.cases)) {
      const casePath = [...path, "cases", caseName];
      if (caseDef && typeof caseDef === "object" && caseDef.$ref) {
        rows.push({ node: caseDef, path: casePath, depth: depth + 1, nodeType: "case-ref" });
      } else if (caseDef && typeof caseDef === "object") {
        rows.push({ node: caseDef, path: casePath, depth: depth + 1, nodeType: "case" });
        // Recurse into case children (skip the case node itself — already emitted)
        const caseChildren = flattenTree(caseDef, casePath, depth + 2);
        rows.push(...caseChildren.slice(1));
      }
    }
  }

  return rows;
}

/** Get a display label for a node (for layers + overlays). */
export function nodeLabel(node) {
  if (!node) return "?";
  // $map container (Repeater)
  if (node.$prototype === "Array") {
    const ref = node.items?.$ref || "items";
    return `Repeater → ${ref}`;
  }
  if (node.$id) return node.$id;
  const tag = node.tagName ?? "div";
  const suffix = node.$switch ? " ⇆" : "";
  if (typeof node.textContent === "string" && node.textContent.length > 0) {
    return `${tag} — ${node.textContent.slice(0, 24)}${suffix}`;
  }
  return tag + suffix;
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
    documentPath: null, // root-relative path, e.g. "examples/markdown/blog.json"
    documentStack: [], // frames for component navigation
    handlersSource: null,
    mode: "component", // 'component' | 'content'
    content: { frontmatter: {} }, // frontmatter metadata for .md files
    ui: {
      leftTab: "layers", // 'layers' | 'blocks' | 'state' | 'data'
      rightTab: "properties", // 'properties' | 'events' | 'style'
      zoom: 1,
      activeMedia: null, // '--md' | null (base) — focused canvas/breakpoint
      activeSelector: null, // ':hover' | '.child' | null (base) — nested selector context
      featureToggles: {}, // { '--dark': true } — non-size media toggles
      styleSections: {}, // { layout: true, ... } — section open/closed state
      styleShorthands: {}, // { padding: true, ... } — shorthand expand/collapse state
      editingFunction: null, // null | { type: 'def', defName } | { type: 'event', path, eventKey }
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
  return {
    ...state,
    document: snap.document,
    selection: snap.selection,
    historyIndex: idx,
    dirty: true,
  };
}

export function redo(state) {
  if (state.historyIndex >= state.history.length - 1) return state;
  const idx = state.historyIndex + 1;
  const snap = state.history[idx];
  return {
    ...state,
    document: snap.document,
    selection: snap.selection,
    historyIndex: idx,
    dirty: true,
  };
}

// ─── Document mutations ───────────────────────────────────────────────────────

export function insertNode(state, parentPath, index, nodeDef) {
  return applyMutation(state, (doc) => {
    const parent = getNodeAtPath(doc, parentPath);
    if (!parent.children) parent.children = [];
    parent.children.splice(index, 0, nodeDef);
  });
}

export function removeNode(state, path) {
  if (!path || path.length < 2) return state; // can't remove root
  const elemPath = parentElementPath(path);
  const idx = childIndex(path);
  const newState = applyMutation(state, (doc) => {
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
  return selectNode(newState, [...elemPath, "children", idx + 1]);
}

export function moveNode(state, fromPath, toParentPath, toIndex) {
  return applyMutation(state, (doc) => {
    const fromParentPath = parentElementPath(fromPath);
    const fromParent = getNodeAtPath(doc, fromParentPath);
    const fromIdx = childIndex(fromPath);
    const [node] = fromParent.children.splice(fromIdx, 1);
    const toParent = getNodeAtPath(doc, toParentPath);
    if (!toParent.children) toParent.children = [];
    // Adjust target index if moving within the same parent and source was before target
    let adjustedIndex = toIndex;
    if (fromParent === toParent && fromIdx < toIndex) {
      adjustedIndex--;
    }
    toParent.children.splice(adjustedIndex, 0, node);
  });
}

export function updateProperty(state, path, key, value) {
  return applyMutation(state, (doc) => {
    const node = getNodeAtPath(doc, path);
    if (value === undefined || value === null || value === "") delete node[key];
    else node[key] = value;
  });
}

export function updateStyle(state, path, prop, value) {
  return applyMutation(state, (doc) => {
    const node = getNodeAtPath(doc, path);
    if (!node.style) node.style = {};
    if (value === undefined || value === "") delete node.style[prop];
    else node.style[prop] = value;
    if (Object.keys(node.style).length === 0) delete node.style;
  });
}

export function updateAttribute(state, path, attr, value) {
  return applyMutation(state, (doc) => {
    const node = getNodeAtPath(doc, path);
    if (!node.attributes) node.attributes = {};
    if (value === undefined || value === "") delete node.attributes[attr];
    else node.attributes[attr] = value;
    if (Object.keys(node.attributes).length === 0) delete node.attributes;
  });
}

export function addDef(state, name, def) {
  return applyMutation(state, (doc) => {
    if (!doc.$defs) doc.$defs = {};
    doc.$defs[name] = def;
  });
}

export function removeDef(state, name) {
  return applyMutation(state, (doc) => {
    if (doc.$defs) {
      delete doc.$defs[name];
      if (Object.keys(doc.$defs).length === 0) delete doc.$defs;
    }
  });
}

export function updateDef(state, name, updates) {
  return applyMutation(state, (doc) => {
    if (!doc.$defs) doc.$defs = {};
    if (!doc.$defs[name]) doc.$defs[name] = {};
    Object.assign(doc.$defs[name], updates);
    for (const k of Object.keys(doc.$defs[name])) {
      if (doc.$defs[name][k] === undefined || doc.$defs[name][k] === null) {
        delete doc.$defs[name][k];
      }
    }
  });
}

export function renameDef(state, oldName, newName) {
  return applyMutation(state, (doc) => {
    if (!doc.$defs || !doc.$defs[oldName]) return;
    doc.$defs[newName] = doc.$defs[oldName];
    delete doc.$defs[oldName];
  });
}

// ─── Media mutations ─────────────────────────────────────────────────────────

/** Update a style property inside a media override block (e.g., @--md). */
export function updateMediaStyle(state, path, mediaName, prop, value) {
  return applyMutation(state, (doc) => {
    const node = getNodeAtPath(doc, path);
    if (!node.style) node.style = {};
    const key = `@${mediaName}`;
    if (!node.style[key]) node.style[key] = {};
    if (value === undefined || value === "") {
      delete node.style[key][prop];
      if (Object.keys(node.style[key]).length === 0) delete node.style[key];
    } else {
      node.style[key][prop] = value;
    }
    if (Object.keys(node.style).length === 0) delete node.style;
  });
}

/** Update a style property inside a nested selector block (e.g., :hover). */
export function updateNestedStyle(state, path, selector, prop, value) {
  return applyMutation(state, (doc) => {
    const node = getNodeAtPath(doc, path);
    if (!node.style) node.style = {};
    if (!node.style[selector]) node.style[selector] = {};
    if (value === undefined || value === "") {
      delete node.style[selector][prop];
      if (Object.keys(node.style[selector]).length === 0) delete node.style[selector];
    } else {
      node.style[selector][prop] = value;
    }
    if (Object.keys(node.style).length === 0) delete node.style;
  });
}

/** Update a style property inside a nested selector within a media block (e.g., @--md > :hover). */
export function updateMediaNestedStyle(state, path, mediaName, selector, prop, value) {
  return applyMutation(state, (doc) => {
    const node = getNodeAtPath(doc, path);
    if (!node.style) node.style = {};
    const key = `@${mediaName}`;
    if (!node.style[key]) node.style[key] = {};
    if (!node.style[key][selector]) node.style[key][selector] = {};
    if (value === undefined || value === "") {
      delete node.style[key][selector][prop];
      if (Object.keys(node.style[key][selector]).length === 0) delete node.style[key][selector];
      if (Object.keys(node.style[key]).length === 0) delete node.style[key];
    } else {
      node.style[key][selector][prop] = value;
    }
    if (Object.keys(node.style).length === 0) delete node.style;
  });
}

/** Add or update a named media entry at the document root. */
export function updateMedia(state, name, query) {
  return applyMutation(state, (doc) => {
    if (!doc.$media) doc.$media = {};
    if (query === undefined || query === "") {
      delete doc.$media[name];
      if (Object.keys(doc.$media).length === 0) delete doc.$media;
    } else {
      doc.$media[name] = query;
    }
  });
}

// ─── Document stack (component navigation) ──────────────────────────────────

/** Push current document onto the stack and switch to editing a new document. */
export function pushDocument(state, doc, documentPath) {
  const frame = {
    document: state.document,
    selection: state.selection,
    fileHandle: state.fileHandle,
    documentPath: state.documentPath,
    dirty: state.dirty,
    history: state.history,
    historyIndex: state.historyIndex,
    mode: state.mode,
  };
  const newState = createState(doc);
  newState.documentStack = [...(state.documentStack || []), frame];
  newState.documentPath = documentPath;
  newState.ui = { ...state.ui, leftTab: "layers", activeMedia: null, activeSelector: null };
  return newState;
}

/** Pop the document stack and return to the previous document. */
export function popDocument(state) {
  if (!state.documentStack || state.documentStack.length === 0) return state;
  const stack = [...state.documentStack];
  const frame = stack.pop();
  return {
    ...state,
    ...frame,
    documentStack: stack,
    ui: { ...state.ui, leftTab: "layers" },
  };
}

// ─── $props mutations ────────────────────────────────────────────────────────

/** Update a $prop on a component instance. */
export function updateProp(state, path, propName, value) {
  return applyMutation(state, (doc) => {
    const node = getNodeAtPath(doc, path);
    if (!node.$props) node.$props = {};
    if (value === undefined || value === null || value === "") delete node.$props[propName];
    else node.$props[propName] = value;
    if (Object.keys(node.$props).length === 0) delete node.$props;
  });
}

// ─── $switch case mutations ──────────────────────────────────────────────────

export function addSwitchCase(state, path, caseName, caseDef) {
  return applyMutation(state, (doc) => {
    const node = getNodeAtPath(doc, path);
    if (!node.cases) node.cases = {};
    node.cases[caseName] = caseDef || { tagName: "div", textContent: caseName };
  });
}

export function removeSwitchCase(state, path, caseName) {
  return applyMutation(state, (doc) => {
    const node = getNodeAtPath(doc, path);
    if (node.cases) {
      delete node.cases[caseName];
    }
  });
}

export function renameSwitchCase(state, path, oldName, newName) {
  return applyMutation(state, (doc) => {
    const node = getNodeAtPath(doc, path);
    if (!node.cases || !node.cases[oldName]) return;
    node.cases[newName] = node.cases[oldName];
    delete node.cases[oldName];
  });
}
