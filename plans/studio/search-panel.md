---
status: drafted
disposition: implement
claims:
  - studio.md#5.1
requires: []
workspaces:
  - packages/studio
size: M
---

# The Search panel finds text across the project from its reserved rail slot, and the rail table names the icons it draws

## Context

`specs/studio.md` §5.1, line 315 (the section was unmarked before the census):

> **Status: Partial.** The level-grouped rail, the rail-less Insert and Languages panels and the bottom-anchored Settings menu ship (`packages/studio/src/panels/navigator-panels.ts`, `panels/settings-menu.ts`). Search does not: its record is registered with `when: NOT_YET_BUILT` and a placeholder render, so there is no Search surface to reach. The Icon column is stale: the records use `stack`, `file`, `database` and `cube` for Outline, Page, Data and Packages.

Two parts under one anchor, so one plan holds both: the panel is built, and the Icon column is corrected in the same pull request. Verified at the detail pass (paths under `packages/studio/`):

- **The record.** `registerNavigatorPanels` (`src/panels/navigator-panels.ts`) registers `search` (project level, `icon: "magnifying-glass"`, `when: NOT_YET_BUILT`, `render: () => nothingYet()`, which throws). Search is the last user of `NOT_YET_BUILT` and `nothingYet`; `src/panels/bottom-dock.ts` notes it gave up its own reservation.
- **The census missed a contradiction: the spec says rail-less, the code reserves a rail slot.** §5.1 says "Three more panels are registered `rail: false` — **Search** …". The record sets no `rail`, so it is rail-able: `railPanelSet()` lists it second, `railDeclarations()` counts it in `rail/project` (3 of the 4 `studio-ui-guidelines.md` §12.2 allows), and `panelFocusCommands` (`src/commands/defaults.ts`) binds `panel.focus.search` to ⌘2, hidden by the panel's `when`. `tests/panel-registry.test.ts` ("ignores `when`, so a hidden panel does not shuffle the chords after it", "counts hidden panels") pins that. The docs already skip the number (`docs/studio/interface.md` and `docs/start/studio-tour.md`: Files ⌘1, Source Control ⌘3), and the generated `docs/studio/interface/shortcuts.md` lists `⌘2 Show Search`, a chord that does nothing today.
- **The Icon column.** Files `folder` (`src/files/files.ts`) and Source Control `git-branch` (`src/panels/git-panel.ts`) are right; Outline is `stack` (`src/panels/layers-panel.ts`), Page `file` (`head-panel.ts`), Data `database` (`data-explorer.ts`), Packages `cube` (`imports-panel.ts`). All six and `magnifying-glass` are in `packages/ui/icons/list.json`.
- **Nothing else finds a word inside a document.** The palette (`src/panels/quick-search.ts`) matches file paths (`searchFiles("", documentExtensions())`, ranked locally) and, under `@`, the open document's Outline labels (`flattenTree`, `nodeLabel`). The assistant's `search_files` tool is by name. The protocol has no content-search route (`packages/protocol/src/routes.ts`); `GET /__studio/references` answers usages of a path or a tag only.
- **What a search can reuse.** `scanLibrary(dirs, platform)` (`src/browse/library-model.ts`) lists every file under the project's conventional directories (`projectState.projectDirs`) with a category, reporting unreadable directories rather than swallowing them. `openFileInTab` (`src/files/files.ts`) sends viewable media to the media viewer and `.csv` to the grid, parses a format file with `parseSourceForPath` (`src/files/file-ops.ts`) and a `.json` with `parseJsonDocument` (`@jxsuite/schema/json-layout`), and `createTab` (`src/tabs/tab.ts`) then runs `normalizeArrayChildren` (`src/state.ts`) on the result. Those three steps produce the paths a tab holds. `selection.set { path }` (`src/canvas/canvas-render.ts`) selects in the active tab and refuses a path that addresses nothing. `startFsSync` (`src/files/fs-events.ts`) is the one subscriber to `subscribeFileEvents` (dev server, cloud and both desktop hosts implement it; the events are `add`, `change`, `unlink`, `addDir` and `unlinkDir`), and before its echo filter it calls `invalidateUsages()` and the bootstrap's injected `invalidateDerivedCaches()` (`src/studio.ts`), the seam `FsSyncContext` documents for a cache that lives above the file layer. Every PAL call counts in `platformInFlight()`, so `probeIdle()` (`src/services/idle.ts`) already waits on a build that reads through the PAL.
- **The body shape.** A Navigator panel's body is a Jx document over the kit (`studio-ui-guidelines.md` §1; `scripts/check-surface-purity.ts`), mounted from `afterRender` with `render: () => nothing`. The Navigator runs only the showing panel's `afterRender`, against the content box (`paintInto` in `src/panels/left-panel.ts`), so `mountI18nPanel` (`src/panels/i18n-panel.ts`) is the shape to follow; `problems-panel.ts`'s `_painted` flag exists because the Bottom dock runs every tab's hook. A project-level panel must draw with `doc: null` ("no tab, no throw", `tests/panel-registry.test.ts`).
- **The palette cannot prompt for a string.** `paletteArgs` (`src/panels/quick-search.ts`) answers `unsupported` for any argument that is not one enum or boolean, and command mode omits such a record, which is why `library.setSearch` declares `palette` and is never drawn there.

## Outcome

- studio.md §5.1 → Implemented: the marker goes; the table lists Search in the Project group and the four corrected icons; Insert and Languages are the two rail-less panels.
- A new studio.md §5.7 "Search Panel" states the contract: what is read, what matches, what a hit addresses, and how the results say they are incomplete.
- Not a graduation: studio.md keeps other open items.

## Decisions

- **Open:** implement Search, or give up the slot. Recommendation: implement. Every other part of the reservation already exists (the id, the region, the rail slot, ⌘2), nothing else in Studio finds a word across pages, and both alternatives cost more than they save: `remove` moves ⌘3 to ⌘7 down one, which every author's muscle memory and the nine docs pages that print those chords would have to follow, and `defer` (a `Future` remainder that keeps the hidden record) leaves ⌘2 printed in the shortcut sheet as a chord that does nothing.
- **Open:** where Search sits. Recommendation: on the rail, Project group, ⌘2, and §5.1 is corrected to say so. The code, the chrome budget and the docs' numbering all assume it, and §5.1's own closing rule refuses a rail-less panel "for a surface that is the only way to do something", which a project-wide search is. It leaves `rail/project` at 3 of 4.
- **Open:** what a query matches. Recommendation: each string a document renders or names an element by, matched as a case-insensitive literal substring. That means text children, `textContent`, string attribute values, a component instance's string `$props` values, `$id`, `$title` and a custom element's tag name (each hit addresses its Outline row), plus the page's strings: a JSON page's root `title`, its `$head` entries' `textContent` and string attributes, and a format file's frontmatter strings (a top-level string, or each string in a top-level array; each addresses the document). A `${…}` span inside a string is an expression and is not matched; the literal text around it is, so `Posted` finds `Posted ${state.date}` and `state` finds nothing there. State entries, `$defs`, `style`, `$switch` expressions and function bodies are not searched: they belong to the Data panel (§5.6) and the Logic tab, and a hit on them could select nothing the Outline shows. No regex, case or whole-word toggles in this pass, and each string is matched on its own, so `foo <strong>bar</strong>` is not found as `foo bar`.
- **Decided:** the contract is a new §5.7, and §5.1 names the panel and points to it, because §5 gives every Navigator panel its own subsection and §5.1 is about the rail.
- **Decided:** no backend route. The index is built in the shell from `scanLibrary(projectState.projectDirs, getPlatform())`, `platform.readFile`, and the tab opener's own steps (`parseSourceForPath` or `parseJsonDocument`, then `normalizeArrayChildren`), because every backend already answers those calls and only those steps produce the path the opened tab will hold. The document set is exactly what `openFileInTab` opens as a document tab: a scanned file whose category is not `Media`, whose extension is not `.csv` (the grid's), and which is either a `.json` that is a Jx document (an object with a string `tagName` or a `children` array) or claimed by a format with a `parse` capability (`formatByExtension(ext, "parse")`). Root `project.json`, `package.json` and the generated `*schema.json` pair are outside the scanned directories and never read.
- **Decided:** an open tab whose `documentPath` is in the document set is searched from memory (`tab.doc.document` and `tab.doc.content.frontmatter`), recomputed per query, and its disk copy is not read while it is open. Unsaved edits are found, and a hit's path is the tab's by construction.
- **Decided:** the index holds extracted entries, never parsed documents. It is built lazily when the panel shows a non-empty query, reads with six requests in flight, and is keyed to the `workspace.projectRoot` it was built for (reactive, unlike `projectState`): a mismatch resets it to cold, and a build whose root changed mid-flight discards what it read, so no project-open hook is needed. A document path with no entries, no recorded failure and no open tab is unread, and a build reads exactly the unread paths. Invalidation rides the existing `invalidateDerivedCaches` seam, widened to receive the raw batch (echoes included, since Studio's own saves, renames and deletes change what matches): `add` and `change` make a path unread (adding it to the document set when it qualifies), `unlink` drops it, `unlinkDir` drops everything under it, and `addDir` makes the next build rescan the listing. A hit made stale in the gap is handled on activation (below).
- **Decided:** results are grouped by file in path order, then document order, capped at `SEARCH_RESULT_CAP = 500` rows with a summary that says so ("First 500 of 1,284 matches in 96 files"). A directory the scan could not read or a file that failed to read or parse is named in the summary, so a partial answer never reads as complete, the rule §9.1.1 keeps for a reference count that could not be taken.
- **Decided:** activating a hit awaits `openFileInTab(file, { preview: true })` (browsing, §14), then, when `activeTab.value?.documentPath` is that file and `getNodeAtPath` still resolves the hit's path, runs `runActiveReported("selection.set", { path }, "Search")`. A page hit selects nothing. A stale path selects nothing and invalidates that file, so the re-projected results are current. The Navigator stays on Search.
- **Decided:** `setSearchQuery(query)` is the one writer of the query, which is session state (not persisted). The field calls it and `search.setQuery { query }` runs it, the `setLibrarySearch` / `library.setSearch` shape, so a keystroke is not a registry run. The record is level `project`, `requires: "an open project"`, `when: ctx.project.open`, title "Search: Find Text", and `menus: ["never"]`: the palette cannot prompt for a free string (Context), and declaring `palette` would be a placement that is never drawn. It is idempotent (§13.5), does not reveal the panel (as `library.setSearch` does not), and has no `aiTool`, by `studio-ui-guidelines.md` §12.4's first rule (a listing for a person). It gives a shot or `__jxAutomation` a named input. The field is not debounced: matching the in-memory entries is cheap, and a timer is outstanding work `probeIdle()` cannot see.
- **Decided:** `NOT_YET_BUILT` and `nothingYet()` are deleted with their last user, and the record moves to the module that owns the surface, per `navigator-panels.ts`'s own rule that every record is defined beside the state it writes.

## Implementation

1. **`src/services/project-search.ts`** (new, `@docs studio/interface`). It is on `commands/app-commands.ts`'s bare-Bun graph (through `search-panel.ts` and `navigator-panels.ts`), so nothing at its module scope may read the DOM.
   - Types: `SearchKind = "text" | "attribute" | "prop" | "name" | "page"`, and `SearchEntry { kind; path: JxPath | null; field: string; text: string; label: string }`. `field` is the attribute or prop name, `$id`, `$title`, `tagName`, the frontmatter key, `title` or `$head`; `label` is `nodeLabel(node)` for an element, `""` for a page string. Also `SearchHit extends SearchEntry { file: string; start: number; end: number }` and `SearchResults { hits; total; files }`.
   - `extractSearchEntries(document, frontmatter?)`: one pass over `flattenTree(document)` (`src/state.ts`). A `text` row whose node is a string becomes a `text` entry at the row's own path. An element row contributes `textContent` when it is a string, each string value in `attributes`, each string value in `$props`, `$id`, `$title`, and `displayTagName(tagName)` (`@jxsuite/schema/guards`) when it contains a hyphen. Then the page strings with `path: null`. Nothing is read from `state`, `$defs`, `style` or `$switch`.
   - `isJxDocument(value)`, `isSearchDocument(path)` (the document-set test above), and `matchSearch(entries: ReadonlyMap<string, readonly SearchEntry[]>, query, cap = SEARCH_RESULT_CAP)`: `toLocaleLowerCase()` then `indexOf` per string, taking the first occurrence that overlaps no `${…}` span, in path order then entry order, returning `total` and the file count uncapped.
   - The index: a `reactive` `searchIndex` (`root`, `status: "cold" | "stale" | "reading" | "ready"`, `read`, `total`, `failures: { path; error }[]`, `version`) over module state (the document set, a `Map<string, SearchEntry[]>`, a rescan flag and a generation counter). `ensureSearchIndex()` is coalesced like `createLibrarySource`'s `inFlight` and never rejects (the `scanLibrary` rule): it awaits `loadFormats()`, scans when cold or flagged, then reads and parses every unread path in a pool of `SEARCH_READ_CONCURRENCY = 6`, bumping `read` and `version` per file, and records scan and read failures. `searchableEntries()` checks the root, then returns the document set in path order, each path's open tab's entries overlaid on its disk entries. `invalidateSearchIndex(events?: readonly FsEvent[])` applies the per-event rules above, bumps `version`, and sets `status` to `stale` when a path became unread or a rescan is due; with no argument it resets to cold.
   - It imports `parseSourceForPath` from `../files/file-ops`, which is safe here because `navigator-panels.ts` already reaches that module statically through `files/files.ts`. It is not imported by `fs-events.ts` (below), so no cycle through `grid/grid-controller.ts` is created.
2. **`src/surfaces/panel-search.json` + `src/surfaces/panel-search.ts`** (new, the adapter shaped like `surfaces/panel-problems.ts`: `registerSurface("panel-search", …)`, `mountSearchSurface(container, values, actions)` returning `update`, `connected` and `dispose`, the document appended rather than the container cleared). The document draws, by `part` (no class; `ui.md` §3.1):
   - `query`: a `jx-textfield` of type `search`, labelled "Search the project", whose input calls the `setQuery` action.
   - `progress`: "Reading 40 of 120 files…" while a build runs, outside the live region so it is not announced per file.
   - `summary`: `role="status"`, the count, the cap and the failures, written when a build settles or the query changes.
   - `group`: a `file` button (the path and its count, opening the file) over `hit` buttons. A hit shows `before`, `match` and `after` spans, with the kind's field and the `label` as a second line.
   - The `empty` block of `studio-ui-guidelines.md` §11.2. With no query: "Find words across every page, layout, component and content file in this project." and the detail "Matches text, attribute and component values, element names and page titles, including unsaved edits in open tabs." (compact, the field above it is the action, §11.1 rule 2's exception). With no project: "Search a project's pages once one is open." with an **Open Project…** action running `project.open` through `runActiveReported`. No matches is a result rather than an empty region: it says "Nothing in this project matches" followed by the query, bound as a value.
   - Snippets are cut to about 40 characters either side of the match in the panel, not in the document.
3. **`src/panels/search-panel.ts`** (new, `@docs studio/interface`).
   - `searchView` (`reactive({ query: "" })`) and `setSearchQuery(query)`.
   - `registerSearchPanel()` registers `{ id: "search", title: "Search", level: "project", dock: "navigator", icon: "magnifying-glass", render: () => nothing, afterRender: mountSearchPanel }`, with no `when` and no `rail`.
   - `mountSearchPanel(ctx, host)` follows `mountI18nPanel`: one standing slot `{ container, handle, scope }`; a mount into a different container, or a standing handle that is no longer `connected()`, disposes the old handle and stops its scope first; otherwise it returns. The scope holds one `effect` that stops the scope the first time it runs against a disconnected handle, and otherwise reads `searchView.query`, `searchIndex.version`, `workspace.projectRoot` and `workspace.tabs`, calls `ensureSearchIndex()` whenever the query is non-empty (it returns at once when no path is unread, which is also how a closed tab's file gets read), and calls `handle.update(...)` with the projection of `matchSearch(searchableEntries(), query)` and `searchIndex`.
   - `openHit(hit): Promise<void>` implements the activation decision. It imports `openFileInTab` statically: `navigator-panels.ts` already imports `files/files.ts` for `registerFilesPanel`, so the edge adds nothing to any graph.
   - `searchCommands(): AnyCommand[]` holds `search.setQuery`, reading the argument with `optionalStringArg(...) ?? ""`. `registerSearchCommands(registry)` registers them.
4. **`src/panels/navigator-panels.ts`**: replace the inline record with `registerSearchPanel()` in the same position; delete `NOT_YET_BUILT` and `nothingYet`; rewrite the header's "Search is declared and hidden" paragraph to say that rail order is chord order and that a panel hidden by `when` keeps its number.
5. **`src/files/fs-events.ts`**: `FsSyncContext.invalidateDerivedCaches` becomes `(events: readonly FsEvent[]) => void`, and the subscriber passes it the raw batch. **`src/studio.ts`**: `ensureFsSync`'s list gains `invalidateSearchIndex(events)` (its comment's "four caches" becomes five).
6. **Composition**: add `...searchCommands()` to `appCommandSet()` in `src/commands/app-commands.ts`, and `registerSearchCommands(commandRegistry)` beside `registerLibraryCommands` in `src/studio.ts`. `app-commands-composition.test.ts` finds the factory by its `…Commands(): AnyCommand[]` shape and fails until both are there.
7. **Comments that would turn false**: `railDeclarations()` and `PanelRecord.when` in `src/panels/panel-registry.ts` (`when` now gates by context, e.g. Languages); the `NOT_YET_BUILT` note in `src/panels/bottom-dock.ts`; `panelFocusCommands`'s "(Search, Problems)" in `src/commands/defaults.ts`; the `panelAvailable` docstring in `src/shell.ts`, which should name a gated panel that still exists (`i18n`).

**Integration contract.** Once this lands, `panel.focus.search` (⌘2) and `view.setActivity { tab: "search" }` show a real panel. `search.setQuery { query }` is a registered project-level setter with `menus: ["never"]`, reachable by `registry.run`, shots and `__jxAutomation`; it joins the palette only if the palette learns to prompt for a string. `services/project-search.ts` exports `extractSearchEntries`, `matchSearch`, `ensureSearchIndex`, `searchableEntries`, `invalidateSearchIndex`, `searchIndex` and `SEARCH_RESULT_CAP`, so a later palette mode over the same entries (the content search `quick-search.ts`'s header anticipates) reuses the index rather than building a second one. `invalidateDerivedCaches` receives the raw event batch. `NOT_YET_BUILT` no longer exists. studio.md §5.7 is the contract a later change to what Search matches must edit.

## Tests

`cd packages/studio && bun test --isolate --coverage`, then `bun scripts/check-coverage-manifest.ts packages/studio`.

- **`tests/project-search.test.ts`** (new; `installMockPlatform` and `setFormats` for the index, `openTab` from `src/workspace/workspace.ts` for the open-tab case):
  - "extractSearchEntries reads the strings the Outline shows": a fixture with a text child, `textContent`, `href` and `alt`, a `$props` heading, `$id`, `$title`, a `site-header` instance and a repeater's `map` template yields each entry with its kind, path, field and `nodeLabel`.
  - "page strings address the document": a root `title`, a `$head` meta `content` and frontmatter `title`/`tags` give `page` entries with `path: null`.
  - "state, $defs, style, expressions and function bodies are not entries".
  - "matchSearch is a case-insensitive literal": `Pricing` finds `pricing`; `a.b` does not match `axb`; `start` and `end` offsets are pinned.
  - "an expression is not text": `state` does not match `${state.name}`, and `Posted` matches `Posted ${state.date}` at offset 0.
  - "matchSearch caps rows, not the count": 600 hits give 500 rows, `total` 600, the file count uncapped, in path then document order.
  - "the index reads what a tab would open and nothing else": a tree with `pages/`, `content/` (`.md` through a mocked `formatAction`), a `content/products.csv` a format claims, `public/` media, a non-Jx `data/nav.json` and a root `project.json` indexes exactly the page and the entry.
  - "a hit's path is the one the tab will hold": a legacy whole-children repeater on disk yields its `[…, "children", 0, "map", …]` member-form path.
  - "an open tab is read from memory": a dirty tab's unsaved text is found, `readFile` is never called for its path, and after the tab closes the next build reads it.
  - "a failed read is named, not empty": one `readFile` rejects and one directory fails to list; both are in `failures`, the rest are indexed, and the failed file is not re-read until an event names it.
  - "an event re-reads only what it names": after `invalidateSearchIndex([{ type: "change", path, isDir: false }])` the next build reads that one file; `unlink` drops its entries; `add` adds a file; `unlinkDir` drops a folder's entries; `addDir` rescans; a new `projectRoot` rebuilds from cold, and a build overtaken by a root change keeps nothing.
  - "concurrent builds are one build": two `ensureSearchIndex()` calls list once.
- **`tests/search-panel.test.ts`** (new, DOM; `./harness` first; the real `openFileInTab` over `installMockPlatform` with `.json` pages):
  - "a query lists hits grouped by file": through the field and through `search.setQuery`, with headings, counts and `[part="match"]` text.
  - "each empty state says what Search is for": no query, no project (its action runs `project.open`), no matches.
  - "the summary reports progress, the cap and what could not be read".
  - "a hit opens its file as a preview and selects its element" (the tab is a preview and `session.selection` is the hit's path), and "a page hit selects nothing".
  - "a stale hit selects nothing and re-reads its file".
  - "search.setQuery is a project-level setter": empty clears; running it twice leaves one state; it is refused with no project.
  - "switching panels takes the document down": a second mount into a new container disposes the first, and an update after disconnection stops the effect.
  - The adapter's `connected()` and `dispose()` race while the mount is in flight, as the Problems suite covers its own.
- **Updated**:
  - `tests/panel-registry.test.ts`: "a declared-but-unbuilt panel refuses to render" becomes "Search is built": no `when`, on the rail, and a body that mounts. `railGroups`' first case expects `["files", "search", "git"]`. "ignores `when`…" and "counts hidden panels" use a synthetic hidden rail panel. The "no tab, no throw" loop expects `["files", "search", "git", "problems", "activity"]`.
  - `tests/rail.test.ts`: `railIds()` is `["files", "search", "git", "layers", "page", "data", "packages"]`.
  - `tests/commands-defaults.test.ts`: the synthetic hidden rail panel and its comments stop being called Search.
  - `tests/shell-view-commands.test.ts`: the gate example becomes `i18n`.
  - `tests/fs-events.test.ts`: the subscriber hands `invalidateDerivedCaches` the whole batch, echoes included.
  - `tests/app-commands-composition.test.ts`: `search.setQuery` is in the projection.

Coverage: `packages/studio/bunfig.toml` gates every file at `lines = 0.958, functions = 0.941`. The three new `.ts` files ship with their tests in this pull request (the manifest check fails otherwise); `panel-search.json` is exercised through its adapter. If the workspace's worst file rises, ratchet the threshold to just under the new minimum.

## Specs & docs

**`specs/studio.md`**, in place:

- §5.1: delete the marker line (the section was unmarked before the census).
- §5.1's table: a Search row between Files and Source Control (Group Project, Tab Search, Id `search`, Icon `magnifying-glass`, Panel "Text and names across the project's documents (§5.7)"), and the Icon cells for Outline, Page, Data and Packages become `stack`, `file`, `database` and `cube`.
- §5.1, after the table, add: "Rail order is chord order: `panel.focus.<id>` binds ⌘1 onward down this table, and a panel its `when` hides keeps its number, so no chord moves when one appears."
- §5.1: "Three more panels are registered `rail: false` — **Search** (`search`, project level), **Insert** …" becomes "Two more panels are registered `rail: false`: **Insert** …", with the Insert and Languages clauses kept. The closing paragraph gains a last sentence: "Search is on the rail for that reason: nothing else finds a word across the project (§5.7)."
- New **§5.7 Search Panel**, after §5.6 and before §6, unmarked. Adjust it to how the three Open decisions resolve:

  > Search finds text across the project's documents. The palette matches file names, and with `@` the open document's elements; nothing else looks inside every page. It is a project-level panel on the rail (§5.1).
  >
  > **What it reads.** Every document under the project's directories as the Library lists them (§9.1.2) that a tab would open as a document: a `.json` that is a Jx document, and every file a format class parses except a CSV, which opens in the grid. A document open in a tab is read from the tab, so unsaved edits are found. No backend route serves it: the panel reads each file through the PAL and parses and normalizes it exactly as opening it in a tab does, which is why a hit's path is the path the tab holds. The entries live for the session, and a filesystem event re-reads only the files it names.
  >
  > **What matches.** The query is a case-insensitive literal substring, tried against each string on its own. A `${…}` expression inside a string is not text and is not matched; the literal text around it is.
  >
  > | Kind      | Strings                                                                   | A hit addresses           |
  > | --------- | ------------------------------------------------------------------------- | ------------------------- |
  > | text      | a text child, `textContent`                                               | its Outline row           |
  > | attribute | a string attribute value                                                  | the element, and the name |
  > | prop      | a component instance's string `$props` value                              | the element, and the prop |
  > | name      | `$id`, `$title`, a custom element's tag name                              | the element               |
  > | page      | a page's `title` and `$head` strings, a format file's frontmatter strings | the document, and the key |
  >
  > State entries, `$defs`, styles, `$switch` expressions and function bodies are not searched; they are the Data panel's (§5.6) and the Logic tab's. A phrase split by inline markup is not found as one string.
  >
  > **Results** are grouped by file in path order, then in document order, each row showing the match in context, the element's Outline label, and the attribute, prop or key it came from. At most 500 rows are drawn and the summary says so. A directory or file that could not be read is named in the summary, for the reason §9.1.1 never renders an uncountable reference count as 0: "nothing matched" and "some files were not searched" are different answers.
  >
  > **Activating a row** opens its file as a preview tab (§14) and selects the element through `selection.set`; a page row opens the file and selects nothing. A row whose path no longer addresses an element opens the file, selects nothing, and re-reads it. The Navigator stays on Search.
  >
  > `search.setQuery { query }` is the one setter, and the field writes the same state; the empty string clears the results. It is not a palette row, because the palette cannot prompt for free text, and it does not reveal the panel or declare an `aiTool`.

- Fragment: `bun run spec:change studio.md minor -m "The Search panel ships on the rail and finds text, attribute and component values, element names and page strings across the project's documents, and the Activity Bar table names the icons the rail draws"`.

**Docs** (no page's `spec:` cites `studio.md#5.1`; no em dashes):

- `docs/studio/interface.md`:
  - Add `studio.md#5.1` and `studio.md#5.7` to `spec:`, and `packages/studio/src/panels/search-panel.ts` and `packages/studio/src/services/project-search.ts` to `code:`.
  - Under **Project**, between Files and Source Control, add: "- **Search** (:kbd[⌘2]): finds words across every page, layout, component and content file in the project, including edits you have not saved yet. Matches are grouped by file: the text on the page, attribute values such as link targets and alt text, the values you give a component, element names, and a page's title and frontmatter. Click a match to open its file and select the element that holds it."
- `docs/start/studio-tour.md`: "**Project**: **Files** (:kbd[⌘1]) and **Source Control** (:kbd[⌘3])" becomes "**Project**: **Files** (:kbd[⌘1]), **Search** (:kbd[⌘2]) and **Source Control** (:kbd[⌘3])".
- `docs/studio/interface/quick-access.md`: end "What it finds" with "Quick Access matches file names. To find a word inside your pages, use **Search** (:kbd[⌘2]) in the [Navigator](/docs/studio/interface#navigator-rail)."
- The generated `shortcuts.md` and `commands.md` pick up `Show Search` and `Search: Find Text` from the registry, with no edit.
- `bun run docs:sync` will also name the pages whose `code:` lists a touched file: `docs/studio/interface/problems-and-progress.md` and `docs/studio/logic/formula-workspace.md` (`bottom-dock.ts`, a comment only), and `docs/studio/interface/tabs.md` (`studio.ts`, bootstrap wiring). None describes the changed lines, so none needs an edit. `app-commands.ts` feeds only the two generated pages.
- The screenshot lane recaptures every picture of the rail, which now draws a Search button. Re-read the pages its comment lists. No new shot is required.

## Acceptance

- `grep -rn "NOT_YET_BUILT\|nothingYet" packages/studio/src packages/studio/tests` prints nothing.
- `cd packages/studio && bun test --isolate --coverage` is green, and `bun scripts/check-coverage-manifest.ts packages/studio` passes with the three new `.ts` files in the report.
- `bun --cwd packages/studio scripts/check-icons.ts`, `bun --cwd packages/studio scripts/check-surface-purity.ts`, `bun scripts/check-chrome-budget.ts` (`rail/project` still 3), `bun scripts/check-command-levels.ts` and `bun scripts/check-shot-contract.ts` pass. `bun run typecheck` and `bun run lint` are clean.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:section-refs` pass, and `bun run plans:status --spec studio` no longer lists §5.1.
- In Studio (the `packages/studio:verify` recipe), on `packages/starters/sites/blog`:
  - The rail's Project group reads Files, Search, Source Control, and ⌘2 opens Search.
  - Typing a word from a post lists it under its file, and clicking the row opens the post and selects the element in the Outline and the Inspector.
  - "workbench" finds the About page's section-header heading (a `$props` value), and "state" finds nothing inside a `${…}` expression.
  - After editing a heading without saving, the new words are found.
  - ⌘3 still opens Source Control.
