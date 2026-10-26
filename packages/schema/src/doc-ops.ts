/**
 * The canonical Jx document-op vocabulary, its pure applier, and its inverse. A `JxDocOp` is a
 * value-carrying, replayable mutation of a plain-JSON Jx document tree, addressed by `JxPath`
 * (alternating "children" / index segments for structure, plus node keys). Studio's transaction
 * pipeline records forward/inverse pairs of these for history replay; the collab bridge mirrors
 * them into a shared Y.Doc.
 *
 * This module is deliberately yjs-free and imports types only: the slim canvas-iframe bundle
 * imports the applier for its non-reactive shadow doc, and it MUST stay byte-identical in behavior
 * to the parent's history replay — both sides import this one implementation. It lives in
 * `@jxsuite/schema`, beside the document types, so any host can edit a document the way Studio does
 * without taking yjs: a Durable Object, a headless tool, a test. `@jxsuite/collab/ops` re-exports
 * it.
 *
 * @module @jxsuite/schema/doc-ops
 */

import { isNonNullObject, isNumber, isString } from "./guards";
import type { JsonValue, JxDocumentValue, JxMutableNode, JxPath } from "../types.ts";

/** Value-carrying document mutation, replayable in either direction. */
export type JxDocOp =
  /** Set (or delete, when value is undefined) a key on the node at path. */
  | { op: "set-key"; path: JxPath; key: string; value?: JxDocumentValue | undefined }
  /** Insert a node at parentPath.children[index]. */
  | { op: "insert-child"; parentPath: JxPath; index: number; node: JxMutableNode | string }
  /** Remove parentPath.children[index]. */
  | { op: "remove-child"; parentPath: JxPath; index: number }
  /** Replace parentPath.children[index] with node. */
  | { op: "set-child"; parentPath: JxPath; index: number; node: JxMutableNode | string }
  /** Raw two-splice move: remove fromParent.children[fromIndex], insert at toParent[toIndex]. */
  | {
      op: "move-child";
      fromParentPath: JxPath;
      fromIndex: number;
      toParentPath: JxPath;
      toIndex: number;
    };

export interface JxDocOpPair {
  forward: JxDocOp;
  inverse: JxDocOp;
}

/** JSON round-trip clone — also normalizes away reactive proxies / functions / undefined. */
function jsonClone<T>(value: T): T {
  /* SAFETY: every value cloned here is document data (a node, a children member, or a key's value),
     which is JSON by contract; the round trip reproduces that shape and drops only functions and
     `undefined` members, which the document types already treat as absent. */
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- structuredClone throws on reactive proxies; JSON normalization is the point
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Deep-clone a recorded value (undefined/null pass through; reactive proxies are read through). */
export function cloneValue<T>(v: T): T {
  return v === undefined || v === null ? v : jsonClone(v);
}

/**
 * Walk a plain document tree by path. Paths address nodes by construction; a missing segment
 * surfaces as undefined, so every caller checks the answer before treating it as a node.
 */
export function getNodeAtPath(doc: JxMutableNode, path: JxPath): JxMutableNode | undefined {
  let node: JxMutableNode | undefined = doc;
  for (const key of path) {
    // `== null` also stops at a JSON `null` partway down the path.
    if (node == null) {
      return undefined;
    }
    /* SAFETY: a `JxPath` alternates node keys with a "children" key and an index, so each step
       lands on a node, on a children array (whose only use is the next, numeric, lookup, which an
       array answers as a node would), or on nothing. A path that wrongly ends on a string child or a
       children array reaches a caller as one; `childArray` and `insertableChildren` refuse it. */
    node = node[key] as JxMutableNode | undefined;
  }
  return node;
}

/** The node's children array, lazily created; throws if `node` is itself a children array or mapped. */
export function childArray(node: JxMutableNode): (JxMutableNode | string)[] {
  // Defense-in-depth: a path that resolves to a children array (rather than a node) would
  // Otherwise get a bogus `.children` property tacked on here, silently storing the insert where
  // Nothing renders. Callers must pass a node; fail loudly if they don't.
  if (Array.isArray(node)) {
    throw new TypeError("Cannot insert into a children array; parentPath must point at a node");
  }
  if (!node.children) {
    node.children = [];
  }
  if (!Array.isArray(node.children)) {
    throw new TypeError("Cannot insert into mapped-array children; edit the map template instead");
  }
  return node.children;
}

/**
 * Apply a replayable doc op to a bare document tree. Values/nodes are cloned in, so the tree never
 * aliases the op object. Throws (with a machine-readable reason) when a target path is missing.
 */
export function applyDocOpToDoc(doc: JxMutableNode, op: JxDocOp): void {
  // Read before the switch: an op from outside may carry a kind the union does not name.
  const { op: kind } = op;
  switch (op.op) {
    case "set-key": {
      const node = getNodeAtPath(doc, op.path);
      if (!node) {
        throw new Error(`doc-op-node-not-found:${op.path.join("/")}`);
      }
      if (op.value === undefined) {
        delete node[op.key];
      } else {
        node[op.key] = cloneValue(op.value);
      }
      return;
    }
    case "insert-child": {
      childArrayAt(doc, op.parentPath).splice(op.index, 0, cloneValue(op.node));
      return;
    }
    case "remove-child": {
      childArrayAt(doc, op.parentPath).splice(op.index, 1);
      return;
    }
    case "set-child": {
      childArrayAt(doc, op.parentPath).splice(op.index, 1, cloneValue(op.node));
      return;
    }
    case "move-child": {
      assertNotIntoOwnSubtree(op);
      /* Both arrays are resolved BEFORE the source is spliced, so a move whose target cannot receive
         children throws with the document untouched rather than having detached the node it could
         not place. */
      const from = childArrayAt(doc, op.fromParentPath);
      const to = childArrayAt(doc, op.toParentPath);
      const [node] = from.splice(op.fromIndex, 1);
      to.splice(op.toIndex, 0, node!);
      return;
    }
    default: {
      break;
    }
  }
  throw new Error(`unknown-doc-op:${kind}`);
}

/**
 * The children array of the node at `parentPath`, lazily created (see {@link childArray}); throws a
 * `TypeError` naming the path when no node is there.
 */
function childArrayAt(doc: JxMutableNode, parentPath: JxPath): (JxMutableNode | string)[] {
  const parent = getNodeAtPath(doc, parentPath);
  if (parent == null) {
    throw new TypeError(`doc-op-node-not-found:${parentPath.join("/")}`);
  }
  return childArray(parent);
}

/**
 * Translate `path` into post-splice coordinates when it descends through `parentPath`'s children at
 * or beyond the spliced index: a removal (delta -1) at the index shifts deeper paths down; an
 * insertion (delta +1, inclusive) shifts them up. Returns `path` unchanged when the splice does not
 * affect it — including when `path` IS `parentPath`, since a splice moves a node's children, never
 * the node.
 *
 * @param {JxPath} parentPath - The node whose children were spliced
 * @param {JxPath} path - The path to translate
 * @param {number} spliceIndex - Where the splice happened
 * @param {number} delta - -1 for a removal, +1 for an insertion
 * @param {boolean} inclusive - Whether a path AT the index shifts (an insertion's rule)
 * @returns {JxPath}
 */
export function shiftPrefixedIndex(
  parentPath: JxPath,
  path: JxPath,
  spliceIndex: number,
  delta: number,
  inclusive: boolean,
): JxPath {
  const depth = parentPath.length;
  const isProperPrefix = depth < path.length && parentPath.every((seg, i) => seg === path[i]);
  const index = path[depth + 1];
  if (!isProperPrefix || path[depth] !== "children" || !isNumber(index)) {
    return path;
  }
  if (inclusive ? index < spliceIndex : index <= spliceIndex) {
    return path;
  }
  const shifted = [...path];
  shifted[depth + 1] = index + delta;
  return shifted;
}

/**
 * Refuse a move into the moved node itself or into its own subtree. Splicing the node out first
 * would detach the very parent the insert was to land in, so the subtree would vanish and no
 * inverse could bring it back.
 */
function assertNotIntoOwnSubtree(op: Extract<JxDocOp, { op: "move-child" }>): void {
  const moved = [...op.fromParentPath, "children", op.fromIndex];
  const target = op.toParentPath;
  if (target.length >= moved.length && moved.every((seg, i) => seg === target[i])) {
    throw new Error(`doc-op-move-into-self:${target.join("/")}`);
  }
}

/**
 * The index a `splice(index, 0, …)` into `length` elements actually inserts at: a negative index
 * counts from the end and an index past the end appends. The applier inserts with `splice`, so an
 * inverse must name the slot the node really landed in, not the one the op asked for.
 */
export function insertionSlot(index: number, length: number): number {
  return index < 0 ? Math.max(length + index, 0) : Math.min(index, length);
}

/**
 * The op that undoes `op`, computed against `doc` as it stands BEFORE `op` is applied.
 *
 * Every inverse is expressed in the coordinates of the document after `op` ran, because that is the
 * document it will be applied to. For four kinds that is the op's own coordinates. `move-child` is
 * the one that is not: removing the node shifts every sibling path after it under the source
 * parent, and inserting it shifts every sibling path at or after the target index under the
 * destination parent, so each parent path of the inverse is translated through the other splice.
 * The rule is the one Studio's own move has always recorded.
 *
 * **One residue is not undone, deliberately.** Inserting or moving a node into a parent with no
 * `children` creates the array (the applier's `childArray` does), and undoing it removes the node
 * but leaves `children: []`. A single op cannot both move a node back and delete a key, and
 * Studio's own history has always recorded exactly these inverses, so matching it is the contract;
 * an empty `children` array renders as nothing and validates as the absent key does.
 *
 * An index the applier would clamp (`splice` appends past the end and counts a negative index from
 * it) is recorded as the slot the node actually lands in.
 *
 * Throws when the op cannot be applied: its target does not resolve, an insert or move targets
 * something that cannot hold children, or a move targets the moved node's own subtree. An op that
 * cannot be applied has nothing to undo, and a caller that computed an inverse for it would record
 * a history entry for an edit that never happened.
 *
 * @param {JxMutableNode} doc - The document the op is about to be applied to
 * @param {JxDocOp} op
 * @returns {JxDocOp}
 */
export function inverseOf(doc: JxMutableNode, op: JxDocOp): JxDocOp {
  // Read before the switch: an op from outside may carry a kind the union does not name.
  const { op: kind } = op;
  assertIntegerIndexes(op);
  switch (op.op) {
    case "set-key": {
      const node = getNodeAtPath(doc, op.path);
      if (node === undefined) {
        throw new Error(`doc-op-node-not-found:${op.path.join("/")}`);
      }
      /* A key set on a text child or a children array lands nowhere a renderer reads, so the edit
         would succeed without effect; on `null` it would throw mid-transaction. */
      if (!isNonNullObject(node) || Array.isArray(node)) {
        throw new TypeError(`doc-op-not-a-node:${op.path.join("/")}`);
      }
      const before = cloneValue(node[op.key]);
      return before === undefined
        ? { key: op.key, op: "set-key", path: op.path }
        : { key: op.key, op: "set-key", path: op.path, value: before };
    }
    case "insert-child": {
      const { length } = insertableChildren(doc, op.parentPath);
      return {
        index: insertionSlot(op.index, length),
        op: "remove-child",
        parentPath: op.parentPath,
      };
    }
    case "remove-child": {
      const removed = existingChild(doc, op.parentPath, op.index);
      return { index: op.index, node: removed, op: "insert-child", parentPath: op.parentPath };
    }
    case "set-child": {
      const replaced = existingChild(doc, op.parentPath, op.index);
      return { index: op.index, node: replaced, op: "set-child", parentPath: op.parentPath };
    }
    case "move-child": {
      assertNotIntoOwnSubtree(op);
      const source = childrenAt(doc, op.fromParentPath);
      assertIndex(source, op.fromParentPath, op.fromIndex);
      const target = insertableChildren(doc, op.toParentPath);
      // The target's length after the removal: the same array when the move stays in one parent.
      const toIndex = insertionSlot(op.toIndex, target.length - (target === source ? 1 : 0));
      return {
        fromIndex: toIndex,
        // The removal shifted paths under the source parent; the insertion, under the target.
        fromParentPath: shiftPrefixedIndex(
          op.fromParentPath,
          op.toParentPath,
          op.fromIndex,
          -1,
          false,
        ),
        op: "move-child",
        toIndex: op.fromIndex,
        toParentPath: shiftPrefixedIndex(op.toParentPath, op.fromParentPath, toIndex, 1, true),
      };
    }
    default: {
      break;
    }
  }
  throw new Error(`unknown-doc-op:${kind}`);
}

/**
 * Throw `doc-op-index:<path>` unless every index the op carries is an integer. A numeric string, a
 * fraction or `NaN` would reach `splice`, which coerces or truncates it, so the op would land in a
 * slot its recorded inverse does not name. Producers coerce canonical numeric strings before they
 * build an op; this is the defence behind them.
 */
function assertIntegerIndexes(op: JxDocOp): void {
  const indexes: [JxPath, unknown][] = [];
  if (op.op === "move-child") {
    indexes.push([op.fromParentPath, op.fromIndex], [op.toParentPath, op.toIndex]);
  } else if (op.op === "insert-child" || op.op === "remove-child" || op.op === "set-child") {
    indexes.push([op.parentPath, op.index]);
  }
  for (const [parentPath, index] of indexes) {
    if (!Number.isInteger(index)) {
      throw new TypeError(`doc-op-index:${[...parentPath, "children", String(index)].join("/")}`);
    }
  }
}

/** The node's existing children array, or null when it has none (or is not a node). */
function childrenAt(doc: JxMutableNode, parentPath: JxPath): (JxMutableNode | string)[] | null {
  const parent = getNodeAtPath(doc, parentPath);
  return parent && Array.isArray(parent.children) ? parent.children : null;
}

/** Throw the applier's reason unless `children` holds an element at `index`. */
function assertIndex(
  children: (JxMutableNode | string)[] | null,
  parentPath: JxPath,
  index: number,
): asserts children is (JxMutableNode | string)[] {
  if (!children || index < 0 || index >= children.length) {
    throw new Error(`doc-op-node-not-found:${[...parentPath, "children", index].join("/")}`);
  }
}

/** A clone of `parentPath`'s child at `index`, or the applier's reason when there is none. */
function existingChild(
  doc: JxMutableNode,
  parentPath: JxPath,
  index: number,
): JxMutableNode | string {
  const children = childrenAt(doc, parentPath);
  assertIndex(children, parentPath, index);
  // `assertIndex` has just proven `index` is in range.
  return cloneValue(children[index]!);
}

/**
 * The children array an insert into `parentPath` lands in — an empty stand-in when the node has no
 * `children` yet, since the applier creates one — or the reason it cannot land: no node there, a
 * children array addressed as if it were a node, or a mapped-array `children`.
 */
function insertableChildren(doc: JxMutableNode, parentPath: JxPath): (JxMutableNode | string)[] {
  const node = getNodeAtPath(doc, parentPath);
  // A path that ends on a string child or a children array is refused here, not just a missing one.
  if (!isNonNullObject(node) || Array.isArray(node)) {
    throw new Error(`doc-op-node-not-found:${parentPath.join("/")}`);
  }
  if (node.children === undefined) {
    return [];
  }
  if (!Array.isArray(node.children)) {
    throw new TypeError(`doc-op-mapped-children:${parentPath.join("/")}`);
  }
  return node.children;
}

/**
 * Apply `ops` to `doc` in order, answering the forward/inverse pair for each — the record a history
 * entry, an undo stack or a journal needs. Each inverse is computed against the document as it
 * stands just before its own op, so a sequence whose later ops address what earlier ones created is
 * recorded correctly. Undo applies the inverses in REVERSE order.
 *
 * Stops at the first op that does not apply and rethrows its reason; the ops before it have been
 * applied, and their pairs are on the error as `applied`, so a caller can roll them back.
 *
 * @param {JxMutableNode} doc
 * @param {readonly JxDocOp[]} ops
 * @returns {JxDocOpPair[]}
 */
export function applyDocOpsWithInverse(doc: JxMutableNode, ops: readonly JxDocOp[]): JxDocOpPair[] {
  const pairs: JxDocOpPair[] = [];
  for (const forward of ops) {
    let inverse: JxDocOp;
    try {
      inverse = inverseOf(doc, forward);
      applyDocOpToDoc(doc, forward);
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        applied: pairs,
      });
    }
    pairs.push({ forward, inverse });
  }
  return pairs;
}

// ─── Paths ───────────────────────────────────────────────────────────────────

/**
 * Whether `path` is an ancestor of (or equal to) `descendant`.
 *
 * @param {JxPath} path
 * @param {JxPath} descendant
 * @returns {boolean}
 */
export function isAncestor(path: JxPath, descendant: JxPath): boolean {
  if (path.length > descendant.length) {
    return false;
  }
  return path.every((v, i) => v === descendant[i]);
}

/**
 * Order two paths the way the document reads: parents before children, siblings by index.
 *
 * Segments are compared pairwise; numbers numerically (so `children/10` follows `children/9`), and
 * anything else by string order. A prefix sorts before what extends it.
 *
 * @param {JxPath} a
 * @param {JxPath} b
 * @returns {number}
 */
export function comparePaths(a: JxPath, b: JxPath): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) {
      continue;
    }
    if (isNumber(x) && isNumber(y)) {
      return x - y;
    }
    return String(x) < String(y) ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * Drop any path whose ancestor is also in the list.
 *
 * Deleting a `<section>` and one of its own paragraphs is one deletion, not two: the paragraph goes
 * with its parent, and a second splice into coordinates that no longer exist is how a batch
 * corrupts a document.
 *
 * @param {readonly JxPath[]} paths
 * @returns {JxPath[]}
 */
export function topLevelSelection(paths: readonly JxPath[]): JxPath[] {
  const top: JxPath[] = [];
  for (const path of paths) {
    if (!paths.some((q) => !samePath(q, path) && isAncestor(q, path))) {
      top.push([...path]);
    }
  }
  return top;
}

function samePath(a: JxPath, b: JxPath): boolean {
  return a.length === b.length && isAncestor(a, b);
}

/** Where a structural verb splices: the parent element's path and the index in its children. */
export interface SpliceCoordinate {
  parentPath: JxPath;
  index: number;
}

/**
 * The splice coordinate `path` names, or `null` for no path and for every path
 * {@link isSpliceablePath} refuses.
 *
 * @param {JxPath | null | undefined} path
 * @returns {SpliceCoordinate | null}
 */
export function spliceCoordinate(path: JxPath | null | undefined): SpliceCoordinate | null {
  const index = path?.at(-1);
  return path && path.at(-2) === "children" && isNumber(index)
    ? { index, parentPath: path.slice(0, -2) }
    : null;
}

/**
 * Whether `path` names a position a structural edit can splice: a tail of `"children"` + index.
 *
 * Every structural edit reaches its parent by dropping the last two segments and its position by
 * taking the last. That produces a splice coordinate for exactly one path shape, and a document
 * holds three others a caller can name: the document element (`[]`), a repeater's map template
 * (`[…, "children", "map"]`) and a `$switch` case (`[…, "cases", "warn"]`). For the template, the
 * parent resolves to a children ARRAY, so the splice throws mid-edit; for a case it splices at
 * `NaN` and takes the wrong child.
 *
 * @param {JxPath} path
 * @returns {boolean}
 */
export function isSpliceablePath(path: JxPath): boolean {
  return spliceCoordinate(path) !== null;
}

/**
 * The order a structural batch must run in: contained paths dropped, unspliceable paths dropped,
 * then LAST node first.
 *
 * Descending document order is what makes a loop of splices safe. Removing or duplicating at index
 * `n` renumbers every sibling after `n`, so a batch that starts at the end never touches a
 * coordinate a later step still needs.
 *
 * Containment is decided BEFORE spliceability, on the paths as given: a repeater template still
 * shadows its own descendants, so naming the template and something inside it yields nothing rather
 * than quietly deleting the child nobody pointed at.
 *
 * @param {readonly JxPath[]} paths
 * @returns {JxPath[]} Deepest/last first, every entry a splice coordinate.
 */
export function structuralBatch(paths: readonly JxPath[]): JxPath[] {
  return topLevelSelection(paths)
    .filter((path) => isSpliceablePath(path))
    .toSorted((a, b) => comparePaths(b, a));
}

/**
 * An index written as JSON a model or a form produced, as the integer it names: an integer passes,
 * a canonical decimal string (`"0"`, `"12"`, never `"01"`, `"1.0"` or `" 2"`) becomes its number,
 * and anything else is `null`. Negative integers pass; whether one is meaningful is the caller's.
 *
 * @param {JsonValue | undefined} value - A tool argument or form field, as parsed JSON
 * @returns {number | null}
 */
export function coerceIndex(value: JsonValue | undefined): number | null {
  if (isNumber(value) && Number.isInteger(value)) {
    return value;
  }
  return isString(value) && /^(?:0|[1-9]\d*)$/.test(value) ? Number(value) : null;
}
