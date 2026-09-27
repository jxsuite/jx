---
status: drafted
disposition: implement
claims:
  - studio.md#10
requires:
  - studio/space-drag-pan
  - studio-ui-guidelines/caret-escape
workspaces:
  - packages/studio
  - scripts/docs
  - specs
  - docs
size: M
---

# The Keyboard Shortcuts tables say what each chord does and where it is live, and a test holds them to the registry

## Context

`specs/studio.md` §10, line 1130 (the section was unmarked before the census):

> **Status: Partial.** Save, undo and redo, Open in Browser, the bridge-derived `caret.active`, the caret's format chords, ⌘K, both slash-menu doors, block delete, ⌘A over siblings and Ctrl+scroll zoom ship (`packages/studio/src/commands/defaults.ts`, `editor/shortcuts.ts`, `canvas/iframe-host.ts`). The tables diverge from the keymap: ⌘D and the zoom chords are `canvas`-scoped and so do nothing under a caret, ⌘0 is `pane.focusPrimary` while `canvas.zoomReset` has no chord, Escape on a block runs `selection.selectParent` rather than deselecting, Enter on a block inserts a sibling (`selection.insertSibling`) and is unlisted, and the Arrows row does not say that ↑ and ↓ select the previous and next sibling, ← the parent and → the first child. Two rows describe gestures that do not exist yet: Escape with a caret does nothing (the caret stack does not forward it and the editing root has no handler), which is `studio-ui-guidelines.md` §8.3's gap, and Space+drag is §4.3's.

Verified against the tree on 2026-09-27; paths are under `packages/studio/src/` unless they name another root. The resolver is `keyScopeStack` in `commands/context.ts` (`CARET_STACK = ["caret", "global"]`, `CANVAS_STACK = ["canvas", "global"]` for a Design or Edit canvas with the pane region focused, `["dock", "global"]` once F6, a panel chord (⌘1 and up) or an Inspector chord (⌘⇧1–4) has moved the region, the palette-only stack under a modal); the frame mirrors it in `canvas/iframe-keys.ts`, and a chord nothing on the stack claims is neither forwarded nor prevented.

**Table by table**

- **Document commands** ("available wherever focus is, including with a caret"). `file.save`, `edit.undo`, `edit.redo` and `view.openInBrowser` are `global` (`commands/defaults.ts`); `edit.redo` also binds ⌘Y, which the table omits. ⌘D (`selection.duplicate`) and ⌘= / ⌘- (`canvas.zoomIn`, `canvas.zoomOut` in `canvasCommands`, `editor/shortcuts.ts`) are `canvas`-scoped, so under a caret nothing claims them and they reach the browser, where ⌘= and ⌘- are page zoom. ⌘0 is `pane.focusPrimary` (`paneCommands`, `workspace/workspace.ts`, enabled with two panes); `canvas.zoomReset` has no chord on purpose (its comment in `canvasCommands`, the `paneCommands` docblock, and "⌘0 no longer resets the zoom" in `tests/shortcuts.test.ts`).
- **With a caret.** True except two rows. Escape is `studio-ui-guidelines.md` §8.3's gap. **Found while detailing:** `Cmd+A | Select the text of the block, natively` cannot be true. The editing host is the whole canvas container (`syncEditableRoot`, `canvas/iframe-render.ts`), so the browser's select-all selects every block's text, and nothing in `canvas/iframe-editable-root.ts`, `canvas/iframe-inline-edit.ts` or `editor/inline-edit.ts` narrows it. `docs/studio/editing/writing.md` line 33 promises the block.
- **With a block selected but no caret.** Escape and ← are one record, `selection.selectParent`, which clears at the document element (`selectParent` in `editor/shortcuts.ts`); Enter is `selection.insertSibling` ("Insert Paragraph After"); ↑ / ↓ are `selection.selectPrevious` / `selection.selectNext` and select the document element from an empty selection; → is `selection.selectFirstChild`. Unlisted: ⌘D, the zoom chords, and the element clipboard (`edit.copy` and `edit.cut` in `editor/context-menu.ts`, `edit.paste` in `editor/shortcuts.ts`), all `canvas`-scoped. The heading's "(from the layers panel, or after a structural edit)" says where the selection came from, while liveness depends on the stack.
- **Canvas viewport.** Ctrl+scroll ships. Middle-button drag and wheel pan ship too (`installStageGestures`; "middle button drag pans the canvas" and "plain wheel pans both axes" in `tests/shortcuts.test.ts`) but are unlisted. Space+drag is §4.3's gap.
- **§10.2** puts Build Site in "the rail foot's menu", but `project.buildSite` declares `commandbar/overflow` and `palette`, as the section's own third paragraph says.

**Also found while detailing**

- The zoom pod's three tooltips are literals in `surfaces/pane-context.json`: "Zoom out (Ctrl+-)", "Reset to 100% (Ctrl+0)", "Zoom in (Ctrl+=)". The reset tooltip names the chord that focuses the primary pane, and all three show Windows chords on macOS, against §13.3's "no template may hardcode a glyph". The pod is also drawn over Project Styles and a git diff (`STAGE_ZOOM_MODES` in `panels/pane-context.ts`, which `plan:studio/space-drag-pan` replaces with `PAN_MODES`), whose editor kinds are `config` and `diff`, so the zoom records' `when` (`inDocument`, which requires `editor.kind === "canvas"`) is false there and no zoom chord does anything. `docs/studio/interface/canvas.md` promises the chords under "In **Design** and **Project Styles**".
- `docs/studio/interface/canvas.md` line 39 says ":kbd[⌘0] / :kbd[Ctrl+0] resets to 100%."
- The `canvasCommands` docblock gives its reason for `canvas` scope as "they act on a node in the artboard". That reason covers the selection and clipboard verbs, but the zoom trio acts on the view, not on a node.
- Not this plan's item: `shell.focusRegion` is written only by `focusShellRegion` (F6, ⌘1–⌘7) and never by a click. After a click into the Outline the stack is still the canvas one, so Delete deletes. After ⌘4 it is `["dock", "global"]` and Delete does nothing. §13.4's `focus.region` can therefore be stale. Recorded for whoever next edits §13.4.

**The generated list.** `shortcutReference()` (`commands/reference.ts`) projects every binding by scope into the Keyboard sheet (§15) and, through `scripts/docs/generators/studio-commands.ts`, into `docs/studio/interface/shortcuts.md` and `commands.md`. Both are gitignored build outputs whose frontmatter cites `studio.md#10`. Nothing compares §10's hand-written tables with the registry, which is how ⌘0's rebinding left them behind.

## Outcome

- studio.md §10 → Implemented. It flips once `plan:studio/space-drag-pan` and `plan:studio-ui-guidelines/caret-escape` have made its Space+drag and caret-Escape rows true. The tables are grouped by the scope that resolves them, every row for a record names that command (per the first Open), and `scripts/docs/studio-keyboard-tables.test.ts` fails when a row and the registry disagree.
- As recommended below: with a caret, ⌘A selects the caret's block first and the whole canvas on a second press, and ⌘= / ⌘- zoom whether or not a caret is live.
- §10.2 names the Command Bar's overflow menu. The zoom pod's tooltips take their chords from the keymap, print one only over a pane where it fires (Design and Edit), and none names ⌘0. `docs/studio/interface/canvas.md` and `docs/studio/editing/writing.md` match the keymap.

## Decisions

- **Decided:** disposition `implement`, not `reconcile`. Most rows are the spec catching up with the keymap, but the plan ships code whatever the Opens decide (the pod's tooltips and the drift guard), so it is not a paper plan and cannot land with its detailing pull request. Both readings release at minor.
- **Decided:** require both gesture plans, because §10 carries the Space+drag and caret-Escape rows and can read Implemented only once both are true, and the caret ⌘A branch below goes into the `keydown` listener `plan:studio-ui-guidelines/caret-escape` adds. This plan keeps those two rows exactly as those plans leave them (`plan:studio-ui-guidelines/caret-escape` asks that "Escape | Dismiss the caret" be kept). Both are drafted and neither requires anything, so waiting for them is cheaper than splitting off an enabling plan that would land the text early.
- **Open:** do §10's tables stay hand-written, now that `shortcutReference()` generates the complete list? Recommendation: keep them, as the keyboard's model rather than its full listing. They are grouped by scope, every record row names its command id, and the section names the generated sheet as the complete list. A script test holds every row to the registry. This keeps the spec the contract for the default chords that define the editing model, so rebinding one is a spec release, and it makes the ⌘0 drift a red test instead of a stale table. Alternative: drop the record rows and point at the generated sheet, keeping only the rows no record carries (the caret's host keys and the stage's gestures). The test would then shrink to its "claimed by no record" half.
- **Open:** what ⌘A does with a caret. Recommendation: block first. The first ⌘A selects the caret's block. A press when the selection already covers that block is left to the browser, which selects the whole canvas. It is a gesture of the editing host, in the `keydown` listener that caret Escape adds to `startEditableRoot`. Reasons: the spec row and writing.md both promise the block. A page-wide selection followed by Backspace goes through the cross-block delete and collapses the page into one block. The second-press fallback needs the frame's view of the selection, which a parent-side record does not have. If declined, the row becomes "Select all the text on the canvas, natively", writing.md line 33 says the same, and no code changes.
- **Open:** whether the zoom chords work with a caret. Recommendation: move `canvas.zoomIn`, `canvas.zoomOut` and `canvas.zoomReset` to `global` scope, gated on `when: document open, a canvas editor, and not Preview`. Reasons: the old table promised it. `canvasCommands`' own reason for `canvas` scope covers node verbs, not the view. Edit, the mode with a content zoom, almost always has a caret, so today its keyboard zoom works only after the caret is gone and otherwise zooms the browser page, which §4.3 blocks for Ctrl+wheel everywhere. Consequences: the frame forwards and prevents ⌘= in Preview too, where the host's `when` is false, so Preview blocks keyboard page zoom the way it already blocks Ctrl+wheel. With focus in a dock or a panel field the chords zoom the active canvas as well, so keyboard page zoom is unavailable whenever a Design or Edit canvas is the active editor, which matches §4.3's "Studio blocks page zoom everywhere" for Ctrl+wheel. The palette stops offering the three zoom verbs in Preview, where today running one writes a `ui.zoom` Preview never shows. If declined, the zoom row goes in the no-caret table and the scope stays.
- **Decided:** the tables follow the scope stack: `global`, then `caret`, then `canvas`, then the viewport gestures, which belong to the stage and not to the keymap. §13.3 resolves on exactly this, and the generated sheet groups by it too.
- **Decided:** the ⌘0 row names `pane.focusPrimary`, and zoom reset stays chordless. That choice is the code's, documented where it was made (`paneCommands` in `workspace/workspace.ts`) and pinned by a test, so §10 names the pod's percentage button and the palette's Reset Zoom instead of a key.
- **Decided:** the pod's tooltips read their chords from the keymap by command id, and print one only over a Design or Edit pane. Over Project Styles and a diff the records' `when` is false, so a printed chord would promise a key that does nothing; making the chords work there is not §10's item. The buttons keep running the pod's per-pane zoom verbs rather than the records, because the records act on the focused pane's surface, while a pod belongs to its own pane (§18.1, "Nothing drawn for a pane may resolve the focus"). Making the pod a rendering of the records is not this plan's.
- **Decided:** the drift guard is a script test under `scripts/docs/`, not a `packages/studio` test. It reads `specs/studio.md`, and a workspace suite may read outside its workspace only through an `EXTRA_EDGES` entry. The scripts suite runs in the `changes` job on every pull request, so both a chord change and a spec edit meet it. `scripts/docs/generators/shared.test.ts` already loads `appCommandSet()` there.

## Implementation

Paths are under `packages/studio/` unless another root is named. Code comments cite `studio.md §…`, qualified. A bare `§` in this package means `studio.md`, so `studio.md` may also be written bare (`bun run docs:section-refs`).

1. **The spec.** Rewrite §10 and fix §10.2 as `## Specs & docs` gives. Nothing else in `specs/` changes.
2. **The guard: new `scripts/docs/studio-keyboard-tables.test.ts`** (header: what it holds and why, citing studio.md §10 and §13.3).
   - `parseKeyboardTables(markdown: string)`, local to the file. It slices from the `## 10.` heading to `### 10.1` and returns `{ scope, rows: { line, chords, ids }[] }[]`. A table's scope is the first match of ``/`(global|caret|canvas)` scope/`` in the nearest `**`-led paragraph above it; a table without one (the viewport's) is skipped. `chords` are the backticked spans of the first cell, double-backtick spans included (for ``Cmd+` ``). A span `parseChord` rejects (`Shift` alone) is skipped, and a `Ctrl+X` span is dropped when the same cell also has `Cmd+X`, as its Windows/Linux twin (a `Ctrl+` span with no twin stays, and normalizes to `ctrl+…`). The rest are `normalizeChord`ed. `ids` are the backticked spans of the second cell shaped like a command id (`/^[a-z]+(\.[A-Za-z]+)+$/`).
   - The keymap: `createKeymap({ mac: true })` from `packages/studio/src/commands/keymap.ts`, with every record of `appCommandSet()` (`commands/app-commands.ts`) added. The stacks come from `keyScopeStack` (`commands/context.ts`): caret over `makeContext({ caret: { active: true } })`, canvas over `makeContext({ editor: { kind: "canvas" } })`. A `caret` or `canvas` table is checked on its own stack, and a `global` table on both, because its heading promises "with a caret" too.
   - A row with ids: with one id, every chord belongs to it; with as many ids as chords, they pair by position; any other count, zero chords included, fails and names the line. For each pair, `keymap.resolveChord(chord, stack)` must be `{ commandId: id, scope: <table scope> }`. That one assertion covers a missing record, a changed chord, a changed scope, and shadowing by a narrower scope. A row without ids asserts `resolveChord` is `undefined` on its stack, which is what makes the caret's clipboard, Enter, Backspace, "/" and Escape rows true.
3. **The zoom pod's tooltips.**
   - `panels/pane-context.ts`: add `podHint(words: string, commandId: string, live: boolean): string` above `podFor`. It returns `` `${words} (${chord})` `` when `live` and `activeRegistry()?.keymap.formatBinding(commandId)` is defined, and `words` otherwise. The docblock notes that a chord is formatted, never written (studio.md §13.3), that the button runs this pane's zoom rather than the record, and that `live` is false over Project Styles and a diff because the records do not run there. Both non-hidden branches of `podFor` set `zoomInHint: podHint("Zoom in", "canvas.zoomIn", live)`, `zoomOutHint: podHint("Zoom out", "canvas.zoomOut", live)` and `zoomResetHint: podHint("Reset to 100%", "canvas.zoomReset", live)`, with `live` true in the `edit` branch and `mode === "design"` in the stage branch. The stage branch is the one `plan:studio/space-drag-pan` (a prerequisite) leaves gated on `PAN_MODES` from `canvas/iframe-protocol.ts`, which replaces this module's private `STAGE_ZOOM_MODES` with the same three modes, so `live` is false over its other two members, `stylebook` and `git-diff`.
   - `surfaces/pane-context.ts`: `PaneContextView` gains `zoomInHint`, `zoomOutHint` and `zoomResetHint` (strings, beside `zoomLabel`). `emptyPaneContextView()` sets them to "Zoom in", "Zoom out" and "Reset to 100%", and `project()` copies them into the scope.
   - `surfaces/pane-context.json`: the three `jx-action-button`s' `hint` props (`zoom-out`, `zoom-label`, `zoom-in`) become `{ "$ref": "#/state/zoomOutHint" }`, `#/state/zoomResetHint` and `#/state/zoomInHint`. Their `label`s stay.
4. **Caret ⌘A, as recommended.** In `canvas/iframe-editable-root.ts`:
   - `EditableRootDeps` gains `isMac?: () => boolean`, documented as "The platform the chord is read for; absent reads `isMacPlatform()`." Import `chordFromEvent` and `isMacPlatform` from `../commands/keymap`, which the frame bundle already loads through `iframe-keys.ts`.
   - In `onKeyDown` (added by the caret-Escape change), add a branch before the Escape test. When `chordFromEvent(e, deps.isMac?.() ?? isMacPlatform()) === "mod+a"`, it returns on the same guards Escape uses (`e.defaultPrevented`, `e.isComposing || composing`, `!editingAllowed()`, `activeKey === null`), when `doc.getSelection()` is null or has no range, and when `coversBlock(sel.getRangeAt(0), activeEl)`. Otherwise it calls `e.preventDefault()` and replaces the selection with a range over `activeEl`'s contents (`selectNodeContents`, then `removeAllRanges` and `addRange`).
   - `coversBlock(range, block)`, module-private: true when `offsetOf(block, range.startContainer, range.startOffset) === 0` and `offsetOf(block, range.endContainer, range.endOffset) === blockTextLength(block)`, or when the range contains a range over the block's contents (`compareBoundaryPoints` `START_TO_START <= 0` and `END_TO_END >= 0`), which is the whole-canvas selection a second press made. `offsetOf` and `blockTextLength` are `canvas/iframe-position.ts`'s.
   - The module docblock's dismissal paragraph gains: "⌘A selects the caret's block, and a second press, with the block already covered, is the browser's select-all over the whole host (`studio.md` §10)."
   - `editor/shortcuts.ts`: the `selection.selectAll` docblock's "select-all means the SENTENCE" becomes "the editing host selects the caret's block, then the page (studio.md §10)".
5. **Zoom chords with a caret, as recommended.** In `editor/shortcuts.ts`, `canvasCommands`:
   - Add `const onStage = (ctx: CommandContext) => inDocument(ctx) && ctx.canvas.view !== "preview";`.
   - `canvas.zoomReset`, `canvas.zoomIn` and `canvas.zoomOut` drop `keyScope: "canvas"` (so they are `global`) and take `when: onStage`.
   - The docblock's scope paragraph says the zoom trio is `global`: zooming acts on the view, not a node, so a caret keeps it and never hands ⌘= to the browser's page zoom (studio.md §10, §4.3). The `when` keeps Preview and the non-canvas editors out.
   - Two comments that describe the old gate: `canvas/canvas-utils.ts` (the `PANZOOM_MODES` note, line 932) says the trio gates on `document.open && editor.kind === "canvas"` and gains "and not Preview"; `tests/settings-key-scope.test.ts`'s `CANVAS_VERBS` docblock ("Every verb `shortcuts.ts` files under `keyScope: "canvas"`") becomes "every verb `canvasCommands` gates on the canvas editor". The list itself stays.
6. **§10's first table and `plan:studio/canvas-block-keyboard-access`.** That plan adds a Focus Block Actions row (`Option+F10` / `Alt+F10`) to §10's first table and a `global` record, `view.focusBlockActions`. If it lands first, the rewrite below keeps its row with the id added: "Focus the block action bar (`view.focusBlockActions`, §8.2.8)". If this plan lands first, its row needs that id, or the guard reads it as a gesture no record may claim and fails.

**Integration contract.** No plan requires this one. Once it lands, §10 is Implemented, and every row there that names a command is enforced. A pull request that changes a default chord, or the scope of a command §10 names, fails `scripts/docs/studio-keyboard-tables.test.ts` until it edits §10 in the same change and releases it with a fragment. So does a row added to a scoped table without the id of the record that holds its chord, and a new `caret`- or `global`-scoped record on a key a no-id caret row names (a caret-scoped Escape, say), because that row says the key is the editing host's. A new chord for a command §10 does not name needs no row, because the generated sheet lists it. `PaneContextView` carries `zoomInHint`, `zoomOutHint` and `zoomResetHint`. `EditableRootDeps.isMac` exists. The zoom trio is `global` with `when` excluding Preview, so it appears under "Anywhere" in the generated sheet.

## Tests

- **Scripts** (`bun test --isolate scripts`; there is no coverage workspace). New `scripts/docs/studio-keyboard-tables.test.ts`:
  - "§10 has a table for each of the global, caret and canvas scopes". The parse finds all three, so a reformat cannot make the guard vacuous.
  - "every row that names a command is that command's chord, live in the table's scope on every stack it promises".
  - "a row that names no command is claimed by no record on its table's stack".
  - "the parser drops a Ctrl+ spelling only beside its Cmd+ twin, pairs chords with commands by position, skips a modifier-only span, and fails a row whose ids and chords do not pair". This runs over an inline fixture table, so the parse is tested apart from the spec.
- **`packages/studio`** (`bun test --isolate --coverage` from the workspace directory):
  - `tests/pane-context.test.ts`, `describe("zoom pod")`: "each button's tooltip prints its record's chord, and Reset names none". Registering the real `canvas.zoom*` records from `canvasCommands` (mac), `hintOf` gives "Zoom in (⌘=)", "Zoom out (⌘-)" and "Reset to 100%" in Design and in Edit. Also "a Project Styles pod names no chord, since the records do not run there" (`ctxInMode("stylebook")`) and "with no registry the tooltips are the bare words".
  - `tests/iframe-editable-root.test.ts`, new `describe("⌘A selects the block first")` with `isMac: () => true`:
    - "the first ⌘A selects the caret's block and is prevented". `getSelection().toString()` is the block's text.
    - "a second ⌘A, with the block covered, is left to the browser". Not prevented.
    - "a selection spanning past the block counts as covering it". A range over the container is not prevented.
    - "Ctrl+A on a mac is not the chord". Not prevented, since it is line start there.
    - `test.each` "⌘A is the browser's when %s": no active block, a prop host, a composition, a mode other than design or edit.
  - `tests/shortcuts.test.ts`:
    - In `describe("a live caret owns the element chords")`: "⌘= and ⌘- still zoom with a caret live". With `caretActive = true`, ⌘= sets `ui.zoom` to 1.2 and prevents default.
    - The Preview case "⌘%s does not mutate or zoom" and the grid case "⌘%s belongs to the grid", over `=` and `-`, stay green unchanged; both now prove the `when` rather than the scope.
    - "⌘0 no longer resets the zoom" and "Reset Zoom still works as a verb" stay.
  - `tests/iframe-keys.test.ts`, `describe("the frame's table is the app's keymap")`: "⌘= forwards with a caret live". Against the live table, `shouldForwardKey` for `mod+=` is true with a session in `edit`.
  - Unchanged and must stay green: `tests/commands-reference.test.ts`, `tests/commands-keymap.test.ts` (the rebinding-conflict table over live stacks), `tests/iframe-host-keymap.test.ts`, and `tests/settings-key-scope.test.ts`'s "canvas verbs over a non-canvas editor" (the trio's `when` still refuses Project Settings).
- **Coverage.** `packages/studio/bunfig.toml` holds every file at `lines = 0.958, functions = 0.941`. Every new branch above has a case, and `coversBlock` has both of its arms. No new source file is added under `packages/studio/src`, so the manifest check is unaffected, and no touched file is the workspace floor, so no ratchet.

## Specs & docs

**`specs/studio.md` §10**, in place, heading kept. The marker (line 1130) becomes:

> **Status: Implemented.** Every row that names a command states that record's default chord and scope (`packages/studio/src/commands/defaults.ts`, `src/editor/shortcuts.ts`, `src/editor/context-menu.ts`, `src/panels/block-action-bar.ts`, `src/workspace/workspace.ts`), resolved by the scope stack (`keyScopeStack` in `src/commands/context.ts`, and `src/canvas/iframe-keys.ts` in the canvas frame). The caret's own keys are the editing host's (`src/canvas/iframe-editable-root.ts`), and the viewport's gestures are the stage's (§4.3). `scripts/docs/studio-keyboard-tables.test.ts` holds every table row to the registry.

A new paragraph follows it:

> These tables are the keyboard's model: which keys each state of the canvas owns. A row that names a command states that record's default chord and the scope it is live in (§13.3). A row that names none is a gesture of the editing host or the stage, which no record carries. The complete list is generated from the registry rather than written here, by `shortcutReference()`: the Keyboard section of Preferences (§15) prints the live bindings, the author's rebindings included, and `docs/studio/interface/shortcuts.md` the defaults.

The first table's heading becomes "**App commands** (`global` scope: live wherever focus is, a caret in the canvas included; only a modal overlay stands them down):". Its rows are:

| Shortcut                                           | Action                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Cmd+S` / `Ctrl+S`                                 | Save (`file.save`), flushing the caret's pending text first                                                    |
| `Cmd+Z` / `Ctrl+Z`                                 | Undo (`edit.undo`)                                                                                             |
| `Cmd+Shift+Z` / `Ctrl+Shift+Z`, `Cmd+Y` / `Ctrl+Y` | Redo (`edit.redo`)                                                                                             |
| `Cmd+Shift+O` / `Ctrl+Shift+O`                     | Open in Browser (`view.openInBrowser`, §10.1)                                                                  |
| `Cmd+=` / `Ctrl+=`, `Cmd+-` / `Ctrl+-`             | Zoom in / out (`canvas.zoomIn`, `canvas.zoomOut`) on a Design or Edit canvas; in Edit, the content zoom (§4.3) |
| `Cmd+0` / `Ctrl+0`                                 | Focus the primary pane of a split (`pane.focusPrimary`, §18.1)                                                 |

If `plan:studio/canvas-block-keyboard-access` has landed, its Focus Block Actions row stays in this table with its id (Implementation step 6). A sentence goes under the table: "Resetting the zoom has no chord: ⌘0 belongs to the pane pair (⌘⌥0 focuses the side pane), and the zoom resets from the zoom pod's percentage button, or **Reset Zoom** (`canvas.zoomReset`) in the palette."

The bridge-fact paragraph is unchanged. The caret table's heading becomes "**With a caret in the canvas** (`caret` scope, which drops `canvas` from the stack: the caret owns the editing and navigation keys, and the clipboard):". Its rows are unchanged except three:

- `Cmd+A` becomes "Select the text of the caret's block; pressed again, all the text on the canvas".
- The format row becomes "Bold / italic / underline / code (`format.bold`, `format.italic`, `format.underline`, `format.code`)".
- The link row becomes "Link the selected run of text (`format.link`)".

The Escape row stays as `plan:studio-ui-guidelines/caret-escape` leaves it. The slash-menu paragraph is unchanged.

The third table's heading becomes "**With a block selected and no caret** (`canvas` scope: a Design or Edit canvas, no caret live, and no dock holding the keyboard, §13.3):". Its rows are:

| Shortcut                    | Action                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Delete` / `Backspace`      | Delete the selection (`selection.delete`); the document element is never deleted                                                     |
| `Enter`                     | Insert an empty paragraph after the selected element, and select it (`selection.insertSibling`)                                      |
| `ArrowUp` / `ArrowDown`     | Select the previous / next sibling (`selection.selectPrevious`, `selection.selectNext`); with nothing selected, the document element |
| `ArrowRight`                | Select the first child (`selection.selectFirstChild`)                                                                                |
| `ArrowLeft` / `Escape`      | Select the parent (`selection.selectParent`); at the document element, clear the selection                                           |
| `Cmd+A` / `Ctrl+A`          | Select every sibling of the selection (`selection.selectAll`); from the document element, its children                               |
| `Cmd+D` / `Ctrl+D`          | Duplicate the selection (`selection.duplicate`)                                                                                      |
| `Cmd+C` / `Cmd+X` / `Cmd+V` | Copy / cut / paste the selected element (`edit.copy`, `edit.cut`, `edit.paste`)                                                      |

The viewport table's heading becomes "**Canvas viewport** (on a pan/zoom stage, §4.3; the stage's gestures, which no record carries):". It keeps the `Space` + drag row as `plan:studio/space-drag-pan` leaves it, and `Ctrl+scroll` / pinch becomes "Zoom canvas, toward the cursor". Two rows are added: "Middle-button drag | Pan canvas" and "Scroll, `Shift` + scroll | Pan canvas, sideways with `Shift`".

If the Opens are declined, three things change. For the first, the record rows go and the intro's last sentence says the sheet is the list. For the second, the caret ⌘A row reads "Select all the text on the canvas, natively". For the third, the zoom row moves into the no-caret table.

**§10.2**, line 1243: "(`project.buildSite`, the rail foot's menu and the palette, no default chord)" becomes "(`project.buildSite`, the Command Bar's overflow menu and the palette, no default chord)".

**Fragment:** `bun run spec:change studio.md minor -m "§10's tables are grouped by the key scope that resolves them and name the command each row describes: Duplicate, Enter, the arrows and Escape on a block are structural verbs live without a caret, ⌘0 focuses the primary pane and zoom reset has no chord, ⌘A with a caret selects the block before the page, the zoom chords work with a caret, and §10.2 places Build Site in the Command Bar's overflow menu."` Drop the clauses a declined Open removes. The level is minor: the ⌘A and zoom changes are additive, and the rest redefines nothing an author could have relied on, since every row it changes never behaved as written.

**Docs** (no em dashes; `bun run docs:sync` names the pages below):

- `docs/studio/interface/canvas.md` (its `code:` lists `editor/shortcuts.ts`). Line 39 becomes "- **Zoom** by holding :kbd[⌘] (macOS) or :kbd[Ctrl] (Windows/Linux) and scrolling; the canvas zooms toward your cursor. In Design, :kbd[⌘=] / :kbd[Ctrl+=] zooms in and :kbd[⌘-] / :kbd[Ctrl+-] zooms out, with the cursor in the text or not." (The keys do nothing in Project Styles, whose editor the records do not run over; the bullet sits under "In **Design** and **Project Styles**".) Line 40 becomes "- The zoom pod floating at the canvas's bottom-right does the same. Click its percentage to go back to 100%, and use its **fit** picker for **Fit page**, **Fit width** and **Actual size**, remembered per document." In the Edit paragraph (line 44), ":kbd[Ctrl]-scrolling zooms the content itself" becomes ":kbd[Ctrl]-scrolling and the same zoom keys zoom the content itself". If the third Open is declined, drop "with the cursor in the text or not".
- `docs/studio/editing/writing.md` (its `code:` lists `canvas/iframe-editable-root.ts`). Line 33 becomes "- :kbd[⌘A] / :kbd[Ctrl+A] selects the text of the block you are in, and pressing it again selects all the text on the page. With no cursor (a block selected from the Outline, say), the same keys select every element beside it instead." If the second Open is declined, the first sentence is ":kbd[⌘A] / :kbd[Ctrl+A] selects all the text on the page."
- Checked, with no change needed: the pages whose `code:` lists a pane-context file. `docs/studio/interface/tabs.md` line 149 already says "the percentage (click it for 100%)" and names no chord. `docs/studio/interface/modes.md`, `docs/studio/design/breakpoints.md`, `docs/studio/design/stylebook.md`, `docs/studio/design/components.md` and `docs/studio/publish/collaboration.md` say nothing about the pod's tooltips, and `docs/studio/design.md` (its `code:` lists `canvas/canvas-utils.ts`, whose comment changes) names no chord.
- `docs/studio/interface/shortcuts.md` and `commands.md` regenerate and are not committed. With the third Open, the zoom rows move from "Canvas selection" to "Anywhere". The generator's sentence "which is why `⌘D` duplicates an element on the canvas and does nothing while you are typing in a field" stays true.

studio.md keeps other open items (`bun run plans:status --spec studio`), so it does not graduate. The landing pull request deletes this file.

## Acceptance

- `bun test --isolate scripts/docs/studio-keyboard-tables.test.ts` is green. As a negative check, move the ⌘D row into the App commands table locally: the test names that row, the chord and the scope it found.
- `cd packages/studio && bun test --isolate --coverage` is green with no file below its threshold. `bun scripts/check-coverage-manifest.ts packages/studio` and `bun scripts/check-command-levels.ts` pass.
- `bun run typecheck` and `bun run lint` are clean.
- `bun run plans:status --spec studio` no longer lists §10. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:prose`, `bun run docs:links`, `bun run docs:markdown` and `bun run docs:section-refs` pass.
- `bun run docs:generate`, then read `docs/studio/interface/shortcuts.md`. With the third Open, Zoom In and Zoom Out are under "Anywhere", and no row reads ⌘0 as a zoom.
- By hand, with the `packages/studio:verify` recipe (dev server and Chrome DevTools):
  - In Edit, click into a paragraph and press ⌘A: only that paragraph's text is selected. Press it again: every block's text is.
  - With the caret still in the text, press ⌘= and ⌘-: the content zoom changes, and the browser's page zoom does not.
  - Hover the zoom pod in Design: the tooltips read "Zoom in (Ctrl+=)", "Zoom out (Ctrl+-)" and "Reset to 100%" off macOS (⌘ glyphs on macOS). In Project Styles they read the bare words.
  - Press Escape (caret dismissed), then ↑, ↓, → and ← and ⌘D: each acts as the no-caret table says.
