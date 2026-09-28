---
status: drafted
disposition: reconcile
claims:
  - studio.md#5.2
workspaces:
  - packages/studio
  - specs
  - docs
size: S
---

# The Layers Panel section describes the Outline's row actions as the registry renders them, and says the rows are windowed

## Context

`specs/studio.md` §5.2, line 344 (the section was unmarked before the census):

> **Status: Partial.** The drag-and-drop rows, the text rows and the single-walk collapse ship (`packages/studio/src/panels/layers-panel.ts`). The row actions diverge from the text: they are `registry.forPlacement("outline/row")`, shown on the selected and the hovered row, the four move verbs always drawn and disabled with their `requires` sentence when they cannot act, and Delete folded with Duplicate into a ⋮ overflow; the rows are also windowed.

The code follows two rules the section predates: §13's "every capability is one command record", which is why a row renders `outline/row` placements instead of five hand-built buttons, and `studio-ui-guidelines.md` §12.3's "a control that cannot act renders disabled with `requires` in its tooltip, never absent", which is why a move that cannot act is drawn disabled. The section's reason for selection-only actions ("the buttons are Spectrum custom elements") went with Spectrum.

Verified against the tree (paths under `packages/studio/src/`):

- **The cluster.** `outlineRowView` in `panels/layers-panel.ts`: `showActions = grabbable && !editing && (selected || key === _hoveredKey)`, where `grabbable` is an element or repeater row at a numeric child index that is not the root, and `selected` is `isSelected(selection, path)` (`tabs/selection.ts`), true for **every** selected row rather than only the primary one. So under a multiple selection each selected row carries a cluster, and so does the hovered row. Every other row is projected with `commands: []`, not a hidden cluster, and `outlineRowView` runs only for the rows in the window, so the clusters are bounded by the window, not by the document. `rowCommandViews` evaluates `registry.forPlacement("outline/row")` under `withCommandTarget(path)`, draws the first `OUTLINE_ROW_MAX_ITEMS = 4` inline with `disabled` and `commandTooltip` (the chord, or "Title — requires …"), and hands the rest to `showCommandOverflow` behind a `dots-three-vertical` **More actions** button (`surfaces/panel-outline.json`), which prints each row's chord and `requires` and sets a divider above the destructive row.
- **The records.** `selection.moveUp`, `moveDown`, `moveIn`, `moveOut` (`registerSelectionCommands` in `panels/block-action-bar.ts`, groups `1_move_1`…`1_move_4`, gated by `canMoveUp`/`canMoveDown`/`canMoveIn`/`canMoveOut`); `selection.duplicate` (`3_structure`, ⌘D) and `selection.delete` (`9_danger`, `destructive`, Delete/Backspace) in `commands/defaults.ts`. `forPlacement` sorts by `group` then `title`, so the four moves are the inline four. Move Up and Move Down also declare `blockbar`; Move Into Previous and Move Out of Parent declare only `outline/row`.
- **The target.** `commandTargetPaths()` returns exactly the explicit target, so under a multiple selection a row's Duplicate and Delete act on that row alone. A move selects the node at its new path, `mutateDuplicateNodes` selects the copies, `deleteTarget` selects the target's parent; each is one `transactDoc`.
- **The window.** `buildOutlineRows` builds the whole model; `outlineValues` draws `listWindow(...)`'s slice (`ui/virtual-window.ts`, `DEFAULT_OVERSCAN_ROWS = 3`) with `padTop`/`padBottom` spacers; the shift-range, arrows, Home/End, ←, typeahead and reveal read `_outlineRows`; `numberOutlineSets` writes document-wide `aria-posinset`/`aria-setsize`; `outlineWindowChanged` skips the repaint while a row carries `data-dragging`.
- **Text rows.** `textRowView`: badge "text", preview cut at `TEXT_PREVIEW_MAX = 40`, `item: false`, so the arrows and typeahead skip them.
- **The grip.** `jx-tree-item` (`packages/ui/components/jx-tree-item.json`) shows it on a hovered, selected or focus-within row, not only on hover as the Drag and Drop paragraph says, and not "on every row" as the Move Action Buttons paragraph says.
- **Tests** that already assert most of this: `tests/outline-rows.test.ts` (`describe("row actions")`, and "a click in a row's verb cluster does not also move the selection"), `tests/layers-panel-gaps.test.ts` ("first child cannot move up, last cannot move down — disabled, not removed", "move-in is unavailable when the previous sibling is not a container", "the row's inline cluster is the four moves; Duplicate and Delete ride in ⋮", "delete removes the node, from the ⋮ menu", "the root row has no cluster and no grab handle", "the cluster stands aside while the row is being renamed"), and `tests/layers-panel-window.test.ts` (the window, the model-wide shift-range, the ARIA counts, the drag). Every case draws the cluster under a single selection: nothing asserts that each selected row carries one, or that a row's Duplicate and Delete act on that row alone while others are selected (`commandTargetPaths` is referenced by no test).
- **Docs.** `docs/studio/design/layers.md` ("Rearrange the page") already describes the hover rule, the greyed moves and the More actions menu. Its `spec:` names only `studio.md#6.7`.
- Drift noticed in passing: the `OUTLINE_ROW_MAX_ITEMS` doc comment ends "The four moves are on none of those" (the block action bar, the row's context menu, ⌘D / Delete), but Move Up and Move Down are on the block action bar. Implementation step 3 corrects it.

Related: `plan:studio-ui-guidelines/unrendered-placements` retires `context/layer` and makes the outline's right-click the element menu; the text below says "the element menu", which is true before and after it lands.

## Outcome

`studio.md` §5.2 → Implemented (marker deleted): the Row Actions text and table describe the `outline/row` records drawn on each selected row and the hovered row, the four moves inline and disabled with their reason, Duplicate and Delete in More actions, and a sentence set beside "Rendering cost" states the window. The Spectrum rationale is gone.

## Decisions

- **Open:** keep the clusters on the hovered row and on every selected row, where the section explicitly chose the primary selection's row alone? Recommendation: keep both and write them down, because the section's only reason was Spectrum's per-button cost, which left with Spectrum, and the empty projection plus the window bound the cost by the rows on screen however long the document is; a verb on the row under the pointer is the rule `studio-ui-guidelines.md` §12.1's `outline/row` row already states ("row actions act on the row's node"); and `docs/studio/design/layers.md` already teaches it. Reverting would be an implement plan in the other direction (`outlineRowView`'s `showActions`, and the tests that hover a row).
- **Decided:** the moves are drawn disabled, not omitted, because `studio-ui-guidelines.md` §12.3 makes "disabled with `requires`, never absent" normative for every invoking surface. "Only applicable buttons render" contradicted a rule that outranks it, so it is not a revert option.
- **Decided:** the table states each record's gate in words and does not quote its `requires` string, because §13.1 makes `requires` the one copy of that sentence (the tooltip, the palette subtitle and the assistant's refusal all read it). A quoted copy would drift the first time a record's sentence is sharpened, as Duplicate's and Delete's `SPLICEABLE_SELECTION` was.
- **Decided:** the text states that a row's Duplicate and Delete act on that row alone under a multiple selection, because that is what `commandTargetPaths` does and what the `outline/row` matrix row says, while the chords and the block action bar act on the whole selection (§6.7). Leaving it unstated would let a reader apply §6.7's batch rule to the row.
- **Decided:** the heading stays "5.2 Layers Panel" and the first sentence names the Outline, because the panel id is still `layers`, §7.3's heading uses the same name for the panel's other body, and the anchor is the number.
- **Decided:** no behaviour change, but two test cases pin the two sentences no test asserts yet (Context), because a normative sentence with nothing behind it is one a later refactor can falsify silently. That puts `packages/studio`'s matrix leg on the pull request anyway, so the stale `OUTLINE_ROW_MAX_ITEMS` comment is corrected in the same change.

## Implementation

No source behaviour changes. The steps are the spec and docs rewrite in **Specs & docs**, the two cases in **Tests**, and one comment.

1. `specs/studio.md` §5.2: replace everything from the marker through the paragraph before **Text Node Rows** as quoted below, and append one clause to **Text Node Rows**.
2. `docs/studio/design/layers.md`: frontmatter and "Rearrange the page", as below.
3. `packages/studio/src/panels/layers-panel.ts`, the `OUTLINE_ROW_MAX_ITEMS` docblock: its last sentence, "The four moves are on none of those.", becomes "Move Up and Move Down are on the block action bar too; Move Into Previous and Move Out of Parent are drawn only here." No other line in the file changes.
4. `packages/studio/tests/layers-panel-gaps.test.ts`: the two cases below.
5. The fragment, then delete this plan file. Nothing requires this plan, so no dependent's `requires` changes.

**Integration contract.** Once this lands, `studio.md` §5.2 is Implemented and normative for: row actions are `forPlacement("outline/row")` evaluated against the row's node; every selected row and the hovered row carry them, other rows project none; the first four by `group` draw inline and the rest go in More actions; a verb that cannot act is disabled with its `requires`; a row verb acts on that row alone; the rows are a model drawn through a window with document-wide ARIA counts. `plan:studio/canvas-block-keyboard-access` and `plan:studio/insert-palette-categories` cite "the Outline (§5.2)" and may rely on that text. A later change to the row verbs (a new `outline/row` record, a different budget) is a §5.2 edit.

## Tests

Run from `packages/studio`: `bun test --isolate --coverage`. The behaviour the new text states is asserted by the cases listed in Context (`tests/outline-rows.test.ts`, `tests/layers-panel-gaps.test.ts`, `tests/layers-panel-window.test.ts`) plus two new cases in `tests/layers-panel-gaps.test.ts`, which reuse its `makeDoc` fixture and its `draw`, `at` and `overflowItems` helpers. Both pass on today's code, since this is a reconcile; each fails if the behaviour its sentence states regresses.

- "every selected row carries its cluster, and a row's Delete removes that row alone": select `["children", 1]` (the `p`) and `["children", 4]` (the `img`), draw; `rowActions` (`tests/outline-fixture.ts`) of each is the four moves, and the unselected `["children", 0]` has no `jx-action-button`. Open `["children", 4]`'s ⋮ and run Delete: four children remain, the `p` among them, and the selection is `[[]]`, the row's parent.
- "a row's Duplicate copies that row alone while others are selected": the same selection, ⋮ → Duplicate on `["children", 1]`: six children, `children[2]` a copy of the `p`, and no second `img`.

No source file is added and the only source edit is a comment, so no `coverageThreshold` moves and the manifest check is unaffected.

The gates that prove the plan: `bun run docs:status` (no open item left in §5.2), `bun run docs:spec-release` (the body change carries a fragment), `bun run plans:check` (the claim is gone with the plan), `bun run docs:check` (the new `spec:` anchor resolves), `bun run docs:links`, `bun run docs:markdown` and `bun run docs:prose` (the docs page edit).

## Specs & docs

**`specs/studio.md` §5.2**, in place, heading unchanged. Delete the Partial marker. Replace the intro sentence, the **Drag and Drop** paragraph, the **Move Action Buttons** paragraph, its table and the "Only applicable buttons render…" paragraph with:

> The Outline (`layers`, §5.1): a flattened tree of all elements in the document, with indentation representing nesting depth. Each row shows a badge (the tag, or the mark of a repeater, condition, case or slot), a label, a grab handle on every row that can move, and, on each selected row and the hovered one, the row's actions.
>
> **Drag and Drop** — The entire layer row is draggable via Atlassian Pragmatic Drag and Drop. Users can grab any part of the row to drag; a grip glyph on the hovered, selected or focused row advertises it. Drop indicators show reorder (above/below) and reparent (make-child) targets.
>
> **Row Actions** — A row's actions are `registry.forPlacement("outline/row")` (§13.1), each evaluated against the row's own node, because a row action acts on the row's node (`studio-ui-guidelines.md` §12.1): the hovered row is acted on although it is not selected, and under a multiple selection a row's verbs act on that row alone, where the chords and the block action bar act on the selection (§6.7). The moves would stay single-target regardless, for §6.7's reason: moving several non-sibling nodes one slot has no single meaning, and each step is arithmetic against a parent the previous step renumbered. The panel decides only which rows carry the records; each button's name, glyph, chord and availability are its record's.
>
> **The actions are drawn on the selected rows and the row under the pointer.** Every other row is projected with an empty command list rather than a hidden cluster, because a hidden kit button is still an upgraded custom element, and only the rows in the window are projected at all (below), so the panel's cost does not grow with the document. A row with no sibling position (the document root, a repeater's template, a `$switch` case) has no actions, and neither does a row being renamed, whose input takes the row's width. A click on a verb runs it without first selecting the row.
>
> The records sort by `group`. The first four draw inline (`OUTLINE_ROW_MAX_ITEMS`, what a 240px column holds) and the rest fold into a ⋮ **More actions** menu that prints each row's title and chord, with a divider above the destructive row:
>
> | Record                | Title              | Icon          | Drawn  | Enabled when                                                                                                                   |
> | --------------------- | ------------------ | ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
> | `selection.moveUp`    | Move Up            | `arrow-up`    | inline | the node has a sibling above it                                                                                                |
> | `selection.moveDown`  | Move Down          | `arrow-down`  | inline | the node has a sibling below it                                                                                                |
> | `selection.moveIn`    | Move Into Previous | `arrow-right` | inline | the sibling above is a container (a repeater, or a child list that is empty or holds a block); the node becomes its last child |
> | `selection.moveOut`   | Move Out of Parent | `arrow-left`  | inline | the parent is not the document root and has a sibling position; the node lands directly after its parent                       |
> | `selection.duplicate` | Duplicate          | —             | ⋮      | the node has a sibling position, as every row with actions does                                                                |
> | `selection.delete`    | Delete             | —             | ⋮      | the node has a sibling position, as every row with actions does                                                                |
>
> **A verb that cannot act is drawn disabled, never omitted** (`studio-ui-guidelines.md` §12.3). Its tooltip gives the record's `requires` sentence after its title, and its accessible name stays the record's `title`, so the four moves are always four buttons in the same places and the cluster keeps its shape as the pointer crosses rows. The moves take the inline slots because they are what an outline exists to offer, and Move Into Previous and Move Out of Parent are drawn nowhere else; Duplicate and Delete also have chords (⌘D, Delete), the block action bar and the element menu.
>
> Each verb is one transaction and so one undo step. A move selects the node at its new position, a duplicate selects the copy, and a delete selects the row's parent.

Keep **Rendering cost** verbatim and add, as the paragraph after it:

> **The rows are a model, and the tree draws a window onto it.** The walk yields every row the panel would draw; the tree draws only the rows in its scroller's viewport plus three rows of overscan either side (`listWindow` in `packages/studio/src/ui/virtual-window.ts`), and spacers reserve the height of the rest. Every question about which rows exist and in what order (a Shift range, the arrow walk, Home and End, ← to the parent, typeahead, the reveal that follows a selection made on the canvas) is answered from the model, never from the drawn rows, and each row's `aria-posinset` and `aria-setsize` count its place in the document rather than in the window (`ui.md` §5.5). A scroll during a drag does not repaint the window, because the drag holds the rows it registered.

**Text Node Rows**: append ", and they are not tree items, so the arrow keys and typeahead step over them" to its last sentence.

**Fragment:** `bun run spec:change studio.md minor -m "§5.2 describes the Outline's row actions as the outline/row command records drawn on each selected row and the hovered row, the four moves inline and disabled with their reason when they cannot act, Duplicate and Delete in a More actions menu, each acting on the row's own node, and states that the rows are a model drawn through a window."` Minor: a reconcile that no Jx author's documents depend on.

**Docs.** No page's `spec:` cites `studio.md#5.2`. `bun run docs:sync` names `docs/studio/design/layers.md` through the comment edit (its `code:` lists `layers-panel.ts`), which is §5.2's page and changes anyway (no em dash in any line):

- Frontmatter `spec:` gains `- studio.md#5.2` beside `studio.md#6.7`, so a later §5.2 release flags the page.
- "Rearrange the page", the list becomes the records' own names:
  - "**Move Up** / **Move Down** (the up and down arrows) swap the element with its neighbors."
  - "**Move Into Previous** (the right arrow) moves the element inside the sibling above it, as its last child."
  - "**Move Out of Parent** (the left arrow) moves the element out of its parent, to sit just after it."
  - "**More actions** (⋮) holds **Duplicate** and **Delete**, each with its shortcut."
- After "…which is not always the one you selected." insert: "That holds with several rows selected too: a row's **Delete** removes that row alone, while :kbd[Delete] and :kbd[⌘D] act on the whole selection."

No image changes, so the screenshots lane has nothing to recapture. studio.md does not graduate: other studio.md items stay open, so `plans/studio/` stays.

## Acceptance

- `sed -n '/^### 5.2 Layers Panel/,/^### 5.3/p' specs/studio.md | grep -c "Status: Partial\|Only applicable buttons\|Spectrum custom elements\|Shown when"` prints 0; the same range contains `outline/row`, `OUTLINE_ROW_MAX_ITEMS` and `listWindow`.
- The table's six records are exactly the six lines `grep -n 'menus:.*"outline/row"' packages/studio/src/panels/block-action-bar.ts packages/studio/src/commands/defaults.ts` prints (a bare `"outline/row"` also matches two comments), and its Title column matches their `title`s.
- `bun run plans:status --who-claims studio.md#5.2` names no plan; `bun run plans:check --audit studio` reports nothing; `plans/studio/outline-row-actions-text.md` is deleted.
- `ls specs/changes/` holds the fragment; `bun run spec:release --dry` mints a studio.md release carrying its sentence.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:markdown` and `bun run docs:prose` pass.
- `cd packages/studio && bun test --isolate --coverage` is green with no file below its threshold.
- In Studio, with a page open: hovering an unselected row draws four arrows and ⋮ on it and on the selected row only; on a first child, Move Up is greyed with the tooltip "Move Up — requires an element with a sibling above it"; ⋮ lists Duplicate (⌘D) and Delete below a divider; with three rows selected, each of them carries the cluster, and one row's ⋮ → Delete removes only that row.
