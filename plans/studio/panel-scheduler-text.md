---
status: stub
disposition: reconcile
claims:
  - studio.md#13.5
  - studio.md#16.5
size: S
---

# The Enforcement and Inline-errors sections describe Studio after the panel scheduler

## Context

Two sections describe one deleted module, `panels/panel-scheduler.ts`, so one plan holds both: the rewrite of either is a statement about the same removal, and they must agree.

`specs/studio.md` §13.5, line 1418 (the section was unmarked before the census):

> **Status: Partial.** The checks, the three tests, `__jxAutomation`'s three rules, the three `?automation=1` exceptions and the modal refusal ship (`packages/studio/src/services/automation.ts`, `scripts/screenshots/lib/shot.ts`). The text names a quiescence source that is gone: `packages/studio/src/services/idle.ts` has six, its seventh having left with the deleted panel scheduler (`panel-scheduler.ts`); and `scripts/check-icons.ts` is `packages/studio/scripts/check-icons.ts`.

`specs/studio.md` §16.5, line 1638 (the section was unmarked before the census):

> **Status: Partial.** Host diagnostics winning over the schema check, an untouched form painting nothing and the two write policies ship (`packages/studio/src/ui/schema-form.ts`). The third paragraph is stale: the focus guard (`panels/panel-scheduler.ts`) was deleted, nothing defers or withholds a panel render, and the Navigator and Inspector skip binding writes that did not change instead (`services/idle.ts`, `panels/right-panel.ts` and `panels/left-panel.ts` record the removal).

Disposition `reconcile`. The scheduler existed because a lit repaint replaced the field being typed into; the Navigator and Inspector are now mounted documents whose bindings write only what changed, so a focused field is never repainted under the author and there is nothing to withhold. The comments at the top of `right-panel.ts` and `left-panel.ts` give that argument.

**What exists**

- `packages/studio/src/services/idle.ts`: six sources (render, canvas, platform, overlay, activity, grid) and the note that the seventh, `pendingSchedulers()`, "went with the scheduler".
- `packages/studio/src/panels/right-panel.ts` and `panels/left-panel.ts`, whose header comments record the removal and its reason.
- `packages/studio/scripts/check-icons.ts`, run by CI as `bun --cwd packages/studio scripts/check-icons.ts`.

**What is missing**

- §13.5's quiescence paragraph rewritten to six sources, without the panel-scheduler clause; the enforcement table's `check-icons.ts` row given its real path.
- §16.5's third paragraph rewritten to say why nothing is withheld, and what does hold when a value changes under a focused field (a collaborator's edit, an undo): whether the binding overwrites the draft or keeps it is the one behavioural question to answer, and a test should pin it. The heading "the withheld render" stays, since numbered headings are never retitled; the paragraph says what became of it.
- Editorial ride-along: §16.6 names "`jx build`" as a consumer of the popover rules, but the command that runs them is `jx validate` (`packages/compiler/src/site/validate-command.ts`), as its own later paragraph says.

**Related**

- studio.md §16.4 (Activity as a quiescence source), studio.md §16.6 (reports about content), `plan:studio-ui-guidelines/retire-renderer-registry` (what else the reactive panels replaced).
