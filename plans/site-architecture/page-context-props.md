---
status: stub
disposition: implement
claims:
  - site-architecture.md#5.5
requires:
  - site-architecture/locale-negotiation-gaps
  - site-architecture/site-state-scope
  - site-architecture/nested-layout-head
  - studio/canvas-injects-context
size: M
workspaces:
  - packages/site
  - packages/compiler
---

# `$page` and `$site` carry every property §5.5 lists

## Context

`specs/site-architecture.md` §5.5, line 523:

> **Status: Partial.** `injectContext` (`packages/site/src/context.ts`) supplies `$page.title`, `url`, `params`, `locale`, `dir` and `alternates`, and `$site.name`, `url`, `locales` and `defaultLocale`. `$page.description`, `$page.$head`, `$page.frontmatter` and `$site.$head` are never injected, the `$site.state` row describes a nesting that does not exist (§10.4), and `$site.locales` puts the default first only when it was missing from `locales` (`resolveI18n` in `packages/schema/src/locale.ts`, §13.6). `$page.title` never comes from a `$head` title, and in a built page wrapped in a layout it is the layout's own `title`, else the project `name`, never the page's: `compilePage` in `packages/compiler/src/site/site-build.ts` deletes the page-title carrier (`_pageTitle`) before calling `injectContext`, where the canvas composer (`composePage` in `packages/site/src/compose.ts`) calls it first, so the canvas and the build disagree.

The section was unmarked before the census. Disposition `implement` for the four missing properties, which the roadmap's "`$page` and `$site` context injection" row counted as done, and for `$page.title` under a layout, which a review found by tracing `compilePage`: `resolveLayout` stores the page title only as `_pageTitle` on the merged layout document, `compilePage` reads it into its own `pageTitle` and deletes it, and `injectContext` then finds only the layout's `title` or the project `name`. No compiler test binds `${$page.title}` in a layout. The detail phase may instead remove a row that nothing needs (for example `$page.$head`, which a layout already receives through the head merge), which would make that part a `remove`.

Two parts of §5.5 are reconciles inside this plan. The `$page.title` source column: a `$head` title is discarded by design, the rule site-architecture.md §8.1 and §8.3 record, so the column becomes "the page's `title` property, else the project `name`". The `$site.state` row: it is the same contract as §10.4 item 1, whose shape `plan:site-architecture/site-state-scope` decides and whose rewrite of this row it carries, so this plan requires it and closes §5.5 only after it lands. The `$site.locales` row ("default first") is false when `defaultLocale` is declared after another locale, and making `resolveI18n` always put the default first is one of the two fixes `plan:site-architecture/locale-negotiation-gaps` weighs for `*`; this plan requires that one too, and makes the row true itself only if that plan fixes `*` the other way.

The marker's "canvas composer (`composePage` in `packages/site/src/compose.ts`)" is the live-preview composer, not the Studio canvas. `serveSite` (`packages/site/src/serve.ts`) runs it for the live preview that `packages/server/src/live-preview.ts` serves to the dev server and the desktop session. So the disagreement it names is between the build and the live preview. The Studio canvas never calls `injectContext`: it has no `$site`, and it has a `$page` only for a page with chosen route params. That gap is studio.md §4.1's, and `plan:studio/canvas-injects-context` closes it. This plan requires that one, so the canvas is a caller by the time this plan's properties land, and they reach it with no canvas change. The marker's wording is corrected when this plan rewrites §5.5.

**What exists**

- `injectContext` in `packages/site/src/context.ts`, with `packages/site/tests/context.test.ts`. In this repository it has two callers:
  - The build calls it through `injectContext` in `packages/compiler/src/site/context-injection.ts`, which adds `nodeImportRebaser`, from `compilePage`.
  - `composePage` in `packages/site/src/compose.ts` calls it for the live preview.
  - The Studio canvas does not call it (`plan:studio/canvas-injects-context`). The cloud preview origin named in the module's header is a backend outside this repository.
- `compilePage` in `packages/compiler/src/site/site-build.ts`, which already holds the page title (`pageTitle`), the page's resolved `$head` (`pageHead`) and the project `$head` where it calls `injectContext`; `composePage` in `packages/site/src/compose.ts`, the live-preview twin, which calls `injectContext` before deleting `_pageTitle`.
- Content entries' frontmatter on `ContentEntry` (`extensions/parser/src/content.ts`), for the `$page.frontmatter` row.

**What is missing**

- `$page.title` equal to the page's `title` in a built page with a layout. The live preview has it only when the layout declares no `title` of its own: `injectContext` reads `doc.title` before `_pageTitle`, and on the merged document `doc.title` is the layout's. Either `compilePage` deletes `_pageTitle` after `injectContext` and the lookup order changes, or `injectContext` takes the page title explicitly, so that no caller depends on the carrier's lifetime. A site-build test that binds `${$page.title}` in a layout, and one that pins build and live-preview parity.
- `$page.description` (from the page's `description` meta), `$page.$head` (the page's own entries), `$page.frontmatter` (for a page generated from a content entry: which entry, when a page declares several `ContentEntry` states, is a decision) and `$site.$head`.
- Parity between the callers of `injectContext`, so a live-preview page and a built page agree. `composePage` passes no translation set, so the live preview has no `$page.alternates`. Its route comes from `routeTable` and `matchRoute` (`packages/site/src/routes.ts`), so a dynamic page's `$page.url` is the pattern (`/blog/:slug/`) where the build's is the concrete URL (`expandDynamicRoutes` in `packages/compiler/src/site/pages-discovery.ts`). The Studio canvas joins as a third caller through `plan:studio/canvas-injects-context`, and the parity test covers it once it has.
- Tests per property, and the docs page that lists the context (`docs/framework/site/layouts.md`).
- Ride-along: §4.5's "alongside `$page.url` and `$page.title`" becomes true for layout-wrapped pages with the title fix.

**Related**

- site-architecture.md §10.4 (site state access) and site-architecture.md §5.1 (the layout example that binds `$page.lang`).
- site-architecture.md §5.4 (`plan:site-architecture/nested-layout-head`, required): a nested layout's `title` reaches `_pageTitle` through the same carrier, the two plans edit the same lines of `layout.ts` and `site-build.ts`, and that plan decides what an intermediate layout's title means.
- studio.md §4.1 (`plan:studio/canvas-injects-context`, required): the Studio canvas composes through `injectContext`.
- site-architecture.md §13.4 (`$page.locale`, `$page.dir`) and site-architecture.md §13.5 (`$page.alternates`), which ship.
