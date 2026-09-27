---
status: drafted
disposition: implement
claims:
  - extensions.md#3
requires: []
workspaces:
  - packages/compiler
  - packages/studio
  - specs
  - docs
size: S
---

# A state entry's own `$src` or a project-local `imports` entry wins over a same-named manifest class at every timing, lowering included

## Context

`specs/extensions.md` §3, line 63:

> **Status: Partial.** Declaration, project-first resolution (`createNodeFormatIO`, `packages/compiler/src/site/format-host.ts`), manifest-class visibility and the duplicate-name error ship (`buildExtensionRegistry`, `packages/schema/src/extension-registry.ts`). A project-local `imports` entry wins only where the compiler resolves a def to a `$src` (`packages/compiler/src/site/prototype-resolver.ts`): a state def whose `timing` is not `"compiler"` is lowered through `registry.byName($prototype)` before `imports` is consulted, so a project-local class named like a lowering manifest class (`TableQuery`, `Search`) is shadowed by it.

The contract is line 80: "On a name collision, a project-local `imports` entry wins over a manifest class". `spec.md` §12.5 adds the rest of the order: explicit `$src`, then page `imports`, then project `imports`, then (in the build) the manifest class.

Verified at 84735a9f. The census undercounted the defect by one input:

- `resolvePrototypes` (`packages/compiler/src/site/prototype-resolver.ts`, lines 103 to 135) enters its lowering branch for `def.timing && def.timing !== "compiler"`. It calls `projectContext.registry?.byName(def.$prototype)` and, when the entry declares `lower`, replaces the def. It reads neither `imports` nor the def's own `$src`. So `{ "$prototype": "TableQuery", "$src": "./local/tq.class.json", "timing": "client" }` is also lowered to the connector's `/_jx/data` fetch.
- The later branch (line 139) is already right: `imports[def.$prototype] ?? registryClassPath(...)`, entered only when `!def.$src`.
- `doc.imports` holds both levels by then. `injectContext` (`packages/site/src/context.ts`, line 139) merges project `imports` into the page's (the page wins), rebased onto the page directory by `nodeImportRebaser` (`packages/compiler/src/site/context-injection.ts`).
- Same-name mappings are not always shadows. An `imports` entry may name the manifest class's own descriptor, the pre-extensions pattern `examples/pages/advanced/markdown-blog.json` still uses for parser classes. The connector exports each lowering descriptor for exactly this (`"./TableQuery.class.json": "./src/TableQuery.class.json"` in `extensions/connector/package.json`). Such an entry must keep lowering. That is the only case the census left open for `reconcile`, and descriptor identity serves it, so the disposition stays `implement`.
- The lowering classes are those the stub named: `TableQuery`, `TableEntry`, `TableInsert`, `TableUpdate` and `TableDelete` (`extensions/connector/src/`) and `Search` (`extensions/search/src/Search.class.json`). `lower` has one caller, this branch.

The other `$prototype` readers, checked as the stub asked:

- **Interpreter and dev server: consistent.** `buildScope` pass 0 (`packages/runtime/src/runtime.ts`, line 802) maps a bare name through `doc.imports` only and never consults a manifest. `handleResolve` (`packages/server/src/resolve.ts`) receives a `$src` and resolves no name. The studio canvas feeds the runtime `getEffectiveImports` (`packages/studio/src/site-context.ts`).
- **Studio entry editor: consistent.** `externalFields` (`packages/studio/src/panels/signals-panel.ts`) reads `projectConfig.imports[def.$prototype]` and never the registry.
- **Not `$prototype` readers.** `contentCollectionSrc` (`packages/studio/src/page-params.ts`) resolves a `$paths` discriminator's class. `byName(format)` in `packages/server/src/studio-api.ts`, `packages/desktop/src/project-session.ts` and `extensions/parser/src/content-loader.ts` looks up format names, and §3 says `imports` no longer registers formats.
- **Studio add-state picker: inconsistent.** `signalsView` in `signals-panel.ts` lists every manifest state class under "Extensions" (`extensionStateClasses`), even when the same name is also under "Project imports". Picking `ext:<Name>` (`addSignalOfType`) seeds the manifest class's `$studio.stateDefaults`, for example `timing: "client"`, onto an entry that resolves to the project's class.

Tests: `packages/compiler/tests/connector-mounts.test.ts` (describe `prototype-resolver lower`) exercises lowering against the real connector, and `prototype-resolver.test.ts` covers `$src` and `imports` resolution. No test puts a local class and a lowering manifest class under one name.

**Related.** `plan:compiler/client-external-class-hydration` rewrites the same loop (its `locateClass` reads `def.$src ?? imports ?? registry`) and decides what a built page does with the client-timed local class this plan stops lowering. `plan:spec/reconcile-built-in-prototypes` restates `spec.md` §12.5's order. `plan:spec/timing-values-in-built-sites` changes which defs reach the lowering branch.

## Outcome

- extensions.md §3 → Implemented. The marker is removed, so the section is unmarked again like §2, §3.1 and §4. The "Name visibility" bullet states the precedence for `$src` and `imports` at every timing.
- extensions.md §8.3 stays Implemented and gains one sentence: only an entry that resolves to the manifest class is lowered.
- extensions.md stays Partial. Eleven other plans hold its fourteen other open items, so nothing graduates.

## Decisions

- **Decided:** lowering applies only when the entry resolves to the manifest class by descriptor identity. The entry's declared class (`def.$src ?? imports[def.$prototype]`) is either absent, or its resolved path has the same `realpath` as `entry.classPath`. Checking the name alone would stop lowering for an `imports` entry that points at the connector's own `TableQuery.class.json`, which is the manifest class under another spelling.
- **Decided:** an entry's own `$src` shadows too. `spec.md` §12.5's order starts with explicit `$src`, the non-lowering branch already honours it, and one predicate covers both inputs.
- **Decided:** an unlowered entry takes the path any external class at its timing takes today. Client and server timings are left in place (`continue`). The compiler and unset branch is untouched. No new warning is added: what a built page does with a client-timed external class is `compiler.md` §3's item, and shadowing is the documented way to override a manifest name, so reporting it would flag intended configuration on every build. A declared class that does not resolve counts as "not the manifest class" (the manifest's file exists) and follows the same path.
- **Decided:** the scope is `$prototype` resolution only. Format names (`content.<type>.format`, the studio's format routes) stay registry-only, because §3 says `imports` no longer registers formats.
- **Open:** does the studio's add-state picker drop a manifest state class that the document's effective `imports` shadow? Recommendation: yes, filter it out of "Extensions". The row names a class the entry will not resolve to, and seeds that class's `stateDefaults` onto a different class. The cost is one filter expression and one test, but it adds `packages/studio` to this PR's CI matrix. If the answer is no, drop step 2 and the studio test, remove `packages/studio` from `workspaces`, and leave `docs/studio/logic/data.md` unchanged.

## Implementation

1. **`packages/compiler/src/site/prototype-resolver.ts`**
   - Add `declaredClassSrc(def: JxPrototypeDef, imports: Record<string, string>): string | undefined`, returning `def.$src ?? imports[def.$prototype]`. Its doc comment cites `spec.md` §12.5.
   - Extract step 1 of `resolveClassPrototype` (lines 203 to 214) as `classJsonPath(src: string, route, projectRoot: string): string`. A `./` or `../` path resolves against `dirname(route.sourcePath)`, or `projectRoot` when there is none. Anything else goes through `createRequire(resolve(projectRoot, "package.json")).resolve(src)`. `resolveClassPrototype` then calls it, with no behaviour change.
   - Add `lowersToManifestClass(def, imports, entry: FormatEntry, route, projectRoot): boolean`. Let `src = declaredClassSrc(def, imports)`. If `src === undefined`, return `true`. Otherwise, in a `try`, return `realpathSync(classJsonPath(src, route, projectRoot)) === realpathSync(entry.classPath)`, and return `false` from the `catch`. Import `realpathSync` from `node:fs` and the `FormatEntry` type from `@jxsuite/schema/extension-registry`. The doc comment cites extensions.md §3 and §8.3.
   - Lowering branch: the condition becomes `if (entry?.capabilities.lower && lowersToManifestClass(def, imports, entry, route, projectRoot))`. The branch body and its trailing `continue` do not change. Rewrite the comment above the branch to say that `lower` runs only for an entry that resolves to the manifest class, because the entry's `$src` or an `imports` entry wins (extensions.md §3).
   - Non-lowering branch: `const mapped = declaredClassSrc(def, imports) ?? registryClassPath(projectContext, def.$prototype)`, keeping `if (!mapped) continue; def.$src = mapped;`. The two branches then read one lookup and cannot disagree.
2. **`packages/studio/src/panels/signals-panel.ts`** (per the Open decision), in `signalsView`: `const shadowed = getEffectiveImports(S.document.imports);` and `const classes = extensionStateClasses().filter((cls) => !Object.hasOwn(shadowed, cls.name));`. Import `getEffectiveImports` from `../site-context.ts`. `extensionStateClasses` and the `ext:` lookup in `addSignalOfType` do not change. A one-line comment above the filter says that a class an import shadows is not what its name resolves to (specs/extensions.md §3).
3. Spec and docs edits, as listed below.
4. In the landing PR, delete this file. Reword the three `plan:extensions/local-imports-precedence` citations that would dangle, where those files still exist. In `plans/extensions/README.md` ("Dispositioned without a plan", §3 bullet), and in `plans/compiler/client-external-class-hydration.md` and `plans/_shared/formats-from-extensions.md`, cite extensions.md §3 instead. For the client-external-class-hydration file, also note that `locateClass` should absorb `classJsonPath` and that `lowersToManifestClass` should call it.

**Integration contract.** Once this lands, `resolvePrototypes` resolves a state entry's class in one order at every timing: `def.$src`, then `doc.imports[def.$prototype]` (project `imports` already merged in), then the enabled manifest class of that name. The `lower` capability runs only when that order lands on the manifest entry's own descriptor. The module-private helpers `declaredClassSrc`, `classJsonPath` and `lowersToManifestClass` hold that rule. A plan that moves path resolution elsewhere keeps `lowersToManifestClass` calling it; `plan:compiler/client-external-class-hydration`'s `locateClass` is the natural home. extensions.md §3 and §8.3 state the rule, so `plan:spec/reconcile-built-in-prototypes` may write `spec.md` §12.5's order (explicit `$src`, `imports`, manifest classes) as true for the site build at every timing. `plan:spec/timing-values-in-built-sites` may route more defs through the lowering branch without re-opening precedence. In the studio, the "Extensions" add group lists no name that the document's effective `imports` define.

## Tests

**`packages/compiler`** (`bun test --isolate --coverage` from `packages/compiler`). In `tests/connector-mounts.test.ts`, describe `prototype-resolver lower`, which already has `TMP`, `PROJECT` and a real registry with `@jxsuite/connector`:

- Fixture, written by the new cases: `TMP/local/table-query.class.json` (`{ "title": "TableQuery", "$implementation": "./table-query.js" }`) and `TMP/local/table-query.js`, exporting `class TableQuery { constructor(c) { this.table = c.table; } resolve() { return { local: true, table: this.table }; } }`.
- `a project-local imports entry named like a lowering class keeps its own class at every timing`: `imports: { TableQuery: "./local/table-query.class.json" }` with four entries, each `table: "comments"` and timing `"client"`, `"server"`, `"compiler"` or unset. After `resolvePrototypes(doc, {}, TMP, { config: PROJECT, registry })`:
  - the client and server entries `toEqual` deep copies taken before the call (no `url`, still `TableQuery`);
  - the compiler entry is `{ local: true, table: "comments", timing: "compiler" }`;
  - the unset entry is `{ local: true, table: "comments" }`.
- `an entry's own $src naming another class file is not lowered`: `{ $prototype: "TableQuery", $src: "./local/table-query.class.json", table: "comments", timing: "client" }` equals its copy after the call.
- `an imports entry naming the manifest class's own descriptor still lowers`: `imports: { TableQuery: "@jxsuite/connector/TableQuery.class.json" }`. The client entry becomes `$prototype: "Request"`, and its `url` starts with `/_jx/data/comments`. This pins the `realpath` equality branch.
- `a declared class that does not resolve is not lowered`: `$src: "./local/missing.class.json"` at `timing: "client"`. The entry equals its copy, which covers the `catch`.
- The existing lowering cases stay green unchanged, since their entries declare no class (`src === undefined`).

`tests/prototype-resolver.test.ts` needs no new case. Its relative, bare-specifier and no-`sourcePath` resolution tests already cover the extracted `classJsonPath`.

**`packages/studio`** (`bun test --isolate --coverage` from `packages/studio`). In `tests/signals-panel-template.test.ts`, beside `extension state classes are a group…`, add `an extension class a project import shadows is listed only under Project imports`:

- Call `resetStudioState({ projectConfig: { imports: { Session: "./local/session.class.json" } } })` and `setExtensions` with the auth fixture that test uses (`Session`, `AuthActions`).
- `addGroups(panel)["Extensions"]` is `["ext:AuthActions"]` and `addGroups(panel)["Project imports"]` is `["import:Session"]`.
- After redrawing with both names imported, `addGroups(panel)["Extensions"]` is `undefined` (the existing `classes.length > 0` guard).
- Restore with `setExtensions([])` in `finally`.

**Coverage.** No source file is added, so both manifest checks are unaffected. `prototype-resolver.ts` gains two small functions and loses inline code, and each branch has a case. `signals-panel.ts` changes one expression. The per-file thresholds are `lines = 0.982, functions = 0.98` (`packages/compiler/bunfig.toml`) and `lines = 0.958, functions = 0.941` (`packages/studio/bunfig.toml`). Neither worst file is expected to move, so there is no ratchet unless the run shows one.

## Specs & docs

**`specs/extensions.md` §3**, in place:

- Delete the `> **Status: Partial.** …` blockquote (line 63) and the blank line after it.
- The "Name visibility" bullet (line 80) becomes: "Name visibility: the manifest's class keys become `$prototype`-visible names. On a name collision, a project-local `imports` entry wins over a manifest class, and a state entry's own `$src` wins over both (spec.md §12.5). This holds at every `timing`: a same-named manifest class's `lower` capability (§8.3) never rewrites an entry that names another class file, while an `imports` entry or `$src` naming the manifest class's own descriptor is that class. Two extensions exporting the same class name is an error the registry reports (rename via a local wrapper class to disambiguate)."

**`specs/extensions.md` §8.3**, in place: append to the first paragraph "`lower` is dispatched through the extension registry, so only a manifest class lowers, and only for an entry that resolves to it under §3's precedence: an entry whose own `$src` or `imports` entry names a different class file keeps that class and is left to its own pipeline."

**Fragment:** `bun run spec:change extensions.md minor -m '§3 and §8.3: the $src of a state entry or a project-local imports entry wins over a same-named manifest class at every timing, so the lower capability of a manifest class rewrites only an entry that resolves to that class.'` The level is minor because this is an implement. The one behaviour change is that a local class the connector or search used to swallow is now kept. The single quotes keep the shell from expanding `$src`.

**Docs** (no em dashes). `bun run docs:sync` names `docs/extending/extensions/anatomy.md` (`spec:` cites `extensions.md#3`) and `docs/extending/extensions/capabilities.md` (`#8.3`). With step 2, it also names `docs/studio/logic.md`, `docs/studio/logic/data.md` and `docs/studio/logic/data-sources.md` (`code:` lists `signals-panel.ts`).

- `docs/extending/extensions/anatomy.md`, line 77, becomes: "**Name visibility**: the manifest's class keys become `$prototype`-visible names. On a collision, a project-local `imports` entry wins over a manifest class, and so does an entry's own `$src`, at every timing: a same-named class that compiles away with `lower` leaves that entry alone. An `imports` entry pointing at the manifest class's own descriptor is that class. Two extensions exporting the same class name is a registry error. Rename via a local wrapper class to disambiguate." Add `packages/compiler/src/site/prototype-resolver.ts` to its `code:`.
- `docs/extending/extensions/capabilities.md`, section `lower`, after "`lower` may appear on a class with any admission block (or none).": "Only a class an enabled extension's manifest lists is lowered, and only for an entry that resolves to it. An entry whose own `$src` or `imports` entry names a different class file keeps that class even when its `$prototype` matches a lowering class." Add `packages/compiler/src/site/prototype-resolver.ts` to its `code:`.
- `docs/studio/logic/data.md`, "Add an entry", step 2: after the sub-bullet "Any sources your project imports or its extensions provide (for example **ContentCollection**) appear next." add " When one of your imports has the same name as an extension's class, only the import is listed, because that is the class the name resolves to."
- `docs/studio/logic.md` and `docs/studio/logic/data-sources.md`: no change, because neither describes the picker's groups or name resolution.

extensions.md does not graduate, and `plans/extensions/` stays.

## Acceptance

- From `packages/compiler`, `bun test --isolate --coverage` is green with the four new `prototype-resolver lower` cases, and `bun scripts/check-coverage-manifest.ts packages/compiler` passes from the root.
- From `packages/studio`, `bun test --isolate --coverage` is green with the new picker case, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `git grep -n "registry?.byName(def.\$prototype)" packages/compiler/src/site/prototype-resolver.ts` shows the lookup guarded by `lowersToManifestClass`.
- `bun run docs:status` reports no Partial marker under extensions.md §3.
- `bun run plans:status --who-claims extensions.md#3` names no plan.
- `bun run plans:check` reports no `citation-unknown` for this id.
- `bun run docs:spec-release` sees the fragment.
- `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` are green.
