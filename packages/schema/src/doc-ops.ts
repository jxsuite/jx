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

import { isNonNullObject, isNumber } from "./guards";
import type { JxDocumentValue, JxMutableNode, JxPath } from "../types.ts";

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
 */
function shiftThroughSplice(
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
function insertionSlot(index: number, length: number): number {
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
  switch (op.op) {
    case "set-key": {
      const node = getNodeAtPath(doc, op.path);
      if (!node) {
        throw new Error(`doc-op-node-not-found:${op.path.join("/")}`);
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
        fromParentPath: shiftThroughSplice(
          op.fromParentPath,
          op.toParentPath,
          op.fromIndex,
          -1,
          false,
        ),
        op: "move-child",
        toIndex: op.fromIndex,
        toParentPath: shiftThroughSplice(op.toParentPath, op.fromParentPath, toIndex, 1, true),
      };
    }
    default: {
      break;
    }
  }
  throw new Error(`unknown-doc-op:${kind}`);
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
