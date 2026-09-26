---
status: stub
disposition: implement
claims:
  - studio.md#10.1
size: S
workspaces:
  - packages/studio
---

# Open in Browser is never hidden, and says why it is blocked before it is pressed

## Context

`specs/studio.md` §10.1, line 1175 (the section was unmarked before the census):

> **Status: Partial.** The route-addressed live preview, the dirty-document overlay, the per-project origin with acknowledged reuse, the `buildSite` fallback and all seven reasons ship (`packages/studio/src/surfaces/commandbar.ts`, `preview/preview-overlay.ts`, `packages/server/src/live-preview.ts`). The blocked state does not: `view.openInBrowser` is hidden by `when: ctx.project.isSite`, its enablement asks only for an open document, so a non-page renders enabled and says nothing until pressed, the generic `requires` sentence appearing only with no document open, and a blocked invocation reports through `notify.warn` rather than the status bar, which §16.2 now keeps free of transient messages.

Two parts under one anchor. Disposition `implement` for the blocked state, which is `studio-ui-guidelines.md` §12.3's rule (disabled with its reason, never hidden) and which the code does not follow. The destination of a chord-invoked refusal is a reconcile: §16.2 forbids transient messages in the status bar and §16.1 makes `notify` the one entry point, so the code's toast is right and the section's last sentence is stale.

**What exists**

- The `view.openInBrowser` record in `packages/studio/src/commands/defaults.ts`: `when: (ctx) => ctx.project.isSite`, `enablement: documentOpen`, `requires: "a page to preview"`.
- `openInBrowserTarget` and `runOpenInBrowser` in `packages/studio/src/surfaces/commandbar.ts`, which compute the seven per-condition reasons and report one through `notify.warn` when invoked.
- Tests: `packages/studio/tests/commandbar.test.ts`, `tests/preview-overlay.test.ts`, `packages/server/tests/live-preview.test.ts`.

**What is missing**

- `when` removed or widened so the action shows in a non-site project, disabled.
- An enablement that evaluates the same resolution `openInBrowserTarget` performs, and a per-condition `requires` so the tooltip, the palette subtitle and any refusal carry the table's reason. Today a non-page shows an enabled control with no reason at all, because `commandTooltip` and the overflow rows in `commandbar.ts` print `requires` only when `registry.disabledReason` returns one, and the generic sentence appears only with no document open. The record's `requires` is a string today; how a record states a reason that depends on state is a decision, possibly a registry-level one.
- §10.1's last sentence reconciled to the toast (a Problem when it must be fixed).

**Related**

- studio-ui-guidelines.md §12.3 (disabled with the reason), studio.md §13.1 (`when`, `enablement`, `requires`), studio.md §16.1 and studio.md §16.2 (tiers, and the status bar's ambient-only rule).
