---
status: stub
disposition: implement
claims:
  - studio-ui-guidelines.md#8.2
size: M
workspaces:
  - packages/studio
---

# Every drag in Studio has a non-drag route: statement reorder, Files-tree moves, tab order and grid column order close the gap

## Context

`specs/studio-ui-guidelines.md` §8.2, line 442:

> **Status: Partial.** Pragmatic drag for the outline, the canvas (from the block action bar's handle only), the tab strip and the pane grid's right edge ships, with the OS file-drag rules below (`packages/studio/src/panels/dnd.ts`, `src/canvas/iframe-entry.ts`). Four drags have no single-pointer alternative: statement reorder in the logic editor, which has no other route at all (`src/panels/statement-editor.ts`, whose `[part="drag"]` handle in `src/surfaces/statements.json` is `aria-hidden`); a Files-tree move into a folder, reachable otherwise only by typing a path into Rename (`src/files/files.ts`); reordering a tab within its own strip, since `moveTab` (`src/workspace/workspace.ts`) has one caller, the drop handler in `src/panels/tab-drop.ts`, and no command moves a tab along its strip; and reordering a data grid's columns, which Tabulator's `movableColumns` offers by drag alone and `src/grid/grid-view.ts` saves only from `columnMoved`. The indicator bullets name `.dragging` and `.drop-target` classes where the elements style `data-dragging` and `data-drop`.

And the unnumbered "Moving without dragging (WCAG 2.2 SC 2.5.7)" subsection inside it, line 453, which the census corrected from Implemented:

> **Status: Partial.** Cut and paste (`src/editor/context-menu.ts`, announced through `notify`), Move up and Move down (`src/panels/block-action-bar.ts`), Split Right and Open to the Side ship. Statement reorder, a Files-tree move, a tab's place in its own strip and a grid's column order are the exceptions named on §8.2.

Before the census, §8's own marker said drag and drop had no non-dragging alternative at all. That was stale (see the audit record); these four drags are what is left of it.

**What exists**

- The element alternatives: `edit.cut` / `edit.paste` in `packages/studio/src/editor/context-menu.ts` (`notify.success("Cut")`, `"Pasted"`), `selection.moveUp` / `selection.moveDown` in `src/panels/block-action-bar.ts`, click-to-insert in `src/panels/elements-panel.ts` (`insertAtSelection`), `pane.splitRight` and `document.openToSide` in `src/workspace/`.
- Statement reorder: `registerStatementsDnD` in `packages/studio/src/panels/statement-editor.ts` registers pragmatic `draggable` / `dropTargetForElements` per lane and writes through `onChange`; `src/surfaces/statements.json` draws the handle `aria-hidden` with the title "Drag to reorder". No Move Up / Move Down verb and no key path exist.
- Files tree: `adoptFileRow` in `packages/studio/src/files/files.ts` makes every row a drag source and a directory a target (`moveFileEntry`); the only other route is the Rename prompt, whose name is joined onto the parent directory.
- Tab order: `moveTab(tabId, toIndex)` in `packages/studio/src/workspace/workspace.ts` applies the pinned clamp, and its only caller is the pragmatic drop handler in `src/panels/tab-drop.ts`; `src/panels/tab-strip.ts` lists drag reorder as the strip's reorder mechanism. The tab and pane records (`document.nextTab` / `previousTab`, `pane.splitRight`, `pane.compareWith`, `pane.focusPrimary` / `focusSecondary`, `pane.unsplit`) move focus or move a tab between panes, never along a strip, and the kit's tabs behaviour (`packages/ui/src/behaviors/tabs.ts`) moves the caret only.
- Grid column order: `createGridView` in `packages/studio/src/grid/grid-view.ts` sets Tabulator's `movableColumns: true` and saves the order through `saveGridLayout` only from `columnMoved`; a saved view (`src/grid/grid-layout.ts`) re-applies an order but cannot author one.
- Indicators: `data-dragging` and `data-drop` are what `jx-tree-item` and `src/surfaces/tab-strip.json` style (`dnd.ts` records the rename from `data-drop-target`); the `.layer-row.dragging` / `.layer-row.drop-target` and `.file-tree-item.dragging` rules in `styles/panels.css` have no emitter.

**What is missing**

- Statement reorder without a drag: Move up / Move down verbs on a statement row (declared records, so they carry a name, a chord and a palette row per §12.3), with an announcement through `notify` as cut and paste have.
- A Files-tree move without a drag and without typing: cut and paste on file rows, or a "Move to…" verb with a folder picker. Detailing picks one; the section already says why an APG keyboard-drag mode is not the answer.
- Tab reorder without a drag: for example Move Tab Left / Move Tab Right records on `context/tab` and the palette that call `moveTab` with the same pinned clamp and announce through `notify`.
- Grid column order without a drag: a non-drag route (a column menu's Move Left / Move Right, or an order control in the view settings), or a recorded decision that the order is out of scope, with the reason, in §8.2's own text. Detailing decides; SC 2.5.7 has no exception for a view preference, so leaving it needs an argument rather than silence.
- §8.2's indicator bullets rewritten to `data-dragging` / `data-drop`, and the dead `styles/panels.css` rules deleted (a reconcile riding with the implement, since the section is one claim).

**Related**

- `studio.md` §16.3 (the Logic tab in the Bottom dock), §9.1.1 (create, rename, delete), §5.2 (Layers panel).
- `studio-ui-guidelines.md` §14: the WCAG 2.2 row's SC 2.5.7 note and the ATAG row's "keyboard alternative to every drag" become true when this lands; a Standards Alignment note is not a status marker, so the census left them.
- `ui.md` §5.5 (`jx-tree` and the drop attributes).
