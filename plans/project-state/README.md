# project-state.md audit

Audited against 4b7b82b7 on 2026-11-21.

## Verified

- The spec is new in this change set, and its open items were written as open from the start: every section that describes behaviour no host has carries a leading `Pending` or `Partial` marker naming what exists (`bun run docs:status`, `bun run plans:check`).
- §2, §3, §4, §5, §6 and §7 are `Partial` rather than `Pending` because their types and pure helpers ship in `packages/protocol/src/project-state.ts`, covered by `packages/protocol/tests/project-state.test.ts` (`contentHash`, `createEchoLedger`, `createMemoryEventLog`, `answerSubscribe`, `checkWritePrecondition`, `bufferStatus`, `READINESS_ORDER`). Nothing imports the module outside the protocol package's own index.
- The current behaviour the markers describe was read against the tree: the 1.5 second echo window is `RECENT_MS` in `packages/studio/src/files/fs-events.ts`; the desktop session forwards watcher batches and pushes `onFileResync` (`packages/desktop/src/backend/project-session.ts`); the dev server's `/__reload` replays nothing (`packages/server/src/sse.ts`, `server.md` §3.1); the platform repository carries a vendored copy of `walkDocRefs` pinned at 2.2.2 (`src/lib/refactor/refs.ts` there). §12 has since closed: `@jxsuite/server/refactor/refs` exports the walk from a module graph with no I/O import, pinned by `packages/server/tests/refs-export.test.ts`.
- Informative: §1 (overview, scope, terms) and §10 and §11 as parent headings carry no marker; their subsections do.
- Informative: §14 (Standards Alignment). The Subresource Integrity row is `Borrowed` with the protocol module and its test as evidence. The HTML, RFC 6455 and RFC 9110 rows bind §3.2 and §5 and are `Subset`, with the frame codecs and their tests as evidence; each host's use of its binding is its own §10 item. The RFC 6902 row is a rejection.

## Dispositioned without a plan

- No roadmap, status ledger or stale status cell.

## Spec-wide decisions

- **A contract section closes when the contract is executable, not when every host serves it.** §2, §3, §4, §5 and §7 closed when the conformance suite that pins them landed in `packages/protocol` (§10.4), except §2.2's classification of an extension-registered format, which needed a host that loads extensions and closed with the desktop host (§10.1); a host's own obligation is its §10 subsection, which its host plan closes. This keeps one owner per section while three hosts each implement it.
- **One TypeScript host implementation, two runtimes.** The desktop and dev-server hosts are the same module, built in `packages/server` (which already runs on Node and Bun, `server.md` §1) for the desktop session (§10.1) and wired into the dev server (§10.2). The cloud host is separate code in the platform repository and conforms through the published suite.
- **The resync reasons stay until every host subscribes.** `studio.md` §9.2's reasons keep working for any adapter whose host does not answer a subscription; Studio's content store subscribes beside them (§11.1), and `plan:project-state/resync-retirement`, which requires the cloud host's plan, removes the code path (§3.3).
- **Persistence and a native core are measured, not assumed.** The cloud persists its log because hibernation forces it (§13.1, `plan:project-state/cloud-conformance`). Desktop persistence and the Rust core (§13.2, `plan:project-state/rust-core`) are deferred: that plan lands as a `Future` remainder unless measurements on large projects show the TypeScript hosts too slow.
- **The cloud work lives in another repository.** `plan:project-state/cloud-conformance` claims this spec's cloud items and lists only the workspaces it changes here; its pull requests in the platform repository are listed in its `prs`.
