---
status: drafted
disposition: implement
claims:
  - site-architecture.md#2.4
requires:
  - site-architecture/project-jxn
workspaces:
  - packages/create
  - packages/import
  - packages/server
  - packages/starters
  - packages/studio
  - scripts
  - specs
  - docs
size: M
---

# Every new project is provisioned with a `project.jxn`, whichever way it is created

## Context

`specs/site-architecture.md` §2.4 is Pending. By this point `plan:site-architecture/project-jxn` has made `project.jxn` work on every host, and nothing yet creates one. Writing one is separated from reading one because it has a different gate: a starter pins published versions, so this cannot merge until a release carrying the readers exists.

The writers: `create/generate.ts:202` (`buildProjectJson`), `:276`-`:294` (the starter re-stamp), `import/emit.ts:253`, `import/run.ts:237`, and the read-backs that follow them (`server/studio-api.ts:697`, `desktop/backend/project-session.ts:960`, `server/import-api.ts:303`), which already go through the module. The inputs: 13 starters and 11 screenshot fixtures. `create/template-versions.json` pins `compiler`, `parser`, `runtime` and `server`.

## Outcome

- site-architecture.md §2.4 → Implemented: `create-jxsuite`, Studio's New Project, the site import and all starters provision `project.jxn`.
- Documents in a new project stay `.json` until `plan:_shared/jx-typechecking`'s last slice.

## Decisions

- **Decided (owner):** projects are provisioned as `project.jxn`.
- **Decided:** the order is enforced, not narrated. A test fails when a starter or the scaffold template has a `project.jxn` while `template-versions.json`'s `compiler` floor is below the first version that reads one. A prose-only ordering is how a starter ends up unable to run its own `jx build`, as `AGENTS.md` "Starter Roots" records for the schema.
- **Decided:** the cloud host lands first, in its own repository. Its scan and `importProject` read `project.json`, so a repository holding only `project.jxn` would look empty. `platforms/cloud.ts:1831` calls a route this repository does not implement, so no test here can see it, and the pull request for this plan names that change as its precondition.
- **Decided:** scaffolds carry `.gitattributes` with `*.jxn linguist-language=KDL` and `.vscode/settings.json` with `files.associations` mapping `*.jxn` to `kdl`, recommending `kdl-org.kdl`. Linguist knows KDL only as `.kdl`, and both files cost nothing. That gives highlighting from the first release and in GitHub reviews.
- **Decided:** a scaffold's `project.jxn` has a comment in it, explaining `extensions`. That shows a new user the format's main advantage, and it is what an acceptance test watches survive.
- **Decided (owner):** a new project's documents stay `.json` until `plan:_shared/jx-typechecking`'s last slice, because that plan's reasoning for waiting (TypeScript in a document should be checked before it is taught) is about code, and a project file has none. The mix looks odd but is correct: the two formats are one data model.
- **Decided (owner):** losing `$schema` completion in VS Code between this flip and JTC.4 is accepted, with highlighting, `jx validate` and Studio's Problems as the backstop, rather than holding this for an extension that needs a marketplace account and sits behind TypeScript 7.1. `plan:_shared/jx-typechecking` records the split that would close the gap sooner.

## Implementation

- `create/generate.ts`: `buildProjectJson` becomes a canonical `.jxn` emit, and the re-stamp goes through reconcile. `create/template`: add `.gitattributes` and `.vscode/settings.json`.
- `import/emit.ts`, `import/run.ts:120`, `:153` (the empty-directory guard admits the seed), `import/cli.ts:249`.
- `packages/starters/sites/*` and `scripts/screenshots/fixtures/*`, converted with `jx convert`. One fixture stays `.json` to hold back-compatibility. `scripts/screenshots/manifest.json:539`.
- `starters/tests/validate-projects.test.ts` globs both, and fails if it finds no `project.jxn`.
- `bun run schema:generate-all` over the converted roots: its output should not change.

**Related, no edge.** `plan:desktop/jxn-file-association` should land first, so the first people handed a `project.jxn` can double-click it. `plan:_shared/jx-typechecking` JTC.5 edits the same `create/generate.ts` path for documents, and whichever lands second merges.

## Tests

- `packages/create`, `packages/import`, `packages/starters`: each provisions `project.jxn`, which validates and builds. The version-floor test. The comment survives the starter re-stamp.
- `packages/server` and `packages/desktop`: New Project and a starter open, and the smoke test's fixture is `project.jxn`.
- Coverage thresholds ratchet. `bun test --isolate` throughout. A Chrome MCP pass over New Project and the screenshots lane's re-capture.

## Specs & docs

- `site-architecture.md` §2.4: delete the marker. `bun run spec:change site-architecture.md minor -m "New projects are provisioned with project.jxn"`. `desktop.md` §4.5's create flow names it.
- Every docs page showing a project file, which is over a hundred mentions across `docs/framework`, `docs/studio` and `docs/extending`. Show `.jxn` first and mention `.json` as equivalent. `docs/start/first-project.md` leads with it. `:::doc-note` where a reader may have an older project. Marketing copy goes through `docs:claims`.
- `AGENTS.md`'s `project.json` mentions and `README.md`.

## Acceptance

- `bun create jxsuite` and Studio's New Project both produce a `project.jxn` with a comment in it, which survives changing a setting in Studio.
- Every starter builds from a fresh scaffold on published versions.
- The floor test fails if `template-versions.json`'s `compiler` is lowered.
- `bun run all-the-things`, `plans:check`, `docs:check` and `schema:verify` are green.
