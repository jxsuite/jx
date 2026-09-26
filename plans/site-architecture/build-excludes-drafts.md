---
status: stub
disposition: implement
claims:
  - site-architecture.md#7.6
size: M
workspaces:
  - packages/compiler
  - packages/server
  - extensions/parser
---

# A production build leaves draft entries out, and the dev server keeps them

## Context

`specs/site-architecture.md` §7.6, line 902:

> **Status: Partial.** The Studio half ships: the badge, the tab pill, the Library column and filter, and the explicit including-drafts perspective (`packages/studio/src/content/draft-state.ts`, `packages/studio/src/panels/tab-strip.ts`, `packages/studio/src/grid/sources/content-source.ts`). Production builds do not exclude drafts: neither the compiler nor the parser and feed extensions filter `draft: true`, as `DRAFT_MEANING` in `draft-state.ts` says in Studio's own words.

The section was unmarked before the census. `DRAFT_MEANING` reads "the build does not exclude them yet", and `packages/compiler/src/site/site-build.ts` names `$sitemap: false` as the interim escape hatch "until draft filtering lands in the build pipeline", as does §8.4.1.

**What exists**

- `DRAFT_FIELD`, `isDraftEntry` and the including-drafts perspective in `packages/studio/src/content/draft-state.ts`, with `packages/studio/tests/draft-state.test.ts` and `content-draft-wiring.test.ts`.
- One place every entry passes through: `loadContentType` in `extensions/parser/src/content-loader.ts`, which feeds route expansion (`Content.resolvePaths`), `ContentCollection` queries, feeds (`extensions/feed/src/feed.ts`) and the search index (`extensions/search/src/search-index.ts`).
- The dev server's pre-reload build (`buildSite(root, …)` in `packages/server/src/dev.ts`), which would need to opt drafts back in.

**What is missing**

- Draft filtering in production builds: an entry whose `draft` is literally `true` generates no route, is absent from every collection query, feed and search index, and never reaches the sitemap. Whether it filters at load time (one place) or per consumer is the main decision; a load-time filter must not break a reference from a published entry to a draft one, which then dangles like any unresolved id (site-architecture.md §6.3).
- A build option the dev server sets so drafts stay visible in development, and one `jx build` flag or config key for previewing a production build with drafts.
- Tests over a collection with a draft entry for each consumer, and the §8.4.1 sentence about the interim `$sitemap: false` escape hatch updated.

**Related**

- site-architecture.md §8.4.1 (sitemap), site-architecture.md §6.7 (feeds), site-architecture.md §4.3 (route expansion), site-architecture.md §12.2 (`jx dev` and `jx build`).
- parser.md (entry metadata) and extensions.md §8.4 (the `emit` capability feeds and search use).
