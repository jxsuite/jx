---
status: stub
disposition: implement
claims:
  - studio-ui-guidelines.md#4.4
size: S
workspaces:
  - packages/studio
---

# The debounce pattern names the draft layer, and every text commit takes its delay from the timing module

## Context

`specs/studio-ui-guidelines.md` §4.4, line 271:

> **Status: Partial.** `INPUT_DEBOUNCE` (400) and `CODE_DEBOUNCE` (500) are in `packages/studio/src/ui/timing.ts`, and `debouncedStyleCommit()` is in `store.ts`. Much text entry commits through a provisional preview instead, `LIVE_PREVIEW` at 350ms and then again on blur or Enter: the draft layer (`src/ui/field-input.ts`) in the properties panel, and the same semantics on their own `LIVE_PREVIEW` timers in `panels/head-panel.ts` and `panels/frontmatter-panel.ts`. `panels/seo-modal.ts` and `surfaces/settings-head.ts` keep a local 300ms `EDIT_DEBOUNCE_MS`, and the lit `@input` examples predate the document surfaces.

Disposition `implement`, because §4.4 cannot close on paper: its rewrite states which delay each intent uses, and two panels would still contradict it. The spec half is a reconcile. The provisional preview is a deliberate design, recorded at its constant: `timing.ts` says `LIVE_PREVIEW` is "deliberately below `INPUT_DEBOUNCE`" because that commit is provisional and blur or Enter commits again, and the section should say so. The code half is small: the two local 300ms constants are the drift `timing.ts` exists to stop ("the same intent shipped as 350, 400 and 600 ms in three different panels"), so they move onto a named constant or onto the draft layer in the same pull request, and that timing change is what makes this an `implement`.

**What exists**

- `packages/studio/src/ui/timing.ts`: `INPUT_DEBOUNCE` 400, `CODE_DEBOUNCE` 500, `LIVE_PREVIEW` 350; its header calls the first two contractual under §4.4. Tested in `tests/timing.test.ts`.
- `debouncedStyleCommit()` in `packages/studio/src/store.ts`, used by `src/panels/style-panel.ts` and `src/ui/media-picker.ts` (whose local `FIELD_DEBOUNCE_MS` is 400).
- The draft layer, `packages/studio/src/ui/field-input.ts` (tested in `tests/field-input.test.ts`), whose only importer is `src/panels/properties-panel.ts`.
- The same provisional-then-commit semantics without the draft layer: `src/panels/head-panel.ts` (a `_pending` map) and `src/panels/frontmatter-panel.ts` (`card.pending`) each run `setTimeout(commit, LIVE_PREVIEW)` and commit again through `commitText` on blur or Enter.
- A different intent, not a text commit: `LIVE_PREVIEW_DEBOUNCE_MS = 100` in `src/services/live-preview.ts` delays an expression's canvas preview. Detailing records whether §4.4 names it or leaves it out.
- Local constants: `EDIT_DEBOUNCE_MS = 300` in `src/panels/seo-modal.ts` and `src/surfaces/settings-head.ts`; `DEBOUNCE_MS = 500` in `src/panels/signals-panel.ts`.

**What is missing**

- §4.4 rewritten to three intents (a committing debounce, a code debounce, and the draft layer's provisional preview plus commit on blur or Enter), with examples in the document idiom rather than lit `@input` bindings.
- `seo-modal.ts`, `settings-head.ts`, `media-picker.ts` and `signals-panel.ts` taking their delay from `timing.ts` (or the draft layer), so the section's numbers have one source.
- Whether the head and frontmatter panels move onto the draft layer or §4.4 names both shapes: a detail-phase decision.
- §4.5's table re-read against the result. §10's "Text inputs are debounced (400ms standard)" item is reworded by `plan:studio-ui-guidelines/conventions-checklist`, which requires this plan.

**Related**

- `studio-ui-guidelines.md` §4.5 (event conventions) and §10 (checklist).
- `studio.md` §6.1 (Property Panel) and §17.2 (a no-op edit writes nothing), which the draft layer's commit on blur serves.
