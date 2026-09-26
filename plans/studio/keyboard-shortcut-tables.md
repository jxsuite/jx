---
status: stub
disposition: reconcile
claims:
  - studio.md#10
size: S
---

# The Keyboard Shortcuts tables say what each chord does and where it is live

## Context

`specs/studio.md` §10, line 1122 (the section was unmarked before the census):

> **Status: Partial.** Save, undo and redo, Open in Browser, the bridge-derived `caret.active`, the caret's format chords, ⌘K, both slash-menu doors, block delete, ⌘A over siblings and Ctrl+scroll zoom ship (`packages/studio/src/commands/defaults.ts`, `editor/shortcuts.ts`, `canvas/iframe-host.ts`). The tables diverge from the keymap: ⌘D and the zoom chords are `canvas`-scoped and so do nothing under a caret, ⌘0 is `pane.focusPrimary` while `canvas.zoomReset` has no chord, Escape on a block runs `selection.selectParent` rather than deselecting, Enter on a block inserts a sibling (`selection.insertSibling`) and is unlisted, and the Arrows row does not say that ↑ and ↓ select the previous and next sibling, ← the parent and → the first child. Two rows describe gestures that do not exist yet: Escape with a caret does nothing (the caret stack does not forward it and the editing root has no handler), which is `studio-ui-guidelines.md` §8.3's gap, and Space+drag is §4.3's.

Disposition `reconcile` for the rows that misdescribe the keymap. Each of those differences is a deliberate keymap decision: §13.3 makes the element-level chords `canvas`-scoped so a live caret keeps them for text, `canvas.zoomReset` lives in the zoom pod by design (the comment in `editor/shortcuts.ts` says so), and Escape climbing one level is `selection.selectParent`'s contract. The tables were written before the registry and never regenerated from it. The two rows that describe unbuilt gestures (caret Escape and Space+drag) are not reconciled here; they are owned by the plans that build them, and §10 flips only once both have landed.

**What exists**

- The records: `selection.duplicate` (`keyScope: "canvas"`, `mod+d`) in `packages/studio/src/commands/defaults.ts`; `canvas.zoomIn` / `zoomOut` (`canvas` scope) and `canvas.zoomReset` (no chord) in `src/editor/shortcuts.ts`; `pane.focusPrimary` (`mod+0`) in `src/workspace/workspace.ts`; `selection.selectParent` (Escape, ArrowLeft) in `src/commands/defaults.ts`; `selection.selectPrevious` (ArrowUp), `selection.selectNext` (ArrowDown), `selection.selectFirstChild` (ArrowRight) and `selection.insertSibling` (Enter) in `src/editor/shortcuts.ts`, all `canvas`-scoped.
- `CARET_STACK = ["caret", "global"]` in `packages/studio/src/canvas/iframe-keys.ts`, which is why no `canvas`-scoped chord, Escape included, reaches the shell from a live caret.
- `shortcutReference()`, the generated projection behind the Keyboard sheet (§15) and `docs/studio/interface/shortcuts.md`.
- Tests: `packages/studio/tests/shortcuts.test.ts`, `tests/iframe-host-keymap.test.ts`.

**What is missing**

- The first table's heading narrowed (not every row is live under a caret) or its rows split by scope; ⌘D and the zoom chords moved to the no-caret table.
- ⌘0 corrected to `pane.focusPrimary` and zoom reset said to be reached from the zoom pod; Escape described as selecting the parent, clearing at the document element; Enter's sibling insert added, and the Arrows row naming all four bindings: ↑ and ↓ the previous and next sibling, ← the parent, → the first child.
- A decision on whether the tables stay hand-written at all, given that the generated shortcuts page already lists every binding; if they stay, a sentence pointing at the generated page as the complete list.
- The Space+drag row is not this plan's: it becomes true when `plan:studio/space-drag-pan` lands.
- The caret table's `Escape | Dismiss the caret` row is not this plan's either: it becomes true when `plan:studio-ui-guidelines/caret-escape` lands (that plan cites this row). The detail phase draws both edges.
- Editorial ride-along: §10.2 places Build Site in "the rail foot's menu", but `project.buildSite` is declared on `commandbar/overflow` and the palette, which is what its own third paragraph says.

**Related**

- studio.md §13.3 (key scopes and the scope stack), studio.md §4.3 (pan and zoom), studio.md §15 (the Keyboard sheet), studio.md §10.2 (Build Site), studio-ui-guidelines.md §8.3 (the caret's Escape).
