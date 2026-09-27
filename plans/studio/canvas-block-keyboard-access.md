---
status: drafted
disposition: implement
claims:
  - studio.md#8.2.8
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: M
---

# Focus Block Actions reaches the block action bar from the canvas, Escape returns to the caret, and blocks are navigated by structure rather than landmarks

## Context

`specs/studio.md` §8.2.8, line 843 (unmarked before the census, while its own prose said both items "are not yet implemented"):

> **Status: Partial.** The region's `role="textbox"`, `aria-multiline` and label ship with `contenteditable` (`syncEditableRoot` in `packages/studio/src/canvas/iframe-render.ts`). The two gaps named below remain: no block carries a landmark, and the bar's keyboard entry (⌥↑, `handleBlockBarEntryKey` in `panels/block-action-bar.ts`) is bound on the parent document, so it does not fire from a caret inside the canvas frame.

and line 847: "This describes the REGION only. Per-block landmarks and a keyboard-reachable block action bar (§4.4) are not yet implemented."

**What exists** (verified against the tree on 2026-09-27; paths under `packages/studio/`)

- `syncEditableRoot` (`src/canvas/iframe-render.ts`, line 553) writes `role="textbox"`, `aria-multiline="true"` and `aria-label="Document content"` and removes them with `contenteditable`; `tests/iframe-render.test.ts` "syncEditableRoot accessibility" covers it. Its comment still says "Per-block landmarks and a keyboard-reachable block action bar are still missing (see specs/studio.md §4.4)".
- `handleBlockBarEntryKey` (`src/panels/block-action-bar.ts`, line 1074) is bound by `document.addEventListener("keydown", …)` in `initBlockActionBar` (line 134). It matches a bare ⌥↑, refuses under `isModalOpen()`, and calls the kit's `focusItem(toolbar, 0)`, which lands on the first control that can act. It is a chord with no command record, the shape `formatCommands`' docblock records paying off for ⌘B and ⌘K. Because no record binds ⌥↑, the frame's table (`chordsInScopes(keymap, FRAME_KEY_SCOPES)`, posted as the `keymap` message) never carries it, and `shouldForwardKey` (`src/canvas/iframe-keys.ts`) never forwards it from a caret. It also ignores its target: with the bar up, ⌥↑ in any parent text field (an Inspector textarea) jumps to the bar, although macOS gives ⌥↑ to caret motion there. Tests: `tests/blockbar-registry.test.ts` (four cases) and `tests/block-action-bar-diff-gaps.test.ts` (one).
- The way back exists in part. Escape on the bar (the root `onkeydown` in `src/surfaces/block-action-bar.json`) calls `leaveBar`, which is `dismissBlockBarOverflow()` plus `returnFocusToCanvas()` (line 1053): it focuses the focused pane's `iframe.jx-canvas-iframe` and asks the frame nothing. Nothing records where the keyboard came from. In the frame, `onBlurCapture` (`src/canvas/iframe-inline-edit.ts`) caches only a non-empty range, for `applyFormat`; the editing root already has `capture()`, `restore()` and `placeCaret()` in §8.2.3's coordinates (`src/canvas/iframe-editable-root.ts`).
- The parent-to-frame calls to copy: `postOpenSlash` and `postApplyFormat` in `src/canvas/iframe-host.ts`, each one message kind in `ParentToIframe` (`src/canvas/iframe-protocol.ts`) handled in `startIframeInlineEdit`'s `channel.onMessage`.

**Found while detailing**

- **Keys pressed in the bar reach the editor's dispatcher.** The bar's Escape case prevents default but does not stop propagation. `dispatchKey` (`src/editor/shortcuts.ts`) listens on `document` and never checks `defaultPrevented`, and the kit's `onGroupKeydown` (`packages/ui/src/behaviors/action-group.ts`) stops only the arrows, Home and End. With no caret live, `keyScopeStack` answers the canvas stack (`shell.focusRegion` defaults to `"pane"` and only F6-style moves write it). So Escape on the bar also runs `selection.selectParent`, and Enter on a bar button runs `selection.insertSibling` (`keybinding: "enter"`, canvas scope), whose `preventDefault` cancels the button's own activation. With a caret live the caret stack binds neither key, which is why this has hidden.
- **The bar is drawn over the caret but acts on the selection.** `getEditBarAnchorRect` anchors on the caret snapshot's rect, `projectBar` projects `primarySelection(session.selection)`, and arrow motion between blocks does not write the selection (only a canvas `hit` does). After a click in one paragraph and the arrow keys into the next, the bar's Move Up moves the first paragraph.
- **Nothing writes a role onto a block.** Blocks are navigated by structure through the Outline (§5.2, a `jx-tree` whose rows name each block, reachable by its panel focus chord) and the `canvas`-scoped selection keys (`selection.selectPrevious`/`selectNext`/`selectFirstChild`/`selectParent` in `src/editor/shortcuts.ts` and `src/commands/defaults.ts`).

## Outcome

studio.md §8.2.8 → Implemented. Focus Block Actions (`view.focusBlockActions`, `alt+f10` per the Open decision) is a command record: forwarded out of the canvas frame by the keymap table, listed in the palette and the generated shortcut sheet, and rebindable. From a caret it first selects the caret's block. The bar owns Enter, Space and Escape. Escape returns focus to the control the keyboard came from, or to the canvas with the caret restored. The landmark sentence becomes the recorded decision that blocks carry none, with the Outline and the selection keys named as the structural navigation. §4.4, §10's first table and §19's ATAG note gain one sentence or row each.

## Decisions

- **Open:** which chord enters the bar? Recommendation: `alt+f10` (⌥F10 on macOS), and ⌥↑ is retired. The frame forwards and prevents a `global` chord in every stack, so ⌥↑ would take macOS's paragraph-start caret motion away from a writer (§10 gives the caret its navigation keys) and ⌥↑ page scrolling away from Preview. Alt+F10 has no browser default. It is the "go to the editor's toolbar" key of TinyMCE, CKEditor 5 and the WordPress block editor, which screen-reader users of rich-text editors already know. ⌥↑ was never in `docs/`. The cost: GNOME binds Alt+F10 to window maximise, so those users rebind it in Preferences › Keyboard (§15 ships), and the docs say so. If declined, the same record carries `keybinding: "alt+arrowup"`, and §8.2.8 states both costs.
- **Open:** do blocks carry landmarks? Recommendation: no, and §8.2.8 says so as a decision rather than a gap (no Future remainder). A block's role is the author's content: an `<h2>` must be announced as the heading the author wrote, and a page's own `<nav>` must stay its navigation landmark. A landmark per block would bury those in a landmark list as long as the document, the opposite of what landmarks are for. Navigation by structure (ATAG 2.0 A.3.4.1) already ships as the Outline and the selection keys. If declined, the landmark sentence moves under a later `> **Status: Future.**` marker in §8.2.8 that names the unanswered question (which role, and what a reader gains from one inside a `textbox`).
- **Decided:** the entry is a command record, `view.focusBlockActions`, titled "Focus Block Actions", category View, `level: "application"`, `keyScope: "global"`, `menus: ["palette"]`, group `4_docks`. §13 calls a chord without a record a defect, and the frame forwards exactly what the keymap binds (§13.3). `application` follows the level rule (it writes focus, editor state, as `view.cycleRegion` does). `global` is the one scope live under the caret, canvas and dock stacks alike, and a modal's palette-only stack already refuses it, which replaces the explicit `isModalOpen()` check. It is defined in `panels/block-action-bar.ts` beside `focusBlockBar`, because §13.1 puts a command beside its implementation.
- **Decided:** `when` is `ctx.editor.kind === "canvas" && ctx.canvas.view !== "preview" && ctx.selection.count > 0`. `enablement` asks whether the bar can draw at all (`projectBar() !== null`, which ignores suppression). `requires` is "a block selected in the design or edit canvas". So the chord is live from anywhere in the editor while a canvas block is selected, and Escape takes the keyboard back to wherever that was.
- **Decided:** entering from a live caret first writes the caret's block into the selection when it is not already in it (the rule `plan:studio-ui-guidelines/caret-escape` uses at dismissal), because the bar is drawn over the caret and the author means that block.
- **Decided:** entering releases a suppressed bar (`_suppressedFor = null`, then `renderBlockActionBar()`). §4.4 hides the bar on a chrome pointerdown because the author's attention left it, and a key that asks for the bar is that attention coming back.
- **Decided:** the bar owns Enter, Space and Escape: its root `onkeydown` stops their propagation, and Escape alone also prevents default. These three keys have a meaning of their own on a button and a toolbar, and the canvas stack would otherwise resolve Enter and Escape behind them. Every other key still bubbles, so a chord (⌘S, ⌘Z, F6, Alt+F10) works from the bar, and Delete deletes the selection the bar belongs to, as it does on the canvas.
- **Decided:** the way back is origin-based, and the frame restores the caret. `focusBlockBar` records `document.activeElement` (the canvas iframe element when the key came from the frame). Escape gives a connected parent-realm origin its focus back. Otherwise it focuses the origin frame, or the focused pane's frame when there is no origin (mouse or Tab entry), and posts `resumeCaret` with the primary selection's path. The frame decides, because offsets live there (§8.2.3) and the parent never reads the frame's DOM.
- **Decided:** the frame parks the caret on its capture-phase blur as `{ range: root.capture(), text }`, where `text` is the parked block's `textContent`. On `resumeCaret { path }` it restores the parked range in the block at `path` when that block holds a caret (§8.2.2) and its `textContent` equals `text`. A single-block range is rebased onto `path`, and a cross-block range is restored as it was. Otherwise it places the caret at offset 0 of a block that holds one. For a selection that holds none (a container, a component island) it removes the selection and blurs the editing host but keeps window focus, which is §8.1's "selected WITHOUT a caret". Text equality carries the caret through Move Up and Move Down, whose path changes while the text does not, and through a format verb, since offsets ignore markup. It needs no node identity across the bridge.

## Implementation

1. `src/panels/block-action-bar.ts`
   - Delete `handleBlockBarEntryKey` and the `document.addEventListener("keydown", handleBlockBarEntryKey)` line in `initBlockActionBar`. `_formatShortcutBound` now guards only the scroll listener, so its comment says that.
   - Add `let _entryOrigin: HTMLElement | null = null`, cleared in `dismissBlockActionBar()`.
   - Add `export async function focusBlockBar(): Promise<boolean>`:
     1. Capture `document.activeElement`. When it is not inside `view.blockActionBarEl` (re-entry keeps the first origin), keep it as the pending origin if it is an `HTMLElement` other than `document.body`.
     2. `const { editing, snapshot } = getEditSnapshot()`. When `editing && snapshot` and `!isSelected(tab.session.selection, snapshot.path)` (`src/tabs/selection.ts`), set `tab.session.selection = [[...snapshot.path]]`.
     3. `_suppressedFor = null; renderBlockActionBar()`.
     4. Take `_surface?.toolbar()`. If it is null, await one `requestAnimationFrame` (the wait the clamp already takes) and ask once more. If it is still null, return `false`.
     5. Commit the origin to `_entryOrigin`, call `focusItem(toolbar, 0)`, and return `true`. A bar where nothing can act keeps its focus where it was, as today.
   - Add `export function blockBarCommands(): AnyCommand[]`, returning the one record from Decisions with `keybinding: "alt+f10"` and `run: () => focusBlockBar()`. Its docblock states why it is a record (§13.3 forwarding) and why it is `global`.
   - Replace `returnFocusToCanvas` with `leaveBlockBar()`, and wire it as the surface's `leaveBar` action:
     - `dismissBlockBarOverflow()`, then take and clear `_entryOrigin`.
     - If the origin is connected and does not match `iframe.jx-canvas-iframe`, call `origin.focus()` and return.
     - Otherwise `frame` is that origin, or else `activeCanvasSurface().wrap?.querySelector("iframe.jx-canvas-iframe")`.
     - If `!(frame && resumeCanvasCaret(frame, primarySelection(activeTab.value?.session.selection)))`, focus `frame ?? stage` as today.
2. `src/surfaces/block-action-bar.json`, bar root `onkeydown`: the `Escape` case gains `{ "stopPropagation": true }` after its `preventDefault`. New `"Enter"` and `" "` cases carry only `{ "stopPropagation": true }`, so the button's native activation still runs. The document's `$description` sentence "Escape is the one key this document claims" becomes "it claims Enter, Space and Escape, the keys a button and a toolbar give a meaning of their own, so the editor's dispatcher never resolves them behind the bar".
3. `src/surfaces/block-action-bar.ts`: the module docblock's "⌥↑ needs the toolbar itself" becomes "Focus Block Actions needs the toolbar itself". `BlockBarActions.leaveBar`'s comment becomes "Escape: hand the keyboard back to where it came from (studio.md §8.2.8)."
4. `src/canvas/iframe-protocol.ts`: add `| { kind: "resumeCaret"; path: (string | number)[] | null }` to `ParentToIframe`, beside `openSlash`, commented "Focus came back from the parent's block action bar: restore the caret parked at blur in the block at `path`, or place one (studio.md §8.2.8)."
5. `src/canvas/iframe-host.ts`: add `export function resumeCanvasCaret(frame: Element, path: JxPath | null): boolean`, next to `postOpenSlash`. It finds the entry of `liveHosts` whose `iframe === frame` and that is `ready` and connected, and returns `false` when there is none. Otherwise it calls `host.iframe.focus()` (a parent-realm call, so it needs no activation inside the cross-origin frame), posts `{ kind: "resumeCaret", path: path ? [...path] : null }`, and returns `true`.
6. `src/canvas/iframe-inline-edit.ts`
   - `let parked: { range: DocRange; text: string } | null = null`. `onBlurCapture` keeps `cacheRange()` and adds: `const range = root.capture()`. When it is non-null, `parked = { range, text: elementForPath(container, range.anchor.path)?.textContent ?? "" }`.
   - In `channel.onMessage`, a `resumeCaret` branch before `enterEdit`. It returns when `!editingAllowed()`. Otherwise it calls `container.focus({ preventScroll: true })` and applies the rule in Decisions: `root.restore(...)`, falling back to `root.placeCaret({ path, offset: 0 })`, falling back to `doc.getSelection()?.removeAllRanges()` and `container.blur()`. It clears `parked` in every case, and teardown clears it too.
7. `src/canvas/iframe-render.ts`: `syncEditableRoot`'s "Scoped deliberately" paragraph becomes: "Scoped deliberately: this names the editing REGION, and no block gains a role here. A block's role is the author's own content, and blocks are navigated by structure through the Outline and the selection keys (studio.md §8.2.8)."
8. `src/studio.ts`: `commandRegistry.registerAll(blockBarCommands());` directly after `formatCommands()`, with a one-line comment. `src/commands/app-commands.ts`: `...blockBarCommands(),` after `...formatCommands(),`. `tests/app-commands-composition.test.ts` refuses either one without the other.

**Integration contract.** Once this lands:

- `view.focusBlockActions` exists: `application` level, `global` scope, `alt+f10`, palette-only, `when` a design or edit canvas with a selection. Its `run` is `focusBlockBar()`, which resolves `true` when a bar control took focus.
- The bar owns Enter, Space and Escape. Escape returns to the entry origin or resumes the canvas caret through `resumeCanvasCaret(frame, path)` and the `resumeCaret` message.
- Entering from a caret makes the caret's block the selection.
- `plan:studio-ui-guidelines/caret-escape` is independent: its Escape lives at the editing host, and the bar's Escape never reaches the frame. Once it lands, Focus Block Actions from its no-caret state works unchanged.
- `plan:studio/keyboard-shortcut-tables` finds the row already in §10's first table, and the generated sheet lists the record.
- `plan:studio-ui-guidelines/moves-without-dragging` may cite the bar's Move Up and Move Down as keyboard-reachable from a caret.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`.

- **Mocks first.** The four files that mock `../src/canvas/iframe-host` with `getEditSnapshot` (`tests/block-action-bar.test.ts`, `block-action-bar-coverage-gaps.test.ts`, `block-action-bar-diff-gaps.test.ts`, `blockbar-registry.test.ts`) add `resumeCanvasCaret`. In `blockbar-registry.test.ts` it is a recording spy, and `getEditSnapshot` reads a mutable `let editState` so a case can put a caret in play.
- `tests/blockbar-registry.test.ts`: the describe "role=toolbar and the roving tabindex" becomes "Focus Block Actions and the toolbar keys", run through a registry holding `blockBarCommands()` beside the injected one.
  - "Focus Block Actions moves focus to the first control that can act" replaces "⌥↑ enters the bar from the canvas".
  - "the record binds alt+f10 at global scope, live with a caret, on a canvas selection and in a dock" replaces "⌥↑ with another modifier…". `registry.keymap.resolveChord("alt+f10", keyScopeStack(ctx))` returns the id for all three contexts, and `handleKeyEvent` under `modal.open` returns `undefined`.
  - "with no bar to draw the record is refused with its requires sentence, and focus stays put" replaces "⌥↑ is refused while a modal…".
  - "entering brings back a bar a chrome pointerdown suppressed" (`suppressBlockActionBar()`, then run: the bar is visible and holds focus).
  - "entering from a caret selects the caret's block" (`editState` puts the caret at `["children", 0]` while `["children", 1]` is selected, and the selection becomes `[["children", 0]]`). A second case: a selection that already contains the block is unchanged.
  - "Escape hands focus back to the control the bar was entered from" (a focused sentinel button; `resumeCanvasCaret` is not called).
  - "Escape from a bar entered from a canvas frame resumes the caret there" (a focused `iframe.jx-canvas-iframe` origin; the spy gets that element and `["children", 1]`).
  - "Enter, Space and Escape pressed in the bar never reach the document, and a chord does" (a `document` keydown spy; `mod+s` arrives).
  - The two remaining cases in the describe switch their entry call to the record.
- `tests/block-action-bar-diff-gaps.test.ts`: "⌥↑ into a bar where nothing can act" becomes "Focus Block Actions into a bar where nothing can act". The record is enabled, the run resolves, and the sentinel keeps focus.
- `tests/iframe-host.test.ts`: "resumeCanvasCaret focuses that frame and posts resumeCaret to its host alone" (two live hosts; only the named one's channel receives it), and "resumeCanvasCaret answers false for an element that is no live canvas frame".
- `tests/iframe-inline-edit.test.ts`, new `describe("resumeCaret")`:
  - "restores the caret parked at blur in the block it left" (offset 3 in a `<p>`, a `blur` on the document, then `deliver`).
  - "carries the offsets to the selected block when its text is the text the caret left" (the paragraphs swapped in the DOM, then the moved one's path).
  - "lands at the start of a selected block whose text differs".
  - "leaves no caret when the selected node cannot hold one" (the container's path: `rangeCount` is 0).
  - "does nothing outside design and edit".
- `tests/iframe-keys.test.ts`, "the frame's table is the app's keymap": "alt+f10 is forwarded with a caret and without one". The existing every-chord invariant covers Preview.
- `tests/iframe-render.test.ts`, "syncEditableRoot accessibility": "no block gains a role the author did not write". A document of a `p`, an `h2` and a `section` with an authored `role` renders in edit mode, and only the container and the authored element carry `role`.

Coverage: the per-file thresholds in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) hold. Each new branch has a case above, and none of the touched files is the workspace floor, so there is no ratchet. There is no new source file, so the manifest check needs nothing.

## Specs & docs

- **studio.md §8.2.8** (line 841 on). The marker becomes:

  > **Status: Implemented.** The region's `role="textbox"`, `aria-multiline` and label ship with `contenteditable` (`syncEditableRoot` in `packages/studio/src/canvas/iframe-render.ts`); Focus Block Actions is a command record beside the bar it focuses (`blockBarCommands` in `panels/block-action-bar.ts`), and the frame resumes the caret it left (`resumeCaret` in `canvas/iframe-inline-edit.ts`).

  The first body paragraph stays. The "This describes the REGION only…" paragraph is replaced by four:

  > **The block action bar (§4.4) is one command away from the keyboard.** Focus Block Actions (`view.focusBlockActions`, `Alt+F10`) moves focus to the bar's first control that can act: from a caret, from a block selected without one, or from anywhere else in the editor while a canvas block is selected. It is a record like any other, so it is in the palette, it can be rebound, and the canvas frame forwards it by the keymap table (§13.3) rather than by a listener of its own. Entered from a caret, it first makes the caret's block the selection, because the bar is drawn over the caret and acts on the selection. It also brings back a bar §4.4's attention rule hid, since reaching for the bar is attention.
  >
  > **Inside, the bar is a toolbar** (←/→, Home/End), and it owns the three keys a toolbar gives a meaning of its own: Enter and Space press the focused control, and Escape leaves. None of the three reaches the editor's key dispatcher, where with no caret live they would resolve to the canvas's own Enter and Escape. Every other key does, so a chord works from the bar as it does anywhere.
  >
  > **Escape goes back where the keyboard came from.** A control elsewhere in the editor gets focus back. The canvas gets its caret back: the frame keeps the caret it held when it lost focus, in §8.2.3's coordinates. It restores that caret in the selected block when the block still has the text the caret left, which carries it through Move Up, Move Down and formatting. When a verb selected a different block, the caret lands at that block's start. When the selection cannot hold a caret (§8.2.2), the frame keeps focus with no caret and the block stays selected.
  >
  > **No block carries a landmark.** A block's role is the author's content. The canvas writes no role onto a block, so an `<h2>` is announced as the heading the author wrote and a page's own `<nav>` remains its navigation landmark. A landmark per block would bury those in a list as long as the document. Moving block by block is the Outline (§5.2), a tree whose rows name each block, and the structural selection keys with a block selected (§10).

  If the chord decision is declined, `Alt+F10` becomes `⌥↑`, with the sentence "On macOS this takes ⌥↑ from the caret's paragraph motion and from Preview's page scrolling." If the landmark decision is declined, the last paragraph becomes a `> **Status: Future.**` marker carrying that question.

- **§4.4**, after the "Two doors back" bullet: "**It is reachable from the keyboard.** Focus Block Actions (`Alt+F10`) moves focus onto the bar, showing it first if the attention rule had hidden it, and Escape returns the keyboard to where it came from (§8.2.8)."
- **§10**, the "Document commands" table gains the row ``| `Option+F10` / `Alt+F10` | Focus the block action bar (§8.2.8) |``. §10's marker is `plan:studio/keyboard-shortcut-tables`' and is not touched.
- **§19**, the ATAG 2.0 row. Its Note's "Part A is `studio-ui-guidelines.md` §13.1a and §8.2." becomes "Part A is `studio-ui-guidelines.md` §13.1a and §8.2, with §8.2.8 here: the block action bar is one command away from the keyboard, and blocks are navigated by structure through the Outline and the selection keys (A.3.4.1)." Its Evidence gains `packages/studio/tests/blockbar-registry.test.ts`.
- **Fragment:** `bun run spec:change studio.md minor -m "§8.2.8 Focus Block Actions (Alt+F10) reaches the block action bar from a caret or a selected block, the bar owns Enter, Space and Escape, Escape returns the keyboard and the caret where they were, and blocks carry no landmark: the Outline and the selection keys navigate them."`
- **`docs/studio/interface/canvas.md`** (its `spec:` cites `studio.md#4.4`, and its `code:` lists `panels/block-action-bar.ts`, `surfaces/block-action-bar.ts` and `editor/shortcuts.ts`). `spec:` gains `studio.md#8.2.8`. In "The block action bar", after the "steps aside" paragraph: "**From the keyboard**, press :kbd[⌥F10] (macOS) / :kbd[Alt+F10] (Windows/Linux) to move onto the bar, whether you are typing or have an element selected. If you are typing, the block your cursor is in becomes the selection first. :kbd[←] and :kbd[→] move between its buttons, :kbd[Home] and :kbd[End] jump to either end, and :kbd[Enter] or :kbd[Space] presses one. :kbd[Esc] takes you back to where you were: the same place in your text, or the start of the element's text if a button selected a different one. The command is **Focus Block Actions**, so it is also in the command palette, and you can rebind it in **[Preferences › Keyboard](/docs/studio/interface/preferences)** if your desktop already uses the key."
- **`docs/studio/editing/writing.md`** (its `code:` lists `panels/block-action-bar.ts` and `canvas/iframe-inline-edit.ts`). In "The formatting toolbar", after the shortcuts paragraph: "To reach the toolbar without the mouse, press :kbd[⌥F10] / :kbd[Alt+F10] while you type, and :kbd[Esc] to come back to the same place in your text. See [the block action bar](/docs/studio/interface/canvas#the-block-action-bar)."
- Both additions contain no em dash. The generated shortcut and command pages list the record with no committed change. No other page cites `studio.md#8.2.8` or lists a changed file: `docs/studio/design/layers.md` lists only Outline files.
- No graduation: studio.md keeps other open items (`bun run plans:status --spec studio`). The landing pull request deletes this file.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` is green with no file below its threshold, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun run typecheck`, `bun run lint`, `bun scripts/check-command-levels.ts` and `bun scripts/check-chrome-budget.ts` are clean.
- `bun run plans:status --spec studio` no longer lists §8.2.8. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:standards`, `bun run docs:prose`, `bun run docs:links` and `bun run docs:section-refs` pass. `bun run docs:sync` names `docs/studio/interface/canvas.md` and `docs/studio/editing/writing.md`, and both are in the diff.
- `grep -rn "handleBlockBarEntryKey\|⌥↑ enters" packages/studio` prints nothing.
- By hand, following the `packages/studio:verify` recipe (dev server and Chrome DevTools), in Edit mode:
  - Click into a paragraph, arrow into the next, and press Alt+F10. The bar's first control has focus, the selection box moved to the second paragraph, and ⌘K and the palette list "Focus Block Actions" with its chord.
  - → to Move Up and Enter: the paragraph moves and no paragraph is inserted. Esc: the caret is back at the same character in the moved paragraph, and typing continues there.
  - Select a component instance, press Alt+F10 then Esc: the selection is unchanged (Escape did not select the parent) and no caret is painted.
  - In the Inspector, focus a field, press Alt+F10 then Esc: focus is back in the field.
  - Click Preview: Alt+F10 does nothing, and ⌥↑ on macOS scrolls the page as the browser does.
