---
status: drafted
disposition: implement
claims:
  - project-state.md#6
  - project-state.md#11.1
requires:
  - project-state/protocol-and-conformance
  - project-state/desktop-service
workspaces:
  - packages/studio
  - packages/desktop
size: L
---

# Studio keeps one content store keyed by document and hash, tracks buffers against a base, and subscribes beside the resync path

## Context

`specs/project-state.md` §11.1 is `Pending`: Studio keeps separate caches (`files/asset-versions.ts`, `services/references.ts`, component discovery, the format registry, each tab's document), each invalidated by its own reading of `FsEvent`s in `packages/studio/src/files/fs-events.ts`, which also suppresses echoes by a 1.5 second window (`RECENT_MS`). §6 is `Partial`: `bufferStatus` ships in the protocol package, but a tab holds one `dirty` flag and no base hash. The component cards' and Project Styles' samples (`src/style/stylebook-specimens.ts`, `studio.md` §5.7 and §7.2) are cached once per component registry, so a definition saved without a registry replacement keeps a stale sample.

## Outcome

- §11.1 → Implemented: `packages/studio/src/project-state/store.ts` holds contents by `(docId, hash)` with the path as a relabelable attribute, and each cache is a derivation keyed by document and hash, invalidated only by events. Sample and stylebook caches key on `(tag, definition hash)`.
- §6 → Implemented: a tab carries a `BufferState`, saves and deletes send their base, and a `conflicted` tab asks the author before anything is written. A co-edited tab reads the room's buffer state instead of its own.
- An adapter whose host answers a subscription uses it beside the resync path; retiring the resync reasons (§3.3) waits for every host and is `plan:project-state/resync-retirement`.

## Decisions

- **Decided:** the store is a module-level singleton reset on project switch, like the version map today, so no surface needs a new parameter.
- **Decided:** the conflict prompt uses `showConfirmDialog` with three choices (keep mine, take the disk's, compare in Change Review, `studio.md` §21).
- **Open:** whether the version map (`studio.md` §3.4) becomes a derivation of the store in this plan or stays separate with hash-keyed invalidation. Recommendation: a derivation, since a hash already vouches for bytes.

## Implementation

`store.ts`, `subscription.ts` (applies snapshots and events, detects gaps, resubscribes), adapter members `subscribeProjectState` on `StudioPlatform` (`packages/studio/src/types.ts`) for the desktop and dev-server adapters, and the tab model's `BufferState`.

**Integration contract.** `plan:project-state/preview-realm` reads documents from the store; `plan:project-state/rename-cascade` reads each tab's `BufferState` to fill `dirtyReferrers`.

## Tests

`packages/studio/tests/project-state-store.test.ts`, the subscription against a fake host built on `answerSubscribe`, and the conflict dialog through the harness. Coverage in `packages/studio`.

## Specs & docs

§6 and §11.1 → Implemented; `studio.md` §3.4 and §9.2 describe the subscription beside the resync reasons. Fragments for `project-state.md` and `studio.md` (minor). `docs/extending/embedding/platform-adapter.md` documents `subscribeProjectState` and when to keep `onResync`.

## Acceptance

`bun test --isolate` for the new files, `bun run docs:check`, a manual save conflict on the desktop.

## Slices

| Slice  | Scope                                             | Claims | State |
| ------ | ------------------------------------------------- | ------ | ----- |
| PSL1.1 | The content store and the subscription            | §11.1  | open  |
| PSL1.2 | Buffers against a base hash and the conflict flow | §6     | open  |
| PSL1.3 | Caches as derivations of the store                | §11.1  | open  |
