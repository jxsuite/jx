---
status: drafted
disposition: implement
claims:
  - imports.md#1.1
  - imports.md#1.4
requires:
  - studio/canvas-injects-context
  - _shared/component-discovery
workspaces:
  - packages/studio
  - packages/site
  - packages/compiler
size: M
---

# The studio canvas resolves project-level `imports` and `$elements` from the project root and discovers a document's project components by the composer's rule, and a layout-wrapped page keeps its own `imports` in every host

## Context

`specs/imports.md` §1.1, line 16:

> **Status: Partial.** The build meets it: `injectContext` (`packages/site/src/context.ts`) merges project `imports` under the page's, and `nodeImportRebaser` (`packages/compiler/src/site/context-injection.ts`) rewrites a relative project entry onto the page's directory. The studio canvas does not rebase: `getEffectiveImports` (`packages/studio/src/site-context.ts`) merges project `imports` unchanged, and the canvas resolves each `$src` against the open document's own URL (`docBase` in `packages/studio/src/canvas/canvas-live-render.ts`), so a relative project import resolves against the wrong directory in any document outside the project root.

`specs/imports.md` §1.4, line 69 (its build half, from "`injectComponentScripts` … scans the rendered HTML" to "no build error.", is replaced by `plan:_shared/component-discovery` when that lands; what stays is the canvas half):

> **Status: Partial.** … The studio canvas (`packages/studio/src/canvas/canvas-live-render.ts`) does not meet it: it merges project-level `$elements` without rebasing their `$ref`s onto the document's directory (`getEffectiveElements` in `packages/studio/src/site-context.ts`), discovers only in content mode, for a layout-wrapped page or for a document under `layouts/`, never opens the components it finds, matches tags against the whole component registry rather than `components/<tag>.json`, and dedups declared entries by their raw `$ref` string.

One plan owns both sections (the imports audit record's spec-wide decision): the canvas applies context written against the project root as though it were written against the open document, and rebasing `$elements` is the precondition for the resolved-path dedup §1.4 asks for.

**Two prerequisites, both hard.** `plan:studio/canvas-injects-context` adds the canvas's call to `injectContext` (`@jxsuite/site/context`) and makes the layout wrap carry the page's own `imports` and `$elements`; this plan fills that call's `ImportRebaser` argument and project config rather than adding a second merge beside it. `plan:_shared/component-discovery` closes the build half of §1.4's marker; §1.4 cannot flip before it.

**Verified in the code (2026-09-27).**

- `injectContext` merges project `imports` (rebasing only `./` and `../` entries, through the optional `ImportRebaser`) and unions project `$elements` by raw string or `$ref`. The build passes `nodeImportRebaser`; `composePage` (`packages/site/src/compose.ts`) passes `null` because the live preview boots the runtime with `base: "/"` (`packages/server/src/live-preview.ts`, `packages/site/src/shell.ts`), so a project-root path already resolves there.
- `resolveCanvasDocument` sets `docBase` to `new URL(documentPath, documentBase(projectRoot))`; `registerElements` in `packages/studio/src/canvas/iframe-render.ts` resolves each `$ref` as `new URL($ref, docBase)`, and `buildScope` resolves each `$src` (Pass 0 and `resolveClassJson` in `packages/runtime/src/runtime.ts`) against the same base. `packages/ui/project.json` declares `{ "$ref": "./components/jx-icon.json" }`, which the canvas resolves under `components/components/` for an open component.
- The canvas discovery block: gated on `S.mode === "content" || layoutWrapped || isLayoutDoc`; `collectTags` walks only `children` arrays; each tag is looked up in `componentRegistry` (`packages/studio/src/files/components.ts`, every hyphenated-tag document anywhere in the tree); `existingRefs` holds raw strings; `computeRelativePath` turns a project path into a document-relative one.
- `discoverElements` in `compose.ts` matches `components/<tag>.json` (`COMPONENT_FILE`), opens each definition once and compares declared entries by `refPath`; covered by the "component auto-discovery" cases in `packages/site/tests/compose.test.ts`.

**Found while detailing** (each is closed here, because both sections flip):

1. §1.1's "the build meets it" is false for a layout-wrapped page. `resolveLayout` (`packages/site/src/layout.ts`) builds the merged document from the layout and merges the page's `state`, `$media`, `style` and `attributes`, never its `imports`; a scratch call returned the layout's entry and not the page's. The build (`compilePage` through `packages/compiler/src/site/layout-resolver.ts`) and the live preview (`composePage`) both lose a wrapped page's own imports. Tracked instance: `examples/pages/advanced/markdown-blog.json` (under `./layouts/example.json`) maps `MarkdownCollection` and `Markdown`, which today resolve only through the parser extension's registry.
2. A layout's own `$elements` are misresolved by the canvas exactly as the project's are. `distributePageIntoLayout` keeps the layout's `../components/mu-footer.json`, the canvas resolves it against a page under `pages/exhibitions/` (museum starter) as `pages/components/mu-footer.json`, and the raw-string dedup then lets discovery add the right `../../components/mu-footer.json` beside it: one failed registration per render of every nested page in a starter.
3. Both walks skip repeated templates and `$switch` cases: `collectTagNames` (compose.ts) and `collectTags` read `children` only. The museum starter's `pages/index.json` (and its `fr-ca` and `ar` copies) names `mu-exhibition-card` only inside a `$prototype: "Array"` `map` and declares nothing, so the live preview and the canvas's Preview mode render those cards as inert tags. Edit and Design find it, because `prepareForEditMode` turns the repeater into a perimeter whose `children` hold the template.
4. Canvas discovery writes into the open document. In Edit and Design, `prepareForEditMode` and `stripEventHandlers` pass `$elements` by reference, and `getEffectiveElements` returns the document's own array when the project declares none, so `effectiveElements.push(...)` adds the discovered `$ref`s to the tab's source document for a content document or a layout opened on its own. Discovery on every path would spread that to every page and component.

**Not claimed, no owner** (recorded for whoever next touches them): the live preview resolves every relative reference against the origin root, so a page-level relative import or a co-located `$ref` in a page below `pages/` resolves from the wrong directory there (server.md §3.4, Implemented); and no host rebases a layout's own relative `imports` onto the page (§1.1 states no layout rule).

## Outcome

- imports.md §1.1 → Implemented (marker deleted): a relative project import names the same file on every page in the build, the live preview and the canvas, and a layout-wrapped page keeps its own `imports` in all three.
- imports.md §1.4 → Implemented (marker deleted): the canvas rebases project and layout `$ref`s onto the open document, discovers `components/<tag>.json` components on every render path by the composer's walk (transitive, through repeated templates and `$switch` cases), and keeps one entry per resolved file. The live preview gains the template and case descent.
- imports.md graduates in this pull request only if nothing else in it is open by then (see Specs & docs).

## Decisions

- **Decided:** the canvas rebases on its own side of `injectContext`, which gains no parameter: imports through a canvas `ImportRebaser` (the hook the build fills with `nodeImportRebaser`), project `$elements` through a rebased view of the project config handed to the same call, and each layout's `$elements` as the wrap loads it. Only the canvas resolves against the open document: the build resolves declared entries per declaring document in its own pre-pass and never rebases `$elements` (`plan:_shared/component-discovery`'s contract), and the live preview resolves at the root. A seventh positional parameter for one caller of three buys nothing.
- **Decided:** rebased and discovered entries are document-relative, through `computeRelativePath` (`files/components.ts`). It is the spelling the palette's drop writes (`elementsEntryFor`) and `nodeImportRebaser` emits, so one file has one spelling across declared, rebased and discovered entries.
- **Decided:** the walk is written once, in a new `packages/site/src/elements.ts`, with its path list and reader injected: the composer passes the tree and `readDocument`, the canvas passes the registry's paths and a cached reader. A new module rather than an export of `compose.ts`, so the studio bundle does not take the composer, and `unionElements` stays where it is published.
- **Decided:** the walk descends into a node's `map` and every value of its `cases`, because §1.4 counts "every hyphenated tag a document names", and finding 3 is a shipped starter that breaks without it. The live preview inherits it; server.md §3.4 states the same rule by citing §1.4, so it needs no edit.
- **Decided:** the canvas discovers on every render path and in every mode, after the context merge; a component definition opened on its own (not a page, hyphenated root) never discovers its own root tag, which is what the removed `isLayoutDoc` gate existed to prevent. Definitions are read through a cache beside the registry, refreshed by `noteComponentSaved` and dropped by `loadComponentRegistry`, because `resolveCanvasDocument` runs on every render; it goes stale on an outside change exactly as the registry and the layout cache already do.
- **Decided:** the canvas's final `$elements` is a new array with one entry per resolved file (strings by value), and the incoming array is never written (finding 4).
- **Decided:** `resolveLayout` merges the page's `imports` over the layout's, the page winning as it does for `state`, which closes finding 1 in the build and the live preview with one line. A layout's own relative imports stay unrebased (not claimed, above).
- **Open:** does the canvas stop registering an undeclared component whose file is not `components/<tag>.json` (a subdirectory of `components/`, a co-located `_` file beside a page, or a file in `components/` named other than its tag)? Today it registers any registry match on the paths it discovers on. Recommendation: yes, `components/<tag>.json` only, because that is §1.4's stated rule ("a component whose file name is not its tag" must be declared) and the live preview's, and because after `plan:_shared/component-discovery` the build compiles an undeclared co-located or nested component nowhere, so a canvas that renders it hides the missing declaration that ships an empty tag. The palette's drop already writes the declaration (`enableElement`), so the authoring path is unchanged; the one case the build still loads undeclared (a misnamed file directly in `components/`) renders in neither the canvas nor the live preview, as the spec says.

## Implementation

**packages/site**

1. New `packages/site/src/elements.ts`, exported as `"./elements": "./src/elements.ts"` in `packages/site/package.json`; its header states imports.md §1.4's undeclared rule:
   - `export function componentFileTag(path: string): string | null`: `COMPONENT_FILE` (`/^components\/([^/]+-[^/]*)\.json$/`, moved from `compose.ts`) applied after stripping a leading `./`.
   - `collectTagNames(node, into)` moved from `compose.ts` (module-private), now also recursing into an object's `map` and each value of an object's `cases`; non-string `tagName`, primitives and `null` are ignored.
   - `export interface ComponentSource { paths: Iterable<string>; read: (path: string) => Promise<unknown> }`.
   - `export async function discoverComponentPaths(root: unknown, source: ComponentSource, skip: ReadonlySet<string> = new Set()): Promise<string[]>`: the frontier loop of today's `discoverElements`, returning project paths in discovery order. `available` maps `componentFileTag` over `source.paths`; a tag in `skip` is neither returned nor opened; a path whose `read` resolves `null` is returned but not walked; each path is opened once.
2. `compose.ts`, `discoverElements(io, doc)`: keep the `declared` set (`refPath`), then call `discoverComponentPaths(doc, { paths: io.paths(), read: (path) => readDocument(io, path) })` and return `{ $ref: "./" + path }` for each path whose `refPath` is not in `declared`. Delete `COMPONENT_FILE` and `collectTagNames` here. Rewrite its doc comment: the canvas runs the same walk over its registry; drop "which the other two auto-discoveries are not" and the "reaches the same answer a third way" passage.
3. `layout.ts`, `resolveLayout`: after the `$media` merge add `if (pageDoc.imports) { merged.imports = { ...merged.imports, ...pageDoc.imports }; }`. If `plan:studio/canvas-injects-context` already added it for the canvas wrap, verify its test and skip.
4. `context.ts`, comments only: the module header's "the one thing that genuinely needed a filesystem" passage and the `ImportRebaser` doc say two hosts rebase (the build, whose output tree differs from the source tree, and the studio canvas, which resolves against the open document) and the live preview passes none.

**packages/studio**

5. New `packages/studio/src/files/project-refs.ts`, header `@docs studio/design/components`, citing imports.md §1.1 and §1.4:
   - `export function projectPathOf(ref: string, fromPath: string | null): string | null`. `null` for a ref with a URL scheme (`/^[a-z][a-z\d+.-]*:/i`) or a leading `/`. Otherwise join the directory of `fromPath` (`\` → `/`, leading `./` stripped; `null` is the project root) with `ref`, drop `.` segments, collapse `name/..`, and keep a leading `..` that climbs above the root.
   - `export function rebaseRef(ref: string, fromPath: string | null, toPath: string | null): string`: `computeRelativePath(toPath, projectPathOf(ref, fromPath))`, or `ref` unchanged when that is `null`. `computeRelativePath` already emits the right `../` run for a target with a leading `..`.
   - `export function canvasImportRebaser(documentPath: string | null): ImportRebaser` (type from `@jxsuite/site/context`): `(src) => rebaseRef(src, null, documentPath)`. The canvas counterpart of `nodeImportRebaser`, closing over the open document rather than reading `route.sourcePath`, so it does not depend on how the prerequisite builds its route.
   - `export function rebaseElements(entries: readonly ElementsEntry[] | undefined, fromPath: string | null, toPath: string | null): ElementsEntry[] | undefined`: a new array; each entry with a string `$ref` becomes `{ ...entry, $ref: rebaseRef(entry.$ref, fromPath, toPath) }`, so a `$__layout` marker survives; strings and inline definitions are kept as they are.
   - `export async function resolveCanvasElements(renderDoc: JxMutableNode, documentPath: string | null, skipRootTag: boolean): Promise<ElementsEntry[] | undefined>`: `discoverComponentPaths(renderDoc, { paths: <registry entries with source !== "npm" and a path, mapped to path>, read: readComponentDefinition }, skipRootTag ? new Set([renderDoc.tagName]) : undefined)`. Build a new array: each entry of `renderDoc.$elements`, keyed by its string value, by `projectPathOf($ref, documentPath)`, or by the raw `$ref` when that is `null`, first occurrence kept; then `{ $ref: computeRelativePath(documentPath, path) }` for each discovered path not already held. `undefined` when empty.
6. `files/components.ts`: a module-level `Map<string, unknown>` and `export async function readComponentDefinition(path: string): Promise<unknown>` (cache hit, else `JSON.parse(await getPlatform().readFile(path))`; a failed read or parse caches and returns `null`). `loadComponentRegistry` clears the map; `noteComponentSaved` sets the saved `doc` for a path that is still a component and deletes it otherwise.
7. `canvas/canvas-live-render.ts`, `resolveCanvasDocument`:
   - Right after a layout document is loaded for the wrap (today `resolveLayoutDoc(layoutPath)`; after the prerequisite, at every level its wrap loads), set its `$elements` to `rebaseElements(layout.$elements, <that layout's path>, S.documentPath)`.
   - At the `injectContext` call the prerequisite adds, pass `canvasImportRebaser(S.documentPath ?? null)` as `rebaseImport`, and as the project config `{ ...config, $elements: rebaseElements(config.$elements, null, S.documentPath ?? null) }` when the config declares `$elements` (a view; `projectState` is not written).
   - If the prerequisite still applies `getEffectiveImports` or `getEffectiveElements` to a render document that is not a page, give both an optional trailing `forDocumentPath` in `site-context.ts` that rebases the project's entries the same way (imports through `rebaseRef`, only `./` and `../` values), and pass it there. The panels call them without it and are unchanged.
   - Replace the "Component auto-discovery" block (the `isLayoutDoc` gate, `collectTags`, the registry lookup, `existingRefs`, the `push`) with `const elements = await resolveCanvasElements(renderDoc, S.documentPath ?? null, !isPage && isComponentDoc(renderDoc))`, then assign `renderDoc.$elements` or delete the key. It runs on every path, after the context merge. Drop imports it leaves unused (`displayTagName`, `computeRelativePath`, `ComponentEntry`, and `getEffectiveElements` if nothing else reads it).
8. Every new studio export has an app caller through `resolveCanvasDocument`, which the call-graph reachability test (`packages/studio/tests/reachability.ts`) requires.

**Integration contract.** Once this lands:

- `@jxsuite/site/elements` exports `discoverComponentPaths(root, source, skip?)` and `componentFileTag(path)`, the one implementation of imports.md §1.4's undeclared rule, used by the live preview and the canvas. Any host with a list of project paths and a reader may reuse it (`plan:desktop/component-scope-sections` may, for the components a document uses).
- `resolveLayout` carries a page's `imports` over its layout's in every host.
- `packages/studio/src/files/project-refs.ts` exports `projectPathOf`, `rebaseRef`, `rebaseElements`, `canvasImportRebaser` and `resolveCanvasElements`; `readComponentDefinition` in `files/components.ts` is a cached, save-refreshed reader of component definitions.
- The canvas render document's `$elements` is a fresh, document-relative array with one entry per resolved file, and project `imports` in it are document-relative. `plan:site-architecture/page-context-props` and `plan:studio/site-state-in-data-panel` inherit that without change.

## Tests

Each suite runs as `bun test --isolate --coverage` from its workspace directory; coverage thresholds are per file.

**packages/site** (`coverageThreshold = { lines = 0.99, functions = 1.0 }`). `elements.ts` is a new source file, so it ships with its test file or `bun scripts/check-coverage-manifest.ts packages/site` fails; `compose.ts` loses two functions and must stay at 100%.

- New `packages/site/tests/elements.test.ts`:
  - "componentFileTag matches components/<tag>.json and nothing else" (`components/site-card.json` and `./components/site-card.json` give `site-card`; `components/card.json`, `components/nested/x-a.json`, `pages/blog/_x-a.json` and `components/x-a.md` give `null`).
  - "finds a tag named in children, in a repeated template and in a $switch case".
  - "walks each discovered definition once, transitively" (a reader spy counts reads; a → b → a).
  - "a definition the reader cannot return is discovered but not walked".
  - "never discovers or opens a skipped tag".
  - "ignores primitive, null and non-string-tag nodes".
- `compose.test.ts`, "component auto-discovery": the six existing cases pass unchanged (the regression guard for server.md §3.4), plus "a component named only inside a repeated template is registered" (the museum shape).
- `layout.test.ts`: "a page's own imports survive the wrap and win over the layout's"; "the layout's imports stay when the page declares none".

**packages/compiler** (no source change; `coverageThreshold = { lines = 0.982, functions = 0.98 }` holds as is):

- `layout-resolver.test.ts`: "keeps the page's own imports over the layout's" (through `nodeLayoutLoader` on a temporary project).
- `context-injection.test.ts`: "a wrapped page's own import wins over the project's, and a relative project import is rebased onto the page" (`resolveLayout` then `injectContext` with a project root, page at `pages/blog/post.json`).

**packages/studio** (`coverageThreshold = { lines = 0.958, functions = 0.941 }`). `project-refs.ts` is a new source file and ships with its test file (`bun scripts/check-coverage-manifest.ts packages/studio`). Raise the threshold if the worst file rises.

- New `packages/studio/tests/project-refs.test.ts` (first import `./harness`, because the module graph reaches `store`):
  - "projectPathOf resolves a ref against its declaring document's directory" (`../components/nav.json` from `layouts/base.json`; `./a/../b.json`).
  - "projectPathOf resolves a project.json entry against the project root".
  - "projectPathOf keeps a path that climbs above the project root".
  - "projectPathOf answers null for a root-absolute path and a URL".
  - "rebaseRef rewrites a project-root entry for a page two directories down, and leaves a URL alone".
  - "canvasImportRebaser rebases onto the open document, and with no document keeps a ./ prefix".
  - "rebaseElements rewrites $ref entries, keeps strings, inline definitions and extra keys, and returns a new array".
  - "resolveCanvasElements keeps one entry per resolved file".
  - "resolveCanvasElements discovers transitively and reads each definition once" (counts `readFile` in the mock platform's `state.calls`).
  - "resolveCanvasElements ignores registry components outside components/<tag>.json" (`pages/blog/_blog-card.json`, `components/nested/deep-card.json`, `components/card.json` declaring `x-card`, an npm entry).
  - "resolveCanvasElements skips the root tag only when asked".
  - "resolveCanvasElements never writes the array it is given".
- `components.test.ts`: "readComponentDefinition reads once and caches", "noteComponentSaved refreshes a cached definition", "loadComponentRegistry drops the cache".
- `canvas-live-render.test.ts` (the `resolve` helper, `resetStudioState({ isSiteProject: true, projectConfig })`, seed files on `installMockPlatform`):
  - "rebases a relative project import onto a nested page and passes a bare one through" (`pages/blog/post.json`: `./components/post-card.class.json` becomes `../../components/post-card.class.json`).
  - "rebases the project's $elements onto the open document" (the `packages/ui` shape: open `components/jx-button.json`, get `./jx-icon.json`).
  - "a layout's entry and a discovered one for the same file are one entry on a nested page" (layout `../components/site-nav.json`, page `pages/blog/post.json`: exactly `["../../components/site-nav.json"]`).
  - "discovers project components on a page with no layout", "… with the show-layout toggle off", "… in a component opened on its own, without its own tag".
  - "discovers a component named only in a repeated template, in Preview".
  - "leaves the tab's source $elements untouched in Design".
  - The two existing discovery cases pass unchanged.
- `canvas-live-render-gaps.test.ts`: "collectTags skips primitive children while still registering component refs" is renamed "discovery skips primitive children …" and passes unchanged.
- `content-render.test.ts`: delete the simulated `collectTags` and `autoDiscoverElements` helpers and their two `describe` blocks. They test a copy of the old logic, and the cases above test the source; "computeRelativePath for content → component" stays.

## Specs & docs

**imports.md**

- §1.1: delete the marker. The paragraph "These cascade from site level into every page. Page-level `imports` merge on top (page wins on conflict)." gains: "A page wrapped in a layout keeps its own `imports` through the wrap, over the layout's. A relative project-level entry is written against the project root and names the same file on every page it reaches: a host that resolves a page's imports from the page's own directory rewrites the entry onto that directory (`./components/post-card.class.json` is `../../components/post-card.class.json` for `pages/blog/post.json`), and a bare specifier passes through unchanged." The code block is `plan:_shared/formats-from-extensions`'s edit and is not touched; `PostCard` survives it, so the sentence holds in either landing order.
- §1.4: delete the marker, whatever of it remains. After "Page entries take precedence on conflict." add: "A `{ "$ref" }` in `project.json` is written against the project root, and every host resolves it from there on whichever page it reaches." In the paragraph opening "**A component the project itself defines does not have to be declared.**", replace "three surfaces each reach the same effective set a different way: a build scans the rendered HTML for tags it compiled and emits a module script per tag, the studio canvas walks the document against the project's component registry, and a host composing from the working tree walks the document against the tree." with "three surfaces reach the same effective set two ways: a build scans the rendered HTML for tags it compiled and emits a module script per tag, and the studio canvas and a host composing from the working tree run one walk over the document, the canvas against the project's component registry and the composer against the tree."; replace "Every hyphenated tag a document names that" with "Every hyphenated tag a document names (in its children, a repeated template or a `$switch` case) that"; and end the paragraph with "The canvas applies the rule to every document it renders, except that a component definition opened on its own does not register its own tag."
- Fragment: `bun run spec:change imports.md minor -m "Project-level imports and element references resolve from the project root on every page in every host, a layout-wrapped page keeps its own imports, and the studio canvas discovers a document's own components on every render path, transitively and inside repeated templates and switch cases, one entry per resolved file"`.
- Graduation: if `bun run plans:status --spec imports` lists no other open item when this lands, set the header's `**Status:**` to `Implemented`, record the change with `bun run spec:bump imports.md minor -m "<the sentence above>"` in place instead of the fragment, and delete `plans/imports/`. Today §1.2, §1.3, §2, §4.2, §4.3, §5, §5.1 and §6 are open, so expect the fragment.

**Docs** (no em dashes; `bun run docs:sync` names these through `layout.ts`, `context.ts` and `site-context.ts`):

- `docs/framework/site/layouts.md`, "What merges": add "- **`imports`**: the page's entries are merged over the layout's; the page wins on a shared name."
- `docs/framework/site/project-json.md`, "What documents inherit": the `imports` and `$elements` bullet (as `plan:_shared/component-discovery` leaves it) becomes "`imports` and `$elements` merge with page-level entries (page wins on collision). A relative path in either is relative to `project.json` and names the same file on every page, however deep the page sits."
- `docs/studio/design/components.md`: the closing `:::doc-note` gains "A component file in `components/` named for its tag renders on the canvas wherever you use it, even without that reference. A component kept anywhere else renders once the page lists it in `$elements`, which dropping it from the Insert palette does for you." Add `packages/studio/src/files/project-refs.ts` to its `code:` (the module's `@docs studio/design/components` points back).
- No change: `docs/framework/site/i18n.md` and `docs/studio/interface/languages.md` (named through the comment-only `context.ts` edit and `site-context.ts`; they describe locales), and `docs/studio/interface/canvas.md`, which does not describe registration.

## Acceptance

- `bun test --isolate --coverage` passes at thresholds in `packages/site`, `packages/studio` and `packages/compiler`; `bun scripts/check-coverage-manifest.ts packages/site` and `bun scripts/check-coverage-manifest.ts packages/studio` pass.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun run docs:section-refs` pass.
- `bun run plans:status --spec imports` lists neither §1.1 nor §1.4.
- In Studio on the dev server: `packages/ui` with `components/jx-button.json` open logs no "failed to register element" for `jx-icon.json`; the museum starter's `pages/index.json` in Preview renders its exhibition cards, and a page under `pages/exhibitions/` registers `mu-footer` once with no failed registration; saving a layout opened on its own after viewing it in Design writes no `$elements` entry it did not already have.
- The live preview of the museum starter renders the exhibition cards on `/`.
- `jx build` of `examples/` against `main`: any difference in `dist/` is confined to `advanced/markdown-blog/` and follows from that page's own `imports` now applying.
