---
status: drafted
disposition: implement
claims:
  - project-state.md#11.3
requires: []
workspaces:
  - packages/collab
  - packages/studio
size: L
---

# The cloud project Durable Object serves the contract from SQLite and passes the same suite

## Context

The Durable Object host has landed: `specs/project-state.md` §8.2, §10.3 and §13.1 are `Implemented`, and the platform repository's session object serves the cloud binding from its SQLite storage and passes the published conformance suite with a partial graph. One item is left, and the review of that work found it. §11.3 is `Partial`: "Not yet built: the cloud's rooms. The cloud session serves co-editing rooms too (`collab.md` §1), and while it serves this contract (§10.3) a room's flush still writes the room's text unconditionally and records it as an external change, so a room can overwrite a based write that landed after it loaded, and a co-edited tab there never reaches the conflict question of §6.1."

In the platform repository, `flushCollabInternal` in `src/do/project-session.ts` drains every dirty room (`src/lib/collab/rooms.ts`, `drainDirty`), writes each room's source over the row with no comparison, and reports the paths through `recordExternal`. The rooms do not record the hash of the bytes they hydrated from, and the platform's room registry speaks the published `@jxsuite/collab`, whose wire has no `doc-conflict` control message before the release that carries the dev server's rooms (`collab.md` §2).

## Outcome

§11.3 → Implemented: a cloud room loads the hash of the bytes it seeds from, saves through the host's `write` with that base and a `writeId` of its own, and a refusal reaches every participant as `doc-conflict`, leaving the room dirty, exactly as the dev server's rooms do; a room follows the host's events by path, so a `fileRenamed` moves it and a `fileRemoved` closes it.

## Decisions

- **Decided:** Durable Object SQLite, not D1, because the log belongs to one object and must survive hibernation with it. (Landed.)
- **Decided:** the platform imports `walkDocRefs` from `@jxsuite/protocol/refs` and deleted its vendored copy, so neither Studio nor the Worker needs `@jxsuite/server`. (Landed.)
- **Decided:** the replay window is the most recent 4096 events or those of the last 24 hours, whichever is fewer, in one `events` table keyed by `(epoch, rev)`; the reasons are recorded in §10.3. (Landed.)
- **Decided:** a room's save is a based write through `ProjectStateHost.write`, not a second precondition check beside it, so the room, Studio and the older routes are told apart by origin alone (§2.4) and the conflict event is the one §4.7 defines.
- **Open:** whether the platform keeps its own room registry with a base hash added, or adopts `createCollabHost` from `@jxsuite/collab` (`packages/collab/src/ws-room.ts`) with a `keyOf` over the host's document ids, as the dev server does. The second removes a fork; it needs the release that publishes the dev server's room changes.

## Implementation

In the platform repository: record the hydrated hash on each room in `src/lib/collab/rooms.ts`; in `flushCollabInternal`, save each dirty room through `this.projectState.write` with that base and a `writeId` of the room's own, read the row in first as `projectWrite` does, and on a refusal keep the room dirty and send `doc-conflict` to its participants. A `flush` naming the disk hash (Keep Mine) saves against it, and a revert reseeds from the disk. Follow the host's `fileRenamed` and `fileRemoved` events to move and close rooms.

**Integration contract.** None: the plans that require this one need only the host, which has landed.

## Tests

In the platform repository: a room whose file another writer changed after it loaded is refused, stays dirty and tells its participants; Keep Mine then saves; a renamed file's room follows it. In this repository: none beyond `packages/studio/tests/collab-session.test.ts`, which already covers the client half on the dev server.

## Specs & docs

§11.3 → Implemented, naming the cloud's rooms beside the dev server's; `collab.md` §2 names the cloud as a host that sends `doc-conflict`. A `project-state.md` fragment (minor).

## Acceptance

The platform repository's suite run, linked from the pull request; `bun run plans:check`.

## Slices

| Slice  | Scope                                            | Claims | State                                                                           |
| ------ | ------------------------------------------------ | ------ | ------------------------------------------------------------------------------- |
| PSK1.1 | Un-vendor the reference walk in the platform     | §8.2   | landed                                                                          |
| PSK1.2 | SQLite log, epochs across hibernation, subscribe | §10.3  | landed                                                                          |
| PSK1.3 | Partial-graph reporting and the Cloud adapter    | §8.2   | landed                                                                          |
| PSK1.4 | Cloud rooms save with a base                     | §11.3  | open (the room flush writes unconditionally and reports the change as external) |
