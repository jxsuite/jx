/// <reference lib="dom" />
/**
 * Which Outline rows are open, per tab, and the one rule that follows the selection.
 *
 * The Outline used to remember what the reader CLOSED, so an empty record meant a fully expanded
 * tree and a document with a thousand elements opened as a thousand rows. It now remembers what is
 * OPEN, and the default is a tree closed down to its top level. The record is `TabUi.outlineOpen`
 * (wire data, keyed by `pathKey`), per tab for the reason `dataRows` is: the keys are paths, and a
 * module-global record applied one document's open branches to the next.
 *
 * **The selection rule** (studio.md §5.2). {@link syncOutlineToSelection} runs before every
 * projection and compares the selection against the one it last opened for (`TabUi.outlineSeen`).
 * Only when they DIFFER does it open every strict ancestor of every selected path. It never opens
 * the selected node itself, and it never runs for a repaint, a hover, a scroll or a toggle, so a
 * branch the reader closed stays closed until the selection next moves inside it.
 *
 * @docs studio/design/layers
 */

import { isMappedArray, isNonNullObject } from "@jxsuite/schema/guards";
import { flattenTree, pathKey } from "../state";
import { activeTab } from "../workspace/workspace";
import type { JxPath } from "../state";
import type { Tab } from "../tabs/tab";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { AnyCommand } from "../commands/registry";

/** The document root's key. It is open by default so a page's top level is always shown. */
export const OUTLINE_ROOT_KEY = "";

/** Open one row. */
export function openOutlineKey(tab: Tab, key: string): void {
  tab.session.ui.outlineOpen[key] = true;
}

/** Close one row, forgetting it rather than storing a `false`. */
export function closeOutlineKey(tab: Tab, key: string): void {
  delete tab.session.ui.outlineOpen[key];
}

/**
 * Close everything but the root.
 *
 * The root stays open so the top level of the page still shows; the reader can close it by hand.
 */
export function collapseAllOutline(tab: Tab): void {
  tab.session.ui.outlineOpen = { [OUTLINE_ROOT_KEY]: true };
}

/** Open the given rows (and keep the root open), replacing nothing the reader already opened. */
export function expandOutlineKeys(tab: Tab, keys: Iterable<string>): void {
  const open = tab.session.ui.outlineOpen;
  open[OUTLINE_ROOT_KEY] = true;
  for (const key of keys) {
    open[key] = true;
  }
}

/**
 * Open every strict ancestor of `path` that is a row.
 *
 * Walked over prefixes rather than with `parentElementPath`, because a repeater's template (`[...,
 * "children", 2, "map"]`) and a `$switch` case (`[..., "cases", "name"]`) are rows whose parent row
 * is not two segments up. A prefix ending in the `children` or `cases` slot names no row (it is the
 * array the next segment indexes), so it is skipped; the one exception is a legacy whole-children
 * repeater, whose template path continues with `map` from the slot itself.
 */
export function openOutlineAncestors(tab: Tab, path: JxPath): void {
  for (let length = 0; length < path.length; length++) {
    const last = path[length - 1];
    if ((last === "children" || last === "cases") && path[length] !== "map") {
      continue;
    }
    openOutlineKey(tab, pathKey(path.slice(0, length)));
  }
}

/** The identity of a selection: what {@link syncOutlineToSelection} compares between paints. */
function selectionIdentity(selection: JxPath[]): string {
  return JSON.stringify(selection);
}

/**
 * Open the branches the selection sits in, when the selection is what moved.
 *
 * @returns Whether anything was opened
 */
export function syncOutlineToSelection(tab: Tab): boolean {
  const identity = selectionIdentity(tab.session.selection);
  if (tab.session.ui.outlineSeen === identity) {
    return false;
  }
  tab.session.ui.outlineSeen = identity;
  for (const path of tab.session.selection) {
    openOutlineAncestors(tab, path);
  }
  return true;
}

/**
 * Whether a node has anything under it: children, a repeater template, or `$switch` cases.
 *
 * Pure over the node so both the row model (which has the row) and Expand All (which walks the
 * document and has no rows) answer the same question.
 */
export function isExpandableNode(node: JxMutableNode, nodeType: string): boolean {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const hasMapChildren = isMappedArray(node.children);
  const hasCases =
    Boolean(node.$switch) && isNonNullObject(node.cases) && Object.keys(node.cases).length > 0;
  return hasChildren || hasMapChildren || hasCases || (nodeType === "map" && Boolean(node.map));
}

/**
 * Open every row that has something under it.
 *
 * One pre-order walk of the model with no DOM and no projection, the same walk the Outline already
 * makes on every repaint, so it is O(nodes) however large the document is. What is drawn stays the
 * window's business: opening five thousand rows draws the same twenty.
 */
export function expandAllOutline(tab: Tab): void {
  const keys: string[] = [];
  for (const { node, path, nodeType } of flattenTree(tab.doc.document)) {
    if (nodeType !== "text" && isNonNullObject(node) && isExpandableNode(node, nodeType)) {
      keys.push(pathKey(path));
    }
  }
  expandOutlineKeys(tab, keys);
}

/** What repaints the Outline after a command changed what is open. Set by the panel. */
let _redraw: (() => void) | null = null;

/** The panel hands over its repaint, so a command run from the palette is seen at once. */
export function setOutlineRedraw(redraw: (() => void) | null): void {
  _redraw = redraw;
}

/**
 * The Outline action bar's two verbs, which are also the palette's.
 *
 * View state only, so `undo` is `"none"`: neither touches the document or a file. They act on the
 * active tab, so a run from the palette works with the Outline unmounted; the next mount reads the
 * record they wrote.
 */
export function outlineCommands(): AnyCommand[] {
  return [
    {
      category: "View",
      enablement: (ctx) => ctx.document.open,
      group: "1_tree",
      icon: "arrows-out-line-vertical",
      id: "outline.expandAll",
      level: "document",
      menus: ["outline/toolbar", "palette"],
      order: 1,
      requires: "an open page",
      run: () => {
        const tab = activeTab.value;
        if (tab) {
          expandAllOutline(tab);
          _redraw?.();
        }
      },
      title: "Expand All",
      undo: "none",
    },
    {
      category: "View",
      enablement: (ctx) => ctx.document.open,
      group: "1_tree",
      icon: "arrows-in-line-vertical",
      id: "outline.collapseAll",
      level: "document",
      menus: ["outline/toolbar", "palette"],
      order: 2,
      requires: "an open page",
      run: () => {
        const tab = activeTab.value;
        if (tab) {
          collapseAllOutline(tab);
          _redraw?.();
        }
      },
      title: "Collapse All",
      undo: "none",
    },
  ];
}
