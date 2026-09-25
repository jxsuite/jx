/// <reference lib="dom" />
/**
 * The Data panel's value tree, as a Jx document over the kit.
 *
 * This is the adapter. `panels/data-explorer.ts` keeps the tree — what a value reads as, where the
 * item, key and depth caps fall, and what raising one means — and hands this module a flat list of
 * rows that already carry their own indent. The document renders that list and nothing else.
 *
 * The flattening happens on this side of the seam for the same reason the Overview section flattens
 * its error into five booleans: a document's one repeater walks a LIST, and JSON nests to any
 * depth, so the recursion belongs to the walk rather than to the markup.
 *
 * **One document per tree, and there are several at once.** The Data panel opens as many rows as
 * the reader asks it to, each with its own value under it, so this module is keyed by host rather
 * than being a singleton: a repaint finds the mount already standing in a host and only assigns to
 * its scope, which is what keeps the reader's scroll position inside a long tree and stops a
 * repeated `afterRender` from rebuilding what is already on screen.
 *
 * @docs studio/logic/data
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import dataTreeDoc from "./panel-data.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("panel-data", dataTreeDoc as unknown as JxDocument);

/**
 * One line of a value tree, as the document reads it.
 *
 * Every field is a string, because a binding renders text and a `$switch` chooses on a value: the
 * shape of a line is decided here, not by a conditional the document does not have.
 */
export interface DataTreeRow {
  /**
   * Unique within one tree, and the repeater's key. A raised limit re-renders the whole list, and a
   * keyed row that survives keeps its node — so showing fifty more items does not rebuild the
   * twenty already on screen.
   */
  key: string;
  /** `"row"` for a key and its value; `"more"` for a truncation marker, which is a button. */
  kind: "row" | "more";
  /** This line's own indent, as a CSS length. Depth is a property of the row, not of the tree. */
  indent: string;
  /** `"[0] "` or `"name: "`. Empty for the one line a primitive value renders as. */
  label: string;
  /** What the line says: the value's JSON text, `Array(3)`/`{2}`, or the marker's own label. */
  text: string;
  /**
   * Which colour the value takes: the JSON type name, `"null"`, or `"object"` for a summary label
   * standing in for the lines beneath it. Only the last two are painted today (see the document's
   * style block); the type is carried anyway, so a syntax palette has somewhere to land.
   */
  tone: string;
  /** A marker's tooltip. Empty on a value row. */
  title: string;
  /** The subtree a marker raises the limit of. Empty on a value row. */
  path: string;
  /** Which of that subtree's limits it raises — `items`, `keys` or `depth`. Empty on a value row. */
  limit: string;
}

/** What a marker can ask the panel to do. The panel owns the limit and the repaint. */
export interface DataTreeActions {
  /** Show more of one subtree: raise `limit` on `path` by a step, then repaint the Navigator. */
  showMore: (path: string, limit: string) => void;
}

/** The scope the document reads. */
interface DataTreeScope extends Record<string, unknown>, DataTreeActions {
  rows: DataTreeRow[];
}

interface Mounted {
  scope: DataTreeScope;
  /** `null` while the mount is still in flight — which is a standing surface, not a missing one. */
  handle: SurfaceHandle | null;
  /** Set when the host was given up, so a mount that settles afterwards takes itself down. */
  disposed: boolean;
}

/**
 * Every standing tree, by the host it was mounted into.
 *
 * A strong `Map` rather than a `WeakMap`: `mountSurface` records each mount in the surface registry
 * by host, so a tree whose row was collapsed has to be DISPOSED rather than merely forgotten, and
 * {@link disposeDetachedDataTrees} is what walks this to find them.
 */
const mounts = new Map<HTMLElement, Mounted>();

/**
 * Draw one value tree into `host`, or bring the one already there up to date.
 *
 * @param {HTMLElement} host The element the panel's template left for this tree.
 * @param {DataTreeRow[]} rows The flattened tree, in the order it is read.
 * @param {DataTreeActions} actions What a marker may do — read once, when the surface is mounted.
 */
export function renderDataTreeSurface(
  host: HTMLElement,
  rows: DataTreeRow[],
  actions: DataTreeActions,
): void {
  const existing = mounts.get(host);
  if (
    existing &&
    !existing.disposed &&
    (existing.handle === null || existing.handle.root.isConnected)
  ) {
    existing.scope.rows = rows;
    return;
  }
  takeDown(host, existing);
  host.textContent = "";
  const scope = reactive({ rows, showMore: actions.showMore }) as DataTreeScope;
  const record: Mounted = { disposed: false, handle: null, scope };
  mounts.set(host, record);
  /* No race to arbitrate: a repaint arriving while this is in flight takes the branch above — a
     record with no handle yet IS the standing one — so a second mount into the same host cannot
     start before this settles. A host given up in the meantime is what `disposed` answers. */
  void mountSurface("panel-data", scope, host).then((handle) => {
    if (record.disposed) {
      handle.dispose();
      return;
    }
    record.handle = handle;
  });
}

/**
 * Take down every tree whose host has left the document.
 *
 * A row the reader collapsed takes its host with it, and the mount registry holds the host by
 * reference, so nothing would ever release it. Called once at the top of each of the panel's
 * post-render passes rather than per host, which is the only moment this module hears about a
 * collapse at all.
 */
export function disposeDetachedDataTrees(): void {
  for (const [host, record] of mounts) {
    if (!host.isConnected) {
      takeDown(host, record);
    }
  }
}

/** Give up a host: stop its mount (or the one still arriving) and forget it. */
function takeDown(host: HTMLElement, record: Mounted | undefined): void {
  if (!record) {
    return;
  }
  record.disposed = true;
  record.handle?.dispose();
  record.handle = null;
  mounts.delete(host);
}
