---
status: drafted
disposition: reconcile
claims:
  - site-architecture.md#3
  - site-architecture.md#5.1
  - site-architecture.md#5.2
  - site-architecture.md#8.2
  - site-architecture.md#8.3
  - site-architecture.md#8.5
requires: []
workspaces:
  - specs
  - docs
size: S
---

# Every layout and `$head` example is written in the shape the build reads

## Context

Six sections of `specs/site-architecture.md` show head material and layouts in a shape the build has never read. Their markers:

§3, line 147:

> **Status: Partial.** `project.json` is the one required configuration file and its keys are read as §3.1 records. The example's `$head` is not in the shape the build reads: an entry's HTML attributes come only from `attributes` (`renderHeadEntry` in `packages/site/src/head-merger.ts`), so the top-level `name`, `content`, `rel` and `href` below are dropped, and the icon and font entries render as bare `<link>` tags.

§5.1, line 377:

> **Status: Partial.** Slot distribution ships (`distributeSlots` in `packages/site/src/layout.ts`). The example's shape does not: a layout is body content wrapped by the page shell (`packages/compiler/src/targets/compile-static.ts`), so an `html` root nests inside `<body>`, head material comes from the layout's `$head` rather than `<head>` children in its tree, and `$page.lang` is never set (§5.5 names it `$page.locale`).

§5.2, line 415:

> **Status: Partial.** `$layout`, its project-root resolution, the `defaults.layout` fallback and `$layout: false` ship (`resolveLayout` in `packages/site/src/layout.ts`, `packages/compiler/src/site/layout-resolver.ts`). The example's `$head` is not in the shape the build reads, as in §8.1: its `title` entry is discarded, because the title is the document's `title` property, and its top-level `name` and `content` are dropped.

§8.2, line 962:

> **Status: Partial.** `$head` values resolve against state, `$site` and `$page` (`resolveHeadTemplates` in `packages/compiler/src/site/site-build.ts`). The example diverges as §8.1's does: its templated `title` entry is discarded, since a templated title is the document's `title` property, and its top-level `name`, `content`, `rel` and `href` are never rendered.

§8.3, line 991:

> **Status: Partial.** The three layers merge in this order under the stated deduplication, auto-injected entries yield to authored ones, and the `rel` check ships (`mergeHead` and `headEntryKey` in `packages/site/src/head-merger.ts`, `packages/compiler/src/site/link-relations.ts`). Two statements do not match: the layout level is the layout document's `$head`, not `<head>` children in its tree, and a `<title>` in `$head` at any level is discarded rather than overriding, because `mergeHead` always writes the title from the document's `title` property.

§8.5, line 1040:

> **Status: Partial.** Object `textContent` serialization with templates resolved ships in the build and the interpreting runtime (`renderHeadEntry` in `packages/site/src/head-merger.ts`, `injectHead` in `packages/runtime/src/runtime.ts`). The example's shape does not: its `type` sits at the top level of the entry, where both read only `attributes`, so the block renders as a bare `<script>` that a browser runs as JavaScript instead of reading as JSON-LD. `packages/site/tests/head-merger.test.ts` pins the working form, `attributes: { "type": "application/ld+json" }`.

Verified at the audited tree:

- **Only `attributes` is read.** `renderHeadEntry` (head-merger.ts) builds the tag from `entry.attributes`, `entry.textContent` and `entry.children`, and `headEntryKey` dedupes on `attributes.name`, `.property`, `.rel`, `.href`. Every other reader agrees: `resolveHeadTemplates` and `resolveHeadBareSpecifiers` (site-build.ts) touch only `attributes` and `textContent`, `unregisteredHeadRelations` (`packages/compiler/src/site/link-relations.ts`) reads `attributes.rel`, the runtime's `injectHead` copies `entry.attributes`, and Studio's `metaContentIn` and `findMetaEntry` (`packages/studio/src/panels/head-panel.ts`) read `attributes.content`. A scratch `buildSite` of a page whose `$head` held `{ "tagName": "meta", "name": "description", "content": "flat" }` emitted a bare `<meta>`, and a flat-`type` JSON-LD entry emitted `<script>{ … }</script>`.
- **The title is a property.** `mergeHead` always sets the `title` key last from `context.title ?? context.siteName ?? "Jx Site"`, so a `<title>` entry at any level is overwritten. `packages/site/tests/head-merger.test.ts` pins it ("the resolved page title outranks a `<title>` any level authored"), and Studio's `seoWarnings` reports it as `head-title-ignored`.
- **A layout is body content.** `compileStaticPage` and `compileClient` (`packages/compiler/src/targets/`) write `<!DOCTYPE html><html lang><head>…</head><body>` around the compiled root. A scratch build of the §5.1 example rendered `<body><html lang="en" data-bind :lang="_t0"><head><title>…</title></head><body><main>…` inside the real `<body>`. The layout level of the merge is `layoutDoc.$head` (`compilePage` in site-build.ts, `composePage` in `packages/site/src/compose.ts`).
- **A `$ref` child is not a component.** §5.1's example (and §5.3's, which no plan claims) places chrome as `{ "$ref": "../components/header.json" }` children. spec.md §13.1 marks that form `Removed`: register the document in `$elements` and place it by tag. Every shipped layout does exactly that from a `div` root (`sites/jxsuite.com/layouts/base.json`, `packages/starters/sites/blog/layouts/base.json`), and none declares a `title` or a `$head`.
- **Nothing shipped uses the flat shape.** A scan of every `$head` in `sites/`, `packages/starters/`, `packages/create/` and `examples/` found no top-level key besides `tagName`, `attributes`, `textContent` and `children`. `docs/framework/site/seo.md` and `.claude/commands/jx.md` teach the `attributes` form. Three docs lines still carry the old model (see Specs & docs). One piece of shipped guidance teaches a `<title>` entry: Studio's AI system prompt ("Page metadata" in `packages/studio/src/services/ai-system-prompt.ts`). That is a source file, so `plan:site-architecture/head-and-layout-shape-root-title`, which already changes `packages/studio`, corrects it and this plan stays text only.

§3, §5.1, §5.2, §8.2 and §8.3 were unmarked before the census; §8.5 led with `Implemented`, and its rationale sits as a continuation paragraph under the census marker.

The census wrote one plan for these six anchors and site-architecture.md §8.1. This detail splits §8.1 out to `plan:site-architecture/head-and-layout-shape-root-title`, because §8.1 alone has a code half (a page's `title` renders as its root's tooltip when no layout wraps it) and the contract splits parts with different dispositions. What remains is text only, so it may land in the pull request that details the site-architecture plans.

## Outcome

- site-architecture.md §3 → Implemented (marker deleted). The example's `$head` uses `attributes`.
- site-architecture.md §5.1 → Implemented (marker deleted). The example is a `div`-rooted layout with its chrome in `$elements`, a `$head` entry and one `<slot>`, and a paragraph states that a layout is body content.
- site-architecture.md §5.2 → Implemented (marker deleted). The example carries a top-level `title` and an `attributes`-shaped description.
- site-architecture.md §8.2 → Implemented (marker deleted). The example templates the top-level `title` and the entries' `attributes`.
- site-architecture.md §8.3 → Implemented (marker deleted). The layout level is the layout's `$head`, and a `<title>` entry is stated as discarded.
- site-architecture.md §8.5 → Implemented (the pre-census marker restored). `type` sits under `attributes`.
- Ride-alongs in the same edit: the §5 intro, §5.3's layout example, and Appendix B's "SEO metadata" row.
- site-architecture.md §8.1 stays Partial until `plan:site-architecture/head-and-layout-shape-root-title` lands. The spec keeps other open items and does not graduate.

## Decisions

- **Decided:** reconcile the examples to the shipped shape (`{ tagName, attributes, textContent?, children? }` entries plus a top-level `title`), and do not teach `renderHeadEntry` and the runtime's `injectHead` to read top-level `name`, `content`, `rel`, `href` or `type`, which Appendix B's "standard element definitions" row could be read to promise. A head entry's keys never become DOM properties: the build writes the entry as markup and the runtime's `injectHead` calls `setAttribute` for each key of `attributes`, so honouring top-level keys means a property-to-attribute table (`httpEquiv`, `crossOrigin`, `className`) kept twice, in head-merger.ts and in the browser runtime. It also means a precedence rule for an entry that sets a key both ways, and a second shape for every other reader: `headEntryKey`, the template and bare-specifier passes, the `rel` check, the canonical check in `mergeHead`, and Studio's head panel. No shipped document needs it.
- **Decided:** §5.1's layout drops the `<title>` element and the `lang` binding instead of renaming `$page.lang` to `$page.locale`. The build writes `<title>`, `<html lang>` and `dir` itself (site-architecture.md §8.4, §13.4), so either binding would teach authors to restate, on the wrong element, what the shell already says. `<meta charset>` and the viewport go for the same reason.
- **Decided:** site-architecture.md §5.1's and §5.3's layouts register their chrome in `$elements` and place it by tag, as the shipped layouts do. spec.md §13.1 removed the bare `$ref` child, so keeping it here would contradict the core spec. §5.3 is unclaimed, and its example is the same layout-shape divergence, so it rides along.
- **Decided:** site-architecture.md §8.2 says templates resolve in a page's or layout's `$head`, not in every `$head`. `compilePage` runs `resolveHeadTemplates` over the page and layout heads only, and passes `projectConfig.$head` through `resolveHeadBareSpecifiers` alone.
- **Decided:** delete the five markers the census added to unmarked sections, and restore §8.5's pre-census `> **Status: Implemented.**` line with its rationale joined back onto it, which returns each section to the state the census found it in.
- **Decided:** site-architecture.md §8.3 names Studio's report of a discarded `<title>` entry and not a build warning. Whether the build warns is an Open decision in `plan:site-architecture/head-and-layout-shape-root-title`, and that plan adds the sentence if it does.

## Implementation

Text only. Every edit is in place; no heading is renumbered or removed.

1. **`specs/site-architecture.md`**: the eight edits listed in Specs & docs, then `bunx oxfmt specs/site-architecture.md` to re-pad Appendix B's table and lay out the JSON blocks. The nano-staged hook runs the same formatter.
2. **`docs/framework/site/layouts.md`**, **`docs/framework/site/seo.md`**, **`docs/framework/site/project-json.md`**: the three edits listed in Specs & docs.
3. **The fragment**, as given in Specs & docs.
4. **Landing**: delete this file and remove `site-architecture/head-and-layout-shape` from the `requires` of its three dependents, `plan:site-architecture/head-and-layout-shape-root-title`, `plan:site-architecture/nested-layout-head` and `plan:site-architecture/seo-structured-data-editor`. Replace every other `plan:` citation of this one with the sections it closed: today those three plus `plan:site-architecture/page-context-props`, `plan:spec/root-tagname-optional` and the first two spec-wide decisions in `plans/site-architecture/README.md` (`grep -rl 'plan:site-architecture/head-and-layout-shape[^-]' plans/` lists them). `bun run plans:check` fails on any edge or citation left dangling.

**Integration contract.** Once this lands:

- site-architecture.md §8.5's example is the `attributes`-shaped JSON-LD entry, and the build reads no top-level key of a head entry (the first Decision). `plan:site-architecture/seo-structured-data-editor` requires this plan for that decision: its editor writes that shape and recognises a JSON-LD entry by `attributes.type` alone.
- site-architecture.md §8.3 states that the layout level is the layout document's `$head` and that a `<title>` entry in any `$head` is discarded. Its item 2 is neutral about nesting, so `plan:site-architecture/nested-layout-head` can widen it to every layout level, outermost first, without undoing this text.
- site-architecture.md §5.1 states that a layout is body content. It gives a layout's `title` no meaning. What a layout's `title` contributes is `plan:site-architecture/nested-layout-head`'s question, and what reaches `$page.title` is `plan:site-architecture/page-context-props`'s.
- `docs/framework/site/seo.md` is edited only at its `rel` example, so `plan:site-architecture/head-and-layout-shape-root-title` can add its paragraph to "Page-level `$head`" without a conflict.

## Tests

No source or test file changes, so no workspace suite runs, no `coverageThreshold` moves, and the manifest check sees nothing new. The spec examples are prose, and the Acceptance scan checks them.

Gates that prove it:

- `bun run docs:status`: no open marker is left in the six sections, and §8.5's marker has a valid form.
- `bun run docs:spec-release`: the body change carries its fragment.
- `bun run plans:check`: the six anchors are neither open nor claimed.
- `bun run docs:check` and `bun run docs:links`: every heading stays, so the `site-architecture.md#3`, `#5` and `#8` anchors in docs frontmatter still resolve.
- `bun run docs:markdown`: no escaped heading.
- `bun run docs:prose`: the three docs edits add no em dash.

## Specs & docs

**`specs/site-architecture.md`**, in place:

1. **§3.** Delete the marker (line 147) and the blank line after it. In the example, the `$head` array becomes:

   ```json
   "$head": [
     {
       "tagName": "meta",
       "attributes": { "name": "viewport", "content": "width=device-width, initial-scale=1" }
     },
     { "tagName": "link", "attributes": { "rel": "icon", "href": "/favicon.svg" } },
     { "tagName": "link", "attributes": { "rel": "stylesheet", "href": "/fonts/inter.css" } }
   ],
   ```

   Nothing else in the example changes. `defaults.charset` is §3.1's, owned by `plan:site-architecture/project-defs-and-charset`.

2. **§5 intro** (line 373) becomes: "Layouts are Jx documents that provide the chrome shared across pages: navigation, a footer, and any other wrapper common to them. The document around them (`<!DOCTYPE html>`, `<html>`, `<head>` and `<body>`) is written by the build, not by a layout (§5.1)."

3. **§5.1.** Delete the marker (line 377) and the blank line after it. Keep the sentence introducing the example. Replace the example with:

   ```json
   {
     "tagName": "div",
     "$elements": [
       { "$ref": "../components/site-header.json" },
       { "$ref": "../components/site-footer.json" }
     ],
     "$head": [
       { "tagName": "link", "attributes": { "rel": "stylesheet", "href": "/styles/site.css" } }
     ],
     "children": [
       { "tagName": "site-header" },
       { "tagName": "main", "children": [{ "tagName": "slot" }] },
       { "tagName": "site-footer" }
     ]
   }
   ```

   Then add: "**A layout is body content.** The build writes the document around the composed page: `<!DOCTYPE html>`, `<html>` carrying the `lang` and `dir` of §8.4 and §13.4, the merged `<head>`, and `<body>`. A layout's root is the first element inside `<body>`, so it is an ordinary element such as a `div`. An `html`, `head` or `body` root would nest inside the real `<body>`. Head material a layout contributes is its own `$head`, the layout level of the merge (§8.3). `<meta charset>`, the viewport and `<title>` need no entry, because the build writes them (§8.4). A layout's chrome components are registered in its `$elements` and placed by tag, as in any document (`spec.md` §13.1)."

4. **§5.2.** Delete the marker (line 415) and the blank line after it. In the example, the `<title>` entry becomes a top-level `"title": "About Us"`, and the `$head` keeps one entry, `{ "tagName": "meta", "attributes": { "name": "description", "content": "Learn about our company" } }`. `$layout` and `children` are unchanged. "The page's `$head` entries merge with the layout's and site's head entries." becomes "The page's `$head` entries merge with the layout's and site's head entries (§8.3), and its `title` becomes the page's `<title>` (§8.4)."

5. **§5.3** (ride-along; no marker). Replace the first example, the `body`-rooted layout, with:

   ```json
   {
     "tagName": "div",
     "$elements": [
       { "$ref": "../components/site-header.json" },
       { "$ref": "../components/site-footer.json" }
     ],
     "children": [
       { "tagName": "site-header" },
       {
         "tagName": "aside",
         "children": [{ "tagName": "slot", "attributes": { "name": "sidebar" } }]
       },
       { "tagName": "main", "children": [{ "tagName": "slot" }] },
       { "tagName": "site-footer" }
     ]
   }
   ```

   The page example and both paragraphs are unchanged.

6. **§8.2.** Delete the marker (line 962) and the blank line after it. "Metadata values support template strings referencing state, `$site`, and `$page`:" becomes "The page's `title`, and the attribute values and `textContent` of a page's or layout's `$head` entries, support template strings referencing state, `$site` and `$page`:". The example becomes:

   ```json
   {
     "title": "${state.post.data.title} — ${$site.name}",
     "$head": [
       {
         "tagName": "meta",
         "attributes": { "name": "description", "content": "${state.post.data.description}" }
       },
       {
         "tagName": "link",
         "attributes": { "rel": "canonical", "href": "${$site.url}/blog/${$page.params.slug}" }
       }
     ]
   }
   ```

   The closing sentence about frontmatter is unchanged.

7. **§8.3.** Delete the marker (line 991) and the blank line after it. The list becomes:
   1. "**Site-level** (`project.json` `$head`): global meta tags, fonts, icons"
   2. "**Layout-level** (the layout document's `$head`, §5.1): shared stylesheets, scripts and other structural tags"
   3. "**Page-level** (the page's `$head`): the page's description, Open Graph tags and canonical link"

   "Later entries can override earlier entries. If both site and page define a `<title>`, the page's wins." becomes "Before them come the two entries the build injects itself, `<meta charset>` and the viewport (§8.4), and a later entry replaces an earlier one under the same key. The title is not merged from these layers: `<title>` is written from the page's `title` property after them (§8.4), so a `<title>` entry in any level's `$head` is discarded. Studio's Search appearance modal reports one (§8.6)." In the next paragraph, "Deduplication is by `tagName` plus the attribute that identifies the element:" becomes "Deduplication is by `tagName` plus the attribute, read from the entry's `attributes`, that identifies the element:". The `rel` paragraphs are unchanged.

8. **§8.5.** Replace the three marker lines (1040 to 1042) with one: `> **Status: Implemented.** A head entry's `textContent` may be an object;` followed by the rest of the current continuation paragraph, unchanged. In the example, `"type": "application/ld+json",` becomes `"attributes": { "type": "application/ld+json" },`. After "The compiler serializes the `textContent` object to a JSON string within the `<script>` tag, resolving template expressions first." add: "`type` is an HTML attribute like any other, so it goes under `attributes`. Without it the block is a plain `<script>`, which a browser runs as JavaScript rather than reading as JSON-LD."

9. **Appendix B** (ride-along). The "SEO metadata" row's second cell becomes "`$head` entries written as elements (`tagName`, with HTML attributes under `attributes`), and the document's `title` property".

**Fragment:** `bun run spec:change site-architecture.md minor -m "The project, layout, page, templated-metadata and structured-data examples use the head-entry shape the build reads, with HTML attributes under attributes and the page title as the document's title property; a layout is body content that registers its chrome in its elements list, and a title entry in any head list is discarded."` Level minor: a reconcile that redefines nothing an author could rely on, since the documented shape never rendered. The sentence carries no `$`, so the shell does not expand it.

**Docs** (no em dashes):

- **`docs/framework/site/layouts.md`** (`spec:` `site-architecture.md#5`).
  - Under "Layout documents", the example's `"tagName": "html"` root and its `body` wrapper become a `div` root whose children are `{ "tagName": "site-header" }` and the `main` holding the `<slot>`. `$elements` is kept.
  - The paragraph "A layout doesn't have to own `<html>`. …" becomes: "A layout is body content. The compiler writes the full HTML document around it, with `<html lang>`, the merged `<head>` and `<body>`, so a layout's root is an ordinary element such as a `div`, never `html`, `head` or `body`. jxsuite.com's docs layout is a flex `<div>` with a sidebar. Head material a layout needs, such as a shared stylesheet, goes in its own `$head`."
  - Under "Named slots", the layout example's `"tagName": "body"` root becomes `"tagName": "div"`, as in §5.3.
  - Under "What merges", the `$head` bullet becomes: "**`$head`**: merged site, then layout, then page, a later entry replacing an earlier one with the same identity; see [SEO and metadata](/docs/framework/site/seo). The page's `<title>` comes from its `title` property, not from a `$head` entry."
- **`docs/framework/site/seo.md`** (`spec:` `site-architecture.md#8`). The absolute-URI example under "A misspelled `rel` gets a warning" becomes `{ "tagName": "link", "attributes": { "rel": "https://example.com/rel/pricing", "href": "/pricing/" } }`. As written, it renders a bare `<link>`.
- **`docs/framework/site/project-json.md`** (`spec:` `site-architecture.md#3`). "A page's own `$head` appends to (and, for singletons like `<title>`, overrides) the site-level entries." becomes "A page's own `$head` appends to the site-level entries, and replaces one with the same identity, such as a second `<meta name="description">`. The page title is not a head entry: it is the page's `title` property."

No other page cites a claimed anchor. `docs/studio/editing/frontmatter.md` cites §8.6 and was checked: it states no entry shape.

## Acceptance

- `bun run plans:check --audit site-architecture` reports nothing for these six anchors.
- `bun run docs:status && bun run docs:spec-release && bun run docs:check && bun run docs:links && bun run docs:markdown && bun run docs:prose` pass.
- This scan prints each flat key left in a `$head` example, with its section. Before this plan it prints 27 lines in §3, §5.2, §8.1, §8.2 and §8.5. After it, only §8.1's 14 remain, until `plan:site-architecture/head-and-layout-shape-root-title` lands:

  ````sh
  bun -e 'const t=await Bun.file("specs/site-architecture.md").text();for(const m of t.matchAll(/```json\n([\s\S]*?)```/g)){let d;try{d=JSON.parse(m[1])}catch{continue}const h=t.slice(0,m.index).split("\n").findLast((l)=>/^#{2,3} \d/.test(l));for(const e of d.$head??[])for(const k of Object.keys(e))if(!["tagName","attributes","textContent","children"].includes(k))console.log(h,e.tagName,k)}'
  ````

- `grep -n '"tagName": "\(html\|head\|body\)"' specs/site-architecture.md docs/framework/site/layouts.md` prints nothing. Neither §5.1 nor §5.3 has a `children` entry that is a bare `{ "$ref": … }`.
