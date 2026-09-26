---
status: stub
disposition: implement
claims:
  - studio.md#4.1
size: M
workspaces:
  - packages/studio
  - packages/site
---

# The Studio canvas renders a page with the `$site`, `$page` and project `state` the build injects

## Context

`specs/studio.md` §4.1, line 162 (the section was unmarked before the census; the cross-spec review found the gap and the markers stage opened it):

> **Status: Partial.** The canvas renders through `@jxsuite/runtime` and applies the site's styles, custom properties, `$media` and `$head` (`packages/studio/src/site-context.ts`). It does not inject the page context the build injects (`injectContext` in `packages/site/src/context.ts`): it never supplies `$site` or merges project `state`, and supplies `$page` only for a page with route params, where `substitutePreviewParams` (`packages/studio/src/page-params.ts`) gives it `params`, `title` and `url` alone, so a binding on any of the rest renders differently in the canvas than in the build.

Disposition `implement`. §4.1 promises "no simulation or approximation", and §3.6 that "the canvas always shows what the file will look like in the context of the full site". The function that produces that context was made platform-free for this host: the header of `packages/site/src/context.ts` names "the studio's canvas" as a renderer that binds `${$site.name}` and `${$page.url}` exactly as a built page does, "so the injection lives here, with no platform imports". `@jxsuite/studio` already depends on `@jxsuite/site` (`site-style` and `routes`). A reconcile would write down that the canvas renders a site page without its site, which is what both sections exist to rule out.

This is also the enabling plan for three others. Each needs the canvas to compose a page the way the build does, and each requires this plan:

- `plan:imports/canvas-project-context` (imports.md §1.1 and §1.4) gets the one place project-level context joins the canvas's render document, and `injectContext`'s `ImportRebaser` parameter. Rebasing a relative project import onto the open document's directory then becomes a rebaser the canvas passes, not a second merge beside `getEffectiveImports`.
- `plan:studio/site-state-in-data-panel` (studio.md §3.6) gets its open decision answered: the canvas render resolves against project `state` through `injectContext`, as the build does. The iframe's `dataScope` snapshot then carries the project's entries and `$site`, which leaves that plan with the Data panel's listing.
- `plan:site-architecture/page-context-props` (site-architecture.md §5.5) gets the canvas as a third caller of the same function. Each property it adds to `injectContext` reaches the canvas with no canvas change, and its parity test gains the canvas as a case.

A ride-along this plan does not claim: §3.6's marker (line 142) ends with the same finding ("Nor does the canvas show a file in the context of the full site, as the closing sentence promises: … (§4.1)"). That sentence leaves §3.6's marker in this plan's spec edit. §3.6 stays with `plan:studio/site-state-in-data-panel`, which requires this plan and removes what is left of the marker once its own half lands.

**What exists**

- `injectContext` in `packages/site/src/context.ts`, covered by `packages/site/tests/context.test.ts`. It sets `state.$site` to the project `name` and `url`, `defaultLocale` and `locales` when `i18n` is given, and the project `state` spread flat. It sets `state.$page` to `params`, `title` (`doc.title`, else `_pageTitle`, else the project `name`), `url` (the route's `urlPattern`), and `alternates`, `locale` and `dir` when known. It copies each project `state` key into the page's `state` unless the page declares it, and merges project `$media`, `imports` (through an optional `ImportRebaser`) and `$elements` (a union, deduplicated by the raw string or `$ref`). It mutates the document it is given.
- Its callers. There are two, and the canvas is not one of them:
  - The build calls it through `injectContext` in `packages/compiler/src/site/context-injection.ts`, which supplies `nodeImportRebaser`. That wrapper is called from `compilePage` (`packages/compiler/src/site/site-build.ts`, line 1279) with the locale's `i18n` and translation set. The route is concrete: `expandDynamicRoutes` in `packages/compiler/src/site/pages-discovery.ts` substitutes each param into `urlPattern`.
  - `composePage` in `packages/site/src/compose.ts` (line 316) is the live-preview composer. `serveSite` (`packages/site/src/serve.ts`) runs it for `packages/server/src/live-preview.ts`, which the dev server and the desktop session (`packages/desktop/src/project-session.ts`) both host. It passes a `null` rebaser and no translation set.
  - The "cloud's preview origin" that the module header also names is a backend outside this repository: `buildSite` in `packages/studio/src/platforms/cloud.ts` posts to its `/build` route.
- The canvas composes the render document itself, in `resolveCanvasDocument` (`packages/studio/src/canvas/canvas-live-render.ts`):
  - It wraps a page in its layout with `resolveLayoutDoc` and `distributePageIntoLayout` (`packages/studio/src/site-context.ts`). That goes one level deep: a layout's own `$layout` is not followed, where `resolveLayout` in `packages/site/src/layout.ts` recurses. It carries over the page's `state`, `$media`, `style` and `attributes`. It does not carry the page's `title` (there is no `_pageTitle` carrier), `$head`, `imports` or `$elements`. `composePage` unions the page's and the layout's `$elements` for the same reason.
  - It then applies `getEffectiveElements`, `getEffectiveImports`, `getEffectiveMedia` and `getEffectiveHead` over `projectState.projectConfig`, and passes `siteStyle` separately. Nothing reads the project's `state` and nothing assigns `$site`. No `$site` token appears in `packages/studio/src`.
- `$page` comes only from `substitutePreviewParams` (`packages/studio/src/page-params.ts`, lines 240–259). `resolveCanvasDocument` calls it (line 229) only for a page with chosen `previewParams`, and it writes `{ params, title, url }`:
  - `title` is `doc.title` or `""`, with no project-`name` fallback. In a layout-wrapped render, `doc.title` is the layout's title.
  - `url` is the route pattern (`documentUrlPattern`, for example `/blog/:slug/`), where the build injects the concrete URL.
  - There is no `locale`, `dir` or `alternates`.
- Edit and design mode show a binding as its expression, not its value (`prepareForEditMode` in `packages/studio/src/utils/edit-display.ts`). So the difference shows on the artboard in preview mode. In every mode it shows in the iframe's `dataScope` snapshot (`tab.session.canvas.scope`, adopted in `packages/studio/src/canvas/iframe-host.ts`), which the Data panel and the expression previews (`packages/studio/src/services/preview-eval.ts`) read.
- What the canvas already shares with the build: `getEffectiveLocales` (`resolveI18n` from `@jxsuite/schema/locale`) and route derivation (`@jxsuite/site/routes`). What it does not share: `translationSets` in `packages/compiler/src/site/i18n.ts`. That file says its route-shaped half "has no Studio consumer, so it stays", and Studio cannot import the compiler.
- Two comments record the gap and go stale with this plan: `packages/studio/src/panels/pane-context.ts` (line 922, "the build's `$page.locale` is not injected into the canvas render today") and `packages/studio/src/canvas/canvas-utils.ts` (line 1311).
- Tests: `packages/studio/tests/canvas-live-render.test.ts`, `canvas-live-render-gaps.test.ts`, `page-params.test.ts`, `site-context.test.ts` and `site-context-gaps.test.ts`.

**What is missing**

- A call to `injectContext` (`@jxsuite/site/context`) in `resolveCanvasDocument`, for a page. It takes a `SiteRoute` built from the document path (the concrete URL once preview params are chosen, as the build's is), `getEffectiveLocales()` as `i18n`, and the route's translation set. `substitutePreviewParams` keeps the `#/$params/` substitution and stops writing `$page`.
- A render document that owns what `injectContext` writes to. The function assigns into `doc.state` and adds entries to `doc.imports` in place. In edit and design mode, the render document shares objects with the tab's source document: `stripEventHandlers` (`packages/studio/src/utils/strip-events.ts`) copies `state` but passes `imports` by reference. A direct call would write the project's imports into the open document, and a save would keep them. This is the purity rule `substitutePreviewParams` already states.
- One composition instead of two merges. Once the call exists, `getEffectiveImports`, `getEffectiveElements` and `getEffectiveMedia` stop being applied to the render document separately (the panels keep using them), and the project's `imports`, `$elements` and `$media` join the canvas by the build's rule.
- The layout wrap composing as the live preview does:
  - The page's `title` has to reach `injectContext`, so that `$page.title` is the page's own once `plan:site-architecture/page-context-props` fixes the build.
  - The page's own `$elements`, `imports` and `$head` have to survive the wrap.
  - Nested layouts have to resolve.
  - Either the canvas wraps through `resolveLayout` (`@jxsuite/site/layout`, loader-injected and platform-free) and `composePage`'s union, or `distributePageIntoLayout` grows the same carriers. The layout markers `markLayoutNodes` stamps must survive either way.
- Decisions for the detail phase:
  - What a document that is not a page receives. A layout opened on its own has no page, since the build only ever injects into a page wrapped in it. A component definition gets nothing from the build. A content entry opened as a standalone document is another case.
  - Whether `$page.locale` follows the route, as the build's does, or the pane's rendering language (`previewLocale`, studio.md §20.2). Today that language sets only the artboard's `lang` and `dir`, and `docs/studio/interface/languages.md` says it does not translate.
  - Where `$page.alternates` comes from. `translationSets` could move to `@jxsuite/site` or `@jxsuite/schema/locale`, which adds `packages/compiler` to the workspaces. Or the canvas omits `alternates`, as the live preview does today.
- Tests:
  - A canvas case for each injected property.
  - A parity case that composes one page both through the canvas path and through `injectContext` directly, and compares `state.$site` and `state.$page`.
  - A case showing that the tab's source document is unchanged after an edit-mode render.
- Specs and docs: remove §4.1's marker, and drop the canvas sentence from §3.6's marker. Check `docs/studio/interface/canvas.md`, which anchors §4.1, and the two comments above.

**Related**

- studio.md §3.6 (`plan:studio/site-state-in-data-panel`), studio.md §5.6 (the Data panel), and studio.md §20.2 (`plan:studio/locale-on-render`, the pane's rendering language).
- site-architecture.md §5.5 (`plan:site-architecture/page-context-props`, which requires this plan) and site-architecture.md §5.4 (`plan:site-architecture/nested-layout-head`, the nested-layout carrier).
- site-architecture.md §3.2 and §10.4 (`plan:site-architecture/site-state-scope`), which decide how site state is addressed. The canvas inherits whatever shape `injectContext` produces, so this plan does not require that one.
- imports.md §1.1 and §1.4 (`plan:imports/canvas-project-context`, which requires this plan).
- `plan:studio/canvas-modes-table` carries §4.1's editorial "tab bar" correction (the colour-scheme control is on the pane context bar), which the studio audit record assigned to it. That correction is not the open item.
- server.md §3.4 (the live site preview composes through `composePage`).
