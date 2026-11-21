---
status: drafted
disposition: implement
claims:
  - project-state.md#12
requires: []
workspaces:
  - packages/server
size: S
---

# `walkDocRefs` is importable with no filesystem, so every host builds its graph from the same walk

## Context

`specs/project-state.md` §12 is `Pending`. `walkDocRefs` (`packages/server/src/refactor/refs.ts`) is pure, but the only export reaching it is `./refactor` → `src/refactor/index.ts`, which imports `chokidar` and `node:fs`. The platform repository therefore vendors `refs.ts` and `paths.ts` at `@jxsuite/server` 2.2.2 (`src/lib/refactor/refs.ts` there), and its header explains that Node's exports map blocks the deeper path.

## Outcome

§12 → Implemented: `@jxsuite/server/refactor/refs` exports `walkDocRefs`, `countTagUses` and `rewriteDocRefs` from a module graph with no I/O import, pinned by a test.

## Decisions

- **Decided:** a subpath export of the existing file rather than a move to another package, because `paths.ts` and `refs.ts` are the refactor's own code and a move would change every import for no benefit.
- **Open:** whether to move the pure pair to `@jxsuite/schema` instead, which the platform already depends on. Recommendation: the subpath, since a new dependency on `@jxsuite/server` from the platform is type-and-module only.

## Implementation

Add `"./refactor/refs": "./src/refactor/refs.ts"` to `packages/server/package.json`. Add a test that bundles the entry for the `browser` platform and fails on any `node:` or `chokidar` import. The platform's un-vendoring is its own pull request, listed under `plan:project-state/cloud-conformance`.

**Integration contract.** `plan:project-state/dependency-graph` imports the walk only from this subpath.

## Tests

`packages/server/tests/refs-export.test.ts`; `bun test --isolate --coverage` in `packages/server`.

## Specs & docs

§12 → Implemented. Fragment: `bun run spec:change project-state.md minor -m "Reference extraction is a pure subpath export."`. No docs page.

## Acceptance

`bun test --isolate packages/server/tests/refs-export.test.ts`, `bun run plans:check`.
