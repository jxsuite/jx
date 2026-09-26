---
status: stub
disposition: implement
claims:
  - imports.md#6
  - parser.md#7
requires:
  - imports/cem-discovery-on-every-backend
size: L
workspaces:
  - extensions/parser
  - packages/compiler
  - packages/site
---

# A content collection's `$elements` resolve to tag names, register wherever its entries render, and restrict the custom-element directives its markdown may use

## Context

imports.md §6 and parser.md §7 state one restriction from two sides: a collection's `$elements` become the directive plugin's `allowedNames`. The census stubbed them separately and split the work (the parser.md §7 plan owned the directive-name check and the ungating of directive parsing; the imports.md §6 plan owned the effective set that check consumes, registration where entries render, and the example). Each stub said §6 cannot flip until the other lands, and the check cannot be written without the set the other builds, so the two would have required each other. `plans/README.md` resolves a would-be `requires` cycle by merging, and the cross-spec review asked for that; this plan is the merge, which the imports audit record and both census stubs had already named as the alternative to drawing the edge.

`specs/imports.md` §6, line 185:

> **Status: Partial.** The `injectContext()` merge in the last paragraph ships (`packages/site/src/context.ts`), and `loadContentType` (`extensions/parser/src/content-loader.ts`) derives `allowedNames` from a content type's `$elements`, but nothing enforces it: `processMarkdown` (`extensions/parser/src/md.ts`) uses `directiveOptions` only to switch on an unconfigured `remark-directive` (so a collection that declares no `$elements` parses no directives at all), no `MarkdownDirective` plugin exists, and the values are raw specifiers and `$ref` paths rather than tag names. Collection `$elements` are never merged with site-level `$elements` for rendering (nothing outside tests reads `getContentTypeElements`), and the example is stale: the section is `content.<type>` (`extensions/parser/schemas/project.fragment.schema.json`), not `contentTypes` or `collections`, and `format` names a class such as `Markdown`, not `md`.

`specs/parser.md` §7, line 165:

> **Status: Partial.** The directive-to-element mapping ships in `mdastNodeToJx` (`extensions/parser/src/transpile.ts`): text, leaf and container directives, dot-path expansion, `$`-keyword mapping, pseudo-class and media style keys, and the `--title`/`--description` annotations. The `allowedNames` restriction does not: `loadContentType` (`extensions/parser/src/content-loader.ts`) derives it from the content type's `$elements` and passes it through `Markdown.load`, but `processMarkdown` (`extensions/parser/src/md.ts`) only treats `directiveOptions` as a switch for an unconfigured `remark-directive`, and no `MarkdownDirective` plugin exists. So `$elements` works only as an on/off switch: the loader never passes `directives`, a collection that declares any `$elements` accepts every directive name, and one that declares none parses no directives at all, leaving them as literal paragraph text.

Both sections were unmarked before the census. Disposition `implement`, as both originals chose: two specs state the restriction, the parser's schema fragment describes `content.<type>.$elements` as "Custom elements available in markdown directives for this content type", and the loader already derives and forwards the list, so the intent is clear and only the resolution, the enforcement and the registration are missing. What the key does today is switch directive parsing on for a collection's entries; it restricts nothing and registers nothing. If the detail phase decides that restricting directive names is not wanted, the disposition becomes `reconcile`, and because both claims now sit in one plan, §6's paragraph and §7's `allowedNames` sentence are rewritten together in one vocabulary.

It requires `plan:imports/cem-discovery-on-every-backend`: resolving an npm specifier in a collection's `$elements` to the tag names a directive can use needs a package's Custom Elements Manifest, and the only CEM scan in the repository is inline in the dev server's `GET /__studio/components` handler (`packages/server/src/studio-api.ts`, the `customElements` read and the `decl.customElement && decl.tagName` mapping), which that plan extracts into a function over a project directory. The integration contract this plan needs from it is a home the set's resolver can reach: that plan proposes `packages/server`, because the desktop session already imports server modules, but none of this plan's workspaces (`extensions/parser`, `packages/compiler`, `packages/site`) depends on `@jxsuite/server`; all three depend on `@jxsuite/schema`, where the shared `componentMetaFrom` already lives. The two plans settle that home together at detail.

**What exists**

- `injectContext` in `packages/site/src/context.ts`, reached from the build through `packages/compiler/src/site/context-injection.ts` (site-level into page-level `$elements`, union and dedup); `packages/site/tests/context.test.ts`.
- `loadContentType` in `extensions/parser/src/content-loader.ts` builds `directiveOptions.allowedNames` from the type's own `contentTypeDef.$elements` (string entries as-is, object entries by their `$ref`), with no site-level entries, and hands it to both the remote and the local `load` calls. `getContentTypeElements` in the same file is read only by `extensions/parser/tests/content-loader.test.ts`.
- `MarkdownLoadOptions.directiveOptions` in `extensions/parser/src/markdown.ts`, documented as "Options for the MarkdownDirective plugin (allowedNames, prefix, ...)", forwarded to `processMarkdown`.
- `processMarkdown` in `extensions/parser/src/md.ts` applies `remark-directive` with no options when `directives` or `directiveOptions` is set; `mdastNodeToJx` in `extensions/parser/src/transpile.ts` maps every directive node, whatever its name.
- Directive parsing in loaded content is gated on a non-empty `$elements`. `directiveOptions` is `undefined` unless `$elements` has entries, and neither `load` call in `loadContentType` passes `directives`, so in a collection that declares no `$elements` every directive (a custom element, an HTML element such as `:kbd[…]`, a prototype such as `:::Array`) stays literal paragraph text. `Markdown.parse` (`transpileJxMarkdown`, `extensions/parser/src/transpile.ts`) always applies `remark-directive`, so the same file parses differently as a page than as a collection entry. No starter's content type declares `$elements` (`packages/starters/sites/*/project.json`).
- A live case: `examples/project.json`'s `posts` collection declares no `$elements`, while `examples/content/posts/interactive-post.md` uses `:::info-box{type="warning"}`, `:jx-tooltip[…]` and `::user-card{…}`. Measured at b900b326: `Markdown.load` with the loader's options for that collection leaves `:::info-box{type="warning"}` as literal text in a `p`; with `directiveOptions: { allowedNames: [] }` it yields `info-box`, `jx-tooltip` and `user-card` elements.
- Tests pin only the plumbing: `extensions/parser/tests/content-loader.test.ts` ("passes $elements-derived allowedNames in directive options") and `extensions/parser/tests/md-units.test.ts` ("directiveOptions alone also enables the directive plugin", and "directives are inert without the directives option").
- The build's npm registration in `packages/compiler/src/site/site-build.ts` (`injectNpmElementScripts`), which reads only the page's and the layout's `$elements`, so an npm package a collection names is never bundled for the pages that render its entries. The imports.md §6 stub said project components are "covered anyway" by `injectComponentScripts`' scan of the rendered HTML; checked against the code, that holds only for a `$ref` to a file directly in `components/`. `buildSite` lists that directory non-recursively (step 5, `readdirSync(componentsDir)`) and compiles those files plus their own `$elements` dependencies, and `injectComponentScripts` scans only for that compiled set, so a collection `$ref` to a component anywhere else ships as an empty tag with no module. That gap is not this plan's: it is the one imports.md §1.3 and §1.4 and site-architecture.md §10.3 now mark for page- and layout-level `$ref` entries, and a collection entry inherits whatever those items decide.
- The dev server's composer (`packages/site/src/compose.ts`) unions the page's and layout's `$elements`, runs `injectContext`, and discovers used project components (`discoverElements`); it reads no collection's `$elements`.

**What is missing**

- Directive parsing in `Markdown.load` from the loader that does not depend on `$elements` being declared: §7 maps directives to elements and makes `$elements` only the allowlist, so an absent list means unrestricted, not directives off. The detail phase also decides what an empty `$elements` (`[]`) means.
- The effective set: a collection's `$elements` unioned with the site-level `$elements`, deduplicated as imports.md §1.4 does, and resolved to tag names (a `$ref` to its component's `tagName`, an npm specifier through its Custom Elements Manifest, imports.md §2, via the required plan's scan) before the check reads it.
- A check, in `processMarkdown` or as a remark plugin run there, that judges each directive name against that set and reports a disallowed one naming the entry and the directive.
- The scope of the restriction: markdown-native and HTML element directives (`:::div`, `::section`, `:kbd[…]`) and prototype directives (`:::Array`) should stay legal wherever directives parse (today they parse in a collection only when it declares `$elements`), so the allowlist plausibly governs custom-element names only.
- The outcome for a disallowed name: a warning in the content loader's existing `console.warn` channel (site-architecture.md §6.3 reports content validation findings as build warnings) or a build error, and whether the node is kept, dropped or rendered as an unknown element.
- Registration where entries render: a page or template that renders a collection's entries imports that collection's npm `$elements` in the build (`packages/compiler/src/site/site-build.ts`) and in the dev server's composer (`packages/site/src/compose.ts`), so a directive naming a package's element upgrades rather than staying an unknown tag. The detail phase decides where a page learns which collections it renders.
- The stale "MarkdownDirective plugin" wording in `extensions/parser/src/markdown.ts`, made true or removed.
- imports.md §6's example rewritten to `content.<type>` with `"format": "Markdown"`, and "`project.json `collections``" in its first sentence corrected to the `content` section.

The re-estimate is `L` because the merge spans three workspaces and two decisions (the restriction's scope and outcome, and where a page learns its collections). The work has one natural seam for the detail phase's slices: ungating directive parsing touches only `extensions/parser` and can land first on its own, while the check consumes the resolved set, so it lands with or after the set and the registration.

**Related**

- `plan:imports/cem-discovery-on-every-backend` (required: the CEM scan that turns an npm specifier into tag names).
- imports.md §1.3 and §1.4 (the union and dedup rule; the build's non-recursive component compile that a collection `$ref` outside `components/` also meets), imports.md §2 (CEM tag names).
- site-architecture.md §10.3 (component scoping, the same build gap from the site side), site-architecture.md §6 (content collections), site-architecture.md §6.3 (content validation findings are build warnings).
- parser.md §9 (`Content`, the class that owns the `content` section), extensions.md §3.1 (section keys).
- jx-markdown.md §4 (directive syntax), jx-markdown.md §6.5 (prototype directives).
