---
status: drafted
disposition: implement
claims:
  - project-state.md#10.1
  - project-state.md#11.3
requires:
  - project-state/protocol-and-conformance
  - project-state/dependency-graph
workspaces:
  - packages/server
  - packages/desktop
size: L
---

# The desktop backend owns the project: index, hashes, replay log, graph, readiness and git, served over the window's socket

## Context

`specs/project-state.md` §10.1 is `Pending`: the window's `ProjectSession` (`packages/desktop/src/backend/project-session.ts`) forwards `createFsWatcher` batches as `onFileEvents`, pushes `onFileResync { reason: "open" }` after each watcher scan, and keeps no index, hash, log, graph, readiness state or git monitor. Source Control polls git from Studio (`studio.md` §5.5). §11.3 is `Pending`: collaboration rooms are per path and the live preview overlay is set and cleared by each client (`setPreviewOverlay` in the same file).

## Outcome

- §10.1 → Implemented: `packages/server/src/project-state/` holds the host (`createProjectStateHost`), and the desktop session runs it and serves the `projectSubscribe` binding; the conformance suite passes against it on Node.
- §11.3 → Implemented: rooms and overlays are keyed by `DocId` and follow renames; a room holds its shared buffer state and saves through the base-hash write (`packages/server/src/collab.ts`); an overlay is keyed by the subscriber's `clientId` and dropped after `overlayGraceMs` with no subscription for it.

## Decisions

- **Decided:** the host lives in `packages/server` so the dev server runs the same module under Bun (`plan:project-state/devserver-service`).
- **Decided:** a write or delete appends its event and updates the index in the same step as the disk change, before replying, writing through a temporary file and a re-hash of the target (§5); the watcher's echo is then dropped by the equal-hash rule, and the ledger only catches stale observations (§2.4).
- **Decided:** a watcher event is hashed after chokidar's `awaitWriteFinish` settles; the host skips the read when size and mtime equal its last record, per §2.4. Removals are held for `atomicSaveMs` (chokidar's `atomic`) to pair atomic-rename saves.
- **Decided:** readiness steps back only on a changed install fingerprint (lockfile hash plus the manifest's dependency fields) or a changed extension set (§7), and an install's own writes carry its operation's `writeId`.
- **Decided:** the git monitor is a chokidar watch on `.git/HEAD`, `.git/index` and `.git/refs` with a 150 ms debounce, then `git status --porcelain=v2 -z`, reusing `git-scope.ts` for project-relative paths.
- **Decided:** the session keeps `onFileEvents` and `onFileResync` alive beside the subscription; `plan:project-state/resync-retirement` removes them once every host serves it (§3.3).

## Implementation

`packages/server/src/project-state/host.ts` (index, `DocId` minting, hashing, `createEchoLedger`, `createMemoryEventLog`, readiness, write precondition), `git-monitor.ts`, and `packages/desktop/src/backend/project-session.ts` wiring plus `projectSubscribe` in `rpc-schema.ts` and `handlers.ts`. The usage query (`findReferences`) answers from the graph.

**Integration contract.** `createProjectStateHost({ root, fs, watcher, git })` returns `{ subscribe, write, rename, snapshot, close }`; `plan:project-state/devserver-service` wraps it in the SSE binding and `plan:project-state/rename-cascade` implements `rename`.

## Tests

The conformance suite through a Node driver (`packages/server/tests/project-state-host.test.ts`), the git monitor against a real repository, and `packages/desktop/tests/hub-handlers.test.ts` for the new request. Coverage in `packages/server` and `packages/desktop`.

## Specs & docs

§10.1 and §11.3 → Implemented; `desktop.md` §7.3 and §10.1 name the host. Fragments for `project-state.md` (minor) and `desktop.md` (minor). `docs/extending/embedding/platform-adapter.md` gains the subscription once a client uses it (`plan:project-state/client-store`).

## Acceptance

The suite passes against the desktop host; `bun run plans:check`; `bun run docs:check`.

## Slices

| Slice  | Scope                                                     | Claims | State |
| ------ | --------------------------------------------------------- | ------ | ----- |
| PSD1.1 | Host core: index, ids, hashes, ledger, log, preconditions | §10.1  | open  |
| PSD1.2 | Readiness machine and git monitor                         | §10.1  | open  |
| PSD1.3 | Desktop wiring and the `projectSubscribe` binding         | §10.1  | open  |
| PSD1.4 | Rooms and overlays keyed by document                      | §11.3  | open  |
