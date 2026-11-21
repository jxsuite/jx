---
status: drafted
disposition: implement
claims:
  - project-state.md#9
requires:
  - project-state/dependency-graph
  - project-state/desktop-service
  - project-state/client-store
workspaces:
  - packages/server
  - packages/studio
size: M
---

# A rename and its reference rewrites are one operation that completes or rolls back

## Context

`specs/project-state.md` §9 is `Pending`. `applyRename` (`packages/server/src/refactor/`) moves the file and then rewrites each referrer as a separate write, with no record of what ran and no undo, and a referrer open with unsaved edits is rewritten on disk under its buffer.

## Outcome

§9 → Implemented: `rename` on the host plans every step, applies it from an outbox with rollback, refuses or defers dirty referrers per policy, and emits `operationApplied`.

## Decisions

- **Decided:** the outbox is in memory on the desktop and dev server; a crash mid-operation leaves the steps already applied, and the host's next start reports them as external changes. Durable outboxes wait for §13.
- **Decided:** referrers come from the graph. Where it is partial, the host refuses a rename without the client's `rewrites` for the unindexed documents, and applies those rewrites as outbox steps (§9.1); the cloud has no other way to reach them.
- **Open:** whether `rewrite-buffer` is the default policy in Studio's rename dialog, or `refuse` with an offer to save first. Recommendation: `rewrite-buffer`, since the author keeps both their edits and a correct reference.

## Implementation

`packages/server/src/project-state/rename.ts` over `applyRename`'s planning half, and Studio's rename flow (`studio.md` §9.1.1) sending `RenameOperation` with each tab's buffer revision and applying the rewrite to dirty buffers.

**Integration contract.** None beyond §9.

## Tests

Rollback on an injected failure at each step, a referrer changed between plan and apply, both policies, a partial graph with and without `rewrites`; the §10.4 case for a host that serves §9, "a rename either completes or leaves every file as it was", joins the published suite. Coverage in both workspaces.

## Specs & docs

§9 → Implemented; `studio.md` §9.1.1 describes the dirty-referrer behaviour. Fragments for both (minor). `docs:sync` names the Studio file-management pages.

## Acceptance

`bun test --isolate packages/server/tests/project-state-rename.test.ts`, `bun run plans:check`.
