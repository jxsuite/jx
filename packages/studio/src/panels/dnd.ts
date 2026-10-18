/// <reference lib="dom" />
/**
 * DnD registration functions — extracted from studio.js (Phase 4). Registers drag-and-drop behavior
 * on layer rows, component cards, and element cards.
 */

import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { isNumber } from "@jxsuite/schema/guards";
import { disableNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview";
import {
  attachInstruction,
  extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";

import {
  childIndex,
  childList,
  getNodeAtPath,
  isAncestor,
  leftPanel,
  parentElementPath,
  renderOnly,
} from "../store";
import { mutateInsertNode, mutateMoveNode, transactDoc } from "../tabs/transact";
import { primarySelection } from "../tabs/selection";
import { activeTab } from "../workspace/workspace";
import { view } from "../view";
import { buildComponentInstance, componentRegistry } from "../files/components";
import { mutateImportComponent } from "../editor/insert-component";
import { renderComponentPreview } from "./component-preview";
import { defaultDef, unsafeTags } from "./shared";
import { elementAtPoint } from "../utils/geometry";
import type { JxPath } from "../state";
import type { Tab } from "../tabs/tab";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { ComponentEntry } from "../files/components.js";
import type { ElementDragPayload } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import type { DropTargetRecord } from "@atlaskit/pragmatic-drag-and-drop/types";

interface DragCanDragArgs {
  element: HTMLElement;
  input: { clientX: number; clientY: number };
}

/** The `onGenerateDragPreview` argument subset we forward to {@link disableNativeDragPreview}. */
interface DragPreviewArgs {
  nativeSetDragImage: ((image: Element, x: number, y: number) => void) | null;
}

/** Where a drop instruction inserts: the parent's path and the index among its children. */
interface DropSlot {
  parent: JxPath;
  index: number;
}

/**
 * How the drag island addresses the Outline, which is a Jx document and emits no classes.
 *
 * `surfaces/panel-outline.json` is the tree; `part` is the only style and query hook a document
 * offers (`ui.md` §3.1), so these three selectors are the contract between it and this module.
 *
 * The two per-row STATES this file writes are `jx-tree-item`'s own, and that is the whole of what
 * the kit changed here: the element STYLES `data-dragging` and `data-drop` and deliberately BINDS
 * neither, because a prop mirroring either would be a second writer that a repaint clears mid-drag.
 * `data-drop-target` is what this file used to write, and it was a name only this file and one
 * stylesheet rule knew — so the row wore a state the element could not draw. The verb cluster is
 * `[part="verbs"]` rather than `[part="actions"]` for the neighbouring reason: `actions` is the
 * name of the ELEMENT's slot container, and a selector that matched both would be answering about
 * whichever the query happened to reach first.
 */
const OUTLINE_ROOT = '[part="outline"]';
const OUTLINE_ROWS = '[part="row"]';
const OUTLINE_ACTIONS = '[part="verbs"]';

/**
 * The frame a queued Outline registration is waiting on, so a second call REPLACES it.
 *
 * Null whenever nothing is queued — including from inside the callback, which clears it before it
 * registers anything, so a completed frame leaves nothing to cancel.
 */
let _layersFrame: number | null = null;

/**
 * Register DnD on the Outline's rows — called from the panel's mount, after every repaint.
 *
 * **This function owns `view.dndCleanups`, and that ownership is the fix for 369 warnings a
 * session.** The caller used to release the list and then call this, which is correct only if the
 * registrations are made by the time the next caller looks — and they are not: the `rAF` below
 * defers them past the point the caller believes they happened. Two repaints inside one frame
 * therefore both found an EMPTY list, released nothing, and queued two registration passes that ran
 * back to back over the same surviving row elements. Pragmatic-dnd said so, twice per row, forever:
 * "You have already registered a `draggable` on the same element".
 *
 * So the release happens HERE, where the list's contents are known, and it happens at CALL time
 * rather than in the frame: `view.dndCleanups` then always holds exactly what is registered right
 * now, and no observer can read a list that has been superseded. The pending frame is cancelled
 * with it, because a registration nobody has made yet is not one worth making twice.
 *
 * The `rAF` itself stays. The Outline's rows arrive when the runtime's reactive scope commits,
 * which is a microtask the mount cannot await — the surface handle's `ready` promise resolves once,
 * at the FIRST mount, and every repaint after that settles before the rows it projected exist.
 * Registering synchronously would walk the previous window's rows.
 */
export function registerLayersDnD() {
  if (_layersFrame !== null) {
    cancelAnimationFrame(_layersFrame);
  }
  for (const cleanup of view.dndCleanups) {
    cleanup();
  }
  view.dndCleanups = [];
  _layersFrame = requestAnimationFrame(() => {
    _layersFrame = null;
    const container = leftPanel?.querySelector<HTMLElement>(OUTLINE_ROOT);
    if (!container) {
      return;
    }

    for (const row of container.querySelectorAll<HTMLElement>("[data-dnd-row]")) {
      /* SAFETY: every `[data-dnd-row]` row is a `jx-tree-item` from panel-outline.json, and the
         element reflects its `value` (the row's path key) onto the host as `data-value`. */
      const rowPath: JxPath = (row.dataset.value as string)
        .split("/")
        .map((s: string) => (/^\d+$/.test(s) ? Math.trunc(Number(s)) : s));
      const rowDepth = Math.trunc(Number(row.dataset.dndDepth)) || 0;
      const isVoid = Object.hasOwn(row.dataset, "dndVoid");
      const isExpanded = Object.hasOwn(row.dataset, "dndExpanded");

      const cleanup = combine(
        draggable({
          canDrag({ element: _el, input }: DragCanDragArgs) {
            const target = elementAtPoint(input.clientX, input.clientY);
            if (target?.closest(OUTLINE_ACTIONS)) {
              return false;
            }
            return true;
          },
          element: row,
          getInitialData() {
            return { path: rowPath, type: "tree-node" };
          },
          onGenerateDragPreview({ nativeSetDragImage }: DragPreviewArgs) {
            // Suppress the browser's native drag image — the cross-frame ghost (Phase 4c) is the
            // Only drag affordance, so a duplicate native preview would double up.
            disableNativeDragPreview({ nativeSetDragImage });
          },
          onDragStart() {
            row.dataset.dragging = "";
            view.layerDragSourceHeight = row.offsetHeight;
            if (isExpanded) {
              hideDescendantRows(row, container);
            }
          },
          onDrop() {
            delete row.dataset.dragging;
            if (isExpanded) {
              renderOnly("leftPanel");
            }
          },
        }),
        dropTargetForElements({
          element: row,
          canDrop({ source }) {
            // Only a tree-node drag carries a path array; a file-tree drag's `path` is a string.
            const srcPath = source.data.path;
            if (Array.isArray(srcPath) && isAncestor(srcPath, rowPath)) {
              return false;
            }
            return true;
          },
          getData({
            input,
            element,
          }: {
            input: Parameters<typeof attachInstruction>[1]["input"];
            element: Element;
          }) {
            return attachInstruction(
              { path: rowPath },
              {
                block: isVoid ? ["make-child"] : [],
                currentLevel: rowDepth,
                element,
                indentPerLevel: 16,
                input,
                mode: isExpanded ? "expanded" : "standard",
              },
            );
          },
          onDragEnter({ self }) {
            showLayerDropGap(row, self.data, container);
          },
          onDrag({ self }) {
            showLayerDropGap(row, self.data, container);
          },
          // No onDragLeave clear — the gap persists while the pointer crosses dead space
          // Between rows; the monitor clears it when the drag moves to a non-tree target.
          onDrop() {
            clearLayerDropGap(container);
          },
        }),
      );
      view.dndCleanups.push(cleanup);
    }

    // Global monitor
    const monitorCleanup = monitorForElements({
      onDrop({ source, location }) {
        clearLayerDropGap(container);
        const [target] = location.current.dropTargets;
        if (!target) {
          return;
        }
        const instruction = extractInstruction(target.data);
        if (!instruction || instruction.type === "instruction-blocked") {
          return;
        }
        const srcData = source.data;
        /* Only an Outline row's data carries a path. The Logic tab's statement rows attach tree-item
           instructions too, and the drags they accept (statements) are ones applyDropInstruction
           ignores, so a drop there has nothing to apply. */
        const targetPath = target.data.path;
        if (!Array.isArray(targetPath)) {
          return;
        }

        // If the source had children, persist collapse at the new location
        const srcRow = srcData.type === "tree-node" && source.element;
        const wasExpanded = srcRow && Object.hasOwn(srcRow.dataset, "dndExpanded");

        // Parent-originated layer drops legitimately target the active tab.
        applyDropInstruction(activeTab.value, instruction, srcData, targetPath);

        if (wasExpanded) {
          const tab = activeTab.value;
          const newPath = primarySelection(tab?.session.selection);
          if (newPath) {
            view._layersCollapsed ||= new Set();
            const collapsed = view._layersCollapsed;
            collapsed.add(newPath.join("/"));
          }
        }
      },
      onDropTargetChange({ location }) {
        // Clear the layer gap when the drag moves onto a non-tree target (e.g. a canvas
        // Element). When there is no target at all, keep the gap so it persists.
        const [inner] = location.current.dropTargets;
        if (inner && !extractInstruction(inner.data)) {
          clearLayerDropGap(container);
        }
      },
    });
    view.dndCleanups.push(monitorCleanup);
  });
}

/** Register DnD on component rows — called from renderLeftPanel when tab=components */
export function registerComponentsDnD() {
  requestAnimationFrame(() => {
    const container = leftPanel?.querySelector<HTMLElement>(".components-section");
    if (!container) {
      return;
    }

    for (const row of container.querySelectorAll<HTMLElement>("[data-component-tag]")) {
      const tagName = row.dataset.componentTag;
      if (!tagName) {
        continue;
      }
      const comp = componentRegistry.find((c: ComponentEntry) => c.tagName === tagName);
      if (!comp) {
        continue;
      }

      // Fill preview with live rendered component
      const preview = row.querySelector(".element-card-preview");
      if (preview && !preview.querySelector(tagName)) {
        void renderComponentPreview(comp).then((el: HTMLElement) => {
          preview.textContent = "";
          preview.append(el);
        });
      }

      const instanceDef = buildComponentInstance(comp);
      const cleanup = draggable({
        element: row,
        getInitialData() {
          return { fragment: structuredClone(instanceDef), type: "block" };
        },
        onGenerateDragPreview({ nativeSetDragImage }: DragPreviewArgs) {
          disableNativeDragPreview({ nativeSetDragImage });
        },
      });
      view.dndCleanups.push(cleanup);
    }
  });
}

/** Register DnD on element (HTML block) rows */
export function registerElementsDnD() {
  requestAnimationFrame(() => {
    const container = leftPanel?.querySelector<HTMLElement>('[part="content"]');
    if (!container) {
      return;
    }
    for (const row of container.querySelectorAll<HTMLElement>("[data-block-tag]")) {
      // SAFETY: the selector matched on `data-block-tag`, so the attribute is present and this is its text.
      const tag = row.dataset.blockTag as string;
      const preview = row.querySelector(".element-card-preview");
      if (preview && !preview.firstChild) {
        const el = document.createElement(unsafeTags.has(tag) ? "span" : tag);
        el.textContent = tag;
        preview.append(el);
      }
      const def = defaultDef(tag);
      const cleanup = draggable({
        element: row,
        getInitialData() {
          return { fragment: structuredClone(def), type: "block" };
        },
        onGenerateDragPreview({ nativeSetDragImage }: DragPreviewArgs) {
          disableNativeDragPreview({ nativeSetDragImage });
        },
      });
      view.dndCleanups.push(cleanup);
    }
  });
}

/**
 * Hide descendant rows of the dragged item so it appears collapsed during drag.
 *
 * @param {HTMLElement} parentRow
 * @param {HTMLElement} container
 */
function hideDescendantRows(parentRow: HTMLElement, container: HTMLElement) {
  const prefix = `${parentRow.dataset.value}/`;
  const rows = container.querySelectorAll<HTMLElement>(OUTLINE_ROWS);
  for (const r of rows) {
    if (r.dataset.value?.startsWith(prefix)) {
      r.style.display = "none";
    }
  }
}

/**
 * @param {HTMLElement} rowEl
 * @param {DropTargetRecord["data"]} data The row's own drop-target data, carrying its instruction.
 * @param {HTMLElement} container
 */
export function showLayerDropGap(
  rowEl: HTMLElement,
  data: DropTargetRecord["data"],
  container: HTMLElement,
) {
  const instruction = extractInstruction(data);

  // Clear the previous drop-target mark
  if (view._currentDropTargetRow && view._currentDropTargetRow !== rowEl) {
    delete view._currentDropTargetRow.dataset.drop;
  }

  if (!instruction || instruction.type === "instruction-blocked") {
    clearLayerDropGap(container);
    return;
  }

  if (instruction.type === "make-child") {
    clearLayerDropGap(container);
    rowEl.dataset.drop = "";
    view._currentDropTargetRow = rowEl;
    return;
  }

  delete rowEl.dataset.drop;
  view._currentDropTargetRow = rowEl;

  // Shift rows to create gap
  const rows = [...container.querySelectorAll<HTMLElement>(OUTLINE_ROWS)];
  const targetIdx = rows.indexOf(rowEl);
  const gap = view.layerDragSourceHeight;

  for (const [i, row] of rows.entries()) {
    if (row.dataset.dragging !== undefined) {
      continue;
    }
    if (instruction.type === "reorder-above") {
      row.style.transform = i >= targetIdx ? `translateY(${gap}px)` : "";
    } else {
      row.style.transform = i > targetIdx ? `translateY(${gap}px)` : "";
    }
  }
}

/** @param {HTMLElement} container */
export function clearLayerDropGap(container: HTMLElement) {
  if (view._currentDropTargetRow) {
    delete view._currentDropTargetRow.dataset.drop;
    view._currentDropTargetRow = null;
  }
  const rows = container.querySelectorAll<HTMLElement>(OUTLINE_ROWS);
  for (const r of rows) {
    r.style.transform = "";
    // Also clear `display:none` left by hideDescendantRows. The row has no `style`
    // Lit binding, so an imperative style set during the drag survives the post-drop re-render on
    // Whichever row keeps that key — and a move is exactly the edit that hands a key to a different
    // Node. (The rows ARE keyed, by `pathKey`; the earlier form of this note said they were not,
    // Which made the wrong thing sound load-bearing. What is load-bearing is the missing binding.)
    r.style.display = "";
  }
}

/**
 * Where a drop instruction lands relative to `targetPath`.
 *
 * `make-child` appends to the target itself. A reorder lands beside it, which needs a parent and a
 * numeric index, so a reorder (or any other instruction) around a root-level path answers
 * `undefined`: the drop cannot land there at all. `null` is an instruction that lands but inserts
 * nothing, which this module does not apply.
 *
 * @param {JxMutableNode} doc
 * @param {string} type
 * @param {JxPath} targetPath
 * @returns {DropSlot | null | undefined}
 */
function dropSlot(
  doc: JxMutableNode,
  type: string,
  targetPath: JxPath,
): DropSlot | null | undefined {
  if (type === "make-child") {
    return { index: childList(getNodeAtPath(doc, targetPath)).length, parent: targetPath };
  }
  const parent = parentElementPath(targetPath);
  const index = childIndex(targetPath);
  if (!parent || !isNumber(index)) {
    return undefined;
  }
  if (type === "reorder-above") {
    return { index, parent };
  }
  if (type === "reorder-below") {
    return { index: index + 1, parent };
  }
  return null;
}

/**
 * Apply a DnD instruction to `tab`'s document. `tab` is the tab whose canvas the drop resolved in
 * (host-routed for iframe drops — never the active tab at message time, which may have changed
 * while the dropResult was in flight); a null tab is a no-op.
 *
 * @param {Tab | null} tab
 * @param {{ type: string }} instruction
 * @param {ElementDragPayload["data"]} srcData The drag source's own data, as `getInitialData` made
 *   it.
 * @param {JxPath} targetPath
 */
export function applyDropInstruction(
  tab: Tab | null,
  instruction: { type: string },
  srcData: ElementDragPayload["data"],
  targetPath: JxPath,
) {
  if (!tab) {
    return;
  }
  if (srcData.type === "tree-node") {
    /* SAFETY: both minters of a "tree-node" payload — an Outline row's `getInitialData` and the
       block action bar's drag handle — set `path` to the dragged node's JxPath. */
    const fromPath = srcData.path as JxPath;
    const slot = dropSlot(tab.doc.document, instruction.type, targetPath);
    if (slot) {
      transactDoc(tab, (t) => mutateMoveNode(t, fromPath, slot.parent, slot.index));
    }
  } else if (srcData.type === "block") {
    const slot = dropSlot(tab.doc.document, instruction.type, targetPath);
    if (slot === undefined) {
      return;
    }
    /* SAFETY: every minter of a "block" payload — the Insert palette's element and component cards
       and the file drop (`file-drop-action.ts`) — sets `fragment` to the JxMutableNode it inserts. */
    const fragment = srcData.fragment as JxMutableNode;
    /* Auto-import to `$elements` if the dropped block is a custom component, through the rule
       every insertion door shares (`editor/insert-component.ts`, over the one `$elements` service):
       this call site once had its own duplicate rule and matched a local component by
       `ref.endsWith(basename)`, so dropping `./components/card.json` into a page that already
       imported `./vendor/card.json` counted as already imported. The import is part of the same
       transaction as the insert, so one ⌘Z takes back both. */
    if (slot) {
      transactDoc(tab, (t) => {
        mutateInsertNode(t, slot.parent, slot.index, structuredClone(fragment));
        mutateImportComponent(t, fragment.tagName);
      });
    }
  }
}
