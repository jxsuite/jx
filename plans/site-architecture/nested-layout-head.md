---
status: drafted
disposition: implement
claims:
  - site-architecture.md#5.4
requires:
  - site-architecture/head-and-layout-shape
workspaces:
  - packages/site
  - packages/compiler
  - packages/studio
  - specs
  - docs
size: M
---

# Every layout in a nested chain contributes its `$head` to the layout level, outermost first, and no layout's `title` becomes the page's title

## Context

`specs/site-architecture.md` §5.4, marker at line 493:

> **Status: Partial.** A layout's own `$layout` resolves recursively and the slots compose (`resolveLayout` in `packages/site/src/layout.ts`). An intermediate layout's `$head` does not survive as layout head: the inner resolution records it as the page's (`_pageHead`), so it is dropped when the page declares its own `$head` and is otherwise merged at page level, and only the outermost layout's `$head` is merged as the layout level (`compilePage` in `packages/compiler/src/site/site-build.ts`, `composePage` in `packages/site/src/compose.ts`).

Verified at the current tree. `resolveLayout` recurses by calling itself on the inner layout as if it were a page: the inner layout's `$head` lands on `_pageHead` and its `title` on `_pageTitle` of a clone of the outer layout, and the outer call overwrites both when the real page declares its own. With three levels the middle layout's `$head` is lost even under a page with none whenever the innermost layout declares one, because the innermost's overwrites it on the way out (a scratch `resolveLayout` of `t` ← `m` ← `i`, each with one meta, returns `$head` `[t]` and `_pageHead` `[i]`). Both hosts read `pageHead = pageDoc.$head ?? merged._pageHead` and `layoutHead = merged.$head`, which is the outermost layout's alone. `mergeHead` (`packages/site/src/head-merger.ts`) folds `[defaults, site, layout, page]` into a keyed `Map`, so a later entry under an existing key replaces it in place.

Scratch runs (2026-09-27) with `layouts/base.json` (`title: "Base T"`, `$head`: `meta name="base"`), `layouts/blog.json` (`$layout: base`, `title: "Blog T"`, `$head`: a stylesheet `link`) and pages on `blog.json`:

- `buildSite`, page with its own `$head` (a description meta) and no `title`: the head holds the base meta and the description, the blog stylesheet is gone, the title is `<title>Blog T</title>`, and the root renders as `<div title="Base T">`.
- `buildSite`, page with `title: "Other"` and no `$head`: the stylesheet survives (merged at page level) and the title is `Other`.
- `composePage`, same tree: identical head, root `title` `Base T`, and `$page.title` `Base T`.
- `resolveLayout` on `a.json → b.json → a.json`: unbounded; a loader that throws after 5000 calls is the only thing that stops it. The build and the live preview hang on a layout cycle.

Three things the stub did not list:

- **The layout's own `title`.** An intermediate layout's `title` becomes the page's `<title>` when the page has none. The outermost layout's `title` stays on the resolved root, so it ships as a tooltip over the whole page, and `injectContext` (`packages/site/src/context.ts`) reads it as `$page.title` before the page's `_pageTitle`. `plan:site-architecture/head-and-layout-shape-root-title` removes whatever `title` the composed root carries in each host, after it has been read, and leaves to this plan what a layout's `title` contributes to `<title>` and `$page.title` at every level. Studio already answers that one way: `resolveTitleField` in `packages/studio/src/panels/head-panel.ts` says "A layout never supplies one", and a single-layout build never takes a layout's `title` for `<title>`.
- **Studio's merged-head preview.** `loadLayoutHead` in `head-panel.ts` reads only the page's own layout (`resolveLayoutDoc(path)`, then `doc.$head`). Under `blog.json` it shows the blog entries and none of `base.json`'s, so a description the base layout supplies is reported missing (`description-missing`), and `reportSeoProblems` files that as a Problem. site-architecture.md §8.6 says the preview shows the merged `$head` (§8.3).
- **An intermediate layout's `$elements` in the live preview.** `composePage` registers `unionElements(merged.$elements, pageDoc.$elements)`: the outermost layout's and the page's. An intermediate layout's entries are dropped, and only the project components `discoverElements` finds by tag (`components/<tag>.json`) come back; a bare npm specifier or a `$ref` elsewhere does not. `plan:_shared/component-discovery` closes the build half (imports.md §1.3) and scopes the live preview out, so without this plan nobody owns it.

Hosts: `jx build`, `jx dev` on a site (`packages/server/src/dev.ts`) and the desktop build all run `buildSite`, so `compilePage`; the live preview (`packages/server/src/live-preview.ts`) runs `serveSite`, so `composePage`. The Studio canvas composes through neither: `resolveCanvasDocument` wraps one level with `distributePageIntoLayout` (`packages/studio/src/site-context.ts`), which `plan:studio/canvas-injects-context` replaces with `resolveLayout`.

Tracked nesting: `examples/layouts/example.json`, `packages/starters/sites/blog/layouts/post.json` and `packages/starters/sites/museum/layouts/{fr-ca,ar}.json` nest under `base.json` and declare no `$head`, `title` or `$elements`, so no tracked project's output changes.

## Outcome

- site-architecture.md §5.4 → Implemented: every layout in the chain contributes its `$head` to the layout level of the head merge, outermost first, in the build, the live preview and Studio's merged-head preview; no layout's `title`, at any depth, becomes the page's `<title>`; a layout cycle is an error naming the chain. The live preview also registers every layout's `$elements`, not only the outermost's; the build half of that is imports.md §1.3's.
- The Studio canvas is unchanged here. It renders a nested page inside its innermost layout alone until `plan:studio/canvas-injects-context` (studio.md §4.1) composes it through `resolveLayout`, which then brings this plan's chain, head and cycle behaviour with it. §5.4 flips without it for the reason §5.5 does in `plan:site-architecture/page-context-props`: the section describes the site the build and the live preview produce, and the canvas's fidelity to that is studio.md §4.1's item.
- site-architecture.md §5.5 stays Partial under `plan:site-architecture/page-context-props`. Its marker's `$page.title` clause stays true: on a wrapped page `injectContext` still reads the outermost layout's `title`, which that plan stops.
- site-architecture.md stays Partial; nothing graduates.

## Decisions

- **Decided:** the layout level is every layout's `$head` concatenated outermost first onto the resolved document's `$head`, so neither host changes its `mergeHead` call, because `mergeHead`'s layout argument is one array and its keyed `Map` already lets an inner layout's entry replace an outer one under the same key. For a page with no `$head` the order is what it is today (base entries, then the intermediate ones), so nothing that currently works reorders.
- **Open:** what does a layout's `title` contribute? Recommendation: nothing, at any depth, to either `<title>` or `$page.title`: the page title is the page's own `title`, else the project `name`. This is what a single-layout build and Studio's `resolveTitleField` already do for `<title>`; the alternative (the innermost layout's `title` as a fallback page title) is a new donor that the build, the live preview and Studio's title field would all have to learn. The code split follows ownership. This plan stops `resolveLayout` recording an intermediate layout's `title` as `_pageTitle`, which is the only path by which any layout's `title` reaches `<title>` today. The outermost layout's `title` reaches `$page.title` through `injectContext` reading `doc.title` first; that read is §5.5's and `plan:site-architecture/page-context-props` removes it under this decision. Its rendering on the root is §8.1's (`plan:site-architecture/head-and-layout-shape-root-title`).
- **Decided:** `_pageHead` and `_pageTitle` stay, narrowed to the page's own `$head` and `title`, which is what their names say. `_pageTitle` is read inside `injectContext`, and when that carrier is deleted relative to `injectContext` is §5.5's question, so this plan does not remove either.
- **Decided:** the chain is read by one exported function, `layoutLevels`, which throws `LayoutCycleError` naming the chain when a reference repeats, because the recursion is unbounded today and Studio needs the same walk. Detection compares references as authored; a cycle spelled two ways (`./layouts/a.json`, `layouts/a.json`) repeats an exact string within one more lap, because each file names a fixed `$layout`.
- **Open:** does Studio's merged-head preview follow the chain in this plan? Recommendation: yes, with each level naming itself as the donor, because §8.6 promises the merged head with the donor named, and a flat layer credited to the page's own layout would send the author to a file that does not hold the value. It adds `packages/studio`; declining it drops that workspace, leaves §8.6's preview wrong under nesting, and makes this plan S.
- **Decided:** this plan requires `plan:site-architecture/head-and-layout-shape`, because its §8.3 and `docs/framework/site/layouts.md` edits are written against the text that paper plan puts there (§8.3's item 2, the layouts page's `$head` bullet), and neither can be right against today's `<head>`-children wording.
- **Decided:** an intermediate layout's `$elements` are closed here for the live preview and not for the build. The build half is imports.md §1.3's, owned by `plan:_shared/component-discovery`, whose `layoutChain` feeds the build's npm filter and compile set with each layout's own directory, and which scopes the live preview out. Left there, the live preview's half had no owner and no marker. `composePage` already changes in this plan and its loader already sees every level, so recording what it loads costs three lines. `resolveLayout` still merges no `$elements`: a `$ref` is relative to the file that wrote it, and only a host knows how it resolves (the live preview resolves every one against the shell's base, `refPath` in `compose.ts`).

## Implementation

1. **`packages/site/src/layout.ts`**
   - New `export interface LayoutLevel { ref: string; doc: JxDocument }`.
   - New `export class LayoutCycleError extends Error` with `override readonly name: string` and an explicit constructor `(chain: readonly string[])` that sets `this.name = "LayoutCycleError"` and the message `` `Layout cycle: ${chain.join(" → ")}` ``. The constructor is written out for the reason `ComposeError`'s comment in `compose.ts` gives: a field initializer's synthesized constructor is never marked entered, and this workspace gates functions at 1.0.
   - New `export async function layoutLevels(layoutRef: string, load: LayoutLoader): Promise<[LayoutLevel, ...LayoutLevel[]]>`: the non-empty tuple type is what lets `resolveLayout` destructure the outermost level under the root tsconfig's `noUncheckedIndexedAccess` without an unreachable guard, which `packages/site`'s 0.99 line gate would count. Follow `ref`, then each loaded document's `$layout` while it is a non-empty string, keeping the refs seen; throw `new LayoutCycleError([...seen, ref])` before loading a ref already seen. Return the levels outermost first, each `doc` as the loader returned it. JSDoc: "The layouts `layoutRef` wraps a page in, outermost first (site-architecture.md §5.4)".
   - Move the per-document merge out of `resolveLayout` into a private `function wrapInto(merged: JxDocument, inner: JxDocument): void`, unchanged: the `children` normalisation (lines 61–67), the `distributeSlots` call (line 70) and the `state`, `$media`, `style` and `attributes` spreads (lines 73–91). The `deepClone` of line 68 stays in `resolveLayout`.
   - `resolveLayout`: keep the `layoutRef` lookup and the no-layout early return. Then `const [outermost, ...inner] = await layoutLevels(layoutRef as string, load)` and `const merged = deepClone(outermost.doc)`, whose root keeps the outermost layout's `title` as today. For each `entry` of `inner`, outermost first: `const level = deepClone(entry.doc)`, `wrapInto(merged, level)`, and when `level.$head` is set, `merged.$head = [...(merged.$head ?? []), ...level.$head]`. The clone keeps a caching loader's documents unmutated, which the old recursion's second `deepClone` did. Then `wrapInto(merged, pageDoc)`, the `_pageHead` and `_pageTitle` lines unchanged, and `delete merged.$layout`. An inner level's `title` is never read. The module header's §5 list gains: "Nested layouts contribute every level's `$head` to the layout layer, outermost first; no layout's `title` is the page's (§5.4)". The existing "a layout document that is not an object" case must still return the string: `delete` on a primitive's missing property does not throw.
2. **`packages/site/src/compose.ts`**, `composePage`:
   - Wrap the `resolveLayout` call so a `LayoutCycleError` is rethrown as `new ComposeError(error.message)`, which `composeSafely` in `serve.ts` already renders as the problem page; any other error propagates as today (the loader's own `ComposeError("Layout not found: …")` included). Import `LayoutCycleError` beside `resolveLayout`.
   - The loader pushes each document it returns onto a local `layouts: JxDocument[]`, innermost first because `layoutLevels` loads in that order. The union becomes `unionElements(...layouts.toReversed().map((doc) => doc.$elements), pageDoc.$elements)`, outermost first. `merged.$elements` is the outermost layout's (the clone keeps it and `wrapInto` never touches it), so a single-layout page composes exactly as today, and a page with no layout unions its own entries alone, as today. The comment above the union says so.
   - The head lines (326–329) do not change.
3. **`packages/compiler`**: no source change. `compilePage` already reads `layoutDoc.$head` as the layout level, and its route-level `catch` in `buildSite` reports a cycle as `Error compiling <route>: Layout cycle: …`.
4. **`packages/studio/src/panels/head-panel.ts`** (the Open decision above):
   - `HeadLayers`: replace `layout` and `layoutName` with `layouts: HeadLayoutLevel[]`, outermost first, where `export interface HeadLayoutLevel { name: string | null; entries: JxHeadEntry[] }`.
   - `resolveMetaField`: after the page, walk `layers.layouts` innermost first; the first level whose `metaContentIn` is not `null` answers with `donor: level.name ?? "the layout"`. Innermost first matches `mergeHead`, where the inner entry is folded in last.
   - `hasTitleEntry`: flatten `layers.layouts.flatMap((l) => l.entries)`.
   - Cache: `_layoutHead: JxHeadEntry[]` becomes `_layoutLevels: HeadLayoutLevel[]`, which `invalidateLayoutHeadCache` resets to `[]`. `loadLayoutHead(path)` calls `layoutLevels(path, loader)` from `@jxsuite/site/layout`, where the loader awaits `resolveLayoutDoc(ref)` and throws when it returns `null`; on any rejection the levels are `[]`, as an unreadable layout is today. Each level is `{ entries: doc.$head ?? [], name: layoutDisplayName(ref) }`. The `_layoutHeadPending` guard and the `renderOnly` call are unchanged.
   - `layoutHeadEntries(tab, docLayout)` returns `{ levels: HeadLayoutLevel[]; name: string | null }`, `name` still the page's own layout. `seoPreviewFor` passes `layouts: layout.levels`.

**Integration contract.** Once this lands, `@jxsuite/site/layout` exports `resolveLayout` (signature unchanged), `layoutLevels(layoutRef, load)` (outermost first, `{ ref, doc }`, the loader's own documents), `LayoutLevel` and `LayoutCycleError`. A resolved document's `$head` is every layout level's `$head`, outermost first; `_pageHead` and `_pageTitle` hold only the page's own `$head` and `title`, or are absent; the root still carries the outermost layout's `title`, if it has one, for `plan:site-architecture/head-and-layout-shape-root-title` to remove after reading. `plan:site-architecture/page-context-props` may rely on `_pageTitle` being the page's title or nothing, and under this plan's title decision must not take `$page.title` from `doc.title` on a wrapped page. Every per-level merge of a layout-wrapped document goes through `wrapInto`, so a key added there applies at every level: `plan:imports/canvas-project-context`, which lands after this plan through `plan:studio/canvas-injects-context` and `plan:site-architecture/page-context-props`, adds its page `imports` merge there. A layout cycle is `LayoutCycleError` from `resolveLayout` and a `ComposeError` from `composePage`, and `plan:studio/canvas-injects-context` may treat it like any other rejection of the chain. `composePage`'s composed `$elements` are every layout's, outermost first, then the page's. In Studio, `HeadLayers.layouts` carries one named level per layout, and `layoutHeadEntries` returns `{ levels, name }`. `plan:site-architecture/seo-structured-data-editor` reads `HeadLayers` in one function, `inheritedStructuredData`; whichever of the two plans lands second makes it walk `layouts`, each level named as the donor of its blocks.

## Tests

**`packages/site`** (`bun test --isolate --coverage` from `packages/site`):

- `tests/layout.test.ts`, `describe("resolveLayout")`:
  - `three levels of $head arrive at the layout level, outermost first`: `top` → `mid` → `inner`, each with one `meta` in `$head`, page on `inner` with its own `$head`; `result.$head` names top, mid, inner in that order and `result._pageHead` is the page's array alone.
  - `an intermediate layout's head survives a page that declares its own`: the §5.4 scenario (base meta, blog stylesheet, page description); `result.$head` holds the meta and the stylesheet.
  - `an intermediate layout's title is not the page's`: base and blog each set `title`; for a page with none, `result._pageTitle` is undefined; for a page with `title: "P"`, it is `"P"`.
  - `a layout cycle is an error naming the chain`: `./a.json` ↔ `./b.json` rejects with a `LayoutCycleError` whose message is `Layout cycle: ./a.json → ./b.json → ./a.json`; a layout naming itself rejects the same way.
  - `a loader that caches its documents is not mutated by a nested resolution`: a loader returning the same objects without cloning; two pages resolved in turn each get their own children, and the cached `inner` document still holds its `slot`.
  - The existing "a nested layout is resolved before the page lands in it" and "the page's own head and title survive the merge" cases stay as they are.
- `tests/layout.test.ts`, new `describe("layoutLevels")`: `lists the chain outermost first, each with its reference` (refs and docs as loaded); `stops at a layout whose $layout is false or absent` (one level).
- `tests/compose.test.ts`, `describe("composePage")`:
  - `a nested layout's $head reaches the merged head beside the page's`: `compose(files, { name: "Nested" } as ProjectConfig)`; base, blog and page heads all present, the base meta before the blog stylesheet before the page description; with no page `title`, the `<title>` entry's text is `Nested`, not the blog layout's `title`.
  - `every layout's $elements reach the composed document, outermost first`: base `["@acme/base-kit"]`, blog `["@acme/blog-kit"]`, page `["@acme/page-kit"]`; `page.doc.$elements` equals the three in that order (today the blog entry is missing).
  - `a layout cycle is a ComposeError naming the chain`: rejects with `ComposeError` and `Layout cycle:`.
  - The existing "a page-declared $element survives layout resolution" and "a missing layout names the reference it could not find" cases stay as they are; the second is what covers the rethrow of an error that is not a cycle.

**`packages/compiler`** (`bun test --isolate --coverage` from `packages/compiler`), `tests/site-build.test.ts`, new `describe("buildSite — nested layouts")` with its own temp root (`__test-site-nested-layouts__`), project `name: "Nested"`, the §5.4 fixture plus a page with neither `$head` nor `title`:

- `every layout's head reaches the page, outermost first`: the page HTML contains `name="base"`, `href="/blog.css"` and `name="description"`, in that order by `indexOf`.
- `no layout's title becomes the page title`: the untitled page has `<title>Nested</title>` and no `Blog T` anywhere.
- `a layout cycle fails that page's build and names the chain`: a second temp project with two layouts naming each other; `result.errors` has one entry containing `Layout cycle: ./layouts/a.json → ./layouts/b.json → ./layouts/a.json`.

**`packages/studio`** (`bun test --isolate --coverage` from `packages/studio`):

- `tests/head-panel.test.ts`:
  - `layers()` builds `{ layouts: [], page: [], site: [], ...over }`; "a layout entry is inherited from the layout, by name" and "an unnamed layout still names itself as something" pass `layouts: [{ name: "Base", entries: [...] }]` and `[{ name: null, entries: [...] }]`.
  - New `the innermost layout that sets a key is its donor`: two levels both setting `description`, and one where only the outer sets it; the donor is `Blog Post` and `Base` respectively.
  - In "layoutHeadEntries — the one layer that lives in a file", assertions read `levels` for `entries`. New `a nested layout's levels arrive outermost first, each naming itself`: `layouts/base.json` (`$head` description) and `layouts/blog-post.json` (`$layout: "./layouts/base.json"`, `$head` `og:title`); after `flush()`, `levels` is `[{ name: "Base", … }, { name: "Blog Post", … }]`, and `seoPreviewFor`'s description field is inherited from `Base` with no `description-missing` warning. New `a layout cycle caches as empty`.
- `tests/context-head-pane-diff-gaps.test.ts`, "two renders in one tick share ONE read": `{ levels: [], name: "Main Layout" }` in place of `{ entries: [], … }`, and `levels[0]?.entries` has length 1. Still exactly one `readFile` of the layout.

**Coverage.** No source file is added, so no manifest check changes. `layoutLevels`, `wrapInto`, `LayoutCycleError`'s constructor and `composePage`'s new callback are reached by the cases above; `packages/site/bunfig.toml` gates `{ lines = 0.99, functions = 1.0 }` per file. `packages/compiler` (`0.982`/`0.98`) changes only a test. `packages/studio` (`0.958`/`0.941`): `head-panel.ts` gains one branch per new walk, each covered. Ratchet a workspace only if the run shows its worst file rose.

## Specs & docs

The edits below are written under both Open recommendations. If a layout's `title` becomes a fallback page title instead, the third §5.4 paragraph, the layouts page's `title` sentence and the fragment's title clause say so. If Studio's preview is left out, the marker drops its last clause and `docs/studio/editing/frontmatter.md` does not change.

**`specs/site-architecture.md`**, in place:

- **§5.4 marker** becomes: "> **Status: Implemented.** `layoutLevels` and `resolveLayout` (`packages/site/src/layout.ts`) resolve the chain for the build (`compilePage` in `packages/compiler/src/site/site-build.ts`) and the live preview (`composePage` in `packages/site/src/compose.ts`), and Studio's merged-head preview reads the same levels (`packages/studio/src/panels/head-panel.ts`)."
- **§5.4 body**, after "This allows `blog-post.json` layout to wrap within `base.json`, providing blog-specific chrome while inheriting the site shell.", add four paragraphs:
  - "Every layout in the chain is resolved as a layout, whatever its depth. Its children fill the slots of the layout it names, and its `state`, `$media`, `style` and `attributes` extend that layout's, key by key, the way a page's extend its layout's."
  - "Its `$head` joins the **layout level** of the head merge (§8.3). The layout level is every layout's `$head`, outermost first, so `blog-post.json` adds its stylesheet to what `base.json` declares, and an inner layout's entry replaces an outer one's under the same key. The page's own `$head` is the page level, which follows."
  - "A layout's `title` is not a page title, at any depth: the page's `<title>` is its own `title`, else the project `name` (§8.4)."
  - "A layout that reaches itself through `$layout`, directly or through another layout, is an error naming the chain: `Layout cycle: ./layouts/a.json → ./layouts/b.json → ./layouts/a.json`. The build reports it for each page that uses the layout, and the live preview renders it as that page's problem."
- **§8.3**, item 2 as `plan:site-architecture/head-and-layout-shape` leaves it ("**Layout-level** (the layout document's `$head`, §5.1): shared stylesheets, scripts and other structural tags") becomes "**Layout-level** (the layout document's `$head`, and when layouts nest every layout's, outermost first, §5.1 and §5.4): shared stylesheets, scripts and other structural tags". That plan wrote item 2 neutral about nesting so this widening undoes none of it.

**Fragment:** `bun run spec:change site-architecture.md minor -m "§5.4: every layout in a nested chain contributes its head entries to the layout level of the head merge, outermost first, a layout's title is never the page title at any depth, and a layout cycle is an error naming the chain."`

**Docs** (no em dashes). `bun run docs:sync` names `docs/framework/site/layouts.md` (`code:` `packages/site/src/layout.ts`; `spec:` `site-architecture.md#5`) and, for `head-panel.ts`, `docs/studio/editing/frontmatter.md` and `docs/studio/editing.md`. No page lists `compose.ts`.

- `docs/framework/site/layouts.md`:
  - "Nesting": after "Inner layouts resolve first, so the page's content threads through every level." add "Each layout's `$head` joins the layout layer of the merged `<head>`, outermost first, so `blog-post.json` can add a stylesheet to what `base.json` declares. A `title` on a layout never becomes the page's `<title>`, at any level: that is the page's own `title`, or the site's `name`. A layout that wraps itself, directly or through another layout, is a build error naming the chain."
  - "What merges", the `$head` bullet as `plan:site-architecture/head-and-layout-shape` leaves it: "merged site, then layout, then page" becomes "merged site, then each layout from the outermost in, then page". The rest of the bullet is unchanged.
- `docs/framework/site/seo.md`, "Merge order" item 3: "**Layout**: the layout document's `$head`" becomes "**Layout**: the layout document's `$head`, and when layouts nest, each one's, outermost first".
- `docs/studio/editing/frontmatter.md`: line 82's "the project's own `$head`, then the layout's, then the page's" becomes "the project's own `$head`, then the layout's (every layout in the chain, outermost first, when one wraps another), then the page's"; line 91's "_from Base_ for a layout" becomes "_from Base_ for a layout, naming the layout in the chain that set the value".
- `docs/studio/editing.md` states nothing about layouts and does not change.

No spec graduates; `plans/site-architecture/` stays. Landing deletes this file and removes `site-architecture/nested-layout-head` from `plan:site-architecture/page-context-props`' `requires`.

## Acceptance

- `bun test --isolate --coverage` passes from `packages/site`, `packages/compiler` and `packages/studio` with no per-file threshold failure; `bun scripts/check-coverage-manifest.ts <dir>` passes for each.
- `bun -e 'import { resolveLayout } from "./packages/site/src/layout.ts"; const L = { "./b.json": { title: "B", $head: [{ tagName: "meta", attributes: { name: "b" } }], children: [{ tagName: "slot" }] }, "./i.json": { $layout: "./b.json", title: "I", $head: [{ tagName: "link", attributes: { rel: "stylesheet", href: "/i.css" } }], children: [{ tagName: "slot" }] } }; const r = await resolveLayout({ $layout: "./i.json", $head: [{ tagName: "meta", attributes: { name: "p" } }] }, {}, (ref) => structuredClone(L[ref])); console.log(r.$head.length, r.title, r._pageTitle)'` prints `2 B undefined` (today it prints `1 B I`; the root's `B` is removed by the hosts under site-architecture.md §8.1).
- `timeout 20 bun -e 'import { resolveLayout } from "./packages/site/src/layout.ts"; const L = { "./a.json": { $layout: "./b.json" }, "./b.json": { $layout: "./a.json" } }; await resolveLayout({ $layout: "./a.json" }, {}, (ref) => structuredClone(L[ref])).catch((e) => console.log(e.name, e.message))'` prints `LayoutCycleError Layout cycle: ./a.json → ./b.json → ./a.json` (today it runs until the timeout kills it).
- A scratch project with the §5.4 fixture, built with `bunx jx build`, has `name="base"`, `href="/blog.css"` and the page's description in its `<head>`, and `<title>` equal to the project `name` for an untitled page.
- In Studio, a page on a layout that nests under a layout supplying a description shows that description in Search appearance as inherited from the outer layout, and files no `description-missing` Problem.
- `sed -n '/^### 5.4 /,/^### 5.5 /p' specs/site-architecture.md` shows `> **Status: Implemented.**`; `bun run plans:status --spec site-architecture` no longer lists `site-architecture.md#5.4`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
