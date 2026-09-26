---
status: stub
disposition: implement
claims:
  - site-architecture.md#4.4
size: S
workspaces:
  - packages/site
---

# A more specific dynamic route outranks a less specific one, not only a catch-all

## Context

`specs/site-architecture.md` §4.4, line 337:

> **Status: Partial.** Rules 1, 2 and 4 ship (`compareRoutes` in `packages/site/src/routes.ts`, the `_` exclusion in `packages/compiler/src/site/pages-discovery.ts`). Rule 3 holds only against a catch-all: two dynamic routes with no catch-all are ordered alphabetically, so `/:category/:id` sorts ahead of `/blog/:slug` and `matchRoute` answers `/blog/x` with it.

The section was unmarked before the census. The auditor probed it: sorting `[category]/[id].json` and `blog/[slug].json` gives `["/:category/:id", "/blog/:slug"]`, and `matchRoute("/blog/x")` returns `/:category/:id`.

**What exists**

- `compareRoutes` (`packages/site/src/routes.ts`): static before dynamic, named before catch-all, then `localeCompare` on the pattern.
- `matchRoute`, which takes the first hit in table order by design, so the table order is the whole of specificity; the dev server and Studio both rely on it.
- `packages/site/tests/routes.test.ts`.

**What is missing**

- A specificity comparison between dynamic routes: static segments weighted over parameters segment by segment (Astro's rule, which the section cites), so `/blog/:slug` sorts before `/:category/:id`.
- A decision on what the build does when two expanded routes produce the same concrete URL (today the later write wins silently), since specificity also decides that.
- Tests for the probed case and for equal-specificity ties.

**Related**

- site-architecture.md §4 (route pattern validation) and site-architecture.md §4.2 (the bracket syntax).
