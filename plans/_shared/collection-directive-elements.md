---
status: drafted
disposition: implement
claims:
  - imports.md#6
  - parser.md#7
requires:
  - imports/cem-discovery-on-every-backend
size: L
workspaces:
  - extensions/parser
  - packages/schema
  - packages/compiler
  - packages/runtime
  - docs
  - scripts
---

# A content collection's `$elements` resolve to tag names, restrict the custom-element directives its markdown may use, and register on every page that renders its entries

## Context

imports.md §6 and parser.md §7 state one rule from two sides: a collection's `$elements` become the directive plugin's `allowedNames`. The census stubbed them separately, and each half needed the other (the check consumes the set; §6 cannot flip without the check), so the would-be `requires` cycle was merged here.

`specs/imports.md` §6, line 185:

> **Status: Partial.** The `injectContext()` merge in the last paragraph ships (`packages/site/src/context.ts`), and `loadContentType` (`extensions/parser/src/content-loader.ts`) derives `allowedNames` from a content type's `$elements`, but nothing enforces it: `processMarkdown` (`extensions/parser/src/md.ts`) uses `directiveOptions` only to switch on an unconfigured `remark-directive` (so a collection that declares no `$elements` parses no directives at all), no `MarkdownDirective` plugin exists, and the values are raw specifiers and `$ref` paths rather than tag names. Collection `$elements` are never merged with site-level `$elements` for rendering (nothing outside tests reads `getContentTypeElements`), and the example is stale: the section is `content.<type>` (`extensions/parser/schemas/project.fragment.schema.json`), not `contentTypes` or `collections`, and `format` names a class such as `Markdown`, not `md`.

`specs/parser.md` §7, line 165:

> **Status: Partial.** The directive-to-element mapping ships in `mdastNodeToJx` (`extensions/parser/src/transpile.ts`): text, leaf and container directives, dot-path expansion, `$`-keyword mapping, pseudo-class and media style keys, and the `--title`/`--description` annotations. The `allowedNames` restriction does not: `loadContentType` (`extensions/parser/src/content-loader.ts`) derives it from the content type's `$elements` and passes it through `Markdown.load`, but `processMarkdown` (`extensions/parser/src/md.ts`) only treats `directiveOptions` as a switch for an unconfigured `remark-directive`, and no `MarkdownDirective` plugin exists. So `$elements` works only as an on/off switch: the loader never passes `directives`, a collection that declares any `$elements` accepts every directive name, and one that declares none parses no directives at all, leaving them as literal paragraph text.

Both markers hold at `1127bfbe`. What the code does, checked for this detail:

- **The switch.** `loadContentType` builds `directiveOptions.allowedNames` from the type's own `$elements` (string entries as-is, object entries by `$ref`) only when the list is non-empty, and passes it to both `load` calls; `processMarkdown` applies bare `remark-directive` when `directives` or `directiveOptions` is set; `mdastNodeToJx` maps every directive whatever its name. `Markdown.parse` (`transpileJxMarkdown`) always applies `remark-directive`, and Studio opens a `.md` file through `parse`, so the same entry parses differently in Studio and in the loader. Tests pin only the plumbing: `content-loader.test.ts` ("passes $elements-derived allowedNames in directive options"), `md-units.test.ts` ("directives are inert without the directives option", "directiveOptions alone also enables the directive plugin").
- **Who declares it.** One first-party collection does: `sites/jxsuite.com`'s `docs` (`{ $ref }` to `doc-note`, `doc-tip`, `doc-warning`, all directly in `sites/jxsuite.com/components/`). No starter's content type does. `examples/project.json`'s `posts` does not, while `examples/content/posts/interactive-post.md` uses `:::info-box`, `:jx-tooltip[…]` and `::user-card` (only `user-card` exists, as `examples/components/user-card.json`).
- **Measured, directives on vs off**, over every `.md` under `packages/starters/sites` and `examples/content`: the only content file whose tree changes is `interactive-post.md`, which gains its three elements. Everything else that changes is a page, already parsed by `Markdown.parse`.
- **Measured, text directives in prose.** `processMarkdown("Ratio 3:2 and key:value", …, { directives: true })` yields elements tagged `2` and `value`. The `docs` collection already parses directives, and at this commit 33 hyphenated directive names in it are prose, not components: 28 in the generated `docs/extending/reference/spec-changelog.md` (`gap:ai-problem-details` renders an `ai-problem-details` element), one in the generated `docs/studio/interface/commands.md` (`:popover-open`), and four on line 31 of the hand-written `docs/studio/design/states-and-selectors.md` (`**:focus-within**`; its `**:hover**` renders a `hover` element).
- **Where entries render.** Core treats extension sections as opaque (the `ProjectConfig` comment in `packages/schema/types.ts`), so neither the build nor the composer may read `content.<type>.$elements`. `ContentLoaderEntry`, though, is a core type (`packages/schema/types.ts`), and resolved entries reach a page as state: in the build through `resolvePrototypes` (`packages/compiler/src/site/prototype-resolver.ts`; `ContentEntry.resolve` in `extensions/parser/src/content.ts` returns the loader's entry object, `ContentCollection.resolve` an array of them), and in an interpreting host (dev server, live preview, Studio canvas) through `POST /__jx_resolve__` (`resolveViaDevProxy` in `packages/runtime/src/runtime.ts`, which a bare `$src` or a `#/$context/` class always takes). The composer (`packages/site/src/compose.ts`) resolves no state.
- **Registration today.** `compilePage` in `packages/compiler/src/site/site-build.ts` bundles the bare-string `$elements` of the layout-wrapped document and the page (`isNpmElementEntry`, `registerElementBundle`, `injectNpmElementScripts`). A project component directly in `components/` gets its module from `injectComponentScripts`' HTML scan, which is why jxsuite.com's `doc-note` works; a `$ref` anywhere else is imports.md §1.3's gap, owned by `plan:_shared/component-discovery`.
- **The CEM scan.** The only one is inline in `GET /__studio/components` (`packages/server/src/studio-api.ts`). `extensions/parser` depends on `@jxsuite/schema` and `@jxsuite/markup` only, and `@jxsuite/server` depends on the compiler and dev-depends on the parser, so the parser can reach an extracted scan only if it lives in `@jxsuite/schema`.

What is missing: directive parsing in content that does not hang on `$elements`; an effective set of tag names (the collection's and the project's entries, resolved); a check that reports a directive outside it; registration of a collection's `$elements` where its entries render; and §6's example and wording.

## Outcome

- parser.md §7 → Implemented (CDE1.1). `Markdown.load` parses directives unless told not to; the `MarkdownDirective` plugin (`markdownDirective`) reports a hyphenated directive name outside `allowedNames`; the loader passes tag names and turns each report into a build warning.
- imports.md §6 → Implemented (CDE1.2). Its text states the effective set, the restriction and registration, with a `content.<type>` example. After CDE1.1 its marker is narrowed to registration alone.
- Unchanged, and owned elsewhere: the Studio canvas and palette for an entry opened directly (imports.md §1.4's canvas half, `plan:imports/canvas-project-context`; studio.md §5.4); compiling a `$ref` outside `components/` (imports.md §1.3, `plan:_shared/component-discovery`); `processMarkdown`, `MarkdownCollection` and `Markdown`'s instance `resolve`, which keep directives opt-in; `getContentTypeElements`, a published export that stays.

## Decisions

- **Open:** Does content loading always parse directives, and which collections are restricted? Recommendation: `Markdown.load` parses directives unless `directives: false`, and only a collection that declares `$elements` (an empty `[]` included) is restricted; one that declares none is not. Because parser.md §7 makes `$elements` an allowlist over the dialect, not its switch; `Markdown.parse` and Studio already parse these files with directives; and treating an absent list as "no custom elements" would flag every collection whose elements are registered by a template page or a `$head` script instead. The cost is prose: `key:value` in an undeclared collection becomes a text directive, as it already does in any `.md` page. Measured, no starter or example content changes except `interactive-post.md`, which gains the elements it was written with.
- **Open:** What the effective set admits. Recommendation: the collection's `$elements`, the project's `$elements` (deduplicated by resolved path, imports.md §1.4) and every component §1.4 discovers (`components/<tag>.json`), and only a name containing a hyphen is checked. Because §1.4 makes undeclared project components part of every document's effective set, so excluding them would force a re-declaration per collection; and a name without a hyphen is an HTML element or a prototype directive (`:::Array`, jx-markdown.md §6.5), which `$elements` never declares. The alternative, a curated list of the collection's own entries only, is the choice if a collection should fence authors in rather than catch unknown elements; under the recommendation jxsuite.com's declaration adds nothing, since all three components are in `components/`.
- **Open:** What a disallowed name does. Recommendation: a build warning in the loader's `Content validation:` form naming `<type>/<id>`, the line and the directive, with the node kept as authored. Because site-architecture.md §6.3 reports content findings as warnings and lets the build continue, dropped markup is unrecoverable for the reader, and failing a site build over a word in prose is out of proportion. The 33 names in Context are all genuine mis-renders; CDE1.3 removes them so the check starts clean.
- **Open:** Do a collection's `$elements` register on the pages that render its entries? Recommendation: yes, by entries carrying their collection's declaration (below). Because a package a collection may name but nothing loads renders inert tags with no error, `docs/framework/site/content-collections.md` already says the collection "registers" its components, and the alternative (§6 restricts only, and the author declares the package again on the template page) keeps two lists that must agree by hand. The cost: a page that lists a collection's titles also loads its packages, since the build cannot tell which state a template renders.
- **Decided:** the CEM scan this plan reads is exported from `@jxsuite/schema` (a function over a project directory returning `source: "npm"` entries with `package`, `modulePath` and `tagName`), because that is the only home the parser can depend on without a cycle (Context). `plan:imports/cem-discovery-on-every-backend` extracts it there.
- **Decided:** the check is a remark transformer, `markdownDirective`, that `processMarkdown` runs after `remark-directive` and that reports through `directiveOptions.onDisallowed`; the loader writes the warning. Because that makes the "`MarkdownDirective` plugin" both specs name a real export, and the loader is the one place that knows the content type and entry id site-architecture.md §6.3 keys warnings by.
- **Decided:** a bare string whose tags cannot be read (not an installed dependency with a `customElements` manifest, or an absolute URL) leaves the collection unrestricted, with one warning per specifier per load. Flagging every tag of a package the loader cannot read would be noise the author can silence only by deleting the declaration. A `$ref` that resolves to no hyphenated `tagName` is the author's error: it warns and adds no tag, and the restriction stands.
- **Decided:** entries carry their collection's own declaration verbatim (`ContentLoaderEntry.$elements`, project-root-relative), not the union with the project's, because project `$elements` already reach every page through `injectContext`. A page reads them from its resolved state one level deep (a state value, or the items of an array value): the build after `resolvePrototypes`, the runtime when `/__jx_resolve__` answers. Nothing reads the `content` section outside the parser.
- **Decided:** a carried `{ $ref }` compiles under whatever rule a page's own `$ref` does (imports.md §1.3): today the HTML scan covers a component directly in `components/`, and `plan:_shared/component-discovery` widens it. No `requires` edge, since neither plan's code needs the other's; whichever lands second feeds the carried `$ref`s to the other's collector (Integration contract).

## Implementation

**CDE1.3, prose the check would report** (independent; land it first or with CDE1.1).

- `docs/studio/design/states-and-selectors.md` line 31: put each pseudo-class in a code span (``**`:hover`**``), so none parses as a directive.
- `scripts/docs/generators/shared.ts`: `escapeTextDirectives(text)` backslash-escapes a `:` that is followed by a letter and not preceded by `:` or `\`, outside backtick code spans. Apply it to each changelog sentence in `spec-changelog.ts` and each command title and description cell in `studio-commands.ts` (`generateCommands`).

**CDE1.1, the check** (`extensions/parser`, `packages/schema`).

- `packages/schema/src/element-entries.ts` (new, exported as `./element-entries`): `npmTagsFor(specifier, components): string[] | null`, the rule `enabledNpmTags` in `packages/studio/src/panels/elements-panel.ts` applies: `package/modulePath` names that declaration's tag, a bare `package` names all of its tags, `null` when nothing matches. Pure; it takes the scan's entries as a parameter.
- `extensions/parser/src/markdown-directive.ts` (new): `MarkdownDirectiveOptions { allowedNames?: readonly string[]; onDisallowed?: (d: DisallowedDirective) => void }`, `DisallowedDirective { name: string; line: number | undefined }`, and `markdownDirective(options)`, a unified attacher whose transformer walks `containerDirective`, `leafDirective` and `textDirective` nodes and reports each whose name contains `-` and whose lowercase is not in `allowedNames`. With no `allowedNames` it returns without walking. Re-export both from `md.ts`.
- `processMarkdown` (`md.ts`): `directiveOptions` typed as `MarkdownDirectiveOptions`; when directives are on, `.use(remarkDirective).use(markdownDirective, config.directiveOptions ?? {})`. Its default stays off.
- `Markdown.load` (`markdown.ts`): pass `directives: options.directives ?? true`. `MarkdownLoadOptions.directiveOptions` typed, and its comment ("Options for the MarkdownDirective plugin (allowedNames, prefix, ...)") rewritten to name the two options. In `Markdown.class.json`, the `load` parameter `directives` gains `"default": true`.
- `content-loader.ts`:
  - `projectComponentTags(root)`: the tag of every `components/<tag>.json` file, by the pattern `COMPONENT_FILE` in `packages/site/src/compose.ts` uses.
  - `effectiveDirectiveNames(name, def, ctx)` → `string[] | undefined`. `undefined` when `def.$elements` is not an array. Otherwise the union of `def.$elements` and `ctx.projectElements`, keyed by `resolve(root, $ref)` or by string. A `$ref` reads its document (`.json` through `parseJxDocument` from `@jxsuite/schema/parse`, another extension through `formats.byExtension(ext, "parse")`) and contributes its hyphenated `tagName`, or warns. A bare string contributes `npmTagsFor(spec, await ctx.npmComponents())`, or on `null` warns once and returns `undefined`. Add `projectComponentTags(root)`; return the sorted tags.
  - `loadContentSection` builds `ctx` once: `projectElements` from `projectConfig?.$elements`, `npmComponents` as a memoized lazy call to the scan over `root`, and a `warned` set. `loadContentType` takes it as a new trailing parameter.
  - `loadContentType` replaces the derivation at lines 507–515. When the names are defined, each `load` call gets `{ allowedNames, onDisallowed }`, where `onDisallowed` collects findings for that file; after `load` returns, each finding warns `Content validation: "<type>/<id>" line <n>: directive "<name>" is not in this content type's $elements`, with `<id>` the file's first entry id (the source URL for a remote load).
- The spec edits, the README and the two docs sentences under **Specs & docs**.

**CDE1.2, registration** (`packages/schema`, `extensions/parser`, `packages/compiler`, `packages/runtime`).

- `packages/schema/types.ts`: `ContentLoaderEntry.$elements?: (string | { $ref: string })[]`, commented as the collection's declaration, carried so a page that renders the entry registers it.
- `element-entries.ts`: `carriedElements(value)`. An object with an array `$elements` yields its entries; an array yields the union over its object items; the result is deduplicated by string or `$ref`, and nothing deeper is walked.
- `loadContentType`: when `def.$elements` is a non-empty array, every returned entry (remote, JSON and format branches) gets `$elements = def.$elements`.
- `compilePage` (`site-build.ts`): directly after `resolvePrototypes`, and so before state stripping, collect `carried` as the deduplicated `carriedElements` of every value in `layoutDoc.state`. The `npmElements` list adds `carried` to the layout's and page's entries, under the same `isNpmElementEntry` filter and `registerElementBundle`.
- `resolveViaDevProxy` (`runtime.ts`): in both resolution callbacks, after `s.value = value`, run `const carried = carriedElements(value); if (carried.length > 0) void registerElements(carried, base ?? document.baseURI);`. `registerElements` already skips a defined tag and warns on a failed import.

**Integration contract.** Once CDE1.2 lands:

- `@jxsuite/schema/element-entries` exports `npmTagsFor` and `carriedElements`.
- Every entry of a collection that declares a non-empty `$elements` carries it verbatim as `ContentLoaderEntry.$elements`.
- `@jxsuite/parser` exports `markdownDirective` and `MarkdownDirectiveOptions`, and `Markdown.load` parses directives by default.
- In the build, `carried` in `compilePage` holds a page's collection entries after `resolvePrototypes`, and `carriedElements` over `sections.content` gives every collection `$ref` before components compile. `plan:_shared/component-discovery`, landing after, resolves those `$ref`s against the project root in its collector; landing before, it exposes the collector that this plan feeds them to.
- An interpreting host's runtime registers the `$elements` of any value `/__jx_resolve__` returns.

## Tests

Run from each workspace directory with `bun test --isolate --coverage`. Per-file thresholds are in each `bunfig.toml`: `extensions/parser` lines 0.987 and functions 0.975, `packages/schema` 0.99/0.99, `packages/compiler` 0.982/0.98, `packages/runtime` 0.963/0.98. Ratchet one when a slice raises its worst file. The two new source files ship with their tests, or `check-coverage-manifest.ts` fails. `markdown-directive.ts` is imported statically by `md.ts` and by its own test, so Bun's dropped coverage for overlapping dynamic imports cannot hide it.

- **CDE1.3** (`bun test --isolate scripts`): `scripts/docs/generators/shared.test.ts` gains "escapeTextDirectives escapes a colon before a letter", which asserts `gap:ui-anchor` becomes `gap\:ui-anchor` while `::before`, `https://x` and a backtick span are unchanged. `spec-changelog.test.ts` gains a sentence containing `gap:` rendered escaped.
- **CDE1.1**:
  - new `extensions/parser/tests/markdown-directive.test.ts`:
    - "reports container, leaf and text directives outside allowedNames with their line"
    - "accepts an allowed name whatever its case"
    - "never reports an HTML element or prototype directive" (`:::div`, `:kbd[x]`, `:::Array`)
    - "walks nothing without allowedNames"
    - "an empty allowedNames reports every hyphenated directive"
  - `md-units.test.ts`: "directiveOptions.onDisallowed receives each disallowed directive". The two opt-in cases stay as they are.
  - `markdown.test.ts`: "Markdown.load parses directives by default"; "directives: false leaves them literal".
  - `content-loader.test.ts`. The fixture adds a `components/x-card.json` named by `{ $ref }`, a discovered `components/y-note.json`, and `node_modules/fake-els` with a `customElements` manifest declaring `fake-alert` (`dist/alert.js`) and `fake-badge`, listed in the fixture's `package.json`.
    - "resolves $elements to tag names" replaces "passes $elements-derived allowedNames in directive options". `$elements: [{ $ref: "./components/x-card.json" }, "fake-els/dist/alert.js"]` plus a project entry yields exactly `fake-alert`, the project's tag, `x-card` and `y-note`.
    - "an undeclared $elements passes no allowedNames"
    - "an empty $elements restricts to the project's set"
    - "a $ref that is not a component warns and adds no tag"
    - "a specifier without a manifest leaves the collection unrestricted and warns once across collections"
    - "warns once per disallowed directive with type/id and line", through the real `Markdown` format
    - "a collection without $elements parses its directives", on the `interactive-post.md` shape
  - `packages/schema/tests/element-entries.test.ts` (new): `npmTagsFor` by package, by `package/modulePath`, and unknown giving `null`.
- **CDE1.2**:
  - `content-loader.test.ts`: "stamps each entry with its collection's $elements"; "entries of a collection without $elements carry none".
  - `element-entries.test.ts`, for `carriedElements`: an object, an array of entries, dedup, a non-array `$elements` ignored, nested values not walked.
  - `packages/compiler/tests/content-types.test.ts`, with a collection declaring `$elements: ["@shoelace-style/shoelace/dist/components/button/button.js"]` (the specifier `site-build.test.ts` already bundles) and a `[slug]` page resolving `ContentEntry`:
    - "a page whose state resolves an entry bundles its collection's npm $elements": exactly one `/assets/elements-*.js` module script, and the file exists
    - "a page that resolves no entry of it gets no bundle"
  - `packages/runtime/tests/runtime-gaps-resolve.test.ts`, with the fetch mock that file already uses:
    - "a proxied value carrying $elements registers them": the proxy answers with an entry whose `$elements`is`[{ $ref: "./x-note.json" }]`, and `customElements.get("x-note")` is defined once settled
    - "an array of proxied entries registers their union once"
    - "a proxied value without $elements fetches nothing more"

## Specs & docs

**CDE1.1.**

- parser.md §7. Remove the marker. Keep the first paragraph's mapping sentences and replace "Content-type `$elements` become the plugin's `allowedNames`." with:

  > `Markdown.load` parses directives unless `directives: false` is passed; `processMarkdown`, `MarkdownCollection` and `Markdown`'s instance `resolve` parse them only with `directives: true` or `directiveOptions`. The `MarkdownDirective` plugin (`markdownDirective`) takes two `directiveOptions`. `allowedNames` holds the tag names a content type's effective `$elements` resolve to (imports.md §6): a directive whose name contains a hyphen and is not among them is reported, HTML element directives and prototype directives (jx-markdown.md §6.5) never are, and without `allowedNames` nothing is. `onDisallowed` is called with `{ name, line }` for each report; the content loader turns it into a build warning naming the content type, the entry and the line (site-architecture.md §6.3), and the directive is kept as authored.

- imports.md §6. Replace everything above the `injectContext()` paragraph, which stays, with:

  > A content type in `project.json`'s `content` section (parser.md §9) may declare `$elements`, in the two forms of §1.3 and relative to the project root as project-level `$elements` are:
  >
  > ```json
  > {
  >   "content": {
  >     "blog": {
  >       "source": "./content/blog/",
  >       "format": "Markdown",
  >       "$elements": ["@shoelace-style/shoelace", { "$ref": "./components/callout.json" }]
  >     }
  >   }
  > }
  > ```
  >
  > A Markdown entry's directives always parse (parser.md §7). A content type that declares `$elements`, even an empty list, restricts its entries' custom-element directives to its **effective set**: its own `$elements`, the project's `$elements` (deduplicated by the path each resolves to, §1.4) and the components §1.4 discovers (`components/<tag>.json`), resolved to tag names. A `{ $ref }` resolves to its component's `tagName`; a bare specifier to the tags its package's Custom Elements Manifest declares (§2), every tag for a package name and one for a `package/modulePath`. The tag names are the `allowedNames` of the `MarkdownDirective` plugin (parser.md §7). A directive whose name contains a hyphen and is not in the set is a build warning naming the content type, the entry, the line and the name, and is kept as authored; HTML element directives (`:::div`, `:kbd[…]`) and prototype directives (`:::Array`) are never restricted. A bare specifier with no readable manifest leaves the content type unrestricted, with a warning naming it; a `$ref` that resolves to no component is a warning and adds nothing.

  The marker is narrowed to:

  > **Status: Partial.** A page that renders a collection's entries does not register the collection's `$elements`: the build bundles only the page's and its layout's bare specifiers (`compilePage` in `packages/compiler/src/site/site-build.ts`), and an interpreting host registers only the composed document's (`packages/site/src/compose.ts`), so a package a collection names is allowed in its directives but never loaded.

- Fragments:
  - `bun run spec:change parser.md minor -m "Content loading parses directives whether or not a collection declares elements, and the MarkdownDirective plugin reports a custom-element directive outside allowedNames."`
  - `bun run spec:change imports.md minor -m "A content collection's elements resolve to tag names, merged with the project's and its discovered components, and restrict the custom-element directives its entries may use."`
- Docs:
  - `docs/framework/site/content-collections.md` (`code:` lists `content-loader.ts` and `md.ts`): the `$elements` bullet becomes "the components entries may use as directives, in the same forms as a page's `$elements`. Directives parse whether or not you declare it. Declaring it turns on a check: a directive naming a custom element (a name with a hyphen) that is not in this list, the project's `$elements` or the project's `components/` folder is reported as a build warning. jxsuite.com declares `doc-note`, `doc-tip` and `doc-warning` for these docs."
  - `docs/framework/site/jx-markdown.md`, after "any registered custom element": "In a content collection that declares `$elements`, a custom-element directive outside that set is reported as a build warning (see [Content collections](/docs/framework/site/content-collections))."
  - `extensions/parser/README.md`, the Directives paragraph's last sentence, to the same effect. It is a shipped README, so `docs:prose` applies and no em dashes.

**CDE1.2.**

- imports.md §6. Insert before the `injectContext()` paragraph:

  > Every entry of a content type that declares `$elements` carries them, and a page whose state resolves an entry (a `ContentEntry`, or the entries of a `ContentCollection`) registers them as though it declared them. The build bundles the bare specifiers with the page's own (§1.3); an interpreting host's runtime registers both forms when `/__jx_resolve__` returns the entry, and a `$ref` resolves against the document base, as a project-level one does.

  Remove the marker, which makes the section Implemented.

- Fragment: `bun run spec:change imports.md minor -m "A page registers the elements of each content collection whose entries its state resolves, in the build and in interpreting hosts."`
- Docs: `content-collections.md`'s bullet gains "Every page that shows one of the collection's entries also loads the packages the list names."

**CDE1.3**: no spec edit.

**No other page changes.** `bun run docs:sync` also names the pages whose `code:` lists `site-build.ts` (`build.md`, `seo.md`, `redirects.md`, `deployment.md`, `color-schemes.md`), `runtime.ts` (`elements.md`, `components.md`, `reactivity.md`, `props-and-scope.md`, `styling.md`, `overlays.md`, `runtime-host.md`, `contributing/docs.md`) or `content-loader.ts` (`relationships.md`). None describes collection registration; the pull request says so. `extensions.md` §8's `load` row (`directiveOptions`) and its mirrors in `docs/extending/extensions/capabilities.md` and `formats.md` stay true. The fragment's `$elements` description in `project.fragment.schema.json` stays, so no schema regenerates.

**Graduation.** Neither spec graduates here while its other plans are open. If CDE1.2 closes the last open item of imports.md or parser.md (check `bun run plans:status --spec imports` and `--spec parser`), that pull request sets the header to Implemented, runs `bun run spec:bump <spec> patch` in place, and deletes `plans/<stem>/`.

## Acceptance

- `bun run plans:check` reports `parser.md#7` closed after CDE1.1 and `imports.md#6` after CDE1.2. The CDE1.2 pull request deletes this file.
- In `extensions/parser`, `packages/schema`, `packages/compiler` and `packages/runtime`: `bun test --isolate --coverage` is green, followed by `bun scripts/check-coverage-manifest.ts <workspace>`. `bun test --isolate scripts` is green.
- `Markdown.load("examples/content/posts/interactive-post.md")`, with no options, yields `info-box`, `jx-tooltip` and `user-card` elements (this is the census measurement, inverted).
- A scratch project whose `blog` collection declares `$elements: ["@shoelace-style/shoelace/dist/components/button/button.js"]` and whose entry uses `:::sl-button` and `:::sl-buton`:
  - `jx build` warns once, naming `blog/<id>`, the line and `sl-buton`
  - the page rendering the entry carries one `/assets/elements-*.js` script, and the listing page that resolves no entry carries none
  - the live preview of the entry's page defines `sl-button`.
- `jx build` in `sites/jxsuite.com` prints no "is not in this content type's $elements" warning once CDE1.3 has landed.
- `git grep -n "prefix, ..." extensions/parser/src` finds nothing.
- These are green: `bun run docs:status`, `docs:check`, `docs:links`, `docs:prose`, `docs:markdown`, `docs:spec-release`, `docs:standards`.

## Slices

| Slice  | Scope                                                                                                                                   | Claims       | State |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----- |
| CDE1.1 | Directives parse in content loading; the effective set resolved to tag names; `markdownDirective` and its warnings; §6 restriction text | parser.md#7  | open  |
| CDE1.2 | Entries carry `$elements`; the build bundles and the runtime registers them; §6 → Implemented                                           | imports.md#6 | open  |
| CDE1.3 | Escape the first-party prose the check would report: one hand-written docs line, and the changelog and commands generators              | —            | open  |
