---
status: stub
disposition: implement
claims:
  - imports.md#1.3
  - site-architecture.md#2.2
  - site-architecture.md#10.3
  - studio.md#5.4
size: M
workspaces:
  - packages/compiler
---

# `jx build` compiles every component a page or layout reaches, wherever it lives, and the specs state discovery and compilation as two rules

## Context

**The leading question: does the build compile every component a page or layout reaches, or does the text instead separate palette discovery from build compilation and have the build refuse what it cannot compile?** The evidence answers the first, so the disposition is `implement`:

- **Studio writes the entry the build drops.** Dropping a project component from the Insert palette appends `{ "$ref": "<path relative to the open document>" }` to that document's `$elements` (`enableElement` and `elementsEntryFor` in `packages/studio/src/files/elements.ts`, called from `packages/studio/src/panels/dnd.ts`), and the palette offers every component document in the project tree. A drop of `components/nested/deep-card.json` or `pages/blog/_blog-card.json` therefore produces a document the canvas renders and `jx build` ships as an empty tag. Separating the two rules without implementing leaves Studio's own drop producing a broken site, unless the palette is narrowed to `components/`, which undoes what all three hosts agree on and hides the co-located components site-architecture.md §2.2 sanctions.
- **Every other surface honours the entry.** The runtime registers both entry forms (`registerElements` in `packages/runtime/src/runtime.ts`), and the canvas resolves each `$ref` against the open document (`defineElement(new URL($ref, docBase))` in `packages/studio/src/canvas/iframe-render.ts`). The build is the only surface that does not.
- **The user docs already promise it.** `docs/framework/site/routing.md` says `pages/blog/_blog-card.json` "is available for `$ref` but never becomes `/blog/_blog-card`", and `docs/framework/site.md` says components "can live next to the pages that use them".
- **The compiler already compiles by path.** `compileElement` (`processElement` in `packages/compiler/src/targets/compile-element.ts`) resolves and compiles a component's own `$elements` wherever they live. What is missing is reading a page's and a layout's entries, and giving each reached component what the top-level loop gives one (below).

What survives from the other option is the separation in the text, and it lands with the implementation: discovery (what the palette offers, every component document in the project tree) is not compilation (what a build emits, every component a page or layout reaches plus the files in `components/`), and a declared `$ref` the build cannot resolve or compile becomes a build error rather than an empty tag.

Two census stubs are merged here: `_shared/component-discovery` (§10.3) and `_shared/component-discovery` (studio.md §5.4). Both were `reconcile` stubs rewriting one discovery rule in two specs, and the studio census proposed the merge. The cross-spec review then found that the build compiles only the files directly in `components/`, which turns the reconcile into an implement; the markers stage opened site-architecture.md §2.2 and imports.md §1.3 for it and extended the §10.3 and imports.md §1.4 markers with the build half. imports.md §1.4 stays with `plan:imports/canvas-project-context`, which owned it before the markers stage (see **Related**).

`specs/imports.md` §1.3, line 50 (opened by the markers stage):

> **Status: Partial.** Both entry forms ship in the runtime (`registerElements` in `packages/runtime/src/runtime.ts`), and the site build honours bare strings from a page's and its layout's `$elements`. The build does not honour a `{ "$ref" }` entry: `buildSite` in `packages/compiler/src/site/site-build.ts` compiles only the files directly in `components/` and never reads a page's or layout's `$ref` entries, so a declared `../components/nested/deep-card.json` or `./_blog-card.json` ships as an empty custom-element tag with no module and no build error; only a component's own `$elements` dependencies compile wherever they live (`compileElement` in `packages/compiler/src/targets/compile-element.ts`).

`specs/site-architecture.md` §2.2, line 131 (opened by the markers stage):

> **Status: Partial.** The routing half ships: `_`-prefixed entries under `pages/` are skipped by route discovery (`packages/compiler/src/site/pages-discovery.ts`), and Studio's palette finds a co-located component (§10.3). The build does not compile one: `buildSite` in `packages/compiler/src/site/site-build.ts` compiles only the files directly in `components/` and never reads a page's `{ "$ref" }` `$elements` entry, so a page naming `./_blog-card.json` ships an empty `<blog-card></blog-card>` with no module and no build error.

`specs/site-architecture.md` §10.3, line 1401 (unmarked before the census; the last sentence is the markers stage's):

> **Status: Partial.** Project scoping ships: no other project's components reach the palette, and project `imports` apply project-wide (`packages/site/src/context.ts`). Discovery is not limited to `components/`: the dev server (`/__studio/components` in `packages/server/src/studio-api.ts`), the desktop (`discoverComponents` in `packages/desktop/src/project-session.ts`) and the cloud host (`discoverComponents` in `packages/studio/src/platforms/cloud.ts`) find a component document anywhere in the project tree, which is what §2.2's co-located components need. The build compiles a narrower set than it discovers, so the second bullet does not hold for `jx build`: `buildSite` in `packages/compiler/src/site/site-build.ts` compiles only the files directly in `components/` (a non-recursive listing) and never reads a page's or layout's `{ "$ref" }` `$elements` entries, so `../components/nested/deep-card.json` or `./_blog-card.json` named there ships as an empty custom-element tag with no module and no build error, and only a component's own `$elements` dependencies compile from elsewhere in the tree.

`specs/studio.md` §5.4, line 383 (unmarked before the census; the studio census first recorded it as verified, and the site-architecture and desktop censuses forwarded the marker):

> **Status: Partial.** The panel ships as the Insert palette's one Components section, scoped to the open project, with the live previews and drag sources described below (`componentViews` in `packages/studio/src/panels/elements-panel.ts`, `panels/component-preview.ts`, `loadComponentRegistry` in `files/components.ts`). Its `components/` rule is not what ships: every host's `discoverComponents` (`/__studio/components` in `packages/server/src/studio-api.ts`, `packages/desktop/src/project-session.ts`, `packages/studio/src/platforms/cloud.ts`) returns every component document anywhere in the project tree outside `node_modules`, `dist` and `.claude`, drawn as one flat list, and the open document's `$elements` gates only the npm components, which only the dev server discovers (`enabledNpmTags`). site-architecture.md §10.3 states the same discovery rule, and desktop.md §6.2–§6.5 scope this panel differently, as an Active/Global split per document.

A ride-along this plan does not claim: studio.md §3.6's "Component definitions" row (line 150) restates §5.4's `components/` rule, and §3.6's marker (line 142) says "the component row's `components/` limit is §5.4's rule, which is not what ships". §3.6 stays with `plan:studio/site-state-in-data-panel`. The row is rewritten here, because it has no other content, and the component clause leaves §3.6's marker in the same edit; §3.6 flips to Implemented only once both plans have landed, and whichever lands second removes the marker.

**What exists**

Discovery, the palette's half, the same on all three hosts:

- The dev server's `/__studio/components` route (`packages/server/src/studio-api.ts`): a `Bun.Glob` over the project root that also reads the format registry's component extensions and, from `package.json`, CEM-bearing npm packages.
- The desktop's `discoverComponents` (`packages/desktop/src/project-session.ts`): `Bun.Glob("**/*.json")`.
- The cloud host's `discoverComponents` (`packages/studio/src/platforms/cloud.ts`): a bounded tree walk, depth 6 and 400 files, that also skips `.git`, `build`, `.obsidian` and dot-directories.
- Each skips `node_modules`, `dist` and `.claude`, and all three share `componentMetaFrom` in `packages/schema/src/component-meta.ts`.
- The project-scoped registry: `componentRegistry`, `loadComponentRegistry` and `noteComponentSaved` in `packages/studio/src/files/components.ts`. Project `imports` apply project-wide (`packages/site/src/context.ts`), and nothing from another project reaches the palette.
- The panel: `componentViews` and `enabledNpmTags` in `packages/studio/src/panels/elements-panel.ts`, one `Components` accordion section drawn before the element categories. Project components are never gated; npm ones appear only when the open document's `$elements` names the package or `package/modulePath`.
- The preview half of §5.4 holds: `packages/studio/src/panels/component-preview.ts` calls `defineElement(url)` then `document.createElement(tagName)`.
- The drop: `registerComponentsDnD` (`packages/studio/src/panels/dnd.ts`) makes each card a drag source, and a dropped component gains its `{ $ref }` through `enableElement`, deduplicated on the resolved path (`hasElement`, studio.md §9.1.3).
- Tests: `packages/studio/tests/elements-panel.test.ts` ("Insert panel — components"), `packages/studio/tests/components.test.ts`, `packages/studio/tests/cloud-platform.test.ts` (`discoverComponents`), `packages/server/tests/studio-api.test.ts` (`/__studio/components`).

Routing: route discovery skips `_`-prefixed files and directories under `pages/` (`packages/compiler/src/site/pages-discovery.ts`, lines 214 and 228).

Compilation, the build's half, in `buildSite` (`packages/compiler/src/site/site-build.ts`):

- Step 5 lists `components/` with a non-recursive `readdirSync`, filtered to `.json` and the component formats' extensions. Each file is compiled by `compileElement`, written as `dist/components/<tag>.js`, given a stylesheet by `buildComponentCSS` (inlined into each page that uses it by `injectComponentScripts`, and written as `<tag>.css`), and entered in `componentDefs`, which feeds prerendering (`expandComponents`), the fully-static script omission and step 5b's server-entry collector.
- `componentTagByPath` maps only those top-level files to their tags, so `resolveElementPath` rewrites a dependency's import to `./<tag>.js` only when the dependency itself sits directly in `components/`; otherwise it keeps the source-relative path with `.json` swapped for `.js`.
- A page's and its layout's `$elements` are read only by the npm filter (`isNpmElementEntry`: strings not starting with `./` or `../`, from `layoutDoc` and `pageDoc`). A `{ "$ref" }` entry is never read. `injectContext` (`packages/compiler/src/site/context-injection.ts` over `packages/site/src/context.ts`) unions project.json's `$elements` into the layout-wrapped document without rebasing them.
- Undeclared components: `injectComponentScripts` loads a module for every compiled tag found in the page's HTML or island source, which is the build's side of imports.md §1.4's discovery.
- Tests: `site-build.test.ts`, `site-build-component-loading.test.ts`, `site-build-nested-components.test.ts` and `site-build-shared-dependency.test.ts` in `packages/compiler/tests` all place every component directly in `components/`.

Scratch builds (`buildSite` over throwaway projects, no test suite):

- The cross-spec review's, rebuilt by the markers stage: `pages/blog/_blog-card.json` named `./_blog-card.json` by `pages/blog/index.json`, and `components/nested/deep-card.json` named `../components/nested/deep-card.json` by `pages/index.json`. Both shipped empty tags with no module and `errors: []`; `dist/components` held only the top-level `top-card.js`.
- This merge's, on 2026-09-26: `components/host-card.json` naming `{ "$ref": "./nested/styled-dep.json" }`, each with a root `style`. `errors: []`, and `dist/components/styled-dep.js` was written, but `host-card.js` opens with `import './nested/styled-dep.js';`, a file the build never writes, so the browser cannot fetch it and `host-card`'s module never evaluates. The page's `<style>` carries `host-card`'s rule and not `styled-dep`'s, and `<styled-dep></styled-dep>` is not prerendered. The markers' "a component's own `$elements` dependencies compile wherever they live" holds for the module's bytes only.
- Also this merge's: two files directly in `components/` both declaring `tagName: "dup-card"`. `errors: []`; the shipped module came from one file, and the stylesheet and prerendered markup from the other, because the module write is guarded by first-seen tag while `componentDefs`, `componentCSS` and `<tag>.css` are overwritten by the last. Which file wins follows the directory listing's order.

**What is missing**

The build:

- Collecting every component a page reaches: the `{ "$ref" }` entries in the page's, each wrapping layout's and project.json's `$elements`, each resolved against the directory of the document that declared it (the project root for project.json), before `injectContext` merges them unrebased; then transitively through each reached component's own `$elements`.
- Each reached component given everything a top-level one gets: its module under its tag, its stylesheet, and a `componentDefs` entry for prerendering, static detection and the step-5b collector.
- A dependency's import specifier pointing where the dependency is written, by extending `componentTagByPath` to every reached component rather than the files directly in `components/`.
- A declared `$ref` that does not resolve to a file, or whose file is not a component (no hyphenated `tagName`), reported in `errors` naming the page and the entry, instead of shipping an empty tag.
- One rule for two reached components that declare the same `tagName`: output is keyed by tag (`dist/components/<tag>.js`) and a page has one custom-element registry, so the scratch mismatch above becomes a build error or the output is keyed differently. The detail phase decides which.
- Whether the build keeps compiling every file directly in `components/` whether or not a page reaches it (today it does, and `injectComponentScripts` loads only the ones a page uses), and whether the collection walk is shared with `discoverElements` in `packages/site/src/compose.ts`, which would add `packages/site` to the workspaces.

The text:

- imports.md §1.3: the marker removed; the `{ $ref }` bullet says a build compiles the component it names, as the runtime fetches it.
- site-architecture.md §2.2: a co-located component is compiled when a page or layout names it, and a `$ref` the build cannot compile is an error.
- site-architecture.md §10.3: the first bullet rewritten to what the palette discovers (every component document in the project tree, outside the skipped directories, whatever directory holds it), and a sentence stating what a build compiles, which the second bullet then holds for. An editorial ride-along in §12.1's pipeline line "Compile components/ → element modules + CSS" (line 1558, an unmarked section no plan claims), which becomes every component a page or layout reaches.
- studio.md §5.4's second sentence rewritten the same way for the panel: every component document in the project tree, nothing from another project, npm components shown when the open document's `$elements` enables them. studio.md §3.6's "Component definitions" row rewritten to defer to §5.4, and the component clause dropped from §3.6's marker (the ride-along above).
- One owner for the panel's scoping rule. desktop.md §6.2–§6.5 specify an Active/Global split per document for the same panel: either §5.4 owns the rule and desktop.md §6 defers to it, or §5.4 states discovery only and defers the sectioning to desktop.md §6. The rewrite leaves one statement of it. `plan:desktop/component-scope-sections` requires this plan for that decision.
- Whether "only the dev server discovers npm components", the hosts' skip lists and the cloud host's bounds belong in the spec or stay host detail. Both census stubs asked it.
- The docs pages `bun run docs:sync` names for these sections, with `docs/framework/site/routing.md` and `docs/framework/site.md` (which already promise the co-located `$ref`) checked against the result.

**Related**

- `plan:desktop/component-scope-sections` (desktop.md §6.2–§6.5) requires this plan: it gets the decision on which spec owns the Components panel's scoping, and the discovery rule its Active/Global partition is computed over. `plan:desktop/single-file-mode` renders the Active set as its flat list.
- imports.md §1.4, owned by `plan:imports/canvas-project-context`. Its marker now carries two halves: the canvas half that plan implements, and the build half this plan closes (the compiled set is not a superset of the effective one). §1.4 cannot flip until this plan has landed, so that plan should require this one; the edge is not drawn here, because its file is outside this change. Its target of `components/<tag>.json` for undeclared discovery is unchanged by this plan, which compiles declared entries wherever they live.
- `plan:_shared/page-server-entries`: step 5b walks `componentDefs` and rewrites each `src` to `./components/<src>`, which is right only for files directly in `components/`. Widening `componentDefs` here widens that collector, and resolving `src` against the declaring document's directory is that plan's item; whichever lands second reconciles the two.
- `plan:studio/site-state-in-data-panel` (studio.md §3.6, whose component row is rewritten here).
- `plan:imports/packages-panel-section` points imports.md §5 and §5.1 at studio.md §5.4. `plan:studio/insert-palette-categories` owns studio.md §5.3, the element half of the same Insert panel.
- `plan:_shared/collection-directive-elements` (imports.md §6): a collection's `$elements` are a further declaring document for Markdown rendering, outside this plan's page and layout set.
- site-architecture.md §10.6 (the palette is project-scoped), studio.md §9.1.3 (the one `$elements` service a drop goes through), compiler.md §4.6 (a component's `$elements` imports registered before its own `define`), server.md §3.4 (the live preview composes through imports.md §1.4's rule).
