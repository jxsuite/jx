---
status: stub
disposition: implement
claims:
  - studio.md#16.4
size: S
workspaces:
  - packages/studio
---

# Saving a large grid batch is an Activity entry, and dependency installation is the only thing that blocks

## Context

`specs/studio.md` §16.4, line 1626 (the section was unmarked before the census, and the first audit pass listed it as verified):

> **Status: Partial.** Activity entries, their steps, log and Cancel, `fail()` raising a Problem, the blocking modal's _Run in the background_, and the four dependency-install call sites ship (`packages/studio/src/panels/activity-panel.ts`, `ui/progress-modal.ts`). One non-dependency operation still blocks: a grid save touching more than five rows opens the progress modal titled "Saving grid" (`showProgressModal` in `grid/grid-controller.ts`).

Disposition `implement`. The section's rule is "Blocking is retained for dependency installation only", and the grid save is a fifth call site the rule does not admit. `progress-modal.ts`'s own header asserts that its four call sites are exactly the dependency installs and that "every other long operation calls `beginActivity` directly", which the grid controller contradicts.

**What exists**

- `packages/studio/src/grid/grid-controller.ts`: the save path counts affected rows (edited cells' rows, inserts and deletes) and, above five, opens `showProgressModal({ title: "Saving grid" })`, closing it with `progress?.done()` after `source.commit(batch)`. A failed commit reports through the grid's status line ("Could not save the grid").
- `beginActivity(options)` in `packages/studio/src/panels/activity-panel.ts` (`title`, `status`, `source`, `steps`, `cancel`), the non-blocking path every other long operation uses, and a quiescence source for `probe.idle()` (§13.5).
- The four dependency-install call sites: `packages/ensure-deps.ts`, `packages/pull-package-sync.ts`, `packages/jxsuite-update.ts`, `settings/dependencies-editor.ts` (all under `packages/studio/src/`).
- `packages/studio/tests/grid-controller.test.ts`, "shows a progress modal for larger batches and a save error toast on throw", pins the modal as behaviour (`progressOpens` is 1).

**What is missing**

- The grid save opening an Activity entry (source "Grid", a status per phase) instead of the modal, with `fail()` carrying the commit error as a Problem, and the grid's own `saving` state keeping the grid from being edited mid-save if that is still wanted.
- The test rewritten to assert an Activity entry and no modal.
- Whether a save can honestly be cancelled once `source.commit` has started; if not, no Cancel is passed.

**Related**

- studio.md §16.1 (the three tiers), studio.md §16.3 (the Bottom dock and its Activity tab), studio.md §13.5 (running activities are not idle), site-architecture.md §7.2 (the collection grid this save belongs to).
