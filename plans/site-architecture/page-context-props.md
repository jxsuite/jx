---
status: drafted
disposition: implement
claims:
  - site-architecture.md#5.5
requires:
  - site-architecture/locale-negotiation-gaps
  - site-architecture/site-state-scope
  - site-architecture/nested-layout-head
workspaces:
  - packages/site
  - packages/compiler
  - packages/studio
  - specs
  - docs
size: M
---

# A layout reads the page's own title, description and locale from `$page`, the same in the build and the live preview, and §5.5 lists only what is injected

## Context

`specs/site-architecture.md` §5.5, line 523:

> **Status: Partial.** `injectContext` (`packages/site/src/context.ts`) supplies `$page.title`, `url`, `params`, `locale`, `dir` and `alternates`, and `$site.name`, `url`, `locales` and `defaultLocale`. `$page.description`, `$page.$head`, `$page.frontmatter` and `$site.$head` are never injected, the `$site.state` row describes a nesting that does not exist (§10.4), and `$site.locales` puts the default first only when it was missing from `locales` (`resolveI18n` in `packages/schema/src/locale.ts`, §13.6). `$page.title` never comes from a `$head` title, and in a built page wrapped in a layout it is the layout's own `title`, else the project `name`, never the page's: `compilePage` in `packages/compiler/src/site/site-build.ts` deletes the page-title carrier (`_pageTitle`) before calling `injectContext`, where the canvas composer (`composePage` in `packages/site/src/compose.ts`) calls it first, so the canvas and the build disagree.

Verified at the current tree, with corrections:

- **The "canvas composer" is the live preview.** `composePage` is run by `serveSite` (`packages/site/src/serve.ts`) for server.md §3.4's live preview (Studio's Open in Browser). The Studio canvas never calls `injectContext`; that is studio.md §4.1's gap (`plan:studio/canvas-injects-context`, which requires this plan).
- **Title under a layout.** `resolveLayout` (`packages/site/src/layout.ts`) deep-clones the layout, so the merged document keeps the layout's own `title`, and records the page's as `_pageTitle`. `injectContext` reads `doc.title ?? doc._pageTitle ?? projectConfig.name ?? ""`. The build deletes the carrier first, so `$page.title` is the layout's `title`, else the project `name`. The live preview keeps the carrier, but `doc.title` still wins, so it is right only when the layout declares no `title`. No test binds `${$page.title}` in a layout.
- **Locale under a layout (not in the marker).** `injectContext` reads `$page.locale` from `doc.$lang`, and `resolveLayout` never copies the page's `$lang` onto the merged document, so a wrapped page's `$page.locale` is its layout's `$lang`, else the route's locale, while `<html lang>` reads the page's own (`pageLanguage` in `compilePage`, `lang` in `composePage`). §5.5's `$page.locale` row and §13.4 both say the page's `$lang` decides. `plan:studio/canvas-injects-context` records this as unowned; no shipped page declares `$lang`.
- **Templated titles.** Eight starter pages and jxsuite.com's docs page template their `title` (`packages/starters/sites/blog/pages/[slug].json`: `"${state.entry.data.title} — The Long Field"`). `compilePage` evaluates it (`evaluateStaticTemplate`) only for `<title>`, after `$page` was written, so a layout binding `$page.title` on such a page would render the template text.
- **Fallback.** With no project `name`, the build's `<title>` is `Jx Site` (`compilePage`'s `pageTitle ?? projectConfig.name ?? "Jx Site"`, the same default `mergeHead` has), the live preview's is empty (`composePage` passes `config.name ?? ""`), and `$page.title` is `""` while `$site.name` is `Jx Site`.
- **Live-preview route.** `composePage` passes the route pattern, so a dynamic page's `$page.url` is `/blog/:slug` or `/docs/*` where the build's is the concrete path (`expandDynamicRoutes` in `packages/compiler/src/site/pages-discovery.ts`, raw values). jxsuite.com's docs layout (`sites/jxsuite.com/layouts/docs.json`) computes its sidebar's `open` and `aria-current` from `state.$page.url`, so in the live preview no entry is ever current. The same pattern feeds `localeOfRoute` for both `$page.locale` and `<html lang>`, so a `pages/[lang]/…` page (§4.3's `values` shape) has no route locale there. A catch-all's parameter is keyed `*` (`matchRoute` in `packages/site/src/routes.ts`) where the build keys it by `$paths.param` (`pages/docs/[...slug].json` declares `param: "slug"`).
- **Nothing reads the unbuilt rows.** `git grep` finds `$page.$head`, `$page.frontmatter` and `$site.$head` only in §5.5. A layout already sees a content entry through the page's state, which `resolveLayout` merges over the layout's (`state.entry.data` in the blog starter), and head entries reach `<head>` through `mergeHead` (§8.3). No user doc ever listed them.
- **The `$page.alternates` row is stale.** Its shape omits `label`, which `injectContext` sets and §13.5 and `docs/framework/site/i18n.md` document.
- **Bare names (not in the marker).** `evaluateStaticTemplate` (`packages/compiler/src/shared.ts`) binds bare `$site` and `$page` for a template the build evaluates. The runtime's template evaluators (`packages/runtime/src/runtime.ts`, `new Function("state", "$map", "item", "index", …)`) bind only those four, as spec.md §6.6 states, and `compileClient` compiles templates into closures over `state`. So `${$page.title}` throws a ReferenceError in the live preview and in a hydrated binding, and `${state.$page.title}` works everywhere; jxsuite.com's layout uses the second.
- **What the live preview cannot compute.** `composePage` passes no translation set, so there is no `$page.alternates`, and it resolves no state before rendering, so a templated title reads as written (its `<title>` does too, since `renderHead` is static).

The `$site.state` row is rewritten with §10.4 item 1 by `plan:site-architecture/site-state-scope`, and the `$site.locales` row becomes true when `plan:site-architecture/locale-negotiation-gaps` makes `resolveI18n` always list `defaultLocale` first (its integration contract names this plan). `plan:site-architecture/nested-layout-head` narrows `_pageTitle` and `_pageHead` to the page's own values and leaves when the carriers go to this plan. §4.5's "alongside `$page.url` and `$page.title`" holds today; its title is wrong only under a layout, which this plan fixes.

## Outcome

- site-architecture.md §5.5 → Implemented. `$page` describes the page and never its layout: `$page.title` is the page's own title, the text its `<title>` shows, resolved in the build before any layout template reads it; `$page.description` is injected; `$page.locale` follows the page's own `$lang`. The live preview's `$page.title`, `description`, `url`, `params`, `locale`, `dir` and `$site` equal the build's for every page whose values need no state resolution, and the section states what a host composing one page on demand cannot supply. The `$page.$head`, `$page.frontmatter` and `$site.$head` rows are removed (Open below); the `$page.alternates` row gains `label`, and a `$page.params` row is added.
- §4.5's `$page.title` and §13.4's "after a document's own `$lang` has had its say" are right for layout-wrapped pages, with no edit.
- site-architecture.md stays Partial; nothing graduates.

## Decisions

- **Decided:** `injectContext` takes the page's facts as an explicit seventh argument, `page: PageFacts` (`{ title?, head?, lang? }`), read by a new `readPageFacts(pageDoc)` in `packages/site/src/layout.ts` from the page document itself, never from the layout-wrapped one, and no longer reads `doc.title`, `doc.$lang` or `_pageTitle` when facts are passed. The carrier's lifetime is exactly what made the two hosts disagree, and `plan:site-architecture/head-and-layout-shape-root-title` deletes `title` from the composed root after `injectContext`, which a `doc.title` read would silently stop seeing. The default, `readPageFacts(doc)`, is right for a page no layout wrapped, which is every direct call in the tests.
- **Decided:** `_pageTitle` and `_pageHead` are removed. After `plan:site-architecture/nested-layout-head` they hold exactly the page's own `title` and `$head`, which every host already holds as the page document, and after this plan nothing reads them. That plan left their removal to §5.5's owner.
- **Decided:** `$page.title` is the page's `<title>` text: both hosts compute `<title>` and `$page.title` from the same `facts.title`, falling back to `$site.name` (`Jx Site` with no project `name`), and the build writes its evaluated title into `$page` before resolving the page `$head`, the layout `$head` or the tree. One question gets one answer, and the alternative for the nine templated titles is template text in the layout. The live preview's empty-`<title>` fallback becomes `mergeHead`'s own, as in the build.
- **Decided:** `$page.description` is the `content` of the last `meta` entry whose `attributes.name` is `description` in the page's own head (the entry `mergeHead` keeps), absent when there is none, and resolved in the build before the layout `$head`. `attributes` is the only shape read, per `plan:site-architecture/head-and-layout-shape`. It is the page's own value, not the merged one, because a layout's `$head` is its main reader (`og:description` from `${$page.description}`), and a merged value would feed the layout's own entry back into itself.
- **Decided:** the live preview gives `injectContext` and its own `lang` the concrete URL, filled by a new `fillRoutePattern(urlPattern, params)` in `packages/site/src/routes.ts`: raw values, no trailing-slash policy, which is `expandDynamicRoutes`' substitution. `routeHref` is not reused because it percent-encodes and applies `build.trailingSlash`, which is a link's concern, not `$page.url`'s. A catch-all's `*` is renamed in `$page.params` to the page's `$paths.param`, the key the build uses, else to the bracket name (`route.params.at(-1)`), which the one shipped catch-all (jxsuite.com's docs page) also uses as its `$paths.param`.
- **Decided:** `requires` keeps `plan:site-architecture/locale-negotiation-gaps` (the `$site.locales` row), `plan:site-architecture/site-state-scope` (the `$site.state` row and the `$site` construction this plan edits) and `plan:site-architecture/nested-layout-head` (it narrows the carriers this plan removes, and decides whether an intermediate layout's `title` is a page-title fallback). `plan:studio/canvas-injects-context` requires this plan, so the canvas is wired once, against the final signature.
- **Open:** drop the three rows nothing reads? Recommendation: remove `$page.$head`, `$page.frontmatter` and `$site.$head` from the tables and say where that data is read instead. Head entries are already merged into `<head>` (§8.3) and have no meaning in a body. A content entry is already visible to the layout as `state.<key>.data`. `$page.frontmatter` is the one row that needs resolved state, so no on-demand host could ever supply it, and naming "the page's entry" needs a new rule (the `ContentEntry` whose `id` is `#/$params/<$paths.param>`). Neither row was in a user doc. The alternative, if a maintainer wants them: `$site.$head = projectConfig.$head ?? []` with `$head` added to `SITE_CONTEXT_KEYS` (`plan:site-architecture/site-state-scope`'s contract), `$page.$head = page.head ?? []` in `injectContext`, and in `compilePage`, after `resolvePrototypes`, `$page.frontmatter` set to that entry's `data` (build only).
- **Open:** which spelling does §5.5 promise, and what does it say of an on-demand host? Recommendation: §5.5 states that `${state.$page.…}` binds in every renderer while bare `$page` and `$site` bind only where the build evaluates a template, and that the live preview resolves no state and has no translation set, so a templated value reads as written and `$page.alternates` is absent. Binding bare names in the runtime and compiled client changes spec.md §6.6's scope and would be its own item; nothing shipped needs it, since every shipped layout writes `state.$page`.

## Implementation

1. **`packages/site/src/layout.ts`**
   - `export interface PageFacts { title?: string; head?: readonly JxHeadEntry[]; lang?: string }`, documented as "what a page says about itself, read from the page, never from the layout-wrapped document (site-architecture.md §5.5)".
   - `export function readPageFacts(pageDoc: JxDocument): PageFacts`: `title` when `pageDoc.title` is a string, `head` when `pageDoc.$head` is an array, `lang` when `pageDoc.$lang` is a string; keys omitted otherwise.
   - `resolveLayout`: delete the "Preserve page-level metadata" block that writes `_pageHead` and `_pageTitle`.
2. **`packages/site/src/context.ts`**
   - `export function pageDescription(head: readonly JxHeadEntry[]): string | undefined`: the `content` of the last entry with `tagName === "meta"` and `attributes.name === "description"` whose `content` is a string.
   - `injectContext(doc, projectConfig, route, rebaseImport = null, i18n = null, translations = [], page: PageFacts = readPageFacts(doc))`, importing both from `./layout.ts`. Hoist `const siteName = projectConfig.name ?? "Jx Site"`, used for `$site.name` and `$page.title = page.title ?? siteName`. `pageLang` becomes `page.lang ?? localeOfRoute(…) ?? projectConfig.defaults?.lang`. Spread `description` into `$page` only when `pageDescription(page.head ?? [])` is defined. Delete the `doc.title`, `doc._pageTitle` and `doc.$lang` reads.
   - The module header's property list becomes §5.5's two tables (`plan:site-architecture/site-state-scope`, a prerequisite, has already replaced its `$site.state.*` line), and states that page facts come from the caller.
3. **`packages/site/src/routes.ts`**: `export function fillRoutePattern(urlPattern: string, params: Readonly<Record<string, string>>): string`, which replaces each `:name` with `params[name]` and a trailing `*` with `params["*"]`, leaving a missing value as written. JSDoc contrasts it with `routeHref`.
4. **`packages/site/src/compose.ts`**, `composePage`:
   - `const facts = readPageFacts(pageDoc)` before `resolveLayout`, and `const url = fillRoutePattern(route.urlPattern, params)`.
   - `_pathParams`: `params`, except that when `route.isCatchAll` and `"*" in params`, `*` is renamed to `$paths.param` when `pageDoc.$paths` is an object (not the legacy array; `JxPathsDef` is a union, so narrow with `Array.isArray`) whose `param` is a string, else to `route.params.at(-1) ?? "*"`.
   - `siteRoute.urlPattern = url`; `injectContext(merged, config, siteRoute, null, i18n, [], facts)`.
   - `pageHead = [...(facts.head ?? [])]`; `lang = facts.lang ?? localeOfRoute(url, i18n) ?? config.defaults?.lang ?? "en"`; `mergeHead(..., { lang, ...(facts.title === undefined ? {} : { title: facts.title }), ...siteName })`, dropping `?? ""`. Delete the two carrier `delete` lines.
   - The module header gains a third "not done" item: no translation set and no state resolution, so `$page.alternates` is absent and a templated title reads as written (site-architecture.md §5.5).
5. **`packages/compiler/src/site/context-injection.ts`**: the wrapper takes `page?: PageFacts` (type from `@jxsuite/site/layout`) as its seventh parameter and passes it through.
6. **`packages/compiler/src/site/site-build.ts`**, `compilePage`:
   - Replace the `pageHead` and `pageTitle` reads with `const facts = readPageFacts(pageDoc)`, then `pageHead = [...(facts.head ?? [])]` and `pageTitle = facts.title ?? null`, and delete the two carrier `delete` lines. `pageLanguage` takes `pageLang: facts.lang`.
   - `injectContext(layoutDoc, projectConfig, route, projectRoot, locale.i18n, locale.translations, facts)`.
   - A local `settlePage(fields)` that `Object.assign`s into `layoutDoc.state.$page` and into `scope.$page` (a clone, per `buildInitialScope`). Call `settlePage({ title })` right after the title is evaluated. After `resolvedPageHead`, call `settlePage({ description })` when `pageDescription(resolvedPageHead)` is defined. Both calls come before `resolvedLayoutHead` and `resolveDocTemplates`, which already follow in that order. A client-tier page then ships the resolved values in `state.$page`.
7. **`packages/studio/src/panels/head-panel.ts`**: `resolveTitleField`'s docblock stops citing `layoutDoc._pageTitle`: "`compilePage` reads the page's own `title` (`readPageFacts`), never a layout's."

**Integration contract.** Once this lands: `@jxsuite/site/layout` exports `PageFacts` and `readPageFacts(pageDoc)` (one argument), and `resolveLayout` writes no `_pageTitle` or `_pageHead`. `@jxsuite/site/context` exports `pageDescription`, and `injectContext`'s seventh parameter is `PageFacts`: `$page.title` is `page.title ?? $site.name`, `$page.description` is present exactly when the page's head declares one, `$page.locale` starts from `page.lang`, and none of them reads the document's `title`, `$lang` or a carrier when facts are passed. `@jxsuite/site/routes` exports `fillRoutePattern`. The build's `$page.title` and `$page.description` are template-resolved before the layout `$head` and the tree are resolved. `plan:studio/canvas-injects-context` passes `readPageFacts` of the tab's source document merged over its frontmatter and a route filled by `fillRoutePattern`, and holds the canvas to the live preview in a parity test of its own in `packages/studio` (`packages/compiler` cannot load Studio's DOM harness), so that test and this plan's `page-context-parity.test.ts` together hold the canvas to the build. `plan:site-architecture/head-and-layout-shape-root-title` may delete `title` from the composed root anywhere after `readPageFacts` runs. `plan:site-architecture/project-defs-and-charset` adds `charset` to the same `mergeHead` context object in `composePage` that step 4 rewrites; whichever lands second keeps both.

## Tests

**`packages/site`** (`bun test --isolate --coverage` from `packages/site`):

- `tests/context.test.ts`: replace "uses _pageTitle as intermediate fallback" with:
  - `the page's facts decide the title, not the wrapped document`: `doc = { title: "Shell" }`, `page = { title: "About" }` gives `"About"`.
  - `a page with no title reads as the site name inside a titled layout`: `doc = { title: "Shell" }`, `page = {}` gives `"Test Site"`.
  - `with no project name the title matches $site.name`: both are `"Jx Site"`.
  - `the page's $lang decides $page.locale, not the wrapped document's`: `doc = { $lang: "de" }`, `page = { lang: "fr" }` gives `locale` `"fr"`.
  - `$page.description is the page's own description meta`, and `the last description entry wins, as in the merged head`.
  - `a page with no description carries no description key`: `"description" in $page` is false.
  - `without facts the document is read as the page`: `{ title: "T", $lang: "fr", $head: [description] }` with no seventh argument.
  - `describe("pageDescription")`: ignores a `link`, a `meta` with `property="description"`, and a non-string `content`.
- `tests/layout.test.ts`:
  - `describe("readPageFacts")`: `a page's title, head and lang are read`; `non-string title and lang and a non-array head are dropped` (no keys).
  - "the page's own head and title survive the merge, and $layout does not" becomes `the merged document carries no page carrier, and no $layout`: `_pageTitle`, `_pageHead`and`$layout`are undefined. The`_pageTitle`/`_pageHead`assertions`plan:site-architecture/nested-layout-head`adds are rewritten the same way, and a nested case asserts whatever it decided about an intermediate layout's`title`.
- `tests/compose.test.ts`:
  - `$page.title is the page's even when the layout declares its own`: layout `{ title: "Shell", tagName: "body", children: [slot] }`, page `title: "About"`, so `doc.state.$page.title` and the head `title` are both `"About"`.
  - `the page's description reaches $page under a layout`.
  - `a wrapped page's $lang sets $page.locale and the shell's lang alike`: page `$lang: "fr"` under a layout with `$lang: "de"`; `page.lang` and `doc.state.$page.locale` are both `"fr"`.
  - `a dynamic page's $page.url is the concrete path, as the build's is`: `composeRoute(io, routes, {}, "/blog/hello/")` over `pages/blog/[slug].json` gives `"/blog/hello"` and `params` `{ slug: "hello" }`.
  - `a catch-all's parameter is named as the build names it`: `pages/docs/[...path].json` with `$paths: { param: "rest", values: [] }` at `/docs/a/b` gives url `"/docs/a/b"` and `params` `{ rest: "a/b" }`; without `$paths`, `{ path: "a/b" }`.
  - `a [lang] route takes its locale from the filled URL`: i18n `{ defaultLocale: "en", locales: ["en", "fr"] }`, `pages/[lang]/index.json`, `composeRoute` at `/fr`: `page.lang` and `$page.locale` are `"fr"`.
  - `with no title and no project name the head's title is the site default`: the head `title` child is `"Jx Site"`.
- `tests/routes.test.ts`, `describe("fillRoutePattern")`: a static pattern is unchanged; `:slug` is filled; a trailing `*` takes `params["*"]`; a missing value stays as written; values are not percent-encoded (`"héllo"`).

Coverage: `packages/site/bunfig.toml` is `{ lines = 0.99, functions = 1.0 }`, so `readPageFacts`, `pageDescription` and `fillRoutePattern` each need a direct case (above), and the catch-all rename's two arms each have one. No source file is added, so `bun scripts/check-coverage-manifest.ts packages/site` is unaffected.

**`packages/compiler`** (`bun test --isolate --coverage` from `packages/compiler`):

- `tests/layout-resolver.test.ts`: "preserves page $head and title as _pageHead and _pageTitle" becomes `leaves no page carrier on the merged document`.
- `tests/site-build.test.ts`, new `describe("buildSite — $page in a layout")` with its own temp root (as "buildSite — locale routing" does). Project `{ name: "Ctx", defaults: { lang: "en" } }`, so every page has a locale; layout `layouts/base.json` `{ tagName: "div", title: "Shell", $lang: "de", $head: [{ tagName: "meta", attributes: { property: "og:description", content: "${$page.description ?? ''}" } }], children: [{ tagName: "p", attributes: { id: "t" }, textContent: "${$page.title}" }, { tagName: "p", attributes: { id: "l" }, textContent: "${$page.locale}" }, { tagName: "slot" }] }`:
  - `a layout binding $page.title shows the page's title, not the layout's`: `pages/about.json` with `title: "About"`, whose `dist/about/index.html` has `<p id="t">About</p>`.
  - `a templated title reaches the layout resolved`: `title: "${state.heading} | Blog"`, `state.heading: { default: "Hello", timing: "compiler" }`, giving `<p id="t">Hello | Blog</p>` and `<title>Hello | Blog</title>`, with no `${` in the file (the `?? ''` and `defaults.lang` keep an absent description or locale from leaving a template unresolved).
  - `the page's description feeds the layout's own $head`: the page's description meta `"About us"`, and the output's `og:description` has `content="About us"`.
  - `a page's own $lang is its $page.locale under a layout`: `$lang: "fr"` gives `<p id="l">fr</p>` and `lang="fr"` on `<html>`, and a page with none gives `<p id="l">en</p>`, not the layout's `de`.
  - `a page with no title reads the project name`: `<p id="t">Ctx</p>`.
- `tests/context-injection.test.ts` gains `passes page facts through`: the wrapper with `{ title: "P" }` gives `$page.title` `"P"`.
- New `tests/page-context-parity.test.ts`: one in-memory file map (project with `name` and `defaults.lang: "en"`; a layout with a `title` of its own rendering `state.$page.title`, `state.$page.description ?? ''`, `state.$page.url`, `state.$page.locale` and `state.$site.name` into `p` elements by id; `pages/about.json` with a title, a description and `$lang: "fr"`; `pages/blog/[slug].json` with `$paths: { values: ["hello"], param: "slug" }`; and `pages/docs/[...path].json` with `$paths: { values: ["a/b"], param: "path" }` rendering `state.$page.params.path` in its own `p`) is written to a temp root for `buildSite` and wrapped in a `SiteIO` for `composeRoute` (`@jxsuite/site/compose`). `the live preview's $page and $site agree with the build`: for `/about`, `/blog/hello` and `/docs/a/b`, each `p`'s text in the built HTML equals the matching field of the composed `doc.state.$page` or `$site`. The canvas is held to the live preview by `plan:studio/canvas-injects-context`'s own parity test in `packages/studio`, not as a case here.

Coverage: `packages/compiler/bunfig.toml` is `{ lines = 0.982, functions = 0.98 }`; `settlePage` is covered by the new build cases. **`packages/studio`** changes one docblock and needs no case. Ratchet a threshold only if the run shows a workspace's worst file rose. The new test file needs no manifest entry, and `packages/compiler` already depends on `@jxsuite/site`, so `affected.ts` needs no `EXTRA_EDGES` entry.

## Specs & docs

**`specs/site-architecture.md` §5.5**, in place (the `$site.state` and `$site.locales` rows as the two required plans left them, and a `$page.pagination` row kept where `plan:site-architecture/collection-pagination` has already added it):

- Marker: "> **Status: Implemented.** `injectContext` (`packages/site/src/context.ts`) writes both objects for the build (`compilePage` in `packages/compiler/src/site/site-build.ts`) and the live preview (`composePage` in `packages/site/src/compose.ts`) from the page's own facts (`readPageFacts` in `packages/site/src/layout.ts`), never from the layout-wrapped document."
- `$page` table:
  - `$page.title`: Source "The page's `title` (§8.1), else `$site.name`", Description "Page title, as its `<title>` shows it". If `plan:site-architecture/nested-layout-head` kept an intermediate layout's `title` as a fallback, the Source names it between the two.
  - `$page.description`: Source "The `content` of the page's own `<meta name="description">` `$head` entry", Description "Meta description; absent when the page declares none".
  - `$page.url`: Source "Computed from file path, with a dynamic route's parameters filled in", Description "Page URL path, e.g. `/blog/hello`".
  - A new `$page.params` row after it: Source "The route's parameters (§4.5)", Description "`{ name: value }`".
  - `$page.locale`: Source "The page's own `$lang`, else the route's locale, else the site default (§13.4)".
  - `$page.alternates`: Description "`{code, label, url, dir, current}[]`".
  - `$page.$head` and `$page.frontmatter` rows deleted (per the Open above).
- `$site` table: `$site.$head` row deleted.
- After the `$page` table: "`$page` describes the page, never the layout around it: a layout's own `title` or `$lang` changes neither `$page.title` nor `$page.locale`. The build resolves a templated `title` or description against the page's state before any template of the layout reads it, so `$page.title` is the text the page's `<title>` shows and `$page.description` is what its description meta carries (§8.2)."
- After the `$site` table: "Head entries are not context: the site's, the layout's and the page's `$head` reach `<head>` through the merge (§8.3). A content page's entry is not either: a layout reads it through the page's own state entry (`state.post.data` in §4.3's example), because a page's `state` is merged over its layout's when it is wrapped."
- Then: "Both objects are state entries, so `${state.$page.title}` binds wherever a page renders; the bare `${$page.title}` resolves only in a template the build evaluates (§8.2), since the interpreting runtime and a hydrated binding see `state` alone (spec.md §6.6). A host that composes one page on demand instead of building the site, the live preview (server.md §3.4), resolves no state and knows no translation set before it renders, so there a templated title or description reads as written and `$page.alternates` is absent."

**Fragment:** `bun run spec:change site-architecture.md minor -m "§5.5: \$page describes the page and never its layout, so \$page.title is the page's own title as its title element shows it, resolved in the build, \$page.description carries the page's description meta and \$page.locale follows the page's own \$lang; the live preview gives a dynamic page its concrete URL and named parameters; the \$page.\$head, \$page.frontmatter and \$site.\$head rows are dropped because nothing reads them"`. If the rows Open goes the other way, the last clause becomes "and \$page.\$head, \$page.frontmatter and \$site.\$head are injected". Minor: an implement, and the dropped rows were never in a user doc, so their removal counts as never documented as working.

**Docs** (no em dashes). `bun run docs:sync` names `docs/framework/site/project-json.md` and `docs/framework/site/i18n.md` (`code:` `context.ts`, `context-injection.ts`), `docs/framework/site/layouts.md` (`code:` `layout.ts`, `layout-resolver.ts`; `spec:` `site-architecture.md#5`), and the pages listing `site-build.ts` (`build.md`, `seo.md`, `deployment.md`, `redirects.md`, `concepts/color-schemes.md`). No page lists `compose.ts`, `routes.ts` or `head-panel.ts`'s title docblock.

- `docs/framework/site/layouts.md`: add `packages/site/src/context.ts` to `code:`. Replace "Layouts also receive the compiler-injected contexts: `$page` (`title`, `url`, `params`) and `$site` (`name`, `url`, plus site state). See [project.json](/docs/framework/site/project-json)." with: "Layouts also receive the injected contexts: `$page` (`title`, `description`, `url`, `params`, `locale`, `dir`, `alternates`) and `$site` (`name`, `url`, `locales`, `defaultLocale`, plus site state; see [project.json](/docs/framework/site/project-json)). `$page` always describes the page, not the layout: `${state.$page.title}` is the page's own title, the text its `<title>` shows, even when the layout declares a `title` of its own, and `$page.locale` follows the page's `$lang`, not the layout's. Write `state.$page` in a layout: the bare `$page` works only where the build evaluates the template, and **Open in Browser** renders in the reader's browser."
- `docs/framework/site/seo.md`: line 58 gains a sentence: "A layout's `$head` can read the page's own `${state.$page.title}` and `${state.$page.description}`, already resolved, so one `og:title` and `og:description` entry in the layout serves every page."
- `docs/framework/site/i18n.md`: the example becomes `"Reading in ${state.$page.locale}"`. After "That is the whole switcher…", add a `:::doc-note`: "**Open in Browser** composes one page at a time without building the site, so there a page has no `$page.alternates` and the switcher is empty. Build the site and run `jx preview` to check it."
- `docs/framework/build/dev-server.md` ("The live site preview", `spec:` `server.md#3.4`; not named by `docs:sync`): after the first paragraph add: "A page there gets the same `$page` and `$site` a build gives it, with two exceptions the preview cannot compute without building the whole site: `$page.alternates` is absent, and a `title` or description written as a template shows as written."
- `project-json.md`, `build.md` (its `${state.$page.title}` example becomes true under a layout as written), `deployment.md`, `redirects.md` and `concepts/color-schemes.md`: no change.

No spec graduates and `plans/site-architecture/` stays. Landing deletes this file and removes it from `plan:studio/canvas-injects-context`'s `requires`.

## Acceptance

- `bun test --isolate --coverage` passes from `packages/site`, `packages/compiler` and `packages/studio` with no per-file threshold failure; `bun scripts/check-coverage-manifest.ts <dir>` passes for each.
- A scratch project whose layout declares `"title": "Shell"` and renders `${$page.title}` and `${$page.locale}`, wrapping a page titled `About` with `"$lang": "fr"`, built with `bunx jx build`, shows `About` and `fr` in the layout's text and `About` in `<title>`. Opened through Studio's Open in Browser, the same layout rendering `${state.$page.title}` shows `About` too.
- `bun -e 'import { fillRoutePattern as f } from "./packages/site/src/routes.ts"; console.log(f("/blog/:slug", { slug: "hello" }), f("/docs/*", { "*": "a/b" }))'` prints `/blog/hello /docs/a/b`.
- `git grep -n "_pageTitle\|_pageHead" -- packages` prints nothing.
- `sed -n '/^### 5.5 /,/^## 6\. /p' specs/site-architecture.md` shows `> **Status: Implemented.**` and no `$page.$head`, `$page.frontmatter` or `$site.$head` row; `bun run plans:status --spec site-architecture` no longer lists `site-architecture.md#5.5`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
