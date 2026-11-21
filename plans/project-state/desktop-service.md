---
status: active
disposition: implement
claims:
  - project-state.md#11.3
requires: []
workspaces:
  - packages/server
  - packages/collab
size: L
prs:
  - jxsuite/jx#726
---

# Collaboration rooms are keyed by document, follow renames and save through the base-hash write

## Context

`specs/project-state.md` §11.3 is `Partial`. The overlay half is built: the desktop session keys the live preview overlay by `DocId` and the setting client (`createOverlayRegistry` in `packages/server/src/project-state/overlays.ts`, run by `packages/desktop/src/backend/project-state.ts`), it follows renames and removals, and it outlives a client's subscriptions by `overlayGraceMs`. The room half is not: collaboration rooms are created per path on demand (`collab.md` §2, `createCollabHost` in `packages/collab/src/ws-room.ts`), and the dev server's registry (`packages/server/src/collab.ts`) persists a room with an unconditional `writeFile`. The desktop backend has no collaboration endpoint at all, so the only rooms that exist are the dev server's, and the dev server runs no project state host until `plan:project-state/devserver-service` lands.

§10.1 and §2.2 landed in `plan:project-state/desktop-service#PSD1.3`: the session runs the host, serves `projectSubscribe`, `projectWrite` and `projectDelete` with a `projectEnded` push (§3.2), passes the collection loader's lists, answers the usage query from the graph, and the conformance fixture's extension registers a format.

## Outcome

- §11.3 → Implemented: a room is keyed by the `DocId` of its document, follows it across a rename and closes when it is removed, holds the hash it hydrated from or last saved, and saves through the host's `write` with that base and its own `writeId`; a refusal reaches the room's participants (§6.1).

## Decisions

- **Decided:** the host lives in `packages/server` so the dev server runs the same module under Bun (`plan:project-state/devserver-service`).
- **Decided:** the overlay registry is a pure module beside the host (`project-state/overlays.ts`), so the dev server reuses it unchanged; the desktop session feeds it the host's file events through a subscription of its own.
- **Decided:** an overlay set by a client that never subscribed keeps the behaviour it had before overlays had owners (one shared owner per project), so a Studio that does not subscribe yet is not regressed. A socket that subscribes adopts the shared layers it set last, and what it sets with no `clientId` afterwards is its own and dropped when it closes.
- **Decided:** a removal drops an overlay by path as well as by `DocId`, rather than re-keying overlays on a new epoch, so a fallback `path:` key and an id from before a restart are both covered with no epoch bookkeeping.
- **Decided:** the session keeps `onFileEvents` and `onFileResync` alive beside the subscription; `plan:project-state/resync-retirement` removes them once every host serves it (§3.3).
- **Decided:** the rooms half waits for a host on the dev server, because that is where rooms exist. A room addressed by path on the wire (`collab.md` §2) but keyed by `DocId` on the host needs the registry to resolve each subscribed path through `docIdAt` and to keep serving a renamed room at its old path until its peers resubscribe, which touches the collab wire contract this spec only hosts.

## Implementation

`packages/server/src/collab.ts` takes the host (`createProjectStateHost`) and keys rooms by `host.docIdAt(path)`, persisting through `host.write({ baseHash, writeId })`; `packages/collab/src/ws-room.ts` gains a re-key for a renamed document. The dev server wires both once it runs the host.

**Integration contract.** `createProjectStateHost(options)` answers `{ subscribe, write, delete, createDirectory, rename, snapshot, docIdAt, references, install, release, restart, idle, close }`; `docIdAt(path)` names the document at a path and `references()` the graph's documents once `indexed`, `null` while the watcher is degraded. `createOverlayRegistry({ publish, unpublish, graceMs })` keys an overlay by document and owner, follows `apply(events)`, and moves layers between owners with `adopt(from, to, docIds)`. `plan:project-state/devserver-service` wraps the host in the SSE binding and runs the overlay registry beside it; `plan:project-state/rename-cascade` implements `rename`.

## Tests

`packages/server/tests/collab*.test.ts` for a room that survives a rename, closes on a removal and is refused a stale save. Coverage in `packages/server` and `packages/collab`.

## Specs & docs

§11.3 → Implemented. A fragment for `project-state.md` (minor), and `collab.md` if the wire changes.

## Acceptance

`bun run plans:check`; `bun run docs:check`; the collab suites.

## Slices

| Slice  | Scope                                                     | Claims | State |
| ------ | --------------------------------------------------------- | ------ | ----- |
| PSD1.1 | Host core: index, ids, hashes, ledger, log, preconditions | §10.1  | done  |
| PSD1.2 | Readiness machine and git monitor                         | §10.1  | done  |
| PSD1.3 | Desktop wiring and the `projectSubscribe` binding         | §10.1  | done  |
| PSD1.4 | The live preview overlay keyed by document and client     | §11.3  | done  |
| PSD1.5 | Collaboration rooms keyed by document, saving with a base | §11.3  | open  |
