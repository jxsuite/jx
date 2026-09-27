---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#8.3
requires: []
workspaces:
  - packages/studio
size: S
---

# Escape dismisses the canvas caret and keeps what was typed

## Context

`specs/studio-ui-guidelines.md` §8.3, line 476:

> **Status: Partial.** The single `contenteditable` root, the caret landing at the click, `contenteditable="false"` component islands, `data-jx-active-block` and `beforeinput`-only structural interception ship (`packages/studio/src/canvas/iframe-editable-root.ts`, `src/editor/inline-edit.ts`). Escape does not dismiss the document caret: the editing root has no handler and `CARET_STACK` in `src/canvas/iframe-keys.ts` does not forward it. A prop-bound session cancels on Escape instead, as `studio.md` §8.2.6 specifies and the last bullet does not carve out.

The bullet it falls short of (line 485): "Escape dismisses the caret; text is committed, not discarded".

**What exists** (verified against the tree on 2026-09-27)

- `startEditableRoot` in `packages/studio/src/canvas/iframe-editable-root.ts` listens for `selectionchange`, `beforeinput`, `input`, the composition pair, `dragstart` and a capture `pointerdown`, and no `keydown`. Its only Escape is in `forget()`'s docblock, about a prop host the engine already ended. `deactivate()` is the release path: it cancels the idle tick, clears `activeEl`/`activeKey` and calls `onDeactivate`, which the bridge maps to `stopEditing()` (a release commit, then `editEnd`).
- `handleKeydown` in `packages/studio/src/editor/inline-edit.ts` (line 449) handles Escape only in a plain (prop-bound) session: it restores `_plainOriginal`, calls `preventDefault()` and `stopPropagation()`, and ends the session. Its comment at line 473 says Escape "belongs to the editing host, Which owns dismissing the caret", which has no handler.
- The frame forwards a keystroke iff a scope on its stack claims it (`shouldForwardKey`, `packages/studio/src/canvas/iframe-keys.ts`). `escape` is bound only at `canvas` scope, to `selection.selectParent` (`packages/studio/src/commands/defaults.ts`, line 433, with `arrowleft`). So under `CARET_STACK = ["caret", "global"]` (line 60) Escape is neither forwarded nor prevented, which is `studio.md` §13.3 working as written; nothing in the frame acts on it.
- Two in-frame listeners already claim Escape before the editing host could: the slash bridge (`startIframeSlashBridge`, `packages/studio/src/canvas/iframe-slash.ts`) intercepts it in capture on the document while the menu is open, with `stopPropagation()`; and the prop engine's handler above.
- `studio.md` §10's caret table has the row "`Escape` | Dismiss the caret", and its marker names this gap. `docs/studio/editing/writing.md` line 35 already tells readers ":kbd[Esc] puts the cursor away."

**Found while detailing**

- **The selection does not follow the caret.** Only a click (`hit`, `packages/studio/src/canvas/iframe-host.ts`) writes `session.selection`; `editStart` does not, and the parent reads the caret's block from `getEditSnapshot().snapshot?.path` separately (`panels/block-action-bar.ts`, `canvas/canvas-render.ts`). After a click in one paragraph and the arrow keys into the next, ending the session would leave the first paragraph selected, and the no-caret table's Delete would remove a block the author was not in.
- **The parent's `endEdit` does not release the root.** Its branch in `startIframeInlineEdit` (`packages/studio/src/canvas/iframe-inline-edit.ts`, line 601) calls `stopEditing()` and leaves `activeKey` set, so a later caret in the same block re-activates nothing. This is the same shape `forget()` was added to fix for prop hosts. It is not this plan's item, but it is why a dismissal must go through `deactivate()` and not reuse that message.

## Outcome

studio-ui-guidelines.md §8.3 → Implemented. With a document caret live, Escape commits the block's text, clears the caret, and leaves the caret's block selected with keyboard focus still in the canvas, so the no-caret keys (`studio.md` §10) act on it straight away. The slash menu, an IME composition and a prop-bound session each keep their own Escape. The spec's last bullet says so, and `studio.md` §10's marker stops naming the gap.

## Decisions

- **Open:** after Escape, is the caret's block the selection, or is nothing selected? §8.3 says only "dismisses the caret", and §8.1 says a block may be selected without one. Recommendation: the caret's block. The selection is kept when it already holds that block, and otherwise replaced as a click would replace it. This makes Escape the keyboard route from writing to structure (then ↑/↓, Delete, ⌘D), and a second Escape already climbs through `selection.selectParent` and clears at the document element. Clearing on the first press would strand a keyboard user with no selection and no caret. If declined, the host handler clears `session.selection` instead, and the bullet says the selection is emptied.
- **Decided:** the gesture lives at the editing host (a `keydown` listener in `startEditableRoot`) and not in a `caret`-scoped command record. The caret's other keys (Enter, Backspace at a boundary, "/") are all host gestures, and a record would collide twice. The frame's forwarding listener is registered before the slash bridge's (`iframe-entry.ts`, both in capture on the document), so Escape with the menu open would be forwarded as well as navigated: the menu would close and the caret would go with it. In the parent realm, with focus in the block bar and the caret still live, it would fire beside the bar's own Escape (`leaveBar`, which prevents default but does not stop propagation, and `dispatchKey` does not check). Leaving `escape` `canvas`-scoped keeps §13.3's derivation intact, and it gives an author's own rebinding precedence: a caret-scoped chord on Escape is prevented in capture, and the host skips a prevented event.
- **Decided:** dismissal releases through the root's own `deactivate()` (the commit a caret leaving the block already takes), then `removeAllRanges()` and `blur()` on the host. This way the root's bookkeeping is cleared (a click back into the same block re-activates it), the pending idle tick is cancelled rather than fired after the release, and the later `selectionchange` with no focus node is the existing no-op.
- **Decided:** the frame keeps window focus, and only the editing host is blurred. With no session, the frame's stack is `["canvas", "global"]`, so the next Escape, the arrows and Delete forward to the structural records with no new wiring.
- **Decided:** the handler ignores a modified Escape, a `defaultPrevented` event, `e.isComposing` or the root's own `composing` flag, a mode other than design or edit, and a prop host (`activeKey === null`). The prop session's cancel is `studio.md` §8.2.6's, and its handler already stops propagation.
- **Decided:** the block reaches the parent as a new `caretDismissed { path }` message, posted after the release's `editCommit` and `editEnd` on the FIFO channel. `editEnd` is not extended, because its handler drops an `editEnd` that arrives while the host is not editing (`if (!state.editing) return`, the guard against a superseded one), and a dismissal must not be dropped with it.
- **Decided:** trim `studio.md` §10's marker in the same pull request, as a patch fragment. That section is `plan:studio/keyboard-shortcut-tables`'s, but its marker would otherwise state a gap the tree no longer has.

## Implementation

1. `packages/studio/src/canvas/iframe-editable-root.ts`
   - `EditableRootDeps` gains `onDismiss?: (path: JxPath) => void`, documented as "The author dismissed the caret with Escape. Called after `onDeactivate` has released and committed the block, with that block's path."
   - In `startEditableRoot`, keep the active block's `JxPath` beside `activeKey` (`let activePath: JxPath | null`). `syncActiveBlock` sets it from `block.path`, and every place that clears `activeKey` clears it too (`forget`, `deactivate`, and the prop adoption in `onPointerDownCapture`).
   - Add `onKeyDown(e: KeyboardEvent)`. It returns unless `e.key === "Escape"` with no modifier. It also returns when `e.defaultPrevented`, `e.isComposing || composing`, `!editingAllowed()`, or `activeKey === null` (no block, or a prop host). Otherwise it calls `e.preventDefault()`, takes `const path = activePath`, calls `deactivate()`, then `doc.getSelection()?.removeAllRanges()`, `container.blur()`, and `deps.onDismiss?.(path)`.
   - Register `container.addEventListener("keydown", onKeyDown)` with the other listeners and remove it in `stop()`.
   - The module docblock's "owns three things" becomes four. Add: "**Dismissing the caret.** Escape releases the active block (committing it), clears the selection and blurs the host, and the parent keeps the block selected (`studio-ui-guidelines.md` §8.3). The slash menu, an IME composition and a prop-bound host each claim Escape first."
2. `packages/studio/src/canvas/iframe-inline-edit.ts`: in the `startEditableRoot(container, { … })` deps, add `onDismiss: (path) => channel.post({ kind: "caretDismissed", path })`. Add a one-line comment that `editCommit` and `editEnd` are already queued ahead of it.
3. `packages/studio/src/canvas/iframe-protocol.ts`: add `| { kind: "caretDismissed"; path: (string | number)[] }` to `IframeToParent`, beside `editEnd`, commented "The author dismissed the document caret with Escape. Posted after the release commit and `editEnd`; the host makes the block the selection."
4. `packages/studio/src/canvas/iframe-host.ts`
   - `handleMessage` gains `case "caretDismissed"`. It returns for a stylebook host, where specimen paths are not document paths (the `hit` branch's reason). Otherwise `const tab = hostTab(state)` (no tab is a no-op), and when `!tab.session.selection.some((p) => pathsEqual(p, msg.path))`, it writes `tab.session.selection = [[...msg.path]]`. The selection watcher (`ensureSelectionWatch`) re-measures and redraws the box, and the block bar falls back to `lastSelectionRect` now that `activeEditHost` is null.
   - Add `"caretDismissed"` to `PREVIEW_BLOCKED`, since the canvas bundle can be older than the host.
5. `packages/studio/src/canvas/iframe-keys.ts`, comment only: add a bullet to the module docblock saying that Escape is `canvas`-scoped alone (`selection.selectParent`), so with a caret live it is neither forwarded nor prevented and the editing host dismisses the caret (`studio-ui-guidelines.md` §8.3), while with no caret it forwards and climbs to the parent. This stops a later change from "fixing" it by adding a caret-scoped binding.
6. `packages/studio/src/editor/inline-edit.ts` is unchanged. Its line-473 comment becomes true.

**Integration contract.** Once this lands, Escape with a document caret commits the block, dismisses the caret and, per the Open decision, leaves the caret's block selected with focus in the frame. So `studio.md` §10's caret-table row "Escape | Dismiss the caret" is true, and the next press is the no-caret table's Escape (`selection.selectParent`). No command record binds Escape at `caret` scope, so `shortcutReference()` and the generated shortcuts page will not list it: like Enter and Backspace, it appears only in a hand-written table. `plan:studio/keyboard-shortcut-tables` must keep that row if it moves §10 toward generated tables. `studio.md` §10's marker no longer mentions caret Escape. New surface: `EditableRootDeps.onDismiss` and the `caretDismissed` protocol message. `plan:studio/space-drag-pan` touches the same marker sentence, and whichever lands second rewrites what is left of it.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`.

- `tests/iframe-editable-root.test.ts`, new `describe("Escape dismisses the caret")`. The fixture sets `contentEditable = "true"` on the container and focuses it.
  - "Escape releases the block through onDeactivate, clears the selection and reports its path": after `caretInto` a `<p>` and a keydown on the container, `rec.deactivated` is 1, `onDismiss` received the `<p>`'s path, `getSelection().rangeCount` is 0, the container is not `document.activeElement`, and the event is `defaultPrevented`.
  - "a caret placed back in the same block after Escape re-activates it": `rec.activated` has two entries for the same path.
  - "a pending idle tick is cancelled, not fired after the release": type, press Escape, wait past `commitDelayMs`, and `onCommitTick` has not run.
  - `test.each` "Escape is not a dismissal when %s": no active block; the mode has moved to `preview` since activation (a mutable `getMode`); `shift` held; the event is already `defaultPrevented`. For each, `onDeactivate` and `onDismiss` are not called.
  - "Escape in an adopted prop host is left to the engine": after the marker pointerdown and caret, nothing is deactivated or dismissed.
- `tests/editable-root-composition.test.ts`: "Escape during a composition belongs to the input method". After `compositionstart`, and separately for a keydown with `isComposing: true`, the block stays active and `onDismiss` is not called.
- `tests/iframe-inline-edit.test.ts`, new `describe("Escape at the editing host")`:
  - "Escape commits the typed text, ends the session and reports the block": after `clickInto(el)`, a text change, `input` and Escape on the container, the posts are, in order, `editCommit` (`textContent: "Typed"`, no `inPlace`), `editEnd`, and `caretDismissed` with `path: ["children", 0]`; `isEditing()` is false.
  - "the same block can be re-entered after Escape": a second `clickInto(el)` posts a second `editStart`.
  - "Escape with the slash menu open closes the menu and keeps the caret": with `startIframeSlashBridge` booted and the menu opened, Escape posts `slashNav` `Escape` and no `editEnd` or `caretDismissed`, and `isEditing()` stays true. This pins `docs/studio/editing/slash-commands.md`'s "press Esc" sentence.
  - The existing prop test "and after Escape, which ends the session the same way" also asserts that no `caretDismissed` is posted.
- `tests/iframe-host.test.ts`, `describe("iframe canvas interaction")`:
  - "caretDismissed makes the caret's block the selection when it had moved elsewhere": after a `hit` on `["children", 0]` and `caretDismissed` for `["children", 1]`, `session.selection` is `[["children", 1]]`.
  - "caretDismissed keeps a selection that already holds the block": two accumulated hits, then `caretDismissed` for one of them, and the selection is unchanged.
  - In `describe("preview renders")`: "caretDismissed selects nothing".
- `tests/iframe-keys.test.ts`, `describe("the frame's table is the app's keymap")`: "Escape is the editing host's under a caret and structure's without one". Against the live table, `shouldForwardKey` for Escape is false with a session in `edit` and true without one in `design`, and no `caret`-scope entry has the chord `escape`.

Coverage: the per-file thresholds in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) hold. Every new branch has a case above, none of the touched files is the workspace floor, so there is no ratchet. There is no new source file, so the manifest check needs nothing.

## Specs & docs

- **studio-ui-guidelines.md §8.3 marker** (line 476) is replaced by:

  > **Status: Implemented.** The single `contenteditable` root, the caret landing at the click, `contenteditable="false"` component islands, `data-jx-active-block` and `beforeinput`-only structural interception ship (`packages/studio/src/canvas/iframe-editable-root.ts`, `src/editor/inline-edit.ts`), and Escape at the editing host commits the caret's block, dismisses the caret and leaves that block selected (`src/canvas/iframe-inline-edit.ts` reports it, and `src/canvas/iframe-host.ts` selects it).

- **§8.3's last bullet** (line 485) becomes:

  > - Escape dismisses the caret and leaves its block selected, the state §8.1 calls selected without a caret; text is committed, not discarded. Three owners come first: an open slash menu, which Escape closes while the caret stays; an IME composition, whose Escape is the input method's; and a prop-bound session, where Escape is a real cancel that restores the prop's text (`studio.md` §8.2.6).

  If the Open decision is declined, "and leaves its block selected, the state §8.1 calls selected without a caret" becomes "and clears the selection", and the marker's "and leaves that block selected" becomes "and clears the selection".

- **Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§8.3 Escape at the canvas editing host commits the block's text, dismisses the caret and leaves that block selected; an open slash menu, an IME composition and a prop-bound session keep their own Escape."`
- **studio.md §10 marker** (line 1130): the sentence "Two rows describe gestures that do not exist yet: Escape with a caret does nothing (the caret stack does not forward it and the editing root has no handler), which is `studio-ui-guidelines.md` §8.3's gap, and Space+drag is §4.3's." becomes "One row describes a gesture that does not exist yet: Space+drag, which is §4.3's." If `plan:studio/space-drag-pan` has landed first, the sentence is deleted. The section stays Partial. Fragment: `bun run spec:change studio.md patch -m "§10's marker no longer lists Escape with a caret among the gestures that do not exist yet."`
- **`docs/studio/editing/writing.md`**: its `spec:` cites `studio-ui-guidelines.md#8.3`, and its `code:` lists `iframe-editable-root.ts` and `iframe-inline-edit.ts`. The "Moving around" bullet on line 35 becomes: "- :kbd[Esc] puts the cursor away and keeps what you typed. The block you were in stays selected, so the [selection keys](/docs/studio/interface/canvas#selecting-elements) work on it straight away: :kbd[Esc] again steps out to its parent, and :kbd[Delete] removes it. With the slash menu open, :kbd[Esc] closes the menu and the cursor stays." It has no em dash.
- No other page changes. `docs/studio/interface/canvas.md` cites §8.1, and its "Esc steps out to the parent" describes the no-caret state, which stays true. `docs/studio/editing/slash-commands.md`'s "press Esc" stays true and is now pinned by a test. `docs/studio/editing.md` lists `inline-edit.ts`, which is unchanged.
- No graduation: studio-ui-guidelines.md keeps other open items (§8.1, §8.2 and more; `bun run plans:status --spec studio-ui-guidelines`). The landing pull request deletes this file and removes `studio-ui-guidelines/caret-escape` from any dependent's `requires` (`plan:studio/keyboard-shortcut-tables`, once it draws the edge).

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` is green with the new cases and no file below its threshold. `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun run typecheck` and `bun run lint` are clean.
- `bun run plans:status --spec studio-ui-guidelines` no longer lists §8.3. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:prose`, `bun run docs:links` and `bun run docs:section-refs` pass. `bun run docs:sync` names `docs/studio/editing/writing.md`, and it is in the diff.
- By hand, following the `packages/studio:verify` recipe (dev server and Chrome DevTools). In Edit mode, click into a paragraph, type, arrow into the next paragraph, type, and press Escape. No caret is painted, the selection box and the Inspector show the second paragraph, and a reload after ⌘S keeps both edits. Escape again selects the parent. Type "/" and press Escape: the menu closes and typing continues in the block. Click a component's prop-bound text, type, and press Escape: the text reverts, and the tab is not dirty.
