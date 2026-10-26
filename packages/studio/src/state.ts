/**
 * Document paths, the tree walk over them, and the project record.
 *
 * A `JxPath` addresses one node from the document root: `[]` is the root itself, `["children", 0]`
 * its first child, `["children", 0, "children", 2]` that child's third. Every module that points at
 * a node — selection, hover, the layers tree, a patch — spells it this way, which is why the
 * comparison and ancestry predicates live here rather than beside any one of them.
 *
 * The editable document and its history belong to a TAB (`tabs/tab.ts`) and its session lives on
 * the workspace; nothing here holds mutable document state. The one exception is `projectState`,
 * which outlives every document because it describes the folder they all come from.
 */

import type { ProjectState } from "./types";
import {
  displayTagName,
  isBoolean,
  isMappedArray,
  isNonNullObject,
  isNumber,
  isRef,
  isString,
} from "@jxsuite/schema/guards";
import type { JxMutableNode } from "@jxsuite/schema/types";

export type JxPath = (string | number)[];

// ─── Path utilities ───────────────────────────────────────────────────────────

/**
 * Walk the document tree and return the node at the given path, or `undefined` when a step falls
 * off the tree (a path gone stale since it was taken). One walk, shared with the document ops.
 */
export { getNodeAtPath } from "@jxsuite/schema/doc-ops";

/**
 * The node's children when they are a static array (the edit-mode invariant); an empty array for
 * mapped-array or absent children.
 *
 * @param {JxMutableNode | null | undefined} node
 * @returns {(JxMutableNode | string)[]}
 */
export function childList(node: JxMutableNode | null | undefined): (JxMutableNode | string)[] {
  return Array.isArray(node?.children) ? node.children : [];
}

/**
 * Normalize a document in place to the canonical array-member form: a legacy whole-children
 * repeater (`children: { $prototype: "Array", … }`) becomes a single member of a children array
 * (`children: [{ $prototype: "Array", … }]`). Recurses through children, repeater templates, and
 * `$switch` cases. Runs once when a document is loaded into a tab so every in-studio doc — and its
 * history checkpoints — uses the member form before any mutation.
 *
 * The rewrite is the editor's invariant, not the file's: `onBare` hears every repeater it moved,
 * with the JSON Pointer of the node holding it (in the NORMALIZED document's coordinates), so a
 * save can put the authored form back (`tabs/bare-repeaters.ts`).
 *
 * @param {T} node
 * @param {BareRepeaterVisitor} [onBare]
 * @param {string} [pointer] - The node's JSON Pointer, `""` for the root.
 * @returns {T} The same node (mutated)
 */
export function normalizeArrayChildren<T>(node: T, onBare?: BareRepeaterVisitor, pointer = ""): T {
  if (!isNonNullObject(node)) {
    return node;
  }
  if (Array.isArray(node)) {
    for (const [i, child] of node.entries()) {
      normalizeArrayChildren(child, onBare, `${pointer}/${i}`);
    }
    return node;
  }
  /* SAFETY: A non-array object reached from a document root, a children array, a repeater `map` or
     a `$switch` case is a node definition, and JxMutableNode is the editor's open node shape. */
  const n = node as JxMutableNode;
  const { children } = n;
  if (isMappedArray(children)) {
    // SAFETY: A legacy whole-children repeater is the same repeater node that becomes the member.
    const repeater = children as JxMutableNode;
    onBare?.(pointer, repeater);
    n.children = [repeater];
  }
  if (Array.isArray(n.children)) {
    for (const [i, child] of n.children.entries()) {
      normalizeArrayChildren(child, onBare, `${pointer}/children/${i}`);
    }
  }
  if (n.$prototype === "Array" && isNonNullObject(n.map)) {
    normalizeArrayChildren(n.map, onBare, `${pointer}/map`);
  }
  if (isNonNullObject(n.cases)) {
    for (const [key, caseDef] of Object.entries(n.cases)) {
      normalizeArrayChildren(caseDef, onBare, `${pointer}/cases/${pointerToken(key)}`);
    }
  }
  return node;
}

/**
 * Hears each legacy whole-children repeater {@link normalizeArrayChildren} rewrites: the JSON
 * Pointer of the node holding it, and the repeater.
 */
export type BareRepeaterVisitor = (pointer: string, repeater: JxMutableNode) => void;

/** One JSON Pointer reference token (RFC 6901 §4). */
export function pointerToken(segment: string | number): string {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * Return the path to the parent element (strips trailing 'children' + index).
 *
 * @param {JxPath} path
 * @returns {JxPath | null}
 */
export function parentElementPath(path: JxPath) {
  return path.length >= 2 ? path.slice(0, -2) : null;
}

/**
 * Return the child index (last segment of the path).
 *
 * @param {JxPath} path
 * @returns {string | number}
 */
export function childIndex(path: JxPath) {
  return path.at(-1);
}

/**
 * Serialize a path to a string key for Map lookups.
 *
 * @param {JxPath} path
 * @returns {string}
 */
export function pathKey(path: JxPath) {
  return path.join("/");
}

/**
 * Compare two paths for equality.
 *
 * @param {JxPath | null} a
 * @param {JxPath | null} b
 * @returns {boolean}
 */
export function pathsEqual(a: JxPath | null, b: JxPath | null) {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  return a.every((v, i) => v === b[i]);
}

/* Lives beside the doc-op vocabulary (`@jxsuite/schema/doc-ops`), with the other structural-path
   helpers; re-exported for the many callers that import it from here. */
export { isAncestor } from "@jxsuite/schema/doc-ops";

// ─── Tree flattening (for layer panel) ────────────────────────────────────────

/**
 * Flatten a Jx document into an array of { node, path, depth, nodeType } rows. Walks static
 * children arrays, $map templates, and $switch cases.
 *
 * NodeType: 'element' (default) | 'map' | 'case' | 'case-ref'
 *
 * @param {JxMutableNode | string | number | boolean} doc
 * @param {JxPath} [path]
 * @param {number} [depth]
 * @returns {{
 *   node: JxMutableNode | string | number | boolean;
 *   path: JxPath;
 *   depth: number;
 *   nodeType: string;
 * }[]}
 */
export interface FlatRow {
  node: JxMutableNode | string | number | boolean;
  path: JxPath;
  depth: number;
  nodeType: string;
}

export function flattenTree(
  doc: JxMutableNode | string | number | boolean,
  path: JxPath = [],
  depth = 0,
): FlatRow[] {
  const rows: FlatRow[] = [];
  collectRows(doc, path, depth, rows, false);
  return rows;
}

/**
 * Pre-order walk that appends into `out`.
 *
 * Appending beats returning-and-spreading: `rows.push(...flattenTree(child))` copied every
 * descendant row once per ancestor level (O(n·depth) copies) and passed the whole subtree as
 * argument list, which throws `RangeError: too many arguments` on a large enough tree.
 *
 * `skipSelf` omits the node's own row and emits only its descendants — the `$switch` case branch
 * needs that, having already emitted a `case` row with its own nodeType.
 */
function collectRows(
  doc: JxMutableNode | string | number | boolean,
  path: JxPath,
  depth: number,
  out: FlatRow[],
  skipSelf: boolean,
): void {
  // Text node children: bare primitives get a "text" row
  if (isString(doc) || isNumber(doc) || isBoolean(doc)) {
    if (!skipSelf) {
      out.push({ depth, node: doc, nodeType: "text", path });
    }
    return;
  }

  // Array pseudo-element (repeater): a first-class node at its own path. Emit the "map" row, then
  // Recurse into its single template at `[...path, "map"]`. This is reached both when the array is
  // A member of a children array (path `[…, "children", i]`) and the legacy whole-children form
  // (path `[…, "children"]`).
  if (doc.$prototype === "Array") {
    if (!skipSelf) {
      out.push({ depth, node: doc, nodeType: "map", path });
    }
    const mapDef = doc.map;
    if (isNonNullObject(mapDef)) {
      collectRows(mapDef, [...path, "map"], depth + 1, out, false);
    }
    return;
  }

  if (!skipSelf) {
    out.push({ depth, node: doc, nodeType: "element", path });
  }

  // Custom component instances without user-authored children are atomic in the layer tree
  if (doc.$props && displayTagName(doc.tagName).includes("-") && !Array.isArray(doc.children)) {
    return;
  }

  const { children } = doc;

  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      const childPath = [...path, "children", i];
      collectRows(children[i]!, childPath, depth + 1, out, false);
    }
  } else if (isMappedArray(children)) {
    // Legacy whole-children repeater: the array occupies the children slot itself.
    // SAFETY: The repeater in the children slot is the same repeater node a children member is.
    collectRows(children as JxMutableNode, [...path, "children"], depth + 1, out, false);
  }

  // $switch — emit each case as a virtual child
  if (doc.$switch && isNonNullObject(doc.cases)) {
    for (const [caseName, caseDef] of Object.entries(doc.cases)) {
      const casePath = [...path, "cases", caseName];
      if (isNonNullObject(caseDef) && caseDef.$ref) {
        out.push({
          depth: depth + 1,
          node: caseDef,
          nodeType: "case-ref",
          path: casePath,
        });
      } else if (isNonNullObject(caseDef)) {
        out.push({
          depth: depth + 1,
          node: caseDef,
          nodeType: "case",
          path: casePath,
        });
        // Recurse into case children — skipSelf, because the "case" row above already stands in for
        // The case node itself (with its own nodeType).
        collectRows(caseDef, casePath, depth + 2, out, true);
      }
    }
  }
}

/**
 * Get a display label for a node (for layers + overlays).
 *
 * @param {JxMutableNode | null | undefined} node
 * @returns {string}
 */
export function nodeLabel(node: JxMutableNode | null | undefined) {
  if (!node) {
    return "?";
  }
  // $map container (Repeater)
  if (node.$prototype === "Array") {
    const { items } = node;
    const ref = (isRef(items) ? items.$ref : undefined) || "items";
    return `Repeater → ${ref}`;
  }
  if (node.$title) {
    return node.$title;
  }
  if (node.$id) {
    return node.$id;
  }
  if (node.tagName === "slot") {
    const name = node.attributes?.name;
    return isString(name) && name.trim() ? `slot: ${name.trim()}` : "slot";
  }
  /* `displayTagName`, because a tag may be CHOSEN rather than written: this label reached the
     Outline row, the Inspector's header and the jump bar, and a raw read rendered `[object Object]`
     in all three. `a|div` is the honest answer — one element, tag decided at creation. */
  const tag = displayTagName(node.tagName) || "div";
  const suffix = node.$switch ? " ⇆" : "";
  if (isString(node.textContent) && node.textContent.length > 0) {
    return `${tag} — ${node.textContent.slice(0, 24)}${suffix}`;
  }
  return tag + suffix;
}

// ─── Project state (persists across document switches) ────────────────────────
//
// Shape: { root, name, projectRoot, isSiteProject, projectConfig,
//          Dirs: Map<string, DirEntry[]>, expanded: Set<string>,
//          SelectedPath: string|null, searchQuery: string }
// DirEntry: { name, path, type: "file"|"directory", size, modified }

export let projectState: ProjectState | null = null;

/** @param {ProjectState | null} ps */
export function setProjectState(ps: ProjectState | null) {
  projectState = ps;
}

/**
 * Return the current project state, asserting it is non-null. Only call when a project is known to
 * be loaded.
 *
 * @returns {ProjectState}
 */
export function requireProjectState() {
  /* SAFETY: The contract above restricts callers to paths reached after `setProjectState` installed
     a project (a project command, a panel that only mounts with one open); nothing here checks it. */
  return projectState as ProjectState;
}
