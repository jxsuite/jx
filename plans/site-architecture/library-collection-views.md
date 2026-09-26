---
status: stub
disposition: implement
claims:
  - site-architecture.md#7.2
size: L
workspaces:
  - packages/studio
---

# The Library reads a collection's own fields and remembers its layout as a saved view

## Context

`specs/site-architecture.md` §7.2, line 836:

> **Status: Partial.** The Library ships as a `GridSource` editor with all five layouts and windowed, LRU-capped previews (`packages/studio/src/browse/library-source.ts`, `library-layouts.ts`, `library-preview.ts`). Cards, Calendar and Board work over every project file rather than a collection's own fields, and the layout is one module-scoped value (`libraryView.layout` in `library-pane.ts`), neither chosen per collection nor saved with a view: `packages/studio/src/grid/grid-layout.ts` saves only columns, sort, grouping and filter per grid.

Before the census all five layout cells read `**Implemented**` with no leading marker; the census corrected three of them (lines 843 to 845):

- Cards: `**Partial** — windowed previews ship; no entry field is read into a card`
- Calendar: `**Partial** — dated by a filename prefix or mtime, never a schema date`
- Board: `**Partial** — grouped by the fixed Library category, not a chosen field`

The window contract (IntersectionObserver-mounted previews held in an LRU larger than a window) ships and is not part of this plan.

**What exists**

- `libraryView` (`packages/studio/src/browse/library-pane.ts`), one reactive, module-scoped view state for the whole window: category, layout, locale, query.
- `libraryRow`, `calendarView` and `boardView` (`packages/studio/src/browse/library-layouts.ts`); `libraryDate` and `groupByCategory` (`packages/studio/src/browse/library-model.ts`); tests in `packages/studio/tests/library-layouts.test.ts`, `library-model.test.ts` and `library-source.test.ts`.
- Saved views for grids (`packages/studio/src/grid/grid-layout.ts`: order, widths, hidden, sort, `groupBy`, filter per grid id) and the collection grid (`packages/studio/src/grid/sources/content-source.ts`).

**What is missing**

- Cards that show an entry's hero image, title and summary, read from the collection schema's fields (which fields, when a schema names none of those, is a decision).
- A Calendar that dates an entry by its collection's date field (for example `pubDate`) and is scoped to a collection, with the filename prefix and mtime as fallbacks.
- A Board grouped by a field the author chooses, reusing the grid's `groupBy` rather than a second grouping implementation.
- The layout chosen per collection and persisted with filter, sort, columns and grouping as one saved view.
- Editorial ride-along: §7.1 still calls the Library the "Browse canvas mode".

**Related**

- site-architecture.md §7.1 (project explorer), site-architecture.md §7.6 (the draft column and perspective), site-architecture.md §6.1 (collection schemas).
