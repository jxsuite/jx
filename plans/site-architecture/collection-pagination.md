---
status: drafted
disposition: implement
claims:
  - site-architecture.md#4.3
requires: []
workspaces:
  - packages/schema
  - packages/site
  - packages/compiler
  - packages/studio
  - packages/starters
  - packages/ui
  - examples
  - sites/jxsuite.com
  - sites/test-blank
  - scripts
size: L
---

# A page can split a list in its own state into numbered routes, each built with its slice and a `$page.pagination` a pager can render

## Context

`specs/site-architecture.md` §4.3, line 290:

> **Status: Partial.** The three `$paths` shapes and the extension discriminator ship (`expandDynamicRoutes` in `packages/compiler/src/site/pages-discovery.ts`, `Content.resolvePaths` in `extensions/parser/src/content-loader.ts`). Pagination helpers are neither specified nor built: no `$paths` shape pages a collection into numbered routes, and `ContentCollection` takes a `limit` but no offset.

The census moved the open part here from the retired roadmap, whose Phase 5 listed "Pagination helpers" unchecked. No spec section designs pagination, so the contract is written here first. Re-verified on 2026-09-27.

**What ships**

- `expandDynamicRoutes` (`packages/compiler/src/site/pages-discovery.ts`) reads each dynamic page and hands `raw.$paths` to the private `resolvePathEntries`. That function handles the legacy array, `values` and `$ref` itself and sends any other object to the extension that registered one of its keys as a discriminator. Every returned object becomes one route: each key except `_meta` is substituted into the pattern (`:name`, or the first `*` whatever the name), `_pathParams` keeps the values as strings, and `_meta.mtime` becomes `sourceMtime`, which the sitemap prefers over the template's mtime (`site-build.ts`, the `lastmod` near line 768). Problems warn and skip, and `expandDynamicRoutes` has no error channel, though `buildSite` collects `errors` and `jx build` exits 1 on any.
- Substituting an empty catch-all value gives `/blog/` rather than `/blog`, and `routeToOutputPath` writes that as `dist/blog/.html` under `trailingSlash: "never"`. A page-1-at-the-root URL therefore cannot come from the generic substitution.
- `compilePage` (`site-build.ts`, line 1240) calls `injectContext`, then `resolvePrototypes` (`packages/compiler/src/site/prototype-resolver.ts`), which replaces each class entry in `state` with its `resolve()` result and hands the class `_document: { route, state }`. `injectContext` (`packages/site/src/context.ts`) builds `$page` from the route: `params`, `title`, `url`, `alternates`, `locale`, `dir`.
- `ContentCollection` (`extensions/parser/src/content.ts`) takes `contentType`, `filter`, `sort` and `limit`, with no offset and no page, through `queryContentType`. It returns full entries, `_meta` included.
- `$paths` is validated by `documentPathsCoreMembers` (`packages/schema/defs/field-schema.schema.ts`), two closed object shapes and the legacy array, embedded in `packages/schema/schema.json` and in every committed `document.schema.json` (28 today, under `examples`, `packages/starters`, `packages/studio`, `packages/ui`, `scripts/screenshots/fixtures` and `sites`). `JxPathsDef` is in `packages/schema/types.ts`.
- Studio's route-parameter picker (`resolveParamValues`, `packages/studio/src/page-params.ts`, reached from `paramValuesFor` in `panels/pane-context.ts`) resolves the core shapes in-process. The canvas (`resolveCanvasDocument`, `canvas/canvas-live-render.ts`) substitutes the chosen values (`substitutePreviewParams`) and bakes param-bound class entries through `platform.resolveClass` (`resolveParamBoundState`).
- The live preview (`composeRoute` in `packages/site/src/compose.ts`) matches a URL against route patterns and never expands `$paths`. `jx dev` serves the built `dist/`.
- `paginate` in `extensions/feed/src/shared.ts` chunks feed archives from the oldest end so a published archive never changes (RFC 5005). A listing's pages are numbered from the front of its sort, so that helper is not reusable here.

**What is missing:** a `$paths` shape that pages a list, the page's slice, the pager values, the first page's URL, the sitemap and translation behaviour of paged routes, and Studio's picker and canvas for them.

## Outcome

- site-architecture.md §4.3 → Implemented. `{ "paginate": { "$ref": "#/state/posts" }, "pageSize": 10 }` generates one route per ten items of the page's own `posts` entry. Each route is built with `posts` replaced by its slice and with `$page.pagination`. The paged routes enter the sitemap and the translation sets as ordinary routes, and Studio's picker and canvas page them too.
- §4.5 and §8.4.1 each gain a sentence, and extensions.md §5.3's paths row names the new core member. `ContentCollection` gains no offset, because the build slices whatever the entry resolves to.

## Decisions

- **Open:** what does a paged route page? Recommendation: a core `paginate` source that points at an entry of the page's own `state` and carries `pageSize`, so `{ "paginate": { "$ref": "#/state/posts" }, "pageSize": 10 }`. The listing's query is written once, in the state entry the template already maps. Its filter, sort and `limit` decide both the page count and each slice, so the two cannot disagree. It pages anything that resolves to an array at build time: a `ContentCollection`, a class entry with `timing: "compiler"` (a `TableQuery`), or a literal array. The alternative, a `pageSize` on the parser's `contentType` source, repeats the filter and sort in `$paths` beside the state entry, and one missed edit gives a page count that disagrees with the listing. It also works only for content collections, and it still needs the host's knowledge of the route's shape for page 1's URL.
- **Open:** how is the first page's URL spelled? Recommendation: the file name decides, as in Astro, which §4.4 already cites. `pages/blog/[...page].json` gives `/blog`, `/blog/2`, …, because a catch-all may be empty. `pages/blog/[page].json` gives `/blog/1`, `/blog/2`, …, because a named parameter is always one segment. Putting page 1 at `/blog` for `[page]` would give that page a URL its own pattern does not match, so `matchRoute` and §4's URLPattern validation would contradict the build.
- **Open:** may a paged route have a second parameter, as a paged tag archive would (`pages/tags/[tag]/[...page].json`)? Recommendation: no. A paged route declares exactly one parameter, and a second one is a build error naming the route. That archive is the cross product of two sources, which needs a grammar of its own, and nothing in the repository asks for one. The spec states it as a rule and records no Future remainder.
- **Decided:** `pageSize` lives on `$paths`, not on the state entry. The entry stays a plain query that every host resolves the same way, and `$paths` is where a page declares its route set. The name matches the feed section's `pageSize`.
- **Decided:** `$page.params.<name>` is the page number as a string on every page, `"1"` included, even where the URL omits it. A template then compares one form, and the Studio picker can offer page 1 (`pushValue` drops empty values).
- **Decided:** the build resolves the paged entry once per template, while it expands the route. Each generated route carries its slice, and `compilePage` seeds the slice into `state` before `resolvePrototypes`, so the class is not queried again for each page. The expansion and the compile see one list, not two resolutions. The resolution runs through `resolvePrototypes` itself, over a document holding only that entry and the page's imports merged with the project's (rebased as `injectContext` rebases them). Running `injectContext` there would also resolve every project-level state class.
- **Decided:** every page is built, and an empty list still yields page 1 (`pageCount` is at least 1), so the listing URL exists before its first post does. Page numbers run from the front of the resolved order.
- **Decided:** `$page.pagination` is `{ number, pageCount, pageSize, itemCount, first, prev, next, last, pages }`. The URLs are site-absolute route URLs in the form `$page.url` and `$page.alternates` already use. `prev` is `null` on page 1 and `next` is `null` on the last page. `pages` is `{ number, url, current }[]`, which maps straight into a numbered pager, as `$page.alternates` maps into a language switcher. There is no `start` or `end`, because a template can compute them.
- **Decided:** a misconfigured source is a collected build error naming the route, and that route generates no pages while every other page builds. The misconfigurations are a `paginate` that is not `{ "$ref": "#/state/<key>" }`, a `pageSize` that is not a positive integer, a route without exactly one parameter, a key the page's `state` lacks, and an entry that does not resolve to an array. The schema calls a `$paths` that silently expands to nothing "exactly the failure worth catching", and a vanished listing in a production build is that failure. The sink is the `options.errors` that `plan:extensions/connector-table-paths` gives `expandDynamicRoutes`. Whichever plan lands second reuses it and adds its own key.
- **Decided:** a paged route's sitemap `<lastmod>` is the newest of its template's mtime and every item's `_meta.mtime` in the whole list. One new or edited entry can shift every page, and §8.4.1 dates a route by what it was generated from. An item without `_meta` (a table row) contributes nothing. Paged routes pair across locales by the directory rule (§13.5), page N with page N, and a `$translationKey` may name the page parameter (`"blog/${page}"`) as it names any other. Neither needs code. What is paged under `/fr/` is whatever the entry resolves to there: `ContentCollection.resolve()` (`extensions/parser/src/content.ts`) does not read the route's locale (§13.3 scopes `$paths` expansion and `ContentEntry` only), so a paged listing of a `{locale}` collection pages every language's entries, exactly as an unpaged listing lists them today. That is a collection-query gap, not a paging one, and this plan does not change it.
- **Decided:** no `<link rel="prev">` or `<link rel="next">` is injected. §8.4's automatic set holds only tags that something reads, and a template can emit links from `$page.pagination`.
- **Decided:** `ContentCollection` gets no `offset` or `page`. The slice is taken after the entry resolves, so no class needs to know it is paged.
- **Decided:** Studio pages too, in the second slice. Its picker resolves every core shape in-process (and `plan:extensions/connector-table-paths` writes that into extensions.md §8), and without this the canvas lists every item and has no `$page.pagination`. The picker and the canvas call the build's page arithmetic, so page count, slice bounds and pager URLs agree by construction. The list itself is resolved through the backend's class pipeline (`/__jx_resolve__`), as every other canvas state entry is, so it can differ from the build's where that pipeline differs (it will include drafts once `plan:site-architecture/build-excludes-drafts` lands). The live preview does not page: it never expands `$paths`, and §4.3 says so.
- **Decided:** no `requires` edge.
  - `plan:site-architecture/route-specificity-order` runs `resolveRouteCollisions` over `expandDynamicRoutes`' output. Paged routes leave it contiguous and concrete, so page 1 at `/blog` meets a `pages/blog/index.json` through that rule whenever it lands, and nothing here states a collision outcome.
  - `plan:site-architecture/build-excludes-drafts` filters the `content` map every `ContentCollection` reads, so page counts follow it.
  - `plan:extensions/connector-table-paths` and `plan:studio/canvas-injects-context` edit the same functions (`expandDynamicRoutes`' options, `resolveParamValues`, the canvas's `$page`). Whichever lands second keeps the other's branch: if the connector plan lands first, the second slice restores the by-name `$src` lookup that plan deletes, as `resolveStateEntry`; if the canvas plan lands first, the second slice passes `pagination` on the route it gives `injectContext`.
  - §5.5, which `plan:site-architecture/page-context-props` owns, is not edited: `$page.pagination` is documented where the route it comes from is, as §4.5 documents `$page.params`.

## Implementation

**Slice 1: the build.**

1. **`packages/site/src/pagination.ts`** (new; `"./pagination": "./src/pagination.ts"` in `packages/site/package.json`; module doc cites site-architecture.md §4.3 and carries `@docs framework/site/routing`). Pure, no imports, so the compiler and Studio share it:
   - `export interface PagedSource { key: string; pageSize: number }`.
   - `export function pagedSource(paths: unknown): PagedSource | null`: `null` unless `paths` is a non-array object with a `paginate` key. Otherwise it throws `$paths.paginate must be { "$ref": "#/state/<key>" }` unless `paginate.$ref` matches `^#/state/([^/]+)$` (the key is unescaped per RFC 6901, `~1` then `~0`), and throws `$paths.pageSize must be a positive integer` unless `Number.isInteger(pageSize) && pageSize >= 1`.
   - `export function pageCount(itemCount: number, pageSize: number): number`: `Math.max(1, Math.ceil(itemCount / pageSize))`.
   - `export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[]`.
   - `export function pageUrl(urlPattern: string, page: number): string`: for a pattern ending in `*`, page 1 drops the segment (`/blog/*` → `/blog`, `/*` → `/`) and later pages replace the `*`; otherwise the pattern's one `:name` is replaced by the number.
   - `export interface PagePagination { number; pageCount; pageSize; itemCount; first; prev; next; last; pages }`, typed as in Decisions, and `export function pagination(urlPattern: string, page: number, pageSize: number, itemCount: number): PagePagination`.
2. **`packages/site/src/context.ts`**: `SiteRoute` gains `pagination?: PagePagination`, and `injectContext` adds `...(route.pagination && { pagination: route.pagination })` to `$page`. The module doc lists `$page.pagination`.
3. **`packages/schema/defs/field-schema.schema.ts`**: `documentPathsCoreMembers` gains, before the legacy array, a closed member requiring `paginate` (a closed object whose `$ref` is a string matching `^#/state/[^/]+$`) and `pageSize` (`integer`, `minimum: 1`). Its description is "Paged list: one route per `pageSize` items of an entry of this page's own state, which must resolve to an array at build time. The page number fills the route's only parameter." The docblock says `paginate` is expanded by `expandDynamicRoutes` rather than `resolvePathEntries`, because it reads the page's state. `packages/schema/types.ts`: `JxPathsDef` gains `| { paginate: { $ref: string }; pageSize: number }`, and its docblock names the shape. Then run `bun run schema:sync`, which rewrites the core artifacts that embed the union (`packages/schema/schema.json`, `packages/schema/schemas/document.paths.schema.json`) and every `document.schema.json`.
4. **`packages/compiler/src/site/pages-discovery.ts`**:
   - `Route` gains `pagination?: PagePagination` and `pagedState?: { key: string; items: unknown[] }`. The latter is documented as "the page's slice, seeded into `state` before prototypes resolve".
   - `expandDynamicRoutes` gains a seventh parameter, `options: { errors?: string[] } = {}` (or the connector plan's, extended). A private `report(route, message)` pushes `` `Dynamic route ${route.urlPattern}: ${message}` `` to `options.errors` when there is one, and throws that text otherwise.
   - Before `resolvePathEntries`, `const paged = pagedSource(raw.$paths)`; a throw is reported and the route skipped. When it is non-null, the route's pages are expanded by a private `expandPagedRoute(route, raw, paged, ctx)` and the loop continues. That function:
     - reports and returns nothing unless `route.params.length === 1` ("a paged route takes exactly one parameter; this one declares N") and `raw.state?.[paged.key]` exists (`$paths.paginate names state entry "<key>", which this page does not declare`);
     - gets the list from `resolvePagedEntry` and reports a non-array (`state entry "<key>" did not resolve to an array at build time`);
     - otherwise pushes, for n = 1 … `pageCount`, `{ ...route, _pathParams: { [route.params[0]]: String(n) }, isCatchAll: false, isDynamic: false, params: [], urlPattern: pageUrl(route.urlPattern, n), pagination: pagination(route.urlPattern, n, size, items.length), pagedState: { key, items: pageSlice(items, n, size) }, ...(newest && { sourceMtime: newest }) }`. `newest` is the latest item `_meta.mtime` that parses with `Date.parse` to later than `statSync(route.sourcePath).mtime`, kept as the item's own string.
   - Private `resolvePagedEntry(raw, key, route, ctx)`: a literal array is returned as is. Otherwise it builds `{ imports, state: { [key]: structuredClone(def) } }`, where `imports` is `projectConfig.imports` (relative entries through `nodeImportRebaser(projectRoot)` from `./context-injection.ts`) under `raw.imports`. It calls `resolvePrototypes(mini, pageRoute, projectRoot, { config: projectConfig, registry, sections })` and returns `mini.state[key]`. `pageRoute` is a variable, `{ _pathParams: {}, locale, sourcePath: route.sourcePath, urlPattern: route.urlPattern }`, because the resolver's parameter type names only `sourcePath` and `_pathParams` and an object literal with more would fail the excess-property check; `locale` is what a locale-reading class sees in `_document.route`, and it is `localeOfRoute(route.urlPattern, i18n)`, which the existing call already computes. A class that throws is already downgraded to a warning by `resolvePrototypes`, which leaves the def in place, so the non-array report covers it.
5. **`packages/compiler/src/site/site-build.ts`**:
   - Step 4 passes `{ errors }` to `expandDynamicRoutes`.
   - `compilePage`'s route type is the compiler's own `SiteRoute` (`packages/compiler/src/types.ts`), whose index signature reads every extra key as `unknown`; it gains `pagination?: PagePagination` and `pagedState?: { key: string; items: unknown[] }`, so the seeding below is typed and the route still satisfies `@jxsuite/site/context`'s `SiteRoute` when it reaches `injectContext`.
   - In `compilePage`, immediately before `resolvePrototypes`, when `route.pagedState` is set and `layoutDoc.state` has its key, the key is replaced by `pagedState.items`. The comment says the entry was resolved once while the route was expanded.
   - The sitemap block needs nothing, since it already prefers `sourceMtime`. `injectContext` already receives the route.

**Slice 2: Studio.**

1. **`packages/studio/src/page-params.ts`**:
   - `loadParamValues(documentPath, pathsDef, page?: { state?; imports?; docBase? })`, the page's own `state` and `imports` and its base URL. For a paged source, the cache key adds `JSON.stringify(page?.state?.[key])`.
   - `resolveParamValues(pathsDef, documentPath, page)` tests `pagedSource` first; a throw returns `{}`. The parameter is `dynamicRouteParams(documentPath)[0]`, and without one the function returns `{}`. The list comes from `resolveStateEntry(page?.state?.[key], page?.imports, page?.docBase)`, and a non-array returns `{}`. The values are `"1"` … `String(pageCount(items.length, pageSize))`.
   - `resolveContentCollection` and `contentCollectionSrc` become the general `resolveStateEntry(def, imports?, docBase?)` and `classSrc(name, imports?)`. `resolveStateEntry` returns a literal array as is. For a `$prototype` object it takes `$src` from `def.$src ?? await classSrc(def.$prototype, imports)` and returns `null` when there is none, because `/__jx_resolve__` answers a body without `$src` with a 400 (`handleResolve` in `packages/server/src/resolve.ts`); otherwise it calls `platform.resolveClass({ ...def, $src, ...(docBase && { $base: docBase }) })`, or the existing `/__jx_resolve__` fetch fallback. It returns `null` for anything else. `classSrc` follows the build's lookup order (`imports[def.$prototype] ?? registryClassPath` in `resolvePrototypes`): the document's own `imports[name]` (a relative entry resolves against `$base`, as `handleResolve` rebases it), then the extensions payload's class path by name, then `@jxsuite/parser/ContentCollection.class.json` for `ContentCollection` only, else `null`. The `contentType` branch calls `resolveStateEntry({ $prototype: "ContentCollection", contentType })`.
   - `export async function applyPreviewPage(renderDoc, pathsDef, params, documentPath, docBase?)`: a no-op unless `pagedSource(pathsDef)` parses and the route has one parameter. The page is `Number.parseInt(params[param], 10)`, clamped to 1 … `pageCount`, and a value that is not a number is page 1. The list is `renderDoc.state[key]` when it is an array, else `await resolveStateEntry(renderDoc.state[key], renderDoc.imports, docBase)`; a rejection is caught and warned, as `resolveParamBoundState` does, and it and a non-array leave the entry alone. It sets `renderDoc.state[key] = pageSlice(...)` and `renderDoc.state.$page.pagination = pagination(documentUrlPattern(documentPath), page, pageSize, items.length)`, creating `$page` as `substitutePreviewParams` does when it is absent.
2. **`packages/studio/src/panels/pane-context.ts`** (`paramValuesFor`): passes `{ state, imports, docBase }` to `loadParamValues`, where `state` and `imports` come from `tab.doc.document`, else from `tab.doc.content.frontmatter`, and `docBase` is `new URL(tab.documentPath, documentBase(projectState?.projectRoot)).href`, the value `resolveCanvasDocument` computes (`documentBase` from `canvas/canvas-origin.ts`). It adds the paged entry to its own cache key for a paged source.
3. **`packages/studio/src/canvas/canvas-live-render.ts`**: inside the `previewParams` block, after `resolveParamBoundState`, `await applyPreviewPage(renderDoc, pagePathsDef({ document: doc, frontmatter: tab.doc.content.frontmatter }), previewParams, S.documentPath, docBase)`.

**Integration contract.** Once this lands:

- `@jxsuite/site/pagination` exports `pagedSource`, `pageCount`, `pageSlice`, `pageUrl`, `pagination` and `PagePagination`, and `SiteRoute.pagination` becomes `$page.pagination` in every `injectContext` caller.
- `expandDynamicRoutes` expands a `paginate` source into concrete, contiguous routes carrying `_pathParams`, `pagination`, `pagedState` and, when an item is newer than the template, `sourceMtime`. It reports misconfiguration into `options.errors`, and without that sink it throws.
- The core `$paths` union has four members.
- `resolveStateEntry(def, imports?, docBase?)` in `packages/studio/src/page-params.ts` resolves any state entry the canvas can bake, finding its class as the build does, and answers `null` rather than calling the backend when no class can be found.
- A later host that renders a paged route (the canvas through `injectContext`, a future live preview) gets the same pager by putting `pagination(...)` on the route it injects.

## Tests

Every suite runs as `bun test --isolate --coverage` from its workspace directory. Per-file thresholds (lines/functions, each workspace's `bunfig.toml`) are `packages/site` 0.99/1.0, `packages/schema` 0.99/0.99, `packages/compiler` 0.982/0.98 and `packages/studio` 0.958/0.941. Every new function and branch has a case below, and a workspace whose worst file rises is ratcheted. `pagination.ts` is the only new source file and ships with its suite, so `bun scripts/check-coverage-manifest.ts packages/site` stays green.

**Slice 1:**

- **`packages/site/tests/pagination.test.ts`** (new):
  - `pagedSource is null for every other shape` checks `values`, `$ref`, an array, `contentType`, `null` and a string.
  - `pagedSource reads the key and page size, unescaping the pointer` checks that `#/state/a~1b` gives `a/b`.
  - `pagedSource names the fault` covers a data-file `$ref`, `#/state/a/b`, and a `pageSize` of `0`, `2.5` or `"10"`, each throwing its sentence.
  - `pageCount is at least one` checks 0 → 1, 10 of 10 → 1, and 11 of 10 → 2.
  - `pageSlice returns the page's items and nothing past the end`.
  - `pageUrl puts a catch-all's first page at the list's own URL` checks `/blog/*` → `/blog` and `/blog/2`, `/*` → `/` and `/2`, and `/fr/blog/*` → `/fr/blog`.
  - `pageUrl numbers every page of a named parameter` checks that `/blog/:page` gives `/blog/1`.
  - `pagination links neighbours and marks the current page` checks page 2 of 3: `prev` is `/blog`, `next` is `/blog/3`, `first` and `last` are set, and `pages[1].current` is true. On page 1 `prev` is `null`, on page 3 `next` is `null`, and a single page has both `null`.
- **`packages/site/tests/context.test.ts`**:
  - `a paged route's pagination becomes $page.pagination`.
  - `an unpaged route has no pagination key`.
- **`packages/schema/tests/project-schemas.test.ts`**: `the core paths union carries the closed paginate source` checks `required`, the `$ref` pattern, the `pageSize` integer with minimum 1, and `additionalProperties: false` on both levels. `bun run schema:verify` proves the regenerated files.
- **`packages/compiler/tests/validate-command.test.ts`**: `PATHS_CASES`, which proves the union through `validateProjectTree` against a generated entry document, gains `core paged list` (`{ paginate: { $ref: "#/state/posts" }, pageSize: 10 }`, accepted) and three rejections: `paged list with pageSize 0`, `paged list over a data file` (`paginate: { $ref: "./data/p.json" }`) and `stray key beside paginate`.
- **`packages/compiler/tests/pages-discovery.test.ts`**, new `describe("paginate $paths")` on `_fixtures_pages`:
  - `pages a literal array into numbered routes, page 1 at a catch-all's root`: five items, `pageSize` 2 and `/blog/*` give `/blog`, `/blog/2` and `/blog/3`, with `_pathParams.page` of `"1"`, `"2"` and `"3"`, `pagedState.items` of 2, 2 and 1, and `pagination.next` of page 3 `null`.
  - `a named parameter numbers the first page`.
  - `an empty list still yields its first page`.
  - `a ContentCollection entry is paged with its own filter and sort`: with `extRegistry` and `sections.content` holding four entries, one with `draft: true`, an entry that filters `draft: false` and sorts by `order` descending gives two pages whose slices are in that order.
  - `a newer item dates the route` checks `sourceMtime` against `utimesSync` on the template.
  - `items without timestamps leave the route dated by its template`.
  - `each misconfiguration is a collected error and generates no pages` covers two parameters, a missing key, a non-array entry and `pageSize: 0`. Each message starts `Dynamic route /…:`, and the static route beside it survives.
  - `without an errors sink a misconfigured source throws`.
- **`packages/compiler/tests/site-build-pagination.test.ts`** (new, end to end). It mocks `sharp` as `site-build.test.ts` does, per CLAUDE.md. The temp project has `url`, `extensions: ["@jxsuite/parser"]`, `i18n` with `en` and `fr`, and a `posts` Markdown collection with five entries whose mtimes are set with `utimesSync`. `pages/blog/[...page].json` pages a `ContentCollection` sorted by `date` descending with `pageSize` 2 and renders `${item.data.title}` plus a next link from `${state.$page.pagination.next}`. There are also a `pages/fr/blog/[...page].json`, a `pages/blog/[slug].json` over the same collection, a `pages/count/[...page].json` paging an entry whose class is named by a relative project `imports` entry (`./classes/counter.class.json`, whose implementation counts `resolve()` calls on `globalThis` and returns five items), and a `pages/broken/[...page].json` with `pageSize: 0`.
  - `builds each page with its slice`: `dist/blog/index.html` has the two newest titles and `href="/blog/2"`, `dist/blog/3/index.html` has the oldest title only, and each post's `[slug]` page still builds beside them.
  - `the paged entry is resolved once for all its pages`: `/count`'s three pages build and the counter reads 1. Without the seeding in `compilePage` it reads 4, and the relative import proves the rebase in `resolvePagedEntry`.
  - `lists every page in the sitemap, dated by the newest entry`.
  - `pairs page N with page N across locales`: `/blog/2`'s `hreflang="fr"` alternate is `/fr/blog/2`.
  - `a misconfigured page fails the build and the site still builds`: `result.errors` has one entry, `Dynamic route /broken/*: $paths.pageSize must be a positive integer`, no `dist/broken/` is written, and `dist/index.html` exists.

**Slice 2**, `packages/studio`:

- **`tests/page-params.test.ts`**:
  - `a paginate source offers page numbers counted from a literal array`.
  - `a paginate source resolves a class entry through resolveClass, filling $src by name`.
  - `a class named by the page's own imports resolves with that $src and the page's $base`, and `a class with no $src anywhere offers nothing without calling resolveClass`.
  - `a malformed paginate source or a route with no parameter offers nothing`.
  - `the cache key follows the paged entry`: a changed filter re-resolves.
  - `applyPreviewPage slices the entry and sets $page.pagination as the build does`: its value equals `pagination(...)` from `@jxsuite/site/pagination` for the same inputs.
  - `applyPreviewPage clamps an out-of-range page, and a page that is not a number is page 1`.
  - `applyPreviewPage leaves the entry alone when its resolution rejects`, with a warning.
  - `applyPreviewPage leaves an unpaged document alone`.
  - The existing `contentType` cases pass through `resolveStateEntry` unchanged.
- **`tests/pane-context-params.test.ts`**: `a paged page re-enumerates when its paged entry changes`: editing the entry's `filter` in `tab.doc.document.state` loads the candidates again, and an unrelated state edit does not.
- **`tests/canvas-live-render.test.ts`**: `a paged page previews the chosen page's slice` uses `previewParams: { page: "2" }` and a literal-array entry, and asserts `renderDoc.state.posts` and `$page.pagination.number`, and that the tab's own `doc.state.posts` is untouched.

## Specs & docs

**Slice 1.** site-architecture.md, in place:

- §4.3's marker becomes:

  > **Status: Partial.** The four `$paths` shapes and the extension discriminator ship in the build (`expandDynamicRoutes` in `packages/compiler/src/site/pages-discovery.ts`, the page arithmetic in `packages/site/src/pagination.ts`, `Content.resolvePaths` in `extensions/parser/src/content-loader.ts`). Studio's route-parameter picker offers no values for a `paginate` source, and its canvas renders the paged entry whole (`packages/studio/src/page-params.ts`).

- The `$paths` shapes block gains `// A paged list: one page per pageSize items of a state entry` and `{ "paginate": { "$ref": "#/state/posts" }, "pageSize": 10 }`.
- After "The compiler iterates `$paths`…" comes a new paragraph block headed **Paging a list.** It carries the Decisions as rules:
  - the entry the source names must be in the page's own `state` and resolve to an array at build time;
  - the list is resolved once, and there are ⌈items ÷ `pageSize`⌉ pages, at least one;
  - each page is compiled with the entry replaced by its slice, so the entry's own filter, sort and `limit` decide what is paged;
  - the page number fills the route's only parameter, with a two-row table: `pages/blog/[...page].json` gives `/blog` and `/blog/2`, and `pages/blog/[page].json` gives `/blog/1` and `/blog/2`;
  - `$page.params.<name>` is the number as a string on every page;
  - `$page.pagination`'s fields, as in Decisions;
  - the misconfigurations that are build errors;
  - sitemap dating (§8.4.1) and locale pairing (§13.5);
  - "Paging happens where `$paths` is expanded. A host that composes a route by matching its pattern (the live preview, `composeRoute` in `packages/site/src/compose.ts`) renders the entry whole, with no `$page.pagination`."
- §4.5 item 2 gains ", and `$page.pagination` on a paged route (§4.3)".
- §8.4.1's **Dynamic routes** bullet gains: "A paged route (§4.3) is dated by the newest of its template and every item of the paged list that carries `_meta`, because one new or edited entry can move every page."
- §16's Sitemaps 0.9 evidence cell gains `packages/compiler/tests/site-build-pagination.test.ts`.
- Fragment: `bun run spec:change site-architecture.md minor -m "§4.3 a paginate source splits an array in the page's own state into numbered routes, the first at the list's own URL under a catch-all, each built with its slice and its pager values; §4.5 and §8.4.1 say so."` The sentence carries no `$`: inside double quotes the shell would expand `$page` to nothing.

extensions.md, in place: §5.3's paths row lists the core source shapes, and "(`values`, data-file `$ref`, legacy array)" becomes "(`values`, data-file `$ref`, a `paginate` list, legacy array)". `plan:extensions/connector-table-paths` rewrites the same row's tail, so whichever lands second keeps both edits. Fragment: `bun run spec:change extensions.md minor -m "§5.3 the core paths union gains the paginate source, which pages a list in the page's own state."`

Slice 1 docs (no em dashes), from `bun run docs:sync` over `pages-discovery.ts`, `site-build.ts` and `context.ts`:

- `docs/framework/site/routing.md`: `code:` gains `packages/site/src/pagination.ts`. A new `## Paging a list` section follows `## Generating pages with $paths`. It shows `pages/blog/[...page].json` paging a `ContentCollection`, the first-page table, a table of the fields of `$page.pagination`, a previous and next pager whose link binds `state.$page.pagination.next`, and a numbered pager over `#/state/$page/pagination/pages`. It then gives the one-parameter rule and the misconfigurations that fail the build, and adds: "Page 1 is `/blog` itself, so a directory with a paged `[...page].json` should not also have an `index.json`: both would build `/blog`." The sentence names no winner on purpose: today the later write wins, and `plan:site-architecture/route-specificity-order` makes the static page win with a warning. "Params at runtime" adds `pagination` to the `$page` list on a paged route.
- `docs/framework/site/content-collections.md`: after the `limit` bullet, "To split a long list across numbered pages, see [Paging a list](/docs/framework/site/routing#paging-a-list)."
- `docs/framework/site/seo.md`, the sitemap paragraph, adds: "A paged listing is dated by the newest of its template and every entry in the list, since one new post can move every page."
- `docs/framework/build.md` step 3 becomes "…produces one concrete route per entry, or one per page of a [paged list](/docs/framework/site/routing#paging-a-list)."
- Checked, with no change: `docs/framework/site/i18n.md` and `project-json.md` (`code:` `context.ts`); `layouts.md`; `redirects.md`, `deployment.md` and `docs/framework/concepts/color-schemes.md` (`code:` `site-build.ts`). `docs/extending/reference/standards.md` is generated.

**Slice 2.** site-architecture.md §4.3, in place:

- The marker becomes:

  > **Status: Implemented.** The four `$paths` shapes and the extension discriminator ship (`expandDynamicRoutes` in `packages/compiler/src/site/pages-discovery.ts`, the page arithmetic in `packages/site/src/pagination.ts`, `Content.resolvePaths` in `extensions/parser/src/content-loader.ts`), and Studio's picker and canvas page a paged route (`packages/studio/src/page-params.ts`).

- The "Paging happens where `$paths` is expanded" sentence names Studio: "…where `$paths` is expanded: the build, and Studio's canvas for the page chosen in its route-parameter picker."
- Fragment: `bun run spec:change site-architecture.md minor -m "§4.3 Studio's route-parameter picker offers a paged page's numbers and its canvas renders the chosen page's slice with its pagination."`
- Docs: `docs/framework/site/routing.md`'s closing Studio tip adds "On a paged page it lists the page numbers, and the canvas shows that page." Checked, with no change: `docs/studio/interface/tabs.md` and `modes.md`, which describe the picker generically, and `docs/studio/design/breakpoints.md`, `stylebook.md` and `components.md`, which `docs:sync` also names for `pane-context.ts`.

This closes §4.3 but does not graduate site-architecture.md, since other items stay open. Slice 2 deletes this file. No plan requires it, but four cite it (`plans/extensions/connector-table-paths.md`, `plans/site-architecture/route-pattern-validation.md`, `plans/site-architecture/route-specificity-order.md`, `plans/site-architecture/build-excludes-drafts.md`), and slice 2 rewrites each surviving citation to site-architecture.md §4.3 or to what now ships, or `plans:check` reports `citation-unknown`.

## Acceptance

- `bun test --isolate --coverage` passes in `packages/site`, `packages/schema` and `packages/compiler` (slice 1) and in `packages/studio` (slice 2), and `bun scripts/check-coverage-manifest.ts <workspace>` is green for each. `bun run typecheck` is green.
- `bun run schema:verify` is green, and `grep -c '"pageSize"' sites/jxsuite.com/document.schema.json` is non-zero.
- In a scratch site with `url`, the parser extension, a five-entry `posts` collection, and `pages/blog/[...page].json` paging it by 2:
  - `jx build` writes `dist/blog/index.html`, `dist/blog/2/index.html` and `dist/blog/3/index.html`, each with its own titles and pager links, and `dist/sitemap.xml` lists all three.
  - Changing `pageSize` to `0` makes `jx build` exit 1 with `Dynamic route /blog/*: $paths.pageSize must be a positive integer`, while `dist/index.html` is still written.
- In the dev-server Studio, that page's **resolving with** popover lists `1`, `2` and `3`, and choosing `2` shows the second slice with its pager.
- `bun run docs:status`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:standards`, `bun run docs:spec-release` and `bun run plans:check` are green, and after slice 2 `bun run plans:status --spec site-architecture` no longer lists `site-architecture.md#4.3`.

## Slices

| Slice | Scope                                                                                                                                                                                                                                  | Claims                   | State |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----- |
| CP1.1 | `@jxsuite/site/pagination`; `$page.pagination`; the core `paginate` schema member and `schema:sync`; paged expansion, errors and seeding in the compiler; §4.3 text with the marker kept Partial, §4.5, §8.4.1, extensions.md §5.3 row | —                        | open  |
| CP1.2 | Studio's picker and canvas page a paged route through `resolveStateEntry` and `applyPreviewPage`; §4.3 → Implemented                                                                                                                   | site-architecture.md#4.3 | open  |
