---
status: drafted
disposition: implement
claims:
  - site-architecture.md#7.2
requires:
  - studio/library-upload-destination-text
workspaces:
  - packages/studio
  - specs
  - docs
  - scripts/screenshots
size: L
---

# The Library scopes to a collection, reads its entries' own fields, and keeps its layout in the collection's saved view

## Context

`specs/site-architecture.md` §7.2, line 838:

> **Status: Partial.** The Library ships as a `GridSource` editor with all five layouts and windowed, LRU-capped previews (`packages/studio/src/browse/library-source.ts`, `library-layouts.ts`, `library-preview.ts`). Cards, Calendar and Board work over every project file rather than a collection's own fields, and the layout is one module-scoped value (`libraryView.layout` in `library-pane.ts`), neither chosen per collection nor saved with a view: `packages/studio/src/grid/grid-layout.ts` saves only columns, sort, grouping and filter per grid.

The census also marked three layout cells (lines 845 to 847): Cards `**Partial** — windowed previews ship; no entry field is read into a card`, Calendar `**Partial** — dated by a filename prefix or mtime, never a schema date`, Board `**Partial** — grouped by the fixed Library category, not a chosen field`. The window contract (IntersectionObserver previews in an LRU larger than a window) ships and is untouched here.

**Two surfaces, no bridge.** The Library (`browse/library-pane.ts`, markup `surfaces/library-pane.json`) is one tab over a file scan (`scanLibrary` in `browse/library-model.ts`); its Table is the surface's own windowed `role="table"` div list, not Tabulator, and it knows a collection only as the type label `contentTypeFor` prints. The collection grid (`openCollectionGrid` in `grid/grid-open.ts`, tab id `grid://collection/<name>`) reads entries through `createCollectionSource` (`grid/sources/content-source.ts`: schema-typed columns, frontmatter cells, the §7.6 draft perspective), and its View panel (`openViewPopover` in `grid/grid-panel.ts`, surface `surfaces/grid-views.ts`) saves order, widths, hidden, sort, `groupBy` and filter per grid id (`grid/grid-layout.ts`). Grouping and sort live inside `createGridController`'s closure (`orderedKeys`, `groupBuckets` in `grid/grid-controller.ts`); the text filter inside `setSearch` in `grid/grid-view.ts`.

**The collection source cannot read every collection** (verified by reading, not listed by the stub):

- A `format: "json"` collection lists its `.json` files, then `parseSourceForPath` throws because no format class claims `.json` (`documentExtensions` "never includes .json"), so every entry is dropped and the grid is empty. Its insert path (`insertFormatName`) falls back to `defaultContentFormat()`, writing Markdown into a `.json` file.
- A localized source (`./content/exhibitions/{locale}/`, the museum starter) is listed at the literal path `content/exhibitions/{locale}`, which does not exist, so the grid is empty; `collectionForFile` in `content/collection-match.ts` already matches such files correctly, as it does nested sources, which `listEntryFiles` does not separate.
- An unparseable entry is dropped silently (`catch` returning `null` in `buildEntryFileSource`'s `load`).

**Real schemas do not declare formats.** The starters type dates as plain strings (blog `date: June 14, 2026`, professional-firm, museum), images as `format: "image"` (`cover`, `image`), and summaries as `excerpt`, `summary` or `description`; §6.1's example uses `pubDate` (`format: "date"`) and `heroImage` (`format: "uri-reference"`). Field roles must be read by name as well as by kind.

**Editorial ride-along:** §7.1 line 820 still calls the Library "the **Browse** canvas mode ... a full-screen project file table".

## Outcome

- site-architecture.md §7.2 → Implemented. Under Content the Library offers each directory-backed collection as a scope; scoped, it lists that collection's entries (drafts per §7.6), Cards draw each entry's image, title and summary, Calendar dates by the collection's date field, Board groups by the view's grouping field, Table draws the collection's columns, and the layout is a facet of the collection's saved view.
- §7.2's Table, Cards, Calendar and Board cells → Implemented; §7.1's wording names the Library.
- The collection grid gains JSON and localized collections and a reported unreadable entry, as a consequence of the Library reading through it.

## Decisions

- **Decided:** a collection is a **scope under Content**, chosen by a Collection picker drawn only when Content is the category and the project declares a directory-backed collection, and by a `library.setCollection` command, rather than a chip per collection, because the picker mirrors the language facet (a facet whose options are the project's own) and a chip per collection grows the toolbar with the project. Choosing a category clears the collection; `library.setCollection` sets the category to Content.
- **Decided:** a scoped Library reads entries through the collection's own `GridSource` (`createCollectionSource`), cached per collection until `invalidateLibrary`, because that source already owns parsing, schema columns and the draft perspective, and a second entry reader in the Library would be one more of the parallel answers `content/collection-match.ts` and `content/entry-model.ts` were written to retire. The scan still supplies `modified` and `locale` by path.
- **Decided:** the source is fixed rather than worked around: `.json` entries read with `parseJsonDocument` and write with `serializeJson` (`@jxsuite/schema/json-layout`, the layout-preserving pair the editor saves with), listing walks the source's static prefix and keeps files `collectionForFile` assigns to the collection, and unreadable entries are reported, because §6.1's own `authors` example is a JSON collection and the Library's first rule is that it never calls a list empty for two reasons.
- **Decided:** sort, grouping and the text filter move out of the controller's closure into a pure `grid/row-order.ts` that the controller, the grid view and the Library all call, because §7.2's Board must group "reusing the grid's groupBy rather than a second grouping implementation", and a grouping the Library reimplemented would disagree with the grid on blanks and order.
- **Decided:** the View panel flow (`openViewPopover`, `projectViews`, `promptSaveView`, `confirmDeleteView`, `viewButtonLabel`) and the four `grid.*View` commands move into `grid/saved-views.ts` over a `ViewHost` interface that the grid panel and the Library each implement, and the commands resolve the host on screen in the active pane, because one set of verbs over one panel is studio-ui-guidelines.md §12.5's rule and the Library needs every control the grid's panel has.
- **Decided:** `GridLayout` gains one facet, `layout?: string`, opaque to `grid-layout.ts` and validated by the Library with `isLibraryLayout`; the grid ignores it. The file categories keep their layout in the `grid://library` record (layout only, no named views), because switching from a collection back to Pages must restore something and the store already exists.
- **Decided:** in a collection scope the search box **is** the view's `filter` facet and matches every column's text plus the path, as the grid's filter does; the file categories keep today's unpersisted name-and-path query.
- **Decided:** in a collection that has a date field, an entry with no value is dated by a `YYYY-MM-DD` filename prefix and otherwise listed under **No date**, never by mtime, because mtime is the last save and placing a post on it asserts a publication date it does not have. A collection with no date field keeps today's prefix-then-mtime rule.
- **Decided:** the Board groups by the view's `groupBy`; with none set it uses the first `enum` column, and with no `enum` column it draws one line asking for a field (View, Group by) over an ungrouped list, because a Board grouped by nothing is a list with a border.
- **Decided:** an upload in a collection scope lands in the collection's directory, beside its entries, where §6.1's asset mount publishes it; a localized collection has one directory per language, so it asks as All does, pre-filled with the source's static prefix.
- **Decided:** no edge to `plan:ui/jx-table`. This plan changes the Library table's projection (collection columns, a per-cell width style) and not its structure, so jx-table's adoption of that table lands before or after this one; the integration contract below says what it will find.
- **Decided:** require `plan:studio/library-upload-destination-text`, because the upload rule above amends the Library row of studio.md §9.3's Surfaces table, a section that plan claims and rewrites; landing it first leaves one row to extend rather than one to write twice.
- **Open:** does a scoped Library share the collection grid's saved-view record (`grid://collection/<name>`), so one view of a collection applies in both surfaces? Recommendation: share it, because a view is a view of the collection and `grid-layout.ts`'s header already names two stores as the §7.2 drift to avoid; the cost is that a filter or grouping set in the Library also opens the grid that way, which the View button's name and drift dot state.
- **Open:** how Cards and Calendar choose their fields. Recommendation: derive them, no per-view chooser in this plan: title `title`, `name`, `heading`, else the first required string; summary `description`, `summary`, `excerpt`, `bio`, else the first `text` column; image `heroImage`, `hero`, `cover`, `image`, `thumbnail`, `avatar`, else the first image-kind column; date the first date-kind column (`format: "date"` or `"date-time"`) preferring `pubDate`, `publishDate`, `publishedAt`, `date`, else a string column with one of those names whose loaded values all parse. The Calendar dates by the view's sort field when that column qualifies as a date by the same rule, so choosing another date is choosing the sort, and it says which field it used. This covers every starter and §6.1's example; a chooser is an additive later change.
- **Open:** single-file (CSV) collections. Recommendation: no Library scope; the spec names directory-backed collections, because a CSV collection's entries are rows of one file with no path to open, and its CSV grid is already its browser.
- **Open:** entries with no image field. Recommendation: the card keeps its live document preview (today's island) under the entry's title and summary, because a glyph would make a collection without images look worse than the file view it replaces.

## Implementation

All paths under `packages/studio/src/` unless noted.

**LCV1.1 — the collection source reads every entry, and row order is one module**

1. `grid/row-order.ts` (new, pure): `orderRowKeys(keys, valueOf, columns, sort: GridSortSpec | null, grouping: string | null): string[]` (blanks last in both directions, number and boolean compare, grouped rows contiguous in first appearance after the sort), `groupRowKeys(keys, valueOf, field): Map<string, string[]>`, and `rowMatchesText(valueOf, fields, term): boolean`, all over `cellToText`. `createGridController`'s `orderedKeys`, `groupBuckets` and `groups()` call them with `buffer.effectiveValue`; `createGridView`'s `setSearch` filters with `rowMatchesText`. Behaviour is unchanged.
2. `grid/sources/content-source.ts`:
   - `createCollectionSource` returns `CollectionSource extends GridSource` with `unreadable(): readonly { path: string; error: string }[]`, filled by `load` where it now returns `null`.
   - `list` walks the source's prefix before `LOCALE_PLACEHOLDER` (the whole source when there is none) and keeps paths whose `collectionForFile(path)?.name` is this collection and whose extension is `info.ext`. `listCollectionEntryIds` uses the same listing.
   - A `.json` path is read with `parseJsonDocument`: `frontmatter` is the document's own keys minus `$`-prefixed ones, and the record keeps `layout` and a `json` format marker. `writeEntry` and inserts for it write `serializeJson({ ...document, ...patch }, layout)` (`layout` `null` for an insert), deleting a key a cleared cell nulls. `insertFormatName` answers `json` for a `format: "json"` collection instead of the default content format.
   - A bare-name insert into a localized collection is refused with "Name the language folder, for example content/exhibitions/fr/…", as New Entry refuses.

**LCV1.2 — saved views over any view host, and the layout facet**

3. `grid/grid-layout.ts`: `GridLayout.layout?: string`; `FACETS` gains `"layout"`, so `saveViewAs`, `applySavedView` and `activeViewModified` carry it. `applyGridLayout` is unchanged.
4. `grid/saved-views.ts` (new): `interface ViewHost { paneId; tabId; gridId; label; columns(): GridColumn[]; grouping(): string | null; setSort(spec): void; setGrouping(field): void; remount(): void; applyLayout(layout: GridLayout | null): void; bump(): void }`, `setViewHost(paneId, host | null)`, `viewHostIn(paneId)` (null unless the host's tab is the pane's active tab), and the moved `viewButtonLabel`, `projectViews(host, at)`, `openViewPanel(host, anchor)`, `promptSaveView(host)`, `confirmDeleteView`, `gridViewCommands()` and `registerGridViewCommands` (ids, titles and refusals unchanged; `requires` reads "a grid or a scoped Library on screen"; enablement is `viewHostIn(workspace.activePaneId) !== null`). The prompt's message names the layout too when the host is the Library.
5. `grid/grid-panel.ts`: `renderGridMode` builds a `ViewHost` over the controller and panel and registers it; `detachGridPanel` clears it; `openViews` calls `openViewPanel`. The three importers of the commands (`src/studio.ts`, `src/commands/app-commands.ts`, `tests/grid-panel.test.ts`) import them from `grid/saved-views.ts`, and `grid/grid-lazy.ts`'s comment follows.

**LCV1.3 — the Library's collection scope**

6. `browse/library-fields.ts` (new, pure): `collectionFieldRoles(columns: GridColumn[], rows: GridRow[]): { title; summary; image; date: string | null }` by the rules in Decisions, and `entryDay(value: GridCellValue): string | null` (`YYYY-MM-DD…` taken as written; otherwise `Date.parse`, read in local time, so `June 14, 2026` is `2026-06-14`).
7. `browse/library-model.ts`: `LibraryFilter.collection`; `uploadDirFor(category, collection)` replacing `uploadDirForCategory`'s callers (a collection's `dir`, `undefined` for a localized one).
8. `browse/library-pane.ts`:
   - `LibraryViewState.collection: string` (`""` for all content); `setLibraryCollection(name)`; `setLibraryCategory` clears it. `libraryScopeId()` is `makeGridTabId({ kind: "collection", name })` or `libraryTabId()`. On scope change the pane loads `layout` (and, scoped, `filter` into `query`) from `loadGridLayout(scopeId)`; `setLibraryLayout` and scoped `setLibrarySearch` also `saveGridLayout(scopeId, …)`.
   - Scoped data: a `Map<string, CollectionSource>` built by `createCollectionSource`, dropped by `invalidateLibrary` and `refreshLibrary`; `loadScope()` fetches `columns()` and `rows()` with the same loading and slow-Activity handling as `loadLibrary`, and the render effect also tracks `draftView.includeDrafts` to re-list. `viewKind` treats `unreadable()` as it treats scan failures (banner, `incomplete`).
   - The projection, scoped: rows ordered by `orderRowKeys` with the view's sort and filtered by `rowMatchesText`; Table columns from `applyGridLayout(columns, layout)` with a width style from saved widths or `widthHint`; Cards and Media via `entryCard` (below); Calendar and Board via the scoped layouts; a `hint` line for the Calendar's date field and the Board's missing field; `collectionState`, `collectionOptions`, `collectionValue`; `viewState` and `viewLabel` for the View button.
   - A `ViewHost` over the scope, registered while scoped and cleared on detach or on leaving the scope; its `setSort` and `setGrouping` write the working layout and bump; `applyLayout` also sets `libraryView.layout` and `query` from the applied record.
   - `resolveUploadDir` uses `uploadDirFor`; a localized collection's prompt says "This collection keeps one folder per language. Choose which."
9. `browse/library-layouts.ts`: `entryCard(row, roles, file, live)` (title or file name, summary or collection name as `meta`, `art: "image"` with `src` from `previewAssetSrcFor(value, row.key)` when the image resolves, else today's `doc` or `glyph`); `calendarView` and `boardView` take a `(file) => day` and a grouping, so the file scope passes `libraryDate` and `groupByCategory` as today and the scope passes `entryDay` of the role (filename prefix fallback) and `groupRowKeys`.
10. `canvas/asset-refs.ts`: `previewAssetSrcFor(value, documentPath)`; `previewAssetSrc` delegates with the active tab's path.
11. `surfaces/library-pane.ts` and `surfaces/library-pane.json`: a `collection-slot` select beside `locale-slot` (same shape), a `view` button beside the layout chips, a `hint` line, and a `style` binding on table head and row cells. `LibraryView` and `LibraryActions` gain the matching fields (`setCollection`, `openViews`).
12. `browse/library-commands.ts`: `library.setCollection` with a `derivedEnumProperty` of `["all", ...entryCollections().map((c) => c.name)]`, `when: ctx.project.open && ctx.project.hasCollections`, no `aiTool`. `commands/context.ts` declares `project.hasCollections`; `commands/live-context.ts` computes it from `entryCollections()`.
13. `scripts/screenshots/manifest.json`: a `library-collection` shot on `packages/starters/sites/blog` running `library.open` then `library.setCollection` `{ "collection": "posts" }`, capturing `pane.primary`, docs `studio/projects/browse`.

**Integration contract.** Once this lands, a plan may rely on: `createCollectionSource(name)` listing JSON, localized and nested collections exactly as `collectionForFile` assigns them, with `unreadable()`; `grid/row-order.ts`'s three functions as the one sort, grouping and text-filter rule; `grid/saved-views.ts`'s `ViewHost`, `setViewHost` and `viewHostIn`, through which any surface joins the saved-view verbs; the `layout` facet on `GridLayout`; `collectionFieldRoles` and `entryDay`; `libraryView.collection`, `setLibraryCollection` and `library.setCollection`. `plan:ui/jx-table` will find the Library table's head and cells carrying a `style` width and its columns coming from the scope; `plan:studio/file-tree-command-records` will find the per-file menu unchanged and serving entry cards too.

## Tests

`bun test --isolate --coverage` from `packages/studio`. Per-file thresholds in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) apply to the three new files (`grid/row-order.ts`, `grid/saved-views.ts`, `browse/library-fields.ts`), which ship with their suites or the manifest check fails; ratchet the threshold if the worst file rises. DOM files import `./harness` first; the platform is the harness's in-memory mock.

- LCV1.1: `tests/row-order.test.ts` (new): "sorts blanks last in both directions", "numbers and booleans compare by value", "groups are contiguous in first appearance after the sort", "an empty cell groups under the empty key", "the text filter matches any field, case-insensitively, and an empty term matches all". `tests/grid-content-source.test.ts`: "a JSON collection lists its entries, and its fields are the document's own properties", "a JSON cell edit rewrites the file in the layout it was read in", "a JSON insert writes JSON, not the default content format", "a localized collection lists every declared locale's entries and not the images folder beside them", "a nested collection's entries belong to the nested one", "an unparseable entry is reported by unreadable()", "a bare-name insert into a localized collection is refused". The existing sort and grouping cases in `tests/grid-controller.test.ts` and filter case in `tests/grid-panel.test.ts` pass unchanged, which is the refactor's proof.
- LCV1.2: `tests/grid-layout.test.ts`: "a view snapshots the layout facet, and a changed layout is drift". `tests/saved-views.test.ts` (new): "no host means the verbs are disabled and refuse", "a host on a pane whose active tab moved is not on screen", "save, apply, delete and reset act on the host's grid id", "an unknown view is refused by name". The `tests/grid-panel.test.ts` saved-view cases pass unchanged.
- LCV1.3: `tests/library-fields.test.ts` (new): one case per role rule, "a schema naming none of the fields gives null roles", "an untyped `date` string column is the date only when its values parse", "`June 14, 2026` is 2026-06-14 whatever the offset". `tests/library-layouts.test.ts`: "a collection card takes its title, summary and image from the entry", "an entry with no image keeps the live preview island", "the Calendar dates by the collection's date field, then the filename, never the mtime", "a Calendar sorted by another date column is dated by it", "the Board groups through the grid's grouping", "with no grouping the Board uses the first enum column, or asks". `tests/library-pane.test.ts`: "the Collection picker appears under Content only where a directory-backed collection exists", "a collection scope lists entries, not files, and honours the draft perspective", "the layout is remembered per collection and the file categories keep theirs", "the scoped search matches field values and is the view's filter", "a collection whose entries could not be read says so", "the Table draws the collection's columns in the view's order without hidden ones", "the View button appears only when scoped, and a view saved there applies in the collection's grid", "an upload in a collection scope lands in its folder; a localized one asks". `tests/library-commands.test.ts`: "library.setCollection names a collection and all clears it", "it refuses an unknown collection naming the set", "it is hidden in a project with no collection". `tests/library-model.test.ts`: `uploadDirFor` cases.

`bun scripts/check-shot-contract.ts` must pass with the new shot (it names a declared command and a declared argument value).

## Specs & docs

**site-architecture.md**, edited in place:

- §7.1 line 820: "Additionally, the **Browse** canvas mode provides a full-screen project file table with category filtering" becomes "Additionally, the **Library** (§7.2) lists the project's files in a tab of its own, with category filtering"; the rest of the paragraph and the diagram stay.
- §7.2 marker becomes: `> **Status: Implemented.** The Library is a GridSource editor with five layouts and windowed, LRU-capped previews (packages/studio/src/browse/library-pane.ts, library-layouts.ts, library-preview.ts). Scoped to a collection it reads the entries through that collection's grid source (packages/studio/src/grid/sources/content-source.ts), takes each layout's fields from their schema (browse/library-fields.ts), and keeps its layout as a facet of the collection's saved view (packages/studio/src/grid/grid-layout.ts).` (code spans as in the current marker).
- The table: Table `**Implemented**` "Name, Category, Locale, Type, Size, Modified and Path; a collection's own columns when scoped to one. Filterable by category, collection and search." Cards `**Implemented**` "An entry's image, title and summary, with previews mounted only while on screen". Calendar `**Implemented**` "Date-sorted by the collection's date field, for date-bearing collections". Board `**Implemented**` "Grouped by the saved view's grouping field". Media unchanged.
- A paragraph after the table: "**A collection is a scope.** Under Content the Library offers each directory-backed collection (§6.1); scoped, it lists that collection's entries, drafts per §7.6's perspective, rather than its files. Which field plays which part is read from the collection's schema, by name first (`title` or `name`; `description`, `summary` or `excerpt`; `heroImage`, `cover` or `image`; `pubDate` or `date`) and then by type (a `format: "image"` or `"uri-reference"` string, a `format: "date"` string). An entry with no image keeps its live preview; an entry with no date in a dated collection is dated by its filename or not at all, never by its last save; a Calendar sorted by another date field is dated by it."
- The saved-view sentence gains, per the first Open: "…as a **saved view**: the collection's own, the record its grid saves, so a view named in either applies in both."
- Fragment: `bun run spec:change site-architecture.md minor -m "The Library scopes to a collection: Cards, Calendar and Board read the entries' own fields, the Table draws the collection's columns, and the layout is a facet of the collection's saved view, shared with its grid."`
- The spec does not graduate: other §-items stay open. `plans/site-architecture/` stays.

**studio.md §9.3** (after `plan:studio/library-upload-destination-text` lands): the Library row's destination gains "a collection's own folder when one is chosen; a localized collection asks". Fragment: `bun run spec:change studio.md patch -m "The Library's upload row names a chosen collection's folder as its destination."`

**Docs** (no em dashes):

- `docs/studio/projects/browse.md` (`code:` lists `library-pane.ts`, `library-layouts.ts`, `library-model.ts`, `library-commands.ts`, `surfaces/library-pane.ts`; add `browse/library-fields.ts` and `grid/saved-views.ts`): "Narrow it down" gains the **Collection** picker and **Library: Show Collection**; the layouts table rows for Cards, Calendar and Board describe the scoped behaviour; a new "One collection at a time" section covers the field conventions, the View button and saved views shared with the grid, with the `library-collection` image; the Calendar and Board paragraphs gain the scoped rules; "Upload media" names the collection folder.
- `docs/studio/editing/grid.md` (`code:` lists `grid-layout.ts`, `grid-panel.ts`, `grid-controller.ts`, `grid-view.ts`, `content-source.ts`; add `grid/saved-views.ts`, `grid/row-order.ts`): "A view holds all six facets" becomes seven, naming the Library layout; views of a collection are shared with the Library; JSON and localized collections open in the grid.
- `docs/studio/projects/media.md` ("Drag into the Library"): the collection folder rule and the localized prompt.
- `docs/studio/projects/content-types.md`: the Library sentence at line 59 says entries can also be browsed one collection at a time.
- `docs/studio/data/grid.md` lists `grid-layout.ts` and `grid-panel.ts`: no change (connector grids have no Library layout); say so in the pull request.
- `docs/studio/projects.md` and `pages-layouts-components.md` list `library-model.ts`/`library-pane.ts`: no change.

LCV1.1 carries the `grid.md` sentence on JSON and localized collections; LCV1.2 changes no documented behaviour (the facet is invisible until the Library writes it); every other edit above, both fragments and the shot land with LCV1.3.

## Acceptance

- `bun run plans:check --audit site-architecture` and `bun run docs:status` pass; §7.2 carries no Partial marker or cell.
- `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:spec-release` and `bun scripts/check-shot-contract.ts` pass.
- `bun test --isolate --coverage` in `packages/studio` passes its per-file thresholds and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- In Studio on the blog starter: ⌘⇧E, Content, Collection "Posts": six cards with cover images, titles and excerpts; Calendar places "Designing for Slowness" on 2026-06-14 and says it is dated by Date; View, Group by Tag gives a Board per tag; save the view as "By tag", reload, and it is reapplied; with the first Open as recommended, Edit Collection in Grid shows "By tag" in its View panel. On the museum starter, Collection "Exhibitions" lists every language's entries; in a project with a `format: "json"` collection, its entries show in the Library and in its grid.

## Slices

| Slice  | Scope                                                                                                                  | Claims                   | State |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----- |
| LCV1.1 | `grid/row-order.ts`; the collection source reads JSON, localized and nested collections and reports unreadable entries | —                        | open  |
| LCV1.2 | `layout` facet; `grid/saved-views.ts` and the grid panel as its first `ViewHost`                                       | —                        | open  |
| LCV1.3 | the Library's collection scope, fields, layouts, View button, upload, command, shot; spec and docs                     | site-architecture.md#7.2 | open  |
