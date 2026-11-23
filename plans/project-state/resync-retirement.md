---
status: drafted
disposition: implement
claims:
  - project-state.md#3.3
  - project-state.md#11.1
requires: []
workspaces:
  - packages/studio
  - packages/desktop
size: M
---

# Every adapter subscribes, so Studio stops repairing gaps with resync reasons, drops the echo window, and keys its caches by the store

## Context

`specs/project-state.md` §3.3 is `Pending`: "Studio still repairs gaps with the `"open"`, `"reconnect"` and `"commit"` resync reasons of `studio.md` §9.2." Every adapter reports them through the `onResync` option of `subscribeFileEvents` (`packages/desktop/src/webview/platform.ts`, `packages/studio/src/platforms/devserver.ts`, `packages/studio/src/platforms/cloud.ts`), the fold of `FsEvent`s into listings lives in `packages/studio/src/files/fs-events.ts`, and that module also suppresses echoes by a 1.5 second window (`RECENT_MS`). The resync path can only go once no adapter needs it: the desktop host (§10.1), the dev-server host (§10.2) and the cloud host (§10.3) serve the subscription, and the client already consumes it: Studio's content store, its derived caches and each tab's buffer state follow the subscription (§6.1, §11.1). Every write and delete Studio makes already names a base once the host has answered (`packages/studio/src/files/based-writes.ts` routes the platform's `writeFile`, `uploadFile` and `deleteFile`, §5); on a platform whose host does not answer, they fall back to the echo window this plan deletes.

`specs/project-state.md` §11.1 is `Partial`: "the other caches (usage counts, component discovery, the Site panel's index, the format registry) are not keyed by the document and hash they were derived from. They read through the platform, keyed by path, and the events above drop each one when the bytes it read change." They are kept current by `packages/studio/src/project-state/derive.ts` while the subscription is live and by the watcher's batches otherwise, which is the second invalidation path this plan removes.

## Outcome

§3.3 → Implemented: no adapter reports a resync reason, `onResync` and the echo window are deleted from Studio, and a reconnect is a subscribe with `sinceRev` on every platform. §11.1 → Implemented: with the subscription the only source of change, every remaining cache is keyed by the `(docId, hash)` of the store entries it was derived from.

## Decisions

- **Decided:** this is its own plan rather than the client store's last slice, so that the edges to all three hosts are written in `requires` and the gate, not prose, keeps the resync path alive until each host has shipped.
- **Decided:** the `onResync` option of `StudioPlatform.subscribeFileEvents` is removed rather than deprecated, because breaking changes are acceptable before 1.0 and an embedder's adapter that still calls it is ignored harmlessly.

## Implementation

Delete the resync branches in the three adapters, `RECENT_MS` and the listing fold in `packages/studio/src/files/fs-events.ts`, and the `onResync` option and `FsResyncReason` from `packages/studio/src/types.ts`; route every remaining caller through the store's subscription. Key the usage counts (`services/references.ts`), the component registry (`files/components.ts`), the Site panel's index (`panels/site-panel.ts`) and the format registry (`format/format-host.ts`) by the documents and hashes they read, from the store, so that a `docChanged` invalidates exactly the entries keyed by the old hash.

**Integration contract.** None: nothing requires this plan.

## Tests

Remove the resync cases from `packages/studio/tests/fs-events.test.ts` and the adapter tests, and add one per adapter asserting a reconnect sends `{ epoch, sinceRev }` and runs no listing pass. For each re-keyed cache, a test that a change to one document drops its entry and keeps the others. Coverage in `packages/studio`.

## Specs & docs

§3.3 and §11.1 → Implemented, and `studio.md` §9.2 drops the resync reasons and the echo window. Fragments: `bun run spec:change project-state.md minor -m "Every adapter subscribes, and the resync reasons are retired."` and `bun run spec:change studio.md major -m "The resync reasons and the echo window are removed in favour of the project state subscription."`. `docs/extending/embedding/platform-adapter.md` drops `onResync`.

## Acceptance

`bun test --isolate` for the touched Studio tests, `bun run plans:check`, `bun run docs:check`, and a manual reconnect on each platform.
