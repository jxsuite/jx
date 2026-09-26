---
status: stub
disposition: reconcile
claims:
  - studio.md#7.4
size: S
---

# The Style Editing section says Stylebook writes bare tag keys and edits every token per context

## Context

`specs/studio.md` §7.4, line 774 (the section was unmarked before the census):

> **Status: Partial.** Scheme routing into `@--name`, the link to Project Settings › Contexts and the in-place site-style push ship (`packages/studio/src/panels/style-panel.ts`, `settings/css-vars-editor.ts`). Stylebook edits write bare nested tag keys (`h1`, `table` then `th`) through `mutateUpdateNestedStylePath`, not `& tag` rules; there are no media breakpoint tabs, the breakpoint being chosen on the pane context bar (§6.2); and the token editor overrides every token group in any declared context, breakpoints included, not only colour tokens per scheme.

Disposition `reconcile`. The bare nested key is what `stylebook-doc.ts` reads to draw the specimens, what §4.1's site stylesheet emits as an unscoped element rule, and what `mutateUpdateNestedStylePath` writes; §6.2 already moved the breakpoint to the pane context bar; and the broader token editor is a superset of what the section promises.

**What exists**

- `contextMutate` in `packages/studio/src/panels/style-panel.ts` (tag path to `mutateUpdateNestedStylePath` / `mutateUpdateMediaNestedStylePath`); `ensureNestedStyle` (`@jxsuite/schema/guards`), which `tabs/transact.ts` calls.
- `packages/studio/src/panels/stylebook-doc.ts`, reading bare tag keys and nested tag paths.
- `packages/studio/src/settings/css-vars-editor.ts` (token overrides per declared context), `src/style/live-preview.ts` and `pushProjectStylesToCanvas` (the in-place `siteStyleUpdate`).

**What is missing**

- The first paragraph rewritten: bare nested tag keys rather than `& tag` rules; the breakpoint chosen on the pane context bar rather than "media breakpoint tabs".
- The token-editor paragraph widened to overrides in any declared context, breakpoints and schemes alike.
- The key shape stated once, so `plan:studio/stylebook-layers-tag-keys` can make the layers tree read it.

**Related**

- studio.md §6.2 (the pane context bar and the Target Line), studio.md §17.1 (Contexts as the definition site), spec.md §9.2 (nested CSS selectors), spec.md §9.5 (scheme blocks), studio.md §4.1 (the site stylesheet).
