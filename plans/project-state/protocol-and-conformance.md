---
status: drafted
disposition: implement
claims:
  - project-state.md#2
  - project-state.md#3
  - project-state.md#3.2
  - project-state.md#4
  - project-state.md#5
  - project-state.md#7
  - project-state.md#10.4
requires: []
gaps:
  - project-state-sse-replay
  - project-state-websocket
  - project-state-if-match
workspaces:
  - packages/protocol
size: L
---

# The project state contract is executable: frame codecs for every binding and one conformance suite any host can run

## Context

`specs/project-state.md` §2, §3, §4, §5 and §7 are `Partial`: the types and pure helpers ship in `packages/protocol/src/project-state.ts` (`contentHash`, `createEchoLedger`, `createMemoryEventLog`, `answerSubscribe`, `checkWritePrecondition`, `READINESS_ORDER`), and nothing exercises a host. §3.2 (transport bindings) and §10.4 (the conformance suite) are `Pending`: no frame shape is encoded or decoded anywhere, and there is no suite.

## Outcome

- §2, §3, §4, §5, §7 → Implemented: every rule in them is asserted by the suite against a reference in-memory host.
- §3.2 → Implemented once the codecs ship; each host's use of its binding is that host's §10 item.
- §10.4 → Implemented: `@jxsuite/protocol/project-state-conformance` exports the suite and a driver interface, and the reference host passes every case §10.4 requires of all hosts. The cases §10.4 conditions on a host serving §8 or §9 are added by `plan:project-state/dependency-graph` and `plan:project-state/rename-cascade`, through driver hooks this plan declares as optional (`graph?`, `rename?`), so the suite skips them for a host that does not serve those sections yet.

## Decisions

- **Decided:** the suite is published from `packages/protocol` as a subpath that imports `bun:test`-compatible `describe`/`test`/`expect` from a parameter rather than a module, so the platform repository can run it under Vitest and Workers without Bun, because the cloud host is the one most likely to drift.
- **Decided:** the reference host is an in-memory implementation over a `Map` of files, built only to prove the suite; it is not a production host.
- **Open:** whether the dev-server binding's `Last-Event-ID` carries `<epoch>:<rev>` (recommended, one header) or the epoch moves to a query parameter on reconnect, which an `EventSource` cannot change after construction.
- **Open:** whether batched frames are allowed on the desktop RPC socket from the start or only after measurement. Recommendation: allow them, since the client must already handle a multi-event `events` answer.

## Implementation

1. `packages/protocol/src/project-state-frames.ts`: encode and decode the three bindings of §3.2 (desktop RPC frames, SSE `id:`/`event:` frames and `Last-Event-ID` parsing, cloud socket messages), with a gap detector (`firstRev !== lastRev + 1`).
2. `packages/protocol/src/project-state-conformance.ts`: `ProjectStateDriver` (create from fixture files, write and delete through the contract, write behind the host's back, atomic-rename save inside and outside the pairing bound, restart, subscribe below and at `indexed`, run an install, read the git summary, and the optional `graph?` and `rename?` hooks) and `runProjectStateConformance(driver, { describe, test, expect })`, covering every case §10.4 requires of all hosts.
3. `packages/protocol/tests/reference-host.ts` and `tests/project-state-conformance.test.ts`: the in-memory reference host passing the suite.
4. Exports in `package.json` for both subpaths.

**Integration contract.** Host plans implement `ProjectStateDriver` for their host and call `runProjectStateConformance`; a host passes when the suite is green. Frame codecs are the only code a host or adapter uses to put the exchange on a wire.

## Tests

`bun test --isolate --coverage` in `packages/protocol`; the threshold stays at 0.99 lines and functions, and both new modules must appear in `bun scripts/check-coverage-manifest.ts packages/protocol`.

## Specs & docs

Flip §2, §3, §4, §5, §7 and §10.4 to Implemented, and §3.2 to Implemented naming the codec module. Move the three `Pending` standards rows to `Adopted` or `Subset` with the codec tests as evidence. Fragment: `bun run spec:change project-state.md minor -m "The contract's frame codecs and conformance suite ship in the protocol package."`. No user docs page: no host serves the contract yet.

## Acceptance

`bun test --isolate packages/protocol`, `bun run plans:check`, `bun run docs:standards`.

## Slices

| Slice  | Scope                                      | Claims                | State |
| ------ | ------------------------------------------ | --------------------- | ----- |
| PSC1.1 | Frame codecs for the three bindings        | §3.2                  | open  |
| PSC1.2 | Driver interface, suite and reference host | §2, §3, §4, §5, §10.4 | open  |
| PSC1.3 | Readiness and git cases in the suite       | §7                    | open  |
