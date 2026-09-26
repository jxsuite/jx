---
status: stub
disposition: implement
claims:
  - studio.md#8.2.8
size: M
workspaces:
  - packages/studio
---

# A keyboard user can reach the block action bar from a caret in the canvas, and blocks are navigable as landmarks

## Context

`specs/studio.md` §8.2.8, line 835 (the section was unmarked before the census, and its own prose said the two items below "are not yet implemented"):

> **Status: Partial.** The region's `role="textbox"`, `aria-multiline` and label ship with `contenteditable` (`syncEditableRoot` in `packages/studio/src/canvas/iframe-render.ts`). The two gaps named below remain: no block carries a landmark, and the bar's keyboard entry (⌥↑, `handleBlockBarEntryKey` in `panels/block-action-bar.ts`) is bound on the parent document, so it does not fire from a caret inside the canvas frame.

Disposition `implement` for the keyboard entry, which is a real barrier: the bar carries the only canvas drag source, the move verbs and inline formatting, and an author writing in the canvas cannot reach it without a mouse. Per-block landmarks are the weaker half; the detail phase decides whether they are specified here or recorded as a Future remainder.

**What exists**

- `syncEditableRoot` in `packages/studio/src/canvas/iframe-render.ts` (role, `aria-multiline`, `aria-label="Document content"`), tested in `packages/studio/tests/iframe-render.test.ts`.
- `handleBlockBarEntryKey` in `packages/studio/src/panels/block-action-bar.ts`, bound with `document.addEventListener("keydown", …)` on the shell document, which focuses the bar's toolbar on ⌥↑.
- The canvas keymap forwarding (§13.3): the frame forwards a keystroke only when a live (chord, scope) pair claims it, so a chord that is not a command record never leaves the frame.

**What is missing**

- ⌥↑ reaching the bar from a caret inside the frame: most directly by making the entry a command record with a chord, so the frame's keymap forwards it and it appears in the palette and the Keyboard sheet.
- A way back from the bar to the caret where it left.
- A decision on per-block landmarks (what role each block would carry, and whether a screen reader gains from it inside a `textbox`), then either a specified contract or a Future remainder.
- The section's last paragraph rewritten to what ships.

**Related**

- studio.md §4.4 (the bar), studio.md §13.3 (frame key forwarding), studio-ui-guidelines.md §8.6 (the floating action bar), studio.md §19 (the ATAG 2.0 row; Part A is studio-ui-guidelines.md §13.1a).
