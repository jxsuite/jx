/**
 * The tree tools as producers (specs/ai.md §3.9): each one reads a document and answers the doc ops
 * its edit is, or the sentence refusing it, and writes nothing. A host applies the ops in its own
 * transaction, so the same tool edits a Studio tab, a file on disk or a room's document.
 *
 * Descriptions and parameter schemas are the ones the model has always been sent, byte for byte;
 * the ops are the ones Studio's mutators recorded for the same calls, op for op.
 *
 * @module @jxsuite/ai/jx-tools
 * @license MIT
 */

import {
  cloneValue,
  coerceIndex,
  getNodeAtPath,
  insertionSlot,
  isAncestor,
  isSpliceablePath,
  planMove,
} from "@jxsuite/schema/doc-ops";
import type { JxDocOp } from "@jxsuite/schema/doc-ops";
import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import type { JxDocumentValue, JxMutableNode, JxPath, JxStyle } from "@jxsuite/schema/types";
import type { JsonValue } from "../tools.ts";
import type { DocEdit, DocTool } from "./types.ts";

export const PATH_DESCRIPTION =
  "Path to a node in the document, as a JSON array of keys/indices from the root " +
  '(e.g. ["children", 0, "children", 1]). Use read_document to discover valid paths.';

/**
 * A path as the model wrote it, with each index after a `"children"` segment that was written as a
 * canonical numeric string (`"0"`, `"12"`) read as its number. The tool schema admits strings in a
 * path because keys are strings, and the registry's validator admits a numeric string where an
 * integer is declared; either way `["children", "1"]` resolves (an array answers `"1"` as it does
 * `1`) and then fails every splice test downstream, which is how an edit succeeded without effect.
 *
 * @param {JxPath} path
 * @returns {JxPath}
 */
export function coercePath(path: JxPath): JxPath {
  return path.map((segment, at) => {
    const index = at > 0 && path[at - 1] === "children" ? coerceIndex(segment) : null;
    return index ?? segment;
  });
}

/** The node at `path`, or undefined where the path runs off the tree. */
export function nodeAt(doc: Readonly<JxMutableNode>, path: JxPath): JxMutableNode | undefined {
  return getNodeAtPath(doc, path);
}

function refuse(error: string): DocEdit {
  return { error, ok: false };
}

/** Refusal for an index that is not a non-negative integer, naming the argument and its value. */
function indexError(name: string, value: JsonValue | undefined): DocEdit {
  return refuse(
    `${name} must be a non-negative integer, such as 0 or 2 (got ${JSON.stringify(value)}).`,
  );
}

/** What {@link elementAt} answers: the element, or the refusal to hand back. */
type ElementLookup = { node: JxMutableNode; refusal?: never } | { refusal: DocEdit };

/**
 * The element `path` names, or the edit refusing a write there. A key set on a text child or a
 * children array lands where nothing renders it, so the write would report success and change
 * nothing; a primitive value cannot hold keys at all.
 *
 * @param {Readonly<JxMutableNode>} doc
 * @param {JxPath} path
 * @param {string} name - The argument the path came from, as the model knows it
 * @returns {ElementLookup}
 */
function elementAt(doc: Readonly<JxMutableNode>, path: JxPath, name = "path"): ElementLookup {
  const node = nodeAt(doc, path);
  const where = `${name} ${JSON.stringify(path)}`;
  if (node === undefined) {
    return { refusal: refuse(`No node exists at ${where}.`) };
  }
  if (Array.isArray(node)) {
    return {
      refusal: refuse(
        `${where} points at a children array, not a node. Drop the trailing "children" segment.`,
      ),
    };
  }
  if (!isNonNullObject(node)) {
    const what = isString(node) ? "a text child" : "a value";
    return {
      refusal: refuse(`${where} points at ${what}, not a node. Address the element that holds it.`),
    };
  }
  return { node };
}

/**
 * A `set-key` op as Studio's mutators record one: `value` absent or `undefined` deletes the key,
 * and any other value is a clone, so the op never aliases the document or the arguments.
 */
function setKey(path: JxPath, key: string, value: JxDocumentValue | undefined): JxDocOp {
  return { key, op: "set-key", path, value: cloneValue(value) };
}

/**
 * The value a property write stores: `null`, `""` and an absent value delete the key, as every
 * Inspector field always has.
 */
function storedValue(value: JsonValue | undefined): JsonValue | undefined {
  return value === null || value === "" ? undefined : value;
}

/** The document's state entries, or none. */
function stateOf(doc: Readonly<JxMutableNode>): Record<string, JsonValue> | undefined {
  /* SAFETY: `state` is the document's map of entry names to their declarations, every one of them
     JSON; the type names it by its declaration shapes, which are JSON too. */
  return doc.state as Record<string, JsonValue> | undefined;
}

const setProperty: DocTool = {
  description:
    "Set or remove a property on a node (e.g. tagName, textContent, className, style, " +
    "attributes, $props). Pass value: null to remove the property.",
  edit(doc, args) {
    /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `path` is a present
       array and `key` a present string. `value` declares no type, so it is any JSON value or
       absent. A `path` whose items do not resolve is caught by `elementAt` just below. */
    const { key, path: written } = args as { key: string; path: JxPath };
    const path = coercePath(written);
    const target = elementAt(doc, path);
    if (target.refusal) {
      return target.refusal;
    }
    return {
      ok: true,
      ops: [setKey(path, key, storedValue(args.value))],
      // Replacing the children replaces every node under them, so nothing selected there survives.
      selection:
        key === "children" ? { kind: "prune", under: [[...path, "children"]] } : { kind: "keep" },
      summary: `Set "${key}" at ${JSON.stringify(path)}.`,
    };
  },
  name: "set_property",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "array",
        description: PATH_DESCRIPTION,
        items: { type: ["string", "number"] },
      },
      key: {
        type: "string",
        description: 'The property name to set, e.g. "textContent" or "className".',
      },
      value: {
        description: "The new value, or null to remove the property.",
      },
    },
    /*
     * "value" omitted from required: passing null / omitting it means "remove the property",
     * but the registry rejects null on required args (tools.js:181). See `ai.md` §3.6.
     */
    required: ["path", "key"],
  },
};

const addChild: DocTool = {
  description:
    "Insert a new child node into the children array of the node at parentPath, at the " +
    "given index (0 = first child). The node definition follows the Jx document schema " +
    '(e.g. { "tagName": "p", "textContent": "Hello" }).',
  edit(doc, args) {
    /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `parentPath` is a
       present array and `node` a present object. `node` is a model-written tree whose shape the
       schema check after the write judges, and a `parentPath` that does not resolve is caught just
       below. `index` is read untyped: the validator admits a numeric string for an integer, so
       `coerceIndex` decides what it names. */
    const { node: childNode, parentPath: writtenParent } = args as {
      node: JxMutableNode;
      parentPath: JxPath;
    };
    const parentPath = coercePath(writtenParent);
    const index = coerceIndex(args.index);
    if (index === null || index < 0) {
      return indexError("index", args.index);
    }
    const parent = nodeAt(doc, parentPath);
    if (parent === undefined) {
      return refuse(`No node exists at path ${JSON.stringify(parentPath)}.`);
    }
    /* The common failure is a trailing "children" segment (e.g. ["children",0,"children"]):
       add_child appends "children" and the index itself, so an array-valued parentPath would store
       the node where nothing renders it. Refused with a precise message so the loop self-corrects. */
    if (Array.isArray(parent)) {
      return refuse(
        `parentPath ${JSON.stringify(parentPath)} points at a children array, not a node. ` +
          `Drop the trailing "children" segment — add_child appends "children" and the index ` +
          `automatically. For example, to insert into the node at ["children",0,"children",1], ` +
          `pass parentPath: ["children",0,"children",1].`,
      );
    }
    const target = elementAt(doc, parentPath, "parentPath");
    if (target.refusal) {
      return target.refusal;
    }
    if (parent.children !== undefined && !Array.isArray(parent.children)) {
      return refuse("Cannot insert into mapped-array children; edit the map template instead.");
    }
    // Past the end appends, and both the op and the summary name the slot the node really lands in.
    const slot = insertionSlot(index, parent.children?.length ?? 0);
    return {
      ok: true,
      ops: [{ index: slot, node: cloneValue(childNode), op: "insert-child", parentPath }],
      selection: { kind: "keep" },
      summary: `Inserted node at ${JSON.stringify([...parentPath, "children", slot])}.`,
    };
  },
  name: "add_child",
  parameters: {
    type: "object",
    properties: {
      parentPath: {
        type: "array",
        description: `${PATH_DESCRIPTION} Must point at a node, not a children array.`,
        items: { type: ["string", "number"] },
      },
      index: { type: "integer", description: "Position in the children array to insert at." },
      node: {
        type: "object",
        description: 'The Jx node definition to insert, e.g. { "tagName": "div", "children": [] }.',
      },
    },
    required: ["parentPath", "index", "node"],
  },
};

const setStyle: DocTool = {
  description:
    "Set or remove a CSS style property on a node. Style property names use camelCase " +
    '(e.g. "backgroundColor", "fontSize", "borderRadius"). Values are always strings ' +
    '(e.g. "10px", "center", "var(--color-accent)"). Pass value: null to remove.',
  edit(doc, args) {
    /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `path` is a present
       array and `property` a present string; a `path` that does not resolve is caught just below.
       `value` is read untyped and stringified. */
    const { path: written, property } = args as { path: JxPath; property: string };
    const { value } = args;
    const path = coercePath(written);
    const target = elementAt(doc, path);
    if (target.refusal) {
      return target.refusal;
    }
    /* A nested key is a whole rule (`@media …`, `:hover`, `&.active`, `[open]`) whose value is an
       object; written here it would be stringified to "[object Object]". */
    if (/^[@:&[]/.test(property)) {
      return refuse(
        `"${property}" is a nested style rule (a media query, pseudo-class or selector), ` +
          'which set_style cannot write. Use set_property with key "style" and the whole ' +
          "style object instead.",
      );
    }
    const style: JxStyle = { ...target.node.style };
    const val = value == null ? "" : String(value);
    if (val === "") {
      delete style[property];
    } else {
      style[property] = val;
    }
    return {
      ok: true,
      // The last property removed takes the empty `style` object with it.
      ops: [setKey(path, "style", Object.keys(style).length > 0 ? style : undefined)],
      selection: { kind: "keep" },
      summary: `Set style "${property}" at ${JSON.stringify(path)}.`,
    };
  },
  name: "set_style",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "array",
        description: PATH_DESCRIPTION,
        items: { type: ["string", "number"] },
      },
      property: {
        type: "string",
        description: 'CSS property name in camelCase, e.g. "backgroundColor".',
      },
      value: {
        description:
          'CSS value as a string (e.g. "10px", "var(--color-accent)"), or null to remove.',
      },
    },
    /*
     * "value" omitted from required so null / omitted = remove (registry rejects null on
     * required args, tools.js:181). See `ai.md` §3.6.
     */
    required: ["path", "property"],
  },
};

const setText: DocTool = {
  description:
    "Set the textContent of a node. Convenience alias for set_property with key: 'textContent'.",
  edit(doc, args) {
    /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `path` is a present
       array and `value` a present string; a `path` that does not resolve is caught just below. */
    const { path: written, value } = args as { path: JxPath; value: string };
    const path = coercePath(written);
    const target = elementAt(doc, path);
    if (target.refusal) {
      return target.refusal;
    }
    return {
      ok: true,
      // Two `set-key` ops, as the Inspector writes text: the text is the node's one child.
      ops: [setKey(path, "textContent", undefined), setKey(path, "children", [value])],
      selection: { kind: "prune", under: [[...path, "children"]] },
      summary: `Set text at ${JSON.stringify(path)}.`,
    };
  },
  name: "set_text",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "array",
        description: PATH_DESCRIPTION,
        items: { type: ["string", "number"] },
      },
      value: { type: "string", description: "Text content." },
    },
    required: ["path", "value"],
  },
};

const addState: DocTool = {
  description:
    "Add a new reactive state variable under the document's `state` object. The value can be a scalar " +
    '(e.g. 0, ""), a typed object ({ "type": "string", "default": "" }), a computed ' +
    'string ("${state.other}"), a function ({ "$prototype": "Function", "body": "..." }), ' +
    'or a data source ({ "$prototype": "Data", "$src": "./data.json" }).',
  edit(doc, args) {
    /* SAFETY: a strict tool runs only after the registry's `validate()` passed, so `key` is a
       present string. */
    const { key } = args as { key: string };
    const state = stateOf(doc);
    if (state && state[key] !== undefined) {
      return refuse(
        `State key "${key}" already exists. Use update_state to change it, or remove it first.`,
      );
    }
    return {
      ok: true,
      /* The whole `state` object, not the entry: an empty-string default (`"title": ""`) is a value
         here, where a property write would delete it. */
      ops: [setKey([], "state", { ...state, [key]: args.value ?? null })],
      selection: { kind: "keep" },
      summary: `Added state "${key}".`,
    };
  },
  name: "add_state",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: 'State variable name, e.g. "count", "isOpen".' },
      value: {
        description:
          "Initial value or state shape object (scalar, typed, computed, function, or data source).",
      },
    },
    required: ["key", "value"],
  },
};

const updateState: DocTool = {
  description:
    "Update or remove an existing state variable at the document root. Pass value: null to remove.",
  edit(doc, args) {
    /* SAFETY: a strict tool runs only after the registry's `validate()` passed, so `key` is a
       present string. */
    const { key } = args as { key: string };
    const { value } = args;
    const state = stateOf(doc);
    if (!state || state[key] === undefined) {
      return refuse(
        `State key "${key}" does not exist. Use add_state to create it, or check the name. Current state keys: ${Object.keys(state || {}).join(", ") || "(none)"}`,
      );
    }
    const next = { ...state };
    if (value == null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    return {
      ok: true,
      // Removing the last entry drops the empty `state` object, as the Inspector's own removal does.
      ops: [setKey([], "state", Object.keys(next).length > 0 ? next : undefined)],
      selection: { kind: "keep" },
      summary: value == null ? `Removed state "${key}".` : `Updated state "${key}".`,
    };
  },
  name: "update_state",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: 'State variable name to update, e.g. "count".' },
      value: {
        description: "New value (same shapes as add_state), or null to remove the state variable.",
      },
    },
    /*
     * "value" omitted from required so null = remove (registry rejects null on required
     * args, tools.js:181). See `ai.md` §3.6.
     */
    required: ["key"],
  },
};

const moveNode: DocTool = {
  description:
    "Move a node from one location to another in the document tree. The node is removed " +
    "from fromPath and inserted into toParentPath at toIndex.",
  edit(doc, args) {
    /* SAFETY: a strict tool runs only after the registry's `validate()` passed: both paths are
       present arrays, and paths that do not resolve are caught just below. `toIndex` is read
       untyped: the validator admits a numeric string for an integer, so `coerceIndex` decides what
       it names. */
    const written = args as { fromPath: JxPath; toParentPath: JxPath };
    const fromPath = coercePath(written.fromPath);
    const toParentPath = coercePath(written.toParentPath);
    const toIndex = coerceIndex(args.toIndex);
    if (toIndex === null || toIndex < 0) {
      return indexError("toIndex", args.toIndex);
    }
    if (fromPath.length < 2) {
      return refuse("Cannot move the document root.");
    }
    if (nodeAt(doc, fromPath) === undefined) {
      return refuse(`No node exists at fromPath ${JSON.stringify(fromPath)}.`);
    }
    if (!isSpliceablePath(fromPath)) {
      return refuse(
        `fromPath ${JSON.stringify(fromPath)} is not a child in a children array, so it ` +
          "cannot be moved. A $switch case or a repeater's template is changed with " +
          "set_property on the node that holds it.",
      );
    }
    const target = elementAt(doc, toParentPath, "toParentPath");
    if (target.refusal) {
      return target.refusal;
    }
    if (isAncestor(fromPath, toParentPath)) {
      return refuse(
        `Cannot move a node into itself or its own descendants: toParentPath ` +
          `${JSON.stringify(toParentPath)} is inside fromPath ${JSON.stringify(fromPath)}.`,
      );
    }
    /* SAFETY: `fromPath` resolves and is a splice coordinate, so its parent is a node with a static
       children array holding it, and `toParentPath` resolves to a node: every case in which
       `planMove` answers null was refused above. */
    const { forward, inverse } = planMove(doc, fromPath, toParentPath, toIndex)!;
    // Where the node is after the move, which the summary must name for the next call to use.
    const landed = [...inverse.fromParentPath, "children", inverse.fromIndex];
    return {
      ok: true,
      ops: [forward],
      selection: { from: fromPath, kind: "follow", to: landed },
      summary: `Moved node from ${JSON.stringify(fromPath)} to ${JSON.stringify(landed)}.`,
    };
  },
  name: "move_node",
  parameters: {
    type: "object",
    properties: {
      fromPath: {
        type: "array",
        description: `${PATH_DESCRIPTION} The node to move.`,
        items: { type: ["string", "number"] },
      },
      toParentPath: {
        type: "array",
        description: `${PATH_DESCRIPTION} The target parent (a node, not a children array).`,
        items: { type: ["string", "number"] },
      },
      toIndex: {
        type: "integer",
        description: "Insertion index in the target parent's children array.",
      },
    },
    required: ["fromPath", "toParentPath", "toIndex"],
  },
};

/** The tree tools, in the order the model has always been offered them. */
export const DOC_TOOLS: readonly DocTool[] = [
  setProperty,
  addChild,
  setStyle,
  setText,
  addState,
  updateState,
  moveNode,
];
