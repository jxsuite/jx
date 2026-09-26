---
status: stub
disposition: implement
claims:
  - site-architecture.md#4.3
size: M
workspaces:
  - packages/compiler
  - extensions/parser
---

# A collection can be paged into numbered routes

## Context

`specs/site-architecture.md` §4.3, line 288:

> **Status: Partial.** The three `$paths` shapes and the extension discriminator ship (`expandDynamicRoutes` in `packages/compiler/src/site/pages-discovery.ts`, `Content.resolvePaths` in `extensions/parser/src/content-loader.ts`). Pagination helpers are neither specified nor built: no `$paths` shape pages a collection into numbered routes, and `ContentCollection` takes a `limit` but no offset.

The section was unmarked before the census, and everything it specifies ships. The open part came from the retired implementation roadmap, whose Phase 5 listed "Pagination helpers" unchecked. No numbered section in any spec specifies pagination, so the row was moved onto the section that would own it: `$paths` is where a page declares the routes it generates, which is what a paginated index needs.

Disposition `implement`, because the roadmap recorded it as intended work. The detail phase may instead choose `defer` (an Implemented §4.3 with a `> **Status: Future.**` remainder) if nothing needs paged indexes yet; either way the contract has to be designed before any code, since nothing describes one today.

**What exists**

- `expandDynamicRoutes` and `resolvePathEntries` (`packages/compiler/src/site/pages-discovery.ts`), which expand `values`, `$ref` + `field` and extension-discriminated shapes into one route per entry.
- `queryContentType` (`extensions/parser/src/content.ts`), which honours `filter`, `sort` and `limit`.
- A pager in a different domain: `paginate` in `extensions/feed/src/shared.ts` chunks feed items by `pageSize` for RFC 5005 archives.

**What is missing**

- A contract: a `$paths` shape (for example a collection plus a page size) that yields `/blog/`, `/blog/2/`, … with the page number and the page's slice reachable from state, plus `ContentCollection` gaining an offset (or a page) so the slice can be queried.
- The previous/next and total-page values a template needs to render a pager, and how the first page's URL is spelled.
- Sitemap and translation behaviour for paged routes (site-architecture.md §8.4.1, site-architecture.md §13.5).

**Related**

- site-architecture.md §6.4 (querying collections) and site-architecture.md §6.7 (feeds, which page their own archives).
- extensions.md §8 (the `resolvePaths` capability a paged shape would dispatch through).
