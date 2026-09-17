/// <reference lib="dom" />
/**
 * Resolve a completed pragmatic drag over a tab strip or a pane's right edge into a model write.
 *
 * `panels/tab-strip.ts` registers every chip as a source and every strip and chip as a target,
 * `panels/pane-grid.ts` registers the right-edge zone, and both hand their monitor's `onDrop` here
 * with nothing decided yet — the DATA a target's `getData` produced, and nothing else. This module
 * is the one place that DATA becomes a write, which is what keeps the two registration sites (a
 * strip, a grid cell) from having to agree twice about what a drop means.
 *
 * No import of `tab-strip.ts` or `pane-grid.ts`: this module reaches the model through
 * `workspace/workspace.ts` and `workspace/pane-derive.ts`, and the one opener through
 * `files/files.ts` — the same three a keyboard command would use, because a drag and `⌘\` / "Open
 * to the Side" are the same act by a different gesture (studio-ui-guidelines.md §8.2).
 *
 * @docs studio/interface/tabs
 */

import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index";
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import {
  activateTab,
  closePane,
  moveTab,
  moveTabToPane,
  paneById,
  paneIsEmpty,
  promoteTab,
  receivingPane,
  splitRight,
  workspace,
} from "../workspace/workspace";
import { clearPaneDerivation } from "../workspace/pane-derive";
import { openFileInTab } from "../files/files";

/** A tab chip dragged off its own strip. */
export interface TabDragData extends Record<string, unknown> {
  type: "tab";
  tabId: string;
  /**
   * The pane the chip is being dragged FROM, read at drag start — a host can change which pane it
   * draws, so this is never captured earlier than the gesture itself.
   */
  paneId?: string;
}

/** A file row dragged off the Files tree — `files.ts`'s own source shape, read structurally. */
export interface FileDragData extends Record<string, unknown> {
  type: "file-tree";
  entryType: string;
  path: string;
}

export type TabDropSourceData = TabDragData | FileDragData;

/** A slot in a strip — a chip's edge, or the strip's own empty tail when `tabId` is absent. */
export interface TabSlotTarget extends Record<string, unknown> {
  type: "tab-slot";
  paneId: string;
  tabId?: string;
  /** The target's own slot in `paneId`'s order at `getData` time — the tail's length, otherwise. */
  index: number;
}

export interface TabSlotRefusedTarget extends Record<string, unknown> {
  type: "tab-slot-refused";
}

/** The right band of the last pane's stage, armed only while the grid is under {@link MAX_PANES}. */
export interface PaneEdgeTarget extends Record<string, unknown> {
  type: "pane-edge";
  paneId: string;
}

export interface PaneEdgeRefusedTarget extends Record<string, unknown> {
  type: "pane-edge-refused";
}

export type TabDropTarget =
  | TabSlotTarget
  | TabSlotRefusedTarget
  | PaneEdgeTarget
  | PaneEdgeRefusedTarget;

/**
 * Whether `data` — a drag source's own data, exactly as `getInitialData` produced it — is a source
 * this module knows how to land. A directory row is refused HERE, in the data, rather than by
 * omitting a `dropTargetForElements` registration: pragmatic-dnd bubbles a refusal to the next
 * target OUT, and the next target out of a tab strip is the pane cell, which is not a target at all
 * — so an unhandled refusal would not merely do nothing, it would do nothing silently in a way
 * indistinguishable from a bug. Every caller answers `canDrop` with this, so a directory row (or
 * anything else this module has no branch for) is refused at the SOURCE and never reaches a target
 * closure at all.
 */
export function isTabDropSource(data: Record<string, unknown>): data is TabDropSourceData {
  return data.type === "tab" || (data.type === "file-tree" && data.entryType === "file");
}

/**
 * Land a tab at a specific slot of `paneId`, releasing any derivation the pane is borrowing FIRST —
 * the same order `receivingPane` uses, and for the same reason: inserting into a `tabOrder` while
 * `pane.derived` is still set is the one-frame D2 violation its own docstring describes, observable
 * to anything that reads the pane between the two writes.
 */
function placeTab(tabId: string, paneId: string, index: number): void {
  const pane = paneById(paneId);
  if (pane?.derived) {
    clearPaneDerivation(paneId);
  }
  const landed = moveTabToPane(tabId, paneId, index);
  if (!landed) {
    return;
  }
  // A drag is a commitment, exactly as a double-click promoting a preview tab is one.
  promoteTab(tabId);
  activateTab(tabId);
}

/** {@link placeTab}'s file half: land the file's tab at `index`, opening it first if it is not. */
async function placeFile(path: string, paneId: string, index: number): Promise<void> {
  const existing = [...workspace.tabs.values()].find((tab) => tab.documentPath === path);
  if (existing) {
    placeTab(existing.id, paneId, index);
    return;
  }
  await openFileInTab(path, { focus: true, paneId });
  // Idempotent by construction: `openFileInTab` may already have landed the tab at its default
  // Slot, and this re-finds it by path and moves it to the slot the drop actually asked for.
  const opened = [...workspace.tabs.values()].find((tab) => tab.documentPath === path);
  if (opened) {
    placeTab(opened.id, paneId, index);
  }
}

/** The landing index a chip-edge target names, or the tail target's own index when there is none. */
function edgeIndex(target: TabSlotTarget, edge: Edge | null): number {
  if (target.tabId === undefined) {
    return target.index;
  }
  return edge === "left" ? target.index : target.index + 1;
}

async function resolveTabSlotDrop(source: TabDropSourceData, target: TabSlotTarget): Promise<void> {
  const edge = extractClosestEdge(target as unknown as Record<string | symbol, unknown>);
  if (source.type === "tab") {
    if (source.paneId === target.paneId) {
      const pane = paneById(target.paneId);
      if (!pane) {
        return;
      }
      const startIndex = pane.tabOrder.indexOf(source.tabId);
      if (startIndex === -1) {
        return;
      }
      const to =
        target.tabId === undefined
          ? pane.tabOrder.length - 1
          : getReorderDestinationIndex({
              axis: "horizontal",
              closestEdgeOfTarget: edge,
              indexOfTarget: target.index,
              startIndex,
            });
      if (to !== startIndex) {
        moveTab(source.tabId, to);
      }
      return;
    }
    placeTab(source.tabId, target.paneId, edgeIndex(target, edge));
    return;
  }
  await placeFile(source.path, target.paneId, edgeIndex(target, edge));
}

async function resolvePaneEdgeDrop(
  source: TabDropSourceData,
  target: PaneEdgeTarget,
): Promise<void> {
  if (source.type === "tab") {
    // Ignores `target.paneId`: the split moves the tab beside ITS OWN pane, which is the edge zone's
    // Pane by construction — the zone is only armed below `MAX_PANES`, so there is exactly one pane
    // For a dragged tab to have come from.
    const landed = splitRight(source.tabId);
    if (landed) {
      promoteTab(source.tabId);
    }
    return;
  }
  const pane = receivingPane(target.paneId);
  await openFileInTab(source.path, { paneId: pane.id });
  const landed = [...workspace.tabs.values()].some((tab) => tab.documentPath === source.path);
  if (!landed && paneIsEmpty(pane)) {
    // A refusal (a missing file, no editor for the format) must not leave a pane this drop minted
    // Standing empty — the same rule `document.openToSide` applies to its own refusal.
    closePane(pane.id);
  }
}

/**
 * Turn a completed drag into a write. `target` is the drop's own INNERMOST target data, or
 * `undefined` for a drag cancelled off every target — both are legal and both mean nothing landed.
 */
export async function resolveTabDrop(
  source: { data: Record<string, unknown> },
  target: { data: Record<string, unknown> } | undefined,
): Promise<void> {
  if (!target || !isTabDropSource(source.data)) {
    return;
  }
  const sourceData = source.data;
  if (target.data.type === "tab-slot") {
    await resolveTabSlotDrop(sourceData, target.data as TabSlotTarget);
    return;
  }
  if (target.data.type === "pane-edge") {
    await resolvePaneEdgeDrop(sourceData, target.data as PaneEdgeTarget);
  }
  // `tab-slot-refused` / `pane-edge-refused` / anything else: nothing.
}
