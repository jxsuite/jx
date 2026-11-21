---
status: drafted
disposition: implement
claims:
  - project-state.md#8
requires:
  - project-state/protocol-and-conformance
workspaces:
  - packages/server
  - packages/protocol
size: M
---

# The host keeps a dependency graph and invalidates dependents by edge kind

## Context

`specs/project-state.md` §8 is `Pending`. The rename refactor and the usage query walk every file on each request (`findReferences` and `applyRename` in `packages/server/src/refactor/`), caching answers until the watcher sees a change, and Studio invalidates its own caches by path (`invalidateUsages` in `packages/studio/src/services/references.ts`).

## Outcome

§8 → Implemented: `packages/server/src/project-state/graph.ts` builds and updates the graph for the six edge kinds of §8.1 and computes `dependentsInvalidated` events, used by the desktop and dev-server hosts.

## Decisions

- **Decided:** the graph is built from `walkDocRefs` and `countTagUses` only, so it cannot disagree with the usage query.
- **Decided:** `graph.ts` imports `walkDocRefs` and `countTagUses` from `@jxsuite/server/refactor/refs` (or `../refactor/refs.ts`), never from the `./refactor` index, whose module graph loads the watcher. The graph module stays I/O-free, so the cloud host can bundle the same graph; `packages/server/tests/refs-export.test.ts` gains a browser bundle of `graph.ts` once it exists.
- **Decided:** format-registry documents are parsed with the project's parsers where the host can run them; a document it cannot parse stays `indexed: false` (§8.2's rule applies to every host, not only the cloud).
- **Decided:** `layout-page` edges are built from the page's resolved layout (its `$layout`, else `defaults.layout`, none for `$layout: false`), and the implicit ones are recomputed on `projectConfigChanged`, because most pages name no layout.
- **Decided:** the graph keeps edges to referenced paths that do not exist yet, so a `fileAdded` there reaches its referrers.
- **Open:** whether `content-collection` edges are computed from the collection's `source` alone or from the collection loader's resolved entry list. Recommendation: the loader, since a `{locale}` source is not a glob.

## Implementation

`graph.ts` exports `createDependencyGraph()` with `update(docId, refs)`, `remove(docId)` and `dependentsOf(docId): Map<DependencyKind, DocId[]>`, transitive and deduplicated. The usage query moves onto it in `plan:project-state/desktop-service`.

**Integration contract.** Hosts call `update` when a document's bytes change and on `projectConfigChanged`, `remove` on `fileRemoved`, and a path relabel on `fileRenamed`; they compute dependents for every `fileChanged`, `fileRemoved` and `fileRenamed` of a document with dependents (media included) and every `fileAdded` at a referenced path, and emit one `dependentsInvalidated` per non-empty kind (§8).

## Tests

`packages/server/tests/project-state-graph.test.ts`, one case per edge kind and the transitive and partial cases; the §10.4 cases for a host that serves §8 (deleting a component, an external media rename, editing the default layout) join the published suite. Coverage in `packages/server`.

## Specs & docs

§8 → Implemented. Fragment: `bun run spec:change project-state.md minor -m "The host's dependency graph ships."`.

## Acceptance

`bun test --isolate packages/server/tests/project-state-graph.test.ts`, `bun run plans:check`.
