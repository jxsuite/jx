---
status: drafted
disposition: implement
claims:
  - project-state.md#8.2
  - project-state.md#10.3
  - project-state.md#13.1
requires:
  - project-state/protocol-and-conformance
  - project-state/ref-extraction
  - project-state/dependency-graph
workspaces:
  - packages/protocol
  - packages/studio
size: L
---

# The cloud project Durable Object serves the contract from SQLite and passes the same suite

## Context

`specs/project-state.md` §10.3, §8.2 and §13.1 are `Pending`. The cloud session's `/events` WebSocket carries `fs` batches and git notices and replays nothing (`desktop.md` §10.1); the Cloud adapter reports `"open"`, `"reconnect"` and `"commit"` resyncs (`packages/studio/src/platforms/cloud.ts`). The host lives in the separate platform repository (`src/do/project-session.ts` there), which vendors `walkDocRefs` at 2.2.2 and cannot run a project's parser code inside a Durable Object.

## Outcome

- §10.3 → Implemented: the Durable Object keeps its revision and replay log in its SQLite storage, serves the cloud binding, and passes the published suite.
- §8.2 → Implemented: its snapshot and its `docChanged` events carry `indexed: false` for every document it cannot parse, its invalidations carry `complete: false`, and the client honours both. Its renames refuse a request without client `rewrites` while the graph is partial (§9.1).
- §13.1 → Implemented: the log's schema is plain SQLite, in the dialect rule's subset.

## Decisions

- **Decided:** Durable Object SQLite, not D1, because the log belongs to one object and must survive hibernation with it.
- **Decided:** the platform imports `walkDocRefs` from `@jxsuite/server/refactor/refs` and deletes its vendored copy.
- **Open:** the replay window's size on the cloud (rows kept per project). Recommendation: 4096 events or 24 hours, whichever is fewer.

## Implementation

In the platform repository: an `events` table keyed by `(epoch, rev)`, the subscribe exchange on `/events`, base-hash writes, and the suite under its test runner. In this repository: the Cloud adapter's subscription in `packages/studio/src/platforms/cloud.ts`, and any driver hook the suite needs in `packages/protocol`.

**Integration contract.** The cloud host passes the published suite, including the `indexed` and `rewrites` cases its partial graph exercises.

## Tests

The suite in the platform repository; the Cloud adapter's subscription in `packages/studio/tests/`. Coverage in `packages/studio` and `packages/protocol`.

## Specs & docs

§8.2, §10.3 and §13.1 → Implemented; `desktop.md` §10.1 describes the replaying `/events`. Fragments for both specs (minor).

## Acceptance

The platform repository's suite run, linked from the pull request; `bun run plans:check`.

## Slices

| Slice  | Scope                                            | Claims       | State |
| ------ | ------------------------------------------------ | ------------ | ----- |
| PSK1.1 | Un-vendor the reference walk in the platform     | §8.2         | open  |
| PSK1.2 | SQLite log, epochs across hibernation, subscribe | §10.3, §13.1 | open  |
| PSK1.3 | Partial-graph reporting and the Cloud adapter    | §8.2, §10.3  | open  |
