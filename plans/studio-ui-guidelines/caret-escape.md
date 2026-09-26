---
status: stub
disposition: implement
claims:
  - studio-ui-guidelines.md#8.3
size: S
workspaces:
  - packages/studio
---

# Escape dismisses the canvas caret and keeps what was typed

## Context

`specs/studio-ui-guidelines.md` §8.3, line 476:

> **Status: Partial.** The single `contenteditable` root, the caret landing at the click, `contenteditable="false"` component islands, `data-jx-active-block` and `beforeinput`-only structural interception ship (`packages/studio/src/canvas/iframe-editable-root.ts`, `src/editor/inline-edit.ts`). Escape does not dismiss the document caret: the editing root has no handler and `CARET_STACK` in `src/canvas/iframe-keys.ts` does not forward it. A prop-bound session cancels on Escape instead, as `studio.md` §8.2.6 specifies and the last bullet does not carve out.

**What exists**

- `packages/studio/src/canvas/iframe-editable-root.ts`: the document-wide editing host; it mentions Escape only for a prop-host session the engine already ended.
- `packages/studio/src/editor/inline-edit.ts`: `handleKeydown` handles Escape only in plain (prop-host) mode, restoring `_plainOriginal`; its comment says Escape "belongs to the editing host … see `iframe-editable-root.ts`", which has no handler.
- `packages/studio/src/canvas/iframe-keys.ts`: `CARET_STACK = ["caret", "global"]`; `escape` is bound at `keyScope: "canvas"` to `selection.selectParent` (`src/commands/defaults.ts`), which the caret stack never reaches.
- `studio.md` §10's keyboard table already lists Escape as "Dismiss the caret" with a caret, and "Deselect" with a block selected and no caret.

**What is missing**

- An Escape binding for the document caret: collapse and blur the caret, leave the block selected (the "selected without a caret" state §8.1 describes), and commit the text rather than discard it. Where the binding lives (the editing root, or `escape` added to the caret key stack with a caret-scope command) is a detail-phase decision.
- A test that Escape in a document block keeps typed text and leaves the block selected, beside the existing prop-host cancel test.
- §8.3's last bullet qualified to say a prop-bound session cancels (`studio.md` §8.2.6), so the two specs agree.

**Related**

- `studio.md` §8.2 (fluid document editing), §8.2.6 (prop-bound text), §10 (keyboard shortcuts).
- `studio-ui-guidelines.md` §8.1 (a block selected without a caret).
