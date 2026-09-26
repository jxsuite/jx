---
status: stub
disposition: reconcile
claims:
  - studio.md#5.2
size: S
---

# The Layers Panel section describes the registry-rendered row actions the Outline draws

## Context

`specs/studio.md` §5.2, line 342 (the section was unmarked before the census):

> **Status: Partial.** The drag-and-drop rows, the text rows and the single-walk collapse ship (`packages/studio/src/panels/layers-panel.ts`). The row actions diverge from the text: they are `registry.forPlacement("outline/row")`, shown on the selected and the hovered row, the four move verbs always drawn and disabled with their `requires` sentence when they cannot act, and Delete folded with Duplicate into a ⋮ overflow; the rows are also windowed.

Disposition `reconcile`. The code follows two rules the section predates: §13's "every capability is one command record", which is why the row renders `outline/row` placements instead of five hand-built buttons, and `studio-ui-guidelines.md` §12.3's "disabled with its reason, never hidden", which is why a move that cannot act is drawn disabled rather than omitted. The section's reason for selection-only actions ("the buttons are Spectrum custom elements") went with Spectrum.

**What exists**

- `packages/studio/src/panels/layers-panel.ts`: `OUTLINE_ROW_MAX_ITEMS = 4`, `showActions = grabbable && !editing && (selected || key === _hoveredKey)`, `buildOutlineRows` (the pre-order walk with the running-depth collapse), the windowed row list, `TEXT_PREVIEW_MAX`.
- The records placed on `outline/row`: `selection.moveUp`, `moveDown`, `moveIn`, `moveOut` (`panels/block-action-bar.ts`), `selection.duplicate` and `selection.delete` (`commands/defaults.ts`).
- Tests: `packages/studio/tests/layers-panel-window.test.ts`.

**What is missing**

- The Move Action Buttons paragraph and its table rewritten: registry-rendered, primary selection or hover, four inline verbs disabled with `requires`, the rest in the overflow; the Spectrum rationale removed.
- A sentence on windowing beside "Rendering cost".

**Related**

- studio.md §13.1 (the record), studio-ui-guidelines.md §12.3 (disabled with its reason), studio.md §6.7 (why the move verbs stay single-target).
