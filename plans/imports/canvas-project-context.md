---
status: stub
disposition: implement
claims:
  - imports.md#1.1
  - imports.md#1.4
requires:
  - studio/canvas-injects-context
  - _shared/component-discovery
size: M
workspaces:
  - packages/studio
  - packages/site
---

# The studio canvas applies project-level `imports` and `$elements` from the document's own directory and discovers project components by the composer's rule

## Context

`specs/imports.md` §1.1, line 16:

> **Status: Partial.** The build meets it: `injectContext` (`packages/site/src/context.ts`) merges project `imports` under the page's, and `nodeImportRebaser` (`packages/compiler/src/site/context-injection.ts`) rewrites a relative project entry onto the page's directory. The studio canvas does not rebase: `getEffectiveImports` (`packages/studio/src/site-context.ts`) merges project `imports` unchanged, and the canvas resolves each `$src` against the open document's own URL (`docBase` in `packages/studio/src/canvas/canvas-live-render.ts`), so a relative project import resolves against the wrong directory in any document outside the project root.

`specs/imports.md` §1.4, line 69 (the markers stage corrected the census's "a superset … harmless" sentence to the build half quoted here):

> **Status: Partial.** The union and dedup ship in `injectContext` (`packages/site/src/context.ts`). `discoverElements` in `packages/site/src/compose.ts` meets the rule: it matches `components/<tag>.json`, walks transitively and dedups by resolved path. `injectComponentScripts` in `packages/compiler/src/site/site-build.ts` scans the rendered HTML for every component the build compiled, and that set is not a superset of the effective one: it is only the files directly in `components/` (any component format, any file name, keyed by `tagName`) plus their own `$elements` dependencies, because `buildSite` lists that directory non-recursively and never reads a page's or layout's `{ "$ref" }` entry, so a declared component anywhere else (`components/nested/deep-card.json`, a co-located `pages/blog/_blog-card.json`) ships as an empty tag with no module and no build error. The studio canvas (`packages/studio/src/canvas/canvas-live-render.ts`) does not meet it: it merges project-level `$elements` without rebasing their `$ref`s onto the document's directory (`getEffectiveElements` in `packages/studio/src/site-context.ts`), discovers only in content mode, for a layout-wrapped page or for a document under `layouts/`, never opens the components it finds, matches tags against the whole component registry rather than `components/<tag>.json`, and dedups declared entries by their raw `$ref` string.

Both sections were unmarked before the census. One stub owns both because they share a root cause and a decision: the canvas applies project-level context written relative to the project root as though it were written relative to the open document, and rebasing `$elements` is the precondition for the resolved-path dedup §1.4 asks for. Disposition `implement`: the rule is stated once, the live-preview composer (`composePage` in `packages/site/src/compose.ts`) keeps it, and `discoverElements`' own doc comment records that the canvas walk is not transitive.

Two parts of what this stub first held now belong to other plans, and it requires both:

- **The call that brings project context into the canvas** is `plan:studio/canvas-injects-context`'s. That plan makes the canvas compose through `injectContext` in place of applying `getEffectiveImports` and `getEffectiveElements` to the render document. This plan builds on that call. A relative project import is rebased by an `ImportRebaser` the canvas passes to `injectContext`, the same hook the build fills with `nodeImportRebaser`, not by a second merge. That plan also carries a page's own `imports` and `$elements` through a layout wrap, which the canvas's `distributePageIntoLayout` drops today.
- **The build half of §1.4's marker** (declared components outside `components/` ship as empty tags) is `plan:_shared/component-discovery`'s. §1.4 cannot flip until both have landed, so this plan requires that one and closes §1.4 after it.

**What exists**

- `injectContext` in `packages/site/src/context.ts` (project `imports` merged under the page's, project and page `$elements` unioned and deduplicated by string or `$ref`), covered by `packages/site/tests/context.test.ts`. Its `ImportRebaser` parameter is how a host with real directories rebases; the build passes `nodeImportRebaser` (`packages/compiler/src/site/context-injection.ts`), and the live-preview composer passes `null` because it serves the project at a root where the authored path already resolves. The Studio canvas does not call it.
- The canvas's own merge: `getEffectiveImports` and `getEffectiveElements` in `packages/studio/src/site-context.ts`, which take no document path and return project entries as written. `canvas-live-render.ts` assigns both to the render document and sets `docBase` from `S.documentPath`; `packages/studio/src/canvas/iframe-render.ts` resolves each `$ref` as `new URL($ref, docBase)` and hands `docBase` to `buildScope`, whose Pass 0 and `resolveClassJson` (`packages/runtime/src/runtime.ts`) fetch `$src` against it. `packages/ui/project.json` declares `{ "$ref": "./components/jx-icon.json" }`, which the canvas resolves under `components/components/` for an open component and under `pages/components/` for a page, and which fails with only a console warning.
- `discoverElements` in `packages/site/src/compose.ts`: `COMPONENT_FILE` matches `components/<tag>.json`, the walk opens each discovered definition once, and declared entries are compared by the path they resolve to; covered by the "component auto-discovery" cases in `packages/site/tests/compose.test.ts`.
- `injectComponentScripts` in `packages/compiler/src/site/site-build.ts`. It covers every file directly in `components/` (a non-recursive listing) with `.json` or a component format's extension, plus those files' own `$elements` dependencies, keyed by `tagName`. It never reads a page's or layout's `{ "$ref" }` entry. That gap is `plan:_shared/component-discovery`'s.
- The canvas discovery block in `packages/studio/src/canvas/canvas-live-render.ts` (the "Component auto-discovery" comment): gated on `S.mode === "content" || layoutWrapped || isLayoutDoc`; `collectTags` walks only the render document's `children` arrays; each tag is looked up in `componentRegistry` (`packages/studio/src/files/components.ts`, fed by `platform.discoverComponents`, which lists every hyphenated-tag document anywhere in the project, in any component format); `existingRefs` holds raw `$ref` strings. `computeRelativePath` already turns a project-relative path into a document-relative one there. Tests: the auto-discovery cases in `packages/studio/tests/canvas-live-render.test.ts` and `packages/studio/tests/content-render.test.ts`.
- `hasElement` in `packages/studio/src/files/elements.ts`, which already compares local `$ref`s on a normalised resolved path (studio.md §9.1.3).

**What is missing**

- Project-level relative `imports` and `$elements` rebased onto the open document's directory as they join the render document; bare specifiers pass through unchanged. For `imports`, that is a canvas `ImportRebaser` passed to the `injectContext` call `plan:studio/canvas-injects-context` adds. `injectContext` merges `$elements` unrebased in every host, and `plan:_shared/component-discovery` will resolve the build's declared entries against their declaring documents before that merge. Whether `injectContext` gains an `$elements` rebaser that both could use, or the canvas rebases before the call, is a decision the detail phase shares with that plan.
- Discovery on every canvas render path: a page with no layout, a page with the show-layout toggle off, and a component opened on its own (without injecting a `$ref` to the document's own root tag, which is why the current gate excludes that path).
- A transitive walk that opens each discovered component definition once and collects its tags, as `discoverElements` does.
- Candidates limited to `components/<tag>.json`, the composer's rule and the target here, so the canvas never injects a `$ref` to a component in an extension format, which the runtime fetches and cannot parse. The build's set is not the target: the build compiles rather than fetches, and its own gap is `plan:_shared/component-discovery`'s.
- Dedup of declared against discovered entries by resolved path, so `../components/nav.json` in a layout and a discovered `./components/nav.json` are one entry; it needs the rebasing above first.
- The detail phase decides whether the canvas calls a shared walk from `packages/site` (the composer's needs a `SiteIO` over the tree) or reimplements it over the studio's registry, where the `$elements` rebase lives (above), and whether the walk also descends into `$switch` cases and `$prototype: "Array"` templates, which `collectTags` skips.

**Related**

- studio.md §9.1.3 (the one `$elements` service and its resolved-path comparison).
- studio.md §4.1 (`plan:studio/canvas-injects-context`, required: the canvas composes through `injectContext`).
- imports.md §1.3, site-architecture.md §2.2 and §10.3 (`plan:_shared/component-discovery`, required: the build compiles every component a page or layout reaches).
- server.md §3.4 (the live site preview composes through the same rule and cites this section).
