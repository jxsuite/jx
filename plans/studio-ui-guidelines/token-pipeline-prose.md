---
status: stub
disposition: reconcile
claims:
  - studio-ui-guidelines.md#1.1
size: S
workspaces:
  - packages/studio
---

# Theme Tokens describes the style pipeline that ships: build-styles, oklab accents, and where the animations live

## Context

`specs/studio-ui-guidelines.md` §1.1, line 24:

> **Status: Partial.** The token table and its fallbacks ship and are gated (`guidelineTokenFindings()` in `packages/studio/scripts/check-styles.ts`). The pipeline prose below is stale: the generator is `scripts/build-styles.ts` behind `bun run styles:check` / `styles:sync` (there is no `build-tokens.ts` and no `tokens:*` script), the accent variants mix `in oklab` rather than `in srgb`, and the keyframes paragraph predates the move, since `shell.css` defines none, `inspector.css` keeps only an unreferenced `pulse`, and the live animations are in `src/surfaces/panel-signals.json` and `ai-chat.json`.

Disposition `reconcile`: the table itself is right and gated, and every stale sentence describes an arrangement the code moved away from on purpose (one generator for every stylesheet, oklab mixing inherited from the kit's `--jx-accent-N`, animations hoisted into the documents that use them).

**What exists**

- `packages/studio/scripts/build-styles.ts`, run by `styles:check` and `styles:sync` (`packages/studio/package.json`); the generated sheets' headers say "Regenerate with bun run styles:sync".
- `packages/studio/styles/tokens.json`: `--accent-8` to `--accent-50` as `var(--jx-accent-N, color-mix(in oklab, var(--accent) N%, transparent))`.
- `packages/studio/scripts/check-styles.ts`: `guidelineTokenFindings()` (the table against `tokens.css`) and the duplicate `@keyframes` gate (`duplicateAnimations`).
- `@keyframes`: only `pulse` in `styles/inspector.css`, with no reference; `jx-signals-pulse` in `src/surfaces/panel-signals.json`; `jx-ai-cursor` and `jx-ai-typing` in `src/surfaces/ai-chat.json`.

**What is missing**

- The `tokens.css` paragraph rewritten to name `build-styles.ts` and the `styles:*` pair.
- The accent-variant bullet rewritten to the aliases `tokens.json` declares.
- The keyframes paragraph rewritten to where the animations are now; whether the orphaned `pulse` in `inspector.css` is deleted in the same pull request is a detail-phase decision.

**Related**

- `ui.md` §4 (the kit's colour tokens and `--jx-accent-N`).
- `spec.md` §9.6 (keyframes hoisted by rule text), which the paragraph cites.
