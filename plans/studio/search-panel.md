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
- **The census missed a contradiction: the spec says rail-less, the code reserves a rail slot.** §5.1 says "Three more panels are registered `rail: false` — **Search** …". The record sets no `rail`, so it is rail-able: `railPanelSet()` lists it second, `railDeclarations()` counts it in `rail/project` (3 of the 4 `studio-ui-guidelines.md` §12.2 allows), and `panelFocusCommands` (`src/commands/defaults.ts`) binds `panel.focus.search` to ⌘2, hidden by the panel's `when`. `tests/panel-registry.test.ts` ("ignores `when`, so a hidden panel does not shuffle the chords after it") and `tests/commands-defaults.test.ts` pin that. The docs already skip the number (`docs/studio/interface.md` and `docs/start/studio-tour.md`: Files ⌘1, Source Control ⌘3), and the generated `docs/studio/interface/shortcuts.md` lists `⌘2 Show Search`, a chord that does nothing today.
- **The Icon column.** Files `folder` (`src/files/files.ts`) and Source Control `git-branch` (`src/panels/git-panel.ts`) are right; Outline is `stack` (`src/panels/layers-panel.ts`), Page `file` (`head-panel.ts`), Data `database` (`data-explorer.ts`), Packages `cube` (`imports-panel.ts`). All six and `magnifying-glass` are in `packages/ui/icons/list.json`.
- **Nothing else finds a word inside a document.** The palette (`src/panels/quick-search.ts`) matches file paths (`searchFiles("", documentExtensions())`, ranked locally) and, under `@`, the open document's Outline labels (`flattenTree`, `nodeLabel`). The assistant's `search_files` tool is by name. The protocol has no content-search route (`packages/protocol/src/routes.ts`); `GET /__studio/references` answers usages of a path or a tag only.
- **What a search can reuse.** `scanLibrary(dirs, platform)` (`src/browse/library-model.ts`) lists every file under the project's conventional directories (`projectState.projectDirs`) with a category, reporting unreadable directories rather than swallowing them. `openFileInTab` (`src/files/files.ts`) parses a format file with `parseSourceForPath` (`src/files/file-ops.ts`) and a `.json` with `parseJsonDocument` (`@jxsuite/schema/json-layout`), so those two produce the paths a tab holds. `selection.set { path }` (`src/canvas/canvas-render.ts`) selects in the active tab and refuses a path that addresses nothing. `startFsSync` (`src/files/fs-events.ts`) is the one subscriber to `subscribeFileEvents`, which all three backends implement, and it drops derived caches before its echo filter. Every PAL call counts in `platformInFlight()`, so `probeIdle()` (`src/services/idle.ts`) already waits on a build that reads through the PAL.
- **The body shape.** A Navigator panel's body is a Jx document over the kit (`studio-ui-guidelines.md` §1; `scripts/check-surface-purity.ts`), mounted from `afterRender` with `render: () => nothing`, as `src/panels/problems-panel.ts` (`surfaces/panel-problems.{json,ts}`) and `i18n-panel.ts` do. A project-level panel must draw with `doc: null` ("every project-level panel renders with no document open", `tests/panel-registry.test.ts`).

## Outcome

- studio.md §5.1 → Implemented: the marker goes; the table lists Search in the Project group and the four corrected icons; Insert and Languages are the two rail-less panels.
- A new studio.md §5.7 "Search Panel" states the contract: what is read, what matches, what a hit addresses, and how the results say they are incomplete.
- Not a graduation: studio.md keeps other open items.

## Decisions

- **Open:** implement Search, or give up the slot. Recommendation: implement. Every other part of the reservation already exists (the id, the region, the rail slot, ⌘2), nothing else in Studio finds a word across pages, and both alternatives cost more than they save: `remove` moves ⌘3 to ⌘7 down one, which every author's muscle memory and nine docs pages that print those chords would have to follow, and `defer` (a `Future` remainder that keeps the hidden record) leaves ⌘2 printed in the shortcut sheet as a chord that does nothing.
- **Open:** where Search sits. Recommendation: on the rail, Project group, ⌘2, and §5.1 is corrected to say so. The code, the chrome budget and the docs' numbering all assume it, and §5.1's own closing rule refuses a rail-less panel "for a surface that is the only way to do something", which a project-wide search is. It leaves `rail/project` at 3 of 4.
- **Open:** what a query matches. Recommendation: each string a document renders or names an element by, matched as a case-insensitive literal substring. That means text children, `textContent`, string attribute values, `$id`, `$title` and a custom element's `tagName` (each hit addresses its Outline row), plus the page's strings: a JSON page's root `title`, its `$head` entries' `textContent` and string attributes, and a format file's frontmatter string values, one level deep (each addresses the document). State entries, `$defs`, `style`, `$switch` expressions and function bodies are not searched: they belong to the Data panel (§5.6) and the Logic tab, and a hit on them could select nothing the Outline shows. No regex, case or whole-word toggles in this pass, and each string is matched on its own, so `foo <strong>bar</strong>` is not found as `foo bar`.
- **Decided:** the contract is a new §5.7, and §5.1 names the panel and points to it, because §5 gives every Navigator panel its own subsection and §5.1 is about the rail.
- **Decided:** no backend route. The index is built in the shell from `scanLibrary(projectState.projectDirs, getPlatform())`, `platform.readFile` and the tab opener's own parsers, because every backend already answers those calls, and only those parsers produce the path the opened tab will hold. The document set is the scan's files whose category is not `Media` and whose extension is `.json` or one of `documentExtensions()`. A `.json` is indexed only when it is a Jx document (an object with a string `tagName` or a `children` array). Root `project.json`, `package.json` and the generated `*schema.json` pair are outside the scanned directories and never read.
- **Decided:** an open tab is searched from memory (`workspace.tabs`, `tab.doc.document` and `tab.doc.content.frontmatter`), recomputed per query, and its disk copy is not read. Unsaved edits are found, and a hit's path is the tab's by construction.
- **Decided:** the index holds extracted entries, never parsed documents. It is built lazily on the first non-empty query, reads with six requests in flight, and is keyed to the `projectRoot` it was built for, dropping itself when that changes, so no project-open hook is needed. It is invalidated per path by `startFsSync`'s subscriber, beside `invalidateUsages()` and before the echo filter: a `change` or `create` for a document path (re)reads that file on the next query, and a `delete` drops it. Studio's own saves, renames and deletes reach it through the same watcher on all three backends. A hit made stale in the gap is handled on activation (below).
- **Decided:** results are grouped by file in path order, then document order, capped at `SEARCH_RESULT_CAP = 500` rows with a summary that says so ("First 500 of 1,284 matches in 96 files"). A directory the scan could not read or a file that failed to read or parse is named in the summary, so a partial answer never reads as complete, the rule §9.1.1 keeps for a reference count that could not be taken.
- **Decided:** activating a hit runs `openFileInTab(file, { preview: true })` (browsing, §14), then, when `activeTab.value?.documentPath` is that file and `getNodeAtPath` still resolves the hit's path, `runActiveReported("selection.set", { path }, "Search")`. A page hit selects nothing. A stale path selects nothing and invalidates that file, so the re-projected results are current. The Navigator stays on Search.
- **Decided:** `search.setQuery { query }` is the one setter (level `project`, `menus: ["palette"]`, `when: ctx.project.open`, title "Search: Find Text"), and the field writes through it. It is idempotent (§13.5), does not reveal the panel (as `library.setSearch` does not), and has no `aiTool`, because a finder for a person does not earn a slot under the assistant's cap of 30 (`studio-ui-guidelines.md` §12.2). It gives a shot or `__jxAutomation` a named input. The field is not debounced: matching the in-memory entries is cheap, and a timer is outstanding work `probeIdle()` cannot see.
- **Decided:** `NOT_YET_BUILT` and `nothingYet()` are deleted with their last user, and the record moves to the module that owns the surface, per `navigator-panels.ts`'s own rule that every record is defined beside the state it writes.

## Implementation

1. **`src/services/project-search.ts`** (new, `@docs studio/interface`). It must stay DOM-free at module scope.
   - Types: `SearchKind = "text" | "attribute" | "name" | "page"`, and `SearchEntry { kind; path: JxPath | null; field: string; text: string; label: string }`. `field` is the attribute name, `$id`, `$title`, `tagName`, the frontmatter key, `title` or `$head`; `label` is `nodeLabel(node)` for an element, `""` for a page string. Also `SearchHit extends SearchEntry { file: string; start: number; end: number }` and `SearchResults { hits; total; files }`.
   - `extractSearchEntries(document, frontmatter?)`: one pass over `flattenTree(document)` (`src/state.ts`). A `text` row becomes a `text` entry at the row's own path. An element row contributes `textContent` (a string), each string attribute, `$id`, `$title` and a hyphenated `tagName`. Then the page strings with `path: null`. Nothing is read from `state`, `$defs`, `style` or `$switch`.
   - `isJxDocument(value)` for the document-set test above, and `matchSearch(entries: ReadonlyMap<string, readonly SearchEntry[]>, query, cap = SEARCH_RESULT_CAP)`: a `toLocaleLowerCase()` `indexOf` per string (first occurrence only), in path order then entry order, returning `total` and the file count uncapped.
   - The index: a `reactive` `searchIndex` (`root`, `status: "cold" | "reading" | "ready"`, `read`, `total`, `failures: { path; error }[]`, `version`) with a module `Map<string, SearchEntry[]>` behind it. `ensureSearchIndex()` is coalesced like `createLibrarySource`'s `inFlight` and never rejects (the `scanLibrary` rule): it awaits `loadFormats()`, scans, filters, then reads and parses in a pool of `SEARCH_READ_CONCURRENCY = 6`, bumping `read` and `version`. `searchableEntries()` overlays the open tabs' entries on the disk entries. `invalidateSearchIndex(events?: readonly FsEvent[])` works per path as decided, and drops everything when called with no argument.
2. **`src/surfaces/panel-search.json` + `src/surfaces/panel-search.ts`** (new, the adapter shaped exactly like `surfaces/panel-problems.ts`: `registerSurface("panel-search", …)`, `mountSearchSurface(container, values, actions)` returning `update`, `connected` and `dispose`). The document draws, by `part` (no class; `ui.md` §3.1):
   - `query`: a `jx-textfield` of type `search`, labelled "Search the project".
   - `summary`: `role="status"`, carrying the reading progress ("Reading 40 of 120 files…"), the count, the cap and the failures.
   - `group`: a `file` button (the path and its count, opening the file) over `hit` buttons. A hit shows `before`, `match` and `after` spans, with the kind's field and the `label` as a second line.
   - The `empty` block of `studio-ui-guidelines.md` §11.2. With no query: "Find words across every page, layout, component and content file in this project." and the detail "Matches text, attribute values, element names and page titles, including unsaved edits in open tabs." With no project: "Search a project's pages once one is open."
   - Snippets are cut to about 40 characters either side of the match in the panel, not in the document.
3. **`src/panels/search-panel.ts`** (new, `@docs studio/interface`).
   - `registerSearchPanel()` registers `{ id: "search", title: "Search", level: "project", dock: "navigator", icon: "magnifying-glass", render: () => nothing, afterRender: mountSearchPanel }`, with no `when` and no `rail`.
   - `mountSearchPanel` is idempotent. It owns one `effectScope` whose `effect` reads the query, `searchIndex.version` and `workspace.tabs`, then calls `handle.update(...)` with the projection of `matchSearch(searchableEntries(), query)` and `searchIndex`, as `syncProblemsSurface` does. It tears down when `handle.connected()` turns false, and calls `ensureSearchIndex()` when the query first becomes non-empty.
   - `openHit` implements the activation decision. It imports `../files/files.js` lazily, as `problems-panel.ts`'s `openProblemPath` does, to keep the file browser off `shell.ts`'s static graph.
   - `searchCommands(): AnyCommand[]` holds `search.setQuery`, reading the argument with `optionalStringArg`. `registerSearchCommands(registry)` registers them.
4. **`src/panels/navigator-panels.ts`**: replace the inline record with `registerSearchPanel()` in the same position; delete `NOT_YET_BUILT` and `nothingYet`; rewrite the header's "Search is declared and hidden" paragraph to say that rail order is chord order and that a panel hidden by `when` keeps its number.
5. **`src/files/fs-events.ts`**: in `startFsSync`'s subscriber, call `invalidateSearchIndex(events)` beside `invalidateUsages()`.
6. **Composition**: add `...searchCommands()` to `defaultCommandSet()` in `src/commands/app-commands.ts`, and `registerSearchCommands(commandRegistry)` beside `registerLibraryCommands` in `src/studio.ts`. If `app-commands-composition.test.ts` shows `search-panel.ts` is not bare-Bun importable, move `searchCommands` to `src/panels/search-commands.ts`, the `library-commands.ts` shape.
7. **Comments that would turn false**: `railDeclarations()` and `PanelRecord.when` in `src/panels/panel-registry.ts` (`when` now gates by context, e.g. Languages); the `NOT_YET_BUILT` note in `src/panels/bottom-dock.ts`; `panelFocusCommands`'s "(Search, Problems)" in `src/commands/defaults.ts`; the `panelAvailable` docstring in `src/shell.ts`, which should name a gated panel that still exists.

**Integration contract.** Once this lands, `panel.focus.search` (⌘2) and `view.setActivity { tab: "search" }` show a real panel. `search.setQuery { query }` is a registered, palette-visible, project-level setter. `services/project-search.ts` exports `extractSearchEntries`, `matchSearch`, `ensureSearchIndex`, `searchableEntries`, `invalidateSearchIndex`, `searchIndex` and `SEARCH_RESULT_CAP`, so a later palette mode over the same entries (the content search `quick-search.ts`'s header anticipates) reuses the index rather than building a second one. `NOT_YET_BUILT` no longer exists. studio.md §5.7 is the contract a later change to what Search matches must edit.

## Tests

`cd packages/studio && bun test --isolate --coverage`, then `bun scripts/check-coverage-manifest.ts packages/studio`.

- **`tests/project-search.test.ts`** (new; `installMockPlatform` for the index, `openTab` for the open-tab case):
  - "extractSearchEntries reads the strings the Outline shows": a fixture with a text child, `textContent`, `href` and `alt`, `$id`, `$title`, a `site-header` instance and a repeater's `map` template yields each entry with its kind, path, field and `nodeLabel`.
  - "page strings address the document": a root `title`, a `$head` meta `content` and frontmatter `title`/`tags` give `page` entries with `path: null`.
  - "state, $defs, style, expressions and function bodies are not entries".
  - "matchSearch is a case-insensitive literal": `Pricing` finds `pricing`; `a.b` does not match `axb`; `start` and `end` offsets are pinned.
  - "matchSearch caps rows, not the count": 600 hits give 500 rows, `total` 600, the file count uncapped, in path then document order.
  - "the index reads the Library's documents and nothing else": a tree with `pages/`, `content/` (`.md` through a mocked `formatAction`), `public/` media, a non-Jx `data/nav.json` and a root `project.json` indexes exactly the page and the entry.
  - "an open tab is read from memory": a dirty tab's unsaved text is found, and `readFile` is never called for its path.
  - "a failed read is named, not empty": one `readFile` rejects and one directory fails to list; both are in `failures`, and the rest are indexed.
  - "an event re-reads only what it names": after `invalidateSearchIndex([{ type: "change", path }])`, the next build reads that one file; `delete` drops its entries; `create` adds a file; a new `projectRoot` rebuilds from cold.
  - "concurrent builds are one build": two `ensureSearchIndex()` calls list once.
- **`tests/search-panel.test.ts`** (new, DOM; `./harness` first; `mock.module("../src/files/files", …)` doubling `openFileInTab`, the CLAUDE.md rule for a lazily imported implementation):
  - "a query lists hits grouped by file": through the field and through `search.setQuery`, with headings, counts and `[part="match"]` text.
  - "each empty state says what Search is for": no query, no project, no matches.
  - "the summary reports progress, the cap and what could not be read".
  - "a hit opens its file as a preview and selects its element", and "a page hit selects nothing".
  - "a stale hit selects nothing and re-reads its file".
  - "search.setQuery is a project-level palette setter": empty clears; running it twice leaves one state.
  - The adapter's `connected()` and `dispose()` race while the mount is in flight, as the Problems suite covers its own.
- **Updated**:
  - `tests/panel-registry.test.ts`: "a declared-but-unbuilt panel refuses to render" becomes "Search is built": no `when`, on the rail, and a body that mounts. "ignores `when`…" uses a synthetic hidden panel. The project-level loop expects `["files", "search", "git", "problems", "activity"]`.
  - `tests/rail.test.ts`: `railIds()` is `["files", "search", "git", "layers", "page", "data", "packages"]`.
  - `tests/commands-defaults.test.ts`: the synthetic hidden rail panel and its comments stop being called Search.
  - `tests/shell-view-commands.test.ts`: the gate example becomes `i18n`.
  - `tests/fs-events.test.ts`: the subscriber invalidates the search index with the batch, echoes included.
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
  > **What it reads.** Every document under the project's directories as the Library lists them (§9.1.2): a `.json` that is a Jx document, and every file a format class claims. A document open in a tab is read from the tab, so unsaved edits are found. No backend route serves it: the panel reads each file through the PAL and parses it with the parser that opens it in a tab, which is why a hit's path is the path the tab holds. The entries live for the session, and a filesystem event re-reads only the files it names.
  >
  > **What matches.** The query is a case-insensitive literal substring, tried against each string on its own:
  >
  > | Kind      | Strings                                                                   | A hit addresses           |
  > | --------- | ------------------------------------------------------------------------- | ------------------------- |
  > | text      | a text child, `textContent`                                               | its Outline row           |
  > | attribute | a string attribute value                                                  | the element, and the name |
  > | name      | `$id`, `$title`, a custom element's `tagName`                             | the element               |
  > | page      | a page's `title` and `$head` strings, a format file's frontmatter strings | the document, and the key |
  >
  > State entries, `$defs`, styles, expressions and function bodies are not searched; they are the Data panel's (§5.6) and the Logic tab's. A phrase split by inline markup is not found as one string.
  >
  > **Results** are grouped by file in path order, then in document order, each row showing the match in context, the element's Outline label, and the attribute or key it came from. At most 500 rows are drawn and the summary says so. A directory or file that could not be read is named in the summary, for the reason §9.1.1 never renders an uncountable reference count as 0: "nothing matched" and "some files were not searched" are different answers.
  >
  > **Activating a row** opens its file as a preview tab (§14) and selects the element through `selection.set`; a page row opens the file and selects nothing. A row whose path no longer addresses an element opens the file, selects nothing, and re-reads it. The Navigator stays on Search.
  >
  > `search.setQuery { query }` is the one setter; the field writes through it, and the empty string clears the results. It does not reveal the panel, and it declares no `aiTool`.

- Fragment: `bun run spec:change studio.md minor -m "The Search panel ships on the rail and finds text, attribute values, element names and page strings across the project's documents, and the Activity Bar table names the icons the rail draws"`.

**Docs** (no page's `spec:` cites `studio.md#5.1`; no em dashes):

- `docs/studio/interface.md`:
  - Add `studio.md#5.1` and `studio.md#5.7` to `spec:`, and `packages/studio/src/panels/search-panel.ts` and `packages/studio/src/services/project-search.ts` to `code:`.
  - Under **Project**, between Files and Source Control, add: "- **Search** (:kbd[⌘2]): finds words across every page, layout, component and content file in the project, including edits you have not saved yet. Matches are grouped by file: the text on the page, attribute values such as link targets and alt text, element names, and a page's title and frontmatter. Click a match to open its file and select the element that holds it."
- `docs/start/studio-tour.md`: "**Project**: **Files** (:kbd[⌘1]) and **Source Control** (:kbd[⌘3])" becomes "**Project**: **Files** (:kbd[⌘1]), **Search** (:kbd[⌘2]) and **Source Control** (:kbd[⌘3])".
- `docs/studio/interface/quick-access.md`: end "What it finds" with "Quick Access matches file names. To find a word inside your pages, use **Search** (:kbd[⌘2]) in the [Navigator](/docs/studio/interface#navigator-rail)."
- The generated `shortcuts.md` and `commands.md` pick up `Show Search` and `Search: Find Text` from the registry, with no edit.
- `bun run docs:sync` will also name pages for `bottom-dock.ts` and `commands/defaults.ts` (`docs/studio/interface/problems-and-progress.md`, `docs/studio/logic/formula-workspace.md`, and the two above). No change is needed there, because only comments in those files move.
- The screenshot lane recaptures every picture of the rail, which now draws a Search button. Re-read the pages its comment lists. No new shot is required.

## Acceptance

- `grep -rn "NOT_YET_BUILT\|nothingYet" packages/studio/src packages/studio/tests` prints nothing.
- `cd packages/studio && bun test --isolate --coverage` is green, and `bun scripts/check-coverage-manifest.ts packages/studio` passes with the three new `.ts` files in the report.
- `bun --cwd packages/studio scripts/check-icons.ts`, `bun scripts/check-chrome-budget.ts` (`rail/project` still 3), `bun scripts/check-command-levels.ts` and `bun scripts/check-shot-contract.ts` pass. `bun run typecheck` and `bun run lint` are clean.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:section-refs` pass, and `bun run plans:status --spec studio` no longer lists §5.1.
- In Studio (the `packages/studio:verify` recipe), on `packages/starters/sites/blog`:
  - The rail's Project group reads Files, Search, Source Control, and ⌘2 opens Search.
  - Typing a word from a post lists it under its file, and clicking the row opens the post and selects the element in the Outline and the Inspector.
  - After editing a heading without saving, the new words are found.
  - ⌘3 still opens Source Control.
