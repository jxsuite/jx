---
status: drafted
disposition: remove
claims:
  - imports.md#4.3
requires: []
workspaces:
  - packages/server
  - packages/protocol
  - specs
size: S
---

# `GET /__studio/cem` is retired from the dev server and the protocol table, and imports.md §4.3 records why

## Context

`specs/imports.md` §4.3, line 150:

> **Status: Partial.** The route in `packages/server/src/studio-api.ts` returns the manifest wrapped as `{ cem }`, answers `{ cem: null }` when the package, its `customElements` field or the manifest file is missing, and takes an optional `dir`. No studio platform calls it: the inspector's CEM metadata arrives through `GET /__studio/components` (§4.1).

The body under it still says the route "Returns the full Custom Elements Manifest JSON for a package". The census stubbed this as `reconcile` and left retiring the route as the question the detail phase answers first. Verified at the audited tree:

- **The handler** (`// Read CEM from a specific package`, `packages/server/src/studio-api.ts` lines 1044–1076). A missing `pkg` gets a 400 `invalidRequest` problem ("Missing pkg"). `dir` defaults to the active project root and then the server root. The package's `package.json` is looked up in `<dir>/node_modules` and then in the server root's `node_modules`. The route answers `{ cem: null }` when the package, the field or the file is missing, `{ cem }` otherwise, and a 500 `internalError` when the manifest does not parse, a case the marker leaves out. It is **not contained**: unlike `/__studio/components` (line 768), it never passes `dir` through `assertAccessible`, and it splits `pkg` on `/` into path segments without checking them, so `?pkg=../..` resolves outside `node_modules`.
- **The protocol entry** (`packages/protocol/src/routes.ts` lines 203–208): optional, summary "Custom-elements manifest of an npm dependency", degradation "Dependency components lose prop/slot metadata." That degradation is false. The metadata travels as the `source: "npm"` entries of `/__studio/components`, built by that route's own inline manifest scan (lines 810–879), so a backend that omits `cem` costs Studio nothing. `optionalRouteNames()` documents that each optional route "backs an optional StudioPlatform member", and desktop.md §3.1 says the same from the other side, but no member of `StudioPlatform` (`packages/studio/src/types.ts`) reads a manifest.
- **No client, ever.** Nothing in `packages/studio/src` or `packages/desktop/src` names the path, and `git log -S"/__studio/cem" -- packages/studio packages/desktop` is empty: no caller has existed since a9d0fbe4 (2026-04-22) added the route. Only the dev server serves it (`handleStudioApi`, mounted by `packages/server/src/server.ts`). The desktop session answers the platform over RPC (`packages/desktop/src/project-session.ts`) and has no counterpart, and neither does the cloud adapter.
- **Tests**: `describe("cem — gaps")` in `packages/server/tests/studio-api-gaps.test.ts` (lines 865–907, six cases, with the `ghost-cem` fixture at lines 118–122 read by nothing else) and `describe("cem endpoint")` in `packages/server/tests/studio-api.test.ts` (lines 1335–1363, three cases).
- **Other text**: server.md §4.1 (line 182) lists "CEM extraction" as its own member of the **Documents / components / formats** family, next to "component discovery". The generated `docs/extending/reference/studio-routes.md` and `implementation-status.md` carry a row each. Both are gitignored build outputs. No hand-written docs page names the route.

**Related**

- imports.md §2 and §4.1: the manifest scan that does carry the metadata. `plan:imports/cem-discovery-on-every-backend` extracts that scan and `plan:_shared/collection-directive-elements` reads it in-process, and neither goes through this route.
- `plan:imports/packages-route-payload`, the sibling §4.2 plan. Its route has the same missing `assertAccessible` on `dir`, and that plan adds it to every `/__studio/packages*` route.

## Outcome

- imports.md §4.3 → Removed. The heading stays, and the marker says that no platform called the route and where dependency metadata comes from instead.
- `GET /__studio/cem` is neither served by `handleStudioApi` nor declared in `STUDIO_ROUTES`. The generated route reference loses its row.
- server.md §4.1's family list no longer names a CEM extraction route.
- imports.md stays Partial, with §1.1–§1.4, §2, §4.2, §5, §5.1 and §6 still open, so nothing graduates.

## Decisions

- **Open:** retire the route, or keep it and rewrite §4.3 to the `{ cem }` envelope? Recommendation: retire it. It has had no caller since it was added. It backs no platform member, so it breaks the rule `optionalRouteNames()` states. Its degradation sentence tells third-party backend implementers they need it for metadata that Studio actually reads from `components`, and no true sentence is available, because its absence costs nothing. Keeping it honestly also takes work: containment for `dir`, a package-name check for `pkg`, and a decision on whether the desktop session must mirror it. The two plans that will read dependency manifests do it in-process. If maintainers keep it, the disposition returns to `reconcile` with a minor fragment. §4.3 would then read: "Answers `{ cem }`: the manifest the package's `customElements` field names, found in the project's `node_modules` and then the server root's. `{ cem: null }` when the package, the field or the file is missing; 400 without `pkg`; 500 for a manifest that does not parse; `dir` as in §4.1." The handler would gain `assertAccessible(scanRoot, root, activeProjectRoot)` and refuse a `pkg` with a `.` or `..` segment, and the protocol entry would need a degradation that is true.
- **Decided:** `STUDIO_PROTOCOL_VERSION` stays 1, and the commit is a `fix`, not a breaking change. The version moves only when a route's shape changes incompatibly. Removing an optional route that no client calls changes nothing a client relies on, and it takes an obligation off backends rather than adding one. The one thing that narrows is the `StudioRouteName` union, and no code in the repository names `cem`. Precedent: dfa5c8ad moved the catalogue route's path without a breaking marker. If a maintainer counts the narrowed union as breaking, the commit gains `!`, `@jxsuite/protocol` goes to 3.0.0, and nothing else in this plan changes.
- **Decided:** imports.md's fragment is `major`, because plans/README.md's release table makes a removal major when the item "was ever documented as working", and §4.3 has described a working route since 0.1.0. At 0.x this mints 0.2.0-draft. server.md's fragment is `patch`, because that section expressly delegates the route list to `STUDIO_ROUTES` and only its family summary changes.

## Implementation

1. **`packages/server/src/studio-api.ts`**: delete the `// Read CEM from a specific package` block (lines 1044–1076). `PackageJson.customElements` stays for the components scan, and the `dirname` import for its dozen other call sites. The `Cem`, `CemModule` and `CemDeclaration` interfaces stay while the components scan (lines 810–879) still uses them; `plan:imports/cem-discovery-on-every-backend` deletes them with that scan. If that plan lands first, this handler's cast reads `as CemManifest` by then, and the `CemManifest` type import it leaves unused goes with the handler. Leave the `/__studio/packages` block and its `// List CEM-bearing npm packages` comment alone: they belong to `plan:imports/packages-route-payload`.
2. **`packages/protocol/src/routes.ts`**: delete the `cem` entry (lines 203–208) from `STUDIO_ROUTES`. `STUDIO_PROTOCOL_VERSION` and the section banners stay. No other file names `STUDIO_ROUTES.cem`, and `bun run typecheck` confirms it.
3. **Tests**, as in Tests.
4. **`specs/imports.md` §4.3, `specs/server.md` §4.1** and the two fragments, as in Specs & docs.
5. **Plan housekeeping in the landing pull request**: delete this file, and rewrite every open plan's citation of it to name imports.md §4.3 instead, or `plans:check` fails with `citation-unknown`: today `plan:imports/packages-route-payload` (its first Open's reasons) and `plan:imports/cem-discovery-on-every-backend` (Context, and its step 3's conditional about this handler, which then drops). `grep -rn "imports/cem-route-payload" plans` finds them. The two plans may land in one pull request, since both edit the package-management block of `studio-api.ts`, the fixtures of `studio-api-gaps.test.ts` and imports.md §4. Landed separately, the second one rebases over adjacent hunks with no semantic conflict.

**Integration contract.** No plan requires this one. Once it lands:

- `handleStudioApi` answers `null` for `/__studio/cem`, and `STUDIO_ROUTES` has no `cem` key.
- The only code in the repository that reads a dependency's `customElements` manifest is the components scan in `studio-api.ts` (or, once `plan:imports/cem-discovery-on-every-backend` lands, the shared scan it extracts). That plan therefore extracts one copy of manifest resolution, not two.
- imports.md §4.3 is Removed. A later need for one package's manifest over the wire is a new route, and it must back a `StudioPlatform` member, carry a true degradation and contain its paths as `/__studio/components` does.

## Tests

- **`packages/server`** (`bun test --isolate --coverage` from `packages/server`):
  - `tests/studio-api-gaps.test.ts`: delete `describe("cem — gaps")` and the `ghost-cem` fixture. Keep `cem-dep`, `no-cem-dep` and `bad-cem`, which are the `sub` project's dependencies and are read by the components and packages cases.
  - `tests/studio-api.test.ts`: delete `describe("cem endpoint")`. The `cem-project` fixture stays for the components and packages cases. In `describe("unmatched endpoint")`, add "the retired cem route is not served (imports.md §4.3)", which calls `handleStudioApi` directly with `GET http://localhost/__studio/cem?pkg=test-elements` against `FIXTURES` and expects `null`, as the neighbouring unknown-path case does.
- **`packages/protocol`** (`bun test --isolate --coverage` from `packages/protocol`), `tests/routes.test.ts`: new "no route serves a single dependency's manifest (imports.md §4.3)". It expects `Object.values(STUDIO_ROUTES).map((r) => r.path)` not to contain `"/__studio/cem"`. The existing partition and degradation cases cover the rest of the table unchanged.
- **Coverage.** No function is removed, because the handler is a branch inside `handleStudioApi`. `studio-api.ts` loses about thirty covered lines, which moves its line ratio by well under a tenth of a point. The per-file thresholds (`lines = 0.96, functions = 0.95` in `packages/server/bunfig.toml`, `0.99/0.99` in `packages/protocol/bunfig.toml`) do not move, nothing ratchets, and there is no new source file. Run `bun scripts/check-coverage-manifest.ts packages/server` and `bun scripts/check-coverage-manifest.ts packages/protocol`. `packages/protocol` is a dependency of studio, server and desktop, so `scripts/ci/affected.ts` widens the matrix to match.

## Specs & docs

**`specs/imports.md` §4.3**, in place. The `### 4.3` heading, route and all, stays verbatim. The Partial marker and the sentence "Returns the full Custom Elements Manifest JSON for a package." are replaced by one blockquote:

> **Status: Removed.** The route answered one dependency's Custom Elements Manifest, wrapped as `{ cem }`, and no Studio platform ever called it: dependency components reach Studio as the `source: "npm"` entries of `GET /__studio/components` (§4.1), read from the manifests §2 describes. No backend serves it, and the protocol's route table does not declare it.

**`specs/server.md` §4.1**, the **Documents / components / formats** bullet: "component discovery, CEM extraction, the project's format/extension registry" becomes "component discovery (the project's components and the Custom Elements Manifest components of its installed dependencies), the project's format/extension registry". The rest of the bullet is unchanged. `plan:collab/spec-coverage` edits the co-editing bullet above it, and whichever pull request lands second resolves that adjacency.

**Fragments:**

- `bun run spec:change imports.md major -m "§4.3's single-package manifest route is removed: no Studio platform called it, and dependency components reach Studio only through the component registry of §4.1."`
- `bun run spec:change server.md patch -m "§4.1's documents family names component discovery as the one reader of dependency Custom Elements Manifests, now that the single-package manifest route is gone."`

**Docs.** No page's `spec:` cites `imports.md#4.3`. `bun run docs:sync` names three pages through their `code:` lists: `docs/extending/embedding/dev-server.md` (`studio-api.ts`), and `docs/extending/embedding/backend-protocol.md` and `docs/extending/embedding.md` (`routes.ts`). None of them mentions the route or CEM extraction, so none changes. The generated `studio-routes.md` and `implementation-status.md` drop their rows on the next `bun run docs:generate`, and nothing commits them.

No spec graduates.

## Acceptance

- `git grep -n "studio/cem" -- packages scripts` prints nothing. `git grep -n "CEM extraction" -- specs/server.md` prints nothing (spec.md §5.6's two uses name the Studio export, not this route, and stay).
- `sed -n '/^### 4.3/,/^### 4.4/p' specs/imports.md` prints the §4.3 heading, the `> **Status: Removed.**` blockquote and the §4.4 heading, with no body sentence between them. `bun run plans:status --spec imports` lists no §4.3 row.
- After `bun run docs:generate`, `grep -c "__studio/cem" docs/extending/reference/studio-routes.md` prints `0`.
- `bun run typecheck`, `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:markdown` pass.
- `bun test --isolate --coverage` passes from `packages/server` and from `packages/protocol` with the two new cases listed and no per-file threshold failure, and both manifest checks pass.
