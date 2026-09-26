---
status: stub
disposition: reconcile
claims:
  - studio-ui-guidelines.md#2.1
size: S
workspaces:
  - packages/studio
---

# Font Stacks names the kit's font tokens and drops the content-mode face that never shipped

## Context

`specs/studio-ui-guidelines.md` §2.1, line 82:

> **Status: Partial.** The chrome draws the kit's font tokens: `--jx-font-sans` is `"Inter Variable", "Inter", system-ui, …` and `--font-mono` leads with the bundled JetBrains Mono (`packages/ui/project.json`, `packages/studio/styles/tokens.json`), so the sans stack in the table is only `tokens.css`'s pre-paint fallback. No content mode and no Georgia canvas face exist: `CANVAS_MODES` is preview, design, edit, stylebook and git-diff.

Disposition `reconcile`: the chrome's faces are the kit's by design (§1: every surface is a document over the kit), JetBrains Mono is bundled deliberately with an `@font-face` so the first frame is not a fallback face, and the canvas renders the author's own document styles rather than a mode font.

**What exists**

- `packages/ui/project.json`: `--jx-font-sans` and `--jx-font-mono`.
- `packages/studio/styles/tokens.json`: `--font-mono` aliasing `--jx-font-mono`, the `@font-face` rules, and the pre-paint sans stack; `packages/studio/fonts/` holds the woff2.
- `CANVAS_MODES` in `packages/studio/src/canvas/iframe-protocol.ts` and `src/canvas/canvas-utils.ts`; the canvas iframe body uses the system sans stack (`src/canvas/iframe-render.ts`).

**What is missing**

- The table rewritten to the kit's two tokens (or reduced to a pointer at `ui.md` §4), with the pre-paint fallback named as such.
- The "Canvas content" row deleted, since no content mode exists.

**Related**

- `ui.md` §4 (typography tokens).
- `studio.md` §4.2 (canvas modes).
- `plan:studio-ui-guidelines/chrome-type-scale`, which removes the matching content-mode line height from §2.2.
