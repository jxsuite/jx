---
status: stub
disposition: implement
claims:
  - site-architecture.md#3
  - site-architecture.md#5.1
  - site-architecture.md#5.2
  - site-architecture.md#8.1
  - site-architecture.md#8.2
  - site-architecture.md#8.3
  - site-architecture.md#8.5
workspaces:
  - packages/compiler
  - packages/site
size: M
---

# Every layout and `$head` example is written in the shape the build reads, and a page's `title` stays off its root element

## Context

`specs/site-architecture.md` §3, line 147:

> **Status: Partial.** `project.json` is the one required configuration file and its keys are read as §3.1 records. The example's `$head` is not in the shape the build reads: an entry's HTML attributes come only from `attributes` (`renderHeadEntry` in `packages/site/src/head-merger.ts`), so the top-level `name`, `content`, `rel` and `href` below are dropped, and the icon and font entries render as bare `<link>` tags.

§5.1, line 377:

> **Status: Partial.** Slot distribution ships (`distributeSlots` in `packages/site/src/layout.ts`). The example's shape does not: a layout is body content wrapped by the page shell (`packages/compiler/src/targets/compile-static.ts`), so an `html` root nests inside `<body>`, head material comes from the layout's `$head` rather than `<head>` children in its tree, and `$page.lang` is never set (§5.5 names it `$page.locale`).

§5.2, line 415:

> **Status: Partial.** `$layout`, its project-root resolution, the `defaults.layout` fallback and `$layout: false` ship (`resolveLayout` in `packages/site/src/layout.ts`, `packages/compiler/src/site/layout-resolver.ts`). The example's `$head` is not in the shape the build reads, as in §8.1: its `title` entry is discarded, because the title is the document's `title` property, and its top-level `name` and `content` are dropped.

§8.1, line 921:

> **Status: Partial.** Page-level `$head` ships (`mergeHead` in `packages/site/src/head-merger.ts`), but not in this example's shape: an entry's HTML attributes are read only from `attributes`, so the top-level `name`, `property`, `content`, `rel` and `href` below are dropped, and a `title` entry is discarded because the title comes from the document's `title` property. `docs/framework/site/seo.md` documents the shipped shape. On a page with no layout that property also stays on the root element, which ships as `<div title="Blog">`, a tooltip over the whole page: only `resolveLayout` (`packages/site/src/layout.ts`) moves a page's `title` off its root, and `title` is not in `RESERVED_KEYS` (`packages/runtime/src/runtime.ts`), so `buildAttrs` in `packages/compiler/src/shared.ts` and the runtime both write it as the element's `title`.

§8.2, line 962:

> **Status: Partial.** `$head` values resolve against state, `$site` and `$page` (`resolveHeadTemplates` in `packages/compiler/src/site/site-build.ts`). The example diverges as §8.1's does: its templated `title` entry is discarded, since a templated title is the document's `title` property, and its top-level `name`, `content`, `rel` and `href` are never rendered.

§8.3, line 991:

> **Status: Partial.** The three layers merge in this order under the stated deduplication, auto-injected entries yield to authored ones, and the `rel` check ships (`mergeHead` and `headEntryKey` in `packages/site/src/head-merger.ts`, `packages/compiler/src/site/link-relations.ts`). Two statements do not match: the layout level is the layout document's `$head`, not `<head>` children in its tree, and a `<title>` in `$head` at any level is discarded rather than overriding, because `mergeHead` always writes the title from the document's `title` property.

§8.5, line 1040:

> **Status: Partial.** Object `textContent` serialization with templates resolved ships in the build and the interpreting runtime (`renderHeadEntry` in `packages/site/src/head-merger.ts`, `injectHead` in `packages/runtime/src/runtime.ts`). The example's shape does not: its `type` sits at the top level of the entry, where both read only `attributes`, so the block renders as a bare `<script>` that a browser runs as JavaScript instead of reading as JSON-LD. `packages/site/tests/head-merger.test.ts` pins the working form, `attributes: { "type": "application/ld+json" }`.

§5.1, §8.1 and §8.2 were unmarked before the census; §3, §5.2 and §8.3 were unmarked and first recorded as verified, with their examples as ride-alongs here, until review applied the same rule to all six; §8.5 led with `Implemented`, and its serialization rationale is kept as a continuation paragraph under the new marker. §8.1's last sentence, on the root element, was appended by the cross-spec review of the census, which found it in a scratch build; no other section records it. They are one piece of work: the spec's examples predate the shipped authoring shape for head material, which is a `$head` array of `{ tagName, attributes }` entries plus a top-level `title`, with a layout being body content rather than a whole `<html>` document. One plan owns the seven anchors because one decision (that shape) rewrites all of them, and the root-title defect is that same decision's one code consequence: the top-level `title` is the page-title carrier, and on a page with no layout nothing takes it off the root.

Disposition `implement`, because one part of §8.1 is a code defect rather than stale text. Everything else is a reconcile, and was this plan's whole disposition until the review: the code, the user docs (`docs/framework/site/seo.md`, `docs/framework/site/layouts.md`) and Studio agree with each other and not with the spec. `seoWarnings` in `packages/studio/src/panels/head-panel.ts` already reports `head-title-ignored` ("A `<title>` element in `$head` is discarded"), `packages/site/tests/head-merger.test.ts` pins "the resolved page title outranks a `<title>` any level authored", and the real layouts (`sites/jxsuite.com/layouts/base.json`, `sites/test-blank/layouts/base.json`) are rooted at a `div`. The root title is not something the spec could be rewritten to: no section says a page's root carries its title as an HTML attribute, and the rule every rewritten example will state, that the page title is the document's `title` property, is only safe to write once that property stops doubling as the root's tooltip. `implement` still ends every claim at `Implemented`, as a reconcile would have for the paper anchors. The halves stay in one plan rather than being split by disposition because they rest on that one decision and the code half is small; the detail phase may still move §8.1 into its own `implement` plan if it wants the other six anchors to land in the detailing pull request, as paper plans may.

The alternative the detail phase should weigh and reject explicitly: honouring reflected top-level properties (`name`, `content`, `rel`, `href`, `type`) in `renderHeadEntry` and the runtime's `injectHead`, which Appendix B's "standard element definitions" row could be read to promise. The §8.5 case is the costliest form of the divergence, since a dropped `type` turns data into script, so the detail phase may want a build warning for a top-level attribute-like key on a head entry whichever way it decides.

**What exists**

- `renderHeadEntry` and `headEntryKey` in `packages/site/src/head-merger.ts`, which read only `entry.attributes`; `mergeHead`, which always writes the title key last from the resolved title (`context.title ?? context.siteName ?? "Jx Site"`); the runtime's `injectHead` (`packages/runtime/src/runtime.ts`), which reads the same shape.
- `compilePage` in `packages/compiler/src/site/site-build.ts`: the title is `pageDoc.title`, else the `_pageTitle` carrier, else the project `name`, else "Jx Site"; the layout level of the merge is the layout document's `$head`.
- `resolveLayout` and `distributeSlots` in `packages/site/src/layout.ts`, and the page shell in `packages/compiler/src/targets/compile-static.ts`.
- The root title on a page with no layout. `resolveLayout` returns the page document itself when there is no `$layout` and no `defaults.layout`, or when `$layout` is `false` (its `if (!layoutRef)` branch); only the wrapped branch copies `title` to `_pageTitle` onto a clone of the layout, which `compilePage` reads and deletes. A layout-less page's root therefore keeps `title`, which is not in `RESERVED_KEYS`: `buildAttrs` in `packages/compiler/src/shared.ts` writes it as ` title="…"`, and the runtime's `applyProperties` sets it through `bindProperty` as the element's `title`. A scratch `buildSite` of a page `{ "title": "Plain", "children": [ … ] }` with no layout emitted `<title>Plain</title>` and `<div title="Plain">` (the root defaults to `div`, spec.md §3.1); the same page under an untitled layout emitted no root `title`. The live-preview composer, `composePage` in `packages/site/src/compose.ts`, never deletes the page's `title` either.
- Every site and starter in the repository sets `defaults.layout` (`sites/*/project.json`, `packages/starters/sites/*/project.json`), which is why nothing shipped shows the tooltip: it takes a project with no default layout or a page with `$layout: false`.
- `injectContext` (`packages/site/src/context.ts`) reads `$page.title` from `doc.title` before `doc._pageTitle`, so on a layout-less page the root's `title` is what gives `$page.title` its value today.

**What is missing**

- §3's, §5.2's, §8.1's, §8.2's and §8.5's examples rewritten to the `attributes` form, with a top-level (templated, in §8.2) `title` where the example wants one.
- §5.1's example rewritten as body content with its head material in `$head`, and its `$page.lang` binding replaced by `$page.locale` (or dropped, since §13.4 writes `<html lang>` itself).
- §8.3's layout level stated as the layout's `$head`, and its "If both site and page define a `<title>`, the page's wins" replaced by the rule that ships: the title is the document's `title` property, and a `<title>` entry in any `$head` is discarded (and warned about in Studio).
- A page's `title` taken off the rendered root when the page has no layout, in the build (`compilePage`) and the live preview (`composePage`), without costing `$page.title` its value: either removed after `injectContext` has read it, or handed to `injectContext` explicitly. Not by adding `title` to `RESERVED_KEYS`, which would strip the tooltip from every ordinary element that sets one. Tests: a site-build case for a `$layout: false` page pinning its `<title>`, no root `title` and an unchanged `${$page.title}`, and the same for the live preview. The Studio canvas renders a layout-less page through the same runtime (`packages/studio/src/canvas/canvas-live-render.ts` wraps a document only when `getEffectiveLayoutPath` finds a layout), so the detail phase checks whether it shows the tooltip too and adds `packages/studio` if it does.
- §8.1's root-element sentence dropped from its marker once the fix lands.

**Related**

- site-architecture.md §5.5, whose `$page.title` source column states the same title rule and is rewritten by that section's own plan, `plan:site-architecture/page-context-props`. That plan edits the same lines (`compilePage`'s `pageTitle`, and the order of the `_pageTitle` deletion and `injectContext` in `compilePage` and `composePage`) and may make `injectContext` take the page title explicitly; whichever lands second rebases onto the other. No `requires` edge: the root-title fix needs only a test that `$page.title` survives it, not that plan's change.
- site-architecture.md §5.4, whose nested-layout head merge is a separate implement plan, `plan:site-architecture/nested-layout-head`. A layout's own `title` reaches the root the same way: a scratch build of a page `{ "title": "Home" }` under a layout `{ "tagName": "div", "title": "Layout T", … }` emitted `<title>Home</title>` beside `<div title="Layout T">`, because the merged document is a clone of the layout. No marker records it. What a layout's `title` means is the decision that plan takes for an intermediate layout, and the detail phase should settle the outermost layout's in the same breath.
- spec.md, for the element-definition rule that top-level keys are DOM properties and `attributes` are HTML attributes, which is why `title` on a root is a tooltip. spec.md §3.1's root field table (`plan:spec/root-tagname-optional`) lists no `title`: the page-title meaning of a root `title` is this spec's §8.1 contract, not the core format's.
