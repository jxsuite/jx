---
status: drafted
disposition: reconcile
claims:
  - compiler.md#11
requires: []
size: S
---

# compiler.md §11 lists the helpers `shared.ts` exports, under the parameters they take

## Context

`specs/compiler.md` §11, line 706 (before the census the section's only marker was the trailing `Implemented` one, line 730, which stays):

> **Status: Partial.** Three entries do not match the code: `transformImageNodes` is `(doc, config, projectRoot, cache, metaCache?, mounts?)` and returns `{ imageRefs }` (`packages/compiler/src/site/image-transform.ts`); `processImage` is `(srcPath, cacheImgDir, config)` and writes to the image cache, not an `outDir` (`image-optimizer.ts`); and `buildRoute` is a private helper of `packages/compiler/src/targets/compile-server.ts`, not a shared utility. The others ship as listed, in `packages/compiler/src/shared.ts`.

All three findings re-verified. `transformImageNodes` returns `{ imageRefs: Map<string, ImageManifest> }`; `processImage` returns the image's `ImageManifest` and writes into `<cacheImgDir>/_optimized/`; `buildRoute` (`compile-server.ts`, line 209) is unexported, called only by `compileServer` and `compileSiteServer`, and `specs/compiler.md` is the only file in the repository outside that module that names it.

**Corrections to the census reading.** "The others ship as listed" overstates it:

- `buildInitialScope(state)` omits the optional `parentScope` the code declares (`buildInitialScope(defs = {}, parentScope = null)`), which `createCompileContext` passes.
- `compileStyles(def)` omits `mediaQueries` and `projectStyle` (`compileStyles(doc, mediaQueries = {}, projectStyle = null)`). The entry's own paragraph describes the project block, which is `projectStyle`.
- `isSchemaOnly` is not defined in `shared.ts`: it is `isSchemaOnlyDef` from `@jxsuite/schema/guards`, re-exported under that name (`shared.ts`, line 249). "Shape 2b" names no shape `spec.md` §5.7 defines (it lists Shapes 1 to 5); the term lives only in code comments (`packages/schema/src/guards.ts`, `packages/runtime/src/runtime.ts`).
- The trailing marker names `shared.js`, `image-optimizer.js`, `image-transform.js` and `image-cache.js`; every one is a `.ts` file.
- The stub put the `enumeratedAttrNames` equality test in `shared.test.ts`. It is in `packages/compiler/tests/compile-element.test.ts` ("the inlined enumerated list still equals the runtime's — the drift guard").

The two entry bodies hold. The `attrHelperSource()` paragraph matches the helper and the test above. The `compileStyles` paragraph matches `buildSiteStyleCSS` (`packages/site/src/site-style.ts`), to which `compileStyles` delegates the project block. That function emits `:root` and `body` first and conditional blocks after. It splits a conditional block across `:root`, `body` and its selector keys, and it omits the `color-scheme` triplet when `colorScheme` is authored. The dual-emit selectors come from `schemeSelectors` (`packages/runtime/src/css.ts`). The pre-paint script is gated on `prePaintScheme !== false` in `compile-static.ts` and `compile-client.ts`, and `site-build.ts` passes `false` (line 1474). None of the listed helpers is public API: `packages/compiler/src/compiler.ts` re-exports only `isDynamic` from the package root.

**Noticed, not claimed** (forwarded for `spec.md` §5.7, which the `spec.md` census verified and which carries only an `Implemented` marker; `plan:spec/cem-manifest-export`, `plan:_shared/compiled-prop-bridge` and `plan:_shared/compiled-element-lifecycle` each work around the same split without owning it): §5.7's detection algorithm has no step for a pure type definition. Both tiers skip one, but with different predicates. The runtime skips any object with no `default` that carries at least one schema keyword (`hasSchemaKeywords`, `runtime.ts` line 855). The compiler skips only an object whose every key is one (`isSchemaOnlyDef`). The two keyword sets differ as well (the runtime's has `examples` and lacks `format`, `description`, `title` and `$comment`). So `{ "type": "string", "label": "x" }` has no value when interpreted and is an object value when compiled, and `{ "description": "x" }` is the reverse.

**Related, no edge.** `plan:_shared/image-pipeline-text` rewrites §7.2 to name `transformImageNodes(doc, config, projectRoot, cache, metaCache?, mounts?)` → `{ imageRefs }` and `processImage`. It may land in the same pull request. Six drafted plans append seven `shared.ts` helper entries to §11 and leave the marker to this plan: `plan:compiler/client-external-class-hydration` (`externalClassHelperSource()`), `plan:_shared/compiled-prop-bridge` (`propSupplyHelperSource()`), `plan:_shared/compiled-element-lifecycle` (`observedAttrHelperSource()`), `plan:spec/compiled-external-switch-cases` (`caseLoaderSource()`), `plan:spec/compiled-keyed-lists` (`listHelperSource()`, `keyedListDirectiveSource()`) and `plan:spec/named-formula-recursion` (`formulaGuardSource()`, under its guard Open). `plan:_shared/page-server-entries` stops `collectServerEntries` deduplicating, and `plan:compiler/client-template-text-children` changes `isDynamic`'s body. Neither changes a signature, and both headings stay true. `plan:_shared/no-adapter-server-tier` removes §6.2, one of the two sections that show the route `buildRoute` emits. §6.3's worker example, the other, stays. `plan:spec/computed-function-classification` is the one open plan that changes a listed helper's parameters: `buildInitialScope` gains a third, `roles?`. If it lands first, step 2's heading is `buildInitialScope(defs?, parentScope?, roles?)`; if this plan lands first, that plan edits the heading by the integration contract below (reported to it for its Specs & docs).

## Outcome

- `compiler.md` §11 → Implemented: the leading Partial marker is removed, and the trailing `Implemented` marker is rewritten to name the `.ts` module. Every heading names an export of `shared.ts` with the parameters it declares.
- The spec does not graduate: `compiler.md` keeps other open items.

## Decisions

- **Open:** do the two image entries stay in §11 with corrected signatures, or move out behind a pointer to §7? Recommendation: move them out. §11 gets one sentence saying `transformImageNodes` and `processImage` are specified with the pipeline in §7.2 and §7.5. Neither function is a helper the targets share: each is an image-pipeline entry point, and §7.2 already names both (its heading, and step 1). `plan:_shared/image-pipeline-text` writes `transformImageNodes`' full signature there. A signature written in two places drifts in two places, and this one did: §7.7's step 2 and §11 carried the same stale `outDir`. The pointer is true before and after that plan lands, so no `requires` edge is needed. The alternative replaces the two headings with `transformImageNodes(doc, config, projectRoot, cache, metaCache?, mounts?)`, returning `{ imageRefs }`, and `processImage(srcPath, cacheImgDir, config)`, which encodes one image's variants into the image cache's `_optimized/` and returns its manifest. That puts the first signature in both §7.2 and §11 once the image plan lands.
- **Decided:** `buildRoute` leaves the list with no replacement heading, because it is a module-private function of `compile-server.ts` that nothing else imports, and §6.3's worker example already shows the route it emits.
- **Decided:** §11 opens with a scope-and-convention paragraph, and the two incomplete headings are corrected in the same edit. The scope is `shared.ts` exports, internal to the package. By convention, parameters appear under the code's names, with `?` marking an optional one. Three drafted plans append entries to §11, and the paragraph tells them what an entry is. The census missed `buildInitialScope` and `compileStyles`, but they drop parameters the code takes, which is the drift this marker records.
- **Decided:** "Shape 2b" becomes a description ("every key a JSON Schema keyword"), because `spec.md` defines no such shape. A spec heading should not borrow a term only code comments use.
- **Decided:** no test pins §11 to `shared.ts`. Every call site type-checks the helpers' signatures. A test in `packages/compiler` that read `specs/compiler.md` would need an `EXTRA_EDGES` entry in `scripts/ci/affected.ts`, and every edit to that spec would then re-run the compiler suite.

## Implementation

A paper plan: the steps are the spec edit and the housekeeping that lands with it. They are written for the recommendation. If the Open is answered the other way, step 1's pointer sentence keeps only its §6.3 clause, step 2 keeps the two image headings, rewritten as the Open gives them, and the trailing marker also names `site/image-transform.ts` and `site/image-optimizer.ts`.

1. `specs/compiler.md` §11: delete the leading marker (line 706) and put this paragraph under the heading:

   > Helpers that `packages/compiler/src/shared.ts` exports for the compilation targets and the site build. Each heading gives the parameters under the names the code declares, `?` marking an optional one. They are internal to `@jxsuite/compiler`: of them, the package root re-exports only `isDynamic`. The image pipeline's entry points, `transformImageNodes` and `processImage`, are specified with the pipeline (§7.2, §7.5), and the route each server entry becomes is shown in §6.3.

2. The headings and the trailing marker become the following, each parameter list checked against `shared.ts` as it stands when this lands. `isDynamic(def)`, `attrHelperSource()` and `collectServerEntries(doc)` keep their headings; the `attrHelperSource()` and `compileStyles` paragraphs stay as they are (elided here); the `buildRoute`, `transformImageNodes` and `processImage` headings (lines 724 to 728) are deleted.

   ```markdown
   ### `isDynamic(def)` — Recursive static detection

   ### `isSchemaOnly(value)` — Pure type definition detection (every key a JSON Schema keyword)

   ### `buildInitialScope(defs?, parentScope?)` — Static scope for compile-time pre-rendering

   ### `attrHelperSource()` — the boolean-attribute rule, inlined for a generated module

   ### `compileStyles(doc, mediaQueries?, projectStyle?)` — CSS extraction from component tree

   ### `collectServerEntries(doc)` — Find all `timing: "server"` entries

   > **Status: Implemented.** Shared utilities in `packages/compiler/src/shared.ts`, where `isSchemaOnly` is re-exported from `@jxsuite/schema/guards`.
   ```

3. Housekeeping in the landing pull request: delete this file. Rewrite every `plan:compiler/shared-utilities-signatures` citation that `grep -rn "plan:compiler/shared-utilities-signatures" plans/` still finds, or `plans:check` reports `citation-unknown`. Today they are in `plans/_shared/image-pipeline-text.md` (Related and Integration contract), `plans/compiler/client-external-class-hydration.md` (Related), `plans/_shared/compiled-prop-bridge.md` (Specs & docs), `plans/_shared/compiled-element-lifecycle.md` (Related), `plans/spec/compiled-external-switch-cases.md` (Specs & docs), `plans/spec/compiled-keyed-lists.md` (Integration contract and slice CKL1.2) and `plans/spec/named-formula-recursion.md` (Specs & docs). Each becomes a plain reference to `compiler.md` §11, and each "the §11 marker is not touched" clause goes, since no open marker is left. Nothing `requires` this plan.
4. This file is the only record of the `spec.md` §5.7 finding under Context. Delete it only once that finding has an owner (a marker in `spec.md` §5.7 claimed by a `plans/spec/` plan); otherwise copy the paragraph into the plan that will own it first.

**Integration contract.** Once this lands, `compiler.md` §11 has no open marker, and every entry is an H3 holding the helper's name and parameters in one code span, then a dash and a summary, as in step 2: a `shared.ts` export under the code's parameter names, `?` marking an optional one. A plan adding a helper (the seven helpers named under Context among them) appends an entry in that form, the name and its parameters inside the code span as `attrHelperSource()`'s heading has them, and touches no marker. A plan that changes a listed helper's parameters edits its heading in the same pull request. §11 states no image-pipeline signature: `transformImageNodes`' belongs to §7.2. No spec names `buildRoute`.

## Tests

No code changes, so no workspace suite runs and no coverage threshold moves. The gates that prove it:

- `bun run docs:status`: §11's markers are well-formed.
- `bun run docs:spec-release`: the body edit carries its fragment.
- `bun run plans:check`: `compiler.md#11` is no longer open, this plan is gone, and no `citation-unknown` remains.
- `bun run docs:check` and `bun run docs:links`: no page or anchor breaks. The removed headings are unnumbered, and nothing links to them.
- `bun run docs:markdown`: the edited headings are not escaped.

## Specs & docs

- `specs/compiler.md` §11: the edits in Implementation, steps 1 and 2. The marker change removes the leading `> **Status: Partial.**` (line 706) and rewrites the trailing `> **Status: Implemented.**`. No other section changes.
- Fragment: `bun run spec:change compiler.md minor -m "§11 lists the helpers shared.ts exports under the parameters they take; buildRoute leaves the list, and the image pipeline's entry points are specified with the pipeline in §7."` If the Open goes the other way, the clause after the semicolon becomes "buildRoute leaves the list, and the image entries take their real parameters". The helpers are internal to the package, so authors rely on nothing here, and a reconcile is `minor`.
- Docs: none changes. No page's `spec:` cites `compiler.md#11` (`grep -rn "compiler.md#11" docs/` prints nothing). No code changes, so `bun run docs:sync` names no page. No page names `buildRoute`, `processImage` or `transformImageNodes`, apart from the generated `implementation-status.md`, which regenerates.
- No graduation: `compiler.md` keeps its other open items, and `plans/compiler/` stays.

## Acceptance

- `bun run plans:status --spec compiler` no longer lists §11. `bun run plans:status --who-claims compiler.md#11` names no plan.
- `sed -n '/^## 11\./,/^## 12\./p' specs/compiler.md | grep -c 'Status: Partial'` prints `0`; `grep -n 'buildRoute' specs/compiler.md` prints nothing; and `sed -n '/^## 11\./,/^## 12\./p' specs/compiler.md | grep -n 'Shape 2b\|\.js\b'` prints nothing (§2.1's and the other sections' `.js` module names are outside this plan).
- Every §11 heading names a `shared.ts` export. The following prints nothing: `sed -n '/^## 11\./,/^## 12\./p' specs/compiler.md | grep -o '^### .[A-Za-z]*' | cut -c6- | while read n; do grep -qE "export function $n\b|as $n\b" packages/compiler/src/shared.ts || echo "missing: $n"; done`
- By eye, each heading's parameter list matches the declaration in `shared.ts`: `buildInitialScope(defs = {}, parentScope = null)` and `compileStyles(doc, mediaQueries = {}, projectStyle = null)` both appear there.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run plans:check`, `bun run docs:check`, `bun run docs:links` and `bun run docs:markdown`: green.
