---
status: stub
disposition: implement
claims:
  - studio.md#4.3
size: S
workspaces:
  - packages/studio
---

# Holding Space and dragging pans the design canvas

## Context

`specs/studio.md` §4.3, line 268 (the section was unmarked before the census):

> **Status: Partial.** Space+drag pan does not exist: `installStageGestures` in `packages/studio/src/editor/shortcuts.ts` pans only on a middle-button drag (`e.button === 1`), and neither the shell nor the canvas frame has a Space-hold handler. Ctrl+wheel zoom toward the cursor, wheel ownership, the page-zoom block, fit on entry and per-document zoom memory ship.

Disposition `implement`: a trackpad has no middle button, so on a laptop the design canvas can be panned only by the wheel, and §10's viewport table promises the chord as well.

**What exists**

- `installStageGestures` in `packages/studio/src/editor/shortcuts.ts`: Ctrl+wheel zoom toward the cursor, middle-button drag pan, `SELF_SCROLLING_MODES`, the global Ctrl+wheel block outside stages, `markExplicitZoom`.
- `packages/studio/src/canvas/iframe-entry.ts`: the frame's own wheel handling in preview; the keymap forwarding of §13.3, which decides which keys the frame forwards to the shell.
- Tests: `packages/studio/tests/canvas-stage.test.ts`, `tests/shortcuts.test.ts`.

**What is missing**

- A Space-hold that arms pan while the pointer is over a pan/zoom stage, with a grab cursor, and a drag that pans exactly as the middle button does.
- The same gesture from inside the canvas frame, which means the frame reporting Space-hold and drag, since the frame owns the pointer there.
- Space left alone when a caret is live or a text field has focus: Space is typing there, so the arm must key on the caret and focus facts (`caret.active`, §13.4), not on the key alone.
- Editorial ride-along, since this change edits §4.3: its fit paragraph names "the tab bar's −/+/100%/Fit controls", which are the floating zoom pod drawn over the canvas (`packages/studio/src/panels/pane-context.ts`), not a tab bar.

**Related**

- studio.md §10 (its Canvas viewport table lists the chord), studio.md §13.3 (key scopes and frame forwarding), studio.md §13.4 (`caret.active`).
