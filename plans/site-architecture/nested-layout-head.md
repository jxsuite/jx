---
status: stub
disposition: implement
claims:
  - site-architecture.md#5.4
size: S
workspaces:
  - packages/site
  - packages/compiler
---

# A nested layout's `$head` merges as layout head, outermost layout first

## Context

`specs/site-architecture.md` §5.4, line 491:

> **Status: Partial.** A layout's own `$layout` resolves recursively and the slots compose (`resolveLayout` in `packages/site/src/layout.ts`). An intermediate layout's `$head` does not survive as layout head: the inner resolution records it as the page's (`_pageHead`), so it is dropped when the page declares its own `$head` and is otherwise merged at page level, and only the outermost layout's `$head` is merged as the layout level (`compilePage` in `packages/compiler/src/site/site-build.ts`, `composePage` in `packages/site/src/compose.ts`).

The section was unmarked before the census, and the first audit listed it as verified; a review traced the head path through a nested resolution. With `base.json` (`$head`: a `meta`), `blog.json` (`$layout: base`, `$head`: a stylesheet `link`) and a page on `blog.json` with its own `$head`, the merged head holds the base `meta` and the page's entries, and the blog stylesheet is gone. §5.2's rule that "the page's `$head` entries merge with the layout's and site's head entries" already expects every layout level to contribute.

**What exists**

- `resolveLayout` in `packages/site/src/layout.ts`: the recursive call resolves the inner layout as if it were a page, so that layout's `$head` lands on `merged._pageHead` and its `title` on `merged._pageTitle`; the outer call then overwrites `_pageHead` with the real page's `$head` when there is one. Tests in `packages/site/tests/layout.test.ts`.
- Two hosts that read the result the same way: `compilePage` in `packages/compiler/src/site/site-build.ts` and `composePage` in `packages/site/src/compose.ts`, each taking `pageHead = pageDoc.$head ?? merged._pageHead` and `layoutHead = merged.$head` (the outermost layout's only).
- `mergeHead` in `packages/site/src/head-merger.ts`, whose layout argument is one array; a concatenation of every layout level, outermost first, fits it without a signature change.

**What is missing**

- `resolveLayout` accumulating `$head` per layout level, outermost first, into the layout layer rather than into the page carrier, and both hosts reading it.
- A decision on an intermediate layout's `title`, which reaches `_pageTitle` today and so becomes the page title when the page has none.
- Tests: a three-level head merge in `packages/site/tests/layout.test.ts`, and one in the compiler's site-build suite so the build and the canvas are pinned together.

**Related**

- site-architecture.md §5.2 (the merge sentence) and site-architecture.md §8.3 (merge order), whose layout level this fills in.
- site-architecture.md §5.5: `$page.title` under a layout is lost through the same `_pageTitle` carrier; the two plans touch the same lines of `layout.ts` and `site-build.ts`.
