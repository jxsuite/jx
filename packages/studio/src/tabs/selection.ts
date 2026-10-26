/**
 * The selection SET — one vocabulary for `session.selection`, now that it is `JxPath[]` (§6.7).
 *
 * ## The invariant this module exists to hold
 *
 * **A selection of one behaves exactly as a selection did before it was a list.** Every surface
 * that addresses a single node — the Inspector's three tabs, the block action bar, the status bar,
 * the canvas overlay box, the context menu — reads {@link primarySelection} and nothing else. When
 * `length === 1` that function returns the sole path, so those surfaces receive byte-identically
 * what `session.selection` used to hand them. Nothing downstream of `primarySelection` can tell the
 * difference, and that is what makes the widening shippable: the multi cases are additions beside
 * the single case, never a rewrite of it.
 *
 * The corollary is a rule about writes: **replace the array, never mutate it in place.** Several
 * render effects track the selection with a bare `void tab.session.selection` read, which
 * subscribes to the property and not to the array's indices; an in-place `push` would move the
 * selection without repainting the panel that draws it. Every helper here returns a NEW array.
 *
 * ## Ordering, and why two ends of the list have names
 *
 * The list is kept in the order the user built it.
 *
 * - {@link selectionAnchor} is `selection[0]` — where a shift-range extends FROM. It survives every
 *   range extension, so shift-clicking A then D then B gives A..D then A..B, which is what every
 *   list in every file manager does.
 * - {@link primarySelection} is the LAST element — the most recently added path, and therefore the
 *   one the user just pointed at. Single-target surfaces address it.
 *
 * ## Structural batches
 *
 * A multi-node structural edit is one decision and must be one undo step, which `transactDoc`
 * already gives for free — everything mutated inside one call is one history entry. What it does
 * NOT give is index safety: removing `children/0` renumbers `children/1`, so a naive loop over the
 * selection deletes the wrong nodes. {@link structuralBatch} answers that once — descendants
 * dropped, then descending document order, so every splice happens below coordinates nothing later
 * in the batch depends on.
 *
 * It also answers a second question the single-path world never had to ask: whether a selected path
 * is a splice coordinate AT ALL. The Outline gives the document element, a repeater's map template
 * and a `$switch` case rows of their own, and any of them can be ctrl-clicked into a selection
 * beside an ordinary element. {@link isSpliceablePath} is the test, and it is the one thing
 * standing between a mixed selection and a half-applied, unrecorded delete.
 */

import { isAncestor } from "@jxsuite/schema/doc-ops";

import type { JxPath } from "../state";
import { pathsEqual } from "../state";

/* The structural-path helpers live beside the doc-op vocabulary, so any host that edits a document
   the way Studio does orders and filters a batch the same way. Re-exported here, where every
   Studio caller already imports them. */
export {
  comparePaths,
  isSpliceablePath,
  spliceCoordinate,
  structuralBatch,
  topLevelSelection,
} from "@jxsuite/schema/doc-ops";
export type { SpliceCoordinate } from "@jxsuite/schema/doc-ops";

/**
 * The path single-target surfaces address — the most recently added, or `null` when empty.
 *
 * @param {readonly JxPath[] | null | undefined} selection
 * @returns {JxPath | null}
 */
export function primarySelection(selection: readonly JxPath[] | null | undefined): JxPath | null {
  return selection?.at(-1) ?? null;
}

/**
 * The path a shift-range extends from — the first in the list, or `null` when empty.
 *
 * @param {readonly JxPath[] | null | undefined} selection
 * @returns {JxPath | null}
 */
export function selectionAnchor(selection: readonly JxPath[] | null | undefined): JxPath | null {
  return selection?.[0] ?? null;
}

/**
 * Whether `path` is one of the selected paths.
 *
 * @param {readonly JxPath[] | null | undefined} selection
 * @param {JxPath | null} path
 * @returns {boolean}
 */
export function isSelected(
  selection: readonly JxPath[] | null | undefined,
  path: JxPath | null,
): boolean {
  if (!path || !selection) {
    return false;
  }
  return selection.some((p) => pathsEqual(p, path));
}

/**
 * Copy a selection, so nothing can mutate one through the array it was handed.
 *
 * History entries and the collab awareness payload both take a copy for the same reason they always
 * did: `session.selection` is a reactive proxy, and a stored reference to it would follow the live
 * selection instead of recording where it was. (A third caller, the sub-document stack's frames,
 * went with the stack — nothing pushes one any more.)
 *
 * @param {readonly JxPath[]} paths
 * @returns {JxPath[]}
 */
export function cloneSelection(paths: readonly JxPath[]): JxPath[] {
  return clonePaths(paths);
}

/** Copy a list of paths, so no caller can mutate a selection through the array it was handed. */
function clonePaths(paths: readonly JxPath[]): JxPath[] {
  const out: JxPath[] = [];
  for (const path of paths) {
    out.push([...path]);
  }
  return out;
}

/**
 * Ctrl/Cmd-click: add the path when it is absent, remove it when it is present.
 *
 * Adding appends, so the newly clicked path becomes the primary and the anchor is untouched.
 * Removing preserves the order of the survivors — including the anchor, unless the anchor is what
 * was removed.
 *
 * @param {readonly JxPath[]} selection
 * @param {JxPath} path
 * @returns {JxPath[]}
 */
export function toggleSelected(selection: readonly JxPath[], path: JxPath): JxPath[] {
  if (isSelected(selection, path)) {
    return clonePaths(selection.filter((p) => !pathsEqual(p, path)));
  }
  return [...clonePaths(selection), [...path]];
}

/**
 * Shift-click: the contiguous run of `rows` between the anchor and `target`, inclusive.
 *
 * `rows` is the surface's own visible order — the Outline's flattened, expansion-aware row list —
 * because "the range between these two" is a question only the surface that draws them can answer.
 * When the anchor is absent from `rows` (it was collapsed away, or nothing was selected) the range
 * degenerates to `[target]`, which is a plain click.
 *
 * The returned list starts at the anchor end, so the anchor stays `selection[0]` and the target
 * becomes the primary — a further shift-click re-extends from the same anchor.
 *
 * @param {readonly JxPath[]} rows Visible rows in display order.
 * @param {JxPath | null} anchor
 * @param {JxPath} target
 * @returns {JxPath[]}
 */
export function rangeSelection(
  rows: readonly JxPath[],
  anchor: JxPath | null,
  target: JxPath,
): JxPath[] {
  const to = rows.findIndex((p) => pathsEqual(p, target));
  const from = anchor ? rows.findIndex((p) => pathsEqual(p, anchor)) : -1;
  if (to === -1 || from === -1) {
    return [[...target]];
  }
  const slice = from <= to ? rows.slice(from, to + 1) : rows.slice(to, from + 1).toReversed();
  return clonePaths(slice);
}

/**
 * Drop every selected path that `removed` addresses or contains.
 *
 * This is `mutateRemoveNode`'s selection repair, widened: deleting a node used to clear the
 * selection outright, and with a list it clears only the entries the deletion actually invalidated.
 * A one-path selection therefore still ends up empty exactly when it used to.
 *
 * @param {readonly JxPath[]} selection
 * @param {JxPath} removed
 * @returns {JxPath[]}
 */
export function pruneSelection(selection: readonly JxPath[], removed: JxPath): JxPath[] {
  return clonePaths(selection.filter((p) => !isAncestor(removed, p)));
}

/**
 * Deduplicate a list of paths, keeping the FIRST occurrence of each.
 *
 * Keeping the first is what makes `selection.setPaths` idempotent: passing the same list twice — or
 * a list that names one node twice — always lands on the same selection, in the same order, with
 * the same anchor and the same primary.
 *
 * @param {readonly JxPath[]} paths
 * @returns {JxPath[]}
 */
export function uniquePaths(paths: readonly JxPath[]): JxPath[] {
  const out: JxPath[] = [];
  for (const path of paths) {
    if (!out.some((p) => pathsEqual(p, path))) {
      out.push([...path]);
    }
  }
  return out;
}

/**
 * Whether two selections name the same paths in the same order.
 *
 * @param {readonly JxPath[] | null | undefined} a
 * @param {readonly JxPath[] | null | undefined} b
 * @returns {boolean}
 */
export function selectionsEqual(
  a: readonly JxPath[] | null | undefined,
  b: readonly JxPath[] | null | undefined,
): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((p, i) => pathsEqual(p, y[i] ?? null));
}

/** One field's value read across the selection: `mixed` when the selected nodes disagree. */
export interface UnifiedValue<T> {
  mixed: boolean;
  value: T | undefined;
}

/**
 * Collapse one field's value across the selection into a single reading.
 *
 * `{ mixed: true }` is the answer the three inspector tabs render as the **Mixed** provenance
 * state: the selected nodes disagree, so there is no one value to show and typing one would
 * overwrite several different ones. `{ mixed: false, value }` is the answer when they agree — and
 * when the selection is a single node it is ALWAYS that answer, which is why a single selection
 * renders no Mixed state anywhere.
 *
 * Comparison is by JSON shape rather than reference: two nodes that both carry `{ $ref: "#/state/x"
 * }` hold equal values written at different times.
 *
 * @template T
 * @param {readonly T[]} values One per selected node, in selection order.
 * @returns {UnifiedValue<T>}
 */
export function unifyValues<T>(values: readonly T[]): UnifiedValue<T> {
  if (values.length === 0) {
    return { mixed: false, value: undefined };
  }
  const [first] = values;
  const key = JSON.stringify(first ?? null);
  for (let i = 1; i < values.length; i++) {
    if (JSON.stringify(values[i] ?? null) !== key) {
      return { mixed: true, value: undefined };
    }
  }
  return { mixed: false, value: first };
}
