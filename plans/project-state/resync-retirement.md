---
status: drafted
disposition: implement
claims:
  - project-state.md#3.3
requires:
  - project-state/client-store
  - project-state/cloud-conformance
workspaces:
  - packages/studio
  - packages/desktop
size: S
---

# Every adapter subscribes, so Studio stops repairing gaps with resync reasons and drops the echo window

## Context

`specs/project-state.md` §3.3 is `Pending`: "Studio still repairs gaps with the `"open"`, `"reconnect"` and `"commit"` resync reasons of `studio.md` §9.2." Every adapter reports them through the `onResync` option of `subscribeFileEvents` (`packages/desktop/src/webview/platform.ts`, `packages/studio/src/platforms/devserver.ts`, `packages/studio/src/platforms/cloud.ts`), the fold of `FsEvent`s into listings lives in `packages/studio/src/files/fs-events.ts`, and that module also suppresses echoes by a 1.5 second window (`RECENT_MS`). The resync path can only go once no adapter needs it: the desktop host (§10.1) and the dev-server host (§10.2) serve the subscription, the cloud host (`plan:project-state/cloud-conformance`) must too, and the client must already consume it (`plan:project-state/client-store`).

## Outcome

§3.3 → Implemented: no adapter reports a resync reason, `onResync` and the echo window are deleted from Studio, and a reconnect is a subscribe with `sinceRev` on every platform.

## Decisions

- **Decided:** this is its own plan rather than `plan:project-state/client-store`'s last slice, so that the edges to all three hosts are written in `requires` and the gate, not prose, keeps the resync path alive until each host has shipped.
- **Decided:** the `onResync` option of `StudioPlatform.subscribeFileEvents` is removed rather than deprecated, because breaking changes are acceptable before 1.0 and an embedder's adapter that still calls it is ignored harmlessly.

## Implementation

Delete the resync branches in the three adapters, `RECENT_MS` and the listing fold in `packages/studio/src/files/fs-events.ts`, and the `onResync` option and `FsResyncReason` from `packages/studio/src/types.ts`; route every remaining caller through the store's subscription.

**Integration contract.** None: nothing requires this plan.

## Tests

Remove the resync cases from `packages/studio/tests/fs-events.test.ts` and the adapter tests, and add one per adapter asserting a reconnect sends `{ epoch, sinceRev }` and runs no listing pass. Coverage in `packages/studio`.

## Specs & docs

§3.3 → Implemented, and `studio.md` §9.2 drops the resync reasons and the echo window. Fragments: `bun run spec:change project-state.md minor -m "Every adapter subscribes, and the resync reasons are retired."` and `bun run spec:change studio.md major -m "The resync reasons and the echo window are removed in favour of the project state subscription."`. `docs/extending/embedding/platform-adapter.md` drops `onResync`.

## Acceptance

`bun test --isolate` for the touched Studio tests, `bun run plans:check`, `bun run docs:check`, and a manual reconnect on each platform.
