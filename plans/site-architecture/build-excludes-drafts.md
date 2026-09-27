---
status: drafted
disposition: implement
claims:
  - site-architecture.md#7.6
requires: []
workspaces:
  - packages/schema
  - extensions/parser
  - packages/compiler
  - packages/server
  - packages/studio
  - scripts
size: M
---

# A production build leaves draft entries out, and the dev server keeps them

## Context

`specs/site-architecture.md` §7.6, line 904:

> **Status: Partial.** The Studio half ships: the badge, the tab pill, the Library column and filter, and the explicit including-drafts perspective (`packages/studio/src/content/draft-state.ts`, `packages/studio/src/panels/tab-strip.ts`, `packages/studio/src/grid/sources/content-source.ts`). Production builds do not exclude drafts: neither the compiler nor the parser and feed extensions filter `draft: true`, as `DRAFT_MEANING` in `draft-state.ts` says in Studio's own words.

Verified against the code. No TypeScript source under `packages/compiler/src`, `packages/server/src`, `packages/site/src` or `extensions/*/src` reads a `draft` field; the only mention is the interim comment beside `excludeFromSitemap` in `compilePage` (`packages/compiler/src/site/site-build.ts`), and §8.4.1 line 1030 still offers `$sitemap: false` for "drafts while build-time draft filtering is still pending". `packages/compiler/tests/content-types.test.ts` pins today's behaviour: its `draft-post.md` loads (`blog.length` 3), expands to `/blog/draft-post` and is written to `dist/`. `docs/studio/projects/content-types.md` carries a `:::doc-warning` saying the same.

**One seam carries every consumer.** `buildSite` calls `loadProjectSections` (`packages/compiler/src/site/project-sections.ts`), which calls each section owner's `projectData`; the parser's `Content.projectData` (`extensions/parser/src/content-loader.ts`) returns the `content` Map, and everything a draft could leak through reads that Map:

- routes: `expandDynamicRoutes` (`pages-discovery.ts`) → `Content.resolvePaths(pathsDef, { data })`, and the sitemap is built from the expanded routes;
- page state: `resolvePrototypes` hands `sections` to `ContentCollection` and `ContentEntry` (`extensions/parser/src/content.ts`) as `_project.content`;
- emitted files: step 6e passes `sections` to `emit`, where `Feed.emit` (`extensions/feed/src/feed.ts`) and `SearchIndex.emit` (`extensions/search/src/search-index.ts`) read `ctx.sections.content`;
- relationships: `resolveContentTypeRefs` runs inside `projectData`, so an entry's reference to another is embedded before any consumer sees it.

The other `loadProjectSections` host is `loadProjectEntry` in `packages/server/src/resolve.ts`, behind `/__jx_resolve__`: the dev server, Studio's canvas and param picker, the desktop `jxResolve` twin and the live preview. All of those are development views. The dev server's pre-reload build is `buildSite(root, { verbose: false })` in `startDev` (`packages/server/src/dev.ts`). Other `buildSite` callers (`jx build`, Studio's Build Site via `/__studio/build` and `project-session.ts`, `packages/import/src/verify.ts`, `scripts/screenshots/thumbnails.ts`) are production builds.

**What is missing:** the filter, a host flag that keeps drafts for development, a `jx build` flag to preview a production build with drafts, tests per consumer, and the §7.6, §8.4.1 and §12.2 text.

## Outcome

- site-architecture.md §7.6 → Implemented: a `jx build` omits every `content` entry whose `draft` is `true` from routes, collection and entry queries, feeds, the search index and the sitemap; `jx dev`, Studio and `jx build --include-drafts` keep them.
- extensions.md §8 gains the `includeDrafts` host-context key on `projectData` (additive; its marker, owned by `plan:extensions/connector-table-paths`, is untouched).
- Studio's `DRAFT_MEANING` and the docs stop saying the build ships drafts.

## Decisions

- **Decided:** filter in `Content.projectData`, after every content type has loaded and validated and before `resolveContentTypeRefs`, because that Map is the one thing every consumer above reads, and the compiler host stays ignorant of section shapes (extensions.md §1). Filtering the loaded Map rather than inside `loadContentType` also leaves its three branches alone, so it cannot conflict with `plan:parser/uniform-entry-dates` or `plan:_shared/collection-directive-elements`, and a draft's schema warnings still print, which an author wants before publishing.
- **Decided:** the host says what it wants with a boolean `includeDrafts` on the `projectData` context, and absent means exclude, in both `loadProjectSections` and `Content.projectData`. Forgetting the flag then costs a missing draft in a development view, which is visible and harmless, rather than a published draft, which is neither. `resolve.ts` and `dev.ts` pass `true`.
- **Decided:** a draft is an entry whose `draft` field is the literal `true`, whatever the schema declares, defined once in a new `@jxsuite/schema/draft` that Studio's `isDraftEntry` delegates to, because the build and the badge disagreeing is exactly the failure §7.6's first bullet exists to prevent, and schema is the one package both already import. A present, non-boolean `draft` (`"true"` from a CSV column the schema does not type) publishes the entry and warns once, matching the `search: false` rule in extensions.md §8.4 and what the Studio pill already shows.
- **Decided:** the rule covers `content` section entries only. Pages have no draft axis, `$sitemap: false` remains the per-page sitemap opt-out, and `MarkdownCollection` (parser.md §6) globs files outside the section with its own `filter`, so it is out of scope and §7.6 says so.
- **Decided:** a build that leaves drafts out logs one line naming them (`Content: 2 draft entries left out: blog/wip, authors/jane`), because an author looking for a missing page needs the reason in the build output, and it is not a warning.
- **Open:** a published entry that references a draft entry. Recommendation: leave the stored id unresolved and warn that the target is a draft left out of this build, exactly as §6.3 treats an id that matches no entry, because resolving it first would embed the draft's fields in a published page, which is the leak §7.6 guards against.
- **Open:** how to preview a production build with drafts. Recommendation: a `jx build --include-drafts` flag and no `project.json` key, because a committed key would make every CI deploy ship drafts without anyone typing anything.
- **Open:** Studio's Build Site command. Recommendation: it stays a production build (drafts left out) and ignores the including-drafts perspective, because its stated job is answering "does my site build?", and Open in Browser's live preview already shows drafts through `resolve.ts`. This needs no Studio code.

## Implementation

1. **`packages/schema/src/draft.ts`** (new; export `"./draft": "./src/draft.ts"` in `packages/schema/package.json`): `export const DRAFT_FIELD = "draft"` and `export function isDraft(fields: Record<string, unknown> | null | undefined): boolean` returning `fields?.[DRAFT_FIELD] === true`. Module doc cites site-architecture.md §7.6.
2. **`extensions/parser/src/content-loader.ts`**:
   - `ProjectDataContext` gains `includeDrafts?: boolean`.
   - New exported `excludeDraftEntries(contentTypes: Map<string, ContentLoaderEntry[]>): { data: Map<string, ContentLoaderEntry[]>; drafts: Map<string, Set<string>> }`: a new Map without entries where `isDraft(entry.data)`, plus the left-out ids per type. An entry whose `draft` is present and not boolean stays and draws one `Content drafts: "<type>/<id>" sets draft to <json>; only the boolean true marks a draft, so it is published` warning. A localized entry is judged alone, so a draft translation leaves its siblings in.
   - `resolveContentTypeRefs(contentTypes, section, drafts?: ReadonlyMap<string, ReadonlySet<string>>)`: in both the to-one and to-many miss branches, when `drafts?.get(target)?.has(id)`, the warning reads `… references draft "<target>" entry "<id>", left out of this build` instead of `references missing`. The value stays the bare id either way.
   - `Content.projectData`: `const loaded = await loadContentSection(…)`; when `ctx.includeDrafts !== true`, run `excludeDraftEntries`, log the one summary line if any were left out, and pass `drafts` to `resolveContentTypeRefs`; otherwise resolve `loaded` as today.
3. **`extensions/parser/src/Content.class.json`**: the `projectData` `ctx` parameter gains `"includeDrafts": { "type": "boolean" }`, and its description names it.
4. **`packages/compiler/src/site/project-sections.ts`**: `loadProjectSections(projectRoot, projectConfig, registry, options: { includeDrafts?: boolean } = {})` adds `includeDrafts: options.includeDrafts === true` to every `projectData` context. The doc comment says the flag is the host's publication intent and only section owners with drafts read it.
5. **`packages/compiler/src/site/site-build.ts`**: `buildSite`'s options gain `includeDrafts?: boolean` (JSDoc cites §7.6), passed to `loadProjectSections` at step 3b. Rewrite the `excludeFromSitemap` comment in `compilePage` to drop "interim escape hatch until draft filtering lands"; a draft entry never becomes a route.
6. **`packages/compiler/src/cli.ts`**: `build` reads `--include-drafts` and calls `buildSite(projectRoot, { clean, verbose, ...(includeDrafts && { includeDrafts: true }) })`, so the existing `cli-units-build-*` expectations of `{ clean, verbose }` hold. Add the flag to the `--help` Options block and the module doc line.
7. **`packages/server/src/dev.ts`**: `startDev`'s rebuild calls `buildSite(root, { includeDrafts: true, verbose: false })`; the module doc says its builds keep drafts.
8. **`packages/server/src/resolve.ts`**: `loadProjectEntry` calls `loadProjectSections(projectRoot, config, registry, { includeDrafts: true })`, with a comment that everything this host serves is a development view.
9. **`packages/studio/src/content/draft-state.ts`**: `DRAFT_FIELD` re-exports the schema constant and `isDraftEntry` delegates to `isDraft`. The module doc's "ONE runtime dependency" becomes two, `reactivity` and `@jxsuite/schema/draft`, neither of which imports a Studio module, so the `import/no-cycle` argument it makes still holds. `DRAFT_MEANING` becomes `"Marked a draft. Studio filters drafts out of its own lists, and a production build leaves them out; the dev server and previews still show them."`, and its doc comment is rewritten to say the build now matches.
10. **`scripts/ci/affected.ts`**: the `EXTRA_EDGES` entry whose patterns are `extensions/feed/src/**` and `extensions/parser/src/**` gains `extensions/search/src/**`, `packages/compiler/tests/site-build-drafts.test.ts` in `evidence`, and a clause in `why` saying the drafts suite builds with the search extension too.

`Feed`, `SearchIndex`, `ContentCollection`, `ContentEntry`, `resolvePaths` and the sitemap need no change: they read the filtered Map.

**Integration contract.** Once this lands, `Content.projectData` (and so `sections.content` in every compiler step and `_project.content` in every resolved class) contains no entry for which `isDraft(entry.data)` is true unless its host passed `includeDrafts: true`. `buildSite(root, { includeDrafts })` defaults to excluding; `loadProjectSections(…, { includeDrafts })` defaults to excluding; `resolve.ts` and the dev server always include. `@jxsuite/schema/draft` exports `DRAFT_FIELD` and `isDraft`. A later plan that derives output from a collection (`plan:site-architecture/collection-pagination`, `plan:site-architecture/incremental-builds`) inherits the rule by reading `sections.content` and must not re-read content sources itself.

## Tests

Every suite runs as `bun test --isolate --coverage` from its workspace directory. Per-file thresholds: `packages/schema` 0.99/0.99, `extensions/parser` 0.987/0.975, `packages/compiler` 0.982/0.98, `packages/server` 0.96/0.95, `packages/studio` 0.958/0.941 (lines/functions, each workspace's `bunfig.toml`); every new branch is covered, and a raised worst file is ratcheted.

- **`packages/schema/tests/draft.test.ts`** (new; the manifest check fails without it): `isDraft` is true only for the literal `true`, false for `"true"`, `1`, `false`, `{}`, `null` and `undefined`; `DRAFT_FIELD` is `"draft"`.
- **`extensions/parser/tests/content-loader.test.ts`**, new `describe("drafts (site-architecture.md §7.6)")` over a fixture with `posts/` (`live.md` with `draft: false`, `wip.md` with `draft: true`, `plain.md` with none, `odd.md` with `draft: "true"`), `authors/` JSON (`jane` with `"draft": true`, `joe` without) and a `posts` schema with `author: { $ref: "#/content/authors" }` and `reviewers` as a to-many ref:
  - "a production load leaves out entries whose draft is true": `projectData` without the flag returns posts `live`, `plain`, `odd` and authors `joe`.
  - "includeDrafts keeps every entry": all four posts and both authors.
  - "a non-boolean draft is published and warned about once": `odd` is present and exactly one warning names `posts/odd`.
  - "a reference to a draft stays an id and says why": `live`'s `author: jane` is the string `"jane"`, a to-many `["jane", "joe"]` becomes `["jane", <joe entry>]`, and the warning contains `draft "authors" entry "jane"`; with the flag both resolve.
  - "resolvePaths expands no route for a draft": `Content.resolvePaths` over the production data yields no `wip`.
  - "a draft translation leaves its siblings": a `{locale}` source with `en/a.md` published and `fr/a.md` a draft keeps only the `en` entry.
  - "the summary line names what was left out": one `console.log` naming `posts/wip` and `authors/jane`; none when nothing was.
  - "the descriptor declares the host flag": `Content.class.json`'s `projectData` ctx has `includeDrafts` of type `boolean`.
- **`packages/compiler/tests/project-sections.test.ts`**: the fixture's `withdata.js` echoes `ctx.includeDrafts`; the existing dispatch case expects `includeDrafts: false`, and "passes includeDrafts through when the host sets it" expects `true`.
- **`packages/compiler/tests/content-types.test.ts`**: the production `sections` now hold two blog entries, `/blog/draft-post` leaves the expansion list, and the `buildSite` case expects seven routes and no `dist/blog/draft-post/index.html`; new "includeDrafts builds the draft" asserts all three come back with `{ includeDrafts: true }`.
- **`packages/compiler/tests/site-build-drafts.test.ts`** (new, end to end): a temp project with `url`, `extensions: ["@jxsuite/parser", "@jxsuite/feed", "@jxsuite/search"]`, `posts` (Markdown: `hello.md` published, `wip.md` titled "Secret Plan" with `draft: true`), `feed` and `search` sections over `posts` at `/blog/`, `pages/blog/[slug].json` with `$paths: { contentType: "posts" }` and a `ContentEntry`, and `pages/blog/index.json` listing an unfiltered `ContentCollection`. Default build: no `dist/blog/wip/index.html`; `dist/blog/index.html`, `dist/feed.xml`, `dist/feed.json` and `dist/sitemap.xml` do not contain "Secret Plan" or `/blog/wip`; `dist/search-index.json` has no document whose `slug` is `wip`. A second build with `{ includeDrafts: true }` has all of them.
- **`packages/compiler/tests/cli-units-build-drafts.test.ts`** (new, one footprint per file per `_cli-harness.ts`): `jx build --include-drafts` calls `buildSite` with `{ clean: true, includeDrafts: true, verbose: false }`.
- **`packages/server/tests/dev-drafts.test.ts`** (new): `mock.module("@jxsuite/compiler/site")` with a recording `buildSite` before importing `../src/dev.ts`; `startDev` over a temp root with a `project.json` records `includeDrafts: true`. The double is the witness CLAUDE.md asks for, since `startDev` imports the compiler lazily.
- **`packages/server/tests/resolve-drafts.test.ts`** (new): `mock.module("@jxsuite/compiler/project-sections")` with a recording `loadProjectSections`, then `projectAssetMounts(root)` over a temp project records `{ includeDrafts: true }`.
- **`packages/studio/tests/draft-state.test.ts`**: the `DRAFT_MEANING` case flips to asserting the sentence contains "a production build leaves them out" and no longer "does not exclude them yet"; the existing `isDraftEntry` cases stay as the delegation's proof.
- **`scripts`**: `bun test --isolate scripts` (the `changes` job) proves the edited edge, whose evidence paths are `existsSync`-checked.

## Specs & docs

**site-architecture.md**, in place:

- §7.6 line 904's marker becomes:

  > **Status: Implemented.** Studio shows the badge, the tab pill, the Library column and filter, and the explicit including-drafts perspective (`packages/studio/src/content/draft-state.ts`, `packages/studio/src/panels/tab-strip.ts`, `packages/studio/src/grid/sources/content-source.ts`). The build leaves drafts out as the `content` section loads (`Content.projectData` in `extensions/parser/src/content-loader.ts`, the predicate in `packages/schema/src/draft.ts`) unless its host asks for them, which the dev server and `resolve.ts` always do and `jx build` does with `--include-drafts` (`packages/server/src/dev.ts`, `packages/server/src/resolve.ts`, `packages/compiler/src/cli.ts`).

- §7.6's "Excluded from production builds by default" bullet becomes: "Excluded from production builds by default. An entry is a draft when its `draft` field is the literal `true`, whatever its schema declares, the same test the badge applies; any other value publishes it, and a non-boolean one draws a warning. A draft is dropped as the `content` section loads, before relationships resolve, so it generates no route, is absent from every `ContentCollection` and `ContentEntry` result, every feed and the search index, and never reaches the sitemap (§8.4.1). A published entry's reference to a draft is left unresolved with a warning that names the draft, like any id that matches no entry (§6.3)."
- The "Included in dev server builds for preview" bullet becomes: "Included in dev server builds for preview: `jx dev`'s builds, Studio's canvas and its live preview all load drafts, and `jx build --include-drafts` builds a production site with them for a check before publishing."
- After the bullets, one sentence: "The rule covers the entries of the `content` section; a `MarkdownCollection` (parser.md §6) globs files outside it and has no draft rule of its own."
- §8.4.1 line 1030 becomes: "**Per-page opt-out.** A page sets `$sitemap: false` at its root to be excluded (e.g. thank-you pages). Every other page is included. A draft entry (§7.6) generates no page, so it needs no opt-out."
- §12.2: under `# Production build` add `jx build --include-drafts  # The same, keeping draft entries (§7.6)`, and the paragraph gains, after the dev server sentence: "The dev server's builds keep draft entries; `jx build` leaves them out unless `--include-drafts` is passed."
- Fragment: `bun run spec:change site-architecture.md minor -m "§7.6 a production build leaves out every content entry whose draft field is true, from routes, collection queries, feeds, the search index and the sitemap, while the dev server, Studio and jx build --include-drafts keep them; §8.4.1 and §12.2 say so."`

**extensions.md**, in place (no marker change): §8's `projectData` row signature becomes `(sectionValue, { projectConfig, root, registry, io, includeDrafts }) → unknown`, and a paragraph after the `_meta` one reads: "**`includeDrafts` is the host's publication intent.** It is `false`, or absent, for a production build and `true` for the dev server, Studio and `jx build --include-drafts`. A section owner whose entries can be drafts leaves them out unless it is `true`, before anything else reads them; the parser's `Content` does (site-architecture.md §7.6). An owner without drafts ignores it." Re-pad the table with `bun run format`. Fragment: `bun run spec:change extensions.md minor -m "§8 the projectData host context gains includeDrafts, which a production build leaves false so a section owner can drop draft entries before anything reads them."`

This does not graduate site-architecture.md: other items stay open.

**Docs** (no em dashes). `bun run docs:sync` names the pages whose `code:` lists a changed file:

- `docs/framework/site/content-collections.md`: add `site-architecture.md#7.6` to `spec:`; new `## Drafts` section before `## Relationships`: an entry with `draft: true` is left out of `jx build` entirely (no page, and absent from listings, `ContentEntry`, feeds, the search index and the sitemap); `jx dev` and Studio show it; `jx build --include-drafts` builds it for a check; only the boolean `true` counts; a reference to a draft stays an id. The `filter: { draft: false }` example stays, since it still matters under `jx dev`.
- `docs/studio/projects/content-types.md`: the `:::doc-warning` becomes a `:::doc-note`: "Marking an entry a draft keeps it out of Studio's listings and out of a production build: `jx build` gives it no page, and no listing, feed, search index or sitemap includes it. `jx dev` and Studio's previews still show it, and `jx build --include-drafts` builds it for a check before publishing."
- `docs/framework/site/relationships.md`: after line 72 add "A reference to a draft entry is treated the same way in a production build, with a warning that names the draft, so a published page never carries a draft's fields."
- `docs/framework/build/cli.md`: the `jx build` synopsis gains `[--include-drafts]` and the table a row, "`--include-drafts` | Build draft content entries too, to check them before publishing."
- `docs/framework/build/dev-server.md` line 50: append "Its builds keep draft content entries, which `jx build` leaves out."
- `docs/framework/site/seo.md` line 176: "(a thank-you page, a draft)" becomes "(a thank-you page, say)", and add "A draft content entry has no page to opt out: the build leaves it out entirely."
- `docs/extending/extensions/capabilities.md` line 62 and `docs/extending/extensions/project-sections.md` line 44: the signature gains `includeDrafts`; `project-sections.md` adds one sentence after line 47 saying the site build passes `false` unless asked and the dev server passes `true`, and that the parser drops draft entries when it is not `true`.
- Named by `docs:sync` with no change: `docs/framework/build.md`, `docs/framework/site/deployment.md`, `docs/framework/site/redirects.md`, `docs/framework/concepts/color-schemes.md`, `docs/extending/embedding/dev-server.md`.

## Acceptance

- `bun test --isolate --coverage` passes in `packages/schema`, `extensions/parser`, `packages/compiler`, `packages/server` and `packages/studio`, and `bun scripts/check-coverage-manifest.ts <dir>` is green for each; `bun test --isolate scripts` passes.
- `grep -rn "draft filtering lands\|still pending\|does not exclude them yet" packages specs/site-architecture.md docs` finds nothing.
- In a scratch site (`url` set, parser extension, a `posts` Markdown collection with `a.md` and `b.md` carrying `draft: true`, `pages/posts/[slug].json` expanding it): `jx build` writes no `dist/posts/b/`, no `/posts/b` in `dist/sitemap.xml`, and prints `Content: 1 draft entry left out: posts/b`; `jx build --include-drafts` writes it; `jx dev` serves `/posts/b/`.
- `bun run docs:status`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:spec-release` and `bun run plans:check` are green; `bun run plans:status --spec site-architecture` no longer lists `site-architecture.md#7.6`.
