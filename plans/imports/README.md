# imports.md audit

Audited against b900b326 on 2026-09-26.

## Verified

- §1.3 (`$elements`: `{ $ref }` fetched and registered through `defineElement`, a bare string side-effect imported): packages/runtime/src/runtime.ts (`registerElements`), packages/compiler/src/site/site-build.ts, packages/runtime/tests/runtime-gaps-elements.test.ts.
- §3.1–§3.2 (runtime `$ref` registration, depth-first and skipping defined tags; bare-string `import()` that warns and does not block, rewritten to `/node_modules/` for the dev server): packages/runtime/src/runtime.ts (`registerElements`), packages/runtime/tests/runtime-gaps-elements.test.ts.
- §4.1 (`GET /__studio/components` with `dir`, jx and npm entry shapes): packages/server/src/studio-api.ts, packages/schema/src/component-meta.ts (`componentMetaFrom`), packages/server/tests/studio-api-gaps.test.ts. The route holds; that the other backends' `discoverComponents` produce no npm entries is §2's item.
- §4.4–§4.5 (`POST /__studio/packages/add` and `/remove` running `bun add` and `bun remove`, with optional `dev` and `dir`): packages/server/src/studio-api.ts, packages/server/tests/studio-api-gaps.test.ts.
- §7's two class cells (`**Adopted**` ECMA-262, `**Borrowed**` WHATWG HTML) are conformance classes and hold: packages/runtime/src/runtime.ts (dynamic `import()`), packages/compiler/src/site/site-build.ts (the project `imports` map is never serialised; the only import map emitted is the client runtime's, from packages/compiler/src/site/client-runtime.ts). The WHATWG note's "fixed two-entry object" is stale: `CLIENT_RUNTIME_MODULES` names two modules and emits up to four keys (each exact specifier plus its `lit-html/` or `@vue/reactivity/` prefix key). It is note prose rather than an open item, so no plan owns it; it is left for whichever change next edits §7's note or compiler.md §12.
- Informative: §1 (parent of §1.1–§1.4), §3 (parent of §3.1–§3.2), §4 (parent of §4.1–§4.5), §7 (Standards Alignment).

## Dispositioned without a plan

Nothing: no stale cell, roadmap or Subset gap. The whole-spec header stays `Partial` and carries no preamble marker, so it is not an item of its own.

## Spec-wide decisions

- The studio canvas's two gaps in §1.1 and §1.4 have one root cause (project-level `imports` and `$elements` are applied as though written relative to the open document) and one decision (where the rebase happens), and rebasing `$elements` is the precondition for §1.4's resolved-path dedup, so one plan owns both sections.
- The directive-name restriction in §6 is split with parser.md §7, and both censuses record the same split: the parser.md §7 plan owns the check, its scope, and whether directive parsing stays gated on a declared `$elements`; the §6 plan owns the effective set it consumes (the site-level union and the resolution to tag names), registration where entries render, and the example. Neither builds the other's half. §6 cannot flip until both land, so the detail phase either draws the `requires` edge or merges the two under `plans/_shared/`.
- §2 is judged on every Studio backend, not on the dev server alone: the desktop app is the end-user path, so a feature only the dev server serves is open. §5's description of the cherry-pick checkboxes is qualified to the dev server for the same reason.
