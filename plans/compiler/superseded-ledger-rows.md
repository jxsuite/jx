---
status: drafted
disposition: remove
claims:
  - compiler.md#10
requires: []
workspaces:
  - packages/compiler
size: S
---

# compiler.md §10's last ledger rows leave the spec, §10 is marked Removed, and the island code no build can reach is deleted

## Context

`specs/compiler.md` §10 (heading at line 690, marker at line 692), with the three rows the census kept (lines 696 to 698):

> **Status: Partial.** None of the three remaining rows ships. A `$prototype: "Request"` with `timing: "compiler"` is never fetched at build time: `resolvePrototypes` (`packages/compiler/src/site/prototype-resolver.ts`) has no class mapping for it and skips it, and the site build then strips it as a resolved compiler entry, so nothing is baked and the page gets no fetch either; the row belongs to `spec.md` §11.3's compiler row and stays here until that section marks it. Nothing emits a `<script type="application/Jx+json">` island: […] No dependency-manifest file is written, and nothing in the build collects imports (`collectSrcImports` in `packages/compiler/src/shared.ts` has no caller outside its tests). […]

| Feature              | Description                                             | Status                                                           |
| -------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| `timing: "compiler"` | Bake fetch responses into HTML at build time            | **Pending**                                                      |
| Island serialization | `<script type="application/Jx+json">` hydration islands | **Pending**                                                      |
| Bundle manifest      | Exact dependency manifest from JSON analysis            | **Pending** (nothing in the build collects imports; no manifest) |

Re-read against the tree on 2026-09-27. Each row leaves for its own reason:

- **`timing: "compiler"` (a baked fetch response).** Its home already marks it, so the stub's wait is over. `spec.md` §11.3's leading marker (line 1228) says "a `$prototype: "Request"` is never fetched at build time", its `"compiler"` cell (line 1234) reads "**Partial** … not a `Request` or a self-contained class", and `plan:spec/timing-values-in-built-sites` claims that section with the `Request` as its own item 2. Both landed in the census commit (1127bfbe).
- **Island serialization.** Never built, and nothing needs it. Nothing in the repository emits `application/Jx+json` (the only near match is Studio's clipboard type `web application/jx+json`, unrelated), and `compiler.test.ts` ("no hydration island markers in output") already asserts its absence. A dynamic page compiles through `compile-client.ts` to prerendered HTML plus one module (§9.1); a prerendered component instance carries its props in `data-jx-props` (§4.4, §8.1); and a built site ships no Jx runtime that could read a JSON island (§12 ships only `@vue/reactivity` and `lit-html`).
- **Bundle manifest.** §12 records the decision against it: the client-runtime set "is read back out of the finished HTML, not recorded where a map is written" (`importMapAssetsInHtml` in `packages/compiler/src/site/client-runtime.ts`). Sidecar specifiers are registered as they are rewritten, by `rewriteSidecarSrc` in `packages/compiler/src/site/site-build.ts` (the stub said `bundler.ts`, which only bundles them in step 6d). `collectSrcImports` and its `_walkSrc` (`shared.ts`, line 1372) have no caller outside `shared.test.ts` and `shared-coverage.test.ts`. The ledger has called both rows "Not implemented" or "Partially implemented" and then Pending since its earliest version in git (93677eeb), so neither was ever documented as working.

**Unreachable code, verified.** The `_islands/jx-island-N.js` branch in `packages/compiler/src/targets/compile-static.ts` (`compileStaticPage` lines 51 to 86, `compileNode` lines 155 to 161, `buildInnerWithIslands`) cannot run through `compile()`. `compileStaticPage`'s only caller is route 1 of `compile()` (`packages/compiler/src/compiler.ts`, line 113), taken when `isDynamic(raw)` is false. Every check `isNodeDynamic` makes (`$switch`, a mapped array or `childrenContainArray`, a `$ref` or template in a non-reserved key, a template in `style` or `attributes`) is also in `isDynamic`, and `isDynamic` recurses into array children, so no descendant of a static-routed page is node-dynamic. Only `compile-static.test.ts` reaches the branch, by calling `compileStaticPage` directly, in three cases ("converts dynamic nodes to islands", "includes importmap and module scripts for islands", "state with template triggers island compilation"; the last one's root `state` would itself route that document to the client target). Found while detailing:

- `isNodeDynamic` (`shared.ts`, line 357) has one caller, the branch; `hasAnyIsland` (line 410) has none in any source file.
- `compileStaticPage`'s `reactivitySrc`, `litHtmlSrc` and `rewriteSrc` options feed only the branch.
- None of these symbols is reachable through a package export: `compile-static.ts` and `shared.ts` are not `exports` subpaths, and `src/compiler.ts` re-exports only `isDynamic` from `shared.ts`.

**Stale text naming the branch's output.**

- `specs/site-architecture.md` §14.4 (line 2040, under §14's `Implemented` marker) and the JSDoc of `writeNoJekyll` (`packages/compiler/src/site/headers-emitter.ts`, lines 241 to 242) both say Jekyll excludes "`_headers`, `_redirects`, `_worker.js`, `_routes.json` and `_islands/`". The list is wrong both ways. The build never writes `_islands/`, but it does write `images/_optimized/` (`OPTIMIZED_DIR` in `image-optimizer.ts`, copied to `dist/` in site-build step 6b), which is the one `_`-prefixed path a page actually needs, and a per-page `_server.js` (`site-build.ts`, line 815) that `plan:_shared/no-adapter-server-tier` retires. No test asserts either mention.
- `docs/framework/build.md` "Islands in a static shell" (lines 82 to 91) documents the branch as shipped output, with a `<jx-island-0>` example.
- compiler.md §12's "Collection" bullet (line 738) and site-architecture.md §12.1's pipeline diagram (line 1582) list "island" emission among the sidecar-collection sites; the branch is the only emitter that meant.

Elsewhere "island" is the architecture's word for a component or page module hydrating in place: site-architecture.md §1.1 principle 3 and §12.4, compiler.md §4.4 and its subtitle, `spec.md` §21.1, `injectComponentScripts`'s live `islandSource` parameter (the page's emitted modules), and `site-build-component-loading.test.ts`, which calls a dynamic page's `app.js` "the island module". That usage describes behaviour that ships.

**Plans that name this code.** Three cite this plan: `plan:spec/timing-values-in-built-sites` (line 31), `plan:spec/style-handle-assignment` (line 37) and `plan:_shared/compiled-server-call` (line 49, which already leaves the static route alone). Six more edit, rely on or annotate the branch, with no edge in either direction, so whichever lands second adapts: `plan:spec/compiled-keyed-lists` step 2 threads `runtimeImports` into `compileStaticPage`'s islands map, with a `compile-static.test.ts` islands case; `plan:spec/static-dom-property-emission` step 4 edits `buildInnerWithIslands`, which step 1 below renames; `plan:spec/compiled-element-parameterised-bodies` and `plan:spec/named-formula-recursion` count the island modules among the element target's callers; and `plan:spec/static-style-rules-only` and `plan:compiler/client-external-class-hydration` note island defects this deletion makes moot.

## Outcome

- `compiler.md` §10 → Removed: the heading stays, the table goes, and one marker says where each tracked feature is specified.
- The `Request` half of compiler timing stays open where it is owned, `spec.md` §11.3.
- No target can emit `_islands/`, a `jx-island-N` element or a JSON island: `compileStaticPage` emits no module, and `isNodeDynamic`, `hasAnyIsland` and `collectSrcImports` are gone.
- site-architecture.md §14.4 and §12.1, compiler.md §12, `writeNoJekyll`'s JSDoc and `docs/framework/build.md` describe only what the build writes.

## Decisions

- **Decided:** no `requires`, because `spec.md` §11.3 has carried the `Request` gap since the census (the marker and the `"compiler"` cell), claimed by `plan:spec/timing-values-in-built-sites`, so the row can leave compiler.md whenever this lands, and that plan needs nothing from this one.
- **Open:** whether a page with one interactive section should compile to a static shell with islands (the `_islands` branch made reachable) instead of wholly to the client tier. Recommendation: no, delete the branch, because its output is worse than what ships: it leaves an empty `<jx-island-N>` placeholder whose content exists only once its module runs, where the client tier prerenders the whole page. An island compiled from its subtree alone also cannot read state declared on the page, so it would serve only a subtree that declares its own state, which is what a component is, and a component already loads its module only on the pages that use it (site-architecture.md §12.4). Reaching the branch would need a new rule in compiler.md §2's route table: an `implement` of its own, which nothing asks for.
- **Decided:** delete `collectSrcImports`, `_walkSrc`, `isNodeDynamic` and `hasAnyIsland` in the same pull request, with their tests, because nothing calls any of them once the branch is gone (`hasAnyIsland` has no caller today), no package export reaches them, and §12 records the opposite decision to an analysis-time import list. `isDynamic` already has its own case for every check `isNodeDynamic` makes (`shared.test.ts`, `describe("isDynamic")`).
- **Decided:** `compileStaticPage` keeps its `{ html, files }` return with `files` always `[]`, because `compile()` returns that shape on every route and `buildSite` and `runCli` loop over `result.files` unconditionally. Its `reactivitySrc`, `litHtmlSrc` and `rewriteSrc` options and its `[key: string]: unknown` index signature go, and `compile()` stops passing them.
- **Decided:** "island" stays wherever it names a component or page module hydrating in place (the uses listed in Context). Only text naming the `_islands/` directory, the `jx-island-N` placeholder, a JSON island, or the branch as an emission site changes, plus two uses in `build.md` that leaned on the section being rewritten. The word describes behaviour that ships; those artifacts do not exist.
- **Decided:** §14.4 and `writeNoJekyll`'s JSDoc name the `_`-prefixed output a page needs (`images/_optimized/`, plus a project's own files from `public/`) instead of enumerating every `_`-prefixed file, because the host-configuration files mean nothing to GitHub Pages either way, and an enumeration goes stale whenever an emitter is added or retired: `_islands/` already did, and `_server.js` will.
- **Decided:** both fragments are `patch`. The two removed rows were never documented as working, and the §12, §12.1 and §14.4 edits are editorial.

## Implementation

1. **`packages/compiler/src/targets/compile-static.ts`**
   - Module comment: the file compiles a document `isDynamic` judged static to plain HTML/CSS with zero JS; `compile()` routes nothing else here, and a document with any dynamic node is compiled whole by `compile-client.ts` (compiler.md §8.1, §9.1).
   - `compileStaticPage`: the options type becomes `{ title?: string; projectStyle?: JxStyle | null; prePaintScheme?: boolean }`. Delete `islands`, the `if (islands.length > 0)` block, `importMap`, `moduleScripts` and their two interpolations in the page template. Return `{ files: [], html }`, with `files` typed as before so `compile()`'s return type is unchanged. Update the JSDoc ("with dynamic subtrees as islands" goes).
   - `compileNode(def, raw, context)`: drop the `dynamic` and `islands` parameters and the `if (dynamic)` block; the doc comment loses its island sentence.
   - `buildInnerWithIslands` becomes `buildStaticInner(def, raw, context)` (not `buildInner`, which `shared.ts` already exports), and its child loop calls `compileNode(child, childRaw, context)`.
   - Imports: drop `isNodeDynamic` and `emitElementModule`.
2. **`packages/compiler/src/compiler.ts`**, route 1: call `compileStaticPage(raw, { projectStyle, title, ...(opts.prePaintScheme === false ? { prePaintScheme: false } : {}) })`. `litHtmlSrc` and `reactivitySrc` stay destructured for routes 2 and 3.
3. **`packages/compiler/src/shared.ts`**: delete `isNodeDynamic`, `hasAnyIsland`, `collectSrcImports` and `_walkSrc`. `isMappedArray` and `childrenContainArray` stay (`isDynamic` uses them).
4. **`packages/compiler/src/site/headers-emitter.ts`**, `writeNoJekyll`'s JSDoc: "GitHub Pages runs Jekyll, which leaves every `_`-prefixed path out of the published site, at any depth. The one the build writes that a page needs is `images/_optimized/`, and a project may ship its own from `public/`. One empty file closes the whole class of "works locally, half-broken on Pages", so it is unconditional rather than an adapter option."
5. **`packages/compiler/src/site/site-build.ts`**, the comment above the `compile()` call's runtime options: "a page that reached compile-static/compile-client" becomes "a page that reached the client or custom-element target", since the static target no longer writes a map.
6. **Plans, in the landing pull request.** Delete this file. Reword every citation `grep -rn "plan:compiler/superseded-ledger-rows" plans/` finds (the three under Context) to cite `compiler.md` §10 (Removed), or `plans:check` fails with `citation-unknown`. For each of the other plans named there that is still open, drop the island half of its step (`compiled-keyed-lists`: the static target leaves its tier list and its test list) or follow the rename (`static-dom-property-emission`: `buildStaticInner`), and delete its island notes.

**Integration contract.** Once this lands: `compileStaticPage(raw, { title?, projectStyle?, prePaintScheme? })` returns `{ html, files: [] }`, and its HTML holds no import map and no module script. The modules `compile()` emits come only from route 0 (class), route 2 (`emitElementModule`) and route 3 (`compileClient`), so a plan threading an option into emitted modules touches those two emitters and `compileElement`, never the static target. `shared.ts` no longer exports `isNodeDynamic`, `hasAnyIsland` or `collectSrcImports`. compiler.md §10 is Removed and names `spec.md` §11.3 as the home of compiler timing. site-architecture.md §14.4 lists `images/_optimized/` and no `_islands/`.

## Tests

`bun test --isolate --coverage` from `packages/compiler`.

- **`tests/compile-static.test.ts`**: delete the three island cases named in Context; drop `litHtmlSrc` and `reactivitySrc` from `baseOpts`. Add `emits no module, import map or script for a node the client would bind`: the deleted first case's fixture (a child with `onclick: { $ref: "#/state/fn" }` and its own `state`), asserting `files` equals `[]` and `html` contains none of `<script`, `importmap`, `jx-island` or `_islands/`.
- **`tests/compiler.test.ts`**, `describe("compile — dynamic documents (standard tagName → client target)")`: rename "static parent with dynamic child: routes to client target" to "static parent with one dynamic child: the whole page routes to the client target, with no islands", and add `expect(files.map((f) => f.path)).toEqual(["app.js"])` and `expect(html).not.toContain("jx-island")`.
- **`tests/shared.test.ts`**: delete `describe("isNodeDynamic")`, `describe("hasAnyIsland")` and `describe("collectSrcImports")`, and the three imports.
- **`tests/shared-coverage.test.ts`**: delete `describe("isNodeDynamic — style template string")`, `describe("hasAnyIsland — non-object")` and `describe("collectSrcImports — string children")`, and the three imports.

Coverage: `packages/compiler/bunfig.toml` gates every file at lines 0.982 and functions 0.98. The existing `compile-static.test.ts` cases still reach every remaining line of `compile-static.ts` (text, number, boolean and null children, void elements, `<pre>`, `innerHTML`, `textContent`). Deleting covered lines from `shared.ts` raises its uncovered share, so read its row in the table: if it falls below the bar, cover the gap rather than lowering the threshold. Ratchet only if the workspace's worst file rises. No source file is added, so `bun scripts/check-coverage-manifest.ts packages/compiler` has nothing new to find.

## Specs & docs

**compiler.md §10**, in place: keep `## 10. Pending Features`, and replace the Partial marker, the table and the "See the Site Architecture Specification" line with:

> **Status: Removed.** This was a status ledger, and it is retired: each feature it tracked is specified or declined on its own section. Compiler timing, a build-time fetch of a `Request` included, is `spec.md` §11.3's `"compiler"` row. A page's interactive regions reach the browser as prerendered HTML plus the page's own module (§9.1) and as prerendered component instances that upgrade from their `data-jx-props` payload (§4.4, §8.1), so no JSON hydration island is emitted. The browser modules a build ships are bundled per `$src` specifier as pages and components are emitted, and the runtime set is read back out of the finished HTML (§12), so no dependency manifest is written. The ledger's other rows are specified on §6.3, §7, and `site-architecture.md` §4.3, §5, §6.4, §8.3, §8.4.1, §11.1, §12.1 and §14.

**compiler.md §12**, "Collection" bullet: "during page/component/island emission" becomes "during page and component emission".

**Fragment:** `bun run spec:change compiler.md patch -m "§10: the Pending Features ledger is retired and marked Removed. Compiler timing is specified by spec.md §11.3, a page hydrates through its own module and prerendered component instances rather than JSON islands, and no dependency manifest is written (§12); §12 no longer names island emission as a sidecar-collection site."`

**site-architecture.md §14.4**, in place, the paragraph becomes: "Written unconditionally. GitHub Pages runs Jekyll, which leaves every `_`-prefixed path out of the published site, at any depth. The build writes one that a page needs, `images/_optimized/`, where the image pipeline puts its variants (§9.2), and a project may ship its own from `public/`; the host-configuration files (`_headers`, `_redirects`, `_worker.js`, `_routes.json`) mean nothing to GitHub Pages either way. One empty file closes the whole class of "works locally, half-broken on Pages", which is why it is not an adapter option."

**site-architecture.md §12.1**, the pipeline diagram's "Bundle client sidecars" entry: "collected from pages, components, islands," loses "islands,".

**Fragment:** `bun run spec:change site-architecture.md patch -m "§14.4 names the underscore-prefixed output GitHub Pages would drop that a page needs, the optimized-image directory, instead of an island directory the build never writes; §12.1 no longer lists islands among the sidecar-collection sites."`

Neither spec graduates: compiler.md keeps §2, §2.2, §3 and more open, and site-architecture.md's markers are untouched.

**Docs** (no em dashes). No page's `spec:` cites `compiler.md#10` or `site-architecture.md#14.4`. `bun run docs:sync` names these through their `code:` lists:

- `docs/framework/build.md` (`compile-static.ts`, `shared.ts`) changes.
  - Replace "### Islands in a static shell" (heading, both paragraphs and the example) with "### Components on a static page": "A page whose own document is static stays static when it uses interactive components. Each instance is prerendered where it is written, and a component that needs JavaScript (a hyphenated `tagName`, say `site-counter`) loads `dist/components/site-counter.js` only on the pages that use it. The module upgrades the prerendered element in place, taking the props it was rendered with from its `data-jx-props` attribute:" then an `html` example of `<site-counter data-jx-props="{&quot;start&quot;:3}" data-jx-prerendered>…</site-counter>` and its `<script type="module" src="/components/site-counter.js"></script>`, then: "The import map added to those pages resolves `@vue/reactivity` and `lit-html` for the component modules, and a fully static component ships no module at all. Anything dynamic in the page document itself, at any depth, makes the whole page a [dynamic page](#dynamic-pages) instead: the compiler does not cut a dynamic subtree out of a static page. To keep a page static with one live part, make that part a component."
  - Move "### Dynamic pages" (with its two trailing paragraphs) up from under "## Where the runtime comes from" to follow the new section, so the three tiers sit under "## The output tiers". The text is unchanged and so is the `#dynamic-pages` anchor. "## Where the runtime comes from" then no longer follows a paragraph naming the two modules, so its opening "Those two modules are bundled" becomes "`@vue/reactivity` and `lit-html` are bundled".
  - "What prerendering will and won't bake": "the array ships with the island" becomes "the array ships to the browser".
  - "Related": "the component model behind islands" becomes "the component model behind interactive regions".
  - Frontmatter `spec:` gains `compiler.md#4.4 # property bridge: the data-jx-props payload`.
- `docs/framework/site/deployment.md` (`headers-emitter.ts`; `spec:` cites §14 and §14.7): no change. Its `dist/` tree already lists `images/_optimized/`, and ".nojekyll: So GitHub Pages doesn't eat the _-prefixed files above" stays true.
- `docs/framework/concepts/elements.md`, `styling.md` and `color-schemes.md` (`shared.ts`), `docs/studio/publish/other-hosts.md` (cites §14) and `docs/framework/site/search.md` (cites §12): no change; they describe nothing deleted or edited.

## Acceptance

- `cd packages/compiler && bun test --isolate --coverage`: green, every file at or above lines 0.982 and functions 0.98.
- `bun scripts/check-coverage-manifest.ts packages/compiler`, `bun run typecheck`, `bun run lint`: green.
- `grep -rnE "_islands|jx-island|JxIsland|isNodeDynamic|hasAnyIsland|collectSrcImports" packages/compiler/src specs docs --include=*.ts --include=*.md` prints nothing (the tests are left out: the new cases name `jx-island` and `_islands/` in order to assert their absence, as `compiler.test.ts` already does for `data-jx-island`).
- `awk '/^## 10\./,/^## 11\./' specs/compiler.md` shows the heading and the Removed marker, and no table.
- `bun run plans:status --spec compiler` no longer lists §10; `bun run plans:status --who-claims spec.md#11.3` still names `spec/timing-values-in-built-sites`.
- `bun run docs:status`, `bun run docs:spec-release` (both fragments present), `bun run plans:check`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown`: green.
