---
status: drafted
disposition: implement
claims:
  - site-architecture.md#8.1
requires:
  - site-architecture/head-and-layout-shape
workspaces:
  - packages/site
  - packages/compiler
  - packages/studio
size: M
---

# A page's `title` never renders on its root element, and §8.1 states the head-entry shape the build reads

## Context

`specs/site-architecture.md` §8.1, line 921:

> **Status: Partial.** Page-level `$head` ships (`mergeHead` in `packages/site/src/head-merger.ts`), but not in this example's shape: an entry's HTML attributes are read only from `attributes`, so the top-level `name`, `property`, `content`, `rel` and `href` below are dropped, and a `title` entry is discarded because the title comes from the document's `title` property. `docs/framework/site/seo.md` documents the shipped shape. On a page with no layout that property also stays on the root element, which ships as `<div title="Blog">`, a tooltip over the whole page: only `resolveLayout` (`packages/site/src/layout.ts`) moves a page's `title` off its root, and `title` is not in `RESERVED_KEYS` (`packages/runtime/src/runtime.ts`), so `buildAttrs` in `packages/compiler/src/shared.ts` and the runtime both write it as the element's `title`.

The section was unmarked before the census. Its example is the same divergence `plan:site-architecture/head-and-layout-shape` reconciles for §3, §5.1, §5.2, §8.2, §8.3 and §8.5. The census planned all seven anchors together; this detail splits §8.1 out because it alone has a code half. Verified at the audited tree:

- **The root keeps the page's `title` when no layout wraps it.** `resolveLayout` returns the page document itself when there is no `$layout` and no `defaults.layout`, or when `$layout` is `false`. Only its wrapping branch copies `title` to `_pageTitle`, on a clone of the layout. `compilePage` (`packages/compiler/src/site/site-build.ts`) passes that root to `compile`, where `buildAttrs` writes ` title="…"`; a dynamic page's root goes through the runtime's `applyProperties`, which sets `el.title`. A scratch `buildSite` of `{ "title": "Plain", "children": [{ "tagName": "h1", "textContent": "${$page.title}" }] }` with no layout emitted `<title>Plain</title>`, `<div title="Plain">` and `<h1>Plain</h1>`.
- **A layout's own `title` reaches the root the same way.** The merged document is a clone of the outermost layout, so its root keeps the layout's `title`. A scratch build of a page `{ "title": "Wrapped" }` under `{ "tagName": "div", "title": "Layout T", … }` emitted `<title>Wrapped</title>` beside `<div title="Layout T">`. No shipped layout declares a `title` (`sites/*/layouts/`, `packages/starters/sites/*/layouts/`).
- **The live preview and the Studio canvas do the same.** `composePage` (`packages/site/src/compose.ts`, run by `serveSite` for the live preview) never deletes `merged.title`. `resolveCanvasDocument` (`packages/studio/src/canvas/canvas-live-render.ts`) renders a page with no layout, and every page while the tab's "show layout elements" toggle is off, from a copy of the page document with `title` intact. It renders a wrapped page from `distributePageIntoLayout` (`packages/studio/src/site-context.ts`), which keeps the layout's `title`. `prepareForEditMode` keeps `title`. The iframe renders with the runtime's `applyProperties`, so the canvas shows the tooltip. A root property edit escalates to a full render (`replaceVerdict` in `packages/studio/src/canvas/canvas-patcher.ts` returns `replace-root`), so every render passes through `resolveCanvasDocument`.
- **`$page.title` depends on the root's `title` today.** `injectContext` (`packages/site/src/context.ts`) reads `doc.title ?? doc._pageTitle ?? projectConfig.name`. On a page with no layout the root's `title` is what gives `$page.title` its value, so the fix must read the title before removing it.
- **Why nothing shipped shows it.** Every `project.json` under `sites/` and `packages/starters/sites/` sets `defaults.layout`, and no page sets `$layout: false`.
- **The flat shape fails silently.** `renderHeadEntry` reads only `tagName`, `attributes`, `textContent` and `children`, so `{ "tagName": "meta", "name": "description", "content": "flat" }` renders as a bare `<meta>`. A `<title>` entry is overwritten by `mergeHead`'s title key. Neither is reported by the build. Studio's `seoWarnings` (`packages/studio/src/panels/head-panel.ts`) reports only the `<title>` entry (`head-title-ignored`). `unregisteredHeadRelations` checks `attributes.rel`, so a misspelled flat `rel` is not checked either.

## Outcome

- site-architecture.md §8.1 → Implemented (marker deleted). The example uses `attributes` and a top-level `title`, and two paragraphs state the entry shape and the title rule.
- No composed document's root carries a top-level `title` in `jx build`, the live preview (`composePage`) or the Studio canvas (`resolveCanvasDocument`), for a page with or without a layout, or for a layout opened on its own. `<title>` and `$page.title` keep their current values, and an `attributes.title` on a root still renders.
- The build warns once per distinct problem when a `$head` holds a top-level key it does not render or a `<title>` entry (Open below).
- site-architecture.md keeps other open items and does not graduate.

## Decisions

- **Decided:** remove `title` from the composed root in each host, after the title has been read: in `compilePage` right after `injectContext`, in `composePage` in its closing `delete` block, and in `resolveCanvasDocument` on the render copy. Two other places were weighed. Adding `title` to `RESERVED_KEYS` would strip the tooltip from every element that sets one, which spec.md §8.1 makes an ordinary DOM property. Moving the page's `title` in `resolveLayout`'s no-layout branch would change the object that branch returns, which `compilePage` and `composePage` also hold as `pageDoc`. It would also move `$page.title`'s source, which is `plan:site-architecture/page-context-props`'s change to `injectContext`, and `plan:site-architecture/nested-layout-head` rewrites `resolveLayout` itself. The host deletion changes neither function.
- **Decided:** the Studio canvas is in scope. It renders the same root through the same runtime, and a tooltip the canvas shows but the build does not would put the two back in disagreement.
- **Decided:** no `requires` edge on `plan:site-architecture/page-context-props` or `plan:site-architecture/nested-layout-head`. Both edit the lines around this plan's deletions, and whichever lands second rebases. The deletion needs only a test that `$page.title` survives it, not either plan's change.
- **Decided:** require `plan:site-architecture/head-and-layout-shape`. site-architecture.md §8.1's new text cites §8.3's rule that a `<title>` entry is discarded, which that plan writes. Both plans also edit `docs/framework/site/seo.md`.
- **Decided:** the deletion covers whatever `title` the composed root carries, a layout's included. A layout's root is the page's root, so a layout's `title` there is the same whole-page tooltip. No shipped layout sets one, and a root tooltip is written under `attributes`. This settles rendering only. What a layout's `title` contributes to `<title>` and `$page.title` is the Open question in `plan:site-architecture/nested-layout-head`. Neither answer it weighs (the layout's `title` means nothing, or it is a fallback page title) makes it a tooltip, and that plan's own draft also deletes the outermost layout's `title` inside `resolveLayout`. The two deletions overlap harmlessly: this one also covers the layout-less page, whose root `resolveLayout` returns untouched, and the Studio canvas, which composes through `distributePageIntoLayout` rather than `resolveLayout`.
- **Open:** should the build warn about head material it does not render? Recommendation: yes, a warning and never an error, once per distinct message across the build, as the `rel` check does (site-architecture.md §8.3). Warn on a top-level key other than `tagName`, `attributes`, `textContent`, `children` or a `$`-prefixed annotation, and on a `<title>` entry. The flat shape was the spec's own example for months, so authors and generators have it. Its worst case, a JSON-LD block with a flat `type`, turns data into a script that throws, and today nothing reports any of it. If the answer is no, drop Implementation steps 1 and 3b, the warning tests, and the warning clauses in Specs & docs.

## Implementation

1. **`packages/site/src/head-merger.ts`.** Beside `renderHeadEntry`, add `const RENDERED_HEAD_KEYS = new Set(["tagName", "attributes", "textContent", "children"])`, documented as the keys `renderHeadEntry` reads. Add and export `headEntryShapeWarnings(entries: readonly unknown[]): string[]`. It returns distinct sentences and skips any entry that is not a non-null object.
   - A `tagName === "title"` entry yields `$head: a <title> entry is discarded. The page title is the document's "title" property (site-architecture.md §8.1).` Its other keys are not examined, because the whole entry is discarded.
   - Otherwise, each own key not in `RENDERED_HEAD_KEYS` and not starting with `$` yields `$head: <${tagName}> has a top-level "${key}", which is not rendered. A head element's HTML attributes go under "attributes" (site-architecture.md §8.1).`
2. **`packages/site/src/compose.ts`, `composePage`.** Add `delete merged.title;` to the closing block that deletes `$head`, `_pageHead` and `_pageTitle`. It must come after `const title = pageDoc.title ?? …`: without a layout, `merged` is `pageDoc`, so an earlier deletion would turn every such page's `<title>` into the project name. `injectContext` has already run by then. The comment cites site-architecture.md §8.1.
3. **`packages/compiler/src/site/site-build.ts`.**
   - a. **`compilePage`.** Directly after `injectContext(layoutDoc, …)`, add `delete layoutDoc.title;`. `pageTitle` was read above it, and nothing after it reads `pageDoc.title`, which is the same object when no layout applies. The comment names both readers it follows and cites site-architecture.md §8.1.
   - b. **The warning.** In `compilePage`, compute `headShapeWarnings: headEntryShapeWarnings([...(projectConfig.$head ?? []), ...layoutHead, ...pageHead])` over the authored, unresolved arrays. Extension, manifest and service-worker entries are generated, not authored, so they are left out. Return it beside `unregisteredRelations`, and import the function from `@jxsuite/site/head-merger` beside `mergeHead`. In `buildSite`'s route loop, add a `warnedHeadShapes` set next to `warnedRelations`, and `console.warn` each message the first time it appears.
4. **`packages/studio/src/canvas/canvas-live-render.ts`, `resolveCanvasDocument`.** Move the `isLayoutDoc` computation above the layout-wrap block. After that block, and before `substitutePreviewParams`, add `if (isPage || isLayoutDoc) { delete renderDoc.title; }`. `renderDoc` is always a copy at that point (`structuredClone`, `prepareForEditMode`'s new object, or a layout from `resolveLayoutDoc`'s `structuredClone`), so the tab's document keeps its `title`. A component definition's root `title` is left alone: it is the component's tooltip.
5. **Spec, docs and fragment**, as given in Specs & docs.
6. **Landing**: delete this file and remove its id from any dependent's `requires`. Then re-read `plan:site-architecture/page-context-props` and `plan:site-architecture/nested-layout-head`, which edit the same lines, against the contract below.

**Integration contract.** Once this lands:

- No composed root carries a top-level `title`: not `compilePage`'s `layoutDoc` after `injectContext`, not `ComposedPage.doc`, and not Studio's `renderDoc` for a page or a layout document. Code that needs the page title reads it before the deletion. Today that is `compilePage`'s `pageTitle`, `composePage`'s `title` and `injectContext`'s `$page.title`. `plan:site-architecture/page-context-props` may move `$page.title`'s source, or pass the title to `injectContext` explicitly, provided both hosts still run it before the deletion. `plan:studio/canvas-injects-context` places the canvas's `injectContext` call before step 4's deletion for the same reason.
- `resolveLayout` and `injectContext` are unchanged, so `plan:site-architecture/nested-layout-head` may restructure `_pageTitle` and `_pageHead` freely, and its `delete merged.title` in `resolveLayout` may land before or after this plan. Neither deletion makes the other redundant.
- `@jxsuite/site/head-merger` exports `headEntryShapeWarnings`. Studio's Search appearance modal may reuse it, for example `plan:site-architecture/seo-structured-data-editor` when it reads authored entries.
- site-architecture.md §8.1 is the normative statement of the head-entry shape and of the page title, and §8.3 says the build warns about a `<title>` entry.

## Tests

Each suite runs as `bun test --isolate --coverage` from its workspace directory.

- **`packages/site`**
  - `tests/head-merger.test.ts`, new `describe("headEntryShapeWarnings (§8.1)")`:
    - "names each top-level attribute-like key once, with its tag": two flat `meta` entries sharing `name` and `content` yield exactly two sentences.
    - "a flat type on a JSON-LD script is named": the site-architecture.md §8.5 trap.
    - "a title entry is named as discarded, and its own keys are not": `{ tagName: "title", textContent: "x", lang: "en" }` yields the title sentence only.
    - "the rendered shape, annotations, strings and malformed entries say nothing": `attributes`, an object `textContent`, `$description`, a raw string and `null` yield `[]`.
  - `tests/compose.test.ts`:
    - "a page with no layout keeps its title off the root, and $page.title keeps it": `{ tagName: "main", title: "Hello" }` gives `page.doc.title === undefined`, `page.doc.state.$page.title === "Hello"`, and a merged head whose title entry reads Hello.
    - "a layout's own title never reaches the composed root": a page titled "Home" under `{ tagName: "div", title: "Layout T", children: [{ tagName: "slot" }] }` gives `page.doc.title === undefined` and head title "Home".
- **`packages/compiler`**
  - `tests/site-build.test.ts`, new `describe("buildSite — a page's title stays off its root element (§8.1)")`. The project has no `defaults.layout`, and four pages:
    - `index.json`: no `$layout`, `title: "Plain"`, an `h1` bound to `${$page.title}`.
    - `off.json`: `$layout: false`, `title: "Off"`.
    - `wrapped.json`: `$layout` naming `layouts/titled.json`, which is `{ tagName: "div", title: "Layout T", children: [{ tagName: "slot" }] }`, and `title: "Home"`.
    - `tip.json`: `title: "Tip page"` and root `attributes: { title: "Tip" }`.

    Four cases:
    - "a page with no layout: title and $page.title keep it, the root does not": `<title>Plain</title>` and `<h1>Plain</h1>` are present, and `title="Plain"` is absent.
    - "$layout: false behaves the same": `title="Off"` is absent from `off/index.html`.
    - "a layout's own title never renders on the root": `<title>Home</title>` is present, and `title="Layout T"` is absent.
    - "an attributes title is still the root's tooltip": `title="Tip"` is present.

  - Same file, new `describe("head entry shape warnings")`, built like "link relation warnings" (two pages sharing the site `$head`, `console.warn` captured):
    - "warns once for a flat key in the site head, however many pages carry it".
    - "warns once for a title entry".
    - "says nothing about a head in the rendered shape".
- **`packages/studio`**
  - `tests/canvas-live-render.test.ts`, in `describe("resolveCanvasDocument")`. Use `resetStudioState({ isSiteProject: true, projectConfig: {} })` and `installMockPlatform` serving a copy of the file's `LAYOUT` with a `title` added:
    - "a page's title never reaches the render root, and the tab's document keeps it": `pages/home.json` with no layout, in design and in preview mode.
    - "with the layout shown or hidden, the root carries no title": the wrapped page, and the same page with `showLayout = false`.
    - "a layout opened on its own renders without its title": `documentPath: "layouts/base.json"`.
    - "a component's title stays its tooltip": `components/x-card.json` keeps `renderDoc.title`.
- **Coverage.** Thresholds are `lines = 0.99, functions = 1.0` in `packages/site/bunfig.toml`, `0.982 / 0.98` in `packages/compiler/bunfig.toml` and `0.958 / 0.941` in `packages/studio/bunfig.toml`. `headEntryShapeWarnings` is a new function in an existing file, and the site threshold requires every function covered, so each branch has a case above. No new source file is added, so the manifest check is unaffected. Raise a threshold only if a workspace's worst file rises.

## Specs & docs

**`specs/site-architecture.md` §8.1**, in place:

- Delete the marker (line 921) and the blank line after it.
- "Pages declare metadata via `$head`. The compiler resolves these into `<head>` elements:" becomes "Pages declare their title as a top-level `title`, and the rest of their metadata via `$head`. The compiler resolves these into `<head>` elements:".
- The example becomes `"title": "My Blog Post — My Site"` followed by a `$head` holding seven entries, each with its keys under `attributes`: the description, `og:title`, `og:description`, `og:image` and `og:type` metas, the `twitter:card` meta, and the canonical `link`. The values are unchanged, and the `<title>` entry is gone.
- After the example, add two paragraphs:
  - "**An entry is an element with attributes.** Each `$head` entry is `{ tagName, attributes, textContent?, children? }`, and its HTML attributes go under `attributes`, as on any element (`spec.md` §8.3). A head entry is written into the page as markup, never created and assigned properties, so a key at the top level of an entry is not an attribute and is not rendered: `{ "tagName": "meta", "name": "description" }` ships as a bare `<meta>`. The build warns about such a key, once per tag and key across the build."
  - "**The title is a property, not an entry.** A page's title is its top-level `title`, from which the build writes `<title>` (§8.4). It is page metadata and never the root element's `title` attribute, whether the root is the page's own (`$layout: false`, or no default layout) or its layout's. A tooltip over the root is written `"attributes": { "title": … }`. A `<title>` entry in `$head` is discarded (§8.3), and the build warns about it."

**§8.3**, in place (the section is `Implemented` by then): "Studio's Search appearance modal reports one (§8.6)." becomes "The build warns about one, and Studio's Search appearance modal reports it (§8.6)."

**Fragment:** `bun run spec:change site-architecture.md minor -m "A page's title property is never rendered as its root element's title attribute, with or without a layout, and the build warns once about a head entry key it does not render: a top-level attribute-like key, or a title entry."` Level minor, for an implement. Drop the warning clause if that decision goes the other way.

**Docs** (no em dashes):

- **`docs/framework/site/seo.md`** (`spec:` `site-architecture.md#8`; `code:` lists head-merger.ts and site-build.ts). Under "Page-level `$head`", after the sentence ending "a literal `<title>` in `$head` is overridden.", add: "The `title` property is the page title and nothing else. It never becomes a `title` attribute on the page's root element, with or without a layout, and neither does a layout's own `title`, so neither adds a tooltip; write one under `attributes` if you want it. An entry's HTML attributes must sit under `attributes` too. A key at the top level, such as `"name": "description"`, is not rendered, and the build prints one warning for it however many pages carry it."
- **`docs/framework/site/layouts.md`** (`spec:` `site-architecture.md#5`): no change. What a layout's `title` means is documented there by `plan:site-architecture/nested-layout-head`.
- `bun run docs:sync` also names the pages whose `code:` lists `site-build.ts`: `docs/framework/build.md`, `docs/framework/site/redirects.md`, `docs/framework/site/deployment.md` and `docs/framework/concepts/color-schemes.md`. Checked: none describes the root element's attributes or the head warnings, so none changes. No page lists `compose.ts` or `canvas-live-render.ts`.

## Acceptance

- `bun run plans:check --audit site-architecture` reports nothing for §8.1, and `bun run docs:status && bun run docs:spec-release && bun run docs:check && bun run docs:links && bun run docs:prose` pass.
- The four suites named in Tests pass under `bun test --isolate --coverage` in `packages/site`, `packages/compiler` and `packages/studio`, with every per-file threshold held. Then `bun scripts/check-coverage-manifest.ts packages/site` passes, and the same for `packages/compiler` and `packages/studio`.
- In a scratch project with no `defaults.layout` and a page `{ "title": "Plain", "children": [{ "tagName": "h1", "textContent": "${$page.title}" }] }`, `jx build` emits `<title>Plain</title>` and `<h1>Plain</h1>`, and `grep -c 'title="Plain"' dist/index.html` prints `0`.
- In the same project, a `$head` entry `{ "tagName": "meta", "name": "description" }` in `project.json` makes `jx build` print the "has a top-level "name"" warning exactly once.
- No `$head` example left in the spec has a top-level key the build does not render. This prints nothing:

  ````sh
  bun -e 'const t=await Bun.file("specs/site-architecture.md").text();for(const m of t.matchAll(/```json\n([\s\S]*?)```/g)){let d;try{d=JSON.parse(m[1])}catch{continue}for(const e of d.$head??[])for(const k of Object.keys(e))if(!["tagName","attributes","textContent","children"].includes(k))console.log(e.tagName,k)}'
  ````
