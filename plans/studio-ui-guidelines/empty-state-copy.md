---
status: stub
disposition: implement
claims:
  - studio-ui-guidelines.md#11
size: S
workspaces:
  - packages/studio
---

# Every empty region says what it is for, and a disabled empty-state action says why

## Context

`specs/studio-ui-guidelines.md` §11, line 703:

> **Status: Partial.** `EmptyStateSpec`, its two renderers and the shared verbs ship (`packages/studio/src/panels/empty-state.ts`, `src/surfaces/empty-state.ts`, `empty-state.json`). Two rules do not. Some empty regions say what is absent, against §11.1's first rule: the Bottom dock's fallback is "Nothing to show here yet." (`src/panels/bottom-dock.ts`), and the Files panel's `[part="empty"]` block is the noun phrase "No project loaded" (`src/surfaces/files-panel.json`). And §11.2's disabled action cannot carry its reason: `EmptyStateAction` has only `label`, `run` and `disabled`, and `empty-state.json` binds no hint on `[part="empty-action"]`.

The census had §11 verified; the reviewers found two rules the code does not meet. The vocabulary and its renderers are sound. What fails is copy at a few call sites, and a field the spec's table assumes and the type never had.

**What exists**

- `EmptyStateSpec` and `EmptyStateAction` in `packages/studio/src/panels/empty-state.ts`; `EmptyStateAction` is `{ label; run; disabled? }`.
- `src/surfaces/empty-state.ts` projects each action to `EmptyStateActionRow { id; label; disabled }`, and `src/surfaces/empty-state.json` binds only `size`, `variant` and `disabled` on `jx-button[part="empty-action"]`: a disabled action is greyed with no hint, which §10's "renders disabled with the reason in its tooltip" also forbids.
- Copy that states an absence: the Bottom dock's fallback, `emptyState(host, { message: "Nothing to show here yet." })` in `src/panels/bottom-dock.ts`; the Files panel's `[part="empty"]` block, "No project loaded" (`src/surfaces/files-panel.json`). Other surfaces print absences in their own sub-regions ("No previous chats" in `ai-chat.json`'s `[part="sessions-empty"]`, "No custom head tags on this document." in `doc-header.json`'s `[part="raw-empty"]`); whether a sub-list inside a populated panel is an empty region under §11.1 is for detailing to decide. A filter that matched nothing ("No repositories match the filter.") is a result, not an empty region.
- Tests: `packages/studio/tests/empty-state.test.ts`, `empty-state-surface.test.ts`.

**What is missing**

- The Bottom dock's fallback and the Files panel's empty block rewritten as a sentence saying what the region is for, with the action that fills it where one exists (opening a project, for the Files panel), and the same rule applied to any sub-region detailing puts in scope.
- A reason on a disabled action: `EmptyStateAction` gains a `requires` sentence (the command registry's word for it), projected as the button's hint; or, where an action is a command, the row is built from the record so the reason is the record's `requires`.
- Tests for the reason reaching the hint and for the rewritten copy.

**Related**

- `studio-ui-guidelines.md` §10 (the empty-region and disabled-control items), §12.3 (`requires` as the disabled tooltip).
- `studio.md` §16.3 (the Bottom dock).
