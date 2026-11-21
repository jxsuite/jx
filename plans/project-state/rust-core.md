---
status: drafted
disposition: defer
claims:
  - project-state.md#13.2
requires:
  - project-state/desktop-service
  - project-state/devserver-service
  - project-state/cloud-conformance
size: S
---

# A native project core is decided by measurement, and deferred until one asks for it

## Context

`specs/project-state.md` §13.2 is `Pending`: the host logic is TypeScript only (`packages/protocol/src/project-state.ts` today, `packages/server/src/project-state/` once `plan:project-state/desktop-service` lands), and no measurement of indexing, hashing or graph updates on a large project exists.

## Outcome

§13.2 → an Implemented part (the TypeScript hosts are the implementation) plus a `> **Status: Future.**` remainder for a Rust core, compiled natively for the desktop and to WebAssembly for the Durable Object, with storage behind a trait. The spec can graduate with it.

## Decisions

- **Decided:** defer, because the contract does not change if the core moves, and nothing has been measured.
- **Decided:** the measurement that would reopen it is a benchmark under `bench/` indexing a 10,000-file project and replaying a 1,000-event burst on each host; this plan lands with that benchmark's first numbers recorded in its pull request.

## Implementation

A benchmark under `bench/project-state/`, run once against each TypeScript host, and the §13.2 rewrite.

**Integration contract.** None.

## Tests

None beyond the benchmark's own run.

## Specs & docs

§13.2 rewritten to Implemented plus a Future remainder. Fragment: `bun run spec:change project-state.md patch -m "A native core is deferred until measured."`.

## Acceptance

`bun run plans:check` and `bun run docs:status`.
