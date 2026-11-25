/**
 * The two-way bridge between Studio's JxDocOp op-log and the shared Y.Doc structure tree.
 *
 * Outbound ({@link applyDocOpsToY}): forward ops recorded by a local transaction replay onto the Y
 * tree inside one Y transaction tagged with the caller's origin, so observers can tell local
 * mirroring from remote edits.
 *
 * Inbound ({@link yEventsToDocOps}): a remote transaction's Y events convert back into JxDocOps for
 * `applyExternalDocOps`. Only provably safe event shapes take this fast path (it keeps canvas
 * patches surgical); anything gnarlier returns null and the caller reconciles by diffing — the
 * correctness anchor.
 */

import * as Y from "yjs";
import { isNumber, isString } from "@jxsuite/schema/guards";
import type { JxPath } from "@jxsuite/schema/types";
import type { JxDocOp } from "./ops.ts";
import {
  applyTextEdit,
  GRANULAR_OBJECT_KEYS,
  resolveYPath,
  TEXT_KEYS,
  TEXT_OBJECT_KEYS,
  toYChild,
  writeNodeKey,
  yChildToJson,
  yValueToJson,
} from "./schema.ts";
import type { YStructureValue } from "./schema.ts";

/** Origin of Y transactions produced by mirroring the local tab's ops. */
export const LOCAL_ORIGIN = "jx-local";
/** Origin of derived-representation writes (the elected reconciler's structure↔source mirrors). */
export const MIRROR_ORIGIN = "jx-mirror";
/** Origin of seeding/bootstrap writes. */
export const SEED_ORIGIN = "jx-seed";

/** Thrown when an op's path does not resolve in the Y tree; callers fall back to diffing. */
export class CollabPathError extends Error {
  constructor(path: JxPath) {
    super(`collab-path-unresolved:${path.join("/")}`);
    this.name = "CollabPathError";
  }
}

function requireNode(doc: Y.Doc, path: JxPath): Y.Map<YStructureValue> {
  const target = resolveYPath(doc, path);
  if (!(target instanceof Y.Map)) {
    throw new CollabPathError(path);
  }
  return target;
}

function childrenOf(doc: Y.Doc, parentPath: JxPath, create: boolean): Y.Array<YStructureValue> {
  const parent = requireNode(doc, parentPath);
  const children = parent.get("children");
  if (children instanceof Y.Array) {
    return children;
  }
  if (create && children === undefined) {
    const fresh = new Y.Array<YStructureValue>();
    parent.set("children", fresh);
    return fresh;
  }
  throw new CollabPathError([...parentPath, "children"]);
}

function applyOneOp(doc: Y.Doc, op: JxDocOp): void {
  // Read before the switch: an op from outside may carry a kind the union does not name.
  const { op: kind } = op;
  switch (op.op) {
    case "set-key": {
      const node = requireNode(doc, op.path);
      if (op.value === undefined) {
        node.delete(op.key);
      } else {
        writeNodeKey(node, op.key, op.value);
      }
      return;
    }
    case "insert-child": {
      const children = childrenOf(doc, op.parentPath, true);
      if (op.index < 0 || op.index > children.length) {
        throw new CollabPathError([...op.parentPath, "children", op.index]);
      }
      children.insert(op.index, [toYChild(op.node)]);
      return;
    }
    case "remove-child": {
      const children = childrenOf(doc, op.parentPath, false);
      if (op.index < 0 || op.index >= children.length) {
        throw new CollabPathError([...op.parentPath, "children", op.index]);
      }
      children.delete(op.index, 1);
      return;
    }
    case "set-child": {
      const children = childrenOf(doc, op.parentPath, false);
      if (op.index < 0 || op.index >= children.length) {
        throw new CollabPathError([...op.parentPath, "children", op.index]);
      }
      // Text child → text child: edit the existing Y.Text in place. A delete+insert would replace the
      // Whole element and discard a peer's concurrent characters, which is the same clobber
      // `writeNodeKey` avoids for `textContent` — bare-string children are the other half of prose.
      const existing = children.get(op.index);
      if (existing instanceof Y.Text && isString(op.node)) {
        applyTextEdit(existing, op.node);
        return;
      }
      children.delete(op.index, 1);
      children.insert(op.index, [toYChild(op.node)]);
      return;
    }
    case "move-child": {
      // Y.Array has no native move: re-insert the node's current JSON at the target. A remote
      // Edit landing inside the moved subtree during the same round-trip is lost (the case
      // Collab.md §3.1 states: Y.Array has no move); convergence itself is unaffected. Both parent paths resolve BEFORE the
      // Removal splice — matching the plain applier's semantics — while toIndex is expressed in
      // Post-removal coordinates (the mutators pre-adjust same-parent moves).
      const from = childrenOf(doc, op.fromParentPath, false);
      const to = childrenOf(doc, op.toParentPath, true);
      if (op.fromIndex < 0 || op.fromIndex >= from.length) {
        throw new CollabPathError([...op.fromParentPath, "children", op.fromIndex]);
      }
      const json = yValueToJson(from.get(op.fromIndex));
      from.delete(op.fromIndex, 1);
      if (op.toIndex < 0 || op.toIndex > to.length) {
        throw new CollabPathError([...op.toParentPath, "children", op.toIndex]);
      }
      to.insert(op.toIndex, [toYChild(json)]);
      return;
    }
    default: {
      throw new Error(`unknown-doc-op:${kind}`);
    }
  }
}

/**
 * Replay forward ops onto the Y structure tree in one transaction. Throws {@link CollabPathError}
 * when any op's path does not resolve — the transaction still commits the ops applied before the
 * failure, so callers catching it must reconcile by diff (which corrects any partial state).
 */
export function applyDocOpsToY(doc: Y.Doc, ops: readonly JxDocOp[], origin: string): void {
  doc.transact(() => {
    for (const op of ops) {
      applyOneOp(doc, op);
    }
  }, origin);
}

/**
 * When `path` addresses a granular container (or something nested inside one), the node that owns
 * it and the key it sits under; otherwise null.
 *
 * The event path is relative to the structure map, so the first segment matching a granular key
 * marks the boundary: everything before it is the node path, and anything after it is interior
 * detail the op log does not model.
 *
 * `children`/index segments need no special handling: they are not granular keys, so the scan
 * passes over them and the returned node path keeps the full prefix — `["children", 0, "style"]`
 * resolves to the style of the node at `children/0`, not of the root.
 */
function granularOwner(path: JxPath): { nodePath: JxPath; key: string } | null {
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    if (!isString(segment)) {
      continue;
    }
    if (
      GRANULAR_OBJECT_KEYS.has(segment) ||
      TEXT_OBJECT_KEYS.has(segment) ||
      segment === "state" ||
      (segment.length > 2 && segment.startsWith("on"))
    ) {
      return { key: segment, nodePath: path.slice(0, i) };
    }
    if (TEXT_KEYS.has(segment)) {
      return { key: segment, nodePath: path.slice(0, i) };
    }
  }
  return null;
}

/**
 * Whether a remote children-array item has a shape this package writes: a node Y.Map or a Y.Text
 * (`toYChild`), or a plain string from a peer still on schema version 1. Anything else came from an
 * off-contract peer, so the inbound fast path bails and the caller reconciles by diffing.
 */
function isChildItem(item: unknown): item is Y.Text | Y.Map<YStructureValue> | string {
  return item instanceof Y.Text || item instanceof Y.Map || isString(item);
}

function isStructurePath(segments: readonly (string | number)[]): segments is JxPath {
  return segments.every((seg) => isString(seg) || isNumber(seg));
}

function sameOwner(
  a: { nodePath: JxPath; key: string } | null,
  b: { nodePath: JxPath; key: string } | null,
): boolean {
  return (
    a !== null &&
    b !== null &&
    a.key === b.key &&
    a.nodePath.length === b.nodePath.length &&
    a.nodePath.every((seg, i) => seg === b.nodePath[i])
  );
}

/**
 * The deepest node path `P` such that every path starts with `[...P, "children"]`, or null when
 * none does: the node whose `children` the events are confined to.
 */
function childrenOwner(paths: readonly JxPath[]): JxPath | null {
  const first = paths[0] ?? [];
  let common = first.length;
  for (const path of paths) {
    let k = 0;
    while (k < common && k < path.length && path[k] === first[k]) {
      k += 1;
    }
    common = k;
  }
  let walked = 0;
  while (walked + 1 < common && first[walked] === "children" && isNumber(first[walked + 1])) {
    walked += 2;
  }
  if (common > walked && first[walked] === "children") {
    return first.slice(0, walked);
  }
  return walked > 0 ? first.slice(0, walked - 2) : null;
}

/**
 * Events that all lie inside one node's `children` collapse to one whole-value `set-key children`
 * for that node, as granular events collapse for the other keys (collab.md §3). Null when no such
 * node exists or its array is gone.
 */
function collapseToChildren(
  events: readonly Y.YEvent<Y.AbstractType<unknown>>[],
  paths: readonly JxPath[],
): JxDocOp[] | null {
  const owner = childrenOwner(paths);
  const doc = events[0]?.target.doc;
  if (owner === null || !doc) {
    return null;
  }
  const array = resolveYPath(doc, [...owner, "children"]);
  if (!(array instanceof Y.Array)) {
    return null;
  }
  return [{ key: "children", op: "set-key", path: owner, value: yValueToJson(array) }];
}

/**
 * Convert a remote transaction's deep events on the structure tree into JxDocOps (positions valid
 * at sequential apply time). Returns null when the shape is not provably safe to convert —
 * overlapping events and more than one array event collapse to one `children` write when they all
 * lie inside one node's children; any other such shape, or a non-contiguous delete run, returns
 * null and the caller must reconcile by diffing instead.
 */
export function yEventsToDocOps(
  events: readonly Y.YEvent<Y.AbstractType<unknown>>[],
): JxDocOp[] | null {
  if (events.length === 0) {
    return [];
  }
  const paths = events.map((event) => event.path);
  if (!paths.every((p) => isStructurePath(p))) {
    return null;
  }
  const owners = paths.map((path) => granularOwner(path));
  // Overlap guard: one event's target must not sit inside another's subtree — later paths would
  // Describe positions the earlier splice already shifted. Events inside one granular container
  // Are exempt: they collapse to a single whole-value op for that container.
  for (let i = 0; i < paths.length; i++) {
    for (let j = 0; j < paths.length; j++) {
      if (i === j) {
        continue;
      }
      const a = paths[i]!;
      const b = paths[j]!;
      if (
        a.length <= b.length &&
        a.every((seg, k) => seg === b[k]) &&
        !sameOwner(owners[i] ?? null, owners[j] ?? null)
      ) {
        return collapseToChildren(events, paths);
      }
    }
  }
  const arrayEvents = events.filter(
    (event, i) => event instanceof Y.YArrayEvent && owners[i] === null,
  ).length;
  if (arrayEvents > 1) {
    return collapseToChildren(events, paths);
  }

  const ops: JxDocOp[] = [];
  for (const event of events) {
    const { path } = event;
    /*
     * A remote edit inside a granular container (a `Y.Text` for prose, a nested `Y.Map` for
     * style/attributes/$props) reports its event at the CONTAINER's path, not the node's. Studio's op
     * vocabulary addresses nodes, so those collapse back to one whole-value op for the owning key —
     * the same shape a local mutator would have produced. Granularity buys merge; it deliberately does
     * not leak into the op log, the canvas patcher, or the history ring.
     */
    const granular = granularOwner(path);
    if (granular) {
      const { doc } = event.target;
      if (!doc) {
        return null;
      }
      const container = resolveYPath(doc, [...granular.nodePath, granular.key]);
      if (container === undefined) {
        return null;
      }
      ops.push({
        key: granular.key,
        op: "set-key",
        path: granular.nodePath,
        value: yValueToJson(container),
      });
      continue;
    }
    if (event instanceof Y.YTextEvent) {
      // A bare-string child: the text IS the child, so it round-trips as a child replacement.
      const index = path.at(-1);
      if (path.at(-2) === "children" && isNumber(index)) {
        ops.push({
          index,
          node: event.target.toString(),
          op: "set-child",
          parentPath: path.slice(0, -2),
        });
        continue;
      }
      return null;
    }
    if (event instanceof Y.YMapEvent) {
      /* SAFETY: these events come from observing the structure map, and a map event that reached
         here is not inside a granular container (handled above), so its target is a node Y.Map,
         which the writers in ./schema.ts fill only with YStructureValue entries. */
      const target = event.target as Y.Map<YStructureValue>;
      for (const [key, change] of event.changes.keys) {
        if (change.action === "delete") {
          ops.push({ key, op: "set-key", path });
        } else {
          ops.push({ key, op: "set-key", path, value: yValueToJson(target.get(key)) });
        }
      }
    } else if (event instanceof Y.YArrayEvent) {
      // The array event's path points at the children array; ops address its parent node.
      if (path.at(-1) !== "children") {
        return null;
      }
      const parentPath = path.slice(0, -1);
      let index = 0;
      for (const delta of event.changes.delta) {
        if (delta.retain !== undefined) {
          index += delta.retain;
        } else if (delta.delete !== undefined) {
          for (let i = 0; i < delta.delete; i++) {
            ops.push({ index, op: "remove-child", parentPath });
          }
        } else if (delta.insert !== undefined) {
          const items = Array.isArray(delta.insert) ? delta.insert : [delta.insert];
          for (const item of items) {
            if (!isChildItem(item)) {
              return null;
            }
            ops.push({ index, node: yChildToJson(item), op: "insert-child", parentPath });
            index += 1;
          }
        }
      }
    } else {
      return null;
    }
  }
  return ops;
}
